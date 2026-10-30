chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.type === 'ping') {
        sendResponse({ok: true})
        return false
    }
    return false
})
