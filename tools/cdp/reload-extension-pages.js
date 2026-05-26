#!/usr/bin/env node

const {
    cdpCommand,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const pages = (await getTargets(config)).filter(target =>
        target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`)
    )
    const results = []

    for(const page of pages) {
        try {
            await cdpCommand(page.webSocketDebuggerUrl, 'Page.enable')
            await cdpCommand(page.webSocketDebuggerUrl, 'Page.reload', {ignoreCache: true})
            results.push({id: page.id, url: page.url || '', reloaded: true})
        }
        catch(error) {
            results.push({id: page.id, url: page.url || '', reloaded: false, error: error.message})
        }
    }

    console.log(JSON.stringify({count: pages.length, results}, null, 2))
})
