'use strict'

// Offline sizing of the existing storage.local + WAL backend at a 1,000-row
// queue, using the repo's walSnapshotStore directly. Measures:
//   - physical bytes of a full sharded checkpoint (the startup read and the switch write)
//   - physical bytes written per mutation (one WAL segment plus the manifest)
//   - the CPU cost of hydrate + replay at startup, with a realistic WAL tail
// These are the costs a Worker would pay (pure JS, no chrome.* calls). The
// chrome.storage transfer cost is measured separately, on the page.
//
//   node experiments/existing-wal/sizing.js [queueRows] [tailSegments]

const path = require('node:path')
const zlib = require('node:zlib')
const wal = require(path.join(__dirname, '..', '..', 'shared', 'js', 'walSnapshotStore'))

const BASE_KEY = 'mbCoordinatorQueueWal'
const QUEUE_ROWS = Number(process.argv[2] || 1000)
const TAIL_SEGMENTS = Number(process.argv[3] || 128)
const codec = {
    name: 'gzip',
    compress: bytes => zlib.gzipSync(bytes),
    decompress: bytes => zlib.gunzipSync(bytes)
}
const opts = {codec}
// Repetitive text compresses far better than real rows, so the default run
// under-sizes the checkpoint. RANDOM_NOTES=1 uses incompressible text to bracket it.
const RANDOM_NOTES = process.env.RANDOM_NOTES === '1'
const NOTE_TEXT = index => RANDOM_NOTES
    ? require('node:crypto').randomBytes(400).toString('hex')
    : 'lorem ipsum dolor sit amet '.repeat(6)

function makeRow(index) {
    return {
        href: `https://www.quora.com/profile/Person-${index}-${'x'.repeat(10)}`,
        status: index % 4 === 0 ? 'queued' : index % 4 === 1 ? 'running' : 'succeeded',
        runId: `run-${Math.floor(index / 50)}`,
        attemptId: `attempt-${index}`,
        attemptNumber: 1 + (index % 3),
        queueSequence: index,
        actionKind: 'block',
        targetProfileHref: `https://www.quora.com/profile/Target-${index}`,
        updatedAt: 1791777600000 + index,
        note: NOTE_TEXT(index)
    }
}

function makeState(rows) {
    const state = {queue: {}, completed: {}, runs: {}, progress: {}, events: []}
    for(let index = 0; index < rows; index += 1) {
        const row = makeRow(index)
        state.queue[row.href] = row
        if(index % 2) state.completed[`done-${index}`] = {status: 'succeeded', terminalAt: index}
        state.progress[row.href] = {lastStage: 'open', attempts: index % 3, at: index}
    }
    for(let index = 0; index < 50; index += 1) state.runs[`run-${index}`] = {status: 'running', rows: 20}
    return state
}

function bytesOf(value) {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function sumBytes(payload, keys) {
    return keys.reduce((total, key) => total + bytesOf(payload[key]), 0)
}

function timed(fn) {
    const started = process.hrtime.bigint()
    const result = fn()
    return {result, ms: Number(process.hrtime.bigint() - started) / 1e6}
}

function buildStore(rows) {
    const state = makeState(rows)
    const written = wal.writeInactiveCheckpoint(wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec}), state, {
        snapshotSeq: 5, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name, shardCount: 10
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, opts)
    if(!activated.activated) throw new Error(activated.reason)
    return {store: activated.store, state}
}

function mutationRecord(seq) {
    return wal.makeWalRecord({
        kind: 'map.set',
        area: 'queue',
        key: `https://www.quora.com/profile/Mutated-${seq}`,
        value: makeRow(seq),
        seq,
        at: 1791777600000 + seq
    })
}

function main() {
    const built = timed(() => buildStore(QUEUE_ROWS))
    const {store} = built.result

    const checkpointPayload = wal.buildSegmentedWalStoragePayload(store, {baseKey: BASE_KEY, writeCheckpoints: true})
    const checkpointKeys = Object.keys(checkpointPayload)
    const checkpointBytes = sumBytes(checkpointPayload, checkpointKeys)

    const mutationSizes = []
    let current = store
    for(let seq = 1; seq <= 20; seq += 1) {
        const before = wal.getSegmentedWalCommittedSegmentCount(current.meta, current.meta.activeCheckpoint)
        const step = timed(() => {
            const appended = wal.appendWalRecordsToGeneration(current, [mutationRecord(seq)], {segmentId: `seg-${seq}`})
            if(appended.rejected) throw new Error(appended.reason)
            const activeGeneration = appended.store.meta.activeCheckpoint
            const payload = wal.buildSegmentedWalStoragePayload(appended.store, {
                baseKey: BASE_KEY,
                segmentStartByGeneration: {[activeGeneration]: before},
                generationsToWrite: [activeGeneration],
                writeCheckpoints: false
            })
            return {appended, payload}
        })
        const {appended, payload} = step.result
        mutationSizes.push({keys: Object.keys(payload), bytes: sumBytes(payload, Object.keys(payload)), cpuMs: step.ms})
        current = appended.store
    }
    const perMutationBytes = Math.round(mutationSizes.reduce((total, entry) => total + entry.bytes, 0) / mutationSizes.length)
    const perMutationKeys = mutationSizes[0].keys.length
    const perMutationCpuMs = mutationSizes.reduce((total, entry) => total + entry.cpuMs, 0) / mutationSizes.length

    const tailStore = buildStoreWithTail(store, TAIL_SEGMENTS)
    const startupPayload = wal.buildSegmentedWalStoragePayload(tailStore, {baseKey: BASE_KEY, writeCheckpoints: true})
    const startupBytes = sumBytes(startupPayload, Object.keys(startupPayload))
    const hydrate = timed(() => wal.hydrateSegmentedWalStore(startupPayload, {baseKey: BASE_KEY, fallbackStore: null}))
    if(!hydrate.result.ok) throw new Error(hydrate.result.reason)
    const recover = timed(() => wal.recoverProjectedState(hydrate.result.store, [], opts))
    if(!recover.result.recovered) throw new Error(recover.result.reason)

    console.log(JSON.stringify({
        queueRows: QUEUE_ROWS,
        tailSegments: TAIL_SEGMENTS,
        buildStoreMs: Number(built.ms.toFixed(1)),
        checkpoint: {
            keys: checkpointKeys.length,
            totalBytes: checkpointBytes,
            kiB: Number((checkpointBytes / 1024).toFixed(1))
        },
        perMutation: {
            averageBytes: perMutationBytes,
            keysWritten: perMutationKeys,
            averageCpuMs: Number(perMutationCpuMs.toFixed(3)),
            samples: mutationSizes.length
        },
        startup: {
            keys: Object.keys(startupPayload).length,
            totalBytes: startupBytes,
            kiB: Number((startupBytes / 1024).toFixed(1)),
            hydrateMs: Number(hydrate.ms.toFixed(2)),
            recoverAndReplayMs: Number(recover.ms.toFixed(2)),
            tailRecords: TAIL_SEGMENTS
        }
    }, null, 2))
}

function buildStoreWithTail(store, segments) {
    let current = store
    for(let seq = 1; seq <= segments; seq += 1) {
        const appended = wal.appendWalRecordsToGeneration(current, [mutationRecord(seq)], {segmentId: `tail-${seq}`})
        if(appended.rejected) throw new Error(appended.reason)
        current = appended.store
    }
    return current
}

main()
