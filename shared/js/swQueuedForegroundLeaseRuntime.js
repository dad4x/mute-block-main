// Queued-tab foreground-lease + owned-runtime-state bookkeeping extracted
// from sw.js (decomposition Slice 32, part 1 of 3):
// isForegroundRequiredProfileActionRequest,
// restoreQueuedTabRuntimeFromActiveAuthorityForSender, hasOwnedQueuedTabState,
// isForegroundQueuedTabAction, isForegroundQueuedTabWork,
// getQueuedForegroundLeaseTabId, makeQueuedTabMetadataProgressPatch,
// clearQueuedForegroundLease, releaseQueuedForegroundLease,
// addExpectedTerminalTabId, isExpectedTerminalSweepTab, and
// shouldActivateOwnedQueuedTabOnOpen.
//
// This is the first of three modules split out of the plan's Slice 32
// range (foreground-lease bookkeeping vs. worker-action-surface state vs.
// content-script-ensure scheduling -- three separately-committed,
// separately-verified sub-slices per the plan's explicit split
// instruction, matching the Slice 6/9/11/12/23 precedent).
//
// Construction-order finding: hasOwnedQueuedTabState is eagerly referenced
// in coordinatorReclaimEvidence's own construction-call `handlers` object
// literal (decomposition Slice 6, `const coordinatorReclaimEvidence =
// createCoordinatorReclaimEvidence({handlers: {..., hasOwnedQueuedTabState}
// })`), and restoreQueuedTabRuntimeFromActiveAuthorityForSender is
// referenced the same way in coordinatorQueueMachineEventDispatcher's
// `runtime` object literal further down. A hoisted `function` declaration
// is visible throughout its enclosing scope; a `const` destructured from a
// factory call is in the temporal dead zone until that line executes -- so
// this module must construct before the earlier of those two eager
// references, i.e. before coordinatorReclaimEvidence. All of this module's
// own dependencies (normalizeTabId from tabIdUtils,
// getAttemptIdFromValue/getAttemptNumberFromValue from
// coordinatorAttemptIdentity, getCoordinatorItemHref/
// getCoordinatorItemQueueKey/getCoordinatorItemExecutorTabAction/
// getCoordinatorActionKindForRequestedAction/findCoordinatorQueueEntryForHref
// from coordinatorExecutorClassification, isActiveCoordinatorStatus from
// coordinatorStatusRules, wasQueuedRuntimeTabRemoved/getQueuedTabMetadata/
// setQueuedTabMetadata from queuedTabMetadataAndActionLease,
// incrementQueueWakeupMetric from queueWakeupMetricsShape, and queueRuntime)
// are already bound well before coordinatorReclaimEvidence's construction,
// so this module constructs immediately after activationGuardRuntime's
// destructure and right before coordinatorReclaimEvidence, well ahead of
// this cluster's former source-text position (~22700+).
// coordinatorItemMatchesQueuedTabRuntime, makeClaimableQueuedTabAction, and
// registerOwnedTab are still plain hoisted `function` declarations far
// below (untouched by this slice, slated for later slices per the plan) --
// hoisted declarations work from any point in this scope either way, so
// they're threaded through as ordinary handler deps, not thunks.
// coordinatorAuthority (createCoordinatorAuthority(), constructed much
// later) is threaded through as `state.getCoordinatorAuthority: () =>
// coordinatorAuthority`, matching the precedent already used by
// activationGuardRuntime, coordinatorReclaimEvidence, and
// queuedRuntimeActionMatching for the same reason.
//
// Foreground-lease state: the module-level `queuedForegroundLeaseTabId` in
// sw.js is read/written by three of this cluster's functions
// (getQueuedForegroundLeaseTabId, clearQueuedForegroundLease,
// releaseQueuedForegroundLease) but is also written directly by
// promoteQueuedTab, a resident async orchestrator well outside this
// slice's scope and this decomposition effort's current async boundary
// (see architecture.md's realm-boundary section). Rather than have this
// module own that primitive outright -- which would force promoteQueuedTab
// to route a single assignment through a module method it has no other
// reason to depend on -- sw.js keeps the bare `let` and threads
// `state.getForegroundLeaseTabId`/`state.setForegroundLeaseTabId` closures
// into this module, the same getter/setter-closure convention
// registerServiceWorkerListeners already uses for
// getQueuedActionSurfaceWindowId/setProfileNukeProgress and similar
// primitives that are read or written from more than one place in the
// file.
//
// Clock/environment-global note: restoreQueuedTabRuntimeFromActiveAuthorityForSender
// and clearQueuedForegroundLease each read a bare `Date.now()` in their
// bodies -- threaded through as `now: () => Date.now()` per the
// decomposition plan's clock note, since a bare `Date` reference in this
// module's own V8 realm would resolve to the real Node clock instead of
// the test harness's injected fake one under the vm sandbox.
//
// Promise-chain realm-crossing scrutiny (architecture.md's Slice-7
// refinement): grepped every body for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, `void` -- zero hits across all twelve. Plain
// synchronous data-in/data-out predicates, builders, and bookkeeping
// mutators over already-extracted or passed-in state.
//
// cloneCoordinatorAuthorityValue and the createCoordinatorAuthority-adjacent
// region, plus the queue-WAL async cluster, are explicitly out
// of scope for this decomposition effort (see the plan's "Boundary after
// Slice 17" section) and are untouched here.

function createQueuedForegroundLeaseRuntime(deps = {}) {
    const {
        now: getNow = () => Date.now()
    } = deps
    const {
        SERVICE_WORKER_QUEUE_OWNER_ID,
        UNBLOCK_UNMUTE_ACTION_KIND
    } = deps.constants || {}
    const {
        queueRuntime,
        normalizeTabId,
        normalizeQuoraProfileUrl,
        wasQueuedRuntimeTabRemoved,
        getQueuedTabMetadata,
        setQueuedTabMetadata,
        findCoordinatorQueueEntryForHref,
        isActiveCoordinatorStatus,
        coordinatorItemMatchesQueuedTabRuntime,
        getCoordinatorItemHref,
        getCoordinatorItemQueueKey,
        getCoordinatorItemExecutorTabAction,
        getCoordinatorActionKindForRequestedAction,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        makeClaimableQueuedTabAction,
        registerOwnedTab,
        incrementQueueWakeupMetric
    } = deps.handlers || {}
    const {
        getCoordinatorAuthority = () => null,
        getForegroundLeaseTabId = () => null,
        setForegroundLeaseTabId = () => {}
    } = deps.state || {}

    function isForegroundRequiredProfileActionRequest(request = {}) {
        if(request?.requireForegroundWork === true) return true
        const reason = `${request?.reason || ''}`.trim().toLowerCase()
        return reason === 'mute-confirmation' ||
            reason === 'block-confirmation' ||
            reason === 'unmute-confirmation' ||
            reason === 'unblock-confirmation' ||
            reason.endsWith('-confirmation')
    }

    function hasOwnedQueuedTabState(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false
        return queueRuntime.hasQueuedTabMetadata(normalizedTabId) ||
            queueRuntime.hasActiveQueuedTab(normalizedTabId) ||
            queueRuntime.hasOwnedTabState(normalizedTabId)
    }

    function isForegroundQueuedTabAction(value = '') {
        const action = `${value || ''}`.trim()
        return action === 'nuke' || action === 'mute-block' || action === UNBLOCK_UNMUTE_ACTION_KIND
    }

    function isForegroundQueuedTabWork(metadata = null, record = null) {
        return isForegroundQueuedTabAction(metadata?.tabAction || metadata?.actionKind || record?.actionKind || '')
    }

    function restoreQueuedTabRuntimeFromActiveAuthorityForSender(tabId = null, senderTab = null, metadata = null, options = {}) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId || normalizeTabId(senderTab?.id) !== normalizedTabId) return null
        if(wasQueuedRuntimeTabRemoved(normalizedTabId) && options.allowRemovedSenderTab !== true) return null

        const currentAuthorityState = getCoordinatorAuthority().current()
        const queue = currentAuthorityState?.queue || {}
        const baseMetadata = metadata || {}
        const href = normalizeQuoraProfileUrl(baseMetadata.profileHref || baseMetadata.requestedUrl || senderTab?.url || '')
        const coordinatorKey = `${baseMetadata.coordinatorKey || href || ''}`.trim()
        const entry = coordinatorKey && queue[coordinatorKey]
            ? {key: coordinatorKey, item: queue[coordinatorKey]}
            : findCoordinatorQueueEntryForHref(queue, href) ||
                Object.entries(queue)
                    .map(([key, item]) => ({key, item}))
                    .find(candidate =>
                        isActiveCoordinatorStatus(candidate.item?.status) &&
                        normalizeTabId(candidate.item?.tabId || candidate.item?.activeTabId || null) === normalizedTabId
                    ) ||
                null
        const item = entry?.item || null
        const matchesRuntime = metadata
            ? coordinatorItemMatchesQueuedTabRuntime(item, entry?.key || coordinatorKey, baseMetadata, normalizedTabId)
            : normalizeTabId(item?.tabId || item?.activeTabId || null) === normalizedTabId
        if(!item ||
            !isActiveCoordinatorStatus(item.status) ||
            !matchesRuntime) {
            return null
        }

        const restoredMetadata = {
            ...baseMetadata,
            profileHref: getCoordinatorItemHref(item) || href,
            coordinatorKey: getCoordinatorItemQueueKey(item, entry?.key || coordinatorKey),
            requestedUrl: item.requestedUrl || baseMetadata.requestedUrl || href,
            tabAction: getCoordinatorItemExecutorTabAction(item, baseMetadata.tabAction || 'nuke'),
            actionKind: getCoordinatorActionKindForRequestedAction(item.actionKind || baseMetadata.actionKind || baseMetadata.tabAction || 'mute-block'),
            runId: item.runId || baseMetadata.runId || '',
            attemptId: getAttemptIdFromValue(item) || getAttemptIdFromValue(baseMetadata),
            attemptNumber: getAttemptNumberFromValue(item) || getAttemptNumberFromValue(baseMetadata),
            actionSurfaceMode: item.actionSurfaceMode || baseMetadata.actionSurfaceMode || '',
            actionSurfaceWindowId: item.actionSurfaceWindowId || baseMetadata.actionSurfaceWindowId || senderTab?.windowId || null,
            actionSurfaceAnchorTabId: item.actionSurfaceAnchorTabId || baseMetadata.actionSurfaceAnchorTabId || null,
            actionSurfaceActivatedAt: item.actionSurfaceActivatedAt || baseMetadata.actionSurfaceActivatedAt || 0,
            durableActiveAt: item.activeAt || getNow(),
            durableActiveReason: 'begin-profile-action-runtime-restored'
        }
        const action = makeClaimableQueuedTabAction({
            action: restoredMetadata.tabAction,
            profileHref: restoredMetadata.profileHref,
            targetUrl: restoredMetadata.profileHref,
            coordinatorKey: restoredMetadata.coordinatorKey,
            requestedUrl: restoredMetadata.requestedUrl,
            actionKind: restoredMetadata.actionKind,
            runId: restoredMetadata.runId,
            ownerTabId: restoredMetadata.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
            ownerWindowId: restoredMetadata.ownerWindowId || senderTab?.windowId || null,
            noForegroundFallback: !!restoredMetadata.noForegroundFallback,
            actionSurfaceMode: restoredMetadata.actionSurfaceMode || '',
            attemptId: restoredMetadata.attemptId,
            attemptNumber: restoredMetadata.attemptNumber
        }, restoredMetadata)

        queueRuntime.clearRemovedQueuedRuntimeTab(normalizedTabId)
        queueRuntime.addActiveQueuedTab(normalizedTabId)
        setQueuedTabMetadata(normalizedTabId, restoredMetadata)
        if(action) queueRuntime.setPendingTabAction(normalizedTabId, action)
        registerOwnedTab(restoredMetadata.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID, normalizedTabId)
        incrementQueueWakeupMetric('beginProfileAction.runtimeRestoredFromAuthority')
        return {metadata: restoredMetadata, action}
    }

    function getQueuedForegroundLeaseTabId() {
        const tabId = normalizeTabId(getForegroundLeaseTabId())
        if(!tabId) {
            setForegroundLeaseTabId(null)
            return null
        }

        const metadata = getQueuedTabMetadata(tabId)
        if(!queueRuntime.hasActiveQueuedTab(tabId) || metadata?.closeRequestedAt) {
            setForegroundLeaseTabId(null)
            return null
        }

        return tabId
    }

    function makeQueuedTabMetadataProgressPatch(metadata = {}, patch = {}) {
        return {
            ...patch,
            actionKind: patch.actionKind || metadata?.actionKind || metadata?.tabAction || 'mute-block',
            runId: patch.runId || metadata?.runId || '',
            attemptId: getAttemptIdFromValue(patch) || getAttemptIdFromValue(metadata),
            attemptNumber: getAttemptNumberFromValue(patch) || getAttemptNumberFromValue(metadata),
            ownerTabId: patch.ownerTabId || metadata?.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
            ownerWindowId: patch.ownerWindowId || metadata?.ownerWindowId || null
        }
    }

    function clearQueuedForegroundLease(reason = '') {
        const normalizedTabId = normalizeTabId(getForegroundLeaseTabId())
        if(!normalizedTabId) {
            setForegroundLeaseTabId(null)
            return false
        }

        setForegroundLeaseTabId(null)
        setQueuedTabMetadata(normalizedTabId, {
            foregroundLeaseReleasedAt: getNow(),
            foregroundLeaseReleaseReason: `${reason || ''}`.trim()
        })
        return true
    }

    function releaseQueuedForegroundLease(tabId, reason = '') {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId || normalizeTabId(getForegroundLeaseTabId()) !== normalizedTabId) return false

        return clearQueuedForegroundLease(reason)
    }

    function addExpectedTerminalTabId(tabIdsByHref, href = '', tabId = null) {
        const normalizedHref = normalizeQuoraProfileUrl(href || '')
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedHref || !normalizedTabId) return

        let tabIds = tabIdsByHref.get(normalizedHref)
        if(!tabIds) {
            tabIds = new Set()
            tabIdsByHref.set(normalizedHref, tabIds)
        }
        tabIds.add(normalizedTabId)
    }

    function isExpectedTerminalSweepTab(tabId, href = '', expectedTabIdsByHref = new Map()) {
        const normalizedTabId = normalizeTabId(tabId)
        const normalizedHref = normalizeQuoraProfileUrl(href || '')
        if(!normalizedTabId || !normalizedHref) return false

        if(expectedTabIdsByHref.get(normalizedHref)?.has(normalizedTabId)) return true
        return hasOwnedQueuedTabState(normalizedTabId)
    }

    function shouldActivateOwnedQueuedTabOnOpen(action = {}) {
        return action?.active === true ||
            action?.activateOnOpen === true ||
            action?.foregroundOnOpen === true
    }

    return {
        isForegroundRequiredProfileActionRequest,
        restoreQueuedTabRuntimeFromActiveAuthorityForSender,
        hasOwnedQueuedTabState,
        isForegroundQueuedTabAction,
        isForegroundQueuedTabWork,
        getQueuedForegroundLeaseTabId,
        makeQueuedTabMetadataProgressPatch,
        clearQueuedForegroundLease,
        releaseQueuedForegroundLease,
        addExpectedTerminalTabId,
        isExpectedTerminalSweepTab,
        shouldActivateOwnedQueuedTabOnOpen
    }
}

module.exports = {
    createQueuedForegroundLeaseRuntime
}
