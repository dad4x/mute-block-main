'use strict'

// Long run: does Chrome freeze or discard a hidden owner page on its own, and
// what happens to the lock and to a waiting replacement? The owner holds
// 'mb-owner' in a background tab; a waiter queues behind it; a decoy tab keeps
// both hidden. Samples every SAMPLE_SECONDS to a CSV and logs lifecycle and
// target events as they arrive. Never touches the user's Chrome.
//
//   node experiments/design-probes/long-freeze.js [durationSeconds] [sampleSeconds]

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9360)
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const PROFILE_DIR = path.join(ROOT, `.profile-long-${Date.now()}`)
const DURATION_SECONDS = Number(process.argv[2] || 2100)
const SAMPLE_SECONDS = Number(process.argv[3] || 30)
const CSV_PATH = path.join(ROOT, 'long-freeze.csv')
const EVENTS_PATH = path.join(ROOT, 'long-freeze-events.json')
const SUMMARY_PATH = path.join(ROOT, 'long-freeze-summary.json')

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
                if(!waiter) return
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

    on(listener) {
        this.listeners.push(listener)
    }
}

// Returns 'timeout' if the page does not answer, which is what a frozen page does.
async function evaluateWithTimeout(browser, sessionId, expression, timeoutMs = 5000) {
    const call = browser.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId)
        .then(result => result.result?.value ?? null, () => 'error')
    const timer = sleep(timeoutMs).then(() => 'timeout')
    return Promise.race([call, timer])
}

async function openPage(browser, extensionId, query) {
    const {targetId} = await browser.send('Target.createTarget', {url: `chrome-extension://${extensionId}/page.html${query}`})
    const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true})
    return {targetId, sessionId}
}

async function waitForValue(browser, page, expression, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs
    while(Date.now() < deadline) {
        const value = await evaluateWithTimeout(browser, page.sessionId, expression, 3000)
        if(value) return value
        await sleep(250)
    }
    throw new Error(`timed out waiting for ${expression}`)
}

async function main() {
    fs.mkdirSync(PROFILE_DIR, {recursive: true})
    fs.writeFileSync(CSV_PATH, 't_seconds,owner_listed,owner_responsive,owner_heartbeat,owner_visibility,lock_held_by_owner,waiter_acquired,sw_responsive\n')
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
    const events = []
    const startedAt = Date.now()
    const stamp = () => Number(((Date.now() - startedAt) / 1000).toFixed(1))
    browser.on((message) => {
        if(message.method === 'Target.targetDestroyed' || message.method === 'Target.targetCreated') {
            events.push({t: stamp(), event: message.method, targetId: message.params.targetId})
        }
        if(message.method === 'Page.lifecycleEvent' || message.method === 'Page.frozen' || message.method === 'Page.resumed') {
            events.push({t: stamp(), event: message.method, name: message.params?.name ?? null, sessionId: message.sessionId ?? null})
        }
    })

    const summary = {durationSeconds: DURATION_SECONDS, sampleSeconds: SAMPLE_SECONDS}
    try {
        const loaded = await browser.send('Extensions.loadUnpacked', {path: EXT_DIR})
        const owner = await openPage(browser, loaded.id, '?role=owner')
        await waitForValue(browser, owner, 'window.spike.state().ownerAcquired || null')
        await browser.send('Page.enable', {}, owner.sessionId).catch(() => {})
        await browser.send('Page.setLifecycleEventsEnabled', {enabled: true}, owner.sessionId).catch(() => {})
        const waiter = await openPage(browser, loaded.id, '?role=waiter')
        await waitForValue(browser, waiter, 'typeof window.spike')
        await openPage(browser, loaded.id, '')
        await browser.send('Target.createTarget', {url: 'about:blank'})
        summary.ownerTargetId = owner.targetId

        let ownerDestroyedAt = null
        let firstUnresponsiveAt = null
        let waiterAcquiredAt = null
        let lastOwnerHeartbeat = null
        let heartbeatStalledSince = null

        while(stamp() < DURATION_SECONDS) {
            const t = stamp()
            const {targetInfos} = await browser.send('Target.getTargets')
            const ownerListed = targetInfos.some(info => info.targetId === owner.targetId)
            const heartbeat = ownerListed ? await evaluateWithTimeout(browser, owner.sessionId, 'window.spike.heartbeat()') : null
            const visibility = ownerListed ? await evaluateWithTimeout(browser, owner.sessionId, 'document.visibilityState') : null
            const sw = await evaluateWithTimeout(browser, waiter.sessionId, 'window.spike.swState()', 8000)
            const waiterState = await evaluateWithTimeout(browser, waiter.sessionId, 'window.spike.state().ownerAcquired')
            const lockHeldByOwner = sw && typeof sw === 'object' ? sw.ownerHeld : null
            const responsive = heartbeat !== null && heartbeat !== 'timeout' && heartbeat !== 'error'

            if(!ownerListed && ownerDestroyedAt === null) ownerDestroyedAt = t
            if(ownerListed && !responsive && firstUnresponsiveAt === null) firstUnresponsiveAt = t
            if(waiterState === true && waiterAcquiredAt === null) waiterAcquiredAt = t
            if(heartbeat === lastOwnerHeartbeat && heartbeat !== null && heartbeat !== 'timeout' && heartbeatStalledSince === null) heartbeatStalledSince = t
            if(heartbeat !== lastOwnerHeartbeat) heartbeatStalledSince = null
            lastOwnerHeartbeat = heartbeat

            fs.appendFileSync(CSV_PATH, [
                t, ownerListed, responsive, heartbeat, visibility, lockHeldByOwner, waiterState, sw !== 'timeout' && sw !== 'error'
            ].join(',') + '\n')
            fs.writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2))
            if(ownerDestroyedAt !== null && waiterAcquiredAt !== null) break
            await sleep(SAMPLE_SECONDS * 1000)
        }

        summary.ownerDestroyedAtSeconds = ownerDestroyedAt
        summary.ownerFirstUnresponsiveAtSeconds = firstUnresponsiveAt
        summary.waiterAcquiredAtSeconds = waiterAcquiredAt
        summary.heartbeatStalledSinceSeconds = heartbeatStalledSince
        summary.eventCount = events.length
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
