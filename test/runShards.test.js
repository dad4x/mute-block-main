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

    await test('under the cap, nothing is dropped', async () => {
        assert.equal(runShards.selectRunShardsToDrop(makeRuns(700), {maxRuns: 700}).size, 0)
        assert.equal(runShards.selectRunShardsToDrop(makeDailyRuns(8, 10, TODAY_START), {maxRuns: 0}).size, 0)
    })

    await test('runs inside the cap are kept regardless of age: old runs are not dropped by age', async () => {
        // 30 days of 10 runs (300 runs), the oldest 30 days before today. The count is under the cap, so nothing goes, even though
        // the time options are passed: the selector no longer reads them.
        const runs = makeDailyRuns(30, 10, TODAY_START)
        const drop = runShards.selectRunShardsToDrop(runs, {maxRuns: RUN_RETENTION_MAX_COUNT, nowMs: TODAY_START + 1000 * DAY, retentionMs: DAY})
        assert.equal(drop.size, 0)
        assert.equal(Object.keys(runShards.withoutRunShards(runs, drop)).length, 300)
    })

    await test('over the cap, the oldest whole shards go until the count is at or under it', async () => {
        // Ten shards of 100 runs: 1000 runs, cap 700. Shards 0 and 1 go, which leaves 800: loose by a shard, as the cap is.
        const runs = makeRuns(1000, index => Math.floor(index / 100))
        const drop = runShards.selectRunShardsToDrop(runs, {maxRuns: 700})
        assert.deepEqual([...drop].sort((a, b) => a - b), [0, 1, 2])
        assert.equal(Object.keys(runShards.withoutRunShards(runs, drop)).length, 700)
    })

    await test('the newest shard is never dropped, even when the count is over the cap', async () => {
        // One shard of 800 runs, over the cap of 700. It is the newest shard, so it stays.
        const runs = makeRuns(800, () => 5)
        assert.equal(runShards.selectRunShardsToDrop(runs, {maxRuns: 700}).size, 0)
    })

    await test('a shard that holds a run a queue row still refers to is kept by the cap', async () => {
        // Eight days of 100 runs (800), cap 700. The oldest day holds the referenced run, so it stays and the next oldest goes.
        const runs = makeDailyRuns(8, 100, TODAY_START)
        const referencedRunIds = new Set(['day-0-run-3'])
        const drop = runShards.selectRunShardsToDrop(runs, {maxRuns: 700, referencedRunIds})
        assert.ok(!drop.has(TODAY_START / DAY - 7), 'the oldest day holds the referenced run, so it stays')
        assert.ok(drop.has(TODAY_START / DAY - 6), 'the next oldest day goes instead')
        assert.equal(drop.size, 1)
    })

    await test('a shard with no creation time is dropped by the count like any other shard', async () => {
        const runs = {
            'old-a': {id: 'old-a', runShard: 1},
            'old-b': {id: 'old-b', runShard: 1},
            'newer': {id: 'newer', createdAt: TODAY_START, runShard: TODAY_START / DAY}
        }
        const drop = runShards.selectRunShardsToDrop(runs, {maxRuns: 2})
        assert.equal(drop.has(1), true, 'the oldest shard goes to bring the count to the cap')
        assert.equal(drop.has(TODAY_START / DAY), false, 'the newest shard stays')
    })

    await test('a write that drops a time shard is one map.dropShard per shard, with no map.remove for its runs', async () => {
        const before = makeRuns(1000, index => Math.floor(index / 100))
        const drop = runShards.selectRunShardsToDrop(before, {maxRuns: 700})
        const after = runShards.withoutRunShards(before, drop)
        // The write path (sw.js takeRunsPartFromChange) diffs against the runs without the dropped shards.
        const records = [
            ...runShards.runShardDropRecords(drop),
            ...runsChangeRecords(runShards.withoutRunShards(before, drop), after)
        ]
        assert.deepEqual(records.filter(record => record.kind === 'map.remove'), [], 'no per-run removal')
        assert.deepEqual(records.filter(record => record.kind === 'map.dropShard'), [
            {kind: 'map.dropShard', area: 'runs', shardField: 'runShard', shard: 0},
            {kind: 'map.dropShard', area: 'runs', shardField: 'runShard', shard: 1},
            {kind: 'map.dropShard', area: 'runs', shardField: 'runShard', shard: 2}
        ])
    })

    await test('the map.dropShard record removes exactly the runs of its shard when replayed', async () => {
        const wal = require('../shared/js/walSnapshotStore')
        const before = makeRuns(1000, index => Math.floor(index / 100))
        const drop = runShards.selectRunShardsToDrop(before, {maxRuns: 700})
        const expected = runShards.withoutRunShards(before, drop)
        const records = runShards.runShardDropRecords(drop).map((record, index) => ({...record, seq: index + 1, id: `drop-${index}`}))
        const replayed = wal.projectSnapshot({snapshotSeq: 0, state: {runs: before}}, records).state
        assert.deepEqual(replayed.runs, expected)
    })

    await test('a run with no shard field is shard 0 when a map.dropShard record replays', async () => {
        const wal = require('../shared/js/walSnapshotStore')
        const runs = {legacy: {id: 'legacy'}, kept: {id: 'kept', runShard: 3}}
        const result = wal.applyWalRecord({runs}, {kind: 'map.dropShard', area: 'runs', shardField: 'runShard', shard: 0, seq: 1, id: 'd'}, {snapshotSeq: 0, appliedIds: new Set()})
        assert.deepEqual(Object.keys(result.state.runs), ['kept'])
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
