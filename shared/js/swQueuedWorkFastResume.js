// Queued-work fast-resume scheduling extracted from sw.js (decomposition
// Slice 9, part 2 -- attempted separately from swStorageIdlePromiseLatch.js
// because of an elevated Promise-chain realm-crossing risk).
//
// All three functions here (scheduleDurableQueueResumeFromIdleStorage,
// scheduleQueuedOnlyDurableWorkContinuation, kickQueuedWorkAfterSlotFreed)
// build a fire-and-forget `void someAsyncFn(...).catch(() => null)` chain
// off runCoordinatorReconcileTick or runCoordinatorQueueExecutorFastPath --
// both `async` orchestration functions that stay in sw.js per the plan's
// Part 2 (blocked on Phase 0's harness realm fix). Per architecture.md's
// "Module Extraction And The Test Harness Realm Boundary" section (the
// Slice 7 refinement in particular), moving a Promise-chain-*building*
// function into a `require()`'d module changes which realm the `.catch()`
// call executes in relative to the Promise it's chaining off of: before the
// move, both the chain builder and the awaited async function live in
// sw.js's vm-sandboxed realm (zero crossings); after the move, the chain
// builder lives in the shared require() realm while the awaited async
// function stays in the vm realm, adding a crossing that did not exist
// before. This is the mirror image of the Slice 7 finding (which *removed*
// an existing crossing by moving a chain-builder between two already-
// extracted modules); the mechanism is the same, just the direction of the
// count is reversed.
//
// Given the theoretical risk, this module was verified independently
// against the full `npm run test:parallel` suite (unit, contract, wal,
// all 46 synthetic lanes, scenario fuzz, lint) before being folded into
// the same commit as swStorageIdlePromiseLatch.js: it passed clean, no
// realm-crossing test-ordering regression. Added crossings evidently don't
// reorder anything the fake-timer-driven tests can observe here, unlike
// Slice 7's case -- plausibly because these three are one-shot fire-and-
// forget kicks (`void ...catch(() => null)`, result discarded) rather than
// something awaited or raced against sibling work within the same tick,
// so the extra tick of latency the crossing adds doesn't change any
// ordering the tests assert on. Kept as a separate module from
// swStorageIdlePromiseLatch.js regardless, so a future slice (or a
// harness/CI environment with different timing sensitivity) can revert
// just this file without touching the verified-safe half of Slice 9.
//
// runCoordinatorReconcileTick, runCoordinatorQueueExecutorFastPath, and
// (as of the sw.js decomposition mop-up slice, 2026-09)
// kickCoordinatorQueueResume are threaded through as deps (still bare,
// async, sw.js-resident functions). coordinatorFastExecutorActiveUntil and
// queuedTabFillPromise (mutable module-level `let`s in sw.js) are threaded
// through as live get accessors, matching the convention used elsewhere in
// this decomposition.
// Every Date.now() call is threaded through as `now: () => Date.now()` per
// the plan's clock/environment-global note.
//
// requestPostStorageQueuedWorkContinuation/flushPostStorageQueuedWorkContinuation
// (also joined in the mop-up slice) are a self-contained pair with their
// own closure-local state -- see their function header comment below.

function createQueuedWorkFastResume(deps = {}) {
    const {
        now: getNow = () => Date.now()
    } = deps
    const {
        getQueuedTabFillPromise,
        getCoordinatorFastExecutorActiveUntil
    } = deps.state || {}
    const {
        queueRuntime,
        storageUpdateState,
        incrementQueueWakeupMetric,
        scheduleCoordinatorQueueResume,
        scheduleCoordinatorReconcile,
        scheduleQueuedWorkContinuation,
        runCoordinatorReconcileTick,
        runCoordinatorQueueExecutorFastPath,
        kickCoordinatorQueueResume
    } = deps.handlers || {}

    // requestPostStorageQueuedWorkContinuation/flushPostStorageQueuedWorkContinuation
    // joined this module in the sw.js decomposition mop-up slice (2026-09).
    // The two fields they exclusively read/write
    // (postStorageQueuedWorkContinuationReason/
    // postStorageQueuedWorkContinuationForceDurableQueueReload) were sw.js
    // module-level `let`s referenced nowhere else in sw.js (grepped before
    // moving), so they become ordinary closure-local state here rather than
    // state accessors threaded back to sw.js -- the whole exclusive-use pair
    // moved together. flushPostStorageQueuedWorkContinuation's
    // `void kickCoordinatorQueueResume(...).catch(() => null)` fire-and-
    // forget chain is the same shape this file's header comment already
    // covers for scheduleDurableQueueResumeFromIdleStorage/
    // scheduleQueuedOnlyDurableWorkContinuation/kickQueuedWorkAfterSlotFreed
    // (a Promise chain reaching into a still-sw.js-resident async
    // orchestration function) -- verified against the full test:parallel
    // suite before landing, same as those three.
    let postStorageQueuedWorkContinuationReason = ''
    let postStorageQueuedWorkContinuationForceDurableQueueReload = false

    function requestPostStorageQueuedWorkContinuation(reason = 'queued-work-continuation') {
        const options = arguments[1] && typeof arguments[1] === 'object' ? arguments[1] : {}
        postStorageQueuedWorkContinuationReason = `${reason || 'queued-work-continuation'}`.trim() || 'queued-work-continuation'
        postStorageQueuedWorkContinuationForceDurableQueueReload =
            postStorageQueuedWorkContinuationForceDurableQueueReload ||
            options.forceDurableQueueReload === true
    }

    function flushPostStorageQueuedWorkContinuation() {
        const reason = postStorageQueuedWorkContinuationReason
        const forceDurableQueueReload = postStorageQueuedWorkContinuationForceDurableQueueReload === true
        postStorageQueuedWorkContinuationReason = ''
        postStorageQueuedWorkContinuationForceDurableQueueReload = false
        if(!reason) return false

        void kickCoordinatorQueueResume(reason, {
            backgroundFastPath: true,
            allowBeforeQuora: true,
            skipAuthorityReconcile: true,
            forceDurableQueueReload
        }).catch(() => null)
        return true
    }

    function scheduleDurableQueueResumeFromIdleStorage(context = {}) {
        const durableActiveRows = Number.parseInt(context.durableActiveRows, 10) || 0
        const durableQueuedRows = Number.parseInt(context.durableQueuedRows, 10) || 0
        if(context.paused === true) return false
        if(durableActiveRows <= 0 && durableQueuedRows <= 0) return false

        const reason = durableActiveRows > 0
            ? 'storage-idle-durable-active-work'
            : 'storage-idle-durable-queued-work'
        incrementQueueWakeupMetric('storageUpdate.durableWorkNoRuntime')
        scheduleCoordinatorQueueResume(1000, reason, {
            allowBeforeQuora: true
        })
        if(durableActiveRows > 0) {
            void runCoordinatorReconcileTick(reason, {
                allowBeforeQuora: true,
                skipStoredWorkCheck: true,
                awaitFill: true
            }).catch(() => null)
        }
        else if(durableQueuedRows > 0) {
            if(getQueuedTabFillPromise() || getCoordinatorFastExecutorActiveUntil() > getNow()) {
                incrementQueueWakeupMetric('storageUpdate.durableQueuedWorkDeferredDuringFill')
            }
            else {
                void runCoordinatorQueueExecutorFastPath(reason, {
                    awaitFill: true,
                    returnAfterDurableActive: true,
                    allowBeforeQuora: true,
                    skipAuthorityReconcile: true,
                    forceDurableQueueReload: true
                }).catch(() => null)
            }
        }
        return true
    }

    function scheduleQueuedOnlyDurableWorkContinuation(reason = 'queued-only-durable-work', options = {}) {
        const normalizedReason = `${reason || 'queued-only-durable-work'}`.trim() || 'queued-only-durable-work'
        incrementQueueWakeupMetric('reconcile.queuedOnlyFastResumeScheduled')
        scheduleCoordinatorQueueResume(1000, normalizedReason, {
            allowBeforeQuora: options.allowBeforeQuora === true
        })
        const runtimeCounts = queueRuntime.getRuntimeCounts()
        const detachedQueuedActions = runtimeCounts.queuedTabActions > 0 &&
            runtimeCounts.activeQueuedTabs <= 0 &&
            runtimeCounts.pendingTabActions <= 0
        if(getCoordinatorFastExecutorActiveUntil() > getNow() && !detachedQueuedActions) {
            incrementQueueWakeupMetric('reconcile.queuedOnlyFastResumeDeferredDuringFastExecutor')
            return true
        }
        if(detachedQueuedActions) incrementQueueWakeupMetric('reconcile.detachedQueuedActionsFastResumed')
        void runCoordinatorQueueExecutorFastPath(normalizedReason, {
            awaitFill: options.awaitFill !== false,
            returnAfterDurableActive: true,
            allowBeforeQuora: options.allowBeforeQuora === true,
            skipAuthorityReconcile: true,
            forceDurableQueueReload: false
        }).catch(() => null)
        return true
    }

    function kickQueuedWorkAfterSlotFreed(reason = 'queued-tab-slot-freed', options = {}) {
        const normalizedReason = `${reason || 'queued-tab-slot-freed'}`.trim() || 'queued-tab-slot-freed'
        scheduleQueuedWorkContinuation(normalizedReason)
        scheduleCoordinatorQueueResume(100, normalizedReason, {
            allowBeforeQuora: true
        })
        scheduleCoordinatorReconcile(100, {
            reason: normalizedReason,
            edgeTriggered: true,
            allowBeforeQuora: true
        })
        if(storageUpdateState.getDepth() > 0 || getQueuedTabFillPromise()) {
            incrementQueueWakeupMetric('pump.slotFreed.fastKickDeferred')
            return false
        }
        incrementQueueWakeupMetric('pump.slotFreed.fastKick')
        void runCoordinatorQueueExecutorFastPath(normalizedReason, {
            awaitFill: options.awaitFill !== false,
            returnAfterDurableActive: true,
            allowBeforeQuora: true,
            skipAuthorityReconcile: true,
            forceDurableQueueReload: false
        }).catch(() => null)
        return true
    }

    return {
        requestPostStorageQueuedWorkContinuation,
        flushPostStorageQueuedWorkContinuation,
        scheduleDurableQueueResumeFromIdleStorage,
        scheduleQueuedOnlyDurableWorkContinuation,
        kickQueuedWorkAfterSlotFreed
    }
}

module.exports = {
    createQueuedWorkFastResume
}
