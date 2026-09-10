#!/usr/bin/env node

const {
    evaluate,
    getCdpConfig,
    getOption,
    getTargets,
    runMain
} = require('./lib/cdp')

function normalizeKey(entry = {}) {
    return `${entry.rowKey || entry.targetUrl || ''}`.trim()
}

function compactEntry(entry = {}) {
    return {
        seq: entry.seq || 0,
        at: entry.at || 0,
        kind: entry.kind || '',
        source: entry.source || '',
        statusBefore: entry.statusBefore || '',
        statusAfter: entry.statusAfter || '',
        reason: entry.reason || '',
        tabId: entry.tabId || 0,
        attemptId: entry.attemptId || '',
        attemptNumber: entry.attemptNumber || 0,
        accepted: entry.accepted,
        changed: entry.changed,
        durable: entry.durable
    }
}

function analyzeEntries(entries = [], options = {}) {
    const minGapMs = Math.max(0, Number.parseInt(options.minGapMs, 10) || 5000)
    const byKey = new Map()
    for(const entry of entries) {
        const key = normalizeKey(entry)
        if(!key) continue
        if(!byKey.has(key)) byKey.set(key, [])
        byKey.get(key).push(entry)
    }

    const suspects = []
    for(const [key, keyEntries] of byKey.entries()) {
        keyEntries.sort((left, right) => (left.seq || 0) - (right.seq || 0))
        const transitions = keyEntries
            .filter(entry => entry.statusBefore || entry.statusAfter || entry.kind === 'active-transition')
            .map(compactEntry)
        const activeTransitions = keyEntries.filter(entry =>
            entry.kind === 'active-transition' &&
            entry.accepted !== false &&
            (entry.statusAfter === 'active' || entry.statusBefore === 'queued' || entry.changed === true)
        )
        const requeues = keyEntries.filter(entry =>
            entry.statusAfter === 'queued' ||
            /requeue|requeued|queued-tab-closed-before-terminal/.test(`${entry.kind} ${entry.reason}`)
        )
        const terminalThenQueued = []
        let sawTerminal = false
        let sawActive = false
        let activeThenQueued = false
        for(const entry of keyEntries) {
            const before = `${entry.statusBefore || ''}`
            const after = `${entry.statusAfter || ''}`
            if(before === 'active' || after === 'active' || entry.kind === 'active-transition') {
                sawActive = true
            }
            if(['succeeded', 'failed', 'canceled'].includes(before) || ['succeeded', 'failed', 'canceled'].includes(after)) {
                sawTerminal = true
            }
            if(sawActive && after === 'queued') activeThenQueued = true
            if(sawTerminal && after === 'queued') terminalThenQueued.push(entry)
        }

        const closedBeforeTerminal = keyEntries.filter(entry => entry.kind === 'closed-before-terminal-requeue')
        const runtimeMissing = keyEntries.filter(entry => entry.kind === 'queued-tab-runtime-missing')
        const stalePrunes = keyEntries.filter(entry => entry.kind === 'queued-tab-action-pruned')
        const reasons = []
        if(activeTransitions.length > 1) reasons.push('multiple-active-transitions')
        if(activeThenQueued) reasons.push('active-to-queued')
        if(terminalThenQueued.length) reasons.push('terminal-to-queued')
        if(closedBeforeTerminal.length) reasons.push('closed-before-terminal')
        if(runtimeMissing.length > 1) reasons.push('repeated-runtime-missing')
        if(stalePrunes.length) reasons.push('stale-action-pruned')
        if(!reasons.length) continue

        suspects.push({
            key,
            reasons,
            counts: {
                entries: keyEntries.length,
                activeTransitions: activeTransitions.length,
                requeues: requeues.length,
                closedBeforeTerminal: closedBeforeTerminal.length,
                runtimeMissing: runtimeMissing.length,
                stalePrunes: stalePrunes.length
            },
            firstSeq: keyEntries[0]?.seq || 0,
            lastSeq: keyEntries[keyEntries.length - 1]?.seq || 0,
            transitions: transitions.slice(-20)
        })
    }

    const terminalEntries = entries
        .filter(entry => ['succeeded', 'failed', 'canceled'].includes(`${entry.statusAfter || ''}`))
        .sort((left, right) => (left.at || 0) - (right.at || 0))
    const handoffGaps = []
    for(let index = 0; index < terminalEntries.length - 1; index += 1) {
        const current = terminalEntries[index]
        const next = terminalEntries[index + 1]
        const gapMs = (next.at || 0) - (current.at || 0)
        if(gapMs >= minGapMs) {
            handoffGaps.push({
                gapMs,
                terminalSeq: current.seq || 0,
                terminalKey: normalizeKey(current),
                terminalStatus: current.statusAfter || '',
                nextSeq: next.seq || 0,
                nextKey: normalizeKey(next),
                nextStatus: next.statusAfter || ''
            })
        }
    }

    suspects.sort((left, right) =>
        right.reasons.length - left.reasons.length ||
        right.counts.entries - left.counts.entries ||
        left.firstSeq - right.firstSeq
    )

    return {
        suspectCount: suspects.length,
        suspects,
        longTerminalGaps: handoffGaps.slice(-20)
    }
}

async function readFlightRecorder(config, request, timeoutMs) {
    const targets = await getTargets(config)
    const dashboardUrl = `chrome-extension://${config.extensionId}/coordinator.html`
    const target = targets.find(entry => entry.type === 'page' && entry.url === dashboardUrl) ||
        targets.find(entry => entry.type === 'page' && (entry.url || '').startsWith(`chrome-extension://${config.extensionId}/`))
    if(!target) return {target: null, result: {readOnly: true, error: 'extension-page-unavailable', entries: []}}

    const result = await evaluate(target.webSocketDebuggerUrl, `(${function readFlightRecorderViaMessage(request, timeoutMs) {
        return new Promise(resolve => {
            let settled = false
            const finish = value => {
                if(settled) return
                settled = true
                resolve(value)
            }
            setTimeout(() => finish({
                readOnly: true,
                error: 'flight-recorder-message-timeout',
                entries: []
            }), timeoutMs)
            chrome.runtime.sendMessage({
                action: 'get-flight-recorder',
                ...request
            }, response => finish(response || {
                readOnly: true,
                error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'flight-recorder-empty-response',
                entries: []
            }))
        })
    }})(${JSON.stringify(request)}, ${JSON.stringify(timeoutMs)})`, timeoutMs + 5000)

    return {
        target: {
            id: target.id,
            type: target.type || '',
            url: target.url || ''
        },
        result
    }
}

runMain(async () => {
    const config = getCdpConfig()
    const limit = Number.parseInt(getOption('limit', process.env.MB_FLIGHT_RECORDER_LIMIT || '2000'), 10) || 2000
    const kind = getOption('kind', process.env.MB_FLIGHT_RECORDER_KIND || '')
    const rowKey = getOption('row-key', process.env.MB_FLIGHT_RECORDER_ROW_KEY || '')
    const targetUrl = getOption('target-url', process.env.MB_FLIGHT_RECORDER_TARGET_URL || '')
    const timeoutMs = Math.max(1000, Number.parseInt(getOption('timeout-ms', '10000'), 10) || 10000)
    const minGapMs = Math.max(0, Number.parseInt(getOption('min-gap-ms', '5000'), 10) || 5000)
    const snapshot = await readFlightRecorder(config, {limit, kind, rowKey, targetUrl}, timeoutMs)
    const entries = Array.isArray(snapshot.result?.entries) ? snapshot.result.entries : []
    console.log(JSON.stringify({
        target: snapshot.target,
        recorder: {
            error: snapshot.result?.error || '',
            capacity: snapshot.result?.capacity || 0,
            droppedCount: snapshot.result?.droppedCount || 0,
            oldestSeq: snapshot.result?.oldestSeq || 0,
            newestSeq: snapshot.result?.newestSeq || 0,
            entryCount: entries.length
        },
        audit: analyzeEntries(entries, {minGapMs})
    }, null, 2))
})
