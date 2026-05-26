#!/usr/bin/env node

const {
    cdpCommand,
    getCdpConfig,
    getJson,
    getTargets,
    runMain,
    sleep
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const versionInfo = await getJson('/json/version', config)
    const scopeURL = `chrome-extension://${config.extensionId}/`
    const results = []

    for(const method of ['ServiceWorker.enable', 'ServiceWorker.startWorker']) {
        try {
            const params = method === 'ServiceWorker.startWorker' ? {scopeURL} : {}
            const result = await cdpCommand(versionInfo.webSocketDebuggerUrl, method, params, 10000)
            results.push({method, ok: true, result})
        }
        catch(error) {
            results.push({method, ok: false, error: error.message})
        }
    }

    await sleep(1500)
    const serviceWorkers = (await getTargets(config))
        .filter(target => target.type === 'service_worker' && (target.url || '').includes(config.extensionId))
        .map(target => ({id: target.id, url: target.url || ''}))
    console.log(JSON.stringify({scopeURL, results, serviceWorkers}, null, 2))
})
