// Stands in for the stateless service worker. It answers an owner request only
// when no owner holds the lock, so an owner page answers when one exists.
const BOOT_ID = crypto.randomUUID()

function ownerHeld() {
    return navigator.locks.query().then(state => state.held.some(lock => lock.name === 'mb-owner'))
}

// The absent reply waits ABSENT_REPLY_DELAY_MS so a service-worker stop can land
// while the reply is in flight.
const ABSENT_REPLY_DELAY_MS = 1000

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if(message.type === 'owner-request') {
        ownerHeld().then((held) => {
            if(held) return
            setTimeout(() => sendResponse({responder: 'sw', ownerAbsent: true, bootId: BOOT_ID}), ABSENT_REPLY_DELAY_MS)
        })
        return true
    }
    if(message.type === 'sw-state') {
        ownerHeld().then(held => sendResponse({bootId: BOOT_ID, ownerHeld: held}))
        return true
    }
    if(message.type === 'discard-owner') {
        chrome.tabs.query({}).then(async (tabs) => {
            const owner = tabs.find(tab => (tab.url || '').includes('role=owner'))
            if(!owner) return sendResponse({ok: false, reason: 'no-owner-tab'})
            const discardedAt = Date.now()
            await chrome.tabs.discard(owner.id)
            sendResponse({ok: true, discardedAt})
        })
        return true
    }
    return false
})
