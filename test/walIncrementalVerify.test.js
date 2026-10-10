// Incremental append verification must agree with full recovery (see verifyAppendedIncrementally in
// shared/js/swCoordinatorQueueWal.js). Covers random queue-area appends, a duplicate-id append that must
// fail closed, and a non-contiguous append that must fall back to full recovery.
const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const wal = require('../shared/js/walSnapshotStore')
const {createCoordinatorQueueWalStore} = require('../shared/js/swCoordinatorQueueWal')

const codec = {
    name: 'gzip',
    compress: bytes => zlib.gzipSync(bytes),
    decompress: bytes => zlib.gunzipSync(bytes)
}
const codecOptions = {codec}
const BASE = 'mbIncr'

// The WAL module takes these capabilities. The stubs are the JSON-safe equivalents the service worker uses.
const verifier = createCoordinatorQueueWalStore({
    constants: {
        COORDINATOR_QUEUE_WAL_KEY: BASE,
        COORDINATOR_QUEUE_WAL_META_KEY: `${BASE}.meta`,
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
        makeCoordinatorQueueWalCheckpoint: state => wal.makeCheckpoint(state, {codec})
    },
    runtime: {Date}
})

function makeRandom(seed) {
    let state = seed >>> 0
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 0x100000000
    }
}

const STATUSES = ['queued', 'active', 'succeeded', 'failed']

function canonical(value) {
    return JSON.stringify(value, Object.keys(value || {}).sort())
}

function sortedJson(value) {
    if(Array.isArray(value)) return value.map(sortedJson)
    if(value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJson(value[key])]))
    }
    return value
}

// A paired checkpoint with some queue rows, then one active generation with a tail of segments.
function makeBaseStore(seed) {
    const random = makeRandom(seed)
    const rows = {}
    const hrefs = []
    for(let index = 0; index < 6; index += 1) {
        const href = `https://www.quora.com/profile/Incr-${seed}-${index}`
        hrefs.push(href)
        rows[href] = {status: STATUSES[Math.floor(random() * STATUSES.length)], attemptId: `a-${index}`, attemptNumber: 1, tabId: index + 1, updatedAt: index}
    }
    const written = wal.writeInactiveCheckpoint(wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec}), {queue: rows, completed: {}, runs: {}, progress: {}, events: []}, {
        snapshotSeq: 0, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name, shardCount: 4
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, codecOptions)
    assert.equal(activated.activated, true, activated.reason)
    return {store: activated.store, hrefs}
}

// Random map.set / map.patch / map.remove records on the queue area, with contiguous seqs from nextSeq.
function makeAppendRecords(store, hrefs, count, random) {
    const records = []
    let seq = Number(store.meta.nextSeq) || 1
    for(let index = 0; index < count; index += 1) {
        const href = hrefs[Math.floor(random() * hrefs.length)]
        const roll = random()
        const record = roll < 0.3
            ? {seq, kind: 'map.remove', area: 'queue', key: href}
            : roll < 0.6
                ? {seq, kind: 'map.set', area: 'queue', key: href, value: {status: STATUSES[Math.floor(random() * STATUSES.length)], attemptId: `set-${seq}`, attemptNumber: 1, tabId: seq}}
                : {seq, kind: 'map.patch', area: 'queue', key: href, patch: {status: STATUSES[Math.floor(random() * STATUSES.length)], updatedAt: seq}}
        records.push(record)
        seq += 1
    }
    return records
}

function runPaths(store, records, baseQueue) {
    const appended = wal.appendWalRecordsToGeneration(store, records, {})
    const append = {store: appended.store, records: records.map(record => wal.makeWalRecord(record))}
    const baseNextSeq = Number(store.meta.nextSeq)
    const full = verifier.verifyAppendedCoordinatorQueueWalReplay(append, codecOptions)
    const incremental = verifier.verifyAppendedCoordinatorQueueWalReplay(append, {...codecOptions, baseQueue, baseNextSeq})
    return {append, full, incremental}
}

const cases = []
function register(name, fn) {
    cases.push({name, fn})
}

register('incremental verification agrees with full recovery over random queue appends', () => {
    for(let seed = 1; seed <= 25; seed += 1) {
        const {store, hrefs} = makeBaseStore(seed)
        const random = makeRandom(seed * 7919)
        const recovered = wal.recoverProjectedState(store, [], codecOptions)
        assert.equal(recovered.recovered, true, `seed ${seed}: base recovers`)
        const baseQueue = recovered.projected.state.queue
        const records = makeAppendRecords(store, hrefs, 1 + Math.floor(random() * 4), random)
        const {full, incremental} = runPaths(store, records, baseQueue)
        assert.equal(incremental.incremental, true, `seed ${seed}: incremental path used`)
        assert.equal(incremental.ok, full.ok, `seed ${seed}: acceptance agrees`)
        if(full.ok) {
            assert.equal(
                canonical(sortedJson(incremental.authoritativeProjectionQueue)),
                canonical(sortedJson(full.authoritativeProjectionQueue)),
                `seed ${seed}: queue agrees`
            )
        }
    }
})

register('a duplicate-id append fails closed on the incremental path too', () => {
    const {store, hrefs} = makeBaseStore(91)
    const baseQueue = wal.recoverProjectedState(store, [], codecOptions).projected.state.queue
    const random = makeRandom(4242)
    const [first] = makeAppendRecords(store, hrefs, 1, random)
    const records = [first, {...first}]
    const appended = wal.appendWalRecordsToGeneration(store, records, {})
    const append = {store: appended.store, records: records.map(record => wal.makeWalRecord(record))}
    const ids = append.records.map(record => record.id)
    assert.equal(new Set(ids).size, 1, 'the duplicate record shares one id')
    const incremental = verifier.verifyAppendedCoordinatorQueueWalReplay(append, {...codecOptions, baseQueue, baseNextSeq: Number(store.meta.nextSeq)})
    assert.equal(incremental.ok, false)
    assert.ok(incremental.ignoredAppendedRecords.length >= 1)
})

register('a non-contiguous append falls back to full recovery', () => {
    const {store, hrefs} = makeBaseStore(33)
    const baseQueue = wal.recoverProjectedState(store, [], codecOptions).projected.state.queue
    const random = makeRandom(55)
    const [record] = makeAppendRecords(store, hrefs, 1, random)
    const gapped = {...record, seq: record.seq + 5}
    const appended = wal.appendWalRecordsToGeneration(store, [gapped], {})
    const append = {store: appended.store, records: [wal.makeWalRecord(gapped)]}
    const baseNextSeq = Number(store.meta.nextSeq)
    const result = verifier.verifyAppendedCoordinatorQueueWalReplay(append, {...codecOptions, baseQueue, baseNextSeq})
    assert.equal(result.incremental, undefined, 'full recovery answered, not the incremental path')
})

register('a completed-area append falls back to full recovery', () => {
    const {store} = makeBaseStore(77)
    const baseQueue = wal.recoverProjectedState(store, [], codecOptions).projected.state.queue
    const seq = Number(store.meta.nextSeq)
    const record = {seq, kind: 'map.set', area: 'completed', key: 'https://www.quora.com/profile/Done', value: {status: 'succeeded', terminalAt: 1}}
    const appended = wal.appendWalRecordsToGeneration(store, [record], {})
    const append = {store: appended.store, records: [wal.makeWalRecord(record)]}
    const result = verifier.verifyAppendedCoordinatorQueueWalReplay(append, {...codecOptions, baseQueue})
    assert.equal(result.incremental, undefined)
})

;(async () => {
    let failed = 0
    for(const testCase of cases) {
        try {
            testCase.fn()
            console.log(`ok - ${testCase.name}`)
        }
        catch(error) {
            failed += 1
            console.log(`not ok - ${testCase.name}`)
            console.log(error?.stack || error)
        }
    }
    if(failed) {
        throw new Error(`${failed} walIncrementalVerify test${failed === 1 ? '' : 's'} failed`)
    }
})().catch(error => {
    console.error(error?.message || error)
    process.exitCode = 1
})
