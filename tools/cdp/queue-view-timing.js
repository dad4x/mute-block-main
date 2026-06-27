#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const target = targets.find(candidate => candidate.type === 'page' && candidate.url === dashboardUrl) ||
        targets.find(candidate => candidate.type === 'page' && (candidate.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    if(!target) {
        console.log(JSON.stringify({ok: false, reason: 'extension-page-not-found'}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `(${function readQueueViewTiming() {
        return new Promise(resolve => {
            chrome.storage.local.get({mbCoordinatorQueueView: null}, storage => {
                const view = storage?.mbCoordinatorQueueView || null
                const items = Array.isArray(view?.items) ? view.items : []
                resolve({
                    ok: true,
                    updatedAt: view?.updatedAt || 0,
                    total: view?.total || 0,
                    counts: view?.counts || {},
                    actualBlockTiming: view?.actualBlockTiming || null,
                    terminalSamples: items
                        .filter(item => ['succeeded', 'failed', 'canceled'].includes(`${item?.status || ''}`))
                        .slice(0, 5)
                        .map(item => ({
                            key: item.key || '',
                            status: item.status || '',
                            actionKind: item.actionKind || '',
                            outcome: item.outcome || '',
                            activeAt: item.activeAt || 0,
                            actionReadyAt: item.actionReadyAt || 0,
                            blockAttemptedAt: item.blockAttemptedAt || 0,
                            blockedAt: item.blockedAt || 0,
                            terminalAt: item.terminalAt || 0,
                            updatedAt: item.updatedAt || 0,
                            milestones: item.milestones || null
                        }))
                })
            })
        })
    }})()`, 10000)

    console.log(JSON.stringify({
        target: {id: target.id, title: target.title || '', url: target.url || ''},
        result
    }, null, 2))
})
