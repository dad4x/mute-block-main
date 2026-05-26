#!/usr/bin/env node

const {
    cdpCommand,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

function isProfilePageTarget(target = {}) {
    return target.type === 'page' && /^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')
}

async function reloadTarget(wsUrl) {
    await cdpCommand(wsUrl, 'Page.enable')
    await cdpCommand(wsUrl, 'Page.reload', {ignoreCache: false})
}

runMain(async () => {
    const needle = getOption('needle', '').toLowerCase()
    const config = getCdpConfig()
    const pages = (await getTargets(config)).filter(target => {
        if(!isProfilePageTarget(target)) return false
        if(!needle) return true
        return [target.url || '', target.title || ''].join('\n').toLowerCase().includes(needle)
    })
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
