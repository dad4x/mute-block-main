// Queued-tab reclaim/resume/durable-authority predicates extracted from
// sw.js (decomposition Slice 27): shouldResumeCoordinatorItem,
// getLiveTabForCoordinatorItem, selectQueuedWorkerReclaimTab,
// isQueuedTabActionBackedByDurableQueuedAuthority,
// dropVolatileQueuedActionsForDurableResume, and
// dropVolatileQueuedActionsForCoordinatorItem.
//
// Construction-order note: unlike Slice 26, none of these six function
// names are eagerly referenced by any already-extracted module's own
// construction-call object literal in sw.js (every reference found is a
// plain runtime call inside a function body, not a deps.handlers object
// literal evaluated at module-eval time), so this module constructs in
// place, at this cluster's own former source-text position, rather than
// being hoisted to the top of the file. All of its own dependencies --
// isCoordinatorQueueAuthoritativeItem/isTerminalCoordinatorStatus/
// isActiveCoordinatorStatus (coordinatorStatusRules), isProfileResolutionItem/
// getCoordinatorItemQueueKey (profileResolution), getCoordinatorItemHref
// (coordinatorExecutorClassification), normalizeTabId (tabIdUtils),
// incrementQueueWakeupMetric/getQueueLoadThrottle/pushQueueWakeupJournalEntry
// (queueWakeupMetricsShape), recordCoordinatorDiagnosticEvent
// (coordinatorAttemptIdentity), hasMismatchedCoordinatorAttempt
// (coordinatorJobEnvelope), getSchedulerBlockingQueuedExecutorCount
// (queuedTabRuntimeStatus), clearStaleQueuedTabFillPromise
// (storageIdlePromiseLatch), and queueRuntime -- are all already available
// as bare consts well before this cluster's line range. getPersistedQueuedTabId,
// getOwnedOrExpectedLiveTabsForProfileHref, hasConfirmedLiveRuntimeActorForCoordinatorItem,
// and rememberCanceledOwnerUrls are still plain hoisted `function`
// declarations further below in sw.js -- hoisted declarations are visible
// throughout their enclosing scope regardless of textual position, so all
// four are threaded through directly, no thunk needed.
//
// coordinatorAuthority (excluded from extraction per the plan's "Boundary
// after Slice 17" section) is threaded through as a `getCoordinatorAuthority`
// state thunk, matching the existing convention in
// swQueuedRuntimeActionMatching.js and swActivationGuardRuntime.js.
//
// Mutable-state note: dropVolatileQueuedActionsForDurableResume reads the
// module-level `let queuedTabFillPromise` directly in sw.js, which is
// reassigned elsewhere (queued-tab-fill scheduling). A plain destructured
// value would snapshot it once at construction time, so it's threaded
// through as a live accessor, `getQueuedTabFillPromise: () => queuedTabFillPromise`,
// matching the `getQueuedTabConcurrency`-style convention used by Slice 26.
//
// Clock/environment-global note: none of these six functions read
// Date.now() or any other environment-faked global, so no `now` dep is
// needed.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. selectQueuedWorkerReclaimTab has
// `void browser.tabs.remove(tabId).catch(() => null)` -- a Promise chain,
// but reaching into the host `browser` API (passed through as a plain dep,
// same as swexecutor.js's and swBootstrap.js's identical
// `void browser.tabs.remove(...).catch(...)` pattern), not into another
// `require()`'d module, so it carries no realm-crossing concern per the
// architecture.md refinement (which is specifically about chains reaching
// into other extracted modules). No other hits.

function createQueuedTabReclaimResume(deps = {}) {
    const {
        isCoordinatorQueueAuthoritativeItem,
        isTerminalCoordinatorStatus,
        isActiveCoordinatorStatus,
        hasConfirmedLiveRuntimeActorForCoordinatorItem,
        getCoordinatorItemHref,
        isProfileResolutionItem,
        normalizeQuoraProfileUrl,
        getOwnedOrExpectedLiveTabsForProfileHref,
        getPersistedQueuedTabId,
        normalizeTabId,
        incrementQueueWakeupMetric,
        recordCoordinatorDiagnosticEvent,
        hasMismatchedCoordinatorAttempt,
        getCoordinatorItemQueueKey,
        queueRuntime,
        getSchedulerBlockingQueuedExecutorCount,
        clearStaleQueuedTabFillPromise,
        getQueueLoadThrottle,
        pushQueueWakeupJournalEntry,
        rememberCanceledOwnerUrls,
        browser
    } = deps.handlers || {}
    const {
        SERVICE_WORKER_QUEUE_OWNER_ID
    } = deps.constants || {}
    const {
        getCoordinatorAuthority = () => null,
        getQueuedTabFillPromise = () => null
    } = deps.state || {}

    function shouldResumeCoordinatorItem(item = null, liveProfileTabsByHref = new Map(), options = {}) {
        if(!item || typeof item !== 'object') return false
        if(!isCoordinatorQueueAuthoritativeItem(item)) return false
        if(isTerminalCoordinatorStatus(item.status)) return false

        const status = `${item.status || ''}`.trim()
        if(status === 'queued') return true
        if(!isActiveCoordinatorStatus(status)) return false

        const record = options.record || null
        if(hasConfirmedLiveRuntimeActorForCoordinatorItem(item, record, liveProfileTabsByHref)) return false

        const href = getCoordinatorItemHref(item)
        return !!href || isProfileResolutionItem(item)
    }

    function getLiveTabForCoordinatorItem(item = null, itemKey = '', liveProfileTabsByHref = new Map(), record = null) {
        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        if(!href) return null

        const candidates = getOwnedOrExpectedLiveTabsForProfileHref(item, record, href, liveProfileTabsByHref)
        if(!candidates.length) return null

        const itemTabId = getPersistedQueuedTabId(item, record)
        if(itemTabId) {
            const matchingTab = candidates.find(tab => normalizeTabId(tab?.id) === itemTabId)
            if(matchingTab) return matchingTab
        }

        return candidates.find(tab => tab?.active !== true) || candidates[0] || null
    }

    function selectQueuedWorkerReclaimTab(candidates = [], reason = 'queued-worker-reclaim') {
        const ordered = (candidates || [])
            .filter(tab => normalizeTabId(tab?.id))
            .sort((left, right) => {
                if(left?.active === true && right?.active !== true) return 1
                if(left?.active !== true && right?.active === true) return -1
                return normalizeTabId(left?.id) - normalizeTabId(right?.id)
            })
        const selected = ordered[0] || null
        if(!selected || ordered.length <= 1) return selected

        incrementQueueWakeupMetric('reconcile.changed.closedDuplicateWorkerSurfaceTab', ordered.length - 1)
        for(const extra of ordered.slice(1)) {
            const tabId = normalizeTabId(extra?.id)
            if(!tabId) continue
            void browser.tabs.remove(tabId).catch(() => null)
        }

        recordCoordinatorDiagnosticEvent(
            'duplicate-worker-surface-tabs-reclaimed',
            `${reason || 'queued-worker-reclaim'} selected one worker tab and closed ${ordered.length - 1} duplicate tab(s)`
        )
        return selected
    }

    function isQueuedTabActionBackedByDurableQueuedAuthority(action = null) {
        if(!action || typeof action !== 'object') return false
        const actionHref = normalizeQuoraProfileUrl(
            action.profileHref ||
            action.targetProfileHref ||
            action.requestedUrl ||
            action.url ||
            ''
        )
        const actionKey = action.coordinatorKey || actionHref || ''
        if(!actionHref && !actionKey) return false

        const queue = getCoordinatorAuthority().current()?.queue || {}
        const item = (actionHref && queue[actionHref]) ||
            (actionKey && queue[actionKey]) ||
            null
        if(!item || `${item.status || ''}`.trim() !== 'queued') return false
        if(hasMismatchedCoordinatorAttempt(item, action)) return false

        const itemHref = getCoordinatorItemHref(item)
        const itemKey = getCoordinatorItemQueueKey(item, actionKey)
        return (!!actionHref && actionHref === itemHref) ||
            (!!actionKey && actionKey === itemKey)
    }

    function dropVolatileQueuedActionsForDurableResume(reason = 'resume-rebuild-from-durable-queue', details = {}) {
        const dropped = queueRuntime.getActivationIntentCount()
        if(!dropped) return 0
        if(getSchedulerBlockingQueuedExecutorCount() > 0) return 0
        if(getQueuedTabFillPromise() && !clearStaleQueuedTabFillPromise(reason)) {
            incrementQueueWakeupMetric('pump.noop.preservedVolatileQueuedActionsDuringFill', dropped)
            return 0
        }

        const throttle = getQueueLoadThrottle()
        if(throttle?.active && details.allowDuringThrottle !== true) return 0

        const preservedActions = queueRuntime.listActivationIntents().filter(action =>
            action?.planOnlyQueuedAuthority === true ||
            isQueuedTabActionBackedByDurableQueuedAuthority(action)
        )
        queueRuntime.replaceActivationIntents(preservedActions, {
            source: 'runtime-effect'
        })
        const droppedCount = dropped - preservedActions.length
        if(droppedCount <= 0) {
            incrementQueueWakeupMetric('pump.noop.preservedDurableBackedVolatileActions', preservedActions.length)
            return 0
        }
        incrementQueueWakeupMetric('pump.changed.droppedVolatileQueuedActions', droppedCount)
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'volatile-queued-actions-dropped',
            reason,
            result: 'state-changed',
            details: {
                dropped: droppedCount,
                preserved: preservedActions.length,
                ...details
            }
        })
        return droppedCount
    }

    function dropVolatileQueuedActionsForCoordinatorItem(item = null, itemKey = '', reason = 'coordinator-item-projection-drop') {
        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
        const targetKeys = new Set([href, coordinatorKey, itemKey].filter(Boolean))
        if(!targetKeys.size || !queueRuntime.getActivationIntentCount()) return 0

        let dropped = 0
        for(let index = queueRuntime.getActivationIntentCount() - 1; index >= 0; index -= 1) {
            const action = queueRuntime.getActivationIntentAt(index)
            if(action?.planOnlyQueuedAuthority === true) continue
            const actionHref = normalizeQuoraProfileUrl(
                action?.profileHref ||
                action?.targetProfileHref ||
                action?.url ||
                action?.requestedUrl ||
                ''
            )
            const actionCoordinatorKey = `${action?.coordinatorKey || ''}`.trim()
            if(!targetKeys.has(actionHref) && !targetKeys.has(actionCoordinatorKey)) continue
            if(action?.url) {
                rememberCanceledOwnerUrls(action?.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID, [action.url])
            }
            queueRuntime.dropRuntimeActionAt(index)
            dropped += 1
        }

        if(dropped > 0) {
            incrementQueueWakeupMetric('pump.changed.droppedCoordinatorItemVolatileAction', dropped)
            pushQueueWakeupJournalEntry({
                kind: 'state-change',
                name: 'coordinator-item-volatile-action-dropped',
                reason,
                result: 'state-changed',
                details: {
                    dropped,
                    href,
                    coordinatorKey
                }
            })
        }
        return dropped
    }

    return {
        shouldResumeCoordinatorItem,
        getLiveTabForCoordinatorItem,
        selectQueuedWorkerReclaimTab,
        isQueuedTabActionBackedByDurableQueuedAuthority,
        dropVolatileQueuedActionsForDurableResume,
        dropVolatileQueuedActionsForCoordinatorItem
    }
}

module.exports = {
    createQueuedTabReclaimResume
}
