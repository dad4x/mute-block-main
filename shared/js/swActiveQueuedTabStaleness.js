// Active-queued-tab staleness/confirmed-actor classification extracted from
// sw.js (decomposition Slice 34): the rulebook for how long an active
// queued tab is allowed to stay silent before it counts as stale, what
// counts as the row's "age" for that clock, and whether a coordinator row
// currently has a confirmed runtime actor (a live, attempt-matched queued
// tab) backing it.
//
// None of the moved bodies read Date.now() or any other environment
// global -- all "clock" reads are of already-recorded timestamps on the
// progress record/metadata/coordinator item passed in, not the current
// time -- so this module needs no clock dependency.
//
// Construction-order note: this module constructs near the top of sw.js,
// well before this cluster's old source-text location (far below), rather
// than in place like a plain-in-order slice. `getPersistedQueuedTabId` is
// eagerly referenced bare in coordinatorExecutorClassification's own
// construction-call handlers object literal (constructed immediately
// after this module) -- the earliest of several such eager references
// across already-extracted modules (coordinatorProgressReducer,
// coordinatorReconcileInputs, queuedTabRuntimeStatus,
// coordinatorReconcileLockedMaterialization, and queuedTabReclaimResume,
// all constructed further down but still well before this cluster's old
// position). `hasActiveQueuedTabActionPhaseProgress`,
// `getPersistedActiveCoordinatorStaleAnchor`,
// `hasConfirmedRuntimeActorForCoordinatorItem`, and
// `hasConfirmedLiveRuntimeActorForCoordinatorItem` are eagerly referenced
// bare the same way by coordinatorReconcileInputs and queuedTabRuntimeStatus,
// and `getOwnedOrExpectedLiveTabsForProfileHref` by queuedTabReclaimResume.
// A `const` destructured from a factory call is in the temporal dead zone
// until that line executes -- so this module must construct before all of
// those eager references, which means before coordinatorExecutorClassification,
// the earliest of them. At that point normalizeTabId, getAttemptIdFromValue,
// getAttemptNumberFromValue, getCoordinatorItemHref,
// getCoordinatorActionKindForItem, getCoordinatorActionKindForProgress,
// getCoordinatorActionKindForRequestedAction, isForegroundQueuedTabWork,
// hasOwnedQueuedTabState, and isDurablyActiveQueuedTab aren't available as
// bare consts yet, so each is threaded through as a thunk that defers name
// resolution to call time. queueRuntime, getQueuedTabMetadata, and
// normalizeQuoraProfileUrl/getLiveTabsForProfileHref (top-of-file requires)
// are already available bare by this point and are threaded through
// directly. See sw.js's construction-site comment for the full ordering
// writeup.

function createActiveQueuedTabStaleness(deps = {}) {
    const {
        STALE_CLOSE_REQUESTED_QUEUED_TAB_MS,
        STALE_FOREGROUND_WAIT_QUEUED_TAB_MS,
        STALE_UNBLOCK_UNMUTE_ACTION_QUEUED_TAB_MS,
        STALE_ACTIVE_ACTION_QUEUED_TAB_MS,
        STALE_BACKGROUND_OPENING_QUEUED_TAB_MS,
        STALE_BACKGROUND_READY_QUEUED_TAB_MS,
        STALE_ACTIVE_QUEUED_TAB_MS,
        UNBLOCK_UNMUTE_ACTION_KIND
    } = deps.constants || {}
    const {
        queueRuntime,
        getQueuedTabMetadata,
        normalizeQuoraProfileUrl,
        getLiveTabsForProfileHref,
        normalizeTabId,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getCoordinatorItemHref,
        getCoordinatorActionKindForItem,
        getCoordinatorActionKindForProgress,
        getCoordinatorActionKindForRequestedAction,
        isForegroundQueuedTabWork,
        hasOwnedQueuedTabState,
        isDurablyActiveQueuedTab
    } = deps.handlers || {}

    function getProgressHeartbeatAt(record) {
        return Number.isFinite(record?.updatedAt) ? record.updatedAt : 0
    }

    function hasProgressTimestamp(record, key) {
        return Number.isFinite(record?.[key]) && record[key] > 0
    }

    function getActiveQueuedTabStaleTimeoutMs(record, metadata = null) {
        const status = `${record?.status || ''}`.trim()
        const closeRequestedAt = Math.max(
            Number.isFinite(record?.closeRequestedAt) ? record.closeRequestedAt : 0,
            Number.isFinite(metadata?.closeRequestedAt) ? metadata.closeRequestedAt : 0
        )
        if(closeRequestedAt > 0) return STALE_CLOSE_REQUESTED_QUEUED_TAB_MS

        const slotReleasedAt = Math.max(
            Number.isFinite(record?.slotReleasedAt) ? record.slotReleasedAt : 0,
            Number.isFinite(metadata?.slotReleasedAt) ? metadata.slotReleasedAt : 0
        )
        if(slotReleasedAt > 0) return STALE_CLOSE_REQUESTED_QUEUED_TAB_MS

        const waitingForForegroundAt = Math.max(
            Number.isFinite(record?.waitingForForegroundAt) ? record.waitingForForegroundAt : 0,
            Number.isFinite(metadata?.waitingForForegroundAt) ? metadata.waitingForForegroundAt : 0
        )
        const foregroundLeaseAt = Math.max(
            Number.isFinite(record?.foregroundLeaseAcquiredAt) ? record.foregroundLeaseAcquiredAt : 0,
            Number.isFinite(record?.foregroundPromotedAt) ? record.foregroundPromotedAt : 0,
            Number.isFinite(metadata?.foregroundLeaseAcquiredAt) ? metadata.foregroundLeaseAcquiredAt : 0,
            Number.isFinite(metadata?.foregroundPromotedAt) ? metadata.foregroundPromotedAt : 0
        )
        if(isForegroundQueuedTabWork(metadata, record) && !hasProgressTimestamp(record, 'actionReadyAt')) {
            return STALE_FOREGROUND_WAIT_QUEUED_TAB_MS
        }
        if((waitingForForegroundAt > 0 || foregroundLeaseAt > 0) && !hasProgressTimestamp(record, 'actionReadyAt')) {
            return STALE_FOREGROUND_WAIT_QUEUED_TAB_MS
        }
        if(status === 'muting' || status === 'blocking' || status === 'unmuting' || status === 'unblocking') {
            const actionKind = `${record?.actionKind || metadata?.actionKind || metadata?.tabAction || ''}`.trim()
            if(actionKind === UNBLOCK_UNMUTE_ACTION_KIND) return STALE_UNBLOCK_UNMUTE_ACTION_QUEUED_TAB_MS
            return STALE_ACTIVE_ACTION_QUEUED_TAB_MS
        }
        if(metadata?.noForegroundFallback) {
            if(!hasProgressTimestamp(record, 'contentOpenedAt')) {
                return STALE_BACKGROUND_OPENING_QUEUED_TAB_MS
            }
            if(!hasProgressTimestamp(record, 'actionReadyAt')) {
                return STALE_BACKGROUND_READY_QUEUED_TAB_MS
            }
            return STALE_ACTIVE_ACTION_QUEUED_TAB_MS
        }

        return STALE_ACTIVE_QUEUED_TAB_MS
    }

    function getActiveQueuedTabStartedAt(metadata = null, record = null) {
        return Math.max(
            Number.isFinite(metadata?.openedAt) ? metadata.openedAt : 0,
            Number.isFinite(metadata?.tabOpenedAt) ? metadata.tabOpenedAt : 0,
            Number.isFinite(metadata?.tabCreatedAt) ? metadata.tabCreatedAt : 0,
            Number.isFinite(record?.tabOpenedAt) ? record.tabOpenedAt : 0,
            Number.isFinite(record?.tabCreatedAt) ? record.tabCreatedAt : 0
        )
    }

    function getActiveQueuedTabActionPhaseStartedAt(record = null, metadata = null) {
        return Math.max(
            Number.isFinite(record?.actionReadyAt) ? record.actionReadyAt : 0,
            Number.isFinite(record?.muteAttemptedAt) ? record.muteAttemptedAt : 0,
            Number.isFinite(record?.blockAttemptedAt) ? record.blockAttemptedAt : 0,
            Number.isFinite(record?.unblockedAt) ? record.unblockedAt : 0,
            Number.isFinite(metadata?.actionReadyAt) ? metadata.actionReadyAt : 0,
            Number.isFinite(metadata?.muteAttemptedAt) ? metadata.muteAttemptedAt : 0,
            Number.isFinite(metadata?.blockAttemptedAt) ? metadata.blockAttemptedAt : 0,
            Number.isFinite(metadata?.unblockedAt) ? metadata.unblockedAt : 0,
            Number.isFinite(metadata?.milestones?.profileReadyAt) ? metadata.milestones.profileReadyAt : 0,
            Number.isFinite(metadata?.milestones?.muteAttemptedAt) ? metadata.milestones.muteAttemptedAt : 0,
            Number.isFinite(metadata?.milestones?.blockAttemptedAt) ? metadata.milestones.blockAttemptedAt : 0
        )
    }

    function getActiveQueuedTabAgeAnchor(metadata = null, record = null) {
        if(hasActiveQueuedTabActionPhaseProgress(record, metadata)) {
            const actionStartedAt = getActiveQueuedTabActionPhaseStartedAt(record, metadata)
            if(actionStartedAt) return actionStartedAt
        }

        return getActiveQueuedTabStartedAt(metadata, record)
    }

    function hasActiveQueuedTabActionPhaseProgress(record = null, metadata = null) {
        const status = `${record?.status || ''}`.trim()
        if(status === 'muting' || status === 'blocking' || status === 'unmuting' || status === 'unblocking') return true

        return Math.max(
            Number.isFinite(record?.muteAttemptedAt) ? record.muteAttemptedAt : 0,
            Number.isFinite(record?.blockAttemptedAt) ? record.blockAttemptedAt : 0,
            Number.isFinite(record?.unmuteAttemptedAt) ? record.unmuteAttemptedAt : 0,
            Number.isFinite(record?.unblockAttemptedAt) ? record.unblockAttemptedAt : 0,
            Number.isFinite(metadata?.muteAttemptedAt) ? metadata.muteAttemptedAt : 0,
            Number.isFinite(metadata?.blockAttemptedAt) ? metadata.blockAttemptedAt : 0,
            Number.isFinite(metadata?.unmuteAttemptedAt) ? metadata.unmuteAttemptedAt : 0,
            Number.isFinite(metadata?.unblockAttemptedAt) ? metadata.unblockAttemptedAt : 0
        ) > 0
    }

    function getPersistedQueuedTabId(item = null, record = null) {
        return normalizeTabId(record?.tabId || item?.tabId || null)
    }

    function getPersistedActiveProgressStaleAnchor(record = null) {
        if(!record) return 0

        return Math.max(
            Number.isFinite(record.closeRequestedAt) ? record.closeRequestedAt : 0,
            Number.isFinite(record.slotReleasedAt) ? record.slotReleasedAt : 0,
            Number.isFinite(record.blockAttemptedAt) ? record.blockAttemptedAt : 0,
            Number.isFinite(record.muteAttemptedAt) ? record.muteAttemptedAt : 0,
            Number.isFinite(record.foregroundLeaseAcquiredAt) ? record.foregroundLeaseAcquiredAt : 0,
            Number.isFinite(record.foregroundPromotedAt) ? record.foregroundPromotedAt : 0,
            Number.isFinite(record.foregroundWaitLastEventAt) ? record.foregroundWaitLastEventAt : 0,
            Number.isFinite(record.waitingForForegroundAt) ? record.waitingForForegroundAt : 0,
            Number.isFinite(record.actionReadyAt) ? record.actionReadyAt : 0,
            Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : 0,
            Number.isFinite(record.tabOpenedAt) ? record.tabOpenedAt : 0,
            Number.isFinite(record.tabCreatedAt) ? record.tabCreatedAt : 0
        )
    }

    function getPersistedActiveCoordinatorStaleAnchor(item = null, record = null) {
        return Math.max(
            getPersistedActiveProgressStaleAnchor(record),
            Number.isFinite(item?.activeAt) ? item.activeAt : 0,
            Number.isFinite(item?.updatedAt) ? item.updatedAt : 0,
            Number.isFinite(item?.queuedAt) ? item.queuedAt : 0,
            Number.isFinite(item?.createdAt) ? item.createdAt : 0
        )
    }

    function getOwnedOrExpectedLiveTabsForProfileHref(item = null, record = null, href = '', liveProfileTabsByHref = new Map()) {
        const expectedTabIds = new Set()
        const persistedTabId = getPersistedQueuedTabId(item, record)
        if(persistedTabId) expectedTabIds.add(persistedTabId)

        return getLiveTabsForProfileHref(liveProfileTabsByHref, href)
            .filter(tab => {
                const tabId = normalizeTabId(tab?.id)
                return tabId && (expectedTabIds.has(tabId) || hasOwnedQueuedTabState(tabId))
            })
    }

    function hasConfirmedRuntimeActorForCoordinatorItem(item = null, record = null) {
        const tabId = getPersistedQueuedTabId(item, record)
        if(!tabId || !queueRuntime.hasActiveQueuedTab(tabId) || !isDurablyActiveQueuedTab(tabId)) return false

        const metadata = getQueuedTabMetadata(tabId)
        const expectedAttemptId = getAttemptIdFromValue(item) || getAttemptIdFromValue(record)
        const expectedAttemptNumber = getAttemptNumberFromValue(item) || getAttemptNumberFromValue(record)
        const metadataAttemptId = getAttemptIdFromValue(metadata)
        const metadataAttemptNumber = getAttemptNumberFromValue(metadata)
        if(expectedAttemptId && metadataAttemptId !== expectedAttemptId) return false
        if(expectedAttemptNumber && metadataAttemptNumber !== expectedAttemptNumber) return false

        const expectedHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(record?.profileHref || '')
        const metadataHref = normalizeQuoraProfileUrl(metadata?.profileHref || metadata?.targetProfileHref || metadata?.requestedUrl || '')
        if(expectedHref && metadataHref && metadataHref !== expectedHref) return false

        const expectedActionKind = getCoordinatorActionKindForItem(item) ||
            getCoordinatorActionKindForProgress(record)
        const metadataActionKind = getCoordinatorActionKindForRequestedAction(metadata?.actionKind || metadata?.tabAction || '')
        if(expectedActionKind && metadataActionKind && metadataActionKind !== expectedActionKind) return false

        return true
    }

    function hasConfirmedLiveRuntimeActorForCoordinatorItem(item = null, record = null, liveProfileTabsByHref = new Map()) {
        if(!hasConfirmedRuntimeActorForCoordinatorItem(item, record)) return false

        const tabId = getPersistedQueuedTabId(item, record)
        const metadata = getQueuedTabMetadata(tabId)
        const expectedHref = getCoordinatorItemHref(item) ||
            normalizeQuoraProfileUrl(record?.profileHref || '') ||
            normalizeQuoraProfileUrl(metadata?.profileHref || metadata?.targetProfileHref || metadata?.requestedUrl || '')
        const liveTabs = getLiveTabsForProfileHref(liveProfileTabsByHref, expectedHref)
        return liveTabs.some(tab => normalizeTabId(tab?.id) === tabId)
    }

    return {
        getProgressHeartbeatAt,
        hasProgressTimestamp,
        getActiveQueuedTabStaleTimeoutMs,
        getActiveQueuedTabStartedAt,
        getActiveQueuedTabActionPhaseStartedAt,
        getActiveQueuedTabAgeAnchor,
        hasActiveQueuedTabActionPhaseProgress,
        getPersistedQueuedTabId,
        getPersistedActiveProgressStaleAnchor,
        getPersistedActiveCoordinatorStaleAnchor,
        getOwnedOrExpectedLiveTabsForProfileHref,
        hasConfirmedRuntimeActorForCoordinatorItem,
        hasConfirmedLiveRuntimeActorForCoordinatorItem
    }
}

module.exports = {
    createActiveQueuedTabStaleness
}
