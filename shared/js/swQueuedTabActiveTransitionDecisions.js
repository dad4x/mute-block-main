// Active-transition decide functions extracted from sw.js (decomposition
// Slices P2-1, P2-10, P2-11, P2-12): decideActiveTransitionOutcome,
// decideActiveTransitionMutation, decideFastActiveTransitionOutcome,
// decideActiveTransitionContinuationChoice,
// decideActiveTransitionReclaimedByDifferentAttempt.
//
// decideActiveTransitionOutcome and decideActiveTransitionMutation keep
// their original positional-arg signatures ((item, record, now, params = {})
// and (currentItem, context, params = {}) respectively) rather than being
// normalized to the params-object style the other three (and most of the
// rest of the codebase) use -- they predate that convention, and this is a
// behavior-preserving move, not a rewrite.
//
// All five are plain synchronous data-in/data-out functions -- no `async`,
// `.then(`, `.catch(`, `Promise.`, or `setTimeout` anywhere in their bodies
// -- so there is no Promise-chain realm-crossing concern. decideFastActiveTransitionOutcome
// and decideActiveTransitionContinuationChoice call `Date.now()` directly
// (matching their pre-move source); left as-is rather than threaded through
// an injected `now`, to keep the move purely textual.
//
// Every handler below was already a bare const in sw.js by this module's
// construction point (well before decideActiveTransitionOutcome's old
// source-text position, its earliest call site) -- see the construction
// call in sw.js for the ordering note.

function createQueuedTabActiveTransitionDecisions(deps = {}) {
    const {
        shouldApplyProgressToCoordinatorItem,
        isTerminalCoordinatorStatus,
        hasMismatchedCoordinatorAttempt,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getCoordinatorStatusFromProgress,
        transitionCoordinatorItemFromProgress,
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        getCoordinatorItemQueueKey,
        isSameActiveTransitionForCoordinatorItem,
        incrementQueueWakeupMetric,
        markQueuedTabDurablyActive,
        setQueuedTabMetadata,
        scheduleCoordinatorQueueResume,
        scheduleQueuedWorkContinuation,
        shouldKeepQueuedTabOpenAfterActiveTransitionFailure,
        normalizeTabId,
        isActiveCoordinatorStatus
    } = deps.handlers || {}

    function decideActiveTransitionOutcome(item, record, now, params = {}) {
        const {href, senderTabId} = params
        if(!item) return {outcome: 'reject', reason: 'missing-row'}
        if(!shouldApplyProgressToCoordinatorItem(item, record)) {
            return {outcome: 'reject', reason: 'action-kind-changed'}
        }
        if(isTerminalCoordinatorStatus(item.status)) {
            return {outcome: 'reject', reason: 'terminal-status'}
        }
        if(hasMismatchedCoordinatorAttempt(item, record)) {
            return {
                outcome: 'reject',
                reason: 'stale-attempt',
                diagnostic: {
                    profileHref: href,
                    incomingAttemptId: getAttemptIdFromValue(record),
                    expectedAttemptId: getAttemptIdFromValue(item),
                    senderTabId: senderTabId || null,
                    message: 'Ignored queued tab transition from stale attempt'
                }
            }
        }
        const currentAttemptId = getAttemptIdFromValue(item)
        const currentAttemptNumber = getAttemptNumberFromValue(item)
        const incomingAttemptId = getAttemptIdFromValue(record)
        const incomingAttemptNumber = getAttemptNumberFromValue(record)
        if((currentAttemptId && !incomingAttemptId) || (currentAttemptNumber && !incomingAttemptNumber)) {
            return {
                outcome: 'reject',
                reason: 'missing-attempt-identity',
                diagnostic: {
                    profileHref: href,
                    incomingAttemptId,
                    expectedAttemptId: currentAttemptId,
                    senderTabId: senderTabId || null,
                    message: 'Ignored queued tab transition without required attempt identity'
                }
            }
        }

        const mapped = getCoordinatorStatusFromProgress(record)
        if(!mapped.status) return {outcome: 'reject', reason: 'no-mapped-status'}

        const nextItem = transitionCoordinatorItemFromProgress(item, record, mapped, {
            now
        })
        if(JSON.stringify(nextItem) === JSON.stringify(item)) return {outcome: 'noop'}

        return {outcome: 'proceed', mapped, nextItem}
    }

    function decideActiveTransitionMutation(currentItem, context, params = {}) {
        const {
            record,
            mapped,
            now,
            incomingAttemptId,
            incomingAttemptNumber,
            itemHref,
            itemCoordinatorKey,
            itemKey,
            tabId
        } = params
        if(!currentItem || isTerminalCoordinatorStatus(currentItem.status)) {
            return context.reject('missing-or-terminal-row')
        }
        if(!shouldApplyProgressToCoordinatorItem(currentItem, record)) {
            return context.reject('action-kind-changed')
        }
        if(hasMismatchedCoordinatorAttempt(currentItem, record)) {
            return context.reject('stale-attempt', {staleAttempt: true})
        }
        if((getAttemptIdFromValue(currentItem) && !incomingAttemptId) ||
            (getAttemptNumberFromValue(currentItem) && !incomingAttemptNumber)) {
            return context.reject('missing-attempt-identity', {staleAttempt: true})
        }
        if((getCoordinatorItemHref(currentItem) || normalizeQuoraProfileUrl(itemKey)) !== itemHref ||
            getCoordinatorItemQueueKey(currentItem, itemKey) !== itemCoordinatorKey) {
            return context.reject('row-target-changed-before-authority-apply')
        }
        if(isSameActiveTransitionForCoordinatorItem(currentItem, record, tabId)) {
            incrementQueueWakeupMetric('coordinatorAuthority.activeTransition.duplicateSameTabNoop')
            return currentItem
        }
        const transitionedItem = transitionCoordinatorItemFromProgress(currentItem, record, mapped, {
            now
        })
        return transitionedItem
    }

    function decideFastActiveTransitionOutcome(params = {}) {
        const {activeTransitionAccepted, activeTransitionError, tab} = params
        if(activeTransitionAccepted) {
            markQueuedTabDurablyActive(tab.id, 'active-transition-fast-confirmed')
        }
        else {
            setQueuedTabMetadata(tab.id, {
                activeTransitionContinuedAt: Date.now(),
                activeTransitionError,
                activeTransitionUnconfirmedAt: Date.now(),
                activeTransitionUnconfirmedReason: 'fast-path-storage-lane-detached'
            })
            markQueuedTabDurablyActive(tab.id, 'active-transition-fast-detached')
            scheduleCoordinatorQueueResume(1000, 'active-transition-fast-detached', {
                allowBeforeQuora: true
            })
            scheduleQueuedWorkContinuation('active-transition-fast-detached')
        }
        return {
            activeTransitionAccepted,
            activeTransitionError,
            activeTransitionContinued: !activeTransitionAccepted,
            activeTransitionFastUnconfirmed: !activeTransitionAccepted,
            keepOpen: true,
            rolledBack: false
        }
    }

    function decideActiveTransitionContinuationChoice(params = {}) {
        const {activeTransitionAccepted, activeTransitionError, action, tab, plan} = params
        let activeTransitionContinued = false
        if(!activeTransitionAccepted) {
            activeTransitionContinued = shouldKeepQueuedTabOpenAfterActiveTransitionFailure(
                action,
                tab,
                plan.activeTransitionDetails || {}
            )
        }
        if(activeTransitionContinued) {
            setQueuedTabMetadata(tab.id, {
                activeTransitionContinuedAt: Date.now(),
                activeTransitionError
            })
            scheduleCoordinatorQueueResume(1000, 'active-transition-continued', {
                allowBeforeQuora: true
            })
        }
        return {activeTransitionContinued}
    }

    function decideActiveTransitionReclaimedByDifferentAttempt(params = {}) {
        const {currentAuthorityState, plan, action, tab} = params
        const profileHref = plan.profileHref || normalizeQuoraProfileUrl(action.profileHref || action.url || '')
        const coordinatorKey = plan.coordinatorKey || action.coordinatorKey || profileHref || ''
        const currentItem = coordinatorKey && currentAuthorityState?.queue?.[coordinatorKey]
            ? currentAuthorityState.queue[coordinatorKey]
            : profileHref
            ? currentAuthorityState?.queue?.[profileHref] || null
            : null
        const currentTabId = normalizeTabId(currentItem?.tabId || currentItem?.activeTabId || null)
        const expectedAttemptId = getAttemptIdFromValue(plan.activeTransitionDetails || {}) || getAttemptIdFromValue(action)
        const expectedAttemptNumber = getAttemptNumberFromValue(plan.activeTransitionDetails || {}) || getAttemptNumberFromValue(action)
        const currentAttemptId = getAttemptIdFromValue(currentItem)
        const currentAttemptNumber = getAttemptNumberFromValue(currentItem)
        const sameTabReclaimedByDifferentAttempt = currentItem &&
            isActiveCoordinatorStatus(currentItem.status) &&
            currentTabId &&
            currentTabId === normalizeTabId(tab?.id) &&
            ((expectedAttemptId && currentAttemptId && currentAttemptId !== expectedAttemptId) ||
                (expectedAttemptNumber && currentAttemptNumber && currentAttemptNumber !== expectedAttemptNumber))
        return {sameTabReclaimedByDifferentAttempt}
    }

    return {
        decideActiveTransitionOutcome,
        decideActiveTransitionMutation,
        decideFastActiveTransitionOutcome,
        decideActiveTransitionContinuationChoice,
        decideActiveTransitionReclaimedByDifferentAttempt
    }
}

module.exports = {createQueuedTabActiveTransitionDecisions}
