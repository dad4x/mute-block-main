postMessage({
    hasChrome: typeof chrome,
    hasChromeStorage: typeof chrome !== 'undefined' && typeof chrome.storage,
    hasBroadcastChannel: typeof BroadcastChannel,
    hasWebLocks: typeof navigator.locks,
    hasSharedWorker: typeof SharedWorker,
    origin: self.location.origin
})
