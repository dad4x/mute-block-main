#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const targets = await getTargets(config)
    const dashboard = targets.find(target => target.type === 'page' && target.url === dashboardUrl)

    if(!dashboard) {
        console.log(JSON.stringify({dashboard: false}, null, 2))
        process.exitCode = 1
        return
    }

    const state = await evaluate(dashboard.webSocketDebuggerUrl, `(${function readDashboardState() {
        const text = id => document.getElementById(id)?.textContent?.trim() || ''
        const queueRows = Array.from(document.querySelectorAll('#queueList .row--queue'))
        const runRows = Array.from(document.querySelectorAll('#runList .row'))
        const eventRows = Array.from(document.querySelectorAll('#eventList .row'))
        const pauseState = document.getElementById('pauseCurrentWorkState')
        const pauseStateStyle = pauseState ? window.getComputedStyle(pauseState) : null
        return {
            refreshState: text('refreshState'),
            pauseCurrentWorkState: pauseState ? {
                text: pauseState.textContent?.trim() || '',
                borderRadius: pauseStateStyle?.borderRadius || '',
                backgroundColor: pauseStateStyle?.backgroundColor || '',
                color: pauseStateStyle?.color || ''
            } : null,
            queuedCount: text('queuedCount'),
            activeCount: text('activeCount'),
            secondsPerBlock: text('secondsPerBlock'),
            terminalCount: text('terminalCount'),
            eventCount: text('eventCount'),
            runCount: text('runCount'),
            queueCount: text('queueCount'),
            retryFailedCount: text('retryFailedCount'),
            retryFailedState: text('retryFailedState'),
            queueRows: queueRows.length,
            runRows: runRows.length,
            eventRows: eventRows.length,
            queueEmptyText: document.querySelector('#queueList .empty')?.textContent?.trim() || '',
            runEmptyText: document.querySelector('#runList .empty')?.textContent?.trim() || '',
            eventEmptyText: document.querySelector('#eventList .empty')?.textContent?.trim() || ''
        }
    }})()`)

    console.log(JSON.stringify({
        dashboard: true,
        target: {
            id: dashboard.id,
            title: dashboard.title || '',
            url: dashboard.url || ''
        },
        state
    }, null, 2))
})
