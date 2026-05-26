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
    const needle = getOption('needle', process.env.MB_PROFILE_CLAIM_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function claimTabAction(needle) {
        const tabs = await chrome.tabs.query({url: 'https://www.quora.com/profile/*'})
        const tab = tabs.find(candidate => {
            if(!needle) return true
            return [
                candidate.url || '',
                candidate.title || ''
            ].join('\\n').toLowerCase().includes(needle)
        })

        if(!tab) return {tab: false}

        const marker = await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: () => ({
                ready: document.documentElement.getAttribute('data-mb-content-script-ready') || '',
                url: location.href,
                state: document.readyState
            })
        }).catch(error => [{result: {error: error?.message || `${error || ''}`}}])

        const claim = await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: () => new Promise(resolve => {
                chrome.runtime.sendMessage({action: 'claim-tab-action'}, response => resolve({
                    response: response || null,
                    lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
                }))
            })
        }).catch(error => [{result: {error: error?.message || `${error || ''}`}}])

        return {
            tab: {
                id: tab.id,
                url: tab.url || '',
                status: tab.status || '',
                active: tab.active === true
            },
            marker: marker.map(item => item.result),
            claim: claim.map(item => item.result)
        }
    }})( ${JSON.stringify(needle)} )`, 30000)

    console.log(JSON.stringify(result, null, 2))
})
