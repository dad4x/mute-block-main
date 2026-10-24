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
const CHECKPOINT_SHARD_FORMAT = 'sharded-v1'
// Declared once, in storageKeys.js (it sets the stored checkpoint shard keys).
const {CHECKPOINT_SHARD_DEFAULT_COUNT} = require('./storageKeys')

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
    if(normalizeCheckpointShardCount(options.shardCount)) return makeShardedCheckpoint(state, options)
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

// Sharded checkpoint format (sharded-v1). The state's top-level map areas are
// partitioned by key hash into a fixed number of shards. Each shard is encoded
// with the same codec a monolithic checkpoint uses. Top-level values that are
// not maps (lists, scalars) live whole in shard 0. Each shard carries a hash of
// its own subset, so a torn or mixed write is caught per shard as well as by
// the whole-state hash. The shard count is fixed for a format version. Changing
// it means re-sharding, so it is recorded in the manifest.
function normalizeCheckpointShardCount(value) {
    const count = Number.parseInt(value, 10)
    return Number.isFinite(count) && count > 1 ? count : 0
}

function getCheckpointShardIndex(key = '', shardCount = CHECKPOINT_SHARD_DEFAULT_COUNT) {
    return Number.parseInt(hashString(`${key}`), 16) % shardCount
}

function isCheckpointMapArea(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function partitionCheckpointState(state = {}, shardCount = CHECKPOINT_SHARD_DEFAULT_COUNT) {
    const shardStates = Array.from({length: shardCount}, () => ({}))
    const mapAreas = []
    const valueAreas = []
    for(const [area, value] of Object.entries(state || {})) {
        if(isCheckpointMapArea(value)) {
            mapAreas.push(area)
            for(const shardState of shardStates) shardState[area] = {}
            for(const [key, entry] of Object.entries(value)) {
                shardStates[getCheckpointShardIndex(key, shardCount)][area][key] = entry
            }
        }
        else {
            valueAreas.push(area)
            shardStates[0][area] = value
        }
    }
    return {shardStates, areas: {map: mapAreas, value: valueAreas}}
}

// Rebuilds the whole state from decoded shard states. Returns null when a key
// shows up in two shards, which only corrupted or mixed shards can produce.
function mergeCheckpointShardStates(shardStates = [], areas = {map: [], value: []}) {
    const state = {}
    for(const area of areas.map || []) {
        state[area] = {}
        for(const shardState of shardStates) {
            for(const [key, entry] of Object.entries(normalizeObject(shardState?.[area]))) {
                if(Object.prototype.hasOwnProperty.call(state[area], key)) return null
                state[area][key] = entry
            }
        }
    }
    for(const area of areas.value || []) {
        if(shardStates[0] && Object.prototype.hasOwnProperty.call(shardStates[0], area)) {
            state[area] = shardStates[0][area]
        }
    }
    return state
}

function makeShardedCheckpoint(state = {}, options = {}) {
    const shardCount = normalizeCheckpointShardCount(options.shardCount) || CHECKPOINT_SHARD_DEFAULT_COUNT
    const snapshotState = cloneJson(state || {})
    const {shardStates, areas} = partitionCheckpointState(snapshotState, shardCount)
    const shards = shardStates.map((shardState, index) => ({
        index,
        shardStateHash: hashState(shardState),
        ...encodeCheckpointSnapshot(shardState, {
            codec: options.codec,
            codecName: options.codecName
        })
    }))

    return {
        version: WAL_SCHEMA_VERSION,
        id: normalizeCheckpointId(options.id),
        snapshotSeq: normalizeSeq(options.snapshotSeq),
        snapshotEpoch: normalizeSeq(options.snapshotEpoch),
        createdAt: normalizeSeq(options.createdAt),
        stateHash: hashState(snapshotState),
        format: CHECKPOINT_SHARD_FORMAT,
        shardCount,
        areas,
        shards
    }
}

function decodeShardedCheckpointState(checkpoint = null, options = {}) {
    const shardCount = normalizeCheckpointShardCount(checkpoint.shardCount)
    const shards = Array.isArray(checkpoint.shards) ? checkpoint.shards : []
    if(!shardCount || shards.length !== shardCount) {
        return {ok: false, reason: 'checkpoint-shard-count-mismatch', state: null}
    }

    const shardStates = []
    for(let index = 0; index < shardCount; index += 1) {
        const shard = shards[index]
        if(!shard || shard.index !== index) {
            return {ok: false, reason: 'checkpoint-shard-missing', shardIndex: index, state: null}
        }
        const decoded = decodeCheckpointSnapshot(shard, options)
        if(!decoded.ok) {
            return {ok: false, reason: 'checkpoint-shard-decode-failed', shardIndex: index, shardReason: decoded.reason, state: null}
        }
        const actualHash = hashState(decoded.state || {})
        if(shard.shardStateHash && shard.shardStateHash !== actualHash) {
            return {ok: false, reason: 'checkpoint-shard-hash-mismatch', shardIndex: index, state: null}
        }
        shardStates.push(decoded.state || {})
    }

    const state = mergeCheckpointShardStates(shardStates, checkpoint.areas)
    if(!state) return {ok: false, reason: 'checkpoint-shard-key-collision', state: null}
    return {ok: true, reason: '', state}
}

// The checkpoint record kept in storage: everything except the shard payloads.
function getCheckpointManifest(checkpoint = {}) {
    if(checkpoint?.format !== CHECKPOINT_SHARD_FORMAT) return cloneJson(checkpoint)
    const {shards = [], ...rest} = checkpoint
    return cloneJson({
        ...rest,
        shards: shards.map(shard => ({
            index: shard.index,
            shardStateHash: shard.shardStateHash,
            codec: shard.codec,
            encoding: shard.encoding,
            uncompressedBytes: shard.uncompressedBytes,
            compressedBytes: shard.compressedBytes,
            base64Bytes: shard.base64Bytes
        }))
    })
}

// One storage record per shard. The identity fields let a reader reject a shard
// left over from another checkpoint or snapshot sequence.
function getCheckpointShardRecord(checkpoint = {}, shard = {}) {
    return cloneJson({
        version: WAL_SCHEMA_VERSION,
        checkpointId: checkpoint.id,
        snapshotSeq: checkpoint.snapshotSeq,
        snapshotEpoch: checkpoint.snapshotEpoch,
        ...shard
    })
}

// Reads one checkpoint slot from a stored snapshot. Monolithic (legacy) slots are
// returned as they are. Sharded slots are reassembled from their shard records,
// and each record must match the manifest's identity.
function readStoredCheckpoint(stored = {}, baseKey = 'wal', checkpointId = CHECKPOINT_A) {
    const manifest = cloneJson(stored?.[getSegmentedWalCheckpointKey(baseKey, checkpointId)] || null)
    if(!manifest) return {ok: false, reason: 'missing-checkpoint', checkpoint: null}
    if(manifest.format !== CHECKPOINT_SHARD_FORMAT) return {ok: true, reason: '', checkpoint: manifest}

    const shardCount = normalizeCheckpointShardCount(manifest.shardCount)
    const descriptors = Array.isArray(manifest.shards) ? manifest.shards : []
    if(!shardCount || descriptors.length !== shardCount) {
        return {ok: false, reason: 'checkpoint-shard-count-mismatch', checkpoint: null}
    }
    const shards = []
    for(let index = 0; index < shardCount; index += 1) {
        const descriptor = descriptors[index]
        const key = getSegmentedWalCheckpointShardKey(baseKey, checkpointId, index)
        const record = cloneJson(stored?.[key] || null)
        if(!record) return {ok: false, reason: 'missing-checkpoint-shard', missingKey: key, checkpoint: null}
        if(!descriptor || descriptor.index !== index ||
            record.checkpointId !== manifest.id ||
            record.snapshotSeq !== manifest.snapshotSeq ||
            record.index !== index ||
            record.shardStateHash !== descriptor.shardStateHash) {
            return {ok: false, reason: 'checkpoint-shard-identity-mismatch', missingKey: key, checkpoint: null}
        }
        shards.push({...descriptor, payload: record.payload, state: record.state})
    }
    return {ok: true, reason: '', checkpoint: {...manifest, shards}}
}

function getSegmentedWalCheckpointShardKey(baseKey = 'wal', checkpointId = CHECKPOINT_A, index = 0) {
    return `${getSegmentedWalCheckpointKey(baseKey, checkpointId)}.s${`${index}`.padStart(2, '0')}`
}

function getSegmentedWalCheckpointShardKeys(baseKey = 'wal', checkpointId = CHECKPOINT_A, shardCount = CHECKPOINT_SHARD_DEFAULT_COUNT) {
    const count = normalizeCheckpointShardCount(shardCount)
    return Array.from({length: count}, (_, index) => getSegmentedWalCheckpointShardKey(baseKey, checkpointId, index))
}

// Keyed row reads over the sharded layout. A map record names one (area, key)
// and changes nothing else, so one row is exactly: the row in its shard, then
// the active generation's tail records for that (area, key), applied in order.
// The storage keys for that read: the meta, the active manifest, one shard, and every committed
// tail segment. The segments are still listed in full, because a row's records can sit in any
// of them. Only the resident copy (projectKeyedRowFromResidentStore) avoids reading the tail.
function getKeyedRowReadKeys(meta = null, key = '', options = {}) {
    const baseKey = options.baseKey || 'wal'
    if(!isSegmentedWalStorageMeta(meta)) return [getSegmentedWalMetaKey(baseKey)]
    const active = normalizeCheckpointId(meta.activeCheckpoint)
    const keys = [getSegmentedWalMetaKey(baseKey), getSegmentedWalCheckpointKey(baseKey, active)]
    const shardCount = normalizeCheckpointShardCount(meta.checkpoints?.[active]?.shardCount)
    if(shardCount) {
        keys.push(getSegmentedWalCheckpointShardKey(baseKey, active, getCheckpointShardIndex(key, shardCount)))
    }
    const committedSegments = getSegmentedWalCommittedSegmentCount(meta, active)
    for(let segmentNo = 0; segmentNo < committedSegments; segmentNo += 1) {
        keys.push(getSegmentedWalSegmentKey(baseKey, active, segmentNo))
    }
    return keys
}

// The reason a manifest and the metadata disagree on the active slot. Named once: the checkpoint recovery in swQueueWalStore.js
// matches on it, so a second copy of the literal could drift from the one that is returned here.
const CHECKPOINT_MANIFEST_META_MISMATCH = 'checkpoint-manifest-meta-mismatch'

// A keyed read may only use a manifest whose identity is the active metadata's. A stale or mixed
// manifest with a matching shard would otherwise project a row from an older base.
function checkpointManifestMatchesMeta(manifest = {}, metaCheckpoint = {}, activeId = '') {
    return normalizeCheckpointId(manifest.id) === activeId &&
        normalizeSeq(manifest.snapshotSeq) === normalizeSeq(metaCheckpoint.snapshotSeq) &&
        normalizeSeq(manifest.snapshotEpoch) === normalizeSeq(metaCheckpoint.snapshotEpoch) &&
        normalizeSeq(manifest.createdAt) === normalizeSeq(metaCheckpoint.createdAt) &&
        manifest.stateHash === metaCheckpoint.stateHash &&
        normalizeCheckpointShardCount(manifest.shardCount) === normalizeCheckpointShardCount(metaCheckpoint.shardCount)
}

// The identity that checkpointManifestMatchesMeta compares, as one string, for the checkpoint diagnostics. It lists the same
// fields, so a diagnostic can show the metadata's checkpoint and the disk manifest side by side. The decision stays with the check.
// A manifest's id is passed as the slot, because the check compares it too; the metadata's record has no id of its own.
function getCheckpointFingerprint(record = {}, checkpointId = CHECKPOINT_A) {
    return [
        normalizeCheckpointId(checkpointId),
        normalizeSeq(record?.snapshotSeq),
        normalizeSeq(record?.snapshotEpoch),
        normalizeSeq(record?.createdAt),
        `${record?.stateHash}`,
        normalizeCheckpointShardCount(record?.shardCount)
    ].join(':')
}

// The checkpoint manifests a session mirror rebuild would copy that disagree with the disk meta, one entry per slot (hole 1,
// docs/queue-storage-layering.md, section 6). The rule is the loader's, so a manifest the loader would refuse is never written over a
// good session copy. A manifest with a metadata entry must pass checkpointManifestMatchesMeta. A sharded manifest with no entry
// disagrees, as hydrate refuses it. A monolithic manifest with no entry predates fingerprints and is not checked. A missing manifest
// is never copied. Only the slots the records hold are looked at. Each entry names its slot and both fingerprints.
function findCheckpointManifestDisagreements(records = {}, meta = null, options = {}) {
    const baseKey = options.baseKey || 'wal'
    const disagreements = []
    if(!isSegmentedWalStorageMeta(meta)) return disagreements
    for(const checkpointId of [CHECKPOINT_A, CHECKPOINT_B]) {
        const key = getSegmentedWalCheckpointKey(baseKey, checkpointId)
        if(!Object.prototype.hasOwnProperty.call(records || {}, key)) continue
        const manifest = records[key]
        const isRecord = manifest !== null && typeof manifest === 'object'
        const metaCheckpoint = meta.checkpoints?.[checkpointId] || null
        if(isRecord && !metaCheckpoint && manifest.format !== CHECKPOINT_SHARD_FORMAT) continue
        if(isRecord && metaCheckpoint && checkpointManifestMatchesMeta(manifest, metaCheckpoint, checkpointId)) continue
        disagreements.push({
            checkpointId,
            metaFingerprint: getCheckpointFingerprint(metaCheckpoint || {}, checkpointId),
            manifestFingerprint: isRecord
                ? getCheckpointFingerprint(manifest, normalizeCheckpointId(manifest.id))
                : getCheckpointFingerprint({}, checkpointId)
        })
    }
    return disagreements
}

function projectKeyedRowFromStored(stored = {}, options = {}) {
    const baseKey = options.baseKey || 'wal'
    const area = `${options.area || ''}`
    const key = `${options.key || ''}`
    if(!area || !key) return {ok: false, reason: 'missing-area-or-key'}

    const meta = cloneJson(stored?.[getSegmentedWalMetaKey(baseKey)] || null)
    if(!isSegmentedWalStorageMeta(meta)) return {ok: false, reason: 'missing-segmented-meta'}
    const active = normalizeCheckpointId(meta.activeCheckpoint)

    const manifest = cloneJson(stored?.[getSegmentedWalCheckpointKey(baseKey, active)] || null)
    if(!manifest) return {ok: false, reason: 'missing-checkpoint'}
    if(manifest.format !== CHECKPOINT_SHARD_FORMAT) return {ok: false, reason: 'legacy-checkpoint'}
    const metaCheckpoint = meta.checkpoints?.[active] || null
    if(!metaCheckpoint) return {ok: false, reason: 'checkpoint-meta-missing'}
    if(!checkpointManifestMatchesMeta(manifest, metaCheckpoint, active)) {
        return {ok: false, reason: CHECKPOINT_MANIFEST_META_MISMATCH}
    }

    const shardCount = normalizeCheckpointShardCount(manifest.shardCount)
    if(!shardCount) return {ok: false, reason: 'checkpoint-shard-count-mismatch'}
    const shardIndex = getCheckpointShardIndex(key, shardCount)
    const descriptor = Array.isArray(manifest.shards) ? manifest.shards[shardIndex] : null
    const shardKey = getSegmentedWalCheckpointShardKey(baseKey, active, shardIndex)
    const record = cloneJson(stored?.[shardKey] || null)
    if(!descriptor || !record) return {ok: false, reason: 'missing-checkpoint-shard', missingKey: shardKey}
    if(descriptor.index !== shardIndex ||
        record.checkpointId !== manifest.id ||
        record.snapshotSeq !== manifest.snapshotSeq ||
        record.index !== shardIndex ||
        record.shardStateHash !== descriptor.shardStateHash) {
        return {ok: false, reason: 'checkpoint-shard-identity-mismatch', missingKey: shardKey}
    }

    const decoded = decodeCheckpointSnapshot({...descriptor, payload: record.payload, state: record.state}, options)
    if(!decoded.ok) return {ok: false, reason: 'checkpoint-shard-decode-failed', shardReason: decoded.reason}
    if(hashState(decoded.state || {}) !== descriptor.shardStateHash) {
        return {ok: false, reason: 'checkpoint-shard-hash-mismatch'}
    }

    const areas = manifest.areas || {map: [], value: []}
    if((areas.value || []).includes(area)) return {ok: false, reason: 'not-a-map-area'}
    const tail = []
    const committedSegments = getSegmentedWalCommittedSegmentCount(meta, active)
    for(let segmentNo = 0; segmentNo < committedSegments; segmentNo += 1) {
        const segmentKey = getSegmentedWalSegmentKey(baseKey, active, segmentNo)
        const wrapped = normalizeSegmentedWalSegment(stored?.[segmentKey], active, segmentNo)
        if(!wrapped) return {ok: false, reason: 'missing-segment', missingKey: segmentKey}
        if(wrapped.generation !== active || wrapped.segmentNo !== segmentNo) {
            return {ok: false, reason: 'segment-identity-mismatch', missingKey: segmentKey}
        }
        for(const raw of wrapped.segment.records || []) {
            const walRecord = makeWalRecord(raw)
            if(walRecord.area === area && walRecord.key === key) tail.push(walRecord)
        }
    }
    tail.sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))

    const row = projectKeyedRowFromShardState(decoded.state, tail, {area, key, snapshotSeq: manifest.snapshotSeq})
    return {
        ok: true,
        reason: '',
        found: row.found,
        value: row.value,
        snapshotSeq: normalizeSeq(manifest.snapshotSeq),
        shardIndex,
        tailRecords: tail.length
    }
}

// One row from a verified shard state plus the (area, key) tail records, already sorted.
// Replay runs against a one-row copy of the shard, so the shard state itself is never touched.
function projectKeyedRowFromShardState(shardState = {}, tail = [], options = {}) {
    const {area, key, snapshotSeq} = options
    const shardMap = isCheckpointMapArea(shardState?.[area]) ? shardState[area] : {}
    const mini = {[area]: {}}
    if(Object.prototype.hasOwnProperty.call(shardMap, key)) mini[area][key] = shardMap[key]

    const appliedIds = new Set()
    let state = mini
    for(const walRecord of tail) {
        const result = applyWalRecord(state, walRecord, {snapshotSeq, appliedIds})
        if(result.applied) state = result.state
    }

    const found = Object.prototype.hasOwnProperty.call(state[area], key)
    return {found, value: found ? cloneJson(state[area][key]) : null}
}

// Resident keyed reads. The resident copy is the WAL store this process last wrote or read
// (coordinatorQueueWalResidentStoreCache in sw.js). It holds the active sharded manifest and
// every committed tail segment in memory. It is only a cache: it answers when the disk meta
// names the same generation, and the manifest binding still has to hold. Storage stays the
// authority, and the storage path (projectKeyedRowFromStored) is the fallback.
//
// Per call the work is one shard (decoded and hash-checked once per shard object) plus the
// records for this (area, key). Tail records are indexed by row once per segments array.
// Committed segments are sealed and only ever appended to, so the index extends by new
// segments and never rereads old ones. A new segments array (from a later write) gets a
// fresh index, built once.
const residentTailRowIndexes = new WeakMap()
const residentVerifiedShardStates = new WeakMap()

function residentRowId(area = '', key = '') {
    return `${area}\u0000${key}`
}

function extendResidentTailRowIndex(segments = []) {
    let index = residentTailRowIndexes.get(segments)
    if(!index || index.indexedSegments > segments.length) {
        index = {indexedSegments: 0, rows: new Map()}
        residentTailRowIndexes.set(segments, index)
    }
    let scanned = 0
    for(; index.indexedSegments < segments.length; index.indexedSegments += 1) {
        for(const record of segments[index.indexedSegments]?.records || []) {
            scanned += 1
            // Same trimming as normalizeWalRecord, so the index agrees with the storage path.
            const id = residentRowId(`${record?.area || ''}`.trim(), `${record?.key || ''}`.trim())
            const list = index.rows.get(id)
            if(list) list.push(record)
            else index.rows.set(id, [record])
        }
    }
    return {index, scanned}
}

function getResidentVerifiedShardState(shard = {}, options = {}) {
    const cached = residentVerifiedShardStates.get(shard)
    if(cached) return cached
    const decoded = decodeCheckpointSnapshot(shard, options)
    let verified
    if(!decoded.ok) verified = {ok: false, reason: 'checkpoint-shard-decode-failed', shardReason: decoded.reason}
    else if(hashState(decoded.state || {}) !== shard.shardStateHash) verified = {ok: false, reason: 'checkpoint-shard-hash-mismatch'}
    else verified = {ok: true, reason: '', state: decoded.state}
    residentVerifiedShardStates.set(shard, verified)
    return verified
}

function projectKeyedRowFromResidentStore(resident = null, diskMeta = null, options = {}) {
    const area = `${options.area || ''}`
    const key = `${options.key || ''}`
    if(!area || !key) return {ok: false, reason: 'missing-area-or-key'}
    if(!resident || typeof resident !== 'object') return {ok: false, reason: 'resident-missing'}
    if(!isSegmentedWalStorageMeta(diskMeta)) return {ok: false, reason: 'missing-segmented-meta'}

    const active = normalizeCheckpointId(diskMeta.activeCheckpoint)
    // Freshness: the same generation test the session mirror uses (active slot, committed
    // tail, next sequence), plus the in-memory segment count, which must match the meta.
    if(!isQueueMirrorFresh(resident.meta, diskMeta)) return {ok: false, reason: 'resident-meta-mismatch'}
    const segments = resident.wal?.[active]?.segments
    if(!Array.isArray(segments) || segments.length !== getSegmentedWalCommittedSegmentCount(diskMeta, active)) {
        return {ok: false, reason: 'resident-meta-mismatch'}
    }

    const manifest = resident.checkpoints?.[active] || null
    if(!manifest) return {ok: false, reason: 'missing-checkpoint'}
    if(manifest.format !== CHECKPOINT_SHARD_FORMAT) return {ok: false, reason: 'legacy-checkpoint'}
    const metaCheckpoint = diskMeta.checkpoints?.[active] || null
    if(!metaCheckpoint) return {ok: false, reason: 'checkpoint-meta-missing'}
    if(!checkpointManifestMatchesMeta(manifest, metaCheckpoint, active)) {
        return {ok: false, reason: CHECKPOINT_MANIFEST_META_MISMATCH}
    }

    const shardCount = normalizeCheckpointShardCount(manifest.shardCount)
    if(!shardCount) return {ok: false, reason: 'checkpoint-shard-count-mismatch'}
    const shardIndex = getCheckpointShardIndex(key, shardCount)
    const shard = Array.isArray(manifest.shards) ? manifest.shards[shardIndex] : null
    if(!shard || shard.index !== shardIndex) return {ok: false, reason: 'missing-checkpoint-shard'}
    const verified = getResidentVerifiedShardState(shard, options)
    if(!verified.ok) return {ok: false, reason: verified.reason, shardReason: verified.shardReason}

    const areas = manifest.areas || {map: [], value: []}
    if((areas.value || []).includes(area)) return {ok: false, reason: 'not-a-map-area'}

    const {index, scanned} = extendResidentTailRowIndex(segments)
    const tail = (index.rows.get(residentRowId(area, key)) || [])
        .map(makeWalRecord)
        .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
    const row = projectKeyedRowFromShardState(verified.state, tail, {area, key, snapshotSeq: manifest.snapshotSeq})
    return {
        ok: true,
        reason: '',
        found: row.found,
        value: row.value,
        snapshotSeq: normalizeSeq(manifest.snapshotSeq),
        shardIndex,
        tailRecords: tail.length,
        // Records this call examined. Steady state is 0: the index is already built.
        scannedRecords: scanned
    }
}

// Phase 2 of the mirror plan: the keys a session mirror holds. It is the active
// slot's manifest, its shard records, the active generation's segments, and the meta,
// under the same keys storage uses, so the mirror needs no translation. A keyed read
// against the mirror is the same projection as a keyed read against storage. The
// mirror is only a cache: the disk meta decides whether it may be used.
function getQueueMirrorKeys(meta = null, options = {}) {
    const baseKey = options.baseKey || 'wal'
    if(!isSegmentedWalStorageMeta(meta)) return [getSegmentedWalMetaKey(baseKey)]
    const active = normalizeCheckpointId(meta.activeCheckpoint)
    const keys = [getSegmentedWalMetaKey(baseKey), getSegmentedWalCheckpointKey(baseKey, active)]
    const shardCount = normalizeCheckpointShardCount(meta.checkpoints?.[active]?.shardCount)
    for(let index = 0; index < shardCount; index += 1) {
        keys.push(getSegmentedWalCheckpointShardKey(baseKey, active, index))
    }
    const committedSegments = getSegmentedWalCommittedSegmentCount(meta, active)
    for(let segmentNo = 0; segmentNo < committedSegments; segmentNo += 1) {
        keys.push(getSegmentedWalSegmentKey(baseKey, active, segmentNo))
    }
    return keys
}

// The non-WAL keys of the queue namespace that the session mirror also holds
// (docs/queue-storage-layering.md, section 6): the runs key, the dashboard outlier list key (outliersKey), then every key of the progress projection.
// progressDefaults is getProfileNukeProgressProjectionDefaults([]), which is the progress view plus every
// shard; progress is hashed per href into a fixed shard count, so the full list is the complete progress
// layout, not one shard per href. Pure: the caller supplies the key names and the progress defaults.
function queueNamespaceMirrorKeys(options = {}) {
    const progressKeys = Object.keys(options.progressDefaults || {})
    const keys = options.runsKey ? [options.runsKey] : []
    if(options.outliersKey && !keys.includes(options.outliersKey)) keys.push(options.outliersKey)
    for(const key of progressKeys) {
        if(!keys.includes(key)) keys.push(key)
    }
    return keys
}

// The stamp key of one namespace key (docs/queue-storage-layering.md, section 6, rule 7). Each namespace key has its own
// stamp key: the namespace write that last wrote the key stores a token under it, on disk and, when that write is mirrored,
// in the session mirror. A session copy of a key is used only when its stamp is the disk stamp of that key. Per key, not
// per namespace: a mirrored write of one key must not vouch for another key whose disk copy an unmirrored write changed.
// Pure: the caller supplies the prefix.
function queueNamespaceStampKey(prefix = '', key = '') {
    return `${prefix}${key}`
}

// The stamp keys of a list of namespace keys, in the same order.
function queueNamespaceStampKeys(keys = [], prefix = '') {
    return keys.map(key => queueNamespaceStampKey(prefix, key))
}

// The part of a storage payload (or stored snapshot) that the mirror holds, as an object.
function selectQueueMirrorRecords(stored = {}, meta = null, options = {}) {
    const mirror = {}
    for(const key of getQueueMirrorKeys(meta, options)) {
        if(stored && Object.prototype.hasOwnProperty.call(stored, key)) mirror[key] = stored[key]
    }
    return mirror
}

// Phase 2 freshness. A session mirror may answer a read only when its meta describes the
// same state as the disk meta: the same active slot, the same committed tail, and the same
// next sequence. Anything else means the mirror is behind or ahead, so the read goes to disk.
function isQueueMirrorFresh(mirrorMeta = null, diskMeta = null, options = {}) {
    if(!isSegmentedWalStorageMeta(mirrorMeta) || !isSegmentedWalStorageMeta(diskMeta)) return false
    const active = normalizeCheckpointId(diskMeta.activeCheckpoint)
    return normalizeCheckpointId(mirrorMeta.activeCheckpoint) === active &&
        getSegmentedWalCommittedSegmentCount(mirrorMeta, active) === getSegmentedWalCommittedSegmentCount(diskMeta, active) &&
        normalizeSeq(mirrorMeta.nextSeq) === normalizeSeq(diskMeta.nextSeq)
}

// Rule 6 of docs/queue-storage-layering.md: a sequence marker, not disk meta, decides whether
// a mirror read is fresh. The fingerprint is the three fields isQueueMirrorFresh compares
// (active slot, committed segment count, next sequence), as one string. Returns null for
// anything that is not segmented WAL meta, so a missing meta never matches a marker.
function getQueueWalSeqFingerprint(meta = null) {
    if(!isSegmentedWalStorageMeta(meta)) return null
    const activeCheckpoint = normalizeCheckpointId(meta.activeCheckpoint)
    return `${activeCheckpoint}:${normalizeSeq(meta.nextSeq)}:${getSegmentedWalCommittedSegmentCount(meta, activeCheckpoint)}`
}

// True when a storage payload carries a checkpoint manifest or shard key. Only a write that rewrites a checkpoint does: a checkpoint
// switch, or a full append that cannot be incremental. The mirror append planner and the mirror gate in sw.js both use it.
function payloadHasCheckpointKeys(payload = {}, options = {}) {
    const checkpointPrefix = `${options.baseKey || 'wal'}.checkpoint.`
    return Object.keys(payload || {}).some(key => key.startsWith(checkpointPrefix))
}

// The records one acknowledged append adds to a mirror that already holds the previous
// state. Returns null when the mirror cannot be advanced this way: the active slot changed,
// a checkpoint was written, or the committed count does not line up. Callers then rebuild.
function planQueueMirrorAppend(mirrorMeta = null, payload = {}, options = {}) {
    const baseKey = options.baseKey || 'wal'
    const meta = payload?.[getSegmentedWalMetaKey(baseKey)]
    if(!isSegmentedWalStorageMeta(meta) || !isSegmentedWalStorageMeta(mirrorMeta)) return null
    const active = normalizeCheckpointId(meta.activeCheckpoint)
    if(normalizeCheckpointId(mirrorMeta.activeCheckpoint) !== active) return null
    if(payloadHasCheckpointKeys(payload, {baseKey})) return null

    const committedBefore = getSegmentedWalCommittedSegmentCount(mirrorMeta, active)
    const committedNow = getSegmentedWalCommittedSegmentCount(meta, active)
    if(committedNow < committedBefore) return null
    const records = {[getSegmentedWalMetaKey(baseKey)]: meta}
    for(let segmentNo = committedBefore; segmentNo < committedNow; segmentNo += 1) {
        const key = getSegmentedWalSegmentKey(baseKey, active, segmentNo)
        if(!Object.prototype.hasOwnProperty.call(payload, key)) return null
        records[key] = payload[key]
    }
    return {records, meta}
}

// A full mirror, built from a stored snapshot. Returns ok: false if any key the mirror needs
// is absent, because a partial mirror would answer wrongly.
function planQueueMirrorRebuild(stored = {}, meta = null, options = {}) {
    const keys = getQueueMirrorKeys(meta, options)
    const missingKeys = keys.filter(key => !(stored && Object.prototype.hasOwnProperty.call(stored, key)))
    if(missingKeys.length) return {ok: false, reason: 'mirror-keys-missing', missingKeys, records: {}}
    return {ok: true, reason: '', records: selectQueueMirrorRecords(stored, meta, options), meta}
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
    if(checkpoint.format === CHECKPOINT_SHARD_FORMAT) return decodeShardedCheckpointState(checkpoint, options)
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
            stateHash: checkpoint.stateHash,
            shardCount: normalizeCheckpointShardCount(checkpoint.shardCount)
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

// Every segment makeWalSegment returns is registered here. A registered segment is a fixed point of makeWalSegment: its
// records are already normalized and sorted, and its id, seqs and sealed flag follow from them, so rebuilding it gives an
// equal object. makeWalGeneration shares a registered segment instead of rebuilding it, so an append does not normalize
// every record of the active generation again. Nothing writes into a segment after it is made.
const normalizedWalSegments = new WeakSet()

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

    const segment = {
        id: `${options.id || `wal-${fromSeq}-${toSeq}`}`,
        fromSeq,
        toSeq,
        sealed: options.sealed !== false,
        records: normalizedRecords
    }
    normalizedWalSegments.add(segment)
    return segment
}

function makeWalGeneration(options = {}) {
    return {
        snapshotSeq: normalizeSeq(options.snapshotSeq),
        segments: (options.segments || []).map(segment => normalizedWalSegments.has(segment)
            ? segment
            : makeWalSegment(segment.records || [], segment))
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
    const activeShardCount = normalizeCheckpointShardCount(meta.checkpoints?.[activeCheckpoint]?.shardCount)
    for(const key of getSegmentedWalCheckpointShardKeys(baseKey, activeCheckpoint, activeShardCount)) defaults[key] = null
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
            const checkpoint = store.checkpoints[id] || null
            if(checkpoint?.format === CHECKPOINT_SHARD_FORMAT) {
                payload[getSegmentedWalCheckpointKey(baseKey, id)] = getCheckpointManifest(checkpoint)
                for(const shard of checkpoint.shards || []) {
                    payload[getSegmentedWalCheckpointShardKey(baseKey, id, shard.index)] = getCheckpointShardRecord(checkpoint, shard)
                }
            }
            else {
                payload[getSegmentedWalCheckpointKey(baseKey, id)] = cloneJson(checkpoint)
            }
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
    const activeRead = readStoredCheckpoint(stored, baseKey, activeCheckpoint)
    const checkpoint = activeRead.checkpoint
    if(!activeRead.ok || !checkpoint) {
        return {ok: false, reason: activeRead.reason || 'missing-checkpoint', missingKey: activeRead.missingKey, store: null, meta}
    }
    // The active manifest must be the one the metadata describes, the same binding the keyed read enforces
    // (checkpointManifestMatchesMeta). A manifest and a fingerprint from different writes fail closed, and no state is
    // rebuilt from either of them. A monolithic slot with no fingerprint predates fingerprints and has nothing to bind to,
    // so it loads as before. A sharded slot is always written with its fingerprint, so a missing one is refused.
    const metaCheckpoint = meta.checkpoints?.[activeCheckpoint] || null
    if(metaCheckpoint || checkpoint.format === CHECKPOINT_SHARD_FORMAT) {
        if(!metaCheckpoint) {
            return {ok: false, reason: 'checkpoint-meta-missing', store: null, meta}
        }
        if(!checkpointManifestMatchesMeta(checkpoint, metaCheckpoint, activeCheckpoint)) {
            return {
                ok: false,
                reason: CHECKPOINT_MANIFEST_META_MISMATCH,
                missingKey: getSegmentedWalCheckpointKey(baseKey, activeCheckpoint),
                store: null,
                meta
            }
        }
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
    const inactiveRead = readStoredCheckpoint(stored, baseKey, inactiveCheckpoint)
    const inactiveStored = inactiveRead.ok ? inactiveRead.checkpoint : null
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

// Appends records to one generation and returns the next store. The input store is never written to. The next store is
// a new top-level object with a new meta and a new wal map. The checkpoints and every generation except the target are
// shared with the input, and so are the target's segment objects (makeWalSegment registers them, makeWalGeneration shares
// them). The target's segments array is new, so the new segment goes onto that copy. Records are normalized as before:
// each one is cloned and passed through makeWalRecord. Sharing returns the same store the old full clone did as long as
// the store is JSON-clean, which holds for every store this module builds or reads back from storage. A rejected append
// still returns a full clone.
function appendWalRecordsToGeneration(store = {}, records = [], options = {}) {
    const generationId = normalizeCheckpointId(options.generationId, store?.meta?.activeCheckpoint || CHECKPOINT_A)
    const activeGenerationId = normalizeCheckpointId(store?.meta?.activeCheckpoint || CHECKPOINT_A)
    if(generationId !== activeGenerationId && options.allowInactiveAppend !== true) {
        const rejectedStore = cloneJson(store)
        return {
            store: rejectedStore,
            generationId,
            records: [],
            generation: getWalGeneration(rejectedStore, generationId),
            rejected: true,
            reason: 'inactive-generation-append'
        }
    }
    const generation = getWalGeneration(store, generationId)
    let nextSeq = Math.max(
        normalizeSeq(store?.meta?.nextSeq, normalizeSeq(generation.snapshotSeq) + 1),
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

    const nextStore = {...store}
    nextStore.meta = cloneJson(store?.meta)
    nextStore.wal = {
        ...(store?.wal || {}),
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
        codecName: options.codecName,
        shardCount: options.shardCount
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
    else if(record.kind === 'map.appendUnique') {
        if(!record.area) return {ok: false, reason: 'missing-area'}
        if(!record.key) return {ok: false, reason: 'missing-key'}
        if(!record.field) return {ok: false, reason: 'missing-field'}
        if(!Array.isArray(record.values)) return {ok: false, reason: 'missing-values'}
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

// A map branch needs a writable copy of its area. A caller that owns its state (projectSnapshot)
// passes context.ownedAreas: the first copy of an area is made once, and later records in the same
// replay write into it. Without ownedAreas every record copies, as before, so the reducer stays pure.
function takeAreaForWrite(nextState = {}, area = '', context = {}) {
    const current = nextState[area]
    if(context.ownedAreas?.has(area) && current && typeof current === 'object' && !Array.isArray(current)) {
        return current
    }
    const copy = {...normalizeObject(current)}
    context.ownedAreas?.add(area)
    return copy
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

    // A shallow copy is sufficient here, not cloneJson's full JSON
    // round-trip: every branch below replaces nextState[area] wholesale with
    // a freshly-built map/list (itself copy-on-write per touched row), so no
    // branch ever mutates a nested object still shared with the caller's
    // `state`. Replaying N records against a full authority snapshot used to
    // cost O(N * totalStateSize) -- a full deep clone of the ENTIRE queue
    // (including every terminal row ever processed) on every single record
    // -- which is what made replay cost grow without bound as more items
    // completed, independent of the WAL segment-count fix.
    const nextState = {...(state || {})}
    const area = record.area

    if(record.kind === 'map.remove') {
        const map = takeAreaForWrite(nextState, area, context)
        delete map[record.key]
        nextState[area] = map
    }
    else if(record.kind === 'map.set') {
        const map = takeAreaForWrite(nextState, area, context)
        const value = cloneJson(record.value || {})
        const check = shouldApplyPatch(map[record.key] || null, value, record)
        if(!check.ok) return {state, applied: false, reason: check.reason, record}
        map[record.key] = value
        nextState[area] = map
    }
    else if(record.kind === 'map.patch') {
        const map = takeAreaForWrite(nextState, area, context)
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
    else if(record.kind === 'map.appendUnique') {
        // Adds the values the list does not hold yet, in the order given. Replaying the same record again adds nothing, so it is
        // idempotent. The record carries every value it adds, so the log alone rebuilds the list.
        const map = takeAreaForWrite(nextState, area, context)
        const previous = map[record.key] || {}
        const current = Array.isArray(previous[record.field]) ? previous[record.field] : []
        const seen = new Set(current)
        const fresh = []
        for (const value of record.values) {
            if (typeof value !== 'string' || !value || seen.has(value)) continue
            seen.add(value)
            fresh.push(value)
        }
        if (!fresh.length) {
            context.appliedIds?.add(record.id)
            return {state, applied: false, reason: 'nothing-new', record}
        }
        map[record.key] = {...previous, [record.field]: [...current, ...fresh]}
        nextState[area] = map
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
    // state is our own clone, so each area is copied once and then written in place.
    const ownedAreas = new Set()

    for(const record of sortedRecords) {
        const result = applyWalRecord(state, record, {snapshotSeq, appliedIds, ownedAreas})
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
        appliedIds: Array.from(appliedIds)
        // No `stateHash` here on purpose: this used to run `hashState`
        // (a hand-rolled recursive key-sorting stringify, pricier than plain
        // JSON.stringify) over the entire post-replay state on every single
        // `projectSnapshot`/`recoverProjectedState` call -- WAL recovery on
        // load, every checkpoint switch (which itself calls this multiple
        // times), and every CLI recovery tool. Repo-wide grep confirmed no
        // caller (production or test) ever reads `.stateHash` off this
        // return value -- it was write-only. Checkpoint-level integrity
        // verification is unaffected: `verifyCheckpoint` (used by
        // `activateCheckpoint`/`recoverActiveCheckpoint`) still calls
        // `hashState` on the decoded checkpoint and compares it against the
        // stored `checkpoint.stateHash`, and still rejects a mismatch --
        // see the fuzz-test case `activate-hash-mismatch-checkpoint`.
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

// The keys one keyed row read needs: the meta key, any extra defaults the caller asked for, and the
// row's keys for the meta's active slot. Pure, so the caller does the storage read and only that.
function planKeyedRowReads(meta = null, wanted = [], options = {}) {
    const baseKey = options.baseKey || 'wal'
    const metaKey = options.metaKey || getSegmentedWalMetaKey(baseKey)
    const readKeys = {[metaKey]: null, ...(options.extraDefaults || {})}
    for(const key of wanted) {
        for(const readKey of getKeyedRowReadKeys(meta, key, {baseKey})) {
            readKeys[readKey] = null
        }
    }
    return readKeys
}

// Projects each wanted row out of a stored snapshot. Stops at the first row that cannot be projected and
// returns its reason, so the caller can decide whether a retry is worth it. Pure.
function projectKeyedRows(stored = {}, wanted = [], options = {}) {
    const rows = {}
    for(const key of wanted) {
        const projected = projectKeyedRowFromStored(stored, {
            baseKey: options.baseKey,
            area: 'queue',
            key,
            ...(options.codecOptions || {})
        })
        if(!projected.ok) return {ok: false, reason: projected.reason, rows: {}}
        if(projected.found) rows[key] = projected.value
    }
    return {ok: true, reason: '', rows}
}

module.exports = {
    CHECKPOINT_MANIFEST_META_MISMATCH,
    checkpointManifestMatchesMeta,
    findCheckpointManifestDisagreements,
    getCheckpointFingerprint,
    payloadHasCheckpointKeys,
    planKeyedRowReads,
    projectKeyedRows,
    CHECKPOINT_A,
    CHECKPOINT_B,
    CHECKPOINT_SHARD_DEFAULT_COUNT,
    CHECKPOINT_SHARD_FORMAT,
    normalizeCheckpointId,
    normalizeCheckpointShardCount,
    DEFAULT_RECOVERY_CRITICAL_AREAS,
    getCheckpointManifest,
    getSegmentedWalCheckpointShardKey,
    getSegmentedWalCheckpointShardKeys,
    makeShardedCheckpoint,
    mergeCheckpointShardStates,
    partitionCheckpointState,
    readStoredCheckpoint,
    getKeyedRowReadKeys,
    getQueueMirrorKeys,
    queueNamespaceMirrorKeys,
    queueNamespaceStampKey,
    queueNamespaceStampKeys,
    selectQueueMirrorRecords,
    isQueueMirrorFresh,
    getQueueWalSeqFingerprint,
    planQueueMirrorAppend,
    planQueueMirrorRebuild,
    projectKeyedRowFromStored,
    projectKeyedRowFromResidentStore,
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
