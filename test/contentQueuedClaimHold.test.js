const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Covers the content-side hold for worker claims pushed while a tab is busy (review-2 C-2). The helpers run for real in a VM
// context, with the action runner and page helpers stubbed. The wiring around them (claim block, finally, close paths) is
// checked by source order, because running the whole action runner needs the full page.

async function test(name, fn) {
    try {
        await fn()
        console.log(`ok - ${name}`)
    }
    catch(error) {
        console.error(`not ok - ${name}`)
        throw error
    }
}

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature)
    assert.notEqual(start, -1, `missing ${signature}`)

    const braceStart = source.indexOf('{', start + signature.length)
    assert.notEqual(braceStart, -1, `missing body for ${signature}`)

    let depth = 0
    for(let index = braceStart; index < source.length; index += 1) {
        if(source[index] === '{') depth += 1
        else if(source[index] === '}') {
            depth -= 1
            if(depth === 0) return source.slice(start, index + 1)
        }
    }

    throw new Error(`unterminated ${signature}`)
}

// The module-level `let` line, copied as written so the harness starts from the real initial values.
function extractLet(source, name) {
    const match = source.match(new RegExp(`^let ${name} = .*$`, 'm'))
    assert.ok(match, `missing let ${name}`)
    return match[0]
}

const contentSource = readRepoFile('shared/js/content.js')
const CLAIM_STATE_NAMES = [
    'autoProfileAction',
    'autoProfileActionPending',
    'autoProfileActionClaimPending',
    'autoProfileActionAttempts',
    'activeQueuedAttemptId',
    'heldQueuedClaim',
    'queuedTabFinishing'
]
const claimHoldSource = [
    ...CLAIM_STATE_NAMES.map(name => extractLet(contentSource, name)),
    extractFunction(contentSource, 'function markQueuedTabFinishing()'),
    extractFunction(contentSource, 'async function acceptQueuedProfileActionClaim(request = {})'),
    extractFunction(contentSource, 'function releaseHeldQueuedProfileActionClaim()')
].join('\n')

// `runs` records the value of autoProfileAction each time the action runner is asked to run; `infoLines` records console.info.
function createClaimHarness({pageType = 'profile'} = {}) {
    const infoLines = []
    const runs = []
    const context = {
        console: {info: message => infoLines.push(message)},
        getPageType: () => pageType,
        canResolveQueuedProfileFromCurrentPage: () => true,
        refreshCoordinatorQueueFromRuntime: async () => {},
        maybeRecordAlreadyBlockedCoordinatorProfile: () => {},
        scheduleCurrentProfilePendingClaimRescue: () => {},
        maybeRunAutoProfileAction: () => {
            runs.push(vm.runInContext('autoProfileAction', context))
        },
        infoLines,
        runs
    }
    vm.createContext(context)
    vm.runInContext(claimHoldSource, context, {filename: 'content-queued-claim-hold-harness.js'})
    return context
}

function queuedAction(attemptId, extra = {}) {
    return {action: 'nuke', targetUrl: 'https://www.quora.com/profile/Example', attemptId, attemptNumber: 1, ...extra}
}

// Simulates an action that is running for attempt-A on this tab.
function startBusyAction(context) {
    vm.runInContext("autoProfileActionPending = true\nautoProfileAction = null\nactiveQueuedAttemptId = 'attempt-A'", context)
}

function claimState(context) {
    const state = vm.runInContext(`({
        autoProfileAction,
        autoProfileActionPending,
        autoProfileActionClaimPending,
        heldQueuedClaim,
        queuedTabFinishing
    })`, context)
    return {
        autoProfileActionAttemptId: state.autoProfileAction?.attemptId || '',
        autoProfileActionUnset: state.autoProfileAction === undefined || state.autoProfileAction === null,
        holding: state.heldQueuedClaim !== null,
        heldAttemptId: state.heldQueuedClaim?.action?.attemptId || '',
        queuedTabFinishing: state.queuedTabFinishing
    }
}

const cases = []
function register(name, fn) {
    cases.push([name, fn])
}

register('a push during an action is held and answered accepted without running', async () => {
    const context = createClaimHarness()
    startBusyAction(context)

    const reply = await context.acceptQueuedProfileActionClaim({queuedAction: queuedAction('attempt-B'), reason: 'nudge'})

    assert.equal(reply.accepted, true)
    assert.equal(reply.reason, 'held-while-busy')
    const state = claimState(context)
    assert.equal(state.holding, true)
    assert.equal(state.heldAttemptId, 'attempt-B')
    assert.equal(state.autoProfileActionUnset, true)
    assert.equal(context.runs.length, 0)
})

register('a push during the tab\'s own claim request is held', async () => {
    const context = createClaimHarness()
    vm.runInContext('autoProfileActionClaimPending = true', context)

    const reply = await context.acceptQueuedProfileActionClaim({queuedAction: queuedAction('attempt-B'), reason: 'nudge'})

    assert.equal(reply.accepted, true)
    assert.equal(reply.reason, 'held-while-busy')
    assert.equal(claimState(context).heldAttemptId, 'attempt-B')
    assert.equal(context.runs.length, 0)
})

register('a push for the attempt already running is answered accepted and nothing is held', async () => {
    const context = createClaimHarness()
    startBusyAction(context)

    const reply = await context.acceptQueuedProfileActionClaim({queuedAction: queuedAction('attempt-A'), reason: 'nudge'})

    assert.equal(reply.accepted, true)
    assert.equal(reply.reason, 'already-running')
    assert.equal(claimState(context).holding, false)
    assert.equal(context.runs.length, 0)
})

register('a push while busy and finishing is declined and not held', async () => {
    const context = createClaimHarness()
    startBusyAction(context)
    context.markQueuedTabFinishing()

    const reply = await context.acceptQueuedProfileActionClaim({queuedAction: queuedAction('attempt-B'), reason: 'nudge'})

    assert.equal(reply.accepted, false)
    assert.equal(reply.reason, 'tab-finishing')
    assert.equal(claimState(context).holding, false)
    assert.equal(context.runs.length, 0)
})

register('a push while idle runs at once, even after a close was requested', async () => {
    const context = createClaimHarness()
    context.markQueuedTabFinishing()

    const reply = await context.acceptQueuedProfileActionClaim({queuedAction: queuedAction('attempt-B'), reason: 'nudge'})

    assert.equal(reply.accepted, true)
    assert.equal(reply.reason, 'nudge')
    const state = claimState(context)
    assert.equal(state.autoProfileActionAttemptId, 'attempt-B')
    assert.equal(state.holding, false)
    assert.equal(context.runs.length, 1)
    assert.equal(context.runs[0].attemptId, 'attempt-B')
})

register('the held claim runs once when the work that blocked it ends', async () => {
    const context = createClaimHarness()
    startBusyAction(context)
    await context.acceptQueuedProfileActionClaim({queuedAction: queuedAction('attempt-B'), reason: 'nudge'})

    vm.runInContext('autoProfileActionPending = false', context)
    const took = vm.runInContext('releaseHeldQueuedProfileActionClaim()', context)

    assert.equal(took, true)
    const state = claimState(context)
    assert.equal(state.autoProfileActionAttemptId, 'attempt-B')
    assert.equal(state.holding, false)
    assert.equal(context.runs.length, 1)
    assert.equal(context.runs[0].attemptId, 'attempt-B')

    assert.equal(vm.runInContext('releaseHeldQueuedProfileActionClaim()', context), false)
    assert.equal(context.runs.length, 1)
})

register('a held claim is dropped, not run, when the tab is finishing at release', async () => {
    const context = createClaimHarness()
    startBusyAction(context)
    await context.acceptQueuedProfileActionClaim({queuedAction: queuedAction('attempt-B'), reason: 'nudge'})

    context.markQueuedTabFinishing()
    vm.runInContext('autoProfileActionPending = false', context)
    const took = vm.runInContext('releaseHeldQueuedProfileActionClaim()', context)

    assert.equal(took, false)
    const state = claimState(context)
    assert.equal(state.holding, false)
    assert.equal(state.autoProfileActionUnset, true)
    assert.equal(context.runs.length, 0)
    assert.deepEqual([...context.infoLines], ['Held queued claim dropped: this tab is finishing'])
})

register('releasing with nothing held does nothing', () => {
    const context = createClaimHarness()

    assert.equal(vm.runInContext('releaseHeldQueuedProfileActionClaim()', context), false)
    assert.equal(context.runs.length, 0)
    assert.deepEqual([...context.infoLines], [])
})

register('when two claims arrive while busy, the later one is the one held', async () => {
    const context = createClaimHarness()
    startBusyAction(context)
    await context.acceptQueuedProfileActionClaim({queuedAction: queuedAction('attempt-B'), reason: 'nudge'})
    await context.acceptQueuedProfileActionClaim({queuedAction: queuedAction('attempt-C'), reason: 'nudge'})

    assert.equal(claimState(context).heldAttemptId, 'attempt-C')
})

register('requestCloseTab marks the tab finishing before it schedules or sends anything', () => {
    const body = extractFunction(contentSource, 'async function requestCloseTab(attempts = 3, delayMs = 150, scheduleFollowUps = true)')
    const markAt = body.indexOf('markQueuedTabFinishing()')

    assert.notEqual(markAt, -1)
    assert.ok(markAt < body.indexOf('scheduleCloseTabFollowUps()'), 'mark comes before the follow-up schedule')
    assert.ok(markAt < body.indexOf('safeSendRuntimeMessageWithTimeout'), 'mark comes before the close message')
})

register('both leave-open-for-retry branches mark the tab finishing before they return', () => {
    assert.match(contentSource, /markQueuedTabFinishing\(\)\n\s*console\.info\('Queued terminal success was not recorded; leaving tab open for retry'\)/)
    assert.match(contentSource, /markQueuedTabFinishing\(\)\n\s*console\.info\('Queued terminal unblock\/unmute success was not recorded; leaving tab open for retry'\)/)
})

register('a close-if-blocked reply that says the worker will close the tab marks the tab finishing', () => {
    assert.match(contentSource, /markQueuedTabFinishing\(\)\n\s*return Promise\.resolve\(\{\n\s*willClose: true,/)
})

register('an action start clears the finishing flag beside the pending flag', () => {
    assert.match(contentSource, /autoProfileActionPending = true\n\s*queuedTabFinishing = false\n/)
})

register('the action finally releases a held claim after it resets the attempt state', () => {
    assert.match(contentSource, /activeQueuedActionSurfaceMode = ''\n\s*releaseHeldQueuedProfileActionClaim\(\)\n\s*\}\n\s*\}\n\n\s*function reportActionIssue/)
})

register('the claim block takes a held push when the claim finds nothing, and a claim that finds an action supersedes it', () => {
    const body = extractFunction(contentSource, 'async function maybeRunAutoProfileAction()')
    const claimAt = body.indexOf("action: 'claim-tab-action'")
    const noActionReleaseAt = body.indexOf('if(releaseHeldQueuedProfileActionClaim()) return')
    const shouldKeepRetryingAt = body.indexOf('const shouldKeepRetrying')
    const supersedeAt = body.indexOf('heldQueuedClaim = null')
    const claimedActionAt = body.indexOf('const claimedAction = ')

    assert.ok(claimAt > 0, 'claim block is present')
    assert.ok(noActionReleaseAt > claimAt && noActionReleaseAt < shouldKeepRetryingAt,
        'the no-action release sits in the claim block, before the retry scheduling')
    assert.ok(supersedeAt > claimAt && supersedeAt < claimedActionAt,
        'a claim that found an action supersedes a push held during the claim')
})

register('the worker-facing claim handler delegates to the held-claim helper', () => {
    assert.match(contentSource, /if\(request\.action === 'claim-current-profile-tab-action'\) \{\n\s*return acceptQueuedProfileActionClaim\(request\)\n\s*\}/)
})

register('the claim helper declines a finishing tab only inside its busy branch, after the already-running answer', () => {
    const body = extractFunction(contentSource, 'async function acceptQueuedProfileActionClaim(request = {})')
    const busyAt = body.indexOf('if(autoProfileActionPending || autoProfileActionClaimPending)')
    const alreadyRunningAt = body.indexOf("reason: 'already-running'")
    const finishingAt = body.indexOf("reason: 'tab-finishing'")
    const idleStartAt = body.indexOf('autoProfileAction = nextProfileAction')

    assert.ok(busyAt > 0, 'busy branch is present')
    assert.ok(alreadyRunningAt > busyAt && alreadyRunningAt < finishingAt, 'the already-running answer comes before the finishing decline')
    assert.ok(finishingAt > busyAt && finishingAt < idleStartAt, 'a finishing tab only declines while busy')
})

;(async () => {
    for(const [name, fn] of cases) await test(name, fn)
})().catch(error => {
    console.error(error)
    process.exitCode = 1
})
