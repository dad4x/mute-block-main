const assert = require('node:assert/strict')
const {createHash} = require('node:crypto')
const zlib = require('node:zlib')
const {
    CHECKPOINT_A,
    CHECKPOINT_B,
    activateCheckpoint,
    applyWalRecord,
    appendWalRecordsToGeneration,
    buildSegmentedWalStorageDefaults,
    buildSegmentedWalStoragePayload,
    checkpointManifestMatchesMeta,
    decodeCheckpointSnapshot,
    encodeCheckpointSnapshot,
    estimateStateBytes,
    findCheckpointManifestDisagreements,
    getActiveCheckpoint,
    getCheckpointFingerprint,
    getSegmentedWalCheckpointKey,
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
const {createCoordinatorQueueWalStore} = require('../shared/js/swCoordinatorQueueWal')

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

test('projectSnapshot does not attach a stateHash (unused, expensive full-state rehash)', () => {
    // `projectSnapshot` used to run `hashState` (a hand-rolled recursive
    // key-sorting stringify) over the entire post-replay state on every
    // call -- WAL recovery on load, every checkpoint switch, every CLI
    // recovery tool -- even though nothing in the codebase ever reads the
    // resulting `.stateHash`. Pins the removal so it isn't silently
    // reintroduced; checkpoint-level integrity verification (which DOES
    // matter) is separately covered by "refuses to activate corrupted
    // inactive checkpoint" below, which goes through `verifyCheckpoint`
    // and is unaffected by this.
    const checkpoint = makeCheckpoint(baseState(), {
        id: CHECKPOINT_A,
        snapshotSeq: 10,
        snapshotEpoch: 1,
        createdAt: 1000
    })

    const projected = projectSnapshot(checkpoint, [])

    assert.equal('stateHash' in projected, false)

    const recovered = recoverProjectedState(makePairedCheckpointStore(baseState(), {snapshotSeq: 10}), [])
    assert.equal('stateHash' in recovered.projected, false)
})

test('an append leaves its input store unchanged and stores the same output as before structural sharing', () => {
    // Regression for the per-write copy cost (take-8 review, P2): appendWalRecordsToGeneration used to deep-copy the whole
    // store (checkpoints and every segment) and rebuild the active generation on every append. It now shares the parts the
    // append does not change. The digest pins the stored output of this fixed sequence as the implementation before that
    // change wrote it, so a difference in the stored form fails here, without a live run.
    const codec = {
        name: 'gzip',
        compress: bytes => zlib.gzipSync(bytes),
        decompress: bytes => zlib.gunzipSync(bytes)
    }
    const rowA = 'https://www.quora.com/profile/Golden-Row-A'
    const rowB = 'https://www.quora.com/profile/Golden-Row-B'
    const rowC = 'https://www.quora.com/profile/Golden-Row-C'
    const written = writeInactiveCheckpoint(makePairedCheckpointStore({}, {snapshotSeq: 0, codec}), {
        queue: {
            [rowA]: {status: 'queued', attemptId: 'attempt-a', attemptNumber: 1, updatedAt: 1},
            [rowB]: {status: 'queued', attemptId: 'attempt-b', attemptNumber: 1, updatedAt: 2}
        },
        completed: {},
        runs: {},
        progress: {},
        events: []
    }, {snapshotSeq: 4, snapshotEpoch: 1, createdAt: 10, codec, codecName: codec.name, shardCount: 3})
    const store0 = activateCheckpoint(written.store, written.checkpointId, {codec}).store
    const store0Json = JSON.stringify(store0)
    const first = appendWalRecordsToGeneration(store0, [
        {kind: 'map.set', area: 'queue', key: rowC, value: {status: 'queued', attemptId: 'attempt-c', attemptNumber: 1, updatedAt: 5}, attemptId: 'attempt-c', attemptNumber: 1, status: 'queued'},
        {kind: 'map.patch', area: 'queue', key: rowA, patch: {status: 'blocked', updatedAt: 6}, attemptId: 'attempt-a', attemptNumber: 1, status: 'blocked'}
    ], {segmentId: 'golden-first'})
    const firstJson = JSON.stringify(first.store)
    const second = appendWalRecordsToGeneration(first.store, [
        {seq: 20, kind: 'map.remove', area: 'queue', key: rowB, removed: true, attemptId: 'attempt-b', attemptNumber: 1, status: 'queued'},
        {kind: 'map.set', area: 'completed', key: rowB, value: {status: 'succeeded', attemptId: 'attempt-b', attemptNumber: 1, terminalAt: 7}, attemptId: 'attempt-b', attemptNumber: 1, status: 'succeeded', terminal: true}
    ], {segmentId: 'golden-second', sealed: false})

    assert.equal(JSON.stringify(store0), store0Json, 'the first append leaves its input store unchanged')
    assert.equal(JSON.stringify(first.store), firstJson, 'the second append leaves its input store unchanged')
    assert.equal(
        createHash('sha256').update(JSON.stringify(second.store)).digest('hex'),
        'bb3b4c176319381682a25bfdcba6923e7e6cfb324a2994bd323e992c36662868',
        'the stored output matches the digest pinned from the pre-sharing implementation'
    )
    const decoded = recoverProjectedState(second.store, [], {codec})
    assert.deepEqual(Object.keys(decoded.projected.state.queue).sort(), [rowA, rowC].sort())
    assert.equal(decoded.projected.state.queue[rowA].status, 'blocked')
    assert.deepEqual(Object.keys(decoded.projected.state.completed).sort(), [rowB])
})

test('applyWalRecord shallow-copies state instead of deep-cloning untouched rows and areas', () => {
    // Regression for the 2026-09-12 replay-cost incident: applyWalRecord
    // used to do `cloneJson(state)` -- a full JSON.stringify/parse
    // round-trip of the ENTIRE state -- on every single record, including
    // every already-completed row that record had nothing to do with.
    // Replaying N records against a queue with hundreds of accumulated
    // terminal rows cost O(N * totalQueueSize), which only got worse the
    // more items the coordinator successfully finished, independent of the
    // WAL segment-count fix (which bounds record count, not queue size).
    // Every branch here already rebuilds only the touched area/row from
    // scratch, so untouched rows and areas must survive by reference.
    const rowA = {status: 'queued', attemptId: 'a', attemptNumber: 1}
    const rowB = {status: 'queued', attemptId: 'b', attemptNumber: 1}
    const progress = {'https://www.quora.com/profile/A': {status: 'blocking'}}
    const runs = {'run-1': {id: 'run-1', status: 'active'}}
    const state = {
        queue: {
            'row-a': rowA,
            'row-b': rowB
        },
        progress,
        runs
    }

    const result = applyWalRecord(state, {
        seq: 1,
        id: 'record-1',
        kind: 'map.patch',
        area: 'queue',
        key: 'row-a',
        patch: {status: 'acting'}
    }, {})

    assert.equal(result.applied, true)
    assert.equal(result.state.queue['row-a'].status, 'acting')
    assert.equal(result.state.queue['row-b'], rowB)
    assert.equal(result.state.progress, progress)
    assert.equal(result.state.runs, runs)
    assert.equal(state.queue['row-a'], rowA)
    assert.equal(state.queue['row-a'].status, 'queued')
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

test('allows same-attempt-number terminal replay after actorless requeue changed attempt id', () => {
    const state = baseState()
    state.queue['https://www.quora.com/profile/A'] = {
        ...state.queue['https://www.quora.com/profile/A'],
        status: 'queued',
        attemptId: 'attempt-requeued-without-actor',
        attemptNumber: 2,
        actionLeaseReleaseReason: 'runtime-authority-missing-active-row'
    }
    const checkpoint = makeCheckpoint(state, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [{
        seq: 1,
        id: 'old-actor-terminal-same-number',
        kind: 'map.set',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        operationKind: 'terminal-progress',
        terminal: true,
        attemptId: 'attempt-old-actor',
        attemptNumber: 2,
        value: {
            status: 'failed',
            outcome: 'action-error',
            error: 'Durable active queue row had no confirmed runtime actor',
            attemptId: 'attempt-old-actor',
            attemptNumber: 2,
            runId: 'run-1',
            terminalAt: 1500
        }
    }])

    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'failed')
    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].outcome, 'action-error')
    assert.deepEqual(projected.ignored, [])
})

test('rejects same-attempt-number nonterminal replay after actorless requeue changed attempt id', () => {
    const state = baseState()
    state.queue['https://www.quora.com/profile/A'] = {
        ...state.queue['https://www.quora.com/profile/A'],
        status: 'queued',
        attemptId: 'attempt-requeued-without-actor',
        attemptNumber: 2,
        actionLeaseReleaseReason: 'runtime-authority-missing-active-row'
    }
    const checkpoint = makeCheckpoint(state, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [{
        seq: 1,
        id: 'old-actor-nonterminal-same-number',
        kind: 'map.set',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        operationKind: 'active-transition',
        attemptId: 'attempt-old-actor',
        attemptNumber: 2,
        value: {
            status: 'active',
            attemptId: 'attempt-old-actor',
            attemptNumber: 2,
            runId: 'run-1',
            tabId: 42
        }
    }])

    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'queued')
    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].attemptId, 'attempt-requeued-without-actor')
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

test('rejects late active transition after rollback of same attempt', () => {
    const state = baseState()
    state.queue['https://www.quora.com/profile/A'] = {
        ...state.queue['https://www.quora.com/profile/A'],
        status: 'queued',
        actionLeaseReleaseReason: 'active-transition-failed',
        actionLeaseReleasedAt: 1200,
        activeAt: 0,
        tabId: null
    }
    const checkpoint = makeCheckpoint(state, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [{
        seq: 1,
        id: 'late-active-after-rollback',
        kind: 'map.set',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        operationKind: 'active-transition',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        value: {
            status: 'active',
            attemptId: 'attempt-1',
            attemptNumber: 1,
            runId: 'run-1',
            activeAt: 1300,
            tabId: 42
        }
    }])

    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'queued')
    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].tabId, null)
    assert.equal(projected.ignored.length, 1)
    assert.equal(projected.ignored[0].reason, 'active-transition-after-rollback')
})

test('allows explicit live reclaim active transition after rollback', () => {
    const state = baseState()
    state.queue['https://www.quora.com/profile/A'] = {
        ...state.queue['https://www.quora.com/profile/A'],
        status: 'queued',
        actionLeaseReleaseReason: 'active-transition-failed',
        actionLeaseReleasedAt: 1200,
        activeAt: 0,
        tabId: null
    }
    const checkpoint = makeCheckpoint(state, {snapshotSeq: 0})
    const projected = projectSnapshot(checkpoint, [{
        seq: 1,
        id: 'live-reclaim-active-after-rollback',
        kind: 'map.set',
        area: 'queue',
        key: 'https://www.quora.com/profile/A',
        operationKind: 'active-transition',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        allowActiveTransitionAfterRollback: true,
        value: {
            status: 'active',
            attemptId: 'attempt-1',
            attemptNumber: 1,
            runId: 'run-1',
            activeAt: 1300,
            tabId: 42
        }
    }])

    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].status, 'active')
    assert.equal(projected.state.queue['https://www.quora.com/profile/A'].tabId, 42)
    assert.equal(projected.ignored.length, 0)
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

test('allows explicit terminal overwrite for manual requeue records', () => {
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

function monolithicAndShardedStores() {
    const monolithic = makePairedCheckpointStore(baseState(), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 10,
        nextSeq: 11
    })
    const written = writeInactiveCheckpoint(monolithic, baseState(), {
        snapshotSeq: 12,
        snapshotEpoch: 1,
        createdAt: 1,
        shardCount: 10
    })
    const activated = activateCheckpoint(written.store, written.checkpointId, {})
    assert.equal(activated.activated, true, activated.reason)
    return {monolithic, sharded: activated.store}
}

test('segmented WAL storage rejects a checkpoint manifest that does not match the active metadata', () => {
    // A manifest and the metadata's fingerprint for one active slot can name different checkpoints when they come from
    // different writes. The keyed read already refuses that mix (checkpoint-manifest-meta-mismatch), and hydrate must
    // refuse it too rather than rebuild state from the manifest. Each case hydrates the untouched payload first, so a
    // failure can only come from the one metadata field it tampers with.
    const baseKey = 'mbCoordinatorQueueWal'
    const metaKey = getSegmentedWalMetaKey(baseKey)
    const {monolithic, sharded} = monolithicAndShardedStores()
    const cases = [
        {label: 'monolithic active slot', store: monolithic, activeId: CHECKPOINT_A, field: 'snapshotSeq', value: 11},
        {label: 'sharded active slot', store: sharded, activeId: CHECKPOINT_B, field: 'stateHash', value: 'not-the-manifest-hash'}
    ]
    for(const {label, store, activeId, field, value} of cases) {
        const payload = buildSegmentedWalStoragePayload(store, {baseKey, writeCheckpoints: true})
        assert.equal(hydrateSegmentedWalStore(payload, {baseKey}).ok, true, `${label}: the untouched payload hydrates`)

        const meta = payload[metaKey]
        const mixed = {
            ...payload,
            [metaKey]: {
                ...meta,
                checkpoints: {
                    ...meta.checkpoints,
                    [activeId]: {...meta.checkpoints[activeId], [field]: value}
                }
            }
        }
        const hydrated = hydrateSegmentedWalStore(mixed, {baseKey})
        assert.equal(hydrated.ok, false, `${label}: a manifest that disagrees with the metadata must not hydrate`)
        assert.equal(hydrated.reason, 'checkpoint-manifest-meta-mismatch', label)
        assert.equal(hydrated.store, null, label)
    }
})

test('checkpoint fingerprint names the fields the manifest check compares, the same way for the metadata and the manifest', () => {
    // The recovery diagnostics name a checkpoint by its fingerprint, so the fingerprint must agree with the check it explains.
    // Equal manifest and metadata give equal fingerprints. A difference in any field the check compares must show in the
    // fingerprint. The slot id is part of it, because a manifest's own id is one of the things the check compares.
    const baseKey = 'mbCoordinatorQueueWal'
    const metaKey = getSegmentedWalMetaKey(baseKey)
    const {sharded} = monolithicAndShardedStores()
    const payload = buildSegmentedWalStoragePayload(sharded, {baseKey, writeCheckpoints: true})
    const metaCheckpoint = payload[metaKey].checkpoints[CHECKPOINT_B]
    const manifest = payload[getSegmentedWalCheckpointKey(baseKey, CHECKPOINT_B)]
    assert.equal(checkpointManifestMatchesMeta(manifest, metaCheckpoint, CHECKPOINT_B), true)

    const fingerprint = getCheckpointFingerprint(manifest, CHECKPOINT_B)
    assert.equal(getCheckpointFingerprint(metaCheckpoint, CHECKPOINT_B), fingerprint)
    const changed = [
        {field: 'stateHash', value: 'not-the-manifest-hash'},
        {field: 'snapshotSeq', value: metaCheckpoint.snapshotSeq + 1},
        {field: 'snapshotEpoch', value: metaCheckpoint.snapshotEpoch + 1},
        {field: 'createdAt', value: metaCheckpoint.createdAt + 1},
        {field: 'shardCount', value: metaCheckpoint.shardCount + 1}
    ]
    for(const {field, value} of changed) {
        const record = {...metaCheckpoint, [field]: value}
        assert.equal(checkpointManifestMatchesMeta(manifest, record, CHECKPOINT_B), false, field)
        assert.notEqual(getCheckpointFingerprint(record, CHECKPOINT_B), fingerprint, field)
    }
    assert.notEqual(getCheckpointFingerprint(manifest, CHECKPOINT_A), fingerprint, 'the slot id is part of the fingerprint')
})

test('a mirror rebuild copies a checkpoint manifest only when the loader rule accepts it against the disk meta', () => {
    // Hole 1 (docs/queue-storage-layering.md, section 6). The mirror rebuild names every manifest it would copy that disagrees with
    // the disk meta, so it can keep the session copy instead. The rule is the loader's: a sharded manifest needs a metadata entry and
    // an identity match (checkpointManifestMatchesMeta); a monolithic one is checked only when its entry exists; a missing manifest is
    // never copied. Only the slots the records hold are looked at.
    const baseKey = 'mbCoordinatorQueueWal'
    const metaKey = getSegmentedWalMetaKey(baseKey)
    const {sharded, monolithic} = monolithicAndShardedStores()
    const payload = buildSegmentedWalStoragePayload(sharded, {baseKey, writeCheckpoints: true})
    const meta = payload[metaKey]
    const active = meta.activeCheckpoint
    const manifestKey = getSegmentedWalCheckpointKey(baseKey, active)
    const manifest = payload[manifestKey]

    assert.deepEqual(findCheckpointManifestDisagreements({[manifestKey]: manifest}, meta, {baseKey}), [], 'a manifest that agrees is copied')
    assert.deepEqual(findCheckpointManifestDisagreements({}, meta, {baseKey}), [], 'no manifest in the records, nothing to check')

    const torn = {...manifest, stateHash: 'not-the-manifest-hash'}
    const found = findCheckpointManifestDisagreements({[manifestKey]: torn}, meta, {baseKey})
    assert.equal(found.length, 1)
    assert.equal(found[0].checkpointId, active)
    assert.equal(found[0].metaFingerprint, getCheckpointFingerprint(meta.checkpoints[active], active))
    assert.equal(found[0].manifestFingerprint, getCheckpointFingerprint(torn, active))

    assert.equal(findCheckpointManifestDisagreements({[manifestKey]: null}, meta, {baseKey}).length, 1, 'a missing manifest is never copied')

    const withoutEntry = {...meta, checkpoints: {}}
    assert.equal(findCheckpointManifestDisagreements({[manifestKey]: manifest}, withoutEntry, {baseKey}).length, 1, 'a sharded manifest with no metadata entry disagrees')

    const monolithicPayload = buildSegmentedWalStoragePayload(monolithic, {baseKey, writeCheckpoints: true})
    const monolithicMeta = {...monolithicPayload[metaKey]}
    delete monolithicMeta.checkpoints
    const monolithicKey = getSegmentedWalCheckpointKey(baseKey, monolithicMeta.activeCheckpoint)
    assert.deepEqual(
        findCheckpointManifestDisagreements({[monolithicKey]: monolithicPayload[monolithicKey]}, monolithicMeta, {baseKey}),
        [],
        'a monolithic manifest with no metadata entry predates fingerprints, and is copied as before'
    )
})

test('segmented WAL storage rejects a sharded active slot whose metadata has no fingerprint', () => {
    // Sharded manifests are only written together with their fingerprint, so a missing one means corruption, not an old layout.
    const baseKey = 'mbCoordinatorQueueWal'
    const metaKey = getSegmentedWalMetaKey(baseKey)
    const {sharded} = monolithicAndShardedStores()
    const payload = buildSegmentedWalStoragePayload(sharded, {baseKey, writeCheckpoints: true})
    const meta = {...payload[metaKey], checkpoints: {[CHECKPOINT_A]: payload[metaKey].checkpoints[CHECKPOINT_A]}}
    const hydrated = hydrateSegmentedWalStore({...payload, [metaKey]: meta}, {baseKey})
    assert.equal(hydrated.ok, false)
    assert.equal(hydrated.reason, 'checkpoint-meta-missing')
})

test('segmented WAL storage still hydrates a monolithic slot whose metadata predates the fingerprint', () => {
    // Stores written before the metadata recorded a fingerprint per slot have nothing to bind a manifest to, so the binding
    // check cannot apply to them. A monolithic slot with no fingerprint hydrates as it always did.
    const baseKey = 'mbCoordinatorQueueWal'
    const metaKey = getSegmentedWalMetaKey(baseKey)
    const {monolithic} = monolithicAndShardedStores()
    const payload = buildSegmentedWalStoragePayload(monolithic, {baseKey, writeCheckpoints: true})
    const meta = {...payload[metaKey]}
    delete meta.checkpoints
    const hydrated = hydrateSegmentedWalStore({...payload, [metaKey]: meta}, {baseKey})
    assert.equal(hydrated.ok, true, hydrated.reason)
    assert.equal(recoverProjectedState(hydrated.store).projected.state.queue['https://www.quora.com/profile/A'].status, 'queued')
})

test('one incremental append over a legacy seed keeps the metadata fingerprint and the stored manifest in agreement', () => {
    // The worker's own append (prepareCoordinatorQueueWalAppend, swCoordinatorQueueWal.js) over a monolithic seed, the shape
    // the synthetic legacy-queue fixtures start from. An incremental append writes the metadata and the new segment, not the
    // manifest. So after it, the active slot's fingerprint in the metadata must equal the stored manifest's stateHash, and
    // hydrate must accept what was written. Nothing else writes storage between the seed and the append.
    const baseKey = 'mbCoordinatorQueueWal'
    const metaKey = getSegmentedWalMetaKey(baseKey)
    const href = 'https://www.quora.com/profile/A'
    const seed = makePairedCheckpointStore({queue: {[href]: {status: 'queued', attemptId: 'attempt-1', attemptNumber: 1}}}, {
        createdAt: 1000,
        nextSeq: 1
    })
    const storage = buildSegmentedWalStoragePayload(seed, {baseKey, writeCheckpoints: true})
    const seeded = hydrateSegmentedWalStore(storage, {baseKey})
    assert.equal(seeded.ok, true, seeded.reason)

    const worker = createCoordinatorQueueWalStore({
        constants: {
            COORDINATOR_QUEUE_WAL_KEY: baseKey,
            COORDINATOR_QUEUE_WAL_META_KEY: metaKey,
            COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT: 128,
            COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT: 1024,
            COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS: []
        },
        metrics: {
            incrementQueueWakeupMetric: () => {},
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
    const prepared = worker.prepareCoordinatorQueueWalAppend(seeded.store, [{
        kind: 'map.patch',
        area: 'queue',
        key: href,
        patch: {status: 'opening'},
        operationKind: 'synthetic-open',
        attemptId: 'attempt-1',
        attemptNumber: 1,
        at: 1001
    }], {segmentId: 'synthetic-open-1', previousMeta: storage[metaKey], previousStored: storage})
    assert.equal(prepared.ok, true, prepared.reason)
    assert.equal(prepared.physicalWal.payload[getSegmentedWalCheckpointKey(baseKey, CHECKPOINT_A)], undefined, 'the append is incremental: no manifest is rewritten')
    Object.assign(storage, prepared.physicalWal.payload)

    const active = storage[metaKey].activeCheckpoint
    assert.equal(storage[metaKey].checkpoints[active].stateHash, storage[getSegmentedWalCheckpointKey(baseKey, active)].stateHash)
    const hydrated = hydrateSegmentedWalStore(storage, {baseKey})
    assert.equal(hydrated.ok, true, hydrated.reason)
    assert.equal(recoverProjectedState(hydrated.store).projected.state.queue[href].status, 'opening')
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
        mbSpaceRegistry: {
            post1: {updatedAt: 1000, profileHref: 'https://www.quora.com/profile/A'}
        },
        mbQueueWakeupMetrics: {
            counters: {x: 1}
        }
    }

    const split = splitCheckpointState(state)
    assert.deepEqual(Object.keys(split.recoveryCritical).sort(), ['events', 'progress', 'queue', 'runs'])
    assert.deepEqual(Object.keys(split.userMemory).sort(), ['mbQueueWakeupMetrics', 'mbSpaceRegistry'])

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

test('the queue namespace mirror keys include the outlier list key, after the runs key and before the progress keys', () => {
    const {queueNamespaceMirrorKeys} = require('../shared/js/walSnapshotStore')
    assert.deepEqual(
        queueNamespaceMirrorKeys({runsKey: 'runs', outliersKey: 'outliers', progressDefaults: {progressView: null, progressShard0: null}}),
        ['runs', 'outliers', 'progressView', 'progressShard0']
    )
    assert.deepEqual(
        queueNamespaceMirrorKeys({runsKey: 'runs', progressDefaults: {progressView: null}}),
        ['runs', 'progressView'],
        'the outlier key is optional'
    )
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
