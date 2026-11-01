#!/usr/bin/env node

const {COORDINATOR_QUEUE_VIEW_KEY, STORAGE_LAYOUT_PREFIX} = require('../../shared/js/storageKeys')

// The stored name of the queue view: the layout prefix plus the plain key name (storageNamespace.js).
const QUEUE_VIEW_STORED_KEY = `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_QUEUE_VIEW_KEY}`

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
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function getQueueFailures(needle, viewKey) {
        const storage = await chrome.storage.local.get({[viewKey]: {}})
        const view = storage[viewKey] && typeof storage[viewKey] === 'object'
            ? storage[viewKey]
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
    }})( ${JSON.stringify(needle)}, ${JSON.stringify(QUEUE_VIEW_STORED_KEY)} )`, 10000)

    console.log(JSON.stringify(result, null, 2))
})
