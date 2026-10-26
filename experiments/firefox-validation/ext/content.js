// Content script, page origin. Reports three things through a DOM attribute:
// whether BroadcastChannel reaches it, whether storage.session change events do,
// and whether a worker started from here writes OPFS in the page's origin.
const report = {broadcast: [], storage: [], contentWorker: null}

const channel = new BroadcastChannel('mb-mirror')
channel.onmessage = (event) => {
    report.broadcast.push({epoch: event.data.epoch, seq: event.data.seq, lagMs: Date.now() - event.data.sentAt})
    publish()
}

try {
    chrome.storage.onChanged.addListener((changes, area) => {
        if(area !== 'session' || !changes.mirrorSeq) return
        report.storage.push({
            epoch: changes.mirrorEpoch?.newValue ?? null,
            seq: changes.mirrorSeq.newValue,
            lagMs: changes.mirrorSentAt ? Date.now() - changes.mirrorSentAt.newValue : null
        })
        publish()
    })
}
catch(error) {
    report.storageListenerError = error.message
}

function publish() {
    document.documentElement.setAttribute('data-fv-content', JSON.stringify(report))
}

async function contentWorkerWrite() {
    const workerSource = `
        (async () => {
            try {
                const root = await navigator.storage.getDirectory()
                const handle = await root.getFileHandle('probe-from-content-worker.txt', {create: true})
                const access = await handle.createSyncAccessHandle()
                access.write(new TextEncoder().encode('written-by-content-script-worker'), {at: 0})
                access.flush()
                access.close()
                postMessage({ok: true, workerOrigin: self.location.origin})
            }
            catch(error) {
                postMessage({ok: false, error: error.name + ': ' + error.message})
            }
        })()
    `
    const url = URL.createObjectURL(new Blob([workerSource], {type: 'text/javascript'}))
    const worker = new Worker(url)
    report.contentWorker = await new Promise((resolve) => {
        worker.onmessage = (event) => resolve(event.data)
        worker.onerror = (event) => resolve({ok: false, error: event.message || 'worker error'})
    })
    worker.terminate()
    publish()
}

contentWorkerWrite().catch((error) => {
    report.contentWorker = {ok: false, error: error.message}
    publish()
})
publish()
