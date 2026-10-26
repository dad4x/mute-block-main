// Profile-progress merge/normalize helpers extracted from sw.js
// (decomposition Slice 30): getProfileProgressStatusRank,
// profileProgressAttemptsMatch, preserveAdvancedProfileProgress,
// mergeStoredProfileProgressRecord, normalizeStoredProfileNukeProgress,
// preserveTerminalProfileProgress, shouldPreserveTerminalProfileProgress,
// normalizeProgressPatch, addSenderTabIdToProgressPatch,
// ensureProfileNukeProgressReady, removeProfileHrefFromPendingSpaceRecords,
// removeProfileHrefFromRememberedNukedPosts, and
// removeProfileHrefFromCoordinatorRuns. This is the per-record progress
// merge/precedence rulebook (which of two progress records for the same
// profile "wins" a given field), the incoming-patch normalizer that applies
// that rulebook to a single mutation, and the three href-removal sweepers
// used when a profile is cleared from tracked state.
//
// Construction-order finding: this module needs to be hoisted well ahead of
// this cluster's former source-text position. coordinatorTerminalSettlement
// (constructed near the top of sw.js, decomposition Slice 20) eagerly
// references bare `removeProfileHrefFromPendingSpaceRecords` and
// `normalizeStoredProfileNukeProgress` in its own construction-call
// `handlers` object literal; coordinatorProgressReducer (Slice 17) eagerly
// references bare `normalizeProgressPatch`; coordinatorSourceProvenance
// (Slice 18) eagerly references bare `removeProfileHrefFromCoordinatorRuns`,
// `removeProfileHrefFromPendingSpaceRecords`, and
// `removeProfileHrefFromRememberedNukedPosts`; profileNukeProgressShape
// (Slice 15) eagerly references bare `normalizeStoredProfileNukeProgress`.
// A hoisted `function` declaration is visible throughout its enclosing
// scope; a `const` destructured from a factory call is in the temporal dead
// zone until that line executes -- so this module must construct before the
// earliest of those eager references, which is coordinatorTerminalSettlement.
// It's placed immediately after coordinatorAttemptIdentity's destructure
// (its own latest-constructed dependency: getAttemptIdFromValue/
// getAttemptNumberFromValue) and before coordinatorTerminalSettlement's
// construction. Its other dependencies -- normalizeQuoraProfileUrl
// (top-of-file subject.js require), mapProgressToCoordinatorState
// (top-of-file jobState.js require), pruneProfileNukeProgress/
// mergeProfileProgressEvents/mergeUniqueStringList/
// getNormalizedProfileHrefList (profileResolution), normalizeTabId
// (tabIdUtils), and isTerminalProfileNukeRecord/
// isTransientProfileNukeStatus/isSuccessfulProfileNukeRecord (still plain
// hoisted function declarations far below, work from any point in this
// scope either way) -- are all already available by that point.
// getStoredSpaceFeedRecordUrls and getPendingSpaceFeedJobKeyPatch
// (coordinatorJobEnvelope, Slice 11, constructed well after this point)
// aren't available as bare consts yet, so each is threaded through as a
// thunk, matching the coordinatorTerminalSettlement/
// queuedTabOpenUrlCommitHelpers precedent for the same pair of functions.
// getCoordinatorRunIdsForHref, getCoordinatorRunTargetHrefs,
// isCoordinatorRunWorkKeyForProfileHref, and recomputeCoordinatorRuns
// (coordinatorRuns) are already available bare consts by this point too.
//
// Clock/environment-global note: mergeStoredProfileProgressRecord,
// normalizeProgressPatch, removeProfileHrefFromPendingSpaceRecords,
// removeProfileHrefFromRememberedNukedPosts, and
// removeProfileHrefFromCoordinatorRuns all read Date.now() directly (not
// via a default parameter) -- threaded through as a top-level
// `now: () => Date.now()` dep, matching the established convention.
// normalizeProgressPatch also builds an event-log entry with
// `new Date().toISOString()`; per the same clock/environment-global note
// (Date's object identity, not just timers, differs across the vm/Node
// realm boundary), that's threaded through separately as
// `nowIso: () => new Date().toISOString()` -- no existing sibling module
// needed this exact pattern yet, so this is a new but directly analogous
// extension of the established `now` convention.
//
// State note: normalizeProgressPatch reads a fallback base when no `existing`
// record is passed in. That base is the stored progress record, read through
// `state.getStoredProfileNukeProgressRecord` (20 Oct review). It used to be
// the module-level progress map in sw.js, which some writers do not keep in
// step with the stored copy. `profileNukeProgressReady` (the memoized load-promise
// latch used only by ensureProfileNukeProgressReady) is *not* shared with
// any other code, so it's relocated into this module's own closure state
// instead of staying a bare sw.js `let` -- it's re-initialized fresh each
// time this module's factory runs, matching how the equivalent bare `let`
// in sw.js was re-initialized fresh on every vm-sandboxed evaluation of
// sw.js during tests.
//
// Promise-chain realm-crossing scrutiny (architecture.md's Slice-7
// refinement): grepped every body for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, `void` before moving. Twelve of the thirteen have
// zero hits -- plain synchronous data-in/data-out builders/predicates.
// ensureProfileNukeProgressReady is the one with a name suggesting async
// orchestration despite having none of those tokens in its own body: it
// makes a single plain synchronous call into loadProfileNukeProgress (an
// `async function`, still resident in sw.js, threaded through as a plain
// handler dep) and stores/returns whatever Promise that call happens to
// return, without ever attaching a `.then()`/`.catch()` of its own. Per
// this module's sibling swStorageIdlePromiseLatch.js's header comment, the
// realm-crossing tick-cost risk documented in architecture.md is specific
// to Promise *chains* reaching across the vm/plain-realm boundary, not to a
// plain synchronous call into or out of an already-extracted module that
// happens to return a Promise without the caller chaining onto it -- the
// Promise itself is still constructed and settled entirely within
// loadProfileNukeProgress's home realm (sw.js) regardless of which realm
// held the reference in between. Moved here on that basis and verified
// against the full test:parallel suite; see this slice's commit message for
// confirmation it stayed green.
//
// cloneCoordinatorAuthorityValue and the createCoordinatorAuthority-adjacent
// region, plus the queue-WAL/shadow-WAL async cluster, are explicitly out
// of scope for this decomposition effort (see the plan's "Boundary after
// Slice 17" section) and are untouched here.

function createProfileProgressMerge(deps = {}) {
    const {
        normalizeQuoraProfileUrl,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        isTerminalProfileNukeRecord,
        isTransientProfileNukeStatus,
        isSuccessfulProfileNukeRecord,
        mapProgressToCoordinatorState,
        mergeUniqueStringList,
        mergeProfileProgressEvents,
        pruneProfileNukeProgress,
        normalizeTabId,
        getNormalizedProfileHrefList,
        getStoredSpaceFeedRecordUrls,
        getPendingSpaceFeedJobKeyPatch,
        getCoordinatorRunIdsForHref,
        getCoordinatorRunTargetHrefs,
        isCoordinatorRunWorkKeyForProfileHref,
        recomputeCoordinatorRuns,
        loadProfileNukeProgress
    } = deps.handlers || {}
    const {
        UNBLOCK_UNMUTE_ACTION_KIND
    } = deps.constants || {}
    const {getStoredProfileNukeProgressRecord} = deps.state || {}
    // The stored record of one profile, or null. Without the dependency (a caller that builds this module alone), there is no base.
    const readStoredProfileProgressRecord = typeof getStoredProfileNukeProgressRecord === 'function'
        ? getStoredProfileNukeProgressRecord
        : () => null
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
    const nowIso = typeof deps.nowIso === 'function' ? deps.nowIso : () => new Date().toISOString()

    let profileNukeProgressReady = null

    function getProfileProgressStatusRank(status = '') {
        return {
            queued: 0,
            'tab-opening': 1,
            'tab-opened': 2,
            'awaiting-visibility': 3,
            'page-ready': 4,
            retrying: 5,
            muting: 6,
            blocking: 7,
            unmuting: 8,
            unblocking: 9
        }[`${status || ''}`.trim()] ?? -1
    }

    function profileProgressAttemptsMatch(left = {}, right = {}) {
        const leftAttemptId = getAttemptIdFromValue(left)
        const rightAttemptId = getAttemptIdFromValue(right)
        if(leftAttemptId && rightAttemptId && leftAttemptId !== rightAttemptId) return false

        const leftAttemptNumber = getAttemptNumberFromValue(left)
        const rightAttemptNumber = getAttemptNumberFromValue(right)
        if(leftAttemptNumber && rightAttemptNumber && leftAttemptNumber !== rightAttemptNumber) return false

        return true
    }

    function preserveAdvancedProfileProgress(previous = {}, next = {}) {
        const previousRank = getProfileProgressStatusRank(previous?.status || '')
        const nextRank = getProfileProgressStatusRank(next?.status || '')
        if(previousRank >= 0 && nextRank >= 0 && previousRank > nextRank && profileProgressAttemptsMatch(previous, next)) {
            next.status = previous.status
        }

        for(const key of [
            'tabOpenedAt',
            'contentOpenedAt',
            'actionReadyAt',
            'muteAttemptedAt',
            'mutedAt',
            'blockAttemptedAt',
            'blockedAt',
            'unmuteAttemptedAt',
            'unmutedAt',
            'unblockAttemptedAt',
            'unblockedAt'
        ]) {
            const previousValue = Number.isFinite(previous?.[key]) ? previous[key] : 0
            const nextValue = Number.isFinite(next?.[key]) ? next[key] : 0
            if(previousValue > nextValue && profileProgressAttemptsMatch(previous, next)) {
                next[key] = previousValue
            }
        }

        if(profileProgressAttemptsMatch(previous, next)) {
            if(previous?.actionSurfaceMode && !next.actionSurfaceMode) {
                next.actionSurfaceMode = previous.actionSurfaceMode
            }
            if(previous?.actionSurfaceWindowId && !next.actionSurfaceWindowId) {
                next.actionSurfaceWindowId = previous.actionSurfaceWindowId
            }
            if(previous?.actionSurfaceAnchorTabId && !next.actionSurfaceAnchorTabId) {
                next.actionSurfaceAnchorTabId = previous.actionSurfaceAnchorTabId
            }
            const previousActivatedAt = Number.isFinite(previous?.actionSurfaceActivatedAt)
                ? previous.actionSurfaceActivatedAt
                : 0
            const nextActivatedAt = Number.isFinite(next?.actionSurfaceActivatedAt)
                ? next.actionSurfaceActivatedAt
                : 0
            if(previousActivatedAt > nextActivatedAt) {
                next.actionSurfaceActivatedAt = previousActivatedAt
            }
        }

        return next
    }

    function preserveTerminalProfileProgress(previous = {}, next = {}) {
        for(const key of [
            'status',
            'blockSucceeded',
            'unblockSucceeded',
            'foundBlockedBeforeQueue',
            'finalError',
            'terminalAt',
            'blockedAt',
            'unblockedAt',
            'unavailableReason'
        ]) {
            if(previous[key] !== undefined) next[key] = previous[key]
        }

        return next
    }

    function shouldPreserveTerminalProfileProgress(previous = {}, incoming = {}) {
        if(!isTerminalProfileNukeRecord(previous)) return false

        const previousActionKind = `${previous.actionKind || 'mute-block'}`.trim()
        const incomingActionKind = `${incoming.actionKind || previousActionKind}`.trim()
        if(previousActionKind !== incomingActionKind) return false

        const previousAttemptId = getAttemptIdFromValue(previous)
        const incomingAttemptId = getAttemptIdFromValue(incoming)
        if(previousAttemptId && incomingAttemptId && previousAttemptId !== incomingAttemptId) return false

        const previousAttemptNumber = getAttemptNumberFromValue(previous)
        const incomingAttemptNumber = getAttemptNumberFromValue(incoming)
        if(previousAttemptNumber && incomingAttemptNumber && previousAttemptNumber !== incomingAttemptNumber) return false

        if(isTransientProfileNukeStatus(incoming?.status)) return true

        const incomingMapped = mapProgressToCoordinatorState(incoming)
        return isSuccessfulProfileNukeRecord(previous) &&
            (incomingMapped.status === 'failed' || incomingMapped.status === 'skipped')
    }

    function mergeStoredProfileProgressRecord(existing = null, incoming = null, normalizedHref = '') {
        const left = existing && typeof existing === 'object' ? existing : {}
        const right = incoming && typeof incoming === 'object' ? incoming : {}
        const leftUpdatedAt = Number.isFinite(left.updatedAt) ? left.updatedAt : 0
        const rightUpdatedAt = Number.isFinite(right.updatedAt) ? right.updatedAt : 0
        const newer = rightUpdatedAt >= leftUpdatedAt ? right : left
        const older = newer === right ? left : right

        const merged = {
            ...older,
            ...newer,
            profileHref: normalizedHref || newer.profileHref || older.profileHref || ''
        }

        if(shouldPreserveTerminalProfileProgress(older, newer)) {
            preserveTerminalProfileProgress(older, merged)
        }
        preserveAdvancedProfileProgress(older, merged)

        merged.updatedAt = Math.max(leftUpdatedAt, rightUpdatedAt, now())

        if(left.postKeys || right.postKeys) {
            merged.postKeys = mergeUniqueStringList(left.postKeys || [], right.postKeys || [])
        }
        if(left.postUrls || right.postUrls) {
            merged.postUrls = mergeUniqueStringList(left.postUrls || [], right.postUrls || [])
        }

        const mergedEvents = mergeProfileProgressEvents(left.events || [], right.events || [])
        if(mergedEvents.length) {
            merged.events = mergedEvents
        }

        return merged
    }

    function normalizeStoredProfileNukeProgress(records) {
        const nextRecords = {}
        const entries = Object.entries(records || {})
            .filter(([key, value]) => !!key && value && typeof value === 'object')
            .sort((left, right) => {
                const leftUpdatedAt = Number.isFinite(left[1]?.updatedAt) ? left[1].updatedAt : 0
                const rightUpdatedAt = Number.isFinite(right[1]?.updatedAt) ? right[1].updatedAt : 0
                return leftUpdatedAt - rightUpdatedAt || left[0].localeCompare(right[0])
            })

        for(const [key, value] of entries) {
            const normalizedHref = normalizeQuoraProfileUrl(value?.profileHref || key || '')
            if(!normalizedHref) continue

            nextRecords[normalizedHref] = mergeStoredProfileProgressRecord(
                nextRecords[normalizedHref] || null,
                value,
                normalizedHref
            )
        }

        return pruneProfileNukeProgress(nextRecords)
    }

    function normalizeProgressPatch(profileHref, patch = {}, existing = null) {
        const normalizedHref = normalizeQuoraProfileUrl(profileHref)
        if(!normalizedHref) return null

        const replaceProgressRecord = patch?.replaceProgressRecord === true
        const cleanPatch = {
            ...patch
        }
        delete cleanPatch.replaceProgressRecord

        const previous = replaceProgressRecord ? {} : existing || readStoredProfileProgressRecord(normalizedHref) || {}
        const preserveTerminal = !replaceProgressRecord && shouldPreserveTerminalProfileProgress(previous, cleanPatch)
        const next = {
            ...previous,
            ...cleanPatch,
            profileHref: normalizedHref,
            updatedAt: now()
        }

        if(preserveTerminal) {
            preserveTerminalProfileProgress(previous, next)
        }
        if(!replaceProgressRecord) {
            preserveAdvancedProfileProgress(previous, next)
        }

        const resetQueuedProgress = cleanPatch.status === 'queued' && !preserveTerminal
        if(resetQueuedProgress) {
            Object.assign(next, {
                status: 'queued',
                attemptId: getAttemptIdFromValue(cleanPatch),
                attemptNumber: getAttemptNumberFromValue(cleanPatch),
                tabId: null,
                ownerTabId: null,
                ownerWindowId: null,
                tabCreatedAt: 0,
                tabOpenedAt: 0,
                contentOpenedAt: 0,
                actionReadyAt: 0,
                muteAttempted: false,
                muteAttemptedAt: 0,
                mutedAt: 0,
                muteSucceeded: false,
                blockAttempted: false,
                blockAttemptedAt: 0,
                blockedAt: 0,
                blockSucceeded: false,
                unmuteAttemptedAt: 0,
                unmutedAt: 0,
                unblockAttemptedAt: 0,
                unblockedAt: 0,
                unblockSucceeded: false,
                terminalAt: 0,
                tabClosedAt: 0,
                slotReleasedAt: 0,
                closeRequestedAt: 0,
                closedByExtension: false,
                closeReason: '',
                foregroundLeaseAcquiredAt: 0,
                foregroundPromotedAt: 0,
                foregroundPromotionReason: '',
                foregroundWaitLastEventAt: 0,
                foregroundWaitReason: '',
                foundBlockedBeforeQueue: false,
                openedViablePage: false,
                lastUrl: '',
                muteError: '',
                blockError: '',
                directBlockFailureDetail: null,
                finalError: '',
                unblockReason: '',
                unmuteReason: '',
                selectedActionLabel: '',
                selectedActionRect: null,
                menuActionLabels: [],
                visibleProfileMenuLabels: [],
                profileMenuOpen: false,
                profileBlocked: false,
                events: []
            })
        }
        else {
            const patchAttemptId = getAttemptIdFromValue(cleanPatch)
            const patchAttemptNumber = getAttemptNumberFromValue(cleanPatch)
            if(patchAttemptId) next.attemptId = patchAttemptId
            if(patchAttemptNumber) next.attemptNumber = patchAttemptNumber
        }

        if(next.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
            next.blockSucceeded = false
            next.foundBlockedBeforeQueue = false
        }

        if(
            !preserveTerminal &&
            cleanPatch.status !== 'queued' &&
            previous.actionKind === next.actionKind &&
            isTerminalProfileNukeRecord(previous) &&
            !isTerminalProfileNukeRecord(next)
        ) {
            preserveTerminalProfileProgress(previous, next)
        }

        if(next.blockSucceeded && next.status === 'interrupted') {
            next.status = next.foundBlockedBeforeQueue ? 'already-blocked' : 'blocked'
            next.finalError = ''
        }

        if(cleanPatch.postKeys || previous.postKeys) {
            next.postKeys = mergeUniqueStringList(previous.postKeys || [], cleanPatch.postKeys || [])
        }
        if(cleanPatch.postUrls || previous.postUrls) {
            next.postUrls = mergeUniqueStringList(previous.postUrls || [], cleanPatch.postUrls || [])
        }

        const event = `${cleanPatch.event || ''}`.trim()
        if(event) {
            const previousEvents = resetQueuedProgress
                ? []
                : Array.isArray(previous.events) ? previous.events : []
            next.events = [
                ...previousEvents,
                `${nowIso()} ${event}`
            ].slice(-12)
        }

        const successChanged = isSuccessfulProfileNukeRecord(next) && !isSuccessfulProfileNukeRecord(previous)
        if(isTerminalProfileNukeRecord(next) && (successChanged || !(Number.isFinite(next.terminalAt) && next.terminalAt > 0))) {
            next.terminalAt = now()
        }

        delete next.event
        return next
    }

    function addSenderTabIdToProgressPatch(patch = {}, senderTabId = null) {
        // The authenticated sender wins over a tab id in the patch body (review-2 S4-1).
        const normalizedTabId = normalizeTabId(senderTabId || patch?.tabId)
        if(!normalizedTabId) return patch

        return {
            ...patch,
            tabId: normalizedTabId
        }
    }

    function ensureProfileNukeProgressReady() {
        if(!profileNukeProgressReady) {
            const pending = loadProfileNukeProgress()
            profileNukeProgressReady = pending
            // A failed load (an authority that cannot be loaded, P4) must not stay latched. The next caller loads again. The
            // callers await the load itself, so this handler adds no tick to a successful load.
            pending.catch(() => {
                if(profileNukeProgressReady === pending) profileNukeProgressReady = null
            })
        }
        return profileNukeProgressReady
    }

    function removeProfileHrefFromPendingSpaceRecords(records = {}, profileHrefs = []) {
        const hrefs = new Set(getNormalizedProfileHrefList(Array.isArray(profileHrefs) ? profileHrefs : [profileHrefs]))
        if(!hrefs.size) return {records: {...records}, changed: false}

        const nextRecords = {
            ...records
        }
        let changed = false

        for(const [postKey, record] of Object.entries(records || {})) {
            const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
            const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
            const nextAllUrls = allUrls.filter(url => !hrefs.has(url))
            const nextRemainingUrls = remainingUrls.filter(url => !hrefs.has(url))

            if(nextAllUrls.length === allUrls.length && nextRemainingUrls.length === remainingUrls.length) {
                continue
            }

            changed = true
            if(nextAllUrls.length <= 0 && nextRemainingUrls.length <= 0) {
                delete nextRecords[postKey]
                continue
            }

            nextRecords[postKey] = {
                ...record,
                allUrls: nextAllUrls,
                remainingUrls: nextRemainingUrls,
                ...getPendingSpaceFeedJobKeyPatch(record, nextRemainingUrls),
                updatedAt: now()
            }
        }

        return {records: nextRecords, changed}
    }

    function removeProfileHrefFromRememberedNukedPosts(records = {}, profileHrefs = []) {
        const hrefs = new Set(getNormalizedProfileHrefList(Array.isArray(profileHrefs) ? profileHrefs : [profileHrefs]))
        if(!hrefs.size) return {records: {...records}, changed: false}

        const nextRecords = {
            ...records
        }
        let changed = false

        for(const [postKey, record] of Object.entries(records || {})) {
            // A pardon is history: a profile clear does not erase it (swManualHistory.js).
            if(record?.kind === 'pardon') continue
            const urls = getNormalizedProfileHrefList(record?.urls || [])
            const nextUrls = urls.filter(url => !hrefs.has(url))
            if(nextUrls.length === urls.length) continue

            changed = true
            if(nextUrls.length <= 0) {
                delete nextRecords[postKey]
                continue
            }

            nextRecords[postKey] = {
                ...record,
                urls: nextUrls,
                updatedAt: now()
            }
        }

        return {records: nextRecords, changed}
    }

    function removeProfileHrefFromCoordinatorRuns(runs = {}, queue = {}, normalizedHref = '') {
        const nextRuns = {
            ...runs
        }
        const affectedRunIds = new Set(getCoordinatorRunIdsForHref(runs, normalizedHref))
        let changed = false

        for(const [runId, run] of Object.entries(runs || {})) {
            const targetProfileHrefs = getCoordinatorRunTargetHrefs(run)
            const targetWorkKeys = Array.isArray(run?.targetWorkKeys) ? run.targetWorkKeys : []
            const nextTargetProfileHrefs = targetProfileHrefs.filter(href => href !== normalizedHref)
            const nextTargetWorkKeys = targetWorkKeys
                .filter(key => !isCoordinatorRunWorkKeyForProfileHref(key, normalizedHref))
            if(nextTargetProfileHrefs.length === targetProfileHrefs.length &&
                nextTargetWorkKeys.length === targetWorkKeys.length) {
                continue
            }

            affectedRunIds.add(runId)
            nextRuns[runId] = {
                ...run,
                targetProfileHrefs: nextTargetProfileHrefs,
                targetWorkKeys: nextTargetWorkKeys,
                updatedAt: now()
            }
            changed = true
        }

        const recomputedRuns = affectedRunIds.size
            ? recomputeCoordinatorRuns(queue, nextRuns, affectedRunIds)
            : nextRuns

        return {
            runs: recomputedRuns,
            changed: changed || JSON.stringify(recomputedRuns) !== JSON.stringify(runs)
        }
    }

    return {
        getProfileProgressStatusRank,
        profileProgressAttemptsMatch,
        preserveAdvancedProfileProgress,
        mergeStoredProfileProgressRecord,
        normalizeStoredProfileNukeProgress,
        preserveTerminalProfileProgress,
        shouldPreserveTerminalProfileProgress,
        normalizeProgressPatch,
        addSenderTabIdToProgressPatch,
        ensureProfileNukeProgressReady,
        removeProfileHrefFromPendingSpaceRecords,
        removeProfileHrefFromRememberedNukedPosts,
        removeProfileHrefFromCoordinatorRuns
    }
}

module.exports = {
    createProfileProgressMerge
}
