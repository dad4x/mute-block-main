// Queue read facade (docs/queue-storage-layering.md, Phase 2-3).
//
// This is the one seam for queue authority reads in the worker. Every caller reads through the object this
// builds, so the storage path behind a read can change (resident authority, mirror, storage) without touching
// callers. The method names match the reader that sw.js has always used, so no caller had to change.
//
// Each method passes its arguments through to the delegate given for it and returns the delegate's result
// unchanged. The facade adds no promise chains and no defaults of its own, so the delegate's behavior is the
// behavior of the read.

const QUEUE_READ_METHODS = [
    'full',
    'runs',
    'runsProgress',
    'runsEvents',
    'runsEventsProgress',
    'runsPending',
    'runsProgressPendingNuked',
    'runsScopedProgress',
    'runsScopedProgressForMutation',
    'reconcile',
    'completedRow',
    'completedRecent',
    'currentAuthority',
    'row',
    'rows',
    'item',
    'actionRows'
]

function createQueueWalReadFacade(deps = {}) {
    const facade = {}
    for (const name of QUEUE_READ_METHODS) {
        const delegate = deps[name]
        // A missing delegate is a wiring mistake, so fail when the facade is built, not on the first read.
        if (typeof delegate !== 'function') {
            throw new Error(`createQueueWalReadFacade: no delegate for "${name}"`)
        }
        facade[name] = (...args) => delegate(...args)
    }
    return facade
}

module.exports = {
    QUEUE_READ_METHODS,
    createQueueWalReadFacade
}
