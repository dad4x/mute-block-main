// A content script is in the page's origin, so the extension's BroadcastChannel
// should not reach it. Its storage.session listener should. Results go to the
// DOM, which the driver reads.
const report = {broadcast: [], storage: []}

const channel = new BroadcastChannel('mb-mirror')
channel.onmessage = (event) => {
    report.broadcast.push({epoch: event.data.epoch, seq: event.data.seq, lagMs: Date.now() - event.data.sentAt})
    publish()
}

chrome.storage.onChanged.addListener((changes, area) => {
    if(area !== 'session' || !changes.mirrorSeq) return
    report.storage.push({
        epoch: changes.mirrorEpoch?.newValue ?? null,
        seq: changes.mirrorSeq.newValue,
        lagMs: changes.mirrorSentAt ? Date.now() - changes.mirrorSentAt.newValue : null
    })
    publish()
})

function publish() {
    document.documentElement.setAttribute('data-mirror-broadcast', JSON.stringify(report))
}

publish()
