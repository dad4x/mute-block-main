#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const extensionPrefix = `chrome-extension://${config.extensionId}/`
    const dashboardUrl = `${extensionPrefix}coordinator.html`
    const targets = await getTargets(config)
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(extensionPrefix))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function readQueueAccounting() {
        return chrome.runtime.sendMessage({
            action: 'get-coordinator-queue-accounting',
            reason: 'cdp-audit'
        })
    }})()`, 30000)

    console.log(JSON.stringify({
        extensionPage: true,
        target: {
            id: extensionPage.id,
            title: extensionPage.title || '',
            url: extensionPage.url || ''
        },
        accounting: result
    }, null, 2))
})
