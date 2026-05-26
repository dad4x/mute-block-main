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
    const tabId = Number.parseInt(getOption('tab-id', ''), 10)
    const action = `${getOption('action', 'claim') || 'claim'}`.trim()
    if(!tabId) {
        console.log(JSON.stringify({error: 'missing --tab-id'}, null, 2))
        process.exitCode = 1
        return
    }

    const targets = await getTargets(config)
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )

    if(!serviceWorker) {
        console.log(JSON.stringify({serviceWorker: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(serviceWorker.webSocketDebuggerUrl, `(${async function tabActionById(tabId, action) {
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

        const tab = await withTimeout(chrome.tabs.get(tabId), 5000, {
            __timedOut: true,
            __error: 'chrome.tabs.get timed out'
        })
        if(tab?.__timedOut || tab?.__error) {
            return {
                tabId,
                action,
                ok: false,
                timedOut: tab?.__timedOut === true,
                error: tab?.__error || ''
            }
        }

        if(action === 'activate') {
            const updated = await withTimeout(chrome.tabs.update(tabId, {active: true}), 5000, {
                __timedOut: true,
                __error: 'chrome.tabs.update timed out'
            })
            return {
                tabId,
                action,
                ok: !(updated?.__timedOut || updated?.__error),
                timedOut: updated?.__timedOut === true,
                error: updated?.__error || '',
                tab,
                updated: updated?.__error || updated?.__timedOut ? null : updated
            }
        }

        if(action === 'reload') {
            const reloaded = await withTimeout(chrome.tabs.reload(tabId, {bypassCache: false}), 5000, {
                __timedOut: true,
                __error: 'chrome.tabs.reload timed out'
            })
            return {
                tabId,
                action,
                ok: !(reloaded?.__timedOut || reloaded?.__error),
                timedOut: reloaded?.__timedOut === true,
                error: reloaded?.__error || '',
                tab
            }
        }

        const marker = await withTimeout(chrome.scripting.executeScript({
            target: {tabId},
            func: () => ({
                ready: document.documentElement.getAttribute('data-mb-content-script-ready') || '',
                url: location.href,
                title: document.title,
                readyState: document.readyState,
                visibilityState: document.visibilityState,
                bodyText: (document.body?.innerText || '').slice(0, 300)
            })
        }), 7000, {
            __timedOut: true,
            __error: 'chrome.scripting marker timed out'
        })

        const claim = await withTimeout(chrome.scripting.executeScript({
            target: {tabId},
            func: () => new Promise(resolve => {
                chrome.runtime.sendMessage({
                    action: 'claim-tab-action',
                    reason: 'cdp-sw-tab-id-claim'
                }, response => resolve({
                    response: response || null,
                    lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
                }))
            })
        }), 7000, {
            __timedOut: true,
            __error: 'chrome.scripting claim timed out'
        })

        return {
            tabId,
            action,
            ok: true,
            tab,
            marker: marker?.__timedOut || marker?.__error ? marker : marker.map(item => item.result),
            claim: claim?.__timedOut || claim?.__error ? claim : claim.map(item => item.result)
        }
    }})( ${JSON.stringify(tabId)}, ${JSON.stringify(action)} )`, 30000)

    console.log(JSON.stringify(result, null, 2))
})
