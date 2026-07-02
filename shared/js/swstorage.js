/*
 * ARCHITECTURE: Storage subsystem boundary.
 *
 * Service-worker callers submit authoritative queue/storage updates through
 * machine-facing APIs. WAL records, segmented checkpoints, and replay are
 * implementation details hidden behind this module.
 */

const walSnapshotStore = require('./walSnapshotStore')

function createChromeLocalStorageAdapter(getStorageArea) {
    return {
        get(defaults = {}) {
            return getStorageArea().get(defaults)
        },
        set(payload = {}) {
            return getStorageArea().set(payload)
        },
        remove(keys) {
            return getStorageArea().remove(keys)
        },
        getBytesInUse(keys = null) {
            const storageArea = getStorageArea()
            if(typeof storageArea.getBytesInUse !== 'function') return Promise.resolve(0)
            return storageArea.getBytesInUse(keys)
        }
    }
}

function createSerializedStorageUpdateState() {
    let tailPromise = Promise.resolve()
    let depth = 0
    let serial = 0
    let activeToken = 0
    let activeContext = null
    const abandoned = new Set()

    function nextToken() {
        serial += 1
        return serial
    }

    function getTailPromise() {
        return tailPromise
    }

    function setTailPromise(promise = null) {
        tailPromise = promise || Promise.resolve()
        return tailPromise
    }

    function getDepth() {
        return depth
    }

    function incrementDepth() {
        depth += 1
        return depth
    }

    function decrementDepth() {
        depth = Math.max(0, depth - 1)
        return depth
    }

    function resetDepth() {
        depth = 0
    }

    function getActiveToken() {
        return Number.parseInt(activeContext?.updateToken || activeToken, 10) || 0
    }

    function getActiveRawToken() {
        return Number.parseInt(activeToken, 10) || 0
    }

    function getActiveContext() {
        return activeContext
    }

    function setActive(token = 0, context = null) {
        const previous = {
            token: activeToken,
            context: activeContext
        }
        activeToken = Number.parseInt(token, 10) || 0
        activeContext = context || null
        return previous
    }

    function restoreActive(previous = {}) {
        activeToken = Number.parseInt(previous?.token, 10) || 0
        activeContext = previous?.context || null
    }

    function clearActive() {
        activeToken = 0
        activeContext = null
    }

    function isActive(token = 0, context = null) {
        const normalizedToken = Number.parseInt(token, 10) || 0
        return !!normalizedToken &&
            activeToken === normalizedToken &&
            (!context || activeContext === context)
    }

    function abandon(token = getActiveToken()) {
        const normalizedToken = Number.parseInt(token, 10) || 0
        if(!normalizedToken) return false
        abandoned.add(normalizedToken)
        return true
    }

    function isAbandoned(token = getActiveToken()) {
        const normalizedToken = Number.parseInt(token, 10) || 0
        return !!normalizedToken && abandoned.has(normalizedToken)
    }

    function forgetAbandoned(token = 0) {
        const normalizedToken = Number.parseInt(token, 10) || 0
        return normalizedToken ? abandoned.delete(normalizedToken) : false
    }

    function getAbandonedCount() {
        return abandoned.size
    }

    function canRecoverSerializedTail(context = null, serializedTailPromise = null) {
        const updateToken = Number.parseInt(context?.updateToken, 10) || 0
        if(!updateToken) return false
        if(activeToken !== updateToken) return false
        if(activeContext !== context) return false
        if(serializedTailPromise && tailPromise !== serializedTailPromise) return false
        return true
    }

    function recoverSerializedTail(context = null) {
        const updateToken = Number.parseInt(context?.updateToken, 10) || 0
        if(!updateToken) return false
        abandon(updateToken)
        tailPromise = Promise.resolve()
        depth = 0
        clearActive()
        return true
    }

    return {
        abandon,
        canRecoverSerializedTail,
        clearActive,
        decrementDepth,
        forgetAbandoned,
        getAbandonedCount,
        getActiveContext,
        getActiveRawToken,
        getActiveToken,
        getDepth,
        getTailPromise,
        incrementDepth,
        isAbandoned,
        isActive,
        nextToken,
        recoverSerializedTail,
        resetDepth,
        restoreActive,
        setActive,
        setTailPromise
    }
}

function createSerializedStorageUpdateQueue(options = {}) {
    const state = options.state || createSerializedStorageUpdateState()
    const setTimeoutFn = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout
    const clearTimeoutFn = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout
    const nowFn = typeof options.now === 'function' ? options.now : () => Date.now()
    const defaultTimeoutMs = Math.max(1000, Number.parseInt(options.defaultTimeoutMs, 10) || 1000)
    const hooks = {
        finishCycle: typeof options.finishCycle === 'function' ? options.finishCycle : () => {},
        getJournalDetails: typeof options.getJournalDetails === 'function' ? options.getJournalDetails : context => context || {},
        getTimeoutPhase: typeof options.getTimeoutPhase === 'function' ? options.getTimeoutPhase : () => 'timeout',
        incrementMetric: typeof options.incrementMetric === 'function' ? options.incrementMetric : () => {},
        onCompleted: typeof options.onCompleted === 'function' ? options.onCompleted : () => {},
        onIdle: typeof options.onIdle === 'function' ? options.onIdle : () => {},
        onNested: typeof options.onNested === 'function' ? options.onNested : () => {},
        onQueueWait: typeof options.onQueueWait === 'function' ? options.onQueueWait : () => {},
        onTimeoutRecovery: typeof options.onTimeoutRecovery === 'function' ? options.onTimeoutRecovery : () => {},
        pushJournalEntry: typeof options.pushJournalEntry === 'function' ? options.pushJournalEntry : () => {},
        startCycle: typeof options.startCycle === 'function' ? options.startCycle : () => ({})
    }

    function enqueue(update, queueOptions = {}) {
        const timeoutMs = Math.max(1000, Number.parseInt(queueOptions.timeoutMs, 10) || defaultTimeoutMs)
        const updateToken = state.nextToken()
        const enqueuedAt = nowFn()
        const parentStorageContext = state.getActiveContext()
        const storageContext = {
            updateToken,
            reason: queueOptions.reason || '',
            enqueuedAt,
            startedAt: 0,
            finishedAt: 0,
            timedOutAt: 0,
            didTimeout: false,
            fallbackReturned: false,
            abandoned: false,
            lateWriteSuppressed: false,
            deadlineMissed: false,
            timeoutMs,
            depth: 0,
            maxNestedDepth: state.getDepth(),
            nestedUpdateCount: 0,
            currentPhase: 'beforeStart',
            timeoutPhase: '',
            timeoutRecoveryRequested: false,
            serializedTailRecovered: false,
            phaseIntervals: {},
            suppressDurableIdleResume: queueOptions.suppressDurableIdleResume === true
        }
        if(parentStorageContext) {
            parentStorageContext.nestedUpdateCount = (Number(parentStorageContext.nestedUpdateCount) || 0) + 1
            parentStorageContext.maxNestedDepth = Math.max(Number(parentStorageContext.maxNestedDepth) || 0, state.getDepth() + 1)
            hooks.onNested(parentStorageContext, storageContext)
        }

        let timeoutId = null
        let serializedTailPromise = null
        let startStorageUpdateTimeout = () => {}
        const timeoutPromise = new Promise((resolve, reject) => {
            startStorageUpdateTimeout = () => {
                if(timeoutId) return
                timeoutId = setTimeoutFn(() => {
                    state.abandon(updateToken)
                    storageContext.didTimeout = true
                    storageContext.timedOutAt = nowFn()
                    storageContext.timeoutPhase = hooks.getTimeoutPhase(storageContext)
                    hooks.incrementMetric('storageUpdate.timedOut')
                    if(storageContext.currentPhase === 'running') {
                        storageContext.tailWedged = true
                        hooks.incrementMetric('storageUpdate.tailWedged')
                        hooks.pushJournalEntry({
                            kind: 'storage',
                            name: 'storage-update-tail-wedged',
                            reason: queueOptions.reason || '',
                            result: 'timed-out',
                            resultReason: 'running-update-timed-out',
                            details: hooks.getJournalDetails(storageContext)
                        })
                    }
                    hooks.incrementMetric(storageContext.timeoutPhase)
                    hooks.incrementMetric(`storageUpdate.${storageContext.timeoutPhase}`)
                    hooks.onTimeoutRecovery(
                        storageContext,
                        `${queueOptions.reason || 'storage-update'}-timeout`,
                        serializedTailPromise
                    )
                    reject(new Error(`space-feed storage update timed out after ${timeoutMs}ms`))
                }, timeoutMs)
            }
        })
        startStorageUpdateTimeout()

        const previousUpdate = state.getTailPromise().catch(() => null)
        const cycle = hooks.startCycle(queueOptions.reason || '')
        hooks.incrementMetric('storageUpdate.started')
        const updatePromise = previousUpdate.then(async () => {
            const depth = state.incrementDepth()
            const previousActive = state.setActive(updateToken, storageContext)
            storageContext.startedAt = nowFn()
            storageContext.depth = depth
            storageContext.maxNestedDepth = Math.max(Number(storageContext.maxNestedDepth) || 0, depth)
            storageContext.queueWaitMs = storageContext.startedAt - enqueuedAt
            storageContext.currentPhase = 'running'
            hooks.onQueueWait(storageContext.queueWaitMs, storageContext)
            try {
                if(state.isAbandoned(updateToken)) {
                    storageContext.abandoned = true
                    storageContext.currentPhase = 'abandoned-before-start'
                    hooks.incrementMetric('storageUpdate.skippedAbandoned')
                    hooks.finishCycle(cycle, 'abandoned', 'skipped-before-update-body', {
                        ...hooks.getJournalDetails(storageContext),
                        depth: state.getDepth()
                    })
                    return queueOptions.failureValue ?? false
                }
                const result = await Promise.resolve().then(update)
                storageContext.finishedAt = nowFn()
                if(storageContext.finishedAt - enqueuedAt > timeoutMs && storageContext.deadlineMissed !== true) {
                    storageContext.deadlineMissed = true
                    hooks.incrementMetric('storageUpdate.deadlineMissed')
                }
                hooks.incrementMetric('storageUpdate.completed')
                hooks.onCompleted(storageContext)
                hooks.finishCycle(cycle, 'completed', '', {
                    ...hooks.getJournalDetails(storageContext),
                    depth: state.getDepth()
                })
                return result
            }
            finally {
                try {
                    if(storageContext.serializedTailRecovered !== true) {
                        state.decrementDepth()
                    }
                    else if(state.getActiveRawToken() === updateToken) {
                        state.decrementDepth()
                    }
                    if(state.getDepth() === 0) {
                        await hooks.onIdle(storageContext)
                    }
                }
                finally {
                    if(storageContext.serializedTailRecovered !== true ||
                        state.getActiveRawToken() === updateToken) {
                        state.restoreActive(previousActive)
                    }
                }
            }
        })

        const callerPromise = Promise.race([
            updatePromise,
            timeoutPromise
        ]).finally(() => {
            clearTimeoutFn(timeoutId)
        }).catch(error => {
            storageContext.fallbackReturned = true
            hooks.incrementMetric('storageUpdate.fallbackReturned')
            if(storageContext.didTimeout) {
                hooks.onTimeoutRecovery(
                    storageContext,
                    `${queueOptions.reason || 'storage-update'}-fallback`,
                    serializedTailPromise
                )
            }
            hooks.finishCycle(cycle, 'timed-out', error?.message || 'storage-update-failed', {
                ...hooks.getJournalDetails(storageContext),
                timeoutMs
            })
            return queueOptions.failureValue ?? false
        })

        updatePromise.finally(() => {
            if(state.isAbandoned(updateToken)) {
                storageContext.abandoned = true
                hooks.incrementMetric('storageUpdate.abandoned')
                hooks.pushJournalEntry({
                    kind: 'storage',
                    name: 'storage-update-abandoned',
                    reason: queueOptions.reason || '',
                    result: 'abandoned',
                    resultReason: 'completed-after-timeout',
                    details: hooks.getJournalDetails(storageContext)
                })
            }
            state.forgetAbandoned(updateToken)
        }).catch(() => null)

        serializedTailPromise = updatePromise.catch(() => null)
        state.setTailPromise(serializedTailPromise)

        return callerPromise
    }

    return {
        enqueue,
        state
    }
}

module.exports = {
    createChromeLocalStorageAdapter,
    createSerializedStorageUpdateQueue,
    createSerializedStorageUpdateState,
    ...walSnapshotStore
}
