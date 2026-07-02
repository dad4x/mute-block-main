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
    const limit = Number.parseInt(getOption('limit', process.env.MB_FLIGHT_RECORDER_LIMIT || '100'), 10) || 100
    const kind = getOption('kind', process.env.MB_FLIGHT_RECORDER_KIND || '')
    const rowKey = getOption('row-key', process.env.MB_FLIGHT_RECORDER_ROW_KEY || '')
    const targetUrl = getOption('target-url', process.env.MB_FLIGHT_RECORDER_TARGET_URL || '')
    const timeoutMs = Math.max(1000, Number.parseInt(getOption('timeout-ms', '10000'), 10) || 10000)
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    if(extensionPage) {
        const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${function readFlightRecorderViaMessage(request, timeoutMs) {
            return new Promise(resolve => {
                let settled = false
                const finish = value => {
                    if(settled) return
                    settled = true
                    resolve(value)
                }
                setTimeout(() => finish({
                    readOnly: true,
                    error: 'flight-recorder-message-timeout',
                    entries: []
                }), timeoutMs)
                chrome.runtime.sendMessage({
                    action: 'get-flight-recorder',
                    ...request
                }, response => finish(response || {
                    readOnly: true,
                    error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'flight-recorder-empty-response',
                    entries: []
                }))
            })
        }})(${JSON.stringify({limit, kind, rowKey, targetUrl})}, ${JSON.stringify(timeoutMs)})`, timeoutMs + 5000)

        console.log(JSON.stringify({
            target: {
                id: extensionPage.id,
                type: extensionPage.type || '',
                url: extensionPage.url || ''
            },
            result
        }, null, 2))
        return
    }

    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )

    if(!serviceWorker) {
        console.log(JSON.stringify({serviceWorker: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(serviceWorker.webSocketDebuggerUrl, `(${function readFlightRecorder(request) {
        const getSnapshot = globalThis.getFlightRecorderSnapshot
        if(typeof getSnapshot !== 'function') {
            return {readOnly: true, error: 'flight-recorder-unavailable', entries: []}
        }
        return getSnapshot(request)
    }})(${JSON.stringify({limit, kind, rowKey, targetUrl})})`, 10000)

    console.log(JSON.stringify({
        target: {
            id: serviceWorker.id,
            type: serviceWorker.type || '',
            url: serviceWorker.url || ''
        },
        result
    }, null, 2))
})
