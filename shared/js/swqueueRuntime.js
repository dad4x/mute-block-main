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
    // 2026-09-29 (nudge-accept cleanup, step 1): the removed-tab flag latches
    // permanently -- once set it blocks all future setQueuedTabMetadata
    // writes and recoverPendingTabActionFromCoordinatorQueue recovery for
    // that tabId, forever. ~25 call sites can set it, several of them
    // speculative (a slow-but-still-loading tab reclaimed by a retry, not a
    // confirmed close). Recording which reason won lets a live nudge
    // rejection be traced back to the actual detach call site instead of
    // guessing across all of them.
    const removedQueuedRuntimeTabReasons = new Map()
    const ownedTabIdsByParent = new Map()
    const owningParentByChild = new Map()
    const canceledQueuedUrlsByOwner = new Map()
    const pausedQueuedOwners = new Set()
    let orderedQueueKeys = new Set()

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

    function markRemovedQueuedRuntimeTab(tabId, reason = '') {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false
        removedQueuedRuntimeTabIds.add(normalizedTabId)
        if(!removedQueuedRuntimeTabReasons.has(normalizedTabId)) {
            removedQueuedRuntimeTabReasons.set(normalizedTabId, `${reason || ''}`.trim() || 'unknown')
        }
        return true
    }

    function clearRemovedQueuedRuntimeTab(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false
        removedQueuedRuntimeTabReasons.delete(normalizedTabId)
        return removedQueuedRuntimeTabIds.delete(normalizedTabId)
    }

    function hasRemovedQueuedRuntimeTab(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return !!(normalizedTabId && removedQueuedRuntimeTabIds.has(normalizedTabId))
    }

    function getRemovedQueuedRuntimeTabReason(tabId) {
        const normalizedTabId = normalizeTabId(tabId)
        return (normalizedTabId && removedQueuedRuntimeTabReasons.get(normalizedTabId)) || ''
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

    // 2026-09-27: getRuntimeSurfaceForCoordinatorItem (swCoordinatorExecutorClassification.js)
    // used to call getRuntimeSurface above -- a full scan of activeQueuedTabs
    // + pendingTabActions + queuedTabActions -- once per queue row in
    // classifyCoordinatorExecutorState's main loop. That's O(queue size x
    // runtime state size) per tick, not just O(queue size): with a ~560-row
    // live queue and even a modest ~10-20 runtime entries, that's 5,000+
    // comparisons per classify call, every ~1s tick, confirmed as the
    // dominant unmeasured cost behind the scan-cost metrics (which only
    // counted the outer loop). This lets a caller take one flat, unfiltered
    // snapshot of all three runtime collections ONCE per classify call,
    // then look candidates up by href/coordinatorKey (see
    // buildRuntimeSurfaceIndex) instead of re-scanning per row -- same
    // matching predicate, applied to a pre-filtered candidate set instead
    // of everything, so the result can't differ except in the one
    // degenerate case noted on buildRuntimeSurfaceIndex.
    function listRuntimeSurfaceEntries() {
        const entries = []
        for(const tabId of activeQueuedTabs) {
            entries.push({
                group: 'activeTabs',
                tabId: normalizeTabId(tabId),
                runtime: getQueuedTabMetadata(tabId) || {}
            })
        }
        for(const [tabId, action] of pendingTabActions.entries()) {
            entries.push({
                group: 'pendingActions',
                tabId: normalizeTabId(tabId),
                runtime: action
            })
        }
        for(const action of queuedTabActions) {
            entries.push({
                group: 'queuedActions',
                tabId: normalizeTabId(action?.tabId || action?.createdTabId || action?.targetTabId),
                runtime: action
            })
        }
        return entries
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
        const sortedKeys = Object.entries(queue || {})
            .sort(([leftKey, leftItem], [rightKey, rightItem]) => {
                const leftSequence = Number.parseInt(leftItem?.queueSequence, 10) || 0
                const rightSequence = Number.parseInt(rightItem?.queueSequence, 10) || 0
                return leftSequence - rightSequence || leftKey.localeCompare(rightKey)
            })
            .map(([key]) => key)
        orderedQueueKeys = new Set(sortedKeys)
        return orderedQueueKeys.size
    }

    function getOrderedQueueKeys() {
        return Array.from(orderedQueueKeys)
    }

    function getOrderedQueueKeyCount() {
        return orderedQueueKeys.size
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

    // O(1) incremental mutations for the Set-backed ordered queue keys index.
    // Wired into sw.js's refreshResidentCoordinatorAuthorityState via
    // syncOrderedQueueKeysFromQueueDiff below (2026-09-26) -- see that
    // function's comment for how they're actually used.
    //
    // noteOrderedQueueKeyPresent: moves an existing key to the end
    // (for enqueue/requeue-to-back where an item re-enters the live queue),
    // or adds a new key at the end. Returns true if the key was normalized
    // and processed, false if the key was empty/invalid.
    //
    // noteOrderedQueueKeyAbsent: removes a key (for terminal settlement or
    // other transitions out of the live queue). Returns true if the key was
    // present and removed, false if the key was invalid or not in the set.
    // Safe to call multiple times on the same key (idempotent on second call).
    function noteOrderedQueueKeyPresent(key = '') {
        const normalized = `${key || ''}`.trim()
        if(!normalized) return false
        orderedQueueKeys.delete(normalized)
        orderedQueueKeys.add(normalized)
        return true
    }

    function noteOrderedQueueKeyAbsent(key = '') {
        const normalized = `${key || ''}`.trim()
        if(!normalized) return false
        return orderedQueueKeys.delete(normalized)
    }

    // Replaces rebuildQueueOrder's O(n log n) full sort on every resident
    // refresh (2026-09-26) with an O(n) diff against the previously-resident
    // queue, using the incremental O(1)-per-key primitives above for each
    // key that actually changed. Only valid when `orderedQueueKeys` is
    // already correctly ordered from a prior rebuild/sync -- diffing against
    // an empty or unrelated `previousQueue` can only recover which keys are
    // present, not their queueSequence order, so the caller must fall back
    // to rebuildQueueOrder itself the first time (see
    // getOrderedQueueKeyCount's use at the one call site in sw.js).
    // Correctness never depends on this being exactly right either way --
    // getOrderedQueueItems's own staleness fallback (above) still catches
    // anything this misses -- this only affects ordering quality.
    function syncOrderedQueueKeysFromQueueDiff(previousQueue = {}, nextQueue = {}) {
        const previous = previousQueue || {}
        const next = nextQueue || {}
        for(const key of Object.keys(previous)) {
            if(!Object.prototype.hasOwnProperty.call(next, key)) {
                noteOrderedQueueKeyAbsent(key)
            }
        }
        for(const key of Object.keys(next)) {
            const previousItem = previous[key]
            if(!previousItem) {
                noteOrderedQueueKeyPresent(key)
                continue
            }
            const previousSequence = Number.parseInt(previousItem?.queueSequence, 10) || 0
            const nextSequence = Number.parseInt(next[key]?.queueSequence, 10) || 0
            if(nextSequence !== previousSequence) {
                noteOrderedQueueKeyPresent(key)
            }
        }
        return orderedQueueKeys.size
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
        getOrderedQueueKeyCount,
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
        getRemovedQueuedRuntimeTabReason,
        listActiveQueuedTabIds,
        listActivationIntents,
        listOwnedTabParentEntries,
        listPendingTabActionEntries,
        listRuntimeSurfaceEntries,
        listPendingTabActions,
        listPendingTabActionTabIds,
        listPausedQueuedOwners,
        listQueuedTabMetadataEntries,
        listQueuedTabMetadataTabIds,
        mapActivationIntents,
        markRemovedQueuedRuntimeTab,
        noteOrderedQueueKeyAbsent,
        noteOrderedQueueKeyPresent,
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
        someActivationIntent,
        syncOrderedQueueKeysFromQueueDiff
    }
}

module.exports = {
    createQueueRuntimeState
}
