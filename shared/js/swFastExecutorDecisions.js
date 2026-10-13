// Fast-executor decide functions extracted from sw.js (decomposition Slices
// P2-13 through P2-17): decideFastExecutorPausedOutcome,
// decideFastExecutorThrottleGate, decideFastExecutorAuthorityPreflightOutcome,
// decideFastExecutorEmptyRuntimeRetryOutcome, decideFastExecutorFinalOutcome.
// All five were decomposed out of runCoordinatorQueueExecutorFastPath, which
// remains in sw.js and calls back into each of these in turn.

function createFastExecutorDecisions(deps = {}) {
    const {
        browser,
        queueRuntime,
        COORDINATOR_RESUME_ALARM_NAME,
        QUEUED_TAB_FINAL_OPEN_AUTHORITY_RETRY_MS,
        incrementQueueWakeupMetric,
        getQueueLoadThrottle,
        getSchedulerBlockingQueuedExecutorCount,
        rememberQueueLoadProgress,
        scheduleCoordinatorQueueResume,
        scheduleCoordinatorReconcile
    } = deps.handlers || {}

    function decideFastExecutorPausedOutcome() {
        incrementQueueWakeupMetric('pump.fastExecutor.paused')
        void browser.alarms?.clear?.(COORDINATOR_RESUME_ALARM_NAME).catch(() => false)
        return {
            queued: 0,
            pending: 0,
            active: 0,
            changed: false,
            paused: true,
            fastPath: true,
            reason: 'coordinator-paused'
        }
    }

    function decideFastExecutorThrottleGate(params = {}) {
        const {options} = params
        const throttle = getQueueLoadThrottle()
        if(throttle?.active === true && getSchedulerBlockingQueuedExecutorCount() > 0) {
            const delayMs = Math.max(1000, throttle.until - Date.now())
            scheduleCoordinatorQueueResume(delayMs, 'queue-load-throttle', {
                allowBeforeQuora: options.allowBeforeQuora === true
            })
            incrementQueueWakeupMetric('pump.fastExecutor.throttled')
            return {
                queued: 0,
                pending: 0,
                active: 0,
                changed: false,
                throttled: true,
                fastPath: true,
                reason: 'queue-load-throttled'
            }
        }
        if(throttle?.active === true && getSchedulerBlockingQueuedExecutorCount() <= 0) {
            rememberQueueLoadProgress('fast-executor-idle-durable-work')
        }
        return null
    }

    function decideFastExecutorAuthorityPreflightOutcome(params = {}) {
        const {authorityPreflight, reason, options} = params
        let authorityPreflightChanged = false
        if(authorityPreflight?.changed === true || (authorityPreflight?.actions || 0) > 0) {
            authorityPreflightChanged = true
            incrementQueueWakeupMetric('pump.fastExecutor.authorityPreflightChanged')
            scheduleCoordinatorQueueResume(1000, `${reason || 'resume'}-post-authority-preflight`, {
                allowBeforeQuora: options.allowBeforeQuora === true
            })
            if(options.continueAfterAuthorityPreflight === true) {
                incrementQueueWakeupMetric('pump.fastExecutor.authorityPreflightContinued')
            }
            else {
                return {
                    authorityPreflightChanged,
                    earlyReturn: {
                        ...(authorityPreflight || {}),
                        queued: 0,
                        pending: 0,
                        active: 0,
                        changed: true,
                        fastPath: true,
                        reason: 'fast-executor-authority-preflight-changed'
                    }
                }
            }
        }
        return {authorityPreflightChanged, earlyReturn: null}
    }

    function decideFastExecutorEmptyRuntimeRetryOutcome(params = {}) {
        const {options, result, reason} = params
        const runtimeCountsAfterResume = queueRuntime.getRuntimeCounts()
        const runtimeSurfaceEmpty = !getSchedulerBlockingQueuedExecutorCount() &&
            runtimeCountsAfterResume.queuedTabActions <= 0 &&
            runtimeCountsAfterResume.pendingTabActions <= 0
        const queuedOrPendingPlanned = ((Number.parseInt(result?.queued, 10) || 0) > 0 ||
            (Number.parseInt(result?.pending, 10) || 0) > 0)
        if(options.awaitFill !== false &&
            options.forceDurableQueueReload !== true &&
            options.forcedDurableRuntimeRecovery !== true &&
            result?.timedOut !== true &&
            result?.fillResult?.timedOut !== true &&
            result?.fillResult?.reason !== 'queued-tab-open-failed' &&
            result?.fillResult?.reason !== 'queued-tab-fill-timeout' &&
            result?.fillResult?.reason !== 'queued-tab-final-open-decision-timeout' &&
            result?.fillResult?.authorityUnavailable !== true &&
            runtimeSurfaceEmpty &&
            queuedOrPendingPlanned &&
            (Number.parseInt(result?.active, 10) || 0) <= 0 &&
            (Number.parseInt(result?.adopted, 10) || 0) <= 0) {
            const followupReason = `${reason || 'resume'}-empty-runtime-retry`
            const alreadyHandlingEmptyRuntime = /empty-runtime/.test(`${reason || ''}`)
            if(!alreadyHandlingEmptyRuntime) {
                incrementQueueWakeupMetric('pump.fastExecutor.emptyRuntimeDurableReload')
                scheduleCoordinatorQueueResume(1000, followupReason, {
                    allowBeforeQuora: options.allowBeforeQuora === true
                })
                scheduleCoordinatorReconcile(1000, {
                    reason: followupReason,
                    edgeTriggered: true,
                    allowBeforeQuora: options.allowBeforeQuora === true
                })
            }
            else {
                incrementQueueWakeupMetric('pump.fastExecutor.emptyRuntimeRetryAlreadyScheduled')
            }
            return {
                ...(result || {}),
                emptyRuntimeRetryScheduled: !alreadyHandlingEmptyRuntime,
                fastPath: true,
                reason: alreadyHandlingEmptyRuntime
                    ? (result?.reason || 'empty-runtime-retry-already-scheduled')
                    : 'empty-runtime-retry-scheduled'
            }
        }
        return null
    }

    function decideFastExecutorFinalOutcome(params = {}) {
        const {result, authorityPreflightChanged, options, reason, authorityPreflight} = params
        const changed = (result?.queued || 0) > 0 ||
            (result?.adopted || 0) > 0 ||
            (result?.active || 0) > 0 ||
            (result?.runtimeActive || 0) > 0 ||
            authorityPreflightChanged ||
            result?.changed === true
        const reportedChanged = authorityPreflightChanged && options.continueAfterAuthorityPreflight === true
            ? false
            : changed
        if(result?.timedOut === true) {
            const followupReason = `${reason || 'resume'}-fast-executor-timeout-continuation`
            incrementQueueWakeupMetric('pump.fastExecutor.timeoutContinuation')
            scheduleCoordinatorQueueResume(1000, followupReason, {
                allowBeforeQuora: true
            })
        }
        if(result?.fillResult?.authorityUnavailable === true ||
            result?.fillResult?.reason === 'final-open-decision-timeout' ||
            result?.fillResult?.reason === 'queued-tab-final-open-decision-timeout') {
            scheduleCoordinatorReconcile(QUEUED_TAB_FINAL_OPEN_AUTHORITY_RETRY_MS, {
                reason: result.fillResult.reason || 'queued-tab-final-open-authority-unavailable',
                edgeTriggered: true,
                allowBeforeQuora: true
            })
        }
        if(changed) {
            incrementQueueWakeupMetric('pump.fastExecutor.changed')
            if(!getSchedulerBlockingQueuedExecutorCount() &&
                queueRuntime.getActivationIntentCount() <= 0 &&
                queueRuntime.getPendingTabActionCount() <= 0 &&
                ((Number.parseInt(result?.queued, 10) || 0) > 0 ||
                    (Number.parseInt(result?.pending, 10) || 0) > 0)) {
                const followupReason = `${reason || 'resume'}-changed-without-runtime`
                scheduleCoordinatorQueueResume(1000, followupReason, {
                    allowBeforeQuora: true
                })
            }
        }
        else {
            incrementQueueWakeupMetric('pump.fastExecutor.noop')
        }

        return {
            ...(result || {}),
            authorityPreflight: authorityPreflightChanged ? authorityPreflight : undefined,
            authorityPreflightChanged,
            changed: reportedChanged,
            fastPath: true,
            reason: result?.reason || 'fast-executor-resume'
        }
    }

    return {
        decideFastExecutorPausedOutcome,
        decideFastExecutorThrottleGate,
        decideFastExecutorAuthorityPreflightOutcome,
        decideFastExecutorEmptyRuntimeRetryOutcome,
        decideFastExecutorFinalOutcome
    }
}

module.exports = {createFastExecutorDecisions}
