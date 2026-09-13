/*
 * ARCHITECTURE: Queue runtime boundary.
 *
 * Runtime queue state is volatile service-worker memory. It may attach browser
 * tabs and timers to a machine attempt, but it is not durable authority and
 * must not independently decide queue status.
 */

function createQueueRuntimeState() {
    const pendingTabActions = new Map()
    const queuedTabMetadata = new Map()
    const queuedTabActions = []
    const activeQueuedTabs = new Set()
    const queuedProfileOpenReservations = new Map()
    const removedQueuedRuntimeTabIds = new Set()
    const ownedTabIdsByParent = new Map()
    const owningParentByChild = new Map()
    const canceledQueuedUrlsByOwner = new Map()
    const pausedQueuedOwners = new Set()
    let orderedQueueKeys = []

    const normalizeIntentSource = value => {
        const source = `${value || ''}`.trim()
        return source || 'runtime-effect'
    }

    const markActivationIntent = (intent = {}, source = '') => ({
        ...intent,
        activationIntentSource: normalizeIntentSource(source || intent.activationIntentSource)
    })

    function normalizeTabId(value) {
        const parsed = Number.parseInt(value, 10)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }

    function getPendingTabAction(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return normalizedTabId ? pendingTabActions.get(normalizedTabId) || null : null
    }

    function setPendingTabAction(tabId, action = {}) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false
        pendingTabActions.set(normalizedTabId, action || {})
        return true
    }

    function deletePendingTabAction(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return normalizedTabId ? pendingTabActions.delete(normalizedTabId) : false
    }

    function hasPendingTabAction(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return !!(normalizedTabId && pendingTabActions.has(normalizedTabId))
    }

    function getQueuedTabMetadata(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return normalizedTabId ? queuedTabMetadata.get(normalizedTabId) || null : null
    }

    function patchQueuedTabMetadata(tabId, metadata = {}) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return null
        const nextMetadata = {
            ...(queuedTabMetadata.get(normalizedTabId) || {}),
            ...(metadata || {}),
            updatedAt: Date.now()
        }
        queuedTabMetadata.set(normalizedTabId, nextMetadata)
        return nextMetadata
    }

    function deleteQueuedTabMetadata(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return normalizedTabId ? queuedTabMetadata.delete(normalizedTabId) : false
    }

    function hasQueuedTabMetadata(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return !!(normalizedTabId && queuedTabMetadata.has(normalizedTabId))
    }

    function addActiveQueuedTab(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false
        activeQueuedTabs.add(normalizedTabId)
        return true
    }

    function deleteActiveQueuedTab(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return normalizedTabId ? activeQueuedTabs.delete(normalizedTabId) : false
    }

    function hasActiveQueuedTab(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return !!(normalizedTabId && activeQueuedTabs.has(normalizedTabId))
    }

    function getActiveQueuedTabCount() {
        return activeQueuedTabs.size
    }

    function getPendingTabActionCount() {
        return pendingTabActions.size
    }

    function getActivationIntentCount() {
        return queuedTabActions.length
    }

    function getActivationIntentAt(index) {
        const normalizedIndex = Number.parseInt(index, 10)
        if(!Number.isFinite(normalizedIndex) || normalizedIndex < 0) return null
        return queuedTabActions[normalizedIndex] || null
    }

    function listActivationIntents() {
        return queuedTabActions.slice()
    }

    function someActivationIntent(predicate = null) {
        if(typeof predicate !== 'function') return false
        return queuedTabActions.some(predicate)
    }

    function mapActivationIntents(mapper = null) {
        if(typeof mapper !== 'function') return []
        return queuedTabActions.map(mapper)
    }

    function listActiveQueuedTabIds() {
        return Array.from(activeQueuedTabs)
    }

    function listPendingTabActions() {
        return Array.from(pendingTabActions.values())
    }

    function listPendingTabActionEntries() {
        return Array.from(pendingTabActions.entries())
    }

    function listPendingTabActionTabIds() {
        return Array.from(pendingTabActions.keys())
    }

    function listQueuedTabMetadataEntries() {
        return Array.from(queuedTabMetadata.entries())
    }

    function listQueuedTabMetadataTabIds() {
        return Array.from(queuedTabMetadata.keys())
    }

    function getOwnedTabsForParent(parentTabId) {
        const parentKey = parentTabId || ''
        return Array.from(ownedTabIdsByParent.get(parentKey) || [])
    }

    function setOwnedTabsForParent(parentTabId, childTabIds = []) {
        const parentKey = parentTabId || ''
        if(!parentKey) return false
        const ownedTabIds = new Set((childTabIds || [])
            .map(tabId => normalizeTabId(tabId))
            .filter(Boolean))
        if(ownedTabIds.size) ownedTabIdsByParent.set(parentKey, ownedTabIds)
        else ownedTabIdsByParent.delete(parentKey)
        for(const childTabId of ownedTabIds) {
            owningParentByChild.set(childTabId, parentKey)
        }
        return true
    }

    function addOwnedTab(parentTabId, childTabId) {
        const parentKey = parentTabId || ''
        const normalizedChildTabId = normalizeTabId(childTabId)
        if(!parentKey || !normalizedChildTabId) return false
        let ownedTabIds = ownedTabIdsByParent.get(parentKey)
        if(!ownedTabIds) {
            ownedTabIds = new Set()
            ownedTabIdsByParent.set(parentKey, ownedTabIds)
        }
        ownedTabIds.add(normalizedChildTabId)
        owningParentByChild.set(normalizedChildTabId, parentKey)
        return true
    }

    function removeOwnedTab(childTabId) {
        const normalizedChildTabId = normalizeTabId(childTabId)
        if(!normalizedChildTabId) return false

        const parentTabId = owningParentByChild.get(normalizedChildTabId)
        if(!parentTabId) {
            let removed = false
            for(const [candidateParentTabId, ownedTabIds] of ownedTabIdsByParent.entries()) {
                if(!ownedTabIds?.delete(normalizedChildTabId)) continue
                removed = true
                if(!ownedTabIds.size) ownedTabIdsByParent.delete(candidateParentTabId)
            }
            return removed
        }

        owningParentByChild.delete(normalizedChildTabId)
        const ownedTabIds = ownedTabIdsByParent.get(parentTabId)
        if(!ownedTabIds) return true
        ownedTabIds.delete(normalizedChildTabId)
        if(!ownedTabIds.size) ownedTabIdsByParent.delete(parentTabId)
        return true
    }

    function getOwningParentForChild(childTabId) {
        const normalizedChildTabId = normalizeTabId(childTabId)
        return normalizedChildTabId ? owningParentByChild.get(normalizedChildTabId) || null : null
    }

    function hasOwnedParent(parentTabId) {
        return ownedTabIdsByParent.has(parentTabId || '')
    }

    function hasOwnedChild(childTabId) {
        const normalizedChildTabId = normalizeTabId(childTabId)
        return !!(normalizedChildTabId && owningParentByChild.has(normalizedChildTabId))
    }

    function hasOwnedTabState(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false
        if(owningParentByChild.has(normalizedTabId)) return true
        for(const ownedTabIds of ownedTabIdsByParent.values()) {
            if(ownedTabIds?.has(normalizedTabId)) return true
        }
        return false
    }

    function markRemovedQueuedRuntimeTab(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false
        removedQueuedRuntimeTabIds.add(normalizedTabId)
        return true
    }

    function clearRemovedQueuedRuntimeTab(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return normalizedTabId ? removedQueuedRuntimeTabIds.delete(normalizedTabId) : false
    }

    function hasRemovedQueuedRuntimeTab(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return !!(normalizedTabId && removedQueuedRuntimeTabIds.has(normalizedTabId))
    }

    function pauseQueuedOwner(ownerTabId) {
        if(!ownerTabId) return false
        pausedQueuedOwners.add(ownerTabId)
        return true
    }

    function resumeQueuedOwner(ownerTabId) {
        return ownerTabId ? pausedQueuedOwners.delete(ownerTabId) : false
    }

    function hasPausedQueuedOwner(ownerTabId) {
        return !!(ownerTabId && pausedQueuedOwners.has(ownerTabId))
    }

    function rememberCanceledQueuedOwnerUrls(ownerTabId, urls = []) {
        if(!ownerTabId) return []
        const nextUrls = (urls || []).filter(Boolean)
        const existing = canceledQueuedUrlsByOwner.get(ownerTabId) || []
        const remembered = existing.concat(nextUrls)
        canceledQueuedUrlsByOwner.set(ownerTabId, remembered)
        return remembered
    }

    function consumeCanceledQueuedOwnerUrls(ownerTabId) {
        if(!ownerTabId) return []
        const urls = canceledQueuedUrlsByOwner.get(ownerTabId) || []
        canceledQueuedUrlsByOwner.delete(ownerTabId)
        return urls
    }

    function listPausedQueuedOwners() {
        return Array.from(pausedQueuedOwners)
    }

    function listOwnedTabParentEntries() {
        return Array.from(ownedTabIdsByParent.entries())
            .map(([parentTabId, childTabIds]) => [parentTabId, Array.from(childTabIds || [])])
    }

    function rebuildOwningParentByChild() {
        owningParentByChild.clear()
        for(const [parentTabId, childTabIds] of ownedTabIdsByParent.entries()) {
            for(const childTabId of childTabIds || []) {
                owningParentByChild.set(childTabId, parentTabId)
            }
        }
        return owningParentByChild.size
    }

    function replaceOwnedTabParents(entries = []) {
        ownedTabIdsByParent.clear()
        owningParentByChild.clear()
        for(const [parentTabId, childTabIds] of entries || []) {
            setOwnedTabsForParent(parentTabId, childTabIds)
        }
        return ownedTabIdsByParent.size
    }

    function pruneProfileOpenReservations(now, ttlMs) {
        const cutoff = Number.parseInt(ttlMs, 10) || 0
        if(!cutoff) return 0
        let pruned = 0
        for(const [key, reservation] of queuedProfileOpenReservations.entries()) {
            const reservedAt = Number.parseInt(reservation?.reservedAt, 10) || 0
            if(!reservedAt || now - reservedAt > cutoff) {
                queuedProfileOpenReservations.delete(key)
                pruned += 1
            }
        }
        return pruned
    }

    function getProfileOpenReservationCount() {
        return queuedProfileOpenReservations.size
    }

    function hasActiveOrPendingQueuedTabs() {
        return activeQueuedTabs.size > 0 || pendingTabActions.size > 0
    }

    function clearProfileOpenReservations() {
        const cleared = queuedProfileOpenReservations.size
        queuedProfileOpenReservations.clear()
        return cleared
    }

    function getProfileOpenReservation(key) {
        return queuedProfileOpenReservations.get(key) || null
    }

    function setProfileOpenReservation(key, reservation = {}) {
        if(!key) return false
        queuedProfileOpenReservations.set(key, reservation || {})
        return true
    }

    function deleteProfileOpenReservation(key) {
        return key ? queuedProfileOpenReservations.delete(key) : false
    }

    function enqueueActivationIntent(intent = {}, options = {}) {
        const plannedIntent = markActivationIntent(intent, options.source || 'machine-intent')
        if(options.front === true) queuedTabActions.unshift(plannedIntent)
        else queuedTabActions.push(plannedIntent)
        return plannedIntent
    }

    function enqueueActivationIntents(intents = [], options = {}) {
        const plannedIntents = (intents || [])
            .map(intent => markActivationIntent(intent, options.source || 'machine-intent'))
        if(!plannedIntents.length) return []
        if(options.front === true) queuedTabActions.unshift(...plannedIntents)
        else queuedTabActions.push(...plannedIntents)
        return plannedIntents
    }

    function consumeActivationIntent() {
        return queuedTabActions.shift() || null
    }

    function requeueActivationIntent(intent = {}, options = {}) {
        if(!intent) return null
        const plannedIntent = markActivationIntent(intent, options.source || 'runtime-effect')
        if(options.back === true) queuedTabActions.push(plannedIntent)
        else queuedTabActions.unshift(plannedIntent)
        return plannedIntent
    }

    function restoreActivationIntents(intents = [], options = {}) {
        return enqueueActivationIntents(intents, {
            ...options,
            front: options.front !== false,
            source: options.source || 'repair-reprime'
        })
    }

    function replaceActivationIntents(intents = [], options = {}) {
        const plannedIntents = (intents || [])
            .map(intent => markActivationIntent(intent, options.source || intent.activationIntentSource || 'runtime-effect'))
        queuedTabActions.splice(0, queuedTabActions.length, ...plannedIntents)
        return plannedIntents
    }

    function dropRuntimeActionAt(index) {
        if(index < 0 || index >= queuedTabActions.length) return null
        const [removed] = queuedTabActions.splice(index, 1)
        return removed || null
    }

    function dropRuntimeActions(predicate = null) {
        if(typeof predicate !== 'function') return []
        const removed = []
        for(let index = queuedTabActions.length - 1; index >= 0; index -= 1) {
            if(!predicate(queuedTabActions[index], index)) continue
            const [item] = queuedTabActions.splice(index, 1)
            if(item) removed.unshift(item)
        }
        return removed
    }

    function getRuntimeSurface(options = {}) {
        const matchesRuntime = typeof options.matchesRuntime === 'function'
            ? options.matchesRuntime
            : () => false
        const getMetadata = typeof options.getMetadata === 'function'
            ? options.getMetadata
            : tabId => getQueuedTabMetadata(tabId) || {}
        const getActivationTabId = typeof options.getActivationTabId === 'function'
            ? options.getActivationTabId
            : action => normalizeTabId(action?.tabId || action?.createdTabId || action?.targetTabId)
        const activeTabs = []
        const pendingActions = []
        const queuedActions = []

        for(const tabId of activeQueuedTabs) {
            const metadata = getMetadata(tabId) || {}
            if(matchesRuntime(metadata)) {
                activeTabs.push({
                    tabId: normalizeTabId(tabId),
                    runtime: metadata
                })
            }
        }
        for(const [tabId, action] of pendingTabActions.entries()) {
            if(matchesRuntime(action)) {
                pendingActions.push({
                    tabId: normalizeTabId(tabId),
                    runtime: action
                })
            }
        }
        for(const action of queuedTabActions) {
            if(matchesRuntime(action)) {
                queuedActions.push({
                    tabId: getActivationTabId(action),
                    runtime: action
                })
            }
        }

        return {
            activeTabs,
            pendingActions,
            queuedActions,
            hasSurface: activeTabs.length > 0 || pendingActions.length > 0 || queuedActions.length > 0
        }
    }

    function getRuntimeCounts() {
        return {
            pendingTabActions: pendingTabActions.size,
            queuedTabActions: queuedTabActions.length,
            activeQueuedTabs: activeQueuedTabs.size,
            queuedTabMetadata: queuedTabMetadata.size,
            queuedProfileOpenReservations: queuedProfileOpenReservations.size,
            removedQueuedRuntimeTabIds: removedQueuedRuntimeTabIds.size,
            ownedParents: ownedTabIdsByParent.size,
            ownedChildren: owningParentByChild.size,
            canceledQueuedOwners: canceledQueuedUrlsByOwner.size,
            pausedQueuedOwners: pausedQueuedOwners.size,
            orderedQueueKeys: orderedQueueKeys.length
        }
    }

    // rebuildQueueOrder/getOrderedQueueKeys/getOrderedQueueItems (second
    // index, 2026-09-12, see entropy-reduction-action-plan-2026-09-09.md
    // "queue processing order"): the durable coordinatorQueue map is keyed
    // by href/coordinatorKey for O(1) lookup by identity, but a plain JS
    // object never reorders an existing key on reassignment -- so without a
    // second, explicitly-ordered index, a chronically-retried item stays at
    // whatever position it first landed at and can starve fresher work
    // sitting behind it in iteration order. Each item now carries a
    // `queueSequence` (jobState.js's getNextCoordinatorQueueSequence),
    // assigned fresh on enqueue and on every retry-to-queued transition.
    // This structure is that second index: an array of keys sorted by
    // queueSequence ascending, always fully reconstructible from the
    // durable queue (never itself the source of truth), so there's no
    // separate durability/replay story for it -- it's rebuilt whenever the
    // resident authority state refreshes (see refreshResidentCoordinatorAuthorityState
    // in sw.js), which already happens after essentially every coordinator
    // queue mutation. A full O(n log n) sort on each refresh is trivial at
    // this queue's realistic size (hundreds of items, not millions) --
    // the cost that mattered in the incident this fixes was repeated full
    // WAL replay, not an in-memory sort.
    function rebuildQueueOrder(queue = {}) {
        orderedQueueKeys = Object.entries(queue || {})
            .sort(([leftKey, leftItem], [rightKey, rightItem]) => {
                const leftSequence = Number.parseInt(leftItem?.queueSequence, 10) || 0
                const rightSequence = Number.parseInt(rightItem?.queueSequence, 10) || 0
                return leftSequence - rightSequence || leftKey.localeCompare(rightKey)
            })
            .map(([key]) => key)
        return orderedQueueKeys.length
    }

    function getOrderedQueueKeys() {
        return orderedQueueKeys.slice()
    }

    // Defensive against staleness: if the ordered index hasn't been rebuilt
    // since some key was added to `queue` (e.g. a caller working from a
    // freshly-loaded projection that never round-tripped through
    // refreshResidentCoordinatorAuthorityState), every item still gets
    // visited -- known keys in their intended order first, then any
    // leftover keys the index doesn't know about yet, in their natural
    // object order. Correctness never depends on the index being perfectly
    // fresh; only the ordering quality does.
    //
    // Entropy-reduction Phase 7 audit finding (2026-09-12, see
    // entropy-reduction-action-plan-2026-09-09.md item 7): this function is
    // meant to be the cheap alternative to a raw `Object.entries(queue)`
    // scan, but as originally written it unconditionally paid for a SECOND
    // full `Object.entries(queue)` pass (the leftover-key check) on every
    // call, on top of the walk over `orderedQueueKeys` -- i.e. it cost
    // *more* than the raw scan it was meant to replace, in the common case
    // where the index is fully fresh (no staleness) and there's nothing to
    // find. Fast path: if every key visited via `orderedQueueKeys` produced
    // an item (`items.length`) and that count equals the queue's total own
    // key count, the two key sets must be identical (each visited key is
    // drawn from `queue` itself and is unique), so there are no leftover
    // keys and the second pass can't find anything -- skip it.
    function getOrderedQueueItems(queue = {}) {
        const items = []
        const seen = new Set()
        for(const key of orderedQueueKeys) {
            const item = queue?.[key]
            if(!item) continue
            items.push([key, item])
            seen.add(key)
        }
        const queueKeyCount = queue ? Object.keys(queue).length : 0
        if(items.length === queueKeyCount) return items
        for(const [key, item] of Object.entries(queue || {})) {
            if(seen.has(key)) continue
            items.push([key, item])
        }
        return items
    }

    return {
        addActiveQueuedTab,
        addOwnedTab,
        clearRemovedQueuedRuntimeTab,
        clearProfileOpenReservations,
        consumeActivationIntent,
        consumeCanceledQueuedOwnerUrls,
        deleteActiveQueuedTab,
        deletePendingTabAction,
        deleteProfileOpenReservation,
        deleteQueuedTabMetadata,
        dropRuntimeActionAt,
        dropRuntimeActions,
        enqueueActivationIntent,
        enqueueActivationIntents,
        getActivationIntentCount,
        getActivationIntentAt,
        getActiveQueuedTabCount,
        getOrderedQueueItems,
        getOrderedQueueKeys,
        getOwnedTabsForParent,
        getOwningParentForChild,
        getPendingTabAction,
        getPendingTabActionCount,
        getProfileOpenReservation,
        getProfileOpenReservationCount,
        getQueuedTabMetadata,
        getRuntimeCounts,
        getRuntimeSurface,
        hasActiveOrPendingQueuedTabs,
        hasActiveQueuedTab,
        hasOwnedChild,
        hasOwnedParent,
        hasOwnedTabState,
        hasPendingTabAction,
        hasPausedQueuedOwner,
        hasQueuedTabMetadata,
        hasRemovedQueuedRuntimeTab,
        listActiveQueuedTabIds,
        listActivationIntents,
        listOwnedTabParentEntries,
        listPendingTabActionEntries,
        listPendingTabActions,
        listPendingTabActionTabIds,
        listPausedQueuedOwners,
        listQueuedTabMetadataEntries,
        listQueuedTabMetadataTabIds,
        mapActivationIntents,
        markRemovedQueuedRuntimeTab,
        patchQueuedTabMetadata,
        pauseQueuedOwner,
        pruneProfileOpenReservations,
        rebuildOwningParentByChild,
        rebuildQueueOrder,
        requeueActivationIntent,
        rememberCanceledQueuedOwnerUrls,
        removeOwnedTab,
        replaceOwnedTabParents,
        replaceActivationIntents,
        resumeQueuedOwner,
        restoreActivationIntents,
        setOwnedTabsForParent,
        setPendingTabAction,
        setProfileOpenReservation,
        someActivationIntent
    }
}

module.exports = {
    createQueueRuntimeState
}
