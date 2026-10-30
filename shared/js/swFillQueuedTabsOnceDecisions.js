// fillQueuedTabsOnce decide functions extracted from sw.js (decomposition
// Slices P2-2 through P2-9): decideQueueLoadThrottleGate,
// decidePausedStateGate, decideActivationGuardClaim,
// decideProfileOpenReservationClaim, decideSlotOutcome,
// decideFinalOpenRecoveryOutcome, decidePreOpenRecoveryOutcome,
// decideLiveProfileTabCapacityGate, decidePreOpenPausedGate,
// decidePostOpenFailureRecoveryOutcome, decideReturnAfterDurableActiveOutcome,
// decideFillQueuedTabsOnceOutcome. All twelve were decomposed out of
// fillQueuedTabsOnce, which remains in sw.js and calls back into each of
// these in turn.
//
// This module's construction call in sw.js is placed right after
// storageIdlePromiseLatch's destructure: that's the point by which every
// bare identifier these functions need (queueRuntime, the queue-wakeup-
// metrics helpers, the activation-guard/profile-open-reservation helpers,
// getSchedulerBlockingQueuedExecutorCount, resetQueuedTabFillState, and so
// on) is a `const` already assigned -- resetQueuedTabFillState, destructured
// from storageIdlePromiseLatch, is the last of them to become available.
// Everything else needed is a plain hoisted `function` declaration
// (scheduleCoordinatorQueueResume, scheduleCoordinatorReconcile,
// scheduleQueuedWorkContinuation, promiseWithTimeout,
// ensureQueuedTabContentScript, handleQueuedTabContentScriptEnsureResult,
// scheduleOwnedBlockedProfileSweep, sweepOwnedBlockedProfileTabs,
// recordCoordinatorJobProgressViaQueueMachine) declared later in the file --
// those are visible from anywhere in sw.js's module scope regardless of
// their textual position, so they impose no ordering constraint.
//
// queuedTabFillOpeningActionKeys is a `let` that sw.js reassigns to a fresh
// Set on every fillQueuedTabs cycle (and via a setter used elsewhere) --
// destructuring it once as a plain value at construction time would freeze
// this module onto the original Set from module load, going stale the first
// time sw.js swaps it out. It's threaded as a `deps.state` getter instead
// (`getQueuedTabFillOpeningActionKeys`), the same accessor pattern sw.js
// already uses for its other reassignable module-level state (e.g.
// queuedTabFillPromise in storageIdlePromiseLatch's own construction call),
// and decideProfileOpenReservationClaim / decideFillQueuedTabsOnceOutcome
// call it to reach the live Set instead of closing over a bare identifier.

function createFillQueuedTabsOnceDecisions(deps = {}) {
    const {
        COORDINATOR_PAUSED_KEY,
        QUEUED_TAB_CONTENT_SCRIPT_ENSURE_TIMEOUT_MS,
        QUEUED_TAB_CREATE_TIMEOUT_MS,
        QUEUED_TAB_FINAL_OPEN_AUTHORITY_RETRY_MS,
        SERVICE_WORKER_QUEUE_OWNER_ID,
        claimQueuedActivationGuard,
        clearDetachedQueuedProfileOpenReservations,
        ensureQueuedTabContentScript,
        finishQueueWakeupMetricCycle,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getEffectiveQueuedTabOpenConcurrency,
        getQueuedProfileOpenReservationCount,
        getQueuedRuntimeActionFillKey,
        getQueuedTabActionKey,
        getSchedulerBlockingQueuedExecutorCount,
        handleQueuedTabContentScriptEnsureResult,
        incrementQueueWakeupMetric,
        promiseWithTimeout,
        queueRuntime,
        recordCoordinatorDiagnosticEvent,
        recordCoordinatorJobProgressViaQueueMachine,
        recordFlightRecorderEvent,
        releaseQueuedActivationGuard,
        reserveQueuedProfileOpen,
        resetQueuedTabFillState,
        scheduleCoordinatorQueueResume,
        scheduleCoordinatorReconcile,
        scheduleOwnedBlockedProfileSweep,
        scheduleQueuedWorkContinuation,
        sweepOwnedBlockedProfileTabs
    } = deps.handlers || {}
    const {
        getQueuedTabFillOpeningActionKeys
    } = deps.state || {}

    function decideQueueLoadThrottleGate(params = {}) {
        const {throttle, cycle, now} = params
        if(!(throttle.active && queueRuntime.getActivationIntentCount() && getSchedulerBlockingQueuedExecutorCount() >= 1)) {
            return null
        }
        const delayMs = Math.max(1000, throttle.until - now)
        scheduleCoordinatorQueueResume(delayMs, 'queue-load-throttle')
        incrementQueueWakeupMetric('pump.noop.throttled')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'queue-load-throttled', {
            active: queueRuntime.getActiveQueuedTabCount(),
            schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
            retryInMs: delayMs,
            throttleLevel: throttle.level,
            reason: throttle.reason
        })
        recordFlightRecorderEvent({
            kind: 'fill-decision',
            source: 'fillQueuedTabsOnce',
            reason: 'queue-load-throttled',
            accepted: false,
            changed: false
        })
        return {
            openedTabs: 0,
            active: queueRuntime.getActiveQueuedTabCount(),
            schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
            remainingActions: queueRuntime.getActivationIntentCount(),
            reason: 'queue-load-throttled',
            throttled: true
        }
    }

    function decidePausedStateGate(params = {}) {
        const {pausedState, cycle} = params
        if(pausedState?.[COORDINATOR_PAUSED_KEY] !== true) {
            return null
        }
        incrementQueueWakeupMetric('pump.noop.paused')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'coordinator-paused', {
            active: queueRuntime.getActiveQueuedTabCount(),
            schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
            remainingActions: queueRuntime.getActivationIntentCount()
        })
        recordFlightRecorderEvent({
            kind: 'fill-decision',
            source: 'fillQueuedTabsOnce',
            reason: 'coordinator-paused',
            accepted: false,
            changed: false
        })
        return {
            openedTabs: 0,
            active: queueRuntime.getActiveQueuedTabCount(),
            schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
            remainingActions: queueRuntime.getActivationIntentCount(),
            reason: 'coordinator-paused',
            paused: true
        }
    }

    function decideActivationGuardClaim(params = {}) {
        const {next} = params
        const activationGuardKey = claimQueuedActivationGuard(next, null, 'queued-tab-pre-open')
        if(activationGuardKey) {
            return {outcome: 'proceed', activationGuardKey}
        }
        queueRuntime.requeueActivationIntent(next, {
            source: 'runtime-effect'
        })
        const fillFailureReason = 'queued-activation-in-flight'
        incrementQueueWakeupMetric('pump.noop.activationGuardInFlight')
        scheduleCoordinatorQueueResume(500, fillFailureReason, {
            allowBeforeQuora: true
        })
        recordFlightRecorderEvent({
            kind: 'queued-tab-open-decision',
            source: 'fillQueuedTabsOnce',
            rowKey: next.coordinatorKey || next.profileHref || next.targetProfileHref || next.url || '',
            targetUrl: next.profileHref || next.targetProfileHref || next.url || next.requestedUrl || '',
            attemptId: getAttemptIdFromValue(next),
            attemptNumber: getAttemptNumberFromValue(next),
            runId: next.runId || '',
            accepted: false,
            changed: false,
            reason: fillFailureReason
        })
        return {outcome: 'break', fillFailureReason}
    }

    function decideProfileOpenReservationClaim(params = {}) {
        const {next, openingActionKey} = params
        const openReservationHref = reserveQueuedProfileOpen(next, 'queued-tab-create')
        if(openReservationHref) {
            return {outcome: 'proceed', openReservationHref}
        }
        // The activation guard is claimed after the reservation now, so there is no guard to release here.
        if(openingActionKey) getQueuedTabFillOpeningActionKeys().delete(openingActionKey)
        queueRuntime.requeueActivationIntent(next, {
            source: 'runtime-effect'
        })
        const fillFailureReason = 'profile-open-reservation-in-flight'
        incrementQueueWakeupMetric('pump.noop.profileOpenReservationInFlight')
        scheduleCoordinatorQueueResume(1000, fillFailureReason, {
            allowBeforeQuora: true
        })
        scheduleCoordinatorReconcile(1000, {
            reason: fillFailureReason,
            edgeTriggered: true,
            allowBeforeQuora: true
        })
        return {outcome: 'break', fillFailureReason}
    }

    function decideSlotOutcome(params = {}) {
        const {slotDecision, cycle} = params
        const next = slotDecision?.action || null
        if(slotDecision?.paused === true) {
            incrementQueueWakeupMetric('pump.noop.pausedBeforeOpen')
            finishQueueWakeupMetricCycle(cycle, 'no-op', 'coordinator-paused', {
                active: queueRuntime.getActiveQueuedTabCount(),
                schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
                remainingActions: queueRuntime.getActivationIntentCount()
            })
            recordFlightRecorderEvent({
                kind: 'fill-decision',
                source: 'fillQueuedTabsOnce',
                reason: 'coordinator-paused',
                accepted: false,
                changed: false
            })
            return {
                outcome: 'return',
                result: {
                    openedTabs: 0,
                    active: queueRuntime.getActiveQueuedTabCount(),
                    schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
                    remainingActions: queueRuntime.getActivationIntentCount(),
                    reason: 'coordinator-paused',
                    paused: true
                }
            }
        }
        if(slotDecision?.planOnlyQueuedAuthorityPreserved === true) {
            incrementQueueWakeupMetric('pump.noop.planOnlyQueuedAuthorityPreserved')
            return {outcome: 'break'}
        }
        if(slotDecision?.clearedStaleServiceWorkerOwnerPause === true) {
            incrementQueueWakeupMetric('pump.changed.clearedStaleServiceWorkerOwnerPause')
        }
        if(slotDecision?.canceledPausedOwner === true) {
            return {outcome: 'continue'}
        }
        if(slotDecision?.activationGuardInFlight === true) {
            const fillFailureReason = 'queued-activation-in-flight'
            incrementQueueWakeupMetric('pump.noop.activationGuardInFlight')
            recordFlightRecorderEvent({
                kind: 'queued-tab-open-decision',
                source: 'fillQueuedTabsOnce',
                rowKey: next.coordinatorKey || next.profileHref || next.targetProfileHref || next.url || '',
                targetUrl: next.profileHref || next.targetProfileHref || next.url || next.requestedUrl || '',
                attemptId: getAttemptIdFromValue(next),
                attemptNumber: getAttemptNumberFromValue(next),
                runId: next.runId || '',
                accepted: false,
                changed: false,
                reason: fillFailureReason
            })
            scheduleCoordinatorQueueResume(500, fillFailureReason, {
                allowBeforeQuora: true
            })
            return {outcome: 'continue', fillFailureReason}
        }
        if(!next) {
            const fillFailureReason = slotDecision?.reason || 'no-activation-intent'
            return {outcome: 'break', fillFailureReason}
        }
        return {outcome: 'proceed', next, activationGuardKey: '', openingActionKey: ''}
    }

    function decideFinalOpenRecoveryOutcome(params = {}) {
        const {next, finalOpenDecision, finalOpenRecovery} = params
        if(finalOpenRecovery?.adopted === true) {
            const fillFailureReason = finalOpenRecovery.reason || 'queued-live-tab-adopted-after-final-open-decline'
            incrementQueueWakeupMetric('pump.changed.adoptedLiveTabAfterFinalOpenDecline')
            recordFlightRecorderEvent({
                kind: 'queued-tab-final-open-recovery',
                source: 'fillQueuedTabsOnce',
                rowKey: next.coordinatorKey || next.profileHref || next.targetProfileHref || next.url || '',
                targetUrl: next.profileHref || next.targetProfileHref || next.url || next.requestedUrl || '',
                attemptId: getAttemptIdFromValue(next),
                attemptNumber: getAttemptNumberFromValue(next),
                runId: next.runId || '',
                tabId: finalOpenRecovery.tabId || null,
                accepted: true,
                changed: true,
                reason: fillFailureReason
            })
            return {outcome: 'continue', recoveredLiveTab: true, fillFailureReason}
        }
        if(finalOpenRecovery?.unresolved === true) {
            const recoveryReason = finalOpenRecovery.reason || 'queued-authority-live-profile-tab-unclassified'
            const fillFailureReason = recoveryReason
            const fillFailureError = finalOpenRecovery.error || finalOpenDecision.error || ''
            incrementQueueWakeupMetric('pump.noop.finalOpenLiveTabUnclassified')
            scheduleCoordinatorQueueResume(1000, recoveryReason, {
                allowBeforeQuora: true
            })
            scheduleCoordinatorReconcile(1000, {
                reason: recoveryReason,
                edgeTriggered: true,
                allowBeforeQuora: true
            })
            return {outcome: 'break', fillFailureReason, fillFailureError}
        }
        if(finalOpenDecision.reason === 'stale-attempt' ||
            finalOpenDecision.reason === 'stale-attempt-number') {
            const pruneReason = 'queued-tab-stale-action-pruned'
            const fillFailureReason = pruneReason
            incrementQueueWakeupMetric('pump.changed.prunedStaleAttemptQueuedAction')
            incrementQueueWakeupMetric('pump.changed.droppedAuthorityStaleQueuedAction')
            recordFlightRecorderEvent({
                kind: 'queued-tab-action-pruned',
                source: 'fillQueuedTabsOnce',
                rowKey: next.coordinatorKey || next.profileHref || next.targetProfileHref || next.url || '',
                targetUrl: next.profileHref || next.targetProfileHref || next.url || next.requestedUrl || '',
                attemptId: getAttemptIdFromValue(next),
                attemptNumber: getAttemptNumberFromValue(next),
                runId: next.runId || '',
                accepted: false,
                changed: true,
                reason: finalOpenDecision.reason || 'stale-attempt'
            })
            scheduleCoordinatorQueueResume(1000, pruneReason, {
                allowBeforeQuora: true
            })
            scheduleCoordinatorReconcile(1000, {
                reason: pruneReason,
                edgeTriggered: true,
                allowBeforeQuora: true
            })
            return {outcome: 'continue', fillFailureReason, prunedStaleAttempt: true}
        }
        if(finalOpenDecision.authorityUnavailable === true) {
            const retryReason = finalOpenDecision.reason || 'queued-tab-final-open-authority-unavailable'
            const actionKey = getQueuedTabActionKey(
                next.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
                next.profileHref || next.coordinatorKey || next.url || '',
                next.tabAction || ''
            )
            const alreadyQueued = actionKey && queueRuntime.someActivationIntent(action => {
                const candidateSubject = action.profileHref || action.coordinatorKey || action.url || ''
                return getQueuedTabActionKey(
                    action.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
                    candidateSubject,
                    action.tabAction || ''
                ) === actionKey
            })
            if(!alreadyQueued) {
                queueRuntime.requeueActivationIntent(next, {
                    source: 'runtime-effect'
                })
                incrementQueueWakeupMetric('pump.changed.requeuedFinalOpenAuthorityUnavailable')
            }
            scheduleCoordinatorQueueResume(QUEUED_TAB_FINAL_OPEN_AUTHORITY_RETRY_MS, retryReason, {
                allowBeforeQuora: true
            })
            scheduleCoordinatorReconcile(QUEUED_TAB_FINAL_OPEN_AUTHORITY_RETRY_MS + 1000, {
                reason: retryReason,
                edgeTriggered: true,
                allowBeforeQuora: true
            })
            const fillFailureReason = retryReason
            const fillFailureError = finalOpenDecision.error || ''
            return {outcome: 'break', fillFailureReason, fillFailureError}
        }
        return {outcome: 'continue'}
    }

    function decidePreOpenRecoveryOutcome(params = {}) {
        const {next, preOpenRecovery} = params
        if(preOpenRecovery?.adopted === true) {
            const fillFailureReason = preOpenRecovery.reason || 'queued-runtime-action-live-tab-adopted-before-open'
            incrementQueueWakeupMetric('pump.changed.adoptedLiveTabBeforeDuplicateOpen')
            recordFlightRecorderEvent({
                kind: 'queued-tab-pre-open-recovery',
                source: 'fillQueuedTabsOnce',
                rowKey: next.coordinatorKey || next.profileHref || next.targetProfileHref || next.url || '',
                targetUrl: next.profileHref || next.targetProfileHref || next.url || next.requestedUrl || '',
                attemptId: getAttemptIdFromValue(next),
                attemptNumber: getAttemptNumberFromValue(next),
                runId: next.runId || '',
                tabId: preOpenRecovery.tabId || null,
                accepted: true,
                changed: true,
                reason: fillFailureReason
            })
            return {outcome: 'continue', recoveredLiveTab: true, fillFailureReason}
        }
        if(preOpenRecovery?.deferred === true) {
            queueRuntime.requeueActivationIntent(next, {
                source: 'runtime-effect'
            })
            const fillFailureReason = preOpenRecovery.reason || 'queued-runtime-action-live-tab-needs-reconcile'
            const fillFailureError = preOpenRecovery.error || ''
            incrementQueueWakeupMetric('pump.noop.deferredDuplicateLiveTabBeforeOpen')
            scheduleCoordinatorQueueResume(1000, fillFailureReason, {
                allowBeforeQuora: true
            })
            scheduleCoordinatorReconcile(1000, {
                reason: fillFailureReason,
                edgeTriggered: true,
                allowBeforeQuora: true
            })
            recordFlightRecorderEvent({
                kind: 'queued-tab-pre-open-recovery',
                source: 'fillQueuedTabsOnce',
                rowKey: next.coordinatorKey || next.profileHref || next.targetProfileHref || next.url || '',
                targetUrl: next.profileHref || next.targetProfileHref || next.url || next.requestedUrl || '',
                attemptId: getAttemptIdFromValue(next),
                attemptNumber: getAttemptNumberFromValue(next),
                runId: next.runId || '',
                accepted: false,
                changed: false,
                reason: fillFailureReason
            })
            return {outcome: 'break', fillFailureReason, fillFailureError}
        }
        return {outcome: 'proceed'}
    }

    function decideLiveProfileTabCapacityGate(params = {}) {
        const {next, liveProfileTabs, openedTabs} = params
        if(queueRuntime.getActiveQueuedTabCount() <= 0 &&
            queueRuntime.getPendingTabActionCount() <= 0 &&
            liveProfileTabs <= 0) {
            clearDetachedQueuedProfileOpenReservations('pre-open-detached-reservation-clear')
        }
        const openReservations = getQueuedProfileOpenReservationCount()
        if(liveProfileTabs + openReservations + openedTabs >= getEffectiveQueuedTabOpenConcurrency()) {
            queueRuntime.requeueActivationIntent(next, {
                source: 'runtime-effect'
            })
            const fillFailureReason = 'live-profile-tab-in-flight'
            incrementQueueWakeupMetric('pump.noop.liveProfileTabInFlight')
            scheduleCoordinatorQueueResume(1000, fillFailureReason, {
                allowBeforeQuora: true
            })
            scheduleCoordinatorReconcile(1000, {
                reason: fillFailureReason,
                edgeTriggered: true,
                allowBeforeQuora: true
            })
            recordFlightRecorderEvent({
                kind: 'queued-tab-open-decision',
                source: 'fillQueuedTabsOnce',
                rowKey: next.coordinatorKey || next.profileHref || next.targetProfileHref || next.url || '',
                targetUrl: next.profileHref || next.targetProfileHref || next.url || next.requestedUrl || '',
                attemptId: getAttemptIdFromValue(next),
                attemptNumber: getAttemptNumberFromValue(next),
                runId: next.runId || '',
                accepted: false,
                changed: false,
                reason: fillFailureReason,
                liveProfileTabs,
                queuedProfileOpenReservations: openReservations
            })
            return {outcome: 'break', fillFailureReason}
        }
        return {outcome: 'proceed'}
    }

    function decidePreOpenPausedGate(params = {}) {
        const {next, cycle, isPaused} = params
        if(!isPaused) return {outcome: 'proceed'}
        queueRuntime.requeueActivationIntent(next, {
            source: 'runtime-effect'
        })
        incrementQueueWakeupMetric('pump.noop.pausedBeforeOpen')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'coordinator-paused', {
            active: queueRuntime.getActiveQueuedTabCount(),
            schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
            remainingActions: queueRuntime.getActivationIntentCount()
        })
        recordFlightRecorderEvent({
            kind: 'fill-decision',
            source: 'fillQueuedTabsOnce',
            reason: 'coordinator-paused',
            accepted: false,
            changed: false
        })
        return {
            outcome: 'return',
            result: {
                openedTabs: 0,
                active: queueRuntime.getActiveQueuedTabCount(),
                schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
                remainingActions: queueRuntime.getActivationIntentCount(),
                reason: 'coordinator-paused',
                paused: true
            }
        }
    }

    function decidePostOpenFailureRecoveryOutcome(params = {}) {
        const {next, postOpenRecovery, openFailureCount, openFailure, now} = params
        if(postOpenRecovery?.adopted === true ||
            postOpenRecovery?.reason === 'queued-runtime-action-already-has-runtime-surface') {
            const fillFailureReason = postOpenRecovery.reason || 'queued-runtime-action-live-tab-adopted-after-open-timeout'
            incrementQueueWakeupMetric('pump.changed.recoveredOpenTimeoutRuntimeSurface')
            scheduleCoordinatorQueueResume(1000, fillFailureReason, {
                allowBeforeQuora: true
            })
            scheduleQueuedWorkContinuation(fillFailureReason)
            return {outcome: 'break', fillFailureReason}
        }
        if(openFailureCount <= 3 && !queueRuntime.hasPausedQueuedOwner(next.ownerTabId)) {
            queueRuntime.requeueActivationIntent({
                ...next,
                openFailureCount,
                lastOpenFailureAt: now,
                lastOpenFailure: openFailure
            }, {
                source: 'runtime-effect'
            })
        }
        scheduleCoordinatorQueueResume(QUEUED_TAB_CREATE_TIMEOUT_MS * 6, 'queued-tab-open-failed', {
            allowBeforeQuora: true
        })
        scheduleQueuedWorkContinuation('queued-tab-open-failed')
        return {outcome: 'break', fillFailureReason: 'queued-tab-open-failed'}
    }

    function decideReturnAfterDurableActiveOutcome(params = {}) {
        const {
            queuedTabFillPromise,
            openPlan,
            openedProgressPatch,
            tab,
            next,
            earlyContentEnsurePromise,
            openedTabs,
            recoveredLiveTabs,
            cycle
        } = params
        let setClearRequested = false
        if(queuedTabFillPromise) {
            resetQueuedTabFillState()
            incrementQueueWakeupMetric('pump.changed.clearedFillPromiseAfterDurableActive')
            incrementQueueWakeupMetric('pump.changed.clearedStaleFillPromise')
            incrementQueueWakeupMetric('pump.changed.clearedIdleStaleFillPromise')
        }
        else {
            setClearRequested = true
        }
        if(openPlan.profileHref && openedProgressPatch) {
            void recordCoordinatorJobProgressViaQueueMachine(openPlan.profileHref, openedProgressPatch, {senderTabId: tab.id})
                .catch(error => {
                    recordCoordinatorDiagnosticEvent(
                        'queued-tab-opened-progress-deferred-failed',
                        error?.message || 'Queued tab opened progress save failed'
                    )
                    scheduleCoordinatorQueueResume(1000, 'queued-tab-opened-progress-deferred-failed', {
                        allowBeforeQuora: true
                    })
                    return null
                })
        }
        const contentEnsurePromise = earlyContentEnsurePromise || promiseWithTimeout(
            ensureQueuedTabContentScript(tab.id, 'queued-tab-opened'),
            QUEUED_TAB_CONTENT_SCRIPT_ENSURE_TIMEOUT_MS,
            'queued tab content script ensure'
        ).catch(error => ({
            ensured: false,
            reason: 'content-script-ensure-failed',
            error: error?.message || `${error || ''}`
        }))
        void contentEnsurePromise.then(result =>
            handleQueuedTabContentScriptEnsureResult(tab.id, result, 'queued-tab-opened-return-after-durable-active')
        ).catch(error => {
            recordCoordinatorDiagnosticEvent('queued-tab-content-ensure-failed', error?.message || 'Queued tab content script ensure result failed')
        })
        scheduleOwnedBlockedProfileSweep(next.ownerTabId, 750)
        void sweepOwnedBlockedProfileTabs(next.ownerTabId)
        scheduleCoordinatorQueueResume(1000, 'queued-tab-opened-return-after-durable-active', {
            allowBeforeQuora: true
        })
        incrementQueueWakeupMetric('job.nextSlotFilled', openedTabs)
        finishQueueWakeupMetricCycle(cycle, 'state-changed', 'opened-tab', {
            openedTabs,
            recoveredLiveTabs,
            active: queueRuntime.getActiveQueuedTabCount(),
            schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
            remainingActions: queueRuntime.getActivationIntentCount(),
            returnAfterDurableActive: true
        })
        recordFlightRecorderEvent({
            kind: 'fill-decision',
            source: 'fillQueuedTabsOnce',
            reason: 'opened-tab',
            accepted: true,
            changed: true
        })
        return {
            setClearRequested,
            result: {
                openedTabs,
                recoveredLiveTabs,
                active: queueRuntime.getActiveQueuedTabCount(),
                schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
                remainingActions: queueRuntime.getActivationIntentCount(),
                reason: 'opened-tab',
                returnAfterDurableActive: true
            }
        }
    }

    function decideFillQueuedTabsOnceOutcome(params = {}) {
        const {openedTabs, recoveredLiveTabs, fillFailureReason, prunedStaleAttemptActions, fillFailureError, cycle} = params
        for(const action of queueRuntime.listActivationIntents()) {
            const untouchedKey = getQueuedRuntimeActionFillKey(action)
            if(untouchedKey) getQueuedTabFillOpeningActionKeys().delete(untouchedKey)
        }

        if(openedTabs > 0 || recoveredLiveTabs > 0) {
            if(openedTabs > 0) {
                incrementQueueWakeupMetric('job.nextSlotFilled', openedTabs)
            }
            const changedReason = openedTabs > 0
                ? 'opened-tab'
                : fillFailureReason || 'queued-live-tab-adopted-after-final-open-decline'
            finishQueueWakeupMetricCycle(cycle, 'state-changed', changedReason, {
                openedTabs,
                recoveredLiveTabs,
                active: queueRuntime.getActiveQueuedTabCount(),
                schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
                remainingActions: queueRuntime.getActivationIntentCount()
            })
            recordFlightRecorderEvent({
                kind: 'fill-decision',
                source: 'fillQueuedTabsOnce',
                reason: changedReason,
                accepted: true,
                changed: true
            })
            return {
                openedTabs,
                recoveredLiveTabs,
                active: queueRuntime.getActiveQueuedTabCount(),
                schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
                remainingActions: queueRuntime.getActivationIntentCount(),
                reason: changedReason
            }
        }
        else {
            incrementQueueWakeupMetric('pump.noop.noPendingItems')
            const noOpenReason = fillFailureReason || (prunedStaleAttemptActions > 0
                ? 'queued-tab-stale-action-pruned'
                : 'no-tab-opened')
            finishQueueWakeupMetricCycle(cycle, 'no-op', noOpenReason, {
                active: queueRuntime.getActiveQueuedTabCount(),
                schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
                remainingActions: queueRuntime.getActivationIntentCount(),
                prunedStaleAttemptActions
            })
            recordFlightRecorderEvent({
                kind: 'fill-decision',
                source: 'fillQueuedTabsOnce',
                reason: noOpenReason,
                accepted: false,
                changed: prunedStaleAttemptActions > 0,
                prunedStaleAttemptActions
            })
            return {
                openedTabs: 0,
                active: queueRuntime.getActiveQueuedTabCount(),
                schedulerBlockingActive: getSchedulerBlockingQueuedExecutorCount(),
                remainingActions: queueRuntime.getActivationIntentCount(),
                reason: noOpenReason,
                prunedStaleAttemptActions,
                authorityUnavailable: /authority-unavailable|final-open-decision-timeout|queue-read-failed/.test(noOpenReason),
                ...(fillFailureError ? {error: fillFailureError} : {})
            }
        }
    }

    return {
        decideQueueLoadThrottleGate,
        decidePausedStateGate,
        decideActivationGuardClaim,
        decideProfileOpenReservationClaim,
        decideSlotOutcome,
        decideFinalOpenRecoveryOutcome,
        decidePreOpenRecoveryOutcome,
        decideLiveProfileTabCapacityGate,
        decidePreOpenPausedGate,
        decidePostOpenFailureRecoveryOutcome,
        decideReturnAfterDurableActiveOutcome,
        decideFillQueuedTabsOnceOutcome
    }
}

module.exports = {createFillQueuedTabsOnceDecisions}
