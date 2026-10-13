#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const href = getOption('href', '')
    const targets = await getTargets(config)
    const serviceWorker = targets.find(target => target.type === 'service_worker' && (target.url || '').includes(config.extensionId))
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl)
    const target = serviceWorker || dashboard
    if(!target) {
        console.log(JSON.stringify({target: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `
        (async () => {
            const authority = await loadCoordinatorCurrentAuthorityState({}, {profileHrefs: [${JSON.stringify(href)}]})
            const item = authority?.queue?.[${JSON.stringify(href)}] || null
            const progress = authority?.progress?.[${JSON.stringify(href)}] || null
            return {item, progress}
        })()
    `, 15000)

    console.log(JSON.stringify(result, null, 2))
})
