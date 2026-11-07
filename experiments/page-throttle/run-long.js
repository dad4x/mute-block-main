'use strict'

// Long throttling run. Two extension pages in one window: 'fg' stays focused for
// the whole run, 'bg' stays hidden. Each page has a main-thread timer and a
// dedicated worker timer. Samples every SAMPLE_SECONDS go to a CSV as they are
// taken, so a partial run still has data. Never touches the user's Chrome.
//
//   node experiments/page-throttle/run-long.js [durationSeconds] [sampleSeconds]

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9343)
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const PROFILE_DIR = path.join(ROOT, `.profile-long-${Date.now()}`)
const DURATION_SECONDS = Number(process.argv[2] || 1800)
const SAMPLE_SECONDS = Number(process.argv[3] || 10)
const CSV_PATH = path.join(ROOT, 'long-run.csv')
const SUMMARY_PATH = path.join(ROOT, 'long-run-summary.json')

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

function rate(previous, current, key, elapsedKey) {
    const seconds = (current[elapsedKey] - previous[elapsedKey]) / 1000
    if(seconds <= 0) return null
    return (current[key] - previous[key]) / seconds
}

function summarise(samples) {
    const segmentSeconds = 300
    const segments = []
    let start = 0
    while(start < samples.length - 1) {
        const from = samples[start]
        let end = start + 1
        while(end < samples.length - 1 && samples[end].t - from.t < segmentSeconds) end += 1
        const to = samples[end]
        const seconds = to.t - from.t
        segments.push({
            fromSeconds: from.t,
            toSeconds: to.t,
            fgPageTicksPerSecond: Number(((to.fg.pageTicks - from.fg.pageTicks) / seconds).toFixed(2)),
            fgWorkerTicksPerSecond: Number(((to.fg.workerTicks - from.fg.workerTicks) / seconds).toFixed(2)),
            bgPageTicksPerSecond: Number(((to.bg.pageTicks - from.bg.pageTicks) / seconds).toFixed(2)),
            bgWorkerTicksPerSecond: Number(((to.bg.workerTicks - from.bg.workerTicks) / seconds).toFixed(2)),
            bgVisibility: to.bg.visibility,
            fgVisibility: to.fg.visibility
        })
        start = end
    }
    return segments
}

async function main() {
    fs.mkdirSync(PROFILE_DIR, {recursive: true})
    fs.writeFileSync(CSV_PATH, 't_seconds,fg_visibility,fg_page_ticks,fg_worker_ticks,bg_visibility,bg_page_ticks,bg_worker_ticks\n')
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
    const samples = []
    try {
        const loaded = await browser.send('Extensions.loadUnpacked', {path: EXT_DIR})
        const bg = await openPage(browser, loaded.id)
        const fg = await openPage(browser, loaded.id)
        await browser.send('Target.activateTarget', {targetId: fg.targetId})
        await sleep(2000)

        const startedAt = Date.now()
        while(true) {
            const t = (Date.now() - startedAt) / 1000
            const fgStats = await evaluate(browser, fg.sessionId, 'window.spike.stats()')
            const bgStats = await evaluate(browser, bg.sessionId, 'window.spike.stats()')
            const sample = {t, fg: fgStats, bg: bgStats}
            samples.push(sample)
            fs.appendFileSync(CSV_PATH, [
                t.toFixed(1),
                fgStats.visibility, fgStats.pageTicks, fgStats.workerTicks,
                bgStats.visibility, bgStats.pageTicks, bgStats.workerTicks
            ].join(',') + '\n')
            if(t >= DURATION_SECONDS) break
            await sleep(SAMPLE_SECONDS * 1000)
        }

        const summary = {
            durationSeconds: DURATION_SECONDS,
            sampleSeconds: SAMPLE_SECONDS,
            samples: samples.length,
            segments: summarise(samples)
        }
        fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2))
        console.log(JSON.stringify(summary, null, 2))
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
