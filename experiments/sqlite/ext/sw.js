const BOOT_ID = crypto.randomUUID()

async function probeSwCapabilities() {
    const caps = {
        bootId: BOOT_ID,
        hasWorkerCtor: typeof Worker,
        hasGetDirectory: typeof navigator.storage?.getDirectory,
        hasSyncAccessHandleProto: typeof FileSystemFileHandle?.prototype?.createSyncAccessHandle,
        crossOriginIsolated: self.crossOriginIsolated,
        hasSharedArrayBuffer: typeof SharedArrayBuffer
    }
    try {
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle('sw-probe.bin', {create: true})
        const access = await handle.createSyncAccessHandle()
        access.close()
        caps.syncAccessHandleInServiceWorker = 'ok'
    }
    catch(error) {
        caps.syncAccessHandleInServiceWorker = `${error.name}: ${error.message}`
    }
    return caps
}

async function ensureOffscreen() {
    if(await chrome.offscreen.hasDocument()) return
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Host a dedicated worker that owns the SQLite database handle'
    })
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.type === 'sw-capabilities') {
        probeSwCapabilities().then(
            result => sendResponse({ok: true, result}),
            error => sendResponse({ok: false, error: error.message})
        )
        return true
    }
    if(message.type === 'ping') {
        sendResponse({ok: true, result: {bootId: BOOT_ID}})
        return false
    }
    if(message.type === 'to-offscreen') {
        ensureOffscreen()
            .then(() => chrome.runtime.sendMessage({target: 'offscreen', ...message.payload}))
            .then(
                result => sendResponse({ok: true, result}),
                error => sendResponse({ok: false, error: error.message})
            )
        return true
    }
    return false
})
