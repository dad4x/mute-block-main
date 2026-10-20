const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Covers the review-2 changes the owner accepted on 2026-10-14 that have no other test file: the restore regex, the content
// helpers, the timeout flag, the fill loop's failure handling, the stored-work clear re-read, the milestone sender, and the
// supersession measurement helpers. Helpers run for real in a VM context with their dependencies stubbed. The wiring around
// them is checked by source, because running the whole queue needs the full worker (the reset path is covered in swSynthetic).
// Also covers three review-3 items: the case-sensitive slug identity (R3-1), the settings type check (R3-2), and the dashboard poll (R3-4),
// and the review-4 identity and name-match items (R4-1 to R4-3).

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

// The module-level `let` line, copied as written.
function extractLet(source, name) {
    const match = source.match(new RegExp(`^let ${name} = .*$`, 'm'))
    assert.ok(match, `missing let ${name}`)
    return match[0]
}

const swSource = readRepoFile('shared/js/sw.js')
const contentSource = readRepoFile('shared/js/content.js')
const rowEventSource = readRepoFile('shared/js/swCoordinatorRowEventMetrics.js')
const coordinatorSource = readRepoFile('shared/js/coordinator.js')

const cases = []
function register(name, fn) {
    cases.push([name, fn])
}

register('the restore regex routes a closing tab to the missing-tab requeue (review-2 S1-3)', () => {
    const match = swSource.match(/if\(\/(active-live-runtime-[^/]*)\/\.test\(`\$\{restoreResult\?\.reason \|\| ''\}`\)\) \{/)
    assert.ok(match, 'the restore regex is present')
    const restoreRegex = new RegExp(match[1])
    assert.equal(restoreRegex.test('active-live-runtime-tab-closing'), true)
    assert.equal(restoreRegex.test('active-live-runtime-tab-removed'), true)
    assert.equal(restoreRegex.test('active-live-runtime-tab-something-else'), false)
})

register('getGlobalPrimaryAction needs a label regex, and only labelled candidates can win (review-2 C-4)', () => {
    const body = extractFunction(contentSource, 'function getGlobalPrimaryAction(preferredRegex)')
    const cancel = {text: 'Cancel', score: 10, getAttribute: () => ''}
    const addQuestion = {text: 'Add question', score: 90, getAttribute: () => ''}
    const context = {
        console,
        document: {querySelectorAll: () => [addQuestion, cancel]},
        shouldIgnoreActionCandidate: () => false,
        isVisible: () => true,
        getElementText: element => element.text,
        scoreActionCandidate: element => element.score
    }
    vm.createContext(context)
    vm.runInContext(`${body}\nglobalThis.getGlobalPrimaryAction = getGlobalPrimaryAction`, context, {
        filename: 'content-global-primary-action-harness.js'
    })

    // The regex is made inside the VM so it shares the realm the guard checks (the content script makes its own regexes too).
    assert.equal(context.getGlobalPrimaryAction(), null, 'no regex, no action')
    assert.equal(context.getGlobalPrimaryAction(vm.runInContext('/\\bcancel\\b/i', context)), cancel, 'with a regex only the labelled candidate can win')
})

register('an unmatched message from this extension is reported, other senders and empty messages are not (review-2 C-7)', () => {
    const body = extractFunction(contentSource, 'function reportUnhandledContentMessage(request = {}, sender = {})')
    const logs = []
    const context = {console: {info: message => logs.push(message)}, browser: {runtime: {id: 'ext-id'}}}
    vm.createContext(context)
    vm.runInContext(`${body}\nglobalThis.report = reportUnhandledContentMessage`, context, {
        filename: 'content-unhandled-message-harness.js'
    })

    assert.equal(context.report({action: 'typo-action'}, {id: 'ext-id'}), true)
    assert.equal(context.report({status: 'typo-status'}, {id: 'ext-id'}), true)
    assert.equal(context.report({action: 'typo-action'}, {id: 'some-other-extension'}), false)
    assert.equal(context.report({}, {id: 'ext-id'}), false)
    assert.equal(logs.length, 2)
    assert.match(logs[0], /action=typo-action, status=-/)
    assert.match(logs[1], /action=-, status=typo-status/)
})

register('the timeout branch reports changed only when this pass wrote something (review-2 S1-6)', () => {
    assert.match(swSource, /const timeoutPassWroteSomething = requeued > 0 \|\| adopted > 0 \|\| terminalizedExhausted > 0 \|\| terminalizedBlocked > 0 \|\|\s*resolvedStaleRuntime > 0 \|\| resolvedTerminalRuntime > 0/)
    assert.match(swSource, /changed: timeoutPassWroteSomething,/)
    // The other timeout branch reports real materialization, so it keeps its value.
    assert.match(swSource, /reason: 'active-runtime-materialized-during-enqueue'\n\s*\}\)/)
})

register('a failed fill iteration keeps its guard and reservation once it has a tab, and the loop goes on (review-2 S5-2, S5-4)', () => {
    assert.match(swSource, /if\(!iterationTabId\) \{\n\s*if\(activationGuardKey\) deleteActivationGuardByKey\(activationGuardKey\)\n\s*releaseQueuedProfileOpenReservation\(openReservationHref\)\n\s*\}/)
    assert.match(swSource, /recordCoordinatorDiagnosticEvent\('queued-tab-fill-iteration-failed'/)
    assert.match(swSource, /scheduleCoordinatorReconcile\(1000, \{\n\s*reason: 'queued-tab-fill-error-with-tab'/)
    // The catch ends in `continue`, not `break`.
    const catchStart = swSource.indexOf("recordCoordinatorDiagnosticEvent('queued-tab-fill-iteration-failed'")
    const catchEnd = swSource.indexOf('continue\n        }', catchStart)
    assert.ok(catchStart > 0 && catchEnd > catchStart, 'the catch is present and ends in continue')
    assert.doesNotMatch(swSource.slice(catchStart, catchEnd), /\bbreak\b/)
})

register('the tab an iteration opens is recorded before the open is counted (review-2 S5-2)', () => {
    assert.match(swSource, /iterationTabId = normalizeTabId\(tab\?\.id\) \|\| null\n\s*openedTabs \+= 1\n\s*noteExecutorStartSupersessionFirstTab\(\)/)
    assert.match(swSource, /let iterationTabId = null/)
})

register('a stored-work clear re-reads before it saves and rebuilds the plan for rows whose attempt moved (review-2 S3-2)', () => {
    assert.match(swSource, /for\(let pass = 1; pass <= STORED_WORK_CLEAR_REREAD_ATTEMPTS; pass \+= 1\) \{/)
    assert.match(swSource, /storedWorkClearRowMoved\(row\.previousRow, freshQueue\[row\.rowKey\]\)/)
    assert.match(swSource, /metricPath: 'storedWork\.clear\.reread'/)
    assert.match(readRepoFile('shared/js/tunables.js'), /STORED_WORK_CLEAR_REREAD_ATTEMPTS: 2/)
})

register('storedWorkClearRowMoved treats a changed attempt as a move, and a row that is gone as no move (review-2 S3-2)', () => {
    const body = extractFunction(swSource, 'function storedWorkClearRowMoved(previousRow = null, freshRow = null)')
    const context = {
        getAttemptIdFromValue: value => `${value?.attemptId || ''}`,
        getAttemptNumberFromValue: value => Number.parseInt(value?.attemptNumber, 10) || 0
    }
    vm.createContext(context)
    vm.runInContext(`${body}\nglobalThis.moved = storedWorkClearRowMoved`, context, {
        filename: 'sw-stored-work-clear-harness.js'
    })

    const previous = {attemptId: 'attempt-1', attemptNumber: 1}
    assert.equal(context.moved(previous, {attemptId: 'attempt-1', attemptNumber: 1}), false)
    assert.equal(context.moved(previous, {attemptId: 'attempt-2', attemptNumber: 1}), true)
    assert.equal(context.moved(previous, {attemptId: 'attempt-1', attemptNumber: 2}), true)
    assert.equal(context.moved(previous, null), false, 'a row that is gone has not moved')
})

register('a pending milestone keeps its authenticated sender through the deferred flush (review-2 S4-1)', () => {
    assert.match(swSource, /let coordinatorJobMilestonePendingSenderTabIds = \{\}/)
    assert.match(swSource, /const pendingSenderTabId = normalizeTabId\(options\.senderTabId\)/)
    assert.match(swSource, /if\(coordinatorJobMilestonePendingSenderTabIds\[href\]\) \{/)
    assert.match(swSource, /senderTabIdsByHref: pendingSenderTabIds/)
})

register('each deferred record takes its own sender, and a call-wide sender is only the fallback (review-2 S4-1)', () => {
    const body = extractFunction(rowEventSource, 'function buildCoordinatorRowEventsFromProgressRecords(progressRecords = {}, options = {})')
    const context = {
        normalizeCoordinatorRowProgressEvent: event => event,
        coordinatorRowEventQueuedProgressMilestone: 'queued-progress-milestone'
    }
    vm.createContext(context)
    vm.runInContext(`${body}\nglobalThis.build = buildCoordinatorRowEventsFromProgressRecords`, context, {
        filename: 'row-event-builder-harness.js'
    })

    const records = {'https://www.quora.com/profile/A': {}, 'https://www.quora.com/profile/B': {}}
    const withMap = context.build(records, {senderTabId: 7, senderTabIdsByHref: {'https://www.quora.com/profile/A': 11}})
    assert.equal(withMap.find(event => event.profileHref.endsWith('/A')).senderTabId, 11)
    assert.equal(withMap.find(event => event.profileHref.endsWith('/B')).senderTabId, 7, 'no stored sender, so the call-wide one')
    const withoutSender = context.build(records, {})
    assert.equal(withoutSender.every(event => event.senderTabId === null), true)
})

register('a reset passes its reason on, and each superseded enqueue records its phase (review-2 stall measurement)', () => {
    assert.match(swSource, /resetCoordinatorExecutorStartPromise: \(reason = 'executor-start-reset'\) => \{/)
    assert.match(swSource, /armExecutorStartSupersessionFirstTab\(headToken\.supersession\.reason, supersededAt\)/)
    assert.match(swSource, /recordExecutorStartSupersession\(options\.cancelToken, 'start'\)/)
    assert.match(swSource, /recordExecutorStartSupersession\(options\.cancelToken, 'before-fill'\)/)
    assert.match(swSource, /recordExecutorStartSupersession\(options\.cancelToken, options\.awaitFill === false \? 'before-fill' : 'after-fill'\)/)
    const timersSource = readRepoFile('shared/js/swPersistentRetryExecutorTimers.js')
    assert.match(timersSource, /resetCoordinatorExecutorStartPromise\(reason \|\| 'executor-start-timeout'\)/)
    assert.match(timersSource, /resetCoordinatorExecutorStartPromise\(reason \|\| 'executor-start-idle-stale-reset'\)/)
})

register('the supersession measurement counts each enqueue once and times only the first tab after a reset (review-2 stall measurement)', () => {
    const metrics = []
    const diagnostics = []
    const context = {
        incrementQueueWakeupMetric: (name, amount = 1) => metrics.push(name),
        recordCoordinatorDiagnosticEvent: (kind, message, details = {}) => diagnostics.push({kind, message, details}),
        Date
    }
    vm.createContext(context)
    const source = [
        extractLet(swSource, 'pendingExecutorStartSupersessionFirstTab'),
        extractFunction(swSource, 'function armExecutorStartSupersessionFirstTab(reason'),
        extractFunction(swSource, 'function finishExecutorStartSupersessionFirstTab(timeToFirstTabMs'),
        extractFunction(swSource, 'function noteExecutorStartSupersessionFirstTab()'),
        extractFunction(swSource, 'function recordExecutorStartSupersession(cancelToken'),
        'globalThis.arm = armExecutorStartSupersessionFirstTab',
        'globalThis.note = noteExecutorStartSupersessionFirstTab',
        'globalThis.record = recordExecutorStartSupersession'
    ].join('\n')
    vm.runInContext(source, context, {filename: 'sw-supersession-measurement-harness.js'})

    // A tab opened with nothing armed is not timed.
    assert.equal(context.note(), false)

    // One reset, then a tab: timed.
    context.arm('synthetic-reset', Date.now() - 40)
    assert.equal(context.note(), true)
    assert.ok(metrics.includes('pump.executorStartSupersededFirstTab'))
    const timed = diagnostics.find(entry => entry.kind === 'executor-start-superseded-first-tab')
    assert.ok(Number.isFinite(timed.details.timeToFirstTabMs) && timed.details.timeToFirstTabMs >= 40)

    // A second reset before any tab closes the first measurement without a tab.
    context.arm('first-reset', Date.now())
    context.arm('second-reset', Date.now())
    assert.ok(metrics.includes('pump.executorStartSupersededNoTab'))

    // Each superseded enqueue is recorded once, under its phase.
    const cancelToken = {supersession: {reason: 'synthetic-reset', headAgeMs: 12, supersededAt: Date.now(), recorded: false}}
    assert.equal(context.record(cancelToken, 'before-fill'), true)
    assert.equal(context.record(cancelToken, 'before-fill'), false, 'a second stop of the same enqueue is not counted again')
    assert.equal(context.record({}, 'start'), false, 'an enqueue that was never superseded is not counted')
    assert.equal(metrics.filter(name => name === 'pump.executorStartSuperseded.before-fill').length, 1)
})

register('the stored-work clear, the fill, the reset and the claim wiring are all in place', () => {
    assert.match(swSource, /function buildStoredWorkClearPlan\(state = \{\}\) \{/)
    assert.doesNotMatch(swSource, /excludedRowKeys/, 'the last re-read pass no longer leaves rows in place (review-3 R3-5)')
    assert.match(swSource, /plan = buildStoredWorkClearPlan\(fresh\)\n/)
    assert.match(swSource, /const \{clearedUrls, clearedWorkKeys, ownedTabIds, removedRows\} = plan/)
    assert.match(swSource, /await coordinatorAuthority\.persistCoordinator\(\n\s*\{\n\s*results: \[\],\n\s*removedRows,/)
})

// Review-3 R3-5 (owner, 14 Oct: remove). The plan keeps every row it is given, and each row's tab is owned by the plan.
register('the stored-work clear plan removes every row it is given and owns each row\'s tab (review-3 R3-5)', () => {
    const source = extractFunction(swSource, 'function buildStoredWorkClearPlan(state = {})')
    const context = vm.createContext({
        normalizeCoordinatorAuthorityStateInput: state => ({queue: state.queue || {}}),
        getCoordinatorItemHref: item => item.targetProfileHref || '',
        getCoordinatorItemQueueKey: (item, key) => key,
        getPersistedQueuedTabId: item => item.tabId || null,
        normalizeQuoraProfileUrl: href => href
    })
    vm.runInContext(source, context)
    const state = {
        queue: {
            'row-a': {targetProfileHref: 'https://www.quora.com/profile/A-1', tabId: 11},
            'row-b': {targetProfileHref: 'https://www.quora.com/profile/B-2', tabId: 12}
        }
    }
    const plan = vm.runInContext(`buildStoredWorkClearPlan(${JSON.stringify(state)})`, context)
    // Objects made inside the VM carry another realm's prototypes, so compare plain copies.
    const plain = value => JSON.parse(JSON.stringify(value))
    assert.equal(plan.removedRows.length, 2)
    assert.deepEqual(plain(plan.clearedUrls), ['https://www.quora.com/profile/A-1', 'https://www.quora.com/profile/B-2'])
    assert.deepEqual(plain([...plan.ownedTabIds]), [11, 12])
})

// Review-2 C-3 measurement: each claim retry loop reports once, at the threshold, and nothing else changes.
register('a claim retry loop reports to the worker once, at the measurement threshold, and the report stops no loop', () => {
    const body = extractFunction(contentSource, 'function noteClaimRetryPass(')
    const sent = []
    const context = {
        CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES: 40,
        claimRetryPassCounts: {},
        location: {href: 'https://www.quora.com/profile/Example-1'},
        safeSendRuntimeMessage: async message => {
            sent.push(message)
            return null
        }
    }
    vm.createContext(context)
    vm.runInContext(`${body}\nglobalThis.noteClaimRetryPass = noteClaimRetryPass`, context, {filename: 'content-claim-retry-harness.js'})

    for(let pass = 0; pass < 39; pass += 1) context.noteClaimRetryPass('claim-retry')
    assert.equal(sent.length, 0, 'no report before the threshold')
    context.noteClaimRetryPass('claim-retry')
    assert.equal(sent.length, 1, 'one report at the threshold')
    assert.deepEqual({...sent[0]}, {
        action: 'content-claim-retry-hit',
        loop: 'claim-retry',
        passes: 40,
        href: 'https://www.quora.com/profile/Example-1'
    })
    for(let pass = 0; pass < 60; pass += 1) context.noteClaimRetryPass('claim-retry')
    assert.equal(sent.length, 1, 'a loop past the threshold is not reported again')
    context.noteClaimRetryPass('queue-not-loaded')
    assert.equal(sent.length, 1, 'each loop keeps its own count')
})

register('the three claim retry loops each report through noteClaimRetryPass, and the threshold is a named tunable', () => {
    const body = extractFunction(contentSource, 'async function maybeRunAutoProfileAction(')
    for(const loop of ['queue-not-loaded', 'claim-retry', 'pending-item-retry']) {
        assert.equal(body.split(`noteClaimRetryPass('${loop}')`).length - 1, 1, `${loop} reports once from the claim loop`)
    }
    assert.match(contentSource, /const \{MAX_PROFILE_NUKE_PROGRESS_ENTRIES, CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES\} = require\('\.\/tunables'\)/)
    const {CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES} = require('../shared/js/tunables')
    assert.ok(Number.isInteger(CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES) && CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES > 0)
})

register('the worker records a content claim retry report as a flight-recorder event and a counter, outside the authority gate', () => {
    const bootstrapSource = readRepoFile('shared/js/swBootstrap.js')
    assert.match(bootstrapSource, /else if\(request\.action === 'content-claim-retry-hit'\) \{/)
    assert.match(bootstrapSource, /incrementQueueWakeupMetric\(`contentClaimRetry\.\$\{loop\}`\)/)
    assert.match(bootstrapSource, /kind: 'content-claim-retry-hit'/)
    assert.match(bootstrapSource, /\/\^\[a-z-\]\{1,40\}\$\/\.test/, 'the loop name is checked before it becomes a counter name')
    const authorityStart = bootstrapSource.indexOf('RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY = new Set([')
    const authorityEnd = bootstrapSource.indexOf('])', authorityStart)
    assert.ok(authorityStart !== -1 && authorityEnd > authorityStart, 'the authority list is found')
    assert.ok(!bootstrapSource.slice(authorityStart, authorityEnd).includes("'content-claim-retry-hit'"), 'the report does not wait for authority')
})

// Review-2 S1-1 measurement: the progress global's scoped writes and its misses on the non-queue-only prune read are counted.
register('the progress-global exposure counters are in place beside the reads they count', () => {
    assert.match(swSource, /if\(options\.queueOnlyAuthority === true && options\.scopedProgressForQueueOnly === true\) \{\n\s*incrementQueueWakeupMetric\('progress\.scopedGlobalWrite'\)\n\s*\}\n\s*profileNukeProgress = progress\n/)
    assert.match(swSource, /const record = !queueOnlyAuthority && normalizedHref \? profileNukeProgress\?\.\[normalizedHref\] \|\| null : null\n\s*\/\/ Measurement[^\n]*\n\s*if\(!queueOnlyAuthority && normalizedHref\) \{\n\s*incrementQueueWakeupMetric\(record \? 'queuedTabActions\.prune\.globalProgressHit' : 'queuedTabActions\.prune\.globalProgressMiss'\)/)
})

// Review-3 R3-1. The owner's rule (14 Oct): profile slugs are case-sensitive, so a case-only difference is a different profile
// and the normalizer keeps case. The reviewer's case-insensitive comparison is not taken.
register('profile slugs keep their case, so a case-only difference is a different profile (review-3 R3-1)', () => {
    const {normalizeQuoraProfileHref} = require('../shared/js/subject.js')
    const lowerCase = normalizeQuoraProfileHref('https://www.quora.com/profile/cesc-fabregas-56')
    const canonical = normalizeQuoraProfileHref('https://www.quora.com/profile/Cesc-Fabregas-56')
    assert.ok(lowerCase && canonical, 'both hrefs normalize')
    assert.notEqual(lowerCase, canonical)
})

// Review-3 R3-2. A setting is written only when its value has the type of its default. Every default is a number or a boolean.
register('the settings writer keeps a value only when its type matches its default (review-3 R3-2)', async () => {
    const validatorSource = extractFunction(swSource, 'function isExtensionSettingValueValid(key, value)')
    const writerSource = extractFunction(swSource, 'async function setExtensionSettingsRequested(settings = {})')
    const writes = []
    const context = vm.createContext({
        defaults: require('../shared/js/defaults.js'),
        metricStorageSet: async values => { writes.push(values) }
    })
    vm.runInContext(`${validatorSource}\n${writerSource}`, context)
    const result = await vm.runInContext(`setExtensionSettingsRequested({
        fopDelay: '1000',
        flipToAnswers: 'yes',
        profilesPerBatch: NaN,
        targetQueuedTabConcurrency: 6,
        coordinatorAutoStartOnBrowserStart: true,
        notASetting: 3
    })`, context)
    // Objects made inside the VM carry another realm's prototypes, so compare plain copies.
    const plain = value => JSON.parse(JSON.stringify(value))
    assert.deepEqual(plain(writes), [{targetQueuedTabConcurrency: 6, coordinatorAutoStartOnBrowserStart: true}])
    assert.deepEqual(plain(result), {ok: true, rejected: ['fopDelay', 'flipToAnswers', 'profilesPerBatch']})
})

// Review-3 R3-4. The dashboard's run-status poll is one timer. The dev-mode visibility path starts it while dev mode is on and
// stops it when dev mode is off.
register('the dashboard run-status poll runs only while dev mode is on, and never twice (review-3 R3-4)', () => {
    assert.equal(extractFunction(coordinatorSource, 'function installDevModeToggle()').includes('setInterval'), false, 'the installer starts no timer')
    assert.match(extractFunction(coordinatorSource, 'function applyDevModeVisibility(enabled)'), /syncDebugRunStatusTimer\(enabled\)/)
    const started = []
    const cleared = []
    const context = vm.createContext({
        setInterval: (fn, ms) => { started.push(ms); return started.length },
        clearInterval: id => { cleared.push(id) },
        refreshDebugRunStatus: () => {}
    })
    vm.runInContext(`${extractLet(coordinatorSource, 'debugRunStatusTimer')}\n${extractFunction(coordinatorSource, 'function syncDebugRunStatusTimer(enabled)')}`, context)
    vm.runInContext('syncDebugRunStatusTimer(false)', context)
    assert.deepEqual(started, [], 'off at start: no timer')
    vm.runInContext('syncDebugRunStatusTimer(true)', context)
    vm.runInContext('syncDebugRunStatusTimer(true)', context)
    assert.deepEqual(started, [1000], 'one timer, one second apart')
    vm.runInContext('syncDebugRunStatusTimer(false)', context)
    vm.runInContext('syncDebugRunStatusTimer(false)', context)
    assert.deepEqual(cleared, [1], 'cleared once')
    assert.equal(vm.runInContext('debugRunStatusTimer', context), null)
})

// Owner decision (14 Oct): case-sensitive comparisons everywhere, because impersonators use case shifting. A case variant of
// the queued slug is a different profile, so the remap check reports it (review-3 R3-1).
register('the queued-profile remap check is case-sensitive: a case variant of the slug is a remap (review-3 R3-1)', () => {
    const {normalizeQuoraProfileHref} = require('../shared/js/subject.js')
    const source = extractFunction(contentSource, "function getQueuedProfileRemapTarget(profileHref = '')")
    const context = vm.createContext({
        normalizeQuoraProfileHref,
        getPageType: () => 'profile',
        location: {href: 'https://www.quora.com/profile/Cesc-Fabregas-56'}
    })
    vm.runInContext(source, context)
    const remap = href => vm.runInContext(`getQueuedProfileRemapTarget(${JSON.stringify(href)})`, context)
    assert.equal(remap('https://www.quora.com/profile/Cesc-Fabregas-56'), '', 'the same casing is not a remap')
    assert.equal(remap('https://www.quora.com/profile/cesc-fabregas-56'), 'https://www.quora.com/profile/Cesc-Fabregas-56', 'a case variant is a remap')
})

register('the inline blocked-state scan matches the profile path case-sensitively (owner, 14 Oct)', () => {
    const source = [
        extractFunction(contentSource, "function hasInlineBlockedStateMarker(text = '')"),
        extractFunction(contentSource, 'function isProfileBlockedFromInlineState()')
    ].join('\n')
    const marker = '"isBlockedByViewer?":true'
    const check = (profileKey, path) => {
        const context = vm.createContext({
            URL,
            getProfileKey: () => profileKey,
            document: {scripts: [{textContent: `window.data = {"url":"${path}","state":${marker}}`}]}
        })
        vm.runInContext(source, context)
        return vm.runInContext('isProfileBlockedFromInlineState()', context)
    }
    const profileKey = 'https://www.quora.com/profile/Cesc-Fabregas-56'
    assert.equal(check(profileKey, '/profile/Cesc-Fabregas-56'), true, 'the same casing is found')
    assert.equal(check(profileKey, '/profile/cesc-fabregas-56'), false, 'a case variant in the page data is not this profile')
})

register('a space registry slug matches case-sensitively (owner, 14 Oct)', () => {
    const source = extractFunction(contentSource, 'function getStoredSpaceRecord(space)')
    const context = vm.createContext({
        spaceRegistry: {'space-key': {slug: 'Quora-Space', url: ''}},
        normalizeSpaceUrl: () => '',
        extractSpaceSlug: () => ''
    })
    vm.runInContext(source, context)
    const lookup = slug => vm.runInContext(`getStoredSpaceRecord(${JSON.stringify({slug})})`, context)
    assert.ok(lookup('Quora-Space'), 'the same casing matches')
    assert.equal(lookup('quora-space'), null, 'a case variant is a different space')
})

// Owner decision (14 Oct): exact everywhere. Two posts whose text differs only in case are different posts.
register('the space-post text key keeps case (owner, 14 Oct: exact everywhere)', () => {
    const source = extractFunction(contentSource, 'function getSpaceFeedPostKey(postRoot, timestamp)')
    const context = vm.createContext({
        getSpaceFeedPostUrl: () => '',
        getElementText: element => element.text
    })
    vm.runInContext(`${source}\nfunction keyForText(text) { return getSpaceFeedPostKey({text}, {}) }`, context)
    const keyForText = text => vm.runInContext(`keyForText(${JSON.stringify(text)})`, context)
    assert.equal(keyForText('Hello World'), 'space-post-text:Hello World')
    assert.notEqual(keyForText('Hello World'), keyForText('hello world'))
})

// Owner, 15 Oct: the suffix shadow counts what the pre-15-Oct rule would have removed. It counts, and it stores nothing.
register('the suffix shadow reports what the old rule would have removed, and changes no stored key', () => {
    const {legacyStrippedSuffix, shadowSuffixTokens, sanitizeProfileHrefSlug} = require('../shared/js/subject.js')
    assert.equal(legacyStrippedSuffix('Cesc-Fabregas-share-56'), '-share-56')
    assert.equal(legacyStrippedSuffix('Cesc-Fabregas-SHARE-56'), '-SHARE-56')
    assert.equal(legacyStrippedSuffix('Cesc-Fabregas-56'), '')
    assert.equal(legacyStrippedSuffix('Quert-5-followers'), '-followers')
    assert.equal(legacyStrippedSuffix('Some-User-42-his-bio'), '-his-bio')
    assert.equal(legacyStrippedSuffix('Name-12-bio-Foo'), '-bio-Foo')
    assert.equal(legacyStrippedSuffix('Jan-'), '')
    assert.deepEqual(shadowSuffixTokens('-share-56'), ['share'])
    assert.deepEqual(shadowSuffixTokens('-his-bio'), ['bio'])
    assert.deepEqual(shadowSuffixTokens('-ab-cd'), ['other'])
    assert.deepEqual(shadowSuffixTokens(''), [])
    // The stored key keeps the suffix; the shadow only counts it.
    assert.equal(sanitizeProfileHrefSlug('Quert-5-followers'), 'Quert-5-followers')
    assert.match(swSource, /if\(targetProfileHref\) noteSuffixShadow\(targetProfileHref\)/)
    assert.match(swSource, /const targetProfileHref = normalizeQuoraProfileUrl\(/)
})

// Review-4 R4-1 and R4-3, and the owner's rule (14 Oct): the identity key is exact. NFC keeps a fullwidth lookalike apart, and the
// queue's dedupe keeps a case variant as its own entry instead of merging it into the real profile. The functions run for real in
// a VM context; the normalizer comes from subject.js.
register('the identity key and the queue dedupe are exact: a lookalike or a case variant is its own entry (review-4 R4-1, owner 14 Oct)', () => {
    const {normalizeQuoraProfileHref} = require('../shared/js/subject.js')
    const source = [
        extractFunction(contentSource, 'function getQuoraProfileSlugData(href)'),
        extractFunction(contentSource, 'function getNormalizedProfileIdentityKey(href)'),
        extractFunction(contentSource, 'function getNormalizedProfileHrefList(urls)')
    ].join('\n')
    const context = vm.createContext({URL, normalizeQuoraProfileHref})
    vm.runInContext(source, context)
    const identityKey = href => vm.runInContext(`getNormalizedProfileIdentityKey(${JSON.stringify(href)})`, context)
    const hrefList = urls => JSON.parse(JSON.stringify(vm.runInContext(`getNormalizedProfileHrefList(${JSON.stringify(urls)})`, context)))
    const real = 'https://www.quora.com/profile/Cesc-Fabregas-56'
    assert.equal(identityKey(real), 'Cesc-Fabregas-56')
    assert.notEqual(identityKey('https://www.quora.com/profile/Ｃｅｓｃ-Fabregas-56'), identityKey(real), 'a fullwidth lookalike is not the real profile')
    assert.notEqual(identityKey('https://www.quora.com/profile/cesc-fabregas-56'), identityKey(real), 'a case variant is not the real profile')
    assert.notEqual(identityKey('https://www.quora.com/profile/Cesc-Fabregas-56-'), identityKey(real), 'a trailing hyphen is not the real profile')
    const lowerCase = 'https://www.quora.com/profile/cesc-fabregas-56'
    assert.deepEqual(hrefList([real, lowerCase]), [real, lowerCase], 'both case variants stay in the list')
})

// Review-4 R4-2. The space feed no longer guesses a profile from a name in the post's title. That guess queued and nuked profiles
// that only contained the name, at medium confidence. A post with no profile link goes to the page resolver instead.
register('the space-feed collector has no title-name guess, so a name match is never queued or nuked (review-4 R4-2)', () => {
    for(const removed of ['nearby-profile-name', 'getNearbyProfileUrlsForName', 'getTrailingTitleNameCandidate', 'getProfileSlugText']) {
        assert.equal(contentSource.includes(removed), false, `${removed} is removed`)
    }
})

// Owner, 15 Oct: a shorter identity is a different profile from a longer one that starts with it, so the queue keeps both. The
// truncation filter that dropped the shorter one is removed.
register('a shorter identity stays beside a longer one that starts with it, and the truncation filter is gone (owner, 15 Oct)', () => {
    const {normalizeQuoraProfileHref} = require('../shared/js/subject.js')
    const source = [
        extractFunction(contentSource, 'function getQuoraProfileSlugData(href)'),
        extractFunction(contentSource, 'function getNormalizedProfileIdentityKey(href)'),
        extractFunction(contentSource, 'function getNormalizedProfileHrefList(urls)')
    ].join('\n')
    const context = vm.createContext({URL, normalizeQuoraProfileHref})
    vm.runInContext(source, context)
    const hrefList = urls => JSON.parse(JSON.stringify(vm.runInContext(`getNormalizedProfileHrefList(${JSON.stringify(urls)})`, context)))
    const jane = 'https://www.quora.com/profile/Jane'
    const janeSeven = 'https://www.quora.com/profile/Jane-7'
    assert.deepEqual(hrefList([jane, janeSeven]), [jane, janeSeven], 'Jane and Jane-7 are two profiles')
    const cescFab = 'https://www.quora.com/profile/Cesc-Fab'
    const cescFabregas = 'https://www.quora.com/profile/Cesc-Fabregas'
    assert.deepEqual(hrefList([cescFab, cescFabregas]), [cescFab, cescFabregas], 'Cesc-Fab and Cesc-Fabregas are two profiles')
    assert.equal(contentSource.includes('isLikelyTruncatedProfileIdentityKey'), false, 'the truncation filter is removed')
})

// Review 5 (R5-4), owner rule: a row with its own link is never retried as a resolution from its source post, because the post
// would choose the profile. A "did not land" error carries the post URL, so this guard is what keeps a canonical row from becoming
// a guess. Resolution rows keep their resolution retry, and a row with no link of its own is unchanged.
register('a row with its own link is never retried as a resolution from its post, and resolution rows still are (review-5 R5-4)', () => {
    const source = extractFunction(readRepoFile('shared/js/swCoordinatorJobEnvelope.js'), 'function getFailedItemProfileResolutionRetryUrl(item = {}, fallbackKey = \'\')')
    const postUrl = 'https://www.quora.com/space/Instant-Block/post/1'
    const context = vm.createContext({
        // Stand-ins for the envelope's helpers. A "did not land" error yields the post URL, as the real helper does.
        getFailedItemQuestionResolutionUrl: item => (/did not land/.test(item.error || '') ? item.postUrl : ''),
        isProfileResolutionItem: item => item.resolveProfileFromPage === true,
        getCoordinatorItemHref: item => item.targetProfileHref || '',
        getProfileResolutionRequestedUrl: (item, fallbackKey) => item.requestedUrl || fallbackKey || ''
    })
    vm.runInContext(source, context)
    const retryUrl = item => vm.runInContext(`getFailedItemProfileResolutionRetryUrl(${JSON.stringify(item)}, '')`, context)
    const failed = {error: 'Queued tab did not land on a profile page (space-post: /space/Instant-Block/post/1)', postUrl}
    assert.equal(retryUrl({...failed, targetProfileHref: 'https://www.quora.com/profile/Cesc-Fabregas-56'}), '', 'a canonical row keeps its own link')
    assert.equal(retryUrl({...failed, resolveProfileFromPage: true, requestedUrl: postUrl}), postUrl, 'a resolution row still retries from its post')
    assert.equal(retryUrl(failed), postUrl, 'a row with no link of its own is unchanged')
})

// Owner, 15 Oct: a queued tab that did not land on a profile page is not retried, because the same link lands the same way again.
// Other failures keep their retry.
register('a queued tab that did not land on a profile page is not retried, and other failures still are (owner, 15 Oct)', () => {
    const {isRetryableJobFailure, isRetryableJobFailureFromProgress} = require('../shared/js/jobState.js')
    const didNotLand = {status: 'failed', outcome: 'action-error', error: 'Queued tab did not land on a profile page (space-post: /space/X/post/1)'}
    assert.equal(isRetryableJobFailure(didNotLand), false)
    assert.equal(isRetryableJobFailureFromProgress(didNotLand, {status: 'error'}), false)
    assert.equal(isRetryableJobFailure({status: 'failed', outcome: 'action-error', error: 'Queued tab timed out before completion'}), true)
    assert.equal(isRetryableJobFailure({status: 'failed', outcome: 'action-error', error: 'Action error'}), true)
})

// Owner, 15 Oct: the live-check measurements. The content script reports a row that did not land, the worker counts it, the resolver
// reports which step decided the profile, and the metrics card reads the counters. Measurement only: nothing here decides an action.
register('the live-check counters are reported and counted, outside the authority gate, and the metrics card reads them (owner, 15 Oct)', () => {
    const bootstrapSource = readRepoFile('shared/js/swBootstrap.js')
    assert.match(contentSource, /noteLiveCheck\('did-not-land'\)/, 'the content script reports a row that did not land')
    assert.match(contentSource, /action: 'content-live-check'/)
    assert.match(contentSource, /resolutionSource: resolvedSource/, 'the resolve message says which step decided the profile')
    assert.match(bootstrapSource, /else if\(request\.action === 'content-live-check'\) \{[\s\S]*?incrementQueueWakeupMetric\('liveCheck\.didNotLand'\)/)
    assert.match(swSource, /incrementQueueWakeupMetric\(`liveCheck\.resolvedBy\.\$\{resolutionSource\}`\)/)
    assert.match(swSource, /\['url', 'header', 'inline', 'scored', 'explicit', 'listed'\]\.includes\(request\.resolutionSource\)/)
    const authorityStart = bootstrapSource.indexOf('RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY = new Set([')
    const authorityEnd = bootstrapSource.indexOf('])', authorityStart)
    assert.ok(authorityStart !== -1 && authorityEnd > authorityStart, 'the authority list is found')
    assert.ok(!bootstrapSource.slice(authorityStart, authorityEnd).includes("'content-live-check'"), 'the report does not wait for authority')
    assert.match(coordinatorSource, /buildLiveChecksCard\(counters\)/)
    const card = extractFunction(coordinatorSource, 'function buildLiveChecksCard(counters = {})')
    assert.match(card, /'Live checks'/)
    assert.match(card, /liveCheck\.resolvedBy\./)
    assert.match(card, /liveCheck\.didNotLand/)
    assert.match(card, /job\.profileRedirectMismatch/)
    assert.match(card, /suffixShadow\.changed/)
})

// Owner, 15 Oct: the resolver reports which step gave the profile. The href is the same with or without the sink, and each branch
// keeps the order of checks it had before: the header, then the original poster (inline data, then the scored scan), then the explicit link.
register('the resolver reports which step decided the profile: header, inline, scored, explicit, listed or url (owner, 15 Oct)', () => {
    const source = [
        extractFunction(contentSource, 'function noteQueuedResolution(sink, source, href)'),
        extractFunction(contentSource, "function isSourcePostResolutionReason(reason = '')"),
        extractFunction(contentSource, 'function getQueuedPageResolvedProfileHref(claimedAction = {}, sink = null)')
    ].join('\n')
    const state = {}
    const context = vm.createContext({
        QUEUED_PROFILE_RESOLUTION_MODE: 'author-profile',
        location: {href: 'https://www.quora.com/profile/Some-User-42'},
        normalizeQuoraProfileHref: href => (`${href || ''}`.includes('/profile/') ? `${href}` : null),
        getPageType: () => state.pageType,
        isAssetSpacePage: () => state.asset === true,
        getSingleSpacePostResolutionProfileHref: () => state.explicit || null,
        getSpacePostHeaderProfileHref: () => state.header || null,
        getSpacePostListedProfileLinks: () => state.listed || [],
        // Stands in for the real lookup, which sets the same sink field: the page's inline data first, then the scored scan.
        getOriginalPosterProfileHref: sink => {
            const href = state.inline || state.scored || null
            if(href && sink) sink.source = state.inline ? 'inline' : 'scored'
            return href
        }
    })
    vm.runInContext(source, context)
    const resolve = claimedAction => {
        const sink = vm.runInContext('({})', context)
        Object.assign(context, {sink})
        const href = vm.runInContext(`getQueuedPageResolvedProfileHref(${JSON.stringify(claimedAction)}, sink)`, context)
        return {href, source: sink.source}
    }
    const queued = {resolveProfileFromPage: true, resolutionMode: 'author-profile'}
    const explicit = 'https://www.quora.com/profile/Explicit-1'
    const header = 'https://www.quora.com/profile/Header-1'
    const inline = 'https://www.quora.com/profile/Inline-1'
    const scored = 'https://www.quora.com/profile/Scored-1'
    state.pageType = 'space-post'
    state.explicit = explicit
    state.header = header
    state.inline = inline
    state.scored = scored
    assert.deepEqual(resolve(queued), {href: header, source: 'header'})
    state.header = null
    assert.deepEqual(resolve(queued), {href: inline, source: 'inline'})
    state.inline = null
    assert.deepEqual(resolve(queued), {href: scored, source: 'scored'})
    state.scored = null
    assert.deepEqual(resolve(queued), {href: explicit, source: 'explicit'})
    state.asset = true
    assert.deepEqual(resolve(queued), {href: explicit, source: 'explicit'}, 'an asset page takes only the explicit link')
    state.asset = false
    state.explicit = null
    assert.deepEqual(resolve(queued), {href: null, source: ''}, 'nothing found: no href and no source')
    state.listed = ['https://www.quora.com/profile/Listed-1']
    assert.deepEqual(resolve({}), {href: state.listed[0], source: 'listed'})
    state.listed = []
    state.header = header
    assert.deepEqual(resolve({}), {href: header, source: 'header'})
    state.pageType = 'profile'
    assert.deepEqual(resolve({}), {href: 'https://www.quora.com/profile/Some-User-42', source: 'url'})
    // Without a sink the answer is the same.
    assert.equal(vm.runInContext(`getQueuedPageResolvedProfileHref(${JSON.stringify(queued)})`, context), 'https://www.quora.com/profile/Some-User-42')
})

;(async () => {
    for(const [name, fn] of cases) await test(name, fn)
})().catch(error => {
    console.error(error)
    process.exitCode = 1
})
