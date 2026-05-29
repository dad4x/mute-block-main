const assert = require('node:assert/strict')
const {
    CHECKPOINT_A,
    CHECKPOINT_B,
    activateCheckpoint,
    appendWalRecordsToGeneration,
    buildSegmentedWalStorageDefaults,
    buildSegmentedWalStoragePayload,
    decodeCheckpointSnapshot,
    encodeCheckpointSnapshot,
    estimateStateBytes,
    getActiveCheckpoint,
    getSegmentedWalMetaKey,
    getSegmentedWalSegmentKey,
    getWalRecordsForGeneration,
    hydrateSegmentedWalStore,
    makeCheckpoint,
    makePairedCheckpointStore,
    makeWalRecord,
    projectSnapshot,
    recoverProjectedState,
    splitCheckpointState,
    verifyCheckpoint,
    writeInactiveCheckpoint
} = require('../shared/js/walSnapshotStore')

const fakeZstdCodec = {
    name: 'fake-zstd',
    compress(bytes) {
        return Uint8Array.from(Array.from(bytes).reverse())
    },
    decompress(bytes) {
        return Uint8Array.from(Array.from(bytes).reverse())
    }
}

function test(name, fn) {
    try {
        fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

function baseState() {
    return {
        queue: {
            'https://www.quora.com/profile/A': {
                status: 'queued',
                attemptId: 'attempt-1',
                attemptNumber: 1,
                runId: 'run-1'
            }
        },
        progress: {},
        runs: {
            'run-1': {
                id: 'run-1',
                status: 'active'
            }
        },
        events: []
    }
}

test('projects snapshot plus ordered WAL records into current state', () => {
    const checkpoint = makeCheckpoint(baseState(), {
        id: CHECKPOINT_A,
        snapshotSeq: 10,
        snapshotEpoch: 1,
        createdAt: 1000
    })
    const records = [
        makeWalRecord({
            seq: 12,
            id: 'attempt-1:terminal',
            kind: 'map.patch',
            area: 'queue',
            key: 'https://www.quora.com/profile/A',
            attemptId: 'attempt-1',
            attemptNumber: 1,
            patch: {
                status: 'succeeded',
                outcome: 'blocked',
                terminalAt: 1200
            }
        }),
        makeWalRecord({
            seq: 11,
            id: 'attempt-1:action-start',
            kind: 'map.patch',
            area: 'queue',
            key: 'https://www.quora.com/profile/A',
            attemptId: 'attempt-1',
            attemptNumber: 1,
            patch: {
                status: 'acting',
                actionStartedAt: 1100
            }
        })
    ]

    const projected = projectSnapshot(checkpoint, records)

    assert.equal(projected.maxSeq, 12)
    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'succeeded')
    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].actionStartedAt, 1100)
    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].terminalAt, 1200)
    assert.deepEqual(projected.ignored, [])
})

test('ignores records already covered by the snapshot sequence', () => {
    const checkpoint = makeCheckpoint(baseState(), {snapshotSeq: 10})
    const projected = projectSnapshot(checkpoint, [{
        seq: 10,
        id: 'old-record',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {status: 'acting'}
    }])

    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'queued')
    assert.equal(projected.ignored.length, 1)
    assert.equal(projected.ignored[0].reason, 'already-in-snapshot')
})

test('deduplicates records by stable id during replay', () => {
    const checkpoint = makeCheckpoint(baseState(), {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [
        {
            seq: 1,
            id: 'same-id',
            kind: 'map.patch',
            area: 'queue',
            key: 'https://www.quora.com/profile/A',
            patch: {status: 'acting'}
        },
        {
            seq: 2,
            id: 'same-id',
            kind: 'map.patch',
            area: 'queue',
            key: 'https://www.quora.com/profile/A',
            patch: {status: 'failed'}
        }
    ])

    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'acting')
    assert.equal(projected.ignored.length, 1)
    assert.equal(projected.ignored[0].reason, 'duplicate-id')
})

test('rejects stale attempt patches', () => {
    const state = baseState()
    state.queue['https://www.quora.com/profile/A'].attemptId = 'attempt-2'
    state.queue['https://www.quora.com/profile/A'].attemptNumber = 2
    const checkpoint = makeCheckpoint(state, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [{
        seq: 1,
        id: 'attempt-1:terminal',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        patch: {
            status: 'succeeded',
            outcome: 'blocked'
        }
    }])

    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'queued')
    assert.equal(projected.ignored.length, 1)
    assert.equal(projected.ignored[0].reason, 'stale-attempt')
})

test('rejects non-terminal regression after terminal state', () => {
    const state = baseState()
    state.queue['https://www.quora.com/profile/A'].status = 'succeeded'
    state.queue['https://www.quora.com/profile/A'].outcome = 'blocked'
    const checkpoint = makeCheckpoint(state, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [{
        seq: 1,
        id: 'late-active',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        patch: {status: 'acting'}
    }])

    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'succeeded')
    assert.equal(projected.ignored.length, 1)
    assert.equal(projected.ignored[0].reason, 'terminal-regression')
})

test('rejects stale attempt progress records', () => {
    const state = baseState()
    state.progress['https://www.quora.com/profile/A'] = {
        status: 'blocking',
        attemptId: 'attempt-2',
        attemptNumber: 2,
        runId: 'run-1'
    }
    const checkpoint = makeCheckpoint(state, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [{
        seq: 1,
        id: 'attempt-1:progress',
        kind: 'map.set',
        area: 'progress',
        key: 'https://www.quora.com/profile/A',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        value: {
            status: 'page-ready',
            attemptId: 'attempt-1',
            attemptNumber: 1,
            runId: 'run-1'
        }
    }])

    assert.equal(projected.state.progress['https://www.quora.com/profile/A'].status, 'blocking')
    assert.equal(projected.state.progress['https://www.quora.com/profile/A'].attemptId, 'attempt-2')
    assert.equal(projected.ignored.length, 1)
    assert.equal(projected.ignored[0].reason, 'stale-attempt')
})

test('rejects non-terminal progress regression after terminal progress state', () => {
    const state = baseState()
    state.progress['https://www.quora.com/profile/A'] = {
        status: 'blocked',
        blockSucceeded: true,
        attemptId: 'attempt-1',
        attemptNumber: 1,
        runId: 'run-1'
    }
    const checkpoint = makeCheckpoint(state, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [{
        seq: 1,
        id: 'late-progress',
        kind: 'map.set',
        area: 'progress',
        key: 'https://www.quora.com/profile/A',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        value: {
            status: 'blocking',
            attemptId: 'attempt-1',
            attemptNumber: 1,
            runId: 'run-1'
        }
    }])

    assert.equal(projected.state.progress['https://www.quora.com/profile/A'].status, 'blocked')
    assert.equal(projected.state.progress['https://www.quora.com/profile/A'].blockSucceeded, true)
    assert.equal(projected.ignored.length, 1)
    assert.equal(projected.ignored[0].reason, 'terminal-regression')
})

test('allows explicit terminal overwrite for repair records', () => {
    const state = baseState()
    state.queue['https://www.quora.com/profile/A'].status = 'failed'
    state.queue['https://www.quora.com/profile/A'].outcome = 'timeout'
    const checkpoint = makeCheckpoint(state, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [{
        seq: 1,
        id: 'manual-requeue',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        allowTerminalOverwrite: true,
        patch: {
            status: 'queued',
            outcome: '',
            attemptId: 'attempt-2',
            attemptNumber: 2
        }
    }])

    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'queued')
    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].attemptNumber, 2)
})

test('appends bounded event lists', () => {
    const checkpoint = makeCheckpoint({...baseState(), events: [{id: 'old'}]}, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [
        {
            seq: 1,
            id: 'event-1',
            kind: 'list.append',
            area: 'events',
            value: {id: 'one'},
            maxEntries: 2
        },
        {
            seq: 2,
            id: 'event-2',
            kind: 'list.append',
            area: 'events',
            value: {id: 'two'},
            maxEntries: 2
        }
    ])

    assert.deepEqual(projected.state.events.map(event => event.id), ['one', 'two'])
})

test('writes inactive checkpoint without changing active recovery point', () => {
    const store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10,
        snapshotEpoch: 1,
        createdAt: 1000
    })
    const checkpointState = {
        ...baseState(),
        queue: {
            'https://www.quora.com/profile/A': {
                status: 'succeeded'
            }
        }
    }
    const {store: prepared, checkpointId} = writeInactiveCheckpoint(store, checkpointState, {
        snapshotSeq: 20,
        snapshotEpoch: 2,
        createdAt: 2000
    })

    assert.equal(checkpointId, CHECKPOINT_B)
    assert.equal(prepared.meta.activeCheckpoint, CHECKPOINT_A)
    assert.equal(getActiveCheckpoint(prepared).snapshotSeq, 10)

    const recovered = recoverProjectedState(prepared, [])
    assert.equal(recovered.projected.state.queue['https://www.quora.com/profile/A'].status, 'queued')
})

test('recovers by replaying only the active generation WAL', () => {
    const store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10
    })
    const activeAppend = appendWalRecordsToGeneration(store, [{
        id: 'active-terminal',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {
            status: 'succeeded',
            outcome: 'blocked'
        }
    }], {
        generationId: CHECKPOINT_A,
        segmentId: 'active-wal'
    })
    const inactiveAppend = appendWalRecordsToGeneration(activeAppend.store, [{
        id: 'inactive-terminal',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {
            status: 'failed',
            outcome: 'timeout'
        }
    }], {
        generationId: CHECKPOINT_B,
        segmentId: 'inactive-wal'
    })

    const recovered = recoverProjectedState(inactiveAppend.store)

    assert.equal(inactiveAppend.rejected, true)
    assert.equal(inactiveAppend.reason, 'inactive-generation-append')
    assert.equal(recovered.generationId, CHECKPOINT_A)
    assert.equal(recovered.projected.state.queue['https://www.quora.com/profile/A'].status, 'succeeded')
    assert.equal(recovered.projected.state.queue['https://www.quora.com/profile/A'].outcome, 'blocked')
    assert.equal(getWalRecordsForGeneration(inactiveAppend.store, CHECKPOINT_B).length, 0)
})

test('segmented WAL storage hydrates logical store from committed segment keys', () => {
    let store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10,
        nextSeq: 11
    })
    store = appendWalRecordsToGeneration(store, [{
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {status: 'active'}
    }]).store
    store = appendWalRecordsToGeneration(store, [{
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {status: 'succeeded', outcome: 'blocked'}
    }]).store

    const payload = buildSegmentedWalStoragePayload(store, {baseKey: 'mbCoordinatorQueueWal'})

    assert.equal(payload.mbCoordinatorQueueWal, undefined)
    assert.ok(payload[getSegmentedWalMetaKey('mbCoordinatorQueueWal')])
    assert.ok(payload[getSegmentedWalSegmentKey('mbCoordinatorQueueWal', CHECKPOINT_A, 0)])
    assert.ok(payload[getSegmentedWalSegmentKey('mbCoordinatorQueueWal', CHECKPOINT_A, 1)])

    const hydrated = hydrateSegmentedWalStore(payload, {baseKey: 'mbCoordinatorQueueWal'})
    assert.equal(hydrated.ok, true)
    assert.equal(getWalRecordsForGeneration(hydrated.store, CHECKPOINT_A).length, 2)
    assert.equal(recoverProjectedState(hydrated.store).projected.state.queue['https://www.quora.com/profile/A'].status, 'succeeded')
})

test('segmented WAL storage ignores orphan segments not committed by meta', () => {
    let store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10,
        nextSeq: 11
    })
    store = appendWalRecordsToGeneration(store, [{
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {status: 'active'}
    }]).store
    const firstPayload = buildSegmentedWalStoragePayload(store, {baseKey: 'mbCoordinatorQueueWal'})
    const orphaned = appendWalRecordsToGeneration(store, [{
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {status: 'failed'}
    }]).store
    const orphanPayload = buildSegmentedWalStoragePayload(orphaned, {baseKey: 'mbCoordinatorQueueWal'})
    const storage = {
        ...firstPayload,
        [getSegmentedWalSegmentKey('mbCoordinatorQueueWal', CHECKPOINT_A, 1)]:
            orphanPayload[getSegmentedWalSegmentKey('mbCoordinatorQueueWal', CHECKPOINT_A, 1)]
    }

    const hydrated = hydrateSegmentedWalStore(storage, {baseKey: 'mbCoordinatorQueueWal'})
    assert.equal(hydrated.ok, true)
    assert.equal(getWalRecordsForGeneration(hydrated.store, CHECKPOINT_A).length, 1)
    assert.equal(recoverProjectedState(hydrated.store).projected.state.queue['https://www.quora.com/profile/A'].status, 'active')
})

test('segmented WAL storage detects manifest advanced past missing segment', () => {
    let store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10,
        nextSeq: 11
    })
    store = appendWalRecordsToGeneration(store, [{
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {status: 'active'}
    }]).store
    const payload = buildSegmentedWalStoragePayload(store, {baseKey: 'mbCoordinatorQueueWal'})
    delete payload[getSegmentedWalSegmentKey('mbCoordinatorQueueWal', CHECKPOINT_A, 0)]

    const defaults = buildSegmentedWalStorageDefaults(payload[getSegmentedWalMetaKey('mbCoordinatorQueueWal')], {
        baseKey: 'mbCoordinatorQueueWal'
    })
    assert.ok(Object.prototype.hasOwnProperty.call(defaults, getSegmentedWalSegmentKey('mbCoordinatorQueueWal', CHECKPOINT_A, 0)))

    const hydrated = hydrateSegmentedWalStore(payload, {baseKey: 'mbCoordinatorQueueWal'})
    assert.equal(hydrated.ok, false)
    assert.equal(hydrated.reason, 'missing-segment')
})

test('activating checkpoint switches recovery to that generation WAL', () => {
    const store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10
    })
    const checkpointState = {
        ...baseState(),
        queue: {
            'https://www.quora.com/profile/A': {
                status: 'queued',
                attemptId: 'attempt-2',
                attemptNumber: 2
            }
        }
    }
    const prepared = writeInactiveCheckpoint(store, checkpointState, {
        snapshotSeq: 20,
        snapshotEpoch: 2
    })
    const activated = activateCheckpoint(prepared.store, prepared.checkpointId)
    const withActiveWal = appendWalRecordsToGeneration(activated.store, [{
        id: 'attempt-2-terminal',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        attemptId: 'attempt-2',
        attemptNumber: 2,
        patch: {
            status: 'succeeded',
            outcome: 'blocked'
        }
    }], {
        generationId: activated.store.meta.activeCheckpoint,
        segmentId: 'post-activation'
    })

    const recovered = recoverProjectedState(withActiveWal.store)

    assert.equal(recovered.generationId, CHECKPOINT_B)
    assert.equal(recovered.projected.state.queue['https://www.quora.com/profile/A'].status, 'succeeded')
    assert.equal(recovered.projected.state.queue['https://www.quora.com/profile/A'].attemptNumber, 2)
})

test('writing inactive checkpoint resets that generation WAL to the checkpoint sequence', () => {
    const store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10
    })
    const dirtyInactive = appendWalRecordsToGeneration(store, [{
        id: 'stale-inactive',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {
            status: 'failed'
        }
    }], {
        generationId: CHECKPOINT_B,
        segmentId: 'stale-inactive',
        allowInactiveAppend: true
    })

    assert.equal(getWalRecordsForGeneration(dirtyInactive.store, CHECKPOINT_B).length, 1)

    const prepared = writeInactiveCheckpoint(dirtyInactive.store, baseState(), {
        snapshotSeq: 30,
        snapshotEpoch: 3
    })

    assert.equal(getWalRecordsForGeneration(prepared.store, prepared.checkpointId).length, 0)
    assert.equal(prepared.store.wal[prepared.checkpointId].snapshotSeq, 30)
})

test('flips active checkpoint only after inactive checkpoint verifies', () => {
    const store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10,
        snapshotEpoch: 1
    })
    const {store: prepared, checkpointId} = writeInactiveCheckpoint(store, {
        ...baseState(),
        queue: {
            'https://www.quora.com/profile/A': {
                status: 'succeeded'
            }
        }
    }, {
        snapshotSeq: 20,
        snapshotEpoch: 2
    })

    const activated = activateCheckpoint(prepared, checkpointId)
    assert.equal(activated.activated, true)
    assert.equal(activated.store.meta.activeCheckpoint, CHECKPOINT_B)
    assert.equal(activated.store.meta.snapshotSeq, 20)

    const recovered = recoverProjectedState(activated.store, [])
    assert.equal(recovered.projected.state.queue['https://www.quora.com/profile/A'].status, 'succeeded')
})

test('refuses to activate corrupted inactive checkpoint', () => {
    const store = makePairedCheckpointStore(baseState(), {snapshotSeq: 10})
    const {store: prepared, checkpointId} = writeInactiveCheckpoint(store, baseState(), {snapshotSeq: 20})
    prepared.checkpoints[checkpointId].state.queue['https://www.quora.com/profile/A'].status = 'succeeded'

    const verification = verifyCheckpoint(prepared.checkpoints[checkpointId])
    assert.equal(verification.ok, false)

    const activated = activateCheckpoint(prepared, checkpointId)
    assert.equal(activated.activated, false)
    assert.equal(activated.store.meta.activeCheckpoint, CHECKPOINT_A)
})

test('recovers from new active checkpoint after pointer flip even if cleanup did not run', () => {
    const store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10,
        snapshotEpoch: 1
    })
    const {store: prepared, checkpointId} = writeInactiveCheckpoint(store, {
        ...baseState(),
        queue: {
            'https://www.quora.com/profile/A': {
                status: 'succeeded'
            }
        }
    }, {
        snapshotSeq: 20,
        snapshotEpoch: 2
    })
    const activated = activateCheckpoint(prepared, checkpointId)
    activated.store.meta.segments = [{id: 'old-segment', fromSeq: 11, toSeq: 20, sealed: true}]

    const recovered = recoverProjectedState(activated.store, [{
        seq: 20,
        id: 'already-checkpointed',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {status: 'failed'}
    }, {
        seq: 21,
        id: 'post-checkpoint-event',
        kind: 'list.append',
        area: 'events',
        value: {id: 'after'}
    }])

    assert.equal(recovered.projected.state.queue['https://www.quora.com/profile/A'].status, 'succeeded')
    assert.deepEqual(recovered.projected.state.events, [{id: 'after'}])
    assert.equal(recovered.projected.ignored[0].reason, 'already-in-snapshot')
})

test('separates recovery-critical checkpoint state from user memory', () => {
    const state = {
        ...baseState(),
        mbSpaceNukedPosts: {
            post1: {updatedAt: 1000, profileHref: 'https://www.quora.com/profile/A'}
        },
        mbQueueWakeupMetrics: {
            counters: {x: 1}
        }
    }

    const split = splitCheckpointState(state)
    assert.deepEqual(Object.keys(split.recoveryCritical).sort(), ['events', 'progress', 'queue', 'runs'])
    assert.deepEqual(Object.keys(split.userMemory).sort(), ['mbQueueWakeupMetrics', 'mbSpaceNukedPosts'])

    const estimate = estimateStateBytes(state)
    assert.ok(estimate.totalBytes > estimate.recoveryCriticalBytes)
    assert.ok(estimate.userMemoryBytes > 0)
})

test('encodes and decodes compressed checkpoints through a pluggable codec', () => {
    const state = baseState()
    const checkpoint = makeCheckpoint(state, {
        id: CHECKPOINT_A,
        snapshotSeq: 10,
        codec: fakeZstdCodec
    })

    assert.equal(checkpoint.codec, 'fake-zstd')
    assert.equal(checkpoint.encoding, 'base64')
    assert.equal(checkpoint.state, undefined)
    assert.ok(checkpoint.payload.length > 0)

    const decoded = decodeCheckpointSnapshot(checkpoint, {codec: fakeZstdCodec})
    assert.equal(decoded.ok, true)
    assert.deepEqual(decoded.state, state)
})

test('compressed checkpoint verification rejects missing codecs', () => {
    const checkpoint = makeCheckpoint(baseState(), {
        id: CHECKPOINT_A,
        snapshotSeq: 10,
        codec: fakeZstdCodec
    })

    const decoded = decodeCheckpointSnapshot(checkpoint)
    assert.equal(decoded.ok, false)
    assert.equal(decoded.reason, 'snapshot-codec-unavailable')
})

test('compressed inactive checkpoint activates only after codec verification', () => {
    const store = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10,
        snapshotEpoch: 1
    })
    const nextState = {
        ...baseState(),
        queue: {
            'https://www.quora.com/profile/A': {
                status: 'succeeded'
            }
        }
    }
    const {store: prepared, checkpointId} = writeInactiveCheckpoint(store, nextState, {
        snapshotSeq: 20,
        snapshotEpoch: 2,
        codec: fakeZstdCodec
    })

    const rejected = activateCheckpoint(prepared, checkpointId)
    assert.equal(rejected.activated, false)
    assert.equal(rejected.reason, 'snapshot-codec-unavailable')

    const activated = activateCheckpoint(prepared, checkpointId, {codec: fakeZstdCodec})
    assert.equal(activated.activated, true)

    const recovered = recoverProjectedState(activated.store, [], {codec: fakeZstdCodec})
    assert.equal(recovered.projected.state.queue['https://www.quora.com/profile/A'].status, 'succeeded')
})

test('corrupted compressed inactive checkpoint does not flip active pointer', () => {
    const store = makePairedCheckpointStore(baseState(), {snapshotSeq: 10})
    const {store: prepared, checkpointId} = writeInactiveCheckpoint(store, baseState(), {
        snapshotSeq: 20,
        codec: fakeZstdCodec
    })
    prepared.checkpoints[checkpointId].payload = prepared.checkpoints[checkpointId].payload.slice(4)

    const activated = activateCheckpoint(prepared, checkpointId, {codec: fakeZstdCodec})
    assert.equal(activated.activated, false)
    assert.equal(activated.store.meta.activeCheckpoint, CHECKPOINT_A)
})

test('raw and compressed checkpoint modes project to identical state', () => {
    const state = baseState()
    const records = [{
        seq: 11,
        id: 'terminal',
        kind: 'map.patch',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        patch: {
            status: 'succeeded',
            outcome: 'blocked'
        }
    }]
    const raw = makeCheckpoint(state, {id: CHECKPOINT_A, snapshotSeq: 10})
    const compressed = makeCheckpoint(state, {id: CHECKPOINT_A, snapshotSeq: 10, codec: fakeZstdCodec})

    assert.deepEqual(
        projectSnapshot(compressed, records, {codec: fakeZstdCodec}).state,
        projectSnapshot(raw, records).state
    )
})
