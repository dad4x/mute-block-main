#!/usr/bin/env node

const {
    DEFAULT_CHROME_DEV_PATH,
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    jsString,
    openChromeExtensionsPage,
    resolveCdpConfig,
    runMain,
    sleep
} = require('./lib/cdp')

runMain(async () => {
    const requestedConfig = getCdpConfig()
    const expectedVersion = getOption('extension-version', requestedConfig.extensionVersion || '')
    const config = await resolveCdpConfig({
        ...requestedConfig,
        extensionId: getOption('extension-id', 'auto'),
        extensionPath: getOption('extension-path', process.env.MB_EXTENSION_PATH || DEFAULT_CHROME_DEV_PATH),
        extensionVersion: ''
    })
    const targets = await getTargets(config)
    const extensionsPage = await openChromeExtensionsPage(config, targets)
    if(!extensionsPage) throw new Error('chrome://extensions/ target not found')

    const before = await evaluate(extensionsPage.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.getExtensionInfo(${jsString(config.extensionId)}, info => resolve(info ? {
            id: info.id,
            name: info.name,
            version: info.version,
            location: info.location,
            state: info.state,
            path: info.path || '',
            updateUrl: info.updateUrl || '',
            webStoreUrl: info.webStoreUrl || ''
        } : null))
    })`, 10000)
    if(!before) throw new Error(`extension ${config.extensionId} not found`)
    if(before.location !== 'UNPACKED') throw new Error(`refusing to reload non-unpacked extension ${before.id}`)
    if(before.updateUrl || before.webStoreUrl) throw new Error(`refusing to reload store-backed extension ${before.id}`)

    const reload = await evaluate(extensionsPage.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.reload(${jsString(config.extensionId)}, {failQuietly: false}, () => resolve({
            ok: !chrome.runtime.lastError,
            lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
        }))
    })`, 15000)
    await sleep(2500)

    const pageAfter = await openChromeExtensionsPage(config)
    const after = await evaluate(pageAfter.webSocketDebuggerUrl, `new Promise(resolve => {
        chrome.developerPrivate.getExtensionInfo(${jsString(config.extensionId)}, info => resolve(info ? {
            id: info.id,
            name: info.name,
            version: info.version,
            location: info.location,
            state: info.state,
            path: info.path || '',
            manifestErrors: (info.manifestErrors || []).length,
            runtimeErrors: (info.runtimeErrors || []).length,
            installWarnings: (info.installWarnings || []).length
        } : null))
    })`, 10000)

    console.log(JSON.stringify({
        ok: reload?.ok === true &&
            after?.state === 'ENABLED' &&
            (!expectedVersion || after?.version === expectedVersion),
        extensionId: config.extensionId,
        extensionPath: config.extensionPath,
        expectedVersion,
        before,
        reload,
        after
    }, null, 2))
    if(!(reload?.ok === true &&
            after?.state === 'ENABLED' &&
            (!expectedVersion || after?.version === expectedVersion))) {
        process.exitCode = 1
    }
})
