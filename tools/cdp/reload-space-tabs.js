#!/usr/bin/env node

const {cdpCommand, getCdpConfig, getTargets, isSpacePageTarget, runMain} = require('./lib/cdp')

async function reloadTarget(wsUrl) {
    await cdpCommand(wsUrl, 'Page.enable')
    await cdpCommand(wsUrl, 'Page.reload', {ignoreCache: false})
}

runMain(async () => {
    const config = getCdpConfig()
    const pages = (await getTargets(config)).filter(isSpacePageTarget)
    const results = []

    for(const page of pages) {
        try {
            await reloadTarget(page.webSocketDebuggerUrl)
            results.push({id: page.id, title: page.title, url: page.url, reloaded: true})
        }
        catch(error) {
            results.push({id: page.id, title: page.title, url: page.url, reloaded: false, error: error.message})
        }
    }

    console.log(JSON.stringify({count: pages.length, results}, null, 2))
})
