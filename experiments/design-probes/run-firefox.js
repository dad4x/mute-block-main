'use strict'

// Firefox design probes over Marionette: content-script storage capability,
// content-to-owner routing, startup handoff, multi-key atomicity, and tab calls
// from a hidden owner. Owner-lifetime freezing and service-worker termination
// cannot be driven through Marionette in Firefox, so they are not run here.
//
//   node experiments/design-probes/run-firefox.js

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const {Marionette} = require('../page-throttle/marionette')

const FIREFOX_BIN = process.env.SPIKE_FIREFOX_BIN || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
const MARIONETTE_PORT = Number(process.env.SPIKE_MARIONETTE_PORT || (2900 + (Date.now() % 90)))
const SITE_PORT = 8770
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext-firefox')
const SITE_DIR = path.join(ROOT, 'site')
const PROFILE_DIR = path.join(ROOT, `.profile-firefox-${Date.now()}`)

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function unwrap(response) {
    return response && typeof response === 'object' && 'value' in response ? response.value : response
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

function writeProfile() {
    fs.mkdirSync(PROFILE_DIR, {recursive: true})
    fs.writeFileSync(path.join(PROFILE_DIR, 'user.js'), [
        `user_pref("marionette.port", ${MARIONETTE_PORT});`,
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.aboutwelcome.enabled", false);',
        'user_pref("datareporting.policy.dismissedNotification", true);',
        'user_pref("browser.tabs.warnOnClose", false);',
        'user_pref("browser.startup.homepage_welcome_url", "about:blank");',
        ''
    ].join('\n'))
}

class Session {
    constructor(marionette) {
        this.marionette = marionette
    }

    async focus(handle) {
        await this.marionette.send('WebDriver:SwitchToWindow', {handle, focus: true})
    }

    async select(handle) {
        await this.marionette.send('WebDriver:SwitchToWindow', {handle, focus: false})
    }

    async exec(handle, script) {
        await this.select(handle)
        return unwrap(await this.marionette.send('WebDriver:ExecuteScript', {script, args: []}))
    }

    async execAsync(handle, script) {
        await this.select(handle)
        return unwrap(await this.marionette.send('WebDriver:ExecuteAsyncScript', {script, args: []}))
    }

    async close(handle) {
        await this.select(handle)
        const remaining = unwrap(await this.marionette.send('WebDriver:CloseWindow', {}))
        if(Array.isArray(remaining) && remaining.length) await this.select(remaining[0])
    }

    async openTab(url) {
        const created = await this.marionette.send('WebDriver:NewWindow', {type: 'tab'})
        await this.select(created.handle)
        await this.marionette.send('WebDriver:Navigate', {url})
        return created.handle
    }

    async waitFor(handle, expression, timeoutMs = 20000) {
        const deadline = Date.now() + timeoutMs
        while(Date.now() < deadline) {
            const value = await this.exec(handle, expression).catch(() => null)
            if(value) return value
            await sleep(250)
        }
        throw new Error(`timed out waiting for: ${expression}`)
    }
}

async function runCapabilities(session, site, owner) {
    await session.execAsync(owner, `const done = arguments[arguments.length - 1]; chrome.storage.session.set({probeKey: 'from-extension-page'}).then(() => done(true))`)
    const caps = await session.waitFor(site, `return document.documentElement.getAttribute('data-mb-caps')`)
    await session.execAsync(owner, `const done = arguments[arguments.length - 1]; chrome.storage.session.set({probeKey: 'changed-later'}).then(() => done(true))`)
    await sleep(1000)
    const changes = await session.exec(site, `return document.documentElement.getAttribute('data-mb-caps-changes')`)
    const listenError = await session.exec(site, `return document.documentElement.getAttribute('data-mb-caps-listen-error')`)
    return {contentCapabilities: JSON.parse(caps), contentSessionChangeEvents: changes === null ? 0 : Number(changes), contentListenError: listenError}
}

async function runRouting(session, site, makeUrl, initialOwner) {
    const dispatch = id => session.exec(site, `document.dispatchEvent(new CustomEvent('mb-request', {detail: {id: '${id}'}})); return true`)
    const result = id => session.exec(site, `return (() => { const value = document.documentElement.getAttribute('data-mb-result'); const all = value ? JSON.parse(value) : {}; return all['${id}'] || null })()`)
    const waitResult = async (id) => {
        const deadline = Date.now() + 45000
        while(Date.now() < deadline) {
            const value = await result(id)
            if(value) return value
            await sleep(200)
        }
        return {ok: false, timedOut: true, lastEvent: await session.exec(site, 'return document.documentElement.getAttribute("data-mb-event")'), raw: await session.exec(site, 'return document.documentElement.getAttribute("data-mb-result")')}
    }
    const ownerReady = async () => {
        const handle = await session.openTab(makeUrl('owner'))
        await session.waitFor(handle, 'return window.spike.state().ownerAcquired || null')
        return handle
    }

    const outcomes = {}
    await session.close(initialOwner)
    await sleep(500)
    let owner = await ownerReady()
    await dispatch('present')
    outcomes.ownerPresent = await waitResult('present')

    await session.close(owner)
    await sleep(500)
    await dispatch('absentThenStart')
    await sleep(1500)
    owner = await ownerReady()
    outcomes.ownerAbsentThenStart = await waitResult('absentThenStart')

    await session.exec(owner, 'window.spike.setReplyDelay(1500); return true')
    await dispatch('restartInFlight')
    await sleep(300)
    await session.close(owner)
    await sleep(1000)
    owner = await ownerReady()
    outcomes.ownerRestartInFlight = await waitResult('restartInFlight')
    await session.close(owner)
    return outcomes
}

async function runHandoff(session, owner, repetitions) {
    await session.execAsync(owner, `const done = arguments[arguments.length - 1]; window.spike.seedHandoff().then(() => done(true))`)
    const rows = []
    for(let index = 0; index < repetitions; index += 1) {
        rows.push(await session.execAsync(owner, `const done = arguments[arguments.length - 1]; window.spike.handoffCopy().then(done)`))
    }
    const median = field => {
        const values = rows.map(row => row[field]).sort((a, b) => a - b)
        return Number(values[Math.floor(values.length / 2)].toFixed(2))
    }
    return {keys: rows[0].keys, bytes: rows[0].bytes, records: rows[0].records, repetitions, readMsMedian: median('readMs'), copyAndReplayMsMedian: median('copyAndReplayMs'), workerReplayMsMedian: median('workerReplayMs')}
}

async function runAtomic(session, owner, iterations) {
    return session.execAsync(owner, `const done = arguments[arguments.length - 1]; window.spike.atomicProbe(${iterations}).then(done)`)
}

async function runTabs(session, owner, focusedHandle, decoyHandle, iterations) {
    await session.focus(focusedHandle)
    await sleep(800)
    const focused = await session.execAsync(owner, `const done = arguments[arguments.length - 1]; window.spike.tabTiming(${iterations}).then(done)`)
    await session.focus(decoyHandle)
    await sleep(1000)
    const hidden = await session.execAsync(owner, `const done = arguments[arguments.length - 1]; window.spike.tabTiming(${iterations}).then(done)`)
    return {focused, hidden}
}

async function main() {
    const site = await serveSite()
    writeProfile()
    spawn(FIREFOX_BIN, ['-marionette', '-remote-allow-system-access', '-profile', PROFILE_DIR, '-no-remote', 'about:blank'], {
        detached: true,
        stdio: 'ignore'
    }).unref()
    const marionette = new Marionette(MARIONETTE_PORT)
    await marionette.connect()
    const results = {}
    try {
        await marionette.send('WebDriver:NewSession', {capabilities: {}})
        await marionette.send('WebDriver:SetTimeouts', {script: 900000, pageLoad: 60000})
        const addonId = unwrap(await marionette.send('Addon:Install', {path: EXT_DIR, temporary: true}))
        await marionette.send('Marionette:SetContext', {value: 'chrome'})
        const uuid = unwrap(await marionette.send('WebDriver:ExecuteScript', {
            script: 'const policy = WebExtensionPolicy.getByID(arguments[0]); return policy ? policy.mozExtensionHostname : null',
            args: [addonId]
        }))
        await marionette.send('Marionette:SetContext', {value: 'content'})
        if(!uuid) throw new Error(`no extension policy for ${addonId}`)
        results.addonId = addonId
        results.extensionUuid = uuid

        const session = new Session(marionette)
        const makeUrl = role => `moz-extension://${uuid}/page.html?role=${role}`

        const owner = await session.openTab(makeUrl('owner'))
        await session.waitFor(owner, 'return window.spike.state().ownerAcquired || null')
        const siteHandle = await session.openTab(`http://127.0.0.1:${SITE_PORT}/`)

        await sleep(2000)
        console.error(`site: ${await session.exec(siteHandle, 'return location.href + " attrs=" + document.documentElement.getAttributeNames().join(",")')}`)
        console.error('phase: capabilities')
        results.capabilities = await runCapabilities(session, siteHandle, owner)
        console.error('phase: routing')
        results.routing = await runRouting(session, siteHandle, makeUrl, owner)

        const handoffOwner = await session.openTab(makeUrl('owner'))
        await session.waitFor(handoffOwner, 'return window.spike.state().ownerAcquired || null')
        console.error('phase: handoff')
        results.handoff = await runHandoff(session, handoffOwner, 10)
        results.atomic = await runAtomic(session, handoffOwner, 200)

        const decoy = await session.openTab('about:blank')
        console.error('phase: tabs')
        results.tabs = await runTabs(session, handoffOwner, handoffOwner, decoy, 20)

        console.log(JSON.stringify(results, null, 2))
    }
    finally {
        try {
            await marionette.send('Marionette:Quit', {flags: ['eForceQuit']})
        }
        catch {}
        marionette.close()
        site.close()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
