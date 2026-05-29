#!/usr/bin/env node

const {
    buildSegmentedWalStoragePayload,
    hydrateSegmentedWalStore,
    isSegmentedWalStorageMeta,
    makePairedCheckpointStore,
    recoverProjectedState
} = require('../../shared/js/walSnapshotStore')

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'
const COORDINATOR_QUEUE_WAL_KEY = 'mbCoordinatorQueueWal'
const COORDINATOR_QUEUE_WAL_META_KEY = `${COORDINATOR_QUEUE_WAL_KEY}.meta`

function getWalPhysicalKeys(stored = {}) {
    return Object.keys(stored || {})
        .filter(key => key === COORDINATOR_QUEUE_WAL_KEY || key.startsWith(`${COORDINATOR_QUEUE_WAL_KEY}.`))
}

function readExistingRecovery(stored = {}) {
    const meta = stored[COORDINATOR_QUEUE_WAL_META_KEY] || null
    if(isSegmentedWalStorageMeta(meta)) {
        const hydrated = hydrateSegmentedWalStore(stored, {
            baseKey: COORDINATOR_QUEUE_WAL_KEY,
            fallbackStore: stored[COORDINATOR_QUEUE_WAL_KEY] || null
        })
        if(hydrated?.ok !== true) {
            return {
                recovered: false,
                reason: hydrated?.reason || 'segmented-hydrate-failed',
                meta
            }
        }
        const recovered = recoverProjectedState(hydrated.store)
        return {
            recovered: recovered?.recovered === true,
            reason: recovered?.reason || '',
            meta,
            rowCount: Object.keys(recovered?.projected?.state?.queue || {}).length
        }
    }

    if(stored[COORDINATOR_QUEUE_WAL_KEY]) {
        const recovered = recoverProjectedState(stored[COORDINATOR_QUEUE_WAL_KEY])
        return {
            recovered: recovered?.recovered === true,
            reason: recovered?.reason || '',
            meta: stored[COORDINATOR_QUEUE_WAL_KEY]?.meta || null,
            rowCount: Object.keys(recovered?.projected?.state?.queue || {}).length
        }
    }

    return {
        recovered: false,
        reason: 'missing-wal',
        meta: null
    }
}

runMain(async () => {
    const apply = getOption('apply', '') === 'true' || process.argv.includes('--apply')
    const force = getOption('force', '') === 'true' || process.argv.includes('--force')
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const extensionPrefix = `chrome-extension://${config.extensionId}/`
    const dashboardUrl = `${extensionPrefix}coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(extensionPrefix))
    if(!extensionPage) {
        console.log(JSON.stringify({target: false, reason: 'missing-extension-page'}, null, 2))
        process.exitCode = 1
        return
    }

    const stored = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function readStorage() {
        return chrome.storage.local.get(null)
    }})()`, 60000)
    const existing = readExistingRecovery(stored || {})
    const rawQueue = stored?.[COORDINATOR_QUEUE_KEY] || {}
    const rawRowCount = Object.keys(rawQueue).length
    const previousMeta = existing.meta || stored?.[COORDINATOR_QUEUE_WAL_META_KEY] || stored?.[COORDINATOR_QUEUE_WAL_KEY]?.meta || null
    const previousNextSeq = Number.parseInt(previousMeta?.nextSeq, 10) || 1
    const snapshotSeq = Math.max(0, previousNextSeq - 1)
    const nextSeq = Math.max(previousNextSeq, snapshotSeq + 1)
    const store = makePairedCheckpointStore({queue: rawQueue}, {
        createdAt: Date.now(),
        snapshotSeq,
        nextSeq
    })
    const payload = buildSegmentedWalStoragePayload(store, {
        baseKey: COORDINATOR_QUEUE_WAL_KEY,
        softSwitchAt: 128,
        hardSegmentLimit: 1024,
        updatedAt: Date.now()
    })
    const payloadKeys = Object.keys(payload)
    const retiredKeys = getWalPhysicalKeys(stored)
        .filter(key => !payloadKeys.includes(key))
    const shouldApply = apply && (force || existing.recovered !== true)

    let writeResult = null
    if(shouldApply) {
        writeResult = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function repair(payload, retiredKeys) {
            await chrome.storage.local.set(payload)
            if(retiredKeys.length) await chrome.storage.local.remove(retiredKeys)
            return {
                saved: true,
                payloadKeys: Object.keys(payload).length,
                retiredKeys: retiredKeys.length
            }
        }})(${JSON.stringify(payload)}, ${JSON.stringify(retiredKeys)})`, 60000)
    }

    console.log(JSON.stringify({
        target: {
            id: extensionPage.id,
            type: extensionPage.type || '',
            url: extensionPage.url || ''
        },
        applied: shouldApply,
        dryRun: !shouldApply,
        reason: !apply ? 'missing-apply' : existing.recovered === true && !force ? 'existing-wal-recovers' : '',
        existing,
        rawRowCount,
        snapshotSeq,
        nextSeq,
        payloadKeys,
        retiredKeys,
        writeResult
    }, null, 2))
})
