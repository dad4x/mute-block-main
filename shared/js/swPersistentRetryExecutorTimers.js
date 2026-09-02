// Persistent-retry timer / executor-start-promise timeout bookkeeping
// extracted from sw.js (decomposition Slice 22): clearPersistentFailedRetryTimeout,
// clearPersistentFailedRetry, schedulePersistentFailedRetry,
// resetCoordinatorExecutorStartPromiseAfterTimeout, and
// clearStaleCoordinatorExecutorStartPromise.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement and the plan's caution for this slice, same shape as Slices
// 9/15/20): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`.
//
// clearPersistentFailedRetry (`void clearPersistentFailedRetryAlarm()`) and
// schedulePersistentFailedRetry's setTimeout callback
// (`void runPersistentFailedRetryTick()`) both fire-and-forget into `async`
// functions that stay resident in sw.js. Per the swBrowserSessionRuntime.js
// precedent (Slice 7: "markQuoraRuntimeActivated calling
// startQueueWakeupMetricsBackedStartupWork from here is a plain
// (non-chained, `void`-discarded) function call, not a `.then()` link, so
// it doesn't reintroduce the issue"), a void-discarded call attaches no
// continuation and therefore builds no cross-realm Promise chain -- moved
// with no special handling beyond the standard setTimeout/clearTimeout
// clock threading below.
//
// resetCoordinatorExecutorStartPromiseAfterTimeout and
// clearStaleCoordinatorExecutorStartPromise are a sharper case: both
// contain a literal `coordinatorExecutorStartPromise = Promise.resolve()`
// assignment. `coordinatorExecutorStartPromise` is also read and chained
// via `.catch().then()` by enqueueExistingExecutorForCoordinator, an
// `async` function that stays resident in sw.js (out of scope -- part of
// the async orchestration layer). If the `Promise.resolve()` literal
// executed in this module's realm, the value assigned to
// coordinatorExecutorStartPromise would be a foreign-realm (this module's,
// i.e. plain require() Node realm) promise; enqueueExistingExecutorForCoordinator's
// later `.then(() => enqueueExistingExecutorForCoordinatorOnce(...))` chain
// would then be resolving a foreign-realm promise's chain with the return
// value of an sw.js-realm async function -- a same-realm-vs-cross-realm
// mismatch that did not exist pre-slice (previously everything --
// Promise.resolve(), the .catch/.then chain, and
// enqueueExistingExecutorForCoordinatorOnce's returned promise -- lived in
// sw.js's own vm-sandboxed realm). That's exactly the class of new
// realm-crossing the architecture doc's Slice-7 refinement warns about, so
// rather than "try it and see," the `Promise.resolve()` construction itself
// stays in sw.js: threaded through as a `resetCoordinatorExecutorStartPromise`
// state mutator (deps.state, defined and executing in sw.js's own realm,
// same as the existing get/set-accessor convention used for
// quoraRuntimeActivated in swBrowserSessionRuntime.js and profileNukeProgress
// in swCoordinatorReconcileLockedMaterialization.js) rather than as a raw
// `let` these two functions would otherwise assign to directly. Everything
// else in both bodies (the staleness/threshold decision logic, the
// incrementQueueWakeupMetric/recordCoordinatorDiagnosticEvent calls, both
// already-extracted-module leaf utilities called synchronously, not
// chained) moved unchanged.
//
// Clock note: clearStaleCoordinatorExecutorStartPromise reads Date.now()
// (age-vs-staleness comparison) -- threaded through as `now: () =>
// Date.now()`. clearPersistentFailedRetryTimeout/schedulePersistentFailedRetry
// use clearTimeout/setTimeout -- threaded through as `clearTimeoutFn`/
// `setTimeoutFn`, matching the swBrowserSessionRuntime.js precedent.
//
// State ownership: persistentRetryFailedTimeout was a bare sw.js `let`
// read/written only by these three functions (nothing else in sw.js
// touched it), so per the Slice-5/21 precedent ("hide volatile state
// behind methods, don't re-expose raw bindings") it now lives as private
// closure state inside this module instead -- sw.js's old top-level `let
// persistentRetryFailedTimeout = null` was deleted.
// coordinatorExecutorStartPromise/coordinatorExecutorStartPromiseStartedAt
// stay as `let` bindings in sw.js (read/written by
// enqueueExistingExecutorForCoordinator and a diagnostics snapshot function
// that both remain resident), threaded through as get/set accessors in
// deps.state, matching the quoraRuntimeActivated convention.
//
// No already-extracted module eagerly references any of these five names
// at its own construction call site in sw.js (the only other-module
// reference found, swBootstrap.js's registerServiceWorkerListeners call,
// happens at the very end of sw.js, well after this module constructs), so
// this module constructs in place at the cluster's old source-text
// position, matching the Slice 19 precedent.

function createPersistentRetryExecutorTimers(deps = {}) {
    const {
        now: getNow = () => Date.now(),
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout
    } = deps
    const {
        PERSISTENT_FAILED_RETRY_INTERVAL_MS,
        COORDINATOR_IDLE_EXECUTOR_START_PROMISE_STALE_MS
    } = deps.constants || {}
    const {
        clearPersistentFailedRetryAlarm,
        runPersistentFailedRetryTick,
        isExecutorRuntimeIdleForPromiseLatch,
        incrementQueueWakeupMetric,
        recordCoordinatorDiagnosticEvent
    } = deps.handlers || {}
    const {
        getCoordinatorExecutorStartPromiseStartedAt,
        resetCoordinatorExecutorStartPromise
    } = deps.state || {}

    let persistentRetryFailedTimeout = null

    function clearPersistentFailedRetryTimeout() {
        if(persistentRetryFailedTimeout) {
            clearTimeoutFn(persistentRetryFailedTimeout)
            persistentRetryFailedTimeout = null
        }
    }

    function clearPersistentFailedRetry() {
        clearPersistentFailedRetryTimeout()
        void clearPersistentFailedRetryAlarm()
    }

    function schedulePersistentFailedRetry(delayMs = PERSISTENT_FAILED_RETRY_INTERVAL_MS) {
        clearPersistentFailedRetryTimeout()
        persistentRetryFailedTimeout = setTimeoutFn(() => {
            persistentRetryFailedTimeout = null
            void runPersistentFailedRetryTick()
        }, Math.max(0, Number.parseInt(delayMs, 10) || 0))
    }

    function resetCoordinatorExecutorStartPromiseAfterTimeout(reason = 'executor-start-timeout') {
        resetCoordinatorExecutorStartPromise()
        incrementQueueWakeupMetric('pump.executorStartPromiseReset')
        recordCoordinatorDiagnosticEvent(
            'coordinator-executor-start-promise-reset',
            reason || 'executor start promise reset'
        )
        return true
    }

    function clearStaleCoordinatorExecutorStartPromise(reason = 'executor-start-stale-check') {
        const startedAt = getCoordinatorExecutorStartPromiseStartedAt()
        if(!startedAt) return false
        if(!isExecutorRuntimeIdleForPromiseLatch()) return false

        const ageMs = getNow() - startedAt
        const staleMs = COORDINATOR_IDLE_EXECUTOR_START_PROMISE_STALE_MS
        if(ageMs < staleMs) return false

        resetCoordinatorExecutorStartPromise()
        incrementQueueWakeupMetric('pump.changed.clearedStaleExecutorStartPromise')
        incrementQueueWakeupMetric('pump.changed.clearedIdleStaleExecutorStartPromise')
        recordCoordinatorDiagnosticEvent(
            'coordinator-executor-start-promise-idle-stale-reset',
            reason || 'executor start promise idle stale reset',
            {ageMs, staleMs}
        )
        return true
    }

    return {
        clearPersistentFailedRetryTimeout,
        clearPersistentFailedRetry,
        schedulePersistentFailedRetry,
        resetCoordinatorExecutorStartPromiseAfterTimeout,
        clearStaleCoordinatorExecutorStartPromise
    }
}

module.exports = {
    createPersistentRetryExecutorTimers
}
