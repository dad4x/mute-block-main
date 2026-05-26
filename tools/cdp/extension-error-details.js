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
            developerPrivateKeys: Object.keys(chrome.developerPrivate).sort(),
            runtimeErrors: info.runtimeErrors || [],
            manifestErrors: info.manifestErrors || [],
            installWarnings: info.installWarnings || []
        }))
    })`)

    console.log(JSON.stringify(info, null, 2))
})
