#!/usr/bin/env node

const {
    cdpGet,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_PROFILE_CLOSE_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const profilePages = targets.filter(target => {
        if(target.type !== 'page') return false
        if(!/^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')) return false
        if(!needle) return true
        return `${target.url || ''}\n${target.title || ''}`.toLowerCase().includes(needle)
    })
    const results = []
    for(const target of profilePages) {
        try {
            const response = await cdpGet(`/json/close/${target.id}`, config, 1500)
            results.push({id: target.id, url: target.url || '', closed: /closing|closed/i.test(response), response})
        }
        catch(error) {
            results.push({id: target.id, url: target.url || '', closed: false, error: error.message})
        }
    }
    console.log(JSON.stringify({requested: profilePages.length, results}, null, 2))
})
