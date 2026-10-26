'use strict'

// Firefox cross-check of the worker, election and broadcast checks, driven over
// Marionette. Phases: worker globals, content-script worker origin, owner
// election, and mirror broadcast (steady, late joiner, owner handover). The
// service-worker stop phase from the Chrome run is not repeated: Firefox runs the
// background as an event page, and Marionette has no equivalent of
// ServiceWorker.stopAllWorkers.
//
//   node experiments/firefox-validation/run-validations.js

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const {Marionette} = require('../page-throttle/marionette')

const FIREFOX_BIN = process.env.SPIKE_FIREFOX_BIN || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
const MARIONETTE_PORT = Number(process.env.SPIKE_MARIONETTE_PORT || 2836)
const SITE_PORT = 8768
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext')
const SITE_DIR = path.join(ROOT, 'site')
const PROFILE_DIR = path.join(ROOT, `.profile-${Date.now()}`)
const BURST = {count: 300, intervalMs: 10}

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

async function viewerSummary(session, handle) {
    const state = await session.exec(handle, 'return window.spike.state()')
    return {broadcast: summarise(state.broadcast), storage: summarise(state.storage)}
}

async function phaseWorkerGlobals(session, viewer) {
    return session.execAsync(viewer, `const done = arguments[arguments.length - 1]; window.spike.workerGlobals().then(done, error => done({error: error.message}))`)
}

async function phaseContentWorker(session, site, viewer) {
    const report = await session.waitFor(site, `const value = document.documentElement.getAttribute('data-fv-content'); return value && JSON.parse(value).contentWorker ? value : null`)
    const pageOpfs = await session.execAsync(site, `const done = arguments[arguments.length - 1];
        (async () => {
            const root = await navigator.storage.getDirectory()
            const names = []
            for await (const [name] of root.entries()) names.push(name)
            return {origin: location.origin, names}
        })().then(done, error => done({error: error.message}))`)
    const extensionOpfs = await session.execAsync(viewer, `const done = arguments[arguments.length - 1]; window.spike.readOpfsNames().then(done, error => done({error: error.message}))`)
    const content = JSON.parse(report)
    return {
        contentReport: {
            contentWorker: content.contentWorker,
            broadcastReceived: content.broadcast.length,
            storageReceived: content.storage.length,
            storageListenerError: content.storageListenerError ?? null
        },
        pageOriginOpfs: pageOpfs,
        extensionOriginOpfs: extensionOpfs,
        fileInPageOrigin: Array.isArray(pageOpfs?.names) && pageOpfs.names.includes('probe-from-content-worker.txt'),
        fileInExtensionOrigin: Array.isArray(extensionOpfs?.names) && extensionOpfs.names.includes('probe-from-content-worker.txt')
    }
}

async function phaseElection(session, makeUrl) {
    const holder = await session.openTab(makeUrl('holder'))
    await session.waitFor(holder, 'return window.spike.state().election.acquired || null')
    const waiterA = await session.openTab(makeUrl('waiter'))
    const waiterB = await session.openTab(makeUrl('waiter'))
    await sleep(1500)
    const before = {
        holder: (await session.exec(holder, 'return window.spike.state().election')).acquired,
        waiterA: (await session.exec(waiterA, 'return window.spike.state().election')).acquired,
        waiterB: (await session.exec(waiterB, 'return window.spike.state().election')).acquired
    }
    const closedAt = Date.now()
    await session.close(holder)
    await sleep(3000)
    const afterA = await session.exec(waiterA, 'return window.spike.state().election')
    const afterB = await session.exec(waiterB, 'return window.spike.state().election')
    const acquired = [afterA, afterB].filter(entry => entry.acquired)
    const late = await session.openTab(makeUrl('holder'))
    await sleep(1500)
    const lateState = await session.exec(late, 'return window.spike.state().election')
    return {
        beforeClose: before,
        afterClose: {
            waiterAAcquired: afterA.acquired,
            waiterBAcquired: afterB.acquired,
            exactlyOneWaiterAcquired: acquired.length === 1,
            handoverMs: acquired.length === 1 ? acquired[0].acquiredAt - closedAt : null
        },
        lateHolder: {acquired: lateState.acquired, ifAvailableResult: lateState.ifAvailableResult},
        handles: {waiterA, waiterB, late}
    }
}

// Starts a burst in the page without awaiting it, then polls for its result.
async function startBurst(session, handle, burst) {
    await session.exec(handle, `window.spike.lastBurst = null; window.spike.burst(${JSON.stringify(burst)}).then(result => { window.spike.lastBurst = result }); return true`)
}

async function waitForBurst(session, handle, timeoutMs = 300000) {
    return session.waitFor(handle, 'return window.spike.lastBurst', timeoutMs)
}

async function phaseMirror(session, makeUrl, siteHandle) {
    const owner = await session.openTab(makeUrl('owner'))
    await session.waitFor(owner, 'return window.spike.state().epoch')
    const progress = await session.openTab(makeUrl('viewer'))
    const dashboard = await session.openTab(makeUrl('viewer'))
    await sleep(1500)
    const results = {burst: BURST}

    console.error('mirror: steady')
    await session.focus(owner)
    await startBurst(session, owner, BURST)
    await sleep(500)
    await waitForBurst(session, owner)
    await sleep(1000)
    results.steady = {
        progressViewer: await viewerSummary(session, progress),
        dashboardViewer: await viewerSummary(session, dashboard),
        serviceWorker: await session.execAsync(progress, `const done = arguments[arguments.length - 1]; window.spike.swState().then(done)`),
        contentScript: await session.exec(siteHandle, `const value = document.documentElement.getAttribute('data-fv-content'); if(!value) return null; const report = JSON.parse(value); return {broadcast: report.broadcast.length, storage: report.storage.length}`)
    }

    await session.focus(owner)
    await startBurst(session, owner, BURST)
    await sleep(1000)
    console.error('mirror: late join')
    const late = await session.openTab(makeUrl('viewer'))
    await session.focus(owner)
    await waitForBurst(session, owner)
    await sleep(1000)
    const lateState = await viewerSummary(session, late)
    const mirrorOnJoin = await session.execAsync(late, `const done = arguments[arguments.length - 1]; window.spike.readMirror().then(done)`)
    results.lateJoin = {lateViewer: lateState, mirrorSeqReadOnJoin: mirrorOnJoin.mirrorSeq}

    await session.focus(owner)
    await startBurst(session, owner, {count: 100, intervalMs: 10})
    await sleep(400)
    console.error('mirror: handover')
    await session.close(owner)
    const owner2 = await session.openTab(makeUrl('owner'))
    const newEpoch = await session.waitFor(owner2, 'return window.spike.state().epoch', 30000)
    await session.focus(owner2)
    await startBurst(session, owner2, {count: 100, intervalMs: 10})
    const ownerTwoRange = await waitForBurst(session, owner2)
    await sleep(1000)
    results.ownerHandover = {
        newEpoch,
        ownerTwoRange: {sentFrom: ownerTwoRange.sentFrom, sentTo: ownerTwoRange.sentTo},
        progressViewer: await viewerSummary(session, progress),
        dashboardViewer: await viewerSummary(session, dashboard)
    }
    return results
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
        await marionette.send('WebDriver:SetTimeouts', {script: 600000, pageLoad: 60000})
        const installed = await marionette.send('Addon:Install', {path: EXT_DIR, temporary: true})
        const addonId = unwrap(installed)
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

        console.error('phase: probe')
        const probe = await session.openTab(makeUrl('viewer'))
        await session.waitFor(probe, 'return typeof window.spike')
        results.workerGlobals = await phaseWorkerGlobals(session, probe)

        console.error('phase: content worker')
        const siteHandle = await session.openTab(`http://127.0.0.1:${SITE_PORT}/`)
        results.contentWorker = await phaseContentWorker(session, siteHandle, probe)

        console.error('phase: election')
        const election = await phaseElection(session, makeUrl)
        results.election = {beforeClose: election.beforeClose, afterClose: election.afterClose, lateHolder: election.lateHolder}
        await session.close(election.handles.late).catch(() => {})

        console.error('phase: mirror')
        results.mirror = await phaseMirror(session, makeUrl, siteHandle)
        console.log(JSON.stringify(results, null, 2))
    }
    finally {
        try {
            await marionette.send('WebDriver:DeleteSession', {})
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
