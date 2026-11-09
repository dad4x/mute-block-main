'use strict'

// Mirror broadcast experiment. One owner page publishes mirror updates on a
// BroadcastChannel and in storage.session. Viewers, the service worker and a
// content script listen. Four phases: steady delivery, a late-joining viewer,
// the service worker stopped mid-stream, and an owner handover. Never touches
// the user's Chrome or extension.
//
//   node experiments/mirror-broadcast/run-cdp.js

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9338)
const SITE_PORT = 8767
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const SITE_DIR = path.join(ROOT, 'site')
const PROFILE_DIR = path.join(ROOT, `.profile-${Date.now()}`)
const BURST = {count: 300, intervalMs: 10}

function log(message) {
    console.error(`[${new Date().toISOString()}] ${message}`)
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function serveSite() {
    return new Promise((resolve) => {
        const server = http.createServer((request, response) => {
            fs.readFile(path.join(SITE_DIR, 'index.html'), (error, data) => {
                if(error) {
                    response.writeHead(404)
                    response.end()
                    return
                }
                response.writeHead(200, {'content-type': 'text/html'})
                response.end(data)
            })
        })
        server.listen(SITE_PORT, '127.0.0.1', () => resolve(server))
    })
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

async function openPage(browser, extensionId, role) {
    const url = `chrome-extension://${extensionId}/page.html?role=${role}`
    const {targetId} = await browser.send('Target.createTarget', {url})
    const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true})
    const deadline = Date.now() + 15000
    while(Date.now() < deadline) {
        const ready = await evaluate(browser, sessionId, 'typeof window.spike').catch(() => null)
        if(ready === 'object') return {role, targetId, sessionId}
        await sleep(250)
    }
    throw new Error(`probe page (${role}) never loaded`)
}

async function waitForEpoch(browser, page, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs
    while(Date.now() < deadline) {
        const state = await evaluate(browser, page.sessionId, 'window.spike.state()')
        if(state.epoch !== null) return state.epoch
        await sleep(200)
    }
    throw new Error('owner never acquired the lock')
}

function summarise(entries) {
    const lags = entries.map(entry => entry.lagMs).filter(value => typeof value === 'number').sort((left, right) => left - right)
    const stats = lags.length
        ? {
            meanMs: Number((lags.reduce((sum, value) => sum + value, 0) / lags.length).toFixed(1)),
            p95Ms: lags[Math.floor(lags.length * 0.95)],
            maxMs: lags[lags.length - 1]
        }
        : null
    const byEpoch = {}
    for(const entry of entries) {
        const key = String(entry.epoch)
        byEpoch[key] = byEpoch[key] || {seqs: new Set()}
        byEpoch[key].seqs.add(entry.seq)
    }
    const epochs = {}
    for(const [epoch, {seqs}] of Object.entries(byEpoch)) {
        const sorted = Array.from(seqs).sort((left, right) => left - right)
        const range = sorted.length ? sorted[sorted.length - 1] - sorted[0] + 1 : 0
        epochs[epoch] = {
            received: sorted.length,
            firstSeq: sorted[0] ?? null,
            lastSeq: sorted[sorted.length - 1] ?? null,
            missingInRange: range - sorted.length
        }
    }
    return {received: entries.length, lag: stats, epochs}
}

async function viewerSummary(browser, page) {
    const state = await evaluate(browser, page.sessionId, 'window.spike.state()')
    return {broadcast: summarise(state.broadcast), storage: summarise(state.storage)}
}

async function serviceWorkerSummary(browser, page) {
    const reply = await evaluate(browser, page.sessionId, `window.spike.swState()`)
    return reply
}

async function contentSummary(browser, sessionId) {
    const value = await evaluate(browser, sessionId, `document.documentElement?.getAttribute('data-mirror-broadcast') ?? null`).catch(() => null)
    if(!value) return null
    const report = JSON.parse(value)
    return {broadcast: summarise(report.broadcast), storage: summarise(report.storage)}
}

async function main() {
    const site = await serveSite()
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
    const results = {burst: BURST}
    try {
        const loaded = await browser.send('Extensions.loadUnpacked', {path: EXT_DIR})
        const extensionId = loaded.id

        log('loaded extension')
        const owner = await openPage(browser, extensionId, 'owner')
        log('owner page open')
        await waitForEpoch(browser, owner)
        const progress = await openPage(browser, extensionId, 'viewer')
        const dashboard = await openPage(browser, extensionId, 'viewer')
        const {targetId: contentTarget} = await browser.send('Target.createTarget', {url: `http://127.0.0.1:${SITE_PORT}/`})
        const {sessionId: contentSession} = await browser.send('Target.attachToTarget', {targetId: contentTarget, flatten: true})
        await sleep(1500)

        log('phase 1 steady')
        await browser.send('Target.activateTarget', {targetId: owner.targetId})
        const steadyBurst = evaluate(browser, owner.sessionId, `window.spike.burst(${JSON.stringify(BURST)})`)
        for(let tick = 0; tick < 8; tick += 1) {
            await sleep(1000)
            const progressProbe = await evaluate(browser, owner.sessionId, `window.spike.state().setMs.length`).catch(error => error.message)
            log(`burst progress: setMs samples ${progressProbe}`)
        }
        await steadyBurst
        await sleep(1000)
        results.steady = {
            progressViewer: await viewerSummary(browser, progress),
            dashboardViewer: await viewerSummary(browser, dashboard),
            serviceWorker: await serviceWorkerSummary(browser, progress),
            contentScript: await contentSummary(browser, contentSession)
        }

        log('phase 2 late join')
        // 2. A viewer that joins while the burst is running.
        await browser.send('Target.activateTarget', {targetId: owner.targetId})
        const lateBurst = evaluate(browser, owner.sessionId, `window.spike.burst(${JSON.stringify(BURST)})`)
        await sleep(1000)
        const late = await openPage(browser, extensionId, 'viewer')
        await lateBurst
        await sleep(1000)
        const lateState = await viewerSummary(browser, late)
        const mirrorNow = await evaluate(browser, late.sessionId, 'window.spike.readMirror()')
        results.lateJoin = {
            lateViewer: lateState,
            mirrorSeqReadOnJoin: mirrorNow.mirrorSeq,
            note: 'Messages sent before the viewer subscribed are not replayed; the mirror read gives the current seq.'
        }

        log('phase 3 sw stop')
        // 3. Service worker stopped mid-stream.
        await browser.send('Target.activateTarget', {targetId: owner.targetId})
        const swBurst = evaluate(browser, owner.sessionId, `window.spike.burst(${JSON.stringify(BURST)})`)
        await sleep(1000)
        await browser.send('ServiceWorker.enable', {}, progress.sessionId).catch(() => {})
        await browser.send('ServiceWorker.stopAllWorkers', {}, progress.sessionId)
        const swRange = await swBurst
        await sleep(1000)
        const restarted = await serviceWorkerSummary(browser, progress)
        results.serviceWorkerRestart = {
            burstRange: {sentFrom: swRange.sentFrom, sentTo: swRange.sentTo},
            serviceWorkerAfterRestart: restarted,
            progressViewerAfterRestart: await viewerSummary(browser, progress)
        }

        log('phase 4 handover')
        // 4. Owner handover: a second owner queues for the lock, takes over when the first closes.
        const owner2 = await openPage(browser, extensionId, 'owner')
        await sleep(500)
        evaluate(browser, owner.sessionId, `window.spike.burst({count: 100, intervalMs: 10})`).catch(() => {})
        await sleep(400)
        await browser.send('Target.closeTarget', {targetId: owner.targetId})
        const newEpoch = await waitForEpoch(browser, owner2, 10000)
        await browser.send('Target.activateTarget', {targetId: owner2.targetId})
        const ownerTwoBurst = await evaluate(browser, owner2.sessionId, `window.spike.burst({count: 100, intervalMs: 10})`)
        await sleep(1000)
        results.ownerHandover = {
            newEpoch,
            ownerTwoRange: {sentFrom: ownerTwoBurst.sentFrom, sentTo: ownerTwoBurst.sentTo},
            progressViewer: await viewerSummary(browser, progress),
            dashboardViewer: await viewerSummary(browser, dashboard)
        }

        console.log(JSON.stringify(results, null, 2))
    }
    finally {
        try {
            await browser.send('Browser.close')
        }
        catch {}
        site.close()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
