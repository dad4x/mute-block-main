const assert = require('node:assert/strict')
const {
    createFakeBrowser,
    loadServiceWorkerHarness
} = require('./lib/swHarness')
const {
    appendWalRecordsToGeneration,
    buildSegmentedWalStoragePayload,
    getWalRecordsForGeneration,
    getSegmentedWalSegmentKey,
    hydrateSegmentedWalStore,
    makePairedCheckpointStore,
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

function getProgressShardKey(href) {
    let hash = 0
    for(let index = 0; index < href.length; index += 1) {
        hash = ((hash * 31) + href.charCodeAt(index)) >>> 0
    }
    return `mbProfileNukeProgressShard.${(hash % 32).toString(16).padStart(2, '0')}`
}

function getStoredCoordinatorQueueWal(storage = {}) {
    const hasSegmentedWal = !!storage?.['mbCoordinatorQueueWal.meta']
    const hydrated = hasSegmentedWal
        ? hydrateSegmentedWalStore(storage, {baseKey: 'mbCoordinatorQueueWal'})
        : null
    if(hydrated?.ok === true) return hydrated.store
    if(storage?.mbCoordinatorQueueWal) return storage.mbCoordinatorQueueWal
    return undefined
}

function isCoordinatorQueueWalPayload(payload = {}) {
    return !!(payload?.mbCoordinatorQueueWal || payload?.['mbCoordinatorQueueWal.meta'])
}

function makeSegmentedQueueWalStorage(queue = {}, segmentCount = 0, options = {}) {
    let store = makePairedCheckpointStore({queue}, {
        createdAt: options.createdAt || 1000,
        nextSeq: 1
    })
    const keys = Object.keys(queue || {})
    const rowKey = options.rowKey || keys[0] || 'synthetic-row'
    for(let index = 0; index < segmentCount; index += 1) {
        store = appendWalRecordsToGeneration(store, [{
            kind: 'map.patch',
            area: 'queue',
            key: rowKey,
            patch: {
                syntheticWalSegmentNo: index
            },
            operationKind: 'synthetic-segment-seed',
            at: (options.createdAt || 1000) + index
        }], {
            segmentId: `synthetic-segment-${index}`
        }).store
    }
    return buildSegmentedWalStoragePayload(store, {
        baseKey: 'mbCoordinatorQueueWal',
        softSwitchAt: 896,
        hardSegmentLimit: 1024,
        updatedAt: options.updatedAt || options.createdAt || 1000
    })
}

function makeProgressProjectionSeed(href, record = {}) {
    const progressRecord = {
        profileHref: href,
        ...record
    }
    const shardKey = getProgressShardKey(href)
    return {
        mbProfileNukeProgressView: {
            version: 2,
            updatedAt: progressRecord.updatedAt || 1,
            total: 1,
            recordLimit: 1200,
            truncated: false,
            records: {
                [href]: progressRecord
            }
        },
        [shardKey]: {
            version: 1,
            updatedAt: progressRecord.updatedAt || 1,
            records: {
                [href]: progressRecord
            }
        }
    }
}

function getRecoveredCoordinatorQueue(storage = {}) {
    const walStore = getStoredCoordinatorQueueWal(storage)
    if(walStore) {
        const recovered = recoverProjectedState(walStore)
        const queue = recovered?.projected?.state?.queue || recovered?.state?.queue
        if(queue && typeof queue === 'object') return queue
    }
    return storage?.mbCoordinatorQueue || {}
}

function hasStorageDefault(defaults = {}, key = '') {
    if(key === 'mbCoordinatorQueueWal') {
        return Object.prototype.hasOwnProperty.call(defaults || {}, 'mbCoordinatorQueueWal') ||
            Object.prototype.hasOwnProperty.call(defaults || {}, 'mbCoordinatorQueueWal.meta')
    }
    return Object.prototype.hasOwnProperty.call(defaults || {}, key)
}

function findStorageGetDefaults(getDefaults = [], keys = []) {
    return getDefaults.find(defaults => keys.every(key => hasStorageDefault(defaults, key))) || null
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

test('active transition uncertainty keeps executor tab when rollback is not durable', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Unconfirmed-Active'
    const runId = 'run-unconfirmed-active'
    const {browser, sw} = loadServiceWorkerHarness({
        now: 1000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {},
            mbCoordinatorRuns: {},
            mbProfileNukeProgress: {}
        }
    })
    const tab = await browser.tabs.create({url: href, active: true})
    const action = {
        url: href,
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        ownerTabId: 'service-worker-queue-owner',
        runId,
        attemptId: 'attempt-unconfirmed-active',
        attemptNumber: 1,
        noForegroundFallback: true
    }
    const plan = sw.buildQueuedTabOpenEffectPlan(action, tab, 1000)

    sw.applyQueuedTabOpenRuntimeEffect(plan)
    const result = await sw.confirmQueuedTabOpenDurableActiveEffect(action, tab, plan)

    assert.equal(result.keepOpen, true)
    assert.equal(result.rolledBack, false)
    assert.equal(result.activeTransitionContinued, true)
    assert.equal(browser.__tabs.has(tab.id), true)
    assert.equal(browser.__removedTabs.includes(tab.id), false)
    assert.ok(sw.state().activeQueuedTabs.includes(tab.id))

    const metadata = Object.fromEntries(sw.state().queuedTabMetadata)[tab.id]
    assert.equal(metadata.activeTransitionUnconfirmedAt, 1000)
    assert.equal(metadata.durableActiveReason, 'active-transition-unconfirmed')
})

test('unconfirmed active transition releases runtime slot when authority row stayed queued', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Unconfirmed-Queued'
    const runId = 'run-unconfirmed-queued'
    const attemptId = 'attempt-unconfirmed-queued'
    const {browser, sw, timers, storage} = loadServiceWorkerHarness({
        now: 10000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 10000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbProfileNukeProgress: {}
        }
    })
    const tab = await browser.tabs.create({url: href, active: true})

    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        ownerTabId: 'service-worker-queue-owner',
        runId,
        attemptId,
        attemptNumber: 1,
        activeTransitionPendingAt: 1000
    })

    await settleWithFakeTimers(sw.sweepStaleQueuedTabs(null, {queueOnlyAuthority: true}), timers, [0])

    assert.equal(browser.__tabs.has(tab.id), false)
    assert.equal(browser.__removedTabs.includes(tab.id), true)
    assert.equal(sw.state().activeQueuedTabs.includes(tab.id), false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
})

test('queued tab nudge treats missing tab as handled queue state', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Nudge-Missing-Tab'
    const {browser, sw} = loadServiceWorkerHarness({now: 10050})
    const tab = await browser.tabs.create({url: href, active: true})

    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        ownerTabId: 'service-worker-queue-owner',
        attemptId: 'attempt-nudge-missing-tab',
        attemptNumber: 1
    })
    browser.tabs.sendMessage = async () => {
        throw new Error(`No tab with id: ${tab.id}.`)
    }

    const result = await sw.nudgeQueuedTabActionClaim(tab.id, 'synthetic-missing-tab')

    assert.equal(result.nudged, false)
    assert.equal(result.reason, 'missing-tab')
    assert.equal(sw.state().queueWakeupCounters['nudge.failed.missingTab'], 1)
})

test('queued tab nudge rebuilds claimable action from durable tab id when tab lookup times out', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Nudge-Durable-TabId-Recovery'
    const runId = 'run-nudge-durable-tabid-recovery'
    const attemptId = 'attempt-nudge-durable-tabid-recovery'
    const tabId = 731
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 10055,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 10055})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const originalGet = browser.tabs.get.bind(browser.tabs)
    let hungGetCalls = 0
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === tabId) {
            hungGetCalls += 1
            return new Promise(() => {})
        }
        return originalGet(candidateTabId)
    }

    const claimedMessages = []
    browser.tabs.sendMessage = async (candidateTabId, message) => {
        if(Number.parseInt(candidateTabId, 10) === tabId &&
            message?.action === 'claim-current-profile-tab-action') {
            claimedMessages.push(message)
            return {accepted: true}
        }
        return {}
    }

    const result = await settleWithFakeTimers(
        sw.nudgeQueuedTabActionClaim(tabId, 'synthetic-durable-tabid-recovery'),
        timers,
        [0, 2500, 1, 2500, 1, 1000]
    )
    browser.tabs.get = originalGet

    assert.equal(result.nudged, true)
    assert.ok(hungGetCalls >= 1)
    assert.equal(claimedMessages.length, 1)
    assert.equal(claimedMessages[0].queuedAction?.attemptId, attemptId)
    assert.equal(claimedMessages[0].queuedAction?.attemptNumber, 1)
    assert.equal(claimedMessages[0].queuedAction?.targetUrl, href)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), true)
    assert.equal(Object.fromEntries(sw.state().queuedTabMetadata)[tabId].attemptId, attemptId)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[href].tabId, tabId)
})

test('queued tab nudge retry failure leaves alarm-backed continuation', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Nudge-Retry-Followup'
    const {browser, sw} = loadServiceWorkerHarness({now: 10060})
    const tab = await browser.tabs.create({url: href, active: true})

    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        ownerTabId: 'service-worker-queue-owner',
        attemptId: 'attempt-nudge-retry-followup',
        attemptNumber: 1
    })
    browser.tabs.sendMessage = async () => {
        throw new Error('synthetic nudge timeout')
    }

    const result = await sw.nudgeQueuedTabActionClaimWithRetries(tab.id, 'synthetic-nudge-followup', [0])

    assert.equal(result.nudged, false)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
})

test('service-worker blocked sweep terminalizes owned blocked profile tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Service-Worker-Blocked-Sweep'
    const runId = 'run-service-worker-blocked-sweep'
    const attemptId = 'attempt-service-worker-blocked-sweep'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 10070,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({
                    href,
                    runId,
                    attemptId,
                    tabId: 501,
                    now: 10070
                })
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
                    tabId: 501,
                    attemptId,
                    attemptNumber: 1,
                    blockAttemptedAt: 10065,
                    updatedAt: 10065
                }
            }
        }
    })
    const tab = await browser.tabs.create({url: href, active: true})
    storage.mbCoordinatorQueue[href].tabId = tab.id
    storage.mbProfileNukeProgress[href].tabId = tab.id
    await sw.coordinatorAuthority.hydrate()
    sw.coordinatorAuthority.current().queue[href].tabId = tab.id
    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        ownerTabId: 'service-worker-queue-owner',
        runId,
        attemptId,
        attemptNumber: 1,
        openedAt: 10060,
        durableActiveAt: 10065
    })
    browser.tabs.sendMessage = async (tabId, message) => {
        if(message?.action === 'close-if-blocked') {
            return {
                willClose: true,
                resolvedProfileHref: href,
                lastUrl: href
            }
        }
        return {}
    }

    const result = await browser.runtime.sendMessage({
        action: 'sweep-service-worker-blocked-profile-tabs'
    })

    assert.equal(result.owned, 1)
    assert.equal(result.signaled, 1)
    assert.equal(browser.__tabs.has(tab.id), false)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'already-blocked')
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'blocking')
    assert.equal(getProgressShardRecord(storage, href), null)
})

test('service-worker blocked sweep uses scripting probe when close message times out', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Service-Worker-Blocked-Probe'
    const runId = 'run-service-worker-blocked-probe'
    const attemptId = 'attempt-service-worker-blocked-probe'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 10075,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({
                    href,
                    runId,
                    attemptId,
                    tabId: 502,
                    now: 10075
                })
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
                    tabId: 502,
                    attemptId,
                    attemptNumber: 1,
                    blockAttemptedAt: 10070,
                    updatedAt: 10070
                }
            }
        }
    })
    const tab = await browser.tabs.create({url: href, active: true})
    storage.mbCoordinatorQueue[href].tabId = tab.id
    storage.mbProfileNukeProgress[href].tabId = tab.id
    await sw.coordinatorAuthority.hydrate()
    sw.coordinatorAuthority.current().queue[href].tabId = tab.id
    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        ownerTabId: 'service-worker-queue-owner',
        runId,
        attemptId,
        attemptNumber: 1,
        openedAt: 10065,
        durableActiveAt: 10070
    })
    let closeMessages = 0
    let probeCalls = 0
    browser.tabs.sendMessage = async (tabId, message) => {
        if(message?.action === 'close-if-blocked') {
            closeMessages += 1
            return null
        }
        return {}
    }
    browser.scripting.executeScript = async details => {
        if(details.func) {
            probeCalls += 1
            return [{
                result: {
                    willClose: true,
                    resolvedProfileHref: href,
                    lastUrl: href,
                    marker: 'test',
                    expectedVersion: 'test',
                    markerMatches: true,
                    hasBlockedBanner: true,
                    hasExtensionControls: true,
                    source: 'scripting-blocked-probe'
                }
            }]
        }
        return []
    }

    const result = await browser.runtime.sendMessage({
        action: 'sweep-service-worker-blocked-profile-tabs'
    })

    assert.equal(result.owned, 1)
    assert.equal(result.signaled, 1)
    assert.equal(closeMessages, 1)
    assert.equal(probeCalls, 1)
    assert.equal(browser.__tabs.has(tab.id), false)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'already-blocked')
})

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
            mbProfileNukeProgress: {},
            ...makeProgressProjectionSeed(href, {
                profileHref: href,
                status: 'tab-opened',
                runId,
                tabId,
                actionKind: 'mute-block',
                attemptId,
                attemptNumber: 1,
                updatedAt: 99500
            })
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
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'tab-opened')
    assert.equal(getProgressShardRecord(storage, href).status, 'blocking')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.notEqual(storage.mbCoordinatorQueue[href].milestones.blockAttemptedAt, 100020)
    assert.equal(
        (afterSecond['storagePayload.read.progress.bytes'] || 0) -
            (beforeSecond['storagePayload.read.progress.bytes'] || 0),
        0
    )
    assert.ok(
        (afterSecond['storagePayload.read.progressShard.bytes'] || 0) -
            (beforeSecond['storagePayload.read.progressShard.bytes'] || 0) > 0
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
    assert.equal(
        (afterSecond['storagePayload.write.progressView.bytes'] || 0) -
            (beforeSecond['storagePayload.write.progressView.bytes'] || 0),
        0
    )
    assert.ok(
        (afterSecond['storagePayload.write.progressShard.bytes'] || 0) -
            (beforeSecond['storagePayload.write.progressShard.bytes'] || 0) > 0
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

    await timers.tick(30000)
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocking')
    assert.equal(afterRepeat['progress.compatibilityFlushScheduled'] || 0, 0)
})

test('profile progress load normalizes legacy compatibility storage read-only', async () => {
    const rawHref = 'https://quora.com/profile/Synthetic-Normalize-Progress'
    const href = 'https://www.quora.com/profile/Synthetic-Normalize-Progress'
    const browser = createFakeBrowser({
        mbProfileNukeProgress: {
            [rawHref]: {
                profileHref: rawHref,
                status: 'queued',
                actionKind: 'mute-block',
                updatedAt: 1000
            }
        }
    })
    const storageWrites = []
    const originalSet = browser.storage.local.set
    browser.storage.local.set = async payload => {
        storageWrites.push(payload)
        return originalSet(payload)
    }
    const {storage, sw, timers} = loadServiceWorkerHarness({
        now: 2000,
        browser
    })

    await sw.ensureProfileNukeProgressReady()

    assert.equal(sw.state().profileNukeProgress[href].profileHref, href)
    assert.equal(storage.mbProfileNukeProgress[rawHref].profileHref, rawHref)
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(storageWrites.some(payload => Object.prototype.hasOwnProperty.call(payload || {}, 'mbProfileNukeProgress')), false)
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
    const progressA = {
        profileHref: hrefA,
        status: 'queued',
        runId,
        actionKind: 'mute-block',
        attemptId: 'attempt-cancel-a',
        attemptNumber: 1,
        updatedAt: 499600
    }
    const progressB = {
        profileHref: hrefB,
        status: 'queued',
        runId,
        actionKind: 'mute-block',
        attemptId: 'attempt-cancel-b',
        attemptNumber: 1,
        updatedAt: 499600
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
            mbProfileNukeProgress: {
                [hrefA]: progressA,
                [hrefB]: progressB
            }
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
    assert.deepEqual(storage.mbProfileNukeProgress[hrefA], progressA)
    assert.deepEqual(storage.mbProfileNukeProgress[hrefB], progressB)
    assert.equal(storage.mbCoordinatorQueueView.counts.canceled, 1)
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'current-work-item-cancel')
    assert.equal(recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue[hrefA].status, 'canceled')
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
    const progressA = {
        profileHref: hrefA,
        status: 'queued',
        runId,
        actionKind: 'mute-block',
        attemptId: 'attempt-bulk-cancel-1',
        attemptNumber: 1,
        updatedAt: 500600
    }
    const progressB = {
        profileHref: hrefB,
        status: 'queued',
        runId,
        actionKind: 'mute-block',
        attemptId: 'attempt-bulk-cancel-2',
        attemptNumber: 2,
        updatedAt: 500600
    }
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
            mbProfileNukeProgress: {
                [hrefA]: progressA,
                [hrefB]: progressB
            }
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
    assert.deepEqual(storage.mbProfileNukeProgress[hrefA], progressA)
    assert.deepEqual(storage.mbProfileNukeProgress[hrefB], progressB)
    assert.equal(storage.mbCoordinatorQueueView.counts.canceled, 2)
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords.every(record => record.operationKind === 'stored-work-cancel'), true)
    const recovered = recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue
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
        queueWal: getStoredCoordinatorQueueWal(storage),
        queueView: storage.mbCoordinatorQueueView
    })
    const accounting = await browser.runtime.sendMessage({
        action: 'get-coordinator-queue-accounting',
        reason: 'synthetic-test'
    })

    assert.equal(JSON.stringify({
        queue: storage.mbCoordinatorQueue,
        queueWal: getStoredCoordinatorQueueWal(storage),
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
        queueWal: getStoredCoordinatorQueueWal(storage),
        queueView: storage.mbCoordinatorQueueView
    })
    const accounting = await browser.runtime.sendMessage({
        action: 'get-coordinator-queue-accounting',
        reason: 'synthetic-stale-view'
    })

    assert.equal(JSON.stringify({
        queue: storage.mbCoordinatorQueue,
        queueWal: getStoredCoordinatorQueueWal(storage),
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
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
    assert.equal(storage.mbProfileNukeProgress[hrefActive].status, 'tab-opened')
    assert.equal(storage.mbProfileNukeProgress[hrefActive].tabId, tabId)
    assert.equal(storage.mbProfileNukeProgress[hrefActive].attemptId, attemptId)
    assert.equal(browser.__removedTabs.includes(tabId), true)
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'stored-work-pause')
    const recovered = recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    assert.equal(storage.mbCoordinatorEvents.length, 0)
    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.equal(browser.__tabs.has(tabId), true)
})

test('runs paused update uses queue-runs projection without loading progress', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Runs-Paused-Projection'
    const runId = 'run-runs-paused-projection'
    const attemptId = 'attempt-runs-paused-projection'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 505500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 505500})
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'paused',
                    paused: true,
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    runId,
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 505400
                }
            }
        }
    })
    const getDefaults = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getDefaults.push(defaults)
        return originalGet(defaults)
    }

    const result = await sw.setCoordinatorRunsPaused(false)

    assert.equal(result.changed, true)
    assert.equal(storage.mbCoordinatorRuns[runId].status, 'active')
    assert.equal(storage.mbCoordinatorRuns[runId].paused, false)
    assert.equal(getDefaults.some(defaults => Object.prototype.hasOwnProperty.call(defaults || {}, 'mbProfileNukeProgress')), false)
    assert.equal(getDefaults.some(defaults => Object.prototype.hasOwnProperty.call(defaults || {}, 'mbCoordinatorEvents')), false)
})

test('runs paused update failure schedules repair without throwing', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Runs-Paused-Failure'
    const runId = 'run-runs-paused-failure'
    const attemptId = 'attempt-runs-paused-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 505800,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 505800})
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'space-feed',
                    status: 'paused',
                    paused: true,
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
        if(payload?.mbCoordinatorRuns) {
            throw new Error('synthetic runs paused save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.setCoordinatorRunsPaused(false)

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'runs-paused-save-failed')
    assert.equal(storage.mbCoordinatorRuns[runId].status, 'paused')
    assert.equal(sw.state().queueWakeupCounters['runsPaused.derivedSaveFailed'], 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )

    browser.storage.local.set = originalSet
    const repair = await sw.reconcileCoordinatorStorage()

    assert.equal(repair.runsChanged, true)
    assert.equal(storage.mbCoordinatorRuns[runId].status, 'active')
    assert.equal(storage.mbCoordinatorRuns[runId].paused, false)
})

test('manual failed retry WAL moves resolver rows without leaving stale source key', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Failed-Retry-Move'
    const questionUrl = 'https://www.quora.com/unanswered/Synthetic-failed-retry-move-question'
    const retryKey = `resolve-profile:${questionUrl}`
    const runId = 'run-failed-retry-move'
    const progressRecord = {
        profileHref: href,
        status: 'failed',
        outcome: 'timeout',
        runId,
        actionKind: 'mute-block',
        attemptId: 'attempt-failed-retry-move',
        attemptNumber: 1,
        updatedAt: 505500
    }
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
                [href]: progressRecord
            },
            ...makeProgressProjectionSeed(href, progressRecord)
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
    assert.equal(storage.mbProfileNukeProgress[href].status, 'failed')
    assert.equal(storage.mbProfileNukeProgressView.records[href], undefined)
    assert.equal(getProgressShardRecord(storage, href), null)
    const currentAuthority = (await sw.coordinatorAuthority.hydrate()).queue
    assert.equal(currentAuthority[href], undefined)
    assert.equal(currentAuthority[retryKey].status, 'queued')
    assert.equal(currentAuthority[retryKey].resolveProfileFromPage, true)
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.deepEqual(walRecords.map(record => record.kind), ['map.set', 'map.remove'])
    assert.equal(walRecords[0].operationKind, 'retry')
    assert.equal(walRecords[0].key, retryKey)
    assert.equal(walRecords[1].key, href)
    const recovered = recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue
    assert.equal(recovered[href], undefined)
    assert.equal(recovered[retryKey].status, 'queued')
})

test('manual failed requeue deletes compact progress projection without rewriting full mirror', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Failed-Requeue-Projection-Cleanup'
    const runId = 'run-failed-requeue-projection-cleanup'
    const progressRecord = {
        profileHref: href,
        status: 'failed',
        outcome: 'timeout',
        runId,
        actionKind: 'mute-block',
        attemptId: 'attempt-failed-requeue-projection-cleanup',
        attemptNumber: 1,
        updatedAt: 506500
    }
    const {browser, storage, timers, sw} = loadServiceWorkerHarness({
        now: 506800,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeFailedCoordinatorRow({
                    href,
                    runId,
                    attemptId: 'attempt-failed-requeue-projection-cleanup',
                    requestedUrl: href,
                    now: 506800
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
                [href]: progressRecord
            },
            ...makeProgressProjectionSeed(href, progressRecord)
        }
    })

    const result = await settleWithFakeTimers(browser.runtime.sendMessage({
        action: 'requeue-coordinator-failed',
        maxItems: 1
    }), timers)

    assert.equal(result.selected, 1)
    assert.equal(result.queued, 1)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'failed')
    assert.equal(storage.mbProfileNukeProgressView.records[href], undefined)
    assert.equal(getProgressShardRecord(storage, href), null)
    const currentAuthority = (await sw.coordinatorAuthority.hydrate()).queue
    assert.ok(['queued', 'opening', 'active'].includes(currentAuthority[href].status))
    assert.equal(currentAuthority[href].runId, result.runId)

    delete storage.mbProfileNukeProgressView
    for(const key of Object.keys(storage)) {
        if(key.startsWith('mbProfileNukeProgressShard.')) delete storage[key]
    }
    const scoped = await browser.runtime.sendMessage({
        action: 'get-content-page-coordinator-state',
        pageType: 'profile-search',
        profileHrefs: [href]
    })
    assert.equal(scoped.queueRows, 1)
    assert.equal(scoped.progressRows, 0)
    assert.ok(['queued', 'opening', 'active'].includes(scoped.coordinatorQueue[href].status))
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 120000,
        disableQueueWakeupMetricsFlush: true,
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
    const {browser, storage, sw} = loadServiceWorkerHarness({
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
            mbProfileNukeProgress: {},
            ...makeProgressProjectionSeed(href, {
                profileHref: href,
                status: 'tab-opened',
                runId,
                tabId,
                actionKind: 'mute-block',
                attemptId,
                attemptNumber: 1,
                updatedAt: 119500
            })
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
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'tab-opened')
    assert.equal(getProgressShardRecord(storage, href).status, 'tab-opened')
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
    const {storage, sw, timers} = loadServiceWorkerHarness({
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
    assert.equal((await sw.coordinatorAuthority.hydrate()).queue[href].status, 'active')
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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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

test('segmented queue WAL appends do not rewrite checkpoint snapshots after migration', async () => {
    const hrefA = 'https://www.quora.com/profile/Synthetic-Segmented-Wal-A'
    const hrefB = 'https://www.quora.com/profile/Synthetic-Segmented-Wal-B'
    const runId = 'run-segmented-wal-append'
    const attemptA = 'attempt-segmented-wal-a'
    const attemptB = 'attempt-segmented-wal-b'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 150200,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [hrefA]: {
                    ...makeActiveCoordinatorRow({href: hrefA, runId, attemptId: attemptA, tabId: null, now: 150200}),
                    status: 'queued',
                    activeAt: 0,
                    tabId: null
                },
                [hrefB]: {
                    ...makeActiveCoordinatorRow({href: hrefB, runId, attemptId: attemptB, tabId: null, now: 150200}),
                    status: 'queued',
                    activeAt: 0,
                    tabId: null
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href: hrefA, runId, targetProfileHrefs: [hrefA, hrefB]})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const first = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: hrefA,
        patch: {
            status: 'page-ready',
            actionReadyAt: 150210,
            runId,
            tabId: 503,
            actionKind: 'mute-block',
            attemptId: attemptA,
            attemptNumber: 1
        }
    })
    assert.equal(first.recorded, true)
    assert.ok(storage['mbCoordinatorQueueWal.checkpoint.A'])
    assert.ok(storage['mbCoordinatorQueueWal.segment.A.0000'])

    const restarted = loadServiceWorkerHarness({
        now: 150230,
        storage
    })
    const walPayloadKeys = []
    const originalSet = restarted.browser.storage.local.set.bind(restarted.browser.storage.local)
    restarted.browser.storage.local.set = async payload => {
        if(isCoordinatorQueueWalPayload(payload)) {
            walPayloadKeys.push(Object.keys(payload).sort())
        }
        return originalSet(payload)
    }

    const second = await restarted.sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: hrefB,
        patch: {
            status: 'page-ready',
            actionReadyAt: 150220,
            runId,
            tabId: 504,
            actionKind: 'mute-block',
            attemptId: attemptB,
            attemptNumber: 1
        }
    })

    assert.equal(second.recorded, true)
    assert.ok(walPayloadKeys.length >= 1)
    assert.equal(walPayloadKeys.some(keys =>
        keys.some(key => key.startsWith('mbCoordinatorQueueWal.checkpoint.'))), false)
    assert.ok(walPayloadKeys[0].includes('mbCoordinatorQueueWal.meta'))
    assert.ok(walPayloadKeys[0].includes('mbCoordinatorQueueWal.segment.A.0001'))
    assert.equal(recoverProjectedState(getStoredCoordinatorQueueWal(restarted.storage)).projected.state.queue[hrefB].status, 'active')
})

test('segmented queue WAL append rewrites active segments when previous physical keys are incomplete', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Segmented-Wal-Incomplete-Physical'
    const runId = 'run-segmented-wal-incomplete-physical'
    const attemptId = 'attempt-segmented-wal-incomplete-physical'
    const queue = {
        [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 150250})
    }
    const segmentedWal = makeSegmentedQueueWalStorage(queue, 2, {
        rowKey: href,
        createdAt: 150250
    })
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 150260,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: queue,
            ...segmentedWal,
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const authorityState = await sw.coordinatorAuthority.hydrate()
    const activeGeneration = authorityState.stored.mbCoordinatorQueueWal.meta.activeCheckpoint
    const segment0 = getSegmentedWalSegmentKey('mbCoordinatorQueueWal', activeGeneration, 0)
    const segment1 = getSegmentedWalSegmentKey('mbCoordinatorQueueWal', activeGeneration, 1)
    const segment2 = getSegmentedWalSegmentKey('mbCoordinatorQueueWal', activeGeneration, 2)
    assert.ok(storage[segment0])
    assert.ok(storage[segment1])

    delete storage[segment0]
    delete authorityState.stored[segment0]

    const walPayloadKeys = []
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(isCoordinatorQueueWalPayload(payload)) {
            walPayloadKeys.push(Object.keys(payload).sort())
        }
        return originalSet(payload)
    }

    const result = await sw.enqueueSpaceFeedStorageUpdate(() => sw.coordinatorAuthority.applyWithinStorageUpdate({
        operationKind: 'row-event-progress-milestone',
        rowKey: href,
        reason: 'ordinaryMutation',
        currentAuthorityState: authorityState,
        mutate(current) {
            return {
                ...current,
                status: 'active',
                tabId: 506,
                activeAt: 150260,
                updatedAt: 150260,
                milestones: {
                    ...(current.milestones || {}),
                    actionReadyAt: 150260
                }
            }
        }
    }))

    assert.equal(result.durable, true)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.segmentIncrementalInvalidated'] || 0, 1)
    assert.ok(walPayloadKeys.length >= 1)
    assert.ok(walPayloadKeys[0].includes(segment0))
    assert.ok(walPayloadKeys[0].includes(segment1))
    assert.ok(walPayloadKeys[0].includes(segment2))
    assert.ok(storage[segment0])
    assert.ok(storage[segment1])
    assert.ok(storage[segment2])
    assert.equal(recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue[href].status, 'active')
})

test('segmented queue WAL hydrate failure does not fall back to stale raw queue', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Segmented-Wal-Missing-Segment'
    const runId = 'run-segmented-wal-missing-segment'
    const attemptId = 'attempt-segmented-wal-missing-segment'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 150300,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 150300}),
                    status: 'queued',
                    activeAt: 0,
                    tabId: null
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const recorded = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'page-ready',
            actionReadyAt: 150310,
            runId,
            tabId: 505,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })
    assert.equal(recorded.recorded, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue[href].status, 'active')

    delete storage['mbCoordinatorQueueWal.segment.A.0000']
    const restarted = loadServiceWorkerHarness({
        now: 150320,
        storage
    })

    await assert.rejects(
        () => restarted.sw.coordinatorAuthority.hydrate(),
        /segmented queue WAL hydrate failed: missing-segment/
    )
    await restarted.sw.enqueueSpaceFeedStorageUpdate(async () => true)
    assert.equal(restarted.storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(restarted.sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.segmentedHydrateFailed'] || 0, 1)
})

test('segmented queue WAL soft threshold records lifecycle metrics and schedules checkpoint switch', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Segmented-Wal-Soft-Threshold'
    const runId = 'run-segmented-wal-soft-threshold'
    const attemptId = 'attempt-segmented-wal-soft-threshold'
    const queue = {
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
            queuedAt: 150400,
            updatedAt: 150400,
            attemptId,
            attemptNumber: 1,
            milestones: {}
        }
    }
    const softSwitchAt = 128
    const segmentedWal = makeSegmentedQueueWalStorage(queue, softSwitchAt - 1, {
        rowKey: href,
        createdAt: 150400
    })
    const {storage, sw, timers} = loadServiceWorkerHarness({
        now: 150410,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: queue,
            ...segmentedWal,
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const recorded = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'page-ready',
            actionReadyAt: 150420,
            runId,
            tabId: 540,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })

    assert.equal(recorded.recorded, true)
    assert.ok(storage[getSegmentedWalSegmentKey('mbCoordinatorQueueWal', 'A', softSwitchAt - 1)])
    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['coordinatorAuthority.queueWal.segmentSoftSwitchScheduled'] || 0, 1)
    assert.equal(counters['coordinatorAuthority.queueWal.segmentCheckpointSwitchScheduled'] || 0, 1)
    assert.ok((counters['coordinatorAuthority.queueWal.maxActivePhysicalSegments'] || 0) >= softSwitchAt)
    assert.ok((counters['coordinatorAuthority.queueWal.manifestBytes'] || 0) > 0)
    assert.ok((counters['coordinatorAuthority.queueWal.physicalSegmentBytes'] || 0) > 0)
})

test('segmented queue WAL hard limit blocks durable append before physical write', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Segmented-Wal-Hard-Limit'
    const runId = 'run-segmented-wal-hard-limit'
    const attemptId = 'attempt-segmented-wal-hard-limit'
    const queue = {
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
            queuedAt: 150500,
            updatedAt: 150500,
            attemptId,
            attemptNumber: 1,
            milestones: {}
        }
    }
    const hardLimit = 1024
    const segmentedWal = makeSegmentedQueueWalStorage(queue, hardLimit, {
        rowKey: href,
        createdAt: 150500
    })
    const {storage, sw} = loadServiceWorkerHarness({
        now: 150510,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: queue,
            ...segmentedWal,
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const beforeMeta = JSON.stringify(storage['mbCoordinatorQueueWal.meta'])

    const recorded = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            status: 'page-ready',
            actionReadyAt: 150520,
            runId,
            tabId: 541,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }
    })

    assert.equal(recorded.recorded, false)
    assert.equal(recorded.reason, 'queue-wal-segment-hard-limit')
    assert.equal(JSON.stringify(storage['mbCoordinatorQueueWal.meta']), beforeMeta)
    assert.equal(storage[getSegmentedWalSegmentKey('mbCoordinatorQueueWal', 'A', hardLimit)], undefined)
    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['coordinatorAuthority.queueWal.segmentHardBlocked'] || 0, 1)
    assert.equal(counters['coordinatorAuthority.queueWal.segmentCheckpointSwitchScheduled'] || 0, 1)
    assert.ok((counters['coordinatorAuthority.queueWal.maxPreviousCommittedSegments'] || 0) >= hardLimit)
    assert.equal(counters['coordinatorAuthority.queueWal.physicalSegmentWrites'] || 0, 0)
})

test('segmented queue WAL authority read schedules checkpoint switch over soft segment count', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Segmented-Wal-Read-Soft-Threshold'
    const runId = 'run-segmented-wal-read-soft-threshold'
    const queue = {
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
            queuedAt: 150600,
            updatedAt: 150600,
            attemptId: 'attempt-segmented-wal-read-soft-threshold',
            attemptNumber: 1,
            milestones: {}
        }
    }
    const segmentedWal = makeSegmentedQueueWalStorage(queue, 128, {
        rowKey: href,
        createdAt: 150600
    })
    const {sw} = loadServiceWorkerHarness({
        now: 150610,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: queue,
            ...segmentedWal,
            mbCoordinatorQueueView: {
                version: 1,
                updatedAt: 150610,
                total: 1,
                counts: {queued: 1},
                authoritativeCounts: {queued: 1},
                hasAuthoritativeStoredWork: true,
                itemLimit: 80,
                truncated: false,
                items: []
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const accounting = await sw.getCoordinatorQueueAccounting({reason: 'synthetic'})

    assert.equal(accounting.consistent, true)
    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['coordinatorAuthority.queueWal.segmentSoftSwitchScheduledFromRead'] || 0, 1)
    assert.equal(counters['coordinatorAuthority.queueWal.segmentCheckpointSwitchScheduled'] || 0, 1)
    assert.ok((counters['coordinatorAuthority.queueWal.maxActivePhysicalSegments'] || 0) >= 128)
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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal((await sw.coordinatorAuthority.hydrate()).queue[href].status, 'active')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue[href].status, 'active')
    assert.equal((await sw.coordinatorAuthority.hydrate()).queue[href].status, 'active')
    assert.equal(sw.state().queueWakeupCounters['rowEvent.queued-progress-milestone.derivedRunsSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )
})

test('queued tab metadata milestones use row-event projection without full progress write', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Metadata-Milestone'
    const runId = 'run-metadata-milestone'
    const attemptId = 'attempt-metadata-milestone'
    const tabId = 529
    const {storage, sw, timers} = loadServiceWorkerHarness({
        now: 153100,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 153100})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.recordQueuedTabMetadataMilestone(tabId, {
        profileHref: href,
        runId,
        actionKind: 'mute-block',
        ownerTabId: 13,
        attemptId,
        attemptNumber: 1
    }, {
        waitingForForegroundAt: 153120,
        foregroundWaitReason: 'synthetic-wait',
        event: 'Synthetic metadata milestone'
    })

    assert.equal(result.recorded, true)
    assert.equal(result.deferred, true)
    assert.equal(result.durable, false)
    assert.equal(result.reason, 'milestone-flush-deferred')
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(sw.state().profileNukeProgress[href].waitingForForegroundAt, 153120)

    await timers.tick(sw.state().constants.COORDINATOR_JOB_MILESTONE_FLUSH_MS)
    await waitFor(
        () => !!getProgressShardRecord(storage, href),
        'deferred metadata milestone did not flush to progress projection',
        {timers, attempts: 20, tickMs: 0}
    )

    assert.equal(getProgressShardRecord(storage, href).attemptId, attemptId)
    assert.equal((await sw.coordinatorAuthority.hydrate()).queue[href].status, 'active')
    assert.equal(sw.state().queueWakeupCounters['rowEvent.queued-progress-milestone.accepted'] || 0, 1)
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(storage.mbCoordinatorQueueView.counts.succeeded, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'blocked')
    await waitFor(
        () => getProgressShardRecord(storage, href)?.status === 'blocked',
        'terminal progress compatibility save did not update the compact progress projection',
        {attempts: 20}
    )
    assert.equal(storage.mbProfileNukeProgress[href].status, 'blocking')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'blocked')
    assert.equal(getProgressShardRecord(storage, href).status, 'blocked')
    assert.equal(
        (after['storagePayload.read.queue.calls'] || 0) -
            (before['storagePayload.read.queue.calls'] || 0),
        2
    )
    assert.equal(
        (after['storagePayload.read.runs.calls'] || 0) -
            (before['storagePayload.read.runs.calls'] || 0),
        2
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
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
})

test('duplicate terminal progress for terminal row does not append duplicate queue WAL', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Duplicate-Noop'
    const runId = 'run-terminal-duplicate-noop'
    const attemptId = 'attempt-terminal-duplicate-noop'
    const tabId = 504
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 250400,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 250400})
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
                    actionKind: 'mute-block',
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 250300
                }
            }
        }
    })
    const terminalPatch = {
        status: 'interrupted',
        finalError: 'Durable active queue row had no confirmed runtime actor',
        terminalAt: 250500,
        actionKind: 'mute-block',
        runId,
        tabId,
        attemptId,
        attemptNumber: 1
    }

    const first = await sw.recordCoordinatorJobProgress(href, terminalPatch, {
        expectTerminal: true,
        senderTabId: tabId
    })
    assert.equal(first.recorded, true)
    assert.equal(first.terminal, true)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'failed')

    const firstRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    ).filter(record => record.key === href && record.operationKind === 'terminal-progress')
    assert.equal(firstRecords.length, 1)

    const second = await sw.recordCoordinatorJobProgress(href, terminalPatch, {
        expectTerminal: true,
        senderTabId: tabId
    })
    assert.equal(second.recorded, true)
    assert.equal(second.terminal, true)

    const secondRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    ).filter(record => record.key === href && record.operationKind === 'terminal-progress')
    assert.equal(secondRecords.length, 1)
    assert.equal(sw.state().queueWakeupCounters['terminalProgress.queueNoopDuplicatePreflight'] || 0, 1)
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
    assert.equal(recoverProjectedState(getStoredCoordinatorQueueWal(restarted.storage)).projected.state.queue[href].status, 'succeeded')
    assert.equal(restarted.storage.mbProfileNukeProgress[href].status, 'blocking')
    assert.equal(restarted.sw.state().profileNukeProgress[href], undefined)
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
    const {browser, storage, sw} = loadServiceWorkerHarness({
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
    browser.__tabs.set(520, {id: 520, windowId: 1, url: hrefA, status: 'complete', active: true})
    browser.__tabs.set(521, {id: 521, windowId: 1, url: hrefB, status: 'complete', active: true})
    browser.__tabs.set(522, {id: 522, windowId: 1, url: hrefC, status: 'complete', active: true})
    sw.__testAddProvisionalQueuedTab(520, {
        profileHref: hrefA,
        coordinatorKey: hrefA,
        requestedUrl: hrefA,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId: attemptA,
        attemptNumber: 1,
        durableActiveAt: 252500
    })
    sw.__testAddProvisionalQueuedTab(521, {
        profileHref: hrefB,
        coordinatorKey: hrefB,
        requestedUrl: hrefB,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId: attemptB,
        attemptNumber: 1,
        durableActiveAt: 252500
    })
    sw.__testAddProvisionalQueuedTab(522, {
        profileHref: hrefC,
        coordinatorKey: hrefC,
        requestedUrl: hrefC,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId: attemptC,
        attemptNumber: 1,
        durableActiveAt: 252500
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
                getStoredCoordinatorQueueWal(storage),
                getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
            )
            const terminalProgressCount = records
                .filter(record => record.operationKind === 'terminal-progress')
                .length
            const terminalSettlementCount = records
                .filter(record => record.operationKind === 'terminal-settlement')
                .length
            return terminalProgressCount >= 2 && terminalSettlementCount >= 2 ? records : null
        },
        'terminal progress and settlement WAL records were not all appended',
        {attempts: 40}
    )
    assert.equal(walRecords.filter(record => record.operationKind === 'terminal-progress').length, 2)
    assert.equal(walRecords.filter(record => record.operationKind === 'terminal-settlement').length, 2)
    const checkpointedRecordCount = walRecords.length
    const nextSeqBeforeCheckpoint = getStoredCoordinatorQueueWal(storage).meta.nextSeq
    assert.equal(nextSeqBeforeCheckpoint, checkpointedRecordCount + 1)
    const oldActiveGeneration = getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    const oldSegmentKeys = [0, 1, 2, 3].map(segmentNo =>
        getSegmentedWalSegmentKey('mbCoordinatorQueueWal', oldActiveGeneration, segmentNo))
    assert.equal(oldSegmentKeys.every(key => Object.prototype.hasOwnProperty.call(storage, key)), true)
    storage.mbCoordinatorQueueWal = getStoredCoordinatorQueueWal(storage)

    const checkpointSwitch = await sw.switchCoordinatorAuthorityQueueWalCheckpoint()

    assert.equal(checkpointSwitch.checkpointSwitched, true)
    assert.equal(checkpointSwitch.durable, true)
    assert.equal(checkpointSwitch.snapshotSeq, checkpointedRecordCount)
    assert.equal(checkpointSwitch.checkpointedRecords, checkpointedRecordCount)
    assert.equal(checkpointSwitch.tailLength, 0)
    assert.equal(checkpointSwitch.mirrorSaved, true)
    assert.equal(checkpointSwitch.physicalCleanup?.removed, true)
    assert.equal(checkpointSwitch.physicalCleanup.keyCount, 1)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.checkpointed'] || 0, 1)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.checkpointedRecords'] || 0, checkpointedRecordCount)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.physicalCleanupRemoved'] || 0, 1)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.physicalCleanupRemovedKeys'] || 0, 1)
    assert.equal(Object.prototype.hasOwnProperty.call(storage, 'mbCoordinatorQueueWal'), false)
    assert.equal(oldSegmentKeys.every(key => Object.prototype.hasOwnProperty.call(storage, key)), true)
    assert.equal(storage.mbCoordinatorQueue[hrefA].status, 'succeeded')
    assert.equal(storage.mbCoordinatorQueue[hrefB].status, 'succeeded')
    assert.equal(storage.mbCoordinatorQueue[hrefC].status, 'active')
    const recoveredAfterCheckpoint = recoverProjectedState(getStoredCoordinatorQueueWal(storage))
    assert.equal(recoveredAfterCheckpoint.checkpoint.snapshotSeq, checkpointedRecordCount)
    assert.equal(recoveredAfterCheckpoint.projected.state.queue[hrefA].status, 'succeeded')
    assert.equal(recoveredAfterCheckpoint.projected.state.queue[hrefC].status, 'active')
    walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
                getStoredCoordinatorQueueWal(restarted.storage),
                getStoredCoordinatorQueueWal(restarted.storage).meta.activeCheckpoint
            )
            const terminalProgress = records.find(record => record.operationKind === 'terminal-progress')
            const terminalSettlement = records.find(record => record.operationKind === 'terminal-settlement')
            return terminalProgress && terminalSettlement ? records : null
        },
        'post-checkpoint terminal progress and settlement records were not both appended',
        {attempts: 40}
    )
    const postTerminalProgress = postAppendRecords.find(record => record.operationKind === 'terminal-progress')
    const postTerminalSettlement = postAppendRecords.find(record => record.operationKind === 'terminal-settlement')
    assert.ok(postTerminalProgress.seq > checkpointedRecordCount)
    assert.ok(postTerminalSettlement.seq > checkpointedRecordCount)
    assert.equal(
        getStoredCoordinatorQueueWal(restarted.storage).meta.nextSeq,
        Math.max(...postAppendRecords.map(record => record.seq)) + 1
    )
})

test('terminal authority queue WAL physical cleanup failure does not poison checkpoint switch', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Cleanup-Failure'
    const runId = 'run-terminal-wal-cleanup-failure'
    const attemptId = 'attempt-terminal-wal-cleanup-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 252850,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: 529, now: 252850})
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
        terminalAt: 252860,
        actionKind: 'mute-block',
        runId,
        tabId: 529,
        attemptId,
        attemptNumber: 1
    }, {expectTerminal: true, senderTabId: 529})
    assert.equal(terminal.recorded, true)

    const oldActiveGeneration = getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    const oldSegmentKey = getSegmentedWalSegmentKey('mbCoordinatorQueueWal', oldActiveGeneration, 0)
    assert.ok(storage[oldSegmentKey])
    storage.mbCoordinatorQueueWal = getStoredCoordinatorQueueWal(storage)

    const originalRemove = browser.storage.local.remove.bind(browser.storage.local)
    browser.storage.local.remove = async keys => {
        const list = Array.isArray(keys) ? keys : [keys]
        if(list.includes('mbCoordinatorQueueWal') || list.includes(oldSegmentKey)) {
            throw new Error('synthetic physical cleanup failure')
        }
        return originalRemove(keys)
    }

    const checkpointSwitch = await sw.switchCoordinatorAuthorityQueueWalCheckpoint()

    assert.equal(checkpointSwitch.checkpointSwitched, true)
    assert.equal(checkpointSwitch.durable, true)
    assert.equal(checkpointSwitch.physicalCleanup?.removed, false)
    assert.equal(checkpointSwitch.physicalCleanup?.reason, 'storage-remove-failed')
    assert.equal(Object.prototype.hasOwnProperty.call(storage, 'mbCoordinatorQueueWal'), true)
    assert.equal(Object.prototype.hasOwnProperty.call(storage, oldSegmentKey), true)
    assert.equal(recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue[href].status, 'succeeded')
    const restarted = loadServiceWorkerHarness({
        now: 252870,
        storage
    })
    assert.equal((await restarted.sw.coordinatorAuthority.hydrate()).queue[href].status, 'succeeded')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.physicalCleanupFailed'] || 0, 1)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.physicalCleanupRemoved'] || 0, 0)
})

test('terminal authority queue WAL checkpoint removes legacy monolith before save', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Wal-Legacy-Monolith-Cleanup'
    const runId = 'run-terminal-wal-legacy-monolith-cleanup'
    const attemptId = 'attempt-terminal-wal-legacy-monolith-cleanup'
    const queue = {
        [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: 525, now: 252880})
    }
    const segmentedWal = makeSegmentedQueueWalStorage(queue, 2, {
        rowKey: href,
        createdAt: 252880
    })
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 252880,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: queue,
            ...segmentedWal,
            mbCoordinatorQueueWal: {
                staleLegacyMonolith: true
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
        if(payload?.['mbCoordinatorQueueWal.meta'] &&
            Object.prototype.hasOwnProperty.call(storage, 'mbCoordinatorQueueWal')) {
            throw new Error('synthetic quota pressure from stale monolith')
        }
        return originalSet(payload)
    }

    const checkpointSwitch = await sw.switchCoordinatorAuthorityQueueWalCheckpoint()

    assert.equal(checkpointSwitch.checkpointSwitched, true)
    assert.equal(checkpointSwitch.durable, true)
    assert.equal(Object.prototype.hasOwnProperty.call(storage, 'mbCoordinatorQueueWal'), false)
    assert.equal(getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint, 'B')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.legacyMonolithRemovedBeforeCheckpoint'] || 0, 1)
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
    assert.equal(recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue[href].status, 'succeeded')
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
    const previousWal = JSON.stringify(getStoredCoordinatorQueueWal(storage))
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(isCoordinatorQueueWalPayload(payload) && !payload?.mbCoordinatorQueue) {
            throw new Error('synthetic WAL checkpoint failure')
        }
        return originalSet(payload)
    }

    const checkpointSwitch = await sw.switchCoordinatorAuthorityQueueWalCheckpoint()

    assert.equal(checkpointSwitch.checkpointSwitched, false)
    assert.equal(checkpointSwitch.durable, false)
    assert.equal(checkpointSwitch.reason, 'wal-checkpoint-save-failed')
    assert.equal(JSON.stringify(getStoredCoordinatorQueueWal(storage)), previousWal)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue[href].status, 'succeeded')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.checkpointFailed'] || 0, 1)
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
})

test('direct nonterminal job progress is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Nonterminal-Progress-Wal'
    const runId = 'run-nonterminal-progress-wal'
    const attemptId = 'attempt-nonterminal-progress-wal'
    const tabId = 527
    const {browser, storage, sw} = loadServiceWorkerHarness({
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
    const getDefaults = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getDefaults.push(defaults)
        return originalGet(defaults)
    }

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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].milestones.blockAttemptedAt, 253600)
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocking')
    await waitFor(
        () => getProgressShardRecord(storage, href)?.status === 'blocking',
        'direct progress compatibility save did not materialize progress projection',
        {attempts: 20}
    )
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(getProgressShardRecord(storage, href).status, 'blocking')

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'direct-progress')
    const directLoadDefaults = getDefaults.find(defaults =>
        hasStorageDefault(defaults, 'mbCoordinatorQueue') &&
        hasStorageDefault(defaults, 'mbCoordinatorQueueWal') &&
        hasStorageDefault(defaults, 'mbCoordinatorRuns') &&
        Object.keys(defaults || {}).some(key => key.startsWith('mbProfileNukeProgressShard.')) &&
        !hasStorageDefault(defaults, 'mbProfileNukeProgressView')
    )
    assert.ok(directLoadDefaults)
    assert.equal(hasStorageDefault(directLoadDefaults, 'mbProfileNukeProgress'), false)
    assert.equal(hasStorageDefault(directLoadDefaults, 'mbProfileNukeProgressView'), false)
    assert.equal(Object.keys(directLoadDefaults).some(key => key.startsWith('mbProfileNukeProgressShard.')), true)
    assert.equal(hasStorageDefault(directLoadDefaults, 'mbCoordinatorEvents'), false)
    assert.equal(hasStorageDefault(directLoadDefaults, 'mbSpacePendingNukedPosts'), false)
    assert.equal(hasStorageDefault(directLoadDefaults, 'mbSpaceNukedPosts'), false)

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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if((payload?.mbProfileNukeProgressView ||
            Object.keys(payload || {}).some(key => key.startsWith('mbProfileNukeProgressShard.'))) &&
            !isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(sw.state().queueWakeupCounters['directProgress.compatibilitySaveFailed'] || 0, 0)
    assert.equal(sw.state().queueWakeupCounters['directProgress.derivedSaveFailed'] || 0, 1)
    browser.storage.local.set = originalSet
})

test('direct progress without queue mutation materializes progress shard only', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Direct-Progress-Projection-Only'
    const runId = 'run-direct-progress-projection-only'
    const attemptId = 'attempt-direct-progress-projection-only'
    const tabId = 531
    const {storage, sw} = loadServiceWorkerHarness({
        now: 253965,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 253965})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.recordCoordinatorJobProgress(href, {
        lastUrl: href,
        runId,
        tabId,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1,
        event: 'Synthetic direct progress projection-only breadcrumb'
    }, {senderTabId: tabId})

    assert.equal(result.recorded, true)
    assert.equal(result.terminal, false)
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView, undefined)
    assert.equal(getProgressShardRecord(storage, href).lastUrl, href)
    assert.equal(sw.state().profileNukeProgress[href].lastUrl, href)
})

test('direct progress inline projection failure leaves full mirror untouched', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Direct-Progress-Inline-Projection-Failure'
    const runId = 'run-direct-progress-inline-projection-failure'
    const attemptId = 'attempt-direct-progress-inline-projection-failure'
    const tabId = 532
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 253966,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 253966})
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
        if(payload?.mbProfileNukeProgressView ||
            Object.keys(payload || {}).some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
            throw new Error('synthetic direct progress inline projection failure')
        }
        return originalSet(payload)
    }

    try {
        const result = await sw.recordCoordinatorJobProgress(href, {
            lastUrl: href,
            runId,
            tabId,
            actionKind: 'mute-block',
            attemptId,
            attemptNumber: 1
        }, {senderTabId: tabId})

        assert.equal(result.recorded, true)
        assert.equal(result.terminal, false)
        assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
        assert.equal(storage.mbProfileNukeProgress[href], undefined)
        assert.equal(storage.mbProfileNukeProgressView, undefined)
        assert.equal(getProgressShardRecord(storage, href), null)
        assert.equal(sw.state().profileNukeProgress[href].lastUrl, href)
        assert.equal(sw.state().queueWakeupCounters['directProgress.compatibilitySaveFailed'] || 0, 0)
        assert.equal(sw.state().queueWakeupCounters['directProgress.derivedSaveFailed'] || 0, 1)
    }
    finally {
        browser.storage.local.set = originalSet
    }
})

test('legacy record-nuke-progress messages are disabled without storage mutation', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Legacy-Progress-Disabled'
    const runId = 'run-legacy-progress-disabled'
    const attemptId = 'attempt-legacy-progress-disabled'
    const tabId = 530
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 253970,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 253970})
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
                    updatedAt: 253960
                }
            }
        }
    })
    let setCalls = 0
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        setCalls += 1
        return originalSet(payload)
    }

    const singleResult = await browser.runtime.sendMessage({
        action: 'record-nuke-progress',
        profileHref: href,
        patch: {
            status: 'blocked',
            blockSucceeded: true,
            terminalAt: 253982,
            actionKind: 'mute-block',
            runId,
            tabId,
            attemptId,
            attemptNumber: 1
        }
    }, {
        tab: {id: tabId}
    })
    const batchResult = await browser.runtime.sendMessage({
        action: 'record-nuke-progress-batch',
        updates: [{
            profileHref: href,
            patch: {
                status: 'blocked',
                blockSucceeded: true,
                terminalAt: 253984,
                actionKind: 'mute-block',
                runId,
                tabId,
                attemptId,
                attemptNumber: 1
            }
        }]
    }, {
        tab: {id: tabId}
    })

    for(const result of [singleResult, batchResult]) {
        assert.equal(result.recorded, false)
        assert.equal(result.durable, false)
        assert.equal(result.compatibility, false)
        assert.equal(result.authority, false)
        assert.equal(result.reason, 'legacy-progress-message-disabled')
    }
    assert.equal(storage.mbProfileNukeProgress[href].status, 'blocking')
    assert.equal(storage.mbProfileNukeProgress[href].attemptId, attemptId)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    assert.equal(setCalls, 0)
    assert.equal(sw.state().queueWakeupCounters['progress.legacyMessageDisabled'] || 0, 1)
    assert.equal(sw.state().queueWakeupCounters['progressBatch.legacyMessageDisabled'] || 0, 1)

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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
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
    assert.equal(storage.mbProfileNukeProgress[hrefA], undefined)
    assert.equal(storage.mbProfileNukeProgress[hrefB], undefined)
    assert.equal(storage.mbProfileNukeProgressView.records[hrefA].status, 'blocked')
    assert.equal(storage.mbProfileNukeProgressView.records[hrefB].status, 'blocked')
    assert.equal(getProgressShardRecord(storage, hrefA).status, 'blocked')
    assert.equal(getProgressShardRecord(storage, hrefB).status, 'blocked')
    assert.equal(sw.state().queueWakeupCounters['storagePayload.write.path.terminalSettlement.save.queueWal.bytes'] > 0, true)
    assert.equal((sw.state().queueWakeupCounters['storagePayload.write.queue.bytes'] || 0), 0)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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

test('terminal settlement confirms missing queue row from projection-only progress', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Projection-Only-Missing'
    const postKey = 'post-terminal-projection-only-missing'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 254575,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {},
            mbCoordinatorRuns: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {},
            ...makeProgressProjectionSeed(href, {
                status: 'blocked',
                blockSucceeded: true,
                terminalAt: 254570,
                updatedAt: 254570
            }),
            mbSpacePendingNukedPosts: {
                [postKey]: {
                    postKey,
                    postUrl: 'https://www.quora.com/q/example/post-terminal-projection-only-missing',
                    spaceUrl: 'https://www.quora.com/q/example',
                    allUrls: [href],
                    remainingUrls: [href],
                    updatedAt: 254000
                }
            },
            mbSpaceNukedPosts: {}
        }
    })

    const result = await sw.settleTerminalCoordinatorItems({profileHrefs: [href]})

    assert.equal(result.settled, 1)
    assert.equal(result.confirmed, 1)
    assert.equal(result.cleared, 0)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey], undefined)
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'blocked')
    assert.equal(getProgressShardRecord(storage, href).status, 'blocked')
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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
        if(isCoordinatorQueueWalPayload(payload)) {
            throw new Error('synthetic terminal settlement WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.settleTerminalCoordinatorItems({profileHrefs: [href]})

    assert.equal(result.settled, 0)
    assert.equal(result.confirmed, 0)
    assert.ok(storage.mbSpacePendingNukedPosts['post-terminal-settlement-wal-append-failure'])
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(sw.coordinatorAuthority.current().queue[href].sourceSettlementOutcome, 'confirmed')
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
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
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )
})

test('terminal settlement progress projection failure does not poison authority settlement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Settlement-Progress-Projection-Failure'
    const runId = 'run-terminal-settlement-progress-projection-failure'
    const attemptId = 'attempt-terminal-settlement-progress-projection-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 254720,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 254720}),
                    status: 'succeeded',
                    outcome: 'blocked',
                    terminalAt: 254730,
                    updatedAt: 254730
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {},
            mbSpacePendingNukedPosts: {},
            mbSpaceNukedPosts: {}
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(payload?.mbProfileNukeProgressView ||
            Object.keys(payload || {}).some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
            throw new Error('synthetic terminal settlement progress projection failure')
        }
        return originalSet(payload)
    }

    const result = await sw.settleTerminalCoordinatorItems({profileHrefs: [href]})

    assert.equal(result.settled, 1)
    assert.equal(result.confirmed, 1)
    assert.equal(result.progressRestored, 1)
    assert.equal(storage.mbCoordinatorQueue[href].sourceSettlementOutcome, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].sourceSettlementOutcome, 'confirmed')
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView, undefined)
    assert.equal(getProgressShardRecord(storage, href), null)
    assert.equal(sw.state().profileNukeProgress[href].status, 'blocked')
    assert.equal(sw.state().queueWakeupCounters['terminalSettlement.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )
})

test('action lease request is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Request'
    const runId = 'run-lease-request'
    const attemptId = 'attempt-lease-request'
    const tabId = 619
    const now = 259000
    const {storage, sw, timers} = loadServiceWorkerHarness({
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    await timers.tick(0)
    await flushAsync(50)
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.reason, 'test-request')

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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

test('action lease request uses resident authority and defers projection save', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Lease-Request-Resident'
    const runId = 'run-lease-request-resident'
    const attemptId = 'attempt-lease-request-resident'
    const tabId = 6193
    const now = 259900
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
    await sw.coordinatorAuthority.hydrate()
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    let fullProjectionReads = 0
    browser.storage.local.get = async defaults => {
        if(defaults &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueue') &&
            Object.keys(defaults).some(key => key.startsWith('mbCoordinatorQueueWal'))) {
            fullProjectionReads += 1
            throw new Error('synthetic slow action lease projection read')
        }
        return originalGet(defaults)
    }

    const result = await sw.requestCoordinatorActionLease({
        profileHref: href,
        attemptId,
        attemptNumber: 1,
        actionKind: 'mute-block',
        reason: 'resident-request'
    }, {
        tab: {id: tabId}
    })
    browser.storage.local.get = originalGet

    assert.equal(result.granted, true)
    assert.ok(fullProjectionReads <= 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.reason, 'resident-request')
    assert.equal(storage.mbCoordinatorQueue[href].actionLease, undefined)
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.state().queueWakeupCounters['actionLease.request.messageResidentAuthority'] || 0, 1)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionDeferred'] || 0, 1)
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 2)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease.heartbeatAt, now)
    assert.equal(sw.coordinatorAuthority.current().queue[otherHref].actionLease.reason, 'expired-other')

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease, null)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLeaseReleaseReason, 'test-release')

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
        getStoredCoordinatorQueueWal(restarted.storage),
        getStoredCoordinatorQueueWal(restarted.storage).meta.activeCheckpoint
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease, null)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLeaseReleaseReason, 'queued-tab-slot-release')

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
        if(isCoordinatorQueueWalPayload(payload)) {
            throw new Error('synthetic action lease tab release WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.releaseCoordinatorActionLeaseForTab(tabId, 'queued-tab-slot-release')

    assert.equal(result.released, false)
    assert.equal(result.failedRows, 1)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease, null)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords[0].seq, 1)
    assert.equal(walRecords[1].seq, 2)
    assert.equal(getStoredCoordinatorQueueWal(storage).meta.nextSeq, 3)

    await waitFor(
        () => getProgressShardRecord(storage, hrefA)?.status === 'blocked' &&
            getProgressShardRecord(storage, hrefB)?.status === 'blocked',
        'concurrent terminal compatibility saves regressed one progress projection record',
        {attempts: 40}
    )

    assert.equal(getProgressShardRecord(storage, hrefA).status, 'blocked')
    assert.equal(getProgressShardRecord(storage, hrefB).status, 'blocked')
    assert.equal(getProgressShardRecord(storage, hrefA).attemptId, attemptIdA)
    assert.equal(getProgressShardRecord(storage, hrefB).attemptId, attemptIdB)
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
        if(payload?.mbProfileNukeProgressView ||
            Object.keys(payload || {}).some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
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
    assert.equal(sw.state().queueWakeupCounters['terminalProgress.compatibilitySaveFailed'] || 0, 0)
    assert.equal(sw.state().queueWakeupCounters['terminalProgress.derivedSaveFailed'] || 0, 1)
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
        if(payload?.mbProfileNukeProgressView ||
            Object.keys(payload || {}).some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
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

    await timers.tick(121000)
    await flushAsync(20)

    assert.equal(sw.state().queueWakeupCounters['terminalProgress.compatibilitySaveFailed'] || 0, 1)
    assert.ok((sw.state().queueWakeupCounters['storageUpdate.timedOut'] || 0) >= 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )
})

test('space-feed confirmation does not promote stale failed queue rows from the progress mirror', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Compatibility-Progress-Read-Only'
    const runId = 'run-compatibility-progress-read-only'
    const attemptId = 'attempt-compatibility-progress-read-only'
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
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'failed')
    assert.equal((await sw.coordinatorAuthority.hydrate()).queue[href].status, 'failed')
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    assert.equal(storage.mbCoordinatorRuns[runId].terminalCount, undefined)
    assert.equal(sw.state().queueWakeupCounters['progress.legacyMessageDisabled'] || 0, 0)
})

test('space-feed confirmation does not rewrite legacy progress mirror from queue authority', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Compatibility-Progress-Retired'
    const runId = 'run-compatibility-progress-retired'
    const attemptId = 'attempt-compatibility-progress-retired'
    const terminalRow = {
        ...makeFailedCoordinatorRow({href, runId, attemptId, now: 276500}),
        status: 'succeeded',
        outcome: 'blocked',
        error: '',
        terminalAt: 276500,
        updatedAt: 276500
    }
    const progressRecord = {
        profileHref: href,
        status: 'blocking',
        runId,
        tabId: 0,
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1,
        updatedAt: 276100
    }
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 276500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: terminalRow
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: progressRecord
            },
            mbSpacePendingNukedPosts: {},
            mbSpaceNukedPosts: {}
        }
    })

    const result = await browser.runtime.sendMessage({
        action: 'confirm-space-feed-profiles-blocked',
        profileHrefs: [href]
    }, {tab: {id: 12, windowId: 1}})

    assert.equal(result.confirmed, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'succeeded')
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    const storedRecord = Object.values(storage.mbProfileNukeProgress || {})
        .find(record => record?.profileHref === href)
    assert.deepEqual(storedRecord, progressRecord)
    assert.equal(sw.state().queueWakeupCounters['progress.legacyMessageDisabled'] || 0, 0)
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
            ...makeProgressProjectionSeed(href, {
                status: 'queued',
                runId,
                tabId: null,
                actionKind: 'mute-block',
                attemptId,
                attemptNumber: 1,
                updatedAt: 278000
            }),
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
    const getDefaults = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getDefaults.push(defaults)
        return originalGet(defaults)
    }

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
    assert.ok(storage.mbProfileNukeProgress[href])
    assert.equal(storage.mbProfileNukeProgressView.records[href], undefined)
    assert.equal(getProgressShardRecord(storage, href), null)
    assert.equal(sw.state().profileNukeProgress[href], undefined)
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), false)
    assert.equal(storage.mbCoordinatorRuns[runId].targetWorkKeys.includes(href), false)
    assert.equal(storage.mbCoordinatorRuns[runId].itemCount, 0)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey], undefined)
    assert.equal(storage.mbSpaceNukedPosts[postKey], undefined)
    assert.equal(storage.mbCoordinatorQueueView.counts.queued || 0, 0)
    const clearLoadDefaults = findStorageGetDefaults(getDefaults, [
        'mbCoordinatorQueue',
        'mbCoordinatorQueueWal',
        'mbCoordinatorRuns',
        'mbProfileNukeProgressView',
        getProgressShardKey(href),
        'mbSpacePendingNukedPosts',
        'mbSpaceNukedPosts'
    ])
    assert.ok(clearLoadDefaults)
    assert.equal(hasStorageDefault(clearLoadDefaults, 'mbCoordinatorEvents'), false)
    assert.equal(hasStorageDefault(clearLoadDefaults, 'mbProfileNukeProgress'), false)

    const records = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
            ...makeProgressProjectionSeed(href, {
                status: 'queued',
                runId,
                tabId: null,
                actionKind: 'mute-block',
                attemptId,
                attemptNumber: 1,
                updatedAt: 278250
            }),
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
    assert.equal(storage.mbProfileNukeProgressView.records[href], undefined)
    assert.equal(getProgressShardRecord(storage, href), null)
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), true)
    assert.equal(storage.mbCoordinatorRuns[runId].targetWorkKeys.includes(href), true)
    assert.ok(storage.mbSpacePendingNukedPosts[postKey])
    assert.ok(storage.mbSpaceNukedPosts[postKey])
    assert.equal(sw.state().queueWakeupCounters['clearProfile.derivedSaveFailed'], 1)

    const repair = await sw.reconcileCoordinatorStorage()

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
            ...makeProgressProjectionSeed(href, {
                status: 'queued',
                runId,
                tabId: null,
                actionKind: 'mute-block',
                attemptId,
                attemptNumber: 1,
                updatedAt: 278500
            }),
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.ok(storage.mbProfileNukeProgress[href])
    assert.equal(getProgressShardRecord(storage, href).status, 'queued')
    assert.ok(sw.state().profileNukeProgress[href])
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), true)
    assert.ok(storage.mbSpacePendingNukedPosts[postKey])
    assert.ok(storage.mbSpaceNukedPosts[postKey])
    const hydrated = await sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'queued')
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
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

test('dashboard reconcile request is display-only and does not schedule progress import', async () => {
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

    const result = await browser.runtime.sendMessage({action: 'reconcile-coordinator-storage'})

    assert.equal(result.reason, 'display-only-reconcile-disabled')
    assert.equal(result.displayOnly, true)
    assert.equal(result.reconcileScheduled, false)
    assert.equal(result.scheduledOnly, false)
    assert.equal(storage.mbCoordinatorQueue[href], undefined)
})

test('legacy repair coordinator request action is not accepted', async () => {
    const {browser, storage} = loadServiceWorkerHarness({
        now: 100250,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {}
        }
    })

    await activateQuoraRuntime(browser, 'https://www.quora.com/space/example')

    const legacyAction = ['repair', 'coordinator', 'storage'].join('-')
    const result = await browser.runtime.sendMessage({
        action: legacyAction,
        userInitiated: true,
        legacyImport: true
    })

    assert.equal(result, undefined)
    assert.deepEqual(storage.mbCoordinatorQueue, {})
})

test('explicit legacy import keeps progress restore quarantined from dashboard display path', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Orphan-Progress'
    const runId = 'run-synthetic-orphan-progress'
    const {browser, storage} = loadServiceWorkerHarness({
        now: 100500,
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
                    queuedAt: 100000,
                    actionKind: 'mute-block'
                }
            }
        }
    })

    await activateQuoraRuntime(browser, 'https://www.quora.com/space/example')

    const result = await browser.runtime.sendMessage({
        action: 'reconcile-coordinator-storage',
        legacyImport: true
    })

    assert.equal(result.reconcileScheduled, true)
    assert.equal(result.direct, true)
    assert.equal(result.reconcile.queueChanged, true)
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'repair'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'repairScheduled'), false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
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
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opened')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).attemptId, sw.coordinatorAuthority.current().queue[href].attemptId)
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

    const result = await settleWithFakeTimers(sw.reconcileCoordinatorStorage(), timers)

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

    await settleWithFakeTimers(sw.reconcileCoordinatorStorage(), timers)

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
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
    await waitFor(
        () => storage.mbProfileNukeProgressView?.records?.[href]?.status === 'profile-unavailable',
        'non-profile landing progress projection was not materialized',
        {timers, attempts: 20, tickMs: 0}
    )
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'profile-unavailable')
    assert.equal(getProgressShardRecord(storage, href).status, 'profile-unavailable')
    assert.match(getProgressShardRecord(storage, href).unavailableReason, /did not land on a profile page/)
    await waitFor(
        () => browser.__removedTabs.includes(tabId),
        'non-profile landing tab was not closed',
        {timers, attempts: 20, tickMs: 100}
    )
    assert.equal(browser.__tabs.has(tabId), false)
    assert.equal(browser.__removedTabs.includes(tabId), true)
    assert.deepEqual(sw.state().activeQueuedTabs, [])
})

test('queued profile tab redirecting to a different profile is skipped and closed', async () => {
    const href = 'https://www.quora.com/profile/Elon-Musk-2477'
    const redirectedHref = 'https://www.quora.com/profile/Elon-Musk-2486'
    const runId = 'run-profile-redirect-mismatch'
    const attemptId = 'attempt-profile-redirect-mismatch'
    const tabId = 506
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 411000,
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
                    queuedAt: 401000,
                    activeAt: 406000,
                    updatedAt: 406000,
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
                    tabOpenedAt: 406000,
                    updatedAt: 406000,
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
        url: redirectedHref,
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
        openedAt: 406000
    })

    await browser.tabs.onUpdated.emit(tabId, {
        status: 'complete',
        url: redirectedHref
    }, {
        id: tabId,
        windowId: 1,
        url: redirectedHref,
        status: 'complete'
    })
    await flushAsync(20)
    await timers.tick(1000)
    await flushAsync(20)

    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'profile-redirect-mismatch')
    assert.equal(storage.mbCoordinatorQueueView.counts.skipped, 1)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
    await waitFor(
        () => storage.mbProfileNukeProgressView?.records?.[href]?.status === 'profile-unavailable',
        'profile redirect mismatch progress projection was not materialized',
        {timers, attempts: 20, tickMs: 0}
    )
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'profile-unavailable')
    assert.equal(getProgressShardRecord(storage, href).status, 'profile-unavailable')
    assert.equal(getProgressShardRecord(storage, href).resolvedProfileHref, redirectedHref)
    assert.match(getProgressShardRecord(storage, href).unavailableReason, /redirected from/)
    await waitFor(
        () => browser.__removedTabs.includes(tabId),
        'profile redirect mismatch tab was not closed',
        {timers, attempts: 20, tickMs: 100}
    )
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
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
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
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'profile-unavailable')
    assert.equal(getProgressShardRecord(storage, href).status, 'profile-unavailable')
    assert.equal(browser.__tabs.has(tabId), false)
    assert.equal(browser.__removedTabs.includes(tabId), true)
})

test('non-profile landing terminalization is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Non-Profile-Authority'
    const topicUrl = 'https://www.quora.com/topic/Synthetic-Non-Profile-Authority'
    const runId = 'run-non-profile-authority'
    const attemptId = 'attempt-non-profile-authority'
    const tabId = 627
    const {browser, storage, sw} = loadServiceWorkerHarness({
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
    const getDefaults = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getDefaults.push(defaults)
        return originalGet(defaults)
    }

    const result = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'reconcile',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-authority'
    })

    assert.equal(result.changed, true)
    assert.equal(result.status, 'skipped')
    assert.equal(result.outcome, 'non-profile-target')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueueView.counts.skipped, 1)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'profile-unavailable')
    assert.equal(getProgressShardRecord(storage, href).status, 'profile-unavailable')
    assert.equal(getDefaults.some(defaults => Object.prototype.hasOwnProperty.call(defaults || {}, 'mbCoordinatorEvents')), false)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'terminalize-non-profile-landing')

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
        reason: 'reconcile',
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
        reason: 'reconcile',
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
        reason: 'reconcile',
        expectedAttemptId: 'stale-attempt',
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-stale'
    })

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'attempt-changed')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if(isCoordinatorQueueWalPayload(payload)) {
            throw new Error('synthetic non-profile authority WAL failure')
        }
        return originalSet(payload)
    }

    const result = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'reconcile',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-append-failure'
    })

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        reason: 'reconcile',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-projection-failure'
    })

    assert.equal(result.changed, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'profile-unavailable')
    assert.equal(getProgressShardRecord(storage, href).status, 'profile-unavailable')
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
        if(isCoordinatorQueueWalPayload(payload)) {
            walSaved = true
        }
        if(walSaved && !isCoordinatorQueueWalPayload(payload) && (payload?.mbCoordinatorRuns || payload?.mbProfileNukeProgress)) {
            throw new Error('synthetic non-profile derived save failure')
        }
        return originalSet(payload)
    }

    const result = await sw.terminalizeActiveCoordinatorNonProfileLanding(href, topicUrl, {
        reason: 'reconcile',
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reconcileReason: 'synthetic-non-profile-derived-failure'
    })

    assert.equal(result.changed, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'profile-unavailable')
    assert.equal(getProgressShardRecord(storage, href).status, 'profile-unavailable')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'skipped')
    assert.equal(sw.state().queueWakeupCounters['reconcile.nonProfileLanding.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )
})

test('key-only terminalization is WAL-backed and recovers after restart', async () => {
    const key = 'resolve-profile:https://www.quora.com/q/example/post-key-only-authority'
    const requestedUrl = 'https://www.quora.com/q/example/post-key-only-authority'
    const runId = 'run-key-only-authority'
    const attemptId = 'attempt-key-only-authority'
    const {browser, storage, sw} = loadServiceWorkerHarness({
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
    const getDefaults = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getDefaults.push(defaults)
        return originalGet(defaults)
    }

    const result = await sw.terminalizeCoordinatorKeyOnlyItem(key, {
        expectedAttemptId: attemptId,
        expectedAttemptNumber: 1,
        reason: 'synthetic-key-only-authority',
        now: 426000
    })
    browser.storage.local.get = originalGet

    assert.equal(result.changed, true)
    assert.equal(getDefaults.some(defaults => Object.prototype.hasOwnProperty.call(defaults || {}, 'mbProfileNukeProgress')), false)
    assert.equal(getDefaults.some(defaults => Object.prototype.hasOwnProperty.call(defaults || {}, 'mbCoordinatorEvents')), true)
    assert.equal(result.status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueueView.counts.failed, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'failed')
    assert.equal(storage.mbCoordinatorEvents.length, 1)
    assert.equal(storage.mbCoordinatorEvents[0].details.coordinatorKey, key)
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'terminalize-key-only')

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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
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
    const getDefaults = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getDefaults.push(defaults)
        return originalGet(defaults)
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

    assert.equal(result.resolved, true)
    assert.equal(storage.mbCoordinatorQueue[key].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[resolvedHref], undefined)
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[key], undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[resolvedHref].status, 'active')
    assert.equal(storage.mbSpacePendingNukedPosts[postKey].resolverPending, false)
    assert.deepEqual(storage.mbSpacePendingNukedPosts[postKey].allUrls, [resolvedHref])
    assert.deepEqual(storage.mbSpacePendingNukedPosts[postKey].remainingUrls, [resolvedHref])
    const resolverLoadDefaults = findStorageGetDefaults(getDefaults, [
        'mbCoordinatorQueue',
        'mbCoordinatorQueueWal',
        'mbCoordinatorRuns',
        'mbSpacePendingNukedPosts'
    ])
    assert.ok(resolverLoadDefaults)
    assert.equal(hasStorageDefault(resolverLoadDefaults, 'mbCoordinatorEvents'), false)
    assert.equal(hasStorageDefault(resolverLoadDefaults, 'mbProfileNukeProgress'), false)
    assert.equal(hasStorageDefault(resolverLoadDefaults, 'mbSpaceNukedPosts'), false)
    const metadata = sw.state().queuedTabMetadata.find(([id]) => id === tabId)?.[1]
    assert.equal(metadata.profileHref, resolvedHref)
    assert.equal(metadata.coordinatorKey, resolvedHref)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(storage.mbSpacePendingNukedPosts[postKey].resolverPending, true)
    assert.equal(sw.state().queueWakeupCounters['resolver.resolve.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )

    browser.storage.local.set = originalSet
    const repair = await sw.reconcileCoordinatorStorage()

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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
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
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(storage.mbCoordinatorEvents.length, 1)
    assert.equal(storage.mbSpacePendingNukedPosts[postKey].resolverPending, true)
    assert.equal(sw.state().queueWakeupCounters['resolverUnresolved.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )

    browser.storage.local.set = originalSet
    const repair = await sw.reconcileCoordinatorStorage()

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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
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
        if(isCoordinatorQueueWalPayload(payload)) {
            walSaved = true
        }
        if(walSaved &&
            !isCoordinatorQueueWalPayload(payload) &&
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
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(
        storage.mbCoordinatorEvents.some(event => event?.details?.reason === 'synthetic-key-only-derived-failure'),
        false
    )
    assert.equal(sw.coordinatorAuthority.current().queue[key].status, 'failed')
    assert.equal(sw.state().queueWakeupCounters['reconcile.keyOnlyTerminalize.derivedSaveFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )

    browser.storage.local.set = originalSet
    const repair = await sw.reconcileCoordinatorStorage()
    assert.equal(repair.eventsChanged, true)
    assert.equal(repair.runsChanged, true)
    assert.equal(
        storage.mbCoordinatorEvents.some(event => event?.itemId === key && event?.details?.coordinatorKey === key),
        true
    )
    assert.equal(storage.mbCoordinatorRuns[runId].status, 'complete')
    assert.equal(storage.mbCoordinatorRuns[runId].terminalCount, 1)
})

test('repair does not promote terminal error progress over active service-worker authority', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Terminal-Error'
    const runId = 'run-terminal-error'
    const attemptId = 'attempt-terminal-error'
    const tabId = 322
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
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
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    })

    await sw.reconcileCoordinatorStorage()

    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[href].outcome, undefined)
    assert.equal(storage.mbCoordinatorQueue[href].error, undefined)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'error')
    assert.equal(storage.mbProfileNukeProgress[href].finalError, 'Profile actions not ready')
})

test('coordinator reconcile scheduler keeps the earliest requested deadline', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 1000})

    sw.scheduleCoordinatorReconcile(5000, {allowBeforeQuora: true})
    assert.equal(sw.state().coordinatorReconcileDueAt, 6000)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [6000])

    sw.scheduleCoordinatorReconcile(1000, {allowBeforeQuora: true})
    assert.equal(sw.state().coordinatorReconcileDueAt, 2000)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [2000])
    assert.equal(browser.__alarmCreates.at(-1).name, 'mb-stored-work-repair')
    assert.equal(browser.__alarmCreates.at(-1).info.when, 2000)

    sw.scheduleCoordinatorReconcile(5000)
    assert.equal(sw.state().coordinatorReconcileDueAt, 2000)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [2000])
})

test('coordinator reconcile scheduler coalesces and backs off no-op reconcile', async () => {
    const {sw, timers} = loadServiceWorkerHarness({now: 0})

    await settleWithFakeTimers(sw.runScheduledCoordinatorReconcileTick('noop-repair-backoff'), timers)
    const backoffState = sw.state()
    assert.ok(backoffState.coordinatorReconcileBackoffLevel > 0)
    assert.ok(backoffState.coordinatorReconcileBackoffUntil > timers.now)

    assert.equal(sw.scheduleCoordinatorReconcile(1000, {
        allowBeforeQuora: true,
        reason: 'periodic-reconcile'
    }), true)
    assert.equal(sw.state().coordinatorReconcileDueAt, backoffState.coordinatorReconcileBackoffUntil)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [backoffState.coordinatorReconcileBackoffUntil])

    assert.equal(sw.scheduleCoordinatorReconcile(3000, {
        allowBeforeQuora: true,
        reason: 'periodic-reconcile'
    }), false)
    assert.equal(sw.state().coordinatorReconcileDueAt, backoffState.coordinatorReconcileBackoffUntil)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [backoffState.coordinatorReconcileBackoffUntil])

    assert.equal(sw.scheduleCoordinatorReconcile(1000, {
        allowBeforeQuora: true,
        reason: 'legacy-import-request'
    }), true)
    assert.equal(sw.state().coordinatorReconcileBackoffLevel, 0)
    assert.equal(sw.state().coordinatorReconcileBackoffUntil, 0)
    const edgeTriggeredDueAt = timers.now + 1000
    assert.equal(sw.state().coordinatorReconcileDueAt, edgeTriggeredDueAt)
    assert.deepEqual(timers.pending().map(timer => timer.dueAt), [edgeTriggeredDueAt])
})

test('stored-work repair hands queued-only durable work to fast executor', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Repair-Queued-Only-Fast-Resume'
    const runId = 'run-repair-queued-only-fast-resume'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3965,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({
                    href,
                    runId,
                    attemptId: 'attempt-repair-queued-only-fast-resume',
                    now: 3965
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser, href)
    const result = await settleWithFakeTimers(
        sw.runScheduledCoordinatorReconcileTick('synthetic-queued-only-repair'),
        timers,
        [0, 1000, 5000]
    )

    assert.equal(result, undefined)
    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'queued-only repair fast resume did not open a profile tab',
        {timers, attempts: 40, tickMs: 1000}
    )

    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['reconcile.queuedOnlyFastResumeScheduled'] || 0, 1)
    assert.equal((counters['pump.fastExecutor.changed'] || 0) > 0, true)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status))
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

test('storageGet timeout detaches serialized tail and suppresses late continuation writes', async () => {
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({now: 0})
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    const stalledGet = deferred()
    let intercepted = false
    let secondRan = false

    browser.storage.local.get = async defaults => {
        if(!intercepted) {
            intercepted = true
            return stalledGet.promise
        }
        return originalGet(defaults)
    }

    const first = sw.enqueueSpaceFeedStorageUpdate(async () => {
        await sw.metricStorageGet({mbStorageGetTailProbe: false}, {
            metricPath: 'synthetic.storageGetTailProbe'
        })
        await sw.metricStorageSet({mbStorageGetTailLateWrite: true})
        return 'first-late-ok'
    }, {
        reason: 'synthetic-storage-get-tail-recovery',
        timeoutMs: 1000,
        failureValue: 'timed-out'
    })

    await flushAsync(20)
    assert.equal(intercepted, true)
    await timers.tick(1000)
    assert.equal(await first, 'timed-out')
    assert.equal(sw.state().spaceFeedStorageUpdateDepth, 0)

    const second = sw.enqueueSpaceFeedStorageUpdate(() => {
        secondRan = true
        return 'second-ok'
    }, {
        reason: 'synthetic-storage-get-tail-second',
        timeoutMs: 1000
    })

    assert.equal(await second, 'second-ok')
    assert.equal(secondRan, true)
    assert.equal(sw.state().queueWakeupCounters['storageUpdate.serializedTailRecovered'], 1)
    assert.equal(sw.state().queueWakeupCounters['storageUpdate.storageGetTailRecovered'], 1)

    stalledGet.resolve({mbStorageGetTailProbe: true})
    await flushAsync(20)
    assert.equal(storage.mbStorageGetTailLateWrite, undefined)
    assert.equal(sw.state().queueWakeupCounters['storageUpdate.lateWriteSuppressed'], 1)
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
            tabId: status === 'active' ? 1000 + index : null,
            attemptId: status === 'active' ? `attempt-storage-view-${index}` : '',
            attemptNumber: status === 'active' ? index + 1 : 0,
            maxAttempts: status === 'active' ? 3 : 0,
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
    assert.equal(view.items[0].tabId, 1004)
    assert.equal(view.items[0].attemptId, 'attempt-storage-view-4')
    assert.equal(view.items[0].attemptNumber, 5)
    assert.equal(view.items[0].maxAttempts, 3)
    assert.equal(view.items[0].executorOwner, 'service-worker')
    assert.equal(view.items[0].serviceWorkerOwned, true)
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
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
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
            mbCoordinatorEvents: [{
                id: 'event-authority-hydrate',
                type: 'synthetic',
                at: 2990
            }],
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
    const getDefaults = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getDefaults.push(defaults)
        return originalGet(defaults)
    }

    assert.equal(sw.coordinatorAuthority.isHydrated(), false)
    const hydrated = await sw.coordinatorAuthority.hydrate()
    const current = sw.coordinatorAuthority.current()

    assert.equal(sw.coordinatorAuthority.isHydrated(), true)
    assert.equal(hydrated.queue[href].id, 'authority-hydrate-row')
    assert.equal(current.queue[href].attemptId, 'attempt-hydrate')
    assert.equal(current.runs['run-authority-hydrate'].queued, 1)
    assert.equal(current.progress[href].status, 'queued')
    assert.deepEqual(current.events, [])
    const hydrateDefaults = findStorageGetDefaults(getDefaults, [
        'mbCoordinatorQueue',
        'mbCoordinatorQueueWal',
        'mbCoordinatorRuns',
        'mbProfileNukeProgress'
    ])
    assert.ok(hydrateDefaults)
    assert.equal(hasStorageDefault(hydrateDefaults, 'mbCoordinatorEvents'), false)
    assert.equal(hasStorageDefault(hydrateDefaults, 'mbSpacePendingNukedPosts'), false)
    assert.equal(hasStorageDefault(hydrateDefaults, 'mbSpaceNukedPosts'), false)

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
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
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

test('storage timeout recovery clears stale scheduler latches and rearms resume', async () => {
    const {sw, timers} = loadServiceWorkerHarness({
        now: 200000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const gate = deferred()
    const staleStartedAt = 200000 - sw.state().constants.QUEUED_TAB_IDLE_FILL_PROMISE_STALE_MS - 1

    sw.__testSetQueuedTabFillPromise(new Promise(() => {}), staleStartedAt)
    sw.__testSetCoordinatorReconcilePromise(new Promise(() => {}), staleStartedAt)

    const updateResult = sw.enqueueSpaceFeedStorageUpdate(async () => {
        await gate.promise
        return {completed: true}
    }, {
        reason: 'synthetic-storage-timeout-recovery',
        timeoutMs: 1000,
        failureValue: {timedOut: true}
    })

    await flushAsync(20)
    await timers.tick(1000)
    assert.deepEqual(await updateResult, {timedOut: true})

    const state = sw.state()
    assert.equal(state.queuedTabFillPromise, false)
    assert.equal(state.coordinatorReconcilePromise, false)
    assert.equal(state.hasCoordinatorQueueResumeTimeout, true)
    assert.equal(state.hasCoordinatorReconcileTimeout, true)
    assert.equal(state.queueWakeupCounters['storageUpdate.timeoutRecoveryRequested'], 1)
    assert.equal(state.queueWakeupCounters['storageUpdate.clearedTimedOutFillPromise'], 1)
    assert.equal(state.queueWakeupCounters['storageUpdate.clearedTimedOutReconcilePromise'], 1)

    gate.resolve()
    await flushAsync(50)
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

test('abandoned storage update suppresses late writes but not authority reads', async () => {
    const href = 'https://www.quora.com/profile/Abandoned-Read-Keeps-Authority'
    const {sw, storage, timers} = loadServiceWorkerHarness({
        now: 1000,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    id: 'abandoned-read-row',
                    status: 'queued',
                    targetProfileHref: href,
                    updatedAt: 1000
                }
            }
        }
    })
    const gate = deferred()
    const observed = deferred()

    const updateResult = sw.enqueueSpaceFeedStorageUpdate(async () => {
        await gate.promise
        const stored = await sw.metricStorageGet({mbCoordinatorQueue: {}})
        const saved = await sw.metricStorageSet({mbSyntheticLateWrite: true})
        observed.resolve({stored, saved})
        return {done: true}
    }, {
        timeoutMs: 1000,
        failureValue: {timedOut: true}
    })

    await flushAsync(20)
    await timers.tick(1000)
    assert.deepEqual(await updateResult, {timedOut: true})

    gate.resolve()
    await flushAsync(50)
    const result = await observed.promise

    assert.equal(result.stored.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(result.saved, false)
    assert.equal(storage.mbSyntheticLateWrite, undefined)
    assert.equal(sw.state().queueWakeupCounters['storageUpdate.lateWriteSuppressed'], 1)
    await waitFor(
        () => sw.state().abandonedSpaceFeedStorageUpdates === 0,
        'abandoned storage update did not finish cleanup',
        {timers, attempts: 20, tickMs: 0}
    )
})

test('segmented queue WAL authority read skips obsolete monolithic WAL blob', async () => {
    const href = 'https://www.quora.com/profile/Segmented-No-Legacy-Read'
    const segmented = makeSegmentedQueueWalStorage({
        [href]: {
            id: 'segmented-no-legacy-read-row',
            status: 'queued',
            targetProfileHref: href,
            serviceWorkerOwned: true,
            executorOwner: 'service-worker',
            updatedAt: 1000
        }
    }, 1)
    const {browser, sw} = loadServiceWorkerHarness({
        now: 1000,
        storage: {
            mbCoordinatorQueue: {},
            mbCoordinatorQueueWal: {
                meta: {legacyBlobShouldNotBeRead: true},
                checkpoints: {},
                wal: {}
            },
            ...segmented
        }
    })
    const getCalls = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getCalls.push(defaults)
        return originalGet(defaults)
    }

    const accounting = await sw.getCoordinatorQueueAccounting({reason: 'synthetic'})

    assert.equal(accounting.recovered.total, 1)
    assert.equal(accounting.recovered.counts.queued, 1)
    assert.equal(accounting.wal.recovered, true)
    assert.equal(
        getCalls.some(defaults => defaults &&
            typeof defaults === 'object' &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueueWal')),
        false
    )
    assert.ok(getCalls.some(defaults => defaults?.['mbCoordinatorQueueWal.meta'] === null))
    assert.ok(getCalls.some(defaults => defaults?.['mbCoordinatorQueueWal.checkpoint.A'] === null))
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

test('storage update default timeout waits for the configured timeout', async () => {
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
            'reconcile.requested': 3,
            'reconcile.changed.queue': 2,
            'pump.requested': 5,
            'pump.changed.openedTab': 2,
            'nudge.sent': 4,
            'nudge.accepted': 1,
            'job.enqueued': 7,
            'job.terminal': 6,
            'job.completedOnlyAfterReconcile': 2
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
    assert.equal(previous.reconcile.requested, 3)
    assert.equal(previous.reconcile.changed, 2)
    assert.equal(previous.pump.requested, 5)
    assert.equal(previous.pump.changed, 2)
    assert.equal(previous.nudge.sent, 4)
    assert.equal(previous.nudge.accepted, 1)
    assert.equal(previous.jobs.enqueued, 7)
    assert.equal(previous.jobs.terminal, 6)
    assert.equal(previous.jobs.completedAfterReconcile, 2)
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
                'reconcile.requested': 9
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
                reconcile: {requested: 0, changed: 0},
                pump: {requested: 0, changed: 0, yield: 0},
                nudge: {sent: 0, accepted: 0, yield: 0},
                jobs: {enqueued: 0, terminal: 0, completedAfterReconcile: 0, completedAfterReconcileRate: 0},
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
    assert.equal(storage.mbQueueWakeupMetrics.currentEpoch.counters['reconcile.requested'], undefined)

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

test('service worker reload rearms stored work in an existing browser session', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Service-Worker-Reload-Rearm'
    const runId = 'run-service-worker-reload-rearm'
    const browser = createFakeBrowser({
        mbCoordinatorPaused: false,
        mbCoordinatorQueue: {
            [href]: makeQueuedCoordinatorRow({
                href,
                runId,
                attemptId: 'attempt-service-worker-reload-rearm',
                now: 20200
            })
        },
        mbCoordinatorQueueView: {
            version: 1,
            updatedAt: 20200,
            total: 1,
            counts: {queued: 1},
            authoritativeCounts: {queued: 1},
            hasAuthoritativeStoredWork: true,
            itemLimit: 80,
            truncated: false,
            items: []
        },
        mbCoordinatorRuns: {
            [runId]: makeCoordinatorRun({href, runId})
        },
        mbCoordinatorEvents: [],
        mbProfileNukeProgress: {}
    })
    browser.__sessionStorage.mbBrowserSessionMarker = {
        id: 'existing-session',
        reason: 'observed',
        observedAt: 20100
    }

    const {sw, timers} = loadServiceWorkerHarness({
        browser,
        now: 20200,
        runStartupWork: true
    })

    await timers.tick(1000)
    await flushAsync(1500)

    assert.equal(browser.__alarmCreates.some(alarm => alarm.name === 'mb-stored-work-repair' && !alarm.cleared), true)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
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
    assert.equal(result.resumeScheduled, true)
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

test('dashboard explicit start bypasses first Quora visit and opens queued work', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Explicit-Start'
    const runId = 'run-explicit-start'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3325,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    runId,
                    createdAt: 3000,
                    updatedAt: 3000,
                    attemptId: 'attempt-explicit-start',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await browser.runtime.sendMessage({
        action: 'resume-coordinator-queue',
        allowBeforeQuora: true,
        userInitiated: true
    })

    assert.equal(result.fallbackScheduled, true)
    assert.equal(result.scheduledOnly, true)
    assert.equal(result.resumeScheduled, true)
    assert.equal(result.reason, 'dashboard-resume-scheduled')
    assert.equal(result.directAuthorityChecked, false)
    assert.equal(result.authorityDeferred, true)
    assert.notEqual(result.reason, 'quora-runtime-not-activated')

    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'dashboard explicit start did not open queued work before Quora activation',
        {timers, attempts: 40, tickMs: 1000}
    )
    await waitFor(
        () => ['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status),
        'dashboard explicit start did not persist active queue authority state',
        {timers}
    )
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
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
    assert.equal(result.scheduledOnly, true)
    assert.equal(listTabs(browser).some(tab => tab.url === href), false)
})

test('browser startup leaves queued work idle when auto-start is disabled', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Auto-Start-Off'
    const {browser} = loadServiceWorkerHarness({
        now: 3325,
        storage: {
            coordinatorAutoStartOnBrowserStart: false,
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    createdAt: 3000,
                    updatedAt: 3000,
                    attemptId: 'attempt-auto-start-off',
                    attemptNumber: 1
                }
            }
        }
    })

    const results = await browser.runtime.onStartup.emit()

    assert.equal(results[0]?.autoStart, false)
    assert.equal(results[0]?.reason, 'browser-startup-auto-start-disabled')
    assert.equal(listTabs(browser).some(tab => tab.url === href), false)
    assert.equal(
        browser.__alarmCreates.some(alarm => alarm.name === 'mb-coordinator-resume' || alarm.name === 'mb-stored-work-repair'),
        false
    )
})

test('browser startup auto-start preference bypasses first Quora visit', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Auto-Start-On'
    const runId = 'run-auto-start-on'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3325,
        storage: {
            coordinatorAutoStartOnBrowserStart: true,
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    runId,
                    createdAt: 3000,
                    updatedAt: 3000,
                    attemptId: 'attempt-auto-start-on',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const results = await browser.runtime.onStartup.emit()

    assert.equal(results[0]?.requiresQuoraVisit, undefined)
    assert.equal(results[0]?.reason, 'browser-startup-auto-start-scheduled')
    assert.equal(results[0]?.fallbackScheduled, true)
    assert.equal(results[0]?.scheduledOnly, true)

    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'browser startup auto-start did not open queued work before Quora activation',
        {timers, attempts: 40, tickMs: 1000}
    )
    await waitFor(
        () => ['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status),
        'browser startup auto-start did not persist active queue authority state',
        {timers}
    )
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
})

test('extension update rearms queued stored work without a manual resume poke', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Update-Rearm'
    const runId = 'run-update-rearm'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3335,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({
                    href,
                    runId,
                    attemptId: 'attempt-update-rearm',
                    now: 3335
                })
            },
            mbCoordinatorQueueView: {
                version: 1,
                updatedAt: 3335,
                total: 1,
                counts: {queued: 1},
                authoritativeCounts: {queued: 1},
                hasAuthoritativeStoredWork: true,
                itemLimit: 80,
                truncated: false,
                items: []
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await browser.runtime.onInstalled.emit({reason: 'update'})
    await flushAsync(100)
    await timers.tick(1000)
    await flushAsync(1500)

    assert.equal(listTabs(browser).some(tab => tab.url === href), true)
    await waitFor(
        () => ['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status),
        'extension update rearm did not persist active queue authority state',
        {timers}
    )
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
})

test('dashboard resume starts service-worker queued work before alarm delivery', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Background-Fast-Resume'
    const runId = 'run-background-fast-resume'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3325,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    runId,
                    createdAt: 3000,
                    updatedAt: 3000,
                    attemptId: 'attempt-background-fast-resume',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser, href)

    const result = await browser.runtime.sendMessage({action: 'resume-coordinator-queue'})

    assert.equal(result.scheduledOnly, true)
    assert.equal(result.fallbackScheduled, true)
    assert.equal(result.resumeScheduled, true)
    assert.equal(result.alarmCreated, true)

    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'dashboard background fast resume did not open a profile tab before alarm delivery',
        {timers, attempts: 40, tickMs: 1000}
    )
    await waitFor(
        () => ['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status),
        'dashboard background fast resume did not persist active queue authority state',
        {timers}
    )
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
})

test('queued tab disappearing after active transition is requeued without active wedge', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Missing-After-Active'
    const runId = 'run-missing-after-active'
    const sourceSender = {tab: {id: 124, windowId: 1}}
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({now: 3610})
    const originalUpdate = browser.tabs.update
    let createdTabId = 0

    browser.tabs.update = async (tabId, options = {}) => {
        const tab = await originalUpdate(tabId, options)
        if(tab.url === href && options.active === true) {
            createdTabId = tab.id
            browser.__tabs.delete(tab.id)
            await browser.tabs.onRemoved.emit(tab.id, {isWindowClosing: false})
        }
        return tab
    }

    await settleWithFakeTimers(browser.runtime.sendMessage(makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1,
            noForegroundFallback: true
        }
    }), sourceSender), timers)

    await waitFor(
        () => createdTabId > 0,
        'service-worker executor tab was not opened for missing-after-active test',
        {timers}
    )
    await waitFor(
        () => getRecoveredCoordinatorQueue(storage)[href]?.status === 'queued',
        'missing post-transition tab was not durably requeued',
        {timers, tickMs: sw.state().constants.SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS}
    )
    await waitFor(
        () => !sw.state().activeQueuedTabs.includes(createdTabId),
        'missing post-transition tab left runtime active ownership behind',
        {timers}
    )

    assert.equal(browser.__tabs.has(createdTabId), false)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].tabId || null, null)
})

test('active transition retargets a replacement actor tab for the same attempt', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Replacement-Actor'
    const runId = 'run-replacement-actor'
    const attemptId = 'attempt-replacement-actor'
    const oldTabId = 1251
    const newTabId = 1252
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3620,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: oldTabId, now: 3600})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const action = {
        profileHref: href,
        targetUrl: href,
        requestedUrl: href,
        coordinatorKey: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        ownerTabId: 'service-worker-queue-owner',
        attemptId,
        attemptNumber: 1
    }

    browser.__tabs.set(newTabId, {
        id: newTabId,
        url: href,
        status: 'complete',
        active: true,
        windowId: 1,
        title: 'Synthetic Replacement Actor - Quora'
    })
    sw.__testAddProvisionalQueuedTab(newTabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        ownerTabId: 'service-worker-queue-owner',
        runId,
        attemptId,
        attemptNumber: 1
    }, action)

    const transitioned = await sw.transitionCoordinatorItemForQueuedTab(action, {id: newTabId}, {
        openedAt: 3620,
        retryAttempt: 0,
        maxRetries: 0,
        attemptId,
        attemptNumber: 1
    })

    assert.equal(transitioned, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].tabId, newTabId)
    assert.equal(storage.mbCoordinatorQueueView.items.find(item => item.storageKey === href).tabId, newTabId)
})

test('stored-work repair alarm clears the pending timeout and runs repair', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    sw.scheduleCoordinatorReconcile(1000)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    assert.ok(timers.pending().some(timer => timer.dueAt === 1000))

    await browser.alarms.onAlarm.emit({name: 'mb-stored-work-repair'})

    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
    assert.equal(sw.state().coordinatorReconcileDueAt, 0)
    assert.equal(timers.pending().some(timer => timer.dueAt === 1000), false)
})

test('coordinator reconcile timeout clears and suppresses stale alarm delivery', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    sw.scheduleCoordinatorReconcile(1000)

    await timers.tick(1000)
    await flushAsync(20)

    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
    assert.equal(sw.state().coordinatorReconcileDueAt, 0)
    assert.ok(browser.__alarmCreates.some(alarm => alarm.name === 'mb-stored-work-repair' && alarm.cleared))

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({name: 'mb-stored-work-repair'})
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal((afterCounters['reconcile.alarmStale'] || 0), (beforeCounters['reconcile.alarmStale'] || 0) + 1)
    assert.equal((afterCounters['reconcile.alarmFired'] || 0), beforeCounters['reconcile.alarmFired'] || 0)
})

test('coordinator reconcile suppresses identifiable stale alarm after suppression window', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    sw.scheduleCoordinatorReconcile(1000)

    await timers.tick(1000)
    await flushAsync(20)
    await timers.tick(6000)

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({
        name: 'mb-stored-work-repair',
        scheduledTime: 1000
    })
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal((afterCounters['reconcile.alarmStale'] || 0), (beforeCounters['reconcile.alarmStale'] || 0) + 1)
    assert.equal((afterCounters['reconcile.alarmFired'] || 0), beforeCounters['reconcile.alarmFired'] || 0)
})

test('coordinator reconcile accepts Chrome-delayed scheduled alarm delivery', async () => {
    const {browser, sw} = loadServiceWorkerHarness({now: 0})

    browser.__tabs.set(101, {
        id: 101,
        url: 'https://www.quora.com/profile/Synthetic-Activation',
        status: 'complete'
    })
    assert.equal(sw.scheduleCoordinatorReconcile(1000, {
        allowBeforeQuora: true,
        reason: 'synthetic-delayed-live-reconcile-alarm'
    }), true)

    await browser.alarms.onAlarm.emit({
        name: 'mb-stored-work-repair',
        scheduledTime: 31000
    })
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
    assert.equal(sw.state().coordinatorReconcileDueAt, 0)
    assert.equal(afterCounters['reconcile.alarmStale'] || 0, 0)
    assert.equal(afterCounters['reconcile.noop'] || 0, 1)
})

test('coordinator reconcile stale alarm cannot steal a newer timeout', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    sw.scheduleCoordinatorReconcile(1000)
    await timers.tick(1000)
    await flushAsync(20)

    sw.scheduleCoordinatorReconcile(5000, {
        allowBeforeQuora: true,
        reason: 'periodic-reconcile'
    })
    const newerDueAt = sw.state().coordinatorReconcileDueAt
    assert.equal(newerDueAt, timers.now + 5000)

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({
        name: 'mb-stored-work-repair',
        scheduledTime: 1000
    })
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    assert.equal(sw.state().coordinatorReconcileDueAt, newerDueAt)
    assert.equal((afterCounters['reconcile.alarmStale'] || 0), (beforeCounters['reconcile.alarmStale'] || 0) + 1)
    assert.equal((afterCounters['reconcile.alarmFired'] || 0), beforeCounters['reconcile.alarmFired'] || 0)
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

test('coordinator resume accepts Chrome-delayed scheduled alarm delivery', async () => {
    const {browser, sw} = loadServiceWorkerHarness({now: 0})

    browser.__tabs.set(101, {
        id: 101,
        url: 'https://www.quora.com/profile/Synthetic-Activation',
        status: 'complete'
    })
    const result = await sw.kickCoordinatorQueueResume('synthetic-delayed-live-resume-alarm')
    assert.equal(result.scheduledOnly, true)

    await browser.alarms.onAlarm.emit({
        name: 'mb-coordinator-resume',
        scheduledTime: 30600
    })
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, false)
    assert.equal(sw.state().coordinatorQueueResumeDueAt, 0)
    assert.equal(afterCounters['pump.alarmStale'] || 0, 0)
    assert.equal(afterCounters['pump.fastExecutor.noop'] || 0, 1)
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

test('non-dashboard coordinator resume schedules alarm-backed continuation', async () => {
    const {browser, sw} = loadServiceWorkerHarness({now: 0})

    assert.equal(sw.scheduleCoordinatorQueueResume(1000, 'synthetic-continuation', {
        allowBeforeQuora: true
    }), true)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().coordinatorQueueResumeDueAt, 1000)
    assert.ok(browser.__alarmCreates.some(alarm =>
        alarm.name === 'mb-coordinator-resume' &&
        alarm.info?.when === 1000
    ))

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({
        name: 'mb-coordinator-resume',
        scheduledTime: 1000
    })
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, false)
    assert.equal(sw.state().coordinatorQueueResumeDueAt, 0)
    assert.equal((afterCounters['pump.alarmFired'] || 0), (beforeCounters['pump.alarmFired'] || 0) + 1)
})

test('dashboard resume reschedules stale in-memory resume timeout that never fired', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    const firstResult = await browser.runtime.sendMessage({action: 'resume-coordinator-queue'})

    assert.equal(firstResult.scheduledOnly, true)
    assert.equal(firstResult.resumeScheduled, true)
    assert.equal(firstResult.alarmCreated, true)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().coordinatorQueueResumeDueAt, 600)

    timers.setNow(10_000)
    const secondResult = await browser.runtime.sendMessage({action: 'resume-coordinator-queue'})
    const counters = sw.state().queueWakeupCounters

    assert.equal(secondResult.scheduledOnly, true)
    assert.equal(secondResult.resumeScheduled, true)
    assert.equal(secondResult.alarmCreated, true)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().coordinatorQueueResumeDueAt, 10_600)
    assert.equal(counters['pump.staleTimeoutCleared'], 1)
    assert.ok(browser.__alarmCreates.some(alarm =>
        alarm.name === 'mb-coordinator-resume' &&
        alarm.info?.when === 10_600
    ))
})

test('coordinator reconcile reschedules stale in-memory repair timeout that never fired', async () => {
    const {browser, sw, timers} = loadServiceWorkerHarness({now: 0})

    await activateQuoraRuntime(browser)
    assert.equal(sw.scheduleCoordinatorReconcile(1000, {reason: 'synthetic-first-repair'}), true)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    assert.equal(sw.state().coordinatorReconcileDueAt, 1000)

    timers.setNow(10_000)
    assert.equal(sw.scheduleCoordinatorReconcile(1000, {reason: 'synthetic-second-repair'}), true)
    const counters = sw.state().queueWakeupCounters

    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    assert.equal(sw.state().coordinatorReconcileDueAt, 11_000)
    assert.equal(counters['reconcile.staleTimeoutCleared'], 1)
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
    assert.equal(nonterminalCounters['reconcile.edgeTriggered'] || 0, 0)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)

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
    assert.equal(terminalCounters['reconcile.edgeTriggered'] || 0, 1)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
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

test('content-page projection rebuild preserves projection-only progress rows', async () => {
    const href = 'https://www.quora.com/profile/Projection-Only-Completed-Profile'
    const {browser, storage} = loadServiceWorkerHarness({
        storage: {
            mbCoordinatorContentQueueIndex: {
                version: 1,
                updatedAt: 10,
                total: 0,
                indexed: 0,
                itemLimit: 1200,
                truncated: false,
                items: []
            },
            mbProfileNukeProgress: {},
            ...makeProgressProjectionSeed(href, {
                status: 'blocked',
                blockSucceeded: true,
                blockAttemptedAt: 20,
                updatedAt: 21
            })
        }
    })

    const result = await browser.runtime.sendMessage({
        action: 'get-content-page-coordinator-state',
        pageType: 'profile-search',
        profileHrefs: [href]
    })

    assert.equal(result.progressRows, 1)
    assert.equal(result.profileNukeProgress[href].status, 'blocked')
    assert.equal(result.profileNukeProgress[href].blockSucceeded, true)
    assert.equal(result.profileNukeProgress[href].blockAttemptedAt, 20)
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'blocked')
    assert.equal(getProgressShardRecord(storage, href).status, 'blocked')
    assert.equal(getProgressShardRecord(storage, href).blockAttemptedAt, 20)
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

    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
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
    assert.equal(result.scheduledOnly, true)

    void browser.alarms.onAlarm.emit({name: 'mb-coordinator-resume'})

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

    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
    assert.equal(sw.state().coordinatorReconcileDueAt, 0)
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
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
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

    let profileTab = listTabs(browser).find(tab =>
        tab.url === href &&
        [existingSurface.id, duplicateSurface.id].includes(tab.windowId) &&
        browser.__windows.has(tab.windowId))
    if(!profileTab) {
        await settleWithFakeTimers(sw.resumeCoordinatorQueueExecution({
            tabId: 'service-worker-queue-owner',
            windowId: null
        }, {
            serviceWorkerOwned: true,
            skipRepair: true,
            skipAuthorityReconcile: true,
            awaitFill: true
        }), timers)
        profileTab = listTabs(browser).find(tab =>
            tab.url === href &&
            [existingSurface.id, duplicateSurface.id].includes(tab.windowId) &&
            browser.__windows.has(tab.windowId))
    }
    if(!profileTab) {
        assert.ok((sw.state().queueWakeupCounters.storageUpdate?.timedOut || 0) || (sw.state().queueWakeupCounters['storageUpdate.timedOut'] || 0))
        return
    }
    assert.ok(browser.__windows.size <= windowCountBefore)
    assert.ok([existingSurface.id, duplicateSurface.id].includes(profileTab?.windowId))
    assert.equal((await browser.tabs.get(userTab.id)).active, true)
    const progressRecorded = await waitFor(
        () => getProgressShardRecord(storage, href)?.status === 'tab-opening',
        'reused worker action surface progress was not recorded',
        {timers, attempts: 60, tickMs: 100}
    ).catch(() => false)
    if(!progressRecorded) {
        assert.ok((sw.state().queueWakeupCounters.storageUpdate?.timedOut || 0) ||
            (sw.state().queueWakeupCounters['storageUpdate.timedOut'] || 0) ||
            (sw.state().queueWakeupCounters['storageUpdate.fallbackReturned'] || 0))
        return
    }
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView.records[href].actionSurfaceMode, 'worker-window')
    assert.equal(getProgressShardRecord(storage, href).actionSurfaceMode, 'worker-window')
    assert.equal(sw.state().queueWakeupCounters['actionSurface.workerWindow.created'] || 0, 0)
    assert.ok(browser.__removedTabs.includes(duplicateSurface.tabs[0].id))
})

test('service-worker reuses persisted worker window when tab URLs are hidden', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Worker-Surface-Persisted'
    const runId = 'run-worker-surface-persisted'
    const attemptId = 'attempt-worker-surface-persisted'
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
    const anchorTabId = existingSurface.tabs[0].id
    browser.__tabs.set(anchorTabId, {
        ...browser.__tabs.get(anchorTabId),
        url: ''
    })
    await browser.storage.session.set({
        mbQueuedActionSurfaceState: {
            windowId: existingSurface.id,
            anchorTabId,
            url: browser.runtime.getURL('coordinator.html#worker-window'),
            reason: 'previous-service-worker',
            updatedAt: 2001
        }
    })
    const {sw, timers} = loadServiceWorkerHarness({browser, now: 2089})
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

    const profileTabs = listTabs(browser).filter(tab => tab.url === href)
    assert.equal(profileTabs.length, 1)
    assert.equal(profileTabs[0].windowId, existingSurface.id)
    assert.equal(browser.__windows.size, windowCountBefore)
    assert.equal((await browser.tabs.get(userTab.id)).active, true)
    assert.equal(sw.state().queuedActionSurfaceWindowId, existingSurface.id)
    assert.equal(sw.state().queuedActionSurfaceAnchorTabId, anchorTabId)
    assert.equal(sw.state().queueWakeupCounters['actionSurface.workerWindow.created'] || 0, 0)
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

test('begin-profile-action promotes from sender tab when tab lookup is transiently missing', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Sender-Tab-Promote'
    const runId = 'run-sender-tab-promote'
    const attemptId = 'attempt-sender-tab-promote'
    const tabId = 252
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3060,
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
                    queuedAt: 2960,
                    activeAt: 3060,
                    updatedAt: 3060,
                    tabId,
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
    browser.__setNextTabId(tabId)
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
        actionSurfaceMode: 'worker-window',
        attemptId,
        attemptNumber: 1
    })
    const originalGet = browser.tabs.get.bind(browser.tabs)
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === tabId) {
            throw new Error(`no fake tab ${candidateTabId}`)
        }
        return originalGet(candidateTabId)
    }

    const result = await browser.runtime.sendMessage({
        action: 'begin-profile-action',
        profileHref: href,
        actionKind: 'mute-block',
        reason: 'block-confirmation',
        attemptId,
        attemptNumber: 1
    }, {tab})
    browser.tabs.get = originalGet

    assert.equal(result.begun, true)
    assert.equal(result.granted, true)
    assert.equal(result.foregroundPromoted, true)
    assert.equal(result.foregroundMode, 'worker-window')
    const recoveredQueue = recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue
    assert.equal(recoveredQueue[href].actionLease.tabId, tab.id)
    assert.equal(recoveredQueue[href].actionLeaseReleaseReason, '')
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

test('service-worker durable queue clears stale owner pause before opening next row', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Stale-Service-Worker-Pause'
    const runId = 'run-stale-service-worker-pause'
    const attemptId = 'attempt-stale-service-worker-pause'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 2280,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 2280})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    sw.__testPauseQueuedOwner('service-worker-queue-owner')

    await settleWithFakeTimers(sw.resumeCoordinatorQueueExecution({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-stale-service-worker-pause'
    }), timers)

    assert.equal(sw.state().pausedQueuedOwners.includes('service-worker-queue-owner'), false)
    assert.equal(sw.state().queueWakeupCounters['pump.changed.clearedStaleServiceWorkerOwnerPause'], 1)
    assert.ok(listTabs(browser).some(tab => tab.url === href))
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status))
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
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
    const recoveredQueue = recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
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
        if(payload?.mbCoordinatorRuns && payload?.mbCoordinatorEvents && !isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    browser.storage.local.set = originalSet
    const getDefaults = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getDefaults.push(defaults)
        return originalGet(defaults)
    }

    const repair = await sw.reconcileCoordinatorStorage()

    assert.ok(repair.repaired > 0)
    assert.equal(repair.runsChanged, true)
    assert.equal(repair.progressChanged, false)
    assert.equal(repair.eventsChanged, true)
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), true)
    assert.equal(storage.mbCoordinatorRuns[runId].targetWorkKeys.includes(href), true)
    assert.equal(storage.mbProfileNukeProgress?.[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'queued')
    assert.equal(storage.mbProfileNukeProgressView.records[href].runId, runId)
    assert.equal(storage.mbProfileNukeProgressView.records[href].attemptId, getRecoveredCoordinatorQueue(storage)[href].attemptId)
    assert.equal(storage.mbCoordinatorEvents.some(event =>
        event.runId === runId &&
        event.type === 'repair' &&
        event.details?.reason === 'enqueue-derived-repair'
    ), true)
    const repairLoadDefaults = findStorageGetDefaults(getDefaults, [
        'mbCoordinatorQueue',
        'mbCoordinatorQueueWal',
        'mbCoordinatorRuns',
        'mbCoordinatorEvents',
        'mbProfileNukeProgress',
        'mbCoordinatorPaused',
        'mbSpacePendingNukedPosts',
        'mbSpaceNukedPosts'
    ])
    assert.ok(repairLoadDefaults)
})

test('explicit legacy import materializes projection-only queued progress', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Projection-Only-Queued-Repair'
    const runId = 'run-projection-only-queued-repair'
    const attemptId = 'attempt-projection-only-queued-repair'
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3120,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {},
            mbCoordinatorRuns: {
                [runId]: {
                    ...makeCoordinatorRun({href, runId}),
                    targetProfileHrefs: [href],
                    targetWorkKeys: [href]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {},
            ...makeProgressProjectionSeed(href, {
                status: 'queued',
                actionKind: 'mute-block',
                runId,
                attemptId,
                attemptNumber: 1,
                queuedAt: 3100,
                updatedAt: 3100
            })
        }
    })
    const getDefaults = []
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    browser.storage.local.get = async defaults => {
        getDefaults.push(defaults)
        return originalGet(defaults)
    }

    const ordinaryReconcile = await sw.reconcileCoordinatorStorage()

    assert.equal(ordinaryReconcile.queueChanged, false)
    assert.equal(storage.mbCoordinatorQueue[href], undefined)

    const repair = await sw.reconcileCoordinatorStorage({legacyImport: true})

    assert.equal(repair.queueChanged, true)
    assert.equal(repair.progressChanged, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[href].runId, runId)
    assert.equal(storage.mbProfileNukeProgress?.[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).status, 'queued')
    const repairLoadDefaults = findStorageGetDefaults(getDefaults, [
        'mbCoordinatorQueue',
        'mbCoordinatorQueueWal',
        'mbCoordinatorRuns',
        'mbCoordinatorEvents',
        'mbProfileNukeProgress',
        'mbProfileNukeProgressView',
        'mbCoordinatorPaused',
        'mbSpacePendingNukedPosts',
        'mbSpaceNukedPosts'
    ])
    assert.ok(repairLoadDefaults)
})

test('stored-work repair terminal raw row updates WAL authority', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Repair-Terminal-Wal'
    const runId = 'run-repair-terminal-wal'
    const attemptId = 'attempt-repair-terminal-wal'
    const activeRow = makeActiveCoordinatorRow({
        href,
        runId,
        attemptId,
        tabId: 701,
        now: 3200
    })
    const rawFailedRow = {
        ...activeRow,
        status: 'failed',
        outcome: 'timeout',
        error: 'Queued tab timed out after disappearing before completion',
        terminalAt: 3300,
        updatedAt: 3300,
        tabId: null,
        actionLease: null,
        actionLeaseReleasedAt: 3300,
        actionLeaseReleaseReason: 'terminal-progress'
    }
    const staleProgress = {
        profileHref: href,
        status: 'queued',
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1,
        runId,
        tabId: null,
        queuedAt: 3100,
        updatedAt: 3300
    }
    const {storage, sw} = loadServiceWorkerHarness({
        now: 3400,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: rawFailedRow
            },
            ...makeSegmentedQueueWalStorage({
                [href]: activeRow
            }, 0, {createdAt: 3100}),
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: staleProgress
            },
            ...makeProgressProjectionSeed(href, staleProgress)
        }
    })

    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')

    const repair = await sw.reconcileCoordinatorStorage()

    assert.equal(repair.queueChanged, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'failed')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'failed')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'interrupted')
    const walStore = getStoredCoordinatorQueueWal(storage)
    const records = getWalRecordsForGeneration(walStore, walStore.meta.activeCheckpoint)
    assert.equal(records.some(record =>
        record.key === href &&
        record.operationKind === 'reconcile-progress' &&
        record.status === 'failed'
    ), true)
})

test('enqueue progress projection failure does not poison durable WAL acknowledgement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Enqueue-Projection-Failure'
    const runId = 'run-enqueue-projection-failure'
    const sourceSender = {tab: {id: 12, windowId: 1}}
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3080,
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
        if(payload?.mbProfileNukeProgressView ||
            Object.keys(payload || {}).some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
            throw new Error('synthetic enqueue projection failure')
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
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(storage.mbCoordinatorRuns[runId].targetProfileHrefs.includes(href), true)
    assert.equal(storage.mbProfileNukeProgress?.[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView, undefined)
    assert.equal(getProgressShardRecord(storage, href), null)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
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
        if(payload?.mbCoordinatorRuns && payload?.mbCoordinatorEvents && !isCoordinatorQueueWalPayload(payload)) {
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

    const repair = await sw.reconcileCoordinatorStorage()

    assert.ok(repair.repaired > 0)
    assert.equal(repair.progressChanged, false)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opened')
    assert.equal(storage.mbProfileNukeProgress[href].runId, oldRunId)
    assert.equal(storage.mbProfileNukeProgress[href].attemptId, oldAttemptId)
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'queued')
    assert.equal(storage.mbProfileNukeProgressView.records[href].runId, nextRunId)
    assert.equal(storage.mbProfileNukeProgressView.records[href].attemptId, walRow.attemptId)
    assert.equal(storage.mbProfileNukeProgressView.records[href].attemptNumber, walRow.attemptNumber)
    assert.equal(storage.mbProfileNukeProgressView.records[href].tabId, null)
    assert.notEqual(storage.mbProfileNukeProgressView.records[href].blockAttempted, true)
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
    assert.equal(storage.mbProfileNukeProgress[href], undefined)
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).attemptId, getRecoveredCoordinatorQueue(storage)[href].attemptId)

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

    assert.equal(result.scheduledOnly, true)
    assert.equal(result.fallbackScheduled, true)
    assert.equal(result.reason, 'dashboard-resume-scheduled')

    await browser.alarms.onAlarm.emit({name: 'mb-coordinator-resume'})

    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'dashboard durable queued resume did not open a profile tab',
        {timers, attempts: 40, tickMs: 1000}
    )
    await waitFor(
        () => ['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status),
        'async durable queued resume did not persist active queue authority state',
        {timers}
    )
})

test('scheduled resume alarm starts durable queued work through executor fast path', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Scheduled-Fast-Resume'
    const runId = 'run-scheduled-fast-resume'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3350,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1,
                    runId,
                    createdAt: 3000,
                    updatedAt: 3000,
                    attemptId: 'attempt-scheduled-fast-resume',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser, href)
    const scheduled = await sw.kickCoordinatorQueueResume('synthetic-scheduled-fast-resume')
    assert.equal(scheduled.scheduledOnly, true)
    assert.equal(scheduled.reason, 'synthetic-scheduled-fast-resume-scheduled')

    const beforeCounters = sw.state().queueWakeupCounters
    await browser.alarms.onAlarm.emit({name: 'mb-coordinator-resume'})
    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'scheduled fast resume did not open a profile tab',
        {timers, attempts: 40, tickMs: 1000}
    )
    const afterCounters = sw.state().queueWakeupCounters

    assert.equal((afterCounters['pump.fastExecutor.changed'] || 0), (beforeCounters['pump.fastExecutor.changed'] || 0) + 1)
    assert.equal((afterCounters['reconcile.requested'] || 0), beforeCounters['reconcile.requested'] || 0)
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status))
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
})

test('terminal progress continuation starts next queued row through fast executor', async () => {
    const terminalHref = 'https://www.quora.com/profile/Synthetic-Terminal-Continuation-Done'
    const nextHref = 'https://www.quora.com/profile/Synthetic-Terminal-Continuation-Next'
    const runId = 'run-terminal-continuation'
    const terminalAttemptId = 'attempt-terminal-continuation-done'
    const nextAttemptId = 'attempt-terminal-continuation-next'
    const terminalTabId = 809
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3370,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [terminalHref]: {
                    ...makeActiveCoordinatorRow({
                        href: terminalHref,
                        runId,
                        attemptId: terminalAttemptId,
                        tabId: terminalTabId,
                        now: 3370
                    }),
                    executorMaxConcurrent: 1
                },
                [nextHref]: {
                    ...makeQueuedCoordinatorRow({
                        href: nextHref,
                        runId,
                        attemptId: nextAttemptId,
                        now: 3370
                    }),
                    executorMaxConcurrent: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [terminalHref, nextHref],
                    targetWorkKeys: [terminalHref, nextHref]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(terminalTabId, {
        id: terminalTabId,
        url: terminalHref,
        status: 'complete'
    })
    sw.__testAddProvisionalQueuedTab(terminalTabId, {
        profileHref: terminalHref,
        coordinatorKey: terminalHref,
        requestedUrl: terminalHref,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId: terminalAttemptId,
        attemptNumber: 1,
        openedAt: 3360,
        durableActiveAt: 3365,
        durableActiveReason: 'active-transition'
    })
    await activateQuoraRuntime(browser, terminalHref)

    const result = await browser.runtime.sendMessage({
        action: 'record-job-terminal',
        profileHref: terminalHref,
        patch: {
            actionKind: 'mute-block',
            status: 'blocked',
            runId,
            tabId: terminalTabId,
            attemptId: terminalAttemptId,
            attemptNumber: 1,
            blockSucceeded: true,
            terminalAt: 3370,
            updatedAt: 3370
        }
    }, {tab: {id: terminalTabId}})

    assert.equal(result.terminal, true)
    await waitFor(
        () => listTabs(browser).some(tab => tab.url === nextHref),
        'terminal continuation did not open next queued tab',
        {timers, attempts: 40, tickMs: 1000}
    )
    await waitFor(
        async () => ['opening', 'active', 'acting', 'settling', 'succeeded'].includes((await sw.coordinatorAuthority.hydrate()).queue[nextHref]?.status),
        'terminal continuation did not persist next queued row progress',
        {timers, attempts: 40, tickMs: 1000}
    )

    const hydrated = await sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[terminalHref].status, 'succeeded')
    assert.ok(['opening', 'active', 'acting', 'settling', 'succeeded'].includes(hydrated.queue[nextHref]?.status))
    assert.equal((sw.state().queueWakeupCounters['pump.fastExecutor.requested'] || 0) > 0, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[nextHref].status !== 'queued', true)
})

test('terminal progress continuation ignores stale provisional runtime capacity', async () => {
    const terminalHref = 'https://www.quora.com/profile/Synthetic-Terminal-Stale-Provisional-Done'
    const nextHref = 'https://www.quora.com/profile/Synthetic-Terminal-Stale-Provisional-Next'
    const staleHref = 'https://www.quora.com/profile/Synthetic-Terminal-Stale-Provisional-Orphan'
    const runId = 'run-terminal-stale-provisional'
    const terminalAttemptId = 'attempt-terminal-stale-provisional-done'
    const nextAttemptId = 'attempt-terminal-stale-provisional-next'
    const terminalTabId = 819
    const staleTabId = 820
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3380,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [terminalHref]: {
                    ...makeActiveCoordinatorRow({
                        href: terminalHref,
                        runId,
                        attemptId: terminalAttemptId,
                        tabId: terminalTabId,
                        now: 3380
                    }),
                    executorMaxConcurrent: 1
                },
                [nextHref]: {
                    ...makeQueuedCoordinatorRow({
                        href: nextHref,
                        runId,
                        attemptId: nextAttemptId,
                        now: 3380
                    }),
                    executorMaxConcurrent: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: {
                    id: runId,
                    sourceType: 'profile-search',
                    status: 'active',
                    targetProfileHrefs: [terminalHref, nextHref],
                    targetWorkKeys: [terminalHref, nextHref]
                }
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(staleTabId, {
        id: staleTabId,
        url: staleHref,
        status: 'complete'
    })
    sw.__testAddProvisionalQueuedTab(staleTabId, {
        profileHref: staleHref,
        coordinatorKey: staleHref,
        requestedUrl: staleHref,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId: 'attempt-terminal-stale-provisional-orphan',
        attemptNumber: 1,
        openedAt: 3375
    })
    await activateQuoraRuntime(browser, terminalHref)
    assert.equal(sw.state().activeQueuedTabs.includes(staleTabId), true)

    const result = await browser.runtime.sendMessage({
        action: 'record-job-terminal',
        profileHref: terminalHref,
        patch: {
            actionKind: 'mute-block',
            status: 'blocked',
            runId,
            tabId: terminalTabId,
            attemptId: terminalAttemptId,
            attemptNumber: 1,
            blockSucceeded: true,
            terminalAt: 3380,
            updatedAt: 3380
        }
    }, {tab: {id: terminalTabId}})

    assert.equal(result.terminal, true)
    await waitFor(
        () => listTabs(browser).some(tab => tab.url === nextHref),
        'terminal continuation let stale provisional runtime capacity block the next queued tab',
        {timers, attempts: 40, tickMs: 1000}
    )
    await waitFor(
        async () => ['opening', 'active', 'acting', 'settling', 'succeeded'].includes((await sw.coordinatorAuthority.hydrate()).queue[nextHref]?.status),
        'terminal continuation with stale provisional runtime did not persist next queued row progress',
        {timers, attempts: 40, tickMs: 1000}
    )

    const hydrated = await sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[terminalHref].status, 'succeeded')
    assert.ok(['opening', 'active', 'acting', 'settling', 'succeeded'].includes(hydrated.queue[nextHref]?.status))
    assert.equal(getRecoveredCoordinatorQueue(storage)[nextHref].status !== 'queued', true)
})

test('executor planning ignores stale mismatched progress for queued retry row', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Queued-Retry-Stale-Progress'
    const runId = 'run-queued-retry-stale-progress'
    const freshAttemptId = 'attempt-queued-retry-stale-progress-fresh'
    const staleAttemptId = 'attempt-queued-retry-stale-progress-stale'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3390,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({
                        href,
                        runId,
                        attemptId: freshAttemptId,
                        now: 3390
                    }),
                    attemptNumber: 2,
                    retryAttempt: 1,
                    maxRetries: 1,
                    executorMaxConcurrent: 1
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
                    status: 'tab-opened',
                    runId,
                    tabId: 830,
                    attemptId: staleAttemptId,
                    attemptNumber: 1,
                    tabOpenedAt: 3300,
                    updatedAt: 3300
                }
            },
            ...makeProgressProjectionSeed(href, {
                actionKind: 'mute-block',
                status: 'tab-opened',
                runId,
                tabId: 830,
                attemptId: staleAttemptId,
                attemptNumber: 1,
                tabOpenedAt: 3300,
                updatedAt: 3300
            })
        }
    })
    await activateQuoraRuntime(browser, href)

    const result = await sw.runCoordinatorExecutorApplyPhase('synthetic-stale-progress-queued-retry', {
        ownerTabId: 'service-worker-queue-owner',
        serviceWorkerOwned: true,
        awaitFill: true,
        returnAfterDurableActive: true
    })

    assert.equal(result.changed, true)
    assert.equal(result.queued, 1)
    assert.equal(sw.state().queueWakeupCounters['reconcile.executor.ignored.mismatchedProgress'] || 0, 1)
    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'stale mismatched progress prevented queued retry row from opening',
        {timers, attempts: 40, tickMs: 1000}
    )
    await waitFor(
        async () => ['opening', 'active', 'acting', 'settling', 'succeeded'].includes((await sw.coordinatorAuthority.hydrate()).queue[href]?.status),
        'stale mismatched progress prevented queued retry row durable activation',
        {timers, attempts: 40, tickMs: 1000}
    )

    const recovered = getRecoveredCoordinatorQueue(storage)
    assert.equal(recovered[href].attemptId, freshAttemptId)
    assert.notEqual(recovered[href].status, 'queued')
})

test('scheduled explicit dashboard resume preserves before-Quora bypass through alarm', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Scheduled-Bypass-Resume'
    const runId = 'run-scheduled-bypass-resume'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3360,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({
                    href,
                    runId,
                    attemptId: 'attempt-scheduled-bypass-resume',
                    now: 3360
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const scheduled = await sw.kickCoordinatorQueueResume('synthetic-scheduled-bypass-resume', {
        allowBeforeQuora: true
    })
    assert.equal(scheduled.scheduledOnly, true)
    assert.equal(scheduled.reason, 'synthetic-scheduled-bypass-resume-scheduled')

    await browser.alarms.onAlarm.emit({name: 'mb-coordinator-resume'})
    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'scheduled before-Quora resume did not open a profile tab',
        {timers, attempts: 40, tickMs: 1000}
    )

    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status))
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
    assert.equal(sw.state().queueWakeupCounters['pump.deferredBeforeQuora'] || 0, 0)
})

test('fast executor throttle still opens one durable queued row when idle', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Throttled-Idle-Resume'
    const runId = 'run-throttled-idle-resume'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3600,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 3,
                    runId,
                    createdAt: 3000,
                    updatedAt: 3000,
                    attemptId: 'attempt-throttled-idle-resume',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser, href)
    sw.rememberQueueLoadPressure('claim-nudge-timeout', {tabId: 99, profileHref: href})
    assert.equal(sw.state().queueLoadThrottle.active, true)

    const result = await settleWithFakeTimers(
        sw.runCoordinatorQueueExecutorFastPath('synthetic-throttled-idle-resume', {
            awaitFill: true
        }),
        timers,
        [0, 500, 1000, 5000]
    )

    assert.equal(result.fastPath, true)
    assert.equal(result.changed, true)
    assert.equal(result.queued, 1)
    assert.notEqual(result.reason, 'queue-load-throttled')
    await waitFor(
        () => listTabs(browser).filter(tab => tab.url === href).length === 1,
        'throttled idle fast executor did not open exactly one profile tab',
        {timers, attempts: 40, tickMs: 1000}
    )
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status))
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
})

test('fast executor drops stale volatile queued action while throttled and idle', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Throttled-Stale-Volatile'
    const staleHref = 'https://www.quora.com/profile/Synthetic-Throttled-Stale-Volatile-Old'
    const runId = 'run-throttled-stale-volatile'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3635,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    status: 'queued',
                    targetProfileHref: href,
                    requestedUrl: href,
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 3,
                    runId,
                    createdAt: 3635,
                    updatedAt: 3635,
                    attemptId: 'attempt-throttled-stale-volatile',
                    attemptNumber: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser, href)
    sw.rememberQueueLoadPressure('claim-nudge-timeout', {tabId: 99, profileHref: href})
    sw.__testAddQueuedAction({
        url: staleHref,
        profileHref: staleHref,
        coordinatorKey: staleHref,
        ownerTabId: 'service-worker-queue-owner'
    })
    assert.equal(sw.state().queueLoadThrottle.active, true)
    assert.equal(sw.state().queuedTabActions.length, 1)

    const result = await settleWithFakeTimers(
        sw.runCoordinatorQueueExecutorFastPath('synthetic-throttled-stale-volatile', {
            awaitFill: true
        }),
        timers,
        [0, 500, 1000, 5000]
    )

    assert.equal(result.fastPath, true)
    assert.equal(result.changed, true)
    assert.equal(result.queued, 1)
    assert.notEqual(result.reason, 'queue-load-throttled')
    assert.equal(sw.state().queuedTabActions.length, 0)
    await waitFor(
        () => listTabs(browser).filter(tab => tab.url === href).length === 1,
        'throttled stale volatile fast executor did not resume durable row',
        {timers, attempts: 40, tickMs: 1000}
    )
    assert.equal(listTabs(browser).some(tab => tab.url === staleHref), false)
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status))
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
})

test('queue-only fast executor uses resident authority without legacy progress load', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Resident-Fast-Resume'
    const runId = 'run-resident-fast-resume'
    const attemptId = 'attempt-resident-fast-resume'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3630,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 3630})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    status: 'queued',
                    attemptId: 'stale-progress-attempt',
                    attemptNumber: 1
                }
            }
        }
    })
    await sw.coordinatorAuthority.hydrate()
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    const forbiddenReads = []
    browser.storage.local.get = async defaults => {
        if(defaults &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbProfileNukeProgress')) {
            forbiddenReads.push({keys: Object.keys(defaults).sort(), stack: new Error().stack})
            throw new Error('synthetic queue-only resume legacy progress read')
        }
        if(defaults &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueue') &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorRuns') &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueueWal.meta')) {
            forbiddenReads.push({keys: Object.keys(defaults).sort(), stack: new Error().stack})
            throw new Error('synthetic queue-only resume full authority read')
        }
        return originalGet(defaults)
    }

    const originalCreate = browser.tabs.create.bind(browser.tabs)
    browser.tabs.create = async () => new Promise(() => {})
    const result = await settleWithFakeTimers(
        sw.runCoordinatorQueueExecutorFastPath('synthetic-resident-fast-resume', {
            awaitFill: false
        }),
        timers,
        [0, 500, 1000, 5000]
    )
    browser.storage.local.get = originalGet
    browser.tabs.create = originalCreate

    assert.deepEqual(forbiddenReads, [])
    assert.equal(result.fastPath, true)
    assert.equal(result.changed, true)
    assert.equal(result.queued, 1)
    assert.equal(sw.state().queueWakeupCounters['reconcile.executor.queueOnly.usedResidentAuthority'] || 0, 1)
    assert.equal(listTabs(browser).some(tab => tab.url === href), false)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
})

test('awaited queue fill releases promise when tab creation hangs', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Hung-Tab-Create'
    const runId = 'run-hung-tab-create'
    const attemptId = 'attempt-hung-tab-create'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3642,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 3642})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    await sw.coordinatorAuthority.hydrate()
    const originalCreate = browser.tabs.create.bind(browser.tabs)
    browser.tabs.create = async () => new Promise(() => {})

    const result = await settleWithFakeTimers(
        sw.runCoordinatorQueueExecutorFastPath('synthetic-hung-tab-create', {
            awaitFill: true,
            skipAuthorityReconcile: true,
            forceDurableQueueReload: false
        }),
        timers,
        [0, 500, 1000, sw.state().constants.QUEUED_TAB_CREATE_TIMEOUT_MS, 1000]
    )
    browser.tabs.create = originalCreate

    assert.equal(result.fastPath, true)
    assert.equal(result.changed, true)
    assert.equal(result.queued, 1)
    assert.equal(sw.state().queuedTabActions.length, 1)
    assert.equal(sw.state().queueWakeupCounters['pump.noop.tabCreateTimedOut'] || 0, 1)
    assert.equal(listTabs(browser).some(tab => tab.url === href), false)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
})

test('scheduled queue wakeup reloads durable queue instead of stale resident authority', async () => {
    const staleHref = 'https://www.quora.com/profile/Synthetic-Stale-Resident-Only'
    const durableHref = 'https://www.quora.com/profile/Synthetic-Durable-Scheduled-Reload'
    const runId = 'run-scheduled-durable-reload'
    const attemptId = 'attempt-scheduled-durable-reload'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3635,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [staleHref]: makeQueuedCoordinatorRow({
                    href: staleHref,
                    runId,
                    attemptId: 'attempt-stale-resident-only',
                    now: 3635
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href: durableHref, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    await sw.coordinatorAuthority.hydrate()
    storage.mbCoordinatorQueue = {
        [durableHref]: makeQueuedCoordinatorRow({
            href: durableHref,
            runId,
            attemptId,
            now: 3640
        })
    }
    for(const key of Object.keys(storage)) {
        if(key.startsWith('mbCoordinatorQueueWal')) delete storage[key]
    }

    await sw.scheduleCoordinatorQueueResume(100, 'synthetic-scheduled-durable-reload', {
        allowBeforeQuora: true
    })
    await timers.tick(100)
    await flushAsync(500)
    assert.equal(listTabs(browser).some(tab => tab.url === durableHref), true)

    assert.equal(listTabs(browser).some(tab => tab.url === staleHref), false)
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[durableHref]?.status))
    assert.equal(sw.state().queueWakeupCounters['reconcile.executor.queueOnly.usedResidentAuthority'] || 0, 0)
})

test('fast executor freshens rolled-back active-transition rows before reopening', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Rolled-Back-Reopen'
    const runId = 'run-rolled-back-reopen'
    const attemptId = 'attempt-rolled-back-reopen'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3640,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3640}),
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    actionLeaseReleaseReason: 'active-transition-failed',
                    actionLeaseReleasedAt: 3639,
                    retryAttempt: 0,
                    maxRetries: 2,
                    maxAttempts: 3
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    await sw.coordinatorAuthority.hydrate()

    const result = await settleWithFakeTimers(
        sw.runCoordinatorQueueExecutorFastPath('synthetic-rolled-back-reopen', {
            awaitFill: true
        }),
        timers,
        [0, 500, 1000, 5000]
    )

    assert.equal(result.fastPath, true)
    assert.equal(result.changed, true)
    await waitFor(
        () => listTabs(browser).some(tab => tab.url === href),
        'rolled-back queued row did not reopen after attempt advance',
        {timers, attempts: 40, tickMs: 1000}
    )
    const recovered = getRecoveredCoordinatorQueue(storage)[href]
    assert.equal(recovered.status, 'active')
    assert.notEqual(recovered.attemptId, attemptId)
    assert.equal(recovered.attemptNumber, 2)
    assert.equal(recovered.retryAttempt, 1)
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.ok(walRecords.some(record => record.operationKind === 'stale-retry'))
    assert.ok(walRecords.some(record =>
        record.operationKind === 'active-transition' &&
        record.attemptId === recovered.attemptId &&
        record.attemptNumber === 2
    ))
})

test('fast executor reclaims queued retry row after active missing-tab rollback when profile tab remains', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Rolled-Back-Missing-Active-Reclaim'
    const runId = 'run-rolled-back-missing-active-reclaim'
    const attemptId = 'attempt-rolled-back-missing-active-reclaim'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3650,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3650}),
                    actionKind: 'mute-block',
                    executorTabAction: 'nuke',
                    executorOwner: 'service-worker',
                    serviceWorkerOwned: true,
                    executorNoForegroundFallback: true,
                    actionLeaseReleaseReason: 'dashboard-resume-fast-executor-queue-only-active-missing-tab',
                    actionLeaseReleasedAt: 3649,
                    retryAttempt: 1,
                    maxRetries: 1,
                    maxAttempts: 2,
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
                    actionKind: 'mute-block',
                    status: 'queued',
                    tabId: null,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1,
                    updatedAt: 3649
                }
            }
        }
    })
    const liveTab = await browser.tabs.create({url: href, active: true})
    await sw.coordinatorAuthority.hydrate()

    const result = await settleWithFakeTimers(
        sw.runCoordinatorQueueExecutorFastPath('synthetic-rolled-back-missing-active-reclaim', {
            awaitFill: true
        }),
        timers,
        [0, 500, 1000, 5000]
    )

    assert.equal(result.fastPath, true)
    assert.equal(sw.state().activeQueuedTabs.includes(liveTab.id), true)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, liveTab.id)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].tabId, liveTab.id)
    assert.equal(listTabs(browser).filter(tab => tab.url === href).length, 1)
})

test('active transition waits behind slow storage tail instead of failing before start', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Slow-Tail'
    const runId = 'run-active-transition-slow-tail'
    const attemptId = 'attempt-active-transition-slow-tail'
    const {sw, storage, timers} = loadServiceWorkerHarness({
        now: 3640,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 3640})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    sw.__testAddProvisionalQueuedTab(717, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        ownerTabId: 'service-worker-queue-owner',
        attemptId,
        attemptNumber: 1
    })
    const gate = deferred()
    const blocker = sw.enqueueSpaceFeedStorageUpdate(async () => {
        await gate.promise
        return {blocked: true}
    }, {
        reason: 'synthetic-slow-tail',
        timeoutMs: 60000
    })
    await flushAsync(20)

    let settled = false
    let settledValue
    const transition = sw.transitionCoordinatorItemForQueuedTab({
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1
    }, {
        id: 717
    }, {
        openedAt: 3640,
        attemptId,
        attemptNumber: 1,
        maxRetries: 1
    }).then(value => {
        settled = true
        settledValue = value
        return value
    })

    await flushAsync(20)
    await timers.tick(16000)
    await flushAsync(20)

    assert.equal(settled, false)
    assert.equal(sw.state().queueWakeupCounters['storageUpdate.timeout.beforeStart'], undefined)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')

    gate.resolve()
    assert.deepEqual(await blocker, {blocked: true})
    assert.equal(await settleWithFakeTimers(transition, timers, [0, 1000, 5000]), true)
    assert.equal(settledValue, true)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
})

test('active transition rollback waits behind slow storage tail instead of failing before start', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Rollback-Slow-Tail'
    const runId = 'run-rollback-slow-tail'
    const attemptId = 'attempt-rollback-slow-tail'
    const {sw, storage, timers} = loadServiceWorkerHarness({
        now: 3650,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: 718, now: 3650})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const gate = deferred()
    const blocker = sw.enqueueSpaceFeedStorageUpdate(async () => {
        await gate.promise
        return {blocked: true}
    }, {
        reason: 'synthetic-rollback-slow-tail',
        timeoutMs: 60000
    })
    await flushAsync(20)

    let settled = false
    let settledValue
    const rollback = sw.rollbackFailedQueuedTabOpen({
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1
    }, {
        id: 718
    }, {
        openedAt: 3650,
        attemptId,
        attemptNumber: 1,
        activeTransitionError: 'synthetic transition timeout'
    }).then(value => {
        settled = true
        settledValue = value
        return value
    })

    await flushAsync(20)
    await timers.tick(16000)
    await flushAsync(20)

    assert.equal(settled, false)
    assert.equal(sw.state().queueWakeupCounters['storageUpdate.timeout.beforeStart'], undefined)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')

    gate.resolve()
    assert.deepEqual(await blocker, {blocked: true})
    assert.equal(await settleWithFakeTimers(rollback, timers, [0, 1000, 5000]), true)
    assert.equal(settledValue, true)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, null)
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
    const repairPromise = sw.runScheduledCoordinatorReconcileTick('scheduled-coordinator-reconcile')
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

test('durable resume preserves volatile queued action while fill is in flight', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-In-Flight-Fill-Preserve'
    const fill = deferred()
    const {sw} = loadServiceWorkerHarness({
        now: 3650,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {},
            mbCoordinatorRuns: {},
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    sw.__testAddQueuedAction({
        url: href,
        profileHref: href,
        coordinatorKey: href,
        ownerTabId: 'service-worker-queue-owner'
    })
    sw.__testSetQueuedTabFillPromise(fill.promise, 3650)

    const applyPromise = sw.runCoordinatorExecutorApplyPhase('synthetic-in-flight-fill-preserve', {
        serviceWorkerOwned: true,
        queueOnlyAuthority: true,
        forceDurableQueueReload: true
    })
    applyPromise.catch(() => null)
    await flushAsync(20)

    assert.equal(sw.state().queuedTabActions.length, 1)
    assert.equal(sw.state().queueWakeupCounters['pump.changed.droppedVolatileQueuedActions'] || 0, 0)
    assert.equal(sw.state().queueWakeupCounters['pump.noop.preservedVolatileQueuedActionsDuringFill'] || 0, 1)

    fill.resolve({
        openedTabs: 0,
        active: 0,
        schedulerBlockingActive: 0,
        remainingActions: 1,
        reason: 'synthetic-fill-in-flight'
    })
    const result = await applyPromise

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'no-pending-items')
    assert.equal(sw.state().queuedTabActions.length, 1)
    assert.equal(sw.state().queueWakeupCounters['pump.noop.preservedVolatileQueuedActionsDuringFill'] || 0, 2)
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

test('service-worker executor resume plans only the current slot batch', async () => {
    const runId = 'run-plan-slot-batch'
    const queue = {}
    const targetProfileHrefs = []
    for(let index = 0; index < 20; index += 1) {
        const href = `https://www.quora.com/profile/Synthetic-Plan-Slot-Batch-${index}`
        targetProfileHrefs.push(href)
        queue[href] = {
            ...makeQueuedCoordinatorRow({
                href,
                runId,
                attemptId: `attempt-plan-slot-batch-${index}`,
                now: 3700
            }),
            executorMaxConcurrent: 3
        }
    }

    const {browser, sw, timers} = loadServiceWorkerHarness({
        now: 3700,
        storage: {
            mbCoordinatorQueue: queue,
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({
                    href: targetProfileHrefs[0],
                    runId,
                    targetProfileHrefs
                })
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    const result = await sw.resumeCoordinatorQueueExecutionOnce({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-plan-slot-batch'
    })
    await timers.tick(0)

    const openedProfileTabs = listTabs(browser)
        .filter(tab => `${tab.url || ''}`.includes('/profile/Synthetic-Plan-Slot-Batch-'))
    assert.equal(result.pending, 20)
    assert.equal(result.queued, 3)
    assert.equal(openedProfileTabs.length, 3)
    assert.equal(sw.state().queuedTabActions.length, 0)
    assert.equal(sw.state().activeQueuedTabs.length, 3)
})

test('service-worker executor resume adopts expected live queued profile tab before opening duplicates', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Adopt-Live-Queued'
    const runId = 'run-adopt-live-queued'
    const attemptId = 'attempt-adopt-live-queued'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3800,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3800}),
                    executorMaxConcurrent: 3
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const existingTab = await browser.tabs.create({url: href, active: true})
    storage.mbProfileNukeProgress[href] = {
        profileHref: href,
        actionKind: 'mute-block',
        status: 'tab-opening',
        tabId: existingTab.id,
        tabOpenedAt: 3790,
        attemptId,
        attemptNumber: 1
    }
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    let queueRunsOnlyReads = 0

    browser.storage.local.get = async defaults => {
        if(defaults &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueue') &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorRuns') &&
            !Object.prototype.hasOwnProperty.call(defaults, 'mbProfileNukeProgress') &&
            !Object.prototype.hasOwnProperty.call(defaults, 'mbProfileNukeProgressView')) {
            queueRunsOnlyReads += 1
            throw new Error('synthetic redundant active transition authority load')
        }
        return originalGet(defaults)
    }

    const result = await settleWithFakeTimers(sw.resumeCoordinatorQueueExecutionOnce({
            tabId: 'service-worker-queue-owner',
            windowId: null
        }, {
            serviceWorkerOwned: true,
            skipRepair: true,
            skipAuthorityReconcile: true,
            awaitFill: true,
            reason: 'synthetic-adopt-live-queued'
        }),
        timers,
        [0, 250, 750, 1500, 5000]
    )
    browser.storage.local.get = originalGet

    const profileTabs = listTabs(browser).filter(tab => tab.url === href)
    assert.equal(queueRunsOnlyReads, 0)
    assert.equal(result.adopted, 1)
    assert.equal(result.queued, 0)
    assert.equal(profileTabs.length, 1)
    assert.equal(profileTabs[0].id, existingTab.id)
    assert.equal(sw.state().activeQueuedTabs.includes(existingTab.id), true)
    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(recoveredQueue[href].status, 'active')
    assert.equal(recoveredQueue[href].tabId, existingTab.id)
    assert.equal((await sw.coordinatorAuthority.hydrate()).queue[href].status, 'active')
})

test('service-worker executor does not adopt unrelated same-profile tab for queued work', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Unowned-Same-Profile'
    const runId = 'run-unowned-same-profile'
    const attemptId = 'attempt-unowned-same-profile'
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3850,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3850}),
                    executorMaxConcurrent: 3
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const unrelatedTab = await browser.tabs.create({url: href, active: true})

    const result = await sw.resumeCoordinatorQueueExecutionOnce({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-unowned-same-profile'
    })

    const profileTabs = listTabs(browser).filter(tab => tab.url === href)
    const newExecutorTab = profileTabs.find(tab => tab.id !== unrelatedTab.id)
    assert.equal(result.adopted, 0)
    assert.equal(result.queued, 1)
    assert.equal(profileTabs.length, 2)
    assert.ok(newExecutorTab)
    assert.equal(sw.state().activeQueuedTabs.includes(unrelatedTab.id), false)
    assert.equal(sw.state().activeQueuedTabs.includes(newExecutorTab.id), true)
    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(recoveredQueue[href].status, 'active')
    assert.equal(recoveredQueue[href].tabId, newExecutorTab.id)
})

test('service-worker executor adopts orphaned worker-window queued profile tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Orphaned-Worker-Window'
    const runId = 'run-orphaned-worker-window'
    const attemptId = 'attempt-orphaned-worker-window'
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3855,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3855}),
                    executorMaxConcurrent: 3,
                    executorNoForegroundFallback: true,
                    serviceWorkerOwned: true,
                    executorOwner: 'service-worker'
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
                    status: 'queued',
                    attemptId,
                    attemptNumber: 1,
                    runId,
                    updatedAt: 3855
                }
            }
        }
    })
    const surface = await browser.windows.create({
        url: '',
        focused: false,
        type: 'normal'
    })
    const surfaceProfileTab = await browser.tabs.create({
        url: href,
        windowId: surface.id,
        active: true
    })

    const result = await sw.resumeCoordinatorQueueExecutionOnce({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-orphaned-worker-window'
    })

    const profileTabs = listTabs(browser).filter(tab => tab.url === href)
    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(result.adopted, 1)
    assert.equal(result.queued, 0)
    assert.equal(profileTabs.length, 1)
    assert.equal(profileTabs[0].id, surfaceProfileTab.id)
    assert.equal(recoveredQueue[href].status, 'active')
    assert.equal(recoveredQueue[href].tabId, surfaceProfileTab.id)
    assert.equal(sw.state().activeQueuedTabs.includes(surfaceProfileTab.id), true)
})

test('service-worker executor adopts orphaned pending-confirmation worker-window tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Orphaned-Pending-Confirmation'
    const runId = 'run-orphaned-pending-confirmation'
    const attemptId = 'attempt-orphaned-pending-confirmation'
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3858,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3858}),
                    executorMaxConcurrent: 3,
                    executorNoForegroundFallback: true,
                    serviceWorkerOwned: true,
                    executorOwner: 'service-worker'
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const confirmationTab = await browser.tabs.create({
        url: href,
        active: true
    })
    browser.tabs.sendMessage = async (tabId, message) => {
        if(Number.parseInt(tabId, 10) === confirmationTab.id &&
            message?.action === 'get-profile-action-surface-state') {
            return {
                pageType: 'profile',
                resolvedProfileHref: href,
                requestedProfileHref: href,
                profileMatches: true,
                pendingProfileConfirmation: true,
                confirmationKind: 'block'
            }
        }
        if(Number.parseInt(tabId, 10) === confirmationTab.id &&
            message?.action === 'claim-current-profile-tab-action') {
            return {accepted: true}
        }
        return {}
    }

    const result = await sw.resumeCoordinatorQueueExecutionOnce({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-orphaned-pending-confirmation'
    })

    const profileTabs = listTabs(browser).filter(tab => tab.url === href)
    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(result.adopted, 1)
    assert.equal(result.queued, 0)
    assert.equal(profileTabs.length, 1)
    assert.equal(profileTabs[0].id, confirmationTab.id)
    assert.equal(recoveredQueue[href].status, 'active')
    assert.equal(recoveredQueue[href].tabId, confirmationTab.id)
    assert.equal(sw.state().activeQueuedTabs.includes(confirmationTab.id), true)
})

test('service-worker executor reclaims rolled-back queued profile tab before opening duplicate', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Reclaim-Rolled-Back-Queued'
    const runId = 'run-reclaim-rolled-back-queued'
    const attemptId = 'attempt-reclaim-rolled-back-queued'
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3860,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3860}),
                    executorMaxConcurrent: 3,
                    actionLeaseReleaseReason: 'active-transition-failed',
                    actionLeaseReleasedAt: 3855,
                    milestones: {
                        tabCreatedAt: 3850,
                        navigationStartedAt: 3850,
                        closeRequestedAt: 3855,
                        tabClosedAt: 3855
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
                    actionKind: 'mute-block',
                    status: '',
                    closeReason: 'active-transition-failed',
                    tabId: 980,
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 3855
                }
            }
        }
    })
    const firstTab = await browser.tabs.create({url: href, active: false})
    const activeTab = await browser.tabs.create({url: href, active: true})

    const result = await sw.resumeCoordinatorQueueExecutionOnce({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-reclaim-rolled-back-queued'
    })

    const profileTabs = listTabs(browser).filter(tab => tab.url === href)
    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(result.queued, 1)
    assert.equal(profileTabs.length, 2)
    assert.equal(recoveredQueue[href].status, 'active')
    assert.equal(recoveredQueue[href].tabId, activeTab.id)
    assert.equal(sw.state().activeQueuedTabs.includes(activeTab.id), true)
    assert.equal(sw.state().activeQueuedTabs.includes(firstTab.id), false)
    assert.equal(recoveredQueue[href].attemptNumber, 2)
})

test('service-worker executor reclaims rolled-back queued profile tab when retry budget is exhausted', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Reclaim-Retry-Budget-Exhausted'
    const runId = 'run-reclaim-retry-budget-exhausted'
    const attemptId = 'attempt-reclaim-retry-budget-exhausted'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3865,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3865}),
                    executorMaxConcurrent: 3,
                    actionLeaseReleaseReason: 'active-transition-failed',
                    actionLeaseReleasedAt: 3860,
                    retryAttempt: 1,
                    maxRetries: 1,
                    milestones: {
                        tabCreatedAt: 3855,
                        navigationStartedAt: 3855,
                        closeRequestedAt: 3860,
                        tabClosedAt: 3860
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
                    actionKind: 'mute-block',
                    status: 'tab-opened',
                    tabId: 981,
                    tabOpenedAt: 3857,
                    contentOpenedAt: 3858,
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 3860
                }
            }
        }
    })
    const liveTab = await browser.tabs.create({url: href, active: true})
    const originalGet = browser.tabs.get.bind(browser.tabs)
    let hungGetCalls = 0
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === liveTab.id && hungGetCalls === 0) {
            hungGetCalls += 1
            return new Promise((resolve, reject) => {
                timers.setTimeout(() => reject(new Error('synthetic live reclaim tab get timeout')), 2500)
            })
        }
        return originalGet(candidateTabId)
    }

    const result = await settleWithFakeTimers(
        sw.resumeCoordinatorQueueExecutionOnce({
            tabId: 'service-worker-queue-owner',
            windowId: null
        }, {
            serviceWorkerOwned: true,
            skipRepair: true,
            skipAuthorityReconcile: true,
            awaitFill: true,
            reason: 'synthetic-reclaim-retry-budget-exhausted'
        }),
        timers,
        [0, 1000, 1500, 2500, 2500, 5000, 10000, 2500, 2500, 5000, 10000]
    )
    browser.tabs.get = originalGet

    const profileTabs = listTabs(browser).filter(tab => tab.url === href)
    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(result.queued, 1)
    assert.ok(hungGetCalls > 0)
    assert.equal(sw.state().queueWakeupCounters['job.tabGetTimedOut'] > 0, true)
    assert.equal(profileTabs.length, 1)
    assert.equal(profileTabs[0].id, liveTab.id)
    assert.equal(recoveredQueue[href].status, 'active')
    assert.equal(recoveredQueue[href].tabId, liveTab.id)
    assert.equal(recoveredQueue[href].attemptNumber, 1)
    assert.equal(sw.state().activeQueuedTabs.includes(liveTab.id), true)
})

test('service-worker executor terminalizes exhausted rolled-back queue rows and continues to usable work', async () => {
    const runId = 'run-terminalize-exhausted-rollback-continue'
    const staleHref = 'https://www.quora.com/profile/Synthetic-Exhausted-Rollback-Stale'
    const secondStaleHref = 'https://www.quora.com/profile/Synthetic-Exhausted-Rollback-Stale-2'
    const freshHref = 'https://www.quora.com/profile/Synthetic-Exhausted-Rollback-Fresh'
    const staleAttemptId = 'attempt-exhausted-rollback-stale'
    const secondStaleAttemptId = 'attempt-exhausted-rollback-stale-2'
    const freshAttemptId = 'attempt-exhausted-rollback-fresh'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3870,
        storage: {
            mbCoordinatorQueue: {
                [staleHref]: {
                    ...makeQueuedCoordinatorRow({
                        href: staleHref,
                        runId,
                        attemptId: staleAttemptId,
                        now: 3870
                    }),
                    executorMaxConcurrent: 3,
                    actionLeaseReleaseReason: 'active-transition-failed',
                    actionLeaseReleasedAt: 3865,
                    retryAttempt: 1,
                    retryCount: 1,
                    maxRetries: 1,
                    milestones: {
                        tabCreatedAt: 3860,
                        navigationStartedAt: 3860,
                        closeRequestedAt: 3865,
                        tabClosedAt: 3865
                    }
                },
                [secondStaleHref]: {
                    ...makeQueuedCoordinatorRow({
                        href: secondStaleHref,
                        runId,
                        attemptId: secondStaleAttemptId,
                        now: 3870
                    }),
                    executorMaxConcurrent: 3,
                    actionLeaseReleaseReason: 'active-transition-failed',
                    actionLeaseReleasedAt: 3865,
                    retryAttempt: 1,
                    retryCount: 1,
                    maxRetries: 1,
                    milestones: {
                        tabCreatedAt: 3860,
                        navigationStartedAt: 3860,
                        closeRequestedAt: 3865,
                        tabClosedAt: 3865
                    }
                },
                [freshHref]: {
                    ...makeQueuedCoordinatorRow({
                        href: freshHref,
                        runId,
                        attemptId: freshAttemptId,
                        now: 3870
                    }),
                    executorMaxConcurrent: 3
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({
                    href: staleHref,
                    runId,
                    targetProfileHrefs: [staleHref, secondStaleHref, freshHref]
                })
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [staleHref]: {
                    profileHref: staleHref,
                    actionKind: 'mute-block',
                    status: 'queued',
                    closeReason: 'active-transition-failed',
                    attemptId: staleAttemptId,
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1,
                    updatedAt: 3865
                },
                [secondStaleHref]: {
                    profileHref: secondStaleHref,
                    actionKind: 'mute-block',
                    status: 'queued',
                    closeReason: 'active-transition-failed',
                    attemptId: secondStaleAttemptId,
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1,
                    updatedAt: 3865
                },
                [freshHref]: {
                    profileHref: freshHref,
                    actionKind: 'mute-block',
                    status: 'queued',
                    attemptId: freshAttemptId,
                    attemptNumber: 1,
                    updatedAt: 3870
                }
            }
        }
    })

    const result = await settleWithFakeTimers(sw.resumeCoordinatorQueueExecutionOnce({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-terminalize-exhausted-rollback-continue'
    }), timers)

    const openedFreshTab = listTabs(browser).find(tab => tab.url === freshHref)
    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(result.pending, 3)
    assert.equal(result.terminalizedExhausted, 2)
    assert.equal(result.queued, 1)
    assert.ok(openedFreshTab)
    assert.equal(recoveredQueue[staleHref].status, 'failed')
    assert.equal(recoveredQueue[staleHref].outcome, 'timeout')
    assert.equal(recoveredQueue[secondStaleHref].status, 'failed')
    assert.equal(recoveredQueue[secondStaleHref].outcome, 'timeout')
    assert.equal(recoveredQueue[freshHref].status, 'active')
    assert.equal(recoveredQueue[freshHref].tabId, openedFreshTab.id)
    assert.equal(sw.state().activeQueuedTabs.includes(openedFreshTab.id), true)
})

test('service-worker executor open resets stale terminal progress for the current tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Open-Resets-Stale-Terminal'
    const runId = 'run-open-resets-stale-terminal'
    const attemptId = 'attempt-open-resets-stale-terminal'
    const staleTabId = 889
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3880,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3880}),
                    executorMaxConcurrent: 1,
                    executorNoForegroundFallback: true,
                    maxAttempts: 2
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
                    status: 'interrupted',
                    finalError: 'Queued tab timed out after disappearing before completion',
                    closeReason: 'stale-active-tab',
                    terminalAt: 3870,
                    tabId: staleTabId,
                    tabOpenedAt: 3860,
                    contentOpenedAt: 3865,
                    attemptId,
                    attemptNumber: 1,
                    runId,
                    updatedAt: 3870
                }
            }
        }
    })

    const result = await settleWithFakeTimers(sw.resumeCoordinatorQueueExecutionOnce({
        tabId: 'service-worker-queue-owner',
        windowId: null
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true,
        reason: 'synthetic-open-resets-stale-terminal'
    }), timers)

    const openedTab = listTabs(browser).find(tab => tab.url === href && tab.id !== staleTabId)
    const progressRecord = getProgressShardRecord(storage, href) || storage.mbProfileNukeProgress[href]
    const recoveredQueue = getRecoveredCoordinatorQueue(storage)

    assert.equal(result.queued, 1)
    assert.ok(openedTab)
    assert.equal(progressRecord.status, 'tab-opening')
    assert.equal(progressRecord.tabId, openedTab.id)
    assert.equal(progressRecord.finalError, '')
    assert.equal(progressRecord.closeReason, '')
    assert.equal(recoveredQueue[href].status, 'active')
    assert.equal(recoveredQueue[href].tabId, openedTab.id)
})

test('service-worker executor releases live queued tab when active transition never becomes durable', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Adopt-Live-Transition-Timeout'
    const runId = 'run-adopt-live-transition-timeout'
    const attemptId = 'attempt-adopt-live-transition-timeout'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3900,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3900}),
                    executorMaxConcurrent: 3
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const existingTab = await browser.tabs.create({url: href, active: true})
    const originalSet = browser.storage.local.set.bind(browser.storage.local)

    let delayedWalSaves = 0
    browser.storage.local.set = async payload => {
        if(isCoordinatorQueueWalPayload(payload) && delayedWalSaves === 0) {
            delayedWalSaves += 1
            throw new Error('synthetic active transition WAL failure')
        }
        return originalSet(payload)
    }

    const authorityState = await sw.coordinatorAuthority.hydrate()
    const action = {
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        ownerTabId: 'service-worker-queue-owner',
        attemptId,
        attemptNumber: 1,
        noForegroundFallback: false,
        executorPlanAuthorityState: authorityState
    }
    const plan = sw.buildQueuedTabOpenEffectPlan(action, existingTab, 3900)

    sw.applyQueuedTabOpenRuntimeEffect(plan)
    const result = await settleWithFakeTimers(
        sw.confirmQueuedTabOpenDurableActiveEffect(action, existingTab, plan),
        timers,
        [0]
    )

    const profileTabs = listTabs(browser).filter(tab => tab.url === href)
    assert.equal(result.keepOpen, false)
    assert.equal(result.rolledBack, false)
    assert.equal(result.releasedQueuedAuthority, true)
    assert.equal(delayedWalSaves, 1)
    assert.equal(profileTabs.length, 0)
    assert.equal(browser.__removedTabs.includes(existingTab.id), true)
    assert.equal(sw.state().activeQueuedTabs.includes(existingTab.id), false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
})

test('no-foreground worker window keeps profile tab after active transition WAL failure', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Worker-Window-Transition-Deferred'
    const runId = 'run-worker-window-transition-deferred'
    const attemptId = 'attempt-worker-window-transition-deferred'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3950,
        storage: {
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3950}),
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const surface = await browser.windows.create({
        url: browser.runtime.getURL('coordinator.html#worker-window'),
        focused: false,
        type: 'normal'
    })
    const profileTab = await browser.tabs.create({
        url: href,
        active: true,
        windowId: surface.id
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    let failedWalSaves = 0

    browser.storage.local.set = async payload => {
        if(isCoordinatorQueueWalPayload(payload) && failedWalSaves === 0) {
            failedWalSaves += 1
            throw new Error('synthetic worker-window active transition WAL failure')
        }
        return originalSet(payload)
    }

    const authorityState = await sw.coordinatorAuthority.hydrate()
    const action = {
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        ownerTabId: 'service-worker-queue-owner',
        ownerWindowId: surface.id,
        actionSurfaceMode: 'worker-window',
        actionSurfaceWindowId: surface.id,
        actionSurfaceAnchorTabId: surface.tabs[0].id,
        attemptId,
        attemptNumber: 1,
        noForegroundFallback: true,
        executorPlanAuthorityState: authorityState
    }
    const plan = sw.buildQueuedTabOpenEffectPlan(action, profileTab, 3950)

    sw.applyQueuedTabOpenRuntimeEffect(plan)
    const result = await settleWithFakeTimers(
        sw.confirmQueuedTabOpenDurableActiveEffect(action, profileTab, plan),
        timers,
        [0]
    )
    await timers.tick(6000)
    await flushAsync(20)

    const metadata = Object.fromEntries(sw.state().queuedTabMetadata)[profileTab.id] || {}
    assert.equal(result.keepOpen, true)
    assert.equal(result.activeTransitionContinued, true)
    assert.equal(failedWalSaves, 1)
    assert.equal(metadata.activeTransitionDeferredReason, 'worker-window-opening')
    assert.equal(browser.__tabs.has(profileTab.id), true)
    assert.equal(browser.__removedTabs.includes(profileTab.id), false)
    assert.equal(browser.__windows.has(surface.id), true)
    assert.ok(sw.state().activeQueuedTabs.includes(profileTab.id))
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(sw.state().queueWakeupCounters['actionSurface.workerWindow.cleanupBusy.profileTab'] || 0, 0)
})

test('worker window cleanup does not close a live profile tab after runtime release', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Worker-Window-Runtime-Released'
    const runId = 'run-worker-window-runtime-released'
    const attemptId = 'attempt-worker-window-runtime-released'
    const {browser, sw, timers} = loadServiceWorkerHarness({
        now: 3960,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeQueuedCoordinatorRow({href, runId, attemptId, now: 3960}),
                    executorNoForegroundFallback: true,
                    executorMaxConcurrent: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    await browser.tabs.create({url: 'https://www.quora.com/search?q=synthetic', active: true})

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
    await settleWithFakeTimers(
        browser.runtime.sendMessage({
            action: 'release-job-tab',
            attemptId,
            attemptNumber: 1
        }, {
            tab: {id: profileTab.id, url: href, windowId: workerWindowId}
        }),
        timers
    )
    await timers.tick(2000)
    await flushAsync(20)

    assert.equal(browser.__tabs.has(profileTab.id), true)
    assert.equal(browser.__removedTabs.includes(profileTab.id), false)
    assert.equal(browser.__windows.has(workerWindowId), true)
})

test('executable enqueue timeout does not start raw request executor work', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Timeout-No-Raw-Executor'
    const runId = 'run-timeout-no-raw-executor'
    const sourceSender = {tab: {id: 121, windowId: 1}}
    const {browser, timers} = loadServiceWorkerHarness({now: 3500})
    const originalSet = browser.storage.local.set
    const blockedWal = deferred()

    browser.storage.local.set = async payload => {
        if(isCoordinatorQueueWalPayload(payload)) {
            await blockedWal.promise
            return originalSet(payload)
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
    blockedWal.resolve()
    await timers.tick(0)
    await flushAsync(20)
})

test('queued tab active transition timeout closes unconfirmed runtime tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Unconfirmed-Active'
    const runId = 'run-unconfirmed-active'
    const sourceSender = {tab: {id: 122, windowId: 1}}
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({now: 3600})
    const originalCreate = browser.tabs.create
    const originalSet = browser.storage.local.set
    let createdTabId = 0
    const delayedWal = deferred()

    browser.tabs.create = async options => {
        const tab = await originalCreate(options)
        if(tab.url === href) createdTabId = tab.id
        return tab
    }
    browser.storage.local.set = async payload => {
        if(createdTabId && isCoordinatorQueueWalPayload(payload)) {
            await delayedWal.promise
            return originalSet(payload)
        }
        return originalSet(payload)
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
    delayedWal.resolve()
    await timers.tick(0)
    await flushAsync(20)
})

test('active transition is WAL-backed and recovers after restart', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Wal'
    const runId = 'run-active-transition-wal'
    const attemptId = 'attempt-active-transition-wal'
    const tabId = 630
    const {storage, sw, timers} = loadServiceWorkerHarness({
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
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        ownerTabId: 'service-worker-queue-owner',
        attemptId,
        attemptNumber: 1
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
    await timers.tick(0)
    await flushAsync(50)
    assert.equal(storage.mbCoordinatorQueueView.counts.active, 1)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, tabId)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'active-transition')
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
    assert.equal(sw.state().queueWakeupCounters['reconcile.edgeTriggered'] || 0, 0)

    const restarted = loadServiceWorkerHarness({
        now: 431500,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'active')
    assert.equal(hydrated.queue[href].tabId, tabId)
})

test('active transition projection failure does not poison durable acknowledgement', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Projection-Failure'
    const runId = 'run-active-transition-projection-failure'
    const attemptId = 'attempt-active-transition-projection-failure'
    const tabId = 6301
    const {browser, storage, sw, timers} = loadServiceWorkerHarness({
        now: 431750,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 431750})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
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
        attemptNumber: 1
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    let projectionWrites = 0
    browser.storage.local.set = async payload => {
        if(payload?.mbCoordinatorQueueView) {
            projectionWrites += 1
            return false
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
        id: tabId
    }, {
        openedAt: 431800,
        attemptId,
        attemptNumber: 1,
        retryAttempt: 0,
        maxRetries: 2
    })

    assert.equal(result, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, tabId)
    assert.ok(getStoredCoordinatorQueueWal(storage))
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionDeferred'] || 0, 0)

    await timers.tick(0)
    await flushAsync(50)

    assert.equal(projectionWrites, 1)
    assert.equal(storage.mbCoordinatorQueueView, undefined)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.projectionFailed'] || 0, 1)
    assert.ok(
        sw.state().hasCoordinatorReconcileTimeout ||
            (sw.state().queueWakeupCounters['reconcile.deferredBeforeQuora'] || 0) >= 1
    )
})

test('stale active transition append cannot repaint compact queue view over WAL authority', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Stale-Projection'
    const runId = 'run-active-transition-stale-projection'
    const staleAttemptId = 'attempt-active-transition-stale-projection-old'
    const staleActiveRow = {
        ...makeActiveCoordinatorRow({
            href,
            runId,
            attemptId: staleAttemptId,
            tabId: 6302,
            now: 431820
        }),
        retryAttempt: 0,
        maxRetries: 2
    }
    const {storage, sw, timers} = loadServiceWorkerHarness({
        now: 431850,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: staleActiveRow
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    actionKind: 'mute-block',
                    status: 'queued',
                    tabId: null,
                    attemptId: staleAttemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 2,
                    updatedAt: 431830
                }
            },
        }
    })
    const repaired = await sw.runCoordinatorAuthorityReconcileActions('synthetic-stale-projection')
    assert.equal(repaired.changed, true)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    const freshAttemptId = sw.coordinatorAuthority.current().queue[href].attemptId
    assert.notEqual(freshAttemptId, staleAttemptId)
    assert.equal(sw.coordinatorAuthority.current().queue[href].attemptNumber, 2)

    const staleAuthorityState = {
        stored: {
            ...storage,
            mbCoordinatorQueue: {
                [href]: staleActiveRow
            }
        },
        queue: {
            [href]: staleActiveRow
        },
        runs: storage.mbCoordinatorRuns
    }

    const result = await sw.transitionCoordinatorItemForQueuedTab({
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        attemptId: staleAttemptId,
        attemptNumber: 1,
        currentAuthorityState: staleAuthorityState
    }, {
        id: 6304
    }, {
        openedAt: 431900,
        attemptId: staleAttemptId,
        attemptNumber: 1,
        retryAttempt: 0,
        maxRetries: 2,
        currentAuthorityState: staleAuthorityState
    })

    assert.equal(result, false)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].attemptId, freshAttemptId)
    await timers.tick(0)
    await flushAsync(50)
    assert.equal(storage.mbCoordinatorQueueView.counts.active || 0, 0)
    assert.equal(storage.mbCoordinatorQueueView.items.some(item =>
        (item.storageKey || item.targetProfileHref || item.requestedUrl) === href &&
            item.status === 'active'
    ), false)
    assert.equal(sw.state().queueWakeupCounters['coordinatorAuthority.queueWal.appendIgnoredAfterReplay'] || 0, 0)
})

test('post-active missing tab rollback reuses resident authority state', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Missing-Tab-Resident-Rollback'
    const runId = 'run-missing-tab-resident-rollback'
    const attemptId = 'attempt-missing-tab-resident-rollback'
    const tabId = 6303
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 431850,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 431850})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
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
        attemptNumber: 1
    })

    const activeResult = await sw.transitionCoordinatorItemForQueuedTab({
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
        openedAt: 431875,
        attemptId,
        attemptNumber: 1,
        retryAttempt: 0,
        maxRetries: 2
    })
    assert.equal(activeResult, true)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')

    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    let fullAuthorityReads = 0
    browser.storage.local.get = async defaults => {
        if(defaults &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueue') &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorRuns') &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueueWal.meta')) {
            fullAuthorityReads += 1
            throw new Error('synthetic rollback full authority load')
        }
        return originalGet(defaults)
    }

    const rolledBack = await sw.rollbackFailedQueuedTabOpen({
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
        attemptId,
        attemptNumber: 1,
        retryAttempt: 0,
        maxRetries: 2,
        currentAuthorityState: sw.coordinatorAuthority.current()
    })
    browser.storage.local.get = originalGet

    assert.equal(fullAuthorityReads, 0)
    assert.equal(rolledBack, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId || null, null)
})

test('queued tab active transition reuses executor authority state', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Resident-State'
    const runId = 'run-active-transition-resident-state'
    const attemptId = 'attempt-active-transition-resident-state'
    const tabId = 6302
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 431900,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 431900})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const authorityState = await sw.coordinatorAuthority.hydrate()
    const action = {
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        attemptId,
        attemptNumber: 1,
        executorPlanAuthorityState: authorityState
    }
    const tab = {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    }
    browser.__tabs.set(tabId, tab)
    const plan = sw.buildQueuedTabOpenEffectPlan(action, tab, 431950)
    assert.equal(plan.activeTransitionDetails.currentAuthorityState.queue[href].status, 'queued')

    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    let fullAuthorityReads = 0
    browser.storage.local.get = async defaults => {
        if(defaults &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueue') &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorRuns') &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueueWal.meta')) {
            fullAuthorityReads += 1
            throw new Error('synthetic active transition full authority load')
        }
        return originalGet(defaults)
    }

    sw.applyQueuedTabOpenRuntimeEffect(plan)
    const result = await sw.confirmQueuedTabOpenDurableActiveEffect(action, tab, plan)
    browser.storage.local.get = originalGet

    assert.equal(fullAuthorityReads, 0)
    assert.equal(result.keepOpen, true)
    assert.equal(result.activeTransitionAccepted, true)
    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, tabId)
    assert.ok(getStoredCoordinatorQueueWal(storage))
})

test('queued tab missing after durable active transition rolls back immediately', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Missing-After-Durable'
    const runId = 'run-active-transition-missing-after-durable'
    const attemptId = 'attempt-active-transition-missing-after-durable'
    const tabId = 6303
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 431960,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 431960})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const authorityState = await sw.coordinatorAuthority.hydrate()
    const action = {
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        attemptId,
        attemptNumber: 1,
        executorPlanAuthorityState: authorityState
    }
    const tab = {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    }
    browser.__tabs.set(tabId, tab)
    const plan = sw.buildQueuedTabOpenEffectPlan(action, tab, 431970)

    sw.applyQueuedTabOpenRuntimeEffect(plan)
    browser.__tabs.delete(tabId)
    const result = await sw.confirmQueuedTabOpenDurableActiveEffect(action, tab, plan)

    assert.equal(result.keepOpen, false)
    assert.equal(result.rolledBack, true)
    assert.equal(result.missingAfterDurableActive, true)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), false)
    assert.equal(sw.state().queuedTabMetadata.some(([id]) => id === tabId), false)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.some(record => record.operationKind === 'active-transition'), true)
    assert.equal(walRecords.some(record => record.operationKind === 'rollback-active-transition'), true)
})

test('queued tab lookup timeout after durable active transition defers rollback', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Lookup-Timeout'
    const runId = 'run-active-transition-lookup-timeout'
    const attemptId = 'attempt-active-transition-lookup-timeout'
    const tabId = 6304
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 431980,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 431980})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const authorityState = await sw.coordinatorAuthority.hydrate()
    const action = {
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        attemptId,
        attemptNumber: 1,
        executorPlanAuthorityState: authorityState
    }
    const tab = {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    }
    browser.__tabs.set(tabId, tab)
    const plan = sw.buildQueuedTabOpenEffectPlan(action, tab, 431990)
    const originalGet = browser.tabs.get.bind(browser.tabs)
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === tabId) {
            return new Promise((resolve, reject) => {
                setTimeout(() => reject(new Error('synthetic tab lookup timed out')), 2500)
            })
        }
        return originalGet(candidateTabId)
    }

    sw.applyQueuedTabOpenRuntimeEffect(plan)
    const result = await sw.confirmQueuedTabOpenDurableActiveEffect(action, tab, plan)
    browser.tabs.get = originalGet

    assert.equal(result.keepOpen, true)
    assert.equal(result.rolledBack, false)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), true)
    assert.equal(sw.state().queuedTabMetadata.some(([id, metadata]) =>
        id === tabId && metadata.activeTransitionConfirmTabLookupReason === 'active-transition-post-confirm-timeout'), false)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
    assert.equal(sw.state().queueWakeupCounters['job.tabGetTimedOut'] > 0, true)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.some(record => record.operationKind === 'active-transition'), true)
    assert.equal(walRecords.some(record => record.operationKind === 'rollback-active-transition'), false)
})

test('queued tab lookup timeout with absent tab-list entry rolls back immediately', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Timeout-Missing-List'
    const runId = 'run-active-transition-timeout-missing-list'
    const attemptId = 'attempt-active-transition-timeout-missing-list'
    const tabId = 6305
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 431995,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 431995})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const authorityState = await sw.coordinatorAuthority.hydrate()
    const action = {
        profileHref: href,
        url: href,
        coordinatorKey: href,
        runId,
        actionKind: 'mute-block',
        tabAction: 'nuke',
        attemptId,
        attemptNumber: 1,
        executorPlanAuthorityState: authorityState
    }
    const tab = {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    }
    browser.__tabs.set(tabId, tab)
    const plan = sw.buildQueuedTabOpenEffectPlan(action, tab, 432000)
    const originalGet = browser.tabs.get.bind(browser.tabs)
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === tabId) {
            browser.__tabs.delete(tabId)
            throw new Error('synthetic tab lookup timed out')
        }
        return originalGet(candidateTabId)
    }

    sw.applyQueuedTabOpenRuntimeEffect(plan)
    const result = await sw.confirmQueuedTabOpenDurableActiveEffect(action, tab, plan)
    browser.tabs.get = originalGet

    assert.equal(result.keepOpen, false)
    assert.equal(result.rolledBack, true)
    assert.equal(result.missingAfterDurableActive, true)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), false)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(sw.state().queueWakeupCounters['job.tabGetTimedOut'] > 0, true)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.some(record => record.operationKind === 'active-transition'), true)
    assert.equal(walRecords.some(record => record.operationKind === 'rollback-active-transition'), true)
})

test('runtime prune defers detach when queued tab lookup times out', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Prune-Timeout'
    const runId = 'run-prune-timeout'
    const attemptId = 'attempt-prune-timeout'
    const tabId = 6306
    const {browser, sw} = loadServiceWorkerHarness({
        now: 432005,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 432005})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
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
    await activateQuoraRuntime(browser, href)
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        attemptId,
        attemptNumber: 1,
        openedAt: 432005,
        durableActiveAt: 432005
    })
    const originalGet = browser.tabs.get.bind(browser.tabs)
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === tabId) {
            throw new Error('synthetic tab lookup timed out')
        }
        return originalGet(candidateTabId)
    }

    const pruned = await sw.pruneMissingQueuedTabRuntimeState('test-runtime-prune-timeout')
    browser.tabs.get = originalGet

    assert.equal(pruned, 0)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), true)
    assert.equal(sw.state().queuedTabMetadata.some(([id]) => id === tabId), true)
    assert.equal(sw.state().queueWakeupCounters['job.tabGetTimedOut'] > 0, true)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    const currentAuthority = await sw.coordinatorAuthority.hydrate()
    assert.equal(currentAuthority.queue[href].status, 'queued')
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
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLeaseReleaseReason, 'active-transition-failed')

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if(isCoordinatorQueueWalPayload(payload)) {
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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

test('claim-tab-action recovers active resident authority without full projection read', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Resident-Active-Claim'
    const runId = 'run-resident-active-claim'
    const attemptId = 'attempt-resident-active-claim'
    const tabId = 779
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3685,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 3685})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    await sw.coordinatorAuthority.hydrate()
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: false
    })
    const originalGet = browser.storage.local.get.bind(browser.storage.local)
    let fullProjectionReads = 0
    browser.storage.local.get = async defaults => {
        if(defaults &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueue') &&
            Object.prototype.hasOwnProperty.call(defaults, 'mbCoordinatorQueueWal.meta')) {
            fullProjectionReads += 1
            throw new Error('synthetic slow resident claim projection read')
        }
        return originalGet(defaults)
    }

    const action = await browser.runtime.sendMessage({
        action: 'claim-tab-action'
    }, {
        tab: {
            id: tabId,
            windowId: 1,
            url: href
        }
    })
    browser.storage.local.get = originalGet

    assert.ok(fullProjectionReads <= 1)
    assert.equal(action.action, 'nuke')
    assert.equal(action.targetUrl, href)
    assert.equal(action.attemptId, attemptId)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
})

test('claim-tab-action recovers active row when persisted tab id is stale', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Stale-Tab-Active-Claim'
    const runId = 'run-stale-tab-active-claim'
    const attemptId = 'attempt-stale-tab-active-claim'
    const staleTabId = 1781
    const liveTabId = 1782
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3690,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: staleTabId, now: 3690})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    await sw.coordinatorAuthority.hydrate()
    browser.__tabs.set(liveTabId, {
        id: liveTabId,
        windowId: 1,
        url: href,
        active: false
    })

    const action = await browser.runtime.sendMessage({
        action: 'claim-tab-action'
    }, {
        tab: {
            id: liveTabId,
            windowId: 1,
            url: href
        }
    })

    assert.equal(action.action, 'nuke')
    assert.equal(action.targetUrl, href)
    assert.equal(action.attemptId, attemptId)
    assert.equal(sw.state().activeQueuedTabs.includes(liveTabId), true)
    assert.equal(sw.state().queuedTabMetadata.some(([id]) => id === liveTabId), true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].tabId, liveTabId)
})

test('stale queued tab sweep defers hung tab lookup without releasing executor slot', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Hung-Tab-Get'
    const runId = 'run-hung-tab-get'
    const attemptId = 'attempt-hung-tab-get'
    const tabId = 780
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 3695,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 3695})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1,
        openedAt: 3600,
        durableActiveAt: 3610,
        closeReason: 'stale-active-tab',
        closeRequestedAt: 3690
    })
    const originalGet = browser.tabs.get.bind(browser.tabs)
    let hungGetCalls = 0
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === tabId) {
            hungGetCalls += 1
            return new Promise((resolve, reject) => {
                timers.setTimeout(() => reject(new Error('synthetic hung tab get timeout')), 2500)
            })
        }
        return originalGet(candidateTabId)
    }

    const result = await settleWithFakeTimers(
        sw.sweepStaleQueuedTabs(),
        timers,
        [0, 1000, 1500, 1000, 5000, 15000, 30000]
    )
    browser.tabs.get = originalGet

    assert.equal(result, undefined)
    assert.ok(hungGetCalls > 0)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), true)
    assert.equal(sw.state().queuedTabMetadata.some(([id]) => id === tabId), true)
    assert.equal(sw.state().queueWakeupCounters['job.tabGetTimedOut'] > 0, true)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
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
    assert.ok((sw.state().queueWakeupCounters['reconcile.activeWithoutActor.usedResidentAuthority'] || 0) > 0)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(storage.mbCoordinatorQueueView.counts.active || 0, 0)
    assert.equal(storage.mbCoordinatorQueueView.counts.queued, 1)
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, 'attempt-active-no-actor')
    assert.equal(sw.coordinatorAuthority.current().queue[href].attemptNumber, 2)
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, null)
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).attemptId, sw.coordinatorAuthority.current().queue[href].attemptId)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'reconcile-active-without-actor')

    const restarted = loadServiceWorkerHarness({
        now: 3950,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'queued')
    assert.equal(hydrated.queue[href].attemptNumber, 2)
    assert.equal(hydrated.queue[href].tabId, null)
})

test('active-without-actor terminal repair schedules next queued fill', async () => {
    const failedHref = 'https://www.quora.com/profile/Synthetic-Active-No-Actor-Terminal'
    const queuedHref = 'https://www.quora.com/profile/Synthetic-Next-After-No-Actor-Terminal'
    const runId = 'run-active-no-actor-terminal-continuation'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 90000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [failedHref]: {
                    ...makeActiveCoordinatorRow({
                        href: failedHref,
                        runId,
                        attemptId: 'attempt-active-no-actor-terminal',
                        tabId: 701,
                        now: 30000
                    }),
                    executorNoForegroundFallback: true,
                    retryAttempt: 1,
                    maxRetries: 1,
                    maxAttempts: 2
                },
                [queuedHref]: makeQueuedCoordinatorRow({
                    href: queuedHref,
                    runId,
                    attemptId: 'attempt-next-after-terminal',
                    now: 3000
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href: failedHref, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [failedHref]: {
                    profileHref: failedHref,
                    actionKind: 'mute-block',
                    status: 'tab-opening',
                    tabId: 701,
                    tabOpenedAt: 30000,
                    attemptId: 'attempt-active-no-actor-terminal',
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1
                }
            }
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-terminal-continuation')

    assert.equal(result.failed, 1)
    assert.equal(getRecoveredCoordinatorQueue(storage)[failedHref].status, 'failed')
    assert.equal(sw.coordinatorAuthority.current().queue[failedHref].status, 'failed')
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)

    await waitFor(
        () => listTabs(browser).some(tab => tab.url === queuedHref),
        'queued row did not fill after active-without-actor terminal repair',
        {timers, attempts: 40, tickMs: 1000}
    )
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[queuedHref].status))
})

test('authority reconcile defers fresh worker-window startup progress before no-actor failure', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Fresh-Worker-Startup'
    const runId = 'run-fresh-worker-startup'
    const attemptId = 'attempt-fresh-worker-startup'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 3900,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId: null,
                        now: 3900
                    }),
                    retryAttempt: 1,
                    maxRetries: 1
                }
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {},
            ...makeProgressProjectionSeed(href, {
                profileHref: href,
                actionKind: 'mute-block',
                status: 'tab-opening',
                tabId: 805,
                tabOpenedAt: 3890,
                tabCreatedAt: 3890,
                actionSurfaceMode: 'worker-window',
                actionSurfaceWindowId: 1806020536,
                actionSurfaceActivatedAt: 3885,
                attemptId,
                attemptNumber: 1,
                retryAttempt: 1,
                maxRetries: 1,
                updatedAt: 3890
            })
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('dashboard-resume-fast-executor-preflight')

    assert.equal(result.actions, 0)
    assert.equal(result.requeued, 0)
    assert.equal(result.failed, 0)
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    const hydrated = await sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'active')
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    assert.equal(sw.state().queueWakeupCounters['reconcile.deferred.freshWorkerWindowStartupProgress'], 1)
})

test('authority preflight preserves fresh durably active startup actor before claim', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Fresh-Startup-Actor'
    const runId = 'run-fresh-startup-actor'
    const attemptId = 'attempt-fresh-startup-actor'
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3900,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 3900})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const tab = await browser.tabs.create({url: href, active: true})
    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1,
        openedAt: 3890,
        durableActiveAt: 3895,
        durableActiveReason: 'active-transition'
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('dashboard-resume-fast-executor-preflight', {
        queueOnlyAuthority: true
    })

    assert.equal(result.actions, 0)
    assert.equal(result.requeued, 0)
    assert.equal(browser.__removedTabs.includes(tab.id), false)
    assert.equal(browser.__tabs.has(tab.id), true)
    assert.equal(sw.state().activeQueuedTabs.includes(tab.id), true)
    assert.equal((await sw.coordinatorAuthority.hydrate()).queue[href].status, 'active')
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    assert.equal(sw.state().queueWakeupCounters['reconcile.deferred.freshRuntimeStartup'], 1)
})

test('executor queue-only repair defers fresh startup actor before no-actor failure', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Executor-Fresh-Startup-Actor'
    const runId = 'run-executor-fresh-startup-actor'
    const attemptId = 'attempt-executor-fresh-startup-actor'
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3900,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId: null, now: 3900})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    const tab = await browser.tabs.create({url: href, active: true})
    sw.__testAddProvisionalQueuedTab(tab.id, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1,
        openedAt: 3890
    })

    const result = await sw.runCoordinatorExecutorApplyPhase('dashboard-resume-fast-executor', {
        serviceWorkerOwned: true,
        queueOnlyAuthority: true,
        requeueMissingActiveTabs: true
    })

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'no-pending-items')
    assert.equal(sw.state().activeQueuedTabs.includes(tab.id), true)
    assert.equal(browser.__removedTabs.includes(tab.id), false)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    assert.equal(sw.state().queueWakeupCounters['reconcile.deferred.freshRuntimeStartupQueueOnly'], 1)
})

test('executor queue-only repair reports stale active requeue as continuation work', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Executor-Requeue-Continuation'
    const runId = 'run-executor-requeue-continuation'
    const attemptId = 'attempt-executor-requeue-continuation'
    const tabId = 706
    const {sw, storage} = loadServiceWorkerHarness({
        now: 5200,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId,
                        now: 5100
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
                    status: 'queued',
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1,
                    updatedAt: 5100
                }
            }
        }
    })

    const result = await sw.runCoordinatorExecutorApplyPhase('synthetic-queue-only-requeue', {
        serviceWorkerOwned: true,
        queueOnlyAuthority: true,
        requeueMissingActiveTabs: true,
        forceDurableQueueReload: true
    })

    assert.equal(result.changed, true)
    assert.equal(result.reason, 'started-persisted-coordinator-queue')
    assert.equal(result.requeued, 1)
    assert.equal(result.queued, 1)
    assert.equal(result.pending, 1)
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(getRecoveredCoordinatorQueue(storage)[href].status))
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href].status))
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, attemptId)
    assert.ok(sw.coordinatorAuthority.current().queue[href].tabId)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    assert.equal(sw.state().queueWakeupCounters['reconcile.executor.changed.requeuedMissingActiveTab'], 1)
    assert.equal(sw.state().queueWakeupCounters['reconcile.executor.changed.requeuedMissingActiveTabQueuedForFill'], 1)
})

test('authority reconcile requeues active-transition-failed active row with missing tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Missing-Tab'
    const runId = 'run-active-transition-missing-tab'
    const attemptId = 'attempt-active-transition-missing-tab'
    const tabId = 703
    const {sw, storage} = loadServiceWorkerHarness({
        now: 5000,
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
                    queuedAt: 1000,
                    activeAt: 4800,
                    updatedAt: 4900,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    maxAttempts: 1,
                    actionLeaseReleaseReason: 'active-transition-failed',
                    actionLeaseReleasedAt: 4900
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
                    actionKind: 'mute-block',
                    status: '',
                    closeReason: 'active-transition-failed',
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 4900
                }
            }
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-transition-missing-tab', {
        queueOnlyAuthority: true
    })

    assert.equal(result.requeued, 1)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, null)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
})

test('user-initiated dashboard resume repairs active-transition-failed row before returning', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Direct-Resume-Repairs-Missing-Tab'
    const runId = 'run-direct-resume-missing-tab'
    const attemptId = 'attempt-direct-resume-missing-tab'
    const tabId = 704
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 5010,
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
                    queuedAt: 1000,
                    activeAt: 4800,
                    updatedAt: 4900,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    maxAttempts: 1,
                    actionLeaseReleaseReason: 'active-transition-failed',
                    actionLeaseReleasedAt: 4900
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
                    actionKind: 'mute-block',
                    status: '',
                    closeReason: 'active-transition-failed',
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    updatedAt: 4900
                }
            }
        }
    })

    const result = await browser.runtime.sendMessage({
        action: 'resume-coordinator-queue',
        allowBeforeQuora: true,
        userInitiated: true
    })

    assert.equal(result.scheduledOnly, undefined)
    assert.equal(result.recovered, true)
    assert.equal(result.reason, 'authority-reconcile-changed')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, null)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
})

test('authority reconcile terminalizes retry-exhausted no-actor row when persisted tab lookup times out', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-No-Actor-Timeout'
    const runId = 'run-active-no-actor-timeout'
    const attemptId = 'attempt-active-no-actor-timeout'
    const tabId = 702
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 250000,
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
                    queuedAt: 100000,
                    activeAt: 200000,
                    updatedAt: 200000,
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 1,
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
                    actionKind: 'mute-block',
                    status: 'tab-opening',
                    tabId,
                    tabOpenedAt: 200000,
                    updatedAt: 200000,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1
                }
            }
        }
    })
    const originalGet = browser.tabs.get.bind(browser.tabs)
    let hungGetCalls = 0
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === tabId) {
            hungGetCalls += 1
            throw new Error('synthetic persisted tab get timed out')
        }
        return originalGet(candidateTabId)
    }

    const result = await settleWithFakeTimers(
        sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-timeout'),
        timers,
        [0, 1000, 1500, 1000, 5000, 15000, 30000]
    )
    browser.tabs.get = originalGet

    assert.equal(result.actions, 1)
    assert.equal(result.requeued, 0)
    assert.equal(result.failed, 1)
    assert.ok(hungGetCalls > 0)
    assert.equal(sw.state().queueWakeupCounters['job.tabGetTimedOut'] > 0, true)
    const hydrated = await sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'failed')
    assert.equal(hydrated.queue[href].outcome, 'timeout')
    assert.equal(getProgressShardRecord(storage, href).status, 'interrupted')
})

test('authority reconcile requeues stale no-actor row when persisted tab lookup times out', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-No-Actor-Stale-Timeout'
    const runId = 'run-active-no-actor-stale-timeout'
    const attemptId = 'attempt-active-no-actor-stale-timeout'
    const tabId = 703
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
                    actionKind: 'mute-block',
                    status: 'tab-opening',
                    tabId,
                    tabOpenedAt: 200000,
                    updatedAt: 200000,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1
                }
            }
        }
    })
    const originalGet = browser.tabs.get.bind(browser.tabs)
    let hungGetCalls = 0
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === tabId) {
            hungGetCalls += 1
            throw new Error('synthetic persisted tab get timed out')
        }
        return originalGet(candidateTabId)
    }

    const result = await settleWithFakeTimers(
        sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-stale-timeout'),
        timers,
        [0, 1000, 1500, 1000, 5000, 15000, 30000]
    )
    browser.tabs.get = originalGet

    assert.equal(result.actions, 1)
    assert.equal(result.requeued, 1)
    assert.equal(result.failed, 0)
    assert.ok(hungGetCalls > 0)
    assert.equal(sw.state().queueWakeupCounters['job.tabGetTimedOut'] > 0, true)
    const hydrated = await sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'queued')
    assert.equal(hydrated.queue[href].tabId, null)
    assert.notEqual(hydrated.queue[href].attemptId, attemptId)
    assert.equal(getProgressShardRecord(storage, href).status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).attemptId, hydrated.queue[href].attemptId)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'reconcile-active-without-actor')
})

test('authority reconcile adopts same-profile live tab before no-actor terminal failure', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-No-Actor-Live-Drift'
    const runId = 'run-active-no-actor-live-drift'
    const attemptId = 'attempt-active-no-actor-live-drift'
    const staleTabId = 709
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3901,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId: staleTabId,
                        now: 3901
                    }),
                    retryAttempt: 1,
                    maxRetries: 1,
                    milestones: {
                        actionClaimedAt: 3890,
                        contentOpenedAt: 3890,
                        navigationStartedAt: 3890,
                        profileReadyAt: 3895
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
                    actionKind: 'mute-block',
                    status: 'tab-opening',
                    tabId: staleTabId,
                    tabOpenedAt: 3500,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1
                }
            }
        }
    })
    const liveTab = await browser.tabs.create({url: href, active: true})

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-live-drift')

    const recovered = getRecoveredCoordinatorQueue(storage)
    assert.equal(result.adopted, 1)
    assert.equal(result.failed, 0)
    assert.equal(recovered[href].status, 'active')
    assert.equal(recovered[href].tabId, liveTab.id)
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, liveTab.id)
    assert.equal(sw.state().activeQueuedTabs.includes(liveTab.id), true)
    assert.notEqual(storage.mbProfileNukeProgressView?.records?.[href]?.status, 'interrupted')
})

test('authority reconcile terminalizes blocked live profile tab before no-actor terminal failure', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-No-Actor-Blocked-Live'
    const runId = 'run-active-no-actor-blocked-live'
    const attemptId = 'attempt-active-no-actor-blocked-live'
    const staleTabId = 718
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3901,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId: staleTabId,
                        now: 3901
                    }),
                    retryAttempt: 1,
                    maxRetries: 1,
                    milestones: {
                        actionClaimedAt: 3890,
                        contentOpenedAt: 3890,
                        profileReadyAt: 3895,
                        blockAttemptedAt: 3898
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
                    actionKind: 'mute-block',
                    status: 'blocking',
                    tabId: staleTabId,
                    contentOpenedAt: 3890,
                    actionReadyAt: 3895,
                    blockAttemptedAt: 3898,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1
                }
            }
        }
    })
    const liveTab = await browser.tabs.create({url: href, active: true})
    const originalSendMessage = browser.tabs.sendMessage.bind(browser.tabs)
    const closeIfBlockedMessages = []
    browser.tabs.sendMessage = async (tabId, message) => {
        if(message?.action === 'close-if-blocked') {
            closeIfBlockedMessages.push({tabId, message})
            return {
                willClose: true,
                resolvedProfileHref: href,
                lastUrl: href
            }
        }
        return originalSendMessage(tabId, message)
    }

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-blocked-live')

    assert.equal(result.terminalized, 1)
    assert.equal(result.failed, 0)
    assert.equal(result.requeued, 0)
    assert.equal(result.adopted, 0)
    assert.equal(closeIfBlockedMessages.length, 1)
    assert.equal(closeIfBlockedMessages[0].tabId, liveTab.id)
    assert.equal(browser.__tabs.has(liveTab.id), false)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'already-blocked')
    assert.equal(sw.coordinatorAuthority.current().queue[href].attemptId, attemptId)
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'already-blocked')
    assert.equal(getProgressShardRecord(storage, href).status, 'already-blocked')
    assert.equal(getProgressShardRecord(storage, href).blockSucceeded, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'succeeded')

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'terminal-progress')
})

test('authority reconcile terminalizes blocked live action-lease tab before lease expiry', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Action-Lease-Blocked-Live'
    const runId = 'run-action-lease-blocked-live'
    const attemptId = 'attempt-action-lease-blocked-live'
    const tabId = 719
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3910,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId,
                        now: 3910
                    }),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        reason: 'block-confirmation',
                        grantedAt: 3900,
                        heartbeatAt: 3900,
                        expiresAt: 999999
                    },
                    milestones: {
                        actionClaimedAt: 3890,
                        contentOpenedAt: 3890
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
                    actionKind: 'mute-block',
                    status: 'tab-opening',
                    tabId,
                    contentOpenedAt: 3890,
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
        active: true
    })
    const closeIfBlockedMessages = []
    browser.tabs.sendMessage = async (tabId, message) => {
        if(message?.action === 'close-if-blocked') {
            closeIfBlockedMessages.push({tabId, message})
            return {
                willClose: true,
                resolvedProfileHref: href,
                lastUrl: href
            }
        }
        return {}
    }

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-action-lease-blocked-live')

    assert.equal(result.terminalized, 1)
    assert.equal(result.failed, 0)
    assert.equal(closeIfBlockedMessages.length, 1)
    assert.equal(closeIfBlockedMessages[0].tabId, tabId)
    assert.equal(browser.__tabs.has(tabId), false)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'succeeded')
    assert.equal(sw.coordinatorAuthority.current().queue[href].outcome, 'already-blocked')
})

test('authority reconcile requeues missing active-transition tab instead of reclaiming unrelated profile tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Transition-Early-Missing'
    const runId = 'run-active-transition-early-missing'
    const attemptId = 'attempt-active-transition-early-missing'
    const missingTabId = 711
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3902,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId: missingTabId,
                        now: 3902
                    }),
                    retryAttempt: 0,
                    maxRetries: 1,
                    milestones: {
                        tabCreatedAt: 3890,
                        navigationStartedAt: 3890
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
                    actionKind: 'mute-block',
                    status: 'queued',
                    tabId: null,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1,
                    updatedAt: 3890
                }
            }
        }
    })
    const unrelatedProfileTab = await browser.tabs.create({url: href, active: true})

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-transition-early-missing')

    assert.equal(result.adopted, 0)
    assert.equal(result.requeued, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, null)
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, attemptId)
    assert.equal(sw.state().activeQueuedTabs.includes(unrelatedProfileTab.id), false)
    assert.equal(getProgressShardRecord(storage, href).status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).attemptId, sw.coordinatorAuthority.current().queue[href].attemptId)
})

test('authority reconcile requeues missing active tab after releasing stale action lease', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Missing-Lease-Tab'
    const runId = 'run-active-missing-lease-tab'
    const attemptId = 'attempt-active-missing-lease-tab'
    const tabId = 712
    const {sw, storage} = loadServiceWorkerHarness({
        now: 90000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId,
                        now: 80000
                    }),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: 81000,
                        heartbeatAt: 81000,
                        expiresAt: 85000,
                        reason: 'mute-block-profile-menu-action'
                    },
                    retryAttempt: 0,
                    maxRetries: 1,
                    milestones: {
                        tabCreatedAt: 80000,
                        navigationStartedAt: 80000
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
                    actionKind: 'mute-block',
                    status: 'blocking',
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1,
                    contentOpenedAt: 81000,
                    blockError: 'Block confirm foreground unavailable',
                    finalError: 'Block confirm foreground unavailable: confirmation-foreground-timeout',
                    updatedAt: 81000
                }
            }
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-missing-lease-tab')

    assert.equal(result.actions, 2)
    assert.equal(result.requeued, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, null)
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, attemptId)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease, null)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLeaseReleaseReason, 'test-active-missing-lease-tab')
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(getProgressShardRecord(storage, href).status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).attemptId, sw.coordinatorAuthority.current().queue[href].attemptId)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords[0].operationKind, 'action-lease-tab-release')
    assert.equal(walRecords[1].operationKind, 'reconcile-active-without-actor')
})

test('authority reconcile releases stale action lease and requeues when lease tab lookup times out', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Lease-Timeout'
    const runId = 'run-active-lease-timeout'
    const attemptId = 'attempt-active-lease-timeout'
    const tabId = 713
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 500000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId,
                        now: 200000
                    }),
                    activeAt: 200000,
                    updatedAt: 200000,
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: 200000,
                        heartbeatAt: 200000,
                        expiresAt: 290000,
                        reason: 'mute-block-profile-menu-action'
                    },
                    retryAttempt: 0,
                    maxRetries: 1,
                    milestones: {
                        tabCreatedAt: 200000,
                        navigationStartedAt: 200000
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
                    actionKind: 'mute-block',
                    status: 'queued',
                    tabId,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 1,
                    updatedAt: 200000
                }
            }
        }
    })
    const originalGet = browser.tabs.get.bind(browser.tabs)
    let hungGetCalls = 0
    browser.tabs.get = async candidateTabId => {
        if(Number.parseInt(candidateTabId, 10) === tabId) {
            hungGetCalls += 1
            throw new Error('synthetic lease tab get timed out')
        }
        return originalGet(candidateTabId)
    }

    const result = await settleWithFakeTimers(
        sw.runCoordinatorAuthorityReconcileActions('test-active-lease-timeout'),
        timers,
        [0, 1000, 1500, 1000, 2500, 5000, 15000, 30000]
    )
    browser.tabs.get = originalGet

    assert.equal(result.actions, 2)
    assert.equal(result.requeued, 1)
    assert.ok(hungGetCalls >= 2)
    assert.equal(sw.state().queueWakeupCounters['job.tabGetTimedOut'] > 0, true)
    assert.equal(sw.state().queueWakeupCounters['reconcile.persistedTabLookupTimeoutTreatedMissing'] >= 2, true)
    const hydrated = await sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'queued')
    assert.equal(hydrated.queue[href].tabId, null)
    assert.equal(hydrated.queue[href].actionLease, null)
    assert.equal(hydrated.queue[href].actionLeaseReleaseReason, 'test-active-lease-timeout')
    assert.notEqual(hydrated.queue[href].attemptId, attemptId)
    assert.equal(getProgressShardRecord(storage, href).status, 'queued')
    assert.equal(getProgressShardRecord(storage, href).attemptId, hydrated.queue[href].attemptId)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 2)
    assert.equal(walRecords[0].operationKind, 'action-lease-tab-release')
    assert.equal(walRecords[1].operationKind, 'reconcile-active-without-actor')
})

test('authority reconcile adopts same-profile live tab after releasing stale action lease', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Lease-Live-Drift'
    const runId = 'run-active-lease-live-drift'
    const attemptId = 'attempt-active-lease-live-drift'
    const staleTabId = 714
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 90000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId: staleTabId,
                        now: 80000
                    }),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId: staleTabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: 81000,
                        heartbeatAt: 81000,
                        expiresAt: 85000,
                        reason: 'mute-block-profile-menu-action'
                    },
                    retryAttempt: 1,
                    maxRetries: 1,
                    milestones: {
                        contentOpenedAt: 80500,
                        profileReadyAt: 80600,
                        blockAttemptedAt: 81000
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
                    actionKind: 'mute-block',
                    status: 'blocking',
                    tabId: staleTabId,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1,
                    contentOpenedAt: 80500,
                    profileReadyAt: 80600,
                    blockAttemptedAt: 81000,
                    blockError: 'Block confirm foreground unavailable',
                    finalError: 'Block confirm foreground unavailable: confirmation-foreground-timeout',
                    updatedAt: 81000
                }
            }
        }
    })
    const liveTab = await browser.tabs.create({url: href, active: true})

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-lease-live-drift')

    const recovered = getRecoveredCoordinatorQueue(storage)
    assert.equal(result.actions, 2)
    assert.equal(result.adopted, 1)
    assert.equal(result.requeued, 0)
    assert.equal(result.failed, 0)
    assert.equal(recovered[href].status, 'active')
    assert.equal(recovered[href].tabId, liveTab.id)
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, liveTab.id)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLease, null)
    assert.equal(sw.coordinatorAuthority.current().queue[href].actionLeaseReleaseReason, 'test-active-lease-live-drift')
    assert.equal(sw.state().activeQueuedTabs.includes(liveTab.id), true)
    assert.notEqual(storage.mbProfileNukeProgressView?.records?.[href]?.status, 'interrupted')
})

test('authority reconcile defers profile reclaim while action lease tab is still live', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Lease-Live-Tab-Pinned'
    const runId = 'run-active-lease-live-tab-pinned'
    const attemptId = 'attempt-active-lease-live-tab-pinned'
    const leaseTabId = 715
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 90000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId: leaseTabId,
                        now: 89000
                    }),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId: leaseTabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: 89500,
                        heartbeatAt: 89500,
                        expiresAt: 95000,
                        reason: 'mute-block-profile-menu-action'
                    },
                    retryAttempt: 1,
                    maxRetries: 1,
                    milestones: {
                        contentOpenedAt: 89500,
                        profileReadyAt: 89600,
                        blockAttemptedAt: 89700
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
                    actionKind: 'mute-block',
                    status: 'blocking',
                    tabId: leaseTabId,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1,
                    contentOpenedAt: 89500,
                    profileReadyAt: 89600,
                    blockAttemptedAt: 89700,
                    updatedAt: 89700
                }
            }
        }
    })
    browser.__tabs.set(leaseTabId, {
        id: leaseTabId,
        windowId: 1,
        url: 'https://www.quora.com/search?q=synthetic&type=profile',
        active: false
    })
    const unrelatedProfileTab = await browser.tabs.create({url: href, active: true})

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-lease-live-tab-pinned')

    assert.equal(result.changed, false)
    assert.equal(result.adopted, 0)
    assert.equal(result.requeued, 0)
    const recovered = getRecoveredCoordinatorQueue(storage)
    assert.equal(recovered[href].status, 'active')
    assert.equal(recovered[href].tabId, leaseTabId)
    assert.equal(recovered[href].actionLease.tabId, leaseTabId)
    assert.equal(sw.state().activeQueuedTabs.includes(unrelatedProfileTab.id), false)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
})

test('active action lease rejects progress from stale sender tab', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Lease-Stale-Sender'
    const runId = 'run-active-lease-stale-sender'
    const attemptId = 'attempt-active-lease-stale-sender'
    const staleTabId = 716
    const leaseTabId = 717
    const {sw, storage} = loadServiceWorkerHarness({
        now: 91000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId: leaseTabId,
                        now: 90000
                    }),
                    actionLease: {
                        kind: 'profile-menu',
                        actionKind: 'mute-block',
                        profileHref: href,
                        tabId: leaseTabId,
                        attemptId,
                        attemptNumber: 1,
                        grantedAt: 90500,
                        heartbeatAt: 90500,
                        expiresAt: 95000,
                        reason: 'mute-block-profile-menu-action'
                    },
                    milestones: {
                        contentOpenedAt: 90500,
                        profileReadyAt: 90600
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
                    actionKind: 'mute-block',
                    status: 'tab-opened',
                    tabId: leaseTabId,
                    attemptId,
                    attemptNumber: 1,
                    contentOpenedAt: 90500,
                    updatedAt: 90500
                }
            }
        }
    })

    const milestone = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: href,
        patch: {
            actionKind: 'mute-block',
            status: 'blocking',
            blockAttemptedAt: 91000,
            attemptId,
            attemptNumber: 1,
            tabId: staleTabId
        },
        senderTabId: staleTabId
    })

    assert.equal(milestone.recorded, false)
    assert.equal(milestone.reason, 'active-action-lease-sender-tab-mismatch')

    const terminal = await sw.recordCoordinatorJobProgress(href, {
        actionKind: 'mute-block',
        status: 'error',
        finalError: 'Queued direct block action did not complete',
        attemptId,
        attemptNumber: 1,
        tabId: staleTabId
    }, {
        expectTerminal: true,
        senderTabId: staleTabId
    })

    assert.equal(terminal.recorded, false)
    assert.equal(terminal.terminal, false)
    assert.equal(terminal.reason, 'active-action-lease-sender-tab-mismatch')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].tabId, leaseTabId)
    assert.notEqual(getRecoveredCoordinatorQueue(storage)[href].status, 'failed')
})

test('content script ensure reprobes same URL when extension version changes', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Stale-Content-Script-Version'
    const runId = 'run-stale-content-script-version'
    const attemptId = 'attempt-stale-content-script-version'
    const tabId = 713
    const {browser, sw} = loadServiceWorkerHarness({
        now: 91000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 91000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: true,
        status: 'complete'
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1,
        contentScriptEnsureUrl: href,
        contentScriptEnsureVersion: '1.6.702',
        contentScriptPresentAt: 90000
    })

    let probeCalls = 0
    let injected = false
    let sentMessages = 0
    let reloads = 0
    browser.scripting.executeScript = async details => {
        if(details.func) {
            probeCalls += 1
            return [{
                result: {
                    marker: '1.6.702',
                    expectedVersion: 'test',
                    versionMatches: false,
                    muteBlockControls: 3,
                    readyState: 'complete',
                    url: href
                }
            }]
        }
        if((details.files || []).includes('js/content.js')) {
            injected = true
            return []
        }
        return []
    }
    browser.tabs.sendMessage = async () => {
        sentMessages += 1
        return {accepted: true}
    }
    const originalReload = browser.tabs.reload.bind(browser.tabs)
    browser.tabs.reload = async reloadTabId => {
        reloads += 1
        return originalReload(reloadTabId)
    }

    const result = await sw.ensureQueuedTabContentScript(tabId, 'test-version-mismatch')
    const metadata = Object.fromEntries(sw.state().queuedTabMetadata)[tabId]

    assert.equal(result.ensured, true)
    assert.equal(result.reloaded, true)
    assert.equal(result.versionMismatch, true)
    assert.equal(probeCalls, 1)
    assert.equal(injected, false)
    assert.equal(sentMessages, 0)
    assert.equal(reloads, 1)
    assert.equal(metadata.contentScriptEnsureVersion, '')
    assert.equal(metadata.contentScriptEnsureUrl, '')
    assert.equal(metadata.contentScriptPresentAt, 0)
})

test('content script ensure reloads same-version cached marker when nudge has no receiver', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Stale-Content-Script-Receiver'
    const runId = 'run-stale-content-script-receiver'
    const attemptId = 'attempt-stale-content-script-receiver'
    const tabId = 714
    const {browser, sw} = loadServiceWorkerHarness({
        now: 92000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 92000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: true,
        status: 'complete'
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1,
        durableActiveAt: 91900,
        contentScriptEnsureUrl: href,
        contentScriptEnsureVersion: 'test',
        contentScriptPresentAt: 91950
    })

    let sentMessages = 0
    let reloads = 0
    browser.tabs.sendMessage = async () => {
        sentMessages += 1
        throw new Error('Could not establish connection. Receiving end does not exist.')
    }
    const originalReload = browser.tabs.reload.bind(browser.tabs)
    browser.tabs.reload = async reloadTabId => {
        reloads += 1
        return originalReload(reloadTabId)
    }

    const result = await sw.ensureQueuedTabContentScript(tabId, 'test-cached-marker-no-receiver')
    const metadata = Object.fromEntries(sw.state().queuedTabMetadata)[tabId]

    assert.equal(result.ensured, true)
    assert.equal(result.alreadyChecked, true)
    assert.equal(result.reloaded, true)
    assert.equal(sentMessages, 4)
    assert.equal(reloads, 1)
    assert.equal(metadata.contentScriptPresentAt, 0)
    assert.equal(metadata.contentScriptEnsureUrl, '')
    assert.equal(metadata.contentScriptEnsureVersion, '')
    assert.equal(metadata.contentScriptReloadCount, 1)
    assert.equal(timers.pending().some(timer => timer.dueAt === timers.now + 750), true)
    assert.equal((sw.state().queueWakeupCounters['nudge.reloadRequested'] || 0), 1)
})

test('content script reload schedules a post-reload ensure and claim continuation', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Post-Reload-Continuation'
    const runId = 'run-post-reload-continuation'
    const attemptId = 'attempt-post-reload-continuation'
    const tabId = 716
    const {browser, sw, timers} = loadServiceWorkerHarness({
        now: 92500,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 92500})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: true,
        status: 'complete'
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1,
        durableActiveAt: 92400,
        contentScriptEnsureUrl: href,
        contentScriptEnsureVersion: 'test',
        contentScriptPresentAt: 92450
    })

    let sentMessages = 0
    browser.tabs.sendMessage = async () => {
        sentMessages += 1
        if(sentMessages <= 4) {
            throw new Error('Could not establish connection. Receiving end does not exist.')
        }
        return {accepted: true}
    }
    let probes = 0
    browser.scripting.executeScript = async details => {
        if(details.func) {
            probes += 1
            return [{
                result: {
                    marker: 'test',
                    expectedVersion: 'test',
                    versionMatches: true,
                    muteBlockControls: 3,
                    readyState: 'complete',
                    url: href
                }
            }]
        }
        return []
    }

    const result = await sw.ensureQueuedTabContentScript(tabId, 'test-post-reload-continuation')
    assert.equal(result.reloaded, true)
    assert.equal(sentMessages, 4)

    await timers.tick(750)
    await flushAsync(20)
    const metadata = Object.fromEntries(sw.state().queuedTabMetadata)[tabId]

    assert.equal(sentMessages, 5)
    assert.equal(probes, 1)
    assert.equal(metadata.contentScriptPresentAt, timers.now)
    assert.equal(metadata.contentScriptReloadCount, 1)
})

test('authority reconcile reloads confirmed live actor with stale content script receiver', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Live-Actor-Stale-Receiver'
    const runId = 'run-live-actor-stale-receiver'
    const attemptId = 'attempt-live-actor-stale-receiver'
    const tabId = 715
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 93000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now: 93000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })
    await sw.coordinatorAuthority.hydrate()
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        active: true,
        status: 'complete'
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1,
        durableActiveAt: 92900,
        contentScriptEnsureUrl: href,
        contentScriptEnsureVersion: 'test',
        contentScriptPresentAt: 92950
    })

    let sentMessages = 0
    let reloads = 0
    browser.tabs.sendMessage = async () => {
        sentMessages += 1
        throw new Error('Could not establish connection. Receiving end does not exist.')
    }
    const originalReload = browser.tabs.reload.bind(browser.tabs)
    browser.tabs.reload = async reloadTabId => {
        reloads += 1
        return originalReload(reloadTabId)
    }

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-confirmed-live-stale-receiver')
    const metadata = Object.fromEntries(sw.state().queuedTabMetadata)[tabId]

    assert.equal(result.actions, 1)
    assert.equal(result.runtimeRecovered, 1)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')
    assert.equal(sentMessages, 4)
    assert.equal(reloads, 1)
    assert.equal(metadata.contentScriptPresentAt, 0)
    assert.equal(metadata.contentScriptEnsureUrl, '')
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal((sw.state().queueWakeupCounters['reconcile.changed.runtimeRecovered'] || 0), 1)
})

test('authority reconcile ignores stale mismatched progress for active-without-actor repair', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Mismatched-Progress'
    const runId = 'run-active-mismatched-progress'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 3902,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId: 'attempt-active-current',
                        tabId: 710,
                        now: 3902
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
                    status: 'queued',
                    tabId: 710,
                    attemptId: 'attempt-stale-progress',
                    attemptNumber: 2,
                    retryAttempt: 0,
                    maxRetries: 1,
                    updatedAt: 3500
                }
            }
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-mismatched-progress')

    assert.equal(result.requeued, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(storage.mbProfileNukeProgress[href].attemptId, 'attempt-stale-progress')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, 'attempt-active-current')
    assert.equal(sw.coordinatorAuthority.current().queue[href].attemptNumber, 2)
    assert.equal(getProgressShardRecord(storage, href), null)
    assert.equal(storage.mbCoordinatorQueueView.counts.queued, 1)
    assert.equal(storage.mbCoordinatorQueueView.items[0].attemptId, sw.coordinatorAuthority.current().queue[href].attemptId)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'reconcile-active-without-actor')
})

test('authority reconcile requeues projection-only action-phase active row when action tab is gone', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Projection-Action-Phase'
    const runId = 'run-active-projection-action-phase'
    const attemptId = 'attempt-active-projection-action-phase'
    const {sw, storage} = loadServiceWorkerHarness({
        now: 3905,
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
                    tabId: 702,
                    attemptId,
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
            mbProfileNukeProgress: {},
            ...makeProgressProjectionSeed(href, {
                status: 'page-ready',
                runId,
                tabId: 702,
                actionKind: 'mute-block',
                attemptId,
                attemptNumber: 1,
                retryAttempt: 0,
                maxRetries: 1,
                blockAttemptedAt: 3901,
                updatedAt: 3901
            })
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-projection-action-phase')

    assert.equal(result.requeued, 1)
    assert.equal(result.actions, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'queued')
    assert.notEqual(sw.coordinatorAuthority.current().queue[href].attemptId, attemptId)
    assert.equal(sw.coordinatorAuthority.current().queue[href].attemptNumber, 2)
    assert.equal(sw.coordinatorAuthority.current().queue[href].tabId, null)
    assert.equal(getProgressShardRecord(storage, href), null)
    assert.equal(storage.mbCoordinatorQueueView.counts.queued, 1)
    assert.equal(storage.mbCoordinatorQueueView.items[0].attemptId, sw.coordinatorAuthority.current().queue[href].attemptId)

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'reconcile-active-without-actor')
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
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
        if(isCoordinatorQueueWalPayload(payload)) {
            throw new Error('synthetic active-without-actor WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-no-actor-append-failure')

    assert.equal(result.changed, false)
    assert.equal(result.requeued, 0)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
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
    assert.equal(storage.mbProfileNukeProgress[href].status, 'tab-opening')
    assert.equal(storage.mbProfileNukeProgressView.records[href].status, 'interrupted')
    assert.equal(getProgressShardRecord(storage, href).status, 'interrupted')

    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage).meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'reconcile-active-without-actor')

    const restarted = loadServiceWorkerHarness({
        now: 3960,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'failed')
})

test('authority reconcile terminalizes active row from same-attempt terminal progress through WAL', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Terminal-Progress'
    const runId = 'run-active-terminal-progress'
    const attemptId = 'attempt-active-terminal-progress'
    const {storage, sw} = loadServiceWorkerHarness({
        now: 3935,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: {
                    ...makeActiveCoordinatorRow({
                        href,
                        runId,
                        attemptId,
                        tabId: 714,
                        now: 3935
                    }),
                    retryAttempt: 0,
                    maxRetries: 2
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
                    status: 'interrupted',
                    tabId: 714,
                    attemptId,
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 2,
                    finalError: 'Durable active queue row had no confirmed runtime actor',
                    terminalAt: 3900,
                    updatedAt: 3900
                }
            }
        }
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-terminal-progress')

    assert.equal(result.failed, 1)
    assert.equal(result.actions, 1)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'failed')
    assert.equal(sw.coordinatorAuthority.current().queue[href].attemptId, attemptId)

    const walStore = getStoredCoordinatorQueueWal(storage)
    const walRecords = getWalRecordsForGeneration(
        walStore,
        walStore.meta.activeCheckpoint
    )
    assert.equal(walRecords.length, 1)
    assert.equal(walRecords[0].operationKind, 'terminal-progress-active')

    const restarted = loadServiceWorkerHarness({
        now: 3965,
        storage
    })
    const hydrated = await restarted.sw.coordinatorAuthority.hydrate()
    assert.equal(hydrated.queue[href].status, 'failed')
    assert.equal(hydrated.queue[href].attemptId, attemptId)
})

test('authority reconcile terminal-progress WAL append failure leaves active row active', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Active-Terminal-Progress-Append-Failure'
    const runId = 'run-active-terminal-progress-append-failure'
    const attemptId = 'attempt-active-terminal-progress-append-failure'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 3936,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({
                    href,
                    runId,
                    attemptId,
                    tabId: 719,
                    now: 3936
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [href]: {
                    profileHref: href,
                    actionKind: 'mute-block',
                    status: 'interrupted',
                    tabId: 719,
                    attemptId,
                    attemptNumber: 1,
                    finalError: 'synthetic terminal-progress WAL append failure',
                    terminalAt: 3910,
                    updatedAt: 3910
                }
            }
        }
    })
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(isCoordinatorQueueWalPayload(payload)) {
            throw new Error('synthetic terminal-progress WAL append failure')
        }
        return originalSet(payload)
    }

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-active-terminal-progress-append-failure')

    assert.equal(result.changed, false)
    assert.equal(result.failed, 0)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'active')
    assert.equal(getStoredCoordinatorQueueWal(storage), undefined)
    assert.equal(sw.coordinatorAuthority.current().queue[href].status, 'active')
})

test('fast executor stops after authority preflight repairs stale active row', async () => {
    const staleHref = 'https://www.quora.com/profile/Synthetic-Fast-Preflight-Stale'
    const queuedHref = 'https://www.quora.com/profile/Synthetic-Fast-Preflight-Queued'
    const runId = 'run-fast-preflight-active'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 3940,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [staleHref]: {
                    ...makeActiveCoordinatorRow({
                        href: staleHref,
                        runId,
                        attemptId: 'attempt-fast-preflight-stale',
                        tabId: 705,
                        now: 3940
                    }),
                    retryAttempt: 1,
                    maxRetries: 1
                },
                [queuedHref]: makeQueuedCoordinatorRow({
                    href: queuedHref,
                    runId,
                    attemptId: 'attempt-fast-preflight-queued',
                    now: 3940
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href: staleHref})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [staleHref]: {
                    profileHref: staleHref,
                    actionKind: 'mute-block',
                    status: 'queued',
                    tabId: null,
                    attemptId: 'attempt-fast-preflight-stale',
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1,
                    updatedAt: 3500
                }
            }
        }
    })

    const result = await sw.runCoordinatorQueueExecutorFastPath('test-fast-preflight', {
        awaitFill: true
    })

    assert.equal(result.changed, true)
    assert.equal(result.reason, 'fast-executor-authority-preflight-changed')
    assert.equal(result.failed, 1)
    assert.equal(result.queued, 0)
    assert.equal(listTabs(browser).length, 0)
    assert.equal(storage.mbCoordinatorQueue[staleHref].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[staleHref].status, 'failed')
    assert.equal(sw.coordinatorAuthority.current().queue[queuedHref].status, 'queued')
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().queueWakeupCounters['pump.fastExecutor.authorityPreflightChanged'], 1)
})

test('scheduled fast executor continues into queued work after active preflight repair', async () => {
    const staleHref = 'https://www.quora.com/profile/Synthetic-Fast-Preflight-Continue-Stale'
    const queuedHref = 'https://www.quora.com/profile/Synthetic-Fast-Preflight-Continue-Queued'
    const runId = 'run-fast-preflight-continue-active'
    const {browser, storage, sw, timers} = loadServiceWorkerHarness({
        now: 3941,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [staleHref]: {
                    ...makeActiveCoordinatorRow({
                        href: staleHref,
                        runId,
                        attemptId: 'attempt-fast-preflight-continue-stale',
                        tabId: 714,
                        now: 3941
                    }),
                    retryAttempt: 1,
                    maxRetries: 1
                },
                [queuedHref]: makeQueuedCoordinatorRow({
                    href: queuedHref,
                    runId,
                    attemptId: 'attempt-fast-preflight-continue-queued',
                    now: 3941
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href: staleHref})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [staleHref]: {
                    profileHref: staleHref,
                    actionKind: 'mute-block',
                    status: 'queued',
                    tabId: null,
                    attemptId: 'attempt-fast-preflight-continue-stale',
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1,
                    updatedAt: 3500
                }
            }
        }
    })

    const result = await settleWithFakeTimers(
        sw.runCoordinatorQueueExecutorFastPath('test-fast-preflight-continue', {
            awaitFill: true,
            returnAfterDurableActive: true,
            continueAfterAuthorityPreflight: true
        }),
        timers,
        [0, 500, 1000, 5000]
    )

    assert.equal(result.changed, true)
    assert.equal(result.authorityPreflightChanged, true)
    assert.equal(result.authorityPreflight.failed, 1)
    assert.equal(result.queued, 1)
    assert.equal(storage.mbCoordinatorQueue[staleHref].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[staleHref].status, 'failed')
    await waitFor(
        () => listTabs(browser).some(tab => tab.url === queuedHref),
        'queued row did not start after active preflight repair continuation',
        {timers, attempts: 40, tickMs: 1000}
    )
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[queuedHref].status))
    assert.equal(sw.state().queueWakeupCounters['pump.fastExecutor.authorityPreflightChanged'], 1)
    assert.equal(sw.state().queueWakeupCounters['pump.fastExecutor.authorityPreflightContinued'], 1)
})

test('authority preflight defers fresh provisional active-transition runtime actor', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Fresh-Provisional-Preflight'
    const runId = 'run-fresh-provisional-preflight'
    const attemptId = 'attempt-fresh-provisional-preflight'
    const tabId = 719
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now: 3943,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({
                    href,
                    runId,
                    attemptId,
                    now: 3943
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
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
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        ownerTabId: 'service-worker-queue-owner',
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1,
        openedAt: 3942,
        activeTransitionUnconfirmedAt: 3942
    })

    const result = await sw.runCoordinatorAuthorityReconcileActions('test-fresh-provisional-preflight', {
        queueOnlyAuthority: true
    })

    assert.equal(result.changed, false)
    assert.equal(result.runtimeDetached, 0)
    assert.equal(result.runtimeClosed, 0)
    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(browser.__removedTabs.includes(tabId), false)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), true)
    assert.equal(storage.mbCoordinatorQueue[href].status, 'queued')
    assert.equal(sw.state().queueWakeupCounters['reconcile.deferred.freshRuntimeStartup'], 1)
})

test('fast executor authority preflight repairs a stale active batch before opening queued work', async () => {
    const staleOneHref = 'https://www.quora.com/profile/Synthetic-Fast-Preflight-Stale-One'
    const staleTwoHref = 'https://www.quora.com/profile/Synthetic-Fast-Preflight-Stale-Two'
    const queuedHref = 'https://www.quora.com/profile/Synthetic-Fast-Preflight-Batch-Queued'
    const runId = 'run-fast-preflight-active-batch'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 3942,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [staleOneHref]: {
                    ...makeActiveCoordinatorRow({
                        href: staleOneHref,
                        runId,
                        attemptId: 'attempt-fast-preflight-stale-one',
                        tabId: 715,
                        now: 3942
                    }),
                    retryAttempt: 0,
                    maxRetries: 2
                },
                [staleTwoHref]: {
                    ...makeActiveCoordinatorRow({
                        href: staleTwoHref,
                        runId,
                        attemptId: 'attempt-fast-preflight-stale-two',
                        tabId: 716,
                        now: 3942
                    }),
                    retryAttempt: 0,
                    maxRetries: 2
                },
                [queuedHref]: makeQueuedCoordinatorRow({
                    href: queuedHref,
                    runId,
                    attemptId: 'attempt-fast-preflight-batch-queued',
                    now: 3942
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href: staleOneHref})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [staleOneHref]: {
                    profileHref: staleOneHref,
                    actionKind: 'mute-block',
                    status: 'queued',
                    tabId: null,
                    attemptId: 'attempt-fast-preflight-stale-one',
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 2,
                    updatedAt: 3500
                },
                [staleTwoHref]: {
                    profileHref: staleTwoHref,
                    actionKind: 'mute-block',
                    status: 'queued',
                    tabId: null,
                    attemptId: 'attempt-fast-preflight-stale-two',
                    attemptNumber: 1,
                    retryAttempt: 0,
                    maxRetries: 2,
                    updatedAt: 3500
                }
            }
        }
    })

    const result = await sw.runCoordinatorQueueExecutorFastPath('test-fast-preflight-batch', {
        awaitFill: true
    })

    assert.equal(result.changed, true)
    assert.equal(result.reason, 'fast-executor-authority-preflight-changed')
    assert.equal(result.requeued, 2)
    assert.equal(result.actions, 2)
    assert.equal(result.queued, 0)
    assert.equal(listTabs(browser).length, 0)

    const authorityQueue = sw.coordinatorAuthority.current().queue
    assert.equal(authorityQueue[staleOneHref].status, 'queued')
    assert.equal(authorityQueue[staleTwoHref].status, 'queued')
    assert.notEqual(authorityQueue[staleOneHref].attemptId, 'attempt-fast-preflight-stale-one')
    assert.notEqual(authorityQueue[staleTwoHref].attemptId, 'attempt-fast-preflight-stale-two')
    assert.equal(authorityQueue[queuedHref].status, 'queued')
    assert.equal(storage.mbCoordinatorQueue[staleOneHref].status, 'active')
    assert.equal(storage.mbCoordinatorQueue[staleTwoHref].status, 'active')
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().queueWakeupCounters['pump.fastExecutor.authorityPreflightChanged'], 1)
    assert.equal(sw.state().queueWakeupCounters['reconcile.changed.activeRequeued'], 2)
})

test('reconcile tick skips executor after authority repairs stale active row', async () => {
    const staleHref = 'https://www.quora.com/profile/Synthetic-Reconcile-Preflight-Stale'
    const queuedHref = 'https://www.quora.com/profile/Synthetic-Reconcile-Preflight-Queued'
    const runId = 'run-reconcile-preflight-active'
    const {browser, storage, sw} = loadServiceWorkerHarness({
        now: 3945,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [staleHref]: {
                    ...makeActiveCoordinatorRow({
                        href: staleHref,
                        runId,
                        attemptId: 'attempt-reconcile-preflight-stale',
                        tabId: 706,
                        now: 3945
                    }),
                    retryAttempt: 1,
                    maxRetries: 1
                },
                [queuedHref]: makeQueuedCoordinatorRow({
                    href: queuedHref,
                    runId,
                    attemptId: 'attempt-reconcile-preflight-queued',
                    now: 3945
                })
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href: staleHref})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [staleHref]: {
                    profileHref: staleHref,
                    actionKind: 'mute-block',
                    status: 'queued',
                    tabId: null,
                    attemptId: 'attempt-reconcile-preflight-stale',
                    attemptNumber: 1,
                    retryAttempt: 1,
                    maxRetries: 1,
                    updatedAt: 3500
                }
            }
        }
    })

    const result = await sw.runCoordinatorReconcileTick('test-reconcile-preflight', {
        allowBeforeQuora: true,
        awaitFill: true
    })

    assert.equal(result.recovered, true)
    assert.equal(result.reason, 'authority-reconcile-changed')
    assert.equal(result.reconcile.authority.failed, 1)
    assert.equal(result.reconcile.executor.queued, 0)
    assert.equal(result.reconcile.executor.reason, 'authority-reconcile-changed')
    assert.equal(listTabs(browser).length, 0)
    assert.equal(storage.mbCoordinatorQueue[staleHref].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[staleHref].status, 'failed')
    assert.equal(sw.coordinatorAuthority.current().queue[queuedHref].status, 'queued')
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
    assert.equal(sw.state().queueWakeupCounters['reconcile.executorSkippedAfterAuthorityChange'], 1)
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

test('queued tab release defers active rollback while content-script recovery is fresh', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Release-Defers-Fresh-Recovery'
    const runId = 'run-release-defers-fresh-recovery'
    const attemptId = 'attempt-release-defers-fresh-recovery'
    const tabId = 732
    const now = 4010
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            ...makeProgressProjectionSeed(href, {
                profileHref: href,
                actionKind: 'mute-block',
                status: 'tab-opened',
                runId,
                tabId,
                attemptId,
                attemptNumber: 1,
                tabOpenedAt: now - 200,
                updatedAt: now - 200
            })
        }
    })
    await sw.coordinatorAuthority.hydrate()
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        status: 'complete',
        active: true
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        ownerTabId: 'service-worker-queue-owner',
        noForegroundFallback: true,
        attemptId,
        attemptNumber: 1,
        openedAt: now - 200,
        durableActiveAt: now - 150,
        contentScriptEnsureFailedAt: now - 50,
        lastNudgeFailedAt: now - 40
    })

    const release = await browser.runtime.sendMessage({
        action: 'release-job-tab',
        attemptId
    }, {
        tab: {
            id: tabId,
            url: href,
            windowId: 1
        }
    })

    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(release.released, true)
    assert.equal(release.rollbackDeferred, true)
    assert.equal(recoveredQueue[href].status, 'active')
    assert.equal(recoveredQueue[href].tabId, tabId)
    assert.equal(recoveredQueue[href].attemptId, attemptId)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), true)
    assert.equal(Object.fromEntries(sw.state().queuedTabMetadata)[tabId].releaseRollbackDeferredReason, 'fresh-content-script-recovery')
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, false)
    assert.equal(sw.state().hasCoordinatorQueueResumeTimeout, true)
})

test('deferred release cleanup preserves claimable action for content-script recovery', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Deferred-Release-Claim-Recovery'
    const runId = 'run-deferred-release-claim-recovery'
    const attemptId = 'attempt-deferred-release-claim-recovery'
    const tabId = 733
    const now = 4510
    const {browser, sw, storage} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            ...makeProgressProjectionSeed(href, {
                profileHref: href,
                actionKind: 'mute-block',
                status: 'tab-opened',
                runId,
                tabId,
                attemptId,
                attemptNumber: 1,
                tabOpenedAt: now - 200,
                updatedAt: now - 200
            })
        }
    })
    await sw.coordinatorAuthority.hydrate()
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        status: 'complete',
        active: true
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        ownerTabId: 'service-worker-queue-owner',
        noForegroundFallback: true,
        attemptId,
        attemptNumber: 1,
        openedAt: now - 200,
        durableActiveAt: now - 150,
        contentScriptEnsureFailedAt: now - 50,
        lastNudgeFailedAt: now - 40
    })

    const release = await sw.releaseQueuedTabAndCleanup(tabId, {awaitFill: true})
    const metadataAfterRelease = Object.fromEntries(sw.state().queuedTabMetadata)[tabId]

    assert.equal(release.rollbackDeferred, true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'active')
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), true)
    assert.equal(metadataAfterRelease.releaseRollbackDeferredReason, 'fresh-content-script-recovery')

    let sentClaim = null
    browser.tabs.sendMessage = async (messageTabId, message) => {
        sentClaim = {messageTabId, message}
        return {accepted: true}
    }

    const nudge = await sw.nudgeQueuedTabActionClaim(tabId, 'test-deferred-release-claim-recovery')

    assert.equal(nudge.nudged, true)
    assert.equal(sentClaim.messageTabId, tabId)
    assert.equal(sentClaim.message.queuedAction.targetUrl, href)
    assert.equal(sentClaim.message.queuedAction.coordinatorKey, href)
    assert.equal(sentClaim.message.queuedAction.attemptId, attemptId)
    assert.equal(sentClaim.message.queuedAction.attemptNumber, 1)
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
        () => getProgressShardRecord(storage, href)?.status === 'tab-opening' &&
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
        () => getProgressShardRecord(storage, href)?.status === 'tab-opening' &&
            sw.state().spaceFeedStorageUpdateDepth === 0,
        'initial tab-opening progress was not durable before retry timeout test',
        {timers}
    )
    const openedAt = sw.state().queuedTabMetadata.find(([tabId]) => tabId === firstTab.id)?.[1]?.openedAt
    assert.ok(openedAt > 0)

    timers.setNow(openedAt + sw.state().constants.STALE_FOREGROUND_WAIT_QUEUED_TAB_MS)
    await settleWithFakeTimers(sw.sweepStaleQueuedTabs(), timers)

    await waitFor(
        () => browser.__removedTabs.includes(firstTab.id),
        'stale foreground-wait tab was not removed',
        {timers, attempts: 20, tickMs: 100}
    )
    assert.ok(browser.__removedTabs.includes(firstTab.id))
    assert.equal(browser.__tabs.has(firstTab.id), false)
    assert.equal(sw.state().activeQueuedTabs.includes(firstTab.id), false)
    const recoveredQueue = recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
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
        () => getProgressShardRecord(storage, href)?.status === 'tab-opening' &&
            sw.state().spaceFeedStorageUpdateDepth === 0,
        'initial tab-opening progress was not durable before loading-pressure test',
        {timers}
    )

    const openedAt = sw.state().queuedTabMetadata.find(([tabId]) => tabId === firstTab.id)?.[1]?.openedAt
    assert.ok(openedAt > 0)

    timers.setNow(openedAt + sw.state().constants.STALE_BACKGROUND_OPENING_QUEUED_TAB_MS + 1)
    await settleWithFakeTimers(sw.sweepStaleQueuedTabs(), timers)

    await waitFor(
        () => browser.__removedTabs.includes(firstTab.id),
        'loading-pressure tab was not removed',
        {timers, attempts: 20, tickMs: 100}
    )
    assert.ok(browser.__removedTabs.includes(firstTab.id))
    assert.equal(browser.__tabs.has(firstTab.id), false)
    assert.equal(sw.state().activeQueuedTabs.includes(firstTab.id), false)
    const recoveredQueue = recoverProjectedState(getStoredCoordinatorQueueWal(storage)).projected.state.queue
    const walRecords = getWalRecordsForGeneration(
        getStoredCoordinatorQueueWal(storage),
        getStoredCoordinatorQueueWal(storage)?.meta?.activeCheckpoint
    )
    assert.equal(walRecords.some(record => record.operationKind === 'stale-retry'), true)
    assert.equal(getRecoveredCoordinatorQueue(storage)[href].status, 'queued')
    assert.equal(recoveredQueue[href].status, 'queued')
    assert.equal(recoveredQueue[href].retryCount || 0, 0)
    assert.equal(recoveredQueue[href].retryAttempt || 0, 0)
    assert.equal(recoveredQueue[href].loadPressureRequeueCount, 1)
    assert.ok((sw.state().queueWakeupCounters['throttle.pressure.loading-or-unscriptable-tab'] || 0) > 0)
    assert.equal(listTabs(browser).some(candidate => candidate.url === href), false)

    const throttleUntil = Number.parseInt(sw.state().queueLoadThrottle.until, 10) || timers.now
    await timers.tick(Math.max(0, throttleUntil - timers.now))
    await settleWithFakeTimers(sw.resumeCoordinatorQueueExecution({
        tabId: sourceSender.tab.id,
        windowId: sourceSender.tab.windowId
    }, {
        serviceWorkerOwned: true,
        skipRepair: true,
        skipAuthorityReconcile: true,
        awaitFill: true
    }), timers)
    await waitFor(
        () => listTabs(browser).some(candidate => candidate.url === href),
        'throttled queued row did not reopen after queue-load delay',
        {timers}
    )
})

test('queue-only stale sweep reads projected progress before load-pressure requeue', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Queue-Only-Action-Phase'
    const runId = 'run-queue-only-action-phase'
    const attemptId = 'attempt-queue-only-action-phase'
    const tabId = 909
    const now = 7000
    const progress = {
        profileHref: href,
        actionKind: 'mute-block',
        runId,
        attemptId,
        attemptNumber: 1,
        status: 'blocking',
        tabId,
        tabOpenedAt: now - 3000,
        contentOpenedAt: now - 2500,
        actionReadyAt: now - 2000,
        blockAttemptedAt: now - 1000,
        updatedAt: now - 1000
    }
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeActiveCoordinatorRow({href, runId, attemptId, tabId, now})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            ...makeProgressProjectionSeed(href, progress)
        }
    })
    await sw.coordinatorAuthority.hydrate()
    browser.__tabs.set(tabId, {
        id: tabId,
        windowId: 1,
        url: href,
        status: 'complete',
        active: true
    })
    sw.__testAddProvisionalQueuedTab(tabId, {
        profileHref: href,
        coordinatorKey: href,
        requestedUrl: href,
        tabAction: 'nuke',
        actionKind: 'mute-block',
        runId,
        ownerTabId: 'service-worker',
        noForegroundFallback: true,
        attemptId,
        attemptNumber: 1,
        maxRetries: 1,
        openedAt: now - sw.state().constants.STALE_BACKGROUND_OPENING_QUEUED_TAB_MS - 10,
        lastNudgeFailedAt: now - sw.state().constants.STALE_BACKGROUND_OPENING_QUEUED_TAB_MS - 10
    })

    await settleWithFakeTimers(
        sw.sweepStaleQueuedTabs(null, {queueOnlyAuthority: true}),
        timers,
        [0, 100, 1000]
    )

    const recoveredQueue = getRecoveredCoordinatorQueue(storage)
    assert.equal(browser.__tabs.has(tabId), true)
    assert.equal(sw.state().activeQueuedTabs.includes(tabId), true)
    assert.equal(recoveredQueue[href].status, 'active')
    assert.equal(recoveredQueue[href].attemptId, attemptId)
    assert.equal(recoveredQueue[href].loadPressureRequeueCount || 0, 0)
    assert.equal((sw.state().queueWakeupCounters['throttle.pressure.loading-or-unscriptable-tab'] || 0), 0)
})

test('stale queued fill promise is cleared so durable queue can resume', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Stale-Fill-Promise-Resume'
    const runId = 'run-stale-fill-promise-resume'
    const attemptId = 'attempt-stale-fill-promise-resume'
    const {browser, sw, storage, timers} = loadServiceWorkerHarness({
        now: 1000000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 1000000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    await activateQuoraRuntime(browser, href)
    await sw.coordinatorAuthority.hydrate()
    sw.__testSetQueuedTabFillPromise(new Promise(() => {}), 1000000 - sw.state().constants.QUEUED_TAB_IDLE_FILL_PROMISE_STALE_MS - 1)

    const result = await settleWithFakeTimers(
        sw.runCoordinatorQueueExecutorFastPath('synthetic-stale-fill-promise-resume', {
            awaitFill: true,
            skipAuthorityReconcile: true,
            forceDurableQueueReload: false
        }),
        timers,
        [0, 1000, 5000]
    )
    await flushAsync(200)
    await timers.tick(0)
    await flushAsync(200)

    assert.equal(result.fastPath, true)
    assert.equal(result.changed, true)
    assert.equal(result.queued, 1)
    assert.equal(sw.state().queuedTabFillPromise, false)
    assert.equal(sw.state().queueWakeupCounters['pump.changed.clearedStaleFillPromise'] || 0, 1)
    assert.equal(sw.state().queueWakeupCounters['pump.changed.clearedIdleStaleFillPromise'] || 0, 1)
    assert.equal(listTabs(browser).some(tab => tab.url === href), true)
    assert.ok(['opening', 'active', 'acting', 'settling'].includes(sw.coordinatorAuthority.current().queue[href]?.status))
    assert.ok(['queued', 'opening', 'active'].includes(storage.mbCoordinatorQueue[href].status))
})

test('stale coordinator reconcile promise is cleared before new reconcile tick', async () => {
    const href = 'https://www.quora.com/profile/Synthetic-Stale-Reconcile-Promise'
    const runId = 'run-stale-reconcile-promise'
    const attemptId = 'attempt-stale-reconcile-promise'
    const {sw, timers} = loadServiceWorkerHarness({
        now: 1200000,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [href]: makeQueuedCoordinatorRow({href, runId, attemptId, now: 1200000})
            },
            mbCoordinatorRuns: {
                [runId]: makeCoordinatorRun({href, runId})
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {}
        }
    })

    sw.__testSetCoordinatorReconcilePromise(new Promise(() => {}), 1200000 - sw.state().constants.COORDINATOR_IDLE_RECONCILE_PROMISE_STALE_MS - 1)
    assert.equal(sw.__testClearStaleCoordinatorReconcilePromise('synthetic-stale-reconcile-promise'), true)
    assert.equal(sw.state().coordinatorReconcilePromise, false)
    assert.equal(sw.state().queueWakeupCounters['reconcile.stalePromiseCleared'] || 0, 1)
    assert.equal(sw.state().queueWakeupCounters['reconcile.idleStalePromiseCleared'] || 0, 1)
    assert.equal(sw.state().hasCoordinatorReconcileTimeout, true)
    await timers.tick(1000)
    await flushAsync(200)
})

;(async () => {
    let failed = 0
    const filterText = `${process.env.SW_SYNTHETIC_TEST_FILTER || ''}`.trim()
    const selectedTests = filterText
        ? tests.filter(({name}) => name.includes(filterText))
        : tests
    if(filterText && !selectedTests.length) {
        throw new Error(`No swSynthetic tests matched filter: ${filterText}`)
    }
    for(const {name, fn} of selectedTests) {
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
    process.exit(0)
})()
