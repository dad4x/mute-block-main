// Queued-tab action-key/authority matching extracted from sw.js
// (decomposition Slice 37). Covers the rulebook a queued-tab activation
// intent, active-tab metadata record, or coordinator queue item is checked
// against: building/parsing an action's dedupe key, deciding whether
// current authority or terminal profile-nuke progress makes an activation
// intent stale, classifying an action's/metadata's action kind (including
// whether unblock/unmute work is present anywhere, which forces effective
// queued-tab concurrency down to 1), matching a profile href/action kind
// against an action or metadata record, and matching a coordinator queue
// item against a queued tab's runtime state -- both the strict
// single-tab-id match used once a tab is confirmed active, and the looser
// reclaim-candidate match used while a queued item is still pending.
//
// scheduleQueuedTabReleaseReconcile, despite the schedule-shaped name and
// sitting in the same source-text cluster as this group, is deliberately
// left resident in sw.js -- see the plan's explicit caution for this
// function. It isn't `async` and its own body builds nothing beyond a
// trivial `Promise.resolve({...plain object...})`, but its one caller,
// releaseQueuedTab (async, resident, part of the excluded queue-WAL-
// adjacent cluster), does
// `Promise.resolve(followUpPromise || null).then(result => ({...}))`
// directly on the exact Promise object scheduleQueuedTabReleaseReconcile
// returns. Moving scheduleQueuedTabReleaseReconcile into this (or any)
// extracted module would make that `.then()` chain reach across the vm/
// Node realm boundary onto a foreign-realm Promise every time a queued tab
// is released -- exactly the pattern architecture.md's Slice-7 refinement
// warns about, on a path that participates in reconcile-tick ordering. So
// it stays put rather than risk it.
//
// Realm-crossing scrutiny (per architecture.md's Slice-7 refinement): all
// 13 moved bodies were grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void` -- none present in any of them. All 13
// are plain synchronous functions calling only other plain synchronous
// functions, several of them internal to this module.
//
// Clock note: shouldCheckQueuedTabRuntimeAuthority reads Date.now() via a
// default parameter in its original sw.js form -- threaded through here as
// `state.now: () => Date.now()`, matching the existing schedulerClock-style
// convention, rather than left as a bare `Date.now()` default. The local
// parameter is renamed from `now` to `nowMs` to avoid shadowing the `now`
// dependency; the function's only caller always passes an explicit second
// argument, so this is a pure rename with no behavior change.
//
// Construction-order note: this module is constructed well before this
// cluster's old source-text location (decomposition Slice 37) --
// activationGuardRuntime (constructed immediately after, in place) eagerly
// references bare `getQueuedTabActionKey` and
// `shouldDropQueuedActionForCurrentAuthority` in its own construction-call
// `handlers` object literal, and queuedForegroundLeaseRuntime (constructed
// later still) eagerly references bare `coordinatorItemMatchesQueuedTabRuntime`
// the same way. A `const` destructured from a factory call is in the
// temporal dead zone until that line executes, so this module must
// construct before the earlier of those two references, i.e. before
// activationGuardRuntime. Every other handler dependency (queueRuntime,
// getQueuedTabMetadata, normalizeQuoraProfileUrl, makeProfileResolutionQueueKey,
// hasMismatchedCoordinatorAttempt, getCoordinatorActionKindForRequestedAction,
// shouldApplyProgressToCoordinatorItem, getQueueLoadThrottle,
// isTerminalProfileNukeRecord, isRetryableTerminalProfileNukeRecord,
// getCoordinatorActionKindForProgress, getAttemptIdFromValue,
// findCoordinatorQueueEntryForHref, getCoordinatorActionKindForItem,
// getCoordinatorItemHref, getCoordinatorItemQueueKey, getAttemptNumberFromValue,
// normalizeTabId, incrementQueueWakeupMetric) is already a bare const by
// this point in the file. getFreshQueuedTabRuntimeStartupAnchor is not --
// it's provided by the tab-status/reclaim/budget predicate module
// (decomposition Slice 6), constructed well after this point -- so it's
// threaded through as a thunk that defers name resolution to call time,
// matching existing precedent used elsewhere for the same kind of forward
// reference. coordinatorAuthority isn't assigned until later either, so
// it's threaded through as a `getCoordinatorAuthority` state getter, and
// queuedTabConcurrency (a module-level `let` mutated elsewhere in sw.js) as
// a `getQueuedTabConcurrency` state getter, both matching existing
// precedent for reading mutable resident state from an extracted module.

function createQueuedTabActionAuthorityMatching(deps = {}) {
    const {
        constants: {
            UNBLOCK_UNMUTE_ACTION_KIND,
            QUEUED_TAB_UNCONFIRMED_ACTIVE_RECONCILE_MS
        } = {},
        handlers: {
            queueRuntime,
            getQueuedTabMetadata,
            normalizeQuoraProfileUrl,
            makeProfileResolutionQueueKey,
            hasMismatchedCoordinatorAttempt,
            getCoordinatorActionKindForRequestedAction,
            shouldApplyProgressToCoordinatorItem,
            getQueueLoadThrottle,
            isTerminalProfileNukeRecord,
            isRetryableTerminalProfileNukeRecord,
            getCoordinatorActionKindForProgress,
            getAttemptIdFromValue,
            findCoordinatorQueueEntryForHref,
            getCoordinatorActionKindForItem,
            getCoordinatorItemHref,
            getCoordinatorItemQueueKey,
            getAttemptNumberFromValue,
            normalizeTabId,
            incrementQueueWakeupMetric,
            getFreshQueuedTabRuntimeStartupAnchor
        } = {},
        state: {
            getCoordinatorAuthority,
            getQueuedTabConcurrency,
            now
        } = {}
    } = deps

    function recordResidentAuthorityStaleQueuedActions(ownerTabId = null) {
        if(!queueRuntime.getActivationIntentCount()) return 0

        const currentAuthorityState = getCoordinatorAuthority().current()
        const queue = currentAuthorityState?.queue || null
        if(!queue) return 0

        let counted = 0
        for(const action of queueRuntime.listActivationIntents()) {
            const actionOwnerTabId = action?.ownerTabId || null
            if(ownerTabId && actionOwnerTabId !== ownerTabId) continue
            if(action?.authorityStaleDropCounted === true) continue
            if(!shouldDropQueuedActionForCurrentAuthority(action, queue)) continue

            action.authorityStaleDropCounted = true
            counted += 1
        }
        if(counted > 0) {
            incrementQueueWakeupMetric('pump.changed.droppedAuthorityStaleQueuedAction', counted)
        }
        return counted
    }

    function getQueuedTabActionKey(ownerTabId, href, tabAction = '') {
        const normalizedHref = normalizeQuoraProfileUrl(href || '')
        const subjectKey = normalizedHref || `${href || ''}`.trim()
        if(!ownerTabId || !subjectKey) return ''
        return `${ownerTabId}|${subjectKey}|${tabAction || ''}`
    }

    function shouldDropQueuedActionForCurrentAuthority(action = null, queue = {}) {
        if(!action || !queue || typeof queue !== 'object') return false

        const normalizedHref = normalizeQuoraProfileUrl(action.profileHref || action.url || '')
        const coordinatorKey = action.coordinatorKey || (normalizedHref
            ? normalizedHref
            : makeProfileResolutionQueueKey(action.requestedUrl || action.url || ''))
        const item = normalizedHref
            ? queue[normalizedHref] || queue[coordinatorKey] || null
            : queue[coordinatorKey] || null

        if(!item) return true
        if(`${item.status || ''}`.trim() !== 'queued') return true
        if(hasMismatchedCoordinatorAttempt(item, action)) return true

        const actionKind = getCoordinatorActionKindForRequestedAction(action.actionKind || action.tabAction || '')
        if(actionKind && !shouldApplyProgressToCoordinatorItem(item, {actionKind})) return true

        return false
    }

    function getQueuedTabActionKind(action = null) {
        return getCoordinatorActionKindForRequestedAction(action?.actionKind || action?.tabAction || '')
    }

    function hasQueuedUnblockUnmuteWork() {
        if(queueRuntime.someActivationIntent(action => getQueuedTabActionKind(action) === UNBLOCK_UNMUTE_ACTION_KIND)) return true

        for(const tabId of queueRuntime.listActiveQueuedTabIds()) {
            const metadata = getQueuedTabMetadata(tabId)
            if(getQueuedTabActionKind(metadata) === UNBLOCK_UNMUTE_ACTION_KIND) return true
        }

        return false
    }

    // Same action-kind set as sw.js's isForegroundQueuedTabAction (inlined
    // rather than threaded through as a new dep, to match this module's own
    // "narrow getter/setter, no new capability surface" convention) --
    // 'nuke', 'mute-block', and unblock-unmute all run through the shared
    // worker-window surface.
    function isForegroundQueuedActionKind(actionKind = '') {
        return actionKind === 'nuke' || actionKind === 'mute-block' || actionKind === UNBLOCK_UNMUTE_ACTION_KIND
    }

    function hasQueuedForegroundWork() {
        if(queueRuntime.someActivationIntent(action => isForegroundQueuedActionKind(getQueuedTabActionKind(action)))) return true

        for(const tabId of queueRuntime.listActiveQueuedTabIds()) {
            const metadata = getQueuedTabMetadata(tabId)
            if(isForegroundQueuedActionKind(getQueuedTabActionKind(metadata))) return true
        }

        return false
    }

    function getEffectiveQueuedTabConcurrency() {
        // 2026-09-27: this used to also force 1 whenever
        // hasQueuedUnblockUnmuteWork() was true, on top of the same
        // unconditional forcing enqueueExistingExecutorForCoordinatorOnce
        // used to do for any foreground/unblock-unmute batch (see that
        // function's own comment) -- the user asked to try full
        // concurrency now that the queue-handoff/scan-scope work is
        // stable, so this no longer treats unblock-unmute specially
        // either. Quora-pushback throttling (the check above) still forces
        // 1 regardless.
        //
        // 2026-09-29: NOT reinstating the foreground-work force here --
        // this function is also getCoordinatorExecutorPlanBatchLimit's
        // floor (swQueuedActivationSubjectKeys.js), which sizes how many
        // pending/exhausted rows can be planned/recovered in one executor
        // pass. That's bookkeeping, not tab-opening, and confirmed live
        // that forcing it to 1 here broke recovering multiple exhausted
        // rolled-back rows in a single pass. The actual tab-opening race
        // (two tabs opened 230ms apart into the single-tab worker window)
        // is fixed at the tab-opening gates specifically instead --
        // see getEffectiveQueuedTabOpenConcurrency below.
        if(getQueueLoadThrottle().active) return 1
        return getQueuedTabConcurrency()
    }

    // 2026-09-29: used only at the actual tab-opening gates (fillQueuedTabsOnce's
    // while-loop and capacity checks, sw.js; decideLiveProfileTabCapacityGate,
    // swFillQueuedTabsOnceDecisions.js) -- not by getCoordinatorExecutorPlanBatchLimit,
    // which stays on getEffectiveQueuedTabConcurrency() above. See that
    // function's comment for why the two needed to split: this one checks
    // the queue's actual current state directly (hasQueuedForegroundWork)
    // instead of trusting whichever of enqueueExistingExecutorForCoordinatorOnce's
    // five call sites last set the shared queuedTabConcurrency variable --
    // confirmed live that an overlapping call with a non-foreground batch
    // could reset that variable upward mid-loop, letting a second tab open
    // into the worker window before anything forced it back down.
    function getEffectiveQueuedTabOpenConcurrency() {
        if(hasQueuedForegroundWork()) return 1
        return getEffectiveQueuedTabConcurrency()
    }

    function shouldDropQueuedActionForTerminalProgress(action = null, record = null, queue = {}) {
        if(!action || !record) return false
        if(!isTerminalProfileNukeRecord(record) || isRetryableTerminalProfileNukeRecord(record)) return false

        const normalizedHref = normalizeQuoraProfileUrl(action.url || '')
        if(!normalizedHref) return false

        const actionKind = getQueuedTabActionKind(action)
        const recordActionKind = getCoordinatorActionKindForProgress(record)
        if(actionKind !== recordActionKind) return false

        const actionAttemptId = getAttemptIdFromValue(action)
        const recordAttemptId = getAttemptIdFromValue(record)
        if(actionAttemptId && recordAttemptId && actionAttemptId !== recordAttemptId) return false

        const queueEntry = findCoordinatorQueueEntryForHref(queue, normalizedHref)
        const item = queueEntry?.item || null
        if(!item) return !actionAttemptId || (!!recordAttemptId && actionAttemptId === recordAttemptId)
        if(`${item.status || ''}`.trim() === 'queued') return false
        if(getCoordinatorActionKindForItem(item) !== recordActionKind) return false
        if(hasMismatchedCoordinatorAttempt(item, record)) return false

        const itemAttemptId = getAttemptIdFromValue(item)
        if(itemAttemptId && recordAttemptId !== itemAttemptId) return false

        return true
    }

    function queuedTabActionMatchesProfile(action = null, href = '', actionKind = '') {
        const normalizedHref = normalizeQuoraProfileUrl(href || '')
        if(!action || !normalizedHref) return false
        if(normalizeQuoraProfileUrl(action.url || '') !== normalizedHref) return false
        if(!actionKind) return true

        const candidateActionKind = getCoordinatorActionKindForRequestedAction(action.actionKind || action.tabAction || '')
        return candidateActionKind === actionKind
    }

    function queuedTabMetadataMatchesProfile(metadata = null, href = '', actionKind = '') {
        const normalizedHref = normalizeQuoraProfileUrl(href || '')
        if(!metadata || !normalizedHref) return false
        if(normalizeQuoraProfileUrl(metadata.profileHref || '') !== normalizedHref) return false
        if(!actionKind) return true

        const candidateActionKind = getCoordinatorActionKindForRequestedAction(metadata.actionKind || metadata.tabAction || '')
        return candidateActionKind === actionKind
    }

    function getQueuedTabUnconfirmedActiveTransitionAt(metadata = null) {
        return Math.max(
            Number.parseInt(metadata?.activeTransitionPendingAt, 10) || 0,
            Number.parseInt(metadata?.activeTransitionUnconfirmedAt, 10) || 0
        )
    }

    function coordinatorItemMatchesQueuedTabRuntime(item = null, itemKey = '', metadata = null, tabId = null) {
        if(!item || !metadata) return false
        const expectedHref = normalizeQuoraProfileUrl(metadata.profileHref || '')
        const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        if(expectedHref && itemHref && expectedHref !== itemHref) return false

        const expectedCoordinatorKey = `${metadata.coordinatorKey || ''}`.trim()
        if(expectedCoordinatorKey &&
            itemKey &&
            itemKey !== expectedCoordinatorKey &&
            getCoordinatorItemQueueKey(item, itemKey) !== expectedCoordinatorKey) {
            return false
        }

        const expectedAttemptId = getAttemptIdFromValue(metadata)
        const expectedAttemptNumber = getAttemptNumberFromValue(metadata)
        if(expectedAttemptId && getAttemptIdFromValue(item) !== expectedAttemptId) return false
        if(expectedAttemptNumber && getAttemptNumberFromValue(item) !== expectedAttemptNumber) return false

        const activeTabId = normalizeTabId(item.tabId || item.activeTabId)
        return !!activeTabId && activeTabId === normalizeTabId(tabId)
    }

    function coordinatorQueuedItemMatchesRuntimeCandidate(item = null, itemKey = '', metadata = null, action = null) {
        if(!item || `${item.status || ''}`.trim() !== 'queued') return false
        const expectedHref = normalizeQuoraProfileUrl(
            metadata?.profileHref ||
            action?.profileHref ||
            action?.targetUrl ||
            action?.requestedUrl ||
            ''
        )
        const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        if(expectedHref && itemHref && expectedHref !== itemHref) return false

        const expectedCoordinatorKey = `${metadata?.coordinatorKey || action?.coordinatorKey || ''}`.trim()
        if(expectedCoordinatorKey &&
            itemKey &&
            itemKey !== expectedCoordinatorKey &&
            getCoordinatorItemQueueKey(item, itemKey) !== expectedCoordinatorKey) {
            return false
        }

        const expectedAttemptId = getAttemptIdFromValue(metadata) || getAttemptIdFromValue(action)
        const expectedAttemptNumber = getAttemptNumberFromValue(metadata) || getAttemptNumberFromValue(action)
        if(expectedAttemptId && getAttemptIdFromValue(item) !== expectedAttemptId) return false
        if(expectedAttemptNumber && getAttemptNumberFromValue(item) !== expectedAttemptNumber) return false

        return true
    }

    // The startup grace: a tab whose startup anchor is younger than QUEUED_TAB_UNCONFIRMED_ACTIVE_RECONCILE_MS is not
    // checked against authority yet. Written as the negated >= test so that a NaN clock keeps the answer the check gave
    // before this grace was shared.
    function isQueuedTabStartupGraceActive(metadata = null, nowMs = now()) {
        const startupAnchor = getFreshQueuedTabRuntimeStartupAnchor(metadata)
        return !!startupAnchor && !(nowMs - startupAnchor >= QUEUED_TAB_UNCONFIRMED_ACTIVE_RECONCILE_MS)
    }

    function shouldCheckQueuedTabRuntimeAuthority(metadata = null, nowMs = now()) {
        if(metadata?.closeRequestedAt || metadata?.closeReason) return false
        return !isQueuedTabStartupGraceActive(metadata, nowMs)
    }

    // The pending-action test the stale sweep applies before it closes an active tab (sweepStaleQueuedTabs in sw.js). A
    // pending action holds the tab only when it belongs to the same attempt as the tab's metadata.
    function hasPendingActionForQueuedTabAttempt(tabId = null, metadata = null) {
        const pendingAction = queueRuntime.getPendingTabAction(tabId)
        if(!pendingAction) return false
        return (!getAttemptIdFromValue(metadata) || getAttemptIdFromValue(pendingAction) === getAttemptIdFromValue(metadata)) &&
            (!getAttemptNumberFromValue(metadata) || getAttemptNumberFromValue(pendingAction) === getAttemptNumberFromValue(metadata))
    }

    // When a stale queue-opened tab may close: not inside the startup grace, and not while an action is pending for it.
    // The caller decides that the tab is stale (the attempt-mismatch test) before asking. The sweep's stale-timeout path
    // applies the pending half, and so does the sweep's attempt-mismatch release (releaseQueuedTabRuntimeIfAuthorityNotActive,
    // when called with deferForPendingAction). The unconfirmed-transition release (releaseUnconfirmedQueuedTabIfAuthorityNotActive)
    // and the other callers of the authority release apply only the grace half.
    function shouldDeferStaleQueuedTabClose(tabId = null, metadata = null, nowMs = now()) {
        return isQueuedTabStartupGraceActive(metadata, nowMs) || hasPendingActionForQueuedTabAttempt(tabId, metadata)
    }

    return {
        recordResidentAuthorityStaleQueuedActions,
        getQueuedTabActionKey,
        shouldDropQueuedActionForCurrentAuthority,
        getQueuedTabActionKind,
        hasQueuedUnblockUnmuteWork,
        hasQueuedForegroundWork,
        getEffectiveQueuedTabConcurrency,
        getEffectiveQueuedTabOpenConcurrency,
        shouldDropQueuedActionForTerminalProgress,
        queuedTabActionMatchesProfile,
        queuedTabMetadataMatchesProfile,
        getQueuedTabUnconfirmedActiveTransitionAt,
        coordinatorItemMatchesQueuedTabRuntime,
        coordinatorQueuedItemMatchesRuntimeCandidate,
        shouldCheckQueuedTabRuntimeAuthority,
        hasPendingActionForQueuedTabAttempt,
        shouldDeferStaleQueuedTabClose
    }
}

module.exports = {
    createQueuedTabActionAuthorityMatching
}
