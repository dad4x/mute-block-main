// WAL recovery step for the coordinator queue (docs/queue-storage-layering.md, Phase 6 move).
//
// Replays a WAL store into the queue. It touches no storage: it works on the store it is given and reports
// its counters and diagnostics through the injected callbacks. The WAL primitives come straight from
// walSnapshotStore.js; everything that lives in sw.js (metrics, diagnostics, cloning, map normalisation,
// the codec options) is injected, so this module can be loaded and tested on its own.

const {STORED_ERROR_TEXT_MAX_CHARS} = require('./tunables')
const {
    getWalRecordsForGeneration,
    recoverProjectedState
} = require('./walSnapshotStore')

function createQueueWalRecovery(deps = {}) {
    const {
        normalizeMap,
        cloneValue,
        getJsonByteSize,
        incrementMetric,
        recordMetricMax,
        recordDiagnostic,
        codecOptions
    } = deps

    return function recoverCoordinatorQueueFromWal(snapshotQueue = {}, walStore = null) {
        const normalizedSnapshot = normalizeMap(cloneValue(snapshotQueue || {}))
        if(!walStore || typeof walStore !== 'object') {
            return {
                queue: normalizedSnapshot,
                recovered: false,
                reason: 'missing-wal'
            }
        }

        try {
            const recovered = recoverProjectedState(walStore, [], codecOptions)
            const generationId = recovered?.generationId || walStore?.meta?.activeCheckpoint
            const records = getWalRecordsForGeneration(walStore, generationId)
            const replayBytes = getJsonByteSize(records)
            const appliedCount = recovered?.projected?.applied?.length || 0
            const ignored = recovered?.projected?.ignored || []
            const ignoredCheckpointCount = ignored.filter(entry => entry?.reason === 'already-in-snapshot').length
            const checkpointCreatedAt = Number.parseInt(recovered?.checkpoint?.createdAt, 10) || 0
            if(records.length) {
                incrementMetric('coordinatorAuthority.queueWal.replayRecords', records.length)
                incrementMetric('coordinatorAuthority.queueWal.replayBytes', replayBytes)
                recordMetricMax('coordinatorAuthority.queueWal.maxReplayRecords', records.length)
                recordMetricMax('coordinatorAuthority.queueWal.maxReplayBytes', replayBytes)
            }
            if(appliedCount) incrementMetric('coordinatorAuthority.queueWal.replayApplied', appliedCount)
            if(ignored.length) incrementMetric('coordinatorAuthority.queueWal.replayIgnored', ignored.length)
            if(ignoredCheckpointCount) {
                incrementMetric('coordinatorAuthority.queueWal.replayIgnoredCheckpoint', ignoredCheckpointCount)
            }
            if(checkpointCreatedAt) {
                recordMetricMax('coordinatorAuthority.queueWal.maxCheckpointAgeMs', Math.max(0, Date.now() - checkpointCreatedAt))
            }
            recordMetricMax('coordinatorAuthority.queueWal.maxTailLength', records.length)
            const queue = normalizeMap(recovered?.projected?.state?.queue || recovered?.state?.queue || {})
            if(recovered?.recovered === true) {
                incrementMetric('coordinatorAuthority.queueWal.recovered')
                return {
                    queue,
                    recovered: true,
                    reason: '',
                    wal: recovered
                }
            }
            incrementMetric('coordinatorAuthority.queueWal.recoveryFailed')
            recordDiagnostic(
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
            incrementMetric('coordinatorAuthority.queueWal.recoveryFailed')
            recordDiagnostic(
                'coordinator-authority-queue-wal-recovery-failed',
                error?.message || 'Coordinator authority queue WAL recovery threw'
            )
            return {
                queue: normalizedSnapshot,
                recovered: false,
                reason: 'recovery-error',
                error: `${error?.message || error || 'recovery error'}`.slice(0, STORED_ERROR_TEXT_MAX_CHARS)
            }
        }
    }
}

module.exports = {
    createQueueWalRecovery
}
