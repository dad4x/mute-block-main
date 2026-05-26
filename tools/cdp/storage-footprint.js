#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

function byteSize(value) {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function entryStats(value) {
    if(!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
            kind: Array.isArray(value) ? 'array' : typeof value,
            entries: Array.isArray(value) ? value.length : 0,
            avgEntryBytes: 0,
            maxEntryBytes: 0
        }
    }

    const entries = Object.entries(value)
    if(!entries.length) {
        return {kind: 'object', entries: 0, avgEntryBytes: 0, maxEntryBytes: 0}
    }

    const sizes = entries.map(([key, record]) => byteSize({[key]: record}))
    const total = sizes.reduce((sum, size) => sum + size, 0)
    return {
        kind: 'object',
        entries: entries.length,
        avgEntryBytes: Math.round(total / entries.length),
        maxEntryBytes: Math.max(...sizes)
    }
}

function summarizeStorage(storage) {
    const keys = Object.keys(storage || {}).sort()
    const byKey = keys.map(key => {
        const value = storage[key]
        const bytes = byteSize(value)
        const stats = entryStats(value)
        return {
            key,
            bytes,
            kib: Math.round(bytes / 102.4) / 10,
            ...stats
        }
    }).sort((left, right) => right.bytes - left.bytes || left.key.localeCompare(right.key))

    const totalBytes = byKey.reduce((sum, item) => sum + item.bytes, 0)
    return {
        keyCount: byKey.length,
        totalBytes,
        totalKiB: Math.round(totalBytes / 102.4) / 10,
        totalMiB: Math.round(totalBytes / 104857.6) / 10,
        byKey
    }
}

runMain(async () => {
    const config = getCdpConfig()
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const targets = await getTargets(config)
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function readAllStorage() {
        const storage = await chrome.storage.local.get(null)
        const keys = Object.keys(storage || {})
        const nativeBytesInUse = chrome.storage.local.getBytesInUse
            ? await chrome.storage.local.getBytesInUse(null)
            : null
        const nativeBytesByKey = {}
        if(chrome.storage.local.getBytesInUse) {
            for(const key of keys) {
                nativeBytesByKey[key] = await chrome.storage.local.getBytesInUse(key)
            }
        }
        return {storage, nativeBytesInUse, nativeBytesByKey}
    }})()`, 30000)

    const storage = result?.storage || {}
    const summary = summarizeStorage(storage)
    const nativeBytesByKey = result?.nativeBytesByKey || {}
    for(const item of summary.byKey) {
        if(Object.prototype.hasOwnProperty.call(nativeBytesByKey, item.key)) {
            item.nativeBytesInUse = nativeBytesByKey[item.key]
            item.nativeKiBInUse = Math.round(nativeBytesByKey[item.key] / 102.4) / 10
        }
    }

    console.log(JSON.stringify({
        extensionPage: true,
        target: {
            id: extensionPage.id,
            title: extensionPage.title,
            type: extensionPage.type,
            url: extensionPage.url
        },
        nativeBytesInUse: result?.nativeBytesInUse ?? null,
        nativeKiBInUse: result?.nativeBytesInUse
            ? Math.round(result.nativeBytesInUse / 102.4) / 10
            : null,
        nativeMiBInUse: result?.nativeBytesInUse
            ? Math.round(result.nativeBytesInUse / 104857.6) / 10
            : null,
        ...summary
    }, null, 2))
})
