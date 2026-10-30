// Sends a message to the service worker and resolves with its response.
function send(message) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
            resolve({response, lastError: chrome.runtime.lastError?.message || null})
        })
    })
}

window.spike = {
    send,
    ping: () => send({type: 'ping'}),
    swCapabilities: () => send({type: 'sw-capabilities'}),
    offscreen: (kind, op, payload) => send({type: 'to-offscreen', payload: {kind, op, payload}}),
    workerCall: (op, payload) => send({type: 'to-offscreen', payload: {kind: 'worker-call', op, payload}}),
    terminateWorker: () => send({type: 'to-offscreen', payload: {kind: 'terminate-worker'}})
}
