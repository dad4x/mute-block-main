// Queued-tab retry-attempt/stale-nudge bookkeeping + missing-active-evidence
// reconcile extracted from sw.js (decomposition Slice 35). Two entangled
// concerns that share the same retry-budget primitives: (1) the "missing
// active evidence" reconcile-decision applier and its two helpers -- what
// counts as a claimed-but-actorless active row needing reconcile, and the
// interrupted-progress-record builder that reconcile writes when it fires --
// and (2) the queued-tab retry-attempt/max-retries getters, the stale-
// accepted-nudge/load-pressure predicates built on top of them, the retry-
// action builder, and the stale-retry-advance dedupe-key/wake-key-pruning
// pair that keeps a single wake cycle from re-advancing the same retry twice.
//
// Realm-crossing scrutiny (per architecture.md's Slice-7 refinement): all 10
// bodies were grepped for `.then(`, `.catch(`, `Promise.`, `async`,
// `setTimeout`, and `void` -- none present in any of them. All 10 are plain
// synchronous functions; none builds or returns a Promise chain. Several are
// called synchronously from deep inside async reconcile-tick code still
// resident in sw.js (applyMissingActiveCoordinatorEvidenceReconcileActionLocked
// from the queue-authority persist path,
// getMissingActiveCoordinatorReconcileDecision's call into
// shouldReconcileMissingActiveCoordinatorTab, and
// advanceCoordinatorQueueForStaleRetryAction's calls into
// getStaleRetryAdvanceKey/pruneStaleRetryAdvancedWakeKeys) -- the same
// "sync extracted function called synchronously from an async critical
// section" shape already landed clean in Slices 17-20. A plain synchronous
// call costs no microtask tick regardless of which realm defines the callee,
// so moving this cluster does not reintroduce the WAL-extraction hazard.
//
// Clock note: applyMissingActiveCoordinatorEvidenceReconcileActionLocked
// reads Date.now() as an `operation.now` fallback, and
// shouldReconcileMissingActiveCoordinatorTab, makeMissingActiveCoordinatorProgressRecord,
// hasStaleAcceptedQueuedTabNudge, and isQueuedTabLoadPressure read it via a
// `now = Date.now()` default parameter. Per the plan's clock/environment-
// global note, `now` is threaded through as `deps.now` (`getNow`, defaulting
// to `() => Date.now()`); each site calls `getNow()` instead of the bare
// global.
//
// State-ownership note: applyMissingActiveCoordinatorEvidenceReconcileActionLocked
// is the only one of the 10 that touches the module-level `profileNukeProgress`
// mutable binding (a `let` in sw.js, read/written at 70+ sites well outside
// this cluster) -- threaded through as a get/set accessor pair
// (getProfileNukeProgress/setProfileNukeProgress), matching the
// swCoordinatorReconcileLockedMaterialization (Slice 19) precedent for the
// same variable. pruneStaleRetryAdvancedWakeKeys reads/writes the
// module-level `staleRetryAdvancedWakeKeys` Map (a `const` in sw.js, so the
// binding itself is never reassigned) and reads the module-level
// `queueWakeupMetricCycleSerial` `let` as its default parameter --
// the Map is threaded through directly by reference (mutating it in place
// is visible to sw.js's own resident code, e.g.
// advanceCoordinatorQueueForStaleRetryAction, the same way queueRuntime's
// Maps are shared across every module that holds a reference to it), and
// the serial is threaded through as a `getQueueWakeupMetricCycleSerial`
// state getter, matching the queueWakeupMetricsShape precedent for the same
// variable.
//
// Construction-order note: this module constructs well before this
// cluster's old source-text position, immediately after coordinatorJobEnvelope's
// destructure and before coordinatorRetryCandidates (decomposition Slice
// 29): coordinatorRetryCandidates eagerly references bare
// `getQueuedTabMaxRetries` in its own construction-call `handlers` object
// literal, the earliest of several such eager references across
// already-extracted modules (queuedTabRuntimeStatus and
// rolledBackQueuedTabRetryClassification, both constructed further down,
// also reference `getQueuedTabMaxRetries`/`getQueuedTabRetryAttempt` bare
// the same way). A `const` destructured from a factory call is in the
// temporal dead zone until that line executes -- so this module must
// construct before coordinatorRetryCandidates, the earliest of them. At
// that point `hasOwnedQueuedTabState` (queuedForegroundLeaseRuntime, Slice
// 32) and `getCoordinatorProgressRecordForItem` (coordinatorSourceProvenance,
// Slice 18) aren't available as bare consts yet -- both construct later in
// sw.js -- so each is threaded through as a thunk that defers name
// resolution to call time, matching the activeQueuedTabStaleness (Slice 34)
// precedent for the same shape. Every other handler this module needs
// (coordinatorStatusRules, activeQueuedTabStaleness, coordinatorExecutorClassification,
// profileResolution, tabIdUtils, profileNukeRecordClassification,
// coordinatorRuns, coordinatorAttemptIdentity, profileProgressMerge, plus
// queueRuntime and the top-of-file subject.js require) is already a bare
// name or already-constructed instance by this point.

function createQueuedTabRetryStaleReconcile(deps = {}) {
    const {
        now: getNow = () => Date.now()
    } = deps
    const {
        STALE_QUEUED_TAB_MAX_RETRIES,
        QUEUED_TAB_UNCONFIRMED_ACTIVE_RECONCILE_MS,
        QUEUED_TAB_CLAIM_NUDGE_TIMEOUT_ESCALATION_MS,
        COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS,
        COORDINATOR_ACTIVE_JOB_MAX_MS,
        STALE_BACKGROUND_OPENING_QUEUED_TAB_MS
    } = deps.constants || {}
    const {
        queueRuntime,
        normalizeTabTargetUrl,
        normalizeQuoraProfileUrl,
        normalizeTabId,
        normalizeProgressPatch,
        makeProfileResolutionQueueKey,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        normalizeAttemptId,
        getNextAttemptNumberFromValue,
        makeAttemptId,
        hasMismatchedCoordinatorAttempt,
        isTerminalCoordinatorStatus,
        isTerminalProfileNukeRecord,
        isTransientProfileNukeStatus,
        hasActiveQueuedTabActionPhaseProgress,
        hasConfirmedRuntimeActorForCoordinatorItem,
        hasConfirmedLiveRuntimeActorForCoordinatorItem,
        getActiveQueuedTabAgeAnchor,
        getOwnedOrExpectedLiveTabsForProfileHref,
        getPersistedActiveCoordinatorStaleAnchor,
        getActiveQueuedTabStaleTimeoutMs,
        getPersistedQueuedTabId,
        getCoordinatorItemHref,
        getCoordinatorRunIdsForHref,
        hasOwnedQueuedTabState,
        getCoordinatorProgressRecordForItem
    } = deps.handlers || {}
    const {
        getProfileNukeProgress,
        setProfileNukeProgress,
        getQueueWakeupMetricCycleSerial,
        staleRetryAdvancedWakeKeys
    } = deps.state || {}

    function applyMissingActiveCoordinatorEvidenceReconcileActionLocked(state = {}, operation = {}) {
        const queue = state.queue || {}
        const runs = state.runs || {}
        const progress = state.progress || {}
        const itemKey = `${operation.itemKey || ''}`.trim()
        if(!itemKey) return {changed: false, reason: 'missing-item-key'}

        const item = queue[itemKey] || null
        if(!item || typeof item !== 'object') return {changed: false, reason: 'row-changed'}
        if(isTerminalCoordinatorStatus(item.status)) return {changed: false, reason: 'terminal-row'}

        const expectedAttemptId = normalizeAttemptId(operation.expectedAttemptId || '')
        const expectedAttemptNumber = Number.parseInt(operation.expectedAttemptNumber, 10) || 0
        if(expectedAttemptId && getAttemptIdFromValue(item) !== expectedAttemptId) {
            return {changed: false, reason: 'attempt-changed'}
        }
        if(expectedAttemptNumber && getAttemptNumberFromValue(item) !== expectedAttemptNumber) {
            return {changed: false, reason: 'attempt-changed'}
        }

        const href = getCoordinatorItemHref(item) ||
            normalizeQuoraProfileUrl(operation.href || '') ||
            normalizeQuoraProfileUrl(itemKey)
        if(!href) return {changed: false, reason: 'missing-href'}

        const record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
        if(record && hasMismatchedCoordinatorAttempt(item, record)) {
            return {changed: false, reason: 'progress-attempt-mismatch'}
        }

        const now = Number.parseInt(operation.now, 10) || getNow()
        const nextRecord = makeMissingActiveCoordinatorProgressRecord(href, record, now, item)
        if(!nextRecord) return {changed: false, reason: 'missing-progress-record'}

        const recordHref = normalizeQuoraProfileUrl(href || nextRecord.profileHref || '')
        if(!recordHref) return {changed: false, reason: 'missing-record-href'}
        if(JSON.stringify(progress[recordHref] || null) === JSON.stringify(nextRecord)) {
            return {changed: false, reason: 'unchanged'}
        }

        progress[recordHref] = nextRecord
        setProfileNukeProgress({
            ...getProfileNukeProgress(),
            [recordHref]: nextRecord
        })

        const affectedRunIds = new Set()
        if(item.runId) affectedRunIds.add(item.runId)
        for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
            affectedRunIds.add(runId)
        }

        const tabIdsToClose = new Set()
        const persistedTabId = normalizeTabId(operation.persistedTabId || getPersistedQueuedTabId(item, record))
        if(operation.closePersistedTab === true && persistedTabId) tabIdsToClose.add(persistedTabId)
        for(const tabId of operation.expectedLiveTabIds || []) {
            const normalizedTabId = normalizeTabId(tabId)
            if(normalizedTabId && normalizedTabId !== persistedTabId) tabIdsToClose.add(normalizedTabId)
        }

        return {
            changed: true,
            progressChanged: true,
            materialized: 1,
            affectedRunIds: Array.from(affectedRunIds),
            tabIdsToClose: Array.from(tabIdsToClose),
            href: recordHref
        }
    }

    function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = '', liveProfileTabsByHref = new Map(), now = getNow()) {
        if(!item || typeof item !== 'object') return false
        if(isTerminalCoordinatorStatus(item.status)) return false
        if(isTerminalProfileNukeRecord(record)) return false

        const itemStatus = `${item.status || ''}`.trim()
        const recordStatus = `${record?.status || ''}`.trim()
        const rowIsClaimed = itemStatus === 'active' || itemStatus === 'settling'
        const recordIsActiveEvidence = !!record &&
            !!recordStatus &&
            recordStatus !== 'queued' &&
            isTransientProfileNukeStatus(recordStatus)
        if(record && !rowIsClaimed && !recordIsActiveEvidence) return false

        const queuedRowHasClaimedProgress = itemStatus === 'queued' && recordIsActiveEvidence
        if(!rowIsClaimed && !queuedRowHasClaimedProgress) return false

        const actionPhaseActive = hasActiveQueuedTabActionPhaseProgress(record, item)
        const confirmedRuntimeActor = hasConfirmedRuntimeActorForCoordinatorItem(item, record)
        const confirmedLiveRuntimeActor = confirmedRuntimeActor &&
            hasConfirmedLiveRuntimeActorForCoordinatorItem(item, record, liveProfileTabsByHref)
        const activeStartedAt = actionPhaseActive
            ? getActiveQueuedTabAgeAnchor(item, record)
            : Number.isFinite(item?.activeAt) ? item.activeAt : 0
        const activeJobMaxMs = actionPhaseActive
            ? COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS
            : COORDINATOR_ACTIVE_JOB_MAX_MS
        const activeAgeExpired = rowIsClaimed &&
            activeStartedAt > 0 &&
            now - activeStartedAt >= activeJobMaxMs
        if(rowIsClaimed &&
            !actionPhaseActive &&
            !confirmedLiveRuntimeActor &&
            !getOwnedOrExpectedLiveTabsForProfileHref(item, record, href, liveProfileTabsByHref).length) {
            return true
        }

        const staleRecord = recordIsActiveEvidence ? record : null
        const staleAnchor = getPersistedActiveCoordinatorStaleAnchor(item, staleRecord)
        const staleTimeoutMs = staleRecord ? getActiveQueuedTabStaleTimeoutMs(staleRecord, {
            noForegroundFallback: true
        }) : STALE_BACKGROUND_OPENING_QUEUED_TAB_MS
        if(!activeAgeExpired && (!staleAnchor || now - staleAnchor < staleTimeoutMs)) return false

        if(rowIsClaimed && !actionPhaseActive && !confirmedLiveRuntimeActor) {
            return true
        }

        if(getOwnedOrExpectedLiveTabsForProfileHref(item, record, href, liveProfileTabsByHref).length) return false

        const tabId = getPersistedQueuedTabId(item, record)
        if(tabId) return !hasOwnedQueuedTabState(tabId)

        return !getOwnedOrExpectedLiveTabsForProfileHref(item, record, href, liveProfileTabsByHref).length
    }

    function makeMissingActiveCoordinatorProgressRecord(href = '', record = null, now = getNow(), item = null) {
        const normalizedHref = normalizeQuoraProfileUrl(href || record?.profileHref || '')
        if(!normalizedHref) return null

        return normalizeProgressPatch(normalizedHref, {
            actionKind: record?.actionKind || item?.actionKind || 'mute-block',
            attemptId: getAttemptIdFromValue(record) || getAttemptIdFromValue(item),
            attemptNumber: getAttemptNumberFromValue(record) || getAttemptNumberFromValue(item),
            runId: record?.runId || item?.runId || '',
            tabId: getPersistedQueuedTabId(item, record) || null,
            status: 'interrupted',
            finalError: 'Queued tab timed out after disappearing before completion',
            tabClosedAt: now,
            slotReleasedAt: now,
            closedByExtension: true,
            closeReason: 'stale-active-tab',
            event: 'Reconciled stale active queued tab after timeout'
        }, record)
    }

    function getQueuedTabRetryAttempt(metadata = null, record = null) {
        const metadataAttempt = Number.parseInt(metadata?.retryAttempt, 10)
        const recordAttempt = Number.parseInt(record?.retryAttempt, 10)
        return Math.max(
            Number.isFinite(metadataAttempt) && metadataAttempt > 0 ? metadataAttempt : 0,
            Number.isFinite(recordAttempt) && recordAttempt > 0 ? recordAttempt : 0
        )
    }

    function getQueuedTabMaxRetries(metadata = null, record = null) {
        const metadataMax = Number.parseInt(metadata?.maxRetries, 10)
        const recordMax = Number.parseInt(record?.maxRetries, 10)
        const fallback = STALE_QUEUED_TAB_MAX_RETRIES
        const maxRetries = Number.isFinite(metadataMax) && metadataMax >= 0
            ? metadataMax
            : Number.isFinite(recordMax) && recordMax >= 0
                ? recordMax
                : fallback

        return Math.max(0, maxRetries)
    }

    function hasStaleAcceptedQueuedTabNudge(metadata = null, record = null, now = getNow()) {
        if(hasActiveQueuedTabActionPhaseProgress(record, metadata)) return false
        const acceptedAt = Math.max(
            Number.parseInt(metadata?.lastNudgeAcceptedAt, 10) || 0,
            Number.parseInt(metadata?.lastNudgedAt, 10) || 0
        )
        if(!acceptedAt) return false
        const restoredAt = Number.parseInt(metadata?.liveTabRestoredAt, 10) || 0
        if(restoredAt > 0 &&
            acceptedAt >= restoredAt &&
            now - restoredAt <= QUEUED_TAB_UNCONFIRMED_ACTIVE_RECONCILE_MS * 3) {
            return false
        }

        const failedAt = Number.parseInt(metadata?.lastNudgeFailedAt, 10) || 0
        if(failedAt >= acceptedAt) {
            return now - failedAt >= QUEUED_TAB_CLAIM_NUDGE_TIMEOUT_ESCALATION_MS
        }

        return now - acceptedAt >= QUEUED_TAB_UNCONFIRMED_ACTIVE_RECONCILE_MS
    }

    function isQueuedTabLoadPressure(liveTab = null, record = null, metadata = null, now = getNow()) {
        if(hasActiveQueuedTabActionPhaseProgress(record, metadata)) return false
        if(`${liveTab?.status || ''}`.trim() === 'loading') return true
        if(Number.isFinite(metadata?.contentScriptEnsureFailedAt) && metadata.contentScriptEnsureFailedAt > 0) return true
        if(Number.isFinite(metadata?.lastNudgeFailedAt) && metadata.lastNudgeFailedAt > 0) return true
        if(hasStaleAcceptedQueuedTabNudge(metadata, record, now)) return true
        return false
    }

    function buildRetryQueuedTabAction(metadata = null, record = null, options = {}) {
        const url = normalizeTabTargetUrl(metadata?.profileHref || metadata?.requestedUrl || '')
        if(!url) return null
        if(metadata?.ownerTabId && queueRuntime.hasPausedQueuedOwner(metadata.ownerTabId)) return null

        const retryAttempt = getQueuedTabRetryAttempt(metadata, record)
        const maxRetries = getQueuedTabMaxRetries(metadata, record)
        const loadPressureRequeue = metadata?.loadPressureRequeue === true
        const forceRetryWhenExhausted = options.forceRetryWhenExhausted === true
        if(!loadPressureRequeue && retryAttempt >= maxRetries && !forceRetryWhenExhausted) return null
        const liveAdoptionLoadPressure = loadPressureRequeue &&
            (Number.parseInt(metadata?.liveTabAdoptedAt, 10) || 0) > 0 &&
            ((Number.parseInt(metadata?.lastNudgeFailedAt, 10) || 0) > 0 ||
                (Number.parseInt(metadata?.contentScriptEnsureFailedAt, 10) || 0) > 0 ||
                (Number.parseInt(metadata?.lastLoadPressureAt, 10) || 0) > 0)
        const sourceAttemptId = getAttemptIdFromValue(metadata) || getAttemptIdFromValue(record)
        const sourceAttemptNumber = getAttemptNumberFromValue(metadata) || getAttemptNumberFromValue(record)
        const attemptId = makeAttemptId()
        const attemptNumber = getNextAttemptNumberFromValue(metadata)
        const nextRetryAttempt = loadPressureRequeue ? retryAttempt : retryAttempt + 1
        const effectiveMaxRetries = forceRetryWhenExhausted
            ? Math.max(maxRetries, nextRetryAttempt + 1)
            : maxRetries

        return {
            url,
            profileHref: normalizeQuoraProfileUrl(metadata?.profileHref || '') || '',
            coordinatorKey: metadata?.coordinatorKey || '',
            requestedUrl: metadata?.requestedUrl || '',
            resolutionMode: metadata?.resolutionMode || '',
            resolveProfileFromPage: metadata?.resolveProfileFromPage === true,
            resolutionReason: metadata?.resolutionReason || '',
            candidateConfidence: metadata?.candidateConfidence || '',
            candidateCollector: metadata?.candidateCollector || '',
            tabAction: metadata?.tabAction || 'nuke',
            actionKind: metadata?.actionKind || '',
            runId: metadata?.runId || '',
            ownerTabId: metadata?.ownerTabId || null,
            ownerWindowId: metadata?.ownerWindowId || null,
            noForegroundFallback: !!metadata?.noForegroundFallback,
            retryAttempt: nextRetryAttempt,
            sourceAttemptId,
            sourceAttemptNumber,
            attemptId,
            attemptNumber,
            maxRetries: effectiveMaxRetries,
            loadPressureRequeue,
            actionLeaseReleaseReason: liveAdoptionLoadPressure
                ? 'queued-live-tab-adoption-load-pressure'
                : metadata?.actionLeaseReleaseReason || ''
        }
    }

    function getStaleRetryAdvanceKey(action = null) {
        const href = normalizeQuoraProfileUrl(action?.profileHref || action?.url || '')
        const coordinatorKey = action?.coordinatorKey || (href ? href : makeProfileResolutionQueueKey(action?.requestedUrl || action?.url || ''))
        const sourceAttemptId = getAttemptIdFromValue({
            attemptId: action?.sourceAttemptId || ''
        }) || getAttemptIdFromValue(action)
        const sourceAttemptNumber = Number.parseInt(action?.sourceAttemptNumber, 10) || getAttemptNumberFromValue(action)
        if(!href && !coordinatorKey) return ''
        return [
            href || coordinatorKey,
            sourceAttemptId || '',
            sourceAttemptNumber || 0
        ].join('|')
    }

    function pruneStaleRetryAdvancedWakeKeys(currentWakeSerial = getQueueWakeupMetricCycleSerial()) {
        for(const [key, wakeSerial] of staleRetryAdvancedWakeKeys.entries()) {
            if(wakeSerial !== currentWakeSerial) staleRetryAdvancedWakeKeys.delete(key)
        }
    }

    return {
        applyMissingActiveCoordinatorEvidenceReconcileActionLocked,
        shouldReconcileMissingActiveCoordinatorTab,
        makeMissingActiveCoordinatorProgressRecord,
        getQueuedTabRetryAttempt,
        getQueuedTabMaxRetries,
        hasStaleAcceptedQueuedTabNudge,
        isQueuedTabLoadPressure,
        buildRetryQueuedTabAction,
        getStaleRetryAdvanceKey,
        pruneStaleRetryAdvancedWakeKeys
    }
}

module.exports = {
    createQueuedTabRetryStaleReconcile
}
