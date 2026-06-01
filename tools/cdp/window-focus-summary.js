#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const targets = await getTargets(config)
    const extensionTarget = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`)) ||
        targets.find(target => target.type === 'service_worker' && (target.url || '').includes(config.extensionId))

    if(!extensionTarget) {
        console.log(JSON.stringify({extensionTarget: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionTarget.webSocketDebuggerUrl, `(${async function summarizeWindows(extensionId) {
        const callChrome = (fn, fallback) => new Promise(resolve => {
            let settled = false
            const finish = value => {
                if(settled) return
                settled = true
                resolve(value)
            }
            setTimeout(() => finish(fallback), 5000)
            try {
                const result = fn(value => finish(value))
                if(result && typeof result.then === 'function') {
                    result.then(finish).catch(() => finish(fallback))
                }
            }
            catch {
                finish(fallback)
            }
        })
        const allWindows = await callChrome(callback => chrome.windows.getAll({populate: true}, callback), [])
        const lastFocused = await callChrome(callback => chrome.windows.getLastFocused({populate: true}, callback), null)
        const profileUrlPattern = /^https:\/\/www\.quora\.com\/profile\//i
        const extensionUrlPrefix = 'chrome-extension://' + extensionId + '/'
        const simplifyTab = tab => ({
            id: tab.id,
            active: tab.active === true,
            highlighted: tab.highlighted === true,
            title: tab.title || '',
            url: tab.url || ''
        })
        const summarizeWindow = win => {
            const tabs = Array.isArray(win?.tabs) ? win.tabs.map(simplifyTab) : []
            return {
                id: win?.id || 0,
                focused: win?.focused === true,
                state: win?.state || '',
                type: win?.type || '',
                activeTab: tabs.find(tab => tab.active) || null,
                profileTabs: tabs.filter(tab => profileUrlPattern.test(tab.url || '')),
                extensionTabs: tabs.filter(tab => (tab.url || '').startsWith(extensionUrlPrefix)),
                tabs
            }
        }

        return {
            lastFocusedWindowId: lastFocused?.id || 0,
            windows: allWindows.map(summarizeWindow)
        }
    }})( ${JSON.stringify(config.extensionId)} )`, 30000)

    console.log(JSON.stringify(result, null, 2))
})
