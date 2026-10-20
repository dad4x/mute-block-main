#!/usr/bin/env node

const {
    DEFAULT_CHROME_DEV_PATH,
    cdpCommand,
    clearProfileNukeProgressThroughWorker,
    evaluate,
    getJson,
    getOption,
    getTargets,
    resolveCdpConfig,
    runMain,
    sleep
} = require('./lib/cdp')

function shouldRemoveStorageKey(key = '') {
    return [
        'mbCoordinator',
        'mbProfileNukeProgressView',
        'mbProfileNukeProgressShard',
        'mbQueuedActionSurface',
        'mbQueueWakeup',
        'mbFlightRecorder'
    ].some(prefix => key.startsWith(prefix))
}

runMain(async () => {
    const config = await resolveCdpConfig({
        host: getOption('host', process.env.MB_CDP_HOST || '127.0.0.1'),
        port: Number.parseInt(getOption('port', process.env.MB_CDP_PORT || 9222), 10) || 9222,
        extensionId: getOption('extension-id', 'auto'),
        extensionPath: getOption('extension-path', process.env.MB_EXTENSION_PATH || DEFAULT_CHROME_DEV_PATH),
        extensionVersion: getOption('extension-version', process.env.MB_EXTENSION_VERSION || '')
    })
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    let targets = await getTargets(config)
    let target = targets.find(candidate => candidate.type === 'service_worker' &&
            `${candidate.url || ''}`.includes(config.extensionId)) ||
        targets.find(candidate => candidate.type === 'page' && candidate.url === dashboardUrl)

    if(!target) {
        const versionInfo = await getJson('/json/version', config)
        await cdpCommand(versionInfo.webSocketDebuggerUrl, 'Target.createTarget', {
            url: dashboardUrl
        }, 10000)
        await sleep(1500)
        targets = await getTargets(config)
        target = targets.find(candidate => candidate.type === 'service_worker' &&
                `${candidate.url || ''}`.includes(config.extensionId)) ||
            targets.find(candidate => candidate.type === 'page' && candidate.url === dashboardUrl)
    }

    if(!target) throw new Error('extension context not found for coordinator cleanup')

    const result = await evaluate(target.webSocketDebuggerUrl, `new Promise(resolve => {
        const shouldRemoveStorageKey = ${shouldRemoveStorageKey.toString()}
        chrome.storage.local.get(null, stored => {
            const lastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            if(lastError) {
                resolve({ok: false, error: lastError})
                return
            }
            const keys = Object.keys(stored || {}).filter(shouldRemoveStorageKey)
            chrome.storage.local.remove(keys, () => {
                const removeError = chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
                resolve({
                    ok: !removeError,
                    removedCount: keys.length,
                    removedKeys: keys.sort(),
                    error: removeError
                })
            })
        })
    })`, 20000)

    const progressClear = await clearProfileNukeProgressThroughWorker(config)
    console.log(JSON.stringify({
        ok: result?.ok === true && progressClear.saved !== false,
        extensionId: config.extensionId,
        extensionPath: config.extensionPath,
        target: {
            type: target.type || '',
            url: target.url || ''
        },
        removedCount: result?.removedCount || 0,
        removedKeys: result?.removedKeys || [],
        error: result?.error || '',
        progressCleared: progressClear.cleared || 0,
        progressReason: progressClear.reason || ''
    }, null, 2))
    if(result?.ok !== true || progressClear.saved === false) process.exitCode = 1
})
