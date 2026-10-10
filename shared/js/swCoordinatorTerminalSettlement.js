// Coordinator terminal-settlement helpers extracted from sw.js
// (decomposition Slice 20). The cluster: the terminal-item settlement-key
// builder, the terminal-item-entries filter used by
// settleTerminalCoordinatorItemsLocked (still in sw.js, `async`, out of
// scope per the plan's "Boundary after Slice 17" section),
// settleConfirmedSpaceFeedProfiles (the pending/nuked space-feed record
// settlement step), scheduleTerminalOwnedProfileTabCleanup (the
// setTimeout-deferred owned-tab cleanup kickoff), and
// buildTerminalCoordinatorSettlementDerivedPayload (the payload builder that
// ties settleConfirmedSpaceFeedProfiles together with the pending/nuked
// storage keys).
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
// Because of that early construction point, two of this module's own
// dependencies -- getStoredSpaceFeedRecordUrls and
// getPendingSpaceFeedJobKeyPatch, both from coordinatorJobEnvelope (Slice
// 11) -- are not yet available as bare consts at construction time
// (coordinatorJobEnvelope constructs later, further down in sw.js). Each is
// threaded through as a thunk (`(...args) => getStoredSpaceFeedRecordUrls(...args)`),
// deferring name resolution to call time, matching the
// queuedTabOpenUrlCommitHelpers/getTabObservedUrls precedent already used
// in sw.js for exactly this situation.
//
// isTerminalCoordinatorStatus (Slice 12), getNormalizedProfileHrefList
// (Slice 10/profileResolution), and normalizeQuoraProfileUrl (top-of-file
// require) are all available as bare consts well before this module's
// construction point, so they're threaded through directly, no thunk
// needed. getCoordinatorItemHref, closeTerminalOwnedProfileTabs,
// scheduleCoordinatorReconcile, removeProfileHrefFromPendingSpaceRecords,
// and normalizeStoredProfileNukeProgress are all still plain hoisted
// function declarations in sw.js (untouched by this slice) -- hoisted
// declarations are visible throughout their enclosing scope regardless of
// textual position, so these are threaded through directly too, with no
// ordering risk either way.
//
// Clock/environment-global note: settleConfirmedSpaceFeedProfiles read
// Date.now() directly (twice, for nextPending/nextNuked record
// `updatedAt` stamps). Per the plan's clock note, `now` is threaded
// through this module's deps as `() => Date.now()`; both sites now read
// `now()` instead. setTimeout is threaded through as `setTimeoutFn`,
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
// defaults (top-of-file `require('./defaults')`), SPACE_PENDING_NUKED_POSTS_KEY,
// and SPACE_NUKED_POSTS_KEY (both top-of-file consts/requires) are threaded
// through as constants, matching the swCoordinatorSourceProvenance.js
// (Slice 18) precedent for `defaults`.

function createCoordinatorTerminalSettlement(deps = {}) {
    const {now, setTimeoutFn} = deps
    const {
        SPACE_PENDING_NUKED_POSTS_KEY,
        SPACE_NUKED_POSTS_KEY,
        defaults
    } = deps.constants || {}
    const {
        isTerminalCoordinatorStatus,
        getNormalizedProfileHrefList,
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        getStoredSpaceFeedRecordUrls,
        getPendingSpaceFeedJobKeyPatch,
        getPrunedNukedPosts,
        removeProfileHrefFromPendingSpaceRecords,
        normalizeStoredProfileNukeProgress,
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

    function settleConfirmedSpaceFeedProfiles(currentPending = {}, currentNuked = {}, confirmedHrefs = new Set()) {
        const nextPending = {
            ...currentPending
        }
        const nextNuked = {
            ...currentNuked
        }
        let changedPending = false
        let changedNuked = false

        for(const [postKey, record] of Object.entries(currentPending || {})) {
            const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
            const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
            const nextRemainingUrls = remainingUrls.filter(url => !confirmedHrefs.has(url))

            if(nextRemainingUrls.length === remainingUrls.length) continue

            changedPending = true

            if(nextRemainingUrls.length > 0) {
                nextPending[postKey] = {
                    ...record,
                    remainingUrls: nextRemainingUrls,
                    ...getPendingSpaceFeedJobKeyPatch(record, nextRemainingUrls),
                    updatedAt: now()
                }
                continue
            }

            delete nextPending[postKey]
            nextNuked[postKey] = {
                ...(currentNuked?.[postKey] || {}),
                postKey,
                postUrl: record.postUrl || currentNuked?.[postKey]?.postUrl || '',
                spaceKey: record.spaceKey || currentNuked?.[postKey]?.spaceKey || '',
                spaceUrl: record.spaceUrl || currentNuked?.[postKey]?.spaceUrl || '',
                urls: getNormalizedProfileHrefList(allUrls.length ? allUrls : remainingUrls),
                updatedAt: now()
            }
            changedNuked = true
        }

        return {nextPending, nextNuked, changedPending, changedNuked}
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

    function buildTerminalCoordinatorSettlementDerivedPayload(stored = {}, progress = {}, options = {}) {
        const confirmedHrefs = options.confirmedHrefs || new Set()
        const clearedHrefs = options.clearedHrefs || new Set()
        const progressChanged = options.progressChanged === true
        const progressRecords = progressChanged
            ? normalizeStoredProfileNukeProgress(options.progressRecords || {})
            : {}
        const currentPending = stored?.[SPACE_PENDING_NUKED_POSTS_KEY] || {}
        const currentNuked = stored?.[SPACE_NUKED_POSTS_KEY] || {}
        const confirmedResult = settleConfirmedSpaceFeedProfiles(currentPending, currentNuked, confirmedHrefs)
        const clearedResult = removeProfileHrefFromPendingSpaceRecords(confirmedResult.nextPending, Array.from(clearedHrefs))
        const prunedNuked = confirmedResult.changedNuked
            ? getPrunedNukedPosts(confirmedResult.nextNuked, {
                retentionDays: defaults.nukedPostRetentionDays,
                maxEntries: defaults.maxRememberedNukedPosts
            })
            : confirmedResult.nextNuked
        const payload = {}

        if(confirmedResult.changedPending || clearedResult.changed) {
            payload[SPACE_PENDING_NUKED_POSTS_KEY] = clearedResult.records
        }
        if(confirmedResult.changedNuked) {
            payload[SPACE_NUKED_POSTS_KEY] = prunedNuked
        }

        return {
            payload,
            progressRecords,
            pendingPosts: payload[SPACE_PENDING_NUKED_POSTS_KEY] || null,
            nukedPosts: payload[SPACE_NUKED_POSTS_KEY] || null
        }
    }

    return {
        getCoordinatorItemSettlementKey,
        getCoordinatorTerminalItemEntries,
        settleConfirmedSpaceFeedProfiles,
        scheduleTerminalOwnedProfileTabCleanup,
        buildTerminalCoordinatorSettlementDerivedPayload
    }
}

module.exports = {
    createCoordinatorTerminalSettlement
}
