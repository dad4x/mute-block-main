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
    const status = getOption('status', process.env.MB_QUEUE_STATUS || '').toLowerCase()
    const limit = Number.parseInt(getOption('limit', '20'), 10) || 20
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function currentWorkFilter(needle, status, limit) {
        const storage = await chrome.storage.local.get({mbCoordinatorQueueView: {}})
        const view = storage.mbCoordinatorQueueView && typeof storage.mbCoordinatorQueueView === 'object'
            ? storage.mbCoordinatorQueueView
            : {}
        const items = Array.isArray(view.items) ? view.items : []
        const matchesNeedle = (key, item) => {
            if(!needle) return true
            return [
                key,
                item?.source?.pageUrl || '',
                item?.source?.searchQuery || '',
                item?.source?.spaceKey || '',
                item?.source?.label || '',
                item?.sourceType || '',
                item?.source?.type || '',
                item?.runId || '',
                item?.targetProfileHref || '',
                item?.requestedUrl || '',
                item?.error || '',
                item?.finalError || '',
                item?.event || ''
            ].join('\\n').toLowerCase().includes(needle)
        }
        const rows = items.map((item, index) => [
            item?.storageKey || item?.targetProfileHref || item?.requestedUrl || `view-item-${index}`,
            item
        ])
            .filter(([key, item]) => matchesNeedle(key, item))
            .filter(([, item]) => !status || `${item?.status || ''}`.toLowerCase() === status)
            .map(([key, item]) => ({
                key,
                status: item.status || '',
                outcome: item.outcome || '',
                error: item.error || item.finalError || '',
                event: item.event || '',
                target: item.targetProfileHref || item.requestedUrl || '',
                sourceType: item.sourceType || item?.source?.type || '',
                sourcePage: item?.source?.pageUrl || '',
                runId: item.runId || '',
                tabId: item.tabId || item.activeTabId || 0,
                queuedAt: item.queuedAt || item.createdAt || 0,
                activeAt: item.activeAt || 0,
                updatedAt: item.updatedAt || item.lastUpdatedAt || 0,
                terminalAt: item.terminalAt || 0,
                attemptId: item.attemptId || item?.attempt?.id || '',
                attemptNumber: item.attemptNumber || item?.attempt?.number || 0,
                maxAttempts: item.maxAttempts || item?.attempt?.max || 0,
                progress: null
            }))
        rows.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
        const counts = !needle && view.counts && typeof view.counts === 'object'
            ? {...view.counts}
            : {}
        if(needle || !Object.keys(counts).length) {
            for(const [, item] of items.map((item, index) => [
                item?.storageKey || item?.targetProfileHref || item?.requestedUrl || `view-item-${index}`,
                item
            ]).filter(([key, item]) => matchesNeedle(key, item))) {
                const key = item?.status || ''
                counts[key] = (counts[key] || 0) + 1
            }
        }
        return {
            needle,
            status,
            rowCount: status || needle ? rows.length : Number.parseInt(view.total, 10) || rows.length,
            shownRows: rows.length,
            counts,
            usedCompactView: true,
            truncated: view.truncated === true,
            rows: rows.slice(0, limit)
        }
    }})( ${JSON.stringify(needle)}, ${JSON.stringify(status)}, ${JSON.stringify(limit)} )`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
