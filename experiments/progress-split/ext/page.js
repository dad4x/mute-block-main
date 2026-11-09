// Stands in for #progress: owns the chrome.storage calls and a dedicated Worker.
const worker = new Worker('worker.js')
const pending = new Map()
let nextId = 0
worker.onmessage = (event) => {
    const resolve = pending.get(event.data.id)
    pending.delete(event.data.id)
    if(resolve) resolve(event.data)
}

function callWorker(message) {
    return new Promise((resolve) => {
        const id = ++nextId
        pending.set(id, resolve)
        worker.postMessage({...message, id})
    })
}

// Answers the service worker's relay request by calling the Worker and returning.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.type !== 'to-worker') return false
    const started = performance.now()
    callWorker({op: 'echo', payload: message.payload}).then((reply) => {
        sendResponse({bytes: reply.bytes, pageMs: performance.now() - started})
    })
    return true
})

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function percentiles(samples) {
    const sorted = [...samples].sort((left, right) => left - right)
    return {
        n: sorted.length,
        medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
        p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
        maxMs: Number(sorted[sorted.length - 1].toFixed(2))
    }
}

async function timeEach(count, fn) {
    const samples = []
    for(let index = 0; index < count; index += 1) {
        const started = performance.now()
        await fn()
        samples.push(performance.now() - started)
    }
    return percentiles(samples)
}

async function seed() {
    const value = 'v'.repeat(100 * 1024)
    await chrome.storage.local.set({probeLocal100k: value, probeLocalSmall: 'small'})
    await chrome.storage.session.set({probeSession100k: value, probeSessionSmall: 'small'})
    return true
}

async function storageSamples(count) {
    return {
        localGet100kb: await timeEach(count, () => chrome.storage.local.get('probeLocal100k')),
        localSetSmall: await timeEach(count, () => chrome.storage.local.set({probeLocalSmall: 'x'})),
        sessionGet100kb: await timeEach(count, () => chrome.storage.session.get('probeSession100k')),
        sessionSetSmall: await timeEach(count, () => chrome.storage.session.set({probeSessionSmall: 'x'}))
    }
}

function chainSamples(count, sizes) {
    return (async () => {
        const result = {}
        for(const size of sizes) {
            const samples = []
            const pageSamples = []
            for(let index = 0; index < count; index += 1) {
                const reply = await chrome.runtime.sendMessage({type: 'chain', size})
                if(!reply?.ok) throw new Error(reply?.error || 'chain failed')
                samples.push(reply.result.totalMs)
                pageSamples.push(reply.result.pageReply.pageMs)
            }
            result[`${size}B`] = {totalRoundTrip: percentiles(samples), pageAndWorker: percentiles(pageSamples)}
        }
        return result
    })()
}

// Storage get started, then CPU work on the Worker (not blocking the page) or
// on the page's main thread (blocking it). Measures how long the storage callback takes.
// Measures when the storage promise resolves, not when the whole step ends,
// so the busy work's own duration is not counted as storage latency.
async function loadProbe(kind, count, busyMs) {
    const samples = []
    for(let index = 0; index < count; index += 1) {
        const started = performance.now()
        let resolvedAt = null
        const pendingGet = chrome.storage.local.get('probeLocal100k').then((value) => {
            resolvedAt = performance.now()
            return value
        })
        if(kind === 'worker') {
            await callWorker({op: 'busy', ms: busyMs})
            await pendingGet
        }
        else {
            const end = performance.now() + busyMs
            while(performance.now() < end) { /* busy main thread */ }
            await pendingGet
        }
        samples.push(resolvedAt - started)
    }
    return percentiles(samples)
}

window.spike = {
    seed,
    storageSamples,
    chainSamples: (count, sizes) => chainSamples(count, sizes),
    loadProbe,
    visibility: () => document.visibilityState,
    sleep
}
