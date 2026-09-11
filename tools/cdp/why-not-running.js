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
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const target =
        targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`)) ||
        serviceWorker
    if(!target) {
        console.log(JSON.stringify({target: false, reason: 'extension-target-not-found'}, null, 2))
        process.exitCode = 1
        return
    }

    const response = await evaluate(target.webSocketDebuggerUrl, `(${function whyNotRunning() {
        if(typeof getCoordinatorWhyNotRunning === 'function') {
            return getCoordinatorWhyNotRunning({reason: 'cdp'}).then(result => ({
                response: result || null,
                lastError: ''
            })).catch(error => ({
                response: null,
                lastError: error?.message || String(error || '')
            }))
        }
        return new Promise(resolve => {
            chrome.runtime.sendMessage({
                action: 'get-coordinator-why-not-running',
                reason: 'cdp'
            }, result => resolve({
                response: result || null,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
    }})()`, 30000)

    console.log(JSON.stringify({
        target: {
            id: target.id,
            type: target.type || '',
            url: target.url || ''
        },
        result: response
    }, null, 2))
})
