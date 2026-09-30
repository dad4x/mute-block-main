const {
    appendWalRecordsToGeneration,
    buildSegmentedWalStorageDefaults,
    buildSegmentedWalStoragePayload,
    getWalRecordsForGeneration,
    getSegmentedWalSegmentKey,
    getSegmentedWalCommittedSegmentCount,
    isSegmentedWalStorageMeta,
    recoverProjectedState
} = require('./swstorage')

function requireCoordinatorQueueWalCapability(groupName = '', capabilities = {}, name = '') {
    const capability = capabilities?.[name]
    if(typeof capability !== 'function') {
        throw new Error(`Missing coordinator queue WAL ${groupName} capability: ${name}`)
    }
    return capability
}

function createCoordinatorQueueWalStore(capabilities = {}) {
    const {
        constants = {},
        metrics = {},
        authority = {}
    } = capabilities
    const {
        COORDINATOR_QUEUE_WAL_KEY,
        COORDINATOR_QUEUE_WAL_META_KEY,
        COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT,
        COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT,
        COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS
    } = constants
    const incrementQueueWakeupMetric = requireCoordinatorQueueWalCapability('metrics', metrics, 'incrementQueueWakeupMetric')
    const recordQueueWakeupMetricMax = requireCoordinatorQueueWalCapability('metrics', metrics, 'recordQueueWakeupMetricMax')
    const getJsonByteSize = requireCoordinatorQueueWalCapability('metrics', metrics, 'getJsonByteSize')
    const cloneCoordinatorAuthorityValue = requireCoordinatorQueueWalCapability('authority', authority, 'cloneCoordinatorAuthorityValue')
    const normalizeCoordinatorAuthorityRowKey = requireCoordinatorQueueWalCapability('authority', authority, 'normalizeCoordinatorAuthorityRowKey')
    const normalizeSnapshotWriteReason = requireCoordinatorQueueWalCapability('authority', authority, 'normalizeSnapshotWriteReason')
    const normalizeQueueWriteOperationName = requireCoordinatorQueueWalCapability('authority', authority, 'normalizeQueueWriteOperationName')
    const getAttemptIdFromValue = requireCoordinatorQueueWalCapability('authority', authority, 'getAttemptIdFromValue')
    const getAttemptNumberFromValue = requireCoordinatorQueueWalCapability('authority', authority, 'getAttemptNumberFromValue')
    const makeCoordinatorQueueWalCheckpoint = requireCoordinatorQueueWalCapability('authority', authority, 'makeCoordinatorQueueWalCheckpoint')
    const {
        Date: InjectedDate
    } = capabilities.runtime || {}
    if(typeof InjectedDate?.now !== 'function') {
        throw new Error('Missing coordinator queue WAL runtime capability: Date')
    }
    const now = () => InjectedDate.now()

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

    function isCoordinatorQueueWalPhysicalStorageKey(key = '') {
        return key === COORDINATOR_QUEUE_WAL_KEY || `${key || ''}`.startsWith(`${COORDINATOR_QUEUE_WAL_KEY}.`)
    }

    function getCoordinatorQueueWalPhysicalStoredPayload(stored = {}) {
        const payload = {}
        for(const [key, value] of Object.entries(stored || {})) {
            if(isCoordinatorQueueWalPhysicalStorageKey(key)) {
                payload[key] = cloneCoordinatorAuthorityValue(value)
            }
        }
        return payload
    }

    function hasCoordinatorQueueWalCommittedPhysicalSegments(meta = null, generationId = '', stored = {}) {
        if(!isSegmentedWalStorageMeta(meta)) return false
        const id = `${generationId || ''}`.trim()
        if(!id) return false

        const committedSegments = getSegmentedWalCommittedSegmentCount(meta, id)
        for(let segmentNo = 0; segmentNo < committedSegments; segmentNo += 1) {
            const key = getSegmentedWalSegmentKey(COORDINATOR_QUEUE_WAL_KEY, id, segmentNo)
            if(!Object.prototype.hasOwnProperty.call(stored || {}, key) || !stored[key]) {
                return false
            }
        }
        return true
    }

    function getCoordinatorQueueWalStorageDefaults() {
        return buildSegmentedWalStorageDefaults(null, {baseKey: COORDINATOR_QUEUE_WAL_KEY})
    }

    function canUseResidentCoordinatorQueueWalStoreForMeta(residentStore = null, meta = null) {
        if(!residentStore || typeof residentStore !== 'object') return false
        if(!isSegmentedWalStorageMeta(meta)) return false
        if(!residentStore.meta || !residentStore.checkpoints || !residentStore.wal) return false

        const residentMeta = residentStore.meta
        if(residentMeta.activeCheckpoint !== meta.activeCheckpoint) return false
        if((Number.parseInt(residentMeta.nextSeq, 10) || 0) < (Number.parseInt(meta.nextSeq, 10) || 0)) return false

        const activeCheckpoint = meta.activeCheckpoint
        if(!residentStore.checkpoints?.[activeCheckpoint]) return false
        // 2026-09-15: a fresh checkpoint (no WAL segments layered on top yet)
        // always reports the same nextSeq/activeCheckpoint/committed-segment-
        // count baseline regardless of what state it was actually built
        // from -- so two INDEPENDENTLY-built checkpoints for entirely
        // different underlying data (e.g. two hydrates of a queue that
        // changed in between, or two migrations from a raw queue snapshot)
        // are structurally indistinguishable by those fields alone. Caught
        // live by feeding this function real data for the first time: a
        // resident store cached from one hydrate was wrongly accepted for a
        // later hydrate of genuinely different data because every field
        // above still matched. checkpoints[id].stateHash is the one field
        // that actually fingerprints what's IN the checkpoint, so it's the
        // last line of defense against exactly this false-positive class.
        if(residentMeta.checkpoints?.[activeCheckpoint]?.stateHash !== meta.checkpoints?.[activeCheckpoint]?.stateHash) {
            return false
        }
        const requiredSegments = getSegmentedWalCommittedSegmentCount(meta, activeCheckpoint)
        const residentSegments = getSegmentedWalCommittedSegmentCount(residentMeta, activeCheckpoint)
        if(residentSegments < requiredSegments) return false

        return getWalRecordsForGeneration(residentStore, activeCheckpoint).length >= 0
    }

    function getCoordinatorQueueWalPhysicalPayload(store = {}, options = {}) {
        const previousMeta = options.previousMeta || null
        const previousStored = options.previousStored && typeof options.previousStored === 'object'
            ? options.previousStored
            : {}
        const hasSegmentedPreviousMeta = isSegmentedWalStorageMeta(previousMeta)
        const activeGenerationId = store?.meta?.activeCheckpoint
        const activeSegments = Array.isArray(store?.wal?.[activeGenerationId]?.segments)
            ? store.wal[activeGenerationId].segments.length
            : 0
        const previousActiveGenerationId = hasSegmentedPreviousMeta
            ? `${previousMeta?.activeCheckpoint || ''}`.trim()
            : ''
        const previousCommittedFromMeta = hasSegmentedPreviousMeta
            ? getSegmentedWalCommittedSegmentCount(previousMeta, activeGenerationId)
            : 0
        const canAppendIncrementally = hasSegmentedPreviousMeta &&
            previousActiveGenerationId === activeGenerationId &&
            hasCoordinatorQueueWalCommittedPhysicalSegments(previousMeta, activeGenerationId, previousStored)
        const previousCommitted = canAppendIncrementally ? previousCommittedFromMeta : 0
        const writeCheckpoints = options.forceWriteCheckpoints === true ||
            !hasSegmentedPreviousMeta ||
            !canAppendIncrementally
        if(hasSegmentedPreviousMeta && !canAppendIncrementally) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.segmentIncrementalInvalidated')
        }
        const payload = buildSegmentedWalStoragePayload(store, {
            baseKey: COORDINATOR_QUEUE_WAL_KEY,
            softSwitchAt: COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT,
            hardSegmentLimit: COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT,
            updatedAt: now(),
            segmentStartByGeneration: canAppendIncrementally
                ? {[activeGenerationId]: previousCommitted}
                : {},
            generationsToWrite: hasSegmentedPreviousMeta
                ? [activeGenerationId]
                : undefined,
            writeCheckpoints
        })
        return {
            payload,
            previousCommitted,
            previousCommittedFromMeta,
            hardLimitCommittedSegments: previousActiveGenerationId === activeGenerationId
                ? previousCommittedFromMeta
                : previousCommitted,
            committedSegments: activeSegments,
            hardLimit: COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT,
            softSwitchAt: COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT,
            segmented: true
        }
    }

    function recordCoordinatorQueueWalPhysicalPayloadMetrics(physicalWal = {}) {
        const payload = physicalWal?.payload || {}
        const entries = Object.entries(payload)
        recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxActivePhysicalSegments', physicalWal.committedSegments || 0)
        recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxPreviousCommittedSegments', physicalWal.previousCommitted || 0)
        recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxPreviousManifestCommittedSegments', physicalWal.previousCommittedFromMeta || 0)
        if(!entries.length) return

        let manifestBytes = 0
        let checkpointBytes = 0
        let segmentBytes = 0
        let manifestWrites = 0
        let checkpointWrites = 0
        let segmentWrites = 0
        for(const [key, value] of entries) {
            const bytes = getJsonByteSize(value)
            if(key === COORDINATOR_QUEUE_WAL_META_KEY) {
                manifestBytes += bytes
                manifestWrites += 1
            }
            else if(key.startsWith(`${COORDINATOR_QUEUE_WAL_KEY}.checkpoint.`)) {
                checkpointBytes += bytes
                checkpointWrites += 1
            }
            else if(key.startsWith(`${COORDINATOR_QUEUE_WAL_KEY}.segment.`)) {
                segmentBytes += bytes
                segmentWrites += 1
            }
        }

        if(manifestWrites) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.manifestWrites', manifestWrites)
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.manifestBytes', manifestBytes)
            recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxManifestBytes', manifestBytes)
        }
        if(checkpointWrites) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointWrites', checkpointWrites)
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.checkpointBytes', checkpointBytes)
            recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxCheckpointBytes', checkpointBytes)
        }
        if(segmentWrites) {
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.physicalSegmentWrites', segmentWrites)
            incrementQueueWakeupMetric('coordinatorAuthority.queueWal.physicalSegmentBytes', segmentBytes)
            recordQueueWakeupMetricMax('coordinatorAuthority.queueWal.maxPhysicalSegmentBytes', segmentBytes)
        }
    }

    function getRetiredCoordinatorQueueWalPhysicalKeys(previousMeta = null, nextMeta = null) {
        if(!isSegmentedWalStorageMeta(nextMeta)) return []

        const keys = new Set([COORDINATOR_QUEUE_WAL_KEY])
        const nextActiveGenerationId = nextMeta?.activeCheckpoint || ''
        if(isSegmentedWalStorageMeta(previousMeta)) {
            const previousCommittedSegments = previousMeta?.segmentedStorage?.committedSegments || {}
            const previousGenerations = {
                ...(previousMeta?.generations || {}),
                ...Object.fromEntries(Object.entries(previousCommittedSegments)
                    .map(([generationId, committedSegments]) => [
                        generationId,
                        {segments: committedSegments}
                    ]))
            }
            for(const generationId of Object.keys(previousGenerations)) {
                // Only the generation that is active AFTER the switch needs to survive --
                // previousActiveGenerationId is precisely the generation this switch just
                // retired, so it (and any other already-abandoned generation) must be
                // cleaned up here, not skipped. Excluding it left every retired
                // generation's segments orphaned forever, one switch at a time.
                if(!generationId || generationId === nextActiveGenerationId) continue
                const committedSegments = getSegmentedWalCommittedSegmentCount(previousMeta, generationId)
                for(let segmentNo = 0; segmentNo < committedSegments; segmentNo += 1) {
                    keys.add(getSegmentedWalSegmentKey(COORDINATOR_QUEUE_WAL_KEY, generationId, segmentNo))
                }
            }
        }

        return Array.from(keys)
    }

    function makeCoordinatorAuthorityQueueWalRemoveRecord(removal = {}, options = {}) {
        const rowKey = normalizeCoordinatorAuthorityRowKey(removal.rowKey || removal.coordinatorKey || removal.profileHref || '')
        if(!rowKey) return null

        const previousRow = cloneCoordinatorAuthorityValue(removal.previousRow || removal.row || null)
        const operationKind = normalizeQueueWriteOperationName(removal.operationKind || options.operationKind || 'authority-row-remove')
        const attemptId = getAttemptIdFromValue(previousRow || removal)
        const attemptNumber = getAttemptNumberFromValue(previousRow || removal)
        const runId = `${previousRow?.runId || removal.runId || ''}`.trim()
        const status = `${previousRow?.status || removal.status || ''}`.trim()
        const at = Number.parseInt(removal.at || previousRow?.updatedAt || previousRow?.terminalAt, 10) || now()

        return {
            kind: 'map.remove',
            area: 'queue',
            key: rowKey,
            dedupeKey: [
                'queue',
                operationKind,
                'remove',
                rowKey,
                attemptId,
                attemptNumber || '',
                status
            ].filter(value => value !== '').join(':'),
            operationKind,
            reason: removal.reason || options.reason || '',
            runId,
            attemptId,
            attemptNumber,
            status,
            removed: true,
            at,
            seq: 1
        }
    }

    // Entropy-reduction Phase 4, Option C (see entropy-reduction-action-plan-2026-09-09.md):
    // this module wrapped everything around a WAL mutation append (defaults,
    // physical-payload assembly, metrics) except the append itself and its
    // immediate accept/reject decision -- sw.js's persistCoordinatorAuthorityQueueWalMutation
    // and its batch sibling each called the raw appendWalRecordsToGeneration
    // primitive directly and duplicated the accept/reject-and-hard-limit
    // logic (and, separately, the post-append replay-verify logic)
    // near-verbatim. Both are genuinely identical logic between the single
    // and batch callers (only the surrounding diagnostic/metric-name text
    // differs, which stays in each caller since single vs "batch" wording
    // is caller-specific) -- pulled out here as the two functions below.
    // Deliberately data-in/data-out: this module has no scheduling or
    // diagnostic-recording capabilities threaded into it, so on a
    // non-ok result the caller still decides what metric to bump, what
    // diagnostic event to record, and whether to schedule a reconcile --
    // exactly what each caller already did before this extraction.
    function prepareCoordinatorQueueWalAppend(storedWal, records, options = {}) {
        const append = appendWalRecordsToGeneration(storedWal, records, {
            segmentId: options.segmentId
        })
        if(append?.rejected) {
            return {
                ok: false,
                stage: 'append-rejected',
                reason: append.reason || 'append-rejected',
                append
            }
        }

        const physicalWal = getCoordinatorQueueWalPhysicalPayload(append.store, {
            previousMeta: options.previousMeta,
            previousStored: options.previousStored || {}
        })
        if((physicalWal.hardLimitCommittedSegments || physicalWal.previousCommitted || 0) >= physicalWal.hardLimit) {
            return {
                ok: false,
                stage: 'hard-limit',
                reason: 'queue-wal-segment-hard-limit',
                append,
                physicalWal
            }
        }

        return {ok: true, append, physicalWal}
    }

    function verifyAppendedCoordinatorQueueWalReplay(append) {
        const recoveredAfterAppend = recoverProjectedState(append.store)
        const appendedRecordIds = new Set((append.records || []).map(record => record.id).filter(Boolean))
        const ignoredAppendedRecords = (recoveredAfterAppend?.projected?.ignored || [])
            .filter(entry => appendedRecordIds.has(entry?.record?.id))
        const failed = recoveredAfterAppend?.recovered !== true || ignoredAppendedRecords.length > 0
        const authoritativeProjectionQueue = recoveredAfterAppend?.recovered === true
            ? recoveredAfterAppend?.projected?.state?.queue || recoveredAfterAppend?.state?.queue || null
            : null
        const authoritativeProjectionCompleted = recoveredAfterAppend?.recovered === true
            ? recoveredAfterAppend?.projected?.state?.completed || null
            : null

        return {
            ok: !failed,
            recoveredAfterAppend,
            ignoredAppendedRecords,
            authoritativeProjectionQueue,
            authoritativeProjectionCompleted,
            reason: ignoredAppendedRecords[0]?.reason || recoveredAfterAppend?.reason || null
        }
    }

    return {
        shouldUseCoordinatorQueueWalBackend,
        normalizeCoordinatorQueueWalStore,
        isCoordinatorQueueWalPhysicalStorageKey,
        getCoordinatorQueueWalPhysicalStoredPayload,
        getCoordinatorQueueWalStorageDefaults,
        canUseResidentCoordinatorQueueWalStoreForMeta,
        getCoordinatorQueueWalPhysicalPayload,
        recordCoordinatorQueueWalPhysicalPayloadMetrics,
        getRetiredCoordinatorQueueWalPhysicalKeys,
        makeCoordinatorAuthorityQueueWalRemoveRecord,
        prepareCoordinatorQueueWalAppend,
        verifyAppendedCoordinatorQueueWalReplay
    }
}

module.exports = {createCoordinatorQueueWalStore}
