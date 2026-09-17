// Rolled-back-queued-tab retry classification extracted from sw.js
// (decomposition Slice 23, part 2): the rulebook that decides whether a
// queued coordinator item whose action lease was released (rolled back)
// should be advanced, retried, treated as exhausted, or recovered under
// queue-load pressure, plus the small cluster of executor-action-planning
// and retry-record builders that consume that classification --
// getQueuedActionNoForegroundFallback, markQueuedTabExecutorActionPlanned,
// isQueuedTabRetryBudgetReleaseReason, getExhaustedRolledBackQueuedTabTerminalError,
// shouldAdvanceRolledBackQueuedTabBeforeOpen, getRolledBackQueuedTabRetryAttempt,
// isExhaustedRolledBackQueuedTabRetry, isActiveTransitionRolledBackQueuedTabRetry,
// isRuntimeDisappearedRolledBackQueuedTabRetry, isTransientOpenRolledBackQueuedTabRetry,
// shouldRecoverExhaustedOpenRetryUnderQueuePressure,
// shouldRecoverExhaustedRolledBackQueuedTabRetry,
// wouldActiveMissingTabRequeueExhaustRetryBudget,
// makeExhaustedRolledBackQueuedTerminalizationKey, buildRolledBackQueuedTabRetryAction,
// buildForcedRolledBackQueuedTabRetryItem, buildQueuedDirectBlockActionRetryRecord,
// buildQueuedProfileActionGateRetryRecord, buildCoordinatorExecutorActionForQueuedItem.
//
// This is the second of Slice 23's two modules -- see
// swQueuedRuntimeActionMatching.js's header comment for why the plan's
// single named cluster split into two: this module needs
// isQueuedTabAttemptBudgetExhausted, only available as a bare name once
// swQueuedTabRuntimeStatus.js (Slice 6) constructs, so it constructs later
// in sw.js than swQueuedRuntimeActionMatching.js does (which must construct
// before swActivationGuardRuntime.js, itself before swQueuedTabRuntimeStatus.js).
// No already-extracted module eagerly references any of the 19 names above
// at its own construction call site in sw.js (the only other references
// found in sw.js outside this cluster's own old position are inside
// function bodies, evaluated at call time, not module-eval time, so they
// carry no ordering constraint), so this module constructs in place at the
// cluster's old source-text position, matching the Slice 19/22 precedent.
// One caveat: `planQueuedTabExecutorAction`, textually interleaved between
// buildQueuedProfileActionGateRetryRecord and buildCoordinatorExecutorActionForQueuedItem
// in the original source, is `async` and stays resident in sw.js (out of
// scope for this sync-only slice) -- it is unaffected by this module's
// construction point since it calls markQueuedTabExecutorActionPlanned
// (exported here) only from within its own body, at call time.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. None found -- all nineteen functions
// are plain synchronous predicates/getters/builders over their arguments
// plus already-extracted-module leaf utilities called synchronously, never
// chained.
//
// Clock note: markQueuedTabExecutorActionPlanned and
// shouldRecoverExhaustedOpenRetryUnderQueuePressure both read Date.now()
// directly; buildForcedRolledBackQueuedTabRetryItem,
// buildQueuedDirectBlockActionRetryRecord, and buildQueuedProfileActionGateRetryRecord
// each default an unsupplied `now` parameter to Date.now(). All five are
// threaded through a `now: () => Date.now()` dep instead, per the
// decomposition plan's clock/environment-global note -- this module runs in
// a different V8 realm than sw.js under the test harness's vm sandbox, so a
// bare `Date` reference here would resolve to the real Node clock instead
// of the harness's fake one, even for these synchronous, non-timer call
// sites.

function createRolledBackQueuedTabRetryClassification(deps = {}) {
    const {
        now: getNow = () => Date.now()
    } = deps
    const {
        QUEUE_LOAD_THROTTLE_MAX_MS,
        STALE_QUEUED_TAB_MAX_RETRIES,
        COORDINATOR_EXHAUSTED_ROLLBACK_RECOVERY_LIMIT,
        JOB_EVENT_RETRY
    } = deps.constants || {}
    const {
        isTerminalCoordinatorStatus,
        isActiveCoordinatorStatus,
        isCoordinatorQueueAuthoritativeItem,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getCoordinatorFailureRetryCount,
        getQueuedTabMaxRetries,
        normalizeTabId,
        getQueueLoadThrottle,
        normalizeQuoraProfileUrl,
        normalizeAttemptId,
        isQueuedTabAttemptBudgetExhausted,
        makeAttemptId,
        getNextAttemptNumberFromValue,
        reduceJobEvent,
        getCoordinatorActionKindForRequestedAction,
        applyCoordinatorJobEnvelope,
        makeEmptyCoordinatorMilestones,
        getCoordinatorItemHref,
        getQueuedTabRetryAttempt,
        normalizeProgressPatch,
        getCoordinatorItemExecutorTabAction,
        getCoordinatorItemOpenUrl,
        getCoordinatorItemQueueKey,
        normalizeCoordinatorRequestedUrl,
        isProfileResolutionItem
    } = deps.handlers || {}

    function getQueuedActionNoForegroundFallback(item = null, options = {}) {
        if(item?.executorNoForegroundFallback === false || item?.noForegroundFallback === false) return false
        if(item?.executorNoForegroundFallback === true || item?.noForegroundFallback === true) return true
        return options.noForegroundFallback === true
    }

    function markQueuedTabExecutorActionPlanned(action = {}, decision = {}, reason = 'executor-open-planned') {
        return {
            ...action,
            executorPlanKind: 'open-tab',
            executorPlanReason: reason,
            executorPlanDecisionReason: decision?.reason || '',
            executorPlanAuthorityValidated: decision?.authorityValidated === true,
            executorPlanCreatedAt: getNow()
        }
    }

    function isQueuedTabRetryBudgetReleaseReason(reason = '') {
        const normalized = `${reason || ''}`.trim()
        return normalized === 'active-transition-failed' ||
            normalized === 'queued-tab-release-fast-executor-preflight' ||
            normalized === 'executor-plan-active-transition-retry-budget-exhausted' ||
            /(?:^|-)active-missing-tab(?:-|$)/.test(normalized) ||
            /(?:^|-)profile-tabs-without-active-authority(?:-|$)/.test(normalized) ||
            /(?:^|-)runtime-authority-missing-active-row(?:-|$)/.test(normalized) ||
            /(?:^|-)fast-executor-preflight(?:-|$)/.test(normalized) ||
            /(?:^|-)content-script-(?:ensure-failed|unscriptable|version-mismatch)(?:-|$)/.test(normalized) ||
            /(?:^|-)claim-nudge-not-accepted(?:-|$)/.test(normalized) ||
            /(?:^|-)fresh-content-script-recovery(?:-|$)/.test(normalized) ||
            /(?:^|-)queued-live-tab-adoption-load-pressure(?:-|$)/.test(normalized) ||
            /(?:^|-)queued-tab-final-open-decision-timeout(?:-|$)/.test(normalized) ||
            /(?:^|-)queued-stale-runtime-(?:missing-metadata|missing-queued-action|action-already-pruned|action-drained-before-authority|action-pruned-after-fill-timeout)(?:-|$)/.test(normalized)
    }

    function getExhaustedRolledBackQueuedTabTerminalError(item = null) {
        const reason = `${item?.actionLeaseReleaseReason || ''}`.trim()
        if(reason === 'active-transition-failed' || /(?:^|-)active-transition(?:-|$)/.test(reason)) {
            return 'Queued tab active transition failed after exhausting retry budget'
        }
        if(/(?:^|-)active-missing-tab(?:-|$)/.test(reason) ||
            /(?:^|-)profile-tabs-without-active-authority(?:-|$)/.test(reason) ||
            /(?:^|-)runtime-authority-missing-active-row(?:-|$)/.test(reason)) {
            return 'Queued tab runtime disappeared after exhausting retry budget'
        }
        return 'Queued tab failed to open after exhausting retry budget'
    }

    function shouldAdvanceRolledBackQueuedTabBeforeOpen(item = null) {
        if(!item || isTerminalCoordinatorStatus(item.status) || isActiveCoordinatorStatus(item.status)) return false
        return isQueuedTabRetryBudgetReleaseReason(item.actionLeaseReleaseReason) &&
            !!getAttemptIdFromValue(item) &&
            !!getAttemptNumberFromValue(item)
    }

    function getRolledBackQueuedTabRetryAttempt(item = {}) {
        return Math.max(
            getCoordinatorFailureRetryCount(item),
            Number.parseInt(item?.retryAttempt, 10) || 0
        )
    }

    function getExhaustedRolledBackRecoveryCount(item = null) {
        return Number.parseInt(item?.exhaustedRolledBackRecoveryCount, 10) || 0
    }

    function isExhaustedRolledBackQueuedTabRetry(item = null) {
        if(!shouldAdvanceRolledBackQueuedTabBeforeOpen(item)) return false
        return getRolledBackQueuedTabRetryAttempt(item) >= getQueuedTabMaxRetries(item)
    }

    function isActiveTransitionRolledBackQueuedTabRetry(item = null) {
        const reason = `${item?.actionLeaseReleaseReason || ''}`.trim()
        return reason === 'active-transition-failed' || /(?:^|-)active-transition(?:-|$)/.test(reason)
    }

    function isRuntimeDisappearedRolledBackQueuedTabRetry(item = null) {
        const reason = `${item?.actionLeaseReleaseReason || ''}`.trim()
        return /(?:^|-)active-missing-tab(?:-|$)/.test(reason) ||
            /(?:^|-)profile-tabs-without-active-authority(?:-|$)/.test(reason) ||
            /(?:^|-)runtime-authority-missing-active-row(?:-|$)/.test(reason)
    }

    function isTransientOpenRolledBackQueuedTabRetry(item = null) {
        const reason = `${item?.actionLeaseReleaseReason || ''}`.trim()
        if(!reason) return false
        if(isActiveTransitionRolledBackQueuedTabRetry(item)) return false
        if(isRuntimeDisappearedRolledBackQueuedTabRetry(item)) {
            return false
        }
        return isQueuedTabRetryBudgetReleaseReason(reason)
    }

    function shouldRecoverExhaustedOpenRetryUnderQueuePressure(item = null, options = {}) {
        if(options.recoverQueueLoadPressure !== true) return false
        if(!item || !isTransientOpenRolledBackQueuedTabRetry(item)) return false
        if(!isCoordinatorQueueAuthoritativeItem(item)) return false
        if(options.serviceWorkerOwned !== true &&
            item?.serviceWorkerOwned !== true &&
            item?.executorOwner !== 'service-worker') {
            return false
        }
        if(normalizeTabId(item?.tabId || item?.activeTabId || null)) return false
        if((Number.parseInt(item?.activeAt, 10) || 0) > 0) return false

        const throttle = getQueueLoadThrottle()
        const pressureReason = `${throttle?.reason || ''}`.trim()
        if(throttle?.active === true &&
            /(?:content-script|claim-nudge|storage|loading|unscriptable|queue-load)/i.test(pressureReason)) {
            return true
        }

        const lastPressureAt = Number.parseInt(throttle?.lastPressureAt, 10) || 0
        return lastPressureAt > 0 &&
            getNow() - lastPressureAt <= QUEUE_LOAD_THROTTLE_MAX_MS &&
            /(?:content-script|claim-nudge|storage|loading|unscriptable|queue-load)/i.test(pressureReason)
    }

    function shouldRecoverExhaustedRolledBackQueuedTabRetry(item = null, options = {}) {
        if(!isExhaustedRolledBackQueuedTabRetry(item)) return false
        // Gates every branch below, not just queueOnlyAuthority's shortcut:
        // runCoordinatorAuthorityReconcileActions hardcodes
        // recoverActiveTransitionFailures: true on its own EXHAUSTED_ROLLBACK_SETTLE
        // dispatch regardless of what ITS caller asked for, so a row whose
        // actionLeaseReleaseReason matches isActiveTransitionRolledBackQueuedTabRetry
        // (or the runtime-disappeared/transient-open checks below) would sail
        // through that branch uncapped even with the queueOnlyAuthority
        // shortcut closed off. A row that keeps genuinely, persistently
        // failing needs to actually reach the terminalize path eventually,
        // through whichever branch would otherwise keep rescuing it.
        if(getExhaustedRolledBackRecoveryCount(item) >= COORDINATOR_EXHAUSTED_ROLLBACK_RECOVERY_LIMIT) {
            return false
        }
        if(options.queueOnlyAuthority === true) return true
        if(options.recoverActiveTransitionFailures !== true) return false
        const activeTransitionRetry = isActiveTransitionRolledBackQueuedTabRetry(item)
        const runtimeDisappearedRetry = isRuntimeDisappearedRolledBackQueuedTabRetry(item)
        const transientOpenRetry = isTransientOpenRolledBackQueuedTabRetry(item)
        const pressureOpenRetry = shouldRecoverExhaustedOpenRetryUnderQueuePressure(item, options)
        if(!activeTransitionRetry &&
            !runtimeDisappearedRetry &&
            !(transientOpenRetry && (options.recoverTransientOpenRetry === true || pressureOpenRetry))) {
            return false
        }
        return isCoordinatorQueueAuthoritativeItem(item) &&
            (options.serviceWorkerOwned === true ||
                item?.serviceWorkerOwned === true ||
                item?.executorOwner === 'service-worker')
    }

    function wouldActiveMissingTabRequeueExhaustRetryBudget(item = null) {
        if(!item || !isActiveCoordinatorStatus(item.status)) return false
        if(!getAttemptIdFromValue(item) || !getAttemptNumberFromValue(item)) return false
        return getRolledBackQueuedTabRetryAttempt(item) + 1 >= getQueuedTabMaxRetries(item)
    }

    function makeExhaustedRolledBackQueuedTerminalizationKey(itemKey = '', itemOrAttempt = {}, attemptNumber = 0) {
        const normalizedKey = normalizeQuoraProfileUrl(itemKey || '') || `${itemKey || ''}`.trim()
        const attemptId = typeof itemOrAttempt === 'string'
            ? normalizeAttemptId(itemOrAttempt)
            : getAttemptIdFromValue(itemOrAttempt)
        const normalizedAttemptNumber = Number.parseInt(
            typeof itemOrAttempt === 'string' ? attemptNumber : getAttemptNumberFromValue(itemOrAttempt),
            10
        ) || 0
        return `${normalizedKey}|${attemptId}|${normalizedAttemptNumber}`
    }

    function buildRolledBackQueuedTabRetryAction(item = {}, action = {}) {
        const sourceAttemptId = getAttemptIdFromValue(item)
        const sourceAttemptNumber = getAttemptNumberFromValue(item)
        if(!sourceAttemptId || !sourceAttemptNumber) return null

        const retryAttempt = getRolledBackQueuedTabRetryAttempt(item)
        const maxRetries = getQueuedTabMaxRetries(item)
        if(retryAttempt >= maxRetries || isQueuedTabAttemptBudgetExhausted(item)) return null

        return {
            ...action,
            retryAttempt: retryAttempt + 1,
            sourceAttemptId,
            sourceAttemptNumber,
            allowActiveTransitionAfterRollback: true,
            attemptId: makeAttemptId(),
            attemptNumber: getNextAttemptNumberFromValue(item),
            maxRetries
        }
    }

    function buildForcedRolledBackQueuedTabRetryItem(item = {}, now = getNow(), reason = 'executor-plan-active-transition-retry-budget-recovered') {
        const sourceAttemptId = getAttemptIdFromValue(item)
        const sourceAttemptNumber = getAttemptNumberFromValue(item)
        if(!sourceAttemptId || !sourceAttemptNumber) return null

        const retryAttempt = getRolledBackQueuedTabRetryAttempt(item)
        const attemptId = makeAttemptId()
        const attemptNumber = getNextAttemptNumberFromValue(item)
        const nextRetryAttempt = retryAttempt + 1
        const maxRetries = Math.max(getQueuedTabMaxRetries(item), nextRetryAttempt + 1)
        const configuredMaxAttempts = Math.max(
            Number.parseInt(item?.attempt?.max, 10) || 0,
            Number.parseInt(item?.maxAttempts, 10) || 0
        )
        const maxAttempts = Math.max(configuredMaxAttempts, attemptNumber + 1, maxRetries + 1)
        const reduced = reduceJobEvent(item, {
            type: JOB_EVENT_RETRY,
            sourceAttemptId,
            sourceAttemptNumber,
            attemptId,
            attemptNumber,
            at: now,
            retryCount: nextRetryAttempt,
            lastRetryAt: now
        })
        if(!reduced.accepted) return null

        const actionKind = getCoordinatorActionKindForRequestedAction(item.actionKind || item.tabAction || item.executorTabAction || '')
        return applyCoordinatorJobEnvelope({
            ...reduced.item,
            attempt: {
                id: attemptId,
                number: attemptNumber,
                max: maxAttempts
            },
            attemptId,
            attemptNumber,
            maxAttempts,
            actionKind,
            status: 'queued',
            outcome: '',
            error: '',
            updatedAt: now,
            queuedAt: now,
            activeAt: 0,
            terminalAt: 0,
            tabId: null,
            retryAttempt: nextRetryAttempt,
            maxRetries,
            actionLease: null,
            actionLeaseReleasedAt: now,
            actionLeaseReleaseReason: reason,
            milestones: makeEmptyCoordinatorMilestones(),
            exhaustedRolledBackRecoveryCount: getExhaustedRolledBackRecoveryCount(item) + 1
        }, {
            runInput: {id: item.runId || '', sourceType: item.source?.type || item.scope?.type || ''},
            source: item.source || {},
            runId: item.runId || '',
            targetProfileHref: getCoordinatorItemHref(item),
            requestedUrl: item.requestedUrl || getCoordinatorItemHref(item),
            coordinatorKey: item.coordinatorKey || getCoordinatorItemHref(item),
            actionKind
        })
    }

    function buildQueuedDirectBlockActionRetryRecord(item = {}, record = {}, now = getNow()) {
        const retryAttempt = getQueuedTabRetryAttempt(item, record)
        const nextRetryAttempt = retryAttempt + 1
        const maxRetries = Math.max(getQueuedTabMaxRetries(item, record), nextRetryAttempt + 1)
        return normalizeProgressPatch(getCoordinatorItemHref(item) || record.profileHref || '', {
            ...record,
            status: 'queued',
            outcome: '',
            error: '',
            finalError: '',
            terminalAt: 0,
            completedAt: 0,
            tabClosedAt: 0,
            actionKind: record.actionKind || item.actionKind || 'mute-block',
            runId: record.runId || item.runId || '',
            queuedAt: now,
            retryAttempt: nextRetryAttempt,
            maxRetries,
            attemptId: makeAttemptId(),
            attemptNumber: getNextAttemptNumberFromValue(item),
            directBlockFailureDetail: null,
            directBlockRetryRecovery: true,
            event: 'Queued direct block action did not complete; retrying queued action',
            replaceProgressRecord: true
        }, record)
    }

    function buildQueuedProfileActionGateRetryRecord(item = {}, record = {}, now = getNow()) {
        const retryAttempt = getQueuedTabRetryAttempt(item, record)
        const nextRetryAttempt = retryAttempt + 1
        const maxRetries = Math.max(getQueuedTabMaxRetries(item, record), nextRetryAttempt + 1)
        return normalizeProgressPatch(getCoordinatorItemHref(item) || record.profileHref || '', {
            ...record,
            status: 'queued',
            outcome: '',
            error: '',
            finalError: '',
            terminalAt: 0,
            completedAt: 0,
            tabClosedAt: 0,
            openedViablePage: false,
            actionKind: record.actionKind || item.actionKind || 'mute-block',
            runId: record.runId || item.runId || '',
            queuedAt: now,
            retryAttempt: nextRetryAttempt,
            maxRetries,
            attemptId: makeAttemptId(),
            attemptNumber: getNextAttemptNumberFromValue(item),
            profileActionGateRetryRecovery: true,
            event: 'Queued profile action did not receive profile action gate; retrying queued action',
            replaceProgressRecord: true
        }, record)
    }

    function buildCoordinatorExecutorActionForQueuedItem(item = {}, ownerTabId = null, ownerWindowId = null, options = {}) {
        const tabAction = getCoordinatorItemExecutorTabAction(item, options.tabAction)
        const fallbackKey = `${options.fallbackKey || ''}`.trim()
        const url = getCoordinatorItemOpenUrl(item, fallbackKey)
        const normalizedHref = getCoordinatorItemHref(item)
        const coordinatorKey = getCoordinatorItemQueueKey(item, fallbackKey)
        const actionSubjectKey = normalizedHref || coordinatorKey
        if(!url || !actionSubjectKey) return null

        const requestedActionKind = getCoordinatorActionKindForRequestedAction(item?.actionKind || tabAction)
        const noForegroundFallback = getQueuedActionNoForegroundFallback(item, options)
        return {
            url,
            profileHref: normalizedHref || '',
            coordinatorKey,
            requestedUrl: normalizeCoordinatorRequestedUrl(isProfileResolutionItem(item) ? url : item?.requestedUrl || url),
            resolutionMode: item?.resolutionMode || '',
            resolveProfileFromPage: item?.resolveProfileFromPage === true,
            resolutionReason: item?.resolutionReason || '',
            candidateConfidence: item?.candidateConfidence || '',
            candidateCollector: item?.candidateCollector || '',
            tabAction,
            actionKind: requestedActionKind,
            jobKey: item.jobKey || '',
            scope: item.scope || null,
            canonicalSubject: item.canonicalSubject || null,
            attempt: item.attempt || null,
            runId: item.runId || '',
            ownerTabId,
            ownerWindowId,
            noForegroundFallback,
            retryAttempt: 0,
            attemptId: getAttemptIdFromValue(item),
            attemptNumber: getAttemptNumberFromValue(item),
            maxRetries: STALE_QUEUED_TAB_MAX_RETRIES
        }
    }

    return {
        getQueuedActionNoForegroundFallback,
        markQueuedTabExecutorActionPlanned,
        isQueuedTabRetryBudgetReleaseReason,
        getExhaustedRolledBackQueuedTabTerminalError,
        shouldAdvanceRolledBackQueuedTabBeforeOpen,
        getRolledBackQueuedTabRetryAttempt,
        isExhaustedRolledBackQueuedTabRetry,
        isActiveTransitionRolledBackQueuedTabRetry,
        isRuntimeDisappearedRolledBackQueuedTabRetry,
        isTransientOpenRolledBackQueuedTabRetry,
        shouldRecoverExhaustedOpenRetryUnderQueuePressure,
        shouldRecoverExhaustedRolledBackQueuedTabRetry,
        wouldActiveMissingTabRequeueExhaustRetryBudget,
        makeExhaustedRolledBackQueuedTerminalizationKey,
        buildRolledBackQueuedTabRetryAction,
        buildForcedRolledBackQueuedTabRetryItem,
        buildQueuedDirectBlockActionRetryRecord,
        buildQueuedProfileActionGateRetryRecord,
        buildCoordinatorExecutorActionForQueuedItem
    }
}

module.exports = {
    createRolledBackQueuedTabRetryClassification
}
