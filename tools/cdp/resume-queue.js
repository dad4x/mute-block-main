#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const serviceWorker = targets.find(target => target.type === 'service_worker' && target.url.includes(config.extensionId))
    const dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl)
    const target = serviceWorker || dashboard
    if(!target) {
        console.log(JSON.stringify({dashboard: false, serviceWorker: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `new Promise(resolve => {
        const allowDirectServiceWorkerCall = ${JSON.stringify(target === serviceWorker)}
        let settled = false
        const finish = value => {
            if(settled) return
            settled = true
            resolve(value)
        }
        const scheduleAlarmFallback = (lastError = '', options = {}) => {
            if(typeof chrome?.alarms?.create !== 'function') return false

            const schedule = () => {
                const done = () => finish({
                    action: options.clearPause ? 'service-worker-resume-paused-storage-alarm' : 'service-worker-resume-alarm',
                    response: {scheduled: true, clearedPause: !!options.clearPause},
                    lastError
                })
                try {
                    const result = chrome.alarms.create('mb-coordinator-resume', {when: Date.now() + 500})
                    if(result && typeof result.then === 'function') {
                        result.then(done).catch(done)
                    }
                    else {
                        done()
                    }
                }
                catch {
                    done()
                }
            }
            schedule()
            return true
        }
        const sendResumeMessage = action => {
            chrome.runtime.sendMessage({action}, response => {
                const lastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
                if(response || !lastError) {
                    finish({
                        action,
                        response: response || null,
                        lastError
                    })
                    return
                }

                if(scheduleAlarmFallback(lastError, {clearPause: action === 'resume-paused-coordinator-nukes'})) return

                finish({
                    action,
                    response: null,
                    lastError
                })
            })
        }
        const start = paused => {
            const action = paused
                ? 'resume-paused-coordinator-nukes'
                : 'resume-coordinator-queue'
            const fallbackMs = allowDirectServiceWorkerCall ? 65000 : 5000
            setTimeout(() => {
                if(scheduleAlarmFallback('resume message did not receive a callback', {clearPause: paused})) return
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
    })`, 70000)
    console.log(JSON.stringify(result, null, 2))
})
