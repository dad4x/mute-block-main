// Same probe as the Chrome run: a 100 ms main-thread timer and a 100 ms timer
// inside a dedicated worker started from this page.
const pageTicks = {count: 0, startedAt: Date.now()}
setInterval(() => { pageTicks.count += 1 }, 100)

const worker = new Worker('worker.js')
const workerTicks = {count: 0, elapsedMs: 0, error: null}
worker.onmessage = (event) => {
    workerTicks.count = event.data.count
    workerTicks.elapsedMs = event.data.elapsedMs
}
worker.onerror = (event) => {
    workerTicks.error = event.message || 'worker error'
}

window.spike = {
    stats: () => ({
        visibility: document.visibilityState,
        pageTicks: pageTicks.count,
        pageElapsedMs: Date.now() - pageTicks.startedAt,
        workerTicks: workerTicks.count,
        workerElapsedMs: workerTicks.elapsedMs,
        workerError: workerTicks.error
    })
}
