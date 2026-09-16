#!/usr/bin/env node

// Sibling of recover-queue-wal-from-raw.js for installs where the
// monolithic `mbCoordinatorQueue` raw mirror no longer exists at all (the
// segmented-WAL architecture retired it -- only mbCoordinatorQueueView, a
// derived dashboard-facing projection, and the WAL itself remain). That
// raw-mirror-based tool would rebuild from an empty queue and silently wipe
// every row if run against a store in this state, so this variant sources
// the rebuild from mbCoordinatorQueueView.items instead, which carries
// full-fidelity row objects (confirmed by inspecting a live row: actionKind,
// attemptId/attemptNumber, executor fields, runId, source, status, tabId,
// terminalAt, etc. -- everything a coordinator queue row needs).
//
// Use this when a segmented WAL hydrate fails with 'missing-segment' (or
// similar) and mbCoordinatorQueue is absent/empty in storage. Always dry-run
// first (the default) and inspect the output before passing --apply.

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

const COORDINATOR_QUEUE_WAL_KEY = 'mbCoordinatorQueueWal'
const COORDINATOR_QUEUE_WAL_META_KEY = `${COORDINATOR_QUEUE_WAL_KEY}.meta`
const COORDINATOR_QUEUE_VIEW_KEY = 'mbCoordinatorQueueView'

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

function buildQueueFromView(view = null) {
    const items = Array.isArray(view?.items)
        ? view.items
        : Object.values(view?.items || {})
    const queue = {}
    for(const item of items) {
        const key = `${item?.storageKey || item?.dedupeKey || item?.targetProfileHref || ''}`.trim()
        if(!key || !item) continue
        queue[key] = item
    }
    return queue
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
    const view = stored?.[COORDINATOR_QUEUE_VIEW_KEY] || null
    const rebuiltQueue = buildQueueFromView(view)
    const rebuiltRowCount = Object.keys(rebuiltQueue).length
    const viewItemCount = Array.isArray(view?.items) ? view.items.length : Object.keys(view?.items || {}).length

    const previousMeta = existing.meta || stored?.[COORDINATOR_QUEUE_WAL_META_KEY] || stored?.[COORDINATOR_QUEUE_WAL_KEY]?.meta || null
    const previousNextSeq = Number.parseInt(previousMeta?.nextSeq, 10) || 1
    const snapshotSeq = Math.max(0, previousNextSeq - 1)
    const nextSeq = Math.max(previousNextSeq, snapshotSeq + 1)
    const store = makePairedCheckpointStore({queue: rebuiltQueue}, {
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

    // Refuse to apply if rebuilding from the view would lose rows compared
    // to what the view itself already reports -- a mismatch here means
    // something about the view's own shape wasn't understood correctly, and
    // guessing wrong here is how you turn a WAL bug into real data loss.
    const rowCountMismatch = viewItemCount > 0 && rebuiltRowCount !== viewItemCount
    const shouldApply = apply && !rowCountMismatch && (force || existing.recovered !== true)

    let writeResult = null
    if(shouldApply) {
        writeResult = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function recover(payload, retiredKeys) {
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
        reason: !apply
            ? 'missing-apply'
            : rowCountMismatch
                ? 'row-count-mismatch-refusing'
                : existing.recovered === true && !force ? 'existing-wal-recovers' : '',
        existing,
        viewItemCount,
        rebuiltRowCount,
        rowCountMismatch,
        snapshotSeq,
        nextSeq,
        payloadKeys,
        retiredKeys,
        writeResult
    }, null, 2))
})
