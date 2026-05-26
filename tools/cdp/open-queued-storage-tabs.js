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
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || 'profile-modal').toLowerCase()
    const limit = Math.max(1, Number.parseInt(getOption('limit', process.env.MB_QUEUE_OPEN_LIMIT || '1'), 10) || 1)
    const targets = await getTargets(config)
    const liveProfilePages = targets.filter(target =>
        target.type === 'page' && /^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')
    )

    if(liveProfilePages.length) {
        console.log(JSON.stringify({
            opened: 0,
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

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function openQueuedStorageTabs(needle, limit) {
        function normalizeProfile(value) {
            try {
                const url = new URL(`${value || ''}`)
                if(url.hostname.toLowerCase() !== 'www.quora.com') return ''
                const parts = url.pathname.split('/').filter(Boolean)
                if(parts[0] !== 'profile' || !parts[1]) return ''
                return `https://www.quora.com/profile/${parts[1]}`
            }
            catch {
                return ''
            }
        }

        const storage = await chrome.storage.local.get({mbCoordinatorQueue: {}})
        const queue = storage.mbCoordinatorQueue || {}
        const selected = []

        for(const [key, item] of Object.entries(queue)) {
            if(selected.length >= limit) break
            if(!item || typeof item !== 'object' || item.status !== 'queued') continue

            const target = normalizeProfile(item.targetProfileHref || item.requestedUrl || key)
            if(!target) continue

            const haystack = [
                item.sourceType || '',
                item?.source?.type || '',
                item?.source?.pageUrl || '',
                item.runId || '',
                target
            ].join('\\n').toLowerCase()
            if(needle && !haystack.includes(needle)) continue

            selected.push({key, item, target})
        }

        const opened = []
        for(const selectedItem of selected) {
            const tab = await chrome.tabs.create({url: 'about:blank', active: false})
            const now = Date.now()
            queue[selectedItem.key] = {
                ...selectedItem.item,
                status: 'active',
                tabId: tab.id,
                activeTabId: tab.id,
                activeAt: now,
                updatedAt: now,
                event: 'Opened queued storage row from CDP helper'
            }
            opened.push({
                key: selectedItem.key,
                tabId: tab.id,
                target: selectedItem.target
            })
        }

        if(opened.length) {
            await chrome.storage.local.set({mbCoordinatorQueue: queue})
            for(const entry of opened) {
                await chrome.tabs.update(entry.tabId, {url: entry.target, active: false})
            }
        }

        return {opened: opened.length, rows: opened}
    }})( ${JSON.stringify(needle)}, ${JSON.stringify(limit)} )`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
