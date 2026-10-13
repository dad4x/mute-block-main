// Scheduler alarm/backoff bookkeeping extracted from sw.js (decomposition
// Slice 28): nextCoordinatorPauseGeneration, isCoordinatorPauseGenerationLocallyCurrent,
// isCoordinatorPauseRequestedLocally, scheduleCoordinatorPauseStateReconcile,
// buildPausedCoordinatorQueueItem, hasStoredCoordinatorWork,
// hasStoredCoordinatorWorkInQueueView, normalizeRawCoordinatorQueueForReconcileFallback,
// isCoordinatorReconcileEdgeTriggerReason, clearNamedSchedulerAlarm,
// clearCoordinatorReconcileAlarms, isCoordinatorReconcileAlarmName,
// getSchedulerAlarmScheduledTime, isSchedulerAlarmScheduledForDueAt,
// suppressStaleCoordinatorResumeAlarm, suppressStaleCoordinatorReconcileAlarm,
// scheduleCoordinatorResumeAlarm, isSuppressedStaleCoordinatorResumeAlarm,
// isSuppressedStaleCoordinatorReconcileAlarm, resetCoordinatorReconcileBackoff,
// recordCoordinatorReconcileNoopBackoff, and hasCoordinatorReconcileBackoff.
//
// Exclusions from the plan's ~23-function Slice 28 list, both left resident
// in sw.js:
//
// - buildTerminalCoordinatorQueueItem is eagerly referenced by two
//   already-extracted modules' own construction-call handler literals --
//   swQueuedTabRuntimeStatus.js (constructed at sw.js's old line ~2294) and
//   swCoordinatorReconcileLockedMaterialization.js (constructed at ~7633) --
//   both well before this cluster's own former position (~17278). Its own
//   dependency buildCoordinatorFailureClassification, in turn, isn't
//   constructed until Slice 25's module at ~10041, well after both of
//   those. Satisfying both constraints at once would mean hoisting this
//   entire module's construction ahead of line 2294 and forward-thunking
//   most of its own dependency graph (coordinatorStatusRules,
//   profileResolution, coordinatorAttemptIdentity,
//   coordinatorExecutorClassification, and more, none of which are
//   available that early) -- out of proportion for one bookkeeping
//   function when every other function in this cluster has no such
//   entanglement. Left as a bare `function` declaration in sw.js.
// - scheduleCoordinatorReconcile (122 external refs) and
//   scheduleCoordinatorQueueResume (138 external refs), per the plan's
//   explicit caution -- the actual scheduling core, not bookkeeping around
//   it. Both remain resident in sw.js and now call into this module's
//   exported bare names for the pieces that did move (isCoordinatorReconcileEdgeTriggerReason,
//   resetCoordinatorReconcileBackoff, hasCoordinatorReconcileBackoff,
//   suppressStaleCoordinatorReconcileAlarm, suppressStaleCoordinatorResumeAlarm,
//   scheduleCoordinatorResumeAlarm), unchanged as bare identifiers since
//   sw.js destructures this module's exports back to bare consts (see the
//   construction-order note below).
//
// scheduleCoordinatorResumeAlarm / scheduleCoordinatorQueueResume naming
// distinction (verified per the plan's instruction to check before
// including scheduleCoordinatorResumeAlarm): scheduleCoordinatorQueueResume
// is the resume-scheduling core (coalescing, fast-executor deferral,
// re-entrant self-scheduling via its own timeout callback) that *calls*
// scheduleCoordinatorResumeAlarm three times as a narrow leaf -- "create the
// browser.alarms entry for a due time and record the resulting promise on
// the scheduler slot." The two are not entangled beyond that ordinary
// caller/callee relationship, so the distinction holds and
// scheduleCoordinatorResumeAlarm moved with the rest of this cluster.
//
// Construction-order note: unlike buildTerminalCoordinatorQueueItem, none of
// the 22 functions that did move are referenced by any already-extracted
// module's own construction-call handler literal, so this module constructs
// in place, at this cluster's former source-text position (immediately
// before the sw.js-resident scheduleCoordinatorReconcile/
// scheduleCoordinatorQueueResume pair), same as the Slice 27 precedent. All
// of its own dependencies (coordinatorStatusRules's isPendingCoordinatorStatus/
// isCoordinatorQueueAuthoritativeItem, coordinatorRuns's
// makeEmptyCoordinatorMilestones, coordinatorExecutorClassification's
// getCoordinatorItemHref/getCoordinatorActionKindForRequestedAction/
// getCoordinatorExecutorTabActionForActionKind, profileResolution's
// isProfileResolutionItem/getProfileResolutionRequestedUrl/
// normalizeCoordinatorRequestedUrl/getCoordinatorItemQueueKey,
// coordinatorAttemptIdentity's getAttemptIdFromValue/getAttemptNumberFromValue/
// makeCoordinatorAttemptEnvelope, coordinatorJobEnvelope's
// applyCoordinatorJobEnvelope, queueWakeupMetricsShape's
// incrementQueueWakeupMetric/recordQueueWakeupMetricMax, and the
// coordinatorQueueResumeScheduler/coordinatorReconcileScheduler slot
// instances) are already available as bare consts well before this
// cluster's former line range, so none need forward-reference thunks.
//
// setCoordinatorPauseControlState, setCoordinatorRunsPaused, and
// kickCoordinatorQueueResume (all sw.js-resident `async function`
// declarations, hoisted, visible regardless of textual position) are
// threaded through directly with no thunk needed.
//
// scheduleCoordinatorReconcileExecutorContinuation added in decomposition
// Slice 43 (mop-up of remaining isolated singles): a natural fit here, the
// glue that decides whether a reconcile tick needs a follow-up resume/
// fast-executor continuation scheduled. It calls scheduleCoordinatorQueueResume
// (still resident in sw.js, per the plan's explicit caution above -- a
// hoisted `function` declaration, so no thunk is needed despite this module
// constructing before it) and shouldContinueQueuedOnlyWorkWithFastExecutor/
// scheduleQueuedOnlyDurableWorkContinuation (swStorageIdlePromiseLatch.js,
// Slice 9, already a bare const by this module's construction point). No
// async keyword and no Promise/`.then()`/`.catch()` chain of its own
// (grepped per architecture.md's realm-crossing note) -- it only calls into
// other functions without touching what they return, so it carries no
// realm-crossing risk either direction. Had exactly one external reference
// (runScheduledCoordinatorReconcileTick, resident in sw.js), so no eager
// construction-order concern.
//
// State ownership: coordinatorPauseGeneration and coordinatorPauseRequested
// are bare sw.js `let` bindings (declared near the top of the file) that
// stay in sw.js because several sw.js-resident `async` functions
// (nextCoordinatorPauseGenerationFromStorage, isCoordinatorPauseGenerationCurrent,
// restoreLatestCoordinatorPauseGenerationIfStale, pauseCoordinatorNukes, and
// others -- all out of scope, async-orchestration-adjacent per the plan's
// Part 1/Part 2 split) read and, in coordinatorPauseRequested's case,
// directly assign them. Per the existing quoraRuntimeActivated/
// persistentRetryFailedTimeout accessor convention, they're threaded
// through as get (and, for coordinatorPauseGeneration, set) accessors in
// deps.state rather than re-exposed as raw bindings.
//
// Clock/environment-global note: buildPausedCoordinatorQueueItem's `now`
// parameter default, normalizeRawCoordinatorQueueForReconcileFallback's
// internal Date.now() call, suppressStaleCoordinatorResumeAlarm/
// suppressStaleCoordinatorReconcileAlarm/isSuppressedStaleCoordinatorResumeAlarm/
// isSuppressedStaleCoordinatorReconcileAlarm/recordCoordinatorReconcileNoopBackoff's
// internal Date.now() calls, and hasCoordinatorReconcileBackoff's `now`
// parameter default are all threaded through as a `now: () => Date.now()`
// dep (named `getNow` internally, matching the swPersistentRetryExecutorTimers.js
// convention) -- every one of these functions is non-`async`, so this would
// otherwise silently resolve to the real Node clock instead of the test
// harness's injected FakeDate.
//
// scheduleCoordinatorPauseStateReconcile uses `setTimeout`, threaded through
// as `setTimeoutFn`, matching the swBrowserSessionRuntime.js/
// swPersistentRetryExecutorTimers.js convention.
//
// Promise-chain realm-crossing scrutiny (per architecture.md's Slice-7
// refinement): every body was grepped for `.then(`, `.catch(`, `Promise.`,
// `async`, `setTimeout`, and `void`.
//
// scheduleCoordinatorPauseStateReconcile's setTimeout callback does
// `void setCoordinatorPauseControlState(...).catch(() => null)`,
// `void setCoordinatorRunsPaused(false).catch(() => null)`, and
// `void kickCoordinatorQueueResume(reason).catch(() => null)` -- three
// void-discarded, .catch-guarded fire-and-forget calls into sw.js-resident
// `async` functions. This is the identical shape already moved twice
// (swBrowserSessionRuntime.js's rearmStoredWorkAfterExtensionReload/
// rearmStoredWorkAfterServiceWorkerReload calls, and
// swPersistentRetryExecutorTimers.js's runPersistentFailedRetryTick call):
// a void-discarded call attaches no continuation a caller could observe, so
// it builds no cross-realm Promise chain regardless of which realm it
// executes in.
//
// clearNamedSchedulerAlarm's `browser.alarms.clear(name)` result gets a
// `.catch(() => false)` -- reaching into the host `browser` API passed
// through as a plain dep, not into another require()'d module, so per the
// Slice 27 precedent (confirmed against swQueuedTabReclaimResume.js's,
// swexecutor.js's, and swBootstrap.js's identical
// `void browser.X(...).catch(...)` pattern) it carries no realm-crossing
// concern.
//
// scheduleCoordinatorResumeAlarm is the one function in this cluster with a
// closer call: it does
// `coordinatorQueueResumeScheduler.setAlarmPromiseForDueAt(alarmResult, scheduledDueAt)`
// (a plain synchronous call into the already-extracted swscheduler.js's
// scheduler-slot instance -- swscheduler.js's setAlarmPromiseForDueAt builds
// its own internal `Promise.resolve(promise).then(...)` chain entirely
// within its own module body, a construction that already happens
// regardless of which realm calls into it) followed by
// `alarmPromise.catch(() => false)`. That .catch() attachment's result is
// never read or awaited by anything -- not returned, not stored beyond the
// scheduler slot's own internal bookkeeping -- so no reconcile-tick-visible
// ordering depends on which realm the attachment happens from; this
// differs from the WAL/Slice-7 failure shapes, which broke because
// something *did* observe the crossing's tick-cost shift. Moved with the
// rest of the cluster and confirmed against the full test:parallel suite
// (see the commit message for the outcome).
//
// No Date.now() calls or Promise/setTimeout hits in any of the remaining
// functions (nextCoordinatorPauseGeneration, isCoordinatorPauseGenerationLocallyCurrent,
// isCoordinatorPauseRequestedLocally, hasStoredCoordinatorWork,
// hasStoredCoordinatorWorkInQueueView, isCoordinatorReconcileEdgeTriggerReason,
// clearCoordinatorReconcileAlarms, isCoordinatorReconcileAlarmName,
// getSchedulerAlarmScheduledTime, isSchedulerAlarmScheduledForDueAt,
// resetCoordinatorReconcileBackoff).

function createSwSchedulerAlarmBookkeeping(deps = {}) {
    const {
        browser,
        incrementQueueWakeupMetric,
        recordQueueWakeupMetricMax,
        isPendingCoordinatorStatus,
        isCoordinatorQueueAuthoritativeItem,
        makeEmptyCoordinatorMilestones,
        getCoordinatorItemHref,
        normalizeQuoraProfileUrl,
        isProfileResolutionItem,
        getProfileResolutionRequestedUrl,
        normalizeCoordinatorRequestedUrl,
        getCoordinatorItemQueueKey,
        getCoordinatorActionKindForRequestedAction,
        getCoordinatorExecutorTabActionForActionKind,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        makeCoordinatorAttemptEnvelope,
        applyCoordinatorJobEnvelope,
        setCoordinatorPauseControlState,
        setCoordinatorRunsPaused,
        kickCoordinatorQueueResume,
        coordinatorQueueResumeScheduler,
        coordinatorReconcileScheduler,
        setTimeoutFn = setTimeout,
        scheduleCoordinatorQueueResume,
        shouldContinueQueuedOnlyWorkWithFastExecutor,
        scheduleQueuedOnlyDurableWorkContinuation
    } = deps.handlers || {}
    const {
        STALE_QUEUED_TAB_MAX_RETRIES,
        COORDINATOR_RECONCILE_ALARM_NAME,
        COORDINATOR_RESUME_ALARM_NAME,
        STALE_SCHEDULER_ALARM_SUPPRESSION_MS,
        SCHEDULER_ALARM_TIME_TOLERANCE_MS,
        SCHEDULER_ALARM_LATE_TOLERANCE_MS,
        COORDINATOR_RECONCILE_BACKOFF_BASE_MS,
        COORDINATOR_RECONCILE_BACKOFF_MAX_MS
    } = deps.constants || {}
    const {
        getCoordinatorPauseGeneration = () => 0,
        setCoordinatorPauseGeneration = () => {},
        getCoordinatorPauseRequested = () => false,
        now: getNow = () => Date.now()
    } = deps.state || {}

    function nextCoordinatorPauseGeneration() {
        const next = getCoordinatorPauseGeneration() + 1
        setCoordinatorPauseGeneration(next)
        return next
    }

    function isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration = 0) {
        const generation = Number.parseInt(pauseGeneration, 10) || 0
        return !!generation &&
            getCoordinatorPauseRequested() === true &&
            generation === getCoordinatorPauseGeneration()
    }

    function isCoordinatorPauseRequestedLocally() {
        return getCoordinatorPauseRequested() === true
    }

    function scheduleCoordinatorPauseStateReconcile(reason = 'pause-generation-reconcile') {
        setTimeoutFn(() => {
            void setCoordinatorPauseControlState(
                getCoordinatorPauseRequested() === true,
                getCoordinatorPauseGeneration(),
                'reconcile'
            ).catch(() => null)

            if(getCoordinatorPauseRequested() !== true) {
                void setCoordinatorRunsPaused(false).catch(() => null)
                void kickCoordinatorQueueResume(reason).catch(() => null)
            }
        }, 0)
    }

    function buildPausedCoordinatorQueueItem(item = {}, now = getNow(), reason = 'coordinator-pause-request') {
        return {
            ...item,
            status: 'queued',
            outcome: '',
            error: '',
            updatedAt: now,
            activeAt: 0,
            terminalAt: 0,
            tabId: null,
            actionLease: null,
            actionLeaseReleasedAt: now,
            actionLeaseReleaseReason: reason,
            milestones: {
                ...makeEmptyCoordinatorMilestones(),
                ...(item.milestones || {})
            }
        }
    }

    function hasStoredCoordinatorWork(queue = {}) {
        return Object.values(queue || {}).some(item => {
            const status = `${item?.status || ''}`.trim()
            return isPendingCoordinatorStatus(status) && isCoordinatorQueueAuthoritativeItem(item)
        })
    }

    function hasStoredCoordinatorWorkInQueueView(view = null) {
        if(view?.hasAuthoritativeStoredWork === true) return true
        const counts = view && typeof view === 'object' ? view.authoritativeCounts || {} : {}
        return ['queued', 'opening', 'active', 'acting', 'settling']
            .some(status => (Number.parseInt(counts[status], 10) || 0) > 0)
    }

    function normalizeRawCoordinatorQueueForReconcileFallback(rawQueue = {}) {
        const normalizedQueue = {}
        const now = getNow()
        for(const [itemKey, rawItem] of Object.entries(rawQueue || {})) {
            if(!rawItem || typeof rawItem !== 'object') continue
            if(!isCoordinatorQueueAuthoritativeItem(rawItem)) {
                normalizedQueue[itemKey] = rawItem
                continue
            }
            const href = getCoordinatorItemHref(rawItem) ||
                normalizeQuoraProfileUrl(itemKey) ||
                normalizeQuoraProfileUrl(rawItem.requestedUrl || rawItem.targetProfileHref || rawItem.dedupeKey || '')
            const requestedUrl = isProfileResolutionItem(rawItem) || `${itemKey || ''}`.trim().startsWith('resolve-profile:')
                ? getProfileResolutionRequestedUrl(rawItem, itemKey)
                : normalizeCoordinatorRequestedUrl(rawItem.requestedUrl || href || itemKey)
            const coordinatorKey = getCoordinatorItemQueueKey(rawItem, itemKey) || href || `${itemKey || ''}`.trim()
            const actionKind = getCoordinatorActionKindForRequestedAction(
                rawItem.actionKind ||
                rawItem.tabAction ||
                rawItem.executorTabAction ||
                'nuke'
            ) || 'mute-block'
            const executorTabAction = rawItem.executorTabAction ||
                rawItem.tabAction ||
                getCoordinatorExecutorTabActionForActionKind(actionKind) ||
                'nuke'
            const attemptId = getAttemptIdFromValue(rawItem)
            const attemptNumber = getAttemptNumberFromValue(rawItem)
            const maxAttempts = Number.parseInt(rawItem.maxAttempts ?? rawItem.maxRetries, 10) || STALE_QUEUED_TAB_MAX_RETRIES
            const baseItem = {
                ...rawItem,
                status: rawItem.status || 'queued',
                targetProfileHref: href || rawItem.targetProfileHref || '',
                requestedUrl,
                dedupeKey: rawItem.dedupeKey || href || coordinatorKey,
                coordinatorKey,
                actionKind,
                executorTabAction,
                tabAction: rawItem.tabAction || executorTabAction,
                executorOwner: rawItem.executorOwner || 'service-worker',
                serviceWorkerOwned: rawItem.serviceWorkerOwned !== false,
                ...(rawItem.executorNoForegroundFallback === true || rawItem.noForegroundFallback === true
                    ? {executorNoForegroundFallback: true}
                    : {}),
                executorMaxConcurrent: Number.parseInt(rawItem.executorMaxConcurrent, 10) || 1,
                ...(attemptId ? {attemptId} : {}),
                ...(attemptNumber ? {attemptNumber} : {}),
                maxAttempts,
                maxRetries: Number.parseInt(rawItem.maxRetries ?? rawItem.maxAttempts, 10) || STALE_QUEUED_TAB_MAX_RETRIES,
                ...(attemptId || attemptNumber
                    ? {attempt: makeCoordinatorAttemptEnvelope(rawItem, attemptId, attemptNumber, maxAttempts)}
                    : {}),
                createdAt: Number.parseInt(rawItem.createdAt, 10) || now,
                updatedAt: Number.parseInt(rawItem.updatedAt, 10) || now
            }
            normalizedQueue[itemKey] = applyCoordinatorJobEnvelope(baseItem, {
                targetProfileHref: href || '',
                requestedUrl,
                coordinatorKey,
                actionKind,
                runId: rawItem.runId || ''
            })
        }
        return normalizedQueue
    }

    function isCoordinatorReconcileEdgeTriggerReason(reason = '') {
        const normalized = `${reason || ''}`.trim()
        return /^(?:startup.*|content-ready.*|post-enqueue.*|dashboard-.*|manual|terminal-.*|tab-removed|active-transition-.*|claim-durable-confirmation-failed|queued-tab-(?:open-failed|fill-error)|.*(?:timeout|mismatch|runtime).*)$/i.test(normalized)
    }

    function clearNamedSchedulerAlarm(name = '') {
        if(!name || !browser.alarms?.clear) return

        try {
            const clearResult = browser.alarms.clear(name)
            if(clearResult?.catch) clearResult.catch(() => false)
        }
        catch {}
    }

    function clearCoordinatorReconcileAlarms() {
        clearNamedSchedulerAlarm(COORDINATOR_RECONCILE_ALARM_NAME)
    }

    function isCoordinatorReconcileAlarmName(name = '') {
        return name === COORDINATOR_RECONCILE_ALARM_NAME
    }

    function getSchedulerAlarmScheduledTime(alarm = null) {
        return Number.parseInt(alarm?.scheduledTime, 10) || 0
    }

    function isSchedulerAlarmScheduledForDueAt(scheduledTime = 0, dueAt = 0) {
        if(!scheduledTime || !dueAt) return false

        return scheduledTime >= dueAt - SCHEDULER_ALARM_TIME_TOLERANCE_MS &&
            scheduledTime <= dueAt + SCHEDULER_ALARM_LATE_TOLERANCE_MS
    }

    function suppressStaleCoordinatorResumeAlarm(dueAt = 0) {
        coordinatorQueueResumeScheduler.markAlarmSuppressed(dueAt, getNow(), STALE_SCHEDULER_ALARM_SUPPRESSION_MS)
        clearNamedSchedulerAlarm(COORDINATOR_RESUME_ALARM_NAME)
    }

    function suppressStaleCoordinatorReconcileAlarm(dueAt = 0) {
        coordinatorReconcileScheduler.markAlarmSuppressed(dueAt, getNow(), STALE_SCHEDULER_ALARM_SUPPRESSION_MS)
        clearCoordinatorReconcileAlarms()
    }

    function scheduleCoordinatorResumeAlarm(dueAt = 0) {
        const scheduledDueAt = Number.parseInt(dueAt, 10) || 0
        if(!scheduledDueAt || !browser.alarms?.create) return false

        try {
            const alarmResult = browser.alarms.create(COORDINATOR_RESUME_ALARM_NAME, {when: scheduledDueAt})
            const alarmPromise = coordinatorQueueResumeScheduler.setAlarmPromiseForDueAt(alarmResult, scheduledDueAt)
            alarmPromise.catch(() => false)
            incrementQueueWakeupMetric('pump.alarmScheduled')
            return true
        }
        catch {
            coordinatorQueueResumeScheduler.setAlarmPromise(Promise.resolve(false))
            return false
        }
    }

    function isSuppressedStaleCoordinatorResumeAlarm(alarm = null) {
        const scheduledTime = getSchedulerAlarmScheduledTime(alarm)
        const dueAt = coordinatorQueueResumeScheduler.getDueAt()
        if(dueAt && scheduledTime) {
            return !isSchedulerAlarmScheduledForDueAt(scheduledTime, dueAt)
        }
        if(dueAt) return false
        const clearedDueAt = coordinatorQueueResumeScheduler.getClearedAlarmDueAt()
        if(scheduledTime && clearedDueAt) {
            return isSchedulerAlarmScheduledForDueAt(scheduledTime, clearedDueAt)
        }

        return coordinatorQueueResumeScheduler.isSuppressionActive(getNow())
    }

    function isSuppressedStaleCoordinatorReconcileAlarm(alarm = null) {
        const scheduledTime = getSchedulerAlarmScheduledTime(alarm)
        const dueAt = coordinatorReconcileScheduler.getDueAt()
        if(dueAt && scheduledTime) {
            return !isSchedulerAlarmScheduledForDueAt(scheduledTime, dueAt)
        }
        if(dueAt) return false
        const clearedDueAt = coordinatorReconcileScheduler.getClearedAlarmDueAt()
        if(scheduledTime && clearedDueAt) {
            return isSchedulerAlarmScheduledForDueAt(scheduledTime, clearedDueAt)
        }

        return coordinatorReconcileScheduler.isSuppressionActive(getNow())
    }

    function resetCoordinatorReconcileBackoff(reason = 'reconcile-edge-trigger') {
        if(!coordinatorReconcileScheduler.resetBackoff()) return
        incrementQueueWakeupMetric('reconcile.backoffReset')
    }

    function recordCoordinatorReconcileNoopBackoff() {
        const backoff = coordinatorReconcileScheduler.recordNoopBackoff(
            COORDINATOR_RECONCILE_BACKOFF_BASE_MS,
            COORDINATOR_RECONCILE_BACKOFF_MAX_MS,
            getNow()
        )
        recordQueueWakeupMetricMax('reconcile.backoffLevel.max', backoff.level)
        recordQueueWakeupMetricMax('reconcile.backoffDelay.maxMs', backoff.delayMs)
    }

    function hasCoordinatorReconcileBackoff(now = getNow()) {
        return coordinatorReconcileScheduler.hasBackoff(now)
    }

    function scheduleCoordinatorReconcileExecutorContinuation(after = null, authority = null, reason = 'reconcile', options = {}) {
        if(!((after?.hasStoredWork && !after?.paused) || authority?.budgetExhausted === true)) {
            return false
        }

        if(authority?.budgetExhausted === true) {
            incrementQueueWakeupMetric('reconcile.rescheduled')
            scheduleCoordinatorQueueResume(1000, 'reconcile-authority-budget-exhausted', {
                allowBeforeQuora: options.allowBeforeQuora === true
            })
            return true
        }

        if(shouldContinueQueuedOnlyWorkWithFastExecutor(after)) {
            scheduleQueuedOnlyDurableWorkContinuation(`${reason || 'reconcile'}-queued-only-fast-resume`, {
                awaitFill: options.awaitFill !== false,
                allowBeforeQuora: options.allowBeforeQuora === true
            })
            return true
        }

        incrementQueueWakeupMetric('reconcile.rescheduled')
        scheduleCoordinatorQueueResume(1000, 'reconcile-has-stored-work', {
            allowBeforeQuora: options.allowBeforeQuora === true
        })
        return true
    }

    return {
        nextCoordinatorPauseGeneration,
        isCoordinatorPauseGenerationLocallyCurrent,
        isCoordinatorPauseRequestedLocally,
        scheduleCoordinatorPauseStateReconcile,
        buildPausedCoordinatorQueueItem,
        hasStoredCoordinatorWork,
        hasStoredCoordinatorWorkInQueueView,
        normalizeRawCoordinatorQueueForReconcileFallback,
        isCoordinatorReconcileEdgeTriggerReason,
        clearNamedSchedulerAlarm,
        clearCoordinatorReconcileAlarms,
        isCoordinatorReconcileAlarmName,
        getSchedulerAlarmScheduledTime,
        isSchedulerAlarmScheduledForDueAt,
        suppressStaleCoordinatorResumeAlarm,
        suppressStaleCoordinatorReconcileAlarm,
        scheduleCoordinatorResumeAlarm,
        isSuppressedStaleCoordinatorResumeAlarm,
        isSuppressedStaleCoordinatorReconcileAlarm,
        resetCoordinatorReconcileBackoff,
        recordCoordinatorReconcileNoopBackoff,
        hasCoordinatorReconcileBackoff,
        scheduleCoordinatorReconcileExecutorContinuation
    }
}

module.exports = {
    createSwSchedulerAlarmBookkeeping
}
