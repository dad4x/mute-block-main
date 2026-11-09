// Queue row shards (step 4 of the completed-log closeout plan, rules 5 and 3). Each queue row carries the shard it is stored in.
// A row that becomes queued (an enqueue, a retry or a requeue) moves to the tail shard. The move is in the row value itself,
// so the one WAL record that writes the new state also carries the new shard. Other changes keep the row's shard, so a
// completion shrinks the head and leaves the rest where it is. The checkpoint partitions rows by this shard (arrival order),
// not by a key hash.
//
// The shard id only decides storage layout. Execution order stays the queue's own (swCoordinatorRetryCandidates), so a
// move to the tail does not change which row runs next.
//
// A row with no shard (one written before the switch was on) is in shard 0. That is the explicit default: shardOf and
// the stamp both read a missing shard as 0, so no caller has to know whether a row was stamped.
//
// The size of a shard is measured on the row's uncompressed JSON. The plan's 16 KB target is compressed, so this budget
// is a proxy and is set in tunables.js.

const SHARD_ID_DEFAULT = 0

function shardIdOf(row) {
    const shard = row?.shard
    return Number.isInteger(shard) && shard >= 0 ? shard : SHARD_ID_DEFAULT
}

function rowBytesOf(row) {
    return JSON.stringify(row || {}).length
}

function sameAttempt(left = {}, right = {}) {
    return `${left.attemptId ?? ''}` === `${right.attemptId ?? ''}` &&
        `${left.attemptNumber ?? ''}` === `${right.attemptNumber ?? ''}`
}

function withShard(row, shard) {
    return row.shard === shard ? row : {...row, shard}
}

// The tail is the shard that new queued rows go to, and `bytes` is how much of it is used. It is kept in memory and rebuilt
// from the resident queue at each hydrate and each seed. A write that fails after it was stamped leaves `bytes` high, which
// only makes the tail roll over early. A shard id is a label, so an early rollover is harmless.
function makeQueueWalRowShardTail({budgetBytes = 16384, enabled = false, isEnabled = null} = {}) {
    let tail = {id: SHARD_ID_DEFAULT, bytes: 0}
    // The switch is read on each call, so a change from the Preferences page applies to the next write.
    const on = () => (typeof isEnabled === 'function' ? isEnabled() === true : enabled === true)

    // Rebuilds the tail from rows that already carry their shards: the tail is the highest shard id, and `bytes` is what
    // that shard holds.
    function rebuild(rows = {}) {
        if (!on()) return {...tail}
        let maxId = SHARD_ID_DEFAULT
        const bytesById = new Map()
        for (const row of Object.values(rows || {})) {
            const id = shardIdOf(row)
            if (id > maxId) maxId = id
            bytesById.set(id, (bytesById.get(id) || 0) + rowBytesOf(row))
        }
        tail = {id: maxId, bytes: bytesById.get(maxId) || 0}
        return {...tail}
    }

    // The row as it should be stored. With the switch off, the row is returned as it was given.
    function stamp(previousRow = null, nextRow = null) {
        if (!on() || !nextRow || typeof nextRow !== 'object') return nextRow
        // A row that is not moved keeps its shard, and only carries one forward when it had one. A row with no shard stays as it
        // is: adding a field here would make a no-op look like a change.
        const carried = Number.isInteger(previousRow?.shard) ? previousRow.shard : null

        // Not queued: a completion, an active row or a terminal row keeps its shard.
        if (nextRow.status !== 'queued') {
            if (Number.isInteger(nextRow.shard) || carried === null) return nextRow
            return withShard(nextRow, carried)
        }

        // Queued again on the same attempt (progress on a queued row): not a move, so it keeps its shard.
        if (previousRow?.status === 'queued' && sameAttempt(previousRow, nextRow)) {
            if (Number.isInteger(nextRow.shard) || carried === null) return nextRow
            return withShard(nextRow, carried)
        }

        // An enqueue, a retry or a requeue: the row goes to the tail. A new shard starts when the tail is full, so an empty
        // tail always takes at least one row.
        const size = rowBytesOf(nextRow)
        if (tail.bytes > 0 && tail.bytes + size > budgetBytes) tail = {id: tail.id + 1, bytes: 0}
        tail = {id: tail.id, bytes: tail.bytes + size}
        return withShard(nextRow, tail.id)
    }

    // The partition rule for the checkpoint writer: an entry's shard is the one its row carries.
    function shardOf(area = '', key = '', entry = null) {
        return shardIdOf(entry)
    }

    function tailState() {
        return {...tail}
    }

    return {rebuild, stamp, shardOf, tailState}
}

module.exports = {
    makeQueueWalRowShardTail,
    shardIdOf,
    SHARD_ID_DEFAULT
}
