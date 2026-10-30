#!/usr/bin/env node

// A summary of the queue and runs as the dashboard shows them. The queue and run list are not under plain keys any more (WAL and worker
// memory), so this reads the dashboard page's rendered counts and its open profile tabs. It sends no message and writes nothing.
const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    resolveCdpConfig,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = await resolveCdpConfig(getCdpConfig())
    const needle = getOption('needle', process.env.MB_QUEUE_NEEDLE || '').toLowerCase()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionTarget = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    const profileTabs = targets
        .filter(target => target.type === 'page' && /^https:\/\/www\.quora\.com\/profile\//i.test(target.url || ''))
        .map(target => ({title: target.title || '', url: target.url || ''}))

    if(!extensionTarget) {
        console.log(JSON.stringify({extensionTarget: false}, null, 2))
        process.exitCode = 1
        return
    }

    const result = await evaluate(extensionTarget.webSocketDebuggerUrl, `(${function readQueueSummary(needle) {
        const text = id => (document.getElementById(id)?.textContent || '').trim()
        const rowsOf = id => [...document.querySelectorAll(`#${id} > *`)]
            .filter(node => node.nodeType === 1 && !node.classList.contains('loading-indicator'))
        const queueRows = rowsOf('queueList')
        const shown = needle ? queueRows.filter(node => (node.textContent || '').toLowerCase().includes(needle)) : queueRows
        return {
            needle,
            queuedCount: text('queuedCount'),
            activeCount: text('activeCount'),
            terminalCount: text('terminalCount'),
            queueCount: text('queueCount'),
            runCount: text('runCount'),
            currentWorkReadyCount: text('currentWorkReadyCount'),
            shownQueueRows: shown.length,
            shownRunRows: rowsOf('runList').length,
            source: 'dashboard-page-rendered'
        }
    }})( ${JSON.stringify(needle)} )`, 10000)

    result.profileTabCount = profileTabs.length
    result.profileTabs = profileTabs
    console.log(JSON.stringify(result, null, 2))
})
