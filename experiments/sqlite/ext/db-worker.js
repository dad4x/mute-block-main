import sqlite3InitModule from './vendor/index.mjs'

const ROW_PAD = 'x'.repeat(2048)
const SCHEMA = [
    'CREATE TABLE IF NOT EXISTS rows(key TEXT PRIMARY KEY, seq INTEGER NOT NULL, pad TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v INTEGER NOT NULL)'
]

let sqlite3 = null
let db = null

function now() {
    return performance.now()
}

function summarize(samples) {
    const sorted = [...samples].sort((left, right) => left - right)
    return {
        medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
        p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(3))
    }
}

async function open({vfs, filename}) {
    if(db) {
        db.close()
        db = null
    }
    sqlite3 = sqlite3 || await sqlite3InitModule({print: () => {}, printErr: () => {}})
    const info = {
        libVersion: sqlite3.version.libVersion,
        hasOpfsVfs: Boolean(sqlite3.capi.sqlite3_vfs_find('opfs')),
        hasSahpoolVfs: typeof sqlite3.installOpfsSAHPoolVfs === 'function'
    }
    if(vfs === 'opfs-sahpool') {
        await sqlite3.installOpfsSAHPoolVfs({name: 'opfs-sahpool'})
        db = new sqlite3.oo1.DB(filename, 'c', 'opfs-sahpool')
    }
    else if(vfs === 'opfs') {
        db = new sqlite3.oo1.OpfsDb(filename)
    }
    else {
        throw new Error(`unknown vfs ${vfs}`)
    }
    for(const statement of SCHEMA) db.exec(statement)
    return {...info, vfs, filename: db.filename, journalMode: db.selectValue('PRAGMA journal_mode')}
}

// Yields every chunk so the host can see progress and terminate the worker
// while the transaction is still open.
const YIELD_EVERY = 100
async function bulkWrite({id, seq, rowCount}) {
    db.exec('BEGIN IMMEDIATE')
    const insert = db.prepare('INSERT OR REPLACE INTO rows(key, seq, pad) VALUES (?, ?, ?)')
    for(let index = 0; index < rowCount; index += 1) {
        insert.bind([`r${index}`, seq, ROW_PAD]).stepReset()
        if((index + 1) % YIELD_EVERY === 0) {
            self.postMessage({id, progress: index + 1})
            await new Promise(resolve => setTimeout(resolve, 0))
        }
    }
    insert.finalize()
    db.exec({sql: 'INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)', bind: ['seq', seq]})
    db.exec('COMMIT')
    return {committed: true, seq}
}

function readState() {
    const marker = db.selectValue("SELECT v FROM meta WHERE k = 'seq'")
    const rowCount = db.selectValue('SELECT COUNT(*) FROM rows')
    const seqs = db.selectValues('SELECT DISTINCT seq FROM rows')
    return {markerSeq: marker ?? null, rowCount, distinctRowSeqs: seqs}
}

function bench({rowCount, iterations}) {
    const keys = Array.from({length: iterations}, (_, index) => `r${(index * 7919) % rowCount}`)
    const keyed = []
    const keyedStatement = db.prepare('SELECT seq, pad FROM rows WHERE key = ?')
    for(const key of keys) {
        const started = now()
        keyedStatement.bind([key]).step()
        keyedStatement.reset()
        keyed.push(now() - started)
    }
    keyedStatement.finalize()

    const scan = []
    for(let index = 0; index < 10; index += 1) {
        const started = now()
        db.selectArrays('SELECT key, seq, pad FROM rows')
        scan.push(now() - started)
    }

    const singleCommit = []
    for(let index = 0; index < iterations; index += 1) {
        const started = now()
        db.exec({sql: 'INSERT OR REPLACE INTO rows(key, seq, pad) VALUES (?, ?, ?)', bind: ['bench', index, ROW_PAD]})
        singleCommit.push(now() - started)
    }

    return {
        keyedRead2KbRow: summarize(keyed),
        fullScanRows: summarize(scan),
        singleRowAutocommitWrite: summarize(singleCommit)
    }
}

function globals() {
    return {
        hasChrome: typeof chrome,
        hasChromeStorage: typeof chrome !== 'undefined' && typeof chrome.storage,
        hasChromeRuntime: typeof chrome !== 'undefined' && typeof chrome.runtime,
        hasBroadcastChannel: typeof BroadcastChannel,
        hasWebLocks: typeof navigator.locks,
        hasSharedWorker: typeof SharedWorker,
        origin: self.location.origin
    }
}

const handlers = {open, bulkWrite, readState, bench, globals}

self.onmessage = async (event) => {
    const {id, op, ...payload} = event.data
    try {
        const result = await handlers[op]({...payload, id})
        self.postMessage({id, ok: true, result})
    }
    catch(error) {
        self.postMessage({id, ok: false, error: error?.message || String(error)})
    }
}
