const assert = require('node:assert/strict')
const {
    CHECKPOINT_A,
    CHECKPOINT_B,
    activateCheckpoint,
    appendWalRecordsToGeneration,
    buildSegmentedWalStoragePayload,
    checkpointAreaShardId,
    checkpointShardNamespace,
    getSegmentedWalMetaKey,
    getSegmentedWalSegmentKey,
    makePairedCheckpointStore,
    recoverProjectedState,
    writeInactiveCheckpoint
} = require('../shared/js/walSnapshotStore')
const {createQueueWalStore} = require('../shared/js/swQueueWalStore')
const {createCoordinatorQueueWalStore} = require('../shared/js/swCoordinatorQueueWal')

const BASE_KEY = 'mbTestQueueWal'
const META_KEY = getSegmentedWalMetaKey(BASE_KEY)
// The active slot's manifest key, and the diagnostic and flight recorder kinds the checkpoint binding records.
const SLOT_MANIFEST_KEY = `${BASE_KEY}.checkpoint.${CHECKPOINT_B}`
const MISMATCH_EVENT = 'coordinator-authority-queue-wal-checkpoint-mismatch'
const RECOVERED_EVENT = 'coordinator-authority-queue-wal-checkpoint-recovered-from-mirror'
const ROW_HREF = 'https://example.test/checkpoint-binding-row'

// A segmented meta (storage version 1) with `committed` segments on the active checkpoint.
function segmentedMeta(activeCheckpoint = CHECKPOINT_A, committed = 0) {
    return {
        activeCheckpoint,
        segmentedStorage: {
            version: 1,
            committedSegments: {[CHECKPOINT_A]: 0, [CHECKPOINT_B]: 0, [activeCheckpoint]: committed}
        }
    }
}

// Every dependency is a stub that records what it was asked, so the test does not need sw.js. The disk and the session
// mirror are plain objects. options.diskSnapshots lists what each atomic storage read returns, in order (the last one
// repeats). options.mirrorCopy holds the session mirror's keys, or is null when there is no session area.
function makeLayer(options = {}) {
    const metrics = []
    const reads = []
    const diagnostics = []
    const flightEntries = []
    const mirrorReads = []
    const diskSnapshots = options.diskSnapshots || []
    let diskReadCount = 0
    const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key] ?? null]))
    const layer = createQueueWalStore({
        constants: {
            COORDINATOR_QUEUE_WAL_KEY: BASE_KEY,
            COORDINATOR_QUEUE_WAL_META_KEY: META_KEY,
            COORDINATOR_QUEUE_WAL_HYDRATE_ATTEMPTS: 2,
            COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT: 1024,
            COORDINATOR_QUEUE_WAL_ATOMIC_READ_SEGMENT_SUPERSET: 64,
            COORDINATOR_QUEUE_WAL_CHECKPOINT_SHARD_COUNT: 4,
            COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT: 128
        },
        metrics: {
            incrementQueueWakeupMetric: (name, by = 1) => metrics.push({name, by}),
            recordQueueWakeupMetricMax: () => {},
            runQueueWakeupMetricPhase: (name, fn) => fn()
        },
        diagnostics: {
            recordCoordinatorDiagnosticEvent: (type, message, details) => diagnostics.push({type, message, details}),
            recordFlightRecorderEvent: entry => flightEntries.push(entry)
        },
        storage: {
            metricStorageGet: async (defaults = {}) => {
                reads.push(Object.keys(defaults))
                if(!diskSnapshots.length) return {}
                const snapshot = diskSnapshots[Math.min(diskReadCount, diskSnapshots.length - 1)]
                diskReadCount += 1
                return pick(snapshot, Object.keys(defaults))
            }
        },
        mirror: {
            readCheckpointKeys: async keys => {
                mirrorReads.push(keys)
                return options.mirrorCopy ? pick(options.mirrorCopy, keys) : null
            }
        },
        checkpoints: {
            scheduleSwitch: () => null,
            checkQuotaHealth: async () => false
        },
        authority: {
            normalizeMap: value => ({...(value || {})}),
            makeCheckpoint: queue => ({fromSnapshot: queue}),
            normalizeStore: (value, snapshotQueue) => value || {fromSnapshot: snapshotQueue},
            canUseResidentForMeta: (store, meta) => Boolean(store) && store.meta?.activeCheckpoint === meta?.activeCheckpoint
        }
    })
    return {layer, metrics, reads, diagnostics, flightEntries, mirrorReads}
}

// One sharded checkpoint in the active slot, with one queue row. Four shards, to match the layer's constants.
function shardedCheckpointPayload(attemptId, createdAt) {
    const state = {queue: {[ROW_HREF]: {status: 'queued', attemptId, attemptNumber: 1, runId: 'run-checkpoint-binding'}}, completed: {}}
    const written = writeInactiveCheckpoint(makePairedCheckpointStore({}, {snapshotSeq: 0}), state, {
        snapshotSeq: 5,
        snapshotEpoch: 1,
        createdAt,
        shardCount: 4
    })
    const activated = activateCheckpoint(written.store, written.checkpointId, {})
    assert.equal(activated.activated, true, activated.reason)
    return buildSegmentedWalStoragePayload(activated.store, {baseKey: BASE_KEY, writeCheckpoints: true})
}

// The keys of one checkpoint slot (its manifest and its shard records) in a payload.
function slotKeys(payload, slot) {
    return Object.keys(payload).filter(key => key === `${BASE_KEY}.checkpoint.${slot}` || key.startsWith(`${BASE_KEY}.checkpoint.${slot}.s`))
}

// A copy of `payload` whose keys for one slot come from `source`: the disk after a torn write, or a session copy that disagrees.
function withSlotFrom(payload, source, slot) {
    const copy = {...payload}
    for(const key of slotKeys(source, slot)) copy[key] = source[key]
    return copy
}

// An area-v1 checkpoint (the arrival partition, as the queue writes it): one queue row in the queue's namespace and one completed row in
// the completed namespace, so the active slot holds a queue shard and a completed shard.
const DONE_ROW_HREF = 'https://example.test/checkpoint-binding-done-row'
// The area-v1 checkpoint of areaV1ShardedPayload, with one WAL segment appended per tail record, in order, after the checkpoint. The
// payload is what the disk holds: the tail segments are the records written after the checkpoint.
function areaV1PayloadWithTail(attemptId, createdAt, tailRecords = []) {
    const state = {
        queue: {[ROW_HREF]: {status: 'queued', attemptId, attemptNumber: 1, runId: 'run-checkpoint-binding', local: 0}},
        completed: {[DONE_ROW_HREF]: {status: 'succeeded', attemptId: `${attemptId}-done`, local: 7}},
        runs: {}
    }
    const written = writeInactiveCheckpoint(makePairedCheckpointStore({}, {snapshotSeq: 0}), state, {
        snapshotSeq: 5,
        snapshotEpoch: 1,
        createdAt,
        shardOf: (area, key, entry) => checkpointAreaShardId(area, entry.local)
    })
    const activated = activateCheckpoint(written.store, written.checkpointId, {})
    assert.equal(activated.activated, true, activated.reason)
    let store = activated.store
    for (const record of tailRecords) {
        store = appendWalRecordsToGeneration(store, [record], {generationId: store.meta.activeCheckpoint}).store
    }
    return buildSegmentedWalStoragePayload(store, {baseKey: BASE_KEY, writeCheckpoints: true})
}

function areaV1ShardedPayload(attemptId, createdAt) {
    return areaV1PayloadWithTail(attemptId, createdAt, [])
}

// The keys of the queue namespace's shards in a payload, for both slots.
function queueShardKeysOf(payload) {
    return Object.keys(payload).filter(key => {
        const match = /\.checkpoint\.[AB]\.s(\d+)$/.exec(key)
        return match !== null && checkpointShardNamespace(match[1]) === 0
    })
}

// The session copy as the worker keeps it when the active slot has `committed` segments: the meta with that committed count, the active
// manifest, the queue shards the manifest names, and the first `committed` segments of the active slot.
function sessionCopyOf(payload, committed) {
    const meta = payload[META_KEY]
    const slot = meta.activeCheckpoint
    const manifestKey = `${BASE_KEY}.checkpoint.${slot}`
    const copy = {
        [META_KEY]: {
            ...meta,
            segmentedStorage: {
                ...meta.segmentedStorage,
                committedSegments: {...meta.segmentedStorage.committedSegments, [slot]: committed}
            }
        },
        [manifestKey]: payload[manifestKey]
    }
    for (const key of queueShardKeysOf(payload)) {
        if (key.startsWith(`${manifestKey}.s`)) copy[key] = payload[key]
    }
    for (let segmentNo = 0; segmentNo < committed; segmentNo += 1) {
        const key = getSegmentedWalSegmentKey(BASE_KEY, slot, segmentNo)
        copy[key] = payload[key]
    }
    return copy
}

// The disk payload with its active slot naming `count` committed segments (the segments themselves are the caller's).
function withActiveSegmentCount(payload, count) {
    const meta = payload[META_KEY]
    const slot = meta.activeCheckpoint
    return {
        ...payload,
        [META_KEY]: {
            ...meta,
            segmentedStorage: {...meta.segmentedStorage, committedSegments: {...meta.segmentedStorage.committedSegments, [slot]: count}},
            generations: {...meta.generations, [slot]: {...meta.generations[slot], segments: count}}
        }
    }
}

// An area-v1 checkpoint of `state` (the arrival partition, as the queue writes it), with no WAL segments on top. Each entry is placed in its
// area's shard by its `local` value.
function areaShardedPayloadOf(state, createdAt) {
    const written = writeInactiveCheckpoint(makePairedCheckpointStore({}, {snapshotSeq: 0}), state, {
        snapshotSeq: 5,
        snapshotEpoch: 1,
        createdAt,
        shardOf: (area, key, entry) => checkpointAreaShardId(area, entry.local)
    })
    const activated = activateCheckpoint(written.store, written.checkpointId, {})
    assert.equal(activated.activated, true, activated.reason)
    return buildSegmentedWalStoragePayload(activated.store, {baseKey: BASE_KEY, writeCheckpoints: true})
}

// What the disk holds with no segmented meta: the two slot manifests of a payload, and no meta.
function manifestsOnly(payload) {
    return {
        [`${BASE_KEY}.checkpoint.${CHECKPOINT_A}`]: payload[`${BASE_KEY}.checkpoint.${CHECKPOINT_A}`],
        [`${BASE_KEY}.checkpoint.${CHECKPOINT_B}`]: payload[`${BASE_KEY}.checkpoint.${CHECKPOINT_B}`]
    }
}

const REFUSED_METRIC = 'coordinatorAuthority.queueWal.queueOnlyCheckpointRefused'
const RUN_KEY = 'run-queue-only-guard'

// The coordinator WAL factory as the worker builds it (walSnapshotStore.test.js builds the same one), with the metric names recorded.
function makeCoordinatorWorker(metricNames = []) {
    return createCoordinatorQueueWalStore({
        constants: {
            COORDINATOR_QUEUE_WAL_KEY: BASE_KEY,
            COORDINATOR_QUEUE_WAL_META_KEY: META_KEY,
            COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT: 128,
            COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT: 1024,
            COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS: []
        },
        metrics: {
            incrementQueueWakeupMetric: name => metricNames.push(name),
            recordQueueWakeupMetricMax: () => {},
            getJsonByteSize: value => JSON.stringify(value || null).length
        },
        authority: {
            cloneCoordinatorAuthorityValue: value => JSON.parse(JSON.stringify(value ?? null)),
            normalizeCoordinatorAuthorityRowKey: key => `${key || ''}`,
            normalizeSnapshotWriteReason: reason => `${reason || 'ordinaryMutation'}`,
            normalizeQueueWriteOperationName: name => `${name || 'write'}`,
            getAttemptIdFromValue: value => `${value?.attemptId || ''}`,
            getAttemptNumberFromValue: value => Number.parseInt(value?.attemptNumber, 10) || 0,
            makeCoordinatorQueueWalCheckpoint: state => makePairedCheckpointStore(state, {})
        },
        runtime: {Date}
    })
}

// Each scenario reports on its own line, so one failing scenario does not hide the ones after it.
const failedScenarios = []
async function scenario(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        failedScenarios.push(name)
        console.log(`not ok - ${name}: ${`${error?.message || error}`.split('\n')[0]}`)
    }
}

async function main() {
// A missing dependency fails when the module is built, not on first use.
assert.throws(() => createQueueWalStore({}), /Missing queue WAL store dependency/)

// The resident copy starts empty. A store is kept only when its active checkpoint has committed segments.
{
    const {layer} = makeLayer()
    assert.equal(layer.resident.get(), null)
    layer.resident.set({meta: segmentedMeta(CHECKPOINT_A, 0)})
    assert.equal(layer.resident.get(), null)
    const withSegments = {meta: segmentedMeta(CHECKPOINT_A, 2)}
    layer.resident.set(withSegments)
    assert.equal(layer.resident.get(), withSegments)
    layer.resident.set(null)
    assert.equal(layer.resident.get(), null)
    layer.resident.set(withSegments)
    layer.resident.clear()
    assert.equal(layer.resident.get(), null)
}

// cacheFromWrite keeps the store with the meta the write actually put in storage, and ignores a payload with no meta.
{
    const {layer} = makeLayer()
    const written = segmentedMeta(CHECKPOINT_A, 3)
    layer.cacheFromWrite({meta: segmentedMeta(CHECKPOINT_A, 0), wal: {}}, {[META_KEY]: written})
    assert.deepEqual(layer.resident.get().meta, written)

    const before = layer.resident.get()
    layer.cacheFromWrite({meta: segmentedMeta(CHECKPOINT_A, 9), wal: {}}, {})
    assert.equal(layer.resident.get(), before)
}

// With no segmented meta in stored, the load reads the monolithic key once and falls back to the normaliser.
{
    const {layer, reads} = makeLayer()
    const stored = {}
    const snapshot = {a: {}}
    const result = await layer.loadStoreFromStorage(stored, snapshot, {})
    assert.deepEqual(result, {fromSnapshot: snapshot})
    assert.equal(stored[BASE_KEY], result)
    // The monolith read also asks for the two slot manifests (the queue-only guard reads them from this same read).
    assert.deepEqual(reads, [[BASE_KEY, `${BASE_KEY}.checkpoint.${CHECKPOINT_A}`, `${BASE_KEY}.checkpoint.${CHECKPOINT_B}`]])
}

// A resident store that the canUse check accepts answers the load with no storage read, and counts a resident use.
{
    const {layer, metrics, reads} = makeLayer()
    const resident = {meta: segmentedMeta(CHECKPOINT_A, 2), wal: {}}
    layer.resident.set(resident)
    const stored = {[META_KEY]: segmentedMeta(CHECKPOINT_A, 2)}
    const result = await layer.loadStoreFromStorage(stored, {}, {})
    assert.equal(result, resident)
    assert.equal(stored[BASE_KEY], resident)
    assert.deepEqual(reads, [])
    assert.deepEqual(metrics.map(m => m.name), ['coordinatorAuthority.queueWal.residentStoreUsed'])
}

// Checkpoint binding (docs/queue-storage-layering.md, section 6, and the hydrate chain in loadStoreFromStorage). A torn write
// leaves the active slot's manifest from an older checkpoint, while the disk meta names the current one. The session mirror
// holds the current checkpoint. Each scenario is one way the restart can go.
{
    const staleSlotPayload = shardedCheckpointPayload('attempt-stale-slot', 1000)
    const currentPayload = shardedCheckpointPayload('attempt-current-slot', 2000)
    const disagreeingPayload = shardedCheckpointPayload('attempt-disagreeing-copy', 3000)
    const tornDisk = withSlotFrom(currentPayload, staleSlotPayload, CHECKPOINT_B)
    const currentStored = () => ({[META_KEY]: currentPayload[META_KEY]})

    // (a) The mirror's copy agrees with the disk meta: it is used, and the store holds its rows.
    await scenario('a torn checkpoint manifest is recovered from the session mirror copy that agrees with the disk meta', async () => {
        const {layer, mirrorReads, diagnostics, metrics} = makeLayer({diskSnapshots: [tornDisk], mirrorCopy: currentPayload})
        const stored = currentStored()
        const result = await layer.loadStoreFromStorage(stored, {}, {})
        assert.equal(recoverProjectedState(result).projected.state.queue[ROW_HREF].attemptId, 'attempt-current-slot')
        assert.equal(stored[BASE_KEY], result)
        assert.equal(mirrorReads.length, 1)
        assert.ok(mirrorReads[0].includes(SLOT_MANIFEST_KEY))
        assert.ok(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointRecoveredFromMirror'))
        assert.ok(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointMirrorCopyUsedDiskTorn'), 'the copy is counted as used because disk was torn')
        const recovered = diagnostics.find(entry => entry.type === RECOVERED_EVENT)
        assert.ok(recovered, 'the recovery is recorded')
        assert.ok(recovered.message.includes(currentPayload[SLOT_MANIFEST_KEY].stateHash), 'the copy that was used is named')
        assert.ok(recovered.message.includes(staleSlotPayload[SLOT_MANIFEST_KEY].stateHash), 'the disk manifest it replaced is named')
    })

    // (a2) An area-v1 copy holds the queue's shards only. The recovery takes the queue shards from the copy and reads the completed shard
    // the copy does not hold from disk. That read is the last one, and it names exactly the non-queue shard keys of the active slot.
    await scenario('a torn manifest recovered from an area-v1 copy reads the completed shard the copy does not hold from disk', async () => {
        const areaCurrent = areaV1ShardedPayload('attempt-area-current', 2000)
        const meta = areaCurrent[META_KEY]
        const manifestKey = `${BASE_KEY}.checkpoint.${meta.activeCheckpoint}`
        const shardPrefix = `${manifestKey}.s`
        const activeShardKeys = Object.keys(areaCurrent).filter(key => key.startsWith(shardPrefix))
        const nonQueueKeys = activeShardKeys.filter(key => checkpointShardNamespace(key.slice(shardPrefix.length)) !== 0)
        assert.equal(nonQueueKeys.length, 1, 'the fixture has one completed shard in the active slot')
        // The copy as the session holds it: the meta, the manifest, the segments and the queue shard, and no completed shard.
        const copy = Object.fromEntries(Object.entries(areaCurrent).filter(([key]) => !nonQueueKeys.includes(key)))
        // A torn write: the disk manifest disagrees with the disk meta. Its shards are the same, so the disk copy of the completed shard is good.
        const torn = {...areaCurrent, [manifestKey]: {...areaCurrent[manifestKey], stateHash: 'torn-area-manifest'}}
        const {layer, mirrorReads, reads, metrics} = makeLayer({diskSnapshots: [torn], mirrorCopy: copy})
        const result = await layer.loadStoreFromStorage({[META_KEY]: meta}, {}, {})
        const state = recoverProjectedState(result).projected.state
        assert.equal(state.queue[ROW_HREF].attemptId, 'attempt-area-current', 'the queue comes from the copy')
        assert.equal(state.completed[DONE_ROW_HREF].attemptId, 'attempt-area-current-done', 'the completed row comes from disk')
        assert.equal(mirrorReads.length, 1)
        assert.ok(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointRecoveredFromMirror'))
        assert.ok(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointMirrorCopyUsedDiskTorn'))
        assert.deepEqual(reads.at(-1), nonQueueKeys, 'the last read is the completed shard the copy does not hold')
    })

    // (b) No mirror copy at all: the store is refused, nothing is written, and the mismatch with both fingerprints is recorded.
    await scenario('a torn checkpoint manifest with no usable mirror copy fails closed and records both fingerprints', async () => {
        const {layer, diagnostics, flightEntries, metrics} = makeLayer({diskSnapshots: [tornDisk], mirrorCopy: null})
        const stored = currentStored()
        await assert.rejects(
            () => layer.loadStoreFromStorage(stored, {}, {}),
            error => error?.walDecodeFailed === true && /segmented queue WAL hydrate failed: checkpoint-manifest-meta-mismatch/.test(error.message)
        )
        assert.equal(stored[BASE_KEY], undefined, 'no store is accepted')
        assert.equal(layer.resident.get(), null)
        const mismatch = diagnostics.find(entry => entry.type === MISMATCH_EVENT)
        assert.ok(mismatch, 'the fail-closed path records the mismatch')
        assert.match(mismatch.message, /Active checkpoint B\b/)
        assert.ok(mismatch.message.includes(currentPayload[SLOT_MANIFEST_KEY].stateHash), 'the metadata fingerprint is named')
        assert.ok(mismatch.message.includes(staleSlotPayload[SLOT_MANIFEST_KEY].stateHash), 'the manifest fingerprint is named')
        assert.ok(flightEntries.some(entry => entry.kind === 'queue-wal-checkpoint-mismatch'))
        assert.ok(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointMismatch'))
    })

    // (c) The mirror's copy disagrees with the disk meta too: it is not used, and the refusal names the copy that was rejected.
    await scenario('a session mirror copy that disagrees with the disk meta is not used, and the refusal names it', async () => {
        const {layer, diagnostics, metrics} = makeLayer({diskSnapshots: [tornDisk], mirrorCopy: disagreeingPayload})
        const stored = currentStored()
        await assert.rejects(() => layer.loadStoreFromStorage(stored, {}, {}), error => error?.walDecodeFailed === true)
        assert.equal(stored[BASE_KEY], undefined, 'no store is accepted')
        assert.equal(diagnostics.some(entry => entry.type === RECOVERED_EVENT), false)
        assert.ok(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointMirrorCopyRejected'))
        const mismatch = diagnostics.find(entry => entry.type === MISMATCH_EVENT)
        assert.ok(mismatch, 'the fail-closed path records the mismatch')
        assert.ok(mismatch.message.includes(disagreeingPayload[SLOT_MANIFEST_KEY].stateHash), 'the rejected copy is named')
    })

    // (d) A torn read that the single re-read resolves is accepted from disk, and the mirror is not consulted.
    await scenario('a torn read that the single re-read resolves is accepted without consulting the mirror', async () => {
        const {layer, reads, mirrorReads, diagnostics} = makeLayer({diskSnapshots: [tornDisk, currentPayload], mirrorCopy: null})
        const stored = currentStored()
        const result = await layer.loadStoreFromStorage(stored, {}, {})
        assert.equal(recoverProjectedState(result).projected.state.queue[ROW_HREF].attemptId, 'attempt-current-slot')
        assert.equal(reads.length, 2, 'one re-read')
        assert.equal(mirrorReads.length, 0)
        assert.equal(diagnostics.some(entry => entry.type === MISMATCH_EVENT), false)
    })

    // Disk first (slice 4). An intact disk checkpoint is never replaced by the session copy: the copy is not read at all. A torn one
    // takes the copy only when the copy verifies. Each layout gets the same three cases: legacy (shared layout) and area-v1.
    const mirrorCounterNames = name => name.startsWith('coordinatorAuthority.queueWal.checkpointMirrorCopy') || name === 'coordinatorAuthority.queueWal.checkpointRecoveredFromMirror'

    await scenario('an intact legacy disk checkpoint wins over a consistent session copy, and the copy is not read', async () => {
        const {layer, mirrorReads, metrics, diagnostics} = makeLayer({diskSnapshots: [currentPayload], mirrorCopy: disagreeingPayload})
        const stored = currentStored()
        const result = await layer.loadStoreFromStorage(stored, {}, {})
        assert.equal(recoverProjectedState(result).projected.state.queue[ROW_HREF].attemptId, 'attempt-current-slot')
        assert.equal(mirrorReads.length, 0, 'the session copy is not read')
        assert.equal(metrics.some(m => mirrorCounterNames(m.name)), false, 'no mirror copy is counted')
        assert.equal(diagnostics.some(entry => entry.type === RECOVERED_EVENT || entry.type === MISMATCH_EVENT), false)
    })

    await scenario('a torn legacy checkpoint with a copy that agrees with the meta but fails its shard hash is refused', async () => {
        // The copy's manifest agrees with the disk meta, and one of its shard records holds a state that does not hash to the manifest.
        const copy = {...currentPayload}
        const queueShardKey = slotKeys(currentPayload, CHECKPOINT_B).find(key => key.startsWith(`${SLOT_MANIFEST_KEY}.s`) &&
            Object.keys(currentPayload[key].state?.queue || {}).length > 0)
        assert.ok(queueShardKey, 'the fixture has a shard that holds the queue row')
        const record = currentPayload[queueShardKey]
        const tamperedRow = {...record.state.queue[ROW_HREF], attemptId: 'attempt-tampered-shard'}
        copy[queueShardKey] = {...record, state: {...record.state, queue: {[ROW_HREF]: tamperedRow}}}
        const {layer, diagnostics, metrics} = makeLayer({diskSnapshots: [tornDisk], mirrorCopy: copy})
        const stored = currentStored()
        await assert.rejects(() => layer.loadStoreFromStorage(stored, {}, {}), error => error?.walDecodeFailed === true)
        assert.equal(stored[BASE_KEY], undefined, 'no store is accepted')
        assert.ok(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointMirrorCopyRejected'))
        assert.equal(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointRecoveredFromMirror'), false)
        const mismatch = diagnostics.find(entry => entry.type === MISMATCH_EVENT)
        assert.ok(mismatch && mismatch.message.includes('unusable (checkpoint-shard-hash-mismatch'), 'the refusal names the shard hash check')
    })

    await scenario('an intact area-v1 disk checkpoint wins over a consistent session copy, and the copy is not read', async () => {
        const current = areaV1ShardedPayload('attempt-area-current', 2000)
        const otherCopy = areaV1ShardedPayload('attempt-area-other', 3000)
        const {layer, mirrorReads, metrics, diagnostics} = makeLayer({diskSnapshots: [current], mirrorCopy: otherCopy})
        const result = await layer.loadStoreFromStorage({[META_KEY]: current[META_KEY]}, {}, {})
        assert.equal(recoverProjectedState(result).projected.state.queue[ROW_HREF].attemptId, 'attempt-area-current')
        assert.equal(mirrorReads.length, 0, 'the session copy is not read')
        assert.equal(metrics.some(m => mirrorCounterNames(m.name)), false, 'no mirror copy is counted')
        assert.equal(diagnostics.some(entry => entry.type === RECOVERED_EVENT || entry.type === MISMATCH_EVENT), false)
    })

    await scenario('a torn area-v1 checkpoint with a copy whose queue area hash is wrong is refused', async () => {
        const current = areaV1ShardedPayload('attempt-area-current', 2000)
        const meta = current[META_KEY]
        const manifestKey = `${BASE_KEY}.checkpoint.${meta.activeCheckpoint}`
        const torn = {...current, [manifestKey]: {...current[manifestKey], stateHash: 'torn-area-manifest'}}
        // The copy's manifest agrees with the disk meta, and its queue area hash does not match the copy's own queue shards.
        const copyManifest = current[manifestKey]
        const copy = {...current, [manifestKey]: {
            ...copyManifest,
            areaShards: {...copyManifest.areaShards, queue: {...copyManifest.areaShards.queue, hash: 'tampered-queue-area-hash'}}
        }}
        const {layer, diagnostics, metrics} = makeLayer({diskSnapshots: [torn], mirrorCopy: copy})
        await assert.rejects(() => layer.loadStoreFromStorage({[META_KEY]: meta}, {}, {}), error => error?.walDecodeFailed === true)
        assert.ok(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointMirrorCopyRejected'))
        assert.equal(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.checkpointRecoveredFromMirror'), false)
        const mismatch = diagnostics.find(entry => entry.type === MISMATCH_EVENT)
        assert.ok(mismatch && mismatch.message.includes('unusable (checkpoint-area-hash-mismatch'), 'the refusal names the area hash check')
    })

    // Checkpoint reuse (step 2). The layer remembers the slots storage holds: recorded at each load, forgotten on a clear, on a removal
    // of a checkpoint or meta key, and on a save that did not succeed. A save that succeeds remembers the slot it wrote.
    const reuseState = {queue: {[ROW_HREF]: {status: 'queued', attemptId: 'attempt-reuse', attemptNumber: 1, runId: 'run-reuse'}}, completed: {}}
    // Two checkpoints, one in each slot, both written in full, as the storage holds them after two switches.
    function twoSlotPayload() {
        let store = makePairedCheckpointStore({}, {snapshotSeq: 0})
        for (const seq of [5, 6]) {
            const written = writeInactiveCheckpoint(store, reuseState, {snapshotSeq: seq, snapshotEpoch: 1, createdAt: seq, shardCount: 4})
            const activated = activateCheckpoint(written.store, written.checkpointId, {})
            assert.equal(activated.activated, true, activated.reason)
            store = activated.store
        }
        return buildSegmentedWalStoragePayload(store, {baseKey: BASE_KEY, writeCheckpoints: true})
    }
    // Loads the two-slot storage through the layer, and returns the loaded store.
    async function loadTwoSlots() {
        const payload = twoSlotPayload()
        const {layer} = makeLayer({diskSnapshots: [payload], mirrorCopy: null})
        const loaded = await layer.loadStoreFromStorage({[META_KEY]: payload[META_KEY]}, {}, {})
        return {layer, loaded}
    }
    // How many shards the next switch write would leave out, for the given stored store.
    function skippedByNextWrite(layer, storedWal, seq) {
        const prepared = layer.prepareCheckpointWrite(storedWal, reuseState, {snapshotSeq: seq, createdAt: seq, shardCount: 4})
        return prepared.writePlan.skipShardIndexes.length
    }

    await scenario('a load remembers both slots, so an unchanged write of the inactive slot leaves out every shard', async () => {
        const {layer, loaded} = await loadTwoSlots()
        assert.equal(skippedByNextWrite(layer, loaded, 7), 4)
    })

    await scenario('a storage clear forgets both slots, so the next write writes every shard', async () => {
        const {layer, loaded} = await loadTwoSlots()
        layer.noteStorageRemovals({[META_KEY]: {oldValue: {}}, [`${BASE_KEY}.checkpoint.A`]: {oldValue: {}}})
        assert.equal(skippedByNextWrite(layer, loaded, 7), 0)
    })

    await scenario('removing a segment does not forget the slots', async () => {
        const {layer, loaded} = await loadTwoSlots()
        layer.noteStorageRemovals({[`${BASE_KEY}.segment.A.0000`]: {oldValue: {}}})
        assert.equal(skippedByNextWrite(layer, loaded, 7), 4)
    })

    await scenario('a save that did not succeed forgets both slots', async () => {
        const {layer, loaded} = await loadTwoSlots()
        layer.noteCheckpointSaveFailed()
        assert.equal(skippedByNextWrite(layer, loaded, 7), 0)
    })

    await scenario('a save that succeeds remembers the slot it wrote, so that slot is reused on its next write', async () => {
        const {layer} = makeLayer({diskSnapshots: [], mirrorCopy: null})
        let store = makePairedCheckpointStore({}, {snapshotSeq: 0})
        // Nothing is remembered at first, so the first two writes write every shard. Each save that succeeds is recorded.
        const first = layer.prepareCheckpointWrite(store, reuseState, {snapshotSeq: 5, createdAt: 5, shardCount: 4})
        assert.equal(first.writePlan.skipShardIndexes.length, 0)
        layer.noteCheckpointSaved(first)
        store = activateCheckpoint(first.store, first.checkpointId, {}).store
        const second = layer.prepareCheckpointWrite(store, reuseState, {snapshotSeq: 6, createdAt: 6, shardCount: 4})
        assert.equal(second.writePlan.skipShardIndexes.length, 0, 'the other slot was never saved, so it is written in full')
        layer.noteCheckpointSaved(second)
        store = activateCheckpoint(second.store, second.checkpointId, {}).store
        // The first slot is the inactive one again, and its save was recorded: with the same state, every shard is left out.
        assert.equal(skippedByNextWrite(layer, store, 7), 4)
    })
    // Session restart (architecture.md, section 4.8). When the manifests agree, the copy's queue is the queue state and no queue shard is read
    // from disk. The disk tail is read from disk. A tail record the copy holds, or the checkpoint covers, is not applied again.
    const TAIL_ROW_HREF = 'https://example.test/checkpoint-binding-tail-row'
    const tailRow = (id, attemptId, extra = {}) => ({
        kind: 'map.set',
        area: 'queue',
        key: TAIL_ROW_HREF,
        id,
        value: {status: 'queued', attemptId, attemptNumber: 1, runId: 'run-checkpoint-binding-tail', local: 3},
        ...extra
    })

    await scenario('a session restart with agreeing area-v1 manifests reads no queue shard from disk and takes the queue from the copy', async () => {
        const payload = areaV1ShardedPayload('attempt-session', 2000)
        const queueKeys = queueShardKeysOf(payload)
        assert.ok(queueKeys.length > 0, 'the fixture has queue shards')
        const {layer, reads, metrics} = makeLayer({diskSnapshots: [payload]})
        const report = {}
        const result = await layer.loadStoreFromStorage(sessionCopyOf(payload, 0), {}, {fromMirror: true, restartReport: report})
        assert.equal(report.queueSource, 'session')
        assert.deepEqual(reads.flat().filter(key => queueKeys.includes(key)), [], 'no queue shard is read from disk')
        assert.equal(metrics.some(m => m.name === 'coordinatorAuthority.queueWal.restartSessionRefused'), false)
        assert.equal(recoverProjectedState(result).projected.state.queue[ROW_HREF].attemptId, 'attempt-session')
    })

    await scenario('a session restart whose copy disagrees with the disk on the queue area reads the whole WAL from disk', async () => {
        const payload = areaV1ShardedPayload('attempt-refused', 2000)
        const queueKeys = queueShardKeysOf(payload)
        const copy = sessionCopyOf(payload, 0)
        const manifestKey = `${BASE_KEY}.checkpoint.${payload[META_KEY].activeCheckpoint}`
        copy[manifestKey] = {
            ...copy[manifestKey],
            areaShards: {...copy[manifestKey].areaShards, queue: {...copy[manifestKey].areaShards.queue, hash: 'copy-queue-area-other'}}
        }
        const {layer, reads, metrics} = makeLayer({diskSnapshots: [payload]})
        const report = {}
        const result = await layer.loadStoreFromStorage(copy, {}, {fromMirror: true, restartReport: report})
        assert.equal(report.queueSource, 'disk')
        assert.equal(metrics.filter(m => m.name === 'coordinatorAuthority.queueWal.restartSessionRefused').length, 1)
        assert.ok(reads.flat().some(key => queueKeys.includes(key)), 'the queue shards come from disk')
        assert.equal(recoverProjectedState(result).projected.state.queue[ROW_HREF].attemptId, 'attempt-refused')
    })

    await scenario('a session restart reads the disk tail the copy does not hold, and reports the tail records it read', async () => {
        const payload = areaV1PayloadWithTail('attempt-tail', 2000, [tailRow('tail-record-1', 'attempt-tail-row')])
        const slot = payload[META_KEY].activeCheckpoint
        const {layer, reads} = makeLayer({diskSnapshots: [payload]})
        const report = {}
        const result = await layer.loadStoreFromStorage(sessionCopyOf(payload, 0), {}, {fromMirror: true, restartReport: report})
        assert.equal(report.queueSource, 'session')
        assert.equal(report.tailRecordCount, 1)
        assert.deepEqual([...report.tailIds], ['tail-record-1'])
        assert.ok(reads.flat().includes(getSegmentedWalSegmentKey(BASE_KEY, slot, 0)), 'the tail segment is read from disk')
        assert.equal(recoverProjectedState(result).projected.state.queue[TAIL_ROW_HREF].attemptId, 'attempt-tail-row')
    })

    await scenario('a session restart does not apply a tail record the copy already holds, and does not read the copy segment again', async () => {
        const payload = areaV1PayloadWithTail('attempt-repeat', 2000, [tailRow('copy-record-1', 'attempt-repeat-row')])
        const slot = payload[META_KEY].activeCheckpoint
        const copiedKey = getSegmentedWalSegmentKey(BASE_KEY, slot, 0)
        const repeatKey = getSegmentedWalSegmentKey(BASE_KEY, slot, 1)
        // The copy holds segment 0. The disk holds that same segment again as segment 1: the disk tail is the repeat.
        const disk = withActiveSegmentCount({...payload, [repeatKey]: {...payload[copiedKey], segmentNo: 1}}, 2)
        const {layer, reads} = makeLayer({diskSnapshots: [disk]})
        const report = {}
        const result = await layer.loadStoreFromStorage(sessionCopyOf(payload, 1), {}, {fromMirror: true, restartReport: report})
        assert.equal(report.queueSource, 'session')
        assert.equal(reads.flat().includes(copiedKey), false, 'the copy segment is not read again')
        assert.ok(reads.flat().includes(repeatKey), 'the repeat is read from disk')
        assert.equal(report.tailRecordCount, 1)
        assert.equal(report.tailIds.size, 0, 'the repeated record is not a tail record')
        const projected = recoverProjectedState(result).projected
        assert.equal(projected.applied.filter(record => record.id === 'copy-record-1').length, 1, 'the record is applied once')
        assert.equal(projected.state.queue[TAIL_ROW_HREF].attemptId, 'attempt-repeat-row')
    })

    await scenario('a session restart reads a tail record the checkpoint covers, and recovery does not apply it', async () => {
        const covered = tailRow('covered-record-1', 'attempt-covered-row', {seq: 1})
        const payload = areaV1PayloadWithTail('attempt-covered', 2000, [covered])
        const {layer} = makeLayer({diskSnapshots: [payload]})
        const report = {}
        const result = await layer.loadStoreFromStorage(sessionCopyOf(payload, 0), {}, {fromMirror: true, restartReport: report})
        assert.deepEqual([...report.tailIds], ['covered-record-1'], 'the record is read from the tail')
        const projected = recoverProjectedState(result).projected
        assert.equal(projected.applied.some(record => record.id === 'covered-record-1'), false, 'the checkpoint covers it, so it is not applied')
        assert.equal(projected.state.queue[TAIL_ROW_HREF], undefined)
    })

    // Queue shard fallback (owner decision, 27 Oct; architecture.md, section 4.8). Cheap detection: a missing key, or an identity mismatch, that
    // the disk read saw. A QUEUE shard of the active slot takes the session copy's record only when it verifies against the disk manifest.
    // Completed and runs shards fail closed. A healthy disk reads no session shard.
    const QUEUE_SHARD_RECOVERED = 'coordinatorAuthority.queueWal.queueShardRecoveredFromSession'
    const QUEUE_SHARD_REFUSED = 'coordinatorAuthority.queueWal.queueShardFromSessionRefused'
    // The record keys of the active slot's shards in one namespace (0 queue, 1 completed, 2 runs).
    function activeSlotShardKeys(payload, namespace) {
        const slot = payload[META_KEY].activeCheckpoint
        return Object.keys(payload).filter(key => {
            const match = new RegExp(`\\.checkpoint\\.${slot}\\.s(\\d+)$`).exec(key)
            return match !== null && checkpointShardNamespace(match[1]) === namespace
        })
    }
    const withoutKey = (payload, key) => {
        const copy = {...payload}
        delete copy[key]
        return copy
    }
    // The payload with the queue row's own shard record changed: its state no longer hashes to the manifest's shard hash.
    function tamperedRowShard(payload) {
        const key = activeSlotShardKeys(payload, 0).find(shardKey => payload[shardKey].state?.queue?.[ROW_HREF])
        assert.ok(key, 'the fixture has the queue row in a queue shard')
        const record = payload[key]
        return {...payload, [key]: {...record, state: {...record.state, queue: {[ROW_HREF]: {...record.state.queue[ROW_HREF], attemptId: 'attempt-tampered-queue-shard'}}}}}
    }
    const rowShardKey = payload => activeSlotShardKeys(payload, 0).find(shardKey => payload[shardKey].state?.queue?.[ROW_HREF])

    await scenario('a missing disk queue shard takes the session copy shard when it verifies, and the state is the pre-tear state', async () => {
        const payload = areaV1ShardedPayload('attempt-shard-missing', 2000)
        const key = rowShardKey(payload)
        const reference = recoverProjectedState(await makeLayer({diskSnapshots: [payload]}).layer.loadStoreFromStorage({[META_KEY]: payload[META_KEY]}, {}, {})).projected.state
        const {layer, metrics, mirrorReads} = makeLayer({diskSnapshots: [withoutKey(payload, key)], mirrorCopy: payload})
        const result = await layer.loadStoreFromStorage({[META_KEY]: payload[META_KEY]}, {}, {})
        assert.deepEqual(recoverProjectedState(result).projected.state, reference, 'the state equals the disk state before the tear')
        assert.equal(metrics.filter(m => m.name === QUEUE_SHARD_RECOVERED).length, 1, 'the recovery is counted once')
        assert.equal(metrics.some(m => m.name === QUEUE_SHARD_REFUSED), false)
        assert.deepEqual(mirrorReads, [[key]], 'the session is read once, for the torn shard only')
    })

    await scenario('a missing disk queue shard with a session copy that does not verify fails closed, and the refusal is counted', async () => {
        const payload = areaV1ShardedPayload('attempt-shard-refused', 2000)
        const key = rowShardKey(payload)
        const {layer, metrics} = makeLayer({diskSnapshots: [withoutKey(payload, key)], mirrorCopy: tamperedRowShard(payload)})
        await assert.rejects(() => layer.loadStoreFromStorage({[META_KEY]: payload[META_KEY]}, {}, {}), error => error?.walDecodeFailed === true)
        assert.equal(metrics.filter(m => m.name === QUEUE_SHARD_REFUSED).length, 1)
        assert.equal(metrics.some(m => m.name === QUEUE_SHARD_RECOVERED), false)
    })

    await scenario('a missing disk completed shard is not replaced from the session copy, and the load fails closed', async () => {
        const payload = areaV1ShardedPayload('attempt-shard-completed', 2000)
        const completedKey = activeSlotShardKeys(payload, 1)[0]
        assert.ok(completedKey, 'the fixture has a completed shard')
        const {layer, metrics, mirrorReads} = makeLayer({diskSnapshots: [withoutKey(payload, completedKey)], mirrorCopy: payload})
        await assert.rejects(() => layer.loadStoreFromStorage({[META_KEY]: payload[META_KEY]}, {}, {}), error => error?.walDecodeFailed === true)
        assert.equal(mirrorReads.length, 0, 'the session copy is not read for a completed shard')
        assert.equal(metrics.some(m => m.name === QUEUE_SHARD_RECOVERED || m.name === QUEUE_SHARD_REFUSED), false)
    })

    await scenario('a healthy disk reads no session shard, and no shard counter moves', async () => {
        const payload = areaV1ShardedPayload('attempt-shard-healthy', 2000)
        const {layer, metrics, mirrorReads} = makeLayer({diskSnapshots: [payload], mirrorCopy: payload})
        const result = await layer.loadStoreFromStorage({[META_KEY]: payload[META_KEY]}, {}, {})
        assert.equal(recoverProjectedState(result).projected.state.queue[ROW_HREF].attemptId, 'attempt-shard-healthy')
        assert.equal(mirrorReads.length, 0, 'the session is not read on the healthy path')
        assert.equal(metrics.some(m => m.name === QUEUE_SHARD_RECOVERED || m.name === QUEUE_SHARD_REFUSED), false)
    })
}

// The queue-only fallback guard (27 Oct). With no store in memory and none in the monolithic key, the loader builds a queue-only checkpoint.
// It must be refused when the disk names a completed or runs shard, and built as before when it does not.
{
    const doneState = {
        queue: {[ROW_HREF]: {status: 'queued', attemptId: 'attempt-guard-queue', attemptNumber: 1, local: 0}},
        completed: {[DONE_ROW_HREF]: {status: 'succeeded', attemptId: 'attempt-guard-done', local: 7}}
    }
    const runsState = {
        queue: {[ROW_HREF]: {status: 'queued', attemptId: 'attempt-guard-queue', attemptNumber: 1, local: 0}},
        runs: {[RUN_KEY]: {id: RUN_KEY, status: 'active', local: 3}}
    }
    const queueOnlyState = {
        queue: {[ROW_HREF]: {status: 'queued', attemptId: 'attempt-guard-queue', attemptNumber: 1, local: 0}}
    }

    await scenario('a missing WAL store is refused when the disk holds a completed shard, and no queue-only checkpoint replaces it', async () => {
        const {layer, metrics} = makeLayer({diskSnapshots: [manifestsOnly(areaShardedPayloadOf(doneState, 6000))]})
        const stored = {}
        await assert.rejects(() => layer.loadStoreFromStorage(stored, {queue: {}}, {}), error => error?.walDecodeFailed === true)
        assert.equal(stored[BASE_KEY], null, 'the load stored no fallback store')
        assert.equal(metrics.filter(m => m.name === REFUSED_METRIC).length, 1)
    })

    await scenario('a missing WAL store is refused when the disk holds a runs shard', async () => {
        const {layer, metrics} = makeLayer({diskSnapshots: [manifestsOnly(areaShardedPayloadOf(runsState, 6100))]})
        const stored = {}
        await assert.rejects(() => layer.loadStoreFromStorage(stored, {queue: {}}, {}), error => error?.walDecodeFailed === true)
        assert.equal(stored[BASE_KEY], null, 'the load stored no fallback store')
        assert.equal(metrics.filter(m => m.name === REFUSED_METRIC).length, 1)
    })

    await scenario('a missing WAL store with a queue-only disk still builds the queue-only fallback as before', async () => {
        const {layer, metrics} = makeLayer({diskSnapshots: [manifestsOnly(areaShardedPayloadOf(queueOnlyState, 6200))]})
        const snapshot = {queue: {}}
        const stored = {}
        const result = await layer.loadStoreFromStorage(stored, snapshot, {})
        assert.deepEqual(result, {fromSnapshot: snapshot})
        assert.equal(stored[BASE_KEY], result)
        assert.equal(metrics.some(m => m.name === REFUSED_METRIC), false)
    })

    await scenario('a healthy WAL store on disk is loaded as it is, with no refusal even when completed shards are present', async () => {
        const monolith = {meta: segmentedMeta(CHECKPOINT_A, 0), checkpoints: {}, wal: {}}
        const disk = {...manifestsOnly(areaShardedPayloadOf(doneState, 6300)), [BASE_KEY]: monolith}
        const {layer, metrics} = makeLayer({diskSnapshots: [disk]})
        const stored = {}
        const result = await layer.loadStoreFromStorage(stored, {}, {})
        assert.equal(result, monolith)
        assert.equal(stored[BASE_KEY], monolith)
        assert.equal(metrics.some(m => m.name === REFUSED_METRIC), false)
    })

    // The sw-side guard (refuseQueueOnlyCheckpointFallback), which the two queue append paths call when the store is missing.
    await scenario('the sw-side guard refuses a queue-only fallback when the disk names a completed shard, and counts the refusal', async () => {
        const counted = []
        const worker = makeCoordinatorWorker(counted)
        const source = manifestsOnly(areaShardedPayloadOf(doneState, 6400))
        const readKeys = []
        const readDisk = async keys => {
            readKeys.push(Object.keys(keys))
            return Object.fromEntries(Object.keys(keys).map(key => [key, source[key] ?? null]))
        }
        assert.equal(await worker.refuseQueueOnlyCheckpointFallback(readDisk), 'missing-wal')
        assert.deepEqual(readKeys, [[`${BASE_KEY}.checkpoint.${CHECKPOINT_A}`, `${BASE_KEY}.checkpoint.${CHECKPOINT_B}`]])
        assert.equal(counted.filter(name => name === REFUSED_METRIC).length, 1)
    })

    await scenario('the sw-side guard allows a queue-only fallback when the disk holds only queue shards, and counts nothing', async () => {
        const counted = []
        const worker = makeCoordinatorWorker(counted)
        const source = manifestsOnly(areaShardedPayloadOf(queueOnlyState, 6500))
        const readDisk = async keys => Object.fromEntries(Object.keys(keys).map(key => [key, source[key] ?? null]))
        assert.equal(await worker.refuseQueueOnlyCheckpointFallback(readDisk), null)
        assert.equal(counted.some(name => name === REFUSED_METRIC), false)
    })

    await scenario('the sw-side guard allows the fallback when the disk holds no checkpoint at all', async () => {
        const counted = []
        const worker = makeCoordinatorWorker(counted)
        assert.equal(await worker.refuseQueueOnlyCheckpointFallback(async () => ({})), null)
        assert.equal(counted.length, 0)
    })
}

if(failedScenarios.length) throw new Error(`${failedScenarios.length} checkpoint binding scenario(s) failed`)
}

main().then(() => console.log('swQueueWalStore tests passed'))
