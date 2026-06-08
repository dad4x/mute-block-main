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
    const targets = await getTargets(config)
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
