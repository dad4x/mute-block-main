'use strict'

// SQLite spike driver. Launches an isolated Chrome with its own profile, loads
// the probe in ext/ with Extensions.loadUnpacked, and runs one experiment per
// subcommand over raw CDP. Never touches the user's own Chrome or extension.
//
//   node experiments/sqlite/run-cdp.js caps
//   node experiments/sqlite/run-cdp.js bench
//   node experiments/sqlite/run-cdp.js kill [trials]
//   node experiments/sqlite/run-cdp.js sw-kill

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9334)
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const PROFILE_DIR = path.join(ROOT, '.profile')
const VENDOR_SRC = path.join(ROOT, 'node', 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist')
const VENDOR_DST = path.join(EXT_DIR, 'vendor')
const DB_FILE = '/spike-sahpool.sqlite3'
const ROW_COUNT = 2000
const CHUNK_ROWS = 100

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function copyVendor() {
    fs.rmSync(VENDOR_DST, {recursive: true, force: true})
    fs.mkdirSync(VENDOR_DST, {recursive: true})
    for(const name of fs.readdirSync(VENDOR_SRC)) {
        fs.copyFileSync(path.join(VENDOR_SRC, name), path.join(VENDOR_DST, name))
    }
}

async function waitForDebugger() {
    const deadline = Date.now() + 30000
    while(Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
            return await response.json()
        }
        catch {
            await sleep(250)
        }
    }
    throw new Error('Chrome debug endpoint did not come up')
}

class Cdp {
    constructor(url) {
        this.nextId = 0
        this.pending = new Map()
        this.listeners = []
        this.socket = new WebSocket(url)
        this.opened = new Promise((resolve, reject) => {
            this.socket.onopen = resolve
            this.socket.onerror = reject
        })
        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data)
            if(message.id) {
                const waiter = this.pending.get(message.id)
                this.pending.delete(message.id)
                if(message.error) waiter.reject(new Error(message.error.message))
                else waiter.resolve(message.result)
                return
            }
            for(const listener of this.listeners) listener(message)
        }
    }

    async send(method, params = {}, sessionId = undefined) {
        await this.opened
        const id = ++this.nextId
        const payload = {id, method, params}
        if(sessionId) payload.sessionId = sessionId
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject})
            this.socket.send(JSON.stringify(payload))
        })
    }
}

async function evaluate(cdp, sessionId, expression) {
    const result = await cdp.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId)
    if(result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
    return result.result.value
}

async function setup() {
    fs.rmSync(PROFILE_DIR, {recursive: true, force: true})
    fs.mkdirSync(PROFILE_DIR, {recursive: true})
    copyVendor()
    const child = spawn(CHROME_BIN, [
        `--user-data-dir=${PROFILE_DIR}`,
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--enable-unsafe-extension-debugging',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
    ], {detached: true, stdio: 'ignore'})
    child.unref()
    const version = await waitForDebugger()
    const browser = new Cdp(version.webSocketDebuggerUrl)
    const loaded = await browser.send('Extensions.loadUnpacked', {path: EXT_DIR})
    const extensionId = loaded.id
    const {targetId} = await browser.send('Target.createTarget', {url: `chrome-extension://${extensionId}/page.html`})
    const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true})
    await browser.send('ServiceWorker.enable', {}, sessionId).catch(() => {})
    const deadline = Date.now() + 15000
    while(Date.now() < deadline) {
        if(await evaluate(browser, sessionId, 'typeof window.spike').catch(() => null) === 'object') break
        await sleep(250)
    }
    return {browser, child, extensionId, pageSession: sessionId}
}

async function teardown(env) {
    try {
        await env.browser.send('Browser.close')
    }
    catch {}
}

function page(env, expression) {
    return evaluate(env.browser, env.pageSession, expression)
}

// The service worker and offscreen document each wrap replies once, and worker
// replies carry {id, ok, result}. Drill through the wrappers to the payload.
function unwrap(value) {
    let current = value
    while(current && typeof current === 'object' && !('id' in current) && 'result' in current) {
        current = current.result
    }
    return current
}

async function callOffscreen(env, kind, op, payload) {
    const args = JSON.stringify({kind, op, payload})
    const reply = await page(env, `window.spike.send({type: 'to-offscreen', payload: ${args}})`)
    if(!reply.response?.ok) throw new Error(`offscreen ${kind} failed: ${JSON.stringify(reply)}`)
    return unwrap(reply.response.result)
}

function workerCall(env, op, payload = {}) {
    return callOffscreen(env, 'worker-call', op, payload)
}

async function openDb(env, vfs = 'opfs-sahpool') {
    const result = await workerCall(env, 'open', {vfs, filename: vfs === 'opfs' ? '/spike-opfs.sqlite3' : DB_FILE})
    if(!result.ok) return {ok: false, error: result.error}
    return {ok: true, ...result.result}
}

// Retries the open with a fresh worker each attempt, and records how long the
// OPFS access handles stayed unavailable after a forced termination.
async function openWithRetry(env, maxMs = 8000) {
    const started = Date.now()
    let attempts = 0
    let lastError = null
    while(Date.now() - started < maxMs) {
        attempts += 1
        const opened = await openDb(env)
        if(opened.ok) return {ok: true, attempts, elapsedMs: Date.now() - started}
        lastError = opened.error
        await callOffscreen(env, 'terminate-worker', 'none', {})
        await sleep(200)
    }
    return {ok: false, attempts, elapsedMs: Date.now() - started, error: lastError}
}

async function caps(env) {
    const sw = await page(env, `window.spike.swCapabilities()`)
    const offscreen = await callOffscreen(env, 'offscreen-capabilities', 'none', {})
    const sahpool = await openDb(env, 'opfs-sahpool')
    const opfs = await openDb(env, 'opfs')
    return {serviceWorker: sw.response?.result ?? sw, offscreen, sahpoolOpen: sahpool, opfsVfsOpen: opfs}
}

async function bench(env) {
    const opened = await openDb(env, 'opfs-sahpool')
    if(!opened.ok) throw new Error(`open failed: ${opened.error}`)
    const seeded = await workerCall(env, 'bulkWrite', {seq: 1, rowCount: ROW_COUNT})
    if(!seeded.ok) throw new Error(`seed failed: ${seeded.error}`)
    const timings = await workerCall(env, 'bench', {rowCount: ROW_COUNT, iterations: 300})
    const state = await workerCall(env, 'readState', {})
    return {open: opened, seeded: seeded.result, bench: timings.result, state: state.result}
}

// Kills the worker inside the open transaction, at a chosen chunk boundary
// (the worker reports progress and yields between chunks). Then reopens with
// retry and checks the database.
async function kill(env, trials) {
    await openWithRetry(env)
    await workerCall(env, 'bulkWrite', {seq: 1, rowCount: ROW_COUNT})
    const outcomes = []
    const chunks = ROW_COUNT / CHUNK_ROWS
    for(let trial = 1; trial <= trials; trial += 1) {
        const seq = 100 + trial
        const killAt = CHUNK_ROWS * (1 + Math.floor(Math.random() * (chunks - 2)))
        const write = await workerCall(env, 'bulkWrite', {seq, rowCount: ROW_COUNT, killAt})
        const terminated = write.ok === false && write.error === 'worker terminated'
        const reopen = await openWithRetry(env)
        const stateReply = reopen.ok ? await workerCall(env, 'readState', {}) : null
        const state = stateReply?.ok ? stateReply.result : null
        const consistent = state && Array.isArray(state.distinctRowSeqs)
            ? state.distinctRowSeqs.length <= 1 && (state.rowCount === 0 || state.distinctRowSeqs[0] === state.markerSeq)
            : null
        outcomes.push({
            trial,
            killAtRows: killAt,
            terminatedMidWrite: terminated,
            writeError: write.error || null,
            reopenOk: reopen.ok,
            reopenAttempts: reopen.attempts,
            reopenElapsedMs: reopen.elapsedMs,
            reopenError: reopen.error || null,
            markerSeq: state?.markerSeq ?? null,
            rowCount: state?.rowCount ?? null,
            distinctRowSeqs: state?.distinctRowSeqs ?? null,
            consistent,
            committedThisSeq: state ? state.markerSeq === seq : null
        })
    }
    return {rowCount: ROW_COUNT, outcomes}
}

// Kills the worker while it is still opening the database, which is where the
// earlier OPFS access-handle failures came from. Measures how long a retry
// takes to get the handles back.
async function killOpen(env, trials) {
    await openWithRetry(env)
    const outcomes = []
    for(let trial = 1; trial <= trials; trial += 1) {
        const delayMs = Math.floor(Math.random() * 15)
        const pendingOpen = workerCall(env, 'open', {vfs: 'opfs-sahpool', filename: DB_FILE}).catch(error => ({ok: false, error: error.message}))
        await sleep(delayMs)
        await callOffscreen(env, 'terminate-worker', 'none', {})
        await pendingOpen
        const reopen = await openWithRetry(env)
        outcomes.push({trial, delayMs, reopenOk: reopen.ok, reopenAttempts: reopen.attempts, reopenElapsedMs: reopen.elapsedMs, reopenError: reopen.error || null})
    }
    return {outcomes}
}

// Does the offscreen host (and its worker-held database) survive the service
// worker being stopped? The database handle lives in the offscreen document,
// not the service worker.
async function swKill(env) {
    await openWithRetry(env)
    await workerCall(env, 'bulkWrite', {seq: 7, rowCount: ROW_COUNT})
    const offscreenBefore = await listOffscreenTargets(env)
    await env.browser.send('ServiceWorker.stopAllWorkers', {}, env.pageSession)
    await sleep(1500)
    const offscreenAfter = await listOffscreenTargets(env)
    const state = await workerCall(env, 'readState', {})
    return {
        offscreenTargetsBefore: offscreenBefore.length,
        offscreenTargetsAfterSwStopped: offscreenAfter.length,
        stateReadWithoutReopen: state.ok ? state.result : {error: state.error}
    }
}

async function listOffscreenTargets(env) {
    const {targetInfos} = await env.browser.send('Target.getTargets')
    return targetInfos.filter(info => info.url.includes('offscreen.html'))
}

async function main() {
    const command = process.argv[2] || 'caps'
    const env = await setup()
    try {
        const runners = {
            caps: () => caps(env),
            bench: () => bench(env),
            kill: () => kill(env, Number(process.argv[3] || 20)),
            'kill-open': () => killOpen(env, Number(process.argv[3] || 10)),
            'sw-kill': () => swKill(env),
            'offscreen-globals': () => callOffscreen(env, 'offscreen-globals', 'none', {}),
            globals: () => workerCall(env, 'globals', {}).then(r => r.result)
        }
        const runner = runners[command]
        if(!runner) throw new Error(`unknown experiment: ${command}`)
        console.log(JSON.stringify(await runner(), null, 2))
    }
    finally {
        await teardown(env)
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
