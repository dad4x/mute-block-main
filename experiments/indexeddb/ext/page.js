const DB_NAME = 'spike'

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => {
            const db = request.result
            db.createObjectStore('rows', {keyPath: 'key'})
            db.createObjectStore('meta', {keyPath: 'k'})
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

function requestDone(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

// Atomicity check: after any worker kill, every row must share the seq the
// meta marker records, and the row count must be the full set or zero.
async function readAtomicState(expectedRows) {
    const db = await openDb()
    const tx = db.transaction(['rows', 'meta'], 'readonly')
    const meta = await requestDone(tx.objectStore('meta').get('seq'))
    const rows = await requestDone(tx.objectStore('rows').getAll())
    db.close()
    const seqs = new Set(rows.map(row => row.seq))
    const markerSeq = meta ? meta.v : null
    const consistent = rows.length === 0
        ? true
        : seqs.size === 1 && seqs.has(markerSeq)
    return {
        markerSeq,
        rowCount: rows.length,
        distinctRowSeqs: Array.from(seqs),
        consistent,
        fullOrEmpty: rows.length === 0 || rows.length === expectedRows
    }
}

// Sends a message to the service worker, which wakes it if it is stopped.
function send(message) {
    return new Promise((resolve) => {
        const started = performance.now()
        chrome.runtime.sendMessage(message, (response) => {
            resolve({
                response,
                roundTripMs: performance.now() - started,
                lastError: chrome.runtime.lastError?.message || null
            })
        })
    })
}

async function readMeta(key) {
    const db = await openDb()
    const record = await requestDone(db.transaction('meta').objectStore('meta').get(key))
    db.close()
    return record ? record.v : null
}

async function timeRuns(iterations, fn) {
    const samples = []
    for(let index = 0; index < iterations; index += 1) {
        const started = performance.now()
        await fn()
        samples.push(performance.now() - started)
    }
    samples.sort((left, right) => left - right)
    return {
        medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(2)),
        p95Ms: Number(samples[Math.floor(samples.length * 0.95)].toFixed(2))
    }
}

// Extension-page readers (the dashboard path) against the same data sizes the
// worker benchmark uses.
async function benchPage(iterations = 30) {
    const db = await openDb()
    const blob = 'a'.repeat(1024 * 1024)
    await chrome.storage.session.set({benchBlob: blob})
    await chrome.storage.local.set({benchBlob: blob})
    const results = {}
    results['storage.session.get 1MB string'] = await timeRuns(iterations, () => chrome.storage.session.get('benchBlob'))
    results['storage.local.get 1MB string'] = await timeRuns(iterations, () => chrome.storage.local.get('benchBlob'))
    results['IDB getAll 2000 rows (4MB)'] = await timeRuns(iterations, () => requestDone(db.transaction('rows').objectStore('rows').getAll()))
    results['IDB get one 2KB row'] = await timeRuns(iterations, () => requestDone(db.transaction('rows').objectStore('rows').get('r7')))
    await chrome.storage.session.remove('benchBlob')
    await chrome.storage.local.remove('benchBlob')
    db.close()
    return results
}

window.spike = {
    readAtomicState,
    readMeta,
    benchPage,
    send,
    openDb,
    dbNames: () => indexedDB.databases().then(list => list.map(entry => entry.name))
}
