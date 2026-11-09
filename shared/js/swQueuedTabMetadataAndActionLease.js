// Queued-tab metadata + action-lease bookkeeping extracted from sw.js
// (decomposition Slice 31): getQueuedTabMetadata, wasQueuedRuntimeTabRemoved,
// setQueuedTabMetadata, remapQueuedTabToResolvedProfile,
// clearQueuedTabMetadata, normalizeCoordinatorActionLease,
// isCoordinatorActionLeaseExpired, isCoordinatorActionLeaseHolder,
// clearExpiredCoordinatorActionLeases, findActiveCoordinatorActionLease,
// makeCoordinatorActionLease, and findCoordinatorStoredWorkCancelTarget.
//
// Unlike Slice 5's activation-guard cluster (swActivationGuardRuntime.js),
// this module owns no Map of its own: the queued-tab-metadata Map already
// lives inside swqueueRuntime.js's createQueueRuntimeState() (a prior,
// independent extraction), and the coordinator-action-lease functions
// read/write leases stored inline on coordinator queue items (the `queue`
// object passed in by the caller at call time), not a private collection
// here. So every one of these 12 functions is a thin, stateless
// wrapper/predicate/builder over already-extracted state -- deps-only
// factory shape, matching swqueueRuntime.js/swQueueMachineHandlers.js/
// swCoordinatorQueueWal.js rather than Slice 5's state-owning shape.
//
// Construction-order finding: this module must construct before
// coordinatorExecutorClassification (decomposition Slice 26), the earliest
// of several already-extracted modules that eagerly reference bare
// `getQueuedTabMetadata` (and, further down, `setQueuedTabMetadata` /
// `normalizeCoordinatorActionLease` / `isCoordinatorActionLeaseExpired`) in
// their own construction-call handlers object literals
// (coordinatorExecutorClassification, queuedRuntimeActionMatching,
// coordinatorReconcileInputs, queuedTabRuntimeStatus,
// queuedActivationSubjectKeys, coordinatorProgressRules, swBootstrap's
// registerServiceWorkerListeners call, and
// createCoordinatorQueueMachineEventHandlers's construction for
// normalizeCoordinatorActionLease/isCoordinatorActionLeaseExpired). A
// hoisted `function` declaration is visible throughout its enclosing scope;
// a `const` destructured from a factory call is in the temporal dead zone
// until that line executes -- so this module is constructed immediately
// after coordinatorStatusRules and the top-of-file constant block, right
// before coordinatorExecutorClassification's construction, well ahead of
// this cluster's former source-text position.
//
// At that point in sw.js, queueRuntime, isActiveCoordinatorStatus,
// isTerminalCoordinatorStatus, normalizeQuoraProfileUrl (subject.js
// require), and the ACTION_LEASE_MS constant are already available as bare
// consts/values. normalizeTabId (tabIdUtils), normalizeAttemptId and
// getAttemptIdFromValue/getAttemptNumberFromValue
// (coordinatorAttemptIdentity), getCoordinatorActionKindForRequestedAction/
// getCoordinatorItemHref (both actually produced by
// coordinatorExecutorClassification itself, not available until after this
// module constructs), and normalizeCoordinatorRequestedUrl/
// getCoordinatorItemQueueKey (profileResolution) are not available yet at
// this point, so each is threaded through as a thunk that defers name
// resolution to call time, matching the coordinatorExecutorClassification/
// swProfileProgressMerge precedent for the same situation.
// coordinatorAuthority (createCoordinatorAuthority(), constructed much
// later) is threaded through as `state.getCoordinatorAuthority: () =>
// coordinatorAuthority`, matching the precedent already used by
// activationGuardRuntime and queuedRuntimeActionMatching, with the same
// defensive optional-chaining activationGuardRuntime uses since this
// module's own unit tests may supply no authority at all.
//
// Clock/environment-global note: isCoordinatorActionLeaseExpired,
// clearExpiredCoordinatorActionLeases, findActiveCoordinatorActionLease, and
// makeCoordinatorActionLease all read Date.now() via a `now = Date.now()`
// default parameter (not a bare in-body call) -- per the decomposition
// plan's clock/environment-global note, a default-parameter clock read
// resolves in this module's own V8 realm under the test harness's vm
// sandbox, so it's threaded through as `now = getNow()` where `getNow` is
// `deps.now` (or `() => Date.now()` if omitted), preserving every existing
// call site's ability to pass an explicit `now` argument instead (several
// do).
//
// Promise-chain realm-crossing scrutiny (architecture.md's Slice-7
// refinement): grepped every body for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, `void` -- zero hits across all twelve. Plain
// synchronous data-in/data-out wrappers, predicates, and builders.
//
// cloneCoordinatorAuthorityValue and the createCoordinatorAuthority-adjacent
// region, plus the queue-WAL async cluster, are explicitly out of
// scope for this decomposition effort (see the plan's "Boundary after
// Slice 17" section) and are untouched here.

function createQueuedTabMetadataAndActionLease(deps = {}) {
    const {
        queueRuntime,
        isActiveCoordinatorStatus,
        isTerminalCoordinatorStatus,
        normalizeQuoraProfileUrl,
        normalizeTabId,
        normalizeAttemptId,
        getCoordinatorActionKindForRequestedAction,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        normalizeCoordinatorRequestedUrl,
        getCoordinatorItemHref,
        getCoordinatorItemQueueKey
    } = deps.handlers || {}
    const {
        ACTION_LEASE_MS
    } = deps.constants || {}
    const {
        getCoordinatorAuthority = () => null
    } = deps.state || {}
    const getNow = typeof deps.now === 'function' ? deps.now : () => Date.now()

    function getQueuedTabMetadata(tabId) {
        return queueRuntime.getQueuedTabMetadata(tabId)
    }

    function wasQueuedRuntimeTabRemoved(tabId) {
        return queueRuntime.hasRemovedQueuedRuntimeTab(tabId)
    }

    function getRemovedQueuedRuntimeTabReason(tabId) {
        return queueRuntime.getRemovedQueuedRuntimeTabReason(tabId)
    }

    function setQueuedTabMetadata(tabId, metadata = {}) {
        if(!tabId) return
        if(wasQueuedRuntimeTabRemoved(tabId)) return
        if(
            !queueRuntime.hasActiveQueuedTab(tabId) &&
            !queueRuntime.hasQueuedTabMetadata(tabId) &&
            !queueRuntime.hasPendingTabAction(tabId)
        ) {
            const currentQueue = getCoordinatorAuthority()?.current?.()?.queue || {}
            const matchesActiveAuthority = Object.values(currentQueue).some(item =>
                isActiveCoordinatorStatus(item?.status) &&
                normalizeTabId(item?.tabId || item?.activeTabId || null) === normalizeTabId(tabId)
            )
            if(!matchesActiveAuthority) return
        }
        queueRuntime.patchQueuedTabMetadata(tabId, metadata)
    }

    function remapQueuedTabToResolvedProfile(tabId, item = {}, resolvedHref = '', requestedUrl = '') {
        if(!tabId || !resolvedHref) return

        const metadata = getQueuedTabMetadata(tabId) || {}
        const action = queueRuntime.getPendingTabAction(tabId)
        const nextRequestedUrl = normalizeCoordinatorRequestedUrl(
            requestedUrl || item.requestedUrl || metadata.requestedUrl || action?.requestedUrl || resolvedHref
        )
        const tabAction = metadata.tabAction || action?.action || item.tabAction || item.executorTabAction || 'nuke'
        const actionKind = metadata.actionKind ||
            action?.actionKind ||
            item.actionKind ||
            getCoordinatorActionKindForRequestedAction(tabAction)
        const attemptId = getAttemptIdFromValue(metadata) ||
            getAttemptIdFromValue(action) ||
            getAttemptIdFromValue(item)
        const attemptNumber = getAttemptNumberFromValue(metadata) ||
            getAttemptNumberFromValue(action) ||
            getAttemptNumberFromValue(item)

        setQueuedTabMetadata(tabId, {
            profileHref: resolvedHref,
            coordinatorKey: resolvedHref,
            requestedUrl: nextRequestedUrl,
            resolveProfileFromPage: false,
            resolutionMode: '',
            resolutionReason: '',
            tabAction,
            actionKind,
            attemptId,
            attemptNumber,
            lastUrl: resolvedHref
        })

        if(action) {
            queueRuntime.setPendingTabAction(tabId, {
                ...action,
                action: tabAction,
                targetUrl: resolvedHref,
                profileHref: resolvedHref,
                coordinatorKey: resolvedHref,
                requestedUrl: nextRequestedUrl,
                resolveProfileFromPage: false,
                resolutionMode: '',
                resolutionReason: '',
                actionKind,
                attemptId,
                attemptNumber
            })
        }
    }

    function clearQueuedTabMetadata(tabId) {
        if(!tabId) return
        queueRuntime.deleteQueuedTabMetadata(tabId)
    }

    function normalizeCoordinatorActionLease(lease = null) {
        if(!lease || typeof lease !== 'object') return null

        const tabId = normalizeTabId(lease.tabId || null)
        const attemptId = normalizeAttemptId(lease.attemptId || '')
        if(!tabId || !attemptId) return null

        const grantedAt = Number.parseInt(lease.grantedAt, 10) || 0
        const heartbeatAt = Number.parseInt(lease.heartbeatAt, 10) || grantedAt
        const expiresAt = Number.parseInt(lease.expiresAt, 10) || 0

        return {
            kind: `${lease.kind || 'profile-menu'}`.trim() || 'profile-menu',
            actionKind: getCoordinatorActionKindForRequestedAction(lease.actionKind || ''),
            profileHref: normalizeQuoraProfileUrl(lease.profileHref || ''),
            tabId,
            attemptId,
            attemptNumber: Number.parseInt(lease.attemptNumber, 10) || 0,
            grantedAt,
            heartbeatAt,
            expiresAt,
            reason: `${lease.reason || ''}`.trim()
        }
    }

    function isCoordinatorActionLeaseExpired(lease = null, now = getNow()) {
        const normalizedLease = normalizeCoordinatorActionLease(lease)
        if(!normalizedLease) return true
        return normalizedLease.expiresAt > 0 && now >= normalizedLease.expiresAt
    }

    function isCoordinatorActionLeaseHolder(lease = null, tabId = null, attemptId = '') {
        const normalizedLease = normalizeCoordinatorActionLease(lease)
        const normalizedTabId = normalizeTabId(tabId)
        const normalizedAttemptId = normalizeAttemptId(attemptId)

        return !!normalizedLease &&
            !!normalizedTabId &&
            !!normalizedAttemptId &&
            normalizedLease.tabId === normalizedTabId &&
            normalizedLease.attemptId === normalizedAttemptId
    }

    function clearExpiredCoordinatorActionLeases(queue = {}, now = getNow()) {
        let changed = false
        for(const [key, item] of Object.entries(queue || {})) {
            if(!item?.actionLease) continue
            if(!isTerminalCoordinatorStatus(item.status) && !isCoordinatorActionLeaseExpired(item.actionLease, now)) continue

            queue[key] = {
                ...item,
                actionLease: null,
                actionLeaseReleasedAt: now,
                actionLeaseReleaseReason: isTerminalCoordinatorStatus(item.status)
                    ? 'terminal-row'
                    : 'expired'
            }
            changed = true
        }

        return changed
    }

    function findActiveCoordinatorActionLease(queue = {}, now = getNow()) {
        for(const [key, item] of Object.entries(queue || {})) {
            if(!item || isTerminalCoordinatorStatus(item.status)) continue
            const lease = normalizeCoordinatorActionLease(item.actionLease)
            if(!lease || isCoordinatorActionLeaseExpired(lease, now)) continue

            return {
                key,
                item,
                lease
            }
        }

        return null
    }

    function makeCoordinatorActionLease(item = {}, request = {}, sender = {}, now = getNow()) {
        const tabId = normalizeTabId(sender.tab?.id || request.tabId || item.tabId || null)
        const attemptId = normalizeAttemptId(request.attemptId || getAttemptIdFromValue(item))
        if(!tabId || !attemptId) return null

        return {
            kind: 'profile-menu',
            actionKind: getCoordinatorActionKindForRequestedAction(request.actionKind || item.actionKind || ''),
            profileHref: getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(request.profileHref || ''),
            tabId,
            attemptId,
            attemptNumber: Number.parseInt(request.attemptNumber || getAttemptNumberFromValue(item), 10) || 0,
            grantedAt: now,
            heartbeatAt: now,
            expiresAt: now + ACTION_LEASE_MS,
            reason: `${request.reason || ''}`.trim()
        }
    }

    function findCoordinatorStoredWorkCancelTarget(queue = {}, operation = {}) {
        const targetStorageKey = `${operation.storageKey || ''}`.trim()
        const targetCoordinatorKey = `${operation.coordinatorKey || ''}`.trim()
        const targetHref = normalizeQuoraProfileUrl(operation.profileHref || '')
        if(!targetStorageKey && !targetCoordinatorKey && !targetHref) {
            return {entry: null, matches: [], reason: 'missing-current-work-item-target'}
        }

        const matches = []
        for(const [itemKey, item] of Object.entries(queue || {})) {
            if(!item || typeof item !== 'object') continue
            const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
            if(itemKey !== targetStorageKey &&
                itemKey !== targetCoordinatorKey &&
                href !== targetHref &&
                coordinatorKey !== targetCoordinatorKey &&
                coordinatorKey !== targetStorageKey) {
                continue
            }
            matches.push({itemKey, item, href, coordinatorKey})
        }

        if(matches.length !== 1) {
            return {
                entry: null,
                matches,
                reason: matches.length ? 'ambiguous-current-work-item-target' : 'missing-current-work-item-target'
            }
        }
        return {entry: matches[0], matches, reason: ''}
    }

    return {
        getQueuedTabMetadata,
        wasQueuedRuntimeTabRemoved,
        getRemovedQueuedRuntimeTabReason,
        setQueuedTabMetadata,
        remapQueuedTabToResolvedProfile,
        clearQueuedTabMetadata,
        normalizeCoordinatorActionLease,
        isCoordinatorActionLeaseExpired,
        isCoordinatorActionLeaseHolder,
        clearExpiredCoordinatorActionLeases,
        findActiveCoordinatorActionLease,
        makeCoordinatorActionLease,
        findCoordinatorStoredWorkCancelTarget
    }
}

module.exports = {
    createQueuedTabMetadataAndActionLease
}
