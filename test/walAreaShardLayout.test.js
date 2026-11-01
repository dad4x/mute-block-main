const assert = require('node:assert/strict')
const wal = require('../shared/js/walSnapshotStore')

const BASE = 'wal'
const AREAS = ['queue', 'completed', 'runs']

function test(name, fn) {
    return Promise.resolve().then(fn).then(() => console.log(`ok - ${name}`), error => {
        console.error(`not ok - ${name}`)
        throw error
    })
}

// Entries carry their area-local shard id. The partition rule is the one sw.js uses: each area's local id, in that area's namespace.
function areaShardOf(area, key, entry) {
    return wal.checkpointAreaShardId(area, entry.local)
}

function makeState({queue = {}, completed = {}, runs = {}} = {}) {
    return {queue, completed, runs}
}

function identitiesOf(checkpoint) {
    return checkpoint?.format === wal.CHECKPOINT_SHARD_FORMAT
        ? checkpoint.shards.map(shard => ({index: shard.index, shardStateHash: shard.shardStateHash}))
        : null
}

function identitiesInStorage(storage, checkpointId) {
    const manifest = storage[wal.getSegmentedWalCheckpointKey(BASE, checkpointId)] || null
    if (!manifest || manifest.format !== wal.CHECKPOINT_SHARD_FORMAT) return null
    return manifest.shards.map(shard => ({index: shard.index, shardStateHash: shard.shardStateHash}))
}

// Writes one checkpoint into the inactive slot, the way sw.js does: the payload, then activation. Returns the store and the payload.
function writeAndActivate(store, state, {seq, dropShardIds = [], remembered = null} = {}) {
    const rememberedSlots = remembered || {A: identitiesOf(store.checkpoints?.A), B: identitiesOf(store.checkpoints?.B)}
    const written = wal.writeInactiveCheckpoint(store, state, {
        snapshotSeq: seq,
        snapshotEpoch: 1,
        createdAt: seq,
        shardOf: areaShardOf,
        rememberedSlots,
        dropShardIds
    })
    const payload = wal.buildSegmentedWalStoragePayload(written.store, {
        baseKey: BASE,
        writeCheckpoints: true,
        generationsToWrite: [written.checkpointId],
        writePlan: written.writePlan
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, {})
    assert.equal(activated.activated, true, activated.reason)
    return {store: activated.store, slot: written.checkpointId, payload, checkpoint: written.checkpoint}
}

function applyPayload(storage, payload) {
    for (const [key, value] of Object.entries(payload)) {
        if (value === null) delete storage[key]
        else storage[key] = value
    }
    return storage
}

// A small deterministic generator, so the round trip is the same on every run.
function mulberry32(seed) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

async function main() {
    await test('a shard id names one area: the queue keeps its local ids, and the other areas are namespaced apart', async () => {
        assert.equal(wal.checkpointAreaShardId('queue', 3), 3)
        assert.equal(wal.checkpointAreaShardId('completed', 3), 1000000003)
        assert.equal(wal.checkpointAreaShardId('runs', 3), 2000000003)
        const seen = new Set()
        for (const area of AREAS) {
            for (let local = 0; local < 1000; local += 1) seen.add(wal.checkpointAreaShardId(area, local))
        }
        assert.equal(seen.size, 3000, 'no two areas share a shard id, and a local id is unique within its area')
        assert.throws(() => wal.checkpointAreaShardId('progress', 0), /no shard namespace/)
        assert.throws(() => wal.checkpointAreaShardId('queue', 1000000000), /out of range/)
        assert.throws(() => wal.checkpointAreaShardId('queue', -1), /out of range/)
    })

    await test('the partition refuses a shard that holds two areas, and an id outside its area namespace', async () => {
        const mixed = makeState({queue: {q: {local: 0}}, completed: {c: {local: 0}}})
        assert.throws(() => wal.makeShardedCheckpoint(mixed, {shardOf: () => 0}), /put areas queue and completed in shard 0/)
        const outside = makeState({completed: {c: {local: 0}}})
        assert.throws(() => wal.makeShardedCheckpoint(outside, {shardOf: () => 0}), /outside the completed namespace/)
    })

    await test('an arrival checkpoint names its layout and a per-area record of its shard ids and hashes', async () => {
        const state = makeState({
            queue: {q1: {local: 0}, q2: {local: 1}},
            completed: {c1: {local: 0}, c2: {local: 5}},
            runs: {r1: {local: 20000}}
        })
        const checkpoint = wal.makeShardedCheckpoint(state, {shardOf: areaShardOf, id: 'A', snapshotSeq: 1})
        assert.equal(checkpoint.shardLayout, 'area-v1')
        assert.deepEqual(checkpoint.areaShards.queue.shardIds, [0, 1])
        assert.deepEqual(checkpoint.areaShards.completed.shardIds, [1000000000, 1000000005])
        assert.deepEqual(checkpoint.areaShards.runs.shardIds, [2000020000])
        const manifest = wal.getCheckpointManifest(checkpoint)
        assert.equal(manifest.shardLayout, 'area-v1')
        assert.deepEqual(manifest.areaShards, checkpoint.areaShards)
        // The hash partition's manifests carry no area record, so they are as they were.
        const hashed = wal.makeShardedCheckpoint(state, {shardCount: 3, id: 'A', snapshotSeq: 1})
        assert.equal(hashed.shardLayout, undefined)
        assert.equal(hashed.areaShards, undefined)
    })

    await test('the per-area hash input is one pure text: area name, then sorted shard ids with each shard hash', async () => {
        const shards = [{index: 1, shardStateHash: 'ab'}, {index: 0, shardStateHash: 'cd'}]
        assert.equal(wal.checkpointAreaHashInput('queue', shards), '{"area":"queue","shards":[[0,"cd"],[1,"ab"]]}')
        assert.equal(wal.hashCheckpointArea('queue', shards), wal.hashCheckpointArea('queue', [...shards].reverse()), 'the order given does not matter')
        assert.notEqual(wal.hashCheckpointArea('queue', shards), wal.hashCheckpointArea('completed', shards), 'the area name is in the hash')
    })

    await test('one area changing moves only that area hash, and the overall state hash moves too', async () => {
        const base = {
            queue: {q1: {local: 0}, q2: {local: 1}},
            completed: {c1: {local: 0, v: 1}, c2: {local: 5}},
            runs: {r1: {local: 20000}}
        }
        const before = wal.makeShardedCheckpoint(makeState(base), {shardOf: areaShardOf, id: 'A', snapshotSeq: 1})
        const after = wal.makeShardedCheckpoint(makeState({...base, completed: {c1: {local: 0, v: 2}, c2: {local: 5}}}), {shardOf: areaShardOf, id: 'A', snapshotSeq: 1})
        assert.equal(after.areaShards.queue.hash, before.areaShards.queue.hash)
        assert.equal(after.areaShards.runs.hash, before.areaShards.runs.hash)
        assert.notEqual(after.areaShards.completed.hash, before.areaShards.completed.hash)
        assert.notEqual(after.stateHash, before.stateHash)
    })

    await test('a tampered per-area record is refused on read, and an intact one is accepted', async () => {
        const state = makeState({queue: {q1: {local: 0}}, completed: {c1: {local: 0}}, runs: {r1: {local: 20000}}})
        const checkpoint = wal.makeShardedCheckpoint(state, {shardOf: areaShardOf, id: 'A', snapshotSeq: 1})
        assert.equal(wal.verifyCheckpoint(checkpoint, {}).ok, true)
        const tampered = JSON.parse(JSON.stringify(checkpoint))
        tampered.areaShards.queue.hash = 'deadbeef'
        const refused = wal.verifyCheckpoint(tampered, {})
        assert.equal(refused.ok, false)
        assert.equal(refused.reason, 'checkpoint-area-hash-mismatch')
    })

    await test('a shared-layout manifest from before the upgrade still reads, and the first write after upgrade is area-v1', async () => {
        const state = makeState({queue: {q1: {local: 0}}, completed: {c1: {local: 0}}, runs: {}})
        // The shared layout: ids are not per area and the manifest has no shardLayout or areaShards.
        const legacy = wal.makeShardedCheckpoint(state, {shardCount: 3, shardIds: [0, 5, 9], id: 'A', snapshotSeq: 1})
        assert.equal(legacy.shardLayout, undefined)
        const stored = {[wal.getSegmentedWalCheckpointKey(BASE, 'A')]: wal.getCheckpointManifest(legacy)}
        for (const shard of legacy.shards) {
            stored[wal.getSegmentedWalCheckpointShardKey(BASE, 'A', shard.index)] = wal.getCheckpointShardRecord(legacy, shard)
        }
        const read = wal.readStoredCheckpoint(stored, BASE, 'A')
        assert.equal(read.ok, true, read.reason)
        const decoded = wal.decodeCheckpointSnapshot(read.checkpoint, {})
        assert.equal(decoded.ok, true, decoded.reason)
        assert.deepEqual(decoded.state, JSON.parse(JSON.stringify(state)))

        const store = {
            meta: wal.makeWalMeta({activeCheckpoint: 'A', snapshotSeq: 1}),
            checkpoints: {A: legacy, B: null},
            wal: {A: wal.makeWalGeneration({snapshotSeq: 1}), B: wal.makeWalGeneration({snapshotSeq: 0})}
        }
        store.meta.checkpoints = {A: {snapshotSeq: 1, snapshotEpoch: 0, createdAt: 0, stateHash: legacy.stateHash, shardCount: 3}}
        const written = wal.writeInactiveCheckpoint(store, state, {
            snapshotSeq: 2,
            snapshotEpoch: 1,
            createdAt: 2,
            shardOf: areaShardOf,
            rememberedSlots: {A: identitiesOf(legacy), B: null}
        })
        assert.equal(written.checkpointId, 'B')
        assert.equal(written.checkpoint.shardLayout, 'area-v1')
        assert.deepEqual(Object.keys(written.checkpoint.areaShards).sort(), ['completed', 'queue'])
    })

    await test('a dropped completed shard is one null key in its slot, and no kept shard is written when the slot is remembered', async () => {
        const full = makeState({queue: {q: {local: 0}}, completed: {c0: {local: 0}, c1: {local: 1}}, runs: {}})
        const pruned = makeState({queue: {q: {local: 0}}, completed: {c1: {local: 1}}, runs: {}})
        let result = writeAndActivate(wal.makePairedCheckpointStore({}, {snapshotSeq: 0}), full, {seq: 1})
        const storage = applyPayload({}, result.payload)
        result = writeAndActivate(result.store, full, {seq: 2, remembered: {A: identitiesInStorage(storage, 'A'), B: identitiesInStorage(storage, 'B')}})
        applyPayload(storage, result.payload)
        const dropped = wal.checkpointAreaShardId('completed', 0)
        const remembered = {A: identitiesInStorage(storage, 'A'), B: identitiesInStorage(storage, 'B')}
        result = writeAndActivate(result.store, pruned, {seq: 3, dropShardIds: [dropped], remembered})
        const shardKeys = Object.keys(result.payload).filter(key => /\.s\d+$/.test(key))
        assert.deepEqual(shardKeys, [wal.getSegmentedWalCheckpointShardKey(BASE, result.slot, dropped)], 'one shard key, the dropped one')
        assert.equal(result.payload[wal.getSegmentedWalCheckpointShardKey(BASE, result.slot, dropped)], null)
        applyPayload(storage, result.payload)
        const read = wal.readStoredCheckpoint(storage, BASE, result.slot)
        assert.equal(read.ok, true, read.reason)
        assert.deepEqual(wal.decodeCheckpointSnapshot(read.checkpoint, {}).state, JSON.parse(JSON.stringify(pruned)))
    })

    await test('a drop with the slot not remembered still deletes the dropped key, and nothing else is left out of the write', async () => {
        const full = makeState({completed: {c0: {local: 0}, c1: {local: 1}}})
        const pruned = makeState({completed: {c1: {local: 1}}})
        const written = wal.writeInactiveCheckpoint(wal.makePairedCheckpointStore({}, {snapshotSeq: 0}), full, {
            snapshotSeq: 1, snapshotEpoch: 1, createdAt: 1, shardOf: areaShardOf, rememberedSlots: {A: null, B: null}
        })
        assert.equal(written.writePlan.removeShardIndexes.length, 0)
        const dropWritten = wal.writeInactiveCheckpoint(wal.makePairedCheckpointStore({}, {snapshotSeq: 0}), pruned, {
            snapshotSeq: 1, snapshotEpoch: 1, createdAt: 1, shardOf: areaShardOf, rememberedSlots: {A: null, B: null},
            dropShardIds: [wal.checkpointAreaShardId('completed', 0)]
        })
        assert.deepEqual(dropWritten.writePlan.removeShardIndexes, [wal.checkpointAreaShardId('completed', 0)])
        assert.equal(dropWritten.writePlan.skipShardIndexes.length, 0, 'an unremembered slot writes its shards, as before')
    })

    await test('the slot meta names non-default shard ids, so keyed reads and mirror keys find each shard of an area', async () => {
        const state = makeState({queue: {q: {local: 0}}, completed: {c: {local: 7}}, runs: {r: {local: 20000}}})
        const result = writeAndActivate(wal.makePairedCheckpointStore({}, {snapshotSeq: 0}), state, {seq: 1})
        // The meta of the activated store: the slot written is now the active one.
        const meta = wal.buildSegmentedWalStoragePayload(result.store, {baseKey: BASE, writeCheckpoints: false, generationsToWrite: []})[wal.getSegmentedWalMetaKey(BASE)]
        assert.equal(meta.activeCheckpoint, result.slot)
        const shardKeys = wal.getSegmentedWalCheckpointShardKeysForMeta(meta, BASE, result.slot)
        assert.deepEqual(shardKeys, [
            wal.getSegmentedWalCheckpointShardKey(BASE, result.slot, 0),
            wal.getSegmentedWalCheckpointShardKey(BASE, result.slot, 1000000007),
            wal.getSegmentedWalCheckpointShardKey(BASE, result.slot, 2000020000)
        ])
        // The session mirror holds the queue's shards only (area-v1): the completed and runs shards are read from disk, so they are not mirror keys.
        const manifest = wal.getCheckpointManifest(result.store.checkpoints[result.slot])
        assert.equal(manifest.shardLayout, 'area-v1')
        const mirrorKeys = wal.getQueueMirrorKeys(meta, {baseKey: BASE, manifest})
        assert.ok(mirrorKeys.includes(shardKeys[0]), 'the queue shard is a mirror key')
        assert.ok(!mirrorKeys.includes(shardKeys[1]), 'the completed shard is not a mirror key')
        assert.ok(!mirrorKeys.includes(shardKeys[2]), 'the runs shard is not a mirror key')
        // Every shard the meta names is in the superset, which is what a rebuild reads before the manifest decides the write set.
        const superset = wal.getQueueMirrorSupersetKeys(meta, {baseKey: BASE})
        for (const key of shardKeys) assert.ok(superset.includes(key), `${key} is in the superset`)
        assert.equal(wal.getQueueMirrorKeys(meta, {baseKey: BASE}), null, 'a mirror key set needs the active manifest')
        const defaults = wal.buildSegmentedWalStorageDefaults(meta, {baseKey: BASE})
        for (const key of shardKeys) assert.ok(Object.prototype.hasOwnProperty.call(defaults, key), `${key} is a storage default`)
    })

    await test('a seeded round trip: random states with drops write, read back, and leave no orphan shard key in the slot', async () => {
        const random = mulberry32(20261027)
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0})
        const storage = {}
        const completedIds = new Set()
        let seq = 0
        for (let round = 0; round < 60; round += 1) {
            const state = makeState({
                queue: Object.fromEntries(Array.from({length: Math.floor(random() * 6)}, (_, index) => [`q${index}`, {local: Math.floor(random() * 4)}])),
                completed: Object.fromEntries(Array.from({length: Math.floor(random() * 12)}, (_, index) => {
                    const local = Math.floor(random() * 30)
                    completedIds.add(local)
                    return [`c${round}-${index}`, {local}]
                })),
                runs: Object.fromEntries(Array.from({length: Math.floor(random() * 4)}, (_, index) => [`r${index}`, {local: 20000 + Math.floor(random() * 3)}]))
            })
            const dropShardIds = [...completedIds].filter(() => random() < 0.2).map(local => wal.checkpointAreaShardId('completed', local))
            seq += 1
            const remembered = {A: identitiesInStorage(storage, 'A'), B: identitiesInStorage(storage, 'B')}
            const result = writeAndActivate(store, state, {seq, dropShardIds, remembered})
            applyPayload(storage, result.payload)
            store = result.store

            const manifest = storage[wal.getSegmentedWalCheckpointKey(BASE, result.slot)]
            const listed = manifest.shards.map(shard => wal.getSegmentedWalCheckpointShardKey(BASE, result.slot, shard.index)).sort()
            const present = Object.keys(storage).filter(key => key.startsWith(`${BASE}.checkpoint.${result.slot}.s`)).sort()
            assert.deepEqual(present, listed, `round ${round}: the slot keeps exactly the shards its manifest lists`)
            const read = wal.readStoredCheckpoint(storage, BASE, result.slot)
            assert.equal(read.ok, true, `round ${round}: ${read.reason}`)
            const decoded = wal.decodeCheckpointSnapshot(read.checkpoint, {})
            assert.equal(decoded.ok, true, `round ${round}: ${decoded.reason}`)
            assert.deepEqual(decoded.state, JSON.parse(JSON.stringify(state)), `round ${round}: the state reads back`)
        }
    })

    console.log('area shard layout: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
