// Queued-runtime-action matching extracted from sw.js (decomposition Slice
// 23, part 1): queuedRuntimeActionMatchesTabRuntime,
// queuedRuntimeActionHasActiveOrPendingSurface, and
// getQueuedRuntimeActionAuthorityEntry.
//
// This is a small, self-contained sub-topic of the plan's Slice 23 cluster
// ("Queued-runtime-action matching + rolled-back-retry classification") and
// is split into its own module rather than folded into the larger
// rolled-back-retry classification rulebook (swRolledBackQueuedTabRetryClassification.js,
// this slice's other module) for an ordering reason, not a size one: the
// already-extracted swActivationGuardRuntime.js (decomposition Slice 5)
// eagerly references bare `queuedRuntimeActionHasActiveOrPendingSurface` in
// its own construction-call handlers object in sw.js, so this module must
// construct before swActivationGuardRuntime.js does. The rolled-back-retry
// classification cluster's own dependencies -- most notably
// isQueuedTabAttemptBudgetExhausted, which only becomes available as a bare
// name once swQueuedTabRuntimeStatus.js (Slice 6) constructs, itself after
// swActivationGuardRuntime.js -- aren't ready that early, so bundling both
// sub-topics into one module would require a forward-reference thunk for
// that dependency where a straightforward two-module split avoids the need
// entirely. Neither module's functions call into the other's.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. None found -- all three functions are
// plain synchronous data-in/data-out logic over the passed-in `action`/
// `currentAuthorityState` plus the already-extracted queueRuntime instance.
//
// Clock note: none of these three read Date.now() or any other
// environment-faked global, so no `now` dep is needed here (contrast with
// this slice's other module, which does need one).
//
// coordinatorAuthority (excluded from extraction per the plan's "Boundary
// after Slice 17" section) is threaded through as a `getCoordinatorAuthority`
// state thunk, matching the existing convention in swActivationGuardRuntime.js
// -- deferred to call time, so this module can construct before
// `coordinatorAuthority` itself is assigned in sw.js.

function createQueuedRuntimeActionMatching(deps = {}) {
    const {
        normalizeTabId,
        getQueuedTabMetadata,
        queueRuntime,
        normalizeQuoraProfileUrl,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getCoordinatorActionKindForRequestedAction,
        makeProfileResolutionQueueKey,
        getCoordinatorItemHref,
        getCoordinatorItemQueueKey
    } = deps.handlers || {}
    const {
        getCoordinatorAuthority = () => null
    } = deps.state || {}

    function queuedRuntimeActionMatchesTabRuntime(action = {}, tabId = null) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false

        const metadata = getQueuedTabMetadata(normalizedTabId) || {}
        const pendingAction = queueRuntime.getPendingTabAction(normalizedTabId) || {}
        const actionHref = normalizeQuoraProfileUrl(
            action?.profileHref ||
            action?.targetProfileHref ||
            action?.targetUrl ||
            action?.url ||
            action?.requestedUrl ||
            ''
        )
        const runtimeHref = normalizeQuoraProfileUrl(
            metadata.profileHref ||
            pendingAction.profileHref ||
            pendingAction.targetProfileHref ||
            pendingAction.targetUrl ||
            pendingAction.url ||
            pendingAction.requestedUrl ||
            ''
        )
        const actionCoordinatorKey = `${action?.coordinatorKey || actionHref || ''}`.trim()
        const runtimeCoordinatorKey = `${metadata.coordinatorKey || pendingAction.coordinatorKey || runtimeHref || ''}`.trim()
        if(actionHref && runtimeHref && actionHref !== runtimeHref) return false
        if(actionCoordinatorKey && runtimeCoordinatorKey && actionCoordinatorKey !== runtimeCoordinatorKey) return false
        if(!actionHref && !actionCoordinatorKey) return false
        if(!runtimeHref && !runtimeCoordinatorKey) return false

        const actionAttemptId = getAttemptIdFromValue(action)
        const runtimeAttemptId = getAttemptIdFromValue(metadata) || getAttemptIdFromValue(pendingAction)
        if(actionAttemptId && runtimeAttemptId && actionAttemptId !== runtimeAttemptId) return false

        const actionAttemptNumber = getAttemptNumberFromValue(action)
        const runtimeAttemptNumber = getAttemptNumberFromValue(metadata) || getAttemptNumberFromValue(pendingAction)
        if(actionAttemptNumber && runtimeAttemptNumber && actionAttemptNumber !== runtimeAttemptNumber) return false

        const actionKind = getCoordinatorActionKindForRequestedAction(action?.actionKind || action?.tabAction || action?.action || '')
        const runtimeActionKind = getCoordinatorActionKindForRequestedAction(
            metadata.actionKind ||
            metadata.tabAction ||
            pendingAction.actionKind ||
            pendingAction.tabAction ||
            pendingAction.action ||
            ''
        )
        if(actionKind && runtimeActionKind && actionKind !== runtimeActionKind) return false

        return true
    }

    function queuedRuntimeActionHasActiveOrPendingSurface(action = {}) {
        const runtimeTabIds = new Set([
            ...queueRuntime.listActiveQueuedTabIds(),
            ...queueRuntime.listPendingTabActionTabIds()
        ])
        for(const tabId of runtimeTabIds) {
            if(queuedRuntimeActionMatchesTabRuntime(action, tabId)) return true
        }
        return false
    }

    function getQueuedRuntimeActionAuthorityEntry(action = {}, currentAuthorityState = null) {
        const queue = currentAuthorityState?.queue || getCoordinatorAuthority()?.current?.()?.queue || {}
        const normalizedHref = normalizeQuoraProfileUrl(
            action?.profileHref ||
            action?.targetProfileHref ||
            action?.targetUrl ||
            action?.url ||
            action?.requestedUrl ||
            ''
        )
        const coordinatorKey = action?.coordinatorKey || (normalizedHref
            ? normalizedHref
            : makeProfileResolutionQueueKey(action?.requestedUrl || action?.url || ''))
        const directItem = normalizedHref
            ? queue[normalizedHref] || queue[coordinatorKey] || null
            : queue[coordinatorKey] || null
        if(directItem) {
            return {
                item: directItem,
                key: normalizedHref && queue[normalizedHref] ? normalizedHref : coordinatorKey,
                href: normalizedHref
            }
        }

        for(const [key, item] of Object.entries(queue || {})) {
            const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(key)
            const itemKey = getCoordinatorItemQueueKey(item, key)
            if((normalizedHref && itemHref === normalizedHref) ||
                (coordinatorKey && itemKey === coordinatorKey)) {
                return {item, key, href: itemHref || normalizedHref}
            }
        }

        return {
            item: null,
            key: normalizedHref || coordinatorKey || '',
            href: normalizedHref
        }
    }

    return {
        queuedRuntimeActionMatchesTabRuntime,
        queuedRuntimeActionHasActiveOrPendingSurface,
        getQueuedRuntimeActionAuthorityEntry
    }
}

module.exports = {
    createQueuedRuntimeActionMatching
}
