#!/usr/bin/env node

const {
    cdpCommand,
    DEFAULT_CHROME_DEV_PATH,
    getCdpConfig,
    getJson,
    getOption,
    getTargets,
    openChromeExtensionsPage,
    resolveCdpConfig,
    runMain,
    sleep
} = require('./lib/cdp')

function targetSummary(target = {}) {
    return {
        id: target.id || '',
        type: target.type || '',
        title: target.title || '',
        url: target.url || ''
    }
}

function shouldKeepTarget(target = {}, dashboardUrl = '') {
    if(target.type !== 'page') return true
    const url = target.url || ''
    if(url === 'chrome://extensions/') return true
    if(url === dashboardUrl) return true
    return false
}

runMain(async () => {
    const config = await resolveCdpConfig({
        ...getCdpConfig(),
        extensionId: getOption('extension-id', 'auto'),
        extensionPath: getOption('extension-path', process.env.MB_EXTENSION_PATH || DEFAULT_CHROME_DEV_PATH)
    })
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionsPage = await openChromeExtensionsPage(config)
    if(!extensionsPage) throw new Error('chrome://extensions/ target not found')

    let targets = await getTargets(config)
    const dashboardBefore = targets.find(target => target.type === 'page' && target.url === dashboardUrl) || null
    const versionInfo = await getJson('/json/version', config)
    const closeCandidates = targets.filter(target => !shouldKeepTarget(target, dashboardUrl))
    const closed = []
    for(const target of closeCandidates) {
        const result = await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.closeTarget', {
            targetId: target.id
        }, 10000).catch(error => ({error: error?.message || `${error || ''}`}))
        closed.push({
            ...targetSummary(target),
            closed: result?.success !== false && !result?.error,
            error: result?.error || ''
        })
    }

    await sleep(1000)
    targets = await getTargets(config)
    const remainingPages = targets
        .filter(target => target.type === 'page')
        .map(targetSummary)
    const dashboardAfter = remainingPages.find(target => target.url === dashboardUrl) || null
    const extensionsAfter = remainingPages.find(target => target.url === 'chrome://extensions/') || null
    const onlyExpectedPagesRemain = remainingPages.every(target => shouldKeepTarget(target, dashboardUrl))

    console.log(JSON.stringify({
        ok: onlyExpectedPagesRemain && !!extensionsAfter && !!dashboardAfter,
        extensionId: config.extensionId,
        extensionPath: config.extensionPath,
        dashboardUrl,
        hadDashboardBefore: !!dashboardBefore,
        hasDashboardAfter: !!dashboardAfter,
        hasExtensionsPageAfter: !!extensionsAfter,
        closedCount: closed.length,
        closed,
        remainingPages
    }, null, 2))
    if(!(onlyExpectedPagesRemain && !!extensionsAfter && !!dashboardAfter)) process.exitCode = 1
})
