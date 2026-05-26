#!/usr/bin/env node

const {
    cdpCommand,
    getCdpConfig,
    getJson,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const versionInfo = await getJson('/json/version', config)
    const targets = await getTargets(config)
    const pages = targets.filter(target =>
        target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`)
    )
    const results = []

    for(const page of pages) {
        try {
            await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.closeTarget', {
                targetId: page.id
            }, 10000)
            results.push({id: page.id, url: page.url || '', closed: true})
        }
        catch(error) {
            results.push({id: page.id, url: page.url || '', closed: false, error: error.message})
        }
    }

    console.log(JSON.stringify({count: pages.length, results}, null, 2))
})
