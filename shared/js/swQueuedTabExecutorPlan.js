// planQueuedTabExecutorAction extracted from sw.js (decomposition Part 2
// target #14, 2026-09-14): asks the open-decision predicate whether a
// planned queued-tab action is still allowed to open, records the decision
// to the flight recorder, kicks the resume/reconcile schedulers if the
// authority state wasn't available to decide, and hands off to
// markQueuedTabExecutorActionPlanned on approval.
//
// Construction-order note: not referenced eagerly by any module's own
// construction-call object literal (every call site found is a plain
// `await planQueuedTabExecutorAction(...)` inside a function body, not a
// deps.handlers object literal evaluated at module-eval time), so this
// module constructs in place, at this function's own former source-text
// position in sw.js. Every dependency is already a bare const or a plain
// hoisted `function` declaration by that point: promiseWithTimeout,
// scheduleCoordinatorQueueResume, and scheduleCoordinatorReconcile are
// hoisted `function` declarations (visible from anywhere in sw.js's scope
// regardless of textual position); recordFlightRecorderEvent
// (swflightRecorder.js), getAttemptIdFromValue/getAttemptNumberFromValue
// (coordinatorAttemptIdentity), shouldOpenQueuedTabAction (a later hoisted
// `async function` declaration in sw.js, likewise position-independent),
// and markQueuedTabExecutorActionPlanned (rolledBackQueuedTabRetryClassification,
// destructured immediately above this cluster's old position) are all
// already bare consts/functions in scope.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): the only `await` reaches into promiseWithTimeout (a plain
// dep, not a `.then()` chain) wrapping shouldOpenQueuedTabAction, and the
// final line is a plain `return markQueuedTabExecutorActionPlanned(...)`
// (also a plain dep call, no chain). No realm-crossing concern.

function createQueuedTabExecutorPlan(deps = {}) {
    const {
        promiseWithTimeout,
        shouldOpenQueuedTabAction,
        recordFlightRecorderEvent,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        scheduleCoordinatorQueueResume,
        scheduleCoordinatorReconcile,
        markQueuedTabExecutorActionPlanned
    } = deps.handlers || {}
    const {
        QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS
    } = deps.constants || {}

    async function planQueuedTabExecutorAction(action = {}, options = {}) {
        const openDecision = await promiseWithTimeout(
            shouldOpenQueuedTabAction(action, {
                currentAuthorityState: options.currentAuthorityState || options.authorityState || null
            }),
            QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,
            'queued tab open decision'
        ).catch(error => ({
            open: false,
            reason: 'open-decision-timeout',
            authorityUnavailable: true,
            error: error?.message || `${error || ''}`
        }))
        recordFlightRecorderEvent({
            kind: 'queued-tab-open-decision',
            source: 'planQueuedTabExecutorAction',
            rowKey: action.coordinatorKey || action.profileHref || action.targetProfileHref || action.url || '',
            targetUrl: action.profileHref || action.targetProfileHref || action.url || action.requestedUrl || '',
            attemptId: getAttemptIdFromValue(action),
            attemptNumber: getAttemptNumberFromValue(action),
            runId: action.runId || '',
            accepted: openDecision.open === true,
            reason: openDecision.reason || openDecision.error || 'open-decision'
        })
        if(openDecision.authorityUnavailable === true) {
            scheduleCoordinatorQueueResume(1000, 'queued-tab-open-decision-authority-unavailable', {
                allowBeforeQuora: true
            })
            scheduleCoordinatorReconcile(1000, {
                reason: 'queued-tab-open-decision-authority-unavailable',
                edgeTriggered: true,
                allowBeforeQuora: true
            })
        }
        if(!openDecision.open) return null

        return markQueuedTabExecutorActionPlanned(action, {
            ...openDecision,
            authorityValidated: !!(options.currentAuthorityState || options.authorityState),
            authorityState: options.currentAuthorityState || options.authorityState || null
        }, 'executor-apply-phase')
    }

    return {
        planQueuedTabExecutorAction
    }
}

module.exports = {
    createQueuedTabExecutorPlan
}
