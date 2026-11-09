const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const wal = require('../shared/js/walSnapshotStore')

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

const BASE = 'mbGc'
const PER_SHARD = 4

// The arrival policy from walArrivalShards: an entry's shard is the chunk it was stored in.
const shardOf = (area, key, entry) => entry.shard

function makeEntries(count) {
    const entries = {}
    for (let seq = 0; seq < count; seq += 1) {
        const key = `https://www.quora.com/profile/Gc-${seq}`
        entries[key] = {seq, shard: Math.floor(seq / PER_SHARD), status: 'succeeded', terminalAt: 1000 + seq}
    }
    return entries
}

function identitiesOf(store, id) {
    const checkpoint = store.checkpoints?.[id]
    if (checkpoint?.format !== wal.CHECKPOINT_SHARD_FORMAT) return null
    return checkpoint.shards.map(shard => ({index: shard.index, shardStateHash: shard.shardStateHash}))
}

function remembered(store) {
    return {A: identitiesOf(store, 'A'), B: identitiesOf(store, 'B')}
}

// Writes `count` entries into the inactive slot, as the switch does, and activates it. The payload is what storage receives.
function writeSlot(store, count, seq, rememberedSlots) {
    const written = wal.writeInactiveCheckpoint(store, {rows: makeEntries(count), note: 'gc'}, {
        snapshotSeq: seq, snapshotEpoch: 1, createdAt: seq, codec, codecName: codec.name, shardOf, rememberedSlots
    })
    const payload = wal.buildSegmentedWalStoragePayload(written.store, {
        baseKey: BASE,
        writeCheckpoints: true,
        generationsToWrite: [written.checkpointId],
        writePlan: written.writePlan
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, {codec})
    assert.equal(activated.activated, true, activated.reason)
    return {store: activated.store, checkpointId: written.checkpointId, payload, writePlan: written.writePlan}
}

function shardKeysIn(payload) {
    return Object.keys(payload).filter(key => /\.s\d\d$/.test(key))
}

function nullShardKeysIn(payload) {
    return shardKeysIn(payload).filter(key => payload[key] === null)
}

function liveShardKeysIn(payload) {
    return shardKeysIn(payload).filter(key => payload[key] !== null)
}

function slotKeys(id, shardCount) {
    const keys = [wal.getSegmentedWalCheckpointKey(BASE, id)]
    for (let index = 0; index < shardCount; index += 1) keys.push(wal.getSegmentedWalCheckpointShardKey(BASE, id, index))
    return keys
}

async function main() {
    await test('a slot that shrinks drops the shard index its new manifest no longer lists, and writes nothing else', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const first = writeSlot(store, 12, 1, {A: null, B: null})
        store = first.store
        const second = writeSlot(store, 12, 2, remembered(store))
        store = second.store
        // Both slots now hold 12 entries in 3 shards. The first slot is inactive again, and it shrinks to 8 entries in 2 shards.
        const third = writeSlot(store, 8, 3, remembered(store))
        assert.equal(third.checkpointId, first.checkpointId)
        assert.deepEqual(third.writePlan.removeShardIndexes, [2])
        assert.deepEqual(nullShardKeysIn(third.payload), [wal.getSegmentedWalCheckpointShardKey(BASE, third.checkpointId, 2)])
        assert.deepEqual(liveShardKeysIn(third.payload), [], 'shards 0 and 1 are unchanged and skipped')
    })

    await test('a slot that grows writes its new shard and removes nothing', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const first = writeSlot(store, 8, 1, {A: null, B: null})
        store = first.store
        const second = writeSlot(store, 8, 2, remembered(store))
        store = second.store
        const third = writeSlot(store, 12, 3, remembered(store))
        assert.deepEqual(third.writePlan.removeShardIndexes, [])
        assert.deepEqual(nullShardKeysIn(third.payload), [])
        assert.deepEqual(liveShardKeysIn(third.payload), [wal.getSegmentedWalCheckpointShardKey(BASE, third.checkpointId, 2)])
    })

    await test('when the slot holds no remembered shards, nothing is removed, because what storage holds is not known', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const first = writeSlot(store, 12, 1, {A: null, B: null})
        store = first.store
        const second = writeSlot(store, 12, 2, remembered(store))
        store = second.store
        const third = writeSlot(store, 8, 3, {A: null, B: null})
        assert.deepEqual(third.writePlan.removeShardIndexes, [])
        assert.deepEqual(nullShardKeysIn(third.payload), [])
    })

    await test('the removal touches only the inactive slot: no key of the active slot is in the payload', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const first = writeSlot(store, 12, 1, {A: null, B: null})
        store = first.store
        const second = writeSlot(store, 12, 2, remembered(store))
        store = second.store
        const third = writeSlot(store, 8, 3, remembered(store))
        const activeKeys = new Set(slotKeys(second.checkpointId, 3))
        const touchedActive = Object.keys(third.payload).filter(key => activeKeys.has(key))
        assert.deepEqual(touchedActive, [], 'the other slot is written by nothing in this payload')
    })

    await test('a torn write of the payload leaves the active slot readable, and a whole write leaves the new slot at its new size', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const first = writeSlot(store, 12, 1, {A: null, B: null})
        store = first.store
        const second = writeSlot(store, 12, 2, remembered(store))
        store = second.store
        const storage = {...first.payload, ...second.payload}
        const third = writeSlot(store, 8, 3, remembered(store))

        // Half the keys land, in whatever order storage applied them: the active slot is still complete.
        const keys = Object.keys(third.payload)
        const torn = {...storage}
        for (const key of keys.slice(0, Math.floor(keys.length / 2))) torn[key] = third.payload[key]
        const activeRead = wal.readStoredCheckpoint(torn, BASE, second.checkpointId)
        assert.equal(activeRead.ok, true, activeRead.reason)
        const activeDecoded = wal.decodeCheckpointSnapshot(activeRead.checkpoint, {codec})
        assert.equal(activeDecoded.ok, true, activeDecoded.reason)
        assert.deepEqual(activeDecoded.state.rows, makeEntries(12))

        // The whole payload: the new slot reads back as 8 entries, and the removed shard is absent.
        const whole = {...storage, ...third.payload}
        const newRead = wal.readStoredCheckpoint(whole, BASE, third.checkpointId)
        assert.equal(newRead.ok, true, newRead.reason)
        const newDecoded = wal.decodeCheckpointSnapshot(newRead.checkpoint, {codec})
        assert.equal(newDecoded.ok, true, newDecoded.reason)
        assert.deepEqual(newDecoded.state.rows, makeEntries(8))
        assert.equal(whole[wal.getSegmentedWalCheckpointShardKey(BASE, third.checkpointId, 2)], null)
    })

    await test('after a removal the slots are remembered at their new size, so the next identical write skips every shard', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const first = writeSlot(store, 12, 1, {A: null, B: null})
        store = first.store
        const second = writeSlot(store, 12, 2, remembered(store))
        store = second.store
        const third = writeSlot(store, 8, 3, remembered(store))
        store = third.store
        // The second slot is inactive now and still holds 3 shards. It takes the same 8 entries: shards 0 and 1 are skipped, and shard 2 goes.
        const fourth = writeSlot(store, 8, 4, remembered(store))
        assert.equal(fourth.checkpointId, second.checkpointId)
        assert.deepEqual(fourth.writePlan.removeShardIndexes, [2])
        assert.deepEqual(liveShardKeysIn(fourth.payload), [])
        store = fourth.store
        // Both slots now hold 8 entries in 2 shards, so the next write of 8 entries removes nothing and writes nothing.
        const fifth = writeSlot(store, 8, 5, remembered(store))
        assert.deepEqual(fifth.writePlan.removeShardIndexes, [])
        assert.deepEqual(nullShardKeysIn(fifth.payload), [])
        assert.deepEqual(liveShardKeysIn(fifth.payload), [])
    })

    console.log('shard gc: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
