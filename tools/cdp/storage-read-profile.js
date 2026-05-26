#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

const DEFAULT_KEYS = [
    'mbCoordinatorQueueView',
    'mbCoordinatorQueue',
    'mbProfileNukeProgress',
    'mbCoordinatorRuns',
    'mbCoordinatorEvents',
    'mbQueueWakeupMetrics',
    'mbSpaceRegistry',
    'mbSpacePendingNukedPosts',
    'mbSpaceNukedPosts',
    'mbOwnedTabState',
    'mbCoordinatorPaused',
    'mbCoordinatorRetryFailedEnabled'
]

function parseKeys() {
    const raw = getOption('keys', '')
    if(!raw) return DEFAULT_KEYS
    return raw.split(',').map(key => key.trim()).filter(Boolean)
}

function parseBooleanOption(name) {
    return process.argv.includes(`--${name}`) || getOption(name, '') === 'true'
}

function findExtensionTarget(targets = [], config = getCdpConfig()) {
    const extensionPrefix = `chrome-extension://${config.extensionId}/`
    return targets.find(target => target.type === 'page' && target.url === `${extensionPrefix}coordinator.html`) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(extensionPrefix)) ||
        targets.find(target => target.type === 'service_worker' && (target.url || '').startsWith(extensionPrefix))
}

runMain(async () => {
    const config = getCdpConfig()
    const keys = parseKeys()
    const includeFull = parseBooleanOption('include-full')
    const targets = await getTargets(config)
    const target = findExtensionTarget(targets, config)

    if(!target) {
        console.log(JSON.stringify({extensionTarget: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(target.webSocketDebuggerUrl, `(${async function profileStorageReads(keysToRead, includeFullRead) {
        function byteSize(value) {
            try {
                return new TextEncoder().encode(JSON.stringify(value)).length
            }
            catch {
                return 0
            }
        }

        function entryCount(value) {
            if(Array.isArray(value)) return value.length
            if(value && typeof value === 'object') return Object.keys(value).length
            return value === undefined ? 0 : 1
        }

        async function timed(label, read) {
            const startedAt = performance.now()
            const value = await read()
            const durationMs = performance.now() - startedAt
            return {label, value, durationMs}
        }

        const bytesInUse = {}
        if(chrome.storage.local.getBytesInUse) {
            for(const key of keysToRead) {
                const measured = await timed(`bytes:${key}`, () => chrome.storage.local.getBytesInUse(key))
                bytesInUse[key] = {
                    bytes: measured.value,
                    durationMs: Math.round(measured.durationMs * 10) / 10
                }
            }
        }

        const reads = []
        for(const key of keysToRead) {
            const measured = await timed(key, () => chrome.storage.local.get(key))
            const value = measured.value ? measured.value[key] : undefined
            reads.push({
                key,
                present: value !== undefined,
                bytes: byteSize(value),
                nativeBytesInUse: bytesInUse[key]?.bytes ?? null,
                entries: entryCount(value),
                durationMs: Math.round(measured.durationMs * 10) / 10
            })
        }

        let fullRead = null
        if(includeFullRead) {
            const measured = await timed('full', () => chrome.storage.local.get(null))
            fullRead = {
                keyCount: Object.keys(measured.value || {}).length,
                bytes: byteSize(measured.value),
                entries: entryCount(measured.value),
                durationMs: Math.round(measured.durationMs * 10) / 10
            }
        }

        return {
            reads: reads.sort((left, right) => right.durationMs - left.durationMs || right.bytes - left.bytes),
            fullRead
        }
    }})( ${JSON.stringify(keys)}, ${JSON.stringify(includeFull)} )`, 45000)

    console.log(JSON.stringify({
        extensionTarget: true,
        target: {
            id: target.id,
            type: target.type,
            title: target.title,
            url: target.url
        },
        includeFull,
        ...result
    }, null, 2))
})
