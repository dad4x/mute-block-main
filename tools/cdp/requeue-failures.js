#!/usr/bin/env node

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
    resolveCdpConfig,
    runMain
} = require('./lib/cdp')

const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'
const COORDINATOR_QUEUE_VIEW_KEY = 'mbCoordinatorQueueView'
const COORDINATOR_QUEUE_WAL_KEY = 'mbCoordinatorQueueWal'
const COORDINATOR_QUEUE_WAL_META_KEY = `${COORDINATOR_QUEUE_WAL_KEY}.meta`

function recoverAuthoritativeQueue(stored = {}) {
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
        else {
            return {
                queue: rawQueue,
                recovered: false,
                source: 'raw-queue',
                reason: hydrate?.reason || 'segmented-hydrate-failed',
                hydrate
            }
        }
    }
    else if(stored[COORDINATOR_QUEUE_WAL_KEY]) {
        store = stored[COORDINATOR_QUEUE_WAL_KEY]
    }

    if(!store) {
        return {
            queue: rawQueue,
            recovered: false,
            source: 'raw-queue',
            reason: 'missing-wal'
        }
    }

    const recovered = recoverProjectedState(store)
    if(recovered?.recovered !== true) {
        return {
            queue: rawQueue,
            recovered: false,
            source: 'raw-queue',
            reason: recovered?.reason || 'wal-recovery-failed',
            hydrate,
            wal: recovered
        }
    }

    return {
        queue: recovered?.projected?.state?.queue || recovered?.state?.queue || {},
        recovered: true,
        source: 'wal-recovered-authority',
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

function itemMatchesNeedle(key = '', item = null, needle = '') {
    if(!item) return false
    if(!needle) return true
    return [
        key,
        item.sourceType || '',
        item?.source?.type || '',
        item?.source?.pageUrl || '',
        item.runId || '',
        item.targetProfileHref || '',
        item.requestedUrl || '',
        item.error || '',
        item.finalError || ''
    ].join('\n').toLowerCase().includes(needle)
}

function selectFailedItems(stored = {}, options = {}) {
    const needle = `${options.needle || ''}`.toLowerCase()
    const limit = Math.max(0, Number.parseInt(options.limit || '0', 10) || 0)
    const authority = recoverAuthoritativeQueue(stored)
    const queue = authority.queue || {}
    const view = stored[COORDINATOR_QUEUE_VIEW_KEY] && typeof stored[COORDINATOR_QUEUE_VIEW_KEY] === 'object'
        ? stored[COORDINATOR_QUEUE_VIEW_KEY]
        : {}
    const viewItems = Array.isArray(view.items) ? view.items : []
    const compactFailedMatches = viewItems.filter(item =>
        item?.status === 'failed' && itemMatchesNeedle(item.storageKey || '', item, needle))

    const selectedItems = Object.entries(queue)
        .filter(([key, item]) => item?.status === 'failed' && itemMatchesNeedle(key, item, needle))
        .slice(0, limit > 0 ? limit : undefined)
        .map(([key, item]) => ({
            key,
            profileHref: item.targetProfileHref || item.requestedUrl || '',
            coordinatorKey: item.coordinatorKey || item.dedupeKey || key || ''
        }))

    return {
        ...authority,
        selectedItems,
        compactFailedMatches: compactFailedMatches.length,
        compactIgnored: compactFailedMatches.length > 0,
        rawQueueRows: Object.keys(stored[COORDINATOR_QUEUE_KEY] || {}).length,
        authoritativeRows: Object.keys(queue || {}).length
    }
}

async function main() {
    const config = await resolveCdpConfig(getCdpConfig())
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || '').toLowerCase()
    const maxConcurrent = Math.max(1, Number.parseInt(getOption('max-concurrent', '1'), 10) || 1)
    const limit = Math.max(0, Number.parseInt(getOption('limit', process.env.MB_QUEUE_LIMIT || '0'), 10) || 0)
    const messageTimeoutMs = Math.max(1000, Number.parseInt(getOption('message-timeout-ms', '60000'), 10) || 60000)
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const stored = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function readStorage() {
        return chrome.storage.local.get(null)
    }})()`, 60000)
    const selection = selectFailedItems(stored || {}, {needle, limit})
    const effectiveItems = selection.selectedItems
    const profileHrefs = effectiveItems.map(item => item.profileHref).filter(Boolean)
    const coordinatorKeys = effectiveItems.map(item => item.coordinatorKey || item.key).filter(Boolean)
    const storageKeys = effectiveItems.map(item => item.key).filter(Boolean)

    if(!effectiveItems.length) {
        console.log(JSON.stringify({
            selected: 0,
            queued: 0,
            reason: 'no-authoritative-failures',
            source: selection.source,
            recovered: selection.recovered,
            recoveryReason: selection.reason,
            rawQueueRows: selection.rawQueueRows,
            authoritativeRows: selection.authoritativeRows,
            compactFailedMatches: selection.compactFailedMatches,
            compactIgnored: selection.compactIgnored,
            wal: selection.wal || null
        }, null, 2))
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function requeueFailures(profileHrefs, coordinatorKeys, storageKeys, maxConcurrent, messageTimeoutMs) {
        return new Promise(resolve => {
            let settled = false
            const finish = value => {
                if(settled) return
                settled = true
                resolve(value)
            }
            setTimeout(() => finish({
                response: null,
                timedOut: true,
                lastError: ''
            }), messageTimeoutMs)
            chrome.runtime.sendMessage({
                action: 'requeue-coordinator-failed',
                profileHrefs,
                coordinatorKeys,
                storageKeys,
                maxConcurrent
            }, response => finish({
                response: response || null,
                lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : ''
            }))
        })
    }})( ${JSON.stringify(profileHrefs)}, ${JSON.stringify(coordinatorKeys)}, ${JSON.stringify(storageKeys)}, ${JSON.stringify(maxConcurrent)}, ${JSON.stringify(messageTimeoutMs)} )`, messageTimeoutMs + 5000)

    console.log(JSON.stringify({
        ...result,
        requested: effectiveItems.length,
        profileHrefs: profileHrefs.length,
        coordinatorKeys: coordinatorKeys.length,
        storageKeys: storageKeys.length,
        source: selection.source,
        recovered: selection.recovered,
        recoveryReason: selection.reason,
        rawQueueRows: selection.rawQueueRows,
        authoritativeRows: selection.authoritativeRows,
        compactFailedMatches: selection.compactFailedMatches,
        compactIgnored: selection.compactIgnored,
        wal: selection.wal || null
    }, null, 2))
}

if(require.main === module) {
    runMain(main)
}

module.exports = {
    recoverAuthoritativeQueue,
    selectFailedItems,
    itemMatchesNeedle
}
