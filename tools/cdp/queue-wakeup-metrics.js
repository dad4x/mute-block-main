#!/usr/bin/env node

const fs = require('fs')
const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

const METRICS_KEY = 'mbQueueWakeupMetrics'

function asNumber(value) {
    const number = Number(value) || 0
    return Number.isFinite(number) ? number : 0
}

function readJsonFile(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'))
}

function counter(currentEpoch, name) {
    return asNumber(currentEpoch?.counters?.[name])
}

function ratio(numerator, denominator) {
    if(!denominator) return null
    return numerator / denominator
}

function percent(value) {
    if(value === null || value === undefined) return null
    return Math.round(value * 1000) / 10
}

function sumCounters(currentEpoch, prefix) {
    return Object.entries(currentEpoch?.counters || {})
        .filter(([key]) => key.startsWith(prefix))
        .reduce((total, [, value]) => total + asNumber(value), 0)
}

function summarizePhases(phases = {}) {
    return Object.fromEntries(Object.entries(phases || {})
        .map(([name, phase]) => {
            const count = asNumber(phase.count)
            const totalMs = asNumber(phase.totalMs)
            return [name, {
                count,
                avgMs: count ? Math.round(totalMs / count) : 0,
                lastMs: asNumber(phase.lastMs),
                maxMs: asNumber(phase.maxMs),
                lastAt: asNumber(phase.lastAt)
            }]
        })
        .sort((left, right) => left[0].localeCompare(right[0])))
}

function groupJournal(journal = []) {
    const byKind = {}
    const byName = {}
    const byResult = {}
    for(const entry of journal || []) {
        const kind = entry?.kind || ''
        const name = entry?.name || ''
        const result = entry?.result || ''
        if(kind) byKind[kind] = (byKind[kind] || 0) + 1
        if(name) byName[name] = (byName[name] || 0) + 1
        if(result) byResult[result] = (byResult[result] || 0) + 1
    }
    return {byKind, byName, byResult}
}

function sortCounters(counters = {}) {
    return Object.fromEntries(Object.entries(counters || {})
        .sort((left, right) => left[0].localeCompare(right[0])))
}

function topCounters(counters = {}, prefix = '', limit = 12) {
    return Object.entries(counters || {})
        .filter(([key]) => !prefix || key.startsWith(prefix))
        .sort((left, right) => asNumber(right[1]) - asNumber(left[1]) || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([name, value]) => ({name, value: asNumber(value)}))
}

function summarizeQueueWriteOperations(counters = {}, prefix = 'queueWrite.operation.') {
    const operations = {}
    for(const [key, value] of Object.entries(counters || {})) {
        if(!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        const dotIndex = rest.indexOf('.')
        if(dotIndex <= 0) continue
        const operation = rest.slice(0, dotIndex)
        const field = rest.slice(dotIndex + 1)
        if(![
            'calls',
            'bytes',
            'rows',
            'changedRows',
            'maxBytes',
            'maxRows',
            'maxChangedRows'
        ].includes(field)) continue
        operations[operation] = operations[operation] || {
            operation,
            calls: 0,
            bytes: 0,
            rows: 0,
            changedRows: 0,
            maxBytes: 0,
            maxRows: 0,
            maxChangedRows: 0
        }
        operations[operation][field] = asNumber(value)
    }

    return Object.values(operations)
        .sort((left, right) => right.bytes - left.bytes || right.calls - left.calls || left.operation.localeCompare(right.operation))
}

function analyzeMetrics(metrics = {}) {
    const metricsDocument = metrics || {}
    const currentEpoch = metricsDocument.currentEpoch || metricsDocument
    const previousEpochs = Array.isArray(metricsDocument.previousEpochs) ? metricsDocument.previousEpochs : []
    const counters = currentEpoch.counters || {}
    const nudgeSent = counter(currentEpoch, 'nudge.sent')
    const nudgeAccepted = counter(currentEpoch, 'nudge.accepted')
    const pumpRequested = counter(currentEpoch, 'pump.requested')
    const pumpChanged = sumCounters(currentEpoch, 'pump.changed.')
    const jobsEnqueued = counter(currentEpoch, 'job.enqueued')
    const jobTerminal = counter(currentEpoch, 'job.terminal')
    const completedOnlyAfterReconcile = counter(currentEpoch, 'job.completedOnlyAfterReconcile')
    const storageStarted = counter(currentEpoch, 'storageUpdate.started')
    const storageCompleted = counter(currentEpoch, 'storageUpdate.completed')
    const storageTimedOut = counter(currentEpoch, 'storageUpdate.timedOut')
    const storageDeadlineMissed = counter(currentEpoch, 'storageUpdate.deadlineMissed')
    const storageFallback = counter(currentEpoch, 'storageUpdate.fallbackReturned')
    const storageAbandoned = counter(currentEpoch, 'storageUpdate.abandoned')
    const storageLateWriteSuppressed = counter(currentEpoch, 'storageUpdate.lateWriteSuppressed')
    const milestoneReceived = counter(currentEpoch, 'milestone.received')
    const milestoneFlushes = counter(currentEpoch, 'milestone.flushPerformed')
    const progressReceived = counter(currentEpoch, 'progress.recordReceived')
    const diagnosticReceived = counter(currentEpoch, 'diagnosticEvent.received')
    const diagnosticWrites = counter(currentEpoch, 'diagnosticEvent.storageWrites')
    const duplicatePumpNoops =
        counter(currentEpoch, 'pump.noop.noPendingItems') +
        counter(currentEpoch, 'pump.noop.executorAlreadyRunning') +
        counter(currentEpoch, 'pump.noop.paused')
    const wakeups =
        nudgeSent +
        pumpRequested
    const instrumentation = {
        hasStorageCounters: storageStarted > 0 ||
            storageCompleted > 0 ||
            storageTimedOut > 0 ||
            storageFallback > 0 ||
            storageAbandoned > 0,
        hasNudgeCounters: nudgeSent > 0 || nudgeAccepted > 0,
        hasPumpCounters: pumpRequested > 0 || pumpChanged > 0,
        hasJobCounters: jobsEnqueued > 0 || jobTerminal > 0
    }
    const ageMs = currentEpoch.updatedAt && currentEpoch.startedAt
        ? Math.max(0, asNumber(currentEpoch.updatedAt) - asNumber(currentEpoch.startedAt))
        : 0

    return {
        version: metricsDocument.version || currentEpoch.version || 0,
        epochId: currentEpoch.epochId || '',
        resetReason: currentEpoch.resetReason || '',
        extensionVersion: currentEpoch.extensionVersion || '',
        startedAt: currentEpoch.startedAt || 0,
        updatedAt: currentEpoch.updatedAt || 0,
        firstServiceWorkerStartedAt: currentEpoch.firstServiceWorkerStartedAt || 0,
        lastServiceWorkerStartedAt: currentEpoch.lastServiceWorkerStartedAt || 0,
        previousEpochs,
        lifetime: metricsDocument.lifetime || null,
        ageMs,
        counters: sortCounters(counters),
        topCounters: topCounters(counters),
        storage: {
            started: storageStarted,
            completed: storageCompleted,
            timedOut: storageTimedOut,
            deadlineMissed: storageDeadlineMissed,
            fallbackReturned: storageFallback,
            abandoned: storageAbandoned,
            lateWriteSuppressed: storageLateWriteSuppressed,
            noRuntimeWork: counter(currentEpoch, 'storageUpdate.noRuntimeWork'),
            noDurableWork: counter(currentEpoch, 'storageUpdate.noDurableWork'),
            completionRatePct: percent(ratio(storageCompleted, storageStarted)),
            timeoutRatePct: percent(ratio(storageTimedOut, storageStarted)),
            deadlineMissRatePct: percent(ratio(storageDeadlineMissed, storageStarted)),
            fallbackRatePct: percent(ratio(storageFallback, storageStarted)),
            abandonedRatePct: percent(ratio(storageAbandoned, storageStarted)),
            timeoutBuckets: topCounters(counters, 'storageUpdate.timeout.', 12)
        },
        storagePayload: {
            totalBytes: counter(currentEpoch, 'storagePayload.write.total.bytes'),
            totalCalls: counter(currentEpoch, 'storagePayload.write.total.calls'),
            maxBytes: counter(currentEpoch, 'storagePayload.write.total.maxBytes'),
            totalReadBytes: counter(currentEpoch, 'storagePayload.read.total.bytes'),
            totalReadCalls: counter(currentEpoch, 'storagePayload.read.total.calls'),
            maxReadBytes: counter(currentEpoch, 'storagePayload.read.total.maxBytes'),
            topBytes: topCounters(counters, 'storagePayload.write.', 20)
                .filter(entry => /\.bytes$|\.maxBytes$/.test(entry.name)),
            topReadBytes: topCounters(counters, 'storagePayload.read.', 20)
                .filter(entry => /\.bytes$|\.maxBytes$/.test(entry.name)),
            topWritePaths: topCounters(counters, 'storagePayload.write.path.', 20)
                .filter(entry => /\.bytes$|\.latencyMs$|\.maxLatencyMs$/.test(entry.name)),
            topReadPaths: topCounters(counters, 'storagePayload.read.path.', 20)
                .filter(entry => /\.bytes$|\.latencyMs$|\.maxLatencyMs$/.test(entry.name))
        },
        queueWrites: {
            ordinaryMutationOperations: summarizeQueueWriteOperations(
                counters,
                'queueWrite.reason.ordinaryMutation.operation.'
            ),
            allOperations: summarizeQueueWriteOperations(counters),
            topCounters: topCounters(counters, 'queueWrite.', 30)
        },
        coalescing: {
            milestone: {
                received: milestoneReceived,
                flushes: milestoneFlushes,
                ratio: ratio(milestoneReceived, milestoneFlushes),
                pendingMax: counter(currentEpoch, 'milestone.pendingMax')
            },
            progress: {
                received: progressReceived,
                pendingMax: counter(currentEpoch, 'progress.pendingMax')
            },
            diagnosticEvent: {
                received: diagnosticReceived,
                storageWrites: diagnosticWrites,
                ratio: ratio(diagnosticReceived, diagnosticWrites),
                pendingMax: counter(currentEpoch, 'diagnosticEvent.pendingMax')
            }
        },
        queueWakeups: {
            nudgeSent,
            nudgeAccepted,
            pumpRequested,
            pumpChanged,
            wakeups,
            nudgeAcceptancePct: percent(ratio(nudgeAccepted, nudgeSent)),
            pumpYieldPct: percent(ratio(pumpChanged, pumpRequested)),
            duplicatePumpNoopPct: percent(ratio(duplicatePumpNoops, pumpRequested)),
            wakeupsPerJob: ratio(wakeups, jobsEnqueued)
        },
        jobs: {
            enqueued: jobsEnqueued,
            terminal: jobTerminal,
            completedOnlyAfterReconcile,
            completedOnlyAfterReconcilePct: percent(ratio(completedOnlyAfterReconcile, jobTerminal))
        },
        instrumentation,
        missingForFullModel: Object.entries({
            nudge: !instrumentation.hasNudgeCounters,
            pump: !instrumentation.hasPumpCounters,
            job: !instrumentation.hasJobCounters
        }).filter(([, missing]) => missing).map(([name]) => name),
        phases: summarizePhases(currentEpoch.phases || {}),
        phaseNotes: {
            storageGetMs: 'journal storageGetMs/storageGetCumulativeMs are cumulative subcall pressure; ownStorageGetMs is merged wall time for overlapping storage get intervals',
            storageSetMs: 'journal storageSetMs/storageSetCumulativeMs are cumulative subcall pressure; ownStorageSetMs is merged wall time for overlapping storage set intervals'
        },
        journal: {
            count: Array.isArray(currentEpoch.journal) ? currentEpoch.journal.length : 0,
            ...groupJournal(currentEpoch.journal || {}),
            tail: (currentEpoch.journal || []).slice(-20)
        }
    }
}

async function readLiveMetrics() {
    const config = getCdpConfig()
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const serviceWorker = targets.find(target =>
        target.type === 'service_worker' && (target.url || '').includes(config.extensionId)
    )
    const extensionPage = targets.find(target => target.type === 'page' && target.url === dashboardUrl) ||
        targets.find(target => target.type === 'page' && (target.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    const readTargets = [extensionPage, serviceWorker].filter(Boolean)

    if(!readTargets.length) {
        return {
            extensionPage: false,
            serviceWorker: false,
            metrics: null
        }
    }

    let readTarget = null
    let result = null
    const readAttempts = []
    for(const candidate of readTargets) {
        readTarget = candidate
        result = await evaluate(candidate.webSocketDebuggerUrl, `(${function readMetrics(key) {
        return new Promise(resolve => {
            const timeout = setTimeout(() => resolve({
                timedOut: true,
                lastError: 'chrome.storage.local.get timed out',
                metrics: null
            }), 5000)
            const finish = value => {
                clearTimeout(timeout)
                resolve(value)
            }
            try {
                if(!chrome?.storage?.local) {
                    finish({
                        timedOut: false,
                        lastError: 'chrome.storage.local unavailable',
                        metrics: null
                    })
                    return
                }
                chrome.storage.local.get({[key]: null}, storage => {
                    finish({
                        timedOut: false,
                        lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : '',
                        metrics: storage?.[key] || null
                    })
                })
            }
            catch(error) {
                finish({
                    timedOut: false,
                    lastError: error?.message || String(error || ''),
                    metrics: null
                })
            }
        })
    }})(${JSON.stringify(METRICS_KEY)})`, 10000).catch(error => ({
            timedOut: true,
            lastError: error.message,
            metrics: null
        }))
        readAttempts.push({
            id: candidate.id,
            title: candidate.title || '',
            type: candidate.type || '',
            url: candidate.url || '',
            storageRead: {
                timedOut: result?.timedOut === true,
                lastError: result?.lastError || ''
            },
            hasMetrics: !!result?.metrics
        })
        if(result?.metrics) break
    }

    return {
        extensionPage: !!extensionPage,
        serviceWorker: !!serviceWorker,
        target: {
            id: readTarget.id,
            title: readTarget.title || '',
            type: readTarget.type || '',
            url: readTarget.url || ''
        },
        storageRead: {
            timedOut: result?.timedOut === true,
            lastError: result?.lastError || ''
        },
        readAttempts,
        metrics: result?.metrics || null
    }
}

runMain(async () => {
    const file = getOption('file', '')
    const raw = getOption('raw', '') === '1' || process.argv.includes('--raw')
    const liveResult = file ? {extensionPage: null, metrics: readJsonFile(file)} : await readLiveMetrics()

    if(!liveResult.metrics) {
        console.log(JSON.stringify({
            ...liveResult,
            metrics: null,
            summary: null
        }, null, 2))
        process.exitCode = 1
        return
    }

    const summary = analyzeMetrics(liveResult.metrics)
    console.log(JSON.stringify(raw ? {
        ...liveResult,
        summary
    } : {
        extensionPage: liveResult.extensionPage,
        serviceWorker: liveResult.serviceWorker,
        target: liveResult.target,
        storageRead: liveResult.storageRead,
        summary
    }, null, 2))
})
