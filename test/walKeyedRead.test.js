const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const wal = require('../shared/js/walSnapshotStore')

const codec = {
    name: 'gzip',
    compress: bytes => zlib.gzipSync(bytes),
    decompress: bytes => zlib.gunzipSync(bytes)
}
const opts = {codec}
const BASE = 'mbKeyed'
const AREAS = ['queue', 'completed']

// Small deterministic PRNG so a failing scenario can be replayed from its seed.
function makeRandom(seed) {
    let value = seed >>> 0
    return () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0
        return value / 4294967296
    }
}

function makeScenario(seed) {
    const random = makeRandom(seed)
    const pick = list => list[Math.floor(random() * list.length)]
    const keys = Array.from({length: 60}, (_, index) => `https://www.quora.com/profile/S${seed}-${index}`)
    const baseState = {queue: {}, completed: {}, runs: {}, progress: {}, events: [{kind: 'start'}]}
    for (const key of keys) {
        if (random() < 0.5) baseState.queue[key] = {status: pick(['queued', 'active']), seq: Math.floor(random() * 9)}
        if (random() < 0.3) baseState.completed[key] = {status: 'succeeded', terminalAt: Math.floor(random() * 99)}
    }

    let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
    const written = wal.writeInactiveCheckpoint(store, baseState, {
        snapshotSeq: 10, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name, shardCount: 10
    })
    store = wal.activateCheckpoint(written.store, written.checkpointId, opts).store

    const tail = []
    const recordCount = 20 + Math.floor(random() * 40)
    for (let index = 0; index < recordCount; index += 1) {
        const area = pick(AREAS)
        const key = pick(keys)
        // Some records are at or below the snapshot sequence, so replay must ignore them.
        const seq = random() < 0.1 ? 1 + Math.floor(random() * 9) : 11 + index
        const roll = random()
        if (roll < 0.4) {
            tail.push({seq, kind: 'map.set', area, key, value: {status: pick(['queued', 'succeeded', 'failed']), seq, tag: index}})
        }
        else if (roll < 0.8) {
            tail.push({seq, kind: 'map.patch', area, key, patch: {status: pick(['queued', 'active', 'succeeded']), patchedAt: index}})
        }
        else {
            tail.push({seq, kind: 'map.remove', area, key})
        }
    }
    store = wal.appendWalRecordsToGeneration(store, tail, {}).store
    return {store, keys}
}

function fullRows(stored) {
    const hydrated = wal.hydrateSegmentedWalStore(stored, {baseKey: BASE, fallbackStore: null})
    assert.equal(hydrated.ok, true, hydrated.reason)
    const recovered = wal.recoverProjectedState(hydrated.store, [], opts)
    assert.equal(recovered.recovered, true, recovered.reason)
    return recovered.projected.state
}

function canonical(value) {
    return value === undefined ? 'absent' : wal.stableStringify(value)
}

async function run(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch (error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

const cases = []
function register(name, fn) {
    cases.push([name, fn])
}

register('keyed row reads match the full projection for every key across random scenarios', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
        const {store, keys} = makeScenario(seed)
        const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
        const state = fullRows(payload)
        for (const area of AREAS) {
            for (const key of keys) {
                const keyed = wal.projectKeyedRowFromStored(payload, {baseKey: BASE, area, key, codec})
                assert.equal(keyed.ok, true, `seed ${seed} ${area} ${key}: ${keyed.reason}`)
                const expected = state[area]?.[key]
                const actual = keyed.found ? keyed.value : undefined
                assert.equal(canonical(actual), canonical(expected), `seed ${seed} ${area} ${key}`)
            }
        }
    }
})

register('the keyed read set is sufficient on its own, without the rest of storage', () => {
    for (let seed = 31; seed <= 45; seed += 1) {
        const {store, keys} = makeScenario(seed)
        const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
        const state = fullRows(payload)
        const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
        for (const area of AREAS) {
            for (const key of keys.slice(0, 15)) {
                const readKeys = wal.getKeyedRowReadKeys(meta, key, {baseKey: BASE})
                const subset = {}
                for (const readKey of readKeys) {
                    if (readKey in payload) subset[readKey] = payload[readKey]
                }
                const keyed = wal.projectKeyedRowFromStored(subset, {baseKey: BASE, area, key, codec})
                assert.equal(keyed.ok, true, `seed ${seed} ${area} ${key}: ${keyed.reason} ${keyed.missingKey || ''}`)
                assert.equal(canonical(keyed.found ? keyed.value : undefined), canonical(state[area]?.[key]), `seed ${seed} ${area} ${key}`)
            }
        }
    }
})

register('a keyed read touches one shard and never reads checkpoint shards for other keys', () => {
    const {store, keys} = makeScenario(50)
    const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
    const shardKeys = wal.getKeyedRowReadKeys(meta, keys[0], {baseKey: BASE})
        .filter(key => key.includes('.checkpoint.') && /\.s\d\d$/.test(key))
    assert.equal(shardKeys.length, 1)
})

register('a legacy monolithic checkpoint reports legacy-checkpoint instead of guessing', () => {
    const state = {queue: {}, completed: {}, runs: {}, progress: {}, events: []}
    const legacy = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
    const written = wal.writeInactiveCheckpoint(legacy, state, {snapshotSeq: 1, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name})
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, opts).store
    const payload = wal.buildSegmentedWalStoragePayload(activated, {baseKey: BASE, writeCheckpoints: true})
    const keyed = wal.projectKeyedRowFromStored(payload, {baseKey: BASE, area: 'queue', key: 'x', codec})
    assert.equal(keyed.ok, false)
    assert.equal(keyed.reason, 'legacy-checkpoint')
})

register('a manifest that does not match the active metadata is rejected, not used for the row', () => {
    const {store, keys} = makeScenario(61)
    const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
    const active = meta.activeCheckpoint
    const mixed = {
        ...payload,
        [wal.getSegmentedWalMetaKey(BASE)]: {
            ...meta,
            checkpoints: {
                ...meta.checkpoints,
                [active]: {...meta.checkpoints[active], stateHash: 'not-the-manifest-hash'}
            }
        }
    }
    const keyed = wal.projectKeyedRowFromStored(mixed, {baseKey: BASE, area: 'queue', key: keys[0], codec})
    assert.equal(keyed.ok, false)
    assert.equal(keyed.reason, 'checkpoint-manifest-meta-mismatch')
})

register('a missing tail segment is reported with its key, not answered from partial data', () => {
    const {store, keys} = makeScenario(60)
    const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
    const active = meta.activeCheckpoint
    const segmentKey = wal.getSegmentedWalSegmentKey(BASE, active, 0)
    const withoutSegment = {...payload}
    delete withoutSegment[segmentKey]
    const keyed = wal.projectKeyedRowFromStored(withoutSegment, {baseKey: BASE, area: 'queue', key: keys[0], codec})
    assert.equal(keyed.ok, false)
    assert.equal(keyed.reason, 'missing-segment')
    assert.equal(keyed.missingKey, segmentKey)
})

register('a session mirror of the active slot answers keyed reads exactly as storage does', () => {
    for (let seed = 70; seed <= 85; seed += 1) {
        const {store, keys} = makeScenario(seed)
        const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
        const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
        const mirror = wal.selectQueueMirrorRecords(payload, meta, {baseKey: BASE})
        // The mirror is a strict subset: no inactive slot, no other records.
        for (const key of Object.keys(mirror)) assert.ok(key in payload)
        assert.ok(Object.keys(mirror).length < Object.keys(payload).length)
        for (const area of AREAS) {
            for (const key of keys) {
                const fromStorage = wal.projectKeyedRowFromStored(payload, {baseKey: BASE, area, key, codec})
                const fromMirror = wal.projectKeyedRowFromStored(mirror, {baseKey: BASE, area, key, codec})
                assert.equal(fromMirror.ok, fromStorage.ok, `seed ${seed} ${area} ${key}`)
                assert.equal(canonical(fromMirror.found ? fromMirror.value : undefined), canonical(fromStorage.found ? fromStorage.value : undefined), `seed ${seed} ${area} ${key}`)
            }
        }
    }
})

register('an incremental append advances a mirror to the same rows as a full payload, and stays fresh', () => {
    const META = wal.getSegmentedWalMetaKey(BASE)
    for (let seed = 100; seed <= 111; seed += 1) {
        let {store, keys} = makeScenario(seed)
        let payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
        let mirror = wal.selectQueueMirrorRecords(payload, payload[META], {baseKey: BASE})
        assert.equal(wal.isQueueMirrorFresh(mirror[META], payload[META]), true, `seed ${seed}: full mirror starts fresh`)

        for (let step = 1; step <= 3; step += 1) {
            const active = store.meta.activeCheckpoint
            const committedBefore = wal.getSegmentedWalCommittedSegmentCount(store.meta, active)
            const startSeq = store.meta.nextSeq
            const records = [0, 1, 2].map(index => ({
                seq: startSeq + index,
                kind: 'map.set',
                area: 'queue',
                key: keys[(seed + step + index) % keys.length],
                value: {status: 'queued', seq: startSeq + index, step}
            }))
            store = wal.appendWalRecordsToGeneration(store, records, {}).store
            const incremental = wal.buildSegmentedWalStoragePayload(store, {
                baseKey: BASE,
                writeCheckpoints: false,
                generationsToWrite: [active],
                segmentStartByGeneration: {[active]: committedBefore}
            })
            const diskMetaBefore = incremental[META]
            // Before the mirror is advanced, it must not be fresh against the new disk meta.
            assert.equal(wal.isQueueMirrorFresh(mirror[META], diskMetaBefore), false, `seed ${seed} step ${step}: stale mirror detected`)
            const plan = wal.planQueueMirrorAppend(mirror[META], incremental, {baseKey: BASE})
            assert.ok(plan, `seed ${seed} step ${step}: append should be plannable`)
            mirror = {...mirror, ...plan.records}

            payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
            assert.equal(wal.isQueueMirrorFresh(mirror[META], payload[META]), true, `seed ${seed} step ${step}: mirror fresh after advance`)
            for (const area of AREAS) {
                for (const key of keys) {
                    const fromMirror = wal.projectKeyedRowFromStored(mirror, {baseKey: BASE, area, key, codec})
                    const fromStorage = wal.projectKeyedRowFromStored(payload, {baseKey: BASE, area, key, codec})
                    assert.equal(fromMirror.ok, fromStorage.ok, `seed ${seed} step ${step} ${area} ${key}`)
                    assert.equal(canonical(fromMirror.found ? fromMirror.value : undefined), canonical(fromStorage.found ? fromStorage.value : undefined), `seed ${seed} step ${step} ${area} ${key}`)
                }
            }
        }
    }
})

register('a checkpoint write or an active-slot change is not planned as an append', () => {
    const META = wal.getSegmentedWalMetaKey(BASE)
    const {store} = makeScenario(120)
    const before = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    // A payload that carries a checkpoint key must be rebuilt, not appended.
    const withCheckpoint = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    assert.equal(wal.planQueueMirrorAppend(before[META], withCheckpoint, {baseKey: BASE}), null)
    // A mirror that names another active slot cannot be advanced.
    const otherSlot = {...before[META], activeCheckpoint: before[META].activeCheckpoint === 'A' ? 'B' : 'A'}
    assert.equal(wal.planQueueMirrorAppend(otherSlot, {...before}, {baseKey: BASE}), null)
})

// The resident copy is the store this process last wrote, with the meta that write put on disk
// (see cacheCoordinatorQueueWalResidentStoreFromWrite in sw.js).
function residentOf(store, payload) {
    return {...store, meta: payload[wal.getSegmentedWalMetaKey(BASE)]}
}

function tailRecordTotal(store) {
    const active = store.meta.activeCheckpoint
    return store.wal[active].segments.reduce((sum, segment) => sum + segment.records.length, 0)
}

register('a resident answer equals the storage answer for every key and area', () => {
    for (let seed = 130; seed <= 145; seed += 1) {
        const {store, keys} = makeScenario(seed)
        const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
        const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
        const resident = residentOf(store, payload)
        const state = fullRows(payload)
        for (const area of AREAS) {
            for (const key of keys) {
                const fromStorage = wal.projectKeyedRowFromStored(payload, {baseKey: BASE, area, key, codec})
                const fromResident = wal.projectKeyedRowFromResidentStore(resident, meta, {baseKey: BASE, area, key, codec})
                assert.equal(fromResident.ok, true, `seed ${seed} ${area} ${key}: ${fromResident.reason}`)
                assert.equal(fromResident.found, fromStorage.found, `seed ${seed} ${area} ${key}`)
                assert.equal(canonical(fromResident.value), canonical(fromStorage.value), `seed ${seed} ${area} ${key}`)
                assert.equal(canonical(fromResident.found ? fromResident.value : undefined), canonical(state[area]?.[key]), `seed ${seed} ${area} ${key} vs full`)
                assert.equal(fromResident.tailRecords, fromStorage.tailRecords, `seed ${seed} ${area} ${key} tail`)
                assert.equal(fromResident.shardIndex, fromStorage.shardIndex, `seed ${seed} ${area} ${key} shard`)
            }
        }
    }
})

register('a stale resident copy is refused in both directions, and the storage answer stays correct', () => {
    const {store, keys} = makeScenario(150)
    const before = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    const options = {baseKey: BASE, area: 'queue', key: keys[0], codec}
    const staleResident = residentOf(store, before)

    // An acknowledged write lands on disk after the resident copy was taken.
    const appended = wal.appendWalRecordsToGeneration(store, [{
        seq: store.meta.nextSeq,
        kind: 'map.set',
        area: 'queue',
        key: keys[0],
        value: {status: 'active', seq: 0}
    }], {}).store
    const after = wal.buildSegmentedWalStoragePayload(appended, {baseKey: BASE, writeCheckpoints: true})
    const behind = wal.projectKeyedRowFromResidentStore(staleResident, after[wal.getSegmentedWalMetaKey(BASE)], options)
    assert.equal(behind.ok, false)
    assert.equal(behind.reason, 'resident-meta-mismatch')
    const fromStorage = wal.projectKeyedRowFromStored(after, options)
    assert.equal(fromStorage.ok, true)
    assert.deepEqual(fromStorage.value, {status: 'active', seq: 0})

    // A resident copy ahead of the disk meta (the disk was rolled back) is refused too.
    const ahead = wal.projectKeyedRowFromResidentStore(residentOf(appended, after), before[wal.getSegmentedWalMetaKey(BASE)], options)
    assert.equal(ahead.ok, false)
    assert.equal(ahead.reason, 'resident-meta-mismatch')

    // A checkpoint switch on disk changes the active slot: the old resident copy is refused.
    const written = wal.writeInactiveCheckpoint(appended, {queue: {}, completed: {}, runs: {}, progress: {}, events: []}, {
        snapshotSeq: appended.meta.nextSeq,
        snapshotEpoch: 2,
        createdAt: 2,
        codec,
        codecName: codec.name,
        shardCount: 10
    })
    const switched = wal.activateCheckpoint(written.store, written.checkpointId, opts).store
    const switchedPayload = wal.buildSegmentedWalStoragePayload(switched, {baseKey: BASE, writeCheckpoints: true})
    const afterSwitch = wal.projectKeyedRowFromResidentStore(staleResident, switchedPayload[wal.getSegmentedWalMetaKey(BASE)], options)
    assert.equal(afterSwitch.ok, false)
    assert.equal(afterSwitch.reason, 'resident-meta-mismatch')

    // A resident copy whose in-memory tail is shorter than the committed count is refused.
    const active = store.meta.activeCheckpoint
    const shortTail = {
        ...staleResident,
        wal: {...staleResident.wal, [active]: {...staleResident.wal[active], segments: staleResident.wal[active].segments.slice(0, -1)}}
    }
    const short = wal.projectKeyedRowFromResidentStore(shortTail, before[wal.getSegmentedWalMetaKey(BASE)], options)
    assert.equal(short.ok, false)
    assert.equal(short.reason, 'resident-meta-mismatch')
})

register('a manifest that does not match the active metadata is refused on the resident path too', () => {
    const {store, keys} = makeScenario(160)
    const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
    const active = meta.activeCheckpoint
    const options = {baseKey: BASE, area: 'queue', key: keys[0], codec}

    // Disk meta whose checkpoint fingerprint names another manifest: the same generation fields,
    // so only the manifest binding can refuse it.
    const mixedMeta = {
        ...meta,
        checkpoints: {
            ...meta.checkpoints,
            [active]: {...meta.checkpoints[active], stateHash: 'not-the-manifest-hash'}
        }
    }
    const refusedMeta = wal.projectKeyedRowFromResidentStore(residentOf(store, payload), mixedMeta, options)
    assert.equal(refusedMeta.ok, false)
    assert.equal(refusedMeta.reason, 'checkpoint-manifest-meta-mismatch')

    // A resident manifest taken from another checkpoint, under this generation's meta, is refused.
    const foreign = makeScenario(161).store
    assert.equal(foreign.meta.activeCheckpoint, active)
    const foreignManifest = {
        ...residentOf(store, payload),
        checkpoints: {...store.checkpoints, [active]: foreign.checkpoints[active]}
    }
    const refusedManifest = wal.projectKeyedRowFromResidentStore(foreignManifest, meta, options)
    assert.equal(refusedManifest.ok, false)
    assert.equal(refusedManifest.reason, 'checkpoint-manifest-meta-mismatch')
})

register('the resident index examines each tail record once, then reads only the matching records', () => {
    const {store, keys} = makeScenario(170)
    const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
    const resident = residentOf(store, payload)
    const total = tailRecordTotal(store)
    assert.ok(total > 0)

    // First read over this copy indexes the whole tail once.
    const first = wal.projectKeyedRowFromResidentStore(resident, meta, {baseKey: BASE, area: 'queue', key: keys[0], codec})
    assert.equal(first.ok, true)
    assert.equal(first.scannedRecords, total)

    // Every later read, for any key, examines nothing new: it touches only the matching records.
    const matchesByKey = new Map()
    for (const record of store.wal[store.meta.activeCheckpoint].segments.flatMap(segment => segment.records)) {
        const id = `${record.area}\u0000${record.key}`
        matchesByKey.set(id, (matchesByKey.get(id) || 0) + 1)
    }
    for (const area of AREAS) {
        for (const key of keys) {
            const read = wal.projectKeyedRowFromResidentStore(resident, meta, {baseKey: BASE, area, key, codec})
            assert.equal(read.ok, true)
            assert.equal(read.scannedRecords, 0, `${area} ${key} re-scanned the tail`)
            assert.equal(read.tailRecords, matchesByKey.get(`${area}\u0000${key}`) || 0, `${area} ${key} matches`)
        }
    }
})

register('a null resident copy refuses without touching the store, so the caller falls back to storage', () => {
    // The resident cache is null after a switch to an empty checkpoint (no committed segments).
    const {store, keys} = makeScenario(180)
    const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
    const options = {baseKey: BASE, area: 'queue', key: keys[0], codec}
    for (const resident of [null, undefined]) {
        const refused = wal.projectKeyedRowFromResidentStore(resident, meta, options)
        assert.equal(refused.ok, false)
        assert.equal(refused.reason, 'resident-missing')
    }
    // The storage path still answers the same key, so the fallback is complete.
    const fromStorage = wal.projectKeyedRowFromStored(payload, options)
    assert.equal(fromStorage.ok, true)
})

register('keyed read plan asks for the meta key and extra defaults, then the row keys of the active slot', () => {
    const plan = wal.planKeyedRowReads(null, ['k1'], {
        baseKey: BASE,
        metaKey: `${BASE}.meta`,
        extraDefaults: {'extra.one': 0}
    })
    assert.equal(plan[`${BASE}.meta`], null)
    assert.equal(plan['extra.one'], 0)
    assert.deepEqual(Object.keys(plan).sort(), [`${BASE}.meta`, 'extra.one'].sort())
})

register('keyed projection of an empty snapshot returns no rows and no failure', () => {
    assert.deepEqual(wal.projectKeyedRows({}, [], {baseKey: BASE}), {ok: true, reason: '', rows: {}})
})

register('keyed projection reports the first row reason it cannot project, without partial rows', () => {
    const result = wal.projectKeyedRows({}, ['', 'never-read'], {baseKey: BASE})
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'missing-area-or-key')
    assert.deepEqual(result.rows, {})
})

register('the queue WAL sequence fingerprint is equal for identical meta and differs when nextSeq moves', () => {
    const {store} = makeScenario(90)
    const payload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE, writeCheckpoints: true})
    const meta = payload[wal.getSegmentedWalMetaKey(BASE)]
    const copy = JSON.parse(JSON.stringify(meta))
    const advanced = {...copy, nextSeq: Number(meta.nextSeq) + 1}
    assert.equal(wal.getQueueWalSeqFingerprint(meta), wal.getQueueWalSeqFingerprint(copy))
    assert.notEqual(wal.getQueueWalSeqFingerprint(meta), wal.getQueueWalSeqFingerprint(advanced))
    assert.equal(wal.getQueueWalSeqFingerprint(null), null)
})

;(async () => {
    for (const [name, fn] of cases) await run(name, fn)
})().catch(() => {
    process.exitCode = 1
})
