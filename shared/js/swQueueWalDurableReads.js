// Durable reads of the completed-work log and the stored-work check (docs/queue-storage-layering.md, Phase 3 group E).
//
// These answer from the resident authority (P2). They read no storage and replay no WAL: the queue, the completed-work
// map and the paused flag are the resident copies that hydrate decoded. sw.js injects the one read they need,
// getResidentState, which passes the authority's gate first and rejects with coordinator-authority-unavailable when the
// authority cannot be loaded (P4). A reader therefore never sees an empty state for an unavailable authority.
//
// Injection rules used by the wiring in sw.js: hoisted function declarations and constants defined above the wiring
// point are passed as direct references (sortCompletedWorkRowsNewestFirst, hasStoredCoordinatorWork, the paused key).
// Anything that is a const defined later in sw.js is passed as an arrow, so it is looked up when it is called.

function createQueueWalDurableReads(deps = {}) {
    const {
        getResidentState,
        sortCompletedWorkRowsNewestFirst,
        hasStoredCoordinatorWork,
        COORDINATOR_PAUSED_KEY,
        cloneValue = value => value
    } = deps
    const injected = {
        getResidentState,
        sortCompletedWorkRowsNewestFirst,
        hasStoredCoordinatorWork
    }
    for (const name of Object.keys(injected)) {
        if (typeof injected[name] !== 'function') throw new Error('Missing queue WAL durable reads dependency: ' + name)
    }
    if (!COORDINATOR_PAUSED_KEY) throw new Error('Missing queue WAL durable reads constant')

    async function findCompletedWorkRowByKey(rowKey = '') {
        if (!rowKey) return null
        const resident = await getResidentState()
        return cloneValue(resident.completed?.[rowKey] || null)
    }

    async function getRecentCompletedWorkRows(limit = 50) {
        const limitNum = Math.max(1, Number.parseInt(limit, 10) || 50)
        const resident = await getResidentState()
        return sortCompletedWorkRowsNewestFirst(resident.completed || {}, limitNum).map(row => cloneValue(row))
    }

    // Whether the durable queue holds work the scheduler should resume: false while paused, else the queue's own check.
    async function hasUnpausedStoredCoordinatorWorkInDurableQueue(reason = 'stored-work-scheduler') {
        const resident = await getResidentState()
        if (resident.paused === true) return false
        return hasStoredCoordinatorWork(resident.queue || {})
    }

    return {
        findCompletedWorkRowByKey,
        getRecentCompletedWorkRows,
        hasUnpausedStoredCoordinatorWorkInDurableQueue
    }
}

module.exports = {
    createQueueWalDurableReads
}
