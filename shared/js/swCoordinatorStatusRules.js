// Coordinator terminal/active/pending/retryable-status predicates extracted
// from sw.js (decomposition Slice 12, part 1 of 2). These six functions are
// the foundational status-classification leaves the whole reconcile core
// consults -- isTerminalCoordinatorStatus (132 external refs) and
// isActiveCoordinatorStatus (71 refs) in particular are used from nearly
// every reconcile decision point in the file.
//
// Split into its own module (rather than combined with the rest of Slice
// 12's cluster in swCoordinatorProgressRules.js) purely for TDZ construction-
// order reasons, matching the Slice 11 precedent (swCoordinatorAttemptIdentity.js
// / swCoordinatorJobEnvelope.js split): three already-extracted modules'
// construction call object literals reference isTerminalCoordinatorStatus
// and/or isCoordinatorQueueAuthoritativeItem and isActiveCoordinatorStatus
// eagerly at sw.js module-eval time, well before this cluster's old
// source-text position (~3941-4190):
//   - coordinatorAttemptIdentity (sw.js line ~571, the earliest) eagerly
//     references isCoordinatorQueueAuthoritativeItem and
//     isTerminalCoordinatorStatus.
//   - coordinatorJobEnvelope (line ~1324) eagerly references
//     isTerminalCoordinatorStatus.
//   - coordinatorReconcileInputs (line ~1451) eagerly references
//     isTerminalCoordinatorStatus and isActiveCoordinatorStatus.
//   - queuedTabRuntimeStatus (line ~1798) eagerly references
//     isActiveCoordinatorStatus.
// A hoisted `function` declaration is visible throughout its enclosing
// scope; a `const` destructured from a factory call is in the temporal dead
// zone until that line executes -- so this module must construct before all
// of those eager references, i.e. before coordinatorAttemptIdentity, the
// earliest one. These six predicates have no dependency on anything else in
// sw.js besides the already-required jobState.js exports, so they can
// construct anywhere before that point with no further ordering constraint.
//
// The rest of Slice 12's cluster (mergeCoordinatorSources through
// pruneCoordinatorCurrentWork) needs coordinatorAttemptIdentity's own
// exports (getAttemptIdFromValue/getAttemptNumberFromValue), so it cannot
// construct until after coordinatorAttemptIdentity exists -- the opposite
// constraint from this module. A single combined module would have had to
// satisfy both at once, which isn't possible without deferred-thunk tricks;
// see swCoordinatorProgressRules.js for that half.
//
// None of the six moved bodies read Date.now() or any other environment
// global, so this module needs no clock dependency.

function createCoordinatorStatusRules(deps = {}) {
    const {
        isTerminalJobStatus,
        isRetryableJobFailure,
        isRetryableJobFailureFromProgress
    } = deps.handlers || {}

    function isTerminalCoordinatorStatus(status) {
        return isTerminalJobStatus(status)
    }

    function isActiveCoordinatorStatus(status = '') {
        return ['opening', 'active', 'acting', 'settling'].includes(`${status || ''}`.trim())
    }

    function isPendingCoordinatorStatus(status = '') {
        return status === 'queued' || isActiveCoordinatorStatus(status)
    }

    function isRetryableCoordinatorFailure(item = null) {
        return isRetryableJobFailure(item)
    }

    function isRetryableCoordinatorFailureFromProgress(item = null, record = null) {
        return isRetryableJobFailureFromProgress(item, record)
    }

    function isCoordinatorQueueAuthoritativeItem(item = null) {
        return item?.serviceWorkerOwned === true ||
            `${item?.executorOwner || ''}` === 'service-worker'
    }

    return {
        isTerminalCoordinatorStatus,
        isActiveCoordinatorStatus,
        isPendingCoordinatorStatus,
        isRetryableCoordinatorFailure,
        isRetryableCoordinatorFailureFromProgress,
        isCoordinatorQueueAuthoritativeItem
    }
}

module.exports = {
    createCoordinatorStatusRules
}
