// Scattered isolated single-function support helpers extracted from sw.js
// (decomposition Slice 43, mop-up of remaining isolated singles): each of
// these eight functions sat alone in sw.js, surrounded by resident async
// reconcile/executor-apply/resume orchestration code, with no natural
// same-bucket neighbor a topically-scoped slice could claim it with. Rather
// than force each into an unrelated existing module or leave all eight
// resident, they're bundled into this one small catch-all module, per the
// plan's "mop-up" slice guidance (option (a): bundle thematically loose but
// individually safe singles into one small catch-all).
//
// getCoordinatorProgressInFlightKey: builds the coalescing key for
// in-flight progress-patch application (recordCoordinatorJobProgressViaQueueMachine,
// its one caller, stays resident in sw.js).
// isSameActiveTransitionForCoordinatorItem: predicate for whether an
// incoming progress record represents the same already-applied active
// transition as the current item/tabId.
// shouldKeepQueuedTabOpenAfterActiveTransitionFailure: predicate deciding
// whether a queued tab should stay open after its active-transition write
// failed to apply, based on the tab's live progress record.
// shouldSkipResumeProjectionFallbackForTrustedAuthority: a pure regex
// predicate over a resume reason string, no dependencies.
// getStorageUpdateQueueSnapshot: builds a diagnostics snapshot of the
// storage serialized-update-queue's current depth/timing/counters, for the
// dashboard's why-not-running surface.
// refreshAuthorityStateIfChanged: the re-fetch gate for
// coordinatorAuthority.current() -- centralizes "only re-clone the resident
// authority state after an operation actually reports a change."
// finishCoordinatorExecutorApplyResult: normalizes/records the final shape
// of a coordinator-executor-apply-phase result and records it into the
// lastCoordinatorExecutorApplyResult module state for the dashboard's
// why-not-running diagnostics.
// shouldPreemptFinalOpenAuthorityRetry: a pure regex/flag predicate over a
// resume reason string plus an explicit-preempt option flag.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. None found -- all eight functions are
// plain synchronous data-in/data-out (or data-in/state-write) logic, and
// none builds or returns a Promise chain reaching into another module.
//
// Clock note: getStorageUpdateQueueSnapshot and finishCoordinatorExecutorApplyResult
// read Date.now() directly, so a `now` clock dep is threaded through for
// both. The other six read no environment global.
//
// Ambient-state note: getCoordinatorProgressInFlightKey and
// shouldKeepQueuedTabOpenAfterActiveTransitionFailure read the module-level
// `profileNukeProgress` mutable state, threaded through as a
// `state.getProfileNukeProgress: () => profileNukeProgress` getter, matching
// the established precedent used throughout sw.js (e.g. swProfileNukeProgress.js,
// swProfileProgressMerge.js). refreshAuthorityStateIfChanged reads the
// module-level `coordinatorAuthority` singleton, threaded through as a
// `state.getCoordinatorAuthority: () => coordinatorAuthority` getter,
// matching the swQueuedTabMetadataAndActionLease.js precedent -- both
// getters are safe despite coordinatorAuthority/profileNukeProgress not
// existing yet at this module's construction point, since the arrow
// function bodies aren't evaluated until called at runtime, well after
// module-eval completes. getStorageUpdateQueueSnapshot reads the
// module-level `queueWakeupMetrics` mutable state the same way.
// finishCoordinatorExecutorApplyResult *writes* the module-level
// `lastCoordinatorExecutorApplyResult` state, threaded through as a
// `state.setLastCoordinatorExecutorApplyResult` setter callback, matching
// the existing `setProfileNukeProgress: value => { profileNukeProgress = value }`
// precedent.
//
// Construction-order note: each of these eight functions had exactly one
// external reference in sw.js (checked via grep), every one of them an
// ordinary runtime call inside a resident async function's body -- never
// inside another already-extracted module's own construction-call
// handlers/constants object literal. So none of them is needed before its
// own dependencies are ready, and this module constructs in sw.js right
// after coordinatorProgressReducer's destructure (the latest-constructing
// dependency any of these eight needs: getCoordinatorStatusFromProgress
// comes from coordinatorProgressRules, and getQueuedTabMetadata/
// isTerminalProfileNukeRecord/hasActiveQueuedTabActionPhaseProgress come
// from modules constructed even earlier) -- no thunk is needed for any
// dependency.

function createCoordinatorReconcileSupportSingles(deps = {}) {
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
    const {
        normalizeQuoraProfileUrl,
        normalizeProgressPatch,
        addSenderTabIdToProgressPatch,
        getCoordinatorStatusFromProgress,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        normalizeTabId,
        isActiveCoordinatorStatus,
        shouldApplyProgressToCoordinatorItem,
        hasMismatchedCoordinatorAttempt,
        getQueuedTabMetadata,
        isTerminalProfileNukeRecord,
        getCoordinatorActionKindForRequestedAction,
        hasActiveQueuedTabActionPhaseProgress,
        storageUpdateState,
        getActiveStorageContext
    } = deps.handlers || {}
    const {
        getProfileNukeProgress = () => ({}),
        getCoordinatorAuthority = () => null,
        getQueueWakeupMetrics = () => null,
        setLastCoordinatorExecutorApplyResult = () => {}
    } = deps.state || {}

    function getCoordinatorProgressInFlightKey(profileHref = '', patch = {}, options = {}) {
        const normalizedHref = normalizeQuoraProfileUrl(profileHref || patch?.profileHref || '')
        if(!normalizedHref) return ''

        const record = normalizeProgressPatch(
            normalizedHref,
            addSenderTabIdToProgressPatch(patch, options.senderTabId),
            getProfileNukeProgress()?.[normalizedHref] || {}
        )
        if(!record) return ''

        const mapped = getCoordinatorStatusFromProgress(record)
        if(!mapped.status) return ''

        return [
            normalizedHref,
            getAttemptIdFromValue(record) || '',
            getAttemptNumberFromValue(record) || 0,
            record.actionKind || '',
            mapped.status || '',
            mapped.outcome || '',
            mapped.error || ''
        ].join('|')
    }

    function isSameActiveTransitionForCoordinatorItem(item = null, record = null, tabId = null) {
        const normalizedTabId = normalizeTabId(tabId || record?.tabId || null)
        if(!item || !record || !normalizedTabId) return false
        if(!isActiveCoordinatorStatus(item.status)) return false
        if(normalizeTabId(item.tabId || item.activeTabId || null) !== normalizedTabId) return false
        if(!shouldApplyProgressToCoordinatorItem(item, record)) return false
        if(hasMismatchedCoordinatorAttempt(item, record)) return false

        const itemAttemptId = getAttemptIdFromValue(item)
        const recordAttemptId = getAttemptIdFromValue(record)
        if((itemAttemptId || recordAttemptId) &&
            (!itemAttemptId || !recordAttemptId || itemAttemptId !== recordAttemptId)) {
            return false
        }

        const itemAttemptNumber = getAttemptNumberFromValue(item)
        const recordAttemptNumber = getAttemptNumberFromValue(record)
        if((itemAttemptNumber || recordAttemptNumber) &&
            (!itemAttemptNumber || !recordAttemptNumber || itemAttemptNumber !== recordAttemptNumber)) {
            return false
        }

        return true
    }

    function shouldKeepQueuedTabOpenAfterActiveTransitionFailure(action = {}, tab = {}, details = {}) {
        const tabId = normalizeTabId(tab?.id)
        const profileHref = normalizeQuoraProfileUrl(
            action.profileHref ||
            action.targetProfileHref ||
            action.url ||
            ''
        )
        if(!tabId || !profileHref) return false

        const metadata = getQueuedTabMetadata(tabId)
        const record = getProfileNukeProgress()?.[profileHref] || null
        if(!record || isTerminalProfileNukeRecord(record)) return false

        const expectedAttempt = {
            status: 'active',
            actionKind: getCoordinatorActionKindForRequestedAction(action?.actionKind || action?.tabAction || ''),
            attemptId: details.attemptId || getAttemptIdFromValue(action),
            attemptNumber: Number.parseInt(details.attemptNumber, 10) || getAttemptNumberFromValue(action)
        }
        if(hasMismatchedCoordinatorAttempt(expectedAttempt, record)) return false

        return hasActiveQueuedTabActionPhaseProgress(record, metadata)
    }

    function shouldSkipResumeProjectionFallbackForTrustedAuthority(reason = '') {
        return /terminal-progress|terminal-job-progress|queued-tab-(?:slot-)?release|profile-tabs-without-active-authority|queued-tab-open-pre-runtime-tab-missing|resolved-(?:stale|terminal)-runtime/.test(`${reason || ''}`)
    }

    function getStorageUpdateQueueSnapshot() {
        const nowMs = now()
        const active = getActiveStorageContext() || null
        const counters = getQueueWakeupMetrics()?.currentEpoch?.counters || {}
        return {
            depth: storageUpdateState.getDepth(),
            active: !!active,
            currentReason: active?.reason || '',
            currentPhase: active?.currentPhase || '',
            currentStartedAt: Number.parseInt(active?.startedAt, 10) || 0,
            currentEnqueuedAt: Number.parseInt(active?.enqueuedAt, 10) || 0,
            currentRunMs: active?.startedAt ? nowMs - (Number.parseInt(active.startedAt, 10) || nowMs) : 0,
            oldestWaitMs: active?.enqueuedAt ? nowMs - (Number.parseInt(active.enqueuedAt, 10) || nowMs) : 0,
            timedOut: Number.parseInt(counters['storageUpdate.timedOut'], 10) || 0,
            fallbackReturned: Number.parseInt(counters['storageUpdate.fallbackReturned'], 10) || 0,
            abandoned: Number.parseInt(counters['storageUpdate.abandoned'], 10) || 0,
            timeoutBeforeStart: Number.parseInt(counters['storageUpdate.timeout.beforeStart'], 10) || 0,
            timeoutDuringStorageGet: Number.parseInt(counters['storageUpdate.timeout.duringStorageGet'], 10) || 0,
            queueWalSegmentStorageGetMs: Math.round(Number(active?.queueWalSegmentStorageGetMs) || 0),
            queueWalHydrateMs: Math.round(Number(active?.queueWalHydrateMs) || 0),
            queueWalAppendPrepareMs: Math.round(Number(active?.queueWalAppendPrepareMs) || 0),
            queueWalPhysicalPayloadMs: Math.round(Number(active?.queueWalPhysicalPayloadMs) || 0),
            queueWalStorageSetMs: Math.round(Number(active?.queueWalStorageSetMs) || 0),
            queueWalReplayVerifyMs: Math.round(Number(active?.queueWalReplayVerifyMs) || 0),
            queueProjectionBuildMs: Math.round(Number(active?.queueProjectionBuildMs) || 0),
            queueProjectionStorageSetMs: Math.round(Number(active?.queueProjectionStorageSetMs) || 0)
        }
    }

    function refreshAuthorityStateIfChanged(currentAuthorityState, shouldRefresh) {
        if(shouldRefresh !== true) return currentAuthorityState
        return getCoordinatorAuthority().current() || currentAuthorityState
    }

    function finishCoordinatorExecutorApplyResult(result = {}) {
        const unresolvedExecutorCases = Array.isArray(result?.unresolvedExecutorCases)
            ? result.unresolvedExecutorCases
            : []
        const unresolvedCaseKeys = new Set(unresolvedExecutorCases.map(item =>
            `${item?.case || ''}\n${item?.rowKey || ''}`
        ))
        const consumedExecutorCases = Array.isArray(result?.consumedExecutorCases)
            ? result.consumedExecutorCases.filter(item =>
                !unresolvedCaseKeys.has(`${item?.case || ''}\n${item?.rowKey || ''}`)
            )
            : []
        setLastCoordinatorExecutorApplyResult({
            generatedAt: now(),
            reason: result?.reason || '',
            changed: result?.changed === true,
            queued: Number.parseInt(result?.queued, 10) || 0,
            pending: Number.parseInt(result?.pending, 10) || 0,
            adopted: Number.parseInt(result?.adopted, 10) || 0,
            requeued: Number.parseInt(result?.requeued, 10) || 0,
            resolvedStaleRuntime: Number.parseInt(result?.resolvedStaleRuntime, 10) || 0,
            resolvedTerminalRuntime: Number.parseInt(result?.resolvedTerminalRuntime, 10) || 0,
            consumedExecutorCases,
            unresolvedExecutorCases,
            primaryUnresolvedCase: result?.primaryUnresolvedCase || null
        })
        return {
            ...result,
            consumedExecutorCases,
            unresolvedExecutorCases
        }
    }

    function shouldPreemptFinalOpenAuthorityRetry(reason = '', options = {}) {
        if(options.preemptFinalOpenAuthorityRetry === true) return true
        const normalizedReason = `${reason || ''}`
        return /terminal-progress|durable-(?:active|queued)-work|storage-idle-durable|active-missing-tab|active-transition|queued-tab-opened|slot-freed/.test(normalizedReason)
    }

    return {
        getCoordinatorProgressInFlightKey,
        isSameActiveTransitionForCoordinatorItem,
        shouldKeepQueuedTabOpenAfterActiveTransitionFailure,
        shouldSkipResumeProjectionFallbackForTrustedAuthority,
        getStorageUpdateQueueSnapshot,
        refreshAuthorityStateIfChanged,
        finishCoordinatorExecutorApplyResult,
        shouldPreemptFinalOpenAuthorityRetry
    }
}

module.exports = {
    createCoordinatorReconcileSupportSingles
}
