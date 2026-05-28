const assert = require('node:assert/strict')
const {
    createFakeBrowser,
    loadServiceWorkerHarness
} = require('./lib/swHarness')
const {
    getWalRecordsForGeneration,
    recoverProjectedState
} = require('../shared/js/walSnapshotStore')

const tests = []

function test(name, fn) {
    tests.push({name, fn})
}

async function flushAsync(rounds = 1) {
    for(let index = 0; index < rounds; index += 1) {
        await Promise.resolve()
    }
}

function deferred() {
    let resolve
    let reject
    const promise = new Promise((innerResolve, innerReject) => {
        resolve = innerResolve
        reject = innerReject
    })
    return {promise, resolve, reject}
}

async function waitFor(predicate, message, options = {}) {
    const attempts = Number.parseInt(options.attempts, 10) || 20
    const timers = options.timers || null
    const tickMs = Number.parseInt(options.tickMs, 10) || 0

    for(let index = 0; index < attempts; index += 1) {
        const value = await predicate()
        if(value) return value
        await flushAsync(25)
        if(timers) await timers.tick(tickMs)
    }

    throw new Error(message)
}

async function settleWithFakeTimers(promise, timers, steps = [0, 1000, 4000, 5000, 15000, 30000]) {
    let settled = false
    let settledValue
    let settledError

    promise.then(value => {
        settled = true
        settledValue = value
    }, error => {
        settled = true
        settledError = error
    })

    await flushAsync(200)
    if(settledError) throw settledError
    if(settled) return settledValue

    for(const step of steps) {
        await flushAsync(10)
        if(settled) break
        await timers.tick(step)
        if(settled) break
    }

    await flushAsync(50)
    if(settledError) throw settledError
    if(!settled) throw new Error('fake-timer operation did not settle')
    return settledValue
}

function listTabs(browser) {
    return Array.from(browser.__tabs.values())
}

function getProgressShardRecord(storage, href) {
    for(const [key, shard] of Object.entries(storage || {})) {
        if(!key.startsWith('mbProfileNukeProgressShard.')) continue
        const record = shard?.records?.[href]
        if(record) return record
    }
    return null
}

function getRecoveredCoordinatorQueue(storage = {}) {
    if(storage?.mbCoordinatorQueueWal) {
        const recovered = recoverProjectedState(storage.mbCoordinatorQueueWal)
        const queue = recovered?.projected?.state?.queue || recovered?.state?.queue
        if(queue && typeof queue === 'object') return queue
    }
    return storage?.mbCoordinatorQueue || {}
}

async function activateQuoraRuntime(browser, url = 'https://www.quora.com/profile/Synthetic-Activation') {
    await browser.tabs.onUpdated.emit(101, {
        status: 'loading',
        url
    }, {
        id: 101,
        url
    })
    await flushAsync(5)
}

function makeCoordinatorEnqueue({href, runId, execute}) {
    const request = {
        action: 'enqueue-coordinator-items',
        run: {
            id: runId,
            sourceType: 'space-feed'
        },
        source: {
            type: 'space-feed',
            pageUrl: 'https://www.quora.com/space/example'
        },
        items: [{
            targetProfileHref: href,
            requestedUrl: href,
            dedupeKey: href
        }]
    }
    if(execute !== undefined) request.execute = execute
    return request
}

function makeActiveCoordinatorRow({href, runId, attemptId, tabId = 501, now = 100000}) {
    return {
        runId,
        status: 'active',
        actionKind: 'mute-block',
        executorTabAction: 'nuke',
        executorOwner: 'service-worker',
        serviceWorkerOwned: true,
        executorNoForegroundFallback: true,
        executorMaxConcurrent: 1,
        targetProfileHref: href,
        requestedUrl: href,
        dedupeKey: href,
        coordinatorKey: href,
        queuedAt: now - 1000,
        activeAt: now - 500,
        updatedAt: now - 500,
        tabId,
        attemptId,
        attemptNumber: 1,
        milestones: {}
    }
}

function makeQueuedCoordinatorRow({href, runId, attemptId, now = 100000}) {
    return {
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        executorTabAction: 'nuke',
        executorOwner: 'service-worker',
        serviceWorkerOwned: true,
        executorNoForegroundFallback: true,
        executorMaxConcurrent: 1,
        targetProfileHref: href,
        requestedUrl: href,
        dedupeKey: href,
        coordinatorKey: href,
        queuedAt: now - 1000,
        updatedAt: now - 1000,
        attemptId,
        attemptNumber: 1,
        milestones: {}
    }
}

function makeFailedCoordinatorRow({href, runId, attemptId, requestedUrl = href, now = 100000, evidence = [], error = 'Queued tab timed out before completion'}) {
    return {
        runId,
        status: 'failed',
        outcome: 'timeout',
        error,
        actionKind: 'mute-block',
        executorTabAction: 'nuke',
        executorOwner: 'service-worker',
        serviceWorkerOwned: true,
        executorNoForegroundFallback: true,
        executorMaxConcurrent: 1,
        targetProfileHref: href,
        requestedUrl,
        dedupeKey: href,
        coordinatorKey: href,
        queuedAt: now - 2000,
        activeAt: now - 1000,
        updatedAt: now - 500,
        terminalAt: now - 500,
        tabId: null,
        attemptId,
        attemptNumber: 1,
        retryCount: 0,
        lastRetryAt: 0,
        evidence,
        milestones: {}
    }
}

function makeCoordinatorRun({href, runId}) {
    return {
        id: runId,
        sourceType: 'profile-search',
        status: 'active',
        targetProfileHrefs: [href],
        targetWorkKeys: [href]
    }
}

test('row event records same-attempt nonterminal queued progress without rereading full progress', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Row-Event'
    const runId = 'run-row-event'
    const attemptId = 'attempt-row-event'
    const tabId = 501
    const {storage, sw, timers} = loadServiceWorkerHarness({
        now: 100000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 100000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 99500
                }
            }
        }
    })

    const first = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'page-ready',
            actionReadyAt: 100010,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })
    assert.equal(first.recorded, true)

    const beforeSecond = sw.state().queueWakeupCounters
    const second = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'blocking',
            blockAttemptedAt: 100020,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })
    const afterSecond = sw.state().queueWakeupCounters

    assert.equal(second.recorded, true)
    assert.equal(second.terminal, false)
    assert.equal(second.progressProjectionDurable, true)
    assert.equal(second.progressOperation.operationKind, 'queued-progress-milestone')
    assert.equal(second.progressOperation.area, 'progress')
    assert.equal(second.progressOperation.rowKey, href)
    assert.equal(second.progressOperation.accepted, true)
    assert.equal(second.progressOperation.changed, true)
    assert.equal(second.progressOperation.durable, true)
    assert.equal(second.progressOperation.reason, 'projection-persisted')
    assert.equal(second.progressOperation.previousRecord.status, 'page-ready')
    assert.equal(second.progressOperation.nextRecord.status, 'blocking')
    assert.equal(second.progressShadowWal.checked, true)
    assert.equal(second.progressShadowWal.matched, true)
    assert.equal(second.progressShadowWal.withPrevious, true)
    assert.equal(second.progressShadowWal.operationKind, 'queued-progress-milestone')
    assert.equal(second.progressShadowWal.record.kind, 'map.set')
    assert.equal(second.progressShadowWal.record.area, 'progress')
    assert.equal(second.progressShadowWal.record.key, href)
    assert.equal(second.progressShadowWal.record.operationKind, 'queued-progress-milestone')
    assert.equal(second.progressShadowWal.record.reason, 'projection-persisted')
    assert.equal(second.progressShadowWal.record.value.status, 'blocking')
    assert.equal(second.progressShadowWal.projectedRecord.status, 'blocking')
    assert.equal(second.progressShadowWal.append.appended, true)
    assert.equal(second.progressShadowWal.append.records.length, 1)
    assert.equal(second.progressShadowWal.append.matched, 1)
    assert.equal(second.progressShadowWal.append.mismatched, 0)
    assert.equal(second.progressShadowWal.append.totalRecords, 2)
    const shadowWalRecords = getWalRecordsForGeneration(
        sw.state().progressShadowWalStore,
        second.progressShadowWal.append.generationId
    )
    assert.equal(shadowWalRecords.length, 2)
    assert.equal(shadowWalRecords[1].area, 'progress')
    assert.equal(shadowWalRecords[1].key, href)
    assert.equal(shadowWalRecords[1].operationKind, 'queued-progress-milestone')
    assert.equal(shadowWalRecords[1].reason, 'projection-persisted')
    const recoveredShadow = recoverProjectedState(sw.state().progressShadowWalStore)
    assert.equal(recoveredShadow.recovered, true)
    assert.equal(recoveredShadow.projected.state.progress[href].status, 'blocking')
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocking')
    assert.equal(sw.state().profileNukeProgress[href].attemptId, attemptId)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opened')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'blocking')
    assert.equal(getProgressShardRecord(storage, href).status, 'blocking')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.notEqual(storage.mbCoordinatorQueue[href].milestones.blockAttemptedAt, 100020)
    assert.equal(
        (afterSecond['storagePayload.read.progress.bytes'] || 0) -
            (beforeSecond['storagePayload.read.progress.bytes'] || 0),
        0
    )
    assert.equal(
        (afterSecond['storagePayload.write.queue.bytes'] || 0) -
            (beforeSecond['storagePayload.write.queue.bytes'] || 0),
        0
    )
    assert.equal(
        (afterSecond['storagePayload.write.progress.bytes'] || 0) -
            (beforeSecond['storagePayload.write.progress.bytes'] || 0),
        0
    )
    assert.ok(afterSecond['storagePayload.read.path.rowEvent.queued-progress-milestone.load.bytes'] > 0)
    assert.equal(afterSecond['rowEvent.queued-progress-milestone.accepted'] || 0, 2)
    assert.ok((afterSecond['rowEvent.queued-progress-milestone.queueSnapshotSkipped'] || 0) >= 1)
    assert.equal(afterSecond['progress.shadowWal.checked'] || 0, 2)
    assert.equal(afterSecond['progress.shadowWal.matched'] || 0, 2)
    assert.equal(afterSecond['progress.shadowWal.mismatched'] || 0, 0)
    assert.equal(afterSecond['progress.shadowWal.withPrevious'] || 0, 2)
    assert.equal(afterSecond['rowEvent.queued-progress-milestone.shadowWal.checked'] || 0, 2)
    assert.equal(afterSecond['rowEvent.queued-progress-milestone.shadowWal.matched'] || 0, 2)
    assert.equal(afterSecond['rowEvent.queued-progress-milestone.shadowWal.withPrevious'] || 0, 2)
    assert.equal(afterSecond['progress.shadowWal.appended'] || 0, 2)
    assert.equal(afterSecond['progress.shadowWal.appendBatches'] || 0, 2)
    assert.equal(afterSecond['progress.shadowWal.appendProjectionMatched'] || 0, 2)
    assert.equal(afterSecond['progress.shadowWal.appendProjectionMismatched'] || 0, 0)
    assert.ok(afterSecond['progress.shadowWal.bytes'] > 0)

    const repeat = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            ...second.record
        }
    })
    const afterRepeat = sw.state().queueWakeupCounters

    assert.equal(repeat.recorded, true)
    assert.equal(repeat.progressProjectionDurable, true)
    assert.equal(repeat.progressOperation.changed, false)
    assert.equal(repeat.progressOperation.durable, true)
    assert.equal(repeat.progressOperation.reason, 'projection-persisted')
    assert.equal(repeat.progressShadowWal.checked, false)
    assert.equal(repeat.progressShadowWal.matched, false)
    assert.equal(repeat.progressShadowWal.reason, 'no-change')
    assert.equal(repeat.progressShadowWal.skippedNoChange, true)
    assert.equal(repeat.progressShadowWal.append, undefined)
    assert.equal(afterRepeat['progress.shadowWal.checked'] || 0, afterSecond['progress.shadowWal.checked'] || 0)
    assert.equal(afterRepeat['progress.shadowWal.matched'] || 0, afterSecond['progress.shadowWal.matched'] || 0)
    assert.equal(afterRepeat['progress.shadowWal.appended'] || 0, afterSecond['progress.shadowWal.appended'] || 0)
    assert.equal(afterRepeat['progress.shadowWal.skippedNoChange'] || 0, 1)
    assert.equal(afterRepeat['rowEvent.queued-progress-milestone.shadowWal.skippedNoChange'] || 0, 1)

    await waitFor(
        () => storage.mbProfileNukeProgress[href]?.status === 'blocking',
        'compatibility progress snapshot was not flushed',
        {timers, tickMs: 30000, attempts: 3}
    )
})

test('single current work cancel WAL-terminalizes only the selected pending row', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Cancel-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Cancel-B'
    const runId = 'run-single-cancel'
    const rowA = {
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: hrefA,
        requestedUrl: hrefA,
        dedupeKey: hrefA,
        coordinatorKey: hrefA,
        queuedAt: 499000,
        activeAt: 0,
        updatedAt: 499500,
        tabId: null,
        attemptId: 'attempt-cancel-a',
        attemptNumber: 1,
        milestones: {}
    }
    const rowB = {
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: hrefB,
        requestedUrl: hrefB,
        dedupeKey: hrefB,
        coordinatorKey: hrefB,
        queuedAt: 499000,
        activeAt: 0,
        updatedAt: 499500,
        tabId: null,
        attemptId: 'attempt-cancel-b',
        attemptNumber: 1,
        milestones: {}
    }
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 500000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: rowA,
                [hrefB]: rowB
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [hrefA, hrefB],
                    targetWorkKeys: [hrefA, hrefB]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'cancel-coordinator-current-work-item',
        storageKey: hrefA,
        coordinatorKey: hrefA,
        profileHref: hrefA
    }), timers)

    assert.equal(result.canceledUrls.length, 1)
    assert.equal(result.canceledUrls[0], hrefA)
    assert.equal(result.canceledWorkKeys.length, 0)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefA].status, 'canceled')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefA].outcome, 'paused')
    assert.notEqual(storage.mbCoordinatorQueue[hrefB].status, 'canceled')
    assert.equal(storage.mbCoordinatorQueueView.counts.canceled, 1)
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'current-work-item-cancel')
    assert.equal(recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue[hrefA].status, 'canceled')
    assert.equal(
        (storage.mbCoordinatorQueueView.counts.queued || 0) +
            (storage.mbCoordinatorQueueView.counts.opening || 0) +
            (storage.mbCoordinatorQueueView.counts.active || 0) +
            (storage.mbCoordinatorQueueView.counts.acting || 0) +
            (storage.mbCoordinatorQueueView.counts.settling || 0),
        1
    )
})

test('bulk current work cancel WAL-terminalizes all pending rows as a batch', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Bulk-Cancel-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Bulk-Cancel-B'
    const hrefDone = 'https://www.quora.com/profile/Synthetic-Bulk-Cancel-Done'
    const runId = 'run-bulk-cancel'
    const makeRow = (href, attemptNumber = 1) => ({
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: href,
        requestedUrl: href,
        dedupeKey: href,
        coordinatorKey: href,
        queuedAt: 500100,
        activeAt: 0,
        updatedAt: 500500,
        tabId: null,
        attemptId: `attempt-bulk-cancel-${attemptNumber}`,
        attemptNumber,
        milestones: {}
    })
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 501000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: makeRow(hrefA, 1),
                [hrefB]: makeRow(hrefB, 2),
                [hrefDone]: {
                    ...makeRow(hrefDone, 3),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt: 500700
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [hrefA, hrefB, hrefDone],
                    targetWorkKeys: [hrefA, hrefB, hrefDone]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'cancel-coordinator-current-work'
    }), timers)

    assert.equal(result.canceledUrls.length, 2)
    assert.equal(result.canceledUrls.includes(hrefA), true)
    assert.equal(result.canceledUrls.includes(hrefB), true)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[hrefDone].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefA].status, 'canceled')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefB].status, 'canceled')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefDone].status, 'succeeded')
    assert.equal(storage.mbCoordinatorQueueView.counts.canceled, 2)
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords.every(record => record.operationKind === 'stored-work-cancel'), true)
    const recovered = recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue
    assert.equal(recovered[hrefA].status, 'canceled')
    assert.equal(recovered[hrefB].status, 'canceled')
    assert.equal(recovered[hrefDone].status, 'succeeded')
})

test('queue accounting audit explains raw WAL drift without writing storage', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Accounting-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Accounting-B'
    const runId = 'run-accounting-audit'
    const rowA = {
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: hrefA,
        requestedUrl: hrefA,
        dedupeKey: hrefA,
        coordinatorKey: hrefA,
        queuedAt: 500000,
        updatedAt: 500000,
        tabId: null,
        attemptId: 'attempt-accounting-a',
        attemptNumber: 1,
        milestones: {}
    }
    const rowB = {
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: hrefB,
        requestedUrl: hrefB,
        dedupeKey: hrefB,
        coordinatorKey: hrefB,
        queuedAt: 500001,
        updatedAt: 500001,
        tabId: null,
        attemptId: 'attempt-accounting-b',
        attemptNumber: 1,
        milestones: {}
    }
    const {browser, storage, timers} = loadServiceWorkerHarness({
        now: 500000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: rowA,
                [hrefB]: rowB
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [hrefA, hrefB],
                    targetWorkKeys: [hrefA, hrefB]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'cancel-coordinator-current-work-item',
        storageKey: hrefA,
        coordinatorKey: hrefA,
        profileHref: hrefA
    }), timers)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueView.counts.canceled, 1)

    const before = JSON.stringify({
        queue: storage.mbCoordinatorQueue,
        queueWal: storage.mbCoordinatorQueueWal,
        queueView: storage.mbCoordinatorQueueView
    })
    const accounting = await browser.runtime.sendMessage({
        action: 'get-coordinator-queue-accounting',
        reason: 'synthetic-test'
    })

    assert.equal(JSON.stringify({
        queue: storage.mbCoordinatorQueue,
        queueWal: storage.mbCoordinatorQueueWal,
        queueView: storage.mbCoordinatorQueueView
    }), before)
    assert.equal(accounting.readOnly, true)
    assert.equal(accounting.consistent, true)
    assert.equal(JSON.stringify(accounting.raw.counts), JSON.stringify({queued: 2}))
    assert.equal(accounting.recovered.counts.queued, 1)
    assert.equal(accounting.recovered.counts.canceled, 1)
    assert.equal(accounting.currentWork.ready, 1)
    assert.equal(accounting.currentWork.terminal, 1)
    assert.equal(accounting.wal.recovered, true)
    assert.equal(accounting.wal.activeTailRecords, 1)
    assert.equal(JSON.stringify(accounting.rawDivergences), JSON.stringify(['raw-vs-recovered-counts']))
    assert.equal(JSON.stringify(accounting.mismatches), JSON.stringify([]))
})

test('queue accounting audit flags stale compact dashboard counts', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Accounting-Stale-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Accounting-Stale-B'
    const runId = 'run-accounting-audit-stale'
    const rowA = {
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: hrefA,
        requestedUrl: hrefA,
        dedupeKey: hrefA,
        coordinatorKey: hrefA,
        queuedAt: 500000,
        updatedAt: 500000,
        tabId: null,
        attemptId: 'attempt-accounting-stale-a',
        attemptNumber: 1,
        milestones: {}
    }
    const rowB = {
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: hrefB,
        requestedUrl: hrefB,
        dedupeKey: hrefB,
        coordinatorKey: hrefB,
        queuedAt: 500001,
        updatedAt: 500001,
        tabId: null,
        attemptId: 'attempt-accounting-stale-b',
        attemptNumber: 1,
        milestones: {}
    }
    const {browser, storage, timers} = loadServiceWorkerHarness({
        now: 500000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: rowA,
                [hrefB]: rowB
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [hrefA, hrefB],
                    targetWorkKeys: [hrefA, hrefB]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'cancel-coordinator-current-work-item',
        storageKey: hrefA,
        coordinatorKey: hrefA,
        profileHref: hrefA
    }), timers)
    storage.mbCoordinatorQueueView = {
        ...storage.mbCoordinatorQueueView,
        counts: {queued: 2},
        authoritativeCounts: {queued: 2},
        items: []
    }

    const before = JSON.stringify({
        queue: storage.mbCoordinatorQueue,
        queueWal: storage.mbCoordinatorQueueWal,
        queueView: storage.mbCoordinatorQueueView
    })
    const accounting = await browser.runtime.sendMessage({
        action: 'get-coordinator-queue-accounting',
        reason: 'synthetic-stale-view'
    })

    assert.equal(JSON.stringify({
        queue: storage.mbCoordinatorQueue,
        queueWal: storage.mbCoordinatorQueueWal,
        queueView: storage.mbCoordinatorQueueView
    }), before)
    assert.equal(accounting.consistent, false)
    assert.equal(JSON.stringify(accounting.rawDivergences), JSON.stringify(['raw-vs-recovered-counts']))
    assert.equal(JSON.stringify(accounting.mismatches), JSON.stringify([
        'stored-view-vs-recovered-counts',
        'stored-view-vs-recovered-authoritative-counts'
    ]))
    assert.equal(JSON.stringify(accounting.storedView.counts), JSON.stringify({queued: 2}))
    assert.equal(accounting.rebuiltView.counts.queued, 1)
    assert.equal(accounting.rebuiltView.counts.canceled, 1)
})

test('single current work cancel WAL append failure leaves selected row pending', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Cancel-Wal-Failure'
    const runId = 'run-single-cancel-wal-failure'
    const row = {
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: href,
        requestedUrl: href,
        dedupeKey: href,
        coordinatorKey: href,
        queuedAt: 500000,
        activeAt: 0,
        updatedAt: 500500,
        tabId: null,
        attemptId: 'attempt-cancel-wal-failure',
        attemptNumber: 1,
        milestones: {}
    }
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 501000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: row
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic current work item cancel WAL failure')
        }
        return originalSet(payload)
    }

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'cancel-coordinator-current-work-item',
        storageKey: href,
        coordinatorKey: href,
        profileHref: href
    }), timers)

    assert.equal(result.canceledUrls.length, 0)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorEvents.length, 0)
})

test('bulk current work cancel WAL append failure leaves rows pending', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Bulk-Cancel-Wal-Failure-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Bulk-Cancel-Wal-Failure-B'
    const runId = 'run-bulk-cancel-wal-failure'
    const makeRow = (href, attemptNumber = 1) => ({
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: href,
        requestedUrl: href,
        dedupeKey: href,
        coordinatorKey: href,
        queuedAt: 501000,
        activeAt: 0,
        updatedAt: 501500,
        tabId: null,
        attemptId: `attempt-bulk-cancel-wal-failure-${attemptNumber}`,
        attemptNumber,
        milestones: {}
    })
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 502000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: makeRow(hrefA, 1),
                [hrefB]: makeRow(hrefB, 2)
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [hrefA, hrefB],
                    targetWorkKeys: [hrefA, hrefB]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic bulk current work cancel WAL failure')
        }
        return originalSet(payload)
    }

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'cancel-coordinator-current-work'
    }), timers)

    assert.equal(result.canceledUrls.length, 0)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'queued')
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[hrefA].status, 'queued')
    assert.equal(currentAuthority.queue[hrefB].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorEvents.length, 0)
})

test('bulk current work cancel WAL append failure does not close active owned tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Bulk-Cancel-Active-Wal-Failure'
    const runId = 'run-bulk-cancel-active-wal-failure'
    const attemptId = 'attempt-bulk-cancel-active-wal-failure'
    const tabId = 701
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 502500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 502500})
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 502100
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic bulk current work cancel active WAL failure')
        }
        return originalSet(payload)
    }

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'cancel-coordinator-current-work'
    }), timers)

    assert.equal(result.canceledUrls.length, 0)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(result.ownedTabIds.length, 0)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorEvents.length, 0)
    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.equal(browser.__tabs.has(tabId), true)
})

test('bulk current work cancel storage fallback does not close active owned tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Bulk-Cancel-Active-Storage-Fallback'
    const runId = 'run-bulk-cancel-active-storage-fallback'
    const attemptId = 'attempt-bulk-cancel-active-storage-fallback'
    const tabId = 702
    let finishFirst = null
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 503000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 503000})
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 502700
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    })

    const first = sw.enqueueSpaceFeedStorageUpdate(
        () => new Promise(resolve => {
            finishFirst = () => resolve('first-late-ok')
        }),
        {timeoutMs: 1000, failureValue: 'first-timeout'}
    )
    await flushAsync(20)
    assert.equal(typeof finishFirst, 'function')
    await timers.tick(1000)
    assert.equal(await first, 'first-timeout')

    const resultPromise = browser.runtime.sendMessage({
        action: 'cancel-coordinator-current-work'
    })
    await flushAsync(20)
    await timers.tick(15000)
    const result = await resultPromise

    assert.equal(result.canceledUrls.length, 0)
    assert.equal(result.reason, 'cancel-persistence-failed')
    assert.equal(result.ownedTabIds.length, 0)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorEvents.length, 0)
    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.equal(browser.__tabs.has(tabId), true)

    finishFirst()
    await flushAsync(50)
})

test('bulk current work cancel derived failure does not poison WAL terminalization', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Bulk-Cancel-Derived-Failure-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Bulk-Cancel-Derived-Failure-B'
    const runId = 'run-bulk-cancel-derived-failure'
    const makeRow = (href, attemptNumber = 1) => ({
        runId,
        status: 'queued',
        actionKind: 'mute-block',
        targetProfileHref: href,
        requestedUrl: href,
        dedupeKey: href,
        coordinatorKey: href,
        queuedAt: 502000,
        activeAt: 0,
        updatedAt: 502500,
        tabId: null,
        attemptId: `attempt-bulk-cancel-derived-failure-${attemptNumber}`,
        attemptNumber,
        milestones: {}
    })
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 503000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: makeRow(hrefA, 1),
                [hrefB]: makeRow(hrefB, 2)
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [hrefA, hrefB],
                    targetWorkKeys: [hrefA, hrefB]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorRuns && payload?.mbCoordinatorEvents) {
            throw new Error('synthetic bulk current work cancel derived failure')
        }
        return originalSet(payload)
    }

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'cancel-coordinator-current-work'
    }), timers)

    assert.equal(result.canceledUrls.length, 2)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefA].status, 'canceled')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefB].status, 'canceled')
    assert.equal(storage.mbCoordinatorEvents.length, 1)
    assert.equal(storage.mbCoordinatorEvents[0].type, 'stored-work-cancel-derived-save-failed')
    assert.equal(sw.state().queueWakeupCounters['storedWork.cancel.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords.every(record => record.operationKind === 'stored-work-cancel'), true)
})

test('bulk current work pause WAL-requeues active rows as a batch', async () => {
    const hrefActive = 'https://www.quora.com/profile/Synthetic-Bulk-Pause-Active'
    const hrefQueued = 'https://www.quora.com/profile/Synthetic-Bulk-Pause-Queued'
    const runId = 'run-bulk-pause'
    const attemptId = 'attempt-bulk-pause-active'
    const tabId = 703
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 504000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefActive]: makeActiveCoordinatorRow({href: hrefActive, runId, attemptId, tabId, now: 504000}),
                [hrefQueued]: makeQueuedCoordinatorRow({href: hrefQueued, runId, attemptId: 'attempt-bulk-pause-queued', now: 504000})
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [hrefActive, hrefQueued],
                    targetWorkKeys: [hrefActive, hrefQueued]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [hrefActive]: {
                    profileHref: hrefActive,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 503700
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: hrefActive,
        active: false
    })

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'pause-coordinator-nukes'
    }), timers)

    assert.equal(result.paused, true)
    assert.equal(result.pausedUrls.length, 2)
    assert.equal(storage.mbCoordinatorPaused, true)
    assert.equal(storage.mbCoordinatorQueue[hrefActive].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[hrefQueued].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefActive].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefQueued].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueView.counts.queued, 2)
    assert.equal(storage.mbCoordinatorRuns[runId].status, 'paused')
    assert.equal(storage.mbCoordinatorEvents[0].type, 'paused')
    assert.equal(browser.__removedTabs.includes(tabId), true)
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'stored-work-pause')
    const recovered = recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue
    assert.equal(recovered[hrefActive].status, 'queued')
    assert.equal(recovered[hrefQueued].status, 'queued')
})

test('bulk current work pause WAL append failure does not close active owned tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Bulk-Pause-Wal-Failure'
    const runId = 'run-bulk-pause-wal-failure'
    const attemptId = 'attempt-bulk-pause-wal-failure'
    const tabId = 704
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 505000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 505000})
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 504700
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic bulk current work pause WAL failure')
        }
        return originalSet(payload)
    }

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'pause-coordinator-nukes'
    }), timers)

    assert.equal(result.paused, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(result.ownedTabIds.length, 0)
    assert.equal(storage.mbCoordinatorPaused, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorEvents.length, 0)
    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.equal(browser.__tabs.has(tabId), true)
})

test('manual failed retry WAL moves resolver rows without leaving stale source key', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Failed-Retry-Move'
    const questionUrl = 'https://www.quora.com/unanswered/Synthetic-failed-retry-move-question'
    const retryKey = `resolve-profile:${questionUrl}`
    const runId = 'run-failed-retry-move'
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 506000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeFailedCoordinatorRow({
                    href,
                    runId,
                    attemptId: 'attempt-failed-retry-move',
                    requestedUrl: href,
                    now: 506000,
                    error: 'Did not land on a profile page; question: /unanswered/Synthetic-failed-retry-move-question',
                    evidence: [{
                        collector: 'synthetic',
                        postUrl: questionUrl
                    }]
                })
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'failed',
                    outcome: 'timeout',
                    runId,
                    actionKind: 'mute-block',
                    attemptId: 'attempt-failed-retry-move',
                    attemptNumber: 1,
                    updatedAt: 505500
                }
            }
        }
    })

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'retry-coordinator-failed',
        retryLimit: 2,
        maxItems: 1
    }), timers)

    assert.equal(result.selected, 1)
    assert.equal(result.queued, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[retryKey], undefined)
    assert.equal(storage.mbCoordinatorQueueView.counts.queued, 1)
    assert.equal(storage.mbCoordinatorQueueView.counts.failed || 0, 0)
    assert.equal(storage.mbCoordinatorEvents.at(-1).type, 'retry')
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    const currentAuthority = (await sw.coordinatorAuthority.hydrate()).queue
    assert.equal(currentAuthority[href], undefined)
    assert.equal(currentAuthority[retryKey].status, 'queued')
    assert.equal(currentAuthority[retryKey].resolveProfileFromPage, true)
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.deepEqual(walRecords.map(record => record.kind), ['map.set', 'map.remove'])
    assert.equal(walRecords[0].operationKind, 'retry')
    assert.equal(walRecords[1].key, href)
    const recovered = recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue
    assert.equal(recovered[href], undefined)
    assert.equal(recovered[retryKey].status, 'queued')
})

test('manual failed requeue WAL append failure does not start executor or write derived state', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Failed-Requeue-Wal-Failure'
    const questionUrl = 'https://www.quora.com/unanswered/Synthetic-failed-requeue-wal-failure-question'
    const runId = 'run-failed-requeue-wal-failure'
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 507000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeFailedCoordinatorRow({
                    href,
                    runId,
                    attemptId: 'attempt-failed-requeue-wal-failure',
                    requestedUrl: href,
                    now: 507000,
                    evidence: [{
                        collector: 'synthetic',
                        postUrl: questionUrl
                    }]
                })
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic failed requeue WAL failure')
        }
        return originalSet(payload)
    }

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'requeue-coordinator-failed',
        maxItems: 1
    }), timers)

    assert.equal(result.selected, 0)
    assert.equal(result.queued, 0)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorEvents.length, 0)
    assert.equal(browser.__tabs.size, 0)
    assert.equal(sw.state().queuedTabActions.length, 0)
})

test('progress shadow WAL append uses bounded incremental replay', async () => {
    const runId = 'run-bounded-shadow-wal'
    const attemptId = 'attempt-bounded-shadow-wal'
    const tabId = 507
    const expectedRetentionLimit = 128
    const iterations = expectedRetentionLimit + 12
    const hrefs = Array.from(
        {length: iterations},
        (_, index) => `https://www.quora.com/profile/Synthetic-Bounded-Shadow-Wal-${index}`
    )
    const {storage, sw} = loadServiceWorkerHarness({
        now: 120000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: Object.fromEntries(hrefs.map((href, index) => [
                href,
                makeActiveCoordinatorRow({href, runId, attemptId: `${attemptId}-${index}`, tabId: tabId + index, now: 120000})
            ])),
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: hrefs,
                    targetWorkKeys: hrefs
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: Object.fromEntries(hrefs.map((href, index) => [
                href,
                {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId: tabId + index,
                    actionKind: 'mute-block',
                    attemptId: `${attemptId}-${index}`,
                    attemptNumber: 1,
                    updatedAt: 119500
                }
            ]))
        }
    })

    let last = null
    for(let index = 0; index < iterations; index += 1) {
        const href = hrefs[index]
        last = await sw.applyCoordinatorRowEvent({
            eventKind: 'queued-progress-milestone',
            profileHref: href,
            patch: {
                status: 'blocking',
                blockAttemptedAt: 120000 + index,
                runId,
                tabId: tabId + index,
                actionKind: 'mute-block',
                attemptId: `${attemptId}-${index}`,
                attemptNumber: 1
            }
        })
        assert.equal(last.recorded, true)
        assert.equal(last.progressShadowWal.checked, true)
        assert.equal(last.progressShadowWal.matched, true)
        assert.equal(last.progressShadowWal.append.records.length, 1)
        assert.equal(last.progressShadowWal.append.matched, 1)
        assert.equal(last.progressShadowWal.append.mismatched, 0)
    }

    const counters = sw.state().queueWakeupCounters
    const retainedRecords = getWalRecordsForGeneration(
        sw.state().progressShadowWalStore,
        sw.state().progressShadowWalStore.meta.activeCheckpoint
    )
    const recoveredShadow = recoverProjectedState(sw.state().progressShadowWalStore)

    assert.equal(counters['progress.shadowWal.appended'] || 0, iterations)
    assert.equal(counters['progress.shadowWal.appendProjectionMatched'] || 0, iterations)
    assert.equal(counters['progress.shadowWal.appendProjectionMismatched'] || 0, 0)
    assert.equal(counters['progress.shadowWal.checkpointSwitched'] || 0, 1)
    assert.ok(retainedRecords.length <= expectedRetentionLimit)
    assert.equal(recoveredShadow.recovered, true)
    assert.equal(recoveredShadow.projected.state.progress[hrefs.at(-1)].status, 'blocking')
    assert.equal(recoveredShadow.projected.state.progress[hrefs.at(-1)].blockAttemptedAt, 120000 + iterations - 1)
    assert.equal(sw.state().profileNukeProgress[hrefs.at(-1)].blockAttemptedAt, 120000 + iterations - 1)
    assert.equal(storage.mbProfileNukeProgress[hrefs.at(-1)].status, 'tab-opened')
})

test('progress shadow WAL diagnostic append failure does not change row-event acknowledgement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Progress-Shadow-Wal-Append-Failure'
    const runId = 'run-progress-shadow-wal-append-failure'
    const attemptId = 'attempt-progress-shadow-wal-append-failure'
    const tabId = 508
    const {storage, sw} = loadServiceWorkerHarness({
        now: 130000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 130000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 129500
                }
            }
        }
    })

    sw.__testSetProgressShadowWalStore({meta: null})

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'blocking',
            blockAttemptedAt: 130100,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })
    const counters = sw.state().queueWakeupCounters

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, false)
    assert.equal(result.progressProjectionDurable, true)
    assert.equal(result.progressShadowWal.checked, true)
    assert.equal(result.progressShadowWal.matched, true)
    assert.equal(result.progressShadowWal.append.appended, false)
    assert.equal(result.progressShadowWal.append.reason, 'diagnostic-error')
    assert.equal(getProgressShardRecord(storage, href).status, 'blocking')
    assert.equal(counters['progress.shadowWal.appendFailed'] || 0, 1)
})

test('progress shadow WAL parity uses exact persisted projection row after async save', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Progress-Shadow-Wal-Time-Parity'
    const runId = 'run-progress-shadow-wal-time-parity'
    const attemptId = 'attempt-progress-shadow-wal-time-parity'
    const tabId = 509
    const {browser, storage, sw, timers} = loadServiceWorkerHarness({
        now: 140000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 140000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 139500
                }
            }
        }
    })

    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        const result = await originalSet(payload)
        const keys = Object.keys(payload || {})
        if(keys.includes('mbProfileNukeProgressView') ||
            keys.some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
            timers.setNow(timers.now + 5000)
        }
        return result
    }

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'blocking',
            blockAttemptedAt: 140100,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })

    assert.equal(result.recorded, true)
    assert.equal(result.progressShadowWal.checked, true)
    assert.equal(result.progressShadowWal.matched, true)
    assert.equal(result.progressShadowWal.record.value.updatedAt, 140000)
    assert.equal(result.progressShadowWal.projectedRecord.updatedAt, 140000)
    assert.equal(getProgressShardRecord(storage, href).updatedAt, 140000)
})

test('progress shadow WAL appends same-status mutations with distinct ids', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Progress-Shadow-Wal-Same-Status'
    const runId = 'run-progress-shadow-wal-same-status'
    const attemptId = 'attempt-progress-shadow-wal-same-status'
    const tabId = 510
    const {sw} = loadServiceWorkerHarness({
        now: 150000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 150000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 149500
                }
            }
        }
    })

    const first = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'blocking',
            blockAttemptedAt: 150010,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })
    const second = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'blocking',
            foregroundWaitLastEventAt: 150020,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })

    assert.equal(first.recorded, true)
    assert.equal(second.recorded, true)
    assert.equal(first.progressShadowWal.append.matched, 1)
    assert.equal(second.progressShadowWal.append.matched, 1)
    assert.equal(second.progressShadowWal.append.mismatched, 0)
    assert.notEqual(
        first.progressShadowWal.append.records[0].id,
        second.progressShadowWal.append.records[0].id
    )
    assert.equal(sw.state().queueWakeupCounters['progress.shadowWal.appendProjectionMismatched'] || 0, 0)
})

test('row event does not report shadow WAL parity for suppressed progress projection storage', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Suppressed-Progress-Projection'
    const runId = 'run-suppressed-progress-projection'
    const attemptId = 'attempt-suppressed-progress-projection'
    const tabId = 506
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 120000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 120000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 119500
                }
            }
        }
    })

    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        const keys = Object.keys(payload || {})
        if(keys.includes('mbProfileNukeProgressView') ||
            keys.some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
            return false
        }
        return originalSet(payload)
    }

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'blocking',
            blockAttemptedAt: 120100,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })
    const counters = sw.state().queueWakeupCounters

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, false)
    assert.equal(result.progressProjectionDurable, false)
    assert.equal(result.progressProjectionSuppressed, true)
    assert.equal(result.progressOperation.operationKind, 'queued-progress-milestone')
    assert.equal(result.progressOperation.area, 'progress')
    assert.equal(result.progressOperation.rowKey, href)
    assert.equal(result.progressOperation.accepted, true)
    assert.equal(result.progressOperation.changed, true)
    assert.equal(result.progressOperation.durable, false)
    assert.equal(result.progressOperation.reason, 'projection-suppressed')
    assert.equal(result.progressOperation.previousRecord.status, 'tab-opened')
    assert.equal(result.progressOperation.nextRecord.status, 'blocking')
    assert.equal(result.progressShadowWal.checked, false)
    assert.equal(result.progressShadowWal.matched, false)
    assert.equal(result.progressShadowWal.reason, 'non-durable')
    assert.equal(result.progressShadowWal.skippedNonDurable, true)
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocking')
    assert.equal(storage.mbProfileNukeProgressView, undefined)
    assert.equal(getProgressShardRecord(storage, href), null)
    assert.equal(counters['progress.rowProjectionStorageSuppressed'] || 0, 1)
    assert.equal(counters['progress.rowProjectionStorageWrites'] || 0, 0)
    assert.equal(counters['progress.shadowWal.checked'] || 0, 0)
    assert.equal(counters['progress.shadowWal.matched'] || 0, 0)
    assert.equal(counters['progress.shadowWal.skippedNonDurable'] || 0, 1)
    assert.equal(counters['rowEvent.queued-progress-milestone.shadowWal.checked'] || 0, 0)
    assert.equal(counters['rowEvent.queued-progress-milestone.shadowWal.skippedNonDurable'] || 0, 1)
    assert.equal(counters['rowEvent.queued-progress-milestone.projectionSaved'] || 0, 0)
    assert.equal(counters['rowEvent.queued-progress-milestone.projectionSuppressed'] || 0, 1)
})

test('row event treats throwing progress projection storage as non-durable projection', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Throwing-Progress-Projection'
    const runId = 'run-throwing-progress-projection'
    const attemptId = 'attempt-throwing-progress-projection'
    const tabId = 511
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 121000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 121000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 120500
                }
            }
        }
    })

    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        const keys = Object.keys(payload || {})
        if(keys.includes('mbProfileNukeProgressView') ||
            keys.some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
            throw new Error('synthetic progress projection storage failure')
        }
        return originalSet(payload)
    }

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'blocking',
            blockAttemptedAt: 121100,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })
    const counters = sw.state().queueWakeupCounters

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, false)
    assert.equal(result.progressProjectionDurable, false)
    assert.equal(result.progressProjectionSuppressed, true)
    assert.equal(result.progressOperation.durable, false)
    assert.equal(result.progressOperation.reason, 'projection-suppressed')
    assert.equal(result.progressShadowWal.checked, false)
    assert.equal(result.progressShadowWal.reason, 'non-durable')
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocking')
    assert.equal(storage.mbProfileNukeProgressView, undefined)
    assert.equal(getProgressShardRecord(storage, href), null)
    assert.equal(counters['progress.rowProjectionStorageFailed'] || 0, 1)
    assert.equal(counters['progress.rowProjectionStorageSuppressed'] || 0, 1)
    assert.equal(counters['progress.shadowWal.checked'] || 0, 0)
    assert.equal(counters['progress.shadowWal.skippedNonDurable'] || 0, 1)
    assert.equal(counters['rowEvent.queued-progress-milestone.projectionSuppressed'] || 0, 1)
})

test('row event persists queue only for nonterminal durable status changes', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Row-Event-Status-Change'
    const runId = 'run-row-event-status-change'
    const attemptId = 'attempt-row-event-status-change'
    const tabId = 502
    const {storage, sw} = loadServiceWorkerHarness({
        now: 150000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 150000}),
                    status: 'queued',
                    activeAt: 0,
                    tabId: null
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    runId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 149500
                }
            }
        }
    })

    await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: '',
        patch: {}
    })

    const before = sw.state().queueWakeupCounters
    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'page-ready',
            actionReadyAt: 150010,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })
    const after = sw.state().queueWakeupCounters

    assert.equal(result.recorded, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[href].tabId, null)
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, tabId)
    assert.equal(
        (after['storagePayload.write.queue.bytes'] || 0) -
            (before['storagePayload.write.queue.bytes'] || 0),
        0
    )
    assert.ok(
        (after['storagePayload.write.queueWal.bytes'] || 0) -
            (before['storagePayload.write.queueWal.bytes'] || 0) > 0
    )
    assert.equal(
        (after['storagePayload.read.progress.bytes'] || 0) -
            (before['storagePayload.read.progress.bytes'] || 0),
        0
    )
    assert.equal(
        (after['storagePayload.read.queue.calls'] || 0) -
            (before['storagePayload.read.queue.calls'] || 0),
        1
    )
    assert.equal(
        (after['storagePayload.read.runs.calls'] || 0) -
            (before['storagePayload.read.runs.calls'] || 0),
        1
    )
    assert.equal(after['rowEvent.queued-progress-milestone.queueChanged'] || 0, 1)
    assert.equal(after['rowEvent.queued-progress-milestone.queueSnapshotSkipped'] || 0, 0)
    assert.equal(after['coordinatorAuthority.queueWal.appended'] || 0, 1)
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'row-event-progress-milestone')
    assert.equal(walRecords[0].value.status, 'active')

    const restarted = loadServiceWorkerHarness({
        now: 150100,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(restarted.storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(hydrated.queue[href].status, 'active')
    assert.equal(hydrated.queue[href].tabId, tabId)
})

test('batched row event queue WAL mutations compose against updated projection', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Row-Event-Batch-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Row-Event-Batch-B'
    const runA = 'run-row-event-batch-a'
    const runB = 'run-row-event-batch-b'
    const attemptA = 'attempt-row-event-batch-a'
    const attemptB = 'attempt-row-event-batch-b'
    const tabA = 531
    const tabB = 532
    const {storage, sw} = loadServiceWorkerHarness({
        now: 150500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: {
                    ...makeActiveCoordinatorRow({href: hrefA, runId: runA, attemptId: attemptA, tabId: null, now: 150500}),
                    status: 'queued',
                    activeAt: 0,
                    tabId: null
                },
                [hrefB]: {
                    ...makeActiveCoordinatorRow({href: hrefB, runId: runB, attemptId: attemptB, tabId: null, now: 150500}),
                    status: 'queued',
                    activeAt: 0,
                    tabId: null
                }
            },
            mbCoordinatorRuns: {
                [runA]: makeCoordinatorRun({href: hrefA, runId: runA}),
                [runB]: makeCoordinatorRun({href: hrefB, runId: runB})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [hrefA]: {
                    profileHref: hrefA,
                    status: 'queued',
                    runId: runA,
                    actionKind: 'mute-block',
                    attemptId: attemptA,
                    attemptNumber: 1,
                    updatedAt: 150000
                },
                [hrefB]: {
                    profileHref: hrefB,
                    status: 'queued',
                    runId: runB,
                    actionKind: 'mute-block',
                    attemptId: attemptB,
                    attemptNumber: 1,
                    updatedAt: 150000
                }
            }
        }
    })

    const result = await sw.applyCoordinatorRowEvents([
        {
            eventKind: 'queued-progress-milestone',
            profileHref: hrefA,
            patch: {
                status: 'page-ready',
                actionReadyAt: 150510,
                runId: runA,
                tabId: tabA,
                actionKind: 'mute-block',
                attemptId: attemptA,
                attemptNumber: 1
            }
        },
        {
            eventKind: 'queued-progress-milestone',
            profileHref: hrefB,
            patch: {
                status: 'page-ready',
                actionReadyAt: 150520,
                runId: runB,
                tabId: tabB,
                actionKind: 'mute-block',
                attemptId: attemptB,
                attemptNumber: 1
            }
        }
    ])

    assert.equal(result.recorded, true)
    assert.equal(result.results[hrefA].recorded, true)
    assert.equal(result.results[hrefB].recorded, true)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 2)
    assert.equal(sw.coordinatorAuthority.current().queue[hrefA].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefA].tabId, tabA)
    assert.equal(sw.coordinatorAuthority.current().queue[hrefB].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefB].tabId, tabB)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.appended'] || 0, 2)

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords[0].operationKind, 'row-event-progress-milestone')
    assert.equal(walRecords[1].operationKind, 'row-event-progress-milestone')
    assert.equal(walRecords[0].seq, 1)
    assert.equal(walRecords[1].seq, 2)

    const restarted = loadServiceWorkerHarness({
        now: 150600,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[hrefA].status, 'active')
    assert.equal(hydrated.queue[hrefA].tabId, tabA)
    assert.equal(hydrated.queue[hrefB].status, 'active')
    assert.equal(hydrated.queue[hrefB].tabId, tabB)
})

test('row event queue WAL append failure rejects durable queue mutation', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Row-Event-Wal-Append-Failure'
    const runId = 'run-row-event-wal-append-failure'
    const attemptId = 'attempt-row-event-wal-append-failure'
    const tabId = 526
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 151000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 151000}),
                    status: 'queued',
                    activeAt: 0,
                    tabId: null
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    runId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 150500
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic row-event WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'page-ready',
            actionReadyAt: 151010,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })

    assert.equal(result.recorded, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
})

test('row event queue WAL projection failure does not poison durable acknowledgement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Row-Event-Wal-Projection-Failure'
    const runId = 'run-row-event-wal-projection-failure'
    const attemptId = 'attempt-row-event-wal-projection-failure'
    const tabId = 527
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 152000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 152000}),
                    status: 'queued',
                    activeAt: 0,
                    tabId: null
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    runId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 151500
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueView) {
            return false
        }
        return originalSet(payload)
    }

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'page-ready',
            actionReadyAt: 152010,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('row event derived runs failure does not poison durable queue WAL acknowledgement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Row-Event-Runs-Failure'
    const runId = 'run-row-event-runs-failure'
    const attemptId = 'attempt-row-event-runs-failure'
    const tabId = 528
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 153000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 153000}),
                    status: 'queued',
                    activeAt: 0,
                    tabId: null
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    runId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 152500
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorRuns) {
            throw new Error('synthetic row-event runs failure')
        }
        return originalSet(payload)
    }

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'page-ready',
            actionReadyAt: 153010,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, false)
    assert.equal(result.progressProjectionDurable, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.state().queueWakeupCounters['rowEvent.queued-progress-milestone.derivedRunsSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('row event rejects stale attempt before durable progress mutation', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Stale-Row-Event'
    const runId = 'run-stale-row-event'
    const attemptId = 'attempt-current'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 200000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, now: 200000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'page-ready',
                    runId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 199500
                }
            }
        }
    })

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'blocking',
            blockAttemptedAt: 200010,
            runId,
            actionKind: 'mute-block',
            attemptId: 'attempt-stale',
            attemptNumber: 1
        }
    })

    assert.equal(result.recorded, false)
    assert.equal(result.reason, 'stale-attempt')
    assert.equal(storage.mbProfileNukeProgress[href].status, 'page-ready')
    assert.equal(storage.mbProfileNukeProgress[href].attemptId, attemptId)
    assert.equal(sw.state().queueWakeupCounters['rowEvent.queued-progress-milestone.rejected.staleAttempt'] || 0, 1)
})

test('terminal job progress applies queue mutation through authority without duplicate queue read', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Authority'
    const runId = 'run-terminal-authority'
    const attemptId = 'attempt-terminal-authority'
    const tabId = 503
    const {storage, sw} = loadServiceWorkerHarness({
        now: 250000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 250000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 249500
                }
            }
        }
    })

    const before = sw.state().queueWakeupCounters
    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 250100,
        terminalAt: 250100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })
    const after = sw.state().queueWakeupCounters

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbCoordinatorQueueView.counts.succeeded, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'blocked')
    await waitFor(
        () => storage.mbProfileNukeProgress[href]?.status === 'blocked',
        'terminal progress compatibility save did not update the progress snapshot',
        {attempts: 20}
    )
    assert.equal(storage.mbProfileNukeProgress[href].status, 'blocked')
    assert.equal(
        (after['storagePayload.read.queue.calls'] || 0) -
            (before['storagePayload.read.queue.calls'] || 0),
        1
    )
    assert.equal(
        (after['storagePayload.read.runs.calls'] || 0) -
            (before['storagePayload.read.runs.calls'] || 0),
        1
    )
    assert.ok(
        (after['storagePayload.read.progress.calls'] || 0) -
            (before['storagePayload.read.progress.calls'] || 0) >= 1
    )
    assert.equal(
        (after['storagePayload.write.queue.bytes'] || 0) -
            (before['storagePayload.write.queue.bytes'] || 0),
        0
    )
    assert.ok(
        (after['storagePayload.write.queueWal.bytes'] || 0) -
            (before['storagePayload.write.queueWal.bytes'] || 0) > 0
    )
    assert.ok(
        (after['storagePayload.write.path.terminalProgress.save.queueWal.bytes'] || 0) -
            (before['storagePayload.write.path.terminalProgress.save.queueWal.bytes'] || 0) > 0
    )
    assert.equal(after['coordinatorAuthority.queueWal.appended'] || 0, 1)
    assert.equal(after['coordinatorAuthority.postMutationQueueStorageSetRejected'] || 0, 0)
})

test('terminal authority queue WAL recovers after restart without full queue snapshot', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Restart'
    const runId = 'run-terminal-wal-restart'
    const attemptId = 'attempt-terminal-wal-restart'
    const tabId = 513
    const firstHarness = loadServiceWorkerHarness({
        now: 251000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 251000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 250500
                }
            }
        }
    })

    const result = await firstHarness.sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 251100,
        terminalAt: 251100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, true)
    assert.equal(firstHarness.storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(firstHarness.sw.coordinatorAuthority.current().queue[href].status, 'succeeded')

    const restarted = loadServiceWorkerHarness({
        now: 252000,
        storage: firstHarness.storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()

    assert.equal(restarted.storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(hydrated.queue[href].status, 'succeeded')
    assert.equal(hydrated.queue[href].outcome, 'blocked')
    assert.equal(restarted.sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(restarted.sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.recovered'] || 0, 1)
})

test('deferred row event uses WAL terminal queue over stale snapshot after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Late-Breadcrumb'
    const runId = 'run-terminal-wal-late-breadcrumb'
    const attemptId = 'attempt-terminal-wal-late-breadcrumb'
    const tabId = 525
    const firstHarness = loadServiceWorkerHarness({
        now: 252200,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 252200})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 252100
                }
            }
        }
    })

    const terminal = await firstHarness.sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 252300,
        terminalAt: 252300,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })
    assert.equal(terminal.recorded, true)
    assert.equal(firstHarness.storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(firstHarness.sw.coordinatorAuthority.current().queue[href].status, 'succeeded')

    firstHarness.storage.mbProfileNukeProgress[href] = {
        profileHref: href,
        status: 'blocking',
        runId,
        tabId,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1,
        updatedAt: 252100
    }
    const restarted = loadServiceWorkerHarness({
        now: 252400,
        storage: firstHarness.storage
    })

    const late = await restarted.sw.recordDeferredCoordinatorJobMilestone(href, {
        status: 'blocking',
        blockAttemptedAt: 252410,
        runId,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1
    })

    assert.equal(late.recorded, false)
    assert.equal(late.reason, 'terminal-row-preserved')
    assert.equal(restarted.storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(recoverProjectedState(restarted.storage.mbCoordinatorQueueWal).projected.state.queue[href].status, 'succeeded')
    assert.equal(restarted.storage.mbProfileNukeProgress[href].status, 'blocking')
    assert.equal(restarted.sw.state().profileNukeProgress[href].status, 'blocking')
    assert.equal(restarted.sw.state().queueWakeupCounters['rowEvent.queued-progress-milestone.rejected.terminalRowPreserved'] || 0, 1)
})

test('terminal authority queue WAL switches checkpoint generation and continues sequence', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Checkpoint-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Checkpoint-B'
    const hrefC = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Checkpoint-C'
    const runId = 'run-terminal-wal-checkpoint'
    const attemptA = 'attempt-terminal-wal-checkpoint-a'
    const attemptB = 'attempt-terminal-wal-checkpoint-b'
    const attemptC = 'attempt-terminal-wal-checkpoint-c'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 252500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: makeActiveCoordinatorRow({href: hrefA, runId, attemptId: attemptA, tabId: 520, now: 252500}),
                [hrefB]: makeActiveCoordinatorRow({href: hrefB, runId, attemptId: attemptB, tabId: 521, now: 252500}),
                [hrefC]: makeActiveCoordinatorRow({href: hrefC, runId, attemptId: attemptC, tabId: 522, now: 252500})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href: hrefA, runId, targetProfileHrefs: [hrefA, hrefB, hrefC]})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await sw.recordCoordinatorJobProgress(hrefA, {
        status: 'blocked',
        blockSucceeded: true,
        terminalAt: 252600,
        actionKind: 'mute-block',
        runId,
        tabId: 520,
        attemptId: attemptA,
        attemptNumber: 1
    }, {expectTerminal: true, senderTabId: 520})
    await sw.recordCoordinatorJobProgress(hrefB, {
        status: 'blocked',
        blockSucceeded: true,
        terminalAt: 252700,
        actionKind: 'mute-block',
        runId,
        tabId: 521,
        attemptId: attemptB,
        attemptNumber: 1
    }, {expectTerminal: true, senderTabId: 521})

    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'active')
    let walRecords = await waitFor(
        () => {
            const records = getWalRecordsForGeneration(
                storage.mbCoordinatorQueueWal,
                storage.mbCoordinatorQueueWal.meta.activeCheckpoint
            )
            return records.length >= 4 ? records : null
        },
        'terminal progress and settlement WAL records were not all appended',
        {attempts: 40}
    )
    assert.equal(walRecords.length, 4)
    assert.equal(walRecords[0].operationKind, 'terminal-progress')
    assert.equal(walRecords[1].operationKind, 'terminal-settlement')
    assert.equal(walRecords[2].operationKind, 'terminal-progress')
    assert.equal(walRecords[3].operationKind, 'terminal-settlement')
    assert.equal(storage.mbCoordinatorQueueWal.meta.nextSeq, 5)

    const checkpointSwitch = await sw.switchCoordinatorAuthorityQueueWalCheckpoint()

    assert.equal(checkpointSwitch.checkpointSwitched, true)
    assert.equal(checkpointSwitch.durable, true)
    assert.equal(checkpointSwitch.snapshotSeq, 4)
    assert.equal(checkpointSwitch.checkpointedRecords, 4)
    assert.equal(checkpointSwitch.tailLength, 0)
    assert.equal(checkpointSwitch.mirrorSaved, true)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'succeeded')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'succeeded')
    assert.equal(storage.mbCoordinatorQueue[hrefC].status, 'active')
    const recoveredAfterCheckpoint = recoverProjectedState(storage.mbCoordinatorQueueWal)
    assert.equal(recoveredAfterCheckpoint.checkpoint.snapshotSeq, 4)
    assert.equal(recoveredAfterCheckpoint.projected.state.queue[hrefA].status, 'succeeded')
    assert.equal(recoveredAfterCheckpoint.projected.state.queue[hrefC].status, 'active')
    walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 0)

    const restarted = loadServiceWorkerHarness({
        now: 252800,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[hrefA].status, 'succeeded')
    assert.equal(hydrated.queue[hrefB].status, 'succeeded')
    assert.equal(hydrated.queue[hrefC].status, 'active')

    const third = await restarted.sw.recordCoordinatorJobProgress(hrefC, {
        status: 'blocked',
        blockSucceeded: true,
        terminalAt: 252900,
        actionKind: 'mute-block',
        runId,
        tabId: 522,
        attemptId: attemptC,
        attemptNumber: 1
    }, {expectTerminal: true, senderTabId: 522})

    assert.equal(third.recorded, true)
    assert.equal(third.terminal, true)
    const postAppendRecords = await waitFor(
        () => {
            const records = getWalRecordsForGeneration(
                restarted.storage.mbCoordinatorQueueWal,
                restarted.storage.mbCoordinatorQueueWal.meta.activeCheckpoint
            )
            return records.length >= 2 ? records : null
        },
        'post-checkpoint terminal progress and settlement records were not both appended',
        {attempts: 40}
    )
    assert.equal(postAppendRecords.length, 2)
    assert.equal(postAppendRecords[0].operationKind, 'terminal-progress')
    assert.equal(postAppendRecords[1].operationKind, 'terminal-settlement')
    assert.equal(postAppendRecords[0].seq, 5)
    assert.equal(postAppendRecords[1].seq, 6)
    assert.equal(restarted.storage.mbCoordinatorQueueWal.meta.nextSeq, 7)
})

test('terminal authority queue WAL checkpoint survives compatibility mirror failure', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Mirror-Failure'
    const runId = 'run-terminal-wal-mirror-failure'
    const attemptId = 'attempt-terminal-wal-mirror-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 252900,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: 523, now: 252900})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const terminal = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        terminalAt: 253000,
        actionKind: 'mute-block',
        runId,
        tabId: 523,
        attemptId,
        attemptNumber: 1
    }, {expectTerminal: true, senderTabId: 523})
    assert.equal(terminal.recorded, true)

    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueue) {
            throw new Error('synthetic compatibility mirror failure')
        }
        return originalSet(payload)
    }

    const checkpointSwitch = await sw.switchCoordinatorAuthorityQueueWalCheckpoint()

    assert.equal(checkpointSwitch.checkpointSwitched, true)
    assert.equal(checkpointSwitch.durable, true)
    assert.equal(checkpointSwitch.mirrorSaved, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue[href].status, 'succeeded')
    const restarted = loadServiceWorkerHarness({
        now: 253100,
        storage
    })
    assert.equal((await restarted.sw.coordinatorAuthority.hydrate()).queue[href].status, 'succeeded')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.compatMirrorFailed'] || 0, 1)
})

test('terminal authority queue WAL checkpoint failure leaves old WAL authoritative', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Checkpoint-Failure'
    const runId = 'run-terminal-wal-checkpoint-failure'
    const attemptId = 'attempt-terminal-wal-checkpoint-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 253200,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: 524, now: 253200})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        terminalAt: 253300,
        actionKind: 'mute-block',
        runId,
        tabId: 524,
        attemptId,
        attemptNumber: 1
    }, {expectTerminal: true, senderTabId: 524})
    const previousWal = JSON.stringify(storage.mbCoordinatorQueueWal)
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal && !payload?.mbCoordinatorQueue) {
            throw new Error('synthetic WAL checkpoint failure')
        }
        return originalSet(payload)
    }

    const checkpointSwitch = await sw.switchCoordinatorAuthorityQueueWalCheckpoint()

    assert.equal(checkpointSwitch.checkpointSwitched, false)
    assert.equal(checkpointSwitch.durable, false)
    assert.equal(checkpointSwitch.reason, 'wal-checkpoint-save-failed')
    assert.equal(JSON.stringify(storage.mbCoordinatorQueueWal), previousWal)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue[href].status, 'succeeded')
    const restarted = loadServiceWorkerHarness({
        now: 253400,
        storage
    })
    assert.equal((await restarted.sw.coordinatorAuthority.hydrate()).queue[href].status, 'succeeded')
})

test('terminal authority queue WAL append failure rejects durable queue mutation', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Append-Failure'
    const runId = 'run-terminal-wal-append-failure'
    const attemptId = 'attempt-terminal-wal-append-failure'
    const tabId = 516
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 253000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 253000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 252500
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic queue WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 253100,
        terminalAt: 253100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(result.recorded, false)
    assert.equal(result.terminal, false)
    assert.equal(result.results?.[href]?.reason || result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
})

test('direct nonterminal job progress is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Nonterminal-Progress-Wal'
    const runId = 'run-nonterminal-progress-wal'
    const attemptId = 'attempt-nonterminal-progress-wal'
    const tabId = 527
    const {storage, sw} = loadServiceWorkerHarness({
        now: 253500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 253500})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocking',
        blockAttemptedAt: 253600,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {senderTabId: tabId})

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.notEqual(storage.mbCoordinatorQueue[href].milestones.blockAttemptedAt, 253600)
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].milestones.blockAttemptedAt, 253600)
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocking')
    await waitFor(
        () => storage.mbProfileNukeProgress[href]?.status === 'blocking',
        'direct progress compatibility save did not materialize progress',
        {attempts: 20}
    )
    assert.equal(storage.mbProfileNukeProgress[href].status, 'blocking')

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'direct-progress')

    const restarted = loadServiceWorkerHarness({
        now: 253700,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'active')
    assert.equal(hydrated.queue[href].milestones.blockAttemptedAt, 253600)
})

test('direct nonterminal job progress WAL append failure rejects durable queue mutation', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Nonterminal-Progress-Wal-Failure'
    const runId = 'run-nonterminal-progress-wal-failure'
    const attemptId = 'attempt-nonterminal-progress-wal-failure'
    const tabId = 528
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 253800,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 253800})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic nonterminal progress WAL failure')
        }
        return originalSet(payload)
    }

    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocking',
        blockAttemptedAt: 253900,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {senderTabId: tabId})

    assert.equal(result.recorded, false)
    assert.equal(result.terminal, false)
    assert.equal(result.results?.[href]?.reason || result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
})

test('direct nonterminal job progress derived save failure does not poison WAL acknowledgement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Nonterminal-Progress-Derived-Failure'
    const runId = 'run-nonterminal-progress-derived-failure'
    const attemptId = 'attempt-nonterminal-progress-derived-failure'
    const tabId = 529
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 253950,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 253950})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbProfileNukeProgress && !payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic direct progress derived save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocking',
        blockAttemptedAt: 253960,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {senderTabId: tabId})

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.notEqual(storage.mbCoordinatorQueue[href].milestones.blockAttemptedAt, 253960)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].milestones.blockAttemptedAt, 253960)
    assert.equal(sw.coordinatorAuthority.current().queue[href].milestones.blockAttemptedAt, 253960)
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocking')
    await waitFor(
        () => (sw.state().queueWakeupCounters['directProgress.compatibilitySaveFailed'] || 0) === 1,
        'direct progress compatibility save failure was not recorded',
        {attempts: 20}
    )
    assert.equal(sw.state().queueWakeupCounters['directProgress.compatibilitySaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
    browser.storage.local.set = originalSet
})

test('terminal authority queue WAL projection failure does not poison durable acknowledgement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Projection-Failure'
    const runId = 'run-terminal-wal-projection-failure'
    const attemptId = 'attempt-terminal-wal-projection-failure'
    const tabId = 517
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 254000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 254000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 253500
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueView) {
            return false
        }
        return originalSet(payload)
    }

    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 254100,
        terminalAt: 254100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('terminal settlement applies terminal row residue through authority in a batch', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Terminal-Settlement-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Terminal-Settlement-B'
    const runId = 'run-terminal-settlement-batch'
    const attemptA = 'attempt-terminal-settlement-a'
    const attemptB = 'attempt-terminal-settlement-b'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 254500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: {
                    ...makeActiveCoordinatorRow({href: hrefA, runId, attemptId: attemptA, tabId: null, now: 254500}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt: 254510,
                    updatedAt: 254510
                },
                [hrefB]: {
                    ...makeActiveCoordinatorRow({href: hrefB, runId, attemptId: attemptB, tabId: null, now: 254500}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt: 254520,
                    updatedAt: 254520
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href: hrefA, runId, targetProfileHrefs: [hrefA, hrefB]})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {},
            mbSpacePendingNukedPosts: {
                'post-terminal-settlement': {
                    postKey: 'post-terminal-settlement',
                    postUrl: 'https://www.quora.com/q/example/post-terminal-settlement',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [hrefA, hrefB],
                    remainingUrls: [hrefA, hrefB],
                    updatedAt: 254000
                }
            },
            mbSpaceNukedPosts: {}
        }
    })

    const result = await sw.settleTerminalCoordinatorItems({profileHrefs: [hrefA, hrefB]})

    assert.equal(result.settled, 2)
    assert.equal(result.confirmed, 2)
    assert.equal(result.cleared, 0)
    assert.equal(storage.mbCoordinatorQueue[hrefA].sourceSettlementOutcome, undefined)
    assert.equal(storage.mbCoordinatorQueue[hrefB].sourceSettlementOutcome, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[hrefA].sourceSettlementOutcome, 'confirmed')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefB].sourceSettlementOutcome, 'confirmed')
    assert.equal(storage.mbCoordinatorQueueView.counts.succeeded, 2)
    assert.equal(storage.mbSpacePendingNukedPosts['post-terminal-settlement'], undefined)
    assert.equal(sw.state().queueWakeupCounters['storagePayload.write.path.terminalSettlement.save.queueWal.bytes'] > 0, true)
    assert.equal((sw.state().queueWakeupCounters['storagePayload.write.queue.bytes'] || 0), 0)

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords[0].operationKind, 'terminal-settlement')
    assert.equal(walRecords[1].operationKind, 'terminal-settlement')
    assert.equal(walRecords[0].seq, 1)
    assert.equal(walRecords[1].seq, 2)

    const restarted = loadServiceWorkerHarness({
        now: 254550,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[hrefA].sourceSettlementOutcome, 'confirmed')
    assert.equal(hydrated.queue[hrefB].sourceSettlementOutcome, 'confirmed')
})

test('terminal settlement clears source posts for WAL-terminal rows over stale snapshot', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Settlement-Wal-Handoff'
    const runId = 'run-terminal-settlement-wal-handoff'
    const attemptId = 'attempt-terminal-settlement-wal-handoff'
    const tabId = 533
    const {storage, sw} = loadServiceWorkerHarness({
        now: 254600,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 254600})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 254500
                }
            },
            mbSpacePendingNukedPosts: {
                'post-terminal-settlement-wal-handoff': {
                    postKey: 'post-terminal-settlement-wal-handoff',
                    postUrl: 'https://www.quora.com/q/example/post-terminal-settlement-wal-handoff',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [href],
                    remainingUrls: [href],
                    updatedAt: 254500
                }
            },
            mbSpaceNukedPosts: {}
        }
    })

    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 254610,
        terminalAt: 254610,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    await waitFor(
        () => storage.mbSpacePendingNukedPosts['post-terminal-settlement-wal-handoff'] === undefined,
        'WAL terminal settlement did not clear source post pending record',
        {attempts: 40}
    )
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[href].sourceSettlementOutcome, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[href].sourceSettlementOutcome, 'confirmed')
    assert.equal(sw.state().queueWakeupCounters['terminalSettlement.queueResidueDeferred'] || 0, 0)
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords[0].operationKind, 'terminal-progress')
    assert.equal(walRecords[1].operationKind, 'terminal-settlement')

    const restarted = loadServiceWorkerHarness({
        now: 254650,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'succeeded')
    assert.equal(hydrated.queue[href].sourceSettlementOutcome, 'confirmed')
})

test('terminal settlement WAL append failure leaves source post pending', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Settlement-Wal-Append-Failure'
    const runId = 'run-terminal-settlement-wal-append-failure'
    const attemptId = 'attempt-terminal-settlement-wal-append-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 254660,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 254660}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt: 254670,
                    updatedAt: 254670
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {},
            mbSpacePendingNukedPosts: {
                'post-terminal-settlement-wal-append-failure': {
                    postKey: 'post-terminal-settlement-wal-append-failure',
                    postUrl: 'https://www.quora.com/q/example/post-terminal-settlement-wal-append-failure',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [href],
                    remainingUrls: [href],
                    updatedAt: 254600
                }
            },
            mbSpaceNukedPosts: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic terminal settlement WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.settleTerminalCoordinatorItems({profileHrefs: [href]})

    assert.equal(result.settled, 0)
    assert.equal(result.confirmed, 0)
    assert.ok(storage.mbSpacePendingNukedPosts['post-terminal-settlement-wal-append-failure'])
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].sourceSettlementOutcome, undefined)
    assert.equal(sw.state().queueWakeupCounters['terminalSettlement.authorityApplyFailed'] || 0, 1)
})

test('terminal settlement projection failure does not poison WAL settlement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Settlement-Projection-Failure'
    const runId = 'run-terminal-settlement-projection-failure'
    const attemptId = 'attempt-terminal-settlement-projection-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 254680,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 254680}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt: 254690,
                    updatedAt: 254690
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {},
            mbSpacePendingNukedPosts: {
                'post-terminal-settlement-projection-failure': {
                    postKey: 'post-terminal-settlement-projection-failure',
                    postUrl: 'https://www.quora.com/q/example/post-terminal-settlement-projection-failure',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [href],
                    remainingUrls: [href],
                    updatedAt: 254600
                }
            },
            mbSpaceNukedPosts: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueView) {
            return false
        }
        return originalSet(payload)
    }

    const result = await sw.settleTerminalCoordinatorItems({profileHrefs: [href]})

    assert.equal(result.settled, 1)
    assert.equal(result.confirmed, 1)
    assert.equal(storage.mbSpacePendingNukedPosts['post-terminal-settlement-projection-failure'], undefined)
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(sw.coordinatorAuthority.current().queue[href].sourceSettlementOutcome, 'confirmed')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('terminal settlement derived save failure does not poison authority settlement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Settlement-Derived-Failure'
    const runId = 'run-terminal-settlement-derived-failure'
    const attemptId = 'attempt-terminal-settlement-derived-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 254700,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 254700}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt: 254710,
                    updatedAt: 254710
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {},
            mbSpacePendingNukedPosts: {
                'post-terminal-settlement-derived-failure': {
                    postKey: 'post-terminal-settlement-derived-failure',
                    postUrl: 'https://www.quora.com/q/example/post-terminal-settlement-derived-failure',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [href],
                    remainingUrls: [href],
                    updatedAt: 254000
                }
            },
            mbSpaceNukedPosts: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbSpacePendingNukedPosts) {
            throw new Error('synthetic terminal settlement derived save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.settleTerminalCoordinatorItems({profileHrefs: [href]})

    assert.equal(result.settled, 1)
    assert.equal(result.confirmed, 1)
    assert.equal(storage.mbCoordinatorQueue[href].sourceSettlementOutcome, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].sourceSettlementOutcome, 'confirmed')
    assert.ok(storage.mbSpacePendingNukedPosts['post-terminal-settlement-derived-failure'])
    assert.equal(sw.state().queueWakeupCounters['terminalSettlement.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('action lease request is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Request'
    const runId = 'run-lease-request'
    const attemptId = 'attempt-lease-request'
    const tabId = 619
    const now = 259000
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.requestCoordinatorActionLease({
        profileHref: href,
        attemptId,
        attemptNumber: 1,
        actionKind: 'mute-block',
        reason: 'test-request'
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.granted, true)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease, undefined)
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.reason, 'test-request')

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'action-lease-request')

    const restarted = loadServiceWorkerHarness({
        now: now + 1000,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].actionLease.reason, 'test-request')
    assert.equal(hydrated.queue[href].actionLease.tabId, tabId)
})

test('action lease request WAL append failure rejects durable mutation', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Request-Append-Failure'
    const runId = 'run-lease-request-append-failure'
    const attemptId = 'attempt-lease-request-append-failure'
    const tabId = 6191
    const now = 259500
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic action lease request WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.requestCoordinatorActionLease({
        profileHref: href,
        attemptId,
        attemptNumber: 1,
        actionKind: 'mute-block',
        reason: 'append-failure-request'
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.granted, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease, undefined)
})

test('action lease request rejects missing incoming attempt identity before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Request-Missing-Incoming'
    const runId = 'run-lease-request-missing-incoming'
    const attemptId = 'attempt-lease-request-missing-incoming'
    const tabId = 6192
    const now = 259750
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.requestCoordinatorActionLease({
        profileHref: href,
        actionKind: 'mute-block',
        reason: 'missing-incoming-request'
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.granted, false)
    assert.equal(result.staleAttempt, true)
    assert.equal(result.reason, 'missing-attempt-identity')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease, undefined)
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].actionLease, undefined)
})

test('action lease request rejects wrong active tab before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Request-Wrong-Tab'
    const runId = 'run-lease-request-wrong-tab'
    const attemptId = 'attempt-lease-request-wrong-tab'
    const activeTabId = 700
    const senderTabId = 701
    const now = 259800
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: activeTabId, now})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.requestCoordinatorActionLease({
        profileHref: href,
        attemptId,
        attemptNumber: 1,
        actionKind: 'mute-block',
        reason: 'wrong-tab-request'
    }, {
        tab: {id: senderTabId}
    })

    assert.equal(result.granted, false)
    assert.equal(result.reason, 'active-tab-mismatch')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].tabId, activeTabId)
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].actionLease, undefined)
    assert.equal(currentAuthority.queue[href].tabId, activeTabId)
})

test('action lease request rejects inactive row before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Request-Queued-Row'
    const runId = 'run-lease-request-queued-row'
    const attemptId = 'attempt-lease-request-queued-row'
    const tabId = 702
    const now = 259850
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.requestCoordinatorActionLease({
        profileHref: href,
        attemptId,
        attemptNumber: 1,
        actionKind: 'mute-block',
        reason: 'queued-row-request'
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.granted, false)
    assert.equal(result.reason, 'inactive-coordinator-item')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].actionLease, undefined)
    assert.equal(currentAuthority.queue[href].status, 'queued')
})

test('action lease heartbeat is WAL-backed and does not clear unrelated expired lease', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Heartbeat'
    const otherHref = 'https://www.quora.com/profile/Synthetic-Lease-Expired-Other'
    const runId = 'run-lease-heartbeat'
    const otherRunId = 'run-lease-expired-other'
    const attemptId = 'attempt-lease-heartbeat'
    const otherAttemptId = 'attempt-lease-expired-other'
    const tabId = 620
    const now = 260000
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: now - 5000,
                        heartbeatAt: now - 1000,
                        expiresAt: now + 10000,
                        reason: 'test'
                    }
                },
                [otherHref]: {
                    ...makeActiveCoordinatorRow({href: otherHref, runId: otherRunId, attemptId: otherAttemptId, tabId: 621, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: otherHref,
                        tabId: 621,
                        attemptId: otherAttemptId,
                        attemptNumber: 1,
                        grantedAt: now - 20000,
                        heartbeatAt: now - 20000,
                        expiresAt: now - 1,
                        reason: 'expired-other'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId}),
                [otherRunId]: makeCoordinatorRun({href: otherHref, runId: otherRunId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.heartbeatCoordinatorActionLease({
        profileHref: href,
        attemptId,
        attemptNumber: 1
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.heartbeat, true)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease.heartbeatAt, now - 1000)
    assert.equal(storage.mbCoordinatorQueue[otherHref].actionLease.reason, 'expired-other')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 2)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.heartbeatAt, now)
    assert.equal(sw.coordinatorAuthority.current().queue[otherHref].actionLease.reason, 'expired-other')

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'action-lease-heartbeat')

    const restarted = loadServiceWorkerHarness({
        now: now + 1000,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].actionLease.heartbeatAt, now)
    assert.equal(hydrated.queue[otherHref].actionLease.reason, 'expired-other')
})

test('action lease release is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Release'
    const runId = 'run-lease-release'
    const attemptId = 'attempt-lease-release'
    const tabId = 622
    const now = 261000
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: now - 5000,
                        heartbeatAt: now - 1000,
                        expiresAt: now + 10000,
                        reason: 'test'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.releaseCoordinatorActionLease({
        profileHref: href,
        attemptId,
        attemptNumber: 1,
        reason: 'test-release'
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.released, true)
    assert.ok(storage.mbCoordinatorQueue[href].actionLease)
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease, null)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLeaseReleaseReason, 'test-release')

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'action-lease-release')

    const restarted = loadServiceWorkerHarness({
        now: now + 1000,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].actionLease, null)
    assert.equal(hydrated.queue[href].actionLeaseReleaseReason, 'test-release')
})

test('action lease tab release uses WAL terminal authority over stale raw lease', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Tab-Release-Wal-Terminal'
    const runId = 'run-lease-tab-release-wal-terminal'
    const attemptId = 'attempt-lease-tab-release-wal-terminal'
    const tabId = 626
    const now = 261500
    const firstHarness = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: now - 5000,
                        heartbeatAt: now - 1000,
                        expiresAt: now + 10000,
                        reason: 'stale-raw-lease'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: now - 500
                }
            }
        }
    })

    const terminal = await firstHarness.sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: now + 100,
        terminalAt: now + 100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(terminal.recorded, true)
    assert.equal(firstHarness.storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(firstHarness.storage.mbCoordinatorQueue[href].actionLease.reason, 'stale-raw-lease')
    assert.equal(firstHarness.sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(firstHarness.sw.coordinatorAuthority.current().queue[href].actionLease, null)

    const restarted = loadServiceWorkerHarness({
        now: now + 1000,
        storage: firstHarness.storage
    })
    const result = await restarted.sw.releaseCoordinatorActionLeaseForTab(tabId, 'queued-tab-slot-release')
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    const walRecords = getWalRecordsForGeneration(
        restarted.storage.mbCoordinatorQueueWal,
        restarted.storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )

    assert.equal(result.released, false)
    assert.equal(restarted.storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(restarted.storage.mbCoordinatorQueue[href].actionLease.reason, 'stale-raw-lease')
    assert.equal(hydrated.queue[href].status, 'succeeded')
    assert.equal(hydrated.queue[href].actionLease, null)
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'terminal-progress')
})

test('action lease tab release is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Tab-Release'
    const runId = 'run-lease-tab-release'
    const attemptId = 'attempt-lease-tab-release'
    const tabId = 6261
    const now = 261700
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: now - 5000,
                        heartbeatAt: now - 1000,
                        expiresAt: now + 10000,
                        reason: 'tab-release'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.releaseCoordinatorActionLeaseForTab(tabId, 'queued-tab-slot-release')

    assert.equal(result.released, true)
    assert.equal(result.releasedRows, 1)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease.reason, 'tab-release')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease, null)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLeaseReleaseReason, 'queued-tab-slot-release')

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'action-lease-tab-release')

    const restarted = loadServiceWorkerHarness({
        now: now + 1000,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].actionLease, null)
    assert.equal(hydrated.queue[href].actionLeaseReleaseReason, 'queued-tab-slot-release')
})

test('action lease tab release WAL append failure leaves lease active', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Tab-Release-Append-Failure'
    const runId = 'run-lease-tab-release-append-failure'
    const attemptId = 'attempt-lease-tab-release-append-failure'
    const tabId = 6262
    const now = 261800
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: now - 5000,
                        heartbeatAt: now - 1000,
                        expiresAt: now + 10000,
                        reason: 'tab-release-append-failure'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic action lease tab release WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.releaseCoordinatorActionLeaseForTab(tabId, 'queued-tab-slot-release')

    assert.equal(result.released, false)
    assert.equal(result.failedRows, 1)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease.reason, 'tab-release-append-failure')
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.reason, 'tab-release-append-failure')
})

test('action lease heartbeat WAL append failure rejects durable mutation', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Heartbeat-Append-Failure'
    const runId = 'run-lease-heartbeat-append-failure'
    const attemptId = 'attempt-lease-heartbeat-append-failure'
    const tabId = 623
    const now = 262000
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: now - 5000,
                        heartbeatAt: now - 1000,
                        expiresAt: now + 10000,
                        reason: 'test'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic action lease heartbeat WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.heartbeatCoordinatorActionLease({
        profileHref: href,
        attemptId,
        attemptNumber: 1
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.heartbeat, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease.heartbeatAt, now - 1000)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.heartbeatAt, now - 1000)
})

test('action lease release projection failure does not poison durable acknowledgement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Release-Projection-Failure'
    const runId = 'run-lease-release-projection-failure'
    const attemptId = 'attempt-lease-release-projection-failure'
    const tabId = 624
    const now = 263000
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: now - 5000,
                        heartbeatAt: now - 1000,
                        expiresAt: now + 10000,
                        reason: 'test'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueView) {
            return false
        }
        return originalSet(payload)
    }

    const result = await sw.releaseCoordinatorActionLease({
        profileHref: href,
        attemptId,
        attemptNumber: 1,
        reason: 'projection-failure-release'
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.released, true)
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease, null)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('action lease release rejects stale queue attempt before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Release-Stale-Attempt'
    const runId = 'run-lease-release-stale-attempt'
    const rowAttemptId = 'attempt-row-current'
    const leaseAttemptId = 'attempt-lease-stale'
    const tabId = 625
    const now = 264000
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId: rowAttemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId: leaseAttemptId,
                        attemptNumber: 1,
                        grantedAt: now - 5000,
                        heartbeatAt: now - 1000,
                        expiresAt: now + 10000,
                        reason: 'stale'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.releaseCoordinatorActionLease({
        profileHref: href,
        attemptId: leaseAttemptId,
        attemptNumber: 1,
        reason: 'stale-release'
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.released, false)
    assert.equal(result.staleAttempt, true)
    assert.equal(result.reason, 'stale-attempt')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.ok(storage.mbCoordinatorQueue[href].actionLease)
    assert.ok(sw.coordinatorAuthority.current().queue[href].actionLease)
})

test('action lease heartbeat rejects expired own lease without WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Heartbeat-Expired'
    const runId = 'run-lease-heartbeat-expired'
    const attemptId = 'attempt-lease-heartbeat-expired'
    const tabId = 626
    const now = 265000
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: now - 20000,
                        heartbeatAt: now - 20000,
                        expiresAt: now - 1,
                        reason: 'expired'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.heartbeatCoordinatorActionLease({
        profileHref: href,
        attemptId
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.heartbeat, false)
    assert.equal(result.actionLeaseLost, true)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease.reason, 'expired')

    const restarted = loadServiceWorkerHarness({
        now: now + 1000,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].actionLease.reason, 'expired')
})

test('action lease release rejects expired own lease with explicit reason', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Release-Expired'
    const runId = 'run-lease-release-expired'
    const attemptId = 'attempt-lease-release-expired'
    const tabId = 631
    const now = 266000
    const {storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now}),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: now - 20000,
                        heartbeatAt: now - 20000,
                        expiresAt: now - 1,
                        reason: 'expired'
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.releaseCoordinatorActionLease({
        profileHref: href,
        attemptId,
        reason: 'expired-release'
    }, {
        tab: {id: tabId}
    })

    assert.equal(result.released, false)
    assert.equal(result.actionLeaseLost, true)
    assert.equal(result.reason, 'expired-action-lease')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].actionLease.reason, 'expired')

    const restarted = loadServiceWorkerHarness({
        now: now + 1000,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].actionLease.reason, 'expired')
})

test('concurrent terminal compatibility saves do not regress newer terminal progress', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Terminal-Concurrent-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Terminal-Concurrent-B'
    const runIdA = 'run-terminal-concurrent-a'
    const runIdB = 'run-terminal-concurrent-b'
    const attemptIdA = 'attempt-terminal-concurrent-a'
    const attemptIdB = 'attempt-terminal-concurrent-b'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 255000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: makeActiveCoordinatorRow({href: hrefA, runId: runIdA, attemptId: attemptIdA, tabId: 514, now: 255000}),
                [hrefB]: makeActiveCoordinatorRow({href: hrefB, runId: runIdB, attemptId: attemptIdB, tabId: 515, now: 255000})
            },
            mbCoordinatorRuns: {
                [runIdA]: makeCoordinatorRun({href: hrefA, runId: runIdA}),
                [runIdB]: makeCoordinatorRun({href: hrefB, runId: runIdB})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [hrefA]: {
                    profileHref: hrefA,
                    status: 'blocking',
                    runId: runIdA,
                    tabId: 514,
                    actionKind: 'mute-block',
                    attemptId: attemptIdA,
                    attemptNumber: 1,
                    updatedAt: 254500
                },
                [hrefB]: {
                    profileHref: hrefB,
                    status: 'blocking',
                    runId: runIdB,
                    tabId: 515,
                    actionKind: 'mute-block',
                    attemptId: attemptIdB,
                    attemptNumber: 1,
                    updatedAt: 254500
                }
            }
        }
    })

    const firstPromise = sw.recordCoordinatorJobProgress(hrefA, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 255100,
        terminalAt: 255100,
        actionKind: 'mute-block',
        runId: runIdA,
        tabId: 514,
        attemptId: attemptIdA,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: 514
    })
    const secondPromise = sw.recordCoordinatorJobProgress(hrefB, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 255200,
        terminalAt: 255200,
        actionKind: 'mute-block',
        runId: runIdB,
        tabId: 515,
        attemptId: attemptIdB,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: 515
    })

    const [first, second] = await Promise.all([firstPromise, secondPromise])

    assert.equal(first.recorded, true)
    assert.equal(first.terminal, true)
    assert.equal(second.recorded, true)
    assert.equal(second.terminal, true)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefA].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefB].status, 'succeeded')
    assert.equal(storage.mbCoordinatorQueueView.counts.succeeded, 2)
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords[0].seq, 1)
    assert.equal(walRecords[1].seq, 2)
    assert.equal(storage.mbCoordinatorQueueWal.meta.nextSeq, 3)

    await waitFor(
        () => storage.mbProfileNukeProgress[hrefA]?.status === 'blocked' &&
            storage.mbProfileNukeProgress[hrefB]?.status === 'blocked',
        'concurrent terminal compatibility saves regressed one progress record',
        {attempts: 40}
    )

    assert.equal(storage.mbProfileNukeProgress[hrefA].status, 'blocked')
    assert.equal(storage.mbProfileNukeProgress[hrefB].status, 'blocked')
    assert.equal(storage.mbProfileNukeProgress[hrefA].attemptId, attemptIdA)
    assert.equal(storage.mbProfileNukeProgress[hrefB].attemptId, attemptIdB)
})

test('terminal progress compatibility save recomputes runs from WAL authority over stale raw queue', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Run-Authority'
    const runId = 'run-terminal-run-authority'
    const attemptId = 'attempt-terminal-run-authority'
    const tabId = 516
    const {storage, sw} = loadServiceWorkerHarness({
        now: 257000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 257000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 256500
                }
            }
        }
    })

    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 257100,
        terminalAt: 257100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')

    await waitFor(
        () => storage.mbCoordinatorRuns[runId]?.status === 'complete',
        'terminal progress compatibility save did not recompute runs from WAL authority',
        {attempts: 40}
    )

    assert.equal(storage.mbCoordinatorRuns[runId].terminalCount, 1)
    assert.equal(Number.parseInt(storage.mbCoordinatorRuns[runId].pendingCount, 10) || 0, 0)
})

test('terminal job progress reports durable terminal queue despite compatibility save failure', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Compatibility-Failure'
    const runId = 'run-terminal-compatibility-failure'
    const attemptId = 'attempt-terminal-compatibility-failure'
    const tabId = 504
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 260000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 260000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 259500
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbProfileNukeProgress) {
            throw new Error('synthetic compatibility save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 260100,
        terminalAt: 260100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'blocked')
    assert.equal(storage.mbCoordinatorQueueView.counts.succeeded, 1)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'blocking')
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocked')
    await waitFor(
        () => (sw.state().queueWakeupCounters['terminalProgress.compatibilitySaveFailed'] || 0) === 1,
        'terminal progress compatibility save failure was not recorded',
        {attempts: 20}
    )
    assert.equal(sw.state().queueWakeupCounters['terminalProgress.compatibilitySaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('terminal job progress acknowledges durable terminal queue before compatibility save timeout', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Compatibility-Timeout'
    const runId = 'run-terminal-compatibility-timeout'
    const attemptId = 'attempt-terminal-compatibility-timeout'
    const tabId = 505
    const {browser, storage, sw, timers} = loadServiceWorkerHarness({
        now: 270000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 270000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 269500
                }
            }
        }
    })
    const stalledSet = deferred()
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbProfileNukeProgress) {
            return stalledSet.promise
        }
        return originalSet(payload)
    }

    const result = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 270100,
        terminalAt: 270100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(storage.mbCoordinatorQueueView.counts.succeeded, 1)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'blocking')

    await timers.tick(16000)
    await flushAsync(20)

    assert.equal(sw.state().queueWakeupCounters['terminalProgress.compatibilitySaveFailed'] || 0, 1)
    assert.ok((sw.state().queueWakeupCounters['storageUpdate.timedOut'] || 0) >= 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('compatibility progress sync repairs stale failed queue rows through WAL authority', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Compatibility-Progress-Wal'
    const runId = 'run-compatibility-progress-wal'
    const attemptId = 'attempt-compatibility-progress-wal'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 276000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeFailedCoordinatorRow({href, runId, attemptId, now: 276000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocked',
                    blockSucceeded: true,
                    blockedAt: 276100,
                    terminalAt: 276100,
                    runId,
                    tabId: 0,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 276100
                }
            }
        }
    })

    const result = await browser.runtime.sendMessage({
        action: 'confirm-space-feed-profiles-blocked',
        profileHrefs: [href]
    }, {tab: {id: 12, windowId: 1}})

    assert.equal(result.confirmed, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(storage.mbCoordinatorQueueView.counts.succeeded, 1)
    const records = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(records.some(record => record.operationKind === 'compatibility-progress-sync'), true)
    assert.equal(storage.mbCoordinatorRuns[runId].terminalCount, 1)
})

test('compatibility progress sync derived save failure keeps WAL row durable and schedules repair', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Compatibility-Progress-Derived-Failure'
    const runId = 'run-compatibility-progress-derived-failure'
    const attemptId = 'attempt-compatibility-progress-derived-failure'
    const postKey = 'post-compatibility-progress-derived-failure'
    const progressRecord = {
        profileHref: href,
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 276600,
        terminalAt: 276600,
        runId,
        tabId: 0,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1,
        updatedAt: 276600
    }
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 276500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeFailedCoordinatorRow({href, runId, attemptId, now: 276500})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: progressRecord
            },
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: 'https://www.quora.com/q/example/post-compatibility-progress-derived-failure',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [href],
                    remainingUrls: [href],
                    updatedAt: 276000
                }
            },
            mbSpaceNukedPosts: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorRuns && !payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic compatibility progress derived save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.syncCoordinatorProgressRecords({[href]: progressRecord})
    browser.storage.local.set = originalSet

    assert.equal(result, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(recoveredQueue[href].status, 'succeeded')
    assert.equal(recoveredQueue[href].sourceSettlementOutcome, 'confirmed')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(storage.mbCoordinatorQueueView.counts.succeeded, 1)
    assert.equal(storage.mbCoordinatorRuns[runId].terminalCount, undefined)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey], undefined)
    const records = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(records.some(record => record.operationKind === 'compatibility-progress-sync'), true)
    assert.equal(records.some(record => record.operationKind === 'terminal-settlement'), true)
    assert.equal(sw.state().queueWakeupCounters['compatibilityProgressSync.derivedSaveFailed'], 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('compatibility progress sync skips no-op derived save after WAL transition', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Compatibility-Progress-Noop-Derived'
    const runId = 'run-compatibility-progress-noop-derived'
    const attemptId = 'attempt-compatibility-progress-noop-derived'
    const now = 276800
    const progressRecord = {
        profileHref: href,
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: now + 100,
        terminalAt: now + 100,
        runId,
        tabId: 0,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1,
        updatedAt: now + 100
    }
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeFailedCoordinatorRow({href, runId, attemptId, now})
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'complete',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href],
                    createdAt: now,
                    itemCount: 1,
                    activeCount: 0,
                    terminalCount: 1,
                    updatedAt: now + 100
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: progressRecord
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    let derivedRunWrites = 0
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorRuns && !payload?.mbCoordinatorQueueWal) {
            derivedRunWrites += 1
        }
        return originalSet(payload)
    }

    const result = await sw.syncCoordinatorProgressRecords({[href]: progressRecord})
    browser.storage.local.set = originalSet

    assert.equal(result, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'succeeded')
    assert.equal(derivedRunWrites, 0)
    assert.equal(sw.state().queueWakeupCounters['compatibilityProgressSync.derivedSaveFailed'] || 0, 0)
    assert.equal(sw.state().hasStoredWorkRepairTimeout, false)
})

test('compatibility progress sync WAL failure leaves stale failed row authoritative', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Compatibility-Progress-Wal-Failure'
    const runId = 'run-compatibility-progress-wal-failure'
    const attemptId = 'attempt-compatibility-progress-wal-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 277000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeFailedCoordinatorRow({href, runId, attemptId, now: 277000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocked',
                    blockSucceeded: true,
                    blockedAt: 277100,
                    terminalAt: 277100,
                    runId,
                    tabId: 0,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 277100
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic compatibility progress WAL failure')
        }
        return originalSet(payload)
    }

    const result = await browser.runtime.sendMessage({
        action: 'confirm-space-feed-profiles-blocked',
        profileHrefs: [href]
    }, {tab: {id: 12, windowId: 1}})

    assert.equal(result.confirmed, false)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'failed')
    assert.equal(storage.mbCoordinatorRuns[runId].terminalCount, undefined)
    assert.equal(sw.state().queueWakeupCounters['compatibilityProgressSync.queueWalSaveFailed'], 1)
})

test('clear profile state removes queue row through WAL authority and saves derived cleanup', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Clear-Profile-Wal'
    const runId = 'run-clear-profile-wal'
    const attemptId = 'attempt-clear-profile-wal'
    const postKey = 'post-clear-profile-wal'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 278000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 278000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    runId,
                    tabId: null,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 278000
                }
            },
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: 'https://www.quora.com/q/example/post-clear-profile-wal',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [href],
                    remainingUrls: [href],
                    updatedAt: 278000
                }
            },
            mbSpaceNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: 'https://www.quora.com/q/example/post-clear-profile-wal',
                    spaceUrl: 'https://www.quora.com/q/example',
                    urls: [href],
                    updatedAt: 278000
                }
            }
        }
    })

    const result = await browser.runtime.sendMessage({
        action: 'clear-profile-nuke-state',
        profileHref: href,
        reason: 'synthetic-clear'
    }, {tab: {id: 12, windowId: 1}})

    assert.equal(result.cleared, true)
    assert.equal(result.queueChanged, true)
    assert.equal(result.runsChanged, true)
    assert.equal(result.progressChanged, true)
    assert.equal(result.pendingChanged, true)
    assert.equal(result.nukedChanged, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href], undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href], undefined)
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(sw.state().profileNukeProgress[href], undefined)
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), false)
    assert.equal(storage.mbCoordinatorRuns[runId].targetWorkKeys.includes(href), false)
    assert.equal(storage.mbCoordinatorRuns[runId].itemCount, 0)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey], undefined)
    assert.equal(storage.mbSpaceNukedPosts[postKey], undefined)
    assert.equal(storage.mbCoordinatorQueueView.counts.queued || 0, 0)

    const records = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(records.length, 1)
    assert.equal(records[0].operationKind, 'clear-profile')
    assert.equal(records[0].removed, true)
})

test('clear profile state derived failure materializes cleanup without resurrecting queue row', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Clear-Profile-Derived-Failure'
    const runId = 'run-clear-profile-derived-failure'
    const attemptId = 'attempt-clear-profile-derived-failure'
    const postKey = 'post-clear-profile-derived-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 278250,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 278250})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    runId,
                    tabId: null,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 278250
                }
            },
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: 'https://www.quora.com/q/example/post-clear-profile-derived-failure',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [href],
                    remainingUrls: [href],
                    updatedAt: 278250
                }
            },
            mbSpaceNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: 'https://www.quora.com/q/example/post-clear-profile-derived-failure',
                    spaceUrl: 'https://www.quora.com/q/example',
                    urls: [href],
                    updatedAt: 278250
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    let failedDerivedSave = false
    browser.storage.local.set = async payload => {
        if(!failedDerivedSave &&
            payload?.mbProfileNukeProgress &&
            payload?.mbCoordinatorRuns &&
            payload?.mbSpacePendingNukedPosts &&
            payload?.mbSpaceNukedPosts) {
            failedDerivedSave = true
            throw new Error('synthetic clear profile derived failure')
        }
        return originalSet(payload)
    }

    const result = await browser.runtime.sendMessage({
        action: 'clear-profile-nuke-state',
        profileHref: href,
        reason: 'synthetic-clear-derived-failure'
    }, {tab: {id: 12, windowId: 1}})
    browser.storage.local.set = originalSet

    assert.equal(result.cleared, true)
    assert.equal(result.queueChanged, true)
    assert.equal(result.derivedSaved, false)
    assert.equal(failedDerivedSave, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href], undefined)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.ok(storage.mbProfileNukeProgress[href])
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), true)
    assert.equal(storage.mbCoordinatorRuns[runId].targetWorkKeys.includes(href), true)
    assert.ok(storage.mbSpacePendingNukedPosts[postKey])
    assert.ok(storage.mbSpaceNukedPosts[postKey])
    assert.equal(sw.state().queueWakeupCounters['clearProfile.derivedSaveFailed'], 1)

    const repair = await sw.repairCoordinatorStorageFromProgress()

    assert.equal(repair.queueChanged, false)
    assert.equal(repair.queueCount, 0)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href], undefined)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), false)
    assert.equal(storage.mbCoordinatorRuns[runId].targetWorkKeys.includes(href), false)
    assert.equal(storage.mbCoordinatorRuns[runId].itemCount, 0)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey], undefined)
    assert.equal(storage.mbSpaceNukedPosts[postKey], undefined)
})

test('clear profile state WAL failure leaves raw and derived state intact', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Clear-Profile-Wal-Failure'
    const runId = 'run-clear-profile-wal-failure'
    const attemptId = 'attempt-clear-profile-wal-failure'
    const postKey = 'post-clear-profile-wal-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 278500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 278500})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    runId,
                    tabId: null,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 278500
                }
            },
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: 'https://www.quora.com/q/example/post-clear-profile-wal-failure',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [href],
                    remainingUrls: [href],
                    updatedAt: 278500
                }
            },
            mbSpaceNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: 'https://www.quora.com/q/example/post-clear-profile-wal-failure',
                    spaceUrl: 'https://www.quora.com/q/example',
                    urls: [href],
                    updatedAt: 278500
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic clear profile WAL failure')
        }
        return originalSet(payload)
    }

    const result = await browser.runtime.sendMessage({
        action: 'clear-profile-nuke-state',
        profileHref: href,
        reason: 'synthetic-clear-failure'
    }, {tab: {id: 12, windowId: 1}})
    browser.storage.local.set = originalSet

    assert.equal(result.cleared, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.ok(storage.mbProfileNukeProgress[href])
    assert.ok(sw.state().profileNukeProgress[href])
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), true)
    assert.ok(storage.mbSpacePendingNukedPosts[postKey])
    assert.ok(storage.mbSpaceNukedPosts[postKey])
    const hydrated = await sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'queued')
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('top-level coordinator authority ignores caller currentAuthorityState', async () => {
    const href = 'https://www.quora.com/profile/Authority-Top-Level-Locked-Projection'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 280000,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-top-level-current',
                    status: 'active',
                    attemptId: 'attempt-current',
                    attemptNumber: 3,
                    targetProfileHref: href,
                    updatedAt: 280000
                }
            }
        }
    })

    const result = await sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-top-level-locked-projection',
        rowKey: href,
        expectedAttemptId: 'attempt-stale',
        currentAuthorityState: {
            queue: {
                [href]: {
                    id: 'authority-top-level-stale',
                    status: 'active',
                    attemptId: 'attempt-stale',
                    attemptNumber: 2,
                    targetProfileHref: href,
                    updatedAt: 279000
                }
            },
            runs: {}
        },
        mutate(row, context) {
            return {
                ...row,
                status: 'failed',
                error: 'stale locked projection applied',
                updatedAt: context.now
            }
        }
    })

    assert.equal(result.accepted, false)
    assert.equal(result.durable, false)
    assert.equal(result.staleAttempt, true)
    assert.equal(result.reason, 'stale-attempt')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[href].attemptId, 'attempt-current')
})

test('row event preserves terminal durable rows against late nonterminal breadcrumbs', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Row-Event'
    const runId = 'run-terminal-row-event'
    const attemptId = 'attempt-terminal-row-event'
    const terminalAt = 299000
    const {storage, sw} = loadServiceWorkerHarness({
        now: 300000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, now: 300000}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt,
                    updatedAt: terminalAt,
                    tabId: null,
                    actionLease: null
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href, runId}),
                    status: 'complete'
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocked',
                    blockSucceeded: true,
                    blockedAt: terminalAt,
                    terminalAt,
                    runId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: terminalAt
                }
            }
        }
    })

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'blocking',
            blockAttemptedAt: 300010,
            runId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })

    assert.equal(result.recorded, false)
    assert.equal(result.reason, 'terminal-row-preserved')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'succeeded')
    assert.equal(storage.mbProfileNukeProgress[href].status, 'blocked')
    assert.equal(storage.mbProfileNukeProgress[href].terminalAt, terminalAt)
    assert.equal(sw.state().queueWakeupCounters['rowEvent.queued-progress-milestone.rejected.terminalRowPreserved'] || 0, 1)
})

test('rejected deferred milestones do not poison in-memory progress mirror', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Rejected-Deferred-Milestone'
    const runId = 'run-rejected-deferred-milestone'
    const attemptId = 'attempt-rejected-deferred-milestone'
    const terminalAt = 399000
    const {storage, sw} = loadServiceWorkerHarness({
        now: 400000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, now: 400000}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt,
                    updatedAt: terminalAt,
                    tabId: null,
                    actionLease: null
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href, runId}),
                    status: 'complete'
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocked',
                    blockSucceeded: true,
                    blockedAt: terminalAt,
                    terminalAt,
                    runId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: terminalAt
                }
            }
        }
    })

    const result = await sw.recordDeferredCoordinatorJobMilestone(href, {
        status: 'blocking',
        blockAttemptedAt: 400010,
        runId,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1
    })

    assert.equal(result.recorded, false)
    assert.equal(result.durable, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'succeeded')
    assert.equal(storage.mbProfileNukeProgress[href].status, 'blocked')
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocked')
    assert.equal(sw.state().profileNukeProgress[href].terminalAt, terminalAt)
    assert.equal(sw.state().queueWakeupCounters['rowEvent.queued-progress-milestone.rejected.terminalRowPreserved'] || 0, 1)
})

test('deferred milestone acknowledgement is row-specific for mixed flush results', async () => {
    const rejectedHref = 'https://www.quora.com/profile/Synthetic-Mixed-Rejected'
    const acceptedHref = 'https://www.quora.com/profile/Synthetic-Mixed-Accepted'
    const runId = 'run-mixed-deferred-milestone'
    const rejectedAttemptId = 'attempt-mixed-rejected'
    const acceptedAttemptId = 'attempt-mixed-accepted'
    const terminalAt = 499000
    const acceptedTabId = 601
    const rejectedTabId = 602
    const {storage, sw} = loadServiceWorkerHarness({
        now: 500000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [rejectedHref]: {
                    ...makeActiveCoordinatorRow({href: rejectedHref, runId, attemptId: rejectedAttemptId, now: 500000}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt,
                    updatedAt: terminalAt,
                    tabId: null,
                    actionLease: null
                },
                [acceptedHref]: makeActiveCoordinatorRow({
                    href: acceptedHref,
                    runId,
                    attemptId: acceptedAttemptId,
                    tabId: acceptedTabId,
                    now: 500000
                })
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    targetProfileHrefs: [rejectedHref, acceptedHref],
                    targetWorkKeys: [rejectedHref, acceptedHref],
                    status: 'active'
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [rejectedHref]: {
                    profileHref: rejectedHref,
                    status: 'blocked',
                    blockSucceeded: true,
                    blockedAt: terminalAt,
                    terminalAt,
                    runId,
                    actionKind: 'mute-block',
                    attemptId: rejectedAttemptId,
                    attemptNumber: 1,
                    updatedAt: terminalAt
                },
                [acceptedHref]: {
                    profileHref: acceptedHref,
                    status: 'tab-opened',
                    runId,
                    tabId: acceptedTabId,
                    actionKind: 'mute-block',
                    attemptId: acceptedAttemptId,
                    attemptNumber: 1,
                    updatedAt: 499500
                }
            }
        }
    })

    sw.__testAddProvisionalQueuedTab(rejectedTabId, {
        profileHref: rejectedHref,
        coordinatorKey: rejectedHref,
        requestedUrl: rejectedHref,
        actionKind: 'mute-block',
        runId,
        attemptId: rejectedAttemptId,
        attemptNumber: 1,
        lastProgressAt: 499000,
        lastUrl: 'https://www.quora.com/profile/Synthetic-Mixed-Rejected?before=1'
    })
    sw.__testAddProvisionalQueuedTab(acceptedTabId, {
        profileHref: acceptedHref,
        coordinatorKey: acceptedHref,
        requestedUrl: acceptedHref,
        actionKind: 'mute-block',
        runId,
        attemptId: acceptedAttemptId,
        attemptNumber: 1,
        lastProgressAt: 499500
    })
    const rejectedMetadataBefore = sw.state().queuedTabMetadata.find(([candidateTabId]) => candidateTabId === rejectedTabId)?.[1] || {}

    const rejectedPromise = sw.recordDeferredCoordinatorJobMilestone(rejectedHref, {
        status: 'blocking',
        blockAttemptedAt: 500010,
        runId,
        actionKind: 'mute-block',
        attemptId: rejectedAttemptId,
        attemptNumber: 1,
        lastUrl: 'https://www.quora.com/profile/Synthetic-Mixed-Rejected?rejected=1'
    }, {senderTabId: rejectedTabId})
    const acceptedPromise = sw.recordDeferredCoordinatorJobMilestone(acceptedHref, {
        status: 'page-ready',
        actionReadyAt: 500020,
        runId,
        tabId: acceptedTabId,
        actionKind: 'mute-block',
        attemptId: acceptedAttemptId,
        attemptNumber: 1,
        lastUrl: 'https://www.quora.com/profile/Synthetic-Mixed-Accepted?accepted=1'
    }, {senderTabId: acceptedTabId})
    const [rejected, accepted] = await Promise.all([rejectedPromise, acceptedPromise])
    const rejectedMetadataAfter = sw.state().queuedTabMetadata.find(([candidateTabId]) => candidateTabId === rejectedTabId)?.[1] || {}
    const acceptedMetadataAfter = sw.state().queuedTabMetadata.find(([candidateTabId]) => candidateTabId === acceptedTabId)?.[1] || {}

    assert.equal(rejected.recorded, false)
    assert.equal(rejected.durable, false)
    assert.equal(rejected.reason, 'terminal-row-preserved')
    assert.equal(accepted.recorded, true)
    assert.equal(accepted.durable, true)
    assert.equal(storage.mbProfileNukeProgress[rejectedHref].status, 'blocked')
    assert.equal(sw.state().profileNukeProgress[rejectedHref].status, 'blocked')
    assert.equal(sw.state().profileNukeProgress[acceptedHref].status, 'page-ready')
    assert.equal(storage.mbProfileNukeProgress[acceptedHref].status, 'tab-opened')
    assert.equal(storage.mbProfileNukeProgressView.records[acceptedHref].status, 'page-ready')
    assert.equal(getProgressShardRecord(storage, acceptedHref).status, 'page-ready')
    assert.equal(rejectedMetadataAfter.lastProgressAt, rejectedMetadataBefore.lastProgressAt)
    assert.equal(rejectedMetadataAfter.lastUrl, rejectedMetadataBefore.lastUrl)
    assert.equal(acceptedMetadataAfter.actionReadyAt, 500020)
    assert.equal(acceptedMetadataAfter.lastUrl, 'https://www.quora.com/profile/Synthetic-Mixed-Accepted?accepted=1')
    assert.equal(sw.state().queueWakeupCounters['rowEvent.queued-progress-milestone.accepted'] || 0, 1)
    assert.equal(sw.state().queueWakeupCounters['rowEvent.queued-progress-milestone.rejected.terminalRowPreserved'] || 0, 1)
})

test('dashboard repair schedules progress-only queued Current Work repair', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-User'
    const runId = 'run-synthetic-1'
    const {browser, storage} = loadServiceWorkerHarness({
        now: 100000,
        storage: {
            mbCoordinatorPaused: true,
            mbCoordinatorQueue: {},
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    sourcePages: ['https://www.quora.com/space/example'],
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href],
                    status: 'active'
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    runId,
                    queuedAt: 99000,
                    actionKind: 'mute-block'
                }
            }
        }
    })

    await activateQuoraRuntime(browser, 'https://www.quora.com/space/example')

    const result = await browser.runtime.sendMessage({action: 'repair-coordinator-storage'})

    assert.equal(result.reason, 'dashboard-repair-request-scheduled')
    assert.equal(result.repairScheduled, true)
    assert.equal(result.scheduledOnly, true)
    assert.equal(storage.mbCoordinatorQueue[href], undefined)

    await browser.alarms.onAlarm.emit({name: 'mb-stored-work-repair'})

    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[href].runId, runId)
})

test('authority reconcile reclaims durable active row without confirmed runtime actor', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Missing-Runtime'
    const runId = 'run-missing-runtime'
    const attemptId = 'attempt-missing-runtime'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 200000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 199000,
                    activeAt: 199500,
                    updatedAt: 199500,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabOpenedAt: 199500,
                    updatedAt: 199500,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('missing-runtime-test')

    assert.equal(result.requeued, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, attemptId)
    assert.equal(sw.coordinatorAuthority.current().queue[href].attemptNumber, 2)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'queued')
    assert.equal(storage.mbProfileNukeProgress[href].attemptId, sw.coordinatorAuthority.current().queue[href].attemptId)
    assert.equal(sw.state().activeQueuedTabs.length, 0)
})

test('authority reconcile adopts matching candidate tab by durable active token', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Candidate-Only'
    const runId = 'run-candidate-only'
    const attemptId = 'attempt-candidate-only'
    const tabId = 321
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 300000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 100000,
                    activeAt: 200000,
                    updatedAt: 200000,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {
                        tabCreatedAt: 200000,
                        navigationStartedAt: 200000
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    tabOpenedAt: 200000,
                    updatedAt: 200000,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false,
        status: 'complete'
    })

    const result = await settleWithFakeTimers(
        sw.runCoordinatorAuthorityReconcileActions('candidate-only-test'),
        timers
    )

    assert.equal(result.adopted, 1)
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
    assert.equal(storage.mbCoordinatorQueue[href].tabId, tabId)
    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.ok(sw.state().activeQueuedTabs.includes(tabId))
})

test('authority reconcile preserves live persisted tab even when current URL is not a profile', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Stale-Owned-Tab'
    const runId = 'run-stale-owned-tab'
    const attemptId = 'attempt-stale-owned-tab'
    const tabId = 333
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 320000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 310000,
                    activeAt: 315000,
                    updatedAt: 315000,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {
                        tabCreatedAt: 315000,
                        navigationStartedAt: 315000
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    tabOpenedAt: 315000,
                    updatedAt: 315000,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: 'about:blank',
        active: false,
        status: 'complete'
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1,
        durableActiveAt: 315000,
        durableActiveReason: 'test-stale-runtime'
    })

    const result = await settleWithFakeTimers(
        sw.runCoordinatorAuthorityReconcileActions('stale-owned-tab-test'),
        timers
    )

    assert.equal(result.adopted, 1)
    assert.equal(result.requeued, 0)
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
    assert.equal(storage.mbCoordinatorQueue[href].attemptId, attemptId)
    assert.notEqual(storage.mbProfileNukeProgress[href].status, 'queued')
    assert.notEqual(storage.mbProfileNukeProgress[href].status, 'interrupted')
    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.ok(sw.state().activeQueuedTabs.includes(tabId))
})

test('authority reconcile rejects persisted tab id reuse with unrelated live tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Reused-Tab-Id'
    const runId = 'run-reused-tab-id'
    const attemptId = 'attempt-reused-tab-id'
    const tabId = 335
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 340000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 338000,
                    activeAt: 339000,
                    updatedAt: 339000,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    tabOpenedAt: 339000,
                    updatedAt: 339000,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: 'https://example.com/unrelated',
        active: false,
        status: 'complete'
    })

    const result = await settleWithFakeTimers(
        sw.runCoordinatorAuthorityReconcileActions('reused-tab-id-test'),
        timers
    )

    assert.equal(result.adopted, 0)
    assert.equal(result.requeued, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, attemptId)
    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), false)
})

test('authority reconcile treats missing active anchors as reclaimable despite persisted tab id', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Missing-Anchor'
    const runId = 'run-missing-anchor'
    const attemptId = 'attempt-missing-anchor'
    const tabId = 336
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 350000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: 'about:blank',
        active: false,
        status: 'loading'
    })

    const result = await settleWithFakeTimers(
        sw.runCoordinatorAuthorityReconcileActions('missing-anchor-test'),
        timers
    )

    assert.equal(result.adopted, 0)
    assert.equal(result.requeued, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, attemptId)
    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(browser.__removedTabs.includes(tabId), false)
})

test('storage repair preserves fresh plausible persisted tab on transient URL', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Repair-Transient'
    const runId = 'run-repair-transient'
    const attemptId = 'attempt-repair-transient'
    const tabId = 337
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 360000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 350000,
                    activeAt: 355000,
                    updatedAt: 355000,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {
                        tabCreatedAt: 355000,
                        navigationStartedAt: 355000
                    }
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    tabOpenedAt: 355000,
                    updatedAt: 355000,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: 'about:blank',
        active: false,
        status: 'loading'
    })

    const result = await settleWithFakeTimers(sw.repairCoordinatorStorageFromProgress(), timers)

    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
    assert.equal(storage.mbCoordinatorQueue[href].tabId, tabId)
    assert.notEqual(storage.mbProfileNukeProgress[href].status, 'interrupted')
    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(browser.__removedTabs.includes(tabId), false)
})

test('storage repair does not close unrelated persisted tab id', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Repair-Reused-Tab'
    const runId = 'run-repair-reused-tab'
    const attemptId = 'attempt-repair-reused-tab'
    const tabId = 338
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 500000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 300000,
                    activeAt: 310000,
                    updatedAt: 310000,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: 'https://example.com/unrelated',
        active: false,
        status: 'complete'
    })

    await settleWithFakeTimers(sw.repairCoordinatorStorageFromProgress(), timers)

    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(browser.__removedTabs.includes(tabId), false)
})

test('resume does not duplicate action-phase active row whose live tab is on a non-profile URL', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Action-Phase-Nonprofile'
    const runId = 'run-action-phase-nonprofile'
    const attemptId = 'attempt-action-phase-nonprofile'
    const tabId = 334
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 330000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 320000,
                    activeAt: 325000,
                    updatedAt: 325000,
                    tabId,
                    attemptId,
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    tabOpenedAt: 325000,
                    actionReadyAt: 326000,
                    blockAttemptedAt: 327000,
                    updatedAt: 327000,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: 'chrome-error://chromewebdata/',
        active: false,
        status: 'complete'
    })

    const resume = sw.resumeCoordinatorQueueExecutionOnce({tabId: 'service-worker-queue-owner'}, {
        serviceWorkerOwned: true,
        awaitFill: true
    }).catch(() => null)
    await flushAsync(20)
    await timers.tick(5000)
    await flushAsync(20)
    await timers.tick(15000)
    await flushAsync(20)
    void resume

    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
    assert.equal(storage.mbCoordinatorQueue[href].tabId, tabId)
    assert.equal(listTabs(browser).length, 1)
    assert.equal(listTabs(browser)[0].id, tabId)
    assert.equal(sw.state().queuedTabActions.length, 0)
})

test('queued profile tab completing on a non-profile Quora URL is skipped and closed', async () => {
    const href = 'https://www.quora.com/profile/Top-10'
    const topicUrl = 'https://www.quora.com/topic/TOP-10'
    const runId = 'run-non-profile-landing'
    const attemptId = 'attempt-non-profile-landing'
    const tabId = 501
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 410000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 400000,
                    activeAt: 405000,
                    updatedAt: 405000,
                    tabId,
                    attemptId,
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    tabOpenedAt: 405000,
                    updatedAt: 405000,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: topicUrl,
        active: true,
        status: 'complete'
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        ownerTabId: 'service-worker-queue-owner',
        attemptId,
        attemptNumber: 1,
        openedAt: 405000
    })

    await browser.tabs.onUpdated.emit(tabId, {
        status: 'complete',
        url: topicUrl
    }, {
        id: tabId,
        windowId: 1,
        url: topicUrl,
        status: 'complete'
    })
    await flushAsync(20)
    await timers.tick(1000)
    await flushAsync(20)

    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'non-profile-target')
    assert.equal(storage.mbCoordinatorQueueView.counts.skipped, 1)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'profile-unavailable')
    assert.match(storage.mbProfileNukeProgress[href].unavailableReason, /did not land on a profile page/)
    await timers.tick(1000)
    await flushAsync(20)
    assert.equal(browser.__tabs.has(tabId), false)
    assert.equal(browser.__removedTabs.includes(tabId), true)
    assert.deepEqual(sw.state().activeQueuedTabs, [])
})

test('authority reconcile skips durable active profile row that landed on a non-profile Quora URL', async () => {
    const href = 'https://www.quora.com/profile/Top-10'
    const topicUrl = 'https://www.quora.com/topic/TOP-10'
    const runId = 'run-durable-non-profile-landing'
    const attemptId = 'attempt-durable-non-profile-landing'
    const tabId = 502
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 420000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 410000,
                    activeAt: 415000,
                    updatedAt: 415000,
                    tabId,
                    attemptId,
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    tabOpenedAt: 415000,
                    lastUrl: topicUrl,
                    updatedAt: 415000,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    actionSurfaceMode: 'worker-window',
                    actionSurfaceWindowId: 7
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 7,
        url: topicUrl,
        active: true,
        status: 'complete'
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('synthetic-non-profile-landing')

    assert.equal(result.changed, true)
    assert.equal(result.skipped, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'non-profile-target')
    assert.equal(storage.mbCoordinatorQueueView.counts.skipped, 1)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'profile-unavailable')
    assert.equal(browser.__tabs.has(tabId), false)
    assert.equal(browser.__removedTabs.includes(tabId), true)
})

test('non-profile landing terminalization is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Non-Profile-Authority'
    const topicUrl = 'https://www.quora.com/topic/Synthetic-Non-Profile-Authority'
    const runId = 'run-non-profile-authority'
    const attemptId = 'attempt-non-profile-authority'
    const tabId = 627
    const {storage, sw} = loadServiceWorkerHarness({
        now: 421000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 421000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    tabOpenedAt: 420500,
                    lastUrl: topicUrl,
                    updatedAt: 420500,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })

    const result = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'repair',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-authority'
    })

    assert.equal(result.changed, true)
    assert.equal(result.status, 'skipped')
    assert.equal(result.outcome, 'non-profile-target')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueView.counts.skipped, 1)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'profile-unavailable')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'repair-non-profile-landing')

    const restarted = loadServiceWorkerHarness({
        now: 421500,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'skipped')
    assert.equal(hydrated.queue[href].outcome, 'non-profile-target')
})

test('reconcile does not resume WAL-terminal row from stale raw queue snapshot', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Non-Profile-Reconcile'
    const topicUrl = 'https://www.quora.com/topic/Synthetic-Non-Profile-Reconcile'
    const runId = 'run-non-profile-reconcile'
    const attemptId = 'attempt-non-profile-reconcile'
    const tabId = 628
    const {storage, sw, browser} = loadServiceWorkerHarness({
        now: 421800,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 421800})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    tabOpenedAt: 421500,
                    lastUrl: topicUrl,
                    updatedAt: 421500,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })

    const terminalized = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'repair',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-reconcile'
    })
    assert.equal(terminalized.changed, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')

    const restarted = loadServiceWorkerHarness({
        now: 421900,
        storage
    })
    await activateQuoraRuntime(restarted.browser)
    const result = await restarted.sw.runCoordinatorReconcileTick('synthetic-wal-terminal-stale-snapshot', {
        allowBeforeQuora: true,
        awaitFill: true
    })

    assert.equal(result.reconcile.executor.queued, 0)
    assert.equal(result.reconcile.executor.pending, 0)
    assert.equal(restarted.sw.state().queuedTabActions.length, 0)
    assert.equal(listTabs(restarted.browser).length, 0)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal((await restarted.sw.coordinatorAuthority.hydrate()).queue[href].status, 'skipped')
    assert.equal(browser.__tabs.size, 0)
})

test('preplanned queued action revalidates WAL-terminal authority before opening tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Preplanned-Wal-Terminal'
    const topicUrl = 'https://www.quora.com/topic/Synthetic-Preplanned-Wal-Terminal'
    const runId = 'run-preplanned-wal-terminal'
    const attemptId = 'attempt-preplanned-wal-terminal'
    const tabId = 629
    const {storage, sw, browser} = loadServiceWorkerHarness({
        now: 421950,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 421950})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    tabOpenedAt: 421500,
                    lastUrl: topicUrl,
                    updatedAt: 421500,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })

    const terminalized = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'repair',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-preplanned-wal-terminal'
    })
    assert.equal(terminalized.changed, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')

    sw.__testAddQueuedAction({
        url: href,
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        runId,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        noForegroundFallback: true,
        attemptId,
        attemptNumber: 1,
        executorPlanKind: 'open-tab',
        executorPlanReason: 'synthetic-preplanned-open'
    })
    assert.equal(sw.state().queuedTabActions.length, 1)

    await activateQuoraRuntime(browser)
    const result = await sw.resumeCoordinatorQueueExecution({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-preplanned-wal-terminal'
    })

    assert.equal(result.queued, 0)
    assert.equal(result.pending, 0)
    assert.equal(sw.state().queuedTabActions.length, 0)
    assert.equal(listTabs(browser).length, 0)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal((await sw.coordinatorAuthority.hydrate()).queue[href].status, 'skipped')
})

test('non-profile landing terminalization rejects stale attempt before authority save', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Non-Profile-Stale'
    const topicUrl = 'https://www.quora.com/topic/Synthetic-Non-Profile-Stale'
    const runId = 'run-non-profile-stale'
    const attemptId = 'attempt-non-profile-stale'
    const tabId = 628
    const {storage, sw} = loadServiceWorkerHarness({
        now: 422000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 422000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    tabOpenedAt: 421500,
                    lastUrl: topicUrl,
                    updatedAt: 421500,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })

    const result = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'repair',
        expectedAttemptId: 'stale-attempt',
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-stale'
    })

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'attempt-changed')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
})

test('non-profile landing terminalization append failure leaves row active', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Non-Profile-Append-Failure'
    const topicUrl = 'https://www.quora.com/topic/Synthetic-Non-Profile-Append-Failure'
    const runId = 'run-non-profile-append-failure'
    const attemptId = 'attempt-non-profile-append-failure'
    const tabId = 629
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 423000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 423000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    tabOpenedAt: 422500,
                    lastUrl: topicUrl,
                    updatedAt: 422500,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic non-profile authority WAL failure')
        }
        return originalSet(payload)
    }

    const result = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'repair',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-append-failure'
    })

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
})

test('non-profile landing projection failure does not poison WAL terminalization', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Non-Profile-Projection-Failure'
    const topicUrl = 'https://www.quora.com/topic/Synthetic-Non-Profile-Projection-Failure'
    const runId = 'run-non-profile-projection-failure'
    const attemptId = 'attempt-non-profile-projection-failure'
    const tabId = 631
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 425000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 425000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    tabOpenedAt: 424500,
                    lastUrl: topicUrl,
                    updatedAt: 424500,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueView) {
            throw new Error('synthetic non-profile projection save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'repair',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-projection-failure'
    })

    assert.equal(result.changed, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'profile-unavailable')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)

    const restarted = loadServiceWorkerHarness({
        now: 425500,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'skipped')
})

test('non-profile landing derived failure does not poison authority terminalization', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Non-Profile-Derived-Failure'
    const topicUrl = 'https://www.quora.com/topic/Synthetic-Non-Profile-Derived-Failure'
    const runId = 'run-non-profile-derived-failure'
    const attemptId = 'attempt-non-profile-derived-failure'
    const tabId = 630
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 424000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 424000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opening',
                    runId,
                    tabId,
                    tabOpenedAt: 423500,
                    lastUrl: topicUrl,
                    updatedAt: 423500,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })
    let walSaved = false
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            walSaved = true
        }
        if(walSaved && !payload?.mbCoordinatorQueueWal && (payload?.mbCoordinatorRuns || payload?.mbProfileNukeProgress)) {
            throw new Error('synthetic non-profile derived save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'repair',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-derived-failure'
    })

    assert.equal(result.changed, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')
    assert.equal(sw.state().queueWakeupCounters['repair.nonProfileLanding.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )
})

test('key-only terminalization is WAL-backed and recovers after restart', async () => {
    const key = 'resolve-profile:https://www.quora.com/q/example/post-key-only-authority'
    const requestedUrl = 'https://www.quora.com/q/example/post-key-only-authority'
    const runId = 'run-key-only-authority'
    const attemptId = 'attempt-key-only-authority'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 426000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    queuedAt: 425000,
                    activeAt: 425500,
                    updatedAt: 425500,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.terminalizeCoordinatorKeyOnlyItem(key, {
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reason: 'synthetic-key-only-authority',
        now: 426000
    })

    assert.equal(result.changed, true)
    assert.equal(result.status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueueView.counts.failed, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'failed')
    assert.equal(storage.mbCoordinatorEvents.length, 1)
    assert.equal(storage.mbCoordinatorEvents[0].details.coordinatorKey, key)
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'repair-key-only-terminalize')

    const restarted = loadServiceWorkerHarness({
        now: 426500,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[key].status, 'failed')
    assert.equal(hydrated.queue[key].outcome, 'timeout')
})

test('late profile resolution cannot remap a WAL-terminal key-only row over stale raw queue', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-key-only-late-resolve'
    const key = `resolve-profile:${requestedUrl}`
    const resolvedHref = 'https://www.quora.com/profile/Late-Key-Only-Resolve'
    const runId = 'run-key-only-late-resolve'
    const attemptId = 'attempt-key-only-late-resolve'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426700,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425700,
                    activeAt: 426200,
                    updatedAt: 426200,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: []
        }
    })

    const terminal = await sw.terminalizeCoordinatorKeyOnlyItem(key, {
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reason: 'synthetic-key-only-late-resolve',
        now: 426700
    })
    const walRecordsBefore = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )

    assert.equal(terminal.changed, true)
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'failed')
    assert.equal(walRecordsBefore.length, 1)

    const resolved = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target',
        requestedUrl,
        coordinatorKey: key,
        profileHref: resolvedHref,
        attemptId,
        attemptNumber: 1
    }, {
        tab: {
            id: 617,
            url: resolvedHref
        }
    })
    const walRecordsAfter = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )

    assert.equal(resolved.resolved, false)
    assert.equal(resolved.reason, 'terminal-coordinator-item')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[resolvedHref], undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'failed')
    assert.equal(walRecordsAfter.length, walRecordsBefore.length)
})

test('late profile resolution cannot overwrite a WAL-terminal destination row', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-destination-terminal'
    const key = `resolve-profile:${requestedUrl}`
    const resolvedHref = 'https://www.quora.com/profile/Destination-Terminal'
    const runId = 'run-destination-terminal'
    const sourceAttemptId = 'attempt-source-destination-terminal'
    const destinationAttemptId = 'attempt-destination-terminal'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426800,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425800,
                    activeAt: 426300,
                    updatedAt: 426300,
                    attemptId: sourceAttemptId,
                    attemptNumber: 1,
                    milestones: {}
                },
                [resolvedHref]: makeActiveCoordinatorRow({
                    href: resolvedHref,
                    runId,
                    attemptId: destinationAttemptId,
                    tabId: 618,
                    now: 426300
                })
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: resolvedHref, runId}),
                    targetProfileHrefs: [resolvedHref],
                    targetWorkKeys: [key, resolvedHref]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [resolvedHref]: {
                    profileHref: resolvedHref,
                    status: 'blocking',
                    runId,
                    tabId: 618,
                    actionKind: 'mute-block',
                    attemptId: destinationAttemptId,
                    attemptNumber: 1
                }
            }
        }
    })

    await sw.recordCoordinatorJobProgress(resolvedHref, {
        status: 'error',
        finalError: 'destination already failed',
        terminalAt: 426850,
        actionKind: 'mute-block',
        runId,
        tabId: 618,
        attemptId: destinationAttemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: 618
    })
    const walRecordsBefore = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )

    assert.equal(storage.mbCoordinatorQueue[resolvedHref].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[resolvedHref].status, 'failed')

    const resolved = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target',
        requestedUrl,
        coordinatorKey: key,
        profileHref: resolvedHref,
        attemptId: sourceAttemptId,
        attemptNumber: 1
    }, {
        tab: {
            id: 619,
            url: resolvedHref
        }
    })

    assert.equal(resolved.resolved, false)
    assert.equal(resolved.reason, 'terminal-resolved-coordinator-item')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[resolvedHref].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[resolvedHref].status, 'failed')
    assert.ok(walRecordsBefore.length > 0)
})

test('late profile resolution cannot overwrite a newer active destination row', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-destination-active'
    const key = `resolve-profile:${requestedUrl}`
    const resolvedHref = 'https://www.quora.com/profile/Destination-Active'
    const runId = 'run-destination-active'
    const sourceAttemptId = 'attempt-source-destination-active'
    const destinationAttemptId = 'attempt-destination-active'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426900,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425900,
                    activeAt: 426400,
                    updatedAt: 426400,
                    attemptId: sourceAttemptId,
                    attemptNumber: 1,
                    milestones: {}
                },
                [resolvedHref]: makeActiveCoordinatorRow({
                    href: resolvedHref,
                    runId,
                    attemptId: destinationAttemptId,
                    tabId: 620,
                    now: 426800
                })
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: resolvedHref, runId}),
                    targetProfileHrefs: [resolvedHref],
                    targetWorkKeys: [key, resolvedHref]
                }
            },
            mbCoordinatorEvents: []
        }
    })

    const resolved = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target',
        requestedUrl,
        coordinatorKey: key,
        profileHref: resolvedHref,
        attemptId: sourceAttemptId,
        attemptNumber: 1
    }, {
        tab: {
            id: 621,
            url: resolvedHref
        }
    })

    assert.equal(resolved.resolved, false)
    assert.equal(resolved.reason, 'resolved-coordinator-conflict')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[resolvedHref].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[resolvedHref].attemptId, destinationAttemptId)
})

test('profile resolver remap is WAL-backed and recovers moved key', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-resolver-remap-wal'
    const key = `resolve-profile:${requestedUrl}`
    const resolvedHref = 'https://www.quora.com/profile/Resolver-Remap-Wal'
    const runId = 'run-resolver-remap-wal'
    const attemptId = 'attempt-resolver-remap-wal'
    const postKey = 'post-resolver-remap-wal'
    const tabId = 6211
    const now = 426925
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: now - 1000,
                    activeAt: now - 500,
                    updatedAt: now - 500,
                    attemptId,
                    attemptNumber: 1,
                    evidence: [{postKey, postUrl: requestedUrl}],
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: [],
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: requestedUrl,
                    resolverPending: true,
                    resolverUrl: requestedUrl
                }
            }
        }
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        coordinatorKey: key,
        requestedUrl,
        profileHref: '',
        resolveProfileFromPage: true,
        resolutionMode: 'author-profile',
        tabAction: 'resolve-profile',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1
    })

    const result = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target',
        requestedUrl,
        coordinatorKey: key,
        profileHref: resolvedHref,
        attemptId,
        attemptNumber: 1
    }, {
        tab: {
            id: tabId,
            url: resolvedHref
        }
    })

    assert.equal(result.resolved, true)
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[resolvedHref], undefined)
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[key], undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[resolvedHref].status, 'active')
    assert.equal(storage.mbSpacePendingNukedPosts[postKey].resolverPending, false)
    assert.deepEqual(storage.mbSpacePendingNukedPosts[postKey].allUrls, [resolvedHref])
    assert.deepEqual(storage.mbSpacePendingNukedPosts[postKey].remainingUrls, [resolvedHref])
    const metadata = sw.state().queuedTabMetadata.find(([id]) => id === tabId)?.[1]
    assert.equal(metadata.profileHref, resolvedHref)
    assert.equal(metadata.coordinatorKey, resolvedHref)

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords[0].operationKind, 'resolver-remap')
    assert.equal(walRecords[0].kind, 'map.set')
    assert.equal(walRecords[0].key, resolvedHref)
    assert.equal(walRecords[1].operationKind, 'resolver-remap')
    assert.equal(walRecords[1].kind, 'map.remove')
    assert.equal(walRecords[1].key, key)

    const restarted = loadServiceWorkerHarness({
        now: now + 1000,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[key], undefined)
    assert.equal(hydrated.queue[resolvedHref].status, 'active')
})

test('profile resolver remap rejects queued source row before WAL append', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-resolver-remap-queued-source'
    const key = `resolve-profile:${requestedUrl}`
    const resolvedHref = 'https://www.quora.com/profile/Resolver-Remap-Queued-Source'
    const runId = 'run-resolver-remap-queued-source'
    const attemptId = 'attempt-resolver-remap-queued-source'
    const tabId = 62115
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426927,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425927,
                    updatedAt: 425927,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: []
        }
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        coordinatorKey: key,
        requestedUrl,
        profileHref: '',
        resolveProfileFromPage: true,
        resolutionMode: 'author-profile',
        tabAction: 'resolve-profile',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1
    })

    const result = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target',
        requestedUrl,
        coordinatorKey: key,
        profileHref: resolvedHref,
        attemptId,
        attemptNumber: 1
    }, {
        tab: {
            id: tabId,
            url: resolvedHref
        }
    })

    assert.equal(result.resolved, false)
    assert.equal(result.reason, 'inactive-coordinator-item')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[resolvedHref], undefined)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[key].status, 'queued')
    assert.equal(currentAuthority.queue[resolvedHref], undefined)
    const metadata = sw.state().queuedTabMetadata.find(([id]) => id === tabId)?.[1]
    assert.equal(metadata.coordinatorKey, key)
    assert.equal(metadata.profileHref, '')
})

test('profile resolver remap rejects missing incoming attempt identity before WAL append', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-resolver-remap-missing-attempt'
    const key = `resolve-profile:${requestedUrl}`
    const resolvedHref = 'https://www.quora.com/profile/Resolver-Remap-Missing-Attempt'
    const runId = 'run-resolver-remap-missing-attempt'
    const attemptId = 'attempt-resolver-remap-missing-attempt'
    const tabId = 62116
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426928,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425928,
                    activeAt: 426428,
                    updatedAt: 426428,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: []
        }
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        coordinatorKey: key,
        requestedUrl,
        profileHref: '',
        resolveProfileFromPage: true,
        resolutionMode: 'author-profile',
        tabAction: 'resolve-profile',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1
    })

    const result = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target',
        requestedUrl,
        coordinatorKey: key,
        profileHref: resolvedHref
    }, {
        tab: {
            id: tabId,
            url: resolvedHref
        }
    })

    assert.equal(result.resolved, false)
    assert.equal(result.reason, 'missing-attempt-identity')
    assert.equal(result.staleAttempt, true)
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[resolvedHref], undefined)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[key].status, 'active')
    assert.equal(currentAuthority.queue[resolvedHref], undefined)
    const metadata = sw.state().queuedTabMetadata.find(([id]) => id === tabId)?.[1]
    assert.equal(metadata.coordinatorKey, key)
    assert.equal(metadata.profileHref, '')
})

test('profile resolver remap WAL append failure leaves resolver row and runtime metadata unchanged', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-resolver-remap-append-failure'
    const key = `resolve-profile:${requestedUrl}`
    const resolvedHref = 'https://www.quora.com/profile/Resolver-Remap-Append-Failure'
    const runId = 'run-resolver-remap-append-failure'
    const attemptId = 'attempt-resolver-remap-append-failure'
    const postKey = 'post-resolver-remap-append-failure'
    const tabId = 6212
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426930,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425930,
                    activeAt: 426430,
                    updatedAt: 426430,
                    attemptId,
                    attemptNumber: 1,
                    evidence: [{postKey, postUrl: requestedUrl}],
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: [],
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: requestedUrl,
                    resolverPending: true,
                    resolverUrl: requestedUrl
                }
            }
        }
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        coordinatorKey: key,
        requestedUrl,
        profileHref: '',
        resolveProfileFromPage: true,
        resolutionMode: 'author-profile',
        tabAction: 'resolve-profile',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1
    }, {
        action: 'resolve-profile',
        targetUrl: '',
        coordinatorKey: key,
        requestedUrl,
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic resolver remap WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target',
        requestedUrl,
        coordinatorKey: key,
        profileHref: resolvedHref,
        attemptId,
        attemptNumber: 1
    }, {
        tab: {
            id: tabId,
            url: resolvedHref
        }
    })

    assert.equal(result.resolved, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[resolvedHref], undefined)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey].resolverPending, true)
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[key].status, 'active')
    assert.equal(currentAuthority.queue[resolvedHref], undefined)
    const metadata = sw.state().queuedTabMetadata.find(([id]) => id === tabId)?.[1]
    assert.equal(metadata.coordinatorKey, key)
    assert.equal(metadata.profileHref, '')
})

test('profile resolver remap derived save failure does not poison WAL remap', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-resolver-remap-derived-failure'
    const key = `resolve-profile:${requestedUrl}`
    const resolvedHref = 'https://www.quora.com/profile/Resolver-Remap-Derived-Failure'
    const runId = 'run-resolver-remap-derived-failure'
    const attemptId = 'attempt-resolver-remap-derived-failure'
    const postKey = 'post-resolver-remap-derived-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426940,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425940,
                    activeAt: 426440,
                    updatedAt: 426440,
                    attemptId,
                    attemptNumber: 1,
                    evidence: [{postKey, postUrl: requestedUrl}],
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: [],
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: requestedUrl,
                    resolverPending: true,
                    resolverUrl: requestedUrl
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbSpacePendingNukedPosts) {
            throw new Error('synthetic resolver remap derived save failure')
        }
        return originalSet(payload)
    }

    const result = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target',
        requestedUrl,
        coordinatorKey: key,
        profileHref: resolvedHref,
        attemptId,
        attemptNumber: 1
    }, {
        tab: {
            id: 6213,
            url: resolvedHref
        }
    })

    assert.equal(result.resolved, true)
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[key], undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[resolvedHref].status, 'active')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey].resolverPending, true)
    assert.equal(sw.state().queueWakeupCounters['resolver.resolve.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )

    browser.storage.local.set = originalSet
    const repair = await sw.repairCoordinatorStorageFromProgress()

    assert.equal(repair.pendingPostsChanged, true)
    assert.notEqual(storage.mbSpacePendingNukedPosts[postKey]?.resolverPending, true)
    if(storage.mbSpacePendingNukedPosts[postKey]) {
        assert.deepEqual(storage.mbSpacePendingNukedPosts[postKey].allUrls, [resolvedHref])
    }
})

test('late unresolved resolver failure cannot regress a WAL-terminal resolver row', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-key-only-late-unresolved'
    const key = `resolve-profile:${requestedUrl}`
    const runId = 'run-key-only-late-unresolved'
    const attemptId = 'attempt-key-only-late-unresolved'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426950,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425950,
                    activeAt: 426450,
                    updatedAt: 426450,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: []
        }
    })

    await sw.terminalizeCoordinatorKeyOnlyItem(key, {
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reason: 'synthetic-key-only-late-unresolved',
        now: 426950
    })
    const walRecordsBefore = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )

    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'failed')

    const unresolved = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target-failed',
        requestedUrl,
        coordinatorKey: key,
        attemptId,
        attemptNumber: 1,
        error: 'late unresolved synthetic failure'
    }, {
        tab: {
            id: 622,
            url: requestedUrl
        }
    })
    const walRecordsAfter = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )

    assert.equal(unresolved.recorded, false)
    assert.equal(unresolved.reason, 'terminal-coordinator-item')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'failed')
    assert.equal(storage.mbCoordinatorEvents.length, 1)
    assert.equal(walRecordsAfter.length, walRecordsBefore.length)
})

test('unresolved resolver terminalization is WAL-backed and recovers after restart', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-unresolved-wal'
    const key = `resolve-profile:${requestedUrl}`
    const runId = 'run-unresolved-wal'
    const attemptId = 'attempt-unresolved-wal'
    const postKey = 'post-unresolved-wal'
    const now = 426975
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: now - 1000,
                    activeAt: now - 500,
                    updatedAt: now - 500,
                    attemptId,
                    attemptNumber: 1,
                    evidence: [{postKey, postUrl: requestedUrl}],
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: [],
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: requestedUrl,
                    resolverPending: true,
                    resolverUrl: requestedUrl
                }
            }
        }
    })

    const result = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target-failed',
        requestedUrl,
        coordinatorKey: key,
        attemptId,
        attemptNumber: 1,
        error: 'synthetic unresolved target'
    }, {
        tab: {
            id: 623,
            url: requestedUrl
        }
    })

    assert.equal(result.recorded, true)
    assert.equal(result.status, 'skipped')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueueView.counts.skipped, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'skipped')
    assert.equal(storage.mbCoordinatorEvents.length, 1)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey], undefined)

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'resolver-unresolved')

    const restarted = loadServiceWorkerHarness({
        now: now + 1000,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[key].status, 'skipped')
    assert.equal(hydrated.queue[key].actionLeaseReleaseReason, 'unresolved-resolution')
})

test('unresolved resolver WAL append failure leaves row active', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-unresolved-append-failure'
    const key = `resolve-profile:${requestedUrl}`
    const runId = 'run-unresolved-append-failure'
    const attemptId = 'attempt-unresolved-append-failure'
    const postKey = 'post-unresolved-append-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426980,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425980,
                    activeAt: 426480,
                    updatedAt: 426480,
                    attemptId,
                    attemptNumber: 1,
                    evidence: [{postKey, postUrl: requestedUrl}],
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: [],
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: requestedUrl,
                    resolverPending: true,
                    resolverUrl: requestedUrl
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic resolver unresolved WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target-failed',
        requestedUrl,
        coordinatorKey: key,
        attemptId,
        attemptNumber: 1,
        error: 'synthetic unresolved append failure'
    }, {
        tab: {
            id: 624,
            url: requestedUrl
        }
    })

    assert.equal(result.recorded, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(storage.mbCoordinatorEvents.length, 0)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey].resolverPending, true)
})

test('unresolved resolver rejects non-resolution active row before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Not-Resolver-Unresolved'
    const runId = 'run-not-resolver-unresolved'
    const attemptId = 'attempt-not-resolver-unresolved'
    const tabId = 6241
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426982,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 426982})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target-failed',
        requestedUrl: href,
        coordinatorKey: href,
        attemptId,
        attemptNumber: 1,
        error: 'synthetic non-resolver unresolved'
    }, {
        tab: {
            id: tabId,
            url: href
        }
    })

    assert.equal(result.recorded, false)
    assert.equal(result.reason, 'not-profile-resolution-item')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
})

test('unresolved resolver derived save failure does not poison WAL terminalization', async () => {
    const requestedUrl = 'https://www.quora.com/q/example/post-unresolved-derived-failure'
    const key = `resolve-profile:${requestedUrl}`
    const runId = 'run-unresolved-derived-failure'
    const attemptId = 'attempt-unresolved-derived-failure'
    const postKey = 'post-unresolved-derived-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 426985,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    resolveProfileFromPage: true,
                    resolutionMode: 'author-profile',
                    queuedAt: 425985,
                    activeAt: 426485,
                    updatedAt: 426485,
                    attemptId,
                    attemptNumber: 1,
                    evidence: [{postKey, postUrl: requestedUrl}],
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: [],
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: requestedUrl,
                    resolverPending: true,
                    resolverUrl: requestedUrl
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbSpacePendingNukedPosts) {
            throw new Error('synthetic resolver unresolved derived save failure')
        }
        return originalSet(payload)
    }

    const result = await browser.runtime.sendMessage({
        action: 'resolve-queued-profile-target-failed',
        requestedUrl,
        coordinatorKey: key,
        attemptId,
        attemptNumber: 1,
        error: 'synthetic unresolved derived failure'
    }, {
        tab: {
            id: 625,
            url: requestedUrl
        }
    })

    assert.equal(result.recorded, true)
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'skipped')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(storage.mbCoordinatorEvents.length, 1)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey].resolverPending, true)
    assert.equal(sw.state().queueWakeupCounters['resolverUnresolved.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )

    browser.storage.local.set = originalSet
    const repair = await sw.repairCoordinatorStorageFromProgress()

    assert.equal(repair.pendingPostsChanged, true)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey], undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'skipped')
})

test('key-only terminalization rejects stale attempt before authority save', async () => {
    const key = 'resolve-profile:https://www.quora.com/q/example/post-key-only-stale'
    const requestedUrl = 'https://www.quora.com/q/example/post-key-only-stale'
    const runId = 'run-key-only-stale'
    const attemptId = 'attempt-key-only-stale'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 427000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    queuedAt: 426000,
                    activeAt: 426500,
                    updatedAt: 426500,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: []
        }
    })

    const result = await sw.terminalizeCoordinatorKeyOnlyItem(key, {
        expectedAttemptId: 'stale-key-only-attempt',
        expectedAttemptNumber: 1,
        reason: 'synthetic-key-only-stale',
        now: 427000
    })

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'attempt-changed')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorEvents.length, 0)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
})

test('key-only terminalization WAL append failure leaves row active', async () => {
    const key = 'resolve-profile:https://www.quora.com/q/example/post-key-only-append-failure'
    const requestedUrl = 'https://www.quora.com/q/example/post-key-only-append-failure'
    const runId = 'run-key-only-append-failure'
    const attemptId = 'attempt-key-only-append-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 428000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    queuedAt: 427000,
                    activeAt: 427500,
                    updatedAt: 427500,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: []
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic key-only authority WAL failure')
        }
        return originalSet(payload)
    }

    const result = await sw.terminalizeCoordinatorKeyOnlyItem(key, {
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reason: 'synthetic-key-only-append-failure',
        now: 428000
    })

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorEvents.length, 0)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
})

test('key-only terminalization projection failure does not poison WAL terminalization', async () => {
    const key = 'resolve-profile:https://www.quora.com/q/example/post-key-only-projection-failure'
    const requestedUrl = 'https://www.quora.com/q/example/post-key-only-projection-failure'
    const runId = 'run-key-only-projection-failure'
    const attemptId = 'attempt-key-only-projection-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 428500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    queuedAt: 427500,
                    activeAt: 428000,
                    updatedAt: 428000,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: []
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueView) {
            throw new Error('synthetic key-only projection save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.terminalizeCoordinatorKeyOnlyItem(key, {
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reason: 'synthetic-key-only-projection-failure',
        now: 428500
    })

    assert.equal(result.changed, true)
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'failed')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)

    const restarted = loadServiceWorkerHarness({
        now: 428800,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[key].status, 'failed')
})

test('key-only terminalization derived failure does not poison authority terminalization', async () => {
    const key = 'resolve-profile:https://www.quora.com/q/example/post-key-only-derived-failure'
    const requestedUrl = 'https://www.quora.com/q/example/post-key-only-derived-failure'
    const runId = 'run-key-only-derived-failure'
    const attemptId = 'attempt-key-only-derived-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 429000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [key]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'resolve-profile',
                    requestedUrl,
                    dedupeKey: key,
                    coordinatorKey: key,
                    queuedAt: 428000,
                    activeAt: 428500,
                    updatedAt: 428500,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href: key, runId}),
                    targetProfileHrefs: [],
                    targetWorkKeys: [key]
                }
            },
            mbCoordinatorEvents: []
        }
    })
    let walSaved = false
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            walSaved = true
        }
        if(walSaved &&
            !payload?.mbCoordinatorQueueWal &&
            payload?.mbCoordinatorEvents?.some(event => event?.details?.reason === 'synthetic-key-only-derived-failure')) {
            throw new Error('synthetic key-only derived save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.terminalizeCoordinatorKeyOnlyItem(key, {
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reason: 'synthetic-key-only-derived-failure',
        now: 429000
    })

    assert.equal(result.changed, true)
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.ok(storage.mbCoordinatorQueueWal)
    assert.equal(
        storage.mbCoordinatorEvents.some(event => event?.details?.reason === 'synthetic-key-only-derived-failure'),
        false
    )
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'failed')
    assert.equal(sw.state().queueWakeupCounters['repair.keyOnlyTerminalize.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasStoredWorkRepairTimeout ||
            (sw.state().queueWakeupCounters['repair.deferredBeforeQuora'] || 0) >= 1
    )

    browser.storage.local.set = originalSet
    const repair = await sw.repairCoordinatorStorageFromProgress()
    assert.equal(repair.eventsChanged, true)
    assert.equal(repair.runsChanged, true)
    assert.equal(
        storage.mbCoordinatorEvents.some(event => event?.itemId === key && event?.details?.coordinatorKey === key),
        true
    )
    assert.equal(storage.mbCoordinatorRuns[runId].status, 'complete')
    assert.equal(storage.mbCoordinatorRuns[runId].terminalCount, 1)
})

test('repair applies terminal error progress to active service-worker row', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Error'
    const runId = 'run-terminal-error'
    const attemptId = 'attempt-terminal-error'
    const tabId = 322
    const {sw, storage, timers} = loadServiceWorkerHarness({
        now: 400000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 300000,
                    activeAt: 350000,
                    updatedAt: 350000,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'error',
                    runId,
                    tabId,
                    updatedAt: 390000,
                    terminalAt: 390000,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    finalError: 'Profile actions not ready'
                }
            }
        }
    })

    await settleWithFakeTimers(sw.runStoredWorkRepairTick('terminal-error-test'), timers)

    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[href].outcome, 'action-error')
    assert.equal(storage.mbCoordinatorQueue[href].error, 'Profile actions not ready')
    assert.match(storage.mbProfileNukeProgress[href].status, /^(?:error|interrupted)$/)
    assert.equal(storage.mbProfileNukeProgress[href].finalError, 'Profile actions not ready')
})

test('stored-work repair scheduler keeps the earliest requested deadline', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 1000})

    sw.scheduleStoredWorkRepair(5000, {allowBeforeQuora: true})
    assert.equal(sw.state().storedWorkRepairDueAt, 6000)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [6000])

    sw.scheduleStoredWorkRepair(1000, {allowBeforeQuora: true})
    assert.equal(sw.state().storedWorkRepairDueAt, 2000)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [2000])
    assert.equal(browser.__alarmCreates.at(-1).name, 'mb-stored-work-repair')
    assert.equal(browser.__alarmCreates.at(-1).info.when, 2000)

    sw.scheduleStoredWorkRepair(5000)
    assert.equal(sw.state().storedWorkRepairDueAt, 2000)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [2000])
})

test('stored-work repair scheduler coalesces and backs off no-op repair', async () => {
    const {sw, timers} = loadServiceWorkerHarness({now: 0})

    await settleWithFakeTimers(sw.runStoredWorkRepairTick('noop-repair-backoff'), timers)
    const backoffState = sw.state()
    assert.ok(backoffState.storedWorkRepairBackoffLevel > 0)
    assert.ok(backoffState.storedWorkRepairBackoffUntil > timers.now)

    assert.equal(sw.scheduleStoredWorkRepair(1000, {
        allowBeforeQuora: true,
        reason: 'periodic-watchdog'
    }), true)
    assert.equal(sw.state().storedWorkRepairDueAt, backoffState.storedWorkRepairBackoffUntil)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [backoffState.storedWorkRepairBackoffUntil])

    assert.equal(sw.scheduleStoredWorkRepair(3000, {
        allowBeforeQuora: true,
        reason: 'periodic-watchdog'
    }), false)
    assert.equal(sw.state().storedWorkRepairDueAt, backoffState.storedWorkRepairBackoffUntil)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [backoffState.storedWorkRepairBackoffUntil])

    assert.equal(sw.scheduleStoredWorkRepair(1000, {
        allowBeforeQuora: true,
        reason: 'dashboard-repair-request'
    }), true)
    assert.equal(sw.state().storedWorkRepairBackoffLevel, 0)
    assert.equal(sw.state().storedWorkRepairBackoffUntil, 0)
    const edgeTriggeredDueAt = timers.now + 1000
    assert.equal(sw.state().storedWorkRepairDueAt, edgeTriggeredDueAt)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [edgeTriggeredDueAt])
})

test('storage update timeout does not advance the serialized tail before real completion', async () => {
    const {sw, timers} = loadServiceWorkerHarness({now: 0})
    let secondRan = false
    let finishFirst = null

    const first = sw.enqueueSpaceFeedStorageUpdate(
        () => new Promise(resolve => {
            finishFirst = () => resolve('first-late-ok')
        }),
        {timeoutMs: 1000, failureValue: 'timed-out'}
    )

    await flushAsync(20)
    assert.equal(typeof finishFirst, 'function')
    await timers.tick(1000)
    assert.equal(await first, 'timed-out')

    const second = sw.enqueueSpaceFeedStorageUpdate(
        () => {
            secondRan = true
            return 'second-ok'
        },
        {timeoutMs: 1000}
    )

    await Promise.resolve()
    await timers.tick(999)
    assert.equal(secondRan, false)
    await timers.tick(1)
    assert.equal(await second, false)
    assert.equal(secondRan, false)

    finishFirst()
    await flushAsync(20)
    assert.equal(secondRan, false)

    let thirdRan = false
    const third = sw.enqueueSpaceFeedStorageUpdate(
        () => {
            thirdRan = true
            return 'third-ok'
        },
        {timeoutMs: 1000}
    )
    assert.equal(await third, 'third-ok')
    assert.equal(thirdRan, true)
})

test('abandoned storage update suppresses direct metric storage writes', async () => {
    const {sw, storage, timers} = loadServiceWorkerHarness({now: 0})
    let finishFirst = null
    let lateWriteResult = 'not-run'

    const first = sw.enqueueSpaceFeedStorageUpdate(
        async () => {
            await new Promise(resolve => {
                finishFirst = resolve
            })
            lateWriteResult = await sw.metricStorageSet({mbAbandonedWriteProbe: 'late'})
            return 'first-late-ok'
        },
        {timeoutMs: 1000, failureValue: 'timed-out'}
    )

    await flushAsync(20)
    assert.equal(typeof finishFirst, 'function')
    await timers.tick(1000)
    assert.equal(await first, 'timed-out')
    assert.equal(storage.mbAbandonedWriteProbe, undefined)

    finishFirst()
    await flushAsync(20)

    assert.equal(lateWriteResult, false)
    assert.equal(storage.mbAbandonedWriteProbe, undefined)
})

test('queue save writes bounded compact dashboard queue view', async () => {
    const {sw, storage} = loadServiceWorkerHarness({now: 1000})
    const queue = {}

    for(let index = 0; index < 120; index += 1) {
        const status = index < 3 ? 'queued' : index < 5 ? 'active' : index < 8 ? 'failed' : 'succeeded'
        const href = `https://www.quora.com/profile/Storage-View-${index}`
        queue[href] = {
            id: `job-${index}`,
            runId: 'run-storage-view',
            status,
            serviceWorkerOwned: index < 5,
            executorOwner: index < 5 ? 'service-worker' : '',
            outcome: status === 'succeeded' ? 'blocked' : '',
            error: status === 'failed' ? 'synthetic failure' : '',
            targetProfileHref: href,
            queuedAt: 1000 + index,
            activeAt: status === 'succeeded' ? 1500 + index : 0,
            updatedAt: 2000 + index,
            terminalAt: status === 'succeeded' || status === 'failed' ? 3000 + index : 0
        }
    }

    await sw.saveCoordinatorState(
        {queue},
        {queue: true, reason: 'ordinaryMutation', queueOperation: 'enqueue', queueChangedRows: 5}
    )

    const view = storage.mbCoordinatorQueueView
    assert.ok(view)
    assert.equal(storage.mbCoordinatorQueue['https://www.quora.com/profile/Storage-View-0'].status, 'queued')
    assert.equal(view.version, 1)
    assert.equal(view.total, 120)
    assert.equal(view.truncated, true)
    assert.equal(view.items.length, 80)
    assert.equal(view.counts.queued, 3)
    assert.equal(view.counts.active, 2)
    assert.equal(view.counts.failed, 3)
    assert.equal(view.counts.succeeded, 112)
    assert.equal(view.authoritativeCounts.queued, 3)
    assert.equal(view.authoritativeCounts.active, 2)
    assert.equal(view.hasAuthoritativeStoredWork, true)
    assert.equal(view.actualBlockTiming.epochStartedAt, 1000)
    assert.equal(view.actualBlockTiming.blocks, 100)
    assert.equal(view.actualBlockTiming.elapsedMs, 150000)
    assert.equal(view.actualBlockTiming.seconds, 1.5)
    assert.equal(view.items[0].status, 'active')
    assert.ok(view.items.every(item => item.storageKey && item.targetProfileHref))

    const counters = sw.state().queueWakeupCounters
    assert.ok(counters['storagePayload.write.queueView.bytes'] > 0)
    assert.ok(counters['storagePayload.write.path.reason.ordinaryMutation.bytes'] > 0)
    assert.equal(counters['storagePayload.write.path.reason.ordinaryMutation.calls'], 1)
    assert.equal(counters['queueWrite.operation.enqueue.calls'], 1)
    assert.equal(counters['queueWrite.reason.ordinaryMutation.operation.enqueue.calls'], 1)
    assert.equal(counters['queueWrite.reason.ordinaryMutation.operation.enqueue.rows'], 120)
    assert.equal(counters['queueWrite.reason.ordinaryMutation.operation.enqueue.changedRows'], 5)
    assert.ok(counters['queueWrite.reason.ordinaryMutation.operation.enqueue.bytes'] > 0)
})

test('direct raw queue storage writes maintain compact queue view', async () => {
    const {sw, storage} = loadServiceWorkerHarness({now: 2000})
    const queuedHref = 'https://www.quora.com/profile/Direct-Queue-Write'
    const legacyHref = 'https://www.quora.com/profile/Direct-Legacy-Write'

    await sw.metricStorageSet({
        mbCoordinatorQueue: {
            [queuedHref]: {
                id: 'direct-queued',
                status: 'queued',
                serviceWorkerOwned: true,
                executorOwner: 'service-worker',
                targetProfileHref: queuedHref,
                queuedAt: 2000,
                updatedAt: 2000
            },
            [legacyHref]: {
                id: 'direct-legacy',
                status: 'queued',
                targetProfileHref: legacyHref,
                queuedAt: 2000,
                updatedAt: 2000
            }
        }
    }, {metricPath: 'directQueueWrite'})

    assert.equal(storage.mbCoordinatorQueueView.version, 1)
    assert.equal(storage.mbCoordinatorQueueView.total, 2)
    assert.equal(storage.mbCoordinatorQueueView.counts.queued, 2)
    assert.equal(storage.mbCoordinatorQueueView.authoritativeCounts.queued, 1)
    assert.equal(storage.mbCoordinatorQueueView.hasAuthoritativeStoredWork, true)
    assert.equal(storage.mbCoordinatorContentQueueIndex.version, 2)
    assert.equal(storage.mbCoordinatorContentQueueIndex.indexed, 2)
})

test('coordinator authority hydrates resident projection without storage writes', async () => {
    const href = 'https://www.quora.com/profile/Authority-Hydrate'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 3000,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-hydrate-row',
                    status: 'queued',
                    attemptId: 'attempt-hydrate',
                    attemptNumber: 1,
                    targetProfileHref: href,
                    updatedAt: 3000
                }
            },
            mbCoordinatorRuns: {
                'run-authority-hydrate': {
                    id: 'run-authority-hydrate',
                    queued: 1
                }
            },
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    attemptId: 'attempt-hydrate',
                    updatedAt: 3000
                }
            }
        }
    })

    assert.equal(sw.coordinatorAuthority.isHydrated(), false)
    const hydrated = await sw.coordinatorAuthority.hydrate()
    const current = sw.coordinatorAuthority.current()

    assert.equal(sw.coordinatorAuthority.isHydrated(), true)
    assert.equal(hydrated.queue[href].id, 'authority-hydrate-row')
    assert.equal(current.queue[href].attemptId, 'attempt-hydrate')
    assert.equal(current.runs['run-authority-hydrate'].queued, 1)
    assert.equal(current.progress[href].status, 'queued')

    current.queue[href].status = 'mutated-outside-authority'
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.state().queueWakeupCounters.storageSetCalls, undefined)
})

test('coordinator authority no-op apply is durable without snapshot write', async () => {
    const href = 'https://www.quora.com/profile/Authority-Noop'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 4000,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-noop-row',
                    status: 'active',
                    attemptId: 'attempt-noop',
                    attemptNumber: 2,
                    targetProfileHref: href,
                    updatedAt: 4000
                }
            }
        }
    })

    await sw.coordinatorAuthority.hydrate()
    const result = await sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-noop',
        rowKey: href,
        expectedAttemptId: 'attempt-noop',
        expectedAttemptNumber: 2,
        mutate(row) {
            return row
        }
    })

    assert.equal(result.accepted, true)
    assert.equal(result.changed, false)
    assert.equal(result.durable, true)
    assert.equal(result.persistence.backend, 'snapshot')
    assert.equal(result.persistence.saved, false)
    assert.equal(result.persistence.noOp, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.state().queueWakeupCounters.storageSetCalls, undefined)
})

test('coordinator authority apply persists accepted row change', async () => {
    const href = 'https://www.quora.com/profile/Authority-Changed'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 5000,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-changed-row',
                    status: 'active',
                    attemptId: 'attempt-change',
                    attemptNumber: 3,
                    targetProfileHref: href,
                    updatedAt: 5000
                }
            }
        }
    })

    await sw.coordinatorAuthority.hydrate()
    const result = await sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-row-change',
        rowKey: href,
        expectedAttemptId: 'attempt-change',
        expectedAttemptNumber: 3,
        reason: 'ordinaryMutation',
        mutate(row, context) {
            return {
                ...row,
                status: 'failed',
                error: 'synthetic failure',
                terminalAt: context.now,
                updatedAt: context.now
            }
        }
    })

    assert.equal(result.accepted, true)
    assert.equal(result.changed, true)
    assert.equal(result.durable, true)
    assert.equal(result.persistence.saved, true)
    assert.equal(result.previousRow.status, 'active')
    assert.equal(result.nextRow.status, 'failed')
    assert.equal(result.operation.operationKind, 'synthetic-row-change')
    assert.equal(result.operation.rowKey, href)
    assert.equal(result.operation.previousRow.status, 'active')
    assert.equal(result.operation.nextRow.status, 'failed')
    assert.equal(result.operation.durable, true)
    assert.equal(result.shadowWal.checked, true)
    assert.equal(result.shadowWal.matched, true)
    assert.equal(result.shadowWal.record.kind, 'map.set')
    assert.equal(result.shadowWal.record.area, 'queue')
    assert.equal(result.shadowWal.record.key, href)
    assert.equal(result.shadowWal.record.operationKind, 'synthetic-row-change')
    assert.equal(result.shadowWal.projectedRow.status, 'failed')
    assert.equal(result.shadowWal.append.appended, true)
    assert.equal(result.shadowWal.append.records.length, 1)
    assert.equal(result.shadowWal.append.matched, 1)
    assert.equal(result.shadowWal.append.mismatched, 0)
    assert.equal(result.shadowWal.append.totalRecords, 1)
    const authorityShadowWalRecords = getWalRecordsForGeneration(
        sw.state().coordinatorAuthorityShadowWalStore,
        result.shadowWal.append.generationId
    )
    assert.equal(authorityShadowWalRecords.length, 1)
    assert.equal(authorityShadowWalRecords[0].area, 'queue')
    assert.equal(authorityShadowWalRecords[0].key, href)
    assert.equal(authorityShadowWalRecords[0].status, 'failed')
    const recoveredShadow = recoverProjectedState(sw.state().coordinatorAuthorityShadowWalStore)
    assert.equal(recoveredShadow.recovered, true)
    assert.equal(recoveredShadow.projected.state.queue[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[href].error, 'synthetic failure')
    assert.equal(storage.mbCoordinatorQueueView.counts.failed, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'failed')

    const counters = sw.state().queueWakeupCounters
    assert.equal(counters.storageSetCalls, 1)
    assert.equal(counters['storageUpdate.started'], 1)
    assert.equal(counters['queueWrite.operation.synthetic-row-change.calls'], 1)
    assert.equal(counters['queueWrite.reason.ordinaryMutation.operation.synthetic-row-change.changedRows'], 1)
    assert.equal(counters['coordinatorAuthority.shadowWal.checked'], 1)
    assert.equal(counters['coordinatorAuthority.shadowWal.matched'], 1)
    assert.equal(counters['coordinatorAuthority.shadowWal.mismatched'] || 0, 0)
    assert.equal(counters['coordinatorAuthority.shadowWal.appended'], 1)
    assert.equal(counters['coordinatorAuthority.shadowWal.appendBatches'], 1)
    assert.equal(counters['coordinatorAuthority.shadowWal.appendProjectionMatched'], 1)
    assert.equal(counters['coordinatorAuthority.shadowWal.appendProjectionMismatched'] || 0, 0)
    assert.ok(counters['coordinatorAuthority.shadowWal.bytes'] > 0)
})

test('coordinator authority shadow WAL append uses bounded incremental replay', async () => {
    const expectedRetentionLimit = 128
    const iterations = expectedRetentionLimit + 12
    const hrefs = Array.from(
        {length: iterations},
        (_, index) => `https://www.quora.com/profile/Authority-Bounded-Shadow-Wal-${index}`
    )
    const {sw, storage} = loadServiceWorkerHarness({
        now: 5050,
        storage: {
            mbCoordinatorQueue: Object.fromEntries(hrefs.map((href, index) => [
                href,
                {
                    id: `authority-bounded-${index}`,
                    status: 'active',
                    attemptId: `attempt-bounded-${index}`,
                    attemptNumber: 1,
                    targetProfileHref: href,
                    updatedAt: 5050
                }
            ]))
        }
    })

    await sw.coordinatorAuthority.hydrate()
    let last = null
    for(let index = 0; index < iterations; index += 1) {
        const href = hrefs[index]
        last = await sw.coordinatorAuthority.apply({
            operationKind: 'synthetic-bounded-row-change',
            rowKey: href,
            expectedAttemptId: `attempt-bounded-${index}`,
            expectedAttemptNumber: 1,
            reason: 'ordinaryMutation',
            mutate(row, context) {
                return {
                    ...row,
                    status: 'failed',
                    error: `synthetic bounded failure ${index}`,
                    terminalAt: context.now,
                    updatedAt: context.now
                }
            }
        })
        assert.equal(last.accepted, true)
        assert.equal(last.durable, true)
        assert.equal(last.shadowWal.checked, true)
        assert.equal(last.shadowWal.matched, true)
        assert.equal(last.shadowWal.append.records.length, 1)
        assert.equal(last.shadowWal.append.matched, 1)
        assert.equal(last.shadowWal.append.mismatched, 0)
    }

    const counters = sw.state().queueWakeupCounters
    const retainedRecords = getWalRecordsForGeneration(
        sw.state().coordinatorAuthorityShadowWalStore,
        sw.state().coordinatorAuthorityShadowWalStore.meta.activeCheckpoint
    )
    const recoveredShadow = recoverProjectedState(sw.state().coordinatorAuthorityShadowWalStore)

    assert.equal(counters['coordinatorAuthority.shadowWal.appended'] || 0, iterations)
    assert.equal(counters['coordinatorAuthority.shadowWal.appendProjectionMatched'] || 0, iterations)
    assert.equal(counters['coordinatorAuthority.shadowWal.appendProjectionMismatched'] || 0, 0)
    assert.equal(counters['coordinatorAuthority.shadowWal.checkpointSwitched'] || 0, 1)
    assert.ok(retainedRecords.length <= expectedRetentionLimit)
    assert.equal(recoveredShadow.recovered, true)
    assert.equal(recoveredShadow.projected.state.queue[hrefs.at(-1)].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[hrefs.at(-1)].status, 'failed')
})

test('coordinator authority shadow WAL appends same-status mutations with distinct ids', async () => {
    const href = 'https://www.quora.com/profile/Authority-Same-Status-Shadow-Wal'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 5060,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-same-status',
                    status: 'active',
                    attemptId: 'attempt-same-status',
                    attemptNumber: 1,
                    targetProfileHref: href,
                    updatedAt: 5060
                }
            }
        }
    })

    await sw.coordinatorAuthority.hydrate()
    const first = await sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-same-status-row-change',
        rowKey: href,
        expectedAttemptId: 'attempt-same-status',
        expectedAttemptNumber: 1,
        reason: 'ordinaryMutation',
        mutate(row, context) {
            return {
                ...row,
                status: 'active',
                leaseNote: 'first same-status mutation',
                updatedAt: context.now
            }
        }
    })
    const second = await sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-same-status-row-change',
        rowKey: href,
        expectedAttemptId: 'attempt-same-status',
        expectedAttemptNumber: 1,
        reason: 'ordinaryMutation',
        mutate(row, context) {
            return {
                ...row,
                status: 'active',
                leaseNote: 'second same-status mutation',
                updatedAt: context.now
            }
        }
    })

    assert.equal(first.accepted, true)
    assert.equal(first.durable, true)
    assert.equal(first.shadowWal.matched, true)
    assert.equal(second.accepted, true)
    assert.equal(second.durable, true)
    assert.equal(second.reason, 'persisted')
    assert.equal(second.shadowWal.matched, true)
    assert.equal(second.shadowWal.append.matched, 1)
    assert.equal(second.shadowWal.append.mismatched, 0)
    assert.equal(storage.mbCoordinatorQueue[href].leaseNote, 'second same-status mutation')

    const records = getWalRecordsForGeneration(
        sw.state().coordinatorAuthorityShadowWalStore,
        sw.state().coordinatorAuthorityShadowWalStore.meta.activeCheckpoint
    )
    assert.equal(records.length, 2)
    assert.notEqual(records[0].id, records[1].id)
    assert.equal(records[0].seq, 1)
    assert.equal(records[1].seq, 2)
    assert.equal(records[0].status, 'active')
    assert.equal(records[1].status, 'active')
    assert.equal(records[1].value.leaseNote, 'second same-status mutation')
    const recoveredShadow = recoverProjectedState(sw.state().coordinatorAuthorityShadowWalStore)
    assert.equal(recoveredShadow.recovered, true)
    assert.equal(recoveredShadow.projected.state.queue[href].leaseNote, 'second same-status mutation')

    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['coordinatorAuthority.shadowWal.appended'], 2)
    assert.equal(counters['coordinatorAuthority.shadowWal.appendProjectionMatched'], 2)
    assert.equal(counters['coordinatorAuthority.shadowWal.appendProjectionMismatched'] || 0, 0)
})

test('coordinator authority shadow WAL diagnostic failure does not change durable result', async () => {
    const href = 'https://www.quora.com/profile/Authority-Shadow-Wal-Diagnostic-Failure'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 5070,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-shadow-diagnostic-failure',
                    status: 'active',
                    attemptId: 'attempt-shadow-diagnostic-failure',
                    attemptNumber: 1,
                    targetProfileHref: href,
                    updatedAt: 5070
                }
            }
        }
    })

    await sw.coordinatorAuthority.hydrate()
    sw.__testSetCoordinatorAuthorityShadowWalStore(null)
    const result = await sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-shadow-diagnostic-failure',
        rowKey: href,
        expectedAttemptId: 'attempt-shadow-diagnostic-failure',
        expectedAttemptNumber: 1,
        reason: 'ordinaryMutation',
        mutate(row, context) {
            return {
                ...row,
                status: 'failed',
                error: 'durable despite diagnostic failure',
                terminalAt: context.now,
                updatedAt: context.now
            }
        }
    })

    assert.equal(result.accepted, true)
    assert.equal(result.changed, true)
    assert.equal(result.durable, true)
    assert.equal(result.reason, 'persisted')
    assert.equal(result.persistence.saved, true)
    assert.equal(result.shadowWal.checked, true)
    assert.equal(result.shadowWal.matched, true)
    assert.equal(result.shadowWal.append.appended, false)
    assert.equal(result.shadowWal.append.reason, 'diagnostic-error')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[href].error, 'durable despite diagnostic failure')

    const counters = sw.state().queueWakeupCounters
    assert.equal(counters.storageSetCalls, 2)
    assert.equal(counters['coordinatorAuthority.shadowWal.appendFailed'], 1)
    assert.equal(counters['storageUpdate.fallbackReturned'] || 0, 0)
})

test('coordinator authority apply preserves intervening direct snapshot changes', async () => {
    const hrefA = 'https://www.quora.com/profile/Authority-Serialized-A'
    const hrefB = 'https://www.quora.com/profile/Authority-Serialized-B'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 5100,
        storage: {
            mbCoordinatorQueue: {
                [hrefA]: {
                    id: 'authority-serialized-a',
                    status: 'active',
                    attemptId: 'attempt-serialized-a',
                    attemptNumber: 1,
                    targetProfileHref: hrefA,
                    updatedAt: 5100
                },
                [hrefB]: {
                    id: 'authority-serialized-b',
                    status: 'queued',
                    attemptId: 'attempt-serialized-b',
                    attemptNumber: 1,
                    targetProfileHref: hrefB,
                    updatedAt: 5100
                }
            }
        }
    })
    const holdDirectSave = deferred()

    await sw.coordinatorAuthority.hydrate()
    const directSave = sw.enqueueSpaceFeedStorageUpdate(async () => {
        await holdDirectSave.promise
        await sw.saveCoordinatorState({
            queue: {
                [hrefA]: storage.mbCoordinatorQueue[hrefA],
                [hrefB]: {
                    ...storage.mbCoordinatorQueue[hrefB],
                    status: 'failed',
                    error: 'direct path failure',
                    updatedAt: 5101
                }
            }
        }, {
            queue: true,
            reason: 'ordinaryMutation',
            queueOperation: 'synthetic-direct-path',
            queueChangedRows: 1
        })
        return 'direct-saved'
    }, {reason: 'synthetic-direct-path'})

    await flushAsync(5)
    const authorityApply = sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-authority-after-direct',
        rowKey: hrefA,
        expectedAttemptId: 'attempt-serialized-a',
        mutate(row, context) {
            return {
                ...row,
                status: 'failed',
                error: 'authority path failure',
                updatedAt: context.now
            }
        }
    })

    await flushAsync(5)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'queued')

    holdDirectSave.resolve()
    assert.equal(await directSave, 'direct-saved')
    const result = await authorityApply

    assert.equal(result.accepted, true)
    assert.equal(result.changed, true)
    assert.equal(result.durable, true)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[hrefA].error, 'authority path failure')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[hrefB].error, 'direct path failure')
    assert.equal(sw.coordinatorAuthority.current().queue[hrefB].error, 'direct path failure')

    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['storageUpdate.started'], 2)
    assert.equal(counters['queueWrite.operation.synthetic-direct-path.calls'], 1)
    assert.equal(counters['queueWrite.operation.synthetic-authority-after-direct.calls'], 1)
})

test('coordinator authority rejects stale and explicit mutations before persistence', async () => {
    const href = 'https://www.quora.com/profile/Authority-Reject'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 6000,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-reject-row',
                    status: 'active',
                    attemptId: 'attempt-current',
                    attemptNumber: 4,
                    targetProfileHref: href,
                    updatedAt: 6000
                }
            }
        }
    })

    await sw.coordinatorAuthority.hydrate()
    const stale = await sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-stale',
        rowKey: href,
        expectedAttemptId: 'attempt-stale',
        mutate(row) {
            return {...row, status: 'failed'}
        }
    })
    const rejected = await sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-reject',
        rowKey: href,
        expectedAttemptId: 'attempt-current',
        mutate(row, context) {
            return context.reject('synthetic-policy-reject')
        }
    })

    assert.equal(stale.accepted, false)
    assert.equal(stale.changed, false)
    assert.equal(stale.durable, false)
    assert.equal(stale.staleAttempt, true)
    assert.equal(stale.reason, 'stale-attempt')
    assert.equal(rejected.accepted, false)
    assert.equal(rejected.changed, false)
    assert.equal(rejected.durable, false)
    assert.equal(rejected.reason, 'synthetic-policy-reject')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.state().queueWakeupCounters.storageSetCalls, undefined)
})

test('coordinator authority reports accepted changed mutation when snapshot persistence fails', async () => {
    const href = 'https://www.quora.com/profile/Authority-Storage-Failure'
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 7000,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-storage-failure-row',
                    status: 'active',
                    attemptId: 'attempt-storage-failure',
                    attemptNumber: 5,
                    targetProfileHref: href,
                    updatedAt: 7000
                }
            }
        }
    })

    await sw.coordinatorAuthority.hydrate()
    browser.storage.local.set = async () => {
        throw new Error('synthetic storage failure')
    }

    const result = await sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-storage-failure',
        rowKey: href,
        expectedAttemptId: 'attempt-storage-failure',
        mutate(row, context) {
            return {
                ...row,
                status: 'failed',
                error: 'storage failed',
                updatedAt: context.now
            }
        }
    })

    assert.equal(result.accepted, true)
    assert.equal(result.changed, true)
    assert.equal(result.durable, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(result.persistence.saved, false)
    assert.equal(result.operation.operationKind, 'synthetic-storage-failure')
    assert.equal(result.operation.changed, true)
    assert.equal(result.operation.durable, false)
    assert.match(result.persistence.error, /synthetic storage failure/)
    assert.equal(result.shadowWal.checked, false)
    assert.equal(result.shadowWal.matched, false)
    assert.equal(result.shadowWal.reason, 'non-durable')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['coordinatorAuthority.shadowWal.skippedNonDurable'], 1)
    assert.equal(counters['coordinatorAuthority.shadowWal.checked'] || 0, 0)
    assert.equal(counters['coordinatorAuthority.shadowWal.matched'] || 0, 0)
})

test('coordinator authority reports serialized storage timeout fallback', async () => {
    const href = 'https://www.quora.com/profile/Authority-Storage-Timeout'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 8000,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-storage-timeout-row',
                    status: 'active',
                    attemptId: 'attempt-storage-timeout',
                    attemptNumber: 6,
                    targetProfileHref: href,
                    updatedAt: 8000
                }
            }
        }
    })

    await sw.coordinatorAuthority.hydrate()
    browser.storage.local.set = async () => new Promise(() => {})

    const resultPromise = sw.coordinatorAuthority.apply({
        operationKind: 'synthetic-storage-timeout',
        rowKey: href,
        expectedAttemptId: 'attempt-storage-timeout',
        timeoutMs: 1000,
        mutate(row, context) {
            return {
                ...row,
                status: 'failed',
                error: 'storage timed out',
                updatedAt: context.now
            }
        }
    })

    await flushAsync(20)
    await timers.tick(1000)
    const result = await resultPromise

    assert.equal(result.accepted, false)
    assert.equal(result.changed, false)
    assert.equal(result.durable, false)
    assert.equal(result.reason, 'storage-update-fallback')
    assert.equal(result.persistence.saved, false)
    assert.equal(result.persistence.storageTimedOut, true)
    assert.equal(result.persistence.fallbackReturned, true)
    assert.equal(result.operation.operationKind, 'synthetic-storage-timeout')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')

    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['storageUpdate.timedOut'], 1)
    assert.equal(counters['storageUpdate.fallbackReturned'], 1)
})

test('coordinator authority reentrant apply works inside existing storage update', async () => {
    const href = 'https://www.quora.com/profile/Authority-Reentrant'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 9000,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-reentrant-row',
                    status: 'active',
                    attemptId: 'attempt-reentrant',
                    attemptNumber: 7,
                    targetProfileHref: href,
                    updatedAt: 9000
                }
            }
        }
    })

    const result = await sw.enqueueSpaceFeedStorageUpdate(
        () => sw.coordinatorAuthority.applyWithinStorageUpdate({
            operationKind: 'synthetic-reentrant',
            rowKey: href,
            expectedAttemptId: 'attempt-reentrant',
            mutate(row, context) {
                return {
                    ...row,
                    status: 'failed',
                    error: 'reentrant failure',
                    updatedAt: context.now
                }
            }
        }),
        {reason: 'synthetic-reentrant-outer'}
    )

    assert.equal(result.accepted, true)
    assert.equal(result.changed, true)
    assert.equal(result.durable, true)
    assert.equal(result.operation.operationKind, 'synthetic-reentrant')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[href].error, 'reentrant failure')

    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['storageUpdate.started'], 1)
    assert.equal(counters['storageUpdate.nested'], undefined)
    assert.equal(counters['storageUpdate.timeout.beforeStart'], undefined)
    assert.equal(counters['queueWrite.operation.synthetic-reentrant.calls'], 1)
})

test('coordinator authority rejects later stale queue save in same storage update', async () => {
    const href = 'https://www.quora.com/profile/Authority-Reentrant-Stale-Save'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 9050,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-reentrant-stale-save-row',
                    status: 'active',
                    attemptId: 'attempt-reentrant-stale-save',
                    attemptNumber: 7,
                    targetProfileHref: href,
                    updatedAt: 9050
                }
            }
        }
    })

    const result = await sw.enqueueSpaceFeedStorageUpdate(async () => {
        const staleQueue = JSON.parse(JSON.stringify(storage.mbCoordinatorQueue))
        const authorityResult = await sw.coordinatorAuthority.applyWithinStorageUpdate({
            operationKind: 'synthetic-reentrant-stale-save',
            rowKey: href,
            expectedAttemptId: 'attempt-reentrant-stale-save',
            mutate(row, context) {
                return {
                    ...row,
                    status: 'failed',
                    error: 'authority result survived',
                    updatedAt: context.now
                }
            }
        })
        const staleSave = await sw.saveCoordinatorState({
            queue: staleQueue
        }, {
            queue: true,
            reason: 'ordinaryMutation',
            queueOperation: 'synthetic-stale-save-after-authority',
            queueChangedRows: 1
        })
        return {authorityResult, staleSave}
    }, {reason: 'synthetic-reentrant-stale-save-outer'})

    assert.equal(result.authorityResult.accepted, true)
    assert.equal(result.authorityResult.changed, true)
    assert.equal(result.authorityResult.durable, true)
    assert.equal(result.staleSave, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[href].error, 'authority result survived')

    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['storageUpdate.started'], 1)
    assert.equal(counters['coordinatorAuthority.postMutationQueueSaveRejected'], 1)
    assert.equal(counters['queueWrite.operation.synthetic-reentrant-stale-save.calls'], 1)
    assert.equal(counters['queueWrite.operation.synthetic-stale-save-after-authority.calls'], undefined)
})

test('coordinator authority rejects later direct queue storage set in same storage update', async () => {
    const href = 'https://www.quora.com/profile/Authority-Reentrant-Direct-Set'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 9075,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-reentrant-direct-set-row',
                    status: 'active',
                    attemptId: 'attempt-reentrant-direct-set',
                    attemptNumber: 7,
                    targetProfileHref: href,
                    updatedAt: 9075
                }
            }
        }
    })

    const result = await sw.enqueueSpaceFeedStorageUpdate(async () => {
        const staleQueue = JSON.parse(JSON.stringify(storage.mbCoordinatorQueue))
        const authorityResult = await sw.coordinatorAuthority.applyWithinStorageUpdate({
            operationKind: 'synthetic-reentrant-direct-set',
            rowKey: href,
            expectedAttemptId: 'attempt-reentrant-direct-set',
            mutate(row, context) {
                return {
                    ...row,
                    status: 'failed',
                    error: 'direct set rejected',
                    updatedAt: context.now
                }
            }
        })
        const staleSet = await sw.metricStorageSet({
            mbCoordinatorQueue: staleQueue
        }, {
            metricPath: 'synthetic.directStaleSet',
            queueSnapshotWriteReason: 'ordinaryMutation',
            queueOperation: 'synthetic-direct-stale-set',
            queueChangedRows: 1
        })
        return {authorityResult, staleSet}
    }, {reason: 'synthetic-reentrant-direct-set-outer'})

    assert.equal(result.authorityResult.accepted, true)
    assert.equal(result.authorityResult.changed, true)
    assert.equal(result.authorityResult.durable, true)
    assert.equal(result.staleSet, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[href].error, 'direct set rejected')

    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['storageUpdate.started'], 1)
    assert.equal(counters['coordinatorAuthority.postMutationQueueStorageSetRejected'], 1)
    assert.equal(counters['queueWrite.operation.synthetic-reentrant-direct-set.calls'], 1)
    assert.equal(counters['queueWrite.operation.synthetic-direct-stale-set.calls'], undefined)
})

test('coordinator authority reentrant apply rejects outside storage update', async () => {
    const href = 'https://www.quora.com/profile/Authority-Reentrant-Outside'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 9100,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'authority-reentrant-outside-row',
                    status: 'active',
                    attemptId: 'attempt-reentrant-outside',
                    attemptNumber: 8,
                    targetProfileHref: href,
                    updatedAt: 9100
                }
            }
        }
    })

    const result = await sw.coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'synthetic-reentrant-outside',
        rowKey: href,
        expectedAttemptId: 'attempt-reentrant-outside',
        mutate(row) {
            return {
                ...row,
                status: 'failed'
            }
        }
    })

    assert.equal(result.accepted, false)
    assert.equal(result.changed, false)
    assert.equal(result.durable, false)
    assert.equal(result.reason, 'storage-update-required')
    assert.equal(result.persistence.requiresStorageUpdate, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.state().queueWakeupCounters.storageSetCalls, undefined)
})

test('storage get records compact-view read payload by call path', async () => {
    const {sw, storage} = loadServiceWorkerHarness({
        now: 1000,
        storage: {
            mbCoordinatorQueueView: {
                version: 1,
                updatedAt: 1000,
                total: 120,
                counts: {queued: 2, succeeded: 118},
                itemLimit: 80,
                truncated: true,
                items: [{storageKey: 'profile', status: 'queued', targetProfileHref: 'https://www.quora.com/profile/Profile'}]
            },
            mbCoordinatorQueue: Object.fromEntries(Array.from({length: 120}, (_, index) => [
                `profile-${index}`,
                {status: index < 2 ? 'queued' : 'succeeded'}
            ]))
        }
    })

    const stored = await sw.metricStorageGet({
        mbCoordinatorQueueView: {},
        mbQueueWakeupMetrics: {}
    }, {metricPath: 'dashboard.initial'})

    assert.equal(stored.mbCoordinatorQueue, undefined)
    assert.equal(stored.mbCoordinatorQueueView.total, 120)
    const counters = sw.state().queueWakeupCounters
    assert.ok(counters['storagePayload.read.queueView.bytes'] > 0)
    assert.equal(counters['storagePayload.read.queue.bytes'], undefined)
    assert.ok(counters['storagePayload.read.path.dashboard.initial.bytes'] > 0)
    assert.equal(counters['storagePayload.read.path.dashboard.initial.calls'], 1)
    assert.equal(counters['storagePayload.read.path.dashboard.initial.maxLatencyMs'] >= 0, true)
    assert.equal(storage.mbCoordinatorQueueView.total, 120)
})

test('legacy storage can seed compact dashboard queue view without dashboard full read', async () => {
    const hrefs = Array.from({length: 90}, (_, index) => `https://www.quora.com/profile/Legacy-View-${index}`)
    const queue = Object.fromEntries(hrefs.map((href, index) => [
        href,
        {
            id: `legacy-${index}`,
            status: index < 4 ? 'queued' : 'succeeded',
            targetProfileHref: href,
            queuedAt: 1000 + index,
            updatedAt: 2000 + index,
            terminalAt: index < 4 ? 0 : 3000 + index
        }
    ]))
    const {sw, storage} = loadServiceWorkerHarness({
        now: 1000,
        storage: {
            mbCoordinatorQueue: queue
        }
    })

    const result = await sw.refreshCoordinatorQueueViewForDashboard('test')

    assert.equal(result.refreshed, true)
    assert.equal(result.total, 90)
    assert.equal(result.view.total, 90)
    assert.equal(storage.mbCoordinatorQueueView.total, 90)
    assert.equal(storage.mbCoordinatorQueueView.items.length, 80)
    assert.equal(storage.mbCoordinatorQueueView.counts.queued, 4)
    assert.deepEqual(storage.mbCoordinatorQueue, queue)

    const counters = sw.state().queueWakeupCounters
    assert.ok(counters['storagePayload.read.queue.bytes'] > 0)
    assert.ok(counters['storagePayload.write.queueView.bytes'] > 0)
    assert.equal(counters['storagePayload.read.path.queueView.test.calls'], 1)
    assert.equal(counters['storagePayload.write.path.queueView.test.calls'], 1)
})

test('dashboard queue view refresh uses WAL terminal authority over stale raw queue', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Dashboard-View-Wal-Terminal'
    const runId = 'run-dashboard-view-wal-terminal'
    const attemptId = 'attempt-dashboard-view-wal-terminal'
    const tabId = 681
    const firstHarness = loadServiceWorkerHarness({
        now: 353000,
        storage: {
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 353000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })

    await firstHarness.sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 353100,
        terminalAt: 353100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })
    assert.equal(firstHarness.storage.mbCoordinatorQueue[href].status, 'active')

    const restarted = loadServiceWorkerHarness({
        now: 354000,
        storage: firstHarness.storage
    })
    const result = await restarted.sw.refreshCoordinatorQueueViewForDashboard('wal-terminal-audit')

    assert.equal(result.total, 1)
    assert.equal(result.view.counts.succeeded, 1)
    assert.equal(result.view.counts.active || 0, 0)
    assert.equal(restarted.storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(restarted.storage.mbCoordinatorQueueView.counts.succeeded, 1)
    assert.equal(restarted.sw.state().queueWakeupCounters['storagePayload.read.path.queueView.wal-terminal-audit.calls'], 1)
})

test('storage update default watchdog waits for the configured timeout', async () => {
    const {sw, timers} = loadServiceWorkerHarness({now: 0})
    let settled = false

    const first = sw.enqueueSpaceFeedStorageUpdate(
        () => new Promise(() => {}),
        {failureValue: 'default-timed-out'}
    ).then(value => {
        settled = true
        return value
    })

    await flushAsync(2)
    await timers.tick(sw.state().constants.SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS - 1)
    assert.equal(settled, false)

    await timers.tick(1)
    assert.equal(await first, 'default-timed-out')
    assert.equal(settled, true)
})

test('queue wakeup metric reset rolls current epoch into history and starts fresh', async () => {
    const oldEpoch = {
        epochId: 'epoch-old',
        resetReason: 'extension-updated',
        startedAt: 1000,
        updatedAt: 5000,
        extensionVersion: 'test',
        firstServiceWorkerStartedAt: 1100,
        lastServiceWorkerStartedAt: 4000,
        counters: {
            'serviceWorker.started': 1,
            'storageUpdate.started': 10,
            'storageUpdate.timedOut': 2,
            'storagePayload.write.total.bytes': 1000,
            'storagePayload.write.total.calls': 4,
            'storagePayload.write.total.maxBytes': 400,
            'repair.requested': 3,
            'repair.changed.queue': 2,
            'pump.requested': 5,
            'pump.changed.openedTab': 2,
            'nudge.sent': 4,
            'nudge.accepted': 1,
            'job.enqueued': 7,
            'job.terminal': 6,
            'job.completedOnlyAfterRepair': 2
        },
        phases: {},
        journal: [{
            kind: 'storage',
            name: 'old-storage',
            at: 4500
        }]
    }
    const {sw, storage} = loadServiceWorkerHarness({
        now: 10000,
        storage: {
            mbQueueWakeupMetrics: {
                version: 4,
                currentEpoch: oldEpoch,
                previousEpochs: [],
                lifetime: {
                    startedAt: 1000,
                    updatedAt: 5000,
                    resetCount: 0,
                    counters: {
                        'job.enqueued': 1
                    }
                }
            }
        }
    })

    await sw.resetQueueWakeupMetricsEpochAfterLoad('browser-startup')
    const metrics = storage.mbQueueWakeupMetrics
    const current = metrics.currentEpoch
    const previous = metrics.previousEpochs.at(-1)

    assert.equal(metrics.version, 4)
    assert.equal(previous.epochId, 'epoch-old')
    assert.equal(previous.rolloverReason, 'browser-startup')
    assert.equal(previous.storage.started, 10)
    assert.equal(previous.storage.timedOut, 2)
    assert.equal(previous.storage.timeoutRate, 0.2)
    assert.equal(previous.storagePayload.writeBytes, 1000)
    assert.equal(previous.storagePayload.writeCalls, 4)
    assert.equal(previous.repair.requested, 3)
    assert.equal(previous.repair.changed, 2)
    assert.equal(previous.pump.requested, 5)
    assert.equal(previous.pump.changed, 2)
    assert.equal(previous.nudge.sent, 4)
    assert.equal(previous.nudge.accepted, 1)
    assert.equal(previous.jobs.enqueued, 7)
    assert.equal(previous.jobs.terminal, 6)
    assert.equal(previous.jobs.completedAfterRepair, 2)
    assert.equal(previous.maxPayloadSize, 400)

    assert.equal(current.resetReason, 'browser-startup')
    assert.equal(current.startedAt, 10000)
    assert.equal(current.firstServiceWorkerStartedAt, 10000)
    assert.equal(current.lastServiceWorkerStartedAt, 10000)
    assert.equal(current.counters['serviceWorker.started'], 1)
    assert.equal(current.counters['storageUpdate.started'], undefined)
    assert.equal(current.counters['job.enqueued'], undefined)
    assert.equal(current.journal.length, 1)
    assert.equal(current.journal[0].name, 'metrics-epoch-reset')

    assert.equal(metrics.lifetime.resetCount, 1)
    assert.equal(metrics.lifetime.counters['job.enqueued'], 8)
    assert.equal(metrics.lifetime.counters['storageUpdate.timedOut'], 2)
    assert.equal(metrics.lifetime.counters['serviceWorker.started'], 2)
})

test('queue wakeup metrics view keeps dashboard reads bounded', async () => {
    const journal = Array.from({length: 80}, (_, index) => ({
        at: 1000 + index,
        kind: 'storage',
        name: `entry-${index}`,
        result: index % 2 ? 'completed' : 'no-op',
        counters: {'storagePayload.read.queue.bytes': index * 1000},
        details: {payloadBytes: index * 2000}
    }))
    const fullMetrics = {
        version: 4,
        currentEpoch: {
            epochId: 'epoch-full',
            resetReason: 'extension-updated',
            startedAt: 1000,
            updatedAt: 5000,
            extensionVersion: 'test',
            counters: {
                'storagePayload.write.total.bytes': 123456,
                'storagePayload.read.total.bytes': 654321,
                'repair.requested': 9
            },
            phases: {
                storageGet: {count: 2, totalMs: 50, maxMs: 40}
            },
            journal
        },
        previousEpochs: [{epochId: 'epoch-before'}],
        lifetime: {
            startedAt: 900,
            updatedAt: 5000,
            resetCount: 2,
            counters: Object.fromEntries(Array.from({length: 200}, (_, index) => [`large.${index}`, index]))
        }
    }

    const {sw, storage} = loadServiceWorkerHarness({
        now: 6000,
        storage: {
            mbQueueWakeupMetrics: fullMetrics
        }
    })

    const directView = sw.buildQueueWakeupMetricsView(fullMetrics)
    assert.equal(directView.currentEpoch.journal.length, 30)
    assert.equal(directView.currentEpoch.journal[0].name, 'entry-50')
    assert.equal(directView.currentEpoch.counters['storagePayload.write.total.bytes'], 123456)
    assert.equal(directView.lifetime.resetCount, 2)
    assert.equal(directView.lifetime.counters, undefined)

    const result = await sw.refreshQueueWakeupMetricsViewForDashboard('test')
    assert.equal(result.refreshed, true)
    assert.equal(storage.mbQueueWakeupMetricsView.currentEpoch.journal.length, 30)
    assert.equal(storage.mbQueueWakeupMetricsView.previousEpochs.length, 1)
    assert.equal(storage.mbQueueWakeupMetricsView.lifetime.counters, undefined)
    assert.ok(sw.state().queueWakeupCounters['storagePayload.write.metricsView.bytes'] > 0)
    assert.equal(sw.state().queueWakeupCounters['storagePayload.write.queue.bytes'], undefined)
})

test('metrics loading does not flush default epoch before persisted metrics resolve', async () => {
    const gate = deferred()
    const browser = createFakeBrowser({
        mbQueueWakeupMetrics: {
            version: 4,
            currentEpoch: {
                epochId: 'epoch-persisted',
                resetReason: 'extension-updated',
                startedAt: 1000,
                updatedAt: 5000,
                extensionVersion: 'test',
                firstServiceWorkerStartedAt: 1100,
                lastServiceWorkerStartedAt: 4000,
                counters: {
                    'serviceWorker.started': 1,
                    'storageUpdate.started': 3
                },
                phases: {},
                journal: []
            },
            previousEpochs: [{
                epochId: 'epoch-previous',
                resetReason: 'browser-startup',
                rolloverReason: 'extension-updated',
                startedAt: 1,
                endedAt: 999,
                storage: {started: 1, timedOut: 0, timeoutRate: 0},
                storagePayload: {writeBytes: 0, writeCalls: 0, maxBytes: 0},
                repair: {requested: 0, changed: 0},
                pump: {requested: 0, changed: 0, yield: 0},
                nudge: {sent: 0, accepted: 0, yield: 0},
                jobs: {enqueued: 0, terminal: 0, completedAfterRepair: 0, completedAfterRepairRate: 0},
                maxPayloadSize: 0,
                journalCount: 0
            }],
            lifetime: {
                startedAt: 1,
                updatedAt: 5000,
                resetCount: 1,
                counters: {
                    'storageUpdate.started': 10
                }
            }
        },
        mbCoordinatorQueue: {}
    })
    browser.__sessionStorage.mbBrowserSessionMarker = {id: 'existing-session'}
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    let metricsGetStarted = false
    browser.storage.local.get = async defaults => {
        if(defaults && typeof defaults === 'object' && Object.prototype.hasOwnProperty.call(defaults, 'mbQueueWakeupMetrics')) {
            metricsGetStarted = true
            await gate.promise
        }
        return originalGet(defaults)
    }

    const {storage} = loadServiceWorkerHarness({
        browser,
        now: 10000,
        runStartupWork: true
    })

    await activateQuoraRuntime(browser)
    await flushAsync(10)
    assert.equal(metricsGetStarted, true)
    assert.equal(storage.mbQueueWakeupMetrics.currentEpoch.epochId, 'epoch-persisted')
    assert.equal(storage.mbQueueWakeupMetrics.currentEpoch.resetReason, 'extension-updated')
    assert.equal(storage.mbQueueWakeupMetrics.currentEpoch.counters['repair.requested'], undefined)

    gate.resolve()
    await flushAsync(30)

    const metrics = storage.mbQueueWakeupMetrics
    assert.equal(metrics.currentEpoch.epochId, 'epoch-persisted')
    assert.equal(metrics.currentEpoch.resetReason, 'extension-updated')
    assert.equal(metrics.currentEpoch.counters['storageUpdate.started'], 3)
    assert.equal(metrics.currentEpoch.counters['serviceWorker.started'], 2)
    assert.equal(metrics.previousEpochs.length, 1)
    assert.equal(metrics.previousEpochs[0].epochId, 'epoch-previous')
    assert.equal(metrics.lifetime.resetCount, 1)
})

test('extension lifecycle reset persists a fresh metrics epoch before Quora activation', async () => {
    const oldEpoch = {
        epochId: 'epoch-before-reload',
        resetReason: 'extension-updated',
        extensionVersion: 'old-version',
        startedAt: 1000,
        updatedAt: 2000,
        counters: {
            'storageUpdate.started': 4
        },
        phases: {},
        journal: [{
            at: 2000,
            kind: 'storage',
            name: 'old-cycle',
            result: 'completed'
        }]
    }
    const {browser, storage} = loadServiceWorkerHarness({
        now: 12000,
        storage: {
            mbQueueWakeupMetrics: {
                version: 4,
                currentEpoch: oldEpoch,
                previousEpochs: [],
                lifetime: {startedAt: 1000, updatedAt: 2000, resetCount: 0, counters: {}}
            },
            mbCoordinatorQueue: {
                queued: {
                    id: 'queued',
                    status: 'queued',
                    subject: {profileHref: 'https://www.quora.com/profile/Reload-Test'}
                }
            }
        }
    })

    await browser.runtime.onInstalled.emit({reason: 'update'})
    await flushAsync(30)

    const metrics = storage.mbQueueWakeupMetrics
    assert.equal(metrics.currentEpoch.resetReason, 'extension-updated')
    assert.equal(metrics.currentEpoch.extensionVersion, 'test')
    assert.equal(metrics.currentEpoch.counters['serviceWorker.started'], 1)
    assert.equal(metrics.previousEpochs.length, 1)
    assert.equal(metrics.previousEpochs[0].epochId, 'epoch-before-reload')
    assert.equal(metrics.previousEpochs[0].rolloverReason, 'extension-updated')
    assert.equal(metrics.lifetime.counters['storageUpdate.started'], 4)
    assert.equal(
        browser.__alarmCreates.some(alarm => alarm.name === 'mb-stored-work-repair' && !alarm.cleared),
        false
    )
})

test('startup does not schedule queue repair before Quora is observed', async () => {
    const gate = deferred()
    let metricsGetStarted = false
    const browser = createFakeBrowser({
        mbCoordinatorQueue: {
            queued: {
                id: 'queued',
                status: 'queued',
                subject: {profileHref: 'https://www.quora.com/profile/Slow-Metrics'}
            }
        }
    })
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        if(defaults && typeof defaults === 'object' && Object.prototype.hasOwnProperty.call(defaults, 'mbQueueWakeupMetrics')) {
            metricsGetStarted = true
            await gate.promise
        }
        return originalGet(defaults)
    }

    const {browser: harnessBrowser} = loadServiceWorkerHarness({
        browser,
        now: 20000,
        runStartupWork: true
    })

    await flushAsync(5)
    assert.equal(
        harnessBrowser.__alarmCreates.some(alarm => alarm.name === 'mb-stored-work-repair'),
        false
    )
    assert.equal(metricsGetStarted, false)
})

test('first Quora activation lazily rolls a browser-startup metrics epoch', async () => {
    const oldEpoch = {
        epochId: 'epoch-before-restart',
        resetReason: 'manual',
        extensionVersion: 'test',
        startedAt: 1000,
        updatedAt: 1500,
        counters: {
            'storageUpdate.started': 2
        },
        journal: []
    }
    const {browser, storage} = loadServiceWorkerHarness({
        now: 30000,
        runStartupWork: true,
        storage: {
            mbQueueWakeupMetrics: {
                version: 4,
                currentEpoch: oldEpoch,
                previousEpochs: [],
                lifetime: {startedAt: 1000, updatedAt: 1500, resetCount: 0, counters: {}}
            }
        }
    })

    assert.equal(storage.mbQueueWakeupMetrics.currentEpoch.epochId, 'epoch-before-restart')

    await activateQuoraRuntime(browser)
    await flushAsync(30)

    assert.equal(storage.mbQueueWakeupMetrics.currentEpoch.resetReason, 'browser-startup')
    assert.equal(storage.mbQueueWakeupMetrics.currentEpoch.counters['serviceWorker.started'], 1)
    assert.equal(storage.mbQueueWakeupMetrics.previousEpochs.length, 1)
    assert.equal(storage.mbQueueWakeupMetrics.previousEpochs[0].epochId, 'epoch-before-restart')
    assert.equal(storage.mbQueueWakeupMetrics.previousEpochs[0].rolloverReason, 'browser-startup')
    assert.ok(browser.__sessionStorage.mbBrowserSessionMarker)
})

test('first Quora tab observation clears stale pause and resumes persisted service-worker work', async () => {
    const href = 'https://www.quora.com/profile/Slow-Metrics'
    const runId = 'run-stale-pause-auto-resume'
    const {browser: harnessBrowser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 20000,
        runStartupWork: true,
        storage: {
            mbCoordinatorPaused: true,
            mbCoordinatorQueue: {
                [href]: {
                    id: 'queued',
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 19000,
                    updatedAt: 19000,
                    attemptId: 'attempt-stale-pause-auto-resume',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'paused',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await harnessBrowser.tabs.onUpdated.emit(101, {
        status: 'loading',
        url: href
    }, {
        id: 101,
        url: href
    })

    await waitFor(
        () => storage.mbCoordinatorPaused === false,
        'first Quora activation did not clear stale paused state',
        {timers}
    )
    await waitFor(
        () => listTabs(harnessBrowser).some(tab => tab.url === href),
        'first Quora activation did not resume persisted service-worker work',
        {timers, tickMs: 600}
    )
    await waitFor(
        () => sw.coordinatorAuthority.current().queue[href]?.status === 'active',
        'first Quora activation opened a tab but did not persist active queue authority state',
        {timers}
    )
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
})

test('first Quora tab observation preserves explicit pause across extension reload', async () => {
    const href = 'https://www.quora.com/profile/Explicit-Pause-Reload'
    const runId = 'run-explicit-pause-reload'
    const {browser: harnessBrowser, storage, timers} = loadServiceWorkerHarness({
        now: 20250,
        runStartupWork: true,
        storage: {
            mbCoordinatorPaused: true,
            mbCoordinatorPauseGeneration: 7,
            mbCoordinatorQueue: {
                [href]: {
                    id: 'queued',
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 20000,
                    updatedAt: 20000,
                    attemptId: 'attempt-explicit-pause-reload',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'paused',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await harnessBrowser.tabs.onUpdated.emit(101, {
        status: 'loading',
        url: href
    }, {
        id: 101,
        url: href
    })

    await flushAsync(20)
    await timers.tick(0)
    await timers.tick(1000)
    await harnessBrowser.alarms.onAlarm.emit({name: 'mb-coordinator-resume'})
    await harnessBrowser.alarms.onAlarm.emit({name: 'mb-stored-work-repair'})
    await flushAsync(20)

    assert.equal(storage.mbCoordinatorPaused, true)
    assert.equal(storage.mbCoordinatorPauseGeneration, 7)
    assert.equal(storage.mbCoordinatorQueue[href]?.status, 'queued')
    assert.deepEqual(listTabs(harnessBrowser), [])
})

test('content ready message opens the Quora runtime gate and resumes stored work', async () => {
    const href = 'https://www.quora.com/profile/Content-Ready-Auto-Resume'
    const runId = 'run-content-ready-auto-resume'
    const {browser: harnessBrowser, storage, timers} = loadServiceWorkerHarness({
        now: 20500,
        runStartupWork: true,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    id: 'queued',
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 20000,
                    updatedAt: 20000,
                    attemptId: 'attempt-content-ready-auto-resume',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await harnessBrowser.runtime.sendMessage({
        action: 'quora-runtime-ready',
        url: 'https://www.quora.com/search?q=content-ready&type=profile',
        pageType: 'profile-search',
        contentScriptVersion: 'test'
    }, {
        tab: {
            id: 201,
            windowId: 1,
            url: 'https://www.quora.com/search?q=content-ready&type=profile'
        }
    })

    await waitFor(
        () => listTabs(harnessBrowser).some(tab => tab.url === href),
        'content ready message did not resume persisted service-worker work',
        {timers, tickMs: 600}
    )
    await waitFor(
        () => getRecoveredCoordinatorQueue(storage)[href]?.status === 'active',
        'content ready message opened a tab but did not persist active queue state',
        {timers}
    )
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')
})

test('manual metrics reset is bounded when metrics storage is wedged', async () => {
    const metricsGetGate = deferred()
    const metricsSetGate = deferred()
    const browser = createFakeBrowser({})
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        if(defaults && typeof defaults === 'object' && Object.prototype.hasOwnProperty.call(defaults, 'mbQueueWakeupMetrics')) {
            await metricsGetGate.promise
        }
        return originalGet(defaults)
    }
    browser.storage.local.set = async payload => {
        if(payload && Object.prototype.hasOwnProperty.call(payload, 'mbQueueWakeupMetrics')) {
            await metricsSetGate.promise
        }
        return originalSet(payload)
    }

    const {sw, timers} = loadServiceWorkerHarness({
        browser,
        now: 30000
    })

    const result = await settleWithFakeTimers(
        sw.resetQueueWakeupMetricsEpochAfterLoad('manual'),
        timers,
        [0, 3000, 3000]
    )

    assert.equal(result.reset, true)
    assert.equal(result.resetReason, 'manual')
})

test('metrics loading rolls over stale extension version epoch', async () => {
    const {browser, storage, timers} = loadServiceWorkerHarness({
        now: 5300,
        runStartupWork: true,
        storage: {
            mbQueueWakeupMetrics: {
                version: 4,
                currentEpoch: {
                    epochId: 'epoch-old-version',
                    resetReason: 'extension-updated',
                    startedAt: 1000,
                    updatedAt: 2000,
                    extensionVersion: 'old-version',
                    firstServiceWorkerStartedAt: 1000,
                    lastServiceWorkerStartedAt: 2000,
                    counters: {
                        'storageUpdate.started': 3
                    },
                    phases: {},
                    journal: [{
                        at: 2000,
                        kind: 'storage',
                        name: 'old-cycle',
                        result: 'completed'
                    }]
                },
                previousEpochs: [],
                lifetime: {
                    startedAt: 1000,
                    updatedAt: 2000,
                    resetCount: 0,
                    counters: {}
                }
            }
        }
    })

    await activateQuoraRuntime(browser)

    const metrics = await waitFor(
        () => storage.mbQueueWakeupMetrics?.currentEpoch?.extensionVersion === 'test'
            ? storage.mbQueueWakeupMetrics
            : null,
        'stale extension metrics epoch was not rolled over on load',
        {timers}
    )

    assert.equal(metrics.currentEpoch.resetReason, 'extension-updated')
    assert.equal(metrics.currentEpoch.counters['serviceWorker.started'], 1)
    assert.equal(metrics.previousEpochs.length, 1)
    assert.equal(metrics.previousEpochs[0].epochId, 'epoch-old-version')
    assert.equal(metrics.previousEpochs[0].rolloverReason, 'extension-updated')
    assert.equal(metrics.lifetime.counters['storageUpdate.started'], 3)
})

test('dashboard resume returns a scheduled response when alarm creation fails', async () => {
    const {browser} = loadServiceWorkerHarness({now: 0})
    browser.__setAlarmCreateImpl(async () => {
        throw new Error('alarms unavailable')
    })

    await activateQuoraRuntime(browser)

    const result = await browser.runtime.sendMessage({action: 'resume-coordinator-queue'})

    assert.equal(result.alarmCreated, false)
    assert.equal(result.fallbackScheduled, true)
    assert.equal(result.scheduledOnly, true)
    assert.equal(result.recovered, false)
    assert.equal(result.reason, 'dashboard-resume-scheduled')
})

test('dashboard resume waits for first Quora visit before scheduling work', async () => {
    const {browser} = loadServiceWorkerHarness({now: 0})

    const result = await browser.runtime.sendMessage({action: 'resume-coordinator-queue'})

    assert.equal(result.reason, 'quora-runtime-not-activated')
    assert.equal(result.requiresQuoraVisit, true)
    assert.equal(result.alarmCreated, false)
    assert.equal(result.fallbackScheduled, false)
    assert.equal(result.resumeScheduled, false)
    assert.equal(
        browser.__alarmCreates.some(alarm => alarm.name === 'mb-coordinator-resume' || alarm.name === 'mb-stored-work-repair'),
        false
    )
})

test('dashboard ready stays display-only even when a Quora tab is already open', async () => {
    const {browser} = loadServiceWorkerHarness({now: 0})

    await browser.tabs.create({url: 'https://www.quora.com/search?q=elon%20musk&type=profile'})

    const result = await browser.runtime.sendMessage({action: 'coordinator-page-ready'})

    assert.equal(result.displayOnly, true)
    assert.equal(result.requiresQuoraVisit, true)
})

test('dashboard resume observes an already-open Quora tab after restart', async () => {
    const href = 'https://www.quora.com/profile/Restart-Gate'
    const {browser} = loadServiceWorkerHarness({
        now: 0,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    createdAt: 0,
                    updatedAt: 0
                }
            }
        }
    })

    await browser.tabs.create({url: 'https://www.quora.com/search?q=elon%20musk&type=profile'})

    const result = await browser.runtime.sendMessage({action: 'resume-coordinator-queue'})

    assert.equal(result.requiresQuoraVisit, undefined)
    assert.equal(result.reason, 'dashboard-resume-scheduled')
    assert.equal(result.fallbackScheduled, true)
})

test('stored-work repair alarm clears the pending timeout and runs repair', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    sw.scheduleStoredWorkRepair(1000)
    assert.equal(sw.state().hasStoredWorkRepairTimeout, true)
    assert.ok(timers.pending().some(timer => timer.dueAt === 1000))

    await browser.alarms.onAlarm.emit({name: 'mb-stored-work-repair'})

    assert.equal(sw.state().hasStoredWorkRepairTimeout, false)
    assert.equal(sw.state().storedWorkRepairDueAt, 0)
    assert.equal(timers.pending().some(timer => timer.dueAt === 1000), false)
})

test('stored-work repair timeout clears and suppresses stale alarm delivery', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    sw.scheduleStoredWorkRepair(1000)

    await timers.tick(1000)
    await flushAsync(20)

    assert.equal(sw.state().hasStoredWorkRepairTimeout, false)
    assert.equal(sw.state().storedWorkRepairDueAt, 0)
    assert.ok(browser.__alarmCreates.some(alarm => alarm.name === 'mb-stored-work-repair' && alarm.cleared))

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({name: 'mb-stored-work-repair'})
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal((afterCounters['repair.alarmStale'] || 0), (beforeCounters['repair.alarmStale'] || 0) + 1)
    assert.equal((afterCounters['repair.alarmFired'] || 0), beforeCounters['repair.alarmFired'] || 0)
})

test('stored-work repair suppresses identifiable stale alarm after suppression window', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    sw.scheduleStoredWorkRepair(1000)

    await timers.tick(1000)
    await flushAsync(20)
    await timers.tick(6000)

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({
        name: 'mb-stored-work-repair',
        scheduledTime: 1000
    })
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal((afterCounters['repair.alarmStale'] || 0), (beforeCounters['repair.alarmStale'] || 0) + 1)
    assert.equal((afterCounters['repair.alarmFired'] || 0), beforeCounters['repair.alarmFired'] || 0)
})

test('stored-work repair stale alarm cannot steal a newer timeout', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    sw.scheduleStoredWorkRepair(1000)
    await timers.tick(1000)
    await flushAsync(20)

    sw.scheduleStoredWorkRepair(5000, {
        allowBeforeQuora: true,
        reason: 'periodic-watchdog'
    })
    const newerDueAt = sw.state().storedWorkRepairDueAt
    assert.equal(newerDueAt, timers.now + 5000)

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({
        name: 'mb-stored-work-repair',
        scheduledTime: 1000
    })
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal(sw.state().hasStoredWorkRepairTimeout, true)
    assert.equal(sw.state().storedWorkRepairDueAt, newerDueAt)
    assert.equal((afterCounters['repair.alarmStale'] || 0), (beforeCounters['repair.alarmStale'] || 0) + 1)
    assert.equal((afterCounters['repair.alarmFired'] || 0), beforeCounters['repair.alarmFired'] || 0)
})

test('coordinator resume timeout clears and suppresses stale alarm delivery', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    const result = await sw.kickCoordinatorQueueResume('synthetic-resume-stale-alarm')
    assert.equal(result.scheduledOnly, true)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)

    await timers.tick(600)
    await flushAsync(20)

    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, false)
    assert.equal(sw.state().coordinatorQueueResumeDueAt, 0)
    assert.ok(browser.__alarmCreates.some(alarm => alarm.name === 'mb-coordinator-resume' && alarm.cleared))

    const beforeCounters = sw.state().queueWakeupCounters
    const alarmPromise = browser.alarms.onAlarm.emit({name: 'mb-coordinator-resume'})
    alarmPromise.catch(() => null)
    await timers.tick(0)
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal((afterCounters['pump.alarmStale'] || 0), (beforeCounters['pump.alarmStale'] || 0) + 1)
    assert.equal((afterCounters['pump.alarmFired'] || 0), beforeCounters['pump.alarmFired'] || 0)
})

test('coordinator resume suppresses identifiable stale alarm after suppression window', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    const result = await sw.kickCoordinatorQueueResume('synthetic-delayed-stale-resume-alarm')
    assert.equal(result.scheduledOnly, true)

    await timers.tick(600)
    await flushAsync(20)
    await timers.tick(6000)

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({
        name: 'mb-coordinator-resume',
        scheduledTime: 600
    })
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal((afterCounters['pump.alarmStale'] || 0), (beforeCounters['pump.alarmStale'] || 0) + 1)
    assert.equal((afterCounters['pump.alarmFired'] || 0), beforeCounters['pump.alarmFired'] || 0)
})

test('coordinator resume stale alarm cannot steal a newer timeout', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    const firstResult = await sw.kickCoordinatorQueueResume('synthetic-first-resume-alarm')
    assert.equal(firstResult.scheduledOnly, true)
    await timers.tick(600)
    await flushAsync(20)

    const nextResult = await sw.kickCoordinatorQueueResume('synthetic-second-resume-alarm')
    assert.equal(nextResult.scheduledOnly, true)
    const newerDueAt = sw.state().coordinatorQueueResumeDueAt
    assert.equal(newerDueAt, timers.now + 600)

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({
        name: 'mb-coordinator-resume',
        scheduledTime: 600
    })
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().coordinatorQueueResumeDueAt, newerDueAt)
    assert.equal((afterCounters['pump.alarmStale'] || 0), (beforeCounters['pump.alarmStale'] || 0) + 1)
    assert.equal((afterCounters['pump.alarmFired'] || 0), beforeCounters['pump.alarmFired'] || 0)
})

test('nonterminal progress storage changes do not edge-trigger repair backoff reset', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Progress'
    const {browser, sw} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    await browser.storage.local.set({
        mbProfileNukeProgress: {
            [href]: {
                status: 'acting',
                event: 'Action in progress',
                updatedAt: 1
            }
        }
    })
    await flushAsync(20)

    const nonterminalCounters = sw.state().queueWakeupCounters
    assert.equal(nonterminalCounters['repair.edgeTriggered'] || 0, 0)
    assert.equal(sw.state().hasStoredWorkRepairTimeout, false)

    await browser.storage.local.set({
        mbProfileNukeProgressView: {
            version: 2,
            updatedAt: 2,
            total: 1,
            records: {
                [href]: {
                    profileHref: href,
                    status: 'blocked',
                    blockSucceeded: true,
                    event: 'Blocked',
                    updatedAt: 2
                }
            }
        }
    })
    await flushAsync(20)

    const terminalCounters = sw.state().queueWakeupCounters
    assert.equal(terminalCounters['repair.edgeTriggered'] || 0, 1)
    assert.equal(sw.state().hasStoredWorkRepairTimeout, true)
})

test('content-page state rebuilds missing progress shards for old requested profiles', async () => {
    const oldHref = 'https://www.quora.com/profile/Old-Completed-Profile'
    const recentHref = 'https://www.quora.com/profile/Recent-Completed-Profile'
    const {browser, storage} = loadServiceWorkerHarness({
        storage: {
            mbCoordinatorContentQueueIndex: {
                version: 2,
                updatedAt: 10,
                total: 0,
                indexed: 0,
                itemLimit: 1200,
                truncated: false,
                items: []
            },
            mbProfileNukeProgressView: {
                version: 2,
                updatedAt: 10,
                total: 2,
                recordLimit: 1,
                truncated: true,
                records: {
                    [recentHref]: {
                        profileHref: recentHref,
                        status: 'blocked',
                        blockSucceeded: true,
                        updatedAt: 10
                    }
                }
            },
            mbProfileNukeProgress: {
                [oldHref]: {
                    profileHref: oldHref,
                    status: 'blocked',
                    blockSucceeded: true,
                    updatedAt: 1
                },
                [recentHref]: {
                    profileHref: recentHref,
                    status: 'blocked',
                    blockSucceeded: true,
                    updatedAt: 10
                }
            }
        }
    })

    const result = await browser.runtime.sendMessage({
        action: 'get-content-page-coordinator-state',
        pageType: 'profile-search',
        profileHrefs: [oldHref]
    })

    assert.equal(result.progressRows, 1)
    assert.equal(result.profileNukeProgress[oldHref].status, 'blocked')
    assert.equal(result.profileNukeProgress[oldHref].blockSucceeded, true)

    const shardKeys = Object.keys(storage).filter(key => key.startsWith('mbProfileNukeProgressShard.'))
    assert.equal(shardKeys.length, 32)
    assert.ok(shardKeys.some(key => storage[key]?.records?.[oldHref]))
})

test('content-page state falls back for source-matched rows outside truncated queue index', async () => {
    const searchUrl = 'https://www.quora.com/search?q=SEO&type=profile'
    const targetHref = 'https://www.quora.com/profile/Seo-Outside-Index'
    const queue = {}

    for(let index = 0; index < 1200; index += 1) {
        const href = `https://www.quora.com/profile/Indexed-${index}`
        const item = {
            id: `indexed-${index}`,
            status: 'queued',
            serviceWorkerOwned: true,
            executorOwner: 'service-worker',
            targetProfileHref: href,
            queuedAt: 10000 + index,
            updatedAt: 10000 + index
        }
        queue[href] = item
    }
    queue[targetHref] = {
        id: 'outside-index',
        status: 'queued',
        serviceWorkerOwned: true,
        executorOwner: 'service-worker',
        targetProfileHref: targetHref,
        queuedAt: 1,
        updatedAt: 1,
        source: {
            type: 'profile-search',
            pageUrl: searchUrl,
            searchQuery: 'SEO',
            sourceLabel: 'Search: SEO'
        }
    }

    const {browser, sw, storage} = loadServiceWorkerHarness({
        storage: {
            mbProfileNukeProgressView: {
                version: 2,
                updatedAt: 20,
                total: 0,
                recordLimit: 1200,
                truncated: false,
                records: {}
            }
        }
    })
    await sw.metricStorageSet({
        mbCoordinatorQueue: queue
    }, {metricPath: 'seed.sourceIndex'})

    assert.equal(storage.mbCoordinatorContentQueueIndex.truncated, true)
    assert.equal(
        storage.mbCoordinatorContentQueueIndex.items.some(item => item.storageKey === targetHref),
        false
    )
    await activateQuoraRuntime(browser, searchUrl)
    await flushAsync(20)
    const beforeCounters = {
        queueFallbackCalls: sw.state().queueWakeupCounters['storagePayload.read.path.contentPageState.queueFallback.truncated.calls'] || 0,
        compatBuildCalls: sw.state().queueWakeupCounters['storagePayload.read.path.contentPageState.compatBuild.missing-projection.calls'] || 0,
        sourceIndexReadBytes: sw.state().queueWakeupCounters['storagePayload.read.contentSourceIndex.bytes'] || 0
    }

    const result = await browser.runtime.sendMessage({
        action: 'get-content-page-coordinator-state',
        pageType: 'profile-search',
        sourcePageUrl: searchUrl,
        searchQuery: 'SEO',
        profileHrefs: []
    })

    assert.equal(result.queueRows, 1)
    assert.equal(result.coordinatorQueue[targetHref].status, 'queued')

    const counters = sw.state().queueWakeupCounters
    assert.equal(
        counters['storagePayload.read.path.contentPageState.queueFallback.truncated.calls'] || 0,
        beforeCounters.queueFallbackCalls
    )
    assert.equal(
        counters['storagePayload.read.path.contentPageState.compatBuild.missing-projection.calls'] || 0,
        beforeCounters.compatBuildCalls
    )
    assert.ok((counters['storagePayload.read.contentSourceIndex.bytes'] || 0) > beforeCounters.sourceIndexReadBytes)
})

test('content-page projection rebuild uses WAL terminal authority over stale raw active queue', async () => {
    const href = 'https://www.quora.com/profile/Content-Wal-Terminal-Stale-Raw'
    const runId = 'run-content-wal-terminal-stale-raw'
    const attemptId = 'attempt-content-wal-terminal-stale-raw'
    const tabId = 718
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 525000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 525000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 524500
                }
            }
        }
    })

    const terminal = await sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 525100,
        terminalAt: 525100,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(terminal.recorded, true)
    assert.equal(terminal.terminal, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')

    for(const key of Object.keys(storage)) {
        if(key === 'mbCoordinatorContentQueueIndex' || key.startsWith('mbCoordinatorContentSourceIndex.')) {
            delete storage[key]
        }
    }

    const result = await browser.runtime.sendMessage({
        action: 'get-content-page-coordinator-state',
        pageType: 'profile-search',
        profileHrefs: [href]
    })

    assert.equal(result.queueRows, 0)
    assert.equal(result.coordinatorQueue[href], undefined)
    assert.equal(storage.mbCoordinatorContentQueueIndex.total, 1)
    assert.equal(storage.mbCoordinatorContentQueueIndex.indexed, 0)
})

test('queued work resumes after service worker restart once Quora was seen this browser session', async () => {
    const href = 'https://www.quora.com/profile/Restart-Session-Gate'
    const browser = createFakeBrowser({
        mbCoordinatorQueue: {
            [href]: {
                status: 'queued',
                targetProfileHref: href,
                requestedUrl: href,
                executorOwner: 'service-worker',
                serviceWorkerOwned: true,
                createdAt: 0,
                updatedAt: 0
            }
        },
        mbCoordinatorRuns: {},
        mbCoordinatorEvents: [],
        mbProfileNukeProgress: {}
    })
    browser.__sessionStorage.mbQuoraRuntimeActivated = {
        active: true,
        reason: 'quora-tab-updated',
        extensionVersion: 'test',
        observedAt: 1
    }

    const {sw, timers, storage} = loadServiceWorkerHarness({now: 0, browser})

    const result = await browser.runtime.sendMessage({action: 'resume-coordinator-queue'})

    assert.equal(result.requiresQuoraVisit, undefined)
    assert.equal(result.reason, 'dashboard-resume-scheduled')
    assert.equal(result.fallbackScheduled, true)

    const alarmPromise = browser.alarms.onAlarm.emit({name: 'mb-coordinator-resume'})
    alarmPromise.catch(() => null)
    await timers.tick(0)

    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'session-restored durable queued resume did not open a profile tab',
        {timers, attempts: 40, tickMs: 1000}
    )
    await waitFor(
        () => ['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status),
        'session-restored durable queued resume did not persist active queue authority state',
        {timers, attempts: 40, tickMs: 1000}
    )
})

test('first Quora activation without stored work only opens the runtime gate', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)

    assert.equal(sw.state().hasStoredWorkRepairTimeout, false)
    assert.equal(sw.state().storedWorkRepairDueAt, 0)
    assert.equal(
        browser.__alarmCreates.some(alarm => alarm.name === 'mb-coordinator-resume' || alarm.name === 'mb-stored-work-repair'),
        false
    )
    assert.equal(timers.pending().some(timer => timer.dueAt === 1000), false)
})

test('service-worker-owned execution is visible to the source page run status', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Visible'
    const runId = 'run-service-worker-visible'
    const sourceSender = {tab: {id: 10, windowId: 1}}
    const {browser, timers} = loadServiceWorkerHarness({now: 1000})

    const enqueue = await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender)

    assert.equal(enqueue.runId, runId)

    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'service-worker executor tab was not opened',
        {timers}
    )

    const status = await browser.runtime.sendMessage({
        action: 'get-owned-nuke-status',
        runId
    }, sourceSender)

    assert.ok(status.active + status.owned + status.queued > 0, JSON.stringify(status))
})

test('source-page run status ignores WAL-terminal row over stale raw active queue', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Owned-Status-Wal-Terminal'
    const runId = 'run-owned-status-wal-terminal'
    const attemptId = 'attempt-owned-status-wal-terminal'
    const tabId = 682
    const sourceSender = {tab: {id: 10, windowId: 1}}
    const firstHarness = loadServiceWorkerHarness({
        now: 1600,
        storage: {
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 1600})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })

    await firstHarness.sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 1700,
        terminalAt: 1700,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })
    assert.equal(firstHarness.storage.mbCoordinatorQueue[href].status, 'active')

    const {browser, storage} = loadServiceWorkerHarness({
        now: 1800,
        storage: firstHarness.storage
    })
    const status = await browser.runtime.sendMessage({
        action: 'get-owned-nuke-status',
        runId
    }, sourceSender)

    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(status.active, 0)
    assert.equal(status.queued, 0)
    assert.equal(status.owned, 0)
    assert.equal(status.paused, false)
})

test('source-page run status polling is read-only for terminal owned tabs', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Owned-Status-Readonly'
    const runId = 'run-owned-status-readonly'
    const attemptId = 'attempt-owned-status-readonly'
    const tabId = 683
    const sourceSender = {tab: {id: 10, windowId: 1}}
    const {browser, sw, timers} = loadServiceWorkerHarness({
        now: 1900,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 1800}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt: 1850,
                    updatedAt: 1850
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocked',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    terminalAt: 1850
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false,
        status: 'complete'
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        ownerTabId: sourceSender.tab.id,
        profileHref: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1,
        lastUpdatedAt: 1900
    })
    const pendingTimersBefore = timers.pending()
    const alarmCreatesBefore = browser.__alarmCreates.length

    const status = await browser.runtime.sendMessage({
        action: 'get-owned-nuke-status',
        runId
    }, sourceSender)

    assert.equal(typeof status.owned, 'number')
    assert.equal(browser.__removedTabs.length, 0)
    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(sw.state().hasStoredWorkRepairTimeout, false)
    assert.deepEqual(timers.pending(), pendingTimersBefore)
    assert.equal(browser.__alarmCreates.length, alarmCreatesBefore)
})

test('service-worker queued action preserves foreground fallback policy when claimed', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Foreground'
    const runId = 'run-foreground-policy'
    const sourceSender = {tab: {id: 11, windowId: 1}}
    const {browser, timers} = loadServiceWorkerHarness({now: 2000})

    await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: false
        }
    }), sourceSender)

    const tab = await waitFor(
        () => listTabs(browser).find(candidate => candidate.url === href),
        'service-worker executor tab was not opened for foreground policy test',
        {timers}
    )

    const claim = await waitFor(
        () => browser.runtime.sendMessage({action: 'claim-tab-action'}, {tab}),
        'executor tab did not claim its queued action',
        {timers}
    )

    assert.equal(claim.noForegroundFallback, false)
})

test('service-worker no-foreground destructive work uses worker window without focusing it', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Worker-Surface'
    const runId = 'run-worker-surface'
    const attemptId = 'attempt-worker-surface'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 2075,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 2000,
                    updatedAt: 2000,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const userTab = await browser.tabs.create({url: 'https://www.quora.com/search?q=elon', active: true})

    const resultPromise = sw.resumeCoordinatorQueueExecution({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true
    })

    await settleWithFakeTimers(resultPromise, timers)
    const tabs = listTabs(browser)
    const profileTab = tabs.find(tab => tab.url === href)
    const workerWindow = Array.from(browser.__windows.values()).find(win => win.id !== userTab.windowId)

    assert.ok(workerWindow?.id)
    assert.equal(workerWindow.focused, false)
    assert.equal((await browser.tabs.get(userTab.id)).active, true)
    assert.equal(profileTab?.windowId, workerWindow.id)
    assert.equal(profileTab?.active, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].tabId, profileTab.id)
    await waitFor(
        () => sw.state().queuedTabMetadata.find(([tabId]) => tabId === profileTab.id)?.[1]?.actionSurfaceMode === 'worker-window',
        'worker action surface metadata was not recorded',
        {timers, attempts: 20, tickMs: 100}
    )
    const metadata = sw.state().queuedTabMetadata.find(([tabId]) => tabId === profileTab.id)?.[1] || {}
    assert.equal(metadata.actionSurfaceMode, 'worker-window')
    assert.equal(metadata.actionSurfaceWindowId, workerWindow.id)
    assert.equal(browser.__windowUpdates.some(update =>
        update.windowId === workerWindow.id && update.options?.focused === true
    ), false)
})

test('service-worker reuses existing worker window after in-memory surface state is lost', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Worker-Surface-Reuse'
    const runId = 'run-worker-surface-reuse'
    const attemptId = 'attempt-worker-surface-reuse'
    const browser = createFakeBrowser({
        mbCoordinatorPaused: false,
        mbCoordinatorQueue: {
            [href]: {
                runId,
                status: 'queued',
                actionKind: 'mute-block',
                executorTabAction: 'nuke',
                executorOwner: 'service-worker',
                serviceWorkerOwned: true,
                executorNoForegroundFallback: true,
                executorMaxConcurrent: 1,
                targetProfileHref: href,
                requestedUrl: href,
                dedupeKey: href,
                coordinatorKey: href,
                queuedAt: 2000,
                updatedAt: 2000,
                attemptId,
                attemptNumber: 1,
                milestones: {}
            }
        },
        mbCoordinatorRuns: {
            [runId]: {
                id: runId,
                sourceType: 'profile-search',
                status: 'active',
                targetProfileHrefs: [href],
                targetWorkKeys: [href]
            }
        },
        mbCoordinatorEvents: [],
        mbProfileNukeProgress: {}
    })
    const existingSurface = await browser.windows.create({
        url: browser.runtime.getURL('coordinator.html#worker-window'),
        focused: false,
        type: 'normal'
    })
    const duplicateSurface = await browser.windows.create({
        url: browser.runtime.getURL('coordinator.html#worker-window'),
        focused: false,
        type: 'normal'
    })
    const {sw, storage, timers} = loadServiceWorkerHarness({browser, now: 2085})
    const userTab = await browser.tabs.create({url: 'https://www.quora.com/search?q=elon', active: true})
    const windowCountBefore = browser.__windows.size

    await settleWithFakeTimers(sw.resumeCoordinatorQueueExecution({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true
    }), timers)
    await waitFor(
        () => !browser.__windows.has(duplicateSurface.id),
        'duplicate worker action surface was not closed',
        {timers, attempts: 20, tickMs: 100}
    )

    const profileTab = listTabs(browser).find(tab => tab.url === href)
    assert.equal(browser.__windows.size, windowCountBefore - 1)
    assert.ok(browser.__windows.has(existingSurface.id))
    assert.equal(profileTab?.windowId, existingSurface.id)
    assert.equal((await browser.tabs.get(userTab.id)).active, true)
    await waitFor(
        () => storage.mbProfileNukeProgress[href]?.actionSurfaceMode === 'worker-window',
        'reused worker action surface progress was not recorded',
        {timers, attempts: 20, tickMs: 100}
    )
    assert.equal(storage.mbProfileNukeProgress[href].actionSurfaceMode, 'worker-window')
    assert.equal(sw.state().queueWakeupCounters['actionSurface.workerWindow.created'] || 0, 0)
    assert.ok(browser.__removedTabs.includes(duplicateSurface.tabs[0].id))
})

test('service-worker closes idle orphan worker windows after Quora activation', async () => {
    const browser = createFakeBrowser({
        mbCoordinatorPaused: false,
        mbCoordinatorQueue: {},
        mbCoordinatorRuns: {},
        mbCoordinatorEvents: [],
        mbProfileNukeProgress: {}
    })
    const orphanSurface = await browser.windows.create({
        url: browser.runtime.getURL('coordinator.html#worker-window'),
        focused: false,
        type: 'normal'
    })
    const {timers} = loadServiceWorkerHarness({browser, now: 2087})
    await browser.tabs.create({url: 'https://www.quora.com/search?q=elon', active: true})

    await activateQuoraRuntime(browser, 'https://www.quora.com/search?q=elon')
    await timers.tick(6000)
    await flushAsync(20)

    assert.equal(browser.__windows.has(orphanSurface.id), false)
    assert.ok(browser.__removedTabs.includes(orphanSurface.tabs[0].id))
})

test('service-worker worker window closes after queued worker surface becomes idle', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Worker-Surface-Idle'
    const runId = 'run-worker-surface-idle'
    const attemptId = 'attempt-worker-surface-idle'
    const {browser, sw, timers} = loadServiceWorkerHarness({
        now: 2088,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 2000,
                    updatedAt: 2000,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    await browser.tabs.create({url: 'https://www.quora.com/search?q=elon', active: true})

    await settleWithFakeTimers(sw.resumeCoordinatorQueueExecution({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true
    }), timers)

    const profileTab = listTabs(browser).find(tab => tab.url === href)
    assert.ok(profileTab?.id)
    const workerWindowId = profileTab.windowId
    assert.ok(browser.__windows.has(workerWindowId))

    await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'record-job-terminal',
        profileHref: href,
        patch: {
            status: 'blocked',
            blockSucceeded: true,
            blockedAt: 2100,
            terminalAt: 2100,
            actionKind: 'mute-block',
            runId,
            attemptId,
            attemptNumber: 1
        },
        attemptId,
        attemptNumber: 1
    }, {
        tab: {id: profileTab.id, url: href, windowId: workerWindowId}
    }), timers)

    await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'close-tab',
        attemptId,
        attemptNumber: 1
    }, {
        tab: {id: profileTab.id, url: href, windowId: workerWindowId}
    }), timers)
    await timers.tick(2000)
    await flushAsync(20)

    assert.equal(browser.__windows.has(workerWindowId), false)
    assert.ok(browser.__removedTabs.includes(profileTab.id))
})

test('confirmation promotion in no-foreground worker window briefly focuses and restores caller window', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Worker-Surface-Promote'
    const runId = 'run-worker-surface-promote'
    const attemptId = 'attempt-worker-surface-promote'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 2090,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 2000,
                    updatedAt: 2000,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const userTab = await browser.tabs.create({url: 'https://www.quora.com/search?q=elon', active: true})

    await settleWithFakeTimers(sw.resumeCoordinatorQueueExecution({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true
    }), timers)

    const profileTab = listTabs(browser).find(tab => tab.url === href)
    const workerWindowId = profileTab.windowId
    const claimed = await browser.runtime.sendMessage({action: 'claim-tab-action'}, {tab: profileTab})

    assert.equal(claimed.noForegroundFallback, true)
    assert.equal(claimed.actionSurfaceMode, 'worker-window')
    browser.__windowUpdates.splice(0, browser.__windowUpdates.length)

    const result = await browser.runtime.sendMessage({
        action: 'begin-profile-action',
        profileHref: href,
        actionKind: 'mute-block',
        reason: 'block-confirmation',
        attemptId,
        attemptNumber: 1
    }, {tab: profileTab})

    const metadata = sw.state().queuedTabMetadata.find(([tabId]) => tabId === profileTab.id)?.[1] || {}
    assert.equal(result.begun, true)
    assert.equal(result.foregroundPromoted, true)
    assert.equal(result.foregroundMode, 'worker-window')
    assert.equal(metadata.foregroundMode, 'worker-window')
    assert.equal(metadata.foregroundPromotionReason, 'block-confirmation')
    assert.equal(metadata.foregroundRestoreTabId, userTab.id)
    assert.equal(metadata.foregroundRestoreWindowId, userTab.windowId)
    assert.equal(browser.__windowUpdates.some(update =>
        update.windowId === workerWindowId && update.options?.focused === true
    ), true)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.tabId, profileTab.id)

    browser.__windowUpdates.splice(0, browser.__windowUpdates.length)
    const released = await browser.runtime.sendMessage({
        action: 'release-action-lease',
        profileHref: href,
        actionKind: 'mute-block',
        reason: 'confirmation-finished',
        attemptId,
        attemptNumber: 1
    }, {tab: profileTab})

    assert.equal(released.released, true)
    assert.equal((await browser.tabs.get(userTab.id)).active, true)
    assert.equal(browser.__windows.get(userTab.windowId).focused, true)
    assert.equal(browser.__windowUpdates.some(update =>
        update.windowId === userTab.windowId && update.options?.focused === true
    ), true)
})

test('service-worker queued action preserves no-foreground profile-search policy when claimed', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-No-Foreground-Policy'
    const runId = 'run-no-foreground-policy'
    const sourceSender = {tab: {id: 111, windowId: 1}}
    const {browser, timers} = loadServiceWorkerHarness({now: 2250})

    await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender)

    const tab = await waitFor(
        () => listTabs(browser).find(candidate => candidate.url === href),
        'service-worker executor tab was not opened for no-foreground policy test',
        {timers}
    )

    const claim = await waitFor(
        () => browser.runtime.sendMessage({action: 'claim-tab-action'}, {tab}),
        'executor tab did not claim its no-foreground queued action',
        {timers}
    )

    assert.equal(claim.noForegroundFallback, true)
})

test('failed retry preserves no-foreground executor policy when claimed', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Retry-No-Foreground'
    const runId = 'run-retry-no-foreground-policy'
    const attemptId = 'attempt-retry-no-foreground-original'
    const {browser, storage, timers} = loadServiceWorkerHarness({
        now: 2300,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    id: 'item-retry-no-foreground-policy',
                    runId,
                    status: 'failed',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 2100,
                    activeAt: 2200,
                    updatedAt: 2250,
                    terminalAt: 2250,
                    attemptId,
                    attemptNumber: 1,
                    outcome: 'action-error',
                    error: 'synthetic failure',
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'complete',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser, 'https://www.quora.com/space/example')

    const retry = await browser.runtime.sendMessage({
        action: 'retry-coordinator-failed',
        maxItems: 1,
        retryLimit: 2
    })

    assert.equal(retry.selected, 1)
    await waitFor(
        () => listTabs(browser).find(candidate => candidate.url === href),
        'retry no-foreground executor tab was not opened',
        {timers, attempts: 40, tickMs: 1000}
    )

    assert.equal(storage.mbCoordinatorQueue[href].executorNoForegroundFallback, true)
    const tab = listTabs(browser).find(candidate => candidate.url === href)
    const claim = await waitFor(
        () => browser.runtime.sendMessage({action: 'claim-tab-action'}, {tab}),
        'retry no-foreground executor tab did not claim its queued action',
        {timers}
    )

    assert.equal(claim.noForegroundFallback, true)
})

test('manual failed requeue preserves no-foreground executor policy when claimed', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Requeue-No-Foreground'
    const runId = 'run-requeue-no-foreground-policy'
    const attemptId = 'attempt-requeue-no-foreground-original'
    const {browser, storage, timers} = loadServiceWorkerHarness({
        now: 2400,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    id: 'item-requeue-no-foreground-policy',
                    runId,
                    status: 'failed',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 2200,
                    activeAt: 2300,
                    updatedAt: 2350,
                    terminalAt: 2350,
                    attemptId,
                    attemptNumber: 1,
                    outcome: 'action-error',
                    error: 'synthetic failure',
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'complete',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser, 'https://www.quora.com/space/example')

    const requeue = await browser.runtime.sendMessage({
        action: 'requeue-coordinator-failed',
        profileHrefs: [href],
        maxConcurrent: 1
    })

    assert.equal(requeue.selected, 1)
    await waitFor(
        () => listTabs(browser).find(candidate => candidate.url === href),
        'requeue no-foreground executor tab was not opened',
        {timers, attempts: 40, tickMs: 1000}
    )

    assert.equal(storage.mbCoordinatorQueue[href].executorNoForegroundFallback, true)
    const tab = listTabs(browser).find(candidate => candidate.url === href)
    const claim = await waitFor(
        () => browser.runtime.sendMessage({action: 'claim-tab-action'}, {tab}),
        'requeue no-foreground executor tab did not claim its queued action',
        {timers}
    )

    assert.equal(claim.noForegroundFallback, true)
})

test('queued profile actions are throttled and opened background', async () => {
    const firstHref = 'https://www.quora.com/profile/Synthetic-Legacy-Foreground-1'
    const secondHref = 'https://www.quora.com/profile/Synthetic-Legacy-Foreground-2'
    const runId = 'run-legacy-foreground-throttle'
    const sourceSender = {tab: {id: 12, windowId: 1}}
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({now: 2500})

    await browser.runtime.sendMessage({
        action: 'enqueue-coordinator-items',
        run: {
            id: runId,
            sourceType: 'profile-search'
        },
        source: {
            type: 'profile-search',
            pageUrl: 'https://www.quora.com/search?q=synthetic&type=profile'
        },
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 3,
            noForegroundFallback: true
        },
        items: [firstHref, secondHref].map(href => ({
            runId,
            targetProfileHref: href,
            requestedUrl: href,
            dedupeKey: href
        }))
    }, sourceSender)

    const opened = await waitFor(
        () => {
            const tabs = listTabs(browser).filter(tab => [firstHref, secondHref].includes(tab.url))
            return tabs.length ? tabs : null
        },
        'queued profile throttle did not open an executor tab',
        {timers}
    )

    assert.equal(opened.length, 1)
    assert.equal(opened[0].active, true)
    await waitFor(
        () => sw.coordinatorAuthority.current().queue[opened[0].url]?.status === 'active',
        'legacy foreground executor tab did not persist active authority state',
        {timers}
    )

    const queuedHref = opened[0].url === firstHref ? secondHref : firstHref
    assert.equal(getRecoveredCoordinatorQueue(storage)[queuedHref].status, 'queued')
})

test('begin-profile-action grants initial action gate without foreground promotion', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Promote-Action'
    const runId = 'run-promote-action'
    const attemptId = 'attempt-promote-action'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: false,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 2900,
                    activeAt: 3000,
                    updatedAt: 3000,
                    tabId: 250,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__setNextTabId(250)
    const tab = await browser.tabs.create({url: href, active: false})
    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        runId,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        noForegroundFallback: false,
        attemptId,
        attemptNumber: 1
    })

    const result = await browser.runtime.sendMessage({
        action: 'begin-profile-action',
        profileHref: href,
        actionKind: 'mute-block',
        reason: 'mute-block-profile-menu-action',
        attemptId,
        attemptNumber: 1
    }, {tab})

    assert.equal(result.begun, true)
    assert.equal(result.granted, true)
    assert.equal(result.foregroundPromoted, false)
    assert.equal((await browser.tabs.get(tab.id)).active, false)
    const metadata = sw.state().queuedTabMetadata.find(([tabId]) => tabId === tab.id)?.[1] || {}
    assert.equal(metadata.foregroundPromotionReason || '', '')
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.tabId, tab.id)
})

test('begin-profile-action promotes a hidden confirmation action', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Promote-Confirmation'
    const runId = 'run-promote-confirmation'
    const attemptId = 'attempt-promote-confirmation'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3025,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: false,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 2925,
                    activeAt: 3025,
                    updatedAt: 3025,
                    tabId: 252,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__setNextTabId(252)
    const tab = await browser.tabs.create({url: href, active: false})
    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        runId,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        noForegroundFallback: false,
        attemptId,
        attemptNumber: 1
    })

    const result = await browser.runtime.sendMessage({
        action: 'begin-profile-action',
        profileHref: href,
        actionKind: 'mute-block',
        reason: 'block-confirmation',
        attemptId,
        attemptNumber: 1
    }, {tab})

    assert.equal(result.begun, true)
    assert.equal(result.granted, true)
    assert.equal(result.foregroundPromoted, true)
    assert.equal((await browser.tabs.get(tab.id)).active, true)
    const metadata = sw.state().queuedTabMetadata.find(([tabId]) => tabId === tab.id)?.[1] || {}
    assert.equal(metadata.foregroundPromotionReason, 'block-confirmation')
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.tabId, tab.id)
})

test('begin-profile-action denies and releases lease when foreground promotion fails', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Promote-Denied'
    const runId = 'run-promote-denied'
    const attemptId = 'attempt-promote-denied'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3050,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 2950,
                    activeAt: 3050,
                    updatedAt: 3050,
                    tabId: 251,
                    attemptId,
                    attemptNumber: 1,
                    milestones: {}
                }
            },
            mbCoordinatorRuns: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__setNextTabId(251)
    const tab = await browser.tabs.create({url: href, active: false})
    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        runId,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        noForegroundFallback: true,
        attemptId,
        attemptNumber: 1
    })

    const result = await browser.runtime.sendMessage({
        action: 'begin-profile-action',
        profileHref: href,
        actionKind: 'mute-block',
        reason: 'block-confirmation',
        attemptId,
        attemptNumber: 1
    }, {tab})

    assert.equal(result.begun, false)
    assert.equal(result.granted, false)
    assert.equal(result.foregroundPromotionFailed, true)
    assert.equal(result.reason, 'foreground-fallback-disabled')
    assert.equal((await browser.tabs.get(tab.id)).active, false)
    const recoveredQueue = recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue
    assert.equal(recoveredQueue[href].actionLease, null)
    assert.equal(recoveredQueue[href].actionLeaseReleaseReason, 'foreground-promotion-failed:foreground-fallback-disabled')
})

test('storage-only coordinator enqueue stays durable without starting service-worker execution', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Storage-Only'
    const runId = 'run-storage-only'
    const sourceSender = {tab: {id: 12, windowId: 1}}
    const {browser, storage, timers} = loadServiceWorkerHarness({now: 3000})

    const enqueue = await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId
    }), sourceSender)

    assert.equal(enqueue.executionDeferred, true)
    assert.equal(storage.mbCoordinatorQueue?.[href], undefined)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].executorOwner, '')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].serviceWorkerOwned, false)

    await flushAsync(8)
    await timers.tick(0)

    assert.deepEqual(listTabs(browser), [])
})

test('enqueue WAL append failure does not reset active owned tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Enqueue-Wal-Failure-Reset'
    const runId = 'run-enqueue-wal-failure-existing'
    const nextRunId = 'run-enqueue-wal-failure-reset'
    const attemptId = 'attempt-enqueue-wal-failure-existing'
    const tabId = 790
    const sourceSender = {tab: {id: 12, windowId: 1}}
    const {browser, storage, timers} = loadServiceWorkerHarness({
        now: 3050,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 3050})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 3050
                }
            }
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic enqueue WAL append failure')
        }
        return originalSet(payload)
    }

    const enqueue = await browser.runtime.sendMessage({
        action: 'enqueue-coordinator-items',
        run: {
            id: nextRunId,
            sourceType: 'space-feed',
            resetExisting: true
        },
        source: {
            type: 'space-feed',
            pageUrl: 'https://www.quora.com/space/example'
        },
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        },
        items: [{
            targetProfileHref: href,
            requestedUrl: href,
            dedupeKey: href,
            resetExisting: true
        }]
    }, sourceSender)

    assert.equal(enqueue.queued, 0)
    assert.equal(enqueue.merged, 0)
    assert.equal(enqueue.durable, false)
    assert.equal(enqueue.persistence.saved, false)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    browser.storage.local.set = originalSet

    await flushAsync(20)
    await timers.tick(0)

    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[href].tabId, tabId)
    assert.equal(storage.mbCoordinatorRuns[nextRunId], undefined)
})

test('enqueue derived save failure keeps WAL row durable and repair rebuilds derived state', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Enqueue-Derived-Failure'
    const runId = 'run-enqueue-derived-failure'
    const sourceSender = {tab: {id: 12, windowId: 1}}
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3075,
        storage: {
            mbCoordinatorPaused: true,
            mbCoordinatorQueue: {},
            mbCoordinatorRuns: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorRuns && payload?.mbCoordinatorEvents && !payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic enqueue derived save failure')
        }
        return originalSet(payload)
    }

    const enqueue = await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender)

    assert.equal(enqueue.queued, 1)
    assert.equal(enqueue.durable, true)
    assert.equal(enqueue.derivedSaved, false)
    assert.equal(storage.mbCoordinatorQueue?.[href], undefined)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].runId, runId)
    assert.equal(storage.mbCoordinatorRuns?.[runId], undefined)
    assert.equal(storage.mbProfileNukeProgress?.[href], undefined)
    assert.equal(sw.state().hasStoredWorkRepairTimeout, true)
    browser.storage.local.set = originalSet

    const repair = await sw.repairCoordinatorStorageFromProgress()

    assert.ok(repair.repaired > 0)
    assert.equal(repair.runsChanged, true)
    assert.equal(repair.progressChanged, true)
    assert.equal(repair.eventsChanged, true)
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), true)
    assert.equal(storage.mbCoordinatorRuns[runId].targetWorkKeys.includes(href), true)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'queued')
    assert.equal(storage.mbProfileNukeProgress[href].runId, runId)
    assert.equal(storage.mbProfileNukeProgress[href].attemptId, getRecoveredCoordinatorQueue(storage)[href].attemptId)
    assert.equal(storage.mbCoordinatorEvents.some(event =>
        event.runId === runId &&
        event.type === 'repair' &&
        event.details?.reason === 'enqueue-derived-repair'
    ), true)
})

test('enqueue resetExisting derived save failure repair replaces stale progress attempt', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Enqueue-Reset-Derived-Failure'
    const oldRunId = 'run-enqueue-reset-derived-old'
    const nextRunId = 'run-enqueue-reset-derived-next'
    const oldAttemptId = 'attempt-enqueue-reset-derived-old'
    const sourceSender = {tab: {id: 12, windowId: 1}}
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3090,
        storage: {
            mbCoordinatorPaused: true,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId: oldRunId, attemptId: oldAttemptId, tabId: 791, now: 3090})
            },
            mbCoordinatorRuns: {
                [oldRunId]: makeCoordinatorRun({href, runId: oldRunId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'tab-opened',
                    runId: oldRunId,
                    tabId: 791,
                    actionKind: 'mute-block',
                    attemptId: oldAttemptId,
                    attemptNumber: 1,
                    blockAttempted: true,
                    blockSucceeded: false,
                    updatedAt: 3080
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorRuns && payload?.mbCoordinatorEvents && !payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic reset enqueue derived save failure')
        }
        return originalSet(payload)
    }

    const enqueue = await browser.runtime.sendMessage({
        action: 'enqueue-coordinator-items',
        run: {
            id: nextRunId,
            sourceType: 'space-feed',
            resetExisting: true
        },
        source: {
            type: 'space-feed',
            pageUrl: 'https://www.quora.com/space/example'
        },
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        },
        items: [{
            targetProfileHref: href,
            requestedUrl: href,
            dedupeKey: href,
            resetExisting: true
        }]
    }, sourceSender)

    assert.equal(enqueue.merged, 1)
    assert.equal(enqueue.durable, true)
    assert.equal(enqueue.derivedSaved, false)
    const walRow = getRecoveredCoordinatorQueue(storage)[href]
    assert.equal(walRow.status, 'queued')
    assert.equal(walRow.runId, nextRunId)
    assert.notEqual(walRow.attemptId, oldAttemptId)
    assert.equal(walRow.attemptNumber, 2)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opened')
    assert.equal(storage.mbProfileNukeProgress[href].runId, oldRunId)
    assert.equal(storage.mbProfileNukeProgress[href].attemptId, oldAttemptId)
    browser.storage.local.set = originalSet

    const repair = await sw.repairCoordinatorStorageFromProgress()

    assert.ok(repair.repaired > 0)
    assert.equal(repair.progressChanged, true)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'queued')
    assert.equal(storage.mbProfileNukeProgress[href].runId, nextRunId)
    assert.equal(storage.mbProfileNukeProgress[href].attemptId, walRow.attemptId)
    assert.equal(storage.mbProfileNukeProgress[href].attemptNumber, walRow.attemptNumber)
    assert.equal(storage.mbProfileNukeProgress[href].tabId, null)
    assert.equal(storage.mbProfileNukeProgress[href].blockAttempted, false)
    assert.equal(storage.mbCoordinatorRuns[nextRunId].targetProfileHrefs.includes(href), true)
    assert.equal(storage.mbCoordinatorEvents.some(event =>
        event.runId === nextRunId &&
        event.type === 'repair' &&
        event.details?.reason === 'enqueue-derived-repair'
    ), true)
})

test('executable enqueue preserves explicit pause and does not open worker tabs', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Paused-Enqueue'
    const runId = 'run-paused-executable-enqueue'
    const sourceSender = {tab: {id: 13, windowId: 1}}
    const {browser, storage, timers} = loadServiceWorkerHarness({
        now: 3100,
        storage: {
            mbCoordinatorPaused: true,
            mbCoordinatorQueue: {},
            mbCoordinatorRuns: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const enqueue = await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender)

    assert.equal(enqueue.queued, 1)
    assert.equal(enqueue.executionDeferred, true)
    assert.equal(storage.mbCoordinatorPaused, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')

    await flushAsync(20)
    await timers.tick(0)
    await timers.tick(1000)
    await browser.alarms.onAlarm.emit({name: 'mb-coordinator-resume'})
    await browser.alarms.onAlarm.emit({name: 'mb-stored-work-repair'})
    await flushAsync(20)

    assert.equal(storage.mbCoordinatorPaused, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.deepEqual(listTabs(browser), [])
})

test('dashboard resume opens durable service-worker queued rows after volatile executor state is gone', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Durable-Queued'
    const runId = 'run-durable-queued-resume'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3200,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    id: 'item-durable-queued-resume',
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 3000,
                    updatedAt: 3000,
                    attemptId: 'attempt-durable-queued-resume',
                    attemptNumber: 2
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'failed-requeue',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser, href)

    const result = await settleWithFakeTimers(
        browser.runtime.sendMessage({action: 'resume-coordinator-queue'}),
        timers,
        [0, 500, 1000, 5000]
    )

    assert.equal(result.recovered, false)
    assert.equal(result.scheduledOnly, true)
    assert.equal(result.reason, 'dashboard-resume-scheduled')

    const alarmPromise = browser.alarms.onAlarm.emit({name: 'mb-coordinator-resume'})
    alarmPromise.catch(() => null)
    await timers.tick(0)

    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'async durable queued resume did not open a profile tab',
        {timers, attempts: 40, tickMs: 1000}
    )
    await waitFor(
        () => ['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status),
        'async durable queued resume did not persist active queue authority state',
        {timers}
    )
})

test('resume rebuilds durable work after stale volatile queued action skips without opening', async () => {
    const href = 'https://www.quora.com/profile/Rebuild-After-Stale-Volatile'
    const staleHref = 'https://www.quora.com/profile/Stale-Volatile-Missing'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3300,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    createdAt: 0,
                    updatedAt: 0
                }
            },
            mbCoordinatorRuns: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser)
    sw.__testAddQueuedAction({
        url: staleHref,
        profileHref: staleHref,
        coordinatorKey: staleHref,
        ownerTabId: 'service-worker-queue-owner'
    })

    const resumePromise = sw.resumeCoordinatorQueueExecution({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true
    })
    resumePromise.catch(() => null)

    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'durable queued row was not rebuilt after stale volatile action',
        {timers, attempts: 40, tickMs: 1000}
    )
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
})

test('stored work repair drops stale volatile queued actions before durable resume', async () => {
    const href = 'https://www.quora.com/profile/Repair-Rebuild-After-Stale-Volatile'
    const staleHref = 'https://www.quora.com/profile/Repair-Stale-Volatile-Missing'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3400,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    createdAt: 0,
                    updatedAt: 0
                }
            },
            mbCoordinatorRuns: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    sw.__testAddQueuedAction({
        url: staleHref,
        profileHref: staleHref,
        coordinatorKey: staleHref,
        ownerTabId: 'service-worker-queue-owner'
    })

    assert.equal(sw.state().queuedTabActions.length, 1)

    await activateQuoraRuntime(browser)
    const repairPromise = sw.runStoredWorkRepairTick('scheduled-stored-work-repair')
    repairPromise.catch(() => null)

    await waitFor(
        () => sw.state().queuedTabActions.length === 0 &&
            listTabs(browser).some(tab => tab.url === href),
        'stored work repair did not drop stale volatile action and resume durable row',
        {timers, attempts: 40, tickMs: 1000}
    )

    assert.equal(sw.state().queuedTabActions.length, 0)
    assert.equal(listTabs(browser).some(tab => tab.url === href), true)
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
})

test('volatile action pruning uses WAL terminal authority over stale raw active queue', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Prune-Wal-Terminal'
    const runId = 'run-prune-wal-terminal'
    const attemptId = 'attempt-prune-wal-terminal'
    const tabId = 683
    const firstHarness = loadServiceWorkerHarness({
        now: 3450,
        storage: {
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 3450})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'blocking',
                    runId,
                    tabId,
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1
                }
            }
        }
    })

    await firstHarness.sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 3500,
        terminalAt: 3500,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })
    assert.equal(firstHarness.storage.mbCoordinatorQueue[href].status, 'active')

    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3600,
        storage: firstHarness.storage
    })
    sw.__testAddQueuedAction({
        url: href,
        profileHref: href,
        coordinatorKey: href,
        ownerTabId: 'service-worker-queue-owner',
        runId,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1
    })
    assert.equal(sw.state().queuedTabActions.length, 1)

    await activateQuoraRuntime(browser)
    const result = await sw.resumeCoordinatorQueueExecution({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-prune-wal-terminal'
    })
    await timers.tick(0)

    assert.equal(result.queued, 0)
    assert.equal(sw.state().queuedTabActions.length, 0)
    assert.equal(listTabs(browser).some(tab => tab.url === href), false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal((await sw.coordinatorAuthority.hydrate()).queue[href].status, 'succeeded')
})

test('executable enqueue timeout does not start raw request executor work', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Timeout-No-Raw-Executor'
    const runId = 'run-timeout-no-raw-executor'
    const sourceSender = {tab: {id: 121, windowId: 1}}
    const {browser, timers} = loadServiceWorkerHarness({now: 3500})
    const originalSet = browser.storage.local.set

    browser.storage.local.set = async payload => {
        if(Object.prototype.hasOwnProperty.call(payload || {}, 'mbCoordinatorQueueWal')) {
            return new Promise(() => {})
        }
        return originalSet(payload)
    }

    const enqueue = await settleWithFakeTimers(browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender), timers)

    assert.equal(enqueue.storageTimedOut, true)
    assert.equal(enqueue.executionDeferred, false)

    await flushAsync(20)
    await timers.tick(0)

    assert.deepEqual(listTabs(browser), [])
})

test('queued tab active transition timeout closes unconfirmed runtime tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Unconfirmed-Active'
    const runId = 'run-unconfirmed-active'
    const sourceSender = {tab: {id: 122, windowId: 1}}
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({now: 3600})
    const originalCreate = browser.tabs.create
    const originalGet = browser.storage.local.get
    let createdTabId = 0

    browser.tabs.create = async options => {
        const tab = await originalCreate(options)
        if(tab.url === href) createdTabId = tab.id
        return tab
    }
    browser.storage.local.get = async defaults => {
        if(
            createdTabId &&
            defaults &&
            typeof defaults === 'object' &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueue') &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorRuns')
        ) {
            return new Promise(() => {})
        }
        return originalGet(defaults)
    }

    await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender)

    const tab = await waitFor(
        () => listTabs(browser).find(candidate => candidate.url === href),
        'service-worker executor tab was not opened for unconfirmed-active test',
        {timers}
    )
    assert.equal(tab.id, createdTabId)

    await waitFor(
        () => browser.__removedTabs.includes(createdTabId),
        'unconfirmed active queued tab was not closed after durable transition timeout',
        {timers, tickMs: sw.state().constants.SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS}
    )
    await waitFor(
        () => !sw.state().activeQueuedTabs.includes(createdTabId),
        'unconfirmed active queued tab runtime state was not detached',
        {timers}
    )

    assert.equal(listTabs(browser).some(candidate => candidate.id === createdTabId), false)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
})

test('active transition is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Wal'
    const runId = 'run-active-transition-wal'
    const attemptId = 'attempt-active-transition-wal'
    const tabId = 630
    const {storage, sw} = loadServiceWorkerHarness({
        now: 431000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 431000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.transitionCoordinatorItemForQueuedTab({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        attemptId,
        attemptNumber: 1
    }, {
        id: tabId
    }, {
        openedAt: 431050,
        attemptId,
        attemptNumber: 1,
        retryAttempt: 0,
        maxRetries: 2
    })

    assert.equal(result, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, tabId)

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'active-transition')

    const restarted = loadServiceWorkerHarness({
        now: 431500,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'active')
    assert.equal(hydrated.queue[href].tabId, tabId)
})

test('active transition rejects stale attempt before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Stale'
    const runId = 'run-active-transition-stale'
    const attemptId = 'attempt-active-transition-stale'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 432000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 432000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.transitionCoordinatorItemForQueuedTab({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        attemptId: 'stale-active-transition-attempt',
        attemptNumber: 1
    }, {
        id: 631
    }, {
        openedAt: 432050,
        attemptId: 'stale-active-transition-attempt',
        attemptNumber: 1,
        retryAttempt: 0,
        maxRetries: 2
    })

    assert.equal(result, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
})

test('active transition rejects missing incoming attempt identity before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Missing-Incoming'
    const runId = 'run-active-transition-missing-incoming'
    const attemptId = 'attempt-active-transition-missing-incoming'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 432250,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 432250})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.transitionCoordinatorItemForQueuedTab({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke'
    }, {
        id: 633
    }, {
        openedAt: 432300,
        retryAttempt: 0,
        maxRetries: 2
    })

    assert.equal(result, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].status, 'queued')
})

test('active transition WAL append failure leaves row queued', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Append-Failure'
    const runId = 'run-active-transition-append-failure'
    const attemptId = 'attempt-active-transition-append-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 432500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 432500})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic active transition WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.transitionCoordinatorItemForQueuedTab({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        attemptId,
        attemptNumber: 1
    }, {
        id: 632
    }, {
        openedAt: 432550,
        attemptId,
        attemptNumber: 1,
        retryAttempt: 0,
        maxRetries: 2
    })

    assert.equal(result, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
})

test('active transition rollback is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Rollback-Wal'
    const runId = 'run-rollback-wal'
    const attemptId = 'attempt-rollback-wal'
    const tabId = 640
    const {storage, sw} = loadServiceWorkerHarness({
        now: 433000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 433000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.rollbackFailedQueuedTabOpen({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1
    }, {
        id: tabId
    }, {
        attemptId,
        attemptNumber: 1
    })

    assert.equal(result, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueView.counts.queued, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLeaseReleaseReason, 'active-transition-failed')

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'rollback-active-transition')

    const restarted = loadServiceWorkerHarness({
        now: 433500,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'queued')
    assert.equal(hydrated.queue[href].tabId, null)
})

test('active transition rollback rejects stale attempt before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Rollback-Stale'
    const runId = 'run-rollback-stale'
    const attemptId = 'attempt-rollback-stale'
    const tabId = 641
    const {storage, sw} = loadServiceWorkerHarness({
        now: 434000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 434000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.rollbackFailedQueuedTabOpen({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        attemptId: 'stale-rollback-attempt',
        attemptNumber: 1
    }, {
        id: tabId
    }, {
        attemptId: 'stale-rollback-attempt',
        attemptNumber: 1
    })

    assert.equal(result, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
})

test('active transition rollback rejects missing incoming attempt identity before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Rollback-Missing-Incoming'
    const runId = 'run-rollback-missing-incoming'
    const attemptId = 'attempt-rollback-missing-incoming'
    const tabId = 6411
    const {storage, sw} = loadServiceWorkerHarness({
        now: 434500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 434500})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.rollbackFailedQueuedTabOpen({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block'
    }, {
        id: tabId
    }, {})

    assert.equal(result, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[href].attemptId, attemptId)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].status, 'active')
    assert.equal(currentAuthority.queue[href].attemptId, attemptId)
})

test('active transition rollback rejects queued row before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Rollback-Queued-Row'
    const runId = 'run-rollback-queued-row'
    const attemptId = 'attempt-rollback-queued-row'
    const tabId = 6412
    const {storage, sw} = loadServiceWorkerHarness({
        now: 434750,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 434750})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.rollbackFailedQueuedTabOpen({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1
    }, {
        id: tabId
    }, {
        attemptId,
        attemptNumber: 1
    })

    assert.equal(result, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[href].actionLeaseReleaseReason, undefined)
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].status, 'queued')
    assert.equal(currentAuthority.queue[href].actionLeaseReleaseReason, undefined)
})

test('active transition rollback WAL append failure leaves row active', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Rollback-Append-Failure'
    const runId = 'run-rollback-append-failure'
    const attemptId = 'attempt-rollback-append-failure'
    const tabId = 642
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 435000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 435000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic rollback WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.rollbackFailedQueuedTabOpen({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1
    }, {
        id: tabId
    }, {
        attemptId,
        attemptNumber: 1
    })

    assert.equal(result, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
})

test('late active confirmation rejects reclaimed attempt for the same tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Reclaimed-Active'
    const runId = 'run-reclaimed-active'
    const sourceSender = {tab: {id: 123, windowId: 1}}
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({now: 3625})
    const originalCreate = browser.tabs.create
    const originalGet = browser.storage.local.get
    let createdTabId = 0
    let queueRunsReadsAfterOpen = 0
    let queueOnlyReadsAfterOpen = 0

    browser.tabs.create = async options => {
        const tab = await originalCreate(options)
        if(tab.url === href) createdTabId = tab.id
        return tab
    }
    browser.storage.local.get = async defaults => {
        const readsQueue = defaults &&
            typeof defaults === 'object' &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueue')
        const readsRuns = defaults &&
            typeof defaults === 'object' &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorRuns')

        if(createdTabId && readsQueue && readsRuns) {
            queueRunsReadsAfterOpen += 1
            if(queueRunsReadsAfterOpen === 1) {
                return new Promise(() => {})
            }
        }
        if(createdTabId && readsQueue && !readsRuns) {
            queueOnlyReadsAfterOpen += 1
            if(queueOnlyReadsAfterOpen === 1) {
                storage.mbCoordinatorQueue = storage.mbCoordinatorQueue || {}
                storage.mbCoordinatorQueue[href] = {
                    ...getRecoveredCoordinatorQueue(storage)[href],
                    status: 'active',
                    tabId: createdTabId,
                    activeTabId: createdTabId,
                    activeAt: timers.now,
                    updatedAt: timers.now,
                    attemptId: 'attempt-reclaimed-active',
                    attemptNumber: 99
                }
                return {
                    mbCoordinatorQueue: JSON.parse(JSON.stringify(storage.mbCoordinatorQueue))
                }
            }
        }

        return originalGet(defaults)
    }

    await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender)

    const tab = await waitFor(
        () => listTabs(browser).find(candidate => candidate.url === href),
        'service-worker executor tab was not opened for reclaimed-active test',
        {timers}
    )
    assert.equal(tab.id, createdTabId)
    storage.mbCoordinatorQueue = storage.mbCoordinatorQueue || {}
    storage.mbCoordinatorQueue[href] = {
        ...getRecoveredCoordinatorQueue(storage)[href],
        status: 'active',
        tabId: createdTabId,
        activeTabId: createdTabId,
        activeAt: timers.now,
        updatedAt: timers.now,
        attemptId: 'attempt-reclaimed-active',
        attemptNumber: 99
    }

    await waitFor(
        () => browser.__removedTabs.includes(createdTabId),
        'same-tab reclaimed attempt was adopted instead of closed',
        {timers, tickMs: sw.state().constants.SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS}
    )
    await waitFor(
        () => !sw.state().activeQueuedTabs.includes(createdTabId),
        'same-tab reclaimed attempt left provisional runtime state behind',
        {timers}
    )

    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[href].tabId, createdTabId)
    assert.equal(storage.mbCoordinatorQueue[href].attemptId, 'attempt-reclaimed-active')
    assert.equal(storage.mbCoordinatorQueue[href].attemptNumber, 99)
})

test('resume ignores provisional queued tab runtime ownership', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Provisional-Runtime'
    const runId = 'run-provisional-runtime'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3650,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 3000,
                    updatedAt: 3000,
                    attemptId: 'attempt-provisional-runtime',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'failed-requeue',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(777, {
        id: 777,
        windowId: 1,
        url: href,
        active: false
    })
    sw.__testAddProvisionalQueuedTab(777, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        attemptId: 'attempt-provisional-runtime',
        attemptNumber: 1,
        openedAt: 3600
    })

    const resumePromise = sw.resumeCoordinatorQueueExecutionOnce({tabId: 'service-worker-queue-owner'}, {
        serviceWorkerOwned: true,
        awaitFill: true
    })
    resumePromise.catch(() => null)

    await waitFor(
        () => getRecoveredCoordinatorQueue(storage)[href]?.status === 'active',
        'resume did not ignore provisional runtime ownership and claim durable row',
        {timers, attempts: 40, tickMs: 1000}
    )
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')
})

test('claim-tab-action ignores queued storage rows without durable active ownership', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Queued-Storage-Claim'
    const runId = 'run-queued-storage-claim'
    const tabId = 778
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3675,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 3000,
                    updatedAt: 3000,
                    attemptId: 'attempt-queued-storage-claim',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    })

    const action = await browser.runtime.sendMessage({
        action: 'claim-tab-action'
    }, {
        tab: {
            id: tabId,
            windowId: 1,
            url: href
        }
    })

    assert.equal(action, null)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
})

test('authority reconcile requeues durable active row without runtime actor through WAL', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-No-Actor'
    const runId = 'run-active-no-actor'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 3900,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 3000,
                    activeAt: 3500,
                    updatedAt: 3500,
                    tabId: 701,
                    attemptId: 'attempt-active-no-actor',
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    actionKind: 'mute-block',
                    status: 'tab-opening',
                    tabId: 701,
                    tabOpenedAt: 3500,
                    attemptId: 'attempt-active-no-actor',
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1
                }
            }
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor')

    assert.equal(result.requeued, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueView.counts.queued, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, 'attempt-active-no-actor')
    assert.equal(sw.coordinatorAuthority.current().queue[href].attemptNumber, 2)
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, null)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'queued')
    assert.equal(storage.mbProfileNukeProgress[href].attemptId, sw.coordinatorAuthority.current().queue[href].attemptId)

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'repair-active-without-actor')

    const restarted = loadServiceWorkerHarness({
        now: 3950,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'queued')
    assert.equal(hydrated.queue[href].attemptNumber, 2)
    assert.equal(hydrated.queue[href].tabId, null)
})

test('authority reconcile rejects stale active-without-actor attempt before WAL append', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-No-Actor-Stale'
    const runId = 'run-active-no-actor-stale'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 3910,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId: 'attempt-active-no-actor-stale',
                        tabId: 702,
                        now: 3910
                    }),
                    retryAttempt: 0,
                    maxRetries: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    actionKind: 'mute-block',
                    status: 'tab-opening',
                    tabId: 702,
                    tabOpenedAt: 3500,
                    attemptId: 'attempt-active-no-actor-stale',
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1
                }
            }
        }
    })
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    let queueReads = 0
    browser.storage.local.get = async defaults => {
        const result = await originalGet(defaults)
        const readsQueue = defaults &&
            typeof defaults === 'object' &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueue')
        if(readsQueue) {
            queueReads += 1
            if(queueReads === 1) {
                storage.mbCoordinatorQueue[href] = {
                    ...storage.mbCoordinatorQueue[href],
                    attemptId: 'attempt-active-no-actor-newer',
                    attemptNumber: 2
                }
            }
        }
        return result
    }

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-stale')

    assert.equal(result.changed, false)
    assert.equal(result.requeued, 0)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[href].attemptId, 'attempt-active-no-actor-newer')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
})

test('authority reconcile active-without-actor WAL append failure leaves row active', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-No-Actor-Append-Failure'
    const runId = 'run-active-no-actor-append-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 3920,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId: 'attempt-active-no-actor-append-failure',
                        tabId: 703,
                        now: 3920
                    }),
                    retryAttempt: 0,
                    maxRetries: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    actionKind: 'mute-block',
                    status: 'tab-opening',
                    tabId: 703,
                    tabOpenedAt: 3500,
                    attemptId: 'attempt-active-no-actor-append-failure',
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueWal) {
            throw new Error('synthetic active-without-actor WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-append-failure')

    assert.equal(result.changed, false)
    assert.equal(result.requeued, 0)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueWal, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
})

test('authority reconcile terminalizes exhausted active-without-actor row through WAL', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-No-Actor-Exhausted'
    const runId = 'run-active-no-actor-exhausted'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 3930,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId: 'attempt-active-no-actor-exhausted',
                        tabId: 704,
                        now: 3930
                    }),
                    retryAttempt: 1,
                    maxRetries: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    actionKind: 'mute-block',
                    status: 'tab-opening',
                    tabId: 704,
                    tabOpenedAt: 3500,
                    attemptId: 'attempt-active-no-actor-exhausted',
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1
                }
            }
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-exhausted')

    assert.equal(result.failed, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'failed')
    assert.equal(storage.mbProfileNukeProgress[href].status, 'interrupted')

    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'repair-active-without-actor')

    const restarted = loadServiceWorkerHarness({
        now: 3960,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'failed')
})

test('authority reconcile does not requeue stale raw active row after WAL terminalization', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-No-Actor-Wal-Terminal'
    const runId = 'run-active-no-actor-wal-terminal'
    const attemptId = 'attempt-active-no-actor-wal-terminal'
    const tabId = 713
    const firstHarness = loadServiceWorkerHarness({
        now: 3920,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 3920})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    actionKind: 'mute-block',
                    status: 'blocking',
                    runId,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 3910
                }
            }
        }
    })

    const terminal = await firstHarness.sw.recordCoordinatorJobProgress(href, {
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: 3930,
        terminalAt: 3930,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }, {
        expectTerminal: true,
        senderTabId: tabId
    })

    assert.equal(terminal.recorded, true)
    assert.equal(terminal.terminal, true)
    assert.equal(firstHarness.storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(firstHarness.sw.coordinatorAuthority.current().queue[href].status, 'succeeded')

    firstHarness.storage.mbProfileNukeProgress[href] = {
        profileHref: href,
        actionKind: 'mute-block',
        status: 'tab-opening',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1,
        tabOpenedAt: 3925,
        updatedAt: 3925
    }

    const restarted = loadServiceWorkerHarness({
        now: 4000,
        storage: firstHarness.storage
    })
    const result = await restarted.sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-wal-terminal')
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()

    assert.equal(result.changed, false)
    assert.equal(result.actions, 0)
    assert.equal(result.requeued, 0)
    assert.equal(restarted.storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(restarted.storage.mbProfileNukeProgress[href].status, 'tab-opening')
    assert.equal(hydrated.queue[href].status, 'succeeded')
    assert.equal(restarted.sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(restarted.sw.state().queuedTabActions.length, 0)
    assert.equal(restarted.sw.state().activeQueuedTabs.length, 0)
})

test('authority reconcile detaches stale durably-marked runtime actor without durable token match', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Stale-Runtime-Token'
    const runId = 'run-stale-runtime-token'
    const tabId = 779
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3950,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'queued',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 3900,
                    updatedAt: 3900,
                    attemptId: 'attempt-current-queued',
                    attemptNumber: 2
                }
            },
            mbCoordinatorRuns: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        attemptId: 'attempt-stale-runtime',
        attemptNumber: 1,
        durableActiveAt: 3925,
        openedAt: 3925
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-stale-runtime-token')

    assert.equal(result.runtimeDetached, 1)
    assert.equal(result.runtimeClosed, 1)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), false)
    assert.ok(browser.__removedTabs.includes(tabId))
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[href].attemptId, 'attempt-current-queued')
})

test('authority reconcile adopts active durable row only by matching tab and attempt token', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Token-Adopt'
    const runId = 'run-token-adopt'
    const tabId = 780
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3980,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    runId,
                    status: 'active',
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    targetProfileHref: href,
                    requestedUrl: href,
                    dedupeKey: href,
                    coordinatorKey: href,
                    queuedAt: 3900,
                    activeAt: 3950,
                    updatedAt: 3950,
                    tabId,
                    attemptId: 'attempt-token-adopt',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'active',
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    })

    const result = await settleWithFakeTimers(
        sw.runCoordinatorAuthorityReconcileActions('test-token-adopt'),
        timers
    )
    const metadata = sw.state().queuedTabMetadata.find(([candidateTabId]) => candidateTabId === tabId)?.[1] || {}

    assert.equal(result.adopted, 1)
    assert.ok(sw.state().activeQueuedTabs.includes(tabId))
    assert.equal(metadata.attemptId, 'attempt-token-adopt')
    assert.equal(metadata.attemptNumber, 1)
    assert.ok(metadata.durableActiveAt > 0)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[href].tabId, tabId)
})

test('queued profile tab is retained until the foreground-wait stale timeout elapses', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Opening-Timeout'
    const runId = 'run-opening-timeout'
    const sourceSender = {tab: {id: 13, windowId: 1}}
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({now: 4000})

    await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender)

    const tab = await waitFor(
        () => listTabs(browser).find(candidate => candidate.url === href),
        'service-worker executor tab was not opened for stale-opening timeout test',
        {timers}
    )
    await waitFor(
        () => storage.mbProfileNukeProgress?.[href]?.status === 'tab-opening' &&
            sw.state().spaceFeedStorageUpdateDepth === 0,
        'initial tab-opening progress was not durable before timeout test',
        {timers}
    )

    const openedAt = sw.state().queuedTabMetadata.find(([tabId]) => tabId === tab.id)?.[1]?.openedAt
    assert.ok(openedAt > 0)

    timers.setNow(openedAt + sw.state().constants.STALE_FOREGROUND_WAIT_QUEUED_TAB_MS - 1)
    await settleWithFakeTimers(sw.sweepStaleQueuedTabs(), timers, [0])

    const beforeState = sw.state()
    assert.ok(beforeState.activeQueuedTabs.includes(tab.id), JSON.stringify(beforeState))
    assert.equal(browser.__removedTabs.includes(tab.id), false)
    assert.ok(browser.__tabs.has(tab.id))
})

test('queued profile tab is requeued after the foreground-wait stale timeout elapses', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Opening-Retry'
    const runId = 'run-opening-retry'
    const sourceSender = {tab: {id: 14, windowId: 1}}
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({now: 5000})

    await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender)

    const firstTab = await waitFor(
        () => listTabs(browser).find(candidate => candidate.url === href),
        'service-worker executor tab was not opened for stale-opening retry test',
        {timers}
    )
    await waitFor(
        () => storage.mbProfileNukeProgress?.[href]?.status === 'tab-opening' &&
            sw.state().spaceFeedStorageUpdateDepth === 0,
        'initial tab-opening progress was not durable before retry timeout test',
        {timers}
    )
    const openedAt = sw.state().queuedTabMetadata.find(([tabId]) => tabId === firstTab.id)?.[1]?.openedAt
    assert.ok(openedAt > 0)

    timers.setNow(openedAt + sw.state().constants.STALE_FOREGROUND_WAIT_QUEUED_TAB_MS)
    await settleWithFakeTimers(sw.sweepStaleQueuedTabs(), timers)

    assert.ok(browser.__removedTabs.includes(firstTab.id))
    assert.equal(browser.__tabs.has(firstTab.id), false)
    assert.equal(sw.state().activeQueuedTabs.includes(firstTab.id), false)
    const recoveredQueue = recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.some(record => record.operationKind === 'stale-retry'), true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.ok(['queued', 'opening', 'active', 'acting', 'settling'].includes(recoveredQueue[href].status))
    assert.equal(recoveredQueue[href].retryCount, 1)
    assert.equal(recoveredQueue[href].retryAttempt, 1)
})

test('loading queued tab becomes queue-load pressure without consuming row retry budget', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Loading-Pressure'
    const runId = 'run-loading-pressure'
    const sourceSender = {tab: {id: 15, windowId: 1}}
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({now: 6000})
    const originalCreate = browser.tabs.create

    browser.tabs.create = async options => {
        const tab = await originalCreate(options)
        browser.__tabs.set(tab.id, {
            ...browser.__tabs.get(tab.id),
            status: 'loading'
        })
        return {
            ...tab,
            status: 'loading'
        }
    }

    await browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 2,
            noForegroundFallback: true
        }
    }), sourceSender)

    const firstTab = await waitFor(
        () => listTabs(browser).find(candidate => candidate.url === href),
        'service-worker executor tab was not opened for loading-pressure test',
        {timers}
    )
    await waitFor(
        () => storage.mbProfileNukeProgress?.[href]?.status === 'tab-opening' &&
            sw.state().spaceFeedStorageUpdateDepth === 0,
        'initial tab-opening progress was not durable before loading-pressure test',
        {timers}
    )

    const openedAt = sw.state().queuedTabMetadata.find(([tabId]) => tabId === firstTab.id)?.[1]?.openedAt
    assert.ok(openedAt > 0)

    timers.setNow(openedAt + sw.state().constants.STALE_BACKGROUND_OPENING_QUEUED_TAB_MS + 1)
    await sw.sweepStaleQueuedTabs()

    assert.ok(browser.__removedTabs.includes(firstTab.id))
    assert.equal(browser.__tabs.has(firstTab.id), false)
    assert.equal(sw.state().activeQueuedTabs.includes(firstTab.id), false)
    const recoveredQueue = recoverProjectedState(storage.mbCoordinatorQueueWal).projected.state.queue
    const walRecords = getWalRecordsForGeneration(
        storage.mbCoordinatorQueueWal,
        storage.mbCoordinatorQueueWal?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.some(record => record.operationKind === 'stale-retry'), true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(recoveredQueue[href].status, 'queued')
    assert.equal(recoveredQueue[href].retryCount || 0, 0)
    assert.equal(recoveredQueue[href].retryAttempt || 0, 0)
    assert.equal(recoveredQueue[href].loadPressureRequeueCount, 1)
    assert.equal(sw.state().queueLoadThrottle.active, true)
    assert.equal(sw.state().queueLoadThrottle.concurrency, 1)
    assert.equal(listTabs(browser).some(candidate => candidate.url === href), false)

    await timers.tick(sw.state().queueLoadThrottle.until - timers.now)
    await waitFor(
        () => listTabs(browser).some(candidate => candidate.url === href),
        'throttled queued row did not reopen after queue-load delay',
        {timers}
    )
})

;(async () => {
    let failed = 0
    for(const {name, fn} of tests) {
        try {
            await fn()
            console.log(`ok - ${name}`)
        }
        catch(error) {
            failed += 1
            console.error(`not ok - ${name}`)
            console.error(error?.stack || error)
        }
    }
    if(failed) {
        throw new Error(`${failed} swSynthetic test${failed === 1 ? '' : 's'} failed`)
    }
})()
