// Queued-worker-window action-surface state predicates + bookkeeping
// extracted from sw.js (decomposition Slice 32, part 2 of 3):
// shouldUseQueuedWorkerActionSurface, resetQueuedWorkerActionSurface,
// isQueuedWorkerActionSurfaceUrl, makeQueuedWorkerActionSurfaceState,
// isIdleQueuedWorkerActionSurfaceTab, hasQueuedWorkerActionSurfaceRuntimeWork,
// hasDurableQueuedBacklogForActionSurface, tagActionWithQueuedWorkerSurface,
// and isQueuedWorkerActionSurfaceTab.
//
// scheduleQueuedWorkerActionSurfaceCleanup, textually interleaved in this
// same range in sw.js, was deliberately left behind: it builds a
// `.then()/.catch()` chain (via its internal setTimeout callback) calling
// closeQueuedWorkerActionSurfaceIfIdle, a resident async orchestrator that
// stays in sw.js under this decomposition effort's current sync/async
// boundary (see architecture.md's realm-boundary section and the plan's
// Promise-chain realm-crossing note). Moving it would turn a same-realm
// call into a genuine new vm/require() realm crossing on every cleanup
// cycle -- exactly the class of bug Slice 7 found -- so it stays resident
// per the plan's explicit "leave any that trip it behind" guidance for
// schedule* names in this cluster. It is also eagerly referenced in
// browserSessionRuntime's own construction-call `handlers` object literal
// very early in sw.js (line ~1189, well before this module could ever
// construct), which independently rules out moving it without a much
// larger restructuring.
//
// State-threading: queuedActionSurfaceWindowId, queuedActionSurfaceAnchorTabId,
// queuedActionSurfaceOpenPromise, and queuedActionSurfaceCleanupTimeout/
// queuedActionSurfaceCleanupDueAt are module-level `let`s in sw.js that
// remain heavily read and written by many resident async window-management
// orchestrators well outside this slice's scope (getLiveQueuedWorkerActionSurface,
// getOrCreateQueuedWorkerActionSurface, closeQueuedWorkerActionSurfaceWindow,
// findReusableIdleQueuedWorkerActionSurfaceWindow, and others). Rather than
// have this module own that state outright -- which would force a much
// larger rewrite of those resident orchestrators' bodies as a side effect
// of moving these nine functions -- sw.js keeps the bare `let`s and threads
// narrow getter/setter closures for just the touches these nine functions
// need, the same convention used by swQueuedForegroundLeaseRuntime.js (part
// 1 of this slice) and already established by registerServiceWorkerListeners
// for getQueuedActionSurfaceWindowId/setProfileNukeProgress and similar.
//
// Clock/environment-global note: makeQueuedWorkerActionSurfaceState and
// tagActionWithQueuedWorkerSurface each read Date.now() (the latter via a
// `activatedAt = Date.now()` default parameter) -- both threaded through as
// `now`/`getNow` per the decomposition plan's clock note. resetQueuedWorkerActionSurface
// calls clearTimeout directly on a handle sw.js itself created via its own
// (possibly fake-timer) setTimeout -- threaded through as `clearTimeoutFn`,
// matching the swexecutor.js/swscheduler.js/swstorage.js precedent for the
// same reason: a bare `clearTimeout` reference in this module's own realm
// would resolve to the real Node timer API instead of the test harness's
// injected fake one.
//
// Promise-chain realm-crossing scrutiny (architecture.md's Slice-7
// refinement): resetQueuedWorkerActionSurface fire-and-forget `void`-calls
// resident async clearPersistedQueuedWorkerActionSurfaceState with no
// `.then()`/`.catch()` of its own -- per the Slice-30 refinement, an
// unchained relay/discard doesn't pay the extra-tick cost since nothing
// here ever awaits or chains the returned promise; the callee's own
// internal await chain executes in its own (sw.js) realm regardless of
// which realm called it. Verified green under `npm run test:parallel`.
// The other eight functions have no `.then(`, `Promise.`, `async`, or
// `setTimeout` in their bodies at all.

function createQueuedWorkerActionSurfaceState(deps = {}) {
    const {
        now: getNow = () => Date.now(),
        clearTimeoutFn = clearTimeout
    } = deps
    const {
        SERVICE_WORKER_QUEUE_OWNER_ID
    } = deps.constants || {}
    const {
        browser,
        queueRuntime,
        normalizeTabId,
        normalizeOwnedParentId,
        isForegroundQueuedTabWork,
        getQueuedTabMetadata,
        getQueuedActionSurfaceUrl,
        getQueuedActionNoForegroundFallback,
        incrementQueueWakeupMetric,
        clearPersistedQueuedWorkerActionSurfaceState
    } = deps.handlers || {}
    const {
        getWindowId = () => null,
        setWindowId = () => {},
        setAnchorTabId = () => {},
        getOpenPromise = () => null,
        getCleanupTimeout = () => null,
        setCleanupTimeout = () => {},
        setCleanupDueAt = () => {}
    } = deps.state || {}

    function shouldUseQueuedWorkerActionSurface(action = {}) {
        if(normalizeOwnedParentId(action?.ownerTabId) !== SERVICE_WORKER_QUEUE_OWNER_ID) return false
        if(!isForegroundQueuedTabWork(action, null)) return false
        if(!browser.windows?.create || !browser.tabs?.update) return false
        return true
    }

    function resetQueuedWorkerActionSurface(reason = '') {
        if(getCleanupTimeout()) {
            clearTimeoutFn(getCleanupTimeout())
            setCleanupTimeout(null)
        }
        setCleanupDueAt(0)
        setWindowId(null)
        setAnchorTabId(null)
        void clearPersistedQueuedWorkerActionSurfaceState(reason || 'reset')
        if(reason) {
            incrementQueueWakeupMetric(`actionSurface.reset.${reason}`)
        }
    }

    function isQueuedWorkerActionSurfaceUrl(url = '') {
        return `${url || ''}` === getQueuedActionSurfaceUrl()
    }

    function makeQueuedWorkerActionSurfaceState(windowId = null, anchorTabId = null, reason = '') {
        const normalizedWindowId = Number.parseInt(windowId, 10) || 0
        const normalizedAnchorTabId = normalizeTabId(anchorTabId || null)
        if(!normalizedWindowId) return null
        return {
            windowId: normalizedWindowId,
            anchorTabId: normalizedAnchorTabId || null,
            url: getQueuedActionSurfaceUrl(),
            reason: `${reason || ''}`.trim(),
            updatedAt: getNow()
        }
    }

    function isIdleQueuedWorkerActionSurfaceTab(tab = null) {
        const url = `${tab?.url || ''}`
        return !url ||
            /^about:blank$/i.test(url) ||
            /^chrome:\/\/newtab\/?$/i.test(url) ||
            isQueuedWorkerActionSurfaceUrl(url)
    }

    function hasQueuedWorkerActionSurfaceRuntimeWork(windowId = getWindowId()) {
        const normalizedWindowId = Number.parseInt(windowId, 10) || 0
        if(getOpenPromise()) return true

        for(const tabId of queueRuntime.listActiveQueuedTabIds()) {
            const metadata = getQueuedTabMetadata(tabId)
            if(!metadata) continue
            if(metadata.actionSurfaceMode === 'worker-window') return true
            if(normalizedWindowId && Number.parseInt(metadata.actionSurfaceWindowId, 10) === normalizedWindowId) return true
            if(normalizedWindowId && Number.parseInt(metadata.ownerWindowId, 10) === normalizedWindowId) return true
        }

        for(const action of queueRuntime.listPendingTabActions()) {
            if(action?.actionSurfaceMode === 'worker-window') return true
            if(normalizedWindowId && Number.parseInt(action?.actionSurfaceWindowId, 10) === normalizedWindowId) return true
            if(normalizedWindowId && Number.parseInt(action?.ownerWindowId, 10) === normalizedWindowId) return true
        }

        return false
    }

    function hasDurableQueuedBacklogForActionSurface(queue = {}, windowId = null) {
        const queuedItems = Object.values(queue || {})
            .filter(item => `${item?.status || ''}`.trim() === 'queued')
        if(!queuedItems.length) return false

        const normalizedWindowId = Number.parseInt(windowId, 10) || 0
        if(!normalizedWindowId) return true

        return queuedItems.some(item => {
            const itemWindowId = Number.parseInt(item?.actionSurfaceWindowId, 10) || 0
            if(itemWindowId) return itemWindowId === normalizedWindowId
            // A freshly-queued item that hasn't been dispatched yet carries
            // no actionSurfaceWindowId/actionSurfaceMode tag at all -- those
            // are only set at dispatch time (tagActionWithQueuedWorkerSurface).
            // Live incident (2026-09-17): this used to treat such an item as
            // "not this surface's problem", so in the gap between one queued
            // tab releasing and the next being claimed, this check saw no
            // recognized backlog and closed the window, which then had to be
            // recreated moments later for the next item. isForegroundQueuedTabWork
            // is a pure data check on the item's own actionKind (independent
            // of dispatch-time tagging), so it can tell -- before the item is
            // ever claimed -- whether it will need this surface at all.
            return `${item?.actionSurfaceMode || ''}`.trim() === 'worker-window' ||
                getQueuedActionNoForegroundFallback(item) ||
                isForegroundQueuedTabWork(null, item)
        })
    }

    function tagActionWithQueuedWorkerSurface(action = {}, surface = {}, tab = {}, activatedAt = getNow()) {
        action.actionSurfaceMode = 'worker-window'
        action.actionSurfaceWindowId = surface.windowId || tab.windowId || null
        action.actionSurfaceAnchorTabId = surface.anchorTabId || null
        action.actionSurfaceActivatedAt = activatedAt
        return action
    }

    function isQueuedWorkerActionSurfaceTab(tab = null, metadata = null) {
        const tabWindowId = Number.parseInt(tab?.windowId, 10) || 0
        const metadataWindowId = Number.parseInt(metadata?.actionSurfaceWindowId, 10) || 0
        const currentWindowId = Number.parseInt(getWindowId(), 10) || 0

        if(metadata?.actionSurfaceMode === 'worker-window') return true
        if(tabWindowId && metadataWindowId && tabWindowId === metadataWindowId) return true
        if(tabWindowId && currentWindowId && tabWindowId === currentWindowId) return true
        return false
    }

    return {
        shouldUseQueuedWorkerActionSurface,
        resetQueuedWorkerActionSurface,
        isQueuedWorkerActionSurfaceUrl,
        makeQueuedWorkerActionSurfaceState,
        isIdleQueuedWorkerActionSurfaceTab,
        hasQueuedWorkerActionSurfaceRuntimeWork,
        hasDurableQueuedBacklogForActionSurface,
        tagActionWithQueuedWorkerSurface,
        isQueuedWorkerActionSurfaceTab
    }
}

module.exports = {
    createQueuedWorkerActionSurfaceState
}
