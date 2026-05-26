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
    const needle = getOption('needle', process.env.MB_PROFILE_INJECT_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function injectContentScript(needle) {
        const tabs = await chrome.tabs.query({})
        const profileTabs = tabs.filter(tab => {
            if(!`${tab.url || ''}`.toLowerCase().startsWith('https://www.quora.com/profile/')) return false
            if(!needle) return true
            return [tab.url || '', tab.title || ''].join('\\n').toLowerCase().includes(needle)
        })
        const results = []

        for(const tab of profileTabs) {
            try {
                await chrome.scripting.insertCSS({
                    target: {tabId: tab.id},
                    files: ['css/content.css']
                }).catch(() => null)
                await chrome.scripting.executeScript({
                    target: {tabId: tab.id},
                    files: ['js/content.js']
                })
                results.push({tabId: tab.id, url: tab.url || '', injected: true})
            }
            catch(error) {
                results.push({tabId: tab.id, url: tab.url || '', injected: false, error: error?.message || `${error || ''}`})
            }
        }

        return {matched: profileTabs.length, results}
    }})( ${JSON.stringify(needle)} )`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
