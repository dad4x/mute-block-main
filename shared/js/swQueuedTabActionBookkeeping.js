// Queued-tab action bookkeeping + canceled-owner-url tracking extracted
// from sw.js (decomposition Slice 38): collectQueuedTabActionKeys,
// rememberCanceledOwnerUrls, cancelQueuedOwnerActions,
// consumeCanceledOwnerUrls, scheduleQueuedTabReleaseFollowUp,
// getQueuedTabExpectedAttemptId, makeClaimableQueuedTabAction.
//
// scheduleQueuedWorkContinuation (65 external refs), textually interleaved
// in this cluster's old source-text position, is deliberately excluded --
// same profile as scheduleCoordinatorReconcile/scheduleCoordinatorQueueResume
// (already excluded elsewhere): a resident scheduling-core function, left in
// sw.js entirely per the plan's explicit caution for this slice.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): all 7 bodies were grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. Only scheduleQueuedTabReleaseFollowUp
// matched (a `setTimeout` call), which earns it the same schedule-shaped-name
// scrutiny that led Slice 37 to leave scheduleQueuedTabReleaseReconcile
// resident. The two are not the same shape, though:
// scheduleQueuedTabReleaseReconcile stayed behind because its *returned*
// Promise is directly `.then()`-chained by its resident async caller
// (releaseQueuedTab), which would have reached across the vm/Node realm
// boundary onto a foreign-realm Promise. scheduleQueuedTabReleaseFollowUp
// returns nothing (no Promise built or returned at all) and none of its four
// call sites in sw.js chain or use its (undefined) return value -- each is a
// bare statement call. Its body itself calls scheduleQueuedWorkContinuation
// and (inside the setTimeout callback) scheduleCoordinatorQueueResume, both
// plain synchronous fire-and-forget calls into functions that stay resident
// in sw.js -- not a Promise chain reaching into another module. So it moved
// with only the standard setTimeout clock threading below, no special
// handling.
//
// Clock note: none of the 7 moved bodies call Date.now() (or read any other
// environment global the test harness fakes), so no `now` dependency is
// threaded through. scheduleQueuedTabReleaseFollowUp's setTimeout call is
// threaded through as `setTimeoutFn`, matching the existing
// swBrowserSessionRuntime.js/swPersistentRetryExecutorTimers.js convention.
//
// State ownership: queuedTabReleaseFollowUpTimeout was a bare sw.js `let`
// read/written only by scheduleQueuedTabReleaseFollowUp (nothing else in
// sw.js touched it), so per the Slice-5/21/22 precedent ("hide volatile
// state behind methods, don't re-expose raw bindings") it now lives as
// private closure state inside this module instead -- sw.js's old top-level
// `let queuedTabReleaseFollowUpTimeout = null` was deleted.
//
// Construction-order note: this module is constructed well before this
// cluster's old source-text location, right after ownedTabLifecycle's
// destructure (decomposition Slice 33, part 1) and before
// queuedForegroundLeaseRuntime's construction (decomposition Slice 32, part
// 1) -- queuedForegroundLeaseRuntime eagerly references bare
// `makeClaimableQueuedTabAction` in its own construction-call `handlers`
// object literal, and queuedTabReclaimResume (decomposition Slice 27,
// constructed further down still) eagerly references bare
// `rememberCanceledOwnerUrls` the same way. A `const` destructured from a
// factory call is in the temporal dead zone until that line executes, so
// this module must construct before the earlier of those two references,
// i.e. before queuedForegroundLeaseRuntime. Every dependency this module
// needs is already available by that point: queueRuntime (top-of-file),
// getQueuedTabMetadata (queuedTabMetadataAndActionLease, decomposition Slice
// 31), getQueuedTabActionKey (queuedTabActionAuthorityMatching,
// decomposition Slice 37), normalizeQuoraProfileUrl (top-of-file ./subject
// require), normalizeAttemptId/getAttemptIdFromValue/
// getAttemptNumberFromValue (coordinatorAttemptIdentity), all already bare
// consts by this point -- and scheduleQueuedWorkContinuation/
// scheduleCoordinatorQueueResume, both still plain hoisted `function`
// declarations far below in sw.js. Hoisted declarations are visible
// throughout their enclosing scope regardless of textual position, so no
// thunk is needed for either.

function createQueuedTabActionBookkeeping(deps = {}) {
    const {
        setTimeoutFn = setTimeout
    } = deps
    const {
        queueRuntime,
        getQueuedTabMetadata,
        getQueuedTabActionKey,
        normalizeQuoraProfileUrl,
        normalizeAttemptId,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        scheduleQueuedWorkContinuation,
        scheduleCoordinatorQueueResume
    } = deps.handlers || {}

    let queuedTabReleaseFollowUpTimeout = null

    function collectQueuedTabActionKeys(ownerTabId = null) {
        const keys = new Set()

        for(const tabId of queueRuntime.listActiveQueuedTabIds()) {
            const metadata = getQueuedTabMetadata(tabId)
            const ownerId = metadata?.ownerTabId || queueRuntime.getOwningParentForChild(tabId) || null
            if(ownerTabId && ownerId !== ownerTabId) continue
            const key = getQueuedTabActionKey(ownerId, metadata?.profileHref || metadata?.coordinatorKey || '', metadata?.tabAction || '')
            if(key) keys.add(key)
        }

        for(const action of queueRuntime.listActivationIntents()) {
            const ownerId = action?.ownerTabId || null
            if(ownerTabId && ownerId !== ownerTabId) continue
            const key = getQueuedTabActionKey(ownerId, action?.profileHref || action?.coordinatorKey || action?.url || '', action?.tabAction || '')
            if(key) keys.add(key)
        }

        return keys
    }

    function rememberCanceledOwnerUrls(ownerTabId, urls) {
        if(!ownerTabId || !Array.isArray(urls) || !urls.length) return

        queueRuntime.rememberCanceledQueuedOwnerUrls(ownerTabId, urls)
    }

    function cancelQueuedOwnerActions(ownerTabId, tabAction = null) {
        if(!ownerTabId) return []

        const canceledUrls = []

        for(let index = queueRuntime.getActivationIntentCount() - 1; index >= 0; index -= 1) {
            const action = queueRuntime.getActivationIntentAt(index)
            if(action.ownerTabId !== ownerTabId) continue
            if(tabAction && action.tabAction !== tabAction) continue

            if(action.url) {
                canceledUrls.push(action.url)
            }
            queueRuntime.dropRuntimeActionAt(index)
        }

        return canceledUrls
    }

    function consumeCanceledOwnerUrls(ownerTabId) {
        return queueRuntime.consumeCanceledQueuedOwnerUrls(ownerTabId)
    }

    function scheduleQueuedTabReleaseFollowUp(delayMs = 500) {
        scheduleQueuedWorkContinuation('queued-tab-release')

        if(queuedTabReleaseFollowUpTimeout) return

        queuedTabReleaseFollowUpTimeout = setTimeoutFn(() => {
            queuedTabReleaseFollowUpTimeout = null
            scheduleCoordinatorQueueResume(1000, 'queued-tab-release-follow-up', {
                allowBeforeQuora: true
            })
        }, Math.max(100, Number.parseInt(delayMs, 10) || 500))
    }

    function getQueuedTabExpectedAttemptId(tabId = null) {
        if(!tabId) return ''
        const metadata = getQueuedTabMetadata(tabId)
        const action = queueRuntime.getPendingTabAction(tabId)
        return normalizeAttemptId(metadata?.attemptId || action?.attemptId || '')
    }

    function makeClaimableQueuedTabAction(action = null, metadata = null) {
        if(!action && !metadata) return null

        const sourceAction = action || {}
        const tabAction = sourceAction.action || metadata?.tabAction || null
        const actionKind = sourceAction.actionKind || metadata?.actionKind || (
            tabAction === 'nuke' ? 'mute-block' : tabAction || null
        )

        return {
            ...sourceAction,
            action: tabAction,
            profileHref: normalizeQuoraProfileUrl(sourceAction.profileHref || sourceAction.targetUrl || metadata?.profileHref || metadata?.requestedUrl || ''),
            targetUrl: sourceAction.targetUrl || sourceAction.profileHref || metadata?.profileHref || '',
            coordinatorKey: sourceAction.coordinatorKey || metadata?.coordinatorKey || '',
            requestedUrl: sourceAction.requestedUrl || metadata?.requestedUrl || '',
            resolutionMode: sourceAction.resolutionMode || metadata?.resolutionMode || '',
            resolveProfileFromPage: sourceAction.resolveProfileFromPage === true || metadata?.resolveProfileFromPage === true,
            resolutionReason: sourceAction.resolutionReason || metadata?.resolutionReason || '',
            candidateConfidence: sourceAction.candidateConfidence || metadata?.candidateConfidence || '',
            candidateCollector: sourceAction.candidateCollector || metadata?.candidateCollector || '',
            actionKind,
            jobKey: sourceAction.jobKey || metadata?.jobKey || '',
            scope: sourceAction.scope || metadata?.scope || null,
            canonicalSubject: sourceAction.canonicalSubject || metadata?.canonicalSubject || null,
            attempt: sourceAction.attempt || metadata?.attempt || null,
            runId: sourceAction.runId || metadata?.runId || '',
            noForegroundFallback: !!(sourceAction.noForegroundFallback || metadata?.noForegroundFallback),
            actionSurfaceMode: sourceAction.actionSurfaceMode || metadata?.actionSurfaceMode || '',
            actionSurfaceWindowId: sourceAction.actionSurfaceWindowId || metadata?.actionSurfaceWindowId || null,
            actionSurfaceAnchorTabId: sourceAction.actionSurfaceAnchorTabId || metadata?.actionSurfaceAnchorTabId || null,
            actionSurfaceActivatedAt: sourceAction.actionSurfaceActivatedAt || metadata?.actionSurfaceActivatedAt || 0,
            attemptId: getAttemptIdFromValue(sourceAction) || getAttemptIdFromValue(metadata) || '',
            attemptNumber: getAttemptNumberFromValue(sourceAction) || getAttemptNumberFromValue(metadata) || 0
        }
    }

    return {
        collectQueuedTabActionKeys,
        rememberCanceledOwnerUrls,
        cancelQueuedOwnerActions,
        consumeCanceledOwnerUrls,
        scheduleQueuedTabReleaseFollowUp,
        getQueuedTabExpectedAttemptId,
        makeClaimableQueuedTabAction
    }
}

module.exports = {
    createQueuedTabActionBookkeeping
}
