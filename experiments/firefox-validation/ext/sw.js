// Firefox background is an event page, not a service worker. It listens the same
// way the Chrome probe's service worker does, so its results can be compared.
const received = {broadcast: [], storage: []}

const channel = new BroadcastChannel('mb-mirror')
channel.onmessage = (event) => {
    received.broadcast.push({epoch: event.data.epoch, seq: event.data.seq, lagMs: Date.now() - event.data.sentAt})
}

chrome.storage.onChanged.addListener((changes, area) => {
    if(area !== 'session' || !changes.mirrorSeq) return
    received.storage.push({
        epoch: changes.mirrorEpoch?.newValue ?? null,
        seq: changes.mirrorSeq.newValue,
        lagMs: changes.mirrorSentAt ? Date.now() - changes.mirrorSentAt.newValue : null
    })
})

chrome.storage.session.setAccessLevel?.({accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.type === 'sw-state') {
        sendResponse({ok: true, result: {received}})
        return false
    }
    return false
})
