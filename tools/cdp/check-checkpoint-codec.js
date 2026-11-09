#!/usr/bin/env node

const {COORDINATOR_QUEUE_WAL_KEY, STORAGE_LAYOUT_PREFIX} = require('../../shared/js/storageKeys')

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const checkpointId = getOption('checkpoint', 'B')
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl)
    if(!dashboard) {
        console.log(JSON.stringify({dashboard: false}, null, 2))
        process.exitCode = 1
        return
    }

    // The stored name of the checkpoint: the layout prefix plus the plain checkpoint key (storageNamespace.js).
    const key = `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_QUEUE_WAL_KEY}.checkpoint.${checkpointId}`
    const result = await evaluate(dashboard.webSocketDebuggerUrl, `
        new Promise(resolve => {
            chrome.storage.local.get({${JSON.stringify(key)}: null}, stored => {
                const cp = stored[${JSON.stringify(key)}]
                resolve({
                    codec: cp?.codec,
                    encoding: cp?.encoding,
                    hasState: typeof cp?.state !== 'undefined',
                    hasPayload: typeof cp?.payload === 'string',
                    payloadLength: cp?.payload?.length || 0,
                    uncompressedBytes: cp?.uncompressedBytes,
                    compressedBytes: cp?.compressedBytes
                })
            })
        })
    `, 15000)

    console.log(JSON.stringify(result, null, 2))
})
