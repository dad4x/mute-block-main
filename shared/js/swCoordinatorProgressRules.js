// Coordinator progress-application and Current-Work-retention rulebook
// extracted from sw.js (decomposition Slice 12, part 2 of 2). This is the
// rest of the plan's Slice 12 cluster -- everything except the six
// foundational status predicates that had to move separately into
// swCoordinatorStatusRules.js for TDZ construction-order reasons (see that
// file's header comment for the full writeup).
//
// This module cannot construct until after coordinatorAttemptIdentity
// exists in sw.js: getActiveCoordinatorDirectProgressRuntimeRejectionReason
// needs its getAttemptIdFromValue/getAttemptNumberFromValue exports, and
// incrementQueueWakeupMetric needs queueWakeupMetricsShape's export. Nothing
// already-extracted references any of this module's function names eagerly
// at sw.js module-eval time (checked every already-extracted module's
// construction-call object literal for all 15 names below, before line
// 3941 -- no hits), so this module has no eager dependents of its own to
// worry about; it just needs to construct after its own inputs are ready,
// which sw.js does right after coordinatorAttemptIdentity's destructure.
//
// Clock note: getActiveCoordinatorDirectProgressRuntimeRejectionReason,
// shouldKeepCoordinatorCurrentWorkItem, and pruneCoordinatorCurrentWork all
// read (or default-parameter-read) Date.now(); `now` is threaded through
// deps instead, per the plan's clock/environment-global note -- this
// matters even for the default-parameter case, since a default parameter
// expression evaluates in the defining function's own realm when the caller
// omits the argument.

function createCoordinatorProgressRules(deps = {}) {
    const {
        now
    } = deps
    const {
        mapProgressToCoordinatorState,
        normalizeTabId,
        isActiveCoordinatorStatus,
        isTerminalCoordinatorStatus,
        isCoordinatorQueueAuthoritativeItem,
        isPendingCoordinatorStatus,
        isRetryableCoordinatorFailure,
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        normalizeCoordinatorActionLease,
        queueRuntime,
        wasQueuedRuntimeTabRemoved,
        setQueuedTabMetadata,
        getQueuedTabMetadata,
        getCoordinatorItemQueueKey,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        incrementQueueWakeupMetric,
        getJobMilestonesFromProgress,
        getCoordinatorItemSettlementKey
    } = deps.handlers || {}
    const {
        CURRENT_WORK_RETENTION_MS
    } = deps.constants || {}

    function mergeCoordinatorSources(existingSources = [], incomingSources = []) {
        const seen = new Set()
        const merged = []

        for(const source of [...existingSources, ...incomingSources]) {
            if(!source || typeof source !== 'object') continue
            const key = [
                source.type || '',
                source.pageUrl || '',
                source.spaceKey || '',
                source.spaceCategory || ''
            ].join('|')
            if(seen.has(key)) continue
            seen.add(key)
            merged.push({
                type: source.type || '',
                pageUrl: source.pageUrl || '',
                spaceKey: source.spaceKey || '',
                spaceCategory: source.spaceCategory || ''
            })
        }

        return merged
    }

    function mergeCoordinatorEvidence(existingEvidence = [], incomingEvidence = []) {
        const seen = new Set()
        const merged = []

        for(const evidence of [...existingEvidence, ...incomingEvidence]) {
            if(!evidence || typeof evidence !== 'object') continue
            const key = [
                evidence.postKey || '',
                evidence.postUrl || '',
                evidence.collector || '',
                evidence.sourcePageUrl || ''
            ].join('|')
            if(seen.has(key)) continue
            seen.add(key)
            merged.push({
                postKey: evidence.postKey || '',
                postUrl: evidence.postUrl || '',
                collector: evidence.collector || '',
                confidence: evidence.confidence || '',
                source: evidence.source || '',
                rawSlug: evidence.rawSlug || '',
                resolutionReason: evidence.resolutionReason || '',
                sourcePageUrl: evidence.sourcePageUrl || ''
            })
        }

        return merged
    }

    function getCoordinatorStatusFromProgress(record = null) {
        const mapped = mapProgressToCoordinatorState(record)
        return {
            status: mapped.status || '',
            outcome: mapped.outcome || '',
            error: mapped.error || ''
        }
    }

    function progressPatchHasExplicitStatus(patch = {}) {
        return Object.prototype.hasOwnProperty.call(patch || {}, 'status') &&
            `${patch?.status || ''}`.trim() !== ''
    }

    function shouldApplyExplicitProgressStatusToCoordinatorItem(item = {}, patch = {}, options = {}) {
        if(!progressPatchHasExplicitStatus(patch)) return false

        const status = `${patch?.status || ''}`.trim()
        const senderTabId = normalizeTabId(options.senderTabId)
        if(options.requireActiveSenderTab === true) {
            const itemTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
            return !!senderTabId && isActiveCoordinatorStatus(item?.status || '') && itemTabId === senderTabId
        }

        if(status === 'interrupted' && senderTabId) {
            const itemTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
            return isActiveCoordinatorStatus(item?.status || '') && itemTabId === senderTabId
        }

        return true
    }

    function getActiveCoordinatorProgressSenderTabMismatchReason(item = {}, patch = {}, options = {}) {
        if(!item || !isActiveCoordinatorStatus(item?.status || '')) return ''

        const senderTabId = normalizeTabId(options.senderTabId || patch?.tabId || null)
        if(!senderTabId) return ''

        const lease = normalizeCoordinatorActionLease(item?.actionLease)
        const leaseTabId = normalizeTabId(lease?.tabId || null)
        if(leaseTabId && senderTabId !== leaseTabId) {
            return 'active-action-lease-sender-tab-mismatch'
        }

        const itemTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
        if(itemTabId && senderTabId !== itemTabId) {
            return 'active-sender-tab-mismatch'
        }

        return ''
    }

    function getActiveCoordinatorDirectProgressRuntimeRejectionReason(item = {}, patch = {}, mapped = {}, options = {}) {
        if(isTerminalCoordinatorStatus(mapped?.status)) return ''
        if(!item) return ''
        if(!isCoordinatorQueueAuthoritativeItem(item)) return ''

        const itemStatus = `${item?.status || ''}`.trim()
        if(itemStatus === 'queued' && isActiveCoordinatorStatus(mapped?.status || '')) {
            const releaseReason = `${item?.actionLeaseReleaseReason || ''}`.trim()
            const releaseAt = Number.parseInt(item?.actionLeaseReleasedAt, 10) || 0
            const milestones = item?.milestones || {}
            const closeAt = Math.max(
                Number.parseInt(milestones.closeRequestedAt, 10) || 0,
                Number.parseInt(milestones.tabClosedAt, 10) || 0
            )
            if(releaseReason || releaseAt || closeAt) {
                return 'queued-direct-progress-after-runtime-release'
            }
            return ''
        }
        if(!isActiveCoordinatorStatus(itemStatus)) return ''

        const senderTabId = normalizeTabId(options.senderTabId || patch?.tabId || null)
        const itemTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
        const tabId = senderTabId || itemTabId
        if(!tabId) return 'active-direct-progress-missing-runtime-tab'
        if(!queueRuntime.hasActiveQueuedTab(tabId)) {
            if(senderTabId && itemTabId && senderTabId === itemTabId &&
                !queueRuntime.hasPendingTabAction(tabId) &&
                !queueRuntime.hasQueuedTabMetadata(tabId)) {
                if(wasQueuedRuntimeTabRemoved(tabId)) return 'queued-tab-runtime-detached'
                queueRuntime.addActiveQueuedTab(tabId)
                setQueuedTabMetadata(tabId, {
                    profileHref: getCoordinatorItemHref(item) || item.profileHref || item.targetProfileHref || '',
                    coordinatorKey: getCoordinatorItemQueueKey(item),
                    requestedUrl: item.requestedUrl || item.targetProfileHref || '',
                    tabAction: item.executorTabAction || item.tabAction || 'nuke',
                    actionKind: item.actionKind || 'mute-block',
                    runId: item.runId || '',
                    attemptId: getAttemptIdFromValue(item),
                    attemptNumber: getAttemptNumberFromValue(item),
                    durableActiveAt: item.activeAt || now(),
                    durableActiveReason: 'direct-progress-runtime-restored'
                })
                incrementQueueWakeupMetric('directProgress.runtimeRestoredFromAuthority')
            }
            else {
                return 'queued-tab-runtime-detached'
            }
        }

        const metadata = getQueuedTabMetadata(tabId)
        if(!metadata) return 'queued-tab-metadata-missing'
        if(metadata?.closeRequestedAt || metadata?.closeReason) return 'queued-tab-closing'

        const metadataHref = normalizeQuoraProfileUrl(metadata.profileHref || metadata.targetProfileHref || '')
        const itemHref = normalizeQuoraProfileUrl(getCoordinatorItemHref(item) || item.profileHref || item.targetProfileHref || '')
        if(metadataHref && itemHref && metadataHref !== itemHref) {
            return 'queued-tab-metadata-profile-mismatch'
        }

        return ''
    }

    function getCoordinatorActionKindForProgress(record = null) {
        return record?.actionKind || 'mute-block'
    }

    function getCoordinatorActionKindForItem(item = null) {
        return item?.actionKind || 'mute-block'
    }

    function shouldApplyProgressToCoordinatorItem(item = null, record = null) {
        if(!item || !record) return false
        return getCoordinatorActionKindForItem(item) === getCoordinatorActionKindForProgress(record)
    }

    function getCoordinatorMilestonesFromProgress(record = {}) {
        return getJobMilestonesFromProgress(record)
    }

    function getCoordinatorCurrentWorkAnchor(item = {}) {
        return Number.parseInt(item?.terminalAt || item?.updatedAt || item?.createdAt, 10) || 0
    }

    function hasUnsettledCoordinatorSource(item = null) {
        const settlementKey = getCoordinatorItemSettlementKey(item)
        return !!settlementKey && item?.sourceSettlementKey !== settlementKey
    }

    function shouldKeepCoordinatorCurrentWorkItem(item = null, nowMs = now()) {
        if(!item || typeof item !== 'object') return false
        if(isPendingCoordinatorStatus(item.status)) return true
        if(isRetryableCoordinatorFailure(item)) return true
        if(!isTerminalCoordinatorStatus(item.status)) return true
        if(hasUnsettledCoordinatorSource(item)) return true

        const anchor = getCoordinatorCurrentWorkAnchor(item)
        return !anchor || nowMs - anchor <= CURRENT_WORK_RETENTION_MS
    }

    function pruneCoordinatorCurrentWork(queue = {}, nowMs = now()) {
        let changed = false

        for(const [key, item] of Object.entries(queue || {})) {
            if(shouldKeepCoordinatorCurrentWorkItem(item, nowMs)) continue
            delete queue[key]
            changed = true
        }

        return changed
    }

    return {
        mergeCoordinatorSources,
        mergeCoordinatorEvidence,
        getCoordinatorStatusFromProgress,
        progressPatchHasExplicitStatus,
        shouldApplyExplicitProgressStatusToCoordinatorItem,
        getActiveCoordinatorProgressSenderTabMismatchReason,
        getActiveCoordinatorDirectProgressRuntimeRejectionReason,
        getCoordinatorActionKindForProgress,
        getCoordinatorActionKindForItem,
        shouldApplyProgressToCoordinatorItem,
        getCoordinatorMilestonesFromProgress,
        getCoordinatorCurrentWorkAnchor,
        hasUnsettledCoordinatorSource,
        shouldKeepCoordinatorCurrentWorkItem,
        pruneCoordinatorCurrentWork
    }
}

module.exports = {
    createCoordinatorProgressRules
}
