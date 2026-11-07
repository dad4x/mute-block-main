// Dedicated worker loaded from the extension's own files. A blob: URL worker
// failed inside an extension page in Firefox, so the probe uses a file instead.
const ticks = {count: 0, startedAt: Date.now()}
setInterval(() => { ticks.count += 1 }, 100)
setInterval(() => postMessage({count: ticks.count, elapsedMs: Date.now() - ticks.startedAt}), 500)
