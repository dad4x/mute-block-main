'use strict'

// Q4: one-time import of the existing WAL payload into an IndexedDB store,
// verified by state hash before the migration flag is set. Failure cases
// check that the legacy copy stays authoritative. Uses fake-indexeddb, so
// timings are relative only.
//
//   node experiments/indexeddb/migrate-check.js

const path = require('node:path')
const zlib = require('node:zlib')
const wal = require(path.join(__dirname, '..', '..', 'shared', 'js', 'walSnapshotStore'))
require(path.join(__dirname, 'node', 'node_modules', 'fake-indexeddb', 'auto'))

const BASE_KEY = 'mbCoordinatorQueueWal'
const codec = {
    name: 'gzip',
    compress: bytes => zlib.gzipSync(bytes),
    decompress: bytes => zlib.gunzipSync(bytes)
}
const opts = {codec}
const ROW_COUNT = Number(process.env.MIGRATE_ROWS || 2000)
const MIGRATION_FLAG = '__migration'

function makeState(count) {
    const state = {queue: {}, completed: {}, runs: {}, progress: {}, events: [{kind: 'start'}]}
    for(let index = 0; index < count; index += 1) {
        state.queue[`https://www.quora.com/profile/P${index}`] = {
            status: index % 3 ? 'queued' : 'succeeded',
            seq: index,
            note: 'x'.repeat(512)
        }
    }
    return state
}

// Builds the store the way the live worker lays it out: a sharded checkpoint
// plus a short WAL tail, then the storage payload the worker would write.
function buildLegacyPayload(count) {
    const state = makeState(count)
    const written = wal.writeInactiveCheckpoint(wal.makePairedCheckpointStore({}, {snapshotSeq: 0, codec}), state, {
        snapshotSeq: 5, snapshotEpoch: 1, createdAt: 1, codec, codecName: codec.name, shardCount: 10
    })
    const activated = wal.activateCheckpoint(written.store, written.checkpointId, opts)
    if(!activated.activated) throw new Error(activated.reason)
    const records = [1, 2, 3].map(index => wal.makeWalRecord({
        kind: 'map.set',
        area: 'queue',
        key: `https://www.quora.com/profile/tail${index}`,
        value: {status: 'queued', seq: 100000 + index},
        seq: 6 + index,
        at: 1
    }))
    const appended = wal.appendWalRecordsToGeneration(activated.store, records)
    if(appended.rejected) throw new Error(appended.reason)
    const payload = wal.buildSegmentedWalStoragePayload(appended.store, {baseKey: BASE_KEY, writeCheckpoints: true})
    const expected = wal.recoverProjectedState(appended.store, [], opts)
    if(!expected.recovered) throw new Error(expected.reason)
    return {payload, expectedHash: wal.hashState(expected.projected.state), keys: Object.keys(payload)}
}

function openKv() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('migrate-check', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('kv', {keyPath: 'key'})
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function transact(db, mode, work) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode)
        const store = tx.objectStore('kv')
        let result
        try {
            result = work(store, tx)
        }
        catch(error) {
            tx.abort()
            reject(error)
            return
        }
        tx.oncomplete = () => resolve(result)
        tx.onabort = () => reject(tx.error || new Error('aborted'))
        tx.onerror = () => reject(tx.error)
    })
}

function readAll(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly')
        const request = tx.objectStore('kv').getAll()
        request.onsuccess = () => {
            const map = {}
            for(const record of request.result) map[record.key] = record.value
            resolve(map)
        }
        request.onerror = () => reject(request.error)
    })
}

// Import all keys in one transaction, read back, verify by hash, then flag.
async function migrate(db, legacy, options = {}) {
    const started = Date.now()
    const entries = Object.entries(legacy.payload).filter(([key]) => key !== options.dropKey)
    await transact(db, 'readwrite', (store) => {
        for(const [key, value] of entries) store.put({key, value})
        if(options.abortAfter) throw new Error('simulated failure mid-import')
    })
    const importedMs = Date.now() - started

    const copied = await readAll(db)
    const hydrated = wal.hydrateSegmentedWalStore(copied, {baseKey: BASE_KEY, fallbackStore: null})
    const recovered = hydrated.ok ? wal.recoverProjectedState(hydrated.store, [], opts) : null
    const verified = Boolean(recovered?.recovered) &&
        wal.hashState(recovered.projected.state) === legacy.expectedHash

    await transact(db, 'readwrite', (store) => {
        store.put({key: MIGRATION_FLAG, value: {status: verified ? 'verified' : 'failed', at: Date.now()}})
    })
    return {
        verified,
        reason: verified ? null : (hydrated.reason || recovered?.reason || 'hash-mismatch'),
        importedKeys: entries.length,
        importedMs,
        totalMs: Date.now() - started
    }
}

async function clearDb(db) {
    await transact(db, 'readwrite', store => store.clear())
}

async function main() {
    const legacy = buildLegacyPayload(ROW_COUNT)
    const legacyBefore = JSON.stringify(legacy.payload)
    const db = await openKv()
    const results = {rows: ROW_COUNT, legacyKeys: legacy.keys.length}

    await clearDb(db)
    results.normalImport = await migrate(db, legacy)
    results.legacyUnchangedAfterImport = JSON.stringify(legacy.payload) === legacyBefore

    await clearDb(db)
    results.dropOneShardKey = await migrate(db, legacy, {dropKey: legacy.keys.find(key => key.includes('.s0') || key.endsWith('.s01'))})

    await clearDb(db)
    results.abortMidImport = await migrate(db, legacy, {abortAfter: true}).catch(error => ({
        verified: false,
        reason: error.message
    }))
    const afterAbort = await readAll(db)
    results.abortLeftNoPartialKeys = Object.keys(afterAbort).length === 0

    db.close()
    console.log(JSON.stringify(results, null, 2))
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
