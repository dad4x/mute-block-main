const browser = require('webextension-polyfill')
const defaults = require('./defaults')
const {
    SPACE_NUKED_POSTS_KEY,
    getPrunedNukedPosts
} = require('./nukedPosts')
const {
    QUORA_NON_PROFILE_ROOT_PATHS,
    normalizeQuoraProfileHref: normalizeQuoraProfileUrl,
    normalizeTabTargetUrl
} = require('./subject')
const {
    getJobMilestonesFromProgress,
    getActionKindForRequestedAction,
    getExecutorTabActionForActionKind,
    getQueueItemExecutorTabAction,
    isRetryableJobFailure,
    isRetryableJobFailureFromProgress,
    isTerminalJobStatus,
    JOB_EVENT_ENQUEUED,
    JOB_EVENT_MILESTONE,
    JOB_EVENT_PAUSE,
    JOB_EVENT_RETRY,
    JOB_EVENT_TAB_OPENED,
    JOB_EVENT_TAB_REMOVED,
    JOB_EVENT_TERMINAL,
    makeCanonicalSubject,
    makeEmptyJobMilestones,
    mapProgressToCoordinatorState,
    reduceJobEvent,
    UNBLOCK_UNMUTE_ACTION_KIND
} = require('./jobState')
const {
    activateCheckpoint,
    appendWalRecordsToGeneration,
    applyWalRecord,
    getWalRecordsForGeneration,
    makePairedCheckpointStore,
    recoverProjectedState,
    writeInactiveCheckpoint
} = require('./walSnapshotStore')
const pendingTabActions = new Map()
const queuedTabMetadata = new Map()
const queuedTabActions = []
const activeQueuedTabs = new Set()
const ownedTabIdsByParent = new Map()
const owningParentByChild = new Map()
const canceledQueuedUrlsByOwner = new Map()
const pausedQueuedOwners = new Set()
const OWNED_TAB_STATE_KEY = 'mbOwnedTabIdsByParent'
const PROFILE_NUKE_PROGRESS_KEY = 'mbProfileNukeProgress'
const SPACE_PENDING_NUKED_POSTS_KEY = 'mbSpacePendingNukedPosts'
const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'
const COORDINATOR_QUEUE_WAL_KEY = 'mbCoordinatorQueueWal'
const COORDINATOR_QUEUE_VIEW_KEY = 'mbCoordinatorQueueView'
const COORDINATOR_CONTENT_QUEUE_INDEX_KEY = 'mbCoordinatorContentQueueIndex'
const COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX = 'mbCoordinatorContentSourceIndex.'
const PROFILE_NUKE_PROGRESS_VIEW_KEY = 'mbProfileNukeProgressView'
const PROFILE_NUKE_PROGRESS_SHARD_PREFIX = 'mbProfileNukeProgressShard.'
const COORDINATOR_RUNS_KEY = 'mbCoordinatorRuns'
const COORDINATOR_EVENTS_KEY = 'mbCoordinatorEvents'
const QUEUE_WAKEUP_METRICS_KEY = 'mbQueueWakeupMetrics'
const QUEUE_WAKEUP_METRICS_VIEW_KEY = 'mbQueueWakeupMetricsView'
const BROWSER_SESSION_MARKER_KEY = 'mbBrowserSessionMarker'
const QUORA_RUNTIME_ACTIVATED_SESSION_KEY = 'mbQuoraRuntimeActivated'
const QUEUE_WAKEUP_METRICS_VERSION = 4
const COORDINATOR_TAB_KEY = 'mbCoordinatorTabId'
const QUEUED_ACTION_SURFACE_COORDINATOR_HASH = '#worker-window'
const COORDINATOR_RETRY_FAILED_ENABLED_KEY = 'mbCoordinatorRetryFailedEnabled'
const COORDINATOR_PAUSED_KEY = 'mbCoordinatorPaused'
const COORDINATOR_PAUSE_GENERATION_KEY = 'mbCoordinatorPauseGeneration'
const COORDINATOR_DASHBOARD_STATE_KEYS = new Set([
    COORDINATOR_QUEUE_VIEW_KEY,
    COORDINATOR_RUNS_KEY,
    COORDINATOR_EVENTS_KEY,
    QUEUE_WAKEUP_METRICS_VIEW_KEY,
    COORDINATOR_RETRY_FAILED_ENABLED_KEY,
    COORDINATOR_PAUSED_KEY
])
const SERVICE_WORKER_QUEUE_OWNER_ID = 'service-worker-queue-owner'
const MAX_PROFILE_NUKE_PROGRESS_ENTRIES = 1000
const MAX_COORDINATOR_EVENTS = 500
const MAX_COORDINATOR_QUEUE_VIEW_ITEMS = 80
const MAX_COORDINATOR_CONTENT_QUEUE_INDEX_ITEMS = 1200
const MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS = 1200
const PROFILE_NUKE_PROGRESS_COMPATIBILITY_FLUSH_MS = 30000
const COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT = 32
const PROFILE_NUKE_PROGRESS_SHARD_COUNT = 32
const MAX_QUEUE_WAKEUP_METRIC_JOURNAL = 240
const MAX_QUEUE_WAKEUP_METRICS_VIEW_JOURNAL = 30
const MAX_QUEUE_WAKEUP_METRIC_PHASES = 64
const MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY = 8
const CURRENT_WORK_RETENTION_MS = 24 * 60 * 60 * 1000
const TERMINAL_COORDINATOR_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'canceled'])
const STALE_ACTIVE_QUEUED_TAB_MS = 10000
const STALE_BACKGROUND_OPENING_QUEUED_TAB_MS = 45000
const STALE_BACKGROUND_READY_QUEUED_TAB_MS = 35000
const STALE_ACTIVE_ACTION_QUEUED_TAB_MS = 90000
const STALE_UNBLOCK_UNMUTE_ACTION_QUEUED_TAB_MS = 90000
const STALE_FOREGROUND_WAIT_QUEUED_TAB_MS = 90000
const COORDINATOR_ACTIVE_JOB_MAX_MS = 120000
const COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS = 180000
const PERSISTED_EXECUTOR_TRANSIENT_URL_MAX_AGE_MS = 15000
const ACTION_LEASE_MS = 90000
const STALE_CLOSE_REQUESTED_QUEUED_TAB_MS = 8000
const STALE_QUEUED_TAB_MAX_RETRIES = 1
const FOREGROUND_LEASE_WAIT_EVENT_MS = 5000
const STORED_WORK_REPAIR_INTERVAL_MS = 5000
const STORED_WORK_REPAIR_BACKOFF_BASE_MS = 5000
const STORED_WORK_REPAIR_BACKOFF_MAX_MS = 60000
const STALE_SCHEDULER_ALARM_SUPPRESSION_MS = 5000
const SCHEDULER_ALARM_TIME_TOLERANCE_MS = 100
const SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS = 15000
const QUEUE_WAKEUP_METRICS_STORAGE_TIMEOUT_MS = 3000
const QUORA_RUNTIME_TAB_QUERY_TIMEOUT_MS = 1000
const COORDINATOR_REPAIR_GATE_TIMEOUT_MS = 15000
const COORDINATOR_RESUME_GATE_TIMEOUT_MS = 30000
const COORDINATOR_STORED_WORK_RESTORE_TIMEOUT_MS = 20000
const COORDINATOR_JOB_MILESTONE_FLUSH_MS = 3000
const PERSISTENT_FAILED_RETRY_INTERVAL_MS = 5000
const PERSISTENT_FAILED_RETRY_ALARM_NAME = 'mb-persistent-failed-retry'
const PERSISTENT_FAILED_RETRY_ALARM_PERIOD_MINUTES = 0.5
const COORDINATOR_RESUME_ALARM_NAME = 'mb-coordinator-resume'
const COORDINATOR_STORED_WORK_REPAIR_ALARM_NAME = 'mb-stored-work-repair'
const QUEUED_PROFILE_RESOLUTION_MODE = 'author-profile'
const CONTENT_SCRIPT_READY_ATTR = 'data-mb-content-script-ready'
const QUEUED_TAB_CONTENT_SCRIPT_CHECK_DELAY_MS = 750
const QUEUED_TAB_CONTENT_SCRIPT_ENSURE_TIMEOUT_MS = 5000
const QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS = 2500
const QUEUED_TAB_ACTIVE_TRANSITION_TIMEOUT_MS = SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS + 5000
const QUEUE_LOAD_THROTTLE_BASE_MS = 15000
const QUEUE_LOAD_THROTTLE_MAX_MS = 120000
const QUEUE_LOAD_THROTTLE_MAX_LEVEL = 5
const QUEUE_LOAD_THROTTLE_SIGNAL_COOLDOWN_MS = 2000
const COORDINATOR_RECONCILE_OBSERVE_ROW_BUDGET = 250
const COORDINATOR_RECONCILE_ACTION_BUDGET = 25
const MAX_PROGRESS_SHADOW_WAL_RECORDS = 128
const MAX_COORDINATOR_AUTHORITY_SHADOW_WAL_RECORDS = 128
const COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS = new Set([
    'terminal-progress',
    'row-event-progress-milestone',
    'terminal-settlement',
    'action-lease-heartbeat',
    'action-lease-release',
    'repair-non-profile-landing',
    'repair-key-only-terminalize',
    'current-work-item-cancel',
    'stale-retry',
    'rollback-active-transition',
    'repair-active-without-actor',
    'active-transition',
    'action-lease-request',
    'action-lease-tab-release'
])
let persistOwnedTabIdsTimeout = null
let coordinatorQueueResumeTimeout = null
let coordinatorQueueResumeDueAt = 0
let coordinatorQueueResumeReason = ''
let coordinatorQueueResumeAlarmSuppressUntil = 0
let coordinatorQueueResumeClearedAlarmDueAt = 0
let storedWorkRepairTimeout = null
let storedWorkRepairDueAt = 0
let storedWorkRepairBackoffLevel = 0
let storedWorkRepairBackoffUntil = 0
let storedWorkRepairAlarmSuppressUntil = 0
let storedWorkRepairClearedAlarmDueAt = 0
let persistentRetryFailedTimeout = null
let persistentRetryFailedPromise = null
let queuedTabReleaseFollowUpTimeout = null
let coordinatorPauseGeneration = 0
let coordinatorPauseRequested = false
let queuedTabConcurrency = 1
let queuedTabFillPromise = null
let profileNukeProgress = {}
let coordinatorAuthorityShadowWalStore = makePairedCheckpointStore({queue: {}}, {
    snapshotSeq: 0,
    createdAt: Date.now()
})
let coordinatorAuthorityShadowWalProjectedState = {queue: {}}
let coordinatorAuthorityShadowWalProjectionSnapshotSeq = 0
let coordinatorAuthorityShadowWalProjectionMaxSeq = 0
let coordinatorAuthorityShadowWalAppliedIds = new Set()
let progressShadowWalStore = makePairedCheckpointStore({progress: {}}, {
    snapshotSeq: 0,
    createdAt: Date.now()
})
let progressShadowWalProjectedState = {progress: {}}
let progressShadowWalProjectionSnapshotSeq = 0
let progressShadowWalProjectionMaxSeq = 0
let progressShadowWalAppliedIds = new Set()
let spaceFeedStorageUpdatePromise = Promise.resolve()
let spaceFeedStorageUpdateDepth = 0
let spaceFeedStorageUpdateSerial = 0
let activeSpaceFeedStorageUpdateToken = 0
const abandonedSpaceFeedStorageUpdates = new Set()
let pendingCoordinatorDiagnosticEvents = []
let coordinatorDiagnosticBatchDepth = 0
let coordinatorProgressSyncPromise = Promise.resolve()
let coordinatorProgressSyncActive = false
let coordinatorProgressSyncPendingRecords = {}
let coordinatorJobMilestoneFlushTimeout = null
let coordinatorJobMilestoneFlushPromise = null
let coordinatorJobMilestonePendingRecords = {}
let coordinatorTabId = null
let coordinatorOpenPromise = null
let queuedActionSurfaceWindowId = null
let queuedActionSurfaceAnchorTabId = null
let queuedActionSurfaceOpenPromise = null
let queuedActionSurfaceCleanupTimeout = null
let queuedActionSurfaceCleanupDueAt = 0
let coordinatorDedupePromise = Promise.resolve()
let coordinatorResumePromise = null
let coordinatorReconcilePromise = null
let coordinatorEnqueuePromise = Promise.resolve()
let coordinatorExecutorStartPromise = Promise.resolve()
let coordinatorStoredWorkRestorePromise = null
let queuedForegroundLeaseTabId = null
let queueWakeupMetrics = makeEmptyQueueWakeupMetrics()
let queueWakeupMetricsFlushPromise = null
let queueWakeupMetricsDirty = false
let queueWakeupMetricsLoaded = false
let queueWakeupMetricCycleSerial = 0
let queueWakeupMetricGeneration = 0
let queueWakeupMetricsReadyPromise = null
let pendingQueueWakeupMetricsReset = null
let browserSessionStartupResetChecked = false
let browserSessionStartupResetPromise = null
let activeQueueWakeupStorageContext = null
let quoraRuntimeActivated = false
let queueLoadThrottle = makeEmptyQueueLoadThrottle()

function getExtensionVersion() {
    try {
        return `${browser.runtime.getManifest?.()?.version || ''}`.trim()
    }
    catch {
        return ''
    }
}

function makeQueueWakeupMetricEpoch(resetReason = 'schema-reset', startedAt = Date.now()) {
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
            startedAt: Date.now(),
            updatedAt: 0,
            resetCount: 0,
            counters: {}
        }
    }
}

function normalizeQueueWakeupMetricEpoch(value = null, fallbackReason = 'schema-reset') {
    const source = value && typeof value === 'object' ? value : {}
    const startedAt = Number.parseInt(source.startedAt, 10) || Date.now()
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
    const active = source.active === true && level > 0 && until > Date.now()
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
                resetReason: `${source.resetReason || 'legacy-cumulative'}`
            }, 'legacy-cumulative'),
            'schema-reset'
        ))
    }

    const metrics = makeEmptyQueueWakeupMetrics('schema-reset')
    metrics.previousEpochs = previousEpochs.slice(-MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY)
    return metrics
}

function buildQueueWakeupMetricsView(value = queueWakeupMetrics) {
    const metrics = normalizeQueueWakeupMetrics(value)
    const epoch = normalizeQueueWakeupMetricEpoch(metrics.currentEpoch, 'schema-reset')
    const lifetime = normalizeQueueWakeupMetricLifetime(metrics.lifetime)
    return {
        version: QUEUE_WAKEUP_METRICS_VERSION,
        viewVersion: 1,
        updatedAt: Date.now(),
        currentEpoch: {
            ...epoch,
            counters: {...epoch.counters},
            phases: {...epoch.phases},
            journal: Array.isArray(epoch.journal)
                ? epoch.journal.slice(-MAX_QUEUE_WAKEUP_METRICS_VIEW_JOURNAL)
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

function normalizeQueueWakeupMetricEpochHistory(value = null) {
    return Array.isArray(value)
        ? value.filter(entry => entry && typeof entry === 'object').slice(-MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY)
        : []
}

function normalizeQueueWakeupMetricLifetime(value = null) {
    const source = value && typeof value === 'object' ? value : {}
    return {
        startedAt: Number.parseInt(source.startedAt, 10) || Date.now(),
        updatedAt: Number.parseInt(source.updatedAt, 10) || 0,
        resetCount: Math.max(0, Number.parseInt(source.resetCount, 10) || 0),
        counters: normalizeObjectNumberMap(source.counters)
    }
}

function getQueueWakeupMetricEpoch() {
    if(!queueWakeupMetrics?.currentEpoch) {
        queueWakeupMetrics = makeEmptyQueueWakeupMetrics()
    }
    return queueWakeupMetrics.currentEpoch
}

function getQueueLoadThrottle(now = Date.now()) {
    queueLoadThrottle = normalizeQueueLoadThrottle(queueLoadThrottle)
    if(queueLoadThrottle.active && queueLoadThrottle.until > now) return queueLoadThrottle
    if(queueLoadThrottle.level || queueLoadThrottle.active || queueLoadThrottle.until) {
        queueLoadThrottle = {
            ...makeEmptyQueueLoadThrottle(),
            lastPressureAt: queueLoadThrottle.lastPressureAt || 0,
            lastProgressAt: queueLoadThrottle.lastProgressAt || 0,
            reason: queueLoadThrottle.reason || '',
            message: queueLoadThrottle.message || ''
        }
        syncQueueLoadThrottleToMetrics()
    }
    return queueLoadThrottle
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
    epoch.queueLoadThrottle = normalizeQueueLoadThrottle(queueLoadThrottle)
    epoch.updatedAt = Date.now()
    scheduleQueueWakeupMetricsFlush()
}

function rememberQueueLoadPressure(reason = 'queue-load-pressure', details = {}) {
    const now = Date.now()
    const existing = getQueueLoadThrottle(now)
    if(existing.lastPressureAt && now - existing.lastPressureAt < QUEUE_LOAD_THROTTLE_SIGNAL_COOLDOWN_MS) {
        return existing
    }

    const level = Math.min(QUEUE_LOAD_THROTTLE_MAX_LEVEL, Math.max(1, existing.level + 1))
    const delayMs = getQueueLoadThrottleDelayMs(level)
    const normalizedReason = `${reason || 'queue-load-pressure'}`.trim()
    queueLoadThrottle = {
        active: true,
        level,
        concurrency: 1,
        until: now + delayMs,
        lastPressureAt: now,
        lastProgressAt: existing.lastProgressAt || 0,
        reason: normalizedReason,
        message: `Quora slow: throttled to 1 tab, retrying in ${Math.ceil(delayMs / 1000)}s`
    }
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
    scheduleStoredWorkRepair(delayMs, {reason: 'queue-load-throttle'})
    return queueLoadThrottle
}

function rememberQueueLoadProgress(reason = 'action-phase-progress') {
    const existing = getQueueLoadThrottle()
    if(!existing.active && !existing.level) return existing

    const now = Date.now()
    queueLoadThrottle = {
        ...makeEmptyQueueLoadThrottle(),
        lastPressureAt: existing.lastPressureAt || 0,
        lastProgressAt: now,
        reason,
        message: 'Quora responsive: queue throttle recovering'
    }
    incrementQueueWakeupMetric('throttle.recovered.actionProgress')
    pushQueueWakeupJournalEntry({
        kind: 'state-change',
        name: 'queue-load-throttle',
        reason,
        result: 'recovered'
    })
    syncQueueLoadThrottleToMetrics()
    return queueLoadThrottle
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
    const repairRequested = counters['repair.requested'] || 0
    const repairChanged = sumQueueWakeupCounters(counters, 'repair.changed.')
    const pumpRequested = counters['pump.requested'] || 0
    const pumpChanged = sumQueueWakeupCounters(counters, 'pump.changed.')
    const nudgeSent = counters['nudge.sent'] || 0
    const nudgeAccepted = counters['nudge.accepted'] || 0
    const jobsEnqueued = counters['job.enqueued'] || 0
    const jobsTerminal = counters['job.terminal'] || 0
    const completedAfterRepair = counters['job.completedOnlyAfterRepair'] || 0

    return {
        epochId: epoch.epochId || '',
        resetReason: epoch.resetReason || '',
        rolloverReason: `${rolloverReason || ''}`.trim(),
        startedAt: Number.parseInt(epoch.startedAt, 10) || 0,
        endedAt: Date.now(),
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
        repair: {
            requested: repairRequested,
            changed: repairChanged
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
            completedAfterRepair,
            completedAfterRepairRate: getQueueWakeupCounterRatio(completedAfterRepair, jobsTerminal)
        },
        maxPayloadSize: counters['storagePayload.write.total.maxBytes'] || 0,
        journalCount: Array.isArray(epoch.journal) ? epoch.journal.length : 0
    }
}

function addQueueWakeupLifetimeCounters(epoch = {}) {
    const lifetime = normalizeQueueWakeupMetricLifetime(queueWakeupMetrics.lifetime)
    for(const [key, value] of Object.entries(epoch.counters || {})) {
        lifetime.counters[key] = (lifetime.counters[key] || 0) + (Number(value) || 0)
    }
    lifetime.updatedAt = Date.now()
    lifetime.resetCount += 1
    queueWakeupMetrics.lifetime = lifetime
}

function resetQueueWakeupMetricsEpoch(reason = 'manual') {
    const normalizedReason = `${reason || 'manual'}`.trim()
    const currentEpoch = getQueueWakeupMetricEpoch()
    const previousEpochs = normalizeQueueWakeupMetricEpochHistory(queueWakeupMetrics.previousEpochs)
    if(currentEpoch.updatedAt || Object.keys(currentEpoch.counters || {}).length || (currentEpoch.journal || []).length) {
        previousEpochs.push(summarizeQueueWakeupMetricEpoch(currentEpoch, normalizedReason))
        addQueueWakeupLifetimeCounters(currentEpoch)
    }

    queueWakeupMetrics = {
        version: QUEUE_WAKEUP_METRICS_VERSION,
        currentEpoch: makeQueueWakeupMetricEpoch(normalizedReason),
        previousEpochs: previousEpochs.slice(-MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY),
        lifetime: normalizeQueueWakeupMetricLifetime(queueWakeupMetrics.lifetime)
    }
    queueLoadThrottle = makeEmptyQueueLoadThrottle()
    const epoch = getQueueWakeupMetricEpoch()
    const now = Date.now()
    epoch.firstServiceWorkerStartedAt = now
    epoch.lastServiceWorkerStartedAt = now
    epoch.counters['serviceWorker.started'] = 1
    epoch.updatedAt = now
    queueWakeupMetricGeneration += 1
    queueWakeupMetricsLoaded = true
    queueWakeupMetricsDirty = true
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
    if(queueWakeupMetricsLoaded) return Promise.resolve(queueWakeupMetrics)
    if(!queueWakeupMetricsReadyPromise) {
        queueWakeupMetricsReadyPromise = loadQueueWakeupMetrics()
            .finally(() => {
                queueWakeupMetricsReadyPromise = null
            })
    }
    return queueWakeupMetricsReadyPromise
}

function getBrowserSessionStorageArea() {
    if(browser.storage?.session) return browser.storage.session

    const chromeSession = globalThis.chrome?.storage?.session || null
    if(!chromeSession) return null

    return {
        get(defaults = {}) {
            return new Promise((resolve, reject) => {
                chromeSession.get(defaults, result => {
                    const error = globalThis.chrome?.runtime?.lastError
                    if(error) {
                        reject(new Error(error.message || `${error}`))
                        return
                    }
                    resolve(result || {})
                })
            })
        },
        set(payload = {}) {
            return new Promise((resolve, reject) => {
                chromeSession.set(payload, () => {
                    const error = globalThis.chrome?.runtime?.lastError
                    if(error) {
                        reject(new Error(error.message || `${error}`))
                        return
                    }
                    resolve()
                })
            })
        }
    }
}

function hasBrowserSessionStorage() {
    const area = getBrowserSessionStorageArea()
    return !!(
        area &&
        typeof area.get === 'function' &&
        typeof area.set === 'function'
    )
}

function rememberBrowserSessionMarker(reason = 'observed') {
    const area = getBrowserSessionStorageArea()
    if(!area || typeof area.set !== 'function') return Promise.resolve(false)

    return promiseWithTimeout(
        area.set({
            [BROWSER_SESSION_MARKER_KEY]: {
                id: makeId('browser-session'),
                reason,
                extensionVersion: getExtensionVersion(),
                observedAt: Date.now()
            }
        }),
        1000,
        'browser session marker write'
    )
        .then(() => true)
        .catch(() => false)
}

function rememberQuoraRuntimeActivation(reason = 'quora-observed') {
    const area = getBrowserSessionStorageArea()
    if(!area || typeof area.set !== 'function') return Promise.resolve(false)

    return promiseWithTimeout(
        area.set({
            [QUORA_RUNTIME_ACTIVATED_SESSION_KEY]: {
                active: true,
                reason,
                extensionVersion: getExtensionVersion(),
                observedAt: Date.now()
            }
        }),
        1000,
        'quora runtime activation marker write'
    )
        .then(() => true)
        .catch(() => false)
}

function forgetQuoraRuntimeActivation(reason = 'quora-runtime-reset') {
    quoraRuntimeActivated = false
    const area = getBrowserSessionStorageArea()
    if(!area || typeof area.set !== 'function') return Promise.resolve(false)

    return promiseWithTimeout(
        area.set({[QUORA_RUNTIME_ACTIVATED_SESSION_KEY]: null}),
        1000,
        'quora runtime activation marker clear'
    )
        .then(() => {
            pushQueueWakeupJournalEntry({
                kind: 'state-change',
                name: 'quora-runtime-activation-cleared',
                reason,
                result: 'state-changed'
            })
            return true
        })
        .catch(() => false)
}

function ensureBrowserSessionStartupMetricsReset() {
    if(browserSessionStartupResetChecked) return Promise.resolve(false)
    if(browserSessionStartupResetPromise) return browserSessionStartupResetPromise
    if(!hasBrowserSessionStorage()) {
        browserSessionStartupResetChecked = true
        return Promise.resolve(false)
    }

    const area = getBrowserSessionStorageArea()
    browserSessionStartupResetPromise = promiseWithTimeout(
        area.get({[BROWSER_SESSION_MARKER_KEY]: null}),
        1000,
        'browser session marker load'
    )
        .then(async stored => {
            if(stored?.[BROWSER_SESSION_MARKER_KEY]) return false

            await rememberBrowserSessionMarker('browser-startup')
            pendingQueueWakeupMetricsReset = {
                reason: 'browser-startup',
                requestedAt: Date.now()
            }
            return true
        })
        .catch(() => false)
        .finally(() => {
            browserSessionStartupResetChecked = true
            browserSessionStartupResetPromise = null
        })

    return browserSessionStartupResetPromise
}

function clearSchedulerAlarms(reason = 'clear-scheduler-alarms') {
    if(!browser.alarms?.clear) return Promise.resolve(false)

    return Promise.all([
        browser.alarms.clear(COORDINATOR_RESUME_ALARM_NAME).catch(() => false),
        browser.alarms.clear(COORDINATOR_STORED_WORK_REPAIR_ALARM_NAME).catch(() => false),
        browser.alarms.clear(PERSISTENT_FAILED_RETRY_ALARM_NAME).catch(() => false)
    ])
        .then(results => {
            pushQueueWakeupJournalEntry({
                kind: 'state-change',
                name: 'scheduler-alarms-cleared',
                reason,
                result: results.some(Boolean) ? 'state-changed' : 'no-op'
            })
            return results.some(Boolean)
        })
        .catch(() => false)
}

async function resetQueueWakeupMetricsEpochAfterLoad(reason = 'manual', options = {}) {
    if(queueWakeupMetricsReadyPromise) {
        await queueWakeupMetricsReadyPromise.catch(() => null)
    }
    else if(!queueWakeupMetricsLoaded) {
        await ensureQueueWakeupMetricsLoaded().catch(() => null)
    }
    pendingQueueWakeupMetricsReset = null
    if(isFreshQueueWakeupMetricsEpoch(reason)) {
        await flushQueueWakeupMetrics()
        return {
            reset: true,
            coalesced: true,
            deferred: options.deferUntilQuora === true && !quoraRuntimeActivated,
            resetReason: reason,
            epochId: getQueueWakeupMetricEpoch().epochId,
            startedAt: getQueueWakeupMetricEpoch().startedAt
        }
    }
    resetQueueWakeupMetricsEpoch(reason)
    await flushQueueWakeupMetrics()
    return {
        reset: true,
        deferred: options.deferUntilQuora === true && !quoraRuntimeActivated,
        resetReason: reason,
        epochId: getQueueWakeupMetricEpoch().epochId,
        startedAt: getQueueWakeupMetricEpoch().startedAt
    }
}

function startQueueWakeupMetricsBackedStartupWork(options = {}) {
    if(!quoraRuntimeActivated && options.force !== true) {
        return Promise.resolve(null)
    }

    const metricsReady = ensureBrowserSessionStartupMetricsReset()
        .then(() => ensureQueueWakeupMetricsLoaded())
        .then(async () => {
            if(pendingQueueWakeupMetricsReset) {
                const reset = pendingQueueWakeupMetricsReset
                pendingQueueWakeupMetricsReset = null
                resetQueueWakeupMetricsEpoch(reset.reason || 'browser-startup')
                await flushQueueWakeupMetrics()
            }
        })
        .catch(() => null)

    void metricsReady
    return metricsReady
}

function isQuoraRuntimeUrl(value = '') {
    try {
        const url = new URL(`${value || ''}`)
        return /\.quora\.com$/i.test(url.hostname) || /^quora\.com$/i.test(url.hostname)
    }
    catch {
        return false
    }
}

function markQuoraRuntimeActivated(reason = 'quora-observed') {
    if(quoraRuntimeActivated) {
        void rememberQuoraRuntimeActivation(reason)
        return false
    }
    quoraRuntimeActivated = true
    incrementQueueWakeupMetric('runtime.quoraActivated')
    pushQueueWakeupJournalEntry({
        kind: 'state-change',
        name: 'quora-runtime-activated',
        reason,
        result: 'state-changed'
    })
    void rememberQuoraRuntimeActivation(reason)
    void startQueueWakeupMetricsBackedStartupWork({force: true})
    scheduleQueuedWorkerActionSurfaceCleanup('quora-runtime-activated-idle', 5000)
    if(coordinatorResumePromise || queuedTabFillPromise) {
        incrementQueueWakeupMetric('runtime.quoraActivatedResumeAlreadyActive')
        return true
    }
    void resumeStoredWorkAfterQuoraActivation(reason).catch(() => null)
    return true
}

async function resumeStoredWorkAfterQuoraActivation(reason = 'quora-observed') {
    const currentAuthorityState = await loadCoordinatorCurrentAuthorityState({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_PAUSED_KEY]: false,
        [COORDINATOR_PAUSE_GENERATION_KEY]: 0
    }).catch(() => null)
    const queue = currentAuthorityState?.queue || {}
    if(!hasStoredCoordinatorWork(queue)) return {resumed: false, reason: 'no-stored-work'}

    const stored = currentAuthorityState?.stored || {}
    const wasPaused = stored?.[COORDINATOR_PAUSED_KEY] === true
    const storedPauseGeneration = Number.parseInt(stored?.[COORDINATOR_PAUSE_GENERATION_KEY], 10) || 0
    if(wasPaused && storedPauseGeneration > 0) {
        incrementQueueWakeupMetric('pump.deferredExplicitPause')
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'coordinator-explicit-pause-preserved',
            reason,
            result: 'no-op',
            details: {
                pauseGeneration: storedPauseGeneration
            }
        })
        return {resumed: false, paused: true, reason: 'coordinator-paused'}
    }
    if(wasPaused) {
        const pauseGeneration = nextCoordinatorPauseGeneration()
        coordinatorPauseRequested = false
        await setCoordinatorPauseControlState(false, pauseGeneration, 'ordinaryMutation')
        void setCoordinatorRunsPaused(false).catch(() => null)
        pausedQueuedOwners.delete(SERVICE_WORKER_QUEUE_OWNER_ID)
        if(coordinatorTabId) pausedQueuedOwners.delete(coordinatorTabId)
        incrementQueueWakeupMetric('pump.changed.clearedStalePause')
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'coordinator-stale-pause-cleared',
            reason,
            result: 'state-changed',
            details: {
                pauseGeneration
            }
        })
    }

    return kickCoordinatorQueueResume('quora-runtime-activated-auto-resume', {
        direct: true,
        repairBeforeResume: false
    })
}

function markQuoraRuntimeActivatedFromRequest(request = {}, sender = {}, reason = 'message') {
    const urls = [
        sender?.tab?.url,
        request?.url,
        request?.profileHref,
        request?.href,
        request?.targetProfileHref,
        request?.requestedUrl,
        request?.sourcePageUrl,
        request?.source?.pageUrl,
        request?.run?.sourcePageUrl
    ]
    if(Array.isArray(request?.items)) {
        for(const item of request.items) {
            urls.push(
                item?.url,
                item?.href,
                item?.profileHref,
                item?.targetProfileHref,
                item?.requestedUrl,
                item?.sourcePageUrl
            )
        }
    }
    if(Array.isArray(request?.urls)) urls.push(...request.urls)
    if(Array.isArray(request?.profileHrefs)) urls.push(...request.profileHrefs)
    if(urls.some(isQuoraRuntimeUrl)) {
        return markQuoraRuntimeActivated(reason)
    }
    return false
}

async function observeExistingQuoraRuntimeTabs(reason = 'existing-quora-tab') {
    if(quoraRuntimeActivated) return true

    let tabs = []
    try {
        tabs = await promiseWithTimeout(
            browser.tabs.query({url: 'https://*.quora.com/*'}),
            QUORA_RUNTIME_TAB_QUERY_TIMEOUT_MS,
            'quora runtime tab query'
        )
    }
    catch {
        return false
    }

    if(tabs.some(tab => isQuoraRuntimeUrl(tab?.url || ''))) {
        markQuoraRuntimeActivated(reason)
        return true
    }

    return false
}

async function restoreQuoraRuntimeActivationFromSession(reason = 'session-activation-restore') {
    if(quoraRuntimeActivated) return true

    const area = getBrowserSessionStorageArea()
    if(!area || typeof area.get !== 'function') return false

    let stored = null
    try {
        stored = await promiseWithTimeout(
            area.get({[QUORA_RUNTIME_ACTIVATED_SESSION_KEY]: null}),
            1000,
            'quora runtime activation marker load'
        )
    }
    catch {
        return false
    }

    const marker = stored?.[QUORA_RUNTIME_ACTIVATED_SESSION_KEY] || null
    if(marker?.active !== true) return false

    quoraRuntimeActivated = true
    incrementQueueWakeupMetric('runtime.quoraActivationRestored')
    pushQueueWakeupJournalEntry({
        kind: 'state-change',
        name: 'quora-runtime-activation-restored',
        reason,
        result: 'state-changed',
        details: {
            observedAt: marker.observedAt || 0,
            originalReason: marker.reason || ''
        }
    })
    void startQueueWakeupMetricsBackedStartupWork({force: true})
    return true
}

async function ensureQuoraRuntimeActivatedForScheduler(reason = 'scheduler') {
    if(quoraRuntimeActivated) return true
    if(await restoreQuoraRuntimeActivationFromSession(reason)) return true
    return observeExistingQuoraRuntimeTabs(reason)
}

function makeQuoraRuntimeNotActivatedResult(reason = 'quora-runtime-not-activated') {
    return {
        recovered: false,
        reason,
        requiresQuoraVisit: true,
        alarmCreated: false,
        fallbackScheduled: false,
        resumeScheduled: false,
        repairScheduled: false,
        scheduledOnly: true
    }
}

function normalizeObjectNumberMap(value = null) {
    const result = {}
    for(const [key, raw] of Object.entries(value && typeof value === 'object' ? value : {})) {
        const normalizedKey = `${key || ''}`.trim()
        const number = Number(raw) || 0
        if(normalizedKey && Number.isFinite(number)) result[normalizedKey] = number
    }
    return result
}

function normalizeQueueWakeupPhaseMap(value = null) {
    const result = {}
    for(const [key, raw] of Object.entries(value && typeof value === 'object' ? value : {})) {
        const name = `${key || ''}`.trim()
        if(!name || !raw || typeof raw !== 'object') continue
        const count = Math.max(0, Number.parseInt(raw.count, 10) || 0)
        const totalMs = Math.max(0, Number(raw.totalMs) || 0)
        result[name] = {
            count,
            totalMs,
            lastMs: Math.max(0, Number(raw.lastMs) || 0),
            maxMs: Math.max(0, Number(raw.maxMs) || 0),
            lastAt: Number.parseInt(raw.lastAt, 10) || 0
        }
    }
    return result
}

function incrementQueueWakeupMetric(name = '', amount = 1) {
    const key = `${name || ''}`.trim()
    const delta = Number(amount) || 0
    if(!key || !Number.isFinite(delta)) return

    const epoch = getQueueWakeupMetricEpoch()
    epoch.counters[key] = (epoch.counters[key] || 0) + delta
    epoch.updatedAt = Date.now()
    scheduleQueueWakeupMetricsFlush()
}

function getQueueWakeupMetricCounter(name = '') {
    return getQueueWakeupMetricEpoch().counters?.[`${name || ''}`.trim()] || 0
}

function recordQueueWakeupPhase(name = '', durationMs = 0) {
    const key = `${name || ''}`.trim()
    const elapsed = Math.max(0, Number(durationMs) || 0)
    if(!key || !Number.isFinite(elapsed)) return

    const epoch = getQueueWakeupMetricEpoch()
    const previous = epoch.phases[key] || {
        count: 0,
        totalMs: 0,
        lastMs: 0,
        maxMs: 0,
        lastAt: 0
    }
    epoch.phases[key] = {
        count: previous.count + 1,
        totalMs: previous.totalMs + elapsed,
        lastMs: elapsed,
        maxMs: Math.max(previous.maxMs || 0, elapsed),
        lastAt: Date.now()
    }
    epoch.updatedAt = Date.now()
    scheduleQueueWakeupMetricsFlush()
}

function recordQueueWakeupMetricMax(name = '', value = 0) {
    const key = `${name || ''}`.trim()
    const number = Number(value) || 0
    if(!key || !Number.isFinite(number)) return

    const epoch = getQueueWakeupMetricEpoch()
    epoch.counters[key] = Math.max(epoch.counters[key] || 0, number)
    epoch.updatedAt = Date.now()
    scheduleQueueWakeupMetricsFlush()
}

function incrementActiveStorageMetricDetail(name = '', amount = 1) {
    const key = `${name || ''}`.trim()
    const delta = Number(amount) || 0
    if(!key || !Number.isFinite(delta) || !activeQueueWakeupStorageContext) return

    activeQueueWakeupStorageContext[key] = (Number(activeQueueWakeupStorageContext[key]) || 0) + delta
}

function setActiveStorageMetricDetail(name = '', value = 0) {
    const key = `${name || ''}`.trim()
    if(!key || !activeQueueWakeupStorageContext) return
    activeQueueWakeupStorageContext[key] = value
}

function getPhaseWallMs(context = {}, phase = '') {
    const intervals = context?.phaseIntervals?.[phase] || []
    if(!intervals.length) return 0

    const sorted = intervals
        .map(interval => ({
            start: Number.parseInt(interval.start, 10) || 0,
            end: Number.parseInt(interval.end, 10) || 0
        }))
        .filter(interval => interval.start > 0 && interval.end >= interval.start)
        .sort((left, right) => left.start - right.start || left.end - right.end)
    let total = 0
    let currentStart = 0
    let currentEnd = 0

    for(const interval of sorted) {
        if(!currentStart) {
            currentStart = interval.start
            currentEnd = interval.end
            continue
        }
        if(interval.start <= currentEnd) {
            currentEnd = Math.max(currentEnd, interval.end)
            continue
        }
        total += currentEnd - currentStart
        currentStart = interval.start
        currentEnd = interval.end
    }

    if(currentStart) total += currentEnd - currentStart
    return total
}

function recordActiveStorageMetricPhaseInterval(phase = '', startedAt = 0, endedAt = 0) {
    if(!activeQueueWakeupStorageContext) return
    const start = Number.parseInt(startedAt, 10) || 0
    const end = Number.parseInt(endedAt, 10) || 0
    if(!phase || !start || end < start) return

    if(!activeQueueWakeupStorageContext.phaseIntervals) {
        activeQueueWakeupStorageContext.phaseIntervals = {}
    }
    const intervals = activeQueueWakeupStorageContext.phaseIntervals[phase] || []
    intervals.push({start, end})
    activeQueueWakeupStorageContext.phaseIntervals[phase] = intervals.slice(-100)
}

function noteActiveStorageMetricPhase(name = '', durationMs = 0, startedAt = 0, endedAt = 0) {
    const phase = `${name || ''}`.trim()
    const elapsed = Math.max(0, Number(durationMs) || 0)
    if(!phase) return

    recordQueueWakeupPhase(phase, elapsed)
    if(!activeQueueWakeupStorageContext) return

    const msKey = `${phase}Ms`
    activeQueueWakeupStorageContext[msKey] = (Number(activeQueueWakeupStorageContext[msKey]) || 0) + elapsed
    recordActiveStorageMetricPhaseInterval(phase, startedAt, endedAt)
}

function runQueueWakeupMetricPhase(name = '', callback = () => undefined) {
    const phase = `${name || ''}`.trim() || 'unknown'
    const context = activeQueueWakeupStorageContext
    const previousPhase = context?.currentPhase || ''
    if(context) context.currentPhase = phase
    const startedAt = Date.now()
    const finish = () => {
        const endedAt = Date.now()
        noteActiveStorageMetricPhase(phase, endedAt - startedAt, startedAt, endedAt)
        if(context) context.currentPhase = previousPhase
    }

    try {
        const result = callback()
        if(result && typeof result.then === 'function') {
            return result.finally(finish)
        }
        finish()
        return result
    }
    catch(error) {
        finish()
        throw error
    }
}

function getStorageMetricKeyName(key = '') {
    if(key === COORDINATOR_QUEUE_KEY) return 'queue'
    if(key === COORDINATOR_QUEUE_WAL_KEY) return 'queueWal'
    if(key === COORDINATOR_QUEUE_VIEW_KEY) return 'queueView'
    if(key === COORDINATOR_CONTENT_QUEUE_INDEX_KEY) return 'contentQueueIndex'
    if(`${key || ''}`.startsWith(COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX)) return 'contentSourceIndex'
    if(key === COORDINATOR_RUNS_KEY) return 'runs'
    if(key === COORDINATOR_EVENTS_KEY) return 'events'
    if(key === QUEUE_WAKEUP_METRICS_VIEW_KEY) return 'metricsView'
    if(key === PROFILE_NUKE_PROGRESS_KEY) return 'progress'
    if(key === PROFILE_NUKE_PROGRESS_VIEW_KEY) return 'progressView'
    if(`${key || ''}`.startsWith(PROFILE_NUKE_PROGRESS_SHARD_PREFIX)) return 'progressShard'
    if(key === SPACE_PENDING_NUKED_POSTS_KEY) return 'pendingPosts'
    if(key === SPACE_NUKED_POSTS_KEY) return 'rememberedNukes'
    if(key === OWNED_TAB_STATE_KEY) return 'ownedTabs'
    if(key === COORDINATOR_PAUSED_KEY) return 'paused'
    if(key === COORDINATOR_PAUSE_GENERATION_KEY) return 'pauseGeneration'
    if(key === COORDINATOR_TAB_KEY) return 'coordinatorTab'
    return 'other'
}

function getJsonByteSize(value = null) {
    let text = ''
    try {
        text = JSON.stringify(value)
    }
    catch {
        text = ''
    }
    if(!text) return 0
    try {
        return new TextEncoder().encode(text).length
    }
    catch {
        return text.length
    }
}

function getStoragePayloadRowCount(value = null) {
    if(Array.isArray(value)) return value.length
    if(value && typeof value === 'object') return Object.keys(value).length
    return value === undefined ? 0 : 1
}

function normalizeStorageMetricPathName(pathName = '') {
    const normalized = `${pathName || ''}`.trim()
        .replace(/[^A-Za-z0-9_.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
    return normalized || 'unknown'
}

function getStorageMetricPathName(options = {}) {
    return normalizeStorageMetricPathName(
        options.metricPath ||
        options.callPath ||
        options.reason ||
        options.snapshotWriteReason ||
        activeQueueWakeupStorageContext?.currentPhase ||
        'unknown'
    )
}

function recordStoragePathPayloadMetrics(direction = '', pathName = '', totalBytes = 0, totalRows = 0) {
    const normalizedDirection = direction === 'read' ? 'read' : 'write'
    const normalizedPath = normalizeStorageMetricPathName(pathName)
    incrementQueueWakeupMetric(`storagePayload.${normalizedDirection}.path.${normalizedPath}.bytes`, totalBytes)
    incrementQueueWakeupMetric(`storagePayload.${normalizedDirection}.path.${normalizedPath}.calls`)
    incrementQueueWakeupMetric(`storagePayload.${normalizedDirection}.path.${normalizedPath}.rows`, totalRows)
    recordQueueWakeupMetricMax(`storagePayload.${normalizedDirection}.path.${normalizedPath}.maxBytes`, totalBytes)
    recordQueueWakeupMetricMax(`storagePayload.${normalizedDirection}.path.${normalizedPath}.maxRows`, totalRows)
}

function recordStoragePathLatencyMetrics(direction = '', pathName = '', durationMs = 0) {
    const normalizedDirection = direction === 'read' ? 'read' : 'write'
    const normalizedPath = normalizeStorageMetricPathName(pathName)
    const elapsed = Math.max(0, Number(durationMs) || 0)
    incrementQueueWakeupMetric(`storagePayload.${normalizedDirection}.path.${normalizedPath}.latencyMs`, elapsed)
    recordQueueWakeupMetricMax(`storagePayload.${normalizedDirection}.path.${normalizedPath}.maxLatencyMs`, elapsed)
}

const SNAPSHOT_WRITE_REASONS = new Set([
    'ordinaryMutation',
    'repair',
    'displayRead',
    'compatibilityFlush',
    'checkpointSwitch',
    'compaction',
    'userMemoryNonAuthority'
])

function normalizeSnapshotWriteReason(reason = '') {
    const normalized = `${reason || ''}`.trim()
    return SNAPSHOT_WRITE_REASONS.has(normalized) ? normalized : 'unclassified'
}

function recordSnapshotWriteReasonMetrics(reason = '', payload = {}) {
    const normalizedReason = normalizeSnapshotWriteReason(reason)
    const entries = Object.entries(payload && typeof payload === 'object' ? payload : {})
        .filter(([key]) => key !== QUEUE_WAKEUP_METRICS_KEY)
    if(!entries.length) return

    let bytes = 0
    let rows = 0
    for(const [, value] of entries) {
        bytes += getJsonByteSize(value)
        rows += getStoragePayloadRowCount(value)
    }

    incrementQueueWakeupMetric(`snapshot.write.reason.${normalizedReason}`)
    incrementQueueWakeupMetric(`snapshot.write.reason.${normalizedReason}.bytes`, bytes)
    incrementQueueWakeupMetric(`snapshot.write.reason.${normalizedReason}.rows`, rows)
    recordQueueWakeupMetricMax(`snapshot.write.reason.${normalizedReason}.maxBytes`, bytes)
    recordQueueWakeupMetricMax(`snapshot.write.reason.${normalizedReason}.maxRows`, rows)
    setActiveStorageMetricDetail('snapshotWriteReason', normalizedReason)
    incrementActiveStorageMetricDetail('snapshotWriteRows', rows)
}

function normalizeQueueWriteOperationName(operation = '') {
    return normalizeStorageMetricPathName(operation || 'unclassified')
}

function getQueueWriteMetricReason(options = {}) {
    return normalizeSnapshotWriteReason(
        options.queueSnapshotWriteReason ||
        options.snapshotWriteReason ||
        options.reason ||
        'unclassified'
    )
}

function recordQueueWriteOperationMetricValue(prefix = '', bytes = 0, rows = 0, changedRows = 0) {
    incrementQueueWakeupMetric(`${prefix}.calls`)
    incrementQueueWakeupMetric(`${prefix}.bytes`, bytes)
    incrementQueueWakeupMetric(`${prefix}.rows`, rows)
    incrementQueueWakeupMetric(`${prefix}.changedRows`, changedRows)
    recordQueueWakeupMetricMax(`${prefix}.maxBytes`, bytes)
    recordQueueWakeupMetricMax(`${prefix}.maxRows`, rows)
    recordQueueWakeupMetricMax(`${prefix}.maxChangedRows`, changedRows)
}

function recordQueueWriteOperationMetrics(payload = {}, options = {}) {
    if(!payload || typeof payload !== 'object' || !payload[COORDINATOR_QUEUE_KEY]) return

    const queue = payload[COORDINATOR_QUEUE_KEY]
    const bytes = getJsonByteSize(queue)
    const rows = getStoragePayloadRowCount(queue)
    const changedRows = Math.max(0, Number.parseInt(options.queueChangedRows, 10) || 0)
    const operation = normalizeQueueWriteOperationName(options.queueOperation)
    const reason = getQueueWriteMetricReason(options)

    recordQueueWriteOperationMetricValue(`queueWrite.operation.${operation}`, bytes, rows, changedRows)
    recordQueueWriteOperationMetricValue(`queueWrite.reason.${reason}.operation.${operation}`, bytes, rows, changedRows)
    incrementQueueWakeupMetric(`queueWrite.reason.${reason}.calls`)
    incrementQueueWakeupMetric(`queueWrite.reason.${reason}.bytes`, bytes)
    incrementQueueWakeupMetric(`queueWrite.reason.${reason}.rows`, rows)
    incrementQueueWakeupMetric(`queueWrite.reason.${reason}.changedRows`, changedRows)
    recordQueueWakeupMetricMax(`queueWrite.reason.${reason}.maxBytes`, bytes)
    recordQueueWakeupMetricMax(`queueWrite.reason.${reason}.maxRows`, rows)
    recordQueueWakeupMetricMax(`queueWrite.reason.${reason}.maxChangedRows`, changedRows)
    setActiveStorageMetricDetail('queueWriteOperation', operation)
    setActiveStorageMetricDetail('queueWriteReason', reason)
    incrementActiveStorageMetricDetail('queueWriteBytes', bytes)
    incrementActiveStorageMetricDetail('queueWriteRows', rows)
    incrementActiveStorageMetricDetail('queueWriteChangedRows', changedRows)
}

function recordStoragePayloadMetrics(payload = {}, pathName = '') {
    const entries = Object.entries(payload && typeof payload === 'object' ? payload : {})
    if(!entries.length) return

    let totalBytes = 0
    let totalRows = 0
    const keyNames = []
    for(const [key, value] of entries) {
        if(key === QUEUE_WAKEUP_METRICS_KEY) continue
        const metricKey = getStorageMetricKeyName(key)
        const bytes = getJsonByteSize(value)
        const rows = getStoragePayloadRowCount(value)
        totalBytes += bytes
        totalRows += rows
        keyNames.push(metricKey)
        incrementQueueWakeupMetric(`storagePayload.write.${metricKey}.bytes`, bytes)
        incrementQueueWakeupMetric(`storagePayload.write.${metricKey}.rows`, rows)
        recordQueueWakeupMetricMax(`storagePayload.write.${metricKey}.maxBytes`, bytes)
        recordQueueWakeupMetricMax(`storagePayload.write.${metricKey}.maxRows`, rows)
    }

    if(!totalBytes) return
    incrementQueueWakeupMetric('storagePayload.write.total.bytes', totalBytes)
    incrementQueueWakeupMetric('storagePayload.write.total.calls')
    incrementQueueWakeupMetric('storagePayload.write.total.rows', totalRows)
    recordQueueWakeupMetricMax('storagePayload.write.total.maxBytes', totalBytes)
    recordStoragePathPayloadMetrics('write', pathName, totalBytes, totalRows)
    incrementActiveStorageMetricDetail('payloadBytes', totalBytes)
    setActiveStorageMetricDetail('payloadKeys', keyNames.slice(0, 12).join(','))
    setActiveStorageMetricDetail('payloadPath', normalizeStorageMetricPathName(pathName))
}

function recordStorageReadPayloadMetrics(payload = {}, pathName = '') {
    const entries = Object.entries(payload && typeof payload === 'object' ? payload : {})
    if(!entries.length) return

    let totalBytes = 0
    let totalRows = 0
    const keyNames = []
    for(const [key, value] of entries) {
        if(key === QUEUE_WAKEUP_METRICS_KEY) continue
        const metricKey = getStorageMetricKeyName(key)
        const bytes = getJsonByteSize(value)
        const rows = getStoragePayloadRowCount(value)
        totalBytes += bytes
        totalRows += rows
        keyNames.push(metricKey)
        incrementQueueWakeupMetric(`storagePayload.read.${metricKey}.bytes`, bytes)
        incrementQueueWakeupMetric(`storagePayload.read.${metricKey}.calls`)
        incrementQueueWakeupMetric(`storagePayload.read.${metricKey}.rows`, rows)
        recordQueueWakeupMetricMax(`storagePayload.read.${metricKey}.maxBytes`, bytes)
        recordQueueWakeupMetricMax(`storagePayload.read.${metricKey}.maxRows`, rows)
    }

    if(!totalBytes) return
    incrementQueueWakeupMetric('storagePayload.read.total.bytes', totalBytes)
    incrementQueueWakeupMetric('storagePayload.read.total.calls')
    incrementQueueWakeupMetric('storagePayload.read.total.rows', totalRows)
    recordQueueWakeupMetricMax('storagePayload.read.total.maxBytes', totalBytes)
    recordStoragePathPayloadMetrics('read', pathName, totalBytes, totalRows)
    incrementActiveStorageMetricDetail('readPayloadBytes', totalBytes)
    setActiveStorageMetricDetail('readPayloadKeys', keyNames.slice(0, 12).join(','))
    setActiveStorageMetricDetail('readPayloadPath', normalizeStorageMetricPathName(pathName))
}

function createChromeLocalStorageAdapter(getStorageArea = () => browser.storage.local) {
    return {
        get(defaults = {}) {
            return getStorageArea().get(defaults)
        },
        set(payload = {}) {
            return getStorageArea().set(payload)
        },
        remove(keys) {
            return getStorageArea().remove(keys)
        },
        getBytesInUse(keys = null) {
            const storageArea = getStorageArea()
            if(typeof storageArea.getBytesInUse !== 'function') return Promise.resolve(0)
            return storageArea.getBytesInUse(keys)
        }
    }
}

const coordinatorStorageAdapter = createChromeLocalStorageAdapter()
let coordinatorAuthoritySnapshotObserver = null

function notifyCoordinatorAuthorityPersistedSnapshot(payload = {}) {
    if(typeof coordinatorAuthoritySnapshotObserver !== 'function') return
    try {
        coordinatorAuthoritySnapshotObserver(payload)
    }
    catch(error) {
        incrementQueueWakeupMetric('coordinatorAuthority.snapshotObserverFailed')
    }
}

function getActiveStorageUpdateToken() {
    return Number.parseInt(activeQueueWakeupStorageContext?.updateToken || activeSpaceFeedStorageUpdateToken, 10) || 0
}

function isStorageUpdateAbandoned(updateToken = getActiveStorageUpdateToken()) {
    const normalizedToken = Number.parseInt(updateToken, 10) || 0
    return !!normalizedToken && abandonedSpaceFeedStorageUpdates.has(normalizedToken)
}

function suppressAbandonedStorageOperation(operation = 'storage') {
    if(!isStorageUpdateAbandoned()) return false
    incrementQueueWakeupMetric('storageUpdate.lateWriteSuppressed')
    setActiveStorageMetricDetail('lateWriteSuppressed', true)
    setActiveStorageMetricDetail('abortedOperation', operation)
    return true
}

function makeAbandonedStorageGetResult(defaults = {}) {
    if(typeof defaults === 'string') return {[defaults]: undefined}
    if(Array.isArray(defaults)) return Object.fromEntries(defaults.map(key => [key, undefined]))
    return JSON.parse(JSON.stringify(defaults || {}))
}

async function metricStorageGet(defaults = {}, options = {}) {
    incrementQueueWakeupMetric('storageGetCalls')
    incrementActiveStorageMetricDetail('storageGetCalls')
    if(suppressAbandonedStorageOperation('storageGet-before')) {
        return makeAbandonedStorageGetResult(defaults)
    }
    const pathName = getStorageMetricPathName(options)
    const startedAt = Date.now()
    let result = null
    try {
        result = await runQueueWakeupMetricPhase(options.phase || 'storageGet', () => coordinatorStorageAdapter.get(defaults))
    }
    finally {
        recordStoragePathLatencyMetrics('read', pathName, Date.now() - startedAt)
    }
    recordStorageReadPayloadMetrics(result, pathName)
    if(suppressAbandonedStorageOperation('storageGet-after')) {
        return makeAbandonedStorageGetResult(defaults)
    }
    return result
}

async function metricStorageSet(payload = {}, options = {}) {
    if(payload &&
        typeof payload === 'object' &&
        Object.prototype.hasOwnProperty.call(payload, COORDINATOR_QUEUE_KEY) &&
        activeQueueWakeupStorageContext?.coordinatorAuthorityQueueMutationApplied === true &&
        options.coordinatorAuthorityWrite !== true) {
        incrementQueueWakeupMetric('coordinatorAuthority.postMutationQueueStorageSetRejected')
        setActiveStorageMetricDetail('rejectedOperation', 'postAuthorityQueueStorageSet')
        return false
    }
    payload = addContentPageStateProjectionPayload(payload)
    const keys = Object.keys(payload || {})
    if(!keys.length) return
    if(suppressAbandonedStorageOperation('storageSet')) return false
    if(options.snapshotWriteReason) {
        recordSnapshotWriteReasonMetrics(options.snapshotWriteReason, payload)
    }
    const pathName = getStorageMetricPathName(options)
    recordStoragePayloadMetrics(payload, pathName)
    recordQueueWriteOperationMetrics(payload, options)
    incrementQueueWakeupMetric('storageSetCalls')
    incrementActiveStorageMetricDetail('storageSetCalls')
    const startedAt = Date.now()
    let result = null
    try {
        result = await runQueueWakeupMetricPhase(options.phase || 'storageSet', () => coordinatorStorageAdapter.set(payload))
    }
    finally {
        recordStoragePathLatencyMetrics('write', pathName, Date.now() - startedAt)
    }
    notifyCoordinatorAuthorityPersistedSnapshot(payload)
    notifyCoordinatorDashboardStateChanged(keys, pathName)
    return result
}

function notifyCoordinatorDashboardStateChanged(keys = [], reason = '') {
    const changedKeys = Array.from(new Set(keys || []))
        .filter(key => COORDINATOR_DASHBOARD_STATE_KEYS.has(key))
    if(!changedKeys.length) return

    void browser.runtime.sendMessage({
        action: 'coordinator-dashboard-state-changed',
        reason: normalizeStorageMetricPathName(reason),
        keys: changedKeys
    }).catch(() => {})
}

function sanitizeQueueWakeupMetricDetails(details = {}) {
    const result = {}
    for(const [key, value] of Object.entries(details || {})) {
        if(value === undefined || value === null || value === '') continue
        if(typeof value === 'number' || typeof value === 'boolean') {
            result[key] = value
        }
        else if(typeof value === 'string') {
            result[key] = value.slice(0, 240)
        }
    }
    return result
}

function pushQueueWakeupJournalEntry(entry = {}) {
    const now = Date.now()
    const epoch = getQueueWakeupMetricEpoch()
    epoch.journal.push({
        kind: `${entry.kind || 'cycle'}`.trim(),
        name: `${entry.name || ''}`.trim(),
        reason: `${entry.reason || ''}`.trim(),
        result: `${entry.result || ''}`.trim(),
        resultReason: `${entry.resultReason || ''}`.trim(),
        at: Number.parseInt(entry.at, 10) || now,
        durationMs: Math.max(0, Number(entry.durationMs) || 0),
        counters: sanitizeQueueWakeupMetricDetails(entry.counters || {}),
        details: sanitizeQueueWakeupMetricDetails(entry.details || {})
    })
    if(epoch.journal.length > MAX_QUEUE_WAKEUP_METRIC_JOURNAL) {
        epoch.journal = epoch.journal.slice(-MAX_QUEUE_WAKEUP_METRIC_JOURNAL)
    }
    epoch.updatedAt = now
    scheduleQueueWakeupMetricsFlush()
}

function startQueueWakeupMetricCycle(kind = 'cycle', name = '', reason = '', details = {}) {
    return {
        id: ++queueWakeupMetricCycleSerial,
        kind,
        name,
        reason,
        startedAt: Date.now(),
        generation: queueWakeupMetricGeneration,
        counters: {...getQueueWakeupMetricEpoch().counters},
        details
    }
}

function getQueueWakeupMetricCounterDelta(before = {}) {
    const delta = {}
    const keys = new Set([
        ...Object.keys(before || {}),
        ...Object.keys(getQueueWakeupMetricEpoch().counters || {})
    ])
    for(const key of keys) {
        const value = (getQueueWakeupMetricEpoch().counters[key] || 0) - (before[key] || 0)
        if(value > 0) delta[key] = value
    }
    return delta
}

function getQueueWakeupMetricRuntimeSnapshot() {
    const durablyActiveQueuedTabs = getDurablyActiveQueuedTabCount()
    return {
        activeQueuedTabs: activeQueuedTabs.size,
        durablyActiveQueuedTabs,
        provisionalActiveQueuedTabs: Math.max(0, activeQueuedTabs.size - durablyActiveQueuedTabs),
        queuedTabActions: queuedTabActions.length,
        pendingTabActions: pendingTabActions.size
    }
}

function isDurablyActiveQueuedTab(tabId) {
    const metadata = getQueuedTabMetadata(tabId)
    return Number.isFinite(metadata?.durableActiveAt) && metadata.durableActiveAt > 0
}

function getDurablyActiveQueuedTabCount() {
    let count = 0
    for(const tabId of activeQueuedTabs) {
        if(isDurablyActiveQueuedTab(tabId)) count += 1
    }
    return count
}

function getSchedulerBlockingQueuedExecutorCount() {
    return getDurablyActiveQueuedTabCount()
}

function markQueuedTabDurablyActive(tabId, reason = '') {
    const metadata = getQueuedTabMetadata(tabId)
    const durableActiveAt = Number.isFinite(metadata?.durableActiveAt) && metadata.durableActiveAt > 0
        ? metadata.durableActiveAt
        : Date.now()
    setQueuedTabMetadata(tabId, {
        durableActiveAt,
        durableActiveReason: `${reason || ''}`.trim()
    })
}

function getCoordinatorQueueWorkCounts(queue = {}) {
    const counts = {
        durableActiveRows: 0,
        durableQueuedRows: 0,
        durableTerminalRows: 0
    }

    for(const item of Object.values(queue || {})) {
        if(isTerminalCoordinatorStatus(item?.status)) counts.durableTerminalRows += 1
        else if(isActiveCoordinatorStatus(item?.status)) counts.durableActiveRows += 1
        else if(`${item?.status || ''}` === 'queued') counts.durableQueuedRows += 1
    }

    return counts
}

function getCoordinatorAuthorityMismatchCounts(queue = {}, progress = {}, liveProfileTabsByHref = new Map(), options = {}) {
    const rowBudget = Math.max(1, Number.parseInt(options.rowBudget, 10) || COORDINATOR_RECONCILE_OBSERVE_ROW_BUDGET)
    const counts = {
        durableActiveWithoutActor: 0,
        durableActiveObserved: 0,
        provisionalActorWithoutDurable: 0,
        runtimeActorsObserved: activeQueuedTabs.size,
        rowBudgetExceeded: false
    }
    const activeEntries = []

    for(const [itemKey, item] of Object.entries(queue || {})) {
        if(!isActiveCoordinatorStatus(item?.status)) continue
        if(activeEntries.length >= rowBudget) {
            counts.rowBudgetExceeded = true
            break
        }

        const record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
        activeEntries.push({itemKey, item, record})
        counts.durableActiveObserved += 1
        if(!hasConfirmedLiveRuntimeActorForCoordinatorItem(item, record, liveProfileTabsByHref)) {
            counts.durableActiveWithoutActor += 1
        }
    }

    for(const tabId of activeQueuedTabs) {
        if(!isDurablyActiveQueuedTab(tabId)) {
            counts.provisionalActorWithoutDurable += 1
            continue
        }

        const matched = activeEntries.some(({item, record}) => {
            const persistedTabId = getPersistedQueuedTabId(item, record)
            return persistedTabId === tabId && hasConfirmedRuntimeActorForCoordinatorItem(item, record)
        })
        if(!matched) counts.provisionalActorWithoutDurable += 1
    }

    return counts
}

function getCoordinatorReconcileActionBudget(options = {}) {
    return Math.max(1, Number.parseInt(options.actionBudget, 10) || COORDINATOR_RECONCILE_ACTION_BUDGET)
}

function getTokenMatchedLiveTabForCoordinatorItem(item = null, record = null, itemKey = '', liveProfileTabsByHref = new Map()) {
    const tabId = getPersistedQueuedTabId(item, record)
    const expectedAttemptId = getAttemptIdFromValue(item) || getAttemptIdFromValue(record)
    const expectedAttemptNumber = getAttemptNumberFromValue(item) || getAttemptNumberFromValue(record)
    if(!tabId || !expectedAttemptId || !expectedAttemptNumber) return null

    const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey) || normalizeQuoraProfileUrl(record?.profileHref || '')
    const candidates = href ? getLiveTabsForProfileHref(liveProfileTabsByHref, href) : []
    return candidates.find(tab => normalizeTabId(tab?.id) === tabId) || null
}

function getCoordinatorItemExpectedExecutorHref(item = null, record = null, itemKey = '') {
    return getCoordinatorItemHref(item) ||
        normalizeQuoraProfileUrl(itemKey) ||
        normalizeQuoraProfileUrl(record?.profileHref || '')
}

function getCoordinatorItemExpectedExecutorUrl(item = null, record = null, itemKey = '') {
    return normalizeCoordinatorRequestedUrl(
        item?.requestedUrl ||
        getCoordinatorItemOpenUrl(item) ||
        getCoordinatorItemExpectedExecutorHref(item, record, itemKey) ||
        record?.requestedUrl ||
        record?.profileHref ||
        ''
    )
}

function getTabObservedUrls(tab = null) {
    return [
        tab?.url,
        tab?.pendingUrl
    ]
        .map(value => `${value || ''}`.trim())
        .filter(Boolean)
}

function isBlankOrUncommittedTabUrl(value = '') {
    return /^(?:about:blank|about:newtab)$/i.test(`${value || ''}`.trim())
}

function isBrowserErrorTabUrl(value = '') {
    return /^(?:chrome|edge)-error:/i.test(`${value || ''}`.trim())
}

function isQuoraChallengeLikeUrl(value = '') {
    const text = `${value || ''}`
    return isQuoraHttpUrl(text) &&
        /security|verification|verify|challenge|challenge-platform|cdn-cgi|turnstile/i.test(text)
}

function isNonProfileQuoraHttpLandingUrl(value = '') {
    const text = `${value || ''}`.trim()
    return isQuoraHttpUrl(text) &&
        !normalizeQuoraProfileUrl(text) &&
        !isQuoraChallengeLikeUrl(text)
}

function getNonProfileQuoraLandingMessage(value = '') {
    const text = `${value || ''}`.trim()
    try {
        const url = new URL(text)
        const pageType = `${url.pathname.split('/').filter(Boolean)[0] || 'root'}`.trim() || 'root'
        return `Queued tab did not land on a profile page (${pageType}: ${url.pathname || '/'})`
    }
    catch {
        return `Queued tab did not land on a profile page (${text || 'unknown URL'})`
    }
}

function isCoordinatorProfileLandingWork(item = null, itemKey = '', record = null) {
    const href = getCoordinatorItemExpectedExecutorHref(item, record, itemKey)
    return !!href && !isProfileResolutionItem(item)
}

function shouldTerminalizeCoordinatorNonProfileLanding(item = null, record = null, itemKey = '', landingUrl = '') {
    if(!item || typeof item !== 'object') return false
    if(!isActiveCoordinatorStatus(item.status)) return false
    if(isTerminalProfileNukeRecord(record)) return false
    if(hasActiveQueuedTabActionPhaseProgress(record, item)) return false
    if(!isCoordinatorProfileLandingWork(item, itemKey, record)) return false
    return isNonProfileQuoraHttpLandingUrl(landingUrl || record?.lastUrl || record?.errorPageUrl || '')
}

function isSafeToCloseNonProfileLandingTab(item = null, record = null, tab = null) {
    const tabId = normalizeTabId(tab?.id)
    if(!tabId || getPersistedQueuedTabId(item, record) !== tabId) return false
    if(!isNonProfileQuoraHttpLandingUrl(tab?.url || tab?.pendingUrl || '')) return false
    if(hasOwnedQueuedTabState(tabId)) return true

    const actionSurfaceWindowId = Number.parseInt(
        record?.actionSurfaceWindowId ||
        item?.actionSurfaceWindowId ||
        item?.ownerWindowId,
        10
    ) || 0
    return !!actionSurfaceWindowId && Number.parseInt(tab?.windowId, 10) === actionSurfaceWindowId
}

function getPersistedExecutorObservedAgeMs(item = null, record = null, now = Date.now()) {
    const anchor = getPersistedActiveCoordinatorStaleAnchor(item, record)
    if(!anchor || anchor > now) return Number.POSITIVE_INFINITY
    return now - anchor
}

function isPersistedLiveTabPlausibleForCoordinatorItem(item = null, record = null, itemKey = '', tab = null, now = Date.now()) {
    const tabId = getPersistedQueuedTabId(item, record)
    if(!tabId || normalizeTabId(tab?.id) !== tabId) return false

    const expectedHref = getCoordinatorItemExpectedExecutorHref(item, record, itemKey)
    const expectedUrl = getCoordinatorItemExpectedExecutorUrl(item, record, itemKey)
    const observedUrls = getTabObservedUrls(tab)
    for(const observedUrl of observedUrls) {
        if(expectedHref && normalizeQuoraProfileUrl(observedUrl) === expectedHref) return true
        if(expectedUrl &&
            (isProfileResolutionItem(item) || !expectedHref) &&
            normalizeCoordinatorRequestedUrl(observedUrl) === expectedUrl) {
            return true
        }
    }
    if(expectedHref && !isProfileResolutionItem(item)) {
        if(observedUrls.some(isNonProfileQuoraHttpLandingUrl)) return false
    }

    if(hasConfirmedRuntimeActorForCoordinatorItem(item, record)) return true

    const ageMs = getPersistedExecutorObservedAgeMs(item, record, now)
    const freshTransient = ageMs <= PERSISTED_EXECUTOR_TRANSIENT_URL_MAX_AGE_MS
    if(!freshTransient) return false

    if(observedUrls.some(isBlankOrUncommittedTabUrl)) return true
    if(observedUrls.some(isQuoraChallengeLikeUrl)) return true
    if(observedUrls.some(isBrowserErrorTabUrl) && (
        isExplicitSecurityVerificationRecord(record) ||
        isQuoraHttpUrl(record?.lastUrl || '') ||
        isQuoraHttpUrl(record?.errorPageUrl || '') ||
        !!expectedHref ||
        !!expectedUrl
    )) {
        return true
    }

    return false
}

async function getPersistedLiveTabForCoordinatorItem(item = null, record = null, itemKey = '') {
    const tabId = getPersistedQueuedTabId(item, record)
    const expectedAttemptId = getAttemptIdFromValue(item) || getAttemptIdFromValue(record)
    const expectedAttemptNumber = getAttemptNumberFromValue(item) || getAttemptNumberFromValue(record)
    if(!tabId || !expectedAttemptId || !expectedAttemptNumber) return null

    try {
        const tab = await browser.tabs.get(tabId)
        return isPersistedLiveTabPlausibleForCoordinatorItem(item, record, itemKey, tab) ? tab : null
    }
    catch {
        return null
    }
}

async function getTokenMatchedLiveOrPersistedTabForCoordinatorItem(item = null, record = null, itemKey = '', liveProfileTabsByHref = new Map()) {
    return getTokenMatchedLiveTabForCoordinatorItem(item, record, itemKey, liveProfileTabsByHref) ||
        await getPersistedLiveTabForCoordinatorItem(item, record, itemKey)
}

function isDurableActiveCoordinatorReclaimStale(item = null, record = null, now = Date.now()) {
    const staleAnchor = getPersistedActiveCoordinatorStaleAnchor(item, record)
    if(!staleAnchor) return true

    const timeoutMs = hasActiveQueuedTabActionPhaseProgress(record, item)
        ? COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS
        : COORDINATOR_ACTIVE_JOB_MAX_MS
    return now - staleAnchor >= timeoutMs
}

function hasDurableQueueMatchForRuntimeTab(tabId = null, queue = {}, progress = {}) {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId || !activeQueuedTabs.has(normalizedTabId)) return false

    for(const [itemKey, item] of Object.entries(queue || {})) {
        if(!isActiveCoordinatorStatus(item?.status)) continue

        const record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
        if(getPersistedQueuedTabId(item, record) !== normalizedTabId) continue
        if(hasConfirmedRuntimeActorForCoordinatorItem(item, record)) return true
    }

    return false
}

function buildRequeuedActiveCoordinatorItemWithoutActor(item = {}, record = null, now = Date.now(), reason = 'reconcile-active-without-actor') {
    const retryAttempt = getQueuedTabRetryAttempt(item, record)
    const maxRetries = getQueuedTabMaxRetries(item, record)
    if(retryAttempt >= maxRetries) {
        return buildTerminalCoordinatorQueueItem(item, {
            status: 'failed',
            outcome: 'timeout',
            error: 'Durable active queue row had no confirmed runtime actor',
            reason,
            eventType: JOB_EVENT_TAB_REMOVED,
            now
        })
    }

    const attemptId = makeAttemptId()
    const attemptNumber = getNextAttemptNumberFromValue(item)
    const actionKind = getCoordinatorActionKindForRequestedAction(item.actionKind || item.tabAction || item.executorTabAction || '')
    const reducedRetry = reduceJobEvent(item, {
        type: JOB_EVENT_RETRY,
        attemptId,
        attemptNumber,
        at: now,
        retryCount: item.retryCount || 0,
        lastRetryAt: item.lastRetryAt || 0
    })
    const retryBase = reducedRetry.accepted ? reducedRetry.item : item

    return applyCoordinatorJobEnvelope({
        ...retryBase,
        attemptId,
        attemptNumber,
        actionKind,
        status: 'queued',
        outcome: '',
        error: '',
        updatedAt: now,
        queuedAt: now,
        activeAt: 0,
        terminalAt: 0,
        tabId: null,
        attempt: 0,
        retryAttempt: retryAttempt + 1,
        maxRetries,
        actionLease: null,
        actionLeaseReleasedAt: now,
        actionLeaseReleaseReason: reason,
        milestones: makeEmptyCoordinatorMilestones()
    }, {
        runInput: {id: item.runId || '', sourceType: item.source?.type || item.scope?.type || ''},
        source: item.source || {},
        runId: item.runId || '',
        targetProfileHref: getCoordinatorItemHref(item),
        requestedUrl: item.requestedUrl || getCoordinatorItemHref(item),
        coordinatorKey: item.coordinatorKey || getCoordinatorItemHref(item),
        actionKind
    })
}

async function requeueDurableActiveCoordinatorItemWithoutActor(itemKey = '', expectedItem = null, expectedRecord = null, reason = 'reconcile-active-without-actor') {
    if(!expectedItem || typeof expectedItem !== 'object') return {changed: false, reason: 'invalid-item'}
    if(isTerminalProfileNukeRecord(expectedRecord)) return {changed: false, reason: 'terminal-progress'}
    if(hasActiveQueuedTabActionPhaseProgress(expectedRecord, expectedItem)) return {changed: false, reason: 'action-phase-progress'}
    const expectedPersistedTab = await getPersistedLiveTabForCoordinatorItem(expectedItem, expectedRecord, itemKey)
    if(expectedPersistedTab && !isDurableActiveCoordinatorReclaimStale(expectedItem, expectedRecord)) {
        return {changed: false, reason: 'persisted-tab-still-live'}
    }

    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'reconcileActiveWithoutRuntimeActor',
            reason: 'repair',
            itemKey,
            expectedItem,
            expectedRecord,
            reconcileReason: reason
        })
    })
}

async function terminalizeActiveCoordinatorNonProfileLanding(itemKey = '', landingUrl = '', options = {}) {
    const key = `${itemKey || ''}`.trim()
    if(!key) return {changed: false, reason: 'missing-item-key'}

    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'terminalizeActiveNonProfileLanding',
            reason: options.reason || 'repair',
            itemKey: key,
            landingUrl,
            expectedAttemptId: options.expectedAttemptId || '',
            expectedAttemptNumber: options.expectedAttemptNumber || 0,
            reconcileReason: options.reconcileReason || 'non-profile-landing'
        })
    })
}

async function mutateCoordinatorActiveNonProfileLandingTerminalize(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'repair')
    if(snapshotReason !== 'repair' && snapshotReason !== 'ordinaryMutation') {
        return {changed: false, reason: 'invalid-terminalize-reason'}
    }

    const itemKey = `${operation.itemKey || ''}`.trim()
    if(!itemKey) return {changed: false, reason: 'missing-item-key'}

    const state = await loadCoordinatorState()
    let currentAuthorityState = normalizeCoordinatorAuthorityStateInput(state)
    const queue = currentAuthorityState.queue
    const runs = state.runs
    const progress = state.progress
    const current = queue[itemKey] || null
    if(!current || !isActiveCoordinatorStatus(current.status)) return {changed: false, reason: 'row-changed'}

    const expectedAttemptId = normalizeAttemptId(operation.expectedAttemptId || '')
    const expectedAttemptNumber = Number.parseInt(operation.expectedAttemptNumber, 10) || 0
    if(expectedAttemptId && getAttemptIdFromValue(current) !== expectedAttemptId) return {changed: false, reason: 'attempt-changed'}
    if(expectedAttemptNumber && getAttemptNumberFromValue(current) !== expectedAttemptNumber) return {changed: false, reason: 'attempt-changed'}

    const href = getCoordinatorItemHref(current) || normalizeQuoraProfileUrl(itemKey)
    const currentRecord = getCoordinatorProgressRecordForItem(itemKey, current, progress)
    if(currentRecord && hasMismatchedCoordinatorAttempt(current, currentRecord)) return {changed: false, reason: 'progress-attempt-mismatch'}

    const landingUrl = `${operation.landingUrl || currentRecord?.lastUrl || currentRecord?.errorPageUrl || ''}`.trim()
    if(!shouldTerminalizeCoordinatorNonProfileLanding(current, currentRecord, itemKey, landingUrl)) {
        return {changed: false, reason: 'not-non-profile-landing'}
    }

    const now = Date.now()
    const message = getNonProfileQuoraLandingMessage(landingUrl)
    const nextItem = buildTerminalCoordinatorQueueItem(current, {
        status: 'skipped',
        outcome: 'non-profile-target',
        error: message,
        reason: `${operation.reconcileReason || 'non-profile-landing'}`.trim(),
        eventType: JOB_EVENT_TERMINAL,
        now
    })

    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'repair-non-profile-landing',
        rowKey: itemKey,
        expectedAttemptId,
        expectedAttemptNumber,
        reason: 'ordinaryMutation',
        metricPath: 'repair.nonProfileLanding.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            if(!isActiveCoordinatorStatus(currentItem?.status)) {
                return context.reject('row-changed')
            }
            if(JSON.stringify(currentItem) !== JSON.stringify(current)) {
                return context.reject('row-changed-before-authority-apply')
            }
            return nextItem
        }
    })

    if(authorityResult?.accepted !== true || authorityResult?.durable !== true) {
        return {
            changed: false,
            reason: authorityResult?.reason || 'authority-apply-failed'
        }
    }

    currentAuthorityState = coordinatorAuthority.current()
    const nextQueue = currentAuthorityState.queue

    let progressChanged = false
    if(href) {
        const terminalRecord = normalizeProgressPatch(
            href,
            {
                status: 'profile-unavailable',
                actionKind: nextItem.actionKind || current.actionKind || currentRecord?.actionKind || 'mute-block',
                attemptId: getAttemptIdFromValue(nextItem) || getAttemptIdFromValue(currentRecord),
                attemptNumber: getAttemptNumberFromValue(nextItem) || getAttemptNumberFromValue(currentRecord),
                runId: nextItem.runId || current.runId || currentRecord?.runId || '',
                tabId: getPersistedQueuedTabId(current, currentRecord) || null,
                openedViablePage: false,
                finalError: message,
                unavailableReason: message,
                errorPageUrl: landingUrl,
                closeRequestedAt: now,
                closedByExtension: true,
                closeReason: 'non-profile-landing',
                terminalAt: now,
                event: message
            },
            currentRecord || progress[href] || {}
        )
        if(terminalRecord) {
            progress[href] = terminalRecord
            profileNukeProgress = {
                ...profileNukeProgress,
                [href]: terminalRecord
            }
            progressChanged = true
        }
    }

    const affectedRunIds = new Set()
    if(nextItem.runId) affectedRunIds.add(nextItem.runId)
    if(current.runId) affectedRunIds.add(current.runId)
    if(href) {
        for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
            affectedRunIds.add(runId)
        }
    }
    const nextRuns = affectedRunIds.size
        ? recomputeCoordinatorRuns(nextQueue, runs, affectedRunIds)
        : runs
    const runsChanged = JSON.stringify(nextRuns) !== JSON.stringify(runs)

    if(runsChanged || progressChanged) {
        let derivedSaved = false
        try {
            derivedSaved = await saveCoordinatorState({
                runs: runsChanged ? nextRuns : undefined,
                progress: progressChanged ? pruneProfileNukeProgress(progress) : undefined
            }, {
                queue: false,
                runs: runsChanged,
                progress: progressChanged,
                reason: 'repair',
                queueOperation: 'repair-non-profile-landing-derived',
                queueChangedRows: 0
            })
        }
        catch(error) {
            derivedSaved = false
            recordCoordinatorDiagnosticEvent(
                'repair-non-profile-landing-derived-save-failed',
                error?.message || 'Non-profile landing derived save failed'
            )
        }
        if(derivedSaved === false) {
            incrementQueueWakeupMetric('repair.nonProfileLanding.derivedSaveFailed')
            scheduleStoredWorkRepair(1000, {
                reason: 'repair-non-profile-landing-derived-save-failed',
                edgeTriggered: true
            })
        }
    }

    incrementQueueWakeupMetric('reconcile.changed.nonProfileLanding')
    return {
        changed: true,
        status: nextItem.status,
        outcome: nextItem.outcome,
        tabId: getPersistedQueuedTabId(current, currentRecord),
        href,
        progressChanged
    }
}

async function mutateCoordinatorActiveWithoutRuntimeActorReconcile(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'repair')
    if(snapshotReason !== 'repair') return {changed: false, reason: 'invalid-reconcile-reason'}

    const itemKey = `${operation.itemKey || ''}`.trim()
    const expectedItem = operation.expectedItem || null
    if(!itemKey || !expectedItem || typeof expectedItem !== 'object') {
        return {changed: false, reason: 'invalid-item'}
    }

    let currentAuthorityState = await loadCoordinatorCurrentAuthorityState()
    const queue = currentAuthorityState.queue
    const runs = currentAuthorityState.runs
    const progress = currentAuthorityState.progress
    const current = queue[itemKey] || null
    if(!current || !isActiveCoordinatorStatus(current.status)) return {changed: false, reason: 'row-changed'}

    const expectedAttemptId = getAttemptIdFromValue(expectedItem)
    const expectedAttemptNumber = getAttemptNumberFromValue(expectedItem)
    if(expectedAttemptId && getAttemptIdFromValue(current) !== expectedAttemptId) return {changed: false, reason: 'attempt-changed'}
    if(expectedAttemptNumber && getAttemptNumberFromValue(current) !== expectedAttemptNumber) return {changed: false, reason: 'attempt-changed'}

    const href = getCoordinatorItemHref(current) || normalizeQuoraProfileUrl(itemKey)
    const currentRecord = getCoordinatorProgressRecordForItem(itemKey, current, progress)
    if(currentRecord && hasMismatchedCoordinatorAttempt(current, currentRecord)) return {changed: false, reason: 'progress-attempt-mismatch'}
    if(isTerminalProfileNukeRecord(currentRecord)) return {changed: false, reason: 'terminal-progress'}
    if(hasActiveQueuedTabActionPhaseProgress(currentRecord, current)) return {changed: false, reason: 'action-phase-progress'}

    const tabId = getPersistedQueuedTabId(current, currentRecord)
    const persistedTab = await getPersistedLiveTabForCoordinatorItem(current, currentRecord, itemKey)
    if(persistedTab && !isDurableActiveCoordinatorReclaimStale(current, currentRecord)) {
        return {changed: false, reason: 'persisted-tab-still-live'}
    }

    const now = Date.now()
    const reconcileReason = `${operation.reconcileReason || 'reconcile-active-without-actor'}`.trim()
    const currentHref = getCoordinatorItemHref(current) || normalizeQuoraProfileUrl(itemKey)
    const currentCoordinatorKey = getCoordinatorItemQueueKey(current, itemKey)
    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'repair-active-without-actor',
        rowKey: itemKey,
        expectedAttemptId,
        expectedAttemptNumber,
        reason: 'ordinaryMutation',
        metricPath: 'repair.activeWithoutActor.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            if(!isActiveCoordinatorStatus(currentItem?.status)) {
                return context.reject('row-changed')
            }
            if((getCoordinatorItemHref(currentItem) || normalizeQuoraProfileUrl(itemKey)) !== currentHref ||
                getCoordinatorItemQueueKey(currentItem, itemKey) !== currentCoordinatorKey) {
                return context.reject('row-target-changed-before-authority-apply')
            }
            return buildRequeuedActiveCoordinatorItemWithoutActor(currentItem, currentRecord, now, reconcileReason)
        }
    })

    if(authorityResult?.accepted !== true || authorityResult?.durable !== true) {
        return {
            changed: false,
            reason: authorityResult?.reason || 'authority-apply-failed'
        }
    }

    currentAuthorityState = coordinatorAuthority.current()
    const nextQueue = currentAuthorityState.queue
    const nextItem = authorityResult.nextRow || nextQueue[itemKey] || null
    if(!nextItem) return {changed: false, reason: 'authority-row-missing-after-apply'}

    let progressChanged = false
    if(href && !isTerminalCoordinatorStatus(nextItem.status)) {
        const resetRecord = normalizeProgressPatch(
            href,
            buildQueuedCoordinatorProgressResetPatch(nextItem, {
                now,
                runId: nextItem.runId || current.runId || '',
                actionKind: nextItem.actionKind || current.actionKind || ''
            }),
            currentRecord || progress[href] || {}
        )
        if(resetRecord) {
            progress[href] = resetRecord
            profileNukeProgress = {
                ...profileNukeProgress,
                [href]: resetRecord
            }
            progressChanged = true
        }
    }
    else if(href) {
        const terminalRecord = makeTerminalProgressRecordFromCoordinatorItem(
            href,
            nextItem,
            currentRecord || progress[href] || {},
            'Failed durable active row without a confirmed runtime actor'
        )
        if(terminalRecord) {
            progress[href] = terminalRecord
            profileNukeProgress = {
                ...profileNukeProgress,
                [href]: terminalRecord
            }
            progressChanged = true
        }
    }

    const affectedRunIds = new Set()
    if(nextItem.runId) affectedRunIds.add(nextItem.runId)
    if(current.runId) affectedRunIds.add(current.runId)
    if(href) {
        for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
            affectedRunIds.add(runId)
        }
    }
    const nextRuns = affectedRunIds.size
        ? recomputeCoordinatorRuns(nextQueue, runs, affectedRunIds)
        : runs
    const runsChanged = affectedRunIds.size && JSON.stringify(nextRuns) !== JSON.stringify(runs)
    let derivedSaved = true
    try {
        derivedSaved = await saveCoordinatorState({
            runs: runsChanged ? nextRuns : undefined,
            progress: progressChanged ? pruneProfileNukeProgress(progress) : undefined
        }, {
            queue: false,
            runs: runsChanged,
            progress: progressChanged,
            reason: 'repair',
            queueOperation: 'repair-active-without-actor-derived',
            queueChangedRows: 0
        })
    }
    catch(error) {
        derivedSaved = false
        recordCoordinatorDiagnosticEvent(
            'repair-active-without-actor-derived-save-failed',
            error?.message || 'Active-without-actor derived save failed'
        )
    }
    if(derivedSaved === false) {
        incrementQueueWakeupMetric('repair.activeWithoutActor.derivedSaveFailed')
        scheduleStoredWorkRepair(1000, {
            reason: 'repair-active-without-actor-derived-save-failed',
            edgeTriggered: true
        })
    }

    return {
        changed: true,
        status: nextItem.status,
        tabId: persistedTab ? tabId : null,
        href,
        progressChanged
    }
}

async function reconcileUnconfirmedQueuedRuntimeActor(tabId = null, reason = 'reconcile-unconfirmed-runtime') {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return {changed: false, reason: 'invalid-tab'}

    const metadata = getQueuedTabMetadata(normalizedTabId)
    if(!metadata) {
        detachQueuedTabRuntimeState(normalizedTabId, reason)
        return {changed: true, detached: true, closed: false, reason: 'metadata-missing'}
    }

    const confirmed = await promiseWithTimeout(
        confirmQueuedTabDurablyActive(metadata, {id: normalizedTabId}, metadata),
        QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,
        'provisional queued tab durable confirmation'
    ).catch(() => false)
    if(confirmed) return {changed: true, confirmed: true, reason: 'confirmed'}

    const href = normalizeQuoraProfileUrl(metadata.profileHref || metadata.targetProfileHref || '')
    const record = href ? profileNukeProgress?.[href] || null : null
    const actionPhaseProgress = hasActiveQueuedTabActionPhaseProgress(record, metadata)
    if(!actionPhaseProgress) {
        markQueuedTabClosing(normalizedTabId, reason)
        detachQueuedTabRuntimeState(normalizedTabId, reason)
        try {
            await browser.tabs.remove(normalizedTabId)
        }
        catch {}
    }
    else {
        detachQueuedTabRuntimeState(normalizedTabId, reason)
    }

    return {
        changed: true,
        detached: true,
        closed: !actionPhaseProgress,
        actionPhaseProgress,
        reason: actionPhaseProgress ? 'detached-action-phase-progress' : 'closed-unconfirmed-provisional'
    }
}

async function runCoordinatorAuthorityReconcileActions(reason = 'coordinator-authority-reconcile', options = {}) {
    const actionBudget = getCoordinatorReconcileActionBudget(options)
    const currentAuthorityState = await loadCoordinatorCurrentAuthorityState({
        [COORDINATOR_QUEUE_KEY]: {},
        [PROFILE_NUKE_PROGRESS_KEY]: {},
        [COORDINATOR_PAUSED_KEY]: false
    })
    const queue = currentAuthorityState.queue
    const progress = currentAuthorityState.progress
    const paused = !!currentAuthorityState.stored?.[COORDINATOR_PAUSED_KEY]
    const liveProfileTabsByHref = await getLiveProfileTabsByHref()
    let actions = 0
    let adopted = 0
    let requeued = 0
    let failed = 0
    let skipped = 0
    let runtimeDetached = 0
    let runtimeClosed = 0
    let confirmed = 0
    let budgetExhausted = false

    profileNukeProgress = progress
    if(paused) return {changed: false, paused: true, actionBudget, actions: 0}

    for(const tabId of Array.from(activeQueuedTabs)) {
        if(actions >= actionBudget) {
            budgetExhausted = true
            break
        }
        if(hasDurableQueueMatchForRuntimeTab(tabId, queue, progress)) continue

        const result = await reconcileUnconfirmedQueuedRuntimeActor(tabId, reason)
        if(!result.changed) continue
        actions += 1
        if(result.confirmed) confirmed += 1
        if(result.detached) runtimeDetached += 1
        if(result.closed) runtimeClosed += 1
    }

    for(const [itemKey, item] of Object.entries(queue)) {
        if(actions >= actionBudget) {
            budgetExhausted = true
            break
        }
        if(!isActiveCoordinatorStatus(item?.status)) continue

        const record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
        if(record && hasMismatchedCoordinatorAttempt(item, record)) continue
        if(isTerminalProfileNukeRecord(record)) continue
        if(hasConfirmedLiveRuntimeActorForCoordinatorItem(item, record, liveProfileTabsByHref)) continue

        const nonProfileLandingUrl = record?.lastUrl || record?.errorPageUrl || ''
        if(shouldTerminalizeCoordinatorNonProfileLanding(item, record, itemKey, nonProfileLandingUrl)) {
            const result = await terminalizeActiveCoordinatorNonProfileLanding(itemKey, nonProfileLandingUrl, {
                reason: 'repair',
                expectedAttemptId: getAttemptIdFromValue(item),
                expectedAttemptNumber: getAttemptNumberFromValue(item),
                reconcileReason: reason
            }).catch(error => ({
                changed: false,
                reason: 'active-row-non-profile-terminalize-error',
                error: error?.message || `${error || ''}`
            }))
            if(result.changed) {
                actions += 1
                if(result.status === 'skipped') skipped += 1
                else if(isTerminalCoordinatorStatus(result.status)) failed += 1
                if(result.tabId) {
                    cleanupQueuedTabMetadataOnly(result.tabId)
                    try {
                        const tab = await browser.tabs.get(result.tabId)
                        if(isSafeToCloseNonProfileLandingTab(item, record, tab)) {
                            await browser.tabs.remove(result.tabId)
                        }
                    }
                    catch {}
                }
                continue
            }
        }

        const tokenMatchedTab = await getTokenMatchedLiveOrPersistedTabForCoordinatorItem(item, record, itemKey, liveProfileTabsByHref)
        if(tokenMatchedTab) {
            const adoptedTab = await adoptLiveCoordinatorQueuedTab(item, itemKey, tokenMatchedTab, SERVICE_WORKER_QUEUE_OWNER_ID)
            if(adoptedTab) {
                actions += 1
                adopted += 1
                continue
            }
        }

        if(hasActiveQueuedTabActionPhaseProgress(record, item)) continue

        const result = await requeueDurableActiveCoordinatorItemWithoutActor(itemKey, item, record, reason)
            .catch(error => ({
                changed: false,
                reason: 'active-row-requeue-error',
                error: error?.message || `${error || ''}`
            }))
        if(!result.changed) continue

        actions += 1
        if(result.status === 'queued') requeued += 1
        else if(isTerminalCoordinatorStatus(result.status)) failed += 1
        if(result.tabId) {
            cleanupQueuedTabMetadataOnly(result.tabId)
            try {
                await browser.tabs.remove(result.tabId)
            }
            catch {}
        }
    }

    if(runtimeDetached) incrementQueueWakeupMetric('reconcile.changed.runtimeDetached', runtimeDetached)
    if(runtimeClosed) incrementQueueWakeupMetric('reconcile.changed.runtimeClosed', runtimeClosed)
    if(confirmed) incrementQueueWakeupMetric('reconcile.changed.runtimeConfirmed', confirmed)
    if(adopted) incrementQueueWakeupMetric('reconcile.changed.activeAdopted', adopted)
    if(requeued) incrementQueueWakeupMetric('reconcile.changed.activeRequeued', requeued)
    if(failed) incrementQueueWakeupMetric('reconcile.changed.activeFailed', failed)
    if(skipped) incrementQueueWakeupMetric('reconcile.changed.activeSkipped', skipped)
    if(budgetExhausted) incrementQueueWakeupMetric('reconcile.rescheduled.budgetExhausted')

    return {
        changed: actions > 0,
        actions,
        actionBudget,
        budgetExhausted,
        runtimeDetached,
        runtimeClosed,
        confirmed,
        adopted,
        requeued,
        failed,
        skipped,
        paused: false
    }
}

async function observeCoordinatorReconcileSnapshot(reason = 'reconcile-observe', options = {}) {
    const currentAuthorityState = await loadCoordinatorCurrentAuthorityState({
        [COORDINATOR_QUEUE_KEY]: {},
        [PROFILE_NUKE_PROGRESS_KEY]: {},
        [COORDINATOR_PAUSED_KEY]: false
    })
    const queue = currentAuthorityState.queue || {}
    const progress = currentAuthorityState.progress || {}
    const paused = !!currentAuthorityState.stored?.[COORDINATOR_PAUSED_KEY]
    const liveProfileTabsByHref = options.includeLiveTabs === false
        ? new Map()
        : await getLiveProfileTabsByHref()
    const durable = getCoordinatorQueueWorkCounts(queue)
    const mismatch = getCoordinatorAuthorityMismatchCounts(queue, progress, liveProfileTabsByHref, options)

    return {
        reason,
        paused,
        hasStoredWork: hasStoredCoordinatorWork(queue),
        ...durable,
        ...getQueueWakeupMetricRuntimeSnapshot(),
        ...mismatch
    }
}

function recordActiveStorageWorkSnapshot(queue = {}, options = {}) {
    if(!activeQueueWakeupStorageContext) return

    const counts = getCoordinatorQueueWorkCounts(queue)
    activeQueueWakeupStorageContext.durableActiveRows = counts.durableActiveRows
    activeQueueWakeupStorageContext.durableQueuedRows = counts.durableQueuedRows
    activeQueueWakeupStorageContext.durableTerminalRows = counts.durableTerminalRows
    if(options.paused !== undefined) activeQueueWakeupStorageContext.paused = options.paused === true
}

function getStorageContextJournalDetails(context = {}) {
    const now = Date.now()
    const startedAt = Number.parseInt(context.startedAt, 10) || 0
    const finishedAt = Number.parseInt(context.finishedAt, 10) || 0
    const timedOutAt = Number.parseInt(context.timedOutAt, 10) || 0
    const effectiveEndAt = finishedAt || timedOutAt || now
    const queueWaitMs = startedAt
        ? Math.max(0, startedAt - (Number.parseInt(context.enqueuedAt, 10) || startedAt))
        : Math.max(0, effectiveEndAt - (Number.parseInt(context.enqueuedAt, 10) || effectiveEndAt))
    const runMs = startedAt ? Math.max(0, effectiveEndAt - startedAt) : 0
    const totalMs = Math.max(0, effectiveEndAt - (Number.parseInt(context.enqueuedAt, 10) || effectiveEndAt))

    return {
        updateToken: Number.parseInt(context.updateToken, 10) || 0,
        reason: context.reason || '',
        enqueuedAt: Number.parseInt(context.enqueuedAt, 10) || 0,
        startedAt,
        finishedAt,
        timedOutAt,
        queueWaitMs,
        runMs,
        totalMs,
        timedOut: context.didTimeout === true,
        timeoutMs: Number.parseInt(context.timeoutMs, 10) || 0,
        deadlineMissed: context.deadlineMissed === true,
        fallbackReturned: context.fallbackReturned === true,
        abandoned: context.abandoned === true,
        tailWedged: context.tailWedged === true,
        lateWriteSuppressed: context.lateWriteSuppressed === true,
        abortedOperation: context.abortedOperation || '',
        depth: Number.parseInt(context.depth, 10) || 0,
        maxNestedDepth: Number.parseInt(context.maxNestedDepth, 10) || 0,
        nestedUpdateCount: Number.parseInt(context.nestedUpdateCount, 10) || 0,
        timeoutPhase: context.timeoutPhase || '',
        currentPhase: context.currentPhase || '',
        storageGetCalls: Number.parseInt(context.storageGetCalls, 10) || 0,
        storageSetCalls: Number.parseInt(context.storageSetCalls, 10) || 0,
        saveCoordinatorStateCalls: Number.parseInt(context.saveCoordinatorStateCalls, 10) || 0,
        storageGetMs: Math.round(Number(context.storageGetMs) || 0),
        storageSetMs: Math.round(Number(context.storageSetMs) || 0),
        storageGetCumulativeMs: Math.round(Number(context.storageGetMs) || 0),
        storageSetCumulativeMs: Math.round(Number(context.storageSetMs) || 0),
        ownStorageGetMs: Math.round(getPhaseWallMs(context, 'storageGet')),
        ownStorageSetMs: Math.round(getPhaseWallMs(context, 'storageSet')),
        loadCoordinatorStateMs: Math.round(Number(context.loadCoordinatorStateMs) || 0),
        saveCoordinatorStateMs: Math.round(Number(context.saveCoordinatorStateMs) || 0),
        normalizeQueueMs: Math.round(Number(context.normalizeQueueMs) || 0),
        normalizeRunsMs: Math.round(Number(context.normalizeRunsMs) || 0),
        normalizeEventsMs: Math.round(Number(context.normalizeEventsMs) || 0),
        normalizeProgressMs: Math.round(Number(context.normalizeProgressMs) || 0),
        recomputeRunsMs: Math.round(Number(context.recomputeRunsMs) || 0),
        flushDiagnosticEventsMs: Math.round(Number(context.flushDiagnosticEventsMs) || 0),
        flushMilestonesMs: Math.round(Number(context.flushMilestonesMs) || 0),
        payloadBytes: Number.parseInt(context.payloadBytes, 10) || 0,
        payloadKeys: context.payloadKeys || '',
        durableActiveRows: Number.parseInt(context.durableActiveRows, 10) || 0,
        durableQueuedRows: Number.parseInt(context.durableQueuedRows, 10) || 0,
        durableTerminalRows: Number.parseInt(context.durableTerminalRows, 10) || 0,
        paused: context.paused === true
    }
}

function getStorageTimeoutBucket(context = {}) {
    if(!context.startedAt) return 'timeout.beforeStart'

    const phase = `${context.currentPhase || ''}`.trim()
    if(phase === 'storageGet') return 'timeout.duringStorageGet'
    if(phase === 'storageSet') return 'timeout.duringStorageSet'
    if(phase === 'recomputeRuns') return 'timeout.duringRecomputeRuns'
    if(phase === 'flushDiagnosticEvents') return 'timeout.duringDiagnosticFlush'
    if(phase === 'flushMilestones') return 'timeout.duringMilestoneFlush'
    if(/^normalize/.test(phase)) return 'timeout.duringNormalize'
    return 'timeout.unknown'
}

function recordStorageIdleChurnCounters(context = {}) {
    const runtimeHasWork = activeQueuedTabs.size > 0 || queuedTabActions.length > 0 || pendingTabActions.size > 0
    const durableHasWork = (Number.parseInt(context.durableActiveRows, 10) || 0) > 0 ||
        (Number.parseInt(context.durableQueuedRows, 10) || 0) > 0

    if(!runtimeHasWork) incrementQueueWakeupMetric('storageUpdate.noRuntimeWork')
    if(!durableHasWork) incrementQueueWakeupMetric('storageUpdate.noDurableWork')
}

function finishQueueWakeupMetricCycle(cycle = null, result = '', resultReason = '', details = {}) {
    if(!cycle) return
    if(cycle.finished) return
    cycle.finished = true
    pushQueueWakeupJournalEntry({
        kind: cycle.kind,
        name: cycle.name,
        reason: cycle.reason,
        result,
        resultReason,
        at: cycle.startedAt,
        durationMs: Date.now() - cycle.startedAt,
        counters: cycle.generation === queueWakeupMetricGeneration
            ? getQueueWakeupMetricCounterDelta(cycle.counters)
            : {},
        details: {
            ...getQueueWakeupMetricRuntimeSnapshot(),
            ...(cycle.details || {}),
            ...(details || {}),
            ...(cycle.generation === queueWakeupMetricGeneration ? {} : {metricsReloadedDuringCycle: true})
        }
    })
}

function scheduleQueueWakeupMetricsFlush() {
    queueWakeupMetricsDirty = true
    if(!queueWakeupMetricsLoaded) return
    if(spaceFeedStorageUpdateDepth > 0) return
    if(queueWakeupMetricsFlushPromise) return

    queueWakeupMetricsFlushPromise = Promise.resolve()
        .then(() => flushQueueWakeupMetrics())
        .finally(() => {
            queueWakeupMetricsFlushPromise = null
        })
}

async function flushQueueWakeupMetrics() {
    if(!queueWakeupMetricsLoaded) return
    if(!queueWakeupMetricsDirty) return
    queueWakeupMetricsDirty = false
    try {
        await promiseWithTimeout(
            coordinatorStorageAdapter.set({
                [QUEUE_WAKEUP_METRICS_KEY]: queueWakeupMetrics,
                [QUEUE_WAKEUP_METRICS_VIEW_KEY]: buildQueueWakeupMetricsView(queueWakeupMetrics)
            }),
            QUEUE_WAKEUP_METRICS_STORAGE_TIMEOUT_MS,
            'queue wakeup metrics flush'
        )
    }
    catch {
        queueWakeupMetricsDirty = true
    }
}

async function loadQueueWakeupMetrics() {
    try {
        const stored = await promiseWithTimeout(
            coordinatorStorageAdapter.get({[QUEUE_WAKEUP_METRICS_KEY]: queueWakeupMetrics}),
            QUEUE_WAKEUP_METRICS_STORAGE_TIMEOUT_MS,
            'queue wakeup metrics load'
        )
        queueWakeupMetrics = normalizeQueueWakeupMetrics(stored[QUEUE_WAKEUP_METRICS_KEY])
        queueWakeupMetricsLoaded = true
        queueWakeupMetricGeneration += 1
        const epoch = getQueueWakeupMetricEpoch()
        queueLoadThrottle = normalizeQueueLoadThrottle(epoch.queueLoadThrottle)
        const loadedVersion = `${epoch.extensionVersion || ''}`.trim()
        const currentVersion = getExtensionVersion()
        if(loadedVersion && currentVersion && loadedVersion !== currentVersion) {
            pendingQueueWakeupMetricsReset = null
            resetQueueWakeupMetricsEpoch('extension-updated')
            await flushQueueWakeupMetrics()
            return
        }
        const now = Date.now()
        if(!epoch.firstServiceWorkerStartedAt) epoch.firstServiceWorkerStartedAt = now
        epoch.lastServiceWorkerStartedAt = now
        incrementQueueWakeupMetric('serviceWorker.started')
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'service-worker-started',
            result: 'state-changed'
        })
    }
    catch {
        queueWakeupMetrics = makeEmptyQueueWakeupMetrics()
        queueLoadThrottle = makeEmptyQueueLoadThrottle()
        queueWakeupMetricsLoaded = false
        queueWakeupMetricsDirty = false
        queueWakeupMetricGeneration += 1
    }
}

async function refreshQueueWakeupMetricsViewForDashboard(reason = 'dashboard-refresh') {
    await ensureQueueWakeupMetricsLoaded().catch(() => null)
    const view = buildQueueWakeupMetricsView(queueWakeupMetrics)
    await metricStorageSet({[QUEUE_WAKEUP_METRICS_VIEW_KEY]: view}, {
        metricPath: `metricsView.${normalizeStorageMetricPathName(reason)}`
    }).catch(() => null)
    return {
        refreshed: true,
        reason,
        view
    }
}

function getFirstPositiveNumber(...values) {
    for(const value of values) {
        const number = Number.parseInt(value, 10) || 0
        if(number > 0) return number
    }
    return 0
}

function recordQueueWakeupPhaseSamplesFromProgress(record = {}) {
    if(!record || typeof record !== 'object') return

    const queuedAt = getFirstPositiveNumber(record.queuedAt, record.createdAt)
    const tabOpenedAt = getFirstPositiveNumber(record.tabOpenedAt, record.tabCreatedAt)
    const claimAcceptedAt = getFirstPositiveNumber(record.claimAcceptedAt, record.contentOpenedAt)
    const actionReadyAt = getFirstPositiveNumber(record.actionReadyAt)
    const actionStartedAt = getFirstPositiveNumber(
        record.blockAttemptedAt,
        record.muteAttemptedAt,
        record.unblockAttemptedAt,
        record.unmuteAttemptedAt
    )
    const terminalAt = getFirstPositiveNumber(record.terminalAt, record.blockedAt, record.unblockedAt, record.updatedAt)
    const slotReleasedAt = getFirstPositiveNumber(record.slotReleasedAt)

    if(queuedAt && tabOpenedAt && tabOpenedAt >= queuedAt) {
        recordQueueWakeupPhase('durableQueueToTabOpen', tabOpenedAt - queuedAt)
    }
    if(tabOpenedAt && claimAcceptedAt && claimAcceptedAt >= tabOpenedAt) {
        recordQueueWakeupPhase('tabOpenToClaimAccepted', claimAcceptedAt - tabOpenedAt)
    }
    if(claimAcceptedAt && actionStartedAt && actionStartedAt >= claimAcceptedAt) {
        recordQueueWakeupPhase('claimAcceptedToActionStart', actionStartedAt - claimAcceptedAt)
    }
    if(actionReadyAt && actionStartedAt && actionStartedAt >= actionReadyAt) {
        recordQueueWakeupPhase('actionReadyToActionStart', actionStartedAt - actionReadyAt)
    }
    if(actionStartedAt && terminalAt && terminalAt >= actionStartedAt) {
        recordQueueWakeupPhase('actionStartToTerminal', terminalAt - actionStartedAt)
    }
    if(terminalAt && slotReleasedAt && slotReleasedAt >= terminalAt) {
        recordQueueWakeupPhase('terminalToSlotRelease', slotReleasedAt - terminalAt)
    }
}

function pruneProfileNukeProgress(records, maxEntries = MAX_PROFILE_NUKE_PROGRESS_ENTRIES) {
    const entries = Object.entries(records || {})
        .filter(([key, value]) => !!key && value && typeof value === 'object')
        .sort((left, right) => {
            const leftUpdatedAt = Number.isFinite(left[1].updatedAt) ? left[1].updatedAt : 0
            const rightUpdatedAt = Number.isFinite(right[1].updatedAt) ? right[1].updatedAt : 0
            return rightUpdatedAt - leftUpdatedAt || left[0].localeCompare(right[0])
        })

    if(maxEntries > 0 && entries.length > maxEntries) {
        entries.length = maxEntries
    }

    return Object.fromEntries(entries)
}

function mergeProfileProgressEvents(existingEvents = [], incomingEvents = []) {
    const seen = new Set()
    const merged = []

    for(const value of [...existingEvents, ...incomingEvents]) {
        const normalized = `${value || ''}`.trim()
        if(!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        merged.push(normalized)
    }

    merged.sort()
    return merged.slice(-12)
}

function mergeUniqueStringList(...values) {
    const seen = new Set()
    const merged = []

    for(const value of values.flat()) {
        const normalized = `${value || ''}`.trim()
        if(!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        merged.push(normalized)
    }

    return merged
}

function getNormalizedProfileHrefList(values = []) {
    const seen = new Set()
    const normalized = []

    for(const value of values || []) {
        const href = normalizeQuoraProfileUrl(value)
        if(!href || seen.has(href)) continue
        seen.add(href)
        normalized.push(href)
    }

    return normalized
}

function normalizeCoordinatorRequestedUrl(value = '') {
    const normalized = normalizeTabTargetUrl(`${value || ''}`.trim())
    if(!normalized) return ''

    try {
        const url = new URL(normalized)
        url.hash = ''
        return url.toString()
    }
    catch {
        return normalized
    }
}

function isProfileResolutionMode(value = '') {
    return `${value || ''}`.trim() === QUEUED_PROFILE_RESOLUTION_MODE
}

function isProfileResolutionItem(item = null) {
    return item?.resolveProfileFromPage === true ||
        isProfileResolutionMode(item?.resolutionMode || '') ||
        `${item?.coordinatorKey || item?.dedupeKey || ''}`.trim().startsWith('resolve-profile:')
}

function stripProfileResolutionQueueKey(key = '') {
    const value = `${key || ''}`.trim()
    return value.startsWith('resolve-profile:') ? value.slice('resolve-profile:'.length) : value
}

function makeProfileResolutionQueueKey(value = '') {
    const requestedUrl = normalizeCoordinatorRequestedUrl(stripProfileResolutionQueueKey(value))
    return requestedUrl ? `resolve-profile:${requestedUrl}` : ''
}

function getEncodedQuoraPathRootToken(value = '') {
    const token = `${value || ''}`.split(/[-_/]/).filter(Boolean)[0] || ''
    return token.toLowerCase()
}

function isEncodedProfilePathOrTruncatedProfilePath(value = '') {
    const rootToken = getEncodedQuoraPathRootToken(value)
    return rootToken.length >= 3 && 'profile'.startsWith(rootToken)
}

function isLowConfidenceEncodedQuestionPath(value = '') {
    const path = `${value || ''}`.replace(/^[-_/]+|[-_/]+$/g, '')
    if(path.length < 12) return true
    if(isEncodedProfilePathOrTruncatedProfilePath(path)) return true

    const rootToken = getEncodedQuoraPathRootToken(path)
    return QUORA_NON_PROFILE_ROOT_PATHS.has(rootToken)
}

function getQuestionResolutionUrlFromEvidencePostUrl(postUrl = '') {
    try {
        const url = new URL(`${postUrl || ''}`)
        const decodedPath = decodeURIComponent(url.pathname || '').replace(/^\/+/, '')
        const encodedQuoraUrlPattern = /(?:^|[-_/])https?-www-quora-com-([^/?#]+)/ig
        let match = null

        while((match = encodedQuoraUrlPattern.exec(decodedPath))) {
            const encodedPath = `${match[1] || ''}`.replace(/^[-_/]+|[-_/]+$/g, '')
            if(isLowConfidenceEncodedQuestionPath(encodedPath)) continue

            return normalizeCoordinatorRequestedUrl(`https://www.quora.com/${encodedPath}`)
        }
    }
    catch {
        return ''
    }

    return ''
}

function getProfileResolutionRequestedUrl(item = {}, fallbackKey = '') {
    return normalizeCoordinatorRequestedUrl(
        item?.requestedUrl ||
        stripProfileResolutionQueueKey(item?.coordinatorKey || item?.dedupeKey || fallbackKey || '')
    )
}

function getInvalidProfileResolutionFailure(item = {}, fallbackKey = '') {
    if(!isProfileResolutionItem(item)) return ''

    const requestedUrl = getProfileResolutionRequestedUrl(item, fallbackKey)
    if(!requestedUrl) return 'Queued profile resolution has no source page'

    try {
        const url = new URL(requestedUrl)
        const hostname = `${url.hostname || ''}`.toLowerCase()
        const isPrimaryQuoraHost = hostname === 'quora.com' || hostname === 'www.quora.com'
        const isQuoraSubdomain = hostname.endsWith('.quora.com')
        if(!isPrimaryQuoraHost && !isQuoraSubdomain) {
            return `Queued profile resolution source is not a Quora page: ${requestedUrl}`
        }

        const pathParts = url.pathname.split('/').filter(Boolean)
        const rootToken = `${pathParts[0] || ''}`.toLowerCase()
        if(isQuoraSubdomain && !isPrimaryQuoraHost) return ''
        if(!rootToken) return `Queued profile resolution source is not a question page: ${requestedUrl}`
        if(rootToken.length >= 3 && 'profile'.startsWith(rootToken)) {
            return `Queued profile resolution source looks like a truncated profile URL: ${requestedUrl}`
        }
        if(QUORA_NON_PROFILE_ROOT_PATHS.has(rootToken)) {
            return `Queued profile resolution source is not a question page: ${requestedUrl}`
        }
    }
    catch {
        return `Queued profile resolution source is invalid: ${requestedUrl}`
    }

    return ''
}

function getCoordinatorItemQueueKey(item = null, fallbackKey = '') {
    const href = getCoordinatorItemHref(item || {})
    if(href) return href

    const explicitKey = `${item?.coordinatorKey || ''}`.trim()
    if(explicitKey) return explicitKey

    if(isProfileResolutionItem(item)) {
        return makeProfileResolutionQueueKey(item?.requestedUrl || item?.dedupeKey || fallbackKey || '')
    }

    return normalizeQuoraProfileUrl(fallbackKey || '') || `${fallbackKey || ''}`.trim()
}

function getCoordinatorItemOpenUrl(item = null) {
    const href = getCoordinatorItemHref(item || {})
    if(href) return href
    if(isProfileResolutionItem(item)) {
        return normalizeCoordinatorRequestedUrl(item?.requestedUrl || stripProfileResolutionQueueKey(item?.dedupeKey || ''))
    }

    return normalizeTabTargetUrl(item?.requestedUrl || item?.dedupeKey || '')
}

function makeCoordinatorScope(runInput = {}, source = {}, runId = '') {
    return {
        type: runInput.sourceType || source.type || 'space-feed',
        runId: runId || runInput.id || '',
        sourcePageUrl: source.pageUrl || runInput.sourcePageUrl || '',
        spaceKey: source.spaceKey || '',
        spaceCategory: source.spaceCategory || ''
    }
}

function makeCoordinatorResolutionSubject(requestedUrl = '', coordinatorKey = '') {
    const normalizedUrl = normalizeCoordinatorRequestedUrl(requestedUrl || stripProfileResolutionQueueKey(coordinatorKey || ''))
    if(!normalizedUrl) return null

    return {
        kind: 'quora-source-page',
        href: normalizedUrl,
        requestedUrl: normalizedUrl,
        aliases: coordinatorKey ? [coordinatorKey] : []
    }
}

function getCoordinatorSubjectKey(subject = null) {
    if(!subject || typeof subject !== 'object') return ''
    return `${subject.kind || 'subject'}:${subject.href || subject.requestedUrl || subject.key || ''}`
}

function makeCoordinatorJobKey(scope = {}, actionKind = '', subject = null) {
    const scopeKey = scope.runId ||
        [scope.type || 'global', scope.sourcePageUrl || scope.spaceKey || ''].filter(Boolean).join(':') ||
        'global'
    const subjectKey = getCoordinatorSubjectKey(subject)
    if(!subjectKey) return ''

    return `${scopeKey}|${getCoordinatorActionKindForRequestedAction(actionKind)}|${subjectKey}`
}

function makeCoordinatorAttemptEnvelope(existing = null, attemptId = '', attemptNumber = 0, maxAttempts = 1) {
    const previous = existing?.attempt && typeof existing.attempt === 'object' ? existing.attempt : {}
    return {
        ...previous,
        id: normalizeAttemptId(attemptId || previous.id || ''),
        number: Number.parseInt(attemptNumber || previous.number, 10) || 0,
        max: Number.parseInt(maxAttempts || previous.max, 10) || 1,
        claimedTabId: previous.claimedTabId ?? existing?.tabId ?? null,
        claimedAt: Number.parseInt(previous.claimedAt, 10) || 0,
        leaseExpiresAt: Number.parseInt(previous.leaseExpiresAt, 10) || 0,
        heartbeatAt: Number.parseInt(previous.heartbeatAt, 10) || 0
    }
}

function makeCoordinatorJobEnvelope(details = {}) {
    const targetProfileHref = normalizeQuoraProfileUrl(details.targetProfileHref || '')
    const coordinatorKey = `${details.coordinatorKey || targetProfileHref || ''}`.trim()
    const requestedUrl = normalizeCoordinatorRequestedUrl(details.requestedUrl || targetProfileHref || coordinatorKey)
    const actionKind = getCoordinatorActionKindForRequestedAction(details.actionKind || '')
    const scope = makeCoordinatorScope(details.runInput || {}, details.source || {}, details.runId || '')
    const canonicalSubject = targetProfileHref
        ? makeCanonicalSubject(targetProfileHref)
        : makeCoordinatorResolutionSubject(requestedUrl, coordinatorKey)
    const jobKey = makeCoordinatorJobKey(scope, actionKind, canonicalSubject)

    return {
        jobKey,
        scope,
        canonicalSubject
    }
}

function applyCoordinatorJobEnvelope(item = {}, details = {}) {
    const envelope = makeCoordinatorJobEnvelope({
        targetProfileHref: item.targetProfileHref || details.targetProfileHref || '',
        requestedUrl: item.requestedUrl || details.requestedUrl || '',
        coordinatorKey: item.coordinatorKey || details.coordinatorKey || '',
        actionKind: item.actionKind || details.actionKind || '',
        runInput: details.runInput || {},
        source: item.source || details.source || {},
        runId: item.runId || details.runId || ''
    })

    return {
        ...item,
        jobKey: envelope.jobKey || item.jobKey || '',
        scope: envelope.scope || item.scope,
        canonicalSubject: envelope.canonicalSubject || item.canonicalSubject,
        attempt: makeCoordinatorAttemptEnvelope(
            item,
            getAttemptIdFromValue(item),
            getAttemptNumberFromValue(item),
            item.maxAttempts || item.attempt?.max || 1
        )
    }
}

function getFailedItemQuestionResolutionUrl(item = {}) {
    const errorText = `${item?.error || ''}`
    const questionPathMatch = errorText.match(/\bquestion:\s*(\/[^)\s]+)/i)
    if(questionPathMatch?.[1]) {
        return normalizeCoordinatorRequestedUrl(`https://www.quora.com${questionPathMatch[1]}`)
    }

    const evidence = Array.isArray(item?.evidence) ? item.evidence : []
    for(const entry of evidence) {
        try {
            const requestedUrl = getQuestionResolutionUrlFromEvidencePostUrl(entry?.postUrl || '')
            if(requestedUrl) return requestedUrl
        }
        catch {}
    }

    if(/\bdid not land on a profile page\b/i.test(errorText)) {
        for(const entry of evidence) {
            const postUrl = normalizeCoordinatorRequestedUrl(entry?.postUrl || '')
            if(postUrl) return postUrl
        }
    }

    return ''
}

function getFailedItemProfileResolutionRetryUrl(item = {}, fallbackKey = '') {
    const repairedResolutionUrl = getFailedItemQuestionResolutionUrl(item)
    if(repairedResolutionUrl) return repairedResolutionUrl

    if(!isProfileResolutionItem(item)) return ''
    if(getCoordinatorItemHref(item)) return ''

    return getProfileResolutionRequestedUrl(item, fallbackKey)
}

function buildQueuedCoordinatorProgressResetPatch(item = {}, options = {}) {
    const actionKind = getCoordinatorActionKindForRequestedAction(item?.actionKind || options.actionKind || '')
    const now = Number.parseInt(options.now, 10) || Date.now()

    return {
        replaceProgressRecord: true,
        actionKind,
        runId: item?.runId || options.runId || '',
        attemptId: getAttemptIdFromValue(item),
        attemptNumber: getAttemptNumberFromValue(item),
        status: 'queued',
        queuedAt: now,
        queueIndex: 0,
        retryAttempt: 0,
        maxRetries: Number.parseInt(item?.maxRetries, 10) || STALE_QUEUED_TAB_MAX_RETRIES,
        tabId: null,
        tabCreatedAt: 0,
        tabOpenedAt: 0,
        contentOpenedAt: 0,
        actionReadyAt: 0,
        openedViablePage: false,
        terminalAt: 0,
        slotReleasedAt: 0,
        closeRequestedAt: 0,
        tabClosedAt: 0,
        closedByExtension: false,
        closeReason: '',
        ownerTabId: null,
        ownerWindowId: null,
        waitingForForegroundAt: 0,
        foregroundWaitReason: '',
        foregroundWaitLastEventAt: 0,
        foregroundLeaseAcquiredAt: 0,
        foregroundPromotedAt: 0,
        foregroundPromotionReason: '',
        muteAttempted: false,
        muteSucceeded: false,
        muteAttemptedAt: 0,
        mutedAt: 0,
        muteError: '',
        blockAttempted: false,
        blockSucceeded: false,
        blockAttemptedAt: 0,
        blockedAt: 0,
        blockError: '',
        unblockOk: false,
        unblockSucceeded: false,
        unblockReason: '',
        unmuteOk: false,
        unmuteReason: '',
        foundBlockedBeforeQueue: false,
        profileBlocked: false,
        profileMenuOpen: false,
        selectedActionLabel: '',
        selectedActionRect: null,
        menuActionLabels: [],
        visibleProfileMenuLabels: [],
        finalError: '',
        errorPageUrl: '',
        lastUrl: '',
        unavailableReason: '',
        resolvedProfileHref: '',
        remappedFromRequested: false,
        securityVerification: false,
        event: actionKind === UNBLOCK_UNMUTE_ACTION_KIND
            ? 'Added Unblock Unmute to Current Work'
            : 'Added Mute Block to Current Work'
    }
}

function getStoredSpaceFeedRecordUrls(record, key = 'remainingUrls') {
    if(!record || typeof record !== 'object') return []

    const urls = key && Array.isArray(record[key])
        ? record[key]
        : key === 'remainingUrls'
            ? Array.isArray(record.remainingUrls)
                ? record.remainingUrls
                : Array.isArray(record.allUrls)
                    ? record.allUrls
                    : Array.isArray(record.urls)
                        ? record.urls
                        : []
            : []

    return getNormalizedProfileHrefList(urls)
}

function getPendingSpaceFeedJobKeyPatch(record = {}, remainingUrls = []) {
    const remaining = getNormalizedProfileHrefList(remainingUrls)
    const existingByHref = record?.jobKeysByProfileHref && typeof record.jobKeysByProfileHref === 'object'
        ? record.jobKeysByProfileHref
        : {}
    const jobKeysByProfileHref = {}

    for(const href of remaining) {
        jobKeysByProfileHref[href] = normalizeQuoraProfileUrl(existingByHref[href] || href) || href
    }

    return {
        jobKeys: getNormalizedProfileHrefList(Object.values(jobKeysByProfileHref)),
        jobKeysByProfileHref
    }
}

function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function makeAttemptId() {
    return makeId('attempt')
}

function normalizeAttemptId(value = '') {
    return `${value || ''}`.trim()
}

function getAttemptIdFromValue(value = null) {
    if(!value || typeof value !== 'object') return ''
    return normalizeAttemptId(value.attemptId || value.attempt?.id || '')
}

function getAttemptNumberFromValue(value = null) {
    if(!value || typeof value !== 'object') return 0
    return Number.parseInt(value.attemptNumber ?? value.attempt?.number, 10) || 0
}

function getNextAttemptNumberFromValue(value = null) {
    return Math.max(1, getAttemptNumberFromValue(value) + 1)
}

function normalizeCoordinatorMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeCoordinatorEvents(value) {
    if(Array.isArray(value)) return value.filter(event => event && typeof event === 'object')
    return Object.values(normalizeCoordinatorMap(value)).filter(event => event && typeof event === 'object')
}

function hasMismatchedCoordinatorAttempt(item = null, record = null) {
    if(!isTerminalCoordinatorStatus(item?.status) && isTerminalProfileNukeRecord(record)) {
        const itemQueuedAt = Number.parseInt(item?.queuedAt || item?.createdAt || 0, 10) || 0
        const recordTerminalAt = Number.parseInt(record?.terminalAt || record?.tabClosedAt || record?.updatedAt || 0, 10) || 0
        if(itemQueuedAt && recordTerminalAt && recordTerminalAt < itemQueuedAt) return true
    }

    const expectedAttemptId = getAttemptIdFromValue(item)
    const incomingAttemptId = getAttemptIdFromValue(record)
    if(expectedAttemptId && incomingAttemptId && expectedAttemptId !== incomingAttemptId) return true

    const expectedAttemptNumber = getAttemptNumberFromValue(item)
    const incomingAttemptNumber = getAttemptNumberFromValue(record)
    if(expectedAttemptNumber && incomingAttemptNumber && expectedAttemptNumber !== incomingAttemptNumber) return true

    return !isTerminalCoordinatorStatus(item?.status) &&
        !!expectedAttemptId &&
        !incomingAttemptId &&
        isTerminalProfileNukeRecord(record)
}

function getResolvedDestinationConflict(existingResolvedItem = null, sourceItem = null) {
    if(!existingResolvedItem) return ''
    if(existingResolvedItem.status === 'succeeded') return ''
    if(isTerminalCoordinatorStatus(existingResolvedItem.status)) return 'terminal-resolved-coordinator-item'
    if(hasMismatchedCoordinatorAttempt(existingResolvedItem, sourceItem)) return 'resolved-coordinator-conflict'
    return ''
}

function makeStaleAttemptDiagnosticEvent(details = {}) {
    return {
        id: makeId('event'),
        runId: details.runId || '',
        itemId: details.itemId || '',
        type: 'stale-attempt',
        message: details.message || 'Ignored stale worker attempt',
        at: Date.now(),
        details: {
            profileHref: details.profileHref || '',
            incomingAttemptId: details.incomingAttemptId || '',
            expectedAttemptId: details.expectedAttemptId || '',
            senderTabId: details.senderTabId || null
        }
    }
}

function recordCoordinatorDiagnosticEvent(type = 'coordinator-diagnostic', message = '', details = {}) {
    const event = {
        id: makeId('event'),
        runId: details?.runId || '',
        itemId: details?.itemId || '',
        type: `${type || 'coordinator-diagnostic'}`.trim() || 'coordinator-diagnostic',
        message: `${message || 'Coordinator diagnostic event'}`.slice(0, 500),
        at: Date.now(),
        details: details && typeof details === 'object'
            ? cloneCoordinatorAuthorityValue(details)
            : {}
    }
    incrementQueueWakeupMetric('diagnosticEvent.received')
    if(spaceFeedStorageUpdateDepth > 0 || coordinatorDiagnosticBatchDepth > 0) {
        pendingCoordinatorDiagnosticEvents.push(event)
        recordQueueWakeupMetricMax('diagnosticEvent.pendingMax', pendingCoordinatorDiagnosticEvents.length)
        return true
    }

    void enqueueSpaceFeedStorageUpdate(async () => {
        pendingCoordinatorDiagnosticEvents.push(event)
        recordQueueWakeupMetricMax('diagnosticEvent.pendingMax', pendingCoordinatorDiagnosticEvents.length)
        return flushPendingCoordinatorDiagnosticEvents()
    }, {
        failureValue: false
    })
    return true
}

function drainPendingCoordinatorDiagnosticEvents() {
    const events = pendingCoordinatorDiagnosticEvents
    pendingCoordinatorDiagnosticEvents = []
    return events
}

async function flushPendingCoordinatorDiagnosticEvents() {
    return runQueueWakeupMetricPhase('flushDiagnosticEvents', async () => {
        const pending = drainPendingCoordinatorDiagnosticEvents()
        if(!pending.length) return false

        incrementQueueWakeupMetric('diagnosticEvent.flushPerformed')
        incrementQueueWakeupMetric('diagnosticEvent.eventsPerFlush', pending.length)
        const stored = await metricStorageGet({[COORDINATOR_EVENTS_KEY]: []})
        const events = normalizeCoordinatorEvents(stored[COORDINATOR_EVENTS_KEY])
        await metricStorageSet({
            [COORDINATOR_EVENTS_KEY]: events.concat(pending).slice(-MAX_COORDINATOR_EVENTS)
        }, {
            snapshotWriteReason: 'repair'
        })
        incrementQueueWakeupMetric('diagnosticEvent.storageWrites')
        return true
    })
}

async function recordStaleAttemptDiagnostic(details = {}) {
    const event = makeStaleAttemptDiagnosticEvent(details)
    incrementQueueWakeupMetric('diagnosticEvent.received')
    if(spaceFeedStorageUpdateDepth > 0 || coordinatorDiagnosticBatchDepth > 0) {
        pendingCoordinatorDiagnosticEvents.push(event)
        recordQueueWakeupMetricMax('diagnosticEvent.pendingMax', pendingCoordinatorDiagnosticEvents.length)
        return true
    }

    return enqueueSpaceFeedStorageUpdate(async () => {
        pendingCoordinatorDiagnosticEvents.push(event)
        recordQueueWakeupMetricMax('diagnosticEvent.pendingMax', pendingCoordinatorDiagnosticEvents.length)
        return flushPendingCoordinatorDiagnosticEvents()
    }, {
        failureValue: false
    })
}

function mergeCoordinatorSources(existingSources = [], incomingSources = []) {
    const seen = new Set()
    const merged = []

    for(const source of [...existingSources, ...incomingSources]) {
        if(!source || typeof source !== 'object') continue
        const key = [
            source.type || '',
            source.pageUrl || '',
            source.spaceKey || '',
            source.spaceCategory || ''
        ].join('|')
        if(seen.has(key)) continue
        seen.add(key)
        merged.push({
            type: source.type || '',
            pageUrl: source.pageUrl || '',
            spaceKey: source.spaceKey || '',
            spaceCategory: source.spaceCategory || ''
        })
    }

    return merged
}

function mergeCoordinatorEvidence(existingEvidence = [], incomingEvidence = []) {
    const seen = new Set()
    const merged = []

    for(const evidence of [...existingEvidence, ...incomingEvidence]) {
        if(!evidence || typeof evidence !== 'object') continue
        const key = [
            evidence.postKey || '',
            evidence.postUrl || '',
            evidence.collector || '',
            evidence.sourcePageUrl || ''
        ].join('|')
        if(seen.has(key)) continue
        seen.add(key)
        merged.push({
            postKey: evidence.postKey || '',
            postUrl: evidence.postUrl || '',
            collector: evidence.collector || '',
            confidence: evidence.confidence || '',
            source: evidence.source || '',
            rawSlug: evidence.rawSlug || '',
            resolutionReason: evidence.resolutionReason || '',
            sourcePageUrl: evidence.sourcePageUrl || ''
        })
    }

    return merged
}

function getCoordinatorStatusFromProgress(record = null) {
    const mapped = mapProgressToCoordinatorState(record)
    return {
        status: mapped.status || '',
        outcome: mapped.outcome || '',
        error: mapped.error || ''
    }
}

function progressPatchHasExplicitStatus(patch = {}) {
    return Object.prototype.hasOwnProperty.call(patch || {}, 'status') &&
        `${patch?.status || ''}`.trim() !== ''
}

function shouldApplyExplicitProgressStatusToCoordinatorItem(item = {}, patch = {}, options = {}) {
    if(!progressPatchHasExplicitStatus(patch)) return false

    const status = `${patch?.status || ''}`.trim()
    const senderTabId = normalizeTabId(options.senderTabId)
    if(options.requireActiveSenderTab === true) {
        const itemTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
        return !!senderTabId && isActiveCoordinatorStatus(item?.status || '') && itemTabId === senderTabId
    }

    if(status === 'interrupted' && senderTabId) {
        const itemTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
        return isActiveCoordinatorStatus(item?.status || '') && itemTabId === senderTabId
    }

    return true
}

function getCoordinatorActionKindForProgress(record = null) {
    return record?.actionKind || 'mute-block'
}

function getCoordinatorActionKindForItem(item = null) {
    return item?.actionKind || 'mute-block'
}

function shouldApplyProgressToCoordinatorItem(item = null, record = null) {
    if(!item || !record) return false
    return getCoordinatorActionKindForItem(item) === getCoordinatorActionKindForProgress(record)
}

function isCoordinatorQueueAuthoritativeItem(item = null) {
    return item?.serviceWorkerOwned === true ||
        `${item?.executorOwner || ''}` === 'service-worker'
}

function getCoordinatorMilestonesFromProgress(record = {}) {
    return getJobMilestonesFromProgress(record)
}

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

function getCoordinatorCurrentWorkAnchor(item = {}) {
    return Number.parseInt(item?.terminalAt || item?.updatedAt || item?.createdAt, 10) || 0
}

function hasUnsettledCoordinatorSource(item = null) {
    const settlementKey = getCoordinatorItemSettlementKey(item)
    return !!settlementKey && item?.sourceSettlementKey !== settlementKey
}

function shouldKeepCoordinatorCurrentWorkItem(item = null, now = Date.now()) {
    if(!item || typeof item !== 'object') return false
    if(isPendingCoordinatorStatus(item.status)) return true
    if(isRetryableCoordinatorFailure(item)) return true
    if(!isTerminalCoordinatorStatus(item.status)) return true
    if(hasUnsettledCoordinatorSource(item)) return true

    const anchor = getCoordinatorCurrentWorkAnchor(item)
    return !anchor || now - anchor <= CURRENT_WORK_RETENTION_MS
}

function pruneCoordinatorCurrentWork(queue = {}, now = Date.now()) {
    let changed = false

    for(const [key, item] of Object.entries(queue || {})) {
        if(shouldKeepCoordinatorCurrentWorkItem(item, now)) continue
        delete queue[key]
        changed = true
    }

    return changed
}

function getCoordinatorQueueViewSortRank(item = {}) {
    const status = `${item?.status || ''}`.trim()
    if(isActiveCoordinatorStatus(status)) return 0
    if(status === 'queued') return 1
    if(isRetryableCoordinatorFailure(item)) return 2
    if(status === 'failed') return 3
    if(!isTerminalCoordinatorStatus(status)) return 4
    return 5
}

function getCoordinatorQueueViewTime(item = {}) {
    return Number.parseInt(
        item?.terminalAt ||
        item?.updatedAt ||
        item?.activeAt ||
        item?.queuedAt ||
        item?.createdAt,
        10
    ) || 0
}

function getCoordinatorQueueViewEpochStartedAt() {
    return Number.parseInt(queueWakeupMetrics?.currentEpoch?.startedAt, 10) || 0
}

function isCoordinatorActualBlockSuccess(item = {}) {
    if(`${item?.status || ''}` !== 'succeeded') return false
    if(`${item?.actionKind || ''}` === UNBLOCK_UNMUTE_ACTION_KIND) return false
    if(`${item?.outcome || ''}` === 'blocked') return true

    const milestones = item?.milestones || {}
    return getFirstPositiveNumber(
        item?.blockAttemptedAt,
        milestones.blockAttemptedAt
    ) > 0
}

function getCoordinatorActualBlockTerminalTime(item = {}) {
    return getFirstPositiveNumber(item?.terminalAt, item?.blockedAt, item?.updatedAt, item?.createdAt)
}

function getCoordinatorActualBlockActiveStartTime(item = {}) {
    return Number.parseInt(item?.activeAt, 10) || 0
}

function summarizeCoordinatorActualBlockTiming(queue = {}, epochStartedAt = 0) {
    const minimumTerminalAt = Number.parseInt(epochStartedAt, 10) || 0
    const samples = Object.values(queue || {})
        .filter(item => {
            if(!isCoordinatorActualBlockSuccess(item)) return false
            const terminalAt = getCoordinatorActualBlockTerminalTime(item)
            return terminalAt > 0 && (!minimumTerminalAt || terminalAt >= minimumTerminalAt)
        })
        .sort((left, right) => getCoordinatorActualBlockTerminalTime(right) - getCoordinatorActualBlockTerminalTime(left))
        .slice(0, 100)

    const durations = samples
        .map(item => {
            const startedAt = getCoordinatorActualBlockActiveStartTime(item)
            const terminalAt = getCoordinatorActualBlockTerminalTime(item)
            return startedAt > 0 && terminalAt > startedAt ? terminalAt - startedAt : 0
        })
        .filter(duration => duration > 0)
    const elapsedMs = durations.reduce((total, duration) => total + duration, 0)
    const blocks = durations.length

    return {
        epochStartedAt: minimumTerminalAt,
        sampleLimit: 100,
        blocks,
        elapsedMs,
        seconds: blocks ? (elapsedMs / 1000) / blocks : 0
    }
}

function summarizeCoordinatorQueueViewItem(key = '', item = {}) {
    const source = item && typeof item === 'object' ? item : {}
    return {
        storageKey: key,
        id: source.id || '',
        runId: source.runId || '',
        status: source.status || '',
        outcome: source.outcome || '',
        error: source.error || source.finalError || '',
        actionKind: source.actionKind || '',
        executorTabAction: source.executorTabAction || '',
        targetProfileHref: source.targetProfileHref || '',
        requestedUrl: source.requestedUrl || '',
        dedupeKey: source.dedupeKey || '',
        resolveProfileFromPage: source.resolveProfileFromPage === true,
        resolutionMode: source.resolutionMode || '',
        queuedAt: Number.parseInt(source.queuedAt || source.createdAt, 10) || 0,
        createdAt: Number.parseInt(source.createdAt || source.queuedAt, 10) || 0,
        activeAt: Number.parseInt(source.activeAt, 10) || 0,
        terminalAt: Number.parseInt(source.terminalAt, 10) || 0,
        updatedAt: Number.parseInt(source.updatedAt || source.createdAt || source.queuedAt, 10) || 0,
        retryCount: Number.parseInt(source.retryCount, 10) || 0,
        source: {
            type: source.source?.type || source.sourceType || '',
            pageUrl: source.source?.pageUrl || source.sourcePage || '',
            searchQuery: source.source?.searchQuery || '',
            sourceLabel: source.source?.sourceLabel || source.sourceLabel || ''
        }
    }
}

function buildCoordinatorQueueView(queue = {}, now = Date.now()) {
    const entries = Object.entries(queue || {})
    const epochStartedAt = getCoordinatorQueueViewEpochStartedAt()
    const counts = {}
    const authoritativeCounts = {}
    for(const [, item] of entries) {
        const status = `${item?.status || ''}`.trim() || 'unknown'
        counts[status] = (counts[status] || 0) + 1
        if(isCoordinatorQueueAuthoritativeItem(item)) {
            authoritativeCounts[status] = (authoritativeCounts[status] || 0) + 1
        }
    }
    const hasAuthoritativeStoredWork = ['queued', 'opening', 'active', 'acting', 'settling']
        .some(status => (Number.parseInt(authoritativeCounts[status], 10) || 0) > 0)

    const items = entries
        .sort((left, right) => {
            const leftItem = left[1] || {}
            const rightItem = right[1] || {}
            return getCoordinatorQueueViewSortRank(leftItem) - getCoordinatorQueueViewSortRank(rightItem) ||
                getCoordinatorQueueViewTime(rightItem) - getCoordinatorQueueViewTime(leftItem) ||
                `${left[0]}`.localeCompare(`${right[0]}`)
        })
        .slice(0, MAX_COORDINATOR_QUEUE_VIEW_ITEMS)
        .map(([key, item]) => summarizeCoordinatorQueueViewItem(key, item))

    return {
        version: 1,
        updatedAt: now,
        total: entries.length,
        counts,
        authoritativeCounts,
        hasAuthoritativeStoredWork,
        actualBlockTiming: summarizeCoordinatorActualBlockTiming(queue, epochStartedAt),
        itemLimit: MAX_COORDINATOR_QUEUE_VIEW_ITEMS,
        truncated: entries.length > items.length,
        items
    }
}

function makeCoordinatorQueueAccountingCounts(queue = {}) {
    const counts = {}
    const authoritativeCounts = {}
    for(const item of Object.values(queue || {})) {
        const status = `${item?.status || ''}`.trim() || 'unknown'
        counts[status] = (counts[status] || 0) + 1
        if(isCoordinatorQueueAuthoritativeItem(item)) {
            authoritativeCounts[status] = (authoritativeCounts[status] || 0) + 1
        }
    }

    return {
        total: Object.keys(queue || {}).length,
        counts,
        authoritativeCounts
    }
}

function normalizeCoordinatorQueueViewAccounting(view = null) {
    if(!view || typeof view !== 'object') {
        return {
            present: false,
            total: 0,
            counts: {},
            authoritativeCounts: {},
            itemCount: 0,
            itemLimit: 0,
            truncated: false,
            updatedAt: 0
        }
    }

    const items = Array.isArray(view.items) ? view.items : []
    return {
        present: true,
        total: Number.parseInt(view.total, 10) || items.length,
        counts: normalizeObjectNumberMap(view.counts || {}),
        authoritativeCounts: normalizeObjectNumberMap(view.authoritativeCounts || {}),
        itemCount: items.length,
        itemLimit: Number.parseInt(view.itemLimit, 10) || 0,
        truncated: view.truncated === true,
        updatedAt: Number.parseInt(view.updatedAt, 10) || 0
    }
}

function areCoordinatorAccountingCountsEqual(left = {}, right = {}) {
    const keys = new Set([
        ...Object.keys(left || {}),
        ...Object.keys(right || {})
    ])
    for(const key of keys) {
        if((Number(left?.[key]) || 0) !== (Number(right?.[key]) || 0)) return false
    }
    return true
}

function makeCoordinatorQueueAccountingComparison(source = {}, target = {}, prefix = '') {
    const mismatches = []
    if((Number(source.total) || 0) !== (Number(target.total) || 0)) {
        mismatches.push(`${prefix}total`)
    }
    if(!areCoordinatorAccountingCountsEqual(source.counts, target.counts)) {
        mismatches.push(`${prefix}counts`)
    }
    if(!areCoordinatorAccountingCountsEqual(source.authoritativeCounts, target.authoritativeCounts)) {
        mismatches.push(`${prefix}authoritative-counts`)
    }
    return mismatches
}

function summarizeCoordinatorQueueWalAccounting(walStore = null, recovery = {}) {
    const activeGenerationId = walStore?.meta?.activeCheckpoint || recovery?.wal?.generationId || ''
    const records = activeGenerationId ? getWalRecordsForGeneration(walStore, activeGenerationId) : []
    const checkpoints = walStore && typeof walStore === 'object' && walStore.checkpoints && typeof walStore.checkpoints === 'object'
        ? Object.keys(walStore.checkpoints)
        : []
    const generations = walStore && typeof walStore === 'object' && walStore.wal && typeof walStore.wal === 'object'
        ? Object.keys(walStore.wal)
        : []
    const ignored = Array.isArray(recovery?.wal?.projected?.ignored) ? recovery.wal.projected.ignored : []
    const applied = Array.isArray(recovery?.wal?.projected?.applied) ? recovery.wal.projected.applied : []

    return {
        present: !!walStore,
        recovered: recovery?.recovered === true,
        recoveryReason: recovery?.reason || '',
        activeGenerationId,
        checkpointCount: checkpoints.length,
        generationCount: generations.length,
        activeTailRecords: records.length,
        appliedRecords: applied.length,
        ignoredRecords: ignored.length,
        nextSeq: Number.parseInt(walStore?.meta?.nextSeq, 10) || 0
    }
}

function makeCoordinatorCurrentWorkAccounting(queue = {}) {
    const counts = makeCoordinatorQueueAccountingCounts(queue).counts
    const ready = Number(counts.queued) || 0
    const active = ['opening', 'active', 'acting', 'settling']
        .reduce((total, status) => total + (Number(counts[status]) || 0), 0)
    const succeeded = Number(counts.succeeded) || 0
    const failed = Number(counts.failed) || 0

    return {
        ready,
        active,
        succeeded,
        failed,
        terminal: Object.entries(counts)
            .filter(([status]) => isTerminalCoordinatorStatus(status))
            .reduce((total, [, count]) => total + (Number(count) || 0), 0)
    }
}

async function getCoordinatorQueueAccounting(request = {}) {
    const stored = await metricStorageGet({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_QUEUE_WAL_KEY]: null,
        [COORDINATOR_QUEUE_VIEW_KEY]: null
    }, {metricPath: 'queueAccounting.read'})
    const rawQueue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY] || {})
    const walStore = stored[COORDINATOR_QUEUE_WAL_KEY] || null
    const recovery = recoverCoordinatorQueueFromWal(rawQueue, walStore)
    const recoveredQueue = normalizeCoordinatorMap(recovery.queue || rawQueue)
    const raw = makeCoordinatorQueueAccountingCounts(rawQueue)
    const recovered = makeCoordinatorQueueAccountingCounts(recoveredQueue)
    const storedView = normalizeCoordinatorQueueViewAccounting(stored[COORDINATOR_QUEUE_VIEW_KEY])
    const rebuiltView = normalizeCoordinatorQueueViewAccounting(buildCoordinatorQueueView(recoveredQueue))
    const rawDivergences = makeCoordinatorQueueAccountingComparison(raw, recovered, 'raw-vs-recovered-')
    const viewMismatches = makeCoordinatorQueueAccountingComparison(storedView, rebuiltView, 'stored-view-vs-recovered-')
    const mismatches = []

    if(storedView.present && viewMismatches.length) mismatches.push(...viewMismatches)
    if(walStore && recovery.recovered !== true) mismatches.push('wal-recovery-failed')

    return {
        readOnly: true,
        reason: `${request.reason || ''}`.trim() || 'manual',
        generatedAt: Date.now(),
        consistent: !viewMismatches.length && (!walStore || recovery.recovered === true),
        raw,
        recovered,
        storedView,
        rebuiltView,
        currentWork: makeCoordinatorCurrentWorkAccounting(recoveredQueue),
        wal: summarizeCoordinatorQueueWalAccounting(walStore, recovery),
        rawDivergences,
        mismatches
    }
}

function summarizeCoordinatorContentQueueItem(key = '', item = {}) {
    const source = item && typeof item === 'object' ? item : {}
    const profileHref = getCoordinatorItemHref(source) || normalizeQuoraProfileUrl(key)
    return {
        ...summarizeCoordinatorQueueViewItem(key, source),
        profileHref,
        tabId: Number.isFinite(source.tabId) ? source.tabId : source.tabId || null,
        attemptId: getAttemptIdFromValue(source),
        attemptNumber: getAttemptNumberFromValue(source),
        maxAttempts: Number.parseInt(source.maxAttempts, 10) || 0
    }
}

function shouldIncludeCoordinatorItemInContentQueueIndex(item = null) {
    if(!item || typeof item !== 'object') return false
    return !isTerminalCoordinatorStatus(item.status)
}

function buildCoordinatorContentQueueIndex(queue = {}, now = Date.now()) {
    const entries = Object.entries(queue || {})
        .filter(([, item]) => shouldIncludeCoordinatorItemInContentQueueIndex(item))
        .sort((left, right) => {
            const leftItem = left[1] || {}
            const rightItem = right[1] || {}
            return getCoordinatorQueueViewSortRank(leftItem) - getCoordinatorQueueViewSortRank(rightItem) ||
                getCoordinatorQueueViewTime(rightItem) - getCoordinatorQueueViewTime(leftItem) ||
                `${left[0]}`.localeCompare(`${right[0]}`)
        })
    const items = entries
        .slice(0, MAX_COORDINATOR_CONTENT_QUEUE_INDEX_ITEMS)
        .map(([key, item]) => summarizeCoordinatorContentQueueItem(key, item))

    return {
        version: 2,
        updatedAt: now,
        total: Object.keys(queue || {}).length,
        indexed: entries.length,
        itemLimit: MAX_COORDINATOR_CONTENT_QUEUE_INDEX_ITEMS,
        truncated: entries.length > items.length,
        items
    }
}

function hashCoordinatorContentIndexKey(value = '', bucketCount = COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT) {
    const text = `${value || ''}`.trim()
    if(!text) return -1
    let hash = 0
    for(let index = 0; index < text.length; index += 1) {
        hash = ((hash * 31) + text.charCodeAt(index)) >>> 0
    }
    return hash % bucketCount
}

function getCoordinatorContentSourceIndexShardKeyByIndex(index = 0) {
    const normalized = Math.max(0, Math.min(COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT - 1, Number.parseInt(index, 10) || 0))
    return `${COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX}${normalized.toString(16).padStart(2, '0')}`
}

function getCoordinatorContentSourceIndexShardKey(sourceKey = '') {
    const index = hashCoordinatorContentIndexKey(sourceKey, COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT)
    return index >= 0 ? getCoordinatorContentSourceIndexShardKeyByIndex(index) : ''
}

function getCoordinatorContentSourceKeysFromValues(pageUrl = '', searchQuery = '', sourceType = '') {
    const keys = []
    const normalizedPageUrl = normalizeContentPageStateUrl(pageUrl || '')
    if(normalizedPageUrl) keys.push(`url:${normalizedPageUrl}`)

    const normalizedQuery = `${searchQuery || ''}`.trim().toLowerCase()
    if(normalizedQuery && (!sourceType || `${sourceType || ''}` === 'profile-search')) {
        keys.push(`profile-search:${normalizedQuery}`)
    }

    return Array.from(new Set(keys))
}

function getCoordinatorContentSourceKeysForItem(item = null) {
    const keys = []
    for(const source of getCoordinatorItemStateSources(item)) {
        keys.push(...getCoordinatorContentSourceKeysFromValues(
            source?.pageUrl || source?.sourcePageUrl || '',
            source?.searchQuery || '',
            source?.type || ''
        ))
    }
    return Array.from(new Set(keys))
}

function getCoordinatorContentSourceKeysForRequest(request = {}) {
    return getCoordinatorContentSourceKeysFromValues(
        request.sourcePageUrl || request.url || '',
        request.searchQuery || '',
        'profile-search'
    )
}

function getCoordinatorContentSourceIndexShardDefaults(request = {}) {
    const defaults = {}
    for(const sourceKey of getCoordinatorContentSourceKeysForRequest(request)) {
        const shardKey = getCoordinatorContentSourceIndexShardKey(sourceKey)
        if(shardKey) defaults[shardKey] = {}
    }
    return defaults
}

function buildCoordinatorContentSourceIndexShardPayload(queue = {}, now = Date.now()) {
    const shards = {}
    for(let index = 0; index < COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT; index += 1) {
        shards[getCoordinatorContentSourceIndexShardKeyByIndex(index)] = {
            version: 1,
            updatedAt: now,
            records: {}
        }
    }

    for(const [itemKey, item] of Object.entries(queue || {})) {
        if(!shouldIncludeCoordinatorItemInContentQueueIndex(item)) continue
        const summary = summarizeCoordinatorContentQueueItem(itemKey, item)
        const sourceKeys = getCoordinatorContentSourceKeysForItem(item)
        for(const sourceKey of sourceKeys) {
            const shardKey = getCoordinatorContentSourceIndexShardKey(sourceKey)
            if(!shardKey) continue
            if(!shards[shardKey].records[sourceKey]) {
                shards[shardKey].records[sourceKey] = {
                    items: []
                }
            }
            shards[shardKey].records[sourceKey].items.push(summary)
        }
    }

    return shards
}

function buildCoordinatorQueueDerivedProjectionPayload(queue = {}, now = Date.now()) {
    return {
        [COORDINATOR_QUEUE_VIEW_KEY]: buildCoordinatorQueueView(queue, now),
        [COORDINATOR_CONTENT_QUEUE_INDEX_KEY]: buildCoordinatorContentQueueIndex(queue, now),
        ...buildCoordinatorContentSourceIndexShardPayload(queue, now)
    }
}

function makeCoordinatorQueueWalCheckpoint(queue = {}, options = {}) {
    return makePairedCheckpointStore({queue: normalizeCoordinatorMap(cloneCoordinatorAuthorityValue(queue || {}))}, {
        snapshotSeq: Number.parseInt(options.snapshotSeq, 10) || 0,
        nextSeq: Number.parseInt(options.nextSeq, 10) || 1,
        createdAt: Number.parseInt(options.createdAt, 10) || Date.now()
    })
}

function summarizeProfileNukeProgressRecord(profileHref = '', record = {}) {
    const href = normalizeQuoraProfileUrl(record?.profileHref || profileHref || '')
    if(!href) return null

    const source = record && typeof record === 'object' ? record : {}
    return {
        profileHref: href,
        status: source.status || '',
        actionKind: source.actionKind || '',
        attemptId: getAttemptIdFromValue(source),
        attemptNumber: getAttemptNumberFromValue(source),
        runId: source.runId || '',
        tabId: Number.isFinite(source.tabId) ? source.tabId : source.tabId || null,
        queuedAt: Number.parseInt(source.queuedAt, 10) || 0,
        terminalAt: Number.parseInt(source.terminalAt, 10) || 0,
        updatedAt: Number.parseInt(source.updatedAt, 10) || 0,
        muteSucceeded: source.muteSucceeded === true,
        blockSucceeded: source.blockSucceeded === true,
        unblockSucceeded: source.unblockSucceeded === true,
        unmuteSucceeded: source.unmuteSucceeded === true,
        foundBlockedBeforeQueue: source.foundBlockedBeforeQueue === true,
        finalError: source.finalError || '',
        muteError: source.muteError || '',
        blockError: source.blockError || '',
        unblockReason: source.unblockReason || '',
        unmuteReason: source.unmuteReason || '',
        unavailableReason: source.unavailableReason || '',
        closeReason: source.closeReason || '',
        errorPageUrl: source.errorPageUrl || '',
        securityVerificationUrl: source.securityVerificationUrl || ''
    }
}

function buildProfileNukeProgressView(progress = {}, now = Date.now()) {
    const normalized = normalizeStoredProfileNukeProgress(progress || {})
    const entries = Object.entries(normalized)
        .sort((left, right) => {
            const leftUpdatedAt = Number.parseInt(left[1]?.updatedAt, 10) || 0
            const rightUpdatedAt = Number.parseInt(right[1]?.updatedAt, 10) || 0
            return rightUpdatedAt - leftUpdatedAt || left[0].localeCompare(right[0])
        })
    const records = {}
    for(const [profileHref, record] of entries.slice(0, MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS)) {
        const summary = summarizeProfileNukeProgressRecord(profileHref, record)
        if(summary) records[summary.profileHref] = summary
    }

    return {
        version: 2,
        updatedAt: now,
        total: entries.length,
        recordLimit: MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS,
        truncated: entries.length > Object.keys(records).length,
        records
    }
}

function getProfileNukeProgressShardIndex(profileHref = '') {
    const href = normalizeQuoraProfileUrl(profileHref)
    if(!href) return -1
    let hash = 0
    for(let index = 0; index < href.length; index += 1) {
        hash = ((hash * 31) + href.charCodeAt(index)) >>> 0
    }
    return hash % PROFILE_NUKE_PROGRESS_SHARD_COUNT
}

function getProfileNukeProgressShardKeyByIndex(index = 0) {
    const normalized = Math.max(0, Math.min(PROFILE_NUKE_PROGRESS_SHARD_COUNT - 1, Number.parseInt(index, 10) || 0))
    return `${PROFILE_NUKE_PROGRESS_SHARD_PREFIX}${normalized.toString(16).padStart(2, '0')}`
}

function getProfileNukeProgressShardKey(profileHref = '') {
    const index = getProfileNukeProgressShardIndex(profileHref)
    return index >= 0 ? getProfileNukeProgressShardKeyByIndex(index) : ''
}

function getProfileNukeProgressShardDefaults(profileHrefs = []) {
    const defaults = {}
    for(const href of getNormalizedProfileHrefList(profileHrefs || [])) {
        const key = getProfileNukeProgressShardKey(href)
        if(key) defaults[key] = {}
    }
    return defaults
}

function buildProfileNukeProgressShardPayload(progress = {}, now = Date.now()) {
    const normalized = normalizeStoredProfileNukeProgress(progress || {})
    const shards = {}
    for(let index = 0; index < PROFILE_NUKE_PROGRESS_SHARD_COUNT; index += 1) {
        shards[getProfileNukeProgressShardKeyByIndex(index)] = {
            version: 1,
            updatedAt: now,
            records: {}
        }
    }

    for(const [profileHref, record] of Object.entries(normalized)) {
        const key = getProfileNukeProgressShardKey(profileHref)
        if(!key) continue
        const summary = summarizeProfileNukeProgressRecord(profileHref, record)
        if(summary) shards[key].records[summary.profileHref] = summary
    }

    return shards
}

function updateProfileNukeProgressViewRecords(view = null, progressRecords = {}, now = Date.now()) {
    const current = normalizeProfileNukeProgressView(view)
    const records = {
        ...current.records
    }
    const previousCount = Object.keys(records).length

    for(const [profileHref, record] of Object.entries(progressRecords || {})) {
        const summary = summarizeProfileNukeProgressRecord(profileHref, record)
        if(summary) records[summary.profileHref] = summary
    }

    const recordLimit = Number.parseInt(current.recordLimit, 10) || MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS
    const entries = Object.entries(records)
        .sort((left, right) => {
            const leftUpdatedAt = Number.parseInt(left[1]?.updatedAt, 10) || 0
            const rightUpdatedAt = Number.parseInt(right[1]?.updatedAt, 10) || 0
            return rightUpdatedAt - leftUpdatedAt || left[0].localeCompare(right[0])
        })
    const capped = Object.fromEntries(entries.slice(0, recordLimit))
    const knownTotal = Number.parseInt(current.total, 10) || previousCount
    const total = Math.max(knownTotal, Object.keys(records).length)

    return {
        version: 2,
        updatedAt: now,
        total,
        recordLimit,
        truncated: total > Object.keys(capped).length || entries.length > Object.keys(capped).length,
        records: capped
    }
}

function updateProfileNukeProgressShardRecord(shard = null, profileHref = '', record = null, now = Date.now()) {
    const href = normalizeQuoraProfileUrl(record?.profileHref || profileHref || '')
    const summary = summarizeProfileNukeProgressRecord(href, record)
    const records = normalizeProfileNukeProgressShardRecords({current: shard})
    if(summary) records[summary.profileHref] = summary

    return {
        version: 1,
        updatedAt: now,
        records
    }
}

async function saveProfileNukeProgressRowProjection(progressRecords = {}, options = {}) {
    const normalizedRecords = normalizeStoredProfileNukeProgress(progressRecords || {})
    const hrefs = Object.keys(normalizedRecords)
    if(!hrefs.length) return false

    const shardDefaults = getProfileNukeProgressShardDefaults(hrefs)
    const metricPath = normalizeStorageMetricPathName(options.metricPath || 'rowEvent.progressProjection')
    const stored = await metricStorageGet({
        [PROFILE_NUKE_PROGRESS_VIEW_KEY]: null,
        ...shardDefaults
    }, {metricPath: `${metricPath}.load`})

    const now = Date.now()
    const payload = {
        [PROFILE_NUKE_PROGRESS_VIEW_KEY]: updateProfileNukeProgressViewRecords(
            stored[PROFILE_NUKE_PROGRESS_VIEW_KEY],
            normalizedRecords,
            now
        )
    }

    for(const [profileHref, record] of Object.entries(normalizedRecords)) {
        const shardKey = getProfileNukeProgressShardKey(profileHref)
        if(!shardKey) continue
        payload[shardKey] = updateProfileNukeProgressShardRecord(payload[shardKey] || stored[shardKey], profileHref, record, now)
    }

    let saved = false
    try {
        saved = await metricStorageSet(payload, {metricPath: `${metricPath}.save`})
    }
    catch(error) {
        incrementQueueWakeupMetric('progress.rowProjectionStorageFailed')
        recordCoordinatorDiagnosticEvent(
            'progress-row-projection-storage-failed',
            error?.message || 'Progress row projection storage failed'
        )
        saved = false
    }
    if(saved === false) {
        incrementQueueWakeupMetric('progress.rowProjectionStorageSuppressed')
        return false
    }
    incrementQueueWakeupMetric('progress.rowProjectionStorageWrites')
    incrementQueueWakeupMetric('progress.rowProjectionRowsPerStorageWrite', hrefs.length)
    return {
        saved: true,
        records: cloneCoordinatorAuthorityValue(normalizedRecords),
        rows: hrefs.length
    }
}

function normalizeProfileNukeProgressShardRecords(shards = {}) {
    const records = {}
    for(const shard of Object.values(shards || {})) {
        const shardRecords = shard && typeof shard === 'object' && shard.records && typeof shard.records === 'object'
            ? shard.records
            : {}
        Object.assign(records, normalizeStoredProfileNukeProgress(shardRecords))
    }
    return records
}

function addContentPageStateProjectionPayload(payload = {}) {
    if(!payload || typeof payload !== 'object') return payload
    const next = {
        ...payload
    }
    const now = Date.now()
    if(
        Object.prototype.hasOwnProperty.call(next, COORDINATOR_QUEUE_KEY) &&
        next[COORDINATOR_QUEUE_KEY] &&
        typeof next[COORDINATOR_QUEUE_KEY] === 'object'
    ) {
        const queue = normalizeCoordinatorMap(next[COORDINATOR_QUEUE_KEY])
        if(!Object.prototype.hasOwnProperty.call(next, COORDINATOR_QUEUE_WAL_KEY)) {
            next[COORDINATOR_QUEUE_WAL_KEY] = makeCoordinatorQueueWalCheckpoint(queue, {createdAt: now})
        }
        if(!Object.prototype.hasOwnProperty.call(next, COORDINATOR_QUEUE_VIEW_KEY)) {
            next[COORDINATOR_QUEUE_VIEW_KEY] = buildCoordinatorQueueView(queue, now)
        }
        if(!Object.prototype.hasOwnProperty.call(next, COORDINATOR_CONTENT_QUEUE_INDEX_KEY)) {
            next[COORDINATOR_CONTENT_QUEUE_INDEX_KEY] = buildCoordinatorContentQueueIndex(queue, now)
        }
        if(!Object.keys(next).some(key => `${key || ''}`.startsWith(COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX))) {
            Object.assign(next, buildCoordinatorContentSourceIndexShardPayload(queue, now))
        }
    }
    if(
        Object.prototype.hasOwnProperty.call(next, PROFILE_NUKE_PROGRESS_KEY) &&
        next[PROFILE_NUKE_PROGRESS_KEY] &&
        typeof next[PROFILE_NUKE_PROGRESS_KEY] === 'object'
    ) {
        if(!Object.prototype.hasOwnProperty.call(next, PROFILE_NUKE_PROGRESS_VIEW_KEY)) {
            next[PROFILE_NUKE_PROGRESS_VIEW_KEY] = buildProfileNukeProgressView(next[PROFILE_NUKE_PROGRESS_KEY], now)
        }
        if(!Object.keys(next).some(key => `${key || ''}`.startsWith(PROFILE_NUKE_PROGRESS_SHARD_PREFIX))) {
            Object.assign(next, buildProfileNukeProgressShardPayload(next[PROFILE_NUKE_PROGRESS_KEY], now))
        }
    }
    return next
}

async function refreshCoordinatorQueueViewForDashboard(reason = 'dashboard-refresh') {
    const currentAuthorityState = await loadCoordinatorQueueProjection({
        metricPath: `queueView.${reason}`
    })
    const queue = currentAuthorityState.queue
    const view = buildCoordinatorQueueView(queue)
    await metricStorageSet({
        [COORDINATOR_QUEUE_VIEW_KEY]: view
    }, {metricPath: `queueView.${reason}`})
    return {
        refreshed: true,
        reason,
        total: view.total,
        truncated: view.truncated,
        view
    }
}

function makeEmptyCoordinatorMilestones() {
    return makeEmptyJobMilestones()
}

function shouldResetCoordinatorFailureFromProgress(item = null, record = null, mapped = null) {
    if(!isRetryableCoordinatorFailureFromProgress(item, record)) return false
    if(!mapped || isTerminalCoordinatorStatus(mapped.status)) return false
    if(!isTransientProfileNukeStatus(record?.status)) return false

    const recordRunId = `${record?.runId || ''}`.trim()
    const itemRunId = `${item?.runId || ''}`.trim()
    if(recordRunId && recordRunId !== itemRunId) return true

    const recordUpdatedAt = Number.parseInt(record?.updatedAt, 10) || 0
    const itemTerminalAt = Number.parseInt(item?.terminalAt, 10) || 0
    return recordUpdatedAt > 0 && itemTerminalAt > 0 && recordUpdatedAt >= itemTerminalAt
}

function getCoordinatorRunStatus(runItems = [], existingRun = {}) {
    if(!runItems.length) return existingRun?.paused ? 'paused' : 'complete'

    const terminalCount = runItems.filter(item => isTerminalCoordinatorStatus(item?.status)).length
    if(terminalCount === runItems.length) return 'complete'
    if(existingRun?.paused) return 'paused'
    return 'active'
}

function getCoordinatorRunTargetHrefs(run = {}) {
    return getNormalizedProfileHrefList(run?.targetProfileHrefs || [])
}

function getCoordinatorRunItems(queue = {}, runId = '', existingRun = {}) {
    const targetHrefs = new Set(getCoordinatorRunTargetHrefs(existingRun))

    return Object.entries(queue || {})
        .filter(([itemKey, item]) => {
            if(item?.runId === runId) return true
            if(!targetHrefs.size) return false

            const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            return !!href && targetHrefs.has(href)
        })
        .map(([, item]) => item)
}

function getCoordinatorRunIdsForHref(runs = {}, href = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href)
    if(!normalizedHref) return []

    return Object.values(runs || {})
        .filter(run => getCoordinatorRunTargetHrefs(run).includes(normalizedHref))
        .map(run => run?.id || run?.runId || '')
        .filter(Boolean)
}

function recomputeCoordinatorRuns(queue = {}, runs = {}, runIds = null) {
    return runQueueWakeupMetricPhase('recomputeRuns', () => {
        const nextRuns = {
            ...runs
        }
        const targetRunIds = new Set(runIds || Object.keys(nextRuns))

        for(const item of Object.values(queue || {})) {
            if(item?.runId && (!runIds || targetRunIds.has(item.runId))) {
                targetRunIds.add(item.runId)
            }
        }

        for(const runId of targetRunIds) {
            const existing = nextRuns[runId] || {
                id: runId,
                sourcePages: []
            }
            const runItems = getCoordinatorRunItems(queue, runId, existing)
            const targetHrefs = getCoordinatorRunTargetHrefs(existing)
            const terminalCount = runItems.filter(item => isTerminalCoordinatorStatus(item?.status)).length
            const activeCount = runItems.filter(item => isActiveCoordinatorStatus(item?.status)).length
            const latestItemUpdatedAt = runItems.reduce((latest, item) => {
                const updatedAt = Number.parseInt(item?.updatedAt || item?.terminalAt || item?.createdAt, 10) || 0
                return Math.max(latest, updatedAt)
            }, 0)

            nextRuns[runId] = {
                ...existing,
                id: runId,
                sourceType: existing.sourceType || runItems[0]?.source?.type || 'space-feed',
                createdAt: existing.createdAt || runItems[0]?.createdAt || Date.now(),
                targetProfileHrefs: targetHrefs,
                itemCount: targetHrefs.length || runItems.length || Number.parseInt(existing.itemCount, 10) || 0,
                activeCount,
                terminalCount,
                status: getCoordinatorRunStatus(runItems, existing),
                updatedAt: Math.max(Number.parseInt(existing.updatedAt, 10) || 0, latestItemUpdatedAt)
            }
        }

        return nextRuns
    })
}

function getCoordinatorTransitionTerminalAt(item = {}, record = {}, now = Date.now(), options = {}) {
    if(options.terminalAtFallback === 'record') {
        return Number.parseInt(record.terminalAt || record.tabClosedAt || record.updatedAt, 10) || item.terminalAt || now
    }

    return Number.isFinite(record.terminalAt) && record.terminalAt > 0 ? record.terminalAt : now
}

function getCoordinatorProgressReducerEventType(item = {}, mapped = {}, options = {}) {
    const status = `${mapped.status || ''}`.trim()
    if(isTerminalCoordinatorStatus(status)) return JOB_EVENT_TERMINAL
    if(status === 'queued') return options.resetRetry === true ? JOB_EVENT_RETRY : JOB_EVENT_ENQUEUED
    if(status === 'opening') return JOB_EVENT_TAB_OPENED
    return JOB_EVENT_MILESTONE
}

function buildLegacyCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {}) {
    const now = Number.parseInt(options.now, 10) || Date.now()
    const resetRetry = options.resetRetry === true
    const mappedTerminal = isTerminalCoordinatorStatus(mapped.status)

    return {
        ...item,
        runId: resetRetry ? record.runId || item.runId : item.runId,
        status: mapped.status,
        outcome: mappedTerminal ? mapped.outcome || item.outcome || '' : '',
        error: mappedTerminal ? mapped.error || '' : '',
        updatedAt: Math.max(Number.parseInt(item.updatedAt, 10) || 0, Number.parseInt(record.updatedAt, 10) || 0, now),
        queuedAt: resetRetry && mapped.status === 'queued'
            ? Number.parseInt(record.queuedAt, 10) || now
            : item.queuedAt || 0,
        activeAt: mapped.status === 'active'
            ? (options.refreshActiveAt === true
                ? Number.parseInt(record.tabOpenedAt || record.contentOpenedAt, 10) || now
                : item.activeAt || Number.parseInt(record.tabOpenedAt || record.contentOpenedAt, 10) || now)
            : resetRetry ? 0 : item.activeAt || 0,
        terminalAt: mappedTerminal
            ? getCoordinatorTransitionTerminalAt(item, record, now, options)
            : 0,
        actionLease: mappedTerminal || resetRetry ? null : item.actionLease || null,
        actionLeaseReleasedAt: mappedTerminal
            ? now
            : resetRetry ? 0 : item.actionLeaseReleasedAt || 0,
        actionLeaseReleaseReason: mappedTerminal
            ? 'terminal-progress'
            : resetRetry ? '' : item.actionLeaseReleaseReason || '',
        tabId: resetRetry ? null : (mapped.status === 'active' ? getPersistedQueuedTabId(item, record) : item.tabId || null),
        attempt: resetRetry ? 0 : Number.parseInt(record.retryAttempt, 10) || item.attempt || 0,
        attemptId: resetRetry ? '' : getAttemptIdFromValue(record) || getAttemptIdFromValue(item),
        attemptNumber: resetRetry ? 0 : getAttemptNumberFromValue(record) || getAttemptNumberFromValue(item),
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

function mergeReducedCoordinatorProgressItem(item = {}, reducedItem = {}, legacyItem = {}, mapped = {}, record = {}, options = {}) {
    const status = `${mapped.status || ''}`.trim()
    const resetRetry = options.resetRetry === true
    const mappedTerminal = isTerminalCoordinatorStatus(status)

    return {
        ...legacyItem,
        status: reducedItem.status,
        outcome: mappedTerminal ? reducedItem.outcome || legacyItem.outcome || '' : '',
        error: mappedTerminal ? reducedItem.error || legacyItem.error || '' : '',
        updatedAt: Math.max(
            Number.parseInt(reducedItem.updatedAt, 10) || 0,
            Number.parseInt(legacyItem.updatedAt, 10) || 0
        ),
        queuedAt: status === 'queued' ? reducedItem.queuedAt || legacyItem.queuedAt || 0 : legacyItem.queuedAt || 0,
        activeAt: status === 'active' || status === 'acting' || status === 'settling'
            ? legacyItem.activeAt || reducedItem.activeAt || 0
            : resetRetry ? 0 : legacyItem.activeAt || reducedItem.activeAt || 0,
        terminalAt: mappedTerminal ? reducedItem.terminalAt || legacyItem.terminalAt || 0 : 0,
        tabId: mappedTerminal || resetRetry ? null : legacyItem.tabId ?? reducedItem.tabId ?? null,
        actionLease: mappedTerminal || resetRetry ? null : reducedItem.actionLease || legacyItem.actionLease || null,
        actionLeaseReleasedAt: mappedTerminal
            ? reducedItem.actionLeaseReleasedAt || legacyItem.actionLeaseReleasedAt || 0
            : resetRetry ? 0 : reducedItem.actionLeaseReleasedAt || legacyItem.actionLeaseReleasedAt || 0,
        actionLeaseReleaseReason: mappedTerminal || resetRetry
            ? reducedItem.actionLeaseReleaseReason || legacyItem.actionLeaseReleaseReason || ''
            : legacyItem.actionLeaseReleaseReason || '',
        attemptId: resetRetry ? legacyItem.attemptId || '' : reducedItem.attemptId || legacyItem.attemptId || '',
        attemptNumber: resetRetry ? legacyItem.attemptNumber || 0 : reducedItem.attemptNumber || legacyItem.attemptNumber || 0,
        milestones: {
            ...makeEmptyCoordinatorMilestones(),
            ...(item.milestones || {}),
            ...(reducedItem.milestones || {}),
            ...getCoordinatorMilestonesFromProgress(record)
        }
    }
}

function transitionCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {}) {
    const now = Number.parseInt(options.now, 10) || Date.now()
    const resetRetry = options.resetRetry === true
    const legacyItem = buildLegacyCoordinatorItemFromProgress(item, record, mapped, {
        ...options,
        now
    })
    const reducerEventBase = {
        type: getCoordinatorProgressReducerEventType(item, mapped, options),
        status: mapped.status,
        outcome: mapped.outcome || '',
        error: mapped.error || '',
        at: now,
        terminalAt: isTerminalCoordinatorStatus(mapped.status)
            ? getCoordinatorTransitionTerminalAt(item, record, now, options)
            : 0,
        tabId: getPersistedQueuedTabId(item, record) || null,
        attemptId: getAttemptIdFromValue(record) || getAttemptIdFromValue(item),
        attemptNumber: getAttemptNumberFromValue(record) || getAttemptNumberFromValue(item),
        reason: isTerminalCoordinatorStatus(mapped.status) ? 'terminal-progress' : '',
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
        if(!retryResult.accepted) return legacyItem
        reducerItem = retryResult.item
    }

    const reduced = reduceJobEvent(reducerItem, reducerEventBase)
    if(!reduced.accepted) {
        if(shouldPreferSuccessfulProgressOverTerminalCoordinatorItem(item, record, mapped)) {
            return promoteTerminalCoordinatorItemFromSuccessfulProgress(item, record, mapped, {
                ...options,
                now
            })
        }
        return resetRetry ? legacyItem : item
    }

    return mergeReducedCoordinatorProgressItem(item, reduced.item, legacyItem, mapped, record, {
        ...options,
        now
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

function makeTerminalProgressRecordFromCoordinatorItem(href = '', item = {}, previous = {}, reason = '') {
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
        terminalAt: Number.parseInt(item.terminalAt || previousRecord.terminalAt, 10) || Date.now(),
        finalError: item.error || previousRecord.finalError || '',
        event: reason || 'Restored terminal profile progress from coordinator row'
    }

    if(item.status === 'succeeded' && actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
        Object.assign(patch, {
            status: outcome === 'already-unblocked' ? 'already-unblocked' : 'unblocked',
            unblockSucceeded: true,
            unblockedAt: Number.parseInt(item.terminalAt || previousRecord.unblockedAt, 10) || Date.now(),
            finalError: ''
        })
    }
    else if(item.status === 'succeeded') {
        Object.assign(patch, {
            status: outcome === 'blocked' ? 'blocked' : 'already-blocked',
            blockSucceeded: true,
            foundBlockedBeforeQueue: outcome !== 'blocked',
            blockedAt: Number.parseInt(item.terminalAt || previousRecord.blockedAt, 10) || Date.now(),
            finalError: ''
        })
    }
    else if(item.status === 'skipped') {
        Object.assign(patch, {
            status: 'profile-unavailable',
            unavailableReason: item.error || previousRecord.unavailableReason || 'Profile unavailable'
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

    const effectiveMapped = mapped || getCoordinatorStatusFromProgress(record)
    if(effectiveMapped.status !== 'succeeded') return false
    if(!isSuccessfulProfileNukeRecord(record)) return false
    if(!shouldApplyProgressToCoordinatorItem(item, record)) return false
    if(hasMismatchedCoordinatorAttempt(item, record)) return false

    return true
}

function promoteTerminalCoordinatorItemFromSuccessfulProgress(item = {}, record = {}, mapped = {}, options = {}) {
    const now = Number.parseInt(options.now, 10) || Date.now()
    const terminalAt = getCoordinatorTransitionTerminalAt(item, record, now, options)
    const nextItem = buildLegacyCoordinatorItemFromProgress(item, record, mapped, {
        ...options,
        now
    })

    return {
        ...nextItem,
        status: 'succeeded',
        outcome: mapped.outcome || nextItem.outcome || 'blocked',
        error: '',
        updatedAt: Math.max(Number.parseInt(nextItem.updatedAt, 10) || 0, now),
        terminalAt,
        tabId: null,
        actionLease: null,
        actionLeaseReleasedAt: now,
        actionLeaseReleaseReason: 'terminal-success-repair',
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

async function loadCoordinatorState(defaults = {}) {
    return runQueueWakeupMetricPhase('loadCoordinatorState', async () => {
        const stored = await metricStorageGet({
            [COORDINATOR_QUEUE_KEY]: {},
            [COORDINATOR_QUEUE_WAL_KEY]: null,
            [COORDINATOR_RUNS_KEY]: {},
            [COORDINATOR_EVENTS_KEY]: [],
            [PROFILE_NUKE_PROGRESS_KEY]: {},
            ...defaults
        })
        const queueSnapshot = runQueueWakeupMetricPhase('normalizeQueue', () => normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY]))
        const queueRecovery = runQueueWakeupMetricPhase('recoverQueueWal', () => recoverCoordinatorQueueFromWal(
            queueSnapshot,
            stored[COORDINATOR_QUEUE_WAL_KEY]
        ))
        const queue = queueRecovery.queue
        const runs = runQueueWakeupMetricPhase('normalizeRuns', () => normalizeCoordinatorMap(stored[COORDINATOR_RUNS_KEY]))
        const events = runQueueWakeupMetricPhase('normalizeEvents', () => normalizeCoordinatorEvents(stored[COORDINATOR_EVENTS_KEY]))
        const progress = runQueueWakeupMetricPhase('normalizeProgress', () => normalizeStoredProfileNukeProgress(stored[PROFILE_NUKE_PROGRESS_KEY] || {}))
        recordActiveStorageWorkSnapshot(queue)

        return {
            stored,
            queue,
            runs,
            events,
            progress
        }
    })
}

async function loadCoordinatorCurrentAuthorityState(defaults = {}) {
    return loadCoordinatorState(defaults)
}

function cloneCoordinatorAuthorityValue(value) {
    if(value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

function makeCoordinatorAuthorityProjection(state = {}) {
    return {
        stored: cloneCoordinatorAuthorityValue(state.stored || {}),
        queue: normalizeCoordinatorMap(cloneCoordinatorAuthorityValue(state.queue || {})),
        runs: normalizeCoordinatorMap(cloneCoordinatorAuthorityValue(state.runs || {})),
        events: normalizeCoordinatorEvents(cloneCoordinatorAuthorityValue(state.events || [])),
        progress: normalizeStoredProfileNukeProgress(cloneCoordinatorAuthorityValue(state.progress || {}))
    }
}

function normalizeCoordinatorAuthorityRowKey(value = '') {
    const raw = `${value || ''}`.trim()
    if(!raw) return ''
    return normalizeQuoraProfileUrl(raw) || raw
}

function makeCoordinatorAuthorityPersistenceResult(overrides = {}) {
    return {
        backend: 'snapshot',
        saved: false,
        storageTimedOut: false,
        fallbackReturned: false,
        ...overrides
    }
}

function makeCoordinatorAuthorityApplyResult(operation = {}, overrides = {}) {
    const operationKind = normalizeQueueWriteOperationName(operation.operationKind || operation.kind || 'unclassified')
    const rowKey = normalizeCoordinatorAuthorityRowKey(operation.rowKey || operation.coordinatorKey || operation.profileHref || '')
    const accepted = overrides.accepted === true
    const changed = overrides.changed === true
    const durable = overrides.durable === true
    const reason = `${overrides.reason || operation.reason || ''}`.trim() || 'unclassified'
    const previousRow = cloneCoordinatorAuthorityValue(overrides.previousRow || null)
    const nextRow = cloneCoordinatorAuthorityValue(overrides.nextRow || null)
    const staleAttempt = overrides.staleAttempt === true
    const terminal = overrides.terminal === true
    const operationRecord = {
        operationKind,
        rowKey,
        reason,
        accepted,
        changed,
        durable,
        previousRow,
        nextRow,
        staleAttempt,
        terminal
    }

    return {
        operationKind,
        rowKey,
        reason,
        accepted,
        changed,
        durable,
        previousRow,
        nextRow,
        staleAttempt,
        terminal,
        operation: operationRecord,
        persistence: makeCoordinatorAuthorityPersistenceResult(overrides.persistence || {})
    }
}

function makeCoordinatorProgressOperationRecord(operation = {}, overrides = {}) {
    const operationKind = getCoordinatorRowEventMetricKind(
        operation.operationKind || operation.eventKind || COORDINATOR_ROW_EVENT_QUEUED_PROGRESS_MILESTONE
    )
    const rowKey = normalizeCoordinatorAuthorityRowKey(operation.rowKey || operation.profileHref || operation.href || '')
    const accepted = overrides.accepted === true
    const changed = overrides.changed === true
    const durable = overrides.durable === true
    const reason = `${overrides.reason || operation.reason || ''}`.trim() || 'unclassified'
    const previousRecord = cloneCoordinatorAuthorityValue(overrides.previousRecord || null)
    const nextRecord = cloneCoordinatorAuthorityValue(overrides.nextRecord || null)
    const staleAttempt = overrides.staleAttempt === true
    const terminal = overrides.terminal === true || isTerminalProfileNukeRecord(nextRecord)

    return {
        operationKind,
        area: 'progress',
        rowKey,
        reason,
        accepted,
        changed,
        durable,
        previousRecord,
        nextRecord,
        staleAttempt,
        terminal
    }
}

function makeCoordinatorAuthorityShadowWalRecord(result = {}) {
    if(!result?.accepted || !result?.changed || !result?.rowKey || !result?.nextRow) return null

    const nextRow = cloneCoordinatorAuthorityValue(result.nextRow)
    const attemptId = getAttemptIdFromValue(nextRow)
    const attemptNumber = getAttemptNumberFromValue(nextRow)
    const runId = `${nextRow?.runId || ''}`.trim()
    const status = `${nextRow?.status || ''}`.trim()
    const at = Number.parseInt(nextRow?.updatedAt || nextRow?.terminalAt, 10) || Date.now()

    return {
        kind: 'map.set',
        area: 'queue',
        key: result.rowKey,
        dedupeKey: [
            'queue',
            result.operationKind || 'authority-row-mutation',
            result.rowKey,
            attemptId,
            attemptNumber || '',
            status
        ].filter(value => value !== '').join(':'),
        operationKind: result.operationKind || 'authority-row-mutation',
        reason: result.reason || '',
        value: nextRow,
        runId,
        attemptId,
        attemptNumber,
        status,
        terminal: result.terminal === true || isTerminalCoordinatorStatus(nextRow?.status),
        at,
        seq: 1
    }
}

function shouldUseCoordinatorQueueWalBackend(operationKind = '', reason = 'ordinaryMutation') {
    return normalizeSnapshotWriteReason(reason || 'ordinaryMutation') === 'ordinaryMutation' &&
        COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS.has(normalizeQueueWriteOperationName(operationKind || ''))
}

function normalizeCoordinatorQueueWalStore(value = null, snapshotQueue = {}) {
    if(value && typeof value === 'object' && value.meta && value.checkpoints && value.wal) {
        return cloneCoordinatorAuthorityValue(value)
    }
    return makeCoordinatorQueueWalCheckpoint(snapshotQueue)
}

function recoverCoordinatorQueueFromWal(snapshotQueue = {}, walStore = null, options = {}) {
    const normalizedSnapshot = normalizeCoordinatorMap(cloneCoordinatorAuthorityValue(snapshotQueue || {}))
    if(!walStore || typeof walStore !== 'object') {
        return {
            queue: normalizedSnapshot,
            recovered: false,
            reason: 'missing-wal'
        }
    }

    try {
        const recovered = recoverProjectedState(walStore)
        const generationId = recovered?.generationId || walStore?.meta?.activeCheckpoint
        const records = getWalRecordsForGeneration(walStore, generationId)
        const replayBytes = getJsonByteSize(records)
        const appliedCount = recovered?.projected?.applied?.length || 0
        const ignored = recovered?.projected?.ignored || []
        const ignoredCheckpointCount = ignored.filter(entry => entry?.reason === 'already-in-snapshot').length
        const checkpointCreatedAt = Number.parseInt(recovered?.checkpoint?.createdAt, 10) || 0
        if(records.length) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.replayRecords', records.length)
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.replayBytes', replayBytes)
            recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxReplayRecords', records.length)
            recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxReplayBytes', replayBytes)
        }
        if(appliedCount) incrementQueueWakeupMetric('coordinatorAuthority.queueWal.replayApplied', appliedCount)
        if(ignored.length) incrementQueueWakeupMetric('coordinatorAuthority.queueWal.replayIgnored', ignored.length)
        if(ignoredCheckpointCount) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.replayIgnoredCheckpoint', ignoredCheckpointCount)
        }
        if(checkpointCreatedAt) {
            recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxCheckpointAgeMs', Math.max(0, Date.now() - checkpointCreatedAt))
        }
        recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxTailLength', records.length)
        const queue = normalizeCoordinatorMap(recovered?.projected?.state?.queue || recovered?.state?.queue || {})
        if(recovered?.recovered === true) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.recovered')
            return {
                queue,
                recovered: true,
                reason: '',
                wal: recovered
            }
        }
        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.recoveryFailed')
        recordCoordinatorDiagnosticEvent(
            'coordinator-authority-queue-wal-recovery-failed',
            recovered?.reason || 'Coordinator authority queue WAL recovery failed'
        )
        return {
            queue: normalizedSnapshot,
            recovered: false,
            reason: recovered?.reason || 'recovery-failed',
            wal: recovered
        }
    }
    catch(error) {
        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.recoveryFailed')
        recordCoordinatorDiagnosticEvent(
            'coordinator-authority-queue-wal-recovery-failed',
            error?.message || 'Coordinator authority queue WAL recovery threw'
        )
        return {
            queue: normalizedSnapshot,
            recovered: false,
            reason: 'recovery-error',
            error: `${error?.message || error || 'recovery error'}`.slice(0, 240)
        }
    }
}

async function persistCoordinatorAuthorityQueueWalMutation(result = {}, nextProjection = {}, options = {}) {
    const record = makeCoordinatorAuthorityShadowWalRecord({
        ...result,
        durable: true
    })
    if(!record) {
        return {
            saved: false,
            backend: 'queue-wal',
            reason: 'not-row-mutation'
        }
    }

    const storedWal = normalizeCoordinatorQueueWalStore(
        nextProjection?.stored?.[COORDINATOR_QUEUE_WAL_KEY],
        result.previousProjectionQueue || {}
    )
    const appendRecord = cloneCoordinatorAuthorityValue(record)
    delete appendRecord.id
    delete appendRecord.seq
    const append = appendWalRecordsToGeneration(storedWal, [appendRecord], {
        segmentId: `queue-authority-${record.operationKind || 'row-mutation'}-${Date.now()}`
    })
    if(append?.rejected) {
        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.appendRejected')
        recordCoordinatorDiagnosticEvent(
            'coordinator-authority-queue-wal-append-rejected',
            append.reason || 'Coordinator authority queue WAL append was rejected'
        )
        return {
            saved: false,
            backend: 'queue-wal',
            reason: append.reason || 'append-rejected'
        }
    }

    const walSaved = await metricStorageSet({
        [COORDINATOR_QUEUE_WAL_KEY]: append.store
    }, {
        metricPath: options.metricPath || `authority.${result.operationKind || 'row-mutation'}.queueWal.save`,
        queueOperation: result.operationKind || 'authority-row-mutation',
        queueChangedRows: 1,
        coordinatorAuthorityWrite: true
    })
    if(walSaved === false) {
        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.appendSuppressed')
        return {
            saved: false,
            backend: 'queue-wal',
            reason: 'wal-storage-suppressed',
            append
        }
    }

    incrementQueueWakeupMetric('coordinatorAuthority.queueWal.appended')
    incrementQueueWakeupMetric('coordinatorAuthority.queueWal.appendBytes', getJsonByteSize(append.records || []))
    recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxAppendBytes', getJsonByteSize(append.records || []))

    let projectionSaved = true
    try {
        const projectionPayload = buildCoordinatorQueueDerivedProjectionPayload(nextProjection.queue || {})
        const saved = await metricStorageSet(projectionPayload, {
            metricPath: options.projectionMetricPath || `authority.${result.operationKind || 'row-mutation'}.projection.save`,
            queueOperation: `${result.operationKind || 'authority-row-mutation'}-projection`,
            queueChangedRows: 1,
            coordinatorAuthorityWrite: true
        })
        projectionSaved = saved !== false
    }
    catch(error) {
        projectionSaved = false
        recordCoordinatorDiagnosticEvent(
            'coordinator-authority-queue-wal-projection-failed',
            error?.message || 'Coordinator authority queue WAL projection update failed'
        )
    }
    if(!projectionSaved) {
        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.projectionFailed')
        scheduleStoredWorkRepair(1000, {
            reason: 'queue-wal-projection-failed',
            edgeTriggered: true
        })
    }
    else {
        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.projectionSaved')
    }

    return {
        saved: true,
        backend: 'queue-wal',
        append,
        projectionSaved,
        snapshotSaved: false,
        walSaved: true
    }
}

async function switchCoordinatorAuthorityQueueWalCheckpoint(options = {}) {
    const failureResult = {
        checkpointSwitched: false,
        saved: false,
        durable: false,
        reason: 'storage-update-fallback'
    }

    return enqueueSpaceFeedStorageUpdate(async () => {
        const stored = await metricStorageGet({
            [COORDINATOR_QUEUE_KEY]: {},
            [COORDINATOR_QUEUE_WAL_KEY]: null
        }, {
            metricPath: options.metricPath || 'queueWal.checkpointSwitch.load'
        })
        const snapshotQueue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY] || {})
        const storedWal = normalizeCoordinatorQueueWalStore(stored[COORDINATOR_QUEUE_WAL_KEY], snapshotQueue)
        const recovered = recoverProjectedState(storedWal)
        if(recovered?.recovered !== true) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointFailed')
            recordCoordinatorDiagnosticEvent(
                'coordinator-authority-queue-wal-checkpoint-recovery-failed',
                recovered?.reason || 'Coordinator authority queue WAL checkpoint recovery failed'
            )
            return {
                checkpointSwitched: false,
                saved: false,
                durable: false,
                reason: recovered?.reason || 'recovery-failed'
            }
        }

        const recoveredQueue = normalizeCoordinatorMap(recovered?.projected?.state?.queue || {})
        const activeGenerationId = storedWal?.meta?.activeCheckpoint
        const activeRecords = getWalRecordsForGeneration(storedWal, activeGenerationId)
        const maxAppliedSeq = Number.parseInt(recovered?.projected?.maxSeq, 10) ||
            Number.parseInt(recovered?.checkpoint?.snapshotSeq, 10) ||
            0
        const checkpointedRecords = activeRecords.filter(record => (Number.parseInt(record?.seq, 10) || 0) <= maxAppliedSeq).length
        const prepared = writeInactiveCheckpoint(storedWal, {queue: recoveredQueue}, {
            snapshotSeq: maxAppliedSeq,
            createdAt: Date.now()
        })
        const activated = activateCheckpoint(prepared.store, prepared.checkpointId)
        if(activated?.activated !== true) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointFailed')
            recordCoordinatorDiagnosticEvent(
                'coordinator-authority-queue-wal-checkpoint-activation-failed',
                activated?.reason || 'Coordinator authority queue WAL checkpoint activation failed'
            )
            return {
                checkpointSwitched: false,
                saved: false,
                durable: false,
                reason: activated?.reason || 'activation-failed',
                snapshotSeq: maxAppliedSeq,
                checkpointedRecords
            }
        }

        const verify = recoverProjectedState(activated.store)
        if(verify?.recovered !== true) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointFailed')
            recordCoordinatorDiagnosticEvent(
                'coordinator-authority-queue-wal-checkpoint-verify-failed',
                verify?.reason || 'Coordinator authority queue WAL checkpoint verification failed'
            )
            return {
                checkpointSwitched: false,
                saved: false,
                durable: false,
                reason: verify?.reason || 'verification-failed',
                snapshotSeq: maxAppliedSeq,
                checkpointedRecords
            }
        }

        let walSaved = false
        try {
            walSaved = await metricStorageSet({
                [COORDINATOR_QUEUE_WAL_KEY]: activated.store
            }, {
                metricPath: options.saveMetricPath || 'queueWal.checkpointSwitch.save',
                queueOperation: 'queue-wal-checkpoint-switch',
                queueChangedRows: Object.keys(recoveredQueue).length,
                coordinatorAuthorityWrite: true
            })
        }
        catch(error) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointFailed')
            recordCoordinatorDiagnosticEvent(
                'coordinator-authority-queue-wal-checkpoint-save-failed',
                error?.message || 'Coordinator authority queue WAL checkpoint save failed'
            )
            return {
                checkpointSwitched: false,
                saved: false,
                durable: false,
                reason: 'wal-checkpoint-save-failed',
                snapshotSeq: maxAppliedSeq,
                checkpointedRecords,
                error: `${error?.message || error || 'storage error'}`.slice(0, 240)
            }
        }
        if(walSaved === false) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointSuppressed')
            return {
                checkpointSwitched: false,
                saved: false,
                durable: false,
                reason: 'wal-checkpoint-storage-suppressed',
                snapshotSeq: maxAppliedSeq,
                checkpointedRecords
            }
        }

        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointed')
        incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointedRecords', checkpointedRecords)
        recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxCheckpointSeq', maxAppliedSeq)
        recordQueueWakeupMetricMax(
            'coordinatorAuthority.queueWal.maxPostCheckpointTailLength',
            getWalRecordsForGeneration(activated.store, activated.store?.meta?.activeCheckpoint).length
        )

        let mirrorSaved = false
        try {
            const mirrorPayload = {
                [COORDINATOR_QUEUE_KEY]: recoveredQueue,
                [COORDINATOR_QUEUE_WAL_KEY]: activated.store,
                ...buildCoordinatorQueueDerivedProjectionPayload(recoveredQueue)
            }
            mirrorSaved = await metricStorageSet(mirrorPayload, {
                metricPath: options.mirrorMetricPath || 'queueWal.checkpointSwitch.compatMirror.save',
                snapshotWriteReason: 'checkpointSwitch',
                queueOperation: 'queue-wal-checkpoint-switch-mirror',
                queueChangedRows: Object.keys(recoveredQueue).length,
                coordinatorAuthorityWrite: true
            })
        }
        catch(error) {
            mirrorSaved = false
            recordCoordinatorDiagnosticEvent(
                'coordinator-authority-queue-wal-compat-mirror-failed',
                error?.message || 'Coordinator authority queue WAL compatibility mirror save failed'
            )
        }
        if(mirrorSaved === false) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.compatMirrorFailed')
            scheduleStoredWorkRepair(1000, {
                reason: 'queue-wal-compat-mirror-failed',
                edgeTriggered: true
            })
        }
        else {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.compatMirrorSaved')
        }

        return {
            checkpointSwitched: true,
            saved: true,
            durable: true,
            reason: 'checkpointed',
            snapshotSeq: maxAppliedSeq,
            checkpointedRecords,
            tailLength: getWalRecordsForGeneration(activated.store, activated.store?.meta?.activeCheckpoint).length,
            walStore: activated.store,
            mirrorSaved: mirrorSaved !== false,
            queue: recoveredQueue
        }
    }, {
        reason: 'coordinator-authority.queueWal.checkpointSwitch',
        timeoutMs: options.timeoutMs,
        failureValue: failureResult
    })
}

function getCoordinatorAuthorityShadowWalRetainedRecordCount() {
    return getWalRecordsForGeneration(
        coordinatorAuthorityShadowWalStore,
        coordinatorAuthorityShadowWalStore?.meta?.activeCheckpoint
    ).length
}

function switchCoordinatorAuthorityShadowWalCheckpoint(reason = 'retention-limit') {
    const snapshotSeq = Math.max(
        Number.parseInt(coordinatorAuthorityShadowWalProjectionMaxSeq, 10) || 0,
        Number.parseInt(coordinatorAuthorityShadowWalStore?.meta?.snapshotSeq, 10) || 0
    )
    const nextSeq = Math.max(
        Number.parseInt(coordinatorAuthorityShadowWalStore?.meta?.nextSeq, 10) || 0,
        snapshotSeq + 1
    )
    coordinatorAuthorityShadowWalStore = makePairedCheckpointStore(
        cloneCoordinatorAuthorityValue(coordinatorAuthorityShadowWalProjectedState || {queue: {}}),
        {
            snapshotSeq,
            nextSeq,
            createdAt: Date.now()
        }
    )
    coordinatorAuthorityShadowWalProjectionSnapshotSeq = snapshotSeq
    coordinatorAuthorityShadowWalAppliedIds = new Set()
    incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.checkpointSwitched')
    recordQueueWakeupMetricMax('coordinatorAuthority.shadowWal.maxCheckpointSeq', snapshotSeq)

    return {
        checkpointSwitched: true,
        reason,
        snapshotSeq,
        retainedRecords: getCoordinatorAuthorityShadowWalRetainedRecordCount()
    }
}

function appendCoordinatorAuthorityShadowWalRecords(records = [], options = {}) {
    const normalizedRecords = (Array.isArray(records) ? records : [records])
        .filter(record => record && typeof record === 'object')
        .map(record => {
            const next = cloneCoordinatorAuthorityValue(record)
            delete next.id
            delete next.seq
            return next
        })
    if(!normalizedRecords.length) {
        return {appended: false, records: [], reason: 'no-records'}
    }

    const segmentId = `${options.segmentId || `coordinator-authority-shadow-${Date.now()}`}`
    const append = appendWalRecordsToGeneration(coordinatorAuthorityShadowWalStore, normalizedRecords, {
        segmentId
    })
    if(append?.rejected) {
        incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.appendRejected')
        recordCoordinatorDiagnosticEvent(
            'coordinator-authority-shadow-wal-append-rejected',
            append.reason || 'Coordinator authority shadow WAL append was rejected'
        )
        return {
            appended: false,
            records: [],
            reason: append.reason || 'append-rejected'
        }
    }

    coordinatorAuthorityShadowWalStore = append.store
    const appendedRecords = append.records || []
    const bytes = getJsonByteSize(appendedRecords)
    incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.appended', appendedRecords.length)
    incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.appendBatches')
    incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.appendBytes', bytes)
    recordQueueWakeupMetricMax('coordinatorAuthority.shadowWal.maxAppendBytes', bytes)

    let projectedState = cloneCoordinatorAuthorityValue(coordinatorAuthorityShadowWalProjectedState || {queue: {}})
    let matched = 0
    let mismatched = 0
    let recovered = true
    const appendResults = {}
    for(const record of appendedRecords) {
        try {
            const projection = applyWalRecord(projectedState, record, {
                snapshotSeq: coordinatorAuthorityShadowWalProjectionSnapshotSeq,
                appliedIds: coordinatorAuthorityShadowWalAppliedIds
            })
            if(projection?.applied === true) projectedState = projection.state
            const projectedRow = projection?.state?.queue?.[record.key] || null
            const rowMatched = projection?.applied === true &&
                JSON.stringify(projectedRow || null) === JSON.stringify(record.value || null)
            if(rowMatched) matched += 1
            else mismatched += 1
            appendResults[record.id] = {
                applied: projection?.applied === true,
                matched: rowMatched,
                reason: projection?.reason || '',
                projectedRow
            }
        }
        catch(error) {
            recovered = false
            mismatched += 1
            appendResults[record.id] = {
                applied: false,
                matched: false,
                reason: 'projection-error',
                error: `${error?.message || error || 'projection error'}`.slice(0, 240)
            }
        }
        coordinatorAuthorityShadowWalProjectionMaxSeq = Math.max(
            coordinatorAuthorityShadowWalProjectionMaxSeq,
            Number.parseInt(record.seq, 10) || 0
        )
    }
    coordinatorAuthorityShadowWalProjectedState = projectedState

    if(matched) incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.appendProjectionMatched', matched)
    if(mismatched) {
        incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.appendProjectionMismatched', mismatched)
        recordCoordinatorDiagnosticEvent(
            'coordinator-authority-shadow-wal-append-mismatch',
            'Coordinator authority shadow WAL replay did not match appended queue records'
        )
    }
    const recordsBeforeCheckpointSwitch = getCoordinatorAuthorityShadowWalRetainedRecordCount()
    const checkpointSwitch = recordsBeforeCheckpointSwitch > MAX_COORDINATOR_AUTHORITY_SHADOW_WAL_RECORDS
        ? switchCoordinatorAuthorityShadowWalCheckpoint('retention-limit')
        : null

    return {
        appended: true,
        records: appendedRecords,
        results: appendResults,
        generationId: append.generationId,
        segmentId,
        bytes,
        recovered,
        matched,
        mismatched,
        maxSeq: coordinatorAuthorityShadowWalProjectionMaxSeq,
        checkpointSwitched: checkpointSwitch?.checkpointSwitched === true,
        checkpointSwitch,
        recordsBeforeCheckpointSwitch,
        totalRecords: getCoordinatorAuthorityShadowWalRetainedRecordCount()
    }
}

function recordCoordinatorAuthorityShadowWalProjection(result = {}) {
    if(result?.durable !== true) {
        incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.skippedNonDurable')
        return {
            checked: false,
            matched: false,
            reason: 'non-durable'
        }
    }

    const record = makeCoordinatorAuthorityShadowWalRecord(result)
    if(!record) return {checked: false, reason: 'not-row-mutation'}

    try {
        incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.checked')
        incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.bytes', getJsonByteSize(record))
        recordQueueWakeupMetricMax('coordinatorAuthority.shadowWal.maxBytes', getJsonByteSize(record))

        const baseState = {
            queue: {
                [result.rowKey]: cloneCoordinatorAuthorityValue(result.previousRow || {})
            }
        }
        const projection = applyWalRecord(baseState, record, {
            snapshotSeq: 0,
            appliedIds: new Set()
        })
        const projectedRow = projection?.state?.queue?.[result.rowKey] || null
        const matched = projection?.applied === true &&
            JSON.stringify(projectedRow || null) === JSON.stringify(result.nextRow || null)

        if(matched) {
            incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.matched')
        }
        else {
            incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.mismatched')
            recordCoordinatorDiagnosticEvent(
                'coordinator-authority-shadow-wal-mismatch',
                `${result.operationKind || 'authority-row-mutation'} did not project to the persisted row`
            )
        }

        const shadowResult = {
            checked: true,
            matched,
            reason: matched ? '' : projection?.reason || 'projection-mismatch',
            record: projection?.record || record,
            projectedRow
        }
        if(matched) {
            try {
                shadowResult.append = appendCoordinatorAuthorityShadowWalRecords([record], {
                    segmentId: `coordinator-authority-shadow-${result.operationKind || 'authority-row-mutation'}-${Date.now()}`
                })
            }
            catch(error) {
                incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.appendFailed')
                recordCoordinatorDiagnosticEvent(
                    'coordinator-authority-shadow-wal-append-failed',
                    error?.message || 'Coordinator authority shadow WAL append diagnostic failed'
                )
                shadowResult.append = {
                    appended: false,
                    records: [],
                    reason: 'diagnostic-error',
                    error: `${error?.message || error || 'diagnostic error'}`.slice(0, 240)
                }
            }
        }
        return shadowResult
    }
    catch(error) {
        incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.failed')
        recordCoordinatorDiagnosticEvent(
            'coordinator-authority-shadow-wal-failed',
            error?.message || 'Coordinator authority shadow WAL projection failed'
        )
        return {
            checked: true,
            matched: false,
            reason: 'projection-error',
            error: `${error?.message || error || 'projection error'}`.slice(0, 240),
            record
        }
    }
}

function safeRecordCoordinatorAuthorityShadowWalProjection(result = {}) {
    try {
        return recordCoordinatorAuthorityShadowWalProjection(result)
    }
    catch(error) {
        incrementQueueWakeupMetric('coordinatorAuthority.shadowWal.failed')
        recordCoordinatorDiagnosticEvent(
            'coordinator-authority-shadow-wal-failed',
            error?.message || 'Coordinator authority shadow WAL diagnostic failed'
        )
        return {
            checked: false,
            matched: false,
            reason: 'diagnostic-error',
            error: `${error?.message || error || 'diagnostic error'}`.slice(0, 240)
        }
    }
}

function makeProgressShadowWalRecord(profileHref = '', record = {}, options = {}) {
    const operation = options.operation && typeof options.operation === 'object' ? options.operation : null
    const operationRecord = operation?.nextRecord && typeof operation.nextRecord === 'object'
        ? operation.nextRecord
        : record
    const normalizedHref = normalizeQuoraProfileUrl(operation?.rowKey || profileHref || operationRecord?.profileHref || '')
    if(!normalizedHref || !operationRecord || typeof operationRecord !== 'object') return null

    const attemptId = getAttemptIdFromValue(operationRecord)
    const attemptNumber = getAttemptNumberFromValue(operationRecord)
    const runId = `${operationRecord?.runId || ''}`.trim()
    const operationKind = getCoordinatorRowEventMetricKind(operation?.operationKind || options.eventKind || 'progress')
    const status = `${operationRecord?.status || ''}`.trim()
    const at = Number.parseInt(operationRecord.updatedAt || operationRecord.terminalAt, 10) || Date.now()

    return {
        kind: 'map.set',
        area: 'progress',
        key: normalizedHref,
        id: [
            'progress',
            operationKind,
            normalizedHref,
            attemptId,
            attemptNumber || '',
            status,
            at
        ].filter(value => value !== '').join(':'),
        eventKind: operationKind,
        operationKind,
        reason: operation?.reason || options.reason || '',
        value: cloneCoordinatorAuthorityValue(operationRecord),
        runId,
        attemptId,
        attemptNumber,
        terminal: operation?.terminal === true || isTerminalProfileNukeRecord(operationRecord),
        at,
        seq: 1
    }
}

function cloneNormalizedProgressRecordsForShadowWal(records = {}) {
    const normalized = {}
    for(const [profileHref, record] of Object.entries(records || {})) {
        const href = normalizeQuoraProfileUrl(record?.profileHref || profileHref || '')
        if(!href || !record || typeof record !== 'object') continue
        normalized[href] = {
            ...cloneCoordinatorAuthorityValue(record),
            profileHref: href
        }
    }
    return normalized
}

function recordProgressShadowWalProjection(progressRecords = {}, options = {}) {
    const normalizedRecords = options.recordsAlreadyNormalized === true
        ? cloneNormalizedProgressRecordsForShadowWal(progressRecords || {})
        : normalizeStoredProfileNukeProgress(progressRecords || {})
    const previousRecords = options.previousRecordsAlreadyNormalized === true
        ? cloneNormalizedProgressRecordsForShadowWal(options.previousProgressRecords || {})
        : normalizeStoredProfileNukeProgress(options.previousProgressRecords || {})
    const progressOperations = options.progressOperations && typeof options.progressOperations === 'object'
        ? options.progressOperations
        : {}
    const entries = Object.entries(normalizedRecords)
    if(!entries.length) return {checked: 0, matched: 0, mismatched: 0, failed: 0, results: {}}

    const eventKind = getCoordinatorRowEventMetricKind(options.eventKind || 'progress')
    const eventPrefix = `rowEvent.${eventKind}.shadowWal`
    const summary = {checked: 0, matched: 0, mismatched: 0, failed: 0, withPrevious: 0, results: {}}

    for(const [profileHref, record] of entries) {
        const operation = progressOperations[profileHref] || null
        const walRecord = makeProgressShadowWalRecord(profileHref, record, {eventKind, operation})
        if(!walRecord) {
            summary.results[profileHref] = {
                checked: false,
                matched: false,
                reason: 'invalid-record'
            }
            continue
        }

        const previousRecord = previousRecords[profileHref] || null

        try {
            const bytes = getJsonByteSize(walRecord)
            incrementQueueWakeupMetric('progress.shadowWal.checked')
            incrementQueueWakeupMetric(`${eventPrefix}.checked`)
            incrementQueueWakeupMetric('progress.shadowWal.bytes', bytes)
            incrementQueueWakeupMetric(`${eventPrefix}.bytes`, bytes)
            recordQueueWakeupMetricMax('progress.shadowWal.maxBytes', bytes)
            recordQueueWakeupMetricMax(`${eventPrefix}.maxBytes`, bytes)

            if(previousRecord) {
                summary.withPrevious += 1
                incrementQueueWakeupMetric('progress.shadowWal.withPrevious')
                incrementQueueWakeupMetric(`${eventPrefix}.withPrevious`)
            }
            const projection = applyWalRecord({
                progress: previousRecord ? {
                    [profileHref]: cloneCoordinatorAuthorityValue(previousRecord)
                } : {}
            }, walRecord, {
                snapshotSeq: 0,
                appliedIds: new Set()
            })
            const projectedRecord = projection?.state?.progress?.[profileHref] || null
            const matched = projection?.applied === true &&
                JSON.stringify(projectedRecord || null) === JSON.stringify(record || null)

            summary.checked += 1
            if(matched) {
                summary.matched += 1
                incrementQueueWakeupMetric('progress.shadowWal.matched')
                incrementQueueWakeupMetric(`${eventPrefix}.matched`)
            }
            else {
                summary.mismatched += 1
                incrementQueueWakeupMetric('progress.shadowWal.mismatched')
                incrementQueueWakeupMetric(`${eventPrefix}.mismatched`)
                recordCoordinatorDiagnosticEvent(
                    'progress-shadow-wal-mismatch',
                    `${eventKind} did not project to the persisted progress record`
                )
            }

            summary.results[profileHref] = {
                checked: true,
                matched,
                reason: matched ? '' : projection?.reason || 'projection-mismatch',
                withPrevious: !!previousRecord,
                terminal: walRecord.terminal === true,
                operationKind: walRecord.operationKind,
                record: walRecord,
                projectedRecord
            }
        }
        catch(error) {
            summary.checked += 1
            summary.mismatched += 1
            summary.failed += 1
            incrementQueueWakeupMetric('progress.shadowWal.failed')
            incrementQueueWakeupMetric(`${eventPrefix}.failed`)
            recordCoordinatorDiagnosticEvent(
                'progress-shadow-wal-failed',
                error?.message || 'Progress shadow WAL projection failed'
            )
            summary.results[profileHref] = {
                checked: true,
                matched: false,
                reason: 'projection-error',
                withPrevious: !!previousRecord,
                error: `${error?.message || error || 'projection error'}`.slice(0, 240)
            }
        }
    }

    return summary
}

function safeRecordProgressShadowWalProjection(progressRecords = {}, options = {}) {
    try {
        return recordProgressShadowWalProjection(progressRecords, options)
    }
    catch(error) {
        const eventKind = getCoordinatorRowEventMetricKind(options.eventKind || 'progress')
        const eventPrefix = `rowEvent.${eventKind}.shadowWal`
        incrementQueueWakeupMetric('progress.shadowWal.failed')
        incrementQueueWakeupMetric(`${eventPrefix}.failed`)
        recordCoordinatorDiagnosticEvent(
            'progress-shadow-wal-failed',
            error?.message || 'Progress shadow WAL diagnostic failed'
        )
        return {
            checked: 0,
            matched: 0,
            mismatched: 0,
            failed: 1,
            reason: 'diagnostic-error',
            error: `${error?.message || error || 'diagnostic error'}`.slice(0, 240),
            results: {}
        }
    }
}

function getProgressShadowWalRetainedRecordCount() {
    return getWalRecordsForGeneration(
        progressShadowWalStore,
        progressShadowWalStore?.meta?.activeCheckpoint
    ).length
}

function switchProgressShadowWalCheckpoint(reason = 'retention-limit') {
    const snapshotSeq = Math.max(
        Number.parseInt(progressShadowWalProjectionMaxSeq, 10) || 0,
        Number.parseInt(progressShadowWalStore?.meta?.snapshotSeq, 10) || 0
    )
    const nextSeq = Math.max(
        Number.parseInt(progressShadowWalStore?.meta?.nextSeq, 10) || 0,
        snapshotSeq + 1
    )
    progressShadowWalStore = makePairedCheckpointStore(
        cloneCoordinatorAuthorityValue(progressShadowWalProjectedState || {progress: {}}),
        {
            snapshotSeq,
            nextSeq,
            createdAt: Date.now()
        }
    )
    progressShadowWalProjectionSnapshotSeq = snapshotSeq
    progressShadowWalAppliedIds = new Set()
    incrementQueueWakeupMetric('progress.shadowWal.checkpointSwitched')
    recordQueueWakeupMetricMax('progress.shadowWal.maxCheckpointSeq', snapshotSeq)

    return {
        checkpointSwitched: true,
        reason,
        snapshotSeq,
        retainedRecords: getProgressShadowWalRetainedRecordCount()
    }
}

function appendProgressShadowWalRecords(records = [], options = {}) {
    const normalizedRecords = (Array.isArray(records) ? records : [records])
        .filter(record => record && typeof record === 'object')
        .map(record => {
            const next = cloneCoordinatorAuthorityValue(record)
            delete next.id
            delete next.seq
            return next
        })
    if(!normalizedRecords.length) {
        return {appended: false, records: [], reason: 'no-records'}
    }

    const segmentId = `${options.segmentId || `progress-shadow-${Date.now()}`}`
    const append = appendWalRecordsToGeneration(progressShadowWalStore, normalizedRecords, {
        segmentId
    })
    if(append?.rejected) {
        incrementQueueWakeupMetric('progress.shadowWal.appendRejected')
        recordCoordinatorDiagnosticEvent(
            'progress-shadow-wal-append-rejected',
            append.reason || 'Progress shadow WAL append was rejected'
        )
        return {
            appended: false,
            records: [],
            reason: append.reason || 'append-rejected'
        }
    }

    progressShadowWalStore = append.store
    const appendedRecords = append.records || []
    const bytes = getJsonByteSize(appendedRecords)
    incrementQueueWakeupMetric('progress.shadowWal.appended', appendedRecords.length)
    incrementQueueWakeupMetric('progress.shadowWal.appendBatches')
    incrementQueueWakeupMetric('progress.shadowWal.appendBytes', bytes)
    recordQueueWakeupMetricMax('progress.shadowWal.maxAppendBytes', bytes)

    let projectedState = cloneCoordinatorAuthorityValue(progressShadowWalProjectedState || {progress: {}})
    let matched = 0
    let mismatched = 0
    let recovered = true
    const appendResults = {}
    for(const record of appendedRecords) {
        try {
            const projection = applyWalRecord(projectedState, record, {
                snapshotSeq: progressShadowWalProjectionSnapshotSeq,
                appliedIds: progressShadowWalAppliedIds
            })
            if(projection?.applied === true) projectedState = projection.state
            const projectedRecord = projection?.state?.progress?.[record.key] || null
            const rowMatched = projection?.applied === true &&
                JSON.stringify(projectedRecord || null) === JSON.stringify(record.value || null)
            if(rowMatched) matched += 1
            else mismatched += 1
            appendResults[record.id] = {
                applied: projection?.applied === true,
                matched: rowMatched,
                reason: projection?.reason || '',
                projectedRecord
            }
        }
        catch(error) {
            recovered = false
            mismatched += 1
            appendResults[record.id] = {
                applied: false,
                matched: false,
                reason: 'projection-error',
                error: `${error?.message || error || 'projection error'}`.slice(0, 240)
            }
        }
        progressShadowWalProjectionMaxSeq = Math.max(
            progressShadowWalProjectionMaxSeq,
            Number.parseInt(record.seq, 10) || 0
        )
    }
    progressShadowWalProjectedState = projectedState

    if(matched) incrementQueueWakeupMetric('progress.shadowWal.appendProjectionMatched', matched)
    if(mismatched) {
        incrementQueueWakeupMetric('progress.shadowWal.appendProjectionMismatched', mismatched)
        recordCoordinatorDiagnosticEvent(
            'progress-shadow-wal-append-mismatch',
            'Progress shadow WAL replay did not match appended progress records'
        )
    }
    const recordsBeforeCheckpointSwitch = getProgressShadowWalRetainedRecordCount()
    const checkpointSwitch = recordsBeforeCheckpointSwitch > MAX_PROGRESS_SHADOW_WAL_RECORDS
        ? switchProgressShadowWalCheckpoint('retention-limit')
        : null

    return {
        appended: true,
        records: appendedRecords,
        results: appendResults,
        generationId: append.generationId,
        segmentId,
        bytes,
        recovered,
        matched,
        mismatched,
        maxSeq: progressShadowWalProjectionMaxSeq,
        checkpointSwitched: checkpointSwitch?.checkpointSwitched === true,
        checkpointSwitch,
        recordsBeforeCheckpointSwitch,
        totalRecords: getProgressShadowWalRetainedRecordCount()
    }
}

function safeAppendProgressShadowWalRecords(records = [], options = {}) {
    try {
        return appendProgressShadowWalRecords(records, options)
    }
    catch(error) {
        incrementQueueWakeupMetric('progress.shadowWal.appendFailed')
        recordCoordinatorDiagnosticEvent(
            'progress-shadow-wal-append-failed',
            error?.message || 'Progress shadow WAL append diagnostic failed'
        )
        return {
            appended: false,
            records: [],
            reason: 'diagnostic-error',
            error: `${error?.message || error || 'diagnostic error'}`.slice(0, 240)
        }
    }
}

function makeProgressShadowWalRowAppendResult(append = null, profileHref = '') {
    if(!append || append.appended !== true) return append || null

    const normalizedHref = normalizeQuoraProfileUrl(profileHref || '')
    if(!normalizedHref) return append

    const rowRecords = (append.records || [])
        .filter(record => normalizeQuoraProfileUrl(record?.key || '') === normalizedHref)
    if(!rowRecords.length) {
        return {
            appended: false,
            records: [],
            reason: 'missing-row-append',
            generationId: append.generationId,
            segmentId: append.segmentId,
            totalRecords: append.totalRecords || 0
        }
    }

    const rowResults = rowRecords.map(record => append.results?.[record.id] || null)
    const rowMatched = rowResults.filter(result => result?.matched === true).length
    const rowMismatched = rowRecords.length - rowMatched

    return {
        ...append,
        records: rowRecords,
        bytes: getJsonByteSize(rowRecords),
        matched: rowMatched,
        mismatched: rowMismatched
    }
}

function isCoordinatorAuthorityRejectResult(value = null) {
    return !!value && typeof value === 'object' &&
        (value.__coordinatorAuthorityReject === true || value.accepted === false)
}

function normalizeCoordinatorAuthorityMutationRow(value, previousRow = null) {
    if(value === undefined) return previousRow
    if(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'nextRow')) {
        return value.nextRow
    }
    return value
}

function normalizeCoordinatorAuthorityStateInput(value = null) {
    if(!value || typeof value !== 'object') return null

    const stored = value.stored && typeof value.stored === 'object' ? value.stored : {}
    const queue = normalizeCoordinatorMap(cloneCoordinatorAuthorityValue(
        value.queue || stored[COORDINATOR_QUEUE_KEY] || {}
    ))
    const runs = normalizeCoordinatorMap(cloneCoordinatorAuthorityValue(
        value.runs || stored[COORDINATOR_RUNS_KEY] || {}
    ))

    return {
        stored: {
            [COORDINATOR_QUEUE_KEY]: cloneCoordinatorAuthorityValue(queue),
            [COORDINATOR_QUEUE_WAL_KEY]: cloneCoordinatorAuthorityValue(stored[COORDINATOR_QUEUE_WAL_KEY] || null),
            [COORDINATOR_RUNS_KEY]: cloneCoordinatorAuthorityValue(runs)
        },
        queue,
        runs
    }
}

function createCoordinatorAuthority() {
    let hydrated = false
    let projection = makeCoordinatorAuthorityProjection()

    async function hydrate(defaults = {}) {
        projection = makeCoordinatorAuthorityProjection(await loadCoordinatorState(defaults))
        hydrated = true
        return current()
    }

    function current() {
        return makeCoordinatorAuthorityProjection(projection)
    }

    function absorbPersistedSnapshot(payload = {}) {
        if(!hydrated || !payload || typeof payload !== 'object') return false

        const next = makeCoordinatorAuthorityProjection(projection)
        let changed = false

        if(Object.prototype.hasOwnProperty.call(payload, COORDINATOR_QUEUE_KEY)) {
            next.queue = normalizeCoordinatorMap(cloneCoordinatorAuthorityValue(payload[COORDINATOR_QUEUE_KEY] || {}))
            next.stored[COORDINATOR_QUEUE_KEY] = cloneCoordinatorAuthorityValue(payload[COORDINATOR_QUEUE_KEY] || {})
            changed = true
        }
        if(Object.prototype.hasOwnProperty.call(payload, COORDINATOR_QUEUE_WAL_KEY)) {
            next.stored[COORDINATOR_QUEUE_WAL_KEY] = cloneCoordinatorAuthorityValue(payload[COORDINATOR_QUEUE_WAL_KEY] || null)
            const recovered = recoverCoordinatorQueueFromWal(
                next.stored[COORDINATOR_QUEUE_KEY] || next.queue || {},
                next.stored[COORDINATOR_QUEUE_WAL_KEY]
            )
            next.queue = recovered.queue
            changed = true
        }
        if(Object.prototype.hasOwnProperty.call(payload, COORDINATOR_RUNS_KEY)) {
            next.runs = normalizeCoordinatorMap(cloneCoordinatorAuthorityValue(payload[COORDINATOR_RUNS_KEY] || {}))
            next.stored[COORDINATOR_RUNS_KEY] = cloneCoordinatorAuthorityValue(payload[COORDINATOR_RUNS_KEY] || {})
            changed = true
        }
        if(Object.prototype.hasOwnProperty.call(payload, COORDINATOR_EVENTS_KEY)) {
            next.events = normalizeCoordinatorEvents(cloneCoordinatorAuthorityValue(payload[COORDINATOR_EVENTS_KEY] || []))
            next.stored[COORDINATOR_EVENTS_KEY] = cloneCoordinatorAuthorityValue(payload[COORDINATOR_EVENTS_KEY] || [])
            changed = true
        }
        if(Object.prototype.hasOwnProperty.call(payload, PROFILE_NUKE_PROGRESS_KEY)) {
            next.progress = normalizeStoredProfileNukeProgress(cloneCoordinatorAuthorityValue(payload[PROFILE_NUKE_PROGRESS_KEY] || {}))
            next.stored[PROFILE_NUKE_PROGRESS_KEY] = cloneCoordinatorAuthorityValue(payload[PROFILE_NUKE_PROGRESS_KEY] || {})
            changed = true
        }

        if(changed) projection = next
        return changed
    }

    async function persist(nextProjection = projection, changes = {}) {
        const requestedReason = normalizeSnapshotWriteReason(changes.reason || 'ordinaryMutation')
        if(requestedReason === 'repair') {
            return saveCoordinatorState(nextProjection, {
                ...changes,
                reason: 'repair'
            })
        }
        if(requestedReason === 'displayRead') {
            return saveCoordinatorState(nextProjection, {
                ...changes,
                reason: 'displayRead'
            })
        }
        if(requestedReason === 'compatibilityFlush') {
            return saveCoordinatorState(nextProjection, {
                ...changes,
                reason: 'compatibilityFlush'
            })
        }
        if(requestedReason === 'checkpointSwitch') {
            return saveCoordinatorState(nextProjection, {
                ...changes,
                reason: 'checkpointSwitch'
            })
        }
        if(requestedReason === 'userMemoryNonAuthority') {
            return saveCoordinatorState(nextProjection, {
                ...changes,
                reason: 'userMemoryNonAuthority'
            })
        }
        return saveCoordinatorState(nextProjection, {
            ...changes,
            reason: 'ordinaryMutation'
        })
    }

    async function applyLocked(operation = {}) {
        const rowKey = normalizeCoordinatorAuthorityRowKey(
            operation.rowKey || operation.coordinatorKey || operation.profileHref || ''
        )
        const operationKind = normalizeQueueWriteOperationName(operation.operationKind || operation.kind || 'authority-row-mutation')
        const reason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')

        const providedAuthorityState = activeQueueWakeupStorageContext &&
            (operation.allowCurrentAuthorityState === true || operation.allowLockedProjection === true)
            ? normalizeCoordinatorAuthorityStateInput(
                operation.currentAuthorityState || operation.authorityState || operation.lockedProjection
            )
            : null
        const freshAuthorityRows = providedAuthorityState || await loadCoordinatorQueueRunsProjection()
        projection = makeCoordinatorAuthorityProjection({
            ...projection,
            stored: {
                ...(projection.stored || {}),
                [COORDINATOR_QUEUE_KEY]: freshAuthorityRows.stored?.[COORDINATOR_QUEUE_KEY] || {},
                [COORDINATOR_QUEUE_WAL_KEY]: freshAuthorityRows.stored?.[COORDINATOR_QUEUE_WAL_KEY] || null,
                [COORDINATOR_RUNS_KEY]: freshAuthorityRows.stored?.[COORDINATOR_RUNS_KEY] || {}
            },
            queue: freshAuthorityRows.queue,
            runs: freshAuthorityRows.runs
        })
        hydrated = true

        const previousRow = rowKey ? projection.queue[rowKey] || null : null

        if(!rowKey) {
            return makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: false,
                changed: false,
                durable: false,
                reason: 'missing-row-key'
            })
        }

        if(!previousRow) {
            return makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: false,
                changed: false,
                durable: false,
                reason: 'missing-row',
                previousRow
            })
        }

        const expectedAttemptId = normalizeAttemptId(operation.expectedAttemptId || '')
        const previousAttemptId = getAttemptIdFromValue(previousRow)
        if(expectedAttemptId && previousAttemptId !== expectedAttemptId) {
            return makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: false,
                changed: false,
                durable: false,
                staleAttempt: true,
                reason: 'stale-attempt',
                previousRow
            })
        }

        const expectedAttemptNumber = Number.parseInt(operation.expectedAttemptNumber, 10) || 0
        const previousAttemptNumber = getAttemptNumberFromValue(previousRow)
        if(expectedAttemptNumber && previousAttemptNumber !== expectedAttemptNumber) {
            return makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: false,
                changed: false,
                durable: false,
                staleAttempt: true,
                reason: 'stale-attempt-number',
                previousRow
            })
        }

        const mutationContext = {
            operationKind,
            rowKey,
            reason,
            previousRow: cloneCoordinatorAuthorityValue(previousRow),
            now: Date.now(),
            reject(rejectReason = 'rejected', details = {}) {
                return {
                    __coordinatorAuthorityReject: true,
                    reason: `${rejectReason || 'rejected'}`.trim() || 'rejected',
                    ...details
                }
            }
        }
        const mutationResult = typeof operation.mutate === 'function'
            ? await operation.mutate(cloneCoordinatorAuthorityValue(previousRow), mutationContext)
            : previousRow

        if(isCoordinatorAuthorityRejectResult(mutationResult)) {
            return makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: false,
                changed: false,
                durable: false,
                reason: mutationResult.reason || 'rejected',
                previousRow,
                nextRow: previousRow,
                staleAttempt: mutationResult.staleAttempt === true
            })
        }

        const nextRow = normalizeCoordinatorAuthorityMutationRow(mutationResult, previousRow)
        const changed = JSON.stringify(nextRow) !== JSON.stringify(previousRow)
        if(!changed) {
            return makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: true,
                changed: false,
                durable: true,
                reason: 'unchanged',
                previousRow,
                nextRow: previousRow,
                persistence: {saved: false, noOp: true}
            })
        }

        const nextProjection = makeCoordinatorAuthorityProjection({
            ...projection,
            queue: {
                ...projection.queue,
                [rowKey]: cloneCoordinatorAuthorityValue(nextRow)
            }
        })

        let result = null
        try {
            const baseResult = makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: true,
                changed: true,
                durable: false,
                reason: 'persistence-pending',
                previousRow,
                nextRow,
                terminal: isTerminalCoordinatorStatus(nextRow?.status)
            })
            const persistenceResult = shouldUseCoordinatorQueueWalBackend(operationKind, reason)
                ? await persistCoordinatorAuthorityQueueWalMutation({
                    ...baseResult,
                    previousProjectionQueue: projection.queue
                }, nextProjection, {
                    metricPath: operation.metricPath
                        ? `${operation.metricPath}.queueWal`
                        : `authority.${operationKind}.queueWal.save`,
                    projectionMetricPath: operation.metricPath
                        ? `${operation.metricPath}.projection`
                        : `authority.${operationKind}.projection.save`
                })
                : {
                    backend: 'snapshot',
                    saved: await persist(nextProjection, {
                        queue: true,
                        reason,
                        metricPath: operation.metricPath || `authority.${operationKind}.save`,
                        queueOperation: operationKind,
                        queueChangedRows: 1,
                        coordinatorAuthorityWrite: true
                    })
                }
            const saved = persistenceResult?.saved === true
            if(saved) {
                if(persistenceResult?.append?.store) {
                    nextProjection.stored = {
                        ...(nextProjection.stored || {}),
                        [COORDINATOR_QUEUE_WAL_KEY]: persistenceResult.append.store
                    }
                }
                projection = nextProjection
                if(activeQueueWakeupStorageContext) {
                    activeQueueWakeupStorageContext.coordinatorAuthorityQueueMutationApplied = true
                    activeQueueWakeupStorageContext.coordinatorAuthorityQueueOperation = operationKind
                }
            }
            result = makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: true,
                changed: true,
                durable: saved === true,
                reason: saved ? 'persisted' : 'persistence-failed',
                previousRow,
                nextRow,
                terminal: isTerminalCoordinatorStatus(nextRow?.status),
                persistence: {
                    backend: persistenceResult?.backend || 'snapshot',
                    saved: saved === true,
                    walSaved: persistenceResult?.walSaved === true,
                    snapshotSaved: persistenceResult?.snapshotSaved === true,
                    projectionSaved: persistenceResult?.projectionSaved,
                    append: persistenceResult?.append || null
                }
            })
        }
        catch(error) {
            result = makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: true,
                changed: true,
                durable: false,
                reason: 'persistence-error',
                previousRow,
                nextRow,
                terminal: isTerminalCoordinatorStatus(nextRow?.status),
                persistence: {
                    saved: false,
                    error: `${error?.message || error || 'storage error'}`.slice(0, 240)
                }
            })
        }
        result.shadowWal = safeRecordCoordinatorAuthorityShadowWalProjection(result)
        return result
    }

    async function apply(operation = {}) {
        const operationKind = normalizeQueueWriteOperationName(operation.operationKind || operation.kind || 'authority-row-mutation')
        const rowKey = normalizeCoordinatorAuthorityRowKey(
            operation.rowKey || operation.coordinatorKey || operation.profileHref || ''
        )
        const fallbackResult = makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
            accepted: false,
            changed: false,
            durable: false,
            reason: 'storage-update-fallback',
            persistence: {
                saved: false,
                storageTimedOut: true,
                fallbackReturned: true
            }
        })

        return enqueueSpaceFeedStorageUpdate(
            () => applyLocked({
                ...operation,
                currentAuthorityState: null,
                authorityState: null,
                lockedProjection: null,
                allowCurrentAuthorityState: false,
                allowLockedProjection: false
            }),
            {
                reason: `coordinator-authority.${operationKind}`,
                timeoutMs: operation.timeoutMs,
                failureValue: fallbackResult
            }
        )
    }

    async function applyWithinStorageUpdate(operation = {}) {
        const operationKind = normalizeQueueWriteOperationName(operation.operationKind || operation.kind || 'authority-row-mutation')
        const rowKey = normalizeCoordinatorAuthorityRowKey(
            operation.rowKey || operation.coordinatorKey || operation.profileHref || ''
        )
        if(!activeQueueWakeupStorageContext) {
            return makeCoordinatorAuthorityApplyResult({...operation, operationKind, rowKey}, {
                accepted: false,
                changed: false,
                durable: false,
                reason: 'storage-update-required',
                persistence: {
                    saved: false,
                    requiresStorageUpdate: true
                }
            })
        }

        return applyLocked({
            ...operation,
            allowCurrentAuthorityState: true,
            allowLockedProjection: true
        })
    }

    return {
        hydrate,
        current,
        persist,
        apply,
        applyWithinStorageUpdate,
        absorbPersistedSnapshot,
        isHydrated() {
            return hydrated
        }
    }
}

const coordinatorAuthority = createCoordinatorAuthority()
coordinatorAuthoritySnapshotObserver = payload => coordinatorAuthority.absorbPersistedSnapshot(payload)

async function loadCoordinatorQueueProjection(options = {}) {
    return runQueueWakeupMetricPhase('loadCoordinatorQueueProjection', async () => {
        const stored = await metricStorageGet({
            [COORDINATOR_QUEUE_KEY]: {},
            [COORDINATOR_QUEUE_WAL_KEY]: null
        }, {
            metricPath: options.metricPath || 'coordinatorQueueProjection.load'
        })
        const queueSnapshot = runQueueWakeupMetricPhase('normalizeQueue', () => normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY]))
        const queueRecovery = runQueueWakeupMetricPhase('recoverQueueWal', () => recoverCoordinatorQueueFromWal(
            queueSnapshot,
            stored[COORDINATOR_QUEUE_WAL_KEY]
        ))
        const queue = queueRecovery.queue
        recordActiveStorageWorkSnapshot(queue)

        return {
            stored,
            queue
        }
    })
}

async function loadCoordinatorQueueRunsProjection(options = {}) {
    return runQueueWakeupMetricPhase('loadCoordinatorQueueRunsProjection', async () => {
        const stored = await metricStorageGet({
            [COORDINATOR_QUEUE_KEY]: {},
            [COORDINATOR_QUEUE_WAL_KEY]: null,
            [COORDINATOR_RUNS_KEY]: {}
        }, {
            metricPath: options.metricPath || 'coordinatorQueueRunsProjection.load'
        })
        const queueSnapshot = runQueueWakeupMetricPhase('normalizeQueue', () => normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY]))
        const queueRecovery = runQueueWakeupMetricPhase('recoverQueueWal', () => recoverCoordinatorQueueFromWal(
            queueSnapshot,
            stored[COORDINATOR_QUEUE_WAL_KEY]
        ))
        const queue = queueRecovery.queue
        const runs = runQueueWakeupMetricPhase('normalizeRuns', () => normalizeCoordinatorMap(stored[COORDINATOR_RUNS_KEY]))
        recordActiveStorageWorkSnapshot(queue)

        return {
            stored,
            queue,
            runs
        }
    })
}

async function saveCoordinatorQueueProjection(queue = {}, options = {}) {
    const queueChanged = !!options.queueChanged
    const reason = normalizeSnapshotWriteReason(options.reason || 'ordinaryMutation')
    if(reason !== 'ordinaryMutation') return false
    return saveCoordinatorState({queue}, {
        queue: queueChanged,
        reason: 'ordinaryMutation',
        queueOperation: options.queueOperation || 'queue-projection',
        queueChangedRows: options.queueChangedRows
    })
}

async function saveCoordinatorQueueRunsProjection(queue = {}, runs = {}, options = {}) {
    const queueChanged = !!options.queueChanged
    const runsChanged = !!options.runsChanged
    const reason = normalizeSnapshotWriteReason(options.reason || 'ordinaryMutation')
    if(reason === 'ordinaryMutation') {
        return saveCoordinatorState({queue, runs}, {
            queue: queueChanged,
            runs: runsChanged,
            reason: 'ordinaryMutation',
            queueOperation: options.queueOperation || 'queue-runs-projection',
            queueChangedRows: options.queueChangedRows
        })
    }
    if(reason === 'repair') {
        return saveCoordinatorState({queue, runs}, {
            queue: queueChanged,
            runs: runsChanged,
            reason: 'repair',
            queueOperation: options.queueOperation || 'repair',
            queueChangedRows: options.queueChangedRows
        })
    }
    return false
}

async function saveCoordinatorState(state = {}, changes = {}) {
    return runQueueWakeupMetricPhase('saveCoordinatorState', async () => {
        incrementQueueWakeupMetric('saveCoordinatorStateCalls')
        incrementActiveStorageMetricDetail('saveCoordinatorStateCalls')
        const snapshotWriteReason = normalizeSnapshotWriteReason(changes.reason)
        const updateToken = getActiveStorageUpdateToken()
        if(isStorageUpdateAbandoned(updateToken)) {
            incrementQueueWakeupMetric('storageUpdate.lateWriteSuppressed')
            setActiveStorageMetricDetail('lateWriteSuppressed', true)
            return false
        }
        if(changes.queue &&
            activeQueueWakeupStorageContext?.coordinatorAuthorityQueueMutationApplied === true &&
            changes.coordinatorAuthorityWrite !== true) {
            incrementQueueWakeupMetric('coordinatorAuthority.postMutationQueueSaveRejected')
            setActiveStorageMetricDetail('rejectedOperation', 'postAuthorityQueueSave')
            return false
        }

        const payload = {}
        const diagnosticEvents = changes.events ? drainPendingCoordinatorDiagnosticEvents() : []

        if(changes.queue) {
            const queue = state.queue || {}
            pruneCoordinatorCurrentWork(queue)
            recordActiveStorageWorkSnapshot(queue)
            payload[COORDINATOR_QUEUE_KEY] = queue
            payload[COORDINATOR_QUEUE_VIEW_KEY] = buildCoordinatorQueueView(queue)
        }
        if(changes.runs) payload[COORDINATOR_RUNS_KEY] = state.runs || {}
        if(changes.pendingPosts) payload[SPACE_PENDING_NUKED_POSTS_KEY] = state.pendingPosts || {}
        if(changes.events) {
            payload[COORDINATOR_EVENTS_KEY] = normalizeCoordinatorEvents(state.events || [])
                .concat(diagnosticEvents)
                .slice(-MAX_COORDINATOR_EVENTS)
        }
        if(changes.progress) payload[PROFILE_NUKE_PROGRESS_KEY] = pruneProfileNukeProgress(state.progress || {})

        if(Object.keys(payload).length) {
            if(isStorageUpdateAbandoned(updateToken)) {
                incrementQueueWakeupMetric('storageUpdate.lateWriteSuppressed')
                setActiveStorageMetricDetail('lateWriteSuppressed', true)
                return false
            }
            recordSnapshotWriteReasonMetrics(snapshotWriteReason, payload)
            await metricStorageSet(payload, {
                metricPath: changes.metricPath || `reason.${snapshotWriteReason}`,
                queueSnapshotWriteReason: snapshotWriteReason,
                queueOperation: changes.queueOperation,
                queueChangedRows: changes.queueChangedRows,
                coordinatorAuthorityWrite: changes.coordinatorAuthorityWrite === true
            })
            if(changes.progress && payload[PROFILE_NUKE_PROGRESS_KEY]) {
                incrementQueueWakeupMetric('progress.storageWrites')
                incrementQueueWakeupMetric('progress.flushPerformed')
                const payloadRows = getStoragePayloadRowCount(payload[PROFILE_NUKE_PROGRESS_KEY])
                const changedRows = Math.max(0, Number.parseInt(changes.progressChangedRows, 10) || 0)
                if(changedRows > 0) {
                    incrementQueueWakeupMetric('progress.changedRecordsPerStorageWrite', changedRows)
                }
                incrementQueueWakeupMetric('progress.payloadRowsPerStorageWrite', payloadRows)
                incrementQueueWakeupMetric('progress.recordsPerStorageWrite', payloadRows)
            }
        }

        return !!Object.keys(payload).length
    })
}

async function syncCoordinatorProgressRecordsLocked(progressRecords = {}) {
    const hrefs = Object.keys(progressRecords || {}).map(normalizeQuoraProfileUrl).filter(Boolean)
    if(!hrefs.length) return false

    const state = await loadCoordinatorState({
        [COORDINATOR_EVENTS_KEY]: undefined,
        [PROFILE_NUKE_PROGRESS_KEY]: undefined
    })
    const queue = state.queue
    const runs = state.runs
    let changed = false
    const now = Date.now()
    const affectedRunIds = new Set()
    const terminalSettlementHrefs = new Set()
    let progressChanged = false
    let progressChangedRows = 0

    for(const href of hrefs) {
        const item = queue[href]
        const record = progressRecords[href] || profileNukeProgress[href] || null
        if(!item || !record) continue
        if(!shouldApplyProgressToCoordinatorItem(item, record)) continue
        if(hasMismatchedCoordinatorAttempt(item, record)) {
            await recordStaleAttemptDiagnostic({
                profileHref: href,
                incomingAttemptId: getAttemptIdFromValue(record),
                expectedAttemptId: getAttemptIdFromValue(item),
                senderTabId: record.tabId || null,
                message: 'Ignored progress from stale coordinator attempt'
            })
            continue
        }
        if(item && !isCoordinatorQueueAuthoritativeItem(item)) {
            continue
        }
        if(isCoordinatorQueueAuthoritativeItem(item)) {
            const mappedForAuthoritativeItem = getCoordinatorStatusFromProgress(record)
            if(shouldPreferSuccessfulProgressOverTerminalCoordinatorItem(item, record, mappedForAuthoritativeItem)) {
                // Fall through so a same-attempt success can repair a stale terminal timeout row.
            }
            else {
                if(shouldRestoreTerminalProgressFromCoordinatorItem(item, record)) {
                    const restoredRecord = makeTerminalProgressRecordFromCoordinatorItem(
                        href,
                        item,
                        record,
                        'Restored terminal profile progress from authoritative queue row'
                    )
                    if(restoredRecord && JSON.stringify(restoredRecord) !== JSON.stringify(record)) {
                        progress[href] = restoredRecord
                        profileNukeProgress = {
                            ...profileNukeProgress,
                            [href]: restoredRecord
                        }
                        progressChanged = true
                        progressChangedRows += 1
                    }
                }
                continue
            }
        }
        if(item.runId) affectedRunIds.add(item.runId)
        for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
            affectedRunIds.add(runId)
        }

        const mapped = getCoordinatorStatusFromProgress(record)
        if(!mapped.status) continue
        const resetRetry = shouldResetCoordinatorFailureFromProgress(item, record, mapped)
        const mappedTerminal = isTerminalCoordinatorStatus(mapped.status)
        if(isTerminalCoordinatorStatus(item.status) && !mappedTerminal && !resetRetry) {
            const restoredRecord = makeTerminalProgressRecordFromCoordinatorItem(
                href,
                item,
                record,
                'Restored terminal profile progress after stale nonterminal write'
            )
            if(restoredRecord && JSON.stringify(restoredRecord) !== JSON.stringify(record)) {
                progress[href] = restoredRecord
                profileNukeProgress = {
                    ...profileNukeProgress,
                    [href]: restoredRecord
                }
                progressChanged = true
                progressChangedRows += 1
            }
            continue
        }
        if(isTerminalCoordinatorStatus(item.status) && mappedTerminal && item.status === mapped.status && !resetRetry) {
            continue
        }
        if(item.status !== 'queued' && mapped.status === 'queued' && !resetRetry) continue

        const nextItem = transitionCoordinatorItemFromProgress(item, record, mapped, {
            now,
            resetRetry
        })

        if(JSON.stringify(nextItem) === JSON.stringify(item)) continue
        queue[href] = nextItem
        if(nextItem.runId) affectedRunIds.add(nextItem.runId)
        if(mappedTerminal) terminalSettlementHrefs.add(href)
        changed = true
    }

    const nextRuns = affectedRunIds.size
        ? recomputeCoordinatorRuns(queue, runs, affectedRunIds)
        : runs
    const runsChanged = JSON.stringify(nextRuns) !== JSON.stringify(runs)
    const storagePatch = {}

    if(changed) storagePatch[COORDINATOR_QUEUE_KEY] = queue
    if(runsChanged) storagePatch[COORDINATOR_RUNS_KEY] = nextRuns
    if(progressChanged) storagePatch[PROFILE_NUKE_PROGRESS_KEY] = progress

    await saveCoordinatorState({
        queue: storagePatch[COORDINATOR_QUEUE_KEY],
        runs: storagePatch[COORDINATOR_RUNS_KEY],
        progress: storagePatch[PROFILE_NUKE_PROGRESS_KEY]
    }, {
        queue: changed,
        runs: runsChanged,
        progress: progressChanged,
        progressChangedRows,
        reason: 'compatibilityFlush',
        queueOperation: 'compatibility-progress-sync',
        queueChangedRows: changed ? progressChangedRows : 0
    })

    if(terminalSettlementHrefs.size) {
        await settleTerminalCoordinatorItemsLocked({
            profileHrefs: Array.from(terminalSettlementHrefs)
        })
    }

    return changed || runsChanged
}

function syncCoordinatorProgressRecords(progressRecords = {}) {
    return enqueueSpaceFeedStorageUpdate(() => syncCoordinatorProgressRecordsLocked(progressRecords))
}

function mergePendingCoordinatorProgressSyncRecords(progressRecords = {}) {
    for(const [key, record] of Object.entries(progressRecords || {})) {
        if(!record || typeof record !== 'object') continue

        const href = normalizeQuoraProfileUrl(record.profileHref || key || '')
        if(!href) continue

        coordinatorProgressSyncPendingRecords[href] = {
            ...record,
            profileHref: href
        }
    }

    recordQueueWakeupMetricMax('progress.pendingMax', Object.keys(coordinatorProgressSyncPendingRecords).length)
    return Object.keys(coordinatorProgressSyncPendingRecords).length > 0
}

async function drainCoordinatorProgressSync() {
    coordinatorProgressSyncActive = true
    let changed = false

    try {
        while(Object.keys(coordinatorProgressSyncPendingRecords).length) {
            const records = coordinatorProgressSyncPendingRecords
            coordinatorProgressSyncPendingRecords = {}
            changed = await syncCoordinatorProgressRecords(records) || changed
        }

        return changed
    }
    finally {
        coordinatorProgressSyncActive = false
        if(Object.keys(coordinatorProgressSyncPendingRecords).length) {
            coordinatorProgressSyncPromise = drainCoordinatorProgressSync().catch(() => false)
        }
    }
}

function enqueueCoordinatorProgressSync(progressRecords = {}) {
    if(!mergePendingCoordinatorProgressSyncRecords(progressRecords)) {
        return coordinatorProgressSyncPromise
    }

    if(!coordinatorProgressSyncActive) {
        coordinatorProgressSyncPromise = drainCoordinatorProgressSync().catch(() => false)
    }

    return coordinatorProgressSyncPromise
}

async function enqueueStoredCoordinatorQueueProgressSync(progressRecords = {}) {
    const currentAuthorityState = await loadCoordinatorQueueProjection({
        metricPath: 'progressSync.storedQueue.load'
    })
    const queue = currentAuthorityState.queue
    const records = {}

    for(const [itemKey, item] of Object.entries(queue)) {
        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        if(!href || !progressRecords[href]) continue

        records[href] = progressRecords[href]
    }

    if(!Object.keys(records).length) return false
    return enqueueCoordinatorProgressSync(records)
}

function getChangedProfileProgressRecords(oldRecords = {}, newRecords = {}) {
    const changedRecords = {}

    for(const [href, record] of Object.entries(newRecords || {})) {
        if(!record || typeof record !== 'object') continue
        if(JSON.stringify(record) === JSON.stringify(oldRecords?.[href] || null)) continue

        changedRecords[href] = record
    }

    return changedRecords
}

function getCoordinatorProgressRecordForItem(itemKey = '', item = {}, progress = {}) {
    const candidates = [
        itemKey,
        item?.targetProfileHref,
        item?.dedupeKey,
        item?.requestedUrl
    ]

    for(const candidate of candidates) {
        const normalized = normalizeQuoraProfileUrl(candidate || '')
        if(normalized && progress[normalized]) return progress[normalized]
        if(candidate && progress[candidate]) return progress[candidate]
    }

    return null
}

function inferSourceTypeFromRunId(runId = '') {
    const match = `${runId || ''}`.match(/^(.+)-\d{10,}-[a-z0-9]+$/i)
    return match?.[1] || ''
}

function getCoordinatorRunSourcePageFromEvents(events = [], runId = '') {
    for(const event of [...normalizeCoordinatorEvents(events)].reverse()) {
        if(`${event?.runId || ''}` !== `${runId || ''}`) continue
        const sourcePageUrl = `${event?.details?.sourcePageUrl || ''}`.trim()
        if(sourcePageUrl) return sourcePageUrl
    }

    return ''
}

function getProfileSearchQueryFromPageUrl(pageUrl = '') {
    try {
        return new URL(pageUrl).searchParams.get('q') || ''
    }
    catch {
        return ''
    }
}

function makeCoordinatorSourceFromRunMetadata(runId = '', run = {}, events = []) {
    const sourceType = run.sourceType || inferSourceTypeFromRunId(runId) || 'profile-list'
    const sourcePageUrl = (Array.isArray(run.sourcePages) && run.sourcePages.find(Boolean)) ||
        getCoordinatorRunSourcePageFromEvents(events, runId) ||
        ''
    const source = {
        type: sourceType,
        pageUrl: sourcePageUrl
    }

    if(sourceType === 'profile-search') {
        const searchQuery = getProfileSearchQueryFromPageUrl(sourcePageUrl)
        if(searchQuery) {
            source.searchQuery = searchQuery
            source.sourceLabel = searchQuery
        }
    }

    return source
}

function mergeCoordinatorSourceMetadata(existing = {}, inferred = {}) {
    if(!inferred || typeof inferred !== 'object') return existing || {}

    const next = existing && typeof existing === 'object' ? {...existing} : {}
    if(!next.type && inferred.type) next.type = inferred.type
    if(!next.pageUrl && inferred.pageUrl) next.pageUrl = inferred.pageUrl
    if(!next.searchQuery && inferred.searchQuery) next.searchQuery = inferred.searchQuery
    if(!next.sourceLabel && inferred.sourceLabel) next.sourceLabel = inferred.sourceLabel
    return next
}

function applyCoordinatorSourceMetadataRepair(item = {}, inferred = {}) {
    if(!item || typeof item !== 'object' || !inferred?.type) return item

    let changed = false
    const next = {...item}
    const mergedSource = mergeCoordinatorSourceMetadata(next.source || {}, inferred)
    if(JSON.stringify(mergedSource) !== JSON.stringify(next.source || {})) {
        next.source = mergedSource
        changed = true
    }

    const sources = Array.isArray(next.sources) ? next.sources : []
    let matchedSource = false
    const repairedSources = sources.map(source => {
        if(!source || typeof source !== 'object') return source
        if(source.type && source.type !== inferred.type) return source
        matchedSource = true
        const merged = mergeCoordinatorSourceMetadata(source, inferred)
        if(JSON.stringify(merged) !== JSON.stringify(source)) changed = true
        return merged
    })

    if(!matchedSource && (inferred.pageUrl || inferred.searchQuery)) {
        repairedSources.push({...inferred})
        changed = true
    }
    if(changed) next.sources = repairedSources

    if(inferred.pageUrl && next.scope && typeof next.scope === 'object' && !next.scope.sourcePageUrl) {
        next.scope = {
            ...next.scope,
            type: next.scope.type || inferred.type,
            sourcePageUrl: inferred.pageUrl
        }
        changed = true
    }

    return changed ? next : item
}

function shouldRestoreQueuedProgressRecordToCoordinatorQueue(href = '', record = {}, queue = {}, now = Date.now()) {
    if(!href || queue[href]) return false
    if(`${record?.status || ''}` !== 'queued') return false
    if(!`${record?.runId || ''}`.trim()) return false
    if(`${record?.actionKind || 'mute-block'}` === UNBLOCK_UNMUTE_ACTION_KIND) return false

    const queuedAt = Number.parseInt(record?.queuedAt, 10) || 0
    return !queuedAt || now - queuedAt <= CURRENT_WORK_RETENTION_MS
}

function restoreQueuedProgressRecordsToCoordinatorQueue(state = {}, options = {}) {
    const queue = state.queue || {}
    const runs = state.runs || {}
    const events = state.events || []
    const progress = state.progress || {}
    const now = Number.parseInt(options.now, 10) || Date.now()
    const affectedRunIds = new Set()
    let restored = 0
    let progressChanged = false

    for(const [key, record] of Object.entries(progress || {})) {
        const href = normalizeQuoraProfileUrl(record?.profileHref || key || '')
        if(!shouldRestoreQueuedProgressRecordToCoordinatorQueue(href, record, queue, now)) continue

        const runId = `${record.runId || ''}`.trim()
        const run = runs[runId] || {}
        const source = makeCoordinatorSourceFromRunMetadata(runId, run, events)
        const sourceType = source.type || 'profile-list'
        const sourcePageUrl = source.pageUrl || ''
        const queuedAt = Number.parseInt(record.queuedAt, 10) || now
        const actionKind = getCoordinatorActionKindForRequestedAction(record.actionKind || 'mute-block')
        const item = applyCoordinatorJobEnvelope({
            id: makeId('item'),
            runId,
            dedupeKey: href,
            coordinatorKey: href,
            actionKind,
            executorTabAction: getCoordinatorExecutorTabActionForActionKind(actionKind),
            executorMaxConcurrent: null,
            executorNoForegroundFallback: record.executorNoForegroundFallback === true || record.noForegroundFallback === true,
            executorOwner: 'service-worker',
            serviceWorkerOwned: true,
            targetProfileHref: href,
            requestedUrl: href,
            source,
            sources: [source],
            status: 'queued',
            outcome: '',
            error: '',
            createdAt: queuedAt,
            updatedAt: now,
            queuedAt,
            activeAt: 0,
            terminalAt: 0,
            tabId: null,
            attempt: 0,
            attemptId: makeAttemptId(),
            attemptNumber: 1,
            maxAttempts: 1,
            sourceSettledAt: 0,
            sourceSettlementKey: '',
            sourceSettlementOutcome: '',
            milestones: makeEmptyCoordinatorMilestones()
        }, {
            runInput: {id: runId, sourceType},
            source,
            runId,
            targetProfileHref: href,
            requestedUrl: href,
            coordinatorKey: href,
            actionKind
        })

        queue[href] = item
        const resetRecord = normalizeProgressPatch(
            href,
            buildQueuedCoordinatorProgressResetPatch(item, {now: queuedAt, runId, actionKind}),
            record
        )
        if(resetRecord) {
            progress[href] = {
                ...resetRecord,
                updatedAt: now
            }
            progressChanged = true
        }

        const nextRun = runs[runId] || {}
        runs[runId] = {
            ...nextRun,
            id: runId,
            sourceType,
            createdAt: nextRun.createdAt || queuedAt,
            updatedAt: now,
            status: 'active',
            paused: false,
            sourcePages: Array.from(new Set([...(nextRun.sourcePages || []), sourcePageUrl].filter(Boolean))),
            targetProfileHrefs: Array.from(new Set([...getCoordinatorRunTargetHrefs(nextRun), href])),
            targetWorkKeys: Array.from(new Set([...(nextRun.targetWorkKeys || []), href]))
        }
        affectedRunIds.add(runId)
        restored += 1
    }

    if(restored > 0) {
        Object.assign(runs, recomputeCoordinatorRuns(queue, runs, affectedRunIds))
        events.push({
            id: makeId('event'),
            runId: '',
            itemId: '',
            type: 'repair',
            message: `Restored ${restored} stranded queued Current Work target${restored === 1 ? '' : 's'}`,
            at: now,
            details: {restored}
        })
    }

    return {
        restored,
        progressChanged,
        eventsChanged: restored > 0,
        affectedRunIds: Array.from(affectedRunIds)
    }
}

async function repairCoordinatorStorageFromProgress() {
    return enqueueSpaceFeedStorageUpdate(repairCoordinatorStorageFromProgressLocked)
}

async function repairCoordinatorStorageFromProgressBestEffort(options = {}) {
    const timeoutMs = Math.max(1000, Number.parseInt(options.timeoutMs, 10) || COORDINATOR_REPAIR_GATE_TIMEOUT_MS)

    return promiseWithTimeout(
        repairCoordinatorStorageFromProgress(),
        timeoutMs,
        'coordinator storage repair'
    ).catch(error => ({
        repaired: 0,
        queueChanged: false,
        runsChanged: false,
        timedOut: /timed out/i.test(error?.message || ''),
        error: error?.message || `${error || ''}`
    }))
}

function getCoordinatorRepairOperationTabIdsToClose(operation = {}, item = null, record = null) {
    const tabIds = new Set()
    const persistedTabId = normalizeTabId(operation.persistedTabId || getPersistedQueuedTabId(item, record))
    if(operation.closePersistedTab === true && persistedTabId) {
        tabIds.add(persistedTabId)
    }
    for(const tabId of operation.tabIdsToClose || []) {
        const normalizedTabId = normalizeTabId(tabId)
        if(normalizedTabId) tabIds.add(normalizedTabId)
    }
    return Array.from(tabIds)
}

function matchesCoordinatorRepairOperationAttempt(item = null, operation = {}) {
    const expectedAttemptId = normalizeAttemptId(operation.expectedAttemptId || '')
    const expectedAttemptNumber = Number.parseInt(operation.expectedAttemptNumber, 10) || 0
    if(expectedAttemptId && getAttemptIdFromValue(item) !== expectedAttemptId) return false
    if(expectedAttemptNumber && getAttemptNumberFromValue(item) !== expectedAttemptNumber) return false
    return true
}

function applyInvalidProfileResolutionRepairActionLocked(state = {}, operation = {}) {
    if(`${operation.kind || ''}`.trim() !== 'repairInvalidProfileResolution') {
        return {changed: false, reason: 'wrong-kind'}
    }

    const queue = state.queue || {}
    const itemKey = `${operation.itemKey || ''}`.trim()
    if(!itemKey) return {changed: false, reason: 'missing-item-key'}

    const item = queue[itemKey] || null
    if(!item || typeof item !== 'object') return {changed: false, reason: 'row-changed'}
    if(!matchesCoordinatorRepairOperationAttempt(item, operation)) {
        return {changed: false, reason: 'attempt-changed'}
    }

    const failure = `${operation.failure || getInvalidProfileResolutionFailure(item, itemKey) || ''}`.trim()
    const invalidTerminalResolutionNeedsRepair = isTerminalCoordinatorStatus(item.status) &&
        item.status === 'failed' &&
        item.outcome === 'action-error'
    if(!failure || (isTerminalCoordinatorStatus(item.status) && !invalidTerminalResolutionNeedsRepair)) {
        return {changed: false, reason: 'not-invalid-profile-resolution'}
    }

    const now = Number.parseInt(operation.now, 10) || Date.now()
    const terminalNow = isTerminalCoordinatorStatus(item.status)
        ? getCoordinatorCurrentWorkAnchor(item) || now
        : now
    const terminalItem = buildTerminalCoordinatorQueueItem(item, {
        status: 'skipped',
        outcome: 'unresolved-target',
        error: failure,
        reason: 'invalid-profile-resolution',
        eventType: JOB_EVENT_TERMINAL,
        now: terminalNow
    })
    const settlementKey = getCoordinatorItemSettlementKey(terminalItem)
    const nextItem = settlementKey ? {
        ...terminalItem,
        sourceSettledAt: terminalNow,
        sourceSettlementKey: settlementKey,
        sourceSettlementOutcome: 'cleared'
    } : terminalItem

    queue[itemKey] = nextItem

    let pendingPostsChanged = false
    let pendingPosts = state.pendingPosts || {}
    const pendingResult = clearResolverPendingSpaceRecords(pendingPosts, nextItem, {
        requestedUrl: operation.requestedUrl || getProfileResolutionRequestedUrl(item, itemKey),
        evidence: item.evidence || []
    })
    if(pendingResult.changed) {
        pendingPosts = pendingResult.pendingPosts
        state.pendingPosts = pendingPosts
        pendingPostsChanged = true
    }

    return {
        changed: true,
        queueChanged: true,
        pendingPostsChanged,
        pendingPosts,
        repaired: 1,
        affectedRunIds: item.runId ? [item.runId] : [],
        tabIdsToClose: getCoordinatorRepairOperationTabIdsToClose(operation, item, operation.record || null),
        item: nextItem
    }
}

function applyStaleProfileResolutionTabRepairActionLocked(state = {}, operation = {}) {
    if(`${operation.kind || ''}`.trim() !== 'repairStaleProfileResolutionTab') {
        return {changed: false, reason: 'wrong-kind'}
    }

    const queue = state.queue || {}
    const itemKey = `${operation.itemKey || ''}`.trim()
    if(!itemKey) return {changed: false, reason: 'missing-item-key'}

    const item = queue[itemKey] || null
    if(!item || typeof item !== 'object') return {changed: false, reason: 'row-changed'}
    if(!matchesCoordinatorRepairOperationAttempt(item, operation)) {
        return {changed: false, reason: 'attempt-changed'}
    }

    const now = Number.parseInt(operation.now, 10) || Date.now()
    const nextItem = buildTerminalCoordinatorQueueItem(item, {
        status: 'failed',
        outcome: 'timeout',
        error: 'Queued profile-resolution tab timed out after disappearing before resolving a profile',
        reason: 'stale-profile-resolution-tab',
        eventType: JOB_EVENT_TAB_REMOVED,
        now
    })

    queue[itemKey] = nextItem

    return {
        changed: true,
        queueChanged: true,
        repaired: 1,
        affectedRunIds: item.runId ? [item.runId] : [],
        tabIdsToClose: getCoordinatorRepairOperationTabIdsToClose(operation, item, operation.record || null),
        item: nextItem
    }
}

function applyProgressRecordCoordinatorRepairActionLocked(state = {}, operation = {}) {
    if(`${operation.kind || ''}`.trim() !== 'repairFromProgressRecord') {
        return {changed: false, reason: 'wrong-kind'}
    }

    const queue = state.queue || {}
    const itemKey = `${operation.itemKey || ''}`.trim()
    if(!itemKey) return {changed: false, reason: 'missing-item-key'}

    const item = queue[itemKey] || null
    if(!item || typeof item !== 'object') return {changed: false, reason: 'row-changed'}
    if(!matchesCoordinatorRepairOperationAttempt(item, operation)) {
        return {changed: false, reason: 'attempt-changed'}
    }

    const record = operation.record || null
    if(record && hasMismatchedCoordinatorAttempt(item, record)) {
        return {changed: false, reason: 'progress-attempt-mismatch'}
    }

    const mapped = operation.mapped || {}
    if(!mapped.status) return {changed: false, reason: 'missing-mapped-status'}

    const nextItem = transitionCoordinatorItemFromProgress(item, record, mapped, {
        now: Number.parseInt(operation.now, 10) || Date.now(),
        resetRetry: operation.resetRetry === true,
        terminalAtFallback: operation.terminalAtFallback || 'record'
    })

    if(JSON.stringify(nextItem) === JSON.stringify(item)) {
        return {changed: false, reason: 'unchanged'}
    }

    queue[itemKey] = nextItem

    return {
        changed: true,
        queueChanged: true,
        repaired: 1,
        item: nextItem,
        mappedTerminal: isTerminalCoordinatorStatus(mapped.status),
        affectedRunIds: nextItem.runId ? [nextItem.runId] : []
    }
}

function hasTerminalKeyOnlyCoordinatorEvent(events = [], itemKey = '', item = {}) {
    const runId = `${item?.runId || ''}`.trim()
    const status = `${item?.status || ''}`.trim()
    const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)

    return normalizeCoordinatorEvents(events).some(event => {
        if(`${event?.itemId || ''}` !== `${itemKey || ''}`) return false
        if(runId && `${event?.runId || ''}` !== runId) return false
        if(status && `${event?.type || ''}` !== status) return false
        if(coordinatorKey && `${event?.details?.coordinatorKey || ''}` && `${event.details.coordinatorKey}` !== coordinatorKey) return false
        return true
    })
}

function repairTerminalKeyOnlyDerivedStateLocked(state = {}, itemKey = '', item = {}, now = Date.now()) {
    if(!item || typeof item !== 'object') return {changed: false}
    if(getCoordinatorItemHref(item) || !isTerminalCoordinatorStatus(item.status)) return {changed: false}

    const events = state.events || []
    const affectedRunIds = []
    const runId = `${item.runId || ''}`.trim()
    if(runId) affectedRunIds.push(runId)

    if(hasTerminalKeyOnlyCoordinatorEvent(events, itemKey, item)) {
        return {
            changed: false,
            affectedRunIds
        }
    }

    const eventAt = Number.parseInt(item.terminalAt || item.updatedAt, 10) || now
    events.push({
        id: makeId('event'),
        runId,
        itemId: itemKey,
        type: item.status,
        message: item.error || `Terminal key-only coordinator item ${item.status}`,
        at: eventAt,
        details: {
            coordinatorKey: getCoordinatorItemQueueKey(item, itemKey),
            reason: item.actionLeaseReleaseReason || item.outcome || 'terminal-key-only-derived-repair'
        }
    })

    return {
        changed: true,
        eventsChanged: true,
        affectedRunIds,
        repaired: 1
    }
}

async function repairCoordinatorStorageFromProgressLocked() {
    const state = await loadCoordinatorState({
        [SPACE_PENDING_NUKED_POSTS_KEY]: {}
    })
    const queue = state.queue
    const runs = state.runs
    const events = state.events
    const progress = state.progress
    let pendingPosts = state.stored?.[SPACE_PENDING_NUKED_POSTS_KEY] || {}
    const now = Date.now()
    const liveProfileTabsByHref = await getLiveProfileTabsByHref()
    let changed = false
    let eventsChanged = false
    let pendingPostsChanged = false
    let progressChanged = false
    let repaired = 0
    let recomputeAllRuns = false
    const affectedRunIds = new Set()
    const terminalSettlementHrefs = new Set()
    const tabsToCloseAfterRepair = new Set()
    coordinatorDiagnosticBatchDepth += 1
    try {
    const markRunAffected = item => {
        const runId = `${item?.runId || ''}`.trim()
        if(runId) affectedRunIds.add(runId)
    }

    if(pruneCoordinatorCurrentWork(queue, now)) {
        changed = true
        recomputeAllRuns = true
    }

    const restoredQueued = restoreQueuedProgressRecordsToCoordinatorQueue(state, {now})
    if(restoredQueued.restored > 0) {
        changed = true
        eventsChanged = eventsChanged || restoredQueued.eventsChanged
        progressChanged = progressChanged || restoredQueued.progressChanged
        repaired += restoredQueued.restored
        for(const runId of restoredQueued.affectedRunIds || []) {
            if(runId) affectedRunIds.add(runId)
        }
    }

    for(const [itemKey, rawItem] of Object.entries(queue)) {
        let item = rawItem
        if(!item || typeof item !== 'object') continue

        if(item.runId) {
            const inferredSource = makeCoordinatorSourceFromRunMetadata(item.runId || '', runs[item.runId] || {}, events)
            const sourceRepairedItem = applyCoordinatorSourceMetadataRepair(item, inferredSource)
            if(sourceRepairedItem !== item) {
                item = sourceRepairedItem
                queue[itemKey] = item
                changed = true
                repaired += 1
                markRunAffected(item)
            }
        }

        const terminalKeyOnlyDerivedRepair = repairTerminalKeyOnlyDerivedStateLocked(state, itemKey, item, now)
        if(terminalKeyOnlyDerivedRepair.changed) {
            eventsChanged = eventsChanged || terminalKeyOnlyDerivedRepair.eventsChanged
            repaired += terminalKeyOnlyDerivedRepair.repaired || 0
        }
        for(const runId of terminalKeyOnlyDerivedRepair.affectedRunIds || []) {
            if(runId) affectedRunIds.add(runId)
        }

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        let record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
        if(record && !shouldApplyProgressToCoordinatorItem(item, record)) {
            record = null
        }
        if(record && hasMismatchedCoordinatorAttempt(item, record)) {
            await recordStaleAttemptDiagnostic({
                profileHref: href,
                incomingAttemptId: getAttemptIdFromValue(record),
                expectedAttemptId: getAttemptIdFromValue(item),
                senderTabId: record.tabId || null,
                message: 'Ignored repair from stale coordinator attempt'
            })
            record = null
        }
        const invalidProfileResolutionFailure = getInvalidProfileResolutionFailure(item, itemKey)
        const invalidTerminalResolutionNeedsRepair = isTerminalCoordinatorStatus(item.status) &&
            item.status === 'failed' &&
            item.outcome === 'action-error'
        if(invalidProfileResolutionFailure && (!isTerminalCoordinatorStatus(item.status) || invalidTerminalResolutionNeedsRepair)) {
            const tabId = getPersistedQueuedTabId(item, record)
            const closePersistedTab = tabId
                ? !!await getPersistedLiveTabForCoordinatorItem(item, record, itemKey)
                : false
            const applied = applyInvalidProfileResolutionRepairActionLocked({
                queue,
                pendingPosts
            }, {
                kind: 'repairInvalidProfileResolution',
                itemKey,
                failure: invalidProfileResolutionFailure,
                expectedAttemptId: getAttemptIdFromValue(item),
                expectedAttemptNumber: getAttemptNumberFromValue(item),
                persistedTabId: tabId,
                closePersistedTab,
                requestedUrl: getProfileResolutionRequestedUrl(item, itemKey),
                record,
                now
            })
            if(applied.changed) {
                pendingPosts = applied.pendingPosts || pendingPosts
                pendingPostsChanged = pendingPostsChanged || applied.pendingPostsChanged
                changed = true
                repaired += applied.repaired || 0
                for(const runId of applied.affectedRunIds || []) {
                    if(runId) affectedRunIds.add(runId)
                }
                for(const closeTabId of applied.tabIdsToClose || []) {
                    if(closeTabId) tabsToCloseAfterRepair.add(closeTabId)
                }
            }
            continue
        }
        const persistedActiveTabMissing = await shouldImmediatelyReconcileMissingPersistedActiveTab(item, record)
        if(!href && (persistedActiveTabMissing || await shouldReconcileMissingActiveCoordinatorKeyOnlyItem(item, record, now))) {
            const tabId = getPersistedQueuedTabId(item, record)
            const closePersistedTab = tabId && !persistedActiveTabMissing
                ? !!await getPersistedLiveTabForCoordinatorItem(item, record, itemKey)
                : false
            const applied = applyStaleProfileResolutionTabRepairActionLocked({
                queue
            }, {
                kind: 'repairStaleProfileResolutionTab',
                itemKey,
                expectedAttemptId: getAttemptIdFromValue(item),
                expectedAttemptNumber: getAttemptNumberFromValue(item),
                persistedTabId: tabId,
                closePersistedTab,
                record,
                now
            })
            if(applied.changed) {
                changed = true
                repaired += applied.repaired || 0
                for(const runId of applied.affectedRunIds || []) {
                    if(runId) affectedRunIds.add(runId)
                }
                for(const closeTabId of applied.tabIdsToClose || []) {
                    if(closeTabId) tabsToCloseAfterRepair.add(closeTabId)
                }
            }
            continue
        }
        const queueAuthoritative = isCoordinatorQueueAuthoritativeItem(item)
        let reconciledMissingActive = false
        const missingActiveDecision = await getMissingActiveCoordinatorRepairDecision(
            item,
            record,
            itemKey,
            href,
            liveProfileTabsByHref,
            now,
            persistedActiveTabMissing
        )
        if(missingActiveDecision.reconcile) {
            const tabId = getPersistedQueuedTabId(item, record)
            const expectedLiveTabIds = getOwnedOrExpectedLiveTabsForProfileHref(item, record, href, liveProfileTabsByHref)
                .map(tab => normalizeTabId(tab?.id))
                .filter(liveTabId => liveTabId && liveTabId !== tabId)
            const applied = applyMissingActiveCoordinatorEvidenceReconcileActionLocked(state, {
                itemKey,
                href,
                persistedTabId: tabId,
                expectedAttemptId: getAttemptIdFromValue(item),
                expectedAttemptNumber: getAttemptNumberFromValue(item),
                closePersistedTab: missingActiveDecision.closePersistedTab === true,
                expectedLiveTabIds,
                now: Date.now()
            })
            if(applied.changed) {
                record = progress[applied.href] || record
                progressChanged = progressChanged || applied.progressChanged
                repaired += applied.repaired || 0
                reconciledMissingActive = true
                for(const runId of applied.affectedRunIds || []) {
                    if(runId) affectedRunIds.add(runId)
                }
                for(const closeTabId of applied.tabIdsToClose || []) {
                    if(closeTabId) tabsToCloseAfterRepair.add(closeTabId)
                }
            }
        }

        let mappedForAuthoritativeItem = null
        if(queueAuthoritative && !reconciledMissingActive) {
            mappedForAuthoritativeItem = getCoordinatorStatusFromProgress(record)
            if(isTerminalCoordinatorStatus(mappedForAuthoritativeItem.status)) {
                // Authoritative active rows still need to accept terminal repair records.
            }
            else {
                if(shouldRestoreTerminalProgressFromCoordinatorItem(item, record)) {
                    const restoredRecord = makeTerminalProgressRecordFromCoordinatorItem(
                        href,
                        item,
                        record,
                        'Restored terminal profile progress during authoritative queue repair'
                    )
                    if(restoredRecord && JSON.stringify(restoredRecord) !== JSON.stringify(record)) {
                        const recordHref = normalizeQuoraProfileUrl(href || restoredRecord.profileHref || '')
                        progress[recordHref] = restoredRecord
                        profileNukeProgress = {
                            ...profileNukeProgress,
                            [recordHref]: restoredRecord
                        }
                        progressChanged = true
                        repaired += 1
                        markRunAffected(item)
                    }
                }
                continue
            }
        }

        const mapped = mappedForAuthoritativeItem || getCoordinatorStatusFromProgress(record)
        if(!mapped.status) continue
        const resetRetry = shouldResetCoordinatorFailureFromProgress(item, record, mapped)
        const mappedTerminal = isTerminalCoordinatorStatus(mapped.status)
        if(isTerminalCoordinatorStatus(item.status) && !mappedTerminal && !resetRetry) continue
        if(isTerminalCoordinatorStatus(item.status) && mappedTerminal && item.status === mapped.status && !resetRetry) {
            continue
        }

        const applied = applyProgressRecordCoordinatorRepairActionLocked(state, {
            kind: 'repairFromProgressRecord',
            itemKey,
            expectedAttemptId: getAttemptIdFromValue(item),
            expectedAttemptNumber: getAttemptNumberFromValue(item),
            record,
            mapped,
            now,
            resetRetry,
            terminalAtFallback: 'record'
        })
        if(!applied.changed) continue
        if(applied.mappedTerminal) terminalSettlementHrefs.add(href)
        changed = true
        repaired += applied.repaired || 0
        for(const runId of applied.affectedRunIds || []) {
            if(runId) affectedRunIds.add(runId)
        }
    }

    const nextRuns = (recomputeAllRuns || affectedRunIds.size)
        ? recomputeCoordinatorRuns(queue, runs, recomputeAllRuns ? null : affectedRunIds)
        : runs
    const runsChanged = nextRuns !== runs && JSON.stringify(nextRuns) !== JSON.stringify(runs)
    const storagePatch = {}

    if(progressChanged) {
        const prunedProgress = pruneProfileNukeProgress(progress)
        profileNukeProgress = prunedProgress
        storagePatch[PROFILE_NUKE_PROGRESS_KEY] = prunedProgress
    }
    if(changed) storagePatch[COORDINATOR_QUEUE_KEY] = queue
    if(runsChanged) storagePatch[COORDINATOR_RUNS_KEY] = nextRuns
    if(eventsChanged) storagePatch[COORDINATOR_EVENTS_KEY] = events
    if(pendingPostsChanged) storagePatch[SPACE_PENDING_NUKED_POSTS_KEY] = pendingPosts

    const saved = await saveCoordinatorState({
        queue: storagePatch[COORDINATOR_QUEUE_KEY],
        runs: storagePatch[COORDINATOR_RUNS_KEY],
        events: storagePatch[COORDINATOR_EVENTS_KEY],
        progress: storagePatch[PROFILE_NUKE_PROGRESS_KEY],
        pendingPosts: storagePatch[SPACE_PENDING_NUKED_POSTS_KEY]
    }, {
        queue: changed,
        runs: runsChanged,
        events: eventsChanged,
        progress: progressChanged,
        pendingPosts: pendingPostsChanged,
        reason: 'repair',
        queueOperation: 'repair-progress',
        queueChangedRows: repaired
    })

    if(terminalSettlementHrefs.size) {
        await settleTerminalCoordinatorItemsLocked({
            profileHrefs: Array.from(terminalSettlementHrefs)
        })
    }
    for(const tabId of saved !== false ? tabsToCloseAfterRepair : []) {
        detachQueuedTabRuntimeState(tabId, 'storage-repair-tab-close')
        try {
            await browser.tabs.remove(tabId)
        }
        catch {}
    }
    await flushPendingCoordinatorDiagnosticEvents()

    return {
        repaired,
        queueChanged: changed,
        pendingPostsChanged,
        runsChanged,
        eventsChanged,
        progressChanged,
        queueCount: Object.keys(queue).length,
        runCount: Object.keys(nextRuns).length
    }
    }
    finally {
        coordinatorDiagnosticBatchDepth = Math.max(0, coordinatorDiagnosticBatchDepth - 1)
    }
}

function getCoordinatorItemSettlementKey(item = {}) {
    if(!isTerminalCoordinatorStatus(item?.status)) return ''

    return [
        item.status || '',
        item.outcome || '',
        item.error || '',
        item.terminalAt || item.updatedAt || 0
    ].join('|')
}

function getCoordinatorTerminalItemEntries(queue = {}, profileHrefs = []) {
    const hrefFilter = new Set(getNormalizedProfileHrefList(profileHrefs || []))
    const entries = []

    for(const [itemKey, item] of Object.entries(queue || {})) {
        if(!item || typeof item !== 'object') continue
        if(!isTerminalCoordinatorStatus(item.status)) continue

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        if(!href) continue
        if(hrefFilter.size && !hrefFilter.has(href)) continue

        entries.push({itemKey, href, item})
    }

    return entries
}

function settleConfirmedSpaceFeedProfiles(currentPending = {}, currentNuked = {}, confirmedHrefs = new Set()) {
    const nextPending = {
        ...currentPending
    }
    const nextNuked = {
        ...currentNuked
    }
    let changedPending = false
    let changedNuked = false

    for(const [postKey, record] of Object.entries(currentPending || {})) {
        const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
        const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
        const nextRemainingUrls = remainingUrls.filter(url => !confirmedHrefs.has(url))

        if(nextRemainingUrls.length === remainingUrls.length) continue

        changedPending = true

        if(nextRemainingUrls.length > 0) {
            nextPending[postKey] = {
                ...record,
                remainingUrls: nextRemainingUrls,
                ...getPendingSpaceFeedJobKeyPatch(record, nextRemainingUrls),
                updatedAt: Date.now()
            }
            continue
        }

        delete nextPending[postKey]
        nextNuked[postKey] = {
            ...(currentNuked?.[postKey] || {}),
            postKey,
            postUrl: record.postUrl || currentNuked?.[postKey]?.postUrl || '',
            spaceKey: record.spaceKey || currentNuked?.[postKey]?.spaceKey || '',
            spaceUrl: record.spaceUrl || currentNuked?.[postKey]?.spaceUrl || '',
            urls: getNormalizedProfileHrefList(allUrls.length ? allUrls : remainingUrls),
            updatedAt: Date.now()
        }
        changedNuked = true
    }

    return {nextPending, nextNuked, changedPending, changedNuked}
}

async function settleTerminalCoordinatorItems(options = {}) {
    return enqueueSpaceFeedStorageUpdate(() => settleTerminalCoordinatorItemsLocked(options))
}

function scheduleTerminalOwnedProfileTabCleanup(profileHrefs = [], delayMs = 0) {
    const hrefs = getNormalizedProfileHrefList(profileHrefs || [])
    setTimeout(() => {
        void closeTerminalOwnedProfileTabs(hrefs).catch(() => {
            scheduleStoredWorkRepair(1000, {reason: 'terminal-tab-cleanup-failed'})
        })
    }, Math.max(0, Number.parseInt(delayMs, 10) || 0))
}

async function settleTerminalCoordinatorItemsLocked(options = {}) {
    const requestedHrefs = getNormalizedProfileHrefList(options.profileHrefs || [])

    const stored = await metricStorageGet({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_QUEUE_WAL_KEY]: null,
        [COORDINATOR_RUNS_KEY]: {},
        [PROFILE_NUKE_PROGRESS_KEY]: {},
        [SPACE_PENDING_NUKED_POSTS_KEY]: {},
        [SPACE_NUKED_POSTS_KEY]: {}
    }, {
        metricPath: 'terminalSettlement.load'
    })
    const snapshotQueue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY])
    const queueRecovery = recoverCoordinatorQueueFromWal(
        snapshotQueue,
        stored[COORDINATOR_QUEUE_WAL_KEY]
    )
    let queue = queueRecovery.queue
    let currentAuthorityState = {
        stored,
        queue,
        runs: normalizeCoordinatorMap(stored[COORDINATOR_RUNS_KEY])
    }
    const progress = normalizeStoredProfileNukeProgress(stored[PROFILE_NUKE_PROGRESS_KEY] || {})
    const terminalEntries = getCoordinatorTerminalItemEntries(queue, requestedHrefs)
    const missingQueueHrefs = requestedHrefs.filter(href => !findCoordinatorQueueEntryForHref(queue, href))
    const missingConfirmedHrefs = new Set(missingQueueHrefs.filter(href => isSuccessfulProfileNukeRecord(progress[href])))
    const missingClearedHrefs = new Set(missingQueueHrefs.filter(href => !missingConfirmedHrefs.has(href)))
    if(!terminalEntries.length && !missingConfirmedHrefs.size && !missingClearedHrefs.size) {
        scheduleTerminalOwnedProfileTabCleanup(requestedHrefs)
        return {settled: 0, confirmed: 0, cleared: 0, progressRestored: 0, pendingPosts: null, nukedPosts: null}
    }

    const now = Date.now()
    const confirmedHrefs = new Set(missingConfirmedHrefs)
    const clearedHrefs = new Set(missingClearedHrefs)
    let queueChanged = false
    let queueChangedRows = 0
    let progressRestored = 0
    let progressChanged = false

    for(const {itemKey, href, item} of terminalEntries) {
        const currentRecord = progress[href] || profileNukeProgress?.[href] || null
        if(shouldRestoreTerminalProgressFromCoordinatorItem(item, currentRecord)) {
            const restoredRecord = makeTerminalProgressRecordFromCoordinatorItem(
                href,
                item,
                currentRecord || {},
                'Restored terminal profile progress during coordinator settlement'
            )
            if(restoredRecord && JSON.stringify(restoredRecord) !== JSON.stringify(currentRecord || {})) {
                progress[href] = restoredRecord
                profileNukeProgress = {
                    ...profileNukeProgress,
                    [href]: restoredRecord
                }
                progressChanged = true
                progressRestored += 1
            }
        }

        const actionKind = getCoordinatorActionKindForItem(item)
        const sourceSettlementOutcome = `${item.status || ''}` === 'succeeded' &&
            actionKind !== UNBLOCK_UNMUTE_ACTION_KIND
            ? 'confirmed'
            : 'cleared'
        const settlementKey = getCoordinatorItemSettlementKey(item)
        if(!settlementKey) continue
        if(item.sourceSettlementKey === settlementKey) {
            if((item.sourceSettlementOutcome || sourceSettlementOutcome) === 'confirmed') {
                confirmedHrefs.add(href)
            }
            else {
                clearedHrefs.add(href)
            }
            continue
        }

        if(sourceSettlementOutcome === 'confirmed') {
            confirmedHrefs.add(href)
        }
        else {
            clearedHrefs.add(href)
        }

        const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
            operationKind: 'terminal-settlement',
            rowKey: itemKey,
            expectedAttemptId: getAttemptIdFromValue(item),
            expectedAttemptNumber: getAttemptNumberFromValue(item),
            reason: 'ordinaryMutation',
            metricPath: 'terminalSettlement.save',
            currentAuthorityState,
            mutate(currentItem, context) {
                if(!isTerminalCoordinatorStatus(currentItem?.status)) {
                    return context.reject('nonterminal-row')
                }
                if(getCoordinatorItemSettlementKey(currentItem) !== settlementKey) {
                    return context.reject('row-changed-before-authority-apply')
                }
                if(currentItem.sourceSettlementKey === settlementKey) {
                    return currentItem
                }
                return {
                    ...currentItem,
                    sourceSettledAt: now,
                    sourceSettlementKey: settlementKey,
                    sourceSettlementOutcome
                }
            }
        })

        if(authorityResult?.accepted === true && authorityResult?.durable === true) {
            currentAuthorityState = coordinatorAuthority.current()
            queue = currentAuthorityState.queue
            if(authorityResult.changed === true) {
                queueChanged = true
                queueChangedRows += 1
            }
        }
        else {
            confirmedHrefs.delete(href)
            clearedHrefs.delete(href)
            incrementQueueWakeupMetric('terminalSettlement.authorityApplyFailed')
            recordCoordinatorDiagnosticEvent(
                'terminal-settlement-authority-apply-failed',
                authorityResult?.reason || 'Terminal settlement authority mutation failed'
            )
            scheduleStoredWorkRepair(1000, {
                reason: 'terminal-settlement-authority-apply-failed',
                edgeTriggered: true
            })
        }
    }

    if(!confirmedHrefs.size && !clearedHrefs.size && !queueChanged && !progressChanged) {
        scheduleTerminalOwnedProfileTabCleanup(terminalEntries.map(entry => entry.href))
        return {settled: 0, confirmed: 0, cleared: 0, progressRestored: 0, pendingPosts: null, nukedPosts: null}
    }

    const currentPending = stored?.[SPACE_PENDING_NUKED_POSTS_KEY] || {}
    const currentNuked = stored?.[SPACE_NUKED_POSTS_KEY] || {}
    const confirmedResult = settleConfirmedSpaceFeedProfiles(currentPending, currentNuked, confirmedHrefs)
    const clearedResult = removeProfileHrefFromPendingSpaceRecords(confirmedResult.nextPending, Array.from(clearedHrefs))
    const prunedNuked = confirmedResult.changedNuked
        ? getPrunedNukedPosts(confirmedResult.nextNuked, {
            retentionDays: defaults.nukedPostRetentionDays,
            maxEntries: defaults.maxRememberedNukedPosts
        })
        : confirmedResult.nextNuked
    const payload = {}

    if(progressChanged) payload[PROFILE_NUKE_PROGRESS_KEY] = pruneProfileNukeProgress(progress)
    if(confirmedResult.changedPending || clearedResult.changed) {
        payload[SPACE_PENDING_NUKED_POSTS_KEY] = clearedResult.records
    }
    if(confirmedResult.changedNuked) {
        payload[SPACE_NUKED_POSTS_KEY] = prunedNuked
    }

    if(Object.keys(payload).length) {
        let derivedSaved = false
        try {
            derivedSaved = await metricStorageSet(payload, {
                snapshotWriteReason: 'ordinaryMutation',
                metricPath: 'terminalSettlement.derived.save',
                queueOperation: 'terminal-settlement-derived',
                queueChangedRows: 0
            })
        }
        catch(error) {
            derivedSaved = false
            recordCoordinatorDiagnosticEvent(
                'terminal-settlement-derived-save-failed',
                error?.message || 'Terminal settlement derived save failed'
            )
        }
        if(derivedSaved === false) {
            incrementQueueWakeupMetric('terminalSettlement.derivedSaveFailed')
            scheduleStoredWorkRepair(1000, {
                reason: 'terminal-settlement-derived-save-failed',
                edgeTriggered: true
            })
        }
    }

    scheduleTerminalOwnedProfileTabCleanup(terminalEntries.map(entry => entry.href))

    return {
        settled: confirmedHrefs.size + clearedHrefs.size,
        confirmed: confirmedHrefs.size,
        cleared: clearedHrefs.size,
        progressRestored,
        pendingPosts: payload[SPACE_PENDING_NUKED_POSTS_KEY] || null,
        nukedPosts: payload[SPACE_NUKED_POSTS_KEY] || null
    }
}

function getCoordinatorPageUrl() {
    return browser.runtime.getURL('coordinator.html')
}

function getQueuedActionSurfaceUrl() {
    return `${getCoordinatorPageUrl()}${QUEUED_ACTION_SURFACE_COORDINATOR_HASH}`
}

function normalizeTabId(value) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeOwnedParentId(value) {
    const tabId = normalizeTabId(value)
    if(tabId) return tabId

    const ownedParentId = `${value || ''}`.trim()
    return ownedParentId === SERVICE_WORKER_QUEUE_OWNER_ID ? SERVICE_WORKER_QUEUE_OWNER_ID : null
}

function isBrowserTabId(value) {
    return !!normalizeTabId(value)
}

async function rememberCoordinatorTabId(tabId) {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return

    coordinatorTabId = normalizedTabId
    try {
        await metricStorageSet({[COORDINATOR_TAB_KEY]: normalizedTabId}, {
            snapshotWriteReason: 'userMemoryNonAuthority'
        })
    }
    catch {}
}

async function forgetCoordinatorTabId(tabId = null) {
    const normalizedTabId = normalizeTabId(tabId)
    if(normalizedTabId && coordinatorTabId && normalizedTabId !== coordinatorTabId) return

    coordinatorTabId = null
    try {
        await coordinatorStorageAdapter.remove(COORDINATOR_TAB_KEY)
    }
    catch {}
}

async function forgetRemovedCoordinatorTabId(tabId) {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return

    if(coordinatorTabId === normalizedTabId) {
        await forgetCoordinatorTabId(normalizedTabId)
        return
    }

    try {
        const stored = await metricStorageGet({[COORDINATOR_TAB_KEY]: null})
        if(normalizeTabId(stored[COORDINATOR_TAB_KEY]) === normalizedTabId) {
            await forgetCoordinatorTabId(normalizedTabId)
        }
    }
    catch {}
}

async function getStoredCoordinatorTabId() {
    if(coordinatorTabId) return coordinatorTabId

    try {
        const stored = await metricStorageGet({[COORDINATOR_TAB_KEY]: null})
        coordinatorTabId = normalizeTabId(stored[COORDINATOR_TAB_KEY])
    }
    catch {
        coordinatorTabId = null
    }

    return coordinatorTabId
}

async function getKnownCoordinatorTab(tabId) {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return null

    try {
        const tab = await browser.tabs.get(normalizedTabId)
        await rememberCoordinatorTabId(normalizedTabId)
        return {
            tabId: normalizedTabId,
            windowId: tab?.windowId || null,
            reused: true,
            closedDuplicates: 0
        }
    }
    catch {
        if(!coordinatorTabId || coordinatorTabId === normalizedTabId) {
            await forgetCoordinatorTabId(normalizedTabId)
        }
        return null
    }
}

function dedupeCoordinatorTabs(preferredTabId = null) {
    coordinatorDedupePromise = coordinatorDedupePromise
        .catch(() => null)
        .then(() => dedupeCoordinatorTabsOnce(preferredTabId))

    return coordinatorDedupePromise
}

async function dedupeCoordinatorTabsOnce(preferredTabId = null) {
    const coordinatorUrl = getCoordinatorPageUrl()
    let matches = []

    try {
        matches = await browser.tabs.query({url: coordinatorUrl})
    }
    catch {
        return null
    }

    const liveMatches = matches.filter(tab => tab?.id)
    if(!liveMatches.length) {
        const preferred = await getKnownCoordinatorTab(preferredTabId)
        if(preferred?.tabId) return preferred

        const remembered = await getKnownCoordinatorTab(await getStoredCoordinatorTabId())
        if(remembered?.tabId) return remembered

        await forgetCoordinatorTabId()
        return null
    }

    const keep = liveMatches.find(tab => tab.id === coordinatorTabId) ||
        liveMatches.find(tab => tab.id === preferredTabId) ||
        liveMatches[0]
    const duplicates = liveMatches.filter(tab => tab.id !== keep.id)

    coordinatorTabId = keep.id
    await rememberCoordinatorTabId(keep.id)

    await Promise.allSettled(duplicates.map(tab => browser.tabs.remove(tab.id)))

    return {
        tabId: keep.id,
        windowId: keep.windowId || null,
        reused: true,
        closedDuplicates: duplicates.length
    }
}

async function openCoordinatorPage(options = {}) {
    if(coordinatorOpenPromise) return coordinatorOpenPromise

    coordinatorOpenPromise = openCoordinatorPageOnce(options)
        .finally(() => {
            coordinatorOpenPromise = null
        })

    return coordinatorOpenPromise
}

async function restoreCoordinatorPageForPersistentRetry() {
    try {
        const stored = await metricStorageGet({
            [COORDINATOR_RETRY_FAILED_ENABLED_KEY]: false
        })
        if(stored[COORDINATOR_RETRY_FAILED_ENABLED_KEY]) {
            await ensurePersistentFailedRetryAlarm()
            schedulePersistentFailedRetry(0)
            return {scheduled: true}
        }
        clearPersistentFailedRetry()
        return {scheduled: false}
    }
    catch(error) {
        console.info('Mute Block coordinator retry restore skipped', error)
        return {scheduled: false, reason: 'restore-error'}
    }
}

function clearPersistentFailedRetryTimeout() {
    if(persistentRetryFailedTimeout) {
        clearTimeout(persistentRetryFailedTimeout)
        persistentRetryFailedTimeout = null
    }
}

function clearPersistentFailedRetry() {
    clearPersistentFailedRetryTimeout()
    void clearPersistentFailedRetryAlarm()
}

function schedulePersistentFailedRetry(delayMs = PERSISTENT_FAILED_RETRY_INTERVAL_MS) {
    clearPersistentFailedRetryTimeout()
    persistentRetryFailedTimeout = setTimeout(() => {
        persistentRetryFailedTimeout = null
        void runPersistentFailedRetryTick()
    }, Math.max(0, Number.parseInt(delayMs, 10) || 0))
}

async function ensurePersistentFailedRetryAlarm() {
    if(!browser.alarms?.create) return false

    try {
        await browser.alarms.create(PERSISTENT_FAILED_RETRY_ALARM_NAME, {
            delayInMinutes: PERSISTENT_FAILED_RETRY_ALARM_PERIOD_MINUTES,
            periodInMinutes: PERSISTENT_FAILED_RETRY_ALARM_PERIOD_MINUTES
        })
        return true
    }
    catch {
        return false
    }
}

async function clearPersistentFailedRetryAlarm() {
    if(!browser.alarms?.clear) return false

    try {
        return await browser.alarms.clear(PERSISTENT_FAILED_RETRY_ALARM_NAME)
    }
    catch {
        return false
    }
}

async function runPersistentFailedRetryTick() {
    if(persistentRetryFailedPromise) return persistentRetryFailedPromise

    persistentRetryFailedPromise = (async () => {
        const stored = await metricStorageGet({
            [COORDINATOR_RETRY_FAILED_ENABLED_KEY]: false
        })
        if(!stored[COORDINATOR_RETRY_FAILED_ENABLED_KEY]) {
            clearPersistentFailedRetry()
            return {queued: 0, reason: 'disabled'}
        }

        const result = await retryCoordinatorFailedItems({
            maxItems: 1,
            retryLimit: 2
        }, {})

        const latest = await metricStorageGet({
            [COORDINATOR_RETRY_FAILED_ENABLED_KEY]: false
        })
        if(latest[COORDINATOR_RETRY_FAILED_ENABLED_KEY]) {
            await ensurePersistentFailedRetryAlarm()
            schedulePersistentFailedRetry(PERSISTENT_FAILED_RETRY_INTERVAL_MS)
        }

        return result
    })()
        .catch(error => {
            console.info('Mute Block persistent retry tick skipped', error)
            schedulePersistentFailedRetry(PERSISTENT_FAILED_RETRY_INTERVAL_MS)
            return {queued: 0, reason: 'retry-error'}
        })
        .finally(() => {
            persistentRetryFailedPromise = null
        })

    return persistentRetryFailedPromise
}

async function restoreCoordinatorPageForStoredWork(options = {}) {
    if(coordinatorStoredWorkRestorePromise) return coordinatorStoredWorkRestorePromise

    coordinatorStoredWorkRestorePromise = promiseWithTimeout(
        restoreCoordinatorPageForStoredWorkOnce(options),
        COORDINATOR_STORED_WORK_RESTORE_TIMEOUT_MS,
        'coordinator stored-work restore'
    )
        .catch(error => ({
            restored: false,
            reason: 'restore-timeout',
            timedOut: /timed out/i.test(error?.message || ''),
            error: error?.message || `${error || ''}`
        }))
        .finally(() => {
            coordinatorStoredWorkRestorePromise = null
        })

    return coordinatorStoredWorkRestorePromise
}

async function restoreCoordinatorPageForStoredWorkOnce(options = {}) {
    try {
        const recovery = await recoverStoredCoordinatorWork('coordinator-page-restore', {
            skipStoredWorkCheck: true
        })
        if(!recovery?.hasWork) {
            return {restored: false, reason: recovery?.reason || 'no-stored-work', recovery}
        }
        const coordinator = options.openDisplay === true
            ? await openCoordinatorPage({
                windowId: options.windowId || null
            }).catch(error => ({
                restored: false,
                reason: 'coordinator-open-error',
                error: error?.message || `${error || ''}`
            }))
            : null
        return {
            restored: recovery?.recovered === true,
            coordinator,
            coordinatorOpened: !!coordinator?.tabId,
            serviceWorkerRecoveryFirst: true,
            recovery
        }
    }
    catch(error) {
        console.info('Mute Block coordinator stored-work restore skipped', error)
        return {restored: false, reason: 'restore-error'}
    }
}

async function openCoordinatorPageOnce(options = {}) {
    const coordinatorUrl = getCoordinatorPageUrl()
    const existing = await dedupeCoordinatorTabs(coordinatorTabId)
    if(existing?.tabId) return maybeActivateCoordinatorTab(existing, options)

    const remembered = await getKnownCoordinatorTab(await getStoredCoordinatorTabId())
    if(remembered?.tabId) return maybeActivateCoordinatorTab(remembered, options)

    if(coordinatorTabId) {
        try {
            const tab = await browser.tabs.get(coordinatorTabId)
            if(!tab?.url || tab.url === coordinatorUrl) {
                await rememberCoordinatorTabId(tab.id)
                return maybeActivateCoordinatorTab({tabId: tab.id, windowId: tab.windowId || null, reused: true}, options)
            }
        }
        catch {
            await forgetCoordinatorTabId(coordinatorTabId)
        }
    }

    const createOptions = {
        url: coordinatorUrl,
        active: options.active === true
    }
    if(options.windowId) {
        createOptions.windowId = options.windowId
    }

    try {
        const tab = await browser.tabs.create(createOptions)
        await rememberCoordinatorTabId(tab.id)
        const deduped = await dedupeCoordinatorTabs(tab.id)
        return deduped ? {...deduped, reused: false} : {tabId: tab.id, windowId: tab.windowId || null, reused: false}
    }
    catch(error) {
        if(!createOptions.windowId) throw error
        const tab = await browser.tabs.create({
            url: coordinatorUrl,
            active: options.active === true
        })
        await rememberCoordinatorTabId(tab.id)
        const deduped = await dedupeCoordinatorTabs(tab.id)
        return deduped ? {...deduped, reused: false} : {tabId: tab.id, windowId: tab.windowId || null, reused: false}
    }
}

async function maybeActivateCoordinatorTab(coordinator = {}, options = {}) {
    if(options.active === true && coordinator?.tabId) {
        const tab = await browser.tabs.update(coordinator.tabId, {active: true}).catch(() => null)
        const windowId = tab?.windowId || coordinator.windowId || null
        if(windowId) {
            await browser.windows?.update?.(windowId, {focused: true}).catch(() => {})
        }
    }

    return coordinator
}

async function enqueueExistingExecutorForCoordinator(items = [], coordinator = {}, options = {}) {
    coordinatorExecutorStartPromise = coordinatorExecutorStartPromise
        .catch(() => {})
        .then(() => enqueueExistingExecutorForCoordinatorOnce(items, coordinator, options))

    return coordinatorExecutorStartPromise
}

function getQueuedActionNoForegroundFallback(item = null, options = {}) {
    if(item?.executorNoForegroundFallback === false || item?.noForegroundFallback === false) return false
    if(item?.executorNoForegroundFallback === true || item?.noForegroundFallback === true) return true
    return options.noForegroundFallback === true
}

function markQueuedTabExecutorActionPlanned(action = {}, decision = {}, reason = 'executor-open-planned') {
    return {
        ...action,
        executorPlanKind: 'open-tab',
        executorPlanReason: reason,
        executorPlanDecisionReason: decision?.reason || '',
        executorPlanCreatedAt: Date.now()
    }
}

async function planQueuedTabExecutorAction(action = {}, options = {}) {
    const openDecision = await promiseWithTimeout(
        shouldOpenQueuedTabAction(action, {
            currentAuthorityState: options.currentAuthorityState || options.authorityState || null
        }),
        QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,
        'queued tab open decision'
    ).catch(error => ({
        open: true,
        reason: 'open-decision-timeout',
        error: error?.message || `${error || ''}`
    }))
    if(!openDecision.open) return null

    return markQueuedTabExecutorActionPlanned(action, openDecision, 'executor-apply-phase')
}

async function validateQueuedTabOpenAgainstCurrentAuthority(action = {}) {
    const openDecision = await promiseWithTimeout(
        shouldOpenQueuedTabAction(action),
        QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,
        'queued tab final open decision'
    ).catch(error => ({
        open: true,
        reason: 'final-open-decision-timeout',
        error: error?.message || `${error || ''}`
    }))

    return openDecision
}

async function enqueueExistingExecutorForCoordinatorOnce(items = [], coordinator = {}, options = {}) {
    const serviceWorkerOwned = options.serviceWorkerOwned === true ||
        coordinator?.tabId === SERVICE_WORKER_QUEUE_OWNER_ID
    const ownerTabId = serviceWorkerOwned
        ? SERVICE_WORKER_QUEUE_OWNER_ID
        : coordinator?.tabId || null
    if(!ownerTabId) return {queued: 0}

    await ownedTabIdsReady
    await ensureProfileNukeProgressReady()
    await pruneQueuedTabActions(ownerTabId)

    pausedQueuedOwners.delete(ownerTabId)
    const includesUnblockUnmute = (items || []).some(item =>
        getCoordinatorActionKindForRequestedAction(
            item?.actionKind || getCoordinatorItemExecutorTabAction(item, options.tabAction)
        ) === UNBLOCK_UNMUTE_ACTION_KIND
    )
    const requiresForegroundExecutor = (items || []).some(item => {
        const tabAction = getCoordinatorItemExecutorTabAction(item, options.tabAction)
        const actionKind = getCoordinatorActionKindForRequestedAction(item?.actionKind || tabAction)
        return isForegroundQueuedTabAction(actionKind || tabAction) &&
            getQueuedActionNoForegroundFallback(item, options) !== true
    })
    queuedTabConcurrency = serviceWorkerOwned && (includesUnblockUnmute || requiresForegroundExecutor)
        ? 1
        : Math.max(1, Number.parseInt(options.maxConcurrent, 10) || 1)
    const ownerWindowId = serviceWorkerOwned
        ? null
        : coordinator.windowId || options.ownerWindowId || null

    const seen = new Set()
    const queuedActionKeys = collectQueuedTabActionKeys(ownerTabId)
    let queued = 0
    for(const item of items || []) {
        const tabAction = getCoordinatorItemExecutorTabAction(item, options.tabAction)
        const url = getCoordinatorItemOpenUrl(item)
        const normalizedHref = getCoordinatorItemHref(item)
        const coordinatorKey = getCoordinatorItemQueueKey(item)
        const actionSubjectKey = normalizedHref || coordinatorKey
        if(!url || !actionSubjectKey || seen.has(actionSubjectKey)) continue
        if(normalizedHref && isTerminalCoordinatorStatus(item?.status)) {
            await settleTerminalCoordinatorItemsLocked({profileHrefs: [normalizedHref]})
            continue
        }
        if(!normalizedHref && isTerminalCoordinatorStatus(item?.status)) continue

        seen.add(actionSubjectKey)
        const actionKey = getQueuedTabActionKey(ownerTabId, actionSubjectKey, tabAction)
        if(actionKey && queuedActionKeys.has(actionKey)) continue

        const requestedActionKind = getCoordinatorActionKindForRequestedAction(item?.actionKind || tabAction)
        const noForegroundFallback = getQueuedActionNoForegroundFallback(item, options)
        const plannedAction = await planQueuedTabExecutorAction({
            url,
            profileHref: normalizedHref || '',
            coordinatorKey,
            requestedUrl: normalizeCoordinatorRequestedUrl(item?.requestedUrl || url),
            resolutionMode: item?.resolutionMode || '',
            resolveProfileFromPage: item?.resolveProfileFromPage === true,
            resolutionReason: item?.resolutionReason || '',
            candidateConfidence: item?.candidateConfidence || '',
            candidateCollector: item?.candidateCollector || '',
            tabAction,
            actionKind: requestedActionKind,
            jobKey: item.jobKey || '',
            scope: item.scope || null,
            canonicalSubject: item.canonicalSubject || null,
            attempt: item.attempt || null,
            runId: item.runId || '',
            ownerTabId,
            ownerWindowId,
            noForegroundFallback,
            retryAttempt: 0,
            attemptId: getAttemptIdFromValue(item),
            attemptNumber: getAttemptNumberFromValue(item),
            maxRetries: STALE_QUEUED_TAB_MAX_RETRIES
        }, {
            currentAuthorityState: options.currentAuthorityState || null
        })
        if(!plannedAction) continue

        queuedTabActions.push(plannedAction)
        if(actionKey) queuedActionKeys.add(actionKey)
        queued += 1
    }

    void sweepOwnedBlockedProfileTabs(ownerTabId)
    const fillOptions = {
        pauseAlreadyChecked: options.pauseAlreadyChecked === true
    }
    if(options.awaitFill !== false) {
        await fillQueuedTabs(fillOptions)
    }
    else {
        void fillQueuedTabs(fillOptions)
    }
    return {queued}
}

async function shouldOpenQueuedTabAction(action = null, options = {}) {
    const normalizedHref = normalizeQuoraProfileUrl(action?.profileHref || action?.url || '')
    const coordinatorKey = action?.coordinatorKey || (normalizedHref ? normalizedHref : makeProfileResolutionQueueKey(action?.requestedUrl || action?.url || ''))
    if(!normalizedHref && !coordinatorKey) return {open: false, reason: 'invalid-target'}

    let queue = {}
    let progress = {}
    try {
        const currentAuthorityState = options.currentAuthorityState || options.authorityState || await loadCoordinatorCurrentAuthorityState()
        queue = currentAuthorityState.queue
        progress = currentAuthorityState.progress
    }
    catch {
        return {open: true, reason: 'queue-read-failed'}
    }

    const item = normalizedHref
        ? queue[normalizedHref] || queue[coordinatorKey] || null
        : queue[coordinatorKey] || null
    if(!item) return {open: false, reason: 'missing-coordinator-item'}

    const actionKind = getCoordinatorActionKindForRequestedAction(action?.actionKind || action?.tabAction || '')
    if(!shouldApplyProgressToCoordinatorItem(item, {actionKind})) {
        return {open: false, reason: 'action-kind-changed'}
    }

    if(hasMismatchedCoordinatorAttempt(item, action)) {
        return {open: false, reason: 'stale-attempt'}
    }

    const progressRecord = normalizedHref ? progress[normalizedHref] || null : null
    if(progressRecord &&
        isSuccessfulProfileNukeRecord(progressRecord) &&
        shouldApplyProgressToCoordinatorItem(item, progressRecord) &&
        !hasMismatchedCoordinatorAttempt(item, progressRecord)) {
        await syncSuccessfulCoordinatorProgress(normalizedHref, progressRecord)
        return {open: false, reason: 'successful-progress-record'}
    }

    if(isTerminalCoordinatorStatus(item.status)) {
        if(normalizedHref) {
            await settleTerminalCoordinatorItems({profileHrefs: [normalizedHref]})
        }
        return {open: false, reason: 'terminal-coordinator-item'}
    }

    return {open: true, reason: 'active-coordinator-item'}
}

async function transitionCoordinatorItemForQueuedTab(action = {}, tab = {}, details = {}) {
    const href = normalizeQuoraProfileUrl(action?.profileHref || action?.url || '')
    const coordinatorKey = action?.coordinatorKey || (href ? href : makeProfileResolutionQueueKey(action?.requestedUrl || action?.url || ''))
    if(!href && !coordinatorKey) return false

    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'transitionQueuedTabActive',
            reason: 'ordinaryMutation',
            action,
            tab,
            details,
            href,
            coordinatorKey
        })
    })
}

async function transitionCoordinatorItemForQueuedTabLocked(action = {}, tab = {}, details = {}, href = '', coordinatorKey = '') {
    const actionKind = getCoordinatorActionKindForRequestedAction(action?.actionKind || action?.tabAction || '')
    const now = Number.parseInt(details.openedAt, 10) || Date.now()
    const tabId = normalizeTabId(tab?.id)
    const metadata = getQueuedTabMetadata(tabId)
    if(metadata?.closeRequestedAt || metadata?.closeReason) return false

    const record = {
        profileHref: href,
        actionKind,
        status: 'tab-opening',
        runId: action?.runId || '',
        tabId: tab?.id || null,
        tabCreatedAt: now,
        tabOpenedAt: now,
        contentOpenedAt: 0,
        retryAttempt: Number.parseInt(details.retryAttempt, 10) || 0,
        attemptId: details.attemptId || '',
        attemptNumber: Number.parseInt(details.attemptNumber, 10) || 0,
        maxRetries: Number.parseInt(details.maxRetries, 10) || 0,
        ownerTabId: action?.ownerTabId || null,
        ownerWindowId: action?.ownerWindowId || null
    }
    const state = await loadCoordinatorQueueRunsProjection({
        metricPath: 'activeTransition.load'
    })
    let currentAuthorityState = normalizeCoordinatorAuthorityStateInput(state)
    const queue = currentAuthorityState.queue
    const runs = currentAuthorityState.runs
    const itemKey = href && queue[href] ? href : coordinatorKey
    const item = queue[itemKey]
    if(!item) return false
    if(!shouldApplyProgressToCoordinatorItem(item, record)) return false
    if(isTerminalCoordinatorStatus(item.status)) return false
    if(hasMismatchedCoordinatorAttempt(item, record)) {
        await recordStaleAttemptDiagnostic({
            profileHref: href,
            incomingAttemptId: getAttemptIdFromValue(record),
            expectedAttemptId: getAttemptIdFromValue(item),
            senderTabId: tab?.id || null,
            message: 'Ignored queued tab transition from stale attempt'
        })
        return false
    }
    const currentAttemptId = getAttemptIdFromValue(item)
    const currentAttemptNumber = getAttemptNumberFromValue(item)
    const incomingAttemptId = getAttemptIdFromValue(record)
    const incomingAttemptNumber = getAttemptNumberFromValue(record)
    if((currentAttemptId && !incomingAttemptId) || (currentAttemptNumber && !incomingAttemptNumber)) {
        await recordStaleAttemptDiagnostic({
            profileHref: href,
            incomingAttemptId,
            expectedAttemptId: currentAttemptId,
            senderTabId: tab?.id || null,
            message: 'Ignored queued tab transition without required attempt identity'
        })
        return false
    }

    const mapped = getCoordinatorStatusFromProgress(record)
    if(!mapped.status) return false

    const nextItem = transitionCoordinatorItemFromProgress(item, record, mapped, {
        now
    })
    if(JSON.stringify(nextItem) === JSON.stringify(item)) return true

    const latestMetadata = getQueuedTabMetadata(tabId)
    if(latestMetadata?.closeRequestedAt || latestMetadata?.closeReason) return false

    const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
    const itemCoordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
    const expectedAttemptId = currentAttemptId ? incomingAttemptId : ''
    const expectedAttemptNumber = currentAttemptNumber ? incomingAttemptNumber : 0
    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'active-transition',
        rowKey: itemKey,
        expectedAttemptId,
        expectedAttemptNumber,
        reason: 'ordinaryMutation',
        metricPath: 'activeTransition.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            const currentMetadata = getQueuedTabMetadata(tabId)
            if(currentMetadata?.closeRequestedAt || currentMetadata?.closeReason) {
                return context.reject('queued-tab-closing')
            }
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
            const transitionedItem = transitionCoordinatorItemFromProgress(currentItem, record, mapped, {
                now
            })
            return transitionedItem
        }
    })

    if(authorityResult?.accepted !== true || authorityResult?.durable !== true) return false
    currentAuthorityState = coordinatorAuthority.current()
    const nextQueue = currentAuthorityState.queue
    const durableItem = authorityResult.nextRow || nextQueue[itemKey] || nextItem
    const affectedRunIds = new Set()
    if(durableItem.runId) affectedRunIds.add(durableItem.runId)
    if(href) {
        for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
            affectedRunIds.add(runId)
        }
    }
    const nextRuns = affectedRunIds.size
        ? recomputeCoordinatorRuns(nextQueue, runs, affectedRunIds)
        : runs
    const runsChanged = affectedRunIds.size && JSON.stringify(nextRuns) !== JSON.stringify(runs)
    let derivedSaved = true
    try {
        derivedSaved = await saveCoordinatorState({
            runs: runsChanged ? nextRuns : undefined
        }, {
            queue: false,
            runs: runsChanged,
            reason: 'ordinaryMutation',
            queueOperation: 'active-transition-derived',
            queueChangedRows: 0
        })
    }
    catch(error) {
        derivedSaved = false
        recordCoordinatorDiagnosticEvent(
            'active-transition-derived-save-failed',
            error?.message || 'Active transition derived save failed'
        )
    }
    if(derivedSaved === false) {
        incrementQueueWakeupMetric('activeTransition.derivedSaveFailed')
        scheduleStoredWorkRepair(1000, {
            reason: 'active-transition-derived-save-failed',
            edgeTriggered: true
        })
    }

    return true
}

async function confirmQueuedTabDurablyActive(action = {}, tab = {}, details = {}) {
    const tabId = normalizeTabId(tab?.id)
    if(!tabId) return false

    const profileHref = normalizeQuoraProfileUrl(
        details.profileHref ||
        action.profileHref ||
        action.targetProfileHref ||
        action.url ||
        ''
    )
    const coordinatorKey = details.coordinatorKey || action.coordinatorKey || profileHref || ''
    const expectedAttemptId = getAttemptIdFromValue(details) || getAttemptIdFromValue(action)
    const expectedAttemptNumber = getAttemptNumberFromValue(details) || getAttemptNumberFromValue(action)
    const expectedActionKind = getCoordinatorActionKindForRequestedAction(
        details.actionKind || action.actionKind || action.tabAction || action.action || ''
    )
    if(!expectedAttemptId || !expectedAttemptNumber) return false

    const state = await loadCoordinatorQueueProjection().catch(() => null)
    const queue = state?.queue || {}
    const entry = coordinatorKey && queue[coordinatorKey]
        ? {key: coordinatorKey, item: queue[coordinatorKey]}
        : findCoordinatorQueueEntryForHref(queue, profileHref)
    const item = entry?.item || null
    const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(entry?.key || '')
    if(!item || !isActiveCoordinatorStatus(item.status)) return false
    if(profileHref && itemHref && itemHref !== profileHref) return false
    if(coordinatorKey && entry?.key && entry.key !== coordinatorKey && item.coordinatorKey !== coordinatorKey) return false
    if(normalizeTabId(item.tabId || item.activeTabId) !== tabId) return false
    if(expectedAttemptId && getAttemptIdFromValue(item) !== expectedAttemptId) return false
    if(expectedAttemptNumber && getAttemptNumberFromValue(item) !== expectedAttemptNumber) return false
    if(expectedActionKind && getCoordinatorActionKindForRequestedAction(item.actionKind || item.tabAction || '') !== expectedActionKind) return false

    markQueuedTabDurablyActive(tabId, 'targeted-row-check')
    return true
}

function shouldKeepQueuedTabOpenAfterActiveTransitionFailure(action = {}, tab = {}, details = {}) {
    const tabId = normalizeTabId(tab?.id)
    const profileHref = normalizeQuoraProfileUrl(
        action.profileHref ||
        action.targetProfileHref ||
        action.url ||
        ''
    )
    if(!tabId || !profileHref) return false

    const metadata = getQueuedTabMetadata(tabId)
    const record = profileNukeProgress?.[profileHref] || null
    if(!record || isTerminalProfileNukeRecord(record)) return false

    const expectedAttempt = {
        status: 'active',
        actionKind: getCoordinatorActionKindForRequestedAction(action?.actionKind || action?.tabAction || ''),
        attemptId: details.attemptId || getAttemptIdFromValue(action),
        attemptNumber: Number.parseInt(details.attemptNumber, 10) || getAttemptNumberFromValue(action)
    }
    if(hasMismatchedCoordinatorAttempt(expectedAttempt, record)) return false

    return hasActiveQueuedTabActionPhaseProgress(record, metadata)
}

async function rollbackFailedQueuedTabOpen(action = {}, tab = {}, details = {}) {
    const href = normalizeQuoraProfileUrl(action?.profileHref || action?.url || '')
    const coordinatorKey = action?.coordinatorKey || (href ? href : makeProfileResolutionQueueKey(action?.requestedUrl || action?.url || ''))
    if(!href && !coordinatorKey) return false

    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'rollbackFailedQueuedTabOpen',
            reason: 'repair',
            action,
            tab,
            details,
            href,
            coordinatorKey
        })
    })
}

async function getLiveProfileTabHrefs() {
    const tabsByHref = await getLiveProfileTabsByHref()
    return new Set(tabsByHref.keys())
}

async function getLiveProfileTabsByHref() {
    let tabs = []

    try {
        tabs = await browser.tabs.query({url: 'https://*.quora.com/*'})
    }
    catch {
        return new Map()
    }

    const tabsByHref = new Map()
    for(const tab of tabs) {
        const href = normalizeQuoraProfileUrl(tab?.url || '')
        if(!href) continue

        tabsByHref.set(href, [
            ...(tabsByHref.get(href) || []),
            tab
        ])
    }

    return tabsByHref
}

function getCoordinatorItemHref(item = {}) {
    return normalizeQuoraProfileUrl(item?.targetProfileHref || item?.requestedUrl || item?.dedupeKey || '')
}

function findCoordinatorQueueEntryForHref(queue = {}, href = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href)
    if(!normalizedHref) return null

    if(queue?.[normalizedHref]) {
        return {
            key: normalizedHref,
            item: queue[normalizedHref]
        }
    }

    for(const [key, item] of Object.entries(queue || {})) {
        const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(key)
        if(itemHref !== normalizedHref) continue

        return {
            key,
            item
        }
    }

    return null
}

function getCoordinatorExecutorTabActionForActionKind(actionKind = '') {
    return getExecutorTabActionForActionKind(actionKind)
}

function getCoordinatorActionKindForRequestedAction(action = '') {
    return getActionKindForRequestedAction(action)
}

function getCoordinatorItemExecutorTabAction(item = {}, fallbackAction = '') {
    return getQueueItemExecutorTabAction(item, fallbackAction)
}

function getCoordinatorItemExecutorMaxConcurrent(item = {}) {
    const maxConcurrent = Number.parseInt(item?.executorMaxConcurrent, 10)
    return Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 0
}

function getCoordinatorResumeMaxConcurrent(items = []) {
    const values = (items || [])
        .map(getCoordinatorItemExecutorMaxConcurrent)
        .filter(value => value > 0)

    if(values.length) return Math.max(...values)
    return Math.max(1, queuedTabConcurrency || 3)
}

function shouldResumeCoordinatorItem(item = null, liveProfileTabsByHref = new Map(), options = {}) {
    if(!item || typeof item !== 'object') return false
    if(!isCoordinatorQueueAuthoritativeItem(item)) return false
    if(isTerminalCoordinatorStatus(item.status)) return false

    const status = `${item.status || ''}`.trim()
    if(status === 'queued') return true
    if(!isActiveCoordinatorStatus(status)) return false

    const record = options.record || null
    if(hasConfirmedLiveRuntimeActorForCoordinatorItem(item, record, liveProfileTabsByHref)) return false

    const href = getCoordinatorItemHref(item)
    return !!href || isProfileResolutionItem(item)
}

function getLiveTabForCoordinatorItem(item = null, itemKey = '', liveProfileTabsByHref = new Map()) {
    const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
    if(!href) return null

    const candidates = liveProfileTabsByHref.get(href) || []
    if(!candidates.length) return null

    const itemTabId = normalizeTabId(item?.tabId)
    if(itemTabId) {
        const matchingTab = candidates.find(tab => normalizeTabId(tab?.id) === itemTabId)
        if(matchingTab) return matchingTab
    }

    return candidates.find(tab => tab?.active !== true) || candidates[0] || null
}

async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = '', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID) {
    const tabId = normalizeTabId(tab?.id)
    const profileHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
    const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
    if(!tabId || (!profileHref && !coordinatorKey)) return false

    const tabAction = getCoordinatorItemExecutorTabAction(item)
    const actionKind = getCoordinatorActionKindForRequestedAction(item?.actionKind || tabAction)
    const requestedUrl = normalizeCoordinatorRequestedUrl(item?.requestedUrl || tab?.url || profileHref)
    const attemptId = getAttemptIdFromValue(item)
    const attemptNumber = getAttemptNumberFromValue(item)
    const retryAttempt = Number.parseInt(item?.retryAttempt, 10) || 0
    const maxRetries = Number.parseInt(item?.maxRetries ?? item?.maxAttempts, 10) || STALE_QUEUED_TAB_MAX_RETRIES
    const openedAt = Date.now()
    const noForegroundFallback = getQueuedActionNoForegroundFallback(item)
    const metadata = {
        profileHref,
        coordinatorKey,
        requestedUrl,
        resolutionMode: item?.resolutionMode || '',
        resolveProfileFromPage: item?.resolveProfileFromPage === true,
        resolutionReason: item?.resolutionReason || '',
        candidateConfidence: item?.candidateConfidence || '',
        candidateCollector: item?.candidateCollector || '',
        ownerTabId,
        ownerWindowId: tab?.windowId || null,
        runId: item?.runId || '',
        tabAction,
        actionKind,
        jobKey: item?.jobKey || '',
        scope: item?.scope || null,
        canonicalSubject: item?.canonicalSubject || null,
        attempt: item?.attempt || null,
        noForegroundFallback,
        retryAttempt,
        attemptId,
        attemptNumber,
        maxRetries,
        openedAt,
        lastUrl: tab?.url || requestedUrl,
        reattachedAt: Date.now()
    }
    const pendingAction = {
        action: tabAction || null,
        targetUrl: profileHref || '',
        coordinatorKey,
        requestedUrl,
        resolutionMode: item?.resolutionMode || '',
        resolveProfileFromPage: item?.resolveProfileFromPage === true,
        resolutionReason: item?.resolutionReason || '',
        candidateConfidence: item?.candidateConfidence || '',
        candidateCollector: item?.candidateCollector || '',
        actionKind,
        jobKey: item?.jobKey || '',
        scope: item?.scope || null,
        canonicalSubject: item?.canonicalSubject || null,
        attempt: item?.attempt || null,
        runId: item?.runId || '',
        ownerTabId,
        ownerWindowId: tab?.windowId || null,
        noForegroundFallback,
        attemptId,
        attemptNumber
    }
    activeQueuedTabs.add(tabId)
    setQueuedTabMetadata(tabId, metadata)
    pendingTabActions.set(tabId, pendingAction)
    registerOwnedTab(ownerTabId, tabId)
    const activeTransitioned = await transitionCoordinatorItemForQueuedTab(pendingAction, tab, {
        retryAttempt,
        attemptId,
        attemptNumber,
        maxRetries,
        openedAt,
        refreshActiveAt: true
    }).catch(() => false)
    if(!activeTransitioned) {
        detachQueuedTabRuntimeState(tabId, 'resume-live-active-tab-transition-failed')
        scheduleStoredWorkRepair(1000, {reason: 'resume-live-active-tab-transition-failed'})
        return false
    }
    markQueuedTabDurablyActive(tabId, 'resume-live-active-tab')

    await promiseWithTimeout(
        ensureQueuedTabContentScript(tabId, 'resume-live-active-tab'),
        QUEUED_TAB_CONTENT_SCRIPT_ENSURE_TIMEOUT_MS,
        'resume live queued tab content script ensure'
    ).catch(() => null)

    if(await terminalizeAlreadyBlockedQueuedTab(tabId, 'resume-live-active-tab-already-blocked')) {
        return true
    }

    void nudgeQueuedTabActionClaimWithRetries(tabId, 'resume-live-active-tab')
    scheduleOwnedBlockedProfileSweep(ownerTabId, 4000)
    if(profileHref) {
        const itemStatus = `${item?.status || ''}`.trim()
        void recordCoordinatorJobProgress(profileHref, {
            ...(itemStatus === 'queued' ? {
            status: 'tab-opening',
            tabId,
            tabCreatedAt: Date.now(),
            tabOpenedAt: Date.now(),
            closeRequestedAt: 0,
            closedByExtension: false,
            closeReason: '',
            tabClosedAt: 0,
            slotReleasedAt: 0,
            finalError: '',
            errorPageUrl: ''
        } : {}),
        event: 'Reattached live queued tab after service worker restart',
        lastUrl: tab?.url || requestedUrl
    }, {senderTabId: tabId})
    }
    return true
}

async function terminalizeAlreadyBlockedQueuedTab(tabId, reason = 'already-blocked-queued-tab') {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return false

    const metadata = getQueuedTabMetadata(normalizedTabId)
    if(!metadata?.profileHref) return false
    if(`${metadata?.actionKind || metadata?.tabAction || ''}` === UNBLOCK_UNMUTE_ACTION_KIND) return false

    const response = await sendTabMessage(normalizedTabId, {
        action: 'close-if-blocked',
        actionKind: metadata?.actionKind || '',
        requestedProfileHref: metadata?.profileHref || '',
        attemptId: metadata?.attemptId || '',
        attemptNumber: metadata?.attemptNumber || 0
    })
    if(!response?.willClose) return false

    const recorded = await recordOwnedBlockedSweepTerminal(normalizedTabId, metadata, response)
    if(!recorded?.terminal) return false

    markQueuedTabClosing(normalizedTabId, reason)
    await releaseQueuedTabAndCleanup(normalizedTabId, {awaitFill: true})
    await browser.tabs.remove(normalizedTabId).catch(() => {})
    return true
}

async function resumeCoordinatorQueueExecution(coordinator = {}, options = {}) {
    if(coordinatorResumePromise) return coordinatorResumePromise

    coordinatorResumePromise = promiseWithTimeout(
        resumeCoordinatorQueueExecutionOnce(coordinator, options),
        COORDINATOR_RESUME_GATE_TIMEOUT_MS,
        'coordinator queue resume'
    )
        .catch(error => ({
            queued: 0,
            pending: 0,
            reason: 'resume-timeout',
            timedOut: /timed out/i.test(error?.message || ''),
            error: error?.message || `${error || ''}`
        }))
        .finally(() => {
            coordinatorResumePromise = null
        })

    return coordinatorResumePromise
}

function dropVolatileQueuedActionsForDurableResume(reason = 'resume-rebuild-from-durable-queue', details = {}) {
    const dropped = queuedTabActions.length
    if(!dropped) return 0
    if(getSchedulerBlockingQueuedExecutorCount() > 0) return 0

    const throttle = getQueueLoadThrottle()
    if(throttle?.active) return 0

    queuedTabActions.splice(0, queuedTabActions.length)
    incrementQueueWakeupMetric('pump.changed.droppedVolatileQueuedActions', dropped)
    pushQueueWakeupJournalEntry({
        kind: 'state-change',
        name: 'volatile-queued-actions-dropped',
        reason,
        result: 'state-changed',
        details: {
            dropped,
            ...details
        }
    })
    return dropped
}

async function runCoordinatorExecutorApplyPhase(reason = 'coordinator-executor-apply', options = {}) {
    const serviceWorkerOwned = options.serviceWorkerOwned === true
    const ownerTabId = options.ownerTabId || (serviceWorkerOwned ? SERVICE_WORKER_QUEUE_OWNER_ID : null)
    const ownerWindowId = serviceWorkerOwned ? null : options.ownerWindowId || null
    const metricPrefix = options.metricPrefix || 'reconcile.executor'
    const incrementMetric = (suffix, count = 1) => {
        if(metricPrefix && suffix) incrementQueueWakeupMetric(`${metricPrefix}.${suffix}`, count)
    }

    if(!ownerTabId) {
        incrementMetric('noop.noCoordinator')
        return {changed: false, queued: 0, pending: 0, adopted: 0, reason: 'no-coordinator'}
    }

    await ownedTabIdsReady
    await ensureProfileNukeProgressReady()
    await sweepStaleQueuedTabs()

    const pausedState = await metricStorageGet({[COORDINATOR_PAUSED_KEY]: false})
    if(pausedState[COORDINATOR_PAUSED_KEY]) {
        incrementMetric('noop.paused')
        return {changed: false, queued: 0, pending: 0, adopted: 0, paused: true, reason: 'coordinator-paused'}
    }

    const schedulerBlockingQueuedExecutors = getSchedulerBlockingQueuedExecutorCount()
    if(schedulerBlockingQueuedExecutors || queuedTabActions.length) {
        const queuedActionsBeforeFill = queuedTabActions.length
        const fillResult = await fillQueuedTabs({pauseAlreadyChecked: true})
        const activeAfterFill = getSchedulerBlockingQueuedExecutorCount()
        const runtimeActiveAfterFill = activeQueuedTabs.size
        if(activeAfterFill || fillResult?.throttled === true) {
            incrementMetric('noop.executorAlreadyRunning')
            return {
                changed: false,
                queued: 0,
                pending: queuedTabActions.length,
                active: activeAfterFill,
                runtimeActive: runtimeActiveAfterFill,
                paused: false,
                fillReason: fillResult?.reason || '',
                reason: 'executor-already-running'
            }
        }

        dropVolatileQueuedActionsForDurableResume(
            options.dropVolatileReason || `${reason || 'coordinator-executor'}-rebuild-from-durable-queue`,
            {
                queuedActionsBeforeFill,
                fillReason: fillResult?.reason || '',
                ...(options.dropVolatileSource ? {source: options.dropVolatileSource} : {})
            }
        )
    }

    const currentAuthorityState = await loadCoordinatorCurrentAuthorityState()
    const queue = currentAuthorityState.queue
    const progress = currentAuthorityState.progress
    const liveProfileTabsByHref = await getLiveProfileTabsByHref()
    const pendingItems = []
    let adopted = 0

    profileNukeProgress = progress

    for(const [itemKey, item] of Object.entries(queue)) {
        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
        if(!href && !coordinatorKey) continue
        const record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
        if(record && hasMismatchedCoordinatorAttempt(item, record)) continue

        if(isCoordinatorQueueAuthoritativeItem(item) && isActiveCoordinatorStatus(item?.status) && href) {
            const liveTab = await getTokenMatchedLiveOrPersistedTabForCoordinatorItem(item, record, itemKey, liveProfileTabsByHref)
            if(liveTab && await adoptLiveCoordinatorQueuedTab(item, itemKey, liveTab, ownerTabId)) {
                adopted += 1
                continue
            }
        }

        if(isActiveCoordinatorStatus(item?.status) && hasActiveQueuedTabActionPhaseProgress(record, item)) continue
        if(!shouldResumeCoordinatorItem(item, liveProfileTabsByHref, {record})) continue

        pendingItems.push({
            ...item,
            targetProfileHref: href || '',
            requestedUrl: normalizeCoordinatorRequestedUrl(item?.requestedUrl || href),
            dedupeKey: href || coordinatorKey,
            coordinatorKey,
            tabAction: getCoordinatorItemExecutorTabAction(item)
        })
    }

    if(!pendingItems.length) {
        if(adopted > 0) {
            await fillQueuedTabs({pauseAlreadyChecked: true})
            incrementMetric('changed.adoptedLiveTab', adopted)
            return {
                changed: true,
                queued: 0,
                pending: 0,
                adopted,
                active: activeQueuedTabs.size,
                paused: false,
                reason: 'reattached-live-active-tabs'
            }
        }
        incrementMetric('noop.noPendingItems')
        return {changed: false, queued: 0, pending: 0, adopted: 0, paused: false, reason: 'no-pending-items'}
    }

    const enqueueResult = await enqueueExistingExecutorForCoordinator(pendingItems, {
        tabId: ownerTabId,
        windowId: ownerWindowId
    }, {
        currentAuthorityState,
        maxConcurrent: getCoordinatorResumeMaxConcurrent(pendingItems),
        noForegroundFallback: pendingItems.every(item => item?.executorNoForegroundFallback === true),
        serviceWorkerOwned,
        awaitFill: options.awaitFill !== false,
        pauseAlreadyChecked: true
    })
    const queued = enqueueResult.queued || 0
    if(queued > 0 || adopted > 0) {
        if(options.queuedMetricSuffix) incrementMetric(options.queuedMetricSuffix, queued)
    }
    else if(options.noQueuedMetricSuffix) {
        incrementMetric(options.noQueuedMetricSuffix)
    }

    return {
        changed: queued > 0 || adopted > 0,
        queued,
        pending: pendingItems.length,
        adopted,
        paused: false,
        reason: options.enqueuedReason || 'started-persisted-coordinator-queue'
    }
}

async function kickCoordinatorQueueResume(reason = 'resume-request', options = {}) {
    const cycle = startQueueWakeupMetricCycle('pump', 'kickCoordinatorQueueResume', reason, {
        direct: options.direct === true
    })
    incrementQueueWakeupMetric('pump.requested')
    if(options.direct === true) incrementQueueWakeupMetric('pump.direct')
    if(!quoraRuntimeActivated && options.allowBeforeQuora !== true) {
        await ensureQuoraRuntimeActivatedForScheduler('resume-existing-quora-tab')
    }
    if(!quoraRuntimeActivated && options.allowBeforeQuora !== true) {
        incrementQueueWakeupMetric('pump.deferredBeforeQuora')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'quora-runtime-not-activated', {
            scheduledOnly: true,
            requiresQuoraVisit: true
        })
        return makeQuoraRuntimeNotActivatedResult('quora-runtime-not-activated')
    }

    const resumeScheduled = options.direct === true
        ? false
        : scheduleCoordinatorQueueResume(600, reason || 'resume-request')
    let alarmCreated = false
    if(resumeScheduled && browser.alarms?.create) {
        try {
            const alarmResult = browser.alarms.create(COORDINATOR_RESUME_ALARM_NAME, {
                when: coordinatorQueueResumeDueAt || Date.now() + 500
            })
            if(alarmResult?.then) await alarmResult
            alarmCreated = true
            incrementQueueWakeupMetric('pump.alarmScheduled')
        }
        catch {
            alarmCreated = false
        }
    }

    scheduleStoredWorkRepair(1000, {reason})
    if(options.direct !== true) {
        await pruneMissingQueuedTabRuntimeState('scheduled-resume-runtime-prune')
        finishQueueWakeupMetricCycle(cycle, 'no-op', `${reason || 'resume-request'}-scheduled`, {
            alarmCreated,
            resumeScheduled,
            scheduledOnly: true
        })
        return {
            recovered: false,
            reason: `${reason || 'resume-request'}-scheduled`,
            alarmCreated,
            fallbackScheduled: true,
            resumeScheduled,
            scheduledOnly: true
        }
    }

    const recovery = await runCoordinatorReconcileTick(reason, {
        direct: true,
        skipStoredWorkCheck: true,
        repairBeforeResume: options.repairBeforeResume
    }).catch(error => ({
        recovered: false,
        reason: 'resume-reconcile-error',
        error: error?.message || `${error || ''}`
    }))
    await pruneMissingQueuedTabRuntimeState('direct-resume-runtime-prune')

    finishQueueWakeupMetricCycle(cycle, recovery?.recovered ? 'state-changed' : 'no-op', recovery?.reason || reason || 'resume-request', {
        alarmCreated,
        hasWork: recovery?.hasWork === true,
        paused: recovery?.paused === true
    })

    return {
        ...recovery,
        alarmCreated,
        fallbackScheduled: true,
        reason: recovery?.reason || reason || 'resume-request'
    }
}

async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {}) {
    const cycle = startQueueWakeupMetricCycle('pump', 'resumeCoordinatorQueueExecutionOnce', options.reason || 'resume', {
        serviceWorkerOwned: options.serviceWorkerOwned === true
    })
    const serviceWorkerOwned = options.serviceWorkerOwned === true ||
        coordinator?.tabId === SERVICE_WORKER_QUEUE_OWNER_ID
    const existingCoordinator = serviceWorkerOwned
        ? {tabId: SERVICE_WORKER_QUEUE_OWNER_ID, windowId: null}
        : coordinator?.tabId
        ? coordinator
        : await dedupeCoordinatorTabs(coordinatorTabId)
    const ownerTabId = existingCoordinator?.tabId || null
    if(!ownerTabId) {
        incrementQueueWakeupMetric('pump.noop.noPendingItems')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'no-coordinator')
        return {queued: 0, pending: 0, reason: 'no-coordinator'}
    }

    if(!serviceWorkerOwned) {
        coordinatorTabId = ownerTabId
    }

    await ownedTabIdsReady
    await ensureProfileNukeProgressReady()
    await sweepStaleQueuedTabs()

    const pausedState = await metricStorageGet({[COORDINATOR_PAUSED_KEY]: false})
    if(pausedState[COORDINATOR_PAUSED_KEY]) {
        incrementQueueWakeupMetric('pump.noop.paused')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'coordinator-paused')
        return {queued: 0, pending: 0, reason: 'coordinator-paused'}
    }

    if(options.skipAuthorityReconcile !== true) {
        await runCoordinatorAuthorityReconcileActions(options.reason || 'resume-authority-reconcile', {
            actionBudget: options.actionBudget
        })
    }
    if(!options.skipRepair) {
        await repairCoordinatorStorageFromProgressBestEffort()
    }

    const applyResult = await runCoordinatorExecutorApplyPhase(options.reason || 'resume', {
        ownerTabId,
        ownerWindowId: serviceWorkerOwned ? null : existingCoordinator.windowId || null,
        metricPrefix: 'pump',
        dropVolatileReason: options.reason || 'resume-rebuild-from-durable-queue',
        serviceWorkerOwned,
        awaitFill: options.awaitFill !== false,
        enqueuedReason: serviceWorkerOwned
            ? 'resumed-persisted-service-worker-queue'
            : 'resumed-persisted-coordinator-queue'
    })

    if(applyResult.reason === 'executor-already-running') {
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'executor-already-running', {
            active: applyResult.active || 0,
            runtimeActive: applyResult.runtimeActive || 0,
            provisionalActive: Math.max(0, (applyResult.runtimeActive || 0) - (applyResult.active || 0)),
            queuedActions: queuedTabActions.length,
            fillReason: applyResult.fillReason || ''
        })
        return {
            queued: 0,
            pending: applyResult.pending || 0,
            active: applyResult.active || 0,
            reason: 'executor-already-running'
        }
    }

    if(applyResult.reason === 'coordinator-paused') {
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'coordinator-paused')
        return {queued: 0, pending: 0, reason: 'coordinator-paused'}
    }

    if(applyResult.queued > 0 || applyResult.adopted > 0) {
        finishQueueWakeupMetricCycle(cycle, 'state-changed', applyResult.reason, {
            queued: applyResult.queued || 0,
            pending: applyResult.pending || 0,
            adopted: applyResult.adopted || 0
        })
    }
    else {
        finishQueueWakeupMetricCycle(cycle, 'no-op', applyResult.reason, {
            pending: applyResult.pending || 0,
            adopted: applyResult.adopted || 0
        })
    }

    return {
        queued: applyResult.queued || 0,
        pending: applyResult.pending || 0,
        active: applyResult.active,
        adopted: applyResult.adopted || 0,
        reason: applyResult.reason
    }
}

async function runCoordinatorReconcileExecutorActions(reason = 'reconcile-executor-actions', options = {}) {
    return runCoordinatorExecutorApplyPhase(reason, {
        ownerTabId: SERVICE_WORKER_QUEUE_OWNER_ID,
        ownerWindowId: null,
        serviceWorkerOwned: true,
        metricPrefix: 'reconcile.executor',
        dropVolatileReason: `${reason || 'reconcile'}-rebuild-from-durable-queue`,
        dropVolatileSource: 'runCoordinatorReconcileExecutorActions',
        queuedMetricSuffix: 'changed.queued',
        noQueuedMetricSuffix: 'noop.noQueuedItems',
        enqueuedReason: 'reconcile-started-persisted-service-worker-queue',
        awaitFill: options.awaitFill !== false
    })
}

function nextCoordinatorPauseGeneration() {
    coordinatorPauseGeneration += 1
    return coordinatorPauseGeneration
}

function isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration = 0) {
    const generation = Number.parseInt(pauseGeneration, 10) || 0
    return !!generation &&
        coordinatorPauseRequested === true &&
        generation === coordinatorPauseGeneration
}

async function isCoordinatorPauseGenerationCurrent(pauseGeneration = 0) {
    const generation = Number.parseInt(pauseGeneration, 10) || 0
    if(!isCoordinatorPauseGenerationLocallyCurrent(generation)) return false

    const stored = await metricStorageGet({
        [COORDINATOR_PAUSED_KEY]: false,
        [COORDINATOR_PAUSE_GENERATION_KEY]: 0
    })
    const storedGeneration = Number.parseInt(stored[COORDINATOR_PAUSE_GENERATION_KEY], 10) || 0
    return stored[COORDINATOR_PAUSED_KEY] === true &&
        storedGeneration === generation &&
        coordinatorPauseGeneration === generation
}

async function restoreLatestCoordinatorPauseGenerationIfStale(pauseGeneration = 0) {
    const generation = Number.parseInt(pauseGeneration, 10) || 0
    if(!generation || generation === coordinatorPauseGeneration) return false

    const stored = await metricStorageGet({
        [COORDINATOR_PAUSED_KEY]: false,
        [COORDINATOR_PAUSE_GENERATION_KEY]: 0
    })
    const storedGeneration = Number.parseInt(stored[COORDINATOR_PAUSE_GENERATION_KEY], 10) || 0
    if(storedGeneration !== generation) return false

    await setCoordinatorPauseControlState(coordinatorPauseRequested === true, coordinatorPauseGeneration, 'ordinaryMutation')
    return true
}

function scheduleCoordinatorPauseStateRepair(reason = 'pause-generation-repair') {
    setTimeout(() => {
        void setCoordinatorPauseControlState(
            coordinatorPauseRequested === true,
            coordinatorPauseGeneration,
            'repair'
        ).catch(() => null)

        if(coordinatorPauseRequested !== true) {
            void setCoordinatorRunsPaused(false).catch(() => null)
            void kickCoordinatorQueueResume(reason).catch(() => null)
        }
    }, 0)
}

async function pauseCoordinatorNukesCleanup(pauseGeneration = coordinatorPauseGeneration) {
    if(!await isCoordinatorPauseGenerationCurrent(pauseGeneration)) {
        return {paused: false, stalePause: true, pausedUrls: [], ownedTabIds: []}
    }

    const results = []
    const storedResult = await pauseStoredCoordinatorWork({
        reason: 'coordinator-pause-request',
        pauseGeneration
    })
    if(!await isCoordinatorPauseGenerationCurrent(pauseGeneration)) {
        return {paused: false, stalePause: true, pausedUrls: [], ownedTabIds: []}
    }

    results.push(await stopOwnerNukes(SERVICE_WORKER_QUEUE_OWNER_ID, {
        closeOwnedTabs: true,
        reason: 'service-worker-coordinator-pause-request',
        shouldContinue: () => isCoordinatorPauseGenerationCurrent(pauseGeneration),
        shouldContinueSync: () => isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration)
    }))
    if(!await isCoordinatorPauseGenerationCurrent(pauseGeneration)) {
        return {paused: false, stalePause: true, pausedUrls: [], ownedTabIds: []}
    }

    if(coordinatorTabId) {
        results.push(await stopOwnerNukes(coordinatorTabId, {
            closeOwnedTabs: true,
            reason: 'coordinator-pause-request',
            shouldContinue: () => isCoordinatorPauseGenerationCurrent(pauseGeneration),
            shouldContinueSync: () => isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration)
        }))
    }
    if(!await isCoordinatorPauseGenerationCurrent(pauseGeneration)) {
        return {paused: false, stalePause: true, pausedUrls: [], ownedTabIds: []}
    }

    const ownedTabIds = Array.from(new Set([
        ...(storedResult.ownedTabIds || []),
        ...results.flatMap(result => result.ownedTabIds || [])
    ]))
    if(!isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration) ||
        !await isCoordinatorPauseGenerationCurrent(pauseGeneration)) {
        return {paused: false, stalePause: true, pausedUrls: [], ownedTabIds: []}
    }
    for(const tabId of ownedTabIds) {
        if(!tabId) continue
        if(!isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration)) {
            return {paused: false, stalePause: true, pausedUrls: [], ownedTabIds: []}
        }
        markQueuedTabClosing(tabId, 'coordinator-pause-request')
        try {
            await browser.tabs.remove(tabId)
        }
        catch {}
    }

    return {
        paused: true,
        pausedUrls: Array.from(new Set([
            ...(storedResult.pausedUrls || []),
            ...results.flatMap(result => result.canceledUrls || [])
        ])),
        ownedTabIds
    }
}

async function pauseCoordinatorNukes() {
    const pauseGeneration = nextCoordinatorPauseGeneration()
    coordinatorPauseRequested = true
    await setCoordinatorPauseControlState(true, pauseGeneration, 'ordinaryMutation')
    const cleanup = await pauseCoordinatorNukesCleanup(pauseGeneration)

    return {
        paused: cleanup.paused !== false && cleanup.stalePause !== true,
        pauseGeneration,
        scheduled: false,
        pausedUrls: cleanup.pausedUrls || [],
        ownedTabIds: cleanup.ownedTabIds || [],
        stalePause: cleanup.stalePause === true
    }
}

async function resumePausedCoordinatorNukes() {
    const pauseGeneration = nextCoordinatorPauseGeneration()
    coordinatorPauseRequested = false
    await setCoordinatorPauseControlState(false, pauseGeneration, 'ordinaryMutation')
    void setCoordinatorRunsPaused(false).catch(() => null)
    pausedQueuedOwners.delete(SERVICE_WORKER_QUEUE_OWNER_ID)
    if(coordinatorTabId) pausedQueuedOwners.delete(coordinatorTabId)
    return kickCoordinatorQueueResume('dashboard-resume', {direct: true})
}

async function cancelCoordinatorCurrentWork() {
    const results = []
    const storedResult = await cancelStoredCoordinatorWork({
        reason: 'current-work-cancel-request'
    })

    results.push(await stopOwnerNukes(SERVICE_WORKER_QUEUE_OWNER_ID, {
        closeOwnedTabs: true,
        reason: 'current-work-cancel-request'
    }))

    if(coordinatorTabId) {
        results.push(await stopOwnerNukes(coordinatorTabId, {
            closeOwnedTabs: true,
            reason: 'current-work-cancel-request'
        }))
    }

    const ownedTabIds = Array.from(new Set([
        ...(storedResult.ownedTabIds || []),
        ...results.flatMap(result => result.ownedTabIds || [])
    ]))
    for(const tabId of ownedTabIds) {
        if(!tabId) continue
        markQueuedTabClosing(tabId, 'current-work-cancel-request')
        try {
            await browser.tabs.remove(tabId)
        }
        catch {}
    }

    const pauseGeneration = nextCoordinatorPauseGeneration()
    coordinatorPauseRequested = false
    await setCoordinatorPauseControlState(false, pauseGeneration, 'ordinaryMutation')
    await pruneMissingQueuedTabRuntimeState('cancel-current-work-runtime-prune')

    return {
        canceledUrls: Array.from(new Set([
            ...(storedResult.canceledUrls || []),
            ...results.flatMap(result => result.canceledUrls || [])
        ])),
        canceledWorkKeys: storedResult.canceledWorkKeys || [],
        ownedTabIds
    }
}

async function setCoordinatorRunsPaused(paused = false) {
    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'setCoordinatorRunsPaused',
            reason: 'ordinaryMutation',
            paused: !!paused
        })
    })
}

async function setCoordinatorPauseControlState(paused = false, pauseGeneration = 0, reason = 'ordinaryMutation') {
    return mutateCoordinatorProjection({
        kind: 'setPauseState',
        reason,
        paused: !!paused,
        pauseGeneration
    })
}

async function mutateCoordinatorPauseStateSet(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(snapshotReason !== 'ordinaryMutation' && snapshotReason !== 'repair') {
        return {changed: false, reason: 'invalid-reason'}
    }

    const pauseGeneration = Number.parseInt(operation.pauseGeneration, 10) || 0
    const payload = {
        [COORDINATOR_PAUSED_KEY]: operation.paused === true
    }
    if(pauseGeneration) {
        payload[COORDINATOR_PAUSE_GENERATION_KEY] = pauseGeneration
    }

    await metricStorageSet(payload, {
        snapshotWriteReason: snapshotReason
    })

    return {
        changed: true,
        paused: operation.paused === true,
        pauseGeneration
    }
}

function buildPausedCoordinatorQueueItem(item = {}, now = Date.now(), reason = 'coordinator-pause-request') {
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

async function pauseStoredCoordinatorWork(options = {}) {
    const reason = `${options.reason || 'coordinator-pause-request'}`.trim()
    const pauseGeneration = Number.parseInt(options.pauseGeneration, 10) || 0
    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'pauseStoredWork',
            reason: 'ordinaryMutation',
            pauseReason: reason,
            pauseGeneration
        })
    })
}

async function cancelStoredCoordinatorWork(options = {}) {
    const reason = `${options.reason || 'coordinator-pause-request'}`.trim()
    const coordinatorKey = `${options.coordinatorKey || ''}`.trim()
    const storageKey = `${options.storageKey || ''}`.trim()
    const profileHref = normalizeQuoraProfileUrl(options.profileHref || '')
    const hasTarget = !!(coordinatorKey || storageKey || profileHref)
    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: hasTarget ? 'cancelStoredWorkItem' : 'cancelStoredWork',
            reason: 'ordinaryMutation',
            cancelReason: reason,
            coordinatorKey,
            storageKey,
            profileHref
        })
    })
}

async function cancelCoordinatorCurrentWorkItem(request = {}) {
    const storedResult = await cancelStoredCoordinatorWork({
        reason: 'current-work-item-cancel-request',
        coordinatorKey: request.coordinatorKey || '',
        storageKey: request.storageKey || '',
        profileHref: request.profileHref || ''
    })

    const ownedTabIds = Array.from(new Set(storedResult.ownedTabIds || []))
    for(const tabId of ownedTabIds) {
        if(!tabId) continue
        markQueuedTabClosing(tabId, 'current-work-item-cancel-request')
        try {
            await browser.tabs.remove(tabId)
        }
        catch {}
    }

    await pruneMissingQueuedTabRuntimeState('cancel-current-work-item-runtime-prune')

    return {
        canceledUrls: storedResult.canceledUrls || [],
        canceledWorkKeys: storedResult.canceledWorkKeys || [],
        ownedTabIds,
        reason: storedResult.reason || ''
    }
}

function buildTerminalCoordinatorQueueItem(item = {}, options = {}) {
    const now = Number.parseInt(options.now, 10) || Date.now()
    const status = `${options.status || 'failed'}`.trim()
    const reason = `${options.reason || ''}`.trim()
    const eventType = options.eventType ||
        (status === 'canceled' ? JOB_EVENT_PAUSE : JOB_EVENT_TERMINAL)
    const reduced = reduceJobEvent(item, {
        type: eventType,
        status,
        outcome: options.outcome || (status === 'canceled' ? 'paused' : 'timeout'),
        error: options.error || (status === 'canceled' ? 'Paused by user' : 'Queued tab closed before reaching a terminal state'),
        at: now,
        terminalAt: now,
        reason,
        milestones: {
            closeRequestedAt: Number.parseInt(item?.milestones?.closeRequestedAt, 10) || now,
            tabClosedAt: now
        }
    })

    return reduced.accepted ? reduced.item : {
        ...item,
        status,
        outcome: `${options.outcome || (status === 'canceled' ? 'paused' : 'timeout')}`.trim(),
        error: `${options.error || (status === 'canceled' ? 'Paused by user' : 'Queued tab closed before reaching a terminal state')}`.trim(),
        updatedAt: now,
        terminalAt: now,
        actionLease: null,
        actionLeaseReleasedAt: now,
        actionLeaseReleaseReason: reason,
        tabId: null,
        milestones: {
            ...makeEmptyCoordinatorMilestones(),
            ...(item.milestones || {}),
            closeRequestedAt: Number.parseInt(item?.milestones?.closeRequestedAt, 10) || now,
            tabClosedAt: now
        }
    }
}

async function terminalizeCoordinatorKeyOnlyItem(coordinatorKey = '', options = {}) {
    const key = `${coordinatorKey || ''}`.trim()
    if(!key) return {changed: false, reason: 'missing-coordinator-key'}

    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'terminalizeKeyOnlyCoordinatorItem',
            reason: 'repair',
            coordinatorKey: key,
            terminalOptions: options
        })
    })
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

function isCoordinatorRepairEdgeTriggerReason(reason = '') {
    const normalized = `${reason || ''}`.trim()
    return /^(?:startup.*|content-ready.*|post-enqueue.*|dashboard-.*|manual|repair-request.*|terminal-.*|tab-removed|active-transition-.*|claim-durable-confirmation-failed|queued-tab-(?:open-failed|fill-error)|.*(?:timeout|mismatch|runtime).*)$/i.test(normalized)
}

function clearNamedSchedulerAlarm(name = '') {
    if(!name || !browser.alarms?.clear) return

    try {
        const clearResult = browser.alarms.clear(name)
        if(clearResult?.catch) clearResult.catch(() => false)
    }
    catch {}
}

function getSchedulerAlarmScheduledTime(alarm = null) {
    return Number.parseInt(alarm?.scheduledTime, 10) || 0
}

function isSchedulerAlarmScheduledForDueAt(scheduledTime = 0, dueAt = 0) {
    return !!scheduledTime &&
        !!dueAt &&
        Math.abs(scheduledTime - dueAt) <= SCHEDULER_ALARM_TIME_TOLERANCE_MS
}

function suppressStaleCoordinatorResumeAlarm(dueAt = 0) {
    coordinatorQueueResumeClearedAlarmDueAt = Number.parseInt(dueAt, 10) || coordinatorQueueResumeClearedAlarmDueAt || 0
    coordinatorQueueResumeAlarmSuppressUntil = Date.now() + STALE_SCHEDULER_ALARM_SUPPRESSION_MS
    clearNamedSchedulerAlarm(COORDINATOR_RESUME_ALARM_NAME)
}

function suppressStaleStoredWorkRepairAlarm(dueAt = 0) {
    storedWorkRepairClearedAlarmDueAt = Number.parseInt(dueAt, 10) || storedWorkRepairClearedAlarmDueAt || 0
    storedWorkRepairAlarmSuppressUntil = Date.now() + STALE_SCHEDULER_ALARM_SUPPRESSION_MS
    clearNamedSchedulerAlarm(COORDINATOR_STORED_WORK_REPAIR_ALARM_NAME)
}

function isSuppressedStaleCoordinatorResumeAlarm(alarm = null) {
    const scheduledTime = getSchedulerAlarmScheduledTime(alarm)
    if(coordinatorQueueResumeDueAt && scheduledTime) {
        return !isSchedulerAlarmScheduledForDueAt(scheduledTime, coordinatorQueueResumeDueAt)
    }
    if(coordinatorQueueResumeDueAt) return false
    if(scheduledTime && coordinatorQueueResumeClearedAlarmDueAt) {
        return isSchedulerAlarmScheduledForDueAt(scheduledTime, coordinatorQueueResumeClearedAlarmDueAt)
    }

    return coordinatorQueueResumeAlarmSuppressUntil > Date.now()
}

function isSuppressedStaleStoredWorkRepairAlarm(alarm = null) {
    const scheduledTime = getSchedulerAlarmScheduledTime(alarm)
    if(storedWorkRepairDueAt && scheduledTime) {
        return !isSchedulerAlarmScheduledForDueAt(scheduledTime, storedWorkRepairDueAt)
    }
    if(storedWorkRepairDueAt) return false
    if(scheduledTime && storedWorkRepairClearedAlarmDueAt) {
        return isSchedulerAlarmScheduledForDueAt(scheduledTime, storedWorkRepairClearedAlarmDueAt)
    }

    return storedWorkRepairAlarmSuppressUntil > Date.now()
}

function resetStoredWorkRepairBackoff(reason = 'repair-edge-trigger') {
    if(!storedWorkRepairBackoffLevel && !storedWorkRepairBackoffUntil) return
    storedWorkRepairBackoffLevel = 0
    storedWorkRepairBackoffUntil = 0
    incrementQueueWakeupMetric('repair.backoffReset')
}

function recordStoredWorkRepairNoopBackoff() {
    storedWorkRepairBackoffLevel = Math.min(6, storedWorkRepairBackoffLevel + 1)
    const delayMs = Math.min(
        STORED_WORK_REPAIR_BACKOFF_MAX_MS,
        STORED_WORK_REPAIR_BACKOFF_BASE_MS * (2 ** Math.max(0, storedWorkRepairBackoffLevel - 1))
    )
    storedWorkRepairBackoffUntil = Date.now() + delayMs
    recordQueueWakeupMetricMax('repair.backoffLevel.max', storedWorkRepairBackoffLevel)
    recordQueueWakeupMetricMax('repair.backoffDelay.maxMs', delayMs)
}

function hasStoredWorkRepairBackoff(now = Date.now()) {
    return storedWorkRepairBackoffUntil > now
}

function scheduleStoredWorkRepair(delayMs = STORED_WORK_REPAIR_INTERVAL_MS, options = {}) {
    if(!quoraRuntimeActivated && options.allowBeforeQuora !== true) {
        incrementQueueWakeupMetric('repair.deferredBeforeQuora')
        return false
    }

    const reason = `${options.reason || 'stored-work-repair'}`.trim()
    const edgeTriggered = options.edgeTriggered === true || isCoordinatorRepairEdgeTriggerReason(reason)
    if(edgeTriggered) {
        incrementQueueWakeupMetric('repair.edgeTriggered')
        resetStoredWorkRepairBackoff(reason)
    }

    const now = Date.now()
    const requestedDelayMs = Math.max(1000, Number.parseInt(delayMs, 10) || STORED_WORK_REPAIR_INTERVAL_MS)
    let dueAt = now + requestedDelayMs
    if(!edgeTriggered && hasStoredWorkRepairBackoff(now) && dueAt < storedWorkRepairBackoffUntil) {
        incrementQueueWakeupMetric('repair.suppressedBackoff')
        dueAt = storedWorkRepairBackoffUntil
    }

    if(storedWorkRepairTimeout && storedWorkRepairDueAt && storedWorkRepairDueAt <= dueAt) {
        incrementQueueWakeupMetric('repair.coalesced')
        return false
    }

    if(storedWorkRepairTimeout) {
        clearTimeout(storedWorkRepairTimeout)
        storedWorkRepairTimeout = null
    }
    storedWorkRepairDueAt = dueAt
    incrementQueueWakeupMetric('repair.requested')
    incrementQueueWakeupMetric('reconcile.deadlineUpdated')
    recordQueueWakeupMetricMax('scheduler.pendingDeadlineMs', Math.max(0, dueAt - now))

    const scheduledDueAt = dueAt
    storedWorkRepairTimeout = setTimeout(() => {
        if(storedWorkRepairDueAt !== scheduledDueAt) {
            incrementQueueWakeupMetric('repair.timeoutStale')
            return
        }
        storedWorkRepairTimeout = null
        storedWorkRepairDueAt = 0
        suppressStaleStoredWorkRepairAlarm(scheduledDueAt)
        void runStoredWorkRepairTick('scheduled-stored-work-repair')
    }, Math.max(0, dueAt - Date.now()))

    if(browser.alarms?.create) {
        try {
            const alarmResult = browser.alarms.create(COORDINATOR_STORED_WORK_REPAIR_ALARM_NAME, {when: dueAt})
            incrementQueueWakeupMetric('repair.alarmScheduled')
            if(alarmResult?.catch) alarmResult.catch(() => null)
        }
        catch {}
    }

    return true
}

function scheduleCoordinatorQueueResume(delayMs = 500, reason = 'scheduled-resume') {
    const normalizedDelayMs = Math.max(100, Number.parseInt(delayMs, 10) || 500)
    const dueAt = Date.now() + normalizedDelayMs
    const normalizedReason = `${reason || 'scheduled-resume'}`.trim() || 'scheduled-resume'
    if(coordinatorQueueResumeTimeout && coordinatorQueueResumeDueAt && coordinatorQueueResumeDueAt <= dueAt) {
        incrementQueueWakeupMetric('pump.coalesced')
        return false
    }

    if(coordinatorQueueResumeTimeout) {
        clearTimeout(coordinatorQueueResumeTimeout)
        coordinatorQueueResumeTimeout = null
    }

    coordinatorQueueResumeDueAt = dueAt
    coordinatorQueueResumeReason = normalizedReason
    incrementQueueWakeupMetric('reconcile.deadlineUpdated')
    recordQueueWakeupMetricMax('scheduler.pendingDeadlineMs', Math.max(0, dueAt - Date.now()))
    const scheduledDueAt = dueAt
    coordinatorQueueResumeTimeout = setTimeout(() => {
        if(coordinatorQueueResumeDueAt !== scheduledDueAt) {
            incrementQueueWakeupMetric('pump.timeoutStale')
            return
        }
        suppressStaleCoordinatorResumeAlarm(scheduledDueAt)
        void runScheduledCoordinatorQueueResume().catch(() => null)
    }, Math.max(0, dueAt - Date.now()))
    return true
}

async function runScheduledCoordinatorQueueResume(reason = '') {
    const resumeReason = `${reason || coordinatorQueueResumeReason || 'scheduled-resume'}`.trim()
    if(coordinatorQueueResumeTimeout) {
        clearTimeout(coordinatorQueueResumeTimeout)
    }
    coordinatorQueueResumeTimeout = null
    coordinatorQueueResumeDueAt = 0
    coordinatorQueueResumeReason = ''

    return runCoordinatorReconcileTick(resumeReason).catch(error => {
        scheduleStoredWorkRepair(1000, {
            reason: 'scheduled-reconcile-error',
            edgeTriggered: true
        })
        return {
            recovered: false,
            reason: 'scheduled-reconcile-error',
            error: error?.message || `${error || ''}`
        }
    })
}

async function runCoordinatorReconcileTick(reason = 'coordinator-reconcile', options = {}) {
    if(coordinatorReconcilePromise) {
        return coordinatorReconcilePromise.then(result => ({
            ...(result || {}),
            coalesced: true
        }))
    }

    coordinatorReconcilePromise = runCoordinatorReconcileTickOnce(reason, options)
        .finally(() => {
            coordinatorReconcilePromise = null
        })

    return coordinatorReconcilePromise
}

async function runCoordinatorReconcileTickOnce(reason = 'coordinator-reconcile', options = {}) {
    const cycle = startQueueWakeupMetricCycle('reconcile', 'runCoordinatorReconcileTick', reason, {
        direct: options.direct === true,
        repairBeforeResume: options.repairBeforeResume !== false
    })
    incrementQueueWakeupMetric('reconcile.requested')

    if(!quoraRuntimeActivated && options.allowBeforeQuora !== true) {
        await ensureQuoraRuntimeActivatedForScheduler('reconcile-existing-quora-tab')
    }
    if(!quoraRuntimeActivated && options.allowBeforeQuora !== true) {
        incrementQueueWakeupMetric('reconcile.deferredBeforeQuora')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'quora-runtime-not-activated', {
            scheduledOnly: true,
            requiresQuoraVisit: true
        })
        return makeQuoraRuntimeNotActivatedResult('quora-runtime-not-activated')
    }

    let before = null
    let after = null
    let prunedRuntime = 0
    let authority = null
    let executor = null
    try {
        before = await observeCoordinatorReconcileSnapshot(reason, {
            rowBudget: options.rowBudget
        })
        prunedRuntime = await pruneMissingQueuedTabRuntimeState('reconcile-runtime-prune')
        if(prunedRuntime > 0) incrementQueueWakeupMetric('reconcile.changed.runtimePruned', prunedRuntime)
        authority = await runCoordinatorAuthorityReconcileActions(reason, {
            actionBudget: options.actionBudget
        })

        const result = await recoverStoredCoordinatorWorkOnce(reason, {
            ...options,
            repairBeforeResume: options.repairBeforeResume !== false,
            fromReconcileTick: true,
            skipResume: true
        })
        executor = result?.hasWork && !result?.paused
            ? await runCoordinatorReconcileExecutorActions(reason, {
                awaitFill: options.awaitFill !== false
            })
            : {changed: false, queued: 0, pending: 0, adopted: 0, reason: result?.reason || 'no-stored-work'}
        const prunedAfterExecutor = await pruneMissingQueuedTabRuntimeState('reconcile-post-executor-runtime-prune')
        if(prunedAfterExecutor > 0) {
            prunedRuntime += prunedAfterExecutor
            incrementQueueWakeupMetric('reconcile.changed.runtimePruned', prunedAfterExecutor)
        }
        after = await observeCoordinatorReconcileSnapshot(reason, {
            rowBudget: options.rowBudget
        })

        const repair = result?.repair || {}
        const changed = result?.recovered === true ||
            prunedRuntime > 0 ||
            authority?.changed === true ||
            executor?.changed === true ||
            repair.queueChanged ||
            repair.repaired ||
            repair.runsChanged ||
            repair.progressChanged ||
            repair.pendingPostsChanged ||
            before?.durableActiveRows !== after?.durableActiveRows ||
            before?.durableQueuedRows !== after?.durableQueuedRows ||
            before?.durableTerminalRows !== after?.durableTerminalRows ||
            before?.activeQueuedTabs !== after?.activeQueuedTabs ||
            before?.queuedTabActions !== after?.queuedTabActions

        if(changed) incrementQueueWakeupMetric('reconcile.changed')
        else incrementQueueWakeupMetric('reconcile.noop')
        if((after?.hasStoredWork && !after?.paused) || authority?.budgetExhausted === true) {
            incrementQueueWakeupMetric('reconcile.rescheduled')
            scheduleStoredWorkRepair(STORED_WORK_REPAIR_INTERVAL_MS, {
                reason: authority?.budgetExhausted === true
                    ? 'reconcile-authority-budget-exhausted'
                    : 'reconcile-has-stored-work'
            })
        }

        finishQueueWakeupMetricCycle(cycle, changed ? 'state-changed' : 'no-op', result?.reason || reason, {
            prunedRuntime,
            authorityActions: authority?.actions || 0,
            authorityAdopted: authority?.adopted || 0,
            authorityRequeued: authority?.requeued || 0,
            authorityFailed: authority?.failed || 0,
            authorityRuntimeDetached: authority?.runtimeDetached || 0,
            authorityRuntimeClosed: authority?.runtimeClosed || 0,
            authorityBudgetExhausted: authority?.budgetExhausted === true,
            executorQueued: executor?.queued || 0,
            executorPending: executor?.pending || 0,
            executorAdopted: executor?.adopted || 0,
            executorReason: executor?.reason || '',
            beforeDurableActiveWithoutActor: before?.durableActiveWithoutActor || 0,
            afterDurableActiveWithoutActor: after?.durableActiveWithoutActor || 0,
            beforeProvisionalActorWithoutDurable: before?.provisionalActorWithoutDurable || 0,
            afterProvisionalActorWithoutDurable: after?.provisionalActorWithoutDurable || 0,
            beforeDurableActiveRows: before?.durableActiveRows || 0,
            afterDurableActiveRows: after?.durableActiveRows || 0,
            beforeDurableQueuedRows: before?.durableQueuedRows || 0,
            afterDurableQueuedRows: after?.durableQueuedRows || 0,
            rowBudgetExceeded: before?.rowBudgetExceeded === true || after?.rowBudgetExceeded === true,
            hasWork: after?.hasStoredWork === true,
            paused: after?.paused === true
        })

        return {
            ...result,
            recovered: result?.recovered === true || executor?.changed === true,
            reconciled: true,
            reconcile: {before, after, prunedRuntime, authority, executor, changed}
        }
    }
    catch(error) {
        incrementQueueWakeupMetric(/timed out/i.test(error?.message || '') ? 'reconcile.timeout' : 'reconcile.error')
        finishQueueWakeupMetricCycle(cycle, 'timed-out', error?.message || 'reconcile-failed', {
            prunedRuntime,
            authorityActions: authority?.actions || 0,
            executorQueued: executor?.queued || 0,
            beforeDurableActiveWithoutActor: before?.durableActiveWithoutActor || 0,
            beforeProvisionalActorWithoutDurable: before?.provisionalActorWithoutDurable || 0
        })
        scheduleStoredWorkRepair(STORED_WORK_REPAIR_INTERVAL_MS, {
            reason: 'reconcile-error',
            edgeTriggered: true
        })
        return {
            recovered: false,
            reconciled: false,
            reason: 'reconcile-error',
            error: error?.message || `${error || ''}`,
            reconcile: {before, after, prunedRuntime, authority, executor}
        }
    }
}

async function recoverStoredCoordinatorWork(reason = 'stored-work-recovery', options = {}) {
    if(options.fromReconcileTick === true) {
        return recoverStoredCoordinatorWorkOnce(reason, options)
    }
    return runCoordinatorReconcileTick(reason, options)
}

function makeStoredWorkRecoveryResumeOwnedResult(reason = 'stored-work-recovery', repair = {}, hasWork = false, paused = false) {
    return {
        recovered: false,
        reason,
        repair,
        resume: {skipped: true, reason: 'resume-owned-by-reconcile'},
        hasWork,
        paused
    }
}

async function recoverStoredCoordinatorWorkOnce(reason = 'stored-work-recovery', options = {}) {
    let currentAuthorityState = await loadCoordinatorCurrentAuthorityState({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_PAUSED_KEY]: false
    })
    let queue = currentAuthorityState.queue
    let hasWork = hasStoredCoordinatorWork(queue)
    let paused = !!currentAuthorityState.stored?.[COORDINATOR_PAUSED_KEY]
    let repair = {deferred: true}

    if(hasWork && !paused && options.repairBeforeResume === true) {
        repair = await repairCoordinatorStorageFromProgressBestEffort()
        if(repair?.queueChanged || repair?.repaired || repair?.runsChanged || repair?.progressChanged || repair?.pendingPostsChanged) {
            currentAuthorityState = await loadCoordinatorCurrentAuthorityState({
                [COORDINATOR_QUEUE_KEY]: {},
                [COORDINATOR_PAUSED_KEY]: false
            })
            queue = currentAuthorityState.queue
            hasWork = hasStoredCoordinatorWork(queue)
            paused = !!currentAuthorityState.stored?.[COORDINATOR_PAUSED_KEY]
        }
    }

    if(hasWork && !paused) {
        return makeStoredWorkRecoveryResumeOwnedResult(reason, repair, hasWork, paused)
    }

    repair = await repairCoordinatorStorageFromProgressBestEffort()
    if(!options.skipStoredWorkCheck && !hasWork) {
        currentAuthorityState = await loadCoordinatorCurrentAuthorityState({
            [COORDINATOR_QUEUE_KEY]: {},
            [COORDINATOR_PAUSED_KEY]: false
        })
        queue = currentAuthorityState.queue
        hasWork = hasStoredCoordinatorWork(queue)
        paused = !!currentAuthorityState.stored?.[COORDINATOR_PAUSED_KEY]

        if(!hasWork) {
            return {recovered: false, reason: 'no-stored-work', repair}
        }
    }

    currentAuthorityState = await loadCoordinatorCurrentAuthorityState({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_PAUSED_KEY]: false
    })
    queue = currentAuthorityState.queue
    hasWork = hasStoredCoordinatorWork(queue)
    paused = !!currentAuthorityState.stored?.[COORDINATOR_PAUSED_KEY]

    if(!hasWork || paused) {
        return {
            recovered: false,
            reason: paused ? 'coordinator-paused' : 'no-stored-work-after-repair',
            repair,
            hasWork,
            paused
        }
    }

    return makeStoredWorkRecoveryResumeOwnedResult(reason, repair, hasWork, paused)
}

async function runStoredWorkRepairTick(reason = 'stored-work-repair-tick') {
    const cycle = startQueueWakeupMetricCycle('repair', 'runStoredWorkRepairTick', reason)
    try {
        const result = await runCoordinatorReconcileTick(reason, {
            repairBeforeResume: true,
            allowBeforeQuora: true
        })
        const repair = result?.repair || {}
        if(repair.queueChanged || repair.repaired) incrementQueueWakeupMetric('repair.changed.queue')
        if(repair.runsChanged) incrementQueueWakeupMetric('repair.changed.runs')
        if(repair.progressChanged) incrementQueueWakeupMetric('repair.changed.progress')
        if(repair.pendingPostsChanged) incrementQueueWakeupMetric('repair.changed.pendingPosts')
        const repairChanged = repair.queueChanged || repair.repaired || repair.runsChanged || repair.progressChanged || repair.pendingPostsChanged
        if(repairChanged) {
            resetStoredWorkRepairBackoff('repair-changed')
        }
        else {
            incrementQueueWakeupMetric('repair.noop')
            recordStoredWorkRepairNoopBackoff()
        }

        if(!result?.paused && result?.reconcile?.after?.hasStoredWork) {
            scheduleStoredWorkRepair(STORED_WORK_REPAIR_INTERVAL_MS, {reason: 'reconcile-has-stored-work'})
        }
        finishQueueWakeupMetricCycle(cycle, result?.recovered ? 'state-changed' : 'no-op', result?.reason || '', {
            hasWork: result?.hasWork === true,
            paused: result?.paused === true
        })
    }
    catch(error) {
        incrementQueueWakeupMetric(/timed out/i.test(error?.message || '') ? 'repair.timeout' : 'repair.noop')
        finishQueueWakeupMetricCycle(cycle, 'timed-out', error?.message || 'repair-failed')
        scheduleStoredWorkRepair(STORED_WORK_REPAIR_INTERVAL_MS, {
            reason: 'repair-tick-error',
            edgeTriggered: true
        })
    }
}

function getCoordinatorFailureRetryCount(item = {}) {
    return Number.parseInt(item?.retryCount, 10) || 0
}

function getCoordinatorFailureLastRetryAt(item = {}) {
    return Number.parseInt(item?.lastRetryAt, 10) || 0
}

function sortCoordinatorRetryCandidates(left, right) {
    const leftItem = left?.item || {}
    const rightItem = right?.item || {}
    const retryDelta = getCoordinatorFailureRetryCount(leftItem) - getCoordinatorFailureRetryCount(rightItem)
    if(retryDelta) return retryDelta

    const lastRetryDelta = getCoordinatorFailureLastRetryAt(leftItem) - getCoordinatorFailureLastRetryAt(rightItem)
    if(lastRetryDelta) return lastRetryDelta

    const leftTerminalAt = Number.parseInt(leftItem.terminalAt || leftItem.updatedAt || leftItem.createdAt, 10) || 0
    const rightTerminalAt = Number.parseInt(rightItem.terminalAt || rightItem.updatedAt || rightItem.createdAt, 10) || 0
    return leftTerminalAt - rightTerminalAt || `${left?.href || ''}`.localeCompare(`${right?.href || ''}`)
}

function getCoordinatorRetryableFailureCandidates(queue = {}, progress = {}, retryLimit = 2) {
    return Object.entries(queue || {})
        .map(([itemKey, item]) => {
            const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            const resolutionRetryUrl = getFailedItemProfileResolutionRetryUrl(item, itemKey)
            return {href, itemKey, item, resolutionRetryUrl}
        })
        .filter(candidate => {
            const href = candidate.href
            const item = candidate.item
            if(!href && !candidate.resolutionRetryUrl) return false
            if(!isRetryableCoordinatorFailure(item)) return false
            if(getCoordinatorFailureRetryCount(item) >= retryLimit) return false

            const progressRecord = progress[href] || null
            const applicableProgressRecord = shouldApplyProgressToCoordinatorItem(item, progressRecord)
                ? progressRecord
                : null
            if(isSuccessfulProfileNukeRecord(applicableProgressRecord)) return false
            if(isExplicitSecurityVerificationRecord(applicableProgressRecord)) return false
            if(isTerminalProfileNukeRecord(applicableProgressRecord) && !isRetryableTerminalProfileNukeRecord(applicableProgressRecord)) return false

            return true
        })
        .sort(sortCoordinatorRetryCandidates)
}

function getCoordinatorRetrySourcePages(items = []) {
    const sourcePages = new Set()

    for(const item of items || []) {
        if(item?.source?.pageUrl) sourcePages.add(item.source.pageUrl)
        for(const source of item?.sources || []) {
            if(source?.pageUrl) sourcePages.add(source.pageUrl)
        }
    }

    return Array.from(sourcePages)
}

function buildFailedCoordinatorResetItem(itemKey = '', item = {}, options = {}) {
    const now = Number.parseInt(options.now, 10) || Date.now()
    const runId = options.runId || makeId('failed-reset')
    const request = options.request || {}
    const resolutionRetryUrl = getFailedItemProfileResolutionRetryUrl(item, itemKey)
    const repairAsResolution = !!resolutionRetryUrl
    const legacyHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
    const href = repairAsResolution ? '' : legacyHref
    const coordinatorKey = repairAsResolution
        ? makeProfileResolutionQueueKey(resolutionRetryUrl)
        : href || getCoordinatorItemQueueKey(item, itemKey)
    const attemptId = makeAttemptId()
    const attemptNumber = getNextAttemptNumberFromValue(item)
    const retryCount = Math.max(0, Number.parseInt(options.retryCount, 10) || 0)
    const lastRetryAt = Math.max(0, Number.parseInt(options.lastRetryAt, 10) || 0)
    const retryReason = options.retryReason || ''
    const requestedUrl = resolutionRetryUrl || (
        options.requestedUrlMode === 'coordinator'
            ? normalizeCoordinatorRequestedUrl(item.requestedUrl || href || stripProfileResolutionQueueKey(coordinatorKey))
            : normalizeTabTargetUrl(item.requestedUrl || href)
    )
    const actionKind = getCoordinatorActionKindForRequestedAction(item.actionKind || item.tabAction || item.executorTabAction || '')
    const reducedRetry = reduceJobEvent(item, {
        type: JOB_EVENT_RETRY,
        attemptId,
        attemptNumber,
        at: now,
        retryCount,
        lastRetryAt
    })
    const retryBase = reducedRetry.accepted ? reducedRetry.item : item
    const executorMaxConcurrent = Number.parseInt(options.maxConcurrent, 10) || 0

    const nextItem = applyCoordinatorJobEnvelope({
        ...retryBase,
        runId,
        attemptId,
        attemptNumber,
        targetProfileHref: href,
        dedupeKey: href || coordinatorKey,
        coordinatorKey,
        resolutionMode: repairAsResolution ? QUEUED_PROFILE_RESOLUTION_MODE : '',
        resolveProfileFromPage: repairAsResolution,
        resolutionReason: repairAsResolution ? item.resolutionReason || 'failed-target-source-post-revisit' : item.resolutionReason || '',
        requestedUrl: requestedUrl || href,
        actionKind,
        executorTabAction: getCoordinatorExecutorTabActionForActionKind(actionKind),
        ...(executorMaxConcurrent ? {executorMaxConcurrent} : {}),
        executorOwner: 'service-worker',
        serviceWorkerOwned: true,
        executorNoForegroundFallback: request.noForegroundFallback === false
            ? false
            : item.executorNoForegroundFallback === true || item.noForegroundFallback === true || request.noForegroundFallback === true,
        status: 'queued',
        outcome: '',
        error: '',
        updatedAt: now,
        queuedAt: now,
        activeAt: 0,
        terminalAt: 0,
        tabId: null,
        attempt: 0,
        retryCount,
        lastRetryAt,
        retryReason,
        actionLease: null,
        actionLeaseReleasedAt: 0,
        actionLeaseReleaseReason: '',
        sourceSettledAt: 0,
        sourceSettlementKey: '',
        sourceSettlementOutcome: '',
        milestones: makeEmptyCoordinatorMilestones()
    }, {
        runInput: {id: runId, sourceType: options.envelopeSourceType || 'failed-retry'},
        source: item.source || {},
        runId,
        targetProfileHref: href,
        requestedUrl: requestedUrl || href,
        coordinatorKey,
        actionKind
    })

    return {
        nextItem,
        coordinatorKey,
        href,
        legacyHref,
        repairAsResolution
    }
}

async function retryCoordinatorFailedItems(request = {}, sender = {}) {
    const ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID
    if(!ownerTabId) return {queued: 0, selected: 0, remainingRetryable: 0, reason: 'no-coordinator'}

    await ownedTabIdsReady
    await ensureProfileNukeProgressReady()
    await sweepStaleQueuedTabs()
    scheduleStoredWorkRepair(1000, {reason: 'retry-failed-request'})

    if(getDurablyActiveQueuedTabCount() || queuedTabActions.length) {
        const executor = await runCoordinatorReconcileExecutorActions('retry-failed-executor-busy', {
            awaitFill: true
        })
        return {
            queued: 0,
            selected: 0,
            executionQueued: executor?.queued || 0,
            pending: executor?.pending || 0,
            active: executor?.active || 0,
            remainingRetryable: 0,
            reason: 'executor-busy'
        }
    }

    const retryLimit = Math.max(1, Number.parseInt(request.retryLimit, 10) || 2)
    const maxItems = Math.max(1, Number.parseInt(request.maxItems, 10) || 1)

    const persisted = await enqueueSpaceFeedStorageUpdate(async () => {
        const state = await loadCoordinatorState()
        const queue = state.queue
        const runs = state.runs
        const events = state.events
        const progress = state.progress
        let progressChanged = false

        profileNukeProgress = progress

        if(hasStoredCoordinatorWork(queue)) {
            return {
                queued: 0,
                selected: 0,
                remainingRetryable: getCoordinatorRetryableFailureCandidates(queue, progress, retryLimit).length,
                reason: 'queue-busy'
            }
        }

        const candidates = getCoordinatorRetryableFailureCandidates(queue, progress, retryLimit)
        const selected = candidates.slice(0, maxItems)

        if(!selected.length) {
            return {
                queued: 0,
                selected: 0,
                remainingRetryable: 0,
                reason: 'no-retryable-failed-items'
            }
        }

        const now = Date.now()
        const runId = makeId('retry-failed')
        const selectedItems = []

        for(const candidate of selected) {
            const item = candidate.item
            const retryCount = getCoordinatorFailureRetryCount(item) + 1
            const reset = buildFailedCoordinatorResetItem(candidate.itemKey, item, {
                now,
                runId,
                request,
                retryCount,
                lastRetryAt: now,
                retryReason: `${item.outcome || 'failed'}${item.error ? `: ${item.error}` : ''}`,
                requestedUrlMode: 'tab',
                envelopeSourceType: 'failed-retry'
            })
            queue[reset.coordinatorKey] = reset.nextItem
            if(reset.coordinatorKey !== candidate.itemKey) delete queue[candidate.itemKey]

            for(const href of getNormalizedProfileHrefList([reset.legacyHref, reset.href])) {
                if(!progress[href]) continue
                delete progress[href]
                progressChanged = true
            }
            selectedItems.push(reset.nextItem)
        }

        const sourcePages = getCoordinatorRetrySourcePages(selectedItems)
        const targetProfileHrefs = getNormalizedProfileHrefList(selectedItems.map(item => item.targetProfileHref))
        const targetWorkKeys = mergeUniqueStringList(selectedItems.map(item => item.coordinatorKey || item.targetProfileHref || item.dedupeKey || ''))

        runs[runId] = {
            id: runId,
            sourceType: 'failed-retry',
            createdAt: now,
            updatedAt: now,
            status: 'active',
            itemCount: selectedItems.length,
            activeCount: 0,
            terminalCount: 0,
            paused: false,
            sourcePages,
            targetProfileHrefs,
            targetWorkKeys
        }
        Object.assign(runs, recomputeCoordinatorRuns(queue, runs, new Set([runId])))

        events.push({
            id: makeId('event'),
            runId,
            itemId: '',
            type: 'retry',
            message: `Retrying ${selectedItems.length} failed target${selectedItems.length === 1 ? '' : 's'}`,
            at: now,
            details: {
                queued: selectedItems.length,
                retryLimit,
                targetProfileHrefs,
                targetProfileHref: targetProfileHrefs.length === 1 ? targetProfileHrefs[0] : ''
            }
        })

        const saved = await saveCoordinatorState({queue, runs, events, progress}, {
            queue: true,
            runs: true,
            events: true,
            progress: progressChanged,
            reason: 'ordinaryMutation',
            queueOperation: 'retry',
            queueChangedRows: selectedItems.length
        })
        if(!saved) {
            return {
                queued: 0,
                selected: 0,
                remainingRetryable: candidates.length,
                reason: 'retry-save-failed'
            }
        }
        if(progressChanged) {
            profileNukeProgress = progress
        }
        incrementQueueWakeupMetric('job.enqueued', selectedItems.length)
        incrementQueueWakeupMetric('pump.changed.requeued', selectedItems.length)

        return {
            queued: selectedItems.length,
            selected: selectedItems.length,
            selectedItems,
            remainingRetryable: Math.max(0, candidates.length - selectedItems.length),
            runId,
            reason: 'retry-persisted'
        }
    }, {
        reason: 'retry-failed',
        failureValue: {
            queued: 0,
            selected: 0,
            remainingRetryable: 0,
            reason: 'retry-save-failed',
            storageTimedOut: true
        }
    })

    if(!persisted || !persisted.selectedItems?.length) {
        return persisted || {
            queued: 0,
            selected: 0,
            remainingRetryable: 0,
            reason: 'retry-save-failed'
        }
    }

    const result = await runCoordinatorReconcileTick('retry-failed-reconcile', {
        direct: true,
        skipStoredWorkCheck: true,
        repairBeforeResume: false,
        awaitFill: true
    })

    return {
        queued: persisted.selectedItems.length,
        executionQueued: result?.resume?.queued || result?.queued || 0,
        selected: persisted.selectedItems.length,
        remainingRetryable: persisted.remainingRetryable || 0,
        runId: persisted.runId,
        reason: (result?.resume?.queued || result?.queued || 0) > 0 ? 'retry-started' : 'retry-selected-but-not-opened'
    }
}

async function requeueCoordinatorFailedItems(request = {}, sender = {}) {
    const ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID
    if(!ownerTabId) return {queued: 0, selected: 0, reason: 'no-coordinator'}

    await ownedTabIdsReady
    await ensureProfileNukeProgressReady()
    await sweepStaleQueuedTabs()
    scheduleStoredWorkRepair(1000, {reason: 'requeue-failed-request'})

    if(getDurablyActiveQueuedTabCount() || queuedTabActions.length) {
        const executor = await runCoordinatorReconcileExecutorActions('requeue-failed-executor-busy', {
            awaitFill: true
        })
        return {
            queued: 0,
            selected: 0,
            executionQueued: executor?.queued || 0,
            pending: executor?.pending || 0,
            active: executor?.active || 0,
            reason: 'executor-busy'
        }
    }

    const requestedHrefs = new Set(getNormalizedProfileHrefList([
        request.profileHref || '',
        ...(Array.isArray(request.profileHrefs) ? request.profileHrefs : [])
    ]))
    const requestedKeys = new Set([
        `${request.storageKey || request.coordinatorKey || ''}`.trim(),
        ...(Array.isArray(request.storageKeys) ? request.storageKeys : []),
        ...(Array.isArray(request.coordinatorKeys) ? request.coordinatorKeys : [])
    ].map(value => `${value || ''}`.trim()).filter(Boolean))
    const hasRequestedTargets = requestedHrefs.size > 0 || requestedKeys.size > 0

    const persisted = await enqueueSpaceFeedStorageUpdate(async () => {
        const state = await loadCoordinatorState()
        const queue = state.queue
        const runs = state.runs
        const events = state.events
        const progress = state.progress
        const now = Date.now()
        const runId = makeId('requeue-failed')
        const selectedItems = []
        let progressChanged = false

        for(const [itemKey, item] of Object.entries(queue)) {
            if(`${item?.status || ''}` !== 'failed') continue

            const legacyHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            const resolutionRetryUrl = getFailedItemProfileResolutionRetryUrl(item, itemKey)
            const repairAsResolution = !!resolutionRetryUrl
            const href = repairAsResolution ? '' : legacyHref
            const coordinatorKey = repairAsResolution
                ? makeProfileResolutionQueueKey(resolutionRetryUrl)
                : href || getCoordinatorItemQueueKey(item, itemKey)
            if(!href && !coordinatorKey) continue
            if(
                hasRequestedTargets &&
                !requestedHrefs.has(href) &&
                !requestedHrefs.has(legacyHref) &&
                !requestedKeys.has(itemKey) &&
                !requestedKeys.has(coordinatorKey)
            ) continue

            const reset = buildFailedCoordinatorResetItem(itemKey, item, {
                now,
                runId,
                request,
                retryCount: 0,
                lastRetryAt: 0,
                retryReason: '',
                maxConcurrent: Math.max(1, Number.parseInt(request.maxConcurrent, 10) || 1),
                requestedUrlMode: 'coordinator',
                envelopeSourceType: 'manual-requeue'
            })

            queue[reset.coordinatorKey] = reset.nextItem
            for(const progressHref of getNormalizedProfileHrefList([reset.legacyHref, reset.href])) {
                if(!progress[progressHref]) continue
                delete progress[progressHref]
                progressChanged = true
            }
            selectedItems.push(reset.nextItem)
            if(reset.coordinatorKey !== itemKey) delete queue[itemKey]
        }

        if(!selectedItems.length) {
            return {
                queued: 0,
                selected: 0,
                reason: 'no-failed-items'
            }
        }

        const sourcePages = getCoordinatorRetrySourcePages(selectedItems)
        const targetProfileHrefs = getNormalizedProfileHrefList(selectedItems.map(item => item.targetProfileHref))
        const targetWorkKeys = mergeUniqueStringList(selectedItems.map(item => item.coordinatorKey || item.targetProfileHref || item.dedupeKey || ''))

        runs[runId] = {
            id: runId,
            sourceType: 'failed-requeue',
            createdAt: now,
            updatedAt: now,
            status: 'active',
            itemCount: selectedItems.length,
            activeCount: 0,
            terminalCount: 0,
            paused: false,
            sourcePages,
            targetProfileHrefs,
            targetWorkKeys
        }
        Object.assign(runs, recomputeCoordinatorRuns(queue, runs, new Set([runId])))

        events.push({
            id: makeId('event'),
            runId,
            itemId: '',
            type: 'requeue',
            message: `Requeued ${selectedItems.length} failed target${selectedItems.length === 1 ? '' : 's'}`,
            at: now,
            details: {
                queued: selectedItems.length,
                targetProfileHrefs,
                targetProfileHref: targetProfileHrefs.length === 1 ? targetProfileHrefs[0] : ''
            }
        })

        const saved = await saveCoordinatorState({queue, runs, events, progress}, {
            queue: true,
            runs: true,
            events: true,
            progress: progressChanged,
            reason: 'ordinaryMutation',
            queueOperation: 'requeue',
            queueChangedRows: selectedItems.length
        })
        if(!saved) {
            return {
                queued: 0,
                executionQueued: 0,
                selected: 0,
                reason: 'requeue-save-failed'
            }
        }
        if(progressChanged) {
            profileNukeProgress = progress
        }
        incrementQueueWakeupMetric('job.enqueued', selectedItems.length)
        incrementQueueWakeupMetric('pump.changed.requeued', selectedItems.length)
        return {
            queued: selectedItems.length,
            selected: selectedItems.length,
            selectedItems,
            runId,
            reason: 'requeue-persisted'
        }
    }, {
        reason: 'requeue-failed',
        failureValue: {
            queued: 0,
            executionQueued: 0,
            selected: 0,
            reason: 'requeue-save-failed',
            storageTimedOut: true
        }
    })

    if(!persisted || !persisted.selectedItems?.length) {
        return persisted || {
            queued: 0,
            executionQueued: 0,
            selected: 0,
            reason: 'requeue-save-failed'
        }
    }

    const result = await runCoordinatorReconcileTick('requeue-failed-reconcile', {
        direct: true,
        skipStoredWorkCheck: true,
        repairBeforeResume: false,
        awaitFill: true
    })

    return {
        queued: persisted.selectedItems.length,
        executionQueued: result?.resume?.queued || result?.queued || 0,
        selected: persisted.selectedItems.length,
        runId: persisted.runId,
        reason: (result?.resume?.queued || result?.queued || 0) > 0 ? 'requeue-started' : 'requeue-scheduled'
    }
}

async function enqueueCoordinatorItems(request = {}, sender = {}) {
    const storageRequest = {
        ...request,
        senderTabId: sender.tab?.id || null,
        senderWindowId: sender.tab?.windowId || null
    }

    await coordinatorProgressSyncPromise.catch(() => false)
    coordinatorEnqueuePromise = coordinatorEnqueuePromise
        .catch(() => {})
        .then(() => enqueueCoordinatorItemsStorage(storageRequest))

    const result = await coordinatorEnqueuePromise
    const acceptedItems = (Number.parseInt(result?.queued, 10) || 0) + (Number.parseInt(result?.merged, 10) || 0)
    if(acceptedItems > 0) incrementQueueWakeupMetric('job.enqueued', acceptedItems)
    void finishCoordinatorEnqueue(request, sender, result)
        .catch(error => console.info('Mute Block coordinator execution setup failed after durable enqueue', error))
    await pruneMissingQueuedTabRuntimeState('post-enqueue-runtime-prune')
    return result
}

function shouldResetCoordinatorItemForIncoming(existing = null, actionKind = '', rawItem = {}, runInput = {}, source = {}) {
    if(!existing) return false
    const explicitReset = rawItem?.resetExisting === true ||
        runInput?.resetExisting === true ||
        source?.resetExisting === true
    if(explicitReset) return true

    if(isRetryableCoordinatorFailure(existing)) return true

    const terminalExisting = isTerminalCoordinatorStatus(existing?.status)
    if(!terminalExisting) return false

    const sourceType = `${rawItem?.source?.type || source?.type || runInput?.sourceType || ''}`.trim()
    return actionKind === UNBLOCK_UNMUTE_ACTION_KIND && sourceType === 'profile-reverse'
}

async function enqueueCoordinatorItemsStorage(request = {}) {
    const runInput = request.run && typeof request.run === 'object' ? request.run : {}
    const hasExecuteInput = request.execute && typeof request.execute === 'object'
    return enqueueSpaceFeedStorageUpdate(() => enqueueCoordinatorItemsStorageLocked(request), {
        failureValue: {
            queued: 0,
            merged: 0,
            executionQueued: 0,
            runId: runInput.id || '',
            coordinatorTabId: null,
            coordinatorWindowId: null,
            coordinatorReused: false,
            executionDeferred: !hasExecuteInput,
            storageTimedOut: true
        }
    })
}

async function enqueueCoordinatorItemsStorageLocked(request = {}) {
    const now = Date.now()
    const runInput = request.run && typeof request.run === 'object' ? request.run : {}
    const runId = runInput.id || makeId('run')
    const source = request.source && typeof request.source === 'object' ? request.source : {}
    const hasExecuteInput = request.execute && typeof request.execute === 'object'
    const executeInput = hasExecuteInput ? request.execute : {}
    const requestedMaxConcurrent = Number.parseInt(executeInput.maxConcurrent, 10)
    const rawItems = Array.isArray(request.items) ? request.items : []
    const senderTabId = normalizeTabId(request.senderTabId)
    const senderWindowId = normalizeTabId(request.senderWindowId)

    if(!rawItems.length) return {queued: 0, merged: 0, runId}

    const state = await loadCoordinatorState({
        [PROFILE_NUKE_PROGRESS_KEY]: undefined
    })
    const queue = state.queue
    const runs = state.runs
    const events = state.events
    const progress = state.progress
    let queued = 0
    let merged = 0
    let progressChanged = false
    const progressResetRecords = {}
    const affectedRunIds = new Set([runId])
    const sourcePages = new Set([...(runs[runId]?.sourcePages || []), source.pageUrl || runInput.sourcePageUrl || ''].filter(Boolean))
    const targetProfileHrefs = new Set(getCoordinatorRunTargetHrefs(runs[runId] || {}))
    const targetWorkKeys = new Set(Array.isArray(runs[runId]?.targetWorkKeys) ? runs[runId].targetWorkKeys : [])

    for(const rawItem of rawItems) {
        const requestedResolutionMode = rawItem?.resolveProfileFromPage === true
            ? QUEUED_PROFILE_RESOLUTION_MODE
            : `${rawItem?.resolutionMode || ''}`.trim()
        const targetProfileHref = normalizeQuoraProfileUrl(rawItem?.targetProfileHref || (isProfileResolutionMode(requestedResolutionMode) ? '' : rawItem?.requestedUrl) || rawItem?.dedupeKey || '')
        const requestedUrl = normalizeCoordinatorRequestedUrl(rawItem?.requestedUrl || targetProfileHref || stripProfileResolutionQueueKey(rawItem?.dedupeKey || ''))
        const coordinatorKey = targetProfileHref || (
            isProfileResolutionMode(requestedResolutionMode)
                ? makeProfileResolutionQueueKey(requestedUrl || rawItem?.dedupeKey || '')
                : ''
        )
        if(!coordinatorKey) continue
        if(targetProfileHref) targetProfileHrefs.add(targetProfileHref)
        targetWorkKeys.add(coordinatorKey)

        const existing = queue[coordinatorKey] || null
        const requestedActionKindInput = rawItem?.actionKind || rawItem?.tabAction || executeInput.tabAction || ''
        const actionKind = requestedActionKindInput
            ? getCoordinatorActionKindForRequestedAction(requestedActionKindInput)
            : `${existing?.actionKind || 'mute-block'}`.trim() || 'mute-block'
        const actionChanged = !!existing && `${existing.actionKind || 'mute-block'}` !== actionKind
        const requestedExecutorTabAction = `${rawItem?.tabAction || executeInput.tabAction || ''}`.trim()
        const executorTabAction = requestedExecutorTabAction === 'nuke' || requestedExecutorTabAction === UNBLOCK_UNMUTE_ACTION_KIND
            ? requestedExecutorTabAction
            : getCoordinatorExecutorTabActionForActionKind(actionKind)
        const executorMaxConcurrent = Number.isFinite(requestedMaxConcurrent) && requestedMaxConcurrent > 0
            ? requestedMaxConcurrent
            : getCoordinatorItemExecutorMaxConcurrent(existing)
        const itemSource = rawItem.source && typeof rawItem.source === 'object' ? rawItem.source : source
        const incomingSources = [itemSource]
        const incomingEvidence = Array.isArray(rawItem.evidence) ? rawItem.evidence : []
        const resetExisting = actionChanged || shouldResetCoordinatorItemForIncoming(existing, actionKind, rawItem, runInput, source)
        if(resetExisting) {
            if(targetProfileHref) {
                await cancelCoordinatorExecutorsForReset(
                    targetProfileHref,
                    existing,
                    state.progress?.[targetProfileHref] || null,
                    actionKind
                )
                for(const previousRunId of getCoordinatorRunIdsForHref(runs, targetProfileHref)) {
                    if(previousRunId === runId || !runs[previousRunId]) continue
                    affectedRunIds.add(previousRunId)
                    runs[previousRunId] = {
                        ...runs[previousRunId],
                        targetProfileHrefs: getCoordinatorRunTargetHrefs(runs[previousRunId])
                            .filter(href => href !== targetProfileHref),
                        updatedAt: now
                    }
                }
            }
        }
        const terminalExisting = isTerminalCoordinatorStatus(existing?.status) && !resetExisting
        const nextAttemptId = resetExisting || !existing ? makeAttemptId() : getAttemptIdFromValue(existing)
        const nextAttemptNumber = resetExisting || !existing ? getNextAttemptNumberFromValue(existing) : getAttemptNumberFromValue(existing)
        const nextItem = applyCoordinatorJobEnvelope({
            ...(existing || {}),
            id: resetExisting ? rawItem.id || makeId('item') : existing?.id || rawItem.id || makeId('item'),
            runId: resetExisting ? runId : existing?.runId || runId,
            dedupeKey: targetProfileHref || coordinatorKey,
            coordinatorKey,
            resolutionMode: targetProfileHref ? '' : requestedResolutionMode,
            resolveProfileFromPage: !targetProfileHref && isProfileResolutionMode(requestedResolutionMode),
            resolutionReason: resetExisting ? rawItem?.resolutionReason || '' : existing?.resolutionReason || rawItem?.resolutionReason || '',
            candidateConfidence: resetExisting ? rawItem?.candidateConfidence || '' : existing?.candidateConfidence || rawItem?.candidateConfidence || '',
            candidateCollector: resetExisting ? rawItem?.candidateCollector || '' : existing?.candidateCollector || rawItem?.candidateCollector || '',
            actionKind,
            executorTabAction: resetExisting ? executorTabAction : existing?.executorTabAction || executorTabAction,
            executorMaxConcurrent: executorMaxConcurrent || existing?.executorMaxConcurrent || null,
            executorNoForegroundFallback: resetExisting
                ? executeInput.noForegroundFallback === true
                : existing?.executorNoForegroundFallback === true || executeInput.noForegroundFallback === true,
            executorOwner: hasExecuteInput ? 'service-worker' : existing?.executorOwner || '',
            serviceWorkerOwned: hasExecuteInput ? true : existing?.serviceWorkerOwned === true,
            targetProfileHref,
            requestedUrl: requestedUrl || targetProfileHref,
            source: resetExisting ? itemSource || {} : existing?.source || itemSource || {},
            sources: resetExisting
                ? mergeCoordinatorSources([], incomingSources)
                : mergeCoordinatorSources(existing?.sources || (existing?.source ? [existing.source] : []), incomingSources),
            evidence: resetExisting ? incomingEvidence : mergeCoordinatorEvidence(existing?.evidence || [], incomingEvidence),
            closeSourceTabOnSuccess: resetExisting
                ? rawItem?.closeSourceTabOnSuccess === true
                : existing?.closeSourceTabOnSuccess === true || rawItem?.closeSourceTabOnSuccess === true,
            sourceTabId: resetExisting
                ? rawItem?.closeSourceTabOnSuccess === true ? senderTabId : null
                : existing?.sourceTabId || (rawItem?.closeSourceTabOnSuccess === true ? senderTabId : null),
            sourceWindowId: resetExisting
                ? rawItem?.closeSourceTabOnSuccess === true ? senderWindowId : null
                : existing?.sourceWindowId || (rawItem?.closeSourceTabOnSuccess === true ? senderWindowId : null),
            status: resetExisting ? 'queued' : existing && terminalExisting ? existing.status : (existing?.status || 'queued'),
            outcome: resetExisting ? '' : existing?.outcome || '',
            error: resetExisting ? '' : existing?.error || '',
            createdAt: resetExisting ? now : existing?.createdAt || now,
            updatedAt: now,
            queuedAt: resetExisting ? now : existing?.queuedAt || now,
            activeAt: resetExisting ? 0 : existing?.activeAt || 0,
            terminalAt: resetExisting ? 0 : existing?.terminalAt || 0,
            tabId: resetExisting ? null : existing?.tabId || null,
            attempt: resetExisting ? 0 : Number.parseInt(existing?.attempt, 10) || 0,
            attemptId: nextAttemptId,
            attemptNumber: nextAttemptNumber,
            maxAttempts: Number.parseInt(existing?.maxAttempts, 10) || 1,
            sourceSettledAt: resetExisting ? 0 : existing?.sourceSettledAt || 0,
            sourceSettlementKey: resetExisting ? '' : existing?.sourceSettlementKey || '',
            sourceSettlementOutcome: resetExisting ? '' : existing?.sourceSettlementOutcome || '',
            milestones: resetExisting ? makeEmptyCoordinatorMilestones() : existing?.milestones || makeEmptyCoordinatorMilestones()
        }, {
            runInput,
            source: itemSource,
            runId: resetExisting ? runId : existing?.runId || runId,
            targetProfileHref,
            requestedUrl,
            coordinatorKey,
            actionKind
        })

        queue[coordinatorKey] = nextItem
        if(hasExecuteInput && targetProfileHref && (resetExisting || !existing)) {
            const resetRecord = normalizeProgressPatch(
                targetProfileHref,
                buildQueuedCoordinatorProgressResetPatch(nextItem, {now, runId, actionKind}),
                progress[targetProfileHref] || null
            )
            if(resetRecord) {
                progress[targetProfileHref] = resetRecord
                progressResetRecords[targetProfileHref] = resetRecord
                progressChanged = true
            }
        }
        if(existing) merged += 1
        else queued += 1

        if(itemSource?.pageUrl) sourcePages.add(itemSource.pageUrl)
    }

    runs[runId] = {
        ...(runs[runId] || {}),
        id: runId,
        sourceType: runInput.sourceType || source.type || 'space-feed',
        createdAt: runs[runId]?.createdAt || now,
        updatedAt: now,
        status: 'active',
        itemCount: targetWorkKeys.size || targetProfileHrefs.size || rawItems.length,
        activeCount: Object.values(queue).filter(item => item?.runId === runId && isActiveCoordinatorStatus(item?.status)).length,
        terminalCount: Object.values(queue).filter(item => item?.runId === runId && isTerminalCoordinatorStatus(item?.status)).length,
        paused: false,
        sourcePages: Array.from(sourcePages),
        targetProfileHrefs: Array.from(targetProfileHrefs),
        targetWorkKeys: Array.from(targetWorkKeys)
    }
    Object.assign(runs, recomputeCoordinatorRuns(queue, runs, affectedRunIds))

    events.push({
        id: makeId('event'),
        runId,
        itemId: '',
        type: 'enqueued',
        message: `Enqueued ${queued} new target${queued === 1 ? '' : 's'} and merged ${merged}`,
        at: now,
        details: {
            queued,
            merged,
            sourcePageUrl: source.pageUrl || ''
        }
    })

    await saveCoordinatorState({queue, runs, events, progress}, {
        queue: true,
        runs: true,
        events: true,
        progress: progressChanged,
        reason: 'ordinaryMutation',
        queueOperation: 'enqueue',
        queueChangedRows: queued + merged
    })
    if(progressChanged) {
        profileNukeProgress = {
            ...profileNukeProgress,
            ...progressResetRecords
        }
    }

    return {
        queued,
        merged,
        executionQueued: 0,
        runId,
        coordinatorTabId: null,
        coordinatorWindowId: null,
        coordinatorReused: false,
        executionDeferred: true
    }
}

async function finishCoordinatorEnqueue(request = {}, sender = {}, enqueueResult = {}) {
    const rawItems = Array.isArray(request.items) ? request.items : []
    if(!rawItems.length) return
    if(enqueueResult?.storageTimedOut === true) {
        scheduleStoredWorkRepair(1000, {
            reason: 'post-enqueue-storage-timeout',
            edgeTriggered: true
        })
        return
    }

    const executeInput = request.execute && typeof request.execute === 'object' ? request.execute : {}
    const executeOptions = request.execute && typeof request.execute === 'object' ? request.execute : null
    if(!executeOptions) return

    const pausedState = await metricStorageGet({[COORDINATOR_PAUSED_KEY]: false}).catch(() => null)
    if(pausedState?.[COORDINATOR_PAUSED_KEY] === true) {
        return
    }

    const resetExecutor = shouldResetCoordinatorExecutor(request, rawItems)
    if(resetExecutor) {
        await stopOwnerNukes(SERVICE_WORKER_QUEUE_OWNER_ID, {
            closeOwnedTabs: true,
            reason: 'service-worker-reset-existing'
        })
        const coordinator = await dedupeCoordinatorTabs(coordinatorTabId).catch(() => null)
        if(coordinator?.tabId) {
            await stopOwnerNukes(coordinator.tabId, {
                closeOwnedTabs: true,
                reason: 'coordinator-reset-existing'
            })
        }
    }

    scheduleStoredWorkRepair(1000, {
        reason: 'post-enqueue',
        edgeTriggered: true
    })
    await runCoordinatorReconcileTick('post-enqueue-reconcile', {
        direct: true,
        skipStoredWorkCheck: true,
        repairBeforeResume: false,
        awaitFill: true
    })
}

function shouldResetCoordinatorExecutor(request = {}, rawItems = []) {
    const runInput = request.run && typeof request.run === 'object' ? request.run : {}
    const source = request.source && typeof request.source === 'object' ? request.source : {}

    return runInput?.resetExisting === true ||
        source?.resetExisting === true ||
        rawItems.some(item => item?.resetExisting === true)
}

function promiseWithTimeout(promise, timeoutMs = SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS, label = 'operation') {
    let timeoutId = null
    let settled = false
    const operation = Promise.resolve(promise).finally(() => {
        settled = true
        if(timeoutId) clearTimeout(timeoutId)
    })
    const timeout = new Promise((resolve, reject) => {
        Promise.resolve().then(() => {
            if(settled) return
            timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
        })
    })

    return Promise.race([
        operation,
        timeout
    ])
}

function enqueueSpaceFeedStorageUpdate(update, options = {}) {
    const timeoutMs = Math.max(1000, Number.parseInt(options.timeoutMs, 10) || SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS)
    const updateToken = ++spaceFeedStorageUpdateSerial
    const enqueuedAt = Date.now()
    const parentStorageContext = activeQueueWakeupStorageContext
    const storageContext = {
        updateToken,
        reason: options.reason || '',
        enqueuedAt,
        startedAt: 0,
        finishedAt: 0,
        timedOutAt: 0,
        didTimeout: false,
        fallbackReturned: false,
        abandoned: false,
        lateWriteSuppressed: false,
        deadlineMissed: false,
        timeoutMs,
        depth: 0,
        maxNestedDepth: spaceFeedStorageUpdateDepth,
        nestedUpdateCount: 0,
        currentPhase: 'beforeStart',
        timeoutPhase: '',
        phaseIntervals: {}
    }
    if(parentStorageContext) {
        parentStorageContext.nestedUpdateCount = (Number(parentStorageContext.nestedUpdateCount) || 0) + 1
        parentStorageContext.maxNestedDepth = Math.max(Number(parentStorageContext.maxNestedDepth) || 0, spaceFeedStorageUpdateDepth + 1)
        incrementQueueWakeupMetric('storageUpdate.nested')
    }
    const previousUpdate = spaceFeedStorageUpdatePromise.catch(() => null)
    const cycle = startQueueWakeupMetricCycle('storage', 'enqueueSpaceFeedStorageUpdate', options.reason || '')
    incrementQueueWakeupMetric('storageUpdate.started')
    const updatePromise = previousUpdate.then(async () => {
        spaceFeedStorageUpdateDepth += 1
        const previousUpdateToken = activeSpaceFeedStorageUpdateToken
        const previousStorageContext = activeQueueWakeupStorageContext
        activeSpaceFeedStorageUpdateToken = updateToken
        activeQueueWakeupStorageContext = storageContext
        storageContext.startedAt = Date.now()
        storageContext.depth = spaceFeedStorageUpdateDepth
        storageContext.maxNestedDepth = Math.max(Number(storageContext.maxNestedDepth) || 0, spaceFeedStorageUpdateDepth)
        storageContext.queueWaitMs = storageContext.startedAt - enqueuedAt
        storageContext.currentPhase = 'running'
        recordQueueWakeupPhase('storageQueueWait', storageContext.queueWaitMs)
        try {
            if(isStorageUpdateAbandoned(updateToken)) {
                storageContext.abandoned = true
                storageContext.currentPhase = 'abandoned-before-start'
                incrementQueueWakeupMetric('storageUpdate.skippedAbandoned')
                finishQueueWakeupMetricCycle(cycle, 'abandoned', 'skipped-before-update-body', {
                    ...getStorageContextJournalDetails(storageContext),
                    depth: spaceFeedStorageUpdateDepth
                })
                return options.failureValue ?? false
            }
            const result = await Promise.resolve().then(update)
            storageContext.finishedAt = Date.now()
            if(storageContext.finishedAt - enqueuedAt > timeoutMs && storageContext.deadlineMissed !== true) {
                storageContext.deadlineMissed = true
                incrementQueueWakeupMetric('storageUpdate.deadlineMissed')
            }
            incrementQueueWakeupMetric('storageUpdate.completed')
            recordStorageIdleChurnCounters(storageContext)
            finishQueueWakeupMetricCycle(cycle, 'completed', '', {
                ...getStorageContextJournalDetails(storageContext),
                depth: spaceFeedStorageUpdateDepth
            })
            return result
        }
        finally {
            try {
                spaceFeedStorageUpdateDepth = Math.max(0, spaceFeedStorageUpdateDepth - 1)
                if(spaceFeedStorageUpdateDepth === 0) {
                    await flushPendingCoordinatorDiagnosticEvents()
                    scheduleQueueWakeupMetricsFlush()
                }
            }
            finally {
                activeSpaceFeedStorageUpdateToken = previousUpdateToken
                activeQueueWakeupStorageContext = previousStorageContext
            }
        }
    })

    let timeoutId = null
    const timeoutPromise = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
            abandonedSpaceFeedStorageUpdates.add(updateToken)
            storageContext.didTimeout = true
            storageContext.timedOutAt = Date.now()
            storageContext.timeoutPhase = getStorageTimeoutBucket(storageContext)
            incrementQueueWakeupMetric('storageUpdate.timedOut')
            if(storageContext.currentPhase === 'running') {
                storageContext.tailWedged = true
                incrementQueueWakeupMetric('storageUpdate.tailWedged')
                pushQueueWakeupJournalEntry({
                    kind: 'storage',
                    name: 'storage-update-tail-wedged',
                    reason: options.reason || '',
                    result: 'timed-out',
                    resultReason: 'running-update-timed-out',
                    details: getStorageContextJournalDetails(storageContext)
                })
            }
            incrementQueueWakeupMetric(storageContext.timeoutPhase)
            incrementQueueWakeupMetric(`storageUpdate.${storageContext.timeoutPhase}`)
            reject(new Error(`space-feed storage update timed out after ${timeoutMs}ms`))
        }, timeoutMs)
    })

    const callerPromise = Promise.race([
        updatePromise,
        timeoutPromise
    ]).finally(() => {
        clearTimeout(timeoutId)
    }).catch(error => {
        storageContext.fallbackReturned = true
        incrementQueueWakeupMetric('storageUpdate.fallbackReturned')
        finishQueueWakeupMetricCycle(cycle, 'timed-out', error?.message || 'storage-update-failed', {
            ...getStorageContextJournalDetails(storageContext),
            timeoutMs
        })
        return options.failureValue ?? false
    })

    updatePromise.finally(() => {
        if(abandonedSpaceFeedStorageUpdates.has(updateToken)) {
            storageContext.abandoned = true
            incrementQueueWakeupMetric('storageUpdate.abandoned')
            pushQueueWakeupJournalEntry({
                kind: 'storage',
                name: 'storage-update-abandoned',
                reason: options.reason || '',
                result: 'abandoned',
                resultReason: 'completed-after-timeout',
                details: getStorageContextJournalDetails(storageContext)
            })
        }
        abandonedSpaceFeedStorageUpdates.delete(updateToken)
    }).catch(() => null)

    spaceFeedStorageUpdatePromise = updatePromise.catch(() => null)

    return callerPromise
}

function getProfileProgressStatusRank(status = '') {
    return {
        queued: 0,
        'tab-opening': 1,
        'tab-opened': 2,
        'awaiting-visibility': 3,
        'page-ready': 4,
        retrying: 5,
        muting: 6,
        blocking: 7,
        unmuting: 8,
        unblocking: 9
    }[`${status || ''}`.trim()] ?? -1
}

function profileProgressAttemptsMatch(left = {}, right = {}) {
    const leftAttemptId = getAttemptIdFromValue(left)
    const rightAttemptId = getAttemptIdFromValue(right)
    if(leftAttemptId && rightAttemptId && leftAttemptId !== rightAttemptId) return false

    const leftAttemptNumber = getAttemptNumberFromValue(left)
    const rightAttemptNumber = getAttemptNumberFromValue(right)
    if(leftAttemptNumber && rightAttemptNumber && leftAttemptNumber !== rightAttemptNumber) return false

    return true
}

function preserveAdvancedProfileProgress(previous = {}, next = {}) {
    const previousRank = getProfileProgressStatusRank(previous?.status || '')
    const nextRank = getProfileProgressStatusRank(next?.status || '')
    if(previousRank >= 0 && nextRank >= 0 && previousRank > nextRank && profileProgressAttemptsMatch(previous, next)) {
        next.status = previous.status
    }

    for(const key of [
        'tabOpenedAt',
        'contentOpenedAt',
        'actionReadyAt',
        'muteAttemptedAt',
        'mutedAt',
        'blockAttemptedAt',
        'blockedAt',
        'unmuteAttemptedAt',
        'unmutedAt',
        'unblockAttemptedAt',
        'unblockedAt'
    ]) {
        const previousValue = Number.isFinite(previous?.[key]) ? previous[key] : 0
        const nextValue = Number.isFinite(next?.[key]) ? next[key] : 0
        if(previousValue > nextValue && profileProgressAttemptsMatch(previous, next)) {
            next[key] = previousValue
        }
    }

    return next
}

function mergeStoredProfileProgressRecord(existing = null, incoming = null, normalizedHref = '') {
    const left = existing && typeof existing === 'object' ? existing : {}
    const right = incoming && typeof incoming === 'object' ? incoming : {}
    const leftUpdatedAt = Number.isFinite(left.updatedAt) ? left.updatedAt : 0
    const rightUpdatedAt = Number.isFinite(right.updatedAt) ? right.updatedAt : 0
    const newer = rightUpdatedAt >= leftUpdatedAt ? right : left
    const older = newer === right ? left : right

    const merged = {
        ...older,
        ...newer,
        profileHref: normalizedHref || newer.profileHref || older.profileHref || ''
    }

    if(shouldPreserveTerminalProfileProgress(older, newer)) {
        preserveTerminalProfileProgress(older, merged)
    }
    preserveAdvancedProfileProgress(older, merged)

    merged.updatedAt = Math.max(leftUpdatedAt, rightUpdatedAt, Date.now())

    if(left.postKeys || right.postKeys) {
        merged.postKeys = mergeUniqueStringList(left.postKeys || [], right.postKeys || [])
    }
    if(left.postUrls || right.postUrls) {
        merged.postUrls = mergeUniqueStringList(left.postUrls || [], right.postUrls || [])
    }

    const mergedEvents = mergeProfileProgressEvents(left.events || [], right.events || [])
    if(mergedEvents.length) {
        merged.events = mergedEvents
    }

    return merged
}

function normalizeStoredProfileNukeProgress(records) {
    const nextRecords = {}
    const entries = Object.entries(records || {})
        .filter(([key, value]) => !!key && value && typeof value === 'object')
        .sort((left, right) => {
            const leftUpdatedAt = Number.isFinite(left[1]?.updatedAt) ? left[1].updatedAt : 0
            const rightUpdatedAt = Number.isFinite(right[1]?.updatedAt) ? right[1].updatedAt : 0
            return leftUpdatedAt - rightUpdatedAt || left[0].localeCompare(right[0])
        })

    for(const [key, value] of entries) {
        const normalizedHref = normalizeQuoraProfileUrl(value?.profileHref || key || '')
        if(!normalizedHref) continue

        nextRecords[normalizedHref] = mergeStoredProfileProgressRecord(
            nextRecords[normalizedHref] || null,
            value,
            normalizedHref
        )
    }

    return pruneProfileNukeProgress(nextRecords)
}

function preserveTerminalProfileProgress(previous = {}, next = {}) {
    for(const key of [
        'status',
        'blockSucceeded',
        'unblockSucceeded',
        'foundBlockedBeforeQueue',
        'finalError',
        'terminalAt',
        'blockedAt',
        'unblockedAt',
        'unavailableReason'
    ]) {
        if(previous[key] !== undefined) next[key] = previous[key]
    }

    return next
}

function shouldPreserveTerminalProfileProgress(previous = {}, incoming = {}) {
    if(!isTerminalProfileNukeRecord(previous)) return false

    const previousActionKind = `${previous.actionKind || 'mute-block'}`.trim()
    const incomingActionKind = `${incoming.actionKind || previousActionKind}`.trim()
    if(previousActionKind !== incomingActionKind) return false

    const previousAttemptId = getAttemptIdFromValue(previous)
    const incomingAttemptId = getAttemptIdFromValue(incoming)
    if(previousAttemptId && incomingAttemptId && previousAttemptId !== incomingAttemptId) return false

    const previousAttemptNumber = getAttemptNumberFromValue(previous)
    const incomingAttemptNumber = getAttemptNumberFromValue(incoming)
    if(previousAttemptNumber && incomingAttemptNumber && previousAttemptNumber !== incomingAttemptNumber) return false

    if(isTransientProfileNukeStatus(incoming?.status)) return true

    const incomingMapped = mapProgressToCoordinatorState(incoming)
    return isSuccessfulProfileNukeRecord(previous) &&
        (incomingMapped.status === 'failed' || incomingMapped.status === 'skipped')
}

function normalizeProgressPatch(profileHref, patch = {}, existing = null) {
    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    if(!normalizedHref) return null

    const replaceProgressRecord = patch?.replaceProgressRecord === true
    const cleanPatch = {
        ...patch
    }
    delete cleanPatch.replaceProgressRecord

    const previous = replaceProgressRecord ? {} : existing || profileNukeProgress?.[normalizedHref] || {}
    const preserveTerminal = !replaceProgressRecord && shouldPreserveTerminalProfileProgress(previous, cleanPatch)
    const next = {
        ...previous,
        ...cleanPatch,
        profileHref: normalizedHref,
        updatedAt: Date.now()
    }

    if(preserveTerminal) {
        preserveTerminalProfileProgress(previous, next)
    }
    if(!replaceProgressRecord) {
        preserveAdvancedProfileProgress(previous, next)
    }

    const resetQueuedProgress = cleanPatch.status === 'queued' && !preserveTerminal
    if(resetQueuedProgress) {
        Object.assign(next, {
            status: 'queued',
            attemptId: getAttemptIdFromValue(cleanPatch),
            attemptNumber: getAttemptNumberFromValue(cleanPatch),
            tabId: null,
            ownerTabId: null,
            ownerWindowId: null,
            tabCreatedAt: 0,
            tabOpenedAt: 0,
            contentOpenedAt: 0,
            actionReadyAt: 0,
            muteAttempted: false,
            muteAttemptedAt: 0,
            mutedAt: 0,
            muteSucceeded: false,
            blockAttempted: false,
            blockAttemptedAt: 0,
            blockedAt: 0,
            blockSucceeded: false,
            unmuteAttemptedAt: 0,
            unmutedAt: 0,
            unblockAttemptedAt: 0,
            unblockedAt: 0,
            unblockSucceeded: false,
            terminalAt: 0,
            tabClosedAt: 0,
            slotReleasedAt: 0,
            closeRequestedAt: 0,
            closedByExtension: false,
            closeReason: '',
            foregroundLeaseAcquiredAt: 0,
            foregroundPromotedAt: 0,
            foregroundPromotionReason: '',
            foregroundWaitLastEventAt: 0,
            foregroundWaitReason: '',
            foundBlockedBeforeQueue: false,
            openedViablePage: false,
            lastUrl: '',
            muteError: '',
            blockError: '',
            finalError: '',
            unblockReason: '',
            unmuteReason: '',
            selectedActionLabel: '',
            selectedActionRect: null,
            menuActionLabels: [],
            visibleProfileMenuLabels: [],
            profileMenuOpen: false,
            profileBlocked: false,
            events: []
        })
    }
    else {
        const patchAttemptId = getAttemptIdFromValue(cleanPatch)
        const patchAttemptNumber = getAttemptNumberFromValue(cleanPatch)
        if(patchAttemptId) next.attemptId = patchAttemptId
        if(patchAttemptNumber) next.attemptNumber = patchAttemptNumber
    }

    if(next.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
        next.blockSucceeded = false
        next.foundBlockedBeforeQueue = false
    }

    if(
        !preserveTerminal &&
        cleanPatch.status !== 'queued' &&
        previous.actionKind === next.actionKind &&
        isTerminalProfileNukeRecord(previous) &&
        !isTerminalProfileNukeRecord(next)
    ) {
        preserveTerminalProfileProgress(previous, next)
    }

    if(next.blockSucceeded && next.status === 'interrupted') {
        next.status = next.foundBlockedBeforeQueue ? 'already-blocked' : 'blocked'
        next.finalError = ''
    }

    if(cleanPatch.postKeys || previous.postKeys) {
        next.postKeys = mergeUniqueStringList(previous.postKeys || [], cleanPatch.postKeys || [])
    }
    if(cleanPatch.postUrls || previous.postUrls) {
        next.postUrls = mergeUniqueStringList(previous.postUrls || [], cleanPatch.postUrls || [])
    }

    const event = `${cleanPatch.event || ''}`.trim()
    if(event) {
        const previousEvents = resetQueuedProgress
            ? []
            : Array.isArray(previous.events) ? previous.events : []
        next.events = [
            ...previousEvents,
            `${new Date().toISOString()} ${event}`
        ].slice(-12)
    }

    const successChanged = isSuccessfulProfileNukeRecord(next) && !isSuccessfulProfileNukeRecord(previous)
    if(isTerminalProfileNukeRecord(next) && (successChanged || !(Number.isFinite(next.terminalAt) && next.terminalAt > 0))) {
        next.terminalAt = Date.now()
    }

    delete next.event
    return next
}

function addSenderTabIdToProgressPatch(patch = {}, senderTabId = null) {
    const normalizedTabId = normalizeTabId(patch?.tabId || senderTabId)
    if(!normalizedTabId) return patch

    return {
        ...patch,
        tabId: normalizedTabId
    }
}

async function normalizeProfileNukeProgressStorage(options = {}) {
    const stored = await metricStorageGet({[PROFILE_NUKE_PROGRESS_KEY]: {}})
    const storedProgress = stored?.[PROFILE_NUKE_PROGRESS_KEY] || {}
    const nextProgress = normalizeStoredProfileNukeProgress(storedProgress)
    const changed = JSON.stringify(nextProgress) !== JSON.stringify(storedProgress)
    profileNukeProgress = nextProgress

    if(!changed) {
        return {normalized: true, changed: false, profileNukeProgress: nextProgress}
    }
    if(options.persist === false) {
        return {normalized: true, changed: true, persisted: false, profileNukeProgress: nextProgress}
    }

    return enqueueSpaceFeedStorageUpdate(async () => {
        const lockedStored = await metricStorageGet({[PROFILE_NUKE_PROGRESS_KEY]: {}})
        const lockedStoredProgress = lockedStored?.[PROFILE_NUKE_PROGRESS_KEY] || {}
        const lockedProgress = normalizeStoredProfileNukeProgress(lockedStoredProgress)
        const lockedChanged = JSON.stringify(lockedProgress) !== JSON.stringify(lockedStoredProgress)
        profileNukeProgress = lockedProgress
        if(lockedChanged) {
            await saveCoordinatorState({progress: lockedProgress}, {
                progress: true,
                reason: 'compatibilityFlush'
            })
        }
        return {normalized: true, changed: lockedChanged, profileNukeProgress: lockedProgress}
    })
}

async function loadProfileNukeProgress() {
    try {
        await normalizeProfileNukeProgressStorage({persist: false})
    }
    catch {
        profileNukeProgress = {}
    }
}

let profileNukeProgressReady = null
let profileNukeProgressCompatibilityFlushTimeout = null

function ensureProfileNukeProgressReady() {
    if(!profileNukeProgressReady) {
        profileNukeProgressReady = loadProfileNukeProgress()
    }
    return profileNukeProgressReady
}

function scheduleProfileNukeProgressCompatibilityFlush(reason = 'row-event') {
    if(profileNukeProgressCompatibilityFlushTimeout) {
        incrementQueueWakeupMetric('progress.compatibilityFlushCoalesced')
        return
    }

    incrementQueueWakeupMetric('progress.compatibilityFlushScheduled')
    profileNukeProgressCompatibilityFlushTimeout = setTimeout(() => {
        profileNukeProgressCompatibilityFlushTimeout = null
        void persistProfileNukeProgress().catch(error => {
            incrementQueueWakeupMetric('progress.compatibilityFlushFailed')
            recordCoordinatorDiagnosticEvent('progress-compatibility-flush-failed', error?.message || `${reason || 'row-event'} compatibility flush failed`)
        })
    }, PROFILE_NUKE_PROGRESS_COMPATIBILITY_FLUSH_MS)
}

async function persistProfileNukeProgress() {
    if(spaceFeedStorageUpdateDepth > 0) {
        return persistProfileNukeProgressLocked()
    }

    return enqueueSpaceFeedStorageUpdate(persistProfileNukeProgressLocked)
}

async function persistProfileNukeProgressLocked() {
    profileNukeProgress = pruneProfileNukeProgress(profileNukeProgress)

    try {
        await saveCoordinatorState({progress: profileNukeProgress}, {
            progress: true,
            reason: 'compatibilityFlush'
        })
        return true
    }
    catch {
        return false
    }
}

async function recordProfileNukeProgress(profileHref, patch = {}) {
    if(spaceFeedStorageUpdateDepth > 0) {
        return recordProfileNukeProgressLocked(profileHref, patch)
    }

    return enqueueSpaceFeedStorageUpdate(() => recordProfileNukeProgressLocked(profileHref, patch))
}

async function recordProfileNukeProgressLocked(profileHref, patch = {}) {
    await ensureProfileNukeProgressReady()

    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    if(!normalizedHref) return null

    incrementQueueWakeupMetric('progress.recordReceived')
    const nextRecord = normalizeProgressPatch(normalizedHref, patch)
    if(!nextRecord) return null

    profileNukeProgress = {
        ...profileNukeProgress,
        [normalizedHref]: nextRecord
    }
    await persistProfileNukeProgressLocked()
    await syncCoordinatorProgressRecordsLocked({[normalizedHref]: nextRecord})
    return nextRecord
}

async function recordProfileNukeProgressBatch(updates = []) {
    if(spaceFeedStorageUpdateDepth > 0) {
        return recordProfileNukeProgressBatchLocked(updates)
    }

    return enqueueSpaceFeedStorageUpdate(() => recordProfileNukeProgressBatchLocked(updates))
}

async function recordProfileNukeProgressBatchLocked(updates = []) {
    await ensureProfileNukeProgressReady()

    const updateCount = Array.isArray(updates) ? updates.length : 0
    if(updateCount > 0) {
        incrementQueueWakeupMetric('progress.batchReceived')
        incrementQueueWakeupMetric('progress.recordReceived', updateCount)
        incrementQueueWakeupMetric('progress.recordsPerBatch', updateCount)
    }

    let changed = false
    const nextProgress = {
        ...profileNukeProgress
    }
    const syncedRecords = {}

    for(const update of updates) {
        const normalizedHref = normalizeQuoraProfileUrl(update?.profileHref || update?.href || '')
        if(!normalizedHref) continue

        const nextRecord = normalizeProgressPatch(normalizedHref, update?.patch || {}, nextProgress[normalizedHref] || null)
        if(!nextRecord) continue

        nextProgress[normalizedHref] = nextRecord
        syncedRecords[normalizedHref] = nextRecord
        changed = true
    }

    if(!changed) return false

    profileNukeProgress = nextProgress
    await persistProfileNukeProgressLocked()
    await syncCoordinatorProgressRecordsLocked(syncedRecords)
    return true
}

function removeProfileHrefFromPendingSpaceRecords(records = {}, profileHrefs = []) {
    const hrefs = new Set(getNormalizedProfileHrefList(Array.isArray(profileHrefs) ? profileHrefs : [profileHrefs]))
    if(!hrefs.size) return {records: {...records}, changed: false}

    const nextRecords = {
        ...records
    }
    let changed = false

    for(const [postKey, record] of Object.entries(records || {})) {
        const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
        const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
        const nextAllUrls = allUrls.filter(url => !hrefs.has(url))
        const nextRemainingUrls = remainingUrls.filter(url => !hrefs.has(url))

        if(nextAllUrls.length === allUrls.length && nextRemainingUrls.length === remainingUrls.length) {
            continue
        }

        changed = true
        if(nextAllUrls.length <= 0 && nextRemainingUrls.length <= 0) {
            delete nextRecords[postKey]
            continue
        }

        nextRecords[postKey] = {
            ...record,
            allUrls: nextAllUrls,
            remainingUrls: nextRemainingUrls,
            ...getPendingSpaceFeedJobKeyPatch(record, nextRemainingUrls),
            updatedAt: Date.now()
        }
    }

    return {records: nextRecords, changed}
}

function removeProfileHrefFromRememberedNukedPosts(records = {}, profileHrefs = []) {
    const hrefs = new Set(getNormalizedProfileHrefList(Array.isArray(profileHrefs) ? profileHrefs : [profileHrefs]))
    if(!hrefs.size) return {records: {...records}, changed: false}

    const nextRecords = {
        ...records
    }
    let changed = false

    for(const [postKey, record] of Object.entries(records || {})) {
        const urls = getNormalizedProfileHrefList(record?.urls || [])
        const nextUrls = urls.filter(url => !hrefs.has(url))
        if(nextUrls.length === urls.length) continue

        changed = true
        if(nextUrls.length <= 0) {
            delete nextRecords[postKey]
            continue
        }

        nextRecords[postKey] = {
            ...record,
            urls: nextUrls,
            updatedAt: Date.now()
        }
    }

    return {records: nextRecords, changed}
}

function removeProfileHrefFromCoordinatorRuns(runs = {}, queue = {}, normalizedHref = '') {
    const nextRuns = {
        ...runs
    }
    const affectedRunIds = new Set(getCoordinatorRunIdsForHref(runs, normalizedHref))
    let changed = false

    for(const [runId, run] of Object.entries(runs || {})) {
        const targetProfileHrefs = getCoordinatorRunTargetHrefs(run)
        if(!targetProfileHrefs.includes(normalizedHref)) continue

        affectedRunIds.add(runId)
        nextRuns[runId] = {
            ...run,
            targetProfileHrefs: targetProfileHrefs.filter(href => href !== normalizedHref),
            updatedAt: Date.now()
        }
        changed = true
    }

    const recomputedRuns = affectedRunIds.size
        ? recomputeCoordinatorRuns(queue, nextRuns, affectedRunIds)
        : nextRuns

    return {
        runs: recomputedRuns,
        changed: changed || JSON.stringify(recomputedRuns) !== JSON.stringify(runs)
    }
}

async function clearProfileNukeState(profileHref = '', reason = '') {
    await ensureProfileNukeProgressReady()

    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    if(!normalizedHref) {
        return {cleared: false, reason: 'invalid-profile-href'}
    }

    return enqueueSpaceFeedStorageUpdate(async () => {
        const stored = await metricStorageGet({
            [PROFILE_NUKE_PROGRESS_KEY]: {},
            [COORDINATOR_QUEUE_KEY]: {},
            [COORDINATOR_RUNS_KEY]: {},
            [SPACE_PENDING_NUKED_POSTS_KEY]: {},
            [SPACE_NUKED_POSTS_KEY]: {}
        })
        const progress = normalizeStoredProfileNukeProgress(stored[PROFILE_NUKE_PROGRESS_KEY] || {})
        const queue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY])
        const runs = normalizeCoordinatorMap(stored[COORDINATOR_RUNS_KEY])
        const pendingPosts = stored[SPACE_PENDING_NUKED_POSTS_KEY] || {}
        const nukedPosts = stored[SPACE_NUKED_POSTS_KEY] || {}
        const nextProgress = {
            ...progress
        }
        const nextQueue = {
            ...queue
        }
        let progressChanged = false
        let queueChanged = false
        const matchingQueueEntries = Object.entries(queue || {})
            .filter(([itemKey, item]) => {
                const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
                return itemHref === normalizedHref
            })
        const preserveCoordinatorState = `${nextProgress[normalizedHref]?.actionKind || ''}` === UNBLOCK_UNMUTE_ACTION_KIND ||
            matchingQueueEntries.some(([, item]) => `${item?.actionKind || ''}` === UNBLOCK_UNMUTE_ACTION_KIND)

        if(nextProgress[normalizedHref] && !preserveCoordinatorState) {
            delete nextProgress[normalizedHref]
            progressChanged = true
        }

        for(const [itemKey] of matchingQueueEntries) {
            if(preserveCoordinatorState) continue
            delete nextQueue[itemKey]
            queueChanged = true
        }

        const pendingResult = removeProfileHrefFromPendingSpaceRecords(pendingPosts, normalizedHref)
        const nukedResult = removeProfileHrefFromRememberedNukedPosts(nukedPosts, normalizedHref)
        const runsResult = preserveCoordinatorState
            ? {runs, changed: false}
            : removeProfileHrefFromCoordinatorRuns(runs, nextQueue, normalizedHref)
        const payload = {}

        if(progressChanged) {
            profileNukeProgress = nextProgress
            payload[PROFILE_NUKE_PROGRESS_KEY] = nextProgress
        }
        if(queueChanged) {
            payload[COORDINATOR_QUEUE_KEY] = nextQueue
        }
        if(runsResult.changed) {
            payload[COORDINATOR_RUNS_KEY] = runsResult.runs
        }
        if(pendingResult.changed) {
            payload[SPACE_PENDING_NUKED_POSTS_KEY] = pendingResult.records
        }
        if(nukedResult.changed) {
            payload[SPACE_NUKED_POSTS_KEY] = getPrunedNukedPosts(nukedResult.records, {
                retentionDays: defaults.nukedPostRetentionDays,
                maxEntries: defaults.maxRememberedNukedPosts
            })
        }

        if(Object.keys(payload).length) {
            await metricStorageSet(payload, {
                snapshotWriteReason: 'ordinaryMutation',
                queueOperation: 'clear-profile',
                queueChangedRows: queueChanged ? 1 : 0
            })
        }

        return {
            cleared: !!Object.keys(payload).length,
            reason,
            profileHref: normalizedHref,
            progressChanged,
            queueChanged,
            runsChanged: runsResult.changed,
            coordinatorStatePreserved: preserveCoordinatorState,
            pendingChanged: pendingResult.changed,
            nukedChanged: nukedResult.changed,
            profileNukeProgress: payload[PROFILE_NUKE_PROGRESS_KEY] || nextProgress,
            pendingPosts: payload[SPACE_PENDING_NUKED_POSTS_KEY] || pendingPosts,
            nukedPosts: payload[SPACE_NUKED_POSTS_KEY] || nukedPosts
        }
    })
}

async function removePendingSpaceFeedUrls(urls = []) {
    return enqueueSpaceFeedStorageUpdate(async () => {
        const normalizedUrls = new Set(getNormalizedProfileHrefList(urls))
        if(!normalizedUrls.size) return {changed: false, pendingPosts: null}

        const stored = await metricStorageGet({[SPACE_PENDING_NUKED_POSTS_KEY]: {}})
        const currentPending = stored?.[SPACE_PENDING_NUKED_POSTS_KEY] || {}
        let changed = false
        const nextPending = {
            ...currentPending
        }

        for(const [postKey, record] of Object.entries(currentPending || {})) {
            const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
            const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
            const nextAllUrls = allUrls.filter(url => !normalizedUrls.has(normalizeQuoraProfileUrl(url)))
            const nextRemainingUrls = remainingUrls.filter(url => !normalizedUrls.has(normalizeQuoraProfileUrl(url)))

            if(nextAllUrls.length === allUrls.length && nextRemainingUrls.length === remainingUrls.length) {
                continue
            }

            changed = true

            if(nextRemainingUrls.length <= 0) {
                delete nextPending[postKey]
                continue
            }

            nextPending[postKey] = {
                ...record,
                allUrls: nextAllUrls,
                remainingUrls: nextRemainingUrls,
                ...getPendingSpaceFeedJobKeyPatch(record, nextRemainingUrls),
                updatedAt: Date.now()
            }
        }

        if(changed) {
            await metricStorageSet({[SPACE_PENDING_NUKED_POSTS_KEY]: nextPending}, {
                snapshotWriteReason: 'userMemoryNonAuthority'
            })
        }

        return {changed, pendingPosts: nextPending}
    })
}

async function removePendingSpaceFeedEntries(postKeys = []) {
    return enqueueSpaceFeedStorageUpdate(async () => {
        const resolverPostKeys = new Set((Array.isArray(postKeys) ? postKeys : [])
            .map(postKey => `${postKey || ''}`.trim())
            .filter(Boolean))
        if(!resolverPostKeys.size) return {changed: false, pendingPosts: null}

        const stored = await metricStorageGet({[SPACE_PENDING_NUKED_POSTS_KEY]: {}})
        const currentPending = stored?.[SPACE_PENDING_NUKED_POSTS_KEY] || {}
        let changed = false
        const nextPending = {
            ...currentPending
        }

        for(const postKey of resolverPostKeys) {
            const record = nextPending[postKey]
            if(record?.resolverPending !== true) continue

            const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
            changed = true
            if(!remainingUrls.length) {
                delete nextPending[postKey]
                continue
            }

            nextPending[postKey] = {
                ...record,
                resolverPending: false,
                resolverUrl: '',
                updatedAt: Date.now()
            }
        }

        if(changed) {
            await metricStorageSet({[SPACE_PENDING_NUKED_POSTS_KEY]: nextPending}, {
                snapshotWriteReason: 'userMemoryNonAuthority'
            })
        }

        return {changed, pendingPosts: nextPending}
    })
}

async function confirmSpaceFeedProfilesBlocked(profileHrefs = []) {
    return enqueueSpaceFeedStorageUpdate(async () => {
        const confirmedHrefs = new Set(getNormalizedProfileHrefList(profileHrefs))
        if(!confirmedHrefs.size) return {confirmed: false, pendingPosts: null, nukedPosts: null}

        const stored = await metricStorageGet({
            [SPACE_PENDING_NUKED_POSTS_KEY]: {},
            [SPACE_NUKED_POSTS_KEY]: {}
        })
        const currentPending = stored?.[SPACE_PENDING_NUKED_POSTS_KEY] || {}
        const currentNuked = stored?.[SPACE_NUKED_POSTS_KEY] || {}
        const result = settleConfirmedSpaceFeedProfiles(currentPending, currentNuked, confirmedHrefs)

        if(!result.changedPending && !result.changedNuked) {
            await syncCoordinatorProgressForHrefsLocked(confirmedHrefs)
            return {confirmed: false, pendingPosts: result.nextPending, nukedPosts: result.nextNuked}
        }

        const prunedNuked = result.changedNuked
            ? getPrunedNukedPosts(result.nextNuked, {
                retentionDays: defaults.nukedPostRetentionDays,
                maxEntries: defaults.maxRememberedNukedPosts
            })
            : result.nextNuked
        const payload = {
            [SPACE_PENDING_NUKED_POSTS_KEY]: result.nextPending
        }

        if(result.changedNuked) {
            payload[SPACE_NUKED_POSTS_KEY] = prunedNuked
        }

        await metricStorageSet(payload, {
            snapshotWriteReason: 'userMemoryNonAuthority'
        })
        await syncCoordinatorProgressForHrefsLocked(confirmedHrefs)
        return {confirmed: true, pendingPosts: result.nextPending, nukedPosts: prunedNuked}
    })
}

async function syncCoordinatorProgressForHrefs(profileHrefs = []) {
    return enqueueSpaceFeedStorageUpdate(() => syncCoordinatorProgressForHrefsLocked(profileHrefs))
}

async function syncCoordinatorProgressForHrefsLocked(profileHrefs = []) {
    const hrefs = getNormalizedProfileHrefList(Array.from(profileHrefs || []))
    if(!hrefs.length) return false

    try {
        const stored = await metricStorageGet({[PROFILE_NUKE_PROGRESS_KEY]: {}})
        const progress = normalizeStoredProfileNukeProgress(stored?.[PROFILE_NUKE_PROGRESS_KEY] || {})
        const records = {}

        for(const href of hrefs) {
            if(progress[href]) records[href] = progress[href]
        }

        if(!Object.keys(records).length) return false
        return syncCoordinatorProgressRecordsLocked(records)
    }
    catch {
        return false
    }
}

async function syncSuccessfulCoordinatorProgress(profileHref = '', progressRecord = null) {
    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    if(!normalizedHref) return false

    try {
        const record = progressRecord || profileNukeProgress?.[normalizedHref] || null
        if(record) {
            await enqueueCoordinatorProgressSync({[normalizedHref]: record})
        }
        await confirmSpaceFeedProfilesBlocked([normalizedHref])
        return true
    }
    catch {
        return false
    }
}

function getQueuedTabMetadata(tabId) {
    return queuedTabMetadata.get(tabId) || null
}

function setQueuedTabMetadata(tabId, metadata = {}) {
    if(!tabId) return
    if(!activeQueuedTabs.has(tabId) && !queuedTabMetadata.has(tabId)) return
    queuedTabMetadata.set(tabId, {
        ...(queuedTabMetadata.get(tabId) || {}),
        ...metadata,
        updatedAt: Date.now()
    })
}

function remapQueuedTabToResolvedProfile(tabId, item = {}, resolvedHref = '', requestedUrl = '') {
    if(!tabId || !resolvedHref) return

    const metadata = getQueuedTabMetadata(tabId) || {}
    const action = pendingTabActions.get(tabId) || null
    const nextRequestedUrl = normalizeCoordinatorRequestedUrl(
        requestedUrl || item.requestedUrl || metadata.requestedUrl || action?.requestedUrl || resolvedHref
    )
    const tabAction = metadata.tabAction || action?.action || item.tabAction || item.executorTabAction || 'nuke'
    const actionKind = metadata.actionKind ||
        action?.actionKind ||
        item.actionKind ||
        getCoordinatorActionKindForRequestedAction(tabAction)
    const attemptId = getAttemptIdFromValue(metadata) ||
        getAttemptIdFromValue(action) ||
        getAttemptIdFromValue(item)
    const attemptNumber = getAttemptNumberFromValue(metadata) ||
        getAttemptNumberFromValue(action) ||
        getAttemptNumberFromValue(item)

    setQueuedTabMetadata(tabId, {
        profileHref: resolvedHref,
        coordinatorKey: resolvedHref,
        requestedUrl: nextRequestedUrl,
        resolveProfileFromPage: false,
        resolutionMode: '',
        resolutionReason: '',
        tabAction,
        actionKind,
        attemptId,
        attemptNumber,
        lastUrl: resolvedHref
    })

    if(action) {
        pendingTabActions.set(tabId, {
            ...action,
            action: tabAction,
            targetUrl: resolvedHref,
            profileHref: resolvedHref,
            coordinatorKey: resolvedHref,
            requestedUrl: nextRequestedUrl,
            resolveProfileFromPage: false,
            resolutionMode: '',
            resolutionReason: '',
            actionKind,
            attemptId,
            attemptNumber
        })
    }
}

function clearQueuedTabMetadata(tabId) {
    if(!tabId) return
    queuedTabMetadata.delete(tabId)
}

function normalizeCoordinatorActionLease(lease = null) {
    if(!lease || typeof lease !== 'object') return null

    const tabId = normalizeTabId(lease.tabId || null)
    const attemptId = normalizeAttemptId(lease.attemptId || '')
    if(!tabId || !attemptId) return null

    const grantedAt = Number.parseInt(lease.grantedAt, 10) || 0
    const heartbeatAt = Number.parseInt(lease.heartbeatAt, 10) || grantedAt
    const expiresAt = Number.parseInt(lease.expiresAt, 10) || 0

    return {
        kind: `${lease.kind || 'profile-menu'}`.trim() || 'profile-menu',
        actionKind: getCoordinatorActionKindForRequestedAction(lease.actionKind || ''),
        profileHref: normalizeQuoraProfileUrl(lease.profileHref || ''),
        tabId,
        attemptId,
        attemptNumber: Number.parseInt(lease.attemptNumber, 10) || 0,
        grantedAt,
        heartbeatAt,
        expiresAt,
        reason: `${lease.reason || ''}`.trim()
    }
}

function isCoordinatorActionLeaseExpired(lease = null, now = Date.now()) {
    const normalizedLease = normalizeCoordinatorActionLease(lease)
    if(!normalizedLease) return true
    return normalizedLease.expiresAt > 0 && now >= normalizedLease.expiresAt
}

function isCoordinatorActionLeaseHolder(lease = null, tabId = null, attemptId = '') {
    const normalizedLease = normalizeCoordinatorActionLease(lease)
    const normalizedTabId = normalizeTabId(tabId)
    const normalizedAttemptId = normalizeAttemptId(attemptId)

    return !!normalizedLease &&
        !!normalizedTabId &&
        !!normalizedAttemptId &&
        normalizedLease.tabId === normalizedTabId &&
        normalizedLease.attemptId === normalizedAttemptId
}

function clearExpiredCoordinatorActionLeases(queue = {}, now = Date.now()) {
    let changed = false
    for(const [key, item] of Object.entries(queue || {})) {
        if(!item?.actionLease) continue
        if(!isTerminalCoordinatorStatus(item.status) && !isCoordinatorActionLeaseExpired(item.actionLease, now)) continue

        queue[key] = {
            ...item,
            actionLease: null,
            actionLeaseReleasedAt: now,
            actionLeaseReleaseReason: isTerminalCoordinatorStatus(item.status)
                ? 'terminal-row'
                : 'expired'
        }
        changed = true
    }

    return changed
}

function findActiveCoordinatorActionLease(queue = {}, now = Date.now()) {
    for(const [key, item] of Object.entries(queue || {})) {
        if(!item || isTerminalCoordinatorStatus(item.status)) continue
        const lease = normalizeCoordinatorActionLease(item.actionLease)
        if(!lease || isCoordinatorActionLeaseExpired(lease, now)) continue

        return {
            key,
            item,
            lease
        }
    }

    return null
}

function makeCoordinatorActionLease(item = {}, request = {}, sender = {}, now = Date.now()) {
    const tabId = normalizeTabId(sender.tab?.id || request.tabId || item.tabId || null)
    const attemptId = normalizeAttemptId(request.attemptId || getAttemptIdFromValue(item))
    if(!tabId || !attemptId) return null

    return {
        kind: 'profile-menu',
        actionKind: getCoordinatorActionKindForRequestedAction(request.actionKind || item.actionKind || ''),
        profileHref: getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(request.profileHref || ''),
        tabId,
        attemptId,
        attemptNumber: Number.parseInt(request.attemptNumber || getAttemptNumberFromValue(item), 10) || 0,
        grantedAt: now,
        heartbeatAt: now,
        expiresAt: now + ACTION_LEASE_MS,
        reason: `${request.reason || ''}`.trim()
    }
}

async function mutateCoordinatorProjection(operation = {}) {
    const kind = `${operation.kind || ''}`.trim()

    if(kind === 'requestActionLease') {
        return mutateCoordinatorActionLeaseRequest(operation)
    }
    if(kind === 'heartbeatActionLease') {
        return mutateCoordinatorActionLeaseHeartbeat(operation)
    }
    if(kind === 'releaseActionLease') {
        return mutateCoordinatorActionLeaseRelease(operation)
    }
    if(kind === 'releaseActionLeasesForTab') {
        return mutateCoordinatorActionLeasesForTabRelease(operation)
    }
    if(kind === 'setCoordinatorRunsPaused') {
        return mutateCoordinatorRunsPausedSet(operation)
    }
    if(kind === 'setPauseState') {
        return mutateCoordinatorPauseStateSet(operation)
    }
    if(kind === 'pauseStoredWork') {
        return mutateCoordinatorStoredWorkPause(operation)
    }
    if(kind === 'cancelStoredWork') {
        return mutateCoordinatorStoredWorkCancel(operation)
    }
    if(kind === 'cancelStoredWorkItem') {
        return mutateCoordinatorStoredWorkItemCancel(operation)
    }
    if(kind === 'transitionQueuedTabActive') {
        return mutateCoordinatorQueuedTabActiveTransition(operation)
    }
    if(kind === 'rollbackFailedQueuedTabOpen') {
        return mutateCoordinatorQueuedTabOpenRollback(operation)
    }
    if(kind === 'advanceStaleRetryQueuedTab') {
        return mutateCoordinatorStaleRetryQueuedTabAdvance(operation)
    }
    if(kind === 'terminalizeKeyOnlyCoordinatorItem') {
        return mutateCoordinatorKeyOnlyItemTerminalize(operation)
    }
    if(kind === 'reconcileActiveWithoutRuntimeActor') {
        return mutateCoordinatorActiveWithoutRuntimeActorReconcile(operation)
    }
    if(kind === 'terminalizeActiveNonProfileLanding') {
        return mutateCoordinatorActiveNonProfileLandingTerminalize(operation)
    }

    return {
        changed: false,
        reason: 'unsupported-operation',
        kind
    }
}

async function mutateCoordinatorQueuedTabActiveTransition(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(snapshotReason !== 'ordinaryMutation') return false

    return transitionCoordinatorItemForQueuedTabLocked(
        operation.action || {},
        operation.tab || {},
        operation.details || {},
        operation.href || '',
        operation.coordinatorKey || ''
    )
}

async function mutateCoordinatorRunsPausedSet(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(snapshotReason !== 'ordinaryMutation') return {changed: false, reason: 'invalid-runs-paused-reason'}

    const paused = operation.paused === true
    const state = await loadCoordinatorState()
    const queue = state.queue
    const runs = normalizeCoordinatorMap(state.runs)
    const nextRuns = {...runs}
    const affectedRunIds = new Set()
    let changed = false

    for(const [runId, run] of Object.entries(runs)) {
        const runItems = getCoordinatorRunItems(queue, runId, run)
        if(!runItems.some(item => isPendingCoordinatorStatus(item?.status))) continue
        nextRuns[runId] = {
            ...run,
            paused,
            status: paused ? 'paused' : 'active',
            updatedAt: Date.now()
        }
        affectedRunIds.add(runId)
        changed = true
    }

    if(!changed) return {changed: false}
    const recomputedRuns = recomputeCoordinatorRuns(queue, nextRuns, affectedRunIds)
    await saveCoordinatorState({runs: recomputedRuns}, {runs: true, reason: 'ordinaryMutation'})
    return {changed: true}
}

async function mutateCoordinatorStoredWorkPause(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(snapshotReason !== 'ordinaryMutation') {
        return {pausedUrls: [], pausedWorkKeys: [], ownedTabIds: [], reason: 'invalid-pause-reason'}
    }

    const reason = `${operation.pauseReason || 'coordinator-pause-request'}`.trim()
    const pauseGeneration = Number.parseInt(operation.pauseGeneration, 10) || 0
    if(pauseGeneration && !await isCoordinatorPauseGenerationCurrent(pauseGeneration)) {
        return {pausedUrls: [], pausedWorkKeys: [], ownedTabIds: [], stalePause: true}
    }

    const state = await loadCoordinatorState()
    const queue = {
        ...state.queue
    }
    const progress = {
        ...state.progress
    }
    const runs = normalizeCoordinatorMap(state.runs)
    const now = Date.now()
    const affectedRunIds = new Set()
    const pausedUrls = []
    const pausedWorkKeys = []
    const ownedTabIds = new Set()
    let queueChanged = false
    let progressChanged = false

    for(const [itemKey, item] of Object.entries(queue || {})) {
        if(!item || typeof item !== 'object') continue

        const status = `${item.status || ''}`.trim()
        if(!isPendingCoordinatorStatus(status)) continue

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
        if(!href && !coordinatorKey) continue

        const existingProgress = href ? progress[href] || profileNukeProgress?.[href] || null : null
        const tabId = getPersistedQueuedTabId(item, existingProgress)
        if(tabId) ownedTabIds.add(tabId)

        if(status !== 'queued') {
            queue[itemKey] = buildPausedCoordinatorQueueItem(item, now, reason)
            queueChanged = true
        }
        if(href) pausedUrls.push(href)
        else pausedWorkKeys.push(coordinatorKey)

        if(queue[itemKey].runId) affectedRunIds.add(queue[itemKey].runId)
        if(href) {
            for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
                affectedRunIds.add(runId)
            }
        }

        if(href) {
            const resetRecord = normalizeProgressPatch(
                href,
                buildQueuedCoordinatorProgressResetPatch(queue[itemKey], {
                    now,
                    runId: queue[itemKey].runId || '',
                    actionKind: queue[itemKey].actionKind || ''
                }),
                existingProgress
            )
            if(resetRecord && JSON.stringify(resetRecord) !== JSON.stringify(existingProgress || null)) {
                progress[href] = resetRecord
                progressChanged = true
            }
        }
    }

    if(pauseGeneration && (!isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration) ||
        !await isCoordinatorPauseGenerationCurrent(pauseGeneration))) {
        return {pausedUrls: [], pausedWorkKeys: [], ownedTabIds: Array.from(ownedTabIds), stalePause: true}
    }
    await mutateCoordinatorPauseStateSet({
        reason: 'ordinaryMutation',
        paused: true,
        pauseGeneration
    })
    if(pauseGeneration && !isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration)) {
        await restoreLatestCoordinatorPauseGenerationIfStale(pauseGeneration)
        scheduleCoordinatorPauseStateRepair('stale-pause-flag-repair')
        return {pausedUrls: [], pausedWorkKeys: [], ownedTabIds: Array.from(ownedTabIds), stalePause: true}
    }

    if(!queueChanged && !pausedUrls.length && !pausedWorkKeys.length) {
        return {pausedUrls: [], pausedWorkKeys: [], ownedTabIds: []}
    }

    const nextRunsBase = recomputeCoordinatorRuns(queue, runs, affectedRunIds)
    for(const runId of affectedRunIds) {
        if(!nextRunsBase[runId]) continue
        nextRunsBase[runId] = {
            ...nextRunsBase[runId],
            paused: true,
            status: 'paused',
            updatedAt: now
        }
    }
    const events = normalizeCoordinatorEvents(state.events)
    events.push({
        id: makeId('event'),
        runId: '',
        itemId: '',
        type: 'paused',
        message: `Paused ${pausedUrls.length + pausedWorkKeys.length} current work target${pausedUrls.length + pausedWorkKeys.length === 1 ? '' : 's'}`,
        at: now,
        details: {
            reason,
            pausedUrls,
            pausedWorkKeys
        }
    })

    const prunedProgress = progressChanged ? pruneProfileNukeProgress(progress) : state.progress
    if(progressChanged) {
        profileNukeProgress = prunedProgress
    }

    if(pauseGeneration && (!isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration) ||
        !await isCoordinatorPauseGenerationCurrent(pauseGeneration))) {
        await restoreLatestCoordinatorPauseGenerationIfStale(pauseGeneration)
        return {pausedUrls: [], pausedWorkKeys: [], ownedTabIds: Array.from(ownedTabIds), stalePause: true}
    }
    await saveCoordinatorState({
        queue,
        runs: nextRunsBase,
        events,
        progress: prunedProgress
    }, {
        queue: queueChanged,
        runs: true,
        events: true,
        progress: progressChanged,
        reason: 'ordinaryMutation',
        queueOperation: 'pause',
        queueChangedRows: pausedUrls.length + pausedWorkKeys.length
    })
    if(pauseGeneration && !isCoordinatorPauseGenerationLocallyCurrent(pauseGeneration)) {
        await restoreLatestCoordinatorPauseGenerationIfStale(pauseGeneration)
        scheduleCoordinatorPauseStateRepair('stale-pause-save-repair')
        return {pausedUrls: [], pausedWorkKeys: [], ownedTabIds: Array.from(ownedTabIds), stalePause: true}
    }

    return {
        pausedUrls,
        pausedWorkKeys,
        ownedTabIds: Array.from(ownedTabIds)
    }
}

function findCoordinatorStoredWorkCancelTarget(queue = {}, operation = {}) {
    const targetStorageKey = `${operation.storageKey || ''}`.trim()
    const targetCoordinatorKey = `${operation.coordinatorKey || ''}`.trim()
    const targetHref = normalizeQuoraProfileUrl(operation.profileHref || '')
    if(!targetStorageKey && !targetCoordinatorKey && !targetHref) {
        return {entry: null, matches: [], reason: 'missing-current-work-item-target'}
    }

    const matches = []
    for(const [itemKey, item] of Object.entries(queue || {})) {
        if(!item || typeof item !== 'object') continue
        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
        if(itemKey !== targetStorageKey &&
            itemKey !== targetCoordinatorKey &&
            href !== targetHref &&
            coordinatorKey !== targetCoordinatorKey &&
            coordinatorKey !== targetStorageKey) {
            continue
        }
        matches.push({itemKey, item, href, coordinatorKey})
    }

    if(matches.length !== 1) {
        return {
            entry: null,
            matches,
            reason: matches.length ? 'ambiguous-current-work-item-target' : 'missing-current-work-item-target'
        }
    }
    return {entry: matches[0], matches, reason: ''}
}

async function mutateCoordinatorStoredWorkItemCancel(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(snapshotReason !== 'ordinaryMutation') {
        return {canceledUrls: [], canceledWorkKeys: [], ownedTabIds: [], reason: 'invalid-cancel-reason'}
    }

    const reason = `${operation.cancelReason || 'coordinator-pause-request'}`.trim()
    const state = await loadCoordinatorState()
    let currentAuthorityState = normalizeCoordinatorAuthorityStateInput(state)
    const target = findCoordinatorStoredWorkCancelTarget(currentAuthorityState.queue, operation)
    if(!target.entry) {
        return {canceledUrls: [], canceledWorkKeys: [], ownedTabIds: [], reason: target.reason}
    }

    const {itemKey, item, href, coordinatorKey} = target.entry
    const status = `${item.status || ''}`.trim()
    if(!isPendingCoordinatorStatus(status)) {
        return {canceledUrls: [], canceledWorkKeys: [], ownedTabIds: [], reason: 'terminal-current-work-item'}
    }
    if(!href && !coordinatorKey) {
        return {canceledUrls: [], canceledWorkKeys: [], ownedTabIds: [], reason: 'missing-current-work-item-identity'}
    }

    const now = Date.now()
    const existingProgress = href ? state.progress[href] || profileNukeProgress?.[href] || null : null
    const tabId = getPersistedQueuedTabId(item, existingProgress)
    const nextItem = buildTerminalCoordinatorQueueItem(item, {
        status: 'canceled',
        outcome: 'paused',
        error: 'Paused by user',
        now,
        reason
    })
    const expectedAttemptId = getAttemptIdFromValue(item)
    const expectedAttemptNumber = getAttemptNumberFromValue(item)

    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'current-work-item-cancel',
        rowKey: itemKey,
        expectedAttemptId,
        expectedAttemptNumber,
        reason: 'ordinaryMutation',
        metricPath: 'currentWork.itemCancel.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            const currentStatus = `${currentItem?.status || ''}`.trim()
            if(!currentItem || !isPendingCoordinatorStatus(currentStatus)) {
                return context.reject('terminal-current-work-item')
            }
            const currentHref = getCoordinatorItemHref(currentItem) || normalizeQuoraProfileUrl(itemKey)
            const currentCoordinatorKey = getCoordinatorItemQueueKey(currentItem, itemKey)
            if(currentHref !== href || currentCoordinatorKey !== coordinatorKey) {
                return context.reject('row-target-changed-before-authority-apply')
            }
            if(JSON.stringify(currentItem) !== JSON.stringify(item)) {
                return context.reject('row-changed-before-authority-apply')
            }
            return nextItem
        }
    })

    if(authorityResult?.accepted !== true || authorityResult?.durable !== true) {
        return {
            canceledUrls: [],
            canceledWorkKeys: [],
            ownedTabIds: tabId ? [tabId] : [],
            reason: authorityResult?.reason || 'authority-apply-failed'
        }
    }

    currentAuthorityState = coordinatorAuthority.current()
    const nextQueue = currentAuthorityState.queue
    const affectedRunIds = new Set(nextItem.runId ? [nextItem.runId] : [])
    if(href) {
        for(const runId of getCoordinatorRunIdsForHref(state.runs, href)) {
            affectedRunIds.add(runId)
        }
    }

    const runs = affectedRunIds.size
        ? recomputeCoordinatorRuns(nextQueue, state.runs, affectedRunIds)
        : state.runs
    const runsChanged = affectedRunIds.size && JSON.stringify(runs) !== JSON.stringify(state.runs)
    const events = normalizeCoordinatorEvents(state.events)
    events.push({
        id: makeId('event'),
        runId: nextItem.runId || '',
        itemId: itemKey,
        type: 'paused',
        message: 'Paused 1 coordinator target',
        at: now,
        details: {
            reason,
            canceledUrls: href ? [href] : [],
            canceledWorkKeys: href ? [] : [coordinatorKey]
        }
    })

    let progressChanged = false
    const progress = {...state.progress}
    if(href) {
        const nextProgress = makeTerminalProgressRecordFromCoordinatorItem(
            href,
            nextItem,
            existingProgress,
            'Paused by user'
        )
        if(nextProgress && JSON.stringify(nextProgress) !== JSON.stringify(existingProgress || null)) {
            progress[href] = nextProgress
            progressChanged = true
        }
    }
    const prunedProgress = progressChanged ? pruneProfileNukeProgress(progress) : state.progress
    if(progressChanged) {
        profileNukeProgress = prunedProgress
    }

    let derivedSaved = false
    try {
        derivedSaved = await saveCoordinatorState({
            runs: runsChanged ? runs : undefined,
            events,
            progress: progressChanged ? prunedProgress : undefined
        }, {
            queue: false,
            runs: runsChanged,
            events: true,
            progress: progressChanged,
            reason: 'ordinaryMutation',
            queueOperation: 'current-work-item-cancel-derived',
            queueChangedRows: 0
        })
    }
    catch(error) {
        derivedSaved = false
        recordCoordinatorDiagnosticEvent(
            'current-work-item-cancel-derived-save-failed',
            error?.message || 'Current Work item cancel derived save failed'
        )
    }
    if(derivedSaved === false) {
        incrementQueueWakeupMetric('currentWork.itemCancel.derivedSaveFailed')
        scheduleStoredWorkRepair(1000, {
            reason: 'current-work-item-cancel-derived-save-failed',
            edgeTriggered: true
        })
    }

    return {
        canceledUrls: href ? [href] : [],
        canceledWorkKeys: href ? [] : [coordinatorKey],
        ownedTabIds: tabId ? [tabId] : [],
        persistence: authorityResult.persistence || null,
        derivedSaved
    }
}

async function mutateCoordinatorStoredWorkCancel(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(snapshotReason !== 'ordinaryMutation') {
        return {canceledUrls: [], canceledWorkKeys: [], ownedTabIds: [], reason: 'invalid-cancel-reason'}
    }

    const reason = `${operation.cancelReason || 'coordinator-pause-request'}`.trim()
    const targetStorageKey = `${operation.storageKey || ''}`.trim()
    const targetCoordinatorKey = `${operation.coordinatorKey || ''}`.trim()
    const targetHref = normalizeQuoraProfileUrl(operation.profileHref || '')
    const hasTarget = !!(targetStorageKey || targetCoordinatorKey || targetHref)
    const state = await loadCoordinatorState()
    const queue = {
        ...state.queue
    }
    const progress = {
        ...state.progress
    }
    const now = Date.now()
    const affectedRunIds = new Set()
    const canceledUrls = []
    const canceledWorkKeys = []
    const ownedTabIds = new Set()
    let queueChanged = false
    let progressChanged = false

    for(const [itemKey, item] of Object.entries(queue || {})) {
        if(!item || typeof item !== 'object') continue

        const status = `${item.status || ''}`.trim()
        if(!isPendingCoordinatorStatus(status)) continue

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
        if(!href && !coordinatorKey) continue
        if(hasTarget &&
            itemKey !== targetStorageKey &&
            itemKey !== targetCoordinatorKey &&
            href !== targetHref &&
            coordinatorKey !== targetCoordinatorKey &&
            coordinatorKey !== targetStorageKey) {
            continue
        }

        const existingProgress = href ? progress[href] || profileNukeProgress?.[href] || null : null
        const tabId = getPersistedQueuedTabId(item, existingProgress)
        if(tabId) ownedTabIds.add(tabId)

        const nextItem = buildTerminalCoordinatorQueueItem(item, {
            status: 'canceled',
            outcome: 'paused',
            error: 'Paused by user',
            now,
            reason
        })
        queue[itemKey] = nextItem
        queueChanged = true
        if(href) canceledUrls.push(href)
        else canceledWorkKeys.push(coordinatorKey)

        if(nextItem.runId) affectedRunIds.add(nextItem.runId)
        if(href) {
            for(const runId of getCoordinatorRunIdsForHref(state.runs, href)) {
                affectedRunIds.add(runId)
            }
        }

        if(href) {
            const nextProgress = makeTerminalProgressRecordFromCoordinatorItem(
                href,
                nextItem,
                existingProgress,
                'Paused by user'
            )
            if(nextProgress && JSON.stringify(nextProgress) !== JSON.stringify(existingProgress || null)) {
                progress[href] = nextProgress
                progressChanged = true
            }
        }
    }

    if(!queueChanged) {
        return {canceledUrls: [], canceledWorkKeys: [], ownedTabIds: []}
    }

    const runs = recomputeCoordinatorRuns(queue, state.runs, affectedRunIds)
    const events = normalizeCoordinatorEvents(state.events)
    events.push({
        id: makeId('event'),
        runId: '',
        itemId: '',
        type: 'paused',
        message: `Paused ${canceledUrls.length + canceledWorkKeys.length} coordinator target${canceledUrls.length + canceledWorkKeys.length === 1 ? '' : 's'}`,
        at: now,
        details: {
            reason,
            canceledUrls,
            canceledWorkKeys
        }
    })

    const prunedProgress = progressChanged ? pruneProfileNukeProgress(progress) : state.progress
    if(progressChanged) {
        profileNukeProgress = prunedProgress
    }

    await saveCoordinatorState({
        queue,
        runs,
        events,
        progress: prunedProgress
    }, {
        queue: true,
        runs: true,
        events: true,
        progress: progressChanged,
        reason: 'ordinaryMutation',
        queueOperation: 'cancel',
        queueChangedRows: canceledUrls.length + canceledWorkKeys.length
    })

    return {
        canceledUrls,
        canceledWorkKeys,
        ownedTabIds: Array.from(ownedTabIds)
    }
}

async function mutateCoordinatorQueuedTabOpenRollback(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'repair')
    if(snapshotReason !== 'repair') return false

    const action = operation.action || {}
    const tab = operation.tab || {}
    const details = operation.details || {}
    const href = normalizeQuoraProfileUrl(operation.href || action?.profileHref || action?.url || '')
    const coordinatorKey = operation.coordinatorKey || action?.coordinatorKey || (href ? href : makeProfileResolutionQueueKey(action?.requestedUrl || action?.url || ''))
    if(!href && !coordinatorKey) return false

    const state = await loadCoordinatorQueueRunsProjection({
        metricPath: 'rollbackActiveTransition.load'
    })
    let currentAuthorityState = normalizeCoordinatorAuthorityStateInput(state)
    const queue = currentAuthorityState.queue
    const runs = currentAuthorityState.runs
    const itemKey = href && queue[href] ? href : coordinatorKey
    const item = queue[itemKey]
    if(!item || isTerminalCoordinatorStatus(item.status)) return false

    const attemptedRecord = {
        attemptId: details.attemptId || getAttemptIdFromValue(action),
        attemptNumber: Number.parseInt(details.attemptNumber, 10) || getAttemptNumberFromValue(action)
    }
    if(hasMismatchedCoordinatorAttempt(item, attemptedRecord)) return false

    const itemTabId = normalizeTabId(item.tabId)
    const tabId = normalizeTabId(tab?.id)
    if(itemTabId && tabId && itemTabId !== tabId) return false

    const now = Date.now()
    const buildNextRollbackItem = currentItem => ({
        ...currentItem,
        status: 'queued',
        outcome: '',
        error: '',
        activeAt: 0,
        updatedAt: now,
        tabId: null,
        actionLease: null,
        actionLeaseReleasedAt: now,
        actionLeaseReleaseReason: 'active-transition-failed',
        milestones: {
            ...makeEmptyCoordinatorMilestones(),
            ...(currentItem.milestones || {}),
            closeRequestedAt: now,
            tabClosedAt: now
        }
    })

    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'rollback-active-transition',
        rowKey: itemKey,
        expectedAttemptId: getAttemptIdFromValue(attemptedRecord),
        expectedAttemptNumber: getAttemptNumberFromValue(attemptedRecord),
        reason: 'ordinaryMutation',
        metricPath: 'rollbackActiveTransition.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            if(!currentItem || isTerminalCoordinatorStatus(currentItem.status)) {
                return context.reject('missing-or-terminal-row')
            }
            if(hasMismatchedCoordinatorAttempt(currentItem, attemptedRecord)) {
                return context.reject('attempt-changed')
            }
            const currentTabId = normalizeTabId(currentItem.tabId)
            if(currentTabId && tabId && currentTabId !== tabId) {
                return context.reject('tab-changed')
            }
            const currentHref = getCoordinatorItemHref(currentItem) || normalizeQuoraProfileUrl(itemKey)
            const currentCoordinatorKey = getCoordinatorItemQueueKey(currentItem, itemKey)
            if(currentHref !== (getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)) ||
                currentCoordinatorKey !== getCoordinatorItemQueueKey(item, itemKey)) {
                return context.reject('row-target-changed-before-authority-apply')
            }
            return buildNextRollbackItem(currentItem)
        }
    })

    if(authorityResult?.accepted !== true || authorityResult?.durable !== true) return false

    currentAuthorityState = coordinatorAuthority.current()
    const nextQueue = currentAuthorityState.queue
    const nextItem = authorityResult.nextRow || nextQueue[itemKey] || null
    const affectedRunIds = new Set()
    if(nextItem?.runId) affectedRunIds.add(nextItem.runId)
    if(href) {
        for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
            affectedRunIds.add(runId)
        }
    }
    const nextRuns = affectedRunIds.size
        ? recomputeCoordinatorRuns(nextQueue, runs, affectedRunIds)
        : runs
    const runsChanged = affectedRunIds.size && JSON.stringify(nextRuns) !== JSON.stringify(runs)
    let derivedSaved = true
    try {
        derivedSaved = await saveCoordinatorState({
            runs: runsChanged ? nextRuns : undefined
        }, {
            queue: false,
            runs: runsChanged,
            reason: 'repair',
            queueOperation: 'rollback-active-transition-derived',
            queueChangedRows: 0
        })
    }
    catch(error) {
        derivedSaved = false
        recordCoordinatorDiagnosticEvent(
            'rollback-active-transition-derived-save-failed',
            error?.message || 'Active transition rollback derived save failed'
        )
    }
    if(derivedSaved === false) {
        incrementQueueWakeupMetric('rollbackActiveTransition.derivedSaveFailed')
        scheduleStoredWorkRepair(1000, {
            reason: 'rollback-active-transition-derived-save-failed',
            edgeTriggered: true
        })
    }

    return true
}

async function mutateCoordinatorStaleRetryQueuedTabAdvance(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(snapshotReason !== 'ordinaryMutation') return false

    const action = operation.action || {}
    const href = normalizeQuoraProfileUrl(operation.href || action?.profileHref || action?.url || '')
    const coordinatorKey = operation.coordinatorKey || action?.coordinatorKey || (href ? href : makeProfileResolutionQueueKey(action?.requestedUrl || action?.url || ''))
    if(!action || (!href && !coordinatorKey)) return false

    const state = await loadCoordinatorQueueRunsProjection({
        metricPath: 'staleRetry.load'
    })
    let currentAuthorityState = normalizeCoordinatorAuthorityStateInput(state)
    const queue = currentAuthorityState.queue
    const runs = currentAuthorityState.runs
    const itemKey = href && queue[href] ? href : coordinatorKey
    const item = queue[itemKey]
    if(!item || isTerminalCoordinatorStatus(item.status)) return false

    const sourceAttemptId = normalizeAttemptId(action?.sourceAttemptId || '')
    const sourceAttemptNumber = Number.parseInt(action?.sourceAttemptNumber, 10) || 0
    const currentAttemptId = getAttemptIdFromValue(item)
    const currentAttemptNumber = getAttemptNumberFromValue(item)
    if(!sourceAttemptId || !sourceAttemptNumber || !currentAttemptId || !currentAttemptNumber) return false
    if(sourceAttemptId !== currentAttemptId || sourceAttemptNumber !== currentAttemptNumber) return false

    const attemptId = getAttemptIdFromValue(action)
    const attemptNumber = getAttemptNumberFromValue(action)
    if(!attemptId || !attemptNumber) return false

    const at = Number.parseInt(operation.at, 10) || Date.now()
    const buildNextRetryItem = currentItem => {
        const loadPressureRequeue = action.loadPressureRequeue === true
        const retryCount = loadPressureRequeue
            ? getCoordinatorFailureRetryCount(currentItem)
            : Math.max(
                getCoordinatorFailureRetryCount(currentItem) + 1,
                Number.parseInt(action.retryAttempt, 10) || 0
            )
        const reduced = reduceJobEvent(currentItem, {
            type: JOB_EVENT_RETRY,
            sourceAttemptId,
            sourceAttemptNumber,
            attemptId,
            attemptNumber,
            at,
            retryCount,
            lastRetryAt: loadPressureRequeue ? currentItem.lastRetryAt || 0 : at
        })
        if(!reduced.accepted) return null

        const actionKind = getCoordinatorActionKindForRequestedAction(action.actionKind || action.tabAction || currentItem.actionKind || '')
        return applyCoordinatorJobEnvelope({
            ...reduced.item,
            targetProfileHref: href || reduced.item.targetProfileHref || '',
            requestedUrl: normalizeCoordinatorRequestedUrl(action.requestedUrl || action.url || reduced.item.requestedUrl || ''),
            coordinatorKey,
            actionKind,
            executorTabAction: getCoordinatorExecutorTabActionForActionKind(actionKind),
            executorNoForegroundFallback: action.noForegroundFallback === true,
            serviceWorkerOwned: true,
            retryAttempt: Number.parseInt(action.retryAttempt, 10) || 0,
            maxRetries: Number.parseInt(action.maxRetries, 10) || 0,
            maxAttempts: (Number.parseInt(action.maxRetries, 10) || 0) + 1,
            loadPressureRequeueCount: loadPressureRequeue
                ? (Number.parseInt(currentItem.loadPressureRequeueCount, 10) || 0) + 1
                : Number.parseInt(currentItem.loadPressureRequeueCount, 10) || 0,
            lastLoadPressureAt: loadPressureRequeue ? at : Number.parseInt(currentItem.lastLoadPressureAt, 10) || 0
        }, {
            runId: reduced.item.runId || action.runId || '',
            source: reduced.item.source || {},
            targetProfileHref: href,
            requestedUrl: action.requestedUrl || action.url || '',
            coordinatorKey,
            actionKind
        })
    }

    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'stale-retry',
        rowKey: itemKey,
        expectedAttemptId: sourceAttemptId,
        expectedAttemptNumber: sourceAttemptNumber,
        reason: 'ordinaryMutation',
        metricPath: 'staleRetry.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            if(!currentItem || isTerminalCoordinatorStatus(currentItem.status)) {
                return context.reject('missing-or-terminal-row')
            }
            const currentHref = getCoordinatorItemHref(currentItem) || normalizeQuoraProfileUrl(itemKey)
            const currentCoordinatorKey = getCoordinatorItemQueueKey(currentItem, itemKey)
            if(currentHref !== (getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)) ||
                currentCoordinatorKey !== getCoordinatorItemQueueKey(item, itemKey)) {
                return context.reject('row-target-changed-before-authority-apply')
            }
            const nextItem = buildNextRetryItem(currentItem)
            if(!nextItem) return context.reject('retry-reducer-rejected')
            return nextItem
        }
    })

    if(authorityResult?.accepted !== true || authorityResult?.durable !== true) return false

    currentAuthorityState = coordinatorAuthority.current()
    const nextQueue = currentAuthorityState.queue
    const nextItem = authorityResult.nextRow || nextQueue[itemKey] || null
    const affectedRunIds = new Set()
    if(nextItem?.runId) affectedRunIds.add(nextItem.runId)
    if(href) {
        for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
            affectedRunIds.add(runId)
        }
    }
    const nextRuns = affectedRunIds.size
        ? recomputeCoordinatorRuns(nextQueue, runs, affectedRunIds)
        : runs
    const runsChanged = affectedRunIds.size && JSON.stringify(nextRuns) !== JSON.stringify(runs)
    let derivedSaved = true
    try {
        derivedSaved = await saveCoordinatorState({
            runs: runsChanged ? nextRuns : undefined
        }, {
            queue: false,
            runs: runsChanged,
            reason: 'ordinaryMutation',
            queueOperation: 'stale-retry-derived',
            queueChangedRows: 0
        })
    }
    catch(error) {
        derivedSaved = false
        recordCoordinatorDiagnosticEvent(
            'stale-retry-derived-save-failed',
            error?.message || 'Stale retry derived save failed'
        )
    }
    if(derivedSaved === false) {
        incrementQueueWakeupMetric('staleRetry.derivedSaveFailed')
        scheduleStoredWorkRepair(1000, {
            reason: 'stale-retry-derived-save-failed',
            edgeTriggered: true
        })
    }

    return true
}

async function mutateCoordinatorKeyOnlyItemTerminalize(operation = {}) {
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'repair')
    if(snapshotReason !== 'repair') return {changed: false, reason: 'invalid-terminalize-reason'}

    const key = `${operation.coordinatorKey || ''}`.trim()
    if(!key) return {changed: false, reason: 'missing-coordinator-key'}

    const options = operation.terminalOptions || {}
    const expectedAttemptId = normalizeAttemptId(options.expectedAttemptId || operation.expectedAttemptId || '')
    const expectedAttemptNumber = Number.parseInt(options.expectedAttemptNumber || operation.expectedAttemptNumber, 10) || 0
    const state = await loadCoordinatorState({
        [PROFILE_NUKE_PROGRESS_KEY]: undefined
    })
    let currentAuthorityState = normalizeCoordinatorAuthorityStateInput(state)
    const queue = currentAuthorityState.queue
    const itemKey = queue[key] ? key : Object.keys(queue).find(candidateKey =>
        getCoordinatorItemQueueKey(queue[candidateKey], candidateKey) === key
    )
    if(!itemKey) return {changed: false, reason: 'missing-queue-item'}

    const item = queue[itemKey]
    if(!item || getCoordinatorItemHref(item) || isTerminalCoordinatorStatus(item.status)) {
        return {changed: false, reason: 'not-key-only-pending-item'}
    }
    if(expectedAttemptId && getAttemptIdFromValue(item) !== expectedAttemptId) {
        return {changed: false, reason: 'attempt-changed'}
    }
    if(expectedAttemptNumber && getAttemptNumberFromValue(item) !== expectedAttemptNumber) {
        return {changed: false, reason: 'attempt-changed'}
    }

    const now = Number.parseInt(options.now, 10) || Date.now()
    const nextItem = buildTerminalCoordinatorQueueItem(item, {
        status: options.status || 'failed',
        outcome: options.outcome || 'timeout',
        error: options.error || 'Queued profile-resolution tab closed before resolving a profile',
        reason: options.reason || 'profile-resolution-tab-closed',
        eventType: JOB_EVENT_TAB_REMOVED,
        now
    })

    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'repair-key-only-terminalize',
        rowKey: itemKey,
        expectedAttemptId,
        expectedAttemptNumber,
        reason: 'ordinaryMutation',
        metricPath: 'repair.keyOnlyTerminalize.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            if(!currentItem || getCoordinatorItemHref(currentItem) || isTerminalCoordinatorStatus(currentItem.status)) {
                return context.reject('not-key-only-pending-item')
            }
            if(getCoordinatorItemQueueKey(currentItem, itemKey) !== key) {
                return context.reject('row-changed-before-authority-apply')
            }
            if(JSON.stringify(currentItem) !== JSON.stringify(item)) {
                return context.reject('row-changed-before-authority-apply')
            }
            return nextItem
        }
    })

    if(authorityResult?.accepted !== true || authorityResult?.durable !== true) {
        return {
            changed: false,
            reason: authorityResult?.reason || 'authority-apply-failed'
        }
    }

    currentAuthorityState = coordinatorAuthority.current()
    const nextQueue = currentAuthorityState.queue
    const affectedRunIds = new Set(nextItem.runId ? [nextItem.runId] : [])
    const runs = affectedRunIds.size
        ? recomputeCoordinatorRuns(nextQueue, state.runs, affectedRunIds)
        : state.runs
    const runsChanged = affectedRunIds.size && JSON.stringify(runs) !== JSON.stringify(state.runs)
    const events = normalizeCoordinatorEvents(state.events)
    events.push({
        id: makeId('event'),
        runId: nextItem.runId || '',
        itemId: itemKey,
        type: nextItem.status,
        message: nextItem.error,
        at: now,
        details: {
            coordinatorKey: key,
            reason: options.reason || 'profile-resolution-tab-closed'
        }
    })

    let derivedSaved = false
    try {
        derivedSaved = await saveCoordinatorState({
            runs: runsChanged ? runs : undefined,
            events
        }, {
            queue: false,
            runs: runsChanged,
            events: true,
            reason: 'repair',
            queueOperation: 'repair-key-only-terminalize-derived',
            queueChangedRows: 0
        })
    }
    catch(error) {
        derivedSaved = false
        recordCoordinatorDiagnosticEvent(
            'repair-key-only-terminalize-derived-save-failed',
            error?.message || 'Key-only terminal repair derived save failed'
        )
    }
    if(derivedSaved === false) {
        incrementQueueWakeupMetric('repair.keyOnlyTerminalize.derivedSaveFailed')
        scheduleStoredWorkRepair(1000, {
            reason: 'repair-key-only-terminalize-derived-save-failed',
            edgeTriggered: true
        })
    }

    return {changed: true, itemKey, status: nextItem.status}
}

async function mutateCoordinatorActionLeaseRequest(operation = {}) {
    const profileHref = normalizeQuoraProfileUrl(operation.profileHref || '')
    const tabId = normalizeTabId(operation.tabId || null)
    const attemptId = normalizeAttemptId(operation.attemptId || '')
    const attemptNumber = Number.parseInt(operation.attemptNumber, 10) || 0
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(!profileHref || !tabId) return {granted: false, reason: 'invalid-action-lease-operation'}
    if(snapshotReason !== 'ordinaryMutation') {
        return {granted: false, reason: 'invalid-action-lease-reason'}
    }

    const now = Number.parseInt(operation.now, 10) || Date.now()
    let currentAuthorityState = await loadCoordinatorQueueProjection({
        metricPath: 'actionLease.request.load'
    })
    const queue = currentAuthorityState.queue
    const entry = findCoordinatorQueueEntryForHref(queue, profileHref)
    const item = entry?.item || null

    if(!item) {
        return {granted: false, reason: 'missing-coordinator-item'}
    }
    if(isTerminalCoordinatorStatus(item.status)) {
        return {granted: false, reason: 'terminal-coordinator-item'}
    }
    if(hasMismatchedCoordinatorAttempt(item, {attemptId, attemptNumber})) {
        await recordStaleAttemptDiagnostic({
            profileHref,
            incomingAttemptId: attemptId,
            expectedAttemptId: getAttemptIdFromValue(item),
            senderTabId: tabId,
            message: 'Ignored action-lease request from stale attempt'
        })
        return {granted: false, staleAttempt: true, reason: 'stale-coordinator-attempt'}
    }

    const activeLease = findActiveCoordinatorActionLease(queue, now)
    if(activeLease && !isCoordinatorActionLeaseHolder(activeLease.lease, tabId, attemptId)) {
        return {
            granted: false,
            actionLeaseBusy: true,
            reason: 'action-lease-busy',
            leaseProfileHref: activeLease.lease.profileHref || getCoordinatorItemHref(activeLease.item) || activeLease.key,
            leaseTabId: activeLease.lease.tabId,
            leaseExpiresAt: activeLease.lease.expiresAt
        }
    }

    const expectedAttemptId = attemptId || getAttemptIdFromValue(item)
    const expectedAttemptNumber = attemptNumber || getAttemptNumberFromValue(item)
    const lease = makeCoordinatorActionLease(item, {
        attemptId: expectedAttemptId,
        attemptNumber: expectedAttemptNumber,
        actionKind: operation.actionKind || item.actionKind || '',
        reason: operation.requestReason || '',
        profileHref,
        tabId
    }, {tab: {id: tabId}}, now)
    if(!lease) {
        return {granted: false, reason: 'invalid-action-lease'}
    }

    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'action-lease-request',
        rowKey: entry.key,
        expectedAttemptId,
        expectedAttemptNumber,
        reason: 'ordinaryMutation',
        metricPath: 'actionLease.request.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            if(!currentItem) {
                return context.reject('missing-coordinator-item')
            }
            if(isTerminalCoordinatorStatus(currentItem.status)) {
                return context.reject('terminal-coordinator-item')
            }
            if(hasMismatchedCoordinatorAttempt(currentItem, {attemptId: expectedAttemptId, attemptNumber: expectedAttemptNumber})) {
                return context.reject('stale-coordinator-attempt', {staleAttempt: true})
            }
            const currentQueue = {
                ...(currentAuthorityState.queue || {}),
                [entry.key]: currentItem
            }
            const currentActiveLease = findActiveCoordinatorActionLease(currentQueue, now)
            if(currentActiveLease && !isCoordinatorActionLeaseHolder(currentActiveLease.lease, tabId, expectedAttemptId)) {
                return context.reject('action-lease-busy')
            }
            const currentLease = makeCoordinatorActionLease(currentItem, {
                attemptId: expectedAttemptId || getAttemptIdFromValue(currentItem),
                attemptNumber: expectedAttemptNumber || getAttemptNumberFromValue(currentItem),
                actionKind: operation.actionKind || currentItem.actionKind || '',
                reason: operation.requestReason || '',
                profileHref,
                tabId
            }, {tab: {id: tabId}}, now)
            if(!currentLease) {
                return context.reject('invalid-action-lease')
            }
            return {
                ...currentItem,
                actionLease: currentLease,
                actionLeaseReleasedAt: 0,
                actionLeaseReleaseReason: '',
                updatedAt: now
            }
        }
    })

    if(authorityResult?.accepted === true && authorityResult?.durable === true) {
        currentAuthorityState = coordinatorAuthority.current()
        return {
            granted: true,
            actionLease: authorityResult.nextRow?.actionLease || currentAuthorityState.queue?.[entry.key]?.actionLease || lease,
            persistence: authorityResult.persistence || null
        }
    }

    return {
        granted: false,
        actionLeaseBusy: authorityResult?.reason === 'action-lease-busy',
        staleAttempt: authorityResult?.staleAttempt === true,
        reason: authorityResult?.reason || 'authority-apply-failed'
    }
}

async function mutateCoordinatorActionLeaseHeartbeat(operation = {}) {
    const profileHref = normalizeQuoraProfileUrl(operation.profileHref || '')
    const tabId = normalizeTabId(operation.tabId || null)
    const attemptId = normalizeAttemptId(operation.attemptId || '')
    const reason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(!profileHref || !tabId || !attemptId) {
        return {heartbeat: false, reason: 'invalid-action-lease-operation'}
    }
    if(reason !== 'ordinaryMutation') {
        return {heartbeat: false, reason: 'invalid-action-lease-reason'}
    }

    const now = Number.parseInt(operation.now, 10) || Date.now()
    const currentAuthorityState = await loadCoordinatorQueueRunsProjection({
        metricPath: 'actionLease.heartbeat.load'
    })
    const entry = findCoordinatorQueueEntryForHref(currentAuthorityState.queue, profileHref)
    const item = entry?.item || null
    const lease = normalizeCoordinatorActionLease(item?.actionLease)

    if(!item || !lease || isCoordinatorActionLeaseExpired(lease, now) || !isCoordinatorActionLeaseHolder(lease, tabId, attemptId)) {
        return {heartbeat: false, actionLeaseLost: true}
    }

    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'action-lease-heartbeat',
        rowKey: entry.key,
        expectedAttemptId: attemptId,
        expectedAttemptNumber: Number.parseInt(operation.attemptNumber, 10) || 0,
        reason: 'ordinaryMutation',
        metricPath: 'actionLease.heartbeat.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            const currentLease = normalizeCoordinatorActionLease(currentItem?.actionLease)
            if(!currentLease || isCoordinatorActionLeaseExpired(currentLease, now) || !isCoordinatorActionLeaseHolder(currentLease, tabId, attemptId)) {
                return context.reject('action-lease-lost')
            }
            if(isTerminalCoordinatorStatus(currentItem?.status)) {
                return context.reject('terminal-row')
            }
            return {
                ...currentItem,
                actionLease: {
                    ...currentLease,
                    heartbeatAt: now,
                    expiresAt: now + ACTION_LEASE_MS
                },
                updatedAt: now
            }
        }
    })

    if(authorityResult?.accepted === true && authorityResult?.durable === true) {
        return {heartbeat: true, actionLease: authorityResult.nextRow?.actionLease || null}
    }

    return {
        heartbeat: false,
        actionLeaseLost: authorityResult?.reason === 'action-lease-lost',
        staleAttempt: authorityResult?.staleAttempt === true,
        reason: authorityResult?.reason || 'authority-apply-failed'
    }
}

async function mutateCoordinatorActionLeaseRelease(operation = {}) {
    const profileHref = normalizeQuoraProfileUrl(operation.profileHref || '')
    const tabId = normalizeTabId(operation.tabId || null)
    const attemptId = normalizeAttemptId(operation.attemptId || '')
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(!profileHref || !tabId || !attemptId) {
        return {released: false, reason: 'invalid-action-lease-operation'}
    }
    if(snapshotReason !== 'ordinaryMutation') {
        return {released: false, reason: 'invalid-action-lease-reason'}
    }

    const now = Number.parseInt(operation.now, 10) || Date.now()
    const currentAuthorityState = await loadCoordinatorQueueRunsProjection({
        metricPath: 'actionLease.release.load'
    })
    const entry = findCoordinatorQueueEntryForHref(currentAuthorityState.queue, profileHref)
    const item = entry?.item || null
    const lease = normalizeCoordinatorActionLease(item?.actionLease)

    if(!item) {
        return {released: false, actionLeaseLost: true, reason: 'missing-coordinator-item'}
    }
    if(!lease) {
        return {released: false, actionLeaseLost: true, reason: 'missing-action-lease'}
    }
    if(isCoordinatorActionLeaseExpired(lease, now)) {
        return {released: false, actionLeaseLost: true, reason: 'expired-action-lease'}
    }
    if(!isCoordinatorActionLeaseHolder(lease, tabId, attemptId)) {
        return {released: false, actionLeaseLost: false, reason: 'action-lease-holder-mismatch'}
    }

    const releaseReason = `${operation.releaseReason || 'released'}`.trim()
    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'action-lease-release',
        rowKey: entry.key,
        expectedAttemptId: attemptId,
        expectedAttemptNumber: Number.parseInt(operation.attemptNumber, 10) || 0,
        reason: 'ordinaryMutation',
        metricPath: 'actionLease.release.save',
        currentAuthorityState,
        mutate(currentItem, context) {
            const currentLease = normalizeCoordinatorActionLease(currentItem?.actionLease)
            if(!currentLease || isCoordinatorActionLeaseExpired(currentLease, now) || !isCoordinatorActionLeaseHolder(currentLease, tabId, attemptId)) {
                return context.reject('action-lease-lost')
            }
            return {
                ...currentItem,
                actionLease: null,
                actionLeaseReleasedAt: now,
                actionLeaseReleaseReason: releaseReason,
                updatedAt: now
            }
        }
    })

    if(authorityResult?.accepted === true && authorityResult?.durable === true) {
        return {released: true}
    }

    return {
        released: false,
        actionLeaseLost: authorityResult?.reason === 'action-lease-lost',
        staleAttempt: authorityResult?.staleAttempt === true,
        reason: authorityResult?.reason || 'authority-apply-failed'
    }
}

async function mutateCoordinatorActionLeasesForTabRelease(operation = {}) {
    const tabId = normalizeTabId(operation.tabId || null)
    const snapshotReason = normalizeSnapshotWriteReason(operation.reason || 'ordinaryMutation')
    if(!tabId) return {released: false, reason: 'invalid-tab-id'}
    if(snapshotReason !== 'ordinaryMutation') {
        return {released: false, reason: 'invalid-action-lease-reason'}
    }

    const now = Number.parseInt(operation.now, 10) || Date.now()
    const releaseReason = `${operation.releaseReason || 'tab-released'}`.trim()
    let currentAuthorityState = await loadCoordinatorQueueProjection({
        metricPath: 'actionLease.tabRelease.load'
    })
    const queue = currentAuthorityState.queue
    let released = false
    let releasedRows = 0
    let failedRows = 0
    let lastFailureReason = ''

    for(const [key, item] of Object.entries(queue || {})) {
        const lease = normalizeCoordinatorActionLease(item?.actionLease)
        if(!lease || lease.tabId !== tabId) continue

        const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
            operationKind: 'action-lease-tab-release',
            rowKey: key,
            expectedAttemptId: getAttemptIdFromValue(item) || lease.attemptId || '',
            expectedAttemptNumber: getAttemptNumberFromValue(item) || lease.attemptNumber || 0,
            reason: 'ordinaryMutation',
            metricPath: 'actionLease.tabRelease.save',
            currentAuthorityState,
            mutate(currentItem, context) {
                const currentLease = normalizeCoordinatorActionLease(currentItem?.actionLease)
                if(!currentLease || currentLease.tabId !== tabId) {
                    return context.reject('action-lease-lost')
                }
                if(lease.attemptId && currentLease.attemptId !== lease.attemptId) {
                    return context.reject('action-lease-changed')
                }
                if(lease.attemptNumber && currentLease.attemptNumber !== lease.attemptNumber) {
                    return context.reject('action-lease-changed')
                }
                return {
                    ...currentItem,
                    actionLease: null,
                    actionLeaseReleasedAt: now,
                    actionLeaseReleaseReason: releaseReason,
                    updatedAt: now
                }
            }
        })
        if(authorityResult?.accepted === true && authorityResult?.durable === true) {
            released = true
            releasedRows += 1
            currentAuthorityState = coordinatorAuthority.current()
        }
        else {
            failedRows += 1
            lastFailureReason = authorityResult?.reason || 'authority-apply-failed'
        }
    }

    return {released, releasedRows, failedRows, reason: lastFailureReason}
}

async function requestCoordinatorActionLease(request = {}, sender = {}) {
    const tabId = sender.tab?.id || null
    const metadata = tabId ? getQueuedTabMetadata(tabId) : null
    const profileHref = normalizeQuoraProfileUrl(metadata?.profileHref || request.profileHref || request.href || '')
    if(!profileHref) return {granted: false, reason: 'invalid-profile-href'}

    if(!await validateQueuedTabAttempt(sender, request, {
        profileHref,
        message: 'Ignored stale action-lease request'
    })) {
        return {granted: false, staleAttempt: true, reason: 'stale-tab-attempt'}
    }

    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'requestActionLease',
            reason: 'ordinaryMutation',
            profileHref,
            tabId,
            attemptId: request.attemptId || metadata?.attemptId || '',
            attemptNumber: request.attemptNumber || metadata?.attemptNumber || 0,
            actionKind: request.actionKind || metadata?.actionKind || '',
            requestReason: request.reason || ''
        })
    })
}

async function heartbeatCoordinatorActionLease(request = {}, sender = {}) {
    const tabId = sender.tab?.id || null
    const metadata = tabId ? getQueuedTabMetadata(tabId) : null
    const profileHref = normalizeQuoraProfileUrl(metadata?.profileHref || request.profileHref || request.href || '')
    if(!profileHref) return {heartbeat: false, reason: 'invalid-profile-href'}

    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'heartbeatActionLease',
            reason: 'ordinaryMutation',
            profileHref,
            tabId,
            attemptId: request.attemptId || metadata?.attemptId || ''
        })
    })
}

async function releaseCoordinatorActionLease(request = {}, sender = {}, reason = '') {
    const tabId = sender.tab?.id || request.tabId || null
    const metadata = tabId ? getQueuedTabMetadata(tabId) : null
    const profileHref = normalizeQuoraProfileUrl(metadata?.profileHref || request.profileHref || request.href || '')
    if(!profileHref) return {released: false, reason: 'invalid-profile-href'}

    const result = await enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'releaseActionLease',
            reason: 'ordinaryMutation',
            profileHref,
            tabId,
            attemptId: request.attemptId || metadata?.attemptId || '',
            releaseReason: reason || request.reason || 'released'
        })
    })
    await restoreOwnerTabFocus(metadata, tabId).catch(() => false)
    return result
}

async function releaseCoordinatorActionLeaseForTab(tabId = null, reason = '') {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return {released: false}

    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'releaseActionLeasesForTab',
            reason: 'ordinaryMutation',
            tabId: normalizedTabId,
            releaseReason: reason || 'tab-released'
        })
    })
}

async function beginCoordinatorProfileAction(request = {}, sender = {}) {
    const tabId = sender.tab?.id || null
    if(!tabId) return {begun: false, granted: false, reason: 'invalid-tab-id'}

    const leaseResult = await requestCoordinatorActionLease(request, sender)
    if(!leaseResult?.granted) {
        return {
            ...leaseResult,
            begun: false
        }
    }

    if(isForegroundRequiredProfileActionRequest(request)) {
        const promotion = await promoteQueuedTab(tabId, request.reason || 'begin-profile-action', {
            requireForegroundWork: true
        }).catch(error => ({
            promoted: false,
            reason: error?.message || `${error || ''}`
        }))
        if(promotion?.promoted !== true) {
            await releaseCoordinatorActionLease(request, sender, `foreground-promotion-failed:${promotion?.reason || 'unknown'}`)
            return {
                ...leaseResult,
                begun: false,
                granted: false,
                foregroundPromotionFailed: true,
                foregroundPromoted: false,
                reason: promotion?.reason || 'foreground-promotion-failed'
            }
        }

        return {
            ...leaseResult,
            begun: true,
            granted: true,
            backgroundActionLease: true,
            foregroundPromoted: true,
            foregroundPromotedAt: promotion?.promotedAt || 0,
            foregroundPromotionReason: promotion?.reason || '',
            foregroundMode: promotion?.foregroundMode || ''
        }
    }

    return {
        ...leaseResult,
        begun: true,
        granted: true,
        backgroundActionLease: true,
        foregroundPromoted: false,
        foregroundPromotedAt: 0,
        foregroundPromotionReason: ''
    }
}

function isForegroundRequiredProfileActionRequest(request = {}) {
    if(request?.requireForegroundWork === true) return true
    const reason = `${request?.reason || ''}`.trim().toLowerCase()
    return reason === 'mute-confirmation' ||
        reason === 'block-confirmation' ||
        reason === 'unmute-confirmation' ||
        reason === 'unblock-confirmation' ||
        reason.endsWith('-confirmation')
}

function hasOwnedQueuedTabState(tabId) {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return false
    if(queuedTabMetadata.has(normalizedTabId)) return true
    if(activeQueuedTabs.has(normalizedTabId)) return true
    if(owningParentByChild.has(normalizedTabId)) return true

    for(const ownedTabIds of ownedTabIdsByParent.values()) {
        if(ownedTabIds?.has(normalizedTabId)) return true
    }

    return false
}

function isForegroundQueuedTabAction(value = '') {
    const action = `${value || ''}`.trim()
    return action === 'nuke' || action === 'mute-block' || action === UNBLOCK_UNMUTE_ACTION_KIND
}

function isForegroundQueuedTabWork(metadata = null, record = null) {
    return isForegroundQueuedTabAction(metadata?.tabAction || metadata?.actionKind || record?.actionKind || '')
}

function getQueuedForegroundLeaseTabId() {
    const tabId = normalizeTabId(queuedForegroundLeaseTabId)
    if(!tabId) {
        queuedForegroundLeaseTabId = null
        return null
    }

    const metadata = getQueuedTabMetadata(tabId)
    if(!activeQueuedTabs.has(tabId) || metadata?.closeRequestedAt) {
        queuedForegroundLeaseTabId = null
        return null
    }

    return tabId
}

async function noteQueuedForegroundWait(tabId, metadata = null, reason = '') {
    const now = Date.now()
    const lastEventAt = Number.isFinite(metadata?.foregroundWaitLastEventAt)
        ? metadata.foregroundWaitLastEventAt
        : 0
    const waitingForForegroundAt = Number.isFinite(metadata?.waitingForForegroundAt) && metadata.waitingForForegroundAt > 0
        ? metadata.waitingForForegroundAt
        : now

    setQueuedTabMetadata(tabId, {
        waitingForForegroundAt,
        foregroundWaitReason: `${reason || ''}`.trim(),
        foregroundWaitLastEventAt: now
    })

    if(now - lastEventAt < FOREGROUND_LEASE_WAIT_EVENT_MS || !metadata?.profileHref) return

    void recordProfileNukeProgress(metadata.profileHref, {
        waitingForForegroundAt,
        foregroundWaitReason: `${reason || ''}`.trim(),
        foregroundWaitLastEventAt: now,
        event: `Queued tab waiting for foreground lease${reason ? ` (${reason})` : ''}`
    }).catch(() => {})
}

async function promoteNextQueuedForegroundCandidate(reason = 'foreground-lease-released') {
    for(const tabId of Array.from(activeQueuedTabs)) {
        const metadata = getQueuedTabMetadata(tabId)
        if(!isForegroundQueuedTabWork(metadata, null)) continue
        if(metadata?.noForegroundFallback) continue

        const result = await promoteQueuedTab(tabId, reason, {metadata})
        if(result?.promoted) return result
    }

    return {promoted: false, reason: 'no-foreground-candidate'}
}

function clearQueuedForegroundLease(reason = '') {
    const normalizedTabId = normalizeTabId(queuedForegroundLeaseTabId)
    if(!normalizedTabId) {
        queuedForegroundLeaseTabId = null
        return false
    }

    queuedForegroundLeaseTabId = null
    setQueuedTabMetadata(normalizedTabId, {
        foregroundLeaseReleasedAt: Date.now(),
        foregroundLeaseReleaseReason: `${reason || ''}`.trim()
    })
    return true
}

function releaseQueuedForegroundLease(tabId, reason = '') {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId || normalizeTabId(queuedForegroundLeaseTabId) !== normalizedTabId) return false

    return clearQueuedForegroundLease(reason)
}

function addExpectedTerminalTabId(tabIdsByHref, href = '', tabId = null) {
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedHref || !normalizedTabId) return

    let tabIds = tabIdsByHref.get(normalizedHref)
    if(!tabIds) {
        tabIds = new Set()
        tabIdsByHref.set(normalizedHref, tabIds)
    }
    tabIds.add(normalizedTabId)
}

function isExpectedTerminalSweepTab(tabId, href = '', expectedTabIdsByHref = new Map()) {
    const normalizedTabId = normalizeTabId(tabId)
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    if(!normalizedTabId || !normalizedHref) return false

    if(expectedTabIdsByHref.get(normalizedHref)?.has(normalizedTabId)) return true
    return hasOwnedQueuedTabState(normalizedTabId)
}

async function buildTabCreateOptions(action = {}) {
    const options = {
        url: normalizeTabTargetUrl(action.url),
        active: shouldActivateOwnedQueuedTabOnOpen(action)
    }

    if(action.ownerWindowId) {
        options.windowId = action.ownerWindowId
    }
    if(action.ownerWindowId && action.ownerTabId && `${action.tabAction || ''}` !== 'nuke') {
        options.openerTabId = action.ownerTabId
    }

    return options
}

function shouldActivateOwnedQueuedTabOnOpen(action = {}) {
    return action?.active === true ||
        action?.activateOnOpen === true ||
        action?.foregroundOnOpen === true
}

function shouldUseQueuedWorkerActionSurface(action = {}) {
    if(normalizeOwnedParentId(action?.ownerTabId) !== SERVICE_WORKER_QUEUE_OWNER_ID) return false
    if(!isForegroundQueuedTabWork(action, null)) return false
    if(!browser.windows?.create || !browser.tabs?.update) return false
    return true
}

function resetQueuedWorkerActionSurface(reason = '') {
    if(queuedActionSurfaceCleanupTimeout) {
        clearTimeout(queuedActionSurfaceCleanupTimeout)
        queuedActionSurfaceCleanupTimeout = null
    }
    queuedActionSurfaceCleanupDueAt = 0
    queuedActionSurfaceWindowId = null
    queuedActionSurfaceAnchorTabId = null
    if(reason) {
        incrementQueueWakeupMetric(`actionSurface.reset.${reason}`)
    }
}

function isQueuedWorkerActionSurfaceUrl(url = '') {
    return `${url || ''}` === getQueuedActionSurfaceUrl()
}

async function getQueuedWorkerActionSurfaceAnchorTabs() {
    const existingTabs = browser.tabs?.query
        ? await browser.tabs.query({}).catch(() => [])
        : []
    return (existingTabs || []).filter(tab => isQueuedWorkerActionSurfaceUrl(tab?.url || ''))
}

async function closeQueuedWorkerActionSurfaceWindow(windowId = null, reason = '') {
    const normalizedWindowId = Number.parseInt(windowId, 10) || 0
    if(!normalizedWindowId) return false

    if(browser.windows?.remove) {
        await browser.windows.remove(normalizedWindowId).catch(() => null)
    }
    else {
        const win = await browser.windows?.get?.(normalizedWindowId, {populate: true}).catch(() => null)
        const tabs = Array.isArray(win?.tabs) ? win.tabs : []
        await Promise.allSettled(tabs
            .filter(tab => tab?.id)
            .map(tab => browser.tabs.remove(tab.id)))
    }
    if(normalizeTabId(normalizedWindowId) === normalizeTabId(queuedActionSurfaceWindowId)) {
        queuedActionSurfaceWindowId = null
        queuedActionSurfaceAnchorTabId = null
    }
    incrementQueueWakeupMetric(`actionSurface.workerWindow.closed.${normalizeStorageMetricPathName(reason || 'idle')}`)
    return true
}

async function closeDuplicateQueuedWorkerActionSurfaceTabs(anchorTab = null) {
    const anchorTabId = normalizeTabId(anchorTab?.id || null)
    const anchorWindowId = Number.parseInt(anchorTab?.windowId, 10) || 0
    const surfaceTabs = await getQueuedWorkerActionSurfaceAnchorTabs()
    let closed = 0

    for(const tab of surfaceTabs) {
        const tabId = normalizeTabId(tab?.id || null)
        const windowId = Number.parseInt(tab?.windowId, 10) || 0
        if(!tabId || tabId === anchorTabId) continue

        if(windowId && windowId !== anchorWindowId) {
            const win = await browser.windows?.get?.(windowId, {populate: true}).catch(() => null)
            const tabs = Array.isArray(win?.tabs) ? win.tabs : []
            const hasProfileTab = tabs.some(candidate => /^https:\/\/www\.quora\.com\/profile\//i.test(candidate?.url || ''))
            if(!hasProfileTab && tabs.every(candidate =>
                candidate?.id === tabId ||
                !candidate?.url ||
                /^about:blank$/i.test(candidate.url || '') ||
                isQueuedWorkerActionSurfaceUrl(candidate.url || '')
            )) {
                await closeQueuedWorkerActionSurfaceWindow(windowId, 'duplicate')
                closed += 1
                continue
            }
        }

        await browser.tabs.remove(tabId).catch(() => null)
        closed += 1
    }

    if(closed) incrementQueueWakeupMetric('actionSurface.workerWindow.duplicateClosed', closed)
    return closed
}

function isIdleQueuedWorkerActionSurfaceTab(tab = null) {
    const url = `${tab?.url || ''}`
    return !url ||
        /^about:blank$/i.test(url) ||
        isQueuedWorkerActionSurfaceUrl(url)
}

async function closeIdleQueuedWorkerActionSurfaceWindows(reason = 'idle-orphan') {
    const surfaceTabs = await getQueuedWorkerActionSurfaceAnchorTabs()
    const windowIds = Array.from(new Set(surfaceTabs
        .map(tab => Number.parseInt(tab?.windowId, 10) || 0)
        .filter(Boolean)))
    let closed = 0

    for(const windowId of windowIds) {
        if(hasQueuedWorkerActionSurfaceRuntimeWork(windowId)) continue

        const win = await browser.windows?.get?.(windowId, {populate: true}).catch(() => null)
        const tabs = Array.isArray(win?.tabs) ? win.tabs : []
        if(!tabs.length) continue
        if(tabs.some(candidate => /^https:\/\/www\.quora\.com\/profile\//i.test(candidate?.url || ''))) continue
        if(!tabs.every(isIdleQueuedWorkerActionSurfaceTab)) continue

        if(await closeQueuedWorkerActionSurfaceWindow(windowId, reason)) {
            closed += 1
        }
    }

    if(closed) {
        incrementQueueWakeupMetric('actionSurface.workerWindow.idleOrphanClosed', closed)
    }
    return closed
}

function hasQueuedWorkerActionSurfaceRuntimeWork(windowId = queuedActionSurfaceWindowId) {
    const normalizedWindowId = Number.parseInt(windowId, 10) || 0
    if(queuedActionSurfaceOpenPromise) return true

    for(const tabId of activeQueuedTabs) {
        const metadata = getQueuedTabMetadata(tabId)
        if(!metadata) continue
        if(metadata.actionSurfaceMode === 'worker-window') return true
        if(normalizedWindowId && Number.parseInt(metadata.actionSurfaceWindowId, 10) === normalizedWindowId) return true
    }

    for(const action of pendingTabActions.values()) {
        if(action?.actionSurfaceMode === 'worker-window') return true
        if(normalizedWindowId && Number.parseInt(action?.actionSurfaceWindowId, 10) === normalizedWindowId) return true
    }

    return false
}

async function closeQueuedWorkerActionSurfaceIfIdle(reason = 'idle') {
    const windowId = Number.parseInt(queuedActionSurfaceWindowId, 10) || 0
    if(!windowId) {
        const closed = await closeIdleQueuedWorkerActionSurfaceWindows(reason)
        if(closed) return true
        incrementQueueWakeupMetric('actionSurface.workerWindow.cleanupNoWindow')
        return false
    }
    if(hasQueuedWorkerActionSurfaceRuntimeWork(windowId)) {
        incrementQueueWakeupMetric('actionSurface.workerWindow.cleanupBusy')
        return false
    }

    const win = await browser.windows?.get?.(windowId, {populate: true}).catch(() => null)
    if(!win?.id) {
        resetQueuedWorkerActionSurface('missing-idle-window')
        return false
    }

    return closeQueuedWorkerActionSurfaceWindow(windowId, reason)
}

function scheduleQueuedWorkerActionSurfaceCleanup(reason = 'idle', delayMs = 1500) {
    const normalizedDelayMs = Math.max(250, Number.parseInt(delayMs, 10) || 1500)
    const dueAt = Date.now() + normalizedDelayMs
    if(queuedActionSurfaceCleanupTimeout) {
        if(queuedActionSurfaceCleanupDueAt && queuedActionSurfaceCleanupDueAt <= dueAt) return
        clearTimeout(queuedActionSurfaceCleanupTimeout)
        queuedActionSurfaceCleanupTimeout = null
    }
    queuedActionSurfaceCleanupDueAt = dueAt
    incrementQueueWakeupMetric(`actionSurface.workerWindow.cleanupScheduled.${normalizeStorageMetricPathName(reason || 'idle')}`)
    queuedActionSurfaceCleanupTimeout = setTimeout(() => {
        queuedActionSurfaceCleanupTimeout = null
        queuedActionSurfaceCleanupDueAt = 0
        incrementQueueWakeupMetric(`actionSurface.workerWindow.cleanupFired.${normalizeStorageMetricPathName(reason || 'idle')}`)
        void closeQueuedWorkerActionSurfaceIfIdle(reason)
            .then(closed => {
                if(!closed && queuedActionSurfaceWindowId && !queuedTabActions.length) {
                    scheduleQueuedWorkerActionSurfaceCleanup(reason, delayMs)
                }
            })
            .catch(() => null)
    }, normalizedDelayMs)
}

async function getLiveQueuedWorkerActionSurface() {
    const windowId = Number.parseInt(queuedActionSurfaceWindowId, 10) || 0
    if(!windowId) {
        const surfaceTabs = await getQueuedWorkerActionSurfaceAnchorTabs()
        const anchor = surfaceTabs.find(tab => tab?.id && tab?.windowId) || null
        if(anchor?.id && anchor.windowId) {
            queuedActionSurfaceWindowId = anchor.windowId
            queuedActionSurfaceAnchorTabId = normalizeTabId(anchor.id)
            await closeDuplicateQueuedWorkerActionSurfaceTabs(anchor).catch(() => null)
            incrementQueueWakeupMetric('actionSurface.workerWindow.reused')
            return {
                windowId: queuedActionSurfaceWindowId,
                anchorTabId: queuedActionSurfaceAnchorTabId,
                reused: true
            }
        }
        return null
    }

    if(browser.windows?.get) {
        try {
            const win = await browser.windows.get(windowId, {populate: true})
            if(win?.id) {
                const anchor = (win.tabs || []).find(tab => tab?.id === queuedActionSurfaceAnchorTabId) ||
                    (win.tabs || []).find(tab => isQueuedWorkerActionSurfaceUrl(tab?.url || '')) ||
                    null
                if(anchor?.id) queuedActionSurfaceAnchorTabId = anchor.id
                if(anchor?.id) await closeDuplicateQueuedWorkerActionSurfaceTabs(anchor).catch(() => null)
                return {
                    windowId: win.id,
                    anchorTabId: queuedActionSurfaceAnchorTabId || anchor?.id || null,
                    reused: true
                }
            }
        }
        catch {
            resetQueuedWorkerActionSurface('missing-window')
            return null
        }
    }

    if(queuedActionSurfaceAnchorTabId) {
        try {
            const tab = await browser.tabs.get(queuedActionSurfaceAnchorTabId)
            if(tab?.windowId === windowId) {
                return {
                    windowId,
                    anchorTabId: queuedActionSurfaceAnchorTabId,
                    reused: true
                }
            }
        }
        catch {
            resetQueuedWorkerActionSurface('missing-anchor')
        }
    }

    return null
}

async function restoreQueuedActionSurfaceCallerFocus(previousActiveTab = null) {
    if(!previousActiveTab?.id) return false

    const restored = await browser.tabs.update(previousActiveTab.id, {active: true}).catch(() => null)
    const windowId = restored?.windowId || previousActiveTab.windowId || null
    if(windowId && browser.windows?.update) {
        await browser.windows.update(windowId, {focused: true}).catch(() => null)
    }
    return !!restored
}

async function getOrCreateQueuedWorkerActionSurface(previousActiveTab = null) {
    const existing = await getLiveQueuedWorkerActionSurface()
    if(existing?.windowId) return existing
    if(!browser.windows?.create) return null

    if(queuedActionSurfaceOpenPromise) return queuedActionSurfaceOpenPromise

    queuedActionSurfaceOpenPromise = (async () => {
        const win = await browser.windows.create({
            url: getQueuedActionSurfaceUrl(),
            focused: false,
            type: 'normal'
        })
        const windowId = Number.parseInt(win?.id, 10) || 0
        const anchorTab = Array.isArray(win?.tabs)
            ? win.tabs.find(tab => tab?.id) || null
            : null
        if(!windowId) return null

        queuedActionSurfaceWindowId = windowId
        queuedActionSurfaceAnchorTabId = normalizeTabId(anchorTab?.id)
        await restoreQueuedActionSurfaceCallerFocus(previousActiveTab)
        incrementQueueWakeupMetric('actionSurface.workerWindow.created')

        return {
            windowId,
            anchorTabId: queuedActionSurfaceAnchorTabId,
            reused: false
        }
    })()
        .catch(error => {
            resetQueuedWorkerActionSurface('create-failed')
            incrementQueueWakeupMetric('actionSurface.workerWindow.createFailed')
            throw error
        })
        .finally(() => {
            queuedActionSurfaceOpenPromise = null
        })

    return queuedActionSurfaceOpenPromise
}

function tagActionWithQueuedWorkerSurface(action = {}, surface = {}, tab = {}, activatedAt = Date.now()) {
    action.actionSurfaceMode = 'worker-window'
    action.actionSurfaceWindowId = surface.windowId || tab.windowId || null
    action.actionSurfaceAnchorTabId = surface.anchorTabId || null
    action.actionSurfaceActivatedAt = activatedAt
    return action
}

function isQueuedWorkerActionSurfaceTab(tab = null, metadata = null) {
    const tabWindowId = Number.parseInt(tab?.windowId, 10) || 0
    const metadataWindowId = Number.parseInt(metadata?.actionSurfaceWindowId, 10) || 0
    const currentWindowId = Number.parseInt(queuedActionSurfaceWindowId, 10) || 0

    if(metadata?.actionSurfaceMode === 'worker-window') return true
    if(tabWindowId && metadataWindowId && tabWindowId === metadataWindowId) return true
    if(tabWindowId && currentWindowId && tabWindowId === currentWindowId) return true
    return false
}

async function createOwnedTabInQueuedWorkerActionSurface(action = {}, options = {}) {
    if(!shouldUseQueuedWorkerActionSurface(action)) return null

    const previousActiveTab = await getLastFocusedActiveTab().catch(() => null)
    const surface = await getOrCreateQueuedWorkerActionSurface(previousActiveTab)
    if(!surface?.windowId) return null

    const surfaceCreateOptions = {
        ...options,
        windowId: surface.windowId,
        active: false
    }
    delete surfaceCreateOptions.openerTabId

    const tab = await browser.tabs.create(surfaceCreateOptions)
    const activatedAt = Date.now()
    const activatedTab = await browser.tabs.update(tab.id, {active: true}).catch(() => null)
    if(!activatedTab?.id) {
        await browser.tabs.remove(tab.id).catch(() => null)
        incrementQueueWakeupMetric('actionSurface.workerWindow.activateFailed')
        throw new Error('worker-action-surface-activate-failed')
    }
    await restoreQueuedActionSurfaceCallerFocus(previousActiveTab)
    tagActionWithQueuedWorkerSurface(action, surface, activatedTab || tab, activatedAt)
    incrementQueueWakeupMetric('actionSurface.workerWindow.openedTab')

    return {
        ...tab,
        ...(activatedTab || {}),
        active: activatedTab?.active === true || tab.active === true,
        windowId: activatedTab?.windowId || tab.windowId || surface.windowId
    }
}

async function createOwnedTab(action = {}) {
    const options = await buildTabCreateOptions(action)
    const surfaceTab = await createOwnedTabInQueuedWorkerActionSurface(action, options).catch(() => null)
    if(surfaceTab?.id) return surfaceTab

    const previousActiveTab = action?.noForegroundFallback === true && options.active !== true
        ? await getLastFocusedActiveTab().catch(() => null)
        : null

    try {
        const tab = await browser.tabs.create(options)
        await restoreBackgroundQueuedTabFocus(tab, previousActiveTab, action)
        return tab
    }
    catch(error) {
        if(!options.windowId && !options.openerTabId) throw error

        const fallbackOptions = {
            url: options.url,
            active: options.active
        }
        const tab = await browser.tabs.create(fallbackOptions)
        await restoreBackgroundQueuedTabFocus(tab, previousActiveTab, action)
        return tab
    }
}

async function getLastFocusedActiveTab() {
    const tabs = await browser.tabs.query({active: true, lastFocusedWindow: true})
    return Array.isArray(tabs) ? tabs.find(tab => tab?.id) || null : null
}

async function restoreBackgroundQueuedTabFocus(tab = null, previousActiveTab = null, action = {}) {
    if(action?.noForegroundFallback !== true || !tab?.active || !previousActiveTab?.id || previousActiveTab.id === tab.id) {
        return false
    }

    const restored = await browser.tabs.update(previousActiveTab.id, {active: true}).catch(() => null)
    const windowId = restored?.windowId || previousActiveTab.windowId || null
    if(windowId && browser.windows?.update) {
        await browser.windows.update(windowId, {focused: true}).catch(() => null)
    }
    if(action.profileHref || action.targetProfileHref || action.url) {
        void recordCoordinatorJobProgress(action.profileHref || action.targetProfileHref || action.url, {
            foregroundRestoredAt: Date.now(),
            event: 'Restored focus after background queued tab opened active'
        }, {senderTabId: tab.id}).catch(() => {})
    }
    return !!restored
}

function hasScriptingInjectionApi() {
    return !!browser.scripting?.executeScript
}

async function activateConfirmationElementInPageWorld(request = {}, sender = {}) {
    const tabId = normalizeTabId(sender.tab?.id || null)
    const token = `${request.token || ''}`.trim()
    const confirmationKind = `${request.confirmationKind || ''}`.trim().toLowerCase()
    const attr = 'data-mb-confirm-activation-token'
    if(!tabId || (!token && !confirmationKind)) return {clicked: false, reason: 'missing-target'}
    if(!hasScriptingInjectionApi()) return {clicked: false, reason: 'scripting-api-unavailable'}

    const tab = await browser.tabs.get(tabId).catch(() => null)
    if(!isQuoraHttpUrl(tab?.url || '')) return {clicked: false, reason: 'not-quora-tab'}

    const injection = {
        target: {tabId},
        func: (attributeName, activationToken, kind) => {
            const textOf = node => `${node?.innerText || node?.textContent || node?.getAttribute?.('aria-label') || ''}`
                .replace(/\s+/g, ' ')
                .trim()
            const visible = node => {
                if(!node) return false
                const rect = node.getBoundingClientRect()
                const style = getComputedStyle(node)
                return rect.width > 0 &&
                    rect.height > 0 &&
                    style.visibility !== 'hidden' &&
                    style.display !== 'none' &&
                    Number(style.opacity || '1') !== 0
            }
            const contextFor = node => {
                let current = node?.parentElement || null
                let best = ''
                let depth = 0
                while(current && current !== document.body && depth < 8) {
                    const text = textOf(current)
                    if(text.length > best.length) best = text
                    if(/\bcancel\b/i.test(text) && /\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i.test(text)) return text
                    current = current.parentElement
                    depth += 1
                }
                return best
            }
            const kindMatches = (contextText, buttonText) => {
                if(kind === 'mute') {
                    return /\bmuted\b|\bmuting this person\b/i.test(contextText) &&
                        !/\bun[\s-]*mute\b/i.test(contextText)
                }
                if(kind === 'unmute') {
                    return /\bun[\s-]*mute\b|\bmuted\b/i.test(contextText) &&
                        !/\bblock\b|\bblocked\b/i.test(contextText)
                }
                if(kind === 'block') {
                    return /\bblock this profile\b|\bblock this person\b|\bblocking this person\b|\bblock\b|\bblocked\b/i.test(contextText) &&
                        !/\bmuted\b|\bmuting this person\b|\bun[\s-]*mute\b/i.test(contextText)
                }
                return /\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i.test(buttonText)
            }
            const activate = element => {
                const rect = element.getBoundingClientRect()
                const clientX = rect.left + Math.max(1, Math.min(rect.width / 2, rect.width - 1))
                const clientY = rect.top + Math.max(1, Math.min(rect.height / 2, rect.height - 1))
                const base = {bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, button: 0}
                try {
                    element.dispatchEvent(new PointerEvent('pointerdown', {...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1}))
                    element.dispatchEvent(new MouseEvent('mousedown', {...base, buttons: 1}))
                    element.dispatchEvent(new PointerEvent('pointerup', {...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0}))
                    element.dispatchEvent(new MouseEvent('mouseup', {...base, buttons: 0}))
                    element.dispatchEvent(new MouseEvent('click', {...base, buttons: 0}))
                    return 'pointer-mouse'
                }
                catch {
                    element.click()
                    return 'click'
                }
            }
            const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'))
                .filter(visible)
                .filter(candidate => /\bconfirm\b|\bcontinue\b|\byes\b|\bok\b|\bblock\b|\bmute\b/i.test(textOf(candidate)))

            let element = activationToken
                ? buttons.find(candidate => candidate.getAttribute(attributeName) === activationToken)
                : null
            if(!element) {
                element = buttons.find(candidate => kindMatches(contextFor(candidate), textOf(candidate)))
            }
            if(!element) return {clicked: false, reason: 'target-not-found'}

            const text = textOf(element)
            const contextText = contextFor(element)
            const activation = activate(element)
            return {clicked: true, activation, text, contextText: contextText.slice(0, 240), kind}
        },
        args: [attr, token, confirmationKind],
        world: 'MAIN'
    }

    let results = null
    try {
        results = await browser.scripting.executeScript(injection)
    }
    catch(error) {
        const fallbackInjection = {...injection}
        delete fallbackInjection.world
        try {
            results = await browser.scripting.executeScript(fallbackInjection)
        }
        catch(fallbackError) {
            return {
                clicked: false,
                reason: 'execute-script-failed',
                error: `${fallbackError?.message || fallbackError || error?.message || error || ''}`
            }
        }
    }

    const result = Array.isArray(results) ? results[0]?.result || null : null
    return result || {clicked: false, reason: 'no-result'}
}

function getExpectedContentScriptVersion() {
    try {
        return `${browser.runtime?.getManifest?.()?.version || ''}`.trim()
    }
    catch {
        return ''
    }
}

function isQuoraHttpUrl(url = '') {
    try {
        const parsed = new URL(`${url || ''}`)
        const hostname = `${parsed.hostname || ''}`.toLowerCase()
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            (hostname === 'quora.com' || hostname === 'www.quora.com' || hostname.endsWith('.quora.com'))
    }
    catch {
        return false
    }
}

function scheduleQueuedTabContentScriptEnsure(tabId, reason = '') {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return

    setTimeout(() => {
        void ensureQueuedTabContentScript(normalizedTabId, reason)
    }, QUEUED_TAB_CONTENT_SCRIPT_CHECK_DELAY_MS)
}

async function probeQueuedTabContentScript(tabId) {
    if(!hasScriptingInjectionApi()) return {present: false, available: false}

    const results = await browser.scripting.executeScript({
        target: {tabId},
        func: (readyAttr, expectedVersion) => {
            const marker = `${document.documentElement?.getAttribute(readyAttr) || ''}`.trim()
            const muteBlockControls = document.querySelectorAll('[class*="mb-ext_"]').length
            return {
                marker,
                expectedVersion,
                versionMatches: expectedVersion ? marker === expectedVersion : !!marker,
                muteBlockControls,
                readyState: document.readyState,
                url: location.href
            }
        },
        args: [CONTENT_SCRIPT_READY_ATTR, getExpectedContentScriptVersion()]
    })

    const result = Array.isArray(results) ? results[0]?.result || null : null
    return {
        available: true,
        present: !!result?.versionMatches,
        marker: result?.marker || '',
        expectedVersion: result?.expectedVersion || '',
        versionMatches: !!result?.versionMatches,
        muteBlockControls: Number.parseInt(result?.muteBlockControls, 10) || 0,
        readyState: result?.readyState || '',
        url: result?.url || ''
    }
}

async function ensureQueuedTabContentScript(tabId, reason = '') {
    const normalizedTabId = normalizeTabId(tabId)
    const metadata = getQueuedTabMetadata(normalizedTabId)
    if(!normalizedTabId || (!metadata?.profileHref && !metadata?.coordinatorKey)) return {ensured: false, reason: 'not-owned-queued-tab'}
    if(!hasScriptingInjectionApi()) return {ensured: false, reason: 'scripting-api-unavailable'}

    const tab = await browser.tabs.get(normalizedTabId).catch(() => null)
    const currentUrl = `${tab?.url || metadata.lastUrl || metadata.requestedUrl || metadata.profileHref || ''}`.trim()
    if(!currentUrl || !isQuoraHttpUrl(currentUrl)) return {ensured: false, reason: 'not-quora-tab'}
    if(metadata.contentScriptEnsureUrl === currentUrl && (metadata.contentScriptPresentAt || metadata.contentScriptInjectedAt)) {
        const nudgeResult = await nudgeQueuedTabActionClaimWithRetries(
            normalizedTabId,
            reason || 'content-script-already-checked'
        )
        return {ensured: true, alreadyChecked: true, nudge: nudgeResult}
    }

    const startedAt = Date.now()
    setQueuedTabMetadata(normalizedTabId, {
        contentScriptEnsureStartedAt: startedAt,
        contentScriptEnsureReason: `${reason || ''}`.trim(),
        contentScriptEnsureUrl: currentUrl
    })

    try {
        const probe = await probeQueuedTabContentScript(normalizedTabId)
        if(probe.present) {
            setQueuedTabMetadata(normalizedTabId, {
                contentScriptPresentAt: Date.now(),
                contentScriptProbe: probe
            })
            const nudgeResult = await nudgeQueuedTabActionClaimWithRetries(normalizedTabId, reason || 'content-script-present')
            const profileHref = normalizeQuoraProfileUrl(currentUrl)
            if(!nudgeResult?.nudged && profileHref) {
                const reloadRequestedAt = Date.now()
                incrementQueueWakeupMetric('nudge.reloadRequested')
                setQueuedTabMetadata(normalizedTabId, {
                    contentScriptReloadRequestedAt: reloadRequestedAt,
                    contentScriptReloadReason: nudgeResult?.reason || 'claim-nudge-not-accepted',
                    contentScriptPresentAt: 0,
                    contentScriptInjectedAt: 0,
                    contentScriptEnsureUrl: ''
                })
                if(metadata.profileHref) {
                    void recordCoordinatorJobProgress(metadata.profileHref, {
                        contentScriptReloadRequestedAt: reloadRequestedAt,
                        event: 'Reloaded queued profile tab after unresponsive content script marker'
                    }, {senderTabId: normalizedTabId})
                }
                await browser.tabs.reload(normalizedTabId)
                return {ensured: true, alreadyPresent: true, reloaded: true, nudge: nudgeResult}
            }
            return {ensured: true, alreadyPresent: true, nudge: nudgeResult}
        }

        if(browser.scripting?.insertCSS) {
            await browser.scripting.insertCSS({
                target: {tabId: normalizedTabId},
                files: ['css/content.css']
            }).catch(() => null)
        }

        await browser.scripting.executeScript({
            target: {tabId: normalizedTabId},
            files: ['js/content.js']
        })

        const injectedAt = Date.now()
        setQueuedTabMetadata(normalizedTabId, {
            contentScriptInjectedAt: injectedAt,
            contentScriptProbe: probe
        })
        if(metadata.profileHref) {
            void recordCoordinatorJobProgress(metadata.profileHref, {
                contentScriptInjectedAt: injectedAt,
                event: reason
                    ? `Injected content script into queued tab after ${reason}`
                    : 'Injected content script into queued tab'
            }, {senderTabId: normalizedTabId})
        }
        const nudgeResult = await nudgeQueuedTabActionClaimWithRetries(normalizedTabId, reason || 'content-script-injected')
        if(!nudgeResult?.nudged && metadata.profileHref) {
            const reloadRequestedAt = Date.now()
            incrementQueueWakeupMetric('nudge.reloadRequested')
            setQueuedTabMetadata(normalizedTabId, {
                contentScriptReloadRequestedAt: reloadRequestedAt,
                contentScriptReloadReason: nudgeResult?.reason || 'claim-nudge-not-accepted-after-injection',
                contentScriptPresentAt: 0,
                contentScriptInjectedAt: 0,
                contentScriptEnsureUrl: ''
            })
            void recordCoordinatorJobProgress(metadata.profileHref, {
                contentScriptReloadRequestedAt: reloadRequestedAt,
                event: 'Reloaded queued profile tab after injected content script did not accept claim'
            }, {senderTabId: normalizedTabId})
            await browser.tabs.reload(normalizedTabId)
            return {ensured: true, injected: true, reloaded: true, nudge: nudgeResult}
        }

        return {ensured: true, injected: true, nudge: nudgeResult}
    }
    catch(error) {
        const failedAt = Date.now()
        setQueuedTabMetadata(normalizedTabId, {
            contentScriptEnsureFailedAt: failedAt,
            contentScriptEnsureError: error?.message || `${error || ''}`
        })
        rememberQueueLoadPressure(/timed out|frame|receiving end|could not establish/i.test(error?.message || '')
            ? 'content-script-unscriptable'
            : 'content-script-ensure-failed', {
            tabId: normalizedTabId,
            profileHref: metadata?.profileHref || '',
            coordinatorKey: metadata?.coordinatorKey || ''
        })
        if(metadata.profileHref) {
            void recordCoordinatorJobProgress(metadata.profileHref, {
                contentScriptEnsureFailedAt: failedAt,
                event: 'Queued tab content script injection check failed'
            }, {senderTabId: normalizedTabId})
        }
        return {ensured: false, reason: 'inject-failed', error: error?.message || `${error || ''}`}
    }
}

async function nudgeQueuedTabActionClaim(tabId, reason = '') {
    const normalizedTabId = normalizeTabId(tabId)
    const metadata = normalizedTabId ? getQueuedTabMetadata(normalizedTabId) : null
    const cycle = startQueueWakeupMetricCycle('nudge', 'nudgeQueuedTabActionClaim', reason, {
        tabId: normalizedTabId,
        profileHref: metadata?.profileHref || '',
        coordinatorKey: metadata?.coordinatorKey || '',
        attemptId: metadata?.attemptId || '',
        attemptNumber: Number.parseInt(metadata?.attemptNumber, 10) || 0
    })
    incrementQueueWakeupMetric('nudge.sent')
    if(!normalizedTabId) {
        incrementQueueWakeupMetric('nudge.rejected.missingAction')
        finishQueueWakeupMetricCycle(cycle, 'ignored', 'missing-tab')
        return {nudged: false, reason: 'missing-tab'}
    }
    const claimableAction = makeClaimableQueuedTabAction(
        pendingTabActions.get(normalizedTabId) || null,
        metadata || null
    )
    if(!claimableAction) {
        incrementQueueWakeupMetric('nudge.rejected.missingAction')
    }

    try {
        const response = await promiseWithTimeout(
            browser.tabs.sendMessage(normalizedTabId, {
                action: 'claim-current-profile-tab-action',
                reason,
                queuedAction: claimableAction || null
            }),
            QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,
            'queued tab action claim nudge'
        )
        if(response?.accepted === true) {
            incrementQueueWakeupMetric('nudge.accepted')
        }
        else {
            incrementQueueWakeupMetric('nudge.rejected.missingAction')
        }
        finishQueueWakeupMetricCycle(cycle, response?.accepted === true ? 'accepted' : 'ignored', response?.reason || 'claim-response', {
            accepted: response?.accepted === true,
            claimable: !!claimableAction
        })
        return {
            nudged: response?.accepted === true,
            response: response || null
        }
    }
    catch(error) {
        const timedOut = /timed out/i.test(error?.message || '')
        const failedAt = Date.now()
        if(normalizedTabId && activeQueuedTabs.has(normalizedTabId)) {
            setQueuedTabMetadata(normalizedTabId, {
                lastNudgeFailedAt: failedAt,
                lastNudgeFailure: error?.message || `${error || ''}`
            })
            rememberQueueLoadPressure(timedOut ? 'claim-nudge-timeout' : 'claim-nudge-failed', {
                tabId: normalizedTabId,
                profileHref: metadata?.profileHref || '',
                coordinatorKey: metadata?.coordinatorKey || ''
            })
        }
        incrementQueueWakeupMetric(timedOut ? 'nudge.failed.timeout' : 'nudge.failed.message')
        finishQueueWakeupMetricCycle(cycle, timedOut ? 'timed-out' : 'failed', error?.message || 'message-failed', {
            claimable: !!claimableAction
        })
        return {
            nudged: false,
            reason: 'message-failed',
            error: error?.message || `${error || ''}`
        }
    }
}

async function nudgeQueuedTabActionClaimWithRetries(tabId, reason = '', delays = [0, 250, 750, 1500]) {
    let lastResult = null

    for(const delay of delays) {
        if(delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay))
        }

        lastResult = await nudgeQueuedTabActionClaim(tabId, reason)
        if(lastResult?.nudged) return lastResult
    }

    return lastResult || {nudged: false, reason: 'not-attempted'}
}

async function restoreOwnerTabFocus(metadata = null, closingTabId = null) {
    if(metadata?.actionSurfaceMode !== 'worker-window') return false

    const restoreTabId = normalizeTabId(metadata.foregroundRestoreTabId || null)
    if(!restoreTabId || restoreTabId === normalizeTabId(closingTabId)) return false

    const tab = await browser.tabs?.get?.(restoreTabId).catch(() => null)
    if(!tab?.id) return false

    const restored = await browser.tabs.update(tab.id, {active: true}).catch(() => null)
    const restoreWindowId = Number.parseInt(
        restored?.windowId || tab.windowId || metadata.foregroundRestoreWindowId || 0,
        10
    ) || 0
    if(restoreWindowId && browser.windows?.update) {
        await browser.windows.update(restoreWindowId, {focused: true}).catch(() => null)
    }
    incrementQueueWakeupMetric('actionSurface.workerWindow.focusRestored')
    return !!restored
}

async function promoteQueuedTab(tabId, reason = '', options = {}) {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return {promoted: false, reason: 'invalid-tab-id'}

    const metadata = options.metadata || getQueuedTabMetadata(normalizedTabId)
    const progressRecord = metadata?.profileHref
        ? profileNukeProgress?.[normalizeQuoraProfileUrl(metadata.profileHref)] || null
        : null
    if(options.requireForegroundWork === true && !isForegroundQueuedTabWork(metadata, progressRecord)) {
        return {promoted: false, reason: 'not-foreground-work'}
    }
    if(!activeQueuedTabs.has(normalizedTabId) && !pendingTabActions.has(normalizedTabId)) {
        return {promoted: false, reason: 'not-active-queued-tab'}
    }

    const tab = await browser.tabs.get(normalizedTabId).catch(() => null)
    if(!tab?.id) return {promoted: false, reason: 'missing-tab'}

    const promotedAt = Date.now()
    const actionSurfaceMode = isQueuedWorkerActionSurfaceTab(tab, metadata) ? 'worker-window' : ''
    if(metadata?.noForegroundFallback && !actionSurfaceMode) {
        return {promoted: false, reason: 'foreground-fallback-disabled'}
    }
    const captureRestoreTab = actionSurfaceMode && isForegroundRequiredProfileActionRequest({reason})
        ? await getLastFocusedActiveTab().catch(() => null)
        : null
    const updateResult = tab.active === true
        ? tab
        : await browser.tabs.update(normalizedTabId, {active: true}).catch(() => null)
    if(!updateResult?.id) return {promoted: false, reason: 'activate-failed'}

    const windowId = updateResult.windowId || tab.windowId || metadata?.ownerWindowId || null
    if(windowId && browser.windows?.update && (!actionSurfaceMode || isForegroundRequiredProfileActionRequest({reason}))) {
        await browser.windows.update(windowId, {focused: true}).catch(() => null)
    }

    queuedForegroundLeaseTabId = normalizedTabId
    setQueuedTabMetadata(normalizedTabId, {
        foregroundPromotedAt: promotedAt,
        foregroundPromotionReason: `${reason || ''}`.trim(),
        foregroundMode: actionSurfaceMode || 'focused-window',
        actionSurfaceMode: metadata?.actionSurfaceMode || actionSurfaceMode || '',
        actionSurfaceWindowId: metadata?.actionSurfaceWindowId || (actionSurfaceMode ? windowId : null),
        actionSurfaceActivatedAt: actionSurfaceMode ? promotedAt : metadata?.actionSurfaceActivatedAt || 0,
        ...(actionSurfaceMode && captureRestoreTab?.id && normalizeTabId(captureRestoreTab.id) !== normalizedTabId ? {
            foregroundRestoreTabId: normalizeTabId(captureRestoreTab.id),
            foregroundRestoreWindowId: Number.parseInt(captureRestoreTab.windowId, 10) || null,
            foregroundRestoreCapturedAt: promotedAt,
            foregroundRestoreReason: `${reason || ''}`.trim()
        } : {}),
        waitingForForegroundAt: 0,
        foregroundWaitReason: '',
        foregroundWaitLastEventAt: promotedAt
    })
    if(metadata?.profileHref) {
        void recordProfileNukeProgress(metadata.profileHref, {
            foregroundPromotedAt: promotedAt,
            foregroundPromotionReason: `${reason || ''}`.trim(),
            foregroundMode: actionSurfaceMode || 'focused-window',
            ...(actionSurfaceMode && captureRestoreTab?.id && normalizeTabId(captureRestoreTab.id) !== normalizedTabId ? {
                foregroundRestoreCapturedAt: promotedAt,
                foregroundRestoreReason: `${reason || ''}`.trim()
            } : {}),
            waitingForForegroundAt: 0,
            foregroundWaitReason: '',
            foregroundWaitLastEventAt: promotedAt,
            event: reason
                ? `Queued tab promoted to ${actionSurfaceMode || 'foreground'} (${reason})`
                : `Queued tab promoted to ${actionSurfaceMode || 'foreground'}`
        }, {senderTabId: normalizedTabId}).catch(() => {})
    }

    return {
        promoted: true,
        alreadyActive: tab.active === true,
        tabId: normalizedTabId,
        promotedAt,
        foregroundMode: actionSurfaceMode || 'focused-window',
        reason: `${reason || ''}`.trim()
    }
}

function markQueuedTabClosing(tabId, reason = '') {
    if(!tabId) return 0
    const metadata = getQueuedTabMetadata(tabId)
    const normalizedReason = `${reason || ''}`.trim()
    const existingCloseRequestedAt = Number.isFinite(metadata?.closeRequestedAt) ? metadata.closeRequestedAt : 0
    const closeRequestedAt = existingCloseRequestedAt || Date.now()

    setQueuedTabMetadata(tabId, {
        closeRequestedAt,
        closeReason: normalizedReason
    })
    if(metadata?.profileHref) {
        const normalizedHref = normalizeQuoraProfileUrl(metadata.profileHref)
        const requestedActionKind = getCoordinatorActionKindForRequestedAction(metadata?.actionKind || metadata?.tabAction || '')
        const storedProgressRecord = normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
        const progressActionKind = storedProgressRecord?.actionKind || 'mute-block'
        const progressRecord = progressActionKind === requestedActionKind
            ? storedProgressRecord
            : null
        const existingProgressCloseRequestedAt = Number.isFinite(progressRecord?.closeRequestedAt) && progressRecord.closeRequestedAt > 0

        void recordProfileNukeProgress(metadata.profileHref, {
            ...(existingProgressCloseRequestedAt ? {} : {closeRequestedAt}),
            closedByExtension: true,
            closeReason: normalizedReason,
            event: `Queued tab close requested${normalizedReason ? ` (${normalizedReason})` : ''}`
        })
    }

    return closeRequestedAt
}

function getErrorPageUrl(url = '') {
    const value = `${url || ''}`.trim()
    if(!value) return ''

    if(/^(?:chrome|edge|about|moz-extension|chrome-error):/i.test(value)) return value

    try {
        const parsed = new URL(value)
        const hostname = `${parsed.hostname || ''}`.toLowerCase()
        if(parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return value
        if(hostname && hostname !== 'quora.com' && hostname !== 'www.quora.com' && !hostname.endsWith('.quora.com')) {
            return value
        }
    }
    catch {
        return value
    }

    return ''
}

function serializeOwnedTabIdsByParent() {
    const serialized = {}

    for(const [parentTabId, childTabIds] of ownedTabIdsByParent.entries()) {
        if(!childTabIds.size) continue
        serialized[parentTabId] = Array.from(childTabIds)
    }

    return serialized
}

function rebuildOwningParentByChild() {
    owningParentByChild.clear()

    for(const [parentTabId, childTabIds] of ownedTabIdsByParent.entries()) {
        for(const childTabId of childTabIds) {
            owningParentByChild.set(childTabId, parentTabId)
        }
    }
}

async function persistOwnedTabIdsByParent() {
    try {
        await metricStorageSet({[OWNED_TAB_STATE_KEY]: serializeOwnedTabIdsByParent()}, {
            snapshotWriteReason: 'userMemoryNonAuthority'
        })
    }
    catch {}
}

function schedulePersistOwnedTabIdsByParent(delayMs = 250) {
    clearTimeout(persistOwnedTabIdsTimeout)
    persistOwnedTabIdsTimeout = setTimeout(() => {
        persistOwnedTabIdsTimeout = null
        void persistOwnedTabIdsByParent()
    }, delayMs)
}

async function loadOwnedTabIdsByParent() {
    try {
        const stored = await metricStorageGet({[OWNED_TAB_STATE_KEY]: {}})
        const serialized = stored?.[OWNED_TAB_STATE_KEY] || {}

        ownedTabIdsByParent.clear()

        for(const [parentTabId, childTabIds] of Object.entries(serialized)) {
            const normalizedParentTabId = normalizeOwnedParentId(parentTabId)
            if(!normalizedParentTabId || !Array.isArray(childTabIds) || !childTabIds.length) continue

            ownedTabIdsByParent.set(normalizedParentTabId, new Set(childTabIds.map(tabId => Number.parseInt(tabId, 10)).filter(Boolean)))
        }

        rebuildOwningParentByChild()
    }
    catch {}
}

const ownedTabIdsReady = loadOwnedTabIdsByParent()

function sendTabMessage(tabId, message, timeoutMs = 3000) {
    const delivery = browser.tabs.sendMessage(tabId, message).catch(error => {
        if(/Receiving end does not exist/i.test(error?.message || '')) return
    })

    if(!timeoutMs || timeoutMs <= 0) return delivery

    return Promise.race([
        delivery,
        new Promise(resolve => setTimeout(() => resolve(null), timeoutMs))
    ])
}

function registerOwnedTab(parentTabId, childTabId) {
    const normalizedParentTabId = normalizeOwnedParentId(parentTabId)
    if(!normalizedParentTabId || !childTabId) return

    let ownedTabIds = ownedTabIdsByParent.get(normalizedParentTabId)
    if(!ownedTabIds) {
        ownedTabIds = new Set()
        ownedTabIdsByParent.set(normalizedParentTabId, ownedTabIds)
    }

    ownedTabIds.add(childTabId)
    owningParentByChild.set(childTabId, normalizedParentTabId)
    schedulePersistOwnedTabIdsByParent()
}

function unregisterOwnedTab(childTabId) {
    if(!childTabId) return

    const parentTabId = owningParentByChild.get(childTabId)
    if(!parentTabId) {
        let removed = false
        for(const [candidateParentTabId, ownedTabIds] of ownedTabIdsByParent.entries()) {
            if(!ownedTabIds?.delete(childTabId)) continue
            removed = true
            if(!ownedTabIds.size) {
                ownedTabIdsByParent.delete(candidateParentTabId)
            }
        }
        if(removed) {
            schedulePersistOwnedTabIdsByParent()
        }
        return
    }

    owningParentByChild.delete(childTabId)

    const ownedTabIds = ownedTabIdsByParent.get(parentTabId)
    if(!ownedTabIds) return

    ownedTabIds.delete(childTabId)
    if(!ownedTabIds.size) {
        ownedTabIdsByParent.delete(parentTabId)
    }

    schedulePersistOwnedTabIdsByParent()
}

async function getLiveOwnedTabIds(parentTabId) {
    await ownedTabIdsReady

    const ownedTabIds = Array.from(ownedTabIdsByParent.get(parentTabId) || [])
    if(!ownedTabIds.length) return []

    const liveTabIds = []

    for(const tabId of ownedTabIds) {
        try {
            await browser.tabs.get(tabId)
            liveTabIds.push(tabId)
        }
        catch {
            unregisterOwnedTab(tabId)
        }
    }

    return liveTabIds
}

async function getKnownLiveOwnedTabIdsReadOnly(parentTabId) {
    await ownedTabIdsReady

    const ownedTabIds = Array.from(ownedTabIdsByParent.get(parentTabId) || [])
    if(!ownedTabIds.length) return []

    const liveTabIds = []

    for(const tabId of ownedTabIds) {
        try {
            await browser.tabs.get(tabId)
            liveTabIds.push(tabId)
        }
        catch {}
    }

    return liveTabIds
}

async function sweepOwnedBlockedProfileTabs(parentTabId) {
    const ownedTabIds = await getLiveOwnedTabIds(parentTabId)
    if(!ownedTabIds.length) return {owned: 0, signaled: 0}

    let signaled = 0

    for(const tabId of ownedTabIds) {
        try {
            const metadata = getQueuedTabMetadata(tabId)
            if(metadata?.closeRequestedAt) continue
            if(`${metadata?.actionKind || metadata?.tabAction || ''}` === UNBLOCK_UNMUTE_ACTION_KIND) continue
            const response = await sendTabMessage(tabId, {
                action: 'close-if-blocked',
                actionKind: metadata?.actionKind || '',
                requestedProfileHref: metadata?.profileHref || '',
                attemptId: metadata?.attemptId || '',
                attemptNumber: metadata?.attemptNumber || 0
            })
            if(response?.willClose) {
                const recorded = await recordOwnedBlockedSweepTerminal(tabId, metadata, response)
                if(!recorded?.terminal) continue

                signaled += 1
                markQueuedTabClosing(tabId, 'background-blocked-sweep')
                await releaseQueuedTabAndCleanup(tabId, {awaitFill: true})
                await browser.tabs.remove(tabId).catch(() => {})
            }
        }
        catch {}
    }

    return {owned: ownedTabIds.length, signaled}
}

function scheduleOwnedBlockedProfileSweep(parentTabId, delayMs = 3000) {
    if(!parentTabId) return

    setTimeout(() => {
        void sweepOwnedBlockedProfileTabs(parentTabId).catch(() => null)
    }, Math.max(500, Number.parseInt(delayMs, 10) || 3000))
}

async function recordOwnedBlockedSweepTerminal(tabId, metadata = null, response = {}) {
    const normalizedTabId = normalizeTabId(tabId)
    const normalizedProfileHref = normalizeQuoraProfileUrl(metadata?.profileHref || '')
    const resolvedProfileHref = normalizeQuoraProfileUrl(response?.resolvedProfileHref || '')
    const actionKind = getCoordinatorActionKindForRequestedAction(metadata?.actionKind || metadata?.tabAction || 'mute-block')
    const attemptId = getAttemptIdFromValue(metadata)
    const attemptNumber = getAttemptNumberFromValue(metadata)

    if(!normalizedTabId || !activeQueuedTabs.has(normalizedTabId)) return {recorded: false, terminal: false, reason: 'not-active-owned-work'}
    if(!normalizedProfileHref || !resolvedProfileHref || normalizedProfileHref !== resolvedProfileHref) {
        return {recorded: false, terminal: false, reason: 'profile-mismatch'}
    }
    if(actionKind === UNBLOCK_UNMUTE_ACTION_KIND) return {recorded: false, terminal: false, reason: 'reverse-action'}
    if(!attemptId) return {recorded: false, terminal: false, reason: 'missing-attempt'}

    const result = await recordCoordinatorJobProgress(normalizedProfileHref, {
        actionKind,
        runId: metadata?.runId || '',
        status: 'already-blocked',
        openedViablePage: true,
        foundBlockedBeforeQueue: true,
        blockSucceeded: true,
        blockedAt: Date.now(),
        tabId: normalizedTabId,
        attemptId,
        attemptNumber,
        lastUrl: response?.lastUrl || '',
        resolvedProfileHref,
        remappedFromRequested: false,
        finalError: '',
        event: 'Profile confirmed blocked by background sweep'
    }, {
        senderTabId: normalizedTabId,
        expectTerminal: true,
        requireActiveSenderTab: true
    })

    if(result?.terminal) scheduleQueuedWorkContinuation('background-blocked-sweep-terminal')
    return result
}

async function sweepTerminalBlockedProfileTabs(profileHrefs = [], expectedTabIdsByHref = new Map()) {
    const hrefFilter = new Set(getNormalizedProfileHrefList(profileHrefs || []))
    if(!hrefFilter.size) return {candidates: 0, signaled: 0}

    const tabsByHref = await getLiveProfileTabsByHref()
    let candidates = 0
    let signaled = 0

    for(const href of hrefFilter) {
        const tabs = tabsByHref.get(href) || []
        for(const tab of tabs) {
            const tabId = normalizeTabId(tab?.id)
            if(!tabId) continue
            if(!isExpectedTerminalSweepTab(tabId, href, expectedTabIdsByHref)) continue

            candidates += 1
            try {
                const response = await sendTabMessage(tabId, {
                    action: 'close-if-blocked',
                    requestedProfileHref: href
                })
                if(response?.willClose) {
                    signaled += 1
                    markQueuedTabClosing(tabId, 'terminal-coordinator-live-tab-sweep')
                    await releaseQueuedTabAndCleanup(tabId, {awaitFill: true})
                    await browser.tabs.remove(tabId).catch(() => {})
                    continue
                }
            }
            catch {}

            await releaseQueuedTabAndCleanup(tabId, {awaitFill: true})
        }
    }

    return {candidates, signaled}
}

async function closeSuccessfulSourceProfileTabs(queue = {}, profileHrefs = []) {
    const hrefFilter = new Set(getNormalizedProfileHrefList(profileHrefs || []))
    let candidates = 0
    let closed = 0

    for(const [itemKey, item] of Object.entries(queue || {})) {
        if(item?.status !== 'succeeded' || item?.closeSourceTabOnSuccess !== true) continue

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const tabId = normalizeTabId(item?.sourceTabId)
        if(!href || !tabId) continue
        if(hrefFilter.size && !hrefFilter.has(href)) continue

        candidates += 1
        try {
            const tab = await browser.tabs.get(tabId)
            if(normalizeQuoraProfileUrl(tab?.url || '') !== href) continue

            const response = await sendTabMessage(tabId, {
                action: 'close-if-blocked',
                requestedProfileHref: href
            })
            if(response?.willClose) {
                closed += 1
                await browser.tabs.remove(tabId).catch(() => {})
            }
        }
        catch {}
    }

    return {candidates, closed}
}

async function closeTerminalOwnedProfileTabs(profileHrefs = []) {
    await ensureProfileNukeProgressReady()
    await ownedTabIdsReady

    const hrefFilter = new Set(getNormalizedProfileHrefList(profileHrefs || []))
    const currentAuthorityState = await loadCoordinatorCurrentAuthorityState({
        [COORDINATOR_QUEUE_KEY]: {},
        [PROFILE_NUKE_PROGRESS_KEY]: {}
    })
    const queue = currentAuthorityState.queue || {}
    const storedProgress = currentAuthorityState.progress || {}
    const terminalHrefs = new Set()
    const terminalTabIdsByHref = new Map()

    for(const [itemKey, item] of Object.entries(queue || {})) {
        if(!isTerminalCoordinatorStatus(item?.status)) continue

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        if(!href) continue
        if(hrefFilter.size && !hrefFilter.has(href)) continue

        terminalHrefs.add(href)
        addExpectedTerminalTabId(terminalTabIdsByHref, href, item?.tabId)
        addExpectedTerminalTabId(terminalTabIdsByHref, href, profileNukeProgress?.[href]?.tabId)
        addExpectedTerminalTabId(terminalTabIdsByHref, href, storedProgress?.[href]?.tabId)
    }

    if(!terminalHrefs.size) return {closed: 0}

    let closed = 0
    const closedTabIds = new Set()

    for(const [href, tabIds] of terminalTabIdsByHref.entries()) {
        for(const tabId of Array.from(tabIds || [])) {
            const normalizedTabId = normalizeTabId(tabId)
            if(!normalizedTabId || closedTabIds.has(normalizedTabId)) continue

            try {
                const tab = await browser.tabs.get(normalizedTabId)
                if(normalizeQuoraProfileUrl(tab?.url || '') !== href) continue

                markQueuedTabClosing(normalizedTabId, 'terminal-coordinator-tab-id')
                await releaseQueuedTabAndCleanup(normalizedTabId, {awaitFill: true})
                try {
                    await browser.tabs.remove(normalizedTabId)
                }
                catch {}
                closedTabIds.add(normalizedTabId)
                closed += 1
            }
            catch {
                cleanupQueuedTabMetadataOnly(normalizedTabId)
            }
        }
    }

    const ownerEntries = Array.from(ownedTabIdsByParent.entries())

    for(const [, ownedTabIds] of ownerEntries) {
        for(const tabId of Array.from(ownedTabIds || [])) {
            const normalizedTabId = normalizeTabId(tabId)
            if(closedTabIds.has(normalizedTabId)) continue

            let tab = null
            try {
                tab = await browser.tabs.get(tabId)
            }
            catch {
                unregisterOwnedTab(tabId)
                continue
            }

            const href = normalizeQuoraProfileUrl(tab?.url || '')
            if(!href || !terminalHrefs.has(href)) continue

            markQueuedTabClosing(tabId, 'terminal-coordinator-state')
            await releaseQueuedTabAndCleanup(tabId, {awaitFill: true})
            try {
                await browser.tabs.remove(tabId)
            }
            catch {}
            closedTabIds.add(normalizedTabId)
            closed += 1
        }
    }

    if(closed) {
        await fillQueuedTabs()
    }

    const swept = hrefFilter.size
        ? await sweepTerminalBlockedProfileTabs(Array.from(terminalHrefs), terminalTabIdsByHref)
        : {candidates: 0, signaled: 0}
    const sourceClosed = await closeSuccessfulSourceProfileTabs(queue, Array.from(terminalHrefs))

    return {
        closed: closed + swept.signaled + sourceClosed.closed,
        ownedClosed: closed,
        liveTabCandidates: swept.candidates,
        liveTabsSignaled: swept.signaled,
        sourceTabCandidates: sourceClosed.candidates,
        sourceTabsSignaled: sourceClosed.closed
    }
}

function isTerminalProfileNukeRecord(record) {
    if(record?.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
        return isSuccessfulUnblockUnmuteProfileRecord(record) ||
            record.status === 'unblocked' ||
            record.status === 'already-unblocked' ||
            record.status === 'error' ||
            record.status === 'error-page' ||
            record.status === 'profile-unavailable' ||
            record.status === 'interrupted'
    }

    return !!record && (
        !!record.blockSucceeded ||
        record.status === 'blocked' ||
        record.status === 'already-blocked' ||
        record.status === 'error' ||
        record.status === 'error-page' ||
        record.status === 'profile-unavailable' ||
        record.status === 'interrupted'
    )
}

function isSuccessfulProfileNukeRecord(record) {
    if(record?.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
        return isSuccessfulUnblockUnmuteProfileRecord(record)
    }

    return !!record && (
        !!record.blockSucceeded ||
        record.status === 'blocked' ||
        record.status === 'already-blocked'
    )
}

function isSuccessfulUnblockUnmuteProfileRecord(record = null) {
    if(!record || record.actionKind !== UNBLOCK_UNMUTE_ACTION_KIND) return false
    if(record.unblockSucceeded || record.status === 'unblocked' || record.status === 'already-unblocked') return true

    const unblockReason = `${record.unblockReason || ''}`.trim()
    const unmuteReason = `${record.unmuteReason || ''}`.trim()
    return record.unblockOk === true &&
        record.unmuteOk === true &&
        /^(?:unblocked|already-unblocked|not-blocked|not-blocked-anymore)$/.test(unblockReason) &&
        !/error|failed|not-found/i.test(unmuteReason) &&
        !`${record.finalError || ''}`.trim()
}

function isRetryableTerminalProfileNukeRecord(record) {
    if(!isTerminalProfileNukeRecord(record)) return false
    if(isExplicitSecurityVerificationRecord(record)) return false

    const status = `${record?.status || ''}`.trim()
    if(status === 'interrupted') return true
    if(status === 'error') return true

    return false
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

function isTransientProfileNukeStatus(status) {
    return new Set([
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
    ]).has(`${status || ''}`.trim())
}

function getProgressHeartbeatAt(record) {
    return Number.isFinite(record?.updatedAt) ? record.updatedAt : 0
}

function hasProgressTimestamp(record, key) {
    return Number.isFinite(record?.[key]) && record[key] > 0
}

function getActiveQueuedTabStaleTimeoutMs(record, metadata = null) {
    const status = `${record?.status || ''}`.trim()
    const closeRequestedAt = Math.max(
        Number.isFinite(record?.closeRequestedAt) ? record.closeRequestedAt : 0,
        Number.isFinite(metadata?.closeRequestedAt) ? metadata.closeRequestedAt : 0
    )
    if(closeRequestedAt > 0) return STALE_CLOSE_REQUESTED_QUEUED_TAB_MS

    const slotReleasedAt = Math.max(
        Number.isFinite(record?.slotReleasedAt) ? record.slotReleasedAt : 0,
        Number.isFinite(metadata?.slotReleasedAt) ? metadata.slotReleasedAt : 0
    )
    if(slotReleasedAt > 0) return STALE_CLOSE_REQUESTED_QUEUED_TAB_MS

    const waitingForForegroundAt = Math.max(
        Number.isFinite(record?.waitingForForegroundAt) ? record.waitingForForegroundAt : 0,
        Number.isFinite(metadata?.waitingForForegroundAt) ? metadata.waitingForForegroundAt : 0
    )
    const foregroundLeaseAt = Math.max(
        Number.isFinite(record?.foregroundLeaseAcquiredAt) ? record.foregroundLeaseAcquiredAt : 0,
        Number.isFinite(record?.foregroundPromotedAt) ? record.foregroundPromotedAt : 0,
        Number.isFinite(metadata?.foregroundLeaseAcquiredAt) ? metadata.foregroundLeaseAcquiredAt : 0,
        Number.isFinite(metadata?.foregroundPromotedAt) ? metadata.foregroundPromotedAt : 0
    )
    if(isForegroundQueuedTabWork(metadata, record) && !hasProgressTimestamp(record, 'actionReadyAt')) {
        return STALE_FOREGROUND_WAIT_QUEUED_TAB_MS
    }
    if((waitingForForegroundAt > 0 || foregroundLeaseAt > 0) && !hasProgressTimestamp(record, 'actionReadyAt')) {
        return STALE_FOREGROUND_WAIT_QUEUED_TAB_MS
    }
    if(status === 'muting' || status === 'blocking' || status === 'unmuting' || status === 'unblocking') {
        const actionKind = `${record?.actionKind || metadata?.actionKind || metadata?.tabAction || ''}`.trim()
        if(actionKind === UNBLOCK_UNMUTE_ACTION_KIND) return STALE_UNBLOCK_UNMUTE_ACTION_QUEUED_TAB_MS
        return STALE_ACTIVE_ACTION_QUEUED_TAB_MS
    }
    if(metadata?.noForegroundFallback) {
        if(!hasProgressTimestamp(record, 'contentOpenedAt')) {
            return STALE_BACKGROUND_OPENING_QUEUED_TAB_MS
        }
        if(!hasProgressTimestamp(record, 'actionReadyAt')) {
            return STALE_BACKGROUND_READY_QUEUED_TAB_MS
        }
        return STALE_ACTIVE_ACTION_QUEUED_TAB_MS
    }

    return STALE_ACTIVE_QUEUED_TAB_MS
}

function getActiveQueuedTabStartedAt(metadata = null, record = null) {
    return Math.max(
        Number.isFinite(metadata?.openedAt) ? metadata.openedAt : 0,
        Number.isFinite(metadata?.tabOpenedAt) ? metadata.tabOpenedAt : 0,
        Number.isFinite(metadata?.tabCreatedAt) ? metadata.tabCreatedAt : 0,
        Number.isFinite(record?.tabOpenedAt) ? record.tabOpenedAt : 0,
        Number.isFinite(record?.tabCreatedAt) ? record.tabCreatedAt : 0
    )
}

function getActiveQueuedTabActionPhaseStartedAt(record = null, metadata = null) {
    return Math.max(
        Number.isFinite(record?.actionReadyAt) ? record.actionReadyAt : 0,
        Number.isFinite(record?.muteAttemptedAt) ? record.muteAttemptedAt : 0,
        Number.isFinite(record?.blockAttemptedAt) ? record.blockAttemptedAt : 0,
        Number.isFinite(record?.unblockedAt) ? record.unblockedAt : 0,
        Number.isFinite(metadata?.actionReadyAt) ? metadata.actionReadyAt : 0,
        Number.isFinite(metadata?.muteAttemptedAt) ? metadata.muteAttemptedAt : 0,
        Number.isFinite(metadata?.blockAttemptedAt) ? metadata.blockAttemptedAt : 0,
        Number.isFinite(metadata?.unblockedAt) ? metadata.unblockedAt : 0,
        Number.isFinite(metadata?.milestones?.profileReadyAt) ? metadata.milestones.profileReadyAt : 0,
        Number.isFinite(metadata?.milestones?.muteAttemptedAt) ? metadata.milestones.muteAttemptedAt : 0,
        Number.isFinite(metadata?.milestones?.blockAttemptedAt) ? metadata.milestones.blockAttemptedAt : 0
    )
}

function getActiveQueuedTabAgeAnchor(metadata = null, record = null) {
    if(hasActiveQueuedTabActionPhaseProgress(record, metadata)) {
        const actionStartedAt = getActiveQueuedTabActionPhaseStartedAt(record, metadata)
        if(actionStartedAt) return actionStartedAt
    }

    return getActiveQueuedTabStartedAt(metadata, record)
}

function hasActiveQueuedTabActionPhaseProgress(record = null, metadata = null) {
    const status = `${record?.status || ''}`.trim()
    if(status === 'muting' || status === 'blocking' || status === 'unmuting' || status === 'unblocking') return true

    return Math.max(
        Number.isFinite(record?.muteAttemptedAt) ? record.muteAttemptedAt : 0,
        Number.isFinite(record?.blockAttemptedAt) ? record.blockAttemptedAt : 0,
        Number.isFinite(record?.unmuteAttemptedAt) ? record.unmuteAttemptedAt : 0,
        Number.isFinite(record?.unblockAttemptedAt) ? record.unblockAttemptedAt : 0,
        Number.isFinite(metadata?.muteAttemptedAt) ? metadata.muteAttemptedAt : 0,
        Number.isFinite(metadata?.blockAttemptedAt) ? metadata.blockAttemptedAt : 0,
        Number.isFinite(metadata?.unmuteAttemptedAt) ? metadata.unmuteAttemptedAt : 0,
        Number.isFinite(metadata?.unblockAttemptedAt) ? metadata.unblockAttemptedAt : 0
    ) > 0
}

function getPersistedQueuedTabId(item = null, record = null) {
    return normalizeTabId(record?.tabId || item?.tabId || null)
}

function getPersistedActiveProgressStaleAnchor(record = null) {
    if(!record) return 0

    return Math.max(
        Number.isFinite(record.closeRequestedAt) ? record.closeRequestedAt : 0,
        Number.isFinite(record.slotReleasedAt) ? record.slotReleasedAt : 0,
        Number.isFinite(record.blockAttemptedAt) ? record.blockAttemptedAt : 0,
        Number.isFinite(record.muteAttemptedAt) ? record.muteAttemptedAt : 0,
        Number.isFinite(record.foregroundLeaseAcquiredAt) ? record.foregroundLeaseAcquiredAt : 0,
        Number.isFinite(record.foregroundPromotedAt) ? record.foregroundPromotedAt : 0,
        Number.isFinite(record.foregroundWaitLastEventAt) ? record.foregroundWaitLastEventAt : 0,
        Number.isFinite(record.waitingForForegroundAt) ? record.waitingForForegroundAt : 0,
        Number.isFinite(record.actionReadyAt) ? record.actionReadyAt : 0,
        Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : 0,
        Number.isFinite(record.tabOpenedAt) ? record.tabOpenedAt : 0,
        Number.isFinite(record.tabCreatedAt) ? record.tabCreatedAt : 0
    )
}

function getPersistedActiveCoordinatorStaleAnchor(item = null, record = null) {
    return Math.max(
        getPersistedActiveProgressStaleAnchor(record),
        Number.isFinite(item?.activeAt) ? item.activeAt : 0,
        Number.isFinite(item?.updatedAt) ? item.updatedAt : 0,
        Number.isFinite(item?.queuedAt) ? item.queuedAt : 0,
        Number.isFinite(item?.createdAt) ? item.createdAt : 0
    )
}

function getLiveTabsForProfileHref(liveProfileTabsByHref = new Map(), href = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    return normalizedHref ? liveProfileTabsByHref.get(normalizedHref) || [] : []
}

function getOwnedOrExpectedLiveTabsForProfileHref(item = null, record = null, href = '', liveProfileTabsByHref = new Map()) {
    const expectedTabIds = new Set()
    const persistedTabId = getPersistedQueuedTabId(item, record)
    if(persistedTabId) expectedTabIds.add(persistedTabId)

    return getLiveTabsForProfileHref(liveProfileTabsByHref, href)
        .filter(tab => {
            const tabId = normalizeTabId(tab?.id)
            return tabId && (expectedTabIds.has(tabId) || hasOwnedQueuedTabState(tabId))
        })
}

function hasConfirmedRuntimeActorForCoordinatorItem(item = null, record = null) {
    const tabId = getPersistedQueuedTabId(item, record)
    if(!tabId || !activeQueuedTabs.has(tabId) || !isDurablyActiveQueuedTab(tabId)) return false

    const metadata = getQueuedTabMetadata(tabId)
    const expectedAttemptId = getAttemptIdFromValue(item) || getAttemptIdFromValue(record)
    const expectedAttemptNumber = getAttemptNumberFromValue(item) || getAttemptNumberFromValue(record)
    const metadataAttemptId = getAttemptIdFromValue(metadata)
    const metadataAttemptNumber = getAttemptNumberFromValue(metadata)
    if(expectedAttemptId && metadataAttemptId !== expectedAttemptId) return false
    if(expectedAttemptNumber && metadataAttemptNumber !== expectedAttemptNumber) return false

    const expectedHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(record?.profileHref || '')
    const metadataHref = normalizeQuoraProfileUrl(metadata?.profileHref || metadata?.targetProfileHref || metadata?.requestedUrl || '')
    if(expectedHref && metadataHref && metadataHref !== expectedHref) return false

    const expectedActionKind = getCoordinatorActionKindForItem(item) ||
        getCoordinatorActionKindForProgress(record)
    const metadataActionKind = getCoordinatorActionKindForRequestedAction(metadata?.actionKind || metadata?.tabAction || '')
    if(expectedActionKind && metadataActionKind && metadataActionKind !== expectedActionKind) return false

    return true
}

function hasConfirmedLiveRuntimeActorForCoordinatorItem(item = null, record = null, liveProfileTabsByHref = new Map()) {
    if(!hasConfirmedRuntimeActorForCoordinatorItem(item, record)) return false

    const tabId = getPersistedQueuedTabId(item, record)
    const metadata = getQueuedTabMetadata(tabId)
    const expectedHref = getCoordinatorItemHref(item) ||
        normalizeQuoraProfileUrl(record?.profileHref || '') ||
        normalizeQuoraProfileUrl(metadata?.profileHref || metadata?.targetProfileHref || metadata?.requestedUrl || '')
    const liveTabs = getLiveTabsForProfileHref(liveProfileTabsByHref, expectedHref)
    return liveTabs.some(tab => normalizeTabId(tab?.id) === tabId)
}

async function shouldImmediatelyReconcileMissingPersistedActiveTab(item = null, record = null) {
    if(!item || typeof item !== 'object') return false
    if(isTerminalCoordinatorStatus(item.status)) return false
    if(isTerminalProfileNukeRecord(record)) return false

    const itemStatus = `${item.status || ''}`.trim()
    const recordStatus = `${record?.status || ''}`.trim()
    const rowIsClaimed = itemStatus === 'active' || itemStatus === 'settling'
    const recordIsActiveEvidence = !!record &&
        !!recordStatus &&
        recordStatus !== 'queued' &&
        isTransientProfileNukeStatus(recordStatus)
    if(record && !rowIsClaimed && !recordIsActiveEvidence) return false

    const queuedRowHasClaimedProgress = itemStatus === 'queued' && recordIsActiveEvidence
    if(!rowIsClaimed && !queuedRowHasClaimedProgress) return false

    const tabId = getPersistedQueuedTabId(item, record)
    if(!tabId) return false

    try {
        await browser.tabs.get(tabId)
        return false
    }
    catch {
        if(hasOwnedQueuedTabState(tabId)) {
            detachQueuedTabRuntimeState(tabId, 'missing-persisted-active-tab')
        }
        return true
    }
}

async function getMissingActiveCoordinatorRepairDecision(
    item = null,
    record = null,
    itemKey = '',
    href = '',
    liveProfileTabsByHref = new Map(),
    now = Date.now(),
    persistedActiveTabMissing = false
) {
    if(persistedActiveTabMissing) {
        return {
            reconcile: true,
            closePersistedTab: false,
            reason: 'persisted-tab-missing'
        }
    }

    if(!shouldReconcileMissingActiveCoordinatorTab(item, record, href, liveProfileTabsByHref, now)) {
        return {
            reconcile: false,
            closePersistedTab: false,
            reason: 'not-missing-active'
        }
    }

    const tabId = getPersistedQueuedTabId(item, record)
    if(!tabId) {
        return {
            reconcile: true,
            closePersistedTab: false,
            reason: 'missing-active-no-persisted-tab'
        }
    }

    const persistedTab = await getPersistedLiveTabForCoordinatorItem(item, record, itemKey)
    if(persistedTab) {
        if(!isDurableActiveCoordinatorReclaimStale(item, record, now)) {
            return {
                reconcile: false,
                closePersistedTab: false,
                reason: 'persisted-tab-still-live'
            }
        }

        return {
            reconcile: true,
            closePersistedTab: true,
            reason: 'stale-persisted-tab'
        }
    }

    try {
        await browser.tabs.get(tabId)
        return {
            reconcile: true,
            closePersistedTab: false,
            reason: 'implausible-persisted-tab'
        }
    }
    catch {
        if(hasOwnedQueuedTabState(tabId)) {
            detachQueuedTabRuntimeState(tabId, 'missing-persisted-active-tab')
        }
        return {
            reconcile: true,
            closePersistedTab: false,
            reason: 'persisted-tab-missing'
        }
    }
}

function applyMissingActiveCoordinatorEvidenceReconcileActionLocked(state = {}, operation = {}) {
    const queue = state.queue || {}
    const runs = state.runs || {}
    const progress = state.progress || {}
    const itemKey = `${operation.itemKey || ''}`.trim()
    if(!itemKey) return {changed: false, reason: 'missing-item-key'}

    const item = queue[itemKey] || null
    if(!item || typeof item !== 'object') return {changed: false, reason: 'row-changed'}
    if(isTerminalCoordinatorStatus(item.status)) return {changed: false, reason: 'terminal-row'}

    const expectedAttemptId = normalizeAttemptId(operation.expectedAttemptId || '')
    const expectedAttemptNumber = Number.parseInt(operation.expectedAttemptNumber, 10) || 0
    if(expectedAttemptId && getAttemptIdFromValue(item) !== expectedAttemptId) {
        return {changed: false, reason: 'attempt-changed'}
    }
    if(expectedAttemptNumber && getAttemptNumberFromValue(item) !== expectedAttemptNumber) {
        return {changed: false, reason: 'attempt-changed'}
    }

    const href = getCoordinatorItemHref(item) ||
        normalizeQuoraProfileUrl(operation.href || '') ||
        normalizeQuoraProfileUrl(itemKey)
    if(!href) return {changed: false, reason: 'missing-href'}

    const record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
    if(record && hasMismatchedCoordinatorAttempt(item, record)) {
        return {changed: false, reason: 'progress-attempt-mismatch'}
    }

    const now = Number.parseInt(operation.now, 10) || Date.now()
    const nextRecord = makeMissingActiveCoordinatorProgressRecord(href, record, now, item)
    if(!nextRecord) return {changed: false, reason: 'missing-progress-record'}

    const recordHref = normalizeQuoraProfileUrl(href || nextRecord.profileHref || '')
    if(!recordHref) return {changed: false, reason: 'missing-record-href'}
    if(JSON.stringify(progress[recordHref] || null) === JSON.stringify(nextRecord)) {
        return {changed: false, reason: 'unchanged'}
    }

    progress[recordHref] = nextRecord
    profileNukeProgress = {
        ...profileNukeProgress,
        [recordHref]: nextRecord
    }

    const affectedRunIds = new Set()
    if(item.runId) affectedRunIds.add(item.runId)
    for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
        affectedRunIds.add(runId)
    }

    const tabIdsToClose = new Set()
    const persistedTabId = normalizeTabId(operation.persistedTabId || getPersistedQueuedTabId(item, record))
    if(operation.closePersistedTab === true && persistedTabId) tabIdsToClose.add(persistedTabId)
    for(const tabId of operation.expectedLiveTabIds || []) {
        const normalizedTabId = normalizeTabId(tabId)
        if(normalizedTabId && normalizedTabId !== persistedTabId) tabIdsToClose.add(normalizedTabId)
    }

    return {
        changed: true,
        progressChanged: true,
        repaired: 1,
        affectedRunIds: Array.from(affectedRunIds),
        tabIdsToClose: Array.from(tabIdsToClose),
        href: recordHref
    }
}

function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = '', liveProfileTabsByHref = new Map(), now = Date.now()) {
    if(!item || typeof item !== 'object') return false
    if(isTerminalCoordinatorStatus(item.status)) return false
    if(isTerminalProfileNukeRecord(record)) return false

    const itemStatus = `${item.status || ''}`.trim()
    const recordStatus = `${record?.status || ''}`.trim()
    const rowIsClaimed = itemStatus === 'active' || itemStatus === 'settling'
    const recordIsActiveEvidence = !!record &&
        !!recordStatus &&
        recordStatus !== 'queued' &&
        isTransientProfileNukeStatus(recordStatus)
    if(record && !rowIsClaimed && !recordIsActiveEvidence) return false

    const queuedRowHasClaimedProgress = itemStatus === 'queued' && recordIsActiveEvidence
    if(!rowIsClaimed && !queuedRowHasClaimedProgress) return false

    const actionPhaseActive = hasActiveQueuedTabActionPhaseProgress(record, item)
    const confirmedRuntimeActor = hasConfirmedRuntimeActorForCoordinatorItem(item, record)
    const confirmedLiveRuntimeActor = confirmedRuntimeActor &&
        hasConfirmedLiveRuntimeActorForCoordinatorItem(item, record, liveProfileTabsByHref)
    const activeStartedAt = actionPhaseActive
        ? getActiveQueuedTabAgeAnchor(item, record)
        : Number.isFinite(item?.activeAt) ? item.activeAt : 0
    const activeJobMaxMs = actionPhaseActive
        ? COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS
        : COORDINATOR_ACTIVE_JOB_MAX_MS
    const activeAgeExpired = rowIsClaimed &&
        activeStartedAt > 0 &&
        now - activeStartedAt >= activeJobMaxMs
    if(rowIsClaimed &&
        !actionPhaseActive &&
        !confirmedLiveRuntimeActor &&
        !getOwnedOrExpectedLiveTabsForProfileHref(item, record, href, liveProfileTabsByHref).length) {
        return true
    }

    const staleRecord = recordIsActiveEvidence ? record : null
    const staleAnchor = getPersistedActiveCoordinatorStaleAnchor(item, staleRecord)
    const staleTimeoutMs = staleRecord ? getActiveQueuedTabStaleTimeoutMs(staleRecord, {
        noForegroundFallback: true
    }) : STALE_BACKGROUND_OPENING_QUEUED_TAB_MS
    if(!activeAgeExpired && (!staleAnchor || now - staleAnchor < staleTimeoutMs)) return false

    if(rowIsClaimed && !actionPhaseActive && !confirmedLiveRuntimeActor) {
        return true
    }

    if(getOwnedOrExpectedLiveTabsForProfileHref(item, record, href, liveProfileTabsByHref).length) return false

    const tabId = getPersistedQueuedTabId(item, record)
    if(tabId) return !hasOwnedQueuedTabState(tabId)

    return !getOwnedOrExpectedLiveTabsForProfileHref(item, record, href, liveProfileTabsByHref).length
}

async function shouldReconcileMissingActiveCoordinatorKeyOnlyItem(item = null, record = null, now = Date.now()) {
    if(!item || typeof item !== 'object') return false
    if(!isProfileResolutionItem(item)) return false
    if(getCoordinatorItemHref(item)) return false
    if(isTerminalCoordinatorStatus(item.status)) return false
    if(record && !isTransientProfileNukeStatus(record.status)) return false

    const itemStatus = `${item.status || ''}`.trim()
    if(!isActiveCoordinatorStatus(itemStatus)) return false

    const activeStartedAt = Number.isFinite(item?.activeAt) ? item.activeAt : 0
    const activeAgeExpired = activeStartedAt > 0 && now - activeStartedAt >= COORDINATOR_ACTIVE_JOB_MAX_MS
    const staleAnchor = getPersistedActiveCoordinatorStaleAnchor(item, record)
    if(!activeAgeExpired && (!staleAnchor || now - staleAnchor < STALE_BACKGROUND_OPENING_QUEUED_TAB_MS)) return false

    const tabId = getPersistedQueuedTabId(item, record)
    if(!tabId) return true
    if(hasOwnedQueuedTabState(tabId)) return false

    try {
        await browser.tabs.get(tabId)
        return false
    }
    catch {
        return true
    }
}

function makeMissingActiveCoordinatorProgressRecord(href = '', record = null, now = Date.now(), item = null) {
    const normalizedHref = normalizeQuoraProfileUrl(href || record?.profileHref || '')
    if(!normalizedHref) return null

    return normalizeProgressPatch(normalizedHref, {
        actionKind: record?.actionKind || item?.actionKind || 'mute-block',
        attemptId: getAttemptIdFromValue(record) || getAttemptIdFromValue(item),
        attemptNumber: getAttemptNumberFromValue(record) || getAttemptNumberFromValue(item),
        runId: record?.runId || item?.runId || '',
        tabId: getPersistedQueuedTabId(item, record) || null,
        status: 'interrupted',
        finalError: 'Queued tab timed out after disappearing before completion',
        tabClosedAt: now,
        slotReleasedAt: now,
        closedByExtension: true,
        closeReason: 'stale-active-tab',
        event: 'Reconciled stale active queued tab after timeout'
    }, record)
}

function getQueuedTabRetryAttempt(metadata = null, record = null) {
    const metadataAttempt = Number.parseInt(metadata?.retryAttempt, 10)
    const recordAttempt = Number.parseInt(record?.retryAttempt, 10)
    return Math.max(
        Number.isFinite(metadataAttempt) && metadataAttempt > 0 ? metadataAttempt : 0,
        Number.isFinite(recordAttempt) && recordAttempt > 0 ? recordAttempt : 0
    )
}

function getQueuedTabMaxRetries(metadata = null, record = null) {
    const metadataMax = Number.parseInt(metadata?.maxRetries, 10)
    const recordMax = Number.parseInt(record?.maxRetries, 10)
    const fallback = STALE_QUEUED_TAB_MAX_RETRIES
    const maxRetries = Number.isFinite(metadataMax) && metadataMax >= 0
        ? metadataMax
        : Number.isFinite(recordMax) && recordMax >= 0
            ? recordMax
            : fallback

    return Math.max(0, maxRetries)
}

function isQueuedTabLoadPressure(liveTab = null, record = null, metadata = null) {
    if(hasActiveQueuedTabActionPhaseProgress(record, metadata)) return false
    if(`${liveTab?.status || ''}`.trim() === 'loading') return true
    if(Number.isFinite(metadata?.contentScriptEnsureFailedAt) && metadata.contentScriptEnsureFailedAt > 0) return true
    if(Number.isFinite(metadata?.lastNudgeFailedAt) && metadata.lastNudgeFailedAt > 0) return true
    return false
}

function buildRetryQueuedTabAction(metadata = null, record = null) {
    const url = normalizeTabTargetUrl(metadata?.profileHref || metadata?.requestedUrl || '')
    if(!url) return null
    if(metadata?.ownerTabId && pausedQueuedOwners.has(metadata.ownerTabId)) return null

    const retryAttempt = getQueuedTabRetryAttempt(metadata, record)
    const maxRetries = getQueuedTabMaxRetries(metadata, record)
    const loadPressureRequeue = metadata?.loadPressureRequeue === true
    if(!loadPressureRequeue && retryAttempt >= maxRetries) return null
    const sourceAttemptId = getAttemptIdFromValue(metadata) || getAttemptIdFromValue(record)
    const sourceAttemptNumber = getAttemptNumberFromValue(metadata) || getAttemptNumberFromValue(record)
    const attemptId = makeAttemptId()
    const attemptNumber = getNextAttemptNumberFromValue(metadata)

    return {
        url,
        profileHref: normalizeQuoraProfileUrl(metadata?.profileHref || '') || '',
        coordinatorKey: metadata?.coordinatorKey || '',
        requestedUrl: metadata?.requestedUrl || '',
        resolutionMode: metadata?.resolutionMode || '',
        resolveProfileFromPage: metadata?.resolveProfileFromPage === true,
        resolutionReason: metadata?.resolutionReason || '',
        candidateConfidence: metadata?.candidateConfidence || '',
        candidateCollector: metadata?.candidateCollector || '',
        tabAction: metadata?.tabAction || 'nuke',
        actionKind: metadata?.actionKind || '',
        runId: metadata?.runId || '',
        ownerTabId: metadata?.ownerTabId || null,
        ownerWindowId: metadata?.ownerWindowId || null,
        noForegroundFallback: !!metadata?.noForegroundFallback,
        retryAttempt: loadPressureRequeue ? retryAttempt : retryAttempt + 1,
        sourceAttemptId,
        sourceAttemptNumber,
        attemptId,
        attemptNumber,
        maxRetries,
        loadPressureRequeue
    }
}

async function advanceCoordinatorQueueForStaleRetryAction(action = null, at = Date.now()) {
    const href = normalizeQuoraProfileUrl(action?.profileHref || action?.url || '')
    const coordinatorKey = action?.coordinatorKey || (href ? href : makeProfileResolutionQueueKey(action?.requestedUrl || action?.url || ''))
    if(!action || (!href && !coordinatorKey)) return false

    return enqueueSpaceFeedStorageUpdate(() => {
        return mutateCoordinatorProjection({
            kind: 'advanceStaleRetryQueuedTab',
            reason: 'ordinaryMutation',
            action,
            at,
            href,
            coordinatorKey
        })
    })
}

function cleanupQueuedTabMetadataOnly(tabId) {
    if(!tabId) return
    unregisterOwnedTab(tabId)
    clearQueuedTabMetadata(tabId)
}

function detachQueuedTabRuntimeState(tabId, reason = 'queued-tab-detached') {
    if(!tabId) {
        return {
            metadata: null,
            wasActive: false,
            wasOwnerTab: false,
            wasOwnedChild: false,
            foregroundLeaseReleased: false
        }
    }

    const metadata = getQueuedTabMetadata(tabId)
    const wasActive = activeQueuedTabs.delete(tabId)
    const wasOwnerTab = ownedTabIdsByParent.has(tabId)
    const wasOwnedChild = owningParentByChild.has(tabId)
    pendingTabActions.delete(tabId)
    const foregroundLeaseReleased = wasActive
        ? releaseQueuedForegroundLease(tabId, reason)
        : false
    if(wasActive || wasOwnedChild) {
        pushQueueWakeupJournalEntry({
            kind: 'state-change',
            name: 'detachQueuedTabRuntimeState',
            reason,
            result: 'state-changed',
            details: {
                tabId,
                wasActive,
                wasOwnedChild,
                profileHref: metadata?.profileHref || ''
            }
        })
    }
    cleanupQueuedTabMetadataOnly(tabId)

    return {
        metadata,
        wasActive,
        wasOwnerTab,
        wasOwnedChild,
        foregroundLeaseReleased
    }
}

async function pruneMissingQueuedTabRuntimeState(reason = 'missing-queued-tab-prune') {
    const tabIds = new Set([
        ...Array.from(activeQueuedTabs),
        ...Array.from(queuedTabMetadata.keys())
    ])
    let pruned = 0

    for(const tabId of tabIds) {
        if(!tabId) continue
        try {
            await browser.tabs.get(tabId)
        }
        catch {
            detachQueuedTabRuntimeState(tabId, reason)
            pruned += 1
        }
    }

    if(pruned) {
        scheduleStoredWorkRepair(1000, {reason: 'reconcile-runtime-pruned'})
    }

    return pruned
}

async function releaseQueuedTabAndCleanup(tabId, options = {}) {
    if(!tabId) return null

    try {
        return await releaseQueuedTab(tabId, options)
    }
    finally {
        cleanupQueuedTabMetadataOnly(tabId)
    }
}

function scheduleQueuedTabReleaseReconcile(reason = 'queued-tab-slot-release', options = {}) {
    const delayMs = options.awaitFill === true ? 100 : 500
    const resumeScheduled = scheduleCoordinatorQueueResume(delayMs, reason)
    scheduleStoredWorkRepair(1000, {reason})
    return Promise.resolve({
        recovered: false,
        scheduledOnly: true,
        resumeScheduled,
        reason: `${reason || 'queued-tab-slot-release'}-scheduled`
    })
}

async function pruneQueuedTabActions(ownerTabId = null) {
    await ensureProfileNukeProgressReady()

    const seenQueuedKeys = new Set()
    let coordinatorQueue = null

    async function getCoordinatorQueue() {
        if(coordinatorQueue) return coordinatorQueue

        try {
            const currentAuthorityState = await loadCoordinatorQueueProjection({
                metricPath: 'queuedTabActions.prune.load'
            })
            coordinatorQueue = currentAuthorityState.queue
        }
        catch {
            coordinatorQueue = {}
        }

        return coordinatorQueue
    }

    for(const tabId of Array.from(activeQueuedTabs)) {
        const metadata = getQueuedTabMetadata(tabId)
        const normalizedHref = normalizeQuoraProfileUrl(metadata?.profileHref || '')
        const subjectKey = normalizedHref || metadata?.coordinatorKey || ''
        const ownerId = metadata?.ownerTabId || owningParentByChild.get(tabId) || null
        if(!subjectKey || !ownerId) continue
        if(ownerTabId && ownerId !== ownerTabId) continue
        seenQueuedKeys.add(getQueuedTabActionKey(ownerId, subjectKey, metadata?.tabAction || ''))
    }

    for(let index = queuedTabActions.length - 1; index >= 0; index -= 1) {
        const action = queuedTabActions[index]
        const actionOwnerTabId = action?.ownerTabId || null
        if(ownerTabId && actionOwnerTabId !== ownerTabId) continue

        const normalizedHref = normalizeQuoraProfileUrl(action?.profileHref || action?.url || '')
        const subjectKey = normalizedHref || action?.coordinatorKey || ''
        const actionKey = getQueuedTabActionKey(actionOwnerTabId, subjectKey, action?.tabAction || '')
        const record = normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
        const terminalProgressDropsAction = record &&
            isTerminalProfileNukeRecord(record) &&
            !isRetryableTerminalProfileNukeRecord(record)
            ? shouldDropQueuedActionForTerminalProgress(action, record, await getCoordinatorQueue())
            : false
        const dropAction = terminalProgressDropsAction || seenQueuedKeys.has(actionKey)

        if(!dropAction) {
            seenQueuedKeys.add(actionKey)
            continue
        }

        if(actionOwnerTabId && action?.url) {
            rememberCanceledOwnerUrls(actionOwnerTabId, [action.url])
        }
        if(terminalProgressDropsAction && normalizedHref && isSuccessfulProfileNukeRecord(record)) {
            await syncSuccessfulCoordinatorProgress(normalizedHref, record)
        }
        queuedTabActions.splice(index, 1)
    }
}

function getQueuedTabActionKey(ownerTabId, href, tabAction = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    const subjectKey = normalizedHref || `${href || ''}`.trim()
    if(!ownerTabId || !subjectKey) return ''
    return `${ownerTabId}|${subjectKey}|${tabAction || ''}`
}

function getQueuedTabActionKind(action = null) {
    return getCoordinatorActionKindForRequestedAction(action?.actionKind || action?.tabAction || '')
}

function hasQueuedUnblockUnmuteWork() {
    if(queuedTabActions.some(action => getQueuedTabActionKind(action) === UNBLOCK_UNMUTE_ACTION_KIND)) return true

    for(const tabId of activeQueuedTabs) {
        const metadata = getQueuedTabMetadata(tabId)
        if(getQueuedTabActionKind(metadata) === UNBLOCK_UNMUTE_ACTION_KIND) return true
    }

    return false
}

function getEffectiveQueuedTabConcurrency() {
    if(getQueueLoadThrottle().active) return 1
    return hasQueuedUnblockUnmuteWork()
        ? 1
        : queuedTabConcurrency
}

function shouldDropQueuedActionForTerminalProgress(action = null, record = null, queue = {}) {
    if(!action || !record) return false
    if(!isTerminalProfileNukeRecord(record) || isRetryableTerminalProfileNukeRecord(record)) return false

    const normalizedHref = normalizeQuoraProfileUrl(action.url || '')
    if(!normalizedHref) return false

    const actionKind = getQueuedTabActionKind(action)
    const recordActionKind = getCoordinatorActionKindForProgress(record)
    if(actionKind !== recordActionKind) return false

    const actionAttemptId = getAttemptIdFromValue(action)
    const recordAttemptId = getAttemptIdFromValue(record)
    if(actionAttemptId && recordAttemptId && actionAttemptId !== recordAttemptId) return false

    const queueEntry = findCoordinatorQueueEntryForHref(queue, normalizedHref)
    const item = queueEntry?.item || null
    if(!item) return !actionAttemptId || (!!recordAttemptId && actionAttemptId === recordAttemptId)
    if(getCoordinatorActionKindForItem(item) !== recordActionKind) return false
    if(hasMismatchedCoordinatorAttempt(item, record)) return false

    const itemAttemptId = getAttemptIdFromValue(item)
    if(itemAttemptId && recordAttemptId !== itemAttemptId) return false

    return true
}

function queuedTabActionMatchesProfile(action = null, href = '', actionKind = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    if(!action || !normalizedHref) return false
    if(normalizeQuoraProfileUrl(action.url || '') !== normalizedHref) return false
    if(!actionKind) return true

    const candidateActionKind = getCoordinatorActionKindForRequestedAction(action.actionKind || action.tabAction || '')
    return candidateActionKind === actionKind
}

function queuedTabMetadataMatchesProfile(metadata = null, href = '', actionKind = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    if(!metadata || !normalizedHref) return false
    if(normalizeQuoraProfileUrl(metadata.profileHref || '') !== normalizedHref) return false
    if(!actionKind) return true

    const candidateActionKind = getCoordinatorActionKindForRequestedAction(metadata.actionKind || metadata.tabAction || '')
    return candidateActionKind === actionKind
}

async function cancelCoordinatorExecutorsForReset(href = '', existing = null, record = null, actionKind = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    if(!normalizedHref) return {queued: 0, active: 0}

    await ownedTabIdsReady

    let queued = 0
    for(let index = queuedTabActions.length - 1; index >= 0; index -= 1) {
        if(!queuedTabActionMatchesProfile(queuedTabActions[index], normalizedHref, actionKind)) continue
        queuedTabActions.splice(index, 1)
        queued += 1
    }

    const tabIds = new Set()
    const persistedTabId = getPersistedQueuedTabId(existing, record)
    if(persistedTabId) tabIds.add(persistedTabId)

    for(const [tabId, metadata] of queuedTabMetadata.entries()) {
        if(queuedTabMetadataMatchesProfile(metadata, normalizedHref, actionKind)) {
            tabIds.add(normalizeTabId(tabId))
        }
    }

    let active = 0
    for(const tabId of tabIds) {
        if(!tabId) continue
        await releaseQueuedTabAndCleanup(tabId, {awaitFill: true})
        try {
            await browser.tabs.remove(tabId)
            active += 1
        }
        catch {}
    }

    return {queued, active}
}

function collectQueuedTabActionKeys(ownerTabId = null) {
    const keys = new Set()

    for(const tabId of Array.from(activeQueuedTabs)) {
        const metadata = getQueuedTabMetadata(tabId)
        const ownerId = metadata?.ownerTabId || owningParentByChild.get(tabId) || null
        if(ownerTabId && ownerId !== ownerTabId) continue
        const key = getQueuedTabActionKey(ownerId, metadata?.profileHref || metadata?.coordinatorKey || '', metadata?.tabAction || '')
        if(key) keys.add(key)
    }

    for(const action of queuedTabActions) {
        const ownerId = action?.ownerTabId || null
        if(ownerTabId && ownerId !== ownerTabId) continue
        const key = getQueuedTabActionKey(ownerId, action?.profileHref || action?.coordinatorKey || action?.url || '', action?.tabAction || '')
        if(key) keys.add(key)
    }

    return keys
}

async function sweepStaleQueuedTabs(parentTabId = null) {
    await pruneQueuedTabActions(parentTabId)
    const now = Date.now()
    const activeTabIds = Array.from(activeQueuedTabs)

    for(const tabId of activeTabIds) {
        const metadata = getQueuedTabMetadata(tabId)
        let liveTab = null

        try {
            liveTab = await browser.tabs.get(tabId)
        }
        catch {
            const detached = detachQueuedTabRuntimeState(tabId, 'missing-queued-tab-sweep')
            await releaseQueuedTab(tabId, {
                awaitFill: true,
                runtimeDetached: true,
                metadata: detached.metadata,
                wasActive: detached.wasActive,
                foregroundLeaseReleased: detached.foregroundLeaseReleased
            })
            continue
        }

        const progressRecord = metadata?.profileHref
            ? profileNukeProgress?.[normalizeQuoraProfileUrl(metadata.profileHref)] || null
            : null
        const metadataUpdatedAt = Number.isFinite(metadata?.updatedAt)
            ? metadata.updatedAt
            : Number.isFinite(metadata?.openedAt)
                ? metadata.openedAt
                : 0
        const lastUpdatedAt = Math.max(metadataUpdatedAt, getProgressHeartbeatAt(progressRecord))
        const loadPressureCandidate = isQueuedTabLoadPressure(liveTab, progressRecord, metadata)
        const staleTimeoutMs = loadPressureCandidate
            ? Math.min(getActiveQueuedTabStaleTimeoutMs(progressRecord, metadata), STALE_BACKGROUND_OPENING_QUEUED_TAB_MS)
            : getActiveQueuedTabStaleTimeoutMs(progressRecord, metadata)
        const activeStartedAt = getActiveQueuedTabAgeAnchor(metadata, progressRecord)
        const activeJobMaxMs = hasActiveQueuedTabActionPhaseProgress(progressRecord, metadata)
            ? COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS
            : COORDINATOR_ACTIVE_JOB_MAX_MS
        const activeAgeExpired = activeStartedAt > 0 && now - activeStartedAt >= activeJobMaxMs

        if(progressRecord && isTerminalProfileNukeRecord(progressRecord) && !metadata?.closeRequestedAt) {
            markQueuedTabClosing(tabId, 'terminal-progress-record')
            await releaseQueuedTabAndCleanup(tabId, {awaitFill: true})
            try {
                await browser.tabs.remove(tabId)
            }
            catch {}
            continue
        }

        const closeRequestedAt = Number.isFinite(metadata?.closeRequestedAt) ? metadata.closeRequestedAt : 0
        if(closeRequestedAt && now - closeRequestedAt >= STALE_CLOSE_REQUESTED_QUEUED_TAB_MS) {
            await releaseQueuedTabAndCleanup(tabId, {awaitFill: true})
            try {
                await browser.tabs.remove(tabId)
            }
            catch {}
            continue
        }

        if(metadata?.closeRequestedAt || !lastUpdatedAt || (!activeAgeExpired && now - lastUpdatedAt < staleTimeoutMs)) {
            continue
        }

        const loadPressureRequeue = loadPressureCandidate
        if(loadPressureRequeue) {
            rememberQueueLoadPressure('loading-or-unscriptable-tab', {
                tabId,
                profileHref: metadata?.profileHref || '',
                tabStatus: liveTab?.status || '',
                contentScriptEnsureFailedAt: metadata?.contentScriptEnsureFailedAt || 0,
                lastNudgeFailedAt: metadata?.lastNudgeFailedAt || 0
            })
        }
        let retryAction = buildRetryQueuedTabAction({
            ...metadata,
            loadPressureRequeue
        }, progressRecord)
        const closedAt = Date.now()
        const closeRequestedAtForStale = markQueuedTabClosing(tabId, 'stale-active-tab')
        if(retryAction) {
            const retryAdvanced = await advanceCoordinatorQueueForStaleRetryAction(retryAction, closedAt)
            if(retryAdvanced) {
                setQueuedTabMetadata(tabId, {
                    retryRequestedAt: closedAt,
                    retryAttempt: retryAction.retryAttempt,
                    maxRetries: retryAction.maxRetries,
                    attemptId: retryAction.attemptId,
                    attemptNumber: retryAction.attemptNumber
                })
                queuedTabActions.unshift(markQueuedTabExecutorActionPlanned(
                    retryAction,
                    {open: true, reason: 'stale-active-retry-advanced'},
                    'stale-active-retry'
                ))
            }
            else {
                retryAction = null
            }
        }
        if(metadata?.profileHref) {
            await recordProfileNukeProgress(metadata.profileHref, {
                status: retryAction ? 'queued' : 'interrupted',
                retryAttempt: retryAction ? retryAction.retryAttempt : getQueuedTabRetryAttempt(metadata, progressRecord),
                maxRetries: retryAction ? retryAction.maxRetries : getQueuedTabMaxRetries(metadata, progressRecord),
                attemptId: retryAction ? retryAction.attemptId : getAttemptIdFromValue(metadata) || getAttemptIdFromValue(progressRecord),
                attemptNumber: retryAction ? retryAction.attemptNumber : getAttemptNumberFromValue(metadata) || getAttemptNumberFromValue(progressRecord),
                finalError: retryAction
                    ? ''
                    : activeAgeExpired
                        ? 'Queued tab exceeded the active job time limit'
                        : 'Queued tab timed out waiting for completion',
                errorPageUrl: metadata.lastUrl || '',
                closeRequestedAt: closeRequestedAtForStale || closedAt,
                closedByExtension: true,
                closeReason: 'stale-active-tab',
                event: retryAction
                    ? retryAction.loadPressureRequeue
                        ? 'Queued tab stayed loading or unscriptable; throttling queue before retrying'
                        : `Queued tab timed out; retrying attempt ${retryAction.retryAttempt + 1} of ${retryAction.maxRetries + 1}`
                    : 'Queued tab closed after timing out waiting for completion'
            })
        }
        try {
            await releaseQueuedTabAndCleanup(tabId, {awaitFill: false})
            void browser.tabs.remove(tabId).catch(() => {})
        }
        catch {}
    }

    if(parentTabId) {
        await getLiveOwnedTabIds(parentTabId)
    }
}

async function getOwnedNukeStatus(parentTabId, options = {}) {
    const runId = `${options?.runId || ''}`.trim()
    if(options?.cleanup === true) {
        await sweepStaleQueuedTabs(parentTabId)
        await closeTerminalOwnedProfileTabs()
    }
    const ownerIds = new Set([parentTabId].filter(Boolean))
    if(runId) ownerIds.add(SERVICE_WORKER_QUEUE_OWNER_ID)
    const ownedTabSet = new Set()
    for(const ownerId of ownerIds) {
        const ownedTabIds = options?.cleanup === true
            ? Array.from(ownedTabIdsByParent.get(ownerId) || [])
            : await getKnownLiveOwnedTabIdsReadOnly(ownerId)
        for(const tabId of ownedTabIds) {
            ownedTabSet.add(tabId)
        }
    }

    const activeKeys = new Set()
    const queuedKeys = new Set()
    for(const tabId of activeQueuedTabs) {
        const metadata = getQueuedTabMetadata(tabId) || {}
        const ownerMatches = ownerIds.has(owningParentByChild.get(tabId))
        const runMatches = runId && metadata.runId === runId
        if(ownerMatches || runMatches) activeKeys.add(`tab:${tabId}`)
    }
    for(const action of queuedTabActions) {
        const ownerMatches = ownerIds.has(action.ownerTabId)
        const runMatches = runId && action.runId === runId
        if((ownerMatches || runMatches) && action.tabAction === 'nuke') {
            queuedKeys.add(action.coordinatorKey || action.profileHref || action.url || `${queuedKeys.size}`)
        }
    }

    if(runId) {
        const currentAuthorityState = await loadCoordinatorQueueProjection({
            metricPath: 'ownedNukeStatus.queue.load'
        }).catch(() => null)
        const queue = currentAuthorityState?.queue || {}
        for(const [itemKey, item] of Object.entries(queue)) {
            if(item?.runId !== runId) continue
            if(getCoordinatorItemExecutorTabAction(item) !== 'nuke') continue
            if(isTerminalCoordinatorStatus(item?.status)) continue

            const key = itemKey || getCoordinatorItemQueueKey(item) || getCoordinatorItemHref(item)
            if(isActiveCoordinatorStatus(item?.status)) activeKeys.add(`queue:${key}`)
            else queuedKeys.add(`queue:${key}`)
        }
    }

    const owned = ownedTabSet.size
    const active = activeKeys.size
    const queued = queuedKeys.size
    const hasWork = active > 0 || owned > 0 || queued > 0
    const paused = hasWork && (pausedQueuedOwners.has(parentTabId) || (runId && pausedQueuedOwners.has(SERVICE_WORKER_QUEUE_OWNER_ID)))
    if(!hasWork) {
        pausedQueuedOwners.delete(parentTabId)
    }
    return {active, owned, queued, paused}
}

function rememberCanceledOwnerUrls(ownerTabId, urls) {
    if(!ownerTabId || !Array.isArray(urls) || !urls.length) return

    const existing = canceledQueuedUrlsByOwner.get(ownerTabId) || []
    canceledQueuedUrlsByOwner.set(ownerTabId, existing.concat(urls.filter(Boolean)))
}

function cancelQueuedOwnerActions(ownerTabId, tabAction = null) {
    if(!ownerTabId) return []

    const canceledUrls = []

    for(let index = queuedTabActions.length - 1; index >= 0; index -= 1) {
        const action = queuedTabActions[index]
        if(action.ownerTabId !== ownerTabId) continue
        if(tabAction && action.tabAction !== tabAction) continue

        if(action.url) {
            canceledUrls.push(action.url)
        }
        queuedTabActions.splice(index, 1)
    }

    return canceledUrls
}

function consumeCanceledOwnerUrls(ownerTabId) {
    if(!ownerTabId) return []

    const urls = canceledQueuedUrlsByOwner.get(ownerTabId) || []
    canceledQueuedUrlsByOwner.delete(ownerTabId)
    return urls
}

async function stopOwnerNukes(ownerTabId, options = {}) {
    if(!ownerTabId) return {canceledUrls: [], ownedTabIds: []}

    const {
        closeOwnedTabs = true,
        keepTabId = null,
        reason = 'owner-stop-request',
        shouldContinue = null,
        shouldContinueSync = null,
        tabAction = null
    } = options

    async function canContinueStop() {
        if(typeof shouldContinue === 'function' && !await shouldContinue()) return false
        if(typeof shouldContinueSync === 'function' && !shouldContinueSync()) return false
        return true
    }

    if(!await canContinueStop()) {
        return {canceledUrls: [], ownedTabIds: [], staleStop: true}
    }
    pausedQueuedOwners.add(ownerTabId)
    const canceledUrls = cancelQueuedOwnerActions(ownerTabId, tabAction)
    rememberCanceledOwnerUrls(ownerTabId, canceledUrls)

    if(!await canContinueStop()) {
        return {canceledUrls: [], ownedTabIds: [], staleStop: true}
    }
    const ownedTabIds = closeOwnedTabs
        ? (await getLiveOwnedTabIds(ownerTabId)).filter(tabId => tabId && tabId !== keepTabId)
        : []

    if(!await canContinueStop()) {
        return {canceledUrls, ownedTabIds: [], staleStop: true}
    }
    for(const tabId of ownedTabIds) {
        markQueuedTabClosing(tabId, reason)
    }

    if(ownedTabIds.length) {
        if(!await canContinueStop()) {
            return {canceledUrls, ownedTabIds: [], staleStop: true}
        }
        for(const tabId of ownedTabIds) {
            try {
                await browser.tabs.remove(tabId)
            }
            catch {}
        }
    }

    return {canceledUrls, ownedTabIds}
}

async function releaseQueuedTab(tabId, options = {}) {
    const runtimeDetached = options.runtimeDetached === true
    const metadata = options.metadata || getQueuedTabMetadata(tabId)
    const hadPendingAction = pendingTabActions.has(tabId)
    pendingTabActions.delete(tabId)
    let followUpPromise = null
    const durableWrites = []

    const wasActive = options.wasActive === true ||
        (!runtimeDetached && activeQueuedTabs.delete(tabId))
    const hadQueuedRuntimeState = wasActive || hadPendingAction || !!metadata

    if(wasActive) {
        incrementQueueWakeupMetric('job.slotReleased')
        incrementQueueWakeupMetric('pump.changed.releasedSlot')
        if(options.foregroundLeaseReleased !== true) {
            releaseQueuedForegroundLease(tabId, 'queued-tab-slot-release')
        }
        durableWrites.push(releaseCoordinatorActionLeaseForTab(tabId, 'queued-tab-slot-release'))
        if(metadata?.profileHref) {
            const normalizedHref = normalizeQuoraProfileUrl(metadata.profileHref)
            const progressRecord = normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
            const hasSlotReleasedAt = Number.isFinite(progressRecord?.slotReleasedAt) && progressRecord.slotReleasedAt > 0

            if(!hasSlotReleasedAt) {
                durableWrites.push(recordProfileNukeProgress(metadata.profileHref, {
                    slotReleasedAt: Date.now(),
                    event: 'Queued tab slot released'
                }))
            }
            if(progressRecord && isTerminalProfileNukeRecord(progressRecord) && !metadata?.closeRequestedAt) {
                durableWrites.push(syncCoordinatorProgressRecords({[normalizedHref]: progressRecord}))
                markQueuedTabClosing(tabId, 'terminal-slot-release')
                void browser.tabs.remove(tabId).catch(() => {})
            }
            else if(!metadata?.retryRequestedAt && !/stale-active-tab/.test(`${metadata?.closeReason || ''}`) && !hasActiveQueuedTabActionPhaseProgress(progressRecord, metadata)) {
                durableWrites.push(rollbackFailedQueuedTabOpen({
                    ...metadata,
                    url: metadata.profileHref,
                    profileHref: metadata.profileHref
                }, {
                    id: tabId
                }, {
                    attemptId: metadata?.attemptId || '',
                    attemptNumber: metadata?.attemptNumber || 0,
                    retryAttempt: metadata?.retryAttempt || 0,
                    maxRetries: metadata?.maxRetries || 0
                }).catch(() => {
                    scheduleStoredWorkRepair(1000, {
                        reason: 'release-queued-tab-durable-write-failed',
                        edgeTriggered: true
                    })
                }))
            }
        }
        if(durableWrites.length) {
            await Promise.all(durableWrites.map(promise => Promise.resolve(promise).catch(() => null)))
        }
        followUpPromise = scheduleQueuedTabReleaseReconcile('queued-tab-slot-release', {
            awaitFill: options.awaitFill === true
        })
        if(options.awaitFill !== true) {
            void followUpPromise
        }
        if(!queuedTabActions.length) {
            scheduleQueuedWorkContinuation('queued-tab-slot-release')
        }
        if(metadata?.actionSurfaceMode === 'worker-window' || metadata?.actionSurfaceWindowId) {
            scheduleQueuedWorkerActionSurfaceCleanup('idle-after-release')
        }
    }
    else if(hadQueuedRuntimeState) {
        scheduleQueuedTabReleaseFollowUp()
        scheduleStoredWorkRepair(1000, {reason: 'queued-tab-release-no-durable-progress'})
        if(metadata?.actionSurfaceMode === 'worker-window' || metadata?.actionSurfaceWindowId) {
            scheduleQueuedWorkerActionSurfaceCleanup('idle-after-release')
        }
    }
    else {
        incrementQueueWakeupMetric('job.releaseIgnored.noRuntimeState')
    }

    if(options.awaitFill === true) {
        return followUpPromise || Promise.resolve(null)
    }

    return followUpPromise || Promise.resolve(null)
}

function scheduleQueuedTabReleaseFollowUp(delayMs = 500) {
    scheduleQueuedWorkContinuation('queued-tab-release')

    if(queuedTabReleaseFollowUpTimeout) return

    queuedTabReleaseFollowUpTimeout = setTimeout(() => {
        queuedTabReleaseFollowUpTimeout = null
        scheduleStoredWorkRepair(1000, {reason: 'queued-tab-release-follow-up'})
    }, Math.max(100, Number.parseInt(delayMs, 10) || 500))
}

function scheduleQueuedWorkContinuation(reason = 'queued-work-continuation') {
    void kickCoordinatorQueueResume(reason, {direct: true}).catch(() => null)
    void closeTerminalOwnedProfileTabs().catch(() => {
        scheduleStoredWorkRepair(1000, {
            reason: `${reason || 'queued-work-continuation'}-close-terminal-failed`,
            edgeTriggered: true
        })
    })
}

function getQueuedTabExpectedAttemptId(tabId = null) {
    if(!tabId) return ''
    const metadata = getQueuedTabMetadata(tabId)
    const action = pendingTabActions.get(tabId)
    return normalizeAttemptId(metadata?.attemptId || action?.attemptId || '')
}

function makeClaimableQueuedTabAction(action = null, metadata = null) {
    if(!action) return null

    const tabAction = action.action || metadata?.tabAction || null
    const actionKind = action.actionKind || metadata?.actionKind || (
        tabAction === 'nuke' ? 'mute-block' : tabAction || null
    )

    return {
        ...action,
        action: tabAction,
        targetUrl: action.targetUrl || metadata?.profileHref || '',
        coordinatorKey: action.coordinatorKey || metadata?.coordinatorKey || '',
        requestedUrl: action.requestedUrl || metadata?.requestedUrl || '',
        resolutionMode: action.resolutionMode || metadata?.resolutionMode || '',
        resolveProfileFromPage: action.resolveProfileFromPage === true || metadata?.resolveProfileFromPage === true,
        resolutionReason: action.resolutionReason || metadata?.resolutionReason || '',
        candidateConfidence: action.candidateConfidence || metadata?.candidateConfidence || '',
        candidateCollector: action.candidateCollector || metadata?.candidateCollector || '',
        actionKind,
        jobKey: action.jobKey || metadata?.jobKey || '',
        scope: action.scope || metadata?.scope || null,
        canonicalSubject: action.canonicalSubject || metadata?.canonicalSubject || null,
        attempt: action.attempt || metadata?.attempt || null,
        runId: action.runId || metadata?.runId || '',
        noForegroundFallback: !!(action.noForegroundFallback || metadata?.noForegroundFallback),
        actionSurfaceMode: action.actionSurfaceMode || metadata?.actionSurfaceMode || '',
        actionSurfaceWindowId: action.actionSurfaceWindowId || metadata?.actionSurfaceWindowId || null,
        actionSurfaceAnchorTabId: action.actionSurfaceAnchorTabId || metadata?.actionSurfaceAnchorTabId || null,
        actionSurfaceActivatedAt: action.actionSurfaceActivatedAt || metadata?.actionSurfaceActivatedAt || 0,
        attemptId: getAttemptIdFromValue(action) || getAttemptIdFromValue(metadata) || '',
        attemptNumber: getAttemptNumberFromValue(action) || getAttemptNumberFromValue(metadata) || 0
    }
}

function coordinatorItemMatchesTab(item = null, itemKey = '', tab = {}) {
    if(!item || typeof item !== 'object' || isTerminalCoordinatorStatus(item.status)) return false

    const status = `${item.status || ''}`.trim()
    if(!isActiveCoordinatorStatus(status)) return false
    if(!isCoordinatorQueueAuthoritativeItem(item)) return false

    const tabId = normalizeTabId(tab?.id)
    const itemTabId = normalizeTabId(item?.tabId || item?.activeTabId || null)
    if(!tabId || !itemTabId || tabId !== itemTabId) return false
    if(!getAttemptIdFromValue(item) || !getAttemptNumberFromValue(item)) return false

    const tabHref = normalizeQuoraProfileUrl(tab?.url || '')
    const itemHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
    if(tabHref && itemHref && tabHref === itemHref) return true

    if(isProfileResolutionItem(item)) {
        const tabUrl = normalizeCoordinatorRequestedUrl(tab?.url || '')
        const requestedUrl = getProfileResolutionRequestedUrl(item, itemKey)
        if(tabUrl && requestedUrl && tabUrl === requestedUrl) return true
    }

    return false
}

async function recoverPendingTabActionFromCoordinatorQueue(sender = {}) {
    const tab = sender.tab || {}
    const tabId = normalizeTabId(tab?.id)
    if(!tabId) return null

    let queue = {}
    try {
        const currentAuthorityState = await loadCoordinatorQueueProjection({
            metricPath: 'pendingTabAction.recover.load'
        })
        queue = currentAuthorityState.queue
    }
    catch {
        return null
    }

    for(const [itemKey, item] of Object.entries(queue)) {
        if(!coordinatorItemMatchesTab(item, itemKey, tab)) continue

        const profileHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        const coordinatorKey = getCoordinatorItemQueueKey(item, itemKey)
        const requestedUrl = normalizeCoordinatorRequestedUrl(item?.requestedUrl || getCoordinatorItemOpenUrl(item) || tab?.url || '')
        const ownerTabId = item?.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID
        const openedAt = Math.max(
            Number.parseInt(item?.tabOpenedAt, 10) || 0,
            Number.parseInt(item?.tabCreatedAt, 10) || 0,
            Number.parseInt(item?.activeAt, 10) || 0,
            Number.parseInt(item?.updatedAt, 10) || 0
        ) || Date.now()
        const tabAction = getCoordinatorItemExecutorTabAction(item, item?.tabAction || 'nuke')
        const actionKind = getCoordinatorActionKindForRequestedAction(item?.actionKind || tabAction)
        const attemptId = getAttemptIdFromValue(item)
        const attemptNumber = getAttemptNumberFromValue(item)
        const retryAttempt = Number.parseInt(item?.retryAttempt, 10) || 0
        const maxRetries = Number.parseInt(item?.maxRetries, 10) || STALE_QUEUED_TAB_MAX_RETRIES
        const noForegroundFallback = getQueuedActionNoForegroundFallback(item)
        const metadata = {
            profileHref,
            coordinatorKey,
            requestedUrl,
            resolutionMode: item?.resolutionMode || '',
            resolveProfileFromPage: item?.resolveProfileFromPage === true,
            resolutionReason: item?.resolutionReason || '',
            candidateConfidence: item?.candidateConfidence || '',
            candidateCollector: item?.candidateCollector || '',
            ownerTabId,
            ownerWindowId: item?.ownerWindowId || null,
            runId: item?.runId || '',
            tabAction,
            actionKind,
            jobKey: item?.jobKey || '',
            scope: item?.scope || null,
            canonicalSubject: item?.canonicalSubject || null,
            attempt: item?.attempt || null,
            noForegroundFallback,
            retryAttempt,
            attemptId,
            attemptNumber,
            maxRetries,
            openedAt,
            lastUrl: tab?.url || requestedUrl
        }
        const action = {
            action: tabAction,
            targetUrl: profileHref || '',
            coordinatorKey,
            requestedUrl,
            resolutionMode: metadata.resolutionMode,
            resolveProfileFromPage: metadata.resolveProfileFromPage,
            resolutionReason: metadata.resolutionReason,
            candidateConfidence: metadata.candidateConfidence,
            candidateCollector: metadata.candidateCollector,
            actionKind,
            jobKey: metadata.jobKey,
            scope: metadata.scope,
            canonicalSubject: metadata.canonicalSubject,
            attempt: metadata.attempt,
            runId: metadata.runId,
            ownerTabId,
            ownerWindowId: metadata.ownerWindowId,
            noForegroundFallback,
            attemptId,
            attemptNumber
        }

        activeQueuedTabs.add(tabId)
        setQueuedTabMetadata(tabId, metadata)
        pendingTabActions.set(tabId, action)
        registerOwnedTab(ownerTabId, tabId)
        scheduleOwnedBlockedProfileSweep(ownerTabId, 4000)

        return {action, metadata}
    }

    return null
}

async function claimPendingTabAction(sender = {}) {
    const tabId = sender.tab?.id
    if(!tabId) return null

    const recovered = pendingTabActions.has(tabId)
        ? null
        : await recoverPendingTabActionFromCoordinatorQueue(sender)
    const action = pendingTabActions.get(tabId) || recovered?.action || null
    if(!action) return null

    const metadata = getQueuedTabMetadata(tabId) || recovered?.metadata || null
    const claimableAction = makeClaimableQueuedTabAction(action, metadata)
    const normalizedHref = normalizeQuoraProfileUrl(metadata?.profileHref || claimableAction?.targetUrl || '')
    const coordinatorKey = metadata?.coordinatorKey || claimableAction?.coordinatorKey || ''
    if(!metadata || (!normalizedHref && !coordinatorKey)) return claimableAction

    const attemptId = getAttemptIdFromValue(metadata) || getAttemptIdFromValue(claimableAction) || ''
    const attemptNumber = getAttemptNumberFromValue(metadata) || getAttemptNumberFromValue(claimableAction) || 0
    const openedAt = Number.parseInt(metadata.openedAt || metadata.tabOpenedAt || metadata.tabCreatedAt, 10) || Date.now()
    const durableClaimAction = {
        ...claimableAction,
        url: normalizedHref || metadata.requestedUrl || claimableAction.requestedUrl || '',
        profileHref: normalizedHref,
        coordinatorKey,
        requestedUrl: metadata.requestedUrl || claimableAction.requestedUrl || '',
        tabAction: metadata.tabAction || claimableAction.action || null,
        actionKind: metadata.actionKind || claimableAction.actionKind || null,
        runId: metadata.runId || claimableAction.runId || '',
        ownerTabId: metadata.ownerTabId || null,
        ownerWindowId: metadata.ownerWindowId || null
    }
    const durableClaimDetails = {
        retryAttempt: Number.parseInt(metadata.retryAttempt, 10) || 0,
        attemptId,
        attemptNumber,
        maxRetries: getQueuedTabMaxRetries(metadata),
        openedAt
    }

    let durableClaimed = false
    try {
        durableClaimed = await promiseWithTimeout(
            transitionCoordinatorItemForQueuedTab(durableClaimAction, sender.tab || {id: tabId}, durableClaimDetails),
            QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,
            'queued tab durable claim'
        )
    }
    catch {
        durableClaimed = false
    }

    if(!durableClaimed) {
        durableClaimed = await promiseWithTimeout(
            confirmQueuedTabDurablyActive(durableClaimAction, sender.tab || {id: tabId}, {
                ...durableClaimDetails,
                profileHref: normalizedHref,
                coordinatorKey,
                actionKind: durableClaimAction.actionKind || durableClaimAction.tabAction || durableClaimAction.action || ''
            }),
            QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,
            'queued tab durable claim confirmation'
        ).catch(() => false)
    }

    if(!durableClaimed) {
        scheduleStoredWorkRepair(1000, {
            reason: 'claim-durable-confirmation-failed',
            edgeTriggered: true
        })
        return null
    }

    markQueuedTabDurablyActive(tabId, 'claim-current-profile-tab-action')
    incrementQueueWakeupMetric('job.claimAccepted')
    if(openedAt) recordQueueWakeupPhase('tabOpenToClaimAccepted', Date.now() - openedAt)

    return claimableAction
}

async function validateQueuedTabAttempt(sender = {}, request = {}, details = {}) {
    const incomingAttemptId = normalizeAttemptId(request.attemptId || request.patch?.attemptId || request.attempt?.id || '')
    if(!incomingAttemptId) return true

    const tabId = sender.tab?.id || null
    const expectedAttemptId = getQueuedTabExpectedAttemptId(tabId)
    if(!expectedAttemptId || expectedAttemptId === incomingAttemptId) return true

    await recordStaleAttemptDiagnostic({
        profileHref: details.profileHref || request.profileHref || request.href || '',
        incomingAttemptId,
        expectedAttemptId,
        senderTabId: tabId,
        message: details.message || 'Ignored stale queued-tab request'
    })
    return false
}

async function validateProgressAttempt(profileHref = '', patch = {}, sender = {}) {
    const incomingAttemptId = getAttemptIdFromValue(patch)
    if(!incomingAttemptId) return true

    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    const tabId = sender.tab?.id || null
    const metadata = tabId ? getQueuedTabMetadata(tabId) : null
    const metadataAttemptId = normalizeAttemptId(metadata?.attemptId || '')

    if(metadataAttemptId && metadataAttemptId !== incomingAttemptId) {
        await recordStaleAttemptDiagnostic({
            profileHref: normalizedHref,
            incomingAttemptId,
            expectedAttemptId: metadataAttemptId,
            senderTabId: tabId,
            message: 'Ignored progress from stale tab attempt'
        })
        return false
    }
    if(metadataAttemptId && metadataAttemptId === incomingAttemptId) return true

    try {
        const currentAuthorityState = await loadCoordinatorQueueProjection({
            metricPath: 'progressAttempt.validate.load'
        })
        const item = currentAuthorityState.queue[normalizedHref] || null
        const itemAttemptId = getAttemptIdFromValue(item)
        if(item && shouldApplyProgressToCoordinatorItem(item, patch)) {
            if(itemAttemptId && itemAttemptId !== incomingAttemptId) {
                await recordStaleAttemptDiagnostic({
                    profileHref: normalizedHref,
                    incomingAttemptId,
                    expectedAttemptId: itemAttemptId,
                    senderTabId: tabId,
                    message: 'Ignored progress from stale coordinator job attempt'
                })
                return false
            }

            return true
        }
    }
    catch {}

    const existingAttemptId = getAttemptIdFromValue(profileNukeProgress?.[normalizedHref])
    if(!metadataAttemptId && existingAttemptId && existingAttemptId !== incomingAttemptId) {
        await recordStaleAttemptDiagnostic({
            profileHref: normalizedHref,
            incomingAttemptId,
            expectedAttemptId: existingAttemptId,
            senderTabId: tabId,
            message: 'Ignored progress from stale profile attempt'
        })
        return false
    }

    return true
}

async function recordProfileNukeProgressFromRequest(request = {}, sender = {}) {
    const tabId = sender.tab?.id || null
    const metadata = tabId ? getQueuedTabMetadata(tabId) : null
    if(metadata?.attemptId || metadata?.profileHref || metadata?.coordinatorKey) {
        const mapped = getCoordinatorStatusFromProgress({
            ...(request.patch || {}),
            actionKind: metadata?.actionKind || request.patch?.actionKind || ''
        })
        return recordJobProgressFromRequest(request, sender, {
            compatibility: false,
            expectTerminal: isTerminalCoordinatorStatus(mapped.status)
        })
    }

    return recordJobProgressFromRequest(request, sender, {
        compatibility: true
    })
}

function addResolvedProfileToPendingSpaceRecords(pendingPosts = {}, item = {}, resolvedHref = '') {
    const href = normalizeQuoraProfileUrl(resolvedHref)
    if(!href) return {pendingPosts, changed: false}

    const nextPending = {
        ...pendingPosts
    }
    let changed = false
    const evidenceList = Array.isArray(item?.evidence) ? item.evidence : []

    for(const evidence of evidenceList) {
        const postKey = evidence?.postKey || ''
        if(!postKey) continue

        const existing = nextPending[postKey] || {}
        const allUrls = getNormalizedProfileHrefList([
            ...getStoredSpaceFeedRecordUrls(existing, 'allUrls'),
            href
        ])
        const remainingUrls = getNormalizedProfileHrefList([
            ...getStoredSpaceFeedRecordUrls(existing, 'remainingUrls'),
            href
        ])

        nextPending[postKey] = {
            ...existing,
            postKey,
            postUrl: evidence.postUrl || existing.postUrl || '',
            spaceKey: item?.source?.spaceKey || existing.spaceKey || '',
            spaceUrl: item?.source?.pageUrl || existing.spaceUrl || '',
            allUrls,
            remainingUrls,
            resolverPending: false,
            resolverUrl: evidence.postUrl || existing.resolverUrl || '',
            ...getPendingSpaceFeedJobKeyPatch(existing, remainingUrls),
            updatedAt: Date.now()
        }
        changed = true
    }

    return {pendingPosts: nextPending, changed}
}

function clearResolverPendingSpaceRecords(pendingPosts = {}, item = {}, options = {}) {
    const nextPending = {
        ...pendingPosts
    }
    const evidenceList = Array.isArray(item?.evidence) ? item.evidence : []
    const requestEvidence = Array.isArray(options.evidence) ? options.evidence : []
    const postKeys = new Set([options.postKey, item?.postKey]
        .concat(evidenceList.map(evidence => evidence?.postKey))
        .concat(requestEvidence.map(evidence => evidence?.postKey))
        .map(value => `${value || ''}`.trim())
        .filter(Boolean))
    const resolverUrls = new Set([
        options.requestedUrl,
        item?.requestedUrl,
        stripProfileResolutionQueueKey(item?.coordinatorKey || item?.dedupeKey || '')
    ]
        .concat(evidenceList.map(evidence => evidence?.postUrl))
        .concat(requestEvidence.map(evidence => evidence?.postUrl))
        .map(value => normalizeCoordinatorRequestedUrl(value || ''))
        .filter(Boolean))
    let changed = false

    for(const [recordKey, record] of Object.entries(pendingPosts || {})) {
        if(record?.resolverPending !== true) continue

        const recordPostKey = `${record?.postKey || recordKey || ''}`.trim()
        const recordUrls = [
            normalizeCoordinatorRequestedUrl(record?.resolverUrl || ''),
            normalizeCoordinatorRequestedUrl(record?.postUrl || '')
        ].filter(Boolean)
        const matches = (recordPostKey && postKeys.has(recordPostKey)) ||
            recordUrls.some(url => resolverUrls.has(url))
        if(!matches) continue

        const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
        const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
        changed = true

        if(!allUrls.length && !remainingUrls.length) {
            delete nextPending[recordKey]
            continue
        }

        nextPending[recordKey] = {
            ...record,
            allUrls,
            remainingUrls,
            resolverPending: false,
            resolverUrl: '',
            ...getPendingSpaceFeedJobKeyPatch(record, remainingUrls),
            updatedAt: Date.now()
        }
    }

    return {pendingPosts: nextPending, changed}
}

async function resolveQueuedProfileTarget(request = {}, sender = {}) {
    const resolvedHref = normalizeQuoraProfileUrl(request.profileHref || request.resolvedProfileHref || '')
    if(!resolvedHref) return {resolved: false, reason: 'invalid-profile'}

    const tabId = sender.tab?.id || null
    const metadata = tabId ? getQueuedTabMetadata(tabId) : null
    const requestedUrl = normalizeCoordinatorRequestedUrl(request.requestedUrl || metadata?.requestedUrl || '')
    const oldKey = metadata?.coordinatorKey ||
        request.coordinatorKey ||
        makeProfileResolutionQueueKey(requestedUrl || '') ||
        normalizeQuoraProfileUrl(request.requestedUrl || '')
    const oldProfileHref = normalizeQuoraProfileUrl(metadata?.profileHref || request.requestedProfileHref || '')

    return enqueueSpaceFeedStorageUpdate(async () => {
        const currentAuthorityState = await loadCoordinatorQueueRunsProjection({
            metricPath: 'resolver.resolve.load'
        })
        const stored = await metricStorageGet({
            [SPACE_PENDING_NUKED_POSTS_KEY]: {}
        }, {
            metricPath: 'resolver.resolve.pending.load'
        })
        const queue = currentAuthorityState.queue
        const runs = currentAuthorityState.runs
        const requestedResolutionKey = makeProfileResolutionQueueKey(requestedUrl || '')
        const matchingResolutionEntry = requestedUrl
            ? Object.entries(queue).find(([key, candidate]) => {
                if(!isProfileResolutionItem(candidate)) return false

                const candidateRequestedUrl = normalizeCoordinatorRequestedUrl(
                    candidate.requestedUrl || stripProfileResolutionQueueKey(key)
                )
                return candidateRequestedUrl === requestedUrl
            })
            : null
        const itemKey = oldKey && queue[oldKey] && isProfileResolutionItem(queue[oldKey])
            ? oldKey
            : requestedResolutionKey && queue[requestedResolutionKey]
                ? requestedResolutionKey
                : matchingResolutionEntry?.[0] || (
                    oldKey && queue[oldKey]
                        ? oldKey
                        : oldProfileHref && queue[oldProfileHref]
                            ? oldProfileHref
                            : resolvedHref && queue[resolvedHref]
                                ? resolvedHref
                                : ''
        )
        const item = itemKey ? queue[itemKey] : null
        if(!item) return {resolved: false, reason: 'missing-coordinator-item'}
        if(isTerminalCoordinatorStatus(item.status)) return {resolved: false, reason: 'terminal-coordinator-item'}

        if(hasMismatchedCoordinatorAttempt(item, request)) {
            await recordStaleAttemptDiagnostic({
                profileHref: resolvedHref,
                incomingAttemptId: getAttemptIdFromValue(request),
                expectedAttemptId: getAttemptIdFromValue(item),
                senderTabId: tabId,
                message: 'Ignored queued target resolution from stale attempt'
            })
            return {resolved: false, reason: 'stale-attempt'}
        }

        const existingResolvedItem = itemKey !== resolvedHref ? queue[resolvedHref] || null : null
        const resolvedDestinationConflict = getResolvedDestinationConflict(existingResolvedItem, item)
        if(resolvedDestinationConflict) {
            return {resolved: false, reason: resolvedDestinationConflict}
        }
        const existingResolvedSucceeded = existingResolvedItem?.status === 'succeeded'
        const now = Date.now()
        const mergeBase = existingResolvedSucceeded
            ? {
                ...item,
                ...existingResolvedItem
            }
            : {
                ...(existingResolvedItem || item),
                ...item
            }
        const nextItem = applyCoordinatorJobEnvelope({
            ...mergeBase,
            targetProfileHref: resolvedHref,
            dedupeKey: resolvedHref,
            coordinatorKey: resolvedHref,
            resolutionMode: '',
            resolveProfileFromPage: false,
            requestedUrl: item.requestedUrl || metadata?.requestedUrl || request.requestedUrl || resolvedHref,
            status: existingResolvedSucceeded
                ? 'succeeded'
                : isTerminalCoordinatorStatus(item.status) ? item.status : 'active',
            outcome: existingResolvedSucceeded ? existingResolvedItem.outcome || 'already-blocked' : item.outcome || '',
            error: existingResolvedSucceeded ? '' : item.error || '',
            tabId: tabId || item.tabId || null,
            activeAt: item.activeAt || now,
            terminalAt: existingResolvedSucceeded ? now : item.terminalAt || 0,
            updatedAt: now,
            evidence: mergeCoordinatorEvidence(existingResolvedItem?.evidence || [], item.evidence || []),
            sources: mergeCoordinatorSources(existingResolvedItem?.sources || [], item.sources || (item.source ? [item.source] : []))
        }, {
            runInput: {id: item.runId || '', sourceType: item.source?.type || ''},
            source: item.source || {},
            runId: item.runId || '',
            targetProfileHref: resolvedHref,
            requestedUrl: item.requestedUrl || metadata?.requestedUrl || request.requestedUrl || resolvedHref,
            coordinatorKey: resolvedHref,
            actionKind: item.actionKind || ''
        })

        if(itemKey !== resolvedHref) delete queue[itemKey]
        queue[resolvedHref] = nextItem

        const affectedRunIds = new Set()
        if(nextItem.runId) affectedRunIds.add(nextItem.runId)
        if(existingResolvedItem?.runId) affectedRunIds.add(existingResolvedItem.runId)
        for(const runId of getCoordinatorRunIdsForHref(runs, oldProfileHref)) {
            affectedRunIds.add(runId)
        }
        for(const runId of affectedRunIds) {
            const run = runs[runId]
            if(!run) continue
            runs[runId] = {
                ...run,
                targetProfileHrefs: getNormalizedProfileHrefList([
                    ...getCoordinatorRunTargetHrefs(run),
                    resolvedHref
                ]),
                targetWorkKeys: mergeUniqueStringList(
                    Array.isArray(run.targetWorkKeys) ? run.targetWorkKeys : [],
                    [resolvedHref]
                ).filter(key => key !== itemKey),
                updatedAt: now
            }
        }
        const nextRuns = affectedRunIds.size
            ? recomputeCoordinatorRuns(queue, runs, affectedRunIds)
            : runs

        const pendingResult = addResolvedProfileToPendingSpaceRecords(
            stored[SPACE_PENDING_NUKED_POSTS_KEY] || {},
            nextItem,
            resolvedHref
        )
        const payload = {
            [COORDINATOR_QUEUE_KEY]: queue,
            [COORDINATOR_RUNS_KEY]: nextRuns
        }
        if(pendingResult.changed) {
            payload[SPACE_PENDING_NUKED_POSTS_KEY] = pendingResult.pendingPosts
        }
        await metricStorageSet(payload, {
            snapshotWriteReason: 'ordinaryMutation',
            queueOperation: 'resolver-remap',
            queueChangedRows: itemKey !== resolvedHref && existingResolvedItem ? 2 : 1
        })

        if(tabId) {
            remapQueuedTabToResolvedProfile(tabId, nextItem, resolvedHref, nextItem.requestedUrl || requestedUrl)
        }

        return {resolved: true, profileHref: resolvedHref}
    })
}

async function markQueuedProfileResolutionUnresolved(request = {}, sender = {}) {
    const tabId = sender.tab?.id || null
    const metadata = tabId ? getQueuedTabMetadata(tabId) : null
    const requestedUrl = normalizeCoordinatorRequestedUrl(request.requestedUrl || metadata?.requestedUrl || '')
    const coordinatorKey = metadata?.coordinatorKey ||
        request.coordinatorKey ||
        makeProfileResolutionQueueKey(requestedUrl || '')
    const error = `${request.error || 'Queued source page did not resolve to a profile target'}`.trim()
    const outcome = `${request.outcome || 'unresolved-target'}`.trim()

    return enqueueSpaceFeedStorageUpdate(async () => {
        const state = await loadCoordinatorState({
            [COORDINATOR_EVENTS_KEY]: undefined,
            [SPACE_PENDING_NUKED_POSTS_KEY]: {}
        })
        const queue = state.queue
        const runs = state.runs
        const events = state.events
        const pendingPosts = state.stored?.[SPACE_PENDING_NUKED_POSTS_KEY] || {}
        const itemKey = coordinatorKey && queue[coordinatorKey]
            ? coordinatorKey
            : makeProfileResolutionQueueKey(requestedUrl || '')
        const item = itemKey ? queue[itemKey] : null
        if(!item) return {recorded: false, reason: 'missing-coordinator-item'}
        if(isTerminalCoordinatorStatus(item.status)) return {recorded: false, reason: 'terminal-coordinator-item'}

        if(hasMismatchedCoordinatorAttempt(item, request)) {
            await recordStaleAttemptDiagnostic({
                incomingAttemptId: getAttemptIdFromValue(request),
                expectedAttemptId: getAttemptIdFromValue(item),
                senderTabId: tabId,
                message: 'Ignored queued target resolution failure from stale attempt'
            })
            return {recorded: false, reason: 'stale-attempt'}
        }

        const now = Date.now()
        const nextItem = {
            ...item,
            status: 'skipped',
            outcome,
            error,
            updatedAt: now,
            terminalAt: now,
            tabId: null,
            actionLease: null,
            actionLeaseReleasedAt: now,
            actionLeaseReleaseReason: 'unresolved-resolution',
            milestones: {
                ...(item.milestones || makeEmptyCoordinatorMilestones()),
                closeRequestedAt: now,
                tabClosedAt: now
            }
        }
        queue[itemKey] = nextItem

        const affectedRunIds = new Set()
        if(nextItem.runId) affectedRunIds.add(nextItem.runId)
        const nextRuns = affectedRunIds.size
            ? recomputeCoordinatorRuns(queue, runs, affectedRunIds)
            : runs
        const pendingResult = clearResolverPendingSpaceRecords(pendingPosts, nextItem, {
            requestedUrl: nextItem.requestedUrl || requestedUrl,
            evidence: request.evidence || []
        })

        events.push({
            id: makeId('event'),
            runId: nextItem.runId || '',
            itemId: nextItem.id || itemKey,
            type: 'unresolved-target',
            message: error,
            at: now,
            details: {
                coordinatorKey: itemKey,
                requestedUrl: nextItem.requestedUrl || requestedUrl,
                resolutionReason: request.resolutionReason || nextItem.resolutionReason || ''
            }
        })

        await saveCoordinatorState({
            queue,
            runs: nextRuns,
            events,
            pendingPosts: pendingResult.pendingPosts
        }, {
            queue: true,
            runs: JSON.stringify(nextRuns) !== JSON.stringify(runs),
            events: true,
            pendingPosts: pendingResult.changed,
            reason: 'ordinaryMutation',
            queueOperation: 'resolver-unresolved',
            queueChangedRows: 1
        })

        return {
            recorded: true,
            status: nextItem.status,
            outcome,
            pendingPosts: pendingResult.changed ? pendingResult.pendingPosts : null
        }
    })
}

const COORDINATOR_ROW_EVENT_QUEUED_PROGRESS_MILESTONE = 'queued-progress-milestone'

function getCoordinatorRowEventMetricKind(eventKind = '') {
    return normalizeStorageMetricPathName(eventKind || 'unknown')
}

function incrementCoordinatorRowEventMetric(eventKind = '', suffix = '', amount = 1) {
    const kind = getCoordinatorRowEventMetricKind(eventKind)
    const name = `${suffix || ''}`.trim()
    if(!name) return
    incrementQueueWakeupMetric(`rowEvent.${kind}.${name}`, amount)
}

function normalizeCoordinatorRowProgressEvent(event = {}) {
    const eventKind = `${event?.eventKind || ''}`.trim()
    const profileHref = normalizeQuoraProfileUrl(event?.profileHref || event?.href || event?.coordinatorKey || '')
    if(!profileHref) return null
    return {
        eventKind,
        profileHref,
        coordinatorKey: normalizeQuoraProfileUrl(event?.coordinatorKey || profileHref) || profileHref,
        patch: event?.patch && typeof event.patch === 'object' ? event.patch : {},
        senderTabId: normalizeTabId(event?.senderTabId || event?.tabId || event?.patch?.tabId || null)
    }
}

function buildCoordinatorRowEventsFromProgressRecords(progressRecords = {}, options = {}) {
    return Object.entries(progressRecords || {})
        .map(([profileHref, patch]) => normalizeCoordinatorRowProgressEvent({
            eventKind: COORDINATOR_ROW_EVENT_QUEUED_PROGRESS_MILESTONE,
            profileHref,
            coordinatorKey: profileHref,
            patch,
            senderTabId: options.senderTabId || null
        }))
        .filter(Boolean)
}

async function applyCoordinatorRowEvent(event = {}, options = {}) {
    const result = await applyCoordinatorRowEvents([event], options)
    const normalizedHref = normalizeQuoraProfileUrl(event?.profileHref || event?.href || event?.coordinatorKey || '')
    return result?.results?.[normalizedHref] || {
        recorded: false,
        terminal: false,
        reason: result?.reason || 'not-recorded'
    }
}

async function applyCoordinatorRowEvents(events = [], options = {}) {
    await ensureProfileNukeProgressReady()

    const normalizedEvents = (Array.isArray(events) ? events : [events])
        .map(normalizeCoordinatorRowProgressEvent)
        .filter(Boolean)
    if(!normalizedEvents.length) {
        return {recorded: false, terminal: false, reason: 'invalid-profile-href', results: {}}
    }

    for(const event of normalizedEvents) {
        incrementCoordinatorRowEventMetric(event.eventKind, 'received')
    }

    const metricKinds = Array.from(new Set(normalizedEvents.map(event => getCoordinatorRowEventMetricKind(event.eventKind))))
    const metricPath = metricKinds.length === 1
        ? `rowEvent.${metricKinds[0]}`
        : 'rowEvent.batch'

    return enqueueSpaceFeedStorageUpdate(async () => {
        const state = await loadCoordinatorQueueRunsProjection({
            metricPath: `${metricPath}.load`
        })
        let currentAuthorityState = state
        let queue = state.queue
        let runs = state.runs
        const progress = {
            ...(profileNukeProgress || {})
        }
        const results = {}
        const affectedRunIds = new Set()
        let queueChangedRows = 0
        let progressChanged = false
        let progressChangedRows = 0
        const progressProjectionRecords = {}
        const progressProjectionPreviousRecords = {}
        const progressShadowWalRecords = {}

        for(const event of normalizedEvents) {
            const eventKind = event.eventKind
            const normalizedHref = event.profileHref
            const item = queue[event.coordinatorKey] || queue[normalizedHref] || null

            if(eventKind !== COORDINATOR_ROW_EVENT_QUEUED_PROGRESS_MILESTONE) {
                incrementCoordinatorRowEventMetric(eventKind, 'rejected.unsupportedKind')
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'unsupported-event-kind'}
                continue
            }

            if(!item) {
                incrementCoordinatorRowEventMetric(eventKind, 'rejected.missingCoordinatorItem')
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'missing-coordinator-item'}
                continue
            }

            if(!isCoordinatorQueueAuthoritativeItem(item)) {
                incrementCoordinatorRowEventMetric(eventKind, 'rejected.durableOnlyCoordinatorItem')
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'durable-only-coordinator-item'}
                continue
            }

            const previous = mergeStoredProfileProgressRecord(
                progress[normalizedHref] || null,
                profileNukeProgress?.[normalizedHref] || null,
                normalizedHref
            )
            const record = normalizeProgressPatch(normalizedHref, event.patch, previous)
            if(!record) {
                incrementCoordinatorRowEventMetric(eventKind, 'rejected.invalidRecord')
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'invalid-progress-record'}
                continue
            }

            if(!shouldApplyProgressToCoordinatorItem(item, record)) {
                incrementCoordinatorRowEventMetric(eventKind, 'rejected.actionKindMismatch')
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'action-kind-mismatch'}
                continue
            }

            if(hasMismatchedCoordinatorAttempt(item, record)) {
                incrementCoordinatorRowEventMetric(eventKind, 'rejected.staleAttempt')
                await recordStaleAttemptDiagnostic({
                    profileHref: normalizedHref,
                    incomingAttemptId: getAttemptIdFromValue(record),
                    expectedAttemptId: getAttemptIdFromValue(item),
                    senderTabId: event.senderTabId || null,
                    message: 'Ignored row event progress from stale attempt'
                })
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'stale-attempt'}
                continue
            }

            if(isTerminalCoordinatorStatus(item.status)) {
                incrementCoordinatorRowEventMetric(eventKind, 'rejected.terminalRowPreserved')
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'terminal-row-preserved'}
                continue
            }

            const mapped = getCoordinatorStatusFromProgress(record)
            if(isTerminalCoordinatorStatus(mapped.status)) {
                incrementCoordinatorRowEventMetric(eventKind, 'rejected.terminalProgress')
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'terminal-progress-not-row-event'}
                continue
            }

            const patchHasStatus = progressPatchHasExplicitStatus(event.patch)
            const patchCanTransitionStatus = patchHasStatus
                ? shouldApplyExplicitProgressStatusToCoordinatorItem(item, event.patch, {
                    ...options,
                    senderTabId: event.senderTabId || options.senderTabId || null
                })
                : false

            if(patchHasStatus && !patchCanTransitionStatus) {
                incrementCoordinatorRowEventMetric(eventKind, 'rejected.inactiveSenderTab')
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'inactive-sender-tab'}
                continue
            }

            if(patchCanTransitionStatus &&
                mapped.status &&
                !(item.status !== 'queued' && mapped.status === 'queued')) {
                const nextItem = transitionCoordinatorItemFromProgress(item, record, mapped, {
                    now: Date.now()
                })
                if(JSON.stringify(nextItem) !== JSON.stringify(item) &&
                    shouldPersistCoordinatorRowEventQueueItemChange(item, nextItem, mapped)) {
                    const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
                        operationKind: 'row-event-progress-milestone',
                        rowKey: event.coordinatorKey,
                        expectedAttemptId: getAttemptIdFromValue(item),
                        expectedAttemptNumber: getAttemptNumberFromValue(item),
                        reason: 'ordinaryMutation',
                        metricPath: `${metricPath}.save`,
                        currentAuthorityState,
                        mutate(currentItem) {
                            if(JSON.stringify(currentItem) !== JSON.stringify(item)) {
                                return {
                                    accepted: false,
                                    reason: 'row-changed-before-authority-apply'
                                }
                            }
                            return nextItem
                        }
                    })
                    if(authorityResult?.accepted === true && authorityResult?.durable === true) {
                        currentAuthorityState = coordinatorAuthority.current()
                        queue = currentAuthorityState.queue
                        queueChangedRows += 1
                        incrementCoordinatorRowEventMetric(eventKind, 'queueChanged')
                        if(nextItem.runId) affectedRunIds.add(nextItem.runId)
                        if(item.runId) affectedRunIds.add(item.runId)
                        for(const runId of getCoordinatorRunIdsForHref(runs, normalizedHref)) {
                            affectedRunIds.add(runId)
                        }
                    }
                    else {
                        incrementCoordinatorRowEventMetric(eventKind, `rejected.${authorityResult?.reason || 'authority-apply-failed'}`)
                        results[normalizedHref] = {
                            recorded: false,
                            terminal: false,
                            reason: authorityResult?.reason || 'authority-apply-failed'
                        }
                        continue
                    }
                }
                else if(JSON.stringify(nextItem) !== JSON.stringify(item)) {
                    incrementCoordinatorRowEventMetric(eventKind, 'queueSnapshotSkipped')
                }
            }

            progress[normalizedHref] = record
            progressProjectionRecords[normalizedHref] = record
            progressProjectionPreviousRecords[normalizedHref] = previous
            const progressRecordChanged = JSON.stringify(previous || null) !== JSON.stringify(record || null)
            if(progressRecordChanged) progressShadowWalRecords[normalizedHref] = record
            profileNukeProgress = {
                ...profileNukeProgress,
                [normalizedHref]: record
            }
            progressChanged = true
            progressChangedRows += 1
            incrementCoordinatorRowEventMetric(eventKind, 'accepted')

            if(getFirstPositiveNumber(
                event.patch.blockAttemptedAt,
                event.patch.muteAttemptedAt,
                event.patch.unblockAttemptedAt,
                event.patch.unmuteAttemptedAt
            )) {
                incrementQueueWakeupMetric('job.actionStarted')
                rememberQueueLoadProgress('action-phase-progress')
            }

            results[normalizedHref] = {
                recorded: true,
                terminal: false,
                record,
                progressOperation: makeCoordinatorProgressOperationRecord({
                    eventKind,
                    profileHref: normalizedHref,
                    reason: 'projection-pending'
                }, {
                    accepted: true,
                    changed: progressRecordChanged,
                    durable: false,
                    reason: 'projection-pending',
                    previousRecord: previous,
                    nextRecord: record,
                    terminal: false
                })
            }
        }

        const nextRuns = affectedRunIds.size
            ? recomputeCoordinatorRuns(queue, runs, affectedRunIds)
            : runs
        const runsChanged = JSON.stringify(nextRuns) !== JSON.stringify(runs)
        if(runsChanged) runs = nextRuns

        if(runsChanged) {
            let runsSaved = false
            try {
                runsSaved = await saveCoordinatorState({
                    queue,
                    runs
                }, {
                    queue: false,
                    runs: true,
                    reason: 'ordinaryMutation',
                    metricPath: `${metricPath}.save`,
                    queueOperation: 'row-event-progress-milestone',
                    queueChangedRows
                })
            }
            catch(error) {
                runsSaved = false
                recordCoordinatorDiagnosticEvent(
                    'row-event-progress-milestone-runs-save-failed',
                    error?.message || 'Row event derived runs save failed'
                )
            }
            if(runsSaved === false) {
                incrementCoordinatorRowEventMetric(
                    normalizedEvents[0]?.eventKind || COORDINATOR_ROW_EVENT_QUEUED_PROGRESS_MILESTONE,
                    'derivedRunsSaveFailed'
                )
                scheduleStoredWorkRepair(1000, {
                    reason: 'row-event-derived-runs-save-failed',
                    edgeTriggered: true
                })
            }
        }
        if(progressChanged) {
            const progressEventKind = normalizedEvents[0]?.eventKind || COORDINATOR_ROW_EVENT_QUEUED_PROGRESS_MILESTONE
            const progressEventMetricKind = getCoordinatorRowEventMetricKind(progressEventKind)
            const progressEventShadowPrefix = `rowEvent.${progressEventMetricKind}.shadowWal`
            const progressShadowWalRows = Object.keys(progressShadowWalRecords).length
            const progressShadowWalSkippedNoChange = Math.max(0, progressChangedRows - progressShadowWalRows)
            let progressShadowWal = null
            const projectionResult = await saveProfileNukeProgressRowProjection(progressProjectionRecords, {
                metricPath: `${metricPath}.projection`
            })
            const projectionSaved = projectionResult !== false
            const persistedProgressRecords = projectionSaved && projectionResult?.records
                ? projectionResult.records
                : {}
            if(projectionSaved) {
                const progressShadowWalOperations = {}
                for(const [profileHref, result] of Object.entries(results)) {
                    if(result?.recorded === true && result.progressOperation?.changed === true) {
                        const persistedRecord = persistedProgressRecords[profileHref] || result.progressOperation.nextRecord
                        if(persistedRecord) {
                            result.record = persistedRecord
                            result.progressOperation = {
                                ...result.progressOperation,
                                nextRecord: persistedRecord
                            }
                            profileNukeProgress = {
                                ...profileNukeProgress,
                                [profileHref]: persistedRecord
                            }
                        }
                        progressShadowWalOperations[profileHref] = {
                            ...result.progressOperation,
                            durable: true,
                            reason: 'projection-persisted',
                            nextRecord: persistedRecord
                        }
                    }
                }
                progressShadowWal = progressShadowWalRows
                    ? safeRecordProgressShadowWalProjection(Object.fromEntries(
                        Object.keys(progressShadowWalRecords)
                            .map(profileHref => [profileHref, persistedProgressRecords[profileHref] || progressShadowWalRecords[profileHref]])
                    ), {
                        previousProgressRecords: progressProjectionPreviousRecords,
                        progressOperations: progressShadowWalOperations,
                        eventKind: progressEventKind,
                        recordsAlreadyNormalized: true,
                        previousRecordsAlreadyNormalized: true
                    })
                    : {checked: 0, matched: 0, mismatched: 0, failed: 0, results: {}}
                if(progressShadowWalSkippedNoChange) {
                    progressShadowWal.skippedNoChange = progressShadowWalSkippedNoChange
                    incrementQueueWakeupMetric('progress.shadowWal.skippedNoChange', progressShadowWalSkippedNoChange)
                    incrementQueueWakeupMetric(`${progressEventShadowPrefix}.skippedNoChange`, progressShadowWalSkippedNoChange)
                }
                const progressShadowWalRecordsToAppend = Object.values(progressShadowWal.results || {})
                    .filter(result => result?.checked === true && result?.matched === true && result?.record)
                    .map(result => result.record)
                progressShadowWal.append = safeAppendProgressShadowWalRecords(progressShadowWalRecordsToAppend, {
                    segmentId: `progress-shadow-${getCoordinatorRowEventMetricKind(progressEventKind)}-${Date.now()}`
                })
                incrementCoordinatorRowEventMetric(
                    progressEventKind,
                    'projectionSaved',
                    progressChangedRows
                )
            }
            else {
                incrementQueueWakeupMetric('progress.shadowWal.skippedNonDurable', progressChangedRows)
                incrementQueueWakeupMetric(`${progressEventShadowPrefix}.skippedNonDurable`, progressChangedRows)
                progressShadowWal = {
                    checked: 0,
                    matched: 0,
                    mismatched: 0,
                    failed: 0,
                    skippedNonDurable: progressChangedRows,
                    results: {}
                }
                incrementCoordinatorRowEventMetric(
                    progressEventKind,
                    'projectionSuppressed',
                    progressChangedRows
                )
            }
            for(const result of Object.values(results)) {
                if(result?.recorded === true) {
                    result.progressProjectionDurable = projectionSaved !== false
                    if(projectionSaved === false) result.progressProjectionSuppressed = true
                    if(result.progressOperation) {
                        result.progressOperation = {
                            ...result.progressOperation,
                            durable: projectionSaved !== false,
                            reason: projectionSaved !== false ? 'projection-persisted' : 'projection-suppressed'
                        }
                    }
                    if(projectionSaved !== false && result.progressOperation?.changed === false) {
                        result.progressShadowWal = {
                            checked: false,
                            matched: false,
                            reason: 'no-change',
                            skippedNoChange: true
                        }
                    }
                    else if(projectionSaved !== false) {
                        const rowShadowWal = progressShadowWal?.results?.[result.record?.profileHref] || {
                            checked: false,
                            matched: false,
                            reason: 'missing-shadow-wal-result'
                        }
                        result.progressShadowWal = {
                            ...rowShadowWal,
                            append: rowShadowWal?.checked === true && rowShadowWal?.matched === true
                                ? makeProgressShadowWalRowAppendResult(progressShadowWal?.append, result.record?.profileHref)
                                : null
                        }
                    }
                    else {
                        result.progressShadowWal = {
                            checked: false,
                            matched: false,
                            reason: 'non-durable',
                            skippedNonDurable: true
                        }
                    }
                }
            }
            scheduleProfileNukeProgressCompatibilityFlush('row-event-progress-milestone')
            return {
                recorded: Object.values(results).some(result => result?.recorded),
                terminal: false,
                rowEvent: true,
                progressProjectionDurable: Object.values(results)
                    .filter(result => result?.recorded === true)
                    .every(result => result.progressProjectionDurable === true),
                progressShadowWal,
                results
            }
        }

        return {
            recorded: Object.values(results).some(result => result?.recorded),
            terminal: false,
            rowEvent: true,
            progressProjectionDurable: null,
            progressShadowWal: null,
            results
        }
    })
}

function scheduleTerminalProgressCompatibilitySave(snapshot = {}) {
    const runsChanged = snapshot.runsChanged === true
    const progressRecords = normalizeStoredProfileNukeProgress(snapshot.progressRecords || {})
    const progressRecordHrefs = Object.keys(progressRecords)
    const progressChanged = snapshot.progressChanged === true && progressRecordHrefs.length > 0
    if(!runsChanged && !progressChanged) return false

    const affectedRunIds = Array.from(new Set(
        (snapshot.affectedRunIds || [])
            .map(runId => `${runId || ''}`.trim())
            .filter(Boolean)
    ))

    incrementQueueWakeupMetric('terminalProgress.compatibilitySaveDeferred')
    void enqueueSpaceFeedStorageUpdate(async () => {
        let currentAuthorityState = null
        let stored = {}
        if(runsChanged) {
            currentAuthorityState = await loadCoordinatorQueueRunsProjection({
                metricPath: 'terminalProgress.compatibilitySave.load'
            })
        }
        if(progressChanged) {
            stored = await metricStorageGet({
                [PROFILE_NUKE_PROGRESS_KEY]: {}
            }, {
                metricPath: runsChanged
                    ? 'terminalProgress.compatibilitySave.progress.load'
                    : 'terminalProgress.compatibilitySave.load'
            })
        }

        let runs = {}
        let nextRunsChanged = false
        if(runsChanged) {
            const queue = currentAuthorityState?.queue || {}
            const currentRuns = currentAuthorityState?.runs || {}
            runs = recomputeCoordinatorRuns(queue, currentRuns, affectedRunIds.length ? affectedRunIds : null)
            nextRunsChanged = JSON.stringify(runs) !== JSON.stringify(currentRuns)
        }

        const mergedProgressRecords = {}
        let progress = {}
        let nextProgressChanged = false
        let progressChangedRows = 0
        if(progressChanged) {
            progress = normalizeStoredProfileNukeProgress(stored[PROFILE_NUKE_PROGRESS_KEY] || {})
            for(const [profileHref, record] of Object.entries(progressRecords)) {
                const existing = mergeStoredProfileProgressRecord(
                    progress[profileHref] || null,
                    profileNukeProgress?.[profileHref] || null,
                    profileHref
                )
                const merged = mergeStoredProfileProgressRecord(existing, record, profileHref)
                if(JSON.stringify(progress[profileHref] || null) === JSON.stringify(merged)) continue
                progress[profileHref] = merged
                mergedProgressRecords[profileHref] = merged
                nextProgressChanged = true
                progressChangedRows += 1
            }
        }

        if(!nextRunsChanged && !nextProgressChanged) return true

        const saved = await saveCoordinatorState({
            runs,
            progress
        }, {
            queue: false,
            runs: nextRunsChanged,
            progress: nextProgressChanged,
            progressChangedRows,
            reason: 'ordinaryMutation',
            metricPath: 'terminalProgress.compatibilitySave',
            queueOperation: 'terminal-progress',
            queueChangedRows: 0
        })

        if(saved !== false && nextProgressChanged) {
            profileNukeProgress = {
                ...profileNukeProgress,
                ...mergedProgressRecords
            }
        }

        return saved !== false
    }, {
        reason: 'terminal-progress-compatibility-save',
        failureValue: false
    }).then(saved => {
        if(saved !== false) {
            incrementQueueWakeupMetric('terminalProgress.compatibilitySaveCompleted')
            return
        }
        incrementQueueWakeupMetric('terminalProgress.compatibilitySaveFailed')
        scheduleStoredWorkRepair(1000, {
            reason: 'terminal-progress-compatibility-save-failed',
            edgeTriggered: true
        })
    }).catch(error => {
        incrementQueueWakeupMetric('terminalProgress.compatibilitySaveFailed')
        recordCoordinatorDiagnosticEvent(
            'terminal-progress-compatibility-save-failed',
            error?.message || 'Terminal progress compatibility save failed'
        )
        scheduleStoredWorkRepair(1000, {
            reason: 'terminal-progress-compatibility-save-failed',
            edgeTriggered: true
        })
    })

    return true
}

function scheduleTerminalProgressSettlement(profileHrefs = []) {
    const hrefs = getNormalizedProfileHrefList(profileHrefs || [])
    if(!hrefs.length) return false

    incrementQueueWakeupMetric('terminalProgress.settlementDeferred')
    void settleTerminalCoordinatorItems({
        profileHrefs: hrefs
    }).then(result => {
        if(result !== false) {
            incrementQueueWakeupMetric('terminalProgress.settlementCompleted')
            return
        }
        incrementQueueWakeupMetric('terminalProgress.settlementFailed')
        scheduleStoredWorkRepair(1000, {
            reason: 'terminal-progress-settlement-failed',
            edgeTriggered: true
        })
    }).catch(error => {
        incrementQueueWakeupMetric('terminalProgress.settlementFailed')
        recordCoordinatorDiagnosticEvent(
            'terminal-progress-settlement-failed',
            error?.message || 'Terminal progress settlement follow-up failed'
        )
        scheduleStoredWorkRepair(1000, {
            reason: 'terminal-progress-settlement-failed',
            edgeTriggered: true
        })
    })

    return true
}

async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {}) {
    await ensureProfileNukeProgressReady()

    const normalizedRecords = {}
    for(const [key, patch] of Object.entries(progressRecords || {})) {
        const normalizedHref = normalizeQuoraProfileUrl(patch?.profileHref || key || '')
        if(!normalizedHref) continue
        normalizedRecords[normalizedHref] = addSenderTabIdToProgressPatch(patch, options.senderTabId)
    }

    if(!Object.keys(normalizedRecords).length) {
        return {recorded: false, terminal: false, reason: 'invalid-profile-href', results: {}}
    }

    incrementQueueWakeupMetric('progress.batchReceived')
    incrementQueueWakeupMetric('progress.recordReceived', Object.keys(normalizedRecords).length)
    incrementQueueWakeupMetric('progress.recordsPerBatch', Object.keys(normalizedRecords).length)

    if(options.deferredMilestoneFlush === true) {
        return applyCoordinatorRowEvents(
            buildCoordinatorRowEventsFromProgressRecords(normalizedRecords, options),
            options
        )
    }

    const updateResult = await enqueueSpaceFeedStorageUpdate(async () => {
        const state = await loadCoordinatorState({
            [COORDINATOR_EVENTS_KEY]: undefined
        })
        let currentAuthorityState = state
        let queue = state.queue
        let runs = state.runs
        const progress = state.progress
        const results = {}
        const affectedRunIds = new Set()
        const terminalSettlementHrefs = new Set()
        const terminalCompatibilityProgressRecords = {}
        let queueChanged = false
        let snapshotQueueChanged = false
        let progressChanged = false
        let progressChangedRows = 0

        for(const [normalizedHref, patch] of Object.entries(normalizedRecords)) {
            const item = queue[normalizedHref] || null
            const patchHasStatus = progressPatchHasExplicitStatus(patch)
            const patchCanTransitionStatus = item
                ? shouldApplyExplicitProgressStatusToCoordinatorItem(item, patch, options)
                : patchHasStatus
            const previous = mergeStoredProfileProgressRecord(
                progress[normalizedHref] || null,
                profileNukeProgress?.[normalizedHref] || null,
                normalizedHref
            )
            let record = normalizeProgressPatch(normalizedHref, patch, previous)
            if(!record) {
                results[normalizedHref] = {recorded: false, terminal: false}
                continue
            }

            let accepted = false
            let terminal = false

            if(item && options.requireActiveSenderTab === true && patchHasStatus && !patchCanTransitionStatus) {
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'inactive-sender-tab'}
                continue
            }

            if(item && !isCoordinatorQueueAuthoritativeItem(item)) {
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'durable-only-coordinator-item'}
                continue
            }

            if(item && shouldApplyProgressToCoordinatorItem(item, record) && !hasMismatchedCoordinatorAttempt(item, record)) {
                accepted = true
                const mapped = getCoordinatorStatusFromProgress(record)
                const mappedTerminal = isTerminalCoordinatorStatus(mapped.status)
                const preferSuccessfulTerminal = shouldPreferSuccessfulProgressOverTerminalCoordinatorItem(item, record, mapped)
                terminal = mappedTerminal

                if(isTerminalCoordinatorStatus(item.status) && !mappedTerminal) {
                    const restoredRecord = makeTerminalProgressRecordFromCoordinatorItem(
                        normalizedHref,
                        item,
                        record,
                        'Restored terminal profile progress from authoritative queue row'
                    )
                    if(restoredRecord) {
                        record = restoredRecord
                        terminal = true
                    }
                }
                else if(shouldRestoreTerminalProgressFromCoordinatorItem(item, record)) {
                    const restoredRecord = makeTerminalProgressRecordFromCoordinatorItem(
                        normalizedHref,
                        item,
                        record,
                        'Restored terminal profile progress from authoritative queue row'
                    )
                    if(restoredRecord) {
                        record = restoredRecord
                        terminal = true
                    }
                }
                else if((patchCanTransitionStatus || preferSuccessfulTerminal) &&
                    mapped.status &&
                    !(item.status !== 'queued' && mapped.status === 'queued')) {
                    const nextItem = transitionCoordinatorItemFromProgress(item, record, mapped, {
                        now: Date.now()
                    })
                    if(JSON.stringify(nextItem) !== JSON.stringify(item)) {
                        if(mappedTerminal) {
                            const authorityResult = await coordinatorAuthority.applyWithinStorageUpdate({
                                operationKind: 'terminal-progress',
                                rowKey: normalizedHref,
                                expectedAttemptId: getAttemptIdFromValue(item),
                                expectedAttemptNumber: getAttemptNumberFromValue(item),
                                reason: 'ordinaryMutation',
                                metricPath: 'terminalProgress.save',
                                currentAuthorityState,
                                mutate(currentItem) {
                                    if(JSON.stringify(currentItem) !== JSON.stringify(item)) {
                                        return {
                                            accepted: false,
                                            reason: 'row-changed-before-authority-apply'
                                        }
                                    }
                                    return nextItem
                                }
                            })

                            if(authorityResult?.accepted === true && authorityResult?.durable === true) {
                                currentAuthorityState = coordinatorAuthority.current()
                                queue = currentAuthorityState.queue
                                queueChanged = true
                                terminalSettlementHrefs.add(normalizedHref)
                            }
                            else {
                                results[normalizedHref] = {
                                    recorded: false,
                                    terminal: false,
                                    reason: authorityResult?.reason || 'authority-apply-failed'
                                }
                                continue
                            }
                        }
                        else {
                            queue[normalizedHref] = nextItem
                            currentAuthorityState = {
                                ...currentAuthorityState,
                                queue
                            }
                            queueChanged = true
                            snapshotQueueChanged = true
                        }

                        if(nextItem.runId) affectedRunIds.add(nextItem.runId)
                        if(item.runId) affectedRunIds.add(item.runId)
                        for(const runId of getCoordinatorRunIdsForHref(runs, normalizedHref)) {
                            affectedRunIds.add(runId)
                        }
                    }
                }
            }
            else if(item && hasMismatchedCoordinatorAttempt(item, record)) {
                await recordStaleAttemptDiagnostic({
                    profileHref: normalizedHref,
                    incomingAttemptId: getAttemptIdFromValue(record),
                    expectedAttemptId: getAttemptIdFromValue(item),
                    senderTabId: options.senderTabId || null,
                    message: 'Ignored direct job progress from stale attempt'
                })
            }
            else if(!item) {
                results[normalizedHref] = {recorded: false, terminal: false, reason: 'missing-coordinator-item'}
                continue
            }

            if(accepted) {
                progress[normalizedHref] = record
                profileNukeProgress = {
                    ...profileNukeProgress,
                    [normalizedHref]: record
                }
                progressChanged = true
                progressChangedRows += 1
                if(getFirstPositiveNumber(patch.blockAttemptedAt, patch.muteAttemptedAt, patch.unblockAttemptedAt, patch.unmuteAttemptedAt)) {
                    incrementQueueWakeupMetric('job.actionStarted')
                    rememberQueueLoadProgress('action-phase-progress')
                }
                if(terminal) {
                    incrementQueueWakeupMetric('job.terminal')
                    recordQueueWakeupPhaseSamplesFromProgress(record)
                    terminalCompatibilityProgressRecords[normalizedHref] = record
                }
            }

            results[normalizedHref] = {recorded: accepted, terminal, record}
        }

        const nextRuns = affectedRunIds.size
            ? recomputeCoordinatorRuns(queue, runs, affectedRunIds)
            : runs
        const runsChanged = JSON.stringify(nextRuns) !== JSON.stringify(runs)
        if(runsChanged) runs = nextRuns
        const deferCompatibilitySave = terminalSettlementHrefs.size > 0 && !snapshotQueueChanged

        if(!deferCompatibilitySave) {
            await saveCoordinatorState({
                queue,
                runs,
                progress
            }, {
                queue: snapshotQueueChanged,
                runs: runsChanged,
                progress: progressChanged,
                progressChangedRows,
                reason: 'ordinaryMutation',
                queueOperation: 'terminal-progress',
                queueChangedRows: snapshotQueueChanged ? progressChangedRows : 0
            })
        }
        return {
            recorded: Object.values(results).some(result => result?.recorded),
            terminal: Object.values(results).some(result => result?.terminal),
            terminalSettlementHrefs: Array.from(terminalSettlementHrefs),
            compatibilitySave: deferCompatibilitySave ? {
                affectedRunIds: Array.from(affectedRunIds),
                progressRecords: terminalCompatibilityProgressRecords,
                runsChanged,
                progressChanged,
                progressChangedRows: Object.keys(terminalCompatibilityProgressRecords).length
            } : null,
            results
        }
    })

    if(updateResult?.compatibilitySave) {
        scheduleTerminalProgressCompatibilitySave(updateResult.compatibilitySave)
    }

    if(updateResult?.terminalSettlementHrefs?.length) {
        scheduleTerminalProgressSettlement(updateResult.terminalSettlementHrefs)
    }

    return updateResult
}

async function recordCoordinatorJobProgress(profileHref = '', patch = {}, options = {}) {
    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    if(!normalizedHref) return {recorded: false, terminal: false, reason: 'invalid-profile-href'}

    const batchResult = await recordCoordinatorJobProgressRecords({
        [normalizedHref]: patch
    }, options)

    return batchResult?.results?.[normalizedHref] || {
        recorded: false,
        terminal: false,
        reason: batchResult?.reason || 'not-recorded'
    }
}

function clearPendingCoordinatorJobMilestone(profileHref = '') {
    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    if(!normalizedHref) return false

    const hadPending = !!coordinatorJobMilestonePendingRecords[normalizedHref]
    delete coordinatorJobMilestonePendingRecords[normalizedHref]
    return hadPending
}

function scheduleCoordinatorJobMilestoneFlush() {
    if(coordinatorJobMilestoneFlushTimeout || coordinatorJobMilestoneFlushPromise) return

    incrementQueueWakeupMetric('milestone.flushRequested')
    incrementQueueWakeupMetric('milestone.flushDeferred')
    coordinatorJobMilestoneFlushTimeout = setTimeout(() => {
        coordinatorJobMilestoneFlushTimeout = null
        void flushCoordinatorJobMilestones()
    }, COORDINATOR_JOB_MILESTONE_FLUSH_MS)
}

async function flushCoordinatorJobMilestones() {
    if(coordinatorJobMilestoneFlushPromise) return coordinatorJobMilestoneFlushPromise

    if(coordinatorJobMilestoneFlushTimeout) {
        clearTimeout(coordinatorJobMilestoneFlushTimeout)
        coordinatorJobMilestoneFlushTimeout = null
    }

    coordinatorJobMilestoneFlushPromise = runQueueWakeupMetricPhase('flushMilestones', async () => {
        const combined = {
            recorded: false,
            terminal: false,
            results: {}
        }
        while(Object.keys(coordinatorJobMilestonePendingRecords).length) {
            const pending = coordinatorJobMilestonePendingRecords
            coordinatorJobMilestonePendingRecords = {}
            const pendingCount = Object.keys(pending).length
            incrementQueueWakeupMetric('milestone.flushPerformed')
            incrementQueueWakeupMetric('milestone.recordsPerFlush', pendingCount)
            const result = await recordCoordinatorJobProgressRecords(pending, {
                deferredMilestoneFlush: true
            })
            combined.recorded = result?.recorded === true || combined.recorded
            combined.terminal = result?.terminal === true || combined.terminal
            combined.results = {
                ...combined.results,
                ...(result?.results || {})
            }
        }
        return combined
    })
        .catch(error => ({
            recorded: false,
            terminal: false,
            reason: error?.message || 'milestone-flush-failed',
            results: {}
        }))
        .finally(() => {
            coordinatorJobMilestoneFlushPromise = null
            if(Object.keys(coordinatorJobMilestonePendingRecords).length) {
                scheduleCoordinatorJobMilestoneFlush()
            }
        })

    return coordinatorJobMilestoneFlushPromise
}

async function recordDeferredCoordinatorJobMilestone(profileHref = '', patch = {}, options = {}) {
    await ensureProfileNukeProgressReady()

    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    if(!normalizedHref) return {recorded: false, terminal: false, reason: 'invalid-profile-href'}

    const previous = mergeStoredProfileProgressRecord(
        coordinatorJobMilestonePendingRecords?.[normalizedHref] || null,
        profileNukeProgress?.[normalizedHref] || null,
        normalizedHref
    )
    const record = normalizeProgressPatch(
        normalizedHref,
        addSenderTabIdToProgressPatch(patch, options.senderTabId),
        previous
    )
    if(!record) return {recorded: false, terminal: false}

    coordinatorJobMilestonePendingRecords[normalizedHref] = record
    incrementQueueWakeupMetric('milestone.received')
    recordQueueWakeupMetricMax('milestone.pendingMax', Object.keys(coordinatorJobMilestonePendingRecords).length)

    incrementQueueWakeupMetric('milestone.flushRequested')
    incrementQueueWakeupMetric('milestone.flushImmediate')
    const durable = await flushCoordinatorJobMilestones()
    const rowResult = durable?.results?.[normalizedHref] || {
        recorded: false,
        terminal: false,
        reason: durable?.reason || 'not-recorded'
    }

    if(rowResult.recorded === true && options.senderTabId) {
        const metadataPatch = {
            lastProgressAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
            contentOpenedAt: Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : undefined,
            actionReadyAt: Number.isFinite(record.actionReadyAt) ? record.actionReadyAt : undefined,
            waitingForForegroundAt: Number.isFinite(record.waitingForForegroundAt) ? record.waitingForForegroundAt : undefined,
            foregroundLeaseAcquiredAt: Number.isFinite(record.foregroundLeaseAcquiredAt) ? record.foregroundLeaseAcquiredAt : undefined,
            foregroundPromotedAt: Number.isFinite(record.foregroundPromotedAt) ? record.foregroundPromotedAt : undefined
        }
        if(record.lastUrl) metadataPatch.lastUrl = record.lastUrl
        for(const key of Object.keys(metadataPatch)) {
            if(metadataPatch[key] === undefined) delete metadataPatch[key]
        }
        setQueuedTabMetadata(options.senderTabId, metadataPatch)
    }

    return {
        ...rowResult,
        deferred: true,
        durable: rowResult.recorded === true,
        record: rowResult.record || record
    }
}

async function recordJobProgressFromRequest(request = {}, sender = {}, options = {}) {
    const profileHref = request.profileHref || request.href || ''
    const tabId = sender.tab?.id || null
    const metadata = tabId ? getQueuedTabMetadata(tabId) : null
    const patch = {
        ...(request.patch || {}),
        actionKind: metadata?.actionKind || request.patch?.actionKind || '',
        runId: request.patch?.runId || metadata?.runId || '',
        attemptId: request.patch?.attemptId || request.attemptId || metadata?.attemptId || '',
        attemptNumber: request.patch?.attemptNumber || request.attemptNumber || metadata?.attemptNumber || 0,
        ownerTabId: request.patch?.ownerTabId || metadata?.ownerTabId || null,
        ownerWindowId: request.patch?.ownerWindowId || metadata?.ownerWindowId || null
    }
    const targetProfileHref = metadata?.profileHref || profileHref

    if(!await validateProgressAttempt(targetProfileHref, patch, sender)) {
        return {recorded: false, staleAttempt: true}
    }

    if(options.compatibility !== true) {
        if(options.expectTerminal !== true) {
            return recordDeferredCoordinatorJobMilestone(targetProfileHref, patch, {
                senderTabId: tabId
            })
        }

        clearPendingCoordinatorJobMilestone(targetProfileHref)
        const result = await recordCoordinatorJobProgress(targetProfileHref, patch, {
            expectTerminal: options.expectTerminal === true,
            senderTabId: tabId
        })
        if(options.expectTerminal && !result.terminal) {
            return {recorded: !!result.recorded, terminal: false, reason: 'non-terminal-progress'}
        }
        if(result.terminal) scheduleQueuedWorkContinuation('terminal-job-progress')

        return {
            recorded: !!result.recorded,
            terminal: !!result.terminal,
            compatibility: false,
            record: result.record || null
        }
    }

    const record = await recordProfileNukeProgress(targetProfileHref, patch)
    const mapped = getCoordinatorStatusFromProgress(record)
    const terminal = isTerminalCoordinatorStatus(mapped.status)
    if(options.expectTerminal && !terminal) {
        return {recorded: !!record, terminal: false, reason: 'non-terminal-progress'}
    }
    if(terminal) scheduleQueuedWorkContinuation('terminal-profile-progress')

    return {
        recorded: !!record,
        terminal,
        compatibility: options.compatibility === true
    }
}

async function recordProfileNukeProgressBatchFromRequest(request = {}, sender = {}) {
    const acceptedUpdates = []

    for(const update of Array.isArray(request.updates) ? request.updates : []) {
        const profileHref = update?.profileHref || update?.href || ''
        const patch = update?.patch || {}
        if(await validateProgressAttempt(profileHref, patch, sender)) {
            acceptedUpdates.push(update)
        }
    }

    if(!acceptedUpdates.length) return {recorded: false, staleAttempt: true}

    const recorded = await recordProfileNukeProgressBatch(acceptedUpdates)
    return {recorded: !!recorded}
}

async function fillQueuedTabs(options = {}) {
    if(queuedTabFillPromise) return queuedTabFillPromise

    queuedTabFillPromise = fillQueuedTabsOnce(options)
        .finally(() => {
            queuedTabFillPromise = null
        })

    return queuedTabFillPromise
}

function buildQueuedTabOpenEffectPlan(action = {}, tab = {}, openedAt = Date.now()) {
    const retryAttempt = Number.parseInt(action.retryAttempt, 10) || 0
    const attemptNumber = getAttemptNumberFromValue(action) || retryAttempt + 1
    const attemptId = getAttemptIdFromValue(action) || makeAttemptId()
    const maxRetries = getQueuedTabMaxRetries(action)
    const actionKind = action.actionKind || (action.tabAction === 'nuke' ? 'mute-block' : action.tabAction || null)
    const profileHref = normalizeQuoraProfileUrl(action.profileHref || action.targetProfileHref || action.url || '')
    const coordinatorKey = action.coordinatorKey || (profileHref ? profileHref : makeProfileResolutionQueueKey(action.requestedUrl || action.url || ''))
    const requestedUrl = normalizeCoordinatorRequestedUrl(action.requestedUrl || action.url || '')
    const lastUrl = tab.url || normalizeTabTargetUrl(action.url)

    return {
        action,
        tab,
        retryAttempt,
        attemptId,
        attemptNumber,
        maxRetries,
        openedAt,
        actionKind,
        profileHref,
        coordinatorKey,
        requestedUrl,
        metadata: {
            profileHref,
            coordinatorKey,
            requestedUrl,
            resolutionMode: action.resolutionMode || '',
            resolveProfileFromPage: action.resolveProfileFromPage === true,
            resolutionReason: action.resolutionReason || '',
            candidateConfidence: action.candidateConfidence || '',
            candidateCollector: action.candidateCollector || '',
            ownerTabId: action.ownerTabId || null,
            ownerWindowId: action.ownerWindowId || null,
            actionSurfaceMode: action.actionSurfaceMode || '',
            actionSurfaceWindowId: action.actionSurfaceWindowId || null,
            actionSurfaceAnchorTabId: action.actionSurfaceAnchorTabId || null,
            actionSurfaceActivatedAt: action.actionSurfaceActivatedAt || 0,
            runId: action.runId || '',
            tabAction: action.tabAction || null,
            actionKind,
            jobKey: action.jobKey || '',
            scope: action.scope || null,
            canonicalSubject: action.canonicalSubject || null,
            attempt: action.attempt || null,
            noForegroundFallback: !!action.noForegroundFallback,
            retryAttempt,
            attemptId,
            attemptNumber,
            maxRetries,
            openedAt,
            lastUrl
        },
        pendingAction: {
            action: action.tabAction || null,
            targetUrl: profileHref || '',
            coordinatorKey,
            requestedUrl,
            resolutionMode: action.resolutionMode || '',
            resolveProfileFromPage: action.resolveProfileFromPage === true,
            resolutionReason: action.resolutionReason || '',
            candidateConfidence: action.candidateConfidence || '',
            candidateCollector: action.candidateCollector || '',
            actionKind,
            jobKey: action.jobKey || '',
            scope: action.scope || null,
            canonicalSubject: action.canonicalSubject || null,
            attempt: action.attempt || null,
            runId: action.runId || '',
            ownerTabId: action.ownerTabId || null,
            ownerWindowId: action.ownerWindowId || null,
            actionSurfaceMode: action.actionSurfaceMode || '',
            actionSurfaceWindowId: action.actionSurfaceWindowId || null,
            actionSurfaceAnchorTabId: action.actionSurfaceAnchorTabId || null,
            noForegroundFallback: !!action.noForegroundFallback,
            attemptId,
            attemptNumber
        },
        activeTransitionDetails: {
            retryAttempt,
            attemptId,
            attemptNumber,
            maxRetries,
            openedAt
        },
        progressPatch: {
            actionKind: action.actionKind || (action.tabAction === 'nuke' ? 'mute-block' : action.tabAction || 'mute-block'),
            runId: action.runId || '',
            status: 'tab-opening',
            tabId: tab.id,
            tabCreatedAt: openedAt,
            tabOpenedAt: openedAt,
            contentOpenedAt: 0,
            actionReadyAt: 0,
            muteAttemptedAt: 0,
            mutedAt: 0,
            blockAttemptedAt: 0,
            blockedAt: 0,
            terminalAt: 0,
            slotReleasedAt: 0,
            closeRequestedAt: 0,
            tabClosedAt: 0,
            closedByExtension: false,
            closeReason: '',
            finalError: '',
            retryAttempt,
            attemptId,
            attemptNumber,
            maxRetries,
            ownerTabId: action.ownerTabId || null,
            ownerWindowId: action.ownerWindowId || null,
            actionSurfaceMode: action.actionSurfaceMode || '',
            actionSurfaceWindowId: action.actionSurfaceWindowId || null,
            actionSurfaceActivatedAt: action.actionSurfaceActivatedAt || 0,
            lastUrl
        }
    }
}

function applyQueuedTabOpenRuntimeEffect(plan = {}) {
    const tabId = normalizeTabId(plan?.tab?.id)
    if(!tabId) return false

    activeQueuedTabs.add(tabId)
    setQueuedTabMetadata(tabId, plan.metadata || {})
    pendingTabActions.set(tabId, plan.pendingAction || {})
    registerOwnedTab(plan?.action?.ownerTabId, tabId)
    return true
}

function buildQueuedTabOpenedProgressPatch(plan = {}, transition = {}) {
    const retryAttempt = Number.parseInt(plan.retryAttempt, 10) || 0
    return {
        ...(plan.progressPatch || {}),
        activeTransitionAccepted: transition.activeTransitionAccepted === true,
        activeTransitionError: transition.activeTransitionError || '',
        activeTransitionContinued: transition.activeTransitionContinued === true,
        event: transition.activeTransitionContinued
            ? 'Background opened a queued tab; active transition lagged after action started'
            : transition.activeTransitionError
            ? 'Background opened a queued tab; active transition failed before content-script ensure'
            : retryAttempt > 0
            ? `Background opened retry attempt ${plan.attemptNumber}`
            : 'Background opened a queued tab'
    }
}

async function confirmQueuedTabOpenDurableActiveEffect(action = {}, tab = {}, plan = {}) {
    let activeTransitionAccepted = false
    let activeTransitionError = ''
    let activeTransitionContinued = false

    try {
        activeTransitionAccepted = await promiseWithTimeout(
            transitionCoordinatorItemForQueuedTab(action, tab, plan.activeTransitionDetails || {}),
            QUEUED_TAB_ACTIVE_TRANSITION_TIMEOUT_MS,
            'queued tab active transition'
        )
    }
    catch(error) {
        activeTransitionError = error?.message || `${error || ''}`
    }

    if(!activeTransitionAccepted) {
        activeTransitionAccepted = await promiseWithTimeout(
            confirmQueuedTabDurablyActive(action, tab, {
                ...(plan.activeTransitionDetails || {}),
                profileHref: plan.profileHref || '',
                coordinatorKey: plan.coordinatorKey || '',
                actionKind: plan.actionKind || ''
            }),
            QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,
            'queued tab active confirmation check'
        ).catch(() => false)
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
            scheduleStoredWorkRepair(1000, {
                reason: 'active-transition-continued',
                edgeTriggered: true
            })
        }
        else if(!activeTransitionAccepted) {
            const rolledBack = await rollbackFailedQueuedTabOpen(action, tab, {
                ...(plan.activeTransitionDetails || {}),
                activeTransitionError
            }).catch(() => false)

            if(rolledBack) {
                markQueuedTabClosing(tab.id, 'active-transition-failed')
                const detached = detachQueuedTabRuntimeState(tab.id, 'active-transition-failed')
                try {
                    await browser.tabs.remove(tab.id)
                }
                catch {}
                void releaseQueuedTab(tab.id, {
                    runtimeDetached: true,
                    metadata: detached.metadata,
                    wasActive: detached.wasActive,
                    foregroundLeaseReleased: detached.foregroundLeaseReleased
                })
                return {
                    activeTransitionAccepted,
                    activeTransitionError,
                    activeTransitionContinued,
                    keepOpen: false,
                    rolledBack: true
                }
            }

            markQueuedTabClosing(tab.id, 'active-transition-unconfirmed')
            const detached = detachQueuedTabRuntimeState(tab.id, 'active-transition-unconfirmed')
            try {
                await browser.tabs.remove(tab.id)
            }
            catch {
            }
            void releaseQueuedTab(tab.id, {
                runtimeDetached: true,
                metadata: detached.metadata,
                wasActive: detached.wasActive,
                foregroundLeaseReleased: detached.foregroundLeaseReleased
            })
            scheduleStoredWorkRepair(1000, {
                reason: 'active-transition-unconfirmed',
                edgeTriggered: true
            })
            scheduleQueuedWorkContinuation('active-transition-unconfirmed')
            return {
                activeTransitionAccepted,
                activeTransitionError,
                activeTransitionContinued,
                keepOpen: false,
                rolledBack: false
            }
        }
    }
    else {
        markQueuedTabDurablyActive(tab.id, 'active-transition')
    }

    return {
        activeTransitionAccepted,
        activeTransitionError,
        activeTransitionContinued,
        keepOpen: true,
        rolledBack: false
    }
}

async function fillQueuedTabsOnce(options = {}) {
    await ownedTabIdsReady
    await sweepStaleQueuedTabs()
    const throttle = getQueueLoadThrottle()
    const cycle = startQueueWakeupMetricCycle('pump', 'fillQueuedTabsOnce', 'fill-slots', {
        active: activeQueuedTabs.size,
        queuedActions: queuedTabActions.length,
        concurrency: getEffectiveQueuedTabConcurrency(),
        throttle
    })
    let openedTabs = 0

    const pausedState = options.pauseAlreadyChecked === true
        ? null
        : await metricStorageGet({[COORDINATOR_PAUSED_KEY]: false}).catch(() => null)
    if(pausedState?.[COORDINATOR_PAUSED_KEY] === true) {
        incrementQueueWakeupMetric('pump.noop.paused')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'coordinator-paused', {
            active: activeQueuedTabs.size,
            remainingActions: queuedTabActions.length
        })
        return {
            openedTabs: 0,
            active: activeQueuedTabs.size,
            remainingActions: queuedTabActions.length,
            reason: 'coordinator-paused',
            paused: true
        }
    }

    if(throttle.active && queuedTabActions.length && activeQueuedTabs.size < 1) {
        const delayMs = Math.max(1000, throttle.until - Date.now())
        scheduleCoordinatorQueueResume(delayMs, 'queue-load-throttle')
        scheduleStoredWorkRepair(delayMs, {reason: 'queue-load-throttle'})
        incrementQueueWakeupMetric('pump.noop.throttled')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'queue-load-throttled', {
            retryInMs: delayMs,
            throttleLevel: throttle.level,
            reason: throttle.reason
        })
        return {
            openedTabs: 0,
            active: activeQueuedTabs.size,
            remainingActions: queuedTabActions.length,
            reason: 'queue-load-throttled',
            throttled: true
        }
    }

    while(activeQueuedTabs.size < getEffectiveQueuedTabConcurrency() && queuedTabActions.length) {
        const next = queuedTabActions.shift()
        if(pausedQueuedOwners.has(next.ownerTabId)) {
            rememberCanceledOwnerUrls(next.ownerTabId, next.url ? [next.url] : [])
            continue
        }

        try {
            if(next.executorPlanKind !== 'open-tab') {
                const plannedAction = await planQueuedTabExecutorAction(next)
                if(!plannedAction) {
                    continue
                }
                Object.assign(next, plannedAction)
            }
            const finalOpenDecision = await validateQueuedTabOpenAgainstCurrentAuthority(next)
            if(!finalOpenDecision.open) {
                continue
            }
            next.executorFinalOpenDecisionReason = finalOpenDecision.reason || ''

            void sweepOwnedBlockedProfileTabs(next.ownerTabId)
            let tab = null
            try {
                tab = await createOwnedTab(next)
                openedTabs += 1
                incrementQueueWakeupMetric('pump.changed.openedTab')
                incrementQueueWakeupMetric('job.tabOpened')
            }
            catch(error) {
                const openFailureCount = (Number.parseInt(next.openFailureCount, 10) || 0) + 1
                if(openFailureCount <= 3 && !pausedQueuedOwners.has(next.ownerTabId)) {
                    queuedTabActions.unshift({
                        ...next,
                        openFailureCount,
                        lastOpenFailureAt: Date.now(),
                        lastOpenFailure: error?.message || `${error || ''}`
                    })
                }
                scheduleStoredWorkRepair(1000, {
                    reason: 'queued-tab-open-failed',
                    edgeTriggered: true
                })
                scheduleQueuedWorkContinuation('queued-tab-open-failed')
                break
            }
            const openedAt = Date.now()
            const openPlan = buildQueuedTabOpenEffectPlan(next, tab, openedAt)
            applyQueuedTabOpenRuntimeEffect(openPlan)
            const activeTransition = await confirmQueuedTabOpenDurableActiveEffect(next, tab, openPlan)
            if(activeTransition.keepOpen !== true) continue
            if(openPlan.profileHref) await recordCoordinatorJobProgress(openPlan.profileHref, buildQueuedTabOpenedProgressPatch(openPlan, {
                activeTransitionAccepted: activeTransition.activeTransitionAccepted,
                activeTransitionError: activeTransition.activeTransitionError,
                activeTransitionContinued: activeTransition.activeTransitionContinued
            }), {senderTabId: tab.id})
            const contentEnsurePromise = promiseWithTimeout(
                ensureQueuedTabContentScript(tab.id, 'queued-tab-opened'),
                QUEUED_TAB_CONTENT_SCRIPT_ENSURE_TIMEOUT_MS,
                'queued tab content script ensure'
            ).catch(() => null)
            void contentEnsurePromise
            void nudgeQueuedTabActionClaimWithRetries(tab.id, 'queued-tab-opened')
            scheduleOwnedBlockedProfileSweep(next.ownerTabId, 4000)
            void sweepOwnedBlockedProfileTabs(next.ownerTabId)
        }
        catch(error) {
            scheduleStoredWorkRepair(1000, {
                reason: 'queued-tab-fill-error',
                edgeTriggered: true
            })
            scheduleQueuedWorkContinuation('queued-tab-fill-error')
            break
        }
    }

    if(openedTabs > 0) {
        incrementQueueWakeupMetric('job.nextSlotFilled', openedTabs)
        finishQueueWakeupMetricCycle(cycle, 'state-changed', 'opened-tab', {
            openedTabs,
            active: activeQueuedTabs.size,
            remainingActions: queuedTabActions.length
        })
        return {
            openedTabs,
            active: activeQueuedTabs.size,
            remainingActions: queuedTabActions.length,
            reason: 'opened-tab'
        }
    }
    else {
        incrementQueueWakeupMetric('pump.noop.noPendingItems')
        finishQueueWakeupMetricCycle(cycle, 'no-op', 'no-tab-opened', {
            active: activeQueuedTabs.size,
            remainingActions: queuedTabActions.length
        })
        return {
            openedTabs: 0,
            active: activeQueuedTabs.size,
            remainingActions: queuedTabActions.length,
            reason: 'no-tab-opened'
        }
    }
}

browser.runtime.onInstalled.addListener(details => {
    const resetReason = details.reason === 'install'
        ? 'extension-installed'
        : 'extension-updated'
    void rememberBrowserSessionMarker(resetReason)
    void forgetQuoraRuntimeActivation(resetReason)
    void clearSchedulerAlarms(resetReason)
    void resetQueueWakeupMetricsEpochAfterLoad(resetReason, {deferUntilQuora: true}).then(() => {
        if(details.reason === 'install') {
            return metricStorageSet(defaults, {
                snapshotWriteReason: 'userMemoryNonAuthority'
            })
        }

        return null
    })
})

if(!hasBrowserSessionStorage()) {
    browser.runtime.onStartup.addListener(() => {
        void forgetQuoraRuntimeActivation('browser-startup')
        void resetQueueWakeupMetricsEpochAfterLoad('browser-startup', {deferUntilQuora: true})
    })
}
else {
    browser.runtime.onStartup.addListener(() => {
        void forgetQuoraRuntimeActivation('browser-startup')
        void resetQueueWakeupMetricsEpochAfterLoad('browser-startup', {deferUntilQuora: true})
    })
}

if(browser.alarms?.onAlarm) {
    browser.alarms.onAlarm.addListener(async alarm => {
        if(alarm?.name === COORDINATOR_RESUME_ALARM_NAME) {
            if(isSuppressedStaleCoordinatorResumeAlarm(alarm)) {
                incrementQueueWakeupMetric('pump.alarmStale')
                return null
            }
            if(!await ensureQuoraRuntimeActivatedForScheduler('resume-alarm-existing-quora-session')) {
                void browser.alarms?.clear?.(COORDINATOR_RESUME_ALARM_NAME).catch(() => false)
                return null
            }
            incrementQueueWakeupMetric('pump.alarmFired')
            return runScheduledCoordinatorQueueResume('resume-alarm').catch(() => null)
        }

        if(alarm?.name === COORDINATOR_STORED_WORK_REPAIR_ALARM_NAME) {
            if(isSuppressedStaleStoredWorkRepairAlarm(alarm)) {
                incrementQueueWakeupMetric('repair.alarmStale')
                return null
            }
            if(!await ensureQuoraRuntimeActivatedForScheduler('repair-alarm-existing-quora-session')) {
                void browser.alarms?.clear?.(COORDINATOR_STORED_WORK_REPAIR_ALARM_NAME).catch(() => false)
                return null
            }
            incrementQueueWakeupMetric('repair.alarmFired')
            if(storedWorkRepairTimeout) {
                clearTimeout(storedWorkRepairTimeout)
                storedWorkRepairTimeout = null
                storedWorkRepairDueAt = 0
            }
            return runStoredWorkRepairTick('stored-work-repair-alarm').catch(() => null)
        }

        if(alarm?.name === PERSISTENT_FAILED_RETRY_ALARM_NAME) {
            if(!await ensureQuoraRuntimeActivatedForScheduler('retry-alarm-existing-quora-session')) {
                void browser.alarms?.clear?.(PERSISTENT_FAILED_RETRY_ALARM_NAME).catch(() => false)
                return null
            }
            void runPersistentFailedRetryTick()
        }
    })
}

browser.tabs.onRemoved.addListener(tabId => {
    if(normalizeTabId(tabId) === normalizeTabId(queuedActionSurfaceAnchorTabId)) {
        resetQueuedWorkerActionSurface('anchor-removed')
    }

    if(tabId === coordinatorTabId) {
        void forgetCoordinatorTabId(tabId)
    }
    else {
        void forgetRemovedCoordinatorTabId(tabId)
    }

    const detached = detachQueuedTabRuntimeState(tabId, 'tab-removed')

    void ownedTabIdsReady.then(async () => {
        const metadata = detached.metadata
        const isOwnerTab = detached.wasOwnerTab
        const wasOwnedChild = detached.wasOwnedChild
        if(metadata?.profileHref) {
            const progressRecord = profileNukeProgress?.[normalizeQuoraProfileUrl(metadata.profileHref)] || null
            const shouldInterruptClosedTransient =
                progressRecord &&
                !isTerminalProfileNukeRecord(progressRecord) &&
                isTransientProfileNukeStatus(progressRecord.status) &&
                !metadata?.closeRequestedAt &&
                !metadata?.retryRequestedAt

            const patch = {
                ...(shouldInterruptClosedTransient ? {
                    status: 'interrupted',
                    finalError: progressRecord?.finalError || (
                        metadata?.closeReason
                            ? `Queued tab closed before reaching a terminal state (${metadata.closeReason})`
                            : 'Queued tab closed before reaching a terminal state'
                    )
                } : {}),
                tabClosedAt: Date.now(),
                closedByExtension: !!metadata.closeRequestedAt,
                closeReason: metadata.closeReason || '',
                event: 'Queued tab closed'
            }
            void recordCoordinatorJobProgress(metadata.profileHref, patch, {senderTabId: tabId})
        }
        else if(metadata?.coordinatorKey) {
            const closeReason = `${metadata.closeReason || ''}`.trim()
            const pausedClose = /pause-request/.test(closeReason)
            if(!pausedClose) {
                void terminalizeCoordinatorKeyOnlyItem(metadata.coordinatorKey, {
                    status: metadata.closeRequestedAt ? 'canceled' : 'failed',
                    outcome: metadata.closeRequestedAt ? 'paused' : 'timeout',
                    error: metadata.closeRequestedAt
                        ? 'Queued profile-resolution tab closed by extension before resolving a profile'
                        : 'Queued profile-resolution tab closed before resolving a profile',
                    reason: closeReason || 'profile-resolution-tab-closed',
                    expectedAttemptId: metadata.attemptId || '',
                    expectedAttemptNumber: metadata.attemptNumber || 0
                })
            }
        }
        void restoreOwnerTabFocus(metadata, tabId)
        if(isOwnerTab) {
            void stopOwnerNukes(tabId, {
                closeOwnedTabs: true,
                reason: 'owner-tab-closed'
            })
        }
        pausedQueuedOwners.delete(tabId)
        void releaseQueuedTab(tabId, {
            runtimeDetached: true,
            metadata,
            wasActive: detached.wasActive,
            foregroundLeaseReleased: detached.foregroundLeaseReleased
        }).catch(() => null)
        if(metadata?.profileHref || metadata?.coordinatorKey || isOwnerTab || wasOwnedChild) {
            scheduleStoredWorkRepair(1000, {
                reason: 'tab-removed',
                edgeTriggered: true
            })
        }
    })
})

async function terminalizeQueuedTabNonProfileLandingFromMetadata(tabId, expectedMetadata = {}, landingUrl = '') {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId || !expectedMetadata?.profileHref) return false

    const metadata = getQueuedTabMetadata(normalizedTabId)
    if(!metadata) return false
    if(normalizeQuoraProfileUrl(metadata.profileHref || '') !== normalizeQuoraProfileUrl(expectedMetadata.profileHref || '')) return false
    const expectedAttemptId = getAttemptIdFromValue(expectedMetadata)
    const expectedAttemptNumber = getAttemptNumberFromValue(expectedMetadata)
    if(expectedAttemptId && getAttemptIdFromValue(metadata) !== expectedAttemptId) return false
    if(expectedAttemptNumber && getAttemptNumberFromValue(metadata) !== expectedAttemptNumber) return false

    let tab = null
    try {
        tab = await browser.tabs.get(normalizedTabId)
    }
    catch {
        tab = null
    }
    const currentLandingUrl = `${tab?.url || landingUrl || metadata.lastUrl || ''}`.trim()
    if(!isNonProfileQuoraHttpLandingUrl(currentLandingUrl)) return false

    const result = await terminalizeActiveCoordinatorNonProfileLanding(
        metadata.coordinatorKey || metadata.profileHref,
        currentLandingUrl,
        {
            reason: 'repair',
            expectedAttemptId: getAttemptIdFromValue(metadata),
            expectedAttemptNumber: getAttemptNumberFromValue(metadata),
            reconcileReason: 'tab-non-profile-landing'
        }
    )
    if(!result?.changed) return false

    incrementQueueWakeupMetric('job.nonProfileLanding')
    await releaseQueuedTabAndCleanup(normalizedTabId, {awaitFill: true})
    if(tab && isSafeToCloseNonProfileLandingTab({tabId: normalizedTabId}, metadata, tab)) {
        await browser.tabs.remove(normalizedTabId).catch(() => {})
    }
    else {
        await browser.tabs.remove(normalizedTabId).catch(() => {})
    }
    return true
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const observedUrl = `${changeInfo.url || tab?.url || ''}`.trim()
    if(isQuoraRuntimeUrl(observedUrl)) {
        markQuoraRuntimeActivated('quora-tab-updated')
    }

    const metadata = getQueuedTabMetadata(tabId)
    if(metadata && changeInfo.status === 'complete') {
        scheduleQueuedTabContentScriptEnsure(tabId, 'tab-load-complete')
    }

    if(metadata?.profileHref) {
        const lastUrl = `${observedUrl || metadata.lastUrl || ''}`.trim()
        if(lastUrl) {
            const errorPageUrl = getErrorPageUrl(lastUrl)
            const resolvedProfileHref = normalizeQuoraProfileUrl(lastUrl) || ''
            const remappedFromRequested = !!(
                metadata.profileHref &&
                resolvedProfileHref &&
                resolvedProfileHref !== metadata.profileHref
            )
            setQueuedTabMetadata(tabId, {lastUrl})
            void recordCoordinatorJobProgress(metadata.profileHref, {
                lastUrl,
                resolvedProfileHref,
                remappedFromRequested,
                errorPageUrl,
                event: changeInfo.url ? `Tab navigated to ${lastUrl}` : ''
            })

            if(errorPageUrl && /^(?:chrome|edge|about|moz-extension|chrome-error):/i.test(errorPageUrl)) {
                const closeRequestedAt = markQueuedTabClosing(tabId, 'browser-error-page')
                void releaseQueuedTab(tabId)
                void recordCoordinatorJobProgress(metadata.profileHref, {
                    status: 'error-page',
                    finalError: 'Queued tab navigated to a browser error page',
                    errorPageUrl,
                    closeRequestedAt,
                    event: 'Queued tab closed after navigating to a browser error page'
                })
                if(isBrowserTabId(metadata.ownerTabId)) {
                    void sendTabMessage(metadata.ownerTabId, {
                        status: 'owner-nuke-url-failed',
                        url: metadata.profileHref,
                        reason: 'Queued tab navigated to a browser error page'
                    })
                }
                void browser.tabs.remove(tabId).catch(() => {})
                return
            }
            if(changeInfo.status === 'complete' &&
                !metadata.resolveProfileFromPage &&
                !isProfileResolutionMode(metadata.resolutionMode || '') &&
                isNonProfileQuoraHttpLandingUrl(lastUrl)) {
                void terminalizeQueuedTabNonProfileLandingFromMetadata(tabId, metadata, lastUrl)
                return
            }
        }
    }

    if(changeInfo.status !== 'loading' || tabId === coordinatorTabId) return

    pausedQueuedOwners.add(tabId)
    const canceledUrls = cancelQueuedOwnerActions(tabId, 'nuke')
    rememberCanceledOwnerUrls(tabId, canceledUrls)
})

browser.storage.onChanged.addListener((changes, areaName) => {
    if(areaName !== 'local') return

    if(quoraRuntimeActivated && changes?.[COORDINATOR_RETRY_FAILED_ENABLED_KEY]?.newValue) {
        void restoreCoordinatorPageForPersistentRetry()
    }
    else if(changes?.[COORDINATOR_RETRY_FAILED_ENABLED_KEY]) {
        clearPersistentFailedRetry()
    }
    if(quoraRuntimeActivated && hasStoredCoordinatorWorkInQueueView(changes?.[COORDINATOR_QUEUE_VIEW_KEY]?.newValue || null)) {
        scheduleStoredWorkRepair(STORED_WORK_REPAIR_INTERVAL_MS, {
            reason: 'storage-queue-view-changed'
        })
    }

    if(!changes?.[PROFILE_NUKE_PROGRESS_VIEW_KEY]) return

    const oldProgress = normalizeProfileNukeProgressView(changes[PROFILE_NUKE_PROGRESS_VIEW_KEY].oldValue || null).records
    const nextProgress = normalizeProfileNukeProgressView(changes[PROFILE_NUKE_PROGRESS_VIEW_KEY].newValue || null).records
    const changedProgress = getChangedProfileProgressRecords(oldProgress, nextProgress)
    if(Object.keys(nextProgress).length) {
        const mergedProgress = {
            ...profileNukeProgress
        }
        for(const [profileHref, record] of Object.entries(nextProgress)) {
            mergedProgress[profileHref] = mergeStoredProfileProgressRecord(
                mergedProgress[profileHref] || null,
                record,
                profileHref
            )
        }
        profileNukeProgress = mergedProgress
    }
    const terminalChangedProgress = Object.fromEntries(
        Object.entries(changedProgress)
            .filter(([, record]) => isTerminalProfileNukeRecord(record))
    )
    if(quoraRuntimeActivated && Object.keys(terminalChangedProgress).length) {
        scheduleStoredWorkRepair(1000, {
            reason: 'terminal-progress',
            edgeTriggered: true
        })
    }
})

function normalizeContentPageStateUrl(value = '') {
    try {
        const url = new URL(`${value || ''}`)
        url.hash = ''
        return url.href
    }
    catch {
        return `${value || ''}`.split('#')[0]
    }
}

function getCoordinatorItemStateSources(item = null) {
    const sources = []
    if(item?.source && typeof item.source === 'object') sources.push(item.source)
    if(Array.isArray(item?.sources)) {
        sources.push(...item.sources.filter(source => source && typeof source === 'object'))
    }
    if(Array.isArray(item?.evidence)) {
        for(const evidence of item.evidence) {
            if(!evidence || typeof evidence !== 'object' || !evidence.sourcePageUrl) continue
            sources.push({
                type: 'space-feed',
                pageUrl: evidence.sourcePageUrl
            })
        }
    }
    return sources
}

function shouldIncludeCoordinatorItemForContentPage(itemKey = '', item = null, request = {}, profileHrefSet = new Set()) {
    if(!item || typeof item !== 'object') return false

    const profileHref = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
    if(profileHref && profileHrefSet.has(profileHref)) return true

    const requestRunId = `${request.runId || ''}`.trim()
    if(requestRunId && `${item.runId || ''}` === requestRunId) return true

    const requestSourcePageUrl = normalizeContentPageStateUrl(request.sourcePageUrl || request.url || '')
    const requestSearchQuery = `${request.searchQuery || ''}`.trim().toLowerCase()
    if(!requestSourcePageUrl && !requestSearchQuery) return false

    return getCoordinatorItemStateSources(item).some(source => {
        const sourceUrl = normalizeContentPageStateUrl(source?.pageUrl || source?.sourcePageUrl || '')
        if(requestSourcePageUrl && sourceUrl && sourceUrl === requestSourcePageUrl) return true
        return !!(
            requestSearchQuery &&
            `${source?.type || ''}` === 'profile-search' &&
            `${source?.searchQuery || ''}`.trim().toLowerCase() === requestSearchQuery
        )
    })
}

function shouldIncludeProfileProgressForContentPage(profileHref = '', record = null, request = {}, profileHrefSet = new Set()) {
    const href = normalizeQuoraProfileUrl(record?.profileHref || profileHref || '')
    if(!href) return false
    if(profileHrefSet.has(href)) return true

    const requestRunId = `${request.runId || ''}`.trim()
    return !!(requestRunId && `${record?.runId || ''}` === requestRunId)
}

function normalizeCoordinatorContentQueueIndex(index = null) {
    if(!index || typeof index !== 'object' || !Array.isArray(index.items)) {
        return {
            version: 0,
            updatedAt: 0,
            total: 0,
            itemLimit: 0,
            truncated: false,
            items: []
        }
    }

    return {
        version: Number.parseInt(index.version, 10) || 0,
        updatedAt: Number.parseInt(index.updatedAt, 10) || 0,
        total: Number.parseInt(index.total, 10) || index.items.length,
        itemLimit: Number.parseInt(index.itemLimit, 10) || index.items.length,
        truncated: index.truncated === true,
        items: index.items.filter(item => item && typeof item === 'object')
    }
}

function normalizeCoordinatorContentSourceIndexRecords(shards = {}, request = {}) {
    const sourceKeys = new Set(getCoordinatorContentSourceKeysForRequest(request))
    const scopedQueue = {}
    if(!sourceKeys.size) return scopedQueue

    for(const shard of Object.values(shards || {})) {
        const records = shard && typeof shard === 'object' && shard.records && typeof shard.records === 'object'
            ? shard.records
            : {}
        for(const sourceKey of sourceKeys) {
            const items = Array.isArray(records?.[sourceKey]?.items) ? records[sourceKey].items : []
            for(const item of items) {
                if(!item || typeof item !== 'object') continue
                const itemKey = item.storageKey || item.profileHref || item.targetProfileHref || item.id || ''
                if(!itemKey) continue
                scopedQueue[itemKey] = item
            }
        }
    }

    return scopedQueue
}

function normalizeProfileNukeProgressView(view = null) {
    if(!view || typeof view !== 'object' || !view.records || typeof view.records !== 'object') {
        return {
            version: 0,
            updatedAt: 0,
            total: 0,
            recordLimit: 0,
            truncated: false,
            records: {}
        }
    }

    return {
        version: Number.parseInt(view.version, 10) || 0,
        updatedAt: Number.parseInt(view.updatedAt, 10) || 0,
        total: Number.parseInt(view.total, 10) || Object.keys(view.records).length,
        recordLimit: Number.parseInt(view.recordLimit, 10) || Object.keys(view.records).length,
        truncated: view.truncated === true,
        records: normalizeStoredProfileNukeProgress(view.records)
    }
}

function hasMissingRequestedProfileProgressShard(progressView = null, shardDefaults = {}, stored = {}) {
    if(progressView?.truncated !== true) return false

    return Object.keys(shardDefaults || {}).some(key => {
        const shard = stored?.[key]
        return !shard ||
            typeof shard !== 'object' ||
            (Number.parseInt(shard.version, 10) || 0) < 1 ||
            !shard.records ||
            typeof shard.records !== 'object'
    })
}

function hasMissingRequestedCoordinatorSourceShard(queueIndex = null, sourceShardDefaults = {}, stored = {}) {
    if(queueIndex?.truncated !== true) return false

    return Object.keys(sourceShardDefaults || {}).some(key => {
        const shard = stored?.[key]
        return !shard ||
            typeof shard !== 'object' ||
            (Number.parseInt(shard.version, 10) || 0) < 1 ||
            !shard.records ||
            typeof shard.records !== 'object'
    })
}

function isContentPageStateProjectionMissing(queueIndex = null, progressView = null, shardDefaults = {}, stored = {}, sourceShardDefaults = {}) {
    return (Number.parseInt(queueIndex?.version, 10) || 0) < 2 ||
        (Number.parseInt(progressView?.version, 10) || 0) < 2 ||
        hasMissingRequestedCoordinatorSourceShard(queueIndex, sourceShardDefaults, stored) ||
        hasMissingRequestedProfileProgressShard(progressView, shardDefaults, stored)
}

function shouldLoadFullQueueForTruncatedContentPageState(queueIndex = null, request = {}, profileHrefs = [], scopedQueue = {}) {
    if(queueIndex?.truncated !== true) return false

    const scopedProfileHrefs = new Set(
        Object.entries(scopedQueue || {})
            .map(([itemKey, item]) => getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey))
            .filter(Boolean)
    )

    return getNormalizedProfileHrefList(profileHrefs || [])
        .some(href => !scopedProfileHrefs.has(href))
}

async function loadScopedCoordinatorQueueFallbackForContentPage(request = {}, profileHrefSet = new Set()) {
    const currentAuthorityState = await loadCoordinatorQueueProjection({
        metricPath: 'contentPageState.queueFallback.truncated'
    })
    const queue = currentAuthorityState.queue
    const scopedQueue = {}

    for(const [itemKey, item] of Object.entries(queue)) {
        if(!shouldIncludeCoordinatorItemInContentQueueIndex(item)) continue
        if(!shouldIncludeCoordinatorItemForContentPage(itemKey, item, request, profileHrefSet)) continue
        scopedQueue[itemKey] = summarizeCoordinatorContentQueueItem(itemKey, item)
    }

    return scopedQueue
}

async function rebuildContentPageStateProjectionFromFullStorage(reason = 'missing') {
    const currentAuthorityState = await loadCoordinatorQueueProjection({
        metricPath: `contentPageState.compatBuild.${reason}`
    })
    const stored = await metricStorageGet({
        [PROFILE_NUKE_PROGRESS_KEY]: {}
    }, {metricPath: `contentPageState.compatBuild.${reason}.progress`})
    const queue = currentAuthorityState.queue
    const progress = normalizeStoredProfileNukeProgress(stored[PROFILE_NUKE_PROGRESS_KEY] || {})
    const queueIndex = buildCoordinatorContentQueueIndex(queue)
    const sourceShards = buildCoordinatorContentSourceIndexShardPayload(queue)
    const progressView = buildProfileNukeProgressView(progress)
    const progressShards = buildProfileNukeProgressShardPayload(progress)

    await metricStorageSet({
        [COORDINATOR_CONTENT_QUEUE_INDEX_KEY]: queueIndex,
        ...sourceShards,
        [PROFILE_NUKE_PROGRESS_VIEW_KEY]: progressView,
        ...progressShards
    }, {metricPath: `contentPageState.compatBuild.${reason}`})

    return {
        queueIndex,
        sourceShards,
        progressView,
        progressShards
    }
}

async function getContentPageCoordinatorState(request = {}, sender = {}) {
    const profileHrefs = getNormalizedProfileHrefList(request.profileHrefs || request.urls || [])
        .slice(0, 250)
    const profileHrefSet = new Set(profileHrefs)
    const shardDefaults = getProfileNukeProgressShardDefaults(profileHrefs)
    const sourceShardDefaults = getCoordinatorContentSourceIndexShardDefaults(request)

    const stored = await metricStorageGet({
        [COORDINATOR_CONTENT_QUEUE_INDEX_KEY]: null,
        [PROFILE_NUKE_PROGRESS_VIEW_KEY]: null,
        ...sourceShardDefaults,
        ...shardDefaults
    }, {metricPath: 'contentPageState.scoped'})
    let queueIndex = normalizeCoordinatorContentQueueIndex(stored[COORDINATOR_CONTENT_QUEUE_INDEX_KEY])
    let sourceQueue = normalizeCoordinatorContentSourceIndexRecords(
        Object.fromEntries(Object.keys(sourceShardDefaults).map(key => [key, stored[key]])),
        request
    )
    let progressView = normalizeProfileNukeProgressView(stored[PROFILE_NUKE_PROGRESS_VIEW_KEY])
    let shardProgress = normalizeProfileNukeProgressShardRecords(
        Object.fromEntries(Object.keys(shardDefaults).map(key => [key, stored[key]]))
    )

    if(isContentPageStateProjectionMissing(queueIndex, progressView, shardDefaults, stored, sourceShardDefaults)) {
        const rebuilt = await rebuildContentPageStateProjectionFromFullStorage('missing-projection')
        queueIndex = normalizeCoordinatorContentQueueIndex(rebuilt.queueIndex)
        sourceQueue = normalizeCoordinatorContentSourceIndexRecords(
            Object.fromEntries(Object.keys(sourceShardDefaults).map(key => [key, rebuilt.sourceShards?.[key]])),
            request
        )
        progressView = normalizeProfileNukeProgressView(rebuilt.progressView)
        shardProgress = normalizeProfileNukeProgressShardRecords(
            Object.fromEntries(Object.keys(shardDefaults).map(key => [key, rebuilt.progressShards?.[key]]))
        )
    }

    const scopedQueue = {}
    const scopedProgress = {}

    for(const item of queueIndex.items) {
        const itemKey = item.storageKey || item.profileHref || item.targetProfileHref || item.id || ''
        if(!shouldIncludeCoordinatorItemForContentPage(itemKey, item, request, profileHrefSet)) continue
        scopedQueue[itemKey] = item
    }
    Object.assign(scopedQueue, sourceQueue)
    if(shouldLoadFullQueueForTruncatedContentPageState(queueIndex, request, profileHrefs, scopedQueue)) {
        Object.assign(scopedQueue, await loadScopedCoordinatorQueueFallbackForContentPage(request, profileHrefSet))
    }
    for(const [profileHref, record] of Object.entries({
        ...progressView.records,
        ...shardProgress
    })) {
        if(!shouldIncludeProfileProgressForContentPage(profileHref, record, request, profileHrefSet)) continue
        scopedProgress[profileHref] = record
    }

    return {
        scoped: true,
        pageType: request.pageType || '',
        profileHrefCount: profileHrefs.length,
        coordinatorQueue: scopedQueue,
        profileNukeProgress: scopedProgress,
        queueRows: Object.keys(scopedQueue).length,
        progressRows: Object.keys(scopedProgress).length,
        senderTabId: sender?.tab?.id || null
    }
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    markQuoraRuntimeActivatedFromRequest(request, sender, `message:${request?.action || 'unknown'}`)

    if(request.action === 'create-tab') {
        return createOwnedTab({
            url: request.url,
            ownerTabId: sender.tab?.id || null,
            ownerWindowId: sender.tab?.windowId || null
        }).then(tab => {
            if(request.tabAction) {
                pendingTabActions.set(tab.id, {
                    action: request.tabAction,
                    targetUrl: request.url || ''
                })
            }
            return {tabId: tab.id}
        })
    }
    else if(request.action === 'enqueue-coordinator-items') {
        return enqueueCoordinatorItems(request, sender)
    }
    else if(request.action === 'open-coordinator') {
        return openCoordinatorPage({
            windowId: sender.tab?.windowId || null,
            active: request.active === true
        })
    }
    else if(request.action === 'coordinator-page-ready') {
        if(!quoraRuntimeActivated) return Promise.resolve({
            displayOnly: true,
            requiresQuoraVisit: true
        })

        return dedupeCoordinatorTabs(sender.tab?.id || null).then(coordinator => ({
            ...(coordinator || {}),
            displayOnly: true
        }))
    }
    else if(request.action === 'pause-coordinator-nukes') {
        return pauseCoordinatorNukes()
    }
    else if(request.action === 'resume-paused-coordinator-nukes') {
        return resumePausedCoordinatorNukes()
    }
    else if(request.action === 'cancel-coordinator-current-work') {
        return cancelCoordinatorCurrentWork()
    }
    else if(request.action === 'cancel-coordinator-current-work-item') {
        return cancelCoordinatorCurrentWorkItem(request)
    }
    else if(request.action === 'repair-coordinator-storage') {
        if(!quoraRuntimeActivated) {
            return ensureQuoraRuntimeActivatedForScheduler('repair-existing-quora-tab')
                .then(observed => {
                    if(!observed) return makeQuoraRuntimeNotActivatedResult('quora-runtime-not-activated')

                    scheduleStoredWorkRepair(1000, {
                        reason: 'dashboard-repair-request',
                        edgeTriggered: true
                    })
                    void kickCoordinatorQueueResume('dashboard-repair-request').catch(() => null)
                    return {
                        recovered: false,
                        reason: 'dashboard-repair-request-scheduled',
                        fallbackScheduled: true,
                        repairScheduled: true,
                        scheduledOnly: true
                    }
                })
        }

        scheduleStoredWorkRepair(1000, {
            reason: 'dashboard-repair-request',
            edgeTriggered: true
        })
        void kickCoordinatorQueueResume('dashboard-repair-request').catch(() => null)
        return Promise.resolve({
            recovered: false,
            reason: 'dashboard-repair-request-scheduled',
            fallbackScheduled: true,
            repairScheduled: true,
            scheduledOnly: true
        })
    }
    else if(request.action === 'refresh-coordinator-queue-view') {
        return refreshCoordinatorQueueViewForDashboard(request.reason || 'dashboard-refresh')
    }
    else if(request.action === 'get-coordinator-queue-accounting') {
        return getCoordinatorQueueAccounting(request)
    }
    else if(request.action === 'refresh-queue-wakeup-metrics-view') {
        return refreshQueueWakeupMetricsViewForDashboard(request.reason || 'dashboard-refresh')
    }
    else if(request.action === 'reset-queue-wakeup-metrics') {
        return resetQueueWakeupMetricsEpochAfterLoad('manual')
    }
    else if(request.action === 'get-content-page-coordinator-state') {
        return getContentPageCoordinatorState(request, sender)
    }
    else if(request.action === 'resume-coordinator-queue') {
        scheduleStoredWorkRepair(1000, {
            reason: 'dashboard-resume',
            edgeTriggered: true
        })
        return kickCoordinatorQueueResume('dashboard-resume')
    }
    else if(request.action === 'retry-coordinator-failed') {
        return retryCoordinatorFailedItems(request, sender)
    }
    else if(request.action === 'requeue-coordinator-failed') {
        return requeueCoordinatorFailedItems(request, sender)
    }
    else if(request.action === 'claim-tab-action') {
        return claimPendingTabAction(sender)
    }
    else if(request.action === 'resolve-queued-profile-target') {
        return resolveQueuedProfileTarget(request, sender)
    }
    else if(request.action === 'resolve-queued-profile-target-failed') {
        return markQueuedProfileResolutionUnresolved(request, sender)
    }
    else if(request.action === 'promote-queued-tab') {
        return validateQueuedTabAttempt(sender, request, {message: 'Ignored stale foreground promotion request'})
            .then(valid => valid
                ? promoteQueuedTab(sender.tab?.id || null, request.reason || '')
                : {promoted: false, staleAttempt: true})
    }
    else if(request.action === 'activate-confirmation-in-page-world') {
        return activateConfirmationElementInPageWorld(request, sender)
    }
    else if(request.action === 'begin-profile-action') {
        return beginCoordinatorProfileAction(request, sender)
    }
    else if(request.action === 'request-action-lease') {
        return requestCoordinatorActionLease(request, sender)
    }
    else if(request.action === 'heartbeat-action-lease') {
        return heartbeatCoordinatorActionLease(request, sender)
    }
    else if(request.action === 'release-action-lease') {
        return releaseCoordinatorActionLease(request, sender)
    }
    else if(request.action === 'release-job-tab') {
        const tabId = sender.tab?.id
        if(!tabId) return Promise.resolve({released: false})

        return validateQueuedTabAttempt(sender, request, {message: 'Ignored stale job tab release request'})
            .then(async valid => {
                if(!valid) return {released: false, staleAttempt: true}
                await releaseQueuedTab(tabId, {awaitFill: true})
                return {released: true}
            })
    }
    else if(request.action === 'cancel-queued-owner-nukes') {
        const ownerTabId = sender.tab?.id || null
        const canceledUrls = consumeCanceledOwnerUrls(ownerTabId)
            .concat(cancelQueuedOwnerActions(ownerTabId, 'nuke'))
        return Promise.resolve({
            canceledUrls
        })
    }
    else if(request.action === 'pause-owner-nukes') {
        const ownerTabId = sender.tab?.id || null
        pausedQueuedOwners.add(ownerTabId)
        const canceledUrls = cancelQueuedOwnerActions(ownerTabId, 'nuke')
        return Promise.resolve({
            canceledUrls
        })
    }
    else if(request.action === 'close-tab') {
        const tabId = sender.tab?.id

        if(tabId) {
            return validateQueuedTabAttempt(sender, request, {message: 'Ignored stale close-tab request'})
                .then(async valid => {
                    if(!valid) return {closed: false, staleAttempt: true}
                    const shouldCleanupWorkerSurface = isQueuedWorkerActionSurfaceTab(
                        sender.tab || null,
                        getQueuedTabMetadata(tabId)
                    )
                    markQueuedTabClosing(tabId, 'content-close-request')
                    await releaseQueuedTab(tabId, {awaitFill: true})
                    if(shouldCleanupWorkerSurface) {
                        scheduleQueuedWorkerActionSurfaceCleanup('idle-after-release')
                    }
                    return browser.tabs.remove(tabId)
                        .then(() => ({closed: true}))
                        .catch(() => ({closed: false}))
                })
        }

        return Promise.resolve({closed: false})
    }
    else if(request.action === 'record-nuke-progress') {
        return recordProfileNukeProgressFromRequest(request, sender)
    }
    else if(request.action === 'record-job-milestone') {
        return recordJobProgressFromRequest(request, sender, {
            expectTerminal: false
        })
    }
    else if(request.action === 'record-job-terminal') {
        return recordJobProgressFromRequest(request, sender, {
            expectTerminal: true
        })
    }
    else if(request.action === 'record-nuke-progress-batch') {
        return recordProfileNukeProgressBatchFromRequest(request, sender)
    }
    else if(request.action === 'clear-profile-nuke-state') {
        return clearProfileNukeState(request.profileHref || request.href || '', request.reason || '')
    }
    else if(request.action === 'normalize-profile-nuke-progress') {
        return normalizeProfileNukeProgressStorage()
    }
    else if(request.action === 'settle-terminal-coordinator-items') {
        return settleTerminalCoordinatorItems({
            profileHrefs: request.profileHrefs || request.urls || []
        })
    }
    else if(request.action === 'remove-pending-space-feed-urls') {
        return removePendingSpaceFeedUrls(request.urls || []).then(result => ({
            changed: !!result?.changed,
            pendingPosts: result?.pendingPosts || null
        }))
    }
    else if(request.action === 'remove-pending-space-feed-entries') {
        return removePendingSpaceFeedEntries(request.postKeys || []).then(result => ({
            changed: !!result?.changed,
            pendingPosts: result?.pendingPosts || null
        }))
    }
    else if(request.action === 'confirm-space-feed-profiles-blocked') {
        return confirmSpaceFeedProfilesBlocked(request.profileHrefs || request.urls || []).then(result => ({
            confirmed: !!result?.confirmed,
            pendingPosts: result?.pendingPosts || null,
            nukedPosts: result?.nukedPosts || null
        }))
    }
    else if(request.action === 'get-owned-nuke-status') {
        return ownedTabIdsReady.then(async () => {
            return getOwnedNukeStatus(sender.tab?.id || null, {
                runId: request.runId || ''
            })
        })
    }
    else if(request.action === 'cleanup-owned-nuke-status') {
        return ownedTabIdsReady.then(async () => {
            scheduleStoredWorkRepair(1000, {reason: 'owned-nuke-status-cleanup'})
            await getLiveOwnedTabIds(sender.tab?.id || null)
            return getOwnedNukeStatus(sender.tab?.id || null, {
                runId: request.runId || '',
                cleanup: true
            })
        })
    }
    else if(request.action === 'sweep-owned-blocked-profile-tabs') {
        return sweepOwnedBlockedProfileTabs(sender.tab?.id || null)
    }
})

browser.webRequest.onCompleted.addListener(details => {
    if(details.url.match(/TribePeopleModalQuery/i)) {
        sendTabMessage(details.tabId, {status: 'space-people-modal-loaded'})
    }
    else if(details.url.match(/TribeContributorOrHigherListQuery/i)) {
        sendTabMessage(details.tabId, {status: 'space-contributors-loaded'})
    }
    else if(details.url.match(/UserProfileFollowersModalQuery/i)) {
        sendTabMessage(details.tabId, {status: 'profile-followers-modal-loaded'})
    }
    else if(details.url.match(/UserProfileFollowers_ProfileTopics_Query/i)) {
        sendTabMessage(details.tabId, {status: 'profile-followers-loaded'})
    }
    else if(details.url.match(/UserProfileFollowingPeople_ProfileTopics_Query/i)) {
        sendTabMessage(details.tabId, {status: 'profile-following-loaded'})
    }
    else if(details.url.match(/userBlockModalInnerUtils_userSetBlock_Mutation/i)) {
        sendTabMessage(details.tabId, {status: 'profile-block-updated'})
    }
    else if(details.url.match(/ContentLogMainQuery/i)) {
        sendTabMessage(details.tabId, {status: 'question-log-loaded'})
    }
    else if(details.url.match(/QuestionCollapsedAnswerLoaderQuery/i)) {
        sendTabMessage(details.tabId, {status: 'question-page-loaded'})
    }
},
{
    urls: [
        'https://*.quora.com/graphql/gql_para_POST?q=TribePeopleModalQuery',
        'https://*.quora.com/graphql/gql_para_POST?q=TribeContributorOrHigherListQuery',

        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowersModalQuery',
        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowers_ProfileTopics_Query',
        'https://www.quora.com/graphql/gql_POST?q=userBlockModalInnerUtils_userSetBlock_Mutation',
        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowingPeople_ProfileTopics_Query',

        'https://www.quora.com/graphql/gql_para_POST?q=ContentLogMainQuery',
        'https://www.quora.com/graphql/gql_para_POST?q=QuestionCollapsedAnswerLoaderQuery'
    ]
})

void startQueueWakeupMetricsBackedStartupWork()
