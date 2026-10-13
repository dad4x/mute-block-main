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
    const dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl)
    if(!dashboard) {
        console.log(JSON.stringify({dashboard: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(dashboard.webSocketDebuggerUrl, `
        (() => {
            const button = document.getElementById('clearAllStatsButton')
            if(!button) return {clicked: false, reason: 'button-not-found'}
            button.click()
            return {clicked: true}
        })()
    `, 15000)

    console.log(JSON.stringify(result, null, 2))
})
