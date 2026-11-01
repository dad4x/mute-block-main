'use strict'

// Foreground-worker origin probe. Loads the probe extension in an isolated
// Chrome, opens a local page that stands in for Quora, and reports which
// origin's OPFS received a file written by a worker created from a content
// script. Never touches the user's Chrome or extension.
//
//   node experiments/foreground-worker/run-cdp.js

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const CHROME_BIN = process.env.SPIKE_CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SPIKE_CDP_PORT || 9335)
const SITE_PORT = 8766
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const SITE_DIR = path.join(ROOT, 'site')
const PROFILE_DIR = path.join(ROOT, '.profile')
const FILE_NAME = 'probe-from-content-worker.txt'

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

const LIST_OPFS = `(async () => {
    const root = await navigator.storage.getDirectory()
    const names = []
    for await (const [name] of root.entries()) names.push(name)
    return {origin: location.origin, names}
})()`

async function attach(browser, url) {
    const {targetId} = await browser.send('Target.createTarget', {url})
    const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true})
    return {targetId, sessionId}
}

async function main() {
    const site = await serveSite()
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
        const extensionId = loaded.id
        const pageTarget = await attach(browser, `http://127.0.0.1:${SITE_PORT}/`)
        let contentReport = null
        const deadline = Date.now() + 15000
        while(Date.now() < deadline && !contentReport) {
            const value = await evaluate(browser, pageTarget.sessionId, `document.documentElement?.getAttribute('data-foreground-worker') ?? null`).catch(() => null)
            if(value) contentReport = JSON.parse(value)
            else await sleep(250)
        }
        const pageOpfs = await evaluate(browser, pageTarget.sessionId, LIST_OPFS)
        const extensionTarget = await attach(browser, `chrome-extension://${extensionId}/page.html`)
        const loadDeadline = Date.now() + 15000
        while(Date.now() < loadDeadline) {
            const href = await evaluate(browser, extensionTarget.sessionId, 'location.href').catch(() => '')
            if(href.startsWith('chrome-extension://')) break
            await sleep(250)
        }
        const extensionOpfs = await evaluate(browser, extensionTarget.sessionId, LIST_OPFS)
        const fileInPageOrigin = pageOpfs.names.includes(FILE_NAME)
        const fileInExtensionOrigin = extensionOpfs.names.includes(FILE_NAME)
        console.log(JSON.stringify({
            contentScriptReport: contentReport,
            pageOriginOpfs: pageOpfs,
            extensionOriginOpfs: extensionOpfs,
            fileInPageOrigin,
            fileInExtensionOrigin
        }, null, 2))
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
