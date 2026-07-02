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
    const target =
        targets.find(candidate => candidate.type === 'page' && candidate.url === dashboardUrl) ||
        targets.find(candidate => candidate.type === 'service_worker' && (candidate.url || '').includes(config.extensionId))

    if(!target) {
        console.log(JSON.stringify({ok: false, reason: 'extension-target-not-found'}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `new Promise(resolve => {
        if(${JSON.stringify(target.type === 'service_worker')} && typeof cancelCoordinatorCurrentWork === 'function') {
            cancelCoordinatorCurrentWork().then(response => resolve({
                response: response || null,
                lastError: ''
            })).catch(error => resolve({
                response: null,
                lastError: error?.message || String(error || '')
            }))
            return
        }
        chrome.runtime.sendMessage({action: 'cancel-coordinator-current-work'}, response => resolve({
            response: response || null,
            lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
        }))
    })`, 30000)

    const canceled = (Number.parseInt(result?.response?.canceledUrls?.length, 10) || 0) +
        (Number.parseInt(result?.response?.canceledWorkKeys?.length, 10) || 0)

    console.log(JSON.stringify({
        ok: !result?.lastError && !result?.response?.reason,
        target: {
            id: target.id,
            type: target.type || '',
            url: target.url || ''
        },
        canceled,
        result
    }, null, 2))
})
