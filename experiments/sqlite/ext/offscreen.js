let worker = null
let nextId = 0
const pending = new Map()

function getWorker() {
    if(!worker) {
        worker = new Worker('db-worker.js', {type: 'module'})
        worker.onmessage = (event) => {
            if('progress' in event.data) {
                const entry = pending.get(event.data.id)
                if(entry?.killAt && event.data.progress >= entry.killAt) terminateWorker()
                return
            }
            const entry = pending.get(event.data.id)
            pending.delete(event.data.id)
            if(entry) entry.resolve(event.data)
        }
        worker.onerror = (event) => {
            for(const [id, entry] of pending) {
                entry.resolve({id, ok: false, error: `worker error: ${event.message || 'unknown'}`})
            }
            pending.clear()
        }
    }
    return worker
}

function callWorker(op, payload = {}) {
    return new Promise((resolve) => {
        const id = ++nextId
        pending.set(id, {resolve, killAt: payload.killAt})
        const {killAt, ...rest} = payload
        getWorker().postMessage({id, op, ...rest})
    })
}

function terminateWorker() {
    if(worker) {
        worker.terminate()
        worker = null
    }
    for(const [id, entry] of pending) {
        entry.resolve({id, ok: false, error: 'worker terminated'})
    }
    pending.clear()
    return {terminated: true}
}

const handlers = {
    'offscreen-globals': async () => ({
        runtime: typeof chrome.runtime,
        storage: typeof chrome.storage,
        tabs: typeof chrome.tabs,
        windows: typeof chrome.windows,
        alarms: typeof chrome.alarms,
        offscreen: typeof chrome.offscreen
    }),
    'offscreen-capabilities': async () => ({
        crossOriginIsolated: self.crossOriginIsolated,
        hasSharedArrayBuffer: typeof SharedArrayBuffer,
        hasWorker: typeof Worker
    }),
    'worker-call': (message) => callWorker(message.op, message.payload),
    'terminate-worker': () => terminateWorker()
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.target !== 'offscreen') return false
    const handler = handlers[message.kind]
    if(!handler) {
        sendResponse({ok: false, error: `unknown kind: ${message.kind}`})
        return false
    }
    Promise.resolve().then(() => handler(message)).then(
        result => sendResponse({ok: true, result}),
        error => sendResponse({ok: false, error: error.message || String(error)})
    )
    return true
})
