// Reports results through DOM attributes, since the page's main world cannot
// see this isolated world's variables.
(async () => {
    const report = {}
    try {
        const list = await indexedDB.databases()
        report.idbNames = list.map(entry => entry.name)
    }
    catch(error) {
        report.idbError = error?.message || String(error)
    }
    try {
        const open = indexedDB.open('spike-content-probe', 1)
        await new Promise((resolve, reject) => {
            open.onupgradeneeded = () => open.result.createObjectStore('s', {keyPath: 'k'})
            open.onsuccess = () => {
                open.result.close()
                resolve()
            }
            open.onerror = () => reject(open.error)
        })
        report.idbWriteOk = true
    }
    catch(error) {
        report.idbWriteError = error?.message || String(error)
    }
    try {
        const session = await chrome.storage.session.get('probeKey')
        report.sessionProbeKey = session.probeKey ?? null
    }
    catch(error) {
        report.sessionError = error?.message || String(error)
    }
    document.documentElement.setAttribute('data-idb-spike', JSON.stringify(report))
})()
