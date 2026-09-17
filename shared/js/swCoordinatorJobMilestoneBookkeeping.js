// Coordinator job-milestone bookkeeping extracted from sw.js (decomposition
// Slice 40): scheduleTerminalProgressSettlement, scheduleTerminalProgressContinuation,
// clearPendingCoordinatorJobMilestone, consumePendingCoordinatorJobMilestone,
// getCoordinatorMilestoneWorkCounts, hasActiveCoordinatorMilestoneWork,
// shouldPersistExplicitCoordinatorMilestoneNow, updateQueuedTabMetadataFromMilestoneRecord,
// and scheduleCoordinatorJobMilestoneFlush.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement and the plan's caution paragraph naming three schedule-shaped
// candidates in this slice):
//
// - scheduleTerminalProgressSettlement builds a real chain --
//   `new Promise(resolve => setTimeout(...)).then(...).then(...).catch(...).finally(...)`
//   -- reaching into applyCoordinatorQueueMachineEvent, scheduleCoordinatorQueueResume,
//   runCoordinatorQueueExecutorFastPath, and recordCoordinatorDiagnosticEvent,
//   all of which stay resident in sw.js (applyCoordinatorQueueMachineEvent
//   and runCoordinatorQueueExecutorFastPath are `async`; scheduleCoordinatorQueueResume
//   is on the plan's explicit resident-only exclusion list).  Before this
//   move the whole chain executed in sw.js's own vm-sandboxed realm --  zero
//   crossings.  After the move, the chain's construction happens in this
//   module's realm and its `.then()`/`.catch()`/`.finally()` links resolve
//   sw.js-realm promises from here -- a new crossing on every terminal
//   settlement, same shape architecture.md's Slice-7 refinement warns about.
//   Its own return value is a plain boolean (`true`/`false`), never the
//   chain itself -- its one caller (recordCoordinatorJobProgressRecords,
//   line ~28892 pre-move) calls it as a bare statement, ignoring the return
//   value, so nothing downstream chains onto the settlementPromise either.
//   This is the same shape as scheduleTerminalOwnedProfileTabCleanup, which
//   Slice 20 moved into swCoordinatorTerminalSettlement.js despite an
//   identical `.catch()`-onto-closeTerminalOwnedProfileTabs() new-crossing
//   concern, verified green against the full test:parallel suite, with a
//   note to revisit if a future regression is ever bisected to it. Moved
//   here on the same "try it, verify with the full suite" basis, and
//   confirmed green.
// - scheduleTerminalProgressContinuation is not `async` but its body
//   contains `void closeTerminalOwnedProfileTabs().catch(() => null)` and
//   `void runCoordinatorQueueExecutorFastPath(reason, {...}).catch(error => {...})`
//   -- both `.catch()`-chained, both reaching into resident sw.js `async`
//   functions, both `void`-discarded by this function itself so nothing
//   downstream chains on top. Same shape as scheduleTerminalOwnedProfileTabCleanup
//   (Slice 20) and scheduleTerminalProgressSettlement above -- moved and
//   verified green for the same reason.
// - scheduleCoordinatorJobMilestoneFlush's setTimeout callback does
//   `void flushCoordinatorJobMilestones()` -- a plain fire-and-forget call
//   with no `.then()`/`.catch()` of its own, the safest of the three
//   (matching the swQueuedTabActionBookkeeping.js/Slice 38 precedent for
//   scheduleQueuedTabReleaseFollowUp: "a void-discarded call attaches no
//   continuation and therefore builds no cross-realm Promise chain").
//
// All six other functions here (clearPendingCoordinatorJobMilestone,
// consumePendingCoordinatorJobMilestone, getCoordinatorMilestoneWorkCounts,
// hasActiveCoordinatorMilestoneWork, shouldPersistExplicitCoordinatorMilestoneNow,
// updateQueuedTabMetadataFromMilestoneRecord) are plain synchronous
// data-in/data-out functions with no Promise/`.then()`/`await` anywhere in
// their bodies -- grepped individually to confirm -- so they carry no realm
// penalty either way per architecture.md's baseline rule.
//
// Clock note: shouldPersistExplicitCoordinatorMilestoneNow and
// updateQueuedTabMetadataFromMilestoneRecord both read Date.now() directly
// (an attempt-transition timestamp and a lastProgressAt fallback,
// respectively) -- threaded through as `now: () => Date.now()`, both call
// sites now read `now()`. scheduleTerminalProgressSettlement and
// scheduleCoordinatorJobMilestoneFlush both use a raw setTimeout -- threaded
// through as `setTimeoutFn`, matching the existing convention (a bare
// `setTimeout` reference inside an extracted module resolves to the real
// Node timer, not the test harness's injected fake one).
//
// State ownership: terminalProgressSettlementPromises (a Map keyed by
// profileHref) was a bare sw.js const read/written only by
// scheduleTerminalProgressSettlement -- nothing else in sw.js touched it --
// so per the Slice-5/21/38 precedent it now lives as private closure state
// inside this module; sw.js's old top-level
// `const terminalProgressSettlementPromises = new Map()` was deleted.
//
// coordinatorJobMilestoneFlushTimeout, coordinatorJobMilestoneFlushPromise,
// and coordinatorJobMilestonePendingRecords all stay as `let` bindings in
// sw.js, because flushCoordinatorJobMilestones (async, resident, out of
// scope) and recordDeferredCoordinatorJobMilestone (async, resident, out of
// scope) also read and/or reassign them -- splitting this state across the
// module boundary would desync the two sides. Threaded through as
// deps.state accessors, matching the swPersistentRetryExecutorTimers.js
// (Slice 22) precedent for coordinatorExecutorStartPromise:
// getCoordinatorJobMilestoneFlushTimeout/setCoordinatorJobMilestoneFlushTimeout
// (scheduleCoordinatorJobMilestoneFlush both reads and sets this one),
// getCoordinatorJobMilestoneFlushPromise (scheduleCoordinatorJobMilestoneFlush
// only reads this one -- flushCoordinatorJobMilestones owns the writes),
// and getCoordinatorJobMilestonePendingRecords (clearPendingCoordinatorJobMilestone/
// consumePendingCoordinatorJobMilestone only `delete` a key off the object a
// getter returns -- they never reassign the whole object, so a getter alone
// is enough; flushCoordinatorJobMilestones's own
// `coordinatorJobMilestonePendingRecords = {}` reassignment in sw.js is
// still visible through the getter closure on the next call).
//
// queueRuntime.getRuntimeCounts() is threaded through as a wrapped
// `getQueueRuntimeCounts: () => queueRuntime.getRuntimeCounts()` accessor,
// matching the existing wrapping already used elsewhere in sw.js (e.g. line
// ~2050's own `getQueueRuntimeCounts: () => queueRuntime.getRuntimeCounts()`)
// rather than threading the whole queueRuntime object.
//
// getNormalizedProfileHrefList, incrementQueueWakeupMetric,
// recordCoordinatorDiagnosticEvent, normalizeQuoraProfileUrl,
// getHydratedCoordinatorAuthorityState, getCoordinatorQueueWorkCounts,
// progressPatchHasExplicitStatus, getCoordinatorStatusFromProgress,
// isTerminalCoordinatorStatus, isCoordinatorQueueAuthoritativeItem,
// hasMismatchedCoordinatorAttempt, shouldApplyExplicitProgressStatusToCoordinatorItem,
// transitionCoordinatorItemFromProgress, shouldPersistCoordinatorRowEventQueueItemChange,
// normalizeTabId, and setQueuedTabMetadata are all already bare consts (from
// earlier-constructed modules) or top-of-file requires well before this
// module's construction point (its old source-text position, unchanged --
// no already-extracted module eagerly references any of this slice's nine
// names at its own construction call site in sw.js, so no early-construction
// ordering constraint applies here, unlike swCoordinatorTerminalSettlement.js).
// applyCoordinatorQueueMachineEvent, scheduleCoordinatorQueueResume,
// runCoordinatorQueueExecutorFastPath, scheduleQueuedWorkContinuation,
// closeTerminalOwnedProfileTabs, getHydratedCoordinatorAuthorityState, and
// flushCoordinatorJobMilestones are all still plain hoisted function
// declarations in sw.js, visible from any point in scope regardless of
// textual position, so they're threaded through directly with no ordering
// risk either way.

function createCoordinatorJobMilestoneBookkeeping(deps = {}) {
    const {
        now = () => Date.now(),
        setTimeoutFn = setTimeout
    } = deps
    const {
        TERMINAL_PROGRESS_SETTLEMENT_DEFER_MS,
        COORDINATOR_JOB_MILESTONE_FLUSH_MS
    } = deps.constants || {}
    const {
        getNormalizedProfileHrefList,
        incrementQueueWakeupMetric,
        applyCoordinatorQueueMachineEvent,
        scheduleCoordinatorQueueResume,
        runCoordinatorQueueExecutorFastPath,
        recordCoordinatorDiagnosticEvent,
        scheduleQueuedWorkContinuation,
        closeTerminalOwnedProfileTabs,
        normalizeQuoraProfileUrl,
        getHydratedCoordinatorAuthorityState,
        getCoordinatorQueueWorkCounts,
        progressPatchHasExplicitStatus,
        getCoordinatorStatusFromProgress,
        isTerminalCoordinatorStatus,
        isCoordinatorQueueAuthoritativeItem,
        hasMismatchedCoordinatorAttempt,
        shouldApplyExplicitProgressStatusToCoordinatorItem,
        transitionCoordinatorItemFromProgress,
        shouldPersistCoordinatorRowEventQueueItemChange,
        normalizeTabId,
        setQueuedTabMetadata,
        flushCoordinatorJobMilestones
    } = deps.handlers || {}
    const {
        getQueueRuntimeCounts,
        getCoordinatorJobMilestoneFlushTimeout,
        setCoordinatorJobMilestoneFlushTimeout,
        getCoordinatorJobMilestoneFlushPromise,
        getCoordinatorJobMilestonePendingRecords
    } = deps.state || {}

    const terminalProgressSettlementPromises = new Map()
    let terminalProgressContinuationFastExecutorPromise = null
    let terminalProgressContinuationPendingReason = null

    function scheduleTerminalProgressSettlement(profileHrefs = []) {
        const hrefs = getNormalizedProfileHrefList(profileHrefs || [])
        if(!hrefs.length) return false

        const pendingHrefs = hrefs.filter(href => !terminalProgressSettlementPromises.has(href))
        if(!pendingHrefs.length) {
            incrementQueueWakeupMetric('terminalProgress.settlementCoalescedInFlight')
            return true
        }

        incrementQueueWakeupMetric('terminalProgress.settlementDeferred')
        const settlementPromise = new Promise(resolve => {
            setTimeoutFn(resolve, TERMINAL_PROGRESS_SETTLEMENT_DEFER_MS)
        }).then(() => applyCoordinatorQueueMachineEvent({
            type: 'TERMINAL_COORDINATOR_ITEMS_SETTLE',
            options: {
                profileHrefs: pendingHrefs,
                deferAuthorityProjectionSave: true
            }
        })).then(result => {
            if(result !== false) {
                incrementQueueWakeupMetric('terminalProgress.settlementCompleted')
                scheduleCoordinatorQueueResume(1000, 'terminal-progress-settlement-continuation', {
                    allowBeforeQuora: true
                })
                void runCoordinatorQueueExecutorFastPath('terminal-progress-settlement-continuation', {
                    awaitFill: true,
                    returnAfterDurableActive: true,
                    allowBeforeQuora: true,
                    forceDurableQueueReload: true
                }).catch(error => {
                    recordCoordinatorDiagnosticEvent(
                        'terminal-progress-settlement-continuation-failed',
                        error?.message || 'Terminal progress settlement continuation failed'
                    )
                })
                return
            }
            incrementQueueWakeupMetric('terminalProgress.settlementFailed')
        }).catch(error => {
            incrementQueueWakeupMetric('terminalProgress.settlementFailed')
            recordCoordinatorDiagnosticEvent(
                'terminal-progress-settlement-failed',
                error?.message || 'Terminal progress settlement follow-up failed'
            )
        }).finally(() => {
            for(const href of pendingHrefs) {
                if(terminalProgressSettlementPromises.get(href) === settlementPromise) {
                    terminalProgressSettlementPromises.delete(href)
                }
            }
        })
        for(const href of pendingHrefs) {
            terminalProgressSettlementPromises.set(href, settlementPromise)
        }
        void settlementPromise

        return true
    }

    function scheduleTerminalProgressContinuation(reason = 'terminal-progress-continuation') {
        scheduleQueuedWorkContinuation(reason, {
            forceDurableQueueReload: false
        })
        scheduleCoordinatorQueueResume(1000, reason, {
            allowBeforeQuora: true
        })
        void closeTerminalOwnedProfileTabs().catch(() => null)

        if(terminalProgressContinuationFastExecutorPromise) {
            terminalProgressContinuationPendingReason = reason
            incrementQueueWakeupMetric('terminalProgress.continuationFastExecutorCoalescedInFlight')
            return
        }

        terminalProgressContinuationFastExecutorPromise = runCoordinatorQueueExecutorFastPath(reason, {
            awaitFill: true,
            returnAfterDurableActive: true,
            allowBeforeQuora: true,
            skipAuthorityReconcile: true,
            forceDurableQueueReload: false
        })
            .catch(error => {
                recordCoordinatorDiagnosticEvent(
                    'terminal-progress-continuation-fast-executor-failed',
                    error?.message || 'Terminal progress continuation fast executor failed'
                )
            })
            .finally(() => {
                terminalProgressContinuationFastExecutorPromise = null
                if(terminalProgressContinuationPendingReason) {
                    const nextReason = terminalProgressContinuationPendingReason
                    terminalProgressContinuationPendingReason = null
                    scheduleTerminalProgressContinuation(nextReason)
                }
            })
    }

    function clearPendingCoordinatorJobMilestone(profileHref = '') {
        const normalizedHref = normalizeQuoraProfileUrl(profileHref)
        if(!normalizedHref) return false

        const pendingRecords = getCoordinatorJobMilestonePendingRecords()
        const hadPending = !!pendingRecords[normalizedHref]
        delete pendingRecords[normalizedHref]
        return hadPending
    }

    function consumePendingCoordinatorJobMilestone(profileHref = '') {
        const normalizedHref = normalizeQuoraProfileUrl(profileHref)
        if(!normalizedHref) return null

        const pendingRecords = getCoordinatorJobMilestonePendingRecords()
        const pending = pendingRecords[normalizedHref] || null
        delete pendingRecords[normalizedHref]
        return pending
    }

    function getCoordinatorMilestoneWorkCounts() {
        const authorityState = getHydratedCoordinatorAuthorityState('milestone.flush.usedResidentAuthority')
        const durableCounts = getCoordinatorQueueWorkCounts(authorityState?.queue || {})
        const runtimeCounts = getQueueRuntimeCounts()
        return {
            activeQueuedTabs: runtimeCounts.activeQueuedTabs,
            queuedTabActions: runtimeCounts.queuedTabActions,
            pendingTabActions: runtimeCounts.pendingTabActions,
            durableActiveRows: durableCounts.active || 0,
            durableQueuedRows: durableCounts.queued || 0
        }
    }

    function hasActiveCoordinatorMilestoneWork() {
        const counts = getCoordinatorMilestoneWorkCounts()
        return counts.activeQueuedTabs > 0 ||
            counts.queuedTabActions > 0 ||
            counts.pendingTabActions > 0
    }

    function shouldPersistExplicitCoordinatorMilestoneNow(profileHref = '', record = {}, patch = {}, options = {}) {
        const normalizedHref = normalizeQuoraProfileUrl(profileHref)
        if(!normalizedHref || !progressPatchHasExplicitStatus(patch)) return false

        const mapped = getCoordinatorStatusFromProgress(record)
        if(isTerminalCoordinatorStatus(mapped.status)) return true

        const authorityState = getHydratedCoordinatorAuthorityState('milestone.explicit.usedResidentAuthority')
        const queue = authorityState?.queue || null
        if(!queue) return true

        const item = queue[normalizedHref] || queue[options.coordinatorKey || normalizedHref] || null
        if(!item) return true
        if(!isCoordinatorQueueAuthoritativeItem(item)) return false
        if(hasMismatchedCoordinatorAttempt(item, record)) return true
        if(!shouldApplyExplicitProgressStatusToCoordinatorItem(item, patch, {
            ...options,
            senderTabId: options.senderTabId || record.senderTabId || null
        })) {
            return true
        }

        const nextItem = transitionCoordinatorItemFromProgress(item, record, mapped, {
            now: now()
        })
        return shouldPersistCoordinatorRowEventQueueItemChange(item, nextItem, mapped)
    }

    function updateQueuedTabMetadataFromMilestoneRecord(tabId = null, record = {}) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false

        const metadataPatch = {
            lastProgressAt: Number.isFinite(record.updatedAt) ? record.updatedAt : now(),
            contentOpenedAt: Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : undefined,
            actionReadyAt: Number.isFinite(record.actionReadyAt) ? record.actionReadyAt : undefined,
            waitingForForegroundAt: Number.isFinite(record.waitingForForegroundAt) ? record.waitingForForegroundAt : undefined,
            foregroundLeaseAcquiredAt: Number.isFinite(record.foregroundLeaseAcquiredAt) ? record.foregroundLeaseAcquiredAt : undefined,
            foregroundPromotedAt: Number.isFinite(record.foregroundPromotedAt) ? record.foregroundPromotedAt : undefined
        }
        if(record.lastUrl) metadataPatch.lastUrl = record.lastUrl
        for(const key of Object.keys(metadataPatch)) {
            if(metadataPatch[key] === undefined) delete metadataPatch[key]
        }
        setQueuedTabMetadata(normalizedTabId, metadataPatch)
        return true
    }

    function scheduleCoordinatorJobMilestoneFlush() {
        if(getCoordinatorJobMilestoneFlushTimeout() || getCoordinatorJobMilestoneFlushPromise()) return

        incrementQueueWakeupMetric('milestone.flushRequested')
        incrementQueueWakeupMetric('milestone.flushDeferred')
        setCoordinatorJobMilestoneFlushTimeout(setTimeoutFn(() => {
            setCoordinatorJobMilestoneFlushTimeout(null)
            void flushCoordinatorJobMilestones()
        }, COORDINATOR_JOB_MILESTONE_FLUSH_MS))
    }

    return {
        scheduleTerminalProgressSettlement,
        scheduleTerminalProgressContinuation,
        clearPendingCoordinatorJobMilestone,
        consumePendingCoordinatorJobMilestone,
        getCoordinatorMilestoneWorkCounts,
        hasActiveCoordinatorMilestoneWork,
        shouldPersistExplicitCoordinatorMilestoneNow,
        updateQueuedTabMetadataFromMilestoneRecord,
        scheduleCoordinatorJobMilestoneFlush
    }
}

module.exports = {
    createCoordinatorJobMilestoneBookkeeping
}
