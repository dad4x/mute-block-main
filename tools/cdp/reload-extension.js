#!/usr/bin/env node

const {
    cdpCommand,
    evaluate,
    getCdpConfig,
    getJson,
    getTargets,
    jsString,
    openChromeExtensionsPage,
    resolveCdpConfig,
    runMain,
    sleep
} = require('./lib/cdp')

async function clearExtensionErrors(config, extensionsPage) {
    return evaluate(extensionsPage.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.getExtensionInfo(${jsString(config.extensionId)}, info => {
            const runtimeIds = (info.runtimeErrors || []).map(error => error.id)
            const manifestIds = (info.manifestErrors || []).map(error => error.id)
            const ids = runtimeIds.concat(manifestIds).filter(id => id !== undefined && id !== null)
            if(!ids.length) {
                resolve({cleared: 0, runtimeErrors: 0, manifestErrors: 0, lastError: ''})
                return
            }
            chrome.developerPrivate.deleteExtensionErrors({
                extensionId: ${jsString(config.extensionId)},
                errorIds: ids
            }, () => resolve({
                cleared: ids.length,
                runtimeErrors: runtimeIds.length,
                manifestErrors: manifestIds.length,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
    })`)
}

async function openExtensionsPage(config, targets) {
    return openChromeExtensionsPage(config, targets)
}

runMain(async () => {
    const config = await resolveCdpConfig(getCdpConfig())
    let targets = await getTargets(config)
    const extensionsPage = await openExtensionsPage(config, targets)
    if(!extensionsPage) throw new Error('chrome://extensions/ target not found')

    const clearedErrors = await clearExtensionErrors(config, extensionsPage)
    const beforeInfo = await evaluate(extensionsPage.webSocketDebuggerUrl, `new Promise(resolve => chrome.developerPrivate.getExtensionInfo(${jsString(config.extensionId)}, info => resolve(info ? {
        id: info.id,
        name: info.name,
        state: info.state,
        version: info.version,
        location: info.location,
        path: info.path || '',
        updateUrl: info.updateUrl || '',
        webStoreUrl: info.webStoreUrl || ''
    } : null)))`)
    if(beforeInfo?.updateUrl || beforeInfo?.webStoreUrl) {
        console.log(JSON.stringify({
            clearedErrors,
            reload: {
                ok: false,
                blocked: true,
                lastError: 'Refusing chrome.developerPrivate.reload for a Web Store-backed keyed extension; use Load unpacked from the canonical chrome directory instead.'
            },
            version: beforeInfo.version || '',
            info: beforeInfo
        }, null, 2))
        return
    }

    const reload = await evaluate(extensionsPage.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.reload(${jsString(config.extensionId)}, {failQuietly: false}, () => resolve({
            ok: !chrome.runtime.lastError,
            lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
        }))
    })`)
    await sleep(2500)
    const extensionInfoTarget = (await getTargets(config)).find(target => target.url === 'chrome://extensions/')
    const info = extensionInfoTarget
        ? await evaluate(extensionInfoTarget.webSocketDebuggerUrl, `new Promise(resolve => chrome.developerPrivate.getExtensionInfo(${jsString(config.extensionId)}, info => resolve({
            id: info.id,
            name: info.name,
            state: info.state,
            version: info.version,
            manifestErrors: (info.manifestErrors || []).length,
            runtimeErrors: (info.runtimeErrors || []).length,
            installWarnings: (info.installWarnings || []).length
        })))`)
        : null
    const version = info?.version || ''

    console.log(JSON.stringify({clearedErrors, reload, version, info}, null, 2))
})
