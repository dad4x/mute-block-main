#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function getQueueFailures(needle) {
        const storage = await chrome.storage.local.get({mbCoordinatorQueueView: {}})
        const view = storage.mbCoordinatorQueueView && typeof storage.mbCoordinatorQueueView === 'object'
            ? storage.mbCoordinatorQueueView
            : {}
        const items = Array.isArray(view.items) ? view.items : []
        const rows = items.map((item, index) => [
            item?.storageKey || item?.targetProfileHref || item?.requestedUrl || `view-item-${index}`,
            item
        ])
            .filter(([, item]) => {
                if(!item || item.status !== 'failed') return false
                if(!needle) return true
                return [
                    item.sourceType || '',
                    item?.source?.type || '',
                    item?.source?.pageUrl || '',
                    item.runId || '',
                    item.targetProfileHref || '',
                    item.requestedUrl || '',
                    item.error || '',
                    item.finalError || ''
                ].join('\\n').toLowerCase().includes(needle)
            })
            .map(([key, item]) => ({
                key,
                target: item.targetProfileHref || item.requestedUrl || key,
                error: item.error || item.finalError || '',
                event: item.event || '',
                updatedAt: item.updatedAt || 0
            }))
        return {
            needle,
            failed: !needle && view.counts ? Number(view.counts.failed) || 0 : rows.length,
            shownFailed: rows.length,
            rows,
            usedCompactView: true,
            truncated: view.truncated === true
        }
    }})( ${JSON.stringify(needle)} )`, 10000)

    console.log(JSON.stringify(result, null, 2))
})
