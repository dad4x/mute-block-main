#!/usr/bin/env node

const {SPACE_MAP_BUCKET_COUNT} = require("../../shared/js/storageKeys")
const zlib = require('node:zlib')
const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    readProfileNukeProgressFromWorker,
    runMain
} = require('./lib/cdp')
const {
    byteSize,
    decodeCheckpointSnapshot,
    encodeCheckpointSnapshot,
    estimateStateBytes
} = require('../../shared/js/walSnapshotStore')

function makeZstdCodec(level) {
    return {
        name: `zstd-${level}`,
        compress(bytes) {
            return zlib.zstdCompressSync(Buffer.from(bytes), {
                params: {
                    [zlib.constants.ZSTD_c_compressionLevel]: level
                }
            })
        },
        decompress(bytes) {
            return zlib.zstdDecompressSync(Buffer.from(bytes))
        }
    }
}

function makeGzipCodec(level) {
    return {
        name: `gzip-${level}`,
        compress(bytes) {
            return zlib.gzipSync(Buffer.from(bytes), {level})
        },
        decompress(bytes) {
            return zlib.gunzipSync(Buffer.from(bytes))
        }
    }
}

function makeCodec(name, level) {
    if(name === 'zstd') return makeZstdCodec(level)
    if(name === 'gzip') return makeGzipCodec(Math.min(9, Math.max(1, level)))
    throw new Error(`unknown codec ${name}`)
}

function parseList(value = '') {
    return `${value || ''}`
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
}

function hrMs(start) {
    return Number(process.hrtime.bigint() - start) / 1000000
}

function round(value, digits = 2) {
    const scale = 10 ** digits
    return Math.round(value * scale) / scale
}

function summarizeRun(state, codec, iterations) {
    let encoded = null
    let encodeMs = 0
    let decodeMs = 0

    for(let index = 0; index < iterations; index += 1) {
        const encodeStart = process.hrtime.bigint()
        encoded = encodeCheckpointSnapshot(state, {codec})
        encodeMs += hrMs(encodeStart)

        const decodeStart = process.hrtime.bigint()
        const decoded = decodeCheckpointSnapshot(encoded, {codec})
        decodeMs += hrMs(decodeStart)
        if(!decoded.ok) {
            throw new Error(`decode failed for ${codec.name}: ${decoded.reason}`)
        }
    }

    const rawBytes = encoded.uncompressedBytes
    const compressedBytes = encoded.compressedBytes
    const base64Bytes = encoded.base64Bytes
    const checkpointBytes = byteSize(encoded)

    return {
        codec: codec.name,
        iterations,
        rawBytes,
        rawKiB: round(rawBytes / 1024, 1),
        compressedBytes,
        compressedKiB: round(compressedBytes / 1024, 1),
        base64Bytes,
        base64KiB: round(base64Bytes / 1024, 1),
        checkpointBytes,
        checkpointKiB: round(checkpointBytes / 1024, 1),
        compressionRatioPct: round(compressedBytes / rawBytes * 100, 1),
        base64StorageRatioPct: round(base64Bytes / rawBytes * 100, 1),
        checkpointStorageRatioPct: round(checkpointBytes / rawBytes * 100, 1),
        encodeAvgMs: round(encodeMs / iterations, 2),
        decodeAvgMs: round(decodeMs / iterations, 2)
    }
}

async function readLiveStorage(config) {
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const targets = await getTargets(config)
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        throw new Error('extension page not found')
    }

    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function readStorage() {
        const storage = await chrome.storage.local.get(null)
        const nativeBytesInUse = chrome.storage.local.getBytesInUse
            ? await chrome.storage.local.getBytesInUse(null)
            : null
        return {storage, nativeBytesInUse}
    }})()`, 30000)

    return {
        target: {
            id: extensionPage.id,
            title: extensionPage.title,
            type: extensionPage.type,
            url: extensionPage.url
        },
        storage: result.storage || {},
        nativeBytesInUse: result.nativeBytesInUse
    }
}

// Space maps and the run list are stored in 32 buckets each once their layout marker is 2 (1437+). Rebuild the whole map.
function readBucketedMap(storage = {}, baseKey = '', layoutKey = '') {
    if (storage[layoutKey] !== 2) return storage[baseKey] || {}
    const merged = {}
    for (let i = 0; i < SPACE_MAP_BUCKET_COUNT; i += 1) Object.assign(merged, storage[`${baseKey}.b${i.toString(16).padStart(2, '0')}`] || {})
    return merged
}

function buildDatasets(storage = {}, progressRecords = {}) {
    const recoveryCritical = {
        queue: storage.mbCoordinatorQueue || {},
        runs: readBucketedMap(storage, 'mbCoordinatorRuns', 'mbCoordinatorRunsLayoutVersion'),
        progressView: {records: progressRecords, total: Object.keys(progressRecords).length},
        // Coordinator events are no longer stored (1442); they live in the flight recorder, so this set is empty.
        events: []
    }
    const userMemory = {
        mbSpaceNukedPosts: readBucketedMap(storage, 'mbSpaceNukedPosts', 'mbSpaceMapLayoutVersion')
    }
    const full = storage

    return [
        {name: 'recoveryCritical', state: recoveryCritical},
        {name: 'userMemory', state: userMemory},
        {name: 'fullStorage', state: full}
    ]
}

runMain(async () => {
    const config = getCdpConfig()
    const iterations = Number.parseInt(getOption('iterations', process.env.MB_BENCH_ITERATIONS || '20'), 10) || 20
    const codecNames = parseList(getOption('codecs', process.env.MB_BENCH_CODECS || 'gzip'))
    const levels = parseList(getOption('levels', process.env.MB_BENCH_LEVELS || process.env.MB_ZSTD_LEVELS || '1,3,6,9'))
        .map(value => Number.parseInt(value.trim(), 10))
        .filter(Number.isFinite)
    const codecs = codecNames.flatMap(codecName => levels.map(level => makeCodec(codecName, level)))
    const live = await readLiveStorage(config)
    const progressRecords = await readProfileNukeProgressFromWorker(config)
    const datasets = buildDatasets(live.storage, progressRecords)

    const results = datasets.map(dataset => ({
        name: dataset.name,
        entryCounts: Object.fromEntries(Object.entries(dataset.state)
            .map(([key, value]) => [
                key,
                value && typeof value === 'object'
                    ? Object.keys(value).length
                    : 0
            ])),
        byteEstimate: estimateStateBytes(dataset.state),
        results: codecs.map(codec => summarizeRun(dataset.state, codec, iterations))
    }))

    console.log(JSON.stringify({
        target: live.target,
        nativeBytesInUse: live.nativeBytesInUse,
        nativeKiBInUse: live.nativeBytesInUse ? round(live.nativeBytesInUse / 1024, 1) : null,
        iterations,
        codecs: codecNames,
        levels,
        results
    }, null, 2))
})
