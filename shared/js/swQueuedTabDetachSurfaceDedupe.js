// Queued-tab detach/cleanup + runtime-surface dedupe extracted from sw.js
// (decomposition Slice 36). Two entangled concerns: (1) the metadata-only
// cleanup step and the fuller runtime-detach step that calls it (the
// released tab's activation guard, active/pending-tab-action Maps, owned-tab
// registration, and metadata all get cleared, with detachQueuedTabRuntimeState
// additionally clearing queueRuntime's removed-tab bookkeeping, checking
// owner/child relationships, releasing any foreground lease, and journaling
// a state-change entry when something actually changed); and (2) the
// runtime-surface-dedupe primitives used by pruneDuplicateActiveQueuedRuntimeSurfaces
// (still resident, async) to group active queued tabs by a stable dedupe key,
// find which tab id the coordinator authority currently treats as the active
// surface for a group, and score each candidate tab so the "keep" choice
// prefers the authority-matched tab, then an adopted-live-tab, then a
// confirmed active transition, then recency.
//
// Realm-crossing scrutiny (per architecture.md's Slice-7 refinement): all 5
// bodies were grepped for `.then(`, `.catch(`, `Promise.`, `async`,
// `setTimeout`, and `void` -- none present in any of them. All 5 are plain
// synchronous functions; none builds or returns a Promise chain, and none
// calls into any already-extracted module through anything but a plain
// synchronous call. detachQueuedTabRuntimeState calls cleanupQueuedTabMetadataOnly
// directly (both now live in this module, so that's an internal call, not a
// crossing). This matches the shape already landed clean in Slices 17-20/35.
//
// Clock note: none of these 5 functions reads Date.now() (directly or via a
// default parameter) -- no clock needs threading through.
//
// Construction-order note: none of these 5 function names is referenced
// eagerly (i.e. as a bare identifier in another already-extracted module's
// own construction-call object literal) anywhere in sw.js -- the only other
// references are their own call sites inside functions still resident in
// sw.js (cleanupQueuedTabMetadataOnly/detachQueuedTabRuntimeState from
// several async orchestrators, getQueuedRuntimeSurfaceDedupeKey/
// findAuthorityTabIdForRuntimeSurface/scoreQueuedRuntimeSurfaceForKeep only
// from pruneDuplicateActiveQueuedRuntimeSurfaces) and the Slice-1 bootstrap
// composition root at the very end of the file (registerServiceWorkerListeners,
// itself constructed after everything). So unlike several recent slices,
// this module has no forced-early-hoisting requirement -- it constructs in
// place, at this cluster's old source-text location, with every dependency
// (queueRuntime, getQueuedTabMetadata, releaseQueuedActivationGuardForTab,
// releaseQueuedForegroundLease, unregisterOwnedTab, clearQueuedTabMetadata,
// pushQueueWakeupJournalEntry, normalizeQuoraProfileUrl,
// normalizeCoordinatorRequestedUrl, getCoordinatorActionKindForRequestedAction,
// getAttemptIdFromValue, getAttemptNumberFromValue, getCoordinatorItemHref,
// getCoordinatorItemQueueKey, isActiveCoordinatorStatus, normalizeTabId,
// SERVICE_WORKER_QUEUE_OWNER_ID) already a bare const/name by this point in
// the file. coordinatorAuthority (constructed well before this point too,
// but still threaded as a getter rather than a bare reference to match the
// existing getCoordinatorAuthority precedent used by other modules that read
// its `.current()` snapshot) is passed as `getCoordinatorAuthority: () =>
// coordinatorAuthority`.

function createQueuedTabDetachSurfaceDedupe(deps = {}) {
    const {
        constants: {
            SERVICE_WORKER_QUEUE_OWNER_ID
        } = {},
        handlers: {
            queueRuntime,
            getQueuedTabMetadata,
            releaseQueuedActivationGuardForTab,
            releaseQueuedForegroundLease,
            unregisterOwnedTab,
            clearQueuedTabMetadata,
            pushQueueWakeupJournalEntry,
            normalizeQuoraProfileUrl,
            normalizeCoordinatorRequestedUrl,
            getCoordinatorActionKindForRequestedAction,
            getAttemptIdFromValue,
            getAttemptNumberFromValue,
            getCoordinatorItemHref,
            getCoordinatorItemQueueKey,
            isActiveCoordinatorStatus,
            normalizeTabId,
            getCoordinatorAuthority
        } = {}
    } = deps

    function cleanupQueuedTabMetadataOnly(tabId) {
        if(!tabId) return
        const metadata = getQueuedTabMetadata(tabId)
        releaseQueuedActivationGuardForTab(tabId, metadata)
        if(queueRuntime.deleteActiveQueuedTab(tabId)) {
            releaseQueuedForegroundLease(tabId, 'queued-tab-metadata-cleanup')
        }
        queueRuntime.deletePendingTabAction(tabId)
        unregisterOwnedTab(tabId)
        clearQueuedTabMetadata(tabId)
    }

    function detachQueuedTabRuntimeState(tabId, reason = 'queued-tab-detached') {
        if(!tabId) {
            return {
                metadata: null,
                wasActive: false,
                wasOwnerTab: false,
                wasOwnedChild: false,
                foregroundLeaseReleased: false
            }
        }

        queueRuntime.markRemovedQueuedRuntimeTab(tabId)
        const metadata = getQueuedTabMetadata(tabId)
        releaseQueuedActivationGuardForTab(tabId, metadata)
        const wasActive = queueRuntime.deleteActiveQueuedTab(tabId)
        const wasOwnerTab = queueRuntime.hasOwnedParent(tabId)
        const wasOwnedChild = queueRuntime.hasOwnedChild(tabId)
        queueRuntime.deletePendingTabAction(tabId)
        const foregroundLeaseReleased = wasActive
            ? releaseQueuedForegroundLease(tabId, reason)
            : false
        if(wasActive || wasOwnedChild) {
            pushQueueWakeupJournalEntry({
                kind: 'state-change',
                name: 'detachQueuedTabRuntimeState',
                reason,
                result: 'state-changed',
                details: {
                    tabId,
                    wasActive,
                    wasOwnedChild,
                    profileHref: metadata?.profileHref || ''
                }
            })
        }
        cleanupQueuedTabMetadataOnly(tabId)

        return {
            metadata,
            wasActive,
            wasOwnerTab,
            wasOwnedChild,
            foregroundLeaseReleased
        }
    }

    function getQueuedRuntimeSurfaceDedupeKey(tabId = null, metadata = null) {
        const ownerId = metadata?.ownerTabId || queueRuntime.getOwningParentForChild(tabId) || SERVICE_WORKER_QUEUE_OWNER_ID
        const subjectKey = normalizeQuoraProfileUrl(metadata?.profileHref || metadata?.targetProfileHref || '') ||
            metadata?.coordinatorKey ||
            normalizeCoordinatorRequestedUrl(metadata?.requestedUrl || '')
        const actionKind = getCoordinatorActionKindForRequestedAction(metadata?.actionKind || metadata?.tabAction || 'nuke')
        const attemptId = getAttemptIdFromValue(metadata)
        const attemptNumber = getAttemptNumberFromValue(metadata)
        if(!ownerId || !subjectKey || !actionKind || !attemptId || !attemptNumber) return ''
        return [ownerId, subjectKey, actionKind, attemptId, attemptNumber].join('|')
    }

    function findAuthorityTabIdForRuntimeSurface(metadata = null, authorityState = null) {
        const queue = authorityState?.queue || getCoordinatorAuthority().current()?.queue || {}
        const subjectHref = normalizeQuoraProfileUrl(metadata?.profileHref || metadata?.targetProfileHref || '')
        const subjectKey = metadata?.coordinatorKey || subjectHref || normalizeCoordinatorRequestedUrl(metadata?.requestedUrl || '')
        const expectedAttemptId = getAttemptIdFromValue(metadata)
        const expectedAttemptNumber = getAttemptNumberFromValue(metadata)
        if(!subjectKey || !expectedAttemptId || !expectedAttemptNumber) return null

        const directItem = subjectHref
            ? queue[subjectHref] || queue[subjectKey] || null
            : queue[subjectKey] || null
        const candidates = directItem
            ? [[subjectKey, directItem]]
            : Object.entries(queue || {})
        for(const [itemKey, item] of candidates) {
            const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            const itemCoordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
            if(subjectHref && itemHref !== subjectHref) continue
            if(!subjectHref && itemCoordinatorKey !== subjectKey) continue
            if(getAttemptIdFromValue(item) !== expectedAttemptId) continue
            if(getAttemptNumberFromValue(item) !== expectedAttemptNumber) continue
            if(!isActiveCoordinatorStatus(item?.status || '')) continue
            return normalizeTabId(item?.tabId || item?.activeTabId || null)
        }
        return null
    }

    function scoreQueuedRuntimeSurfaceForKeep(tabId = null, metadata = null, authorityTabId = null) {
        let score = 0
        if(authorityTabId && normalizeTabId(tabId) === authorityTabId) score += 1000000
        if(metadata?.liveTabAdoptedAt) score += 100000
        if(!metadata?.activeTransitionUnconfirmedAt && !metadata?.activeTransitionUnconfirmedReason) score += 10000
        score += Math.min(Number.parseInt(metadata?.durableActiveAt, 10) || 0, 999999) / 1000
        score += Math.min(Number.parseInt(metadata?.updatedAt, 10) || 0, 999999) / 1000000
        return score
    }

    return {
        cleanupQueuedTabMetadataOnly,
        detachQueuedTabRuntimeState,
        getQueuedRuntimeSurfaceDedupeKey,
        findAuthorityTabIdForRuntimeSurface,
        scoreQueuedRuntimeSurfaceForKeep
    }
}

module.exports = {
    createQueuedTabDetachSurfaceDedupe
}
