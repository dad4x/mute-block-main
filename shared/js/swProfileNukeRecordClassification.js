// Profile-nuke-progress-record classification predicates extracted from
// sw.js (decomposition Slice 33, part 2 of 2): isTerminalProfileNukeRecord,
// isSuccessfulProfileNukeRecord, isSuccessfulUnblockUnmuteProfileRecord,
// isRetryableTerminalProfileNukeRecord, isQueuedDirectBlockActionIncompleteProgress,
// shouldRecoverQueuedDirectBlockActionTerminalProgress,
// isQueuedProfileActionGateTimeoutProgress,
// shouldRecoverQueuedProfileActionGateTerminalProgress,
// isExplicitSecurityVerificationRecord, and isTransientProfileNukeStatus.
// This is the literal terminal/successful/retryable-record rulebook the
// progress-merge and reconcile-recovery paths consult -- similar value to
// Slice 12's coordinator-status rulebook, one level down (per-record status
// rather than per-coordinator-item status).
//
// Construction-order finding: isTransientProfileNukeStatus is eagerly
// referenced in coordinatorRuns's own construction-call `handlers` object
// literal (sw.js, well before this cluster's old source-text position of
// ~25114-25247), and isSuccessfulProfileNukeRecord/isExplicitSecurityVerificationRecord/
// isTerminalProfileNukeRecord/isRetryableTerminalProfileNukeRecord are all
// eagerly referenced the same way in coordinatorRetryCandidates's and
// profileProgressMerge's own construction-call handlers object literals,
// further below still but before this cluster's old position. A hoisted
// `function` declaration is visible throughout its enclosing scope; a
// `const` destructured from a factory call is in the temporal dead zone
// until that line executes -- so this module must construct before the
// earliest of those eager references, i.e. before coordinatorRuns. It
// constructs immediately after tabIdUtils's destructure in sw.js (needed
// for normalizeTabId, see below) and before coordinatorRuns.
//
// Dependencies: UNBLOCK_UNMUTE_ACTION_KIND (top-of-file jobState.js
// require) and isActiveCoordinatorStatus/isCoordinatorQueueAuthoritativeItem
// (coordinatorStatusRules) and normalizeTabId (tabIdUtils) are all already
// available as bare consts at this module's construction point, so they're
// threaded through directly. hasMismatchedCoordinatorAttempt
// (coordinatorAttemptIdentity) is *not* available yet at this point --
// coordinatorAttemptIdentity constructs later, itself after this module --
// so it's threaded through as a thunk, `(...args) =>
// hasMismatchedCoordinatorAttempt(...args)`, deferring name resolution to
// call time (matching the queuedTabOpenUrlCommitHelpers/coordinatorJobEnvelope
// precedent for the same situation).
//
// None of the ten moved bodies read Date.now() or any other environment
// global, and none builds or returns a Promise/.then() chain -- pure
// synchronous data-in/data-out predicates throughout -- so this module
// needs no clock dependency and carries no realm-crossing risk per
// architecture.md's Slice-7 refinement.

function createProfileNukeRecordClassification(deps = {}) {
    const {
        UNBLOCK_UNMUTE_ACTION_KIND
    } = deps.constants || {}
    const {
        isActiveCoordinatorStatus,
        isCoordinatorQueueAuthoritativeItem,
        hasMismatchedCoordinatorAttempt,
        normalizeTabId
    } = deps.handlers || {}

    function isTerminalProfileNukeRecord(record) {
        if(record?.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
            return isSuccessfulUnblockUnmuteProfileRecord(record) ||
                record.status === 'unblocked' ||
                record.status === 'already-unblocked' ||
                record.status === 'error' ||
                record.status === 'error-page' ||
                record.status === 'profile-unavailable' ||
                record.status === 'interrupted'
        }

        return !!record && (
            !!record.blockSucceeded ||
            record.status === 'blocked' ||
            record.status === 'already-blocked' ||
            record.status === 'error' ||
            record.status === 'error-page' ||
            record.status === 'profile-unavailable' ||
            record.status === 'interrupted'
        )
    }

    function isSuccessfulProfileNukeRecord(record) {
        if(record?.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
            return isSuccessfulUnblockUnmuteProfileRecord(record)
        }

        return !!record && (
            !!record.blockSucceeded ||
            record.status === 'blocked' ||
            record.status === 'already-blocked'
        )
    }

    function isSuccessfulUnblockUnmuteProfileRecord(record = null) {
        if(!record || record.actionKind !== UNBLOCK_UNMUTE_ACTION_KIND) return false
        if(record.unblockSucceeded || record.status === 'unblocked' || record.status === 'already-unblocked') return true

        const unblockReason = `${record.unblockReason || ''}`.trim()
        const unmuteReason = `${record.unmuteReason || ''}`.trim()
        return record.unblockOk === true &&
            record.unmuteOk === true &&
            /^(?:unblocked|already-unblocked|not-blocked|not-blocked-anymore)$/.test(unblockReason) &&
            !/error|failed|not-found/i.test(unmuteReason) &&
            !`${record.finalError || ''}`.trim()
    }

    function isRetryableTerminalProfileNukeRecord(record) {
        if(!isTerminalProfileNukeRecord(record)) return false
        if(isExplicitSecurityVerificationRecord(record)) return false

        const status = `${record?.status || ''}`.trim()
        if(status === 'interrupted') return true
        if(status === 'error') return true

        return false
    }

    function isQueuedDirectBlockActionIncompleteProgress(record = null, mapped = null) {
        if(!record || record.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) return false
        if(!isTerminalProfileNukeRecord(record)) return false
        const status = `${record.status || ''}`.trim()
        if(status !== 'error' && status !== 'interrupted') return false
        const errorText = `${mapped?.error || record.finalError || ''}`.trim()
        if(errorText !== 'Queued direct block action did not complete') return false

        const detailReason = `${record?.directBlockFailureDetail?.reason || record?.directBlockFailureDetail?.code || ''}`.trim()
        return !detailReason || detailReason === 'queued-direct-block-action-did-not-complete'
    }

    function shouldRecoverQueuedDirectBlockActionTerminalProgress(item = null, record = null, mapped = null, options = {}) {
        if(!item || !isActiveCoordinatorStatus(item?.status)) return false
        if(!isCoordinatorQueueAuthoritativeItem(item)) return false
        if(!isQueuedDirectBlockActionIncompleteProgress(record, mapped)) return false
        if(hasMismatchedCoordinatorAttempt(item, record)) return false
        if(record?.blockSucceeded === true || record?.status === 'blocked' || record?.status === 'already-blocked') return false

        const senderTabId = normalizeTabId(options.senderTabId || record?.tabId || null)
        const itemTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
        return !senderTabId || !itemTabId || senderTabId === itemTabId
    }

    function isQueuedProfileActionGateTimeoutProgress(record = null, mapped = null) {
        if(!record || record.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) return false
        if(!isTerminalProfileNukeRecord(record)) return false
        if(isExplicitSecurityVerificationRecord(record)) return false

        const status = `${record.status || ''}`.trim()
        if(status !== 'error' && status !== 'interrupted') return false

        const errorText = `${mapped?.error || record.finalError || ''}`.trim()
        return errorText === 'Queued profile action did not receive profile action gate: timed-out-waiting'
    }

    function shouldRecoverQueuedProfileActionGateTerminalProgress(item = null, record = null, mapped = null, options = {}) {
        if(!item || !isActiveCoordinatorStatus(item?.status)) return false
        if(!isCoordinatorQueueAuthoritativeItem(item)) return false
        if(!isQueuedProfileActionGateTimeoutProgress(record, mapped)) return false
        if(hasMismatchedCoordinatorAttempt(item, record)) return false
        if(record?.blockSucceeded === true || record?.status === 'blocked' || record?.status === 'already-blocked') return false

        const senderTabId = normalizeTabId(options.senderTabId || record?.tabId || null)
        const itemTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
        return !senderTabId || !itemTabId || senderTabId === itemTabId
    }

    function isExplicitSecurityVerificationRecord(record = null) {
        if(!record?.securityVerification) return false

        const text = [
            record.securityVerificationReason,
            record.finalError,
            record.errorPageUrl,
            record.lastUrl,
            ...(Array.isArray(record.events) ? record.events : [])
        ].join(' ')

        return /security verification|verify you are human|just a moment|performing security verification|challenge-platform|cdn-cgi|turnstile/i.test(text)
    }

    function isTransientProfileNukeStatus(status) {
        return new Set([
            'queued',
            'tab-opening',
            'tab-opened',
            'awaiting-visibility',
            'page-ready',
            'retrying',
            'muting',
            'blocking',
            'unmuting',
            'unblocking'
        ]).has(`${status || ''}`.trim())
    }

    return {
        isTerminalProfileNukeRecord,
        isSuccessfulProfileNukeRecord,
        isSuccessfulUnblockUnmuteProfileRecord,
        isRetryableTerminalProfileNukeRecord,
        isQueuedDirectBlockActionIncompleteProgress,
        shouldRecoverQueuedDirectBlockActionTerminalProgress,
        isQueuedProfileActionGateTimeoutProgress,
        shouldRecoverQueuedProfileActionGateTerminalProgress,
        isExplicitSecurityVerificationRecord,
        isTransientProfileNukeStatus
    }
}

module.exports = {
    createProfileNukeRecordClassification
}
