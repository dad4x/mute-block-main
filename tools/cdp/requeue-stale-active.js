#!/usr/bin/env node

const {COORDINATOR_QUEUE_KEY, STORAGE_LAYOUT_PREFIX} = require('../../shared/js/storageKeys')

// The stored name of the queue: the layout prefix plus the plain key name (storageNamespace.js).
const QUEUE_STORED_KEY = `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_QUEUE_KEY}`

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || 'profile-modal').toLowerCase()
    const targets = await getTargets(config)
    const liveProfilePages = targets.filter(target =>
        target.type === 'page' && /^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')
    )

    if(liveProfilePages.length) {
        console.log(JSON.stringify({
            changed: 0,
            reason: 'live-profile-tabs-present',
            liveProfilePages: liveProfilePages.map(target => ({
                id: target.id,
                title: target.title || '',
                url: target.url || ''
            }))
        }, null, 2))
        return
    }

    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function requeueStaleActive(needle, queueKey) {
        const storage = await chrome.storage.local.get({[queueKey]: {}})
        const queue = storage[queueKey] || {}
        const now = Date.now()
        const changed = []

        for(const [key, item] of Object.entries(queue)) {
            if(!item || typeof item !== 'object' || item.status !== 'active') continue

            const haystack = [
                item.sourceType || '',
                item?.source?.type || '',
                item?.source?.pageUrl || '',
                item.runId || '',
                item.targetProfileHref || '',
                item.requestedUrl || ''
            ].join('\\n').toLowerCase()
            if(needle && !haystack.includes(needle)) continue

            queue[key] = {
                ...item,
                status: 'queued',
                tabId: null,
                activeTabId: null,
                activeAt: 0,
                updatedAt: now,
                event: 'Requeued stale active row after no live profile tab was found'
            }
            changed.push(key)
        }

        await chrome.storage.local.set({[queueKey]: queue})
        return {changed: changed.length, rows: changed}
    }})( ${JSON.stringify(needle)}, ${JSON.stringify(QUEUE_STORED_KEY)} )`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
