#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

const METRICS_KEY = 'mbQueueWakeupMetrics'

runMain(async () => {
    const config = getCdpConfig()
    const limit = Math.max(1, Number.parseInt(getOption('limit', '30'), 10) || 30)
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const target = targets.find(entry => entry.type === 'page' && entry.url === dashboardUrl) ||
        targets.find(entry => entry.type === 'page' && (entry.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    if(!target) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `new Promise(resolve => {
        const finish = value => resolve(value)
        const timeout = setTimeout(() => finish({
            timedOut: true,
            lastError: 'storage get timed out',
            metrics: null
        }), 5000)
        try {
            chrome.storage.local.get({${JSON.stringify(METRICS_KEY)}: null}, stored => {
                clearTimeout(timeout)
                finish({
                    timedOut: false,
                    lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : '',
                    metrics: stored?.[${JSON.stringify(METRICS_KEY)}] || null
                })
            })
        }
        catch(error) {
            clearTimeout(timeout)
            finish({
                timedOut: false,
                lastError: error?.message || String(error || ''),
                metrics: null
            })
        }
    })`, 10000)

    const current = result?.metrics?.currentEpoch || result?.metrics || null
    const counters = current?.counters || {}
    const journal = Array.isArray(current?.journal) ? current.journal : []
    console.log(JSON.stringify({
        extensionPage: true,
        storageRead: {
            timedOut: result?.timedOut === true,
            lastError: result?.lastError || ''
        },
        epochId: current?.epochId || '',
        extensionVersion: current?.extensionVersion || '',
        counters: {
            pumpFastRequested: counters['pump.fastExecutor.requested'] || 0,
            pumpFastChanged: counters['pump.fastExecutor.changed'] || 0,
            pumpFastNoop: counters['pump.fastExecutor.noop'] || 0,
            liveQueuedTabAdoptionFailed: counters['pump.noop.liveQueuedTabAdoptionFailed'] || 0,
            repairRequested: counters['repair.requested'] || 0,
            repairActiveWithoutActorResidentAuthority: counters['repair.activeWithoutActor.usedResidentAuthority'] || 0,
            storageUpdateStarted: counters['storageUpdate.started'] || 0,
            storageUpdateCompleted: counters['storageUpdate.completed'] || 0,
            storageUpdateTimedOut: counters['storageUpdate.timedOut'] || 0,
            storageUpdateFallbackReturned: counters['storageUpdate.fallbackReturned'] || 0,
            storageTimeoutBeforeStart: counters['timeout.beforeStart'] || 0
        },
        journalCount: journal.length,
        tail: journal.slice(-limit)
    }, null, 2))
})
