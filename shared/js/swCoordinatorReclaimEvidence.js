// Coordinator active-reclaim evidence predicates extracted from sw.js
// (decomposition Slice 6, part 1 of 2). These are the "is there real proof
// a queued row is actually being worked" predicates used when deciding
// whether an orphaned-looking live tab can be reclaimed as the runtime
// actor for a durably-active coordinator queue row, plus the small helpers
// (`mergeLiveTabsById`, `chooseCoordinatorReclaimProfileTab`) that support
// picking a reclaim candidate once evidence exists.
//
// This cluster reads cleanly apart from the rest of the plan's Slice 6
// grouping: nothing in this file calls, or is called by, the tab-status /
// persisted-tab-plausibility / budget-exhaustion predicates that make up
// swQueuedTabRuntimeStatus.js (the other half of Slice 6) -- both were
// named together in the plan's "Slice 6" list purely because they sit in
// the same line range, not because their bodies reference each other. The
// callers that actually combine reclaim-evidence with tab-status checks
// (getLiveProfileTabForActiveCoordinatorReclaim,
// getLiveProfileTabForRolledBackQueuedCoordinatorReclaim) were not in the
// plan's named list and stay in sw.js, calling into both modules.
//
// None of the moved bodies read Date.now() or any other environment
// global, so this module needs no clock dependency.

function createCoordinatorReclaimEvidence(deps = {}) {
    const {
        getFirstPositiveNumber,
        normalizeTabId,
        hasOwnedQueuedTabState
    } = deps.handlers || {}

    function hasActiveCoordinatorMilestoneEvidence(item = null) {
        const milestones = item?.milestones || {}
        return getFirstPositiveNumber(
            milestones.actionClaimedAt,
            milestones.contentOpenedAt,
            milestones.navigationStartedAt,
            milestones.profileReadyAt,
            milestones.muteAttemptedAt,
            milestones.blockAttemptedAt,
            item?.activeAt
        ) > 0
    }

    function hasStrongActiveCoordinatorReclaimEvidence(item = null, record = null) {
        const milestones = item?.milestones || {}
        return getFirstPositiveNumber(
            milestones.actionClaimedAt,
            milestones.contentOpenedAt,
            milestones.profileReadyAt,
            milestones.muteAttemptedAt,
            milestones.blockAttemptedAt,
            item?.actionClaimedAt,
            item?.contentOpenedAt,
            item?.profileReadyAt,
            item?.muteAttemptedAt,
            item?.blockAttemptedAt,
            record?.actionReadyAt,
            record?.contentOpenedAt,
            record?.profileReadyAt,
            record?.muteAttemptedAt,
            record?.blockAttemptedAt
        ) > 0
    }

    function chooseCoordinatorReclaimProfileTab(candidates = []) {
        return [...(candidates || [])]
            .filter(tab => normalizeTabId(tab?.id) && !hasOwnedQueuedTabState(tab.id))
            .sort((left, right) => {
                const activeDelta = (right?.active === true ? 1 : 0) - (left?.active === true ? 1 : 0)
                if(activeDelta) return activeDelta

                const accessedDelta = (Number.parseInt(right?.lastAccessed, 10) || 0) -
                    (Number.parseInt(left?.lastAccessed, 10) || 0)
                if(accessedDelta) return accessedDelta

                return normalizeTabId(right?.id) - normalizeTabId(left?.id)
            })[0] || null
    }

    function mergeLiveTabsById(...lists) {
        const merged = []
        const seen = new Set()
        for(const list of lists) {
            for(const tab of list || []) {
                const tabId = normalizeTabId(tab?.id)
                if(!tabId || seen.has(tabId)) continue
                seen.add(tabId)
                merged.push(tab)
            }
        }
        return merged
    }

    function isQueuedCoordinatorLiveTabReclaimReason(reason = '') {
        const normalizedReason = `${reason || ''}`.trim()
        return normalizedReason === 'active-transition-failed' ||
            /(?:^|-)queued-live-tab-adoption-load-pressure(?:-|$)/.test(normalizedReason) ||
            /(?:^|-)active-transition-retry-budget-recovered(?:-|$)/.test(normalizedReason) ||
            /active-missing-tab$/.test(normalizedReason)
    }

    return {
        hasActiveCoordinatorMilestoneEvidence,
        hasStrongActiveCoordinatorReclaimEvidence,
        chooseCoordinatorReclaimProfileTab,
        mergeLiveTabsById,
        isQueuedCoordinatorLiveTabReclaimReason
    }
}

module.exports = {
    createCoordinatorReclaimEvidence
}
