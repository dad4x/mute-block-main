// Service worker side of the chain: SW -> page -> Worker -> page -> SW.
// The SW builds the payload, times the whole round trip, and reports it.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.type === 'chain') {
        const started = Date.now()
        chrome.runtime.sendMessage({type: 'to-worker', size: message.size, payload: 'x'.repeat(message.size)})
            .then((reply) => {
                sendResponse({ok: true, result: {totalMs: Date.now() - started, pageReply: reply}})
            })
            .catch((error) => {
                sendResponse({ok: false, error: error.message})
            })
        return true
    }
    return false
})
