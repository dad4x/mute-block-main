#!/usr/bin/env node

const {COORDINATOR_QUEUE_KEY, STORAGE_LAYOUT_PREFIX} = require("../../shared/js/storageKeys")
const {
    evaluate,
    getCdpConfig,
    getTargets,
    isSpacePageTarget,
    runMain,
    spaceKeyFromUrl
} = require('./lib/cdp')

// The stored name of the queue: the layout prefix plus the plain key name (storageNamespace.js).
const QUEUE_STORED_KEY = `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_QUEUE_KEY}`

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
        workerSummary = await evaluate(sw.webSocketDebuggerUrl, `(${async function inspectWorker(queueKey) {
            const storage = await chrome.storage.local.get([queueKey])
            const queue = storage[queueKey] || {}
            const bySpace = {}
            const addSpace = key => bySpace[key] || (bySpace[key] = {
                queued: 0,
                active: 0,
                terminal: 0,
                canceled: 0,
                failed: 0,
                other: 0,
                runIds: {}
            })
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
                totalQueue: Object.keys(queue).length
            }
        }})(${JSON.stringify(QUEUE_STORED_KEY)})`)
    }

    console.log(JSON.stringify({pageSummaries, workerSummary}, null, 2))
})
