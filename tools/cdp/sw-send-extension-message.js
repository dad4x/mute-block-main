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
    const action = getOption('action', '')
    const timeoutMs = Math.max(1000, Number.parseInt(getOption('timeout-ms', '30000'), 10) || 30000)
    if(!action) {
        console.log(JSON.stringify({error: 'missing --action'}, null, 2))
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

    const result = await evaluate(serviceWorker.webSocketDebuggerUrl, `(${function sendExtensionMessage(action, timeoutMs) {
        return new Promise(resolve => {
            const startedAt = Date.now()
            let settled = false
            const finish = value => {
                if(settled) return
                settled = true
                resolve({
                    elapsedMs: Date.now() - startedAt,
                    ...value
                })
            }

            setTimeout(() => finish({
                response: null,
                timedOut: true,
                lastError: ''
            }), timeoutMs)

            chrome.runtime.sendMessage({action}, response => finish({
                response: response || null,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
    }})(${JSON.stringify(action)}, ${JSON.stringify(timeoutMs)})`, timeoutMs + 5000)

    console.log(JSON.stringify(result, null, 2))
})
