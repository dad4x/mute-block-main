// Activation-guard and profile-open-reservation bookkeeping extracted from
// sw.js (decomposition Slice 5). This is the layer that stops the same
// queued action from being claimed/opened twice while a tab attach is in
// flight: a per-attempt "activation guard" keyed on owner/subject/action-
// kind/attempt, and a shorter-lived "profile-open reservation" keyed on the
// target profile href, both volatile service-worker memory (never durable
// authority).
//
// The profile-open-reservation Map itself already lives inside
// swqueueRuntime.js's createQueueRuntimeState() (a prior, independent
// extraction) -- this module's profile-open-reservation functions are thin
// wrappers that call into the passed-in `queueRuntime` instance rather than
// owning that collection themselves.
//
// The activation-guard Map (`queuedActivationGuards`), by contrast, was
// still a bare sw.js module-level `const` before this slice, and -- unlike
// Slices 2-4's shared metric state -- nothing outside this cluster needs to
// read or write it except by key, so this module owns it outright, hidden
// behind named methods, following the swqueueRuntime.js-style stateful-
// factory convention and architecture.md's "Runtime Queue Boundary" note
// that ordinary code should not mutate raw runtime maps directly. Three
// call sites elsewhere in sw.js touched the raw Map directly (a claimed
// guard gets its tabId/openedAt filled in once the tab is actually created,
// and gets deleted outright if tab creation throws); those are exposed here
// as mergeActivationGuardTabInfo/deleteActivationGuardByKey rather than
// re-exposing the Map, so sw.js no longer reaches into it directly at all.
//
// hasQueuedActivationGuard was folded in alongside the plan's named 15
// functions: it's textually interleaved between pruneQueuedActivationGuards
// and claimQueuedActivationGuard, and reads the same private Map, so it
// can't stay behind in sw.js once the Map moves.
//
// Every Date.now() call found in the moved bodies (two default-parameter
// clock reads, two inline timestamp reads) is threaded through as a
// `now: () => Date.now()` dep instead, per the decomposition plan's clock/
// environment-global note -- this module runs in a different V8 realm than
// sw.js under the test harness's vm sandbox, so a bare `Date` reference
// here would resolve to the real Node clock instead of the harness's fake
// one, even for these synchronous, non-timer call sites.

function createActivationGuardRuntime(deps = {}) {
    const {
        now: getNow = () => Date.now()
    } = deps
    const {
        QUEUED_PROFILE_OPEN_RESERVATION_TTL_MS,
        QUEUED_ACTIVATION_GUARD_TTL_MS,
        SERVICE_WORKER_QUEUE_OWNER_ID
    } = deps.constants || {}
    const {
        queueRuntime,
        incrementQueueWakeupMetric,
        pushQueueWakeupJournalEntry,
        recordFlightRecorderEvent,
        normalizeQuoraProfileUrl,
        normalizeTabId,
        getCoordinatorItemQueueKey,
        getAttemptIdFromValue,
        getAttemptNumberFromValue,
        getCoordinatorActionKindForRequestedAction,
        getCoordinatorItemHref,
        getQueuedTabActionKey,
        getCoordinatorItemExecutorTabAction,
        queuedRuntimeActionHasActiveOrPendingSurface,
        shouldDropQueuedActionForCurrentAuthority
    } = deps.handlers || {}
    const {
        getCoordinatorAuthority = () => null
    } = deps.state || {}

    const queuedActivationGuards = new Map()

    function pruneQueuedProfileOpenReservations(now = getNow()) {
        queueRuntime.pruneProfileOpenReservations(now, QUEUED_PROFILE_OPEN_RESERVATION_TTL_MS)
    }

    function getQueuedProfileOpenReservationCount() {
        pruneQueuedProfileOpenReservations()
        return queueRuntime.getProfileOpenReservationCount()
    }

    function clearDetachedQueuedProfileOpenReservations(reason = 'detached-profile-open-reservations') {
        pruneQueuedProfileOpenReservations()
        if(!queueRuntime.getProfileOpenReservationCount()) return 0
        if(queueRuntime.hasActiveOrPendingQueuedTabs()) return 0
        const cleared = queueRuntime.clearProfileOpenReservations()
        incrementQueueWakeupMetric('pump.changed.clearedDetachedProfileOpenReservations', cleared)
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'queued-profile-open-reservations-cleared',
            reason,
            result: 'state-changed',
            resultReason: 'detached-profile-open-reservations',
            details: {
                cleared
            }
        })
        return cleared
    }

    function getQueuedProfileOpenReservationKey(value = null) {
        if(value && typeof value === 'object') {
            const profileHref = normalizeQuoraProfileUrl(
                value.profileHref ||
                    value.targetProfileHref ||
                    value.requestedUrl ||
                    value.url ||
                    ''
            )
            if(profileHref) return profileHref

            return getCoordinatorItemQueueKey(
                value,
                value.coordinatorKey || value.requestedUrl || value.url || ''
            ) || `${value.coordinatorKey || value.requestedUrl || value.url || ''}`.trim()
        }

        return normalizeQuoraProfileUrl(value || '') || `${value || ''}`.trim()
    }

    function reserveQueuedProfileOpen(action = null, reason = 'queued-profile-open') {
        const reservationKey = getQueuedProfileOpenReservationKey(action)
        if(!reservationKey) return ''
        pruneQueuedProfileOpenReservations()
        const existing = queueRuntime.getProfileOpenReservation(reservationKey)
        if(existing) return ''
        queueRuntime.setProfileOpenReservation(reservationKey, {
            reservedAt: getNow(),
            reason,
            attemptId: getAttemptIdFromValue(action),
            attemptNumber: getAttemptNumberFromValue(action),
            runId: action?.runId || ''
        })
        return reservationKey
    }

    function releaseQueuedProfileOpenReservation(value = '') {
        const reservationKey = getQueuedProfileOpenReservationKey(value)
        if(reservationKey) queueRuntime.deleteProfileOpenReservation(reservationKey)
    }

    function getQueuedActivationGuardKey(value = null) {
        if(!value || typeof value !== 'object') return ''

        const subjectKey = getQueuedProfileOpenReservationKey(value)
        const ownerId = value.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID
        const actionKind = getCoordinatorActionKindForRequestedAction(
            value.actionKind ||
                value.tabAction ||
                value.action ||
                ''
        )
        const attemptId = getAttemptIdFromValue(value)
        const attemptNumber = getAttemptNumberFromValue(value)
        if(!ownerId || !subjectKey || !actionKind || !attemptId || !attemptNumber) return ''
        return [ownerId, subjectKey, actionKind, attemptId, attemptNumber].join('|')
    }

    function getQueuedRuntimeActionSubjectHref(action = null, targetItem = null) {
        return action?.profileHref ||
            action?.targetProfileHref ||
            action?.coordinatorKey ||
            action?.requestedUrl ||
            action?.url ||
            getCoordinatorItemHref(targetItem) ||
            ''
    }

    function getQueuedRuntimeActionFillKey(action = null, targetItem = null) {
        if(!action && !targetItem) return ''
        const subject = getQueuedRuntimeActionSubjectHref(action, targetItem)
        return getQueuedTabActionKey(
            action?.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
            subject,
            action?.tabAction || getCoordinatorItemExecutorTabAction(targetItem)
        )
    }

    function pruneQueuedActivationGuards(now = getNow()) {
        let pruned = 0
        for(const [key, guard] of queuedActivationGuards.entries()) {
            const guardedAt = Number.parseInt(guard?.guardedAt, 10) || 0
            if(!guardedAt || now - guardedAt > QUEUED_ACTIVATION_GUARD_TTL_MS) {
                queuedActivationGuards.delete(key)
                pruned += 1
            }
        }
        if(pruned > 0) {
            incrementQueueWakeupMetric('pump.changed.prunedActivationGuards', pruned)
        }
        return pruned
    }

    function hasQueuedActivationGuard(value = null) {
        const key = getQueuedActivationGuardKey(value)
        if(!key) return false
        pruneQueuedActivationGuards()
        return queuedActivationGuards.has(key)
    }

    function claimQueuedActivationGuard(value = null, tab = null, reason = 'queued-activation') {
        const key = getQueuedActivationGuardKey(value)
        if(!key) return ''
        pruneQueuedActivationGuards()
        if(queuedActivationGuards.has(key)) return ''
        queuedActivationGuards.set(key, {
            guardedAt: getNow(),
            reason,
            tabId: normalizeTabId(tab?.id || value?.tabId || value?.activeTabId || null),
            runId: value?.runId || '',
            attemptId: getAttemptIdFromValue(value),
            attemptNumber: getAttemptNumberFromValue(value)
        })
        return key
    }

    function releaseQueuedActivationGuard(value = null) {
        const key = getQueuedActivationGuardKey(value)
        return key ? queuedActivationGuards.delete(key) : false
    }

    function releaseQueuedActivationGuardForTab(tabId = null, metadata = null) {
        if(metadata && releaseQueuedActivationGuard(metadata)) return true
        const normalizedTabId = normalizeTabId(tabId)
        if(!normalizedTabId) return false
        let released = false
        for(const [key, guard] of queuedActivationGuards.entries()) {
            if(normalizeTabId(guard?.tabId) !== normalizedTabId) continue
            queuedActivationGuards.delete(key)
            released = true
        }
        return released
    }

    function filterRestorableActivationIntents(actions = [], options = {}) {
        if(!Array.isArray(actions) || !actions.length) return []
        pruneQueuedActivationGuards()
        const queue = options.currentAuthorityState?.queue ||
            getCoordinatorAuthority()?.current?.()?.queue ||
            null
        return actions.filter(action => {
            if(!action) return false
            if(hasQueuedActivationGuard(action)) return false
            if(queuedRuntimeActionHasActiveOrPendingSurface(action)) return false
            if(queue && shouldDropQueuedActionForCurrentAuthority(action, queue)) return false
            return true
        })
    }

    function pruneDuplicateQueuedTabActions(reason = 'queued-tab-action-dedupe') {
        const seen = new Set()
        let pruned = 0
        for(let index = 0; index < queueRuntime.getActivationIntentCount();) {
            const action = queueRuntime.getActivationIntentAt(index)
            const subject = normalizeQuoraProfileUrl(
                action?.profileHref ||
                    action?.targetProfileHref ||
                    action?.requestedUrl ||
                    action?.coordinatorKey ||
                    action?.url ||
                    ''
            ) || `${action?.coordinatorKey || action?.url || ''}`.trim()
            const key = getQueuedTabActionKey(
                action?.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
                subject,
                action?.tabAction || ''
            )
            if(key && seen.has(key)) {
                queueRuntime.dropRuntimeActionAt(index)
                pruned += 1
                continue
            }
            if(key) seen.add(key)
            index += 1
        }
        if(pruned > 0) {
            incrementQueueWakeupMetric('pump.changed.prunedDuplicateQueuedActions', pruned)
            recordFlightRecorderEvent({
                kind: 'queued-tab-action-pruned',
                source: 'pruneDuplicateQueuedTabActions',
                accepted: false,
                changed: true,
                reason,
                count: pruned
            })
        }
        return pruned
    }

    function mergeActivationGuardTabInfo(key = '', patch = {}) {
        if(!key) return false
        queuedActivationGuards.set(key, {
            ...(queuedActivationGuards.get(key) || {}),
            ...(patch || {})
        })
        return true
    }

    function deleteActivationGuardByKey(key = '') {
        return key ? queuedActivationGuards.delete(key) : false
    }

    return {
        pruneQueuedProfileOpenReservations,
        getQueuedProfileOpenReservationCount,
        clearDetachedQueuedProfileOpenReservations,
        getQueuedProfileOpenReservationKey,
        reserveQueuedProfileOpen,
        releaseQueuedProfileOpenReservation,
        getQueuedActivationGuardKey,
        getQueuedRuntimeActionSubjectHref,
        getQueuedRuntimeActionFillKey,
        pruneQueuedActivationGuards,
        hasQueuedActivationGuard,
        claimQueuedActivationGuard,
        releaseQueuedActivationGuard,
        releaseQueuedActivationGuardForTab,
        filterRestorableActivationIntents,
        pruneDuplicateQueuedTabActions,
        mergeActivationGuardTabInfo,
        deleteActivationGuardByKey
    }
}

module.exports = {
    createActivationGuardRuntime
}
