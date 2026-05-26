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
            chrome.storage.local.set({mbCoordinatorPaused: true}),
            10000,
            {__timedOut: true, __error: 'storage pause timed out'}
        )
        const tabs = await withTimeout(
            chrome.tabs.query({url: 'https://www.quora.com/profile/*'}),
            10000,
            {__timedOut: true, __error: 'tab query timed out'}
        )
        const closed = []
        if(Array.isArray(tabs)) {
            for(const tab of tabs) {
                const removed = await withTimeout(
                    chrome.tabs.remove(tab.id),
                    5000,
                    {__timedOut: true, __error: 'tab remove timed out'}
                )
                closed.push({
                    id: tab.id,
                    title: tab.title || '',
                    url: tab.url || '',
                    ok: !(removed?.__timedOut || removed?.__error),
                    timedOut: removed?.__timedOut === true,
                    error: removed?.__error || ''
                })
            }
        }

        return {
            paused: !(pauseResult?.__timedOut || pauseResult?.__error),
            pauseTimedOut: pauseResult?.__timedOut === true,
            pauseError: pauseResult?.__error || '',
            tabQueryTimedOut: tabs?.__timedOut === true,
            tabQueryError: tabs?.__error || '',
            tabCount: Array.isArray(tabs) ? tabs.length : 0,
            closed
        }
    }})()`, 30000)

    console.log(JSON.stringify(result, null, 2))
})
