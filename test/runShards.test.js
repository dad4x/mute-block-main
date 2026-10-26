const assert = require('node:assert/strict')
const {runsChangeRecords, RUN_RETENTION_MAX_COUNT, RUN_SHARD_SPAN_MS} = require('../shared/js/swRunsWal')
const runShards = require('../shared/js/swRunShards')

const DAY = 24 * 60 * 60 * 1000

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

// `perDay` runs for each of `days` consecutive days, ending today, with the day's shard. Day k (0 is the oldest) is created at
// dayStart + k * DAY + offset, so its time shard is dayStart / DAY + k.
function makeDailyRuns(days, perDay, todayStartMs) {
    const runs = {}
    for (let day = 0; day < days; day += 1) {
        for (let index = 0; index < perDay; index += 1) {
            const id = `day-${day}-run-${index}`
            const createdAt = todayStartMs - (days - 1 - day) * DAY + 1000 + index
            runs[id] = {id, createdAt, runShard: runShards.runShardForTime(createdAt)}
        }
    }
    return runs
}

const TODAY_START = Math.floor(Date.UTC(2026, 9, 25) / DAY) * DAY

async function main() {
    await test('the run cap is 700 runs and a shard is one day', async () => {
        assert.equal(RUN_RETENTION_MAX_COUNT, 700)
        assert.equal(RUN_SHARD_SPAN_MS, DAY)
    })

    await test('a run takes the time shard of its creation: the day its creation time falls in', async () => {
        assert.equal(runShards.runShardForTime(0), 0)
        assert.equal(runShards.runShardForTime(DAY - 1), 0)
        assert.equal(runShards.runShardForTime(DAY), 1)
        const stamped = runShards.stampRunShard({id: 'r', createdAt: 3 * DAY + 5}, 99 * DAY)
        assert.equal(stamped.runShard, 3)
        assert.equal(stamped.id, 'r')
    })

    await test('two runs created on the same day share a shard, and a run on the next day takes the next one', async () => {
        const morning = runShards.stampRunShard({id: 'a', createdAt: 10 * DAY + 1}, 0)
        const evening = runShards.stampRunShard({id: 'b', createdAt: 10 * DAY + DAY - 1}, 0)
        const nextDay = runShards.stampRunShard({id: 'c', createdAt: 11 * DAY}, 0)
        assert.equal(morning.runShard, 10)
        assert.equal(evening.runShard, 10)
        assert.equal(nextDay.runShard, 11)
    })

    await test('a run with no creation time takes the shard of the time it is written', async () => {
        assert.equal(runShards.stampRunShard({id: 'r'}, 7 * DAY + 3).runShard, 7)
        assert.equal(runShards.stampRunShard({id: 'r', createdAt: 0}, 7 * DAY + 3).runShard, 7)
    })

    await test('a run that already has a shard keeps it, and is returned as it was given', async () => {
        const run = {id: 'r', createdAt: 9 * DAY, runShard: 7}
        assert.equal(runShards.stampRunShard(run, 20 * DAY), run)
        assert.equal(runShards.runShardIdOf({id: 'old'}), 0, 'a run with no shard is in shard 0')
    })

    await test('a resident run keeps its shard whatever the caller copy carries; a new run takes its time shard', async () => {
        const resident = {id: 'r', createdAt: 2 * DAY, runShard: 2}
        assert.equal(runShards.keepOrStampRunShard({id: 'r', createdAt: 2 * DAY, status: 'x'}, resident, 99 * DAY).runShard, 2)
        assert.equal(runShards.keepOrStampRunShard({id: 'r', createdAt: 9 * DAY}, resident, 99 * DAY).runShard, 2, 'the caller copy cannot move it')
        const legacy = {id: 'old', createdAt: 2 * DAY}
        assert.equal(runShards.keepOrStampRunShard({id: 'old'}, legacy, 99 * DAY).runShard, undefined, 'a resident run with no shard stays without one')
        assert.equal(runShards.keepOrStampRunShard({id: 'new', createdAt: 5 * DAY + 1}, undefined, 99 * DAY).runShard, 5)
    })

    await test('under the cap and with no time limit, nothing is dropped', async () => {
        assert.equal(runShards.selectRunShardsToDrop(makeRuns(700), {maxRuns: 700}).size, 0)
        assert.equal(runShards.selectRunShardsToDrop(makeDailyRuns(8, 10, TODAY_START), {maxRuns: 0, retentionMs: 0}).size, 0)
    })

    await test('over the cap, the oldest whole shards go until the count is at or under it', async () => {
        // Ten shards of 100 runs: 1000 runs, cap 700. Shards 0 and 1 go, which leaves 800: loose by a shard, as the cap is.
        const runs = makeRuns(1000, index => Math.floor(index / 100))
        const drop = runShards.selectRunShardsToDrop(runs, {maxRuns: 700})
        assert.deepEqual([...drop].sort((a, b) => a - b), [0, 1, 2])
        assert.equal(Object.keys(runShards.withoutRunShards(runs, drop)).length, 700)
    })

    await test('retention by time drops the whole time shards whose newest run is older than the retention, oldest first', async () => {
        // Eight days of 10 runs, today last. A 3-day retention keeps a shard whose newest run is at or after now minus 3 days, which is
        // days 4 to 7 here. Days 0 to 3 go, oldest first.
        const runs = makeDailyRuns(8, 10, TODAY_START)
        const nowMs = TODAY_START + 1000
        const drop = runShards.selectRunShardsToDrop(runs, {nowMs, retentionMs: 3 * DAY, maxRuns: 0})
        const dayShard = day => TODAY_START / DAY - (7 - day)
        assert.deepEqual([...drop].sort((a, b) => a - b), [0, 1, 2, 3].map(dayShard))
        assert.equal(Object.keys(runShards.withoutRunShards(runs, drop)).length, 40)
    })

    await test('retention by time never drops the newest shard, even when it is older than the retention', async () => {
        const runs = makeDailyRuns(2, 5, TODAY_START)
        const drop = runShards.selectRunShardsToDrop(runs, {nowMs: TODAY_START + 100 * DAY, retentionMs: DAY, maxRuns: 0})
        assert.ok(!drop.has(TODAY_START / DAY), 'the newest shard stays')
        assert.ok(drop.has(TODAY_START / DAY - 1), 'the older shard goes')
    })

    await test('a shard that holds a run a queue row refers to is kept by the time limit and by the cap', async () => {
        const runs = makeDailyRuns(8, 100, TODAY_START)
        const referencedRunIds = new Set(['day-0-run-3'])
        const drop = runShards.selectRunShardsToDrop(runs, {
            nowMs: TODAY_START + 1000, retentionMs: 3 * DAY, maxRuns: 700, referencedRunIds
        })
        assert.ok(!drop.has(TODAY_START / DAY - 7), 'the oldest day holds the referenced run, so it stays')
        assert.ok(drop.has(TODAY_START / DAY - 6), 'the next oldest day goes instead')
    })

    await test('runs with no creation time are not dropped by the time limit, only by the cap', async () => {
        const runs = {
            'old-a': {id: 'old-a', runShard: 1},
            'old-b': {id: 'old-b', runShard: 1},
            'newer': {id: 'newer', createdAt: TODAY_START, runShard: TODAY_START / DAY}
        }
        const drop = runShards.selectRunShardsToDrop(runs, {nowMs: TODAY_START + DAY, retentionMs: DAY, maxRuns: 0})
        assert.equal(drop.has(1), false, 'a shard with no time is not dropped by age')
    })

    await test('a write that drops a time shard carries map.remove for each run of that shard', async () => {
        const before = makeRuns(1000, index => Math.floor(index / 100))
        const drop = runShards.selectRunShardsToDrop(before, {maxRuns: 700})
        const after = runShards.withoutRunShards(before, drop)
        const records = runsChangeRecords(before, after)
        const removed = records.filter(record => record.kind === 'map.remove').map(record => record.key).sort()
        assert.equal(removed.length, 300)
        assert.ok(removed.includes('run-0') && removed.includes('run-299') && !removed.includes('run-300'))
    })

    await test('the checkpoint partition puts a run in the shard it carries, and the other areas in the default shard', async () => {
        assert.equal(runShards.runAreaShardOf('runs', 'r', {id: 'r', runShard: 42}), 42)
        assert.equal(runShards.runAreaShardOf('runs', 'old', {id: 'old'}), 0)
        assert.equal(runShards.runAreaShardOf('queue', 'q', {runShard: 42}), 0)
    })

    console.log('run shards: all tests ran')
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
