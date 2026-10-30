// Roles: 'owner' takes the exclusive owner lock, publishes its epoch, and can
// burst mirror updates. 'viewer' only listens: broadcast and storage.session.
const params = new URLSearchParams(location.search)
const role = params.get('role') || 'viewer'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const state = {role, epoch: null, ownerAcquiredAt: null, broadcast: [], storage: [], setMs: []}
const channel = new BroadcastChannel('mb-mirror')

channel.onmessage = (event) => {
    if(role === 'owner') return
    state.broadcast.push({epoch: event.data.epoch, seq: event.data.seq, lagMs: Date.now() - event.data.sentAt})
}

chrome.storage.onChanged.addListener((changes, area) => {
    if(area !== 'session' || !changes.mirrorSeq) return
    if(role === 'owner') return
    state.storage.push({
        epoch: changes.mirrorEpoch?.newValue ?? null,
        seq: changes.mirrorSeq.newValue,
        lagMs: changes.mirrorSentAt ? Date.now() - changes.mirrorSentAt.newValue : null
    })
})

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

async function readMirror() {
    return chrome.storage.session.get(['mirrorEpoch', 'mirrorSeq', 'mirrorSentAt'])
}

function swState() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({type: 'sw-state'}, (response) => resolve(response?.result ?? null))
    })
}

window.spike = {
    state: () => ({...state, now: Date.now()}),
    burst,
    readMirror,
    swState
}
