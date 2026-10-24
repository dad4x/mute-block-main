#!/usr/bin/env node

const {SPACE_MAP_BUCKET_COUNT} = require("../../shared/js/storageKeys")
const {
    evaluate,
    getCdpConfig,
    getTargets,
    isSpacePageTarget,
    runMain,
    spaceKeyFromUrl
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const pages = targets.filter(isSpacePageTarget)
    const pageSummaries = []

    for(const page of pages) {
        const summary = await evaluate(page.webSocketDebuggerUrl, `(${function inspectPage() {
            const text = element => `${element?.innerText || element?.textContent || ''}`.replace(/\s+/g, ' ').trim()
            const button = document.querySelector('.mb-ext_space-feed-nuke-btn')
            const main = document.querySelector('#mainContent, main, [role="main"]')
            const canonical = document.querySelector('link[rel="canonical"]')?.href || location.origin
            return {
                url: location.href,
                title: document.title,
                canonical,
                buttonText: text(button),
                buttonState: button?.dataset?.mbNukeState || '',
                buttonUrlsCount: (() => {
                    try { return JSON.parse(button?.dataset?.mbSpaceFeedUrls || '[]').length } catch { return -1 }
                })(),
                mainDataset: {...(main?.dataset || {})},
                counts: {
                    postHosts: document.querySelectorAll('.mb-ext_space-feed-post-nuke-host').length,
                    timestamps: document.querySelectorAll('a.post_timestamp').length
                }
            }
        }})()`)
        pageSummaries.push({
            target: {id: page.id, title: page.title, url: page.url},
            spaceKey: spaceKeyFromUrl(summary?.canonical || page.url),
            summary
        })
    }

    const sw = targets.find(target => target.type === 'service_worker' && target.url.includes(config.extensionId))
    let workerSummary = null
    if(sw) {
        workerSummary = await evaluate(sw.webSocketDebuggerUrl, `(${async function inspectWorker(bucketCount) {
            const keys = ['mbSpaceMapLayoutVersion', 'mbCoordinatorRunsLayoutVersion', 'mbCoordinatorQueue', 'mbSpacePendingNukedPosts', 'mbCoordinatorRuns']
            for (let i = 0; i < bucketCount; i += 1) keys.push(`mbSpacePendingNukedPosts.b${i.toString(16).padStart(2, '0')}`, `mbCoordinatorRuns.b${i.toString(16).padStart(2, '0')}`)
            const storage = await chrome.storage.local.get(keys)
            // Space maps and the run list are kept in 32 buckets each once their layout marker is 2 (1437+). Rebuild each whole map.
            const readBucketed = (base, layoutKey) => {
                if (storage[layoutKey] !== 2) return storage[base] || {}
                const merged = {}
                for (let i = 0; i < bucketCount; i += 1) Object.assign(merged, storage[`${base}.b${i.toString(16).padStart(2, '0')}`] || {})
                return merged
            }
            const pending = readBucketed('mbSpacePendingNukedPosts', 'mbSpaceMapLayoutVersion')
            const queue = storage.mbCoordinatorQueue || {}
            const bySpace = {}
            const addSpace = key => bySpace[key] || (bySpace[key] = {
                pendingPosts: 0,
                pendingRemaining: 0,
                queued: 0,
                active: 0,
                terminal: 0,
                canceled: 0,
                failed: 0,
                other: 0,
                runIds: {}
            })
            for(const record of Object.values(pending)) {
                const key = record?.spaceKey || ''
                if(!key) continue
                const item = addSpace(key)
                item.pendingPosts += 1
                item.pendingRemaining += Array.isArray(record.remainingUrls) ? record.remainingUrls.length : 0
            }
            const terminalStatuses = new Set(['succeeded', 'failed', 'canceled'])
            const activeStatuses = new Set(['opening', 'active', 'acting', 'settling', 'tab-opening', 'tab-opened', 'page-ready', 'muting', 'blocking'])
            for(const item of Object.values(queue)) {
                const key = item?.source?.spaceKey || ''
                if(!key) continue
                const target = addSpace(key)
                const status = `${item?.status || ''}`.trim()
                if(status === 'queued') target.queued += 1
                else if(activeStatuses.has(status)) target.active += 1
                else if(status === 'canceled') target.canceled += 1
                else if(status === 'failed') target.failed += 1
                else if(terminalStatuses.has(status)) target.terminal += 1
                else target.other += 1
                if(item?.runId) target.runIds[item.runId] = (target.runIds[item.runId] || 0) + 1
            }
            const tabs = await chrome.tabs.query({})
            const profileTabs = tabs.filter(tab => /^https:\/\/www\.quora\.com\/profile\//i.test(tab.url || '')).map(tab => ({
                id: tab.id,
                active: tab.active,
                title: tab.title || '',
                url: tab.url || ''
            }))
            return {
                bySpace,
                profileTabCount: profileTabs.length,
                profileTabs,
                totalQueue: Object.keys(queue).length,
                totalPendingPosts: Object.keys(pending).length
            }
        }})(${SPACE_MAP_BUCKET_COUNT})`)
    }

    console.log(JSON.stringify({pageSummaries, workerSummary}, null, 2))
})
