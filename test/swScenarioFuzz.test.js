const assert = require('node:assert/strict')
const {
    loadServiceWorkerHarness
} = require('./lib/swHarness')
const {
    checkStorageInvariants
} = require('./lib/storageInvariants')

const DEFAULT_SEEDS = [0x5eed, 0xc0de, 0x51a7e]
const DEFAULT_STEPS = 36
const TIME_JUMPS_MS = [0, 1000, 5000, 15000, 45000, 90000, 120000, 180000]

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
        },
        pick(values) {
            return values[this.int(values.length)]
        }
    }
}

async function flushAsync(rounds = 1) {
    for(let index = 0; index < rounds; index += 1) {
        await Promise.resolve()
    }
}

async function settle(env, rounds = 4) {
    for(let index = 0; index < rounds; index += 1) {
        await flushAsync(4)
        await env.timers.tick(0)
    }
}

async function settleWithFakeTimers(promise, env, steps = [0, 1000, 5000, 15000, 30000, 60000, 120000, 180000, 30000]) {
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

    for(const step of steps) {
        await settle(env, 2)
        if(settled) break
        await env.timers.tick(step)
        if(settled) break
    }

    await settle(env, 12)
    if(settledError) throw settledError
    if(!settled) throw new Error('fake-timer operation did not settle')
    return settledValue
}

async function sendMessage(env, message, sender = env.sourceSender, steps) {
    return settleWithFakeTimers(env.browser.runtime.sendMessage(message, sender), env, steps)
}

function listTabs(env) {
    return Array.from(env.browser.__tabs.values())
}

function getMetadata(env, tabId) {
    const entry = env.sw.state().queuedTabMetadata.find(([candidateId]) => candidateId === tabId)
    return entry ? entry[1] : null
}

function getActiveTabs(env) {
    const activeIds = new Set(env.sw.state().activeQueuedTabs)
    return listTabs(env).filter(tab => activeIds.has(tab.id))
}

function makeSender(tab) {
    return {tab: {id: tab.id, windowId: tab.windowId || 1, url: tab.url || ''}}
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
            pageUrl: 'https://www.quora.com/space/fuzz'
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

function makeProfileHref(seed, index) {
    return `https://www.quora.com/profile/Fuzz-${seed.toString(16)}-${index}`
}

function describeIssues(issues) {
    return issues
        .map(issue => `${issue.severity}:${issue.code}:${issue.key || issue.href || issue.runId || ''}:${issue.message || ''}`)
        .join('\n')
}

function assertScenarioInvariants(env) {
    const issues = checkStorageInvariants(env.storage)
    const errors = issues.filter(issue => issue.severity === 'error')
    assert.equal(errors.length, 0, describeIssues(errors))

    const queue = env.storage.mbCoordinatorQueue || {}
    for(const [key, item] of Object.entries(queue)) {
        if(env.storageOnlyKeys.has(key)) {
            assert.notEqual(item.executorOwner, 'service-worker', `storage-only item ${key} became service-worker-owned: ${JSON.stringify(item)}`)
            assert.notEqual(item.serviceWorkerOwned, true, `storage-only item ${key} became service-worker-owned: ${JSON.stringify(item)}`)
        }
    }

    const activeTabIds = new Set(env.sw.state().activeQueuedTabs)
    for(const tabId of activeTabIds) {
        assert.equal(env.browser.__tabs.has(tabId), true, `active queued tab ${tabId} is missing from fake browser`)
    }

    for(const [tabId, metadata] of env.sw.state().queuedTabMetadata) {
        assert.equal(env.browser.__tabs.has(tabId), true, `queued metadata remains for missing tab ${tabId}`)
        assert.ok(metadata.attemptId, `queued metadata for tab ${tabId} is missing attemptId`)
        assert.ok(metadata.attemptNumber, `queued metadata for tab ${tabId} is missing attemptNumber`)
    }
}

async function enqueueStorageOnly(env) {
    const href = makeProfileHref(env.seed, env.nextProfileIndex++)
    const runId = `run-fuzz-storage-${env.seed.toString(16)}-${env.nextRunIndex++}`
    env.trace.push(`enqueue-storage-only ${href}`)
    const result = await sendMessage(env, makeCoordinatorEnqueue({href, runId}))
    env.storageOnlyKeys.add(href)
    assert.equal(result?.executionDeferred, true, `storage-only enqueue did not return executionDeferred=true: ${JSON.stringify(result)}`)
    await settle(env)
}

async function enqueueExecutable(env) {
    const href = makeProfileHref(env.seed, env.nextProfileIndex++)
    const runId = `run-fuzz-exec-${env.seed.toString(16)}-${env.nextRunIndex++}`
    env.trace.push(`enqueue-executable ${href}`)
    await sendMessage(env, makeCoordinatorEnqueue({
        href,
        runId,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: 1 + env.prng.int(2),
            noForegroundFallback: env.prng.int(2) === 0
        }
    }))
    await settle(env, 8)
}

async function claimActiveTab(env) {
    const tabs = getActiveTabs(env)
    if(!tabs.length) return enqueueExecutable(env)

    const tab = env.prng.pick(tabs)
    env.trace.push(`claim-tab ${tab.id}`)
    await sendMessage(env, {action: 'claim-tab-action'}, makeSender(tab))
    await settle(env)
}

function makeMilestonePatch(env, metadata, stale = false) {
    const now = env.timers.now
    return {
        status: 'acting',
        actionReadyAt: now,
        muteAttemptedAt: now,
        event: stale ? 'fuzz stale milestone' : 'fuzz milestone',
        attemptId: stale ? `stale-${metadata?.attemptId || 'missing'}` : metadata?.attemptId || '',
        attemptNumber: metadata?.attemptNumber || 0,
        runId: metadata?.runId || ''
    }
}

function makeTerminalPatch(env, metadata, stale = false) {
    const now = env.timers.now
    return {
        status: 'succeeded',
        outcome: 'already-blocked',
        blockedAt: now,
        terminalAt: now,
        closeRequestedAt: now,
        tabClosedAt: now,
        closedByExtension: true,
        closeReason: stale ? 'fuzz-stale-terminal' : 'fuzz-terminal',
        event: stale ? 'fuzz stale terminal' : 'fuzz terminal',
        attemptId: stale ? `stale-${metadata?.attemptId || 'missing'}` : metadata?.attemptId || '',
        attemptNumber: metadata?.attemptNumber || 0,
        runId: metadata?.runId || ''
    }
}

async function recordMilestone(env, stale = false) {
    const tabs = getActiveTabs(env)
    if(!tabs.length) return enqueueExecutable(env)

    const tab = env.prng.pick(tabs)
    const metadata = getMetadata(env, tab.id)
    if(!metadata?.profileHref) return claimActiveTab(env)

    env.trace.push(`${stale ? 'stale-' : ''}milestone tab=${tab.id} href=${metadata.profileHref}`)
    await sendMessage(env, {
        action: 'record-job-milestone',
        profileHref: metadata.profileHref,
        patch: makeMilestonePatch(env, metadata, stale)
    }, makeSender(tab))
    await settle(env)
}

async function recordTerminal(env, stale = false) {
    const tabs = getActiveTabs(env)
    if(!tabs.length) return enqueueExecutable(env)

    const tab = env.prng.pick(tabs)
    const metadata = getMetadata(env, tab.id)
    if(!metadata?.profileHref) return claimActiveTab(env)

    env.trace.push(`${stale ? 'stale-' : ''}terminal tab=${tab.id} href=${metadata.profileHref}`)
    await sendMessage(env, {
        action: 'record-job-terminal',
        profileHref: metadata.profileHref,
        patch: makeTerminalPatch(env, metadata, stale)
    }, makeSender(tab))
    await settle(env)
}

async function removeActiveTab(env) {
    const tabs = getActiveTabs(env)
    if(!tabs.length) return enqueueExecutable(env)

    const tab = env.prng.pick(tabs)
    env.trace.push(`remove-tab ${tab.id}`)
    await env.browser.tabs.remove(tab.id)
    await settle(env, 12)
    await settleWithFakeTimers(env.sw.sweepStaleQueuedTabs(), env)
}

async function updateActiveTab(env) {
    const tabs = getActiveTabs(env)
    if(!tabs.length) return enqueueExecutable(env)

    const tab = env.prng.pick(tabs)
    const separator = (tab.url || '').includes('?') ? '&' : '?'
    env.trace.push(`update-tab ${tab.id}`)
    await env.browser.tabs.update(tab.id, {
        url: `${tab.url || 'https://www.quora.com/profile/Fuzz-Updated'}${separator}fuzz=${env.stepIndex}`
    })
    await settle(env)
}

async function pauseResumeOrCancel(env) {
    const action = env.prng.pick([
        'pause-coordinator-nukes',
        'resume-paused-coordinator-nukes',
        'cancel-coordinator-current-work',
        'reconcile-coordinator-storage',
        'resume-coordinator-queue'
    ])
    env.trace.push(action)
    await sendMessage(env, {action})
    await settle(env, 6)
}

async function advanceTime(env) {
    const amount = env.prng.pick(TIME_JUMPS_MS)
    env.trace.push(`advance-time ${amount}`)
    await env.timers.tick(amount)
    await settle(env, 4)
}

async function sweepStale(env) {
    env.trace.push('sweep-stale')
    await settleWithFakeTimers(env.sw.sweepStaleQueuedTabs(), env)
}

async function restartServiceWorker(env) {
    env.trace.push('restart-service-worker')
    const snapshot = clone(env.storage)
    const tabs = listTabs(env).map(tab => clone(tab))
    env.sw.__testDeactivateHarness?.()
    env.timers.clearAll()
    const next = loadServiceWorkerHarness({
        now: env.timers.now,
        storage: snapshot,
        disableQueueWakeupMetricsFlush: true,
        disableQueueWalCheckpointSwitch: true,
        suppressBackgroundWorkAfterDeactivate: true
    })
    let maxTabId = 99
    for(const tab of tabs) {
        next.browser.__tabs.set(tab.id, tab)
        maxTabId = Math.max(maxTabId, tab.id)
    }
    next.browser.__setNextTabId(maxTabId + 1)
    env.browser = next.browser
    env.sw = next.sw
    env.timers = next.timers
    env.storage = next.storage
    env.sourceSender = {tab: {id: 9000 + env.seed, windowId: 1}}
    await sendMessage(env, {action: 'reconcile-coordinator-storage'})
    await settle(env, 8)
}

const ACTIONS = [
    enqueueStorageOnly,
    enqueueExecutable,
    claimActiveTab,
    recordMilestone,
    recordTerminal,
    async env => recordMilestone(env, true),
    async env => recordTerminal(env, true),
    removeActiveTab,
    updateActiveTab,
    pauseResumeOrCancel,
    advanceTime,
    sweepStale,
    restartServiceWorker
]

async function runScenario(seed, steps) {
    const harness = loadServiceWorkerHarness({
        now: 100000 + seed,
        disableQueueWakeupMetricsFlush: true,
        disableQueueWalCheckpointSwitch: true,
        suppressBackgroundWorkAfterDeactivate: true
    })
    const env = {
        ...harness,
        seed,
        prng: makePrng(seed),
        trace: [],
        storageOnlyKeys: new Set(),
        nextProfileIndex: 1,
        nextRunIndex: 1,
        stepIndex: 0,
        sourceSender: {tab: {id: 8000 + seed, windowId: 1}}
    }

    try {
        for(env.stepIndex = 0; env.stepIndex < steps; env.stepIndex += 1) {
            const action = ACTIONS[env.prng.int(ACTIONS.length)]
            await action(env)
            assertScenarioInvariants(env)
        }
    }
    catch(error) {
        const wrapped = new Error(`${error.message}\nseed=0x${seed.toString(16)} step=${env.stepIndex}\ntrace:\n${env.trace.join('\n')}`)
        wrapped.cause = error
        throw wrapped
    }
    finally {
        env.sw.__testDeactivateHarness?.()
        env.timers.clearAll()
    }
}

async function main() {
    const selectedSeed = process.env.SW_SCENARIO_FUZZ_SEED || process.env.FUZZ_SEED
    const seeds = selectedSeed
        ? [parseInteger(selectedSeed, DEFAULT_SEEDS[0])]
        : DEFAULT_SEEDS
    const steps = parseInteger(process.env.SW_SCENARIO_FUZZ_STEPS || process.env.FUZZ_STEPS, DEFAULT_STEPS)
    let failed = 0

    for(const seed of seeds) {
        try {
            await runScenario(seed, steps)
            console.log(`ok - sw scenario fuzz seed=0x${seed.toString(16)} steps=${steps}`)
        }
        catch(error) {
            failed += 1
            console.error(`not ok - sw scenario fuzz seed=0x${seed.toString(16)} steps=${steps}`)
            console.error(error?.stack || error)
        }
    }

    if(failed) {
        throw new Error(`${failed} swScenarioFuzz seed${failed === 1 ? '' : 's'} failed`)
    }
}

main().catch(error => {
    console.error(error?.stack || error)
    process.exitCode = 1
})
