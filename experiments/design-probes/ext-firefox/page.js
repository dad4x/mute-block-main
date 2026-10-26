// Owner page. role=owner takes the 'mb-owner' lock and answers owner requests.
// role=waiter queues for the lock and becomes owner when the holder goes away.
const params = new URLSearchParams(location.search)
const role = params.get('role') || 'viewer'
const PAGE_ID = crypto.randomUUID()
const KEYS = Array.from({length: 141}, (_, index) => `probe-wal-${index}`)
const state = {role, pageId: PAGE_ID, ownerAcquired: false, ownerAcquiredAt: null}
let heartbeat = 0
setInterval(() => { heartbeat += 1 }, 1000)

if(role === 'owner' || role === 'waiter') {
    navigator.locks.request('mb-owner', {mode: 'exclusive'}, async () => {
        state.ownerAcquired = true
        state.ownerAcquiredAt = Date.now()
        return new Promise(() => {})
    })
}

let replyDelayMs = 0
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.type === 'owner-request' && state.ownerAcquired) {
        const reply = {responder: 'owner', pageId: PAGE_ID, bootId: PAGE_ID}
        if(replyDelayMs > 0) {
            setTimeout(() => sendResponse(reply), replyDelayMs)
            return true
        }
        sendResponse(reply)
        return false
    }
    return false
})

const worker = new Worker('worker.js')
const pending = new Map()
let nextId = 0
worker.onmessage = (event) => {
    const resolve = pending.get(event.data.id)
    pending.delete(event.data.id)
    if(resolve) resolve(event.data)
}

function callWorker(message, transfer = []) {
    return new Promise((resolve) => {
        const id = ++nextId
        pending.set(id, resolve)
        worker.postMessage({...message, id}, transfer)
    })
}

function valueFor(index) {
    const records = Array.from({length: 20}, (_, recordIndex) => ({
        k: `k${index}-${recordIndex}`,
        status: 'queued',
        note: crypto.randomUUID().repeat(5)
    }))
    return JSON.stringify({records})
}

async function seedHandoff() {
    const payload = Object.fromEntries(KEYS.map((key, index) => [key, valueFor(index)]))
    await chrome.storage.local.set(payload)
    return {keys: KEYS.length}
}

// Copy variant: the page reads, then posts the entries (structured clone).
async function handoffCopy() {
    const readStarted = performance.now()
    const stored = await chrome.storage.local.get(KEYS)
    const readMs = performance.now() - readStarted
    const entries = Object.entries(stored).map(([key, value]) => ({key, value}))
    const bytes = entries.reduce((total, entry) => total + entry.value.length, 0)
    const postStarted = performance.now()
    const reply = await callWorker({op: 'replay-copy', entries})
    return {variant: 'copy', keys: entries.length, bytes, readMs: Number(readMs.toFixed(2)), copyAndReplayMs: Number((performance.now() - postStarted).toFixed(2)), workerReplayMs: Number(reply.replayMs.toFixed(2)), records: reply.records}
}

// Buffer variant: the page encodes the entries as JSON once and transfers the buffer.
async function handoffBuffer() {
    const readStarted = performance.now()
    const stored = await chrome.storage.local.get(KEYS)
    const readMs = performance.now() - readStarted
    const entries = Object.entries(stored).map(([key, value]) => ({key, value}))
    const bytes = entries.reduce((total, entry) => total + entry.value.length, 0)
    const encodeStarted = performance.now()
    const buffer = new TextEncoder().encode(JSON.stringify(entries)).buffer
    const encodeMs = performance.now() - encodeStarted
    const postStarted = performance.now()
    const reply = await callWorker({op: 'replay-buffer', buffer}, [buffer])
    return {variant: 'buffer', keys: entries.length, bytes, readMs: Number(readMs.toFixed(2)), encodeMs: Number(encodeMs.toFixed(2)), transferAndReplayMs: Number((performance.now() - postStarted).toFixed(2)), workerReplayMs: Number(reply.replayMs.toFixed(2)), records: reply.records}
}

function timingStats(samples) {
    const sorted = [...samples].sort((a, b) => a - b)
    return {medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)), p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)), maxMs: Number(sorted[sorted.length - 1].toFixed(2))}
}

// Times extension tab calls from this page. Run once with the page focused and
// once hidden, to see whether the owner can make tab calls while hidden.
async function tabTiming(iterations) {
    const query = []
    const create = []
    const remove = []
    for(let index = 0; index < iterations; index += 1) {
        let started = performance.now()
        await chrome.tabs.query({})
        query.push(performance.now() - started)
        started = performance.now()
        const tab = await chrome.tabs.create({url: 'about:blank', active: false})
        create.push(performance.now() - started)
        started = performance.now()
        await chrome.tabs.remove(tab.id)
        remove.push(performance.now() - started)
    }
    return {visibility: document.visibilityState, query: timingStats(query), create: timingStats(create), remove: timingStats(remove)}
}

// Interleaves a set of 141 keys with reads issued while the set is still pending.
// A mixed read would show two different tags in one get.
async function atomicProbe(iterations) {
    let reads = 0
    let mixedReads = 0
    for(let index = 1; index <= iterations; index += 1) {
        const payload = Object.fromEntries(KEYS.map(key => [key, `tag-${index}`]))
        const setPromise = chrome.storage.local.set(payload)
        const readPromise = chrome.storage.local.get(KEYS)
        const readBack = await readPromise
        await setPromise
        reads += 1
        if(new Set(Object.values(readBack)).size > 1) mixedReads += 1
    }
    return {iterations, reads, mixedReads}
}

window.spike = {
    state: () => ({...state}),
    heartbeat: () => heartbeat,
    setReplyDelay: (ms) => {
        replyDelayMs = ms
        return true
    },
    seedHandoff,
    handoffCopy,
    handoffBuffer,
    atomicProbe,
    tabTiming,
    discardOwner: () => new Promise(resolve => chrome.runtime.sendMessage({type: 'discard-owner'}, resolve)),
    swState: () => new Promise(resolve => chrome.runtime.sendMessage({type: 'sw-state'}, resolve))
}
