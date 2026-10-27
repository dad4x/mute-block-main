#!/usr/bin/env node

const {COORDINATOR_QUEUE_KEY, COORDINATOR_RUNS_KEY, STORAGE_LAYOUT_PREFIX} = require('../../shared/js/storageKeys')

// The stored names of the queue and the run list: the layout prefix plus the plain key name (storageNamespace.js).
const STORED_NAMES = {
    queue: `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_QUEUE_KEY}`,
    runs: `${STORAGE_LAYOUT_PREFIX}${COORDINATOR_RUNS_KEY}`
}

const {
    evaluate,
    getCdpConfig,
    getTargets,
    readProfileNukeProgressFromWorker,
    runMain
} = require('./lib/cdp')

runMain(async () => {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))

    if(!extensionPage) {
        console.log(JSON.stringify({extensionPage: false}, null, 2))
        process.exitCode = 1
        return
    }

    const progressRecords = await readProfileNukeProgressFromWorker(config)
    const result = await evaluate(extensionPage.webSocketDebuggerUrl, `(${async function auditActionKinds(progress, names) {
        const storage = await chrome.storage.local.get({
            [names.queue]: {},
            [names.runs]: {}
        })
        const queue = storage[names.queue] || {}
        const runs = storage[names.runs] || {}
        const countBy = (values, selector) => values.reduce((counts, value) => {
            const key = selector(value) || '(empty)'
            counts[key] = (counts[key] || 0) + 1
            return counts
        }, {})
        const queueEntries = Object.entries(queue)
        const progressEntries = Object.entries(progress)
        const reverseEvents = []
        const unblockConfirmEvents = []
        const actionSamples = []

        for(const [key, item] of queueEntries) {
            const actionKind = `${item?.actionKind || ''}`.trim()
            if(actionKind === 'unblock-unmute') {
                actionSamples.push({
                    source: 'queue',
                    key,
                    status: item?.status || '',
                    runId: item?.runId || '',
                    actionKind,
                    executorTabAction: item?.executorTabAction || item?.tabAction || ''
                })
            }
        }

        for(const [key, record] of progressEntries) {
            const events = Array.isArray(record?.events) ? record.events : []
            const actionKind = `${record?.actionKind || ''}`.trim()
            if(actionKind === 'unblock-unmute') {
                actionSamples.push({
                    source: 'progress',
                    key,
                    status: record?.status || '',
                    runId: record?.runId || '',
                    actionKind
                })
            }
            for(const event of events) {
                const text = `${event || ''}`
                if(/reverse action|unblock unmute|queued unmute|queued unblock/i.test(text)) {
                    reverseEvents.push({key, actionKind, status: record?.status || '', event: text})
                }
                if(/unblock confirmation|unmute confirmation|unblock confirm|unmute confirm/i.test(text)) {
                    unblockConfirmEvents.push({key, actionKind, status: record?.status || '', event: text})
                }
            }
        }

        return {
            queueRows: queueEntries.length,
            progressRows: progressEntries.length,
            runs: Object.keys(runs).length,
            queueActionKinds: countBy(queueEntries, ([, item]) => item?.actionKind || ''),
            queueExecutorActions: countBy(queueEntries, ([, item]) => item?.executorTabAction || item?.tabAction || ''),
            progressActionKinds: countBy(progressEntries, ([, record]) => record?.actionKind || ''),
            actionSamples: actionSamples.slice(0, 25),
            reverseEventCount: reverseEvents.length,
            reverseEvents: reverseEvents.slice(-25),
            unblockConfirmEventCount: unblockConfirmEvents.length,
            unblockConfirmEvents: unblockConfirmEvents.slice(-25)
        }
    }})(${JSON.stringify(progressRecords)}, ${JSON.stringify(STORED_NAMES)})`, 20000)

    console.log(JSON.stringify(result, null, 2))
})
