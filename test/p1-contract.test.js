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

function listRepoTextFiles(relativeRoots = [], options = {}) {
    const repoRoot = path.join(__dirname, '..')
    const excluded = new Set(options.exclude || [])
    const textExtensions = new Set([
        '.cjs',
        '.css',
        '.html',
        '.js',
        '.json',
        '.md',
        '.txt'
    ])
    const files = []

    function walk(relativePath) {
        if(excluded.has(relativePath)) return
        const absolutePath = path.join(repoRoot, relativePath)
        const stat = fs.statSync(absolutePath)
        if(stat.isDirectory()) {
            for(const entry of fs.readdirSync(absolutePath).sort()) {
                walk(relativePath ? `${relativePath}/${entry}` : entry)
            }
            return
        }
        if(!stat.isFile()) return
        if(!textExtensions.has(path.extname(relativePath))) return
        files.push(relativePath)
    }

    for(const root of relativeRoots) walk(root)
    return files
}

function getRuntimeRequestActionNames(source) {
    return Array.from(source.matchAll(/(?:if|else if)\((?:request\.action|action) === '([^']+)'/g))
        .map(match => match[1])
        .sort()
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

function extractCssRuleBody(source, selector) {
    const start = source.indexOf(`${selector} {`)
    assert.notEqual(start, -1, `missing CSS rule ${selector}`)

    const braceStart = source.indexOf('{', start)
    let depth = 0
    for(let index = braceStart; index < source.length; index += 1) {
        if(source[index] === '{') depth += 1
        else if(source[index] === '}') {
            depth -= 1
            if(depth === 0) return source.slice(braceStart, index + 1)
        }
    }

    throw new Error(`unterminated CSS rule ${selector}`)
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
            if(name === './jobState') return require(path.join(__dirname, '..', 'shared/js/jobState'))
            if(name === './swCoordinatorStatusRules') return require(path.join(__dirname, '..', 'shared/js/swCoordinatorStatusRules'))
            if(name === './timeouts') return require(path.join(__dirname, '..', 'shared/js/timeouts'))
            if(name === './nukedPosts') return require(path.join(__dirname, '..', 'shared/js/nukedPosts'))
            if(name === './defaults') return require(path.join(__dirname, '..', 'shared/js/defaults'))
            if(name === './tunables') return require(path.join(__dirname, '..', 'shared/js/tunables'))
            if(name === './storageKeys') return require(path.join(__dirname, '..', 'shared/js/storageKeys'))
            if(name === './storageNamespace') return require(path.join(__dirname, '..', 'shared/js/storageNamespace'))
            if(name === './muteBlockHelp') return require(path.join(__dirname, '..', 'shared/js/muteBlockHelp'))
            // The dashboard's footer bar is built by this module; the contract tests do not draw it.
            if(name === './queueProgressBar') return {createQueueProgressBar: () => ({bar: {style: {}}, setProgress() {}})}
            throw new Error(`unexpected require: ${name}`)
        },
        addEventListener() {},
        clearInterval() {},
        clearTimeout() {},
        console,
        URL,
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
        },
        // The queue item's subject, as shared/js/profileResolutionSubject.js exports it (30 Oct).
        normalizeResolutionSubject: require('../shared/js/profileResolutionSubject').normalizeResolutionSubject,
        RESOLUTION_SUBJECT_POSTER: 'poster',
        RESOLUTION_SUBJECT_NAMED_PROFILES: 'named-profiles'
    }
    vm.createContext(context)
    vm.runInContext([
        extractFunction(source, "function isSourcePostResolutionReason(reason = '')"),
        extractFunction(source, 'function noteQueuedResolution(sink, source, href)'),
        extractFunction(source, 'function getQueuedPageResolvedProfileHref(claimedAction = {}, sink = null)')
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
    assert.notEqual(queuedBranchStart, -1)

    const queuedBranch = body.slice(queuedBranchStart)

    assert.match(queuedBranch, /record-job-terminal/)
    assert.match(queuedBranch, /record-job-milestone/)
    assert.match(queuedBranch, /profileNukeProgress = pruneProfileNukeProgress/)
    assert.match(queuedBranch, /serviceWorkerOnly: true/)
    assert.match(queuedBranch, /return\s+\{/)
    assert.doesNotMatch(body, /action: 'record-nuke-progress'/)
})

test('legacy record-nuke-progress messages are absent from the service worker', () => {
    const source = readRepoFile('shared/js/sw.js')
    const singleBranchStart = source.indexOf("request.action === 'record-nuke-progress'")
    const batchBranchStart = source.indexOf("request.action === 'record-nuke-progress-batch'")

    assert.equal(singleBranchStart, -1)
    assert.equal(batchBranchStart, -1)
    assert.doesNotMatch(source, /async function recordProfileNukeProgressFromRequest/)
    assert.doesNotMatch(source, /async function recordProfileNukeProgressBatchFromRequest/)
    assert.doesNotMatch(source, /legacy-progress-message-disabled/)
    assert.doesNotMatch(source, /legacyMessageDisabled/)
})

test('forbidden legacy progress and repair surfaces stay out of live source', () => {
    const forbidden = [
        {name: 'full legacy progress blob key', pattern: /mbProfileNukeProgress(?!View|Shard)/},
        {name: 'legacy progress key constant', pattern: /PROFILE_NUKE_PROGRESS_KEY/},
        {name: 'single legacy progress action', pattern: /record-nuke-progress/},
        {name: 'batch legacy progress action', pattern: /record-nuke-progress-batch/},
        {name: 'legacy import option', pattern: /legacyImport|importLegacy/},
        {name: 'legacy repair request action', pattern: /repair-coordinator-storage/},
        {name: 'legacy repair alarm', pattern: /mb-stored-work-repair/},
        {name: 'repair queue operation kind', pattern: /operationKind: 'repair-/},
        {name: 'repair metric path', pattern: /metricPath: 'repair\./},
        {name: 'repair projection metric path', pattern: /projectionMetricPath: 'repair\./},
        {name: 'skip repair option', pattern: /skipRepair/},
        {name: 'projection repair delay option', pattern: /projectionRepairDelayMs/}
    ]
    const files = listRepoTextFiles([
        'shared/js',
        'tools/cdp',
        'test',
        'chrome',
        'firefox'
    ], {
        exclude: ['test/p1-contract.test.js']
    })
    const failures = []

    for(const file of files) {
        // D3: the 1.5 cleanup list names the retired progress blob key on purpose (sw.js VERSION_15_RETIRED_STORAGE_KEYS), and
        // the upgrade-cleanup test seeds that key. Those are the only allowed occurrences; every other mention is still forbidden.
        const source = readRepoFile(file)
            .replace(/const VERSION_15_RETIRED_STORAGE_KEYS = \[[^\]]*\]/, '')
            // The same retired list in the minified build output (chrome/ and firefox/ carry it as a bare array literal).
            // The bundler picks the quote style; accept either, but only for this exact retired list.
            .replace(/\[(["'])mbCoordinatorQueue\1,\1mbProfileNukeProgress\1\]/g, '')
            .replace(/test\('upgrade from 1\.5 removes only the 1\.5 storage residue this worker does not use'[\s\S]*?\n\}\)\n/, '')
        for(const entry of forbidden) {
            const match = source.match(entry.pattern)
            if(match) failures.push(`${file}: ${entry.name}: ${match[0]}`)
        }
    }

    assert.deepEqual(failures, [])
})

test('forbidden legacy storage keys are absent from source text and runtime action names', () => {
    const source = readRepoFile('shared/js/sw.js')
    const content = readRepoFile('shared/js/content.js')
    const coordinator = readRepoFile('shared/js/coordinator.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const runtimeActions = getRuntimeRequestActionNames(bootstrap)

    // D3: the only allowed mention of the 1.5 blob key is the retired-keys declaration that the upgrade cleanup removes.
    assert.doesNotMatch(source.replace(/const VERSION_15_RETIRED_STORAGE_KEYS = \[[^\]]*\]/, ''), /mbProfileNukeProgress(?!View|Shard)/)
    assert.doesNotMatch(source, /PROFILE_NUKE_PROGRESS_KEY/)
    assert.doesNotMatch(content, /mbProfileNukeProgress(?!View|Shard)|PROFILE_NUKE_PROGRESS_KEY/)
    assert.doesNotMatch(coordinator, /mbProfileNukeProgress(?!View|Shard)|PROFILE_NUKE_PROGRESS_KEY/)
    assert.equal(runtimeActions.includes('record-nuke-progress'), false)
    assert.equal(runtimeActions.includes('record-nuke-progress-batch'), false)
    assert.equal(runtimeActions.includes('repair-coordinator-storage'), false)
    assert.equal(runtimeActions.includes('reconcile-coordinator-storage'), true)
})

test('current storage write payloads cannot include the full legacy progress key', () => {
    const source = readRepoFile('shared/js/sw.js')
    const storageSource = readRepoFile('shared/js/swstorage.js')
    const metricStorageSetBody = extractFunction(source, 'async function metricStorageSet(payload = {}, options = {})')
    const storageAdapterSetBody = extractFunction(storageSource, 'function createChromeLocalStorageAdapter(getStorageArea)')
    const storageWriteSource = [
        metricStorageSetBody,
        storageAdapterSetBody
    ].join('\n')

    assert.doesNotMatch(storageWriteSource, /mbProfileNukeProgress(?!View|Shard)/)
    assert.doesNotMatch(storageWriteSource, /PROFILE_NUKE_PROGRESS_KEY/)
    assert.doesNotMatch(storageWriteSource, /\[PROFILE_NUKE_PROGRESS_KEY\]/)
    assert.doesNotMatch(source, /addContentPageStateProjectionPayload/)
    assert.match(metricStorageSetBody, /PROFILE_NUKE_PROGRESS_VIEW_KEY/)
    assert.match(metricStorageSetBody, /PROFILE_NUKE_PROGRESS_SHARD_PREFIX/)
})

test('the dashboard no longer computes outliers: the worker serves the list and the page renders it', () => {
    const source = readRepoFile('shared/js/coordinator.js')
    for(const removed of [
        'function checkCoordinatorOutliers',
        'function getCoordinatorActiveDurationBaseline',
        'function getCoordinatorOutlierRowKey',
        'function fetchFlightRecorderForOutlier',
        'dismissedOutlierKeys',
        'COORDINATOR_OUTLIER_',
        'flightRecorderEntries'
    ]) {
        assert.equal(source.includes(removed), false, `coordinator.js no longer contains ${removed}`)
    }
    const renderBody = extractFunction(source, 'function render()')
    assert.doesNotMatch(renderBody, /checkCoordinatorOutliers/)
    assert.match(renderBody, /renderOutliers\(\)/)
    const refreshBody = extractFunction(source, 'async function refreshCompactDashboardViews()')
    assert.match(refreshBody, /Array\.isArray\(result\?\.outliers\)/)
    const clearOutliersBody = extractFunction(source, 'async function clearOutliers()')
    assert.match(clearOutliersBody, /sendRuntimeMessageWithTimeout\(\{action: 'clear-coordinator-outliers'\}/)
    const clearAllStatsBody = extractFunction(source, 'async function clearAllStats()')
    assert.doesNotMatch(clearAllStatsBody, /clearOutliers\(\)/)
})

test('the dashboard expands an outlier to its recorder events, read from the worker on first expand', () => {
    const source = readRepoFile('shared/js/coordinator.js')
    const itemBody = extractFunction(source, 'function buildOutlierItem(outlier = {})')
    assert.match(itemBody, /setMuteBlockHelp\(toggle, expanded/, 'the expand button has hover help')
    assert.match(itemBody, /toggleOutlierEvents\(outlier\)/, 'the button toggles the outlier events')
    const loadBody = extractFunction(source, 'async function loadOutlierEvents(outlier = {})')
    assert.match(loadBody, /action: 'get-coordinator-outlier-events'/, 'the events are read from the worker')
    const panelBody = extractFunction(source, 'function buildOutlierEventsPanel(outlier = {})')
    assert.match(panelBody, /buildOutlierEventRow/, 'each event is drawn as a flight recorder row, with its gap')
    const swBootstrap = readRepoFile('shared/js/swBootstrap.js')
    assert.match(swBootstrap, /request\.action === 'get-coordinator-outlier-events'/, 'the worker answers the request')
})

test('the flight recorder save names its file in local time, never reuses a name, and its hover help names the folder', () => {
    const evaluate = loadDashboardHarness()
    assert.equal(
        evaluate('buildFlightRecorderFileName(new Date(2026, 9, 26, 14, 5, 33), new Set())'),
        'mute-block-flight-recorder-2026-10-26T14-05-33.json'
    )
    assert.equal(
        evaluate('buildFlightRecorderFileName(new Date(2026, 0, 2, 3, 4, 5), new Set())'),
        'mute-block-flight-recorder-2026-01-02T03-04-05.json'
    )
    const names = JSON.parse(evaluate(`(() => {
        const used = new Set()
        const at = new Date(2026, 9, 26, 14, 5, 33)
        return JSON.stringify([buildFlightRecorderFileName(at, used), buildFlightRecorderFileName(at, used), buildFlightRecorderFileName(at, used)])
    })()`))
    assert.deepEqual(names, [
        'mute-block-flight-recorder-2026-10-26T14-05-33.json',
        'mute-block-flight-recorder-2026-10-26T14-05-33-2.json',
        'mute-block-flight-recorder-2026-10-26T14-05-33-3.json'
    ])
    assert.equal(new Set(names).size, names.length, 'no two saves get the same name')
    for(const name of names) {
        assert.match(name, /^mute-block-flight-recorder-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?\.json$/, name)
        assert.doesNotMatch(name, /[<>:"/\\|?*\u0000-\u001f]/, name)
    }

    const source = readRepoFile('shared/js/coordinator.js')
    const saveBody = extractFunction(source, 'async function saveFlightRecorder()')
    assert.match(saveBody, /link\.download = buildFlightRecorderFileName\(new Date\(\), flightRecorderSaveFileNames\)/)
    assert.doesNotMatch(saveBody, /toISOString/, 'the UTC timestamp name is gone')
    assert.doesNotMatch(saveBody, /downloads\.download/, 'the save stays an anchor download, which needs no downloads permission')

    const pageHtml = readRepoFile('shared/coordinator.html')
    const saveTag = pageHtml.match(/<button\b[^>]*id="saveFlightRecorderButton"[^>]*>/)[0]
    const title = saveTag.match(/\stitle="([^"]*)"/)[1]
    assert.match(title, /^Mute Block extension: /)
    assert.match(title, /browser's download folder \(usually Downloads\)/, 'the hover help names the folder honestly')
    assert.match(title, /mute-block-flight-recorder-YYYY-MM-DDTHH-MM-SS\.json/, 'the hover help names the file')
    assert.match(title, /If the browser is set to ask where to save, it asks first\./, 'the hover help says when the browser may ask')
})

test('outlier events show the gap from the previous event, and highlight gaps above the tunable threshold', () => {
    const evaluate = loadDashboardHarness()
    const tunables = require(path.join(__dirname, '..', 'shared/js/tunables'))
    assert.equal(tunables.OUTLIER_EVENT_GAP_ABNORMAL_MS, 500, 'the threshold lives in tunables.js')

    const events = [{at: 1000}, {at: 1100}, {at: 1700}, {at: 1701}, {at: 3000}, {at: 3500}]
    const gaps = JSON.parse(evaluate(`JSON.stringify(getOutlierEventGaps(${JSON.stringify(events)}))`))
    assert.deepEqual(gaps, [
        {gapMs: null, abnormal: false},
        {gapMs: 100, abnormal: false},
        {gapMs: 600, abnormal: true},
        {gapMs: 1, abnormal: false},
        {gapMs: 1299, abnormal: true},
        {gapMs: 500, abnormal: false}
    ], 'a gap of exactly the threshold is not abnormal')

    const labels = JSON.parse(evaluate('JSON.stringify([formatOutlierEventGap(null), formatOutlierEventGap(12), formatOutlierEventGap(1299), formatOutlierEventGap(2500)])'))
    assert.deepEqual(labels, ['—', '+12 ms', '+1.30 s', '+2.50 s'])

    const source = readRepoFile('shared/js/coordinator.js')
    const gapBody = extractFunction(source, 'function getOutlierEventGaps(events = [])')
    assert.doesNotMatch(gapBody, /\.sort\(/, 'the gaps follow the order the list shows')
    assert.doesNotMatch(gapBody, /\b500\b/, 'the threshold is not a literal in the code')
    const panelBody = extractFunction(source, 'function buildOutlierEventsPanel(outlier = {})')
    assert.doesNotMatch(panelBody, /\.sort\(/)
    assert.match(panelBody, /getOutlierEventGaps\(events\)/)
    const rowBody = extractFunction(source, 'function buildOutlierEventRow(entry, gap = {gapMs: null, abnormal: false})')
    assert.match(rowBody, /row\.classList\.add\('row--event-gap-abnormal'\)/)
    assert.match(rowBody, /row\.title = muteBlockHelpText\(`Highlighted:[^`]*\$\{OUTLIER_EVENT_GAP_ABNORMAL_MS\} ms/, 'the highlight explains itself on hover')

    const css = readRepoFile('shared/css/coordinator.css')
    const highlightBody = extractCssRuleBody(css, '.outlier-events .row--event-gap-abnormal')
    assert.match(highlightBody, /var\(--mb-amber-50\)/)
    assert.doesNotMatch(highlightBody, /#[0-9a-fA-F]{3,8}\b/, 'the highlight uses color tokens, not hex literals')
})

test('runtime action contract enumerates current accepted actions and rejects old aliases', () => {
    const source = readRepoFile('shared/js/swBootstrap.js')
    const runtimeActions = getRuntimeRequestActionNames(source)
    const expectedActions = [
        'activate-confirmation-in-page-world',
        'begin-profile-action',
        'cancel-coordinator-current-work',
        'cancel-coordinator-current-work-item',
        'cancel-queued-owner-nukes',
        'claim-debug-run-autosave',
        'claim-tab-action',
        'cleanup-owned-nuke-status',
        'clear-completed-history',
        'clear-coordinator-current-work',
        'clear-coordinator-events',
        'clear-coordinator-outliers',
        'clear-coordinator-terminal-stats',
        'clear-profile-nuke-state',
        'close-tab',
        'cloudflare-challenge-detected',
        'content-claim-retry-hit',
        'content-live-check',
        'coordinator-page-ready',
        'create-tab',
        'enqueue-coordinator-items',
        'erase-block-history',
        'get-content-page-coordinator-state',
        'get-coordinator-outlier-events',
        'get-coordinator-queue-accounting',
        'get-coordinator-queue-runtime-state',
        'get-flight-recorder',
        'get-debug-resume-limit-status',
        'get-coordinator-why-not-running',
        'get-owned-nuke-status',
        'get-recent-history',
        'heartbeat-action-lease',
        'open-coordinator',
        'open-coordinator-history',
        'pause-coordinator-nukes',
        'pause-owner-nukes',
        'promote-queued-tab',
        'reconcile-coordinator-storage',
        'record-direct-profile-progress',
        'record-manual-profile-action',
        'record-initial-blocked-state',
        'record-page-event',
        'record-job-milestone',
        'record-job-terminal',
        'refresh-coordinator-dashboard-views',
        'refresh-coordinator-queue-view',
        'refresh-coordinator-runs-view',
        'refresh-queue-wakeup-metrics-view',
        'register-queued-worker-action-surface',
        'release-action-lease',
        'release-job-tab',
        'remove-coordinator-failed-work-item',
        'request-action-lease',
        'reset-queue-wakeup-metrics',
        'resolve-queued-profile-target',
        'resolve-queued-profile-target-failed',
        'resume-coordinator-queue',
        'resume-paused-coordinator-nukes',
        'retry-coordinator-failed',
        'set-coordinator-retry-failed-enabled',
        'set-dev-mode-enabled',
        'set-extension-settings',
        'set-hidden-run-ids',
        'set-space-record',
        'set-space-sort',
        'settle-terminal-coordinator-items',
        'sweep-owned-blocked-profile-tabs',
        'sweep-service-worker-blocked-profile-tabs'
    ].sort()
    const forbiddenActions = [
        'record-nuke-progress',
        'record-nuke-progress-batch',
        'repair-coordinator-storage',
        'requeue-coordinator-failed'
    ]

    assert.deepEqual(runtimeActions, expectedActions)
    for(const action of forbiddenActions) {
        assert.equal(runtimeActions.includes(action), false, `${action} must stay deleted`)
    }
})

test('content script exposes queued profile action surface state for safe adoption', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'function onMessage(request, sender, sendResponse)')
    const branchStart = body.indexOf("request.action === 'get-profile-action-surface-state'")
    const branchEnd = body.indexOf('switch(request.status)', branchStart)

    assert.notEqual(branchStart, -1)
    assert.notEqual(branchEnd, -1)

    const branch = body.slice(branchStart, branchEnd)
    assert.match(branch, /normalizeQuoraProfileHref\(request\?\.requestedProfileHref \|\| ''\)/)
    assert.match(branch, /getProfileKey\(location\.href\)/)
    assert.match(branch, /getBlockConfirmAction\(\)[\s\S]*\? 'block'/)
    assert.match(branch, /getMuteConfirmAction\(\)[\s\S]*\? 'mute'/)
    assert.match(branch, /getUnblockConfirmAction\(\)[\s\S]*\? 'unblock'/)
    assert.match(branch, /getUnmuteConfirmAction\(\)[\s\S]*\? 'unmute'/)
    assert.match(branch, /profileMatches: !!requestedProfileHref && !!resolvedProfileHref && requestedProfileHref === resolvedProfileHref/)
    assert.match(branch, /pendingProfileConfirmation: !!confirmationKind/)
    assert.match(branch, /profileActionInProgress/)
})

test('dashboard initial load always asks the service worker for a fresh compact queue view', () => {
    // 2026-09-25: loadState() used to trust storage.mbCoordinatorQueueView
    // as-is whenever it was present and validly shaped, only falling back to
    // a service-worker rebuild when that storage read came back empty or
    // malformed. Nothing re-filters a persisted view against the current
    // set of known runs until a rebuild actually runs, so a stale copy (one
    // still mixing in terminal rows from runs that no longer exist) could
    // sit in storage indefinitely and just keep getting re-read on every
    // periodic dashboard poll. loadState() now always calls
    // refreshCompactDashboardViews() unconditionally instead of branching on
    // whatever's currently in storage.
    const body = extractFunction(
        readRepoFile('shared/js/coordinator.js'),
        'async function loadState()'
    )
    const firstGet = body.slice(
        body.indexOf('const stored = await browser.storage.local.get'),
        body.indexOf('await refreshCompactDashboardViews()')
    )

    assert.doesNotMatch(firstGet, /COORDINATOR_QUEUE_VIEW_KEY/)
    assert.doesNotMatch(firstGet, /COORDINATOR_QUEUE_KEY/)
    assert.doesNotMatch(body, /if\(hasCoordinatorQueueView/)
    assert.match(body, /const refreshed = await refreshCompactDashboardViews\(\)/)
    assert.match(body, /if\(!refreshed\.runsRefreshed\)/)
    assert.doesNotMatch(body, /browser\.storage\.local\.get\(\{\[COORDINATOR_QUEUE_KEY\]/)
})

test('dashboard compact refresh polling skips ticks while the queue is paused or has nothing pending', () => {
    // 2026-09-27: this timer used to fire unconditionally every
    // DASHBOARD_COMPACT_REFRESH_INTERVAL_MS (2s) for as long as the
    // dashboard tab stayed open. Confirmed live via the flight recorder:
    // with the queue paused for hours and the dashboard left open, this
    // alone produced thousands of no-op service-worker round-trips,
    // each inflating storageUpdate.noDurableWork (the "No-work writes"
    // card) for reasons unrelated to the queue actually stalling. A real
    // change (resume, new work enqueued, pause toggled elsewhere) still
    // reaches this dashboard via installDashboardRuntimeRefreshListener's
    // push, independent of this timer, so skipping ticks here while
    // nothing could possibly have changed is safe.
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const pollBody = extractFunction(dashboard, 'function installCompactStorageRefreshPolling()')
    const idleBody = extractFunction(dashboard, 'function isDashboardQueueDefinitelyIdle()')

    assert.match(pollBody, /if\(isDashboardQueueDefinitelyIdle\(\)\) return/)
    assert.match(idleBody, /if\(state\.paused\) return true/)
    assert.match(idleBody, /PENDING_QUEUE_VIEW_STATUSES\.some/)
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
    // loadState() no longer reads mbCoordinatorQueueView directly -- see
    // "dashboard initial load always asks the service worker for a fresh
    // compact queue view" -- it goes through refreshCompactDashboardViews()
    // unconditionally instead.
    assert.doesNotMatch(loadBody, /\[COORDINATOR_QUEUE_VIEW_KEY\]: \{\}/)
    assert.match(loadBody, /\[QUEUE_WAKEUP_METRICS_VIEW_KEY\]: \{\}/)
})

test('missing dashboard queue view is regenerated by service worker', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const refreshBody = extractFunction(dashboard, 'async function refreshCompactDashboardViews()')
    const sw = readRepoFile('shared/js/sw.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const loaderBody = extractFunction(sw, "async function loadCoordinatorDashboardAuthoritySnapshot(metricLabel = 'dashboard')")
    const queueViewBuilderBody = extractFunction(sw, 'function buildCoordinatorQueueViewFromDashboardSnapshot(snapshot)')

    assert.match(refreshBody, /action: 'refresh-coordinator-dashboard-views'/)
    assert.match(refreshBody, /applyCoordinatorQueueView\(result\.view\)/)
    assert.doesNotMatch(refreshBody, /COORDINATOR_QUEUE_KEY/)
    // One resident read feeds both queue and completed history (P2). The loader replays nothing and reads no storage (P3).
    assert.match(loaderBody, /getResidentCompletedForReads\(\)/)
    assert.match(loaderBody, /buildCoordinatorDashboardAuthoritySnapshotFromResident\(/)
    assert.doesNotMatch(loaderBody, /loadCoordinatorQueueWalProjection\(/)
    assert.doesNotMatch(loaderBody, /recoverProjectedState\(/)
    assert.doesNotMatch(loaderBody, /getRecentCompletedWorkRows\(/)
    assert.match(queueViewBuilderBody, /buildCoordinatorQueueView\(queue, Date\.now\(\), \{runs: snapshot\.runs, statsClearedAt: coordinatorStatsClearedAtResident\}\)/)
    assert.match(bootstrap, /request\.action === 'refresh-coordinator-dashboard-views'/)
})

test('dashboard refresh reads authority once and derives both views from that snapshot', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const combinedBody = extractFunction(sw, "async function refreshCoordinatorDashboardViewsForDashboard(reason = 'dashboard-refresh')")
    const readerBody = extractFunction(sw, "async function readDashboardSnapshotOrUnavailable(reason = '', metricLabel = 'dashboard')")
    const loaderCalls = combinedBody.match(/readDashboardSnapshotOrUnavailable\(/g) || []

    assert.equal(loaderCalls.length, 1)
    assert.equal((readerBody.match(/getResidentCompletedForReads\(\)/g) || []).length, 1)
    assert.equal((readerBody.match(/buildCoordinatorDashboardAuthoritySnapshotFromResident\(/g) || []).length, 1)
    assert.doesNotMatch(readerBody, /loadCoordinatorDashboardAuthoritySnapshot\(/)
    assert.match(combinedBody, /buildCoordinatorQueueViewFromDashboardSnapshot\(snapshot\)/)
    assert.match(combinedBody, /buildCoordinatorRunsSummaryFromDashboardSnapshot\(snapshot\)/)
})

test('raw queue snapshot saves are rejected without a physical write branch', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function saveCoordinatorState(state = {}, changes = {})'
    )

    assert.match(body, /if\(changes\.queue\) \{[\s\S]*coordinatorAuthority\.rawQueueSnapshotSaveRejected[\s\S]*return false[\s\S]*\}/)
    assert.match(body, /coordinatorAuthority\.rawQueueSnapshotSaveRejected/)
    assert.doesNotMatch(body, /allowRawQueueSnapshotWrite/)
    assert.doesNotMatch(body, /payload\[COORDINATOR_QUEUE_KEY\]\s*=\s*queue/)
    assert.doesNotMatch(body, /buildCoordinatorQueueView\(queue\)/)
})

test('resident authority is updated only by the door: no snapshot observer, absorb, or refresh', () => {
    // No writes happen outside the worker, so nothing absorbs a stored snapshot into the resident authority. Each resident
    // update is the door's own, made after its write is acknowledged. Comment lines are not code, so they are not matched.
    const codeOf = text => text.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')
    const source = codeOf(readRepoFile('shared/js/sw.js'))
    const storageMetrics = codeOf(readRepoFile('shared/js/swStorageMetrics.js'))

    assert.doesNotMatch(source, /absorbPersistedSnapshot|coordinatorAuthoritySnapshotObserver|refreshResidentCoordinatorAuthorityState|notifyCoordinatorAuthorityPersistedSnapshot/)
    assert.doesNotMatch(storageMetrics, /notifyCoordinatorAuthorityPersistedSnapshot|getSnapshotObserver|rawQueueSnapshotObserverIgnored/)
    // The raw legacy queue key is refused by metricStorageSet on every write (no seed or stale snapshot can reach the queue through it).
    const setBody = extractFunction(readRepoFile('shared/js/sw.js'), 'async function metricStorageSet(payload = {}, options = {})')
    assert.match(setBody, /hasOwnProperty\.call\(payload, COORDINATOR_QUEUE_KEY\)/)
    assert.match(setBody, /rawQueueKeyStorageSetRejected/)
    assert.doesNotMatch(setBody, /postMutationQueueStorageSetRejected/)
})

test('service worker pushes compact dashboard refresh after compact state writes', () => {
    const source = readRepoFile('shared/js/sw.js')
    const setBody = extractFunction(source, 'async function metricStorageSet(payload = {}, options = {})')
    const notifyBody = extractFunction(readRepoFile('shared/js/swCoordinatorReconcileSupportSingles.js'), 'function notifyCoordinatorDashboardStateChanged(keys = [], reason = \'\', payload = {})')

    assert.match(source, /COORDINATOR_DASHBOARD_STATE_KEYS/)
    assert.match(setBody, /notifyCoordinatorDashboardStateChanged\(keys, pathName, payload\)/)
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
    const storageMetrics = readRepoFile('shared/js/swStorageMetrics.js')
    const getBody = extractFunction(source, 'async function metricStorageGet(defaults = {}, options = {})')
    const setBody = extractFunction(source, 'async function metricStorageSet(payload = {}, options = {})')
    const saveBody = extractFunction(source, 'async function saveCoordinatorState(state = {}, changes = {})')

    assert.match(storageMetrics, /function getStorageMetricPathName/)
    assert.match(storageMetrics, /function recordStoragePathPayloadMetrics/)
    assert.match(storageMetrics, /function recordStoragePathLatencyMetrics/)
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
    assert.notEqual(queuedBranchStart, -1)
    const queuedBranch = recordBody.slice(queuedBranchStart)

    assert.match(recordBody, /mapped\.terminal/)
    assert.match(queuedBranch, /record-job-terminal/)
    assert.doesNotMatch(recordBody, /action: 'record-nuke-progress'/)
    assert.doesNotMatch(source, /persistTerminalProfileProgressFallback/)
    assert.doesNotMatch(queuedBranch, /safeStorageSet/)
    assert.doesNotMatch(queuedBranch, /PROFILE_NUKE_PROGRESS_KEY/)
})

test('duplicate terminal progress preflights resident terminal authority', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})'
    )

    assert.match(body, /if\(options\.expectTerminal === true\) \{[\s\S]*getHydratedCoordinatorAuthorityState\('terminalProgress\.duplicatePreflight\.usedResidentAuthority'\)/)
    assert.match(body, /isRedundantTerminalProgressForCoordinatorItem\(item, record, mapped\)/)
    assert.match(body, /incrementQueueWakeupMetric\('terminalProgress\.queueNoopDuplicatePreflight'\)/)
    assert.match(body, /duplicateTerminalPreflight: true/)
    assert.ok(body.indexOf("getHydratedCoordinatorAuthorityState('terminalProgress.duplicatePreflight.usedResidentAuthority')") < body.indexOf('const updateResult = await enqueueSpaceFeedStorageUpdate'))
})

test('content terminal mapping delegates to shared job state reducer', () => {
    const source = readRepoFile('shared/js/content.js')
    const mapperBody = extractFunction(source, 'function mapProfileProgressToCoordinatorState(record = {})')

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
    const consumePendingIndex = body.indexOf('consumePendingCoordinatorJobMilestone')
    const terminalIndex = body.indexOf('recordCoordinatorJobProgress')

    assert.notEqual(nonterminalIndex, -1)
    assert.notEqual(consumePendingIndex, -1)
    assert.notEqual(terminalIndex, -1)
    assert.ok(nonterminalIndex < consumePendingIndex)
    assert.ok(consumePendingIndex < terminalIndex)
    assert.match(body, /normalizeProgressPatch\(targetProfileHref, patch, pendingMilestone\)/)
    assert.match(body, /if\(options\.expectTerminal !== true\)/)
})

test('deferred queued milestones coalesce and flush after acknowledgement', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function recordDeferredCoordinatorJobMilestone(profileHref = \'\', patch = {}, options = {})'
    )
    const source = readRepoFile('shared/js/sw.js')

    assert.match(source, /COORDINATOR_JOB_MILESTONE_FLUSH_MS/)
    assert.match(source, /coordinatorJobMilestonePendingRecords/)
    assert.match(body, /coordinatorJobMilestonePendingRecords\[normalizedHref\] = record/)
    assert.match(body, /if\(!options\.senderTabId\) \{[\s\S]*const durable = await flushCoordinatorJobMilestones\(\)/)
    assert.match(body, /scheduleCoordinatorJobMilestoneFlush\(\)/)
    assert.match(body, /recorded: true/)
    assert.match(body, /durable: false/)
    assert.match(body, /reason: 'milestone-flush-deferred'/)
    assert.match(body, /profileNukeProgress = pruneProfileNukeProgress/)
    assert.ok(body.indexOf('scheduleCoordinatorJobMilestoneFlush()') > body.indexOf('if(!options.senderTabId)'))
    assert.ok(body.indexOf("reason: 'milestone-flush-deferred'") > body.indexOf('scheduleCoordinatorJobMilestoneFlush()'))
    assert.doesNotMatch(body, /recordCoordinatorJobProgress\(/)
    assert.doesNotMatch(body, /saveCoordinatorState/)
    assert.doesNotMatch(body, /ensureProfileNukeProgressReady\(\)/)
    assert.doesNotMatch(body, /mergeStoredProfileProgressRecord\(/)
})

test('current terminal/direct progress ignores the full legacy progress blob', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})')
    const rowEventBody = extractFunction(source, 'async function applyCoordinatorRowEvents(events = [], options = {})')

    assert.match(body, /progress\[normalizedHref\] \|\| null/)
    assert.doesNotMatch(body, /ensureProfileNukeProgressReady\(\)/)
    assert.doesNotMatch(body, /profileNukeProgress\?\.\[normalizedHref\]/)
    assert.doesNotMatch(body, /mergeStoredProfileProgressRecord\(/)
    assert.match(rowEventBody, /coordinatorQueueReader\.runsScopedProgressForMutation\(\{[\s\S]*metricPath: `\$\{metricPath\}\.load`/)
    assert.match(rowEventBody, /residentMetricPath: `\$\{metricPath\}\.usedResidentAuthority`/)
    assert.match(rowEventBody, /profileHrefs: normalizedEvents\.map\(event => event\.profileHref\)/)
    assert.match(rowEventBody, /const progress = \{\.\.\.\(state\.progress \|\| \{\}\)\}/)
    assert.match(rowEventBody, /const previous = progress\[normalizedHref\] \|\| null/)
    assert.doesNotMatch(rowEventBody, /ensureProfileNukeProgressReady\(\)/)
    assert.doesNotMatch(rowEventBody, /profileNukeProgress\?\.\[normalizedHref\]/)
    assert.doesNotMatch(rowEventBody, /mergeStoredProfileProgressRecord\(/)
})

test('late tab-opening breadcrumbs cannot erase same-attempt action progress', () => {
    // mergeStoredProfileProgressRecord, normalizeProgressPatch,
    // preserveAdvancedProfileProgress, getProfileProgressStatusRank, and
    // profileProgressAttemptsMatch moved to swProfileProgressMerge.js in
    // decomposition Slice 30.
    const source = readRepoFile('shared/js/swProfileProgressMerge.js')
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
    // shouldPreserveTerminalProfileProgress moved to swProfileProgressMerge.js
    // in decomposition Slice 30.
    const body = extractFunction(
        readRepoFile('shared/js/swProfileProgressMerge.js'),
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
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    // D4: the tabs.onUpdated handler body is now a named function (the listener only gates and dispatches to it).
    const tabUpdatedBody = extractFunction(bootstrap, 'function handleTabUpdated(')

    // progressPatchHasExplicitStatus/shouldApplyExplicitProgressStatusToCoordinatorItem
    // moved to swCoordinatorProgressRules.js in decomposition Slice 12.
    const progressRulesSource = readRepoFile('shared/js/swCoordinatorProgressRules.js')
    assert.match(progressRulesSource, /function progressPatchHasExplicitStatus\(patch = \{\}\)/)
    assert.match(progressRulesSource, /function shouldApplyExplicitProgressStatusToCoordinatorItem\(item = \{\}, patch = \{\}, options = \{\}\)/)
    assert.match(body, /const patchHasStatus = progressPatchHasExplicitStatus\(patch\)/)
    assert.match(body, /const patchCanTransitionStatus = item/)
    assert.match(body, /patchCanTransitionStatus \|\| preferSuccessfulTerminal/)
    assert.match(tabUpdatedBody, /recordCoordinatorJobProgressViaQueueMachine\(metadata\.profileHref, \{\s*lastUrl,/)
    assert.doesNotMatch(tabUpdatedBody, /status: 'queued'/)
})

test('stale tab close cannot fail a requeued Current Work row', () => {
    // shouldApplyExplicitProgressStatusToCoordinatorItem moved to
    // swCoordinatorProgressRules.js in decomposition Slice 12.
    const guardBody = extractFunction(
        readRepoFile('shared/js/swCoordinatorProgressRules.js'),
        'function shouldApplyExplicitProgressStatusToCoordinatorItem(item = {}, patch = {}, options = {})'
    )

    assert.match(guardBody, /status === 'interrupted'/)
    assert.match(guardBody, /senderTabId/)
    assert.match(guardBody, /itemTabId/)
    assert.match(guardBody, /isActiveCoordinatorStatus\(item\?\.status \|\| ''\) && itemTabId === senderTabId/)
})

test('reconcile preserves expected live tabs for resume adoption', () => {
    // shouldReconcileMissingActiveCoordinatorTab moved to
    // swQueuedTabRetryStaleReconcile.js in decomposition Slice 35.
    const body = extractFunction(
        readRepoFile('shared/js/swQueuedTabRetryStaleReconcile.js'),
        'function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = \'\', liveProfileTabsByHref = new Map(), now = getNow())'
    )
    const runtimeActorBody = extractFunction(
        readRepoFile('shared/js/swActiveQueuedTabStaleness.js'),
        'function hasConfirmedRuntimeActorForCoordinatorItem(item = null, record = null)'
    )
    const releaseDeferBody = extractFunction(
        readRepoFile('shared/js/swQueuedTabRuntimeStatus.js'),
        'function shouldDeferQueuedTabReleaseRollback(metadata = null, now = getNow())'
    )

    assert.match(body, /getOwnedOrExpectedLiveTabsForProfileHref/)
    assert.match(body, /getOwnedOrExpectedLiveTabsForProfileHref\(item, record, href, liveProfileTabsByHref\)\.length\) return false/)
    assert.match(body, /hasConfirmedRuntimeActorForCoordinatorItem\(item, record\)/)
    assert.match(runtimeActorBody, /isDurablyActiveQueuedTab\(tabId\)/)
    assert.match(runtimeActorBody, /getAttemptIdFromValue\(item\) \|\| getAttemptIdFromValue\(record\)/)
    assert.match(runtimeActorBody, /metadataAttemptId !== expectedAttemptId/)
    assert.match(releaseDeferBody, /isFreshQueuedTabRuntimeStartup\(metadata, now\)/)
    assert.match(releaseDeferBody, /metadata\?\.durableActiveAt/)
    assert.match(releaseDeferBody, /contentScriptEnsureStartedAt/)
    assert.match(releaseDeferBody, /contentScriptEnsureFailedAt/)
    assert.match(releaseDeferBody, /lastNudgeFailedAt/)
    assert.match(releaseDeferBody, /STALE_BACKGROUND_OPENING_QUEUED_TAB_MS/)
    assert.match(releaseDeferBody, /storageUpdateState\.getDepth\(\) > 0/)
})

test('active queued action phase uses its own wall clock cap', () => {
    const source = readRepoFile('shared/js/sw.js')
    const activeQueuedTabStalenessSource = readRepoFile('shared/js/swActiveQueuedTabStaleness.js')
    const helper = extractFunction(
        activeQueuedTabStalenessSource,
        'function hasActiveQueuedTabActionPhaseProgress(record = null, metadata = null)'
    )
    const sweep = extractFunction(
        source,
        'async function sweepStaleQueuedTabs(parentTabId = null, options = {})'
    )
    const staleTimeout = extractFunction(
        activeQueuedTabStalenessSource,
        'function getActiveQueuedTabStaleTimeoutMs(record, metadata = null)'
    )
    const staleAnchor = extractFunction(
        activeQueuedTabStalenessSource,
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

test('legacy progress mirror sync bridge is deleted', () => {
    const source = readRepoFile('shared/js/sw.js')
    const releaseBody = extractFunction(source, 'async function releaseQueuedTab(tabId, options = {})')

    assert.doesNotMatch(source, /async function syncCoordinatorProgressRecordsLocked/)
    assert.doesNotMatch(source, /function syncCoordinatorProgressRecords/)
    assert.doesNotMatch(source, /enqueueCoordinatorProgressSync/)
    assert.doesNotMatch(source, /enqueueStoredCoordinatorQueueProgressSync/)
    assert.doesNotMatch(source, /compatibility-progress-sync/)
    assert.doesNotMatch(releaseBody, /syncCoordinatorProgressRecords/)
})

test('stale active reconcile ignores queued mirror records as liveness', () => {
    const body = extractFunction(
        readRepoFile('shared/js/swQueuedTabRetryStaleReconcile.js'),
        'function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = \'\', liveProfileTabsByHref = new Map(), now = getNow())'
    )

    assert.match(body, /recordStatus !== 'queued'/)
    assert.match(body, /const staleRecord = recordIsActiveEvidence \? record : null/)
})

test('stale active reconcile does not let timed out tab lookup wedge actorless rows', () => {
    const source = readRepoFile('shared/js/sw.js')
    const queuedTabRuntimeStatusSource = readRepoFile('shared/js/swQueuedTabRuntimeStatus.js')
    const timeoutHelperBody = extractFunction(
        queuedTabRuntimeStatusSource,
        'function shouldTreatTimedOutPersistedTabLookupAsMissingForStaleActive(item = null, record = null, status = null, now = getNow())'
    )
    const tabStatusBody = extractFunction(
        readRepoFile('shared/js/swQueuedExecutorTabStatus.js'),
        'async function getQueuedExecutorTabStatusWithTimeout(tabId = null, reason = \'queued-executor-tab-get\')'
    )
    const deferHelperBody = extractFunction(
        queuedTabRuntimeStatusSource,
        'function shouldDeferActiveWithoutActorReconcileForPersistedTabStatus(status = null, item = null, record = null, now = getNow())'
    )
    const expiredJobBody = extractFunction(
        queuedTabRuntimeStatusSource,
        'function isActorlessActiveCoordinatorJobExpired(item = null, record = null, now = getNow())'
    )
    const releaseLeaseBody = extractFunction(
        source,
        'async function releaseMissingActionLeaseForActiveCoordinatorItem(itemKey = \'\', expectedItem = null, reason = \'reconcile-action-lease-missing-tab\', options = {})'
    )
    const reconcileBody = extractFunction(source, 'async function runCoordinatorAuthorityReconcileActions(reason = \'coordinator-authority-reconcile\', options = {})')
    const activeWithoutActorBody = extractFunction(
        source,
        'async function mutateCoordinatorActiveWithoutRuntimeActorReconcile(operation = {})'
    )

    assert.match(timeoutHelperBody, /status\?\.timedOut/)
    assert.match(timeoutHelperBody, /isActiveCoordinatorStatus\(item\.status\)/)
    assert.match(timeoutHelperBody, /hasConfirmedRuntimeActorForCoordinatorItem\(item, record\)/)
    assert.match(timeoutHelperBody, /getPersistedQueuedTabId\(item, record\)/)
    assert.match(timeoutHelperBody, /isActorlessActiveCoordinatorJobExpired\(item, record, now\)/)
    assert.match(timeoutHelperBody, /isDurableActiveCoordinatorReclaimStale\(item, record, now\)/)
    assert.match(tabStatusBody, /const queryResult = await getQueuedExecutorTabStatusFromTabList\(normalizedTabId, reason\)/)
    assert.doesNotMatch(tabStatusBody, /active-transition-post-confirm\|stale-queued-tab-sweep\|missing-queued-tab-prune\|resume-live-queued-tab/)
    assert.match(expiredJobBody, /hasConfirmedRuntimeActorForCoordinatorItem\(item, record\)/)
    assert.match(expiredJobBody, /activeStartedAt > 0 && now - activeStartedAt >= activeJobMaxMs/)
    assert.match(deferHelperBody, /shouldTreatTimedOutPersistedTabLookupAsMissingForStaleActive\(item, record, status, now\)/)
    assert.match(deferHelperBody, /reconcile\.persistedTabLookupTimeoutTreatedMissing/)
    assert.match(releaseLeaseBody, /const expectedRecord = options\.expectedRecord \|\| null/)
    assert.match(releaseLeaseBody, /shouldDeferActiveWithoutActorReconcileForPersistedTabStatus\(leaseTabStatus, expectedItem, expectedRecord\)/)
    assert.match(reconcileBody, /expectedRecord: record/)
    assert.match(activeWithoutActorBody, /shouldDeferActiveWithoutActorReconcileForPersistedTabStatus\(persistedTabStatus, current, currentRecord\)/)
    assert.match(activeWithoutActorBody, /getLiveProfileTabsByHref\(\)/)
    assert.match(activeWithoutActorBody, /getOwnedOrExpectedLiveTabsForProfileHref\(current, currentRecord, href, liveProfileTabsByHref\)/)
    assert.match(activeWithoutActorBody, /shouldDeferActiveWithoutActorReconcileForPersistedTabStatus\(persistedTabStatus, current, currentRecord\)[\s\S]*hasExpectedLiveProfileTabs/)
    assert.match(activeWithoutActorBody, /await coordinatorQueueReader\.runs\(\{[\s\S]*metricPath: 'reconcile\.activeWithoutActor\.load'/)
    assert.match(activeWithoutActorBody, /operation\.currentAuthorityState\?\.queue[\s\S]*operation\.currentAuthorityState\?\.runs/)
    assert.match(activeWithoutActorBody, /queue: normalizeCoordinatorMap\(cloneCoordinatorAuthorityValue\(operation\.currentAuthorityState\.queue \|\| \{\}\)\)/)
    assert.match(activeWithoutActorBody, /runs: normalizeCoordinatorMap\(cloneCoordinatorAuthorityValue\(operation\.currentAuthorityState\.runs \|\| \{\}\)\)/)
    assert.match(activeWithoutActorBody, /incrementQueueWakeupMetric\('reconcile\.activeWithoutActor\.usedResidentAuthority'\)/)
    assert.match(activeWithoutActorBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*currentAuthorityState,/)
    const activeWithoutActorOuterBody = extractFunction(
        source,
        'async function requeueDurableActiveCoordinatorItemWithoutActor(itemKey = \'\', expectedItem = null, expectedRecord = null, reason = \'reconcile-active-without-actor\', options = {})'
    )
    assert.match(activeWithoutActorOuterBody, /getLiveProfileTabsByHref\(\)/)
    assert.match(activeWithoutActorOuterBody, /getOwnedOrExpectedLiveTabsForProfileHref\(expectedItem, expectedRecord, href, liveProfileTabsByHref\)/)
    assert.match(activeWithoutActorOuterBody, /shouldDeferActiveWithoutActorReconcileForPersistedTabStatus\(expectedPersistedTabStatus, expectedItem, expectedRecord\)[\s\S]*hasExpectedLiveProfileTabs/)
})

test('active missing tab consumes same-attempt terminal progress before requeue', () => {
    const source = readRepoFile('shared/js/sw.js')
    const executorBody = extractFunction(source, 'async function runCoordinatorExecutorApplyPhase(reason = \'coordinator-executor-apply\', options = {})')
    const branchIndex = executorBody.indexOf('const activeMissingTabRecord = latestRecord')
    const branchBody = executorBody.slice(branchIndex, branchIndex + 3500)
    const terminalProgressIndex = branchBody.indexOf('active-missing-tab-terminal-progress')
    const requeueIndex = branchBody.indexOf("type: 'ACTIVE_MISSING_TAB'")

    assert.notEqual(branchIndex, -1)
    assert.notEqual(terminalProgressIndex, -1)
    assert.notEqual(requeueIndex, -1)
    assert.ok(terminalProgressIndex < requeueIndex)
    assert.match(branchBody, /isTerminalProfileNukeRecord\(activeMissingTabRecord\)/)
    assert.match(branchBody, /type: 'ACTIVE_TERMINAL_PROGRESS'/)
})

test('action lease tab release reloads authority before mutating rows', () => {
    const source = readRepoFile('shared/js/sw.js')
    const releaseForTabMutationBody = extractFunction(source, 'async function mutateCoordinatorActionLeasesForTabRelease(operation = {})')

    assert.match(releaseForTabMutationBody, /await coordinatorQueueReader\.full\(\{[\s\S]*metricPath: 'actionLease\.tabRelease\.load'/)
    assert.doesNotMatch(releaseForTabMutationBody, /operation\.currentAuthorityState/)
    assert.doesNotMatch(releaseForTabMutationBody, /operation\.authorityState/)
    assert.match(releaseForTabMutationBody, /currentAuthorityState: null/)
    assert.match(releaseForTabMutationBody, /expectedAttemptId: getAttemptIdFromValue\(item\) \|\| lease\.attemptId \|\| ''/)
    assert.match(releaseForTabMutationBody, /expectedAttemptNumber: getAttemptNumberFromValue\(item\) \|\| lease\.attemptNumber \|\| 0/)
})

test('reconcile returns after saving stale-active cleanup', () => {
    const source = readRepoFile('shared/js/sw.js')
    const coordinatorRunsSource = readRepoFile('shared/js/swCoordinatorRuns.js')
    const body = extractFunction(source, 'async function persistCoordinatorReconcileAuthorityTransitionPhase(ctx = {})')
    const lockedBody = extractFunction(source, 'async function reconcileCoordinatorStorageLocked(options = {})')
    const pauseMaterializerBody = extractFunction(coordinatorRunsSource, 'function materializeCoordinatorRunsPausedStateFromControl(queue = {}, runs = {}, paused = false, nowMs = now())')
    const saveIndex = body.indexOf('await saveCoordinatorState')
    const settleIndex = body.indexOf('await settleTerminalCoordinatorItemsLocked')

    assert.notEqual(saveIndex, -1)
    assert.notEqual(settleIndex, -1)
    assert.ok(saveIndex < settleIndex)
    assert.match(source, /async function loadCoordinatorReconcileAuthorityPhase\(options = \{\}\)[\s\S]*coordinatorQueueReader\.reconcile\(\{[\s\S]*metricPath: 'reconcile\.load'/)
    assert.doesNotMatch(lockedBody, /loadCoordinatorState\(/)
    assert.match(body, /saveProfileNukeProgressRowProjection\(changedProgressRecords/)
    assert.match(body, /deleteProfileNukeProgressRowProjection\(deletedProgressHrefs/)
    assert.match(body, /progress: false/)
    assert.doesNotMatch(body, /fullProgressMirrorChanged/)
    assert.doesNotMatch(body, /progress: progressChanged/)
    const authorityTransitionBody = extractFunction(source, 'async function applyCoordinatorReconcileQueueAuthorityTransitionPhase(ctx = {})')
    assert.match(authorityTransitionBody, /materializeCoordinatorRunsPausedStateFromControl\([\s\S]*state\.stored\?\.\[COORDINATOR_PAUSED_KEY\] === true/)
    assert.match(pauseMaterializerBody, /isPendingCoordinatorStatus/)
    assert.match(pauseMaterializerBody, /paused,\s*status,/)
})

test('space-feed storage update queue schedules state-machine continuation on timeout', () => {
    const source = readRepoFile('shared/js/sw.js')
    const storageSource = readRepoFile('shared/js/swstorage.js')
    const latchSource = readRepoFile('shared/js/swStorageIdlePromiseLatch.js')
    const wrapperBody = extractFunction(
        source,
        'function enqueueSpaceFeedStorageUpdate(update, options = {})'
    )
    const body = extractFunction(
        storageSource,
        'function createSerializedStorageUpdateQueue(options = {})'
    )
    const recoveryBody = extractFunction(
        latchSource,
        "function requestStorageTimeoutRecoveryContinuation(context = {}, reason = 'storage-timeout')"
    )
    const saveBody = extractFunction(source, 'async function saveCoordinatorState(state = {}, changes = {})')

    assert.match(source, /SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS/)
    assert.match(wrapperBody, /serializedStorageUpdateQueue\.enqueue\(\(\) => \([\s\S]*update\(\)[\s\S]*\), options\)/)
    assert.match(body, /Promise\.race/)
    assert.match(body, /space-feed storage update/)
    assert.match(body, /const updateToken = state\.nextToken\(\)/)
    assert.match(body, /state\.setActive\(updateToken, storageContext\)/)
    assert.match(body, /const previousUpdate = state\.getTailPromise\(\)\.catch\(\(\) => null\)/)
    assert.match(body, /state\.abandon\(updateToken\)/)
    assert.match(body, /serializedTailPromise = updatePromise\.catch\(\(\) => null\)/)
    assert.match(body, /state\.setTailPromise\(serializedTailPromise\)/)
    assert.doesNotMatch(body, /setTailPromise\(callerPromise\.catch\(\(\) => null\)\)/)
    assert.match(body, /catch\(error => \{[\s\S]*storageUpdate\.fallbackReturned[\s\S]*return queueOptions\.failureValue \?\? false/)
    assert.match(body, /storageUpdate\.started/)
    assert.match(body, /storageUpdate\.completed/)
    assert.match(body, /storageUpdate\.timedOut/)
    assert.match(body, /storageUpdate\.tailWedged/)
    assert.match(body, /storageUpdate\.skippedAbandoned/)
    assert.match(body, /storageUpdate\.deadlineMissed/)
    assert.match(body, /storageUpdate\.abandoned/)
    assert.match(body, /hooks\.onTimeoutRecovery\([\s\S]*storageContext,[\s\S]*`\$\{queueOptions\.reason \|\| 'storage-update'\}-timeout`,[\s\S]*serializedTailPromise/)
    assert.match(body, /if\(storageContext\.didTimeout\) \{[\s\S]*hooks\.onTimeoutRecovery\([\s\S]*storageContext,[\s\S]*`\$\{queueOptions\.reason \|\| 'storage-update'\}-fallback`,[\s\S]*serializedTailPromise/)
    assert.match(source, /onTimeoutRecovery: \(context, reason, serializedTailPromise\) => \{[\s\S]*requestStorageTimeoutRecoveryContinuation\(context, reason\)[\s\S]*recoverStorageGetTimeoutSerializedTail\(context, reason, serializedTailPromise\)/)
    assert.match(latchSource, /function clearStorageTimeoutPromiseLatches\(reason = 'storage-timeout', timeoutMs = SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS\)/)
    assert.match(latchSource, /storageUpdate\.clearedTimedOutFillPromise/)
    assert.match(latchSource, /storageUpdate\.clearedTimedOutReconcilePromise/)
    assert.match(latchSource, /function requestStorageTimeoutRecoveryContinuation\(context = \{\}, reason = 'storage-timeout'\)/)
    assert.match(latchSource, /storageUpdate\.timeoutRecoveryRequested/)
    assert.match(latchSource, /function recoverStorageGetTimeoutSerializedTail\(context = \{\}, reason = 'storage-timeout', serializedTailPromise = null\)/)
    assert.match(latchSource, /storageUpdate\.serializedTailRecovered/)
    assert.match(latchSource, /storageUpdate\.storageGetTailRecovered/)
    assert.match(source, /abandoned storage update suppressed after storageGet/)
    assert.match(latchSource, /requestPostStorageQueuedWorkContinuation\(followupReason\)/)
    assert.match(latchSource, /scheduleCoordinatorQueueResume\(1000, followupReason, \{[\s\S]*allowBeforeQuora: true/)
    assert.doesNotMatch(recoveryBody, /scheduleCoordinatorReconcile\(1000, \{[\s\S]*reason: followupReason/)
    assert.match(body, /state\.isAbandoned\(updateToken\)/)
    assert.match(latchSource, /ownStorageGetMs/)
    assert.match(latchSource, /ownStorageSetMs/)
    assert.match(latchSource, /storageGetCumulativeMs/)
    assert.match(latchSource, /storageSetCumulativeMs/)
    assert.match(saveBody, /storageUpdate\.lateWriteSuppressed/)
    assert.doesNotMatch(saveBody, /progress\.changedRecordsPerStorageWrite/)
    assert.doesNotMatch(saveBody, /progress\.payloadRowsPerStorageWrite/)
    assert.doesNotMatch(saveBody, /PROFILE_NUKE_PROGRESS_KEY/)
    assert.match(saveBody, /getActiveStorageUpdateToken\(\)/)
    assert.match(saveBody, /isStorageUpdateAbandoned\(updateToken\)/)
    assert.doesNotMatch(body, /previous space-feed storage update/)
    assert.doesNotMatch(body, /timedOut:/)
})

test('queue wakeup metrics expose storage pressure without conflating fields', () => {
    const helper = readRepoFile('tools/cdp/queue-wakeup-metrics.js')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const worker = readRepoFile('shared/js/sw.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const wakeupMetricsShape = readRepoFile('shared/js/swQueueWakeupMetricsShape.js')
    const browserSessionRuntime = readRepoFile('shared/js/swBrowserSessionRuntime.js')
    const html = readRepoFile('shared/coordinator.html')
    // getStorageUpdateQueueSnapshot (the only sw.js "currentEpoch" reference)
    // moved to swCoordinatorReconcileSupportSingles.js in decomposition
    // Slice 43.
    const coordinatorReconcileSupportSinglesSource = readRepoFile('shared/js/swCoordinatorReconcileSupportSingles.js')

    assert.match(helper, /chrome\.storage\.local\.get\(\{\[key\]: null\}, storage =>/)
    assert.match(helper, /currentEpoch/)
    assert.match(helper, /previousEpochs/)
    assert.match(helper, /storageDeadlineMissed/)
    assert.match(helper, /deadlineMissRatePct/)
    assert.match(helper, /completedOnlyAfterReconcile/)
    assert.match(helper, /progress:\s*\{[\s\S]*received: progressReceived,[\s\S]*pendingMax: counter\(currentEpoch, 'progress\.pendingMax'\)/)
    assert.doesNotMatch(helper, /changedRecordsPerStorageWrite/)
    assert.doesNotMatch(helper, /payloadRowsPerStorageWrite/)
    assert.doesNotMatch(helper, /progressWrites/)
    assert.doesNotMatch(helper, /progressFlushes/)
    assert.doesNotMatch(helper, /repairRequested/)
    assert.doesNotMatch(helper, /completedOnlyAfterRepair/)
    assert.doesNotMatch(helper, /hasRepairCounters/)
    assert.doesNotMatch(helper, /repairOperations/)
    assert.doesNotMatch(helper, /queueWrite\.reason\.repair/)
    assert.match(helper, /ownStorageGetMs is merged wall time/)

    assert.match(coordinatorReconcileSupportSinglesSource, /currentEpoch/)
    assert.match(wakeupMetricsShape, /previousEpochs/)
    assert.match(wakeupMetricsShape, /lifetime/)
    assert.match(worker, /QUEUE_WAKEUP_METRICS_VIEW_KEY/)
    assert.match(worker, /buildQueueWakeupMetricsView/)
    assert.match(worker, /MAX_QUEUE_WAKEUP_METRICS_VIEW_JOURNAL/)
    assert.match(worker, /refreshQueueWakeupMetricsViewForDashboard/)
    assert.match(worker, /BROWSER_SESSION_MARKER_KEY/)
    assert.match(browserSessionRuntime, /globalThis\.chrome\?\.storage\?\.session/)
    assert.match(worker, /ensureBrowserSessionStartupMetricsReset/)
    assert.match(worker, /clearSchedulerAlarms/)
    assert.match(browserSessionRuntime, /scheduler-alarms-cleared/)
    assert.match(worker, /pendingQueueWakeupMetricsReset = \{[\s\S]*reason: 'browser-startup'/)
    assert.match(bootstrap, /resetQueueWakeupMetricsEpochAfterLoad\(resetReason, \{deferUntilQuora: true\}\)/)
    assert.match(bootstrap, /reset-queue-wakeup-metrics/)
    assert.match(worker, /firstServiceWorkerStartedAt/)
    assert.match(worker, /lastServiceWorkerStartedAt/)
    assert.match(wakeupMetricsShape, /epoch\.counters\['serviceWorker\.started'\] = 1/)
    assert.match(worker, /summarizeQueueWakeupMetricEpoch/)
    assert.match(worker, /MAX_QUEUE_WAKEUP_METRIC_EPOCH_HISTORY/)
    // D4: the startup handler is a named function, and its listener goes through the coordinator-authority gate.
    assert.match(bootstrap, /function handleRuntimeStartup\(\) \{[\s\S]*return handleCoordinatorBrowserStartup\(\)/)
    assert.match(bootstrap, /browser\.runtime\.onStartup\.addListener\(\(\) => runAfterCoordinatorAuthorityReady\(\(\) => handleRuntimeStartup\(\)\)\)/)

    assert.match(html, /resetMetricsButton/)
    assert.match(dashboard, /reset-queue-wakeup-metrics/)
    assert.match(dashboard, /QUEUE_WAKEUP_METRICS_VIEW_KEY/)
    assert.match(dashboard, /refresh-queue-wakeup-metrics-view/)
    assert.match(dashboard, /formatPreviousEpochSummary/)
    assert.match(dashboard, /Current epoch/)
    assert.match(dashboard, /rememberTimingTile\('secondsPerBlock', timingEpochStartedAt, getSecondsPerActualBlock\(timingEpochStartedAt\)\)/)
    assert.match(dashboard, /function getCurrentMetricsEpochStartedAt\(\)/)
    assert.match(readRepoFile('shared/js/swCoordinatorQueueView.js'), /milestones\.blockAttemptedAt/)
    // 2026-09-27: floored by epochStartedAt again (reversing the 2026-09-25
    // change above) -- per explicit user request, reloading the extension
    // or clicking "Reset metrics" should visibly reset this card instead of
    // silently continuing to average in rows from before the reset. See the
    // matching comment on summarizeCoordinatorActualBlockTiming in
    // swCoordinatorQueueView.js for why this floor only ever excludes rows
    // from a genuine reset, not a routine same-version restart.
    assert.match(readRepoFile('shared/js/swCoordinatorQueueView.js'), /terminalAt >= minimumTerminalAt/)
    assert.match(dashboard, /Save deadlines/)
    assert.match(dashboard, /Timeout buckets/)
    assert.match(dashboard, /No-work writes/)
    assert.match(dashboard, /Payload sources/)
    assert.match(dashboard, /Progress events/)
    assert.doesNotMatch(dashboard, /Progress changed/)
    assert.doesNotMatch(dashboard, /Progress payload/)
    assert.match(dashboard, /function formatMetricDetailValue/)
    assert.match(dashboard, /ownStorageGetMs/)
    assert.match(dashboard, /storageGetCumulativeMs/)
})

test('secs / block is relabeled secs / real block alongside a new secs / already blocked tile', () => {
    // 2026-09-27: per explicit user request, splitting genuine block
    // actions from already-blocked skips at the same summary-tile
    // prominence "secs / block" and "secs / handoff" already had.
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const sw = readRepoFile('shared/js/sw.js')
    const queueView = readRepoFile('shared/js/swCoordinatorQueueView.js')

    assert.match(html, />secs \/ real block</)
    assert.match(html, />secs \/ already blocked</)
    assert.match(html, /id="secondsPerAlreadyBlocked"/)
    assert.doesNotMatch(html, />secs \/ block</)

    assert.match(dashboard, /function getSecondsPerAlreadyBlocked\(epochStartedAt = 0\)/)
    assert.match(dashboard, /setText\('secondsPerAlreadyBlocked', formatSecondsPerBlock\(secondsPerAlreadyBlocked\)\)/)

    assert.match(queueView, /function isCoordinatorAlreadyBlockedSuccess\(item = \{\}\)/)
    assert.match(queueView, /function summarizeCoordinatorAlreadyBlockedTiming\(queue = \{\}, epochStartedAt = 0\)/)
    assert.match(queueView, /alreadyBlockedTiming: summarizeCoordinatorAlreadyBlockedTiming\(compactQueue, epochStartedAt\)/)

    assert.match(sw, /summarizeCoordinatorAlreadyBlockedTiming,/)
})

test('dashboard loads durable history before first Quora activation without resuming work', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const initBody = extractFunction(dashboard, 'async function init()')

    assert.match(initBody, /render\(\)[\s\S]*const ready = await announceCoordinatorPageReady\(\)/)
    assert.match(initBody, /setQuoraVisitRequirement\(\s*!ready \|\| !!ready\?\.requiresQuoraVisit\s*\)/)
    assert.match(initBody, /await loadState\(\)/)
    assert.match(initBody, /captureQuoraActivationMetricBaseline\(\)/)
    assert.doesNotMatch(initBody, /if\(ready\?\.requiresQuoraVisit\)[\s\S]{0,120}return/)
    assert.doesNotMatch(initBody, /repairCoordinatorStorageAfterInitialRender/)
    assert.doesNotMatch(initBody, /repairCoordinatorStorage\(/)
    assert.match(dashboard, /Loading history\.\.\./)
    assert.match(dashboard, /Waiting for first Quora page/)
    assert.match(dashboard, /\[QUEUE_WAKEUP_METRICS_VIEW_KEY\]: \{\}/)
    assert.doesNotMatch(extractFunction(dashboard, 'async function loadState()'), /\[QUEUE_WAKEUP_METRICS_KEY\]: \{\}/)
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

test('dashboard waiting banner clears from finished work the list no longer holds', () => {
    // The list holds the live rows only, so a finished row is not in state.queue. The gate reads the worker's count over the full
    // compact population (view.finishedWork), and the newest activity time among the finished rows must be from the current epoch.
    const evaluate = loadDashboardHarness()

    const finishedInEpochClears = evaluate(`
        setQuoraVisitRequirement(true)
        state.requiresQuoraVisitAt = 1000
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queueView = {version: 1, items: [], finishedWork: {count: 1, latestActivityAt: 1200}}
        state.queue = {}
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(finishedInEpochClears, false)

    const finishedBeforeEpochStillWaits = evaluate(`
        setQuoraVisitRequirement(true)
        state.requiresQuoraVisitAt = 1000
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queueView = {version: 1, items: [], finishedWork: {count: 2, latestActivityAt: 900}}
        state.queue = {}
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(finishedBeforeEpochStillWaits, true)

    const noFinishedStillWaits = evaluate(`
        setQuoraVisitRequirement(true)
        state.requiresQuoraVisitAt = 1000
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queueView = {version: 1, items: [], finishedWork: {count: 0, latestActivityAt: 0}}
        state.queue = {}
        refreshQuoraVisitRequirement(getDisplayQueueItems())
        state.requiresQuoraVisit
    `)
    assert.equal(noFinishedStillWaits, true)
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
        const aggregateResult = getSecondsPerActualBlock(getCurrentMetricsEpochStartedAt())

        state.queueView.actualBlockTiming.epochStartedAt = 900
        var mismatchedEpochResult = getSecondsPerActualBlock(getCurrentMetricsEpochStartedAt());

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

test('dashboard timing tiles read the worker summaries only, never the list rows', () => {
    // The worker computes these averages over the full compact population, finished rows included. The page's list holds the live rows
    // only, so the tiles must not recompute from it: with no worker summary they show "--", whatever the list holds.
    const evaluate = loadDashboardHarness()
    const result = evaluate(`(() => {
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queueView = {version: 1, items: [], total: 0}
        state.queue = {
            done: {status: 'succeeded', outcome: 'blocked', runId: 'run-timing', activeAt: 1100, terminalAt: 5100, updatedAt: 5100},
            next: {status: 'active', runId: 'run-timing', activeAt: 5600, updatedAt: 5600}
        }
        return {
            secondsPerBlock: formatSecondsPerBlock(getSecondsPerActualBlock(getCurrentMetricsEpochStartedAt())),
            handoff: formatSecondsPerBlock(getActivationHandoffSeconds(getCurrentMetricsEpochStartedAt()))
        }
    })()`)

    assert.equal(result.secondsPerBlock, '--')
    assert.equal(result.handoff, '--')
})

test('dashboard secs per block tiles split already-blocked from real blocks using the worker summaries', () => {
    // The worker partitions completed rows between the two tiles (summarizeCoordinatorAlreadyBlockedTiming and
    // summarizeCoordinatorActualBlockTiming in swCoordinatorQueueView.js). The page shows each summary on its own tile.
    const evaluate = loadDashboardHarness()
    const result = evaluate(`(() => {
        state.metrics = {currentEpoch: {startedAt: 1000, counters: {}, journal: []}}
        state.queueView = {
            version: 1,
            items: [],
            total: 0,
            actualBlockTiming: {epochStartedAt: 1000, blocks: 0, elapsedMs: 0, seconds: 0},
            alreadyBlockedTiming: {epochStartedAt: 1000, blocks: 1, elapsedMs: 4000, seconds: 4}
        }
        return {
            realBlock: formatSecondsPerBlock(getSecondsPerActualBlock(getCurrentMetricsEpochStartedAt())),
            alreadyBlocked: formatSecondsPerBlock(getSecondsPerAlreadyBlocked(getCurrentMetricsEpochStartedAt()))
        }
    })()`)

    assert.equal(result.realBlock, '--')
    assert.equal(result.alreadyBlocked, '4.00')
})

test('service worker secs per block aggregate can use progress milestone timing', () => {
    const source = readRepoFile('shared/js/swCoordinatorQueueView.js')
    const successBody = extractFunction(source, 'function isCoordinatorActualBlockSuccess(item = {})')
    const activeStartBody = extractFunction(source, 'function getCoordinatorActualBlockActiveStartTime(item = {})')
    assert.match(successBody, /=== 'already-blocked'\) return false/)
    assert.match(successBody, /=== 'blocked'\) return true/)
    assert.match(activeStartBody, /milestones\.actionReadyAt/)
    assert.match(activeStartBody, /milestones\.blockAttemptedAt/)
    assert.match(activeStartBody, /milestones\.tabOpenedAt/)
    assert.match(activeStartBody, /milestones\.contentOpenedAt/)
})

test('terminal work can preempt final-open authority retry delay', () => {
    const source = readRepoFile('shared/js/sw.js')
    const schedulerBody = extractFunction(source, 'function scheduleCoordinatorQueueResume(delayMs = 500, reason = \'scheduled-resume\')')
    // shouldPreemptFinalOpenAuthorityRetry moved to
    // swCoordinatorReconcileSupportSingles.js in decomposition Slice 43.
    const preemptBody = extractFunction(readRepoFile('shared/js/swCoordinatorReconcileSupportSingles.js'), 'function shouldPreemptFinalOpenAuthorityRetry(reason = \'\', options = {})')

    assert.match(schedulerBody, /!shouldPreemptFinalOpenAuthorityRetry\(normalizedReason, options\)/)
    assert.match(preemptBody, /terminal-progress/)
    assert.match(preemptBody, /storage-idle-durable/)
    assert.match(preemptBody, /active-missing-tab/)
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
    assert.ok(summaryIndex < runsIndex)
    assert.ok(metricsIndex < runsIndex, 'metrics sits above runs')
    assert.ok(runsIndex < eventsIndex)
    assert.match(html, /Showing 0, 0 queued, 0 succeeded</)
    assert.match(html, /id="pauseCurrentWorkState">Running[\s\S]*id="currentWorkReadyCount"[\s\S]*id="startCoordinatorButton"[\s\S]*id="pauseCurrentWorkButton"[\s\S]*id="clearCurrentWorkButton"/)
    assert.match(html, />Queued<\/div>/)
    assert.doesNotMatch(html, /Ready to Run/)
    assert.match(html, /Start/)
    assert.doesNotMatch(html, />Requeue</)
    assert.doesNotMatch(html, /Cancel Queue/)
    assert.doesNotMatch(html, /Enable Retry Soft-Fails|id="retryFailedButton"|id="requeueFailedButton"|id="cancelCurrentWorkButton"/)
    assert.match(html, /id="clearCurrentWorkButton" type="button"[^>]*>Clear</)
    assert.match(html, /id="workerBarCancel"/)
    assert.doesNotMatch(html, /Requeue Failed|Cancel Current Work|Idle Retry/)
    assert.match(dashboard, /startCoordinatorQueue\(\)/)
    assert.match(dashboard, /allowBeforeQuora: true/)
    assert.match(dashboard, /userInitiated: true/)
    assert.doesNotMatch(dashboard, /repair-coordinator-storage/)
    assert.doesNotMatch(dashboard, /url: 'https:\/\/www\.quora\.com\/'/)
    assert.match(dashboard, /function syncStartCoordinatorControls\(\)/)
    assert.match(dashboard, /button\.hidden = !state\.requiresQuoraVisit/)
    assert.match(dashboard, /Start Current Work without waiting for a Quora page/)
    assert.match(dashboard, /installPanelWheelScrollListeners\(\)/)
    assert.match(dashboard, /document\.querySelectorAll\('\[data-panel-scroll-target\]'\)/)
    assert.match(dashboard, /scrollTarget\.scrollBy\(/)
    assert.match(dashboard, /const succeededCount = getQueueStatusCount\('succeeded', queueItems\)/)
    assert.match(dashboard, /setText\('currentWorkReadyCount', getCurrentWorkSummaryText\(queueItems, \{\s*queuedCount,\s*succeededCount\s*\}\)\)/)
    assert.doesNotMatch(dashboard, /const hardFailedCount|retryableFailedCount/)
    assert.match(dashboard, /Showing \$\{listedCount\} of \$\{totalCount\}/)
    assert.doesNotMatch(dashboard, /getElementById\('retryFailedButton'\)/)
    assert.doesNotMatch(dashboard, /Enable Retry Soft-Fails/)
    // Capability kept (no button): toggle and the storage key stay.
    assert.match(dashboard, /async function toggleRetryFailed\(\)/)
    assert.match(dashboard, /action: 'set-coordinator-retry-failed-enabled', enabled: true/)
    assert.match(dashboard, /COORDINATOR_RETRY_FAILED_ENABLED_KEY/)
    assert.doesNotMatch(dashboard, /eligible \/ \$\{failedCount\} failed/)
    assert.doesNotMatch(dashboard, /button\.textContent = 'Idle Retry'/)
    assert.match(css, /grid-template-rows: auto auto;/)
    assert.match(css, /\.summary-value\s*\{[\s\S]*font-size: 22px;/)
    assert.match(css, /\.metric-value\s*\{[\s\S]*font-size: 16px;/)
    assert.match(css, /\.panel-stack \.panel\s*\{[\s\S]*flex: 0 0 auto;/)
    assert.match(css, /\.panel-stack \.panel\[data-panel-scroll-target="metricsJournal"\]\s*\{[\s\S]*max-height: none;/)
    assert.match(css, /\.metrics-panel\s*\{[\s\S]*flex: 0 0 auto;/)
    // 2026-10-03 (historical/nits6.md): the journal list itself now scrolls within a
    // fixed window (its own max-height/overflow, independent of the outer
    // panel's) and has its own collapse toggle, instead of growing the
    // whole Metrics panel unbounded -- same for the Recent event counts
    // histogram.
    assert.match(css, /\.metrics-journal\s*\{[\s\S]*max-height: 28vh;[\s\S]*overflow-y: auto;/)
    assert.match(html, /data-panel-toggle data-panel-target="metricsJournal"/)
    assert.match(html, /id="metricsJournalCount"/)
    assert.match(dashboard, /setText\('metricsJournalCount'/)
    assert.match(css, /\.panel-stack \.panel\[data-panel-scroll-target="eventHistogram"\]\s*\{[\s\S]*max-height: 28vh;/)
})

test('phase timing breaks the notice-select-open-load-inspect-action-detect-close cycle into per-phase averages', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const reducer = readRepoFile('shared/js/swCoordinatorProgressReducer.js')

    assert.match(html, /data-panel-scroll-target="phaseTimingHistogram"/)
    assert.match(html, /data-panel-toggle data-panel-target="phaseTimingHistogram"/)
    assert.match(html, /id="phaseTimingHistogram"/)
    assert.match(html, /id="resetPhaseTimingButton"/)
    assert.match(dashboard, /function renderPhaseTimingHistogram\(\)/)
    assert.match(dashboard, /renderPhaseTimingHistogram\(\)/)
    assert.match(dashboard, /document\.getElementById\('resetPhaseTimingButton'\)\?\.addEventListener\('click', \(\) => \{\s*void resetMetrics\(\)/)

    const phaseDurationsBody = extractFunction(reducer, 'function recordCoordinatorProfileActionPhaseDurations(item, nowMs, capabilities = {})')
    assert.match(phaseDurationsBody, /profileAction\.phase\.\$\{phase\.key\}\.sampleCount/)
    assert.match(phaseDurationsBody, /profileAction\.phase\.\$\{phase\.key\}\.totalMs/)
    assert.match(phaseDurationsBody, /profileAction\.phase\.\$\{phase\.key\}\.maxMs/)
    for(const phaseKey of ['open', 'navigate', 'load', 'claim', 'inspect', 'action', 'detect', 'close']) {
        assert.match(reducer, new RegExp(`key: '${phaseKey}'`))
    }
    assert.match(reducer, /recordCoordinatorProfileActionPhaseDurations\(sampledItem, nowMs, \{incrementQueueWakeupMetric, recordQueueWakeupMetricMax\}\)/)
})

test('History clear: the confirmation says Delete all completed history, the worker call comes first, and Clear Current Work refers to no completed row', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const sw = readRepoFile('shared/js/sw.js')

    assert.match(html, /id="clearHistoryButton"[^>]*title="Mute Block extension: Delete all completed history\./)

    const clearHistoryBody = extractFunction(dashboard, 'async function clearHistory()')
    assert.match(clearHistoryBody, /window\.confirm\('Delete all completed history\? This cannot be undone\.'\)/)
    assert.doesNotMatch(clearHistoryBody, /Nothing is deleted/)
    assert.match(clearHistoryBody, /action: 'clear-completed-history'/)
    // The page empties its rows only after the worker reports success, and a failure keeps them.
    const sentAt = clearHistoryBody.indexOf("action: 'clear-completed-history'")
    const emptiedAt = clearHistoryBody.indexOf('historyRows = new Map()')
    assert.ok(sentAt >= 0 && emptiedAt > sentAt, 'the worker is asked before the rows are emptied')
    assert.match(clearHistoryBody, /if\(result\?\.error \|\| result\?\.saved !== true\) \{[\s\S]*return/)

    assert.match(bootstrap, /request\.action === 'clear-completed-history'/)
    assert.match(bootstrap, /'clear-completed-history',/)

    // Clear Current Work: the page function and the worker's clear mutation refer to no completed row (comments and the removedCompletedRows
    // name are set aside, so only code is checked).
    const codeOnly = body => body.replace(/\/\/[^\n]*/g, '').replace(/removedCompletedRows/g, '')
    assert.doesNotMatch(codeOnly(extractFunction(dashboard, 'async function clearCurrentWork()')), /completed/i)
    assert.doesNotMatch(codeOnly(extractFunction(sw, 'async function mutateCoordinatorStoredWorkClear(operation = {})')), /completed/i)
})

test('current work clear button cancels and removes every row, and the epoch stat tiles moved into the Metrics panel', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const sw = readRepoFile('shared/js/sw.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const events = readRepoFile('shared/js/swQueueMachineEvents.js')
    const handlers = readRepoFile('shared/js/swQueueMachineHandlers.js')

    assert.match(html, /id="pauseCurrentWorkButton"[\s\S]*id="clearCurrentWorkButton"/)
    assert.match(html, /id="clearCurrentWorkButton" type="button"[^>]*>Clear</)

    const clearBody = extractFunction(dashboard, 'async function clearCurrentWork()')
    assert.match(clearBody, /action: 'clear-coordinator-current-work'/)
    assert.match(dashboard, /getElementById\('clearCurrentWorkButton'\)\?\.addEventListener\('click', \(\) => \{[\s\S]*void clearCurrentWork\(\)/)

    assert.match(bootstrap, /request\.action === 'clear-coordinator-current-work'/)
    assert.match(events, /CLEAR_STORED_WORK: 'CLEAR_STORED_WORK'/)
    assert.match(handlers, /QUEUE_MACHINE_EVENT_TYPES\.CLEAR_STORED_WORK\]: async \(event = \{\}, operation = \{\}\) => \{[\s\S]*mutateCoordinatorStoredWorkClear/)

    const clearMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkClear(operation = {})')
    // Clear must remove the queued rows outright (removedRows), not archive them the way cancel does (completedRows) -- otherwise the
    // cleared rows would just reappear via refreshCoordinatorQueueViewForDashboard's recent-completed-rows merge. Owner, 28 Oct: Clear
    // Current Work does not touch completed history, so the clear body refers to no completed row (see the History clear contract test).
    assert.match(clearMutationBody, /removedRows/)
    assert.doesNotMatch(clearMutationBody, /\bcompletedRows,/)
    assert.doesNotMatch(clearMutationBody.replace(/\/\/[^\n]*/g, '').replace(/removedCompletedRows/g, ''), /completed/i)

    // The 5 epoch-derived stat tiles (backed by queueWakeupMetrics, reset by
    // the existing "Reset metrics" button) now live inside the Metrics
    // panel instead of Current Work's own summary-grid, so Current Work no
    // longer needs its own separate reset for them.
    const metricsPanelStart = html.indexOf('data-panel-scroll-target="metricsJournal"')
    const metricsGridStart = html.indexOf('id="metricsGrid"')
    assert.ok(metricsPanelStart >= 0 && metricsGridStart > metricsPanelStart)
    const metricsPanelHtml = html.slice(metricsPanelStart, metricsGridStart)
    for(const tileId of ['secondsPerBlock', 'activationHandoffSeconds', 'reallyBlockedCount', 'alreadyBlockedCount', 'blockAttemptOnFollowingCount']) {
        assert.match(metricsPanelHtml, new RegExp(`id="${tileId}"`))
    }

    const queueListStart = html.indexOf('data-panel-scroll-target="queueList"')
    const currentWorkSummaryHtml = html.slice(queueListStart, metricsPanelStart)
    for(const tileId of ['queuedCount', 'activeCount', 'terminalCount', 'avgPageLoadValue']) {
        assert.match(currentWorkSummaryHtml, new RegExp(`id="${tileId}"`))
    }
    for(const movedTileId of ['secondsPerBlock', 'activationHandoffSeconds', 'reallyBlockedCount', 'alreadyBlockedCount', 'blockAttemptOnFollowingCount']) {
        assert.doesNotMatch(currentWorkSummaryHtml, new RegExp(`id="${movedTileId}"`))
    }
})

test('scan cost and recent event count panels each have their own Clear button', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')

    assert.match(html, /data-panel-scroll-target="scanCostHistogram"[\s\S]*id="clearScanCostButton"[\s\S]*id="scanCostHistogram"/)
    assert.match(html, /data-panel-scroll-target="eventHistogram"[\s\S]*id="clearEventHistogramButton"[\s\S]*id="eventHistogram"/)

    // Scan cost reads scan.<location>.items/calls straight out of
    // queueWakeupMetrics, the same store "Reset metrics" already zeroes --
    // its Clear button reuses that action instead of inventing a second way
    // to reset the same counters.
    assert.match(dashboard, /getElementById\('clearScanCostButton'\)\?\.addEventListener\('click', \(\) => \{[\s\S]*void resetMetrics\(\)/)

    // Recent event counts re-tallies the flight recorder's full retained
    // window on every render, so a client-only clear has to be a cutoff
    // timestamp (filtered back in on every render) rather than a one-time
    // splice -- otherwise the very next render would just repopulate it.
    const clearHistogramBody = extractFunction(dashboard, 'function clearEventHistogram()')
    assert.match(clearHistogramBody, /eventHistogramClearedAtMs = Date\.now\(\)/)
    assert.match(clearHistogramBody, /renderEventHistogram\(\)/)
    const renderHistogramBody = extractFunction(dashboard, 'function renderEventHistogram()')
    assert.match(renderHistogramBody, /entry\.at, 10\) \|\| 0\) < eventHistogramClearedAtMs\) return/)
    assert.match(dashboard, /getElementById\('clearEventHistogramButton'\)\?\.addEventListener\('click', \(\) => \{[\s\S]*clearEventHistogram\(\)/)
})

test('the TERMINAL and AVG ITEM TIME cards read the worker completed summary, not the queue counts or the listed rows', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')

    const itemTimeIndex = html.indexOf('id="avgItemTimeValue"')
    const pageLoadIndex = html.indexOf('id="avgPageLoadValue"')
    assert.ok(itemTimeIndex >= 0, 'the card exists')
    assert.ok(itemTimeIndex < pageLoadIndex, 'the card is before the page-load card')
    assert.match(html, /<div class="summary-label" title="Mute Block extension: The average over the completed rows in this view, each measured from start to completion\.">Avg item time<\/div>\s*<div class="summary-value" id="avgItemTimeValue">--<\/div>/)
    assert.match(dashboard, /const terminalCount = getCompletedTerminalCount\(\)/)
    assert.match(dashboard, /setText\('terminalCount', terminalCount\)/)
    assert.match(dashboard, /const completedItemAverageMs = getCompletedItemAverageMs\(\)/)
    assert.match(dashboard, /setText\('avgItemTimeValue', completedItemAverageMs === null \? '--' : formatPhaseTimingDurationMs\(completedItemAverageMs\)\)/)
    assert.match(extractFunction(dashboard, 'function getCompletedTerminalCount()'), /return state\.completedSummary \? state\.completedSummary\.count : 0/)
    assert.match(extractFunction(dashboard, 'function getCompletedItemAverageMs()'), /if\(!summary \|\| summary\.durationCount <= 0\) return null\s*return summary\.durationTotalMs \/ summary\.durationCount/)
    assert.doesNotMatch(dashboard, /getFinishedItemAverageMs|getAverageFinishedItemMs|queueFinishedDuration|readQueueViewFinishedDuration/)
})

test('the completed summary is the one measure: the worker queue view carries no finished-duration pair, and the summary is cached per log change and cutoff', () => {
    const view = readRepoFile('shared/js/swCoordinatorQueueView.js')
    const buildBody = extractFunction(view, 'function buildCoordinatorQueueView(queue = {}, nowMs = now(), options = {})')
    assert.doesNotMatch(buildBody, /finishedDuration/)

    const sw = readRepoFile('shared/js/sw.js')
    const summaryBody = extractFunction(sw, 'function summarizeCompletedWorkDurationsSince(completedMap = {}, clearedAt = 0)')
    assert.match(summaryBody, /if\(!\(terminalAt > cutoff\)\) continue/)
    assert.match(summaryBody, /if\(activeAt > 0 && terminalAt > activeAt\) \{\s*const duration = terminalAt - activeAt\s*durationCount \+= 1\s*durationTotalMs \+= duration/)
    // The duration histograms (owner, 26 Oct) take the two completed-row predicates, one class per row, and nothing else.
    assert.match(summaryBody, /if\(isCoordinatorActualBlockSuccess\(row\)\) realBlockDurationsMs\.push\(duration\)\s*else if\(isCoordinatorAlreadyBlockedSuccess\(row\)\) alreadyBlockedDurationsMs\.push\(duration\)/)

    const cacheBody = extractFunction(sw, 'function residentCompletedSummaryFor(map = null, clearedAt = 0)')
    assert.match(cacheBody, /cached\.revision === residentCompletedRevision && cached\.clearedAt === cutoff/)
    assert.match(cacheBody, /summarizeCompletedWorkDurationsSince\(map \|\| \{\}, cutoff\)/)
    assert.match(sw, /residentCompletedSummaryFor,\s*isHydrated\(\) \{/)

    // The refresh path and the pushed path both carry the summary under the same field name, and every push site attaches it.
    assert.match(sw, /completedSummary: coordinatorAuthority\.residentCompletedSummaryFor\(residentCompleted, coordinatorStatsClearedAtResident\)/)
    assert.match(sw, /finishedWork: summarizeFinishedWorkInPopulation\(population\),\s*completedSummary: snapshot\.completedSummary/)
    const attachBody = extractFunction(sw, 'function withCoordinatorCompletedSummary(view = null)')
    assert.match(attachBody, /completedSummary: coordinatorAuthority\.residentCompletedSummaryFor\(completed, coordinatorStatsClearedAtResident\)/)
    const notifyCount = (sw.match(/\{\[COORDINATOR_QUEUE_VIEW_KEY\]: (?:hotPathQueueView|view|checkpointView)\}/g) || []).length
    const attachedCount = (sw.match(/withCoordinatorCompletedSummary\(mergeCoordinatorQueueViewTimingCache\(|= withCoordinatorCompletedSummary\(mergeCoordinatorQueueViewTimingCache\(runQueueWakeupMetricPhase/g) || []).length
    assert.ok(notifyCount >= 5, 'the queue view is pushed from the hot path')
    assert.ok(attachedCount >= 5, 'every pushed queue view attaches the completed summary')
    // A completed-log change pushes the view again, so the summary is never one archive behind.
    assert.match(extractFunction(sw, 'function pushCoordinatorQueueViewAfterCompletedChange(queue = {})'), /withCoordinatorCompletedSummary\(mergeCoordinatorQueueViewTimingCache\(buildCoordinatorQueueView/)
    assert.match(sw, /pushCoordinatorQueueViewAfterCompletedChange\(projection\.queue\)\s*\}/)
})

test('the cards read the completed summary from a refresh view or a pushed view, show -- with no timed rows, and keep the last one when a view has none', () => {
    const evaluate = loadDashboardHarness()

    // Three completed rows since the cutoff, two with a duration (1000 and 2000 ms): the average is 1500 ms (1.5s) over 2 rows, and the
    // TERMINAL card shows 3. The queue counts say 1, so the TERMINAL card is not reading them.
    evaluate(`applyCoordinatorQueueView({version: 1, items: [], counts: {succeeded: 1}, total: 1, completedSummary: {count: 3, durationCount: 2, durationTotalMs: 3000}})`)
    assert.equal(evaluate('JSON.stringify(state.completedSummary)'), '{"count":3,"durationCount":2,"durationTotalMs":3000}')
    assert.equal(evaluate('getCompletedItemAverageMs()'), 1500)
    assert.equal(evaluate('formatPhaseTimingDurationMs(getCompletedItemAverageMs())'), '1.5s')
    assert.equal(evaluate('getCompletedTerminalCount()'), 3)
    assert.equal(evaluate('getQueueTerminalCount()'), 1)

    // Completed rows with no positive duration: the TERMINAL card still counts them, and the average shows --.
    evaluate(`applyCoordinatorQueueView({version: 1, items: [], counts: {succeeded: 2}, total: 2, completedSummary: {count: 2, durationCount: 0, durationTotalMs: 0}})`)
    assert.equal(evaluate('getCompletedItemAverageMs()'), null)
    assert.equal(evaluate(`(v => v === null ? '--' : formatPhaseTimingDurationMs(v))(getCompletedItemAverageMs())`), '--')
    assert.equal(evaluate('getCompletedTerminalCount()'), 2)

    // A view without a summary keeps the last one, so the cards cannot blank between views (the flicker fix).
    evaluate(`applyCoordinatorQueueView({version: 1, items: [], counts: {}, total: 0})`)
    assert.equal(evaluate('getCompletedTerminalCount()'), 2)
    assert.equal(evaluate('getCompletedItemAverageMs()'), null)

    // Before any view carries a summary, the TERMINAL card reads 0 and the average reads --.
    evaluate(`(() => { state.completedSummary = null })()`)
    assert.equal(evaluate('getCompletedTerminalCount()'), 0)
    assert.equal(evaluate('getCompletedItemAverageMs()'), null)

    // The pushed path: a pushed view whose live-queue counts are a regression is held back by the guard, but its completed summary is applied.
    // The push redraws the page, which this harness has no document for, so the draw is stubbed. The test reads state only.
    evaluate(`render = () => {}`)
    evaluate(`applyCoordinatorQueueView({version: 1, items: [], counts: {succeeded: 5}, total: 5})`)
    evaluate(`applyCoordinatorDashboardStateFromMessage({mbCoordinatorQueueView: {version: 1, total: 1, counts: {succeeded: 1}, completedSummary: {count: 4, durationCount: 1, durationTotalMs: 800}}})`)
    assert.equal(evaluate('getQueueTerminalCount()'), 5, 'the regressed live-queue counts are not applied')
    assert.equal(evaluate('getCompletedTerminalCount()'), 4)
    assert.equal(evaluate('getCompletedItemAverageMs()'), 800)
})

test('duration histogram buckets: the edges are the tunables array (semi-log, 0.75 to 10 s), each edge is an inclusive lower bound, and 749, 750, 999, 1000 and 10000 ms land where the owner set them', () => {
    const tunables = require(path.join(__dirname, '..', 'shared/js/tunables'))
    const edges = tunables.HISTOGRAM_DURATION_EDGES_SEC
    assert.deepEqual(edges, [0, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10])
    const {countDurationHistogramBuckets} = require(path.join(__dirname, '..', 'shared/js/swCoordinatorQueueView'))
    const zeros = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

    assert.deepEqual(countDurationHistogramBuckets([749], edges), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], '749 ms is 0-0.75 s')
    assert.deepEqual(countDurationHistogramBuckets([750], edges), [0, 1, 0, 0, 0, 0, 0, 0, 0, 0], '750 ms is 0.75-1 s: the lower bound is inclusive')
    assert.deepEqual(countDurationHistogramBuckets([999], edges), [0, 1, 0, 0, 0, 0, 0, 0, 0, 0], '999 ms is 0.75-1 s')
    assert.deepEqual(countDurationHistogramBuckets([1000], edges), [0, 0, 1, 0, 0, 0, 0, 0, 0, 0], '1000 ms is 1-1.5 s: the lower bound is inclusive')
    assert.deepEqual(countDurationHistogramBuckets([1499, 1500], edges), [0, 0, 1, 1, 0, 0, 0, 0, 0, 0], '1499 ms is 1-1.5 s; 1500 ms is 1.5-2 s')
    assert.deepEqual(countDurationHistogramBuckets([9999], edges), [0, 0, 0, 0, 0, 0, 0, 0, 1, 0], '9999 ms is 8-10 s')
    assert.deepEqual(countDurationHistogramBuckets([10000], edges), [0, 0, 0, 0, 0, 0, 0, 0, 0, 1], '10000 ms is over 10 s: the last edge is an inclusive lower bound')
    assert.deepEqual(countDurationHistogramBuckets([10001], edges), [0, 0, 0, 0, 0, 0, 0, 0, 0, 1], '10001 ms is over 10 s')
    assert.deepEqual(countDurationHistogramBuckets([3600000], edges), [0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 'an hour is still over 10 s')
    assert.deepEqual(countDurationHistogramBuckets([0, 749, 750, 999, 1000, 1499, 1500, 1999, 2000, 2999, 3000, 3999, 4000, 5999, 6000, 7999, 8000, 9999, 10000, 10001], edges),
        [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], 'each bucket takes its own two edges and the rest go to the next')
    assert.deepEqual(countDurationHistogramBuckets([-5, Number.NaN, 'x'], edges), zeros, 'a negative, NaN or non-numeric duration is not counted')
    assert.deepEqual(countDurationHistogramBuckets([], edges), zeros)
    assert.deepEqual(countDurationHistogramBuckets([1500], []), [], 'no edges, no buckets')
})

test('duration histograms on the dashboard: the page carries both panels beside the block timing cards with the hover prefix, labels come from the edges, and the summary keeps the histograms only when sent', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    for(const [id, title] of [
        ['realBlockDurationHistogram', 'Real block'],
        ['alreadyBlockedDurationHistogram', 'Already blocked']
    ]) {
        assert.match(html, new RegExp(`<section class="duration-histogram" id="${id}" title="Mute Block extension: [^"]+">`), `${id} is a panel with the hover prefix`)
        assert.match(html, new RegExp(`<div class="summary-label">${title}</div>`), `${title} panel heading`)
    }
    assert.match(html, /id="realBlockDurationBars"/)
    assert.match(html, /id="alreadyBlockedDurationBars"/)
    assert.match(html, /id="realBlockDurationTotal">no samples</)
    assert.match(html, /id="alreadyBlockedDurationTotal">no samples</)
    // Placed after secs / already blocked and before the metrics grid, so they sit with the block timing cards.
    const secondsIndex = html.indexOf('id="secondsPerAlreadyBlocked"')
    const panelIndex = html.indexOf('id="realBlockDurationHistogram"')
    assert.ok(secondsIndex > 0 && panelIndex > secondsIndex && panelIndex < html.indexOf('id="metricsGrid"'), 'the panels sit beside the block timing cards')

    assert.match(extractFunction(dashboard, 'function render()'), /renderDurationHistograms\(\)/)
    assert.match(extractFunction(dashboard, 'function renderDurationHistograms()'), /renderDurationHistogram\('realBlockDurationBars', 'realBlockDurationTotal', summary\.realBlockHistogram/)
    assert.match(extractFunction(dashboard, 'function renderDurationHistograms()'), /renderDurationHistogram\('alreadyBlockedDurationBars', 'alreadyBlockedDurationTotal', summary\.alreadyBlockedHistogram/)
    assert.match(extractFunction(dashboard, 'function renderDurationHistogram(barsId'), /'no samples'/)

    const evaluate = loadDashboardHarness()
    assert.equal(evaluate('JSON.stringify(getDurationBucketLabels())'), '["0-0.75 s","0.75-1 s","1-1.5 s","1.5-2 s","2-3 s","3-4 s","4-6 s","6-8 s","8-10 s","over 10 s"]')

    // A summary the worker sends with the histograms keeps them, rounded to numbers.
    evaluate(`applyCoordinatorQueueView({version: 1, items: [], counts: {succeeded: 2}, total: 2, completedSummary: {count: 2, durationCount: 2, durationTotalMs: 3000, realBlockHistogram: {counts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], sampleCount: 1, totalMs: 999}, alreadyBlockedHistogram: {counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], sampleCount: 0, totalMs: 0}}})`)
    assert.equal(evaluate('JSON.stringify(state.completedSummary)'), '{"count":2,"durationCount":2,"durationTotalMs":3000,"realBlockHistogram":{"counts":[1,0,0,0,0,0,0,0,0,0],"sampleCount":1,"totalMs":999},"alreadyBlockedHistogram":{"counts":[0,0,0,0,0,0,0,0,0,0],"sampleCount":0,"totalMs":0}}')
    // A summary without them keeps the three fields alone, as before.
    evaluate(`applyCoordinatorQueueView({version: 1, items: [], counts: {succeeded: 1}, total: 1, completedSummary: {count: 1, durationCount: 0, durationTotalMs: 0}})`)
    assert.equal(evaluate('JSON.stringify(state.completedSummary)'), '{"count":1,"durationCount":0,"durationTotalMs":0}')

    // The panels' colours are tokens only.
    const css = readRepoFile('shared/css/coordinator.css')
    const histogramCss = css.match(/\.duration-histogram[\s\S]*?\.duration-histogram-label \{[\s\S]*?\}/)
    assert.ok(histogramCss, 'the histogram rules exist')
    assert.doesNotMatch(histogramCss[0], /#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    assert.match(histogramCss[0], /var\(--mb-blue-500\)/)
})

test('archiveTerminalCoordinatorRow resyncs resident state without racing applyLocked', () => {
    const sw = readRepoFile('shared/js/sw.js')

    const archiveBody = extractFunction(sw, "async function archiveTerminalCoordinatorRow(rowKey = '', terminalRow = null, options = {})")
    assert.match(archiveBody, /await coordinatorAuthority\.enqueueResidentRowRemoval\(rowKey\)/)

    // enqueueResidentRowRemoval must be chained on the SAME applyTail
    // promise enqueueApplyLocked uses, not an independent hydrate()/reload --
    // that's what makes it safe against a concurrently in-flight applyLocked
    // call for a different row (2026-09-26).
    const removalBody = extractFunction(sw, "function enqueueResidentRowRemoval(rowKey = '')")
    assert.match(removalBody, /applyTail\s*\n\s*\.catch\(\(\) => null\)/)
    assert.match(removalBody, /applyTail = run\.catch\(\(\) => null\)/)
    assert.match(removalBody, /delete nextQueue\[rowKey\]/)
    assert.doesNotMatch(removalBody, /loadCoordinatorCurrentAuthorityState|metricStorageGet/)

    assert.match(sw, /enqueueResidentRowRemoval,\s*\n\s*persist,/)
})

test('write-queue-backlog stall warning also mirrors onto the extension icon badge', () => {
    const sw = readRepoFile('shared/js/sw.js')

    const stallBody = extractFunction(sw, "function maybeWarnCoordinatorStorageUpdateQueueStall(reason = '')")
    assert.match(stallBody, /setCoordinatorWriteQueueBacklogAlertBadge\(stalled\)/)

    const badgeBody = extractFunction(sw, 'function setCoordinatorWriteQueueBacklogAlertBadge(active = false)')
    assert.match(badgeBody, /if\(active === coordinatorWriteQueueBacklogAlertActive\) return/)
    assert.match(badgeBody, /browser\.action\?\.setBadgeText/)
    assert.match(badgeBody, /setBadgeBackgroundColor/)
})

test('classify builds the runtime-surface index once per call instead of re-scanning per row', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const classification = readRepoFile('shared/js/swCoordinatorExecutorClassification.js')

    const classifyBody = extractFunction(sw, 'async function classifyCoordinatorExecutorState(options = {})')
    assert.match(classifyBody, /const runtimeSurfaceIndex = buildRuntimeSurfaceIndex\(queueRuntime\.listRuntimeSurfaceEntries\(\)\)/)
    // Every per-row getRuntimeSurfaceForCoordinatorItem call in this loop
    // must pass the shared index -- one without it silently falls back to
    // a full runtime-state scan, defeating the whole point.
    const perRowCalls = classifyBody.match(/getRuntimeSurfaceForCoordinatorItem\([^)]*\)/gs) || []
    assert.ok(perRowCalls.length >= 3, 'expected at least 3 getRuntimeSurfaceForCoordinatorItem call sites in classify')
    for(const call of perRowCalls) {
        assert.match(call, /runtimeSurfaceIndex/, `call site missing runtimeSurfaceIndex: ${call}`)
    }

    const queueRuntimeSource = readRepoFile('shared/js/swqueueRuntime.js')
    assert.match(queueRuntimeSource, /function listRuntimeSurfaceEntries\(\)/)
    const indexBody = extractFunction(classification, 'function buildRuntimeSurfaceIndex(entries = [])')
    assert.match(indexBody, /wildcards\.push\(entry\)/)
    const lookupBody = extractFunction(classification, "function getRuntimeSurfaceForCoordinatorItem(item = null, itemKey = '', options = {})")
    assert.match(lookupBody, /\.\.\.\(index\.wildcards \|\| \[\]\)/)
})

test('queued self-heal (terminal-progress-settles-queued) match rate is observable on the dashboard', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const dashboard = readRepoFile('shared/js/coordinator.js')

    assert.match(sw, /incrementMetric\('queuedTerminalProgressSettlement\.matched'\)/)
    assert.match(dashboard, /getMetricCounter\(counters, 'queuedTerminalProgressSettlement\.matched'\)/)
    assert.match(dashboard, /getMetricCounter\(counters, 'changed\.terminalizedQueuedFromTerminalProgress'\)/)
    assert.match(dashboard, /buildMetricCard\('Queued self-heal',/)
})

test('dev mode toggle hides the internal-audience panels by default and persists across reloads', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const css = readRepoFile('shared/css/coordinator.css')

    assert.match(html, /id="devModeToggle"/)
    // Every diagnostic panel starts hidden in the markup itself (not just
    // via JS after load), so there's no flash-of-clutter before init() runs,
    // and a JS failure fails safe to hidden rather than fails open to shown.
    for(const scrollTarget of ['metricsJournal', 'scanCostHistogram', 'eventHistogram', 'outlierList', 'runList', 'eventList']) {
        assert.match(html, new RegExp(`data-panel-scroll-target="${scrollTarget}" data-dev-mode-panel hidden`))
    }
    // Current Work and its own summary tiles are end-user relevant and must
    // never be gated behind dev mode.
    assert.doesNotMatch(html, /data-panel-scroll-target="queueList"[^>]*data-dev-mode-panel/)

    // The worker owns the flag (no writes outside the worker). The page reads a copy loaded from chrome.storage at init, and
    // a toggle asks the worker to write it.
    assert.match(readRepoFile('shared/js/storageKeys.js'), /DEV_MODE_SYNC_STORAGE_KEY: 'mbDashboardDevModeEnabled'/)
    assert.match(dashboard, /DEV_MODE_SYNC_STORAGE_KEY[\s\S]*?\} = require\('\.\/storageKeys'\)/)
    assert.doesNotMatch(dashboard, /localStorage/)
    const isEnabledBody = extractFunction(dashboard, 'function isDevModeStoredEnabled()')
    assert.match(isEnabledBody, /return devModeStoredEnabled/)
    const loadEnabledBody = extractFunction(dashboard, 'async function loadDevModeStoredEnabled()')
    assert.match(loadEnabledBody, /namespaceArea\(browser\.storage\.local\)\.get\(\{\[DEV_MODE_SYNC_STORAGE_KEY\]: false\}\)/)
    const setEnabledBody = extractFunction(dashboard, 'function setDevModeStoredEnabled(enabled)')
    assert.match(setEnabledBody, /action: 'set-dev-mode-enabled'/)
    assert.doesNotMatch(setEnabledBody, /browser\.storage/)

    const applyVisibilityBody = extractFunction(dashboard, 'function applyDevModeVisibility(enabled)')
    assert.match(applyVisibilityBody, /querySelectorAll\('\[data-dev-mode-panel\]'\)/)
    assert.match(applyVisibilityBody, /panel\.hidden = !enabled/)

    const installBody = extractFunction(dashboard, 'function installDevModeToggle()')
    assert.match(installBody, /isDevModeStoredEnabled\(\)/)
    assert.match(installBody, /applyDevModeVisibility\(enabled\)/)
    assert.match(installBody, /setDevModeStoredEnabled\(toggle\.checked\)/)
    assert.match(dashboard, /installDevModeToggle\(\)/)

    assert.match(css, /\.dev-mode-toggle\s*\{/)
    // .panel's own `display: flex` is an author rule, which always beats the
    // user-agent stylesheet's `[hidden] { display: none }` regardless of
    // specificity -- without this reassertion, `hidden` on a `.panel`
    // section (as applyDevModeVisibility sets) renders visible anyway.
    // Live-repro'd 2026-09-26: the dev mode toggle turned off but every
    // diagnostic panel still rendered.
    assert.match(css, /\.panel\[hidden\]\s*\{[\s\S]*display: none;/)
    // .coordinator's two grid rows are sized "auto", and the container also
    // has min-height:100vh -- without align-content:start, default grid
    // alignment stretches "auto" rows to fill any leftover viewport space,
    // which is invisible while content already exceeds 100vh but produced a
    // huge blank gap above the header once dev mode hid enough panels to
    // leave real leftover space (live-repro'd 2026-09-26).
    assert.match(css, /\.coordinator\s*\{[\s\S]*align-content: start;/)
})

test('the dashboard has no soft-fail retry state line (owner, 27 Oct): markup, sync function and header counts are gone; the stored flag stays', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    // The visible line, its sync function and its retry-count feed are removed. The line text and the header counts are absent.
    assert.doesNotMatch(html, /id="retryFailedState"|Soft-fail retry/)
    assert.doesNotMatch(html, /soft-fail|hard-fail/)
    assert.doesNotMatch(dashboard, /retryFailedState|Soft-fail retry|syncRetryFailedControls|getSoftFailRetryCounts|getRetryFailedWorkWaitText/)
    assert.doesNotMatch(dashboard, /soft-fail, |hard-fail|retryableFailedCount|hardFailedCount/)
    // Plumbing kept: the stored retry flag is still read at load and written by the toggle and stop paths.
    assert.match(dashboard, /retryFailedActive = incomingState\[COORDINATOR_RETRY_FAILED_ENABLED_KEY\] === true/)
    assert.match(dashboard, /retryFailedActive = !!stored\[COORDINATOR_RETRY_FAILED_ENABLED_KEY\]/)
    assert.match(dashboard, /async function toggleRetryFailed\(\)/)
})

test('dashboard current-work list shows queued rows in real dispatch order, not most-recently-added first', () => {
    // 2026-09-16 nit: renderQueue always re-sorts the already-server-sorted
    // queue view with its own compareCurrentWorkItems before painting rows,
    // so this client-side comparator -- not buildCoordinatorQueueView's --
    // is what the user actually sees. It used to break 'queued'-rank ties
    // by time descending, same as every other rank: fine for surfacing
    // recent activity in 'active', backwards for 'queued', where the row
    // that's actually about to run next (the front of the executor's real
    // FIFO dispatch order, queueRuntime.rebuildQueueOrder's queueSequence
    // ascending) should be the one shown first, not whichever was queued
    // most recently.
    const evaluate = loadDashboardHarness()
    // JSON round-tripped: the vm context is a separate realm, so an array
    // built there has a different Array.prototype than this file's -- an
    // assert.deepEqual (strict mode -> deepStrictEqual) on the raw
    // cross-realm value fails on prototype identity alone even when every
    // element matches.
    const orderedKeys = JSON.parse(evaluate(`
        const items = [
            {storageKey: 'recently-added', status: 'queued', queuedAt: 5000, updatedAt: 5000, queueSequence: 9},
            {storageKey: 'front-of-line', status: 'queued', queuedAt: 1000, updatedAt: 1000, queueSequence: 1}
        ]
        JSON.stringify(items.slice().sort(compareCurrentWorkItems).map(item => item.storageKey))
    `))

    assert.deepEqual(orderedKeys, ['front-of-line', 'recently-added'])
})

test('dashboard has no requeue control; Clear is the only Current Work reset', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const html = readRepoFile('shared/coordinator.html')

    assert.doesNotMatch(dashboard, /requeue-coordinator-failed/)
    assert.doesNotMatch(dashboard, /requeueFailed|syncRequeueFailedControls|buildQueueActionCell/)
    assert.doesNotMatch(html, /requeueFailedButton|>Requeue</)
    assert.match(dashboard, /action: 'clear-coordinator-current-work'/)
})

test('dashboard drops the authority-state-reads panel and the Wakeups and No-work red alerts', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const html = readRepoFile('shared/coordinator.html')

    assert.doesNotMatch(html, /authorityLoadHistogram|Authority state reads/)
    assert.doesNotMatch(dashboard, /renderAuthorityLoadHistogram|clearAuthorityLoadHistogramButton/)

    const cardSource = (start, end) => {
        const from = dashboard.indexOf(start)
        const to = dashboard.indexOf(end, from + 1)
        assert.ok(from >= 0 && to > from, 'card not found: ' + start)
        return dashboard.slice(from, to)
    }
    const wakeupsCard = cardSource("buildMetricCard('Wakeups/job'", "buildMetricCard('Nudge accept'")
    const noWorkCard = cardSource("buildMetricCard('No-work writes'", "buildMetricCard('Save queue wait'")
    assert.doesNotMatch(wakeupsCard, /alert:/)
    assert.doesNotMatch(noWorkCard, /alert:/)
    // values and labels stay
    assert.match(wakeupsCard, /formatRatio\(wakeups \/ jobs\)/)
    assert.match(noWorkCard, /\$\{storageNoDurableWork\}/)
})

test('dashboard queued rows expose per-item cancel before status', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const sw = readRepoFile('shared/js/sw.js')
    const css = readRepoFile('shared/css/coordinator.css')
    const renderBody = extractFunction(dashboard, 'function renderQueue(items)')
    const cancelCellBody = extractFunction(dashboard, 'function buildQueueCancelCell(item = {})')
    const cancelItemBody = extractFunction(dashboard, 'async function cancelCurrentWorkItem(item = {})')
    const cancelStoredBody = extractFunction(sw, 'async function cancelStoredCoordinatorWork(options = {})')
    const cancelItemMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkItemCancel(operation = {})')
    const cancelMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkCancel(operation = {})')
    const handlerBody = readRepoFile('shared/js/swQueueMachineHandlers.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const messageStart = bootstrap.indexOf("request.action === 'cancel-coordinator-current-work-item'")

    assert.match(renderBody, /buildQueueCancelCell\(item\),\s*buildBadge\(item\.status \|\| 'unknown'/)
    assert.match(cancelCellBody, /isPendingQueueStatus/)
    assert.match(cancelCellBody, /button\.textContent = 'Cancel'/)
    assert.match(cancelCellBody, /cancelCurrentWorkItem\(item\)/)
    assert.match(cancelItemBody, /action: 'cancel-coordinator-current-work-item'/)
    assert.match(cancelStoredBody, /type: hasTarget \? 'CANCEL_STORED_WORK_ITEM' : 'CANCEL_STORED_WORK'/)
    assert.match(cancelStoredBody, /coordinatorKey,/)
    assert.match(cancelStoredBody, /storageKey,/)
    assert.match(cancelStoredBody, /profileHref/)
    assert.match(handlerBody, /\[QUEUE_MACHINE_EVENT_TYPES\.CANCEL_STORED_WORK_ITEM\]/)
    assert.match(handlerBody, /\[QUEUE_MACHINE_EVENT_TYPES\.CANCEL_STORED_WORK\]/)
    assert.match(cancelItemMutationBody, /operationKind: 'current-work-item-cancel'/)
    assert.match(cancelItemMutationBody, /coordinatorQueueReader\.runsEvents\(\{[\s\S]*metricPath: 'currentWork\.itemCancel\.load'/)
    assert.doesNotMatch(cancelItemMutationBody, /loadCoordinatorState\(/)
    assert.doesNotMatch(cancelItemMutationBody, /PROFILE_NUKE_PROGRESS_KEY|profileNukeProgress|makeTerminalProgressRecordFromCoordinatorItem/)
    assert.match(cancelItemMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate/)
    // 2026-09-29: migrated onto applyCoordinatorRunsUpdate (see
    // mutated-running-total-audit-todo-2026-09-25.md).
    assert.match(cancelItemMutationBody, /applyCoordinatorRunsUpdate\(nextQueue, affectedRunIds, \{[\s\S]*events: \[canceledEvent\],[\s\S]*queueOperation: 'current-work-item-cancel-derived'/)
    assert.doesNotMatch(cancelItemMutationBody, /saveCoordinatorState\(\{[\s\S]*queue: nextQueue/)
    assert.doesNotMatch(cancelItemMutationBody, /coordinatorAuthorityWrite: true/)
    assert.match(cancelMutationBody, /const hasTarget = !!\(targetStorageKey \|\| targetCoordinatorKey \|\| targetHref\)/)
    assert.match(cancelMutationBody, /if\(hasTarget &&/)
    assert.match(sw, /'current-work-item-cancel'/)
    assert.notEqual(messageStart, -1)
    assert.match(css, /\.row--queue\s*\{[\s\S]*grid-template-columns: minmax\(180px, 1fr\) 80px 120px/)
    assert.match(css, /\.row-cancel-cell/)
    assert.match(css, /\.row-cancel-button/)
})

test('a failed Current Work row shows only a Remove control with owner hover help, and the worker removes only that row', () => {
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const sw = readRepoFile('shared/js/sw.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const events = readRepoFile('shared/js/swQueueMachineEvents.js')
    const handlers = readRepoFile('shared/js/swQueueMachineHandlers.js')
    const helpSource = readRepoFile('shared/js/muteBlockHelp.js')
    const cellBody = extractFunction(dashboard, 'function buildQueueCancelCell(item = {})')
    const removeClientBody = extractFunction(dashboard, 'async function removeFailedCurrentWorkItem(item = {})')
    const removeWrapperBody = extractFunction(sw, 'async function removeCoordinatorFailedWorkItem(request = {})')
    const removeMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkFailedItemRemove(operation = {})')

    // Shown on failed rows only: the failed branch returns before the pending-row Cancel branch, which is unchanged.
    assert.match(cellBody, /=== 'failed'\) \{[\s\S]*textContent = 'Remove'[\s\S]*return cell\s*\}\s*if\(!isPendingQueueStatus/)
    assert.match(cellBody, /button\.textContent = 'Cancel'/)
    assert.match(cellBody, /cancelCurrentWorkItem\(item\)/)
    assert.match(cellBody, /setMuteBlockHelp\(removeButton, 'Remove this failed row from the queue\. Nothing is sent to Quora\.'\)/)
    assert.match(cellBody, /removeFailedCurrentWorkItem\(item\)/)
    assert.match(helpSource, /const MUTE_BLOCK_HELP_PREFIX = 'Mute Block extension: '/)

    // No confirmation, and the client sends the new action, not the cancel action.
    assert.match(removeClientBody, /!== 'failed'\) return/)
    assert.match(removeClientBody, /action: 'remove-coordinator-failed-work-item'/)
    assert.doesNotMatch(removeClientBody, /cancel-coordinator-current-work|confirm\(/)

    // The worker removes one failed live row, guarded, through the door, and reads or writes no completed-work row.
    assert.match(removeWrapperBody, /type: 'REMOVE_FAILED_STORED_WORK_ITEM'/)
    assert.match(removeWrapperBody, /timeoutMs: QUEUE_CRITICAL_STORAGE_UPDATE_TIMEOUT_MS/)
    assert.match(removeMutationBody, /coordinatorQueueReader\.runsEvents\(\{[\s\S]*metricPath: 'currentWork\.failedRemove\.load'/)
    assert.match(removeMutationBody, /!== 'failed'\) return \{removed: false, reason: 'not-failed-current-work-item'\}/)
    assert.match(removeMutationBody, /coordinatorAuthority\.persistCoordinator\(\{[\s\S]*guardRemovedRows: true/)
    assert.match(removeMutationBody, /operationKind: 'current-work-failed-item-remove'/)
    assert.doesNotMatch(removeMutationBody, /completedRows|completedRecent|removedCompletedRows|applyCoordinatorRunsUpdate|loadCoordinatorState\(/)
    assert.doesNotMatch(removeMutationBody, /status: 'canceled'|buildTerminalCoordinatorQueueItem|requeue/)

    // Wiring: the event type, its handler, the bootstrap dispatch, and the authority gate that the new action must join.
    assert.match(events, /REMOVE_FAILED_STORED_WORK_ITEM: 'REMOVE_FAILED_STORED_WORK_ITEM'/)
    assert.match(handlers, /\[QUEUE_MACHINE_EVENT_TYPES\.REMOVE_FAILED_STORED_WORK_ITEM\]: async[\s\S]*mutateCoordinatorStoredWorkFailedItemRemove\(\{/)
    assert.match(bootstrap, /request\.action === 'remove-coordinator-failed-work-item'\) \{\s*return removeCoordinatorFailedWorkItem\(request\)/)
    assert.match(bootstrap, /'remove-coordinator-failed-work-item',/)
})

test('WAL derived mutation saves do not write raw queue mirrors', () => {
    const source = readRepoFile('shared/js/sw.js')
    // 2026-09-29: some formerly-direct saveCoordinatorState({runs, ...})
    // call sites are being migrated onto applyCoordinatorRunsUpdate (see
    // mutated-running-total-audit-todo-2026-09-25.md) -- a queueOperation:
    // '...-derived' string at one of *those* call sites no longer appears
    // next to a literal saveCoordinatorState( call, since the actual save
    // now happens once, centrally, inside applyCoordinatorRunsUpdate's own
    // locked implementation. Collect both call shapes so this invariant's
    // coverage doesn't shrink as call sites migrate.
    const derivedSaves = collectCallSites(source, 'saveCoordinatorState')
        .filter(call => /queueOperation: '[^']+-derived'/.test(call.text))
    const derivedRunsUpdates = collectCallSites(source, 'applyCoordinatorRunsUpdate')
        .filter(call => /queueOperation: '[^']+-derived'/.test(call.text))

    assert.ok(derivedSaves.length + derivedRunsUpdates.length >= 10, 'expected WAL-derived saveCoordinatorState/applyCoordinatorRunsUpdate call sites')

    const violations = []
    for(const call of derivedSaves) {
        const payloadEnd = call.text.indexOf('}, {')
        assert.notEqual(payloadEnd, -1, `unexpected saveCoordinatorState shape at line ${call.line}`)
        const payload = call.text.slice(0, payloadEnd)
        if(/\bqueue:\s*[^,\n}]+/.test(payload) || /\bqueue:\s*true\b/.test(call.text)) {
            violations.push(`${call.functionName}:${call.line}`)
        }
    }
    for(const call of derivedRunsUpdates) {
        // applyCoordinatorRunsUpdate(queue, affectedRunIds, options) takes
        // queue as a required positional argument by design -- the
        // invariant here is that its options object never smuggles in a
        // raw `queue` field of its own.
        const optionsStart = call.text.indexOf('{', call.text.indexOf(','))
        const optionsText = optionsStart === -1 ? call.text : call.text.slice(optionsStart)
        if(/\bqueue:\s*[^,\n}]+/.test(optionsText)) {
            violations.push(`${call.functionName}:${call.line}`)
        }
    }

    assert.deepEqual(violations, [])
    assert.doesNotMatch(source, /queue-wal-checkpoint-switch-mirror/)
    assert.doesNotMatch(source, /compatMirror|mirrorSaved|mirrorMetricPath/)
})

test('coordinator authority ordinary mutations fail closed when not WAL backed', () => {
    const source = readRepoFile('shared/js/sw.js')
    const applyLockedBody = extractFunction(source, 'async function applyLocked(operation = {})')

    assert.match(applyLockedBody, /shouldUseCoordinatorQueueWalBackend\(operationKind, reason\)/)
    assert.match(applyLockedBody, /coordinatorAuthority\.nonWalOperationRejected/)
    assert.match(applyLockedBody, /reason: 'non-wal-authority-operation'/)
    assert.match(applyLockedBody, /accepted: false/)
    assert.doesNotMatch(applyLockedBody, /backend: 'snapshot'/)
})

test('queue-counts reads the dashboard rendered counts and sends no message and writes nothing', () => {
    const source = readRepoFile('tools/cdp/queue-counts.js')
    assert.match(source, /document\.getElementById/)
    assert.match(source, /queuedCount/)
    assert.doesNotMatch(source, /chrome\.storage/, 'queue-counts must not read storage: the queue view is not on disk')
    assert.doesNotMatch(source, /sendMessage|refresh-coordinator-dashboard-views/, 'queue-counts must not start the outlier pass')
})

test('routine CDP queue status helpers use compact storage by default', () => {
    const compactHelpers = [
        'tools/cdp/current-work-filter.js',
        'tools/cdp/active-queue-rows.js',
        'tools/cdp/queue-failures.js'
    ]
    for(const helperPath of compactHelpers) {
        const source = readRepoFile(helperPath)
        assert.match(source, /COORDINATOR_QUEUE_VIEW_KEY/)
        assert.match(source, /usedCompactView/)
        assert.doesNotMatch(source, /mbCoordinatorQueue:/, `${helperPath} reads full queue by default`)
        assert.doesNotMatch(source, /mbProfileNukeProgress/, `${helperPath} reads full progress by default`)
    }

    const summary = readRepoFile('tools/cdp/queue-storage-summary.js')
    assert.match(summary, /parseBooleanOption\('include-full'\)/)
    assert.match(summary, /COORDINATOR_QUEUE_VIEW_KEY/)
    assert.match(summary, /usedCompactView: !includeFullRead/)
    assert.doesNotMatch(summary, /chrome\.storage\.local\.get\(\{[\s\S]*mbCoordinatorQueue:/)
    assert.doesNotMatch(summary, /chrome\.storage\.local\.get\(\{[\s\S]*mbProfileNukeProgress:/)
    assert.match(summary, /if\(includeFullRead\) \{[\s\S]*defaults\[names\.queue\] = \{\}/)
    assert.doesNotMatch(summary, /defaults\.mbProfileNukeProgress = \{\}/)
})

test('live CDP queue helpers resolve auto extension ids before picking extension targets', () => {
    const helpers = [
        'tools/cdp/open-dashboard.js',
        'tools/cdp/dashboard-state.js',
        'tools/cdp/probe-extension-storage.js',
        'tools/cdp/queue-failures.js',
        'tools/cdp/inspect-queue-item.js',
        'tools/cdp/queue-summary.js'
    ]

    for(const helperPath of helpers) {
        const source = readRepoFile(helperPath)
        assert.match(source, /resolveCdpConfig/)
        assert.match(source, /await resolveCdpConfig\(getCdpConfig\(\)\)/)
        assert.doesNotMatch(source, /const config = getCdpConfig\(\)/)
        assert.doesNotMatch(source, /chrome-extension:\/\/auto\//)
    }
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
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const contentPageStateProjectionSource = readRepoFile('shared/js/swContentPageStateProjection.js')
    const swScopedBody = extractFunction(sw, 'async function getContentPageCoordinatorState(request = {}, sender = {})')
    const queueFallbackBody = extractFunction(sw, 'async function loadScopedCoordinatorQueueFallbackForContentPage(request = {}, profileHrefSet = new Set())')
    const shouldQueueFallbackBody = extractFunction(contentPageStateProjectionSource, 'function shouldLoadFullQueueForTruncatedContentPageState(queueIndex = null, request = {}, profileHrefs = [], scopedQueue = {})')
    const sourceRecordsBody = extractFunction(contentPageStateProjectionSource, 'function normalizeCoordinatorContentSourceIndexRecords(shards = {}, request = {})')
    const pendingRefreshBody = extractFunction(content, 'function scheduleProfileSearchPendingRefresh(delayMs = PROFILE_SEARCH_PENDING_REFRESH_MS)')
    const syncBody = extractFunction(content, 'function syncProfileSearchControls()')
    const nukeBody = extractFunction(content, 'async function nukeProfileSearchHrefsOnce(button, hrefs = [], options = {})')
    const spaceSyncBody = extractFunction(content, 'function syncSpaceFeedNukeControls()')
    const spaceScopedRefreshBody = extractFunction(content, 'function scheduleSpaceFeedScopedStateRefresh(entries = [])')

    assert.notEqual(searchBranchStart, -1)
    assert.notEqual(searchBranchEnd, -1)
    assert.doesNotMatch(searchBranch, /setStorageChangeListenerEnabled\(true\)/)
    assert.doesNotMatch(searchBranch, /addListener\(onStorageChanged\)/)
    assert.doesNotMatch(searchBranch, /refreshCoordinatorQueueFromStorage\(\)/)
    assert.doesNotMatch(searchBranch, /refreshProfileNukeProgressFromStorage\(\)/)
    assert.match(searchBranch, /refreshContentPageCoordinatorStateFromRuntime\(\{force: true\}\)/)
    assert.doesNotMatch(content, /const PROFILE_NUKE_PROGRESS_KEY = 'mbProfileNukeProgress'/)
    assert.doesNotMatch(content, /const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'/)
    assert.doesNotMatch(content, /safeStorageGet\(\{\[PROFILE_NUKE_PROGRESS_KEY\]: \{\}\}\)/)
    assert.doesNotMatch(content, /safeStorageGet\(\{\[COORDINATOR_QUEUE_KEY\]: \{\}\}\)/)
    assert.match(scheduleBody, /await refreshContentPageCoordinatorStateFromRuntime\(\)/)
    assert.match(refreshBody, /action: 'get-content-page-coordinator-state'/)
    assert.match(refreshBody, /profileHrefs/)
    assert.match(pendingRefreshBody, /refreshContentPageCoordinatorStateFromRuntime\(\{force: true\}\)/)
    assert.match(pendingRefreshBody, /syncProfileSearchControls\(\)/)
    assert.match(syncBody, /pendingSearchCount > 0[\s\S]*scheduleProfileSearchPendingRefresh\(\)/)
    assert.match(nukeBody, /outcome\.settled[\s\S]*scheduleProfileSearchPendingRefresh\(\)/)
    assert.match(spaceSyncBody, /const entries = timedSpaceQuery\('phase\.latestRead', \(\) => getLatestSpaceFeedEntries\(\)\)[\s\S]*scheduleSpaceFeedScopedStateRefresh\(entries\)[\s\S]*buildSpaceFeedRenderModel/)
    assert.match(spaceScopedRefreshBody, /refreshContentPageCoordinatorStateFromRuntime\(\{[\s\S]*force: true,[\s\S]*entries: scopedEntries/)
    assert.match(spaceScopedRefreshBody, /syncSpaceFeedNukeControls\(\)/)
    assert.match(listenerBody, /source\.addListener\(onStorageChanged\)/)
    assert.match(listenerBody, /source\.removeListener\?\.\(onStorageChanged\)/)
    assert.match(navigationBody, /setStorageChangeListenerEnabled\(page !== 'profile-search'\)/)
    assert.match(bootstrap, /request\.action === 'get-content-page-coordinator-state'/)
    // 2026-10-07: COORDINATOR_CONTENT_QUEUE_INDEX_KEY (the full-queue blob,
    // confirmed live at 1.09MB avg on a ~1100-row backlog) is no longer
    // fetched here at all -- replaced with per-profileHref shards
    // (getCoordinatorContentQueueIndexShardDefaults), mirroring the
    // already-proven progress-shard/source-shard pattern. The old key is
    // still written (see the second test below) for other tests'/consumers'
    // sake, just no longer read by this hot per-request path.
    assert.doesNotMatch(swScopedBody, /\[COORDINATOR_CONTENT_QUEUE_INDEX_KEY\]: null/)
    assert.match(swScopedBody, /getCoordinatorContentQueueIndexShardDefaults\(profileHrefs\)/)
    assert.match(swScopedBody, /normalizeCoordinatorContentQueueIndexShardRecords\(/)
    assert.match(swScopedBody, /hasMissingRequestedCoordinatorQueueIndexShard\(queueShardDefaults, stored\)/)
    // Owner 601f 1a: the index shards come from the derived cache, not storage, and the progress view from the resident copy.
    assert.match(swScopedBody, /readResidentDerivedQueueIndex\(\{/)
    assert.doesNotMatch(swScopedBody, /metricStorageGet\(\{\s*\.\.\.sourceShardDefaults/)
    assert.match(swScopedBody, /readResidentCoordinatorStored\(\{[\s\S]*\[PROFILE_NUKE_PROGRESS_VIEW_KEY\]: null/)
    assert.doesNotMatch(swScopedBody, /\[COORDINATOR_QUEUE_KEY\]: \{\}/)
    assert.doesNotMatch(swScopedBody, /\[PROFILE_NUKE_PROGRESS_KEY\]: \{\}/)
    assert.match(swScopedBody, /getCoordinatorContentSourceIndexShardDefaults\(request\)/)
    assert.match(swScopedBody, /normalizeCoordinatorContentSourceIndexRecords\(/)
    assert.match(swScopedBody, /Object\.assign\(scopedQueue, sourceQueue\)/)
    assert.match(swScopedBody, /shouldLoadFullQueueForTruncatedContentPageState\(\{truncated: true\}, request, profileHrefs, scopedQueue\)/)
    assert.match(swScopedBody, /loadScopedCoordinatorQueueFallbackForContentPage\(request, profileHrefSet\)/)
    assert.match(shouldQueueFallbackBody, /queueIndex\?\.truncated !== true/)
    assert.doesNotMatch(shouldQueueFallbackBody, /requestSourcePageUrl \|\| requestSearchQuery/)
    assert.match(sourceRecordsBody, /getCoordinatorContentSourceKeysForRequest\(request\)/)
    assert.match(queueFallbackBody, /coordinatorQueueReader\.full\(\{[\s\S]*contentPageState\.queueFallback\.truncated/)
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
    const profileNukeProgressSource = readRepoFile('shared/js/swProfileNukeProgress.js')
    const coordinatorContentQueueIndexSource = readRepoFile('shared/js/swCoordinatorContentQueueIndex.js')
    const queueIndexBody = extractFunction(coordinatorContentQueueIndexSource, 'function buildCoordinatorContentQueueIndex(queue = {}, nowMs = now())')
    const sourceIndexBody = extractFunction(coordinatorContentQueueIndexSource, 'function buildCoordinatorContentSourceIndexShardPayload(queue = {}, nowMs = now())')
    const coordinatorQueueViewSource = readRepoFile('shared/js/swCoordinatorQueueView.js')
    const queueViewBody = extractFunction(coordinatorQueueViewSource, 'function buildCoordinatorQueueView(queue = {}, nowMs = now(), options = {})')
    const progressViewBody = extractFunction(profileNukeProgressSource, 'function buildProfileNukeProgressView(progress = {}, nowMs = now())')
    const progressSummaryBody = extractFunction(profileNukeProgressSource, 'function summarizeProfileNukeProgressRecord(profileHref = \'\', record = {})')
    const progressFilterBody = extractFunction(profileNukeProgressSource, 'function filterProfileNukeProgressForContentProjection(progress = {}, queue = {})')
    const contentPageStateProjectionSource = readRepoFile('shared/js/swContentPageStateProjection.js')
    const missingBody = extractFunction(contentPageStateProjectionSource, 'function isContentPageStateProjectionMissing(queueIndex = null, progressView = null, shardDefaults = {}, stored = {}, sourceShardDefaults = {})')
    const rebuildBody = extractFunction(sw, "async function rebuildContentPageStateProjectionFromCurrentState(reason = 'missing')")
    const repairBody = extractFunction(sw, 'function repairProfileProgressProjection(options = {})')

    assert.match(readRepoFile('shared/js/storageKeys.js'), /COORDINATOR_CONTENT_QUEUE_INDEX_KEY: 'mbCoordinatorContentQueueIndex'/)
    assert.match(readRepoFile('shared/js/storageKeys.js'), /COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX: 'mbCoordinatorContentSourceIndex\.'/)
    assert.match(readRepoFile('shared/js/storageKeys.js'), /PROFILE_NUKE_PROGRESS_VIEW_KEY: 'mbProfileNukeProgressView'/)
    assert.match(readRepoFile('shared/js/storageKeys.js'), /PROFILE_NUKE_PROGRESS_SHARD_PREFIX: 'mbProfileNukeProgressShard\.'/)
    assert.doesNotMatch(sw, /const PROFILE_NUKE_PROGRESS_SHARD_PREFIX =/)
    assert.doesNotMatch(metricSetBody, /addContentPageStateProjectionPayload/)
    assert.match(metricSetBody, /rawQueueKeyStorageSetRejected/)
    // 2026-10-02: this used to also assert buildCoordinatorQueueView( here --
    // that call site unconditionally re-populated the on-disk
    // mbCoordinatorQueueView key on every full-queue write, missed during the
    // 2026-10-01 removal of all on-disk queue-view persistence. The WAL's
    // auto-recovery-from-view path then read that stale/mismatched snapshot
    // back in as "the truth" on the next hydrate failure, reintroducing old
    // row states over a live WAL that had moved on (confirmed live:
    // reappearing queue rows and up to 3 concurrently active tabs).
    // The full-queue write path (addContentPageStateProjectionPayload) is removed with the raw queue key branch, so nothing in the
    // progress module builds a view, an index or a checkpoint for a full-queue write any more.
    assert.doesNotMatch(profileNukeProgressSource, /addContentPageStateProjectionPayload/)
    assert.doesNotMatch(profileNukeProgressSource, /buildCoordinatorQueueView\(/)
    // 601f 1a: a full-queue write no longer adds the content index or its shards. They are derived on read.
    assert.doesNotMatch(profileNukeProgressSource, /buildCoordinatorContentQueueIndex\(/)
    assert.doesNotMatch(profileNukeProgressSource, /buildCoordinatorContentQueueIndexShardPayload\(/)
    assert.doesNotMatch(profileNukeProgressSource, /buildCoordinatorContentSourceIndexShardPayload\(/)
    assert.match(sw, /function readResidentDerivedQueueIndex\(defaults = \{\}\) \{/)
    assert.match(sw, /function getResidentDerivedQueueIndexPayload\(\) \{[\s\S]*residentDerivedQueueIndex\.queue !== queue/)
    assert.doesNotMatch(rebuildBody, /metricStorageSet\(\{\s*\[COORDINATOR_CONTENT_QUEUE_INDEX_KEY\]/)
    assert.doesNotMatch(sw, /scheduleDeferredCoordinatorContentIndexRebuild|runDeferredCoordinatorContentIndexRebuild/)
    assert.doesNotMatch(profileNukeProgressSource, /PROFILE_NUKE_PROGRESS_KEY/)
    assert.match(sourceIndexBody, /getCoordinatorContentSourceKeysForItem\(item\)/)
    assert.match(queueViewBody, /authoritativeCounts/)
    assert.doesNotMatch(sw, /MAX_COORDINATOR_QUEUE_VIEW_ITEMS/)
    assert.doesNotMatch(queueViewBody, /\.slice\(0, MAX_COORDINATOR_QUEUE_VIEW_ITEMS\)/)
    assert.match(queueViewBody, /itemLimit: items.length/)
    assert.match(queueViewBody, /truncated: false/)
    assert.match(queueIndexBody, /MAX_COORDINATOR_CONTENT_QUEUE_INDEX_ITEMS/)
    assert.match(progressViewBody, /MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS/)
    assert.match(progressSummaryBody, /blockAttemptedAt/)
    assert.match(progressSummaryBody, /muteAttemptedAt/)
    assert.match(progressFilterBody, /hasNonterminalCoordinatorAuthorityForProfile\(queue, profileHref\)/)
    assert.match(progressFilterBody, /isTerminalProfileNukeRecord\(record\)/)
    assert.match(missingBody, /hasMissingRequestedCoordinatorSourceShard\(queueIndex, sourceShardDefaults, stored\)/)
    assert.match(missingBody, /hasMissingRequestedProfileProgressShard\(progressView, shardDefaults, stored\)/)
    assert.match(rebuildBody, /coordinatorQueueReader\.full\(\{[\s\S]*contentPageState\.rebuild/)
    assert.doesNotMatch(rebuildBody, /\[COORDINATOR_QUEUE_KEY\]: \{\}/)
    // The progress keys belong to the door: the rebuild only calls repairProfileProgressProjection, which reads the view
    // and every shard, filters them against the resident queue, and writes only the keys whose content changed.
    assert.doesNotMatch(rebuildBody, /PROFILE_NUKE_PROGRESS_VIEW_KEY|getProfileNukeProgressRecordsFromProjection|filterProfileNukeProgressForContentProjection|persistCoordinator\(/)
    assert.match(rebuildBody, /coordinatorAuthority\.repairProfileProgressProjection\(\{/)
    assert.match(repairBody, /\[PROFILE_NUKE_PROGRESS_VIEW_KEY\]: null/)
    assert.match(repairBody, /getAllProfileNukeProgressShardDefaults\(\)/)
    assert.match(repairBody, /filterProfileNukeProgressForContentProjection\(\s*getProfileNukeProgressRecordsFromProjection\(stored\),\s*projection\.queue\s*\)/)
    assert.match(repairBody, /getChangedProfileNukeProgressProjectionKeys\(stored, derived\)/)
    assert.match(repairBody, /runExclusiveOnApplyTail\(/)
    assert.doesNotMatch(repairBody, /coordinatorQueueReader\.full/)
    assert.doesNotMatch(rebuildBody, /PROFILE_NUKE_PROGRESS_KEY|normalizeStoredProfileNukeProgress/)
    assert.match(rebuildBody, /sourceShards/)
    assert.match(rebuildBody, /progressShards/)
    assert.match(rebuildBody, /queueIndexShards/)
    assert.match(rebuildBody, /buildCoordinatorContentQueueIndexShardPayload\(queue\)/)
    assert.match(rebuildBody, /contentPageState\.rebuild/)
    assert.doesNotMatch(rebuildBody, /contentPageState\.compatBuild/)
})

test('terminal/direct progress compatibility save retry path is deleted', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const progressRecordsBody = extractFunction(sw, 'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})')

    assert.doesNotMatch(sw, /function scheduleTerminalProgressCompatibilitySave/)
    assert.doesNotMatch(sw, /function scheduleDirectProgressCompatibilitySave/)
    assert.doesNotMatch(sw, /terminal-progress-compatibility-save/)
    assert.doesNotMatch(sw, /direct-progress-compatibility-save/)
    assert.doesNotMatch(sw, /compatibility-save-failed/)
    assert.doesNotMatch(progressRecordsBody, /compatibilitySave/)
    assert.doesNotMatch(progressRecordsBody, /scheduleCoordinatorReconcile\(1000, \{[\s\S]*inline-compatibility-save-failed/)
    assert.match(progressRecordsBody, /saveProfileNukeProgressRowProjection\([\s\S]*inlineProgressProjectionRecords/)
    assert.doesNotMatch(progressRecordsBody, /PROFILE_NUKE_PROGRESS_KEY/)
})

test('snapshot state writes carry inventoried authority reasons', () => {
    const source = readRepoFile('shared/js/sw.js')
    const storageMetrics = readRepoFile('shared/js/swStorageMetrics.js')
    const inventory = readRepoFile('storage-authority-callsite-inventory-2026-05-20.md')
    const allowedReasons = new Set([
        'ordinaryMutation',
        'reconcile',
        'displayRead',
        'checkpointSwitch',
        'compaction',
        'userMemoryNonAuthority'
    ])
    const callSites = collectCallSites(source, 'saveCoordinatorState')

    assert.ok(callSites.length > 0)
    assert.match(storageMetrics, /SNAPSHOT_WRITE_REASONS/)
    assert.match(storageMetrics, /snapshot\.write\.reason\.\$\{normalizedReason\}/)

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
    const storageSource = readRepoFile('shared/js/swstorage.js')
    const adapterBody = extractFunction(storageSource, 'function createChromeLocalStorageAdapter(getStorageArea)')
    const metricGetBody = extractFunction(source, 'async function metricStorageGet(defaults = {}, options = {})')
    const metricSetBody = extractFunction(source, 'async function metricStorageSet(payload = {}, options = {})')
    const suppressBody = extractFunction(storageSource, 'function suppressAbandonedStorageOperation(operation = \'storage\')')
    const nonAdapterSource = source.replace(
        /const rawCoordinatorStorageAdapter = createChromeLocalStorageAdapter\(\(\) => namespaceArea\(browser\.storage\.local\)\)/,
        ''
    )

    // The one raw adapter is wrapped by the guard the erase closes, and every local write goes through the wrapper.
    assert.match(source, /const rawCoordinatorStorageAdapter = createChromeLocalStorageAdapter\(\(\) => namespaceArea\(browser\.storage\.local\)\)/)
    assert.match(source, /const coordinatorStorageAdapter = \{\n    get: defaults => rawCoordinatorStorageAdapter\.get\(defaults\),\n    set: payload => getStorageWriteRefusal\(\) \|\| rawCoordinatorStorageAdapter\.set\(payload\)/)
    assert.match(adapterBody, /getStorageArea\(\)\.get\(defaults\)/)
    assert.match(adapterBody, /getStorageArea\(\)\.set\(payload\)/)
    assert.match(adapterBody, /getStorageArea\(\)\.remove\(keys\)/)
    assert.match(adapterBody, /getBytesInUse\(keys/)
    assert.match(suppressBody, /isStorageUpdateAbandoned\(\)/)
    assert.match(suppressBody, /storageUpdate\.lateWriteSuppressed/)
    assert.match(metricGetBody, /coordinatorStorageAdapter\.get\(defaults\)/)
    assert.doesNotMatch(metricGetBody, /suppressAbandonedStorageOperation\('storageGet-/)
    // Every write is a disk write unless it names the session area (owner decision 26 Oct: the queue-wakeup metrics view).
    assert.match(metricSetBody, /options\.storageArea === 'session' \? sessionStorageAdapter : coordinatorStorageAdapter/)
    assert.match(metricSetBody, /writeAdapter\.set\(diskPayload\)/)
    assert.match(metricSetBody, /suppressAbandonedStorageOperation\('storageSet'\)/)
    assert.match(source, /const sessionStorageAdapter = \{\n    get: defaults => \{\n        const area = namespaceArea\(browser\.storage\.session\)/)
    // The metrics record and its view are flushed and loaded through the session adapter only.
    const flushBody = extractFunction(source, 'async function flushQueueWakeupMetrics(options = {})')
    const loadMetricsBody = extractFunction(source, 'async function loadQueueWakeupMetrics()')
    assert.match(flushBody, /sessionStorageAdapter\.set\(/)
    assert.doesNotMatch(flushBody, /coordinatorStorageAdapter/)
    assert.match(loadMetricsBody, /sessionStorageAdapter\.get\(/)
    assert.doesNotMatch(loadMetricsBody, /coordinatorStorageAdapter/)
    assert.doesNotMatch(nonAdapterSource, /browser\.storage\.local/)
})

test('coordinator projection mutation uses explicit operation shapes', () => {
    const source = readRepoFile('shared/js/sw.js')
    const eventsSource = readRepoFile('shared/js/swQueueMachineEvents.js')
    const dispatcherSource = readRepoFile('shared/js/swQueueMachineDispatcher.js')
    const handlersSource = readRepoFile('shared/js/swQueueMachineHandlers.js')
    const lintSource = readRepoFile('tools/lint-sw-queue-boundary.js')

    assert.doesNotMatch(source, /async function mutateCoordinatorProjection\(operation = \{\}\)/)
    assert.match(source, /createQueueMachineEventDispatcher/)
    assert.match(source, /createCoordinatorQueueMachineEventHandlers/)
    assert.match(source, /async function applyCoordinatorQueueMachineEvent\(event = \{\}, operation = \{\}\)/)
    assert.match(dispatcherSource, /normalizeQueueMachineEventType/)
    assert.match(dispatcherSource, /unsupported-queue-machine-event/)
    assert.match(dispatcherSource, /unhandled-queue-machine-event/)
    for(const eventType of [
        'COORDINATOR_ITEMS_ENQUEUE',
        'TAB_OPENED',
        'TAB_OPEN_TIMEOUT',
        'ACTIVE_MISSING_TAB',
        'ACTIVE_TERMINAL_PROGRESS',
        'ACTIVE_NON_PROFILE_LANDING',
        'ACTIVE_PROFILE_REDIRECT_MISMATCH',
        'KEY_ONLY_TERMINATE',
        'PROGRESS_PATCH_RECORD',
        'PROFILE_RESOLUTION_UNRESOLVED',
        'ROW_EVENTS_APPLY',
        'EXHAUSTED_ROLLBACK_RECOVER',
        'EXHAUSTED_ROLLBACK_SETTLE',
        'EXHAUSTED_ROLLBACK_TERMINATE',
        'SLOT_AVAILABLE',
        'TERMINAL_COORDINATOR_ITEMS_SETTLE'
    ]) {
        assert.match(eventsSource, new RegExp(`${eventType}: '${eventType}'`))
        assert.match(handlersSource, new RegExp(`QUEUE_MACHINE_EVENT_TYPES\\.${eventType}`))
    }
    assert.match(handlersSource, /requireQueueMachineCapability\('durable', durable, 'mutateCoordinatorQueuedTabActiveTransition'\)/)
    assert.match(handlersSource, /requireQueueMachineCapability\('runtime', runtime, 'recoverPendingTabActionFromCoordinatorQueue'\)/)
    assert.match(handlersSource, /requireQueueMachineCapability\('projection', projection, 'planQueuedActivationIntentForSlotEvent'\)/)
    assert.match(handlersSource, /requireQueueMachineCapability\('projection', projection, 'reprimeQueuedTabActionsForNoOpenEvent'\)/)
    assert.match(handlersSource, /requireQueueMachineCapability\('durable', durable, 'terminateActiveCoordinatorNonProfileLanding'\)/)
    assert.match(handlersSource, /requireQueueMachineCapability\('durable', durable, 'terminateActiveCoordinatorProfileRedirectMismatch'\)/)
    assert.match(handlersSource, /requireQueueMachineCapability\('durable', durable, 'terminateDurableActiveCoordinatorItemFromTerminalProgress'\)/)
    assert.doesNotMatch(handlersSource, /requireQueueMachineCapability\('durable', durable, 'terminalize[A-Za-z0-9_]+'\)/)
    assert.doesNotMatch(handlersSource, /queuedTabActions|activeQueuedTabs|pendingTabActions|queuedTabMetadata|getQueuedTabActionKey|incrementQueueWakeupMetric/)
    assert.match(lintSource, /direct queue-machine helper call outside allowed boundary/)
    assert.match(lintSource, /queue-machine handler accesses volatile\/projection internals directly/)

})

test('fill loop obtains activation intent through queue-machine slot event', () => {
    const source = readRepoFile('shared/js/sw.js')
    const fillBody = extractFunction(source, 'async function fillQueuedTabsOnce(options = {})')
    const slotPlannerBody = extractFunction(source, 'async function planQueuedActivationIntentForSlotEvent(event = {})')

    assert.match(fillBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'SLOT_AVAILABLE'[\s\S]*source: 'fillQueuedTabsOnce'/)
    assert.doesNotMatch(fillBody, /queueRuntime\.consumeActivationIntent\(/)
    assert.match(slotPlannerBody, /queueRuntime\.consumeActivationIntent\(\)/)
    assert.match(slotPlannerBody, /queueRuntime\.requeueActivationIntent\(next/)
    assert.match(slotPlannerBody, /hasQueuedActivationGuard\(next\)/)
})

test('stale-attempt diagnostics go straight to the flight recorder, not the persisted queue (events design, B9a)', () => {
    const source = readRepoFile('shared/js/sw.js')
    const diagnosticBody = extractFunction(source, 'async function recordStaleAttemptDiagnostic(details = {})')
    assert.match(diagnosticBody, /recordFlightRecorderEvent\(coordinatorEventToFlightRecorderEntry\(event\)\)/)
    assert.doesNotMatch(diagnosticBody, /pendingCoordinatorDiagnosticEvents/)
    assert.doesNotMatch(diagnosticBody, /enqueueSpaceFeedStorageUpdate\(async \(\) =>/)
})

test('progress repair is explicit, not a hot runtime path', () => {
    const source = readRepoFile('shared/js/sw.js')
    const recoveryBody = extractFunction(source, 'async function recoverStoredCoordinatorWorkOnce(reason = \'stored-work-recovery\', options = {})')
    const reconcileBody = extractFunction(source, 'async function runCoordinatorReconcileTickOnce(reason = \'coordinator-reconcile\', options = {})')
    const storageReconcileBody = extractFunction(source, 'async function reconcileCoordinatorStorage(options = {})')
    const storageReconcileBestEffortBody = extractFunction(source, 'async function reconcileCoordinatorStorageBestEffort(options = {})')
    const retryBody = extractFunction(source, 'async function retryCoordinatorFailedItems(request = {}, sender = {})')
    const scheduledTickBody = extractFunction(source, 'async function runScheduledCoordinatorReconcileTick(reason = \'coordinator-reconcile-tick\')')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const retryCandidatesSource = readRepoFile('shared/js/swCoordinatorRetryCandidates.js')
    const ownedResultIndex = recoveryBody.indexOf('makeStoredWorkRecoveryResumeOwnedResult(reason, hasWork, paused)')

    assert.match(source, /COORDINATOR_RECONCILE_GATE_TIMEOUT_MS/)
    assert.match(source, /COORDINATOR_RESUME_GATE_TIMEOUT_MS/)
    assert.match(source, /COORDINATOR_STORED_WORK_RESTORE_TIMEOUT_MS/)
    assert.match(source, /async function reconcileCoordinatorStorageBestEffort/)
    assert.match(source, /async function recoverStoredCoordinatorWork/)
    assert.match(source, /async function runCoordinatorReconcileTick/)
    assert.match(source, /coordinator storage reconcile/)
    assert.match(source, /coordinator queue resume/)
    assert.match(source, /coordinator stored-work restore/)
    assert.match(storageReconcileBody, /reason: options\.reason \|\| 'reconcile-coordinator-storage'/)
    assert.match(storageReconcileBody, /timeoutMs: options\.timeoutMs \|\| QUEUE_CRITICAL_STORAGE_UPDATE_TIMEOUT_MS/)
    assert.match(storageReconcileBody, /reconcileCoordinatorStorageLocked\(options\)/)
    assert.match(storageReconcileBestEffortBody, /reconcileCoordinatorStorage\(\{[\s\S]*timeoutMs: options\.storageUpdateTimeoutMs \|\| QUEUE_CRITICAL_STORAGE_UPDATE_TIMEOUT_MS/)
    assert.match(storageReconcileBestEffortBody, /promiseWithTimeout\([\s\S]*timeoutMs,[\s\S]*'coordinator storage reconcile'/)
    assert.doesNotMatch(storageReconcileBestEffortBody, /legacyImport|importLegacy/)
    assert.match(reconcileBody, /observeCoordinatorReconcileSnapshot/)
    assert.match(reconcileBody, /runCoordinatorAuthorityReconcileActions/)
    assert.match(reconcileBody, /recoverStoredCoordinatorWorkOnce/)
    assert.notEqual(ownedResultIndex, -1)
    assert.doesNotMatch(recoveryBody, /\brepair\b/)
    assert.doesNotMatch(reconcileBody, /result\?\.repair/)
    assert.doesNotMatch(scheduledTickBody, /result\?\.repair/)
    assert.match(scheduledTickBody, /const reconcile = result\?\.reconcile \|\| \{\}/)
    assert.match(scheduledTickBody, /const reconcileChanged = result\?\.recovered === true/)
    assert.doesNotMatch(recoveryBody, /reconcileCoordinatorStorageBestEffort/)
    assert.doesNotMatch(recoveryBody, /forceRepairBeforeResume/)
    assert.doesNotMatch(reconcileBody, /reconcileCoordinatorStorageBestEffort/)
    assert.match(recoveryBody, /COORDINATOR_PAUSED_KEY/)
    assert.match(recoveryBody, /reason: paused \? 'coordinator-paused'/)
    // makeStoredWorkRecoveryResumeOwnedResult moved to
    // swCoordinatorRetryCandidates.js in decomposition Slice 29.
    assert.match(retryCandidatesSource, /function makeStoredWorkRecoveryResumeOwnedResult/)
    assert.match(retryCandidatesSource, /resume: \{skipped: true, reason: 'resume-owned-by-reconcile'\}/)
    assert.doesNotMatch(recoveryBody, /resumeCoordinatorQueueExecution\(/)
    assert.match(source, /runCoordinatorReconcileTick\(reason, \{[\s\S]*allowBeforeQuora: true/)
    assert.match(bootstrap, /request\.action === 'reconcile-coordinator-storage'/)
    assert.doesNotMatch(bootstrap, /request\.action === 'repair-coordinator-storage'/)
    assert.match(bootstrap, /request\.action === 'reconcile-coordinator-storage'[\s\S]*display-only-reconcile-disabled/)
    assert.match(bootstrap, /request\.userInitiated !== true/)
    assert.doesNotMatch(bootstrap, /request\.legacyImport/)
    assert.doesNotMatch(bootstrap, /request\.action === 'reconcile-coordinator-storage'[\s\S]{0,450}return recoverStoredCoordinatorWork\('dashboard-reconcile-request'\)/)
    assert.match(bootstrap, /request\.action === 'reconcile-coordinator-storage'[\s\S]*reconcileCoordinatorStorageBestEffort/)
    assert.doesNotMatch(source, /repairScheduled/)
    assert.doesNotMatch(source, /repair: reconcile/)
    assert.match(retryBody, /scheduleCoordinatorReconcile\(1000, \{reason: 'retry-failed-request'\}\)/)
    assert.doesNotMatch(retryBody, /reconcileCoordinatorStorageBestEffort/)
})

test('request action names do not add new repair entrypoints', () => {
    const source = readRepoFile('shared/js/swBootstrap.js')
    const requestActionNames = Array.from(source.matchAll(/request\.action === '([^']+)'/g))
        .map(match => match[1])
    const repairRequestActions = requestActionNames.filter(action => /repair/i.test(action))

    assert.deepEqual(repairRequestActions, [])
    assert.match(requestActionNames.join('\n'), /reconcile-coordinator-storage/)
})

test('scheduler hygiene coalesces reconcile and backs off no-op reconcile ticks', () => {
    const source = readRepoFile('shared/js/sw.js')
    const harness = readRepoFile('test/lib/swHarness.js')
    const bookkeeping = readRepoFile('shared/js/swSchedulerAlarmBookkeeping.js')
    const scheduleReconcileBody = extractFunction(source, 'function scheduleCoordinatorReconcile(delayMs = COORDINATOR_RECONCILE_INTERVAL_MS, options = {})')
    const scheduleResumeBody = extractFunction(source, 'function scheduleCoordinatorQueueResume(delayMs = 500, reason = \'scheduled-resume\')')
    const reconcileTickBody = extractFunction(source, 'async function runScheduledCoordinatorReconcileTick(reason = \'coordinator-reconcile-tick\')')
    const kickBody = extractFunction(source, 'async function kickCoordinatorQueueResume(reason = \'resume-request\', options = {})')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')

    assert.match(source, /COORDINATOR_RECONCILE_BACKOFF_BASE_MS/)
    assert.match(source, /COORDINATOR_RECONCILE_BACKOFF_MAX_MS/)
    assert.match(source, /STALE_SCHEDULER_ALARM_SUPPRESSION_MS/)
    assert.match(source, /SCHEDULER_ALARM_TIME_TOLERANCE_MS/)
    assert.match(bookkeeping, /function isCoordinatorReconcileEdgeTriggerReason/)
    assert.match(bookkeeping, /function getSchedulerAlarmScheduledTime/)
    assert.match(bookkeeping, /function isSchedulerAlarmScheduledForDueAt/)
    assert.match(bookkeeping, /function suppressStaleCoordinatorResumeAlarm/)
    assert.match(bookkeeping, /function suppressStaleCoordinatorReconcileAlarm/)
    assert.doesNotMatch(
        extractFunction(bookkeeping, 'function isCoordinatorReconcileEdgeTriggerReason(reason = \'\')'),
        /\|storage\||\|queued-tab\|/
    )
    assert.match(bookkeeping, /function recordCoordinatorReconcileNoopBackoff/)
    assert.match(scheduleReconcileBody, /reconcile\.coalesced/)
    assert.match(scheduleReconcileBody, /reconcile\.suppressedBackoff/)
    assert.match(scheduleReconcileBody, /reconcile\.edgeTriggered/)
    assert.match(scheduleReconcileBody, /reconcile\.deadlineUpdated/)
    assert.match(scheduleReconcileBody, /scheduler\.pendingDeadlineMs/)
    assert.match(scheduleReconcileBody, /reconcile\.alarmScheduled/)
    assert.doesNotMatch(scheduleReconcileBody, /pump\.alarmScheduled/)
    assert.match(scheduleResumeBody, /pump\.coalesced/)
    assert.match(scheduleResumeBody, /reconcile\.deadlineUpdated/)
    assert.match(scheduleResumeBody, /scheduler\.pendingDeadlineMs/)
    assert.match(scheduleResumeBody, /scheduleCoordinatorResumeAlarm\(dueAt\)/)
    assert.match(scheduleResumeBody, /scheduleCoordinatorResumeAlarm\(coordinatorQueueResumeScheduler\.getDueAt\(\)\)/)
    assert.match(bookkeeping, /function scheduleCoordinatorResumeAlarm\(dueAt = 0\)/)
    assert.match(bookkeeping, /browser\.alarms\.create\(COORDINATOR_RESUME_ALARM_NAME/)
    assert.match(bookkeeping, /pump\.alarmScheduled/)
    assert.match(scheduleResumeBody, /suppressStaleCoordinatorResumeAlarm\(scheduledDueAt\)/)
    assert.match(bootstrap, /isSuppressedStaleCoordinatorResumeAlarm\(alarm\)/)
    assert.match(bootstrap, /isSuppressedStaleCoordinatorReconcileAlarm\(alarm\)/)
    assert.match(bootstrap, /reconcile\.alarmStale/)
    assert.match(bootstrap, /pump\.alarmStale/)
    assert.match(reconcileTickBody, /recordCoordinatorReconcileNoopBackoff\(\)/)
    assert.match(reconcileTickBody, /resetCoordinatorReconcileBackoff\('reconcile-changed'\)/)
    assert.match(kickBody, /coordinatorQueueResumeScheduler\.isAlarmCreatedForCurrentDueAt\(\)/)
    assert.match(harness, /scheduleCoordinatorReconcile,/)
    assert.doesNotMatch(harness, /scheduleStoredWorkRepair,/)
    assert.doesNotMatch(source, /scheduleStoredWorkRepair\(/)
})

test('mbCoordinatorQueueView is never persisted to disk and has no storage-change trigger', () => {
    // 2026-10-01: mbCoordinatorQueueView's disk copy was removed entirely --
    // see refreshCoordinatorQueueViewForDashboard's own comment in sw.js.
    // Pages get it exclusively through the refresh-coordinator-queue-view
    // message response and the coordinator-dashboard-state-changed broadcast,
    // neither of which touches storage, so the storage.onChanged trigger this
    // test used to cover (waking the coordinator when something wrote a
    // queue-view claiming stored work) has nothing left to fire on.
    const source = readRepoFile('shared/js/sw.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')

    assert.doesNotMatch(source, /async function hasUnpausedStoredCoordinatorWorkInQueueView/)
    assert.doesNotMatch(source, /async function refreshStaleCompactQueueViewIfNeeded/)
    assert.match(source, /async function shouldAllowStoredWorkBeforeQuora/)
    assert.doesNotMatch(bootstrap, /changes\?\.\[COORDINATOR_QUEUE_VIEW_KEY\]\?\.newValue/)
    assert.doesNotMatch(bootstrap, /'storage-queue-view-changed'/)
})

test('storage change listener does not read the progress view or the full progress blob (decision 2; 20 Oct review)', () => {
    const source = readRepoFile('shared/js/sw.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    // D4: the storage.onChanged body is a named function (the listener only gates and dispatches to it).
    const listenerStart = bootstrap.indexOf('function handleStorageChanged(changes, areaName) {')
    const listenerEnd = bootstrap.indexOf('browser.runtime.onMessage.addListener', listenerStart)
    const listenerBody = bootstrap.slice(listenerStart, listenerEnd)
    const scopedBody = extractFunction(source, 'async function getContentPageCoordinatorState(request = {}, sender = {})')

    assert.doesNotMatch(listenerBody, /PROFILE_NUKE_PROGRESS_VIEW_KEY/)
    assert.doesNotMatch(listenerBody, /normalizeStoredProfileNukeProgress\(changes\[PROFILE_NUKE_PROGRESS_KEY\]/)
    assert.doesNotMatch(listenerBody, /enqueueCoordinatorProgressSync\(changedProgress\)/)
    assert.match(scopedBody, /getProfileNukeProgressShardDefaults\(profileHrefs\)/)
    assert.match(scopedBody, /normalizeProfileNukeProgressShardRecords/)
})

test('active queued jobs have a wall-clock cap', () => {
    const source = readRepoFile('shared/js/sw.js')
    const contentSource = readRepoFile('shared/js/content.js')
    const sweepBody = extractFunction(source, 'async function sweepStaleQueuedTabs(parentTabId = null, options = {})')
    const reconcileDecisionBody = extractFunction(
        readRepoFile('shared/js/swQueuedTabRetryStaleReconcile.js'),
        'function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = \'\', liveProfileTabsByHref = new Map(), now = getNow())'
    )

    assert.match(source, /COORDINATOR_ACTIVE_JOB_MAX_MS = 45000/)
    assert.match(source, /COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS = 60000/)
    assert.match(readRepoFile('shared/js/tunables.js'), /STALE_QUEUED_TAB_MAX_RETRIES: 1,/)
    assert.match(contentSource, /ACTION_LEASE_WAIT_MS = 45000/)
    const activeQueuedTabStalenessSource = readRepoFile('shared/js/swActiveQueuedTabStaleness.js')
    assert.match(activeQueuedTabStalenessSource, /function getActiveQueuedTabStartedAt/)
    assert.match(activeQueuedTabStalenessSource, /function getActiveQueuedTabActionPhaseStartedAt/)
    assert.match(activeQueuedTabStalenessSource, /function getActiveQueuedTabAgeAnchor/)
    assert.match(sweepBody, /activeAgeExpired/)
    assert.match(sweepBody, /getActiveQueuedTabAgeAnchor/)
    assert.match(sweepBody, /Queued tab exceeded the active job time limit/)
    assert.match(reconcileDecisionBody, /activeAgeExpired/)
    assert.match(reconcileDecisionBody, /COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS/)
})

test('queued tab metadata accepts the current attempt before old profile progress', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function validateProgressAttempt(profileHref = \'\', patch = {}, sender = {})'
    )
    const matchingMetadataIndex = body.indexOf('if(metadataAttemptId && metadataAttemptId === incomingAttemptId) return true')
    const storedQueueIndex = body.indexOf('coordinatorQueueReader.item(')
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
        'async function coordinatorItemMatchesTab(item = null, itemKey = \'\', tab = {}, options = {})'
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
    assert.match(matchBody, /isPersistedCoordinatorTabClaimableBySameProfileTab/)
    assert.match(matchBody, /getAttemptIdFromValue\(item\)/)
    assert.match(matchBody, /getAttemptNumberFromValue\(item\)/)
    assert.match(matchBody, /const itemTabId = normalizeTabId\(item\?\.tabId \|\| item\?\.activeTabId \|\| null\)/)
    assert.match(matchBody, /if\(itemTabId && tabId === itemTabId\) \{/)
    assert.match(matchBody, /const observedUrls = getTabObservedUrls\(tab\)/)
    assert.match(matchBody, /if\(!observedUrls\.length \|\| observedUrls\.some\(isBlankOrUncommittedTabUrl\)\) return true/)
    assert.match(source, /async function queuedCoordinatorItemMatchesLiveProfileTabForRecovery/)
    assert.match(source, /queuedCoordinatorItemMatchesLiveProfileTabForRecovery\(item, itemKey, tab\)/)
    assert.match(recoverBody, /getHydratedCoordinatorAuthorityState\('pendingTabAction\.recover\.residentAuthority'\)/)
    assert.match(recoverBody, /coordinatorQueueReader\.full\(\{[\s\S]*metricPath: 'pendingTabAction\.recover\.load'/)
    assert.match(recoverBody, /matchesQueuedRow/)
    assert.match(recoverBody, /queueRuntime\.addActiveQueuedTab\(tabId\)/)
    assert.match(recoverBody, /queueRuntime\.setPendingTabAction\(tabId, action\)/)
    assert.match(recoverBody, /transitionCoordinatorItemForQueuedTab\(action, tab/)
    assert.match(recoverBody, /registerOwnedTab\(ownerTabId, tabId\)/)
    assert.match(recoverBody, /scheduleOwnedBlockedProfileSweep\(ownerTabId, 4000\)/)
    assert.match(recoverBody, /durablyActive: activeTransitioned === true/)
    assert.match(claimBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'RECOVER_PENDING_TAB_ACTION'[\s\S]*sender/)
    assert.match(claimBody, /recovered\?\.action/)
    assert.match(claimBody, /recovered\?\.durablyActive === true/)

    const nudgeBody = extractFunction(
        source,
        'async function nudgeQueuedTabActionClaim(tabId, reason = \'\')'
    )
    assert.match(nudgeBody, /getQueuedExecutorTabWithTimeout\(normalizedTabId, 'nudge-recover-pending-action'\)/)
    assert.match(nudgeBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'RECOVER_PENDING_TAB_ACTION'[\s\S]*tab: tab \|\| \{id: normalizedTabId\}/)
})

test('live queued tab adoption immediately injects and nudges content script', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID, options = {})'
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
    const confirmIndex = body.indexOf('queued tab durable claim pre-confirmation')
    const durableIndex = body.indexOf('transitionCoordinatorItemForQueuedTab(durableClaimAction')
    const returnIndex = body.lastIndexOf('return claimableAction')
    const deniedIndex = body.indexOf('return null')

    assert.notEqual(confirmIndex, -1)
    assert.notEqual(durableIndex, -1)
    assert.notEqual(returnIndex, -1)
    assert.ok(confirmIndex < durableIndex)
    assert.ok(durableIndex < returnIndex)
    assert.match(body, /QUEUED_TAB_DURABLE_CLAIM_TIMEOUT_MS/)
    assert.match(body, /transitionCoordinatorItemForQueuedTab\(durableClaimAction/)
    assert.match(body, /confirmQueuedTabDurablyActive\(durableClaimAction/)
    assert.match(body, /markQueuedTabDurablyActive\(tabId, 'claim-current-profile-tab-action'\)/)
    assert.match(body, /scheduleCoordinatorReconcile\(1000, \{[\s\S]*reason: 'claim-durable-confirmation-failed'[\s\S]*edgeTriggered: true/)
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
    // cleanupQueuedTabMetadataOnly moved to swQueuedTabDetachSurfaceDedupe.js
    // in decomposition Slice 36.
    const metadataOnlyBody = extractFunction(readRepoFile('shared/js/swQueuedTabDetachSurfaceDedupe.js'), 'function cleanupQueuedTabMetadataOnly(tabId)')
    // scheduleQueuedTabReleaseFollowUp moved to swQueuedTabActionBookkeeping.js
    // in decomposition Slice 38.
    const queuedTabActionBookkeepingSource = readRepoFile('shared/js/swQueuedTabActionBookkeeping.js')
    const followUpBody = extractFunction(queuedTabActionBookkeepingSource, 'function scheduleQueuedTabReleaseFollowUp(delayMs = 500)')
    const continuationBody = extractFunction(source, 'function scheduleQueuedWorkContinuation(reason = \'queued-work-continuation\')')
    const missingActiveReleaseBody = extractFunction(source, 'async function reconcileReleasedActiveCoordinatorTab(metadata = null, tabId = null, reason = \'queued-tab-release-missing-active-tab\', options = {})')
    const staleSweepBody = extractFunction(source, 'async function sweepStaleQueuedTabs(parentTabId = null, options = {})')
    const authorityReleaseBody = extractFunction(source, 'async function releaseQueuedTabRuntimeIfAuthorityNotActive(tabId = null, metadata = null, options = {})')
    const blockedSweepBody = extractFunction(source, 'async function sweepOwnedBlockedProfileTabs(parentTabId)')
    const terminalCloseBody = extractFunction(source, 'async function closeTerminalOwnedProfileTabsBody(profileHrefs = [], options = {})')
    const terminalHrefSweepBody = extractFunction(source, 'async function sweepTerminalProfileTabsByAuthority(profileHrefs = [])')
    const orphanProfileSweepBody = extractFunction(source, 'async function sweepProfileTabsWithoutActiveQueueAuthority(options = {})')
    const fillBody = extractFunction(source, 'async function fillQueuedTabsOnce(options = {})')
    const applyBody = extractFunction(source, 'async function runCoordinatorExecutorApplyPhase(reason = \'coordinator-executor-apply\', options = {})')

    assert.match(queuedTabActionBookkeepingSource, /queuedTabReleaseFollowUpTimeout/)
    assert.doesNotMatch(source, /function cleanupQueuedTabState/)
    assert.match(releaseAndCleanupBody, /result = await releaseQueuedTab\(tabId, options\)/)
    assert.match(releaseAndCleanupBody, /if\(!result\?\.rollbackDeferred\) \{[\s\S]*cleanupQueuedTabMetadataOnly\(tabId\)/)
    assert.doesNotMatch(metadataOnlyBody, /releaseQueuedTab/)
    assert.match(releaseBody, /queueRuntime\.deleteActiveQueuedTab\(tabId\)/)
    assert.match(releaseBody, /options\.awaitFill !== true/)
    assert.match(releaseBody, /followUpPromise = scheduleQueuedTabReleaseReconcile\('queued-tab-slot-release'/)
    assert.doesNotMatch(releaseBody, /fillQueuedTabs\(\)/)
    assert.match(releaseReconcileBody, /scheduleCoordinatorQueueResume\(delayMs, reason, \{allowBeforeQuora: true\}\)/)
    assert.match(releaseReconcileBody, /scheduleCoordinatorQueueResume\(delayMs, reason, \{allowBeforeQuora: true\}\)/)
    assert.match(releaseBody, /scheduleQueuedWorkContinuation\('queued-tab-slot-release'\)/)
    assert.match(releaseBody, /shouldDeferQueuedTabReleaseRollback\(metadata\)/)
    assert.match(releaseBody, /job\.releaseRollbackDeferred/)
    assert.match(releaseBody, /releaseRollbackDeferred = true/)
    assert.match(releaseBody, /queueRuntime\.addActiveQueuedTab\(tabId\)/)
    assert.match(releaseBody, /queueRuntime\.setPendingTabAction\(tabId, pendingAction\)/)
    assert.match(releaseBody, /scheduleQueuedWorkContinuation\('release-rollback-deferred'\)/)
    assert.match(releaseBody, /hasActiveQueuedTabActionPhaseProgress\(progressRecord, metadata\)/)
    assert.match(releaseBody, /rollbackFailedQueuedTabOpen\(/)
    assert.match(releaseBody, /reconcileReleasedActiveCoordinatorTab\(/)
    assert.match(missingActiveReleaseBody, /coordinatorQueueReader\.runsProgress\(\{[\s\S]*metricPath: 'queuedTabRelease\.missingActive\.load'/)
    assert.match(missingActiveReleaseBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'ACTIVE_TERMINAL_PROGRESS'/)
    assert.match(missingActiveReleaseBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'ACTIVE_MISSING_TAB'/)
    assert.match(releaseBody, /Promise\.all\(/)
    assert.match(releaseBody, /rollbackDeferred: releaseRollbackDeferred/)
    assert.doesNotMatch(releaseBody, /return fillPromise \|\| followUpPromise \|\| Promise\.resolve\(null\)/)
    assert.match(releaseBody, /const hadQueuedRuntimeState = wasActive \|\| hadPendingAction \|\| !!metadata/)
    assert.match(releaseBody, /else if\(hadQueuedRuntimeState\) \{\s*scheduleQueuedTabReleaseFollowUp\(\)/)
    assert.match(releaseBody, /else if\(hadQueuedRuntimeState\) \{[\s\S]*scheduleCoordinatorQueueResume\(1000, 'queued-tab-release-no-durable-progress', \{[\s\S]*allowBeforeQuora: true/)
    assert.match(releaseBody, /job\.releaseIgnored\.noRuntimeState/)
    assert.match(followUpBody, /scheduleQueuedWorkContinuation\('queued-tab-release'\)/)
    assert.match(continuationBody, /kickCoordinatorQueueResume\(reason, \{[\s\S]*backgroundFastPath: true[\s\S]*allowBeforeQuora: true/)
    assert.match(followUpBody, /scheduleCoordinatorQueueResume\(1000, 'queued-tab-release-follow-up', \{[\s\S]*allowBeforeQuora: true/)
    assert.match(staleSweepBody, /Array\.from\(new Set\(\[[\s\S]*queueRuntime\.listActiveQueuedTabIds\(\)[\s\S]*queueRuntime\.listPendingTabActionTabIds\(\)/)
    assert.match(staleSweepBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'RELEASE_RUNTIME_IF_AUTHORITY_NOT_ACTIVE'[\s\S]*loadAuthorityState: loadRuntimeAuthorityState/)
    assert.match(authorityReleaseBody, /coordinatorQueueReader\.full\(\{[\s\S]*metricPath: 'queuedTabActions\.runtimeAuthority\.load'/)
    assert.match(authorityReleaseBody, /coordinatorItemMatchesQueuedTabRuntime\(item, entry\?\.key \|\| coordinatorKey, effectiveMetadata, normalizedTabId\)/)
    assert.match(authorityReleaseBody, /coordinatorQueuedItemMatchesRuntimeCandidate\(item, entry\?\.key \|\| coordinatorKey, effectiveMetadata, action\)/)
    assert.match(authorityReleaseBody, /transitionCoordinatorItemForQueuedTab\(pendingAction, liveTab \|\| \{id: normalizedTabId\}/)
    assert.match(authorityReleaseBody, /queuedTabActions\.runtimeAuthority\.queuedRowPromoted/)
    assert.match(authorityReleaseBody, /terminalizeActiveCoordinatorItemFromBlockedLiveTab\(/)
    assert.match(authorityReleaseBody, /await getLiveProfileTabsByHref\(\)/)
    assert.match(authorityReleaseBody, /runtime-authority-blocked-live-tab/)
    assert.ok(
        authorityReleaseBody.indexOf('terminalizeActiveCoordinatorItemFromBlockedLiveTab(') <
        authorityReleaseBody.indexOf("detachQueuedTabRuntimeState(normalizedTabId, 'runtime-authority-missing-active-row')")
    )
    assert.match(authorityReleaseBody, /detachQueuedTabRuntimeState\(normalizedTabId, 'runtime-authority-missing-active-row'\)/)
    assert.match(authorityReleaseBody, /releaseCoordinatorActionLeaseForTab\(normalizedTabId, 'runtime-authority-missing-active-row'\)/)
    assert.match(authorityReleaseBody, /browser\.tabs\.remove\(normalizedTabId\)/)
    assert.match(authorityReleaseBody, /scheduleQueuedTabReleaseFollowUp\(100\)/)
    assert.match(authorityReleaseBody, /scheduleQueuedWorkContinuation\('runtime-authority-missing-active-row'\)/)
    assert.match(staleSweepBody, /await releaseQueuedTabAndCleanup\(tabId, \{awaitFill: true\}\)/)
    assert.match(staleSweepBody, /await releaseQueuedTabAndCleanup\(tabId, \{awaitFill: false\}\)/)
    assert.match(blockedSweepBody, /await closeQueuedTabAfterTerminal\(tabId, 'background-blocked-sweep', \{awaitFill: true\}\)/)
    assert.match(extractFunction(source, 'async function closeQueuedTabAfterTerminal(tabId, reason, options = {})'), /await browser\.tabs\.remove\(normalizedTabId\)[\s\S]*releaseQueuedTabAndCleanup\(normalizedTabId, \{awaitFill: options\.awaitFill === true\}\)/)
    assert.match(terminalCloseBody, /getHydratedCoordinatorAuthorityState\('terminalOwnedTabs\.usedResidentAuthority'\)/)
    assert.match(terminalCloseBody, /coordinatorQueueReader\.full\(\{[\s\S]*metricPath: 'terminalOwnedTabs\.load'/)
    assert.doesNotMatch(terminalCloseBody, /ensureProfileNukeProgressReady\(\)/)
    assert.doesNotMatch(terminalCloseBody, /PROFILE_NUKE_PROGRESS_KEY|profileNukeProgress|storedProgress/)
    assert.match(terminalCloseBody, /sweepTerminalProfileTabsByAuthority\(Array\.from\(terminalHrefs\)\)/)
    assert.match(terminalHrefSweepBody, /getLiveProfileTabsByHref\(\)/)
    assert.match(terminalHrefSweepBody, /markQueuedTabClosing\(tabId, 'terminal-coordinator-live-href-sweep'\)/)
    assert.match(terminalHrefSweepBody, /await releaseQueuedTabAndCleanup\(tabId, \{awaitFill: true\}\)/)
    assert.match(terminalHrefSweepBody, /browser\.tabs\.remove\(tabId\)/)
    assert.match(terminalCloseBody, /await releaseQueuedTabAndCleanup\(normalizedTabId, \{awaitFill: true\}\)/)
    assert.match(orphanProfileSweepBody, /getHydratedCoordinatorAuthorityState\('profileTabsWithoutActiveAuthority\.usedResidentAuthority'\)/)
    assert.match(orphanProfileSweepBody, /coordinatorQueueReader\.full\(\{[\s\S]*metricPath: options\.metricPath \|\| 'profileTabsWithoutActiveAuthority\.load'/)
    assert.match(orphanProfileSweepBody, /getLiveProfileTabsByHref\(\)/)
    assert.match(orphanProfileSweepBody, /activeEntriesByHref\.set\(href, \{key: itemKey, item\}\)/)
    assert.match(orphanProfileSweepBody, /terminalizeActiveCoordinatorItemFromBlockedLiveTab\(/)
    assert.match(orphanProfileSweepBody, /findCoordinatorQueueEntryForHref\(queue, href\)/)
    assert.match(orphanProfileSweepBody, /markQueuedTabClosing\(tabId, 'profile-tab-without-active-queue-authority'\)/)
    assert.match(orphanProfileSweepBody, /await releaseQueuedTabAndCleanup\(tabId, \{awaitFill: false\}\)/)
    assert.match(orphanProfileSweepBody, /browser\.tabs\.remove\(tabId\)/)
    assert.match(orphanProfileSweepBody, /scheduleQueuedWorkContinuation\('profile-tabs-without-active-authority'\)/)
    assert.doesNotMatch(orphanProfileSweepBody, /PROFILE_NUKE_PROGRESS_KEY|ensureProfileNukeProgressReady\(\)/)
    assert.match(fillBody, /await sweepProfileTabsWithoutActiveQueueAuthority\(\{[\s\S]*queueOnlyAuthority: options\.queueOnlyAuthority === true/)
    assert.ok(
        fillBody.indexOf('sweepProfileTabsWithoutActiveQueueAuthority({') <
        fillBody.indexOf('decideQueueLoadThrottleGate({throttle, cycle, now: Date.now()})')
    )
    assert.match(applyBody, /let liveProfileTabsByHref = await getLiveProfileTabsByHref\(\)/)
    assert.match(applyBody, /sweepProfileTabsWithoutActiveQueueAuthority\(\{[\s\S]*currentAuthorityState,[\s\S]*liveProfileTabsByHref/)
    assert.match(applyBody, /if\(orphanProfileTabs\.closed \|\| orphanProfileTabs\.terminalized\) \{[\s\S]*currentAuthorityState = orphanProfileTabs\.authorityState \|\| coordinatorAuthority\.current\(\)[\s\S]*liveProfileTabsByHref = await getLiveProfileTabsByHref\(\)/)
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
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const messageBody = extractFunction(contentSource, 'function onMessage(request, sender, sendResponse)')
    const closeProbeIndex = messageBody.indexOf("if(request.action === 'close-if-blocked')")
    const closeProbeBody = messageBody.slice(closeProbeIndex, closeProbeIndex + 1800)
    const sweepBody = extractFunction(swSource, 'async function sweepOwnedBlockedProfileTabs(parentTabId)')
    const serviceWorkerSweepBody = extractFunction(swSource, 'async function sweepServiceWorkerBlockedProfileTabs()')
    const recordSweepBody = extractFunction(swSource, 'async function recordOwnedBlockedSweepTerminal(tabId, metadata = null, response = {})')
    const recordActiveBlockedLiveTabBody = extractFunction(swSource, 'async function recordActiveBlockedLiveTabTerminal(tabId, metadata = null, response = {})')
    const scheduleSweepBody = extractFunction(swSource, 'function scheduleOwnedBlockedProfileSweep(parentTabId, delayMs = 3000)')
    const activeBlockedLiveBody = extractFunction(swSource, 'async function terminalizeActiveCoordinatorItemFromBlockedLiveTab(itemKey = \'\', expectedItem = null, expectedRecord = null, liveProfileTabsByHref = new Map(), reason = \'active-blocked-live-tab\')')
    // shouldApplyExplicitProgressStatusToCoordinatorItem/
    // getActiveCoordinatorProgressSenderTabMismatchReason moved to
    // swCoordinatorProgressRules.js in decomposition Slice 12.
    const progressRulesSource = readRepoFile('shared/js/swCoordinatorProgressRules.js')
    const statusGateBody = extractFunction(progressRulesSource, 'function shouldApplyExplicitProgressStatusToCoordinatorItem(item = {}, patch = {}, options = {})')
    const senderGateBody = extractFunction(progressRulesSource, 'function getActiveCoordinatorProgressSenderTabMismatchReason(item = {}, patch = {}, options = {})')
    const recordBatchBody = extractFunction(swSource, 'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})')
    const activeWithoutActorBody = extractFunction(swSource, 'async function requeueDurableActiveCoordinatorItemWithoutActor(itemKey = \'\', expectedItem = null, expectedRecord = null, reason = \'reconcile-active-without-actor\', options = {})')
    const actionLeaseBody = extractFunction(swSource, 'async function releaseMissingActionLeaseForActiveCoordinatorItem(itemKey = \'\', expectedItem = null, reason = \'reconcile-action-lease-missing-tab\', options = {})')
    const coordinatorReclaimEvidenceSource = readRepoFile('shared/js/swCoordinatorReclaimEvidence.js')
    const queuedReclaimReasonBody = extractFunction(coordinatorReclaimEvidenceSource, 'function isQueuedCoordinatorLiveTabReclaimReason(reason = \'\')')
    const queuedActionBody = extractFunction(contentSource, 'async function maybeRunAutoProfileAction()')
    const alreadyBlockedRepairBody = extractFunction(contentSource, 'async function maybeRecordAlreadyBlockedCoordinatorProfile()')

    assert.notEqual(closeProbeIndex, -1)
    assert.match(closeProbeBody, /requestedProfileHref/)
    assert.match(closeProbeBody, /profile-mismatch/)
    assert.doesNotMatch(closeProbeBody, /recordProfileNukeProgress/)
    assert.doesNotMatch(closeProbeBody, /notifyQueuedTabComplete/)
    assert.doesNotMatch(closeProbeBody, /requestCloseTab/)
    assert.doesNotMatch(closeProbeBody, /setTimeout/)

    assert.match(sweepBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'BLOCKED_SWEEP_TERMINAL_RECORD'[\s\S]*tabId,[\s\S]*metadata,[\s\S]*response/)
    assert.doesNotMatch(sweepBody, /recordCoordinatorJobProgress\(normalizedProfileHref/)
    assert.ok(
        sweepBody.indexOf("type: 'BLOCKED_SWEEP_TERMINAL_RECORD'") <
        sweepBody.indexOf("closeQueuedTabAfterTerminal(tabId, 'background-blocked-sweep'")
    )
    assert.match(sweepBody, /const recorded = await applyCoordinatorQueueMachineEvent\(/)
    assert.match(readRepoFile('shared/js/swQueueMachineHandlers.js'), /BLOCKED_SWEEP_TERMINAL_RECORD\]: async \(event = \{\}\) => \{[\s\S]{0,200}recordOwnedBlockedSweepTerminal\(/)

    assert.match(recordSweepBody, /queueRuntime\.hasActiveQueuedTab\(normalizedTabId\)/)
    assert.match(recordSweepBody, /!attemptId/)
    assert.match(recordSweepBody, /normalizedProfileHref !== resolvedProfileHref/)
    assert.doesNotMatch(recordSweepBody, /recordCoordinatorJobProgress\(/)
    assert.match(recordSweepBody, /enqueueSpaceFeedStorageUpdate\(async \(\) => \{/)
    assert.match(recordSweepBody, /coordinatorQueueReader\.runs\(\{[\s\S]*metricPath: 'backgroundBlockedSweepTerminal\.load'/)
    assert.match(recordSweepBody, /coordinatorItemMatchesQueuedTabRuntime\(item, rowKey, metadata, normalizedTabId\)/)
    // Live incident (2026-09-17): this sweep can legitimately catch either
    // a block our own direct action caused (confirmation was just slow) or
    // a genuinely pre-existing block (we never got to clicking) -- the
    // willClose DOM signal alone can't tell these apart. It used to
    // hardcode status: 'already-blocked' / foundBlockedBeforeQueue: true
    // unconditionally, mislabeling every directly-caused block this
    // fallback ever caught as pre-existing and hiding it from the
    // reallyBlocked tally. Fixed via the shared classifyBlockConfirmationFromItem
    // helper (extracted after the same bug turned up a second time in
    // terminalizeActiveCoordinatorItemFromBlockedLiveTab's own fallback --
    // see activeBlockedLiveBody assertions below), which branches on
    // item.milestones.blockAttemptedAt.
    assert.match(recordSweepBody, /status: classification\.status,[\s\S]{0,120}foundBlockedBeforeQueue: classification\.foundBlockedBeforeQueue/)
    assert.match(recordSweepBody, /buildSweepConfirmedRecord\(classifyBlockConfirmationFromItem\(item, response\)\)/)
    assert.match(recordSweepBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'background-blocked-sweep-terminal'/)
    assert.match(recordSweepBody, /deferProjectionSave: true/)
    assert.match(recordSweepBody, /scheduleQueuedWorkContinuation\('background-blocked-sweep-terminal'\)[\s\S]*const nextQueue = coordinatorAuthority\.current\(\)\.queue/)
    // 2026-09-29: migrated onto applyCoordinatorRunsUpdate (see
    // mutated-running-total-audit-todo-2026-09-25.md).
    assert.match(recordSweepBody, /applyCoordinatorRunsUpdate\(nextQueue, affectedRunIds, \{[\s\S]*queueOperation: 'background-blocked-sweep-terminal-derived'/)
    assert.match(recordSweepBody, /if\(result\?\.terminal\)/)
    // recordActiveBlockedLiveTabTerminal (BLOCKED_LIVE_TAB_TERMINAL_RECORD):
    // the sibling added 2026-09-17 for terminalizeActiveCoordinatorItemFromBlockedLiveTab's
    // fallback (P3-2/P3-3, historical/sw-state-machine-decomposition-plan-2026-09-01.md).
    // Same classify -> transition -> authority-write -> stat shape as
    // recordSweepBody above, but deliberately does NOT gate on
    // coordinatorItemMatchesQueuedTabRuntime/queueRuntime.hasActiveQueuedTab
    // -- this call site's confirming tab is never the item's own tracked
    // tabId (that's why this fallback exists), so it matches by href +
    // attempt identity (hasMismatchedCoordinatorAttempt) only.
    assert.doesNotMatch(recordActiveBlockedLiveTabBody, /coordinatorItemMatchesQueuedTabRuntime/)
    assert.doesNotMatch(recordActiveBlockedLiveTabBody, /queueRuntime\.hasActiveQueuedTab/)
    assert.match(recordActiveBlockedLiveTabBody, /hasMismatchedCoordinatorAttempt\(item, record\)/)
    assert.match(recordActiveBlockedLiveTabBody, /hasMismatchedCoordinatorAttempt\(currentItem, record\)/)
    assert.match(recordActiveBlockedLiveTabBody, /!attemptId/)
    assert.match(recordActiveBlockedLiveTabBody, /normalizedProfileHref !== resolvedProfileHref/)
    assert.doesNotMatch(recordActiveBlockedLiveTabBody, /recordCoordinatorJobProgress\(/)
    assert.match(recordActiveBlockedLiveTabBody, /enqueueSpaceFeedStorageUpdate\(async \(\) => \{/)
    assert.match(recordActiveBlockedLiveTabBody, /coordinatorQueueReader\.runs\(\{[\s\S]*metricPath: 'activeBlockedLiveTabTerminal\.load'/)
    assert.match(recordActiveBlockedLiveTabBody, /status: classification\.status,[\s\S]{0,120}foundBlockedBeforeQueue: classification\.foundBlockedBeforeQueue/)
    assert.match(recordActiveBlockedLiveTabBody, /buildLiveTabConfirmedRecord\(classifyBlockConfirmationFromItem\(item, response\)\)/)
    assert.match(recordActiveBlockedLiveTabBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'active-blocked-live-tab-terminal'/)
    assert.match(recordActiveBlockedLiveTabBody, /deferProjectionSave: true/)
    assert.match(recordActiveBlockedLiveTabBody, /scheduleQueuedWorkContinuation\('active-blocked-live-tab-terminal'\)[\s\S]*const nextQueue = coordinatorAuthority\.current\(\)\.queue/)
    // 2026-09-29: migrated onto applyCoordinatorRunsUpdate (see
    // mutated-running-total-audit-todo-2026-09-25.md).
    assert.match(recordActiveBlockedLiveTabBody, /applyCoordinatorRunsUpdate\(nextQueue, affectedRunIds, \{[\s\S]*queueOperation: 'active-blocked-live-tab-terminal-derived'/)
    assert.match(recordActiveBlockedLiveTabBody, /if\(result\?\.terminal\)/)
    assert.match(scheduleSweepBody, /sweepOwnedBlockedProfileTabs\(parentTabId\)/)
    assert.match(scheduleSweepBody, /if\(result\?\.signaled\) return/)
    assert.match(scheduleSweepBody, /queueRuntime\.listActiveQueuedTabIds\(\)/)
    assert.match(scheduleSweepBody, /queueRuntime\.getOwningParentForChild\(tabId\)/)
    assert.match(scheduleSweepBody, /scheduleOwnedBlockedProfileSweep\(parentTabId, 5000\)/)
    assert.match(activeBlockedLiveBody, /action: 'close-if-blocked'/)
    // Live incident (2026-09-17): this function's close-if-blocked
    // send-and-await used to run with no in-flight guard at all -- two
    // independent callers (the periodic blocked-profile sweep and the
    // executor's own active-with-tab-and-pending-action classifier) could
    // and did probe the same tab concurrently with no coordination
    // (confirmed live: 16 sends to one tab in under 2 seconds, alternating
    // between both callers' reasons). closeIfBlockedProbeInFlightByTabId
    // coalesces concurrent probes for the same tabId onto one in-flight
    // send instead of each caller firing its own.
    assert.match(activeBlockedLiveBody, /closeIfBlockedProbeInFlightByTabId\.get\(tabId\)/)
    assert.match(activeBlockedLiveBody, /closeIfBlockedProbeInFlightByTabId\.set\(tabId, probePromise\)/)
    assert.match(activeBlockedLiveBody, /closeIfBlockedProbeInFlightByTabId\.delete\(tabId\)/)
    assert.doesNotMatch(activeBlockedLiveBody, /matches\.length !== 1/)
    assert.match(activeBlockedLiveBody, /const persistedMatch = persistedTabId[\s\S]*matches\.find/)
    assert.match(activeBlockedLiveBody, /const match = persistedMatch \|\| matches\[0\] \|\| null/)
    // Live incident (2026-09-17, second occurrence): this fallback also
    // hardcoded status: 'already-blocked' unconditionally -- 11 of 13
    // sweep terminalizations this session went through this exact shape
    // and were all misclassified, accounting for most of the "I've seen
    // ~10 real blocks but the dashboard shows 2" discrepancy the user
    // reported. Originally patched via classifyBlockConfirmationFromItem
    // feeding a recordCoordinatorJobProgressViaQueueMachine detour (with an
    // allowBlockedLiveTabSender escape hatch for that pipeline's sender-tab
    // gate); converged 2026-09-17 (P3-2/P3-3,
    // historical/sw-state-machine-decomposition-plan-2026-09-01.md) onto a dedicated
    // BLOCKED_LIVE_TAB_TERMINAL_RECORD event/handler
    // (recordActiveBlockedLiveTabTerminal) instead -- a sibling of
    // recordOwnedBlockedSweepTerminal's BLOCKED_SWEEP_TERMINAL_RECORD, not
    // that same handler, because recordOwnedBlockedSweepTerminal's
    // coordinatorItemMatchesQueuedTabRuntime match requires the confirming
    // tab to be the item's own tracked tabId -- never true at this call
    // site, whose whole premise is a live tab found independently of that
    // tracking.
    assert.match(activeBlockedLiveBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'BLOCKED_LIVE_TAB_TERMINAL_RECORD'[\s\S]*tabId,[\s\S]*metadata: terminalMetadata,[\s\S]*response: terminalResponse/)
    assert.doesNotMatch(activeBlockedLiveBody, /BLOCKED_SWEEP_TERMINAL_RECORD/)
    assert.doesNotMatch(activeBlockedLiveBody, /recordCoordinatorJobProgressViaQueueMachine/)
    assert.doesNotMatch(activeBlockedLiveBody, /allowBlockedLiveTabSender/)
    assert.match(activeBlockedLiveBody, /for\(const closeCandidate of matches\.length > 1 \? matches : \[\{tab: match\.tab, response: match\.response\}\]\)/)
    assert.match(activeBlockedLiveBody, /await closeQueuedTabAfterTerminal\(closeTabId, reason, \{[\s\S]{0,80}awaitFill: closeTabId === tabId/)
    assert.match(extractFunction(swSource, 'async function closeQueuedTabAfterTerminal(tabId, reason, options = {})'), /await browser\.tabs\.remove\(normalizedTabId\)[\s\S]*releaseQueuedTabAndCleanup\(normalizedTabId, \{awaitFill: options\.awaitFill === true\}\)/)
    assert.match(serviceWorkerSweepBody, /sweepOwnedBlockedProfileTabs\(SERVICE_WORKER_QUEUE_OWNER_ID\)/)
    assert.match(bootstrap, /request\.action === 'sweep-service-worker-blocked-profile-tabs'/)
    assert.match(queuedActionBody, /sweepServiceWorkerBlockedProfileTabs\(\)/)
    assert.match(alreadyBlockedRepairBody, /sweepServiceWorkerBlockedProfileTabs\(\)/)
    const confirmedRuntimeBody = extractFunction(swSource, 'async function recoverConfirmedLiveRuntimeActorForCoordinatorItem(item = null, record = null, reason = \'reconcile-confirmed-live-runtime\')')
    assert.match(confirmedRuntimeBody, /terminalizeAlreadyBlockedQueuedTab\(tabId/)
    const confirmedRuntimeTerminalizerIndex = confirmedRuntimeBody.indexOf('terminalizeAlreadyBlockedQueuedTab(tabId')
    const confirmedRuntimeNoChangeIndex = confirmedRuntimeBody.indexOf('changed: false', confirmedRuntimeTerminalizerIndex)
    assert.ok(
        confirmedRuntimeTerminalizerIndex !== -1 &&
        confirmedRuntimeNoChangeIndex !== -1 &&
        confirmedRuntimeTerminalizerIndex < confirmedRuntimeNoChangeIndex
    )
    assert.ok(
        activeWithoutActorBody.indexOf('terminalizeActiveCoordinatorItemFromBlockedLiveTab(') <
        activeWithoutActorBody.indexOf('mutateCoordinatorActiveWithoutRuntimeActorReconcile({')
    )
    assert.ok(
        actionLeaseBody.indexOf('terminalizeActiveCoordinatorItemFromBlockedLiveTab(') <
        actionLeaseBody.indexOf("reason: 'action-lease-tab-still-live'")
    )
    assert.match(queuedReclaimReasonBody, /active-transition-failed/)
    assert.match(queuedReclaimReasonBody, /active-missing-tab/)
    assert.match(statusGateBody, /options\.requireActiveSenderTab === true/)
    // allowBlockedLiveTabSender (the PROGRESS_PATCH_RECORD pipeline's
    // escape hatch for this call site's sender-tab mismatch) was removed
    // 2026-09-17 when this call site converged onto its own dedicated
    // BLOCKED_LIVE_TAB_TERMINAL_RECORD event above instead of routing
    // through this gate at all.
    assert.doesNotMatch(senderGateBody, /allowBlockedLiveTabSender/)
    assert.match(statusGateBody, /isActiveCoordinatorStatus\(item\?\.status \|\| ''\)/)
    assert.match(recordBatchBody, /reason: 'inactive-sender-tab'/)
})

test('coordinator rows expose canonical job envelope fields', () => {
    // makeCoordinatorJobEnvelope/applyCoordinatorJobEnvelope/
    // makeCoordinatorAttemptEnvelope moved to swCoordinatorJobEnvelope.js in
    // decomposition Slice 11.
    const jobEnvelopeSource = readRepoFile('shared/js/swCoordinatorJobEnvelope.js')

    assert.match(jobEnvelopeSource, /function makeCoordinatorJobEnvelope/)
    assert.match(jobEnvelopeSource, /function applyCoordinatorJobEnvelope/)
    assert.match(jobEnvelopeSource, /jobKey:/)
    assert.match(jobEnvelopeSource, /canonicalSubject:/)
    assert.match(jobEnvelopeSource, /attempt: makeCoordinatorAttemptEnvelope/)
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



test('failed resolver retry preserves source-post resolution mode', () => {
    const source = readRepoFile('shared/js/sw.js')
    const retryCandidatesSource = readRepoFile('shared/js/swCoordinatorRetryCandidates.js')
    const candidateBody = extractFunction(retryCandidatesSource, 'function getCoordinatorRetryableFailureCandidates(queue = {}, progress = {}, retryLimit = 2)')
    const resetBody = extractFunction(retryCandidatesSource, 'function buildFailedCoordinatorResetItem(itemKey = \'\', item = {}, options = {})')
    const retryBody = extractFunction(source, 'async function retryCoordinatorFailedItems(request = {}, sender = {})')
    const retryMutationBody = extractFunction(source, 'async function mutateCoordinatorFailedItemsRetry(operation = {})')

    // getFailedItemProfileResolutionRetryUrl moved to
    // swCoordinatorJobEnvelope.js in decomposition Slice 11.
    // getCoordinatorRetryableFailureCandidates/buildFailedCoordinatorResetItem
    // moved to swCoordinatorRetryCandidates.js in decomposition Slice 29.
    assert.match(readRepoFile('shared/js/swCoordinatorJobEnvelope.js'), /function getFailedItemProfileResolutionRetryUrl/)
    assert.match(candidateBody, /resolutionRetryUrl/)
    assert.match(candidateBody, /!href && !candidate\.resolutionRetryUrl/)
    assert.match(resetBody, /getFailedItemProfileResolutionRetryUrl\(item, itemKey\)/)
    assert.match(resetBody, /resolutionMode: retryViaResolution \? QUEUED_PROFILE_RESOLUTION_MODE : ''/)
    assert.match(resetBody, /resolveProfileFromPage: retryViaResolution/)
    assert.match(retryBody, /type: 'RETRY_FAILED_ITEMS'/)
    assert.match(retryMutationBody, /buildFailedCoordinatorResetItem\(candidate\.itemKey, item/)
})

test('manual failed retry requests reconcile after durable storage', () => {
    const source = readRepoFile('shared/js/sw.js')
    const resetBody = extractFunction(readRepoFile('shared/js/swCoordinatorRetryCandidates.js'), 'function buildFailedCoordinatorResetItem(itemKey = \'\', item = {}, options = {})')
    const retryBody = extractFunction(source, 'async function retryCoordinatorFailedItems(request = {}, sender = {})')
    const retryMutationBody = extractFunction(source, 'async function mutateCoordinatorFailedItemsRetry(operation = {})')

    assert.match(retryBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'RETRY_FAILED_ITEMS'/)
    assert.match(retryMutationBody, /coordinatorQueueReader\.runsEventsProgress\(\{[\s\S]*metricPath: 'failedRetry\.load'/)
    assert.doesNotMatch(retryMutationBody, /loadCoordinatorState\(/)
    assert.match(retryMutationBody, /coordinatorAuthority\.persistCoordinator\(/)
    assert.match(retryMutationBody, /operationKind: 'retry'/)
    assert.match(retryMutationBody, /removedRows/)
    assert.match(retryMutationBody, /saveProfileNukeProgressRowProjection\(\s*\n\s*Object\.fromEntries\(Array\.from\(progressProjectionRemovalHrefs/)
    assert.match(retryMutationBody, /queueOperation: 'retry-derived'/)
    assert.doesNotMatch(retryMutationBody, /queue: true/)
    assert.doesNotMatch(retryMutationBody, /progress: progressChanged/)
    assert.match(retryBody, /enqueueSpaceFeedStorageUpdate\(\(\) =>/)
    assert.match(retryBody, /timeoutMs: QUEUE_CRITICAL_STORAGE_UPDATE_TIMEOUT_MS/)
    assert.match(retryBody, /failureValue:[\s\S]*retry-save-failed/)
    assert.match(resetBody, /serviceWorkerOwned: true/)
    assert.match(retryBody, /runCoordinatorReconcileExecutorActions\('retry-failed-executor-busy'[\s\S]*awaitFill: true/)
    assert.doesNotMatch(retryBody, /await fillQueuedTabs\(\)/)
    assert.match(resetBody, /\.\.\.\(executorMaxConcurrent \? \{executorMaxConcurrent\} : \{\}\)/)
})

test('invalid resolver reconcile rows are non-retryable and source-settled', () => {
    const source = readRepoFile('shared/js/sw.js')
    const transitionBody = extractFunction(source, 'async function applyCoordinatorReconcileQueueAuthorityTransitionPhase(ctx = {})')
    const persistBody = extractFunction(source, 'async function persistCoordinatorReconcileAuthorityTransitionPhase(ctx = {})')
    const operationBody = extractFunction(readRepoFile('shared/js/swCoordinatorReconcileLockedMaterialization.js'), 'function applyInvalidProfileResolutionReconcileActionLocked(state = {}, operation = {})')

    assert.match(transitionBody, /getInvalidProfileResolutionFailure\(item, itemKey\)/)
    assert.match(transitionBody, /invalidTerminalResolutionNeedsReconcile/)
    assert.match(transitionBody, /applyInvalidProfileResolutionReconcileActionLocked\(\{[\s\S]*queue/)
    assert.match(transitionBody, /kind: 'reconcileInvalidProfileResolution'/)
    assert.match(transitionBody, /getPersistedLiveTabForCoordinatorItem\(item, record, itemKey\)/)
    assert.match(operationBody, /status: 'skipped'/)
    assert.match(operationBody, /outcome: 'unresolved-target'/)
    assert.match(operationBody, /sourceSettlementOutcome: 'cleared'/)
    assert.match(operationBody, /matchesCoordinatorReconcileOperationAttempt\(item, operation\)/)
    assert.match(operationBody, /getCoordinatorReconcileOperationTabIdsToClose\(operation, item, operation\.record \|\| null\)/)
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

test('every injection of content.css loads tokens.css first', () => {
    // content.css reads --mb-* custom properties that only shared/css/tokens.css defines, and tokens.css defines them on :root.
    // A Quora page gets content.css from the manifest's content_scripts or from a programmatic insertCSS (sw.js, and the CDP
    // helpers that copy it). Every one of those lists must include tokens.css, and list it before content.css.
    const tokensBeforeContent = files => files.indexOf('css/tokens.css') !== -1 &&
        files.indexOf('css/tokens.css') < files.indexOf('css/content.css')

    assert.match(readRepoFile('shared/css/tokens.css'), /:root\s*\{[^}]*--mb-brand-red:\s*#b92b27/)
    const mix = readRepoFile('webpack.mix.js')
    assert.match(mix, /\.copy\('\.\/shared\/css', 'chrome\/css'\)/)
    assert.match(mix, /\.copy\('\.\/shared\/css', 'firefox\/css'\)/)

    for(const manifestPath of ['manifests/chrome.json', 'manifests/firefox.json']) {
        const scripts = JSON.parse(readRepoFile(manifestPath)).content_scripts || []
        const injecting = scripts.filter(entry => (entry.css || []).includes('css/content.css'))
        assert.ok(injecting.length > 0, `${manifestPath} injects content.css as a content script`)
        for(const entry of injecting) {
            assert.ok(tokensBeforeContent(entry.css), `${manifestPath} lists ${entry.css.join(', ')}; tokens.css must come first`)
        }
    }

    for(const sourcePath of ['shared/js/sw.js', 'tools/cdp/inject-content-script.js', 'tools/cdp/upgrade-regression/run.js']) {
        const lists = [...readRepoFile(sourcePath).matchAll(/files:\s*\[([^\]]*)\]/g)]
            .map(match => [...match[1].matchAll(/'([^']+)'/g)].map(name => name[1]))
            .filter(files => files.includes('css/content.css'))
        assert.ok(lists.length > 0, `${sourcePath} injects content.css programmatically`)
        for(const files of lists) {
            assert.ok(tokensBeforeContent(files), `${sourcePath} injects ${files.join(', ')}; tokens.css must come first`)
        }
    }
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
    const queueBody = extractFunction(source, 'async function nukeProfileSearchHrefsOnce(button, hrefs = [], options = {})')
    const syncBody = extractFunction(source, 'function syncProfileSearchControls()')
    const pendingCountBody = extractFunction(source, 'function getPendingCoordinatorProfileSearchWorkCount()')
    const nukeableBody = extractFunction(source, 'function isProfileSearchProfileNukeable(href, options = {})')
    const queueableBody = extractFunction(source, 'function getProfileSearchQueueableRows(rows = getProfileSearchRows(), options = {})')
    const batchBody = extractFunction(source, 'function getProfileSearchBatchHrefs(rows = getProfileSearchRows(), options = {})')
    const endBody = extractFunction(source, 'function isProfileSearchEndOfResultsVisible()')
    const loadingBody = extractFunction(source, 'function hasProfileSearchLoadingIndicator()')
    const nudgeBody = extractFunction(source, 'function nudgeProfileSearchLazyLoad()')
    const unstagedBody = extractFunction(source, 'function hasUnstagedProfileSearchQueueableRow(rows = getProfileSearchRows({fromCurrentViewport: true, skipProcessed: true}))')
    const animationBody = extractFunction(source, 'async function animateNukeButtonPress(button)')
    const animationFrameBody = extractFunction(source, 'function waitForAnimationFramePair(options = {})')

    assert.match(readRepoFile('shared/js/tunables.js'), /PROFILE_SEARCH_COLLECT_LIMIT: 100/)
    assert.match(readRepoFile('shared/js/tunables.js'), /COLLECT_STALLED_TIMEOUT_MS: 30000/)
    assert.match(readRepoFile('shared/js/tunables.js'), /CANDIDATE_BATCH_PROFILES_PER_BATCH: 3/)
    assert.doesNotMatch(source, /(SPACE_FEED|PROFILE_SEARCH)_PROFILES_PER_BATCH|PROFILE_SEARCH_COLLECT_STALLED_TIMEOUT_MS/)
    assert.match(source, /function getProfileSearchProfilesPerBatch\(\)/)
    assert.doesNotMatch(source, /async function refreshProfileNukeProgressFromStorage\(\)/)
    assert.match(source, /refreshContentPageCoordinatorStateFromRuntime\(\{force: true\}\)[\s\S]*scheduleProfileSearchControls\(0\)/)
    assert.match(source, /let profileSearchStagedHrefs = \[\]/)
    assert.match(source, /let profileSearchCollectCursorScrollY = 0/)
    assert.match(animationBody, /waitForAnimationFramePair\(\{timeoutMs: 120\}\)/)
    assert.match(animationFrameBody, /setTimeout\(finish, timeoutMs\)/)
    assert.match(animationFrameBody, /requestAnimationFrame\(\(\) => requestAnimationFrame\(finish\)\)/)
    assert.match(collectBody, /const initialStagedCount = getProfileSearchStagedHrefs\(\)\.length/)
    assert.match(collectBody, /const targetStagedCount = initialStagedCount \+ limit/)
    assert.match(collectBody, /window\.scrollTo\(\{top: document\.documentElement\.scrollHeight/)
    assert.match(collectBody, /getProfileSearchRows\(\{fromCurrentViewport: true, skipProcessed: true\}\)/)
    assert.match(collectBody, /nudgeProfileSearchLazyLoad\(\)/)
    assert.match(collectBody, /stageProfileSearchHrefs\(\[row\.href\]\)/)
    assert.match(collectBody, /saveProfileSearchCollectCursor\(rows\)/)
    assert.match(collectBody, /Collecting \$\{getProfileSearchStagedHrefs\(\)\.length\} \/ \$\{targetStagedCount\}/)
    assert.match(collectBody, /isProfileSearchEndOfResultsVisible\(\) && !hasUnstagedProfileSearchQueueableRow\(\) && !hasProfileSearchLoadingIndicator\(\)/)
    assert.match(collectBody, /nudgeProfileSearchLazyLoad\(\)/)
    assert.match(collectBody, /stallTimeoutMs: COLLECT_STALLED_TIMEOUT_MS/)
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
    assert.doesNotMatch(queueBody, /Nuking \$\{queued\}\.\.\./)
    assert.match(queueBody, /setNukeButtonIdle\(button, remainingHrefs \? `Nuke 'Em \$\{remainingHrefs\}` : `Nuke 'Em 0`\)/)
    // Owner, 26 Oct: a queued or nuking row is never queueable on the search page, so the stale-run exception is not applied there.
    assert.match(nukeableBody, /if\(isPendingCoordinatorProfileHref\(normalizedHref\)\) return false/)
    assert.doesNotMatch(nukeableBody, /ignoreStaleCurrentProfileSearchPending/)
    assert.match(pendingCountBody, /const currentSearchItems = Object\.values\(coordinatorQueue \|\| \{\}\)/)
    assert.match(pendingCountBody, /filter\(isCoordinatorItemForCurrentProfileSearch\)/)
    assert.match(pendingCountBody, /if\(currentSearchItems\.length > 0\) return 0/)
    assert.match(syncBody, /Collect \$\{limit\} More/)
    assert.match(syncBody, /'profile-search-batch'[\s\S]*nukeProfileSearchHrefs\(activeButton, hrefs/)
    assert.match(syncBody, /if\(queued\) resetProfileSearchCollectionState\(\{keepCursor: true\}\)/)
    assert.doesNotMatch(syncBody, /if\(profileSearchCollecting\) return/)
    assert.match(syncBody, /if\(profileSearchCollecting\) \{[\s\S]*buttons\.batch\.disabled = !batchHrefs\.length/)
    assert.match(syncBody, /getPendingCoordinatorProfileSearchWorkCount\(\)/)
    // The collect button is always offered while nukes are pending (owner, 21 Oct): it stays enabled under the pending branch.
    assert.match(syncBody, /pendingSearchCount > 0[\s\S]*buttons\.collect\.disabled = false/)
    assert.doesNotMatch(pendingCountBody, /filter\(isCurrentProfileSearchRuntimeCoordinatorItem\)/)
    assert.doesNotMatch(queueableBody, /ignoreStaleCurrentProfileSearchPending/)
    assert.doesNotMatch(queueableBody, /isProfileSearchRowMatchForCurrentQuery/)
    assert.doesNotMatch(queueableBody, /allowSearchQueryMismatch/)
})

// Owner decision (26 Oct): search results are not gated by the query words in their profile slug. A result whose slug lacks the query
// words is queueable like any other, and no "Not Match" pill is shown. The match helpers and their pill are gone.
test('a search result whose slug lacks the query words is queueable and has no Not Match pill', () => {
    const source = readRepoFile('shared/js/content.js')
    const rowButtonsBody = extractFunction(source, 'function syncProfileSearchRowButtons(rows = getProfileSearchRows())')
    const queueableBody = extractFunction(source, 'function getProfileSearchQueueableRows(rows = getProfileSearchRows(), options = {})')

    assert.doesNotMatch(source, /'Not Match'|Search result does not match/)
    assert.doesNotMatch(source, /isProfileSearchHrefMatchForCurrentQuery|isProfileSearchRowMatchForCurrentQuery|getProfileSearchQueryTokens|getProfileSearchHrefSlugTokens|normalizeProfileSearchMatchTokens|PROFILE_SEARCH_MATCH_IGNORED_TOKENS/)
    assert.doesNotMatch(rowButtonsBody, /Not Match|isProfileSearchRowMatch/)
    assert.match(rowButtonsBody, /if\(isPendingCoordinatorProfileHref\(href\)\) \{/)
    assert.match(rowButtonsBody, /setNukeButtonIdle\(button, 'Mute Block'\)/)

    // Run the queueable filter itself. Only the nuke-state check is stubbed: a row is kept or dropped by that check alone, never by its slug.
    const queueable = new Function('isProfileSearchProfileNukeable', `${queueableBody}\nreturn getProfileSearchQueueableRows`)(
        (href) => href !== 'https://www.quora.com/profile/Already-Nuked'
    )
    const rows = [
        {href: 'https://www.quora.com/profile/Jane-Smith-7'},
        {href: 'https://www.quora.com/profile/Totally-Unrelated-Name'},
        {href: 'https://www.quora.com/profile/Already-Nuked'}
    ]
    const kept = queueable(rows, {allowRetry: false}).map(row => row.href)
    assert.deepEqual(kept, [
        'https://www.quora.com/profile/Jane-Smith-7',
        'https://www.quora.com/profile/Totally-Unrelated-Name'
    ], 'a row whose slug lacks the query words is queueable; a row the nuke-state check refuses is still dropped')
})

test('incoming coordinator executor concurrency can lower stale persisted rows', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function enqueueCoordinatorItemsStorageLocked(request = {})')

    assert.match(body, /const hasExecuteInput = request\.execute && typeof request\.execute === 'object'/)
    assert.match(body, /const requestedMaxConcurrent = Number\.parseInt\(executeInput\.maxConcurrent, 10\)/)
    assert.match(body, /executorMaxConcurrent: executorMaxConcurrent \|\| existing\?\.executorMaxConcurrent \|\| null/)
    assert.match(body, /executorOwner: hasExecuteInput \? 'service-worker' : existing\?\.executorOwner \|\| ''/)
    assert.match(body, /serviceWorkerOwned: hasExecuteInput \? true : existing\?\.serviceWorkerOwned === true/)
    assert.match(body, /coordinatorAuthority\.persistCoordinator\(/)
    assert.match(body, /operationKind: 'enqueue'/)
    assert.match(body, /coordinatorQueueReader\.runsEventsProgress\(\{[\s\S]*metricPath: 'enqueue\.load'/)
    assert.doesNotMatch(body, /loadCoordinatorState\(/)
    assert.match(body, /saveProfileNukeProgressRowProjection\(progressResetRecords/)
    assert.match(body, /queueOperation: 'enqueue-derived'/)
    assert.doesNotMatch(body, /progress: progressChanged/)
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
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const messageStart = bootstrap.indexOf("request.action === 'get-owned-nuke-status'")
    const cleanupMessageStart = bootstrap.indexOf("request.action === 'cleanup-owned-nuke-status'")
    const sweepMessageStart = bootstrap.indexOf("request.action === 'sweep-owned-blocked-profile-tabs'")
    const messageBody = bootstrap.slice(messageStart, cleanupMessageStart)
    const cleanupMessageBody = bootstrap.slice(cleanupMessageStart, sweepMessageStart)
    const waitBody = extractFunction(contentSource, 'async function waitForOwnedNukeTabsToDrain(button, timeoutMs = WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_INTERVAL_MS, options = {})')

    assert.match(statusBody, /const runId = `\$\{options\?\.runId \|\| ''\}`\.trim\(\)/)
    assert.match(statusBody, /options\?\.cleanup === true/)
    assert.match(statusBody, /getKnownLiveOwnedTabIdsReadOnly\(ownerId\)/)
    assert.match(statusBody, /ownerIds\.add\(SERVICE_WORKER_QUEUE_OWNER_ID\)/)
    assert.match(statusBody, /metadata\.runId === runId/)
    assert.match(statusBody, /item\?\.runId !== runId/)
    assert.match(statusBody, /coordinatorQueueReader\.full\(\{[\s\S]*metricPath: 'ownedNukeStatus\.queue\.load'/)
    assert.match(messageBody, /runId: request\.runId \|\| ''/)
    assert.doesNotMatch(messageBody, /scheduleCoordinatorReconcile/)
    assert.doesNotMatch(messageBody, /getLiveOwnedTabIds/)
    assert.match(cleanupMessageBody, /scheduleCoordinatorReconcile\(1000, \{reason: 'owned-nuke-status-cleanup'\}\)/)
    assert.match(cleanupMessageBody, /cleanup: true/)
    assert.match(waitBody, /getOwnedNukeStatus\(\{runId: options\.runId \|\| ''\}\)/)
    assert.match(contentSource, /waitForOwnedNukeTabsToDrain\(btn, 180000, 1000, \{runId: result\?\.runId \|\| ''\}\)/)
    assert.match(contentSource, /waitForOwnedNukeTabsToDrain\(buttons\.nuke, 180000, 1000, \{runId: result\?\.runId \|\| ''\}\)/)
})

test('progress-to-queue legacy import path is absent', () => {
    const source = readRepoFile('shared/js/sw.js')
    const reconcileBody = extractFunction(source, 'async function reconcileCoordinatorStorageLocked(options = {})')
    const authorityTransitionBody = extractFunction(source, 'async function applyCoordinatorReconcileQueueAuthorityTransitionPhase(ctx = {})')
    const persistBody = extractFunction(source, 'async function persistCoordinatorReconcileAuthorityTransitionPhase(ctx = {})')
    const enqueueBody = extractFunction(source, 'async function enqueueCoordinatorItems(request = {}, sender = {})')

    assert.match(authorityTransitionBody, /applyCoordinatorSourceMetadataMaterialization/)
    assert.match(persistBody, /eventsChanged: ctx\.eventsChanged/)
    assert.doesNotMatch(source, /function importLegacyQueuedProgressRecordsReconcilePhase/)
    assert.doesNotMatch(source, /function importLegacyQueuedProgressRecordsToCoordinatorQueue/)
    assert.doesNotMatch(source, /function shouldRestoreQueuedProgressRecordToCoordinatorQueue/)
    assert.doesNotMatch(source, /legacyImport|importLegacy|legacy-import/)
    assert.doesNotMatch(reconcileBody, /importLegacyQueuedProgressRecords/)
    assert.doesNotMatch(authorityTransitionBody, /importLegacyQueuedProgressRecordsToCoordinatorQueue/)
    assert.doesNotMatch(enqueueBody, /coordinatorProgressSyncPromise/)
})

test('coordinator reconcile loop is split into ordered authority phases', () => {
    const source = readRepoFile('shared/js/sw.js')
    const lockedBody = extractFunction(source, 'async function reconcileCoordinatorStorageLocked(options = {})')
    const loadBody = extractFunction(source, 'async function loadCoordinatorReconcileAuthorityPhase(options = {})')
    const materializeBody = extractFunction(readRepoFile('shared/js/swCoordinatorReconcileLockedMaterialization.js'), 'function materializeCoordinatorReconcileDerivedProjectionPhase(ctx = {})')
    const runtimeBody = extractFunction(source, 'async function reconcileCoordinatorRuntimeActorsPhase(ctx = {})')
    const authorityBody = extractFunction(source, 'async function applyCoordinatorReconcileQueueAuthorityTransitionPhase(ctx = {})')
    const persistBody = extractFunction(source, 'async function persistCoordinatorReconcileAuthorityTransitionPhase(ctx = {})')
    // scheduleCoordinatorReconcileExecutorContinuation moved to
    // swSchedulerAlarmBookkeeping.js in decomposition Slice 43.
    const continuationBody = extractFunction(readRepoFile('shared/js/swSchedulerAlarmBookkeeping.js'), "function scheduleCoordinatorReconcileExecutorContinuation(after = null, authority = null, reason = 'reconcile', options = {})")

    const orderedPhases = [
        'loadCoordinatorReconcileAuthorityPhase(options)',
        'materializeCoordinatorReconcileDerivedProjectionPhase(ctx)',
        'await reconcileCoordinatorRuntimeActorsPhase(ctx)',
        'await applyCoordinatorReconcileQueueAuthorityTransitionPhase(ctx)',
        'return persistCoordinatorReconcileAuthorityTransitionPhase(ctx)'
    ]
    let previousIndex = -1
    for(const phase of orderedPhases) {
        const index = lockedBody.indexOf(phase)
        assert.notEqual(index, -1, `missing reconcile phase ${phase}`)
        assert.ok(index > previousIndex, `reconcile phase out of order: ${phase}`)
        previousIndex = index
    }

    assert.match(loadBody, /coordinatorQueueReader\.reconcile\(\{[\s\S]*metricPath: 'reconcile\.load'/)
    assert.match(materializeBody, /materializeRemovedProfileDerivedStateFromAuthority\(ctx\.state\)/)
    assert.match(runtimeBody, /ctx\.liveProfileTabsByHref = await getLiveProfileTabsByHref\(\)/)
    assert.match(authorityBody, /applyProgressRecordCoordinatorReconcileActionLocked/)
    assert.doesNotMatch(source, /shouldAdoptTerminalRawCoordinatorSnapshot/)
    assert.doesNotMatch(source, /getRawCoordinatorQueueProfileHrefsRemovedFromAuthority/)
    assert.doesNotMatch(authorityBody, /COORDINATOR_QUEUE_KEY/)
    assert.match(persistBody, /persistCoordinatorReconcileQueueAuthorityMutation/)
    assert.match(continuationBody, /scheduleCoordinatorQueueResume|scheduleQueuedOnlyDurableWorkContinuation/)
})

test('current reconcile authority paths do not introduce repair operation kinds or metrics', () => {
    const source = readRepoFile('shared/js/sw.js')
    const currentAuthorityBodies = [
        extractFunction(source, 'async function reconcileCoordinatorStorageLocked(options = {})'),
        extractFunction(source, 'async function loadCoordinatorReconcileAuthorityPhase(options = {})'),
        extractFunction(readRepoFile('shared/js/swCoordinatorReconcileLockedMaterialization.js'), 'function materializeCoordinatorReconcileDerivedProjectionPhase(ctx = {})'),
        extractFunction(source, 'async function reconcileCoordinatorRuntimeActorsPhase(ctx = {})'),
        extractFunction(source, 'async function applyCoordinatorReconcileQueueAuthorityTransitionPhase(ctx = {})'),
        extractFunction(source, 'async function persistCoordinatorReconcileAuthorityTransitionPhase(ctx = {})'),
        extractFunction(source, 'async function mutateCoordinatorActiveWithoutRuntimeActorReconcile(operation = {})'),
        extractFunction(readRepoFile('shared/js/swSchedulerAlarmBookkeeping.js'), "function scheduleCoordinatorReconcileExecutorContinuation(after = null, authority = null, reason = 'reconcile', options = {})")
    ].join('\n')

    assert.doesNotMatch(currentAuthorityBodies, /operationKind: 'repair-/)
    assert.doesNotMatch(currentAuthorityBodies, /metricPath: 'repair\./)
    assert.doesNotMatch(currentAuthorityBodies, /projectionMetricPath: 'repair\./)
    assert.doesNotMatch(currentAuthorityBodies, /incrementQueueWakeupMetric\('repair\./)
    assert.match(currentAuthorityBodies, /operationKind: 'reconcile-active-without-actor'/)
    assert.match(currentAuthorityBodies, /operationKind: 'reconcile-progress'/)
})

test('queue WAL migrated operations do not include current repair operation aliases', () => {
    const source = readRepoFile('shared/js/sw.js')
    const setMatch = source.match(/const COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS = new Set\(\[([\s\S]*?)\]\)/)
    assert.ok(setMatch, 'missing COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS')

    const operationNames = Array.from(setMatch[1].matchAll(/'([^']+)'/g), match => match[1])
    const repairOperationNames = operationNames.filter(name => name.startsWith('repair-'))

    assert.deepEqual(repairOperationNames, [])
    assert.ok(operationNames.includes('terminal-progress-active'))
    assert.ok(operationNames.includes('terminal-progress-settlement'))
    assert.ok(operationNames.includes('terminalize-key-only'))
    assert.ok(operationNames.includes('terminalize-non-profile-landing'))
    assert.ok(operationNames.includes('terminalize-profile-redirect-mismatch'))
})

test('dashboard ready is display-only until explicit resume', () => {
    const source = readRepoFile('shared/js/sw.js')
    const browserSessionRuntime = readRepoFile('shared/js/swBrowserSessionRuntime.js')
    const activateBody = extractFunction(browserSessionRuntime, 'function markQuoraRuntimeActivated(reason = \'quora-observed\')')
    const restoreBody = extractFunction(source, 'async function restoreCoordinatorPageForStoredWorkOnce(options = {})')
    const reconcileTickBody = extractFunction(source, 'async function runScheduledCoordinatorReconcileTick(reason = \'coordinator-reconcile-tick\')')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const readyIndex = bootstrap.indexOf("request.action === 'coordinator-page-ready'")
    const pauseIndex = bootstrap.indexOf("request.action === 'pause-coordinator-nukes'")
    assert.notEqual(readyIndex, -1)
    assert.notEqual(pauseIndex, -1)

    const readyBranch = bootstrap.slice(readyIndex, pauseIndex)
    assert.doesNotMatch(readyBranch, /kickCoordinatorQueueResume\('dashboard-ready'\)/)
    assert.doesNotMatch(readyBranch, /scheduleCoordinatorReconcile\(1000\)/)
    assert.doesNotMatch(readyBranch, /ensureQuoraRuntimeActivatedForScheduler/)
    assert.match(readyBranch, /requiresQuoraVisit: true/)
    assert.match(activateBody, /startQueueWakeupMetricsBackedStartupWork\(\{force: true\}\)/)
    assert.doesNotMatch(activateBody, /restoreCoordinatorPageForPersistentRetry/)
    assert.doesNotMatch(activateBody, /scheduleCoordinatorReconcile/)
    assert.doesNotMatch(activateBody, /kickCoordinatorQueueResume/)
    assert.match(restoreBody, /recoverStoredCoordinatorWork\('coordinator-page-restore'/)
    assert.match(restoreBody, /options\.openDisplay === true/)
    assert.match(restoreBody, /serviceWorkerRecoveryFirst: true/)
    assert.ok(
        restoreBody.indexOf("recoverStoredCoordinatorWork('coordinator-page-restore'") <
        restoreBody.indexOf('openCoordinatorPage')
    )
    assert.match(reconcileTickBody, /runCoordinatorReconcileTick\(reason, \{[\s\S]*allowBeforeQuora: true/)
    assert.match(source, /scheduleCoordinatorReconcile\(1000(?:,|\))/)
})

test('coordinator executor startup awaits tab filling unless explicitly plan-only', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function enqueueExistingExecutorForCoordinatorOnce(items = [], coordinator = {}, options = {})')
    const resumeBody = extractFunction(source, 'async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {})')
    const userStartBody = extractFunction(source, 'async function startUserInitiatedCoordinatorQueueResume(reason = \'dashboard-resume\', options = {})')

    assert.match(body, /options\.awaitFill !== false/)
    assert.match(body, /await fillQueuedTabs\(fillOptions\)/)
    assert.doesNotMatch(body, /void fillQueuedTabs\(fillOptions\)/)
    assert.match(body, /pauseAlreadyChecked: options\.pauseAlreadyChecked === true/)
    assert.match(resumeBody, /awaitFill: options\.awaitFill !== false/)
    assert.match(resumeBody, /planLimit: options\.planLimit \?\? options\.executorPlanLimit \?\? options\.actionBudget/)
    assert.match(userStartBody, /const requestedActionBudget = Math\.max\(1, Number\.parseInt\(options\.actionBudget, 10\) \|\| 3\)/)
    assert.match(userStartBody, /actionBudget: requestedActionBudget/)
    assert.match(userStartBody, /planLimit: requestedActionBudget/)
    assert.doesNotMatch(userStartBody, /Math\.min\(Number\.parseInt\(options\.actionBudget, 10\) \|\| 3, 5\)/)
})

test('queued executor actions preserve stored foreground policy', () => {
    const source = readRepoFile('shared/js/sw.js')
    const helperBody = extractFunction(readRepoFile('shared/js/swRolledBackQueuedTabRetryClassification.js'), 'function getQueuedActionNoForegroundFallback(item = null, options = {})')
    const activateOnOpenBody = extractFunction(readRepoFile('shared/js/swQueuedForegroundLeaseRuntime.js'), 'function shouldActivateOwnedQueuedTabOnOpen(action = {})')
    const enqueueBody = extractFunction(source, 'async function enqueueExistingExecutorForCoordinatorOnce(items = [], coordinator = {}, options = {})')
    const recoverBody = extractFunction(source, 'async function recoverPendingTabActionFromCoordinatorQueue(sender = {})')
    const adoptBody = extractFunction(source, 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID, options = {})')

    assert.match(helperBody, /item\?\.executorNoForegroundFallback === true/)
    assert.match(helperBody, /item\?\.executorNoForegroundFallback === false/)
    assert.match(helperBody, /options\.noForegroundFallback === true/)
    assert.doesNotMatch(helperBody, /isForegroundQueuedTabAction/)
    assert.match(activateOnOpenBody, /action\?\.active === true/)
    assert.doesNotMatch(activateOnOpenBody, /isForegroundQueuedTabAction/)
    // 2026-09-27 removed enqueueExistingExecutorForCoordinatorOnce's own
    // getQueuedActionNoForegroundFallback-driven concurrency force-to-1,
    // then 2026-09-29 restored it -- see "queued-tab concurrency is forced
    // to 1 for worker-window/foreground work" below for why.
    assert.match(enqueueBody, /getQueuedActionNoForegroundFallback\(item, options\) !== true/)
    assert.match(recoverBody, /const noForegroundFallback = getQueuedActionNoForegroundFallback\(item\)/)
    assert.match(adoptBody, /const noForegroundFallback = getQueuedActionNoForegroundFallback\(item\)/)
    assert.match(adoptBody, /transitionCoordinatorItemForQueuedTab\(pendingAction, liveTab/)
    assert.doesNotMatch(enqueueBody, /noForegroundFallback: true/)
    assert.doesNotMatch(recoverBody, /noForegroundFallback: true/)
    assert.doesNotMatch(adoptBody, /noForegroundFallback: true/)
})

test('queued-tab concurrency is forced to 1 for worker-window/foreground work', () => {
    // 2026-09-27 removed this force-to-1 (see the removed test this
    // replaces, "foreground and unblock-unmute work no longer force
    // queued-tab concurrency down to 1"), reasoning that foreground actions
    // run as background tabs within the shared worker-window window via
    // scripting/page-world injection, so concurrent tabs there weren't
    // inherently unsafe. 2026-09-29: confirmed live that reasoning was
    // wrong -- Chrome throttles a tab's own JS timers (including the
    // content script's close-if-blocked poll) whenever its window lacks OS
    // focus, and a second profile tab opened in the worker window forces
    // the first out of the single "active within window" slot, so *both*
    // ended up throttled. A queued profile tab visibly stalled for over a
    // minute and only resumed once the user manually raised the worker
    // window. Per explicit user request, the worker window should only
    // ever have one tab up (and it foregrounded) at a time, so this force
    // is back for the same batch shapes as before (foreground 'nuke'/
    // 'mute-block'/unblock-unmute -- i.e. virtually all real work).
    const source = readRepoFile('shared/js/sw.js')
    const enqueueBody = extractFunction(source, 'async function enqueueExistingExecutorForCoordinatorOnce(items = [], coordinator = {}, options = {})')

    assert.match(enqueueBody, /requiresForegroundExecutor/)
    assert.match(enqueueBody, /includesUnblockUnmute/)
    assert.match(enqueueBody, /queuedTabConcurrency = serviceWorkerOwned && \(includesUnblockUnmute \|\| requiresForegroundExecutor\)\n\s*\? 1\n\s*: Math\.max\(1, Number\.parseInt\(options\.maxConcurrent, 10\) \|\| 1\)/)
})

test('queued tab opens wait for target URL before active transition', () => {
    const source = readRepoFile('shared/js/sw.js')
    const executorSource = readRepoFile('shared/js/swexecutor.js')
    const createBody = extractFunction(source, 'async function createOwnedTab(action = {}, attempt = {})')
    const ensureBody = extractFunction(source, 'async function ensureCreatedQueuedTabCommittedToExpectedUrl(tab = null, action = {}, options = {})')
    const executorEnsureBody = extractFunction(executorSource, 'async function ensureCreatedQueuedTabCommittedToExpectedUrl(tab = null, action = {}, options = {})')
    const executorWaitBody = extractFunction(executorSource, 'async function waitForQueuedTabExpectedOpenUrl(tabId = null, expectedUrl = \'\', timeoutMs = openUrlCommitTimeoutMs)')

    assert.match(source, /const QUEUED_TAB_OPEN_URL_COMMIT_TIMEOUT_MS = 5000/)
    assert.match(createBody, /ensureCreatedQueuedTabCommittedToExpectedUrl\(surfaceTab, action, options\)/)
    assert.match(createBody, /ensureCreatedQueuedTabCommittedToExpectedUrl\(tab, action, options\)/)
    assert.match(createBody, /ensureCreatedQueuedTabCommittedToExpectedUrl\(tab, action, fallbackOptions\)/)
    assert.match(ensureBody, /queuedTabOpenUrlCommitHelpers\.ensureCreatedQueuedTabCommittedToExpectedUrl\(tab, action, options\)/)
    assert.match(executorEnsureBody, /queuedTabMatchesExpectedOpenUrl\(tab, expectedUrl\)/)
    assert.match(executorEnsureBody, /browser\.tabs\.update\(tabId, \{url: expectedUrl\}\)/)
    assert.match(executorEnsureBody, /job\.tabOpenUrlCommitFailed/)
    assert.match(executorEnsureBody, /queued-tab-open-url-not-committed/)
    assert.match(executorWaitBody, /getQueuedExecutorTabStatusWithTimeout\(tabId, 'queued-tab-open-url-commit'\)/)
    assert.match(executorWaitBody, /setTimeoutFn\(resolve, pollMs\)/)
})

test('background tab opening updates authoritative Current Work', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function fillQueuedTabsOnce(options = {})')
    // buildQueuedTabOpenEffectPlan/buildQueuedTabOpenedProgressPatch moved to
    // swQueuedTabOpenEffect.js in decomposition Slice 41.
    const queuedTabOpenEffectSource = readRepoFile('shared/js/swQueuedTabOpenEffect.js')
    const planBody = extractFunction(queuedTabOpenEffectSource, 'function buildQueuedTabOpenEffectPlan(action = {}, tab = {}, openedAt = now())')
    const progressBody = extractFunction(queuedTabOpenEffectSource, 'function buildQueuedTabOpenedProgressPatch(plan = {}, transition = {})')
    const activeEffectBody = extractFunction(source, 'async function confirmQueuedTabOpenDurableActiveEffect(action = {}, tab = {}, plan = {}, options = {})')
    // the activeTransitionContinued guard was extracted to
    // decideActiveTransitionContinuationChoice in decomposition Slice P2-11,
    // then moved to swQueuedTabActiveTransitionDecisions.js in Slice P2.5-1.
    const continuationChoiceBody = extractFunction(readRepoFile('shared/js/swQueuedTabActiveTransitionDecisions.js'), 'function decideActiveTransitionContinuationChoice(params = {})')
    const ensureContentBody = extractFunction(source, 'async function ensureQueuedTabContentScript(tabId, reason = \'\')')
    const transitionIndex = body.indexOf('confirmQueuedTabOpenDurableActiveEffect(next, tab, openPlan, {')
    const progressIndex = body.indexOf('recordCoordinatorJobProgressViaQueueMachine(openPlan.profileHref')
    const failedTransitionIndex = activeEffectBody.indexOf('if(!activeTransitionAccepted)')
    const ensureIndex = body.indexOf("ensureQueuedTabContentScript(tab.id, 'queued-tab-opened')")
    const rollbackBody = extractFunction(source, 'async function mutateCoordinatorQueuedTabOpenRollback(operation = {})')
    const transitionBody = extractFunction(source, 'async function transitionCoordinatorItemForQueuedTabLocked(action = {}, tab = {}, details = {}, href = \'\', coordinatorKey = \'\')')
    const confirmBody = extractFunction(source, 'async function confirmQueuedTabDurablyActive(action = {}, tab = {}, details = {})')
    // shouldKeepQueuedTabOpenAfterActiveTransitionFailure moved to
    // swCoordinatorReconcileSupportSingles.js in decomposition Slice 43.
    const keepOpenBody = extractFunction(readRepoFile('shared/js/swCoordinatorReconcileSupportSingles.js'), 'function shouldKeepQueuedTabOpenAfterActiveTransitionFailure(action = {}, tab = {}, details = {})')

    assert.notEqual(transitionIndex, -1)
    assert.notEqual(progressIndex, -1)
    assert.notEqual(failedTransitionIndex, -1)
    assert.notEqual(ensureIndex, -1)
    assert.match(ensureContentBody, /nudgeQueuedTabActionClaimWithRetries\(normalizedTabId,/)
    assert.ok(ensureIndex < transitionIndex)
    assert.ok(transitionIndex < progressIndex)
    assert.match(body, /const earlyContentEnsurePromise = options\.returnAfterDurableActive === true[\s\S]*ensureQueuedTabContentScript\(tab\.id, 'queued-tab-opened'\)/)
    assert.match(source, /QUEUED_TAB_ACTIVE_TRANSITION_TIMEOUT_MS = SPACE_FEED_STORAGE_UPDATE_TIMEOUT_MS \+ 5000/)
    assert.match(source, /QUEUED_TAB_FAST_ACTIVE_TRANSITION_TIMEOUT_MS = 5000/)
    assert.match(activeEffectBody, /activeTransitionAccepted = await promiseWithTimeout/)
    assert.match(activeEffectBody, /const returnAfterDurableActive = options\.returnAfterDurableActive === true/)
    assert.match(activeEffectBody, /const activeTransitionTimeoutMs = returnAfterDurableActive[\s\S]*QUEUED_TAB_FAST_ACTIVE_TRANSITION_TIMEOUT_MS[\s\S]*QUEUED_TAB_ACTIVE_TRANSITION_TIMEOUT_MS/)
    assert.match(activeEffectBody, /activeTransitionPromise[\s\S]*markQueuedTabDurablyActive\(tab\.id, 'active-transition-deferred-settled'\)/)
    assert.match(activeEffectBody, /transitionCoordinatorItemForQueuedTab\(action, tab/)
    assert.ok(
        activeEffectBody.indexOf("markQueuedTabDurablyActive(tab.id, 'active-transition')") <
        activeEffectBody.indexOf("getQueuedExecutorTabStatusWithTimeout(tab?.id, 'active-transition-post-confirm')")
    )
    assert.match(transitionBody, /getQueuedTabMetadata\(tabId\)/)
    assert.match(transitionBody, /if\(!tabId\) \{[\s\S]*queued-tab-missing-tab-id[\s\S]*return false/)
    assert.match(transitionBody, /metadata\?\.actionSurfaceMode/)
    assert.doesNotMatch(transitionBody, /if\(!tabId \|\| !activeQueuedTabs\.has\(tabId\)\)/)
    assert.doesNotMatch(transitionBody, /if\(!metadata\) \{[\s\S]*return false/)
    assert.doesNotMatch(transitionBody, /metadata\?\.closeRequestedAt \|\| metadata\?\.closeReason/)
    assert.match(transitionBody, /coordinatorQueueReader\.runs\(\{[\s\S]*metricPath: 'activeTransition\.load'/)
    assert.doesNotMatch(transitionBody, /metricStorageGet\(/)
    assert.doesNotMatch(transitionBody, /latestMetadata/)
    assert.match(transitionBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'active-transition'/)
    assert.doesNotMatch(transitionBody, /context\.reject\('queued-tab-runtime-detached'\)/)
    assert.doesNotMatch(transitionBody, /context\.reject\('queued-tab-metadata-missing'\)/)
    assert.doesNotMatch(transitionBody, /context\.reject\('queued-tab-closing'\)/)
    assert.doesNotMatch(transitionBody, /activeQueuedTabs\.has\(tabId\)/)
    assert.match(transitionBody, /expectedAttemptId/)
    assert.match(transitionBody, /expectedAttemptNumber/)
    assert.match(transitionBody, /metricPath: 'activeTransition\.save'/)
    assert.match(transitionBody, /projectionPayload: 'queueViewOnly'/)
    assert.match(transitionBody, /const rawProvidedAuthorityState = details\.useCurrentAuthorityState === true[\s\S]*details\.currentAuthorityState \|\| details\.authorityState/)
    // D1: the raw-fallback force flag is retired; the transition reads the resident authority with no forced fresh read.
    assert.doesNotMatch(transitionBody, /rawQueueFallback|forceFreshActiveTransitionAuthority|forceFreshAuthorityState/)
    assert.doesNotMatch(transitionBody, /deferProjectionSave: true/)
    assert.doesNotMatch(transitionBody, /projectionReconcileDelayMs: 30000/)
    assert.match(transitionBody, /if\(runsChanged\) \{[\s\S]*saveCoordinatorState\(\{[\s\S]*runs: nextRuns[\s\S]*\}, \{[\s\S]*queue: false,[\s\S]*runs: true,[\s\S]*reason: 'ordinaryMutation',[\s\S]*queueOperation: 'active-transition-derived'/)
    assert.doesNotMatch(transitionBody, /saveCoordinatorQueueRunsProjection\(/)
    assert.match(transitionBody, /return true/)
    assert.match(confirmBody, /await coordinatorQueueReader\.full\(\{[\s\S]*metricPath: 'pendingTabAction\.confirm\.load'[\s\S]*\}\)/)
    // P4: a failed load rejects the confirm. It is never swallowed and read as "no row".
    assert.doesNotMatch(confirmBody, /\.catch\(\(\) => null\)/)
    assert.doesNotMatch(confirmBody, /pendingTabAction\.confirm\.residentAuthorityFallback/)
    assert.doesNotMatch(confirmBody, /loadCoordinatorState\(/)
    assert.match(rollbackBody, /coordinatorQueueReader\.runs\(\{[\s\S]*metricPath: 'rollbackActiveTransition\.load'/)
    assert.doesNotMatch(rollbackBody, /metricStorageGet\(/)
    assert.match(rollbackBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'rollback-active-transition'/)
    assert.match(rollbackBody, /projectionPayload: 'queueViewOnly'/)
    // 2026-09-29: migrated onto applyCoordinatorRunsUpdate (see
    // mutated-running-total-audit-todo-2026-09-25.md).
    assert.match(rollbackBody, /applyCoordinatorRunsUpdate\(nextQueue, affectedRunIds, \{[\s\S]*queueOperation: 'rollback-active-transition-derived'/)
    assert.doesNotMatch(rollbackBody, /saveCoordinatorQueueRunsProjection\(/)
    assert.match(rollbackBody, /status: 'queued'/)
    assert.match(rollbackBody, /actionLeaseReleaseReason: 'active-transition-failed'/)
    assert.match(rollbackBody, /return true/)
    assert.match(keepOpenBody, /hasActiveQueuedTabActionPhaseProgress\(record, metadata\)/)
    assert.match(keepOpenBody, /hasMismatchedCoordinatorAttempt\(expectedAttempt, record\)/)
    assert.match(activeEffectBody, /activeTransitionTimeoutMs/)
    assert.match(activeEffectBody, /catch\(error\)/)
    assert.match(activeEffectBody, /activeTransitionError/)
    assert.match(activeEffectBody, /activeTransitionContinued/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /confirmQueuedTabDurablyActive\(action, tab/)
    assert.match(continuationChoiceBody, /shouldKeepQueuedTabOpenAfterActiveTransitionFailure\(/)
    assert.match(continuationChoiceBody, /scheduleCoordinatorQueueResume\(1000, 'active-transition-continued', \{[\s\S]*allowBeforeQuora: true/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /scheduleCoordinatorQueueResume\(1000, 'active-transition-unconfirmed', \{[\s\S]*allowBeforeQuora: true/)
    assert.match(activeEffectBody, /if\(returnAfterDurableActive && !activeTransitionAccepted && !activeTransitionSettled\) \{[\s\S]*activeTransitionUnconfirmedReason: 'fast-path-storage-lane-timeout'[\s\S]*markQueuedTabDurablyActive\(tab\.id, 'active-transition-fast-unconfirmed'\)[\s\S]*scheduleQueuedWorkContinuation\('active-transition-fast-unconfirmed'\)[\s\S]*activeTransitionFastUnconfirmed: true/)
    assert.ok(
        activeEffectBody.indexOf('if(returnAfterDurableActive && !activeTransitionAccepted && !activeTransitionSettled)') <
        activeEffectBody.indexOf('confirmQueuedTabDurablyActive(action, tab')
    )
    assert.match(planBody, /status: 'tab-opening'/)
    assert.match(progressBody, /activeTransitionAccepted/)
    assert.match(progressBody, /activeTransitionContinued/)
    assert.match(body.slice(progressIndex, progressIndex + 1800), /\{senderTabId: tab\.id\}/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /active-transition-failed/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /rollbackFailedQueuedTabOpen\(action, tab/)
    assert.match(activeEffectBody.slice(failedTransitionIndex), /detachQueuedTabRuntimeState\(tab\.id, 'active-transition-failed'\)/)
    // review-2 S5-3: the fire-and-forget release goes through releaseQueuedTabInBackground, which records a failure.
    assert.match(activeEffectBody.slice(failedTransitionIndex), /void releaseQueuedTabInBackground\(tab\.id, \{[\s\S]*runtimeDetached: true/)
    assert.doesNotMatch(body.slice(progressIndex, progressIndex + 900), /recordProfileNukeProgress\(openPlan\.profileHref/)
})

test('stale queued tab retry gets a fresh attempt identity', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(
        readRepoFile('shared/js/swQueuedTabRetryStaleReconcile.js'),
        'function buildRetryQueuedTabAction(metadata = null, record = null, options = {})'
    )
    const advanceBody = extractFunction(
        source,
        'async function advanceCoordinatorQueueForStaleRetryAction(action = null, at = Date.now())'
    )
    const advanceMutationBody = extractFunction(
        source,
        'async function mutateCoordinatorStaleRetryQueuedTabAdvance(operation = {})'
    )
    const sweepBody = extractFunction(source, 'async function sweepStaleQueuedTabs(parentTabId = null, options = {})')
    const advanceIndex = sweepBody.indexOf('await advanceCoordinatorQueueForStaleRetryAction(retryAction, closedAt)')
    const enqueueIndex = sweepBody.indexOf('queueRuntime.enqueueActivationIntent(markQueuedTabExecutorActionPlanned(')

    assert.match(body, /const attemptId = makeAttemptId\(\)/)
    assert.match(body, /const attemptNumber = getNextAttemptNumberFromValue\(metadata\)/)
    assert.match(body, /const sourceAttemptId = getAttemptIdFromValue\(metadata\) \|\| getAttemptIdFromValue\(record\)/)
    assert.match(body, /const sourceAttemptNumber = getAttemptNumberFromValue\(metadata\) \|\| getAttemptNumberFromValue\(record\)/)
    assert.match(body, /sourceAttemptId,\s*\n\s*sourceAttemptNumber,/)
    assert.match(body, /attemptId,\s*\n\s*attemptNumber,/)
    assert.doesNotMatch(body, /attemptId: metadata\?\.attemptId/)
    assert.doesNotMatch(body, /attemptNumber: metadata\?\.attemptNumber/)
    assert.match(advanceBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'STALE_RETRY_ADVANCE'/)
    assert.match(advanceMutationBody, /const sourceAttemptId = normalizeAttemptId\(action\?\.sourceAttemptId/)
    assert.match(advanceMutationBody, /const sourceAttemptNumber = Number\.parseInt\(action\?\.sourceAttemptNumber, 10\) \|\| 0/)
    assert.match(advanceMutationBody, /const currentAttemptId = getAttemptIdFromValue\(item\)/)
    assert.match(advanceMutationBody, /const currentAttemptNumber = getAttemptNumberFromValue\(item\)/)
    assert.match(advanceMutationBody, /if\(!sourceAttemptId \|\| !sourceAttemptNumber \|\| !currentAttemptId \|\| !currentAttemptNumber\) return false/)
    assert.match(advanceMutationBody, /if\(sourceAttemptId !== currentAttemptId \|\| sourceAttemptNumber !== currentAttemptNumber\) return false/)
    assert.match(advanceMutationBody, /reduceJobEvent\(currentItem, \{[\s\S]*type: JOB_EVENT_RETRY/)
    assert.match(advanceMutationBody, /attemptId/)
    assert.match(advanceMutationBody, /attemptNumber/)
    assert.match(advanceMutationBody, /coordinatorQueueReader\.runs\(\{[\s\S]*metricPath: 'staleRetry\.load'/)
    assert.match(advanceMutationBody, /coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'stale-retry'/)
    assert.match(advanceMutationBody, /expectedAttemptId: sourceAttemptId/)
    assert.match(advanceMutationBody, /expectedAttemptNumber: sourceAttemptNumber/)
    assert.match(advanceMutationBody, /currentAuthorityState/)
    assert.match(advanceMutationBody, /context\.reject\('retry-reducer-rejected'\)/)
    assert.doesNotMatch(advanceMutationBody, /metricStorageGet\(/)
    assert.doesNotMatch(advanceMutationBody, /saveCoordinatorQueueRunsProjection\(/)
    // 2026-09-29: migrated onto applyCoordinatorRunsUpdate (see
    // mutated-running-total-audit-todo-2026-09-25.md).
    assert.match(advanceMutationBody, /applyCoordinatorRunsUpdate\(nextQueue, affectedRunIds, \{[\s\S]*queueOperation: 'stale-retry-derived'/)
    assert.match(advanceMutationBody, /if\(nextItem && `\$\{nextItem\.status \|\| ''\}`\.trim\(\) === 'queued'\) \{[\s\S]*scheduleCoordinatorQueueResume\(1000, 'stale-retry-continuation', \{[\s\S]*allowBeforeQuora: true/)
    assert.doesNotMatch(advanceMutationBody, /reason: 'stale-retry-continuation'[\s\S]{0,220}scheduleCoordinatorReconcile/)
    assert.match(sweepBody, /attemptId: retryAction \? retryAction\.attemptId : getAttemptIdFromValue\(metadata\) \|\| getAttemptIdFromValue\(progressRecord\)/)
    assert.match(sweepBody, /attemptNumber: retryAction \? retryAction\.attemptNumber : getAttemptNumberFromValue\(metadata\) \|\| getAttemptNumberFromValue\(progressRecord\)/)
    assert.notEqual(advanceIndex, -1)
    assert.notEqual(enqueueIndex, -1)
    assert.ok(advanceIndex < enqueueIndex)
})

test('queued tab open lets durable queued authority outrank stale successful progress', () => {
    const body = extractFunction(
        readRepoFile('shared/js/sw.js'),
        'async function shouldOpenQueuedTabAction(action = null, options = {})'
    )
    const authorityReadIndex = body.indexOf("verifyCoordinatorAuthorityStateForRowsCheap('shouldOpenQueuedTabAction.fallback', [normalizedHref || coordinatorKey])")
    const successIndex = body.indexOf('isSuccessfulProfileNukeRecord(progressRecord)')
    const terminalIndex = body.indexOf('if(isTerminalCoordinatorStatus(item.status))')
    const nonQueuedIndex = body.indexOf("if(`${item.status || ''}`.trim() !== 'queued')")
    const openIndex = body.indexOf("return {open: true, reason: 'queued-coordinator-item', decisionBranch: 'queued-coordinator-item'}")

    assert.notEqual(authorityReadIndex, -1)
    assert.notEqual(successIndex, -1)
    assert.notEqual(terminalIndex, -1)
    assert.notEqual(nonQueuedIndex, -1)
    assert.notEqual(openIndex, -1)
    assert.ok(authorityReadIndex < successIndex)
    assert.ok(terminalIndex < successIndex)
    assert.ok(nonQueuedIndex < successIndex)
    assert.ok(successIndex < openIndex)
    assert.match(body, /options\.currentAuthorityState \|\| options\.authorityState/)
    assert.match(body, /reason: 'successful-progress-record'/)
})

test('queued progress keeps sender tab id in persisted records', () => {
    const source = readRepoFile('shared/js/sw.js')
    // addSenderTabIdToProgressPatch moved to swProfileProgressMerge.js in
    // decomposition Slice 30.
    const helperBody = extractFunction(readRepoFile('shared/js/swProfileProgressMerge.js'), 'function addSenderTabIdToProgressPatch(patch = {}, senderTabId = null)')
    // getActiveCoordinatorDirectProgressRuntimeRejectionReason moved to
    // swCoordinatorProgressRules.js in decomposition Slice 12.
    const runtimeGuardBody = extractFunction(readRepoFile('shared/js/swCoordinatorProgressRules.js'), 'function getActiveCoordinatorDirectProgressRuntimeRejectionReason(item = {}, patch = {}, mapped = {}, options = {})')
    const batchBody = extractFunction(source, 'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})')
    const deferredBody = extractFunction(source, 'async function recordDeferredCoordinatorJobMilestone(profileHref = \'\', patch = {}, options = {})')
    const requestBody = extractFunction(source, 'async function recordJobProgressFromRequest(request = {}, sender = {}, options = {})')

    // review-2 S4-1: the authenticated sender is read first; the body's patch.tabId only when no sender was passed.
    assert.match(helperBody, /normalizeTabId\(senderTabId \|\| patch\?\.tabId\)/)
    assert.match(batchBody, /addSenderTabIdToProgressPatch\(patch, options\.senderTabId\)/)
    assert.match(batchBody, /coordinatorQueueReader\.runsScopedProgressForMutation\(\{[\s\S]*metricPath: options\.expectTerminal === true \? 'terminalProgress\.load' : 'directProgress\.load'/)
    assert.match(batchBody, /residentMetricPath: options\.expectTerminal === true[\s\S]*'terminalProgress\.usedResidentAuthority'[\s\S]*'directProgress\.usedResidentAuthority'/)
    assert.doesNotMatch(batchBody, /loadCoordinatorState\(/)
    assert.match(batchBody, /saveProfileNukeProgressRowProjection\([\s\S]*inlineProgressProjectionRecords/)
    assert.match(runtimeGuardBody, /if\(isTerminalCoordinatorStatus\(mapped\?\.status\)\) return ''/)
    assert.match(runtimeGuardBody, /if\(!item\) return ''/)
    assert.match(runtimeGuardBody, /itemStatus === 'queued' && isActiveCoordinatorStatus\(mapped\?\.status \|\| ''\)/)
    assert.match(runtimeGuardBody, /return 'queued-direct-progress-after-runtime-release'/)
    assert.match(runtimeGuardBody, /if\(!isActiveCoordinatorStatus\(itemStatus\)\) return ''/)
    assert.match(runtimeGuardBody, /if\(!isCoordinatorQueueAuthoritativeItem\(item\)\) return ''/)
    assert.match(runtimeGuardBody, /queueRuntime\.hasActiveQueuedTab\(tabId\)/)
    assert.match(runtimeGuardBody, /getQueuedTabMetadata\(tabId\)/)
    assert.match(batchBody, /runtimeRejectionReason = getActiveCoordinatorDirectProgressRuntimeRejectionReason\(item, patch, mapped, options\)/)
    assert.match(batchBody, /reason: runtimeRejectionReason/)
    assert.match(batchBody, /mutate\(currentItem, context\)/)
    assert.match(batchBody, /projectionPayload: 'queueViewOnly'/)
    assert.match(batchBody, /currentRuntimeRejectionReason = getActiveCoordinatorDirectProgressRuntimeRejectionReason\(currentItem, patch, mapped, options\)/)
    assert.match(batchBody, /context\.reject\(currentRuntimeRejectionReason\)/)
    assert.doesNotMatch(batchBody, /progress: progressChanged/)
    assert.match(deferredBody, /addSenderTabIdToProgressPatch\(patch, options\.senderTabId\)/)
    assert.match(requestBody, /recordDeferredCoordinatorJobMilestone\(targetProfileHref, patch,[\s\S]*senderTabId: tabId/)
    assert.match(requestBody, /recordCoordinatorJobProgressViaQueueMachine\(targetProfileHref, terminalPatch,[\s\S]*senderTabId: tabId/)
})

test('claim nudge timeout schedules blocked-profile sweep fallback', () => {
    const source = readRepoFile('shared/js/sw.js')
    const nudgeBody = extractFunction(source, 'async function nudgeQueuedTabActionClaim(tabId, reason = \'\')')

    assert.match(nudgeBody, /rememberQueuedTabActivationFailure\(timedOut \? 'claim-nudge-timeout' : 'claim-nudge-failed'/)
    assert.doesNotMatch(nudgeBody, /rememberQueueLoadPressure\(timedOut \? 'claim-nudge-timeout' : 'claim-nudge-failed'/)
    assert.match(nudgeBody, /terminalizeAlreadyBlockedQueuedTab\([\s\S]*normalizedTabId,[\s\S]*'claim-nudge-timeout-already-blocked'/)
    assert.match(nudgeBody, /if\(timedOut\) \{[\s\S]*scheduleOwnedBlockedProfileSweep\(metadata\?\.ownerTabId \|\| SERVICE_WORKER_QUEUE_OWNER_ID, 1000\)/)
})

test('terminal/direct progress can mutate from resident authority without storage projection read', () => {
    const source = readRepoFile('shared/js/sw.js')
    const helperBody = extractFunction(source, 'async function loadCoordinatorQueueRunsScopedProgressProjectionForMutation(options = {})')
    const batchBody = extractFunction(source, 'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})')

    // The mutation's progress base is the resident copy, read after the gate (P2). There is no storage read and no fallback.
    assert.match(helperBody, /await awaitResidentCoordinatorState\(\)/)
    assert.match(helperBody, /getResidentCoordinatorCopies\(\)/)
    assert.match(helperBody, /getResidentProgressRecords\(stored, progressProfileHrefs, \{includeView: false\}\)/)
    assert.match(helperBody, /residentAuthority: true/)
    assert.doesNotMatch(helperBody, /metricStorageGet\(/)
    assert.doesNotMatch(helperBody, /getHydratedCoordinatorAuthorityState\(/)
    assert.match(batchBody, /coordinatorQueueReader\.runsScopedProgressForMutation/)
    assert.doesNotMatch(batchBody, /await loadCoordinatorQueueRunsScopedProgressProjection\(/)
})

test('dashboard resume polls are alarm-backed but user starts run direct authority reconcile', () => {
    const source = readRepoFile('shared/js/sw.js')
    const kickBody = extractFunction(source, 'async function kickCoordinatorQueueResume(reason = \'resume-request\', options = {})')
    const userStartBody = extractFunction(source, 'async function startUserInitiatedCoordinatorQueueResume(reason = \'dashboard-resume\', options = {})')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const resumeIndex = bootstrap.indexOf("request.action === 'resume-coordinator-queue'")
    const retryIndex = bootstrap.indexOf("request.action === 'retry-coordinator-failed'")
    const resumeBranch = bootstrap.slice(resumeIndex, retryIndex)

    assert.match(kickBody, /coordinatorQueueResumeScheduler\.isAlarmCreatedForCurrentDueAt\(\)/)
    assert.match(kickBody, /alarmCreated/)
    assert.match(kickBody, /runCoordinatorReconcileTick\(reason/)
    assert.match(kickBody, /options\.backgroundFastPath === true/)
    assert.match(kickBody, /let backgroundFastResumePromise = null/)
    assert.match(kickBody, /backgroundFastResumePromise = runCoordinatorQueueExecutorFastPath\(reason \|\| 'resume-request'/)
    assert.match(kickBody, /promiseWithTimeout\([\s\S]*backgroundFastResumePromise,[\s\S]*responseBudgetMs,[\s\S]*'background fast resume response budget'/)
    assert.match(kickBody, /scheduleCoordinatorQueueResume\(1000, 'background-fast-resume-failed'/)
    assert.match(kickBody, /allowBeforeQuora: options\.allowBeforeQuora === true/)
    assert.match(kickBody, /forceDurableQueueReload: options\.forceDurableQueueReload === true/)
    assert.match(kickBody, /runCoordinatorQueueExecutorFastPath\(reason \|\| 'resume-request'/)
    assert.match(kickBody, /scheduleCoordinatorQueueResume\(600, reason \|\| 'resume-request'\)/)
    assert.match(kickBody, /ensureQuoraRuntimeActivatedForScheduler\('resume-existing-quora-tab'\)/)
    assert.match(kickBody, /resumeScheduled/)
    assert.match(kickBody, /scheduledOnly/)
    assert.match(bootstrap, /alarm\?\.name === COORDINATOR_RESUME_ALARM_NAME/)
    assert.match(bootstrap, /ensureQuoraRuntimeActivatedForScheduler\('resume-alarm-existing-quora-session'\)/)
    assert.match(bootstrap, /const allowBeforeQuora = await shouldAllowStoredWorkBeforeQuora\('resume-alarm-stored-work'\)/)
    assert.match(bootstrap, /return runScheduledCoordinatorQueueResume\('resume-alarm', \{allowBeforeQuora\}\)/)
    assert.match(source, /async function runScheduledCoordinatorQueueResume\(reason = '', options = \{\}\)/)
    const scheduledResumeBody = extractFunction(source, "async function runScheduledCoordinatorQueueResume(reason = '', options = {})")
    // D1: the raw legacy queue preload is retired; the scheduled resume reads only the WAL-backed resident queue.
    assert.doesNotMatch(scheduledResumeBody, /scheduledRawQueue|rawQueue|COORDINATOR_QUEUE_KEY/)
    assert.match(source, /runCoordinatorQueueExecutorFastPath\(resumeReason/)
    assert.match(source, /continueAfterAuthorityPreflight: true/)
    assert.match(source, /forceDurableQueueReload: true/)
    assert.match(source, /coordinatorQueueResumeScheduler\.clearSchedule\(\)/)
    assert.match(resumeBranch, /const userInitiated = request\.userInitiated === true/)
    assert.match(resumeBranch, /if\(userInitiated\) \{[\s\S]*return startUserInitiatedCoordinatorQueueResume\('dashboard-resume'/)
    assert.match(resumeBranch, /return kickCoordinatorQueueResume\('dashboard-resume', \{[\s\S]*backgroundFastPath: true[\s\S]*\}\)/)
    assert.match(source, /async function startUserInitiatedCoordinatorQueueResume/)
    assert.match(source, /runCoordinatorAuthorityReconcileActions\(`\$\{reason \|\| 'dashboard-resume'\}-user-authority`, \{[\s\S]*queueOnlyAuthority: true/)
    assert.match(source, /lastUserStartQueueResult/)
    assert.match(source, /promiseWithTimeout\([\s\S]*runCoordinatorQueueExecutorFastPath\(reason \|\| 'dashboard-resume', \{[\s\S]*awaitFill: options\.awaitFill !== false,[\s\S]*returnAfterDurableActive: true,[\s\S]*forceDurableQueueReload: true/)
    assert.match(source, /scheduledOnly: false/)
    assert.doesNotMatch(source, /void runCoordinatorQueueExecutorFastPath\(reason \|\| 'dashboard-resume', \{[\s\S]*awaitFill: false/)
    assert.doesNotMatch(resumeBranch, /executorFastPath/)
    assert.match(userStartBody, /skipAuthorityReconcile: true/)
    assert.doesNotMatch(userStartBody, /scheduleCoordinatorReconcile\(1000, \{[\s\S]*reason,[\s\S]*edgeTriggered: true/)
    assert.doesNotMatch(userStartBody, /scheduleCoordinatorReconcile\(COORDINATOR_RECONCILE_INTERVAL_MS/)
    assert.doesNotMatch(resumeBranch, /return resumeCoordinatorQueueExecution/)
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
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const updateIndex = bootstrap.indexOf("changeInfo.status === 'complete'")

    assert.match(ensureBody, /browser\.scripting\.executeScript/)
    assert.match(probeBody, /getExpectedContentScriptVersion\(\)/)
    assert.match(probeBody, /versionMatches/)
    assert.match(probeBody, /present: !!result\?\.versionMatches/)
    assert.match(ensureBody, /probe\.marker && expectedVersion && probe\.versionMatches === false/)
    assert.match(ensureBody, /content-script-version-mismatch/)
    assert.match(ensureBody, /versionMismatch: true/)
    assert.match(ensureBody, /files: \['js\/content\.js'\]/)
    assert.match(ensureBody, /files: \['css\/tokens\.css', 'css\/content\.css'\]/)
    assert.match(ensureBody, /contentScriptInjectedAt/)
    assert.match(ensureBody, /metadata\.contentScriptPresentAt \|\| metadata\.contentScriptInjectedAt/)
    assert.doesNotMatch(ensureBody, /metadata\.contentScriptEnsureFailedAt/)
    assert.match(fillBody, /ensureQueuedTabContentScript\(tab\.id, 'queued-tab-opened'\)/)
    assert.match(fillBody, /QUEUED_TAB_CONTENT_SCRIPT_ENSURE_TIMEOUT_MS/)
    assert.notEqual(updateIndex, -1)
    assert.match(bootstrap.slice(updateIndex, updateIndex + 1300), /scheduleQueuedTabContentScriptEnsure\(tabId, 'tab-load-complete'\)/)
})

test('queued tab open plan does not carry executor authority state across tab open', () => {
    const markBody = extractFunction(readRepoFile('shared/js/swRolledBackQueuedTabRetryClassification.js'), 'function markQueuedTabExecutorActionPlanned(action = {}, decision = {}, reason = \'executor-open-planned\')')
    // buildQueuedTabOpenEffectPlan moved to swQueuedTabOpenEffect.js in
    // decomposition Slice 41.
    const planBody = extractFunction(readRepoFile('shared/js/swQueuedTabOpenEffect.js'), 'function buildQueuedTabOpenEffectPlan(action = {}, tab = {}, openedAt = now())')
    const activeDetailsIndex = planBody.indexOf('activeTransitionDetails: {')
    const progressPatchIndex = planBody.indexOf('progressPatch: {')
    const activeDetailsBody = planBody.slice(activeDetailsIndex, progressPatchIndex)

    assert.notEqual(activeDetailsIndex, -1)
    assert.notEqual(progressPatchIndex, -1)
    assert.match(markBody, /executorPlanAuthorityValidated/)
    assert.doesNotMatch(markBody, /executorPlanAuthorityState/)
    assert.doesNotMatch(activeDetailsBody, /currentAuthorityState/)
    assert.doesNotMatch(activeDetailsBody, /authorityState/)
    assert.doesNotMatch(activeDetailsBody, /executorPlanAuthorityState/)
})

test('queued tab fill bounds stale open-decision reads', () => {
    const source = readRepoFile('shared/js/sw.js')
    const planBody = extractFunction(readRepoFile('shared/js/swQueuedTabExecutorPlan.js'), 'async function planQueuedTabExecutorAction(action = {}, options = {})')
    const planLimitBody = extractFunction(readRepoFile('shared/js/swQueuedActivationSubjectKeys.js'), 'function getCoordinatorExecutorPlanBatchLimit(ownerTabId = null, options = {})')
    const finalCheckBody = extractFunction(source, 'async function validateQueuedTabOpenAgainstCurrentAuthority(action = {})')
    const fillBody = extractFunction(source, 'async function fillQueuedTabsOnce(options = {})')
    const enqueueBody = extractFunction(source, 'async function enqueueExistingExecutorForCoordinatorOnce(items = [], coordinator = {}, options = {})')
    const finalCheckIndex = fillBody.indexOf('validateQueuedTabOpenAgainstCurrentAuthority(next')
    const createIndex = fillBody.indexOf('createOwnedTab(next, createAttempt)')
    const boundedCreateIndex = fillBody.indexOf("'queued owned tab create'")

    assert.match(planBody, /promiseWithTimeout\(\s*shouldOpenQueuedTabAction\(action, \{[\s\S]*currentAuthorityState: options\.currentAuthorityState \|\| options\.authorityState \|\| null[\s\S]*\}\),\s*QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS,\s*'queued tab open decision'/)
    assert.match(finalCheckBody, /let currentAuthorityState = getHydratedCoordinatorAuthorityState\('pump\.finalOpenDecision\.usedResidentAuthority'\)/)
    assert.match(finalCheckBody, /promiseWithTimeout\(\s*coordinatorQueueReader\.actionRows\('validateQueuedTabOpenAgainstCurrentAuthority\.initial', action\),\s*QUEUED_TAB_DURABLE_CLAIM_TIMEOUT_MS,\s*'queued tab final open authority reload'/)
    assert.match(finalCheckBody, /reason: 'queued-tab-final-open-authority-unavailable'/)
        assert.match(finalCheckBody, /promiseWithTimeout\(\s*shouldOpenQueuedTabAction\(action, \{[\s\S]*currentAuthorityState[\s\S]*\}\),\s*QUEUED_TAB_FINAL_OPEN_DECISION_TIMEOUT_MS,\s*'queued tab final open decision'/)
    assert.match(finalCheckBody, /reason: 'queued-tab-final-open-decision-timeout'/)
    assert.match(source, /const QUEUED_TAB_FINAL_OPEN_DECISION_TIMEOUT_MS = 3000/)
    assert.doesNotMatch(source, /const QUEUED_TAB_FINAL_OPEN_DECISION_TIMEOUT_MS = QUEUED_TAB_DURABLE_CLAIM_TIMEOUT_MS/)
    assert.match(source, /const QUEUED_TAB_PRE_OPEN_RETRY_MS = 250/)
    assert.match(source, /const QUEUED_TAB_PRE_OPEN_FILL_TIMEOUT_RETRY_MS = 1000/)
    assert.match(source, /scheduleCoordinatorQueueResume\(QUEUED_TAB_PRE_OPEN_FILL_TIMEOUT_RETRY_MS, 'queued-tab-fill-timeout-before-open-attempt'/)
    assert.doesNotMatch(source, /scheduleCoordinatorQueueResume\(QUEUED_TAB_CREATE_TIMEOUT_MS \* 6, 'queued-tab-fill-timeout-before-open-attempt'/)
    assert.match(source, /scheduleCoordinatorQueueResume\(\s*QUEUED_TAB_PRE_OPEN_RETRY_MS,\s*normalizedEnqueueMaterializationReason,\s*\{[\s\S]*allowBeforeQuora: true/)
    assert.match(source, /scheduleCoordinatorQueueResume\(\s*QUEUED_TAB_PRE_OPEN_RETRY_MS,\s*materializationReason,\s*\{[\s\S]*allowBeforeQuora: true/)
    assert.doesNotMatch(source, /scheduleCoordinatorQueueResume\(\s*QUEUED_TAB_CREATE_TIMEOUT_MS \* 6,\s*normalizedEnqueueMaterializationReason/)
    assert.doesNotMatch(source, /scheduleCoordinatorQueueResume\(\s*QUEUED_TAB_CREATE_TIMEOUT_MS \* 6,\s*materializationReason/)
    assert.match(planBody, /reason: 'open-decision-timeout'/)
    assert.match(planBody, /open: false/)
    assert.match(finalCheckBody, /open: false/)
    assert.match(planBody, /authorityUnavailable: true/)
    assert.match(finalCheckBody, /authorityUnavailable: true/)
    assert.match(planBody, /queued-tab-open-decision-authority-unavailable/)
    assert.match(finalCheckBody, /queued-tab-final-open-authority-unavailable/)
    assert.match(source, /return \{open: false, reason: 'queue-read-failed', authorityUnavailable: true, decisionBranch: 'authority-load-failed'\}/)
    assert.match(planBody, /authorityValidated: !!\(options\.currentAuthorityState \|\| options\.authorityState\)/)
    assert.match(planBody, /markQueuedTabExecutorActionPlanned\(action, \{[\s\S]*\.\.\.openDecision[\s\S]*authorityValidated:/)
    assert.match(planLimitBody, /getEffectiveQueuedTabConcurrency\(\)/)
    assert.match(planLimitBody, /countQueuedExecutorSlotsForOwner\(ownerTabId\)/)
    assert.match(enqueueBody, /const planBatchLimit = getCoordinatorExecutorPlanBatchLimit\(ownerTabId, options\)/)
    assert.match(enqueueBody, /if\(queued >= planBatchLimit\) \{[\s\S]*batchLimited = true[\s\S]*break/)
    assert.doesNotMatch(fillBody, /prevalidated-current-authority/)
    assert.doesNotMatch(fillBody, /executorPlanAuthorityValidated === true/)
    assert.match(fillBody, /const finalOpenDecision = await validateQueuedTabOpenAgainstCurrentAuthority\(next, \{[\s\S]*currentAuthorityState: options\.currentAuthorityState \|\| null/)
    assert.match(source, /return \{open: false, reason: 'non-queued-coordinator-item', decisionBranch: 'non-queued-coordinator-item'\}/)
    assert.match(source, /return \{open: true, reason: 'queued-coordinator-item', decisionBranch: 'queued-coordinator-item'\}/)
    assert.match(enqueueBody, /const plannedAction = await planQueuedTabExecutorAction/)
    assert.match(enqueueBody, /queueRuntime\.enqueueActivationIntent\(plannedAction, \{[\s\S]*source: 'machine-intent'/)
    assert.match(fillBody, /next\.executorPlanKind !== 'open-tab'/)
    assert.match(fillBody, /planQueuedTabExecutorAction\(next\)/)
    assert.notEqual(finalCheckIndex, -1)
    assert.notEqual(createIndex, -1)
    assert.notEqual(boundedCreateIndex, -1)
    assert.ok(finalCheckIndex < createIndex)
    assert.ok(createIndex < boundedCreateIndex)
})

test('executor apply classifies before reducer decisions instead of pre-filling runtime surfaces', () => {
    const source = readRepoFile('shared/js/sw.js')
    const latchSource = readRepoFile('shared/js/swStorageIdlePromiseLatch.js')
    const reclaimResumeSource = readRepoFile('shared/js/swQueuedTabReclaimResume.js')
    // shouldSkipResumeProjectionFallbackForTrustedAuthority moved to
    // swCoordinatorReconcileSupportSingles.js in decomposition Slice 43.
    const reconcileSupportSinglesSource = readRepoFile('shared/js/swCoordinatorReconcileSupportSingles.js')
    const body = extractFunction(source, 'async function runCoordinatorExecutorApplyPhase(reason = \'coordinator-executor-apply\', options = {})')
    const dropBody = extractFunction(reclaimResumeSource, 'function dropVolatileQueuedActionsForDurableResume(reason = \'resume-rebuild-from-durable-queue\', details = {})')
    const resumeBody = extractFunction(source, 'async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {})')
    // the storage-projection-fallback guard condition was extracted to
    // decideResumeShouldUseFallbackOutcome in decomposition Slice P2-21,
    // then moved to swResumeQueueExecutionDecisions.js in decomposition
    // Slice P2.5-3.
    const shouldUseFallbackBody = extractFunction(readRepoFile('shared/js/swResumeQueueExecutionDecisions.js'), 'function decideResumeShouldUseFallbackOutcome(params = {})')

    assert.doesNotMatch(body, /classifierReducerOwnsRuntimeSurfaces/)
    assert.doesNotMatch(body, /existing-runtime-fill/)
    assert.doesNotMatch(body, /pre-fill-durable-resume/)
    assert.doesNotMatch(body, /const queuedActionsBeforeFill = queuedTabActions\.length/)
    assert.doesNotMatch(body, /const fillResult = await fillQueuedTabs\(/)
    assert.match(body, /const executorClassification = reusableClassification \|\| await classifyCoordinatorExecutorState\(\{[\s\S]*currentAuthorityState,[\s\S]*liveProfileTabsByHref,[\s\S]*progress,[\s\S]*paused: false[\s\S]*\}\)/)
    assert.match(body, /const requeueMissingActiveTabs = options\.requeueMissingActiveTabs !== false/)
    assert.match(body, /const executorClassificationId = executorClassification\.executorClassificationId \|\| ''/)
    assert.match(body, /classificationGeneratedAt/)
    assert.ok(
        body.indexOf('const executorClassification = reusableClassification || await classifyCoordinatorExecutorState') <
        body.indexOf('for(const [itemKey, item] of queueRuntime.getOrderedQueueItems(queue))')
    )
    assert.match(body, /let requeued = 0/)
    assert.doesNotMatch(body, /requeuedMissingActiveTabQueuedForFill/)
    assert.doesNotMatch(body, /pendingItems\.push\(\{[\s\S]*\.\.\.requeuedItem/)
    assert.match(body, /return finishCoordinatorExecutorApplyResult\(\{[\s\S]*requeued,[\s\S]*executorClassificationId,[\s\S]*reason: terminalizedExhausted > 0[\s\S]*'requeued-missing-active-tabs'/)
    assert.match(body, /scheduleCoordinatorQueueResume\(1000, `\$\{reason \|\| 'coordinator-executor'\}-active-requeued`, \{[\s\S]*allowBeforeQuora: true/)
    assert.match(body, /scheduleCoordinatorReconcile\(1000, \{[\s\S]*reason: `\$\{reason \|\| 'coordinator-executor'\}-active-requeued`[\s\S]*edgeTriggered: true,[\s\S]*allowBeforeQuora: true/)
    assert.match(body, /if\(requeued > 0\) \{[\s\S]*changed: true,[\s\S]*requeued,[\s\S]*reason: terminalizedExhausted > 0[\s\S]*'terminalized-requeued-missing-active-tab'[\s\S]*'requeued-missing-active-tabs'/)
    assert.doesNotMatch(body, /options\.forceDurableQueueReload === true \|\| options\.queueOnlyAuthority === true/)
    assert.doesNotMatch(body, /const activeAfterFill = getSchedulerBlockingQueuedExecutorCount\(\)/)
    assert.doesNotMatch(body, /dropVolatileQueuedActionsForDurableResume/)
    const queuedTabRuntimeStatusSourceForExecutorApply = readRepoFile('shared/js/swQueuedTabRuntimeStatus.js')
    assert.match(queuedTabRuntimeStatusSourceForExecutorApply, /function getSchedulerBlockingQueuedExecutorCount\(\)/)
    assert.match(queuedTabRuntimeStatusSourceForExecutorApply, /function getDurablyActiveCoordinatorAuthorityRowCount\(\)/)
    assert.match(queuedTabRuntimeStatusSourceForExecutorApply, /return Math\.max\(\s*getDurablyActiveQueuedTabCount\(\),\s*getDurablyActiveCoordinatorAuthorityRowCount\(\)\s*\)/)
    assert.match(dropBody, /getSchedulerBlockingQueuedExecutorCount\(\) > 0/)
    assert.doesNotMatch(dropBody, /activeQueuedTabs\.size > 0|pendingTabActions\.size > 0/)
    assert.match(resumeBody, /runCoordinatorExecutorApplyPhase\(options\.reason \|\| 'resume'/)
    assert.match(resumeBody, /dropVolatileReason: options\.reason \|\| 'resume-rebuild-from-durable-queue'/)
    assert.match(resumeBody, /const hasTrustedAuthorityStateForResume = !!\([\s\S]*suppliedAuthorityState\?\.queue[\s\S]*residentAuthorityStateForResume\?\.queue[\s\S]*\)/)
    assert.match(reconcileSupportSinglesSource, /function shouldSkipResumeProjectionFallbackForTrustedAuthority\(reason = ''\) \{[\s\S]*terminal-progress[\s\S]*queued-tab-\(\?:slot-\)\?release/)
    assert.match(resumeBody, /const shouldUseProjectionFallbackForResume = forceDurableQueueReload \|\|[\s\S]*!hasTrustedAuthorityStateForResume \|\|[\s\S]*!shouldSkipResumeProjectionFallbackForTrustedAuthority\(options\.reason\)/)
    assert.match(shouldUseFallbackBody, /serviceWorkerOwned &&[\s\S]*options\.awaitFill !== false &&[\s\S]*shouldUseProjectionFallbackForResume &&/)
    assert.match(resumeBody, /decideResumeShouldUseFallbackOutcome\(\{[\s\S]*coordinatorQueueReader\.full\(\{[\s\S]*metricPath: 'pump\.resume\.storageProjectionFallback\.load'/)
    assert.match(reclaimResumeSource, /name: 'volatile-queued-actions-dropped'/)
    assert.match(dropBody, /getQueuedTabFillPromise\(\) && !clearStaleQueuedTabFillPromise\(reason\)/)
    assert.match(dropBody, /pump\.noop\.preservedVolatileQueuedActionsDuringFill/)
    assert.match(source, /const QUEUED_TAB_FILL_PROMISE_STALE_MS = COORDINATOR_FAST_EXECUTOR_RESUME_TIMEOUT_MS/)
    assert.match(source, /const QUEUED_TAB_IDLE_FILL_PROMISE_STALE_MS = 30000/)
    assert.match(latchSource, /function isRuntimeAndStorageIdleForPromiseLatch\(\)/)
    assert.match(source, /let queuedTabFillPromiseStartedAt = 0/)
    assert.match(latchSource, /function clearStaleQueuedTabFillPromise\(reason = 'queued-tab-fill'\)/)
    assert.match(latchSource, /const staleMs = idleLatch[\s\S]*QUEUED_TAB_IDLE_FILL_PROMISE_STALE_MS[\s\S]*QUEUED_TAB_FILL_PROMISE_STALE_MS/)
    assert.match(latchSource, /pump\.changed\.clearedIdleStaleFillPromise/)
    assert.match(latchSource, /name: 'queued-tab-fill-promise-stale-cleared'/)
    assert.match(latchSource, /pump\.changed\.clearedStaleFillPromise/)
})

test('idle storage updates reconcile durable active work before queue fill', () => {
    const source = readRepoFile('shared/js/sw.js')
    const latchSource = readRepoFile('shared/js/swStorageIdlePromiseLatch.js')
    const fastResumeSource = readRepoFile('shared/js/swQueuedWorkFastResume.js')
    const idleBody = extractFunction(latchSource, 'function recordStorageIdleChurnCounters(context = {})')
    const scheduleBody = extractFunction(fastResumeSource, 'function scheduleDurableQueueResumeFromIdleStorage(context = {})')
    const scheduleQueuedOnlyBody = extractFunction(fastResumeSource, "function scheduleQueuedOnlyDurableWorkContinuation(reason = 'queued-only-durable-work', options = {})")

    assert.match(idleBody, /const runtimeCounts = queueRuntime\.getRuntimeCounts\(\)/)
    assert.match(idleBody, /const runtimeHasWork = runtimeCounts\.activeQueuedTabs > 0 \|\|[\s\S]*runtimeCounts\.queuedTabActions > 0 \|\|[\s\S]*runtimeCounts\.pendingTabActions > 0/)
    assert.match(idleBody, /const durableActiveRows = Number\.parseInt\(context\.durableActiveRows, 10\) \|\| 0/)
    assert.match(idleBody, /const durableQueuedRows = Number\.parseInt\(context\.durableQueuedRows, 10\) \|\| 0/)
    assert.match(idleBody, /const durableHasWork = durableActiveRows > 0 \|\| durableQueuedRows > 0/)
    assert.match(idleBody, /const progressProjectionOnlyWrite = \(Number\.parseInt\(context\.profileProgressProjectionOnlyWrites, 10\) \|\| 0\) > 0/)
    assert.match(idleBody, /context\.suppressDurableIdleResume !== true/)
    assert.match(idleBody, /if\(durableHasWork &&[\s\S]*!runtimeHasWork &&[\s\S]*context\.paused !== true &&[\s\S]*\(durableActiveRows > 0 \|\| !progressProjectionOnlyWrite\) &&[\s\S]*context\.suppressDurableIdleResume !== true\) \{[\s\S]*scheduleDurableQueueResumeFromIdleStorage\(context\)/)
    assert.match(scheduleBody, /durableActiveRows > 0[\s\S]*'storage-idle-durable-active-work'[\s\S]*'storage-idle-durable-queued-work'/)
    assert.match(scheduleBody, /incrementQueueWakeupMetric\('storageUpdate\.durableWorkNoRuntime'\)/)
    assert.doesNotMatch(scheduleBody, /scheduleCoordinatorReconcile/)
    assert.match(scheduleBody, /scheduleCoordinatorQueueResume\(1000, reason, \{[\s\S]*allowBeforeQuora: true/)
    assert.match(scheduleBody, /if\(durableActiveRows > 0\) \{[\s\S]*runCoordinatorReconcileTick\(reason, \{[\s\S]*allowBeforeQuora: true,[\s\S]*skipStoredWorkCheck: true,[\s\S]*awaitFill: true/)
    assert.match(scheduleBody, /else if\(durableQueuedRows > 0\) \{[\s\S]*runCoordinatorQueueExecutorFastPath\(reason, \{[\s\S]*awaitFill: true,[\s\S]*returnAfterDurableActive: true,[\s\S]*allowBeforeQuora: true,[\s\S]*skipAuthorityReconcile: true,[\s\S]*forceDurableQueueReload: true/)
    assert.match(latchSource, /function shouldContinueQueuedOnlyWorkWithFastExecutor\(snapshot = \{\}\)/)
    assert.match(fastResumeSource, /function scheduleQueuedOnlyDurableWorkContinuation\(reason = 'queued-only-durable-work', options = \{\}\)/)
    assert.match(scheduleQueuedOnlyBody, /incrementQueueWakeupMetric\('reconcile\.queuedOnlyFastResumeScheduled'\)/)
    assert.match(scheduleQueuedOnlyBody, /runCoordinatorQueueExecutorFastPath\(normalizedReason, \{[\s\S]*returnAfterDurableActive: true,[\s\S]*skipAuthorityReconcile: true,[\s\S]*forceDurableQueueReload: false/)
    assert.match(source, /const COORDINATOR_RECONCILE_PROMISE_STALE_MS = COORDINATOR_FAST_EXECUTOR_RESUME_TIMEOUT_MS/)
    assert.match(source, /const COORDINATOR_IDLE_RECONCILE_PROMISE_STALE_MS = 30000/)
    assert.match(source, /let coordinatorReconcilePromiseStartedAt = 0/)
    const fastExecutorDeferBody = extractFunction(latchSource, "function shouldDeferScheduledResumeDuringFastExecutor(reason = '')")
    assert.match(fastExecutorDeferBody, /terminal-progress\|active-transition\|durable-\(\?:active\|queued\)-work\|storage-idle-durable/)
    assert.match(fastExecutorDeferBody, /getCoordinatorFastExecutorActiveUntil\(\) > getNow\(\)[\s\S]*getCoordinatorResumePromise\(\)[\s\S]*getQueuedTabFillPromise\(\)[\s\S]*getSchedulerBlockingQueuedExecutorCount\(\) > 0[\s\S]*queueRuntime\.getPendingTabActionCount\(\) > 0/)
    assert.doesNotMatch(fastExecutorDeferBody, /queuedTabActions\.length > 0/)
    assert.match(source, /if\(shouldDeferScheduledResumeDuringFastExecutor\(scheduledReason\)\) \{[\s\S]*pump\.deferredDuringFastExecutor/)
    assert.match(latchSource, /function clearStaleCoordinatorReconcilePromise\(reason = 'coordinator-reconcile'\)/)
    assert.match(latchSource, /const staleMs = idleLatch[\s\S]*COORDINATOR_IDLE_RECONCILE_PROMISE_STALE_MS[\s\S]*COORDINATOR_RECONCILE_PROMISE_STALE_MS/)
    assert.match(latchSource, /reconcile\.idleStalePromiseCleared/)
    assert.match(latchSource, /name: 'coordinator-reconcile-promise-stale-cleared'/)
    assert.match(latchSource, /reconcile\.stalePromiseCleared/)

    const fastPathBody = extractFunction(source, "async function runCoordinatorQueueExecutorFastPath(reason = 'resume-fast-executor', options = {})")
    // the authority-preflight guard was extracted to
    // decideFastExecutorAuthorityPreflightOutcome in decomposition Slice P2-15,
    // then moved to swFastExecutorDecisions.js in decomposition Slice P2.5-2.
    const fastExecutorDecisionsSource = readRepoFile('shared/js/swFastExecutorDecisions.js')
    const preflightOutcomeBody = extractFunction(fastExecutorDecisionsSource, 'function decideFastExecutorAuthorityPreflightOutcome(params = {})')
    // the final changed-detection/scheduling/return tail was extracted to
    // decideFastExecutorFinalOutcome in decomposition Slice P2-17, then moved
    // to swFastExecutorDecisions.js in decomposition Slice P2.5-2.
    const finalOutcomeBody = extractFunction(fastExecutorDecisionsSource, 'function decideFastExecutorFinalOutcome(params = {})')
    assert.match(fastPathBody, /let authorityPreflightChanged = false/)
    assert.match(fastPathBody, /options\.continueAfterAuthorityPreflight === true/)
    assert.match(preflightOutcomeBody, /pump\.fastExecutor\.authorityPreflightContinued/)
    assert.match(fastPathBody, /const runtimeCountsAtStart = queueRuntime\.getRuntimeCounts\(\)/)
    assert.match(fastPathBody, /const runtimeSurfaceEmptyAtStart = !getSchedulerBlockingQueuedExecutorCount\(\) &&[\s\S]*runtimeCountsAtStart\.queuedTabActions <= 0 &&[\s\S]*runtimeCountsAtStart\.pendingTabActions <= 0/)
    assert.match(fastPathBody, /const residentAuthorityHasDurableWork = residentAuthorityCounts\.durableActiveRows > 0 \|\|[\s\S]*residentAuthorityCounts\.durableQueuedRows > 0/)
    assert.match(fastPathBody, /const forceDurableQueueReloadForRuntimeRecovery = options\.forceDurableQueueReload === true \|\|[\s\S]*!residentAuthorityHasDurableWork &&[\s\S]*runtimeSurfaceEmptyAtStart &&[\s\S]*options\.awaitFill !== false/)
    assert.match(fastPathBody, /pump\.fastExecutor\.emptyRuntimeInitialDurableReload/)
    assert.match(fastPathBody, /forceDurableQueueReload: forceDurableQueueReloadForRuntimeRecovery/)
    assert.match(fastPathBody, /const forceDurableQueueReload = forceDurableQueueReloadForRuntimeRecovery && authorityPreflightChanged !== true/)
    assert.match(fastPathBody, /const currentAuthorityState = authorityPreflightChanged[\s\S]*coordinatorAuthority\.current\(\)/)
    assert.match(finalOutcomeBody, /if\(result\?\.timedOut === true\) \{[\s\S]*pump\.fastExecutor\.timeoutContinuation[\s\S]*scheduleCoordinatorQueueResume\(1000, followupReason, \{[\s\S]*allowBeforeQuora: true/)
    assert.match(finalOutcomeBody, /const changed = \(result\?\.queued \|\| 0\) > 0 \|\|[\s\S]*\(result\?\.adopted \|\| 0\) > 0 \|\|[\s\S]*\(result\?\.active \|\| 0\) > 0 \|\|[\s\S]*\(result\?\.runtimeActive \|\| 0\) > 0 \|\|[\s\S]*authorityPreflightChanged \|\|[\s\S]*result\?\.changed === true/)
    assert.match(finalOutcomeBody, /if\(changed\) \{[\s\S]*incrementQueueWakeupMetric\('pump\.fastExecutor\.changed'\)[\s\S]*!getSchedulerBlockingQueuedExecutorCount\(\) &&[\s\S]*queueRuntime\.getActivationIntentCount\(\) <= 0 &&[\s\S]*queueRuntime\.getPendingTabActionCount\(\) <= 0 &&[\s\S]*result\?\.queued[\s\S]*result\?\.pending[\s\S]*scheduleCoordinatorQueueResume\(1000, followupReason, \{[\s\S]*allowBeforeQuora: true/)
    assert.doesNotMatch(preflightOutcomeBody, /post-authority-preflight[\s\S]{0,250}scheduleCoordinatorReconcile/)
    assert.doesNotMatch(finalOutcomeBody, /timeout-continuation[\s\S]{0,250}scheduleCoordinatorReconcile/)
    assert.doesNotMatch(finalOutcomeBody, /changed-without-runtime[\s\S]{0,250}scheduleCoordinatorReconcile/)

    const reconcileBody = extractFunction(source, "async function runCoordinatorReconcileTickOnce(reason = 'coordinator-reconcile', options = {})")
    // scheduleCoordinatorReconcileExecutorContinuation moved to
    // swSchedulerAlarmBookkeeping.js in decomposition Slice 43.
    const continuationBody = extractFunction(readRepoFile('shared/js/swSchedulerAlarmBookkeeping.js'), "function scheduleCoordinatorReconcileExecutorContinuation(after = null, authority = null, reason = 'reconcile', options = {})")
    assert.match(reconcileBody, /scheduleCoordinatorQueueResume\(1000, `\$\{reason \|\| 'reconcile'\}-post-authority-change`, \{[\s\S]*allowBeforeQuora: options\.allowBeforeQuora === true/)
    assert.doesNotMatch(reconcileBody, /post-authority-change[\s\S]{0,250}scheduleCoordinatorReconcile/)
    assert.match(reconcileBody, /after\?\.durableActiveRows[\s\S]*<= 0[\s\S]*after\?\.durableQueuedRows[\s\S]*> 0[\s\S]*runCoordinatorQueueExecutorFastPath\(`\$\{reason \|\| 'reconcile'\}-post-active-reconcile`, \{[\s\S]*returnAfterDurableActive: true,[\s\S]*allowBeforeQuora: options\.allowBeforeQuora === true,[\s\S]*forceDurableQueueReload: true/)
    assert.match(reconcileBody, /scheduleCoordinatorReconcileExecutorContinuation\(after, authority, reason, options\)/)
    assert.match(continuationBody, /shouldContinueQueuedOnlyWorkWithFastExecutor\(after\)[\s\S]*scheduleQueuedOnlyDurableWorkContinuation\(`\$\{reason \|\| 'reconcile'\}-queued-only-fast-resume`, \{[\s\S]*awaitFill: options\.awaitFill !== false,[\s\S]*allowBeforeQuora: options\.allowBeforeQuora === true/)

    const reconcileTickBody = extractFunction(source, "async function runScheduledCoordinatorReconcileTick(reason = 'coordinator-reconcile-tick')")
    assert.match(reconcileTickBody, /shouldContinueQueuedOnlyWorkWithFastExecutor\(result\?\.reconcile\?\.after\)[\s\S]*scheduleQueuedOnlyDurableWorkContinuation\(`\$\{reason \|\| 'reconcile'\}-queued-only-fast-resume`, \{[\s\S]*allowBeforeQuora: true/)
    assert.match(reconcileTickBody, /else if\(!result\?\.paused && result\?\.reconcile\?\.after\?\.hasStoredWork\) \{[\s\S]*scheduleCoordinatorQueueResume\(1000, 'reconcile-tick-has-stored-work', \{[\s\S]*allowBeforeQuora: true/)
})

test('resume adopts only owned or expected live queued tabs before planning opens', () => {
    const source = readRepoFile('shared/js/sw.js')
    const reclaimResumeSource = readRepoFile('shared/js/swQueuedTabReclaimResume.js')
    const body = extractFunction(source, 'async function runCoordinatorExecutorApplyPhase(reason = \'coordinator-executor-apply\', options = {})')
    const liveTabBody = extractFunction(reclaimResumeSource, 'function getLiveTabForCoordinatorItem(item = null, itemKey = \'\', liveProfileTabsByHref = new Map(), record = null)')
    const workerSurfaceLiveTabBody = extractFunction(source, 'async function getWorkerSurfaceLiveTabForQueuedCoordinatorItem(item = null, itemKey = \'\', liveProfileTabsByHref = new Map(), record = null)')
    const actionSurfaceStateBody = extractFunction(source, 'async function getQueuedProfileActionSurfaceState(tab = null, href = \'\')')
    const pendingConfirmationBody = extractFunction(source, 'async function getPendingConfirmationLiveTabForQueuedCoordinatorItem(candidates = [], href = \'\')')
    const likelySurfaceWindowBody = extractFunction(source, 'async function isLikelyQueuedWorkerActionSurfaceWindowForTab(tab = null, href = \'\')')
    const reclaimBody = extractFunction(reclaimResumeSource, "function selectQueuedWorkerReclaimTab(candidates = [], reason = 'queued-worker-reclaim')")
    const queuedAdoptIndex = body.indexOf("`${item?.status || ''}`.trim() === 'queued'")
    const terminalProgressIndex = body.indexOf('for(const href of Array.from(terminalProgressSettleHrefs))')
    const liveTabIndex = body.indexOf('getLiveTabForCoordinatorItem(item, itemKey, liveProfileTabsByHref, record)')
    const workerSurfaceLiveTabIndex = body.indexOf('getWorkerSurfaceLiveTabForQueuedCoordinatorItem(item, itemKey, liveProfileTabsByHref, record)')
    const pendingPushIndex = body.indexOf('pendingItems.push({', liveTabIndex)

    assert.notEqual(queuedAdoptIndex, -1)
    assert.notEqual(terminalProgressIndex, -1)
    assert.notEqual(liveTabIndex, -1)
    assert.notEqual(workerSurfaceLiveTabIndex, -1)
    assert.notEqual(pendingPushIndex, -1)
    assert.ok(queuedAdoptIndex < pendingPushIndex)
    assert.ok(terminalProgressIndex < pendingPushIndex)
    assert.ok(liveTabIndex < pendingPushIndex)
    assert.ok(workerSurfaceLiveTabIndex < pendingPushIndex)
    assert.match(body.slice(terminalProgressIndex, pendingPushIndex), /enqueueSpaceFeedStorageUpdate\(\(\) => \{[\s\S]*coordinatorAuthority\.applyWithinStorageUpdate\(\{[\s\S]*operationKind: 'terminal-progress'/)
    assert.match(body.slice(terminalProgressIndex, pendingPushIndex), /metricPath: 'terminalProgress\.queuedSettlement\.save'/)
    assert.match(body.slice(terminalProgressIndex, pendingPushIndex), /currentAuthorityState/)
    assert.match(body.slice(terminalProgressIndex, pendingPushIndex), /changed\.terminalizedQueuedFromTerminalProgress/)
    assert.match(body.slice(queuedAdoptIndex, pendingPushIndex), /adoptLiveCoordinatorQueuedTab\(item, itemKey, liveTab, ownerTabId, \{currentAuthorityState\}\)/)
    assert.match(body.slice(queuedAdoptIndex, pendingPushIndex), /incrementMetric\('noop\.liveQueuedTabAdoptionFailed'\)/)
    assert.match(body.slice(queuedAdoptIndex, pendingPushIndex), /continue/)
    assert.match(liveTabBody, /getOwnedOrExpectedLiveTabsForProfileHref\(item, record, href, liveProfileTabsByHref\)/)
    assert.doesNotMatch(liveTabBody, /liveProfileTabsByHref\.get\(href\)/)
    assert.match(workerSurfaceLiveTabBody, /item\.serviceWorkerOwned === true \|\| item\.executorOwner === 'service-worker'/)
    assert.match(workerSurfaceLiveTabBody, /getQueuedWorkerActionSurfaceAnchorTabs/)
    assert.match(workerSurfaceLiveTabBody, /surfaceCandidates\.length === 1/)
    assert.match(workerSurfaceLiveTabBody, /selectQueuedWorkerReclaimTab\(surfaceCandidates, 'surface-window'\)/)
    assert.match(workerSurfaceLiveTabBody, /isLikelyQueuedWorkerActionSurfaceWindowForTab\(candidate, href\)/)
    assert.match(workerSurfaceLiveTabBody, /selectQueuedWorkerReclaimTab\(likelySurfaceCandidates, 'likely-surface-window'\)/)
    assert.match(workerSurfaceLiveTabBody, /getPendingConfirmationLiveTabForQueuedCoordinatorItem\(candidates, href\)/)
    assert.match(actionSurfaceStateBody, /action: 'get-profile-action-surface-state'/)
    assert.match(actionSurfaceStateBody, /requestedProfileHref/)
    assert.match(actionSurfaceStateBody, /response\.profileMatches !== true/)
    assert.match(actionSurfaceStateBody, /response\.pendingProfileConfirmation !== true/)
    assert.match(actionSurfaceStateBody, /confirmationKind !== 'block' && confirmationKind !== 'mute'/)
    assert.match(pendingConfirmationBody, /getQueuedProfileActionSurfaceState\(candidate, href\)/)
    assert.match(pendingConfirmationBody, /matches\.length \? selectQueuedWorkerReclaimTab\(matches, 'pending-confirmation'\) : null/)
    assert.match(reclaimBody, /incrementQueueWakeupMetric\('reconcile\.changed\.closedDuplicateWorkerSurfaceTab'/)
    assert.match(reclaimBody, /browser\.tabs\.remove\(tabId\)/)
    assert.match(likelySurfaceWindowBody, /if\(!profileTabs\.length\) return false/)
    assert.match(likelySurfaceWindowBody, /sameHrefProfileTabs\.length !== profileTabs\.length/)
    assert.match(likelySurfaceWindowBody, /sameHrefProfileTabs\.some\(candidate => normalizeTabId\(candidate\?\.id\) === tabId\)/)
    assert.match(likelySurfaceWindowBody, /isIdleQueuedWorkerActionSurfaceTab\(candidate\)/)
    assert.match(body, /const progressAttemptMismatched = progressRecord && hasMismatchedCoordinatorAttempt\(item, progressRecord\)/)
    assert.match(body, /const recoverableQueuedAuthorityLostAttemptRecord = progressAttemptMismatched &&/)
    assert.match(body, /String\(item\?\.status \|\| ""\)\.trim\(\) === .queued./)
    assert.match(body, /!getAttemptIdFromValue\(item\)/)
    assert.match(body, /!getAttemptNumberFromValue\(item\)/)
    assert.match(body, /getAttemptNumberFromValue\(progressRecord\) > 0/)
    assert.match(body, /!item\.runId \|\| !progressRecord\.runId \|\| item\.runId === progressRecord\.runId/)
    assert.match(body, /const record = progressAttemptMismatched\s*\?\s*recoverableQueuedAuthorityLostAttemptRecord \? progressRecord : null\s*:\s*progressRecord/)
    assert.doesNotMatch(body, /if\(record && hasMismatchedCoordinatorAttempt\(item, record\)\) continue/)
})

test('stored work recovery reports durable work without deciding executor movement', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function recoverStoredCoordinatorWorkOnce(reason = \'stored-work-recovery\', options = {})')

    // makeStoredWorkRecoveryResumeOwnedResult moved to
    // swCoordinatorRetryCandidates.js in decomposition Slice 29.
    assert.match(readRepoFile('shared/js/swCoordinatorRetryCandidates.js'), /function makeStoredWorkRecoveryResumeOwnedResult/)
    assert.match(body, /return makeStoredWorkRecoveryResumeOwnedResult\(reason, hasWork, paused\)/)
    assert.doesNotMatch(body, /\brepair\b/)
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
    assert.match(tickBody, /scheduleQueuedOnlyDurableWorkContinuation\(`\$\{reason \|\| 'reconcile'\}-queued-only-fast-resume`/)
    assert.match(tickBody, /awaitFill: options\.awaitFill !== false/)
    assert.match(tickBody, /reason: 'queued-only-fast-resume-scheduled'/)
    assert.match(tickBody, /executorQueued: executor\?\.queued/)
    assert.doesNotMatch(tickBody, /resumeCoordinatorQueueExecution\(/)
    // resume-owned-by-reconcile lives in makeStoredWorkRecoveryResumeOwnedResult,
    // moved to swCoordinatorRetryCandidates.js in decomposition Slice 29.
    assert.match(readRepoFile('shared/js/swCoordinatorRetryCandidates.js'), /resume-owned-by-reconcile/)
    assert.doesNotMatch(recoverBody, /resumeCoordinatorQueueExecution\(/)
    assert.match(executorBody, /runCoordinatorExecutorApplyPhase\(reason/)
    assert.match(executorBody, /dropVolatileSource: 'runCoordinatorReconcileExecutorActions'/)
    assert.doesNotMatch(applyBody, /dropVolatileQueuedActionsForDurableResume/)
    assert.match(applyBody, /enqueueExistingExecutorForCoordinator/)
    assert.match(applyBody, /getTokenMatchedLiveOrPersistedTabForCoordinatorItem/)
    assert.doesNotMatch(applyBody, /const blockedSweep = await sweepOwnedBlockedProfileTabs\(ownerTabId\)/)
    assert.doesNotMatch(applyBody, /reason: 'blocked-sweep-terminalized'/)
    assert.doesNotMatch(applyBody, /reason: 'executor-already-running'/)
    assert.doesNotMatch(executorBody, /getLiveProfileTabsByHref\(\)/)
})

test('queued tab content ensure nudges the profile page to claim its action', () => {
    const swSource = readRepoFile('shared/js/sw.js')
    const contentSource = readRepoFile('shared/js/content.js')
    const ensureBody = extractFunction(swSource, 'async function ensureQueuedTabContentScript(tabId, reason = \'\')')
    const reloadBody = extractFunction(swSource, 'async function reloadQueuedTabAfterUnresponsiveContentScript(tabId, metadata = null, nudgeResult = null, currentUrl = \'\', event = \'\', fallbackReason = \'claim-nudge-not-accepted\')')
    const nudgeBody = extractFunction(swSource, 'async function nudgeQueuedTabActionClaim(tabId, reason = \'\')')
    const retryBody = extractFunction(swSource, 'async function nudgeQueuedTabActionClaimWithRetries(tabId, reason = \'\', delays = [0, 250, 750, 1500])')
    const fillBody = extractFunction(swSource, 'async function fillQueuedTabsOnce(options = {})')
    const adoptBody = extractFunction(swSource, 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID, options = {})')
    const messageBody = extractFunction(contentSource, 'function onMessage(request, sender, sendResponse)')
    const claimHelperBody = extractFunction(contentSource, 'async function acceptQueuedProfileActionClaim(request = {})')

    assert.match(swSource, /QUEUED_TAB_ACTION_CLAIM_NUDGE_TIMEOUT_MS/)
    assert.match(nudgeBody, /makeClaimableQueuedTabAction/)
    assert.match(nudgeBody, /if\(!pendingAction\) \{/)
    assert.doesNotMatch(nudgeBody, /if\(!pendingAction && !metadata\)/)
    assert.match(nudgeBody, /browser\.tabs\.sendMessage\(normalizedTabId/)
    assert.match(nudgeBody, /claim-current-profile-tab-action/)
    assert.match(nudgeBody, /queuedAction: claimableAction \|\| null/)
    assert.match(nudgeBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'RELEASE_RUNTIME_IF_AUTHORITY_NOT_ACTIVE'/)
    assert.match(nudgeBody, /loadAuthorityState: \(\) => coordinatorQueueReader\.full\(\{[\s\S]*metricPath: 'nudgeFailure\.runtimeAuthority\.load'/)
    assert.doesNotMatch(nudgeBody, /nudgeFailure\.runtimeAuthority\.usedResidentAuthority/)
    assert.match(nudgeBody, /if\(releasedStaleRuntime\) \{/)
    assert.equal(nudgeBody.indexOf('rememberQueueLoadPressure('), -1)
    assert.ok(nudgeBody.indexOf("type: 'RELEASE_RUNTIME_IF_AUTHORITY_NOT_ACTIVE'") < nudgeBody.indexOf('rememberQueuedTabActivationFailure('))
    assert.match(retryBody, /for\(const delay of delays\)/)
    assert.match(retryBody, /setTimeout\(resolve, delay\)/)
    assert.match(retryBody, /nudgeQueuedTabActionClaim\(tabId, reason\)/)
    assert.match(retryBody, /queueRuntime\.hasActiveQueuedTab\(normalizedTabId\)/)
    assert.match(retryBody, /scheduleCoordinatorReconcile\(1000, \{[\s\S]*reason: 'claim-nudge-retry-failed'[\s\S]*allowBeforeQuora: true/)
    assert.match(retryBody, /scheduleCoordinatorQueueResume\(1000, 'claim-nudge-retry-failed', \{[\s\S]*allowBeforeQuora: true/)
    assert.match(ensureBody, /nudgeQueuedTabActionClaimWithRetries\(normalizedTabId, reason \|\| 'content-script-present'\)/)
    assert.match(ensureBody, /nudgeQueuedTabActionClaimWithRetries\(normalizedTabId, reason \|\| 'content-script-injected'\)/)
    assert.match(ensureBody, /reason \|\| 'content-script-already-checked'/)
    assert.match(ensureBody, /alreadyChecked: true/)
    assert.match(ensureBody, /claim-nudge-not-accepted-after-injection/)
    assert.match(ensureBody, /!nudgeResult\?\.nudged && profileHref/)
    assert.match(reloadBody, /contentScriptPresentAt: 0/)
    assert.match(reloadBody, /contentScriptInjectedAt: 0/)
    assert.match(reloadBody, /contentScriptEnsureUrl: ''/)
    assert.match(reloadBody, /browser\.tabs\.reload\(normalizedTabId\)/)
    assert.match(reloadBody, /contentScriptReloadCount: reloadCount/)
    assert.match(reloadBody, /scheduleQueuedTabContentScriptEnsure\([\s\S]*normalizedTabId,[\s\S]*`post-reload-\$\{nudgeResult\?\.reason \|\| fallbackReason\}`,[\s\S]*QUEUED_TAB_CONTENT_SCRIPT_CHECK_DELAY_MS/)
    assert.doesNotMatch(fillBody, /nudgeQueuedTabActionClaimWithRetries\(tab\.id, 'queued-tab-opened'\)/)
    assert.match(fillBody, /ensureQueuedTabContentScript\(tab\.id, 'queued-tab-opened'\)/)
    assert.match(fillBody, /scheduleOwnedBlockedProfileSweep\(next\.ownerTabId, 750\)/)
    assert.match(fillBody, /void sweepOwnedBlockedProfileTabs\(next\.ownerTabId\)/)
    assert.match(adoptBody, /nudgeQueuedTabActionClaimWithRetries\(tabId, 'resume-live-active-tab'\)/)
    assert.match(adoptBody, /scheduleOwnedBlockedProfileSweep\(ownerTabId, 4000\)/)
    assert.match(messageBody, /request\.action === 'claim-current-profile-tab-action'/)
    assert.match(messageBody, /return acceptQueuedProfileActionClaim\(request\)/)
    assert.match(claimHelperBody, /await refreshCoordinatorQueueFromRuntime\(\)\.catch\(\(\) => null\)/)
    assert.match(claimHelperBody, /return \{accepted: true/)
    assert.match(claimHelperBody, /request\.queuedAction && typeof request\.queuedAction === 'object'/)
    assert.match(claimHelperBody, /maybeRecordAlreadyBlockedCoordinatorProfile\(\)/)
    assert.match(claimHelperBody, /void maybeRunAutoProfileAction\(\)/)
})

test('content script exposes a DOM marker for injection probes', () => {
    const source = readRepoFile('shared/js/content.js')

    assert.match(source.slice(0, 500), /data-mb-content-script-ready/)
    assert.match(source.slice(0, 500), /getManifest/)
})

test('queued tab release schedules next fill before derived release storage writes settle', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function releaseQueuedTab(tabId, options = {})')
    const helperIndex = body.indexOf('const scheduleReleaseContinuation = () =>')
    const leaseIndex = body.indexOf('const leaseRelease = releaseCoordinatorActionLeaseForTab(tabId, releaseReason)')
    const metadataClosingIndex = body.indexOf('const metadataClosing = !!(metadata?.closeRequestedAt || metadata?.closeReason || metadata?.retryRequestedAt)')
    const closingLeaseIndex = body.indexOf('void leaseRelease.catch(() => null)', leaseIndex)
    const durableLeaseIndex = body.indexOf('durableWrites.push(leaseRelease)', leaseIndex)
    const terminalIndex = body.indexOf('if(progressRecord && isTerminalProfileNukeRecord(progressRecord)')
    const earlyScheduleIndex = body.indexOf('scheduleReleaseContinuation()', terminalIndex)
    const rollbackIndex = body.indexOf('durableWrites.push(rollbackFailedQueuedTabOpen')
    const awaitWritesIndex = body.indexOf('await Promise.all(durableWrites.map')
    const lateScheduleIndex = body.indexOf('scheduleReleaseContinuation()', awaitWritesIndex)

    assert.notEqual(helperIndex, -1)
    assert.match(body, /releaseContinuationScheduled/)
    assert.match(body, /scheduleQueuedTabReleaseReconcile\('queued-tab-slot-release'/)
    assert.match(body, /scheduleQueuedWorkContinuation\('queued-tab-slot-release'\)/)
    assert.ok(metadataClosingIndex !== -1 && metadataClosingIndex < leaseIndex)
    assert.ok(leaseIndex !== -1 && terminalIndex > leaseIndex)
    assert.ok(closingLeaseIndex > leaseIndex)
    assert.ok(durableLeaseIndex > closingLeaseIndex)
    assert.ok(earlyScheduleIndex > terminalIndex)
    assert.ok(earlyScheduleIndex < awaitWritesIndex)
    assert.ok(rollbackIndex > earlyScheduleIndex)
    assert.ok(lateScheduleIndex > awaitWritesIndex)
})

test('queued tab fill returns after durable active without awaiting opened progress', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function fillQueuedTabsOnce(options = {})')
    // The returnAfterDurableActive branch's fill-promise-clear bookkeeping,
    // deferred progress save, content-script-ensure kickoff, and early
    // return were extracted to decideReturnAfterDurableActiveOutcome in
    // decomposition Slice P2-8 (Part 2 decide/act splitting), called from
    // fillBody rather than inlined there, then moved to
    // swFillQueuedTabsOnceDecisions.js in decomposition Slice P2.5-4.
    const decisionBody = extractFunction(readRepoFile('shared/js/swFillQueuedTabsOnceDecisions.js'), 'function decideReturnAfterDurableActiveOutcome(params = {})')
    const patchIndex = body.indexOf('const openedProgressPatch =')
    const returnAfterIndex = body.indexOf('if(options.returnAfterDurableActive === true)', patchIndex)
    const earlyEnsureIndex = body.indexOf('const earlyContentEnsurePromise = options.returnAfterDurableActive === true')
    const decisionCallIndex = body.indexOf('decideReturnAfterDurableActiveOutcome({', returnAfterIndex)
    const setClearRequestedIndex = body.indexOf('queuedTabFillPromiseClearRequested = true', decisionCallIndex)
    const returnDecisionResultIndex = body.indexOf('return returnAfterDurableActiveDecision.result', decisionCallIndex)
    const awaitedProgressIndex = body.indexOf('await recordCoordinatorJobProgressViaQueueMachine(openPlan.profileHref, openedProgressPatch, {senderTabId: tab.id})', returnDecisionResultIndex)
    const postTransitionConfirmIndex = body.indexOf('queued-tab-open-post-transition-confirm', awaitedProgressIndex)

    const deferredProgressIndex = decisionBody.indexOf('void recordCoordinatorJobProgressViaQueueMachine(openPlan.profileHref, openedProgressPatch, {senderTabId: tab.id})')
    const deferredCatchIndex = decisionBody.indexOf('queued-tab-opened-progress-deferred-failed', deferredProgressIndex)
    const ensureIndex = decisionBody.indexOf('const contentEnsurePromise = earlyContentEnsurePromise || promiseWithTimeout', deferredProgressIndex)
    const durableReturnResumeIndex = decisionBody.indexOf("scheduleCoordinatorQueueResume(1000, 'queued-tab-opened-return-after-durable-active'")
    const durableReturnIndex = decisionBody.indexOf('return {', durableReturnResumeIndex)

    assert.notEqual(patchIndex, -1)
    assert.match(body, /confirmQueuedTabOpenDurableActiveEffect\(next, tab, openPlan, \{[\s\S]*returnAfterDurableActive: options\.returnAfterDurableActive === true[\s\S]*\}\)/)
    assert.ok(earlyEnsureIndex > -1)
    assert.ok(earlyEnsureIndex < returnAfterIndex)
    assert.ok(returnAfterIndex > patchIndex)
    assert.ok(decisionCallIndex > returnAfterIndex)
    assert.ok(setClearRequestedIndex > decisionCallIndex)
    assert.ok(returnDecisionResultIndex > setClearRequestedIndex)
    assert.ok(awaitedProgressIndex > returnDecisionResultIndex)
    assert.ok(postTransitionConfirmIndex > awaitedProgressIndex)

    assert.notEqual(deferredProgressIndex, -1)
    assert.ok(deferredCatchIndex > deferredProgressIndex)
    assert.ok(ensureIndex > deferredProgressIndex)
    assert.ok(durableReturnResumeIndex > ensureIndex)
    assert.ok(durableReturnIndex > durableReturnResumeIndex)
    assert.match(decisionBody, /if\(queuedTabFillPromise\) \{[\s\S]*resetQueuedTabFillState\(\)[\s\S]*\}\s*else \{[\s\S]*setClearRequested = true[\s\S]*\}/)
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

test('the session mirror takes only the queue shards of the active manifest; completed and runs shards are read from disk on hydrate', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const rebuildBody = extractFunction(sw, 'async function rebuildCoordinatorQueueMirrorFromDisk()')
    const mirrorBody = extractFunction(sw, 'async function readValidCoordinatorQueueMirrorFromSession(session, sessionRead)')
    const sessionReadBody = extractFunction(sw, 'async function readCoordinatorSessionForHydrate()')
    const hydrateBody = extractFunction(sw, 'async function loadCoordinatorCurrentAuthorityState()')

    // The rebuild reads every shard the meta names (a superset), and the write set is chosen by the planner from the stored manifest.
    assert.match(rebuildBody, /getQueueMirrorSupersetKeys\(diskMeta/)
    assert.match(rebuildBody, /planQueueMirrorRebuild\(stored, stored\[COORDINATOR_QUEUE_WAL_META_KEY\]/)
    assert.match(rebuildBody, /session\.set\(\{\.\.\.plan\.records, \[COORDINATOR_QUEUE_WAL_SEQ_SESSION_KEY\]/)
    assert.doesNotMatch(rebuildBody, /session\.set\(\{\.\.\.stored/)
    // The hydrate's mirror read names the copy's keys from the copy's own active manifest, which the first read carries.
    assert.match(sessionReadBody, /getSegmentedWalCheckpointKey\(COORDINATOR_QUEUE_WAL_KEY, CHECKPOINT_A\)/)
    assert.match(sessionReadBody, /getSegmentedWalCheckpointKey\(COORDINATOR_QUEUE_WAL_KEY, CHECKPOINT_B\)/)
    assert.match(mirrorBody, /getQueueMirrorKeys\(mirrorMeta, \{[\s\S]*manifest: getStoredActiveManifest\(sessionRead, mirrorMeta, COORDINATOR_QUEUE_WAL_KEY\)/)
    assert.doesNotMatch(mirrorBody, /getQueueMirrorSupersetKeys/)
    assert.match(mirrorBody, /mirrorWalKeys\.some\(key => mirror\[key\] === undefined \|\| mirror\[key\] === null\)/)
    // The completed and runs shards are not in the copy, so hydrate's mirror-hydrate count is the one place that counts their disk reads.
    assert.match(hydrateBody, /fromMirror: Boolean\(mirror\)/)
    assert.doesNotMatch(mirrorBody, /COORDINATOR_RUNS_KEY|mbCoordinatorRuns/)
})

test('profile progress lives in session storage and reaches content tabs by a worker push (decision 31, D13 b)', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const content = readRepoFile('shared/js/content.js')
    const push = readRepoFile('shared/js/swProfileNukeProgressPush.js')
    const storedBody = extractFunction(sw, 'async function persistCoordinatorStoredChange(change = {}, stored = {}, options = {})')
    const hydrateBody = extractFunction(sw, 'async function loadCoordinatorCurrentAuthorityState()')
    const mirrorBody = extractFunction(sw, 'async function readValidCoordinatorQueueMirrorFromSession(session, sessionRead)')
    const scopedBody = extractFunction(sw, 'async function getContentPageCoordinatorState(request = {}, sender = {})')
    const storageListenerBody = extractFunction(bootstrap, 'function handleStorageChanged(changes, areaName)')
    const onMessageBody = extractFunction(content, 'function onMessage(request, sender, sendResponse)')

    // Disk never gets a progress key: the stored part splits them off, and only the session copy is written.
    assert.match(storedBody, /omitProfileNukeProgressKeys\(payload\)/)
    assert.match(storedBody, /pickProfileNukeProgressKeys\(payload\)/)
    assert.match(storedBody, /writeProfileNukeProgressSession\(progressPayload\)/)
    assert.match(storedBody, /profileNukeProgressPush\.push\(\)/)
    // Hydrate reads progress from the session copy only, whatever the disk mirror holds. The progress keys ride in the first
    // session read, the one that reads the mirror's marker, so hydrate adds no await for them.
    const sessionReadBody = extractFunction(sw, 'async function readCoordinatorSessionForHydrate()')
    assert.match(hydrateBody, /readCoordinatorSessionForHydrate\(\)/)
    assert.match(sessionReadBody, /\.\.\.Object\.fromEntries\(PROFILE_NUKE_PROGRESS_STORAGE_KEYS\.map/)
    assert.doesNotMatch(hydrateBody, /progressFromMirror|progressConfirmed|progressComplete|hydrateProgressFromMirror/)
    assert.doesNotMatch(mirrorBody, /PROFILE_NUKE_PROGRESS|progressComplete/)
    // The asking tab is subscribed, so it is pushed to when progress changes.
    assert.match(scopedBody, /profileNukeProgressPush\.subscribe\(sender\?\.tab\?\.id\)/)
    // The content tab refreshes on the push. The worker's storage listener no longer reads the progress view: nothing writes it to disk now.
    assert.match(onMessageBody, /case PROFILE_NUKE_PROGRESS_PUSH_ACTION:[\s\S]{0,300}?scheduleContentPageStateProjectionRefresh\(\)/)
    assert.doesNotMatch(storageListenerBody, /PROFILE_NUKE_PROGRESS_VIEW_KEY/)
    assert.match(push, /PROFILE_NUKE_PROGRESS_PUSH_ACTION = 'profile-nuke-progress-changed'/)
    assert.match(bootstrap, /request\.action === PROFILE_NUKE_PROGRESS_GET_ACTION/)
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
    assert.ok(initBody.indexOf('await refreshCoordinatorQueueFromRuntime') < initBody.indexOf('nudgeCurrentProfilePendingClaim()'))
    // Decision 17 (18 Oct) removed the queue-view branch of the content storage handler. Decision 31 (D13 b) removes the progress-view
    // branch too: progress is in session storage, so the worker pushes a change instead (see the push test below).
    assert.doesNotMatch(storageBody, /COORDINATOR_QUEUE_VIEW_KEY|PROFILE_NUKE_PROGRESS_VIEW_KEY/)
    assert.match(syncBody, /nudgeCurrentProfilePendingClaim\(\)/)
    assert.match(followUpBody, /nudgeCurrentProfilePendingClaim\(\)/)
    assert.match(followUpBody, /if\(!profileActionInProgress\)/)
    assert.match(actionBody, /scheduleCurrentProfilePendingClaimRescue\(retryDelay\)/)
    assert.match(actionBody, /scheduleCurrentProfilePendingClaimRescue\(\)/)
})

test('visible worker-window queued tabs can proceed locally without a durable action gate round trip', () => {
    const source = readRepoFile('shared/js/content.js')
    const actionBody = extractFunction(source, 'async function maybeRunAutoProfileAction()')

    assert.match(actionBody, /claimedActionSurfaceMode === 'worker-window' && document\.visibilityState === 'visible'/)
    assert.match(actionBody, /workerWindowActionGate: claimedActionSurfaceMode === 'worker-window' && document\.visibilityState === 'visible'/)
    assert.match(actionBody, /Queued tab proceeded locally using the background window/)
})

test('a checkpoint switch forgets the remembered slots only when the save reports false', () => {
    const source = readRepoFile('shared/js/sw.js')
    const switchBody = extractFunction(source, 'async function performCoordinatorQueueWalCheckpointSwitch(options = {})')

    assert.match(switchBody, /if\(walSaved === false\) queueWalStore\.noteCheckpointSaveFailed\(\)\s*else queueWalStore\.noteCheckpointSaved\(prepared\)/)
    assert.doesNotMatch(switchBody, /walSaved === true/)
})

test('resume reattaches live active tabs after service worker restart', () => {
    const source = readRepoFile('shared/js/sw.js')
    const reducerSource = readRepoFile('shared/js/swCoordinatorProgressReducer.js')
    const resumeBody = extractFunction(source, 'async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {})')
    const applyBody = extractFunction(source, 'async function runCoordinatorExecutorApplyPhase(reason = \'coordinator-executor-apply\', options = {})')
    const adoptBody = extractFunction(source, 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID, options = {})')
    const activeAtHelperBody = extractFunction(reducerSource, 'function getCoordinatorProgressRecordActiveAt(record = {})')
    const projectedBody = extractFunction(reducerSource, 'function buildProjectedCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {})')

    assert.match(resumeBody, /runCoordinatorExecutorApplyPhase\(options\.reason \|\| 'resume'/)
    assert.doesNotMatch(resumeBody, /getLiveProfileTabsByHref\(\)/)
    assert.match(applyBody, /getLiveProfileTabsByHref\(\)/)
    assert.match(applyBody, /isActiveCoordinatorStatus\(item\?\.status\)/)
    assert.match(applyBody, /getTokenMatchedLiveOrPersistedTabForCoordinatorItem\(item, record, itemKey, liveProfileTabsByHref\)/)
    assert.match(applyBody, /hasActiveQueuedTabActionPhaseProgress\(record, item\)\) continue/)
    assert.match(applyBody, /adoptLiveCoordinatorQueuedTab\(item, itemKey, liveTab, ownerTabId, \{currentAuthorityState\}\)/)
    assert.match(applyBody, /reattached-live-active-tabs/)
    assert.match(adoptBody, /queueRuntime\.setPendingTabAction/)
    assert.match(adoptBody, /queueRuntime\.addActiveQueuedTab/)
    assert.match(adoptBody, /status: 'tab-opening'/)
    assert.match(adoptBody, /contentScriptEnsureUrl: ''/)
    assert.match(adoptBody, /contentScriptEnsureVersion: ''/)
    assert.match(adoptBody, /contentScriptPresentAt: 0/)
    assert.match(adoptBody, /contentScriptInjectedAt: 0/)
    assert.match(adoptBody, /ensureQueuedTabContentScript\(tabId, 'resume-live-active-tab'\)/)
    assert.match(adoptBody, /nudgeQueuedTabActionClaimWithRetries\(tabId, 'resume-live-active-tab'\)/)
    assert.match(adoptBody, /Reattached live queued tab after service worker restart/)
    assert.match(activeAtHelperBody, /record\?\.tabOpenedAt/)
    assert.match(activeAtHelperBody, /record\?\.contentOpenedAt/)
    assert.match(projectedBody, /options\.refreshActiveAt === true/)
    assert.match(projectedBody, /const terminalActiveAt = mappedTerminal/)
    assert.match(projectedBody, /Math\.min\(/)
    assert.match(projectedBody, /mappedTerminal \? terminalActiveAt/)
})

test('storage reconcile immediately reconciles active rows whose persisted tab is gone', () => {
    const source = readRepoFile('shared/js/sw.js')
    const helperBody = extractFunction(source, 'async function shouldImmediatelyReconcileMissingPersistedActiveTab(item = null, record = null)')
    const timeoutHelperBody = extractFunction(readRepoFile('shared/js/swQueuedTabRetryStaleReconcile.js'), 'function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = \'\', liveProfileTabsByHref = new Map(), now = getNow())')
    const decisionBody = extractFunction(source, 'async function getMissingActiveCoordinatorReconcileDecision(')
    const transitionBody = extractFunction(source, 'async function applyCoordinatorReconcileQueueAuthorityTransitionPhase(ctx = {})')
    const persistBody = extractFunction(source, 'async function persistCoordinatorReconcileAuthorityTransitionPhase(ctx = {})')
    const immediateIndex = transitionBody.indexOf('await shouldImmediatelyReconcileMissingPersistedActiveTab(item, record)')
    const decisionIndex = transitionBody.indexOf('await getMissingActiveCoordinatorReconcileDecision(', immediateIndex)

    assert.match(helperBody, /getPersistedQueuedTabId\(item, record\)/)
    assert.match(helperBody, /hasOwnedQueuedTabState\(tabId\)/)
    assert.match(helperBody, /getQueuedExecutorTabWithTimeout\(tabId, 'missing-active-persisted-tab'\)/)
    assert.match(helperBody, /detachQueuedTabRuntimeState\(tabId, 'missing-persisted-active-tab'\)/)
    assert.doesNotMatch(helperBody, /browser\.tabs\.get/)
    assert.match(helperBody, /return true/)
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
    assert.match(transitionBody, /applyMissingActiveCoordinatorEvidenceReconcileActionLocked\(state, \{[\s\S]*closePersistedTab: missingActiveDecision\.closePersistedTab === true/)
    assert.match(transitionBody, /tabsToCloseAfterReconcile\.add\(closeTabId\)/)
    assert.match(persistBody, /detachQueuedTabRuntimeState\(tabId, 'storage-reconcile-tab-close'\)[\s\S]*browser\.tabs\.remove\(tabId\)/)
    assert.doesNotMatch(source.replace(persistBody, ''), /storage-reconcile-tab-close/)
})

test('terminal queued progress schedules stored work continuation', () => {
    const source = readRepoFile('shared/js/sw.js')
    // scheduleQueuedTabReleaseFollowUp moved to swQueuedTabActionBookkeeping.js
    // in decomposition Slice 38.
    const releaseFollowUpBody = extractFunction(readRepoFile('shared/js/swQueuedTabActionBookkeeping.js'), 'function scheduleQueuedTabReleaseFollowUp(delayMs = 500)')
    const continuationBody = extractFunction(source, 'function scheduleQueuedWorkContinuation(reason = \'queued-work-continuation\')')
    const postStorageContinuationBody = extractFunction(readRepoFile('shared/js/swQueuedWorkFastResume.js'), 'function flushPostStorageQueuedWorkContinuation()')
    // scheduleTerminalProgressContinuation/scheduleTerminalProgressSettlement
    // moved to swCoordinatorJobMilestoneBookkeeping.js in decomposition Slice 40.
    const milestoneBookkeepingSource = readRepoFile('shared/js/swCoordinatorJobMilestoneBookkeeping.js')
    const terminalContinuationBody = extractFunction(milestoneBookkeepingSource, 'function scheduleTerminalProgressContinuation(reason = \'terminal-progress-continuation\', profileHrefs = [])')
    const terminalSettlementBody = extractFunction(milestoneBookkeepingSource, 'function scheduleTerminalProgressSettlement(profileHrefs = [])')
    const progressRecordsBody = extractFunction(source, 'async function recordCoordinatorJobProgressRecords(progressRecords = {}, options = {})')
    const progressBody = extractFunction(source, 'async function recordJobProgressFromRequest(request = {}, sender = {}, options = {})')
    const authorityContinuationIndex = progressRecordsBody.indexOf("scheduleTerminalProgressContinuation('terminal-progress-authority-continuation'")

    assert.match(releaseFollowUpBody, /scheduleQueuedWorkContinuation\('queued-tab-release'\)/)
    assert.match(continuationBody, /kickCoordinatorQueueResume\(reason, \{[\s\S]*backgroundFastPath: true[\s\S]*allowBeforeQuora: true/)
    assert.doesNotMatch(continuationBody, /setTimeout\(/)
    assert.match(continuationBody, /skipAuthorityReconcile: true/)
    assert.match(continuationBody, /forceDurableQueueReload: options\.forceDurableQueueReload === true/)
    assert.match(postStorageContinuationBody, /const forceDurableQueueReload = postStorageQueuedWorkContinuationForceDurableQueueReload === true/)
    assert.match(postStorageContinuationBody, /kickCoordinatorQueueResume\(reason, \{[\s\S]*backgroundFastPath: true[\s\S]*forceDurableQueueReload/)
    assert.doesNotMatch(continuationBody, /kickCoordinatorQueueResume\(reason\)\.catch/)
    assert.doesNotMatch(continuationBody, /scheduleCoordinatorReconcile\(1000, \{reason\}\)/)
    // Every continuation used to run an unscoped terminal-tab pass; completions now clean their own hrefs
    // and the orphan sweep runs from the reconcile tick.
    assert.doesNotMatch(continuationBody, /closeTerminalOwnedProfileTabs\(/)
    assert.doesNotMatch(continuationBody, /restoreCoordinatorPageForStoredWork\(\)/)
    assert.match(terminalContinuationBody, /scheduleQueuedWorkContinuation\(reason, \{[\s\S]*forceDurableQueueReload: false/)
    assert.match(terminalContinuationBody, /closeTerminalOwnedProfileTabs\(hrefs, \{completedJob: true\}\)/)
    assert.doesNotMatch(terminalContinuationBody, /closeTerminalOwnedProfileTabs\(\)/)
    assert.match(terminalContinuationBody, /scheduleCoordinatorQueueResume\(1000, reason, \{[\s\S]*allowBeforeQuora: true/)
    assert.doesNotMatch(terminalContinuationBody, /scheduleCoordinatorReconcile/)
    assert.notEqual(authorityContinuationIndex, -1)
    assert.doesNotMatch(progressRecordsBody, /scheduleTerminalProgressCompatibilitySave|scheduleDirectProgressCompatibilitySave|compatibilitySave/)
    assert.match(terminalSettlementBody, /terminalProgress\.settlementCompleted/)
    assert.match(terminalSettlementBody, /scheduleCoordinatorQueueResume\(1000, 'terminal-progress-settlement-continuation', \{[\s\S]*allowBeforeQuora: true/)
    assert.doesNotMatch(terminalSettlementBody, /scheduleCoordinatorReconcile/)
    assert.match(terminalSettlementBody, /runCoordinatorQueueExecutorFastPath\('terminal-progress-settlement-continuation', \{[\s\S]*awaitFill: true,[\s\S]*returnAfterDurableActive: true,[\s\S]*allowBeforeQuora: true,[\s\S]*forceDurableQueueReload: true/)
    assert.match(progressBody, /scheduleQueuedWorkContinuation\('terminal-job-progress'\)/)
    assert.doesNotMatch(progressBody, /legacy-progress-fallback-disabled/)
    assert.doesNotMatch(progressBody, /terminal-profile-progress/)
})

test('dashboard resume uses executor path without scheduling repair', () => {
    const source = readRepoFile('shared/js/swBootstrap.js')
    const messageStart = source.indexOf("else if(request.action === 'resume-coordinator-queue')")
    const messageEnd = source.indexOf("else if(request.action === 'retry-coordinator-failed')", messageStart)
    assert.notEqual(messageStart, -1)
    assert.notEqual(messageEnd, -1)
    const body = source.slice(messageStart, messageEnd)

    assert.match(body, /const userInitiated = request\.userInitiated === true/)
    assert.match(body, /if\(userInitiated\) \{[\s\S]*return startUserInitiatedCoordinatorQueueResume\('dashboard-resume', \{[\s\S]*actionBudget: request\.actionBudget,[\s\S]*awaitFill: request\.awaitFill !== false,[\s\S]*timeoutMs: request\.timeoutMs/)
    assert.match(body, /return kickCoordinatorQueueResume\('dashboard-resume', \{[\s\S]*allowBeforeQuora: request\.allowBeforeQuora === true,[\s\S]*backgroundFastPath: true[\s\S]*\}\)/)
    assert.doesNotMatch(body, /executorFastPath/)
    assert.doesNotMatch(body, /scheduleCoordinatorReconcile/)
})

test('dashboard exposes read-only why-not-running coordinator diagnostics', () => {
    const source = readRepoFile('shared/js/sw.js')
    // getStorageUpdateQueueSnapshot moved to swCoordinatorReconcileSupportSingles.js
    // in decomposition Slice 43.
    const snapshotBody = extractFunction(readRepoFile('shared/js/swCoordinatorReconcileSupportSingles.js'), 'function getStorageUpdateQueueSnapshot()')
    const diagnosticBody = extractFunction(source, 'async function getCoordinatorWhyNotRunning(request = {})')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const accountingStart = bootstrap.indexOf("else if(request.action === 'get-coordinator-queue-accounting')")
    const metricsStart = bootstrap.indexOf("else if(request.action === 'refresh-queue-wakeup-metrics-view')", accountingStart)
    assert.notEqual(accountingStart, -1)
    assert.notEqual(metricsStart, -1)
    const messageBody = bootstrap.slice(accountingStart, metricsStart)

    assert.match(snapshotBody, /depth: storageUpdateState\.getDepth\(\)/)
    assert.match(snapshotBody, /currentReason: active\?\.reason \|\| ''/)
    assert.match(snapshotBody, /oldestWaitMs:/)
    assert.match(snapshotBody, /timeoutBeforeStart: Number\.parseInt\(counters\['storageUpdate\.timeout\.beforeStart'\], 10\) \|\| 0/)
    assert.match(diagnosticBody, /readOnly: true/)
    assert.match(diagnosticBody, /durable: counts/)
    assert.match(diagnosticBody, /runtime/)
    assert.match(diagnosticBody, /storage: getStorageUpdateQueueSnapshot\(\)/)
    assert.match(diagnosticBody, /lastUserStartQueueResult/)
    assert.match(messageBody, /request\.action === 'get-coordinator-why-not-running'[\s\S]*return getCoordinatorWhyNotRunning\(request\)/)
})

test('preferences expose browser-start auto-start as opt-in', () => {
    const defaults = readRepoFile('shared/js/defaults.js')
    const preferences = readRepoFile('shared/preferences.html')
    const preferencesJs = readRepoFile('shared/js/preferences.js')
    const prefs = readRepoFile('shared/js/swprefs.js')
    const worker = readRepoFile('shared/js/sw.js')

    assert.match(defaults, /coordinatorAutoStartOnBrowserStart: false/)
    assert.match(preferences, /id="coordinatorAutoStartOnBrowserStart"/)
    assert.match(preferences, /Auto-Start Current Work/)
    assert.match(preferences, /When on, resume Current Work on browser start\. When off, do nothing until you navigate to a Quora page\./)
    assert.match(preferencesJs, /coordinatorAutoStartOnBrowserStart\.checked = settings\.coordinatorAutoStartOnBrowserStart === true/)
    assert.match(preferencesJs, /coordinatorAutoStartOnBrowserStart: coordinatorAutoStartOnBrowserStart\.checked/)
    assert.match(prefs, /COORDINATOR_AUTO_START_ON_BROWSER_START_KEY = 'coordinatorAutoStartOnBrowserStart'/)
    assert.match(worker, /COORDINATOR_AUTO_START_ON_BROWSER_START_KEY/)
    assert.match(worker, /handleCoordinatorBrowserStartup\(\)/)
    assert.match(worker, /kickCoordinatorQueueResume\('browser-startup-auto-start', \{[\s\S]*allowBeforeQuora: true,[\s\S]*backgroundFastPath: true/)
})

test('extension update rearms stored work from the durable queue', () => {
    const worker = readRepoFile('shared/js/sw.js')
    const browserSessionRuntime = readRepoFile('shared/js/swBrowserSessionRuntime.js')
    const rearmBody = extractFunction(worker, 'async function rearmStoredWorkAfterExtensionReload(reason = \'extension-updated\')')
    const serviceWorkerReloadBody = extractFunction(worker, 'async function rearmStoredWorkAfterServiceWorkerReload(reason = \'service-worker-reload\')')
    const scheduleBody = extractFunction(browserSessionRuntime, 'function scheduleStoredWorkRearmAfterExtensionReload(reason = \'extension-updated\')')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    // D4: the installed handler is a named function (its listener only gates and dispatches to it).
    const installedIndex = bootstrap.indexOf('function handleRuntimeInstalled(details) {')
    const installedBody = bootstrap.slice(installedIndex, bootstrap.indexOf('function handleRuntimeStartup() {', installedIndex))

    const storedReasonIndex = rearmBody.indexOf("const storedWorkReason = `${reason || 'extension-updated'}-stored-work`")
    const durableQueueIndex = rearmBody.indexOf('hasUnpausedStoredCoordinatorWorkInDurableQueue(storedWorkReason)', storedReasonIndex)

    assert.notEqual(storedReasonIndex, -1)
    assert.ok(durableQueueIndex > storedReasonIndex)
    assert.doesNotMatch(rearmBody, /scheduleCoordinatorReconcile/)
    assert.match(rearmBody, /kickCoordinatorQueueResume\(reason, \{[\s\S]*allowBeforeQuora: true,[\s\S]*backgroundFastPath: true,[\s\S]*skipAuthorityReconcile: true,[\s\S]*forceDurableQueueReload: true/)
    assert.match(serviceWorkerReloadBody, /hasBrowserSessionStorage\(\)/)
    assert.match(serviceWorkerReloadBody, /area\.get\(\{\[BROWSER_SESSION_MARKER_KEY\]: null\}\)/)
    assert.match(serviceWorkerReloadBody, /rearmStoredWorkAfterExtensionReload\(reason\)/)
    assert.match(scheduleBody, /setTimeoutFn\(\(\) => \{[\s\S]*rearmStoredWorkAfterExtensionReload\(reason\)/)
    assert.match(installedBody, /scheduleStoredWorkRearmAfterExtensionReload\(resetReason\)/)
    assert.match(worker, /scheduleStoredWorkRearmAfterServiceWorkerReload\(\)/)
})

test('manifests allow service-worker content-script injection fallback', () => {
    const chromeManifest = JSON.parse(readRepoFile('manifests/chrome.json'))
    const firefoxManifest = JSON.parse(readRepoFile('manifests/firefox.json'))

    assert.ok(chromeManifest.permissions.includes('scripting'))
    assert.ok(firefoxManifest.permissions.includes('scripting'))
})

test('space-feed scan root prefers the post-bearing main content node', () => {
    const source = readRepoFile('shared/js/content.js')
    // The root is worked out in computeSpaceFeedContentRoot and reused for a short time by getSpaceFeedContentRoot (24 Oct).
    const rootBody = extractFunction(source, 'function computeSpaceFeedContentRoot()')
    const syncBody = extractFunction(source, 'function syncSpaceFeedNukeControls()')

    assert.match(rootBody, /querySelectorAll\('#mainContent, main, \[role="main"\]'\)/)
    assert.match(rootBody, /timestampCount: candidate\.querySelectorAll\?\.\('a\.post_timestamp, a\.answer_timestamp'\)\.length \|\| 0/)
    assert.match(rootBody, /right\.timestampCount - left\.timestampCount/)
    assert.match(syncBody, /const main = getSpaceFeedContentRoot\(\)/)
})

test('target-space posts can queue the visible header profile without follow proxy markers', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'function getSpaceFeedPostCandidateProfileUrls(postRoot, timestamp)')
    const targetIndex = body.indexOf('if(isTargetSpacePage())')

    assert.notEqual(targetIndex, -1)
    assert.match(body.slice(targetIndex), /posterProfileUrls\.length/)
    assert.match(body.slice(targetIndex), /getNormalizedProfileHrefList\(\[headerProfileHref\]\)/)

    // 2026-09-25: asset-space pages used to ALSO treat any other poster
    // surfaced via an embedded/quoted sub-post as a high-confidence
    // candidate -- the same "poster === target" assumption that's
    // deliberately correct for isTargetSpacePage() above, but wrong for
    // asset pages (a real incident: Franklin Veaux, a genuine contributor,
    // got queued for mute-block this way). Removed entirely rather than
    // trying to distinguish "this embed shows the actual scam target" from
    // "this embed shows an unrelated legitimate contributor" -- the
    // following-status check in blockProfile is the backstop for whatever
    // this collector still gets wrong.
    assert.doesNotMatch(source, /function getSpaceFeedEmbeddedPosterProfileUrls/)
    assert.doesNotMatch(body, /'embedded-profile-link'/)
    assert.doesNotMatch(body, /sharedPosterUrls/)
})

test('asset-space source-post resolver rows do not use the visible post author', () => {
    const source = readRepoFile('shared/js/content.js')
    const subject = readRepoFile('shared/js/subject.js')
    const entriesBody = extractFunction(source, 'function getSpaceFeedPostEntries()')
    const body = extractFunction(source, 'function getQueuedPageResolvedProfileHref(claimedAction = {}, sink = null)')
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

    assert.match(entriesBody, /resolveProfileFromPage: \(isAssetSpacePage\(\) && !!postUrl && needsSourceResolution\) \|\| !!citedUrl/)
    assert.doesNotMatch(entriesBody, /resolveProfileFromPage: isAssetSpacePage\(\) && !!postUrl && \(!candidateUrls\.length \|\| needsSourceResolution\)/)
    assert.match(body, /resolutionReason === 'low-confidence-profile-artifact'/)
    assert.match(reasonBody, /source-post-needs-profile-resolution/)
    // 30 Oct: an asset-space item reads the named profile unless the queue item says it is chasing the poster.
    assert.match(body, /if\(subject !== RESOLUTION_SUBJECT_POSTER && isAssetSpacePage\(\)\) return noteQueuedResolution\(sink, 'explicit', explicitProfileHref\)/)
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

test('asset-space source-post scan only creates resolver rows for explicit source resolution', () => {
    const source = readRepoFile('shared/js/content.js')
    const candidateBody = extractFunction(source, 'function getSpaceFeedPostCandidateProfileUrls(postRoot, timestamp)')
    const entriesBody = extractFunction(source, 'function getSpaceFeedPostEntries()')
    const queueableResolverBody = extractFunction(source, 'function isQueueableSpaceFeedResolverEntry(entry)')
    const queueableResolverRenderBody = extractFunction(source, 'function isQueueableSpaceFeedResolverEntryForRender(entry = null, context = null)')

    assert.match(candidateBody, /if\(!urls\.length && isAssetSpacePage\(\)\) \{[\s\S]*needsSourceResolution = true[\s\S]*continue[\s\S]*\}/)
    assert.match(candidateBody, /return attachSpaceFeedCandidateMetadata\(urls, candidateEvidenceByHref, needsSourceResolution\)/)
    assert.match(entriesBody, /needsSourceResolution = candidateUrls\.needsSourceResolution === true/)
    assert.match(entriesBody, /while\(!candidateUrls\.length && node && node !== contentRoot\)/)
    assert.doesNotMatch(entriesBody, /while\(!candidateUrls\.length && !needsSourceResolution && node && node !== contentRoot\)/)
    assert.match(entriesBody, /resolutionReason: citedUrl \? 'target-post-cites-source' : \(needsSourceResolution \? 'low-confidence-profile-artifact' : ''\)/)
    assert.match(entriesBody, /resolveProfileFromPage: \(isAssetSpacePage\(\) && !!postUrl && needsSourceResolution\) \|\| !!citedUrl/)
    assert.match(queueableResolverBody, /getQueueableSpaceFeedEntryUrls\(entry\)\.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES[\s\S]*return false/)
    assert.match(queueableResolverBody, /resolutionReason \|\| ''\}`\.trim\(\) === 'low-confidence-profile-artifact'[\s\S]*return false/)
    assert.match(queueableResolverRenderBody, /getQueueableSpaceFeedEntryUrlsForRender\(entry, context\)\.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES[\s\S]*return false/)
    assert.match(queueableResolverRenderBody, /resolutionReason \|\| ''\}`\.trim\(\) === 'low-confidence-profile-artifact'[\s\S]*return false/)
    assert.doesNotMatch(entriesBody, /!candidateUrls\.length \|\| needsSourceResolution/)
})

test('source-post resolver waits for durable remap before navigating', () => {
    const source = readRepoFile('shared/js/content.js')
    const claimHelperBody = extractFunction(source, 'async function acceptQueuedProfileActionClaim(request = {})')
    const retryBody = extractFunction(source, 'async function sendQueuedProfileResolutionMessageWithRetry(message)')
    const actionBody = extractFunction(source, 'async function maybeRunAutoProfileAction()')

    assert.match(source, /QUEUED_PROFILE_RESOLUTION_MESSAGE_ATTEMPTS = 3/)
    assert.match(claimHelperBody, /canResolveQueuedProfileFromCurrentPage\(nextProfileAction \|\| \{\}\)/)
    assert.match(claimHelperBody, /return \{accepted: false, reason: 'not-profile'\}/)
    assert.ok(
        claimHelperBody.indexOf('const nextProfileAction') <
        claimHelperBody.indexOf('canResolveQueuedProfileFromCurrentPage(nextProfileAction || {})')
    )
    assert.match(retryBody, /QUEUED_PROFILE_RESOLUTION_MESSAGE_TIMEOUT_MS/)
    assert.match(retryBody, /result\?\.resolved === true/)
    assert.match(actionBody, /sendQueuedProfileResolutionMessageWithRetry/)
    assert.match(actionBody, /if\(response\?\.resolved !== true\) return false/)
    assert.match(actionBody, /location\.replace\(resolvedProfileHref\)/)
})

test('resolved profile handoff remaps queued tab metadata and pending action', () => {
    const source = readRepoFile('shared/js/sw.js')
    const queuedTabMetadataAndActionLeaseSource = readRepoFile('shared/js/swQueuedTabMetadataAndActionLease.js')
    const remapBody = extractFunction(
        queuedTabMetadataAndActionLeaseSource,
        'function remapQueuedTabToResolvedProfile(tabId, item = {}, resolvedHref = \'\', requestedUrl = \'\')'
    )
    const resolveBody = extractFunction(source, 'async function resolveQueuedProfileTarget(request = {}, sender = {})')
    const resolveMutationBody = extractFunction(source, 'async function mutateCoordinatorQueuedProfileTargetResolve(operation = {})')

    assert.match(remapBody, /profileHref: resolvedHref/)
    assert.match(remapBody, /coordinatorKey: resolvedHref/)
    assert.match(remapBody, /resolveProfileFromPage: false/)
    assert.match(remapBody, /resolutionMode: ''/)
    assert.match(remapBody, /resolutionReason: ''/)
    assert.match(remapBody, /queueRuntime\.setPendingTabAction/)
    assert.match(remapBody, /targetUrl: resolvedHref/)
    assert.match(remapBody, /attemptId/)
    assert.match(remapBody, /attemptNumber/)
    assert.match(resolveBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'PROFILE_TARGET_RESOLVE'/)
    assert.match(resolveBody, /result\?\.resolved === true[\s\S]*remapQueuedTabToResolvedProfile\(/)
    assert.match(resolveMutationBody, /delete nextQueue\[itemKey\]/)
    assert.match(resolveMutationBody, /\[resolvedHref\]: nextItem/)
    assert.match(resolveMutationBody, /coordinatorQueueReader\.runsProgress\(\{[\s\S]*metricPath: 'resolver\.resolve\.load'/)
    assert.doesNotMatch(resolveMutationBody, /loadCoordinatorState\(/)
    assert.match(resolveMutationBody, /terminal-coordinator-item/)
    assert.match(resolveMutationBody, /not-profile-resolution-item/)
    assert.match(resolveMutationBody, /inactive-coordinator-item/)
    assert.match(resolveMutationBody, /missing-attempt-identity/)
    assert.match(resolveMutationBody, /coordinatorAuthority\.persistCoordinator\(/)
    assert.match(resolveMutationBody, /operationKind: 'resolver-remap'/)
    assert.match(resolveMutationBody, /removedRows/)
    assert.match(resolveMutationBody, /queue: false/)
})

test('space feed has no pause control; pausing is on the dashboard only', () => {
    const source = readRepoFile('shared/js/content.js')
    const topBody = extractFunction(source, 'function syncSpaceFeedTopNukeButton(renderModel)')
    const postBody = extractFunction(source, 'function syncSpaceFeedPostButtons(renderModel)')

    assert.doesNotMatch(source, /syncSpaceFeedTopPauseButton/)
    assert.doesNotMatch(source, /pauseSpaceFeedQueue/)
    assert.doesNotMatch(source, /mb-ext_space-feed-pause-btn/)
    assert.match(topBody, /if\(activeButton\.dataset\.mbNukeState === 'working'\) \{\s*return\s*\}/)
    assert.doesNotMatch(postBody, /pauseSpaceFeedQueue/)
})

test('space collect goes back to the top when done, the column copy sits after the last box, and queued work does not hold the Nuke Em button', () => {
    const source = readRepoFile('shared/js/content.js')
    const css = readRepoFile('shared/css/content.css')
    const collectBody = extractFunction(source, 'async function collectMoreSpaceFeedPosts(button)')
    const topBody = extractFunction(source, 'function syncSpaceFeedTopNukeButton(renderModel)')

    assert.match(collectBody, /finally \{[\s\S]*window\.scrollTo\(\{top: 0, behavior: 'auto'\}\)/)
    assert.match(css, /\.mb-ext_space-collect-column-host \{\s*margin-top: 8px;\s*\}/)
    assert.doesNotMatch(css, /\.mb-ext_space-collect-column-host \{[^}]*position: sticky/)
    assert.match(extractFunction(source, 'function ensureSpaceCollectWrapInRightColumn()'), /getLastSpaceColumnBox\(column\)[\s\S]*insertAdjacentElement\('afterend', host\)/)
    assert.match(extractFunction(source, 'function getLastSpaceColumnBox(column)'), /qu-borderAll/)
    assert.match(topBody, /if\(queueSubmissionPending\) \{\s*syncSpaceFeedNukingStatus\(host, model, activeSpaceWork\)\s*return true\s*\}/)
    assert.match(topBody, /if\(activeSpaceWork\) \{\s*setSpaceFeedButtonSelection\(button, queueableEntries\)/)
    assert.doesNotMatch(topBody, /setNukeButtonWorking\(button, formatSpaceFeedGlobalWorkLabel/)
    assert.match(topBody, /syncSpaceFeedNukingStatus\(host, model, activeSpaceWork\)/)
})

test('Stop collecting on space and search pages is fixed at the bottom, its left edge on the Nuke Em button left edge, outside the right column, and its hover help goes through the shared helper', () => {
    const source = readRepoFile('shared/js/content.js')
    const css = readRepoFile('shared/css/content.css')
    const columnBody = extractFunction(source, 'function ensureSpaceCollectWrapInRightColumn()')
    const stopBody = extractFunction(source, 'function createSpaceCollectStopButton()')
    const searchStopBody = extractFunction(source, 'function createProfileSearchStopButton()')

    // The right column: the copy goes after the last box. The Stop button is not in the column (owner, 26 Oct), so no column re-render can remove it mid-run.
    assert.match(columnBody, /host\.appendChild\(createSpaceCollectWrap\('mb-ext_space-collect-column'\)\)/)
    assert.doesNotMatch(columnBody, /createSpaceCollectStopButton/)
    assert.match(columnBody, /lastBox\.insertAdjacentElement\('afterend', host\)/)
    // Fixed at the bottom, with its left edge on the Nuke 'Em left edge (coordinator correction): one shared rule for both Stop buttons, at the toolbar's stacking.
    const stopRule = css.match(/\.mb-ext_space-collect-stop-btn,\s*\n\.mb-ext_profile-search-stop-btn \{[^}]*\}/)
    assert.ok(stopRule, 'the Stop collecting buttons share a fixed CSS rule')
    assert.match(stopRule[0], /position:\s*fixed;/)
    // Above the Next notification pill (owner decision, option 3): the pill's top is about 66-68px above the bottom, so 84px leaves a gap.
    assert.match(stopRule[0], /bottom:\s*84px;/)
    // right = toolbar gap (18) + Collect N More width (139.5) - Stop width (113.5), measured on the search page: Collect left 906.5 at a 1064px layout width.
    assert.match(stopRule[0], /right:\s*44px;/)
    assert.ok(Math.abs((18 + 139.5 - 113.5) - 44) < 0.05, 'the right offset is the toolbar gap plus the Collect button width less the Stop width')
    assert.ok(Math.abs((1064 - 18 - 139.5) - 906.5) < 0.05, 'the measured Collect left edge follows from the toolbar gap and the Collect width at a 1064px layout')
    assert.match(stopRule[0], /z-index:\s*2147483646;/)
    assert.match(css, /\.mb-ext_space-collect-stop-btn\[hidden\][\s\S]*display: none;/)
    // The space sync adds the button to the body on first use, and the removal on the page never takes it mid-run.
    assert.match(extractFunction(source, 'function syncSpaceFeedStopButtons()'), /document\.body\?\.appendChild\(stopButton\)/)
    assert.match(extractFunction(source, 'function removeSpaceCollectButtons()'), /if\(!spaceFeedCollecting\) document\.querySelector\('\.mb-ext_space-collect-stop-btn'\)\?\.remove\(\)/)

    // Hover help through the shared helper, so the prefix is the one muteBlockHelp.js owns.
    assert.match(stopBody, /setMuteBlockHelp\(button, /)
    assert.match(searchStopBody, /setMuteBlockHelp\(button, /)
    assert.match(readRepoFile('shared/js/muteBlockHelp.js'), /MUTE_BLOCK_HELP_PREFIX = 'Mute Block extension: '/)

    // The search page's Stop button is not in the toolbar (owner, 26 Oct): the toolbar ends with the Collect N More wrap, and the Stop button
    // is appended to the page body on first use. It fixes at the bottom, left of the Next notification pill, and is hidden unless a collect runs.
    const toolbarBody = extractFunction(source, 'function getProfileSearchToolbar()')
    assert.doesNotMatch(toolbarBody, /createProfileSearchStopButton/)
    assert.match(toolbarBody, /toolbar\.appendChild\(collectWrap\)\s*document\.body\.appendChild\(toolbar\)/)
    assert.match(extractFunction(source, 'function syncProfileSearchStopButton()'), /document\.body\?\.appendChild\(stopButton\)/)
    assert.match(css, /\.mb-ext_profile-search-stop-btn\[hidden\]/)
})

test('the Stop collecting label on both pages comes from the shared candidateCollect helper, its timer runs only during a run, and both loops keep their counters', () => {
    const source = readRepoFile('shared/js/content.js')
    const spaceSync = extractFunction(source, 'function syncSpaceFeedStopButtons()')
    const searchSync = extractFunction(source, 'function syncProfileSearchStopButton()')

    // Both pages call the same helper, and neither builds the label text by hand.
    assert.match(source, /const \{formatCollectStopLabel, STOP_COLLECT_LABEL_TEXT\} = require\('\.\/candidateCollect'\)/)
    assert.match(extractFunction(source, 'function createSpaceCollectStopButton()'), /button\.textContent = STOP_COLLECT_LABEL_TEXT/)
    assert.match(extractFunction(source, 'function createProfileSearchStopButton()'), /button\.textContent = STOP_COLLECT_LABEL_TEXT/)
    assert.match(extractFunction(source, 'function refreshSpaceFeedStopLabel()'), /formatCollectStopLabel\(\{/)
    assert.match(extractFunction(source, 'function refreshProfileSearchStopLabel()'), /formatCollectStopLabel\(\{/)
    assert.doesNotMatch(source, /Stop collecting · /)
    // The timer ticks once per COLLECT_STOP_LABEL_TICK_MS while a run is active, and is cleared when the run ends.
    assert.match(spaceSync, /setInterval\(refreshSpaceFeedStopLabel, COLLECT_STOP_LABEL_TICK_MS\)/)
    assert.match(spaceSync, /clearInterval\(spaceFeedStopLabelTimer\)/)
    assert.match(searchSync, /setInterval\(refreshProfileSearchStopLabel, COLLECT_STOP_LABEL_TICK_MS\)/)
    assert.match(searchSync, /clearInterval\(profileSearchStopLabelTimer\)/)
    assert.match(readRepoFile('shared/js/tunables.js'), /COLLECT_STOP_LABEL_TICK_MS: 1000/)
    // Each run starts its counters, and the start of the run goes to the shared sync before the loop runs.
    assert.match(extractFunction(source, 'async function collectMoreSpaceFeedPosts(button)'), /spaceFeedCollectProgress = \{startedAt: Date\.now\(\), passes: 0, collected: 0, target: limit\}\s*syncSpaceFeedStopButtons\(\)/)
    assert.match(extractFunction(source, 'async function collectMoreProfileSearchResults(button)'), /profileSearchCollectProgress = \{startedAt: Date\.now\(\), passes: 0, collected: 0, target: limit\}[\s\S]*?syncProfileSearchStopButton\(\)/)
})

test('choosing a collect count only sets it; the collect starts from the Collect button, on both pages', () => {
    const source = readRepoFile('shared/js/content.js')
    const spaceBody = extractFunction(source, 'function syncSpaceFeedCollectButton(options = {})')
    const searchBody = extractFunction(source, 'function syncProfileSearchControls()')

    assert.match(spaceBody, /setSpaceFeedCollectLimit\(Number\.parseInt\(event\.currentTarget\.value, 10\)\)/)
    assert.match(searchBody, /setProfileSearchCollectLimit\(Number\.parseInt\(event\.currentTarget\.value, 10\)\)/)
    assert.doesNotMatch(spaceBody, /void collectMoreSpaceFeedPosts\(collectButton\)/)
    assert.doesNotMatch(searchBody, /void collectMoreProfileSearchResults\(collectButton\)/)
})

test('every hover the extension adds starts with "Mute Block extension: " (28 Oct)', () => {
    const prefix = 'Mute Block extension: '
    // Not checked, and why: the toolbar icon tooltip set with browser.action.setTitle in shared/js/sw.js ("Mute Block: write-queue backlog
    // detected"), because sw.js is outside this change; the tab titles set with document.title in shared/js/coordinator.js, which are not
    // hovers; and the build copies under chrome/ and firefox/ (coordinator and preferences pages, js), which the build regenerates from shared/.
    // The hand-kept popup pages chrome/popup.html and firefox/popup.html are checked. No title on the checked pages is excluded.
    const htmlFiles = ['shared/coordinator.html', 'shared/preferences.html', 'chrome/popup.html', 'firefox/popup.html']
    for (const file of htmlFiles) {
        const html = readRepoFile(file)
        assert.doesNotMatch(html, /Mute Block extension: Mute Block extension/, `${file} does not double the prefix`)
        const titles = [...html.matchAll(/\stitle="([^"]*)"/g)].map(match => match[1])
        assert.ok(titles.length > 0, `${file} has hover titles to check`)
        for (const title of titles) assert.ok(title.startsWith(prefix), `${file} hover without the prefix: ${title}`)
    }
    // The title options (buildTitleCell, buildMetricCard) reach the page through the assignments checked here.
    const jsFiles = ['shared/js/coordinator.js', 'shared/js/content.js', 'shared/js/queueProgressBar.js', 'shared/js/nukingControl.js', 'shared/js/preferences.js']
    for (const file of jsFiles) {
        const source = readRepoFile(file)
        assert.doesNotMatch(source, /muteBlockHelpText\(\s*muteBlockHelpText|setMuteBlockHelp\([^,]+,\s*muteBlockHelpText\(/, `${file} does not add the prefix twice`)
        // An assignment of a hover (x.title = ...). document.title is the tab title, not a hover.
        const assignments = source.split('\n').map(line => line.trim()).filter(line => /\.title\s*=[^=]/.test(line) && !/document\.title\s*=/.test(line))
        for (const line of assignments) {
            const prefixed = /muteBlockHelpText\(/.test(line) ||
                /^singleButton\.title = `\$\{singleButton\.title\}/.test(line) ||
                /^(card|detailNode)\.title = fullTitle$/.test(line)
            assert.ok(prefixed, `${file} sets a hover without the prefix: ${line}`)
        }
    }
    assert.match(readRepoFile('shared/js/coordinator.js'), /const fullTitle = muteBlockHelpText\(options\.title \|\| detail\)/)
})

test('every extension button has hover help that starts with "Mute Block extension: "', () => {
    const pageHtml = readRepoFile('shared/coordinator.html') + readRepoFile('shared/preferences.html')
    const buttonTags = pageHtml.match(/<button\b[^>]*>/g) || []
    // 40 after the Cancel Queue, Requeue, soft-fail toggle and Authority reads panel removals (was 45).
    assert.ok(buttonTags.length >= 40, `expected at least 40 buttons in the pages, found ${buttonTags.length}`)
    for(const tag of buttonTags) assert.match(tag, /\stitle="Mute Block extension: [^"]+"/, tag)

    assert.match(readRepoFile('shared/js/muteBlockHelp.js'), /const MUTE_BLOCK_HELP_PREFIX = 'Mute Block extension: '/)
    for(const file of ['shared/js/content.js', 'shared/js/coordinator.js', 'shared/js/preferences.js', 'shared/js/queueProgressBar.js']) {
        const source = readRepoFile(file)
        assert.match(source, /require\('\.\/muteBlockHelp'\)/, file)
        assert.doesNotMatch(source, /Mute-Block Extension: /, file)
    }
})

test('space feed action buttons keep Nuke Em labels', () => {
    const source = readRepoFile('shared/js/content.js')
    const topBody = extractFunction(source, 'function syncSpaceFeedTopNukeButton(renderModel)')
    const postBody = extractFunction(source, 'function syncSpaceFeedPostButtons(renderModel)')
    const statusBody = extractFunction(source, 'function syncSpaceFeedNukingStatus(host, model = {}, activeWork = false)')
    const postWorkLabelBody = extractFunction(source, 'function formatSpaceFeedPostWorkLabel()')

    assert.match(topBody, /Nuke 'Em/)
    assert.match(postBody, /Nuke 'Em/)
    assert.match(statusBody, /spaceFeedNukingToolbar\(\{/)
    assert.match(readRepoFile('shared/js/candidateStatus.js'), /Nuking\.\.\./)
    assert.match(postWorkLabelBody, /Nuking this/)
    assert.doesNotMatch(topBody, /Queue visible/)
    assert.doesNotMatch(postBody, /Queue visible/)
    assert.doesNotMatch(statusBody, /Space jobs/)
    assert.doesNotMatch(postWorkLabelBody, /This post:/)
    assert.doesNotMatch(postWorkLabelBody, /left/)
})

test('the status and batch text on the space page and the search page come from the shared candidateStatus helper, and the old inline strings are gone from content.js', () => {
    const content = readRepoFile('shared/js/content.js')
    assert.match(content, /const \{NOTHING_QUEUED_LABEL, NUKED_LABEL, formatToolbarNukingStatus, formatProfileRowState\} = require\('\.\/candidateStatus'\)/)
    // Each page builds its toolbar status with the one presence rule (formatToolbarNukingStatus), from its own facts (28 Oct).
    // Both pages read the paused flag from the stored pause (nukingQueuePaused), not from the space model's ownerPaused.
    assert.match(extractFunction(content, 'function syncSpaceFeedNukingStatus(host, model = {}, activeWork = false)'), /spaceFeedNukingToolbar\(\{\s*queueing: model\?\.queueingProfileCount \|\| 0,\s*left,\s*paused: nukingQueuePaused\s*\}\)/)
    assert.match(extractFunction(content, 'function setProfileSearchNukingStatus(toolbar, count = 0, queueingCount = 0)'), /formatToolbarNukingStatus\(\{queueing, left: remaining, workActive: false, paused: nukingQueuePaused\}\)/)
    // The search rows take their words from the shared row-state builder, and the batch driver takes its Queueing words from the shared builder.
    assert.match(content, /setNukeButtonWorking\(button, formatProfileRowState\('queueing'\)\)/)
    assert.match(content, /setNukeButtonWorking\(button, formatProfileRowState\('nuking'\)\)/)
    assert.match(content, /setNukeButtonDone\(button, formatProfileRowState\('nuked'\)\)/)
    assert.match(readRepoFile('shared/js/candidateNuke.js'), /require\('\.\/candidateStatus'\)/)
    // The old inline copies are gone from content.js.
    for (const oldText of [
        '`Nuking... ${remaining} left`',
        '`Queueing... ${queueing}`',
        '`Paused · ${working}`',
        '\'Paused\'',
        '\'Nothing queued\'',
        '\'Queueing...\'',
        '\'Nuked\''
    ]) {
        assert.equal(content.includes(oldText), false, `content.js still has the inline ${oldText}`)
    }
})

test('the Nuking drop-down is one shared builder for the space page and the search page, and no page builds its own pause menu (28 Oct)', () => {
    const content = readRepoFile('shared/js/content.js')
    const sharedControl = readRepoFile('shared/js/nukingControl.js')
    // content.js takes the drop-down's words, items and messages from the shared module.
    assert.match(content, /const \{nukingControlView, nukingStatusShowsControl, spaceFeedNukingToolbar\} = require\('\.\/nukingControl'\)/)
    assert.match(extractFunction(content, 'function buildNukingControl()'), /nukingControlView\(nukingQueuePaused, left\)/)
    // Both pages: the working Nuking button and the toolbar status get the drop-down through the same two placement helpers.
    assert.match(extractFunction(content, 'function setNukeButtonWorking(button, label = formatProfileRowState(\'nuking\'))'), /syncNukingControlForButton\(button, label\)/)
    assert.match(extractFunction(content, 'function syncNukingControlForButton(button, label)'), /nukingControlPageAllowed\(\)[\s\S]*attachNukingControl\(button, 0\)/)
    assert.match(extractFunction(content, 'function nukingControlPageAllowed()'), /'space'[\s\S]*'profile-search'/)
    // 30 Oct: both toolbars place their status through syncNukingToolbarStatus, which attaches the drop-down itself. The default flag is the
    // text rule (nukingStatusShowsControl); the space page passes its own flag (spaceFeedNukingToolbar), since its drop-down carries the words.
    assert.match(extractFunction(content, 'function syncNukingToolbarStatus(host, anchor, text, left = 0, showsControl = nukingStatusShowsControl(text))'), /attachNukingControl\(status, left\)/)
    // The drop-down is built in one place, and its clicks stop there.
    assert.equal(content.split("className = 'mb-ext_nuking-control'").length - 1, 1)
    assert.match(extractFunction(content, 'function buildNukingControl()'), /event\.stopPropagation\(\)[\s\S]*event\.preventDefault\(\)/)
    // The messages come from nukingControl.js only: content.js never names the worker actions, and the shared module names both.
    assert.equal(content.includes('pause-coordinator-nukes'), false)
    assert.equal(content.includes('resume-paused-coordinator-nukes'), false)
    assert.match(sharedControl, /'pause-coordinator-nukes'/)
    assert.match(sharedControl, /'resume-paused-coordinator-nukes'/)
    // No other shared file builds the drop-down or its menu.
    for (const other of ['shared/js/candidateNuke.js', 'shared/js/candidateStatus.js', 'shared/js/coordinator.js', 'shared/js/swBootstrap.js', 'shared/js/muteBlockHelp.js']) {
        assert.equal(readRepoFile(other).includes('mb-ext_nuking-control'), false, `${other} builds no drop-down`)
    }
    // The paused flag comes from the stored pause, read where the progress bar already reads it.
    assert.match(extractFunction(content, 'async function refreshContentProgressBar(pushedSummary = undefined)'), /const paused = !!stored\?\.\[COORDINATOR_PAUSED_KEY\][\s\S]*setNukingQueuePaused\(paused\)/)
})

test('the Current Work queue table has a Queue label directly above it, and the heading stays Current Work (28 Oct)', () => {
    const html = readRepoFile('shared/coordinator.html')
    const css = readRepoFile('shared/css/coordinator.css')
    assert.match(html, /<h2[^>]*>Current Work<\/h2>/)
    assert.match(html, /<div class="queue-table-label" id="queueTableLabel">Queue<\/div>\s*<div class="list" id="queueList"><\/div>/)
    assert.match(css, /\.queue-table-label \{/)
})

test('both batch toolbars call one builder and use one class set and one style rule for the nuking status (28 Oct)', () => {
    const content = readRepoFile('shared/js/content.js')
    const css = readRepoFile('shared/css/content.css')
    assert.match(content, /const NUKING_TOOLBAR_STATUS_CLASS = 'mb-ext_nuking-status'/)
    // The one builder. Both toolbars call it, and it is the only place the status element is built.
    assert.match(extractFunction(content, 'function syncNukingToolbarStatus(host, anchor, text, left = 0, showsControl = nukingStatusShowsControl(text))'), /status\.className = NUKING_TOOLBAR_STATUS_CLASS/)
    assert.match(extractFunction(content, 'function syncSpaceFeedNukingStatus(host, model = {}, activeWork = false)'), /syncNukingToolbarStatus\(host, host\.querySelector\('\.mb-ext_space-feed-nuke-btn'\), toolbar\.statusText, left, toolbar\.showsControl\)/)
    assert.match(extractFunction(content, 'function setProfileSearchNukingStatus(toolbar, count = 0, queueingCount = 0)'), /syncNukingToolbarStatus\(toolbar, toolbar\.querySelector\('\.mb-ext_profile-search-batch-btn'\), text, remaining\)/)
    assert.equal(content.split("className = 'mb-ext_nuking-status'").length - 1, 0, 'no page sets its own class on the status')
    assert.equal(content.includes('mb-ext_space-feed-nuking-status'), false)
    assert.equal(content.includes('mb-ext_profile-search-nuking-status'), false)
    // One style rule, and the old per-page selectors are gone.
    assert.match(css, /\.mb-ext_nuking-status \{/)
    assert.equal(css.includes('mb-ext_space-feed-nuking-status'), false)
    assert.equal(css.includes('mb-ext_profile-search-nuking-status'), false)
})

test('E4 and the wording: the per-post button reads Nuking... with no count, and the end-of-results text is end of search results (28 Oct)', () => {
    const content = readRepoFile('shared/js/content.js')
    assert.equal(content.includes('`Nuking ${aggregateCount}`'), false)
    assert.match(content, /setNukeButtonWorking\(queueButton, formatProfileRowState\('nuking'\)\)/)
    assert.match(content, /'end-of-results': 'End of search results'/)
    assert.match(content, /'end-of-feed': 'End of search results'/)
    assert.match(content, /end of search results`/)
    assert.equal(content.includes("'End of results'"), false)
    assert.equal(content.includes('· end of results`'), false)
    // The internal reason string stays as it was: it is an identifier in the flight recorder.
    assert.match(content, /'end-of-results' : 'stalled'/)
})

test('dashboard has reversible pause and explicit current work cancel', () => {
    const html = readRepoFile('shared/coordinator.html')
    const dashboard = readRepoFile('shared/js/coordinator.js')
    const sw = readRepoFile('shared/js/sw.js')
    const bookkeeping = readRepoFile('shared/js/swSchedulerAlarmBookkeeping.js')
    const pauseStoredBody = extractFunction(sw, 'async function pauseStoredCoordinatorWork(options = {})')
    const pauseStoredMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkPause(operation = {})')
    const pauseItemBody = extractFunction(bookkeeping, 'function buildPausedCoordinatorQueueItem(item = {}, now = getNow(), reason = \'coordinator-pause-request\')')
    const pauseCleanupBody = extractFunction(sw, 'async function pauseCoordinatorNukesCleanup(pauseGeneration = coordinatorPauseGeneration)')
    const pauseBody = extractFunction(sw, 'async function pauseCoordinatorNukes()')
    const cancelBody = extractFunction(sw, 'async function cancelCoordinatorCurrentWork()')
    const cancelStoredBody = extractFunction(sw, 'async function cancelStoredCoordinatorWork(options = {})')
    const cancelStoredMutationBody = extractFunction(sw, 'async function mutateCoordinatorStoredWorkCancel(operation = {})')
    const resumePausedBody = extractFunction(sw, 'async function resumePausedCoordinatorNukes(options = {})')
    const resumeBody = extractFunction(sw, 'async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {})')
    // the stored-pause-state guard was extracted to
    // decideResumeCoordinatorStoredPausedOutcome in decomposition Slice P2-19,
    // then moved to swResumeQueueExecutionDecisions.js in decomposition
    // Slice P2.5-3.
    const storedPausedOutcomeBody = extractFunction(readRepoFile('shared/js/swResumeQueueExecutionDecisions.js'), 'function decideResumeCoordinatorStoredPausedOutcome(params = {})')
    const pauseControlBody = extractFunction(dashboard, 'function syncCurrentWorkPauseControls(queueItems = [])')
    const togglePauseBody = extractFunction(dashboard, 'async function toggleCurrentWorkPause()')
    const flashButtonBody = extractFunction(dashboard, 'function flashButton(button)')
    const css = readRepoFile('shared/css/coordinator.css')

    assert.match(html, /id="pauseCurrentWorkButton"/)
    assert.match(html, /id="pauseCurrentWorkState"/)
    assert.doesNotMatch(html, /id="cancelCurrentWorkButton"/)
    assert.doesNotMatch(html, /Cancel Queue/)
    assert.match(html, /id="workerBarCancel"/)
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
    const pauseStateRuleBody = extractCssRuleBody(css, '.pause-state')
    assert.match(pauseStateRuleBody, /border-radius: 3px;/)
    assert.doesNotMatch(pauseStateRuleBody, /border-radius: 999px;/)
    assert.match(css, /\.pause-state--paused/)
    assert.match(css, /\.pause-state--pending/)
    assert.match(pauseCleanupBody, /pauseStoredCoordinatorWork/)
    assert.match(pauseCleanupBody, /isCoordinatorPauseGenerationCurrent\(pauseGeneration\)/)
    assert.match(pauseCleanupBody, /!storedResult \|\| typeof storedResult !== 'object' \|\| storedResult\?\.reason \|\| storedResult\?\.persistence\?\.saved === false/)
    assert.match(pauseCleanupBody, /shouldContinue: \(\) => isCoordinatorPauseGenerationCurrent\(pauseGeneration\)/)
    assert.match(pauseBody, /setCoordinatorPauseControlState\(true, pauseGeneration, 'ordinaryMutation'\)/)
    assert.match(pauseBody, /const pauseGeneration = await nextCoordinatorPauseGenerationFromStorage\(\)/)
    assert.match(pauseBody, /const cleanup = await pauseCoordinatorNukesCleanup\(pauseGeneration\)/)
    assert.match(pauseBody, /scheduled: false/)
    assert.doesNotMatch(pauseBody, /void pauseCoordinatorNukesCleanup\(pauseGeneration\)/)
    assert.doesNotMatch(pauseBody, /cancelStoredCoordinatorWork/)
    assert.match(resumePausedBody, /const pauseGeneration = await nextCoordinatorPauseGenerationFromStorage\(\)/)
    assert.match(resumePausedBody, /setCoordinatorPauseControlState\(false, pauseGeneration, 'ordinaryMutation'\)/)
    assert.match(resumePausedBody, /void setCoordinatorRunsPaused\(false\)/)
    assert.match(resumePausedBody, /kickCoordinatorQueueResume\('dashboard-resume', \{[\s\S]*direct: true,[\s\S]*allowBeforeQuora: true,[\s\S]*serviceWorkerOwned: true,[\s\S]*forceDurableQueueReload: true,[\s\S]*awaitFill: true,[\s\S]*returnAfterDurableActive: true/)
    assert.match(pauseStoredBody, /pauseGeneration/)
    assert.match(pauseStoredBody, /type: 'PAUSE_STORED_WORK'/)
    assert.match(pauseStoredMutationBody, /mutateCoordinatorPauseStateSet\(\{[\s\S]*paused: true,[\s\S]*pauseGeneration/)
    assert.match(pauseStoredMutationBody, /isCoordinatorPauseGenerationCurrent\(pauseGeneration\)/)
    assert.match(pauseStoredMutationBody, /buildPausedCoordinatorQueueItem/)
    assert.match(pauseStoredMutationBody, /operationKind: 'stored-work-pause'/)
    assert.match(pauseItemBody, /status: 'queued'/)
    assert.doesNotMatch(pauseStoredMutationBody, /status: 'canceled'/)
    assert.match(cancelBody, /cancelStoredCoordinatorWork/)
    assert.match(cancelStoredBody, /type: hasTarget \? 'CANCEL_STORED_WORK_ITEM' : 'CANCEL_STORED_WORK'/)
    assert.match(cancelStoredMutationBody, /status: 'canceled'/)
    assert.match(cancelStoredMutationBody, /operationKind: 'stored-work-cancel'/)
    assert.match(cancelStoredMutationBody, /persistCoordinatorWithFinishedOutliers\(/)
    assert.match(cancelStoredMutationBody, /queueOperation: 'stored-work-cancel-derived'/)
    assert.match(cancelBody, /coordinatorPauseRequested = true/)
    assert.match(cancelBody, /setCoordinatorPauseControlState\(true, pauseGeneration, 'ordinaryMutation'\)/)
    assert.match(cancelBody, /shouldContinueSync: \(\) => isCoordinatorPauseGenerationLocallyCurrent\(pauseGeneration\)/)
    // Cancel (the header button, via cancelCurrentWork) stops the *current* work; it should not leave the
    // coordinator indefinitely unable to pick up anything new afterward.
    // The pause set above is only a teardown-safety guard for the duration
    // of the cancel itself (so a resume/new-queue race can't sneak in
    // mid-teardown) -- it's cleared again once the cancel finishes, on
    // every exit path including failure.
    assert.match(cancelBody, /setCoordinatorPauseControlState\(false, pauseGeneration, 'ordinaryMutation'\)/)
    assert.match(resumeBody, /COORDINATOR_PAUSED_KEY/)
    assert.match(storedPausedOutcomeBody, /reason: 'coordinator-paused'/)
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
    assert.match(observer, /const activeModal = dialogMayBeOpen \? getProfilePeopleModal\(\) : null/)
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

test('same-attempt terminal success reconciles stale failed coordinator rows', () => {
    const source = readRepoFile('shared/js/sw.js')
    const reducerSource = readRepoFile('shared/js/swCoordinatorProgressReducer.js')
    const authorityTransitionBody = extractFunction(source, 'async function applyCoordinatorReconcileQueueAuthorityTransitionPhase(ctx = {})')
    const progressReconcileBody = extractFunction(readRepoFile('shared/js/swCoordinatorReconcileLockedMaterialization.js'), 'function applyProgressRecordCoordinatorReconcileActionLocked(state = {}, operation = {})')
    const preferBody = extractFunction(
        reducerSource,
        'function shouldPreferSuccessfulProgressOverTerminalCoordinatorItem(item = null, record = null, mapped = null)'
    )
    const restoreBody = extractFunction(
        reducerSource,
        'function shouldRestoreTerminalProgressFromCoordinatorItem(item = null, record = null)'
    )
    const progressTransitionBody = extractFunction(
        reducerSource,
        'function transitionCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {})'
    )
    const projectedBody = extractFunction(
        reducerSource,
        'function buildProjectedCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {})'
    )
    const mergeBody = extractFunction(
        reducerSource,
        'function mergeReducedCoordinatorProgressItem(item = {}, reducedItem = {}, projectedItem = {}, mapped = {}, record = {}, options = {})'
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
    assert.match(progressTransitionBody, /promoteTerminalCoordinatorItemFromSuccessfulProgress\(item, record, mapped/)
    assert.match(projectedBody, /record\.actionSurfaceMode \|\| item\.actionSurfaceMode/)
    assert.match(mergeBody, /projectedItem\.actionSurfaceMode \|\| reducedItem\.actionSurfaceMode/)
    assert.match(authorityTransitionBody, /applyProgressRecordCoordinatorReconcileActionLocked\(state, \{[\s\S]*kind: 'reconcileFromProgressRecord'[\s\S]*record,[\s\S]*mapped,[\s\S]*resetRetry/)
    assert.match(progressReconcileBody, /matchesCoordinatorReconcileOperationAttempt\(item, operation\)/)
    assert.match(progressReconcileBody, /transitionCoordinatorItemFromProgress\(item, record, mapped/)
    assert.match(progressReconcileBody, /queue\[itemKey\] = nextItem/)
    assert.doesNotMatch(source, /syncCoordinatorProgressRecordsLocked/)
    assert.doesNotMatch(source, /syncCoordinatorProgressRecords\(progressRecords/)
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
    const queueLoadedIndex = initBody.indexOf('await refreshCoordinatorQueueFromRuntime')
    const regularClaimIndex = initBody.lastIndexOf('nudgeCurrentProfilePendingClaim()')
    const refreshBody = extractFunction(source, 'async function refreshCoordinatorQueueFromRuntime(options = {})')

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
    assert.match(refreshBody, /refreshContentPageCoordinatorStateFromRuntime\(/)
    assert.match(nudgeBody, /void maybeRunAutoProfileAction\(\)/)
})

test('queued action claim retries the durable queue sync instead of waiting on a permanently stale flag', () => {
    // Regression for a live 2026-09-12 incident: init() calls
    // refreshCoordinatorQueueFromRuntime exactly once, with a 3s budget.
    // If the SW is busy right at page load (e.g. mid reconcile of a large
    // backlog) that one attempt can time out, and nothing else was retrying
    // it -- coordinatorQueueLoaded stayed false for that page's entire
    // life, so this branch looped forever re-checking the same stale flag
    // and claim-tab-action was never even attempted, even though other
    // message handlers (close-if-blocked) kept responding fine since they
    // don't depend on this flag. A profile could then sit "active" for its
    // full retry-budget lifetime doing nothing before finally getting
    // reconciled back to queued. The retry branch must re-kick the sync
    // (refreshContentPageCoordinatorStateFromRuntime has its own
    // throttle/dedup, so calling it repeatedly here is safe) so a
    // transient SW hiccup can self-heal instead of stranding the tab.
    const source = readRepoFile('shared/js/content.js')
    const actionBody = extractFunction(source, 'async function maybeRunAutoProfileAction()')
    const gateIndex = actionBody.indexOf('!coordinatorQueueLoaded')
    const refreshCallIndex = actionBody.indexOf('refreshContentPageCoordinatorStateFromRuntime()', gateIndex)
    const retryTimeoutIndex = actionBody.indexOf('setTimeout(() => void maybeRunAutoProfileAction()', gateIndex)

    assert.notEqual(gateIndex, -1)
    assert.notEqual(refreshCallIndex, -1)
    assert.notEqual(retryTimeoutIndex, -1)
    assert.ok(gateIndex < refreshCallIndex)
    assert.ok(refreshCallIndex < retryTimeoutIndex)
})

test('content script detects Cloudflare challenge pages and reports them once per load', () => {
    // Regression for the 2026-09-12 incident: several profiles (Ray-Savage-52
    // among them) looked "stuck" for 30-90s with the content script never
    // engaging. The actual cause was a Cloudflare bot-challenge interstitial
    // (confirmed via a __cf_chl_tk= query param in the progress record's
    // lastUrl), not an extension bug -- the extension correctly cannot act
    // on a page that isn't the real profile page yet. This checks the
    // detection is wired up: a URL-param-based check (fires even before the
    // challenge page's DOM/title renders), reported once per content-script
    // lifetime, hooked into the same retry loop that was stuck during the
    // incident.
    //
    // 2026-09-25: a second live incident (Emily-22838) showed Cloudflare
    // issuing __cf_chl_rt_tk instead of __cf_chl_tk, which the old
    // exact-key check missed entirely -- the detector now matches the
    // shared __cf_chl prefix so it isn't tied to one exact variant.
    const source = readRepoFile('shared/js/content.js')

    const detectBody = extractFunction(source, 'function isCloudflareChallengePage()')
    assert.match(detectBody, /__cf_chl/)
    assert.match(detectBody, /startsWith/)
    assert.doesNotMatch(detectBody, /\.has\('__cf_chl_tk'\)/)

    const reportBody = extractFunction(source, 'function maybeReportCloudflareChallenge()')
    assert.match(reportBody, /cloudflareChallengeReported/)
    assert.match(reportBody, /isCloudflareChallengePage\(\)/)
    assert.match(reportBody, /action:\s*'cloudflare-challenge-detected'/)

    const actionBody = extractFunction(source, 'async function maybeRunAutoProfileAction()')
    assert.match(actionBody, /maybeReportCloudflareChallenge\(\)/)
})

test('service worker records a cloudflareChallenge.detected stat and throttles for reported Cloudflare challenges', () => {
    const source = readRepoFile('shared/js/swBootstrap.js')
    const handlerIndex = source.indexOf("request.action === 'cloudflare-challenge-detected'")
    assert.notEqual(handlerIndex, -1)
    const nextBranchIndex = source.indexOf('else if(request.action', handlerIndex + 1)
    const handlerBody = source.slice(handlerIndex, nextBranchIndex === -1 ? handlerIndex + 2400 : nextBranchIndex)
    assert.match(handlerBody, /incrementQueueWakeupMetric\('cloudflareChallenge\.detected'\)/)
    assert.match(handlerBody, /rememberQueueLoadPressure\('cloudflare-challenge'/)
})

test('profile block click path does not await nonterminal progress breadcrumbs', () => {
    const body = extractFunction(
        readRepoFile('shared/js/content.js'),
        'async function blockProfileOnce(options = {})'
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
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const releaseBranchStart = bootstrap.indexOf("request.action === 'release-job-tab'")
    const closeBranchStart = bootstrap.indexOf("request.action === 'close-tab'")
    const recordBranchStart = bootstrap.indexOf("request.action === 'record-job-milestone'")
    const releaseAndCloseBranches = bootstrap.slice(releaseBranchStart, recordBranchStart)

    assert.match(releaseBody, /safeSendRuntimeMessageWithTimeout/)
    assert.match(releaseBody, /QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS/)
    assert.doesNotMatch(releaseBody, /await safeSendRuntimeMessage\(/)
    assert.match(closeBody, /safeSendRuntimeMessageWithTimeout/)
    assert.match(closeBody, /QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS/)
    assert.doesNotMatch(closeBody, /await safeSendRuntimeMessage\(/)
    assert.notEqual(releaseBranchStart, -1)
    assert.notEqual(closeBranchStart, -1)
    assert.match(releaseAndCloseBranches, /closeQueuedTabAfterTerminal\(tabId, 'content-close-request', \{awaitFill: true\}\)/)
})

test('active queued already-blocked reconcile releases and closes the tab', () => {
    const body = extractFunction(
        readRepoFile('shared/js/content.js'),
        'async function maybeRecordAlreadyBlockedCoordinatorProfile()'
    )
    const nudgeBody = extractFunction(
        readRepoFile('shared/js/content.js'),
        'function nudgeCurrentProfilePendingClaim()'
    )
    const repairIndex = body.indexOf("event: 'Visible profile was already blocked; reconciling coordinator row'")
    const activeIndex = body.indexOf('isActiveQueuedProgressRecord(href)')
    const guardIndex = body.indexOf('Already-blocked reconcile was not recorded; leaving queued tab open for retry')
    const retryIndex = body.indexOf('setTimeout(() => void maybeRecordAlreadyBlockedCoordinatorProfile(), 2000)', guardIndex)
    const releaseIndex = body.indexOf('await notifyQueuedTabComplete()', activeIndex)
    const closeIndex = body.indexOf('await requestCloseTab()', activeIndex)

    assert.notEqual(repairIndex, -1)
    assert.notEqual(activeIndex, -1)
    assert.notEqual(guardIndex, -1)
    assert.notEqual(releaseIndex, -1)
    assert.notEqual(closeIndex, -1)
    assert.ok(repairIndex < guardIndex)
    assert.ok(guardIndex < retryIndex)
    assert.ok(retryIndex < activeIndex)
    assert.ok(activeIndex < releaseIndex)
    assert.ok(releaseIndex < closeIndex)
    assert.match(body, /const progress = await recordAlreadyBlockedCoordinatorProgress\(href, item, progressPatch\)/)
    assert.match(readRepoFile('shared/js/content.js'), /action: 'record-job-terminal'/)
    assert.match(body, /if\(progress\?\.serviceWorkerOnly && !progress\.runtimeRecorded\)/)
    assert.match(body, /alreadyBlockedCoordinatorReconcileKey = ''/)
    assert.match(nudgeBody, /maybeRecordAlreadyBlockedCoordinatorProfile\(\)/)
})

test('live queued tab adoption requires durable active transition before cleanup', () => {
    const source = readRepoFile('shared/js/sw.js')
    const adoptBody = extractFunction(source, 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID, options = {})')
    const terminalizeBody = extractFunction(source, 'async function terminalizeAlreadyBlockedQueuedTab(tabId, reason = \'already-blocked-queued-tab\')')
    const activeSetIndex = adoptBody.indexOf('queueRuntime.addActiveQueuedTab(tabId)')
    const transitionIndex = adoptBody.indexOf('const activeTransitioned = await promiseWithTimeout')
    const failedIndex = adoptBody.indexOf("activeTransitionPendingReason: 'resume-live-active-tab-transition-failed'")
    const terminalizeIndex = adoptBody.indexOf("terminalizeAlreadyBlockedQueuedTab(tabId, 'resume-live-active-tab-already-blocked')")
    const nudgeIndex = adoptBody.indexOf("nudgeQueuedTabActionClaimWithRetries(tabId, 'resume-live-active-tab')")
    const pendingNudgeIndex = adoptBody.indexOf("nudgeQueuedTabActionClaimWithRetries(tabId, 'resume-live-active-tab-transition-pending')")

    assert.notEqual(activeSetIndex, -1)
    assert.notEqual(transitionIndex, -1)
    assert.notEqual(failedIndex, -1)
    assert.notEqual(terminalizeIndex, -1)
    assert.notEqual(nudgeIndex, -1)
    assert.notEqual(pendingNudgeIndex, -1)
    assert.ok(activeSetIndex < transitionIndex)
    assert.ok(transitionIndex < failedIndex)
    assert.ok(failedIndex < terminalizeIndex)
    assert.ok(terminalizeIndex < nudgeIndex)
    assert.match(adoptBody, /if\(!activeTransitioned\)/)
    assert.match(adoptBody, /ensureQueuedTabContentScript\(tabId, 'resume-live-active-tab-transition-pending'\)/)
    assert.match(adoptBody, /return true/)
    assert.match(terminalizeBody, /action: 'close-if-blocked'/)
    assert.match(terminalizeBody, /applyCoordinatorQueueMachineEvent\(\{[\s\S]*type: 'BLOCKED_SWEEP_TERMINAL_RECORD'/)
    assert.match(terminalizeBody, /if\(!recorded\?\.terminal\) return false/)
    assert.match(terminalizeBody, /await closeQueuedTabAfterTerminal\(normalizedTabId, reason, \{awaitFill: true\}\)/)
    assert.match(extractFunction(source, 'async function closeQueuedTabAfterTerminal(tabId, reason, options = {})'), /await browser\.tabs\.remove\(normalizedTabId\)[\s\S]*releaseQueuedTabAndCleanup\(normalizedTabId, \{awaitFill: options\.awaitFill === true\}\)/)
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
    const swBody = extractFunction(readRepoFile('shared/js/sw.js'), 'async function adoptLiveCoordinatorQueuedTab(item = null, itemKey = \'\', tab = null, ownerTabId = SERVICE_WORKER_QUEUE_OWNER_ID, options = {})')
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

test('terminal row slot release is sampled at the release, from the terminal record', () => {
    // Owner, 17 Oct: the terminal phase sample runs before the release, and a closing tab never writes slotReleasedAt, so the
    // terminal-to-slot-released sample has to come from the release itself.
    const sw = readRepoFile('shared/js/sw.js')
    const releaseBody = extractFunction(sw, 'async function releaseQueuedTab(tabId, options = {})')
    const sampleIndex = releaseBody.indexOf("recordQueueWakeupPhase('terminalToSlotRelease'")
    const slotWriteIndex = releaseBody.indexOf('slotReleasedAt: Date.now()')

    assert.notEqual(sampleIndex, -1)
    assert.notEqual(slotWriteIndex, -1)
    assert.ok(sampleIndex < slotWriteIndex)
    assert.match(releaseBody.slice(sampleIndex - 400, sampleIndex), /isTerminalProfileNukeRecord\(progressRecord\)/)
    assert.match(releaseBody.slice(sampleIndex - 400, sampleIndex), /progressRecord\.terminalAt > 0/)
})

test('every storage write is labelled, sized and recorded once (owner 18 Oct)', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const writeBody = extractFunction(sw, 'async function metricStorageSet(payload = {}, options = {})')
    const eventIndex = writeBody.indexOf("kind: 'storage-write'")

    assert.notEqual(eventIndex, -1)
    assert.match(writeBody.slice(eventIndex, eventIndex + 400), /label: pathName/)
    // bytes is what reached disk (the logical payload when nothing was translated); logicalBytes is the payload before translation.
    assert.match(writeBody.slice(eventIndex, eventIndex + 400), /bytes: payloadSummary\?\.bytes \|\| 0/)
    assert.match(writeBody.slice(eventIndex, eventIndex + 400), /logicalBytes: payloadSummary\?\.bytes/)
    assert.match(writeBody, /storagePayload\.write\.unlabelled/)
    // The coordinator door labels a stored write from its progress metric path or its operation kind, never the phase fallback.
    const coordinatorSource = sw
    assert.match(coordinatorSource, /coordinatorStored\.\$\{options\.operationKind \|\| 'unlabelled'\}/)
    const metricsSource = readRepoFile('shared/js/swStorageMetrics.js')
    assert.match(metricsSource, /function recordStoragePayloadMetrics\(payload = \{\}, pathName = ''\) \{[\s\S]*?return \{bytes: totalBytes, rows: totalRows, keys: keyNames\}/)
})

test('archive writes record their outcome, so a skip carries its reason (owner 18 Oct)', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const archiveBody = extractFunction(sw, 'async function archiveTerminalCoordinatorRow(rowKey = \'\', terminalRow = null, options = {})')
    for (const outcome of ['skipped', 'failed', 'saved']) {
        assert.match(archiveBody, new RegExp(`recordTerminalWriteOutcome\\('archiveTerminalCoordinatorRow', rowKey, '${outcome}'`))
    }
    assert.match(sw, /kind: 'terminal-write-outcome'/)
})

test('a removed tab runs the fill at once, and a busy window skips the whole-browser scans before them (owner 18 Oct)', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    assert.match(bootstrap, /\n        requestQueuedTabRemovalRefill\(\)\n/)
    assert.match(sw, /function requestQueuedTabRemovalRefill\(\) \{[\s\S]*?void fillQueuedTabs\(\{reason: QUEUED_TAB_REMOVED_REFILL_REASON\}\)/)

    const fillBody = extractFunction(sw, 'async function fillQueuedTabsOnce(options = {})')
    const busyIndex = fillBody.indexOf('const surfaceOccupiedBeforeScans')
    const scanIndex = fillBody.indexOf('const finalOpenDecision = await validateQueuedTabOpenAgainstCurrentAuthority')
    assert.notEqual(busyIndex, -1)
    assert.notEqual(scanIndex, -1)
    assert.ok(busyIndex < scanIndex)
    assert.match(fillBody.slice(busyIndex, scanIndex), /isQueuedWorkerActionSurfaceOccupiedForOpen\(next\)/)
    // One whole-browser scan per pass: each cache is reused only while no tab has been opened or removed.
    assert.match(fillBody, /passProfileTabsGeneration !== tabsChangedGeneration/)
    assert.match(fillBody, /passAllTabsGeneration !== tabsChangedGeneration/)
})

test('non-authority writes leave the lane, skipped rows carry an outcome, and every state write is labelled (owner 18 Oct)', () => {
    const sw = readRepoFile('shared/js/sw.js')
    // The tab id is written only when it changes, and the caller is not held on the write.
    assert.match(sw, /if\(coordinatorTabIdSavedToStorage === normalizedTabId\) return/)
    // The diagnostic flush is coalesced inside its interval, unless the pending list is nearly full.
    assert.match(sw, /incrementQueueWakeupMetric\('diagnosticEvent\.flushCoalesced'\)/)
    // Every authority-mutation entry carries the outcome, status and error of the row written.
    assert.match(sw, /outcome: result\.nextRow\?\.outcome \|\| record\.outcome/)
    assert.match(sw, /outcome: record\.value\?\.outcome \|\| record\.outcome/)
    // Every caller of the state writer names its write, so none falls back to reason.ordinaryMutation.
    const writerCalls = sw.split('saveCoordinatorState(').length - 2
    const labelled = (sw.match(/saveCoordinatorState\([^)]*metricPath|metricPath: '(?:authority|reconcile|activeTransition|retry|requeue|enqueue|storedWorkClear|queuedProfileTargetResolve|queuedProfileResolutionUnresolved|progress)\./g) || []).length
    assert.ok(writerCalls > 0)
    assert.ok(labelled > 0)
})

test('owned-tab map is written only when its serialized value changes (owner 18 Oct)', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const body = extractFunction(sw, 'async function persistOwnedTabIdsByParent()')
    // The skip compares the serialized JSON with the last value saved, and runs before the write.
    const compareIndex = body.indexOf('if(serializedJson === ownedTabIdsByParentSavedJson)')
    const writeIndex = body.indexOf('metricStorageSet({[OWNED_TAB_STATE_KEY]: serialized}')
    assert.notEqual(compareIndex, -1)
    assert.ok(writeIndex > compareIndex)
    // The saved value is recorded only after the write succeeds, so a failed write is retried on the next call.
    assert.match(body, /if\(saved !== false\) ownedTabIdsByParentSavedJson = serializedJson/)
    // The cache is declared before the function that reads it, so it is never in its temporal dead zone.
    assert.ok(sw.indexOf('let ownedTabIdsByParentSavedJson') < sw.indexOf('async function persistOwnedTabIdsByParent'))
    assert.equal(sw.split('let ownedTabIdsByParentSavedJson').length - 1, 1)
    // Nothing else writes the owned-tab key, so the cached value cannot go stale behind the skip. (The load path reads it.)
    assert.equal((sw.match(/\bset\(\{\[OWNED_TAB_STATE_KEY\]|Set\(\{\[OWNED_TAB_STATE_KEY\]/g) || []).length, 1)
})

test('a removal refill that lands on an in-flight fill pass runs one more pass when it ends (601f 3a)', () => {
    const sw = readRepoFile('shared/js/sw.js')
    // The removal reason has one constant, shared by the refill request and the coalescing check in fillQueuedTabs.
    assert.match(sw, /const QUEUED_TAB_REMOVED_REFILL_REASON = 'queued-tab-removed-refill'/)
    assert.match(sw, /void fillQueuedTabs\(\{reason: QUEUED_TAB_REMOVED_REFILL_REASON\}\)/)
    // The in-flight branch marks the rerun for a removal only, and counts it.
    assert.match(sw, /if\(options\.reason === QUEUED_TAB_REMOVED_REFILL_REASON\) \{\s*queuedTabRemovalRerunRequested = true\s*incrementQueueWakeupMetric\('pump\.queuedTabRemovalRefill\.coalescedIntoRerun'\)/)
    // The owning pass runs the rerun once when it ends, and not while a pause is in effect.
    assert.match(sw, /const ownsPromise = queuedTabFillPromise === trackedPromise/)
    assert.match(sw, /if\(ownsPromise && queuedTabRemovalRerunRequested\) \{\s*queuedTabRemovalRerunRequested = false\s*if\(!isCoordinatorPauseRequestedLocally\(\) && quoraRuntimeActivated\)/)
    // The flag is a boolean, so a removal during a rerun asks for one more pass and does not stack passes.
    assert.match(sw, /let queuedTabRemovalRerunRequested = false/)
})

test('pause-effective is recorded by the first paused fill pass, not by the request (601f 4a)', () => {
    const sw = readRepoFile('shared/js/sw.js')
    const pauseBody = extractFunction(sw, 'async function pauseCoordinatorNukes()')
    assert.doesNotMatch(pauseBody, /kind: 'pause-effective'/)
    assert.match(pauseBody, /pauseRequestedAtMs = Date\.now\(\)/)
    assert.match(sw, /function recordPauseEffectiveOnFirstPausedFillPass\(\)/)
    assert.match(sw, /if\(pausedGateResult\) \{\s*recordPauseEffectiveOnFirstPausedFillPass\(\)/)
    // The gate reads the in-memory request as well as the stored flag, so a pass during a pause request stops at once.
    assert.match(sw, /\[COORDINATOR_PAUSED_KEY\]: pausedState\?\.\[COORDINATOR_PAUSED_KEY\] === true \|\| coordinatorPauseRequested === true/)
})

test('queued retry progress clears stale terminal attempt fields', () => {
    // normalizeProgressPatch moved to swProfileProgressMerge.js in
    // decomposition Slice 30.
    const swSource = readRepoFile('shared/js/swProfileProgressMerge.js')
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
    const helperIndex = body.indexOf('const closeQueuedBlockedTab = async (patch = {}) => {')
    const sweepIndex = body.indexOf('const swept = await sweepServiceWorkerBlockedProfileTabs()', helperIndex)
    const progressIndex = body.indexOf('const progress = await recordQueuedProfileProgress', helperIndex)
    const directBlockIndex = body.indexOf('Queued Mute Block skipped mute and started block directly')
    const blockCallIndex = body.indexOf('blockedDirectly = await blockProfile({silent: true, allowForegroundFallback})', directBlockIndex)
    const closeIndex = body.indexOf('await closeQueuedBlockedTab()', blockCallIndex)
    // The probe after the direct block reads the record first (Oct 31); a label alone no longer decides a block.
    const secondProbeIndex = body.indexOf('if(isProfileBlockedConfirmed())', closeIndex)

    assert.notEqual(helperIndex, -1)
    assert.notEqual(sweepIndex, -1)
    assert.notEqual(progressIndex, -1)
    assert.ok(helperIndex < sweepIndex)
    assert.ok(sweepIndex < progressIndex)
    assert.match(body.slice(sweepIndex, progressIndex), /if\(swept\.signaled\) \{[\s\S]*return true/)
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

test('block flow skips already-followed profiles before attempting anything else', () => {
    // 2026-09-25: a real live incident (Franklin Veaux, a genuine
    // contributor to a space the user follows) got queued for mute-block
    // because the space-feed "asset page" candidate collector's
    // shared-poster branch treats any embedded-thread poster as a
    // high-confidence candidate the same way it treats an actual
    // scam-target profile link -- it has no concept of "this person is
    // themselves contributing content" versus "this profile is being
    // called out within someone else's post" for anyone beyond the single
    // primary post author. Rather than trying to make that collector
    // perfectly precise (a maintained followers list isn't practical to
    // get out of Quora either), blockProfile checks the profile's own
    // Follow/Following button at the moment of action, before doing
    // anything else -- a candidate the user already follows is almost
    // certainly a miscategorization, regardless of how it got queued.
    const source = readRepoFile('shared/js/content.js')
    const blockBody = extractFunction(source, 'async function blockProfileOnce(options = {})')
    const detectBody = extractFunction(source, 'function isProfileFollowedByCurrentUser()')

    const followedCheckIndex = blockBody.indexOf('isProfileFollowedByCurrentUser()')
    const alreadyBlockedCheckIndex = blockBody.indexOf('const alreadyBlockedOnEntry = isProfileBlockedConfirmed()')
    assert.notEqual(followedCheckIndex, -1)
    assert.notEqual(alreadyBlockedCheckIndex, -1)
    assert.ok(followedCheckIndex < alreadyBlockedCheckIndex, 'following check runs before anything else in the block flow')

    assert.match(blockBody, /status:\s*'block-attempt-on-following'/)
    assert.match(blockBody, /blockAttempted:\s*false/)
    assert.match(blockBody, /blockSucceeded:\s*false/)

    assert.match(detectBody, /getProfilePrimaryAction\(\)/)
    assert.match(detectBody, /\^following\$/)

    const jobState = readRepoFile('shared/js/jobState.js')
    const mapBody = extractFunction(jobState, 'function mapProgressToJobState(record = null)')
    assert.match(mapBody, /status === 'block-attempt-on-following'/)
    assert.match(mapBody, /outcome:\s*'block-attempt-on-following'/)
    assert.match(mapBody, /status:\s*'skipped'/)

    const reducer = readRepoFile('shared/js/swCoordinatorProgressReducer.js')
    assert.match(reducer, /outcome === 'block-attempt-on-following' \? 'blockAttemptOnFollowing'/)

    const dashboard = readRepoFile('shared/js/coordinator.js')
    assert.match(dashboard, /profileAction\.blockAttemptOnFollowing\.count/)
    assert.match(dashboard, /setText\('blockAttemptOnFollowingCount'/)

    const html = readRepoFile('shared/coordinator.html')
    assert.match(html, /id="blockAttemptOnFollowingCount"/)
})

test('profile block flow can resume from an open confirmation dialog', () => {
    const source = readRepoFile('shared/js/content.js')
    const blockBody = extractFunction(source, 'async function blockProfileOnce(options = {})')
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
    const body = extractFunction(source, 'async function ensureProfileMenuOpen(timeoutMs = ENSURE_PROFILE_MENU_OPEN_DEFAULT_TIMEOUT_MS, silent = false, allowForegroundFallback = false)')

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
    const blockBody = extractFunction(source, 'async function blockProfileOnce(options = {})')
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
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')

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
    assert.match(foregroundBody, /activeQueuedActionSurfaceMode === 'worker-window'/)
    assert.match(foregroundBody, /confirmationWorkerWindowActionSurface: true/)
    assert.match(foregroundBody, /confirmationWorkerWindowTimeoutRecovered: timedOut/)
    assert.match(foregroundBody, /\/timeout\/i\.test\(responseReason\)/)
    assert.match(foregroundBody, /reason: 'worker-window-action-surface'/)
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
    assert.match(bootstrap, /request\.action === 'activate-confirmation-in-page-world'/)
    assert.match(mutePendingBody, /getMuteConfirmAction\(\)/)
    assert.match(unmutePendingBody, /getUnmuteConfirmAction\(\)/)
    assert.match(blockPendingBody, /getBlockConfirmAction\(\)/)
    const mismatchBody = extractFunction(source, "function getConfirmationKindMismatchReason(element, confirmationKind = '')")
    assert.match(mismatchBody, /inverse-unblock-confirmation/)
    assert.match(mismatchBody, /not-block-confirmation/)
    assert.match(mismatchBody, /inverse-unmute-confirmation/)
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
    assert.ok(stopBody.indexOf('if(!await canContinueStop())') < stopBody.indexOf('queueRuntime.pauseQueuedOwner(ownerTabId)'))
})

test('legacy profile progress writes are deleted from service-worker progress paths', () => {
    const source = readRepoFile('shared/js/sw.js')
    const contentSource = readRepoFile('shared/js/content.js')
    const initBody = extractFunction(contentSource, 'async function init()')
    const loadBody = extractFunction(source, 'async function loadProfileNukeProgress()')
    const metadataMilestoneBody = extractFunction(source, 'async function recordQueuedTabMetadataMilestone(tabId, metadata = null, patch = {})')
    const foregroundWaitBody = extractFunction(source, 'async function noteQueuedForegroundWait(tabId, metadata = null, reason = \'\')')
    const promoteBody = extractFunction(source, 'async function promoteQueuedTab(tabId, reason = \'\', options = {})')
    const closingBody = extractFunction(source, 'function markQueuedTabClosing(tabId, reason = \'\')')
    const releaseBody = extractFunction(source, 'async function releaseQueuedTab(tabId, options = {})')
    const sweepBody = extractFunction(source, 'async function sweepStaleQueuedTabs(parentTabId = null, options = {})')
    assert.doesNotMatch(source, /browser\.storage\.local\.set\(\{\[PROFILE_NUKE_PROGRESS_KEY\]/)
    assert.doesNotMatch(initBody, /safeStorageSet\(\{\[PROFILE_NUKE_PROGRESS_KEY\]/)
    assert.doesNotMatch(initBody, /normalize-profile-nuke-progress/)
    assert.doesNotMatch(source, /request\.action === 'normalize-profile-nuke-progress'/)
    assert.doesNotMatch(source, /async function persistProfileNukeProgress/)
    assert.doesNotMatch(source, /async function recordProfileNukeProgress\(profileHref/)
    assert.doesNotMatch(source, /async function recordProfileNukeProgressBatch\(updates/)
    assert.doesNotMatch(contentSource, /recordProfileNukeProgressBatch/)
    const localProgressUpdatesBody = extractFunction(contentSource, 'function applyLocalProfileNukeProgressUpdates(updates)')
    assert.doesNotMatch(localProgressUpdatesBody, /safeStorageSet|browser\.storage|runtime\.sendMessage|sendMessage|recordProfileNukeProgress/)
    assert.doesNotMatch(source, /async function recordProfileNukeProgressFromRequest/)
    assert.doesNotMatch(source, /async function recordProfileNukeProgressBatchFromRequest/)
    assert.match(metadataMilestoneBody, /recordDeferredCoordinatorJobMilestone\(profileHref, progressPatch/)
    assert.match(metadataMilestoneBody, /missing-attempt-identity/)
    assert.match(foregroundWaitBody, /recordQueuedTabMetadataMilestone/)
    assert.match(promoteBody, /recordQueuedTabMetadataMilestone/)
    assert.match(closingBody, /recordQueuedTabMetadataMilestone/)
    assert.match(releaseBody, /recordQueuedTabMetadataMilestone/)
    assert.match(sweepBody, /recordCoordinatorJobProgressViaQueueMachine\(metadata\.profileHref, staleProgressPatch,[\s\S]*expectTerminal: true/)
    assert.doesNotMatch(foregroundWaitBody, /recordProfileNukeProgress/)
    assert.doesNotMatch(promoteBody, /recordProfileNukeProgress/)
    assert.doesNotMatch(closingBody, /recordProfileNukeProgress/)
    assert.doesNotMatch(releaseBody, /recordProfileNukeProgress/)
    assert.doesNotMatch(sweepBody, /recordProfileNukeProgress/)
    assert.doesNotMatch(source, /scheduleProfileNukeProgressCompatibilityFlush/)
    assert.doesNotMatch(source, /PROFILE_NUKE_PROGRESS_COMPATIBILITY_FLUSH_MS/)
    assert.doesNotMatch(source, /request\.action === 'record-nuke-progress'/)
    assert.doesNotMatch(source, /request\.action === 'record-nuke-progress-batch'/)
    assert.doesNotMatch(source, /PROFILE_NUKE_PROGRESS_KEY/)
    // D3: the retired-keys declaration is the one allowed mention (see the upgrade cleanup in sw.js).
    assert.doesNotMatch(source.replace(/const VERSION_15_RETIRED_STORAGE_KEYS = \[[^\]]*\]/, ''), /['"]mbProfileNukeProgress['"]/)
    assert.doesNotMatch(source, /legacy-progress-message-disabled/)
    assert.doesNotMatch(source, /legacyMessageDisabled/)
    assert.doesNotMatch(source, /async function normalizeProfileNukeProgressStorage/)
    assert.doesNotMatch(source, /payload\[PROFILE_NUKE_PROGRESS_KEY\] = pruneProfileNukeProgress/)
    assert.doesNotMatch(source, /progress\.storageWrites|progress\.flushPerformed/)
    assert.match(loadBody, /readResidentCoordinatorStored\(\{[\s\S]*\[PROFILE_NUKE_PROGRESS_VIEW_KEY\]: null,[\s\S]*getAllProfileNukeProgressShardDefaults\(\)[\s\S]*\}/)
    assert.doesNotMatch(loadBody, /metricStorageGet\(/)
    assert.match(loadBody, /getProfileNukeProgressRecordsFromProjection\(stored\)/)
    assert.doesNotMatch(loadBody, /PROFILE_NUKE_PROGRESS_KEY|normalizeStoredProfileNukeProgress/)
    assert.doesNotMatch(loadBody, /saveCoordinatorState\(/)
    assert.doesNotMatch(loadBody, /enqueueStoredCoordinatorQueueProgressSync/)
})

test('terminal settlement separates authority stamping from derived materialization', () => {
    const source = readRepoFile('shared/js/sw.js')
    const settlementBody = extractFunction(source, 'async function settleTerminalCoordinatorItemsLocked(options = {})')

    // Terminal settlement stages every qualifying row's mutation in memory
    // and persists them all in one batched WAL write
    // (persistCoordinatorAuthorityQueueWalBatchMutation) instead of one
    // applyWithinStorageUpdate round-trip per row -- the latter measured as
    // a multi-second-per-row cost on a large batch during live testing
    // (2026-09-09), since each row was its own separate storage read/write
    // cycle. There's no dedicated per-row authority-apply function anymore;
    // the mutation and its guard checks are inline in the loop below.
    assert.doesNotMatch(source, /async function applyTerminalCoordinatorAuthoritySettlementLocked/)
    assert.match(settlementBody, /const settlementResults = \[\]/)
    // The settlement writes a change (the staged results), not a copy of the whole queue. The copy is gone (see
    // the change-only door in persistCoordinator).
    assert.doesNotMatch(settlementBody, /const nextQueueForSettlement = \{\.\.\.queue\}/)
    assert.match(settlementBody, /makeCoordinatorAuthorityApplyResult\(\{[\s\S]*operationKind: 'terminal-settlement',[\s\S]*rowKey: itemKey/)
    assert.match(settlementBody, /coordinatorAuthority\.persistCoordinator\(\s*\{results: settlementResults\}/)
    assert.match(settlementBody, /normalizeStoredProfileNukeProgress\(progressProjectionRecords\)/)
    // The progress base is the resident stored copy (P2), not a storage read with projection defaults.
    assert.match(settlementBody, /coordinatorAuthority\.residentStored\(\)/)
    assert.doesNotMatch(settlementBody, /metricStorageGet\(|getProfileNukeProgressProjectionDefaults\(/)
    assert.match(settlementBody, /getProfileNukeProgressRecordsFromProjection\(stored, requestedHrefs\)/)
    assert.doesNotMatch(settlementBody, /PROFILE_NUKE_PROGRESS_KEY|getProfileNukeProgressRecordsFromStorage/)
    assert.match(settlementBody, /saveProfileNukeProgressRowProjection\([\s\S]*progressRecords/)
})

test('space-feed enqueue does not create progress before durable enqueue', () => {
    const body = extractFunction(readRepoFile('shared/js/content.js'), 'async function nukeSpaceFeedEntries(button, entries)')
    const enqueueIndex = body.indexOf('sendBatch: (work, onProgress) => enqueueCoordinatorSpaceFeedItems(space, runId, work, preFilter, onProgress)')
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

test('phase10 live validation accepts 100 and 300 target gates', () => {
    const source = readRepoFile('tools/cdp/upgrade-regression/run.js')
    const fixtureBody = extractFunction(source, 'function loadQuoraReportingAssetFixture()')
    const selectorBody = extractFunction(source, 'function selectQuoraReportingAssetTargets(options = {}, existingQueueTargets = [], targetCount = 10)')
    const batchEnqueueBody = extractFunction(source, 'async function enqueueQuoraReportingAssetTargetsViaRuntime(context, options, targetProfileHrefs = [], concurrency = 1, assetSelection = {})')
    const smokeBody = extractFunction(source, 'async function runSmallBatchQueueAuthoritySmoke(config, options, context, warnings, fail)')

    assert.match(source, /options\.phase10TargetCount = Math\.max\(1, Math\.min\(Number\.parseInt\(options\.phase10TargetCount, 10\) \|\| 10, 300\)\)/)
    assert.doesNotMatch(source, /phase10TargetCount[\s\S]{0,120}, 12\)/)
    assert.match(source, /--phase10-target-selection-timeout-ms/)
    assert.match(source, /options\.phase10TargetSelectionTimeoutMs = Math\.max\(30000, Math\.min\(Number\.parseInt\(options\.phase10TargetSelectionTimeoutMs, 10\) \|\| PHASE10_TARGET_SELECTION_TIMEOUT_MS, 900000\)\)/)
    assert.match(source, /QUORA_REPORTING_ASSETS_PATH/)
    assert.match(source, /https:\/\/trollsgalore\.quora\.com\//)
    assert.match(source, /'tmp', 'quora-reporting-assets\.json'/)
    assert.match(fixtureBody, /record\?\.kind/)
    assert.match(fixtureBody, /normalizeProfileSearchTargetHref\(record\.profileUrl/)
    assert.match(fixtureBody, /snippet\.matchAll\(/)
    assert.match(fixtureBody, /https\?:\\\/\\\/\[\^\\s"'<>\]\+/)
    assert.match(fixtureBody, /evidenceProfileUrls/)
    assert.match(fixtureBody, /missing-explicit-target-profile-url-evidence/)
    assert.match(fixtureBody, /rejectedCandidateCount/)
    assert.match(fixtureBody, /rejectedRecords/)
    assert.match(selectorBody, /loadQuoraReportingAssetFixture\(\)/)
    assert.match(selectorBody, /excluded\.has\(comparable\)/)
    assert.match(selectorBody, /source: 'quora-reporting-assets'/)
    assert.match(selectorBody, /evidenceProfileUrls: record\.evidenceProfileUrls/)
    assert.match(selectorBody, /rejectedCandidateCount: fixture\.rejectedCandidateCount/)
    assert.match(selectorBody, /rejectedRecords: fixture\.rejectedRecords/)
    assert.match(smokeBody, /classifySpacesForDiscovery\(context, dedupeStrings\(/)
    assert.match(smokeBody, /selectQuoraReportingAssetTargets\(/)
    assert.doesNotMatch(smokeBody, /selectProfileSearchTargetsWithFallback\(/)
    assert.match(batchEnqueueBody, /const makeTargetProvenance = href =>/)
    assert.match(batchEnqueueBody, /sourceSpaceUrl: selected\.sourceSpaceUrl/)
    assert.match(batchEnqueueBody, /collectionIndex: Number\.parseInt\(selected\.collectionIndex, 10\)/)
    assert.match(batchEnqueueBody, /provenance: makeTargetProvenance\(href\)/)
    assert.match(batchEnqueueBody, /items: hrefs\.map\(href => \(\{/)
    assert.match(batchEnqueueBody, /enqueued: queued \+ merged >= hrefs\.length/)
    assert.match(batchEnqueueBody, /sourceType: 'space-asset'/)
    assert.match(smokeBody, /phaseState\.currentStep = 'enqueue-batch'/)
    assert.match(smokeBody, /enqueueQuoraReportingAssetTargetsViaRuntime\(context, options, selectedTargets, concurrency, targetSelection\)/)
    assert.match(smokeBody, /else for\(const href of selectedTargets\)/)
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
    const repairDeniedIndex = alreadyBlockedBody.indexOf('Already-blocked reconcile was not recorded; leaving queued tab open for retry')
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
    const createOwnedTabBody = extractFunction(source, 'async function createOwnedTab(action = {}, attempt = {})')
    const restoreFocusBody = extractFunction(source, 'async function restoreBackgroundQueuedTabFocus(tab = null, previousActiveTab = null, action = {})')
    const durableIndex = releaseBody.indexOf('await Promise.all(durableWrites')
    const terminalIndex = releaseBody.indexOf('if(progressRecord && isTerminalProfileNukeRecord(progressRecord)')
    const terminalScheduleIndex = releaseBody.indexOf('scheduleReleaseContinuation()', terminalIndex)
    const rollbackIndex = releaseBody.indexOf('durableWrites.push(rollbackFailedQueuedTabOpen')
    const finalScheduleIndex = releaseBody.indexOf('scheduleReleaseContinuation()', durableIndex)
    const pausedGateIndex = fillBody.indexOf('const pausedGateResult = decidePausedStateGate({')
    const createIndex = fillBody.indexOf('createOwnedTab(next, createAttempt)')
    const boundedCreateIndex = fillBody.indexOf("'queued owned tab create'")
    const openFailureIndex = fillBody.indexOf('openFailureCount')

    assert.notEqual(durableIndex, -1)
    assert.notEqual(terminalIndex, -1)
    assert.notEqual(terminalScheduleIndex, -1)
    assert.notEqual(rollbackIndex, -1)
    assert.notEqual(finalScheduleIndex, -1)
    assert.ok(terminalIndex < terminalScheduleIndex)
    assert.ok(terminalScheduleIndex < rollbackIndex)
    assert.ok(rollbackIndex < durableIndex)
    assert.ok(durableIndex < finalScheduleIndex)
    assert.match(releaseReconcileBody, /scheduleCoordinatorQueueResume/)
    assert.match(releaseBody, /const leaseRelease = releaseCoordinatorActionLeaseForTab\(tabId, releaseReason\)/)
    assert.match(releaseBody, /void leaseRelease\.catch\(\(\) => null\)/)
    assert.match(releaseBody, /durableWrites\.push\(leaseRelease\)/)
    assert.match(releaseBody, /durableWrites\.push\(rollbackFailedQueuedTabOpen/)
    assert.notEqual(pausedGateIndex, -1)
    assert.notEqual(createIndex, -1)
    assert.notEqual(boundedCreateIndex, -1)
    assert.notEqual(openFailureIndex, -1)
    assert.ok(pausedGateIndex < createIndex)
    assert.ok(createIndex < boundedCreateIndex)
    assert.ok(createIndex < openFailureIndex)
    assert.match(fillBody, /const getCapacityUsed = \(\) => Math\.max\([\s\S]*queueRuntime\.getActiveQueuedTabCount\(\),[\s\S]*getSchedulerBlockingQueuedExecutorCount\(\)[\s\S]*\) \+[\s\S]*getQueuedProfileOpenReservationCount\(\) \+[\s\S]*openedTabs/)
    // The queue-load-throttle gate check was extracted to decideQueueLoadThrottleGate
    // in decomposition Slice P2-2 (Part 2 decide/act splitting), called from fillBody
    // rather than inlined there, then moved to swFillQueuedTabsOnceDecisions.js in
    // decomposition Slice P2.5-4.
    const throttleGateBody = extractFunction(readRepoFile('shared/js/swFillQueuedTabsOnceDecisions.js'), 'function decideQueueLoadThrottleGate(params = {})')
    assert.match(throttleGateBody, /throttle\.active && queueRuntime\.getActivationIntentCount\(\) && getSchedulerBlockingQueuedExecutorCount\(\) >= 1/)
    assert.match(fillBody, /decideQueueLoadThrottleGate\(\{throttle, cycle, now: Date\.now\(\)\}\)/)
    // The pausedState gate check was extracted to decidePausedStateGate in
    // decomposition Slice P2-3 (Part 2 decide/act splitting), called from
    // fillBody rather than inlined there, then moved to
    // swFillQueuedTabsOnceDecisions.js in decomposition Slice P2.5-4.
    const pausedGateBody = extractFunction(readRepoFile('shared/js/swFillQueuedTabsOnceDecisions.js'), 'function decidePausedStateGate(params = {})')
    assert.match(pausedGateBody, /pausedState\?\.\[COORDINATOR_PAUSED_KEY\] !== true/)
    assert.match(fillBody, /const pausedGateResult = decidePausedStateGate\(\{/)
    // The activation-guard-claim and profile-open-reservation-claim guard
    // pairs inside the fill loop were extracted to decideActivationGuardClaim
    // and decideProfileOpenReservationClaim in the same slice, then moved to
    // swFillQueuedTabsOnceDecisions.js in decomposition Slice P2.5-4.
    const activationGuardClaimBody = extractFunction(readRepoFile('shared/js/swFillQueuedTabsOnceDecisions.js'), 'function decideActivationGuardClaim(params = {})')
    const profileOpenReservationClaimBody = extractFunction(readRepoFile('shared/js/swFillQueuedTabsOnceDecisions.js'), 'function decideProfileOpenReservationClaim(params = {})')
    assert.match(activationGuardClaimBody, /claimQueuedActivationGuard\(next, null, 'queued-tab-pre-open'\)/)
    assert.match(profileOpenReservationClaimBody, /reserveQueuedProfileOpen\(next, 'queued-tab-create'\)/)
    assert.match(fillBody, /decideActivationGuardClaim\(\{next\}\)/)
    assert.match(fillBody, /decideProfileOpenReservationClaim\(\{next, openingActionKey\}\)/)
    // 2026-09-27: re-checks coordinatorPauseRequested on every iteration,
    // not just once before the loop starts -- with concurrency raised
    // above 1 this loop can open several tabs per call, and a pause
    // requested mid-loop (coordinatorPauseRequested flips synchronously,
    // well before the durable write) used to have no way to stop it
    // before the loop ran out of capacity or activation intents on its
    // own. Live evidence: rows still going active seconds after Pause.
    // review-2 S5-1 adds the fill's own cancel token to the same condition: a timed-out fill claims nothing more.
    assert.match(fillBody, /while\(!coordinatorPauseRequested && options\.cancelToken\?\.cancelled !== true && getCapacityUsed\(\) < getEffectiveQueuedTabOpenConcurrency\(\) && queueRuntime\.getActivationIntentCount\(\)\)/)
    // The post-open-failure recovery decision (after the `postOpenRecovery`
    // await inside the tab-create catch's genuine-failure branch, including
    // the loop's last remaining inline `queueRuntime.requeueActivationIntent`
    // call) was extracted to decidePostOpenFailureRecoveryOutcome in
    // decomposition Slice P2-7 (Part 2 decide/act splitting), called from
    // fillBody rather than inlined there, then moved to
    // swFillQueuedTabsOnceDecisions.js in decomposition Slice P2.5-4.
    const postOpenFailureRecoveryBody = extractFunction(readRepoFile('shared/js/swFillQueuedTabsOnceDecisions.js'), 'function decidePostOpenFailureRecoveryOutcome(params = {})')
    assert.match(postOpenFailureRecoveryBody, /queueRuntime\.requeueActivationIntent/)
    assert.match(postOpenFailureRecoveryBody, /scheduleQueuedWorkContinuation\('queued-tab-open-failed'\)/)
    assert.match(fillBody, /decidePostOpenFailureRecoveryOutcome\(\{/)
    assert.match(createOwnedTabBody, /getLastFocusedActiveTab\(\)/)
    assert.match(createOwnedTabBody, /restoreBackgroundQueuedTabFocus\(tab, previousActiveTab, action\)/)
    assert.match(restoreFocusBody, /action\?\.noForegroundFallback !== true/)
    assert.match(restoreFocusBody, /browser\.tabs\.update\(previousActiveTab\.id, \{active: true\}\)/)
})

test('stored-work recovery is queue-authority-only and uses alarm-backed earliest scheduling', () => {
    const source = readRepoFile('shared/js/sw.js')
    const browserSessionRuntime = readRepoFile('shared/js/swBrowserSessionRuntime.js')
    const scheduleBody = extractFunction(source, 'function scheduleCoordinatorReconcile(delayMs = COORDINATOR_RECONCILE_INTERVAL_MS, options = {})')
    const recoverBody = extractFunction(source, 'async function recoverStoredCoordinatorWorkOnce(reason = \'stored-work-recovery\', options = {})')
    const restoreBody = extractFunction(source, 'async function restoreCoordinatorPageForStoredWorkOnce(options = {})')
    const clearBody = extractFunction(browserSessionRuntime, 'function clearSchedulerAlarms(reason = \'clear-scheduler-alarms\')')
    const bookkeeping = readRepoFile('shared/js/swSchedulerAlarmBookkeeping.js')
    const suppressBody = extractFunction(bookkeeping, 'function suppressStaleCoordinatorReconcileAlarm(dueAt = 0)')
    const alarmNameBody = extractFunction(bookkeeping, 'function isCoordinatorReconcileAlarmName(name = \'\')')
    const noWorkIndex = recoverBody.indexOf("reason: 'no-stored-work'")

    assert.match(source, /const COORDINATOR_RECONCILE_ALARM_NAME = 'mb-coordinator-reconcile'/)
    assert.doesNotMatch(source, /COORDINATOR_LEGACY_RECONCILE_ALARM_NAME/)
    assert.doesNotMatch(source, /mb-stored-work-repair/)
    assert.match(scheduleBody, /coordinatorReconcileScheduler\.shouldCoalesce\(dueAt\)/)
    assert.match(scheduleBody, /coordinatorReconcileScheduler\.schedule\(scheduledDueAt/)
    assert.doesNotMatch(scheduleBody, /COORDINATOR_LEGACY_RECONCILE_ALARM_NAME/)
    assert.match(scheduleBody, /browser\.alarms\.create\(COORDINATOR_RECONCILE_ALARM_NAME/)
    assert.match(clearBody, /browser\.alarms\.clear\(COORDINATOR_RECONCILE_ALARM_NAME\)/)
    assert.doesNotMatch(clearBody, /COORDINATOR_LEGACY_RECONCILE_ALARM_NAME/)
    assert.match(suppressBody, /clearCoordinatorReconcileAlarms\(\)/)
    assert.match(alarmNameBody, /name === COORDINATOR_RECONCILE_ALARM_NAME/)
    assert.doesNotMatch(alarmNameBody, /COORDINATOR_LEGACY_RECONCILE_ALARM_NAME/)
    assert.notEqual(noWorkIndex, -1)
    assert.doesNotMatch(recoverBody, /\brepair\b/)
    assert.doesNotMatch(recoverBody, /reconcileCoordinatorStorageBestEffort/)
    assert.doesNotMatch(restoreBody, /if\(!hasStoredCoordinatorWork\(queue\)\)/)
    assert.match(restoreBody, /recoverStoredCoordinatorWork\('coordinator-page-restore'/)
})

// Entropy-reduction Phase 6 (see entropy-reduction-action-plan-2026-09-09.md):
// isExplicitSecurityVerificationRecord used to be independently declared in
// both jobState.js and swProfileNukeRecordClassification.js with an
// identical body (a Phase 2 tripwire briefly guarded that duplication
// before this fix). It's now a single implementation in jobState.js,
// threaded into swProfileNukeRecordClassification.js's factory via
// `deps.handlers` (aliased to isExplicitSecurityVerificationRecordFromJobState
// on import in sw.js, since that module's own re-export of the same name
// already occupies it in sw.js's scope) and re-exported unchanged from
// there. This asserts the duplication doesn't come back: the function body
// should exist in jobState.js only, and swProfileNukeRecordClassification.js
// should source it from deps.handlers instead.
test('isExplicitSecurityVerificationRecord has a single implementation, sourced from jobState.js', () => {
    const jobStateSource = readRepoFile('shared/js/jobState.js')
    const classificationSource = readRepoFile('shared/js/swProfileNukeRecordClassification.js')
    const swSource = readRepoFile('shared/js/sw.js')

    assert.match(jobStateSource, /function isExplicitSecurityVerificationRecord\(record = null\)/)
    assert.doesNotMatch(classificationSource, /function isExplicitSecurityVerificationRecord\(/)
    assert.match(classificationSource, /const\s*\{[\s\S]*?isExplicitSecurityVerificationRecord[\s\S]*?\}\s*=\s*deps\.handlers/)

    const jobStateDestructureStart = swSource.lastIndexOf('const {', swSource.indexOf('require(\'./jobState\')'))
    const jobStateDestructure = swSource.slice(jobStateDestructureStart, swSource.indexOf('require(\'./jobState\')'))
    assert.match(jobStateDestructure, /isExplicitSecurityVerificationRecord:\s*isExplicitSecurityVerificationRecordFromJobState/)

    const classificationCallBody = extractCallExpression(swSource, swSource.indexOf('createProfileNukeRecordClassification({'))
    assert.match(classificationCallBody, /isExplicitSecurityVerificationRecord:\s*isExplicitSecurityVerificationRecordFromJobState/)
})

// Entropy-reduction Phase 6 item 2 (see entropy-reduction-action-plan-2026-09-09.md):
// coordinator.js used to carry its own copies of the terminal/active/pending/
// retryable-failure status predicates, independently drifted from
// swCoordinatorStatusRules.js's canonical versions (its terminal-status array
// included a dead 'complete' value the canonical TERMINAL_JOB_STATUSES set
// never had). Fixed by having coordinator.js's own isTerminalQueueStatus/
// isActiveQueueItem/isPendingQueueStatus/isRetryableFailedQueueItem delegate
// to createCoordinatorStatusRules (the same factory sw.js uses) instead of
// re-declaring the status arrays.
test('coordinator status predicates delegate to swCoordinatorStatusRules instead of re-declaring status arrays', () => {
    const coordinatorSource = readRepoFile('shared/js/coordinator.js')

    assert.match(coordinatorSource, /require\('\.\/swCoordinatorStatusRules'\)/)
    assert.match(coordinatorSource, /createCoordinatorStatusRules\(/)

    const isTerminalQueueStatusBody = extractFunction(coordinatorSource, "function isTerminalQueueStatus(status = '')")
    const isActiveQueueItemBody = extractFunction(coordinatorSource, 'function isActiveQueueItem(item = {})')
    const isPendingQueueStatusBody = extractFunction(coordinatorSource, "function isPendingQueueStatus(status = '')")
    const isRetryableFailedQueueItemBody = extractFunction(coordinatorSource, 'function isRetryableFailedQueueItem(item = null)')

    assert.match(isTerminalQueueStatusBody, /return isTerminalCoordinatorStatus\(status\)/)
    assert.match(isActiveQueueItemBody, /return isActiveCoordinatorStatus\(item\?\.status\)/)
    assert.match(isPendingQueueStatusBody, /return isPendingCoordinatorStatus\(status\)/)
    assert.match(isRetryableFailedQueueItemBody, /return isRetryableCoordinatorFailure\(item\)/)

    assert.doesNotMatch(coordinatorSource, /'succeeded',\s*'failed',\s*'skipped',\s*'canceled',\s*'complete'/)
})

// Entropy-reduction Phase 4, Option B (see entropy-reduction-action-plan-
// 2026-09-09.md, "retried and landed via a sync/async split"): the 10
// `load*Projection` functions in sw.js used to each re-declare a
// byte-identical "hydrate WAL store, then recover queue from it" recipe.
// An earlier attempt extracted the WHOLE recipe (including the `await`)
// into one async helper and broke two fake-timer tests by adding a
// microtask tick; the fix that actually preserved timing extracts only the
// purely-synchronous "walStore -> queue" half as a plain function, leaving
// each site's own `await loadCoordinatorQueueWalStoreFromStorage(...)`
// inline. This tripwire asserts that shape stays in place: the helper
// exists and is not itself `async`/promise-returning, and each site calls
// it rather than re-declaring `recoverCoordinatorQueueFromWal(...).queue`
// inline.
test('queue-projection loaders answer from the resident state and never replay the WAL (P2, P3)', () => {
    const source = readRepoFile('shared/js/sw.js')

    // The plain WAL-to-queue helper is gone. Hydrate is the only decode of the WAL (P3).
    assert.doesNotMatch(source, /function recoverQueueFromWalStore/)
    assert.doesNotMatch(source, /async function recoverQueueFromWalStore/)

    const loaderNames = [
        'loadCoordinatorQueueProjection',
        'loadCoordinatorQueueRunsProjection',
        'loadCoordinatorQueueRunsProgressProjection',
        'loadCoordinatorQueueRunsScopedProgressProjection',
        'loadCoordinatorQueueRunsEventsProjection',
        'loadCoordinatorQueueRunsEventsProgressProjection',
        'loadCoordinatorReconcileProjection'
    ]
    for(const name of loaderNames) {
        const body = extractFunction(source, `async function ${name}(options = {})`)
        assert.match(body, /await awaitResidentCoordinatorState\(\)/, `${name} should read the resident state after the gate`)
        assert.doesNotMatch(body, /recoverCoordinatorQueueFromWal\(|loadCoordinatorQueueWalProjection\(|metricStorageGet\(/, `${name} should not replay the WAL or read storage`)
    }

    const hydrateBody = extractFunction(source, 'async function loadCoordinatorCurrentAuthorityState()')
    assert.match(hydrateBody, /loadCoordinatorQueueWalProjection\(/)
    assert.match(hydrateBody, /recoverCoordinatorQueueFromWal\(/)
})

// Queue processing order (2026-09-11/12, see entropy-reduction-action-plan-
// 2026-09-09.md "queue processing order"): a plain JS object never reorders
// an existing key on reassignment, so a chronically-failing coordinator
// queue item stayed at whatever position it first landed at, indefinitely,
// and could starve fresher work sitting behind it -- confirmed live as the
// cause of a bulk-campaign item repeatedly reopening tabs while hundreds of
// untouched items never got a turn. Fixed with a second index: each item
// carries an explicit `queueSequence` (jobState.js's
// getNextCoordinatorQueueSequence), assigned fresh on enqueue and on every
// retry-to-queued transition, and swqueueRuntime.js maintains an in-memory
// list of queue keys sorted by that sequence, rebuilt whenever the resident
// authority state refreshes. This tripwire asserts the mechanism stays
// wired: the sequence helper exists and is monotonic, the reducer threads
// it through on retry/enqueue, the ordered-index functions exist in
// swqueueRuntime.js, and the two priority-sensitive executor scans consume
// it instead of raw `Object.entries(queue)` insertion order.
test('coordinator queue processing order comes from an explicit queueSequence index, not incidental object insertion order', () => {
    const jobStateSource = readRepoFile('shared/js/jobState.js')
    const swSource = readRepoFile('shared/js/sw.js')
    const queueRuntimeSource = readRepoFile('shared/js/swqueueRuntime.js')
    const progressReducerSource = readRepoFile('shared/js/swCoordinatorProgressReducer.js')

    const nextSequenceBody = extractFunction(jobStateSource, 'function getNextCoordinatorQueueSequence(queue = {})')
    assert.match(nextSequenceBody, /return max \+ 1/)
    assert.match(jobStateSource, /getNextCoordinatorQueueSequence,/)

    const reduceEventBody = extractFunction(jobStateSource, 'function reduceJobEvent(item = {}, event = {})')
    assert.match(reduceEventBody, /queueSequence: Number\.parseInt\(event\.queueSequence, 10\) \|\| item\.queueSequence \|\| 0/)

    assert.match(swSource, /getNextCoordinatorQueueSequence,\s*\n\s*getQueueItemExecutorTabAction,/)

    const rebuildBody = extractFunction(queueRuntimeSource, 'function rebuildQueueOrder(queue = {})')
    assert.match(rebuildBody, /leftSequence - rightSequence/)
    assert.match(queueRuntimeSource, /function getOrderedQueueKeys\(\)/)
    assert.match(queueRuntimeSource, /function getOrderedQueueItems\(queue = \{\}\)/)

    const orderSyncBody = extractFunction(swSource, 'function syncResidentQueueOrder(previousQueue = {})')
    assert.match(orderSyncBody, /queueRuntime\.rebuildQueueOrder\(/)
    // 2026-09-26: rebuildQueueOrder's full O(n log n) sort now only runs the
    // first time (index not yet seeded) -- every later change diffs against
    // the previously-resident queue with the O(1)-per-key incremental
    // primitives instead, avoiding a full sort on every queue mutation. The
    // refresh path is gone, so hydrate, seed, and the door's writes call this helper.
    assert.match(orderSyncBody, /queueRuntime\.getOrderedQueueKeyCount\(\) > 0/)
    assert.match(orderSyncBody, /queueRuntime\.syncOrderedQueueKeysFromQueueDiff\(previousQueue, nextQueue\)/)
    assert.ok((swSource.match(/syncResidentQueueOrder\(/g) || []).length >= 6, 'hydrate, seed, and each door write sync the order index')
    const syncDiffBody = extractFunction(queueRuntimeSource, 'function syncOrderedQueueKeysFromQueueDiff(previousQueue = {}, nextQueue = {})')
    assert.match(syncDiffBody, /noteOrderedQueueKeyAbsent\(key\)/)
    assert.match(syncDiffBody, /noteOrderedQueueKeyPresent\(key\)/)

    const classifyBody = extractFunction(swSource, 'async function classifyCoordinatorExecutorState(options = {})')
    assert.match(classifyBody, /for\(const \[itemKey, item\] of queueRuntime\.getOrderedQueueItems\(queue\)\)/)
    assert.doesNotMatch(classifyBody, /for\(const \[itemKey, item\] of Object\.entries\(queue\)\)/)

    const applyPhaseBody = extractFunction(swSource, 'async function runCoordinatorExecutorApplyPhase(reason = \'coordinator-executor-apply\', options = {})')
    assert.match(applyPhaseBody, /for\(const \[itemKey, item\] of queueRuntime\.getOrderedQueueItems\(queue\)\)/)

    const retryAdvanceBody = extractFunction(swSource, 'async function mutateCoordinatorStaleRetryQueuedTabAdvance(operation = {})')
    assert.match(retryAdvanceBody, /const nextQueueSequence = getNextCoordinatorQueueSequence\(queue\)/)
    assert.match(retryAdvanceBody, /queueSequence: nextQueueSequence/)

    const progressRetryBody = extractFunction(progressReducerSource, 'function transitionCoordinatorItemFromProgress(item = {}, record = {}, mapped = {}, options = {})')
    assert.match(progressRetryBody, /queueSequence: Number\.parseInt\(options\.queueSequence, 10\) \|\|/)
})

// Entropy-reduction Phase 6 (see entropy-reduction-action-plan-2026-09-09.md,
// "Make Phase 5 enforceable, not just readable"): a generic, mechanical
// tripwire for Pattern 6 (duplicated constants across files) that doesn't
// need to know about any specific constant in advance, unlike the two
// hand-written tripwires above (isExplicitSecurityVerificationRecord,
// and the earlier transient-status/action-kind fixes). Scans for
// SCREAMING_SNAKE_CASE `const NAME = 'literal string'` declarations --
// this codebase's established naming convention for action-kind/status/
// reason-type domain constants -- across the three files most central to
// the client/service-worker boundary this session's bugs were about, and
// fails if the same literal value is independently declared this way in
// more than one of them. A constant correctly shared via
// `const {NAME} = require(...)` destructuring, as content.js now does for
// UNBLOCK_UNMUTE_ACTION_KIND, isn't a `const NAME = 'literal'` assignment
// at all, so it doesn't trip this check -- only a *second independent*
// literal declaration would. Deliberately narrow (single-line simple
// string literals only, three files only) to keep false positives near
// zero; broadening scope is easy later if it proves valuable.
// Entropy-reduction Pattern 8 (see entropy-reduction-action-plan-2026-09-09.md
// and ../../memory feedback-symbolic-timeout-registry): content.js's,
// coordinator.js's, and sw.js's wait-loop-family functions used to invent
// their own bare numeric `timeoutMs`/`intervalMs` default parameter values,
// with no shared vocabulary for what a given wait represents. Migrated to
// named constants in shared/js/timeouts.js. This is a generic, mechanical
// tripwire (same shape as the duplicate-constant scan below) rather than a
// hand-written list, so it also catches any *new* wait-loop function added
// later with a bare literal default instead of a timeouts.js constant.
test('wait-loop functions in content.js/coordinator.js/sw.js use named timeouts.js constants, not bare numeric defaults', () => {
    const bareLiteralDefaultPattern = /\b(?:timeoutMs|intervalMs)\s*=\s*[0-9]+\b/

    for(const relativePath of ['shared/js/content.js', 'shared/js/coordinator.js', 'shared/js/sw.js']) {
        const source = readRepoFile(relativePath)
        const match = source.match(bareLiteralDefaultPattern)
        assert.equal(match, null, `${relativePath} has a bare numeric timeoutMs/intervalMs default (${match?.[0]}); add a named constant to shared/js/timeouts.js instead`)
    }

    const timeoutsSource = readRepoFile('shared/js/timeouts.js')
    for(const name of [
        'WAIT_FOR_ACTION_DEFAULT_TIMEOUT_MS',
        'WAIT_FOR_CONDITION_DEFAULT_TIMEOUT_MS',
        'WAIT_FOR_CONDITION_OR_DOM_MUTATION_DEFAULT_TIMEOUT_MS',
        'WAIT_FOR_MENU_STATE_DEFAULT_TIMEOUT_MS',
        'READ_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS',
        'WAIT_FOR_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS',
        'ENSURE_PROFILE_MENU_OPEN_DEFAULT_TIMEOUT_MS',
        'WAIT_FOR_VERIFIED_PROFILE_UNBLOCKED_DEFAULT_TIMEOUT_MS',
        'WAIT_FOR_VERIFIED_PROFILE_BLOCKED_DEFAULT_TIMEOUT_MS',
        'WAIT_FOR_PROFILE_ACTION_READY_DEFAULT_TIMEOUT_MS',
        'WAIT_FOR_CANONICAL_PROFILE_ACTION_ROUTE_DEFAULT_TIMEOUT_MS',
        'WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_TIMEOUT_MS',
        'CLOSE_PROFILE_MENU_DEFAULT_TIMEOUT_MS',
        'SAFE_SEND_RUNTIME_MESSAGE_DEFAULT_TIMEOUT_MS',
        'COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS',
        'COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS',
        'WAIT_FOR_USER_START_DURABLE_ACTIVATION_DEFAULT_TIMEOUT_MS'
    ]) {
        assert.match(timeoutsSource, new RegExp(`${name}:\\s*[0-9]+`))
    }
})

test('no SCREAMING_SNAKE_CASE string constant is independently declared as a literal in more than one of content.js/sw.js/jobState.js', () => {
    // Pre-existing duplicates this check found the first time it ran
    // (2026-09-10) -- real instances of Pattern 6, not newly introduced by
    // this test. Fixing them properly needs a shared module both
    // content.js and sw.js already import from (neither currently owns
    // these values the way jobState.js already did for the two constants
    // fixed earlier this session), which is a small design decision, not
    // a one-line import swap -- left as a documented follow-up in
    // entropy-reduction-action-plan-2026-09-09.md rather than guessed at
    // here. Allowlisted by value so this test still catches any *new*
    // duplicate going forward. The two storage-key values that were
    // allowlisted here (mbSpacePendingNukedPosts, mbProfileNukeProgressView)
    // moved to shared/js/storageKeys.js on 2026-10-14 (historical/14-oct-review-1.md
    // finding 8), so they are no longer duplicated and no longer allowlisted.
    const knownPreexistingDuplicateValues = new Set([
        'service-worker-queue-owner',
        'author-profile'
    ])

    const files = ['shared/js/content.js', 'shared/js/sw.js', 'shared/js/jobState.js']
    const declarationPattern = /^const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^'\\]*)'\s*$/gm
    const locationsByValue = new Map()

    for(const file of files) {
        const source = readRepoFile(file)
        for(const match of source.matchAll(declarationPattern)) {
            const [, name, value] = match
            if(!value) continue
            const lineNumber = source.slice(0, match.index).split('\n').length
            const locations = locationsByValue.get(value) || []
            locations.push(`${file}:${lineNumber} (${name})`)
            locationsByValue.set(value, locations)
        }
    }

    const duplicated = Array.from(locationsByValue.entries())
        .filter(([value, locations]) => !knownPreexistingDuplicateValues.has(value) &&
            new Set(locations.map(location => location.split(':')[0])).size > 1)
        .map(([value, locations]) => `'${value}' declared independently at: ${locations.join(', ')}`)

    assert.deepEqual(duplicated, [])
})

// historical/14-oct-review-1.md finding 8 (Pattern 6, duplicated constants): these storage key names and limits were each declared with a
// literal in two or three shared/js modules, and nothing checked that the copies agreed. Each is now declared once: keys in
// shared/js/storageKeys.js, limits in shared/js/tunables.js. Every other module imports the name. This test fails if one of these
// names is declared again (const/let/var NAME =) in another shared/js module, and checks that each value is still the literal it
// had in the source before the move. A destructured import (const {NAME} = require(...)) is not a declaration and does not trip it.
test('storage key names and tunable limits are declared once, in storageKeys.js or tunables.js', () => {
    // The values these names had in the source before the move.
    const expectedKeyValues = {
        COORDINATOR_QUEUE_VIEW_KEY: 'mbCoordinatorQueueView',
        COORDINATOR_PAUSED_KEY: 'mbCoordinatorPaused',
        COORDINATOR_RETRY_FAILED_ENABLED_KEY: 'mbCoordinatorRetryFailedEnabled',
        COORDINATOR_RUNS_KEY: 'mbCoordinatorRuns',
        COORDINATOR_EVENTS_KEY: 'mbCoordinatorEvents',
        COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY: 'mbCoordinatorLastEnqueueSummary',
        HIDDEN_RUNS_KEY: 'mbCoordinatorHiddenRunIds',
        QUEUE_WAKEUP_METRICS_VIEW_KEY: 'mbQueueWakeupMetricsView',
        PROFILE_NUKE_PROGRESS_VIEW_KEY: 'mbProfileNukeProgressView',
        PROFILE_NUKE_PROGRESS_SHARD_PREFIX: 'mbProfileNukeProgressShard.',
        SPACE_REGISTRY_KEY: 'mbSpaceRegistry',
        DEV_MODE_SYNC_STORAGE_KEY: 'mbDashboardDevModeEnabled'
    }
    const expectedLimitValues = {
        MAX_PROFILE_NUKE_PROGRESS_ENTRIES: 1000,
        STALE_QUEUED_TAB_MAX_RETRIES: 1,
        EXHAUSTED_ROLLBACK_RECOVERY_LIMIT: 3,
        QUEUE_LOAD_THROTTLE_MAX_MS: 120000
    }
    // Local names these values were declared under before the move. Retired, so none may come back as a declaration.
    const retiredLocalNames = [
        'LAST_ENQUEUE_SUMMARY_KEY',
        'DEFAULT_QUEUED_TAB_MAX_RETRIES',
        'QUEUE_LOAD_PRESSURE_RECOVERY_WINDOW_MS',
        'COORDINATOR_EXHAUSTED_ROLLBACK_RECOVERY_LIMIT'
    ]
    const consolidatedNames = [...Object.keys(expectedKeyValues), ...Object.keys(expectedLimitValues)]
    const declarationPattern = new RegExp(`\\b(?:const|let|var)\\s+(${[...consolidatedNames, ...retiredLocalNames].join('|')})\\s*=`)
    const owningModules = new Set(['shared/js/storageKeys.js', 'shared/js/tunables.js'])
    const sharedJsDir = path.join(__dirname, '..', 'shared/js')
    const redeclared = []
    for(const fileName of fs.readdirSync(sharedJsDir).filter(name => name.endsWith('.js')).sort()) {
        const relativePath = `shared/js/${fileName}`
        if(owningModules.has(relativePath)) continue
        readRepoFile(relativePath).split('\n').forEach((line, index) => {
            if(/^\s*(?:\/\/|\*)/.test(line)) return
            const match = line.match(declarationPattern)
            if(match) redeclared.push(`${relativePath}:${index + 1} (${match[1]})`)
        })
    }
    assert.deepEqual(redeclared, [])

    const storageKeys = require(path.join(__dirname, '..', 'shared/js/storageKeys'))
    const tunables = require(path.join(__dirname, '..', 'shared/js/tunables'))
    for(const [name, value] of Object.entries(expectedKeyValues)) {
        assert.equal(storageKeys[name], value, `storageKeys.${name}`)
    }
    for(const [name, value] of Object.entries(expectedLimitValues)) {
        assert.equal(tunables[name], value, `tunables.${name}`)
    }
})

test('dashboard run badge relabels a fully-terminal run as done, not the raw empty status', () => {
    // Live bug (2026-10-01): the server's run status collapses "never had
    // any items" and "every item finished" into the same 'empty' value by
    // design (getCoordinatorRunStatus, swCoordinatorRuns.js -- "Clear
    // Completed" relies on that single value to find everything it should
    // hide). Showing that raw label on a run whose items all succeeded
    // reads as if the run lost its work, not that it finished. This only
    // needs fixing in the displayed badge text, not the status value
    // itself, so getRunStatusLabel is a thin client-side-only remap.
    const source = readRepoFile('shared/js/coordinator.js')
    const labelBody = extractFunction(source, 'function getRunStatusLabel(run = {})')

    assert.match(labelBody, /status !== 'empty'\) return status/)
    assert.match(labelBody, /itemCount.*> 0 \? 'done' : 'empty'/)
    assert.match(source, /buildBadge\(getRunStatusLabel\(run\)\)/)
})

test('the orphan-tab sweep reads the live progress, not the copy the authority took at startup (20 Oct review)', () => {
    const source = readRepoFile('shared/js/sw.js')
    const sweepBody = extractFunction(source, 'async function sweepProfileTabsWithoutActiveQueueAuthority(options = {})')
    assert.match(sweepBody, /const currentProgress = getLiveResidentProfileNukeProgressRecords\(currentAuthorityState\?\.progress \|\| \{\}\)/)
    assert.doesNotMatch(sweepBody, /const currentProgress = currentAuthorityState\?\.progress \|\| \{\}/)
})

test('Clear All Stats zeroes Terminal, empties the events display, and never removes stored history (owner rule, 27 Oct)', () => {
    const source = readRepoFile('shared/js/coordinator.js')
    const clearAllStatsBody = extractFunction(source, 'async function clearAllStats()')

    assert.match(clearAllStatsBody, /await resetMetrics\(\)/)
    assert.match(clearAllStatsBody, /await clearCoordinatorTerminalStats\(\)/)
    // A failed events clear must not stop the refresh, or the display keeps the cleared rows.
    assert.match(clearAllStatsBody, /await clearEvents\(\)\.catch\(/)
    assert.match(clearAllStatsBody, /await loadState\(\)\s*\n\s*render\(\)/)
    assert.doesNotMatch(clearAllStatsBody, /remove\(|storage\.local\.set|clearOutliers\(\)/)

    const sw = readRepoFile('shared/js/sw.js')
    const clearTerminalStatsBody = extractFunction(sw, 'async function clearCoordinatorTerminalStats()')
    assert.match(clearTerminalStatsBody, /COORDINATOR_STATS_CLEARED_AT_KEY\]: clearedAt/)
    // Clear All Stats removes no storage key and no completed shard: it only stamps the cutoff (owner rule, 27 Oct).
    assert.doesNotMatch(clearTerminalStatsBody, /metricStorageRemove|\.remove\(|[Ss]hard/)
    // Updates the resident copy synchronously -- every buildCoordinatorQueueView
    // call site (hot-path broadcasts included, not just the dashboard's own
    // on-demand refresh) reads this same variable, so the cutoff applies
    // consistently everywhere.
    assert.match(clearTerminalStatsBody, /coordinatorStatsClearedAtResident = clearedAt/)
    // The ratchet cache remembers the highest terminal counts seen this
    // epoch (so a hot-path rebuild using an unmerged queue snapshot doesn't
    // make Terminal visibly dip) -- without resetting it here, it would
    // re-inflate Terminal right back to its last-seen high-water mark on
    // the very next broadcast, undoing this zeroing.
    assert.match(clearTerminalStatsBody, /coordinatorQueueViewTimingCache = null/)

    const queueViewSource = readRepoFile('shared/js/swCoordinatorQueueView.js')
    const filterBody = extractFunction(queueViewSource, 'function filterCoordinatorQueueForCompactView(queue = {}, runs = {}, statsClearedAt = 0)')
    assert.match(filterBody, /terminalAt <= clearedAt/)
})

// Rule 2 of docs/queue-storage-layering.md section 6: the dashboard asks the worker to write the queue events and
// the retry-failed flag, and does not write those keys itself.
test('dashboard clear-events and retry-failed controls send worker messages instead of writing storage', () => {
    const source = readRepoFile('shared/js/coordinator.js')
    assert.doesNotMatch(source, /storage\.local\.set\(\{\[COORDINATOR_EVENTS_KEY\]/)
    assert.doesNotMatch(source, /storage\.local\.set\(\{\[COORDINATOR_RETRY_FAILED_ENABLED_KEY\]/)
    assert.match(source, /action: 'clear-coordinator-events'/)
    assert.match(source, /action: 'set-coordinator-retry-failed-enabled'/)
})

test('a queue bar request on a cold worker waits for the authority, and the bar summary is held in memory only (decision 2, 18 Oct)', () => {
    const bootstrap = readRepoFile('shared/js/swBootstrap.js')
    const bar = readRepoFile('shared/js/swQueueBarSummary.js')
    // The get action is in the authority-gated set, so a cold request is answered after startup.
    assert.match(bootstrap, /RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY = new Set\(\[\s*(?:\/\/[^\n]*\n\s*)?QUEUE_BAR_GET_ACTION,/)
    // The cold path builds the first view and records its summary. A failed build answers null.
    assert.match(bootstrap, /refreshCoordinatorQueueViewForDashboard\('queue-bar-first-build'\)/)
    assert.match(bootstrap, /\.catch\(\(\) => \(\{summary: null\}\)\)/)
    // Nothing in the bar module touches storage: the summary is held in memory only.
    assert.doesNotMatch(bar, /storage\.(local|session)|setAccessLevel/)
})

test('a run\'s source page comes from the run record only; the event log is not read for it (decision 26, 18 Oct)', () => {
    const provenance = readRepoFile('shared/js/swCoordinatorSourceProvenance.js')
    const sw = readRepoFile('shared/js/sw.js')
    const body = extractFunction(provenance, 'function makeCoordinatorSourceFromRunMetadata(runId = \'\', run = {})')
    assert.match(body, /run\.sourcePages\.find\(Boolean\)/)
    assert.doesNotMatch(body, /events/)
    assert.doesNotMatch(provenance, /getCoordinatorRunSourcePageFromEvents/)
    assert.doesNotMatch(sw, /getCoordinatorRunSourcePageFromEvents/)
    assert.match(sw, /makeCoordinatorSourceFromRunMetadata\(item\.runId \|\| '', ctx\.runs\[item\.runId\] \|\| \{\}\)/)
})

test('a blocked worker tab is removed before its release waits for the next fill (20 Oct stall)', () => {
    const source = readRepoFile('shared/js/sw.js')
    const sweepBody = extractFunction(source, 'async function sweepOwnedBlockedProfileTabs(parentTabId)')
    const closeBody = extractFunction(source, 'async function closeQueuedTabAfterTerminal(tabId, reason, options = {})')
    assert.match(sweepBody, /await closeQueuedTabAfterTerminal\(tabId, 'background-blocked-sweep', \{awaitFill: true\}\)/)
    assert.ok(closeBody.indexOf('await browser.tabs.remove(normalizedTabId)') !== -1)
    assert.ok(closeBody.indexOf('await browser.tabs.remove(normalizedTabId)') < closeBody.indexOf('releaseQueuedTabAndCleanup(normalizedTabId'))
})

test('history filter matches every typed word in any visible field, case-insensitively, in any order', () => {
    const evaluate = loadDashboardHarness()
    const row = {
        targetProfileHref: 'https://www.quora.com/profile/Jane-Doe',
        status: 'failed',
        outcome: 'already-blocked',
        origin: 'manual',
        error: 'Tab closed before the block finished'
    }
    const matches = text => evaluate(`historyRowMatchesFilter(${JSON.stringify(row)}, ${JSON.stringify(text)})`)

    assert.equal(matches(''), true, 'an empty filter shows everything')
    assert.equal(matches('   '), true, 'a blank filter shows everything')
    assert.equal(matches('jane failed'), true)
    assert.equal(matches('failed jane'), true, 'the words may come in any order')
    assert.equal(matches('JANE DOE'), true, 'matching is case-insensitive')
    assert.equal(matches('already blocked'), true, 'the outcome matches with its dashes as spaces')
    assert.equal(matches('tab closed'), true, 'a word in the error text matches')
    assert.equal(matches('manual'), true, 'the source matches')
    assert.equal(matches('jane zebra'), false, 'a word that appears nowhere rejects the row')
    assert.equal(matches('zebra'), false)

    const source = readRepoFile('shared/js/coordinator.js')
    const filterBody = extractFunction(source, 'function historyRowMatchesFilter(row = {}, text = \'\')')
    assert.doesNotMatch(filterBody, /document\./, 'the matching rule is pure')
})

test('history row shows the space and post a completed row was collected from', () => {
    const evaluate = loadDashboardHarness()
    // A completed space row: the space key and the post live on the row itself (as the worker returns them).
    const spaceRow = {
        source: {spaceKey: 'quora-space:https://spamdetectives.quora.com', pageUrl: 'https://spamdetectives.quora.com/?__filter__=all'},
        provenance: null,
        evidence: [{postUrl: 'https://spamdetectives.quora.com/Some-post-slug'}],
        targetProfileHref: 'https://www.quora.com/profile/Jane-Doe'
    }
    assert.equal(evaluate(`historyRowSpaceLabel(${JSON.stringify(spaceRow)})`), 'spamdetectives.quora.com', 'the label is the space host')
    assert.equal(evaluate(`historyRowSpaceUrl(${JSON.stringify(spaceRow)})`), 'https://spamdetectives.quora.com')
    assert.equal(evaluate(`historyRowPostUrl(${JSON.stringify(spaceRow)})`), 'https://spamdetectives.quora.com/Some-post-slug')
    assert.equal(evaluate(`historyRowMatchesFilter(${JSON.stringify(spaceRow)}, 'spamdetectives')`), true, 'the space is searchable')

    const withProvenance = {...spaceRow, provenance: {sourceSpaceUrl: 'https://example-space.quora.com/', sourceSpaceTitle: 'Example Space'}}
    assert.equal(evaluate(`historyRowSpaceLabel(${JSON.stringify(withProvenance)})`), 'Example Space', 'a provenance title wins')
    assert.equal(evaluate(`historyRowSpaceUrl(${JSON.stringify(withProvenance)})`), 'https://example-space.quora.com/', 'a provenance address wins')

    const searchRow = {source: {pageUrl: 'https://www.quora.com/search?q=x'}, evidence: [], targetProfileHref: 'https://www.quora.com/profile/Jane-Doe'}
    assert.equal(evaluate(`historyRowSpaceLabel(${JSON.stringify(searchRow)})`), '', 'a row with no space shows no space')
    assert.equal(evaluate(`historyRowPostUrl(${JSON.stringify(searchRow)})`), '', 'a row with no post shows no post')
})

test('history row from a profile link links to the posting it sat in, and names no post when none was recorded', () => {
    const evaluate = loadDashboardHarness()
    // A profile link on a space feed: the evidence address is the profile itself, not the post it sits in (ShineOnUCrazyDiamond, Oct 31).
    const linkRow = {
        source: {spaceKey: 'quora-space:https://theobvioustrollshootinggallery.quora.com', pageUrl: 'https://theobvioustrollshootinggallery.quora.com/'},
        provenance: null,
        evidence: [{postKey: 'space-profile-link:https://www.quora.com/profile/ShineOnUCrazyDiamond', postUrl: 'https://www.quora.com/profile/ShineOnUCrazyDiamond'}],
        targetProfileHref: 'https://www.quora.com/profile/ShineOnUCrazyDiamond'
    }
    assert.equal(evaluate(`historyRowFromProfileLink(${JSON.stringify(linkRow)})`), true, 'the row is marked as a profile-link row')
    assert.equal(evaluate(`historyRowPostUrl(${JSON.stringify(linkRow)})`), '', 'with no recorded post, the profile address is not taken for the post')
    assert.equal(evaluate(`historyRowSpaceUrl(${JSON.stringify(linkRow)})`), 'https://theobvioustrollshootinggallery.quora.com', 'the space is still known')
    // The post the profile link sat in is recorded on the evidence as sourcePostUrl, and that posting is what the row links to.
    const sourcedRow = {...linkRow, evidence: [{...linkRow.evidence[0], sourcePostUrl: 'https://theobvioustrollshootinggallery.quora.com/Shine-Post-Slug'}]}
    assert.equal(evaluate(`historyRowPostUrl(${JSON.stringify(sourcedRow)})`), 'https://theobvioustrollshootinggallery.quora.com/Shine-Post-Slug', 'the row links to the posting that named the profile')
    const postRow = {...linkRow, evidence: [{postKey: 'space-post:https://theobvioustrollshootinggallery.quora.com/Some-post', postUrl: 'https://theobvioustrollshootinggallery.quora.com/Some-post'}]}
    assert.equal(evaluate(`historyRowFromProfileLink(${JSON.stringify(postRow)})`), false, 'a row with a post address is not a profile-link row')
    assert.equal(evaluate(`historyRowPostUrl(${JSON.stringify(postRow)})`), 'https://theobvioustrollshootinggallery.quora.com/Some-post')
})

test('history remove duplicates keeps only the newest row per profile when on, and every row when off', () => {
    const evaluate = loadDashboardHarness()
    const rows = [
        {coordinatorKey: 'a', targetProfileHref: 'https://www.quora.com/profile/Ann', terminalAt: 100},
        {coordinatorKey: 'b', targetProfileHref: 'https://www.quora.com/profile/Ben', terminalAt: 300},
        {coordinatorKey: 'c', targetProfileHref: 'https://www.quora.com/profile/Ann', terminalAt: 500},
        {coordinatorKey: 'd', targetProfileHref: 'https://www.quora.com/profile/Ann', updatedAt: 200},
        {coordinatorKey: 'e', targetProfileHref: '', terminalAt: 50},
        {coordinatorKey: 'f', targetProfileHref: '', terminalAt: 60}
    ]
    const keys = enabled => JSON.parse(evaluate(`JSON.stringify(historyDedupeRows(${JSON.stringify(rows)}, ${enabled}).map(row => row.coordinatorKey))`))

    assert.deepEqual(keys(false), ['a', 'b', 'c', 'd', 'e', 'f'], 'unchecked keeps every row')
    assert.deepEqual(keys(true), ['b', 'c', 'e', 'f'], 'checked keeps the latest row for each profile, in input order; rows with no profile are each kept')

    const source = readRepoFile('shared/js/coordinator.js')
    const renderBody = extractFunction(source, 'function renderHistoryRows()')
    assert.match(renderBody, /historyDedupeRows\(allRows, historyDedupeEnabled\)\.filter\(row => historyRowMatchesFilter\(row, historyFilterText\)\)/, 'duplicates are removed before the text filter')
})

test('history page has a filter box, a remove-duplicates checkbox and a count, beside the sort control, and render keeps the count current', () => {
    const pageHtml = readRepoFile('shared/coordinator.html')
    const controlsAt = pageHtml.indexOf('class="history-controls"')
    const sortAt = pageHtml.indexOf('id="historySort"')
    const filterAt = pageHtml.indexOf('id="historyFilter"')
    const dedupeAt = pageHtml.indexOf('id="historyDedupe"')
    const countAt = pageHtml.indexOf('id="historyCount"')
    const listAt = pageHtml.indexOf('id="historyList"')
    assert.ok(controlsAt !== -1 && controlsAt < sortAt, 'the sort control sits in the history controls row')
    assert.ok(sortAt < filterAt && filterAt < dedupeAt && dedupeAt < countAt && countAt < listAt, 'the filter, checkbox and count follow the sort control in that row')

    const filterTag = pageHtml.match(/<input\b[^>]*id="historyFilter"[^>]*>/)[0]
    assert.match(filterTag, /placeholder="Filter history"/)
    assert.match(filterTag.match(/\stitle="([^"]*)"/)[1], /^Mute Block extension: /, 'the filter hover help carries the shared prefix')

    const dedupeTag = pageHtml.match(/<label\b[^>]*class="history-dedupe"[^>]*>/)[0]
    assert.match(dedupeTag.match(/\stitle="([^"]*)"/)[1], /^Mute Block extension: /, 'the checkbox hover help carries the shared prefix')
    assert.match(pageHtml, /<input type="checkbox" id="historyDedupe">/)

    const source = readRepoFile('shared/js/coordinator.js')
    const renderBody = extractFunction(source, 'function renderHistoryRows()')
    assert.match(renderBody, /countEl\.textContent = \[`Showing \$\{rows\.length\} of \$\{allRows\.length\}`, historyClearNotice\]/, 'the count shows filtered of total, then the clear notice')
    assert.match(source, /historyFilterText = `\$\{event\?\.target\?\.value \|\| ''\}`/)
    assert.match(source, /historyDedupeEnabled = !!event\?\.target\?\.checked/)
    assert.match(source, /addEventListener\('input', event => \{[\s\S]*renderHistoryRows\(\)/)
})

test('dashboard first-load spinner is a role=status template with the Loading text', () => {
    const html = readRepoFile('shared/coordinator.html')
    const template = html.match(/<template id="loadingIndicatorTemplate">([\s\S]*?)<\/template>/)
    assert.ok(template, 'the loading indicator template exists in coordinator.html')
    assert.match(template[1], /<span class="loading-indicator" role="status" aria-live="polite">/)
    assert.match(template[1], /<span class="loading-spinner" aria-hidden="true"><\/span>/)
    assert.match(template[1], /<span class="loading-text">Loading…<\/span>/)
    assert.doesNotMatch(template[1], /style=|#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'the template carries no inline style or literal colour')
})

test('dashboard first-load spinner stops on the first state and shows the failure text on error', () => {
    const source = readRepoFile('shared/js/coordinator.js')

    // The worker's first answer is the first state; a first load it never answers records the existing failure text.
    const refreshBody = extractFunction(source, 'async function refreshCompactDashboardViews()')
    assert.match(refreshBody, /return \{queueRefreshed, runsRefreshed, answered: queueRefreshed \|\| runsRefreshed\}/)
    const loadStateBody = extractFunction(source, 'async function loadState()')
    assert.match(loadStateBody, /if\(refreshed\.answered\) state\.firstStateReceived = true/)
    assert.match(loadStateBody, /else if\(!state\.firstStateReceived\) state\.loadError = 'The extension did not answer the dashboard load'/)

    // A later load (init's, or the poll's) clears the error only once the first state has arrived, so a failed first load stays failed.
    assert.equal((source.match(/if\(state\.firstStateReceived\) state\.loadError = ''/g) || []).length, 2)

    // The spinner goes where the empty text would go, and the failure text replaces it on a failed first load.
    const replaceBody = extractFunction(source, 'function replaceChildren(')
    assert.match(replaceBody, /if\(firstLoad === 'pending'\) \{\s*container\.append\(buildLoadingIndicator\(\)\)/)
    assert.match(replaceBody, /empty\.textContent = firstLoad === 'failed' \? DASHBOARD_LOAD_FAILED_TEXT : emptyText/)
    assert.match(extractFunction(source, 'function getDashboardFirstLoadState()'), /return state\.loadError \? 'failed' : 'pending'/)

    // The Current Work header and list use the first-load state; a spinner shows from the first paint in init.
    const renderBody = extractFunction(source, 'function render()')
    assert.match(renderBody, /else if\(firstLoad === 'pending'\) showLoadingIndicator\('currentWorkReadyCount'\)/)
    assert.match(renderBody, /else setText\('currentWorkReadyCount', DASHBOARD_LOAD_FAILED_TEXT\)/)
    assert.match(extractFunction(source, 'function renderQueue('), /'No Current Work yet\.', getDashboardFirstLoadState\(\)\)/)
    assert.match(extractFunction(source, 'async function init()'), /showLoadingIndicator\('currentWorkReadyCount'\)[\s\S]*showLoadingIndicator\('queueList'\)/)

    // The History page: its first fetch ends the spinner, and a first fetch that never answers ends it with the failure text.
    const historyBody = extractFunction(source, 'async function refreshHistoryRows(')
    assert.match(historyBody, /if\(historyFirstLoadState === 'pending'\) \{\s*historyFirstLoadState = 'failed'/)
    assert.match(historyBody, /historyFirstLoadState = 'loaded'/)
    assert.match(extractFunction(source, 'function renderHistoryRows()'), /historyFirstLoadState\)\n\}$/)

    // Behaviour, through the dashboard harness: the three first-load states.
    const evaluate = loadDashboardHarness()
    assert.equal(evaluate(`(() => { state.firstStateReceived = false; state.loadError = ''; return getDashboardFirstLoadState() })()`), 'pending')
    assert.equal(evaluate(`(() => { state.firstStateReceived = false; state.loadError = 'boom'; return getDashboardFirstLoadState() })()`), 'failed')
    assert.equal(evaluate(`(() => { state.firstStateReceived = true; state.loadError = ''; return getDashboardFirstLoadState() })()`), 'loaded')
    assert.equal(evaluate(`DASHBOARD_LOAD_FAILED_TEXT`), 'History load failed')
})

test('dashboard first-load spinner spins only under prefers-reduced-motion: no-preference', () => {
    const css = readRepoFile('shared/css/coordinator.css')
    const media = css.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/)
    assert.ok(media, 'the spin is wrapped in a prefers-reduced-motion: no-preference query')
    assert.match(media[1], /\.loading-spinner \{\s*animation: loading-spin 0\.9s linear infinite;\s*\}/)
    // Outside that query the spinner has no animation, so reduced motion leaves the ring and the Loading text still.
    assert.doesNotMatch(css.replace(media[0], ''), /animation:\s*loading-spin/)
    assert.match(extractCssRuleBody(css, '.loading-indicator'), /color: var\(--mb-grey-500\)/)
})

test('dashboard first-load spinner adds no hard-coded colour and uses only existing tokens', () => {
    const css = readRepoFile('shared/css/coordinator.css')
    const tokens = readRepoFile('shared/css/tokens.css')
    const selectors = ['.loading-indicator', '.list > .loading-indicator', '.loading-spinner']
    const bodies = selectors.map(selector => extractCssRuleBody(css, selector))
    for(const body of bodies) {
        assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'no literal colour in the spinner rules')
        for(const token of body.match(/--mb-[a-z0-9-]+/g) || []) {
            assert.match(tokens, new RegExp(`${token}:`), `${token} is an existing token in tokens.css`)
        }
    }
    assert.match(bodies[2], /border-top-color: var\(--mb-indigo-600\)/)
})

test('dashboard first-load spinner already on screen is kept, not replaced, while the first load is pending', () => {
    const source = readRepoFile('shared/js/coordinator.js')

    // replaceChildren returns before clearing a container whose spinner is already shown, so a render does not restart the spin.
    const replaceBody = extractFunction(source, 'function replaceChildren(')
    assert.match(replaceBody, /if\(firstLoad === 'pending' && !children\.length && isLoadingIndicatorShown\(container\)\) return\s*\n\s*container\.replaceChildren\(\)/)

    // showLoadingIndicator leaves an element alone when its spinner is already there.
    const showBody = extractFunction(source, 'function showLoadingIndicator(')
    assert.match(showBody, /if\(!element \|\| isLoadingIndicatorShown\(element\)\) return/)
    assert.match(showBody, /element\.replaceChildren\(buildLoadingIndicator\(\)\)/)

    // Behaviour, through the harness, on stand-in elements: only a lone spinner counts as shown.
    const evaluate = loadDashboardHarness()
    const spinnerOnly = `({firstElementChild: {classList: {contains: name => name === 'loading-indicator'}}, childElementCount: 1})`
    const textOnly = `({firstElementChild: null, childElementCount: 0})`
    const rowsAndSpinner = `({firstElementChild: {classList: {contains: name => name === 'loading-indicator'}}, childElementCount: 2})`
    assert.equal(evaluate(`isLoadingIndicatorShown(${spinnerOnly})`), true)
    assert.equal(evaluate(`isLoadingIndicatorShown(${textOnly})`), false)
    assert.equal(evaluate(`isLoadingIndicatorShown(${rowsAndSpinner})`), false)
    assert.equal(evaluate(`isLoadingIndicatorShown(null)`), false)
})

test('erase keeps the one-time space import marker, and removes the 1.5 space registry under its plain name after the prefixed keys', () => {
    // Owner, 27 Oct: after a clean-slate erase the 1.5 space classifications must not come back. The import marker is in the keep set,
    // so the import never runs again after an erase. Both erase paths (the request and the retry at the next start) honour the keep set,
    // and both remove the plain 1.5 key after the prefixed keys, through the storage namespace module (no literal browser.storage.local here).
    const source = readRepoFile('shared/js/sw.js')
    assert.match(source, /const ERASE_BLOCK_HISTORY_KEEP_KEYS = new Set\(\[SPACE_REGISTRY_IMPORT_MARKER_KEY\]\)/)
    const requested = extractFunction(source, 'async function eraseBlockHistoryRequested(request = {})')
    const pending = extractFunction(source, 'async function runPendingBlockHistoryErase()')
    for(const body of [requested, pending]) {
        assert.match(body, /!ERASE_BLOCK_HISTORY_KEEP_KEYS\.has\(key\)/)
        assert.match(body, /removePlainLocalNames\(browser, \[SPACE_REGISTRY_KEY\]\)/)
        assert.match(body, /eraseBlockHistory\.plainRemoveFailed/)
        const prefixedRemove = body.indexOf('await coordinatorStorageAdapter.remove(removeKeys)')
        const plainRemove = body.indexOf('removePlainLocalNames(browser, [SPACE_REGISTRY_KEY])')
        assert.notEqual(prefixedRemove, -1)
        assert.ok(prefixedRemove < plainRemove, 'the plain remove comes after the prefixed remove')
        assert.doesNotMatch(body, /browser\.storage\.local\./)
    }
    assert.doesNotMatch(source, /browser\.storage\.local\.remove/)
})

// 27 Oct. A space's Collect N More count is kept on its registry record, next to its category. A new record starts at the default, a
// category change keeps the count, and a value the dropdown does not offer is the default. Space pages only; the search page is unchanged.
test('a new space record starts with the default collect count, and a category change keeps a chosen count (27 Oct)', () => {
    const {buildSpaceRecord, normalizeSpaceCollectCount, withSpaceRecordCollectCount} = require('../shared/js/spaceRegistry.js')
    const tunables = require('../shared/js/tunables.js')
    const space = {key: 'quora-space:https://www.quora.com/space/A', url: 'https://www.quora.com/space/A', name: 'A'}

    const created = buildSpaceRecord(space, 'asset')
    assert.equal(created.collectCount, tunables.PROFILE_SEARCH_COLLECT_LIMIT)
    assert.equal(created.collectCount, 100)

    const counted = withSpaceRecordCollectCount(created, 500)
    assert.equal(counted.collectCount, 500)
    assert.equal(counted.category, 'asset')
    assert.equal(counted.url, created.url)
    const changed = buildSpaceRecord(space, 'target', counted)
    assert.equal(changed.category, 'target')
    assert.equal(changed.collectCount, 500, 'a category change keeps the chosen count')

    for(const bad of [7, '500', 0, NaN, null, undefined, 1001]) {
        assert.equal(normalizeSpaceCollectCount(bad), 100, `${String(bad)} is replaced by the default`)
    }
    assert.equal(normalizeSpaceCollectCount(1000), 1000)
    assert.equal(buildSpaceRecord(space, 'asset', {collectCount: 7}).collectCount, 100, 'an invalid stored count is replaced by the default')
    assert.equal(withSpaceRecordCollectCount(null, 500), null, 'a space with no record has no record to change')
})

// The space page's Collect count tests. The functions come from content.js; the registry helpers come from spaceRegistry.js.
function loadSpaceCollectCountHarness(options) {
    const registryModule = require('../shared/js/spaceRegistry.js')
    const tunables = require('../shared/js/tunables.js')
    const source = readRepoFile('shared/js/content.js')
    const sent = []
    const state = {
        descriptor: options.descriptor,
        location: {origin: 'https://www.quora.com', pathname: options.pathname},
        syncs: 0
    }
    const context = vm.createContext({
        PROFILE_SEARCH_COLLECT_LIMIT: tunables.PROFILE_SEARCH_COLLECT_LIMIT,
        PROFILE_SEARCH_COLLECT_CHOICES: tunables.PROFILE_SEARCH_COLLECT_CHOICES,
        normalizeSpaceUrl: registryModule.normalizeSpaceUrl,
        extractSpaceSlug: registryModule.extractSpaceSlug,
        normalizeSpaceCollectCount: registryModule.normalizeSpaceCollectCount,
        withSpaceRecordCollectCount: registryModule.withSpaceRecordCollectCount,
        location: state.location,
        resolveCurrentSpaceDescriptor: () => state.descriptor,
        syncSpaceFeedCollectButton: () => { state.syncs += 1 },
        syncSpaceClassificationControls: () => {},
        scheduleSpaceAssetNukeControls: () => {},
        safeSendRuntimeMessage: message => {
            sent.push(message)
            return Promise.resolve(null)
        }
    })
    vm.runInContext([
        'let spaceFeedCollectLimit = PROFILE_SEARCH_COLLECT_LIMIT',
        "let spaceFeedCollectKey = ''",
        'let spaceFeedCollecting = false',
        'let spaceRegistry = {}',
        extractFunction(source, 'function getSpaceFeedCollectKey()'),
        extractFunction(source, 'function ensureSpaceFeedCollectStateForCurrentSpace()'),
        extractFunction(source, 'function syncSpaceFeedCollectLimitFromRecord()'),
        extractFunction(source, 'function setSpaceFeedCollectLimit(value)'),
        extractFunction(source, 'async function persistSpaceFeedCollectCount(value)'),
        extractFunction(source, 'function applySpaceRecordReply(key, reply)'),
        extractFunction(source, 'function getStoredSpaceRecord(space)')
    ].join('\n'), context)
    const run = code => vm.runInContext(code, context)
    run(`spaceRegistry = ${JSON.stringify(options.registry || {})}`)
    return {run, state, sent}
}

const SPACE_A_KEY = 'quora-space:https://www.quora.com/space/A'
const SPACE_A_DESCRIPTOR = {key: SPACE_A_KEY, url: 'https://www.quora.com/space/A', slug: 'A', name: 'A'}
const SPACE_A_RECORD = {key: SPACE_A_KEY, url: 'https://www.quora.com/space/A', slug: 'A', name: 'A', category: 'asset', collectCount: 100, updatedAt: 1}

test('a space page starts with the collect count on its registry record, and the default when it has none (27 Oct)', () => {
    const h = loadSpaceCollectCountHarness({pathname: '/space/A', descriptor: SPACE_A_DESCRIPTOR, registry: {[SPACE_A_KEY]: {...SPACE_A_RECORD, collectCount: 500}}})
    h.run('ensureSpaceFeedCollectStateForCurrentSpace()')
    assert.equal(h.run('spaceFeedCollectLimit'), 500)

    // The registry can arrive after the page started: the count follows the record when it does.
    h.run(`spaceRegistry = ${JSON.stringify({[SPACE_A_KEY]: {...SPACE_A_RECORD, collectCount: 1000}})}`)
    h.run('syncSpaceFeedCollectLimitFromRecord()')
    assert.equal(h.run('spaceFeedCollectLimit'), 1000)
    assert.equal(h.state.syncs, 1, 'the dropdown is redrawn with the new count')

    // A space with no record starts at the default.
    h.state.location.pathname = '/space/B'
    h.state.descriptor = {key: 'quora-space:https://www.quora.com/space/B', url: 'https://www.quora.com/space/B', slug: 'B', name: 'B'}
    h.run('ensureSpaceFeedCollectStateForCurrentSpace()')
    assert.equal(h.run('spaceFeedCollectLimit'), 100)
})

test('choosing a count on a categorised space writes it into that space record, and an unchanged count writes nothing (27 Oct)', () => {
    const h = loadSpaceCollectCountHarness({pathname: '/space/A', descriptor: SPACE_A_DESCRIPTOR, registry: {[SPACE_A_KEY]: SPACE_A_RECORD}})
    h.run('ensureSpaceFeedCollectStateForCurrentSpace()')
    h.run('setSpaceFeedCollectLimit(500)')
    assert.equal(h.run('spaceFeedCollectLimit'), 500)
    assert.equal(h.sent.length, 1, 'one registry write')
    assert.equal(h.sent[0].action, 'set-space-record')
    assert.equal(h.sent[0].key, SPACE_A_KEY)
    assert.equal(h.sent[0].change.collectCount, 500)
    assert.deepEqual(Object.keys(h.sent[0].change), ['collectCount'], 'the write carries the count only, so the stored category is not sent (29 Oct)')
    assert.equal(typeof h.sent[0].at, 'number', 'the write carries the time the user acted')
    assert.equal(h.run(`spaceRegistry[${JSON.stringify(SPACE_A_KEY)}].collectCount`), 500, 'the page registry matches what was written')
    assert.equal(h.run(`spaceRegistry[${JSON.stringify(SPACE_A_KEY)}].category`), 'asset', 'the category is kept on the page copy')

    h.run('setSpaceFeedCollectLimit(500)')
    assert.equal(h.sent.length, 1, 'a count equal to the stored one writes nothing')
})

test('choosing a count on an uncategorised space keeps it in memory and writes nothing (27 Oct)', () => {
    const h = loadSpaceCollectCountHarness({pathname: '/space/A', descriptor: SPACE_A_DESCRIPTOR, registry: {}})
    h.run('ensureSpaceFeedCollectStateForCurrentSpace()')
    h.run('setSpaceFeedCollectLimit(1000)')
    assert.equal(h.run('spaceFeedCollectLimit'), 1000)
    assert.equal(h.sent.length, 0, 'no registry write without a record')
    assert.equal(h.run('Object.keys(spaceRegistry).length'), 0)
})

test('the space page writes one record per change, through the same message the category buttons and the collect count use (29 Oct)', () => {
    const source = readRepoFile('shared/js/content.js')
    assert.match(extractFunction(source, 'async function persistSpaceFeedCollectCount(value)'), /action: 'set-space-record', key: recordKey, change: \{collectCount: value\}, at: Date\.now\(\)/)
    assert.match(extractFunction(source, 'async function setCurrentSpaceCategory(space, category)'), /action: 'set-space-record',[\s\S]*?change: \{category, url: space\.url, slug: space\.slug, name: space\.name\}/)
    assert.doesNotMatch(source, /set-space-registry/, 'no page sends the whole registry any more (29 Oct)')
    assert.doesNotMatch(extractFunction(source, 'function setSpaceFeedCollectLimit(value)'), /storage|browser\./)
})

test('setSpaceRecordRequested changes one record, keeps its count on a category change, and refuses a stale change (29 Oct)', () => {
    const source = readRepoFile('shared/js/sw.js')
    const body = extractFunction(source, 'async function setSpaceRecordRequested(input = {})')
    assert.match(body, /runSpaceRegistryExclusive\(async \(\) => \{/, 'the read and the write are one task')
    assert.match(body, /\{\.\.\.map, \[key\]: next\}/, 'only this record is written; the other records are kept from the stored map')

    const {applySpaceRecordChange, normalizeSpaceCollectCount} = require('../shared/js/spaceRegistry.js')
    const record = {key: 'a', url: 'https://www.quora.com/space/a', slug: 'a', name: 'A', category: 'asset', collectCount: 500, updatedAt: 1000}
    const category = applySpaceRecordChange(record, 'a', {category: 'target', url: record.url, slug: 'a', name: 'A'}, 2000)
    assert.equal(category.category, 'target')
    assert.equal(category.collectCount, 500, 'a category change keeps the stored count')
    assert.equal(category.updatedAt, 2000, 'the record is stamped with the time the user acted, not the time the worker applied it')

    const counted = applySpaceRecordChange(record, 'a', {collectCount: 25}, 2000)
    assert.equal(counted.collectCount, 25)
    assert.equal(counted.category, 'asset', 'a count change keeps the stored category')

    assert.equal(applySpaceRecordChange(record, 'a', {collectCount: 25}, 999), null, 'a change made before the last update is refused')
    assert.equal(applySpaceRecordChange(null, 'a', {collectCount: 25}, 2000), null, 'a count with no record to change is refused')
    assert.equal(applySpaceRecordChange(null, 'a', {category: 'asset'}, 2000), null, 'a category with no url is refused')
    assert.equal(applySpaceRecordChange(record, 'a', {collectCount: 7}, 2000).collectCount, normalizeSpaceCollectCount(7), 'an invalid count is stored as the default')
})

test('the search batch counts its queueing down per chunk, as the space page does', () => {
    const source = readRepoFile('shared/js/content.js')
    assert.match(source, /async function enqueueCoordinatorProfileUrls\(options = \{\}\)[\s\S]*?onProgress = null/)
    assert.match(source, /\}, onProgress\)\n\}\n\nasync function nukeSpaceFeedEntries/)
    const searchBlock = source.slice(source.indexOf('async function nukeProfileSearchHrefsOnce'), source.indexOf('async function nukeProfileSearchHrefsOnce') + 4000)
    assert.match(searchBlock, /sendBatch: \(profileHrefs, onProgress\) => enqueueCoordinatorProfileUrls\(\{/)
    assert.match(searchBlock, /onProgress\n\s*\}\)/)
    // The progress label is written by the shared driver that both pages use (candidateNuke.js), not by the page.
    assert.match(readRepoFile('shared/js/candidateNuke.js'), /setWorking\(formatQueueingLabel\(remaining, totalItems\)\)/)
    assert.doesNotMatch(searchBlock, /Queueing \$\{profileHrefs\.length\}\.\.\./)
})

test('every collect run ends with a flight recorder event that says why: captured, end, stalled or stopped', () => {
    const source = readRepoFile('shared/js/content.js')
    assert.match(source, /function reportCollectEnd\(page, \{reason, collected, limit, passes, startedAt, considered = null\}\)/)
    assert.match(source, /reportPageEvent\(`\$\{page\}-collect-end`/)
    for (const reason of ['captured', 'stopped', 'stalled']) {
        assert.match(source, new RegExp(`'${reason}'`), `the ${reason} reason is set`)
    }
    assert.match(source, /'end-of-feed' : 'stalled'/)
    assert.match(source, /'end-of-results' : 'stalled'/)
    assert.match(source, /reportCollectEnd\('space'/)
    assert.match(source, /reportCollectEnd\('search'/)
})

test('the search Considered line: its class is in content.js and content.css, and it is kept as a toolbar element (27 Oct)', () => {
    const source = readRepoFile('shared/js/content.js')
    const css = readRepoFile('shared/css/content.css')
    assert.match(source, /renderProfileSearchTextLine\(toolbar, 'mb-ext_profile-search-considered', profileSearchConsideredText, '\.mb-ext_profile-search-collect-wrap'\)/)
    assert.match(css, /\.mb-ext_profile-search-considered,\s*\n\.mb-ext_profile-search-considered-cause \{[^}]*color:\s*var\(--mb-grey-600\)/)
    assert.doesNotMatch(css.match(/\.mb-ext_profile-search-considered,\s*\n\.mb-ext_profile-search-considered-cause \{[^}]*\}/)[0], /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/)
    const helperBody = extractFunction(source, 'function renderProfileSearchTextLine(toolbar, className, text, anchorSelector)')
    assert.match(helperBody, /insertAdjacentElement\('afterend', line\)/)
    assert.match(helperBody, /toolbar\.querySelector\(`\.\$\{className\}`\)/)
    // The sync re-attaches it from the stored text, so a rebuilt toolbar keeps the line.
    const syncBody = extractFunction(source, 'function syncProfileSearchControls()')
    assert.match(syncBody, /renderProfileSearchConsideredLine\(buttons\.toolbar\)/)
})

test('the Considered text reads "Considered X displayed matches" and adds commas only from 1000 up (27 Oct)', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'function formatProfileSearchConsideredText(count)')
    const format = new vm.Script(`${body}; formatProfileSearchConsideredText`).runInNewContext({})
    assert.equal(format(0), 'Considered 0 displayed matches')
    assert.equal(format(2), 'Considered 2 displayed matches')
    assert.equal(format(999), 'Considered 999 displayed matches')
    assert.equal(format(1000), 'Considered 1,000 displayed matches')
    assert.equal(format(6088), 'Considered 6,088 displayed matches')
    assert.equal(format(undefined), 'Considered 0 displayed matches')
})

test('a new Collect run clears the Considered line before its first read, and the run ends by setting it (27 Oct)', () => {
    const source = readRepoFile('shared/js/content.js')
    const body = extractFunction(source, 'async function collectMoreProfileSearchResults(button)')
    const clearAt = body.indexOf("setProfileSearchConsideredText('')")
    const firstReadAt = body.indexOf('const rows = getProfileSearchRows({fromCurrentViewport: true, skipProcessed: true})')
    assert.ok(clearAt > 0, 'the run start clears the line')
    assert.ok(clearAt < firstReadAt, 'the clear comes before the loop reads the rows')
    assert.match(body, /const consideredRows = new Set\(\)/)
    assert.match(body, /for\(const row of rows\) consideredRows\.add\(row\.row\)/)
    assert.match(body, /setProfileSearchConsideredText\(\s*formatProfileSearchConsideredText\(consideredRows\.size\),\s*formatProfileSearchCollectCause\(endReason, profileSearchCollectProgress\.passes\)\s*\)/)
    // The lines are set after the end event, in the same place as the loop's end notice.
    assert.ok(body.indexOf('reportCollectEnd(\'search\'') < body.indexOf('setProfileSearchConsideredText(\n'))
})

test('the cause line under Considered: the four recorded reasons and Page load are the labels, and a run with no pass shows Page load (27 Oct)', () => {
    const source = readRepoFile('shared/js/content.js')
    const css = readRepoFile('shared/css/content.css')
    for (const label of ['Count reached', 'End of search results', 'Stalled', 'Stopped', 'Page load']) {
        assert.ok(source.includes(`'${label}'`), `the ${label} label is in content.js`)
    }
    assert.match(source, /renderProfileSearchTextLine\(toolbar, 'mb-ext_profile-search-considered-cause', profileSearchConsideredCause, '\.mb-ext_profile-search-considered'\)/)
    assert.match(css, /\.mb-ext_profile-search-considered-cause/)
    const causeBody = extractFunction(source, 'function formatProfileSearchCollectCause(reason, passes)')
    const cause = new vm.Script(`const PROFILE_SEARCH_CAUSE_LABELS = ${source.slice(source.indexOf('PROFILE_SEARCH_CAUSE_LABELS = ') + 'PROFILE_SEARCH_CAUSE_LABELS = '.length, source.indexOf('\n}', source.indexOf('PROFILE_SEARCH_CAUSE_LABELS = ')) + 2)}; ${causeBody}; formatProfileSearchCollectCause`).runInNewContext({})
    assert.equal(cause('captured', 3), 'Count reached')
    assert.equal(cause('end-of-results', 3), 'End of search results')
    assert.equal(cause('end-of-feed', 3), 'End of search results')
    assert.equal(cause('stalled', 3), 'Stalled')
    assert.equal(cause('stopped', 3), 'Stopped')
    assert.equal(cause('stopped', 0), 'Page load', 'a run with no pass shows Page load, not the recorded reason')
    assert.equal(cause('captured', 0), 'Page load')
})

test('the search collect-end event detail carries seen, the distinct result rows the run read (27 Oct)', () => {
    const source = readRepoFile('shared/js/content.js')
    const reportBody = extractFunction(source, 'function reportCollectEnd(page, {reason, collected, limit, passes, startedAt, considered = null})')
    assert.match(reportBody, /const seen = Number\.isFinite\(considered\) \? ` seen \$\{considered\}` : ''/)
    assert.match(reportBody, /\$\{passes\} \$\{seconds\}s\$\{seen\}`/)
    const searchCall = source.slice(source.indexOf("reportCollectEnd('search'"), source.indexOf("reportCollectEnd('search'") + 400)
    assert.match(searchCall, /considered: consideredRows\.size/)
    // The space page's call passes no count, so its event keeps the old detail.
    const spaceCall = source.slice(source.indexOf("reportCollectEnd('space'"), source.indexOf("reportCollectEnd('space'") + 400)
    assert.doesNotMatch(spaceCall, /considered/)
})

test('space feed reads answer timestamps as posts too, and single-post page detection still reads only post timestamps (30 Oct)', () => {
    const content = readRepoFile('shared/js/content.js')
    // Posts that are answers are marked a.answer_timestamp, not a.post_timestamp. Without it, their poster is not a candidate and the
    // post's controls go to the post above (SEO Rankings, 30 Oct).
    assert.match(extractFunction(content, 'function getSpaceFeedPostEntries()'), /a\.post_timestamp, a\.answer_timestamp/)
    assert.match(extractFunction(content, 'function getSpaceFeedPostRootFromMutationNode(node)'), /a\.answer_timestamp/)
    // Page-type detection is shared with question and single-post pages, so it keeps the post-only selector.
    assert.doesNotMatch(extractFunction(content, 'function isSpacePostPage()'), /answer_timestamp/)
})

test('the Autosave drop-down offers 0 and 50, the save button names the every-50 setting, and the poll counts completions and saves at each 50', () => {
    const html = readRepoFile('shared/coordinator.html')
    const js = readRepoFile('shared/js/coordinator.js')
    assert.match(html, /<select id="flightRecorderAutosaveSelect"[\s\S]*?<option value="0">0<\/option>[\s\S]*?<option value="50">50<\/option>/)
    assert.match(js, /Save flight recorder every \$\{FLIGHT_RECORDER_AUTOSAVE_STEP\} completed/)
    assert.match(js, /initFlightRecorderAutosave\(\)/)
    const poll = extractFunction(js, 'async function pollFlightRecorderAutosave()')
    assert.match(poll, /action: 'get-recent-history'/)
    assert.match(poll, /since: flightAutosaveSeenAt/)
    assert.match(poll, /while\(flightAutosavePending >= FLIGHT_RECORDER_AUTOSAVE_STEP\)/)
    assert.match(poll, /void saveFlightRecorder\(\)/)
    // The autosave only runs in dev mode, where the save button is shown.
    assert.match(poll, /isDevModeStoredEnabled\(\)/)
})

test('a block attempt that stopped on a followed profile is highlighted as an error in history', () => {
    const evaluate = loadDashboardHarness()
    const followed = {status: 'skipped', outcome: 'block-attempt-on-following', error: '', targetProfileHref: 'https://www.quora.com/profile/Someone'}
    assert.equal(evaluate(`historyRowHasError(${JSON.stringify(followed)})`), true, 'a following skip is highlighted')
    const done = {status: 'succeeded', outcome: 'blocked', error: '', targetProfileHref: 'https://www.quora.com/profile/Someone'}
    assert.equal(evaluate(`historyRowHasError(${JSON.stringify(done)})`), false, 'a finished block is not highlighted')
})

test('MB Info shows only on asset and target spaces; a space with no stored category is neutral and gets none', () => {
    const body = extractFunction(readRepoFile('shared/js/content.js'), 'function syncSpaceFeedStatusButton(entries = null)')
    assert.match(body, /if\(category !== 'asset' && category !== 'target'\) \{/)
    assert.match(body, /host\.querySelector\('\.mb-ext_space-feed-status-btn'\)\?\.remove\(\)/)
})
