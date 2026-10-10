// Queued-tab runtime-status predicates extracted from sw.js (decomposition
// Slice 6, part 2 of 2). This is the rulebook for what a queued tab's
// runtime state actually means to the reconcile core: whether a tab counts
// as "durably active", whether a persisted tabId/URL pairing is still
// plausible evidence of the coordinator item it's attached to, whether a
// stale-looking active row has genuinely gone silent long enough to be
// reclaimed, and whether a row has exhausted its retry/attempt budget.
//
// The plan's Slice 6 named three name-level sub-clusters (tab-URL
// classification, reclaim-evidence, budget-exhaustion) sitting in the same
// line range. Reading the bodies split that cleanly into two independent
// pieces: the reclaim-evidence predicates (hasActiveCoordinatorMilestoneEvidence,
// hasStrongActiveCoordinatorReclaimEvidence, chooseCoordinatorReclaimProfileTab,
// mergeLiveTabsById, isQueuedCoordinatorLiveTabReclaimReason) never call, or
// get called by, anything else in the slice, and moved out separately into
// swCoordinatorReclaimEvidence.js. Everything else here -- tab-URL
// classification, persisted-tab plausibility, and budget-exhaustion --
// turned out to be one entangled cluster instead of three: e.g.
// shouldTreatTimedOutPersistedTabLookupAsMissingForStaleActive (URL/status
// cluster) calls isActorlessActiveCoordinatorJobExpired and
// isDurableActiveCoordinatorReclaimStale (budget/staleness cluster), and
// hasDurableQueueMatchForRuntimeTab (budget cluster) calls
// getFreshQueuedTabStartupRuntimeActorForCoordinatorItem (tab-status
// cluster). Splitting those three apart would only have added cross-module
// dependency threading without reducing risk, so they stay together here.
//
// Several Date.now() default-parameter reads and one inline Date.now() call
// (inside hasDurableQueueMatchForRuntimeTab) are threaded through as
// `now: () => Date.now()` per the decomposition plan's clock/environment-
// global note -- this module runs in a different V8 realm than sw.js under
// the test harness's vm sandbox, so a bare `Date` reference here would
// resolve to the real Node clock instead of the harness's fake one.

function createQueuedTabRuntimeStatus(deps = {}) {
    const {
        now: getNow = () => Date.now()
    } = deps
    const {
        STALE_ACTIVE_QUEUED_TAB_MS,
        STALE_BACKGROUND_OPENING_QUEUED_TAB_MS,
        PERSISTED_EXECUTOR_TRANSIENT_URL_MAX_AGE_MS,
        COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS,
        COORDINATOR_ACTIVE_JOB_MAX_MS,
        JOB_EVENT_RETRY,
        JOB_EVENT_TAB_REMOVED
    } = deps.constants || {}
    const {
        queueRuntime,
        storageUpdateState,
        getQueuedTabMetadata,
        getHydratedCoordinatorAuthorityState,
        getCoordinatorQueueWorkCounts,
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        getCoordinatorItemQueueKey,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getCoordinatorActionKindForRequestedAction,
        isActiveCoordinatorStatus,
        normalizeTabId,
        getCoordinatorItemExpectedExecutorHref,
        isProfileResolutionItem,
        isTerminalProfileNukeRecord,
        hasActiveQueuedTabActionPhaseProgress,
        isNonProfileQuoraHttpLandingUrl,
        getPersistedQueuedTabId,
        hasOwnedQueuedTabState,
        getCoordinatorItemExpectedExecutorUrl,
        getTabObservedUrls,
        normalizeCoordinatorRequestedUrl,
        hasConfirmedRuntimeActorForCoordinatorItem,
        getPersistedExecutorObservedAgeMs,
        isQuoraChallengeLikeUrl,
        isExplicitSecurityVerificationRecord,
        isQuoraHttpUrl,
        incrementQueueWakeupMetric,
        getFreshWorkerWindowStartupProgressAnchor,
        hasMismatchedCoordinatorAttempt,
        getActiveQueuedTabAgeAnchor,
        getPersistedActiveCoordinatorStaleAnchor,
        getQueuedTabRetryAttempt,
        getQueuedTabMaxRetries,
        getCoordinatorProgressRecordForItem,
        makeAttemptId,
        reduceJobEvent,
        applyCoordinatorJobEnvelope,
        makeEmptyCoordinatorMilestones,
        buildTerminalCoordinatorQueueItem
    } = deps.handlers || {}

    function isDurablyActiveQueuedTab(tabId) {
        const metadata = getQueuedTabMetadata(tabId)
        return Number.isFinite(metadata?.durableActiveAt) && metadata.durableActiveAt > 0
    }

    // A non-durable provisional tab whose attempt has no authority row holds no capacity. Nothing
    // is waiting on it, and reconcile clears it later. Durable tabs, and tabs whose attempt still has
    // an authority row, always count.
    function isOrphanProvisionalQueuedTab(tabId) {
        if(isDurablyActiveQueuedTab(tabId)) return false
        const metadata = getQueuedTabMetadata(tabId)
        const attemptId = getAttemptIdFromValue(metadata)
        if(!attemptId) return false
        const authorityState = getHydratedCoordinatorAuthorityState()
        if(!authorityState?.queue) return false
        const key = metadata?.coordinatorKey || metadata?.profileHref || ''
        const row = key ? authorityState.queue[key] : null
        return getAttemptIdFromValue(row) !== attemptId
    }

    function getCapacityConsumingQueuedTabCount() {
        let count = 0
        for(const tabId of queueRuntime.listActiveQueuedTabIds()) {
            if(!isOrphanProvisionalQueuedTab(tabId)) count += 1
        }
        return count
    }

    function getDurablyActiveQueuedTabCount() {
        let count = 0
        for(const tabId of queueRuntime.listActiveQueuedTabIds()) {
            if(isDurablyActiveQueuedTab(tabId)) count += 1
        }
        return count
    }

    function getDurablyActiveCoordinatorAuthorityRowCount() {
        const currentAuthorityState = getHydratedCoordinatorAuthorityState()
        if(!currentAuthorityState?.queue) return 0

        return getCoordinatorQueueWorkCounts(currentAuthorityState.queue).durableActiveRows
    }

    function getFreshQueuedTabRuntimeStartupAnchor(metadata = null) {
        return Math.max(
            Number.parseInt(metadata?.durableActiveAt, 10) || 0,
            Number.parseInt(metadata?.activeTransitionContinuedAt, 10) || 0,
            Number.parseInt(metadata?.activeTransitionUnconfirmedAt, 10) || 0,
            Number.parseInt(metadata?.activeTransitionPendingAt, 10) || 0,
            Number.parseInt(metadata?.openedAt, 10) || 0,
            Number.parseInt(metadata?.tabOpenedAt, 10) || 0,
            Number.parseInt(metadata?.tabCreatedAt, 10) || 0
        )
    }

    function isFreshQueuedTabRuntimeStartup(metadata = null, now = getNow()) {
        if(!metadata || metadata?.closeRequestedAt || metadata?.closeReason) return false

        const startupAnchor = getFreshQueuedTabRuntimeStartupAnchor(metadata)
        return startupAnchor > 0 && now - startupAnchor < STALE_ACTIVE_QUEUED_TAB_MS
    }

    function shouldDeferQueuedTabReleaseRollback(metadata = null, now = getNow()) {
        if(!metadata || metadata?.retryRequestedAt || metadata?.closeRequestedAt || metadata?.closeReason) return false
        if(!isFreshQueuedTabRuntimeStartup(metadata, now)) return false
        if(!Number.isFinite(metadata?.durableActiveAt) || metadata.durableActiveAt <= 0) return false

        const contentScriptRecoveryActive = Math.max(
            Number.parseInt(metadata?.contentScriptEnsureStartedAt, 10) || 0,
            Number.parseInt(metadata?.contentScriptEnsureFailedAt, 10) || 0,
            Number.parseInt(metadata?.contentScriptInjectedAt, 10) || 0,
            Number.parseInt(metadata?.contentScriptPresentAt, 10) || 0,
            Number.parseInt(metadata?.lastNudgeFailedAt, 10) || 0,
            Number.parseInt(metadata?.activeTransitionContinuedAt, 10) || 0,
            Number.parseInt(metadata?.activeTransitionUnconfirmedAt, 10) || 0
        )
        if(contentScriptRecoveryActive > 0 && now - contentScriptRecoveryActive < STALE_BACKGROUND_OPENING_QUEUED_TAB_MS) {
            return true
        }

        return storageUpdateState.getDepth() > 0
    }

    function queuedTabRuntimeMetadataMatchesCoordinatorItem(item = null, record = null, itemKey = '', metadata = null) {
        if(!item || !metadata) return false

        const expectedHref = getCoordinatorItemHref(item) ||
            normalizeQuoraProfileUrl(itemKey) ||
            normalizeQuoraProfileUrl(record?.profileHref || '')
        const metadataHref = normalizeQuoraProfileUrl(metadata.profileHref || metadata.targetProfileHref || metadata.requestedUrl || '')
        if(expectedHref && metadataHref && metadataHref !== expectedHref) return false

        const expectedCoordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
        const metadataCoordinatorKey = `${metadata.coordinatorKey || ''}`.trim()
        if(expectedCoordinatorKey && metadataCoordinatorKey && metadataCoordinatorKey !== expectedCoordinatorKey) return false

        const expectedAttemptId = getAttemptIdFromValue(item) || getAttemptIdFromValue(record)
        const expectedAttemptNumber = getAttemptNumberFromValue(item) || getAttemptNumberFromValue(record)
        const metadataAttemptId = getAttemptIdFromValue(metadata)
        const metadataAttemptNumber = getAttemptNumberFromValue(metadata)
        if(expectedAttemptId && metadataAttemptId !== expectedAttemptId) return false
        if(expectedAttemptNumber && metadataAttemptNumber !== expectedAttemptNumber) return false

        const expectedActionKind = getCoordinatorActionKindForRequestedAction(
            item.actionKind ||
            item.executorTabAction ||
            item.tabAction ||
            record?.actionKind ||
            ''
        )
        const metadataActionKind = getCoordinatorActionKindForRequestedAction(metadata.actionKind || metadata.tabAction || '')
        if(expectedActionKind && metadataActionKind && metadataActionKind !== expectedActionKind) return false

        return true
    }

    function getFreshQueuedTabStartupRuntimeActorForCoordinatorItem(
        item = null,
        record = null,
        itemKey = '',
        now = getNow(),
        expectedTabId = null,
        options = {}
    ) {
        if(!item || !isActiveCoordinatorStatus(item?.status)) return null

        const requireDurable = options.requireDurable !== false
        const candidateTabIds = expectedTabId
            ? [normalizeTabId(expectedTabId)]
            : queueRuntime.listActiveQueuedTabIds()
        for(const candidateTabId of candidateTabIds) {
            const tabId = normalizeTabId(candidateTabId)
            if(!tabId || !queueRuntime.hasActiveQueuedTab(tabId)) continue
            if(requireDurable && !isDurablyActiveQueuedTab(tabId)) continue

            const metadata = getQueuedTabMetadata(tabId)
            if(!isFreshQueuedTabRuntimeStartup(metadata, now)) continue
            if(!queuedTabRuntimeMetadataMatchesCoordinatorItem(item, record, itemKey, metadata)) continue

            return {tabId, metadata}
        }

        return null
    }

    function getSchedulerBlockingQueuedExecutorCount() {
        return Math.max(
            getDurablyActiveQueuedTabCount(),
            getDurablyActiveCoordinatorAuthorityRowCount()
        )
    }

    function isBlankOrUncommittedTabUrl(value = '') {
        return /^(?:about:blank|about:newtab)$/i.test(`${value || ''}`.trim())
    }

    function isBrowserErrorTabUrl(value = '') {
        return /^(?:chrome|edge)-error:/i.test(`${value || ''}`.trim())
    }

    function isCoordinatorProfileLandingWork(item = null, itemKey = '', record = null) {
        const href = getCoordinatorItemExpectedExecutorHref(item, record, itemKey)
        return !!href && !isProfileResolutionItem(item)
    }

    function shouldTerminalizeCoordinatorNonProfileLanding(item = null, record = null, itemKey = '', landingUrl = '') {
        if(!item || typeof item !== 'object') return false
        if(!isActiveCoordinatorStatus(item.status)) return false
        if(isTerminalProfileNukeRecord(record)) return false
        if(hasActiveQueuedTabActionPhaseProgress(record, item)) return false
        if(!isCoordinatorProfileLandingWork(item, itemKey, record)) return false
        return isNonProfileQuoraHttpLandingUrl(landingUrl || record?.lastUrl || record?.errorPageUrl || '')
    }

    function isSafeToCloseNonProfileLandingTab(item = null, record = null, tab = null) {
        const tabId = normalizeTabId(tab?.id)
        if(!tabId || getPersistedQueuedTabId(item, record) !== tabId) return false
        if(!isNonProfileQuoraHttpLandingUrl(tab?.url || tab?.pendingUrl || '')) return false
        if(hasOwnedQueuedTabState(tabId)) return true

        const actionSurfaceWindowId = Number.parseInt(
            record?.actionSurfaceWindowId ||
            item?.actionSurfaceWindowId ||
            item?.ownerWindowId,
            10
        ) || 0
        return !!actionSurfaceWindowId && Number.parseInt(tab?.windowId, 10) === actionSurfaceWindowId
    }

    function isPersistedLiveTabPlausibleForCoordinatorItem(item = null, record = null, itemKey = '', tab = null, now = getNow()) {
        const tabId = getPersistedQueuedTabId(item, record)
        if(!tabId || normalizeTabId(tab?.id) !== tabId) return false

        const expectedHref = getCoordinatorItemExpectedExecutorHref(item, record, itemKey)
        const expectedUrl = getCoordinatorItemExpectedExecutorUrl(item, record, itemKey)
        const observedUrls = getTabObservedUrls(tab)
        for(const observedUrl of observedUrls) {
            if(expectedHref && normalizeQuoraProfileUrl(observedUrl) === expectedHref) return true
            if(expectedUrl &&
                (isProfileResolutionItem(item) || !expectedHref) &&
                normalizeCoordinatorRequestedUrl(observedUrl) === expectedUrl) {
                return true
            }
        }
        if(expectedHref && !isProfileResolutionItem(item)) {
            if(observedUrls.some(isNonProfileQuoraHttpLandingUrl)) return false
        }

        if(hasConfirmedRuntimeActorForCoordinatorItem(item, record)) return true

        const ageMs = getPersistedExecutorObservedAgeMs(item, record, now)
        const freshTransient = ageMs <= PERSISTED_EXECUTOR_TRANSIENT_URL_MAX_AGE_MS
        if(!freshTransient) return false

        if(observedUrls.some(isBlankOrUncommittedTabUrl)) return true
        if(observedUrls.some(isQuoraChallengeLikeUrl)) return true
        if(observedUrls.some(isBrowserErrorTabUrl) && (
            isExplicitSecurityVerificationRecord(record) ||
            isQuoraHttpUrl(record?.lastUrl || '') ||
            isQuoraHttpUrl(record?.errorPageUrl || '') ||
            !!expectedHref ||
            !!expectedUrl
        )) {
            return true
        }

        return false
    }

    function shouldTreatTimedOutPersistedTabLookupAsMissingForStaleActive(item = null, record = null, status = null, now = getNow()) {
        if(!status?.timedOut) return false
        if(!item || !isActiveCoordinatorStatus(item.status)) return false
        if(isTerminalProfileNukeRecord(record)) return false
        if(hasConfirmedRuntimeActorForCoordinatorItem(item, record)) return false
        if(!getPersistedQueuedTabId(item, record)) return false

        return isActorlessActiveCoordinatorJobExpired(item, record, now) ||
            isDurableActiveCoordinatorReclaimStale(item, record, now)
    }

    function shouldDeferActiveWithoutActorReconcileForPersistedTabStatus(status = null, item = null, record = null, now = getNow()) {
        if(shouldTreatTimedOutPersistedTabLookupAsMissingForStaleActive(item, record, status, now)) {
            incrementQueueWakeupMetric('reconcile.persistedTabLookupTimeoutTreatedMissing')
            return false
        }

        return !!(status?.timedOut ||
            (status?.error &&
                status.error !== 'missing-persisted-tab-identity' &&
                !status.missing &&
                !status.implausible))
    }

    function hasFreshWorkerWindowStartupProgressForCoordinatorItem(item = null, record = null, now = getNow()) {
        if(!item || !isActiveCoordinatorStatus(item.status)) return false
        if(!record || isTerminalProfileNukeRecord(record)) return false
        if(hasMismatchedCoordinatorAttempt(item, record)) return false
        if(hasActiveQueuedTabActionPhaseProgress(record, item)) return false

        const actionSurfaceMode = `${record.actionSurfaceMode || item.actionSurfaceMode || ''}`.trim()
        if(actionSurfaceMode !== 'worker-window') return false
        if(item.executorNoForegroundFallback !== true && record.noForegroundFallback !== true) return false
        if(record.closeRequestedAt || record.slotReleasedAt || record.terminalAt) return false

        const status = `${record.status || ''}`.trim()
        if(status && status !== 'tab-opening' && status !== 'tab-opened') return false

        const startupAnchor = getFreshWorkerWindowStartupProgressAnchor(item, record)
        return startupAnchor > 0 && now - startupAnchor < STALE_ACTIVE_QUEUED_TAB_MS
    }

    function isActorlessActiveCoordinatorJobExpired(item = null, record = null, now = getNow()) {
        if(!item || !isActiveCoordinatorStatus(item.status)) return false
        if(isTerminalProfileNukeRecord(record)) return false
        if(hasConfirmedRuntimeActorForCoordinatorItem(item, record)) return false

        const actionPhaseActive = hasActiveQueuedTabActionPhaseProgress(record, item)
        const activeStartedAt = actionPhaseActive
            ? getActiveQueuedTabAgeAnchor(item, record)
            : Number.isFinite(item?.activeAt) ? item.activeAt : 0
        const activeJobMaxMs = actionPhaseActive
            ? COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS
            : COORDINATOR_ACTIVE_JOB_MAX_MS

        return activeStartedAt > 0 && now - activeStartedAt >= activeJobMaxMs
    }

    function isDurableActiveCoordinatorReclaimStale(item = null, record = null, now = getNow()) {
        const staleAnchor = getPersistedActiveCoordinatorStaleAnchor(item, record)
        if(!staleAnchor) return true

        const timeoutMs = hasActiveQueuedTabActionPhaseProgress(record, item)
            ? COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS
            : COORDINATOR_ACTIVE_JOB_MAX_MS
        return now - staleAnchor >= timeoutMs
    }

    function isQueuedTabAttemptBudgetExhausted(item = null, record = null) {
        const retryAttempt = getQueuedTabRetryAttempt(item, record)
        const maxRetries = getQueuedTabMaxRetries(item, record)
        const attemptNumber = getAttemptNumberFromValue(item) || getAttemptNumberFromValue(record)
        const itemMaxAttempts = Number.parseInt(item?.maxAttempts || item?.attempt?.max, 10)
        const recordMaxAttempts = Number.parseInt(record?.maxAttempts || record?.attempt?.max, 10)
        const configuredMaxAttempts = maxRetries + 1
        const storedMaxAttempts = Math.max(
            Number.isFinite(itemMaxAttempts) && itemMaxAttempts > 0 ? itemMaxAttempts : 0,
            Number.isFinite(recordMaxAttempts) && recordMaxAttempts > 0 ? recordMaxAttempts : 0
        )
        const maxAttempts = Math.max(configuredMaxAttempts, storedMaxAttempts)
        return retryAttempt >= maxRetries ||
            (attemptNumber > 0 && attemptNumber >= maxAttempts)
    }

    function isQueuedAuthorityNoSurfaceRetryBudgetExhausted(item = null, record = null) {
        if(isQueuedTabAttemptBudgetExhausted(item, record)) return true

        const attemptNumber = getAttemptNumberFromValue(item) || getAttemptNumberFromValue(record)
        const maxRetries = getQueuedTabMaxRetries(item, record)
        return attemptNumber > 0 && attemptNumber >= maxRetries + 1
    }

    function hasDurableQueueMatchForRuntimeTab(tabId = null, queue = {}, progress = {}) {
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId || !queueRuntime.hasActiveQueuedTab(normalizedTabId)) return false

        for(const [itemKey, item] of Object.entries(queue || {})) {
            if(!isActiveCoordinatorStatus(item?.status)) continue

            const record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
            const persistedTabId = getPersistedQueuedTabId(item, record)
            if(persistedTabId && persistedTabId !== normalizedTabId) continue
            if(persistedTabId === normalizedTabId && hasConfirmedRuntimeActorForCoordinatorItem(item, record)) return true
            if(getFreshQueuedTabStartupRuntimeActorForCoordinatorItem(
                item,
                record,
                itemKey,
                getNow(),
                normalizedTabId
            )) return true
        }

        return false
    }

    function buildRequeuedActiveCoordinatorItemWithoutActor(item = {}, record = null, now = getNow(), reason = 'reconcile-active-without-actor', options = {}) {
        const retryAttempt = getQueuedTabRetryAttempt(item, record)
        const maxRetries = getQueuedTabMaxRetries(item, record)
        if(isQueuedTabAttemptBudgetExhausted(item, record) && options.forceRequeueExhaustedActorless !== true) {
            return buildTerminalCoordinatorQueueItem(item, {
                status: 'failed',
                outcome: 'timeout',
                error: 'Durable active queue row had no confirmed runtime actor',
                reason,
                eventType: JOB_EVENT_TAB_REMOVED,
                now
            })
        }

        const attemptId = makeAttemptId()
        const attemptNumber = Math.max(
            getAttemptNumberFromValue(item),
            getAttemptNumberFromValue(record)
        ) + 1
        const nextRetryAttempt = retryAttempt + 1
        const effectiveMaxRetries = Math.max(maxRetries, nextRetryAttempt + 1)
        const configuredMaxAttempts = Math.max(
            Number.parseInt(item?.attempt?.max, 10) || 0,
            Number.parseInt(item?.maxAttempts, 10) || 0
        )
        const effectiveMaxAttempts = Math.max(configuredMaxAttempts, attemptNumber + 1, effectiveMaxRetries + 1)
        const actionKind = getCoordinatorActionKindForRequestedAction(item.actionKind || item.tabAction || item.executorTabAction || '')
        const reducedRetry = reduceJobEvent(item, {
            type: JOB_EVENT_RETRY,
            attemptId,
            attemptNumber,
            at: now,
            retryCount: nextRetryAttempt,
            lastRetryAt: item.lastRetryAt || 0
        })
        const retryBase = reducedRetry.accepted ? reducedRetry.item : item

        return applyCoordinatorJobEnvelope({
            ...retryBase,
            attemptId,
            attemptNumber,
            actionKind,
            status: 'queued',
            outcome: '',
            error: '',
            updatedAt: now,
            queuedAt: now,
            activeAt: 0,
            terminalAt: 0,
            tabId: null,
            attempt: effectiveMaxAttempts > 0
                ? {
                    id: attemptId,
                    number: attemptNumber,
                    max: effectiveMaxAttempts
                }
                : 0,
            retryAttempt: nextRetryAttempt,
            maxRetries: effectiveMaxRetries,
            ...(effectiveMaxAttempts > 0
                ? {maxAttempts: effectiveMaxAttempts}
                : {}),
            actionLease: null,
            actionLeaseReleasedAt: now,
            actionLeaseReleaseReason: reason,
            milestones: makeEmptyCoordinatorMilestones()
        }, {
            runInput: {id: item.runId || '', sourceType: item.source?.type || item.scope?.type || ''},
            source: item.source || {},
            runId: item.runId || '',
            targetProfileHref: getCoordinatorItemHref(item),
            requestedUrl: item.requestedUrl || getCoordinatorItemHref(item),
            coordinatorKey: item.coordinatorKey || getCoordinatorItemHref(item),
            actionKind
        })
    }

    return {
        isDurablyActiveQueuedTab,
        getDurablyActiveQueuedTabCount,
        getCapacityConsumingQueuedTabCount,
        getDurablyActiveCoordinatorAuthorityRowCount,
        getFreshQueuedTabRuntimeStartupAnchor,
        isFreshQueuedTabRuntimeStartup,
        shouldDeferQueuedTabReleaseRollback,
        queuedTabRuntimeMetadataMatchesCoordinatorItem,
        getFreshQueuedTabStartupRuntimeActorForCoordinatorItem,
        getSchedulerBlockingQueuedExecutorCount,
        isBlankOrUncommittedTabUrl,
        isBrowserErrorTabUrl,
        isCoordinatorProfileLandingWork,
        shouldTerminalizeCoordinatorNonProfileLanding,
        isSafeToCloseNonProfileLandingTab,
        isPersistedLiveTabPlausibleForCoordinatorItem,
        shouldTreatTimedOutPersistedTabLookupAsMissingForStaleActive,
        shouldDeferActiveWithoutActorReconcileForPersistedTabStatus,
        hasFreshWorkerWindowStartupProgressForCoordinatorItem,
        isActorlessActiveCoordinatorJobExpired,
        isDurableActiveCoordinatorReclaimStale,
        isQueuedTabAttemptBudgetExhausted,
        isQueuedAuthorityNoSurfaceRetryBudgetExhausted,
        hasDurableQueueMatchForRuntimeTab,
        buildRequeuedActiveCoordinatorItemWithoutActor
    }
}

module.exports = {
    createQueuedTabRuntimeStatus
}
