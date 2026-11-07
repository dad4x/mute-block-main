const BOOT_ID = crypto.randomUUID()
const counters = {idbSteps: 0, timerTicks: 0, idbError: null, lastStepAt: null}
const DB_NAME = 'spike'
const DB_VERSION = 1
const ROW_COUNT = 2000
const ROW_PAD = 'x'.repeat(2048)

let dbPromise = null
function openDb() {
    if(!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)
            request.onupgradeneeded = () => {
                const db = request.result
                db.createObjectStore('rows', {keyPath: 'key'})
                db.createObjectStore('meta', {keyPath: 'k'})
            }
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
    }
    return dbPromise
}

function requestDone(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

// Writes the seq marker and ROW_COUNT rows in one readwrite transaction.
// Rows are chained from onsuccess so the transaction stays open for the
// whole write, which is the window the driver kills the worker inside.
async function startAtomicWrite(seq) {
    const db = await openDb()
    const tx = db.transaction(['rows', 'meta'], 'readwrite')
    tx.objectStore('meta').put({k: 'seq', v: seq})
    let index = 0
    const putNext = () => {
        if(index >= ROW_COUNT) return
        const row = {key: `r${index}`, seq, pad: ROW_PAD}
        index += 1
        tx.objectStore('rows').put(row).onsuccess = putNext
    }
    putNext()
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve({committed: true, seq})
        tx.onabort = () => resolve({committed: false, seq, error: tx.error?.name || 'abort'})
        tx.onerror = () => reject(tx.error)
    })
}

// The message reply returns immediately. An open message port keeps a
// Manifest V3 worker alive, so holding it would confound the keepalive test.
// The loop runs in the background and writes a done marker at the end; the
// driver checks for that marker and for whether the worker was killed first.
function idbKeepalive(seconds) {
    const started = Date.now()
    openDb().catch((error) => {
        counters.idbError = String(error)
    }).then((db) => {
        if(!db) return
        let puts = 0
        const finish = () => {
            const tx = db.transaction('meta', 'readwrite')
            tx.objectStore('meta').put({k: 'done-idb', v: {puts, elapsedMs: Date.now() - started, bootId: BOOT_ID}})
        }
        const step = () => {
            if((Date.now() - started) / 1000 >= seconds) {
                finish()
                return
            }
            const tx = db.transaction('meta', 'readwrite')
            tx.objectStore('meta').put({k: 'hb-idb', v: Date.now()})
            puts += 1
            counters.idbSteps += 1
            counters.lastStepAt = Date.now()
            tx.oncomplete = step
            tx.onabort = step
        }
        step()
    })
    return {started: true, bootId: BOOT_ID}
}

// Control: a plain timer chain with no extension API or IndexedDB calls.
// The done marker still goes through IndexedDB, so a surviving loop can report.
function timerKeepalive(seconds) {
    const started = Date.now()
    let ticks = 0
    const step = () => {
        if((Date.now() - started) / 1000 >= seconds) {
            openDb().then((db) => {
                const tx = db.transaction('meta', 'readwrite')
                tx.objectStore('meta').put({k: 'done-timer', v: {ticks, elapsedMs: Date.now() - started, bootId: BOOT_ID}})
            })
            return
        }
        ticks += 1
        counters.timerTicks += 1
        setTimeout(step, 1000)
    }
    step()
    return {started: true, bootId: BOOT_ID}
}

async function bench(iterations = 30) {
    const db = await openDb()
    const blob = 'a'.repeat(1024 * 1024)
    const small = {k: 'bench', v: 'b'.repeat(100 * 1024)}
    await chrome.storage.local.set({benchBlob: blob, benchSmall: small.v})

    async function time(label, fn) {
        const samples = []
        for(let i = 0; i < iterations; i += 1) {
            const start = performance.now()
            await fn()
            samples.push(performance.now() - start)
        }
        samples.sort((left, right) => left - right)
        return {label, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)]}
    }

    const results = []
    results.push(await time('storage.local.get 1MB string', () => chrome.storage.local.get('benchBlob')))
    results.push(await time('storage.local.get 100KB string', () => chrome.storage.local.get('benchSmall')))
    results.push(await time('storage.local.set 100KB string', () => chrome.storage.local.set({benchSmall: small.v})))
    results.push(await time('IDB get one 2KB row', () => requestDone(db.transaction('rows').objectStore('rows').get('r7'))))
    results.push(await time('IDB getAll 2000 rows (4MB)', () => requestDone(db.transaction('rows').objectStore('rows').getAll())))
    results.push(await time('IDB put one row, own tx', () => new Promise((resolve) => {
        const tx = db.transaction('rows', 'readwrite')
        tx.objectStore('rows').put({key: 'bench', seq: 1, pad: ROW_PAD})
        tx.oncomplete = resolve
    })))
    results.push(await time('IDB two-store tx, 2 puts', () => new Promise((resolve) => {
        const tx = db.transaction(['rows', 'meta'], 'readwrite')
        tx.objectStore('rows').put({key: 'bench', seq: 1, pad: ROW_PAD})
        tx.objectStore('meta').put({k: 'bench', v: 1})
        tx.oncomplete = resolve
    })))
    await chrome.storage.local.remove(['benchBlob', 'benchSmall'])
    return {bootId: BOOT_ID, results}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handlers = {
        ping: async () => ({bootId: BOOT_ID, counters: {...counters, now: Date.now()}}),
        startAtomicWrite: () => startAtomicWrite(message.seq),
        idbKeepalive: () => idbKeepalive(message.seconds),
        timerKeepalive: () => timerKeepalive(message.seconds),
        bench: () => bench(message.iterations)
    }
    const handler = handlers[message.type]
    if(!handler) return false
    Promise.resolve().then(handler).then(
        result => sendResponse({ok: true, result}),
        error => sendResponse({ok: false, error: error?.message || String(error)})
    )
    return true
})

chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'})
