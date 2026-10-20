#!/usr/bin/env node

const {evaluate, getCdpConfig, getOption, getTargets, readProfileNukeProgressFromWorker, runMain} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_SPACE_NEEDLE || 'theobvioustrollshootinggallery').toLowerCase()
    const targets = await getTargets(config)
    const pages = targets.filter(target => target.type === 'page' && `${target.url}\n${target.title}`.toLowerCase().includes(needle))
    const serviceWorker = targets.find(target => target.type === 'service_worker' && target.url.includes(config.extensionId))

    const pageResults = []
    for(const page of pages) {
        const inspect = await evaluate(page.webSocketDebuggerUrl, `(${function inspectPage() {
            const text = element => `${element?.innerText || element?.textContent || ''}`.replace(/\s+/g, ' ').trim()
            const button = document.querySelector('.mb-ext_space-feed-nuke-btn')
            const main = document.querySelector('#mainContent, main, [role="main"]')
            const canonical = document.querySelector('link[rel="canonical"]')?.href || ''
            return {
                url: location.href,
                title: document.title,
                canonical,
                readyState: document.readyState,
                buttonText: text(button),
                buttonState: button?.dataset?.mbNukeState || '',
                buttonDisabled: !!button?.disabled,
                buttonUrls: button?.dataset?.mbSpaceFeedUrls || '',
                mainDataset: {...(main?.dataset || {})},
                counts: {
                    topButtons: document.querySelectorAll('.mb-ext_space-feed-nuke-btn').length,
                    postHosts: document.querySelectorAll('.mb-ext_space-feed-post-nuke-host').length,
                    postButtons: document.querySelectorAll('.mb-ext_space-feed-post-nuke-btn').length,
                    timestamps: document.querySelectorAll('a.post_timestamp').length
                }
            }
        }})()`)
        pageResults.push({target: {id: page.id, title: page.title, url: page.url}, inspect})
    }

    let workerResult = null
    if(serviceWorker) {
        const progressRecords = await readProfileNukeProgressFromWorker(config)
        workerResult = await evaluate(serviceWorker.webSocketDebuggerUrl, `(${async function inspectWorker(needle, progress) {
            const storage = await chrome.storage.local.get({
                mbSpacePendingNukedPosts: {},
                mbCoordinatorQueue: {},
                mbCoordinatorRuns: {}
            })
            const pending = storage.mbSpacePendingNukedPosts || {}
            const queue = storage.mbCoordinatorQueue || {}
            const runs = storage.mbCoordinatorRuns || {}
            const tabs = await chrome.tabs.query({})
            const spaceTabs = tabs
                .filter(tab => `${tab.url || ''}\n${tab.title || ''}`.toLowerCase().includes(needle))
                .map(tab => ({
                    id: tab.id,
                    windowId: tab.windowId,
                    active: tab.active,
                    title: tab.title || '',
                    url: tab.url || ''
                }))
            const pendingForNeedle = Object.entries(pending)
                .filter(([, record]) => `${record?.spaceUrl || ''}\n${record?.spaceKey || ''}`.toLowerCase().includes(needle))
                .map(([postKey, record]) => ({
                    postKey,
                    spaceKey: record.spaceKey || '',
                    spaceUrl: record.spaceUrl || '',
                    remaining: Array.isArray(record.remainingUrls) ? record.remainingUrls.length : 0,
                    remainingUrls: Array.isArray(record.remainingUrls) ? record.remainingUrls : [],
                    jobKeys: Array.isArray(record.jobKeys) ? record.jobKeys : [],
                    jobKeysByProfileHref: record.jobKeysByProfileHref || {},
                    resolverPending: record.resolverPending === true
                }))
            const queueBySource = Object.entries(queue)
                .filter(([, item]) => `${item?.source?.pageUrl || ''}\n${item?.source?.spaceKey || ''}`.toLowerCase().includes(needle))
                .map(([key, item]) => ({
                    key,
                    status: item.status || '',
                    target: item.targetProfileHref || item.requestedUrl || '',
                    sourcePage: item?.source?.pageUrl || '',
                    runId: item.runId || ''
                }))
            const pendingHrefs = new Set(pendingForNeedle.flatMap(record => record.remainingUrls || []))
            const pendingHrefDetails = Array.from(pendingHrefs).map(href => ({
                href,
                queue: queue[href] || null,
                progress: progress[href] || null
            }))
            const owned = spaceTabs.map(tab => {
                const ownedIds = Array.from((typeof ownedTabIdsByParent !== 'undefined' && ownedTabIdsByParent.get(tab.id)) || [])
                const active = typeof activeQueuedTabs !== 'undefined'
                    ? Array.from(activeQueuedTabs).filter(childId => owningParentByChild.get(childId) === tab.id)
                    : []
                const queued = typeof queuedTabActions !== 'undefined'
                    ? queuedTabActions.filter(action => action.ownerTabId === tab.id).map(action => ({
                        url: action.url || action.profileHref || '',
                        requestedUrl: action.requestedUrl || '',
                        runId: action.runId || '',
                        sourcePage: action.source?.pageUrl || '',
                        sourceSpaceKey: action.source?.spaceKey || ''
                    }))
                    : []
                return {tabId: tab.id, ownedIds, active, queued}
            })
            return {
                spaceTabs,
                pendingForNeedle,
                pendingHrefDetails,
                queueBySource,
                owned,
                counts: {
                    pendingPosts: Object.keys(pending).length,
                    queue: Object.keys(queue).length,
                    runs: Object.keys(runs).length
                }
            }
        }})( ${JSON.stringify(needle)}, ${JSON.stringify(progressRecords)} )`)
    }

    console.log(JSON.stringify({needle, pageCount: pages.length, pageResults, workerResult}, null, 2))
})
