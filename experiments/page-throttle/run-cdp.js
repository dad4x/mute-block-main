'use strict'

// Foreground vs background throttling for an extension page and a dedicated
// worker it starts. Opens two extension pages in one window, brings each to the
// front in turn, and measures tick rates over a fixed window. Never touches the
// user's Chrome or extension.
//
//   node experiments/page-throttle/run-cdp.js [seconds-per-phase]

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9336)
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const PROFILE_DIR = path.join(ROOT, '.profile')
const PHASE_SECONDS = Number(process.argv[2] || 15)

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

async function openPage(browser, extensionId) {
    const {targetId} = await browser.send('Target.createTarget', {url: `chrome-extension://${extensionId}/page.html`})
    const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true})
    const deadline = Date.now() + 15000
    while(Date.now() < deadline) {
        const ready = await evaluate(browser, sessionId, 'typeof window.spike').catch(() => null)
        if(ready === 'object') return {targetId, sessionId}
        await sleep(250)
    }
    throw new Error('probe page never loaded')
}

async function sample(browser, page) {
    return evaluate(browser, page.sessionId, 'window.spike.stats()')
}

function rates(start, end) {
    const seconds = (end.pageElapsedMs - start.pageElapsedMs) / 1000
    const workerSeconds = (end.workerElapsedMs - start.workerElapsedMs) / 1000
    return {
        windowSeconds: Number(seconds.toFixed(1)),
        visibilityAtEnd: end.visibility,
        pageTicksPerSecond: Number(((end.pageTicks - start.pageTicks) / seconds).toFixed(2)),
        workerTicksPerSecond: Number(((end.workerTicks - start.workerTicks) / workerSeconds).toFixed(2))
    }
}

async function measure(browser, page, seconds) {
    const start = await sample(browser, page)
    await sleep(seconds * 1000)
    const end = await sample(browser, page)
    return rates(start, end)
}

async function main() {
    fs.rmSync(PROFILE_DIR, {recursive: true, force: true})
    fs.mkdirSync(PROFILE_DIR, {recursive: true})
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
    const browser = new Cdp((await waitForDebugger()).webSocketDebuggerUrl)
    try {
        const loaded = await browser.send('Extensions.loadUnpacked', {path: EXT_DIR})
        const first = await openPage(browser, loaded.id)
        const second = await openPage(browser, loaded.id)
        const results = {phaseSeconds: PHASE_SECONDS}

        await browser.send('Target.activateTarget', {targetId: first.targetId})
        await sleep(1000)
        results.firstForeground = await measure(browser, first, PHASE_SECONDS)
        results.secondBackground = await measure(browser, second, PHASE_SECONDS)

        await browser.send('Target.activateTarget', {targetId: second.targetId})
        await sleep(1000)
        results.secondForeground = await measure(browser, second, PHASE_SECONDS)
        results.firstBackground = await measure(browser, first, PHASE_SECONDS)

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
