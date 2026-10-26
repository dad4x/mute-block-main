const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const wal = require('../shared/js/walSnapshotStore')
const completedShards = require('../shared/js/swCompletedShards')

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

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY
const BASE = 'mbCompleted'

// `count` completed rows that all went into one shard, completed at `terminalAt`.
function shardRows(shard, count, terminalAt, tag = 'r') {
    const rows = {}
    for (let index = 0; index < count; index += 1) {
        rows[`https://www.quora.com/profile/${tag}-${shard}-${index}`] = {
            status: 'succeeded', terminalAt, completedShard: shard, profileHref: `https://www.quora.com/profile/${tag}-${shard}-${index}`
        }
    }
    return rows
}

function merge(...maps) {
    return Object.assign({}, ...maps)
}

async function main() {
    await test('with the switch off, an archived row is returned as it was given', async () => {
        const tail = completedShards.makeCompletedShardTail({budgetBytes: 100, enabled: false})
        const row = {status: 'succeeded', terminalAt: 5}
        assert.equal(tail.stamp(row), row)
        assert.equal(row.completedShard, undefined)
    })

    await test('archives go to the tail shard in completion order, and a full tail rolls over', async () => {
        const tail = completedShards.makeCompletedShardTail({budgetBytes: 200, enabled: true})
        const ids = []
        for (let index = 0; index < 20; index += 1) ids.push(tail.stamp({status: 'succeeded', terminalAt: index, note: 'x'.repeat(20)}).completedShard)
        assert.equal(ids[0], 0)
        assert.ok(ids[ids.length - 1] > 0)
        for (let index = 1; index < ids.length; index += 1) assert.ok(ids[index] >= ids[index - 1], 'ids never go down')
    })

    await test('rebuild takes the tail from the rows that already carry their completion shards', async () => {
        const tail = completedShards.makeCompletedShardTail({budgetBytes: 200, enabled: true})
        const completed = merge(shardRows(0, 2, 1), shardRows(3, 2, 2))
        const state = tail.rebuild(completed)
        assert.equal(state.id, 3)
        assert.equal(state.bytes, Object.values(shardRows(3, 2, 2)).reduce((total, row) => total + JSON.stringify(row).length, 0))
    })

    await test('a shard is dropped when its newest completion is past the retention, and kept while one row is recent', async () => {
        const completed = merge(shardRows(0, 3, NOW - 100 * DAY), shardRows(1, 2, NOW - 95 * DAY), shardRows(1, 1, NOW - 1 * DAY, 'recent'))
        const result = completedShards.selectCompletedShardsToPrune(completed, {nowMs: NOW, retentionMs: 90 * DAY, maxRows: 10000})
        assert.deepEqual([...result.drop], [0], 'shard 0 is past retention, shard 1 has a recent row')
        assert.equal(result.keptRows, 3)
    })

    await test('the row cap drops the oldest whole shards until the count is at or under the cap, so it is loose by a shard', async () => {
        const completed = merge(shardRows(0, 4, NOW - 3 * DAY), shardRows(1, 4, NOW - 2 * DAY), shardRows(2, 4, NOW - DAY))
        const result = completedShards.selectCompletedShardsToPrune(completed, {nowMs: NOW, retentionMs: 90 * DAY, maxRows: 6})
        assert.deepEqual([...result.drop].sort(), [0, 1])
        assert.equal(result.keptRows, 4, 'the cap is a shard boundary, so the count can land under it')
    })

    await test('the cap never drops the newest shard, even when that shard alone is over the cap', async () => {
        const completed = shardRows(7, 20, NOW - DAY)
        const result = completedShards.selectCompletedShardsToPrune(completed, {nowMs: NOW, retentionMs: 90 * DAY, maxRows: 5})
        assert.equal(result.drop.size, 0)
        assert.equal(result.keptRows, 20)
    })

    await test('withoutShards removes the rows of the dropped shards and nothing else, without changing the input', async () => {
        const completed = merge(shardRows(0, 2, 1), shardRows(1, 2, 2))
        const before = JSON.stringify(completed)
        const kept = completedShards.withoutShards(completed, new Set([0]))
        assert.equal(Object.keys(kept).length, 2)
        assert.ok(Object.values(kept).every(row => row.completedShard === 1))
        assert.equal(JSON.stringify(completed), before)
    })

    await test('the completed area is partitioned by its completion shard, and other areas stay in the default shard', async () => {
        assert.equal(completedShards.completedAreaShardOf('completed', 'k', {completedShard: 4}), 4)
        assert.equal(completedShards.completedAreaShardOf('completed', 'k', {status: 'succeeded'}), 0)
        assert.equal(completedShards.completedAreaShardOf('runs', 'k', {completedShard: 4}), 0)
    })

    await test('a pruned checkpoint nulls the dropped shards in the slot it overwrites, and reads back as exactly the kept rows', async () => {
        const full = merge(shardRows(0, 3, NOW - 100 * DAY), shardRows(1, 3, NOW - 2 * DAY), shardRows(2, 3, NOW - DAY))
        const shardOf = (area, key, entry) => completedShards.completedAreaShardOf(area, key, entry)
        const identities = (store, id) => {
            const checkpoint = store.checkpoints?.[id]
            return checkpoint?.format === wal.CHECKPOINT_SHARD_FORMAT
                ? checkpoint.shards.map(shard => ({index: shard.index, shardStateHash: shard.shardStateHash}))
                : null
        }
        const write = (store, state, seq, rememberedSlots) => {
            const written = wal.writeInactiveCheckpoint(store, {queue: {}, completed: state}, {
                snapshotSeq: seq, snapshotEpoch: 1, createdAt: seq, codec, codecName: codec.name, shardOf, rememberedSlots
            })
            const payload = wal.buildSegmentedWalStoragePayload(written.store, {
                baseKey: BASE, writeCheckpoints: true, generationsToWrite: [written.checkpointId], writePlan: written.writePlan
            })
            return {store: wal.activateCheckpoint(written.store, written.checkpointId, {codec}).store, id: written.checkpointId, payload, writePlan: written.writePlan}
        }

        // Both slots hold the full log, then the prune overwrites the slot that was written first.
        const one = write(wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec}), full, 1, {A: null, B: null})
        const two = write(one.store, full, 2, {A: identities(one.store, 'A'), B: identities(one.store, 'B')})
        const {drop} = completedShards.selectCompletedShardsToPrune(full, {nowMs: NOW, retentionMs: 90 * DAY, maxRows: 10000})
        const pruned = completedShards.withoutShards(full, drop)
        const three = write(two.store, pruned, 3, {A: identities(two.store, 'A'), B: identities(two.store, 'B')})

        assert.equal(three.id, one.id, 'the prune writes the slot the first checkpoint wrote')
        const droppedKey = wal.getSegmentedWalCheckpointShardKey(BASE, three.id, 0)
        assert.equal(three.payload[droppedKey], null, 'the dropped shard is cleared in that slot')
        const storage = {...one.payload, ...two.payload, ...three.payload}
        const read = wal.readStoredCheckpoint(storage, BASE, three.id)
        assert.equal(read.ok, true, read.reason)
        const decoded = wal.decodeCheckpointSnapshot(read.checkpoint, {codec})
        assert.equal(decoded.ok, true, decoded.reason)
        assert.deepEqual(decoded.state.completed, pruned)
    })

    await test('a retention of 0 turns the age limit off, and a cap of 0 turns the row cap off', async () => {
        const old = merge(shardRows(0, 3, NOW - 1000 * DAY), shardRows(1, 3, NOW - 500 * DAY))
        const noAge = completedShards.selectCompletedShardsToPrune(old, {nowMs: NOW, retentionMs: 0, maxRows: 10000})
        assert.equal(noAge.drop.size, 0, 'no shard is dropped by age')
        const recent = merge(shardRows(0, 3, NOW - DAY), shardRows(1, 3, NOW - DAY))
        const noCap = completedShards.selectCompletedShardsToPrune(recent, {nowMs: NOW, retentionMs: 90 * DAY, maxRows: 0})
        assert.equal(noCap.drop.size, 0, 'no shard is dropped by the cap')
    })

    console.log('completed shards: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
