// Queued-activation-intent / pending-item subject-key + slot-capacity
// getters extracted from sw.js (decomposition Slice 24):
// getQueuedActivationIntentSubjectKey, getPendingCoordinatorItemSubjectKey,
// filterCurrentPendingItemsForPlannedActions, countQueuedExecutorSlotsForOwner,
// and getCoordinatorExecutorPlanBatchLimit.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. None found -- all five functions are
// plain synchronous data-in/data-out logic. The one interleaved function in
// this cluster's old source-text range that did have async/`.catch()`
// (reprimeFreshQueuedTabActionsForCurrentPendingItems, sitting textually
// between filterCurrentPendingItemsForPlannedActions and
// countQueuedExecutorSlotsForOwner) stays resident in sw.js, out of scope.
//
// Clock note: none of these five read Date.now() or any other
// environment-faked global, so no `now` dep is needed.
//
// getQueuedActivationIntentSubjectKey and getPendingCoordinatorItemSubjectKey
// call normalizeQuoraProfileUrl (a plain synchronous function from the
// already-extracted subject.js, required at the top of sw.js) and
// getCoordinatorItemQueueKey (a plain synchronous function from the
// already-extracted swProfileResolution.js) -- both threaded through as
// handler deps rather than required directly by this module, matching the
// swQueuedRuntimeActionMatching.js (Slice 23) precedent. getCoordinatorItemHref
// and getEffectiveQueuedTabConcurrency are still plain hoisted function
// declarations further below in sw.js (out of scope) -- hoisted
// declarations are visible throughout their enclosing scope regardless of
// textual position, so no thunk is needed, but they're still threaded
// through as handler deps rather than called as bare globals, so this
// module never assumes an sw.js-only ambient scope.
//
// No already-extracted module eagerly references any of these five names at
// its own construction call site in sw.js (the only other-module
// references found are ordinary runtime calls inside async orchestration
// functions that stay resident in sw.js -- fillQueuedTabsOnce's
// no-open-reprime branch, enqueueExistingExecutorForCoordinatorOnce, and
// reprimeFreshQueuedTabActionsForCurrentPendingItems -- not eager
// construction-time references), so this module constructs in place at the
// cluster's old source-text position, matching the Slice 19/22 precedent.

function createQueuedActivationSubjectKeys(deps = {}) {
    const {
        normalizeQuoraProfileUrl,
        getCoordinatorItemHref,
        getCoordinatorItemQueueKey,
        queueRuntime,
        getQueuedTabMetadata,
        getEffectiveQueuedTabConcurrency
    } = deps.handlers || {}
    const {
        COORDINATOR_EXECUTOR_PLAN_BATCH_FALLBACK_LIMIT
    } = deps.constants || {}

    function getQueuedActivationIntentSubjectKey(action = null) {
        return normalizeQuoraProfileUrl(
            action?.profileHref ||
                action?.targetProfileHref ||
                action?.requestedUrl ||
                action?.coordinatorKey ||
                action?.url ||
                ''
        ) || `${action?.coordinatorKey || action?.requestedUrl || action?.url || ''}`.trim()
    }

    function getPendingCoordinatorItemSubjectKey(item = null) {
        const fallbackKey = `${item?.rowKey || item?.coordinatorKey || ''}`.trim()
        return getCoordinatorItemHref(item || {}) ||
            getCoordinatorItemQueueKey(item || {}, fallbackKey) ||
            normalizeQuoraProfileUrl(item?.profileHref || item?.url || '') ||
            fallbackKey
    }

    function filterCurrentPendingItemsForPlannedActions(pendingItems = [], plannedActions = []) {
        if(!pendingItems.length || !plannedActions.length) return []

        const plannedKeys = new Set(
            plannedActions
                .map(getQueuedActivationIntentSubjectKey)
                .filter(Boolean)
        )
        if(!plannedKeys.size) return []

        return pendingItems.filter(item => plannedKeys.has(getPendingCoordinatorItemSubjectKey(item)))
    }

    function countQueuedExecutorSlotsForOwner(ownerTabId = null) {
        let count = 0
        for(const tabId of queueRuntime.listActiveQueuedTabIds()) {
            const metadata = getQueuedTabMetadata(tabId)
            const ownerId = metadata?.ownerTabId || queueRuntime.getOwningParentForChild(tabId) || null
            if(ownerTabId && ownerId !== ownerTabId) continue
            count += 1
        }
        for(const action of queueRuntime.listActivationIntents()) {
            const ownerId = action?.ownerTabId || null
            if(ownerTabId && ownerId !== ownerTabId) continue
            count += 1
        }
        return count
    }

    function getCoordinatorExecutorPlanBatchLimit(ownerTabId = null, options = {}) {
        const explicitLimit = Number.parseInt(options.planLimit ?? options.executorPlanLimit, 10)
        if(Number.isFinite(explicitLimit) && explicitLimit >= 0) return explicitLimit

        const concurrency = Math.max(
            COORDINATOR_EXECUTOR_PLAN_BATCH_FALLBACK_LIMIT,
            Number.parseInt(getEffectiveQueuedTabConcurrency(), 10) || 0
        )
        return Math.max(0, concurrency - countQueuedExecutorSlotsForOwner(ownerTabId))
    }

    return {
        getQueuedActivationIntentSubjectKey,
        getPendingCoordinatorItemSubjectKey,
        filterCurrentPendingItemsForPlannedActions,
        countQueuedExecutorSlotsForOwner,
        getCoordinatorExecutorPlanBatchLimit
    }
}

module.exports = {
    createQueuedActivationSubjectKeys
}
