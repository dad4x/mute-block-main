// Queued-tab-open effect plan/patch builders extracted from sw.js
// (decomposition Slice 41): buildQueuedTabOpenEffectPlan,
// applyQueuedTabOpenRuntimeEffect, buildQueuedTabOpenedProgressPatch.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement and the plan's Promise-chain realm-crossing note): all three
// functions are plain synchronous data-in/data-out (or data-in/bookkeeping-
// out) functions with no `async`, `.then(`, `.catch(`, `Promise.`, or
// `setTimeout` anywhere in their bodies -- grepped individually to confirm.
// applyQueuedTabOpenRuntimeEffect calls two plain (non-Promise-returning)
// methods on the already-extracted queueRuntime module
// (queueRuntime.addActiveQueuedTab, queueRuntime.setPendingTabAction), which
// carries no realm penalty: the note only applies to a Promise/`.then()`
// chain reaching into another module, not to an ordinary synchronous method
// call. None of the three build or return a Promise.
//
// Clock note: buildQueuedTabOpenEffectPlan's own default parameter reads
// `Date.now()` directly (`openedAt = Date.now()`) -- threaded through as
// `now: () => Date.now()`, with the default parameter now reading `now()`.
// The other two functions have no Date.now() calls.
//
// getAttemptNumberFromValue, getAttemptIdFromValue, makeAttemptId,
// getQueuedTabMaxRetries, normalizeQuoraProfileUrl,
// makeProfileResolutionQueueKey, normalizeCoordinatorRequestedUrl,
// normalizeTabTargetUrl, normalizeTabId, setQueuedTabMetadata, and
// registerOwnedTab are all already bare consts (from earlier-constructed
// modules) or top-of-file requires well before this module's construction
// point (its old source-text position, unchanged) -- no already-extracted
// module eagerly references any of this slice's three names at its own
// construction call site in sw.js, so no early-construction ordering
// constraint applies here. queueRuntime (constructed at the very top of
// sw.js, line ~253) is threaded through directly.

function createQueuedTabOpenEffect(deps = {}) {
    const {
        now = () => Date.now()
    } = deps
    const {
        queueRuntime,
        getAttemptNumberFromValue,
        getAttemptIdFromValue,
        makeAttemptId,
        getQueuedTabMaxRetries,
        normalizeQuoraProfileUrl,
        makeProfileResolutionQueueKey,
        normalizeCoordinatorRequestedUrl,
        normalizeTabTargetUrl,
        normalizeTabId,
        setQueuedTabMetadata,
        registerOwnedTab
    } = deps.handlers || {}

    function buildQueuedTabOpenEffectPlan(action = {}, tab = {}, openedAt = now()) {
        const retryAttempt = Number.parseInt(action.retryAttempt, 10) || 0
        const attemptNumber = getAttemptNumberFromValue(action) || retryAttempt + 1
        const attemptId = getAttemptIdFromValue(action) || makeAttemptId()
        const maxRetries = getQueuedTabMaxRetries(action)
        const actionKind = action.actionKind || (action.tabAction === 'nuke' ? 'mute-block' : action.tabAction || null)
        const profileHref = normalizeQuoraProfileUrl(action.profileHref || action.targetProfileHref || action.url || '')
        const coordinatorKey = action.coordinatorKey || (profileHref ? profileHref : makeProfileResolutionQueueKey(action.requestedUrl || action.url || ''))
        const requestedUrl = normalizeCoordinatorRequestedUrl(action.requestedUrl || action.url || '')
        const lastUrl = tab.url || normalizeTabTargetUrl(action.url)
        const tabWindowId = Number.parseInt(tab?.windowId, 10) || null
        const actionSurfaceMode = action.actionSurfaceMode || ''
        const actionSurfaceWindowId = action.actionSurfaceWindowId ||
            (actionSurfaceMode === 'worker-window' ? tabWindowId : null)
        const ownerWindowId = action.ownerWindowId || tabWindowId || null

        return {
            action,
            tab,
            retryAttempt,
            attemptId,
            attemptNumber,
            maxRetries,
            openedAt,
            actionKind,
            profileHref,
            coordinatorKey,
            requestedUrl,
            metadata: {
                profileHref,
                coordinatorKey,
                requestedUrl,
                resolutionMode: action.resolutionMode || '',
                resolveProfileFromPage: action.resolveProfileFromPage === true,
                resolutionReason: action.resolutionReason || '',
                candidateConfidence: action.candidateConfidence || '',
                candidateCollector: action.candidateCollector || '',
                ownerTabId: action.ownerTabId || null,
                ownerWindowId,
                actionSurfaceMode,
                actionSurfaceWindowId,
                actionSurfaceAnchorTabId: action.actionSurfaceAnchorTabId || null,
                actionSurfaceActivatedAt: action.actionSurfaceActivatedAt || 0,
                runId: action.runId || '',
                tabAction: action.tabAction || null,
                actionKind,
                jobKey: action.jobKey || '',
                scope: action.scope || null,
                canonicalSubject: action.canonicalSubject || null,
                attempt: action.attempt || null,
                noForegroundFallback: !!action.noForegroundFallback,
                retryAttempt,
                attemptId,
                attemptNumber,
                maxRetries,
                openedAt,
                lastUrl
            },
            pendingAction: {
                action: action.tabAction || null,
                profileHref,
                targetUrl: profileHref || '',
                coordinatorKey,
                requestedUrl,
                resolutionMode: action.resolutionMode || '',
                resolveProfileFromPage: action.resolveProfileFromPage === true,
                resolutionReason: action.resolutionReason || '',
                candidateConfidence: action.candidateConfidence || '',
                candidateCollector: action.candidateCollector || '',
                actionKind,
                jobKey: action.jobKey || '',
                scope: action.scope || null,
                canonicalSubject: action.canonicalSubject || null,
                attempt: action.attempt || null,
                runId: action.runId || '',
                ownerTabId: action.ownerTabId || null,
                ownerWindowId,
                actionSurfaceMode,
                actionSurfaceWindowId,
                actionSurfaceAnchorTabId: action.actionSurfaceAnchorTabId || null,
                noForegroundFallback: !!action.noForegroundFallback,
                attemptId,
                attemptNumber
            },
            activeTransitionDetails: {
                retryAttempt,
                attemptId,
                attemptNumber,
                maxRetries,
                allowActiveTransitionAfterRollback: action.allowActiveTransitionAfterRollback === true,
                openedAt
            },
            progressPatch: {
                actionKind: action.actionKind || (action.tabAction === 'nuke' ? 'mute-block' : action.tabAction || 'mute-block'),
                runId: action.runId || '',
                status: 'tab-opening',
                tabId: tab.id,
                tabCreatedAt: openedAt,
                tabOpenedAt: openedAt,
                contentOpenedAt: 0,
                actionReadyAt: 0,
                muteAttemptedAt: 0,
                mutedAt: 0,
                blockAttemptedAt: 0,
                blockedAt: 0,
                terminalAt: 0,
                slotReleasedAt: 0,
                closeRequestedAt: 0,
                tabClosedAt: 0,
                closedByExtension: false,
                closeReason: '',
                finalError: '',
                retryAttempt,
                attemptId,
                attemptNumber,
                maxRetries,
                ownerTabId: action.ownerTabId || null,
                ownerWindowId,
                actionSurfaceMode,
                actionSurfaceWindowId,
                actionSurfaceActivatedAt: action.actionSurfaceActivatedAt || 0,
                lastUrl
            }
        }
    }

    function applyQueuedTabOpenRuntimeEffect(plan = {}) {
        const tabId = normalizeTabId(plan?.tab?.id)
        if(!tabId) return false

        queueRuntime.addActiveQueuedTab(tabId)
        setQueuedTabMetadata(tabId, plan.metadata || {})
        queueRuntime.setPendingTabAction(tabId, plan.pendingAction || {})
        registerOwnedTab(plan?.action?.ownerTabId, tabId)
        return true
    }

    function buildQueuedTabOpenedProgressPatch(plan = {}, transition = {}) {
        const retryAttempt = Number.parseInt(plan.retryAttempt, 10) || 0
        return {
            ...(plan.progressPatch || {}),
            replaceProgressRecord: transition.activeTransitionContinued !== true,
            activeTransitionAccepted: transition.activeTransitionAccepted === true,
            activeTransitionError: transition.activeTransitionError || '',
            activeTransitionContinued: transition.activeTransitionContinued === true,
            event: transition.activeTransitionContinued
                ? 'Background opened a queued tab; active transition lagged after action started'
                : transition.activeTransitionError
                ? 'Background opened a queued tab; active transition failed before content-script ensure'
                : retryAttempt > 0
                ? `Background opened retry attempt ${plan.attemptNumber}`
                : 'Background opened a queued tab'
        }
    }

    return {
        buildQueuedTabOpenEffectPlan,
        applyQueuedTabOpenRuntimeEffect,
        buildQueuedTabOpenedProgressPatch
    }
}

module.exports = {
    createQueuedTabOpenEffect
}
