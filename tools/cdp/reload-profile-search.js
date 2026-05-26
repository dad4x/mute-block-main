#!/usr/bin/env node

const {
    cdpCommand,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

function isProfileSearchTarget(target, needle) {
    if(target.type !== 'page') return false
    const url = target.url || ''
    if(!/^https:\/\/www\.quora\.com\/search\?/i.test(url)) return false
    try {
        const parsed = new URL(url)
        if((parsed.searchParams.get('type') || '').toLowerCase() !== 'profile') return false
        if(!needle) return true
        return url.toLowerCase().includes(needle)
    }
    catch {
        return false
    }
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_SEARCH_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const target = targets.find(candidate => isProfileSearchTarget(candidate, needle))

    if(!target) {
        console.log(JSON.stringify({
            ok: false,
            reason: 'profile-search-target-not-found',
            needle
        }, null, 2))
        process.exitCode = 1
        return
    }

    await cdpCommand(target.webSocketDebuggerUrl, 'Page.reload', {ignoreCache: true}, 10000)
    console.log(JSON.stringify({
        ok: true,
        reloaded: true,
        target: {
            id: target.id,
            title: target.title || '',
            url: target.url || ''
        }
    }, null, 2))
})
