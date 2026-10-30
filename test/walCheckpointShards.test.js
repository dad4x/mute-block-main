const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const wal = require('../shared/js/walSnapshotStore')

const codec = {
    name: 'gzip',
    compress: bytes => zlib.gzipSync(bytes),
    decompress: bytes => zlib.gunzipSync(bytes)
}
const opts = {codec}

function makeState(count = 300) {
    const state = {queue: {}, completed: {}, runs: {}, progress: {}, events: [{kind: 'start'}, {kind: 'end'}]}
    for (let index = 0; index < count; index += 1) {
        state.queue[`https://www.quora.com/profile/P${index}`] = {status: index % 3 ? 'queued' : 'succeeded', seq: index}
        if (index % 2) state.completed[`done-${index}`] = {status: 'succeeded', terminalAt: index}
    }
    return state
}

function storeWithActiveLegacyAndEmptyInactive() {
    return wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
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

register('partition keeps every map entry in exactly one shard and merge restores the state', () => {
    const state = makeState()
    const {shardStates, areas} = wal.partitionCheckpointState(state, 10)
    assert.equal(shardStates.length, 10)
    const seen = new Set()
    for (const shardState of shardStates) {
        for (const key of Object.keys(shardState.queue)) {
            assert.equal(seen.has(key), false, `${key} appears in two shards`)
            seen.add(key)
        }
    }
    assert.equal(seen.size, Object.keys(state.queue).length)
    const merged = wal.mergeCheckpointShardStates(shardStates, areas)
    assert.equal(wal.hashState(merged), wal.hashState(state))
})

register('empty map areas and list areas survive the shard split', () => {
    const state = {queue: {}, events: [1, 2, 3], progress: {}, flag: null}
    const {shardStates, areas} = wal.partitionCheckpointState(state, 10)
    const merged = wal.mergeCheckpointShardStates(shardStates, areas)
    assert.deepEqual(merged, state)
})

register('sharded checkpoint decodes and verifies to the same state hash', () => {
    const state = makeState()
    const checkpoint = wal.makeCheckpoint(state, {id: 'A', snapshotSeq: 7, codec, codecName: codec.name, shardCount: 10})
    assert.equal(checkpoint.format, wal.CHECKPOINT_SHARD_FORMAT)
    assert.equal(checkpoint.shards.length, 10)
    const verified = wal.verifyCheckpoint(checkpoint, opts)
    assert.equal(verified.ok, true, verified.reason)
    assert.equal(wal.hashState(verified.state), wal.hashState(state))
})

register('a tampered shard payload is rejected by its shard hash', () => {
    const checkpoint = wal.makeCheckpoint(makeState(), {id: 'A', snapshotSeq: 7, codec, codecName: codec.name, shardCount: 10})
    const tampered = JSON.parse(JSON.stringify(checkpoint))
    const shard = tampered.shards.find(entry => entry.compressedBytes > 0)
    const other = tampered.shards.find(entry => entry !== shard)
    // Swap a valid payload from another shard into this slot: it decodes, but its hash does not match.
    shard.payload = other.payload
    const verified = wal.verifyCheckpoint(tampered, opts)
    assert.equal(verified.ok, false)
    assert.match(verified.reason, /checkpoint-shard-hash-mismatch|state-hash-mismatch/)
})

register('a monolithic checkpoint still decodes after the format change', () => {
    const state = makeState()
    const legacy = wal.makeCheckpoint(state, {id: 'A', snapshotSeq: 3, codec, codecName: codec.name})
    assert.equal(legacy.format, undefined)
    assert.ok(legacy.payload)
    const verified = wal.verifyCheckpoint(legacy, opts)
    assert.equal(verified.ok, true, verified.reason)
    assert.equal(wal.hashState(verified.state), wal.hashState(state))
})

register('a sharded write lays out a manifest plus one record per shard, and hydrates back to the same state', () => {
    const state = makeState()
    const written = wal.writeInactiveCheckpoint(storeWithActiveLegacyAndEmptyInactive(), state, {
        snapshotSeq: 5, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name, shardCount: 10
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, opts)
    assert.equal(activated.activated, true, activated.reason)

    const payload = wal.buildSegmentedWalStoragePayload(activated.store, {baseKey: 'mbT', writeCheckpoints: true})
    const manifest = payload[wal.getSegmentedWalCheckpointKey('mbT', written.checkpointId)]
    assert.equal(manifest.format, wal.CHECKPOINT_SHARD_FORMAT)
    assert.equal(manifest.shards.every(entry => entry.payload === undefined), true, 'manifest carries no shard payloads')
    for (const key of wal.getSegmentedWalCheckpointShardKeys('mbT', written.checkpointId, 10)) {
        assert.ok(payload[key], `missing shard record ${key}`)
    }

    const hydrated = wal.hydrateSegmentedWalStore(payload, {baseKey: 'mbT', fallbackStore: null})
    assert.equal(hydrated.ok, true, hydrated.reason)
    const recovered = wal.recoverProjectedState(hydrated.store, [], opts)
    assert.equal(recovered.recovered, true, recovered.reason)
    assert.equal(wal.hashState(recovered.projected.state), wal.hashState(state))
})

register('hydrate accepts a shard written under an earlier snapshot sequence when its content hash matches (step 2)', () => {
    const state = makeState()
    const written = wal.writeInactiveCheckpoint(storeWithActiveLegacyAndEmptyInactive(), state, {
        snapshotSeq: 5, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name, shardCount: 10
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, opts)
    const payload = wal.buildSegmentedWalStoragePayload(activated.store, {baseKey: 'mbT', writeCheckpoints: true})
    const key = wal.getSegmentedWalCheckpointShardKey('mbT', written.checkpointId, 4)
    payload[key] = {...payload[key], snapshotSeq: 99}
    const hydrated = wal.hydrateSegmentedWalStore(payload, {baseKey: 'mbT', fallbackStore: null})
    assert.equal(hydrated.ok, true, hydrated.reason)
})

register('hydrate rejects a shard record whose content hash does not match its manifest', () => {
    const state = makeState()
    const written = wal.writeInactiveCheckpoint(storeWithActiveLegacyAndEmptyInactive(), state, {
        snapshotSeq: 5, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name, shardCount: 10
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, opts)
    const payload = wal.buildSegmentedWalStoragePayload(activated.store, {baseKey: 'mbT', writeCheckpoints: true})
    const key = wal.getSegmentedWalCheckpointShardKey('mbT', written.checkpointId, 4)
    payload[key] = {...payload[key], shardStateHash: 'not-the-hash'}
    const hydrated = wal.hydrateSegmentedWalStore(payload, {baseKey: 'mbT', fallbackStore: null})
    assert.equal(hydrated.ok, false)
    assert.equal(hydrated.reason, 'checkpoint-shard-identity-mismatch')
    assert.equal(hydrated.missingKey, key)
})

register('hydrate reports a missing shard by key', () => {
    const state = makeState()
    const written = wal.writeInactiveCheckpoint(storeWithActiveLegacyAndEmptyInactive(), state, {
        snapshotSeq: 5, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name, shardCount: 10
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, opts)
    const payload = wal.buildSegmentedWalStoragePayload(activated.store, {baseKey: 'mbT', writeCheckpoints: true})
    const key = wal.getSegmentedWalCheckpointShardKey('mbT', written.checkpointId, 2)
    delete payload[key]
    const hydrated = wal.hydrateSegmentedWalStore(payload, {baseKey: 'mbT', fallbackStore: null})
    assert.equal(hydrated.ok, false)
    assert.equal(hydrated.reason, 'missing-checkpoint-shard')
    assert.equal(hydrated.missingKey, key)
})

register('a legacy active slot and a sharded inactive slot coexist and hydrate together', () => {
    const state = makeState()
    // Slot A is a legacy monolithic checkpoint, as written before this change.
    const legacyStore = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
    const legacyCheckpoint = wal.makeCheckpoint(state, {id: 'A', snapshotSeq: 2, codec, codecName: codec.name})
    legacyStore.checkpoints.A = legacyCheckpoint
    legacyStore.meta.activeCheckpoint = 'A'
    legacyStore.meta.snapshotSeq = 2
    const written = wal.writeInactiveCheckpoint(legacyStore, makeState(301), {
        snapshotSeq: 9, snapshotEpoch: 1, createdAt: 2, codec, codecName: codec.name, shardCount: 10
    })
    assert.equal(written.checkpointId, 'B')
    const activated = wal.activateCheckpoint(written.store, 'B', opts)
    assert.equal(activated.activated, true, activated.reason)
    const payload = wal.buildSegmentedWalStoragePayload(activated.store, {baseKey: 'mbT', writeCheckpoints: true})
    const hydrated = wal.hydrateSegmentedWalStore(payload, {baseKey: 'mbT', fallbackStore: null})
    assert.equal(hydrated.ok, true, hydrated.reason)
    const recovered = wal.recoverProjectedState(hydrated.store, [], opts)
    assert.equal(wal.hashState(recovered.projected.state), wal.hashState(makeState(301)))
})

register('defaults read the shard records of the active slot once its manifest records a shard count', () => {
    const meta = {
        activeCheckpoint: 'B',
        checkpoints: {B: {snapshotSeq: 9, shardCount: 10}},
        segmentedStorage: {version: 1, committedSegments: {A: 0, B: 0}}
    }
    const defaults = wal.buildSegmentedWalStorageDefaults(meta, {baseKey: 'mbT'})
    for (const key of wal.getSegmentedWalCheckpointShardKeys('mbT', 'B', 10)) {
        assert.ok(key in defaults, `defaults should include ${key}`)
    }
    const legacyMeta = {...meta, checkpoints: {B: {snapshotSeq: 9}}}
    const legacyDefaults = wal.buildSegmentedWalStorageDefaults(legacyMeta, {baseKey: 'mbT'})
    assert.equal(wal.getSegmentedWalCheckpointShardKey('mbT', 'B', 0) in legacyDefaults, false)
})

;(async () => {
    for (const [name, fn] of cases) await run(name, fn)
})().catch(() => {
    process.exitCode = 1
})
