// Tab-id/URL utilities extracted from sw.js (decomposition Slice 21):
// normalizeTabId, the single most foundational primitive in the file (207
// external refs before this move -- by far the highest fan-in of anything
// claimed by any slice so far), plus the small cluster that sits beside it
// in source order: getCoordinatorPageUrl, getQueuedActionSurfaceUrl,
// normalizeOwnedParentId, isBrowserTabId, and dedupeCoordinatorTabs.
//
// Construction-order note: this module constructs far earlier than this
// cluster's old source-text position (originally sw.js lines 8341-8450),
// immediately after coordinatorStatusRules near the top of the file.
// makeQueuedTabOpenUrlCommitHelpers (swexecutor.js, constructed at what was
// line 640 before this slice) eagerly references bare `normalizeTabId` in
// its own construction-call object literal -- the earliest of many such
// eager references (also coordinatorRuns-adjacent modules further down:
// coordinatorProgressRules, coordinatorProgressReducer,
// activationGuardRuntime, coordinatorReclaimEvidence,
// coordinatorReconcileInputs, queuedTabRuntimeStatus, and
// coordinatorReconcileLockedMaterialization, all constructed later but
// still well before this cluster's old position). A hoisted `function`
// declaration is visible throughout its enclosing scope; a `const`
// destructured from a factory call is in the temporal dead zone until that
// line executes -- so this module must construct before all of those eager
// references, which means before makeQueuedTabOpenUrlCommitHelpers, the
// earliest of them. sw.js destructures this module's exports back onto
// their original bare names (the same "destructure back to bare name"
// trick used by every prior slice, most recently for
// getAttemptIdFromValue at 251 refs in Slice 11 and
// getCoordinatorItemQueueKey at 74 refs in Slice 10), so none of those
// construction call sites' literal source text needed to change -- every
// one of them already used bare unrenamed `normalizeTabId,` shorthand.
//
// dedupeCoordinatorTabs needs special handling: it wraps
// dedupeCoordinatorTabsOnce (an `async` function that stays resident in
// sw.js, out of scope per the plan -- it's in the async bucket) in a
// same-promise-at-a-time queue via a module-level `coordinatorDedupePromise`
// variable. That variable was previously a bare `let` in sw.js's top scope
// (line ~437) but nothing else in sw.js ever read or wrote it, so per the
// Slice-5 precedent ("hide the Maps behind named methods, don't re-expose
// raw collections") it now lives as private closure state inside this
// module's factory instead -- sw.js's old top-level `let
// coordinatorDedupePromise = Promise.resolve()` was deleted. That also
// removes what would otherwise have been a second construction-order
// constraint (needing to construct after that `let`, in addition to before
// makeQueuedTabOpenUrlCommitHelpers).
//
// dedupeCoordinatorTabsOnce itself is threaded through directly (no thunk):
// it's still a plain hoisted `async function` declaration in sw.js, and a
// hoisted declaration -- including an `async` one -- is fully initialized
// and visible throughout its enclosing scope regardless of textual
// position, so referencing it from this module's construction call
// (evaluated very early in file order) works the same as referencing it
// from any other point in sw.js.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement and the plan's caution for this slice): dedupeCoordinatorTabs
// is not `async`, but its body builds a Promise chain --
// `coordinatorDedupePromise.catch(() => null).then(() =>
// dedupeCoordinatorTabsOnce(preferredTabId))` -- reaching into
// dedupeCoordinatorTabsOnce, which stays in sw.js (vm-sandboxed realm)
// while this module lives in the shared require() realm. Before this move,
// that whole chain executed within sw.js's own realm: zero crossings.
// After this move, the chain is built in this module's realm and calls
// back into sw.js's dedupeCoordinatorTabsOnce (threaded through as a
// handler dep) -- a new cross-realm crossing that did not exist before.
// This is exactly the shape Slice 20's scheduleTerminalOwnedProfileTabCleanup
// hit and the plan flags for extra scrutiny. Moved anyway per the plan's
// instruction ("try the move, verify with the full test suite"), and
// confirmed green against the full test:parallel suite (run twice) after
// the move. If a future regression is ever bisected to this function
// specifically, it can move back into sw.js alone without disturbing the
// other five -- its own body has no other coupling to the rest of this
// module besides normalizeTabId, which sw.js's destructure trick would
// still supply as a bare name either way.
//
// None of the six moved bodies read Date.now() or any other environment
// global, so this module needs no clock dependency.

function createTabIdUtils(deps = {}) {
    const {
        browser
    } = deps
    const {
        QUEUED_ACTION_SURFACE_COORDINATOR_HASH,
        COORDINATOR_HISTORY_HASH,
        SERVICE_WORKER_QUEUE_OWNER_ID
    } = deps.constants || {}
    const {
        dedupeCoordinatorTabsOnce
    } = deps.handlers || {}

    let coordinatorDedupePromise = Promise.resolve()

    function getCoordinatorPageUrl() {
        return browser.runtime.getURL('coordinator.html')
    }

    function getQueuedActionSurfaceUrl() {
        return `${getCoordinatorPageUrl()}${QUEUED_ACTION_SURFACE_COORDINATOR_HASH}`
    }

    function getCoordinatorHistoryPageUrl() {
        return `${getCoordinatorPageUrl()}${COORDINATOR_HISTORY_HASH}`
    }

    function normalizeTabId(value) {
        const parsed = Number.parseInt(value, 10)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }

    function normalizeOwnedParentId(value) {
        const tabId = normalizeTabId(value)
        if(tabId) return tabId

        const ownedParentId = `${value || ''}`.trim()
        return ownedParentId === SERVICE_WORKER_QUEUE_OWNER_ID ? SERVICE_WORKER_QUEUE_OWNER_ID : null
    }

    function isBrowserTabId(value) {
        return !!normalizeTabId(value)
    }

    function dedupeCoordinatorTabs(preferredTabId = null) {
        coordinatorDedupePromise = coordinatorDedupePromise
            .catch(() => null)
            .then(() => dedupeCoordinatorTabsOnce(preferredTabId))

        return coordinatorDedupePromise
    }

    return {
        getCoordinatorPageUrl,
        getCoordinatorHistoryPageUrl,
        getQueuedActionSurfaceUrl,
        normalizeTabId,
        normalizeOwnedParentId,
        isBrowserTabId,
        dedupeCoordinatorTabs
    }
}

module.exports = {
    createTabIdUtils
}
