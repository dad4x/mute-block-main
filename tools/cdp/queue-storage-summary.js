#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

function parseBooleanOption(name) {
    return process.argv.includes(`--${name}`) || getOption(name, '') === 'true'
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || '').toLowerCase()
    const includeFull = parseBooleanOption('include-full')
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const targets = await getTargets(config)
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function inspectStorageQueue(needle, includeFullRead) {
        const defaults = {
            mbCoordinatorQueueView: {},
            mbProfileNukeProgressView: {},
            mbCoordinatorRuns: {},
            mbCoordinatorPaused: false,
            mbCoordinatorIdleRetryEnabled: false
        }
        if(includeFullRead) {
            defaults.mbCoordinatorQueue = {}
        }
        const storage = await chrome.storage.local.get(defaults)
        const view = storage.mbCoordinatorQueueView && typeof storage.mbCoordinatorQueueView === 'object'
            ? storage.mbCoordinatorQueueView
            : {}
        const items = Array.isArray(view.items) ? view.items : []
        const progressView = storage.mbProfileNukeProgressView && typeof storage.mbProfileNukeProgressView === 'object'
            ? storage.mbProfileNukeProgressView
            : {}
        const queue = includeFullRead ? storage.mbCoordinatorQueue || {} : null
        const runs = storage.mbCoordinatorRuns || {}
        const matchesNeedle = item => {
            if(!needle) return true
            return [
                item?.source?.pageUrl || '',
                item?.source?.searchQuery || '',
                item?.source?.spaceKey || '',
                item?.source?.sourceLabel || item?.source?.label || '',
                item?.sourceType || '',
                item?.source?.type || '',
                item?.runId || '',
                item?.targetProfileHref || '',
                item?.requestedUrl || '',
                item?.error || '',
                item?.finalError || ''
            ].join('\\n').toLowerCase().includes(needle)
        }
        const rowEntries = includeFullRead
            ? Object.entries(queue)
            : items.map((item, index) => [
                item?.storageKey || item?.targetProfileHref || item?.requestedUrl || `view-item-${index}`,
                item
            ])
        const rows = rowEntries
            .filter(([, item]) => matchesNeedle(item))
            .map(([key, item]) => ({
                key,
                status: item.status || '',
                sourceType: item.sourceType || item?.source?.type || '',
                sourcePage: item?.source?.pageUrl || '',
                sourceLabel: item?.source?.sourceLabel || item?.source?.label || '',
                runId: item.runId || '',
                target: item.targetProfileHref || item.requestedUrl || '',
                tabId: item.tabId || item.activeTabId || 0,
                queuedAt: item.queuedAt || item.createdAt || 0,
                activeAt: item.activeAt || 0,
                updatedAt: item.updatedAt || item.lastUpdatedAt || 0,
                error: item.error || item.finalError || '',
                event: item.event || ''
            }))
        const counts = !needle && !includeFullRead && view.counts && typeof view.counts === 'object'
            ? {...view.counts}
            : {}
        if(needle || includeFullRead || !Object.keys(counts).length) {
            for(const row of rows) counts[row.status || ''] = (counts[row.status || ''] || 0) + 1
        }

        const runRows = Object.entries(runs)
            .filter(([, run]) => {
                if(!needle) return true
                return [
                    run?.source?.pageUrl || '',
                    run?.source?.spaceKey || '',
                    run?.source?.label || '',
                    run?.sourceType || '',
                    run?.id || '',
                    run?.event || ''
                ].join('\\n').toLowerCase().includes(needle)
            })
            .map(([id, run]) => ({
                id,
                sourceType: run.sourceType || run?.source?.type || '',
                sourcePage: run?.source?.pageUrl || '',
                sourceLabel: run?.source?.label || '',
                status: run.status || '',
                total: run.total || 0,
                queued: run.queued || 0,
                active: run.active || 0,
                succeeded: run.succeeded || 0,
                failed: run.failed || 0,
                canceled: run.canceled || 0,
                event: run.event || ''
            }))

        return {
            needle,
            includeFull: includeFullRead,
            usedCompactView: !includeFullRead,
            rowCount: needle || includeFullRead ? rows.length : Number.parseInt(view.total, 10) || rows.length,
            shownRows: rows.length,
            counts,
            pendingRows: rows.filter(row => row.status !== 'succeeded').slice(0, 80),
            rows: rows.slice(0, 80),
            runs: runRows.slice(0, 40),
            totalQueue: includeFullRead ? Object.keys(queue).length : Number.parseInt(view.total, 10) || items.length,
            totalRuns: Object.keys(runs).length,
            totalProgress: Number.parseInt(progressView.total, 10) || Object.keys(progressView.records || {}).length,
            truncated: view.truncated === true,
            fullStorageRead: includeFullRead,
            paused: storage.mbCoordinatorPaused === true,
            idleRetryEnabled: storage.mbCoordinatorIdleRetryEnabled === true
        }
    }})( ${JSON.stringify(needle)}, ${JSON.stringify(includeFull)} )`, includeFull ? 30000 : 20000)

    console.log(JSON.stringify(result, null, 2))
})
