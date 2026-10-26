const assert = require('node:assert/strict')
const {runsChangeRecords, RUN_RETENTION_MAX_COUNT} = require('../shared/js/swRunsWal')
const runShards = require('../shared/js/swRunShards')

function test(name, fn) {
    return Promise.resolve().then(fn).then(() => console.log(`ok - ${name}`), error => {
        console.error(`not ok - ${name}`)
        throw error
    })
}

// `count` runs with shards given by `shardOf(index)`, created in index order.
function makeRuns(count, shardOf = index => Math.floor(index / 10)) {
    const runs = {}
    for (let index = 0; index < count; index += 1) runs[`run-${index}`] = {id: `run-${index}`, createdAt: 1000 + index, runShard: shardOf(index)}
    return runs
}

async function main() {
    await test('the run cap is 700 runs', async () => {
        assert.equal(RUN_RETENTION_MAX_COUNT, 700)
    })

    await test('new runs take the tail shard in creation order, and a full tail rolls over', async () => {
        const tail = runShards.makeRunShardTail({budgetBytes: 200})
        const ids = []
        for (let index = 0; index < 20; index += 1) ids.push(tail.stamp({id: `r${index}`, note: 'x'.repeat(20)}).runShard)
        assert.equal(ids[0], 0)
        assert.ok(ids[ids.length - 1] > 0)
        for (let index = 1; index < ids.length; index += 1) assert.ok(ids[index] >= ids[index - 1])
    })

    await test('a run that already has a shard keeps it', async () => {
        const tail = runShards.makeRunShardTail({budgetBytes: 200})
        const run = {id: 'r', runShard: 7}
        assert.equal(tail.stamp(run), run)
    })

    await test('rebuild takes the tail from the runs that already carry their shards', async () => {
        const tail = runShards.makeRunShardTail({budgetBytes: 200})
        const state = tail.rebuild(makeRuns(25, index => index < 10 ? 0 : 2))
        assert.equal(state.id, 2)
    })

    await test('under the cap nothing is dropped', async () => {
        assert.equal(runShards.selectRunShardsToDrop(makeRuns(700), {maxRuns: 700}).size, 0)
    })

    await test('over the cap, the oldest whole shards go until the count is at or under it', async () => {
        // Ten shards of 100 runs: 1000 runs, cap 700. Shards 0 and 1 go, which leaves 800: loose by a shard, as the cap is.
        const runs = makeRuns(1000, index => Math.floor(index / 100))
        const drop = runShards.selectRunShardsToDrop(runs, {maxRuns: 700})
        assert.deepEqual([...drop].sort((a, b) => a - b), [0, 1, 2])
        assert.equal(Object.keys(runShards.withoutRunShards(runs, drop)).length, 700)
    })

    await test('a shard that holds a referenced run is skipped, and the newest shard is never dropped', async () => {
        const runs = makeRuns(1000, index => Math.floor(index / 100))
        const drop = runShards.selectRunShardsToDrop(runs, {maxRuns: 700, referencedRunIds: new Set(['run-5'])})
        assert.ok(!drop.has(0), 'shard 0 holds the referenced run 5, so it stays')
        assert.ok(!drop.has(9), 'the newest shard stays')
        assert.ok(drop.has(1))
    })

    await test('a write that drops a shard carries map.remove for each run of that shard', async () => {
        const before = makeRuns(1000, index => Math.floor(index / 100))
        const drop = runShards.selectRunShardsToDrop(before, {maxRuns: 700})
        const after = runShards.withoutRunShards(before, drop)
        const records = runsChangeRecords(before, after)
        const removed = records.filter(record => record.kind === 'map.remove').map(record => record.key).sort()
        assert.equal(removed.length, 300)
        assert.ok(removed.includes('run-0') && removed.includes('run-299') && !removed.includes('run-300'))
    })

    console.log('run shards: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
