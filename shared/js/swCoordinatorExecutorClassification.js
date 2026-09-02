// Coordinator executor-classification/runtime-surface helpers extracted
// from sw.js (decomposition Slice 26): getCoordinatorItemHref (127 external
// refs before this move -- the second-highest fan-in of anything claimed by
// any slice so far, after normalizeTabId's 207 in Slice 21),
// findCoordinatorQueueEntryForHref, getCoordinatorExecutorTabActionForActionKind,
// getCoordinatorActionKindForRequestedAction, getCoordinatorItemExecutorTabAction,
// getCoordinatorItemExecutorMaxConcurrent, getCoordinatorResumeMaxConcurrent,
// makeCoordinatorExecutorClassificationCase, getRuntimeSurfaceForCoordinatorItem.
//
// Construction-order note: this module constructs far earlier than this
// cluster's old source-text position (originally sw.js lines ~11945-12038),
// immediately before profileResolution near the top of the file.
// profileResolution (swProfileResolution.js) eagerly references bare
// `getCoordinatorItemHref` in its own construction-call handlers object
// literal -- the earliest of many such eager references across
// already-extracted modules for getCoordinatorItemHref (also coordinatorRuns,
// coordinatorTerminalSettlement, coordinatorProgressRules,
// coordinatorJobEnvelope, queuedRuntimeActionMatching, activationGuardRuntime,
// coordinatorSourceProvenance, coordinatorReconcileInputs,
// queuedTabRuntimeStatus, coordinatorContentQueueIndex,
// profileNukeProgressShape, coordinatorReconcileLockedMaterialization,
// rolledBackQueuedTabRetryClassification, and queuedActivationSubjectKeys,
// all constructed later but still well before this cluster's old position).
// getCoordinatorActionKindForRequestedAction and getCoordinatorItemExecutorTabAction
// are each independently referenced eagerly by several of those same later
// modules too (coordinatorJobEnvelope, queuedRuntimeActionMatching,
// activationGuardRuntime, queuedTabRuntimeStatus,
// rolledBackQueuedTabRetryClassification). A hoisted `function` declaration
// is visible throughout its enclosing scope; a `const` destructured from a
// factory call is in the temporal dead zone until that line executes -- so
// this module must construct before all of those eager references, which
// means before profileResolution, the earliest of them. sw.js destructures
// this module's exports back onto their original bare names (the same
// "destructure back to bare name" trick used by every prior high-fan-in
// slice, most recently normalizeTabId at 207 refs in Slice 21), so none of
// those construction call sites' literal source text needed to change --
// every one of them already used bare unrenamed shorthand.
//
// Forward-reference thunks: this module constructs before tabIdUtils,
// profileResolution's own destructure, and coordinatorAttemptIdentity, so
// four of its own dependencies aren't available as bare consts yet at its
// construction point: normalizeTabId (tabIdUtils), getCoordinatorItemQueueKey
// (profileResolution), and getAttemptIdFromValue/getAttemptNumberFromValue
// (coordinatorAttemptIdentity). Each is threaded through from sw.js as a
// thunk `(...args) => name(...args)` that defers name resolution to call
// time, matching the existing getTabObservedUrls/getStoredSpaceFeedRecordUrls
// precedent elsewhere in sw.js -- by the time any of this module's
// functions actually run (well after all of sw.js's module-level consts
// have been assigned), the real bare name is available.
// getPersistedQueuedTabId and getQueuedTabMetadata are still plain hoisted
// function declarations far below in sw.js -- hoisted declarations are
// visible throughout their enclosing scope regardless of textual position,
// so both are threaded through directly, no thunk needed.
//
// Clock/environment-global note: none of these nine functions read
// Date.now() or any other environment-faked global, so no `now` dep is
// needed.
//
// Mutable-state note: getCoordinatorResumeMaxConcurrent read the
// module-level `let queuedTabConcurrency` directly in sw.js, which is
// reassigned elsewhere in the reconcile core over time. A plain destructured
// value would snapshot it once at this module's construction time (still
// its initial value of 1), so it's threaded through as a live accessor,
// `getQueuedTabConcurrency: () => queuedTabConcurrency`, matching the
// `getQueueWakeupMetrics: () => queueWakeupMetrics`-style state-accessor
// convention already used earlier in sw.js.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`. None found -- all nine functions are
// plain synchronous data-in/data-out logic. getRuntimeSurfaceForCoordinatorItem
// calls queueRuntime.getRuntimeSurface (already-extracted swqueueRuntime.js,
// constructed at sw.js line 196, well before this module) -- a plain
// synchronous method call, not a Promise chain, so no realm-crossing
// concern there.

function createCoordinatorExecutorClassification(deps = {}) {
    const {
        queueRuntime,
        normalizeQuoraProfileUrl,
        getExecutorTabActionForActionKind,
        getActionKindForRequestedAction,
        getQueueItemExecutorTabAction,
        getPersistedQueuedTabId,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getCoordinatorItemQueueKey,
        getQueuedTabMetadata,
        normalizeTabId
    } = deps.handlers || {}
    const {
        getQueuedTabConcurrency
    } = deps.state || {}

    function getCoordinatorItemHref(item = {}) {
        return normalizeQuoraProfileUrl(item?.targetProfileHref || item?.requestedUrl || item?.dedupeKey || '')
    }

    function findCoordinatorQueueEntryForHref(queue = {}, href = '') {
        const normalizedHref = normalizeQuoraProfileUrl(href)
        if(!normalizedHref) return null

        if(queue?.[normalizedHref]) {
            return {
                key: normalizedHref,
                item: queue[normalizedHref]
            }
        }

        for(const [key, item] of Object.entries(queue || {})) {
            const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(key)
            if(itemHref !== normalizedHref) continue

            return {
                key,
                item
            }
        }

        return null
    }

    function getCoordinatorExecutorTabActionForActionKind(actionKind = '') {
        return getExecutorTabActionForActionKind(actionKind)
    }

    function getCoordinatorActionKindForRequestedAction(action = '') {
        return getActionKindForRequestedAction(action)
    }

    function getCoordinatorItemExecutorTabAction(item = {}, fallbackAction = '') {
        return getQueueItemExecutorTabAction(item, fallbackAction)
    }

    function getCoordinatorItemExecutorMaxConcurrent(item = {}) {
        const maxConcurrent = Number.parseInt(item?.executorMaxConcurrent, 10)
        return Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 0
    }

    function getCoordinatorResumeMaxConcurrent(items = []) {
        const values = (items || [])
            .map(getCoordinatorItemExecutorMaxConcurrent)
            .filter(value => value > 0)

        if(values.length) return Math.max(...values)
        return Math.max(1, getQueuedTabConcurrency() || 3)
    }

    function makeCoordinatorExecutorClassificationCase(caseName = '', rowKey = '', item = null, details = {}) {
        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(rowKey)
        const tabId = normalizeTabId(details.tabId ?? getPersistedQueuedTabId(item, details.record || null))
        return {
            case: `${caseName || ''}`.trim() || 'unknown',
            rowKey: `${rowKey || href || ''}`.trim(),
            status: `${item?.status || details.status || ''}`.trim(),
            tabId: tabId || null,
            attemptId: getAttemptIdFromValue(item) || getAttemptIdFromValue(details.record) || getAttemptIdFromValue(details.runtime) || '',
            attemptNumber: getAttemptNumberFromValue(item) || getAttemptNumberFromValue(details.record) || getAttemptNumberFromValue(details.runtime) || 0,
            reason: `${details.reason || caseName || ''}`.trim()
        }
    }

    function getRuntimeSurfaceForCoordinatorItem(item = null, itemKey = '', options = {}) {
        const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
        const allowAttemptMismatch = options.allowAttemptMismatch === true
        const matchesRuntime = runtime => {
            if(!runtime) return false
            const runtimeHref = normalizeQuoraProfileUrl(runtime.profileHref || runtime.targetUrl || runtime.requestedUrl || runtime.url || '')
            const runtimeCoordinatorKey = `${runtime.coordinatorKey || ''}`.trim()
            if(itemHref && runtimeHref && itemHref !== runtimeHref) return false
            if(coordinatorKey && runtimeCoordinatorKey && coordinatorKey !== runtimeCoordinatorKey) return false
            if(!allowAttemptMismatch) {
                const itemAttemptId = getAttemptIdFromValue(item)
                const runtimeAttemptId = getAttemptIdFromValue(runtime)
                if(itemAttemptId && runtimeAttemptId && itemAttemptId !== runtimeAttemptId) return false
                const itemAttemptNumber = getAttemptNumberFromValue(item)
                const runtimeAttemptNumber = getAttemptNumberFromValue(runtime)
                if(itemAttemptNumber && runtimeAttemptNumber && itemAttemptNumber !== runtimeAttemptNumber) return false
            }
            return !!(itemHref || coordinatorKey)
        }
        return queueRuntime.getRuntimeSurface({
            matchesRuntime,
            getMetadata: tabId => getQueuedTabMetadata(tabId) || {},
            getActivationTabId: action => normalizeTabId(action?.tabId || action?.createdTabId || action?.targetTabId)
        })
    }

    return {
        getCoordinatorItemHref,
        findCoordinatorQueueEntryForHref,
        getCoordinatorExecutorTabActionForActionKind,
        getCoordinatorActionKindForRequestedAction,
        getCoordinatorItemExecutorTabAction,
        getCoordinatorItemExecutorMaxConcurrent,
        getCoordinatorResumeMaxConcurrent,
        makeCoordinatorExecutorClassificationCase,
        getRuntimeSurfaceForCoordinatorItem
    }
}

module.exports = {
    createCoordinatorExecutorClassification
}
