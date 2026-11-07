// Synthetic behaviour of the worker's log writers, before the refactor that gives every log user the same code: queue rows and runs. Each test
// writes through the worker's write door, restarts the worker on the same storage, and checks what it reads back. Nothing is shown to a browser.
//
// Archived (completed) rows are read back through the worker's own lookups (findCompletedWorkRowByKey, getRecentCompletedWorkRows), exported for tests.
const assert = require('node:assert/strict')
const {loadServiceWorkerHarness} = require('./lib/swHarness')

const NOW = 600000
const RUNS_KEY = 'mbCoordinatorRuns'

let failed = 0
function test(name, fn) {
    return fn().then(() => {
        console.log(`ok - ${name}`)
    }, error => {
        failed += 1
        console.log(`not ok - ${name}`)
        console.log(error?.stack || error)
    })
}

function hrefFor(index) {
    return `https://www.quora.com/profile/Synthetic-Log-${index}`
}

function queuedRow(index, runId, now = NOW) {
    const href = hrefFor(index)
    return {
        href,
        status: 'queued',
        runId,
        attemptId: `attempt-${index}`,
        attemptNumber: 1,
        serviceWorkerOwned: true,
        executorOwner: 'service-worker',
        targetProfileHref: href,
        requestedUrl: href,
        dedupeKey: href,
        actionKind: 'mute-block',
        queuedAt: now,
        updatedAt: now
    }
}

function enqueueResult(row) {
    return {
        operationKind: 'synthetic-log-enqueue',
        rowKey: row.href,
        accepted: true,
        changed: true,
        durable: true,
        reason: 'persisted',
        previousRow: null,
        nextRow: row,
        terminal: false
    }
}

function runRecord(runId, hrefs) {
    return {
        id: runId,
        sourceType: 'space-feed',
        createdAt: NOW,
        sourcePages: ['https://trollsgalore.quora.com/post-1'],
        targetProfileHrefs: hrefs,
        targetWorkKeys: hrefs,
        itemCount: hrefs.length,
        activeCount: 0,
        terminalCount: 0,
        status: 'queued',
        updatedAt: NOW
    }
}

function freshHarness(storage = {}) {
    return loadServiceWorkerHarness({now: NOW, storage: {
        mbCoordinatorPaused: false,
        mbCoordinatorEvents: [],
        ...storage
    }})
}

async function restart(harness, now = NOW + 10) {
    const next = loadServiceWorkerHarness({now, storage: harness.storage})
    await next.sw.coordinatorAuthority.hydrate()
    return next
}

async function run() {
    await test('queue rows written through the door are read back after a restart', async () => {
        const harness = freshHarness()
        await harness.sw.coordinatorAuthority.hydrate()
        const rows = Array.from({length: 40}, (_, index) => queuedRow(index, 'run-log-1'))
        for (let start = 0; start < rows.length; start += 10) {
            const batch = rows.slice(start, start + 10)
            const saved = await harness.sw.coordinatorAuthority.persistCoordinator({
                results: batch.map(enqueueResult)
            }, {operationKind: 'synthetic-log-enqueue', reason: 'ordinaryMutation', metricPath: 'test.log.queue'})
            assert.equal(saved.saved, true, saved.reason)
        }
        const next = await restart(harness)
        const queue = next.sw.coordinatorAuthority.current().queue
        assert.equal(Object.keys(queue).length, 40)
        for (const row of rows) {
            assert.equal(queue[row.href]?.status, 'queued', row.href)
            assert.equal(queue[row.href]?.attemptId, row.attemptId)
            assert.equal(queue[row.href]?.runId, 'run-log-1')
        }
    })

    await test('a row that changes status is read back with its new status', async () => {
        const harness = freshHarness()
        await harness.sw.coordinatorAuthority.hydrate()
        const row = queuedRow(0, 'run-log-2')
        await harness.sw.coordinatorAuthority.persistCoordinator({results: [enqueueResult(row)]}, {
            operationKind: 'synthetic-log-enqueue', reason: 'ordinaryMutation', metricPath: 'test.log.queue'
        })
        const active = {...row, status: 'active', activeAt: NOW + 5, updatedAt: NOW + 5}
        const changed = await harness.sw.coordinatorAuthority.persistCoordinator({
            results: [{
                operationKind: 'synthetic-log-activate', rowKey: row.href, accepted: true, changed: true, durable: true,
                reason: 'persisted', previousRow: row, nextRow: active, terminal: false
            }]
        }, {operationKind: 'synthetic-log-activate', reason: 'ordinaryMutation', metricPath: 'test.log.queue'})
        assert.equal(changed.saved, true, changed.reason)
        const next = await restart(harness)
        assert.equal(next.sw.coordinatorAuthority.current().queue[row.href]?.status, 'active')
    })

    await test('runs written through the door are read back after a restart', async () => {
        const harness = freshHarness()
        await harness.sw.coordinatorAuthority.hydrate()
        const hrefs = Array.from({length: 25}, (_, index) => hrefFor(index))
        const runs = {'run-log-3': runRecord('run-log-3', hrefs)}
        const saved = await harness.sw.coordinatorAuthority.persistCoordinator({
            stored: {[RUNS_KEY]: runs}
        }, {operationKind: 'synthetic-log-runs', reason: 'ordinaryMutation', metricPath: 'test.log.runs'})
        assert.equal(saved.saved, true, saved.reason)
        const next = await restart(harness)
        const readBack = next.sw.coordinatorAuthority.current().runs || {}
        assert.deepEqual(readBack['run-log-3']?.targetProfileHrefs, hrefs)
        assert.equal(readBack['run-log-3']?.sourceType, 'space-feed')
    })

    await test('a queue write does not drop the runs already stored', async () => {
        const harness = freshHarness()
        await harness.sw.coordinatorAuthority.hydrate()
        const hrefs = [hrefFor(0), hrefFor(1)]
        await harness.sw.coordinatorAuthority.persistCoordinator({
            stored: {[RUNS_KEY]: {'run-log-4': runRecord('run-log-4', hrefs)}}
        }, {operationKind: 'synthetic-log-runs', reason: 'ordinaryMutation', metricPath: 'test.log.runs'})
        const row = queuedRow(0, 'run-log-4')
        const saved = await harness.sw.coordinatorAuthority.persistCoordinator({results: [enqueueResult(row)]}, {
            operationKind: 'synthetic-log-enqueue', reason: 'ordinaryMutation', metricPath: 'test.log.queue'
        })
        assert.equal(saved.saved, true, saved.reason)
        const next = await restart(harness)
        const readBack = next.sw.coordinatorAuthority.current().runs || {}
        assert.deepEqual(readBack['run-log-4']?.targetProfileHrefs, hrefs)
        assert.equal(next.sw.coordinatorAuthority.current().queue[row.href]?.status, 'queued')
    })

    await test('a queue row and a run written in one change are both read back', async () => {
        const harness = freshHarness()
        await harness.sw.coordinatorAuthority.hydrate()
        const row = queuedRow(7, 'run-log-5')
        const hrefs = [row.href]
        const saved = await harness.sw.coordinatorAuthority.persistCoordinator({
            results: [enqueueResult(row)],
            stored: {[RUNS_KEY]: {'run-log-5': runRecord('run-log-5', hrefs)}}
        }, {operationKind: 'synthetic-log-combined', reason: 'ordinaryMutation', metricPath: 'test.log.combined'})
        assert.equal(saved.saved, true, saved.reason)
        const next = await restart(harness)
        const current = next.sw.coordinatorAuthority.current()
        assert.equal(current.queue[row.href]?.status, 'queued')
        assert.deepEqual(current.runs?.['run-log-5']?.targetProfileHrefs, hrefs)
    })

    await test('runs are not written into the queue log when only the queue changes', async () => {
        const harness = freshHarness({[RUNS_KEY]: {'run-log-6': runRecord('run-log-6', [hrefFor(9)])}})
        await harness.sw.coordinatorAuthority.hydrate()
        const row = queuedRow(9, 'run-log-6')
        await harness.sw.coordinatorAuthority.persistCoordinator({results: [enqueueResult(row)]}, {
            operationKind: 'synthetic-log-enqueue', reason: 'ordinaryMutation', metricPath: 'test.log.queue'
        })
        const next = await restart(harness)
        assert.deepEqual(next.sw.coordinatorAuthority.current().runs?.['run-log-6']?.targetProfileHrefs, [hrefFor(9)])
    })

    await test('an archived (completed) row written through the door is read back after a restart', async () => {
        const harness = freshHarness()
        await harness.sw.coordinatorAuthority.hydrate()
        const href = hrefFor(21)
        const finished = {
            ...queuedRow(21, 'run-log-7'),
            status: 'succeeded',
            terminalAt: NOW + 3,
            updatedAt: NOW + 3
        }
        // A finished row moves to the archive as its queue row is removed, in one change (the door does not write archive rows alone).
        const live = queuedRow(21, 'run-log-7')
        const enqueued = await harness.sw.coordinatorAuthority.persistCoordinator({results: [enqueueResult(live)]}, {
            operationKind: 'synthetic-log-enqueue', reason: 'ordinaryMutation', metricPath: 'test.log.queue'
        })
        assert.equal(enqueued.saved, true, enqueued.reason)
        // The archive entries carry the row they came from (rowKey, previousRow), as the worker's own archive call does.
        const saved = await harness.sw.coordinatorAuthority.persistCoordinator({
            removedRows: [{rowKey: href, previousRow: live, operationKind: 'archive-terminal-row', reason: 'ordinaryMutation'}],
            completedRows: [{rowKey: href, previousRow: finished, operationKind: 'archive-terminal-row', reason: 'ordinaryMutation'}]
        }, {operationKind: 'archive-terminal-row', reason: 'ordinaryMutation', metricPath: 'test.log.completed'})
        assert.equal(saved.saved, true, saved.reason)
        const next = await restart(harness)
        const byKey = await next.sw.findCompletedWorkRowByKey(href)
        assert.equal(byKey?.status, 'succeeded', 'the archived row is found by its key')
        const recent = await next.sw.getRecentCompletedWorkRows(10)
        assert.ok(recent.some(row => row?.href === href || row?.targetProfileHref === href), 'the archived row is in the recent list')
    })

    await test('a log write that fails keeps neither the row nor its run; a retry keeps both, and a restart reads both back', async () => {
        const harness = freshHarness()
        await harness.sw.coordinatorAuthority.hydrate()
        const row = queuedRow(31, 'run-log-atomic')
        const hrefs = [row.href]
        const runs = {'run-log-atomic': runRecord('run-log-atomic', hrefs)}
        const change = {results: [enqueueResult(row)], stored: {[RUNS_KEY]: runs}}
        const options = {operationKind: 'synthetic-log-atomic', reason: 'ordinaryMutation', metricPath: 'test.log.atomic'}

        // The next log write fails. The row and the run are one write, so neither is kept.
        let failLogWrites = true
        const originalSet = harness.browser.storage.local.set.bind(harness.browser.storage.local)
        harness.browser.storage.local.set = async payload => {
            if (failLogWrites && Object.keys(payload || {}).some(key => key.startsWith('mbCoordinatorQueueWal'))) {
                throw new Error('synthetic log write failure')
            }
            return originalSet(payload)
        }
        let failedWrite = null
        try {
            failedWrite = await harness.sw.coordinatorAuthority.persistCoordinator(change, options)
        }
        catch (error) {
            // The door raises a failed log write to its caller; nothing is kept either way.
            failedWrite = {saved: false, error}
        }
        assert.notEqual(failedWrite.saved, true, 'the write that failed is not reported as saved')
        assert.equal(harness.sw.coordinatorAuthority.current().queue[row.href], undefined, 'the row is not kept in memory')
        assert.equal(harness.sw.coordinatorAuthority.current().runs?.['run-log-atomic'], undefined, 'the run is not kept in memory')
        const afterFailure = await restart(harness)
        assert.equal(afterFailure.sw.coordinatorAuthority.current().queue[row.href], undefined, 'the row is not on disk after a restart')
        assert.equal(afterFailure.sw.coordinatorAuthority.current().runs?.['run-log-atomic'], undefined, 'the run is not on disk after a restart')

        // The retry succeeds, and both are kept, in memory and after a restart.
        failLogWrites = false
        const retried = await harness.sw.coordinatorAuthority.persistCoordinator(change, options)
        assert.equal(retried.saved, true, retried.reason)
        assert.equal(harness.sw.coordinatorAuthority.current().queue[row.href]?.status, 'queued')
        assert.deepEqual(harness.sw.coordinatorAuthority.current().runs?.['run-log-atomic']?.targetProfileHrefs, hrefs)
        const afterRetry = await restart(harness)
        assert.equal(afterRetry.sw.coordinatorAuthority.current().queue[row.href]?.status, 'queued')
        assert.deepEqual(afterRetry.sw.coordinatorAuthority.current().runs?.['run-log-atomic']?.targetProfileHrefs, hrefs)
    })

    if (failed) {
        console.log(`${failed} log synthetic test(s) failed`)
        process.exitCode = 1
    }
}

run()
