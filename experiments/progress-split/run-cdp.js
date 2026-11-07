'use strict'

// Progress-split experiment (Chrome). The 'progress' extension page owns
// chrome.storage calls and a dedicated Worker; the service worker relays a chain
// SW -> page -> Worker -> page -> SW. Measures, in the foreground and when the
// page is hidden:
//   - chrome.storage latency from the page
//   - the relay round trip at several payload sizes
//   - whether busy CPU on the Worker delays storage callbacks, compared with busy
//     CPU on the page's main thread
// Never touches the user's Chrome or extension.
//
//   node experiments/progress-split/run-cdp.js [samples]

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9346)
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const PROFILE_DIR = path.join(ROOT, `.profile-${Date.now()}`)
const SAMPLES = Number(process.argv[2] || 200)
const CHAIN_SAMPLES = 30
const CHAIN_SIZES = [0, 5 * 1024, 100 * 1024, 1024 * 1024]
const LOAD_SAMPLES = 30
const LOAD_BUSY_MS = 200

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
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
        this.socket = new WebSocket(url)
        this.opened = new Promise((resolve, reject) => {
            this.socket.onopen = resolve
            this.socket.onerror = reject
        })
        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data)
            const waiter = this.pending.get(message.id)
            if(!waiter) return
            this.pending.delete(message.id)
            if(message.error) waiter.reject(new Error(message.error.message))
            else waiter.resolve(message.result)
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

async function openTarget(browser, url) {
    const {targetId} = await browser.send('Target.createTarget', {url})
    const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true})
    return {targetId, sessionId}
}

async function waitForProbe(browser, page) {
    const deadline = Date.now() + 15000
    while(Date.now() < deadline) {
        const ready = await evaluate(browser, page.sessionId, 'typeof window.spike').catch(() => null)
        if(ready === 'object') return
        await sleep(250)
    }
    throw new Error('progress page never loaded')
}

async function phase(browser, page, label) {
    const run = expression => evaluate(browser, page.sessionId, expression)
    const visibility = await run('window.spike.visibility()')
    const storage = await run(`window.spike.storageSamples(${SAMPLES})`)
    const chain = await run(`window.spike.chainSamples(${CHAIN_SAMPLES}, ${JSON.stringify(CHAIN_SIZES)})`)
    const loadWorker = await run(`window.spike.loadProbe('worker', ${LOAD_SAMPLES}, ${LOAD_BUSY_MS})`)
    const loadMain = await run(`window.spike.loadProbe('main', ${LOAD_SAMPLES}, ${LOAD_BUSY_MS})`)
    return {label, visibility, storage, chain, storageWhileWorkerBusy: loadWorker, storageWhileMainThreadBusy: loadMain}
}

async function main() {
    fs.mkdirSync(PROFILE_DIR, {recursive: true})
    spawn(CHROME_BIN, [
        `--user-data-dir=${PROFILE_DIR}`,
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--enable-unsafe-extension-debugging',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
    ], {detached: true, stdio: 'ignore'}).unref()
    const browser = new Cdp((await waitForDebugger()).webSocketDebuggerUrl)
    const results = {samples: SAMPLES, chainSamples: CHAIN_SAMPLES, chainSizes: CHAIN_SIZES, loadBusyMs: LOAD_BUSY_MS}
    try {
        const loaded = await browser.send('Extensions.loadUnpacked', {path: EXT_DIR})
        const progress = await openTarget(browser, `chrome-extension://${loaded.id}/page.html`)
        await waitForProbe(browser, progress)
        const decoy = await openTarget(browser, 'about:blank')
        await sleep(1000)
        await evaluate(browser, progress.sessionId, 'window.spike.seed()')

        await browser.send('Target.activateTarget', {targetId: progress.targetId})
        await sleep(1000)
        results.foreground = await phase(browser, progress, 'foreground')

        await browser.send('Target.activateTarget', {targetId: decoy.targetId})
        await sleep(1000)
        results.background = await phase(browser, progress, 'background')

        console.log(JSON.stringify(results, null, 2))
    }
    finally {
        try {
            await browser.send('Browser.close')
        }
        catch {}
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
