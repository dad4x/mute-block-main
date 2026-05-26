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
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const targets = await getTargets(config)
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function activeQueueRows(needle) {
        const storage = await chrome.storage.local.get({mbCoordinatorQueueView: {}})
        const view = storage.mbCoordinatorQueueView && typeof storage.mbCoordinatorQueueView === 'object'
            ? storage.mbCoordinatorQueueView
            : {}
        const items = Array.isArray(view.items) ? view.items : []
        const tabs = await chrome.tabs.query({})
        const normalize = value => {
            try {
                const url = new URL(`${value || ''}`)
                url.hash = ''
                url.search = ''
                return url.href.replace(/\/$/, '')
            }
            catch {
                return `${value || ''}`.replace(/[?#].*$/, '').replace(/\/$/, '')
            }
        }
        const matchesNeedle = (key, item) => {
            if(!needle) return true
            return [
                key,
                item?.sourceType || '',
                item?.source?.type || '',
                item?.source?.pageUrl || '',
                item?.runId || '',
                item?.targetProfileHref || '',
                item?.requestedUrl || '',
                item?.error || '',
                item?.finalError || ''
            ].join('\\n').toLowerCase().includes(needle)
        }
        const activeRows = items.map((item, index) => [
            item?.storageKey || item?.targetProfileHref || item?.requestedUrl || `view-item-${index}`,
            item
        ])
            .filter(([key, item]) => item?.status === 'active' && matchesNeedle(key, item))
            .map(([key, item]) => {
                const target = item.targetProfileHref || item.requestedUrl || key
                const normalizedTarget = normalize(target)
                const liveTabs = tabs
                    .filter(tab => normalize(tab.url || '') === normalizedTarget)
                    .map(tab => ({
                        id: tab.id,
                        active: !!tab.active,
                        status: tab.status || '',
                        title: tab.title || '',
                        url: tab.url || ''
                    }))
                return {
                    key,
                    target,
                    runId: item.runId || '',
                    sourceType: item.sourceType || item?.source?.type || '',
                    status: item.status || '',
                    tabId: item.tabId || item.activeTabId || 0,
                    activeAt: item.activeAt || 0,
                    updatedAt: item.updatedAt || item.lastUpdatedAt || 0,
                    attemptId: item.attemptId || item?.attempt?.id || '',
                    attemptNumber: item.attemptNumber || item?.attempt?.number || 0,
                    actionKind: item.actionKind || item.tabAction || '',
                    executorOwner: item.executorOwner || '',
                    serviceWorkerOwned: item.serviceWorkerOwned === true,
                    error: item.error || item.finalError || '',
                    progress: null,
                    liveTabs
                }
            })
        return {
            needle,
            activeCount: activeRows.length,
            activeRows,
            usedCompactView: true,
            truncated: view.truncated === true,
            total: Number.parseInt(view.total, 10) || items.length,
            counts: view.counts || {}
        }
    }})( ${JSON.stringify(needle)} )`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
