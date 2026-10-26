// Completed-work log shards (step 5 of the completed-log closeout plan, rules 3, 6 and 10). An archived row carries the
// completion shard it was archived into. The shard is assigned in completion order: each archive goes to the tail, and a new
// shard starts when the tail is full. The checkpoint partitions the completed log by that shard, so the oldest completions sit
// together in the oldest shards.
//
// Pruning works on whole shards. A shard is dropped when its newest completion is older than the retention. The row cap is
// counted in rows, and the cap drops the oldest shards until the count is at or under the cap, so the result is loose by up to
// one shard: the cap is a shard boundary, not an exact row count. The newest shard is never dropped by the cap.
//
// Pruning happens when a checkpoint is written, not as WAL records. The checkpoint is the snapshot the replay starts from, so a
// row that is left out of it stays out after the WAL before it is discarded. A crash before that checkpoint is saved replays the
// rows again, and the next checkpoint prunes them again, so the prune is safe to repeat.
//
// The shard id is storage layout only. Clear removes every key, shards included (eraseBlockHistoryRequested), so it needs no step here.

const COMPLETED_SHARD_DEFAULT = 0

function completedShardIdOf(row) {
    const shard = row?.completedShard
    return Number.isInteger(shard) && shard >= 0 ? shard : COMPLETED_SHARD_DEFAULT
}

function rowBytesOf(row) {
    return JSON.stringify(row || {}).length
}

function completionTimeOf(row) {
    return Number.parseInt(row?.terminalAt || row?.updatedAt || 0, 10) || 0
}

// The tail takes each new archive. `bytes` is what the tail shard holds, measured on uncompressed JSON like the queue shards.
function makeCompletedShardTail({budgetBytes = 16384, enabled = false, isEnabled = null} = {}) {
    let tail = {id: COMPLETED_SHARD_DEFAULT, bytes: 0}
    // The switch is read on each call, so a change from the Preferences page applies to the next archive.
    const on = () => (typeof isEnabled === 'function' ? isEnabled() === true : enabled === true)

    // Rebuilt from the completed map at hydrate, from the rows that already carry their shards.
    function rebuild(completed = {}) {
        if (!on()) return {...tail}
        let maxId = COMPLETED_SHARD_DEFAULT
        const bytesById = new Map()
        for (const row of Object.values(completed || {})) {
            const id = completedShardIdOf(row)
            if (id > maxId) maxId = id
            bytesById.set(id, (bytesById.get(id) || 0) + rowBytesOf(row))
        }
        tail = {id: maxId, bytes: bytesById.get(maxId) || 0}
        return {...tail}
    }

    // The archived row, with its shard. With the switch off the row is returned as it was given.
    function stamp(row = null) {
        if (!on() || !row || typeof row !== 'object') return row
        const size = rowBytesOf(row)
        if (tail.bytes > 0 && tail.bytes + size > budgetBytes) tail = {id: tail.id + 1, bytes: 0}
        tail = {id: tail.id, bytes: tail.bytes + size}
        return {...row, completedShard: tail.id}
    }

    return {rebuild, stamp, tailState: () => ({...tail})}
}

// The checkpoint's partition for the completed area. Other areas keep the default shard here: runs are small and are not
// pruned by this step.
function completedAreaShardOf(area = '', key = '', entry = null) {
    return area === 'completed' ? completedShardIdOf(entry) : COMPLETED_SHARD_DEFAULT
}

// Chooses the shards to drop. Returns the shard ids to drop, and the row count that is left. `completed` is not changed.
// `nowMs` is the time the retention is measured from, passed in so the rule is testable.
function selectCompletedShardsToPrune(completed = {}, {nowMs = 0, retentionMs = 0, maxRows = 0} = {}) {
    const rowsByShard = new Map()
    const newestByShard = new Map()
    for (const row of Object.values(completed || {})) {
        const id = completedShardIdOf(row)
        rowsByShard.set(id, (rowsByShard.get(id) || 0) + 1)
        newestByShard.set(id, Math.max(newestByShard.get(id) || 0, completionTimeOf(row)))
    }

    // A retention of 0 turns the age limit off, and a cap of 0 turns the row cap off.
    const drop = new Set()
    const cutoff = nowMs - retentionMs
    for (const [id, newest] of newestByShard) {
        if (retentionMs > 0 && newest < cutoff) drop.add(id)
    }

    // The cap: the oldest kept shards go first, and the newest kept shard is never dropped by it.
    const keptIds = [...rowsByShard.keys()].filter(id => !drop.has(id)).sort((left, right) => left - right)
    let keptRows = keptIds.reduce((total, id) => total + rowsByShard.get(id), 0)
    const newestKept = keptIds[keptIds.length - 1]
    for (const id of keptIds) {
        if (maxRows <= 0 || keptRows <= maxRows) break
        if (id === newestKept) break
        drop.add(id)
        keptRows -= rowsByShard.get(id)
    }

    return {drop, keptRows}
}

// The completed map without the rows of the dropped shards. A new object: the input is not changed.
function withoutShards(completed = {}, drop = new Set()) {
    const kept = {}
    for (const [key, row] of Object.entries(completed || {})) {
        if (!drop.has(completedShardIdOf(row))) kept[key] = row
    }
    return kept
}

module.exports = {
    makeCompletedShardTail,
    completedAreaShardOf,
    completedShardIdOf,
    selectCompletedShardsToPrune,
    withoutShards,
    COMPLETED_SHARD_DEFAULT
}
