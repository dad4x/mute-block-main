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

const BASE = 'mbChanged'
const SHARDS = 10

function makeState(changedHref = '') {
    const queue = {}
    for (let index = 0; index < 40; index += 1) {
        const href = `https://www.quora.com/profile/Changed-${index}`
        queue[href] = {status: href === changedHref ? 'active' : 'queued', seq: index}
    }
    return {queue, runs: {'run-changed': {id: 'run-changed', queued: 40}}, progress: {}}
}

// The shard identities a slot holds, as the store records them (null for a slot with no sharded checkpoint).
function identitiesOf(store, id) {
    const checkpoint = store.checkpoints?.[id]
    if (checkpoint?.format !== wal.CHECKPOINT_SHARD_FORMAT) return null
    return checkpoint.shards.map(shard => ({index: shard.index, shardStateHash: shard.shardStateHash}))
}

function remembered(store) {
    return {A: identitiesOf(store, 'A'), B: identitiesOf(store, 'B')}
}

// Writes a checkpoint into the inactive slot, as the switch does. The remembered slots say what storage holds. With reuse false, nothing
// is remembered and every shard is written.
function writeCheckpoint(store, state, seq, {reuse = true} = {}) {
    const written = wal.writeInactiveCheckpoint(store, state, {
        snapshotSeq: seq, snapshotEpoch: 1, createdAt: seq, codec, codecName: codec.name, shardCount: SHARDS,
        rememberedSlots: reuse ? remembered(store) : {}
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

async function main() {
    await test('a slot with no earlier checkpoint writes all of its shards', async () => {
        const first = writeCheckpoint(wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec}), makeState(), 1)
        assert.equal(shardKeysIn(first.payload).length, SHARDS)
        assert.deepEqual(first.writePlan.skipShardIndexes, [])
    })

    await test('a later checkpoint writes only the shard that changed, when the slot still holds the same shards', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const one = writeCheckpoint(store, makeState(), 1)
        store = one.store
        const two = writeCheckpoint(store, makeState(), 2)
        store = two.store
        // The slot that holds checkpoint one is written again: nothing changed, so no shard is written.
        const unchanged = writeCheckpoint(store, makeState(), 3)
        assert.equal(shardKeysIn(unchanged.payload).length, 0, 'an unchanged state writes no shard')
        store = unchanged.store
        // One profile changes: its shard is the only one written in that slot.
        const changed = writeCheckpoint(store, makeState('https://www.quora.com/profile/Changed-7'), 4)
        assert.equal(shardKeysIn(changed.payload).length, 1, 'one changed profile writes one shard')
    })

    await test('merged storage reads back the state that the last checkpoint holds', async () => {
        const changedState = makeState('https://www.quora.com/profile/Changed-7')
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const storage = {}
        const steps = [makeState(), makeState(), makeState(), changedState]
        let last = null
        steps.forEach((state, index) => {
            last = writeCheckpoint(store, state, index + 1)
            store = last.store
            Object.assign(storage, last.payload)
        })
        const stored = wal.readStoredCheckpoint(storage, BASE, last.checkpointId)
        assert.equal(stored.ok, true, stored.reason)
        const decoded = wal.decodeCheckpointSnapshot(stored.checkpoint, {codec})
        assert.equal(decoded.ok, true, decoded.reason)
        assert.deepEqual(decoded.state, changedState)
    })

    await test('a switch in progress turns reuse off, so the slot is written in full', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const one = writeCheckpoint(store, makeState(), 1)
        store = one.store
        const two = writeCheckpoint(store, makeState(), 2)
        store = two.store
        // Start a write into the inactive slot without activating it: the switch is in progress.
        const pending = wal.writeInactiveCheckpoint(store, makeState(), {
            snapshotSeq: 3, snapshotEpoch: 1, createdAt: 3, codec, codecName: codec.name, shardCount: SHARDS
        })
        assert.equal(pending.store.meta.checkpointSwitch.inProgress, true)
        // A retry has the slots remembered, but the switch is still in progress, so nothing is reused.
        const retry = wal.writeInactiveCheckpoint(pending.store, makeState(), {
            snapshotSeq: 3, snapshotEpoch: 1, createdAt: 3, codec, codecName: codec.name, shardCount: SHARDS,
            rememberedSlots: remembered(pending.store)
        })
        assert.deepEqual(retry.writePlan.skipShardIndexes, [], 'nothing is reused while a switch is in progress')
        const payload = wal.buildSegmentedWalStoragePayload(retry.store, {
            baseKey: BASE, writeCheckpoints: true, generationsToWrite: [retry.checkpointId], writePlan: retry.writePlan
        })
        assert.equal(shardKeysIn(payload).length, SHARDS)
    })

    await test('a slot that is not remembered is written in full, even when its shards are unchanged', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const one = writeCheckpoint(store, makeState(), 1)
        store = one.store
        const two = writeCheckpoint(store, makeState(), 2)
        store = two.store
        // Storage was cleared (or the slot was forgotten): nothing is remembered, so nothing is skipped.
        const forgotten = writeCheckpoint(store, makeState(), 3, {reuse: false})
        assert.deepEqual(forgotten.writePlan.skipShardIndexes, [])
        assert.equal(shardKeysIn(forgotten.payload).length, SHARDS)
    })

    await test('the write plan is not written onto the checkpoint or its shard records', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const one = writeCheckpoint(store, makeState(), 1)
        store = one.store
        const two = writeCheckpoint(store, makeState(), 2)
        store = two.store
        const reused = writeCheckpoint(store, makeState(), 3)
        assert.equal(reused.writePlan.skipShardIndexes.length, SHARDS, 'the write found every shard unchanged')
        const checkpoint = reused.store.checkpoints[reused.checkpointId]
        assert.ok(checkpoint.shards.every(shard => !('reused' in shard)), 'no shard carries a reused flag')
        assert.ok(!('writePlan' in checkpoint), 'the checkpoint carries no write plan')
        // A later write of the same slot decides reuse from the remembered hashes alone.
        const later = writeCheckpoint(reused.store, makeState('https://www.quora.com/profile/Changed-7'), 4)
        assert.equal(shardKeysIn(later.payload).length, 1)
    })

    await test('a write plan names one slot, so the other slot is written in full', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const one = writeCheckpoint(store, makeState(), 1)
        store = one.store
        const two = writeCheckpoint(store, makeState(), 2)
        store = two.store
        const other = one.checkpointId === 'A' ? 'B' : 'A'
        const written = wal.writeInactiveCheckpoint(store, makeState(), {
            snapshotSeq: 3, snapshotEpoch: 1, createdAt: 3, codec, codecName: codec.name, shardCount: SHARDS,
            rememberedSlots: remembered(store)
        })
        assert.equal(written.writePlan.skipShardIndexes.length, SHARDS, 'every shard of the written slot is unchanged')
        const payload = wal.buildSegmentedWalStoragePayload(written.store, {
            baseKey: BASE, writeCheckpoints: true, generationsToWrite: [written.checkpointId, other], writePlan: written.writePlan
        })
        const indexes = Array.from({length: SHARDS}, (_, index) => index)
        const shardKeysOf = id => indexes.map(index => wal.getSegmentedWalCheckpointShardKey(BASE, id, index))
        assert.equal(shardKeysOf(written.checkpointId).filter(key => key in payload).length, 0, 'the planned slot skips its unchanged shards')
        assert.equal(shardKeysOf(other).filter(key => key in payload).length, SHARDS, 'the other slot is not in the plan, so it is written in full')
    })

    await test('a remembered shard whose hash differs is written again, and the rest are skipped', async () => {
        let store = wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec})
        const one = writeCheckpoint(store, makeState(), 1)
        store = one.store
        const two = writeCheckpoint(store, makeState(), 2)
        store = two.store
        const slots = remembered(store)
        const target = store.meta.activeCheckpoint === 'A' ? 'B' : 'A'
        // Storage holds a different hash for one shard of the target slot: that shard must be written.
        const stale = slots[target].map((identity, position) => position === 3 ? {...identity, shardStateHash: 'not-what-storage-holds'} : identity)
        const written = wal.writeInactiveCheckpoint(store, makeState(), {
            snapshotSeq: 3, snapshotEpoch: 1, createdAt: 3, codec, codecName: codec.name, shardCount: SHARDS,
            rememberedSlots: {...slots, [target]: stale}
        })
        assert.equal(written.writePlan.skipShardIndexes.length, SHARDS - 1)
        assert.ok(!written.writePlan.skipShardIndexes.includes(3))
    })

    console.log('changed shards: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
