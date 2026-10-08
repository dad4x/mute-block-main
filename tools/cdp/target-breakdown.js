#!/usr/bin/env node

const {getCdpConfig, getTargets, runMain} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const byType = {}
    for(const t of targets) {
        byType[t.type] = (byType[t.type] || 0) + 1
    }
    const urlCounts = {}
    for(const t of targets) {
        const key = `${t.type}:${(t.url || '').split('?')[0].slice(0, 90)}`
        urlCounts[key] = (urlCounts[key] || 0) + 1
    }
    const sorted = Object.entries(urlCounts).sort((a, b) => b[1] - a[1]).slice(0, 25)
    console.log(JSON.stringify({total: targets.length, byType, topUrls: sorted}, null, 2))
})
