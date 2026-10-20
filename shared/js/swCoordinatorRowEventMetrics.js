// Coordinator row-event metrics extracted from sw.js (decomposition Slice
// 39, part 2 of 2): getCoordinatorRowEventMetricKind,
// incrementCoordinatorRowEventMetric, normalizeCoordinatorRowProgressEvent,
// buildCoordinatorRowEventsFromProgressRecords,
// shouldCloseRejectedStaleRowEventSenderTab.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): all 5 bodies were grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. No matches -- all are plain
// data-in/data-out predicates/builders, including their calls into other
// already-extracted modules' handlers (normalizeStorageMetricPathName,
// incrementQueueWakeupMetric, normalizeTabId, getAttemptIdFromValue,
// getQueuedTabMetadata, getCoordinatorItemHref, getCoordinatorItemQueueKey),
// none of which are Promise-returning. No realm-crossing risk either
// direction.
//
// Clock note: none of the 5 moved bodies call `Date.now()` (or read any
// other environment global the test harness fakes), so no `now` dependency
// is threaded through.
//
// Construction-order note: unlike this slice's other module
// (swResolvedProfilePendingSpaceRecords.js), this module is constructed in
// place at this cluster's old source-text position: no already-extracted
// module eagerly references any of its 5 exports at its own
// construction-call site (checked via grep across shared/js/sw.js), and
// every call site of these 5 functions is inside another function's body
// (evaluated lazily at call time, not at module-eval time), not inside an
// eager `handlers` object literal. The
// COORDINATOR_ROW_EVENT_QUEUED_PROGRESS_MILESTONE constant stays a bare
// `const` in sw.js (it's used well outside this cluster too, including by
// the resident async row-event-apply functions) and is threaded through as
// a constant instead of moved.

function createCoordinatorRowEventMetrics(deps = {}) {
    const {
        normalizeStorageMetricPathName,
        incrementQueueWakeupMetric,
        normalizeQuoraProfileUrl,
        normalizeTabId,
        getAttemptIdFromValue,
        getQueuedTabMetadata,
        getCoordinatorItemHref,
        getCoordinatorItemQueueKey
    } = deps.handlers || {}
    const {
        coordinatorRowEventQueuedProgressMilestone
    } = deps.constants || {}

    function getCoordinatorRowEventMetricKind(eventKind = '') {
        return normalizeStorageMetricPathName(eventKind || 'unknown')
    }

    function incrementCoordinatorRowEventMetric(eventKind = '', suffix = '', amount = 1) {
        const kind = getCoordinatorRowEventMetricKind(eventKind)
        const name = `${suffix || ''}`.trim()
        if(!name) return
        incrementQueueWakeupMetric(`rowEvent.${kind}.${name}`, amount)
    }

    function normalizeCoordinatorRowProgressEvent(event = {}) {
        const eventKind = `${event?.eventKind || ''}`.trim()
        const profileHref = normalizeQuoraProfileUrl(event?.profileHref || event?.href || event?.coordinatorKey || '')
        if(!profileHref) return null
        return {
            eventKind,
            profileHref,
            coordinatorKey: normalizeQuoraProfileUrl(event?.coordinatorKey || profileHref) || profileHref,
            patch: event?.patch && typeof event.patch === 'object' ? event.patch : {},
            senderTabId: normalizeTabId(event?.senderTabId || event?.tabId || event?.patch?.tabId || null)
        }
    }

    function buildCoordinatorRowEventsFromProgressRecords(progressRecords = {}, options = {}) {
        return Object.entries(progressRecords || {})
            .map(([profileHref, patch]) => normalizeCoordinatorRowProgressEvent({
                eventKind: coordinatorRowEventQueuedProgressMilestone,
                profileHref,
                coordinatorKey: profileHref,
                patch,
                // Each pending record carries its own authenticated sender (review-2 S4-1); a call-wide sender is the fallback.
                senderTabId: options.senderTabIdsByHref?.[profileHref] || options.senderTabId || null
            }))
            .filter(Boolean)
    }

    function shouldCloseRejectedStaleRowEventSenderTab(item = null, record = null, senderTabId = null) {
        const normalizedTabId = normalizeTabId(senderTabId)
        if(!normalizedTabId || !item || !record) return false

        const currentAttemptId = getAttemptIdFromValue(item)
        const incomingAttemptId = getAttemptIdFromValue(record)
        if(!currentAttemptId || !incomingAttemptId || currentAttemptId === incomingAttemptId) return false

        const metadata = getQueuedTabMetadata(normalizedTabId)
        if(!metadata) return false

        const metadataAttemptId = getAttemptIdFromValue(metadata)
        if(metadataAttemptId && metadataAttemptId !== incomingAttemptId) return false

        const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(record.profileHref || '')
        const metadataHref = normalizeQuoraProfileUrl(metadata.profileHref || metadata.requestedUrl || '')
        if(itemHref && metadataHref && itemHref !== metadataHref) return false

        const itemKey = getCoordinatorItemQueueKey(item)
        const metadataKey = `${metadata.coordinatorKey || ''}`.trim()
        if(itemKey && metadataKey && itemKey !== metadataKey) return false

        return true
    }

    return {
        getCoordinatorRowEventMetricKind,
        incrementCoordinatorRowEventMetric,
        normalizeCoordinatorRowProgressEvent,
        buildCoordinatorRowEventsFromProgressRecords,
        shouldCloseRejectedStaleRowEventSenderTab
    }
}

module.exports = {
    createCoordinatorRowEventMetrics
}
