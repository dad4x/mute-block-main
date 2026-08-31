// Queue-wakeup metric "shape" helpers extracted from sw.js (decomposition
// Slice 2). These are the normalize/build/get functions that operate on
// the queue-wakeup-metrics epoch/throttle/journal shapes -- pure or
// near-pure functions with no async work of their own.
//
// The metrics themselves (queueWakeupMetrics, queueLoadThrottle, and the
// small set of loaded/dirty/generation/ready-promise flags around them)
// stay as module-level `let` state in sw.js, because they're also read and
// written well outside this slice's scope (the storage load/persist path
// and other far-away coordinator code, both still in sw.js). They're
// threaded through here as live get/set accessors, following the same
// pattern swBootstrap.js uses for state it doesn't own.
//
// Slice 2 and Slice 3 (the queue-wakeup metric *recording*/journal
// functions -- incrementQueueWakeupMetric and friends) are the same
// subsystem split only for slice-size reasons. This module intentionally
// takes recording/journal functions (incrementQueueWakeupMetric,
// pushQueueWakeupJournalEntry, sanitizeQueueWakeupMetricDetails) as deps
// rather than defining them, so Slice 3 can either fold into this module
// or land as its own sibling -- that decision is left to whoever runs
// Slice 3.

function createQueueWakeupMetricsShape(deps = {}) {
    const {
        browser,
        now: getNow = () => Date.now()
    } = deps
    const {
        QUEUE_WAKEUP_METRICS_VERSION,
        MAX_QUEUE_WAKEUP_METRIC_JOURNAL,
        MAX_QUEUE_WAKEUP_METRICS_VIEW_JOURNAL,
        MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY,
        QUEUE_LOAD_THROTTLE_BASE_MS,
        QUEUE_LOAD_THROTTLE_MAX_MS,
        QUEUE_LOAD_THROTTLE_MAX_LEVEL,
        QUEUE_LOAD_THROTTLE_SIGNAL_COOLDOWN_MS,
        QUEUED_TAB_CLAIM_NUDGE_TIMEOUT_ESCALATION_MS
    } = deps.constants || {}
    const {
        getQueueWakeupMetrics,
        setQueueWakeupMetrics,
        getQueueLoadThrottleState,
        setQueueLoadThrottleState,
        getQueueWakeupMetricGeneration,
        setQueueWakeupMetricGeneration,
        getQueueWakeupMetricsLoaded,
        setQueueWakeupMetricsLoaded,
        setQueueWakeupMetricsDirty,
        getQueueWakeupMetricsReadyPromise,
        setQueueWakeupMetricsReadyPromise
    } = deps.state || {}
    const {
        incrementQueueWakeupMetric,
        pushQueueWakeupJournalEntry,
        scheduleCoordinatorQueueResume,
        sanitizeQueueWakeupMetricDetails,
        scheduleQueueWakeupMetricsFlush,
        loadQueueWakeupMetrics,
        normalizeObjectNumberMap,
        normalizeQueueWakeupPhaseMap
    } = deps.handlers || {}

    function getExtensionVersion() {
        try {
            return `${browser.runtime.getManifest?.()?.version || ''}`.trim()
        }
        catch {
            return ''
        }
    }

    function makeQueueWakeupMetricEpoch(resetReason = 'schema-reset', startedAt = getNow()) {
        return {
            epochId: `epoch-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
            resetReason,
            startedAt,
            updatedAt: 0,
            extensionVersion: getExtensionVersion(),
            firstServiceWorkerStartedAt: 0,
            lastServiceWorkerStartedAt: 0,
            queueLoadThrottle: makeEmptyQueueLoadThrottle(),
            counters: {},
            phases: {},
            journal: []
        }
    }

    function makeEmptyQueueLoadThrottle() {
        return {
            active: false,
            level: 0,
            concurrency: 0,
            until: 0,
            lastPressureAt: 0,
            lastProgressAt: 0,
            reason: '',
            message: ''
        }
    }

    function makeEmptyQueueWakeupMetrics(resetReason = 'schema-reset') {
        return {
            version: QUEUE_WAKEUP_METRICS_VERSION,
            currentEpoch: makeQueueWakeupMetricEpoch(resetReason),
            previousEpochs: [],
            lifetime: {
                startedAt: getNow(),
                updatedAt: 0,
                resetCount: 0,
                counters: {}
            }
        }
    }

    function normalizeQueueWakeupMetricEpoch(value = null, fallbackReason = 'schema-reset') {
        const source = value && typeof value === 'object' ? value : {}
        const startedAt = Number.parseInt(source.startedAt, 10) || getNow()
        return {
            epochId: `${source.epochId || ''}`.trim() || `epoch-${startedAt}`,
            resetReason: `${source.resetReason || fallbackReason || 'schema-reset'}`.trim(),
            startedAt,
            updatedAt: Number.parseInt(source.updatedAt, 10) || 0,
            extensionVersion: `${source.extensionVersion || getExtensionVersion() || ''}`.trim(),
            firstServiceWorkerStartedAt: Number.parseInt(source.firstServiceWorkerStartedAt, 10) || 0,
            lastServiceWorkerStartedAt: Number.parseInt(source.lastServiceWorkerStartedAt, 10) || 0,
            queueLoadThrottle: normalizeQueueLoadThrottle(source.queueLoadThrottle),
            counters: normalizeObjectNumberMap(source.counters),
            phases: normalizeQueueWakeupPhaseMap(source.phases),
            journal: Array.isArray(source.journal)
                ? source.journal.filter(entry => entry && typeof entry === 'object').slice(-MAX_QUEUE_WAKEUP_METRIC_JOURNAL)
                : []
        }
    }

    function normalizeQueueLoadThrottle(value = null) {
        const source = value && typeof value === 'object' ? value : {}
        const until = Number.parseInt(source.until, 10) || 0
        const level = Math.max(0, Math.min(QUEUE_LOAD_THROTTLE_MAX_LEVEL, Number.parseInt(source.level, 10) || 0))
        const active = source.active === true && level > 0 && until > getNow()
        return {
            active,
            level: active ? level : 0,
            concurrency: active ? 1 : 0,
            until: active ? until : 0,
            lastPressureAt: Number.parseInt(source.lastPressureAt, 10) || 0,
            lastProgressAt: Number.parseInt(source.lastProgressAt, 10) || 0,
            reason: `${source.reason || ''}`.trim(),
            message: `${source.message || ''}`.trim()
        }
    }

    function normalizeQueueWakeupMetrics(value = null) {
        const source = value && typeof value === 'object' ? value : {}
        if((Number.parseInt(source.version, 10) || 0) === QUEUE_WAKEUP_METRICS_VERSION) {
            return {
                version: QUEUE_WAKEUP_METRICS_VERSION,
                currentEpoch: normalizeQueueWakeupMetricEpoch(source.currentEpoch, 'schema-reset'),
                previousEpochs: normalizeQueueWakeupMetricEpochHistory(source.previousEpochs),
                lifetime: normalizeQueueWakeupMetricLifetime(source.lifetime)
            }
        }

        const previousEpochs = []
        if(source.counters || source.phases || source.journal) {
            previousEpochs.push(summarizeQueueWakeupMetricEpoch(
                normalizeQueueWakeupMetricEpoch({
                    ...source,
                    resetReason: `${source.resetReason || 'pre-schema-cumulative'}`
                }, 'pre-schema-cumulative'),
                'schema-reset'
            ))
        }

        const metrics = makeEmptyQueueWakeupMetrics('schema-reset')
        metrics.previousEpochs = previousEpochs.slice(-MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY)
        return metrics
    }

    function buildQueueWakeupMetricsView(value = getQueueWakeupMetrics()) {
        const metrics = normalizeQueueWakeupMetrics(value)
        const epoch = normalizeQueueWakeupMetricEpoch(metrics.currentEpoch, 'schema-reset')
        const lifetime = normalizeQueueWakeupMetricLifetime(metrics.lifetime)
        return {
            version: QUEUE_WAKEUP_METRICS_VERSION,
            viewVersion: 1,
            updatedAt: getNow(),
            currentEpoch: {
                ...epoch,
                counters: {...epoch.counters},
                phases: {...epoch.phases},
                journal: Array.isArray(epoch.journal)
                    ? epoch.journal.slice(-MAX_QUEUE_WAKEUP_METRICS_VIEW_JOURNAL).map(compactQueueWakeupJournalEntry)
                    : []
            },
            previousEpochs: normalizeQueueWakeupMetricEpochHistory(metrics.previousEpochs),
            lifetime: {
                startedAt: lifetime.startedAt,
                updatedAt: lifetime.updatedAt,
                resetCount: lifetime.resetCount
            }
        }
    }

    function compactQueueWakeupJournalEntry(entry = {}) {
        return {
            kind: `${entry.kind || 'cycle'}`.trim(),
            name: `${entry.name || ''}`.trim(),
            reason: `${entry.reason || ''}`.trim(),
            result: `${entry.result || ''}`.trim(),
            resultReason: `${entry.resultReason || ''}`.trim(),
            at: Number.parseInt(entry.at, 10) || 0,
            durationMs: Math.max(0, Number(entry.durationMs) || 0),
            details: sanitizeQueueWakeupMetricDetails(entry.details || {})
        }
    }

    function buildPersistedQueueWakeupMetricEpoch(epoch = {}, fallbackReason = 'schema-reset') {
        const normalized = normalizeQueueWakeupMetricEpoch(epoch, fallbackReason)
        return {
            ...normalized,
            journal: Array.isArray(normalized.journal)
                ? normalized.journal.slice(-MAX_QUEUE_WAKEUP_METRICS_VIEW_JOURNAL).map(compactQueueWakeupJournalEntry)
                : []
        }
    }

    function buildPersistedQueueWakeupMetrics(value = getQueueWakeupMetrics()) {
        const metrics = normalizeQueueWakeupMetrics(value)
        const lifetime = normalizeQueueWakeupMetricLifetime(metrics.lifetime)
        return {
            version: QUEUE_WAKEUP_METRICS_VERSION,
            currentEpoch: buildPersistedQueueWakeupMetricEpoch(metrics.currentEpoch, 'schema-reset'),
            previousEpochs: normalizeQueueWakeupMetricEpochHistory(metrics.previousEpochs),
            lifetime: {
                startedAt: lifetime.startedAt,
                updatedAt: lifetime.updatedAt,
                resetCount: lifetime.resetCount
            }
        }
    }

    function normalizeQueueWakeupMetricEpochHistory(value = null) {
        return Array.isArray(value)
            ? value.filter(entry => entry && typeof entry === 'object').slice(-MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY)
            : []
    }

    function normalizeQueueWakeupMetricLifetime(value = null) {
        const source = value && typeof value === 'object' ? value : {}
        return {
            startedAt: Number.parseInt(source.startedAt, 10) || getNow(),
            updatedAt: Number.parseInt(source.updatedAt, 10) || 0,
            resetCount: Math.max(0, Number.parseInt(source.resetCount, 10) || 0),
            counters: normalizeObjectNumberMap(source.counters)
        }
    }

    function getQueueWakeupMetricEpoch() {
        if(!getQueueWakeupMetrics()?.currentEpoch) {
            setQueueWakeupMetrics(makeEmptyQueueWakeupMetrics())
        }
        return getQueueWakeupMetrics().currentEpoch
    }

    function getQueueLoadThrottle(now = getNow()) {
        let throttle = normalizeQueueLoadThrottle(getQueueLoadThrottleState())
        setQueueLoadThrottleState(throttle)
        if(throttle.active && throttle.until > now) return throttle
        if(throttle.level || throttle.active || throttle.until) {
            throttle = {
                ...makeEmptyQueueLoadThrottle(),
                lastPressureAt: throttle.lastPressureAt || 0,
                lastProgressAt: throttle.lastProgressAt || 0,
                reason: throttle.reason || '',
                message: throttle.message || ''
            }
            setQueueLoadThrottleState(throttle)
            syncQueueLoadThrottleToMetrics()
        }
        return throttle
    }

    function getQueueLoadThrottleDelayMs(level = 1) {
        const normalizedLevel = Math.max(1, Math.min(QUEUE_LOAD_THROTTLE_MAX_LEVEL, Number.parseInt(level, 10) || 1))
        return Math.min(
            QUEUE_LOAD_THROTTLE_MAX_MS,
            QUEUE_LOAD_THROTTLE_BASE_MS * (2 ** (normalizedLevel - 1))
        )
    }

    function syncQueueLoadThrottleToMetrics() {
        const epoch = getQueueWakeupMetricEpoch()
        epoch.queueLoadThrottle = normalizeQueueLoadThrottle(getQueueLoadThrottleState())
        epoch.updatedAt = getNow()
        scheduleQueueWakeupMetricsFlush()
    }

    function rememberQueueLoadPressure(reason = 'queue-load-pressure', details = {}) {
        const now = getNow()
        const existing = getQueueLoadThrottle(now)
        if(existing.lastPressureAt && now - existing.lastPressureAt < QUEUE_LOAD_THROTTLE_SIGNAL_COOLDOWN_MS) {
            return existing
        }

        const level = Math.min(QUEUE_LOAD_THROTTLE_MAX_LEVEL, Math.max(1, existing.level + 1))
        const delayMs = getQueueLoadThrottleDelayMs(level)
        const normalizedReason = `${reason || 'queue-load-pressure'}`.trim()
        const throttle = {
            active: true,
            level,
            concurrency: 1,
            until: now + delayMs,
            lastPressureAt: now,
            lastProgressAt: existing.lastProgressAt || 0,
            reason: normalizedReason,
            message: `Quora slow: throttled to 1 tab, retrying in ${Math.ceil(delayMs / 1000)}s`
        }
        setQueueLoadThrottleState(throttle)
        incrementQueueWakeupMetric(`throttle.pressure.${normalizedReason}`)
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'queue-load-throttle',
            reason: normalizedReason,
            result: 'state-changed',
            details: {
                ...details,
                throttleLevel: level,
                retryInMs: delayMs
            }
        })
        syncQueueLoadThrottleToMetrics()
        scheduleCoordinatorQueueResume(delayMs, 'queue-load-throttle')
        return throttle
    }

    function rememberQueueLoadProgress(reason = 'action-phase-progress') {
        const existing = getQueueLoadThrottle()
        if(!existing.active && !existing.level) return existing

        const now = getNow()
        const throttle = {
            ...makeEmptyQueueLoadThrottle(),
            lastPressureAt: existing.lastPressureAt || 0,
            lastProgressAt: now,
            reason,
            message: 'Quora responsive: queue throttle recovering'
        }
        setQueueLoadThrottleState(throttle)
        incrementQueueWakeupMetric('throttle.recovered.actionProgress')
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'queue-load-throttle',
            reason,
            result: 'recovered'
        })
        syncQueueLoadThrottleToMetrics()
        return throttle
    }

    function rememberQueuedTabActivationFailure(reason = 'queued-tab-activation-failed', details = {}) {
        const normalizedReason = `${reason || 'queued-tab-activation-failed'}`.trim() || 'queued-tab-activation-failed'
        incrementQueueWakeupMetric(`activation.failure.${normalizedReason}`)
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'queued-tab-activation-failure',
            reason: normalizedReason,
            result: 'no-op',
            resultReason: normalizedReason,
            details
        })
        scheduleCoordinatorQueueResume(1000, normalizedReason, {
            allowBeforeQuora: true
        })
        return {
            recorded: true,
            reason: normalizedReason
        }
    }

    function shouldEscalateQueuedTabClaimNudgeTimeout(metadata = null, now = getNow()) {
        const lastFailedAt = Number.parseInt(metadata?.lastNudgeFailedAt, 10) || 0
        if(!lastFailedAt) return false
        const lastFailure = `${metadata?.lastNudgeFailure || ''}`.trim()
        if(!/timed out/i.test(lastFailure)) return false
        return now - lastFailedAt >= QUEUED_TAB_CLAIM_NUDGE_TIMEOUT_ESCALATION_MS
    }

    function sumQueueWakeupCounters(counters = {}, prefix = '') {
        return Object.entries(counters || {})
            .filter(([key]) => `${key || ''}`.startsWith(prefix))
            .reduce((total, [, value]) => total + (Number(value) || 0), 0)
    }

    function getQueueWakeupCounterRatio(numerator = 0, denominator = 0) {
        const bottom = Number(denominator) || 0
        return bottom ? (Number(numerator) || 0) / bottom : 0
    }

    function summarizeQueueWakeupMetricEpoch(epoch = {}, rolloverReason = '') {
        const counters = epoch.counters || {}
        const storageStarted = counters['storageUpdate.started'] || 0
        const storageTimedOut = counters['storageUpdate.timedOut'] || 0
        const storageDeadlineMissed = counters['storageUpdate.deadlineMissed'] || 0
        const storageFallbackReturned = counters['storageUpdate.fallbackReturned'] || 0
        const writeBytes = counters['storagePayload.write.total.bytes'] || 0
        const writeCalls = counters['storagePayload.write.total.calls'] || 0
        const reconcileRequested = counters['reconcile.requested'] || 0
        const reconcileChanged = sumQueueWakeupCounters(counters, 'reconcile.changed.')
        const pumpRequested = counters['pump.requested'] || 0
        const pumpChanged = sumQueueWakeupCounters(counters, 'pump.changed.')
        const nudgeSent = counters['nudge.sent'] || 0
        const nudgeAccepted = counters['nudge.accepted'] || 0
        const jobsEnqueued = counters['job.enqueued'] || 0
        const jobsTerminal = counters['job.terminal'] || 0
        const completedAfterReconcile = counters['job.completedOnlyAfterReconcile'] || 0

        return {
            epochId: epoch.epochId || '',
            resetReason: epoch.resetReason || '',
            rolloverReason: `${rolloverReason || ''}`.trim(),
            startedAt: Number.parseInt(epoch.startedAt, 10) || 0,
            endedAt: getNow(),
            updatedAt: Number.parseInt(epoch.updatedAt, 10) || 0,
            extensionVersion: epoch.extensionVersion || '',
            firstServiceWorkerStartedAt: Number.parseInt(epoch.firstServiceWorkerStartedAt, 10) || 0,
            lastServiceWorkerStartedAt: Number.parseInt(epoch.lastServiceWorkerStartedAt, 10) || 0,
            storage: {
                started: storageStarted,
                timedOut: storageTimedOut,
                timeoutRate: getQueueWakeupCounterRatio(storageTimedOut, storageStarted),
                deadlineMissed: storageDeadlineMissed,
                fallbackReturned: storageFallbackReturned
            },
            storagePayload: {
                writeBytes,
                writeCalls,
                maxBytes: counters['storagePayload.write.total.maxBytes'] || 0
            },
            reconcile: {
                requested: reconcileRequested,
                changed: reconcileChanged
            },
            pump: {
                requested: pumpRequested,
                changed: pumpChanged,
                yield: getQueueWakeupCounterRatio(pumpChanged, pumpRequested)
            },
            nudge: {
                sent: nudgeSent,
                accepted: nudgeAccepted,
                yield: getQueueWakeupCounterRatio(nudgeAccepted, nudgeSent)
            },
            jobs: {
                enqueued: jobsEnqueued,
                terminal: jobsTerminal,
                completedAfterReconcile,
                completedAfterReconcileRate: getQueueWakeupCounterRatio(completedAfterReconcile, jobsTerminal)
            },
            maxPayloadSize: counters['storagePayload.write.total.maxBytes'] || 0,
            journalCount: Array.isArray(epoch.journal) ? epoch.journal.length : 0
        }
    }

    function addQueueWakeupLifetimeCounters(epoch = {}) {
        const lifetime = normalizeQueueWakeupMetricLifetime(getQueueWakeupMetrics().lifetime)
        for(const [key, value] of Object.entries(epoch.counters || {})) {
            lifetime.counters[key] = (lifetime.counters[key] || 0) + (Number(value) || 0)
        }
        lifetime.updatedAt = getNow()
        lifetime.resetCount += 1
        getQueueWakeupMetrics().lifetime = lifetime
    }

    function resetQueueWakeupMetricsEpoch(reason = 'manual') {
        const normalizedReason = `${reason || 'manual'}`.trim()
        const currentEpoch = getQueueWakeupMetricEpoch()
        const previousEpochs = normalizeQueueWakeupMetricEpochHistory(getQueueWakeupMetrics().previousEpochs)
        if(currentEpoch.updatedAt || Object.keys(currentEpoch.counters || {}).length || (currentEpoch.journal || []).length) {
            previousEpochs.push(summarizeQueueWakeupMetricEpoch(currentEpoch, normalizedReason))
            addQueueWakeupLifetimeCounters(currentEpoch)
        }

        setQueueWakeupMetrics({
            version: QUEUE_WAKEUP_METRICS_VERSION,
            currentEpoch: makeQueueWakeupMetricEpoch(normalizedReason),
            previousEpochs: previousEpochs.slice(-MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY),
            lifetime: normalizeQueueWakeupMetricLifetime(getQueueWakeupMetrics().lifetime)
        })
        setQueueLoadThrottleState(makeEmptyQueueLoadThrottle())
        const epoch = getQueueWakeupMetricEpoch()
        const now = getNow()
        epoch.firstServiceWorkerStartedAt = now
        epoch.lastServiceWorkerStartedAt = now
        epoch.counters['serviceWorker.started'] = 1
        epoch.updatedAt = now
        setQueueWakeupMetricGeneration(getQueueWakeupMetricGeneration() + 1)
        setQueueWakeupMetricsLoaded(true)
        setQueueWakeupMetricsDirty(true)
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'metrics-epoch-reset',
            reason: normalizedReason,
            result: 'state-changed'
        })
    }

    function isFreshQueueWakeupMetricsEpoch(reason = 'manual') {
        const epoch = getQueueWakeupMetricEpoch()
        const normalizedReason = `${reason || 'manual'}`.trim()
        const counters = Object.keys(epoch.counters || {})
        const phases = Object.keys(epoch.phases || {})
        return `${epoch.resetReason || ''}`.trim() === normalizedReason &&
            `${epoch.extensionVersion || ''}`.trim() === getExtensionVersion() &&
            counters.every(key => key === 'serviceWorker.started') &&
            phases.length === 0
    }

    function ensureQueueWakeupMetricsLoaded() {
        if(getQueueWakeupMetricsLoaded()) return Promise.resolve(getQueueWakeupMetrics())
        if(!getQueueWakeupMetricsReadyPromise()) {
            setQueueWakeupMetricsReadyPromise(
                loadQueueWakeupMetrics()
                    .finally(() => {
                        setQueueWakeupMetricsReadyPromise(null)
                    })
            )
        }
        return getQueueWakeupMetricsReadyPromise()
    }

    return {
        getExtensionVersion,
        makeQueueWakeupMetricEpoch,
        makeEmptyQueueLoadThrottle,
        makeEmptyQueueWakeupMetrics,
        normalizeQueueWakeupMetricEpoch,
        normalizeQueueLoadThrottle,
        normalizeQueueWakeupMetrics,
        buildQueueWakeupMetricsView,
        compactQueueWakeupJournalEntry,
        buildPersistedQueueWakeupMetricEpoch,
        buildPersistedQueueWakeupMetrics,
        normalizeQueueWakeupMetricEpochHistory,
        normalizeQueueWakeupMetricLifetime,
        getQueueWakeupMetricEpoch,
        getQueueLoadThrottle,
        getQueueLoadThrottleDelayMs,
        syncQueueLoadThrottleToMetrics,
        rememberQueueLoadPressure,
        rememberQueueLoadProgress,
        rememberQueuedTabActivationFailure,
        shouldEscalateQueuedTabClaimNudgeTimeout,
        sumQueueWakeupCounters,
        getQueueWakeupCounterRatio,
        summarizeQueueWakeupMetricEpoch,
        addQueueWakeupLifetimeCounters,
        resetQueueWakeupMetricsEpoch,
        isFreshQueueWakeupMetricsEpoch,
        ensureQueueWakeupMetricsLoaded
    }
}

module.exports = {
    createQueueWakeupMetricsShape
}
