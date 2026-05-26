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

// TODO(remove-after-active-cycle): duplicated from the progress-operation
// draft fuzzer so this file can remain independent of active shared tests.
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

function makeRun(runId, hrefs) {
    return {
        id: runId,
        sourceType: 'profile-search',
        status: 'active',
        targetProfileHrefs: hrefs,
        targetWorkKeys: hrefs
    }
}

function makeHref(seed, index, label) {
    return `https://www.quora.com/profile/FuzzBatch-${seed.toString(16)}-${index}-${label}`
}

function makeProgress(ctx, label, overrides = {}) {
    return {
        profileHref: ctx.hrefs[label],
        status: 'tab-opened',
        runId: ctx.runId,
        tabId: ctx.tabIds[label],
        actionKind: 'mute-block',
        attemptId: ctx.attemptIds[label],
        attemptNumber: 1,
        updatedAt: ctx.now - 500,
        ...overrides
    }
}

function makePatch(ctx, label, overrides = {}) {
    return {
        status: 'page-ready',
        actionReadyAt: ctx.now + 10,
        runId: ctx.runId,
        tabId: ctx.tabIds[label],
        actionKind: 'mute-block',
        attemptId: ctx.attemptIds[label],
        attemptNumber: 1,
        lastUrl: `${ctx.hrefs[label]}?draft=batch`,
        ...overrides
    }
}

function makeContext(seed) {
    const labels = ['accepted', 'noop', 'stale', 'terminal', 'durableOnly', 'missing']
    const hrefs = Object.fromEntries(labels.map((label, index) => [label, makeHref(seed, index, label)]))
    const attemptIds = Object.fromEntries(labels.map(label => [label, `attempt-batch-${seed.toString(16)}-${label}`]))
    const tabIds = Object.fromEntries(labels.map((label, index) => [label, 700 + index]))
    return {
        seed,
        now: 700000 + seed,
        runId: `run-progress-batch-${seed.toString(16)}`,
        labels,
        hrefs,
        attemptIds,
        tabIds
    }
}

function makeHarness(ctx, options = {}) {
    const queue = {
        [ctx.hrefs.accepted]: makeActiveCoordinatorRow({
            href: ctx.hrefs.accepted,
            runId: ctx.runId,
            attemptId: ctx.attemptIds.accepted,
            tabId: ctx.tabIds.accepted,
            now: ctx.now
        }),
        [ctx.hrefs.noop]: makeActiveCoordinatorRow({
            href: ctx.hrefs.noop,
            runId: ctx.runId,
            attemptId: ctx.attemptIds.noop,
            tabId: ctx.tabIds.noop,
            now: ctx.now
        }),
        [ctx.hrefs.stale]: makeActiveCoordinatorRow({
            href: ctx.hrefs.stale,
            runId: ctx.runId,
            attemptId: ctx.attemptIds.stale,
            tabId: ctx.tabIds.stale,
            now: ctx.now
        }),
        [ctx.hrefs.terminal]: {
            ...makeActiveCoordinatorRow({
                href: ctx.hrefs.terminal,
                runId: ctx.runId,
                attemptId: ctx.attemptIds.terminal,
                tabId: null,
                now: ctx.now
            }),
            status: 'succeeded',
            outcome: 'blocked',
            terminalAt: ctx.now - 100,
            updatedAt: ctx.now - 100,
            actionLease: null
        },
        [ctx.hrefs.durableOnly]: (() => {
            const row = makeActiveCoordinatorRow({
                href: ctx.hrefs.durableOnly,
                runId: ctx.runId,
                attemptId: ctx.attemptIds.durableOnly,
                tabId: ctx.tabIds.durableOnly,
                now: ctx.now
            })
            delete row.executorOwner
            delete row.serviceWorkerOwned
            return row
        })()
    }
    const progress = {
        [ctx.hrefs.accepted]: makeProgress(ctx, 'accepted', {status: 'tab-opened'}),
        [ctx.hrefs.noop]: makeProgress(ctx, 'noop', {
            status: 'page-ready',
            actionReadyAt: ctx.now - 100,
            lastUrl: `${ctx.hrefs.noop}?draft=batch`
        }),
        [ctx.hrefs.stale]: makeProgress(ctx, 'stale'),
        [ctx.hrefs.terminal]: makeProgress(ctx, 'terminal', {
            status: 'blocked',
            blockSucceeded: true,
            blockedAt: ctx.now - 100,
            terminalAt: ctx.now - 100,
            updatedAt: ctx.now - 100,
            tabId: null
        }),
        [ctx.hrefs.durableOnly]: makeProgress(ctx, 'durableOnly'),
        [ctx.hrefs.missing]: makeProgress(ctx, 'missing')
    }

    const env = loadServiceWorkerHarness({
        now: ctx.now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: queue,
            mbCoordinatorRuns: {
                [ctx.runId]: makeRun(ctx.runId, Object.values(ctx.hrefs))
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgress: progress
        }
    })

    if(options.suppressProgressProjection) {
        const originalSet = env.browser.storage.local.set.bind(env.browser.storage.local)
        env.browser.storage.local.set = async payload => {
            const keys = Object.keys(payload || {})
            if(keys.includes('mbProfileNukeProgressView') ||
                keys.some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
                return false
            }
            return originalSet(payload)
        }
    }

    for(const label of ['accepted', 'noop', 'stale', 'durableOnly']) {
        env.sw.__testAddProvisionalQueuedTab(ctx.tabIds[label], {
            profileHref: ctx.hrefs[label],
            coordinatorKey: ctx.hrefs[label],
            requestedUrl: ctx.hrefs[label],
            actionKind: 'mute-block',
            runId: ctx.runId,
            attemptId: ctx.attemptIds[label],
            attemptNumber: 1,
            lastProgressAt: ctx.now - 500
        })
    }

    return env
}

function summarize(result) {
    return JSON.stringify({
        recorded: result?.recorded,
        durable: result?.durable,
        reason: result?.reason,
        operation: result?.progressOperation && {
            accepted: result.progressOperation.accepted,
            changed: result.progressOperation.changed,
            durable: result.progressOperation.durable,
            reason: result.progressOperation.reason
        },
        shadow: result?.progressShadowWal && {
            checked: result.progressShadowWal.checked,
            matched: result.progressShadowWal.matched,
            reason: result.progressShadowWal.reason,
            skippedNoChange: result.progressShadowWal.skippedNoChange,
            skippedNonDurable: result.progressShadowWal.skippedNonDurable
        }
    })
}

async function runMixedBatch(seed, options = {}) {
    const ctx = makeContext(seed)
    const env = makeHarness(ctx, options)
    const beforeCounters = clone(env.sw.state().queueWakeupCounters)
    const promises = {
        accepted: env.sw.recordDeferredCoordinatorJobMilestone(
            ctx.hrefs.accepted,
            makePatch(ctx, 'accepted'),
            {senderTabId: ctx.tabIds.accepted}
        ),
        noop: env.sw.recordDeferredCoordinatorJobMilestone(
            ctx.hrefs.noop,
            makePatch(ctx, 'noop', {
                actionReadyAt: ctx.now - 100
            }),
            {senderTabId: ctx.tabIds.noop}
        ),
        stale: env.sw.recordDeferredCoordinatorJobMilestone(
            ctx.hrefs.stale,
            makePatch(ctx, 'stale', {
                attemptId: `stale-${ctx.attemptIds.stale}`
            }),
            {senderTabId: ctx.tabIds.stale}
        ),
        terminal: env.sw.recordDeferredCoordinatorJobMilestone(
            ctx.hrefs.terminal,
            makePatch(ctx, 'terminal', {
                status: 'blocking',
                blockAttemptedAt: ctx.now + 20,
                tabId: undefined
            })
        ),
        durableOnly: env.sw.recordDeferredCoordinatorJobMilestone(
            ctx.hrefs.durableOnly,
            makePatch(ctx, 'durableOnly'),
            {senderTabId: ctx.tabIds.durableOnly}
        ),
        missing: env.sw.recordDeferredCoordinatorJobMilestone(
            ctx.hrefs.missing,
            makePatch(ctx, 'missing')
        )
    }
    const entries = await Promise.all(Object.entries(promises).map(async ([label, promise]) => [label, await promise]))
    const results = Object.fromEntries(entries)
    const afterCounters = clone(env.sw.state().queueWakeupCounters)
    return {ctx, env, results, beforeCounters, afterCounters}
}

function assertRejected(label, result, expectedReason, context) {
    assert.equal(result.recorded, false, `${context}: ${label} should be rejected: ${summarize(result)}`)
    assert.equal(result.durable, false, `${context}: ${label} should not be durable: ${summarize(result)}`)
    assert.equal(result.reason, expectedReason, `${context}: ${label} reason mismatch: ${summarize(result)}`)
    assert.notEqual(result.progressOperation?.accepted, true, `${context}: ${label} inherited accepted operation`)
    assert.notEqual(result.progressProjectionDurable, true, `${context}: ${label} inherited projection durability`)
    assert.notEqual(result.progressShadowWal?.matched, true, `${context}: ${label} inherited shadow WAL match`)
}

function assertMixedBatch({ctx, env, results, beforeCounters, afterCounters}, options = {}) {
    const context = `${options.name || 'mixed'} seed=0x${ctx.seed.toString(16)}`
    const durableExpected = options.suppressProgressProjection !== true

    assert.equal(results.accepted.recorded, true, `${context}: accepted row should record: ${summarize(results.accepted)}`)
    assert.equal(results.accepted.progressProjectionDurable, durableExpected, `${context}: accepted projection durability mismatch`)
    assert.equal(results.accepted.progressOperation.durable, durableExpected, `${context}: accepted operation durability mismatch`)
    assert.equal(results.noop.recorded, true, `${context}: no-op row should record: ${summarize(results.noop)}`)
    assert.equal(results.noop.progressProjectionDurable, durableExpected, `${context}: no-op projection durability mismatch`)
    assert.equal(results.noop.progressOperation.durable, durableExpected, `${context}: no-op operation durability mismatch`)
    assert.equal(results.noop.progressOperation.changed, false, `${context}: no-op should not be changed`)

    assertRejected('stale', results.stale, 'stale-attempt', context)
    assertRejected('terminal', results.terminal, 'terminal-row-preserved', context)
    assertRejected('durableOnly', results.durableOnly, 'durable-only-coordinator-item', context)
    assertRejected('missing', results.missing, 'missing-coordinator-item', context)

    assert.equal(env.storage.mbProfileNukeProgress[ctx.hrefs.stale].status, 'tab-opened', `${context}: stale row mutated storage`)
    assert.equal(env.storage.mbProfileNukeProgress[ctx.hrefs.terminal].status, 'blocked', `${context}: terminal row regressed storage`)
    assert.equal(env.sw.state().profileNukeProgress[ctx.hrefs.missing]?.status, 'tab-opened', `${context}: missing row should not be accepted`)

    const acceptedDelta = (afterCounters['rowEvent.queued-progress-milestone.accepted'] || 0) -
        (beforeCounters['rowEvent.queued-progress-milestone.accepted'] || 0)
    const staleDelta = (afterCounters['rowEvent.queued-progress-milestone.rejected.staleAttempt'] || 0) -
        (beforeCounters['rowEvent.queued-progress-milestone.rejected.staleAttempt'] || 0)
    const terminalDelta = (afterCounters['rowEvent.queued-progress-milestone.rejected.terminalRowPreserved'] || 0) -
        (beforeCounters['rowEvent.queued-progress-milestone.rejected.terminalRowPreserved'] || 0)
    const durableOnlyDelta = (afterCounters['rowEvent.queued-progress-milestone.rejected.durableOnlyCoordinatorItem'] || 0) -
        (beforeCounters['rowEvent.queued-progress-milestone.rejected.durableOnlyCoordinatorItem'] || 0)
    const missingDelta = (afterCounters['rowEvent.queued-progress-milestone.rejected.missingCoordinatorItem'] || 0) -
        (beforeCounters['rowEvent.queued-progress-milestone.rejected.missingCoordinatorItem'] || 0)
    const receivedDelta = (afterCounters['rowEvent.queued-progress-milestone.received'] || 0) -
        (beforeCounters['rowEvent.queued-progress-milestone.received'] || 0)

    assert.equal(receivedDelta, 6, `${context}: expected six row events in the flush`)
    assert.equal(acceptedDelta, 2, `${context}: accepted counter should count accepted rows only`)
    assert.equal(staleDelta, 1, `${context}: stale rejection counter mismatch`)
    assert.equal(terminalDelta, 1, `${context}: terminal rejection counter mismatch`)
    assert.equal(durableOnlyDelta, 1, `${context}: durable-only rejection counter mismatch`)
    assert.equal(missingDelta, 1, `${context}: missing rejection counter mismatch`)

    if(options.suppressProgressProjection === true) {
        assert.equal(results.accepted.progressShadowWal.reason, 'non-durable', `${context}: accepted non-durable reason mismatch`)
        assert.equal(results.noop.progressShadowWal.reason, 'non-durable', `${context}: no-op non-durable reason mismatch`)
        assert.equal(afterCounters['progress.shadowWal.checked'] || 0, beforeCounters['progress.shadowWal.checked'] || 0, `${context}: non-durable batch checked shadow WAL`)
        assert.equal(
            (afterCounters['progress.shadowWal.skippedNonDurable'] || 0) -
                (beforeCounters['progress.shadowWal.skippedNonDurable'] || 0),
            2,
            `${context}: non-durable skip counter should count accepted rows`
        )
    }
    else {
        assert.equal(results.accepted.progressShadowWal.checked, true, `${context}: accepted durable row should check shadow WAL`)
        assert.equal(results.accepted.progressShadowWal.matched, true, `${context}: accepted durable row should match shadow WAL`)
        assert.equal(results.noop.progressShadowWal.checked, false, `${context}: no-op should not check shadow WAL`)
        assert.equal(results.noop.progressShadowWal.reason, 'no-change', `${context}: no-op reason mismatch`)
        assert.equal(
            (afterCounters['progress.shadowWal.appended'] || 0) -
                (beforeCounters['progress.shadowWal.appended'] || 0),
            1,
            `${context}: only changed accepted row should append shadow WAL`
        )
    }
}

async function runSeed(seed) {
    assertMixedBatch(await runMixedBatch(seed), {name: 'durable'})
    console.log(`ok - progress batch draft fuzz seed=0x${seed.toString(16)} durable-mixed`)
    assertMixedBatch(await runMixedBatch(seed + 0x1000, {suppressProgressProjection: true}), {
        name: 'suppressed',
        suppressProgressProjection: true
    })
    console.log(`ok - progress batch draft fuzz seed=0x${seed.toString(16)} suppressed-mixed`)
}

async function main() {
    const selectedSeed = process.env.PROGRESS_BATCH_FUZZ_SEED || process.env.FUZZ_SEED
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
            console.error(`not ok - progress batch draft fuzz seed=0x${seed.toString(16)}`)
            console.error(error?.stack || error)
        }
    }

    if(failed) {
        throw new Error(`${failed} progress batch draft fuzz seed${failed === 1 ? '' : 's'} failed`)
    }
}

main().catch(error => {
    console.error(error?.stack || error)
    process.exitCode = 1
})
