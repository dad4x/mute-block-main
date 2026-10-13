const {
    normalizeQuoraProfileHref
} = require('./subject')

const JOB_SCHEMA_VERSION = 2
const DEFAULT_ACTION_KIND = 'mute-block'
const UNBLOCK_UNMUTE_ACTION_KIND = 'unblock-unmute'
const JOB_EVENT_ENQUEUED = 'ENQUEUED'
const JOB_EVENT_TAB_OPENED = 'TAB_OPENED'
const JOB_EVENT_CLAIMED = 'CLAIMED'
const JOB_EVENT_MILESTONE = 'MILESTONE'
const JOB_EVENT_HEARTBEAT = 'HEARTBEAT'
const JOB_EVENT_TERMINAL = 'TERMINAL'
const JOB_EVENT_TAB_REMOVED = 'TAB_REMOVED'
const JOB_EVENT_LEASE_EXPIRED = 'LEASE_EXPIRED'
const JOB_EVENT_PAUSE = 'PAUSE'
const JOB_EVENT_RETRY = 'RETRY'
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'canceled'])
const TRANSIENT_PROGRESS_STATUSES = new Set([
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
])
const ACTIVE_PROGRESS_STATUSES = new Set([
    'tab-opening',
    'tab-opened',
    'awaiting-visibility',
    'page-ready',
    'retrying',
    'muting',
    'blocking',
    'unmuting',
    'unblocking'
])
const VALID_JOB_STATUSES = new Set([
    'queued',
    'opening',
    'active',
    'acting',
    'settling',
    ...TERMINAL_JOB_STATUSES
])
const VALID_JOB_TRANSITIONS = {
    queued: new Set(['opening', 'active', 'succeeded', 'skipped', 'failed', 'canceled']),
    opening: new Set(['queued', 'active', 'failed', 'canceled']),
    active: new Set(['queued', 'acting', 'settling', 'succeeded', 'skipped', 'failed', 'canceled']),
    acting: new Set(['settling', 'succeeded', 'skipped', 'failed', 'canceled']),
    settling: new Set(['succeeded', 'skipped', 'failed', 'canceled']),
    failed: new Set(['queued']),
    skipped: new Set(['queued']),
    succeeded: new Set([]),
    canceled: new Set(['queued'])
}

function normalizeString(value) {
    return `${value || ''}`.trim()
}

function makeEmptyJobMilestones() {
    return {
        tabCreatedAt: 0,
        navigationStartedAt: 0,
        contentOpenedAt: 0,
        actionClaimedAt: 0,
        profileReadyAt: 0,
        muteAttemptedAt: 0,
        blockAttemptedAt: 0,
        closeRequestedAt: 0,
        tabClosedAt: 0
    }
}

const JOB_MILESTONE_FIELDS = Object.keys(makeEmptyJobMilestones())

function normalizeJobMilestoneValue(value) {
    const number = Number.parseInt(value, 10)
    return Number.isFinite(number) && number > 0 ? number : 0
}

function mergeJobMilestones(existing = {}, patch = {}, options = {}) {
    const milestones = {
        ...makeEmptyJobMilestones(),
        ...(existing || {})
    }
    const clearFields = Array.isArray(options.clearFields)
        ? new Set(options.clearFields)
        : new Set()

    for(const field of JOB_MILESTONE_FIELDS) {
        if(clearFields.has(field)) {
            milestones[field] = 0
            continue
        }

        const value = normalizeJobMilestoneValue(patch?.[field])
        if(value) milestones[field] = value
    }

    return milestones
}

function getJobMilestonesFromProgress(record = {}) {
    return {
        tabCreatedAt: Number.isFinite(record.tabCreatedAt) ? record.tabCreatedAt : 0,
        navigationStartedAt: Number.isFinite(record.tabOpenedAt) ? record.tabOpenedAt : 0,
        contentOpenedAt: Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : 0,
        actionClaimedAt: Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : 0,
        profileReadyAt: Number.isFinite(record.actionReadyAt) ? record.actionReadyAt : 0,
        muteAttemptedAt: Number.isFinite(record.muteAttemptedAt) ? record.muteAttemptedAt : 0,
        blockAttemptedAt: Number.isFinite(record.blockAttemptedAt) ? record.blockAttemptedAt : 0,
        closeRequestedAt: Number.isFinite(record.closeRequestedAt) ? record.closeRequestedAt : 0,
        tabClosedAt: Number.isFinite(record.tabClosedAt) ? record.tabClosedAt : 0
    }
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

function isSuccessfulUnblockUnmuteRecord(record = null, status = normalizeString(record?.status)) {
    if(!record || normalizeString(record.actionKind) !== UNBLOCK_UNMUTE_ACTION_KIND) return false
    if(record.unblockSucceeded || status === 'unblocked' || status === 'already-unblocked') return true

    const unblockReason = normalizeString(record.unblockReason)
    const unmuteReason = normalizeString(record.unmuteReason)
    return record.unblockOk === true &&
        record.unmuteOk === true &&
        /^(?:unblocked|already-unblocked|not-blocked|not-blocked-anymore)$/.test(unblockReason) &&
        !/error|failed|not-found|unverified/i.test(unmuteReason) &&
        !normalizeString(record.finalError)
}

function mapProgressToJobState(record = null) {
    const status = normalizeString(record?.status)
    const actionKind = normalizeString(record?.actionKind) || DEFAULT_ACTION_KIND
    if(!record) return {status: '', outcome: '', error: '', terminal: false}

    if(actionKind === UNBLOCK_UNMUTE_ACTION_KIND && isSuccessfulUnblockUnmuteRecord(record, status)) {
        return {
            status: 'succeeded',
            outcome: status === 'already-unblocked' ? 'already-unblocked' : 'unblocked',
            error: '',
            terminal: true
        }
    }
    if(record.blockSucceeded || status === 'blocked' || status === 'already-blocked') {
        return {
            status: 'succeeded',
            outcome: status === 'already-blocked' ? 'already-blocked' : 'blocked',
            error: '',
            terminal: true
        }
    }
    if(status === 'profile-unavailable') {
        return {
            status: 'skipped',
            outcome: 'profile-unavailable',
            error: record.finalError || record.unavailableReason || '',
            terminal: true
        }
    }
    if(status === 'block-attempt-on-following') {
        return {
            status: 'skipped',
            outcome: 'block-attempt-on-following',
            error: '',
            terminal: true
        }
    }
    if(isExplicitSecurityVerificationRecord(record)) {
        return {
            status: 'failed',
            outcome: 'security-verification',
            error: record.finalError || '',
            terminal: true
        }
    }
    if(status === 'error-page') {
        return {
            status: 'failed',
            outcome: 'error-page',
            error: record.finalError || record.errorPageUrl || '',
            terminal: true
        }
    }
    if(status === 'error' || status === 'interrupted') {
        const error = record.finalError || record.muteError || record.blockError || ''
        return {
            status: 'failed',
            outcome: /timeout|timed out|stale/i.test(error) ? 'timeout' : 'action-error',
            error,
            terminal: true
        }
    }
    if(status === 'queued') {
        return {status: 'queued', outcome: '', error: '', terminal: false}
    }
    if(['tab-opening'].includes(status)) {
        return {status: 'opening', outcome: '', error: '', terminal: false}
    }
    if(['muting', 'blocking', 'unmuting', 'unblocking', 'retrying'].includes(status)) {
        return {status: 'acting', outcome: '', error: '', terminal: false}
    }
    if(['tab-opened', 'awaiting-visibility', 'page-ready'].includes(status)) {
        return {status: 'active', outcome: '', error: '', terminal: false}
    }

    return {status: '', outcome: '', error: '', terminal: false}
}

function mapProgressToCoordinatorState(record = null) {
    const mapped = mapProgressToJobState(record)
    if(mapped.status === 'opening' || mapped.status === 'acting') {
        return {
            ...mapped,
            status: 'active'
        }
    }

    return mapped
}

function isTransientProgressStatus(status) {
    return TRANSIENT_PROGRESS_STATUSES.has(normalizeString(status))
}

function isTerminalJobStatus(status) {
    return TERMINAL_JOB_STATUSES.has(normalizeString(status))
}

// getNextCoordinatorQueueSequence computes the processing-order value for a
// freshly-enqueued or freshly-retried queue item: strictly greater than
// every queueSequence currently in the map, so the item sorts to the back
// of processing order instead of keeping whatever position it happened to
// land at when its key was first inserted into the durable queue object (a
// plain JS object never reorders an existing key on reassignment, so
// without an explicit sequence field, a chronically-retried item stays at
// its original position forever and can starve fresher work sitting behind
// it -- see entropy-reduction-action-plan-2026-09-09.md, "queue processing
// order", 2026-09-11/12). No separate persisted counter: the next value is
// always derived from whatever queue is already in hand, so assigning one
// costs a read, not an extra durable write beyond the item's own record.
function getNextCoordinatorQueueSequence(queue = {}) {
    let max = 0
    for(const item of Object.values(queue || {})) {
        const sequence = Number.parseInt(item?.queueSequence, 10) || 0
        if(sequence > max) max = sequence
    }
    return max + 1
}

function isValidJobStatus(status) {
    return VALID_JOB_STATUSES.has(normalizeString(status))
}

function canTransitionJobStatus(fromStatus, toStatus) {
    const from = normalizeString(fromStatus)
    const to = normalizeString(toStatus)
    if(!isValidJobStatus(from) || !isValidJobStatus(to)) return false
    if(from === to) return true

    return !!VALID_JOB_TRANSITIONS[from]?.has(to)
}

function getActionKindForRequestedAction(action = '') {
    return normalizeString(action) === UNBLOCK_UNMUTE_ACTION_KIND
        ? UNBLOCK_UNMUTE_ACTION_KIND
        : DEFAULT_ACTION_KIND
}

function getExecutorTabActionForActionKind(actionKind = '') {
    return getActionKindForRequestedAction(actionKind) === UNBLOCK_UNMUTE_ACTION_KIND
        ? UNBLOCK_UNMUTE_ACTION_KIND
        : 'nuke'
}

function getQueueItemExecutorTabAction(item = {}, fallbackAction = '') {
    const trustedActionKind = normalizeString(item?.actionKind)
    if(trustedActionKind) return getExecutorTabActionForActionKind(trustedActionKind)

    const storedAction = normalizeString(item?.executorTabAction || item?.tabAction)
    if(storedAction === 'nuke' || storedAction === UNBLOCK_UNMUTE_ACTION_KIND) return storedAction

    const fallback = normalizeString(fallbackAction)
    if(fallback === 'nuke' || fallback === UNBLOCK_UNMUTE_ACTION_KIND) return fallback

    return 'nuke'
}

function getJobAttemptId(item = {}) {
    return normalizeString(item?.attempt?.id || item?.attemptId || '')
}

function getJobAttemptNumber(item = {}) {
    const nested = Number.parseInt(item?.attempt?.number, 10)
    const flat = Number.parseInt(item?.attemptNumber, 10)
    if(Number.isFinite(nested) && nested > 0) return nested
    if(Number.isFinite(flat) && flat > 0) return flat

    return 0
}

function getJobEventTime(event = {}) {
    return Number.parseInt(event.at || event.now, 10) || Date.now()
}

function shouldAcceptJobEventAttempt(item = {}, event = {}) {
    const eventAttemptId = normalizeString(event.attemptId || event.attempt?.id || '')
    const currentAttemptId = getJobAttemptId(item)
    if(!eventAttemptId || !currentAttemptId) return true

    return eventAttemptId === currentAttemptId
}

function shouldAcceptRetrySourceAttempt(item = {}, event = {}) {
    const sourceAttemptId = normalizeString(event.sourceAttemptId || event.sourceAttempt?.id || '')
    const sourceAttemptNumber = Number.parseInt(event.sourceAttemptNumber || event.sourceAttempt?.number, 10) || 0
    if(!sourceAttemptId && !sourceAttemptNumber) return true

    const currentAttemptId = getJobAttemptId(item)
    const currentAttemptNumber = getJobAttemptNumber(item)
    if(!sourceAttemptId || !sourceAttemptNumber || !currentAttemptId || !currentAttemptNumber) return false

    return sourceAttemptId === currentAttemptId && sourceAttemptNumber === currentAttemptNumber
}

function updateJobAttempt(item = {}, event = {}) {
    const attemptId = normalizeString(event.attemptId || event.attempt?.id || getJobAttemptId(item))
    const attemptNumber = Number.parseInt(event.attemptNumber || event.attempt?.number, 10) || getJobAttemptNumber(item)
    const existing = item?.attempt && typeof item.attempt === 'object' ? item.attempt : null
    if(!existing) {
        return {
            attemptId,
            attemptNumber
        }
    }

    return {
        attemptId,
        attemptNumber,
        attempt: {
            ...existing,
            id: attemptId,
            number: attemptNumber,
            claimedTabId: event.clearClaim === true ? null : event.tabId ?? existing.claimedTabId ?? null,
            claimedAt: Number.parseInt(event.claimedAt, 10) || existing.claimedAt || 0,
            heartbeatAt: Number.parseInt(event.heartbeatAt, 10) || existing.heartbeatAt || 0,
            leaseExpiresAt: Number.parseInt(event.leaseExpiresAt, 10) || existing.leaseExpiresAt || 0
        }
    }
}

function buildJobReducerResult(item, nextItem, accepted = true, reason = '') {
    return {
        item: nextItem,
        accepted,
        changed: JSON.stringify(item || {}) !== JSON.stringify(nextItem || {}),
        reason
    }
}

function applyJobStatusTransition(item = {}, status = '', event = {}) {
    const nextStatus = normalizeString(status)
    const currentStatus = normalizeString(item.status || 'queued') || 'queued'
    if(!isValidJobStatus(nextStatus)) {
        return buildJobReducerResult(item, item, false, 'invalid-status')
    }
    if(!canTransitionJobStatus(currentStatus, nextStatus)) {
        return buildJobReducerResult(item, item, false, 'invalid-transition')
    }

    const now = getJobEventTime(event)
    const terminal = isTerminalJobStatus(nextStatus)
    const milestones = mergeJobMilestones(item.milestones || {}, event.milestones || {}, {
        clearFields: event.clearMilestones
    })
    if(event.tabClosedAt || event.type === JOB_EVENT_TAB_REMOVED) {
        milestones.tabClosedAt = Number.parseInt(event.tabClosedAt, 10) || now
    }
    if(event.closeRequestedAt || event.type === JOB_EVENT_PAUSE) {
        milestones.closeRequestedAt = Number.parseInt(event.closeRequestedAt, 10) || now
    }
    if(event.tabCreatedAt || event.type === JOB_EVENT_TAB_OPENED) {
        milestones.tabCreatedAt = Number.parseInt(event.tabCreatedAt, 10) || now
        milestones.navigationStartedAt = Number.parseInt(event.navigationStartedAt, 10) || milestones.navigationStartedAt || now
    }
    if(event.contentOpenedAt || nextStatus === 'active') {
        milestones.contentOpenedAt = Number.parseInt(event.contentOpenedAt, 10) || milestones.contentOpenedAt || now
    }

    const attemptPatch = updateJobAttempt(item, event)
    const nextItem = {
        ...item,
        ...attemptPatch,
        status: nextStatus,
        outcome: terminal ? normalizeString(event.outcome || item.outcome || '') : '',
        error: terminal ? normalizeString(event.error || '') : '',
        updatedAt: Math.max(Number.parseInt(item.updatedAt, 10) || 0, now),
        queuedAt: nextStatus === 'queued' ? now : item.queuedAt || 0,
        activeAt: nextStatus === 'active' || nextStatus === 'acting' || nextStatus === 'settling'
            ? item.activeAt || now
            : nextStatus === 'queued' ? 0 : item.activeAt || 0,
        terminalAt: terminal
            ? Number.parseInt(event.terminalAt || event.tabClosedAt, 10) || now
            : 0,
        tabId: terminal || nextStatus === 'queued' ? null : event.tabId ?? item.tabId ?? null,
        actionLease: terminal || nextStatus === 'queued' ? null : item.actionLease || null,
        actionLeaseReleasedAt: terminal
            ? now
            : nextStatus === 'queued' ? 0 : item.actionLeaseReleasedAt || 0,
        actionLeaseReleaseReason: terminal || nextStatus === 'queued'
            ? normalizeString(event.reason || '')
            : item.actionLeaseReleaseReason || '',
        milestones
    }

    return buildJobReducerResult(item, nextItem)
}

// --- Rolled-back queued tab retry classification -------------------------
// Promoted from swRolledBackQueuedTabRetryClassification.js into the reducer
// core (P3-5/P3-6 design correction, 2026-09-17, see
// sw-state-machine-decomposition-plan-2026-09-01.md): every predicate below
// is a pure, single-argument function of a queue item alone, so
// reduceJobEvent computes them itself instead of trusting a caller-built
// copy that could go stale (a caller reads the item at one point in time,
// then the item can change again before its computed facts reach the
// reducer) or simply disagree with the item's own fields due to a bug at
// one of several call sites. swRolledBackQueuedTabRetryClassification.js no
// longer defines these itself -- sw.js (the composition root) threads them
// from here into that module's deps.handlers instead, so its own remaining
// exports (and its five callers in sw.js, plus the harness's direct
// sw.isQueuedTabRetryBudgetReleaseReason/shouldAdvanceRolledBackQueuedTabBeforeOpen
// test hooks) keep working under the same names.
//
// isCoordinatorQueueAuthoritativeItem is deliberately NOT re-exported here:
// its canonical home stays swCoordinatorStatusRules.js (used far beyond this
// one policy), and duplicating its one-line body locally -- rather than
// wiring a new cross-module dependency into this reducer core -- is the
// cheaper, lower-risk way to let the reducer compute it itself. See the
// decomposition plan for the fuller rationale.
const ACTIVE_JOB_STATUSES = new Set(['opening', 'active', 'acting', 'settling'])
const DEFAULT_QUEUED_TAB_MAX_RETRIES = 1 // mirrors sw.js's STALE_QUEUED_TAB_MAX_RETRIES
const EXHAUSTED_ROLLBACK_RECOVERY_LIMIT = 3 // mirrors sw.js's COORDINATOR_EXHAUSTED_ROLLBACK_RECOVERY_LIMIT
const QUEUE_LOAD_PRESSURE_RECOVERY_WINDOW_MS = 120000 // mirrors sw.js's QUEUE_LOAD_THROTTLE_MAX_MS
const QUEUE_LOAD_PRESSURE_REASON_PATTERN = /(?:content-script|claim-nudge|storage|loading|unscriptable|queue-load)/i

function isActiveJobStatus(status = '') {
    return ACTIVE_JOB_STATUSES.has(normalizeString(status))
}

function isCoordinatorQueueAuthoritativeItem(item = null) {
    return item?.serviceWorkerOwned === true || `${item?.executorOwner || ''}` === 'service-worker'
}

function isQueuedTabRetryBudgetReleaseReason(reason = '') {
    const normalized = `${reason || ''}`.trim()
    return normalized === 'active-transition-failed' ||
        normalized === 'queued-tab-release-fast-executor-preflight' ||
        normalized === 'executor-plan-active-transition-retry-budget-exhausted' ||
        /(?:^|-)active-missing-tab(?:-|$)/.test(normalized) ||
        /(?:^|-)profile-tabs-without-active-authority(?:-|$)/.test(normalized) ||
        /(?:^|-)runtime-authority-missing-active-row(?:-|$)/.test(normalized) ||
        /(?:^|-)fast-executor-preflight(?:-|$)/.test(normalized) ||
        /(?:^|-)content-script-(?:ensure-failed|unscriptable|version-mismatch)(?:-|$)/.test(normalized) ||
        /(?:^|-)claim-nudge-not-accepted(?:-|$)/.test(normalized) ||
        /(?:^|-)fresh-content-script-recovery(?:-|$)/.test(normalized) ||
        /(?:^|-)queued-live-tab-adoption-load-pressure(?:-|$)/.test(normalized) ||
        /(?:^|-)queued-tab-final-open-decision-timeout(?:-|$)/.test(normalized) ||
        /(?:^|-)queued-stale-runtime-(?:missing-metadata|missing-queued-action|action-already-pruned|action-drained-before-authority|action-pruned-after-fill-timeout)(?:-|$)/.test(normalized)
}

function shouldAdvanceRolledBackQueuedTabBeforeOpen(item = null) {
    if(!item || isTerminalJobStatus(item.status) || isActiveJobStatus(item.status)) return false
    return isQueuedTabRetryBudgetReleaseReason(item.actionLeaseReleaseReason) &&
        !!getJobAttemptId(item) &&
        !!getJobAttemptNumber(item)
}

function getRolledBackQueuedTabRetryAttempt(item = {}) {
    return Math.max(
        Number.parseInt(item?.retryCount, 10) || 0,
        Number.parseInt(item?.retryAttempt, 10) || 0
    )
}

function getJobQueuedTabMaxRetries(item = null) {
    const configured = Number.parseInt(item?.maxRetries, 10)
    return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_QUEUED_TAB_MAX_RETRIES
}

function isExhaustedRolledBackQueuedTabRetry(item = null) {
    if(!shouldAdvanceRolledBackQueuedTabBeforeOpen(item)) return false
    return getRolledBackQueuedTabRetryAttempt(item) >= getJobQueuedTabMaxRetries(item)
}

function isActiveTransitionRolledBackQueuedTabRetry(item = null) {
    const reason = `${item?.actionLeaseReleaseReason || ''}`.trim()
    return reason === 'active-transition-failed' || /(?:^|-)active-transition(?:-|$)/.test(reason)
}

function isRuntimeDisappearedRolledBackQueuedTabRetry(item = null) {
    const reason = `${item?.actionLeaseReleaseReason || ''}`.trim()
    return /(?:^|-)active-missing-tab(?:-|$)/.test(reason) ||
        /(?:^|-)profile-tabs-without-active-authority(?:-|$)/.test(reason) ||
        /(?:^|-)runtime-authority-missing-active-row(?:-|$)/.test(reason)
}

function isTransientOpenRolledBackQueuedTabRetry(item = null) {
    const reason = `${item?.actionLeaseReleaseReason || ''}`.trim()
    if(!reason) return false
    if(isActiveTransitionRolledBackQueuedTabRetry(item)) return false
    if(isRuntimeDisappearedRolledBackQueuedTabRetry(item)) return false
    return isQueuedTabRetryBudgetReleaseReason(reason)
}

function hasLiveQueuedTabRuntimeSignal(item = null) {
    const tabId = Number.parseInt(item?.tabId || item?.activeTabId || 0, 10)
    if(Number.isFinite(tabId) && tabId > 0) return true
    return (Number.parseInt(item?.activeAt, 10) || 0) > 0
}

// isRecentQueueLoadPressureReading interprets a RAW, point-in-time
// queue-load-throttle reading (intent.queueLoadPressure: {active, reason,
// lastPressureAt}, captured by the caller from live, mutable throttle
// state) -- the regex/window policy check itself lives here, in the
// reducer, rather than at each call site, so every caller that hands the
// reducer the same raw reading gets the same answer.
function isRecentQueueLoadPressureReading(pressure = null, now = Date.now()) {
    const reason = normalizeString(pressure?.reason)
    if(!reason || !QUEUE_LOAD_PRESSURE_REASON_PATTERN.test(reason)) return false
    if(pressure?.active === true) return true

    const lastPressureAt = Number.parseInt(pressure?.lastPressureAt, 10) || 0
    if(!lastPressureAt) return false
    const windowMs = Number.parseInt(pressure?.windowMs, 10) || QUEUE_LOAD_PRESSURE_RECOVERY_WINDOW_MS
    return (Number.parseInt(now, 10) || Date.now()) - lastPressureAt <= windowMs
}

// isExhaustedRollbackRecoveryApproved centralizes the
// shouldRecoverExhaustedRolledBackQueuedTabRetry policy (three approval
// paths -- queueOnlyAuthority shortcut, recoverActiveTransitionFailures
// reason-match, queue-pressure recovery nested inside the reason-match
// branch -- plus the exhaustedRolledBackRecoveryCount cap that closed the
// infinite-recovery-loop bug) as one reducer-decided question instead of
// three independently-branching call sites.
//
// `intent` carries only what the reducer genuinely cannot derive from
// `item` itself: the caller's own recovery-mode flags (queueOnlyAuthority,
// recoverActiveTransitionFailures, recoverTransientOpenRetry,
// recoverQueueLoadPressure, and serviceWorkerOwned's caller-side override)
// plus a raw, point-in-time queue-load-pressure reading
// (intent.queueLoadPressure). Every other fact the approval decision used
// to require from a caller-built bundle -- isExhausted, activeTransitionRetry,
// runtimeDisappearedRetry, transientOpenRetry, queueAuthoritative, and
// serviceWorkerOwned's item-derived half -- is computed here, directly from
// `item`, so a caller can no longer approve a recovery the item's own
// fields don't actually support. `intent.recoveryLimit` is an optional
// override of EXHAUSTED_ROLLBACK_RECOVERY_LIMIT for callers/tests that need
// a different cap; ordinary callers can omit it entirely. See
// swRolledBackQueuedTabRetryClassification.js's
// shouldRecoverExhaustedRolledBackQueuedTabRetry and
// buildForcedRolledBackQueuedTabRetryItem for the two call sites that now
// build this same narrow intent from the same caller options
// (P3-5/P3-6, sw-state-machine-decomposition-plan-2026-09-01.md).
function isExhaustedRollbackRecoveryApproved(item = {}, intent = {}, now = Date.now()) {
    if(!isExhaustedRolledBackQueuedTabRetry(item)) return false

    const count = Number.parseInt(item?.exhaustedRolledBackRecoveryCount, 10) || 0
    const limit = Number.parseInt(intent.recoveryLimit, 10) || EXHAUSTED_ROLLBACK_RECOVERY_LIMIT
    if(count >= limit) return false
    if(intent.queueOnlyAuthority === true) return true
    if(intent.recoverActiveTransitionFailures !== true) return false

    const activeTransitionRetry = isActiveTransitionRolledBackQueuedTabRetry(item)
    const runtimeDisappearedRetry = isRuntimeDisappearedRolledBackQueuedTabRetry(item)
    const transientOpenRetry = isTransientOpenRolledBackQueuedTabRetry(item)
    const queueAuthoritative = isCoordinatorQueueAuthoritativeItem(item)
    const serviceWorkerOwned = intent.serviceWorkerOwned === true ||
        item?.serviceWorkerOwned === true ||
        item?.executorOwner === 'service-worker'
    const pressureOpenRetry = intent.recoverQueueLoadPressure === true &&
        transientOpenRetry &&
        queueAuthoritative &&
        serviceWorkerOwned &&
        !hasLiveQueuedTabRuntimeSignal(item) &&
        isRecentQueueLoadPressureReading(intent.queueLoadPressure, now)

    const reasonMatched = activeTransitionRetry ||
        runtimeDisappearedRetry ||
        (transientOpenRetry && (intent.recoverTransientOpenRetry === true || pressureOpenRetry))
    if(!reasonMatched) return false

    return queueAuthoritative === true && serviceWorkerOwned === true
}

function reduceJobEvent(item = {}, event = {}) {
    const type = normalizeString(event.type)
    if(!type) return buildJobReducerResult(item, item, false, 'missing-event-type')

    if(type === JOB_EVENT_ENQUEUED || type === JOB_EVENT_RETRY) {
        if(type === JOB_EVENT_RETRY && !shouldAcceptRetrySourceAttempt(item, event)) {
            return buildJobReducerResult(item, item, false, 'stale-retry-source-attempt')
        }
        if(type === JOB_EVENT_RETRY && event.exhaustedRolledBackRecovery &&
            !isExhaustedRollbackRecoveryApproved(item, event.exhaustedRolledBackRecovery, getJobEventTime(event))) {
            return buildJobReducerResult(item, item, false, 'exhausted-rollback-recovery-denied')
        }

        const nextAttemptId = normalizeString(event.attemptId || event.attempt?.id || getJobAttemptId(item))
        const nextAttemptNumber = Number.parseInt(event.attemptNumber || event.attempt?.number, 10) || getJobAttemptNumber(item)
        const result = applyJobStatusTransition(item, 'queued', {
            ...event,
            attemptId: nextAttemptId,
            attemptNumber: nextAttemptNumber,
            clearClaim: true
        })
        if(!result.accepted) return result

        return buildJobReducerResult(item, {
            ...result.item,
            outcome: '',
            error: '',
            retryCount: Number.parseInt(event.retryCount, 10) || item.retryCount || 0,
            queueSequence: Number.parseInt(event.queueSequence, 10) || item.queueSequence || 0,
            lastRetryAt: Number.parseInt(event.lastRetryAt, 10) || result.item.queuedAt || 0,
            terminalAt: 0,
            ...(event.exhaustedRolledBackRecovery ? {
                exhaustedRolledBackRecoveryCount: (Number.parseInt(item.exhaustedRolledBackRecoveryCount, 10) || 0) + 1
            } : {})
        })
    }
    if(!shouldAcceptJobEventAttempt(item, event)) {
        return buildJobReducerResult(item, item, false, 'stale-attempt')
    }
    if(type === JOB_EVENT_TAB_OPENED) {
        return applyJobStatusTransition(item, 'opening', event)
    }
    if(type === JOB_EVENT_CLAIMED || type === JOB_EVENT_HEARTBEAT) {
        return applyJobStatusTransition(item, 'active', event)
    }
    if(type === JOB_EVENT_MILESTONE) {
        return applyJobStatusTransition(item, normalizeString(event.status || 'active'), event)
    }
    if(type === JOB_EVENT_PAUSE) {
        return applyJobStatusTransition(item, 'canceled', {
            outcome: 'paused',
            error: 'Paused by user',
            ...event
        })
    }
    if(type === JOB_EVENT_TAB_REMOVED || type === JOB_EVENT_LEASE_EXPIRED) {
        return applyJobStatusTransition(item, normalizeString(event.status || 'failed'), {
            outcome: 'timeout',
            error: 'Queued tab closed before reaching a terminal state',
            ...event
        })
    }
    if(type === JOB_EVENT_TERMINAL) {
        return applyJobStatusTransition(item, normalizeString(event.status || 'failed'), event)
    }

    return buildJobReducerResult(item, item, false, 'unknown-event-type')
}

function isRetryableJobFailure(item = null) {
    if(normalizeString(item?.status) !== 'failed') return false
    const outcome = normalizeString(item?.outcome)
    if(outcome === 'security-verification') return false
    if(outcome === 'timeout' || outcome === 'action-error') return true

    return /timeout|timed out|stale|interrupted/i.test(`${item?.error || ''}`)
}

function isRetryableJobFailureFromProgress(item = null, record = null) {
    if(isRetryableJobFailure(item)) return true
    if(normalizeString(item?.status) !== 'failed') return false
    if(normalizeString(item?.outcome) !== 'security-verification') return false
    if(isExplicitSecurityVerificationRecord(record)) return false

    return isTransientProgressStatus(record?.status)
}

function makeCanonicalSubject(profileHref = '') {
    const href = normalizeQuoraProfileHref(profileHref)
    if(!href) return null

    const slug = decodeURIComponent(href.split('/').filter(Boolean).pop() || '')
    return {
        kind: 'quora-profile',
        href,
        slug,
        aliases: []
    }
}

function makeJobDedupeKey(options = {}) {
    const subject = options.canonicalSubject || makeCanonicalSubject(options.profileHref || options.targetProfileHref || options.requestedUrl || '')
    if(!subject?.href) return ''

    const scope = normalizeString(options.scopeKey || options.runId || options.scope?.runId || options.scope?.type || 'global')
    const actionKind = normalizeString(options.actionKind) || DEFAULT_ACTION_KIND
    return `${scope}|${actionKind}|${subject.href}`
}

function normalizeAttempt(item = {}) {
    const existing = item?.attempt && typeof item.attempt === 'object' ? item.attempt : {}
    const flatAttempt = Number.parseInt(item?.attempt, 10)
    const number = Number.parseInt(existing.number, 10) ||
        (Number.isFinite(flatAttempt) && flatAttempt > 0 ? flatAttempt : 0)

    return {
        id: normalizeString(existing.id),
        number,
        max: Number.parseInt(existing.max ?? item?.maxAttempts, 10) || 1,
        claimedTabId: existing.claimedTabId ?? item?.tabId ?? null,
        claimedAt: Number.parseInt(existing.claimedAt, 10) || 0,
        leaseExpiresAt: Number.parseInt(existing.leaseExpiresAt, 10) || 0,
        heartbeatAt: Number.parseInt(existing.heartbeatAt, 10) || 0
    }
}

function upgradeCoordinatorQueueItem(key = '', item = {}, options = {}) {
    const source = item && typeof item === 'object' ? item : {}
    const targetProfileHref = normalizeQuoraProfileHref(source.targetProfileHref || source.requestedUrl || source.dedupeKey || key || '')
    const canonicalSubject = makeCanonicalSubject(targetProfileHref)
    const actionKind = normalizeString(source.actionKind || options.actionKind) || DEFAULT_ACTION_KIND
    const scope = source.scope && typeof source.scope === 'object'
        ? source.scope
        : {
            type: source.source?.type || options.sourceType || 'unknown',
            runId: source.runId || options.runId || '',
            sourcePageUrl: source.source?.pageUrl || '',
            spaceKey: source.source?.spaceKey || '',
            spaceCategory: source.source?.spaceCategory || ''
        }
    const dedupeKey = source.dedupeKey && source.dedupeKey.includes('|')
        ? source.dedupeKey
        : makeJobDedupeKey({canonicalSubject, actionKind, scope})

    return {
        ...source,
        schemaVersion: JOB_SCHEMA_VERSION,
        canonicalSubject,
        actionKind,
        scope,
        dedupeKey,
        targetProfileHref: targetProfileHref || source.targetProfileHref || '',
        attempt: normalizeAttempt(source),
        milestones: {
            ...makeEmptyJobMilestones(),
            ...(source.milestones || {})
        }
    }
}

module.exports = {
    ACTIVE_PROGRESS_STATUSES,
    DEFAULT_ACTION_KIND,
    JOB_EVENT_CLAIMED,
    JOB_EVENT_ENQUEUED,
    JOB_EVENT_HEARTBEAT,
    JOB_EVENT_LEASE_EXPIRED,
    JOB_EVENT_MILESTONE,
    JOB_EVENT_PAUSE,
    JOB_EVENT_RETRY,
    JOB_EVENT_TAB_OPENED,
    JOB_EVENT_TAB_REMOVED,
    JOB_EVENT_TERMINAL,
    JOB_SCHEMA_VERSION,
    TERMINAL_JOB_STATUSES,
    TRANSIENT_PROGRESS_STATUSES,
    UNBLOCK_UNMUTE_ACTION_KIND,
    canTransitionJobStatus,
    getActionKindForRequestedAction,
    getExecutorTabActionForActionKind,
    getJobMilestonesFromProgress,
    getNextCoordinatorQueueSequence,
    getQueueItemExecutorTabAction,
    getRolledBackQueuedTabRetryAttempt,
    isActiveTransitionRolledBackQueuedTabRetry,
    isExhaustedRolledBackQueuedTabRetry,
    isExplicitSecurityVerificationRecord,
    isQueuedTabRetryBudgetReleaseReason,
    isRetryableJobFailure,
    isRetryableJobFailureFromProgress,
    isRuntimeDisappearedRolledBackQueuedTabRetry,
    isTerminalJobStatus,
    isTransientOpenRolledBackQueuedTabRetry,
    isTransientProgressStatus,
    makeCanonicalSubject,
    makeEmptyJobMilestones,
    makeJobDedupeKey,
    mapProgressToCoordinatorState,
    mapProgressToJobState,
    reduceJobEvent,
    shouldAdvanceRolledBackQueuedTabBeforeOpen,
    upgradeCoordinatorQueueItem
}
