/*
 * ARCHITECTURE: Volatile scheduler state.
 *
 * Timers and browser alarms are non-persistent runtime effects. This module
 * owns the mutable slot bookkeeping so scheduler policy can stop reaching into
 * raw timeout handles and due-time fields.
 */

function createSchedulerSlot(options = {}) {
    const setTimeoutFn = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout
    const clearTimeoutFn = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout
    const nowFn = typeof options.now === 'function' ? options.now : () => Date.now()
    let timeout = null
    let dueAt = 0
    let reason = `${options.reason || ''}`.trim()
    let allowBeforeQuora = false
    let alarmSuppressUntil = 0
    let clearedAlarmDueAt = 0
    let alarmCreatedForDueAt = 0
    let alarmPromise = null
    let backoffLevel = 0
    let backoffUntil = 0

    function hasTimeout() {
        return !!timeout
    }

    function getDueAt() {
        return dueAt
    }

    function getReason() {
        return reason
    }

    function setReason(value = '') {
        reason = `${value || ''}`.trim()
        return reason
    }

    function getAllowBeforeQuora() {
        return allowBeforeQuora
    }

    function setAllowBeforeQuora(value = false) {
        allowBeforeQuora = value === true
        return allowBeforeQuora
    }

    function mergeAllowBeforeQuora(value = false) {
        if(value === true) allowBeforeQuora = true
        return allowBeforeQuora
    }

    function clearTimeoutHandle() {
        if(timeout) clearTimeoutFn(timeout)
        const hadTimeout = !!timeout
        timeout = null
        return hadTimeout
    }

    function clearTimeoutState() {
        timeout = null
    }

    function clearSchedule() {
        clearTimeoutHandle()
        dueAt = 0
        reason = ''
        allowBeforeQuora = false
    }

    function clearDueAt() {
        dueAt = 0
    }

    function schedule(dueAtValue = 0, callback = null) {
        const normalizedDueAt = Number.parseInt(dueAtValue, 10) || 0
        clearTimeoutHandle()
        dueAt = normalizedDueAt
        if(!normalizedDueAt || typeof callback !== 'function') {
            timeout = null
            return false
        }
        timeout = setTimeoutFn(callback, Math.max(0, normalizedDueAt - nowFn()))
        return true
    }

    function markTimeoutFired(expectedDueAt = 0) {
        if(dueAt !== expectedDueAt) return false
        timeout = null
        dueAt = 0
        return true
    }

    function isStale(now = Date.now(), toleranceMs = 0) {
        return !!(timeout && dueAt && dueAt + toleranceMs < now)
    }

    function shouldCoalesce(candidateDueAt = 0) {
        return !!(timeout && dueAt && dueAt <= candidateDueAt)
    }

    function setAlarmPromiseForDueAt(promise, scheduledDueAt = 0) {
        const normalizedDueAt = Number.parseInt(scheduledDueAt, 10) || 0
        alarmPromise = Promise.resolve(promise).then(() => {
            alarmCreatedForDueAt = normalizedDueAt
            return true
        }, () => {
            if(alarmCreatedForDueAt === normalizedDueAt) alarmCreatedForDueAt = 0
            return false
        })
        return alarmPromise
    }

    function setAlarmPromise(value = null) {
        alarmPromise = value
        return alarmPromise
    }

    function getAlarmPromise() {
        return alarmPromise
    }

    function getAlarmCreatedForDueAt() {
        return alarmCreatedForDueAt
    }

    function isAlarmCreatedForCurrentDueAt() {
        return !!(dueAt && alarmCreatedForDueAt === dueAt)
    }

    function clearAlarmTracking() {
        alarmCreatedForDueAt = 0
        alarmPromise = null
    }

    function markAlarmSuppressed(scheduledDueAt = 0, now = Date.now(), ttlMs = 0) {
        clearedAlarmDueAt = Number.parseInt(scheduledDueAt, 10) || clearedAlarmDueAt || 0
        alarmSuppressUntil = now + (Number.parseInt(ttlMs, 10) || 0)
        clearAlarmTracking()
    }

    function isSuppressionActive(now = Date.now()) {
        return alarmSuppressUntil > now
    }

    function getClearedAlarmDueAt() {
        return clearedAlarmDueAt
    }

    function resetBackoff() {
        if(!backoffLevel && !backoffUntil) return false
        backoffLevel = 0
        backoffUntil = 0
        return true
    }

    function recordNoopBackoff(baseMs = 0, maxMs = 0, now = Date.now()) {
        backoffLevel = Math.min(6, backoffLevel + 1)
        const delayMs = Math.min(
            Number.parseInt(maxMs, 10) || 0,
            (Number.parseInt(baseMs, 10) || 0) * (2 ** Math.max(0, backoffLevel - 1))
        )
        backoffUntil = now + delayMs
        return {level: backoffLevel, delayMs, until: backoffUntil}
    }

    function hasBackoff(now = Date.now()) {
        return backoffUntil > now
    }

    function getBackoffLevel() {
        return backoffLevel
    }

    function getBackoffUntil() {
        return backoffUntil
    }

    function snapshot() {
        return {
            dueAt,
            reason,
            timeout: !!timeout,
            allowBeforeQuora,
            alarmSuppressUntil,
            clearedAlarmDueAt,
            alarmCreatedForDueAt,
            alarmPromise: !!alarmPromise,
            backoffLevel,
            backoffUntil
        }
    }

    return {
        clearAlarmTracking,
        clearDueAt,
        clearSchedule,
        clearTimeoutHandle,
        clearTimeoutState,
        getAlarmCreatedForDueAt,
        getAlarmPromise,
        getAllowBeforeQuora,
        getBackoffLevel,
        getBackoffUntil,
        getClearedAlarmDueAt,
        getDueAt,
        getReason,
        hasBackoff,
        hasTimeout,
        isAlarmCreatedForCurrentDueAt,
        isStale,
        isSuppressionActive,
        markAlarmSuppressed,
        markTimeoutFired,
        mergeAllowBeforeQuora,
        recordNoopBackoff,
        resetBackoff,
        schedule,
        setAlarmPromise,
        setAlarmPromiseForDueAt,
        setAllowBeforeQuora,
        setReason,
        shouldCoalesce,
        snapshot
    }
}

module.exports = {
    createSchedulerSlot
}
