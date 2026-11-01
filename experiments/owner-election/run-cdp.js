'use strict'

// Owner election with Web Locks across extension pages. Opens a holder and two
// waiters, closes the holder, and measures handover to exactly one waiter. Also
// checks that a late 'holder' attempt is refused while the lock is held. Never
// touches the user's Chrome or extension.
//
//   node experiments/owner-election/run-cdp.js

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9337)
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const PROFILE_DIR = path.join(ROOT, '.profile')

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

async function state(browser, page) {
    return evaluate(browser, page.sessionId, 'window.spike.state()')
}

async function main() {
    fs.rmSync(PROFILE_DIR, {recursive: true, force: true})
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
        const holder = await openPage(browser, loaded.id, 'holder')
        const waiterA = await openPage(browser, loaded.id, 'waiter')
        const waiterB = await openPage(browser, loaded.id, 'waiter')
        await sleep(1500)

        const before = {holder: await state(browser, holder), waiterA: await state(browser, waiterA), waiterB: await state(browser, waiterB)}

        const closedAt = Date.now()
        await browser.send('Target.closeTarget', {targetId: holder.targetId})
        await sleep(3000)
        const afterA = await state(browser, waiterA)
        const afterB = await state(browser, waiterB)
        const acquired = [afterA, afterB].filter(entry => entry.acquired)

        const lateHolder = await openPage(browser, loaded.id, 'holder')
        await sleep(1500)
        const late = await state(browser, lateHolder)

        console.log(JSON.stringify({
            beforeClose: {
                holderAcquired: before.holder.acquired,
                waiterAAcquired: before.waiterA.acquired,
                waiterBAcquired: before.waiterB.acquired
            },
            afterClose: {
                waiterAAcquired: afterA.acquired,
                waiterBAcquired: afterB.acquired,
                exactlyOneWaiterAcquired: acquired.length === 1,
                handoverMs: acquired.length === 1 ? acquired[0].acquiredAt - closedAt : null
            },
            lateHolder: {
                acquired: late.acquired,
                ifAvailableResult: late.ifAvailableResult
            }
        }, null, 2))
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
