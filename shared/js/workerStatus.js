// The check that the queue worker is up (7 Nov). A page asks the worker for this status when it loads. The worker answers at once, before
// its queue has loaded, so a reply means the worker is running. Until it answers, the page shows a starting spinner and asks again.
const WORKER_STATUS_ACTION = 'worker-status'

// Resolves when a ping gets a ready reply. onStarting runs after each ping that did not get one, and onReady once the worker answers.
async function waitForWorker({ping, sleep, onStarting, onReady}) {
    for (;;) {
        const reply = await ping()
        if (reply?.ready) {
            onReady()
            return true
        }
        // The extension was reloaded under this page: nothing will answer, so the wait ends (7 Nov).
        if (reply?.gone) return false
        onStarting()
        await sleep()
    }
}

module.exports = {WORKER_STATUS_ACTION, waitForWorker}
