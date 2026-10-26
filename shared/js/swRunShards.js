// Run shards: the runs cap works on whole shards, the same way the completed-work log does (completed-log closeout, rules 3 and 6).
// A new run carries the shard it was created into, assigned in creation order: each new run goes to the tail, and a new shard starts
// when the tail is full. The runs are log records, so a dropped shard leaves as map.remove records in the write that drops it.
//
// The cap is RUN_RETENTION_MAX_COUNT (hardcoded: a week at 100 a day). It counts runs, and it drops the oldest whole shards until the
// count is at or under the cap, so it is loose by up to one shard. Two rules keep this safe:
//   - a shard that holds a run a queue row still refers to is never dropped, so a live queue never loses its run;
//   - the newest shard is never dropped.
// A run with no shard (written before this step) is in shard 0, the oldest.

const RUN_SHARD_DEFAULT = 0

function runShardIdOf(run) {
    const shard = run?.runShard
    return Number.isInteger(shard) && shard >= 0 ? shard : RUN_SHARD_DEFAULT
}

function rowBytesOf(run) {
    return JSON.stringify(run || {}).length
}

// The tail takes each new run. `bytes` is what the tail shard holds, measured on uncompressed JSON like the other shards.
function makeRunShardTail({budgetBytes = 16384} = {}) {
    let tail = {id: RUN_SHARD_DEFAULT, bytes: 0}

    // Rebuilt from the runs map at hydrate: the tail is the highest shard id, and `bytes` is what that shard holds.
    function rebuild(runs = {}) {
        let maxId = RUN_SHARD_DEFAULT
        const bytesById = new Map()
        for (const run of Object.values(runs || {})) {
            const id = runShardIdOf(run)
            if (id > maxId) maxId = id
            bytesById.set(id, (bytesById.get(id) || 0) + rowBytesOf(run))
        }
        tail = {id: maxId, bytes: bytesById.get(maxId) || 0}
        return {...tail}
    }

    // The new run, with its shard. A run that already has a shard is returned as it was given.
    function stamp(run = null) {
        if (!run || typeof run !== 'object') return run
        if (Number.isInteger(run.runShard) && run.runShard >= 0) return run
        const size = rowBytesOf(run)
        if (tail.bytes > 0 && tail.bytes + size > budgetBytes) tail = {id: tail.id + 1, bytes: 0}
        tail = {id: tail.id, bytes: tail.bytes + size}
        return {...run, runShard: tail.id}
    }

    return {rebuild, stamp, tailState: () => ({...tail})}
}

// The shard ids to drop for the cap. A shard is dropped only as a whole, oldest first, while the run count is over `maxRuns`. A shard
// that holds a referenced run is skipped, and so is the newest shard. Returns the ids; `runs` is not changed.
function selectRunShardsToDrop(runs = {}, {maxRuns = 0, referencedRunIds = new Set()} = {}) {
    const countByShard = new Map()
    const referencedShards = new Set()
    for (const [id, run] of Object.entries(runs || {})) {
        const shard = runShardIdOf(run)
        countByShard.set(shard, (countByShard.get(shard) || 0) + 1)
        if (referencedRunIds.has(id)) referencedShards.add(shard)
    }
    const drop = new Set()
    let total = [...countByShard.values()].reduce((sum, count) => sum + count, 0)
    const shardIds = [...countByShard.keys()].sort((left, right) => left - right)
    const newest = shardIds[shardIds.length - 1]
    for (const shard of shardIds) {
        if (total <= maxRuns) break
        if (shard === newest || referencedShards.has(shard)) continue
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

module.exports = {
    makeRunShardTail,
    selectRunShardsToDrop,
    withoutRunShards,
    runShardIdOf,
    RUN_SHARD_DEFAULT
}
