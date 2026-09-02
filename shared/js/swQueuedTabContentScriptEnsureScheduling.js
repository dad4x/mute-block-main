// Queued-tab content-script-ensure scheduling predicates + bookkeeping
// extracted from sw.js (decomposition Slice 32, part 3 of 3):
// queuedTabMatchesExpectedOpenUrl, hasScriptingInjectionApi,
// getExpectedContentScriptVersion, scheduleQueuedTabContentScriptEnsure,
// and shouldDeferQueuedWorkerContentScriptEnsureRelease.
//
// None of these five are eagerly referenced anywhere in sw.js before their
// former source-text position, so this module constructs in place, unlike
// parts 1 and 2 of this slice.
//
// queuedTabMatchesExpectedOpenUrl is a thin synchronous delegate to
// queuedTabOpenUrlCommitHelpers (swexecutor.js's
// makeQueuedTabOpenUrlCommitHelpers, already extracted) -- no realm concern,
// it's a plain pass-through call with no `.then()`/`await` of its own.
//
// Promise-chain realm-crossing scrutiny (architecture.md's Slice-7
// refinement): scheduleQueuedTabContentScriptEnsure's setTimeout callback
// fire-and-forget `void`-calls resident async ensureQueuedTabContentScript
// with no `.then()`/`.catch()` of its own -- per the Slice-30 refinement,
// an unchained relay/discard doesn't pay the extra-tick cost since nothing
// here ever awaits or chains the returned promise, and the callee's own
// internal await chain executes in its own (sw.js) realm regardless of
// which realm called it. Verified green under `npm run test:parallel`.
// The other four functions have no `.then(`, `Promise.`, `async`, or
// `setTimeout` in their bodies at all.
//
// Clock/environment-global note: scheduleQueuedTabContentScriptEnsure calls
// setTimeout directly to arm its own delayed check -- threaded through as
// `setTimeoutFn`, matching the swexecutor.js/swQueuedWorkerActionSurfaceState.js
// precedent, since a bare `setTimeout` reference in this module's own realm
// would resolve to the real Node timer API instead of the test harness's
// injected fake one under the vm sandbox. None of these five read
// Date.now() directly.

function createQueuedTabContentScriptEnsureScheduling(deps = {}) {
    const {
        setTimeoutFn = setTimeout
    } = deps
    const {
        QUEUED_TAB_CONTENT_SCRIPT_CHECK_DELAY_MS
    } = deps.constants || {}
    const {
        browser,
        queueRuntime,
        normalizeTabId,
        isDurablyActiveQueuedTab,
        isQueuedWorkerActionSurfaceTab,
        queuedTabOpenUrlCommitHelpers,
        ensureQueuedTabContentScript
    } = deps.handlers || {}

    function queuedTabMatchesExpectedOpenUrl(tab = null, expectedUrl = '') {
        return queuedTabOpenUrlCommitHelpers.queuedTabMatchesExpectedOpenUrl(tab, expectedUrl)
    }

    function hasScriptingInjectionApi() {
        return !!browser.scripting?.executeScript
    }

    function getExpectedContentScriptVersion() {
        try {
            return `${browser.runtime?.getManifest?.()?.version || ''}`.trim()
        }
        catch {
            return ''
        }
    }

    function scheduleQueuedTabContentScriptEnsure(tabId, reason = '', delayMs = QUEUED_TAB_CONTENT_SCRIPT_CHECK_DELAY_MS) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return

        setTimeoutFn(() => {
            void ensureQueuedTabContentScript(normalizedTabId, reason)
        }, Math.max(0, Number.parseInt(delayMs, 10) || 0))
    }

    function shouldDeferQueuedWorkerContentScriptEnsureRelease(tabId, metadata = null) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId || !metadata) return false
        if(!queueRuntime.hasActiveQueuedTab(normalizedTabId) || !queueRuntime.hasPendingTabAction(normalizedTabId)) return false
        if(!isDurablyActiveQueuedTab(normalizedTabId)) return false
        if(metadata.closeRequestedAt || metadata.closeReason) return false
        if(metadata.noForegroundFallback !== true) return false
        return isQueuedWorkerActionSurfaceTab({id: normalizedTabId, windowId: metadata.actionSurfaceWindowId}, metadata)
    }

    return {
        queuedTabMatchesExpectedOpenUrl,
        hasScriptingInjectionApi,
        getExpectedContentScriptVersion,
        scheduleQueuedTabContentScriptEnsure,
        shouldDeferQueuedWorkerContentScriptEnsureRelease
    }
}

module.exports = {
    createQueuedTabContentScriptEnsureScheduling
}
