const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

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

const ALICE = 'https://www.quora.com/profile/Alice-Example'
const BOB = 'https://www.quora.com/profile/Bob-Example'
const CAROL = 'https://www.quora.com/profile/Carol-Example'

function loadProfileStateHarness() {
    const source = readRepoFile('shared/js/content.js')
    const context = {
        progress: {},
        pending: new Set(),
        console
    }
    vm.createContext(context)
    vm.runInContext([
        // Stubs for lookups the helpers call. The real ones live in subject.js and the progress code.
        `function normalizeQuoraProfileHref(href = '') {
            const value = \`\${href || ''}\`.split(/[?#]/)[0].replace(/\\/+$/, '')
            return value.includes('/profile/') ? value : null
        }`,
        `function getNormalizedProfileIdentityKey(href) {
            return \`\${href || ''}\`.split('/profile/')[1] || ''
        }`,
        `function getNormalizedProfileHrefList(urls = []) {
            const seen = new Set()
            const result = []
            for(const url of Array.isArray(urls) ? urls : []) {
                const normalized = normalizeQuoraProfileHref(url)
                const key = getNormalizedProfileIdentityKey(normalized)
                if(!normalized || !key || seen.has(key)) continue
                seen.add(key)
                result.push(normalized)
            }
            return result
        }`,
        `function getActivePendingSpaceFeedUrlsForRender() { return [] }`,
        `function isProfileNukeRetryBlocked() { return false }`,
        `function isProfileNukeSucceeded(href) { return progress[href]?.status === 'blocked' }`,
        source.slice(source.indexOf('const spaceFeedKnownNukedProfileKeys'), source.indexOf('function getSpaceFeedProfileStateKey')),
        extractFunction(source, 'function getSpaceFeedProfileStateKey(href)'),
        extractFunction(source, 'function isKnownNukedSpaceFeedProfile(href)'),
        extractFunction(source, 'function isSpaceFeedProfileStateReady(href)'),
        extractFunction(source, 'function getSpaceFeedUniqueQueueableProfileCount(queueableEntries = [])'),
        extractFunction(source, 'function isSpaceFeedPostNuked(candidateUrls = null)'),
        extractFunction(source, 'function getSpacePendingProfileCount(entries = [], pendingCoordinatorProfileHrefs = new Set())'),
        extractFunction(source, 'function getQueueableSpaceFeedEntryUrlsForRender(entry = null, context = null)'),
        `globalThis.harness = {
            answered: spaceFeedAnsweredProfileKeys,
            knownNuked: spaceFeedKnownNukedProfileKeys,
            isReady: isSpaceFeedProfileStateReady,
            isNuked: isKnownNukedSpaceFeedProfile,
            postNuked: isSpaceFeedPostNuked,
            count: getSpaceFeedUniqueQueueableProfileCount,
            pendingCount: getSpacePendingProfileCount,
            queueable: getQueueableSpaceFeedEntryUrlsForRender
        }`
    ].join('\n\n'), context, {filename: 'content-space-profile-state-gate-harness.js'})

    return context
}

test('a profile is ready only after the worker has answered for it, and the query form does not matter', () => {
    const {harness} = loadProfileStateHarness()
    assert.equal(harness.isReady(ALICE), false)

    harness.answered.add('Alice-Example')
    assert.equal(harness.isReady(ALICE), true)
    assert.equal(harness.isReady(`${ALICE}?ch=17&oid=1`), true)
    assert.equal(harness.isReady(BOB), false)
})

test('an unanswered profile is not offered by a red post, and an answered one is', () => {
    const context = loadProfileStateHarness()
    const {harness} = context
    const entry = {postKey: 'post-a', candidateUrls: [ALICE, BOB]}

    assert.equal(harness.queueable(entry, null).length, 0)

    harness.answered.add('Alice-Example')
    assert.equal(JSON.stringify(harness.queueable(entry, null)), JSON.stringify([ALICE]))
})

test('a profile found nuked stays nuked after its progress record is replaced, so it is not asked about again', () => {
    const context = loadProfileStateHarness()
    const {harness} = context

    context.progress[ALICE] = {status: 'blocked'}
    assert.equal(harness.isNuked(ALICE), true)
    assert.equal(harness.knownNuked.has('Alice-Example'), true)

    context.progress = {}
    assert.equal(harness.isNuked(ALICE), true)
})

test('a nuked profile is not offered, and a post whose profiles are all nuked is nuked', () => {
    const context = loadProfileStateHarness()
    const {harness} = context

    context.progress[ALICE] = {status: 'blocked'}
    harness.answered.add('Alice-Example')
    harness.answered.add('Bob-Example')

    assert.equal(harness.queueable({postKey: 'post-a', candidateUrls: [ALICE, BOB]}, null).length, 1)
    assert.equal(harness.postNuked([ALICE]), true)
    assert.equal(harness.postNuked([ALICE, BOB]), false)
})

test('a profile link whose text is its URL is not rejected by the action-word filter', () => {
    const content = readRepoFile('shared/js/content.js')
    const body = extractFunction(content, 'function isSpaceFeedCandidateProfileLink(link, postRoot)')

    assert.match(body, /replace\(\/https\?:\\\/\\\/\\S\+\/gi, ' '\)/)
    assert.match(body, /\\b\(comment\|share\|upvote\|downvote\|more\)\\b/i)
})

test('the worker settles finished live queue rows for the page: a success is a block, any other finish is a Bad Link', () => {
    const worker = readRepoFile('shared/js/sw.js')
    assert.match(worker, /Settled from the live queue row/)
    assert.match(worker, /const liveItem = findCoordinatorQueueEntryForHref\(scopedQueue, profileHref\)\?\.item \|\| null/)
})

test('the worker settles every finished archived row for the page, and the black button names this post on hover', () => {
    const worker = readRepoFile('shared/js/sw.js')
    const content = readRepoFile('shared/js/content.js')

    assert.match(worker, /if\(archived && isTerminalCoordinatorStatus\(archived\.status\) && !scopedProgress\[profileHref\]/)
    assert.match(content, /this post: \$\{\(entry\.queueableUrls \|\| \[\]\)\.map/)
})

test('the queue bar is recorded and pushed from every queue view refresh, not only from a stored view', () => {
    const worker = readRepoFile('shared/js/sw.js')
    const body = extractFunction(worker, 'async function refreshCoordinatorQueueViewForDashboard(reason = \'dashboard-refresh\')')

    assert.match(body, /recordQueueBarSummary\(summarizeQueueBarView\(view, Date\.now\(\)\)\)/)
    assert.match(body, /void pushQueueBarSummary\(browser, summary\)/)
    assert.match(body, /profileNukeProgressPush\.push\(\)/)
    assert.match(worker, /const \{summarizeQueueBarView, recordQueueBarSummary, pushQueueBarSummary\} = require\('\.\/swQueueBarSummary'\)/)
})

test('the render reads post positions only near the viewport, and the latest-entries getter reads none', () => {
    const content = readRepoFile('shared/js/content.js')
    const getter = extractFunction(content, 'function getUpdatedSpaceFeedEntryViewport(entry)')
    const reader = extractFunction(content, 'function readSpaceFeedEntryViewport(postRoot, previous = null)')
    const bounded = extractFunction(content, 'function getBoundedVisibleSpaceFeedTimestamps()')

    assert.doesNotMatch(getter, /getBoundingClientRect/)
    assert.match(reader, /isSpaceFeedPostRootNear\(postRoot\)/)
    assert.match(bounded, /allTimestamps/)
    assert.doesNotMatch(bounded, /spaceFeedNearPostRoots/)
})

test('the space page asks for its state every few seconds while a nuke is pending, and redraws only when the answer changed', () => {
    const content = readRepoFile('shared/js/content.js')
    const poll = extractFunction(content, 'async function pollSpaceFeedState()')

    const tunables = readRepoFile('shared/js/tunables.js')
    assert.match(tunables, /SPACE_FEED_STATE_POLL_MS: 5000/)
    assert.match(content, /CONTENT_PROGRESS_BAR_POLL_MS, SPACE_FEED_STATE_POLL_MS, OWNED_NUKE_STATUS_TTL_MS, OWNED_NUKE_STATUS_WAIT_MS, SPACE_FEED_RENDER_MIN_GAP_MS, SPACE_FEED_PROFILE_LINK_CARD_CACHE_MS, SPACE_FEED_PROFILE_LINK_FULL_SCAN_MS, SPACE_FEED_CONTENT_ROOT_MEMO_MS, SPACE_FEED_SCAN_REUSE_MS, SPACE_FEED_SCAN_BAND_DOWN_PX, SPACE_FEED_SCAN_BAND_UP_PX, SPACE_FEED_RENDER_MODEL_MEMO_MS\} = require\('\.\/tunables'\)/)
    assert.match(poll, /refreshContentPageCoordinatorStateFromRuntime\(\{force: true, entries: getLatestSpaceFeedEntries\(\)\}\)/)
    assert.match(poll, /getSpaceFeedStateFingerprint\(\) !== before\) scheduleSpaceFeedProgressDrivenRefresh\(\)/)
    assert.doesNotMatch(poll, /getSpaceFeedPostEntries|syncSpaceFeedNukeControls/)
})

test('a state reply covers only the round asked about, so it is merged into the copy and the unanswered profiles are asked first', () => {
    const content = readRepoFile('shared/js/content.js')
    const refresh = extractFunction(content, 'async function refreshContentPageCoordinatorStateFromRuntime(options = {})')
    const hrefs = extractFunction(content, 'function getCurrentPageStateProfileHrefs(options = {})')

    assert.match(refresh, /coordinatorQueue = \{\s*\.\.\.dropCoordinatorQueueRowsForProfiles\(coordinatorQueue, profileHrefs\),\s*\.\.\.normalizeCoordinatorQueue\(result\.coordinatorQueue\)\s*\}/)
    assert.doesNotMatch(refresh, /coordinatorQueue = normalizeCoordinatorQueue\(result\.coordinatorQueue\)/)
    assert.match(refresh, /for\(const href of profileHrefs\) delete keptProgress\[href\]/)
    assert.match(refresh, /profileNukeProgress = \{\.\.\.keptProgress, \.\.\.repliedProgress\}/)
    assert.match(refresh, /retrySpaceFeedUnansweredStateLater\(0\)/)
    assert.match(hrefs, /list\.sort\(\(left, right\) => Number\(isSpaceFeedProfileStateReady\(left\)\) - Number\(isSpaceFeedProfileStateReady\(right\)\)\)/)
})

test('scroll and page-change renders are spaced by a minimum gap, and the profile-link scan is reused until the structure changes', () => {
    const content = readRepoFile('shared/js/content.js')
    const schedule = extractFunction(content, 'function scheduleSpaceAssetNukeControls(delay = 180)')
    const cached = extractFunction(content, 'function getSpaceFeedProfileLinkCardEntries(activeKeys = new Set())')
    const invalidate = extractFunction(content, 'function invalidateSpaceFeedEntryCacheForMutations(mutations)')
    const tunables = readRepoFile('shared/js/tunables.js')

    assert.match(schedule, /SPACE_FEED_RENDER_MIN_GAP_MS/)
    assert.match(cached, /Date\.now\(\) - cached\.at < SPACE_FEED_PROFILE_LINK_CARD_CACHE_MS/)
    assert.match(invalidate, /spaceFeedProfileLinkCardCache = null/)
    assert.match(tunables, /SPACE_FEED_RENDER_MIN_GAP_MS: 200/)
    assert.match(tunables, /SPACE_FEED_PROFILE_LINK_CARD_CACHE_MS: 1000/)
})

test('the page-wide render model is reused for a short time, and a structural change clears it', () => {
    const content = readRepoFile('shared/js/content.js')
    const model = extractFunction(content, 'function buildSpaceFeedRenderModel(scannedEntries = [], aggregateEntries = scannedEntries)')
    const invalidate = extractFunction(content, 'function invalidateSpaceFeedEntryCacheForMutations(mutations)')

    assert.match(model, /now - spaceFeedRenderModelMemo\.at < SPACE_FEED_RENDER_MODEL_MEMO_MS/)
    assert.match(invalidate, /spaceFeedRenderModelMemo = null/)
    assert.match(readRepoFile('shared/js/tunables.js'), /SPACE_FEED_RENDER_MODEL_MEMO_MS: 300/)
})

test('the render uses the near posts instead of hit-testing the viewport once the observer has reported', () => {
    const content = readRepoFile('shared/js/content.js')
    const visible = extractFunction(content, 'function getVisibleSpaceFeedTimestamps()')
    const subject = readRepoFile('shared/js/subject.js')

    assert.match(visible, /getSpaceFeedNearObserver\(\) \? \[\] : getViewportSampledSpaceFeedTimestamps\(\)/)
    assert.match(subject, /normalizedProfileHrefMemo\.has\(key\)/)
})

test('the owned nuke status is reused within its TTL, and the render records its own time', () => {
    const content = readRepoFile('shared/js/content.js')
    const stale = extractFunction(content, 'async function refreshOwnedNukeStatusCacheIfStale()')
    const sync = extractFunction(content, 'function syncSpaceFeedNukeControls()')

    assert.match(stale, /Date\.now\(\) - ownedNukeStatusFetchedAt < OWNED_NUKE_STATUS_TTL_MS/)
    assert.match(readRepoFile('shared/js/tunables.js'), /OWNED_NUKE_STATUS_TTL_MS: 2000/)
    assert.match(sync, /recordSpaceMarkPerf\('render', \{entries: entries\.length, coordinatorReady: coordinatorQueueLoaded, ms: Date\.now\(\) - renderStartedAt\}\)/)
})

test('the dashboard throttle note is redrawn every second and shown as a warning while throttled', () => {
    const coordinator = readRepoFile('shared/js/coordinator.js')
    const body = extractFunction(coordinator, 'function refreshThrottleNote()')

    assert.match(coordinator, /setInterval\(refreshThrottleNote, DASHBOARD_THROTTLE_NOTE_REFRESH_MS\)/)
    assert.match(readRepoFile('shared/js/tunables.js'), /DASHBOARD_THROTTLE_NOTE_REFRESH_MS: 1000/)
    assert.match(body, /classList\.toggle\('status-pill--warn', throttled\)/)
})

test('the button decision for each post with candidates is traced for the Info report, and the report includes the trace', () => {
    const content = readRepoFile('shared/js/content.js')
    const sync = extractFunction(content, 'function syncSpaceFeedPostButtons(renderModel)')
    const report = extractFunction(content, 'function formatSpaceFeedStatusDetails(snapshot)')

    assert.match(sync, /recordSpaceFeedButtonTrace\(entry, 'not-near'\)/)
    // A nuked post's button is shown again even if it was hidden while the post had nothing to show.
    assert.match(sync, /doneButton\.style\.display = ''/)
    // Buttons are for the main post card only: a profile link in a post's text gets none, and is not kept active.
    assert.match(sync, /startsWith\('space-profile-link:'\)[\s\S]*?recordSpaceFeedButtonTrace\(entry, 'link-in-body'\)[\s\S]*?continue/)
    assert.match(sync, /recordSpaceFeedButtonTrace\(entry, 'no-controls'\)/)
    assert.match(sync, /recordSpaceFeedButtonTrace\(entry, 'no-host'\)/)
    assert.match(content, /const SPACE_FEED_BUTTON_TRACE_LIMIT = 40/)
    assert.match(report, /formatSpaceFeedButtonTrace\(\)/)
    assert.match(report, /formatSpaceQueryStats\(\)/)
    assert.match(content, /timedSpaceQuery\('linkFullScan'/)
})

test('the profile-link scan reads a set kept from the page changes, and searches the whole feed only at the full-scan interval', () => {
    const content = readRepoFile('shared/js/content.js')
    const compute = extractFunction(content, 'function computeSpaceFeedProfileLinkCardEntries(activeKeys = new Set())')
    const order = extractFunction(content, 'function getSpaceFeedProfileLinksInDomOrder(contentRoot)')
    const note = extractFunction(content, 'function noteSpaceFeedProfileLinkMutations(mutations = [])')
    const invalidate = extractFunction(content, 'function invalidateSpaceFeedEntryCacheForMutations(mutations)')

    assert.match(compute, /for\(const link of getSpaceFeedProfileLinksInDomOrder\(contentRoot\)\)/)
    assert.doesNotMatch(compute, /querySelectorAll/)
    assert.match(order, /Date\.now\(\) - spaceFeedProfileLinkSetScannedAt >= SPACE_FEED_PROFILE_LINK_FULL_SCAN_MS/)
    assert.match(order, /contentRoot\.querySelectorAll\('a\[href\*="\/profile\/"\]'\)/)
    assert.match(order, /compareDocumentPosition\(right\) & Node\.DOCUMENT_POSITION_FOLLOWING/)
    assert.match(order, /!link\.isConnected \|\| !contentRoot\.contains\(link\)/)
    assert.match(note, /spaceFeedProfileLinkSet\.add\(node\)/)
    // The page's changes reach the set before the early return for an empty post cache.
    assert.ok(invalidate.indexOf('noteSpaceFeedProfileLinkMutations(mutations)') < invalidate.indexOf('if(!spaceFeedEntryCache.size) return'))
    assert.match(readRepoFile('shared/js/tunables.js'), /SPACE_FEED_PROFILE_LINK_FULL_SCAN_MS: 10000/)
})

test('the redraw reads its post hosts from the list it keeps, and the walk up from a post stops at the first parent holding several', () => {
    const content = readRepoFile('shared/js/content.js')
    const state = extractFunction(content, "function getSpaceFeedRootCandidateState(node, timestamp)")
    const rootFor = extractFunction(content, 'function getSpaceFeedCardRootForTimestamp(timestamp, root = getSpaceFeedContentRoot())')
    const hosts = extractFunction(content, 'function getSpaceFeedPostHostsInDocument()')
    const queueing = extractFunction(content, 'function getSpaceFeedQueueingButtons()')

    assert.match(state, /if\(timestamps\.length > 1\) return 'crowded'/)
    assert.match(rootFor, /if\(state === 'crowded'\) break/)
    assert.match(hosts, /if\(!host\.isConnected\) spaceFeedPostHostSet\.delete\(host\)/)
    assert.doesNotMatch(queueing, /document\.querySelectorAll\('\.mb-ext_space-feed-post-nuke-host/)
    assert.match(content, /spaceFeedPostHostSet\.add\(host\)/)
    assert.doesNotMatch(content, /timedSpaceQuery\('documentHostScan'/)
    assert.doesNotMatch(content, /timedSpaceQuery\('documentHosts'/)
    // The feed's content root is reused for a short time, not worked out on every scan.
    assert.match(content, /Date\.now\(\) - memo\.at < SPACE_FEED_CONTENT_ROOT_MEMO_MS/)
    assert.match(readRepoFile('shared/js/tunables.js'), /SPACE_FEED_CONTENT_ROOT_MEMO_MS: 2000/)
    // The marked posts are read from the list the page keeps, not searched for across the whole page.
    assert.doesNotMatch(content, /documentPostKeys/)
    assert.match(content, /const spaceFeedMarkedRoots = new Set\(\)/)
})

test('the page progress bar and the dashboard footer bar are both built by the one shared function', () => {
    const content = readRepoFile('shared/js/content.js')
    const coordinator = readRepoFile('shared/js/coordinator.js')
    const shared = readRepoFile('shared/js/queueProgressBar.js')
    const html = readRepoFile('shared/coordinator.html')

    assert.match(shared, /function createQueueProgressBar\(options = \{\}\)/)
    assert.match(content, /const \{ createQueueProgressBar \} = require\('\.\/queueProgressBar'\)/)
    assert.match(content, /const \{ bar \} = createQueueProgressBar\(\{/)
    assert.match(coordinator, /const \{createQueueProgressBar\} = require\('\.\/queueProgressBar'\)/)
    assert.match(coordinator, /dashboardBottomBarProgress = createQueueProgressBar\(\{/)
    // No second copy of the bar's markup is left in the dashboard page.
    assert.doesNotMatch(html, /dashboard-bottom-bar/)
})

test('a post the observer has not seen yet is always read, so a new or re-mounted post on screen gets scanned and drawn', () => {
    const content = readRepoFile('shared/js/content.js')
    const bounded = extractFunction(content, 'function getBoundedVisibleSpaceFeedTimestamps()')
    const scan = extractFunction(content, 'function getSpaceFeedPostEntries()')

    // Every post is measured; the position test decides, not the observer's report.
    assert.doesNotMatch(bounded, /spaceFeedObservedRoots\.has\(root\)/)
    const nearCheck = extractFunction(content, 'function isSpaceFeedPostRootNear(postRoot)')
    assert.match(nearCheck, /isSpaceFeedTimestampInScanWindow\(null, rect\)/)
    assert.doesNotMatch(nearCheck, /spaceFeedNearPostRoots\.has/)
    assert.match(scan, /spaceFeedObservedRoots\.add\(postRoot\)/)
    assert.match(scan, /if\(newlyObservedRoots && getPageType\(\) === 'space'\) scheduleSpaceAssetNukeControls\(120\)/)
    assert.match(content, /const spaceFeedObservedRoots = new WeakSet\(\)/)
})

test('a redraw reuses the last feed scan unless the structure changed, the view moved past the band, or the scan is old', () => {
    const content = readRepoFile('shared/js/content.js')
    const forRender = extractFunction(content, 'function getSpaceFeedPostEntriesForRender()')
    const band = extractFunction(content, 'function isSpaceFeedScrollWithinBand(movedPx)')
    const invalidate = extractFunction(content, 'function invalidateSpaceFeedEntryCacheForMutations(mutations)')
    const sync = extractFunction(content, 'function syncSpaceFeedNukeControls()')

    assert.match(forRender, /reuse\.version === spaceFeedStructureVersion/)
    assert.match(forRender, /Date\.now\(\) - reuse\.at < SPACE_FEED_SCAN_REUSE_MS/)
    assert.match(forRender, /isSpaceFeedScrollWithinBand\(scrollY - reuse\.scrollY\)/)
    assert.match(forRender, /reuse\.root === contentRoot/)
    assert.match(band, /movedPx < SPACE_FEED_SCAN_BAND_DOWN_PX/)
    assert.match(band, /-movedPx < SPACE_FEED_SCAN_BAND_UP_PX/)
    assert.match(invalidate, /spaceFeedStructureVersion \+= 1/)
    assert.match(sync, /const scannedEntries = timedSpaceQuery\('phase\.scan', \(\) => getSpaceFeedPostEntriesForRender\(\)\)/)
    assert.match(readRepoFile('shared/js/tunables.js'), /SPACE_FEED_SCAN_REUSE_MS: 10000/)
    assert.match(readRepoFile('shared/js/tunables.js'), /SPACE_FEED_SCAN_BAND_DOWN_PX: 1000/)
    assert.match(readRepoFile('shared/js/tunables.js'), /SPACE_FEED_SCAN_BAND_UP_PX: 200/)
})

test('only the posts in the current scan are read for position; the rest keep their last reading', () => {
    const content = readRepoFile('shared/js/content.js')
    const latest = extractFunction(content, 'function setLatestSpaceFeedEntries(entries)')

    assert.match(latest, /const scannedRoots = new Set\(/)
    assert.match(latest, /scannedRoots\.has\(entry\?\.postRoot\)\s*\n\s*\? readSpaceFeedEntryViewport\(entry\?\.postRoot, entry\)/)
    assert.match(latest, /prior\?\.viewportTop \?\? entry\?\.viewportTop \?\? null/)
})

test('the profile-dialog search runs only when a dialog may have opened or one is already open', () => {
    const content = readRepoFile('shared/js/content.js')
    const gate = extractFunction(content, 'function mutationsMayInvolveDialog(mutations = [])')

    assert.match(gate, /node\.querySelector\?\.\('\[role="dialog"\], \[aria-modal="true"\]'\)/)
    assert.match(content, /const dialogMayBeOpen = mutationsMayInvolveDialog\(mutations\) \|\| !!activeProfileModal\?\.isConnected/)
    assert.match(content, /const activeModal = dialogMayBeOpen \? getProfilePeopleModal\(\) : null/)
    assert.match(content, /let modal = dialogMayBeOpen \? document\.querySelector/)
})

test('each post button names the post place in the feed, and the redraws after a state answer and the owned-status wait are bounded', () => {
    const content = readRepoFile('shared/js/content.js')
    const sync = extractFunction(content, 'function syncSpaceFeedPostButtons(renderModel)')
    const ordinals = extractFunction(content, 'function getSpaceFeedPostOrdinals()')
    const refresh = extractFunction(content, 'async function refreshContentPageCoordinatorStateFromRuntime(options = {})')
    const timer = extractFunction(content, 'function scheduleSpaceAssetNukeControls(delay = 180)')

    assert.match(ordinals, /startsWith\('space-profile-link:'\)/)
    assert.match(sync, /const postOrdinals = getSpaceFeedPostOrdinals\(\)/)
    assert.match(sync, /const postLabel = formatSpaceFeedPostOrdinalPrefix\(postOrdinals, entry\.postKey\)/)
    assert.match(sync, /setMuteBlockHelp\(singleButton, postLabel \+ \(hasResolver/)
    assert.match(sync, /setMuteBlockHelp\(queueButton, postLabel \+ \(aggregateCount > 0/)
    assert.match(content, /function formatSpaceFeedPostOrdinalPrefix[\s\S]*`Post \$\{ordinal\} of \$\{postOrdinals\.total\}: `/)
    // The answer to a state request is drawn through the render timer, not straight away.
    assert.doesNotMatch(refresh, /\n\s+syncSpaceFeedNukeControls\(\)\n\s+\}\n\s+return true/)
    assert.match(refresh, /scheduleSpaceAssetNukeControls\(0\)/)
    // The owned status is waited for only up to the tunable cap.
    assert.match(timer, /Promise\.race\(\[ownedStatusRefresh, sleep\(OWNED_NUKE_STATUS_WAIT_MS\)\]\)/)
    assert.match(readRepoFile('shared/js/tunables.js'), /OWNED_NUKE_STATUS_WAIT_MS: 150/)
})

test('the dashboard flight recorder card is dev mode only, collapsed by default, and polls only while open, asking for new events', () => {
    const coordinator = readRepoFile('shared/js/coordinator.js')
    const html = readRepoFile('shared/coordinator.html')
    const sync = extractFunction(coordinator, 'function syncFlightRecorderPollTimer()')
    const refresh = extractFunction(coordinator, 'async function refreshFlightRecorderCard()')

    // The card sits after the Runs card and inherits the dev mode gate.
    const runsAt = html.indexOf('id="runList"')
    const cardAt = html.indexOf('id="flightRecorderList"')
    assert.ok(cardAt > runsAt, 'the card comes after the Runs card')
    assert.match(html, /data-panel-scroll-target="flightRecorderList" data-dev-mode-panel hidden/)
    assert.match(html, /id="flightRecorderList" hidden><\/div>/)
    assert.match(html, /aria-expanded="false" aria-controls="flightRecorderList"/)

    const tunables = readRepoFile('shared/js/tunables.js')
    assert.match(tunables, /FLIGHT_RECORDER_CARD_POLL_MS: 1000/)
    assert.match(coordinator, /FLIGHT_RECORDER_CARD_POLL_MS/)
    assert.match(sync, /isDevModeStoredEnabled\(\) && isFlightRecorderCardExpanded\(\)/)
    assert.match(sync, /setInterval\(\(\) => \{ void refreshFlightRecorderCard\(\) \}, FLIGHT_RECORDER_CARD_POLL_MS\)/)
    assert.match(sync, /clearInterval\(flightRecorderPollTimer\)/)
    assert.match(refresh, /sinceSeq: flightRecorderLastSeq/)
    assert.match(refresh, /if\(!isDevModeStoredEnabled\(\) \|\| !isFlightRecorderCardExpanded\(\)\) return/)
    assert.match(coordinator, /function applyDevModeVisibility[\s\S]*syncFlightRecorderPollTimer\(\)/)
    assert.match(coordinator, /if\(targetId === 'flightRecorderList'\) syncFlightRecorderPollTimer\(\)/)
})

test('the queue bar asks the worker again on a timer, so its tab stays subscribed after a worker restart', () => {
    const content = readRepoFile('shared/js/content.js')
    const init = extractFunction(content, 'function initContentProgressBar()')

    assert.match(readRepoFile('shared/js/tunables.js'), /CONTENT_PROGRESS_BAR_POLL_MS: 3000/)
    assert.match(init, /setInterval\(\(\) => \{\n\s+void refreshContentProgressBar\(\)\n\s+\}, CONTENT_PROGRESS_BAR_POLL_MS\)/)
})

test('the render scan reuses per-link and per-post results, and an expanded post is read again', () => {
    const content = readRepoFile('shared/js/content.js')
    const linkRoot = extractFunction(content, 'function getSpaceFeedProfileLinkCardRoot(link)')
    const expand = extractFunction(content, 'function expandCollapsedSpaceFeedPosts(entries = [], options = {})')

    assert.match(linkRoot, /spaceFeedProfileLinkRootCache\.get\(link\)/)
    assert.match(linkRoot, /cached\.href === href/)
    assert.match(expand, /spaceFeedEntryCache\.delete\(entry\.postKey\)/)
})

test('a collapsed post with no candidate is expanded once by a click on its body, never on a link or button', () => {
    const content = readRepoFile('shared/js/content.js')
    const body = extractFunction(content, 'function expandCollapsedSpaceFeedPosts(entries = [], options = {})')

    assert.match(body, /spaceFeedExpandedPostKeys\.has\(entry\.postKey\)/)
    assert.match(body, /target\.click\(\)/)
    assert.match(body, /options\.nearOnly !== false/)
    const topHandler = content.slice(content.indexOf("'space-feed-top', async event"), content.indexOf("'space-feed-top', async event") + 1600)
    assert.match(topHandler, /expandCollapsedSpaceFeedPosts\(getSpaceFeedPostEntries\(\), \{nearOnly: false, limit: 25\}\)/)
    assert.ok(topHandler.indexOf('setTimeout(resolve, 1500)') !== -1)
    assert.ok(topHandler.indexOf('setTimeout(resolve, 1500)') < topHandler.indexOf('syncSpaceFeedNukeControls()'))
    assert.match(body, /findSpaceFeedPostBodyElement\(entry\.postRoot\)/)
    const bodyFinder = extractFunction(content, 'function findSpaceFeedPostBodyElement(postRoot)')
    assert.match(bodyFinder, /elementFromPoint/)
    assert.match(bodyFinder, /closest\('a, button, \[role="button"\], \.mb-ext_space-feed-post-nuke-host'\)/)
    assert.match(bodyFinder, /header\.contains\(element\)/)
    assert.match(content, /const scannedEntries = timedSpaceQuery\('phase\.scan', \(\) => getSpaceFeedPostEntriesForRender\(\)\)\n    timedSpaceQuery\('phase\.expand', \(\) => expandCollapsedSpaceFeedPosts\(scannedEntries\)\)/)
})

test('a post with errors and nothing to queue shows a white Bad Links button, after Nuked, red and Nuking', () => {
    const content = readRepoFile('shared/js/content.js')
    const css = readRepoFile('shared/css/content.css')

    assert.match(content, /else if\(hasBadLinks\) \{\n\s+setNukeButtonBadLinks\(singleButton\)/)
    assert.match(content, /const shouldShowControls = postNuked \|\| aggregateCount > 0 \|\| hasCandidates \|\| postBusy \|\| hasBadLinks/)
    assert.match(css, /\.mb-ext_nuke-profiles-btn--bad-links \{|--bad-links,\n/)
    assert.ok(content.indexOf('else if(postBusy) {') < content.indexOf('else if(hasBadLinks) {'))
})


test('a blocked queued tab asks the worker to close it before releasing its slot, so the close is not refused as stale', () => {
    const source = readRepoFile('shared/js/content.js')
    const start = source.indexOf('const closeQueuedBlockedTab = async (patch = {}) => {')
    const end = source.indexOf('const skipQueuedUnavailableTab = async message => {', start)
    assert.notEqual(start, -1)
    assert.notEqual(end, -1)
    const body = source.slice(start, end)

    assert.ok(body.indexOf('await requestCloseTab()') !== -1)
    assert.ok(body.indexOf('await requestCloseTab()') < body.indexOf('await releaseQueuedTabSlot()'))
})

test('the busy count is the distinct queued profiles, counted once across posts, plus a post still being read', () => {
    const {harness} = loadProfileStateHarness()

    assert.equal(harness.pendingCount([
        {postKey: 'post-a', activePendingUrls: [ALICE], candidateUrls: [ALICE, BOB]},
        {postKey: 'post-b', activePendingUrls: [ALICE], candidateUrls: [ALICE]},
        {postKey: 'post-c', activePendingUrls: [], candidateUrls: [CAROL]},
        {postKey: 'post-d', activePendingUrls: [], candidateUrls: [], resolverPending: true}
    ], new Set([BOB])), 3)
    assert.equal(harness.pendingCount([], new Set()), 0)
})

test('the count is the unique profiles still to be queued, so a profile linked from two red posts counts once', () => {
    const {harness} = loadProfileStateHarness()

    assert.equal(harness.count([
        {postKey: 'post-a', candidateUrls: [ALICE, BOB]},
        {postKey: 'post-b', candidateUrls: [ALICE]},
        {postKey: 'post-c', candidateUrls: [CAROL]}
    ]), 3)
    assert.equal(harness.count([]), 0)
})

test('the nuke run counts already-nuked profiles, not posts, and a profile linked from several posts counts once (25 Oct)', () => {
    const content = readRepoFile('shared/js/content.js')
    const body = extractFunction(content, 'async function nukeSpaceFeedEntries(button, entries)')

    assert.match(body, /const alreadyNukedProfiles = new Set\(\)/)
    assert.match(body, /const nukedProfiles = candidateProfiles\.filter\(url => isKnownNukedSpaceFeedProfile\(url\)\)/)
    assert.match(body, /for\(const url of nukedProfiles\) alreadyNukedProfiles\.add\(url\)/)
    assert.match(body, /alreadyNuked: alreadyNukedProfiles\.size/)
    assert.doesNotMatch(body, /alreadyNukedCount/)
})
