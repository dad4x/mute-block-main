#!/usr/bin/env node

const fs = require('fs')

function normalizeKey(entry = {}) {
    return `${entry.rowKey || entry.targetUrl || ''}`.trim()
}

function readReport(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'))
}

function getEntries(report) {
    const entries = report?.mediumBatchQueueSmoke?.preRestartFlightRecorder?.response?.entries ||
        report?.preRestartFlightRecorder?.response?.entries ||
        report?.flightRecorder?.response?.entries ||
        report?.entries ||
        []
    return Array.isArray(entries) ? entries : []
}

function compact(entry = {}, startAt = 0) {
    const at = Number.parseInt(entry.at, 10) || 0
    return {
        seq: entry.seq || 0,
        t: startAt ? at - startAt : at,
        kind: entry.kind || '',
        source: entry.source || '',
        key: normalizeKey(entry),
        reason: entry.reason || '',
        statusBefore: entry.statusBefore || '',
        statusAfter: entry.statusAfter || '',
        accepted: entry.accepted,
        changed: entry.changed,
        durable: entry.durable,
        tabId: entry.tabId || 0,
        windowId: entry.windowId || 0
    }
}

function summarize(entries) {
    const startAt = entries.find(entry => entry.kind === 'start-resume' && entry.accepted === true)?.at ||
        entries[0]?.at ||
        0
    const byKey = new Map()
    for(const entry of entries) {
        const key = normalizeKey(entry)
        if(!key) continue
        if(!byKey.has(key)) byKey.set(key, [])
        byKey.get(key).push(entry)
    }

    const keySummaries = []
    for(const [key, keyEntries] of byKey.entries()) {
        keyEntries.sort((left, right) => (left.seq || 0) - (right.seq || 0))
        const firstDecision = keyEntries.find(entry => entry.kind === 'queued-tab-open-decision' && entry.accepted === true)
        const firstRequest = keyEntries.find(entry => entry.kind === 'tab-open-request')
        const firstResult = keyEntries.find(entry => entry.kind === 'tab-open-result')
        const firstActive = keyEntries.find(entry => entry.kind === 'active-transition' && entry.accepted === true)
        const firstTerminal = keyEntries.find(entry =>
            entry.kind === 'authority-mutation' &&
            entry.accepted === true &&
            /succeeded|failed|canceled|cancelled/i.test(`${entry.statusAfter || ''}`)
        )
        keySummaries.push({
            key,
            firstDecisionMs: firstDecision ? firstDecision.at - startAt : null,
            firstRequestMs: firstRequest ? firstRequest.at - startAt : null,
            firstResultMs: firstResult ? firstResult.at - startAt : null,
            firstActiveMs: firstActive ? firstActive.at - startAt : null,
            firstTerminalMs: firstTerminal ? firstTerminal.at - startAt : null,
            requestDelayMs: firstDecision && firstRequest ? firstRequest.at - firstDecision.at : null,
            activeDelayMs: firstResult && firstActive ? firstActive.at - firstResult.at : null,
            terminalDelayMs: firstActive && firstTerminal ? firstTerminal.at - firstActive.at : null,
            inFlightDecisions: keyEntries.filter(entry => entry.reason === 'queued-activation-in-flight').length,
            staleRuntimeClassifications: keyEntries.filter(entry => entry.reason === 'queued-with-stale-runtime-surface').length
        })
    }

    const interestingReasons = [
        'queued-with-stale-runtime-surface',
        'queued-activation-in-flight',
        'queued-stale-runtime-action-drained-before-authority',
        'resolved-stale-runtime-drained-before-authority',
        'executor-durable-queued-work-without-runtime',
        'queued-tab-fill-timeout',
        'recovered-timed-out-tab-create'
    ]
    const timeline = entries
        .filter(entry =>
            entry.kind === 'tab-open-request' ||
            entry.kind === 'tab-open-result' ||
            entry.kind === 'active-transition' ||
            entry.kind === 'authority-mutation' ||
            entry.kind === 'queue-drained' ||
            interestingReasons.includes(`${entry.reason || ''}`))
        .map(entry => compact(entry, startAt))

    const reasonCounts = {}
    for(const entry of entries) {
        const reason = `${entry.reason || ''}`
        if(!reason) continue
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
    }

    return {
        entryCount: entries.length,
        startAt,
        keySummaries,
        reasonCounts: Object.fromEntries(
            Object.entries(reasonCounts)
                .sort((left, right) => right[1] - left[1])
                .slice(0, 30)
        ),
        timeline
    }
}

const reportPath = process.argv[2]
if(!reportPath) {
    console.error('usage: analyze-recorder-report.js <report-json>')
    process.exit(2)
}

console.log(JSON.stringify(summarize(getEntries(readReport(reportPath))), null, 2))
