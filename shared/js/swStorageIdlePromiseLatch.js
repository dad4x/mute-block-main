// Storage-idle / promise-latch recovery bookkeeping extracted from sw.js
// (decomposition Slice 9, part 1). These are the synchronous predicates,
// snapshot/journal builders, and stale-promise-latch clearers a storage
// update cycle and the reconcile/pump paths use to decide whether durable
// queue work is stranded without a live runtime actor, and whether a
// long-lived queued-tab-fill / coordinator-reconcile / storage-timeout
// promise latch has gone stale and needs clearing.
//
// 16 of this slice's 20 candidate functions land here. None of these 16
// construct or return a Promise/`.then()`/`.catch()` chain (grepped for
// `.then(`, `.catch(`, `Promise.` in every body before moving) -- per
// architecture.md's "Module Extraction And The Test Harness Realm
// Boundary" section (the Slice 7 refinement especially), the realm-
// crossing risk is specific to Promise chains reaching across the
// vm/plain-realm boundary, not to plain synchronous calls into or out of
// an already-extracted module (getCoordinatorQueueWorkCounts,
// getPhaseWallMs, getSchedulerBlockingQueuedExecutorCount,
// incrementQueueWakeupMetric, pushQueueWakeupJournalEntry are all already
// extracted and are called here as plain synchronous functions).
//
// The other 4 candidates from the plan's Slice 9 list are NOT here:
//   - scheduleDurableQueueResumeFromIdleStorage, scheduleQueuedOnlyDurableWorkContinuation,
//     and kickQueuedWorkAfterSlotFreed each build a fire-and-forget
//     `.catch(() => null)` chain off runCoordinatorReconcileTick /
//     runCoordinatorQueueExecutorFastPath, both still-async, still-in-sw.js
//     orchestration functions. Moving the chain-*building* function out of
//     sw.js turns what is currently a same-realm (sw.js-to-sw.js) fire-and-
//     forget into an added extracted-module-to-vm-realm crossing -- the
//     mirror image of the Slice 7 finding, just in the opposite direction
//     (adding a crossing that didn't exist, instead of removing one that
//     did). These three were split into their own module
//     (swQueuedWorkFastResume.js) and verified independently against the
//     full test:parallel suite before landing -- they passed clean; see
//     that file's header for why the theoretical risk didn't manifest
//     here, and why they're kept in a separate file regardless.
//   - scheduleQueueWakeupMetricsFlush builds `Promise.resolve().then(() =>
//     flushQueueWakeupMetrics())`, the same class of risk, *and*
//     test/lib/swHarness.js's `disableQueueWakeupMetricsFlush` option
//     patches sw.js's source text for a function literally named
//     `scheduleQueueWakeupMetricsFlush` at the top of loadServiceWorkerHarness
//     -- that patch only ever scans sw.js's own file content, never a
//     required module's, so moving this function's definition out of sw.js
//     would make that harness option silently stop taking effect. Left in
//     sw.js for both reasons; it's called here as a plain dep
//     (recoverStorageGetTimeoutSerializedTail's call to it), still a
//     same-realm call since it's invoked, not chained.
//
// resetQueuedTabFillState joined this module in the sw.js decomposition
// mop-up slice (2026-09) -- see its own function header comment just above
// its definition below. storageUpdateState and queueRuntime are the
// existing already-extracted-module instances, passed through as-is.
//
// Every Date.now() call in the moved bodies is threaded through as
// `now: () => Date.now()` per the plan's clock/environment-global note.
// The mutable module-level `let`s these functions read/write
// (queuedTabFillPromise, queuedTabFillPromiseStartedAt,
// queuedTabFillOpeningActionKeys, coordinatorReconcilePromise,
// coordinatorReconcilePromiseStartedAt, coordinatorFastExecutorActiveUntil,
// coordinatorResumePromise) are threaded through as live get/set accessors
// under `state`, matching the convention already used by
// swQueueWakeupMetricsShape.js.

const {NO_DURABLE_WORK_REASON_LIMIT} = require('./tunables')

function createStorageIdlePromiseLatch(deps = {}) {
    const {
        now: getNow = () => Date.now()
    } = deps
    const {
        SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS,
        QUEUED_TAB_IDLE_FILL_PROMISE_STALE_MS,
        QUEUED_TAB_FILL_PROMISE_STALE_MS,
        COORDINATOR_IDLE_RECONCILE_PROMISE_STALE_MS,
        COORDINATOR_RECONCILE_PROMISE_STALE_MS
    } = deps.constants || {}
    const {
        getQueuedTabFillPromise,
        setQueuedTabFillPromise,
        getQueuedTabFillPromiseStartedAt,
        setQueuedTabFillPromiseStartedAt,
        setQueuedTabFillOpeningActionKeys,
        getCoordinatorReconcilePromise,
        setCoordinatorReconcilePromise,
        getCoordinatorReconcilePromiseStartedAt,
        setCoordinatorReconcilePromiseStartedAt,
        getCoordinatorFastExecutorActiveUntil,
        getCoordinatorResumePromise
    } = deps.state || {}
    const {
        queueRuntime,
        storageUpdateState,
        getActiveStorageContext,
        getCoordinatorQueueWorkCounts,
        getPhaseWallMs,
        getSchedulerBlockingQueuedExecutorCount,
        incrementQueueWakeupMetric,
        pushQueueWakeupJournalEntry,
        scheduleCoordinatorQueueResume,
        scheduleCoordinatorReconcile,
        flushPostStorageQueuedWorkContinuation,
        requestPostStorageQueuedWorkContinuation,
        scheduleQueueWakeupMetricsFlush,
        scheduleDurableQueueResumeFromIdleStorage
    } = deps.handlers || {}

    // resetQueuedTabFillState (sw.js decomposition mop-up slice, 2026-09):
    // moved in from sw.js, where it was left resident "out of scope" for
    // Slice 9 (it touches queuedTabFillOpeningActionKeys, state well beyond
    // Slice 9's own cluster). It's folded in here as a local function --
    // this module already threaded it through as an external handler dep
    // for clearStaleQueuedTabFillPromise/clearStorageTimeoutPromiseLatches,
    // so those two callers below now just call the sibling function
    // directly. The three mutable sw.js `let`s it resets
    // (queuedTabFillPromise, queuedTabFillPromiseStartedAt,
    // queuedTabFillOpeningActionKeys) are still read/written directly by
    // bare name at many other sw.js call sites outside this module's scope,
    // so they stay sw.js `let`s -- only write access is threaded through as
    // live setter accessors here, matching the existing
    // setCoordinatorReconcilePromise/setCoordinatorReconcilePromiseStartedAt
    // convention immediately above.
    function resetQueuedTabFillState() {
        setQueuedTabFillPromise(null)
        setQueuedTabFillPromiseStartedAt(0)
        setQueuedTabFillOpeningActionKeys(new Set())
    }

    function recordActiveStorageWorkSnapshot(queue = {}, options = {}) {
        const context = getActiveStorageContext()
        if(!context) return

        const counts = getCoordinatorQueueWorkCounts(queue)
        context.durableActiveRows = counts.durableActiveRows
        context.durableQueuedRows = counts.durableQueuedRows
        context.durableTerminalRows = counts.durableTerminalRows
        if(options.paused !== undefined) context.paused = options.paused === true
    }

    function getStorageContextJournalDetails(context = {}) {
        const now = getNow()
        const startedAt = Number.parseInt(context.startedAt, 10) || 0
        const finishedAt = Number.parseInt(context.finishedAt, 10) || 0
        const timedOutAt = Number.parseInt(context.timedOutAt, 10) || 0
        const effectiveEndAt = finishedAt || timedOutAt || now
        const queueWaitMs = startedAt
            ? Math.max(0, startedAt - (Number.parseInt(context.enqueuedAt, 10) || startedAt))
            : Math.max(0, effectiveEndAt - (Number.parseInt(context.enqueuedAt, 10) || effectiveEndAt))
        const runMs = startedAt ? Math.max(0, effectiveEndAt - startedAt) : 0
        const totalMs = Math.max(0, effectiveEndAt - (Number.parseInt(context.enqueuedAt, 10) || effectiveEndAt))

        return {
            updateToken: Number.parseInt(context.updateToken, 10) || 0,
            reason: context.reason || '',
            enqueuedAt: Number.parseInt(context.enqueuedAt, 10) || 0,
            startedAt,
            finishedAt,
            timedOutAt,
            queueWaitMs,
            runMs,
            totalMs,
            timedOut: context.didTimeout === true,
            timeoutMs: Number.parseInt(context.timeoutMs, 10) || 0,
            deadlineMissed: context.deadlineMissed === true,
            fallbackReturned: context.fallbackReturned === true,
            abandoned: context.abandoned === true,
            tailWedged: context.tailWedged === true,
            serializedTailRecovered: context.serializedTailRecovered === true,
            lateWriteSuppressed: context.lateWriteSuppressed === true,
            abortedOperation: context.abortedOperation || '',
            depth: Number.parseInt(context.depth, 10) || 0,
            maxNestedDepth: Number.parseInt(context.maxNestedDepth, 10) || 0,
            nestedUpdateCount: Number.parseInt(context.nestedUpdateCount, 10) || 0,
            timeoutPhase: context.timeoutPhase || '',
            currentPhase: context.currentPhase || '',
            storageGetCalls: Number.parseInt(context.storageGetCalls, 10) || 0,
            storageSetCalls: Number.parseInt(context.storageSetCalls, 10) || 0,
            saveCoordinatorStateCalls: Number.parseInt(context.saveCoordinatorStateCalls, 10) || 0,
            storageGetMs: Math.round(Number(context.storageGetMs) || 0),
            storageSetMs: Math.round(Number(context.storageSetMs) || 0),
            storageGetCumulativeMs: Math.round(Number(context.storageGetMs) || 0),
            storageSetCumulativeMs: Math.round(Number(context.storageSetMs) || 0),
            ownStorageGetMs: Math.round(getPhaseWallMs(context, 'storageGet')),
            ownStorageSetMs: Math.round(getPhaseWallMs(context, 'storageSet')),
            loadCoordinatorStateMs: Math.round(Number(context.loadCoordinatorStateMs) || 0),
            saveCoordinatorStateMs: Math.round(Number(context.saveCoordinatorStateMs) || 0),
            normalizeQueueMs: Math.round(Number(context.normalizeQueueMs) || 0),
            normalizeRunsMs: Math.round(Number(context.normalizeRunsMs) || 0),
            normalizeEventsMs: Math.round(Number(context.normalizeEventsMs) || 0),
            normalizeProgressMs: Math.round(Number(context.normalizeProgressMs) || 0),
            recomputeRunsMs: Math.round(Number(context.recomputeRunsMs) || 0),
            flushDiagnosticEventsMs: Math.round(Number(context.flushDiagnosticEventsMs) || 0),
            flushMilestonesMs: Math.round(Number(context.flushMilestonesMs) || 0),
            queueWalSegmentStorageGetMs: Math.round(Number(context.queueWalSegmentStorageGetMs) || 0),
            queueWalHydrateMs: Math.round(Number(context.queueWalHydrateMs) || 0),
            queueWalAppendPrepareMs: Math.round(Number(context.queueWalAppendPrepareMs) || 0),
            queueWalPhysicalPayloadMs: Math.round(Number(context.queueWalPhysicalPayloadMs) || 0),
            queueWalStorageSetMs: Math.round(Number(context.queueWalStorageSetMs) || 0),
            queueWalReplayVerifyMs: Math.round(Number(context.queueWalReplayVerifyMs) || 0),
            queueProjectionBuildMs: Math.round(Number(context.queueProjectionBuildMs) || 0),
            queueProjectionStorageSetMs: Math.round(Number(context.queueProjectionStorageSetMs) || 0),
            payloadBytes: Number.parseInt(context.payloadBytes, 10) || 0,
            payloadKeys: context.payloadKeys || '',
            durableActiveRows: Number.parseInt(context.durableActiveRows, 10) || 0,
            durableQueuedRows: Number.parseInt(context.durableQueuedRows, 10) || 0,
            durableTerminalRows: Number.parseInt(context.durableTerminalRows, 10) || 0,
            paused: context.paused === true
        }
    }

    function getStorageTimeoutBucket(context = {}) {
        const phase = `${context.currentPhase || ''}`.trim()
        if(!context.startedAt && (!phase || phase === 'beforeStart')) return 'timeout.beforeStart'
        if(phase === 'storageGet') return 'timeout.duringStorageGet'
        if(phase === 'storageSet') return 'timeout.duringStorageSet'
        if(phase === 'recomputeRuns') return 'timeout.duringRecomputeRuns'
        if(phase === 'flushDiagnosticEvents') return 'timeout.duringDiagnosticFlush'
        if(phase === 'flushMilestones') return 'timeout.duringMilestoneFlush'
        if(/^normalize/.test(phase)) return 'timeout.duringNormalize'
        return 'timeout.unknown'
    }

    // Distinct reasons that already have a no-work counter. Past NO_DURABLE_WORK_REASON_LIMIT, new reasons count as "other".
    const noDurableWorkReasonKeys = new Set()
    function getNoDurableWorkReasonKey(reason = '') {
        const normalized = `${reason || 'none'}`.trim().slice(0, 60).replace(/\s+/g, '-') || 'none'
        if(noDurableWorkReasonKeys.has(normalized)) return normalized
        if(noDurableWorkReasonKeys.size < NO_DURABLE_WORK_REASON_LIMIT) {
            noDurableWorkReasonKeys.add(normalized)
            return normalized
        }
        return 'other'
    }

    function recordStorageIdleChurnCounters(context = {}) {
        const runtimeCounts = queueRuntime.getRuntimeCounts()
        const runtimeHasWork = runtimeCounts.activeQueuedTabs > 0 ||
            runtimeCounts.queuedTabActions > 0 ||
            runtimeCounts.pendingTabActions > 0
        const durableActiveRows = Number.parseInt(context.durableActiveRows, 10) || 0
        const durableQueuedRows = Number.parseInt(context.durableQueuedRows, 10) || 0
        const durableHasWork = durableActiveRows > 0 || durableQueuedRows > 0
        const progressProjectionOnlyWrite = (Number.parseInt(context.profileProgressProjectionOnlyWrites, 10) || 0) > 0 &&
            context.nonProgressProjectionWrite !== true &&
            !context.queueWriteOperation

        if(!runtimeHasWork) incrementQueueWakeupMetric('storageUpdate.noRuntimeWork')
        if(!durableHasWork) {
            incrementQueueWakeupMetric('storageUpdate.noDurableWork')
            incrementQueueWakeupMetric(`storageUpdate.noDurableWork.reason.${getNoDurableWorkReasonKey(context.reason)}`)
        }
        if(durableHasWork &&
            !runtimeHasWork &&
            context.paused !== true &&
            (durableActiveRows > 0 || !progressProjectionOnlyWrite) &&
            context.suppressDurableIdleResume !== true) {
            scheduleDurableQueueResumeFromIdleStorage(context)
        }
    }

    function getPromiseLatchAgeMs(startedAt = 0) {
        const normalizedStartedAt = Number.parseInt(startedAt, 10) || 0
        return normalizedStartedAt ? Math.max(0, getNow() - normalizedStartedAt) : 0
    }

    function isRuntimeAndStorageIdleForPromiseLatch() {
        return storageUpdateState.getDepth() <= 0 &&
            getSchedulerBlockingQueuedExecutorCount() <= 0 &&
            queueRuntime.getActiveQueuedTabCount() <= 0 &&
            queueRuntime.getPendingTabActionCount() <= 0
    }

    function hasVisibleQueuedTabFillPromise() {
        if(!getQueuedTabFillPromise()) return false
        const pendingOnlyActiveTabs = queueRuntime.listPendingTabActionTabIds()
            .every(tabId => queueRuntime.hasActiveQueuedTab(tabId))
        return !(queueRuntime.getActiveQueuedTabCount() > 0 &&
            queueRuntime.getActivationIntentCount() <= 0 &&
            pendingOnlyActiveTabs)
    }

    function isExecutorRuntimeIdleForPromiseLatch() {
        return getSchedulerBlockingQueuedExecutorCount() <= 0 &&
            queueRuntime.getActiveQueuedTabCount() <= 0 &&
            queueRuntime.getPendingTabActionCount() <= 0
    }

    function isExecutorRuntimeDetachedForPromiseLatch() {
        return queueRuntime.getActiveQueuedTabCount() <= 0 &&
            queueRuntime.getPendingTabActionCount() <= 0 &&
            !hasVisibleQueuedTabFillPromise()
    }

    function shouldDeferScheduledResumeDuringFastExecutor(reason = '') {
        const normalizedReason = `${reason || ''}`.trim()
        if(/terminal-progress|active-transition|durable-(?:active|queued)-work|storage-idle-durable|queued-tab-release|active-missing-tab|runtime-authority-missing-active-row/.test(normalizedReason)) {
            incrementQueueWakeupMetric('pump.fastExecutor.deferredBypassProgressReason')
            return false
        }
        return getCoordinatorFastExecutorActiveUntil() > getNow() &&
            (getCoordinatorResumePromise() ||
                getQueuedTabFillPromise() ||
                getSchedulerBlockingQueuedExecutorCount() > 0 ||
                queueRuntime.getPendingTabActionCount() > 0)
    }

    function clearStaleQueuedTabFillPromise(reason = 'queued-tab-fill') {
        if(!getQueuedTabFillPromise()) return false

        const ageMs = getPromiseLatchAgeMs(getQueuedTabFillPromiseStartedAt())
        const idleLatch = isRuntimeAndStorageIdleForPromiseLatch()
        const staleMs = idleLatch
            ? Math.min(QUEUED_TAB_IDLE_FILL_PROMISE_STALE_MS, QUEUED_TAB_FILL_PROMISE_STALE_MS)
            : QUEUED_TAB_FILL_PROMISE_STALE_MS
        if(ageMs < staleMs) return false

        resetQueuedTabFillState()
        incrementQueueWakeupMetric('pump.changed.clearedStaleFillPromise')
        if(idleLatch) incrementQueueWakeupMetric('pump.changed.clearedIdleStaleFillPromise')
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'queued-tab-fill-promise-stale-cleared',
            reason,
            result: 'state-changed',
            resultReason: 'stale-fill-promise-cleared',
            details: {
                ageMs,
                staleMs,
                idleLatch
            }
        })
        scheduleCoordinatorQueueResume(1000, `${reason || 'queued-tab-fill'}-stale-fill-promise`, {
            allowBeforeQuora: true
        })
        scheduleCoordinatorReconcile(1000, {
            reason: `${reason || 'queued-tab-fill'}-stale-fill-promise`,
            edgeTriggered: true,
            allowBeforeQuora: true
        })
        return true
    }

    function clearStaleCoordinatorReconcilePromise(reason = 'coordinator-reconcile') {
        if(!getCoordinatorReconcilePromise()) return false

        const ageMs = getPromiseLatchAgeMs(getCoordinatorReconcilePromiseStartedAt())
        const idleLatch = isRuntimeAndStorageIdleForPromiseLatch()
        const executorIdle = isExecutorRuntimeIdleForPromiseLatch()
        const detachedExecutor = isExecutorRuntimeDetachedForPromiseLatch()
        const staleMs = idleLatch || executorIdle || detachedExecutor
            ? COORDINATOR_IDLE_RECONCILE_PROMISE_STALE_MS
            : COORDINATOR_RECONCILE_PROMISE_STALE_MS
        if(ageMs < staleMs) return false

        setCoordinatorReconcilePromise(null)
        setCoordinatorReconcilePromiseStartedAt(0)
        incrementQueueWakeupMetric('reconcile.stalePromiseCleared')
        if(idleLatch) incrementQueueWakeupMetric('reconcile.idleStalePromiseCleared')
        else if(executorIdle) incrementQueueWakeupMetric('reconcile.executorIdleStalePromiseCleared')
        else if(detachedExecutor) incrementQueueWakeupMetric('reconcile.detachedExecutorStalePromiseCleared')
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'coordinator-reconcile-promise-stale-cleared',
            reason,
            result: 'state-changed',
            resultReason: 'stale-reconcile-promise-cleared',
            details: {
                ageMs,
                staleMs,
                idleLatch,
                executorIdle,
                detachedExecutor
            }
        })
        scheduleCoordinatorReconcile(1000, {
            reason: `${reason || 'coordinator-reconcile'}-stale-reconcile-promise`,
            edgeTriggered: true,
            allowBeforeQuora: true
        })
        return true
    }

    function clearStorageTimeoutPromiseLatches(reason = 'storage-timeout', timeoutMs = SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS) {
        const normalizedReason = `${reason || 'storage-timeout'}`.trim() || 'storage-timeout'
        const executorIdle = isExecutorRuntimeIdleForPromiseLatch()
        const recoveryStaleMs = Math.max(
            executorIdle
                ? QUEUED_TAB_IDLE_FILL_PROMISE_STALE_MS
                : QUEUED_TAB_FILL_PROMISE_STALE_MS,
            Number.parseInt(timeoutMs, 10) || SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS
        )
        const effectiveRecoveryStaleMs = executorIdle
            ? Math.min(recoveryStaleMs, QUEUED_TAB_IDLE_FILL_PROMISE_STALE_MS)
            : recoveryStaleMs
        let cleared = false

        if(getQueuedTabFillPromise() && getPromiseLatchAgeMs(getQueuedTabFillPromiseStartedAt()) >= effectiveRecoveryStaleMs) {
            resetQueuedTabFillState()
            cleared = true
            incrementQueueWakeupMetric('storageUpdate.clearedTimedOutFillPromise')
        }

        if(getCoordinatorReconcilePromise() && getPromiseLatchAgeMs(getCoordinatorReconcilePromiseStartedAt()) >= effectiveRecoveryStaleMs) {
            setCoordinatorReconcilePromise(null)
            setCoordinatorReconcilePromiseStartedAt(0)
            cleared = true
            incrementQueueWakeupMetric('storageUpdate.clearedTimedOutReconcilePromise')
        }

        if(cleared) {
            pushQueueWakeupJournalEntry({
                kind: 'state-change',
                name: 'storage-timeout-promise-latches-cleared',
                reason: normalizedReason,
                result: 'state-changed',
                resultReason: 'storage-timeout-recovery',
                details: {
                    recoveryStaleMs: effectiveRecoveryStaleMs,
                    executorIdle
                }
            })
        }

        return cleared
    }

    function recoverStorageGetTimeoutSerializedTail(context = {}, reason = 'storage-timeout', serializedTailPromise = null) {
        if(!context || context.serializedTailRecovered === true) return false
        if(`${context.currentPhase || ''}`.trim() !== 'storageGet') return false

        const updateToken = Number.parseInt(context.updateToken, 10) || 0
        if(!updateToken) return false
        if(!storageUpdateState.canRecoverSerializedTail(context, serializedTailPromise)) return false

        context.serializedTailRecovered = true
        context.lateWriteSuppressed = true
        context.abortedOperation = 'storageGet'
        storageUpdateState.recoverSerializedTail(context)
        incrementQueueWakeupMetric('storageUpdate.serializedTailRecovered')
        incrementQueueWakeupMetric('storageUpdate.storageGetTailRecovered')
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'storage-get-timeout-serialized-tail-recovered',
            reason,
            result: 'state-changed',
            resultReason: 'storage-get-timeout-tail-recovered',
            details: getStorageContextJournalDetails(context)
        })
        flushPostStorageQueuedWorkContinuation()
        scheduleQueueWakeupMetricsFlush()
        return true
    }

    function requestStorageTimeoutRecoveryContinuation(context = {}, reason = 'storage-timeout') {
        if(context.timeoutRecoveryRequested === true) return false
        context.timeoutRecoveryRequested = true

        const normalizedReason = `${reason || context.reason || 'storage-timeout'}`.trim() || 'storage-timeout'
        const followupReason = `${normalizedReason}-recovery`
        incrementQueueWakeupMetric('storageUpdate.timeoutRecoveryRequested')
        clearStorageTimeoutPromiseLatches(followupReason, context.timeoutMs)
        requestPostStorageQueuedWorkContinuation(followupReason)
        scheduleCoordinatorQueueResume(1000, followupReason, {
            allowBeforeQuora: true
        })
        return true
    }

    function shouldContinueQueuedOnlyWorkWithFastExecutor(snapshot = {}) {
        if(!snapshot || snapshot.paused === true) return false
        if((Number.parseInt(snapshot.durableActiveRows, 10) || 0) > 0) return false
        if((Number.parseInt(snapshot.durableQueuedRows, 10) || 0) <= 0) return false
        if((Number.parseInt(snapshot.activeQueuedTabs, 10) || 0) > 0) return false
        if((Number.parseInt(snapshot.durablyActiveQueuedTabs, 10) || 0) > 0) return false
        if((Number.parseInt(snapshot.provisionalActiveQueuedTabs, 10) || 0) > 0) return false
        if((Number.parseInt(snapshot.pendingTabActions, 10) || 0) > 0) return false
        return true
    }

    return {
        resetQueuedTabFillState,
        recordActiveStorageWorkSnapshot,
        getStorageContextJournalDetails,
        getStorageTimeoutBucket,
        recordStorageIdleChurnCounters,
        getPromiseLatchAgeMs,
        isRuntimeAndStorageIdleForPromiseLatch,
        hasVisibleQueuedTabFillPromise,
        isExecutorRuntimeIdleForPromiseLatch,
        isExecutorRuntimeDetachedForPromiseLatch,
        shouldDeferScheduledResumeDuringFastExecutor,
        clearStaleQueuedTabFillPromise,
        clearStaleCoordinatorReconcilePromise,
        clearStorageTimeoutPromiseLatches,
        recoverStorageGetTimeoutSerializedTail,
        requestStorageTimeoutRecoveryContinuation,
        shouldContinueQueuedOnlyWorkWithFastExecutor
    }
}

module.exports = {
    createStorageIdlePromiseLatch
}
