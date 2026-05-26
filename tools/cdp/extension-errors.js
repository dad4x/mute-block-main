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

    const info = await evaluate(extensionsPage.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.getExtensionInfo(${jsString(config.extensionId)}, info => resolve({
            id: info.id,
            name: info.name,
            state: info.state,
            version: info.version,
            manifestErrors: (info.manifestErrors || []).map(error => ({
                message: error.message || '',
                source: error.source || '',
                severity: error.severity || ''
            })),
            runtimeErrors: (info.runtimeErrors || []).map(error => ({
                message: error.message || '',
                source: error.source || '',
                severity: error.severity || '',
                contextUrl: error.contextUrl || '',
                stackTrace: (error.stackTrace || []).map(frame => ({
                    url: frame.url || '',
                    lineNumber: frame.lineNumber || 0,
                    columnNumber: frame.columnNumber || 0,
                    functionName: frame.functionName || ''
                })).slice(0, 8)
            }))
        }))
    })`)

    console.log(JSON.stringify(info, null, 2))
})
