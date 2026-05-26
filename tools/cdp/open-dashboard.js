#!/usr/bin/env node

const {
    cdpCommand,
    evaluate,
    getCdpConfig,
    getJson,
    getTargets,
    runMain,
    sleep
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    let targets = await getTargets(config)
    let dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl)

    if(!dashboard) {
        const versionInfo = await getJson('/json/version', config)
        await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
            url: dashboardUrl,
            background: true
        })
        await sleep(1000)
        targets = await getTargets(config)
        dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl)
    }

    if(!dashboard) {
        const versionInfo = await getJson('/json/version', config)
        await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
            url: dashboardUrl
        })
        await sleep(1000)
        targets = await getTargets(config)
        dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl)
    }

    if(!dashboard) {
        console.log(JSON.stringify({opened: false, reason: 'dashboard-target-not-found'}, null, 2))
        process.exitCode = 1
        return
    }

    const version = await evaluate(dashboard.webSocketDebuggerUrl, 'chrome.runtime.getManifest().version')
    console.log(JSON.stringify({
        opened: true,
        id: dashboard.id,
        title: dashboard.title || '',
        url: dashboard.url || '',
        version
    }, null, 2))
})
