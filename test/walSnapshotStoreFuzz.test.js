const assert = require('node:assert/strict')
const {
    CHECKPOINT_A,
    CHECKPOINT_B,
    activateCheckpoint,
    appendWalRecordsToGeneration,
    decodeCheckpointSnapshot,
    getActiveCheckpoint,
    getInactiveCheckpointId,
    getWalGeneration,
    getWalRecordsForGeneration,
    makePairedCheckpointStore,
    projectSnapshot,
    recoverProjectedState,
    verifyCheckpoint,
    writeInactiveCheckpoint
} = require('../shared/js/walSnapshotStore')

function mulberry32(seed) {
    let value = seed >>> 0
    return function random() {
        value += 0x6D2B79F5
        let next = value
        next = Math.imul(next ^ next >>> 15, next | 1)
        next ^= next + Math.imul(next ^ next >>> 7, next | 61)
        return ((next ^ next >>> 14) >>> 0) / 4294967296
    }
}

function pick(random, values) {
    return values[Math.floor(random() * values.length)]
}

function int(random, max) {
    return Math.floor(random() * max)
}

function envInt(name, fallback) {
    const value = Number.parseInt(process.env[name] || '', 10)
    return Number.isFinite(value) && value > 0 ? value : fallback
}

function shuffle(random, values) {
    const copy = [...values]
    for(let index = copy.length - 1; index > 0; index -= 1) {
        const swap = int(random, index + 1)
        const value = copy[index]
        copy[index] = copy[swap]
        copy[swap] = value
    }
    return copy
}

const fakeGzipCodec = {
    name: 'gzip',
    compress(bytes) {
        return Uint8Array.from(Array.from(bytes).map(byte => byte ^ 0x5A).reverse())
    },
    decompress(bytes) {
        return Uint8Array.from(Array.from(bytes).reverse().map(byte => byte ^ 0x5A))
    }
}

const fuzzConfig = {
    seedStart: envInt('WAL_FUZZ_SEED_START', 1),
    seedCount: envInt('WAL_FUZZ_SEEDS', 30),
    rounds: envInt('WAL_FUZZ_ROUNDS', 80),
    minActors: envInt('WAL_FUZZ_ACTORS_MIN', 2),
    maxActors: envInt('WAL_FUZZ_ACTORS_MAX', 6),
    profile: `${process.env.WAL_FUZZ_PROFILE || 'default'}`
}

function isLongProfile(config = fuzzConfig) {
    return config.profile === 'long' || config.profile === 'malicious'
}

function initialState(seed) {
    const href = `https://www.quora.com/profile/Fuzz-${seed}`
    return {
        queue: {
            [href]: {
                status: 'queued',
                attemptId: 'attempt-1',
                attemptNumber: 1,
                runId: `run-${seed}`
            }
        },
        progress: {},
        runs: {
            [`run-${seed}`]: {
                id: `run-${seed}`,
                status: 'active'
            }
        },
        events: []
    }
}

function profile(seed, index) {
    return `https://www.quora.com/profile/Fuzz-${seed}-${index}`
}

function poisonProfile(seed, generation, index) {
    return `https://www.quora.com/profile/Poison-${generation}-${seed}-${index}`
}

function makePatch(random, attemptNumber) {
    const status = pick(random, ['queued', 'acting', 'succeeded', 'failed', 'canceled'])
    const patch = {
        status,
        attemptId: `attempt-${attemptNumber}`,
        attemptNumber,
        touchedAt: int(random, 1000000)
    }

    if(status === 'succeeded') patch.outcome = 'blocked'
    if(status === 'failed') patch.outcome = 'timeout'
    if(status === 'canceled') patch.outcome = 'canceled'

    return patch
}

function makeOperation(random, seed, round, actor, snapshot) {
    const active = snapshot?.meta?.activeCheckpoint || CHECKPOINT_A
    const inactive = getInactiveCheckpointId(active)
    const operations = [
        'append-active',
        'append-active-duplicate',
        'append-active-stale',
        'append-active-pre-snapshot',
        'append-inactive-poison',
        'write-inactive-raw',
        'write-inactive-compressed',
        'corrupt-inactive-then-activate',
        'activate-inactive'
    ]
    if(isLongProfile()) {
        operations.push(
            'crash-after-inactive-reset-with-poison',
            'activate-inactive-with-wal-tail',
            'activate-missing-codec-checkpoint',
            'activate-hash-mismatch-checkpoint',
            'append-malformed-active-segment'
        )
    }
    const operation = pick(random, operations)
    const key = profile(seed, int(random, 8))
    const attemptNumber = int(random, 4) + 1

    return {
        operation,
        active,
        inactive,
        key,
        attemptNumber,
        actor,
        round,
        segmentId: `${operation}-${round}-${actor}-${int(random, 10000)}`,
        poisonKey: poisonProfile(seed, inactive, round * 10 + actor),
        poisonValue: `poison-${seed}-${round}-${actor}`,
        patch: makePatch(random, attemptNumber),
        useCompression: random() < 0.5
    }
}

function recoverState(store, context) {
    const recovered = recoverProjectedState(store, [], {codec: fakeGzipCodec})
    assert.equal(recovered.recovered, true, `${context}: active checkpoint should recover: ${recovered.reason || ''}`)
    return recovered
}

function assertStoreInvariants(store, context) {
    const active = store?.meta?.activeCheckpoint
    assert.ok(active === CHECKPOINT_A || active === CHECKPOINT_B, `${context}: active generation must be A or B`)

    const activeCheckpoint = getActiveCheckpoint(store)
    const checkpointVerification = verifyCheckpoint(activeCheckpoint, {codec: fakeGzipCodec})
    assert.equal(checkpointVerification.ok, true, `${context}: active checkpoint verifies: ${checkpointVerification.reason || ''}`)

    const activeGeneration = getWalGeneration(store, active)
    assert.equal(
        activeGeneration.snapshotSeq,
        activeCheckpoint.snapshotSeq,
        `${context}: active WAL generation should start at active checkpoint seq`
    )

    const recovered = recoverState(store, context)
    assert.equal(recovered.generationId, active, `${context}: recovery uses active generation`)

    const projected = projectSnapshot(
        activeCheckpoint,
        getWalRecordsForGeneration(store, active),
        {codec: fakeGzipCodec}
    )
    assert.deepEqual(
        recovered.projected.state,
        projected.state,
        `${context}: recovery equals active checkpoint plus active WAL only`
    )

    const appliedIds = new Set()
    for(const id of recovered.projected.appliedIds) {
        assert.equal(appliedIds.has(id), false, `${context}: duplicate applied id ${id}`)
        appliedIds.add(id)
    }

    for(const record of recovered.projected.applied) {
        assert.ok(
            record.seq > activeCheckpoint.snapshotSeq,
            `${context}: applied seq ${record.seq} must be after snapshot ${activeCheckpoint.snapshotSeq}`
        )
    }
}

function applyOperation(store, descriptor) {
    const active = store?.meta?.activeCheckpoint || CHECKPOINT_A
    const inactive = getInactiveCheckpointId(active)

    switch(descriptor.operation) {
        case 'append-active':
            return appendWalRecordsToGeneration(store, [{
                id: `active-${descriptor.round}-${descriptor.actor}`,
                kind: 'map.patch',
                area: 'queue',
                key: descriptor.key,
                attemptId: `attempt-${descriptor.attemptNumber}`,
                attemptNumber: descriptor.attemptNumber,
                patch: descriptor.patch
            }], {
                generationId: active,
                segmentId: descriptor.segmentId
            }).store

        case 'append-active-duplicate':
            return appendWalRecordsToGeneration(store, [{
                id: `duplicate-${descriptor.key}`,
                kind: 'map.patch',
                area: 'queue',
                key: descriptor.key,
                patch: {
                    status: 'acting',
                    attemptNumber: descriptor.attemptNumber
                }
            }, {
                id: `duplicate-${descriptor.key}`,
                kind: 'map.patch',
                area: 'queue',
                key: descriptor.key,
                patch: {
                    status: 'failed',
                    outcome: 'malicious-duplicate',
                    attemptNumber: descriptor.attemptNumber
                }
            }], {
                generationId: active,
                segmentId: descriptor.segmentId
            }).store

        case 'append-active-stale':
            return appendWalRecordsToGeneration(store, [{
                id: `stale-${descriptor.round}-${descriptor.actor}`,
                kind: 'map.patch',
                area: 'queue',
                key: descriptor.key,
                attemptId: 'attempt-0',
                attemptNumber: 0,
                patch: {
                    status: 'succeeded',
                    outcome: 'stale-poison',
                    attemptId: 'attempt-0',
                    attemptNumber: 0
                }
            }], {
                generationId: active,
                segmentId: descriptor.segmentId
            }).store

        case 'append-active-pre-snapshot':
            return appendWalRecordsToGeneration(store, [{
                seq: Math.max(1, (getActiveCheckpoint(store)?.snapshotSeq || 1) - 1),
                id: `pre-snapshot-${descriptor.round}-${descriptor.actor}`,
                kind: 'map.patch',
                area: 'queue',
                key: descriptor.key,
                patch: {
                    status: 'failed',
                    outcome: 'pre-snapshot-poison'
                }
            }], {
                generationId: active,
                segmentId: descriptor.segmentId
            }).store

        case 'append-inactive-poison':
        {
            const result = appendWalRecordsToGeneration(store, [{
                id: `inactive-poison-${descriptor.round}-${descriptor.actor}`,
                kind: 'map.patch',
                area: 'queue',
                key: descriptor.poisonKey,
                patch: {
                    status: 'succeeded',
                    outcome: 'inactive-poison'
                }
            }], {
                generationId: inactive,
                segmentId: descriptor.segmentId
            })
            assert.equal(result.rejected, true, 'ordinary append to inactive generation should be rejected')
            const recovered = recoverProjectedState(result.store, [], {codec: fakeGzipCodec})
            assert.equal(
                recovered.projected.state.queue?.[descriptor.poisonKey],
                undefined,
                'rejected inactive-generation append should not affect active recovery'
            )
            return result.store
        }

        case 'write-inactive-raw':
        case 'write-inactive-compressed': {
            const recovered = recoverState(store, `${descriptor.operation}:${descriptor.round}:${descriptor.actor}`)
            const nextState = recovered.projected.state
            const targetSeq = Math.max(recovered.projected.maxSeq, getActiveCheckpoint(store)?.snapshotSeq || 0) + 1
            return writeInactiveCheckpoint(store, nextState, {
                snapshotSeq: targetSeq,
                snapshotEpoch: targetSeq,
                codec: descriptor.operation === 'write-inactive-compressed' ? fakeGzipCodec : null
            }).store
        }

        case 'corrupt-inactive-then-activate': {
            const prepared = writeInactiveCheckpoint(store, recoverState(store, 'corrupt-prepare').projected.state, {
                snapshotSeq: (getActiveCheckpoint(store)?.snapshotSeq || 0) + 5,
                snapshotEpoch: descriptor.round + 1,
                codec: fakeGzipCodec
            }).store
            const corrupt = JSON.parse(JSON.stringify(prepared))
            const target = corrupt.checkpoints?.[inactive]
            if(target?.payload) target.payload = target.payload.slice(1)
            else if(target?.state) target.state.queue = {'https://www.quora.com/profile/Corrupt': {status: 'succeeded'}}
            const activated = activateCheckpoint(corrupt, inactive, {codec: fakeGzipCodec})
            assert.equal(activated.activated, false, 'corrupted inactive checkpoint must not activate')
            return activated.store
        }

        case 'crash-after-inactive-reset-with-poison': {
            const recovered = recoverState(store, `${descriptor.operation}:${descriptor.round}:${descriptor.actor}`)
            const targetSeq = Math.max(recovered.projected.maxSeq, getActiveCheckpoint(store)?.snapshotSeq || 0) + 1
            const prepared = writeInactiveCheckpoint(store, recovered.projected.state, {
                snapshotSeq: targetSeq,
                snapshotEpoch: descriptor.round + 1,
                segments: [{
                    id: `inactive-tail-${descriptor.round}-${descriptor.actor}`,
                    records: [{
                        seq: targetSeq + 1,
                        id: `inactive-tail-poison-${descriptor.round}-${descriptor.actor}`,
                        kind: 'map.patch',
                        area: 'queue',
                        key: descriptor.poisonKey,
                        patch: {
                            status: 'succeeded',
                            outcome: descriptor.poisonValue
                        }
                    }]
                }]
            }).store
            const afterCrash = recoverState(prepared, `${descriptor.operation}:recover-active`)
            assert.equal(
                afterCrash.projected.state.queue?.[descriptor.poisonKey],
                undefined,
                'inactive checkpoint WAL tail must not affect recovery before pointer flip'
            )
            return prepared
        }

        case 'activate-inactive-with-wal-tail': {
            const recovered = recoverState(store, `${descriptor.operation}:${descriptor.round}:${descriptor.actor}`)
            const targetSeq = Math.max(recovered.projected.maxSeq, getActiveCheckpoint(store)?.snapshotSeq || 0) + 1
            const prepared = writeInactiveCheckpoint(store, recovered.projected.state, {
                snapshotSeq: targetSeq,
                snapshotEpoch: descriptor.round + 1,
                segments: [{
                    id: `inactive-good-tail-${descriptor.round}-${descriptor.actor}`,
                    records: [{
                        seq: targetSeq + 1,
                        id: `inactive-good-tail-${descriptor.round}-${descriptor.actor}`,
                        kind: 'map.patch',
                        area: 'queue',
                        key: descriptor.key,
                        attemptNumber: descriptor.attemptNumber,
                        patch: descriptor.patch
                    }]
                }]
            }).store
            return activateCheckpoint(prepared, inactive, {codec: fakeGzipCodec}).store
        }

        case 'activate-missing-codec-checkpoint': {
            const prepared = writeInactiveCheckpoint(store, recoverState(store, 'missing-codec-prepare').projected.state, {
                snapshotSeq: (getActiveCheckpoint(store)?.snapshotSeq || 0) + 1,
                snapshotEpoch: descriptor.round + 1,
                codec: fakeGzipCodec
            }).store
            const activated = activateCheckpoint(prepared, inactive)
            assert.equal(activated.activated, false, 'compressed checkpoint must not activate without its codec')
            return activated.store
        }

        case 'activate-hash-mismatch-checkpoint': {
            const prepared = writeInactiveCheckpoint(store, recoverState(store, 'hash-mismatch-prepare').projected.state, {
                snapshotSeq: (getActiveCheckpoint(store)?.snapshotSeq || 0) + 1,
                snapshotEpoch: descriptor.round + 1
            }).store
            const corrupt = JSON.parse(JSON.stringify(prepared))
            corrupt.checkpoints[inactive].stateHash = `bad-${descriptor.round}-${descriptor.actor}`
            const activated = activateCheckpoint(corrupt, inactive, {codec: fakeGzipCodec})
            assert.equal(activated.activated, false, 'state-hash-mismatched checkpoint must not activate')
            return activated.store
        }

        case 'append-malformed-active-segment': {
            const nextStore = JSON.parse(JSON.stringify(store))
            const checkpointSeq = getActiveCheckpoint(store)?.snapshotSeq || 0
            const generation = nextStore.wal[active]
            generation.segments.push({
                id: `malformed-${descriptor.round}-${descriptor.actor}`,
                fromSeq: checkpointSeq + 1000,
                toSeq: checkpointSeq - 1,
                sealed: false,
                records: [{
                    seq: checkpointSeq,
                    id: `malformed-pre-snapshot-${descriptor.round}-${descriptor.actor}`,
                    kind: 'map.patch',
                    area: 'queue',
                    key: descriptor.poisonKey,
                    patch: {
                        status: 'succeeded',
                        outcome: descriptor.poisonValue
                    }
                }, {
                    seq: checkpointSeq + 1,
                    id: `malformed-live-${descriptor.round}-${descriptor.actor}`,
                    kind: 'map.patch',
                    area: 'queue',
                    key: descriptor.key,
                    attemptNumber: descriptor.attemptNumber,
                    patch: descriptor.patch
                }]
            })
            return nextStore
        }

        case 'activate-inactive': {
            const activated = activateCheckpoint(store, inactive, {codec: fakeGzipCodec})
            return activated.store
        }

        default:
            return store
    }
}

function runSeed(seed, config = fuzzConfig) {
    const random = mulberry32(seed)
    let store = makePairedCheckpointStore(initialState(seed), {
        activeCheckpoint: CHECKPOINT_A,
        snapshotSeq: 1,
        snapshotEpoch: 1,
        createdAt: seed
    })

    for(let round = 0; round < config.rounds; round += 1) {
        const snapshot = JSON.parse(JSON.stringify(store))
        const actorSpan = Math.max(1, config.maxActors - config.minActors + 1)
        const actorCount = config.minActors + int(random, actorSpan)
        const operations = []
        for(let actor = 0; actor < actorCount; actor += 1) {
            operations.push(makeOperation(random, seed, round, actor, snapshot))
        }

        for(const operation of shuffle(random, operations)) {
            const context = `profile ${config.profile} seed ${seed} round ${round} op ${operation.operation}`
            store = applyOperation(store, operation)
            assertStoreInvariants(store, context)
        }
    }
}

const startTime = Date.now()
console.log(`wal fuzz profile=${fuzzConfig.profile} seedStart=${fuzzConfig.seedStart} seeds=${fuzzConfig.seedCount} rounds=${fuzzConfig.rounds} actors=${fuzzConfig.minActors}-${fuzzConfig.maxActors}`)
for(let offset = 0; offset < fuzzConfig.seedCount; offset += 1) {
    const seed = fuzzConfig.seedStart + offset
    runSeed(seed)
    console.log(`ok - malicious concurrent WAL fuzz seed ${seed}`)
}
console.log(`ok - WAL fuzz completed in ${Date.now() - startTime}ms`)
