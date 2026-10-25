const assert = require('node:assert/strict')
const {
    CHECKPOINT_A,
    CHECKPOINT_B,
    activateCheckpoint,
    buildSegmentedWalStoragePayload,
    getSegmentedWalMetaKey,
    makePairedCheckpointStore,
    recoverProjectedState,
    writeInactiveCheckpoint
} = require('../shared/js/walSnapshotStore')
const {createQueueWalStore} = require('../shared/js/swQueueWalStore')

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
    assert.deepEqual(reads, [[BASE_KEY]])
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
        const recovered = diagnostics.find(entry => entry.type === RECOVERED_EVENT)
        assert.ok(recovered, 'the recovery is recorded')
        assert.ok(recovered.message.includes(currentPayload[SLOT_MANIFEST_KEY].stateHash), 'the copy that was used is named')
        assert.ok(recovered.message.includes(staleSlotPayload[SLOT_MANIFEST_KEY].stateHash), 'the disk manifest it replaced is named')
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
}

if(failedScenarios.length) throw new Error(`${failedScenarios.length} checkpoint binding scenario(s) failed`)
}

main().then(() => console.log('swQueueWalStore tests passed'))
