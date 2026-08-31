// Storage payload/latency metric recording helpers extracted from sw.js
// (decomposition Slice 4). These classify storage keys/paths/reasons and
// record byte/row/latency counters for them into the queue-wakeup-metrics
// shape -- pure or near-pure functions with no async work of their own,
// and (per a grep of the moved bodies) no direct Date.now()/environment-
// global reads, so no clock dep is needed here unlike Slices 2-3.
//
// A sibling to swQueueWakeupMetricsShape.js (Slices 2-3), not a fold into
// it: nothing in this cluster calls into that module's functions, and
// nothing in that module calls into this one, so there's no circular
// dependency forcing a shared closure the way there was between Slices 2
// and 3. The recording primitives this cluster calls into
// (incrementQueueWakeupMetric, recordQueueWakeupMetricMax,
// setActiveStorageMetricDetail, incrementActiveStorageMetricDetail) are
// threaded in as deps -- they're that module's exports, destructured back
// onto bare names in sw.js, same as every other still-ambient sw.js
// function this module depends on (getActiveStorageContext).
//
// notifyCoordinatorAuthorityPersistedSnapshot reads coordinatorAuthoritySnapshotObserver,
// a module-level `let` in sw.js assigned once well after this module is
// constructed (coordinatorAuthority.absorbPersistedSnapshot is wired up
// later in sw.js's initialization order). It's threaded through as a live
// getSnapshotObserver() accessor, following the same get/set-accessor
// convention swQueueWakeupMetricsShape.js uses for state it doesn't own,
// so this module always sees the current value at call time rather than
// whatever was assigned (or not yet assigned) at construction time.

function createStorageMetrics(deps = {}) {
    const {
        COORDINATOR_QUEUE_KEY,
        COORDINATOR_QUEUE_WAL_KEY,
        COORDINATOR_QUEUE_VIEW_KEY,
        COORDINATOR_CONTENT_QUEUE_INDEX_KEY,
        COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX,
        COORDINATOR_RUNS_KEY,
        COORDINATOR_EVENTS_KEY,
        QUEUE_WAKEUP_METRICS_VIEW_KEY,
        PROFILE_NUKE_PROGRESS_VIEW_KEY,
        PROFILE_NUKE_PROGRESS_SHARD_PREFIX,
        SPACE_PENDING_NUKED_POSTS_KEY,
        SPACE_NUKED_POSTS_KEY,
        OWNED_TAB_STATE_KEY,
        COORDINATOR_PAUSED_KEY,
        COORDINATOR_PAUSE_GENERATION_KEY,
        COORDINATOR_TAB_KEY,
        QUEUE_WAKEUP_METRICS_KEY
    } = deps.constants || {}
    const {
        incrementQueueWakeupMetric,
        recordQueueWakeupMetricMax,
        incrementActiveStorageMetricDetail,
        setActiveStorageMetricDetail,
        getActiveStorageContext
    } = deps.handlers || {}
    const {
        getSnapshotObserver = () => null
    } = deps.state || {}

    const SNAPSHOT_WRITE_REASONS = new Set([
        'ordinaryMutation',
        'reconcile',
        'displayRead',
        'checkpointSwitch',
        'compaction',
        'userMemoryNonAuthority'
    ])

    function getStorageMetricKeyName(key = '') {
        if(key === COORDINATOR_QUEUE_KEY) return 'queue'
        if(key === COORDINATOR_QUEUE_WAL_KEY) return 'queueWal'
        if(`${key || ''}`.startsWith(`${COORDINATOR_QUEUE_WAL_KEY}.`)) return 'queueWal'
        if(key === COORDINATOR_QUEUE_VIEW_KEY) return 'queueView'
        if(key === COORDINATOR_CONTENT_QUEUE_INDEX_KEY) return 'contentQueueIndex'
        if(`${key || ''}`.startsWith(COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX)) return 'contentSourceIndex'
        if(key === COORDINATOR_RUNS_KEY) return 'runs'
        if(key === COORDINATOR_EVENTS_KEY) return 'events'
        if(key === QUEUE_WAKEUP_METRICS_VIEW_KEY) return 'metricsView'
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
        const storageContext = getActiveStorageContext()
        return normalizeStorageMetricPathName(
            options.metricPath ||
            options.callPath ||
            options.reason ||
            options.snapshotWriteReason ||
            storageContext?.currentPhase ||
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

    function notifyCoordinatorAuthorityPersistedSnapshot(payload = {}) {
        const snapshotObserver = getSnapshotObserver()
        if(typeof snapshotObserver !== 'function') return
        if(payload &&
            typeof payload === 'object' &&
            Object.prototype.hasOwnProperty.call(payload, COORDINATOR_QUEUE_KEY)) {
            incrementQueueWakeupMetric('coordinatorAuthority.rawQueueSnapshotObserverIgnored')
            return
        }
        try {
            snapshotObserver(payload)
        }
        catch(error) {
            incrementQueueWakeupMetric('coordinatorAuthority.snapshotObserverFailed')
        }
    }

    return {
        getStorageMetricKeyName,
        getJsonByteSize,
        getStoragePayloadRowCount,
        normalizeStorageMetricPathName,
        getStorageMetricPathName,
        recordStoragePathPayloadMetrics,
        recordStoragePathLatencyMetrics,
        normalizeSnapshotWriteReason,
        recordSnapshotWriteReasonMetrics,
        normalizeQueueWriteOperationName,
        getQueueWriteMetricReason,
        recordQueueWriteOperationMetricValue,
        recordQueueWriteOperationMetrics,
        recordStoragePayloadMetrics,
        recordStorageReadPayloadMetrics,
        notifyCoordinatorAuthorityPersistedSnapshot
    }
}

module.exports = {
    createStorageMetrics
}
