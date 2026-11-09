// The service worker is a listener like any page: it records what it hears on
// the broadcast channel and on storage.session changes, so restarts show as gaps.
const BOOT_ID = crypto.randomUUID()
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

chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.type === 'ping') {
        sendResponse({ok: true, result: {bootId: BOOT_ID, now: Date.now()}})
        return false
    }
    if(message.type === 'sw-state') {
        sendResponse({ok: true, result: {bootId: BOOT_ID, received}})
        return false
    }
    return false
})
