#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    jsString,
    runMain
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
            const runtimeIds = (info.runtimeErrors || []).map(error => error.id)
            const manifestIds = (info.manifestErrors || []).map(error => error.id)
            const ids = runtimeIds.concat(manifestIds).filter(id => id !== undefined && id !== null)
            if(!ids.length) {
                resolve({cleared: 0, runtimeIds, manifestIds, lastError: ''})
                return
            }
            chrome.developerPrivate.deleteExtensionErrors({
                extensionId: ${jsString(config.extensionId)},
                errorIds: ids
            }, () => resolve({
                cleared: ids.length,
                runtimeIds,
                manifestIds,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
    })`)

    console.log(JSON.stringify(result, null, 2))
})
