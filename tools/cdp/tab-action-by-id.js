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
    const action = `${getOption('action', 'nudge') || 'nudge'}`.trim()
    if(!tabId) {
        console.log(JSON.stringify({error: 'missing --tab-id'}, null, 2))
        process.exitCode = 1
        return
    }

    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function tabActionById(tabId, action) {
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
        const output = {tabId, action}
        const tabResult = await withTimeout(chrome.tabs.get(tabId), 5000, {
            __timedOut: true,
            __error: 'chrome.tabs.get timed out'
        })
        if(tabResult?.__timedOut || tabResult?.__error) {
            return {
                ...output,
                ok: false,
                timedOut: tabResult?.__timedOut === true,
                error: tabResult?.__error || ''
            }
        }
        output.tab = tabResult

        if(action === 'reload') {
            const reloadResult = await withTimeout(chrome.tabs.reload(tabId, {bypassCache: false}), 5000, {
                __timedOut: true,
                __error: 'chrome.tabs.reload timed out'
            })
            if(reloadResult?.__timedOut || reloadResult?.__error) {
                return {
                    ...output,
                    ok: false,
                    timedOut: reloadResult?.__timedOut === true,
                    error: reloadResult?.__error || ''
                }
            }
            return {...output, ok: true, reloaded: true}
        }

        if(action === 'activate') {
            const activateResult = await withTimeout(
                chrome.tabs.update(tabId, {active: true}),
                5000,
                {
                    __timedOut: true,
                    __error: 'chrome.tabs.update timed out'
                }
            )
            if(activateResult?.__timedOut || activateResult?.__error) {
                return {
                    ...output,
                    ok: false,
                    timedOut: activateResult?.__timedOut === true,
                    error: activateResult?.__error || ''
                }
            }
            return {...output, ok: true, activated: true, updatedTab: activateResult || null}
        }

        const messageResult = await withTimeout(chrome.tabs.sendMessage(tabId, {
            action: 'claim-current-profile-tab-action',
            reason: 'cdp-tab-id-nudge'
        }), 5000, {
            __timedOut: true,
            __error: 'chrome.tabs.sendMessage timed out'
        })
        if(messageResult?.__timedOut || messageResult?.__error) {
            return {
                ...output,
                ok: false,
                timedOut: messageResult?.__timedOut === true,
                error: messageResult?.__error || ''
            }
        }

        return {
            ...output,
            ok: true,
            response: messageResult || null
        }
    }})( ${JSON.stringify(tabId)}, ${JSON.stringify(action)} )`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
