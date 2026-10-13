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
    const query = getOption('query', '')
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
            const text = document.body.innerText
            const needle = ${JSON.stringify(query)}.toLowerCase()
            const idx = text.toLowerCase().indexOf(needle)
            if(idx === -1) return {found: false}
            return {found: true, context: text.slice(Math.max(0, idx - 300), idx + 300)}
        })()
    `, 15000)

    console.log(JSON.stringify(result, null, 2))
})
