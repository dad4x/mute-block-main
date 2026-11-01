'use strict'

// Firefox cross-check of the throttling probe, driven over Marionette. Same probe
// page as Chrome (main-thread timer and dedicated-worker timer). Two modes:
//
//   node experiments/page-throttle/run-firefox.js short [phaseSeconds]
//   node experiments/page-throttle/run-firefox.js long [durationSeconds] [sampleSeconds]
//
// 'short' mirrors run-cdp.js (four phases, foreground and background each way).
// 'long' mirrors run-long.js (one foreground tab, one hidden tab, CSV samples).
// Uses a dedicated profile and a dedicated Marionette port. Never touches the
// user's Firefox.

const {spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const {Marionette} = require('./marionette')

const FIREFOX_BIN = process.env.SPIKE_FIREFOX_BIN || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
const MARIONETTE_PORT = Number(process.env.SPIKE_MARIONETTE_PORT || 2829)
const ROOT = __dirname
const EXT_DIR = path.join(ROOT, 'ext-firefox')
const PROFILE_DIR = path.join(ROOT, `.profile-firefox-${Date.now()}`)
const MODE = process.argv[2] || 'short'
const CSV_PATH = path.join(ROOT, 'long-run-firefox.csv')
const SUMMARY_PATH = path.join(ROOT, 'long-run-firefox-summary.json')

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
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

function unwrap(response) {
    return response && typeof response === 'object' && 'value' in response ? response.value : response
}

async function executeInTab(marionette, handle, script) {
    await marionette.send('WebDriver:SwitchToWindow', {handle, focus: false})
    return unwrap(await marionette.send('WebDriver:ExecuteScript', {script, args: []}))
}

async function stats(marionette, handle) {
    return executeInTab(marionette, handle, 'return window.spike.stats()')
}

function rates(start, end) {
    const seconds = (end.pageElapsedMs - start.pageElapsedMs) / 1000
    const workerSeconds = (end.workerElapsedMs - start.workerElapsedMs) / 1000
    return {
        windowSeconds: Number(seconds.toFixed(1)),
        visibilityAtEnd: end.visibility,
        pageTicksPerSecond: Number(((end.pageTicks - start.pageTicks) / seconds).toFixed(2)),
        workerTicksPerSecond: Number(((end.workerTicks - start.workerTicks) / workerSeconds).toFixed(2)),
        workerTicksAtEnd: end.workerTicks,
        workerError: end.workerError ?? null
    }
}

async function measure(marionette, handle, seconds) {
    const start = await stats(marionette, handle)
    await sleep(seconds * 1000)
    const end = await stats(marionette, handle)
    return rates(start, end)
}

async function startProbeTab(marionette, uuid, handle) {
    await marionette.send('WebDriver:SwitchToWindow', {handle, focus: false})
    await marionette.send('WebDriver:Navigate', {url: `moz-extension://${uuid}/page.html`})
    const deadline = Date.now() + 15000
    while(Date.now() < deadline) {
        const ready = await executeInTab(marionette, handle, 'return typeof window.spike').catch(() => null)
        if(ready === 'object') return
        await sleep(250)
    }
    throw new Error(`probe page never loaded in ${handle}`)
}

async function openTabs(marionette, uuid) {
    const [initial] = unwrap(await marionette.send('WebDriver:GetWindowHandles', {}))
    const created = await marionette.send('WebDriver:NewWindow', {type: 'tab'})
    const second = created.handle
    await startProbeTab(marionette, uuid, initial)
    await startProbeTab(marionette, uuid, second)
    return {first: initial, second}
}

async function runShort(marionette, uuid, phaseSeconds) {
    const {first, second} = await openTabs(marionette, uuid)
    const results = {phaseSeconds}
    await marionette.send('WebDriver:SwitchToWindow', {handle: first, focus: true})
    await sleep(1000)
    results.firstForeground = await measure(marionette, first, phaseSeconds)
    results.secondBackground = await measure(marionette, second, phaseSeconds)
    await marionette.send('WebDriver:SwitchToWindow', {handle: second, focus: true})
    await sleep(1000)
    results.secondForeground = await measure(marionette, second, phaseSeconds)
    results.firstBackground = await measure(marionette, first, phaseSeconds)
    return results
}

async function runLong(marionette, uuid, durationSeconds, sampleSeconds) {
    const {first, second} = await openTabs(marionette, uuid)
    fs.writeFileSync(CSV_PATH, 't_seconds,fg_visibility,fg_page_ticks,fg_worker_ticks,bg_visibility,bg_page_ticks,bg_worker_ticks\n')
    await marionette.send('WebDriver:SwitchToWindow', {handle: first, focus: true})
    await sleep(2000)
    const samples = []
    const startedAt = Date.now()
    while(true) {
        const t = (Date.now() - startedAt) / 1000
        const fgStats = await stats(marionette, first)
        const bgStats = await stats(marionette, second)
        samples.push({t, fg: fgStats, bg: bgStats})
        fs.appendFileSync(CSV_PATH, [
            t.toFixed(1),
            fgStats.visibility, fgStats.pageTicks, fgStats.workerTicks,
            bgStats.visibility, bgStats.pageTicks, bgStats.workerTicks
        ].join(',') + '\n')
        if(t >= durationSeconds) break
        await sleep(sampleSeconds * 1000)
    }
    return {durationSeconds, sampleSeconds, samples: samples.length, segments: summariseSegments(samples)}
}

function summariseSegments(samples) {
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
            fgVisibility: to.fg.visibility,
            bgVisibility: to.bg.visibility
        })
        start = end
    }
    return segments
}

async function main() {
    writeProfile()
    spawn(FIREFOX_BIN, ['-marionette', '-remote-allow-system-access', '-profile', PROFILE_DIR, '-no-remote', 'about:blank'], {
        detached: true,
        stdio: 'ignore'
    }).unref()
    const marionette = new Marionette(MARIONETTE_PORT)
    await marionette.connect()
    try {
        await marionette.send('WebDriver:NewSession', {capabilities: {}})
        const install = await marionette.send('Addon:Install', {path: EXT_DIR, temporary: true})
        console.error(`Addon:Install response ${JSON.stringify(install)}`)
        const addonId = typeof install === 'string'
            ? install
            : (install?.value?.id ?? install?.id ?? install?.value ?? install?.addon)
        await marionette.send('Marionette:SetContext', {value: 'chrome'})
        const uuid = unwrap(await marionette.send('WebDriver:ExecuteScript', {
            script: 'const policy = WebExtensionPolicy.getByID(arguments[0]); return policy ? policy.mozExtensionHostname : null',
            args: [addonId]
        }))
        await marionette.send('Marionette:SetContext', {value: 'content'})
        if(!uuid) throw new Error(`no extension policy for ${addonId}`)

        const results = {mode: MODE, addonId, extensionUuid: uuid}
        if(MODE === 'short') {
            const phaseSeconds = Number(process.argv[3] || 15)
            Object.assign(results, await runShort(marionette, uuid, phaseSeconds))
            console.log(JSON.stringify(results, null, 2))
        }
        else if(MODE === 'long') {
            const durationSeconds = Number(process.argv[3] || 1800)
            const sampleSeconds = Number(process.argv[4] || 10)
            const long = await runLong(marionette, uuid, durationSeconds, sampleSeconds)
            fs.writeFileSync(SUMMARY_PATH, JSON.stringify(long, null, 2))
            console.log(JSON.stringify({...results, ...long}, null, 2))
        }
        else {
            throw new Error(`unknown mode ${MODE}`)
        }
    }
    finally {
        try {
            await marionette.send('WebDriver:DeleteSession', {})
        }
        catch {}
        marionette.close()
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
