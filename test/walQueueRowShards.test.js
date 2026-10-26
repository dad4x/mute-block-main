const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const wal = require('../shared/js/walSnapshotStore')
const {makeQueueWalRowShardTail} = require('../shared/js/swQueueWalRowShard')

function test(name, fn) {
    return Promise.resolve().then(fn).then(() => console.log(`ok - ${name}`), error => {
        console.error(`not ok - ${name}`)
        throw error
    })
}

const codec = {
    name: 'gzip',
    compress: bytes => zlib.gzipSync(bytes),
    decompress: bytes => zlib.gunzipSync(bytes)
}

const BASE = 'mbQueueShards'
const HASH_READ_RANGE = 10 // the hydrate atomic read fetches shard indexes 0 to 9 of each slot

// Rows that have been stamped into shards with holes, and with ids past the atomic read's range.
function makeStampedQueue() {
    const tail = makeQueueWalRowShardTail({budgetBytes: 220, enabled: true})
    const queue = {}
    for (let id = 0; id < 40; id += 1) {
        const href = `https://www.quora.com/profile/Queue-${id}`
        queue[href] = tail.stamp(null, {status: 'queued', attemptId: `a-${id}`, attemptNumber: 1, profileHref: href, seq: id})
    }
    // Completing the rows in the early shards empties them, so the ids that remain start later and have holes.
    for (const href of Object.keys(queue)) {
        if (queue[href].shard <= 3) queue[href] = {...queue[href], status: 'succeeded', terminalAt: 1}
    }
    return {queue, tailShard: tail.tailState().id}
}

function writeSlot(store, state, seq, shardOf) {
    const written = wal.writeInactiveCheckpoint(store, state, {
        snapshotSeq: seq, snapshotEpoch: 1, createdAt: seq, codec, codecName: codec.name, shardOf,
        rememberedSlots: {A: null, B: null}
    })
    const payload = wal.buildSegmentedWalStoragePayload(written.store, {
        baseKey: BASE, writeCheckpoints: true, generationsToWrite: [written.checkpointId], writePlan: written.writePlan
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, {codec})
    assert.equal(activated.activated, true, activated.reason)
    return {store: activated.store, checkpointId: written.checkpointId, payload}
}

// The keys the hydrate atomic read takes: the meta, both manifests, and the shard indexes 0 to 9 of each slot.
function atomicReadKeys(storage) {
    const keys = [wal.getSegmentedWalMetaKey(BASE)]
    for (const id of ['A', 'B']) {
        keys.push(wal.getSegmentedWalCheckpointKey(BASE, id))
        keys.push(...wal.getSegmentedWalCheckpointShardKeys(BASE, id, HASH_READ_RANGE))
    }
    return Object.fromEntries(keys.map(key => [key, storage[key] === undefined ? null : storage[key]]))
}

async function main() {
    await test('an arrival checkpoint with sparse shard ids cannot be read from the atomic read alone', async () => {
        const {queue} = makeStampedQueue()
        const shardIds = [...new Set(Object.values(queue).map(row => row.shard))].sort((a, b) => a - b)
        assert.ok(shardIds.some(id => id >= HASH_READ_RANGE), 'the fixture has shard ids past the atomic read range')
        const store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const written = writeSlot(store, {queue, completed: {}}, 1, (area, key, entry) => entry?.shard ?? 0)
        const atomic = atomicReadKeys(written.payload)
        const read = wal.readStoredCheckpoint(atomic, BASE, written.checkpointId)
        assert.equal(read.ok, false, 'the shards past the range are missing from the atomic read')
    })

    await test('the missing arrival shard keys are named by the manifest, and with them the slot reads back exactly', async () => {
        const {queue} = makeStampedQueue()
        const store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const written = writeSlot(store, {queue, completed: {}}, 1, (area, key, entry) => entry?.shard ?? 0)
        const atomic = atomicReadKeys(written.payload)
        const missing = wal.getArrivalShardKeysMissingFromStored(atomic, BASE, written.checkpointId)
        assert.ok(missing.length > 0, 'the manifest names shards the atomic read did not take')
        for (const key of missing) assert.ok(!(key in atomic), 'only keys the atomic read lacks are named')
        const full = {...atomic}
        for (const key of missing) full[key] = written.payload[key]
        const read = wal.readStoredCheckpoint(full, BASE, written.checkpointId)
        assert.equal(read.ok, true, read.reason)
        const decoded = wal.decodeCheckpointSnapshot(read.checkpoint, {codec})
        assert.equal(decoded.ok, true, decoded.reason)
        assert.deepEqual(decoded.state.queue, queue)
    })

    await test('a hash checkpoint names no extra shards, because its ids are the range the atomic read already takes', async () => {
        const store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const queue = {}
        for (let id = 0; id < 20; id += 1) queue[`https://www.quora.com/profile/Hash-${id}`] = {status: 'queued', seq: id}
        const written = writeSlot(store, {queue, completed: {}}, 1, undefined)
        const atomic = atomicReadKeys(written.payload)
        assert.deepEqual(wal.getArrivalShardKeysMissingFromStored(atomic, BASE, written.checkpointId), [])
    })

    await test('after a shard is completed and its id is cleared, the next checkpoint still names only shards it lists', async () => {
        const {queue} = makeStampedQueue()
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const first = writeSlot(store, {queue, completed: {}}, 1, (area, key, entry) => entry?.shard ?? 0)
        store = first.store
        const second = writeSlot(store, {queue, completed: {}}, 2, (area, key, entry) => entry?.shard ?? 0)
        const atomic = atomicReadKeys({...first.payload, ...second.payload})
        const missing = wal.getArrivalShardKeysMissingFromStored(atomic, BASE, second.checkpointId)
        const listed = wal.getCheckpointShardIds(wal.getCheckpointManifest(second.store.checkpoints[second.checkpointId]))
        assert.equal(missing.length, listed.filter(index => index >= HASH_READ_RANGE).length, 'one key per listed id past the range, and no others')
    })

    console.log('queue row shards in the WAL: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
