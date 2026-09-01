// Coordinator reconcile-operation locked materialization extracted from
// sw.js (decomposition Slice 19). This is the "Locked" cluster: pure
// state-transition helpers that run as synchronous steps inside the async
// reconcile-tick's per-item loop
// (applyCoordinatorReconcileQueueAuthorityTransitionPhase, still in sw.js)
// and inside the queue-authority persist path
// (persistCoordinatorReconcileQueueAuthorityMutation, also still in sw.js --
// both `async` and out of scope for this sync-only decomposition per the
// plan's "Boundary after Slice 17" section). The cluster: the tab-ids-to-
// close/attempt-match predicates the three `*ReconcileActionLocked` appliers
// share, the three appliers themselves (invalid-profile-resolution, stale-
// profile-resolution-tab, progress-record), the queue-authority diff builder
// consumed by the async persist path, the terminal-key-only event predicate/
// materializer, the two resolver-pending-source-record settlers, the
// queued-item derived-state materializer, the two affected-run-id
// bookkeeping helpers, and the derived-projection-phase orchestrator that
// ties several of the above together with swCoordinatorSourceProvenance.js's
// (Slice 18) materializeRemovedProfileDerivedStateFromAuthority.
//
// Realm-crossing scrutiny (per architecture.md's Slice-7 refinement and the
// plan's Caution paragraph for this slice, which flagged it the highest-risk
// slice claimed so far): every one of the 14 bodies was grepped for
// `.then(`, `.catch(`, `Promise.`, `async`, `setTimeout`, and `void` -- none
// present in any of them. All 14 are plain synchronous functions; none
// builds or returns a Promise chain. The `Locked` suffix reflects that their
// CALLERS run inside a storage-update-locked critical section, not that the
// functions themselves are async -- their own bodies do plain synchronous
// object/array/Set work only. Two of their callers
// (persistCoordinatorReconcileQueueAuthorityMutation,
// applyCoordinatorReconcileQueueAuthorityTransitionPhase, both still in
// sw.js) are `async` and call into this cluster with plain (non-`.then()`-
// chained) synchronous calls interleaved between `await`s in the same
// function body -- the same shape as Slice 17's
// transitionCoordinatorItemFromProgress (called synchronously from this
// cluster's own applyProgressRecordCoordinatorReconcileActionLocked, itself
// called synchronously from deep inside this same reconcile-tick loop) and
// Slice 18's materializeRemovedProfileDerivedStateFromAuthority (called
// synchronously from this cluster's own
// materializeCoordinatorReconcileDerivedProjectionPhase). Both of those
// precedents already landed clean with exactly this "sync extracted function
// called from deep inside an async reconcile-tick critical section" shape.
// A plain synchronous function call -- unlike an awaited Promise -- costs no
// microtask tick regardless of which realm defines the callee (the
// realm-crossing tick cost documented in architecture.md is specifically an
// artifact of Promise-reaction scheduling, not of a same-turn synchronous
// call), so moving this cluster does not reintroduce the WAL-extraction
// hazard. Confirmed green against the full test:parallel suite after the
// move.
//
// Clock note: applyInvalidProfileResolutionReconcileActionLocked,
// applyStaleProfileResolutionTabReconcileActionLocked, and
// applyProgressRecordCoordinatorReconcileActionLocked read Date.now()
// directly as an `operation.now` fallback, and
// materializeTerminalKeyOnlyDerivedStateLocked /
// materializeQueuedCoordinatorDerivedStateLocked read it via a `now =
// Date.now()` default parameter. Per the plan's clock/environment-global
// note, `now` is threaded through this module's deps as `() => Date.now()`;
// each of those five sites reads `now()` instead, and the two default
// parameters were renamed `nowMs = now()` (matching the
// swCoordinatorContentQueueIndex.js/Slice 14 precedent) to avoid shadowing
// the closure-level `now` function with a same-named parameter.
//
// State-ownership note: materializeQueuedCoordinatorDerivedStateLocked is
// the only one of the 14 that touches the module-level `profileNukeProgress`
// mutable binding (a `let` in sw.js, read/written at 70+ sites well outside
// this cluster). Threaded through as a get/set accessor pair
// (getProfileNukeProgress/setProfileNukeProgress), matching the
// quoraRuntimeActivated precedent from Slice 7.
//
// makeCoordinatorAuthorityApplyResult, getCoordinatorItemHref,
// buildTerminalCoordinatorQueueItem, clearResolverPendingSpaceRecords,
// addResolvedProfileToPendingSpaceRecords, and normalizeProgressPatch are
// all still plain hoisted function declarations in sw.js --
// makeCoordinatorAuthorityApplyResult is part of the excluded
// createCoordinatorAuthority-adjacent region per the plan's "Boundary after
// Slice 17" section (matching the cloneCoordinatorAuthorityValue-as-
// threaded-dep precedent from Slice 14), and the rest are simply out of
// range for this slice -- all are threaded through as handler deps rather
// than moved. Hoisted declarations work from any point in this scope
// either way, so this carries no TDZ risk.
//
// getCoordinatorItemSettlementKey (referenced at line 108 of this module's
// deps.handlers object) moved in decomposition Slice 20, into
// swCoordinatorTerminalSettlement.js, which now constructs earlier in sw.js
// than this module does. sw.js destructures that module's exports back
// onto their original bare names, so this module's own construction-call
// site did not need to change: the bare `getCoordinatorItemSettlementKey`
// reference below now resolves to Slice 20's export instead of the old
// hoisted declaration.
//
// JOB_EVENT_TAB_REMOVED and JOB_EVENT_TERMINAL come from the top-of-file
// `require('./jobState')` and are threaded through as constants.
//
// No already-extracted module eagerly references any of these 14 names at
// its own construction-call site (checked via grep across shared/js/*.js),
// and nothing between the cluster's old source-text position and its
// callers references them either, so this module constructs in place at the
// cluster's old position, matching the majority precedent (Slices 14/16/17).

function createCoordinatorReconcileLockedMaterialization(deps = {}) {
    const {now} = deps
    const {
        JOB_EVENT_TAB_REMOVED,
        JOB_EVENT_TERMINAL
    } = deps.constants || {}
    const {
        normalizeTabId,
        getPersistedQueuedTabId,
        normalizeAttemptId,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getInvalidProfileResolutionFailure,
        isTerminalCoordinatorStatus,
        getCoordinatorCurrentWorkAnchor,
        buildTerminalCoordinatorQueueItem,
        getCoordinatorItemSettlementKey,
        clearResolverPendingSpaceRecords,
        getProfileResolutionRequestedUrl,
        hasMismatchedCoordinatorAttempt,
        transitionCoordinatorItemFromProgress,
        makeCoordinatorAuthorityApplyResult,
        getCoordinatorItemQueueKey,
        normalizeCoordinatorEvents,
        getCoordinatorItemHref,
        makeId,
        isProfileResolutionItem,
        normalizeQuoraProfileUrl,
        normalizeCoordinatorRequestedUrl,
        addResolvedProfileToPendingSpaceRecords,
        inferSourceTypeFromRunId,
        getCoordinatorRunTargetHrefs,
        getCoordinatorProgressRecordForItem,
        isCoordinatorQueueAuthoritativeItem,
        normalizeProgressPatch,
        buildQueuedCoordinatorProgressResetPatch,
        materializeRemovedProfileDerivedStateFromAuthority
    } = deps.handlers || {}
    const {
        getProfileNukeProgress,
        setProfileNukeProgress
    } = deps.state || {}

    function getCoordinatorReconcileOperationTabIdsToClose(operation = {}, item = null, record = null) {
        const tabIds = new Set()
        const persistedTabId = normalizeTabId(operation.persistedTabId || getPersistedQueuedTabId(item, record))
        if(operation.closePersistedTab === true && persistedTabId) {
            tabIds.add(persistedTabId)
        }
        for(const tabId of operation.tabIdsToClose || []) {
            const normalizedTabId = normalizeTabId(tabId)
            if(normalizedTabId) tabIds.add(normalizedTabId)
        }
        return Array.from(tabIds)
    }

    function matchesCoordinatorReconcileOperationAttempt(item = null, operation = {}) {
        const expectedAttemptId = normalizeAttemptId(operation.expectedAttemptId || '')
        const expectedAttemptNumber = Number.parseInt(operation.expectedAttemptNumber, 10) || 0
        if(expectedAttemptId && getAttemptIdFromValue(item) !== expectedAttemptId) return false
        if(expectedAttemptNumber && getAttemptNumberFromValue(item) !== expectedAttemptNumber) return false
        return true
    }

    function applyInvalidProfileResolutionReconcileActionLocked(state = {}, operation = {}) {
        if(`${operation.kind || ''}`.trim() !== 'reconcileInvalidProfileResolution') {
            return {changed: false, reason: 'wrong-kind'}
        }

        const queue = state.queue || {}
        const itemKey = `${operation.itemKey || ''}`.trim()
        if(!itemKey) return {changed: false, reason: 'missing-item-key'}

        const item = queue[itemKey] || null
        if(!item || typeof item !== 'object') return {changed: false, reason: 'row-changed'}
        if(!matchesCoordinatorReconcileOperationAttempt(item, operation)) {
            return {changed: false, reason: 'attempt-changed'}
        }

        const failure = `${operation.failure || getInvalidProfileResolutionFailure(item, itemKey) || ''}`.trim()
        const invalidTerminalResolutionNeedsReconcile = isTerminalCoordinatorStatus(item.status) &&
            item.status === 'failed' &&
            item.outcome === 'action-error'
        if(!failure || (isTerminalCoordinatorStatus(item.status) && !invalidTerminalResolutionNeedsReconcile)) {
            return {changed: false, reason: 'not-invalid-profile-resolution'}
        }

        const nowMs = Number.parseInt(operation.now, 10) || now()
        const terminalNow = isTerminalCoordinatorStatus(item.status)
            ? getCoordinatorCurrentWorkAnchor(item) || nowMs
            : nowMs
        const terminalItem = buildTerminalCoordinatorQueueItem(item, {
            status: 'skipped',
            outcome: 'unresolved-target',
            error: failure,
            reason: 'invalid-profile-resolution',
            eventType: JOB_EVENT_TERMINAL,
            now: terminalNow
        })
        const settlementKey = getCoordinatorItemSettlementKey(terminalItem)
        const nextItem = settlementKey ? {
            ...terminalItem,
            sourceSettledAt: terminalNow,
            sourceSettlementKey: settlementKey,
            sourceSettlementOutcome: 'cleared'
        } : terminalItem

        queue[itemKey] = nextItem

        let pendingPostsChanged = false
        let pendingPosts = state.pendingPosts || {}
        const pendingResult = clearResolverPendingSpaceRecords(pendingPosts, nextItem, {
            requestedUrl: operation.requestedUrl || getProfileResolutionRequestedUrl(item, itemKey),
            evidence: item.evidence || []
        })
        if(pendingResult.changed) {
            pendingPosts = pendingResult.pendingPosts
            state.pendingPosts = pendingPosts
            pendingPostsChanged = true
        }

        return {
            changed: true,
            queueChanged: true,
            pendingPostsChanged,
            pendingPosts,
            materialized: 1,
            affectedRunIds: item.runId ? [item.runId] : [],
            tabIdsToClose: getCoordinatorReconcileOperationTabIdsToClose(operation, item, operation.record || null),
            item: nextItem
        }
    }

    function applyStaleProfileResolutionTabReconcileActionLocked(state = {}, operation = {}) {
        if(`${operation.kind || ''}`.trim() !== 'reconcileStaleProfileResolutionTab') {
            return {changed: false, reason: 'wrong-kind'}
        }

        const queue = state.queue || {}
        const itemKey = `${operation.itemKey || ''}`.trim()
        if(!itemKey) return {changed: false, reason: 'missing-item-key'}

        const item = queue[itemKey] || null
        if(!item || typeof item !== 'object') return {changed: false, reason: 'row-changed'}
        if(!matchesCoordinatorReconcileOperationAttempt(item, operation)) {
            return {changed: false, reason: 'attempt-changed'}
        }

        const nowMs = Number.parseInt(operation.now, 10) || now()
        const nextItem = buildTerminalCoordinatorQueueItem(item, {
            status: 'failed',
            outcome: 'timeout',
            error: 'Queued profile-resolution tab timed out after disappearing before resolving a profile',
            reason: 'stale-profile-resolution-tab',
            eventType: JOB_EVENT_TAB_REMOVED,
            now: nowMs
        })

        queue[itemKey] = nextItem

        return {
            changed: true,
            queueChanged: true,
            materialized: 1,
            affectedRunIds: item.runId ? [item.runId] : [],
            tabIdsToClose: getCoordinatorReconcileOperationTabIdsToClose(operation, item, operation.record || null),
            item: nextItem
        }
    }

    function applyProgressRecordCoordinatorReconcileActionLocked(state = {}, operation = {}) {
        if(`${operation.kind || ''}`.trim() !== 'reconcileFromProgressRecord') {
            return {changed: false, reason: 'wrong-kind'}
        }

        const queue = state.queue || {}
        const itemKey = `${operation.itemKey || ''}`.trim()
        if(!itemKey) return {changed: false, reason: 'missing-item-key'}

        const item = queue[itemKey] || null
        if(!item || typeof item !== 'object') return {changed: false, reason: 'row-changed'}
        if(!matchesCoordinatorReconcileOperationAttempt(item, operation)) {
            return {changed: false, reason: 'attempt-changed'}
        }

        const record = operation.record || null
        if(record && hasMismatchedCoordinatorAttempt(item, record)) {
            return {changed: false, reason: 'progress-attempt-mismatch'}
        }

        const mapped = operation.mapped || {}
        if(!mapped.status) return {changed: false, reason: 'missing-mapped-status'}

        const nextItem = transitionCoordinatorItemFromProgress(item, record, mapped, {
            now: Number.parseInt(operation.now, 10) || now(),
            resetRetry: operation.resetRetry === true,
            terminalAtFallback: operation.terminalAtFallback || 'record'
        })

        if(JSON.stringify(nextItem) === JSON.stringify(item)) {
            return {changed: false, reason: 'unchanged'}
        }

        queue[itemKey] = nextItem

        return {
            changed: true,
            queueChanged: true,
            materialized: 1,
            previousItem: item,
            item: nextItem,
            mappedTerminal: isTerminalCoordinatorStatus(mapped.status),
            affectedRunIds: nextItem.runId ? [nextItem.runId] : []
        }
    }

    function buildCoordinatorReconcileQueueAuthorityDiff(originalQueue = {}, nextQueue = {}, operationKind = 'reconcile-progress') {
        const results = []
        const removedRows = []
        const keys = new Set([
            ...Object.keys(originalQueue || {}),
            ...Object.keys(nextQueue || {})
        ])

        for(const key of keys) {
            const previousRow = originalQueue?.[key] || null
            const nextRow = nextQueue?.[key] || null
            if(JSON.stringify(previousRow || null) === JSON.stringify(nextRow || null)) continue

            if(nextRow) {
                results.push(makeCoordinatorAuthorityApplyResult({
                    operationKind,
                    rowKey: key,
                    reason: 'reconcile'
                }, {
                    accepted: true,
                    changed: true,
                    durable: true,
                    reason: 'reconcile',
                    previousRow,
                    nextRow,
                    terminal: isTerminalCoordinatorStatus(nextRow.status)
                }))
            }
            else if(previousRow) {
                removedRows.push({
                    rowKey: key,
                    previousRow,
                    operationKind,
                    reason: 'reconcile'
                })
            }
        }

        return {results, removedRows}
    }

    function hasTerminalKeyOnlyCoordinatorEvent(events = [], itemKey = '', item = {}) {
        const runId = `${item?.runId || ''}`.trim()
        const status = `${item?.status || ''}`.trim()
        const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)

        return normalizeCoordinatorEvents(events).some(event => {
            if(`${event?.itemId || ''}` !== `${itemKey || ''}`) return false
            if(runId && `${event?.runId || ''}` !== runId) return false
            if(status && `${event?.type || ''}` !== status) return false
            if(coordinatorKey && `${event?.details?.coordinatorKey || ''}` && `${event.details.coordinatorKey}` !== coordinatorKey) return false
            return true
        })
    }

    function materializeTerminalKeyOnlyDerivedStateLocked(state = {}, itemKey = '', item = {}, nowMs = now()) {
        if(!item || typeof item !== 'object') return {changed: false}
        if(getCoordinatorItemHref(item) || !isTerminalCoordinatorStatus(item.status)) return {changed: false}

        const events = state.events || []
        const affectedRunIds = []
        const runId = `${item.runId || ''}`.trim()
        if(runId) affectedRunIds.push(runId)

        if(hasTerminalKeyOnlyCoordinatorEvent(events, itemKey, item)) {
            return {
                changed: false,
                affectedRunIds
            }
        }

        const eventAt = Number.parseInt(item.terminalAt || item.updatedAt, 10) || nowMs
        events.push({
            id: makeId('event'),
            runId,
            itemId: itemKey,
            type: item.status,
            message: item.error || `Terminal key-only coordinator item ${item.status}`,
            at: eventAt,
            details: {
                coordinatorKey: getCoordinatorItemQueueKey(item, itemKey),
                reason: item.actionLeaseReleaseReason || item.outcome || 'terminal-key-only-derived-materialization'
            }
        })

        return {
            changed: true,
            eventsChanged: true,
            affectedRunIds,
            materialized: 1
        }
    }

    function settleTerminalResolverPendingSourceRecordsLocked(state = {}, itemKey = '', item = {}) {
        if(!item || typeof item !== 'object') return {changed: false}
        if(!isTerminalCoordinatorStatus(item.status) || !isProfileResolutionItem(item)) return {changed: false}
        if(item.status !== 'skipped' || `${item.outcome || ''}`.trim() !== 'unresolved-target') return {changed: false}

        const pendingPosts = state.pendingPosts || {}
        const pendingResult = clearResolverPendingSpaceRecords(pendingPosts, item, {
            requestedUrl: getProfileResolutionRequestedUrl(item, itemKey),
            evidence: item.evidence || []
        })
        if(!pendingResult.changed) return {changed: false}

        state.pendingPosts = pendingResult.pendingPosts
        return {
            changed: true,
            pendingPostsChanged: true,
            pendingPosts: pendingResult.pendingPosts,
            materialized: 1
        }
    }

    function settleResolvedResolverPendingSourceRecordsLocked(state = {}, itemKey = '', item = {}) {
        if(!item || typeof item !== 'object') return {changed: false}
        const resolvedHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        if(!resolvedHref || isProfileResolutionItem(item)) return {changed: false}

        const evidenceList = Array.isArray(item.evidence) ? item.evidence : []
        if(!evidenceList.some(evidence => evidence?.postKey || evidence?.postUrl)) return {changed: false}

        const pendingPosts = state.pendingPosts || {}
        const hasMatchingPendingResolver = Object.values(pendingPosts || {}).some(record => {
            if(record?.resolverPending !== true) return false

            const recordPostKey = `${record?.postKey || ''}`.trim()
            const recordUrls = new Set([
                normalizeCoordinatorRequestedUrl(record?.resolverUrl || ''),
                normalizeCoordinatorRequestedUrl(record?.postUrl || '')
            ].filter(Boolean))
            return evidenceList.some(evidence => {
                const evidencePostKey = `${evidence?.postKey || ''}`.trim()
                const evidencePostUrl = normalizeCoordinatorRequestedUrl(evidence?.postUrl || '')
                return (evidencePostKey && evidencePostKey === recordPostKey) ||
                    (evidencePostUrl && recordUrls.has(evidencePostUrl))
            })
        })
        if(!hasMatchingPendingResolver) return {changed: false}

        const pendingResult = addResolvedProfileToPendingSpaceRecords(pendingPosts, item, resolvedHref)
        if(!pendingResult.changed) return {changed: false}

        state.pendingPosts = pendingResult.pendingPosts
        return {
            changed: true,
            pendingPostsChanged: true,
            pendingPosts: pendingResult.pendingPosts,
            materialized: 1
        }
    }

    function materializeQueuedCoordinatorDerivedStateLocked(state = {}, itemKey = '', item = {}, nowMs = now()) {
        if(!item || typeof item !== 'object') return {changed: false}
        if(`${item.status || ''}` !== 'queued') return {changed: false}

        const runId = `${item.runId || ''}`.trim()
        if(!runId) return {changed: false}

        const runs = state.runs || {}
        const events = state.events || []
        const progress = state.progress || {}
        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey) || href || itemKey
        const sourcePageUrl = `${item?.source?.pageUrl || item?.source?.sourcePageUrl || ''}`.trim()
        const run = runs[runId] || {}
        const sourceType = run.sourceType || item?.source?.type || inferSourceTypeFromRunId(runId) || 'space-feed'
        let runsChanged = false
        let progressChanged = false
        let eventsChanged = false
        let materialized = 0

        const targetProfileHrefs = new Set(getCoordinatorRunTargetHrefs(run))
        const targetWorkKeys = new Set(Array.isArray(run.targetWorkKeys) ? run.targetWorkKeys : [])
        const sourcePages = new Set(Array.isArray(run.sourcePages) ? run.sourcePages : [])
        if(href && !targetProfileHrefs.has(href)) {
            targetProfileHrefs.add(href)
            runsChanged = true
        }
        if(coordinatorKey && !targetWorkKeys.has(coordinatorKey)) {
            targetWorkKeys.add(coordinatorKey)
            runsChanged = true
        }
        if(sourcePageUrl && !sourcePages.has(sourcePageUrl)) {
            sourcePages.add(sourcePageUrl)
            runsChanged = true
        }
        if(!runs[runId]) runsChanged = true

        if(runsChanged) {
            runs[runId] = {
                ...run,
                id: runId,
                sourceType,
                createdAt: run.createdAt || item.createdAt || item.queuedAt || nowMs,
                updatedAt: Math.max(Number.parseInt(run.updatedAt, 10) || 0, Number.parseInt(item.updatedAt || item.queuedAt, 10) || nowMs),
                status: run.status || 'active',
                paused: run.paused === true ? true : false,
                sourcePages: Array.from(sourcePages),
                targetProfileHrefs: Array.from(targetProfileHrefs),
                targetWorkKeys: Array.from(targetWorkKeys)
            }
            materialized += 1
        }

        const existingProgressRecord = href ? getCoordinatorProgressRecordForItem(itemKey, item, progress) : null
        const itemAttemptId = getAttemptIdFromValue(item)
        const itemAttemptNumber = getAttemptNumberFromValue(item)
        const recordAttemptId = getAttemptIdFromValue(existingProgressRecord)
        const recordAttemptNumber = getAttemptNumberFromValue(existingProgressRecord)
        const staleProgressAttempt = existingProgressRecord && (
            hasMismatchedCoordinatorAttempt(item, existingProgressRecord) ||
            (itemAttemptId && !recordAttemptId) ||
            (itemAttemptNumber && !recordAttemptNumber)
        )

        if(href && isCoordinatorQueueAuthoritativeItem(item) && (!existingProgressRecord || staleProgressAttempt)) {
            const resetRecord = normalizeProgressPatch(
                href,
                buildQueuedCoordinatorProgressResetPatch(item, {
                    now: Number.parseInt(item.queuedAt || item.updatedAt, 10) || nowMs,
                    runId,
                    actionKind: item.actionKind || ''
                }),
                null
            )
            if(resetRecord) {
                progress[href] = resetRecord
                setProfileNukeProgress({
                    ...getProfileNukeProgress(),
                    [href]: resetRecord
                })
                progressChanged = true
                materialized += 1
            }
        }

        if((runsChanged || progressChanged) && !events.some(event =>
            `${event?.runId || ''}` === runId &&
            `${event?.type || ''}` === 'materialize' &&
            `${event?.details?.reason || ''}` === 'enqueue-derived-materialization'
        )) {
            events.push({
                id: makeId('event'),
                runId,
                itemId: coordinatorKey || itemKey,
                type: 'materialize',
                message: 'Materialized derived enqueue state',
                at: nowMs,
                details: {
                    reason: 'enqueue-derived-materialization',
                    coordinatorKey,
                    targetProfileHref: href,
                    sourcePageUrl
                }
            })
            eventsChanged = true
        }

        return {
            changed: runsChanged || progressChanged || eventsChanged,
            runsChanged,
            progressChanged,
            eventsChanged,
            affectedRunIds: runsChanged || progressChanged || eventsChanged ? [runId] : [],
            materialized
        }
    }

    function addCoordinatorReconcileAffectedRunIds(ctx = {}, runIds = []) {
        for(const runId of runIds || []) {
            if(runId) ctx.affectedRunIds.add(runId)
        }
    }

    function markCoordinatorReconcileRunAffected(ctx = {}, item = null) {
        const runId = `${item?.runId || ''}`.trim()
        if(runId) ctx.affectedRunIds.add(runId)
    }

    function materializeCoordinatorReconcileDerivedProjectionPhase(ctx = {}) {
        const clearProfileMaterialized = materializeRemovedProfileDerivedStateFromAuthority(ctx.state)
        if(clearProfileMaterialized.changed) {
            ctx.runs = clearProfileMaterialized.runs || ctx.runs
            ctx.pendingPosts = clearProfileMaterialized.pendingPosts || ctx.pendingPosts
            ctx.nukedPosts = clearProfileMaterialized.nukedPosts || ctx.nukedPosts
            ctx.state.runs = ctx.runs
            ctx.state.pendingPosts = ctx.pendingPosts
            ctx.state.nukedPosts = ctx.nukedPosts
            ctx.progressChanged = ctx.progressChanged || clearProfileMaterialized.progressChanged
            ctx.runsMetadataChanged = ctx.runsMetadataChanged || clearProfileMaterialized.runsChanged
            ctx.pendingPostsChanged = ctx.pendingPostsChanged || clearProfileMaterialized.pendingPostsChanged
            ctx.nukedPostsChanged = ctx.nukedPostsChanged || clearProfileMaterialized.nukedPostsChanged
            ctx.materialized += clearProfileMaterialized.materialized || 0
            addCoordinatorReconcileAffectedRunIds(ctx, clearProfileMaterialized.affectedRunIds)
        }
    }

    return {
        getCoordinatorReconcileOperationTabIdsToClose,
        matchesCoordinatorReconcileOperationAttempt,
        applyInvalidProfileResolutionReconcileActionLocked,
        applyStaleProfileResolutionTabReconcileActionLocked,
        applyProgressRecordCoordinatorReconcileActionLocked,
        buildCoordinatorReconcileQueueAuthorityDiff,
        hasTerminalKeyOnlyCoordinatorEvent,
        materializeTerminalKeyOnlyDerivedStateLocked,
        settleTerminalResolverPendingSourceRecordsLocked,
        settleResolvedResolverPendingSourceRecordsLocked,
        materializeQueuedCoordinatorDerivedStateLocked,
        addCoordinatorReconcileAffectedRunIds,
        markCoordinatorReconcileRunAffected,
        materializeCoordinatorReconcileDerivedProjectionPhase
    }
}

module.exports = {
    createCoordinatorReconcileLockedMaterialization
}
