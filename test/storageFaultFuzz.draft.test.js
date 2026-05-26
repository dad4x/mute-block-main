const assert = require('node:assert/strict')
const {
    loadServiceWorkerHarness
} = require('./lib/swHarness')

const DEFAULT_SEEDS = [0x5eed, 0xc0de, 0x51a7e]

function clone(value) {
    if(value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
}

function parseInteger(value, fallback) {
    if(value === undefined || value === null || `${value}`.trim() === '') return fallback
    const parsed = Number.parseInt(`${value}`, 0)
    return Number.isFinite(parsed) ? parsed : fallback
}

async function flushAsync(rounds = 1) {
    for(let index = 0; index < rounds; index += 1) {
        await Promise.resolve()
    }
}

// TODO(remove-after-active-cycle): duplicated from draft progress fuzzers until
// the shared fuzz-helper shape is safe to extract.
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

function makeCoordinatorRun({href, runId}) {
    return {
        id: runId,
        sourceType: 'profile-search',
        status: 'active',
        targetProfileHrefs: [href],
        targetWorkKeys: [href]
    }
}

function makeContext(seed, label) {
    const suffix = `${seed.toString(16)}-${label}`.replace(/[^a-zA-Z0-9-]/g, '-')
    return {
        seed,
        label,
        now: 900000 + seed,
        href: `https://www.quora.com/profile/FuzzStorage-${seed.toString(16)}-${label}`,
        runId: `run-storage-fault-${suffix}`,
        attemptId: `attempt-storage-fault-${suffix}`,
        tabId: 900 + (seed % 100)
    }
}

function makeProgress(ctx, overrides = {}) {
    return {
        profileHref: ctx.href,
        status: 'tab-opened',
        runId: ctx.runId,
        tabId: ctx.tabId,
        actionKind: 'mute-block',
        attemptId: ctx.attemptId,
        attemptNumber: 1,
        updatedAt: ctx.now - 500,
        ...overrides
    }
}

function makePatch(ctx, overrides = {}) {
    return {
        status: 'blocking',
        blockAttemptedAt: ctx.now + 10,
        runId: ctx.runId,
        tabId: ctx.tabId,
        actionKind: 'mute-block',
        attemptId: ctx.attemptId,
        attemptNumber: 1,
        ...overrides
    }
}

function makeProgressHarness(ctx) {
    return loadServiceWorkerHarness({
        now: ctx.now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: {
                [ctx.href]: makeActiveCoordinatorRow(ctx)
            },
            mbCoordinatorRuns: {
                [ctx.runId]: makeCoordinatorRun(ctx)
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: {
                [ctx.href]: makeProgress(ctx)
            }
        }
    })
}

function makeAuthorityHarness(ctx) {
    return loadServiceWorkerHarness({
        now: ctx.now,
        storage: {
            mbCoordinatorQueue: {
                [ctx.href]: {
                    id: `authority-${ctx.seed.toString(16)}-${ctx.label}`,
                    status: 'active',
                    attemptId: ctx.attemptId,
                    attemptNumber: 1,
                    targetProfileHref: ctx.href,
                    updatedAt: ctx.now
                }
            }
        }
    })
}

function isProgressProjectionPayload(payload = {}) {
    const keys = Object.keys(payload || {})
    return keys.includes('mbProfileNukeProgressView') ||
        keys.some(key => key.startsWith('mbProfileNukeProgressShard.'))
}

async function assertProgressProjectionFault(seed, behavior) {
    const ctx = makeContext(seed, `progress-${behavior}`)
    const {browser, storage, sw} = makeProgressHarness(ctx)
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        if(isProgressProjectionPayload(payload)) {
            if(behavior === 'false') return false
            throw new Error(`draft projection ${behavior}`)
        }
        return originalSet(payload)
    }

    const result = await sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: ctx.href,
        patch: makePatch(ctx)
    })
    const counters = sw.state().queueWakeupCounters

    assert.equal(result.recorded, true, `projection ${behavior}: row should be accepted`)
    assert.equal(result.progressProjectionDurable, false, `projection ${behavior}: projection should be non-durable`)
    assert.equal(result.progressProjectionSuppressed, true, `projection ${behavior}: suppression flag missing`)
    assert.equal(result.progressOperation.durable, false, `projection ${behavior}: operation should be non-durable`)
    assert.equal(result.progressOperation.reason, 'projection-suppressed', `projection ${behavior}: operation reason mismatch`)
    assert.equal(result.progressShadowWal.checked, false, `projection ${behavior}: shadow WAL should not be checked`)
    assert.equal(result.progressShadowWal.matched, false, `projection ${behavior}: shadow WAL should not match`)
    assert.equal(result.progressShadowWal.reason, 'non-durable', `projection ${behavior}: shadow WAL reason mismatch`)
    assert.equal(result.progressShadowWal.skippedNonDurable, true, `projection ${behavior}: non-durable skip missing`)
    assert.equal(storage.mbProfileNukeProgressView, undefined, `projection ${behavior}: compact view should not be saved`)
    assert.equal(counters['progress.shadowWal.checked'] || 0, 0, `projection ${behavior}: non-durable row checked shadow WAL`)
    assert.equal(counters['progress.shadowWal.matched'] || 0, 0, `projection ${behavior}: non-durable row matched shadow WAL`)
    assert.equal(counters['progress.shadowWal.skippedNonDurable'] || 0, 1, `projection ${behavior}: skip counter mismatch`)
}

async function assertAuthoritySetThrows(seed) {
    const ctx = makeContext(seed, 'authority-throw')
    const {browser, storage, sw} = makeAuthorityHarness(ctx)
    await sw.coordinatorAuthority.hydrate()
    browser.storage.local.set = async () => {
        throw new Error('draft authority storage failure')
    }

    const result = await sw.coordinatorAuthority.apply({
        operationKind: 'draft-authority-throw',
        rowKey: ctx.href,
        expectedAttemptId: ctx.attemptId,
        mutate(row, operationContext) {
            return {
                ...row,
                status: 'failed',
                error: 'draft authority failed',
                updatedAt: operationContext.now
            }
        }
    })

    assert.equal(result.accepted, true)
    assert.equal(result.changed, true)
    assert.equal(result.durable, false)
    assert.equal(result.reason, 'persistence-error')
    assert.equal(result.persistence.saved, false)
    assert.match(result.persistence.error, /draft authority storage failure/)
    assert.equal(result.operation.durable, false)
    assert.equal(result.shadowWal.checked, false)
    assert.equal(result.shadowWal.matched, false)
    assert.equal(result.shadowWal.reason, 'non-durable')
    assert.equal(storage.mbCoordinatorQueue[ctx.href].status, 'active')
    assert.equal(sw.coordinatorAuthority.current().queue[ctx.href].status, 'active')
}

async function assertAuthorityTimeout(seed) {
    const ctx = makeContext(seed, 'authority-timeout')
    const {browser, storage, sw, timers} = makeAuthorityHarness(ctx)
    await sw.coordinatorAuthority.hydrate()
    browser.storage.local.set = async () => new Promise(() => {})

    const resultPromise = sw.coordinatorAuthority.apply({
        operationKind: 'draft-authority-timeout',
        rowKey: ctx.href,
        expectedAttemptId: ctx.attemptId,
        timeoutMs: 1000,
        mutate(row, operationContext) {
            return {
                ...row,
                status: 'failed',
                error: 'draft authority timed out',
                updatedAt: operationContext.now
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
    assert.equal(storage.mbCoordinatorQueue[ctx.href].status, 'active')
    const counters = sw.state().queueWakeupCounters
    assert.equal(counters['storageUpdate.timedOut'], 1)
    assert.equal(counters['storageUpdate.fallbackReturned'], 1)
}

async function assertSerializedTailWaitsForRealCompletion(seed) {
    const {sw, storage, timers} = loadServiceWorkerHarness({now: seed})
    let secondRan = false
    let finishFirst = null
    let lateWriteResult = 'not-run'

    const first = sw.enqueueSpaceFeedStorageUpdate(
        async () => {
            await new Promise(resolve => {
                finishFirst = resolve
            })
            lateWriteResult = await sw.metricStorageSet({mbDraftLateWriteProbe: seed})
            return 'first-late-ok'
        },
        {timeoutMs: 1000, failureValue: 'timed-out'}
    )

    await flushAsync(20)
    assert.equal(typeof finishFirst, 'function')
    await timers.tick(1000)
    assert.equal(await first, 'timed-out')
    assert.equal(storage.mbDraftLateWriteProbe, undefined)

    const second = sw.enqueueSpaceFeedStorageUpdate(
        () => {
            secondRan = true
            return 'second-ok'
        },
        {timeoutMs: 1000}
    )

    await Promise.resolve()
    await timers.tick(1000)
    assert.equal(await second, false)
    assert.equal(secondRan, false)

    finishFirst()
    await flushAsync(20)
    assert.equal(lateWriteResult, false)
    assert.equal(storage.mbDraftLateWriteProbe, undefined)

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
}

async function runSeed(seed) {
    const cases = [
        ['projection-false', () => assertProgressProjectionFault(seed, 'false')],
        ['projection-throw', () => assertProgressProjectionFault(seed, 'throw')],
        ['authority-throw', () => assertAuthoritySetThrows(seed)],
        ['authority-timeout', () => assertAuthorityTimeout(seed)],
        ['serialized-tail', () => assertSerializedTailWaitsForRealCompletion(seed)]
    ]
    const failures = []

    for(const [name, fn] of cases) {
        try {
            await fn()
            console.log(`ok - storage fault draft fuzz seed=0x${seed.toString(16)} ${name}`)
        }
        catch(error) {
            failures.push({name, error})
            console.error(`not ok - storage fault draft fuzz seed=0x${seed.toString(16)} ${name}`)
            console.error(error?.stack || error)
        }
    }

    if(failures.length) {
        throw new Error(`${failures.length} storage fault case${failures.length === 1 ? '' : 's'} failed for seed=0x${seed.toString(16)}`)
    }
}

async function main() {
    const selectedSeed = process.env.STORAGE_FAULT_FUZZ_SEED || process.env.FUZZ_SEED
    const seeds = selectedSeed
        ? [parseInteger(selectedSeed, DEFAULT_SEEDS[0])]
        : DEFAULT_SEEDS
    let failed = 0

    for(const seed of seeds) {
        try {
            await runSeed(seed)
        }
        catch(error) {
            failed += 1
            console.error(`not ok - storage fault draft fuzz seed=0x${seed.toString(16)}`)
            console.error(error?.stack || error)
        }
    }

    if(failed) {
        throw new Error(`${failed} storage fault draft fuzz seed${failed === 1 ? '' : 's'} failed`)
    }
}

main().catch(error => {
    console.error(error?.stack || error)
    process.exitCode = 1
})
