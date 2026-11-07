#!/usr/bin/env node

// Queue counts as the dashboard shows them. The queue is no longer stored under one plain key (it is in the WAL and the worker's memory),
// so this reads the dashboard page's rendered counts. It sends no message and writes nothing, so it cannot start the outlier pass.
const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionTarget = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    const profilePages = targets.filter(target =>
        target.type === 'page' && /^https:\/\/www\.quora\.com\/profile\//i.test(target.url || '')
    )

    if(!extensionTarget) {
        console.log(JSON.stringify({extensionTarget: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionTarget.webSocketDebuggerUrl, `(${function readQueueCounts(needle) {
        const text = id => (document.getElementById(id)?.textContent || '').trim()
        const rows = [...document.querySelectorAll('#queueList > *')]
            .filter(node => node.nodeType === 1 && !node.classList.contains('loading-indicator'))
        const shownRows = needle
            ? rows.filter(node => (node.textContent || '').toLowerCase().includes(needle))
            : rows
        return {
            needle,
            queuedCount: text('queuedCount'),
            activeCount: text('activeCount'),
            terminalCount: text('terminalCount'),
            queueCount: text('queueCount'),
            currentWorkReadyCount: text('currentWorkReadyCount'),
            shownRows: shownRows.length,
            source: 'dashboard-page-rendered'
        }
    }})( ${JSON.stringify(needle)} )`, 10000)

    result.profileTabCount = profilePages.length
    result.profilePages = profilePages.map(target => ({
        title: target.title || '',
        url: target.url || ''
    }))
    console.log(JSON.stringify(result, null, 2))
})
