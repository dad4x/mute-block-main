// Counts 100 ms timer ticks on the page's main thread and inside a dedicated
// worker started from this page, so a run can compare a foreground tab with a
// hidden one.
const pageTicks = {count: 0, startedAt: Date.now()}
setInterval(() => { pageTicks.count += 1 }, 100)

const workerSource = `
    const ticks = {count: 0, startedAt: Date.now()}
    setInterval(() => { ticks.count += 1 }, 100)
    setInterval(() => postMessage({count: ticks.count, elapsedMs: Date.now() - ticks.startedAt}), 500)
`
const workerUrl = URL.createObjectURL(new Blob([workerSource], {type: 'text/javascript'}))
const worker = new Worker(workerUrl)
const workerTicks = {count: 0, elapsedMs: 0}
worker.onmessage = (event) => {
    workerTicks.count = event.data.count
    workerTicks.elapsedMs = event.data.elapsedMs
}

window.spike = {
    stats: () => ({
        visibility: document.visibilityState,
        pageTicks: pageTicks.count,
        pageElapsedMs: Date.now() - pageTicks.startedAt,
        workerTicks: workerTicks.count,
        workerElapsedMs: workerTicks.elapsedMs
    })
}
