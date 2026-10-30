// Incremental append verification must agree with full recovery (see verifyAppendedIncrementally in
// shared/js/swCoordinatorQueueWal.js). Covers random queue-area appends and random mixed queue and completed appends,
// a duplicate-id append that must fail closed, an archive, a requeue and a rejected completed record checked on both
// paths, and the appends that must fall back to full recovery.
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
// Every replay-verify counter the verifier moves, so a test can see which path answered an append.
const counters = {}

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
        incrementQueueWakeupMetric: (name, amount = 1) => {
            counters[name] = (counters[name] || 0) + amount
        },
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

// A deep comparison of sorted JSON. The earlier version passed the top-level keys as a JSON replacer, which dropped every
// nested field, so two queues whose rows differed in status compared equal.
function canonical(value) {
    return JSON.stringify(sortedJson(value))
}

function sortedJson(value) {
    if(Array.isArray(value)) return value.map(sortedJson)
    if(value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJson(value[key])]))
    }
    return value
}

// A paired checkpoint holding the given queue and completed maps, activated the way hydrate reads a store.
function makeStore({queue = {}, completed = {}}) {
    const written = wal.writeInactiveCheckpoint(wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec}), {queue, completed, runs: {}, progress: {}, events: []}, {
        snapshotSeq: 0, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name, shardCount: 4
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, codecOptions)
    assert.equal(activated.activated, true, activated.reason)
    return activated.store
}

// A paired checkpoint with some queue rows and the given completed rows, then one active generation with a tail of segments.
function makeBaseStore(seed, completed = {}) {
    const random = makeRandom(seed)
    const rows = {}
    const hrefs = []
    for(let index = 0; index < 6; index += 1) {
        const href = `https://www.quora.com/profile/Incr-${seed}-${index}`
        hrefs.push(href)
        rows[href] = {status: STATUSES[Math.floor(random() * STATUSES.length)], attemptId: `a-${index}`, attemptNumber: 1, tabId: index + 1, updatedAt: index}
    }
    return {store: makeStore({queue: rows, completed}), hrefs}
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

function runPaths(store, records, baseQueue, baseCompleted) {
    const appended = wal.appendWalRecordsToGeneration(store, records, {})
    const append = {store: appended.store, records: records.map(record => wal.makeWalRecord(record))}
    const baseNextSeq = Number(store.meta.nextSeq)
    const full = verifier.verifyAppendedCoordinatorQueueWalReplay(append, codecOptions)
    const incremental = verifier.verifyAppendedCoordinatorQueueWalReplay(append, {...codecOptions, baseQueue, baseCompleted, baseNextSeq})
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
        const {full, incremental} = runPaths(store, records, baseQueue, recovered.projected.state.completed)
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
    const {baseQueue, baseCompleted} = baseOf(store)
    const random = makeRandom(4242)
    const [first] = makeAppendRecords(store, hrefs, 1, random)
    const records = [first, {...first}]
    const appended = wal.appendWalRecordsToGeneration(store, records, {})
    const append = {store: appended.store, records: records.map(record => wal.makeWalRecord(record))}
    const ids = append.records.map(record => record.id)
    assert.equal(new Set(ids).size, 1, 'the duplicate record shares one id')
    const incremental = verifier.verifyAppendedCoordinatorQueueWalReplay(append, {...codecOptions, baseQueue, baseCompleted, baseNextSeq: Number(store.meta.nextSeq)})
    assert.equal(incremental.ok, false)
    assert.ok(incremental.ignoredAppendedRecords.length >= 1)
})

register('a non-contiguous append falls back to full recovery', () => {
    const {store, hrefs} = makeBaseStore(33)
    const {baseQueue, baseCompleted} = baseOf(store)
    const random = makeRandom(55)
    const [record] = makeAppendRecords(store, hrefs, 1, random)
    const gapped = {...record, seq: record.seq + 5}
    const appended = wal.appendWalRecordsToGeneration(store, [gapped], {})
    const append = {store: appended.store, records: [wal.makeWalRecord(gapped)]}
    const baseNextSeq = Number(store.meta.nextSeq)
    const result = verifier.verifyAppendedCoordinatorQueueWalReplay(append, {...codecOptions, baseQueue, baseCompleted, baseNextSeq})
    assert.equal(result.incremental, undefined, 'full recovery answered, not the incremental path')
})

register('a completed-area append with no completed base falls back to full recovery', () => {
    const {store} = makeBaseStore(77)
    const baseQueue = wal.recoverProjectedState(store, [], codecOptions).projected.state.queue
    const seq = Number(store.meta.nextSeq)
    const record = {seq, kind: 'map.set', area: 'completed', key: 'https://www.quora.com/profile/Done', value: {status: 'succeeded', terminalAt: 1}}
    const appended = wal.appendWalRecordsToGeneration(store, [record], {})
    const append = {store: appended.store, records: [wal.makeWalRecord(record)]}
    const result = verifier.verifyAppendedCoordinatorQueueWalReplay(append, {...codecOptions, baseQueue})
    assert.equal(result.incremental, undefined)
})

// The counter movements one call made. Only the two replay-verify counters move in these tests.
function countersDuring(fn) {
    const before = {...counters}
    const result = fn()
    const moved = {}
    for(const name of Object.keys(counters)) {
        const change = (counters[name] || 0) - (before[name] || 0)
        if(change) moved[name] = change
    }
    return {result, moved}
}

// The state a worker verifies an append against: the queue and completed maps full recovery reads from the store before the append.
function baseOf(store) {
    const state = wal.recoverProjectedState(store, [], codecOptions).projected.state
    return {baseQueue: state.queue, baseCompleted: state.completed}
}

// Appends records to a copy of the store and verifies the append both ways: full recovery of the whole log, and the incremental
// path on the base. The store and the base are not written. overrides replaces parts of the incremental options.
function verifyBothWays(store, records, base = baseOf(store), overrides = {}) {
    const appended = wal.appendWalRecordsToGeneration(store, records, {})
    const append = {store: appended.store, records: records.map(record => wal.makeWalRecord(record))}
    const baseNextSeq = Number(store.meta.nextSeq)
    const full = countersDuring(() => verifier.verifyAppendedCoordinatorQueueWalReplay(append, codecOptions))
    const incremental = countersDuring(() => verifier.verifyAppendedCoordinatorQueueWalReplay(append, {...codecOptions, ...base, baseNextSeq, ...overrides}))
    return {full: full.result, fullMoved: full.moved, incremental: incremental.result, incrementalMoved: incremental.moved}
}

function ignoredKeys(result) {
    return (result.ignoredAppendedRecords || []).map(entry => [entry.record.id, entry.reason])
}

// The agreement every append must show: acceptance, the records ignored and why, and the resulting queue.
function assertSameReplayResult(incremental, full, label) {
    assert.equal(incremental.ok, full.ok, `${label}: acceptance agrees`)
    assert.deepEqual(ignoredKeys(incremental), ignoredKeys(full), `${label}: the same records are ignored, for the same reasons`)
    assert.equal(canonical(incremental.authoritativeProjectionQueue), canonical(full.authoritativeProjectionQueue), `${label}: the queue agrees`)
}

// Random records over both areas. Completed records carry their attempt on the record as well as in the value, so the reducer's
// stale-attempt and terminal-regression checks see them on either path.
function makeMixedAppendRecords(store, hrefs, completedHrefs, count, random) {
    const records = []
    let seq = Number(store.meta.nextSeq) || 1
    for(let index = 0; index < count; index += 1) {
        const roll = random()
        const key = random() < 0.5
            ? hrefs[Math.floor(random() * hrefs.length)]
            : completedHrefs[Math.floor(random() * completedHrefs.length)]
        const area = completedHrefs.includes(key) ? 'completed' : 'queue'
        const attemptNumber = 1 + Math.floor(random() * 3)
        const attemptId = `m-${attemptNumber}-${Math.floor(random() * 2)}`
        const status = STATUSES[Math.floor(random() * STATUSES.length)]
        const record = roll < 0.25
            ? {seq, kind: 'map.remove', area, key}
            : roll < 0.6
                ? {seq, kind: 'map.set', area, key, value: {status, attemptId, attemptNumber}, attemptId, attemptNumber, status, terminal: true}
                : {seq, kind: 'map.patch', area, key, patch: {status, attemptId, attemptNumber}, attemptId, attemptNumber, status}
        records.push(record)
        seq += 1
    }
    return records
}

register('an archive append (queue removal plus completed set) verifies incrementally, agrees with full recovery, and leaves the base alone', () => {
    const href = 'https://www.quora.com/profile/Archived-Row'
    const survivor = 'https://www.quora.com/profile/Survivor-Row'
    const row = {status: 'succeeded', attemptId: 'a-archive', attemptNumber: 1, runId: 'run-archive', updatedAt: 9, terminalAt: 9}
    const store = makeStore({queue: {[href]: row, [survivor]: {status: 'queued', attemptId: 'a-survivor', attemptNumber: 1, runId: 'run-archive'}}})
    const base = baseOf(store)
    const baseBefore = canonical(base)
    const seq = Number(store.meta.nextSeq)
    const records = [
        {seq, kind: 'map.remove', area: 'queue', key: href, removed: true, attemptId: 'a-archive', attemptNumber: 1, status: 'succeeded'},
        {seq: seq + 1, kind: 'map.set', area: 'completed', key: href, value: row, attemptId: 'a-archive', attemptNumber: 1, status: 'succeeded', terminal: true}
    ]
    const {full, fullMoved, incremental, incrementalMoved} = verifyBothWays(store, records, base)
    assert.deepEqual(incrementalMoved, {'queueWal.replayVerify.incremental': 1}, 'the archive append was verified on the incremental path only')
    assert.deepEqual(fullMoved, {'queueWal.replayVerify.full': 1})
    assert.equal(incremental.incremental, true)
    assert.equal(incremental.ok, true)
    assertSameReplayResult(incremental, full, 'archive')
    assert.equal(canonical(incremental.authoritativeProjectionCompleted), canonical(full.authoritativeProjectionCompleted), 'archive: the completed map agrees')
    assert.deepEqual(Object.keys(incremental.authoritativeProjectionQueue), [survivor], 'the archived row left the queue')
    assert.deepEqual(incremental.authoritativeProjectionCompleted[href], row, 'the archived row is in the completed map')
    assert.equal(canonical(base), baseBefore, 'the base maps the caller passed were not written')
})

register('a requeue that pulls a row back out of the completed area verifies incrementally and agrees with full recovery', () => {
    const href = 'https://www.quora.com/profile/Requeued-Row'
    const archived = {status: 'failed', attemptId: 'a-1', attemptNumber: 1, runId: 'run-requeue', terminalAt: 3}
    const store = makeStore({completed: {[href]: archived}})
    const base = baseOf(store)
    const seq = Number(store.meta.nextSeq)
    const requeued = {status: 'queued', attemptId: 'a-2', attemptNumber: 2, runId: 'run-requeue'}
    const records = [
        {seq, kind: 'map.set', area: 'queue', key: href, value: requeued, attemptId: 'a-2', attemptNumber: 2, status: 'queued'},
        {seq: seq + 1, kind: 'map.remove', area: 'completed', key: href, removed: true, attemptId: 'a-1', attemptNumber: 1, status: 'failed'}
    ]
    const {full, incremental, incrementalMoved} = verifyBothWays(store, records, base)
    assert.deepEqual(incrementalMoved, {'queueWal.replayVerify.incremental': 1})
    assert.equal(incremental.ok, true)
    assertSameReplayResult(incremental, full, 'requeue')
    assert.equal(canonical(incremental.authoritativeProjectionCompleted), canonical(full.authoritativeProjectionCompleted), 'requeue: the completed map agrees')
    assert.equal(Object.prototype.hasOwnProperty.call(incremental.authoritativeProjectionCompleted, href), false, 'the requeued row left the completed map')
    assert.deepEqual(incremental.authoritativeProjectionQueue[href], requeued)
})

register('a completed-area record the reducer ignores fails closed on both paths', () => {
    const href = 'https://www.quora.com/profile/Ignored-Archived-Row'
    const other = 'https://www.quora.com/profile/Ignored-Queued-Row'
    const archived = {status: 'succeeded', attemptId: 'a-2', attemptNumber: 2, runId: 'run-ignored', terminalAt: 4}
    const store = makeStore({completed: {[href]: archived}})
    const base = baseOf(store)
    const seq = Number(store.meta.nextSeq)
    const queuedRow = {status: 'queued', attemptId: 'q-1', attemptNumber: 1, runId: 'run-ignored'}
    const rejected = [
        {reason: 'terminal-regression', record: {seq: seq + 1, kind: 'map.set', area: 'completed', key: href, value: {...archived, status: 'queued'}, attemptId: 'a-2', attemptNumber: 2, status: 'queued', terminal: false}},
        {reason: 'stale-attempt', record: {seq: seq + 1, kind: 'map.set', area: 'completed', key: href, value: {...archived, attemptId: 'a-1', attemptNumber: 1}, attemptId: 'a-1', attemptNumber: 1, status: 'succeeded', terminal: true}}
    ]
    for(const {reason, record} of rejected) {
        const records = [
            {seq, kind: 'map.set', area: 'queue', key: other, value: queuedRow, attemptId: 'q-1', attemptNumber: 1, status: 'queued'},
            record
        ]
        const {full, incremental, incrementalMoved} = verifyBothWays(store, records, base)
        assert.equal(incremental.incremental, true, `${reason}: incremental path used`)
        assert.deepEqual(incrementalMoved, {'queueWal.replayVerify.incremental': 1}, `${reason}: incremental path answered`)
        assert.equal(incremental.ok, false, `${reason}: the append fails`)
        assert.equal(full.ok, false, `${reason}: full recovery fails the append too`)
        assert.deepEqual(ignoredKeys(incremental).map(([, why]) => why), [reason])
        assertSameReplayResult(incremental, full, reason)
        assert.equal(canonical(incremental.authoritativeProjectionCompleted), canonical(full.authoritativeProjectionCompleted), `${reason}: the completed map agrees`)
        assert.deepEqual(incremental.authoritativeProjectionCompleted[href], archived, `${reason}: the rejected record left the archived row unchanged`)
    }
})

register('an append without a trusted base falls back to full recovery', () => {
    const {store, hrefs} = makeBaseStore(12)
    const base = baseOf(store)
    const seq = Number(store.meta.nextSeq)
    const archive = {seq, kind: 'map.set', area: 'completed', key: 'https://www.quora.com/profile/Untrusted-Row', value: {status: 'succeeded', attemptId: 'u-1', attemptNumber: 1, terminalAt: 1}, attemptId: 'u-1', attemptNumber: 1, status: 'succeeded', terminal: true}
    // The resident completed map is not loaded: no append takes the incremental path, queue-only ones included.
    const queueOnly = {seq, kind: 'map.set', area: 'queue', key: hrefs[0], value: {status: 'queued', attemptId: 'u-2', attemptNumber: 1}, attemptId: 'u-2', attemptNumber: 1, status: 'queued'}
    for(const records of [[archive], [queueOnly]]) {
        const unloaded = verifyBothWays(store, records, base, {baseCompleted: null})
        assert.equal(unloaded.incremental.incremental, undefined)
        assert.deepEqual(unloaded.incrementalMoved, {'queueWal.replayVerify.full': 1})
    }
    // The base is one seq behind the store.
    const staleBase = verifyBothWays(store, [archive], base, {baseNextSeq: seq - 1})
    assert.equal(staleBase.incremental.incremental, undefined)
    assert.deepEqual(staleBase.incrementalMoved, {'queueWal.replayVerify.full': 1})
    // A record in an area the incremental path does not own.
    const otherArea = verifyBothWays(store, [{seq, kind: 'map.set', area: 'runs', key: 'run-untrusted', value: {status: 'active'}}], base)
    assert.equal(otherArea.incremental.incremental, undefined)
})

register('incremental verification agrees with full recovery over random mixed queue and completed appends', () => {
    let accepted = 0
    let rejected = 0
    for(let seed = 1; seed <= 25; seed += 1) {
        const completedHrefs = [0, 1, 2, 3].map(index => `https://www.quora.com/profile/Mixed-${seed}-Done-${index}`)
        const completed = Object.fromEntries(completedHrefs.map((href, index) => [href, {status: 'succeeded', attemptId: `base-${index}`, attemptNumber: 1 + (index % 3), terminalAt: index + 1}]))
        const {store, hrefs} = makeBaseStore(seed, completed)
        const random = makeRandom(seed * 104729)
        const base = baseOf(store)
        const records = makeMixedAppendRecords(store, hrefs, completedHrefs, 1 + Math.floor(random() * 5), random)
        const {full, incremental} = verifyBothWays(store, records, base)
        assert.equal(incremental.incremental, true, `seed ${seed}: incremental path used`)
        assertSameReplayResult(incremental, full, `seed ${seed}`)
        if(records.some(record => record.area === 'completed')) {
            assert.equal(canonical(incremental.authoritativeProjectionCompleted), canonical(full.authoritativeProjectionCompleted), `seed ${seed}: completed map agrees`)
        }
        if(incremental.ok) accepted += 1
        else rejected += 1
    }
    assert.ok(accepted > 0 && rejected > 0, `both outcomes are exercised (accepted ${accepted}, rejected ${rejected})`)
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
