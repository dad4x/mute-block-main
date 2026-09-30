// Executor enqueue-failure / materialization-capacity classification
// extracted from sw.js (decomposition Slice 25):
// buildEnqueueFailureTerminalizationDiagnostics, getCoordinatorFailureClassification,
// buildCoordinatorFailureClassification, isExecutorMaterializationDeferredByCapacity,
// isQueuedExecutorCapacityConsumed, isExecutorEnqueueTimeoutStillMaterializing,
// coordinatorItemHasExecutorOpenAttempt, normalizeQueuedAuthorityEnqueueMaterializationReason,
// shouldTreatCapacityDeferralAsNoOpenForRow, normalizeQueuedAuthorityEnqueueMaterializationReasonForRow,
// getQueuedAuthorityEnqueueMaterializationReason, hasBlockingRuntimeSurfaceAfterEnqueueFailure,
// shouldRecoverLiveSurfaceAfterFinalOpenDecline.
//
// This exactly matches the plan's Slice 25 starting list (confirmed
// exhaustive by re-grepping the inventory around lines 10015-10251: the
// cluster is bounded above by the async terminalizeExhaustedRolledBack-
// QueuedCoordinatorItems (line 9827) and below by the async
// recoverQueuedAuthorityLiveTabAfterMaterializationFailure (line 10252),
// with no interleaved sync function this list missed).
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. None found -- all thirteen functions
// are plain synchronous data-in/data-out logic.
//
// Clock note: none of these read Date.now() or any other environment-faked
// global, so no `now` dep is needed.
//
// External deps: buildEnqueueFailureTerminalizationDiagnostics,
// isExecutorMaterializationDeferredByCapacity, isQueuedExecutorCapacityConsumed,
// and isExecutorEnqueueTimeoutStillMaterializing call into queueRuntime
// (already-extracted swqueueRuntime.js instance) and getDurablyActiveQueuedTabCount
// (already-extracted swQueuedTabRuntimeStatus.js). isQueuedExecutorCapacityConsumed
// also calls getSchedulerBlockingQueuedExecutorCount (swQueuedTabRuntimeStatus.js),
// getQueuedProfileOpenReservationCount (swActivationGuardRuntime.js), and
// getEffectiveQueuedTabConcurrency (still a plain hoisted function declaration
// further below in sw.js). coordinatorItemHasExecutorOpenAttempt calls
// normalizeTabId (already-extracted swTabIdUtils.js). All threaded through
// as handler deps rather than required directly by this module, matching the
// swQueuedActivationSubjectKeys.js (Slice 24) precedent.
//
// No already-extracted module eagerly references any of these thirteen
// names at its own construction call site in sw.js (grepped across
// shared/js/*.js; the only references anywhere are ordinary runtime calls
// inside async orchestration functions that stay resident in sw.js), so
// this module constructs in place at the cluster's old source-text
// position, matching the Slice 19/22/24 precedent.
//
// shouldRecoverQueuedAuthorityEnqueueFailureUnderPressure added in
// decomposition Slice 43 (mop-up of remaining isolated singles): a natural
// topical fit alongside shouldRecoverLiveSurfaceAfterFinalOpenDecline,
// which it sits right next to in its old sw.js position (immediately before
// the async terminalizeQueuedAuthorityEnqueueFailureCoordinatorItems that
// is its one caller). No async/Promise-chain risk (grepped for `.then(`,
// `.catch(`, `Promise.`, `async`, `setTimeout`, `void` -- none found). It
// reads Date.now() directly, so a `now` clock dep is added for it (none of
// the original thirteen needed one). Its other dependencies --
// isQueuedAuthorityNoSurfaceRetryBudgetExhausted (swQueuedTabRuntimeStatus.js),
// isCoordinatorQueueAuthoritativeItem (swCoordinatorStatusRules.js),
// getQueueLoadThrottle (swQueueWakeupMetricsShape.js), and normalizeTabId
// (already a handler dep of this module) -- are all already-constructed
// bare consts by the time this module constructs in sw.js, so no thunk is
// needed for any of them. QUEUE_LOAD_THROTTLE_MAX_MS is threaded through as
// a new constant.

function createExecutorEnqueueFailureClassification(deps = {}) {
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
    const {
        QUEUE_LOAD_THROTTLE_MAX_MS
    } = deps.constants || {}
    const {
        queueRuntime,
        getDurablyActiveQueuedTabCount,
        getSchedulerBlockingQueuedExecutorCount,
        getQueuedProfileOpenReservationCount,
        getEffectiveQueuedTabOpenConcurrency,
        normalizeTabId,
        isQueuedAuthorityNoSurfaceRetryBudgetExhausted,
        isCoordinatorQueueAuthoritativeItem,
        getQueueLoadThrottle
    } = deps.handlers || {}

    function isQueuedExecutorCapacityConsumed(fillResult = {}) {
        const activeCount = (Number.parseInt(fillResult.active, 10) || 0) ||
            (Number.parseInt(fillResult.schedulerBlockingActive, 10) || 0) ||
            queueRuntime.getActiveQueuedTabCount() ||
            queueRuntime.getPendingTabActionCount() ||
            getSchedulerBlockingQueuedExecutorCount() ||
            getQueuedProfileOpenReservationCount() ||
            getDurablyActiveQueuedTabCount()
        return activeCount >= getEffectiveQueuedTabOpenConcurrency()
    }

    function isExecutorMaterializationDeferredByCapacity(enqueueResult = {}) {
        const fillResult = enqueueResult?.fillResult || {}
        const activeCount = (Number.parseInt(fillResult.active, 10) || 0) ||
            (Number.parseInt(fillResult.schedulerBlockingActive, 10) || 0) ||
            queueRuntime.getActiveQueuedTabCount() ||
            queueRuntime.getPendingTabActionCount() ||
            getDurablyActiveQueuedTabCount()
        const remainingActions = Number.parseInt(fillResult.remainingActions, 10) || 0
        if(remainingActions > 0) return activeCount > 0
        if(fillResult?.reason === 'no-tab-opened' && activeCount > 0) return true
        if(fillResult?.reason !== 'queue-load-throttled') return false
        return activeCount > 0 ||
            queueRuntime.getActiveQueuedTabCount() > 0 ||
            queueRuntime.getPendingTabActionCount() > 0 ||
            getDurablyActiveQueuedTabCount() > 0
    }

    function isExecutorEnqueueTimeoutStillMaterializing(enqueueResult = {}) {
        const fillResult = enqueueResult?.fillResult || {}
        const fillReason = fillResult?.reason || ''
        if(fillReason !== 'queued-tab-fill-timeout' &&
            fillReason !== 'final-open-decision-timeout' &&
            fillReason !== 'queued-tab-final-open-decision-timeout') {
            return false
        }
        return (Number.parseInt(fillResult.remainingActions, 10) || 0) > 0 ||
            (Number.parseInt(fillResult.active, 10) || 0) > 0 ||
            (Number.parseInt(fillResult.schedulerBlockingActive, 10) || 0) > 0 ||
            queueRuntime.getActiveQueuedTabCount() > 0 ||
            queueRuntime.getPendingTabActionCount() > 0 ||
            getDurablyActiveQueuedTabCount() > 0
    }

    function buildEnqueueFailureTerminalizationDiagnostics(enqueueResult = {}, options = {}) {
        const fillResult = enqueueResult?.fillResult || {}
        return {
            terminalizationPolicy: 'enqueue-returned-without-runtime-surface',
            enqueueResultReason: enqueueResult?.reason || '',
            enqueueQueued: enqueueResult?.queued || 0,
            enqueueQueuedKeysCount: Array.isArray(enqueueResult?.queuedKeys) ? enqueueResult.queuedKeys.length : 0,
            enqueueTerminalizedExhausted: enqueueResult?.terminalizedExhausted || 0,
            enqueueTerminalizedExhaustedKeysCount: Array.isArray(enqueueResult?.terminalizedExhaustedKeys)
                ? enqueueResult.terminalizedExhaustedKeys.length
                : 0,
            fillResultReason: fillResult?.reason || '',
            fillOpenedTabs: fillResult?.openedTabs || 0,
            fillActive: fillResult?.active || 0,
            fillSchedulerBlockingActive: fillResult?.schedulerBlockingActive || 0,
            fillRemainingActions: fillResult?.remainingActions || 0,
            fillTimedOut: fillResult?.timedOut === true,
            fillError: fillResult?.error || '',
            runtimeSurfaceBefore: options.runtimeSurfaceBefore === true,
            queuedTabActionsCount: queueRuntime.getActivationIntentCount(),
            activeQueuedTabsCount: queueRuntime.getActiveQueuedTabCount(),
            pendingTabActionsCount: queueRuntime.getPendingTabActionCount(),
            durablyActiveQueuedTabsCount: getDurablyActiveQueuedTabCount()
        }
    }

    function getCoordinatorFailureClassification(reason = '', error = '') {
        const normalizedReason = `${reason || ''}`.trim()
        const normalizedError = `${error || ''}`.trim()
        const joined = `${normalizedReason} ${normalizedError}`.trim()
        if(normalizedReason === 'queued-authority-enqueue-no-open-attempt') return 'no-open-attempt'
        if(normalizedReason === 'queued-authority-enqueue-runtime-materializing' ||
            normalizedReason === 'queued-authority-enqueue-runtime-surface-materialized') {
            return 'runtime-materializing'
        }
        if(normalizedReason === 'queued-tab-stale-action-pruned') return 'stale-queued-action'
        if(normalizedReason === 'queued-tab-final-open-decision-timeout' ||
            /final open decision timed out/i.test(joined) ||
            /final open authority unavailable/i.test(joined)) {
            return 'final-open-authority-timeout'
        }
        if(normalizedReason === 'queued-tab-open-failed') return 'tab-open-failure'
        if(normalizedReason === 'queued-tab-fill-timeout') return 'queued-tab-fill-timeout'
        if(normalizedReason === 'queued-authority-enqueue-did-not-materialize-runtime') return 'no-runtime-surface'
        if(/active-missing-tab/i.test(normalizedReason) ||
            /no confirmed runtime actor/i.test(joined)) {
            return 'actorless-active-without-runtime'
        }
        if(/without active, terminal, or runtime surface/i.test(joined)) return 'no-runtime-surface'
        if(/failed to open after exhausting retry budget/i.test(joined)) return 'tab-open-failure'
        return ''
    }

    function buildCoordinatorFailureClassification(reason = '', error = '', diagnostics = {}) {
        const classification = getCoordinatorFailureClassification(reason, error)
        if(!classification) return null
        const result = {
            classification,
            reason: `${reason || ''}`.trim()
        }
        const errorText = `${error || ''}`.trim()
        if(errorText) result.error = errorText.slice(0, 240)
        for(const field of [
            'terminalizationPolicy',
            'enqueueResultReason',
            'fillResultReason',
            'fillError'
        ]) {
            const value = `${diagnostics?.[field] || ''}`.trim()
            if(value) result[field] = value.slice(0, 240)
        }
        for(const field of [
            'enqueueQueued',
            'fillOpenedTabs',
            'fillActive',
            'fillSchedulerBlockingActive',
            'fillRemainingActions',
            'queuedTabActionsCount',
            'activeQueuedTabsCount',
            'pendingTabActionsCount',
            'durablyActiveQueuedTabsCount'
        ]) {
            const value = Number.parseInt(diagnostics?.[field], 10)
            if(Number.isFinite(value)) result[field] = value
        }
        for(const field of ['fillTimedOut', 'runtimeSurfaceBefore']) {
            if(typeof diagnostics?.[field] === 'boolean') result[field] = diagnostics[field]
        }
        return result
    }

    function coordinatorItemHasExecutorOpenAttempt(item = null) {
        if(!item || typeof item !== 'object') return false
        const milestones = item.milestones && typeof item.milestones === 'object'
            ? item.milestones
            : {}
        return !!normalizeTabId(item.tabId) ||
            (Number.parseInt(milestones.tabCreatedAt, 10) || 0) > 0 ||
            (Number.parseInt(milestones.tabOpenedAt, 10) || 0) > 0 ||
            (Number.parseInt(milestones.contentOpenedAt, 10) || 0) > 0 ||
            (Number.parseInt(milestones.navigationStartedAt, 10) || 0) > 0
    }

    function normalizeQueuedAuthorityEnqueueMaterializationReason(item = null, runtimeSurface = {}, reason = '') {
        if(reason !== 'queued-authority-enqueue-did-not-materialize-runtime') return reason
        if(runtimeSurface?.hasSurface === true) return reason
        return coordinatorItemHasExecutorOpenAttempt(item)
            ? reason
            : 'queued-authority-enqueue-no-open-attempt'
    }

    function shouldTreatCapacityDeferralAsNoOpenForRow(runtimeSurface = {}, enqueueResult = {}) {
        const fillResult = enqueueResult?.fillResult || {}
        if(fillResult?.reason !== 'no-tab-opened') return false
        const fillActive = (Number.parseInt(fillResult.active, 10) || 0) ||
            (Number.parseInt(fillResult.schedulerBlockingActive, 10) || 0)
        const remainingActions = Number.parseInt(fillResult.remainingActions, 10) || 0
        const openedTabs = Number.parseInt(fillResult.openedTabs, 10) || 0
        if(fillActive > 0 || remainingActions > 0 || openedTabs > 0) return false
        return runtimeSurface?.hasSurface !== true
    }

    function normalizeQueuedAuthorityEnqueueMaterializationReasonForRow(reason = '', runtimeSurface = {}, enqueueResult = {}) {
        if(reason === 'queued-authority-enqueue-deferred-by-capacity' &&
            shouldTreatCapacityDeferralAsNoOpenForRow(runtimeSurface, enqueueResult)) {
            return 'queued-authority-enqueue-no-open-attempt'
        }
        return reason
    }

    function getQueuedAuthorityEnqueueMaterializationReason(enqueueResult = {}) {
        const fillReason = enqueueResult?.fillResult?.reason || ''
        if(fillReason === 'queued-tab-open-failed') return 'queued-tab-open-failed'
        if(fillReason === 'queue-capacity-consumed') return 'queued-authority-enqueue-deferred-by-capacity'
        if(fillReason === 'opened-tab') {
            const activeCount = (Number.parseInt(enqueueResult?.fillResult?.active, 10) || 0) ||
                (Number.parseInt(enqueueResult?.fillResult?.schedulerBlockingActive, 10) || 0)
            return activeCount > 0
                ? 'queued-authority-enqueue-runtime-surface-materialized'
                : 'queued-authority-enqueue-did-not-materialize-runtime'
        }
        if(fillReason === 'queued-tab-stale-action-pruned') return 'queued-tab-stale-action-pruned'
        if(fillReason === 'queued-live-tab-adopted-after-final-open-decline' ||
            fillReason === 'queued-live-tab-adopted-after-materialization-timeout') {
            return 'queued-authority-enqueue-runtime-surface-materialized'
        }
        if(fillReason === 'no-tab-opened' &&
            isQueuedExecutorCapacityConsumed(enqueueResult?.fillResult || {})) {
            return 'queued-authority-enqueue-deferred-by-capacity'
        }
        if(fillReason === 'no-tab-opened' &&
            !(Number.parseInt(enqueueResult?.fillResult?.restoredActions, 10) > 0) &&
            isExecutorMaterializationDeferredByCapacity(enqueueResult)) {
            return 'queued-authority-enqueue-deferred-by-capacity'
        }
        if(fillReason === 'no-tab-opened') return 'queued-authority-enqueue-no-open-attempt'
        if(fillReason === 'final-open-decision-timeout' ||
            fillReason === 'queued-tab-final-open-decision-timeout') return 'queued-tab-final-open-decision-timeout'
        if(isExecutorEnqueueTimeoutStillMaterializing(enqueueResult)) {
            return 'queued-authority-enqueue-runtime-materializing'
        }
        if(fillReason === 'queued-tab-fill-timeout') return 'queued-tab-fill-timeout'
        if(isExecutorMaterializationDeferredByCapacity(enqueueResult)) {
            return 'queued-authority-enqueue-deferred-by-capacity'
        }
        return 'queued-authority-enqueue-did-not-materialize-runtime'
    }

    function hasBlockingRuntimeSurfaceAfterEnqueueFailure(runtimeSurface = {}, enqueueResult = {}) {
        if(!runtimeSurface?.hasSurface) return false
        if((runtimeSurface.activeTabs || []).length > 0) return true
        if((runtimeSurface.pendingActions || []).length > 0) return true

        const fillReason = enqueueResult?.fillResult?.reason || ''
        const remainingActions = Number.parseInt(enqueueResult?.fillResult?.remainingActions, 10) || 0
        if((fillReason === 'queued-tab-fill-timeout' ||
                fillReason === 'final-open-decision-timeout') &&
            remainingActions <= 0) {
            return false
        }

        return (runtimeSurface.queuedActions || []).length > 0
    }

    function shouldRecoverLiveSurfaceAfterFinalOpenDecline(decision = {}) {
        const reason = `${decision?.reason || ''}`.trim()
        return decision?.authorityUnavailable === true ||
            reason === 'queued-tab-final-open-decision-timeout' ||
            reason === 'queued-tab-final-open-authority-unavailable' ||
            reason === 'stale-attempt' ||
            reason === 'stale-attempt-number'
    }

    function shouldRecoverQueuedAuthorityEnqueueFailureUnderPressure(item = null, options = {}) {
        if(options.retryBeforeTerminal !== true) return false
        if(!item || `${item.status || ''}`.trim() !== 'queued') return false
        if(!isQueuedAuthorityNoSurfaceRetryBudgetExhausted(item, options.record || null)) return false
        if(!isCoordinatorQueueAuthoritativeItem(item)) return false
        if(options.queueOnlyAuthority !== true &&
            options.serviceWorkerOwned !== true &&
            item?.serviceWorkerOwned !== true &&
            item?.executorOwner !== 'service-worker') {
            return false
        }
        if(normalizeTabId(item?.tabId || item?.activeTabId || null)) return false
        if((Number.parseInt(item?.activeAt, 10) || 0) > 0) return false

        const throttle = getQueueLoadThrottle()
        const pressureReason = `${throttle?.reason || ''}`.trim()
        const pressurePattern = /(?:content-script|claim-nudge|storage|loading|unscriptable|queue-load)/i
        if(throttle?.active === true && pressurePattern.test(pressureReason)) return true

        const lastPressureAt = Number.parseInt(throttle?.lastPressureAt, 10) || 0
        return lastPressureAt > 0 &&
            now() - lastPressureAt <= QUEUE_LOAD_THROTTLE_MAX_MS &&
            pressurePattern.test(pressureReason)
    }

    return {
        buildEnqueueFailureTerminalizationDiagnostics,
        getCoordinatorFailureClassification,
        buildCoordinatorFailureClassification,
        isExecutorMaterializationDeferredByCapacity,
        isQueuedExecutorCapacityConsumed,
        isExecutorEnqueueTimeoutStillMaterializing,
        coordinatorItemHasExecutorOpenAttempt,
        normalizeQueuedAuthorityEnqueueMaterializationReason,
        shouldTreatCapacityDeferralAsNoOpenForRow,
        normalizeQueuedAuthorityEnqueueMaterializationReasonForRow,
        getQueuedAuthorityEnqueueMaterializationReason,
        hasBlockingRuntimeSurfaceAfterEnqueueFailure,
        shouldRecoverLiveSurfaceAfterFinalOpenDecline,
        shouldRecoverQueuedAuthorityEnqueueFailureUnderPressure
    }
}

module.exports = {
    createExecutorEnqueueFailureClassification
}
