#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )
    if(!serviceWorker) {
        console.log(JSON.stringify({serviceWorker: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(serviceWorker.webSocketDebuggerUrl, `(${async function pauseAndCloseProfileTabs() {
        const withTimeout = (promise, timeoutMs, timeoutValue) => new Promise(resolve => {
            let settled = false
            const finish = value => {
                if(settled) return
                settled = true
                resolve(value)
            }
            setTimeout(() => finish(timeoutValue), timeoutMs)
            promise.then(value => finish(value)).catch(error => finish({
                __error: error?.message || String(error || '')
            }))
        })

        const pauseResult = await withTimeout(
            new Promise(resolve => {
                chrome.runtime.sendMessage({action: 'pause-coordinator-nukes'}, response => resolve({
                    response: response || null,
                    lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
                }))
            }),
            15000,
            {__timedOut: true, __error: 'pause message timed out'}
        )

        const tabsResult = await withTimeout(
            new Promise(resolve => {
                chrome.tabs.query({url: 'https://www.quora.com/profile/*'}, tabs => resolve({
                    tabs: Array.isArray(tabs) ? tabs : [],
                    lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
                }))
            }),
            15000,
            {__timedOut: true, __error: 'profile tab query timed out', tabs: []}
        )
        const tabIds = Array.isArray(tabsResult?.tabs)
            ? tabsResult.tabs
                .map(tab => tab && tab.id)
                .filter(id => Number.isInteger(id))
            : []
        const closeResult = tabIds.length
            ? await withTimeout(
                new Promise(resolve => {
                    chrome.tabs.remove(tabIds, () => resolve({
                        closed: chrome.runtime.lastError ? 0 : tabIds.length,
                        lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
                    }))
                }),
                15000,
                {__timedOut: true, __error: 'profile tab close timed out', closed: 0}
            )
            : {closed: 0, lastError: ''}

        return {
            paused: pauseResult?.response?.paused === true,
            pauseTimedOut: pauseResult?.__timedOut === true,
            pauseError: pauseResult?.__error || pauseResult?.lastError || '',
            profileTabsMatched: tabIds.length,
            profileTabsClosed: closeResult?.closed || 0,
            closeTimedOut: closeResult?.__timedOut === true,
            closeError: closeResult?.__error || closeResult?.lastError || tabsResult?.__error || tabsResult?.lastError || '',
            response: pauseResult?.response || null
        }
    }})()`, 30000)

    console.log(JSON.stringify(result, null, 2))
})
