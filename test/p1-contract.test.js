const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function test(name, fn) {
    try {
        fn()
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

function extractCallExpression(source, callStart) {
    const parenStart = source.indexOf('(', callStart)
    assert.notEqual(parenStart, -1, 'missing call parenthesis')

    let depth = 0
    for(let index = parenStart; index < source.length; index += 1) {
        if(source[index] === '(') depth += 1
        else if(source[index] === ')') {
            depth -= 1
            if(depth === 0) return source.slice(callStart, index + 1)
        }
    }

    throw new Error('unterminated call expression')
}

function getEnclosingFunctionName(source, index) {
    const before = source.slice(0, index)
    const matcher = /(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g
    let match = null
    let functionName = ''

    while((match = matcher.exec(before))) {
        functionName = match[1]
    }

    return functionName
}

function collectCallSites(source, calleeName) {
    const matcher = new RegExp(`\\b${calleeName}\\s*\\(`, 'g')
    const callSites = []
    let match = null

    while((match = matcher.exec(source))) {
        const prefix = source.slice(Math.max(0, match.index - 32), match.index)
        if(/function\s+$/.test(prefix)) continue

        callSites.push({
            functionName: getEnclosingFunctionName(source, match.index),
            line: source.slice(0, match.index).split('\n').length,
            text: extractCallExpression(source, match.index)
        })
    }

    return callSites
}

function loadDashboardHarness() {
    const context = {
        require(name) {
            if(name === 'webextension-polyfill') return {}
            throw new Error(`unexpected require: ${name}`)
        },
        addEventListener() {},
        clearInterval() {},
        clearTimeout() {},
        console,
        setInterval() {},
        setTimeout() {}
    }
    vm.createContext(context)
    vm.runInContext(readRepoFile('shared/js/coordinator.js'), context, {
        filename: 'shared/js/coordinator.js'
    })
    return code => vm.runInContext(code, context)
}

function loadQueuedPageResolutionHarness() {
    const source = readRepoFile('shared/js/content.js')
    const state = {
        pageType: 'space-post',
        assetSpace: false,
        explicitProfileHref: '',
        headerProfileHref: '',
        originalPosterProfileHref: '',
        locationHref: 'https://www.quora.com/profile/Current-Profile'
    }
    const context = {
        state,
        location: {
            get href() {
                return state.locationHref
            }
        },
        QUEUED_PROFILE_RESOLUTION_MODE: 'author-profile',
        getPageType() {
            return state.pageType
        },
        isAssetSpacePage() {
            return state.assetSpace === true
        },
        getSingleSpacePostResolutionProfileHref() {
            return state.explicitProfileHref || null
        },
        getSpacePostHeaderProfileHref() {
            return state.headerProfileHref || null
        },
        getOriginalPosterProfileHref() {
            return state.originalPosterProfileHref || null
        },
        getSpacePostListedProfileLinks() {
            return []
        },
        normalizeQuoraProfileHref(href = '') {
            return `${href || ''}`.includes('/profile/') ? `${href || ''}` : null
        }
    }
    vm.createContext(context)
    vm.runInContext([
        extractFunction(source, "function isSourcePostResolutionReason(reason = '')"),
        extractFunction(source, 'function getQueuedPageResolvedProfileHref(claimedAction = {})')
    ].join('\n\n'), context, {filename: 'queued-page-resolution-harness.js'})

    return {
        state,
        resolve(claimedAction = {}) {
            return vm.runInContext(
                `getQueuedPageResolvedProfileHref(${JSON.stringify(claimedAction)})`,
                context
            )
        }
    }
}

test('active queued content progress is service-worker-only', () => {
    const body = extractFunction(
        readRepoFile('shared/js/content.js'),
        'async function recordProfileNukeProgress(href, patch = {})'
    )
    const queuedBranchStart = body.indexOf('if(useJobProtocol)')
    const compatibilityFallbackStart = body.indexOf("action: 'record-nuke-progress'")
    assert.notEqual(queuedBranchStart, -1)
    assert.notEqual(compatibilityFallbackStart, -1)
    assert.ok(queuedBranchStart < compatibilityFallbackStart)

    const queuedBranch = body.slice(queuedBranchStart, compatibilityFallbackStart)

    assert.match(queuedBranch, /record-job-terminal/)
    assert.match(queuedBranch, /record-job-milestone/)
    assert.match(queuedBranch, /profileNukeProgress = pruneProfileNukeProgress/)
    assert.match(queuedBranch, /serviceWorkerOnly: true/)
    assert.match(queuedBranch, /return\s+\{/)
})

test('queued record-nuke-progress requests are rerouted to job progress', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function recordProfileNukeProgressFromRequest(request = {}, sender = {})'
    )

    assert.match(body, /metadata\?\.attemptId/)
    assert.match(body, /compatibility: false/)
    assert.match(body, /compatibility: true/)
    assert.match(body, /getCoordinatorStatusFromProgress/)
    assert.match(body, /expectTerminal: isTerminalCoordinatorStatus\(mapped\.status\)/)
})

test('dashboard initial load prefers compact queue view over full queue map', () => {
    const body = extractFunction(
        readRepoFile('shared/js/coordinator.js'),
        'async function loadState()'
    )
    const firstGet = body.slice(
        body.indexOf('const stored = await browser.storage.local.get'),
        body.indexOf('if(hasCoordinatorQueueView')
    )

    assert.match(firstGet, /COORDINATOR_QUEUE_VIEW_KEY/)
    assert.doesNotMatch(firstGet, /COORDINATOR_QUEUE_KEY/)
    assert.match(body, /refreshCompactQueueView\(\)/)
    assert.doesNotMatch(body, /browser\.storage\.local\.get\(\{\[COORDINATOR_QUEUE_KEY\]/)
})

test('dashboard live refresh avoids broad storage change delivery', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const refreshBody = extractFunction(dashboard, 'async function refreshDashboardStateFromCompactStorage()')
    const loadBody = extractFunction(dashboard, 'async function loadState()')

    assert.doesNotMatch(dashboard, /storage\.onChanged/)
    assert.doesNotMatch(dashboard, /COORDINATOR_QUEUE_KEY/)
    assert.doesNotMatch(dashboard, /QUEUE_WAKEUP_METRICS_KEY/)
    assert.match(dashboard, /DASHBOARD_COMPACT_REFRESH_INTERVAL_MS/)
    assert.match(dashboard, /installCompactStorageRefreshPolling/)
    assert.match(dashboard, /installDashboardRuntimeRefreshListener/)
    assert.match(dashboard, /coordinator-dashboard-state-changed/)
    assert.match(dashboard, /scheduleDashboardCompactRefresh\(DASHBOARD_COMPACT_REFRESH_PUSH_DELAY_MS\)/)
    assert.match(refreshBody, /loadState\(\)/)
    assert.doesNotMatch(refreshBody, /browser\.storage\.local\.get/)
    assert.match(loadBody, /\[COORDINATOR_QUEUE_VIEW_KEY\]: \{\}/)
    assert.match(loadBody, /\[QUEUE_WAKEUP_METRICS_VIEW_KEY\]: \{\}/)
})

test('missing dashboard queue view is regenerated by service worker', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const refreshBody = extractFunction(dashboard, 'async function refreshCompactQueueView()')
    const sw = readRepoFile('shared/js/sw.js')
    const refreshSwBody = extractFunction(sw, "async function refreshCoordinatorQueueViewForDashboard(reason = 'dashboard-refresh')")

    assert.match(refreshBody, /action: 'refresh-coordinator-queue-view'/)
    assert.match(refreshBody, /applyCoordinatorQueueView\(result\.view\)/)
    assert.doesNotMatch(refreshBody, /COORDINATOR_QUEUE_KEY/)
    assert.match(refreshSwBody, /loadCoordinatorQueueProjection\(\{[\s\S]*metricPath: `queueView\.\$\{reason\}`/)
    assert.match(refreshSwBody, /buildCoordinatorQueueView\(queue\)/)
    assert.match(sw, /request\.action === 'refresh-coordinator-queue-view'/)
})

test('queue saves maintain compact dashboard queue view', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function saveCoordinatorState(state = {}, changes = {})'
    )
    const queueBranch = body.slice(
        body.indexOf('if(changes.queue)'),
        body.indexOf('if(changes.runs)')
    )

    assert.match(queueBranch, /COORDINATOR_QUEUE_VIEW_KEY/)
    assert.match(queueBranch, /buildCoordinatorQueueView\(queue\)/)
})

test('service worker pushes compact dashboard refresh after compact state writes', () => {
    const source = readRepoFile('shared/js/sw.js')
    const setBody = extractFunction(source, 'async function metricStorageSet(payload = {}, options = {})')
    const notifyBody = extractFunction(source, 'function notifyCoordinatorDashboardStateChanged(keys = [], reason = \'\')')

    assert.match(source, /COORDINATOR_DASHBOARD_STATE_KEYS/)
    assert.match(setBody, /notifyCoordinatorDashboardStateChanged\(keys, pathName\)/)
    assert.match(notifyBody, /COORDINATOR_DASHBOARD_STATE_KEYS\.has\(key\)/)
    assert.match(notifyBody, /action: 'coordinator-dashboard-state-changed'/)
    assert.doesNotMatch(notifyBody, /COORDINATOR_QUEUE_KEY/)
    assert.doesNotMatch(notifyBody, /PROFILE_NUKE_PROGRESS_KEY/)
})

test('storage get records read payload metrics', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function metricStorageGet(defaults = {}, options = {})'
    )

    assert.match(body, /const pathName = getStorageMetricPathName\(options\)/)
    assert.match(body, /recordStoragePathLatencyMetrics\('read', pathName/)
    assert.match(body, /recordStorageReadPayloadMetrics\(result, pathName\)/)
})

test('storage payload metrics are attributed by call path', () => {
    const source = readRepoFile('shared/js/sw.js')
    const getBody = extractFunction(source, 'async function metricStorageGet(defaults = {}, options = {})')
    const setBody = extractFunction(source, 'async function metricStorageSet(payload = {}, options = {})')
    const saveBody = extractFunction(source, 'async function saveCoordinatorState(state = {}, changes = {})')

    assert.match(source, /function getStorageMetricPathName/)
    assert.match(source, /function recordStoragePathPayloadMetrics/)
    assert.match(source, /function recordStoragePathLatencyMetrics/)
    assert.match(getBody, /recordStorageReadPayloadMetrics\(result, pathName\)/)
    assert.match(setBody, /recordStoragePayloadMetrics\(payload, pathName\)/)
    assert.match(setBody, /recordQueueWriteOperationMetrics\(payload, options\)/)
    assert.match(saveBody, /metricPath: changes\.metricPath \|\| `reason\.\$\{snapshotWriteReason\}`/)
    assert.match(saveBody, /queueSnapshotWriteReason: snapshotWriteReason/)
    assert.match(saveBody, /queueOperation: changes\.queueOperation/)
    assert.match(saveBody, /queueChangedRows: changes\.queueChangedRows/)
    assert.match(source, /metricPath: `\$\{metricPath\}\.save`/)
})

test('queued terminal progress stays service-worker authoritative', () => {
    const source = readRepoFile('shared/js/content.js')
    const recordBody = extractFunction(source, 'async function recordProfileNukeProgress(href, patch = {})')
    const queuedBranchStart = recordBody.indexOf('if(useJobProtocol)')
    const compatibilityFallbackStart = recordBody.indexOf("action: 'record-nuke-progress'")
    assert.notEqual(queuedBranchStart, -1)
    assert.notEqual(compatibilityFallbackStart, -1)
    const queuedBranch = recordBody.slice(queuedBranchStart, compatibilityFallbackStart)

    assert.match(recordBody, /mapped\.terminal/)
    assert.match(queuedBranch, /record-job-terminal/)
    assert.doesNotMatch(source, /persistTerminalProfileProgressFallback/)
    assert.doesNotMatch(queuedBranch, /safeStorageSet/)
    assert.doesNotMatch(queuedBranch, /PROFILE_NUKE_PROGRESS_KEY/)
})

test('content terminal mapping delegates to shared job state reducer', () => {
    const source = readRepoFile('shared/js/content.js')
    const mapperBody = extractFunction(source, 'function mapProfileProgressToCoordinatorRepair(record = {})')

    assert.match(source, /mapProgressToCoordinatorState/)
    assert.match(mapperBody, /mapProgressToCoordinatorState\(record\)/)
    assert.doesNotMatch(mapperBody, /status === 'error-page'/)
    assert.doesNotMatch(mapperBody, /isSuccessfulUnblockUnmuteProgressRecord/)
})

test('queued nonterminal job milestones are deferred, terminal writes stay synchronous', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function recordJobProgressFromRequest(request = {}, sender = {}, options = {})'
    )
    const nonterminalIndex = body.indexOf('recordDeferredCoordinatorJobMilestone')
    const clearPendingIndex = body.indexOf('clearPendingCoordinatorJobMilestone')
    const terminalIndex = body.indexOf('recordCoordinatorJobProgress')

    assert.notEqual(nonterminalIndex, -1)
    assert.notEqual(clearPendingIndex, -1)
    assert.notEqual(terminalIndex, -1)
    assert.ok(nonterminalIndex < clearPendingIndex)
    assert.ok(clearPendingIndex < terminalIndex)
    assert.match(body, /if\(options\.expectTerminal !== true\)/)
})

test('deferred queued milestones coalesce and flush before acknowledgement', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function recordDeferredCoordinatorJobMilestone(profileHref = \'\', patch = {}, options = {})'
    )
    const source = readRepoFile('shared/js/sw.js')

    assert.match(source, /COORDINATOR_JOB_MILESTONE_FLUSH_MS/)
    assert.match(source, /coordinatorJobMilestonePendingRecords/)
    assert.match(body, /coordinatorJobMilestonePendingRecords\[normalizedHref\] = record/)
    assert.match(body, /const durable = await flushCoordinatorJobMilestones\(\)/)
    assert.match(body, /const rowResult = durable\?\.results\?\.\[normalizedHref\]/)
    assert.match(body, /recorded: false/)
    assert.match(body, /durable: rowResult\.recorded === true/)
    assert.doesNotMatch(body, /recordCoordinatorJobProgress\(/)
    assert.doesNotMatch(body, /saveCoordinatorState/)
})

test('deferred milestones merge with newer in-memory progress before durable writes', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})'
    )

    assert.match(body, /mergeStoredProfileProgressRecord/)
    assert.match(body, /progress\[normalizedHref\] \|\| null/)
    assert.match(body, /profileNukeProgress\?\.\[normalizedHref\] \|\| null/)
})

test('late tab-opening breadcrumbs cannot erase same-attempt action progress', () => {
    const source = readRepoFile('shared/js/sw.js')
    const mergeBody = extractFunction(source, 'function mergeStoredProfileProgressRecord(existing = null, incoming = null, normalizedHref = \'\')')
    const normalizeBody = extractFunction(source, 'function normalizeProgressPatch(profileHref, patch = {}, existing = null)')
    const preserveBody = extractFunction(source, 'function preserveAdvancedProfileProgress(previous = {}, next = {})')

    assert.match(source, /function getProfileProgressStatusRank/)
    assert.match(source, /function profileProgressAttemptsMatch/)
    assert.match(preserveBody, /previousRank >= 0 && nextRank >= 0 && previousRank > nextRank/)
    assert.match(preserveBody, /contentOpenedAt/)
    assert.match(preserveBody, /blockAttemptedAt/)
    assert.match(mergeBody, /preserveAdvancedProfileProgress\(older, merged\)/)
    assert.match(normalizeBody, /preserveAdvancedProfileProgress\(previous, next\)/)
})

test('late terminal failure cannot demote a same-attempt successful progress record', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'function shouldPreserveTerminalProfileProgress(previous = {}, incoming = {})'
    )

    assert.match(body, /isSuccessfulProfileNukeRecord\(previous\)/)
    assert.match(body, /mapProgressToCoordinatorState\(incoming\)/)
    assert.match(body, /incomingMapped\.status === 'failed'/)
    assert.match(body, /incomingMapped\.status === 'skipped'/)
})

test('metadata-only progress does not drive Current Work status transitions', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(
        source,
        'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})'
    )
    const tabUpdatedIndex = source.indexOf('browser.tabs.onUpdated.addListener')
    const tabUpdatedBody = source.slice(tabUpdatedIndex, tabUpdatedIndex + 1800)

    assert.match(source, /function progressPatchHasExplicitStatus\(patch = \{\}\)/)
    assert.match(source, /function shouldApplyExplicitProgressStatusToCoordinatorItem\(item = \{\}, patch = \{\}, options = \{\}\)/)
    assert.match(body, /const patchHasStatus = progressPatchHasExplicitStatus\(patch\)/)
    assert.match(body, /const patchCanTransitionStatus = item/)
    assert.match(body, /patchCanTransitionStatus \|\| preferSuccessfulTerminal/)
    assert.match(tabUpdatedBody, /recordCoordinatorJobProgress\(metadata\.profileHref, \{\s*lastUrl,/)
    assert.doesNotMatch(tabUpdatedBody, /status: 'queued'/)
})

test('stale tab close cannot fail a requeued Current Work row', () => {
    const source = readRepoFile('shared/js/sw.js')
    const guardBody = extractFunction(
        source,
        'function shouldApplyExplicitProgressStatusToCoordinatorItem(item = {}, patch = {}, options = {})'
    )

    assert.match(guardBody, /status === 'interrupted'/)
    assert.match(guardBody, /senderTabId/)
    assert.match(guardBody, /itemTabId/)
    assert.match(guardBody, /isActiveCoordinatorStatus\(item\?\.status \|\| ''\) && itemTabId === senderTabId/)
})

test('repair preserves expected live tabs for resume adoption', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(
        source,
        'function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = \'\', liveProfileTabsByHref = new Map(), now = Date.now())'
    )
    const runtimeActorBody = extractFunction(
        source,
        'function hasConfirmedRuntimeActorForCoordinatorItem(item = null, record = null)'
    )

    assert.match(body, /getOwnedOrExpectedLiveTabsForProfileHref/)
    assert.match(body, /getOwnedOrExpectedLiveTabsForProfileHref\(item, record, href, liveProfileTabsByHref\)\.length\) return false/)
    assert.match(body, /hasConfirmedRuntimeActorForCoordinatorItem\(item, record\)/)
    assert.match(runtimeActorBody, /isDurablyActiveQueuedTab\(tabId\)/)
    assert.match(runtimeActorBody, /getAttemptIdFromValue\(item\) \|\| getAttemptIdFromValue\(record\)/)
    assert.match(runtimeActorBody, /metadataAttemptId !== expectedAttemptId/)
})

test('active queued action phase uses its own wall clock cap', () => {
    const source = readRepoFile('shared/js/sw.js')
    const helper = extractFunction(
        source,
        'function hasActiveQueuedTabActionPhaseProgress(record = null, metadata = null)'
    )
    const sweep = extractFunction(
        source,
        'async function sweepStaleQueuedTabs(parentTabId = null)'
    )
    const staleTimeout = extractFunction(
        source,
        'function getActiveQueuedTabStaleTimeoutMs(record, metadata = null)'
    )
    const staleAnchor = extractFunction(
        source,
        'function getPersistedActiveProgressStaleAnchor(record = null)'
    )

    assert.match(source, /COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS/)
    assert.doesNotMatch(helper, /actionReadyAt/)
    assert.match(helper, /muteAttemptedAt/)
    assert.match(helper, /blockAttemptedAt/)
    assert.match(helper, /unmuteAttemptedAt/)
    assert.match(helper, /unblockAttemptedAt/)
    assert.match(staleTimeout, /closeRequestedAt/)
    assert.match(staleTimeout, /slotReleasedAt/)
    assert.match(staleTimeout, /STALE_CLOSE_REQUESTED_QUEUED_TAB_MS/)
    assert.match(staleAnchor, /record\.closeRequestedAt/)
    assert.match(staleAnchor, /record\.slotReleasedAt/)
    assert.match(sweep, /hasActiveQueuedTabActionPhaseProgress/)
    assert.match(sweep, /COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS/)
})

test('hidden queued profile actions use longer readiness when foreground is disabled', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(
        source,
        'async function maybeRunAutoProfileAction()'
    )

    assert.match(source, /HIDDEN_PROFILE_READY_FAST_PROBE_MS = 3500/)
    assert.match(source, /HIDDEN_PROFILE_READY_NO_FOREGROUND_MS = 12000/)
    assert.match(source, /VISIBLE_PROFILE_READY_MS = 25000/)
    assert.match(body, /document\.visibilityState === 'visible'[\s\S]*VISIBLE_PROFILE_READY_MS[\s\S]*allowForegroundFallback[\s\S]*HIDDEN_PROFILE_READY_FAST_PROBE_MS[\s\S]*HIDDEN_PROFILE_READY_NO_FOREGROUND_MS/)
})

test('service-worker-owned progress mirror sync does not transition queue rows', () => {
    const source = readRepoFile('shared/js/sw.js')
    const syncBody = extractFunction(
        source,
        'async function syncCoordinatorProgressRecordsLocked(progressRecords = {})'
    )
    const authoritativeBranchStart = syncBody.indexOf('if(isCoordinatorQueueAuthoritativeItem(item))')
    const firstAuthoritativeBranch = syncBody.slice(
        authoritativeBranchStart,
        syncBody.indexOf('if(item.runId) affectedRunIds.add(item.runId)', authoritativeBranchStart)
    )
    const repairAuthoritativeBranch = source.slice(
        source.indexOf('if(queueAuthoritative && !reconciledMissingActive)'),
        source.indexOf('const mapped = mappedForAuthoritativeItem', source.indexOf('if(queueAuthoritative && !reconciledMissingActive)'))
    )

    assert.doesNotMatch(firstAuthoritativeBranch, /transitionCoordinatorItemFromProgress/)
    assert.match(syncBody, /loadCoordinatorQueueRunsProgressProjection\(\{[\s\S]*metricPath: 'compatibilityProgressSync\.load'/)
    assert.doesNotMatch(syncBody, /loadCoordinatorState\(/)
    assert.match(repairAuthoritativeBranch, /isTerminalCoordinatorStatus\(mappedForAuthoritativeItem\.status\)/)
    assert.match(repairAuthoritativeBranch, /continue/)
})

test('stale active repair ignores queued mirror records as liveness', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = \'\', liveProfileTabsByHref = new Map(), now = Date.now())'
    )

    assert.match(body, /recordStatus !== 'queued'/)
    assert.match(body, /const staleRecord = recordIsActiveEvidence \? record : null/)
})

test('repair returns after saving stale-active cleanup', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function repairCoordinatorStorageFromProgressLocked()')
    const pauseMaterializerBody = extractFunction(source, 'function materializeCoordinatorRunsPausedStateFromControl(queue = {}, runs = {}, paused = false, now = Date.now())')
    const saveIndex = body.indexOf('await saveCoordinatorState')
    const settleIndex = body.indexOf('await settleTerminalCoordinatorItemsLocked')

    assert.notEqual(saveIndex, -1)
    assert.notEqual(settleIndex, -1)
    assert.ok(saveIndex < settleIndex)
    assert.match(body, /loadCoordinatorRepairProjection\(\{[\s\S]*metricPath: 'repair\.load'/)
    assert.doesNotMatch(body, /loadCoordinatorState\(/)
    assert.match(body, /materializeCoordinatorRunsPausedStateFromControl\([\s\S]*state\.stored\?\.\[COORDINATOR_PAUSED_KEY\] === true/)
    assert.match(pauseMaterializerBody, /isPendingCoordinatorStatus/)
    assert.match(pauseMaterializerBody, /paused,\s*status,/)
})

test('space-feed storage update queue has a watchdog', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(
        source,
        'function enqueueSpaceFeedStorageUpdate(update, options = {})'
    )
    const saveBody = extractFunction(source, 'async function saveCoordinatorState(state = {}, changes = {})')

    assert.match(source, /SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS/)
    assert.match(body, /Promise\.race/)
    assert.match(body, /space-feed storage update/)
    assert.match(body, /const updateToken = \+\+spaceFeedStorageUpdateSerial/)
    assert.match(body, /activeSpaceFeedStorageUpdateToken = updateToken/)
    assert.match(body, /const previousUpdate = spaceFeedStorageUpdatePromise\.catch\(\(\) => null\)/)
    assert.match(body, /abandonedSpaceFeedStorageUpdates\.add\(updateToken\)/)
    assert.match(body, /spaceFeedStorageUpdatePromise = updatePromise\.catch\(\(\) => null\)/)
    assert.doesNotMatch(body, /spaceFeedStorageUpdatePromise = callerPromise\.catch\(\(\) => null\)/)
    assert.match(body, /catch\(error => \{[\s\S]*storageUpdate\.fallbackReturned[\s\S]*return options\.failureValue \?\? false/)
    assert.match(body, /storageUpdate\.started/)
    assert.match(body, /storageUpdate\.completed/)
    assert.match(body, /storageUpdate\.timedOut/)
    assert.match(body, /storageUpdate\.tailWedged/)
    assert.match(body, /storageUpdate\.skippedAbandoned/)
    assert.match(body, /storageUpdate\.deadlineMissed/)
    assert.match(body, /storageUpdate\.abandoned/)
    assert.match(body, /isStorageUpdateAbandoned\(updateToken\)/)
    assert.match(source, /ownStorageGetMs/)
    assert.match(source, /ownStorageSetMs/)
    assert.match(source, /storageGetCumulativeMs/)
    assert.match(source, /storageSetCumulativeMs/)
    assert.match(saveBody, /storageUpdate\.lateWriteSuppressed/)
    assert.match(saveBody, /progress\.changedRecordsPerStorageWrite/)
    assert.match(saveBody, /progress\.payloadRowsPerStorageWrite/)
    assert.match(saveBody, /getActiveStorageUpdateToken\(\)/)
    assert.match(saveBody, /isStorageUpdateAbandoned\(updateToken\)/)
    assert.doesNotMatch(body, /previous space-feed storage update/)
    assert.doesNotMatch(body, /timedOut:/)
})

test('queue wakeup metrics expose storage pressure without conflating fields', () => {
    const helper = readRepoFile('tools/cdp/queue-wakeup-metrics.js')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const worker = readRepoFile('shared/js/sw.js')
    const html = readRepoFile('shared/coordinator.html')

    assert.match(helper, /chrome\.storage\.local\.get\(\{\[key\]: null\}, storage =>/)
    assert.match(helper, /currentEpoch/)
    assert.match(helper, /previousEpochs/)
    assert.match(helper, /storageDeadlineMissed/)
    assert.match(helper, /deadlineMissRatePct/)
    assert.match(helper, /changedRecordsPerStorageWrite/)
    assert.match(helper, /payloadRowsPerStorageWrite/)
    assert.match(helper, /ownStorageGetMs is merged wall time/)

    assert.match(worker, /currentEpoch/)
    assert.match(worker, /previousEpochs/)
    assert.match(worker, /lifetime/)
    assert.match(worker, /QUEUE_WAKEUP_METRICS_VIEW_KEY/)
    assert.match(worker, /buildQueueWakeupMetricsView/)
    assert.match(worker, /MAX_QUEUE_WAKEUP_METRICS_VIEW_JOURNAL/)
    assert.match(worker, /refreshQueueWakeupMetricsViewForDashboard/)
    assert.match(worker, /BROWSER_SESSION_MARKER_KEY/)
    assert.match(worker, /globalThis\.chrome\?\.storage\?\.session/)
    assert.match(worker, /ensureBrowserSessionStartupMetricsReset/)
    assert.match(worker, /clearSchedulerAlarms/)
    assert.match(worker, /scheduler-alarms-cleared/)
    assert.match(worker, /pendingQueueWakeupMetricsReset = \{[\s\S]*reason: 'browser-startup'/)
    assert.match(worker, /resetQueueWakeupMetricsEpochAfterLoad\(resetReason, \{deferUntilQuora: true\}\)/)
    assert.match(worker, /reset-queue-wakeup-metrics/)
    assert.match(worker, /firstServiceWorkerStartedAt/)
    assert.match(worker, /lastServiceWorkerStartedAt/)
    assert.match(worker, /epoch\.counters\['serviceWorker\.started'\] = 1/)
    assert.match(worker, /summarizeQueueWakeupMetricEpoch/)
    assert.match(worker, /MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY/)
    assert.match(worker, /if\(!hasBrowserSessionStorage\(\)\) \{[\s\S]*browser\.runtime\.onStartup\.addListener/)
    assert.ok(
        worker.indexOf('if(!hasBrowserSessionStorage())') <
        worker.indexOf('browser.runtime.onStartup.addListener')
    )

    assert.match(html, /resetMetricsButton/)
    assert.match(dashboard, /reset-queue-wakeup-metrics/)
    assert.match(dashboard, /QUEUE_WAKEUP_METRICS_VIEW_KEY/)
    assert.match(dashboard, /refresh-queue-wakeup-metrics-view/)
    assert.match(dashboard, /formatPreviousEpochSummary/)
    assert.match(dashboard, /Current epoch/)
    assert.match(dashboard, /getSecondsPerActualBlock\(queueItems, getCurrentMetricsEpochStartedAt\(\)\)/)
    assert.match(dashboard, /function getCurrentMetricsEpochStartedAt\(\)/)
    assert.match(dashboard, /milestones\.blockAttemptedAt/)
    assert.match(dashboard, /terminalAt >= minimumTerminalAt/)
    assert.match(dashboard, /Storage deadlines/)
    assert.match(dashboard, /Timeout buckets/)
    assert.match(dashboard, /No-work writes/)
    assert.match(dashboard, /Payload sources/)
    assert.match(dashboard, /Progress changed/)
    assert.match(dashboard, /Progress payload/)
    assert.match(dashboard, /function formatMetricDetailValue/)
    assert.match(dashboard, /ownStorageGetMs/)
    assert.match(dashboard, /storageGetCumulativeMs/)
})

test('dashboard loads durable history before first Quora activation without resuming work', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const initBody = extractFunction(dashboard, 'async function init()')
    const resumeBody = extractFunction(dashboard, 'function syncCoordinatorQueueResume(queueItems = [])')

    assert.match(initBody, /render\(\)[\s\S]*const ready = await announceCoordinatorPageReady\(\)/)
    assert.match(initBody, /setQuoraVisitRequirement\(\s*!ready \|\| !!ready\?\.requiresQuoraVisit\s*\)/)
    assert.match(initBody, /await loadState\(\)/)
    assert.match(initBody, /captureQuoraActivationMetricBaseline\(\)/)
    assert.doesNotMatch(initBody, /if\(ready\?\.requiresQuoraVisit\)[\s\S]{0,120}return/)
    assert.match(initBody, /if\(!state\.requiresQuoraVisit && hasRawPendingCoordinatorQueueWork\(\)\)[\s\S]*repairCoordinatorStorageAfterInitialRender/)
    assert.match(dashboard, /Loading history\.\.\./)
    assert.match(dashboard, /Waiting for first Quora page/)
    assert.match(dashboard, /\[QUEUE_WAKEUP_METRICS_VIEW_KEY\]: \{\}/)
    assert.doesNotMatch(extractFunction(dashboard, 'async function loadState()'), /\[QUEUE_WAKEUP_METRICS_KEY\]: \{\}/)
    assert.match(resumeBody, /state\.loading \|\| state\.requiresQuoraVisit/)
    assert.match(resumeBody, /return[\s\S]*if\(state\.paused\)/)
})

test('dashboard waiting banner clears from current-epoch activation evidence', () => {
    const evaluate = loadDashboardHarness()

    const staleActivationBeforeRequirementStillWaits = evaluate(`
        state.metrics = {
            currentEpoch: {
                startedAt: 1000,
                counters: {'runtime.quoraActivated': 1},
                journal: [{name: 'quora-runtime-activated', at: 1500}]
            }
        }
        state.queue = {}
        setQuoraVisitRequirement(true)
        state.requiresQuoraVisitAt = 2000
        captureQuoraActivationMetricBaseline()
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(staleActivationBeforeRequirementStillWaits, true)

    const staleActiveStillWaits = evaluate(`
        state.requiresQuoraVisit = true
        state.requiresQuoraVisitAt = 1000
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queue = {old: {status: 'active', activeAt: 900, updatedAt: 900}}
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(staleActiveStillWaits, true)

    const queuedOnlyStillWaits = evaluate(`
        state.requiresQuoraVisit = true
        state.requiresQuoraVisitAt = 1000
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queue = {queued: {status: 'queued', queuedAt: 1200, updatedAt: 1200}}
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(queuedOnlyStillWaits, true)

    const freshActiveClears = evaluate(`
        setQuoraVisitRequirement(true)
        state.requiresQuoraVisitAt = 1000
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queue = {active: {status: 'active', activeAt: 1200, updatedAt: 1200}}
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(freshActiveClears, false)

    const freshTerminalClears = evaluate(`
        setQuoraVisitRequirement(true)
        state.requiresQuoraVisitAt = 1000
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queue = {done: {status: 'succeeded', terminalAt: 1200, updatedAt: 1200}}
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(freshTerminalClears, false)

    const terminalMetricClears = evaluate(`
        setQuoraVisitRequirement(true)
        state.requiresQuoraVisitAt = 1000
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {'job.terminal': 1}, journal: []}}
        state.queue = {}
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(terminalMetricClears, false)

    const activationMetricClears = evaluate(`
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {'runtime.quoraActivated': 1}, journal: []}}
        setQuoraVisitRequirement(true)
        state.requiresQuoraVisitAt = 1000
        captureQuoraActivationMetricBaseline()
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {'runtime.quoraActivated': 2}, journal: []}}
        state.queue = {}
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(activationMetricClears, false)
})

test('dashboard secs per block uses compact queue-view aggregate when terminal rows are truncated', () => {
    const evaluate = loadDashboardHarness()
    const result = evaluate(`(() => {
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queueView = {
            version: 1,
            total: 200,
            truncated: true,
            actualBlockTiming: {
                epochStartedAt: 1000,
                blocks: 12,
                elapsedMs: 48000,
                seconds: 4
            }
        }
        state.queue = Object.fromEntries(Array.from({length: 80}, (_, index) => [
            'queued-' + index,
            {status: 'queued', queuedAt: 1100 + index, updatedAt: 1100 + index}
        ]))
        const aggregateResult = getSecondsPerActualBlock(getDisplayQueueItems(), getCurrentMetricsEpochStartedAt())

        state.queueView.actualBlockTiming.epochStartedAt = 900
        var mismatchedEpochResult = getSecondsPerActualBlock(getDisplayQueueItems(), getCurrentMetricsEpochStartedAt());

        return {
            aggregateText: formatSecondsPerBlock(aggregateResult),
            aggregateBlocks: aggregateResult.blocks,
            staleText: formatSecondsPerBlock(mismatchedEpochResult)
        }
    })()`)

    assert.equal(result.aggregateText, '4.00')
    assert.equal(result.aggregateBlocks, 12)
    assert.equal(result.staleText, '--')
})

test('dashboard layout keeps current work first and panel blocks wheel-scroll their entries', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const css = readRepoFile('shared/css/coordinator.css')
    const currentWorkIndex = html.indexOf('data-panel-scroll-target="queueList"')
    const summaryIndex = html.indexOf('class="summary-grid"')
    const metricsIndex = html.indexOf('data-panel-scroll-target="metricsJournal"')
    const runsIndex = html.indexOf('data-panel-scroll-target="runList"')
    const eventsIndex = html.indexOf('data-panel-scroll-target="eventList"')

    assert.ok(currentWorkIndex >= 0)
    assert.ok(currentWorkIndex < summaryIndex)
    assert.ok(summaryIndex < metricsIndex)
    assert.ok(metricsIndex < runsIndex)
    assert.ok(runsIndex < eventsIndex)
    assert.match(html, /0 ready, 0 succeeded, 0 soft-fail 0 hard-fail/)
    assert.match(html, /Queue All-fails/)
    assert.match(html, /Cancel Queue/)
    assert.match(html, /Retry Soft-Fails/)
    assert.doesNotMatch(html, /Requeue Failed|Cancel Current Work|Idle Retry/)
    assert.match(dashboard, /installPanelWheelScrollListeners\(\)/)
    assert.match(dashboard, /document\.querySelectorAll\('\[data-panel-scroll-target\]'\)/)
    assert.match(dashboard, /scrollTarget\.scrollBy\(/)
    assert.match(dashboard, /const succeededCount = getQueueStatusCount\('succeeded', queueItems\)/)
    assert.match(dashboard, /const hardFailedCount = Math\.max\(0, failedCount - retryableFailedCount\)/)
    assert.match(dashboard, /setText\('currentWorkReadyCount', `\$\{queuedCount\} ready, \$\{succeededCount\} succeeded, \$\{retryableFailedCount\} soft-fail \$\{hardFailedCount\} hard-fail`\)/)
    assert.match(dashboard, /button\.textContent = 'Retry Soft-Fails'/)
    assert.doesNotMatch(dashboard, /eligible \/ \$\{failedCount\} failed/)
    assert.doesNotMatch(dashboard, /button\.textContent = 'Idle Retry'/)
    assert.match(css, /grid-template-rows: auto auto;/)
    assert.match(css, /\.summary-value\s*\{[\s\S]*font-size: 22px;/)
    assert.match(css, /\.metric-value\s*\{[\s\S]*font-size: 16px;/)
    assert.match(css, /\.panel-stack \.panel\s*\{[\s\S]*flex: 0 0 auto;/)
    assert.match(css, /\.panel-stack \.panel\[data-panel-scroll-target="metricsJournal"\]\s*\{[\s\S]*max-height: none;/)
    assert.match(css, /\.metrics-panel\s*\{[\s\S]*flex: 0 0 auto;/)
    assert.match(css, /\.metrics-journal\s*\{[\s\S]*max-height: none;[\s\S]*overflow-y: visible;/)
})

test('dashboard retry status separates active busy from queued waiting states', () => {
    const evaluate = loadDashboardHarness()
    const result = evaluate(`
        const writes = {}
        globalThis.document = {
            getElementById(id) {
                return {
                    set textContent(value) { writes[id] = value },
                    get textContent() { return writes[id] || '' },
                    setAttribute() {},
                    disabled: false,
                    title: ''
                }
            }
        }

        retryFailedActive = false
        retryFailedLastResult = null

        setQuoraVisitRequirement(true)
        state.queue = {queued: {status: 'queued'}}
        syncRetryFailedControls(getDisplayQueueItems(), 12, 0)
        const waitingForQuora = writes.retryFailedState

        setQuoraVisitRequirement(false)
        state.queue = {queued: {status: 'queued'}}
        syncRetryFailedControls(getDisplayQueueItems(), 12, 0)
        const queuedWaiting = writes.retryFailedState

        state.queue = {active: {status: 'active'}}
        syncRetryFailedControls(getDisplayQueueItems(), 12, 0)
        const activeBusy = writes.retryFailedState

        ;({waitingForQuora, queuedWaiting, activeBusy})
    `)

    assert.equal(result.waitingForQuora, 'Soft-fail retry off; waiting for first Quora page')
    assert.equal(result.queuedWaiting, 'Soft-fail retry off; queued work is waiting to start')
    assert.equal(result.activeBusy, 'Soft-fail retry off; waiting for current work to idle')
})

test('dashboard bulk requeue uses compact failed count beyond displayed rows', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const body = extractFunction(dashboard, 'async function requeueFailed()')

    assert.match(body, /getQueueStatusCount\('failed', getDisplayQueueItems\(\)\)/)
    assert.doesNotMatch(body, /filter\(item => item\?\.status === 'failed'\)/)
    assert.match(body, /action: 'requeue-coordinator-failed'/)
})

test('dashboard queued rows expose per-item cancel before status', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const sw = readRepoFile('shared/js/sw.js')
    const css = readRepoFile('shared/css/coordinator.css')
    const renderBody = extractFunction(dashboard, 'function renderQueue(items)')
    const cancelCellBody = extractFunction(dashboard, 'function buildQueueCancelCell(item = {})')
    const cancelItemBody = extractFunction(dashboard, 'async function cancelCurrentWorkItem(item = {})')
    const cancelStoredBody = extractFunction(sw, 'async function cancelStoredCoordinatorWork(options = {})')
    const projectionBody = extractFunction(sw, 'async function mutateCoordinatorProjection(operation = {})')
    const cancelItemMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkItemCancel(operation = {})')
    const cancelMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkCancel(operation = {})')
    const messageStart = sw.indexOf("request.action === 'cancel-coordinator-current-work-item'")

    assert.match(renderBody, /buildQueueCancelCell\(item\),\s*buildBadge\(item\.status \|\| 'unknown'\)/)
    assert.match(cancelCellBody, /isPendingQueueStatus/)
    assert.match(cancelCellBody, /button\.textContent = 'Cancel'/)
    assert.match(cancelCellBody, /cancelCurrentWorkItem\(item\)/)
    assert.match(cancelItemBody, /action: 'cancel-coordinator-current-work-item'/)
    assert.match(cancelStoredBody, /kind: hasTarget \? 'cancelStoredWorkItem' : 'cancelStoredWork'/)
    assert.match(cancelStoredBody, /coordinatorKey,/)
    assert.match(cancelStoredBody, /storageKey,/)
    assert.match(cancelStoredBody, /profileHref/)
    assert.match(projectionBody, /kind === 'cancelStoredWorkItem'/)
    assert.match(cancelItemMutationBody, /operationKind: 'current-work-item-cancel'/)
    assert.match(cancelItemMutationBody, /loadCoordinatorQueueRunsEventsProgressProjection\(\{[\s\S]*metricPath: 'currentWork\.itemCancel\.load'/)
    assert.doesNotMatch(cancelItemMutationBody, /loadCoordinatorState\(/)
    assert.match(cancelItemMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate/)
    assert.match(cancelItemMutationBody, /queue: false/)
    assert.match(cancelItemMutationBody, /queueOperation: 'current-work-item-cancel-derived'/)
    assert.match(cancelMutationBody, /const hasTarget = !!\(targetStorageKey \|\| targetCoordinatorKey \|\| targetHref\)/)
    assert.match(cancelMutationBody, /if\(hasTarget &&/)
    assert.match(sw, /'current-work-item-cancel'/)
    assert.notEqual(messageStart, -1)
    assert.match(css, /\.row--queue\s*\{[\s\S]*grid-template-columns: minmax\(180px, 1fr\) 80px 120px/)
    assert.match(css, /\.row-cancel-cell/)
    assert.match(css, /\.row-cancel-button/)
})

test('routine CDP queue status helpers use compact storage by default', () => {
    const compactHelpers = [
        'tools/cdp/queue-counts.js',
        'tools/cdp/current-work-filter.js',
        'tools/cdp/active-queue-rows.js',
        'tools/cdp/queue-failures.js'
    ]
    for(const helperPath of compactHelpers) {
        const source = readRepoFile(helperPath)
        assert.match(source, /mbCoordinatorQueueView/)
        assert.match(source, /usedCompactView/)
        assert.doesNotMatch(source, /mbCoordinatorQueue:/, `${helperPath} reads full queue by default`)
        assert.doesNotMatch(source, /mbProfileNukeProgress/, `${helperPath} reads full progress by default`)
    }

    const summary = readRepoFile('tools/cdp/queue-storage-summary.js')
    assert.match(summary, /parseBooleanOption\('include-full'\)/)
    assert.match(summary, /mbCoordinatorQueueView/)
    assert.match(summary, /usedCompactView: !includeFullRead/)
    assert.doesNotMatch(summary, /chrome\.storage\.local\.get\(\{[\s\S]*mbCoordinatorQueue:/)
    assert.doesNotMatch(summary, /chrome\.storage\.local\.get\(\{[\s\S]*mbProfileNukeProgress:/)
    assert.match(summary, /if\(includeFullRead\) \{[\s\S]*defaults\.mbCoordinatorQueue = \{\}[\s\S]*defaults\.mbProfileNukeProgress = \{\}/)
})

test('profile-search content uses scoped runtime state instead of full storage change stream', () => {
    const content = readRepoFile('shared/js/content.js')
    const initBody = extractFunction(content, 'async function init()')
    const searchBranchStart = initBody.indexOf("if(initialPage === 'profile-search')")
    const searchBranchEnd = initBody.indexOf('settings = await safeStorageGet(defaults)', searchBranchStart)
    const searchBranch = initBody.slice(searchBranchStart, searchBranchEnd)
    const scheduleBody = extractFunction(content, 'function scheduleProfileSearchControls(delay = 120)')
    const refreshBody = extractFunction(content, 'async function refreshContentPageCoordinatorStateFromRuntime(options = {})')
    const listenerBody = extractFunction(content, 'function setStorageChangeListenerEnabled(enabled)')
    const navigationBody = extractFunction(content, 'function installNavigationHooks()')
    const sw = readRepoFile('shared/js/sw.js')
    const swScopedBody = extractFunction(sw, 'async function getContentPageCoordinatorState(request = {}, sender = {})')
    const queueFallbackBody = extractFunction(sw, 'async function loadScopedCoordinatorQueueFallbackForContentPage(request = {}, profileHrefSet = new Set())')
    const shouldQueueFallbackBody = extractFunction(sw, 'function shouldLoadFullQueueForTruncatedContentPageState(queueIndex = null, request = {}, profileHrefs = [], scopedQueue = {})')
    const sourceRecordsBody = extractFunction(sw, 'function normalizeCoordinatorContentSourceIndexRecords(shards = {}, request = {})')
    const pendingRefreshBody = extractFunction(content, 'function scheduleProfileSearchPendingRefresh(delayMs = PROFILE_SEARCH_PENDING_REFRESH_MS)')
    const syncBody = extractFunction(content, 'function syncProfileSearchControls()')
    const nukeBody = extractFunction(content, 'async function nukeProfileSearchHrefs(button, hrefs = [], options = {})')

    assert.notEqual(searchBranchStart, -1)
    assert.notEqual(searchBranchEnd, -1)
    assert.doesNotMatch(searchBranch, /setStorageChangeListenerEnabled\(true\)/)
    assert.doesNotMatch(searchBranch, /addListener\(onStorageChanged\)/)
    assert.doesNotMatch(searchBranch, /refreshCoordinatorQueueFromStorage\(\)/)
    assert.doesNotMatch(searchBranch, /refreshProfileNukeProgressFromStorage\(\)/)
    assert.match(searchBranch, /refreshContentPageCoordinatorStateFromRuntime\(\{force: true\}\)/)
    assert.match(scheduleBody, /await refreshContentPageCoordinatorStateFromRuntime\(\)/)
    assert.match(refreshBody, /action: 'get-content-page-coordinator-state'/)
    assert.match(refreshBody, /profileHrefs/)
    assert.match(pendingRefreshBody, /refreshContentPageCoordinatorStateFromRuntime\(\{force: true\}\)/)
    assert.match(pendingRefreshBody, /syncProfileSearchControls\(\)/)
    assert.match(syncBody, /pendingSearchCount > 0[\s\S]*scheduleProfileSearchPendingRefresh\(\)/)
    assert.match(nukeBody, /queued > 0[\s\S]*scheduleProfileSearchPendingRefresh\(\)/)
    assert.match(listenerBody, /source\.addListener\(onStorageChanged\)/)
    assert.match(listenerBody, /source\.removeListener\?\.\(onStorageChanged\)/)
    assert.match(navigationBody, /setStorageChangeListenerEnabled\(page !== 'profile-search'\)/)
    assert.match(sw, /request\.action === 'get-content-page-coordinator-state'/)
    assert.match(swScopedBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_CONTENT_QUEUE_INDEX_KEY\]: null,[\s\S]*\[PROFILE_NUKE_PROGRESS_VIEW_KEY\]: null/)
    assert.doesNotMatch(swScopedBody, /\[COORDINATOR_QUEUE_KEY\]: \{\}/)
    assert.doesNotMatch(swScopedBody, /\[PROFILE_NUKE_PROGRESS_KEY\]: \{\}/)
    assert.match(swScopedBody, /getCoordinatorContentSourceIndexShardDefaults\(request\)/)
    assert.match(swScopedBody, /normalizeCoordinatorContentSourceIndexRecords\(/)
    assert.match(swScopedBody, /Object\.assign\(scopedQueue, sourceQueue\)/)
    assert.match(swScopedBody, /shouldLoadFullQueueForTruncatedContentPageState\(queueIndex, request, profileHrefs, scopedQueue\)/)
    assert.match(swScopedBody, /loadScopedCoordinatorQueueFallbackForContentPage\(request, profileHrefSet\)/)
    assert.match(shouldQueueFallbackBody, /queueIndex\?\.truncated !== true/)
    assert.doesNotMatch(shouldQueueFallbackBody, /requestSourcePageUrl \|\| requestSearchQuery/)
    assert.match(sourceRecordsBody, /getCoordinatorContentSourceKeysForRequest\(request\)/)
    assert.match(queueFallbackBody, /loadCoordinatorQueueProjection\(\{[\s\S]*contentPageState\.queueFallback\.truncated/)
    assert.doesNotMatch(queueFallbackBody, /\[COORDINATOR_QUEUE_KEY\]: \{\}/)
    assert.match(queueFallbackBody, /contentPageState\.queueFallback\.truncated/)
    assert.match(queueFallbackBody, /shouldIncludeCoordinatorItemForContentPage/)
    assert.match(swScopedBody, /shouldIncludeCoordinatorItemForContentPage/)
    assert.match(swScopedBody, /shouldIncludeProfileProgressForContentPage/)
    assert.match(swScopedBody, /coordinatorQueue: scopedQueue/)
    assert.match(swScopedBody, /profileNukeProgress: scopedProgress/)
})

test('content-page scoped state projections are maintained beside full queue and progress writes', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const metricSetBody = extractFunction(sw, 'async function metricStorageSet(payload = {}, options = {})')
    const projectionBody = extractFunction(sw, 'function addContentPageStateProjectionPayload(payload = {})')
    const queueIndexBody = extractFunction(sw, 'function buildCoordinatorContentQueueIndex(queue = {}, now = Date.now())')
    const sourceIndexBody = extractFunction(sw, 'function buildCoordinatorContentSourceIndexShardPayload(queue = {}, now = Date.now())')
    const queueViewBody = extractFunction(sw, 'function buildCoordinatorQueueView(queue = {}, now = Date.now())')
    const progressViewBody = extractFunction(sw, 'function buildProfileNukeProgressView(progress = {}, now = Date.now())')
    const missingBody = extractFunction(sw, 'function isContentPageStateProjectionMissing(queueIndex = null, progressView = null, shardDefaults = {}, stored = {}, sourceShardDefaults = {})')
    const compatBody = extractFunction(sw, "async function rebuildContentPageStateProjectionFromFullStorage(reason = 'missing')")

    assert.match(sw, /COORDINATOR_CONTENT_QUEUE_INDEX_KEY = 'mbCoordinatorContentQueueIndex'/)
    assert.match(sw, /COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX = 'mbCoordinatorContentSourceIndex\.'/)
    assert.match(sw, /PROFILE_NUKE_PROGRESS_VIEW_KEY = 'mbProfileNukeProgressView'/)
    assert.match(sw, /PROFILE_NUKE_PROGRESS_SHARD_PREFIX = 'mbProfileNukeProgressShard\.'/)
    assert.match(metricSetBody, /payload = addContentPageStateProjectionPayload\(payload\)/)
    assert.match(projectionBody, /buildCoordinatorQueueView\(/)
    assert.match(projectionBody, /buildCoordinatorContentQueueIndex\(/)
    assert.match(projectionBody, /buildCoordinatorContentSourceIndexShardPayload\(/)
    assert.match(projectionBody, /buildProfileNukeProgressView\(/)
    assert.match(projectionBody, /buildProfileNukeProgressShardPayload\(/)
    assert.match(sourceIndexBody, /getCoordinatorContentSourceKeysForItem\(item\)/)
    assert.match(queueViewBody, /authoritativeCounts/)
    assert.match(queueIndexBody, /MAX_COORDINATOR_CONTENT_QUEUE_INDEX_ITEMS/)
    assert.match(progressViewBody, /MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS/)
    assert.match(missingBody, /hasMissingRequestedCoordinatorSourceShard\(queueIndex, sourceShardDefaults, stored\)/)
    assert.match(missingBody, /hasMissingRequestedProfileProgressShard\(progressView, shardDefaults, stored\)/)
    assert.match(compatBody, /loadCoordinatorQueueProjection\(\{[\s\S]*contentPageState\.compatBuild/)
    assert.doesNotMatch(compatBody, /\[COORDINATOR_QUEUE_KEY\]: \{\}/)
    assert.match(compatBody, /\[PROFILE_NUKE_PROGRESS_KEY\]: \{\}/)
    assert.match(compatBody, /sourceShards/)
    assert.match(compatBody, /progressShards/)
    assert.match(compatBody, /contentPageState\.compatBuild/)
})

test('terminal progress compatibility save recomputes runs from current queue authority', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const compatBody = extractFunction(sw, 'function scheduleTerminalProgressCompatibilitySave(snapshot = {})')

    assert.match(compatBody, /metricPrefix[\s\S]*terminalProgress/)
    assert.match(compatBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: `\$\{metricPrefix\}\.compatibilitySave\.load`/)
    assert.doesNotMatch(compatBody, /\[COORDINATOR_QUEUE_KEY\]: \{\}/)
    assert.match(compatBody, /metricStorageGet\(\{[\s\S]*\[PROFILE_NUKE_PROGRESS_KEY\]: \{\}/)
    assert.match(compatBody, /recomputeCoordinatorRuns\(queue, currentRuns/)
})

test('dashboard resume loop does not kick on every render while timer is armed', () => {
    const evaluate = loadDashboardHarness()
    const result = evaluate(`
        let resumeCalls = 0
        let intervalCalls = 0
        resumeCoordinatorQueueTimer = null
        resumeCoordinatorQueuePromise = null
        resumeCoordinatorQueue = function() {
            resumeCalls += 1
            return Promise.resolve(null)
        }
        setInterval = function() {
            intervalCalls += 1
            return {armed: true}
        }
        clearInterval = function() {}

        state.loading = false
        state.paused = false
        setQuoraVisitRequirement(false)
        state.queue = {queued: {status: 'queued'}}

        syncCoordinatorQueueResume(getDisplayQueueItems())
        syncCoordinatorQueueResume(getDisplayQueueItems())
        syncCoordinatorQueueResume(getDisplayQueueItems())

        ;({resumeCalls, intervalCalls, timerArmed: !!resumeCoordinatorQueueTimer})
    `)

    assert.equal(result.resumeCalls, 1)
    assert.equal(result.intervalCalls, 1)
    assert.equal(result.timerArmed, true)
})

test('snapshot state writes carry inventoried authority reasons', () => {
    const source = readRepoFile('shared/js/sw.js')
    const inventory = readRepoFile('storage-authority-callsite-inventory-2026-05-20.md')
    const allowedReasons = new Set([
        'ordinaryMutation',
        'repair',
        'displayRead',
        'compatibilityFlush',
        'checkpointSwitch',
        'compaction',
        'userMemoryNonAuthority'
    ])
    const callSites = collectCallSites(source, 'saveCoordinatorState')

    assert.ok(callSites.length > 0)
    assert.match(source, /SNAPSHOT_WRITE_REASONS/)
    assert.match(source, /snapshot\.write\.reason\.\$\{normalizedReason\}/)

    for(const callSite of callSites) {
        const reason = callSite.text.match(/reason:\s*'([^']+)'/)?.[1] || ''
        assert.ok(reason, `missing snapshot write reason at ${callSite.functionName}:${callSite.line}`)
        assert.ok(allowedReasons.has(reason), `invalid snapshot write reason ${reason} at ${callSite.functionName}:${callSite.line}`)
        assert.ok(
            inventory.includes(`| ${callSite.functionName} |`),
            `missing inventory row for ${callSite.functionName}`
        )
    }
})

test('service worker local storage goes through production adapter seam', () => {
    const source = readRepoFile('shared/js/sw.js')
    const adapterBody = extractFunction(source, 'function createChromeLocalStorageAdapter(getStorageArea = () => browser.storage.local)')
    const metricGetBody = extractFunction(source, 'async function metricStorageGet(defaults = {}, options = {})')
    const metricSetBody = extractFunction(source, 'async function metricStorageSet(payload = {}, options = {})')
    const suppressBody = extractFunction(source, 'function suppressAbandonedStorageOperation(operation = \'storage\')')
    const nonAdapterSource = source.replace(adapterBody, '')

    assert.match(source, /const coordinatorStorageAdapter = createChromeLocalStorageAdapter\(\)/)
    assert.match(adapterBody, /getStorageArea\(\)\.get\(defaults\)/)
    assert.match(adapterBody, /getStorageArea\(\)\.set\(payload\)/)
    assert.match(adapterBody, /getStorageArea\(\)\.remove\(keys\)/)
    assert.match(adapterBody, /getBytesInUse\(keys/)
    assert.match(suppressBody, /isStorageUpdateAbandoned\(\)/)
    assert.match(suppressBody, /storageUpdate\.lateWriteSuppressed/)
    assert.match(metricGetBody, /coordinatorStorageAdapter\.get\(defaults\)/)
    assert.match(metricGetBody, /suppressAbandonedStorageOperation\('storageGet-before'\)/)
    assert.match(metricGetBody, /suppressAbandonedStorageOperation\('storageGet-after'\)/)
    assert.match(metricSetBody, /coordinatorStorageAdapter\.set\(payload\)/)
    assert.match(metricSetBody, /suppressAbandonedStorageOperation\('storageSet'\)/)
    assert.doesNotMatch(nonAdapterSource, /browser\.storage\.local/)
})

test('coordinator projection mutation uses explicit operation shapes', () => {
    const source = readRepoFile('shared/js/sw.js')
    const authorityBody = extractFunction(source, 'function createCoordinatorAuthority()')
    const projectionBody = extractFunction(source, 'async function mutateCoordinatorProjection(operation = {})')
    const queueProjectionBody = extractFunction(source, 'async function loadCoordinatorQueueProjection(options = {})')
    const queueRunsProjectionBody = extractFunction(source, 'async function loadCoordinatorQueueRunsProjection(options = {})')
    const queueRunsProgressProjectionBody = extractFunction(source, 'async function loadCoordinatorQueueRunsProgressProjection(options = {})')
    const currentAuthorityProjectionBody = extractFunction(source, 'async function loadCoordinatorCurrentAuthorityState(defaults = {})')
    const queueRunsEventsProjectionBody = extractFunction(source, 'async function loadCoordinatorQueueRunsEventsProjection(options = {})')
    const queueRunsEventsProgressProjectionBody = extractFunction(source, 'async function loadCoordinatorQueueRunsEventsProgressProjection(options = {})')
    const repairProjectionBody = extractFunction(source, 'async function loadCoordinatorRepairProjection(options = {})')
    const queueRunsPendingProjectionBody = extractFunction(source, 'async function loadCoordinatorQueueRunsPendingProjection(options = {})')
    const queueRunsProgressPendingNukedProjectionBody = extractFunction(source, 'async function loadCoordinatorQueueRunsProgressPendingNukedProjection(options = {})')
    const clearProfileBody = extractFunction(source, 'async function clearProfileNukeState(profileHref = \'\', reason = \'\')')
    const requestBody = extractFunction(source, 'async function requestCoordinatorActionLease(request = {}, sender = {})')
    const requestMutationBody = extractFunction(source, 'async function mutateCoordinatorActionLeaseRequest(operation = {})')
    const heartbeatBody = extractFunction(source, 'async function heartbeatCoordinatorActionLease(request = {}, sender = {})')
    const heartbeatMutationBody = extractFunction(source, 'async function mutateCoordinatorActionLeaseHeartbeat(operation = {})')
    const releaseBody = extractFunction(source, 'async function releaseCoordinatorActionLease(request = {}, sender = {}, reason = \'\')')
    const releaseMutationBody = extractFunction(source, 'async function mutateCoordinatorActionLeaseRelease(operation = {})')
    const releaseForTabBody = extractFunction(source, 'async function releaseCoordinatorActionLeaseForTab(tabId = null, reason = \'\')')
    const releaseForTabMutationBody = extractFunction(source, 'async function mutateCoordinatorActionLeasesForTabRelease(operation = {})')
    const runsPausedBody = extractFunction(source, 'async function setCoordinatorRunsPaused(paused = false)')
    const runsPausedMutationBody = extractFunction(source, 'async function mutateCoordinatorRunsPausedSet(operation = {})')
    const pauseControlBody = extractFunction(source, 'async function setCoordinatorPauseControlState(paused = false, pauseGeneration = 0, reason = \'ordinaryMutation\')')
    const pauseControlMutationBody = extractFunction(source, 'async function mutateCoordinatorPauseStateSet(operation = {})')
    const pauseStoredBody = extractFunction(source, 'async function pauseStoredCoordinatorWork(options = {})')
    const pauseStoredMutationBody = extractFunction(source, 'async function mutateCoordinatorStoredWorkPause(operation = {})')
    const currentWorkCancelBody = extractFunction(source, 'async function cancelCoordinatorCurrentWork()')
    const cancelStoredBody = extractFunction(source, 'async function cancelStoredCoordinatorWork(options = {})')
    const cancelStoredMutationBody = extractFunction(source, 'async function mutateCoordinatorStoredWorkCancel(operation = {})')
    const walBatchMutationBody = extractFunction(source, 'async function persistCoordinatorAuthorityQueueWalBatchMutation(results = [], nextProjection = {}, options = {})')
    const activeTransitionBody = extractFunction(source, 'async function transitionCoordinatorItemForQueuedTab(action = {}, tab = {}, details = {})')
    const activeTransitionMutationBody = extractFunction(source, 'async function mutateCoordinatorQueuedTabActiveTransition(operation = {})')
    const rollbackOpenBody = extractFunction(source, 'async function rollbackFailedQueuedTabOpen(action = {}, tab = {}, details = {})')
    const rollbackOpenMutationBody = extractFunction(source, 'async function mutateCoordinatorQueuedTabOpenRollback(operation = {})')
    const staleRetryBody = extractFunction(source, 'async function advanceCoordinatorQueueForStaleRetryAction(action = null, at = Date.now())')
    const staleRetryMutationBody = extractFunction(source, 'async function mutateCoordinatorStaleRetryQueuedTabAdvance(operation = {})')
    const keyOnlyTerminalBody = extractFunction(source, 'async function terminalizeCoordinatorKeyOnlyItem(coordinatorKey = \'\', options = {})')
    const keyOnlyTerminalMutationBody = extractFunction(source, 'async function mutateCoordinatorKeyOnlyItemTerminalize(operation = {})')
    const nonProfileLandingBody = extractFunction(source, 'async function terminalizeActiveCoordinatorNonProfileLanding(itemKey = \'\', landingUrl = \'\', options = {})')
    const nonProfileLandingMutationBody = extractFunction(source, 'async function mutateCoordinatorActiveNonProfileLandingTerminalize(operation = {})')
    const activeWithoutActorBody = extractFunction(source, 'async function requeueDurableActiveCoordinatorItemWithoutActor(itemKey = \'\', expectedItem = null, expectedRecord = null, reason = \'reconcile-active-without-actor\')')
    const activeWithoutActorMutationBody = extractFunction(source, 'async function mutateCoordinatorActiveWithoutRuntimeActorReconcile(operation = {})')

    assert.match(projectionBody, /const kind = `\$\{operation\.kind \|\| ''\}`\.trim\(\)/)
    assert.match(projectionBody, /kind === 'requestActionLease'/)
    assert.match(projectionBody, /kind === 'heartbeatActionLease'/)
    assert.match(projectionBody, /kind === 'releaseActionLease'/)
    assert.match(projectionBody, /kind === 'releaseActionLeasesForTab'/)
    assert.match(projectionBody, /kind === 'setCoordinatorRunsPaused'/)
    assert.match(projectionBody, /kind === 'setPauseState'/)
    assert.match(projectionBody, /kind === 'pauseStoredWork'/)
    assert.match(projectionBody, /kind === 'cancelStoredWork'/)
    assert.match(projectionBody, /kind === 'transitionQueuedTabActive'/)
    assert.match(projectionBody, /kind === 'rollbackFailedQueuedTabOpen'/)
    assert.match(projectionBody, /kind === 'advanceStaleRetryQueuedTab'/)
    assert.match(projectionBody, /kind === 'terminalizeKeyOnlyCoordinatorItem'/)
    assert.match(projectionBody, /kind === 'reconcileActiveWithoutRuntimeActor'/)
    assert.match(projectionBody, /kind === 'terminalizeActiveNonProfileLanding'/)
    assert.match(projectionBody, /kind === 'retryFailedItems'/)
    assert.match(projectionBody, /kind === 'requeueFailedItems'/)
    assert.doesNotMatch(projectionBody, /callback|reducerCallback|operation\(/)
    assert.doesNotMatch(source, /function loadCoordinatorState\(/)
    assert.doesNotMatch(source, /loadCoordinatorState\(/)
    assert.doesNotMatch(source, /saveCoordinatorQueueProjection\(/)
    assert.doesNotMatch(source, /saveCoordinatorQueueRunsProjection\(/)
    assert.match(authorityBody, /loadCoordinatorCurrentAuthorityState\(defaults\)/)
    assert.match(queueProjectionBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_QUEUE_KEY\]: \{\}[\s\S]*\}, \{[\s\S]*metricPath: options\.metricPath \|\| 'coordinatorQueueProjection\.load'/)
    assert.match(queueProjectionBody, /normalizeCoordinatorMap\(stored\[COORDINATOR_QUEUE_KEY\]\)/)
    assert.doesNotMatch(queueProjectionBody, /COORDINATOR_RUNS_KEY|COORDINATOR_EVENTS_KEY|PROFILE_NUKE_PROGRESS_KEY|loadCoordinatorState\(/)
    assert.match(queueRunsProjectionBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_QUEUE_KEY\]: \{\},[\s\S]*\[COORDINATOR_RUNS_KEY\]: \{\}[\s\S]*\}\)/)
    assert.match(queueRunsProjectionBody, /normalizeCoordinatorMap\(stored\[COORDINATOR_QUEUE_KEY\]\)/)
    assert.match(queueRunsProjectionBody, /normalizeCoordinatorMap\(stored\[COORDINATOR_RUNS_KEY\]\)/)
    assert.doesNotMatch(queueRunsProjectionBody, /COORDINATOR_EVENTS_KEY|PROFILE_NUKE_PROGRESS_KEY|loadCoordinatorState\(/)
    assert.match(queueRunsProjectionBody, /metricPath: options\.metricPath \|\| 'coordinatorQueueRunsProjection\.load'/)
    assert.match(queueRunsEventsProjectionBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_QUEUE_KEY\]: \{\},[\s\S]*\[COORDINATOR_RUNS_KEY\]: \{\},[\s\S]*\[COORDINATOR_EVENTS_KEY\]: \[\][\s\S]*\}/)
    assert.match(queueRunsEventsProjectionBody, /normalizeCoordinatorEvents\(stored\[COORDINATOR_EVENTS_KEY\]\)/)
    assert.doesNotMatch(queueRunsEventsProjectionBody, /PROFILE_NUKE_PROGRESS_KEY|loadCoordinatorState\(/)
    assert.match(queueRunsEventsProgressProjectionBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_QUEUE_KEY\]: \{\},[\s\S]*\[COORDINATOR_RUNS_KEY\]: \{\},[\s\S]*\[COORDINATOR_EVENTS_KEY\]: \[\],[\s\S]*\[PROFILE_NUKE_PROGRESS_KEY\]: \{\}[\s\S]*\}/)
    assert.match(queueRunsEventsProgressProjectionBody, /normalizeCoordinatorEvents\(stored\[COORDINATOR_EVENTS_KEY\]\)/)
    assert.match(queueRunsEventsProgressProjectionBody, /normalizeStoredProfileNukeProgress\(stored\[PROFILE_NUKE_PROGRESS_KEY\] \|\| \{\}\)/)
    assert.doesNotMatch(queueRunsEventsProgressProjectionBody, /loadCoordinatorState\(/)
    assert.match(currentAuthorityProjectionBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_QUEUE_KEY\]: \{\},[\s\S]*\[COORDINATOR_QUEUE_WAL_KEY\]: null,[\s\S]*\[COORDINATOR_RUNS_KEY\]: \{\},[\s\S]*\[PROFILE_NUKE_PROGRESS_KEY\]: \{\},[\s\S]*\.\.\.defaults[\s\S]*\}/)
    assert.match(currentAuthorityProjectionBody, /recoverCoordinatorQueueFromWal\(/)
    assert.match(currentAuthorityProjectionBody, /metricPath: 'currentAuthority\.load'/)
    assert.doesNotMatch(currentAuthorityProjectionBody, /COORDINATOR_EVENTS_KEY|SPACE_PENDING_NUKED_POSTS_KEY|SPACE_NUKED_POSTS_KEY|loadCoordinatorState\(/)
    assert.match(repairProjectionBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_QUEUE_KEY\]: \{\},[\s\S]*\[COORDINATOR_QUEUE_WAL_KEY\]: null,[\s\S]*\[COORDINATOR_RUNS_KEY\]: \{\},[\s\S]*\[COORDINATOR_EVENTS_KEY\]: \[\],[\s\S]*\[PROFILE_NUKE_PROGRESS_KEY\]: \{\},[\s\S]*\[COORDINATOR_PAUSED_KEY\]: false,[\s\S]*\[SPACE_PENDING_NUKED_POSTS_KEY\]: \{\},[\s\S]*\[SPACE_NUKED_POSTS_KEY\]: \{\}[\s\S]*\}/)
    assert.match(repairProjectionBody, /recoverCoordinatorQueueFromWal\(/)
    assert.match(repairProjectionBody, /pendingPosts: stored\[SPACE_PENDING_NUKED_POSTS_KEY\] \|\| \{\}/)
    assert.match(repairProjectionBody, /nukedPosts: stored\[SPACE_NUKED_POSTS_KEY\] \|\| \{\}/)
    assert.doesNotMatch(repairProjectionBody, /loadCoordinatorState\(/)
    assert.match(queueRunsPendingProjectionBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_QUEUE_KEY\]: \{\},[\s\S]*\[COORDINATOR_QUEUE_WAL_KEY\]: null,[\s\S]*\[COORDINATOR_RUNS_KEY\]: \{\},[\s\S]*\[SPACE_PENDING_NUKED_POSTS_KEY\]: \{\}[\s\S]*\}/)
    assert.match(queueRunsPendingProjectionBody, /recoverCoordinatorQueueFromWal\(/)
    assert.match(queueRunsPendingProjectionBody, /pendingPosts: stored\[SPACE_PENDING_NUKED_POSTS_KEY\] \|\| \{\}/)
    assert.doesNotMatch(queueRunsPendingProjectionBody, /COORDINATOR_EVENTS_KEY|PROFILE_NUKE_PROGRESS_KEY|SPACE_NUKED_POSTS_KEY|loadCoordinatorState\(/)
    assert.match(queueRunsProgressPendingNukedProjectionBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_QUEUE_KEY\]: \{\},[\s\S]*\[COORDINATOR_QUEUE_WAL_KEY\]: null,[\s\S]*\[COORDINATOR_RUNS_KEY\]: \{\},[\s\S]*\[PROFILE_NUKE_PROGRESS_KEY\]: \{\},[\s\S]*\[SPACE_PENDING_NUKED_POSTS_KEY\]: \{\},[\s\S]*\[SPACE_NUKED_POSTS_KEY\]: \{\}[\s\S]*\}/)
    assert.match(queueRunsProgressPendingNukedProjectionBody, /recoverCoordinatorQueueFromWal\(/)
    assert.match(queueRunsProgressPendingNukedProjectionBody, /normalizeStoredProfileNukeProgress\(stored\[PROFILE_NUKE_PROGRESS_KEY\] \|\| \{\}\)/)
    assert.match(queueRunsProgressPendingNukedProjectionBody, /pendingPosts: stored\[SPACE_PENDING_NUKED_POSTS_KEY\] \|\| \{\}/)
    assert.match(queueRunsProgressPendingNukedProjectionBody, /nukedPosts: stored\[SPACE_NUKED_POSTS_KEY\] \|\| \{\}/)
    assert.doesNotMatch(queueRunsProgressPendingNukedProjectionBody, /COORDINATOR_EVENTS_KEY|loadCoordinatorState\(/)
    assert.match(clearProfileBody, /loadCoordinatorQueueRunsProgressPendingNukedProjection\(\{[\s\S]*metricPath: 'clearProfile\.load'/)
    assert.doesNotMatch(clearProfileBody, /loadCoordinatorState\(/)
    assert.match(requestBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'requestActionLease'[\s\S]*reason: 'ordinaryMutation'[\s\S]*profileHref[\s\S]*tabId[\s\S]*attemptId[\s\S]*attemptNumber[\s\S]*actionKind/)
    assert.match(requestMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(requestMutationBody, /snapshotReason !== 'ordinaryMutation'/)
    assert.match(requestMutationBody, /recordStaleAttemptDiagnostic/)
    assert.match(requestMutationBody, /loadCoordinatorQueueProjection\(\{[\s\S]*metricPath: 'actionLease\.request\.load'/)
    assert.doesNotMatch(requestMutationBody, /loadCoordinatorState\(/)
    assert.match(requestMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'action-lease-request'/)
    assert.match(requestMutationBody, /expectedAttemptId/)
    assert.match(requestMutationBody, /currentAuthorityState/)
    assert.match(requestMutationBody, /missing-attempt-identity/)
    assert.match(requestMutationBody, /isActiveCoordinatorStatus\(item\.status\)/)
    assert.match(requestMutationBody, /active-tab-mismatch/)
    assert.match(requestMutationBody, /isActiveCoordinatorStatus\(currentItem\.status\)/)
    assert.match(requestMutationBody, /context\.reject\('action-lease-busy'\)/)
    assert.doesNotMatch(requestMutationBody, /clearExpiredCoordinatorActionLeases/)
    assert.doesNotMatch(requestMutationBody, /saveCoordinatorQueueProjection\(/)
    assert.doesNotMatch(requestMutationBody, /saveCoordinatorState\(/)
    assert.match(heartbeatBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'heartbeatActionLease'[\s\S]*reason: 'ordinaryMutation'[\s\S]*profileHref[\s\S]*tabId[\s\S]*attemptId/)
    assert.match(heartbeatMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(heartbeatMutationBody, /reason !== 'ordinaryMutation'/)
    assert.match(heartbeatMutationBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: 'actionLease\.heartbeat\.load'/)
    assert.match(heartbeatMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'action-lease-heartbeat'/)
    assert.match(heartbeatMutationBody, /expectedAttemptId: attemptId/)
    assert.match(heartbeatMutationBody, /currentAuthorityState/)
    assert.match(heartbeatMutationBody, /context\.reject\('action-lease-lost'\)/)
    assert.doesNotMatch(heartbeatMutationBody, /clearExpiredCoordinatorActionLeases/)
    assert.doesNotMatch(heartbeatMutationBody, /loadCoordinatorState\(/)
    assert.doesNotMatch(heartbeatMutationBody, /saveCoordinatorQueueProjection\(/)
    assert.doesNotMatch(heartbeatMutationBody, /saveCoordinatorState\(/)
    assert.match(releaseBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'releaseActionLease'[\s\S]*reason: 'ordinaryMutation'[\s\S]*profileHref[\s\S]*tabId[\s\S]*attemptId[\s\S]*releaseReason/)
    assert.match(releaseMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(releaseMutationBody, /snapshotReason !== 'ordinaryMutation'/)
    assert.match(releaseMutationBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: 'actionLease\.release\.load'/)
    assert.match(releaseMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'action-lease-release'/)
    assert.match(releaseMutationBody, /expectedAttemptId: attemptId/)
    assert.match(releaseMutationBody, /currentAuthorityState/)
    assert.match(releaseMutationBody, /reason: 'missing-coordinator-item'/)
    assert.match(releaseMutationBody, /reason: 'missing-action-lease'/)
    assert.match(releaseMutationBody, /reason: 'expired-action-lease'/)
    assert.match(releaseMutationBody, /reason: 'action-lease-holder-mismatch'/)
    assert.match(releaseMutationBody, /context\.reject\('action-lease-lost'\)/)
    assert.doesNotMatch(releaseMutationBody, /clearExpiredCoordinatorActionLeases/)
    assert.doesNotMatch(releaseMutationBody, /loadCoordinatorState\(/)
    assert.doesNotMatch(releaseMutationBody, /saveCoordinatorQueueProjection\(/)
    assert.doesNotMatch(releaseMutationBody, /saveCoordinatorState\(/)
    assert.match(releaseForTabBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'releaseActionLeasesForTab'[\s\S]*reason: 'ordinaryMutation'[\s\S]*tabId: normalizedTabId[\s\S]*releaseReason/)
    assert.match(releaseForTabMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(releaseForTabMutationBody, /snapshotReason !== 'ordinaryMutation'/)
    assert.match(releaseForTabMutationBody, /loadCoordinatorQueueProjection\(\{[\s\S]*metricPath: 'actionLease\.tabRelease\.load'/)
    assert.match(releaseForTabMutationBody, /currentAuthorityState/)
    assert.match(releaseForTabMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'action-lease-tab-release'/)
    assert.match(releaseForTabMutationBody, /expectedAttemptId/)
    assert.match(releaseForTabMutationBody, /context\.reject\('action-lease-lost'\)/)
    assert.doesNotMatch(releaseForTabMutationBody, /clearExpiredCoordinatorActionLeases/)
    assert.doesNotMatch(releaseForTabMutationBody, /loadCoordinatorState\(/)
    assert.doesNotMatch(releaseForTabMutationBody, /saveCoordinatorQueueProjection\(/)
    assert.doesNotMatch(releaseForTabMutationBody, /saveCoordinatorState\(/)
    assert.match(runsPausedBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'setCoordinatorRunsPaused'[\s\S]*reason: 'ordinaryMutation'[\s\S]*paused: !!paused/)
    assert.match(runsPausedMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(runsPausedMutationBody, /snapshotReason !== 'ordinaryMutation'/)
    assert.match(runsPausedMutationBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: 'runsPaused\.load'/)
    assert.doesNotMatch(runsPausedMutationBody, /loadCoordinatorState\(/)
    assert.match(runsPausedMutationBody, /recomputeCoordinatorRuns\(queue, nextRuns, affectedRunIds\)/)
    assert.match(runsPausedMutationBody, /queueOperation: 'runs-paused-derived'/)
    assert.match(runsPausedMutationBody, /runs-paused-derived-save-failed/)
    assert.match(pauseControlBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'setPauseState'[\s\S]*reason,[\s\S]*paused: !!paused,[\s\S]*pauseGeneration/)
    assert.doesNotMatch(source, /async function mutateCoordinatorControlProjection/)
    assert.match(pauseControlMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(pauseControlMutationBody, /snapshotReason !== 'ordinaryMutation' && snapshotReason !== 'repair'/)
    assert.match(pauseControlMutationBody, /\[COORDINATOR_PAUSED_KEY\]: operation\.paused === true/)
    assert.match(pauseControlMutationBody, /payload\[COORDINATOR_PAUSE_GENERATION_KEY\] = pauseGeneration/)
    assert.match(pauseControlMutationBody, /metricStorageSet\(payload, \{[\s\S]*snapshotWriteReason: snapshotReason/)
    assert.match(pauseStoredBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'pauseStoredWork'[\s\S]*reason: 'ordinaryMutation'[\s\S]*pauseReason: reason,[\s\S]*pauseGeneration/)
    assert.doesNotMatch(pauseStoredBody, /loadCoordinatorState\(|saveCoordinatorState\(|buildPausedCoordinatorQueueItem/)
    assert.match(pauseStoredMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(pauseStoredMutationBody, /snapshotReason !== 'ordinaryMutation'/)
    assert.match(pauseStoredMutationBody, /loadCoordinatorQueueRunsEventsProgressProjection\(\{[\s\S]*metricPath: 'storedWork\.pause\.load'/)
    assert.doesNotMatch(pauseStoredMutationBody, /loadCoordinatorState\(/)
    assert.match(pauseStoredMutationBody, /buildPausedCoordinatorQueueItem/)
    assert.match(pauseStoredMutationBody, /mutateCoordinatorPauseStateSet\(\{[\s\S]*paused: true,[\s\S]*pauseGeneration/)
    assert.match(pauseStoredMutationBody, /makeCoordinatorAuthorityApplyResult\(\{[\s\S]*operationKind: 'stored-work-pause'/)
    assert.match(pauseStoredMutationBody, /persistCoordinatorAuthorityQueueWalBatchMutation\(/)
    assert.match(pauseStoredMutationBody, /operationKind: 'stored-work-pause'/)
    assert.match(pauseStoredMutationBody, /if\(persistence\?\.saved !== true\) \{[\s\S]*ownedTabIds: \[\],[\s\S]*reason: persistence\?\.reason \|\| 'persistence-failed'/)
    assert.match(pauseStoredMutationBody, /saveCoordinatorState\(\{[\s\S]*runs: nextRunsBase,[\s\S]*events,[\s\S]*progress: prunedProgress[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*queueOperation: 'stored-work-pause-derived'/)
    assert.doesNotMatch(pauseStoredMutationBody, /saveCoordinatorState\(\{[\s\S]*queue,[\s\S]*runs: nextRunsBase/)
    assert.match(cancelStoredBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: hasTarget \? 'cancelStoredWorkItem' : 'cancelStoredWork'[\s\S]*reason: 'ordinaryMutation'[\s\S]*cancelReason: reason/)
    assert.doesNotMatch(cancelStoredBody, /loadCoordinatorState\(|saveCoordinatorState\(|buildTerminalCoordinatorQueueItem/)
    assert.match(cancelStoredMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(cancelStoredMutationBody, /snapshotReason !== 'ordinaryMutation'/)
    assert.match(cancelStoredMutationBody, /loadCoordinatorQueueRunsEventsProgressProjection\(\{[\s\S]*metricPath: 'storedWork\.cancel\.load'/)
    assert.doesNotMatch(cancelStoredMutationBody, /loadCoordinatorState\(/)
    assert.match(cancelStoredMutationBody, /buildTerminalCoordinatorQueueItem/)
    assert.match(cancelStoredMutationBody, /makeTerminalProgressRecordFromCoordinatorItem/)
    assert.match(cancelStoredMutationBody, /normalizeCoordinatorAuthorityStateInput\(state\)/)
    assert.match(cancelStoredMutationBody, /makeCoordinatorAuthorityApplyResult\(\{[\s\S]*operationKind: 'stored-work-cancel'/)
    assert.match(cancelStoredMutationBody, /persistCoordinatorAuthorityQueueWalBatchMutation\(/)
    assert.match(cancelStoredMutationBody, /operationKind: 'stored-work-cancel'/)
    assert.match(cancelStoredMutationBody, /if\(persistence\?\.saved !== true\) \{[\s\S]*ownedTabIds: \[\],[\s\S]*reason: persistence\?\.reason \|\| 'persistence-failed'/)
    assert.match(currentWorkCancelBody, /if\(!storedResult \|\| typeof storedResult !== 'object' \|\| storedResult\?\.reason \|\| storedResult\?\.persistence\?\.saved === false\) \{[\s\S]*ownedTabIds: \[\],[\s\S]*reason: storedResult\?\.reason \|\| 'cancel-persistence-failed'/)
    assert.ok(
        currentWorkCancelBody.indexOf("if(!storedResult || typeof storedResult !== 'object' || storedResult?.reason || storedResult?.persistence?.saved === false)") <
            currentWorkCancelBody.indexOf('stopOwnerNukes(SERVICE_WORKER_QUEUE_OWNER_ID')
    )
    assert.match(cancelStoredMutationBody, /coordinatorAuthority\.hydrate\(\)/)
    assert.match(cancelStoredMutationBody, /saveCoordinatorState\(\{[\s\S]*runs,[\s\S]*events,[\s\S]*progress: progressChanged \? prunedProgress : undefined[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*queueOperation: 'stored-work-cancel-derived'/)
    assert.doesNotMatch(cancelStoredMutationBody, /saveCoordinatorState\(\{[\s\S]*queue,[\s\S]*runs,[\s\S]*events/)
    assert.match(walBatchMutationBody, /appendWalRecordsToGeneration\(storedWal, appendRecords/)
    assert.match(walBatchMutationBody, /queueChangedRows: records\.length/)
    assert.match(walBatchMutationBody, /activeQueueWakeupStorageContext\.coordinatorAuthorityQueueMutationApplied = true/)
    assert.match(walBatchMutationBody, /activeQueueWakeupStorageContext\.coordinatorAuthorityQueueOperation = operationKind/)
    assert.match(walBatchMutationBody, /buildCoordinatorQueueDerivedProjectionPayload\(nextProjection\.queue \|\| \{\}\)/)
    assert.match(activeTransitionBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'transitionQueuedTabActive'[\s\S]*reason: 'ordinaryMutation'[\s\S]*action,[\s\S]*tab,[\s\S]*details,[\s\S]*href,[\s\S]*coordinatorKey/)
    assert.match(activeTransitionMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(activeTransitionMutationBody, /snapshotReason !== 'ordinaryMutation'/)
    assert.match(activeTransitionMutationBody, /transitionCoordinatorItemForQueuedTabLocked\([\s\S]*operation\.action \|\| \{\},[\s\S]*operation\.tab \|\| \{\},[\s\S]*operation\.details \|\| \{\},[\s\S]*operation\.href \|\| '',[\s\S]*operation\.coordinatorKey \|\| ''/)
    assert.match(rollbackOpenBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'rollbackFailedQueuedTabOpen'[\s\S]*reason: 'repair'[\s\S]*action,[\s\S]*tab,[\s\S]*details,[\s\S]*href,[\s\S]*coordinatorKey/)
    assert.match(rollbackOpenMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'repair'\)/)
    assert.match(rollbackOpenMutationBody, /snapshotReason !== 'repair'/)
    assert.match(rollbackOpenMutationBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: 'rollbackActiveTransition\.load'/)
    assert.match(rollbackOpenMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'rollback-active-transition'/)
    assert.match(rollbackOpenMutationBody, /currentAttemptId/)
    assert.match(rollbackOpenMutationBody, /incomingAttemptId/)
    assert.match(rollbackOpenMutationBody, /expectedAttemptId: currentAttemptId \? incomingAttemptId : ''/)
    assert.match(rollbackOpenMutationBody, /isActiveCoordinatorStatus\(item\.status\)/)
    assert.match(rollbackOpenMutationBody, /isActiveCoordinatorStatus\(currentItem\.status\)/)
    assert.match(rollbackOpenMutationBody, /inactive-coordinator-item/)
    assert.match(rollbackOpenMutationBody, /missing-attempt-identity/)
    assert.match(rollbackOpenMutationBody, /reason: 'ordinaryMutation'/)
    assert.match(rollbackOpenMutationBody, /metricPath: 'rollbackActiveTransition\.save'/)
    assert.match(rollbackOpenMutationBody, /saveCoordinatorState\(\{[\s\S]*runs: runsChanged \? nextRuns : undefined[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*reason: 'repair',[\s\S]*queueOperation: 'rollback-active-transition-derived'/)
    assert.doesNotMatch(rollbackOpenMutationBody, /saveCoordinatorQueueRunsProjection\(/)
    assert.match(staleRetryBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'advanceStaleRetryQueuedTab'[\s\S]*reason: 'ordinaryMutation'[\s\S]*action,[\s\S]*at,[\s\S]*href,[\s\S]*coordinatorKey/)
    assert.match(staleRetryMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'ordinaryMutation'\)/)
    assert.match(staleRetryMutationBody, /snapshotReason !== 'ordinaryMutation'/)
    assert.match(staleRetryMutationBody, /reduceJobEvent\(currentItem, \{[\s\S]*type: JOB_EVENT_RETRY/)
    assert.match(staleRetryMutationBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: 'staleRetry\.load'/)
    assert.match(staleRetryMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'stale-retry'/)
    assert.match(staleRetryMutationBody, /expectedAttemptId: sourceAttemptId/)
    assert.match(staleRetryMutationBody, /currentAuthorityState/)
    assert.match(staleRetryMutationBody, /queueOperation: 'stale-retry-derived'/)
    assert.doesNotMatch(staleRetryMutationBody, /saveCoordinatorQueueRunsProjection\(/)
    assert.match(keyOnlyTerminalBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'terminalizeKeyOnlyCoordinatorItem'[\s\S]*reason: 'repair'[\s\S]*coordinatorKey: key,[\s\S]*terminalOptions: options/)
    assert.match(keyOnlyTerminalMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'repair'\)/)
    assert.match(keyOnlyTerminalMutationBody, /snapshotReason !== 'repair'/)
    assert.match(keyOnlyTerminalMutationBody, /loadCoordinatorQueueRunsEventsProjection\(\{[\s\S]*metricPath: 'repair\.keyOnlyTerminalize\.load'/)
    assert.doesNotMatch(keyOnlyTerminalMutationBody, /loadCoordinatorState\(/)
    assert.match(keyOnlyTerminalMutationBody, /buildTerminalCoordinatorQueueItem/)
    assert.match(keyOnlyTerminalMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'repair-key-only-terminalize'/)
    assert.match(keyOnlyTerminalMutationBody, /expectedAttemptId/)
    assert.match(keyOnlyTerminalMutationBody, /expectedAttemptNumber/)
    assert.match(keyOnlyTerminalMutationBody, /reason: 'ordinaryMutation'/)
    assert.match(keyOnlyTerminalMutationBody, /currentAuthorityState/)
    assert.match(keyOnlyTerminalMutationBody, /normalizeCoordinatorEvents\(state\.events\)/)
    assert.match(keyOnlyTerminalMutationBody, /saveCoordinatorState\(\{[\s\S]*runs: runsChanged \? runs : undefined,[\s\S]*events[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*reason: 'repair'/)
    assert.match(nonProfileLandingBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'terminalizeActiveNonProfileLanding'[\s\S]*reason: options\.reason \|\| 'repair'[\s\S]*expectedAttemptId[\s\S]*expectedAttemptNumber/)
    assert.match(queueRunsProgressProjectionBody, /\[PROFILE_NUKE_PROGRESS_KEY\]: \{\}/)
    assert.doesNotMatch(queueRunsProgressProjectionBody, /\[COORDINATOR_EVENTS_KEY\]/)
    assert.match(nonProfileLandingMutationBody, /loadCoordinatorQueueRunsProgressProjection\(\{[\s\S]*metricPath: 'repair\.nonProfileLanding\.load'/)
    assert.doesNotMatch(nonProfileLandingMutationBody, /loadCoordinatorState\(/)
    assert.match(nonProfileLandingMutationBody, /normalizeCoordinatorAuthorityStateInput\(state\)/)
    assert.match(nonProfileLandingMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'repair-non-profile-landing'/)
    assert.match(nonProfileLandingMutationBody, /reason: 'ordinaryMutation'/)
    assert.match(nonProfileLandingMutationBody, /expectedAttemptId/)
    assert.match(nonProfileLandingMutationBody, /expectedAttemptNumber/)
    assert.match(nonProfileLandingMutationBody, /currentAuthorityState/)
    assert.match(nonProfileLandingMutationBody, /context\.reject\('row-changed-before-authority-apply'\)/)
    assert.match(nonProfileLandingMutationBody, /saveCoordinatorState\(\{[\s\S]*runs: runsChanged \? nextRuns : undefined,[\s\S]*progress: progressChanged \? pruneProfileNukeProgress\(progress\) : undefined[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*reason: 'repair'/)
    assert.match(activeWithoutActorBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'reconcileActiveWithoutRuntimeActor'[\s\S]*reason: 'repair'[\s\S]*itemKey,[\s\S]*expectedItem,[\s\S]*expectedRecord/)
    assert.match(activeWithoutActorMutationBody, /normalizeSnapshotWriteReason\(operation\.reason \|\| 'repair'\)/)
    assert.match(activeWithoutActorMutationBody, /snapshotReason !== 'repair'/)
    assert.match(activeWithoutActorMutationBody, /loadCoordinatorQueueRunsProgressProjection\(\{[\s\S]*metricPath: 'repair\.activeWithoutActor\.load'/)
    assert.doesNotMatch(activeWithoutActorMutationBody, /loadCoordinatorCurrentAuthorityState\(/)
    assert.doesNotMatch(activeWithoutActorMutationBody, /loadCoordinatorState\(/)
    assert.match(activeWithoutActorMutationBody, /currentAuthorityState/)
    assert.match(activeWithoutActorMutationBody, /buildRequeuedActiveCoordinatorItemWithoutActor/)
    assert.match(activeWithoutActorMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'repair-active-without-actor'/)
    assert.match(activeWithoutActorMutationBody, /expectedAttemptId/)
    assert.match(activeWithoutActorMutationBody, /expectedAttemptNumber/)
    assert.match(activeWithoutActorMutationBody, /reason: 'ordinaryMutation'/)
    assert.match(activeWithoutActorMutationBody, /metricPath: 'repair\.activeWithoutActor\.save'/)
    assert.match(activeWithoutActorMutationBody, /saveCoordinatorState\(\{[\s\S]*runs: runsChanged \? nextRuns : undefined,[\s\S]*progress: progressChanged \? pruneProfileNukeProgress\(progress\) : undefined[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*reason: 'repair',[\s\S]*queueOperation: 'repair-active-without-actor-derived'/)
})

test('stale-attempt diagnostics are serialized with coordinator updates', () => {
    const source = readRepoFile('shared/js/sw.js')
    const diagnosticBody = extractFunction(source, 'async function recordStaleAttemptDiagnostic(details = {})')
    const saveBody = extractFunction(source, 'async function saveCoordinatorState(state = {}, changes = {})')
    const queueBody = extractFunction(source, 'function enqueueSpaceFeedStorageUpdate(update, options = {})')

    assert.match(source, /pendingCoordinatorDiagnosticEvents/)
    assert.match(diagnosticBody, /spaceFeedStorageUpdateDepth > 0/)
    assert.match(diagnosticBody, /pendingCoordinatorDiagnosticEvents\.push\(event\)/)
    assert.match(diagnosticBody, /enqueueSpaceFeedStorageUpdate\(async \(\) =>/)
    assert.match(saveBody, /drainPendingCoordinatorDiagnosticEvents\(\)/)
    assert.match(saveBody, /concat\(diagnosticEvents\)/)
    assert.match(queueBody, /spaceFeedStorageUpdateDepth \+= 1/)
    assert.match(queueBody, /flushPendingCoordinatorDiagnosticEvents\(\)/)
})

test('repair is best effort in hot runtime paths', () => {
    const source = readRepoFile('shared/js/sw.js')
    const recoveryBody = extractFunction(source, 'async function recoverStoredCoordinatorWorkOnce(reason = \'stored-work-recovery\', options = {})')
    const reconcileBody = extractFunction(source, 'async function runCoordinatorReconcileTickOnce(reason = \'coordinator-reconcile\', options = {})')
    const retryBody = extractFunction(source, 'async function retryCoordinatorFailedItems(request = {}, sender = {})')
    const requeueBody = extractFunction(source, 'async function requeueCoordinatorFailedItems(request = {}, sender = {})')
    const repairIndex = recoveryBody.indexOf('repair = await repairCoordinatorStorageFromProgressBestEffort()')
    const ownedResultIndex = recoveryBody.indexOf('makeStoredWorkRecoveryResumeOwnedResult(reason, repair, hasWork, paused)')

    assert.match(source, /COORDINATOR_REPAIR_GATE_TIMEOUT_MS/)
    assert.match(source, /COORDINATOR_RESUME_GATE_TIMEOUT_MS/)
    assert.match(source, /COORDINATOR_STORED_WORK_RESTORE_TIMEOUT_MS/)
    assert.match(source, /async function repairCoordinatorStorageFromProgressBestEffort/)
    assert.match(source, /async function recoverStoredCoordinatorWork/)
    assert.match(source, /async function runCoordinatorReconcileTick/)
    assert.match(source, /coordinator storage repair/)
    assert.match(source, /coordinator queue resume/)
    assert.match(source, /coordinator stored-work restore/)
    assert.match(reconcileBody, /observeCoordinatorReconcileSnapshot/)
    assert.match(reconcileBody, /runCoordinatorAuthorityReconcileActions/)
    assert.match(reconcileBody, /recoverStoredCoordinatorWorkOnce/)
    assert.notEqual(repairIndex, -1)
    assert.notEqual(ownedResultIndex, -1)
    assert.match(recoveryBody, /let repair = \{deferred: true\}/)
    assert.match(recoveryBody, /options\.repairBeforeResume === true/)
    assert.match(recoveryBody, /if\(hasWork && !paused && options\.repairBeforeResume === true\)/)
    assert.match(recoveryBody, /COORDINATOR_PAUSED_KEY/)
    assert.match(recoveryBody, /reason: paused \? 'coordinator-paused'/)
    assert.match(source, /function makeStoredWorkRecoveryResumeOwnedResult/)
    assert.match(source, /resume: \{skipped: true, reason: 'resume-owned-by-reconcile'\}/)
    assert.doesNotMatch(recoveryBody, /resumeCoordinatorQueueExecution\(/)
    assert.match(source, /runCoordinatorReconcileTick\(reason, \{[\s\S]*repairBeforeResume: true,[\s\S]*allowBeforeQuora: true/)
    assert.match(source, /request\.action === 'repair-coordinator-storage'[\s\S]*dashboard-repair-request-scheduled/)
    assert.doesNotMatch(source, /request\.action === 'repair-coordinator-storage'[\s\S]{0,350}return recoverStoredCoordinatorWork\('dashboard-repair-request'\)/)
    assert.match(source, /runCoordinatorReconcileTickOnce[\s\S]*repairCoordinatorStorageFromProgressBestEffort/)
    assert.match(retryBody, /scheduleStoredWorkRepair\(1000, \{reason: 'retry-failed-request'\}\)/)
    assert.match(requeueBody, /scheduleStoredWorkRepair\(1000, \{reason: 'requeue-failed-request'\}\)/)
    assert.doesNotMatch(retryBody, /repairCoordinatorStorageFromProgressBestEffort/)
    assert.doesNotMatch(requeueBody, /repairCoordinatorStorageFromProgressBestEffort/)
})

test('scheduler hygiene coalesces repair and backs off no-op watchdog ticks', () => {
    const source = readRepoFile('shared/js/sw.js')
    const scheduleRepairBody = extractFunction(source, 'function scheduleStoredWorkRepair(delayMs = STORED_WORK_REPAIR_INTERVAL_MS, options = {})')
    const scheduleResumeBody = extractFunction(source, 'function scheduleCoordinatorQueueResume(delayMs = 500, reason = \'scheduled-resume\')')
    const repairTickBody = extractFunction(source, 'async function runStoredWorkRepairTick(reason = \'stored-work-repair-tick\')')
    const kickBody = extractFunction(source, 'async function kickCoordinatorQueueResume(reason = \'resume-request\', options = {})')

    assert.match(source, /STORED_WORK_REPAIR_BACKOFF_BASE_MS/)
    assert.match(source, /STORED_WORK_REPAIR_BACKOFF_MAX_MS/)
    assert.match(source, /STALE_SCHEDULER_ALARM_SUPPRESSION_MS/)
    assert.match(source, /SCHEDULER_ALARM_TIME_TOLERANCE_MS/)
    assert.match(source, /function isCoordinatorRepairEdgeTriggerReason/)
    assert.match(source, /function getSchedulerAlarmScheduledTime/)
    assert.match(source, /function isSchedulerAlarmScheduledForDueAt/)
    assert.match(source, /function suppressStaleCoordinatorResumeAlarm/)
    assert.match(source, /function suppressStaleStoredWorkRepairAlarm/)
    assert.doesNotMatch(
        extractFunction(source, 'function isCoordinatorRepairEdgeTriggerReason(reason = \'\')'),
        /\|storage\||\|queued-tab\|/
    )
    assert.match(source, /function recordStoredWorkRepairNoopBackoff/)
    assert.match(scheduleRepairBody, /repair\.coalesced/)
    assert.match(scheduleRepairBody, /repair\.suppressedBackoff/)
    assert.match(scheduleRepairBody, /repair\.edgeTriggered/)
    assert.match(scheduleRepairBody, /reconcile\.deadlineUpdated/)
    assert.match(scheduleRepairBody, /scheduler\.pendingDeadlineMs/)
    assert.match(scheduleRepairBody, /repair\.alarmScheduled/)
    assert.doesNotMatch(scheduleRepairBody, /pump\.alarmScheduled/)
    assert.match(scheduleResumeBody, /pump\.coalesced/)
    assert.match(scheduleResumeBody, /reconcile\.deadlineUpdated/)
    assert.match(scheduleResumeBody, /scheduler\.pendingDeadlineMs/)
    assert.match(scheduleResumeBody, /suppressStaleCoordinatorResumeAlarm\(scheduledDueAt\)/)
    assert.match(source, /isSuppressedStaleCoordinatorResumeAlarm\(alarm\)/)
    assert.match(source, /isSuppressedStaleStoredWorkRepairAlarm\(alarm\)/)
    assert.match(source, /repair\.alarmStale/)
    assert.match(source, /pump\.alarmStale/)
    assert.match(repairTickBody, /recordStoredWorkRepairNoopBackoff\(\)/)
    assert.match(repairTickBody, /resetStoredWorkRepairBackoff\('repair-changed'\)/)
    assert.match(kickBody, /if\(resumeScheduled && browser\.alarms\?\.create\)/)
})

test('storage change repair trigger uses compact queue view instead of full queue blob', () => {
    const source = readRepoFile('shared/js/sw.js')
    const queueViewBody = extractFunction(source, 'function buildCoordinatorQueueView(queue = {}, now = Date.now())')
    const triggerBody = extractFunction(source, 'function hasStoredCoordinatorWorkInQueueView(view = null)')

    assert.match(source, /function hasStoredCoordinatorWorkInQueueView/)
    assert.match(queueViewBody, /authoritativeCounts/)
    assert.match(queueViewBody, /isCoordinatorQueueAuthoritativeItem\(item\)/)
    assert.match(triggerBody, /view\?\.hasAuthoritativeStoredWork === true/)
    assert.match(triggerBody, /view\.authoritativeCounts/)
    assert.match(source, /changes\?\.\[COORDINATOR_QUEUE_VIEW_KEY\]\?\.newValue/)
    assert.match(source, /reason: 'storage-queue-view-changed'/)
    assert.doesNotMatch(source, /hasStoredCoordinatorWork\(normalizeCoordinatorMap\(changes\?\.\[COORDINATOR_QUEUE_KEY\]\?\.newValue/)
    assert.doesNotMatch(source, /reason: 'storage-queue-changed'/)
})

test('storage change progress trigger uses compact progress view instead of full progress blob', () => {
    const source = readRepoFile('shared/js/sw.js')
    const listenerStart = source.indexOf('browser.storage.onChanged.addListener((changes, areaName) => {')
    const listenerEnd = source.indexOf('function normalizeContentPageStateUrl', listenerStart)
    const listenerBody = source.slice(listenerStart, listenerEnd)
    const scopedBody = extractFunction(source, 'async function getContentPageCoordinatorState(request = {}, sender = {})')

    assert.match(listenerBody, /changes\?\.\[PROFILE_NUKE_PROGRESS_VIEW_KEY\]/)
    assert.match(listenerBody, /normalizeProfileNukeProgressView\(changes\[PROFILE_NUKE_PROGRESS_VIEW_KEY\]\.oldValue/)
    assert.doesNotMatch(listenerBody, /normalizeStoredProfileNukeProgress\(changes\[PROFILE_NUKE_PROGRESS_KEY\]/)
    assert.doesNotMatch(listenerBody, /enqueueCoordinatorProgressSync\(changedProgress\)/)
    assert.match(scopedBody, /getProfileNukeProgressShardDefaults\(profileHrefs\)/)
    assert.match(scopedBody, /normalizeProfileNukeProgressShardRecords/)
})

test('active queued jobs have a wall-clock cap', () => {
    const source = readRepoFile('shared/js/sw.js')
    const contentSource = readRepoFile('shared/js/content.js')
    const sweepBody = extractFunction(source, 'async function sweepStaleQueuedTabs(parentTabId = null)')
    const repairBody = extractFunction(
        source,
        'function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = \'\', liveProfileTabsByHref = new Map(), now = Date.now())'
    )

    assert.match(source, /COORDINATOR_ACTIVE_JOB_MAX_MS = 120000/)
    assert.match(source, /COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS = 180000/)
    assert.match(source, /STALE_QUEUED_TAB_MAX_RETRIES = 1/)
    assert.match(contentSource, /ACTION_LEASE_WAIT_MS = 45000/)
    assert.match(source, /function getActiveQueuedTabStartedAt/)
    assert.match(source, /function getActiveQueuedTabActionPhaseStartedAt/)
    assert.match(source, /function getActiveQueuedTabAgeAnchor/)
    assert.match(sweepBody, /activeAgeExpired/)
    assert.match(sweepBody, /getActiveQueuedTabAgeAnchor/)
    assert.match(sweepBody, /Queued tab exceeded the active job time limit/)
    assert.match(repairBody, /activeAgeExpired/)
    assert.match(repairBody, /COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS/)
})

test('queued tab metadata accepts the current attempt before old profile progress', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function validateProgressAttempt(profileHref = \'\', patch = {}, sender = {})'
    )
    const matchingMetadataIndex = body.indexOf('if(metadataAttemptId && metadataAttemptId === incomingAttemptId) return true')
    const storedQueueIndex = body.indexOf('loadCoordinatorQueueProjection({')
    const profileProgressIndex = body.indexOf('const existingAttemptId = getAttemptIdFromValue(profileNukeProgress?.[normalizedHref])')

    assert.notEqual(matchingMetadataIndex, -1)
    assert.notEqual(storedQueueIndex, -1)
    assert.notEqual(profileProgressIndex, -1)
    assert.ok(matchingMetadataIndex < storedQueueIndex)
    assert.ok(matchingMetadataIndex < profileProgressIndex)
})

test('queued tab action claim recovers after service worker restart', () => {
    const source = readRepoFile('shared/js/sw.js')
    const matchBody = extractFunction(
        source,
        'function coordinatorItemMatchesTab(item = null, itemKey = \'\', tab = {})'
    )
    const recoverBody = extractFunction(
        source,
        'async function recoverPendingTabActionFromCoordinatorQueue(sender = {})'
    )
    const claimBody = extractFunction(
        source,
        'async function claimPendingTabAction(sender = {})'
    )

    assert.match(matchBody, /isActiveCoordinatorStatus\(status\)/)
    assert.match(matchBody, /isCoordinatorQueueAuthoritativeItem\(item\)/)
    assert.match(matchBody, /tabId !== itemTabId/)
    assert.match(matchBody, /getAttemptIdFromValue\(item\)/)
    assert.match(matchBody, /getAttemptNumberFromValue\(item\)/)
    assert.match(recoverBody, /loadCoordinatorQueueProjection\(\{[\s\S]*metricPath: 'pendingTabAction\.recover\.load'/)
    assert.match(recoverBody, /activeQueuedTabs\.add\(tabId\)/)
    assert.match(recoverBody, /pendingTabActions\.set\(tabId, action\)/)
    assert.match(recoverBody, /registerOwnedTab\(ownerTabId, tabId\)/)
    assert.match(recoverBody, /scheduleOwnedBlockedProfileSweep\(ownerTabId, 4000\)/)
    assert.match(claimBody, /recoverPendingTabActionFromCoordinatorQueue\(sender\)/)
    assert.match(claimBody, /recovered\?\.action/)
})

test('live queued tab adoption immediately injects and nudges content script', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID)'
    )
    const registerIndex = body.indexOf('registerOwnedTab(ownerTabId, tabId)')
    const ensureIndex = body.indexOf('ensureQueuedTabContentScript(tabId, \'resume-live-active-tab\')')
    const nudgeIndex = body.indexOf('nudgeQueuedTabActionClaimWithRetries(tabId, \'resume-live-active-tab\')')

    assert.notEqual(registerIndex, -1)
    assert.notEqual(ensureIndex, -1)
    assert.notEqual(nudgeIndex, -1)
    assert.ok(registerIndex < ensureIndex)
    assert.ok(ensureIndex < nudgeIndex)
    assert.doesNotMatch(body.slice(registerIndex, nudgeIndex), /setTimeout/)
    assert.match(body, /resume live queued tab content script ensure/)
    assert.match(body, /const openedAt = Date\.now\(\)/)
    assert.match(body, /refreshActiveAt: true/)
})

test('queued tab action claim waits for durable active ownership', () => {
    const source = readRepoFile('shared/js/sw.js')
    const contentSource = readRepoFile('shared/js/content.js')
    const body = extractFunction(
        source,
        'async function claimPendingTabAction(sender = {})'
    )
    const durableIndex = body.indexOf('durableClaimed = await promiseWithTimeout(')
    const returnIndex = body.lastIndexOf('return claimableAction')
    const deniedIndex = body.indexOf('return null')

    assert.notEqual(durableIndex, -1)
    assert.notEqual(returnIndex, -1)
    assert.ok(durableIndex < returnIndex)
    assert.match(body, /QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS/)
    assert.match(body, /transitionCoordinatorItemForQueuedTab\(durableClaimAction/)
    assert.match(body, /confirmQueuedTabDurablyActive\(durableClaimAction/)
    assert.match(body, /markQueuedTabDurablyActive\(tabId, 'claim-current-profile-tab-action'\)/)
    assert.match(body, /scheduleStoredWorkRepair\(1000, \{[\s\S]*reason: 'claim-durable-confirmation-failed'[\s\S]*edgeTriggered: true/)
    assert.notEqual(deniedIndex, -1)
    assert.ok(deniedIndex < returnIndex)
    assert.doesNotMatch(body, /void durableClaim/)
    assert.match(contentSource, /QUEUED_ACTION_CLAIM_MESSAGE_TIMEOUT_MS = 6000/)
})

test('queued tab release kicks durable stored work even after service worker sleep', () => {
    const source = readRepoFile('shared/js/sw.js')
    const releaseBody = extractFunction(source, 'async function releaseQueuedTab(tabId, options = {})')
    const releaseAndCleanupBody = extractFunction(source, 'async function releaseQueuedTabAndCleanup(tabId, options = {})')
    const releaseReconcileBody = extractFunction(source, 'function scheduleQueuedTabReleaseReconcile(reason = \'queued-tab-slot-release\', options = {})')
    const metadataOnlyBody = extractFunction(source, 'function cleanupQueuedTabMetadataOnly(tabId)')
    const followUpBody = extractFunction(source, 'function scheduleQueuedTabReleaseFollowUp(delayMs = 500)')
    const continuationBody = extractFunction(source, 'function scheduleQueuedWorkContinuation(reason = \'queued-work-continuation\')')
    const staleSweepBody = extractFunction(source, 'async function sweepStaleQueuedTabs(parentTabId = null)')
    const blockedSweepBody = extractFunction(source, 'async function sweepOwnedBlockedProfileTabs(parentTabId)')
    const terminalCloseBody = extractFunction(source, 'async function closeTerminalOwnedProfileTabs(profileHrefs = [])')

    assert.match(source, /queuedTabReleaseFollowUpTimeout/)
    assert.doesNotMatch(source, /function cleanupQueuedTabState/)
    assert.match(releaseAndCleanupBody, /await releaseQueuedTab\(tabId, options\)/)
    assert.match(releaseAndCleanupBody, /cleanupQueuedTabMetadataOnly\(tabId\)/)
    assert.doesNotMatch(metadataOnlyBody, /releaseQueuedTab/)
    assert.match(releaseBody, /activeQueuedTabs\.delete\(tabId\)/)
    assert.match(releaseBody, /options\.awaitFill !== true/)
    assert.match(releaseBody, /followUpPromise = scheduleQueuedTabReleaseReconcile\('queued-tab-slot-release'/)
    assert.doesNotMatch(releaseBody, /fillQueuedTabs\(\)/)
    assert.match(releaseReconcileBody, /scheduleCoordinatorQueueResume\(delayMs, reason\)/)
    assert.match(releaseReconcileBody, /scheduleStoredWorkRepair\(1000, \{reason\}\)/)
    assert.match(releaseBody, /scheduleQueuedWorkContinuation\('queued-tab-slot-release'\)/)
    assert.match(releaseBody, /hasActiveQueuedTabActionPhaseProgress\(progressRecord, metadata\)/)
    assert.match(releaseBody, /rollbackFailedQueuedTabOpen\(/)
    assert.match(releaseBody, /Promise\.all\(/)
    assert.match(releaseBody, /return followUpPromise \|\| Promise\.resolve\(null\)/)
    assert.doesNotMatch(releaseBody, /return fillPromise \|\| followUpPromise \|\| Promise\.resolve\(null\)/)
    assert.match(releaseBody, /const hadQueuedRuntimeState = wasActive \|\| hadPendingAction \|\| !!metadata/)
    assert.match(releaseBody, /else if\(hadQueuedRuntimeState\) \{\s*scheduleQueuedTabReleaseFollowUp\(\)/)
    assert.match(releaseBody, /else if\(hadQueuedRuntimeState\) \{[\s\S]*scheduleStoredWorkRepair\(1000, \{reason: 'queued-tab-release-no-durable-progress'\}/)
    assert.match(releaseBody, /job\.releaseIgnored\.noRuntimeState/)
    assert.match(followUpBody, /scheduleQueuedWorkContinuation\('queued-tab-release'\)/)
    assert.match(continuationBody, /kickCoordinatorQueueResume\(reason, \{direct: true\}\)/)
    assert.match(followUpBody, /scheduleStoredWorkRepair\(1000, \{reason: 'queued-tab-release-follow-up'\}/)
    assert.match(staleSweepBody, /await releaseQueuedTabAndCleanup\(tabId, \{awaitFill: true\}\)/)
    assert.match(staleSweepBody, /await releaseQueuedTabAndCleanup\(tabId, \{awaitFill: false\}\)/)
    assert.match(blockedSweepBody, /await releaseQueuedTabAndCleanup\(tabId, \{awaitFill: true\}\)/)
    assert.match(terminalCloseBody, /loadCoordinatorCurrentAuthorityState\(\{[\s\S]*\[COORDINATOR_QUEUE_KEY\]: \{\}/)
    assert.match(terminalCloseBody, /await releaseQueuedTabAndCleanup\(normalizedTabId, \{awaitFill: true\}\)/)
})

test('hidden no-foreground queued profile actions do not wait for durable gate when ready', () => {
    const body = extractFunction(
        readRepoFile('shared/js/content.js'),
        'async function maybeRunAutoProfileAction()'
    )
    const helperIndex = body.indexOf('const canProceedWithoutForegroundGate = () =>')
    const immediateFallbackIndex = body.indexOf('if(canProceedWithoutForegroundGate())')
    const runtimeGateIndex = body.indexOf("action: 'begin-profile-action'")
    const timeoutFallbackIndex = body.indexOf('else if(canProceedWithoutForegroundGate())', runtimeGateIndex)

    assert.notEqual(helperIndex, -1)
    assert.notEqual(immediateFallbackIndex, -1)
    assert.notEqual(runtimeGateIndex, -1)
    assert.notEqual(timeoutFallbackIndex, -1)
    assert.ok(helperIndex < immediateFallbackIndex)
    assert.ok(immediateFallbackIndex < runtimeGateIndex)
    assert.ok(runtimeGateIndex < timeoutFallbackIndex)
    assert.match(body.slice(immediateFallbackIndex, runtimeGateIndex), /localActionGateFallback: true/)
})

test('close-if-blocked is a service-worker-owned cleanup probe', () => {
    const contentSource = readRepoFile('shared/js/content.js')
    const swSource = readRepoFile('shared/js/sw.js')
    const messageBody = extractFunction(contentSource, 'function onMessage(request, sender, sendResponse)')
    const closeProbeIndex = messageBody.indexOf("if(request.action === 'close-if-blocked')")
    const closeProbeBody = messageBody.slice(closeProbeIndex, closeProbeIndex + 1800)
    const sweepBody = extractFunction(swSource, 'async function sweepOwnedBlockedProfileTabs(parentTabId)')
    const recordSweepBody = extractFunction(swSource, 'async function recordOwnedBlockedSweepTerminal(tabId, metadata = null, response = {})')
    const statusGateBody = extractFunction(swSource, 'function shouldApplyExplicitProgressStatusToCoordinatorItem(item = {}, patch = {}, options = {})')
    const recordBatchBody = extractFunction(swSource, 'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})')

    assert.notEqual(closeProbeIndex, -1)
    assert.match(closeProbeBody, /requestedProfileHref/)
    assert.match(closeProbeBody, /profile-mismatch/)
    assert.doesNotMatch(closeProbeBody, /recordProfileNukeProgress/)
    assert.doesNotMatch(closeProbeBody, /notifyQueuedTabComplete/)
    assert.doesNotMatch(closeProbeBody, /requestCloseTab/)
    assert.doesNotMatch(closeProbeBody, /setTimeout/)

    assert.match(sweepBody, /recordOwnedBlockedSweepTerminal\(tabId, metadata, response\)/)
    assert.doesNotMatch(sweepBody, /recordCoordinatorJobProgress\(normalizedProfileHref/)
    assert.ok(
        sweepBody.indexOf('recordOwnedBlockedSweepTerminal(tabId, metadata, response)') <
        sweepBody.indexOf('markQueuedTabClosing(tabId')
    )
    assert.ok(
        sweepBody.indexOf('recordOwnedBlockedSweepTerminal(tabId, metadata, response)') <
        sweepBody.indexOf('releaseQueuedTabAndCleanup(tabId')
    )

    assert.match(recordSweepBody, /activeQueuedTabs\.has\(normalizedTabId\)/)
    assert.match(recordSweepBody, /!attemptId/)
    assert.match(recordSweepBody, /normalizedProfileHref !== resolvedProfileHref/)
    assert.match(recordSweepBody, /expectTerminal: true/)
    assert.match(recordSweepBody, /requireActiveSenderTab: true/)
    assert.match(recordSweepBody, /if\(result\?\.terminal\)/)
    assert.match(statusGateBody, /options\.requireActiveSenderTab === true/)
    assert.match(statusGateBody, /isActiveCoordinatorStatus\(item\?\.status \|\| ''\)/)
    assert.match(recordBatchBody, /reason: 'inactive-sender-tab'/)
})

test('coordinator rows expose canonical job envelope fields', () => {
    const source = readRepoFile('shared/js/sw.js')

    assert.match(source, /function makeCoordinatorJobEnvelope/)
    assert.match(source, /function applyCoordinatorJobEnvelope/)
    assert.match(source, /jobKey:/)
    assert.match(source, /canonicalSubject:/)
    assert.match(source, /attempt: makeCoordinatorAttemptEnvelope/)
})

test('aggregate space-feed buttons preserve resolver-only entries', () => {
    const source = readRepoFile('shared/js/content.js')
    const normalizeBody = extractFunction(source, 'function normalizeSpaceFeedButtonEntries(entries = [])')
    const clickBody = extractFunction(source, 'function getClickedSpaceFeedEntries(button, currentEntries)')
    const topBody = extractFunction(source, 'function syncSpaceFeedTopNukeButton(renderModel)')
    const postBody = extractFunction(source, 'function syncSpaceFeedPostButtons(renderModel)')

    assert.match(source, /function setSpaceFeedButtonEntries/)
    assert.match(source, /function getSpaceFeedButtonEntries/)
    assert.match(source, /dataset\.mbSpaceFeedEntries/)
    assert.match(normalizeBody, /resolutionReason:/)

    const entriesIndex = clickBody.indexOf('const buttonEntries = getSpaceFeedButtonEntries(button)')
    const urlsIndex = clickBody.indexOf('const buttonUrls = getSpaceFeedButtonUrls(button)')
    assert.notEqual(entriesIndex, -1)
    assert.notEqual(urlsIndex, -1)
    assert.ok(entriesIndex < urlsIndex)

    assert.match(topBody, /setSpaceFeedButtonSelection\(button, displayEntries\)/)
    assert.match(postBody, /setSpaceFeedButtonSelection\(queueButton, model\?\.queueableEntries \|\| \[\]\)/)
})

test('space-feed enqueue rollback clears resolver-only pending rows', () => {
    const contentSource = readRepoFile('shared/js/content.js')
    const swSource = readRepoFile('shared/js/sw.js')
    const nukeBody = extractFunction(contentSource, 'async function nukeSpaceFeedEntries(button, entries)')
    const contentRemoveUrlBody = extractFunction(contentSource, 'async function removePendingSpaceFeedUrls(urls)')
    const contentRemoveBody = extractFunction(contentSource, 'async function removePendingSpaceFeedEntries(entries = [])')
    const swRemoveBody = extractFunction(swSource, 'async function removePendingSpaceFeedEntries(postKeys = [])')

    assert.match(nukeBody, /registerPendingSpaceFeedEntries\(space, unfinishedEntries\)/)
    assert.match(nukeBody, /removePendingSpaceFeedEntries\(unfinishedEntries\)/)
    assert.match(contentRemoveBody, /removePendingSpaceFeedUrls\(urls\)/)
    assert.match(contentRemoveUrlBody, /remove-pending-space-feed-urls/)
    assert.match(contentRemoveBody, /remove-pending-space-feed-entries/)
    assert.doesNotMatch(contentRemoveUrlBody, /safeStorageSet\(\{\[SPACE_PENDING_NUKED_POSTS_KEY\]/)
    assert.doesNotMatch(contentRemoveBody, /safeStorageSet\(\{\[SPACE_PENDING_NUKED_POSTS_KEY\]/)
    assert.doesNotMatch(contentRemoveBody, /delete nextRecords\[postKey\]/)
    assert.match(swRemoveBody, /resolverPending !== true/)
    assert.match(swRemoveBody, /delete nextPending\[postKey\]/)
    assert.match(swSource, /request\.action === 'remove-pending-space-feed-entries'/)
})

test('unresolved resolver rows clear resolver-pending source records', () => {
    const source = readRepoFile('shared/js/sw.js')
    const helperBody = extractFunction(source, 'function clearResolverPendingSpaceRecords(pendingPosts = {}, item = {}, options = {})')
    const unresolvedBody = extractFunction(source, 'async function markQueuedProfileResolutionUnresolved(request = {}, sender = {})')
    const repairHelperBody = extractFunction(source, 'function repairTerminalResolverPendingSourceRecordsLocked(state = {}, itemKey = \'\', item = {})')
    const repairBody = extractFunction(source, 'async function repairCoordinatorStorageFromProgressLocked()')

    assert.match(helperBody, /resolverPending !== true/)
    assert.match(helperBody, /record\?\.resolverUrl/)
    assert.match(helperBody, /record\?\.postUrl/)
    assert.match(helperBody, /delete nextPending\[recordKey\]/)
    assert.match(helperBody, /resolverPending: false/)

    assert.match(unresolvedBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: 'resolver\.unresolved\.load'/)
    assert.match(unresolvedBody, /metricStorageGet\(\{[\s\S]*\[COORDINATOR_EVENTS_KEY\]: \[\],[\s\S]*\[SPACE_PENDING_NUKED_POSTS_KEY\]: \{\}/)
    assert.match(unresolvedBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'resolver-unresolved'/)
    assert.match(unresolvedBody, /expectedAttemptId: currentAttemptId \? incomingAttemptId : ''/)
    assert.match(unresolvedBody, /missing-attempt-identity/)
    assert.match(unresolvedBody, /isProfileResolutionItem\(item\)/)
    assert.match(unresolvedBody, /isActiveCoordinatorStatus\(item\.status\)/)
    assert.match(unresolvedBody, /isProfileResolutionItem\(currentItem\)/)
    assert.match(unresolvedBody, /isActiveCoordinatorStatus\(currentItem\.status\)/)
    assert.match(unresolvedBody, /\[SPACE_PENDING_NUKED_POSTS_KEY\]: \{\}/)
    assert.match(unresolvedBody, /clearResolverPendingSpaceRecords\(pendingPosts, nextItem/)
    assert.match(unresolvedBody, /pendingPosts: pendingResult\.pendingPosts/)
    assert.match(unresolvedBody, /pendingPosts: pendingResult\.changed/)
    assert.match(unresolvedBody, /queueOperation: 'resolver-unresolved-derived'/)
    assert.doesNotMatch(unresolvedBody, /loadCoordinatorState\(/)
    assert.doesNotMatch(unresolvedBody, /queue: true/)
    assert.doesNotMatch(unresolvedBody, /browser\.storage\.local\.set\(\{\[SPACE_PENDING_NUKED_POSTS_KEY\]: pendingResult\.pendingPosts\}\)/)
    assert.match(repairHelperBody, /isTerminalCoordinatorStatus\(item\.status\)/)
    assert.match(repairHelperBody, /isProfileResolutionItem\(item\)/)
    assert.match(repairHelperBody, /clearResolverPendingSpaceRecords\(pendingPosts, item/)
    assert.match(repairBody, /repairTerminalResolverPendingSourceRecordsLocked\(state, itemKey, item\)/)
})

test('failed resolver requeue preserves source-post resolution mode', () => {
    const source = readRepoFile('shared/js/sw.js')
    const candidateBody = extractFunction(source, 'function getCoordinatorRetryableFailureCandidates(queue = {}, progress = {}, retryLimit = 2)')
    const resetBody = extractFunction(source, 'function buildFailedCoordinatorResetItem(itemKey = \'\', item = {}, options = {})')
    const retryBody = extractFunction(source, 'async function retryCoordinatorFailedItems(request = {}, sender = {})')
    const requeueBody = extractFunction(source, 'async function requeueCoordinatorFailedItems(request = {}, sender = {})')
    const retryMutationBody = extractFunction(source, 'async function mutateCoordinatorFailedItemsRetry(operation = {})')
    const requeueMutationBody = extractFunction(source, 'async function mutateCoordinatorFailedItemsRequeue(operation = {})')

    assert.match(source, /function getFailedItemProfileResolutionRetryUrl/)
    assert.match(candidateBody, /resolutionRetryUrl/)
    assert.match(candidateBody, /!href && !candidate\.resolutionRetryUrl/)
    assert.match(resetBody, /getFailedItemProfileResolutionRetryUrl\(item, itemKey\)/)
    assert.match(resetBody, /resolutionMode: repairAsResolution \? QUEUED_PROFILE_RESOLUTION_MODE : ''/)
    assert.match(resetBody, /resolveProfileFromPage: repairAsResolution/)
    assert.match(retryBody, /kind: 'retryFailedItems'/)
    assert.match(requeueBody, /kind: 'requeueFailedItems'/)
    assert.match(retryMutationBody, /buildFailedCoordinatorResetItem\(candidate\.itemKey, item/)
    assert.match(requeueMutationBody, /getFailedItemProfileResolutionRetryUrl\(item, itemKey\)/)
    assert.match(requeueMutationBody, /buildFailedCoordinatorResetItem\(itemKey, item/)
})

test('manual failed requeue requests reconcile after durable storage', () => {
    const source = readRepoFile('shared/js/sw.js')
    const resetBody = extractFunction(source, 'function buildFailedCoordinatorResetItem(itemKey = \'\', item = {}, options = {})')
    const retryBody = extractFunction(source, 'async function retryCoordinatorFailedItems(request = {}, sender = {})')
    const requeueBody = extractFunction(source, 'async function requeueCoordinatorFailedItems(request = {}, sender = {})')
    const retryMutationBody = extractFunction(source, 'async function mutateCoordinatorFailedItemsRetry(operation = {})')
    const requeueMutationBody = extractFunction(source, 'async function mutateCoordinatorFailedItemsRequeue(operation = {})')

    const saveIndex = requeueMutationBody.indexOf('await saveCoordinatorState')
    const reconcileIndex = requeueBody.indexOf("const result = await runCoordinatorReconcileTick('requeue-failed-reconcile'")
    assert.notEqual(saveIndex, -1)
    assert.notEqual(reconcileIndex, -1)
    assert.match(retryBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'retryFailedItems'[\s\S]*reason: 'ordinaryMutation'/)
    assert.match(requeueBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'requeueFailedItems'[\s\S]*reason: 'ordinaryMutation'/)
    assert.match(retryMutationBody, /loadCoordinatorQueueRunsEventsProgressProjection\(\{[\s\S]*metricPath: 'failedRetry\.load'/)
    assert.doesNotMatch(retryMutationBody, /loadCoordinatorState\(/)
    assert.match(requeueMutationBody, /loadCoordinatorQueueRunsEventsProgressProjection\(\{[\s\S]*metricPath: 'failedRequeue\.load'/)
    assert.doesNotMatch(requeueMutationBody, /loadCoordinatorState\(/)
    assert.match(retryMutationBody, /persistCoordinatorAuthorityQueueWalBatchMutation\(/)
    assert.match(retryMutationBody, /operationKind: 'retry'/)
    assert.match(retryMutationBody, /removedRows/)
    assert.match(retryMutationBody, /queueOperation: 'retry-derived'/)
    assert.match(requeueMutationBody, /persistCoordinatorAuthorityQueueWalBatchMutation\(/)
    assert.match(requeueMutationBody, /operationKind: 'requeue'/)
    assert.match(requeueMutationBody, /removedRows/)
    assert.match(requeueMutationBody, /queueOperation: 'requeue-derived'/)
    assert.doesNotMatch(retryMutationBody, /queue: true/)
    assert.doesNotMatch(requeueMutationBody, /queue: true/)
    assert.match(retryBody, /enqueueSpaceFeedStorageUpdate\(\(\) =>/)
    assert.match(retryBody, /failureValue:[\s\S]*retry-save-failed/)
    assert.match(requeueBody, /enqueueSpaceFeedStorageUpdate\(\(\) =>/)
    assert.match(requeueBody, /failureValue:[\s\S]*requeue-save-failed/)
    assert.match(resetBody, /serviceWorkerOwned: true/)
    assert.match(requeueBody, /executionQueued: result\?\.resume\?\.queued \|\| result\?\.queued \|\| 0/)
    assert.match(retryBody, /runCoordinatorReconcileExecutorActions\('retry-failed-executor-busy'[\s\S]*awaitFill: true/)
    assert.match(requeueBody, /runCoordinatorReconcileExecutorActions\('requeue-failed-executor-busy'[\s\S]*awaitFill: true/)
    assert.doesNotMatch(retryBody, /await fillQueuedTabs\(\)/)
    assert.doesNotMatch(requeueBody, /await fillQueuedTabs\(\)/)
    assert.doesNotMatch(requeueBody, /enqueueExistingExecutorForCoordinator\(selectedItems/)
    assert.doesNotMatch(requeueBody, /kickCoordinatorQueueResume\('requeue-failed'\)/)
    assert.match(resetBody, /\.\.\.\(executorMaxConcurrent \? \{executorMaxConcurrent\} : \{\}\)/)
    assert.match(requeueBody, /requeue-started/)
    assert.match(requeueBody, /requeue-scheduled/)
})

test('invalid resolver repair rows are non-retryable and source-settled', () => {
    const source = readRepoFile('shared/js/sw.js')
    const repairBody = extractFunction(source, 'async function repairCoordinatorStorageFromProgressLocked()')
    const operationBody = extractFunction(source, 'function applyInvalidProfileResolutionRepairActionLocked(state = {}, operation = {})')

    assert.match(repairBody, /getInvalidProfileResolutionFailure\(item, itemKey\)/)
    assert.match(repairBody, /invalidTerminalResolutionNeedsRepair/)
    assert.match(repairBody, /applyInvalidProfileResolutionRepairActionLocked\(\{[\s\S]*queue,[\s\S]*pendingPosts/)
    assert.match(repairBody, /kind: 'repairInvalidProfileResolution'/)
    assert.match(repairBody, /getPersistedLiveTabForCoordinatorItem\(item, record, itemKey\)/)
    assert.match(operationBody, /status: 'skipped'/)
    assert.match(operationBody, /outcome: 'unresolved-target'/)
    assert.match(operationBody, /sourceSettlementOutcome: 'cleared'/)
    assert.match(operationBody, /matchesCoordinatorRepairOperationAttempt\(item, operation\)/)
    assert.match(operationBody, /clearResolverPendingSpaceRecords\(pendingPosts, nextItem/)
    assert.match(operationBody, /getCoordinatorRepairOperationTabIdsToClose\(operation, item, operation\.record \|\| null\)/)
    assert.match(repairBody, /storagePatch\[SPACE_PENDING_NUKED_POSTS_KEY\] = pendingPosts/)
    assert.match(repairBody, /pendingPosts: storagePatch\[SPACE_PENDING_NUKED_POSTS_KEY\]/)
    assert.match(repairBody, /pendingPosts: pendingPostsChanged/)
})

test('profile search buttons keep live commands dark and disabled commands grey', () => {
    const css = readRepoFile('shared/css/content.css')

    assert.match(css, /\.mb-ext_nuke-profiles-btn\s*\{[\s\S]*background-color:\s*#111/)
    assert.match(css, /\.mb-ext_profile-search-toolbar \.mb-ext_nuke-profiles-btn,\s*\n\.mb-ext_profile-search-action-host \.mb-ext_nuke-profiles-btn\s*\{[\s\S]*background-color:\s*#111[\s\S]*color:\s*#fff[\s\S]*border:\s*1px solid #111[\s\S]*border-radius:\s*999px/)
    assert.match(css, /\.mb-ext_profile-search-toolbar \.mb-ext_nuke-profiles-btn:not\(:disabled\):hover,\s*\n\.mb-ext_profile-search-action-host \.mb-ext_nuke-profiles-btn:not\(:disabled\):hover\s*\{[\s\S]*background-color:\s*#000[\s\S]*color:\s*#fff/)
    assert.match(css, /\.mb-ext_profile-search-toolbar \.mb-ext_nuke-profiles-btn:disabled,\s*\n\.mb-ext_profile-search-action-host \.mb-ext_nuke-profiles-btn:disabled\s*\{[\s\S]*background-color:\s*#f3f4f6[\s\S]*color:\s*#7b8494/)
    assert.match(css, /\.mb-ext_profile-search-toolbar \.mb-ext_nuke-profiles-btn--working,[\s\S]*background-color:\s*#fff7ed[\s\S]*color:\s*#7c2d12/)
    assert.match(css, /\.mb-ext_profile-search-toolbar \.mb-ext_nuke-profiles-btn--done,[\s\S]*background-color:\s*#eefdf3[\s\S]*color:\s*#166534/)
})

test('profile search controls only collect Follow-button profile rows', () => {
    const source = readRepoFile('shared/js/content.js')
    const pageTypeBody = extractFunction(source, 'function getPageType()')
    const searchPageBody = extractFunction(source, 'function isProfileSearchPage()')
    const followBody = extractFunction(source, 'function isProfileSearchFollowButton(button)')
    const rowsBody = extractFunction(source, 'function getProfileSearchRows(options = {})')
    const navigationBody = extractFunction(source, 'function installNavigationHooks()')
    const followUpsBody = extractFunction(source, 'function scheduleProfileSearchFollowUps()')

    assert.match(pageTypeBody, /isProfileSearchPage\(\)/)
    assert.match(searchPageBody, /location\.pathname/)
    assert.match(searchPageBody, /\/search/)
    assert.match(searchPageBody, /get\('type'\).*profile/)
    assert.match(followBody, /getAttribute\('aria-label'\)/)
    assert.match(followBody, /getElementText\(button\)/)
    assert.match(followBody, /labels\.some\(label => \/\^follow/)
    assert.match(followBody, /following/)
    assert.match(rowsBody, /querySelectorAll\('button, \[role="button"\]'\)/)
    assert.match(rowsBody, /filter\(isProfileSearchFollowButton\)/)
    assert.match(rowsBody, /getProfileSearchPrimaryHref\(row\)/)
    assert.match(navigationBody, /profile-search/)
    assert.match(followUpsBody, /scheduleProfileSearchControls\(0\)/)
})

test('profile search collector stages a bounded batch without queueing', () => {
    const source = readRepoFile('shared/js/content.js')
    const collectBody = extractFunction(source, 'async function collectMoreProfileSearchResults(button)')
    const queueBody = extractFunction(source, 'async function nukeProfileSearchHrefs(button, hrefs = [], options = {})')
    const syncBody = extractFunction(source, 'function syncProfileSearchControls()')
    const pendingCountBody = extractFunction(source, 'function getPendingCoordinatorProfileSearchWorkCount()')
    const nukeableBody = extractFunction(source, 'function isProfileSearchProfileNukeable(href, options = {})')
    const queueableBody = extractFunction(source, 'function getProfileSearchQueueableRows(rows = getProfileSearchRows(), options = {})')
    const batchBody = extractFunction(source, 'function getProfileSearchBatchHrefs(rows = getProfileSearchRows(), options = {})')
    const endBody = extractFunction(source, 'function isProfileSearchEndOfResultsVisible()')
    const loadingBody = extractFunction(source, 'function hasProfileSearchLoadingIndicator()')
    const nudgeBody = extractFunction(source, 'function nudgeProfileSearchLazyLoad()')
    const unstagedBody = extractFunction(source, 'function hasUnstagedProfileSearchQueueableRow(rows = getProfileSearchRows({fromCurrentViewport: true}))')
    const animationBody = extractFunction(source, 'async function animateNukeButtonPress(button)')
    const animationFrameBody = extractFunction(source, 'function waitForAnimationFramePair(options = {})')

    assert.match(source, /PROFILE_SEARCH_COLLECT_LIMIT = 100/)
    assert.match(source, /PROFILE_SEARCH_COLLECT_STALLED_TIMEOUT_MS = 30000/)
    assert.match(source, /PROFILE_SEARCH_PROFILES_PER_BATCH = 3/)
    assert.match(source, /function getProfileSearchProfilesPerBatch\(\)/)
    assert.match(source, /async function refreshProfileNukeProgressFromStorage\(\)/)
    assert.match(source, /refreshProfileNukeProgressFromStorage\(\)[\s\S]*scheduleProfileSearchControls\(0\)/)
    assert.match(source, /let profileSearchStagedHrefs = \[\]/)
    assert.match(source, /let profileSearchCollectCursorScrollY = 0/)
    assert.match(animationBody, /waitForAnimationFramePair\(\{timeoutMs: 120\}\)/)
    assert.match(animationFrameBody, /setTimeout\(finish, timeoutMs\)/)
    assert.match(animationFrameBody, /requestAnimationFrame\(\(\) => requestAnimationFrame\(finish\)\)/)
    assert.match(collectBody, /const initialStagedCount = getProfileSearchStagedHrefs\(\)\.length/)
    assert.match(collectBody, /const targetStagedCount = initialStagedCount \+ limit/)
    assert.match(collectBody, /await restoreProfileSearchCollectCursor\(\)/)
    assert.match(collectBody, /getProfileSearchRows\(\{fromCurrentViewport: true\}\)/)
    assert.match(collectBody, /nudgeProfileSearchLazyLoad\(\)/)
    assert.match(collectBody, /stageProfileSearchHrefs\(\[row\.href\]\)/)
    assert.match(collectBody, /saveProfileSearchCollectCursor\(rows\)/)
    assert.match(collectBody, /Collecting \$\{getProfileSearchStagedHrefs\(\)\.length\} \/ \$\{targetStagedCount\}/)
    assert.match(collectBody, /isProfileSearchEndOfResultsVisible\(\) && !hasUnstagedProfileSearchQueueableRow\(\) && !hasProfileSearchLoadingIndicator\(\)/)
    assert.match(collectBody, /nudgeProfileSearchLazyLoad\(\)/)
    assert.match(collectBody, /Date\.now\(\) - stalledStartedAt >= PROFILE_SEARCH_COLLECT_STALLED_TIMEOUT_MS/)
    assert.doesNotMatch(collectBody, /madeProgress \|\| hasUnstagedProfileSearchQueueableRow\(\)/)
    assert.match(collectBody, /Collected \$\{collectedCount\}/)
    assert.doesNotMatch(collectBody, /nukeProfileSearchHrefs\(/)
    assert.doesNotMatch(collectBody, /enqueueCoordinatorProfileUrls/)
    assert.match(batchBody, /const stagedHrefs = getProfileSearchStagedHrefs\(\)/)
    assert.match(batchBody, /if\(stagedHrefs\.length\) return stagedHrefs/)
    assert.match(endBody, /couldn\['’]\?t find any more results/)
    assert.match(loadingBody, /LoadingDots/)
    assert.match(nudgeBody, /window\.scroll/)
    assert.match(unstagedBody, /!profileSearchStagedHrefSet\.has\(href\)/)
    assert.match(queueBody, /sourceType: 'profile-search'/)
    assert.match(queueBody, /maxConcurrent: getProfileSearchProfilesPerBatch\(\)/)
    assert.match(queueBody, /noForegroundFallback: true/)
    assert.doesNotMatch(queueBody, /recordProfileNukeProgressBatch/)
    assert.match(queueBody, /Nuking \$\{queued\} left/)
    assert.match(queueBody, /ignoreStaleCurrentProfileSearchPending: true/)
    assert.match(pendingCountBody, /const currentSearchItems = Object\.values\(coordinatorQueue \|\| \{\}\)/)
    assert.match(pendingCountBody, /filter\(isCoordinatorItemForCurrentProfileSearch\)/)
    assert.match(pendingCountBody, /if\(currentSearchItems\.length > 0\) return 0/)
    assert.match(syncBody, /Collect \$\{limit\} More/)
    assert.match(syncBody, /'profile-search-batch'[\s\S]*nukeProfileSearchHrefs\(activeButton, hrefs/)
    assert.match(syncBody, /if\(queued\) resetProfileSearchCollectionState\(\{keepCursor: true\}\)/)
    assert.doesNotMatch(syncBody, /if\(profileSearchCollecting\) return/)
    assert.match(syncBody, /if\(profileSearchCollecting\) \{[\s\S]*buttons\.batch\.disabled = !batchHrefs\.length/)
    assert.match(syncBody, /getPendingCoordinatorProfileSearchWorkCount\(\)/)
    assert.match(syncBody, /Nuking \$\{pendingSearchCount\} left/)
    assert.doesNotMatch(pendingCountBody, /filter\(isCurrentProfileSearchRuntimeCoordinatorItem\)/)
    assert.match(nukeableBody, /ignoreStaleCurrentProfileSearchPending/)
    assert.match(queueableBody, /ignoreStaleCurrentProfileSearchPending: true/)
})

test('incoming coordinator executor concurrency can lower stale persisted rows', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function enqueueCoordinatorItemsStorageLocked(request = {})')

    assert.match(body, /const hasExecuteInput = request\.execute && typeof request\.execute === 'object'/)
    assert.match(body, /const requestedMaxConcurrent = Number\.parseInt\(executeInput\.maxConcurrent, 10\)/)
    assert.match(body, /executorMaxConcurrent: executorMaxConcurrent \|\| existing\?\.executorMaxConcurrent \|\| null/)
    assert.match(body, /executorOwner: hasExecuteInput \? 'service-worker' : existing\?\.executorOwner \|\| ''/)
    assert.match(body, /serviceWorkerOwned: hasExecuteInput \? true : existing\?\.serviceWorkerOwned === true/)
    assert.match(body, /persistCoordinatorAuthorityQueueWalBatchMutation\(/)
    assert.match(body, /operationKind: 'enqueue'/)
    assert.match(body, /loadCoordinatorQueueRunsEventsProgressProjection\(\{[\s\S]*metricPath: 'enqueue\.load'/)
    assert.doesNotMatch(body, /loadCoordinatorState\(/)
    assert.match(body, /queueOperation: 'enqueue-derived'/)
    assert.match(body, /resetCleanupTargets\.push/)
    assert.doesNotMatch(body, /await cancelCoordinatorExecutorsForReset\(/)
    assert.doesNotMatch(body, /saveCoordinatorState\(\{queue, runs, events, progress\}/)
    assert.doesNotMatch(body, /executorMaxConcurrent: resetExisting \? executorMaxConcurrent : existing\?\.executorMaxConcurrent \|\| executorMaxConcurrent \|\| null/)
    assert.doesNotMatch(body, /executorOwner: executeInput \? 'service-worker'/)
})

test('service-worker-owned status is visible to source-page run waits', () => {
    const source = readRepoFile('shared/js/sw.js')
    const contentSource = readRepoFile('shared/js/content.js')
    const statusBody = extractFunction(source, 'async function getOwnedNukeStatus(parentTabId, options = {})')
    const messageStart = source.indexOf("request.action === 'get-owned-nuke-status'")
    const cleanupMessageStart = source.indexOf("request.action === 'cleanup-owned-nuke-status'")
    const sweepMessageStart = source.indexOf("request.action === 'sweep-owned-blocked-profile-tabs'")
    const messageBody = source.slice(messageStart, cleanupMessageStart)
    const cleanupMessageBody = source.slice(cleanupMessageStart, sweepMessageStart)
    const waitBody = extractFunction(contentSource, 'async function waitForOwnedNukeTabsToDrain(button, timeoutMs = 180000, intervalMs = 1000, options = {})')

    assert.match(statusBody, /const runId = `\$\{options\?\.runId \|\| ''\}`\.trim\(\)/)
    assert.match(statusBody, /options\?\.cleanup === true/)
    assert.match(statusBody, /getKnownLiveOwnedTabIdsReadOnly\(ownerId\)/)
    assert.match(statusBody, /ownerIds\.add\(SERVICE_WORKER_QUEUE_OWNER_ID\)/)
    assert.match(statusBody, /metadata\.runId === runId/)
    assert.match(statusBody, /item\?\.runId !== runId/)
    assert.match(statusBody, /loadCoordinatorQueueProjection\(\{[\s\S]*metricPath: 'ownedNukeStatus\.queue\.load'/)
    assert.match(messageBody, /runId: request\.runId \|\| ''/)
    assert.doesNotMatch(messageBody, /scheduleStoredWorkRepair/)
    assert.doesNotMatch(messageBody, /getLiveOwnedTabIds/)
    assert.match(cleanupMessageBody, /scheduleStoredWorkRepair\(1000, \{reason: 'owned-nuke-status-cleanup'\}\)/)
    assert.match(cleanupMessageBody, /cleanup: true/)
    assert.match(waitBody, /getOwnedNukeStatus\(\{runId: options\.runId \|\| ''\}\)/)
    assert.match(contentSource, /waitForOwnedNukeTabsToDrain\(btn, 180000, 1000, \{runId: result\?\.runId \|\| ''\}\)/)
    assert.match(contentSource, /waitForOwnedNukeTabsToDrain\(buttons\.nuke, 180000, 1000, \{runId: result\?\.runId \|\| ''\}\)/)
})

test('repair restores stranded queued progress records into Current Work', () => {
    const source = readRepoFile('shared/js/sw.js')
    const repairBody = extractFunction(source, 'async function repairCoordinatorStorageFromProgressLocked()')
    const restoreBody = extractFunction(source, 'function restoreQueuedProgressRecordsToCoordinatorQueue(state = {}, options = {})')
    const enqueueBody = extractFunction(source, 'async function enqueueCoordinatorItems(request = {}, sender = {})')

    assert.match(repairBody, /restoreQueuedProgressRecordsToCoordinatorQueue/)
    assert.match(repairBody, /applyCoordinatorSourceMetadataRepair/)
    assert.match(repairBody, /events: eventsChanged/)
    assert.match(restoreBody, /makeCoordinatorSourceFromRunMetadata/)
    assert.match(restoreBody, /status: 'queued'/)
    assert.match(restoreBody, /serviceWorkerOwned: true/)
    assert.match(restoreBody, /buildQueuedCoordinatorProgressResetPatch/)
    assert.match(restoreBody, /recomputeCoordinatorRuns/)
    assert.match(enqueueBody, /coordinatorProgressSyncPromise/)
})

test('dashboard ready is display-only until explicit resume', () => {
    const source = readRepoFile('shared/js/sw.js')
    const activateBody = extractFunction(source, 'function markQuoraRuntimeActivated(reason = \'quora-observed\')')
    const restoreBody = extractFunction(source, 'async function restoreCoordinatorPageForStoredWorkOnce(options = {})')
    const repairTickBody = extractFunction(source, 'async function runStoredWorkRepairTick(reason = \'stored-work-repair-tick\')')
    const readyIndex = source.indexOf("request.action === 'coordinator-page-ready'")
    const pauseIndex = source.indexOf("request.action === 'pause-coordinator-nukes'")
    assert.notEqual(readyIndex, -1)
    assert.notEqual(pauseIndex, -1)

    const readyBranch = source.slice(readyIndex, pauseIndex)
    assert.doesNotMatch(readyBranch, /kickCoordinatorQueueResume\('dashboard-ready'\)/)
    assert.doesNotMatch(readyBranch, /scheduleStoredWorkRepair\(1000\)/)
    assert.doesNotMatch(readyBranch, /ensureQuoraRuntimeActivatedForScheduler/)
    assert.match(readyBranch, /requiresQuoraVisit: true/)
    assert.match(activateBody, /startQueueWakeupMetricsBackedStartupWork\(\{force: true\}\)/)
    assert.doesNotMatch(activateBody, /restoreCoordinatorPageForPersistentRetry/)
    assert.doesNotMatch(activateBody, /scheduleStoredWorkRepair/)
    assert.doesNotMatch(activateBody, /kickCoordinatorQueueResume/)
    assert.match(restoreBody, /recoverStoredCoordinatorWork\('coordinator-page-restore'/)
    assert.match(restoreBody, /options\.openDisplay === true/)
    assert.match(restoreBody, /serviceWorkerRecoveryFirst: true/)
    assert.ok(
        restoreBody.indexOf("recoverStoredCoordinatorWork('coordinator-page-restore'") <
        restoreBody.indexOf('openCoordinatorPage')
    )
    assert.match(repairTickBody, /runCoordinatorReconcileTick\(reason, \{[\s\S]*repairBeforeResume: true,[\s\S]*allowBeforeQuora: true/)
    assert.match(source, /scheduleStoredWorkRepair\(1000(?:,|\))/)
})

test('coordinator executor startup awaits tab filling unless explicitly skipped', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function enqueueExistingExecutorForCoordinatorOnce(items = [], coordinator = {}, options = {})')
    const resumeBody = extractFunction(source, 'async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {})')

    assert.match(body, /options\.awaitFill !== false/)
    assert.match(body, /await fillQueuedTabs\(fillOptions\)/)
    assert.match(body, /void fillQueuedTabs\(fillOptions\)/)
    assert.match(body, /pauseAlreadyChecked: options\.pauseAlreadyChecked === true/)
    assert.match(resumeBody, /awaitFill: options\.awaitFill !== false/)
})

test('queued executor actions preserve stored foreground policy', () => {
    const source = readRepoFile('shared/js/sw.js')
    const helperBody = extractFunction(source, 'function getQueuedActionNoForegroundFallback(item = null, options = {})')
    const activateOnOpenBody = extractFunction(source, 'function shouldActivateOwnedQueuedTabOnOpen(action = {})')
    const enqueueBody = extractFunction(source, 'async function enqueueExistingExecutorForCoordinatorOnce(items = [], coordinator = {}, options = {})')
    const recoverBody = extractFunction(source, 'async function recoverPendingTabActionFromCoordinatorQueue(sender = {})')
    const adoptBody = extractFunction(source, 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID)')

    assert.match(helperBody, /item\?\.executorNoForegroundFallback === true/)
    assert.match(helperBody, /item\?\.executorNoForegroundFallback === false/)
    assert.match(helperBody, /options\.noForegroundFallback === true/)
    assert.doesNotMatch(helperBody, /isForegroundQueuedTabAction/)
    assert.match(activateOnOpenBody, /action\?\.active === true/)
    assert.doesNotMatch(activateOnOpenBody, /isForegroundQueuedTabAction/)
    assert.match(enqueueBody, /const noForegroundFallback = getQueuedActionNoForegroundFallback\(item, options\)/)
    assert.match(recoverBody, /const noForegroundFallback = getQueuedActionNoForegroundFallback\(item\)/)
    assert.match(adoptBody, /const noForegroundFallback = getQueuedActionNoForegroundFallback\(item\)/)
    assert.match(adoptBody, /transitionCoordinatorItemForQueuedTab\(pendingAction, tab/)
    assert.doesNotMatch(enqueueBody, /noForegroundFallback: true/)
    assert.doesNotMatch(recoverBody, /noForegroundFallback: true/)
    assert.doesNotMatch(adoptBody, /noForegroundFallback: true/)
})

test('background tab opening updates authoritative Current Work', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function fillQueuedTabsOnce(options = {})')
    const planBody = extractFunction(source, 'function buildQueuedTabOpenEffectPlan(action = {}, tab = {}, openedAt = Date.now())')
    const progressBody = extractFunction(source, 'function buildQueuedTabOpenedProgressPatch(plan = {}, transition = {})')
    const activeEffectBody = extractFunction(source, 'async function confirmQueuedTabOpenDurableActiveEffect(action = {}, tab = {}, plan = {})')
    const transitionIndex = body.indexOf('confirmQueuedTabOpenDurableActiveEffect(next, tab, openPlan)')
    const progressIndex = body.indexOf('recordCoordinatorJobProgress(openPlan.profileHref')
    const failedTransitionIndex = activeEffectBody.indexOf('if(!activeTransitionAccepted)')
    const ensureIndex = body.indexOf("ensureQueuedTabContentScript(tab.id, 'queued-tab-opened')")
    const nudgeIndex = body.indexOf("nudgeQueuedTabActionClaimWithRetries(tab.id, 'queued-tab-opened')")
    const rollbackBody = extractFunction(source, 'async function mutateCoordinatorQueuedTabOpenRollback(operation = {})')
    const transitionBody = extractFunction(source, 'async function transitionCoordinatorItemForQueuedTabLocked(action = {}, tab = {}, details = {}, href = \'\', coordinatorKey = \'\')')
    const confirmBody = extractFunction(source, 'async function confirmQueuedTabDurablyActive(action = {}, tab = {}, details = {})')
    const keepOpenBody = extractFunction(source, 'function shouldKeepQueuedTabOpenAfterActiveTransitionFailure(action = {}, tab = {}, details = {})')

    assert.notEqual(transitionIndex, -1)
    assert.notEqual(progressIndex, -1)
    assert.notEqual(failedTransitionIndex, -1)
    assert.notEqual(ensureIndex, -1)
    assert.notEqual(nudgeIndex, -1)
    assert.ok(transitionIndex < progressIndex)
    assert.ok(progressIndex < ensureIndex)
    assert.ok(ensureIndex < nudgeIndex)
    assert.match(source, /QUEUED_TAB_ACTIVE_TRANSITION_TIMEOUT_MS = SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS \+ 5000/)
    assert.match(activeEffectBody, /activeTransitionAccepted = await promiseWithTimeout/)
    assert.match(activeEffectBody, /transitionCoordinatorItemForQueuedTab\(action, tab/)
    assert.match(transitionBody, /getQueuedTabMetadata\(tabId\)/)
    assert.match(transitionBody, /metadata\?\.closeRequestedAt \|\| metadata\?\.closeReason/)
    assert.match(transitionBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: 'activeTransition\.load'/)
    assert.doesNotMatch(transitionBody, /metricStorageGet\(/)
    assert.match(transitionBody, /latestMetadata\?\.closeRequestedAt \|\| latestMetadata\?\.closeReason/)
    assert.match(transitionBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'active-transition'/)
    assert.match(transitionBody, /expectedAttemptId/)
    assert.match(transitionBody, /expectedAttemptNumber/)
    assert.match(transitionBody, /metricPath: 'activeTransition\.save'/)
    assert.match(transitionBody, /saveCoordinatorState\(\{[\s\S]*runs: runsChanged \? nextRuns : undefined[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*reason: 'ordinaryMutation',[\s\S]*queueOperation: 'active-transition-derived'/)
    assert.doesNotMatch(transitionBody, /saveCoordinatorQueueRunsProjection\(/)
    assert.match(transitionBody, /return true/)
    assert.match(confirmBody, /loadCoordinatorQueueProjection\(\)\.catch\(\(\) => null\)/)
    assert.doesNotMatch(confirmBody, /loadCoordinatorState\(/)
    assert.match(rollbackBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: 'rollbackActiveTransition\.load'/)
    assert.doesNotMatch(rollbackBody, /metricStorageGet\(/)
    assert.match(rollbackBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'rollback-active-transition'/)
    assert.match(rollbackBody, /saveCoordinatorState\(\{[\s\S]*runs: runsChanged \? nextRuns : undefined[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*reason: 'repair'/)
    assert.doesNotMatch(rollbackBody, /saveCoordinatorQueueRunsProjection\(/)
    assert.match(rollbackBody, /status: 'queued'/)
    assert.match(rollbackBody, /actionLeaseReleaseReason: 'active-transition-failed'/)
    assert.match(rollbackBody, /return true/)
    assert.match(keepOpenBody, /hasActiveQueuedTabActionPhaseProgress\(record, metadata\)/)
    assert.match(keepOpenBody, /hasMismatchedCoordinatorAttempt\(expectedAttempt, record\)/)
    assert.match(activeEffectBody, /QUEUED_TAB_ACTIVE_TRANSITION_TIMEOUT_MS/)
    assert.match(activeEffectBody, /catch\(error\)/)
    assert.match(activeEffectBody, /activeTransitionError/)
    assert.match(activeEffectBody, /activeTransitionContinued/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /confirmQueuedTabDurablyActive\(action, tab/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /shouldKeepQueuedTabOpenAfterActiveTransitionFailure\(/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /scheduleStoredWorkRepair\(1000, \{[\s\S]*reason: 'active-transition-(?:continued|unconfirmed)'[\s\S]*edgeTriggered: true/)
    assert.match(planBody, /status: 'tab-opening'/)
    assert.match(progressBody, /activeTransitionAccepted/)
    assert.match(progressBody, /activeTransitionContinued/)
    assert.match(body.slice(progressIndex, progressIndex + 1800), /\{senderTabId: tab\.id\}/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /active-transition-failed/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /rollbackFailedQueuedTabOpen\(action, tab/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /detachQueuedTabRuntimeState\(tab\.id, 'active-transition-failed'\)/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /void releaseQueuedTab\(tab\.id, \{[\s\S]*runtimeDetached: true/)
    assert.doesNotMatch(body.slice(progressIndex, progressIndex + 900), /recordProfileNukeProgress\(openPlan\.profileHref/)
})

test('stale queued tab retry gets a fresh attempt identity', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(
        source,
        'function buildRetryQueuedTabAction(metadata = null, record = null)'
    )
    const advanceBody = extractFunction(
        source,
        'async function advanceCoordinatorQueueForStaleRetryAction(action = null, at = Date.now())'
    )
    const advanceMutationBody = extractFunction(
        source,
        'async function mutateCoordinatorStaleRetryQueuedTabAdvance(operation = {})'
    )
    const sweepBody = extractFunction(source, 'async function sweepStaleQueuedTabs(parentTabId = null)')
    const advanceIndex = sweepBody.indexOf('await advanceCoordinatorQueueForStaleRetryAction(retryAction, closedAt)')
    const enqueueIndex = sweepBody.indexOf('queuedTabActions.unshift(markQueuedTabExecutorActionPlanned(')

    assert.match(body, /const attemptId = makeAttemptId\(\)/)
    assert.match(body, /const attemptNumber = getNextAttemptNumberFromValue\(metadata\)/)
    assert.match(body, /const sourceAttemptId = getAttemptIdFromValue\(metadata\) \|\| getAttemptIdFromValue\(record\)/)
    assert.match(body, /const sourceAttemptNumber = getAttemptNumberFromValue\(metadata\) \|\| getAttemptNumberFromValue\(record\)/)
    assert.match(body, /sourceAttemptId,\s*\n\s*sourceAttemptNumber,/)
    assert.match(body, /attemptId,\s*\n\s*attemptNumber,/)
    assert.doesNotMatch(body, /attemptId: metadata\?\.attemptId/)
    assert.doesNotMatch(body, /attemptNumber: metadata\?\.attemptNumber/)
    assert.match(advanceBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'advanceStaleRetryQueuedTab'/)
    assert.match(advanceMutationBody, /const sourceAttemptId = normalizeAttemptId\(action\?\.sourceAttemptId/)
    assert.match(advanceMutationBody, /const sourceAttemptNumber = Number\.parseInt\(action\?\.sourceAttemptNumber, 10\) \|\| 0/)
    assert.match(advanceMutationBody, /const currentAttemptId = getAttemptIdFromValue\(item\)/)
    assert.match(advanceMutationBody, /const currentAttemptNumber = getAttemptNumberFromValue\(item\)/)
    assert.match(advanceMutationBody, /if\(!sourceAttemptId \|\| !sourceAttemptNumber \|\| !currentAttemptId \|\| !currentAttemptNumber\) return false/)
    assert.match(advanceMutationBody, /if\(sourceAttemptId !== currentAttemptId \|\| sourceAttemptNumber !== currentAttemptNumber\) return false/)
    assert.match(advanceMutationBody, /reduceJobEvent\(currentItem, \{[\s\S]*type: JOB_EVENT_RETRY/)
    assert.match(advanceMutationBody, /attemptId/)
    assert.match(advanceMutationBody, /attemptNumber/)
    assert.match(advanceMutationBody, /loadCoordinatorQueueRunsProjection\(\{[\s\S]*metricPath: 'staleRetry\.load'/)
    assert.match(advanceMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'stale-retry'/)
    assert.match(advanceMutationBody, /expectedAttemptId: sourceAttemptId/)
    assert.match(advanceMutationBody, /expectedAttemptNumber: sourceAttemptNumber/)
    assert.match(advanceMutationBody, /currentAuthorityState/)
    assert.match(advanceMutationBody, /context\.reject\('retry-reducer-rejected'\)/)
    assert.doesNotMatch(advanceMutationBody, /metricStorageGet\(/)
    assert.doesNotMatch(advanceMutationBody, /saveCoordinatorQueueRunsProjection\(/)
    assert.match(advanceMutationBody, /saveCoordinatorState\(\{[\s\S]*runs: runsChanged \? nextRuns : undefined[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*runs: runsChanged,[\s\S]*queueOperation: 'stale-retry-derived'/)
    assert.match(sweepBody, /attemptId: retryAction \? retryAction\.attemptId : getAttemptIdFromValue\(metadata\) \|\| getAttemptIdFromValue\(progressRecord\)/)
    assert.match(sweepBody, /attemptNumber: retryAction \? retryAction\.attemptNumber : getAttemptNumberFromValue\(metadata\) \|\| getAttemptNumberFromValue\(progressRecord\)/)
    assert.notEqual(advanceIndex, -1)
    assert.notEqual(enqueueIndex, -1)
    assert.ok(advanceIndex < enqueueIndex)
})

test('queued tab open skips rows already completed in progress', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function shouldOpenQueuedTabAction(action = null, options = {})'
    )
    const authorityReadIndex = body.indexOf('loadCoordinatorCurrentAuthorityState()')
    const successIndex = body.indexOf('isSuccessfulProfileNukeRecord(progressRecord)')
    const terminalIndex = body.indexOf('if(isTerminalCoordinatorStatus(item.status))')

    assert.notEqual(authorityReadIndex, -1)
    assert.notEqual(successIndex, -1)
    assert.notEqual(terminalIndex, -1)
    assert.ok(authorityReadIndex < successIndex)
    assert.ok(successIndex < terminalIndex)
    assert.match(body, /options\.currentAuthorityState \|\| options\.authorityState/)
    assert.match(body, /syncSuccessfulCoordinatorProgress\(normalizedHref, progressRecord\)/)
    assert.match(body, /reason: 'successful-progress-record'/)
})

test('queued progress keeps sender tab id in persisted records', () => {
    const source = readRepoFile('shared/js/sw.js')
    const helperBody = extractFunction(source, 'function addSenderTabIdToProgressPatch(patch = {}, senderTabId = null)')
    const batchBody = extractFunction(source, 'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})')
    const deferredBody = extractFunction(source, 'async function recordDeferredCoordinatorJobMilestone(profileHref = \'\', patch = {}, options = {})')
    const requestBody = extractFunction(source, 'async function recordJobProgressFromRequest(request = {}, sender = {}, options = {})')

    assert.match(helperBody, /normalizeTabId\(patch\?\.tabId \|\| senderTabId\)/)
    assert.match(batchBody, /addSenderTabIdToProgressPatch\(patch, options\.senderTabId\)/)
    assert.match(batchBody, /loadCoordinatorQueueRunsProgressProjection\(\{[\s\S]*metricPath: options\.expectTerminal === true \? 'terminalProgress\.load' : 'directProgress\.load'/)
    assert.doesNotMatch(batchBody, /loadCoordinatorState\(/)
    assert.match(deferredBody, /addSenderTabIdToProgressPatch\(patch, options\.senderTabId\)/)
    assert.match(requestBody, /recordDeferredCoordinatorJobMilestone\(targetProfileHref, patch,[\s\S]*senderTabId: tabId/)
    assert.match(requestBody, /recordCoordinatorJobProgress\(targetProfileHref, patch,[\s\S]*senderTabId: tabId/)
})

test('dashboard resume is a prompt kick with alarm-backed execution', () => {
    const source = readRepoFile('shared/js/sw.js')
    const kickBody = extractFunction(source, 'async function kickCoordinatorQueueResume(reason = \'resume-request\', options = {})')
    const resumeIndex = source.indexOf("request.action === 'resume-coordinator-queue'")
    const retryIndex = source.indexOf("request.action === 'retry-coordinator-failed'")
    const resumeBranch = source.slice(resumeIndex, retryIndex)

    assert.match(kickBody, /browser\.alarms\.create\(COORDINATOR_RESUME_ALARM_NAME/)
    assert.match(kickBody, /alarmCreated/)
    assert.match(kickBody, /runCoordinatorReconcileTick\(reason/)
    assert.match(kickBody, /scheduleCoordinatorQueueResume\(600, reason \|\| 'resume-request'\)/)
    assert.match(kickBody, /ensureQuoraRuntimeActivatedForScheduler\('resume-existing-quora-tab'\)/)
    assert.match(kickBody, /resumeScheduled/)
    assert.match(kickBody, /scheduledOnly/)
    assert.match(source, /alarm\?\.name === COORDINATOR_RESUME_ALARM_NAME/)
    assert.match(source, /ensureQuoraRuntimeActivatedForScheduler\('resume-alarm-existing-quora-session'\)/)
    assert.match(source, /return runScheduledCoordinatorQueueResume\('resume-alarm'\)/)
    assert.match(source, /async function runScheduledCoordinatorQueueResume\(reason = ''\)/)
    assert.match(source, /clearTimeout\(coordinatorQueueResumeTimeout\)/)
    assert.match(resumeBranch, /return kickCoordinatorQueueResume\('dashboard-resume'\)/)
    assert.match(resumeBranch, /scheduleStoredWorkRepair\(1000, \{[\s\S]*reason: 'dashboard-resume'[\s\S]*edgeTriggered: true/)
    assert.doesNotMatch(resumeBranch, /return resumeCoordinatorQueueExecution/)
    assert.doesNotMatch(resumeBranch, /\{direct: true\}/)
})

test('hidden queued profile actions can proceed after action gate timeout', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'async function maybeRunAutoProfileAction()')

    assert.match(body, /beginLocalNoForegroundActionGate/)
    assert.match(body, /Queued tab proceeded locally without foreground action gate/)
    assert.match(body, /localActionGateFallback/)
    assert.match(body, /Queued tab proceeded locally after durable profile action gate timeout/)
    assert.match(body, /!allowForegroundFallback/)
    assert.match(body, /readyPredicate\(\)/)
})

test('queued background tabs have a content-script injection fallback', () => {
    const source = readRepoFile('shared/js/sw.js')
    const probeBody = extractFunction(source, 'async function probeQueuedTabContentScript(tabId)')
    const ensureBody = extractFunction(source, 'async function ensureQueuedTabContentScript(tabId, reason = \'\')')
    const fillBody = extractFunction(source, 'async function fillQueuedTabsOnce(options = {})')
    const updateIndex = source.indexOf("changeInfo.status === 'complete'")

    assert.match(ensureBody, /browser\.scripting\.executeScript/)
    assert.match(probeBody, /getExpectedContentScriptVersion\(\)/)
    assert.match(probeBody, /versionMatches/)
    assert.match(probeBody, /present: !!result\?\.versionMatches/)
    assert.match(ensureBody, /files: \['js\/content\.js'\]/)
    assert.match(ensureBody, /files: \['css\/content\.css'\]/)
    assert.match(ensureBody, /contentScriptInjectedAt/)
    assert.match(ensureBody, /metadata\.contentScriptPresentAt \|\| metadata\.contentScriptInjectedAt/)
    assert.doesNotMatch(ensureBody, /metadata\.contentScriptEnsureFailedAt/)
    assert.match(fillBody, /ensureQueuedTabContentScript\(tab\.id, 'queued-tab-opened'\)/)
    assert.match(fillBody, /QUEUED_TAB_CONTENT_SCRIPT_ENSURE_TIMEOUT_MS/)
    assert.notEqual(updateIndex, -1)
    assert.match(source.slice(updateIndex, updateIndex + 200), /scheduleQueuedTabContentScriptEnsure\(tabId, 'tab-load-complete'\)/)
})

test('queued tab fill bounds stale open-decision reads', () => {
    const source = readRepoFile('shared/js/sw.js')
    const planBody = extractFunction(source, 'async function planQueuedTabExecutorAction(action = {}, options = {})')
    const finalCheckBody = extractFunction(source, 'async function validateQueuedTabOpenAgainstCurrentAuthority(action = {})')
    const fillBody = extractFunction(source, 'async function fillQueuedTabsOnce(options = {})')
    const enqueueBody = extractFunction(source, 'async function enqueueExistingExecutorForCoordinatorOnce(items = [], coordinator = {}, options = {})')
    const finalCheckIndex = fillBody.indexOf('validateQueuedTabOpenAgainstCurrentAuthority(next)')
    const createIndex = fillBody.indexOf('tab = await createOwnedTab(next)')

    assert.match(planBody, /promiseWithTimeout\(\s*shouldOpenQueuedTabAction\(action, \{[\s\S]*currentAuthorityState: options\.currentAuthorityState \|\| options\.authorityState \|\| null[\s\S]*\}\),\s*QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,\s*'queued tab open decision'/)
    assert.match(finalCheckBody, /promiseWithTimeout\(\s*shouldOpenQueuedTabAction\(action\),\s*QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,\s*'queued tab final open decision'/)
    assert.match(finalCheckBody, /reason: 'final-open-decision-timeout'/)
    assert.match(planBody, /reason: 'open-decision-timeout'/)
    assert.match(planBody, /open: true/)
    assert.match(planBody, /markQueuedTabExecutorActionPlanned\(action, openDecision, 'executor-apply-phase'\)/)
    assert.match(enqueueBody, /const plannedAction = await planQueuedTabExecutorAction/)
    assert.match(enqueueBody, /queuedTabActions\.push\(plannedAction\)/)
    assert.match(fillBody, /next\.executorPlanKind !== 'open-tab'/)
    assert.match(fillBody, /planQueuedTabExecutorAction\(next\)/)
    assert.notEqual(finalCheckIndex, -1)
    assert.notEqual(createIndex, -1)
    assert.ok(finalCheckIndex < createIndex)
})

test('resume rebuilds from durable queue after stale volatile queued actions do not open tabs', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function runCoordinatorExecutorApplyPhase(reason = \'coordinator-executor-apply\', options = {})')
    const dropBody = extractFunction(source, 'function dropVolatileQueuedActionsForDurableResume(reason = \'resume-rebuild-from-durable-queue\', details = {})')
    const resumeBody = extractFunction(source, 'async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {})')

    assert.match(body, /const queuedActionsBeforeFill = queuedTabActions\.length/)
    assert.match(body, /const fillResult = await fillQueuedTabs\(\{pauseAlreadyChecked: true\}\)/)
    assert.match(body, /fillResult\?\.throttled === true/)
    assert.match(body, /const schedulerBlockingQueuedExecutors = getSchedulerBlockingQueuedExecutorCount\(\)/)
    assert.match(body, /const activeAfterFill = getSchedulerBlockingQueuedExecutorCount\(\)/)
    assert.doesNotMatch(body, /if\(activeAfterFill \|\| runtimeActiveAfterFill/)
    assert.match(body, /dropVolatileQueuedActionsForDurableResume/)
    assert.match(source, /function getSchedulerBlockingQueuedExecutorCount\(\)/)
    assert.match(dropBody, /getSchedulerBlockingQueuedExecutorCount\(\) > 0/)
    assert.doesNotMatch(dropBody, /activeQueuedTabs\.size > 0|pendingTabActions\.size > 0/)
    assert.match(resumeBody, /runCoordinatorExecutorApplyPhase\(options\.reason \|\| 'resume'/)
    assert.match(resumeBody, /dropVolatileReason: options\.reason \|\| 'resume-rebuild-from-durable-queue'/)
    assert.match(source, /name: 'volatile-queued-actions-dropped'/)
})

test('stored work recovery reports durable work without deciding executor movement', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function recoverStoredCoordinatorWorkOnce(reason = \'stored-work-recovery\', options = {})')

    assert.match(source, /function makeStoredWorkRecoveryResumeOwnedResult/)
    assert.match(body, /return makeStoredWorkRecoveryResumeOwnedResult\(reason, repair, hasWork, paused\)/)
    assert.doesNotMatch(body, /dropVolatileQueuedActionsForDurableResume/)
    assert.doesNotMatch(body, /resumeCoordinatorQueueExecution\(/)
})

test('reconcile owns durable executor actions instead of falling back to pump-era resume', () => {
    const source = readRepoFile('shared/js/sw.js')
    const tickBody = extractFunction(source, 'async function runCoordinatorReconcileTickOnce(reason = \'coordinator-reconcile\', options = {})')
    const recoverBody = extractFunction(source, 'async function recoverStoredCoordinatorWorkOnce(reason = \'stored-work-recovery\', options = {})')
    const executorBody = extractFunction(source, 'async function runCoordinatorReconcileExecutorActions(reason = \'reconcile-executor-actions\', options = {})')
    const applyBody = extractFunction(source, 'async function runCoordinatorExecutorApplyPhase(reason = \'coordinator-executor-apply\', options = {})')

    assert.match(tickBody, /skipResume: true/)
    assert.match(tickBody, /runCoordinatorReconcileExecutorActions\(reason/)
    assert.match(tickBody, /awaitFill: options\.awaitFill !== false/)
    assert.match(tickBody, /executorQueued: executor\?\.queued/)
    assert.doesNotMatch(tickBody, /resumeCoordinatorQueueExecution\(/)
    assert.match(source, /resume-owned-by-reconcile/)
    assert.doesNotMatch(recoverBody, /resumeCoordinatorQueueExecution\(/)
    assert.match(executorBody, /runCoordinatorExecutorApplyPhase\(reason/)
    assert.match(executorBody, /dropVolatileSource: 'runCoordinatorReconcileExecutorActions'/)
    assert.match(applyBody, /dropVolatileQueuedActionsForDurableResume/)
    assert.match(applyBody, /enqueueExistingExecutorForCoordinator/)
    assert.match(applyBody, /getTokenMatchedLiveOrPersistedTabForCoordinatorItem/)
    assert.doesNotMatch(executorBody, /getLiveProfileTabsByHref\(\)/)
})

test('queued tab content ensure nudges the profile page to claim its action', () => {
    const swSource = readRepoFile('shared/js/sw.js')
    const contentSource = readRepoFile('shared/js/content.js')
    const ensureBody = extractFunction(swSource, 'async function ensureQueuedTabContentScript(tabId, reason = \'\')')
    const nudgeBody = extractFunction(swSource, 'async function nudgeQueuedTabActionClaim(tabId, reason = \'\')')
    const retryBody = extractFunction(swSource, 'async function nudgeQueuedTabActionClaimWithRetries(tabId, reason = \'\', delays = [0, 250, 750, 1500])')
    const fillBody = extractFunction(swSource, 'async function fillQueuedTabsOnce(options = {})')
    const adoptBody = extractFunction(swSource, 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID)')
    const messageBody = extractFunction(contentSource, 'function onMessage(request, sender, sendResponse)')

    assert.match(swSource, /QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS/)
    assert.match(nudgeBody, /makeClaimableQueuedTabAction/)
    assert.match(nudgeBody, /browser\.tabs\.sendMessage\(normalizedTabId/)
    assert.match(nudgeBody, /claim-current-profile-tab-action/)
    assert.match(nudgeBody, /queuedAction: claimableAction \|\| null/)
    assert.match(retryBody, /for\(const delay of delays\)/)
    assert.match(retryBody, /setTimeout\(resolve, delay\)/)
    assert.match(retryBody, /nudgeQueuedTabActionClaim\(tabId, reason\)/)
    assert.match(ensureBody, /nudgeQueuedTabActionClaimWithRetries\(normalizedTabId, reason \|\| 'content-script-present'\)/)
    assert.match(ensureBody, /nudgeQueuedTabActionClaimWithRetries\(normalizedTabId, reason \|\| 'content-script-injected'\)/)
    assert.match(ensureBody, /reason \|\| 'content-script-already-checked'/)
    assert.match(ensureBody, /alreadyChecked: true/)
    assert.match(ensureBody, /claim-nudge-not-accepted-after-injection/)
    assert.match(ensureBody, /!nudgeResult\?\.nudged && profileHref/)
    assert.match(ensureBody, /contentScriptPresentAt: 0/)
    assert.match(ensureBody, /contentScriptInjectedAt: 0/)
    assert.match(ensureBody, /contentScriptEnsureUrl: ''/)
    assert.match(ensureBody, /browser\.tabs\.reload\(normalizedTabId\)/)
    assert.match(fillBody, /nudgeQueuedTabActionClaimWithRetries\(tab\.id, 'queued-tab-opened'\)/)
    assert.match(fillBody, /scheduleOwnedBlockedProfileSweep\(next\.ownerTabId, 4000\)/)
    assert.match(adoptBody, /nudgeQueuedTabActionClaimWithRetries\(tabId, 'resume-live-active-tab'\)/)
    assert.match(adoptBody, /scheduleOwnedBlockedProfileSweep\(ownerTabId, 4000\)/)
    assert.match(messageBody, /request\.action === 'claim-current-profile-tab-action'/)
    assert.match(messageBody, /return \(async \(\) => \{/)
    assert.match(messageBody, /await refreshCoordinatorQueueFromStorage\(\)\.catch\(\(\) => null\)/)
    assert.match(messageBody, /return \{accepted: true/)
    assert.match(messageBody, /request\.queuedAction && typeof request\.queuedAction === 'object'/)
    assert.match(messageBody, /maybeRecordAlreadyBlockedCoordinatorProfile\(\)/)
    assert.match(messageBody, /void maybeRunAutoProfileAction\(\)/)
})

test('content script exposes a DOM marker for injection probes', () => {
    const source = readRepoFile('shared/js/content.js')

    assert.match(source.slice(0, 500), /data-mb-content-script-ready/)
    assert.match(source.slice(0, 500), /getManifest/)
})

test('queued profile action claim is bounded and retried for stored work', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'async function maybeRunAutoProfileAction()')

    assert.match(source, /QUEUED_ACTION_CLAIM_MESSAGE_TIMEOUT_MS/)
    assert.match(source, /autoProfileActionClaimPending/)
    assert.match(body, /safeSendRuntimeMessageWithTimeout\(\{\s*action: 'claim-tab-action'/)
    assert.match(body, /hasCurrentProfilePendingCoordinatorQueueItem\(\)/)
    assert.match(body, /QUEUED_ACTION_CLAIM_SLOW_RETRY_DELAY_MS/)
    assert.match(body, /claimedAction\?\.action !== 'nuke'/)
    assert.match(body, /autoProfileAction = undefined[\s\S]*QUEUED_ACTION_CLAIM_SLOW_RETRY_DELAY_MS/)
})

test('pending profile queued actions schedule a periodic claim rescue', () => {
    const source = readRepoFile('shared/js/content.js')
    const initBody = extractFunction(source, 'async function init()')
    const storageBody = extractFunction(source, 'function onStorageChanged(changes, areaName)')
    const syncBody = extractFunction(source, 'function syncProfileButtons()')
    const followUpBody = extractFunction(source, 'function scheduleProfileButtonsFollowUps()')
    const rescueBody = extractFunction(source, 'function scheduleCurrentProfilePendingClaimRescue(delayMs = QUEUED_ACTION_CLAIM_RESCUE_INTERVAL_MS)')
    const nudgeBody = extractFunction(source, 'function nudgeCurrentProfilePendingClaim()')
    const actionBody = extractFunction(source, 'async function maybeRunAutoProfileAction()')

    assert.match(source, /QUEUED_ACTION_CLAIM_RESCUE_INTERVAL_MS = 2000/)
    assert.match(rescueBody, /autoProfileAction = undefined/)
    assert.match(rescueBody, /void maybeRunAutoProfileAction\(\)/)
    assert.match(rescueBody, /scheduleCurrentProfilePendingClaimRescue\(\)/)
    assert.match(nudgeBody, /hasCurrentProfilePendingCoordinatorQueueItem\(\)/)
    assert.match(nudgeBody, /void maybeRunAutoProfileAction\(\)/)
    assert.match(nudgeBody, /scheduleCurrentProfilePendingClaimRescue\(\)/)
    assert.ok(initBody.indexOf('coordinatorQueue = normalizeCoordinatorQueue') < initBody.indexOf('nudgeCurrentProfilePendingClaim()'))
    assert.match(storageBody, /key === COORDINATOR_QUEUE_KEY[\s\S]*nudgeCurrentProfilePendingClaim\(\)/)
    assert.match(syncBody, /nudgeCurrentProfilePendingClaim\(\)/)
    assert.match(followUpBody, /nudgeCurrentProfilePendingClaim\(\)/)
    assert.match(followUpBody, /if\(!profileActionInProgress\)/)
    assert.match(actionBody, /scheduleCurrentProfilePendingClaimRescue\(retryDelay\)/)
    assert.match(actionBody, /scheduleCurrentProfilePendingClaimRescue\(\)/)
})

test('resume reattaches live active tabs after service worker restart', () => {
    const source = readRepoFile('shared/js/sw.js')
    const resumeBody = extractFunction(source, 'async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {})')
    const applyBody = extractFunction(source, 'async function runCoordinatorExecutorApplyPhase(reason = \'coordinator-executor-apply\', options = {})')
    const adoptBody = extractFunction(source, 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID)')
    const legacyBody = extractFunction(source, 'function buildLegacyCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {})')

    assert.match(resumeBody, /runCoordinatorExecutorApplyPhase\(options\.reason \|\| 'resume'/)
    assert.doesNotMatch(resumeBody, /getLiveProfileTabsByHref\(\)/)
    assert.match(applyBody, /getLiveProfileTabsByHref\(\)/)
    assert.match(applyBody, /isActiveCoordinatorStatus\(item\?\.status\)/)
    assert.match(applyBody, /getTokenMatchedLiveOrPersistedTabForCoordinatorItem\(item, record, itemKey, liveProfileTabsByHref\)/)
    assert.match(applyBody, /hasActiveQueuedTabActionPhaseProgress\(record, item\)\) continue/)
    assert.match(applyBody, /adoptLiveCoordinatorQueuedTab\(item, itemKey, liveTab, ownerTabId\)/)
    assert.match(applyBody, /reattached-live-active-tabs/)
    assert.match(adoptBody, /pendingTabActions\.set/)
    assert.match(adoptBody, /activeQueuedTabs\.add/)
    assert.match(adoptBody, /status: 'tab-opening'/)
    assert.match(adoptBody, /ensureQueuedTabContentScript\(tabId, 'resume-live-active-tab'\)/)
    assert.match(adoptBody, /nudgeQueuedTabActionClaimWithRetries\(tabId, 'resume-live-active-tab'\)/)
    assert.match(adoptBody, /Reattached live queued tab after service worker restart/)
    assert.match(legacyBody, /options\.refreshActiveAt === true/)
    assert.match(legacyBody, /record\.tabOpenedAt \|\| record\.contentOpenedAt/)
})

test('storage repair immediately reconciles active rows whose persisted tab is gone', () => {
    const source = readRepoFile('shared/js/sw.js')
    const helperBody = extractFunction(source, 'async function shouldImmediatelyReconcileMissingPersistedActiveTab(item = null, record = null)')
    const timeoutHelperBody = extractFunction(source, 'function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = \'\', liveProfileTabsByHref = new Map(), now = Date.now())')
    const decisionBody = extractFunction(source, 'async function getMissingActiveCoordinatorRepairDecision(')
    const repairBody = extractFunction(source, 'async function repairCoordinatorStorageFromProgressLocked()')
    const immediateIndex = repairBody.indexOf('await shouldImmediatelyReconcileMissingPersistedActiveTab(item, record)')
    const decisionIndex = repairBody.indexOf('await getMissingActiveCoordinatorRepairDecision(', immediateIndex)

    assert.match(helperBody, /getPersistedQueuedTabId\(item, record\)/)
    assert.match(helperBody, /hasOwnedQueuedTabState\(tabId\)/)
    assert.match(helperBody, /await browser\.tabs\.get\(tabId\)/)
    assert.match(helperBody, /detachQueuedTabRuntimeState\(tabId, 'missing-persisted-active-tab'\)/)
    assert.match(helperBody, /catch\s*\{[\s\S]*return true/)
    assert.match(helperBody, /isTerminalCoordinatorStatus\(item\.status\)/)
    assert.match(timeoutHelperBody, /isTerminalCoordinatorStatus\(item\.status\)/)
    assert.match(decisionBody, /shouldReconcileMissingActiveCoordinatorTab\(item, record, href, liveProfileTabsByHref, now\)/)
    assert.match(decisionBody, /getPersistedLiveTabForCoordinatorItem\(item, record, itemKey\)/)
    assert.match(decisionBody, /isDurableActiveCoordinatorReclaimStale\(item, record, now\)/)
    assert.match(decisionBody, /closePersistedTab: false/)
    assert.match(decisionBody, /closePersistedTab: true/)
    assert.notEqual(immediateIndex, -1)
    assert.notEqual(decisionIndex, -1)
    assert.ok(immediateIndex < decisionIndex)
    assert.match(repairBody, /applyMissingActiveCoordinatorEvidenceReconcileActionLocked\(state, \{[\s\S]*closePersistedTab: missingActiveDecision\.closePersistedTab === true/)
    assert.match(repairBody, /tabsToCloseAfterRepair\.add\(closeTabId\)/)
})

test('terminal queued progress schedules stored work continuation', () => {
    const source = readRepoFile('shared/js/sw.js')
    const releaseFollowUpBody = extractFunction(source, 'function scheduleQueuedTabReleaseFollowUp(delayMs = 500)')
    const continuationBody = extractFunction(source, 'function scheduleQueuedWorkContinuation(reason = \'queued-work-continuation\')')
    const progressBody = extractFunction(source, 'async function recordJobProgressFromRequest(request = {}, sender = {}, options = {})')

    assert.match(releaseFollowUpBody, /scheduleQueuedWorkContinuation\('queued-tab-release'\)/)
    assert.match(continuationBody, /kickCoordinatorQueueResume\(reason, \{direct: true\}\)/)
    assert.doesNotMatch(continuationBody, /kickCoordinatorQueueResume\(reason\)\.catch/)
    assert.doesNotMatch(continuationBody, /scheduleStoredWorkRepair\(1000, \{reason\}\)/)
    assert.match(continuationBody, /closeTerminalOwnedProfileTabs\(\)/)
    assert.doesNotMatch(continuationBody, /restoreCoordinatorPageForStoredWork\(\)/)
    assert.match(progressBody, /if\(result\.terminal\) scheduleQueuedWorkContinuation\('terminal-job-progress'\)/)
    assert.match(progressBody, /if\(terminal\) scheduleQueuedWorkContinuation\('terminal-profile-progress'\)/)
})

test('dashboard resume returns scheduled recovery with repair follow-up scheduled', () => {
    const source = readRepoFile('shared/js/sw.js')
    const messageStart = source.indexOf("else if(request.action === 'resume-coordinator-queue')")
    assert.notEqual(messageStart, -1)
    const body = source.slice(messageStart, messageStart + 450)

    assert.match(body, /return kickCoordinatorQueueResume\('dashboard-resume'\)/)
    assert.match(body, /scheduleStoredWorkRepair\(1000, \{[\s\S]*reason: 'dashboard-resume'[\s\S]*edgeTriggered: true/)
    assert.doesNotMatch(body, /\{direct: true\}/)
})

test('manifests allow service-worker content-script injection fallback', () => {
    const chromeManifest = JSON.parse(readRepoFile('manifests/chrome.json'))
    const firefoxManifest = JSON.parse(readRepoFile('manifests/firefox.json'))

    assert.ok(chromeManifest.permissions.includes('scripting'))
    assert.ok(firefoxManifest.permissions.includes('scripting'))
})

test('space-feed scan root prefers the post-bearing main content node', () => {
    const source = readRepoFile('shared/js/content.js')
    const rootBody = extractFunction(source, 'function getSpaceFeedContentRoot()')
    const syncBody = extractFunction(source, 'function syncSpaceFeedNukeControls()')

    assert.match(rootBody, /querySelectorAll\('#mainContent, main, \[role="main"\]'\)/)
    assert.match(rootBody, /timestampCount: candidate\.querySelectorAll\?\.\('a\.post_timestamp'\)\.length \|\| 0/)
    assert.match(rootBody, /right\.timestampCount - left\.timestampCount/)
    assert.match(syncBody, /const main = getSpaceFeedContentRoot\(\)/)
})

test('target-space posts can queue the visible header profile without follow proxy markers', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'function getSpaceFeedPostCandidateProfileUrls(postRoot, timestamp)')
    const targetIndex = body.indexOf('if(isTargetSpacePage())')
    const assetIndex = body.indexOf('if(isAssetSpacePage())')

    assert.notEqual(targetIndex, -1)
    assert.notEqual(assetIndex, -1)
    assert.ok(targetIndex < assetIndex)
    assert.match(body.slice(targetIndex, assetIndex), /posterProfileUrls\.length/)
    assert.match(body.slice(targetIndex, assetIndex), /getNormalizedProfileHrefList\(\[headerProfileHref\]\)/)
})

test('asset-space source-post resolver rows do not use the visible post author', () => {
    const source = readRepoFile('shared/js/content.js')
    const subject = readRepoFile('shared/js/subject.js')
    const body = extractFunction(source, 'function getQueuedPageResolvedProfileHref(claimedAction = {})')
    const singleBody = extractFunction(source, 'function getSingleSpacePostResolutionProfileHref(options = {})')
    const textUrlBody = extractFunction(source, 'function getProfileUrlsFromText(text)')
    const postArtifactBody = extractFunction(source, 'function getProfileUrlCandidatesFromSpacePostHref(href)')
    const explicitSlugBody = extractFunction(subject, 'function isLikelyExplicitProfileTargetSlug(slug)')
    const reasonBody = extractFunction(source, "function isSourcePostResolutionReason(reason = '')")
    const associationBody = extractFunction(source, 'function getResolvableSpaceFeedPostAssociations(entries)')
    const harness = loadQueuedPageResolutionHarness()
    const reporterHref = 'https://www.quora.com/profile/David-Brower'
    const targetHref = 'https://www.quora.com/profile/Reported-Target'
    const sourcePostClaim = {
        resolveProfileFromPage: true,
        resolutionMode: 'author-profile',
        resolutionReason: 'source-post-needs-profile-resolution'
    }

    assert.match(body, /resolutionReason === 'low-confidence-profile-artifact'/)
    assert.match(reasonBody, /source-post-needs-profile-resolution/)
    assert.match(body, /if\(isAssetSpacePage\(\)\) return explicitProfileHref/)
    assert.match(singleBody, /candidate\.source === 'listed-profile-link'/)
    assert.match(textUrlBody, /isLikelyExplicitProfileTargetHref\(href\)/)
    assert.match(postArtifactBody, /isLikelyExplicitProfileTargetSlug\(cleanSlug\)/)
    assert.match(postArtifactBody, /SPACE_FEED_CANDIDATE_CONFIDENCE_LOW/)
    assert.match(explicitSlugBody, /proseTokens/)
    assert.match(explicitSlugBody, /tokens\.length > 4 && nonNameishCount >= 2/)
    assert.match(associationBody, /source-post-resolution/)
    assert.doesNotMatch(associationBody, /post-author-resolution/)

    harness.state.assetSpace = true
    harness.state.headerProfileHref = reporterHref
    harness.state.originalPosterProfileHref = reporterHref
    harness.state.explicitProfileHref = ''
    assert.equal(harness.resolve(sourcePostClaim), null)

    harness.state.explicitProfileHref = targetHref
    assert.equal(harness.resolve(sourcePostClaim), targetHref)

    harness.state.explicitProfileHref = ''
    assert.notEqual(harness.resolve(sourcePostClaim), reporterHref)

    harness.state.assetSpace = false
    assert.equal(harness.resolve(sourcePostClaim), reporterHref)
})

test('source-post resolver waits for durable remap before navigating', () => {
    const source = readRepoFile('shared/js/content.js')
    const messageBody = extractFunction(source, 'function onMessage(request, sender, sendResponse)')
    const retryBody = extractFunction(source, 'async function sendQueuedProfileResolutionMessageWithRetry(message)')
    const actionBody = extractFunction(source, 'async function maybeRunAutoProfileAction()')

    assert.match(source, /QUEUED_PROFILE_RESOLUTION_MESSAGE_ATTEMPTS = 3/)
    assert.match(messageBody, /canResolveQueuedProfileFromCurrentPage\(nextProfileAction \|\| \{\}\)/)
    assert.match(messageBody, /return \{accepted: false, reason: 'not-profile'\}/)
    assert.ok(
        messageBody.indexOf('const nextProfileAction') <
        messageBody.indexOf('canResolveQueuedProfileFromCurrentPage(nextProfileAction || {})')
    )
    assert.match(retryBody, /QUEUED_PROFILE_RESOLUTION_MESSAGE_TIMEOUT_MS/)
    assert.match(retryBody, /result\?\.resolved === true/)
    assert.match(actionBody, /sendQueuedProfileResolutionMessageWithRetry/)
    assert.match(actionBody, /if\(response\?\.resolved !== true\) return false/)
    assert.match(actionBody, /location\.replace\(resolvedProfileHref\)/)
})

test('resolved profile handoff remaps queued tab metadata and pending action', () => {
    const source = readRepoFile('shared/js/sw.js')
    const remapBody = extractFunction(source, 'function remapQueuedTabToResolvedProfile(tabId, item = {}, resolvedHref = \'\', requestedUrl = \'\')')
    const resolveBody = extractFunction(source, 'async function resolveQueuedProfileTarget(request = {}, sender = {})')
    const resolveMutationBody = extractFunction(source, 'async function mutateCoordinatorQueuedProfileTargetResolve(operation = {})')

    assert.match(remapBody, /profileHref: resolvedHref/)
    assert.match(remapBody, /coordinatorKey: resolvedHref/)
    assert.match(remapBody, /resolveProfileFromPage: false/)
    assert.match(remapBody, /resolutionMode: ''/)
    assert.match(remapBody, /resolutionReason: ''/)
    assert.match(remapBody, /pendingTabActions\.set/)
    assert.match(remapBody, /targetUrl: resolvedHref/)
    assert.match(remapBody, /attemptId/)
    assert.match(remapBody, /attemptNumber/)
    assert.match(resolveBody, /mutateCoordinatorProjection\(\{[\s\S]*kind: 'resolveQueuedProfileTarget'/)
    assert.match(resolveBody, /result\?\.resolved === true[\s\S]*remapQueuedTabToResolvedProfile\(/)
    assert.match(resolveMutationBody, /delete nextQueue\[itemKey\]/)
    assert.match(resolveMutationBody, /\[resolvedHref\]: nextItem/)
    assert.match(resolveMutationBody, /loadCoordinatorQueueRunsPendingProjection\(\{[\s\S]*metricPath: 'resolver\.resolve\.load'/)
    assert.doesNotMatch(resolveMutationBody, /loadCoordinatorState\(/)
    assert.match(resolveMutationBody, /terminal-coordinator-item/)
    assert.match(resolveMutationBody, /not-profile-resolution-item/)
    assert.match(resolveMutationBody, /inactive-coordinator-item/)
    assert.match(resolveMutationBody, /missing-attempt-identity/)
    assert.match(resolveMutationBody, /persistCoordinatorAuthorityQueueWalBatchMutation\(/)
    assert.match(resolveMutationBody, /operationKind: 'resolver-remap'/)
    assert.match(resolveMutationBody, /removedRows/)
    assert.match(resolveMutationBody, /queue: false/)
    assert.match(resolveMutationBody, /pendingPosts: pendingResult\.changed/)
})

test('space feed pause is explicit, not overloaded on working nuke buttons', () => {
    const source = readRepoFile('shared/js/content.js')
    const topBody = extractFunction(source, 'function syncSpaceFeedTopNukeButton(renderModel)')
    const postBody = extractFunction(source, 'function syncSpaceFeedPostButtons(renderModel)')
    const pauseBody = extractFunction(source, 'function syncSpaceFeedTopPauseButton(host, workingButton, model = {}, activeWork = false)')

    assert.match(source, /function syncSpaceFeedTopPauseButton/)
    assert.match(pauseBody, /mb-ext_space-feed-pause-btn/)
    assert.match(pauseBody, /pauseSpaceFeedQueue/)
    assert.match(topBody, /if\(activeButton\.dataset\.mbNukeState === 'working'\) \{\s*return\s*\}/)
    assert.match(topBody, /syncSpaceFeedTopPauseButton\(host, button, model, activeSpaceWork\)/)
    assert.match(topBody, /button\.disabled = true/)
    assert.doesNotMatch(postBody, /dataset\.mbNukeState === 'working'[\s\S]{0,120}pauseSpaceFeedQueue/)
})

test('space feed action buttons keep Nuke Em labels', () => {
    const source = readRepoFile('shared/js/content.js')
    const topBody = extractFunction(source, 'function syncSpaceFeedTopNukeButton(renderModel)')
    const postBody = extractFunction(source, 'function syncSpaceFeedPostButtons(renderModel)')
    const globalWorkLabelBody = extractFunction(source, 'function formatSpaceFeedGlobalWorkLabel()')
    const postWorkLabelBody = extractFunction(source, 'function formatSpaceFeedPostWorkLabel()')

    assert.match(topBody, /Nuke 'Em/)
    assert.match(postBody, /Nuke 'Em/)
    assert.match(globalWorkLabelBody, /Nuking\.\.\./)
    assert.match(postWorkLabelBody, /Nuking this/)
    assert.doesNotMatch(topBody, /Queue visible/)
    assert.doesNotMatch(postBody, /Queue visible/)
    assert.doesNotMatch(globalWorkLabelBody, /Space jobs/)
    assert.doesNotMatch(postWorkLabelBody, /This post:/)
    assert.doesNotMatch(postWorkLabelBody, /left/)
})

test('dashboard has reversible pause and explicit current work cancel', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const sw = readRepoFile('shared/js/sw.js')
    const pauseStoredBody = extractFunction(sw, 'async function pauseStoredCoordinatorWork(options = {})')
    const pauseStoredMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkPause(operation = {})')
    const pauseItemBody = extractFunction(sw, 'function buildPausedCoordinatorQueueItem(item = {}, now = Date.now(), reason = \'coordinator-pause-request\')')
    const pauseCleanupBody = extractFunction(sw, 'async function pauseCoordinatorNukesCleanup(pauseGeneration = coordinatorPauseGeneration)')
    const pauseBody = extractFunction(sw, 'async function pauseCoordinatorNukes()')
    const cancelBody = extractFunction(sw, 'async function cancelCoordinatorCurrentWork()')
    const cancelStoredBody = extractFunction(sw, 'async function cancelStoredCoordinatorWork(options = {})')
    const cancelStoredMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkCancel(operation = {})')
    const resumePausedBody = extractFunction(sw, 'async function resumePausedCoordinatorNukes()')
    const resumeBody = extractFunction(sw, 'async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {})')
    const pauseControlBody = extractFunction(dashboard, 'function syncCurrentWorkPauseControls(queueItems = [])')
    const togglePauseBody = extractFunction(dashboard, 'async function toggleCurrentWorkPause()')
    const flashButtonBody = extractFunction(dashboard, 'function flashButton(button)')
    const css = readRepoFile('shared/css/coordinator.css')

    assert.match(html, /id="pauseCurrentWorkButton"/)
    assert.match(html, /id="pauseCurrentWorkState"/)
    assert.match(html, /id="cancelCurrentWorkButton"/)
    assert.match(html, /Cancel Queue/)
    assert.match(dashboard, /resume-paused-coordinator-nukes/)
    assert.match(dashboard, /cancel-coordinator-current-work/)
    assert.match(dashboard, /cancel-coordinator-current-work-item/)
    assert.match(dashboard, /let currentWorkPausePending = ''/)
    assert.match(pauseControlBody, /pausePending/)
    assert.match(pauseControlBody, /Pausing\.\.\./)
    assert.match(pauseControlBody, /Resuming\.\.\./)
    assert.match(pauseControlBody, /pause-state--paused/)
    assert.match(pauseControlBody, /pause-state--pending/)
    assert.match(togglePauseBody, /flashButton\(button\)/)
    assert.match(togglePauseBody, /currentWorkPausePending = wasPaused \? 'resume' : 'pause'/)
    assert.match(togglePauseBody, /currentWorkPausePending = ''/)
    assert.match(flashButtonBody, /clear-button--flash/)
    assert.match(css, /\.clear-button--flash/)
    assert.match(css, /@keyframes button-flash/)
    assert.match(css, /\.pause-state\s*\{[\s\S]*border-radius: 3px;/)
    assert.doesNotMatch(css, /\.pause-state\s*\{[\s\S]*border-radius: 999px;/)
    assert.match(css, /\.pause-state--paused/)
    assert.match(css, /\.pause-state--pending/)
    assert.match(pauseCleanupBody, /pauseStoredCoordinatorWork/)
    assert.match(pauseCleanupBody, /isCoordinatorPauseGenerationCurrent\(pauseGeneration\)/)
    assert.match(pauseCleanupBody, /!storedResult \|\| typeof storedResult !== 'object' \|\| storedResult\?\.reason \|\| storedResult\?\.persistence\?\.saved === false/)
    assert.match(pauseCleanupBody, /shouldContinue: \(\) => isCoordinatorPauseGenerationCurrent\(pauseGeneration\)/)
    assert.match(pauseBody, /setCoordinatorPauseControlState\(true, pauseGeneration, 'ordinaryMutation'\)/)
    assert.match(pauseBody, /const pauseGeneration = nextCoordinatorPauseGeneration\(\)/)
    assert.match(pauseBody, /const cleanup = await pauseCoordinatorNukesCleanup\(pauseGeneration\)/)
    assert.match(pauseBody, /scheduled: false/)
    assert.doesNotMatch(pauseBody, /void pauseCoordinatorNukesCleanup\(pauseGeneration\)/)
    assert.doesNotMatch(pauseBody, /cancelStoredCoordinatorWork/)
    assert.match(resumePausedBody, /const pauseGeneration = nextCoordinatorPauseGeneration\(\)/)
    assert.match(resumePausedBody, /setCoordinatorPauseControlState\(false, pauseGeneration, 'ordinaryMutation'\)/)
    assert.match(resumePausedBody, /void setCoordinatorRunsPaused\(false\)/)
    assert.match(resumePausedBody, /kickCoordinatorQueueResume\('dashboard-resume', \{direct: true\}\)/)
    assert.match(pauseStoredBody, /pauseGeneration/)
    assert.match(pauseStoredBody, /kind: 'pauseStoredWork'/)
    assert.match(pauseStoredMutationBody, /mutateCoordinatorPauseStateSet\(\{[\s\S]*paused: true,[\s\S]*pauseGeneration/)
    assert.match(pauseStoredMutationBody, /isCoordinatorPauseGenerationCurrent\(pauseGeneration\)/)
    assert.match(pauseStoredMutationBody, /buildPausedCoordinatorQueueItem/)
    assert.match(pauseStoredMutationBody, /operationKind: 'stored-work-pause'/)
    assert.match(pauseItemBody, /status: 'queued'/)
    assert.doesNotMatch(pauseStoredMutationBody, /status: 'canceled'/)
    assert.match(cancelBody, /cancelStoredCoordinatorWork/)
    assert.match(cancelStoredBody, /kind: hasTarget \? 'cancelStoredWorkItem' : 'cancelStoredWork'/)
    assert.match(cancelStoredMutationBody, /status: 'canceled'/)
    assert.match(cancelStoredMutationBody, /operationKind: 'stored-work-cancel'/)
    assert.match(cancelStoredMutationBody, /persistCoordinatorAuthorityQueueWalBatchMutation\(/)
    assert.match(cancelStoredMutationBody, /queueOperation: 'stored-work-cancel-derived'/)
    assert.match(cancelBody, /setCoordinatorPauseControlState\(false, pauseGeneration, 'ordinaryMutation'\)/)
    assert.match(resumeBody, /COORDINATOR_PAUSED_KEY/)
    assert.match(resumeBody, /reason: 'coordinator-paused'/)
})

test('contributor modal rows are queueable without follow proxy controls', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'function isModalItemQueueable(item)')
    const observer = extractFunction(source, 'function startObserver()')

    assert.match(source, /function isContributorProfileModal\(modal\)/)
    assert.match(source, /function getProfileModalForItem\(item\)/)
    assert.match(body, /isContributorProfileModal\(getProfileModalForItem\(item\)\)/)
    assert.match(body, /return true/)
    assert.match(body, /return hasVisibleFollowProxy\(item\)/)
    assert.match(observer, /const activeModal = getProfilePeopleModal\(\)/)
    assert.match(observer, /needsLateModalActions/)
    assert.match(observer, /!activeModalButtons\.nuke/)
    assert.match(observer, /injectModalOpenProfilesBtn\(\)/)
})

test('modal contributor nuking uses small tab batches', () => {
    const source = readRepoFile('shared/js/content.js')
    const helper = extractFunction(source, 'function getModalProfileNukeProfilesPerBatch()')
    const body = extractFunction(source, 'async function nukeModalProfiles()')

    assert.match(source, /MODAL_PROFILE_NUKE_PROFILES_PER_BATCH = 3/)
    assert.match(helper, /Math\.min\(value, MODAL_PROFILE_NUKE_PROFILES_PER_BATCH\)/)
    assert.match(body, /const maxConcurrent = getModalProfileNukeProfilesPerBatch\(\)/)
    assert.match(body, /const queueLimit = maxConcurrent/)
    assert.match(body, /urlsToQueue\.length < queueLimit/)
    assert.match(body, /if\(urlsToQueue\.length >= queueLimit\) break/)
})

test('same-attempt terminal success repairs stale failed coordinator rows', () => {
    const source = readRepoFile('shared/js/sw.js')
    const repairBody = extractFunction(source, 'async function repairCoordinatorStorageFromProgressLocked()')
    const progressRepairBody = extractFunction(source, 'function applyProgressRecordCoordinatorRepairActionLocked(state = {}, operation = {})')
    const preferBody = extractFunction(
        source,
        'function shouldPreferSuccessfulProgressOverTerminalCoordinatorItem(item = null, record = null, mapped = null)'
    )
    const restoreBody = extractFunction(
        source,
        'function shouldRestoreTerminalProgressFromCoordinatorItem(item = null, record = null)'
    )
    const transitionBody = extractFunction(
        source,
        'function transitionCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {})'
    )
    const syncBody = extractFunction(
        source,
        'async function syncCoordinatorProgressRecordsLocked(progressRecords = {})'
    )
    const syncWrapperBody = extractFunction(
        source,
        'function syncCoordinatorProgressRecords(progressRecords = {})'
    )
    const directBody = extractFunction(
        source,
        'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})'
    )

    assert.match(preferBody, /itemStatus === 'succeeded'/)
    assert.match(preferBody, /effectiveMapped\.status !== 'succeeded'/)
    assert.match(preferBody, /isSuccessfulProfileNukeRecord\(record\)/)
    assert.match(preferBody, /hasMismatchedCoordinatorAttempt\(item, record\)/)
    assert.match(restoreBody, /shouldPreferSuccessfulProgressOverTerminalCoordinatorItem\(item, record, mapped\)/)
    assert.match(transitionBody, /promoteTerminalCoordinatorItemFromSuccessfulProgress\(item, record, mapped/)
    assert.match(repairBody, /applyProgressRecordCoordinatorRepairActionLocked\(state, \{[\s\S]*kind: 'repairFromProgressRecord'[\s\S]*record,[\s\S]*mapped,[\s\S]*resetRetry/)
    assert.match(progressRepairBody, /matchesCoordinatorRepairOperationAttempt\(item, operation\)/)
    assert.match(progressRepairBody, /transitionCoordinatorItemFromProgress\(item, record, mapped/)
    assert.match(progressRepairBody, /queue\[itemKey\] = nextItem/)
    assert.match(syncBody, /Fall through so a same-attempt success can repair a stale terminal timeout row/)
    assert.match(syncBody, /href => normalizeQuoraProfileUrl\(href\)/)
    assert.match(syncBody, /persistCoordinatorAuthorityQueueWalBatchMutation\(/)
    assert.match(syncBody, /operationKind: 'compatibility-progress-sync'/)
    assert.match(syncBody, /queue: false/)
    assert.doesNotMatch(syncBody, /queue: changed/)
    assert.match(syncBody, /await settleTerminalCoordinatorItemsLocked\({/)
    assert.doesNotMatch(syncBody, /await settleTerminalCoordinatorItems\({/)
    assert.match(syncWrapperBody, /enqueueSpaceFeedStorageUpdate\(\(\) => syncCoordinatorProgressRecordsLocked\(progressRecords\)\)/)
    assert.match(directBody, /preferSuccessfulTerminal = shouldPreferSuccessfulProgressOverTerminalCoordinatorItem\(item, record, mapped\)/)
    assert.match(directBody, /patchCanTransitionStatus \|\| preferSuccessfulTerminal/)
})

test('mute-block queued action heartbeats while direct block work is running', () => {
    const body = extractFunction(
        readRepoFile('shared/js/content.js'),
        'async function maybeRunAutoProfileAction()'
    )
    const actionReadyIndex = body.indexOf("event: 'Profile actions became available'")
    const heartbeatIndex = body.indexOf('startQueuedActionHeartbeat(() => ({', actionReadyIndex)
    const blockProfileIndex = body.indexOf('blockProfile({silent: true, allowForegroundFallback}', actionReadyIndex)
    const stopIndex = body.indexOf('stopHeartbeat()', blockProfileIndex)

    assert.notEqual(actionReadyIndex, -1)
    assert.notEqual(heartbeatIndex, -1)
    assert.notEqual(blockProfileIndex, -1)
    assert.notEqual(stopIndex, -1)
    assert.ok(actionReadyIndex < heartbeatIndex)
    assert.ok(heartbeatIndex < blockProfileIndex)
    assert.ok(blockProfileIndex < stopIndex)
    assert.match(body, /Queued direct block action still running/)
})

test('profile queued action claim starts after durable queue state loads', () => {
    const source = readRepoFile('shared/js/content.js')
    const initBody = extractFunction(source, 'async function init()')
    const nudgeBody = extractFunction(source, 'function nudgeCurrentProfilePendingClaim()')
    const actionBody = extractFunction(source, 'async function maybeRunAutoProfileAction()')
    const listenerIndex = initBody.indexOf('browser.runtime.onMessage.addListener(onMessage)')
    const firstStorageIndex = initBody.indexOf('settings = await safeStorageGet(defaults)')
    const queueLoadedIndex = initBody.indexOf('await refreshCoordinatorQueueFromStorage()')
    const regularClaimIndex = initBody.lastIndexOf('nudgeCurrentProfilePendingClaim()')
    const refreshBody = extractFunction(source, 'async function refreshCoordinatorQueueFromStorage()')

    assert.notEqual(listenerIndex, -1)
    assert.notEqual(firstStorageIndex, -1)
    assert.notEqual(queueLoadedIndex, -1)
    assert.notEqual(regularClaimIndex, -1)
    assert.ok(listenerIndex < firstStorageIndex)
    assert.ok(firstStorageIndex < queueLoadedIndex)
    assert.ok(queueLoadedIndex < regularClaimIndex)
    assert.doesNotMatch(actionBody, /makeProfileActionFromCoordinatorQueueEntry/)
    assert.match(actionBody, /safeSendRuntimeMessageWithTimeout\(\{[\s\S]*action: 'claim-tab-action'/)
    assert.match(actionBody, /!coordinatorQueueLoaded/)
    assert.match(refreshBody, /coordinatorQueueLoaded = true/)
    assert.match(nudgeBody, /void maybeRunAutoProfileAction\(\)/)
})

test('profile block click path does not await nonterminal progress breadcrumbs', () => {
    const body = extractFunction(
        readRepoFile('shared/js/content.js'),
        'async function blockProfile(options = {})'
    )
    const foundIndex = body.indexOf("event: 'Block confirm found'")
    const clickedIndex = body.indexOf("event: 'Block confirm activation attempted'")

    assert.match(body, /function blockProfile/)
    assert.match(body, /noteCurrentProfileNukeProgress\(\{\s*event: 'Block option found'/)
    assert.match(body, /noteCurrentProfileNukeProgress\(\{\s*event: 'Block option clicked'/)
    assert.match(body, /noteCurrentProfileNukeProgress\(\{\s*event: 'Block confirm found'/)
    assert.match(body, /noteCurrentProfileNukeProgress\(\{\s*event: 'Block confirm activation attempted'/)
    assert.notEqual(foundIndex, -1)
    assert.notEqual(clickedIndex, -1)
    assert.doesNotMatch(body.slice(foundIndex - 80, clickedIndex + 120), /await recordCurrentProfileNukeProgress/)
})

test('queued tab release and close messages are bounded', () => {
    const contentSource = readRepoFile('shared/js/content.js')
    const swSource = readRepoFile('shared/js/sw.js')
    const releaseBody = extractFunction(contentSource, 'async function notifyQueuedTabComplete()')
    const closeBody = extractFunction(contentSource, 'async function requestCloseTab(attempts = 3, delayMs = 150, scheduleFollowUps = true)')
    const releaseBranchStart = swSource.indexOf("request.action === 'release-job-tab'")
    const closeBranchStart = swSource.indexOf("request.action === 'close-tab'")
    const recordBranchStart = swSource.indexOf("request.action === 'record-nuke-progress'")
    const releaseAndCloseBranches = swSource.slice(releaseBranchStart, recordBranchStart)

    assert.match(releaseBody, /safeSendRuntimeMessageWithTimeout/)
    assert.match(releaseBody, /QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS/)
    assert.doesNotMatch(releaseBody, /await safeSendRuntimeMessage\(/)
    assert.match(closeBody, /safeSendRuntimeMessageWithTimeout/)
    assert.match(closeBody, /QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS/)
    assert.doesNotMatch(closeBody, /await safeSendRuntimeMessage\(/)
    assert.notEqual(releaseBranchStart, -1)
    assert.notEqual(closeBranchStart, -1)
    assert.match(releaseAndCloseBranches, /releaseQueuedTab\(tabId, \{awaitFill: true\}\)/)
})

test('active queued already-blocked repair releases and closes the tab', () => {
    const body = extractFunction(
        readRepoFile('shared/js/content.js'),
        'async function maybeRecordAlreadyBlockedCoordinatorProfile()'
    )
    const nudgeBody = extractFunction(
        readRepoFile('shared/js/content.js'),
        'function nudgeCurrentProfilePendingClaim()'
    )
    const repairIndex = body.indexOf("event: 'Visible profile was already blocked; repairing coordinator row'")
    const activeIndex = body.indexOf('isActiveQueuedProgressRecord(href)')
    const guardIndex = body.indexOf('Already-blocked repair was not recorded; leaving queued tab open for retry', activeIndex)
    const releaseIndex = body.indexOf('await notifyQueuedTabComplete()', activeIndex)
    const closeIndex = body.indexOf('await requestCloseTab()', activeIndex)

    assert.notEqual(repairIndex, -1)
    assert.notEqual(activeIndex, -1)
    assert.notEqual(guardIndex, -1)
    assert.notEqual(releaseIndex, -1)
    assert.notEqual(closeIndex, -1)
    assert.ok(repairIndex < activeIndex)
    assert.ok(activeIndex < guardIndex)
    assert.ok(guardIndex < releaseIndex)
    assert.ok(releaseIndex < closeIndex)
    assert.match(body, /const progress = await recordAlreadyBlockedCoordinatorProgress\(href, item, progressPatch\)/)
    assert.match(readRepoFile('shared/js/content.js'), /action: 'record-job-terminal'/)
    assert.match(body, /if\(progress\?\.serviceWorkerOnly && !progress\.runtimeRecorded\)/)
    assert.match(body, /alreadyBlockedCoordinatorRepairKey = ''/)
    assert.match(nudgeBody, /maybeRecordAlreadyBlockedCoordinatorProfile\(\)/)
})

test('live queued tab adoption requires durable active transition before cleanup', () => {
    const source = readRepoFile('shared/js/sw.js')
    const adoptBody = extractFunction(source, 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID)')
    const terminalizeBody = extractFunction(source, 'async function terminalizeAlreadyBlockedQueuedTab(tabId, reason = \'already-blocked-queued-tab\')')
    const activeSetIndex = adoptBody.indexOf('activeQueuedTabs.add(tabId)')
    const transitionIndex = adoptBody.indexOf('const activeTransitioned = await transitionCoordinatorItemForQueuedTab')
    const failedIndex = adoptBody.indexOf("detachQueuedTabRuntimeState(tabId, 'resume-live-active-tab-transition-failed')")
    const terminalizeIndex = adoptBody.indexOf("terminalizeAlreadyBlockedQueuedTab(tabId, 'resume-live-active-tab-already-blocked')")
    const nudgeIndex = adoptBody.indexOf("nudgeQueuedTabActionClaimWithRetries(tabId, 'resume-live-active-tab')")

    assert.notEqual(activeSetIndex, -1)
    assert.notEqual(transitionIndex, -1)
    assert.notEqual(failedIndex, -1)
    assert.notEqual(terminalizeIndex, -1)
    assert.notEqual(nudgeIndex, -1)
    assert.ok(activeSetIndex < transitionIndex)
    assert.ok(transitionIndex < failedIndex)
    assert.ok(failedIndex < terminalizeIndex)
    assert.ok(terminalizeIndex < nudgeIndex)
    assert.match(adoptBody, /if\(!activeTransitioned\)/)
    assert.match(adoptBody, /return false/)
    assert.match(terminalizeBody, /action: 'close-if-blocked'/)
    assert.match(terminalizeBody, /recordOwnedBlockedSweepTerminal/)
    assert.match(terminalizeBody, /if\(!recorded\?\.terminal\) return false/)
    assert.match(terminalizeBody, /releaseQueuedTabAndCleanup\(normalizedTabId, \{awaitFill: true\}\)/)
    assert.match(terminalizeBody, /browser\.tabs\.remove\(normalizedTabId\)/)
})

test('profile blocked detection accepts body-level blocked confirmation', () => {
    const source = readRepoFile('shared/js/content.js')
    const blockedBody = extractFunction(source, 'function isProfileBlocked(options = {})')
    const bodyTextHelper = extractFunction(source, 'function hasProfileBlockedBodyText()')
    const unblockedBody = extractFunction(source, 'function isProfileVisiblyUnblocked()')
    const bodyTextIndex = blockedBody.indexOf('hasProfileBlockedBodyText()')
    const inlineIndex = blockedBody.indexOf('isProfileBlockedFromInlineState()')

    assert.notEqual(bodyTextIndex, -1)
    assert.notEqual(inlineIndex, -1)
    assert.ok(bodyTextIndex < inlineIndex)
    assert.match(bodyTextHelper, /getPageType\(\) !== 'profile'/)
    assert.match(bodyTextHelper, /\(\^\|\\n\)\\s\*BLOCKED/)
    assert.match(bodyTextHelper, /you\(\?:'ve\| have\)\\s\+blocked/)
    assert.match(unblockedBody, /if\(hasProfileBlockedBodyText\(\)\) return false/)
})

test('fresh queued tab progress clears stale close fields', () => {
    const contentSource = readRepoFile('shared/js/content.js')
    const actionBody = extractFunction(contentSource, 'async function maybeRunAutoProfileAction()')
    const initialOpenIndex = actionBody.indexOf("status: 'tab-opened'")
    const resolvedOpenIndex = actionBody.indexOf('Resolved queued page target to')
    const swBody = extractFunction(readRepoFile('shared/js/sw.js'), 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID)')
    const reattachIndex = swBody.indexOf("status: 'tab-opening'")

    assert.notEqual(initialOpenIndex, -1)
    assert.match(actionBody.slice(initialOpenIndex, initialOpenIndex + 500), /closeRequestedAt: 0/)
    assert.match(actionBody.slice(initialOpenIndex, initialOpenIndex + 500), /tabClosedAt: 0/)
    assert.match(actionBody.slice(initialOpenIndex, initialOpenIndex + 500), /slotReleasedAt: 0/)
    assert.notEqual(resolvedOpenIndex, -1)
    assert.match(actionBody.slice(resolvedOpenIndex - 500, resolvedOpenIndex + 300), /closeRequestedAt: 0/)
    assert.notEqual(reattachIndex, -1)
    assert.match(swBody.slice(reattachIndex, reattachIndex + 500), /closeRequestedAt: 0/)
    assert.match(swBody.slice(reattachIndex, reattachIndex + 500), /slotReleasedAt: 0/)
})

test('queued retry progress clears stale terminal attempt fields', () => {
    const swSource = readRepoFile('shared/js/sw.js')
    const body = extractFunction(swSource, 'function normalizeProgressPatch(profileHref, patch = {}, existing = null)')
    const queuedIndex = body.indexOf("cleanPatch.status === 'queued'")
    const eventIndex = body.indexOf('const event =')

    assert.notEqual(queuedIndex, -1)
    assert.notEqual(eventIndex, -1)
    const queuedBody = body.slice(queuedIndex, eventIndex)
    assert.match(queuedBody, /terminalAt: 0/)
    assert.match(queuedBody, /tabClosedAt: 0/)
    assert.match(queuedBody, /slotReleasedAt: 0/)
    assert.match(queuedBody, /tabOpenedAt: 0/)
    assert.match(queuedBody, /contentOpenedAt: 0/)
    assert.match(queuedBody, /actionReadyAt: 0/)
    assert.match(queuedBody, /blockAttemptedAt: 0/)
    assert.match(queuedBody, /blockedAt: 0/)
    assert.match(queuedBody, /blockSucceeded: false/)
    assert.match(queuedBody, /openedViablePage: false/)
    assert.match(queuedBody, /lastUrl: ''/)
    assert.match(queuedBody, /events: \[\]/)
    assert.match(body.slice(eventIndex, eventIndex + 400), /const previousEvents = resetQueuedProgress/)
})

test('queued mute-block success uses direct block and releases without a second blocked-state probe', () => {
    const body = extractFunction(
        readRepoFile('shared/js/content.js'),
        'async function maybeRunAutoProfileAction()'
    )
    const directBlockIndex = body.indexOf('Queued Mute Block skipped mute and started block directly')
    const blockCallIndex = body.indexOf('blockedDirectly = await blockProfile({silent: true, allowForegroundFallback})', directBlockIndex)
    const closeIndex = body.indexOf('await closeQueuedBlockedTab()', blockCallIndex)
    const secondProbeIndex = body.indexOf('if(isProfileBlocked())', closeIndex)

    assert.notEqual(directBlockIndex, -1)
    assert.notEqual(blockCallIndex, -1)
    assert.notEqual(closeIndex, -1)
    assert.notEqual(secondProbeIndex, -1)
    assert.ok(directBlockIndex < blockCallIndex)
    assert.ok(blockCallIndex < closeIndex)
    assert.ok(closeIndex < secondProbeIndex)
    assert.doesNotMatch(body, /completed = await muteProfile\(\{allowBlockFallback: true/)
})

test('service-worker queued mute-block work goes straight to block', () => {
    const body = extractFunction(
        readRepoFile('shared/js/content.js'),
        'async function maybeRunAutoProfileAction()'
    )
    const directBlockIndex = body.indexOf('Queued Mute Block skipped mute and started block directly')

    assert.notEqual(directBlockIndex, -1)
    assert.match(body.slice(directBlockIndex), /blockProfile\(\{silent: true, allowForegroundFallback\}\)/)
})

test('profile block flow can resume from an open confirmation dialog', () => {
    const source = readRepoFile('shared/js/content.js')
    const blockBody = extractFunction(source, 'async function blockProfile(options = {})')
    const confirmBody = extractFunction(source, 'async function completePendingBlockConfirmation(initialButton = null, silent = false)')
    const blockConfirmBody = extractFunction(source, 'function getBlockConfirmAction()')
    const blockContextBody = extractFunction(source, 'function isBlockConfirmContextText(text)')
    const pendingIndex = blockBody.indexOf('const pendingBlockConfirm = getBlockConfirmAction()')
    const startIndex = blockBody.indexOf("event: 'Block flow started'")

    assert.notEqual(pendingIndex, -1)
    assert.notEqual(startIndex, -1)
    assert.ok(pendingIndex < startIndex)
    assert.match(blockBody, /Block flow resumed from pending confirmation/)
    assert.match(blockBody, /completePendingBlockConfirmation\(pendingBlockConfirm, silent\)/)
    assert.match(blockBody, /activateConfirmationElement\(blockBtn, isBlockConfirmPending, 'block'\)/)
    assert.match(blockBody, /waitForVerifiedProfileBlocked\(8000, 250\)/)
    assert.match(confirmBody, /Block confirm activation attempted/)
    assert.match(confirmBody, /activateConfirmationElement\(blockBtn, isBlockConfirmPending, 'block'\)/)
    assert.match(confirmBody, /await waitForCondition\(\(\) => profileBlockMutationCount > initialMutationCount, 5000, 250\)/)
    assert.match(confirmBody, /waitForVerifiedProfileBlocked\(8000, 250\)/)
    assert.doesNotMatch(confirmBody, /\bmutationSeen\b/)
    assert.doesNotMatch(confirmBody, /profileBlockMutationCount > initialMutationCount[\s\S]{0,120}rememberProfileBlocked\(\)/)
    assert.doesNotMatch(confirmBody, /\|\| await waitForCondition\(\(\) => isProfileBlocked/)
    assert.match(confirmBody, /Block completed/)
    assert.match(blockConfirmBody, /getContextualDialogPrimaryAction\([\s\S]*isBlockConfirmContextText/)
    assert.doesNotMatch(blockConfirmBody, /getInPageConfirmPairAction/)
    assert.match(blockContextBody, /!isMuteConfirmContextText\(value\)/)
})

test('profile menu opening tries background before foreground fallback', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'async function ensureProfileMenuOpen(timeoutMs = 2500, silent = false, allowForegroundFallback = false)')

    assert.match(source, /function dispatchActivationKey\(element, key = 'Enter'\)/)
    assert.match(body, /dispatchActivationKey\(menu, 'Enter'\)/)
    assert.match(body, /dispatchActivationKey\(menu, ' '\)/)
    assert.match(body, /allowForegroundFallback = false/)
    assert.match(body, /if\(promotion\.promoted\)/)
    assert.match(body, /foregroundPromotionDeniedReason: promotion\.reason/)
    assert.match(body, /return false/)
    assert.match(body, /Profile menu did not open in the background; requesting foreground fallback/)
    assert.ok(
        body.indexOf('await dismissNonProfileMenuSurface()') <
            body.indexOf('Profile menu did not open in the background; requesting foreground fallback')
    )
    assert.ok(
        body.indexOf('if(!toggleMenu(silent)) return false') <
            body.indexOf('Profile menu did not open in the background; requesting foreground fallback')
    )
})

test('profile menu action lookup does not foreground when action is found in background', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'async function waitForMenuStateWithForegroundFallback(primaryRegex, inverseRegex, options = {})')

    assert.match(body, /allowForegroundFallback = false/)
    assert.doesNotMatch(body, /const allowForegroundFallback = true/)
    assert.doesNotMatch(body, /Profile menu action was found in the background; requesting foreground fallback/)
    assert.ok(
        body.indexOf('if(state || document.visibilityState === \'visible\') return state') <
            body.indexOf('Profile menu action was not visible in the background; requesting foreground fallback')
    )
})

test('mute and unmute confirmations use robust confirmation activation', () => {
    const source = readRepoFile('shared/js/content.js')
    const muteBody = extractFunction(source, 'async function muteProfile(options = {})')
    const blockBody = extractFunction(source, 'async function blockProfile(options = {})')
    const unmuteBody = extractFunction(source, 'async function unmuteProfile(options = {})')
    const unmuteBestEffortBody = extractFunction(source, 'async function unmuteProfileBestEffort(options = {})')
    const activateBody = extractFunction(source, "async function activateConfirmationElement(element, isStillPending, confirmationKind = '')")
    const foregroundUnavailableBody = extractFunction(source, 'function isConfirmationForegroundUnavailable(result = null)')
    const pageWorldBody = extractFunction(source, "async function activateConfirmationElementInPageWorld(element, confirmationKind = '')")
    const mutePendingBody = extractFunction(source, 'function isMuteConfirmPending()')
    const unmutePendingBody = extractFunction(source, 'function isUnmuteConfirmPending()')
    const blockPendingBody = extractFunction(source, 'function isBlockConfirmPending()')
    const swSource = readRepoFile('shared/js/sw.js')
    const beginActionBody = extractFunction(swSource, 'async function beginCoordinatorProfileAction(request = {}, sender = {})')
    const swActivateBody = extractFunction(swSource, 'async function activateConfirmationElementInPageWorld(request = {}, sender = {})')

    assert.match(muteBody, /await activateConfirmationElement\(confirmBtn, isMuteConfirmPending, 'mute'\)/)
    assert.doesNotMatch(muteBody, /activateActionElement\(confirmBtn\)/)
    assert.match(muteBody, /Mute confirm foreground unavailable/)
    assert.match(blockBody, /Block confirm foreground unavailable/)
    assert.match(unmuteBody, /await activateConfirmationElement\(confirmButton, isUnmuteConfirmPending, 'unmute'\)/)
    assert.match(unmuteBestEffortBody, /await activateConfirmationElement\(confirmButton, isUnmuteConfirmPending, 'unmute'\)/)
    assert.match(activateBody, /return \{activated: false, ok: false, skipped: true, reason: 'missing-confirmation-element'\}/)
    assert.match(activateBody, /element\.click\(\)/)
    assert.match(activateBody, /ensureForegroundForConfirmation\(confirmationKind\)/)
    assert.match(activateBody, /getConfirmationKindMismatchReason\(element, confirmationKind\)/)
    assert.match(activateBody, /confirmationMismatchReason/)
    assert.match(activateBody, /foregroundAvailable: false/)
    assert.match(activateBody, /confirmation activation attempted/)
    assert.match(activateBody, /confirmation still pending after activation/)
    assert.match(activateBody, /return \{[\s\S]*activated,[\s\S]*ok: activated && !pendingAfter,[\s\S]*reason: pendingAfter \? 'confirmation-still-pending' : 'activation-dispatched'/)
    assert.match(foregroundUnavailableBody, /foregroundRequired === true/)
    assert.match(foregroundUnavailableBody, /foregroundAvailable === false/)
    const foregroundBody = extractFunction(source, "async function ensureForegroundForConfirmation(confirmationKind = '')")
    assert.match(foregroundBody, /activeQueuedNoForegroundFallback/)
    assert.match(foregroundBody, /foreground-fallback-disabled/)
    assert.match(foregroundBody, /foreground not visible after promotion; retrying/)
    assert.match(foregroundBody, /promoteCurrentQueuedTab\(reason, true\)/)
    assert.match(foregroundBody, /waitForCondition\(\(\) => document\.visibilityState === 'visible', 3500, 100\)/)
    assert.match(activateBody, /activateConfirmationElementInPageWorld\(element, confirmationKind\)/)
    assert.match(pageWorldBody, /action: 'activate-confirmation-in-page-world'/)
    assert.match(pageWorldBody, /confirmationKind/)
    assert.match(beginActionBody, /if\(promotion\?\.promoted !== true\)/)
    assert.match(beginActionBody, /releaseCoordinatorActionLease\(request, sender, `foreground-promotion-failed/)
    assert.match(beginActionBody, /begun: false/)
    assert.match(beginActionBody, /foregroundPromotionFailed: true/)
    assert.match(swActivateBody, /world: 'MAIN'/)
    assert.match(swActivateBody, /kindMatches/)
    assert.match(swActivateBody, /new PointerEvent\('pointerdown'/)
    assert.match(swActivateBody, /new MouseEvent\('click'/)
    assert.match(swSource, /request\.action === 'activate-confirmation-in-page-world'/)
    assert.match(mutePendingBody, /getMuteConfirmAction\(\)/)
    assert.match(unmutePendingBody, /getUnmuteConfirmAction\(\)/)
    assert.match(blockPendingBody, /getBlockConfirmAction\(\)/)
    const mismatchBody = extractFunction(source, "function getConfirmationKindMismatchReason(element, confirmationKind = '')")
    assert.match(mismatchBody, /inverse-unblock-confirmation/)
    assert.match(mismatchBody, /not-block-confirmation/)
    assert.match(mismatchBody, /inverse-unmute-confirmation/)
})

test('space-feed confirmed progress sync does not self-queue storage updates', () => {
    const source = readRepoFile('shared/js/sw.js')
    const confirmBody = extractFunction(source, 'async function confirmSpaceFeedProfilesBlocked(profileHrefs = [])')
    const publicSyncBody = extractFunction(source, 'async function syncCoordinatorProgressForHrefs(profileHrefs = [])')
    const lockedSyncBody = extractFunction(source, 'async function syncCoordinatorProgressForHrefsLocked(profileHrefs = [])')

    assert.match(confirmBody, /syncCoordinatorProgressForHrefsLocked\(confirmedHrefs\)/)
    assert.doesNotMatch(confirmBody, /await syncCoordinatorProgressForHrefs\(confirmedHrefs\)/)
    assert.match(publicSyncBody, /enqueueSpaceFeedStorageUpdate\(\(\) => syncCoordinatorProgressForHrefsLocked\(profileHrefs\)\)/)
    assert.match(lockedSyncBody, /syncCoordinatorProgressRecordsLocked\(records\)/)
    assert.doesNotMatch(lockedSyncBody, /enqueueCoordinatorProgressSync\(records\)/)
})

test('pause cleanup cannot keep mutating after a newer pause generation wins', () => {
    const source = readRepoFile('shared/js/sw.js')
    const pauseBody = extractFunction(source, 'async function pauseCoordinatorNukes()')
    const cleanupBody = extractFunction(source, 'async function pauseCoordinatorNukesCleanup(pauseGeneration = coordinatorPauseGeneration)')
    const stopBody = extractFunction(source, 'async function stopOwnerNukes(ownerTabId, options = {})')
    const closeLoopIndex = cleanupBody.indexOf('for(const tabId of ownedTabIds)')

    assert.match(source, /let coordinatorPauseRequested = false/)
    assert.match(pauseBody, /coordinatorPauseRequested = true/)
    assert.match(pauseBody, /const cleanup = await pauseCoordinatorNukesCleanup\(pauseGeneration\)/)
    assert.doesNotMatch(pauseBody, /void pauseCoordinatorNukesCleanup/)
    assert.match(cleanupBody, /shouldContinueSync: \(\) => isCoordinatorPauseGenerationLocallyCurrent\(pauseGeneration\)/)
    assert.notEqual(closeLoopIndex, -1)
    assert.match(cleanupBody.slice(Math.max(0, closeLoopIndex - 400), closeLoopIndex), /isCoordinatorPauseGenerationLocallyCurrent\(pauseGeneration\)/)
    assert.match(stopBody, /shouldContinueSync = null/)
    assert.match(stopBody, /async function canContinueStop\(\)/)
    assert.ok(stopBody.indexOf('if(!await canContinueStop())') < stopBody.indexOf('pausedQueuedOwners.add(ownerTabId)'))
})

test('profile progress persistence is serialized with coordinator state', () => {
    const source = readRepoFile('shared/js/sw.js')
    const contentSource = readRepoFile('shared/js/content.js')
    const initBody = extractFunction(contentSource, 'async function init()')
    const persistBody = extractFunction(source, 'async function persistProfileNukeProgress()')
    const lockedPersistBody = extractFunction(source, 'async function persistProfileNukeProgressLocked()')
    const recordBody = extractFunction(source, 'async function recordProfileNukeProgress(profileHref, patch = {})')
    const recordLockedBody = extractFunction(source, 'async function recordProfileNukeProgressLocked(profileHref, patch = {})')
    const batchBody = extractFunction(source, 'async function recordProfileNukeProgressBatch(updates = [])')
    const normalizeStorageBody = extractFunction(source, 'async function normalizeProfileNukeProgressStorage(options = {})')
    const loadBody = extractFunction(source, 'async function loadProfileNukeProgress()')

    assert.doesNotMatch(source, /browser\.storage\.local\.set\(\{\[PROFILE_NUKE_PROGRESS_KEY\]/)
    assert.doesNotMatch(initBody, /safeStorageSet\(\{\[PROFILE_NUKE_PROGRESS_KEY\]/)
    assert.match(initBody, /normalize-profile-nuke-progress/)
    assert.match(persistBody, /enqueueSpaceFeedStorageUpdate\(persistProfileNukeProgressLocked\)/)
    assert.match(lockedPersistBody, /saveCoordinatorState\(\{progress: profileNukeProgress\}, \{[\s\S]*progress: true,[\s\S]*reason: 'compatibilityFlush'[\s\S]*\}\)/)
    assert.match(recordBody, /enqueueSpaceFeedStorageUpdate\(\(\) => recordProfileNukeProgressLocked\(profileHref, patch\)\)/)
    assert.match(recordLockedBody, /persistProfileNukeProgressLocked\(\)/)
    assert.match(recordLockedBody, /syncCoordinatorProgressRecordsLocked/)
    assert.match(batchBody, /enqueueSpaceFeedStorageUpdate\(\(\) => recordProfileNukeProgressBatchLocked\(updates\)\)/)
    assert.match(normalizeStorageBody, /enqueueSpaceFeedStorageUpdate/)
    assert.match(normalizeStorageBody, /options\.persist === false/)
    assert.match(normalizeStorageBody, /saveCoordinatorState\(\{progress: lockedProgress\}, \{[\s\S]*progress: true,[\s\S]*reason: 'compatibilityFlush'[\s\S]*\}\)/)
    assert.match(loadBody, /normalizeProfileNukeProgressStorage\(\{persist: false\}\)/)
    assert.doesNotMatch(loadBody, /enqueueStoredCoordinatorQueueProgressSync/)
})

test('space-feed enqueue does not create progress before durable enqueue', () => {
    const body = extractFunction(readRepoFile('shared/js/content.js'), 'async function nukeSpaceFeedEntries(button, entries)')
    const enqueueIndex = body.indexOf('const result = await enqueueCoordinatorSpaceFeedItems(space, runId, workAssociations)')
    const progressIndex = body.indexOf('recordProfileNukeProgressBatch(profileAssociations')

    assert.notEqual(enqueueIndex, -1)
    assert.equal(progressIndex, -1)
})

test('executable coordinator enqueue requests reconcile after durable enqueue', () => {
    const source = readRepoFile('shared/js/sw.js')
    const enqueueBody = extractFunction(source, 'async function enqueueCoordinatorItems(request = {}, sender = {})')
    const finishBody = extractFunction(source, 'async function finishCoordinatorEnqueue(request = {}, sender = {}, enqueueResult = {})')
    const storageTimeoutIndex = finishBody.indexOf('if(enqueueResult?.storageTimedOut === true)')
    const durableGateIndex = finishBody.indexOf('acceptedItems <= 0 || enqueueResult?.durable === false')
    const resetCleanupIndex = finishBody.indexOf('await cancelCoordinatorExecutorsForReset(')
    const executeOptionsIndex = finishBody.indexOf('const executeOptions = request.execute')
    const pausedGateIndex = finishBody.indexOf('if(pausedState?.[COORDINATOR_PAUSED_KEY] === true)')
    const reconcileIndex = finishBody.indexOf("await runCoordinatorReconcileTick('post-enqueue-reconcile'")

    assert.notEqual(storageTimeoutIndex, -1)
    assert.notEqual(durableGateIndex, -1)
    assert.notEqual(resetCleanupIndex, -1)
    assert.notEqual(executeOptionsIndex, -1)
    assert.notEqual(pausedGateIndex, -1)
    assert.notEqual(reconcileIndex, -1)
    assert.ok(storageTimeoutIndex < durableGateIndex)
    assert.ok(durableGateIndex < resetCleanupIndex)
    assert.ok(resetCleanupIndex < executeOptionsIndex)
    assert.ok(storageTimeoutIndex < executeOptionsIndex)
    assert.ok(executeOptionsIndex < pausedGateIndex)
    assert.ok(pausedGateIndex < reconcileIndex)
    assert.doesNotMatch(enqueueBody, /setCoordinatorPauseControlState\(false/)
    assert.doesNotMatch(finishBody, /executorItems\.length \? executorItems : rawItems/)
    assert.doesNotMatch(finishBody, /enqueueExistingExecutorForCoordinator\(executorItems/)
})

test('queued terminal close and stale close denial keep authority in the service worker', () => {
    const source = readRepoFile('shared/js/content.js')
    const closeRequestBody = extractFunction(source, 'async function requestCloseTab(attempts = 3, delayMs = 150, scheduleFollowUps = true)')
    const actionBody = extractFunction(source, 'async function maybeRunAutoProfileAction()')
    const alreadyBlockedBody = extractFunction(source, 'async function maybeRecordAlreadyBlockedCoordinatorProfile()')
    const staleIndex = closeRequestBody.indexOf('if(result?.staleAttempt) return false')
    const windowCloseIndex = closeRequestBody.indexOf('window.close()')
    const terminalDeniedIndex = actionBody.indexOf('Queued terminal success was not recorded; leaving tab open for retry')
    const releaseIndex = actionBody.indexOf('await releaseQueuedTabSlot()', terminalDeniedIndex)
    const repairDeniedIndex = alreadyBlockedBody.indexOf('Already-blocked repair was not recorded; leaving queued tab open for retry')
    const repairReleaseIndex = alreadyBlockedBody.indexOf('await notifyQueuedTabComplete()', repairDeniedIndex)

    assert.notEqual(staleIndex, -1)
    assert.notEqual(windowCloseIndex, -1)
    assert.ok(staleIndex < windowCloseIndex)
    assert.notEqual(terminalDeniedIndex, -1)
    assert.notEqual(releaseIndex, -1)
    assert.ok(terminalDeniedIndex < releaseIndex)
    assert.match(actionBody, /Queued terminal unblock\/unmute success was not recorded/)
    assert.notEqual(repairDeniedIndex, -1)
    assert.notEqual(repairReleaseIndex, -1)
    assert.ok(repairDeniedIndex < repairReleaseIndex)
    assert.match(alreadyBlockedBody, /if\(progress\?\.serviceWorkerOnly && !progress\.runtimeRecorded\)/)
})

test('queued tab lifecycle recovery is durable before refilling slots', () => {
    const source = readRepoFile('shared/js/sw.js')
    const releaseBody = extractFunction(source, 'async function releaseQueuedTab(tabId, options = {})')
    const releaseReconcileBody = extractFunction(source, 'function scheduleQueuedTabReleaseReconcile(reason = \'queued-tab-slot-release\', options = {})')
    const fillBody = extractFunction(source, 'async function fillQueuedTabsOnce(options = {})')
    const createOwnedTabBody = extractFunction(source, 'async function createOwnedTab(action = {})')
    const restoreFocusBody = extractFunction(source, 'async function restoreBackgroundQueuedTabFocus(tab = null, previousActiveTab = null, action = {})')
    const durableIndex = releaseBody.indexOf('await Promise.all(durableWrites')
    const reconcileIndex = releaseBody.indexOf("followUpPromise = scheduleQueuedTabReleaseReconcile('queued-tab-slot-release'")
    const pausedGateIndex = fillBody.indexOf('if(pausedState?.[COORDINATOR_PAUSED_KEY] === true)')
    const createIndex = fillBody.indexOf('tab = await createOwnedTab(next)')
    const openFailureIndex = fillBody.indexOf('openFailureCount')

    assert.notEqual(durableIndex, -1)
    assert.notEqual(reconcileIndex, -1)
    assert.ok(durableIndex < reconcileIndex)
    assert.match(releaseReconcileBody, /scheduleCoordinatorQueueResume/)
    assert.match(releaseBody, /durableWrites\.push\(releaseCoordinatorActionLeaseForTab/)
    assert.match(releaseBody, /durableWrites\.push\(rollbackFailedQueuedTabOpen/)
    assert.notEqual(pausedGateIndex, -1)
    assert.notEqual(createIndex, -1)
    assert.notEqual(openFailureIndex, -1)
    assert.ok(pausedGateIndex < createIndex)
    assert.ok(createIndex < openFailureIndex)
    assert.match(fillBody, /queuedTabActions\.unshift/)
    assert.match(fillBody, /scheduleQueuedWorkContinuation\('queued-tab-open-failed'\)/)
    assert.match(createOwnedTabBody, /getLastFocusedActiveTab\(\)/)
    assert.match(createOwnedTabBody, /restoreBackgroundQueuedTabFocus\(tab, previousActiveTab, action\)/)
    assert.match(restoreFocusBody, /action\?\.noForegroundFallback !== true/)
    assert.match(restoreFocusBody, /browser\.tabs\.update\(previousActiveTab\.id, \{active: true\}\)/)
})

test('stored-work recovery repairs before no-work decisions and uses alarm-backed earliest scheduling', () => {
    const source = readRepoFile('shared/js/sw.js')
    const scheduleBody = extractFunction(source, 'function scheduleStoredWorkRepair(delayMs = STORED_WORK_REPAIR_INTERVAL_MS, options = {})')
    const recoverBody = extractFunction(source, 'async function recoverStoredCoordinatorWorkOnce(reason = \'stored-work-recovery\', options = {})')
    const restoreBody = extractFunction(source, 'async function restoreCoordinatorPageForStoredWorkOnce(options = {})')
    const repairIndex = recoverBody.indexOf('repair = await repairCoordinatorStorageFromProgressBestEffort()')
    const noWorkIndex = recoverBody.indexOf("reason: 'no-stored-work'")

    assert.match(source, /COORDINATOR_STORED_WORK_REPAIR_ALARM_NAME/)
    assert.match(scheduleBody, /storedWorkRepairDueAt <= dueAt/)
    assert.match(scheduleBody, /clearTimeout\(storedWorkRepairTimeout\)/)
    assert.match(scheduleBody, /browser\.alarms\.create\(COORDINATOR_STORED_WORK_REPAIR_ALARM_NAME/)
    assert.notEqual(repairIndex, -1)
    assert.notEqual(noWorkIndex, -1)
    assert.ok(repairIndex < noWorkIndex)
    assert.doesNotMatch(restoreBody, /if\(!hasStoredCoordinatorWork\(queue\)\)/)
    assert.match(restoreBody, /recoverStoredCoordinatorWork\('coordinator-page-restore'/)
})
