#!/usr/bin/env node

const {
    getWalRecordsForGeneration,
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

const COORDINATOR_QUEUE_WAL_KEY = 'mbCoordinatorQueueWal'
const COORDINATOR_QUEUE_WAL_META_KEY = `${COORDINATOR_QUEUE_WAL_KEY}.meta`

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

function recordMatches(record = {}, needle = '') {
    if(!needle) return true
    const text = [
        record.id,
        record.key,
        record.rowKey,
        record.dedupeKey,
        record.operationKind,
        record.reason,
        record.status,
        record.attemptId,
        record.next?.targetProfileHref,
        record.next?.requestedUrl,
        record.next?.status,
        record.previous?.targetProfileHref,
        record.previous?.requestedUrl,
        record.previous?.status
    ].join('\n').toLowerCase()
    return text.includes(needle) || normalize(record.key || '') === normalize(needle)
}

runMain(async () => {
    const config = getCdpConfig()
    const needle = `${getOption('needle', process.env.MB_QUEUE_NEEDLE || '')}`.toLowerCase()
    const limit = Number.parseInt(getOption('limit', '50'), 10) || 50
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
    const meta = stored?.[COORDINATOR_QUEUE_WAL_META_KEY] || null
    let store = null
    let hydrate = null
    if(isSegmentedWalStorageMeta(meta)) {
        hydrate = hydrateSegmentedWalStore(stored, {
            baseKey: COORDINATOR_QUEUE_WAL_KEY,
            fallbackStore: stored[COORDINATOR_QUEUE_WAL_KEY] || null
        })
        if(hydrate?.ok === true) store = hydrate.store
    }
    else {
        store = stored?.[COORDINATOR_QUEUE_WAL_KEY] || null
    }
    const recovered = store ? recoverProjectedState(store) : null
    const generationId = store?.meta?.activeCheckpoint || recovered?.generationId || ''
    const records = generationId ? getWalRecordsForGeneration(store, generationId) : []
    const matches = records.filter(record => recordMatches(record, needle)).slice(-limit)

    console.log(JSON.stringify({
        needle,
        hasStore: !!store,
        segmented: isSegmentedWalStorageMeta(meta),
        hydrateOk: hydrate ? hydrate.ok === true : null,
        hydrateReason: hydrate?.reason || '',
        recovered: recovered?.recovered === true,
        recoveryReason: recovered?.reason || '',
        generationId,
        checkpointSeq: recovered?.checkpoint?.snapshotSeq || 0,
        nextSeq: store?.meta?.nextSeq || 0,
        recordCount: records.length,
        matchCount: matches.length,
        matches
    }, null, 2))
})
