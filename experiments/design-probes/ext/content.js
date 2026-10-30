// Content-script side of the routing probe. A request retries until an owner page
// answers. Results go to a DOM attribute, keyed by request id.
const results = {}

function publish() {
    document.documentElement.setAttribute('data-mb-result', JSON.stringify(results))
}

function sendOnce(id) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({timeout: true}), 2000)
        chrome.runtime.sendMessage({type: 'owner-request', id}, (reply) => {
            clearTimeout(timer)
            resolve({reply, error: chrome.runtime.lastError?.message || null})
        })
    })
}

document.addEventListener('mb-request', async (event) => {
    const id = event.detail.id
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
