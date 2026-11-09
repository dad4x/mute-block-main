// One page, several roles, selected by the query string:
//   holder / waiter  - election test on lock 'mb-election'
//   owner            - publishes mirror updates, lock 'mb-owner'
//   viewer           - listens only
const params = new URLSearchParams(location.search)
const role = params.get('role') || 'viewer'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const state = {
    role,
    epoch: null,
    ownerAcquiredAt: null,
    election: {acquired: false, acquiredAt: null, ifAvailableResult: null},
    broadcast: [],
    storage: [],
    setMs: []
}

const channel = new BroadcastChannel('mb-mirror')
channel.onmessage = (event) => {
    if(role === 'owner') return
    state.broadcast.push({epoch: event.data.epoch, seq: event.data.seq, lagMs: Date.now() - event.data.sentAt})
}

chrome.storage.onChanged.addListener((changes, area) => {
    if(area !== 'session' || !changes.mirrorSeq || role === 'owner') return
    state.storage.push({
        epoch: changes.mirrorEpoch?.newValue ?? null,
        seq: changes.mirrorSeq.newValue,
        lagMs: changes.mirrorSentAt ? Date.now() - changes.mirrorSentAt.newValue : null
    })
})

if(role === 'holder' || role === 'waiter') {
    const options = role === 'holder' ? {mode: 'exclusive', ifAvailable: true} : {mode: 'exclusive'}
    navigator.locks.request('mb-election', options, (lock) => {
        if(lock === null) {
            state.election.ifAvailableResult = 'not-available'
            return
        }
        state.election.acquired = true
        state.election.acquiredAt = Date.now()
        state.election.ifAvailableResult = role === 'holder' ? 'granted' : null
        return new Promise(() => {})
    })
}

if(role === 'owner') {
    navigator.locks.request('mb-owner', {mode: 'exclusive'}, async () => {
        const previous = (await chrome.storage.session.get('mirrorEpoch')).mirrorEpoch || 0
        state.epoch = previous + 1
        await chrome.storage.session.set({mirrorEpoch: state.epoch})
        state.ownerAcquiredAt = Date.now()
        return new Promise(() => {})
    })
}

let sequence = 0
async function burst({count, intervalMs}) {
    const sentFrom = sequence + 1
    for(let index = 0; index < count; index += 1) {
        sequence += 1
        const sentAt = Date.now()
        channel.postMessage({epoch: state.epoch, seq: sequence, sentAt})
        const started = performance.now()
        await chrome.storage.session.set({mirrorEpoch: state.epoch, mirrorSeq: sequence, mirrorSentAt: sentAt})
        state.setMs.push(performance.now() - started)
        await sleep(intervalMs)
    }
    return {epoch: state.epoch, sentFrom, sentTo: sequence}
}

function workerGlobals() {
    return new Promise((resolve, reject) => {
        const worker = new Worker('worker-globals.js')
        worker.onmessage = (event) => {
            resolve(event.data)
            worker.terminate()
        }
        worker.onerror = (event) => {
            reject(new Error(event.message || 'worker error'))
            worker.terminate()
        }
    })
}

function swState() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({type: 'sw-state'}, (response) => resolve(response?.result ?? null))
    })
}

async function readOpfsNames() {
    const root = await navigator.storage.getDirectory()
    const names = []
    for await (const [name] of root.entries()) names.push(name)
    return {origin: location.origin, names}
}

window.spike = {
    state: () => ({...state, now: Date.now()}),
    burst,
    workerGlobals,
    swState,
    readOpfsNames,
    readMirror: () => chrome.storage.session.get(['mirrorEpoch', 'mirrorSeq', 'mirrorSentAt'])
}
