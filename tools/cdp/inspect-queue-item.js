#!/usr/bin/env node

const {
    COORDINATOR_PAUSED_KEY,
    COORDINATOR_QUEUE_KEY,
    COORDINATOR_RETRY_FAILED_ENABLED_KEY,
    STORAGE_LAYOUT_PREFIX
} = require('../../shared/js/storageKeys')

// The stored names this tool reads: the layout prefix plus the plain key name (storageNamespace.js).
const STORED_NAMES = {
    paused: `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_PAUSED_KEY}`,
    queue: `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_QUEUE_KEY}`,
    retryFailed: `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_RETRY_FAILED_ENABLED_KEY}`
}

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    readProfileNukeProgressFromWorker,
    resolveCdpConfig,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = await resolveCdpConfig(getCdpConfig())
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || '').toLowerCase()
    const limit = Number.parseInt(getOption('limit', '10'), 10) || 10
    const targets = await getTargets(config)
    const serviceWorker = targets.find(target => target.type === 'service_worker' && target.url.includes(config.extensionId))
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    const target = extensionPage || serviceWorker

    if(!target) {
        console.log(JSON.stringify({extensionContext: false}, null, 2))
        process.exitCode = 1
        return
    }

    const progressRecords = await readProfileNukeProgressFromWorker(config)
    const result = await evaluate(target.webSocketDebuggerUrl, `(${async function inspectQueueItem(needle, limit, progress, keys) {
        const storage = await chrome.storage.local.get({
            [keys.paused]: false,
            [keys.queue]: {},
            [keys.retryFailed]: false
        })
        const queue = storage[keys.queue] || {}
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
        const matchesNeedle = (key, item, record) => {
            if(!needle) return true
            return [
                key,
                item?.sourceType || '',
                item?.source?.type || '',
                item?.source?.pageUrl || '',
                item?.source?.spaceKey || '',
                item?.source?.label || '',
                item?.runId || '',
                item?.targetProfileHref || '',
                item?.requestedUrl || '',
                item?.error || '',
                item?.finalError || '',
                item?.event || '',
                record?.profileHref || '',
                record?.profileUrl || '',
                record?.error || '',
                record?.finalError || '',
                record?.event || ''
            ].join('\\n').toLowerCase().includes(needle)
        }
        const progressForItem = (key, item) => {
            const targetHref = normalize(item?.targetProfileHref || item?.requestedUrl || key)
            const direct = progress[key] || progress[item?.targetProfileHref] || progress[item?.requestedUrl]
            const matches = Object.entries(progress)
                .filter(([progressKey, record]) => {
                    if(direct && (record === direct || progressKey === key)) return true
                    const recordHref = normalize(record?.profileHref || record?.profileUrl || progressKey)
                    return targetHref && recordHref === targetHref
                })
                .map(([progressKey, record]) => ({progressKey, record}))
            return direct && !matches.some(entry => entry.record === direct)
                ? [{progressKey: key, record: direct}, ...matches]
                : matches
        }
        const summarizeItem = ([key, item]) => {
            const targetHref = item?.targetProfileHref || item?.requestedUrl || key
            const normalizedTarget = normalize(targetHref)
            const progressMatches = progressForItem(key, item)
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
                queue: item,
                progress: progressMatches.map(entry => ({
                    key: entry.progressKey,
                    record: entry.record
                })),
                liveTabs
            }
        }
        const matched = Object.entries(queue)
            .filter(([key, item]) => progressForItem(key, item)
                .some(entry => matchesNeedle(key, item, entry.record)) || matchesNeedle(key, item, null))
            .slice(0, limit)
            .map(summarizeItem)
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
        return {
            needle,
            paused: !!storage[keys.paused],
            retryFailedEnabled: !!storage[keys.retryFailed],
            matchedCount: matched.length,
            items: matched,
            runtime: {
                queuedActions: runtimeQueuedActions,
                activeQueuedTabs: typeof activeQueuedTabs !== 'undefined' ? Array.from(activeQueuedTabs) : [],
                owned: typeof ownedTabIdsByParent !== 'undefined'
                    ? Array.from(ownedTabIdsByParent.entries()).map(([parentTabId, childIds]) => ({
                        parentTabId,
                        childIds: Array.from(childIds || [])
                    }))
                    : []
            }
        }
    }})( ${JSON.stringify(needle)}, ${JSON.stringify(limit)}, ${JSON.stringify(progressRecords)}, ${JSON.stringify(STORED_NAMES)} )`, 30000)

    console.log(JSON.stringify(result, null, 2))
})
