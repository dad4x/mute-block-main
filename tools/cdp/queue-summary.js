#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    resolveCdpConfig,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = await resolveCdpConfig(getCdpConfig())
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const serviceWorker = targets.find(target => target.type === 'service_worker' && target.url.includes(config.extensionId))
    if(!serviceWorker) {
        console.log(JSON.stringify({serviceWorker: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(serviceWorker.webSocketDebuggerUrl, `(${async function inspectQueue(needle) {
        const storage = await chrome.storage.local.get({
            mbCoordinatorQueue: {},
            mbCoordinatorRuns: {},
            mbProfileNukeProgressView: {}
        })
        const queue = storage.mbCoordinatorQueue || {}
        const runs = storage.mbCoordinatorRuns || {}
        const progressRecords = storage.mbProfileNukeProgressView?.records || {}
        const tabs = await chrome.tabs.query({})
        const profileTabs = tabs.filter(tab => /^https:\/\/www\.quora\.com\/profile\//i.test(tab.url || ''))
        const runtimeQueuedActions = typeof queuedTabActions !== 'undefined'
            ? queuedTabActions.map(action => ({
                url: action.url || action.profileHref || action.requestedUrl || '',
                targetUrl: action.targetUrl || '',
                requestedUrl: action.requestedUrl || '',
                ownerTabId: action.ownerTabId || 0,
                tabAction: action.tabAction || '',
                action: action.action || '',
                runId: action.runId || '',
                sourceType: action.sourceType || action?.source?.type || '',
                sourcePage: action?.source?.pageUrl || ''
            }))
            : []
        const runtimeActiveTabs = typeof activeQueuedTabs !== 'undefined'
            ? Array.from(activeQueuedTabs)
            : []
        const runtimeOwned = typeof ownedTabIdsByParent !== 'undefined'
            ? Array.from(ownedTabIdsByParent.entries()).map(([parentTabId, childIds]) => ({
                parentTabId,
                childIds: Array.from(childIds || [])
            }))
            : []
        const matchesNeedle = item => {
            if(!needle) return true
            return [
                item?.source?.pageUrl || '',
                item?.source?.spaceKey || '',
                item?.source?.label || '',
                item?.sourceType || '',
                item?.source?.type || '',
                item?.runId || '',
                item?.targetProfileHref || '',
                item?.requestedUrl || ''
            ].join('\n').toLowerCase().includes(needle)
        }
        const rows = Object.entries(queue)
            .filter(([, item]) => matchesNeedle(item))
            .map(([key, item]) => ({
                key,
                status: item.status || '',
                sourceType: item.sourceType || item?.source?.type || '',
                sourcePage: item?.source?.pageUrl || '',
                sourceLabel: item?.source?.label || '',
                runId: item.runId || '',
                target: item.targetProfileHref || item.requestedUrl || '',
                activeTabId: item.activeTabId || item.tabId || 0,
                updatedAt: item.updatedAt || item.lastUpdatedAt || 0,
                event: item.event || ''
            }))
        const counts = {}
        for(const row of rows) counts[row.status || ''] = (counts[row.status || ''] || 0) + 1

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
                ].join('\n').toLowerCase().includes(needle)
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
            rowCount: rows.length,
            counts,
            rows: rows.slice(0, 40),
            runs: runRows.slice(0, 20),
            totalQueue: Object.keys(queue).length,
            totalRuns: Object.keys(runs).length,
            totalProgress: Number.parseInt(storage.mbProfileNukeProgressView?.total, 10) || Object.keys(progressRecords).length,
            runtime: {
                queuedActions: runtimeQueuedActions.length,
                queuedActionSamples: runtimeQueuedActions.slice(0, 20),
                activeQueuedTabs: runtimeActiveTabs,
                owned: runtimeOwned
            },
            profileTabs: profileTabs.map(tab => ({
                id: tab.id,
                active: tab.active,
                title: tab.title || '',
                url: tab.url || ''
            })).slice(0, 60),
            profileTabCount: profileTabs.length
        }
    }})( ${JSON.stringify(needle)} )`, 30000)

    console.log(JSON.stringify(result, null, 2))
})
