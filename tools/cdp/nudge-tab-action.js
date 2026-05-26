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
    const needle = getOption('needle', process.env.MB_PROFILE_NUDGE_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function nudgeProfileAction(needle) {
        const tabs = await chrome.tabs.query({url: 'https://www.quora.com/profile/*'})
        const matched = tabs.filter(tab => {
            if(!needle) return true
            return [tab.url || '', tab.title || ''].join('\\n').toLowerCase().includes(needle)
        })
        const results = []
        for(const tab of matched) {
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'claim-current-profile-tab-action',
                reason: 'cdp-nudge'
            }).then(value => ({
                response: value || null,
                lastError: ''
            })).catch(error => ({
                response: null,
                lastError: error?.message || String(error || '')
            }))
            results.push({
                tabId: tab.id,
                url: tab.url || '',
                active: tab.active === true,
                ...response
            })
        }
        return {matched: matched.length, results}
    }})( ${JSON.stringify(needle)} )`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
