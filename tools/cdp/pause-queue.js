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
    const dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!dashboard) {
        console.log(JSON.stringify({dashboard: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(dashboard.webSocketDebuggerUrl, `new Promise(resolve => {
        let settled = false
        const finish = value => {
            if(settled) return
            settled = true
            resolve(value)
        }
        setTimeout(() => finish({
            action: 'pause-coordinator-nukes',
            response: null,
            timedOut: true,
            lastError: 'pause message did not receive a callback'
        }), 5000)
        chrome.runtime.sendMessage({action: 'pause-coordinator-nukes'}, response => finish({
            action: 'pause-coordinator-nukes',
            response: response || null,
            lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
        }))
    })`, 15000)

    console.log(JSON.stringify(result, null, 2))
})
