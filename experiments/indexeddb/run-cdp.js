'use strict'

// IndexedDB spike driver. Launches an isolated Chrome (own profile, own debug
// port) with the probe extension in ext/, then runs one experiment per
// subcommand over raw CDP. Never touches the user's own Chrome or extension.
//
//   node experiments/indexeddb/run-cdp.js smoke
//   node experiments/indexeddb/run-cdp.js keepalive-idb [seconds]
//   node experiments/indexeddb/run-cdp.js keepalive-timer [seconds]
//   node experiments/indexeddb/run-cdp.js atomic [trials]
//   node experiments/indexeddb/run-cdp.js bench
//   node experiments/indexeddb/run-cdp.js content

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9333)
const SITE_PORT = 8765
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const SITE_DIR = path.join(ROOT, 'site')
const PROFILE_DIR = path.join(ROOT, '.profile')

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function serveSite() {
    return new Promise((resolve) => {
        const server = http.createServer((request, response) => {
            const file = path.join(SITE_DIR, request.url === '/' ? 'index.html' : request.url)
            fs.readFile(file, (error, data) => {
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

function launchChrome() {
    const child = spawn(CHROME_BIN, [
        `--user-data-dir=${PROFILE_DIR}`,
        `--remote-debugging-address=127.0.0.1`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        '--enable-unsafe-extension-debugging',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
    ], {detached: true, stdio: 'ignore'})
    child.unref()
    return child
}

async function getJson(url) {
    const response = await fetch(url)
    return response.json()
}

async function waitForDebugger() {
    const deadline = Date.now() + 30000
    while(Date.now() < deadline) {
        try {
            return await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
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

    on(listener) {
        this.listeners.push(listener)
    }
}

async function evaluate(cdp, sessionId, expression) {
    const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
    }, sessionId)
    if(result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
    return result.result.value
}

async function openExtensionPage(browser, extensionId) {
    const {targetId} = await browser.send('Target.createTarget', {
        url: `chrome-extension://${extensionId}/page.html`
    })
    const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true})
    await browser.send('ServiceWorker.enable', {}, sessionId).catch(() => {})
    const deadline = Date.now() + 15000
    while(Date.now() < deadline) {
        if(await evaluate(browser, sessionId, `typeof window.spike`).catch(() => null) === 'object') {
            return {targetId, sessionId}
        }
        await sleep(250)
    }
    throw new Error('extension page never exposed window.spike')
}

// Tracks running worker versions so the driver can stop the probe worker by versionId.
function trackWorkerVersions(browser, pageSessionId) {
    const versions = new Map()
    browser.on((message) => {
        if(message.sessionId !== pageSessionId) return
        if(message.method !== 'ServiceWorker.workerVersionUpdated') return
        for(const version of message.params.versions) {
            versions.set(version.versionId, version)
        }
    })
    return versions
}

// The profile only contains the probe worker, so stopAllWorkers kills nothing
// else. Returns whether a worker target was present to kill.
async function stopProbeWorker(browser, pageSessionId) {
    const before = await workerTargets(browser)
    if(!before.length) return false
    await browser.send('ServiceWorker.stopAllWorkers', {}, pageSessionId)
    return true
}

async function workerTargets(browser) {
    const {targetInfos} = await browser.send('Target.getTargets')
    return targetInfos.filter(info => info.type === 'service_worker' && info.url.endsWith('/sw.js'))
}

async function ensureWorkerRunning(browser, pageSession) {
    const response = await evaluate(browser, pageSession, `window.spike.send({type: 'ping'})`)
    if(!response.response?.ok) throw new Error(`ping failed: ${JSON.stringify(response)}`)
    return response.response.result.bootId
}

async function setup() {
    const site = await serveSite()
    fs.rmSync(PROFILE_DIR, {recursive: true, force: true})
    fs.mkdirSync(PROFILE_DIR, {recursive: true})
    const child = launchChrome()
    const version = await waitForDebugger()
    const browser = new Cdp(version.webSocketDebuggerUrl)
    const loaded = await browser.send('Extensions.loadUnpacked', {path: EXT_DIR})
    const extensionId = loaded.id
    const page = await openExtensionPage(browser, extensionId)
    const versions = trackWorkerVersions(browser, page.sessionId)
    await ensureWorkerRunning(browser, page.sessionId)
    return {site, child, browser, extensionId, page, versions}
}

async function teardown(env) {
    try {
        await env.browser.send('Browser.close')
    }
    catch {}
    env.site.close()
}

async function smoke(env) {
    const bootId = await ensureWorkerRunning(env.browser, env.page.sessionId)
    const workers = await workerTargets(env.browser)
    return {extensionId: env.extensionId, bootId, serviceWorkerTargets: workers.length}
}

// Each probe returns at once and then runs in the worker. The driver polls for
// the worker target disappearing (killed) and for the done marker written by
// the same worker boot. A marker from a different bootId means the loop died.
async function keepalive(env, seconds, probeName) {
    const samples = []
    const probes = {
        idb: {type: 'idbKeepalive', marker: 'done-idb'},
        timer: {type: 'timerKeepalive', marker: 'done-timer'}
    }
    for(const probe of [probes[probeName]]) {
        const bootId = await ensureWorkerRunning(env.browser, env.page.sessionId)
        const started = Date.now()
        await evaluate(env.browser, env.page.sessionId, `window.spike.send({type: '${probe.type}', seconds: ${seconds}})`)
        let killedAfterMs = null
        let finishedMs = null
        let marker = null
        let workerSeenMin = Infinity
        let workerSeenMax = 0
        const deadline = started + (seconds + 20) * 1000
        while(Date.now() < deadline && finishedMs === null) {
            const count = (await workerTargets(env.browser)).length
            workerSeenMin = Math.min(workerSeenMin, count)
            workerSeenMax = Math.max(workerSeenMax, count)
            if(killedAfterMs === null && count === 0) killedAfterMs = Date.now() - started
            const value = await evaluate(env.browser, env.page.sessionId, `window.spike.readMeta('${probe.marker}')`)
            if(value && value.bootId === bootId) {
                finishedMs = Date.now() - started
                marker = value
            }
            await sleep(500)
        }
        const heartbeat = await evaluate(env.browser, env.page.sessionId, `window.spike.readMeta('hb-idb')`)
        const ping = await evaluate(env.browser, env.page.sessionId, `window.spike.send({type: 'ping'})`)
        samples.push({
            probe: probe.type,
            requestedSeconds: seconds,
            bootId,
            killedAfterMs,
            finishedMs,
            workerTargetCount: {min: workerSeenMin, max: workerSeenMax},
            lastHeartbeatAt: heartbeat,
            pingAtEnd: ping.response?.result ?? ping.response ?? ping,
            marker
        })
    }
    return samples
}

// Calibrates the undisturbed commit time first, then kills the worker at delays
// spread across that window, so both committed and interrupted writes occur.
async function atomic(env, trials) {
    const calibration = []
    for(let index = 0; index < 3; index += 1) {
        await ensureWorkerRunning(env.browser, env.page.sessionId)
        const started = Date.now()
        await evaluate(env.browser, env.page.sessionId, `window.spike.send({type: 'startAtomicWrite', seq: ${-(index + 1)}})`)
        calibration.push(Date.now() - started)
    }
    const commitMs = Math.max(...calibration)
    const outcomes = []
    for(let trial = 1; trial <= trials; trial += 1) {
        await ensureWorkerRunning(env.browser, env.page.sessionId)
        const delayMs = Math.floor(Math.random() * commitMs * 1.2)
        const sent = evaluate(env.browser, env.page.sessionId, `window.spike.send({type: 'startAtomicWrite', seq: ${trial}})`)
        const replied = sent.then(r => r, () => null)
        await sleep(delayMs)
        const stopped = await stopProbeWorker(env.browser, env.page.sessionId)
        const reply = await replied
        const state = await evaluate(env.browser, env.page.sessionId, `window.spike.readAtomicState(2000)`)
        outcomes.push({
            trial,
            delayMs,
            stopped,
            replyOk: reply?.response?.ok === true,
            replyError: reply?.response?.error || reply?.lastError || null,
            ...state
        })
    }
    return {calibrationMs: calibration, commitMs, outcomes}
}

// Seeds the probe database with one committed 2000-row write, so reads hit data.
async function seed(env) {
    await ensureWorkerRunning(env.browser, env.page.sessionId)
    const reply = await evaluate(env.browser, env.page.sessionId, `window.spike.send({type: 'startAtomicWrite', seq: 1})`)
    if(!reply.response?.ok || reply.response.result.committed !== true) {
        throw new Error(`seed write did not commit: ${JSON.stringify(reply)}`)
    }
}

async function bench(env) {
    await seed(env)
    const worker = await evaluate(env.browser, env.page.sessionId, `window.spike.send({type: 'bench', iterations: 30})`)
    const page = await evaluate(env.browser, env.page.sessionId, `window.spike.benchPage(30)`)
    return {worker: worker.response?.result?.results ?? worker, extensionPage: page}
}

async function content(env) {
    await seed(env)
    await ensureWorkerRunning(env.browser, env.page.sessionId)
    await evaluate(env.browser, env.page.sessionId, `chrome.storage.session.set({probeKey: 'from-page'}).then(() => true)`)
    const {targetId} = await env.browser.send('Target.createTarget', {url: `http://127.0.0.1:${SITE_PORT}/`})
    const {sessionId} = await env.browser.send('Target.attachToTarget', {targetId, flatten: true})
    await sleep(2500)
    const attribute = await evaluate(env.browser, sessionId, `document.documentElement.getAttribute('data-idb-spike')`)
    const pageDbs = await evaluate(env.browser, env.page.sessionId, `window.spike.dbNames()`)
    return {contentReport: JSON.parse(attribute || 'null'), extensionPageDbs: pageDbs}
}

async function main() {
    const command = process.argv[2] || 'smoke'
    const env = await setup()
    try {
        const runners = {
            smoke: () => smoke(env),
            'keepalive-idb': () => keepalive(env, Number(process.argv[3] || 60), 'idb'),
            'keepalive-timer': () => keepalive(env, Number(process.argv[3] || 60), 'timer'),
            atomic: () => atomic(env, Number(process.argv[3] || 20)),
            bench: () => bench(env),
            content: () => content(env)
        }
        const runner = runners[command]
        if(!runner) throw new Error(`unknown experiment: ${command}`)
        const result = await runner()
        console.log(JSON.stringify(result, null, 2))
    }
    finally {
        await teardown(env)
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
