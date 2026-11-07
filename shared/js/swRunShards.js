// Run shards (25 Oct, owner decision): a run's shard is its time shard. A time shard is the span of time its creation falls in
// (RUN_SHARD_SPAN_MS, one day), so the shards are ordered by time, the same way the completed log's shards are ordered by completion.
// A new run carries the shard it was created into (stampRunShard). The runs are log records, so a dropped shard leaves as one
// map.dropShard record per shard in the write that drops it (runShardDropRecords), not one map.remove per run.
//
// Retention works on whole time shards, oldest first, and has one limit: the count. Runs are not dropped by age (owner decision, 26 Oct);
// the completed history keeps its own 90-day and 10,000-row limits. While the run count is over RUN_RETENTION_MAX_COUNT (700), the
// oldest shards are dropped. The count is loose by up to one shard, as the cap is a shard boundary, not an exact count.
// Two rules keep this safe under the count limit:
//   - a shard that holds a run a queue row still refers to is never dropped, so a live queue never loses its run;
//   - the newest shard is never dropped.
// A run with no shard (one written before the shards were time-based) is in shard 0, the oldest. A run that already carries a shard
// keeps it, so a run's shard never moves after it is written.

const {RUN_SHARD_SPAN_MS} = require('./swRunsWal')

const RUN_SHARD_DEFAULT = 0
const RUN_AREA_NAME = 'runs'

function runShardIdOf(run) {
    const shard = run?.runShard
    return Number.isInteger(shard) && shard >= 0 ? shard : RUN_SHARD_DEFAULT
}

// The shard of a point in time: the span it falls in. A time that is not a positive number has no span of its own, so it is
// read as time 0 (the oldest shard).
function runShardForTime(timeMs = 0, spanMs = RUN_SHARD_SPAN_MS) {
    const time = Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0
    return Math.floor(time / spanMs)
}

// The time a run is filed under: its creation time, or `nowMs` when the run has none.
function runTimeOf(run, nowMs = 0) {
    const created = Number(run?.createdAt)
    return Number.isFinite(created) && created > 0 ? created : nowMs
}

// The run with its shard. A run that already has a shard is returned as it was given. A new run takes the shard of its creation time,
// and `nowMs` stands in for a run that has no creation time.
function stampRunShard(run = null, nowMs = 0, spanMs = RUN_SHARD_SPAN_MS) {
    if (!run || typeof run !== 'object') return run
    if (Number.isInteger(run.runShard) && run.runShard >= 0) return run
    return {...run, runShard: runShardForTime(runTimeOf(run, nowMs), spanMs)}
}

// The run a write stores. A run already in the resident map keeps the shard it has, whatever shard the caller's copy carries. A new run
// takes its time shard (stampRunShard). A resident run with no shard stays without one, so it is still in shard 0.
function keepOrStampRunShard(run = null, previous = null, nowMs = 0, spanMs = RUN_SHARD_SPAN_MS) {
    if (!run || typeof run !== 'object') return run
    if (!previous || typeof previous !== 'object') return stampRunShard(run, nowMs, spanMs)
    if (Number.isInteger(previous.runShard) && previous.runShard >= 0) return {...run, runShard: previous.runShard}
    return run
}

// The shard ids to drop, oldest first, under the count limit (see the header). `runs` is not changed. `maxRuns` 0 turns the limit off.
// A run's age is not read here: a run is kept while the count is at or under `maxRuns`, however old it is.
function selectRunShardsToDrop(runs = {}, {maxRuns = 0, referencedRunIds = new Set()} = {}) {
    const countByShard = new Map()
    const referencedShards = new Set()
    for (const [id, run] of Object.entries(runs || {})) {
        const shard = runShardIdOf(run)
        countByShard.set(shard, (countByShard.get(shard) || 0) + 1)
        if (referencedRunIds.has(id)) referencedShards.add(shard)
    }

    const shardIds = [...countByShard.keys()].sort((left, right) => left - right)
    const newest = shardIds[shardIds.length - 1]
    const protectedShard = shard => shard === newest || referencedShards.has(shard)
    const drop = new Set()

    let total = [...countByShard.values()].reduce((sum, count) => sum + count, 0)
    for (const shard of shardIds) {
        if (maxRuns <= 0 || total <= maxRuns) break
        if (protectedShard(shard)) continue
        drop.add(shard)
        total -= countByShard.get(shard)
    }
    return drop
}

// The runs map without the runs of the dropped shards. A new object.
function withoutRunShards(runs = {}, drop = new Set()) {
    const kept = {}
    for (const [id, run] of Object.entries(runs || {})) {
        if (!drop.has(runShardIdOf(run))) kept[id] = run
    }
    return kept
}

// The checkpoint's partition rule for the runs area: a run's entry goes to the shard it carries. Other areas keep the default shard here.
// The checkpoint switch names the shard in the runs namespace (sw.js queueWalCheckpointShardOf).
function runAreaShardOf(area = '', key = '', entry = null) {
    return area === RUN_AREA_NAME ? runShardIdOf(entry) : RUN_SHARD_DEFAULT
}

// The records that drop the given run shards: one map.dropShard per shard, in ascending order. Replaying one removes every run of its
// shard from the log state (applyWalRecord in walSnapshotStore.js), so a dropped shard is one record and no run needs a map.remove.
function runShardDropRecords(drop = new Set()) {
    return [...(drop || [])]
        .sort((left, right) => left - right)
        .map(shard => ({kind: 'map.dropShard', area: RUN_AREA_NAME, shardField: 'runShard', shard}))
}

module.exports = {
    stampRunShard,
    keepOrStampRunShard,
    runShardForTime,
    runTimeOf,
    selectRunShardsToDrop,
    withoutRunShards,
    runAreaShardOf,
    runShardDropRecords,
    runShardIdOf,
    RUN_SHARD_DEFAULT
}
