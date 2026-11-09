// Coordinator terminal-settlement helpers extracted from sw.js
// (decomposition Slice 20). The cluster: the terminal-item settlement-key
// builder, the terminal-item-entries filter used by
// settleTerminalCoordinatorItemsLocked (still in sw.js, `async`, out of
// scope per the plan's "Boundary after Slice 17" section), and
// scheduleTerminalOwnedProfileTabCleanup (the setTimeout-deferred owned-tab
// cleanup kickoff). The space post map settlement (settleConfirmedSpaceFeedProfiles,
// the pending/nuked records) was removed: the feed decides per profile now,
// from the queue and the profile progress (owner, 25 Oct).
//
// Construction-order note: this module constructs well before this
// cluster's old source-text position (sw.js, right after
// coordinatorAttemptIdentity, before coordinatorProgressRules), not in
// place like most prior slices. Two already-extracted modules eagerly
// reference getCoordinatorItemSettlementKey in their own construction-call
// object literals: coordinatorProgressRules (Slice 17, constructed
// immediately after this point) and coordinatorReconcileLockedMaterialization
// (Slice 19, constructed much further down). A hoisted `function`
// declaration is visible throughout its enclosing scope; a `const`
// destructured from a factory call is in the temporal dead zone until that
// line executes -- so this module must construct before both of those eager
// references, which means before coordinatorProgressRules, the earlier of
// the two. sw.js destructures this module's exports back onto their
// original bare names (the same "destructure back to bare name" trick used
// by every prior slice's own construction site), so neither of those two
// construction call sites' literal source text needs to change -- their
// existing bare `getCoordinatorItemSettlementKey` reference now resolves to
// this module's export instead of the old hoisted declaration.
//
// isTerminalCoordinatorStatus (Slice 12) and normalizeQuoraProfileUrl
// (top-of-file require) are available as bare consts well before this module's
// construction point, so they're threaded through directly. getCoordinatorItemHref,
// closeTerminalOwnedProfileTabs and scheduleCoordinatorReconcile are plain hoisted
// function declarations in sw.js, so they are threaded through directly too.
//
// setTimeout is threaded through as `setTimeoutFn`,
// matching the queuedTabOpenUrlCommitHelpers precedent, since a raw
// `setTimeout` reference inside an extracted module resolves to the real
// Node timer rather than the test harness's injected fake one (the same
// realm-boundary concern documented in architecture.md for `Date`).
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement and the plan's Caution paragraph for this slice):
// scheduleTerminalOwnedProfileTabCleanup is not `async`, but its body
// builds a Promise chain -- `closeTerminalOwnedProfileTabs(hrefs).catch(...)`
// inside a setTimeout callback -- reaching into closeTerminalOwnedProfileTabs,
// an `async` function that stays in sw.js (out of scope, part of the async
// orchestration layer). Before this move, that chain executed entirely
// within sw.js's own realm: zero crossings. After this move, the setTimeout
// callback executes in this module's realm, calls back into sw.js's
// closeTerminalOwnedProfileTabs (threaded through as a handler dep), and
// chains `.catch()` onto the resulting Promise from this module's realm --
// a new cross-realm crossing that did not exist before. This is exactly the
// shape the plan flagged as needing extra scrutiny. Moved anyway per the
// plan's instruction ("try the move, verify with the full test suite"), and
// confirmed green against the full test:parallel suite after the move. If a
// future regression is ever bisected to this function specifically, revisit
// leaving it in sw.js instead (its own body has no other coupling to the
// rest of this module -- it could move back out alone without disturbing
// the other four).
//
function createCoordinatorTerminalSettlement(deps = {}) {
    const {setTimeoutFn} = deps
    const {
        isTerminalCoordinatorStatus,
        getNormalizedProfileHrefList,
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        closeTerminalOwnedProfileTabs,
        scheduleCoordinatorReconcile
    } = deps.handlers || {}

    function getCoordinatorItemSettlementKey(item = {}) {
        if(!isTerminalCoordinatorStatus(item?.status)) return ''

        return [
            item.status || '',
            item.outcome || '',
            item.error || '',
            item.terminalAt || item.updatedAt || 0
        ].join('|')
    }

    function getCoordinatorTerminalItemEntries(queue = {}, profileHrefs = []) {
        const hrefFilter = new Set(getNormalizedProfileHrefList(profileHrefs || []))
        const entries = []

        for(const [itemKey, item] of Object.entries(queue || {})) {
            if(!item || typeof item !== 'object') continue
            if(!isTerminalCoordinatorStatus(item.status)) continue

            const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            if(!href) continue
            if(hrefFilter.size && !hrefFilter.has(href)) continue

            entries.push({itemKey, href, item})
        }

        return entries
    }

    function scheduleTerminalOwnedProfileTabCleanup(profileHrefs = [], delayMs = 0) {
        const hrefs = getNormalizedProfileHrefList(profileHrefs || [])
        // An empty list is skipped. closeTerminalOwnedProfileTabs() with no list
        // is the unscoped pass, which only the reconcile-tick orphan sweep runs.
        if(!hrefs.length) return
        setTimeoutFn(() => {
            void closeTerminalOwnedProfileTabs(hrefs).catch(() => {
                scheduleCoordinatorReconcile(1000, {reason: 'terminal-tab-cleanup-failed'})
            })
        }, Math.max(0, Number.parseInt(delayMs, 10) || 0))
    }

    return {
        getCoordinatorItemSettlementKey,
        getCoordinatorTerminalItemEntries,
        scheduleTerminalOwnedProfileTabCleanup
    }
}

module.exports = {
    createCoordinatorTerminalSettlement
}
