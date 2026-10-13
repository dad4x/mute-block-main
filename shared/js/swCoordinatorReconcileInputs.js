// Coordinator reconcile-decision input helpers extracted from sw.js
// (decomposition Slice 8). These are the small synchronous predicates,
// counters, and anchor/URL builders a reconcile tick reads to decide
// whether a queue row's durable status matches its observed runtime
// (live tab) state -- queue work counts, authority-vs-runtime mismatch
// counts, reconcile action budget, token/URL-matched live tab lookups,
// active/rolled-back reclaim candidate selection, and the various
// "when did this row last look alive" staleness anchors.
//
// All 13 functions here are plain synchronous predicates/builders -- no
// `async`, and none construct or return a Promise/`.then()` chain (grepped
// for both before moving; also confirmed none of them are ever passed as a
// bare `.then()`/`.catch()` callback anywhere in sw.js). Per
// architecture.md's "Module Extraction And The Test Harness Realm
// Boundary" section (and the Slice 7 refinement in particular), the
// test-harness realm-crossing risk is specific to Promise chains reaching
// into another already-extracted module, not to plain synchronous function
// calls -- a synchronous call executes in the same tick regardless of which
// V8 realm defines the callee. Several of these functions are threaded as
// plain synchronous handler deps into other already-extracted modules
// (swQueuedTabRuntimeStatus.js) and are called synchronously from within
// async functions still in sw.js (e.g. deferActiveWithoutActorForFreshContentReadiness);
// none of that is a `.then()`-chain crossing, so it carries no realm
// penalty either direction.
//
// isDurablyActiveQueuedTab (used by getCoordinatorAuthorityMismatchCounts)
// is itself destructured from swQueuedTabRuntimeStatus.js at a *later*
// point in sw.js than where this module is constructed (that module's
// factory needs several of these functions as its own deps, so it must be
// constructed after this one -- see sw.js for the ordering). It's threaded
// through as a thunk, `(...args) => isDurablyActiveQueuedTab(...args)`,
// matching the TDZ-avoidance precedent from Slice 3/7: the thunk's body
// only resolves the name when actually called (well after full script
// initialization), not when this factory runs.
//
// A cluster of four small storage-authority accessor functions just above
// this slice's range in sw.js (getActiveStorageUpdateToken,
// getActiveStorageContext, isStorageUpdateAbandoned,
// suppressAbandonedStorageOperation) looked at Slice-8-claim time like they
// might belong in swstorage.js instead (they're thin wrappers over the
// storageUpdateState instance that swstorage.js's own
// createSerializedStorageUpdateState() factory already returns methods
// for). They were left in sw.js rather than folded in here or moved to
// swstorage.js: three of the four are pure one-line delegations with no
// judgment call, but the fourth (suppressAbandonedStorageOperation) mixes
// in calls to the already-extracted queueWakeupMetricsShape module's
// incrementQueueWakeupMetric/setActiveStorageMetricDetail, and
// test/lib/swHarness.js's state() snapshot calls getActiveStorageContext()
// directly as a bare identifier (line ~661), which is a separate surface
// this slice didn't want to touch without being asked. Out of scope for
// this slice; noted for a future one.
//
// Every Date.now() call in the moved bodies is threaded through as
// `now: () => Date.now()` per the decomposition plan's clock/
// environment-global note, even though none of these functions are
// async/timer-related by name.

function createCoordinatorReconcileInputs(deps = {}) {
    const {
        now: getNow = () => Date.now()
    } = deps
    const {
        COORDINATOR_RECONCILE_OBSERVE_ROW_BUDGET,
        COORDINATOR_RECONCILE_ACTION_BUDGET
    } = deps.constants || {}
    const {
        queueRuntime,
        getQueuedTabMetadata,
        setQueuedTabMetadata,
        isTerminalCoordinatorStatus,
        isActiveCoordinatorStatus,
        getCoordinatorProgressRecordForItem,
        hasConfirmedLiveRuntimeActorForCoordinatorItem,
        hasConfirmedRuntimeActorForCoordinatorItem,
        getPersistedQueuedTabId,
        isDurablyActiveQueuedTab,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        getLiveTabsForProfileHref,
        normalizeTabId,
        isTerminalProfileNukeRecord,
        normalizeCoordinatorActionLease,
        hasActiveCoordinatorMilestoneEvidence,
        hasActiveQueuedTabActionPhaseProgress,
        hasStrongActiveCoordinatorReclaimEvidence,
        hasOwnedQueuedTabState,
        isQueuedCoordinatorLiveTabReclaimReason,
        chooseCoordinatorReclaimProfileTab,
        normalizeCoordinatorRequestedUrl,
        getCoordinatorItemOpenUrl,
        getPersistedActiveCoordinatorStaleAnchor
    } = deps.handlers || {}

    function markQueuedTabDurablyActive(tabId, reason = '') {
        const metadata = getQueuedTabMetadata(tabId)
        // No runtime metadata means the tab was already released, or never tracked. Marking it would create metadata for a dead
        // tab, which the sweeps then read as live runtime. A caller that awaits before marking can see this happen.
        if(!metadata) return
        const durableActiveAt = Number.isFinite(metadata?.durableActiveAt) && metadata.durableActiveAt > 0
            ? metadata.durableActiveAt
            : getNow()
        setQueuedTabMetadata(tabId, {
            durableActiveAt,
            durableActiveReason: `${reason || ''}`.trim()
        })
    }

    function getCoordinatorQueueWorkCounts(queue = {}) {
        const counts = {
            durableActiveRows: 0,
            durableQueuedRows: 0,
            durableTerminalRows: 0
        }

        for(const item of Object.values(queue || {})) {
            if(isTerminalCoordinatorStatus(item?.status)) counts.durableTerminalRows += 1
            else if(isActiveCoordinatorStatus(item?.status)) counts.durableActiveRows += 1
            else if(`${item?.status || ''}` === 'queued') counts.durableQueuedRows += 1
        }

        return counts
    }

    function getCoordinatorAuthorityMismatchCounts(queue = {}, progress = {}, liveProfileTabsByHref = new Map(), options = {}) {
        const rowBudget = Math.max(1, Number.parseInt(options.rowBudget, 10) || COORDINATOR_RECONCILE_OBSERVE_ROW_BUDGET)
        const counts = {
            durableActiveWithoutActor: 0,
            durableActiveObserved: 0,
            provisionalActorWithoutDurable: 0,
            runtimeActorsObserved: queueRuntime.getActiveQueuedTabCount(),
            rowBudgetExceeded: false
        }
        const activeEntries = []

        for(const [itemKey, item] of Object.entries(queue || {})) {
            if(!isActiveCoordinatorStatus(item?.status)) continue
            if(activeEntries.length >= rowBudget) {
                counts.rowBudgetExceeded = true
                break
            }

            const record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
            activeEntries.push({itemKey, item, record})
            counts.durableActiveObserved += 1
            if(!hasConfirmedLiveRuntimeActorForCoordinatorItem(item, record, liveProfileTabsByHref)) {
                counts.durableActiveWithoutActor += 1
            }
        }

        for(const tabId of queueRuntime.listActiveQueuedTabIds()) {
            if(!isDurablyActiveQueuedTab(tabId)) {
                counts.provisionalActorWithoutDurable += 1
                continue
            }

            const matched = activeEntries.some(({item, record}) => {
                const persistedTabId = getPersistedQueuedTabId(item, record)
                return persistedTabId === tabId && hasConfirmedRuntimeActorForCoordinatorItem(item, record)
            })
            if(!matched) counts.provisionalActorWithoutDurable += 1
        }

        return counts
    }

    function getCoordinatorReconcileActionBudget(options = {}) {
        return Math.max(1, Number.parseInt(options.actionBudget, 10) || COORDINATOR_RECONCILE_ACTION_BUDGET)
    }

    function getTokenMatchedLiveTabForCoordinatorItem(item = null, record = null, itemKey = '', liveProfileTabsByHref = new Map()) {
        const tabId = getPersistedQueuedTabId(item, record)
        const expectedAttemptId = getAttemptIdFromValue(item) || getAttemptIdFromValue(record)
        const expectedAttemptNumber = getAttemptNumberFromValue(item) || getAttemptNumberFromValue(record)
        if(!tabId || !expectedAttemptId || !expectedAttemptNumber) return null

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey) || normalizeQuoraProfileUrl(record?.profileHref || '')
        const candidates = href ? getLiveTabsForProfileHref(liveProfileTabsByHref, href) : []
        return candidates.find(tab => normalizeTabId(tab?.id) === tabId) || null
    }

    function getLiveProfileTabForActiveCoordinatorReclaim(item = null, record = null, itemKey = '', liveProfileTabsByHref = new Map()) {
        if(!item || !isActiveCoordinatorStatus(item.status)) return null
        if(isTerminalProfileNukeRecord(record)) return null
        if(hasConfirmedRuntimeActorForCoordinatorItem(item, record)) return null
        if(normalizeCoordinatorActionLease(item.actionLease)) return null
        if(!hasActiveCoordinatorMilestoneEvidence(item)) return null
        const actionPhaseActive = hasActiveQueuedTabActionPhaseProgress(record, item)
        if((actionPhaseActive || getPersistedQueuedTabId(item, record)) &&
            !hasStrongActiveCoordinatorReclaimEvidence(item, record)) {
            return null
        }

        const expectedAttemptId = getAttemptIdFromValue(item)
        const expectedAttemptNumber = getAttemptNumberFromValue(item)
        if(!expectedAttemptId || !expectedAttemptNumber) return null

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey) || normalizeQuoraProfileUrl(record?.profileHref || '')
        const candidates = href ? getLiveTabsForProfileHref(liveProfileTabsByHref, href) : []
        if(candidates.length !== 1) return null

        const candidate = candidates[0]
        const candidateTabId = normalizeTabId(candidate?.id)
        if(!candidateTabId || hasOwnedQueuedTabState(candidateTabId)) return null

        return candidate
    }

    function getLiveProfileTabForRolledBackQueuedCoordinatorReclaim(item = null, record = null, itemKey = '', liveProfileTabsByHref = new Map()) {
        if(!item || `${item.status || ''}`.trim() !== 'queued') return null
        if(!isQueuedCoordinatorLiveTabReclaimReason(item.actionLeaseReleaseReason)) return null
        if(isTerminalProfileNukeRecord(record)) return null
        if(hasActiveQueuedTabActionPhaseProgress(record, item)) return null

        const expectedAttemptId = getAttemptIdFromValue(item)
        const expectedAttemptNumber = getAttemptNumberFromValue(item)
        if(!expectedAttemptId || !expectedAttemptNumber) return null

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey) || normalizeQuoraProfileUrl(record?.profileHref || '')
        const candidates = href ? getLiveTabsForProfileHref(liveProfileTabsByHref, href) : []
        return chooseCoordinatorReclaimProfileTab(candidates)
    }

    function getCoordinatorItemExpectedExecutorHref(item = null, record = null, itemKey = '') {
        return getCoordinatorItemHref(item) ||
            normalizeQuoraProfileUrl(itemKey) ||
            normalizeQuoraProfileUrl(record?.profileHref || '')
    }

    function getCoordinatorItemExpectedExecutorUrl(item = null, record = null, itemKey = '') {
        return normalizeCoordinatorRequestedUrl(
            item?.requestedUrl ||
            getCoordinatorItemOpenUrl(item) ||
            getCoordinatorItemExpectedExecutorHref(item, record, itemKey) ||
            record?.requestedUrl ||
            record?.profileHref ||
            ''
        )
    }

    function getTabObservedUrls(tab = null) {
        return [
            tab?.url,
            tab?.pendingUrl
        ]
            .map(value => `${value || ''}`.trim())
            .filter(Boolean)
    }

    function getPersistedExecutorObservedAgeMs(item = null, record = null, now = getNow()) {
        const anchor = getPersistedActiveCoordinatorStaleAnchor(item, record)
        if(!anchor || anchor > now) return Number.POSITIVE_INFINITY
        return now - anchor
    }

    function getQueuedTabActorReadinessAnchor(item = null, record = null, metadata = null) {
        return Math.max(
            Number.parseInt(metadata?.contentScriptPresentAt, 10) || 0,
            Number.parseInt(metadata?.contentScriptInjectedAt, 10) || 0,
            Number.parseInt(metadata?.contentScriptEnsureStartedAt, 10) || 0,
            Number.parseInt(metadata?.durableActiveAt, 10) || 0,
            Number.parseInt(metadata?.activeTransitionContinuedAt, 10) || 0,
            Number.parseInt(metadata?.activeTransitionUnconfirmedAt, 10) || 0,
            Number.parseInt(metadata?.activeTransitionPendingAt, 10) || 0,
            Number.parseInt(metadata?.openedAt, 10) || 0,
            Number.parseInt(metadata?.tabOpenedAt, 10) || 0,
            Number.parseInt(metadata?.tabCreatedAt, 10) || 0,
            Number.parseInt(record?.contentOpenedAt, 10) || 0,
            Number.parseInt(record?.tabOpenedAt, 10) || 0,
            Number.parseInt(record?.tabCreatedAt, 10) || 0,
            Number.parseInt(item?.activeAt, 10) || 0
        )
    }

    function summarizeQueuedTabStatusForRecorder(status = null) {
        const tab = status?.tab || null
        return {
            found: status?.found === true,
            missing: status?.missing === true,
            timedOut: status?.timedOut === true,
            implausible: status?.implausible === true,
            error: status?.error || '',
            tabUrl: tab?.url || '',
            tabPendingUrl: tab?.pendingUrl || '',
            tabStatus: tab?.status || '',
            tabTitle: tab?.title || '',
            tabWindowId: tab?.windowId || null
        }
    }

    function getFreshWorkerWindowStartupProgressAnchor(item = null, record = null) {
        return Math.max(
            Number.parseInt(record?.actionSurfaceActivatedAt, 10) || 0,
            Number.parseInt(record?.tabOpenedAt, 10) || 0,
            Number.parseInt(record?.tabCreatedAt, 10) || 0,
            Number.parseInt(item?.activeAt, 10) || 0,
            Number.parseInt(item?.updatedAt, 10) || 0
        )
    }

    return {
        markQueuedTabDurablyActive,
        getCoordinatorQueueWorkCounts,
        getCoordinatorAuthorityMismatchCounts,
        getCoordinatorReconcileActionBudget,
        getTokenMatchedLiveTabForCoordinatorItem,
        getLiveProfileTabForActiveCoordinatorReclaim,
        getLiveProfileTabForRolledBackQueuedCoordinatorReclaim,
        getCoordinatorItemExpectedExecutorHref,
        getCoordinatorItemExpectedExecutorUrl,
        getTabObservedUrls,
        getPersistedExecutorObservedAgeMs,
        getQueuedTabActorReadinessAnchor,
        summarizeQueuedTabStatusForRecorder,
        getFreshWorkerWindowStartupProgressAnchor
    }
}

module.exports = {
    createCoordinatorReconcileInputs
}
