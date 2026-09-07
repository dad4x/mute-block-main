// Resume-queue-execution decide functions extracted from sw.js (decomposition
// Slices P2-18 through P2-21): decideResumeCoordinatorLocallyPausedOutcome,
// decideResumeCoordinatorStoredPausedOutcome, decideResumeShouldRevalidateFillOutcome,
// decideResumeShouldUseFallbackOutcome, decideResumeRawQueueFallbackItems,
// decideResumeWalQueueFallbackItems, decideResumeCoordinatorQueueExecutionOnceOutcome.
// All seven were decomposed out of resumeCoordinatorQueueExecutionOnce, which
// remains in sw.js and calls back into each of these in turn.
//
// This module's construction call in sw.js is placed after
// swSchedulerAlarmBookkeeping's destructure (isCoordinatorPauseRequestedLocally
// and normalizeRawCoordinatorQueueForReconcileFallback come from there) even
// though these functions' original source-text location was earlier in the
// file -- as plain hoisted function declarations they could close over those
// names before they were assigned, since they're only called well after the
// whole module finishes loading; as deps threaded through a construction call,
// they can't be referenced before their const declarations are reached.

function createResumeQueueExecutionDecisions(deps = {}) {
    const {
        isCoordinatorPauseRequestedLocally,
        incrementQueueWakeupMetric,
        finishQueueWakeupMetricCycle,
        COORDINATOR_PAUSED_KEY,
        COORDINATOR_QUEUE_KEY,
        queueRuntime,
        normalizeRawCoordinatorQueueForReconcileFallback,
        normalizeCoordinatorMap,
        getCoordinatorQueueWorkCounts
    } = deps.handlers || {}

    function decideResumeCoordinatorLocallyPausedOutcome(params = {}) {
        const {cycle} = params
        if(!isCoordinatorPauseRequestedLocally()) return null
        incrementQueueWakeupMetric('pump.noop.paused')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'coordinator-paused')
        return {queued: 0, pending: 0, reason: 'coordinator-paused', paused: true}
    }

    function decideResumeCoordinatorStoredPausedOutcome(params = {}) {
        const {cycle, pausedState} = params
        if(!pausedState[COORDINATOR_PAUSED_KEY]) return null
        incrementQueueWakeupMetric('pump.noop.paused')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'coordinator-paused')
        return {queued: 0, pending: 0, reason: 'coordinator-paused'}
    }

    function decideResumeShouldRevalidateFillOutcome(params = {}) {
        const {options, applyResult} = params
        return options.awaitFill !== false &&
            queueRuntime.getActivationIntentCount() &&
            !isCoordinatorPauseRequestedLocally() &&
            applyResult.reason !== 'coordinator-paused' &&
            applyResult.reason !== 'no-coordinator'
    }

    function decideResumeShouldUseFallbackOutcome(params = {}) {
        const {serviceWorkerOwned, options, shouldUseProjectionFallbackForResume, applyResult} = params
        return serviceWorkerOwned &&
            options.awaitFill !== false &&
            shouldUseProjectionFallbackForResume &&
            !((options.returnAfterDurableActive === true || serviceWorkerOwned) && queueRuntime.getActiveQueuedTabCount() > 0) &&
            applyResult?.fillResult?.timedOut !== true &&
            applyResult?.fillResult?.authorityUnavailable !== true &&
            applyResult?.fillResult?.reason !== 'queued-tab-open-failed' &&
            applyResult?.fillResult?.reason !== 'queued-tab-fill-timeout' &&
            applyResult?.fillResult?.reason !== 'queued-tab-final-open-decision-timeout' &&
            (Number.parseInt(applyResult?.active, 10) || 0) <= 0 &&
            (Number.parseInt(applyResult?.fillResult?.active, 10) || 0) <= 0 &&
            (Number.parseInt(applyResult?.fillResult?.openedTabs, 10) || 0) <= 0 &&
            (Number.parseInt(applyResult?.fillResult?.recoveredLiveTabs, 10) || 0) <= 0
    }

    function decideResumeRawQueueFallbackItems(params = {}) {
        const {rawQueueState} = params
        const rawQueue = rawQueueState?.[COORDINATOR_PAUSED_KEY] === true
            ? {}
            : normalizeRawCoordinatorQueueForReconcileFallback(
                normalizeCoordinatorMap(rawQueueState?.[COORDINATOR_QUEUE_KEY] || {})
            )
        const pendingRawItems = Object.values(rawQueue).filter(item => `${item?.status || ''}`.trim() === 'queued')
        return {rawQueue, pendingRawItems}
    }

    function decideResumeWalQueueFallbackItems(params = {}) {
        const {walAuthorityState} = params
        const walQueueCounts = getCoordinatorQueueWorkCounts(walAuthorityState?.queue || {})
        const pendingWalItems = Object.values(walAuthorityState?.queue || {})
            .filter(item => `${item?.status || ''}`.trim() === 'queued')
        return {walQueueCounts, pendingWalItems}
    }

    function decideResumeCoordinatorQueueExecutionOnceOutcome(params = {}) {
        const {applyResult, cycle} = params
        if(applyResult.reason === 'executor-already-running') {
            finishQueueWakeupMetricCycle(cycle, 'no-op', 'executor-already-running', {
                active: applyResult.active || 0,
                runtimeActive: applyResult.runtimeActive || 0,
                provisionalActive: Math.max(0, (applyResult.runtimeActive || 0) - (applyResult.active || 0)),
                queuedActions: queueRuntime.getActivationIntentCount(),
                fillReason: applyResult.fillReason || ''
            })
            return {
                queued: 0,
                pending: applyResult.pending || 0,
                active: applyResult.active || 0,
                reason: 'executor-already-running'
            }
        }

        if(applyResult.reason === 'coordinator-paused') {
            finishQueueWakeupMetricCycle(cycle, 'no-op', 'coordinator-paused')
            return {queued: 0, pending: 0, reason: 'coordinator-paused'}
        }

        if(applyResult.queued > 0 || applyResult.adopted > 0) {
            finishQueueWakeupMetricCycle(cycle, 'state-changed', applyResult.reason, {
                queued: applyResult.queued || 0,
                pending: applyResult.pending || 0,
                adopted: applyResult.adopted || 0,
                terminalizedExhausted: applyResult.terminalizedExhausted || 0
            })
        }
        else if(applyResult.terminalizedExhausted > 0) {
            finishQueueWakeupMetricCycle(cycle, 'state-changed', applyResult.reason, {
                pending: applyResult.pending || 0,
                adopted: applyResult.adopted || 0,
                terminalizedExhausted: applyResult.terminalizedExhausted || 0
            })
        }
        else {
            finishQueueWakeupMetricCycle(cycle, 'no-op', applyResult.reason, {
                pending: applyResult.pending || 0,
                adopted: applyResult.adopted || 0
            })
        }

        return {
            queued: applyResult.queued || 0,
            pending: applyResult.pending || 0,
            active: applyResult.active,
            adopted: applyResult.adopted || 0,
            requeued: applyResult.requeued || 0,
            terminalizedExhausted: applyResult.terminalizedExhausted || 0,
            fillResult: applyResult.fillResult || null,
            reason: applyResult.reason
        }
    }

    return {
        decideResumeCoordinatorLocallyPausedOutcome,
        decideResumeCoordinatorStoredPausedOutcome,
        decideResumeShouldRevalidateFillOutcome,
        decideResumeShouldUseFallbackOutcome,
        decideResumeRawQueueFallbackItems,
        decideResumeWalQueueFallbackItems,
        decideResumeCoordinatorQueueExecutionOnceOutcome
    }
}

module.exports = {createResumeQueueExecutionDecisions}
