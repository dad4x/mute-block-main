#!/usr/bin/env node

const fs = require('fs')

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

function readPayload() {
    const inline = getOption('json', '')
    const path = getOption('file', '')
    if(inline) return JSON.parse(inline)
    if(path) return JSON.parse(fs.readFileSync(path, 'utf8'))
    throw new Error('missing --json or --file')
}

runMain(async () => {
    const config = getCdpConfig()
    const payload = readPayload()
    const timeoutMs = Math.max(1000, Number.parseInt(getOption('timeout-ms', '60000'), 10) || 60000)
    const contextName = `${getOption('context', 'service-worker') || 'service-worker'}`.trim()
    if(!payload || typeof payload !== 'object' || !payload.action) {
        console.log(JSON.stringify({error: 'payload must be an object with action'}, null, 2))
        process.exitCode = 1
        return
    }

    const targets = await getTargets(config)
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    const target = contextName === 'page' ? extensionPage : serviceWorker
    if(!target) {
        console.log(JSON.stringify({target: false, context: contextName}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `(${function sendExtensionMessage(payload, timeoutMs) {
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

            chrome.runtime.sendMessage(payload, response => finish({
                response: response || null,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
    }})(${JSON.stringify(payload)}, ${JSON.stringify(timeoutMs)})`, timeoutMs + 5000)

    console.log(JSON.stringify({
        context: contextName,
        target: {
            id: target.id,
            type: target.type || '',
            url: target.url || ''
        },
        result
    }, null, 2))
})
