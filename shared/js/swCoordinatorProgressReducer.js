// Progress-to-coordinator-item transition/terminal-record reducer extracted
// from sw.js (decomposition Slice 17). This is the state-machine core that
// turns an incoming profile-progress record into the next coordinator queue
// item: the terminal-at/active-at timestamp getters, the reducer-event-type
// classifier, the projected-item builder, the reduced-item merger, the
// top-level transition entry point, the row-event persistence-worthiness
// predicate, the terminal-progress-record builder/drift/restore/redundancy
// predicates, and the successful-progress-over-terminal promotion path.
//
// All 14 functions here are plain synchronous functions with no `async`
// keyword and no Promise/`.then()`/`.catch()` chain in their bodies (grepped
// every body before moving, per architecture.md's "Module Extraction And
// The Test Harness Realm Boundary" section, "Refinement found during ...
// Slice 7" paragraph) -- none of them carry any realm-crossing risk in
// either direction.
//
// Clock note: getCoordinatorTransitionTerminalAt and
// getCoordinatorProgressActiveAt read Date.now() via a `now` default
// parameter, and buildProjectedCoordinatorItemFromProgress,
// transitionCoordinatorItemFromProgress, makeTerminalProgressRecordFromCoordinatorItem,
// and promoteTerminalCoordinatorItemFromSuccessfulProgress all read
// Date.now() directly or via an `options.now` fallback. Per the plan's
// clock/environment-global note, `now` is threaded through this module's
// deps as `() => Date.now()`. Because the clock dep is itself named `now`,
// the two functions whose own parameter was named `now` (and the three
// functions with a local `const now = ... || Date.now()`) have that
// parameter/local renamed to `nowMs` to avoid it shadowing the outer dep in
// its own default-value expression -- the same rename swCoordinatorRuns.js
// used for materializeCoordinatorRunsPausedStateFromControl. Every other use
// of the value inside those function bodies is renamed to match; this is a
// pure rename, not a logic change.
//
// Construction-order note: nothing already-extracted in sw.js eagerly
// references any of these 14 function names in its own construction-call
// object literal (checked via grep across every `create*(` call site's
// handlers/constants object literal in the whole file -- every other use of
// these 14 names is inside another function's body, called at runtime, not
// at module-eval time). This module's own inputs, though, come from four
// already-constructed modules: isTerminalCoordinatorStatus
// (coordinatorStatusRules), getAttemptIdFromValue/getAttemptNumberFromValue/
// hasMismatchedCoordinatorAttempt (coordinatorAttemptIdentity),
// makeEmptyCoordinatorMilestones (coordinatorRuns), and
// getCoordinatorMilestonesFromProgress/getCoordinatorStatusFromProgress/
// shouldApplyProgressToCoordinatorItem (coordinatorProgressRules) -- a
// `const` destructured from a factory call is in the temporal dead zone
// until that line executes, so this module constructs in sw.js right after
// coordinatorProgressRules's destructure, the latest of the four.
// getPersistedQueuedTabId, normalizeTabId, normalizeProgressPatch, and
// isSuccessfulProfileNukeRecord all stay in sw.js as plain hoisted function
// declarations (untouched by this slice, defined later in the file) and are
// threaded through as handler deps -- hoisted declarations are visible from
// anywhere in their enclosing scope regardless of textual position, so no
// TDZ concern on their side. reduceJobEvent, the JOB_EVENT_* constants, and
// UNBLOCK_UNMUTE_ACTION_KIND come straight from the jobState.js require at
// the top of sw.js and are available from the very first line.
//
// cloneCoordinatorAuthorityValue and the createCoordinatorAuthority-adjacent
// region immediately after this cluster's old source-text position are
// explicitly out of scope for this decomposition effort (see the plan's
// "Boundary after Slice 17" section) and are untouched here.
//
// buildTerminalCoordinatorQueueItem added in decomposition Slice 43 (retry
// of a Slice 28 leftover): Slice 28 left it resident in sw.js because its
// own dependency, buildCoordinatorFailureClassification, wasn't extracted
// yet (it landed in swExecutorEnqueueFailureClassification.js at Slice 25,
// but that module doesn't construct in sw.js until after line ~10818,
// while this module constructs at line ~1257 to satisfy queuedTabRuntimeStatus's
// and coordinatorReconcileLockedMaterialization's own eager references to
// buildTerminalCoordinatorQueueItem, both well before line 10818). Since a
// `const` destructured from a factory call is in the temporal dead zone
// until that line executes, buildCoordinatorFailureClassification is
// threaded through as a `(...args) => buildCoordinatorFailureClassification(...args)`
// thunk that defers name resolution to call time, matching the
// swQueuedTabMetadataAndActionLease.js precedent for the same situation.
// reduceJobEvent and JOB_EVENT_PAUSE/JOB_EVENT_TERMINAL (already a dep of
// this module) come straight from the jobState.js require at the top of
// sw.js and are available from the very first line, so no thunk is needed
// for those. buildTerminalCoordinatorQueueItem reads Date.now() via a local
// `const now = ... || Date.now()`; per the module's established convention
// (see the Clock note above) that local is renamed to `nowMs` and reads the
// module's own `now()` dep instead, matching every other function here that
// had the same shadowing issue. No async/Promise-chain risk: grepped for
// `.then(`, `.catch(`, `Promise.`, `async`, `setTimeout`, `void` -- none
// found.

function createCoordinatorProgressReducer(deps = {}) {
    const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
    const {
        JOB_EVENT_TERMINAL,
        JOB_EVENT_RETRY,
        JOB_EVENT_ENQUEUED,
        JOB_EVENT_TAB_OPENED,
        JOB_EVENT_MILESTONE,
        JOB_EVENT_PAUSE,
        UNBLOCK_UNMUTE_ACTION_KIND
    } = deps.constants || {}
    const {
        isTerminalCoordinatorStatus,
        getPersistedQueuedTabId,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        makeEmptyCoordinatorMilestones,
        getCoordinatorMilestonesFromProgress,
        reduceJobEvent,
        normalizeTabId,
        hasMismatchedCoordinatorAttempt,
        normalizeQuoraProfileUrl,
        normalizeProgressPatch,
        isSuccessfulProfileNukeRecord,
        getCoordinatorStatusFromProgress,
        shouldApplyProgressToCoordinatorItem,
        buildCoordinatorFailureClassification
    } = deps.handlers || {}

    function getCoordinatorTransitionTerminalAt(item = {}, record = {}, nowMs = now(), options = {}) {
        if(options.terminalAtFallback === 'record') {
            return Number.parseInt(record.terminalAt || record.tabClosedAt || record.updatedAt, 10) || item.terminalAt || nowMs
        }

        return Number.isFinite(record.terminalAt) && record.terminalAt > 0 ? record.terminalAt : nowMs
    }

    function getCoordinatorProgressReducerEventType(item = {}, mapped = {}, options = {}) {
        const status = `${mapped.status || ''}`.trim()
        if(isTerminalCoordinatorStatus(status)) return JOB_EVENT_TERMINAL
        if(status === 'queued') return options.resetRetry === true ? JOB_EVENT_RETRY : JOB_EVENT_ENQUEUED
        if(status === 'opening') return JOB_EVENT_TAB_OPENED
        return JOB_EVENT_MILESTONE
    }

    function getCoordinatorProgressRecordActiveAt(record = {}) {
        return Number.parseInt(
            record?.tabOpenedAt ||
            record?.tabCreatedAt ||
            record?.contentOpenedAt ||
            record?.navigationStartedAt,
            10
        ) || 0
    }

    function getCoordinatorProgressActiveAt(item = {}, record = {}, nowMs = now(), options = {}) {
        const recordActiveAt = getCoordinatorProgressRecordActiveAt(record)
        if(options.refreshActiveAt === true) return recordActiveAt || nowMs
        return Number.parseInt(item?.activeAt, 10) || recordActiveAt || nowMs
    }

    function buildProjectedCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {}) {
        const nowMs = Number.parseInt(options.now, 10) || now()
        const resetRetry = options.resetRetry === true
        const mappedTerminal = isTerminalCoordinatorStatus(mapped.status)
        const progressActiveAt = getCoordinatorProgressActiveAt(item, record, nowMs, {
            refreshActiveAt: options.refreshActiveAt === true
        })
        const terminalAt = mappedTerminal
            ? getCoordinatorTransitionTerminalAt(item, record, nowMs, options)
            : 0
        const terminalActiveAt = mappedTerminal
            ? Math.min(
                progressActiveAt || terminalAt || nowMs,
                terminalAt || progressActiveAt || nowMs
            )
            : progressActiveAt

        return {
            ...item,
            runId: resetRetry ? record.runId || item.runId : item.runId,
            status: mapped.status,
            outcome: mappedTerminal ? mapped.outcome || item.outcome || '' : '',
            error: mappedTerminal ? mapped.error || '' : '',
            updatedAt: Math.max(Number.parseInt(item.updatedAt, 10) || 0, Number.parseInt(record.updatedAt, 10) || 0, nowMs),
            queuedAt: resetRetry && mapped.status === 'queued'
                ? Number.parseInt(record.queuedAt, 10) || nowMs
                : item.queuedAt || 0,
            activeAt: mapped.status === 'active'
                ? (options.refreshActiveAt === true
                    ? progressActiveAt
                    : progressActiveAt)
                : resetRetry ? 0 : mappedTerminal ? terminalActiveAt : item.activeAt || 0,
            terminalAt,
            actionLease: mappedTerminal || resetRetry ? null : item.actionLease || null,
            actionLeaseReleasedAt: mappedTerminal
                ? nowMs
                : resetRetry ? 0 : item.actionLeaseReleasedAt || 0,
            actionLeaseReleaseReason: mappedTerminal
                ? 'terminal-progress'
                : resetRetry ? '' : item.actionLeaseReleaseReason || '',
            tabId: resetRetry ? null : (mapped.status === 'active' ? getPersistedQueuedTabId(item, record) : item.tabId || null),
            actionSurfaceMode: resetRetry ? '' : record.actionSurfaceMode || item.actionSurfaceMode || '',
            actionSurfaceWindowId: resetRetry ? null : record.actionSurfaceWindowId || item.actionSurfaceWindowId || null,
            actionSurfaceAnchorTabId: resetRetry ? null : record.actionSurfaceAnchorTabId || item.actionSurfaceAnchorTabId || null,
            actionSurfaceActivatedAt: resetRetry ? 0 : record.actionSurfaceActivatedAt || item.actionSurfaceActivatedAt || 0,
            attempt: resetRetry ? 0 : Number.parseInt(record.retryAttempt, 10) || item.attempt || 0,
            attemptId: resetRetry ? '' : getAttemptIdFromValue(record) || getAttemptIdFromValue(item),
            attemptNumber: resetRetry ? 0 : getAttemptNumberFromValue(record) || getAttemptNumberFromValue(item),
            retryAttempt: resetRetry
                ? Number.parseInt(record.retryAttempt, 10) || Number.parseInt(item.retryAttempt, 10) || 0
                : Number.parseInt(record.retryAttempt, 10) || Number.parseInt(item.retryAttempt, 10) || 0,
            maxRetries: resetRetry
                ? Number.parseInt(record.maxRetries, 10) || Number.parseInt(item.maxRetries, 10) || 0
                : Number.parseInt(record.maxRetries, 10) || Number.parseInt(item.maxRetries, 10) || 0,
            maxAttempts: (Number.parseInt(record.maxRetries, 10) || 0) + 1 || item.maxAttempts || 1,
            milestones: resetRetry ? {
                ...makeEmptyCoordinatorMilestones(),
                ...getCoordinatorMilestonesFromProgress(record)
            } : {
                ...(item.milestones || {}),
                ...getCoordinatorMilestonesFromProgress(record)
            }
        }
    }

    function mergeReducedCoordinatorProgressItem(item = {}, reducedItem = {}, projectedItem = {}, mapped = {}, record = {}, options = {}) {
        const status = `${mapped.status || ''}`.trim()
        const resetRetry = options.resetRetry === true
        const mappedTerminal = isTerminalCoordinatorStatus(status)

        return {
            ...projectedItem,
            status: reducedItem.status,
            outcome: mappedTerminal ? reducedItem.outcome || projectedItem.outcome || '' : '',
            error: mappedTerminal ? reducedItem.error || projectedItem.error || '' : '',
            updatedAt: Math.max(
                Number.parseInt(reducedItem.updatedAt, 10) || 0,
                Number.parseInt(projectedItem.updatedAt, 10) || 0
            ),
            queuedAt: status === 'queued' ? reducedItem.queuedAt || projectedItem.queuedAt || 0 : projectedItem.queuedAt || 0,
            activeAt: status === 'active' || status === 'acting' || status === 'settling'
                ? projectedItem.activeAt || reducedItem.activeAt || 0
                : resetRetry ? 0 : projectedItem.activeAt || reducedItem.activeAt || 0,
            terminalAt: mappedTerminal ? reducedItem.terminalAt || projectedItem.terminalAt || 0 : 0,
            tabId: mappedTerminal || resetRetry ? null : projectedItem.tabId ?? reducedItem.tabId ?? null,
            actionSurfaceMode: resetRetry ? '' : projectedItem.actionSurfaceMode || reducedItem.actionSurfaceMode || '',
            actionSurfaceWindowId: resetRetry ? null : projectedItem.actionSurfaceWindowId || reducedItem.actionSurfaceWindowId || null,
            actionSurfaceAnchorTabId: resetRetry ? null : projectedItem.actionSurfaceAnchorTabId || reducedItem.actionSurfaceAnchorTabId || null,
            actionSurfaceActivatedAt: resetRetry ? 0 : projectedItem.actionSurfaceActivatedAt || reducedItem.actionSurfaceActivatedAt || 0,
            actionLease: mappedTerminal || resetRetry ? null : reducedItem.actionLease || projectedItem.actionLease || null,
            actionLeaseReleasedAt: mappedTerminal
                ? reducedItem.actionLeaseReleasedAt || projectedItem.actionLeaseReleasedAt || 0
                : resetRetry ? 0 : reducedItem.actionLeaseReleasedAt || projectedItem.actionLeaseReleasedAt || 0,
            actionLeaseReleaseReason: mappedTerminal || resetRetry
                ? reducedItem.actionLeaseReleaseReason || projectedItem.actionLeaseReleaseReason || ''
                : projectedItem.actionLeaseReleaseReason || '',
            attemptId: resetRetry ? reducedItem.attemptId || projectedItem.attemptId || '' : reducedItem.attemptId || projectedItem.attemptId || '',
            attemptNumber: resetRetry ? reducedItem.attemptNumber || projectedItem.attemptNumber || 0 : reducedItem.attemptNumber || projectedItem.attemptNumber || 0,
            milestones: {
                ...makeEmptyCoordinatorMilestones(),
                ...(item.milestones || {}),
                ...(reducedItem.milestones || {}),
                ...getCoordinatorMilestonesFromProgress(record)
            }
        }
    }

    function transitionCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {}) {
        const nowMs = Number.parseInt(options.now, 10) || now()
        const resetRetry = options.resetRetry === true
        const status = `${mapped.status || ''}`.trim()
        const mappedTerminal = isTerminalCoordinatorStatus(status)
        const projectedItem = buildProjectedCoordinatorItemFromProgress(item, record, mapped, {
            ...options,
            now: nowMs
        })
        const reducerEventBase = {
            type: getCoordinatorProgressReducerEventType(item, mapped, options),
            status: mapped.status,
            outcome: mapped.outcome || '',
            error: mapped.error || '',
            at: nowMs,
            terminalAt: mappedTerminal
                ? getCoordinatorTransitionTerminalAt(item, record, nowMs, options)
                : 0,
            tabId: getPersistedQueuedTabId(item, record) || null,
            attemptId: getAttemptIdFromValue(record) || getAttemptIdFromValue(item),
            attemptNumber: getAttemptNumberFromValue(record) || getAttemptNumberFromValue(item),
            retryCount: resetRetry
                ? Number.parseInt(record.retryAttempt, 10) || item.retryCount || 0
                : item.retryCount || 0,
            lastRetryAt: resetRetry ? nowMs : item.lastRetryAt || 0,
            reason: mappedTerminal ? 'terminal-progress' : '',
            milestones: getCoordinatorMilestonesFromProgress(record)
        }
        let reducerItem = item

        if(resetRetry && isTerminalCoordinatorStatus(item.status) && mapped.status !== 'queued') {
            const retryResult = reduceJobEvent(item, {
                ...reducerEventBase,
                type: JOB_EVENT_RETRY,
                status: 'queued',
                outcome: '',
                error: '',
                terminalAt: 0,
                reason: '',
                retryCount: item.retryCount || 0
            })
            if(!retryResult.accepted) return projectedItem
            reducerItem = retryResult.item
        }

        const reduced = reduceJobEvent(reducerItem, reducerEventBase)
        if(!reduced.accepted) {
            const previousTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
            const nextTabId = normalizeTabId(projectedItem?.tabId || projectedItem?.activeTabId || null)
            if(!resetRetry &&
                !mappedTerminal &&
                status === 'active' &&
                previousTabId &&
                nextTabId &&
                previousTabId !== nextTabId &&
                !hasMismatchedCoordinatorAttempt(item, record)) {
                return projectedItem
            }
            if(shouldPreferSuccessfulProgressOverTerminalCoordinatorItem(item, record, mapped)) {
                return promoteTerminalCoordinatorItemFromSuccessfulProgress(item, record, mapped, {
                    ...options,
                    now: nowMs
                })
            }
            if(mappedTerminal) {
                return projectedItem
            }
            return resetRetry ? projectedItem : item
        }

        return mergeReducedCoordinatorProgressItem(item, reduced.item, projectedItem, mapped, record, {
            ...options,
            now: nowMs
        })
    }

    function shouldPersistCoordinatorRowEventQueueItemChange(item = {}, nextItem = {}, mapped = {}) {
        if(!nextItem || nextItem === item) return false
        if(isTerminalCoordinatorStatus(mapped?.status) || isTerminalCoordinatorStatus(nextItem?.status)) return true

        const previousStatus = `${item?.status || ''}`.trim()
        const nextStatus = `${nextItem?.status || ''}`.trim()
        if(previousStatus !== nextStatus) return true

        if(normalizeTabId(item?.tabId || item?.activeTabId || null) !== normalizeTabId(nextItem?.tabId || nextItem?.activeTabId || null)) {
            return true
        }
        if(getAttemptIdFromValue(item) !== getAttemptIdFromValue(nextItem)) return true
        if(getAttemptNumberFromValue(item) !== getAttemptNumberFromValue(nextItem)) return true

        const durableFields = [
            'activeAt',
            'terminalAt',
            'actionLease',
            'actionLeaseReleasedAt',
            'actionLeaseReleaseReason',
            'outcome',
            'error'
        ]
        return durableFields.some(field => JSON.stringify(item?.[field] ?? null) !== JSON.stringify(nextItem?.[field] ?? null))
    }

    function makeTerminalProgressRecordFromCoordinatorItem(href = '', item = {}, previous = {}, reason = '', options = {}) {
        const previousRecord = previous && typeof previous === 'object' ? previous : {}
        const normalizedHref = normalizeQuoraProfileUrl(href || item?.targetProfileHref || previousRecord.profileHref || '')
        if(!normalizedHref || !isTerminalCoordinatorStatus(item?.status)) return null

        const actionKind = item.actionKind || previousRecord.actionKind || 'mute-block'
        const outcome = `${item.outcome || ''}`.trim()
        const patch = {
            actionKind,
            attemptId: getAttemptIdFromValue(item) || getAttemptIdFromValue(previousRecord),
            attemptNumber: getAttemptNumberFromValue(item) || getAttemptNumberFromValue(previousRecord),
            runId: item.runId || previousRecord.runId || '',
            tabId: getPersistedQueuedTabId(item, previousRecord) || null,
            terminalAt: Number.parseInt(item.terminalAt || previousRecord.terminalAt, 10) || now(),
            finalError: item.error || previousRecord.finalError || '',
            event: reason || 'Restored terminal profile progress from coordinator row',
            replaceProgressRecord: options.replaceProgressRecord === true
        }

        if(item.status === 'succeeded' && actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
            Object.assign(patch, {
                status: outcome === 'already-unblocked' ? 'already-unblocked' : 'unblocked',
                unblockSucceeded: true,
                unblockedAt: Number.parseInt(item.terminalAt || previousRecord.unblockedAt, 10) || now(),
                finalError: ''
            })
        }
        else if(item.status === 'succeeded') {
            Object.assign(patch, {
                status: outcome === 'blocked' ? 'blocked' : 'already-blocked',
                blockSucceeded: true,
                foundBlockedBeforeQueue: outcome !== 'blocked',
                blockedAt: Number.parseInt(item.terminalAt || previousRecord.blockedAt, 10) || now(),
                finalError: ''
            })
        }
        else if(item.status === 'skipped') {
            Object.assign(patch, {
                status: 'profile-unavailable',
                unavailableReason: item.error || previousRecord.unavailableReason || 'Profile unavailable',
                lastUrl: previousRecord.lastUrl || '',
                resolvedProfileHref: previousRecord.resolvedProfileHref || '',
                remappedFromRequested: previousRecord.remappedFromRequested === true
            })
        }
        else {
            Object.assign(patch, {
                status: outcome === 'error-page' ? 'error-page' : 'interrupted',
                finalError: item.error || previousRecord.finalError || 'Coordinator job reached terminal failure'
            })
        }

        return normalizeProgressPatch(normalizedHref, patch, previousRecord)
    }

    function hasTerminalProgressDriftFromCoordinatorItem(item = null, record = null) {
        if(!item || !record || !isTerminalCoordinatorStatus(item?.status)) return false

        const actionKind = item.actionKind || record.actionKind || 'mute-block'
        const outcome = `${item.outcome || ''}`.trim()
        const recordStatus = `${record.status || ''}`.trim()
        const expectedError = item.status === 'succeeded' ? '' : `${item.error || ''}`.trim()
        const recordError = `${record.finalError || ''}`.trim()

        if(actionKind !== (record.actionKind || actionKind)) return true
        if(getAttemptIdFromValue(item) && getAttemptIdFromValue(record) && getAttemptIdFromValue(item) !== getAttemptIdFromValue(record)) return false

        if(item.status === 'succeeded' && actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
            const expectedStatus = outcome === 'already-unblocked' ? 'already-unblocked' : 'unblocked'
            return recordStatus !== expectedStatus ||
                record.unblockSucceeded !== true ||
                !!recordError
        }

        if(item.status === 'succeeded') {
            const expectedStatus = outcome === 'blocked' ? 'blocked' : 'already-blocked'
            return recordStatus !== expectedStatus ||
                record.blockSucceeded !== true ||
                !!recordError
        }

        if(item.status === 'skipped') {
            return recordStatus !== 'profile-unavailable'
        }

        const expectedStatus = outcome === 'error-page' ? 'error-page' : 'interrupted'
        return recordStatus !== expectedStatus ||
            (expectedError && recordError !== expectedError)
    }

    function shouldRestoreTerminalProgressFromCoordinatorItem(item = null, record = null) {
        if(!item || !isTerminalCoordinatorStatus(item?.status)) return false
        if(!record) return true

        const mapped = getCoordinatorStatusFromProgress(record)
        if(shouldPreferSuccessfulProgressOverTerminalCoordinatorItem(item, record, mapped)) return false
        if(!isTerminalCoordinatorStatus(mapped.status)) return true

        return mapped.status !== item.status || hasTerminalProgressDriftFromCoordinatorItem(item, record)
    }

    function shouldPreferSuccessfulProgressOverTerminalCoordinatorItem(item = null, record = null, mapped = null) {
        const itemStatus = `${item?.status || ''}`.trim()
        if(!item || !record || !isTerminalCoordinatorStatus(itemStatus) || itemStatus === 'succeeded') return false
        const itemOutcome = `${item.outcome || ''}`.trim()
        if(itemStatus === 'skipped' && (
            itemOutcome === 'profile-redirect-mismatch' ||
            itemOutcome === 'non-profile-target'
        )) {
            return false
        }

        const effectiveMapped = mapped || getCoordinatorStatusFromProgress(record)
        if(effectiveMapped.status !== 'succeeded') return false
        if(!isSuccessfulProfileNukeRecord(record)) return false
        if(!shouldApplyProgressToCoordinatorItem(item, record)) return false
        if(hasMismatchedCoordinatorAttempt(item, record)) return false

        return true
    }

    function isRedundantTerminalProgressForCoordinatorItem(item = null, record = null, mapped = null) {
        const itemStatus = `${item?.status || ''}`.trim()
        if(!item || !record || !isTerminalCoordinatorStatus(itemStatus)) return false

        const effectiveMapped = mapped || getCoordinatorStatusFromProgress(record)
        if(!isTerminalCoordinatorStatus(effectiveMapped.status)) return false
        if(effectiveMapped.status !== itemStatus) return false
        if(shouldPreferSuccessfulProgressOverTerminalCoordinatorItem(item, record, effectiveMapped)) return false
        if(hasMismatchedCoordinatorAttempt(item, record)) return false

        const mappedOutcome = `${effectiveMapped.outcome || ''}`.trim()
        const mappedError = `${effectiveMapped.error || ''}`.trim()
        const itemOutcome = `${item.outcome || ''}`.trim()
        const itemError = `${item.error || ''}`.trim()
        if(mappedOutcome !== itemOutcome) return false
        if(mappedError !== itemError) return false

        return true
    }

    function promoteTerminalCoordinatorItemFromSuccessfulProgress(item = {}, record = {}, mapped = {}, options = {}) {
        const nowMs = Number.parseInt(options.now, 10) || now()
        const terminalAt = getCoordinatorTransitionTerminalAt(item, record, nowMs, options)
        const nextItem = buildProjectedCoordinatorItemFromProgress(item, record, mapped, {
            ...options,
            now: nowMs
        })

        return {
            ...nextItem,
            status: 'succeeded',
            outcome: mapped.outcome || nextItem.outcome || 'blocked',
            error: '',
            updatedAt: Math.max(Number.parseInt(nextItem.updatedAt, 10) || 0, nowMs),
            terminalAt,
            tabId: null,
            actionLease: null,
            actionLeaseReleasedAt: nowMs,
            actionLeaseReleaseReason: 'terminal-success-reconcile',
            milestones: {
                ...makeEmptyCoordinatorMilestones(),
                ...(item.milestones || {}),
                ...getCoordinatorMilestonesFromProgress(record),
                tabClosedAt: Number.parseInt(record.tabClosedAt || record.terminalAt, 10) ||
                    Number.parseInt(item?.milestones?.tabClosedAt, 10) ||
                    terminalAt
            }
        }
    }

    function buildTerminalCoordinatorQueueItem(item = {}, options = {}) {
        const nowMs = Number.parseInt(options.now, 10) || now()
        const status = `${options.status || 'failed'}`.trim()
        const reason = `${options.reason || ''}`.trim()
        const explicitFailureClassification = options.failureClassification &&
            typeof options.failureClassification === 'object'
            ? options.failureClassification
            : null
        const failureClassification = explicitFailureClassification ||
            buildCoordinatorFailureClassification(
                reason,
                options.error || (status === 'canceled' ? 'Paused by user' : 'Queued tab closed before reaching a terminal state')
            )
        const eventType = options.eventType ||
            (status === 'canceled' ? JOB_EVENT_PAUSE : JOB_EVENT_TERMINAL)
        const reduced = reduceJobEvent(item, {
            type: eventType,
            status,
            outcome: options.outcome || (status === 'canceled' ? 'paused' : 'timeout'),
            error: options.error || (status === 'canceled' ? 'Paused by user' : 'Queued tab closed before reaching a terminal state'),
            at: nowMs,
            terminalAt: nowMs,
            reason,
            milestones: {
                closeRequestedAt: Number.parseInt(item?.milestones?.closeRequestedAt, 10) || nowMs,
                tabClosedAt: nowMs
            }
        })

        if(reduced.accepted) {
            return {
                ...reduced.item,
                updatedAt: Number.parseInt(reduced.item?.updatedAt, 10) || nowMs,
                terminalAt: Number.parseInt(reduced.item?.terminalAt, 10) || nowMs,
                actionLease: null,
                actionLeaseReleasedAt: Number.parseInt(reduced.item?.actionLeaseReleasedAt, 10) || nowMs,
                actionLeaseReleaseReason: reduced.item?.actionLeaseReleaseReason || reason,
                ...(failureClassification ? {failureClassification} : {}),
                tabId: null
            }
        }

        return {
            ...item,
            status,
            outcome: `${options.outcome || (status === 'canceled' ? 'paused' : 'timeout')}`.trim(),
            error: `${options.error || (status === 'canceled' ? 'Paused by user' : 'Queued tab closed before reaching a terminal state')}`.trim(),
            updatedAt: nowMs,
            terminalAt: nowMs,
            actionLease: null,
            actionLeaseReleasedAt: nowMs,
            actionLeaseReleaseReason: reason,
            ...(failureClassification ? {failureClassification} : {}),
            tabId: null,
            milestones: {
                ...makeEmptyCoordinatorMilestones(),
                ...(item.milestones || {}),
                closeRequestedAt: Number.parseInt(item?.milestones?.closeRequestedAt, 10) || nowMs,
                tabClosedAt: nowMs
            }
        }
    }

    return {
        getCoordinatorTransitionTerminalAt,
        getCoordinatorProgressReducerEventType,
        getCoordinatorProgressRecordActiveAt,
        getCoordinatorProgressActiveAt,
        buildProjectedCoordinatorItemFromProgress,
        mergeReducedCoordinatorProgressItem,
        transitionCoordinatorItemFromProgress,
        shouldPersistCoordinatorRowEventQueueItemChange,
        makeTerminalProgressRecordFromCoordinatorItem,
        buildTerminalCoordinatorQueueItem,
        hasTerminalProgressDriftFromCoordinatorItem,
        shouldRestoreTerminalProgressFromCoordinatorItem,
        shouldPreferSuccessfulProgressOverTerminalCoordinatorItem,
        isRedundantTerminalProgressForCoordinatorItem,
        promoteTerminalCoordinatorItemFromSuccessfulProgress
    }
}

module.exports = {
    createCoordinatorProgressReducer
}
