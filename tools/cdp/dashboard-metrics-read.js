#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain,
    sleep
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

    await evaluate(dashboard.webSocketDebuggerUrl, `window.location.hash = '#'`, 10000)
    await sleep(6000)

    const result = await evaluate(dashboard.webSocketDebuggerUrl, `
        (() => {
            const get = id => document.getElementById(id)?.textContent?.trim() ?? null
            return {
                secondsPerBlock: get('secondsPerBlock'),
                secondsPerAlreadyBlocked: get('secondsPerAlreadyBlocked'),
                activationHandoffSeconds: get('activationHandoffSeconds'),
                queuedCount: get('queuedCount'),
                activeCount: get('activeCount'),
                reallyBlockedCount: get('reallyBlockedCount'),
                alreadyBlockedCount: get('alreadyBlockedCount')
            }
        })()
    `, 10000)

    console.log(JSON.stringify(result, null, 2))
})
