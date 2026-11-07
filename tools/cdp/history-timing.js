#!/usr/bin/env node

// Times the History page's own reads from an open extension page: the message round trip to the worker, a full history query, an
// incremental one, and one redraw of the rows. It sends only read queries and redraws what is on the page; it writes nothing to storage.
const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    resolveCdpConfig,
    runMain,
    sleep
} = require('./lib/cdp')

runMain(async () => {
    const config = await resolveCdpConfig(getCdpConfig())
    const runs = Number.parseInt(getOption('runs', '3'), 10) || 3
    const targets = await getTargets(config)
    const pageUrlPrefix = `chrome-extension://${config.extensionId}/coordinator.html`
    const pageTarget = targets.find(target => target.type === 'page' && (target.url || '').startsWith(pageUrlPrefix))
    if(!pageTarget) {
        console.log(JSON.stringify({extensionPage: false, expected: pageUrlPrefix}, null, 2))
        process.exitCode = 1
        return
    }

    const samples = []
    for(let run = 0; run < runs; run += 1) {
        const sample = await evaluate(pageTarget.webSocketDebuggerUrl, `(async () => {
            const now = () => performance.now()
            const lag = []
            for (let index = 0; index < 5; index += 1) {
                const start = now()
                await new Promise(resolve => setTimeout(resolve, 0))
                lag.push(Math.round(now() - start))
            }
            const roundTripStart = now()
            await chrome.runtime.sendMessage({action: 'get-recent-history', since: Date.now() + 1e13})
            const roundTripMs = Math.round(now() - roundTripStart)

            const fullStart = now()
            const full = await chrome.runtime.sendMessage({action: 'get-recent-history', since: 0})
            const fullMs = Math.round(now() - fullStart)
            const fullRows = Array.isArray(full?.rows) ? full.rows.length : -1
            const fullBytes = JSON.stringify(full || {}).length

            const incrementalStart = now()
            const incremental = await chrome.runtime.sendMessage({action: 'get-recent-history', since: full?.latest || 0})
            const incrementalMs = Math.round(now() - incrementalStart)

            let renderMs = null
            let renderedRows = null
            if (typeof renderHistoryRows === 'function' && document.getElementById('historyList')) {
                const renderStart = now()
                renderHistoryRows()
                renderMs = Math.round(now() - renderStart)
                renderedRows = document.querySelectorAll('#historyList > .row').length
            }
            const text = id => (document.getElementById(id)?.textContent || '').trim()
            return {
                eventLoopLagMs: lag,
                roundTripMs,
                fullMs,
                fullRows,
                fullBytes,
                incrementalMs,
                incrementalRows: Array.isArray(incremental?.rows) ? incremental.rows.length : -1,
                renderMs,
                renderedRows,
                activeCount: text('activeCount'),
                queuedCount: text('queuedCount'),
                historyCount: text('historyCount'),
                hasHistoryList: !!document.getElementById('historyList'),
                visibility: document.visibilityState
            }
        })()`, 120000)
        samples.push(sample)
        await sleep(1000)
    }

    console.log(JSON.stringify({extensionPage: pageTarget.url, samples}, null, 2))
})
