#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

const DEFAULT_KEY = 'mbQueueWakeupMetrics'

runMain(async () => {
    const config = getCdpConfig()
    const key = getOption('key', DEFAULT_KEY)
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const candidates = targets.filter(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId) ||
        target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`)
    )

    const results = []
    for(const target of candidates) {
        const expressionResult = await evaluate(target.webSocketDebuggerUrl, `(${function probeExpression() {
            return {
                ok: true,
                href: location.href,
                title: document.title || '',
                hasChrome: typeof chrome !== 'undefined',
                hasRuntime: !!chrome?.runtime,
                hasStorageLocal: !!chrome?.storage?.local
            }
        }})()`, 5000).catch(error => ({error: error.message}))

        const storageResult = await evaluate(target.webSocketDebuggerUrl, `(${function probeStorage(key) {
            return new Promise(resolve => {
                const startedAt = Date.now()
                const timeout = setTimeout(() => resolve({
                    timedOut: true,
                    elapsedMs: Date.now() - startedAt
                }), 5000)
                try {
                    chrome.storage.local.get({[key]: null}, storage => {
                        clearTimeout(timeout)
                        const value = storage?.[key] || null
                        resolve({
                            timedOut: false,
                            elapsedMs: Date.now() - startedAt,
                            lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : '',
                            hasValue: !!value,
                            valueType: value ? typeof value : '',
                            version: value?.version || 0,
                            resetReason: value?.currentEpoch?.resetReason || value?.resetReason || ''
                        })
                    })
                }
                catch(error) {
                    clearTimeout(timeout)
                    resolve({
                        timedOut: false,
                        elapsedMs: Date.now() - startedAt,
                        error: error?.message || String(error || '')
                    })
                }
            })
        }})(${JSON.stringify(key)})`, 7000).catch(error => ({error: error.message}))

        results.push({
            id: target.id,
            type: target.type,
            title: target.title || '',
            url: target.url || '',
            isDashboard: target.url === dashboardUrl,
            expression: expressionResult,
            storage: storageResult
        })
    }

    console.log(JSON.stringify({key, results}, null, 2))
})
