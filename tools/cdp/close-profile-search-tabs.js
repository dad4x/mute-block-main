#!/usr/bin/env node

const {
    cdpCommand,
    getCdpConfig,
    getJson,
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
        return [url, target.title || ''].join('\n').toLowerCase().includes(needle)
    }
    catch {
        return false
    }
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_SEARCH_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const versionInfo = await getJson('/json/version', config)
    const matches = targets.filter(target => isProfileSearchTarget(target, needle))
    const closed = []

    for(const target of matches) {
        const result = await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.closeTarget', {
            targetId: target.id
        }, 10000).catch(error => ({error: error?.message || `${error || ''}`}))
        closed.push({
            id: target.id,
            title: target.title || '',
            url: target.url || '',
            closed: result?.success !== false && !result?.error,
            error: result?.error || ''
        })
    }

    console.log(JSON.stringify({
        matched: matches.length,
        closed
    }, null, 2))
})
