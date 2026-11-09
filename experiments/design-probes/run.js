'use strict'

// Design probes (Chrome). Generic extension mechanics only; no repo code.
//   node experiments/design-probes/run.js routing
//   node experiments/design-probes/run.js handoff [repetitions]
//   node experiments/design-probes/run.js atomic [iterations]
//   node experiments/design-probes/run.js lifetime
// Each run uses a fresh profile on its own debug port and never touches the
// user's Chrome.

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9347)
const SITE_PORT = 8769
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const SITE_DIR = path.join(ROOT, 'site')
const PROFILE_DIR = path.join(ROOT, `.profile-${Date.now()}`)
const COMMAND = process.argv[2] || 'routing'
const ARG = Number(process.argv[3] || 0)

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

async function evaluate(browser, sessionId, expression) {
    const result = await browser.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId)
    if(result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
    return result.result.value
}

async function openPage(browser, url) {
    const {targetId} = await browser.send('Target.createTarget', {url})
    const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true})
    return {targetId, sessionId, url}
}

async function waitForValue(browser, page, expression, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs
    while(Date.now() < deadline) {
        const value = await evaluate(browser, page.sessionId, expression).catch(() => null)
        if(value) return value
        await sleep(200)
    }
    throw new Error(`timed out waiting for ${expression}`)
}

async function ownerPage(browser, extensionId, role) {
    const page = await openPage(browser, `chrome-extension://${extensionId}/page.html?role=${role}`)
    await waitForValue(browser, page, 'typeof window.spike')
    return page
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
}

async function runRouting(browser, extensionId) {
    const site = await openPage(browser, `http://127.0.0.1:${SITE_PORT}/`)
    await waitForValue(browser, site, `document.documentElement.getAttribute('data-mb-result') !== null ? 'ready' : null`)

    const dispatch = id => evaluate(browser, site.sessionId, `document.dispatchEvent(new CustomEvent('mb-request', {detail: {id: '${id}'}})); true`)
    const result = id => evaluate(browser, site.sessionId, `(() => { const value = document.documentElement.getAttribute('data-mb-result'); const all = value ? JSON.parse(value) : {}; return all['${id}'] || null })()`)
    const waitResult = async (id) => {
        const deadline = Date.now() + 45000
        while(Date.now() < deadline) {
            const value = await result(id)
            if(value) return value
            await sleep(200)
        }
        return {ok: false, timedOut: true}
    }

    const outcomes = {}
    const ownerReady = async (role) => {
        const page = await ownerPage(browser, extensionId, role)
        await waitForValue(browser, page, 'window.spike.state().ownerAcquired || null')
        return page
    }
    await browser.send('ServiceWorker.enable', {}, site.sessionId).catch(() => {})

    let owner = await ownerReady('owner')
    await dispatch('present')
    outcomes.ownerPresent = await waitResult('present')

    await browser.send('Target.closeTarget', {targetId: owner.targetId})
    await sleep(500)
    await dispatch('absentThenStart')
    await sleep(1500)
    owner = await ownerReady('owner')
    outcomes.ownerAbsentThenStart = await waitResult('absentThenStart')

    await evaluate(browser, owner.sessionId, 'window.spike.setReplyDelay(1500)')
    await dispatch('restartInFlight')
    await sleep(300)
    await browser.send('Target.closeTarget', {targetId: owner.targetId})
    await sleep(1000)
    owner = await ownerReady('owner')
    outcomes.ownerRestartInFlight = await waitResult('restartInFlight')

    await browser.send('Target.closeTarget', {targetId: owner.targetId})
    await sleep(500)
    await dispatch('swTerminatedWhileAbsent')
    await sleep(200)
    await browser.send('ServiceWorker.stopAllWorkers', {}, site.sessionId)
    await sleep(1500)
    owner = await ownerReady('owner')
    outcomes.serviceWorkerTerminatedWhileAbsent = await waitResult('swTerminatedWhileAbsent')

    return outcomes
}

async function runHandoff(browser, extensionId, repetitions) {
    const owner = await ownerPage(browser, extensionId, 'owner')
    await waitForValue(browser, owner, 'window.spike.state().ownerAcquired || null')
    await evaluate(browser, owner.sessionId, 'window.spike.seedHandoff()')
    const copy = []
    const buffer = []
    for(let index = 0; index < repetitions; index += 1) {
        copy.push(await evaluate(browser, owner.sessionId, 'window.spike.handoffCopy()'))
        buffer.push(await evaluate(browser, owner.sessionId, 'window.spike.handoffBuffer()'))
    }
    const summarise = (rows, field) => ({
        medianMs: Number(median(rows.map(row => row[field])).toFixed(2)),
        maxMs: Number(Math.max(...rows.map(row => row[field])).toFixed(2))
    })
    return {
        keys: copy[0].keys,
        bytes: copy[0].bytes,
        records: copy[0].records,
        repetitions,
        copy: {read: summarise(copy, 'readMs'), copyAndReplay: summarise(copy, 'copyAndReplayMs'), workerReplay: summarise(copy, 'workerReplayMs')},
        buffer: {read: summarise(buffer, 'readMs'), encode: summarise(buffer, 'encodeMs'), transferAndReplay: summarise(buffer, 'transferAndReplayMs'), workerReplay: summarise(buffer, 'workerReplayMs')}
    }
}

async function runAtomic(browser, extensionId, iterations) {
    const owner = await ownerPage(browser, extensionId, 'owner')
    await waitForValue(browser, owner, 'window.spike.state().ownerAcquired || null')
    return evaluate(browser, owner.sessionId, `window.spike.atomicProbe(${iterations})`)
}

async function runLifetime(browser, extensionId) {
    const owner = await ownerPage(browser, extensionId, 'owner')
    await waitForValue(browser, owner, 'window.spike.state().ownerAcquired || null')
    await evaluate(browser, owner.sessionId, 'window.spike.seedHandoff()')
    const waiter = await ownerPage(browser, extensionId, 'waiter')
    await sleep(1000)
    const waiterAcquiredBeforeFreeze = await evaluate(browser, waiter.sessionId, 'window.spike.state().ownerAcquired')

    await browser.send('Page.enable', {}, owner.sessionId).catch(() => {})
    await browser.send('Page.setWebLifecycleState', {state: 'frozen'}, owner.sessionId)
    await sleep(3000)
    const swWhileFrozen = await evaluate(browser, waiter.sessionId, 'window.spike.swState()')
    const waiterAcquiredWhileFrozen = await evaluate(browser, waiter.sessionId, 'window.spike.state().ownerAcquired')

    await browser.send('Page.setWebLifecycleState', {state: 'active'}, owner.sessionId).catch(() => {})
    await sleep(1000)

    const discard = await evaluate(browser, waiter.sessionId, 'window.spike.discardOwner()')
    const acquiredAt = await waitForValue(browser, waiter, 'window.spike.state().ownerAcquiredAt', 30000)
    const {targetInfos} = await browser.send('Target.getTargets')
    const ownerStillListed = targetInfos.some(info => info.targetId === owner.targetId)

    const readiness = []
    const readyStart = Date.now()
    const handoff = await evaluate(browser, waiter.sessionId, 'window.spike.handoffCopy()')
    readiness.push(Date.now() - readyStart)

    return {
        waiterAcquiredBeforeFreeze,
        frozenOwnerLockHeld: swWhileFrozen?.ownerHeld ?? null,
        waiterAcquiredWhileFrozen,
        discardOk: discard?.ok ?? null,
        discardToWaiterAcquireMs: discard?.discardedAt ? acquiredAt - discard.discardedAt : null,
        ownerTargetStillListedAfterDiscard: ownerStillListed,
        replacementReadinessMs: readiness[0],
        replacementHandoffWorkerReplayMs: Number(handoff.workerReplayMs.toFixed(2)),
        replacementRecords: handoff.records
    }
}

async function runTabs(browser, extensionId, iterations) {
    const owner = await ownerPage(browser, extensionId, 'owner')
    await waitForValue(browser, owner, 'window.spike.state().ownerAcquired || null')
    await browser.send('Target.activateTarget', {targetId: owner.targetId})
    await sleep(800)
    const focused = await evaluate(browser, owner.sessionId, `window.spike.tabTiming(${iterations})`)
    await openPage(browser, 'about:blank')
    await sleep(1000)
    const hidden = await evaluate(browser, owner.sessionId, `window.spike.tabTiming(${iterations})`)
    return {focused, hidden}
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
    try {
        const loaded = await browser.send('Extensions.loadUnpacked', {path: EXT_DIR})
        const extensionId = loaded.id
        const runners = {
            routing: () => runRouting(browser, extensionId),
            handoff: () => runHandoff(browser, extensionId, ARG || 10),
            atomic: () => runAtomic(browser, extensionId, ARG || 200),
            lifetime: () => runLifetime(browser, extensionId),
            tabs: () => runTabs(browser, extensionId, ARG || 20)
        }
        const runner = runners[COMMAND]
        if(!runner) throw new Error(`unknown command ${COMMAND}`)
        console.log(JSON.stringify({command: COMMAND, result: await runner()}, null, 2))
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
