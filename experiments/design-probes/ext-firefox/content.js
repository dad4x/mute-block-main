// Content-script side of the routing probe. A request retries until an owner page
// answers. Results go to a DOM attribute, keyed by request id.
const results = {}

function publish() {
    document.documentElement.setAttribute('data-mb-result', JSON.stringify(results))
}

function sendOnce(id) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({timeout: true}), 2000)
        try {
            chrome.runtime.sendMessage({type: 'owner-request', id}, (reply) => {
                clearTimeout(timer)
                resolve({reply, error: chrome.runtime.lastError?.message || null})
            })
        }
        catch (error) {
            clearTimeout(timer)
            resolve({error: `threw: ${error.message}`})
        }
    })
}

document.addEventListener('mb-request', async (event) => {
    const id = event.detail.id
    document.documentElement.setAttribute('data-mb-event', id)
    const started = performance.now()
    const errors = []
    let attempts = 0
    while(performance.now() - started < 30000) {
        attempts += 1
        const outcome = await sendOnce(id)
        if(outcome.reply?.responder === 'owner') {
            results[id] = {ok: true, attempts, totalMs: Math.round(performance.now() - started), errors}
            publish()
            return
        }
        errors.push(outcome.timeout ? 'timeout' : outcome.error || outcome.reply?.responder || 'no-response')
        await new Promise(resolve => setTimeout(resolve, 300))
    }
    results[id] = {ok: false, attempts, totalMs: Math.round(performance.now() - started), errors}
    publish()
})

publish()

// Capability report for the Firefox mirror question: can a content script read
// storage.session, does setAccessLevel exist here, and does onChanged fire for it.
let sessionChangeCount = 0
try {
    chrome.storage.onChanged.addListener((changes, area) => {
        if(area === "session") sessionChangeCount += 1
        document.documentElement.setAttribute("data-mb-caps-changes", String(sessionChangeCount))
    })
} catch (error) {
    document.documentElement.setAttribute("data-mb-caps-listen-error", error.message)
}
const capsReport = {ranContentScript: true, hasSessionArea: typeof chrome.storage?.session}
document.documentElement.setAttribute("data-mb-caps", JSON.stringify(capsReport))
capsReport.hasSetAccessLevel = typeof chrome.storage?.session?.setAccessLevel
const sessionRead = new Promise((resolve, reject) => {
    try {
        chrome.storage.session.get("probeKey").then(resolve, reject)
    } catch (error) {
        reject(error)
    }
})
const sessionTimeout = new Promise(resolve => setTimeout(() => resolve({timedOut: true}), 3000))
Promise.race([sessionRead, sessionTimeout]).then((value) => {
    if(value?.timedOut) capsReport.sessionGet = "timed-out"
    else capsReport.sessionGet = value?.probeKey ?? null
}, (error) => {
    capsReport.sessionGetError = error.message
}).then(() => {
    document.documentElement.setAttribute("data-mb-caps", JSON.stringify(capsReport))
})
