// Firefox background event page, standing in for the stateless service worker.
// Same rule as the Chrome probe: answer "absent" only when no owner holds the lock.
const BOOT_ID = crypto.randomUUID()
const ABSENT_REPLY_DELAY_MS = 1000

function ownerHeld() {
    return navigator.locks.query().then(state => state.held.some(lock => lock.name === 'mb-owner'))
}

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
    return false
})
