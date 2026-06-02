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
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )

    if(!serviceWorker) {
        console.log(JSON.stringify({serviceWorker: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(serviceWorker.webSocketDebuggerUrl, `(${async function readQueueSummary(needle) {
        const storage = await chrome.storage.local.get({
            mbCoordinatorQueue: {},
            mbProfileNukeProgressView: {},
            mbCoordinatorPaused: false,
            mbCoordinatorRetryFailedEnabled: false
        })
        const tabs = await chrome.tabs.query({})
        const queue = storage.mbCoordinatorQueue || {}
        const progress = storage.mbProfileNukeProgressView?.records || {}
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
        const rows = Object.entries(queue)
            .filter(([key, item]) => matchesNeedle(key, item))
            .map(([key, item]) => {
                const target = item?.targetProfileHref || item?.requestedUrl || key
                const normalizedTarget = normalize(target)
                const liveTabs = tabs
                    .filter(tab => normalize(tab.url || '') === normalizedTarget)
                    .map(tab => ({
                        id: tab.id,
                        title: tab.title || '',
                        status: tab.status || '',
                        url: tab.url || ''
                    }))
                const record = progress[key] || progress[item?.targetProfileHref] || progress[item?.requestedUrl] || null
                return {
                    key,
                    status: item?.status || '',
                    target,
                    runId: item?.runId || '',
                    tabId: item?.tabId || item?.activeTabId || 0,
                    activeAt: item?.activeAt || 0,
                    updatedAt: item?.updatedAt || item?.lastUpdatedAt || 0,
                    attemptId: item?.attemptId || item?.attempt?.id || '',
                    actionKind: item?.actionKind || item?.tabAction || '',
                    executorOwner: item?.executorOwner || '',
                    serviceWorkerOwned: item?.serviceWorkerOwned === true,
                    error: item?.error || item?.finalError || '',
                    progress: record ? {
                        status: record.status || '',
                        tabId: record.tabId || 0,
                        attemptId: record.attemptId || record?.attempt?.id || '',
                        actionStartedAt: record.actionStartedAt ||
                            record.muteAttemptedAt ||
                            record.blockAttemptedAt ||
                            record.unmuteAttemptedAt ||
                            record.unblockAttemptedAt ||
                            0,
                        updatedAt: record.updatedAt || record.lastUpdatedAt || 0,
                        finalError: record.finalError || record.error || ''
                    } : null,
                    liveTabs
                }
            })

        const counts = {}
        for(const row of rows) counts[row.status || ''] = (counts[row.status || ''] || 0) + 1

        return {
            serviceWorker: true,
            needle,
            rowCount: rows.length,
            counts,
            paused: storage.mbCoordinatorPaused === true,
            idleRetryEnabled: storage.mbCoordinatorRetryFailedEnabled === true,
            activeRows: rows.filter(row => row.status === 'active'),
            queuedRows: rows.filter(row => row.status === 'queued').slice(0, 20),
            failedRows: rows.filter(row => row.status === 'failed').slice(0, 20)
        }
    }})( ${JSON.stringify(needle)} )`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
