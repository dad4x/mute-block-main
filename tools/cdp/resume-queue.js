#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    sleep,
    runMain
} = require('./lib/cdp')

const MAX_ATTEMPTS = 4
const RETRY_DELAY_MS = 1500

async function readPausedFlag(config) {
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const target = targets.find(candidate => candidate.type === 'page' && candidate.url === dashboardUrl) ||
        targets.find(candidate => candidate.type === 'service_worker' && (candidate.url || '').includes(config.extensionId))
    if(!target) return null

    return evaluate(target.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.storage.local.get({mbCoordinatorPaused: false}, stored => resolve(!!stored?.mbCoordinatorPaused))
    })`, 15000).catch(() => null)
}

async function attemptResume(config) {
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const serviceWorker = targets.find(target => target.type === 'service_worker' && target.url.includes(config.extensionId))
    const dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl)
    const target = serviceWorker || dashboard
    if(!target) {
        return {dashboard: !!dashboard, serviceWorker: !!serviceWorker, ok: false}
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `new Promise(resolve => {
        const allowDirectServiceWorkerCall = ${JSON.stringify(target === serviceWorker)}
        let settled = false
        const finish = value => {
            if(settled) return
            settled = true
            resolve(value)
        }
        const sendResumeMessage = action => {
            chrome.runtime.sendMessage({action}, response => {
                const lastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
                finish({
                    action,
                    response: response || null,
                    lastError
                })
            })
        }
        const start = paused => {
            const action = paused
                ? 'resume-paused-coordinator-nukes'
                : 'resume-coordinator-queue'
            const fallbackMs = allowDirectServiceWorkerCall ? 20000 : 8000
            setTimeout(() => {
                finish({
                    action,
                    response: null,
                    timedOut: true,
                    lastError: ''
                })
            }, fallbackMs)
            if(allowDirectServiceWorkerCall && paused && typeof resumePausedCoordinatorNukes === 'function') {
                resumePausedCoordinatorNukes().then(response => finish({
                    action: 'service-worker-resume-paused',
                    response: response || null,
                    lastError: ''
                })).catch(error => finish({
                    action: 'service-worker-resume-paused',
                    response: null,
                    lastError: error?.message || String(error || '')
                }))
                return
            }
            if(allowDirectServiceWorkerCall && !paused && typeof runCoordinatorQueueExecutorFastPath === 'function') {
                runCoordinatorQueueExecutorFastPath('cdp-resume-queue', {
                    awaitFill: true
                }).then(response => finish({
                    action: 'service-worker-fast-resume',
                    response: response || null,
                    lastError: ''
                })).catch(error => finish({
                    action: 'service-worker-fast-resume',
                    response: null,
                    lastError: error?.message || String(error || '')
                }))
                return
            }
            if(allowDirectServiceWorkerCall && !paused && typeof resumeCoordinatorQueueExecution === 'function') {
                resumeCoordinatorQueueExecution({
                    tabId: 'service-worker-queue-owner',
                    windowId: null
                }, {
                    skipAuthorityReconcile: true,
                    serviceWorkerOwned: true
                }).then(response => finish({
                    action: 'service-worker-direct-resume',
                    response: response || null,
                    lastError: ''
                })).catch(error => finish({
                    action: 'service-worker-direct-resume',
                    response: null,
                    lastError: error?.message || String(error || '')
                }))
                return
            }
            if(typeof chrome?.runtime?.sendMessage === 'function') {
                sendResumeMessage(action)
                return
            }
            finish({
                action,
                response: null,
                lastError: 'chrome.runtime.sendMessage unavailable'
            })
        }
        const readPaused = () => {
            if(typeof chrome?.storage?.local?.get !== 'function') {
                start(false)
                return
            }
            try {
                const result = chrome.storage.local.get({mbCoordinatorPaused: false}, stored => {
                    start(!!stored?.mbCoordinatorPaused)
                })
                if(result && typeof result.then === 'function') {
                    result.then(stored => start(!!stored?.mbCoordinatorPaused)).catch(() => start(false))
                }
            }
            catch {
                start(false)
            }
        }
        readPaused()
            return
    })`, 25000)

    return {...result, ok: true}
}

runMain(async () => {
    const config = getCdpConfig()

    // resumePausedCoordinatorNukes()/resume-coordinator-queue both go
    // through the same "click Resume in the dashboard" code path when
    // called directly against a live service worker, but under load the
    // service worker can go idle again between our attempt and its
    // response (a plain content-script/page-side chrome.runtime.sendMessage
    // has no reliable way to force it to stay awake). Rather than trust the
    // browser-side script's own optimistic response -- it previously
    // reported clearedPause:true from a raw chrome.alarms.create() fallback
    // that bypasses the service worker's own alarm-staleness bookkeeping in
    // swSchedulerAlarmBookkeeping.js and can be silently suppressed as a
    // stale alarm -- verify the persisted mbCoordinatorPaused flag directly
    // after each attempt and retry with fresh target discovery (the service
    // worker may have gone from asleep to awake, or vice versa, between
    // attempts) until it's actually confirmed cleared.
    let lastResult = null
    for(let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        lastResult = await attemptResume(config).catch(error => ({
            ok: false,
            error: error?.message || String(error || '')
        }))

        await sleep(500)
        const stillPaused = await readPausedFlag(config)
        if(stillPaused === false) {
            console.log(JSON.stringify({...lastResult, verifiedPaused: false, attempts: attempt}, null, 2))
            return
        }

        if(attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS)
    }

    console.log(JSON.stringify({...lastResult, verifiedPaused: true, attempts: MAX_ATTEMPTS}, null, 2))
    process.exitCode = 1
})
