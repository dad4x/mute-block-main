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

function makePrng(seed) {
    let state = seed >>> 0
    return {
        next() {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0
            return state / 0x100000000
        },
        int(max) {
            return Math.floor(this.next() * max)
        }
    }
}

function shuffle(values, prng) {
    const copy = [...values]
    for(let index = copy.length - 1; index > 0; index -= 1) {
        const swap = prng.int(index + 1)
        const value = copy[index]
        copy[index] = copy[swap]
        copy[swap] = value
    }
    return copy
}

// TODO(remove-after-active-cycle): copied from swSynthetic.test.js so this
// draft fuzzer does not edit active shared test helpers.
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

// TODO(remove-after-active-cycle): copied from swSynthetic.test.js so this
// draft fuzzer can stay standalone until the active test cycle clears.
function makeCoordinatorRun({href, runId}) {
    return {
        id: runId,
        sourceType: 'profile-search',
        status: 'active',
        targetProfileHrefs: [href],
        targetWorkKeys: [href]
    }
}

function makeContext(seed, caseIndex, name) {
    const suffix = `${seed.toString(16)}-${caseIndex}-${name}`.replace(/[^a-zA-Z0-9-]/g, '-')
    const profileSlug = `FuzzProgress-${seed.toString(16)}-${caseIndex}`
    return {
        seed,
        caseIndex,
        name,
        now: 100000 + (caseIndex * 1000),
        href: `https://www.quora.com/profile/${profileSlug}`,
        runId: `run-progress-${suffix}`,
        attemptId: `attempt-progress-${suffix}`,
        staleAttemptId: `stale-progress-${suffix}`,
        tabId: 600 + caseIndex
    }
}

function makePrevious(ctx, overrides = {}) {
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

function makeProgressProjection(records = {}) {
    return {
        version: 2,
        updatedAt: Date.now(),
        records,
        total: Object.keys(records).length,
        recordLimit: 500,
        truncated: false
    }
}

function getProgressShardKey(profileHref = '') {
    let hash = 0
    for(let index = 0; index < profileHref.length; index += 1) {
        hash = ((hash * 31) + profileHref.charCodeAt(index)) >>> 0
    }
    return `mbProfileNukeProgressShard.${(hash % 32).toString(16).padStart(2, '0')}`
}

function makeProgressShardPayload(records = {}, now = Date.now()) {
    const payload = {}
    for(const [href, record] of Object.entries(records)) {
        const key = getProgressShardKey(href)
        if(!payload[key]) payload[key] = {version: 1, updatedAt: now, records: {}}
        payload[key].records[href] = record
    }
    return payload
}

function makeHarness(ctx, options = {}) {
    const queueRow = options.queueRow === undefined
        ? makeActiveCoordinatorRow(ctx)
        : options.queueRow
    const queue = queueRow
        ? {[ctx.href]: queueRow}
        : {}
    const progressRecord = options.previousProgress === undefined
        ? makePrevious(ctx)
        : options.previousProgress
    const progress = progressRecord
        ? {[ctx.href]: progressRecord}
        : {}

    return loadServiceWorkerHarness({
        now: ctx.now,
        storage: {
            mbCoordinatorPaused: false,
            mbCoordinatorQueue: queue,
            mbCoordinatorRuns: {
                [ctx.runId]: makeCoordinatorRun(ctx)
            },
            mbCoordinatorEvents: [],
            mbProfileNukeProgressView: makeProgressProjection(progress),
            ...makeProgressShardPayload(progress, ctx.now)
        }
    })
}

function suppressProgressProjection(browser) {
    const originalSet = browser.storage.local.set.bind(browser.storage.local)
    browser.storage.local.set = async payload => {
        const keys = Object.keys(payload || {})
        if(keys.includes('mbProfileNukeProgressView') ||
            keys.some(key => key.startsWith('mbProfileNukeProgressShard.'))) {
            return false
        }
        return originalSet(payload)
    }
}

function summarizeResult(result) {
    return JSON.stringify({
        recorded: result?.recorded,
        reason: result?.reason,
        progressProjectionDurable: result?.progressProjectionDurable,
        progressOperation: result?.progressOperation && {
            accepted: result.progressOperation.accepted,
            changed: result.progressOperation.changed,
            durable: result.progressOperation.durable,
            reason: result.progressOperation.reason,
            rowKey: result.progressOperation.rowKey,
            previousStatus: result.progressOperation.previousRecord?.status,
            nextStatus: result.progressOperation.nextRecord?.status
        },
        progressShadowWal: result?.progressShadowWal && {
            checked: result.progressShadowWal.checked,
            matched: result.progressShadowWal.matched,
            reason: result.progressShadowWal.reason,
            skippedNoChange: result.progressShadowWal.skippedNoChange,
            skippedNonDurable: result.progressShadowWal.skippedNonDurable,
            appended: result.progressShadowWal.append?.appended
        }
    })
}

function assertNoAcceptedOperation(result, expectedReason, label) {
    assert.equal(result.recorded, false, `${label}: rejected row should not be recorded: ${summarizeResult(result)}`)
    assert.equal(result.reason, expectedReason, `${label}: rejected reason mismatch: ${summarizeResult(result)}`)
    assert.notEqual(result.progressOperation?.accepted, true, `${label}: rejected row inherited accepted operation`)
    assert.notEqual(result.progressProjectionDurable, true, `${label}: rejected row inherited projection durability`)
    assert.notEqual(result.progressShadowWal?.matched, true, `${label}: rejected row inherited shadow WAL match`)
}

async function runCase(ctx, descriptor) {
    const env = makeHarness(ctx, descriptor.setup(ctx))
    if(descriptor.wrapStorage) descriptor.wrapStorage(env, ctx)
    if(descriptor.before) await descriptor.before(env, ctx)
    const beforeCounters = clone(env.sw.state().queueWakeupCounters)
    const result = await env.sw.applyCoordinatorRowEvent({
        eventKind: 'queued-progress-milestone',
        profileHref: ctx.href,
        patch: descriptor.patch(ctx, env)
    })
    const afterCounters = clone(env.sw.state().queueWakeupCounters)

    descriptor.assert({
        ctx,
        env,
        result,
        beforeCounters,
        afterCounters,
        label: `${descriptor.name} seed=0x${ctx.seed.toString(16)} case=${ctx.caseIndex}`
    })
}

const CASES = [
    {
        name: 'accepted-changed-action-phase',
        setup: ctx => ({
            previousProgress: makePrevious(ctx, {status: 'page-ready', actionReadyAt: ctx.now - 100})
        }),
        patch: ctx => makePatch(ctx),
        assert({ctx, result, label}) {
            assert.equal(result.recorded, true, `${label}: expected accepted changed row`)
            assert.equal(result.progressProjectionDurable, true, `${label}: changed row should persist compact projection`)
            assert.equal(result.progressOperation.accepted, true, `${label}: operation should be accepted`)
            assert.equal(result.progressOperation.changed, true, `${label}: operation should be changed`)
            assert.equal(result.progressOperation.durable, true, `${label}: operation should be durable`)
            assert.equal(result.progressOperation.rowKey, ctx.href, `${label}: operation row key mismatch`)
            assert.equal(result.progressOperation.previousRecord.status, 'page-ready', `${label}: previous status mismatch`)
            assert.equal(result.progressOperation.nextRecord.status, 'blocking', `${label}: next status mismatch`)
            assert.equal(result.progressShadowWal.checked, true, `${label}: changed durable row should check shadow WAL`)
            assert.equal(result.progressShadowWal.matched, true, `${label}: changed durable row should match shadow WAL`)
            assert.equal(result.progressShadowWal.append.appended, true, `${label}: changed durable row should append shadow WAL`)
        }
    },
    {
        name: 'accepted-no-op',
        setup: ctx => ({
            previousProgress: makePrevious(ctx, {status: 'page-ready', actionReadyAt: ctx.now - 100})
        }),
        async before(env, ctx) {
            // TODO(remove-after-active-cycle): this intentionally duplicates the
            // existing single-case no-op shape after one accepted row mutation.
            env.__draftFirstResult = await env.sw.applyCoordinatorRowEvent({
                eventKind: 'queued-progress-milestone',
                profileHref: ctx.href,
                patch: makePatch(ctx)
            })
            assert.equal(
                env.__draftFirstResult.recorded,
                true,
                `draft no-op setup mutation should be accepted: ${summarizeResult(env.__draftFirstResult)}`
            )
        },
        patch: (ctx, env) => clone(env.storage.mbProfileNukeProgressView.records[ctx.href]),
        assert({result, beforeCounters, afterCounters, label}) {
            assert.equal(result.recorded, true, `${label}: no-op row should still be accepted`)
            assert.equal(result.progressProjectionDurable, true, `${label}: no-op projection should be durable`)
            assert.equal(result.progressOperation.accepted, true, `${label}: no-op operation should be accepted`)
            assert.equal(result.progressOperation.changed, false, `${label}: no-op operation should not be changed`)
            assert.equal(result.progressShadowWal.checked, false, `${label}: no-op should not check shadow WAL`)
            assert.equal(result.progressShadowWal.reason, 'no-change', `${label}: no-op reason mismatch`)
            assert.equal(result.progressShadowWal.skippedNoChange, true, `${label}: no-op should record skippedNoChange`)
            assert.equal(
                (afterCounters['progress.shadowWal.checked'] || 0) -
                    (beforeCounters['progress.shadowWal.checked'] || 0),
                0,
                `${label}: no-op inflated shadow WAL checked`
            )
            assert.equal(
                (afterCounters['progress.shadowWal.matched'] || 0) -
                    (beforeCounters['progress.shadowWal.matched'] || 0),
                0,
                `${label}: no-op inflated shadow WAL matched`
            )
            assert.equal(
                (afterCounters['progress.shadowWal.appended'] || 0) -
                    (beforeCounters['progress.shadowWal.appended'] || 0),
                0,
                `${label}: no-op inflated shadow WAL appended`
            )
        }
    },
    {
        name: 'stale-attempt',
        setup: ctx => ({
            previousProgress: makePrevious(ctx)
        }),
        patch: ctx => makePatch(ctx, {attemptId: ctx.staleAttemptId}),
        assert({result, label}) {
            assertNoAcceptedOperation(result, 'stale-attempt', label)
        }
    },
    {
        name: 'terminal-row-preserved',
        setup: ctx => ({
            queueRow: {
                ...makeActiveCoordinatorRow(ctx),
                status: 'succeeded',
                outcome: 'blocked',
                terminalAt: ctx.now - 100,
                updatedAt: ctx.now - 100,
                tabId: null,
                actionLease: null
            },
            previousProgress: makePrevious(ctx, {
                status: 'blocked',
                blockSucceeded: true,
                blockedAt: ctx.now - 100,
                terminalAt: ctx.now - 100,
                updatedAt: ctx.now - 100,
                tabId: null
            })
        }),
        patch: ctx => {
            const patch = makePatch(ctx, {status: 'blocking'})
            delete patch.tabId
            return patch
        },
        assert({result, label}) {
            assertNoAcceptedOperation(result, 'terminal-row-preserved', label)
        }
    },
    {
        name: 'action-kind-mismatch',
        setup: ctx => ({
            previousProgress: makePrevious(ctx)
        }),
        patch: ctx => makePatch(ctx, {actionKind: 'unblock-unmute'}),
        assert({result, label}) {
            assertNoAcceptedOperation(result, 'action-kind-mismatch', label)
        }
    },
    {
        name: 'durable-only-coordinator-item',
        setup: ctx => {
            const row = makeActiveCoordinatorRow(ctx)
            delete row.executorOwner
            delete row.serviceWorkerOwned
            return {
                queueRow: row,
                previousProgress: makePrevious(ctx)
            }
        },
        patch: ctx => makePatch(ctx),
        assert({result, label}) {
            assertNoAcceptedOperation(result, 'durable-only-coordinator-item', label)
        }
    },
    {
        name: 'missing-coordinator-item',
        setup: ctx => ({
            queueRow: null,
            previousProgress: makePrevious(ctx)
        }),
        patch: ctx => makePatch(ctx),
        assert({result, label}) {
            assertNoAcceptedOperation(result, 'missing-coordinator-item', label)
        }
    },
    {
        name: 'projection-suppressed',
        setup: ctx => ({
            previousProgress: makePrevious(ctx, {status: 'tab-opened'})
        }),
        wrapStorage(env) {
            suppressProgressProjection(env.browser)
        },
        patch: ctx => makePatch(ctx),
        assert({ctx, env, result, afterCounters, label}) {
            assert.equal(result.recorded, true, `${label}: suppressed projection row should still be accepted`)
            assert.equal(result.progressProjectionDurable, false, `${label}: projection should be non-durable`)
            assert.equal(result.progressProjectionSuppressed, true, `${label}: projection suppression flag missing`)
            assert.equal(result.progressOperation.accepted, true, `${label}: operation should be accepted`)
            assert.equal(result.progressOperation.changed, true, `${label}: suppressed row should still be changed`)
            assert.equal(result.progressOperation.durable, false, `${label}: operation should be non-durable`)
            assert.equal(result.progressOperation.reason, 'projection-suppressed', `${label}: operation reason mismatch`)
            assert.equal(result.progressOperation.rowKey, ctx.href, `${label}: operation row key mismatch`)
            assert.equal(result.progressShadowWal.checked, false, `${label}: non-durable row should not check shadow WAL`)
            assert.equal(result.progressShadowWal.matched, false, `${label}: non-durable row should not match shadow WAL`)
            assert.equal(result.progressShadowWal.reason, 'non-durable', `${label}: shadow WAL reason mismatch`)
            assert.equal(result.progressShadowWal.skippedNonDurable, true, `${label}: non-durable skip flag missing`)
            assert.equal(env.storage.mbProfileNukeProgressView.records[ctx.href].status, 'tab-opened', `${label}: compact view should not save changed row`)
            assert.equal(afterCounters['progress.shadowWal.checked'] || 0, 0, `${label}: non-durable row inflated checked`)
            assert.equal(afterCounters['progress.shadowWal.matched'] || 0, 0, `${label}: non-durable row inflated matched`)
            assert.equal(afterCounters['progress.shadowWal.skippedNonDurable'] || 0, 1, `${label}: non-durable counter mismatch`)
        }
    }
]

async function runSeed(seed) {
    const prng = makePrng(seed)
    const cases = shuffle(CASES, prng)
    for(let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
        const descriptor = cases[caseIndex]
        const ctx = makeContext(seed, caseIndex, descriptor.name)
        try {
            await runCase(ctx, descriptor)
            console.log(`ok - progress operation draft fuzz seed=0x${seed.toString(16)} case=${caseIndex} ${descriptor.name}`)
        }
        catch(error) {
            const wrapped = new Error([
                error.message,
                `seed=0x${seed.toString(16)}`,
                `case=${caseIndex}`,
                `name=${descriptor.name}`,
                `href=${ctx.href}`,
                `attemptId=${ctx.attemptId}`,
                `staleAttemptId=${ctx.staleAttemptId}`,
                `tabId=${ctx.tabId}`
            ].join('\n'))
            wrapped.cause = error
            throw wrapped
        }
    }
}

async function main() {
    const selectedSeed = process.env.PROGRESS_OPERATION_FUZZ_SEED || process.env.FUZZ_SEED
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
            console.error(`not ok - progress operation draft fuzz seed=0x${seed.toString(16)}`)
            console.error(error?.stack || error)
        }
    }

    if(failed) {
        throw new Error(`${failed} progress operation draft fuzz seed${failed === 1 ? '' : 's'} failed`)
    }
}

main().catch(error => {
    console.error(error?.stack || error)
    process.exitCode = 1
})
