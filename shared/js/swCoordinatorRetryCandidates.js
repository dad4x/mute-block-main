// Coordinator retry-candidate/failure-reset builders extracted from sw.js
// (decomposition Slice 29): makeStoredWorkRecoveryResumeOwnedResult,
// getCoordinatorFailureRetryCount, getCoordinatorFailureLastRetryAt,
// sortCoordinatorRetryCandidates, getCoordinatorRetryableFailureCandidates,
// getCoordinatorRetrySourcePages, and buildFailedCoordinatorResetItem.
//
// Construction-order note: unlike most recent slices, this module DOES need
// to be hoisted well ahead of this cluster's former source-text position.
// swRolledBackQueuedTabRetryClassification.js's own construction-call
// `handlers` object literal (sw.js, `const rolledBackQueuedTabRetryClassification
// = createRolledBackQueuedTabRetryClassification({...})`) eagerly references
// bare `getCoordinatorFailureRetryCount`. A hoisted `function` declaration is
// visible throughout its enclosing scope; a `const` destructured from a
// factory call is in the temporal dead zone until that line executes -- so
// this module must construct before that reference. It's placed immediately
// after coordinatorJobEnvelope's construction/destructure (its own latest-
// constructed dependency: getFailedItemProfileResolutionRetryUrl and
// applyCoordinatorJobEnvelope both come from there) and before
// queuedRuntimeActionMatching's construction, satisfying both constraints.
// Its other dependencies -- getCoordinatorItemHref/
// getCoordinatorActionKindForRequestedAction/
// getCoordinatorExecutorTabActionForActionKind (coordinatorExecutorClassification),
// normalizeQuoraProfileUrl/normalizeTabTargetUrl (top-of-file require),
// isRetryableCoordinatorFailure (coordinatorStatusRules),
// shouldApplyProgressToCoordinatorItem (coordinatorProgressRules),
// makeId/makeAttemptId/getNextAttemptNumberFromValue (coordinatorAttemptIdentity),
// makeProfileResolutionQueueKey/getCoordinatorItemQueueKey/
// normalizeCoordinatorRequestedUrl/stripProfileResolutionQueueKey
// (profileResolution), makeEmptyCoordinatorMilestones (coordinatorRuns), and
// reduceJobEvent/isExplicitSecurityVerificationRecord (top-of-file jobState
// require) -- are all already-constructed instances or bare names well
// before this insertion point. isSuccessfulProfileNukeRecord,
// isTerminalProfileNukeRecord, isRetryableTerminalProfileNukeRecord, and
// getQueuedTabMaxRetries are still plain hoisted `function` declarations far
// below in sw.js (Slice 33+ territory) -- hoisted declarations are visible
// throughout their enclosing scope regardless of textual position, so all
// four are threaded through directly, no thunk needed.
//
// Clock/environment-global note: buildFailedCoordinatorResetItem reads
// Date.now() for its `now` default -- threaded through as a top-level
// `now: () => Date.now()` dep (named `getNow` internally), matching
// swCoordinatorJobEnvelope.js's convention -- its closest sibling and this
// module's own latest-constructed dependency.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. No hits in any of the seven functions --
// all are plain synchronous data-in/data-out builders/predicates/sorters, no
// realm-crossing concern.

function createCoordinatorRetryCandidates(deps = {}) {
    const {
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        normalizeTabTargetUrl,
        getFailedItemProfileResolutionRetryUrl,
        isRetryableCoordinatorFailure,
        shouldApplyProgressToCoordinatorItem,
        isSuccessfulProfileNukeRecord,
        isExplicitSecurityVerificationRecord,
        isTerminalProfileNukeRecord,
        isRetryableTerminalProfileNukeRecord,
        makeId,
        makeAttemptId,
        getNextAttemptNumberFromValue,
        normalizeCoordinatorRequestedUrl,
        stripProfileResolutionQueueKey,
        makeProfileResolutionQueueKey,
        getCoordinatorItemQueueKey,
        getCoordinatorActionKindForRequestedAction,
        getCoordinatorExecutorTabActionForActionKind,
        reduceJobEvent,
        getQueuedTabMaxRetries,
        applyCoordinatorJobEnvelope,
        makeEmptyCoordinatorMilestones
    } = deps.handlers || {}
    const {
        JOB_EVENT_RETRY,
        QUEUED_PROFILE_RESOLUTION_MODE
    } = deps.constants || {}
    const getNow = typeof deps.now === 'function' ? deps.now : () => Date.now()

    function makeStoredWorkRecoveryResumeOwnedResult(reason = 'stored-work-recovery', hasWork = false, paused = false) {
        return {
            recovered: false,
            reason,
            resume: {skipped: true, reason: 'resume-owned-by-reconcile'},
            hasWork,
            paused
        }
    }

    function getCoordinatorFailureRetryCount(item = {}) {
        return Number.parseInt(item?.retryCount, 10) || 0
    }

    function getCoordinatorFailureLastRetryAt(item = {}) {
        return Number.parseInt(item?.lastRetryAt, 10) || 0
    }

    function sortCoordinatorRetryCandidates(left, right) {
        const leftItem = left?.item || {}
        const rightItem = right?.item || {}
        const retryDelta = getCoordinatorFailureRetryCount(leftItem) - getCoordinatorFailureRetryCount(rightItem)
        if(retryDelta) return retryDelta

        const lastRetryDelta = getCoordinatorFailureLastRetryAt(leftItem) - getCoordinatorFailureLastRetryAt(rightItem)
        if(lastRetryDelta) return lastRetryDelta

        const leftTerminalAt = Number.parseInt(leftItem.terminalAt || leftItem.updatedAt || leftItem.createdAt, 10) || 0
        const rightTerminalAt = Number.parseInt(rightItem.terminalAt || rightItem.updatedAt || rightItem.createdAt, 10) || 0
        return leftTerminalAt - rightTerminalAt || `${left?.href || ''}`.localeCompare(`${right?.href || ''}`)
    }

    function getCoordinatorRetryableFailureCandidates(queue = {}, progress = {}, retryLimit = 2) {
        return Object.entries(queue || {})
            .map(([itemKey, item]) => {
                const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
                const resolutionRetryUrl = getFailedItemProfileResolutionRetryUrl(item, itemKey)
                return {href, itemKey, item, resolutionRetryUrl}
            })
            .filter(candidate => {
                const href = candidate.href
                const item = candidate.item
                if(!href && !candidate.resolutionRetryUrl) return false
                if(!isRetryableCoordinatorFailure(item)) return false
                if(getCoordinatorFailureRetryCount(item) >= retryLimit) return false

                const progressRecord = progress[href] || null
                const applicableProgressRecord = shouldApplyProgressToCoordinatorItem(item, progressRecord)
                    ? progressRecord
                    : null
                if(isSuccessfulProfileNukeRecord(applicableProgressRecord)) return false
                if(isExplicitSecurityVerificationRecord(applicableProgressRecord)) return false
                if(isTerminalProfileNukeRecord(applicableProgressRecord) && !isRetryableTerminalProfileNukeRecord(applicableProgressRecord)) return false

                return true
            })
            .sort(sortCoordinatorRetryCandidates)
    }

    function getCoordinatorRetrySourcePages(items = []) {
        const sourcePages = new Set()

        for(const item of items || []) {
            if(item?.source?.pageUrl) sourcePages.add(item.source.pageUrl)
            for(const source of item?.sources || []) {
                if(source?.pageUrl) sourcePages.add(source.pageUrl)
            }
        }

        return Array.from(sourcePages)
    }

    function buildFailedCoordinatorResetItem(itemKey = '', item = {}, options = {}) {
        const now = Number.parseInt(options.now, 10) || getNow()
        const runId = options.runId || makeId('failed-reset')
        const request = options.request || {}
        const resetQueuedTabRuntime = options.resetQueuedTabRuntime === true
        const resolutionRetryUrl = getFailedItemProfileResolutionRetryUrl(item, itemKey)
        const retryViaResolution = !!resolutionRetryUrl
        const sourceHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const href = retryViaResolution ? '' : sourceHref
        const coordinatorKey = retryViaResolution
            ? makeProfileResolutionQueueKey(resolutionRetryUrl)
            : href || getCoordinatorItemQueueKey(item, itemKey)
        const attemptId = makeAttemptId()
        const attemptNumber = getNextAttemptNumberFromValue(item)
        const retryCount = Math.max(0, Number.parseInt(options.retryCount, 10) || 0)
        const lastRetryAt = Math.max(0, Number.parseInt(options.lastRetryAt, 10) || 0)
        const retryReason = options.retryReason || ''
        const requestedUrl = resolutionRetryUrl || (
            options.requestedUrlMode === 'coordinator'
                ? normalizeCoordinatorRequestedUrl(item.requestedUrl || href || stripProfileResolutionQueueKey(coordinatorKey))
                : normalizeTabTargetUrl(item.requestedUrl || href)
        )
        const actionKind = getCoordinatorActionKindForRequestedAction(item.actionKind || item.tabAction || item.executorTabAction || '')
        const reducedRetry = reduceJobEvent(item, {
            type: JOB_EVENT_RETRY,
            attemptId,
            attemptNumber,
            at: now,
            retryCount,
            lastRetryAt
        })
        const retryBase = reducedRetry.accepted ? reducedRetry.item : item
        const executorMaxConcurrent = Number.parseInt(options.maxConcurrent, 10) || 0
        const maxRetries = getQueuedTabMaxRetries(item)
        const maxAttempts = resetQueuedTabRuntime
            ? Math.max(
                Number.parseInt(item?.maxAttempts || item?.attempt?.max, 10) || 0,
                attemptNumber + maxRetries + 1,
                maxRetries + 1
            )
            : Number.parseInt(item?.maxAttempts || item?.attempt?.max, 10) || 0

        const nextItem = applyCoordinatorJobEnvelope({
            ...retryBase,
            runId,
            attemptId,
            attemptNumber,
            targetProfileHref: href,
            dedupeKey: href || coordinatorKey,
            coordinatorKey,
            resolutionMode: retryViaResolution ? QUEUED_PROFILE_RESOLUTION_MODE : '',
            resolveProfileFromPage: retryViaResolution,
            resolutionReason: retryViaResolution ? item.resolutionReason || 'failed-target-source-post-revisit' : item.resolutionReason || '',
            requestedUrl: requestedUrl || href,
            actionKind,
            executorTabAction: getCoordinatorExecutorTabActionForActionKind(actionKind),
            ...(executorMaxConcurrent ? {executorMaxConcurrent} : {}),
            executorOwner: 'service-worker',
            serviceWorkerOwned: true,
            executorNoForegroundFallback: request.noForegroundFallback === false
                ? false
                : item.executorNoForegroundFallback === true || item.noForegroundFallback === true || request.noForegroundFallback === true,
            status: 'queued',
            outcome: '',
            error: '',
            updatedAt: now,
            queuedAt: now,
            activeAt: 0,
            terminalAt: 0,
            tabId: null,
            attempt: 0,
            retryAttempt: resetQueuedTabRuntime ? 0 : Number.parseInt(retryBase?.retryAttempt, 10) || 0,
            maxRetries,
            ...(maxAttempts > 0 ? {maxAttempts} : {}),
            retryCount,
            lastRetryAt,
            retryReason,
            actionLease: null,
            actionLeaseReleasedAt: resetQueuedTabRuntime ? 0 : Number.parseInt(retryBase?.actionLeaseReleasedAt, 10) || 0,
            actionLeaseReleaseReason: resetQueuedTabRuntime ? '' : retryBase?.actionLeaseReleaseReason || '',
            actionSurfaceMode: resetQueuedTabRuntime ? '' : retryBase?.actionSurfaceMode || '',
            actionSurfaceWindowId: resetQueuedTabRuntime ? null : retryBase?.actionSurfaceWindowId || null,
            actionSurfaceAnchorTabId: resetQueuedTabRuntime ? null : retryBase?.actionSurfaceAnchorTabId || null,
            actionSurfaceActivatedAt: resetQueuedTabRuntime ? 0 : Number.parseInt(retryBase?.actionSurfaceActivatedAt, 10) || 0,
            loadPressureRequeueCount: resetQueuedTabRuntime ? 0 : Number.parseInt(retryBase?.loadPressureRequeueCount, 10) || 0,
            lastLoadPressureAt: resetQueuedTabRuntime ? 0 : Number.parseInt(retryBase?.lastLoadPressureAt, 10) || 0,
            sourceSettledAt: 0,
            sourceSettlementKey: '',
            sourceSettlementOutcome: '',
            milestones: makeEmptyCoordinatorMilestones()
        }, {
            runInput: {id: runId, sourceType: options.envelopeSourceType || 'failed-retry'},
            source: item.source || {},
            runId,
            targetProfileHref: href,
            requestedUrl: requestedUrl || href,
            coordinatorKey,
            actionKind
        })

        return {
            nextItem,
            coordinatorKey,
            href,
            sourceHref,
            retryViaResolution
        }
    }

    return {
        makeStoredWorkRecoveryResumeOwnedResult,
        getCoordinatorFailureRetryCount,
        getCoordinatorFailureLastRetryAt,
        sortCoordinatorRetryCandidates,
        getCoordinatorRetryableFailureCandidates,
        getCoordinatorRetrySourcePages,
        buildFailedCoordinatorResetItem
    }
}

module.exports = {
    createCoordinatorRetryCandidates
}
