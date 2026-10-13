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
//
// 2026-09-17 design correction (P3-5/P3-6, see
// sw-state-machine-decomposition-plan-2026-09-01.md): isQueuedTabRetryBudgetReleaseReason,
// shouldAdvanceRolledBackQueuedTabBeforeOpen, getRolledBackQueuedTabRetryAttempt,
// isExhaustedRolledBackQueuedTabRetry, isActiveTransitionRolledBackQueuedTabRetry,
// isRuntimeDisappearedRolledBackQueuedTabRetry, and isTransientOpenRolledBackQueuedTabRetry
// moved to jobState.js -- they are pure, single-argument functions of a
// queue item alone, so reduceJobEvent's JOB_EVENT_RETRY handling now
// computes them itself instead of trusting a caller-built copy. sw.js (the
// composition root) threads them back into this module's deps.handlers, so
// this module's own exports of the same names are unchanged pass-throughs.
// isCoordinatorQueueAuthoritativeItem stayed in swCoordinatorStatusRules.js
// (its existing canonical home) -- jobState.js keeps its own tiny private
// copy of that one-line check for the reducer's internal use rather than
// taking on a new cross-module dependency.

function createRolledBackQueuedTabRetryClassification(deps = {}) {
    const {
        now: getNow = () => Date.now()
    } = deps
    const {
        QUEUE_LOAD_THROTTLE_MAX_MS,
        STALE_QUEUED_TAB_MAX_RETRIES,
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
        isProfileResolutionItem,
        isQueuedTabRetryBudgetReleaseReason,
        shouldAdvanceRolledBackQueuedTabBeforeOpen,
        getRolledBackQueuedTabRetryAttempt,
        isExhaustedRolledBackQueuedTabRetry,
        isActiveTransitionRolledBackQueuedTabRetry,
        isRuntimeDisappearedRolledBackQueuedTabRetry,
        isTransientOpenRolledBackQueuedTabRetry
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

    // captureQueueLoadPressureReading snapshots the raw, point-in-time
    // queue-load-throttle facts ONCE. Callers that want queue-pressure-based
    // recovery pass the SAME captured reading into both the classification
    // dry run (shouldRecoverExhaustedRolledBackQueuedTabRetry) and the
    // eventual mutation (buildForcedRolledBackQueuedTabRetryItem) via
    // options.queueLoadPressureSnapshot, instead of each re-reading live
    // throttle state moments apart and risking two different answers to the
    // same question (the TOCTOU risk P3-6 flagged as a blocker). The
    // regex/window interpretation of this raw reading now lives in
    // jobState.js's isRecentQueueLoadPressureReading, not here.
    function captureQueueLoadPressureReading() {
        const throttle = getQueueLoadThrottle()
        return {
            active: throttle?.active === true,
            reason: `${throttle?.reason || ''}`.trim(),
            lastPressureAt: Number.parseInt(throttle?.lastPressureAt, 10) || 0
        }
    }

    // buildExhaustedRollbackRecoveryIntent builds the narrow JOB_EVENT_RETRY
    // event.exhaustedRolledBackRecovery payload from this module's own
    // caller-supplied `options` shape: only the caller's recovery-mode
    // intent flags and a raw queue-load-pressure reading travel on the
    // event -- everything else jobState.js's isExhaustedRollbackRecoveryApproved
    // now derives from the item itself. Both call sites below (the
    // classification dry run and the actual recovery mutation) build this
    // same shape from the same `options`, so they always agree.
    function buildExhaustedRollbackRecoveryIntent(options = {}) {
        return {
            queueOnlyAuthority: options.queueOnlyAuthority === true,
            recoverActiveTransitionFailures: options.recoverActiveTransitionFailures === true,
            recoverTransientOpenRetry: options.recoverTransientOpenRetry === true,
            recoverQueueLoadPressure: options.recoverQueueLoadPressure === true,
            serviceWorkerOwned: options.serviceWorkerOwned === true,
            queueLoadPressure: options.queueLoadPressureSnapshot || captureQueueLoadPressureReading()
        }
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

    // Converged onto jobState.js's reduceJobEvent per P3-5/P3-6
    // (sw-state-machine-decomposition-plan-2026-09-01.md, "Part 3 dispatch
    // plan", corrected design 2026-09-17): the three approval paths this
    // function used to branch on by hand -- queueOnlyAuthority's shortcut,
    // the recoverActiveTransitionFailures reason-match, and the
    // queue-pressure check nested inside it -- plus the shared
    // exhaustedRolledBackRecoveryCount cap that closed the
    // infinite-recovery-loop incident, are now one policy,
    // isExhaustedRollbackRecoveryApproved, that reduceJobEvent applies. That
    // policy now computes every item-derived fact itself (isExhausted,
    // reason-pattern matches, queue authority/ownership) directly from
    // `item` -- this function hands it only the caller's own recovery-mode
    // intent flags and a raw queue-load-pressure reading via
    // buildExhaustedRollbackRecoveryIntent, since those are the only things
    // that genuinely can't come from the item.
    //
    // This call is a dry run: reduceJobEvent's returned item is discarded,
    // only `accepted` is read. buildForcedRolledBackQueuedTabRetryItem below
    // builds this exact same intent shape from the same `options` for its
    // own (real) reduceJobEvent call, so the decision and the mutation now
    // agree by construction instead of by (previously incomplete)
    // convention -- see that function's header comment.
    function shouldRecoverExhaustedRolledBackQueuedTabRetry(item = null, options = {}) {
        if(!isExhaustedRolledBackQueuedTabRetry(item)) return false

        const attemptId = getAttemptIdFromValue(item)
        const attemptNumber = getAttemptNumberFromValue(item)
        const now = getNow()
        const reduced = reduceJobEvent(item, {
            type: JOB_EVENT_RETRY,
            attemptId,
            attemptNumber,
            sourceAttemptId: attemptId,
            sourceAttemptNumber: attemptNumber,
            at: now,
            retryCount: getCoordinatorFailureRetryCount(item),
            lastRetryAt: now,
            exhaustedRolledBackRecovery: buildExhaustedRollbackRecoveryIntent(options)
        })
        return reduced.accepted === true
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

    // P3-6 (sw-state-machine-decomposition-plan-2026-09-01.md, "Part 3
    // dispatch plan") originally left this function bumping
    // exhaustedRolledBackRecoveryCount by hand instead of letting the
    // reducer own the increment, blocked on two things: (1) this function
    // had no `options` parameter, and none of its callers threaded the
    // queueOnlyAuthority/recoverActiveTransitionFailures/serviceWorkerOwned/
    // recoverQueueLoadPressure/recoverTransientOpenRetry flags past
    // `applyCoordinatorQueueMachineEvent`'s options envelope; (2)
    // shouldRecoverExhaustedOpenRetryUnderQueuePressure read live, mutable
    // queue-throttle state a second time, so re-deriving the decision here
    // could disagree with the one made moments earlier (TOCTOU).
    //
    // The corrected P3-5/P3-6 design (2026-09-17) resolves both: the event
    // shape shrank from an 11-field, mostly item-derived fact bundle down to
    // five caller-intent flags plus one raw queue-load-pressure reading
    // (see jobState.js's isExhaustedRollbackRecoveryApproved), so threading
    // it through is now a five-call-site `options` widening, not a
    // structural change -- see sw.js's recoverExhaustedRolledBackQueuedCoordinatorItem
    // and its five callers. And callers that enable queue-load-pressure
    // recovery now capture the raw reading ONCE (captureQueueLoadPressureReading,
    // above) and thread that same snapshot through options.queueLoadPressureSnapshot
    // to both the classification dry run and this mutation, closing the
    // TOCTOU gap instead of re-reading live state twice.
    //
    // This function now takes the same `options` its caller already has in
    // scope and builds the identical exhaustedRolledBackRecovery intent
    // shouldRecoverExhaustedRolledBackQueuedTabRetry used for the earlier
    // decision, via the shared buildExhaustedRollbackRecoveryIntent helper.
    // reduceJobEvent re-validates approval against the freshest `item`
    // (which may differ from what the outer decision saw, since this runs
    // inside coordinatorAuthority.applyWithinStorageUpdate's mutate
    // callback) and, on approval, owns the exhaustedRolledBackRecoveryCount
    // increment itself -- the decision and the mutation are now genuinely
    // one reduceJobEvent call applied twice to the same inputs, not two
    // independently-drifting evaluations.
    function buildForcedRolledBackQueuedTabRetryItem(item = {}, now = getNow(), reason = 'executor-plan-active-transition-retry-budget-recovered', options = {}) {
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
            lastRetryAt: now,
            exhaustedRolledBackRecovery: buildExhaustedRollbackRecoveryIntent(options)
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
            milestones: makeEmptyCoordinatorMilestones()
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
        captureQueueLoadPressureReading,
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
