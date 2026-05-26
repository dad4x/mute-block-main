#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    jsString,
    runMain,
    sleep
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const extensionsPage = targets.find(target => target.url === 'chrome://extensions/')
    if(!extensionsPage) {
        console.log(JSON.stringify({extensionsPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionsPage.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.getExtensionInfo(${jsString(config.extensionId)}, info => {
            const views = info?.views || []
            const worker = views.find(view => view.type === 'EXTENSION_SERVICE_WORKER_BACKGROUND') || null
            if(!worker) {
                resolve({woke: false, reason: 'service-worker-view-not-found', views})
                return
            }

            try {
                chrome.developerPrivate.inspect({
                    extension_id: ${jsString(config.extensionId)},
                    render_process_id: worker.renderProcessId,
                    render_view_id: worker.renderViewId,
                    incognito: worker.incognito === true
                }, () => resolve({
                    woke: !chrome.runtime.lastError,
                    lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : '',
                    worker
                }))
            }
            catch(error) {
                resolve({
                    woke: false,
                    lastError: error?.message || String(error || ''),
                    worker
                })
            }
        })
    })`, 10000)

    await sleep(1500)
    const nextTargets = await getTargets(config)
    result.serviceWorkerTargets = nextTargets
        .filter(target => target.type === 'service_worker' && (target.url || '').includes(config.extensionId))
        .map(target => ({id: target.id, url: target.url || ''}))
    console.log(JSON.stringify(result, null, 2))
})
