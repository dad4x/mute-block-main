#!/usr/bin/env node

const {COORDINATOR_QUEUE_VIEW_KEY, STORAGE_LAYOUT_PREFIX} = require('../../shared/js/storageKeys')

// The stored name of the queue view: the layout prefix plus the plain key name (storageNamespace.js).
const QUEUE_VIEW_STORED_KEY = `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_QUEUE_VIEW_KEY}`

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
    const extensionTarget = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`)) ||
        targets.find(target => target.type === 'service_worker' && (target.url || '').includes(config.extensionId))
    const profilePages = targets.filter(target =>
        target.type === 'page' && /^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')
    )

    if(!extensionTarget) {
        console.log(JSON.stringify({extensionTarget: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionTarget.webSocketDebuggerUrl, `(${async function getQueueCounts(needle, viewKey) {
        const storage = await chrome.storage.local.get({[viewKey]: {}})
        const view = storage[viewKey] && typeof storage[viewKey] === 'object'
            ? storage[viewKey]
            : {}
        const items = Array.isArray(view.items) ? view.items : []
        const rows = items.filter(item => {
            if(!needle) return true
            return [
                item?.sourceType || '',
                item?.source?.type || '',
                item?.source?.pageUrl || '',
                item?.runId || '',
                item?.targetProfileHref || '',
                item?.requestedUrl || ''
            ].join('\\n').toLowerCase().includes(needle)
        })
        const counts = !needle && view.counts && typeof view.counts === 'object'
            ? {...view.counts}
            : {}
        if(needle || !Object.keys(counts).length) {
            for(const row of rows) counts[row?.status || ''] = (counts[row?.status || ''] || 0) + 1
        }
        return {
            needle,
            rowCount: needle ? rows.length : Number.parseInt(view.total, 10) || rows.length,
            shownRows: rows.length,
            counts,
            usedCompactView: true,
            truncated: view.truncated === true
        }
    }})( ${JSON.stringify(needle)}, ${JSON.stringify(QUEUE_VIEW_STORED_KEY)} )`, 10000)

    result.profileTabCount = profilePages.length
    result.profilePages = profilePages.map(target => ({
        title: target.title || '',
        url: target.url || ''
    }))
    console.log(JSON.stringify(result, null, 2))
})
