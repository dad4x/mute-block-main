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
    getTargets,
    runMain
} = require('./lib/cdp')

const COORDINATOR_QUEUE_WAL_KEY = 'mbCoordinatorQueueWal'
const COORDINATOR_QUEUE_WAL_META_KEY = `${COORDINATOR_QUEUE_WAL_KEY}.meta`

const CODEC_OPTIONS = {
    codec: {
        name: 'gzip',
        compress: bytes => gzipSync(bytes),
        decompress: bytes => gunzipSync(bytes)
    }
}

runMain(async () => {
    const config = getCdpConfig()
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

    const meta = stored[COORDINATOR_QUEUE_WAL_META_KEY] || null
    let store = null
    if(isSegmentedWalStorageMeta(meta)) {
        const hydrate = hydrateSegmentedWalStore(stored, {baseKey: COORDINATOR_QUEUE_WAL_KEY})
        if(hydrate?.ok === true) store = hydrate.store
    }
    else if(stored[COORDINATOR_QUEUE_WAL_KEY]) {
        store = stored[COORDINATOR_QUEUE_WAL_KEY]
    }

    const recovered = recoverProjectedState(store, [], CODEC_OPTIONS)
    const queue = recovered?.projected?.state?.queue || {}

    const flagged = []
    for(const [key, item] of Object.entries(queue)) {
        const evidence = Array.isArray(item?.evidence) ? item.evidence : []
        const hasStaleCollector = evidence.some(e => e?.collector === 'profile-links')
        if(hasStaleCollector) {
            flagged.push({
                key,
                status: item?.status,
                createdAt: item?.createdAt,
                runId: item?.runId,
                evidence
            })
        }
    }

    console.log(JSON.stringify({
        totalRows: Object.keys(queue).length,
        flaggedCount: flagged.length,
        flagged
    }, null, 2))
})
