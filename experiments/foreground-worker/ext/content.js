// Creates a dedicated worker from the page's content script, writes an OPFS
// file from inside it, and reports the outcome through a DOM attribute.
(async () => {
    const report = {pageOrigin: location.origin}
    try {
        const workerSource = `
            (async () => {
                try {
                    const root = await navigator.storage.getDirectory()
                    const handle = await root.getFileHandle('probe-from-content-worker.txt', {create: true})
                    const access = await handle.createSyncAccessHandle()
                    const bytes = new TextEncoder().encode('written-by-content-script-worker')
                    access.write(bytes, {at: 0})
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
        report.blobWorker = await new Promise((resolve) => {
            worker.onmessage = (event) => resolve(event.data)
            worker.onerror = (event) => resolve({ok: false, error: event.message || 'worker error'})
        })
        worker.terminate()
    }
    catch(error) {
        report.blobWorkerThrew = error.name + ': ' + error.message
    }
    try {
        const extensionWorker = new Worker(chrome.runtime.getURL('worker.js'))
        report.extensionUrlWorker = await new Promise((resolve) => {
            extensionWorker.onmessage = () => resolve({ok: true})
            extensionWorker.onerror = () => resolve({ok: false})
        })
        extensionWorker.terminate()
    }
    catch(error) {
        report.extensionUrlWorkerThrew = error.name + ': ' + error.message
    }
    document.documentElement.setAttribute('data-foreground-worker', JSON.stringify(report))
})()
