const WAL_SCHEMA_VERSION = 1
const CHECKPOINT_A = 'A'
const CHECKPOINT_B = 'B'
const DEFAULT_RECOVERY_CRITICAL_AREAS = ['queue', 'runs', 'progress', 'events']
const TERMINAL_STATUSES = new Set([
    'succeeded',
    'failed',
    'skipped',
    'canceled',
    'blocked',
    'already-blocked',
    'unblocked',
    'already-unblocked',
    'error',
    'error-page',
    'profile-unavailable',
    'interrupted'
])
const RAW_SNAPSHOT_CODEC = 'raw-json'
const GZIP_SNAPSHOT_CODEC = 'gzip'
const BASE64_ENCODING = 'base64'
const SEGMENTED_WAL_STORAGE_VERSION = 1

function cloneJson(value) {
    if(value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function stableStringify(value) {
    if(value === null || typeof value !== 'object') return JSON.stringify(value)
    if(Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function hashString(value) {
    let hash = 2166136261
    for(let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
}

function hashState(state = {}) {
    return hashString(stableStringify(state || {}))
}

function byteSize(value) {
    const text = JSON.stringify(value)
    if(typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length
    return Buffer.byteLength(text, 'utf8')
}

function textToBytes(text = '') {
    if(typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text)
    return Buffer.from(text, 'utf8')
}

function bytesToText(bytes) {
    const normalized = normalizeBytes(bytes)
    if(typeof TextDecoder !== 'undefined') return new TextDecoder().decode(normalized)
    return Buffer.from(normalized).toString('utf8')
}

function normalizeBytes(value) {
    if(value instanceof Uint8Array) return value
    if(value instanceof ArrayBuffer) return new Uint8Array(value)
    if(Array.isArray(value)) return new Uint8Array(value)
    return new Uint8Array(value || [])
}

function bytesToBase64(bytes) {
    const normalized = normalizeBytes(bytes)
    if(typeof Buffer !== 'undefined') return Buffer.from(normalized).toString('base64')
    let binary = ''
    for(const byte of normalized) binary += String.fromCharCode(byte)
    return btoa(binary)
}

function base64ToBytes(value = '') {
    if(typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(`${value || ''}`, 'base64'))
    const binary = atob(`${value || ''}`)
    const bytes = new Uint8Array(binary.length)
    for(let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
}

function normalizeSeq(value, fallback = 0) {
    const number = Number.parseInt(value, 10)
    return Number.isFinite(number) && number >= 0 ? number : fallback
}

function normalizeCheckpointId(value, fallback = CHECKPOINT_A) {
    if(value === CHECKPOINT_A || value === CHECKPOINT_B) return value
    return fallback === CHECKPOINT_B ? CHECKPOINT_B : CHECKPOINT_A
}

function getInactiveCheckpointId(activeCheckpoint = CHECKPOINT_A) {
    return normalizeCheckpointId(activeCheckpoint) === CHECKPOINT_A ? CHECKPOINT_B : CHECKPOINT_A
}

function makeWalMeta(options = {}) {
    const snapshotSeq = normalizeSeq(options.snapshotSeq)
    const activeCheckpoint = normalizeCheckpointId(options.activeCheckpoint)
    return {
        version: WAL_SCHEMA_VERSION,
        activeCheckpoint,
        snapshotSeq,
        nextSeq: normalizeSeq(options.nextSeq, snapshotSeq + 1),
        generations: {
            [CHECKPOINT_A]: {
                snapshotSeq: activeCheckpoint === CHECKPOINT_A ? snapshotSeq : 0,
                segments: 0
            },
            [CHECKPOINT_B]: {
                snapshotSeq: activeCheckpoint === CHECKPOINT_B ? snapshotSeq : 0,
                segments: 0
            },
            ...(options.generations || {})
        },
        checkpointSwitch: {
            inProgress: false,
            targetSeq: 0,
            startedAt: 0,
            ...(options.compaction || {}),
            ...(options.checkpointSwitch || {})
        }
    }
}

function makeCheckpoint(state = {}, options = {}) {
    const snapshotSeq = normalizeSeq(options.snapshotSeq)
    const snapshotEpoch = normalizeSeq(options.snapshotEpoch)
    const createdAt = normalizeSeq(options.createdAt)
    const snapshotState = cloneJson(state || {})
    const checkpoint = {
        version: WAL_SCHEMA_VERSION,
        id: normalizeCheckpointId(options.id),
        snapshotSeq,
        snapshotEpoch,
        createdAt,
        stateHash: options.stateHash || hashState(snapshotState)
    }

    if(options.codec) {
        return {
            ...checkpoint,
            ...encodeCheckpointSnapshot(snapshotState, {
                codec: options.codec,
                codecName: options.codecName
            })
        }
    }

    return {
        ...checkpoint,
        codec: RAW_SNAPSHOT_CODEC,
        encoding: 'object',
        uncompressedBytes: byteSize(snapshotState),
        compressedBytes: byteSize(snapshotState),
        base64Bytes: 0,
        state: snapshotState
    }
}

function makePairedCheckpointStore(initialState = {}, options = {}) {
    const activeCheckpoint = normalizeCheckpointId(options.activeCheckpoint)
    const inactiveCheckpoint = getInactiveCheckpointId(activeCheckpoint)
    const active = makeCheckpoint(initialState, {
        id: activeCheckpoint,
        snapshotSeq: options.snapshotSeq,
        snapshotEpoch: options.snapshotEpoch,
        createdAt: options.createdAt
    })
    return {
        meta: {
            ...makeWalMeta({
                activeCheckpoint,
                snapshotSeq: active.snapshotSeq,
                nextSeq: options.nextSeq || active.snapshotSeq + 1
            }),
            checkpoints: {
                [activeCheckpoint]: {
                    snapshotSeq: active.snapshotSeq,
                    snapshotEpoch: active.snapshotEpoch,
                    createdAt: active.createdAt,
                    stateHash: active.stateHash
                }
            }
        },
        checkpoints: {
            [activeCheckpoint]: active,
            [inactiveCheckpoint]: null
        },
        wal: {
            [activeCheckpoint]: makeWalGeneration({snapshotSeq: active.snapshotSeq}),
            [inactiveCheckpoint]: makeWalGeneration({snapshotSeq: 0})
        }
    }
}

function getActiveCheckpoint(store = {}) {
    const active = normalizeCheckpointId(store?.meta?.activeCheckpoint)
    return store?.checkpoints?.[active] || null
}

function resolveSnapshotCodec(codecName = '', options = {}) {
    if(options.codec && (!codecName || options.codec.name === codecName || options.codecName === codecName)) {
        return options.codec
    }
    if(options.codecs && codecName && options.codecs[codecName]) return options.codecs[codecName]
    return null
}

function encodeCheckpointSnapshot(state = {}, options = {}) {
    const snapshotState = cloneJson(state || {})
    const text = stableStringify(snapshotState)
    const input = textToBytes(text)
    const codec = options.codec || null
    const codecName = options.codecName || codec?.name || RAW_SNAPSHOT_CODEC

    if(!codec) {
        return {
            codec: RAW_SNAPSHOT_CODEC,
            encoding: 'object',
            uncompressedBytes: input.length,
            compressedBytes: input.length,
            base64Bytes: 0,
            state: snapshotState
        }
    }

    const compressed = normalizeBytes(codec.compress(input))
    const payload = bytesToBase64(compressed)
    return {
        codec: codecName,
        encoding: BASE64_ENCODING,
        uncompressedBytes: input.length,
        compressedBytes: compressed.length,
        base64Bytes: byteSize(payload),
        payload
    }
}

function decodeCheckpointSnapshot(checkpoint = null, options = {}) {
    if(!checkpoint || typeof checkpoint !== 'object') {
        return {ok: false, reason: 'missing-checkpoint', state: null}
    }
    if(checkpoint.state && typeof checkpoint.state === 'object') {
        return {ok: true, reason: '', state: cloneJson(checkpoint.state)}
    }

    const codecName = checkpoint.codec || RAW_SNAPSHOT_CODEC
    if(codecName === RAW_SNAPSHOT_CODEC && checkpoint.payload && checkpoint.encoding === BASE64_ENCODING) {
        try {
            const text = bytesToText(base64ToBytes(checkpoint.payload))
            return {ok: true, reason: '', state: JSON.parse(text)}
        }
        catch(error) {
            return {ok: false, reason: 'raw-payload-decode-failed', error: error.message, state: null}
        }
    }

    const codec = resolveSnapshotCodec(codecName, options)
    if(!codec || typeof codec.decompress !== 'function') {
        return {ok: false, reason: 'snapshot-codec-unavailable', codec: codecName, state: null}
    }
    if(checkpoint.encoding !== BASE64_ENCODING || !checkpoint.payload) {
        return {ok: false, reason: 'snapshot-payload-missing', codec: codecName, state: null}
    }

    try {
        const compressed = base64ToBytes(checkpoint.payload)
        const decompressed = normalizeBytes(codec.decompress(compressed))
        const state = JSON.parse(bytesToText(decompressed))
        return {ok: true, reason: '', state}
    }
    catch(error) {
        return {ok: false, reason: 'snapshot-decompress-failed', codec: codecName, error: error.message, state: null}
    }
}

function verifyCheckpoint(checkpoint = null, options = {}) {
    if(!checkpoint || typeof checkpoint !== 'object') {
        return {ok: false, reason: 'missing-checkpoint'}
    }
    const decoded = decodeCheckpointSnapshot(checkpoint, options)
    if(!decoded.ok) return decoded
    const actualHash = hashState(decoded.state || {})
    if(checkpoint.stateHash && checkpoint.stateHash !== actualHash) {
        return {ok: false, reason: 'state-hash-mismatch', expected: checkpoint.stateHash, actual: actualHash}
    }
    return {ok: true, reason: '', state: decoded.state}
}

function setCheckpointMeta(store, checkpoint) {
    store.meta.checkpoints = {
        ...(store.meta.checkpoints || {}),
        [checkpoint.id]: {
            snapshotSeq: checkpoint.snapshotSeq,
            snapshotEpoch: checkpoint.snapshotEpoch,
            createdAt: checkpoint.createdAt,
            stateHash: checkpoint.stateHash
        }
    }
}

function setWalGenerationMeta(store, generationId, generation) {
    store.meta.generations = {
        ...(store.meta.generations || {}),
        [generationId]: {
            snapshotSeq: normalizeSeq(generation?.snapshotSeq),
            segments: Array.isArray(generation?.segments) ? generation.segments.length : 0
        }
    }
}

function makeWalSegment(records = [], options = {}) {
    const normalizedRecords = (records || [])
        .map(makeWalRecord)
        .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
    const fromSeq = normalizedRecords.length
        ? normalizedRecords[0].seq
        : normalizeSeq(options.fromSeq)
    const toSeq = normalizedRecords.length
        ? normalizedRecords[normalizedRecords.length - 1].seq
        : normalizeSeq(options.toSeq, fromSeq)

    return {
        id: `${options.id || `wal-${fromSeq}-${toSeq}`}`,
        fromSeq,
        toSeq,
        sealed: options.sealed !== false,
        records: normalizedRecords
    }
}

function makeWalGeneration(options = {}) {
    return {
        snapshotSeq: normalizeSeq(options.snapshotSeq),
        segments: (options.segments || []).map(segment => makeWalSegment(segment.records || [], segment))
    }
}

function getWalGeneration(store = {}, generationId = CHECKPOINT_A) {
    const id = normalizeCheckpointId(generationId)
    const generation = store?.wal?.[id]
    if(generation) return makeWalGeneration(generation)

    const checkpoint = store?.checkpoints?.[id] || null
    return makeWalGeneration({snapshotSeq: checkpoint?.snapshotSeq || 0})
}

function getWalRecordsForGeneration(store = {}, generationId = CHECKPOINT_A) {
    return getWalGeneration(store, generationId).segments
        .flatMap(segment => segment.records || [])
        .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
}

function getSegmentedWalMetaKey(baseKey = 'wal') {
    return `${baseKey}.meta`
}

function getSegmentedWalCheckpointKey(baseKey = 'wal', checkpointId = CHECKPOINT_A) {
    return `${baseKey}.checkpoint.${normalizeCheckpointId(checkpointId)}`
}

function getSegmentedWalSegmentKey(baseKey = 'wal', generationId = CHECKPOINT_A, segmentNo = 0) {
    const normalizedSegmentNo = normalizeSeq(segmentNo)
    return `${baseKey}.segment.${normalizeCheckpointId(generationId)}.${`${normalizedSegmentNo}`.padStart(4, '0')}`
}

function makeSegmentedWalStorageMeta(store = {}, options = {}) {
    const committedSegments = {}
    const generations = {}
    const sourceGenerations = store?.wal || {}
    for(const generationId of [CHECKPOINT_A, CHECKPOINT_B]) {
        const generation = getWalGeneration(store, generationId)
        committedSegments[generationId] = Array.isArray(generation?.segments) ? generation.segments.length : 0
        generations[generationId] = {
            snapshotSeq: normalizeSeq(generation?.snapshotSeq),
            segments: committedSegments[generationId]
        }
    }
    for(const generationId of Object.keys(sourceGenerations || {})) {
        if(generationId === CHECKPOINT_A || generationId === CHECKPOINT_B) continue
        const generation = sourceGenerations[generationId]
        committedSegments[generationId] = Array.isArray(generation?.segments) ? generation.segments.length : 0
        generations[generationId] = {
            snapshotSeq: normalizeSeq(generation?.snapshotSeq),
            segments: committedSegments[generationId]
        }
    }

    return {
        ...(cloneJson(store?.meta || makeWalMeta()) || {}),
        generations: {
            ...(cloneJson(store?.meta?.generations || {}) || {}),
            ...generations
        },
        segmentedStorage: {
            version: SEGMENTED_WAL_STORAGE_VERSION,
            committedSegments,
            softSwitchAt: normalizeSeq(options.softSwitchAt),
            hardSegmentLimit: normalizeSeq(options.hardSegmentLimit),
            updatedAt: normalizeSeq(options.updatedAt)
        }
    }
}

function isSegmentedWalStorageMeta(value = null) {
    return value &&
        typeof value === 'object' &&
        value.segmentedStorage &&
        Number.parseInt(value.segmentedStorage.version, 10) === SEGMENTED_WAL_STORAGE_VERSION
}

function getSegmentedWalCommittedSegmentCount(meta = {}, generationId = CHECKPOINT_A) {
    const id = normalizeCheckpointId(generationId)
    const fromSegmented = Number.parseInt(meta?.segmentedStorage?.committedSegments?.[id], 10)
    if(Number.isFinite(fromSegmented) && fromSegmented >= 0) return fromSegmented
    return normalizeSeq(meta?.generations?.[id]?.segments)
}

function buildSegmentedWalStorageDefaults(meta = null, options = {}) {
    const baseKey = options.baseKey || 'wal'
    const defaults = {
        [getSegmentedWalMetaKey(baseKey)]: null
    }
    if(!isSegmentedWalStorageMeta(meta)) return defaults

    const activeCheckpoint = normalizeCheckpointId(meta.activeCheckpoint)
    defaults[getSegmentedWalCheckpointKey(baseKey, activeCheckpoint)] = null
    const committedSegments = getSegmentedWalCommittedSegmentCount(meta, activeCheckpoint)
    for(let segmentNo = 0; segmentNo < committedSegments; segmentNo += 1) {
        defaults[getSegmentedWalSegmentKey(baseKey, activeCheckpoint, segmentNo)] = null
    }
    return defaults
}

function normalizeSegmentedWalSegment(value = null, generationId = CHECKPOINT_A, segmentNo = 0) {
    if(!value || typeof value !== 'object') return null
    const segment = value.segment && typeof value.segment === 'object' ? value.segment : value
    const normalized = makeWalSegment(segment.records || [], {
        ...segment,
        id: segment.id || value.id || `segment-${normalizeCheckpointId(generationId)}-${segmentNo}`
    })
    return {
        version: value.version || SEGMENTED_WAL_STORAGE_VERSION,
        generation: normalizeCheckpointId(value.generation || generationId),
        segmentNo: normalizeSeq(value.segmentNo, segmentNo),
        segment: normalized
    }
}

function buildSegmentedWalStoragePayload(store = {}, options = {}) {
    const baseKey = options.baseKey || 'wal'
    const meta = makeSegmentedWalStorageMeta(store, options)
    const payload = {
        [getSegmentedWalMetaKey(baseKey)]: meta
    }
    const generationsToWrite = options.generationsToWrite || [CHECKPOINT_A, CHECKPOINT_B]
    const segmentStartByGeneration = options.segmentStartByGeneration || {}
    const writeCheckpoints = options.writeCheckpoints !== false

    for(const generationId of generationsToWrite) {
        const id = normalizeCheckpointId(generationId)
        if(writeCheckpoints && store?.checkpoints && Object.prototype.hasOwnProperty.call(store.checkpoints, id)) {
            payload[getSegmentedWalCheckpointKey(baseKey, id)] = cloneJson(store.checkpoints[id] || null)
        }
        const generation = getWalGeneration(store, id)
        const segments = Array.isArray(generation?.segments) ? generation.segments : []
        const start = Math.min(Math.max(0, normalizeSeq(segmentStartByGeneration[id])), segments.length)
        for(let index = start; index < segments.length; index += 1) {
            payload[getSegmentedWalSegmentKey(baseKey, id, index)] = {
                version: SEGMENTED_WAL_STORAGE_VERSION,
                generation: id,
                segmentNo: index,
                segment: cloneJson(segments[index])
            }
        }
    }

    return payload
}

function hydrateSegmentedWalStore(stored = {}, options = {}) {
    const baseKey = options.baseKey || 'wal'
    const meta = cloneJson(stored?.[getSegmentedWalMetaKey(baseKey)] || null)
    if(!isSegmentedWalStorageMeta(meta)) {
        return {
            ok: false,
            reason: 'missing-segmented-meta',
            store: cloneJson(options.fallbackStore || null)
        }
    }

    const activeCheckpoint = normalizeCheckpointId(meta.activeCheckpoint)
    const checkpoint = cloneJson(stored?.[getSegmentedWalCheckpointKey(baseKey, activeCheckpoint)] || null)
    if(!checkpoint) {
        return {ok: false, reason: 'missing-checkpoint', store: null, meta}
    }

    const committedSegments = getSegmentedWalCommittedSegmentCount(meta, activeCheckpoint)
    const segments = []
    for(let segmentNo = 0; segmentNo < committedSegments; segmentNo += 1) {
        const key = getSegmentedWalSegmentKey(baseKey, activeCheckpoint, segmentNo)
        const wrapped = normalizeSegmentedWalSegment(stored?.[key], activeCheckpoint, segmentNo)
        if(!wrapped) {
            return {ok: false, reason: 'missing-segment', missingKey: key, store: null, meta}
        }
        if(wrapped.generation !== activeCheckpoint || wrapped.segmentNo !== segmentNo) {
            return {ok: false, reason: 'segment-identity-mismatch', missingKey: key, store: null, meta}
        }
        segments.push(wrapped.segment)
    }

    const inactiveCheckpoint = getInactiveCheckpointId(activeCheckpoint)
    const inactiveStored = cloneJson(stored?.[getSegmentedWalCheckpointKey(baseKey, inactiveCheckpoint)] || null)
    const activeSnapshotSeq = Math.max(
        normalizeSeq(meta?.generations?.[activeCheckpoint]?.snapshotSeq),
        normalizeSeq(checkpoint.snapshotSeq)
    )
    const inactiveSnapshotSeq = Math.max(
        normalizeSeq(meta?.generations?.[inactiveCheckpoint]?.snapshotSeq),
        normalizeSeq(inactiveStored?.snapshotSeq)
    )
    const store = {
        meta,
        checkpoints: {
            [activeCheckpoint]: checkpoint,
            [inactiveCheckpoint]: inactiveStored || null
        },
        wal: {
            [activeCheckpoint]: makeWalGeneration({
                snapshotSeq: activeSnapshotSeq,
                segments
            }),
            [inactiveCheckpoint]: makeWalGeneration({
                snapshotSeq: inactiveSnapshotSeq,
                segments: []
            })
        }
    }

    return {ok: true, reason: '', store, meta}
}

function appendWalRecordsToGeneration(store = {}, records = [], options = {}) {
    const nextStore = cloneJson(store)
    const generationId = normalizeCheckpointId(options.generationId, nextStore?.meta?.activeCheckpoint || CHECKPOINT_A)
    const activeGenerationId = normalizeCheckpointId(nextStore?.meta?.activeCheckpoint || CHECKPOINT_A)
    if(generationId !== activeGenerationId && options.allowInactiveAppend !== true) {
        return {
            store: nextStore,
            generationId,
            records: [],
            generation: getWalGeneration(nextStore, generationId),
            rejected: true,
            reason: 'inactive-generation-append'
        }
    }
    const generation = getWalGeneration(nextStore, generationId)
    let nextSeq = Math.max(
        normalizeSeq(nextStore?.meta?.nextSeq, normalizeSeq(generation.snapshotSeq) + 1),
        normalizeSeq(generation.snapshotSeq) + 1
    )
    const normalizedRecords = []

    for(const rawRecord of records || []) {
        const record = cloneJson(rawRecord || {})
        if(!normalizeSeq(record.seq)) {
            record.seq = nextSeq
        }
        normalizedRecords.push(makeWalRecord(record))
        nextSeq = Math.max(nextSeq, normalizeSeq(record.seq) + 1)
    }

    if(normalizedRecords.length) {
        generation.segments.push(makeWalSegment(normalizedRecords, {
            id: options.segmentId,
            sealed: options.sealed
        }))
    }

    nextStore.wal = {
        ...(nextStore.wal || {}),
        [generationId]: generation
    }
    nextStore.meta.nextSeq = Math.max(normalizeSeq(nextStore.meta.nextSeq), nextSeq)
    setWalGenerationMeta(nextStore, generationId, generation)

    return {store: nextStore, generationId, records: normalizedRecords, generation}
}

function writeInactiveCheckpoint(store = {}, state = {}, options = {}) {
    const nextStore = cloneJson(store)
    const active = normalizeCheckpointId(nextStore?.meta?.activeCheckpoint)
    const inactive = getInactiveCheckpointId(active)
    const checkpoint = makeCheckpoint(state, {
        id: inactive,
        snapshotSeq: options.snapshotSeq,
        snapshotEpoch: options.snapshotEpoch,
        createdAt: options.createdAt,
        codec: options.codec,
        codecName: options.codecName
    })

    nextStore.checkpoints[inactive] = checkpoint
    nextStore.wal = {
        ...(nextStore.wal || {}),
        [inactive]: makeWalGeneration({
            snapshotSeq: checkpoint.snapshotSeq,
            segments: options.segments || []
        })
    }
    setCheckpointMeta(nextStore, checkpoint)
    setWalGenerationMeta(nextStore, inactive, nextStore.wal[inactive])
    nextStore.meta.checkpointSwitch = {
        inProgress: true,
        targetSeq: checkpoint.snapshotSeq,
        startedAt: normalizeSeq(options.startedAt, checkpoint.createdAt)
    }

    return {store: nextStore, checkpointId: inactive, checkpoint}
}

function activateCheckpoint(store = {}, checkpointId = CHECKPOINT_A, options = {}) {
    const nextStore = cloneJson(store)
    const id = normalizeCheckpointId(checkpointId)
    const checkpoint = nextStore?.checkpoints?.[id] || null
    const verification = verifyCheckpoint(checkpoint, options)
    if(!verification.ok) {
        return {store: nextStore, activated: false, reason: verification.reason, verification}
    }

    nextStore.meta.activeCheckpoint = id
    nextStore.meta.snapshotSeq = checkpoint.snapshotSeq
    nextStore.meta.nextSeq = Math.max(normalizeSeq(nextStore.meta.nextSeq), checkpoint.snapshotSeq + 1)
    nextStore.meta.checkpointSwitch = {
        inProgress: false,
        targetSeq: 0,
        startedAt: 0
    }
    setCheckpointMeta(nextStore, checkpoint)
    setWalGenerationMeta(nextStore, id, getWalGeneration(nextStore, id))

    return {store: nextStore, activated: true, reason: '', checkpoint}
}

function recoverActiveCheckpoint(store = {}, options = {}) {
    const checkpoint = getActiveCheckpoint(store)
    const verification = verifyCheckpoint(checkpoint, options)
    if(!verification.ok) {
        return {recovered: false, reason: verification.reason, verification, checkpoint: null}
    }
    return {
        recovered: true,
        reason: '',
        checkpoint,
        state: cloneJson(verification.state || {})
    }
}

function normalizeWalRecord(raw = {}) {
    const record = cloneJson(raw || {})
    record.version = record.version || WAL_SCHEMA_VERSION
    record.seq = normalizeSeq(record.seq)
    record.id = `${record.id || ''}`.trim()
    record.kind = `${record.kind || ''}`.trim()
    record.area = `${record.area || ''}`.trim()
    record.key = `${record.key || ''}`.trim()
    record.at = normalizeSeq(record.at)
    return record
}

function makeWalRecord(raw = {}) {
    const record = normalizeWalRecord(raw)
    if(!record.id) {
        const parts = [
            record.kind,
            record.area,
            record.key,
            record.attemptId || '',
            record.attemptNumber || '',
            record.seq
        ].filter(value => value !== '')
        record.id = parts.join(':')
    }
    return record
}

function validateWalRecord(record = {}) {
    if(!record.seq) return {ok: false, reason: 'missing-seq'}
    if(!record.id) return {ok: false, reason: 'missing-id'}
    if(!record.kind) return {ok: false, reason: 'missing-kind'}

    if(record.kind === 'map.set' || record.kind === 'map.patch' || record.kind === 'map.remove') {
        if(!record.area) return {ok: false, reason: 'missing-area'}
        if(!record.key) return {ok: false, reason: 'missing-key'}
    }
    else if(record.kind === 'list.append') {
        if(!record.area) return {ok: false, reason: 'missing-area'}
    }
    else {
        return {ok: false, reason: 'unknown-kind'}
    }

    return {ok: true, reason: ''}
}

function isTerminalStatus(status = '') {
    return TERMINAL_STATUSES.has(`${status || ''}`)
}

function getAttemptNumber(value = {}) {
    const attemptNumber = Number.parseInt(value.attemptNumber ?? value.attempt?.number, 10)
    return Number.isFinite(attemptNumber) && attemptNumber > 0 ? attemptNumber : 0
}

function getAttemptId(value = {}) {
    return `${value.attemptId || value.attempt?.id || ''}`.trim()
}

function isStaleAttempt(existing = {}, record = {}) {
    const incomingNumber = getAttemptNumber(record)
    const existingNumber = getAttemptNumber(existing)
    if(incomingNumber && existingNumber && incomingNumber < existingNumber) return true

    const incomingId = getAttemptId(record)
    const existingId = getAttemptId(existing)
    if(incomingId && existingId && incomingId !== existingId && incomingNumber && existingNumber && incomingNumber <= existingNumber) {
        return true
    }

    return false
}

function shouldApplyPatch(existing = null, patch = {}, record = {}) {
    const existingStatus = `${existing?.status || ''}`
    const patchStatus = `${patch?.status || ''}`
    if(existing && isStaleAttempt(existing, record)) {
        const incomingNumber = getAttemptNumber(record)
        const existingNumber = getAttemptNumber(existing)
        const sameAttemptNumberTerminal = record.terminal === true &&
            isTerminalStatus(patchStatus) &&
            incomingNumber &&
            existingNumber &&
            incomingNumber === existingNumber
        if(!sameAttemptNumberTerminal) return {ok: false, reason: 'stale-attempt'}
    }
    if(existing &&
        record.operationKind === 'active-transition' &&
        existingStatus === 'queued' &&
        patchStatus === 'active' &&
        existing.actionLeaseReleaseReason === 'active-transition-failed' &&
        record.allowActiveTransitionAfterRollback !== true) {
        return {ok: false, reason: 'active-transition-after-rollback'}
    }
    if(existing && isTerminalStatus(existingStatus) && patchStatus && !isTerminalStatus(patchStatus) && record.allowTerminalOverwrite !== true) {
        return {ok: false, reason: 'terminal-regression'}
    }

    return {ok: true, reason: ''}
}

function applyWalRecord(state = {}, rawRecord = {}, context = {}) {
    const record = makeWalRecord(rawRecord)
    const validation = validateWalRecord(record)
    if(!validation.ok) return {state, applied: false, reason: validation.reason, record}

    if(record.seq <= normalizeSeq(context.snapshotSeq)) {
        return {state, applied: false, reason: 'already-in-snapshot', record}
    }
    if(context.appliedIds?.has(record.id)) {
        return {state, applied: false, reason: 'duplicate-id', record}
    }

    const nextState = cloneJson(state || {})
    const area = record.area

    if(record.kind === 'map.remove') {
        const map = {...normalizeObject(nextState[area])}
        delete map[record.key]
        nextState[area] = map
    }
    else if(record.kind === 'map.set') {
        const map = {...normalizeObject(nextState[area])}
        const value = cloneJson(record.value || {})
        const check = shouldApplyPatch(map[record.key] || null, value, record)
        if(!check.ok) return {state, applied: false, reason: check.reason, record}
        map[record.key] = value
        nextState[area] = map
    }
    else if(record.kind === 'map.patch') {
        const map = {...normalizeObject(nextState[area])}
        const previous = map[record.key] || {}
        const patch = cloneJson(record.patch || {})
        const check = shouldApplyPatch(previous, patch, record)
        if(!check.ok) return {state, applied: false, reason: check.reason, record}
        map[record.key] = {
            ...previous,
            ...patch
        }
        nextState[area] = map
    }
    else if(record.kind === 'list.append') {
        const list = Array.isArray(nextState[area]) ? [...nextState[area]] : []
        list.push(cloneJson(record.value))
        const maxEntries = normalizeSeq(record.maxEntries)
        nextState[area] = maxEntries > 0 ? list.slice(-maxEntries) : list
    }

    context.appliedIds?.add(record.id)
    return {state: nextState, applied: true, reason: '', record}
}

function projectSnapshot(checkpoint = {}, records = [], options = {}) {
    const snapshotSeq = normalizeSeq(checkpoint.snapshotSeq)
    const decoded = decodeCheckpointSnapshot(checkpoint, options)
    const baseState = decoded.ok ? decoded.state : {}
    const sortedRecords = (records || [])
        .map(makeWalRecord)
        .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
    const appliedIds = new Set()
    const ignored = []
    const applied = []
    let state = cloneJson(baseState || {})
    let maxSeq = snapshotSeq

    for(const record of sortedRecords) {
        const result = applyWalRecord(state, record, {snapshotSeq, appliedIds})
        if(result.applied) {
            state = result.state
            applied.push(record)
            maxSeq = Math.max(maxSeq, record.seq)
        }
        else {
            ignored.push({record, reason: result.reason})
        }
    }

    return {
        state,
        snapshotSeq,
        maxSeq,
        applied,
        ignored,
        appliedIds: Array.from(appliedIds),
        stateHash: hashState(state)
    }
}

function recoverProjectedState(store = {}, records = [], options = {}) {
    const recovered = recoverActiveCheckpoint(store, options)
    if(!recovered.recovered) {
        return {...recovered, projected: null}
    }
    const activeGeneration = normalizeCheckpointId(store?.meta?.activeCheckpoint)
    const generationRecords = getWalRecordsForGeneration(store, activeGeneration)
    const projected = projectSnapshot(recovered.checkpoint, generationRecords.concat(records || []), options)
    return {
        recovered: true,
        reason: '',
        checkpoint: recovered.checkpoint,
        generationId: activeGeneration,
        projected
    }
}

function splitCheckpointState(state = {}, options = {}) {
    const recoveryCriticalAreas = new Set(options.recoveryCriticalAreas || DEFAULT_RECOVERY_CRITICAL_AREAS)
    const recoveryCritical = {}
    const userMemory = {}

    for(const [key, value] of Object.entries(state || {})) {
        if(recoveryCriticalAreas.has(key)) recoveryCritical[key] = cloneJson(value)
        else userMemory[key] = cloneJson(value)
    }

    return {recoveryCritical, userMemory}
}

function estimateStateBytes(state = {}, options = {}) {
    const split = splitCheckpointState(state, options)
    return {
        totalBytes: byteSize(state || {}),
        recoveryCriticalBytes: byteSize(split.recoveryCritical),
        userMemoryBytes: byteSize(split.userMemory)
    }
}

module.exports = {
    CHECKPOINT_A,
    CHECKPOINT_B,
    DEFAULT_RECOVERY_CRITICAL_AREAS,
    GZIP_SNAPSHOT_CODEC,
    RAW_SNAPSHOT_CODEC,
    SEGMENTED_WAL_STORAGE_VERSION,
    WAL_SCHEMA_VERSION,
    activateCheckpoint,
    appendWalRecordsToGeneration,
    applyWalRecord,
    base64ToBytes,
    byteSize,
    bytesToBase64,
    bytesToText,
    cloneJson,
    buildSegmentedWalStorageDefaults,
    buildSegmentedWalStoragePayload,
    decodeCheckpointSnapshot,
    encodeCheckpointSnapshot,
    estimateStateBytes,
    getActiveCheckpoint,
    getInactiveCheckpointId,
    getSegmentedWalCheckpointKey,
    getSegmentedWalCommittedSegmentCount,
    getSegmentedWalMetaKey,
    getSegmentedWalSegmentKey,
    getWalGeneration,
    getWalRecordsForGeneration,
    hashState,
    hydrateSegmentedWalStore,
    isSegmentedWalStorageMeta,
    makeCheckpoint,
    makePairedCheckpointStore,
    makeWalGeneration,
    makeWalMeta,
    makeWalRecord,
    makeWalSegment,
    normalizeBytes,
    projectSnapshot,
    recoverActiveCheckpoint,
    recoverProjectedState,
    splitCheckpointState,
    stableStringify,
    textToBytes,
    validateWalRecord,
    verifyCheckpoint,
    writeInactiveCheckpoint
}
