#!/usr/bin/env node

const {gzipSync, gunzipSync} = require('fflate')
const {
    hydrateSegmentedWalStore,
    isSegmentedWalStorageMeta,
    recoverProjectedState
} = require('../../shared/js/walSnapshotStore')

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

// Matches sw.js's COORDINATOR_QUEUE_WAL_SNAPSHOT_CODEC exactly -- production
// checkpoints written since v1.6.1380 are gzip-compressed, so any tool
// reading one back via the raw walSnapshotStore API directly (bypassing
// sw.js's own codec-aware wrapper functions) needs this to decode it.
const QUEUE_WAL_SNAPSHOT_CODEC_OPTIONS = {
    codec: {
        name: 'gzip',
        compress: bytes => gzipSync(bytes),
        decompress: bytes => gunzipSync(bytes)
    }
}

const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'
const COORDINATOR_QUEUE_WAL_KEY = 'mbCoordinatorQueueWal'
const COORDINATOR_QUEUE_WAL_META_KEY = `${COORDINATOR_QUEUE_WAL_KEY}.meta`
const PROFILE_NUKE_PROGRESS_VIEW_KEY = 'mbProfileNukeProgressView'
const PROFILE_NUKE_PROGRESS_SHARD_PREFIX = 'mbProfileNukeProgressShard.'

function normalize(value) {
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

function recoverQueue(stored = {}) {
    const rawQueue = stored[COORDINATOR_QUEUE_KEY] || {}
    const meta = stored[COORDINATOR_QUEUE_WAL_META_KEY] || null
    let store = null
    let hydrate = null
    if(isSegmentedWalStorageMeta(meta)) {
        hydrate = hydrateSegmentedWalStore(stored, {
            baseKey: COORDINATOR_QUEUE_WAL_KEY,
            fallbackStore: stored[COORDINATOR_QUEUE_WAL_KEY] || null
        })
        if(hydrate?.ok === true) store = hydrate.store
        else return {queue: rawQueue, recovered: false, reason: hydrate?.reason || 'segmented-hydrate-failed', hydrate}
    }
    else if(stored[COORDINATOR_QUEUE_WAL_KEY]) {
        store = stored[COORDINATOR_QUEUE_WAL_KEY]
    }

    if(!store) return {queue: rawQueue, recovered: false, reason: 'missing-wal'}
    const recovered = recoverProjectedState(store, [], QUEUE_WAL_SNAPSHOT_CODEC_OPTIONS)
    if(recovered?.recovered !== true) {
        return {queue: rawQueue, recovered: false, reason: recovered?.reason || 'wal-recovery-failed', hydrate, wal: recovered}
    }
    return {
        queue: recovered?.projected?.state?.queue || recovered?.state?.queue || {},
        recovered: true,
        reason: '',
        hydrate,
        wal: {
            generationId: recovered.generationId,
            applied: recovered?.projected?.applied?.length || 0,
            ignored: recovered?.projected?.ignored?.length || 0,
            checkpointSeq: recovered?.checkpoint?.snapshotSeq || 0,
            nextSeq: store?.meta?.nextSeq || 0,
            activeGenerationId: store?.meta?.activeCheckpoint || ''
        }
    }
}

function getProgressRecords(stored = {}) {
    const progress = {}
    const viewRecords = stored[PROFILE_NUKE_PROGRESS_VIEW_KEY]?.records || {}
    Object.assign(progress, viewRecords)
    for(const [key, value] of Object.entries(stored || {})) {
        if(!key.startsWith(PROFILE_NUKE_PROGRESS_SHARD_PREFIX)) continue
        Object.assign(progress, value?.records || {})
    }
    return progress
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = `${getOption('needle', process.env.MB_QUEUE_NEEDLE || '')}`.toLowerCase()
    const statusFilter = `${getOption('status', '')}`.trim()
    const limit = Number.parseInt(getOption('limit', '10'), 10) || 10
    const targets = await getTargets(config)
    const extensionPrefix = `chrome-extension://${config.extensionId}/`
    const dashboardUrl = `${extensionPrefix}coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(extensionPrefix))
    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const stored = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function readStorage() {
        return chrome.storage.local.get(null)
    }})()`, 60000)
    const {queue, recovered, reason, wal} = recoverQueue(stored || {})
    const progress = getProgressRecords(stored || {})
    const tabs = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function readTabs() {
        return chrome.tabs.query({})
    }})()`, 30000)
    const counts = {}
    const authoritativeCounts = {}
    for(const item of Object.values(queue || {})) {
        const status = `${item?.status || ''}`.trim()
        counts[status] = (counts[status] || 0) + 1
        if(item?.serviceWorkerOwned === true || `${item?.executorOwner || ''}` === 'service-worker') {
            authoritativeCounts[status] = (authoritativeCounts[status] || 0) + 1
        }
    }
    const matches = Object.entries(queue || {}).filter(([key, item]) => {
        if(statusFilter && `${item?.status || ''}`.trim() !== statusFilter) return false
        if(!needle) return true
        return [
            key,
            item?.targetProfileHref || '',
            item?.requestedUrl || '',
            item?.source?.pageUrl || '',
            item?.runId || '',
            item?.status || '',
            item?.error || '',
            item?.finalError || ''
        ].join('\n').toLowerCase().includes(needle)
    }).slice(0, limit).map(([key, item]) => {
        const href = item?.targetProfileHref || item?.requestedUrl || key
        const normalizedHref = normalize(href)
        return {
            key,
            queue: item,
            progress: progress[normalizedHref] || null,
            liveTabs: (tabs || [])
                .filter(tab => normalize(tab.url || '') === normalizedHref)
                .map(tab => ({
                    id: tab.id,
                    active: !!tab.active,
                    status: tab.status || '',
                    title: tab.title || '',
                    url: tab.url || ''
                }))
        }
    })

    console.log(JSON.stringify({
        needle,
        statusFilter,
        recovered,
        reason,
        rowCount: Object.keys(queue || {}).length,
        counts,
        authoritativeCounts,
        matchedCount: matches.length,
        wal,
        items: matches
    }, null, 2))
})
