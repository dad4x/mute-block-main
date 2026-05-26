#!/usr/bin/env node

const {
    cdpCommand,
    evaluate,
    getCdpConfig,
    getJson,
    getTargets,
    jsString,
    runMain,
    sleep
} = require('./lib/cdp')

async function openDashboard(config, targets) {
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    let dashboard = targets.find(target => target.url === dashboardUrl)
    if(dashboard) return dashboard

    const versionInfo = await getJson('/json/version', config)
    await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
        url: dashboardUrl,
        background: true
    })
    await sleep(1500)
    targets = await getTargets(config)
    dashboard = targets.find(target => target.url === dashboardUrl)
    if(!dashboard) throw new Error('Dashboard target not found')
    return dashboard
}

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

runMain(async () => {
    const config = getCdpConfig()
    let targets = await getTargets(config)
    const extensionsPage = targets.find(target => target.url === 'chrome://extensions/')
    if(!extensionsPage) throw new Error('chrome://extensions/ target not found')

    const clearedErrors = await clearExtensionErrors(config, extensionsPage)
    const reload = await evaluate(extensionsPage.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.reload(${jsString(config.extensionId)}, {failQuietly: false}, () => resolve({
            ok: !chrome.runtime.lastError,
            lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
        }))
    })`)
    await sleep(2500)
    targets = await getTargets(config)
    const dashboard = await openDashboard(config, targets)
    const version = await evaluate(dashboard.webSocketDebuggerUrl, 'chrome.runtime.getManifest().version')
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

    console.log(JSON.stringify({clearedErrors, reload, version, info}, null, 2))
})
