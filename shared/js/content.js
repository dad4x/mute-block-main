const MUTE_BLOCK_CONTENT_SCRIPT_VERSION = (() => {
    try {
        return `${globalThis.chrome?.runtime?.getManifest?.()?.version || ''}`.trim()
    }
    catch {
        return ''
    }
})()

try {
    document.documentElement?.setAttribute('data-mb-content-script-ready', MUTE_BLOCK_CONTENT_SCRIPT_VERSION || 'unknown')
}
catch {}

const browser = require('webextension-polyfill')
const defaults = require('./defaults')
const { createQueueProgressBar } = require('./queueProgressBar')
const { setMuteBlockHelp } = require('./muteBlockHelp')
const { QUEUE_BAR_GET_ACTION, QUEUE_BAR_PUSH_ACTION, getQueueBarDisplay } = require('./swQueueBarSummary')
const { PROFILE_NUKE_PROGRESS_PUSH_ACTION } = require('./swProfileNukeProgressPush')
const {
    MAX_REMEMBERED_NUKED_POSTS_KEY,
    NUKED_POST_RETENTION_DAYS_KEY
} = require('./nukedPosts')
const {
    SPACE_CATEGORIES,
    SPACE_REGISTRY_KEY,
    buildSpaceRecord,
    extractSpaceSlug,
    getDocumentCanonicalUrl,
    getSpaceCategoryLongLabel,
    getSpaceName,
    normalizeSpaceCategory,
    normalizeSpaceCollectCount,
    normalizeSpaceUrl,
    withSpaceRecordCollectCount
} = require('./spaceRegistry')
const {
    QUORA_NON_PROFILE_ROOT_PATHS,
    isLikelyExplicitProfileTargetHref,
    isLikelyExplicitProfileTargetSlug,
    normalizeQuoraProfileHref,
    sanitizeProfileHrefSlug,
    storedProfileHref
} = require('./subject')
const {
    mapProgressToCoordinatorState,
    TRANSIENT_PROGRESS_STATUSES,
    UNBLOCK_UNMUTE_ACTION_KIND
} = require('./jobState')
const {
    COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY,
    COORDINATOR_PAUSED_KEY,
    COORDINATOR_QUEUE_VIEW_KEY
} = require('./storageKeys')
const {namespaceArea, namespaceChanges} = require('./storageNamespace')
const {MAX_PROFILE_NUKE_PROGRESS_ENTRIES, CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES, PROFILE_MENU_POLL_INTERVAL_MS, SPACE_FEED_STATE_RETRY_MS, CONTENT_PROGRESS_BAR_POLL_MS, SPACE_FEED_STATE_POLL_MS, OWNED_NUKE_STATUS_TTL_MS, OWNED_NUKE_STATUS_WAIT_MS, SPACE_FEED_RENDER_MIN_GAP_MS, SPACE_FEED_PROFILE_LINK_CARD_CACHE_MS, SPACE_FEED_PROFILE_LINK_FULL_SCAN_MS, SPACE_FEED_CONTENT_ROOT_MEMO_MS, SPACE_FEED_SCAN_REUSE_MS, SPACE_FEED_SCAN_BAND_DOWN_PX, SPACE_FEED_SCAN_BAND_UP_PX, SPACE_FEED_RENDER_MODEL_MEMO_MS} = require('./tunables')
const {PROFILE_SEARCH_COLLECT_LIMIT, PROFILE_SEARCH_COLLECT_CHOICES, COLLECT_SCROLL_PASS_WAIT_MS, COLLECT_END_CONFIRM_MS, MODAL_PROFILE_NUKE_SCROLL_WAIT_MS, COLLECT_STALLED_TIMEOUT_MS, COLLECT_STOP_LABEL_TICK_MS, CANDIDATE_BATCH_PROFILES_PER_BATCH} = require('./tunables')
const {
    WAIT_FOR_ACTION_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_ACTION_DEFAULT_INTERVAL_MS,
    WAIT_FOR_CONDITION_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_CONDITION_DEFAULT_INTERVAL_MS,
    WAIT_FOR_CONDITION_OR_DOM_MUTATION_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_CONDITION_OR_DOM_MUTATION_DEFAULT_INTERVAL_MS,
    WAIT_FOR_MENU_STATE_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_MENU_STATE_DEFAULT_INTERVAL_MS,
    READ_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS,
    READ_PROFILE_MENU_STATE_DEFAULT_INTERVAL_MS,
    WAIT_FOR_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_PROFILE_MENU_STATE_DEFAULT_INTERVAL_MS,
    ENSURE_PROFILE_MENU_OPEN_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_VERIFIED_PROFILE_UNBLOCKED_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_VERIFIED_PROFILE_UNBLOCKED_DEFAULT_INTERVAL_MS,
    WAIT_FOR_VERIFIED_PROFILE_BLOCKED_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_VERIFIED_PROFILE_BLOCKED_DEFAULT_INTERVAL_MS,
    WAIT_FOR_PROFILE_RECORD_BLOCKED_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_PROFILE_RECORD_BLOCKED_DEFAULT_INTERVAL_MS,
    WAIT_FOR_PROFILE_ACTION_READY_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_CANONICAL_PROFILE_ACTION_ROUTE_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_TIMEOUT_MS,
    WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_INTERVAL_MS,
    CLOSE_PROFILE_MENU_DEFAULT_TIMEOUT_MS,
    SAFE_SEND_RUNTIME_MESSAGE_DEFAULT_TIMEOUT_MS,
    SPACE_FEED_ENQUEUE_MESSAGE_TIMEOUT_MS,
    SPACE_FEED_ENQUEUE_SUMMARY_POLL_TIMEOUT_MS,
    SPACE_FEED_ENQUEUE_SUMMARY_POLL_INTERVAL_MS,
    SPACE_FEED_ENQUEUE_CHUNK_MAX_ATTEMPTS,
    SPACE_FEED_ENQUEUE_CHUNK_RETRY_BASE_DELAY_MS,
    PROFILE_SEARCH_ENQUEUE_CONFIRM_TIMEOUT_MS,
    PROFILE_SEARCH_ENQUEUE_CONFIRM_INTERVAL_MS
} = require('./timeouts')
const {
    COORDINATOR_ENQUEUE_CHUNK_SIZE
} = require('./coordinatorEnqueueChunking')
const {createEnqueueMarkStore} = require('./candidateMarks')
const {formatCollectStopLabel, STOP_COLLECT_LABEL_TEXT} = require('./candidateCollect')
const {collectPassMadeProgress, runCollectLoop} = require('./candidateCollect')
const {runBatchNuke} = require('./candidateNuke')
const {NOTHING_QUEUED_LABEL, NUKED_LABEL, formatToolbarNukingStatus, formatProfileRowState} = require('./candidateStatus')
const {nukingControlView, nukingStatusShowsControl, spaceFeedNukingToolbar} = require('./nukingControl')
const {normalizeResolutionSubject, RESOLUTION_SUBJECT_NAMED_PROFILES, RESOLUTION_SUBJECT_POSTER} = require('./profileResolutionSubject')

const MODAL_PROFILE_NUKE_PROFILES_PER_BATCH = 3
const CONTENT_SCRIPT_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS = 2500
const QUEUED_TERMINAL_PROGRESS_MESSAGE_TIMEOUT_MS = 5000
const QUEUED_TERMINAL_PROGRESS_MESSAGE_ATTEMPTS = 3
const QUEUED_TERMINAL_PROGRESS_RETRY_DELAY_MS = 250
const QUEUED_ACTION_CLAIM_MESSAGE_TIMEOUT_MS = 6000
const QUEUED_ACTION_CLAIM_FAST_RETRY_DELAY_MS = 500
const QUEUED_ACTION_CLAIM_SLOW_RETRY_DELAY_MS = 5000
const QUEUED_ACTION_CLAIM_FAST_ATTEMPTS = 6
const QUEUED_ACTION_CLAIM_RESCUE_INTERVAL_MS = 2000
const QUORA_RUNTIME_READY_ANNOUNCE_DELAYS_MS = [0, 1000, 5000, 15000]
const QUEUED_PROFILE_RESOLUTION_MESSAGE_TIMEOUT_MS = 5000
const QUEUED_PROFILE_RESOLUTION_MESSAGE_ATTEMPTS = 3
const QUEUED_PROFILE_RESOLUTION_RETRY_DELAY_MS = 350
const QUEUED_ACTION_HEARTBEAT_MS = 5000
const CONTENT_PAGE_STATE_REFRESH_MIN_INTERVAL_MS = 1000
const PROFILE_SEARCH_PENDING_REFRESH_MS = 2000
const HIDDEN_PROFILE_READY_FAST_PROBE_MS = 3500
const HIDDEN_PROFILE_READY_NO_FOREGROUND_MS = 12000
const VISIBLE_PROFILE_READY_MS = 25000
const SERVICE_WORKER_QUEUE_OWNER_ID = 'service-worker-queue-owner'
// A host page re-render (or, previously, our own remove-then-recreate of a
// managed button whose insertion target's parent got replaced) can satisfy
// shouldRefreshProfileButtons' mutation check again immediately after a
// refresh runs, scheduling another refresh forever -- this observably
// flashed the injected buttons/native menu indefinitely on a live profile
// page with no coordinator work in flight. This caps how many refreshes a
// single profile visit gets in a short window before giving up until the
// next genuinely new mutation window or a profile-key change.
const PROFILE_BUTTONS_REFRESH_BURST_LIMIT = 6
const PROFILE_BUTTONS_REFRESH_BURST_WINDOW_MS = 3000

let profilesModalTimeout
let profileButtonsTimeout
let profileButtonsRefreshTimeout
let profileButtonsPending = false
let profileActionInProgress = false
let profileButtonsFollowUpTimeouts = []
let profileButtonsRefreshBurstCount = 0
let profileButtonsRefreshBurstStartedAt = 0
let profileButtonRail = null
let profileButtonRailResizeHooked = false
let contentProgressBarEl = null
let contentProgressBarStorageListenerInstalled = false
let autoProfileAction = undefined
let autoProfileActionPending = false
let autoProfileActionClaimPending = false
let autoProfileActionRescueTimeout = null
let autoProfileActionAttempts = 0
let activeQueuedAttemptId = ''
let activeQueuedAttemptNumber = 0
let activeQueuedAttemptProfileHref = ''
let activeQueuedNoForegroundFallback = false
let activeQueuedActionSurfaceMode = ''

// Hold for a claim pushed while work is busy (review-2 C-2, owner decision 2026-10-14: hold on the content side). The push is
// held here, not run on top of that work, and runs when that work ends. Rules:
//   - a repeat of the attempt already running is answered accepted, with nothing held;
//   - a push while this tab is finishing is declined, so the worker retries it and a retry after this work ends is accepted;
//   - a held push is dropped if the tab is finishing when the work ends; the worker's stale-claim check then requeues the row
//     (QUEUED_TAB_UNCONFIRMED_ACTIVE_RECONCILE_MS);
//   - a second push while busy replaces the first held one. The worker already counted the first as accepted, so the stale-claim
//     check recovers it;
//   - the tab's own claim answering with an action supersedes a push held during that claim.
let heldQueuedClaim = null
// Set when this tab's queued work is finishing: a close was requested, or the tab is kept open to retry a terminal record.
// Reset when the next action starts. It only blocks a claim that arrives while busy, so a tab whose close failed still takes
// new work once its current action ends.
let queuedTabFinishing = false

function markQueuedTabFinishing() {
    queuedTabFinishing = true
}

// Answers a claim pushed by the worker (claim-current-profile-tab-action). Busy means an action is running or this tab is
// waiting for its own claim.
async function acceptQueuedProfileActionClaim(request = {}) {
    if(!request.queuedAction) {
        await refreshCoordinatorQueueFromRuntime().catch(() => null)
    }
    const nextProfileAction = request.queuedAction && typeof request.queuedAction === 'object'
        ? request.queuedAction
        : undefined
    if(getPageType() !== 'profile' && !canResolveQueuedProfileFromCurrentPage(nextProfileAction || {})) {
        return {accepted: false, reason: 'not-profile'}
    }
    if(autoProfileActionPending || autoProfileActionClaimPending) {
        const requestedAttemptId = `${nextProfileAction?.attemptId || ''}`.trim()
        if(requestedAttemptId && requestedAttemptId === activeQueuedAttemptId) {
            return {accepted: true, reason: 'already-running'}
        }
        if(queuedTabFinishing) return {accepted: false, reason: 'tab-finishing'}
        heldQueuedClaim = {action: nextProfileAction}
        return {accepted: true, reason: 'held-while-busy'}
    }
    autoProfileAction = nextProfileAction
    autoProfileActionAttempts = 0
    void maybeRecordAlreadyBlockedCoordinatorProfile()
    void maybeRunAutoProfileAction()
    scheduleCurrentProfilePendingClaimRescue(500)
    return {accepted: true, reason: request.reason || ''}
}

// Runs the claim held while work ran, if this tab is still open and not finishing. Returns true when it took over the tab.
function releaseHeldQueuedProfileActionClaim() {
    const held = heldQueuedClaim
    heldQueuedClaim = null
    if(!held) return false
    if(queuedTabFinishing) {
        console.info('Held queued claim dropped: this tab is finishing')
        return false
    }
    autoProfileAction = held.action
    autoProfileActionAttempts = 0
    void maybeRunAutoProfileAction()
    return true
}
let profileBlockMutationCount = 0
let profileBlockHintKey = null
let profileBlockHintAt = 0
let profileUnblockedHintKey = null
let profileUnblockedHintAt = 0
let originalPosterRedirectPending = false
let originalPosterRedirectAttempts = 0
let originalPosterRedirectTimeout = null
let questionPageBtnTimeout
let questionPageBtnPending = false
let questionPageFollowUpTimeouts = []
let spacePostBtnTimeout
let spacePostBtnPending = false
let spacePostFollowUpTimeouts = []
let profileSearchControlsTimeout
let profileSearchControlsPending = false
let profileSearchCollecting = false
let profileSearchCollectStopRequested = false
// The run's counters for the Stop collecting label: its start time, passes through the loop, and the count collected since the press.
let profileSearchCollectProgress = {startedAt: 0, passes: 0, collected: 0, target: 0}
// The Considered line under the Collect N More button (owner, 27 Oct). Set when a collect run ends, cleared when the next run starts. It is kept
// in memory, so a toolbar rebuilt by a sync gets the same line back.
let profileSearchConsideredText = ''
// The cause line under it: why the last run ended (owner, 27 Oct). Cleared with the line at run start.
let profileSearchConsideredCause = ''
let profileSearchStopLabelTimer = 0
let profileSearchCollectionKey = ''
// The Collect N More count, for this search page only. It is kept in memory: it is not saved, and it resets when the search changes or the page reloads.
let profileSearchCollectLimit = PROFILE_SEARCH_COLLECT_LIMIT
let profileSearchStagedHrefs = []
let profileSearchStagedHrefSet = new Set()
let profileSearchCollectCursorScrollY = 0
// Follow buttons a collect pass has already handled. A later pass skips them before any layout read, so a pass costs the new tail of the page, not all of it (owner, 21 Oct).
let profileSearchProcessedFollowButtons = new WeakSet()
let profileSearchCollectCursorHref = ''
let profileSearchFollowUpTimeouts = []
let profileSearchPendingRefreshTimeout = null
let profileSearchLastRunId = ''
let profileSearchLastQueuedAt = 0
// True while the search batch's enqueue is in flight. The batch button keeps its Queueing label until then.
let profileSearchQueueingBatch = false
// In-memory marks of the batches the search page has just sent to the queue (owner, 26 Oct: as the space page's marks). Keyed by profile href.
// Never stored: a reload clears them, and the worker's rows take over. See profileSearchEnqueueMarkItems.
const profileSearchEnqueueMarks = createEnqueueMarkStore({keyOf: profileSearchEnqueueMarkKeyOf, matchOf: profileSearchEnqueueMarkMatchOf})
let profileSearchLastQueuedCount = 0
let spacePageFollowUpTimeouts = []
let spaceClassificationTimeout
let spaceClassificationPending = false
let spaceAssetNukeTimeout
let spaceAssetNukePending = false
let spaceAssetNukeScheduledAt = 0
let spaceAssetNukeViewportTimeout = null
let spaceAssetNukeViewportListenerInstalled = false
let spaceFeedProgressReconcileTimeout = null
let spaceFeedProgressReconcilePending = false
let suppressSpaceAssetNukeRefreshUntil = 0
let spaceFeedScrollActiveUntil = 0
let latestSpaceFeedEntries = []
// Space pages: the Collect N More count (in memory, for this space page only) and the run state of its collect.
let spaceFeedCollectLimit = PROFILE_SEARCH_COLLECT_LIMIT
let spaceFeedCollectKey = ''
let spaceFeedCollecting = false
let spaceFeedCollectStopRequested = false
// The run's counters for the Stop collecting label: its start time, passes through the loop, and the count collected since the press.
let spaceFeedCollectProgress = {startedAt: 0, passes: 0, collected: 0, target: 0}
let spaceFeedStopLabelTimer = 0
let discoveredSpaceFeedEntries = new Map()
let spaceFeedEntryCache = new Map()
let spaceFeedRootCache = new WeakMap()
let closeTabRetryTimeouts = []
let blockedCloseCheckTimeouts = []
let currentUrl = location.href
let settings = {...defaults}
let spaceRegistry = {}
// True once the registry has been read from storage for this content script (29 Oct).
let spaceRegistryLoaded = false
let profileNukeProgress = {}
let coordinatorQueue = {}
let coordinatorQueueLoaded = false
let cloudflareChallengeReported = false
let contentPageStateRefreshPromise = null
let contentPageStateRefreshAt = 0
let spaceFeedScopedStateRefreshPromise = null
let spaceFeedScopedStateRefreshActiveSignature = ''
let spaceFeedScopedStateRefreshQueuedEntries = null
let spaceFeedScopedStateRefreshQueuedSignature = ''
let spaceFeedScopedStateSignature = ''
let storageChangeListenerInstalled = false
let spaceFeedNukingPostKeys = new Set()
// In-memory marks of the batches this page has just sent to the queue (see spaceFeedEnqueueMarkItems). Never stored.
const spaceFeedEnqueueMarks = createEnqueueMarkStore({keyOf: spaceFeedEnqueueMarkKeyOf, matchOf: spaceFeedEnqueueMarkMatchOf, onChange: touchSpaceFeedEnqueueMarks})
let activeSpaceFeedNukeMode = ''
let activeSpaceFeedNukeRunId = ''
let activeSpaceFeedNukeSpaceKey = ''
let profileDisplayNamesByHref = {}
let ownedNukeStatusCache = {
    active: 0,
    owned: 0,
    queued: 0,
    paused: false
}
let ownedNukeStatusPromise = null
let activeProfileModal = null
let handledModalProfileUrls = new Set()
let queuedModalNukeProfileUrls = new Set()
let initialized = false
// The Nuking drop-down's state (28 Oct). Declared here, above the synchronous init call at the end of the load, so no path can reach it early.
let nukingQueuePaused = false
// A drop-down is keyed by the element it sits beside: a working Nuking button, or the toolbar status when it shows nuking.
const nukingControlByAnchor = new WeakMap()
const nukingControlAnchors = new Set()
let nukingControlDocumentListenerInstalled = false
let alreadyBlockedCoordinatorReconcileKey = ''
let manualUnblockedReconcileKey = ''
const PROFILE_ACTION_BUTTON_ORDER = ['unblock-unmute', 'mute-block-close', 'mute-block', 'close-tab']
const SPACE_POST_NUKE_MIN_PROFILES = 2
const SPACE_FEED_POST_NUKE_MIN_PROFILES = 1
const QUEUED_PROFILE_RESOLUTION_MODE = 'author-profile'
const SPACE_FEED_CANDIDATE_CONFIDENCE_HIGH = 'high'
const SPACE_FEED_CANDIDATE_CONFIDENCE_MEDIUM = 'medium'
const SPACE_FEED_CANDIDATE_CONFIDENCE_LOW = 'low'
const CONTENT_PROGRESS_BAR_ID = 'mb-ext_progress-bar'
const PENDING_COORDINATOR_STATUSES = new Set(['queued', 'opening', 'active', 'acting', 'settling'])
const STALE_PROFILE_NUKE_PROGRESS_MS = 12000
const SPACE_FEED_SCROLL_IDLE_MS = 450
const SPACE_FEED_SCROLL_REFRESH_GRACE_MS = 120
const SPACE_FEED_PROGRESS_REFRESH_IDLE_MS = 320
const SPACE_FEED_SCAN_VIEWPORT_MARGIN_PX = 1800
const SPACE_FEED_SCAN_ABOVE_VIEWPORT_MARGIN_PX = 320
const SPACE_FEED_SCAN_MAX_TIMESTAMPS = 60
const SPACE_FEED_SCAN_FALLBACK_MAX_CANDIDATES = 160
const SPACE_FEED_SCAN_SAMPLE_STEP_PX = 140
const SPACE_FEED_SCAN_SAMPLE_X_RATIOS = [0.28, 0.5, 0.72]
const MODAL_PROFILE_NUKE_IDLE_SCROLL_PASSES = 4
const FOREGROUND_PROMOTION_MESSAGE_TIMEOUT_MS = 8000
const FOREGROUND_PROMOTION_LEASE_WAIT_MS = 90000
const ACTION_LEASE_WAIT_MS = 45000
const ACTION_LEASE_POLL_MS = 2500
const PAGE_WORLD_CONFIRM_ACTIVATION_ATTR = 'data-mb-confirm-activation-token'
const SPACE_FEED_ROOT_SELECTOR =
    '.q-box.qu-borderAll.qu-borderColor--raised.qu-boxShadow--small.qu-mb--small.qu-bg--raised,' +
    '.puppeteer_test_tribe_post_item_feed_story,' +
    '.dom_annotate_multifeed_bundle_TribeContentBundle,' +
    'article,' +
    '[role="article"]'
// Markers for an embedded/quoted sub-post nested inside a post's own DOM
// (a feature card, a Quora-native embed, or a hyperlink embed) -- distinct
// from SPACE_FEED_ROOT_SELECTOR's generic "post item container" markers,
// which also match nested posts and so can't be used to tell embedded
// content apart from the primary post.
const SPACE_FEED_EMBED_SCOPE_SELECTOR =
    '.standalone_featurable,' +
    '[data-is-quora-embed="true"],' +
    '[data-type="hyperlink_embed"]'
const UNMUTE_ACTION_REGEX = /\bun[\s-]*mute\b/i
const UNBLOCK_ACTION_REGEX = /\bun[\s-]*block\b/i
const UNMUTE_CONTEXT_REGEX = /\bun[\s-]*mut(?:e|ed|ing)\b/i
const UNBLOCK_CONTEXT_REGEX = /\bun[\s-]*block(?:ed|ing)?\b/i
addEventListener('unhandledrejection', event => {
    if(isExtensionContextInvalidatedError(event.reason) || isRuntimeConnectionError(event.reason)) {
        event.preventDefault()
    }
})

addEventListener('pagehide', clearCloseTabFollowUps)
addEventListener('beforeunload', clearCloseTabFollowUps)
addEventListener('pagehide', clearBlockedCloseChecks)
addEventListener('beforeunload', clearBlockedCloseChecks)
addEventListener('pagehide', clearProfileSearchPendingRefresh)
addEventListener('beforeunload', clearProfileSearchPendingRefresh)

if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void init(), {once: true})
}
else {
    void init()
}

// The page's copy of the space registry. Init loads it, but init returns before that load on some page types (profile-search, and the
// canonical redirect), so a content script that started there never loads it (29 Oct).
async function loadSpaceRegistryFromStorage() {
    const stored = (await safeStorageGet({[SPACE_REGISTRY_KEY]: {}}))[SPACE_REGISTRY_KEY] || {}
    spaceRegistry = mergeIncomingSpaceRecords(stored)
    spaceRegistryLoaded = true
    // Draws were held until this load, so the controls are drawn now from the loaded copy, with no further event (29 Oct).
    if(getPageType() === 'space') syncSpaceClassificationControls()
}

// A space page entered by navigation. When the registry was never loaded, it is loaded first, so the controls show the stored category
// and not the defaults (Neutral, unset) (29 Oct).
function activateSpacePageFromNavigation() {
    if(spaceRegistryLoaded) return activateSpacePageControls(200)
    return loadSpaceRegistryFromStorage().then(() => activateSpacePageControls(0))
}

async function init() {
    if(initialized) return
    initialized = true

    const bodyReady = document.body || await waitForCondition(() => !!document.body, 5000, 25)
    if(!bodyReady || !document.body) return

    browser.runtime.onMessage.addListener(onMessage)
    const initialPage = getPageType()
    announceQuoraRuntimeReady(initialPage)
    initContentProgressBar()
    if(initialPage === 'profile-search') {
        installNavigationHooks()
        scheduleProfileSearchControls(0)
        scheduleProfileSearchFollowUps()
        void safeStorageGet(defaults).then(stored => {
            settings = stored
            scheduleProfileSearchControls(0)
        }).catch(() => null)
        void refreshContentPageCoordinatorStateFromRuntime({force: true})
            .then(() => scheduleProfileSearchControls(0))
            .catch(() => null)
        installSpaceFeedViewportRefresh()
        startObserver()
        return
    }

    if(maybeRedirectToCanonicalProfileUrl()) {
        return
    }

    // Mute/block button insertion depends only on this page's own DOM
    // (getProfileButtonInsertionTarget/isProfileBlocked) -- it has no
    // dependency on settings, spaceRegistry, or the coordinator queue
    // fetched below. Firing it here, before that slower sequential chain,
    // means the button can appear as soon as Quora's own profile menu
    // renders instead of being needlessly gated behind a coordinator-queue
    // round trip -- a live trace found
    // these two steps alone routinely add several seconds before the first
    // insertion attempt even happens, on a page where Quora's own DOM was
    // already ready (see entropy-reduction-action-plan-2026-09-09.md,
    // "profile button insertion delay", 2026-09-11). syncProfileButtons's
    // coordinator-state-dependent pieces (maybeRecordAlreadyBlockedCoordinatorProfile,
    // nudgeCurrentProfilePendingClaim) already do their own scoped refresh
    // or are safely re-invoked by ensureProfileButtons's own retry/follow-up
    // cycle once the queue arrives, so running this before that data is
    // loaded is not a functional dependency issue.
    if(initialPage === 'profile') {
        ensureProfileButtons()
        scheduleProfileButtonsFollowUps()
        installProfilePageEventListeners()
        // The observer re-inserts the buttons when Quora renders its menu. It used to start only after the
        // two worker round trips below (up to 7 s under load), so buttons were late exactly when the worker
        // was busy. It depends only on this page's DOM, so it can start here.
        startObserver()
    }

    settings = await safeStorageGet(defaults)
    await loadSpaceRegistryFromStorage()
    await refreshCoordinatorQueueFromRuntime({force: true})
    setStorageChangeListenerEnabled(true)
    installNavigationHooks()

    const page = initialPage

    if(page === 'question-log') {
        scheduleOriginalPosterRedirect()
    }
    else if(page === 'question') {
        ensureQuestionPageFOPBtn()
        scheduleQuestionPageFollowUps()
    }
    else if(page === 'space-post') {
        scheduleSpacePostNukeBtn()
        scheduleSpacePostFollowUps()
    }
    else if(page === 'space') {
        activateSpacePageControls(200)
        setTimeout(() => {
            void reconcileStaleSpaceFeedProgress()
        }, 350)
    }
    else if(page === 'profile-search') {
        scheduleProfileSearchControls(200)
        scheduleProfileSearchFollowUps()
    }

    scheduleSpacePageFollowUps()
    nudgeCurrentProfilePendingClaim()
    installSpaceFeedViewportRefresh()
    startObserver()
}

function announceQuoraRuntimeReady(pageType = '') {
    const announce = () => {
        void safeSendRuntimeMessage({
            action: 'quora-runtime-ready',
            url: location.href,
            pageType,
            contentScriptVersion: MUTE_BLOCK_CONTENT_SCRIPT_VERSION || ''
        }, null).catch(() => null)
    }

    for(const delayMs of QUORA_RUNTIME_READY_ANNOUNCE_DELAYS_MS) {
        if(delayMs <= 0) announce()
        else setTimeout(announce, delayMs)
    }
}

async function refreshCoordinatorQueueFromRuntime(options = {}) {
    await refreshContentPageCoordinatorStateFromRuntime({
        ...options,
        force: true
    })
    return coordinatorQueue
}

function getCurrentPageStateProfileHrefs(options = {}) {
    const hrefs = []
    if(Array.isArray(options.profileHrefs)) hrefs.push(...options.profileHrefs)

    const page = getPageType()
    if(page === 'profile') {
        hrefs.push(location.href)
    }
    else if(page === 'profile-search') {
        const rows = Array.isArray(options.rows) ? options.rows : getProfileSearchRows()
        hrefs.push(...rows.map(row => row?.href || ''))
        hrefs.push(...getProfileSearchStagedHrefs())
    }
    else if(page === 'space') {
        const entries = Array.isArray(options.entries) ? options.entries : getLatestSpaceFeedEntries()
        for(const entry of entries) {
            hrefs.push(...(Array.isArray(entry?.candidateUrls) ? entry.candidateUrls : []))
        }
        // The profiles the queue holds as pending on this page are asked about too.
        hrefs.push(...getPendingCoordinatorProfileHrefList())
    }

    const list = getNormalizedProfileHrefList(hrefs)
    // Owner, 23 Oct: on the space page the profiles the worker has not answered for go first, so more than 250 are answered over rounds.
    if(page === 'space') list.sort((left, right) => Number(isSpaceFeedProfileStateReady(left)) - Number(isSpaceFeedProfileStateReady(right)))
    return list.slice(0, 250)
}

function getProfileHrefScopeSignature(profileHrefs = []) {
    return getNormalizedProfileHrefList(profileHrefs).sort().join('\n')
}

function getSpaceFeedScopedStateSignature(entries = []) {
    return getProfileHrefScopeSignature(getCurrentPageStateProfileHrefs({entries}))
}

function scheduleSpaceFeedScopedStateRefresh(entries = []) {
    if(getPageType() !== 'space') return false

    const scopedEntries = Array.isArray(entries) ? entries : []
    const signature = getSpaceFeedScopedStateSignature(scopedEntries)
    if(!signature) {
        spaceFeedScopedStateSignature = ''
        return false
    }
    if(coordinatorQueueLoaded && signature === spaceFeedScopedStateSignature) return false

    if(spaceFeedScopedStateRefreshPromise) {
        if(signature !== spaceFeedScopedStateRefreshActiveSignature) {
            spaceFeedScopedStateRefreshQueuedEntries = scopedEntries
            spaceFeedScopedStateRefreshQueuedSignature = signature
        }
        return true
    }

    spaceFeedScopedStateRefreshActiveSignature = signature
    spaceFeedScopedStateRefreshPromise = (async () => {
        if(contentPageStateRefreshPromise) await contentPageStateRefreshPromise.catch(() => false)

        const refreshed = await refreshContentPageCoordinatorStateFromRuntime({
            force: true,
            entries: scopedEntries
        })
        if(refreshed) {
            spaceFeedScopedStateSignature = signature
            if(getPageType() === 'space') {
                syncSpaceFeedNukeControls()
            }
        }
        return refreshed
    })()
        .catch(() => false)
        .finally(() => {
            spaceFeedScopedStateRefreshPromise = null
            spaceFeedScopedStateRefreshActiveSignature = ''

            const queuedEntries = spaceFeedScopedStateRefreshQueuedEntries
            const queuedSignature = spaceFeedScopedStateRefreshQueuedSignature
            spaceFeedScopedStateRefreshQueuedEntries = null
            spaceFeedScopedStateRefreshQueuedSignature = ''

            if(queuedSignature && queuedSignature !== spaceFeedScopedStateSignature) {
                scheduleSpaceFeedScopedStateRefresh(queuedEntries)
            }
        })

    return true
}

async function refreshContentPageCoordinatorStateFromRuntime(options = {}) {
    const page = getPageType()
    if(!['profile-search', 'profile', 'space'].includes(page)) return false

    const now = Date.now()
    if(!options.force && now - contentPageStateRefreshAt < CONTENT_PAGE_STATE_REFRESH_MIN_INTERVAL_MS) return false
    if(contentPageStateRefreshPromise) return contentPageStateRefreshPromise

    const profileHrefs = getCurrentPageStateProfileHrefs(options)
    const request = {
        action: 'get-content-page-coordinator-state',
        pageType: page,
        url: location.href,
        profileHrefs,
        sourcePageUrl: page === 'profile-search' ? normalizeCurrentProfileSearchPageUrl() : '',
        searchQuery: page === 'profile-search' ? new URLSearchParams(location.search).get('q') || '' : '',
        runId: page === 'profile-search' ? profileSearchLastRunId || '' : ''
    }

    const stateRequestStartedAt = Date.now()
    countSpaceQueryEvent(`stateRequest.${page}`)
    contentPageStateRefreshPromise = safeSendRuntimeMessageWithTimeout(request, null, 3000)
        .then(result => {
            recordSpaceMarkPerf('stateRoundTrip', {
                ms: Date.now() - stateRequestStartedAt,
                ok: !!result,
                hrefs: profileHrefs.length,
                page
            })
            if(!result || typeof result !== 'object') {
                // A timed-out or failed reply leaves this page's copy of the queue and progress as it was. Ask again after a short wait.
                spaceFeedStateRefreshStatus.outcome = 'no-reply'
                spaceFeedStateRefreshStatus.finishedAt = Date.now()
                if(page === 'space') retrySpaceFeedStateLater(SPACE_FEED_STATE_RETRY_MS)
                return false
            }
            spaceFeedStateRefreshStatus.outcome = 'ok'
            spaceFeedStateRefreshStatus.finishedAt = Date.now()
            spaceFeedStateRefreshStatus.requested = profileHrefs.length
            spaceFeedStateRefreshStatus.records = Object.keys(result.profileNukeProgress || {}).length
            // Owner, 23 Oct: one reply covers only the profiles asked about this round, so it is merged into the copy, not used to replace it.
            // Rows from earlier rounds stay; the queue rows are keyed by item and are added over the copy.
            if(result.coordinatorQueue && typeof result.coordinatorQueue === 'object') {
                // The reply holds every live row of the profiles asked about, so a row of one of them that the reply lacks has left the live
                // queue (finished and archived). Drop this page's copy of it too, or it stays "pending" (24 Oct: 507 left after a finished run).
                coordinatorQueue = {
                    ...dropCoordinatorQueueRowsForProfiles(coordinatorQueue, profileHrefs),
                    ...normalizeCoordinatorQueue(result.coordinatorQueue)
                }
                coordinatorQueueLoaded = true
                // Owner, 26 Oct: the rows this reply shows take over from the in-memory marks of the page's own enqueues.
                applySpaceFeedEnqueueMarksToStateReply(stateRequestStartedAt, profileHrefs, coordinatorQueue)
                // The search page's marks take over the same way, from the rows this reply shows (see applyProfileSearchEnqueueMarksToStateReply).
                applyProfileSearchEnqueueMarksToStateReply(stateRequestStartedAt, profileHrefs, coordinatorQueue)
            }
            if(result.profileNukeProgress && typeof result.profileNukeProgress === 'object') {
                // Progress is keyed by profile: the profiles asked about this round take the reply's records, and a profile with no record in the reply has none.
                const repliedProgress = normalizeStoredProfileNukeProgress(result.profileNukeProgress)
                const keptProgress = {...profileNukeProgress}
                for(const href of profileHrefs) delete keptProgress[href]
                profileNukeProgress = {...keptProgress, ...repliedProgress}
            }
            contentPageStateRefreshAt = Date.now()
            if(page === 'space') {
                // Owner, 23 Oct: the worker has answered for every profile asked about. One with no record is not nuked.
                for(const href of profileHrefs) spaceFeedAnsweredProfileKeys.add(getSpaceFeedProfileStateKey(href))
                spaceFeedScopedStateSignature = getProfileHrefScopeSignature(profileHrefs)
                // More than 250 profiles: ask again for the rest until every scanned profile has an answer.
                retrySpaceFeedUnansweredStateLater(0)
                // Owner, 23 Oct: the count and buttons follow the worker's answer, whichever path asked for it. 24 Oct: asked for through the
                // render timer, so a burst of answers is drawn once per render gap rather than once per answer.
                scheduleSpaceAssetNukeControls(0)
            }
            return true
        })
        .catch(() => false)
        .finally(() => {
            contentPageStateRefreshPromise = null
        })

    return contentPageStateRefreshPromise
}

// Owner, 26 Oct: after an enqueue settles, the page asks for the state of its profiles again. The scoped refresh is skipped when the scope has
// not changed, so this is asked directly. A refresh already in flight was asked before the enqueue, so its reply is waited for first.
async function refreshSpaceFeedStateAfterEnqueue() {
    if(contentPageStateRefreshPromise) await contentPageStateRefreshPromise.catch(() => false)
    return refreshContentPageCoordinatorStateFromRuntime({force: true, entries: getLatestSpaceFeedEntries()})
}

// Owner, 23 Oct: after a timed-out or failed reply, the page asks the worker again after a short wait, so its copy of the queue and progress
// catches up when the worker is free.
function retrySpaceFeedStateLater(delayMs = 0) {
    spaceFeedScopedStateSignature = ''
    spaceFeedStateRefreshStatus.retriesWaiting += 1
    setTimeout(() => {
        spaceFeedStateRefreshStatus.retriesWaiting -= 1
        scheduleSpaceFeedScopedStateRefresh(getLatestSpaceFeedEntries())
    }, delayMs)
}

// Owner, 24 Oct: while a nuke is pending on the space page, its progress is asked for again every few seconds. The worker keeps the tabs to
// push to in memory, so after a worker restart the page could stay on an old copy. Asking again keeps the copy current.
// The page is redrawn only when the answer changed the progress or queue records, so an unchanged answer costs one message.
let spaceFeedStatePollTimer = null

function getSpaceFeedStateFingerprint() {
    const progress = Object.values(profileNukeProgress || {})
    return [
        Object.keys(profileNukeProgress || {}).length,
        progress.filter(record => isSuccessfulProfileNukeRecord(record)).length,
        Object.keys(coordinatorQueue || {}).length
    ].join('|')
}

async function pollSpaceFeedState() {
    if(getPageType() !== 'space') return
    // Owner, 24 Oct: a pending row in this page's queue copy is still polled after the run ends, so the next reply can drop it (a finished
    // profile the worker no longer lists). Without this the poll stopped and the page kept counting it as left.
    const hasPendingCoordinatorCopy = Object.values(coordinatorQueue || {}).some(item => isPendingCoordinatorStatus(item?.status))
    if(spaceFeedNukingPostKeys.size === 0 && !hasPendingCoordinatorCopy) return
    // Owner, 24 Oct: the pending posts copy is replaced only by the worker's reply to the settle-terminal reconcile, which ran on page start and
    // after a projection refresh, never on the poll. After a run it stayed "15 left" until a reload. The poll runs the reconcile too.
    if(hasPendingCoordinatorCopy) void reconcileStaleSpaceFeedProgress()

    const before = getSpaceFeedStateFingerprint()
    const refreshed = await refreshContentPageCoordinatorStateFromRuntime({force: true, entries: getLatestSpaceFeedEntries()})
    if(refreshed && getSpaceFeedStateFingerprint() !== before) scheduleSpaceFeedProgressDrivenRefresh()
}

if(spaceFeedStatePollTimer === null) {
    spaceFeedStatePollTimer = setInterval(() => {
        void pollSpaceFeedState()
    }, SPACE_FEED_STATE_POLL_MS)
}

// Owner, 23 Oct: a scanned profile the worker has not answered for is not counted. While any is unanswered, ask again after a short wait.
function retrySpaceFeedUnansweredStateLater(delayMs = 0) {
    const unanswered = getLatestSpaceFeedEntries().some(entry =>
        getNormalizedProfileHrefList(entry?.candidateUrls || []).some(url => !isSpaceFeedProfileStateReady(url)))
    if(!unanswered) return

    spaceFeedScopedStateSignature = ''
    setTimeout(() => scheduleSpaceFeedScopedStateRefresh(getLatestSpaceFeedEntries()), delayMs)
}

function onStorageChanged(changes, areaName) {
    if(areaName !== 'local') return
    // Only this layout's keys, with their plain names (storageNamespace.js).
    changes = namespaceChanges(changes) || {}

    for(const [key, change] of Object.entries(changes)) {
        if(Object.prototype.hasOwnProperty.call(defaults, key)) {
            settings[key] = change.newValue
        }
        else if(key === SPACE_REGISTRY_KEY) {
            // The storage value is the registry itself, so the copy is loaded from here on (29 Oct). A removed value is an empty registry.
            spaceRegistry = change.newValue ? mergeIncomingSpaceRecords(change.newValue) : {}
            spaceRegistryLoaded = true
            if(getPageType() === 'space') {
                syncSpaceFeedCollectLimitFromRecord()
                scheduleSpaceClassificationControls(0)
                scheduleSpaceAssetNukeControls(0)
            }
        }
    }
}

// A change to any layout key of the space post maps (the whole-map keys, the bucket keys or the layout marker) re-reads both
// maps, so one event with several bucket keys costs one read.
function scheduleContentPageStateProjectionRefresh() {
    void refreshContentPageCoordinatorStateFromRuntime({force: true})
        .then(() => {
            const page = getPageType()
            if(page === 'space') {
                void reconcileStaleSpaceFeedProgress()
                scheduleSpaceFeedProgressDrivenRefresh()
            }
            else if(page === 'profile-search') {
                scheduleProfileSearchControls(0)
            }
            else if(page === 'profile' && hasCurrentProfilePendingCoordinatorQueueItem()) {
                nudgeCurrentProfilePendingClaim()
            }
        })
        .catch(() => null)
}

function isExtensionContextInvalidatedError(error) {
    const message = `${error?.message || error || ''}`
    return /Extension context invalidated/i.test(message)
}

function isRuntimeConnectionError(error) {
    const message = `${error?.message || error || ''}`
    return /Receiving end does not exist|Could not establish connection|message channel closed before a response was received/i.test(message)
}

function getStorageArea() {
    return namespaceArea(browser?.storage?.local || globalThis.chrome?.storage?.local || null)
}

function getStorageChangeSource() {
    return browser?.storage?.onChanged || globalThis.chrome?.storage?.onChanged || null
}

function setStorageChangeListenerEnabled(enabled) {
    const source = getStorageChangeSource()
    if(!source) return false

    if(enabled) {
        if(storageChangeListenerInstalled) return true
        source.addListener(onStorageChanged)
        storageChangeListenerInstalled = true
        return true
    }

    if(!storageChangeListenerInstalled) return true
    source.removeListener?.(onStorageChanged)
    storageChangeListenerInstalled = false
    return true
}

async function safeStorageGet(fallback) {
    const storageArea = getStorageArea()
    if(!storageArea?.get) return {...fallback}

    try {
        return await storageArea.get(fallback)
    }
    catch(error) {
        if(isExtensionContextInvalidatedError(error)) return {...fallback}
        throw error
    }
}

async function safeSendRuntimeMessage(message, fallback = null) {
    try {
        return await browser.runtime.sendMessage(message)
    }
    catch(error) {
        if(isExtensionContextInvalidatedError(error) || isRuntimeConnectionError(error)) return fallback
        throw error
    }
}

async function safeSendRuntimeMessageWithTimeout(message, fallback = null, timeoutMs = SAFE_SEND_RUNTIME_MESSAGE_DEFAULT_TIMEOUT_MS) {
    const timeoutMarker = {timedOut: true}
    const timeout = new Promise(resolve => setTimeout(() => resolve(timeoutMarker), timeoutMs))
    const result = await Promise.race([
        safeSendRuntimeMessage(message, fallback),
        timeout
    ])

    return result === timeoutMarker ? fallback : result
}

async function sendRecordedRuntimeMessageWithRetry(message, mappedProgress = {}) {
    const terminal = mappedProgress?.terminal === true
    const timeoutMs = terminal
        ? QUEUED_TERMINAL_PROGRESS_MESSAGE_TIMEOUT_MS
        : QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS
    const attempts = terminal
        ? QUEUED_TERMINAL_PROGRESS_MESSAGE_ATTEMPTS
        : 1
    let result = null

    for(let attempt = 1; attempt <= attempts; attempt += 1) {
        result = await safeSendRuntimeMessageWithTimeout(message, null, timeoutMs)
        if(result?.recorded || result?.staleAttempt) return result
        if(attempt < attempts) await sleep(QUEUED_TERMINAL_PROGRESS_RETRY_DELAY_MS)
    }

    return result
}

async function sendQueuedProfileResolutionMessageWithRetry(message) {
    let result = null

    for(let attempt = 1; attempt <= QUEUED_PROFILE_RESOLUTION_MESSAGE_ATTEMPTS; attempt += 1) {
        result = await safeSendRuntimeMessageWithTimeout(
            message,
            null,
            QUEUED_PROFILE_RESOLUTION_MESSAGE_TIMEOUT_MS
        )
        if(result?.resolved === true) return result
        if(result?.resolved === false && result.reason !== 'missing-coordinator-item') return result
        if(attempt < QUEUED_PROFILE_RESOLUTION_MESSAGE_ATTEMPTS) {
            await sleep(QUEUED_PROFILE_RESOLUTION_RETRY_DELAY_MS)
        }
    }

    return result
}

function isTransientProfileNukeStatus(status) {
    return TRANSIENT_PROGRESS_STATUSES.has(`${status || ''}`.trim())
}

function shouldReconcilePendingProfileRecord(record) {
    if(!record) return false

    if(isSuccessfulProfileNukeRecord(record) ||
        record.status === 'profile-unavailable' ||
        record.status === 'error' ||
        record.status === 'interrupted') {
        return true
    }

    if(!isTransientProfileNukeStatus(record.status)) {
        return false
    }

    if(record.tabClosedAt || record.slotReleasedAt || record.closeReason || record.errorPageUrl || record.finalError) {
        return true
    }

    return false
}

function isSpaceLinkedProfileNukeRecord(record) {
    if(!record || typeof record !== 'object') return false

    if(Array.isArray(record.postKeys) && record.postKeys.length) return true
    if(Array.isArray(record.postUrls) && record.postUrls.length) return true

    return Array.isArray(record.events) &&
        record.events.some(event => `${event || ''}`.includes('Queued from space feed'))
}

function shouldReconcileStoredProfileRecord(record) {
    if(!record || !isTransientProfileNukeStatus(record.status)) return false
    if(!isSpaceLinkedProfileNukeRecord(record)) return false

    if(record.tabClosedAt || record.slotReleasedAt || record.closeReason || record.errorPageUrl || record.finalError) {
        return true
    }

    return false
}

function getReconciledProfileRecordPatch(record) {
    const reason = record?.closeReason
        ? `Pending queue state reconciled after ${record.closeReason}`
        : 'Pending queue state reconciled after stale queued work was found'

    return {
        status: 'interrupted',
        finalError: record?.finalError || reason,
        event: 'Reconciled stale pending queue state'
    }
}

// The profiles the queue holds as pending. The space post map that used to list them was removed (25 Oct): the queue is the record.
function getPendingCoordinatorProfileHrefList() {
    const hrefs = []
    for(const [itemKey, item] of Object.entries(coordinatorQueue || {})) {
        if(!isPendingCoordinatorStatus(item?.status)) continue
        const href = getCoordinatorItemProfileHref(itemKey, item)
        if(href) hrefs.push(href)
    }
    return getNormalizedProfileHrefList(hrefs)
}

async function reconcileStaleSpaceFeedProgress(entries = null) {
    if(getPageType() !== 'space') return false

    await refreshOwnedNukeStatusCacheIfStale()
    const pendingProfileHrefs = getPendingCoordinatorProfileHrefList()
    if(pendingProfileHrefs.length) {
        // The worker settles the queue rows of these profiles against their progress. Bounded, so the wait cannot stall the page.
        await safeSendRuntimeMessageWithTimeout({
            action: 'settle-terminal-coordinator-items',
            profileHrefs: pendingProfileHrefs
        }, null, 2500)
    }

    const updatesByHref = new Map()

    for(const [profileHref, record] of Object.entries(profileNukeProgress || {})) {
        if(!shouldReconcileStoredProfileRecord(record)) continue
        updatesByHref.set(profileHref, {
            profileHref,
            patch: getReconciledProfileRecordPatch(record)
        })
    }

    for(const pendingHref of pendingProfileHrefs) {
        const record = getProfileNukeProgressRecord(pendingHref)
        if(!shouldReconcilePendingProfileRecord(record)) continue

        if(record && isTransientProfileNukeStatus(record.status) && record.status !== 'interrupted') {
            updatesByHref.set(pendingHref, {
                profileHref: pendingHref,
                patch: getReconciledProfileRecordPatch(record)
            })
        }
    }

    const updates = Array.from(updatesByHref.values())
    if(updates.length) {
        applyLocalProfileNukeProgressUpdates(updates)
    }

    return updates.length > 0
}

async function failCurrentQueuedProfile(additionalUrls = []) {
    const failedUrls = getNormalizedProfileHrefList(additionalUrls || [])
    if(!failedUrls.length) return []

    return failedUrls
}

// A manual block or unblock on a profile page is Recent History: the worker records it (swManualHistory.js).
function recordManualProfileAction(kind) {
    const profileHref = normalizeQuoraProfileHref(location.href)
    if(!profileHref) return null
    return safeSendRuntimeMessageWithTimeout({action: 'record-manual-profile-action', kind, profileHref, at: Date.now()}, null)
}

function pruneProfileNukeProgress(records, maxEntries = MAX_PROFILE_NUKE_PROGRESS_ENTRIES) {
    const entries = Object.entries(records || {})
        .filter(([key, value]) => !!key && value && typeof value === 'object')
        .sort((left, right) => {
            const leftUpdatedAt = Number.isFinite(left[1].updatedAt) ? left[1].updatedAt : 0
            const rightUpdatedAt = Number.isFinite(right[1].updatedAt) ? right[1].updatedAt : 0
            return rightUpdatedAt - leftUpdatedAt || left[0].localeCompare(right[0])
        })

    if(maxEntries > 0 && entries.length > maxEntries) {
        entries.length = maxEntries
    }

    return Object.fromEntries(entries)
}

function mergeProfileProgressEvents(existingEvents = [], incomingEvents = []) {
    const seen = new Set()
    const merged = []

    for(const value of [...existingEvents, ...incomingEvents]) {
        const normalized = `${value || ''}`.trim()
        if(!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        merged.push(normalized)
    }

    merged.sort()
    return merged.slice(-12)
}

function mergeUniqueStringList(...values) {
    const seen = new Set()
    const merged = []

    for(const value of values.flat()) {
        const normalized = `${value || ''}`.trim()
        if(!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        merged.push(normalized)
    }

    return merged
}

function mergeStoredProfileProgressRecord(existing = null, incoming = null, normalizedHref = '') {
    const left = existing && typeof existing === 'object' ? existing : {}
    const right = incoming && typeof incoming === 'object' ? incoming : {}
    const leftUpdatedAt = Number.isFinite(left.updatedAt) ? left.updatedAt : 0
    const rightUpdatedAt = Number.isFinite(right.updatedAt) ? right.updatedAt : 0
    const newer = rightUpdatedAt >= leftUpdatedAt ? right : left
    const older = newer === right ? left : right

    const merged = {
        ...older,
        ...newer,
        profileHref: normalizedHref || newer.profileHref || older.profileHref || ''
    }

    if(shouldPreserveSettledProfileProgress(older, newer)) {
        preserveSettledProfileProgress(older, merged)
    }

    merged.updatedAt = Math.max(leftUpdatedAt, rightUpdatedAt, Date.now())

    if(left.postKeys || right.postKeys) {
        merged.postKeys = mergeUniqueStringList(left.postKeys || [], right.postKeys || [])
    }
    if(left.postUrls || right.postUrls) {
        merged.postUrls = mergeUniqueStringList(left.postUrls || [], right.postUrls || [])
    }

    const mergedEvents = mergeProfileProgressEvents(left.events || [], right.events || [])
    if(mergedEvents.length) {
        merged.events = mergedEvents
    }

    if(!merged.displayName) {
        merged.displayName = left.displayName || right.displayName || getProfileDisplayName(normalizedHref) || ''
    }

    return merged
}

function preserveSettledProfileProgress(previous = {}, next = {}) {
    for(const key of [
        'status',
        'blockSucceeded',
        'unblockSucceeded',
        'foundBlockedBeforeQueue',
        'finalError',
        'terminalAt',
        'blockedAt',
        'unblockedAt',
        'unavailableReason'
    ]) {
        if(previous[key] !== undefined) next[key] = previous[key]
    }

    return next
}

function shouldPreserveSettledProfileProgress(previous = {}, incoming = {}) {
    if(!isSettledProfileNukeRecord(previous)) return false
    if(!isTransientProfileNukeStatus(incoming?.status)) return false

    const previousActionKind = `${previous.actionKind || 'mute-block'}`.trim()
    const incomingActionKind = `${incoming.actionKind || previousActionKind}`.trim()
    if(previousActionKind !== incomingActionKind) return false

    const previousAttemptId = getAttemptIdFromValue(previous)
    const incomingAttemptId = getAttemptIdFromValue(incoming)
    if(previousAttemptId && incomingAttemptId && previousAttemptId !== incomingAttemptId) return false

    const previousAttemptNumber = getAttemptNumberFromValue(previous)
    const incomingAttemptNumber = getAttemptNumberFromValue(incoming)
    if(previousAttemptNumber && incomingAttemptNumber && previousAttemptNumber !== incomingAttemptNumber) return false

    return true
}

function normalizeStoredProfileNukeProgress(records) {
    const nextRecords = {}
    const entries = Object.entries(records || {})
        .filter(([key, value]) => !!key && value && typeof value === 'object')
        .sort((left, right) => {
            const leftUpdatedAt = Number.isFinite(left[1]?.updatedAt) ? left[1].updatedAt : 0
            const rightUpdatedAt = Number.isFinite(right[1]?.updatedAt) ? right[1].updatedAt : 0
            return leftUpdatedAt - rightUpdatedAt || left[0].localeCompare(right[0])
        })

    for(const [key, value] of entries) {
        const normalizedHref = normalizeQuoraProfileHref(value?.profileHref || key || '')
        if(!normalizedHref) continue

        nextRecords[normalizedHref] = mergeStoredProfileProgressRecord(
            nextRecords[normalizedHref] || null,
            value,
            normalizedHref
        )
    }

    return pruneProfileNukeProgress(nextRecords)
}

function normalizeProfileProgressPatch(href, patch = {}, existing = null) {
    const normalizedHref = normalizeQuoraProfileHref(href)
    if(!normalizedHref) return null

    const previous = existing || profileNukeProgress?.[normalizedHref] || {}
    const patchAttemptId = `${patch.attemptId || patch.attempt?.id || ''}`.trim()
    const patchAttemptNumber = Number.parseInt(patch.attemptNumber ?? patch.attempt?.number, 10) || 0
    const activeAttemptId = patchAttemptId ||
        (activeQueuedAttemptId && activeQueuedAttemptProfileHref === normalizedHref ? activeQueuedAttemptId : '')
    const activeAttemptNumber = patchAttemptNumber ||
        (activeAttemptId && activeQueuedAttemptProfileHref === normalizedHref ? activeQueuedAttemptNumber : 0)
    const next = {
        ...previous,
        ...patch,
        profileHref: normalizedHref,
        updatedAt: Date.now()
    }

    const preserveSettled = shouldPreserveSettledProfileProgress(previous, patch)
    if(preserveSettled) {
        preserveSettledProfileProgress(previous, next)
    }

    if(patch.status === 'queued' && !preserveSettled) {
        Object.assign(next, {
            attemptId: patchAttemptId,
            attemptNumber: patchAttemptNumber,
            muteError: '',
            blockError: '',
            finalError: '',
            unblockReason: '',
            unmuteReason: '',
            selectedActionLabel: '',
            selectedActionRect: null,
            menuActionLabels: [],
            visibleProfileMenuLabels: [],
            directBlockFailureDetail: null,
            profileMenuOpen: false,
            profileBlocked: false
        })
    }
    else {
        if(activeAttemptId) next.attemptId = activeAttemptId
        if(activeAttemptNumber) next.attemptNumber = activeAttemptNumber
    }

    if(next.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
        next.blockSucceeded = false
        next.foundBlockedBeforeQueue = false
    }

    if(next.blockSucceeded && next.status === 'interrupted') {
        next.status = next.foundBlockedBeforeQueue ? 'already-blocked' : 'blocked'
        next.finalError = ''
    }

    if(patch.postKeys || previous.postKeys) {
        next.postKeys = mergeUniqueStringList(previous.postKeys || [], patch.postKeys || [])
    }
    if(patch.postUrls || previous.postUrls) {
        next.postUrls = mergeUniqueStringList(previous.postUrls || [], patch.postUrls || [])
    }

    const event = `${patch.event || ''}`.trim()
    if(event) {
        next.events = [
            ...(Array.isArray(previous.events) ? previous.events : []),
            `${new Date().toISOString()} ${event}`
        ].slice(-12)
    }

    if(!next.displayName) {
        next.displayName = previous.displayName || getProfileDisplayName(normalizedHref) || ''
    }

    const successChanged = isSuccessfulProfileNukeRecord(next) && !isSuccessfulProfileNukeRecord(previous)
    if(isSettledProfileNukeRecord(next) && (successChanged || !(Number.isFinite(next.terminalAt) && next.terminalAt > 0))) {
        next.terminalAt = Date.now()
    }

    delete next.event
    return next
}

function buildQueuedProfileProgressPatch(event, extraPatch = {}) {
    return {
        status: 'queued',
        queuedAt: Date.now(),
        runId: '',
        queueIndex: 0,
        foundBlockedBeforeQueue: false,
        tabCreatedAt: 0,
        tabOpenedAt: 0,
        contentOpenedAt: 0,
        tabClosedAt: 0,
        closeRequestedAt: 0,
        slotReleasedAt: 0,
        terminalAt: 0,
        closeReason: '',
        closedByExtension: false,
        openedViablePage: false,
        muteAttempted: false,
        muteSucceeded: false,
        muteAttemptedAt: 0,
        muteError: '',
        blockAttempted: false,
        blockSucceeded: false,
        blockAttemptedAt: 0,
        blockError: '',
        directBlockFailureDetail: null,
        actionReadyAt: 0,
        blockedAt: 0,
        mutedAt: 0,
        finalError: '',
        errorPageUrl: '',
        lastUrl: '',
        unavailableReason: '',
        resolvedProfileHref: '',
        remappedFromRequested: false,
        securityVerification: false,
        ...extraPatch,
        event
    }
}

async function recordProfileNukeProgress(href, patch = {}) {
    const normalizedHref = normalizeQuoraProfileHref(href)
    if(!normalizedHref) return null

    // The page's tab visibility at this step (24 Oct): an action needs its tab visible, so each row records what the page saw.
    const nextRecord = normalizeProfileProgressPatch(normalizedHref, {
        pageVisibility: document.visibilityState || '',
        pageVisibilityAt: Date.now(),
        ...patch
    })
    if(!nextRecord) return null

    const useJobProtocol = isActiveQueuedProgressRecord(normalizedHref)
    const mapped = mapProfileProgressToCoordinatorState(nextRecord)

    if(useJobProtocol) {
        profileNukeProgress = pruneProfileNukeProgress({
            ...profileNukeProgress,
            [normalizedHref]: nextRecord
        })

        const result = await sendRecordedRuntimeMessageWithRetry({
            action: mapped.terminal ? 'record-job-terminal' : 'record-job-milestone',
            profileHref: normalizedHref,
            patch: nextRecord,
            attemptId: nextRecord.attemptId || activeQueuedAttemptId || '',
            attemptNumber: nextRecord.attemptNumber || activeQueuedAttemptNumber || 0
        }, mapped)

        if(result?.recorded) {
            const acceptedRecord = result.record && typeof result.record === 'object'
                ? result.record
                : nextRecord
            profileNukeProgress = pruneProfileNukeProgress({
                ...profileNukeProgress,
                [normalizedHref]: acceptedRecord
            })
        }
        return {
            ...nextRecord,
            runtimeRecorded: !!result?.recorded,
            staleAttempt: result?.staleAttempt === true,
            serviceWorkerOnly: true
        }
    }

    profileNukeProgress = pruneProfileNukeProgress({
        ...profileNukeProgress,
        [normalizedHref]: nextRecord
    })

    // Not under the coordinator queue protocol -- this is a legacy direct
    // action (the "Mute Block"/"Unblock Unmute" buttons on a manually-opened
    // profile page). There's no attemptId/runId and never will be, so this
    // doesn't go through the queue-machine event path above; it persists
    // straight to the profile-progress projection instead, independent of
    // the coordinator queue. Without this, legacy-action progress only ever
    // lived in this tab's own memory and was lost the moment the tab closed.
    //
    // Deliberately NOT awaited: this function is called repeatedly inline
    // throughout muteProfile/blockProfile/unblockUnmuteProfile's own
    // multi-step Quora UI sequence (open menu -> confirm -> verify), and
    // those callers never inspect this function's return value -- they just
    // `await` it as a checkpoint. Under the service-worker responsiveness
    // problems observed live-testing this session, awaiting a 4s-bounded
    // message here at every checkpoint measurably delayed that UI sequence
    // and was observed to leave a legacy action only partially completed
    // (an "unmuted" confirmation fired but the block was never actually
    // removed). Persisting the audit record durably is worth doing, but not
    // at the cost of slowing down or destabilizing the actual user-facing
    // action -- fire it in the background and let the in-memory cache pick
    // up the durable record if/when it lands.
    void safeSendRuntimeMessageWithTimeout({
        action: 'record-direct-profile-progress',
        profileHref: normalizedHref,
        patch: nextRecord
    }, null, 4000).then(directResult => {
        if(!directResult?.recorded) return
        const acceptedRecord = directResult.record && typeof directResult.record === 'object'
            ? directResult.record
            : nextRecord
        profileNukeProgress = pruneProfileNukeProgress({
            ...profileNukeProgress,
            [normalizedHref]: acceptedRecord
        })
    }).catch(() => null)

    return {
        ...nextRecord,
        runtimeRecorded: false,
        localOnly: true,
        persistPending: true
    }
}

function isActiveQueuedProgressRecord(normalizedHref = '') {
    return !!activeQueuedAttemptId &&
        !!normalizedHref &&
        activeQueuedAttemptProfileHref === normalizedHref
}

function applyLocalProfileNukeProgressUpdates(updates) {
    const normalizedUpdates = []
    const nextProgress = {
        ...profileNukeProgress
    }

    for(const update of updates || []) {
        const normalizedHref = normalizeQuoraProfileHref(update?.profileHref || update?.href || '')
        if(!normalizedHref) continue

        const patch = update?.patch || {}
        const nextRecord = normalizeProfileProgressPatch(normalizedHref, patch, nextProgress[normalizedHref] || null)
        if(!nextRecord) continue

        normalizedUpdates.push({profileHref: normalizedHref, patch: nextRecord})
        nextProgress[normalizedHref] = nextRecord
    }

    if(!normalizedUpdates.length) return false

    profileNukeProgress = pruneProfileNukeProgress(nextProgress)
    return false
}

function mapProfileProgressToCoordinatorState(record = {}) {
    const mapped = mapProgressToCoordinatorState(record)
    return {
        status: mapped.status || '',
        outcome: mapped.outcome || '',
        error: mapped.error || '',
        terminal: mapped.terminal === true
    }
}

function getAttemptIdFromValue(value = null) {
    if(!value || typeof value !== 'object') return ''
    return `${value.attemptId || value.attempt?.id || ''}`.trim()
}

function getAttemptNumberFromValue(value = null) {
    if(!value || typeof value !== 'object') return 0
    return Number.parseInt(value.attemptNumber ?? value.attempt?.number, 10) || 0
}

function getProfileNukeProgressRecord(href) {
    const normalizedHref = normalizeQuoraProfileHref(href)
    return normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
}

async function recordCurrentProfileNukeProgress(patch = {}) {
    const securityVerificationReason = getSecurityVerificationReason()
    return recordProfileNukeProgress(location.href, {
        lastUrl: location.href,
        pageType: getPageType() || 'unknown',
        securityVerification: !!securityVerificationReason,
        securityVerificationReason,
        unavailableReason: getProfileUnavailableReason() || '',
        ...patch
    })
}

function noteCurrentProfileNukeProgress(patch = {}) {
    void recordCurrentProfileNukeProgress(patch)
}

// Reports whether this profile was already blocked the moment this tab
// first got a chance to check -- fire-and-forget, safe to call repeatedly
// (every attempt/retry calls this, but the service worker only ever keeps
// the first report: see mutateCoordinatorInitialBlockedState, sw.js). Only
// meaningful for a coordinator-managed action (activeQueuedAttemptId set);
// a manual/legacy button click has no coordinator row for this to attach
// to, and the service worker's own guard would just no-op it anyway, so
// skip the round trip entirely for that case. See
// classifyBlockConfirmationFromItem's comment (sw.js) for why this exists:
// a later retry's own tab has no memory of whether an *earlier* attempt was
// the one that actually clicked block, so relying only on the current
// attempt's local state loses that history.
function reportInitialBlockedStateIfQueued(blocked) {
    if(!activeQueuedAttemptId) return
    reportInitialBlockedStateUnconditionally(blocked)
}

// 2026-09-29: the close-if-blocked message handler (onMessage below) calls
// this instead of reportInitialBlockedStateIfQueued above -- that gate
// exists to skip the round trip for a manual/legacy button click with no
// coordinator row, but close-if-blocked is a message the coordinator only
// ever sends to a tab it's already tracking as an active queued row, so the
// gate is simply wrong there: it's guaranteed coordinator context already.
// Confirmed live 2026-09-29 (FPT-Camera-3): this poll starts firing the
// moment the tab opens, well before the claim round trip that sets
// activeQueuedAttemptId completes (which took ~10s under load in that
// session, across repeated re-claims) -- every not-blocked observation from
// that window was silently dropped by the old gate, even though the
// service worker resolves the row from the tab's already-attached queued-
// tab metadata (set at tab-open time, independent of the claim) and could
// have accepted them. The row's true not-blocked starting state lost the
// "recorded once, first report wins" race to whichever observation reached
// the service worker first *after* activeQueuedAttemptId was finally set --
// misclassifying a genuine live block as already-blocked.
// Diagnostic events for the flight recorder: what the user did on the page and when the page's blocked
// state changed. Stamped with this page's clock so they line up with the worker's own events.
function reportPageEvent(event, detail = '') {
    void safeSendRuntimeMessage({
        action: 'record-page-event',
        event,
        detail: `${detail || ''}`.slice(0, 80),
        clientAt: Date.now()
    }).catch(() => null)
}

// Owner, 27 Oct: every collect run ends with one flight recorder event saying why. reason is 'captured' (the count was reached),
// 'end-of-feed' (or end-of-results on search), 'stalled' (the page stopped growing), or 'stopped' (Stop was pressed).
// considered (search only, owner 27 Oct) is the count of distinct result rows the run read; it is added as "seen N" when given.
function reportCollectEnd(page, {reason, collected, limit, passes, startedAt, considered = null}) {
    const seconds = Math.round((Date.now() - (startedAt || Date.now())) / 1000)
    const seen = Number.isFinite(considered) ? ` seen ${considered}` : ''
    reportPageEvent(`${page}-collect-end`, `${reason} ${collected}/${limit} p${passes} ${seconds}s${seen}`)
}

let lastReportedProfileBlocked = null

function reportProfileBlockedTransition() {
    if(getPageType() !== 'profile') return
    const blocked = !!isProfileBlocked()
    if(blocked === lastReportedProfileBlocked) return
    lastReportedProfileBlocked = blocked
    reportPageEvent('profile-blocked-state', blocked ? 'blocked' : 'not-blocked')
}

function installProfilePageEventListeners() {
    for(const type of ['pointerdown', 'click']) {
        document.addEventListener(type, event => {
            if(getPageType() !== 'profile') return
            const target = event.target?.closest?.('button, a, [role="menuitem"], [role="menu"] *') || event.target
            const label = `${target?.textContent || target?.getAttribute?.('aria-label') || ''}`.replace(/\s+/g, ' ').trim()
            if(!/mute|block|unmute|unblock|confirm|yes/i.test(label)) return
            reportPageEvent(`${extensionActivationState.depth > 0 ? 'ext' : 'user'}-${type}`, label)
        }, true)
    }
}

function reportInitialBlockedStateUnconditionally(blocked) {
    void safeSendRuntimeMessageWithTimeout({
        action: 'record-initial-blocked-state',
        blocked: blocked === true
    }, null, SAFE_SEND_RUNTIME_MESSAGE_DEFAULT_TIMEOUT_MS).catch(() => null)
}

function getDirectBlockActionDiagnostic(branch = '', extra = {}) {
    const blockButton = getMenuAction(isBlockActionLabel)
    const unblockButton = getMenuAction(isUnblockActionLabel)
    const confirmButton = getBlockConfirmAction()
    return {
        branch,
        url: location.href,
        pageType: getPageType() || 'unknown',
        profileBlocked: isProfileBlocked(),
        profileMenuOpen: isProfileMenuOpen(),
        profileMenuButtonRect: getProfileMenuButtonDebugRect(),
        menuActionLabels: getVisibleProfileMenuActionLabels(),
        blockOptionPresent: !!blockButton,
        blockOptionLabel: getActionDebugLabel(blockButton),
        blockOptionRect: getActionDebugRect(blockButton),
        unblockOptionPresent: !!unblockButton,
        unblockOptionLabel: getActionDebugLabel(unblockButton),
        unblockOptionRect: getActionDebugRect(unblockButton),
        blockConfirmPresent: !!confirmButton,
        blockConfirmLabel: getActionDebugLabel(confirmButton),
        blockConfirmRect: getActionDebugRect(confirmButton),
        securityVerification: !!getSecurityVerificationReason(),
        securityVerificationReason: getSecurityVerificationReason(),
        unavailableReason: getProfileUnavailableReason() || '',
        ...extra
    }
}

async function clearProfileNukeState(href, reason = '') {
    const normalizedHref = normalizeQuoraProfileHref(href)
    if(!normalizedHref) return false

    delete profileNukeProgress[normalizedHref]
    clearProfileBlockHint()
    rememberProfileUnblocked(normalizedHref)

    const result = await safeSendRuntimeMessageWithTimeout({
        action: 'clear-profile-nuke-state',
        profileHref: normalizedHref,
        reason
    }, null, 2500)

    if(result) {
        if(result.profileNukeProgress && typeof result.profileNukeProgress === 'object') {
            profileNukeProgress = normalizeStoredProfileNukeProgress(result.profileNukeProgress)
        }
        return !!result.cleared
    }

    return false
}

async function maybeClearCurrentProfileNukeStateFromLiveUnblocked() {
    if(getPageType() !== 'profile') return false
    if(activeQueuedAttemptId) return false

    const href = getProfileKey(location.href)
    if(!href) return false

    const record = getProfileNukeProgressRecord(href)
    if(!isSuccessfulProfileNukeRecord(record)) return false
    if(record.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) return false

    const reconcileKey = [
        href,
        record.status || '',
        record.updatedAt || 0,
        record.terminalAt || 0
    ].join('|')
    if(reconcileKey === manualUnblockedReconcileKey) return false
    manualUnblockedReconcileKey = reconcileKey

    if(!isProfileBlocked()) {
        rememberProfileUnblocked(href)
        await clearProfileNukeState(href, 'Visible profile is no longer blocked')
        ensureProfileButtons()
        return true
    }

    if(!getProfileMenuButton()) return false

    const blockState = await readProfileMenuState(isBlockActionLabel, isUnblockActionLabel, 1200, 150)
    if(blockState !== 'primary') return false

    rememberProfileUnblocked(href)
    await clearProfileNukeState(href, 'Profile menu offers Block after stored nuke success')
    ensureProfileButtons()
    return true
}

async function maybeRecordAlreadyBlockedCoordinatorProfile() {
    if(getPageType() !== 'profile' || !isProfileBlockedConfirmed()) return

    const href = normalizeQuoraProfileHref(location.href)
    if(!href) return

    await refreshCoordinatorQueueFromRuntime({
        profileHrefs: [href]
    })
    const item = coordinatorQueue[href]
    if(!item || `${item.status || ''}` === 'succeeded') return
    if(`${item.actionKind || ''}` === UNBLOCK_UNMUTE_ACTION_KIND) return

    const reconcileKey = [
        href,
        item.status || '',
        item.outcome || '',
        item.updatedAt || 0,
        item.terminalAt || 0
    ].join('|')
    if(reconcileKey === alreadyBlockedCoordinatorReconcileKey) return
    alreadyBlockedCoordinatorReconcileKey = reconcileKey

    const progressPatch = {
        status: 'already-blocked',
        openedViablePage: true,
        foundBlockedBeforeQueue: true,
        blockSucceeded: true,
        blockedAt: Date.now(),
        lastUrl: location.href,
        resolvedProfileHref: href,
        remappedFromRequested: false,
        finalError: '',
        event: 'Visible profile was already blocked; reconciling coordinator row'
    }
    const progress = await recordAlreadyBlockedCoordinatorProgress(href, item, progressPatch)
    if(progress?.serviceWorkerOnly && !progress.runtimeRecorded) {
        alreadyBlockedCoordinatorReconcileKey = ''
        console.info('Already-blocked reconcile was not recorded; leaving queued tab open for retry')
        setTimeout(() => void sweepServiceWorkerBlockedProfileTabs(), 1000)
        setTimeout(() => void maybeRecordAlreadyBlockedCoordinatorProfile(), 2000)
        return
    }

    if(isActiveQueuedProgressRecord(href)) {
        await notifyQueuedTabComplete()
        await requestCloseTab()
    }
    else if(item?.serviceWorkerOwned === true || `${item?.executorOwner || ''}` === 'service-worker') {
        setTimeout(() => void sweepServiceWorkerBlockedProfileTabs(), 1000)
    }
}

async function recordAlreadyBlockedCoordinatorProgress(href, item = {}, patch = {}) {
    const attemptId = `${item?.attemptId || item?.attempt?.id || ''}`.trim()
    const attemptNumber = Number.parseInt(item?.attemptNumber ?? item?.attempt?.number, 10) || 0

    if(!attemptId || item?.serviceWorkerOwned !== true && `${item?.executorOwner || ''}` !== 'service-worker') {
        return recordProfileNukeProgress(href, patch)
    }

    const nextRecord = normalizeProfileProgressPatch(href, {
        ...patch,
        actionKind: item?.actionKind || 'mute-block',
        runId: item?.runId || '',
        attemptId,
        attemptNumber,
        ownerTabId: item?.ownerTabId || SERVICE_WORKER_QUEUE_OWNER_ID,
        ownerWindowId: item?.ownerWindowId || null
    })
    if(!nextRecord) return null

    const mapped = mapProfileProgressToCoordinatorState(nextRecord)
    if(!mapped.terminal) return recordProfileNukeProgress(href, patch)

    profileNukeProgress = pruneProfileNukeProgress({
        ...profileNukeProgress,
        [href]: nextRecord
    })

    const result = await sendRecordedRuntimeMessageWithRetry({
        action: 'record-job-terminal',
        profileHref: href,
        patch: nextRecord,
        attemptId,
        attemptNumber
    }, mapped)

    if(result?.recorded) {
        const acceptedRecord = result.record && typeof result.record === 'object'
            ? result.record
            : nextRecord
        profileNukeProgress = pruneProfileNukeProgress({
            ...profileNukeProgress,
            [href]: acceptedRecord
        })
    }

    return {
        ...nextRecord,
        runtimeRecorded: !!result?.recorded,
        staleAttempt: result?.staleAttempt === true,
        serviceWorkerOnly: true
    }
}

async function notifyQueuedTabComplete() {
    const result = await safeSendRuntimeMessageWithTimeout({
        action: 'release-job-tab',
        attemptId: activeQueuedAttemptId || ''
    }, null, QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS)
    return !!result?.released
}

async function sweepBlockedProfileTabs() {
    const result = await safeSendRuntimeMessage({action: 'sweep-owned-blocked-profile-tabs'}, null)
    return {
        owned: Number.parseInt(result?.owned, 10) || 0,
        signaled: Number.parseInt(result?.signaled, 10) || 0
    }
}

async function sweepServiceWorkerBlockedProfileTabs() {
    const result = await safeSendRuntimeMessage({action: 'sweep-service-worker-blocked-profile-tabs'}, null)
    return {
        owned: Number.parseInt(result?.owned, 10) || 0,
        signaled: Number.parseInt(result?.signaled, 10) || 0
    }
}

// Timeline for space-feed marking latency (diagnostic only; nothing reads it in
// the extension). Events go to an attribute on <html>, which the body observer
// does not watch, so a CDP reader can pull them from the page.
const SPACE_MARK_PERF_ATTRIBUTE = 'data-mb-perf-space-marking'
const SPACE_MARK_PERF_MAX_RECENT_EVENTS = 100
const spaceMarkPerfEvents = []
// Running totals per event name, so a long run (100+ page-downs) stays complete
// even after the recent-event window has rolled past it.
const spaceMarkPerfTotals = {}

function recordSpaceMarkPerf(name = '', fields = {}) {
    try {
        const t = Date.now()
        spaceMarkPerfEvents.push({t, name, ...fields})
        if(spaceMarkPerfEvents.length > SPACE_MARK_PERF_MAX_RECENT_EVENTS) {
            spaceMarkPerfEvents.splice(0, spaceMarkPerfEvents.length - SPACE_MARK_PERF_MAX_RECENT_EVENTS)
        }
        const total = spaceMarkPerfTotals[name] || {count: 0, sumMs: 0, maxMs: 0, okCount: 0}
        total.count += 1
        if(typeof fields.ms === 'number') {
            total.sumMs += fields.ms
            total.maxMs = Math.max(total.maxMs, fields.ms)
        }
        if(fields.ok === true) total.okCount += 1
        spaceMarkPerfTotals[name] = total
        document.documentElement?.setAttribute(SPACE_MARK_PERF_ATTRIBUTE, JSON.stringify({
            totals: spaceMarkPerfTotals,
            recent: spaceMarkPerfEvents
        }))
    }
    catch {}
}

async function getOwnedNukeStatus(options = {}) {
    const startedAt = Date.now()
    const result = await safeSendRuntimeMessageWithTimeout({
        action: 'get-owned-nuke-status',
        runId: options.runId || ''
    }, null, 2500)
    recordSpaceMarkPerf('ownedStatus', {ms: Date.now() - startedAt, ok: !!result})
    return normalizeOwnedNukeStatus(result)
}

function normalizeOwnedNukeStatus(status = null) {
    const next = {
        active: Number.parseInt(status?.active, 10) || 0,
        owned: Number.parseInt(status?.owned, 10) || 0,
        queued: Number.parseInt(status?.queued, 10) || 0,
        paused: false
    }
    next.paused = !!status?.paused && hasOwnedNukeWorkInFlight(next)
    return next
}

let ownedNukeStatusFetchedAt = 0

function updateOwnedNukeStatusCache(status = null) {
    ownedNukeStatusCache = normalizeOwnedNukeStatus(status)
    ownedNukeStatusFetchedAt = Date.now()

    return ownedNukeStatusCache
}

async function promoteCurrentQueuedTab(reason = 'hidden-tab-stall', allowForegroundFallback = false) {
    if(!allowForegroundFallback) return {promoted: false, reason: 'foreground-fallback-disabled'}

    const response = await safeSendRuntimeMessageWithTimeout({
        action: 'promote-queued-tab',
        reason,
        attemptId: activeQueuedAttemptId || '',
        attemptNumber: activeQueuedAttemptNumber || 0
    }, {promoted: false, reason: 'promote-message-timeout'}, QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS)

    return {
        ...(response || {}),
        promoted: response?.promoted === true,
        reason: response?.reason || (response?.promoted ? 'promoted' : 'promote-denied')
    }
}

// Owner, 24 Oct: the owned nuke status is asked of the worker at most once per OWNED_NUKE_STATUS_TTL_MS. Renders reuse the last answer.
async function refreshOwnedNukeStatusCacheIfStale() {
    if(Date.now() - ownedNukeStatusFetchedAt < OWNED_NUKE_STATUS_TTL_MS) return ownedNukeStatusCache
    return refreshOwnedNukeStatusCache()
}

async function refreshOwnedNukeStatusCache() {
    if(ownedNukeStatusPromise) return ownedNukeStatusPromise

    ownedNukeStatusPromise = (async () => updateOwnedNukeStatusCache(await getOwnedNukeStatus()))()
    try {
        return await ownedNukeStatusPromise
    }
    finally {
        ownedNukeStatusPromise = null
    }
}

function formatNukeProgressLabel(label, status = null) {
    if(!status) return label
    return `${label} [t:${status.owned} a:${status.active} q:${status.queued}]`
}

function formatSpaceFeedPostWorkLabel() {
    return 'Nuking this'
}

// The Nuke 'Em button's label while idle: the queueable count from the last render (owner, 25 Oct). The nuking status is shown beside it.
function getSpaceFeedQueueButtonLabel() {
    return `Nuke 'Em ${Number.parseInt(lastSpaceFeedRenderModel?.queueableCount, 10) || 0}`
}

function getSpaceFeedNukeButtonMode(button) {
    return button?.classList?.contains('mb-ext_space-feed-post-single-nuke-btn') ? 'single' : 'batch'
}

function rememberActiveSpaceFeedNukeMode(button, runId) {
    const space = resolveCurrentSpaceDescriptor()
    activeSpaceFeedNukeMode = getSpaceFeedNukeButtonMode(button)
    activeSpaceFeedNukeRunId = runId || ''
    activeSpaceFeedNukeSpaceKey = space?.key || ''
}

function clearInactiveSpaceFeedNukeMode() {
    if(spaceFeedNukingPostKeys.size ||
        getPendingCoordinatorSpaceFeedWorkCountForSpace() > 0 ||
        hasActivePendingSpaceFeedWork(getLatestSpaceFeedEntries())) {
        return false
    }

    activeSpaceFeedNukeMode = ''
    activeSpaceFeedNukeRunId = ''
    activeSpaceFeedNukeSpaceKey = ''
    return true
}

function isActiveSpaceFeedNukeMode(mode, localBusy = false, space = resolveCurrentSpaceDescriptor()) {
    if(activeSpaceFeedNukeMode !== mode) return false
    if(activeSpaceFeedNukeSpaceKey && space?.key && activeSpaceFeedNukeSpaceKey !== space.key) return false

    return localBusy || hasOwnedNukeWorkInFlight()
}

function isUnknownSpaceFeedNukeActive(localBusy = false) {
    return !activeSpaceFeedNukeMode && localBusy
}

function hasOwnedNukeWorkInFlight(status = ownedNukeStatusCache) {
    return (Number.parseInt(status?.active, 10) || 0) > 0 ||
        (Number.parseInt(status?.owned, 10) || 0) > 0 ||
        (Number.parseInt(status?.queued, 10) || 0) > 0
}

function syncOwnedNukeDrainButton(button, status = null) {
    if(!button) return

    const nextStatus = status || ownedNukeStatusCache || {}
    const active = Number.parseInt(nextStatus?.active, 10) || 0
    const owned = Number.parseInt(nextStatus?.owned, 10) || 0
    const queued = Number.parseInt(nextStatus?.queued, 10) || 0

    if(active > 0 || queued > 0) {
        setNukeButtonWorking(button, formatNukeProgressLabel('Nuking...', nextStatus))
        return
    }

    if(owned > 0) {
        setNukeButtonIdle(button, formatNukeProgressLabel('Settling...', nextStatus))
        return
    }

    setNukeButtonDone(button)
}

async function waitForOwnedNukeTabsToDrain(button, timeoutMs = WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_INTERVAL_MS, options = {}) {
    const startedAt = Date.now()
    let nextSweepAt = 0
    const allowPause = !!options.allowPause

    while(Date.now() - startedAt < timeoutMs) {
        const status = updateOwnedNukeStatusCache(await getOwnedNukeStatus({runId: options.runId || ''}))
        if(status.owned <= 0 && status.queued <= 0) {
            setNukeButtonDone(button)
            return true
        }
        if(allowPause && status.paused) {
            setNukeButtonIdle(button)
            return false
        }

        syncOwnedNukeDrainButton(button, status)
        if(Date.now() >= nextSweepAt) {
            nextSweepAt = Date.now() + 4000
            void sweepBlockedProfileTabs()
        }
        await sleep(intervalMs)
    }

    const status = updateOwnedNukeStatusCache(await getOwnedNukeStatus({runId: options.runId || ''}))
    if(allowPause && status.paused) {
        setNukeButtonIdle(button)
        return false
    }
    syncOwnedNukeDrainButton(button, status)
    return false
}

let observerStarted = false

function startObserver() {
    if(observerStarted) return
    observerStarted = true

    new MutationObserver(async mutations => {
        if(location.href !== currentUrl) {
            const previousProfileKey = getProfileKey(currentUrl)
            currentUrl = location.href
            resetQuestionPageBtn()
            resetSpacePostNukeBtn()
            resetProfileSearchControls()
            resetSpaceAssetNukeControls()
            resetSpaceFeedScanCache()
            if(getPageType() !== 'profile') resetProfileButtonRail()

            const nextProfileKey = getProfileKey(currentUrl)
            if(previousProfileKey !== nextProfileKey) {
                clearProfileBlockHint()
                resetProfileButtonsRefreshBurstGuard()
                // Switching from one profile to another without ever leaving
                // page type 'profile' (e.g. a same-tab navigation) used to
                // leave the previous profile's rail and buttons in place --
                // isProfileTargetPlacement only checks parentage, not which
                // profile the buttons were bound for, so they'd silently
                // keep working the WRONG profile instead of being rebuilt.
                resetProfileButtonRail()
            }
        }

        const page = getPageType()

        if(page === 'profile') reportProfileBlockedTransition()
        if(page === 'profile' && shouldRefreshProfileButtons(mutations)) {
            scheduleProfileButtonsRefresh()
        }
        // The buttons wait for Quora's menu button, which may appear without the menu nodes checked above.
        if(page === 'profile' && !isProfileBlocked() &&
            !document.querySelector('.mb-ext_mute-block-btn') && getProfileMenuButton()) {
            scheduleProfileButtonsRefresh()
        }

        if(page === 'question') {
            ensureQuestionPageFOPBtn()
        }
        else if(page === 'space-post' && !document.querySelector('.mb-ext_post-nuke-btn')) {
            scheduleSpacePostNukeBtn(300)
        }
        else if(page === 'space') {
            if(!areExtensionOnlyMutations(mutations)) {
                const hasStructuralFeedChange = hasSpaceFeedStructuralMutations(mutations)
                if(hasStructuralFeedChange) {
                    recordSpaceMarkPerf('mutation')
                    invalidateSpaceFeedEntryCacheForMutations(mutations)
                }
                injectSpaceSidebarOpenProfilesBtn()
                if(shouldRefreshSpaceClassificationControls()) {
                    scheduleSpaceClassificationControls(120)
                }

                const hasMissingFeedControls = !document.querySelector('.mb-ext_space-feed-status-btn')
                if((hasStructuralFeedChange || hasMissingFeedControls) &&
                    Date.now() >= suppressSpaceAssetNukeRefreshUntil &&
                    shouldRefreshSpaceAssetNukeControls(mutations)) {
                    scheduleSpaceAssetNukeControls(180)
                }
            }
        }
        else if(page === 'profile-search' && !areExtensionOnlyMutations(mutations)) {
            scheduleProfileSearchControls(180)
        }

        // 24 Oct: the dialog search runs only when a dialog may have opened or one is already open, not on every change on the page.
        const dialogMayBeOpen = mutationsMayInvolveDialog(mutations) || !!activeProfileModal?.isConnected
        const activeModal = dialogMayBeOpen ? getProfilePeopleModal() : null
        const activeModalButtons = getModalProfileActionButtons(activeModal)
        const needsLateModalActions = activeModal &&
            getProfileModalItems(activeModal).length &&
            ((!activeModalButtons.open && getOpenableProfileModalItems(activeModal).length) ||
                (!activeModalButtons.nuke && getNukeableProfileModalItems(activeModal).length))
        if(needsLateModalActions) {
            injectModalOpenProfilesBtn()
        }

        let modal = dialogMayBeOpen ? document.querySelector('[role="dialog"][aria-modal="true"]:not([data-mb-checked])') : null
        if(!modal) return

        modal.dataset.mbChecked = true

        if(isProfilePeopleModal(modal)) {
            await sleep(1e3)

            let items = getUnhandledProfileModalItems(modal)
            if(items.length) injectModalOpenProfilesBtn()
        }
    }).observe(document.body, {childList: true, subtree: true})
}

function installSpaceFeedViewportRefresh() {
    if(spaceAssetNukeViewportListenerInstalled) return

    const scheduleFromResize = () => {
        const page = getPageType()
        if(page === 'profile-search') {
            scheduleProfileSearchControls(160)
            return
        }
        if(page !== 'space') return

        clearTimeout(spaceAssetNukeViewportTimeout)
        spaceAssetNukeViewportTimeout = setTimeout(() => {
            spaceAssetNukeViewportTimeout = null
            syncSpaceFeedCachedViewportControls()
        }, 160)
    }

    const scheduleFromScroll = () => {
        const page = getPageType()
        if(page === 'profile-search') {
            scheduleProfileSearchControls(220)
            return
        }
        if(page !== 'space') return

        if(Date.now() > spaceFeedScrollActiveUntil) recordSpaceMarkPerf('scrollStart')
        spaceFeedScrollActiveUntil = Date.now() + SPACE_FEED_SCROLL_IDLE_MS
        clearTimeout(spaceAssetNukeViewportTimeout)
        spaceAssetNukeViewportTimeout = setTimeout(() => {
            spaceAssetNukeViewportTimeout = null
            syncSpaceFeedCachedViewportControls()
            scheduleSpaceAssetNukeControls(0)
        }, SPACE_FEED_SCROLL_IDLE_MS)
    }

    window.addEventListener('resize', scheduleFromResize, {passive: true})
    window.addEventListener('scroll', scheduleFromScroll, {passive: true})
    spaceAssetNukeViewportListenerInstalled = true
}

function resetSpaceFeedScanCache() {
    latestSpaceFeedEntries = []
    discoveredSpaceFeedEntries = new Map()
    spaceFeedEntryCache = new Map()
    spaceFeedRootCache = new WeakMap()
    spaceFeedScopedStateSignature = ''
    spaceFeedScopedStateRefreshQueuedEntries = null
    spaceFeedScopedStateRefreshQueuedSignature = ''
}

function getSpaceFeedPostRootFromMutationNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || null
    if(!element || isExtensionOwnedNode(element)) return null

    const timestamp = element.matches?.('a.post_timestamp, a.answer_timestamp')
        ? element
        : element.querySelector?.('a.post_timestamp, a.answer_timestamp') || null
    if(timestamp) {
        return getSpaceFeedPostRoot(timestamp) || getSpaceFeedPreferredRoot(timestamp)
    }

    const markedRoot = element.closest?.('[data-mb-space-feed-post-key]')
    if(markedRoot) return markedRoot

    const likelyRoot = element.closest?.(SPACE_FEED_ROOT_SELECTOR)
    return likelyRoot?.querySelector?.('a.post_timestamp, a.answer_timestamp') ? likelyRoot : null
}

function invalidateSpaceFeedEntryCacheForMutations(mutations) {
    // Owner, 24 Oct: a structural change ends the reuse of the profile-link card scan, so the next render reads the page again.
    spaceFeedProfileLinkCardCache = null
    spaceFeedRenderModelMemo = null
    // Stage 1 (24 Oct): a structural change ends the reuse of the last feed scan.
    spaceFeedStructureVersion += 1
    noteSpaceFeedProfileLinkMutations(mutations)
    if(!spaceFeedEntryCache.size) return

    for(const mutation of mutations || []) {
        for(const node of [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]) {
            const postRoot = getSpaceFeedPostRootFromMutationNode(node)
            const timestamp = postRoot?.querySelector?.('a.post_timestamp, a.answer_timestamp')
            if(!postRoot || !timestamp) continue

            const postKey = getSpaceFeedPostKey(postRoot, timestamp)
            if(postKey) {
                spaceFeedEntryCache.delete(postKey)
            }
        }
    }
}

function isSpaceFeedMutationSignalNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || null
    if(!element || isExtensionOwnedNode(element)) return false

    if(element.matches?.('a.post_timestamp, a.answer_timestamp, a[href*="/profile/"]')) return true
    return !!element.querySelector?.('a.post_timestamp, a.answer_timestamp, a[href*="/profile/"]')
}

// 24 Oct: a profile dialog can open only when a dialog element is added to the page.
function mutationsMayInvolveDialog(mutations = []) {
    for(const mutation of mutations || []) {
        for(const node of Array.from(mutation.addedNodes || [])) {
            if(!(node instanceof Element)) continue
            if(node.matches?.('[role="dialog"], [aria-modal="true"]') || node.querySelector?.('[role="dialog"], [aria-modal="true"]')) return true
        }
    }
    return false
}

function hasSpaceFeedStructuralMutations(mutations) {
    for(const mutation of mutations || []) {
        if(mutation.type === 'childList') {
            const nodes = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]
            if(nodes.some(isSpaceFeedMutationSignalNode)) return true
        }
        else if(mutation.type === 'attributes' && mutation.attributeName === 'href') {
            if(isSpaceFeedMutationSignalNode(mutation.target)) return true
        }
    }

    return false
}

function syncSpaceFeedCachedViewportControls() {
    if(getPageType() !== 'space' || !latestSpaceFeedEntries.length || !isNukableSpacePage()) return false

    const entries = getLatestSpaceFeedEntries()
    const renderModel = buildSpaceFeedRenderModel(entries)
    syncSpaceFeedTopNukeButton(renderModel)
    syncSpaceFeedTopBarLayout()
    return true
}

function getCachedSpaceFeedEntries() {
    return latestSpaceFeedEntries.map(entry => ({
        ...entry,
        postKey: entry.postKey,
        postUrl: entry.postUrl,
        candidateUrls: [...entry.candidateUrls],
        resolutionReason: entry.resolutionReason || ''
    }))
}

function scheduleSpaceFeedProgressDrivenRefresh() {
    if(getPageType() !== 'space') return false

    const entries = getCachedSpaceFeedEntries()
    const hasActiveSpaceWork = getPendingCoordinatorSpaceFeedWorkCountForSpace() > 0 ||
        (entries.length ? hasActivePendingSpaceFeedWork(entries) : false)
    if(entries.length && isNukableSpacePage()) {
        const renderModel = buildSpaceFeedRenderModel(entries)
        syncSpaceFeedTopNukeButton(renderModel)
        syncSpaceFeedTopBarLayout()
        scheduleSpaceFeedProgressReconciliation(entries, 250)
    }

    scheduleSpaceAssetNukeControls(hasOwnedNukeWorkInFlight() || hasActiveSpaceWork
        ? 800
        : SPACE_FEED_PROGRESS_REFRESH_IDLE_MS)
    return true
}

function isExtensionOwnedNode(node) {
    let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || null

    while(current) {
        const classNames = Array.from(current.classList || [])
        if(classNames.some(name => name.startsWith('mb-ext_'))) return true
        current = current.parentElement
    }

    return false
}

function areExtensionOnlyMutations(mutations) {
    let sawExtensionNode = false

    for(const mutation of mutations || []) {
        if(mutation.type !== 'childList') return false

        for(const node of Array.from(mutation.addedNodes || [])) {
            if(!isExtensionOwnedNode(node)) return false
            sawExtensionNode = true
        }

        for(const node of Array.from(mutation.removedNodes || [])) {
            if(!isExtensionOwnedNode(node)) return false
            sawExtensionNode = true
        }
    }

    return sawExtensionNode
}

function syncProfileButtons() {
    injectCloseTabBtn()
    toggleUnblockUnmuteBtn()
    toggleMuteBlockBtn()
    toggleMuteBlockCloseBtn()
    positionProfileButtonRail(getProfileButtonInsertionTarget())
    void maybeClearCurrentProfileNukeStateFromLiveUnblocked()
    void maybeRecordAlreadyBlockedCoordinatorProfile()
    nudgeCurrentProfilePendingClaim()
}

function hasProfileButtons() {
    const hasCloseBtn = !!document.querySelector('.mb-ext_close-tab-btn')
    const hasUnblockBtn = !isProfileBlocked() || !!document.querySelector('.mb-ext_unblock-unmute-btn')
    const hasMuteBtn = !!document.querySelector('.mb-ext_mute-block-btn') || isProfileBlocked()
    const hasMuteCloseBtn = !!document.querySelector('.mb-ext_mute-block-close-btn') || isProfileBlocked()
    return hasCloseBtn && hasUnblockBtn && hasMuteBtn && hasMuteCloseBtn
}

function areProfileButtonsCorrectlyPlaced(target = getProfileButtonInsertionTarget()) {
    const closeBtn = document.querySelector('.mb-ext_close-tab-btn')
    const unblockBtn = document.querySelector('.mb-ext_unblock-unmute-btn')
    const muteBtn = document.querySelector('.mb-ext_mute-block-btn')
    const muteCloseBtn = document.querySelector('.mb-ext_mute-block-close-btn')

    if(!target) return !closeBtn && (!unblockBtn || !isProfileBlocked()) && (!muteBtn || isProfileBlocked()) && (!muteCloseBtn || isProfileBlocked())
    if(closeBtn && !isProfileTargetPlacement(closeBtn, target)) return false
    if(unblockBtn && !isProfileTargetPlacement(unblockBtn, target)) return false
    if(muteBtn && !isProfileTargetPlacement(muteBtn, target)) return false
    if(muteCloseBtn && !isProfileTargetPlacement(muteCloseBtn, target)) return false

    return isProfileButtonRailPositionCurrent(target)
}

function shouldRefreshProfileButtons(mutations) {
    if(profileButtonsPending || profileActionInProgress) return false

    const target = getProfileButtonInsertionTarget()
    if(hasProfileButtons() && areProfileButtonsCorrectlyPlaced(target)) return false

    const wantsRefresh = mutations.some(mutation => {
        return Array.from(mutation.removedNodes).some(node => {
            return node.nodeType === Node.ELEMENT_NODE &&
                (node.matches?.('.mb-ext_close-tab-btn, .mb-ext_unblock-unmute-btn, .mb-ext_mute-block-btn, .mb-ext_mute-block-close-btn') ||
                    node.querySelector?.('.mb-ext_close-tab-btn, .mb-ext_unblock-unmute-btn, .mb-ext_mute-block-btn, .mb-ext_mute-block-close-btn'))
        }) || Array.from(mutation.addedNodes).some(node => {
            return node.nodeType === Node.ELEMENT_NODE &&
                (node.matches?.('[role="menu"], [data-popper-placement], [aria-haspopup="menu"]') ||
                    node.querySelector?.('[role="menu"], [data-popper-placement], [aria-haspopup="menu"]'))
        })
    })
    if(!wantsRefresh) return false

    return admitProfileButtonsRefreshBurst()
}

// See PROFILE_BUTTONS_REFRESH_BURST_LIMIT above for why this exists: caps
// how many refreshes a single burst of qualifying mutations can trigger so
// a host re-render (or our own remove-then-recreate, if the insertion
// target's identity churns) can't keep re-satisfying
// shouldRefreshProfileButtons and flash the injected buttons/native menu
// indefinitely. Resets after a quiet gap, or explicitly on profile-key
// change (see startObserver).
function admitProfileButtonsRefreshBurst() {
    const now = Date.now()
    if(now - profileButtonsRefreshBurstStartedAt > PROFILE_BUTTONS_REFRESH_BURST_WINDOW_MS) {
        profileButtonsRefreshBurstStartedAt = now
        profileButtonsRefreshBurstCount = 0
    }
    profileButtonsRefreshBurstCount += 1
    return profileButtonsRefreshBurstCount <= PROFILE_BUTTONS_REFRESH_BURST_LIMIT
}

function resetProfileButtonsRefreshBurstGuard() {
    profileButtonsRefreshBurstCount = 0
    profileButtonsRefreshBurstStartedAt = 0
}

function scheduleProfileButtonsRefresh(delay = 400) {
    if(profileActionInProgress) return
    clearTimeout(profileButtonsRefreshTimeout)
    profileButtonsRefreshTimeout = setTimeout(() => ensureProfileButtons(), delay)
}

function clearProfileButtonsFollowUps() {
    for(const timeoutId of profileButtonsFollowUpTimeouts) {
        clearTimeout(timeoutId)
    }

    profileButtonsFollowUpTimeouts = []
}

function scheduleProfileButtonsFollowUps() {
    clearProfileButtonsFollowUps()

    const delays = [400, 1000, 2000, 3500]

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            if(getPageType() !== 'profile') return

            nudgeCurrentProfilePendingClaim()
            if(!profileActionInProgress) {
                ensureProfileButtons()
            }
        }, delay)

        profileButtonsFollowUpTimeouts.push(timeoutId)
    }
}

function ensureProfileButtons() {
    if(profileButtonsPending || profileActionInProgress) return

    profileButtonsPending = true
    clearTimeout(profileButtonsTimeout)

    const trySync = retriesLeft => {
        try {
            syncProfileButtons()
        }
        finally {
            const onProfilePage = getPageType() === 'profile'

            if(!onProfilePage || hasProfileButtons() || retriesLeft <= 0) {
                profileButtonsPending = false
            }
            else {
                profileButtonsTimeout = setTimeout(() => trySync(retriesLeft - 1), 250)
            }
        }
    }

    profileButtonsTimeout = setTimeout(() => trySync(20), 50)
}

function onMessage(request, sender, sendResponse) {
    if(request.action === 'unblock-unmute-profile') {
        return unblockUnmuteProfile({
            silent: !!request.silent,
            allowForegroundFallback: request.allowForegroundFallback !== false
        })
    }

    if(request.action === 'close-if-blocked') {
        if(`${request.actionKind || ''}` === UNBLOCK_UNMUTE_ACTION_KIND) {
            return Promise.resolve({willClose: false, reason: 'reverse-action'})
        }

        if(getPageType() === 'profile') {
            // getPageType() is URL-only; gate on real readiness (live 2026-09-29).
            const pageReady = document.readyState !== 'loading' &&
                (!!getProfileMenuButton() || !!getProfileUnavailableReason())
            if(!pageReady) return Promise.resolve({willClose: false, reason: 'not-ready', armed: false})
            const blocked = isProfileBlocked()
            // Often the first observer of blocked state on an attempt --
            // unconditional (not gated on activeQueuedAttemptId) since this
            // call site is always coordinator context already.
            reportInitialBlockedStateUnconditionally(blocked)

            if(blocked) {
                const requestedProfileHref = storedProfileHref(request?.requestedProfileHref || '') || ''
                const resolvedProfileHref = getProfileKey(location.href) || ''
                if(!requestedProfileHref || !resolvedProfileHref || requestedProfileHref !== resolvedProfileHref) {
                    return Promise.resolve({
                        willClose: false,
                        reason: 'profile-mismatch',
                        resolvedProfileHref,
                        lastUrl: location.href
                    })
                }

                // blockAttempted is a plain read of this tab's own in-memory
                // progress cache, set synchronously the moment blockProfile()
                // dispatches its click -- no storage round trip, so it's
                // available immediately here even when the durable
                // item.milestones.blockAttemptedAt write is still stuck behind
                // the shared coordinator storage-update queue. Lets the service
                // worker tell "we just blocked this" apart from "this was
                // already blocked" without waiting on that slower,
                // sometimes-backed-up channel (classifyBlockConfirmationFromItem,
                // sw.js).
                // The worker usually closes a tab that answers willClose, so a claim held for it must not run here. If the
                // worker declines to close it, the held claim is dropped and the worker's stale-claim check requeues the row.
                markQueuedTabFinishing()
                return Promise.resolve({
                    willClose: true,
                    resolvedProfileHref,
                    lastUrl: location.href,
                    blockAttempted: profileNukeProgress[resolvedProfileHref]?.blockAttempted === true
                })
            }
        }

        // A redirected profile (for example /profile/<slug> redirected to /<slug>) lands on Quora's
        // not-found page. That page is not a profile page, so it reaches this fall-through instead.
        if(isQuoraNotFoundPage()) {
            return Promise.resolve({willClose: false, reason: 'page-not-found', pageUnavailable: true, unavailableReason: 'Page Not Found', lastUrl: location.href})
        }
        return Promise.resolve({willClose: false, armed: false})
    }

    if(request.action === 'claim-current-profile-tab-action') {
        return acceptQueuedProfileActionClaim(request)
    }

    if(request.action === 'get-profile-action-surface-state') {
        const requestedProfileHref = normalizeQuoraProfileHref(request?.requestedProfileHref || '') || ''
        const resolvedProfileHref = getProfileKey(location.href) || ''
        const confirmationKind = getBlockConfirmAction()
            ? 'block'
            : getMuteConfirmAction()
            ? 'mute'
            : getUnblockConfirmAction()
            ? 'unblock'
            : getUnmuteConfirmAction()
            ? 'unmute'
            : ''
        return Promise.resolve({
            pageType: getPageType() || '',
            resolvedProfileHref,
            requestedProfileHref,
            profileMatches: !!requestedProfileHref && !!resolvedProfileHref && requestedProfileHref === resolvedProfileHref,
            pendingProfileConfirmation: !!confirmationKind,
            confirmationKind,
            profileActionInProgress
        })
    }

    switch(request.status) {
        case 'space-people-modal-loaded':
            injectModalOpenProfilesBtn()
            break
        case 'space-contributors-loaded': {
            injectModalOpenProfilesBtn()

            let btn = document.querySelector('.mb-ext_open-profiles-btn')

            if(btn && btn.disabled) {
                clearTimeout(profilesModalTimeout)
                setTimeout(openModalProfiles, 1e3)
            }

            break
        }
        case 'profile-followers-modal-loaded':
            injectModalOpenProfilesBtn()
            break
        case 'profile-followers-loaded':
        case 'profile-following-loaded': {
            injectModalOpenProfilesBtn()
            let btn = document.querySelector('.mb-ext_open-profiles-btn, .mb-ext_nuke-profiles-btn')

            if(btn && btn.disabled) {
                btn.disabled = false
                clearTimeout(profilesModalTimeout)
                setTimeout(openModalProfiles, 2e3)
            }
            break
        }
        case 'profile-block-updated':
            noteProfileBlockMutation()
            ensureProfileButtons()
            toggleMuteBlockBtn()
            break
        case 'owner-nuke-url-failed':
            void failCurrentQueuedProfile(request.url ? [request.url] : [])
            break
        case 'question-page-loaded':
            ensureQuestionPageFOPBtn()
            scheduleQuestionPageFollowUps()
            break
        case 'question-log-loaded':
            scheduleOriginalPosterRedirect()
            break
        case QUEUE_BAR_PUSH_ACTION:
            void refreshContentProgressBar(request.summary ?? null)
            break
        case PROFILE_NUKE_PROGRESS_PUSH_ACTION:
            // The worker pushes this when progress changed (decision 31). The page asks for its scoped state again, the same request it makes on load.
            scheduleContentPageStateProjectionRefresh()
            break
        default:
            reportUnhandledContentMessage(request, sender)
            break
    }
}

// review-2 C-7: a message that matches no handler was dropped without a trace. This reports the ones this extension sent with an
// action or status that nothing here handles. Messages from other senders are not reported.
function reportUnhandledContentMessage(request = {}, sender = {}) {
    const action = `${request?.action || ''}`.trim()
    const status = `${request?.status || ''}`.trim()
    if(!action && !status) return false
    if(!sender || sender.id !== browser.runtime?.id) return false
    console.info(`Unhandled content-script message: action=${action || '-'}, status=${status || '-'}`)
    return true
}

function ensureQuestionPageFOPBtn() {
    const expectedHref = getQuestionOriginalPosterLookupHref()
    let existingBtn = document.querySelector('.mb-ext_find-op-btn')

    if(existingBtn && existingBtn.href !== expectedHref) {
        removeQuestionPageBtn(existingBtn)
        existingBtn = null
    }

    if(existingBtn || questionPageBtnPending) return

    questionPageBtnPending = true
    clearTimeout(questionPageBtnTimeout)

    const tryInject = async retriesLeft => {
        let inserted = false

        try {
            inserted = await injectQuestionPageFOPBtn()
        }
        finally {
            if(inserted || retriesLeft <= 0) {
                questionPageBtnPending = false
            }
            else {
                questionPageBtnTimeout = setTimeout(() => tryInject(retriesLeft - 1), 750)
            }
        }
    }

    questionPageBtnTimeout = setTimeout(() => tryInject(20), settings.fopDelay)
}

function resetQuestionPageBtn() {
    clearTimeout(questionPageBtnTimeout)
    questionPageBtnPending = false
    clearQuestionPageFollowUps()

    document.querySelectorAll('.mb-ext_find-op-btn').forEach(removeQuestionPageBtn)
}

function clearQuestionPageFollowUps() {
    for(const timeoutId of questionPageFollowUpTimeouts) {
        clearTimeout(timeoutId)
    }

    questionPageFollowUpTimeouts = []
}

function scheduleQuestionPageFollowUps() {
    clearQuestionPageFollowUps()

    const delays = [1500, 4000, 8000, 12000]

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            if(getPageType() === 'question') {
                ensureQuestionPageFOPBtn()
            }
        }, delay)

        questionPageFollowUpTimeouts.push(timeoutId)
    }
}

function clearSpacePostFollowUps() {
    for(const timeoutId of spacePostFollowUpTimeouts) {
        clearTimeout(timeoutId)
    }

    spacePostFollowUpTimeouts = []
}

function scheduleSpacePostFollowUps() {
    clearSpacePostFollowUps()

    const delays = [800, 2000, 5000]

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            if(getPageType() === 'space-post' && !document.querySelector('.mb-ext_post-nuke-btn')) {
                scheduleSpacePostNukeBtn(150)
            }
        }, delay)

        spacePostFollowUpTimeouts.push(timeoutId)
    }
}

function clearSpacePageFollowUps() {
    for(const timeoutId of spacePageFollowUpTimeouts) {
        clearTimeout(timeoutId)
    }

    spacePageFollowUpTimeouts = []
}

function activateSpacePageControls(assetDelay = 180) {
    if(getPageType() !== 'space') return false

    injectSpaceSidebarOpenProfilesBtn()
    injectSpaceCollectButton()
    scheduleSpaceClassificationControls(0)
    if(shouldRefreshSpaceAssetNukeControls(null)) {
        scheduleSpaceAssetNukeControls(assetDelay)
    }

    return true
}

function scheduleSpacePageFollowUps() {
    clearSpacePageFollowUps()

    const delays = [800, 2000, 5000, 10000]
    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            activateSpacePageControls(0)
        }, delay)

        spacePageFollowUpTimeouts.push(timeoutId)
    }
}

function resetSpacePostNukeBtn() {
    clearTimeout(spacePostBtnTimeout)
    spacePostBtnPending = false
    clearSpacePostFollowUps()
}

function scheduleSpacePostNukeBtn(delay = 150) {
    if(spacePostBtnPending) return

    spacePostBtnPending = true
    clearTimeout(spacePostBtnTimeout)

    spacePostBtnTimeout = setTimeout(() => {
        try {
            if(getPageType() === 'space-post') {
                injectSpacePostNukeBtn()
            }
        }
        finally {
            spacePostBtnPending = false
        }
    }, delay)
}

function removeQuestionPageBtn(button) {
    let wrapper = button.closest('[data-mb-question-btn-wrapper]')
    if(wrapper) {
        wrapper.remove()
    }
    else {
        button.remove()
    }
}

// The Nuking drop-down (owner, 28 Oct). Each "Nuking" control on the space page and the profile search page gets a small menu beside it with
// Pause and Resume for the whole queue. The labels, items and messages come from nukingControl.js; this section places and wires the elements
// only. The paused flag is the stored one (COORDINATOR_PAUSED_KEY): refreshContentProgressBar reads it and its storage listener keeps it current.
function nukingControlPageAllowed() {
    const pageType = getPageType()
    return pageType === 'space' || pageType === 'profile-search'
}

function setNukingQueuePaused(paused) {
    const next = !!paused
    if(next === nukingQueuePaused) return
    nukingQueuePaused = next
    refreshNukingPauseDisplay()
}

// The status texts and the drop-downs follow the pause flag at once. Each page redraws its own toolbar.
function refreshNukingPauseDisplay() {
    const pageType = getPageType()
    if(pageType === 'space') syncSpaceFeedNukeControls()
    else if(pageType === 'profile-search') scheduleProfileSearchControls(0)
    syncNukingControlViews()
}

function setNukingMenuOpen(control, open) {
    const menu = control.querySelector('.mb-ext_nuking-control-menu')
    const toggle = control.querySelector('.mb-ext_nuking-control-toggle')
    if(menu) menu.hidden = !open
    toggle?.setAttribute('aria-expanded', open ? 'true' : 'false')
}

function closeNukingMenus(except = null) {
    for(const anchor of nukingControlAnchors) {
        const control = nukingControlByAnchor.get(anchor)
        if(control && control !== except) setNukingMenuOpen(control, false)
    }
}

function installNukingControlDocumentListener() {
    if(nukingControlDocumentListenerInstalled) return
    nukingControlDocumentListenerInstalled = true
    // A click outside a drop-down closes it. A click inside one stops at the drop-down (buildNukingControl), so it never gets here.
    document.addEventListener('click', () => closeNukingMenus(null))
}

// The drop-down's text, hover help and items for the current pause state (nukingControlView builds them).
function updateNukingControlView(control) {
    const toggle = control.querySelector('.mb-ext_nuking-control-toggle')
    if(!toggle) return
    const left = Number.parseInt(control.dataset.mbNukingLeft, 10) || 0
    const view = nukingControlView(nukingQueuePaused, left)
    toggle.textContent = `${view.toggleLabel} ▾`
    setMuteBlockHelp(toggle, view.toggleHelpText)
    for(const item of view.items) {
        const element = control.querySelector(`[data-mb-nuking-item="${item.id}"]`)
        if(!element) continue
        element.textContent = item.label
        element.disabled = !item.enabled
        element.setAttribute('aria-disabled', item.enabled ? 'false' : 'true')
        setMuteBlockHelp(element, item.helpText)
    }
}

function buildNukingControl() {
    const control = document.createElement('span')
    control.className = 'mb-ext_nuking-control'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'mb-ext_nuking-control-toggle'
    toggle.setAttribute('aria-haspopup', 'menu')
    toggle.setAttribute('aria-expanded', 'false')
    const menu = document.createElement('span')
    menu.className = 'mb-ext_nuking-control-menu'
    menu.setAttribute('role', 'menu')
    menu.hidden = true
    for(const id of ['pause', 'resume']) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'mb-ext_nuking-control-item'
        item.setAttribute('role', 'menuitem')
        item.dataset.mbNukingItem = id
        menu.appendChild(item)
    }
    control.append(toggle, menu)

    // The drop-down's own clicks stop here: they never reach the Nuke button beside it, the post, or the page's handlers, and never start a batch.
    for(const type of ['mousedown', 'pointerdown', 'click']) {
        control.addEventListener(type, event => {
            event.stopPropagation()
            if(type === 'click') event.preventDefault()
        })
    }
    toggle.addEventListener('click', () => {
        const open = menu.hidden
        closeNukingMenus(control)
        setNukingMenuOpen(control, open)
    })
    for(const item of menu.querySelectorAll('.mb-ext_nuking-control-item')) {
        item.addEventListener('click', () => {
            setNukingMenuOpen(control, false)
            const left = Number.parseInt(control.dataset.mbNukingLeft, 10) || 0
            const entry = nukingControlView(nukingQueuePaused, left).items.find(candidate => candidate.id === item.dataset.mbNukingItem)
            // The item sends the same message the dashboard's Pause Current Work button sends for the state it is shown in.
            if(!entry?.enabled) return
            void Promise.resolve().then(() => browser.runtime.sendMessage(entry.message)).catch(() => null)
        })
    }
    installNukingControlDocumentListener()
    return control
}

// Removes the drop-downs whose anchor has left the page, so a redrawn button does not leave one behind.
function pruneNukingControls() {
    for(const anchor of Array.from(nukingControlAnchors)) {
        if(!anchor.isConnected) detachNukingControl(anchor)
    }
}

function attachNukingControl(anchor, left = 0) {
    if(!anchor || !anchor.isConnected || !anchor.parentNode) return
    pruneNukingControls()
    let control = nukingControlByAnchor.get(anchor)
    if(!control || !control.isConnected) {
        control = buildNukingControl()
        nukingControlByAnchor.set(anchor, control)
        nukingControlAnchors.add(anchor)
        anchor.parentNode.insertBefore(control, anchor.nextSibling)
    }
    control.dataset.mbNukingLeft = `${Math.max(0, Math.floor(Number(left) || 0))}`
    updateNukingControlView(control)
}

function detachNukingControl(anchor) {
    if(!anchor) return
    nukingControlByAnchor.get(anchor)?.remove()
    nukingControlByAnchor.delete(anchor)
    nukingControlAnchors.delete(anchor)
}

function syncNukingControlViews() {
    pruneNukingControls()
    for(const anchor of nukingControlAnchors) {
        const control = nukingControlByAnchor.get(anchor)
        if(control) updateNukingControlView(control)
    }
}

// A Nuking button gets the drop-down while it reads Nuking; any other state (Queueing, Collecting, Done) removes it.
function syncNukingControlForButton(button, label) {
    if(nukingControlPageAllowed() && /^Nuking/.test(`${label || ''}`)) attachNukingControl(button, 0)
    else detachNukingControl(button)
}

// The one toolbar status both batch pages use (28 Oct): the same class, placed directly after the page's batch button (Nuke 'Em), the same
// words from formatToolbarNukingStatus, and the same drop-down. Both pages call this builder; the class and the style rule
// (.mb-ext_nuking-status in content.css) are shared, so the two toolbars cannot drift apart.
// The drop-down goes beside the status when showsControl is set: by default when the text shows nuking work or a paused queue
// (nukingStatusShowsControl). The space page passes its own flag, since its drop-down carries the Nuking words (30 Oct).
const NUKING_TOOLBAR_STATUS_CLASS = 'mb-ext_nuking-status'

function syncNukingToolbarStatus(host, anchor, text, left = 0, showsControl = nukingStatusShowsControl(text)) {
    if(!host) return
    const existing = host.querySelector(`.${NUKING_TOOLBAR_STATUS_CLASS}`)
    if(!text && !showsControl) {
        detachNukingControl(existing)
        existing?.remove()
        return
    }
    const status = existing || document.createElement('span')
    status.className = NUKING_TOOLBAR_STATUS_CLASS
    status.textContent = text
    if(!existing) {
        if(anchor && host.contains(anchor)) anchor.insertAdjacentElement('afterend', status)
        else host.appendChild(status)
    }
    if(nukingControlPageAllowed() && showsControl) attachNukingControl(status, left)
    else detachNukingControl(status)
}

function setNukeButtonIdle(button, label = `Nuke 'Em`) {
    if(!button) return
    detachNukingControl(button)
    if(button.dataset.mbNukeState === 'idle' && button.innerText === label &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--flash') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--pressed') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--working') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--done')) {
        return
    }
    button.dataset.mbNukeState = 'idle'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--pressed', 'mb-ext_nuke-profiles-btn--working', 'mb-ext_nuke-profiles-btn--done', 'mb-ext_nuke-profiles-btn--bad-links')
    button.innerText = label
}

function setNukeButtonWorking(button, label = formatProfileRowState('nuking')) {
    if(!button) return
    syncNukingControlForButton(button, label)
    if(button.dataset.mbNukeState === 'working' && button.innerText === label &&
        button.classList.contains('mb-ext_nuke-profiles-btn--working') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--flash') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--done')) {
        return
    }
    button.dataset.mbNukeState = 'working'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--pressed', 'mb-ext_nuke-profiles-btn--done', 'mb-ext_nuke-profiles-btn--bad-links')
    button.classList.add('mb-ext_nuke-profiles-btn--working')
    button.innerText = label
}

function setNukeButtonDone(button, label = NUKED_LABEL) {
    if(!button) return
    detachNukingControl(button)
    if(button.dataset.mbNukeState === 'done' && button.innerText === label &&
        button.classList.contains('mb-ext_nuke-profiles-btn--done') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--flash') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--pressed') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--working')) {
        return
    }
    button.dataset.mbNukeState = 'done'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--pressed', 'mb-ext_nuke-profiles-btn--working', 'mb-ext_nuke-profiles-btn--bad-links')
    button.classList.add('mb-ext_nuke-profiles-btn--done')
    button.innerText = label
}

// Owner, 23 Oct: errors on a post and nothing left to queue. The button is white and lists the profiles that failed on hover.
function setNukeButtonBadLinks(button, label = 'Bad Links') {
    if(!button) return
    detachNukingControl(button)
    button.dataset.mbNukeState = 'bad-links'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--pressed', 'mb-ext_nuke-profiles-btn--working', 'mb-ext_nuke-profiles-btn--done')
    button.classList.add('mb-ext_nuke-profiles-btn--bad-links')
    button.innerText = label
}

// Owner, 29 Oct: the Bad Links list beside the button, kept inside the post's controls. It only links to the profiles; nothing is queued from it.
function syncSpaceFeedBadLinkList(host, details = []) {
    if(!host) return
    let list = host.querySelector(':scope > .mb-ext_space-feed-bad-links')
    if(!details.length) {
        list?.remove()
        return
    }
    if(!list) {
        list = document.createElement('div')
        list.className = 'mb-ext_space-feed-bad-links'
        list.hidden = true
        // A click inside the list stays in the list: it does not reach the post or the page's own handlers.
        list.addEventListener('click', event => event.stopPropagation())
        host.appendChild(list)
        bindSpaceFeedBadLinkEscape()
    }
    const key = JSON.stringify(details)
    if(list.dataset.mbBadLinkKey === key) return
    list.dataset.mbBadLinkKey = key
    list.textContent = ''
    for(const detail of details) list.appendChild(buildSpaceFeedBadLinkRow(detail))
}

function buildSpaceFeedBadLinkRow(detail) {
    const row = document.createElement('div')
    row.className = 'mb-ext_space-feed-bad-links-row'
    const link = document.createElement('a')
    link.className = 'mb-ext_space-feed-bad-links-link'
    link.href = detail.href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = detail.name
    setMuteBlockHelp(link, `Open ${detail.name} on Quora to block it by hand`)
    const reason = document.createElement('span')
    reason.className = 'mb-ext_space-feed-bad-links-reason'
    reason.textContent = detail.reason
    row.appendChild(link)
    row.appendChild(reason)
    return row
}

// Owner, 29 Oct: a click on a Bad Links button shows or hides its list. It never starts a batch and never changes queue or storage state.
function toggleSpaceFeedBadLinkListFromClick(button) {
    if(button?.dataset?.mbNukeState !== 'bad-links') return false
    const list = button.parentElement?.querySelector(':scope > .mb-ext_space-feed-bad-links')
    if(list) list.hidden = !list.hidden
    return true
}

let spaceFeedBadLinkEscapeBound = false
// Escape closes any open Bad Links list. Bound once for the page.
function bindSpaceFeedBadLinkEscape() {
    if(spaceFeedBadLinkEscapeBound) return
    spaceFeedBadLinkEscapeBound = true
    document.addEventListener('keydown', event => {
        if(event.key !== 'Escape') return
        for(const list of document.querySelectorAll('.mb-ext_space-feed-bad-links:not([hidden])')) list.hidden = true
    })
}

function setNukeButtonNotice(button, label, restoreLabel = `Nuke 'Em`) {
    if(!button) return

    setNukeButtonIdle(button, label)
    const noticeToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    button.dataset.mbNukeNoticeToken = noticeToken
    setTimeout(() => {
        if(!button.isConnected) return
        if(button.dataset.mbNukeNoticeToken !== noticeToken) return
        if(button.dataset.mbNukeState !== 'idle' || button.innerText !== label) return

        delete button.dataset.mbNukeNoticeToken
        setNukeButtonIdle(button, restoreLabel)
    }, 1800)
}

async function animateNukeButtonPress(button) {
    if(!button) return

    button.classList.remove('mb-ext_nuke-profiles-btn--flash')
    button.classList.remove('mb-ext_nuke-profiles-btn--pressed', 'mb-ext_nuke-profiles-btn--working', 'mb-ext_nuke-profiles-btn--done')
    await waitForAnimationFramePair({timeoutMs: 120})
    button.classList.add('mb-ext_nuke-profiles-btn--pressed')
    button.classList.add('mb-ext_nuke-profiles-btn--flash')
    await sleep(360)
    button.classList.remove('mb-ext_nuke-profiles-btn--flash')
}

function waitForAnimationFramePair(options = {}) {
    const timeoutMs = Math.max(16, Number.parseInt(options.timeoutMs, 10) || 120)
    return new Promise(resolve => {
        let settled = false
        const finish = () => {
            if(settled) return
            settled = true
            clearTimeout(timeoutId)
            resolve()
        }
        const timeoutId = setTimeout(finish, timeoutMs)

        try {
            requestAnimationFrame(() => requestAnimationFrame(finish))
        }
        catch {
            finish()
        }
    })
}

function installNavigationHooks() {
    if(window.__mbNavHooksInstalled) return
    window.__mbNavHooksInstalled = true

    const notify = () => {
        setTimeout(() => {
            if(location.href === currentUrl) return

            currentUrl = location.href
            clearTimeout(profileButtonsTimeout)
            profileButtonsPending = false
            clearProfileButtonsFollowUps()
            resetQuestionPageBtn()
            resetSpacePostNukeBtn()
            resetProfileSearchControls()
            resetSpaceAssetNukeControls()

            if(maybeRedirectToCanonicalProfileUrl()) {
                return
            }

            const page = getPageType()
            setStorageChangeListenerEnabled(page !== 'profile-search')
            if(page !== 'profile') resetProfileButtonRail()

            if(page === 'profile') {
                ensureProfileButtons()
                scheduleProfileButtonsFollowUps()
            }
            else if(page === 'space-post') {
                scheduleSpacePostNukeBtn()
                scheduleSpacePostFollowUps()
            }
            else if(page === 'space') {
                activateSpacePageFromNavigation()
            }
            else if(page === 'question') {
                ensureQuestionPageFOPBtn()
                scheduleQuestionPageFollowUps()
            }
            else if(page === 'profile-search') {
                scheduleProfileSearchControls(0)
                scheduleProfileSearchFollowUps()
            }

            scheduleSpacePageFollowUps()
            void maybeRunAutoProfileAction()
        }, 0)
    }

    addEventListener('popstate', notify)
    addEventListener('hashchange', notify)

    for(const method of ['pushState', 'replaceState']) {
        const original = history[method]

        history[method] = function(...args) {
            const result = original.apply(this, args)
            notify()
            return result
        }
    }
}

// The observer's check: any copy of the space header whose category set is missing or out of date (29 Oct).
function shouldRefreshSpaceClassificationControls() {
    if(!spaceRegistryLoaded) return false
    const space = resolveCurrentSpaceDescriptor()
    if(!space) return false
    return getSpaceHeaderContainers().some(header => shouldRefreshSpaceClassificationControlsInHeader(header, space))
}

function shouldRefreshSpaceClassificationControlsInHeader(header, space) {
    const host = header.querySelector('.mb-ext_space-category-host')
    if(!host) return true
    if(host.dataset.mbSpaceKey !== space.key) return true

    const activeCategory = getStoredSpaceCategory(space)
    if((host.dataset.mbSpaceCategory || '') !== activeCategory) return true

    const buttons = Array.from(host.querySelectorAll('.mb-ext_space-category-btn'))
    if(buttons.length !== SPACE_CATEGORIES.length) return true

    return SPACE_CATEGORIES.some(category => {
        const button = host.querySelector(`.mb-ext_space-category-btn[data-category="${category}"]`)
        if(!button) return true

        const isActive = category === activeCategory
        return button.dataset.active !== (isActive ? 'true' : 'false')
    })
}

function scheduleSpaceClassificationControls(delay = 150) {
    if(spaceClassificationPending && delay !== 0) return

    spaceClassificationPending = true
    clearTimeout(spaceClassificationTimeout)
    spaceClassificationTimeout = setTimeout(() => {
        spaceClassificationTimeout = null
        spaceClassificationPending = false
        syncSpaceClassificationControls()
    }, Math.max(0, delay))
}

function shouldRefreshSpaceAssetNukeControls(mutations = null) {
    if(getPageType() !== 'space') return false

    const main = getSpaceFeedContentRoot()
    const storedEntryCount = Number.parseInt(main?.dataset.mbSpaceFeedEntryCount || '-1', 10)
    const storedPostButtonCount = Number.parseInt(main?.dataset.mbSpaceFeedPostButtonCount || '-1', 10)
    const hasStatusButton = !!document.querySelector('.mb-ext_space-feed-status-btn')
    const livePostButtonCount = getSpaceFeedPostHostsInDocument().length

    if(!hasStatusButton) return true

    if(isNukableSpacePage()) {
        if(storedEntryCount < 0) return true
        if(storedEntryCount > 0) {
            if(!document.querySelector('.mb-ext_space-feed-nuke-btn')) return true
            if(storedPostButtonCount < 0) return true
            if(livePostButtonCount !== storedPostButtonCount) return true
        }
        return !mutations || hasSpaceFeedStructuralMutations(mutations)
    }

    return !!document.querySelector('.mb-ext_space-feed-nuke-host, .mb-ext_space-feed-post-nuke-host')
}

function resetSpaceAssetNukeControls() {
    clearTimeout(spaceAssetNukeTimeout)
    spaceAssetNukeTimeout = null
    spaceAssetNukePending = false
    spaceAssetNukeScheduledAt = 0
    clearTimeout(spaceAssetNukeViewportTimeout)
    spaceAssetNukeViewportTimeout = null
    clearSpacePageFollowUps()
}

function getSpaceAssetNukeRefreshDelay(delay) {
    if(delay === 0) return 0

    const scrollRemaining = spaceFeedScrollActiveUntil - Date.now()
    return Math.max(0, delay, scrollRemaining > 0 ? scrollRemaining + SPACE_FEED_SCROLL_REFRESH_GRACE_MS : 0)
}

// Owner, 24 Oct: renders driven by scrolling and page changes are kept at least SPACE_FEED_RENDER_MIN_GAP_MS apart.
let lastSpaceAssetNukeRenderAt = 0

function scheduleSpaceAssetNukeControls(delay = 180) {
    const renderGapDelay = Math.max(0, lastSpaceAssetNukeRenderAt + SPACE_FEED_RENDER_MIN_GAP_MS - Date.now())
    const adjustedDelay = Math.max(getSpaceAssetNukeRefreshDelay(delay), renderGapDelay)
    const scheduledAt = Date.now() + adjustedDelay

    if(spaceAssetNukePending && delay !== 0 && scheduledAt <= spaceAssetNukeScheduledAt + 40) return

    spaceAssetNukePending = true
    spaceAssetNukeScheduledAt = scheduledAt
    clearTimeout(spaceAssetNukeTimeout)
    spaceAssetNukeTimeout = setTimeout(() => {
        void (async () => {
            spaceAssetNukeTimeout = null
            spaceAssetNukePending = false
            spaceAssetNukeScheduledAt = 0
            // 24 Oct: the owned status is waited for only briefly. A slow answer lands in the cache for the next redraw, and the redraw does not wait for it.
            if(getPageType() === 'space') {
                const ownedStatusRefresh = refreshOwnedNukeStatusCacheIfStale().catch(() => null)
                await Promise.race([ownedStatusRefresh, sleep(OWNED_NUKE_STATUS_WAIT_MS)])
            }
            suppressSpaceAssetNukeRefreshUntil = Date.now() + 250
            lastSpaceAssetNukeRenderAt = Date.now()
            syncSpaceFeedNukeControls()
        })()
    }, adjustedDelay)
}

function isQuoraSpaceSubdomainRootPage() {
    const host = location.hostname.toLowerCase()
    if(host === 'www.quora.com' || !host.endsWith('.quora.com')) return false

    const rootPath = location.pathname.replace(/\/+$/, '')
    if(rootPath !== '') return false
    if(isSecurityVerificationPage()) return false

    return !!document.querySelector(
        'a.post_timestamp, a.answer_timestamp, .post_timestamp, ' +
        'link[href*="page-TribeMainPageLoadable"], script[src*="page-TribeMainPageLoadable"]'
    )
}

function pathnameHasSegment(pathname = '', segment = '') {
    const normalizedSegment = `${segment || ''}`.toLowerCase()
    if(!normalizedSegment) return false

    const normalizedPathname = `${pathname || ''}`.toLowerCase()
    const parts = normalizedPathname.split('/').filter(Boolean)
    return parts.includes(normalizedSegment)
}

function getPageType() {
    const params = new URLSearchParams(location.search)
    const pathname = location.pathname || ''
    const title = document.title || ''

    if(getProfileKey(location.href) && params.get('__nsrc__') !== 'notif_page') {
        return 'profile'
    }
    else if(pathnameHasSegment(pathname, 'log') || title.toLowerCase().includes('question log')) {
        return 'question-log'
    }
    else if(pathname.toLowerCase() === '/topic' || pathname.toLowerCase().startsWith('/topic/')) {
        return 'topic'
    }
    else if(isProfileSearchPage()) {
        return 'profile-search'
    }
    else if(document.querySelector('.puppeteer_test_tribe_info_header')) {
        return 'space'
    }
    else if(isQuoraSpaceSubdomainRootPage()) {
        return 'space'
    }
    else if(isSpacePostPage()) {
        return 'space-post'
    }
    else if(isQuestionPage()) {
        return 'question'
    }

    return false
}

function isProfileSearchPage() {
    if(location.hostname.toLowerCase() !== 'www.quora.com') return false
    if((location.pathname || '').toLowerCase() !== '/search') return false

    const params = new URLSearchParams(location.search)
    return `${params.get('type') || ''}`.toLowerCase() === 'profile'
}

function maybeRedirectToCanonicalProfileUrl() {
    const profileHref = getProfileKey(location.href)
    if(!profileHref) return false

    try {
        const currentLocation = new URL(location.href)
        if(currentLocation.pathname.split('/').filter(Boolean)[0]?.toLowerCase() !== 'profile') {
            return false
        }
        if(isSecurityVerificationPage()) {
            return false
        }

        const currentParts = currentLocation.pathname.split('/').filter(Boolean)
        const canonicalLocation = new URL(profileHref)

        if(currentParts[0]?.toLowerCase() === 'profile' && currentLocation.pathname === canonicalLocation.pathname) {
            return false
        }

        // Quora sometimes prefers non-/profile aliases or challenge interstitials for the
        // same profile. Only trim extra path segments from explicit /profile routes so the
        // extension does not fight Quora’s own redirects and create navigation loops.
        location.replace(`${profileHref}${currentLocation.search}${currentLocation.hash}`)
        return true
    }
    catch {
        return false
    }
}

function isQuestionPage() {
    if(/\/answer\//i.test(location.pathname)) return false

    // Trust concrete question-page markers before the Cloudflare/security heuristic.
    // Some real Quora question pages include enough challenge text in the DOM to
    // trigger the heuristic even though the page is fully loaded and usable.
    if(document.querySelector('.puppeteer_test_question_main')) return true
    if(findQuestionSortContainer()) return true

    if(isSecurityVerificationPage()) return false

    const articleMeta = document.querySelector('meta[property="og:type"][content="article"]')
    if(articleMeta) return !!getQuestionMain()

    const parts = location.pathname.split('/').filter(Boolean)
    const firstPart = (parts[0] || '').toLowerCase()
    if(firstPart === 'unanswered') return !!document.querySelector('h1, [role="heading"]')
    if(parts.length !== 1 || QUORA_NON_PROFILE_ROOT_PATHS.has(firstPart)) return false

    return firstPart.includes('-') && !!document.querySelector('h1, [role="heading"]')
}

function isSpacePostPage() {
    if(document.querySelector('.puppeteer_test_tribe_info_header')) {
        return false
    }

    const hasTimestamp = !!document.querySelector('a.post_timestamp, .post_timestamp')
    if(!hasTimestamp) return false

    if(document.querySelector('link[href*="page-TribeItemPageLoadable"], script[src*="page-TribeItemPageLoadable"]')) {
        return true
    }

    if(document.querySelector('link[href*="page-TribeMainPageLoadable"], script[src*="page-TribeMainPageLoadable"]')) {
        return true
    }

    return Array.from(document.scripts || []).some(script => {
        const text = script.textContent || ''
        return text.includes('TribeItemPageLoadable') || text.includes('TribeMainPageLoadable')
    })
}

function findQuestionSortContainer(root = document) {
    const XPATH = ".//div[contains(@class, 'qu-justifyContent--space-between') and contains(string(), 'Sort')]"
    const query = document.evaluate(XPATH, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
    let bestMatch = null

    for(let index = 0; index < query.snapshotLength; index++) {
        const container = query.snapshotItem(index)
        if(!container || !isVisible(container)) continue

        const score = scoreQuestionSortContainer(container)
        const top = container.getBoundingClientRect().top

        if(!bestMatch ||
            score > bestMatch.score ||
            (score === bestMatch.score && top < bestMatch.top)) {
            bestMatch = {container, score, top}
        }
    }

    return bestMatch?.container || null
}

function getQuestionMain() {
    const questionMain = document.querySelector('.puppeteer_test_question_main')
    if(questionMain) return questionMain

    if(isSecurityVerificationPage()) return null

    const sortContainer = findQuestionSortContainer()
    if(sortContainer) {
        return sortContainer.closest('.puppeteer_test_question_main, #mainContent, main, [role="main"]') ||
            document.querySelector('#mainContent, main, [role="main"]')
    }

    if(!document.querySelector('meta[property="og:type"][content="article"]')) return null

    const selectors = ['#mainContent', 'main', '[role="main"]']

    for(const selector of selectors) {
        const element = document.querySelector(selector)
        if(element) return element
    }

    return null
}

function getSecurityVerificationReason() {
    const title = (document.title || '').toLowerCase()
    const bodyText = (document.body?.innerText || '').toLowerCase()

    if(title.includes('just a moment')) return 'title:just-a-moment'
    if(title.includes('security verification')) return 'title:security-verification'
    if(bodyText.includes('performing security verification')) return 'body:performing-security-verification'
    if(bodyText.includes('verify you are human')) return 'body:verify-you-are-human'

    return ''
}

function isSecurityVerificationPage() {
    return !!getSecurityVerificationReason()
}

// Cloudflare's own challenge-token query parameters, present on the
// interstitial URL itself -- unlike getSecurityVerificationReason's
// title/body-text heuristics, this fires immediately (even before the
// challenge page's DOM has rendered) and is specific to Cloudflare rather
// than Quora's other security-verification interstitials. Confirmed as the
// definitive signal during the 2026-09-12 incident: profiles that looked
// "stuck" for ~30-90s (Ray-Savage-52 and others) were sitting on this
// interstitial the whole time, not failing inside the extension.
//
// 2026-09-25: matching only the exact key `__cf_chl_tk` missed a live
// incident where Cloudflare was issuing `__cf_chl_rt_tk` instead (a profile,
// Emily-22838, sat behind an unreported challenge for 2+ minutes with the
// coordinator endlessly retrying a claim against a page that could never
// resolve on its own). Cloudflare has used several `__cf_chl_*_tk` variants
// over time (`__cf_chl_jschl_tk`, `__cf_chl_captcha_tk`, `__cf_chl_rt_tk`,
// ...) for different challenge types, so matching the shared `__cf_chl`
// prefix instead of one exact key is the resilient check -- it doesn't
// depend on knowing every variant Cloudflare currently issues or issues next.
function isCloudflareChallengePage() {
    try {
        const params = new URLSearchParams(location.search)
        for(const key of params.keys()) {
            if(key.startsWith('__cf_chl')) return true
        }
        return false
    }
    catch {
        return false
    }
}

// Fire-and-forget, once per content-script lifetime (a solved challenge
// navigates/reloads the real page, which reinjects a fresh content script
// with its own fresh flag) -- callers can check this cheaply on every retry
// tick of a stuck page without spamming the SW with a message per tick.
function maybeReportCloudflareChallenge() {
    if(cloudflareChallengeReported) return
    if(!isCloudflareChallengePage()) return
    cloudflareChallengeReported = true
    void safeSendRuntimeMessageWithTimeout({
        action: 'cloudflare-challenge-detected',
        href: location.href
    }, null, QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS)
}

function isSecurityVerificationProgressRecord(record) {
    if(!record?.securityVerification) return false

    const text = [
        record.securityVerificationReason,
        record.finalError,
        record.errorPageUrl,
        record.lastUrl,
        ...(Array.isArray(record.events) ? record.events : [])
    ].join(' ')

    return /security verification|verify you are human|just a moment|performing security verification|challenge-platform|cdn-cgi|turnstile/i.test(text)
}

function getProfileUnavailableReason() {
    if(!getProfileKey(location.href)) return ''

    const title = (document.title || '').toLowerCase()
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase()

    // Quora-enforced terminal states (the account itself was banned/disabled
    // by Quora, not merely missing) are distinguished from generic
    // not-found cases so callers can treat them as equivalent to an
    // already-completed block rather than a transient skip.
    const enforcedPatterns = [
        // Quora can expose this phrase with dropped "s" glyphs in innerText.
        /\bthis? (?:profile|user|account) has? been (?:unavailable|disabled|deactivated|deleted|suspended|restricted|banned)\b/,
        /\bthis (?:profile|user|account) (?:(?:is|has been) )?(?:unavailable|disabled|deactivated|deleted|suspended|restricted|banned)\b/,
        /\b(?:profile|user|account) (?:(?:is|has been) )?(?:unavailable|disabled|deactivated|deleted|suspended|restricted|banned)\b/
    ]
    const notFoundPatterns = [
        /\buser not found\b/,
        /\bprofile not found\b/,
        /\bpage not found\b/,
        /\b(?:profile|user|account) (?:does not|doesn't) exist\b/,
        /\bno longer exists\b/
    ]
    const matches = pattern => pattern.test(title) || pattern.test(bodyText)

    // Deactivated accounts are reported apart from banned ones (31 Oct): the page wording is the only signal.
    if(enforcedPatterns.some(matches)) return matches(/\bdeactivated\b/) ? 'Profile deactivated' : 'Profile banned'
    if(notFoundPatterns.some(matches)) return 'Profile unavailable'

    return ''
}

function isQuoraNotFoundPage() {
    const bodyText = (document.body?.innerText || '').replace(/s+/g, ' ').trim().toLowerCase()
    return /\bpage not found\b/.test(bodyText) && /couldn'?t find the page you were looking for/.test(bodyText)
}

function getQuestionLogHref() {
    return location.origin + location.pathname.replace(/\/$/, '') + '/log'
}

function getQuestionOriginalPosterLookupHref() {
    return `${getQuestionLogHref()}?mb_op=1`
}

function shouldAutoRedirectToOriginalPoster() {
    const params = new URLSearchParams(location.search)
    return params.get('mb_op') === '1'
}

function getQuestionDebugState() {
    const sortContainer = getSortContainer()?.container
    const filterButton = getQuestionFilterButton(sortContainer)
    const actionTarget = getQuestionButtonInsertionTarget()

    return {
        url: location.href,
        title: document.title,
        pageType: getPageType(),
        hasQuestionMain: !!document.querySelector('.puppeteer_test_question_main'),
        hasSortContainer: !!sortContainer,
        filterText: getElementText(filterButton),
        targetType: actionTarget?.type || null,
        hasExistingButton: !!document.querySelector('.mb-ext_find-op-btn')
    }
}

const MAX_ELEMENT_TEXT_CHARS = 4096

function compactElementText(text = '', maxChars = MAX_ELEMENT_TEXT_CHARS) {
    const input = `${text || ''}`
    const limit = Math.min(input.length, maxChars)
    let output = ''
    let pendingSpace = false

    for(let index = 0; index < limit; index += 1) {
        const char = input[index]
        const code = char.charCodeAt(0)
        const isWhitespace = code <= 32 || code === 160
        if(isWhitespace) {
            pendingSpace = output.length > 0
            continue
        }

        if(pendingSpace) {
            output += ' '
            pendingSpace = false
        }
        output += char
    }

    return output
}

function getElementText(element) {
    return compactElementText(element?.innerText || element?.textContent || '')
}

function isVisible(element) {
    if(!element) return false

    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()

    return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
}

function getQuestionPrimaryAction() {
    const main = getQuestionMain() || document.querySelector('#mainContent')
    if(!main) return null

    const candidates = Array.from(main.querySelectorAll('button, a, [role="button"]')).filter(candidate => {
        if(!isVisible(candidate)) return false

        const text = getElementText(candidate)
        return /^(answer|follow|request)\b/i.test(text)
    })

    candidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return candidates[0] || null
}

function isProfilePrimaryActionText(text) {
    return /^(follow|follow back|following|requested)$/i.test(text)
}

function isProfileSecondaryActionText(text) {
    return /^(notify me|ask|message)$/i.test(text)
}

function isProfileActionText(text) {
    return isProfilePrimaryActionText(text) || isProfileSecondaryActionText(text)
}

function getProfilePrimaryAction() {
    const actionRow = getProfileActionRow()
    if(!actionRow) return null

    const actionButtons = getVisibleButtons(actionRow).filter(button => {
        return isProfilePrimaryActionText(getElementText(button))
    })
    actionButtons.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.left - rightRect.left || leftRect.top - rightRect.top
    })

    return actionButtons[0] || null
}

// Cheap, page-DOM-only safety check: a maintained followers list isn't
// practical to get out of Quora, but the profile's own primary action
// button already tells us the current relationship at the moment we're
// about to act -- "Following" means the user deliberately follows this
// person, which is a strong signal a mute/block here would be a mistake
// (a miscategorized candidate, e.g. a real contributor whose profile link
// got swept up from a post as if it were a scam-target link). "Follow" /
// "Follow back" / "Requested" are not an established follow relationship
// and don't gate anything. Exact match on "Following" only -- deliberately
// narrow rather than reusing isProfilePrimaryActionText's broader set.
function isProfileFollowedByCurrentUser() {
    const action = getProfilePrimaryAction()
    if(!action) return false
    return /^following$/i.test(getElementText(action).trim())
}

function getVisibleButtons(root) {
    if(!root) return []

    return Array.from(root.querySelectorAll('button, a, [role="button"]')).filter(isVisible)
}

function getActionButtons(root, regex) {
    return getVisibleButtons(root).filter(button => regex.test(getElementText(button)))
}

function isSameRow(left, right, tolerance = 24) {
    if(!left || !right) return false

    const leftRect = left.getBoundingClientRect()
    const rightRect = right.getBoundingClientRect()
    const leftMid = leftRect.top + leftRect.height / 2
    const rightMid = rightRect.top + rightRect.height / 2

    return Math.abs(leftMid - rightMid) <= tolerance
}

function getQuestionActionRow() {
    const primaryAction = getQuestionPrimaryAction()
    let node = primaryAction?.parentElement

    while(node && node !== document.body) {
        const actions = Array.from(node.querySelectorAll('button, a, [role="button"], div, span')).filter(action => {
            if(!isVisible(action)) return false
            if(!isSameRow(primaryAction, action)) return false

            return /answer|follow|request/i.test(getElementText(action))
        })

        if(actions.length >= 2) return node
        node = node.parentElement
    }

    return null
}

function getProfileActionRow() {
    const main = getSpaceFeedContentRoot()
    if(!main) return null
    const mainRect = main.getBoundingClientRect()

    const primaryCandidates = getVisibleButtons(main).filter(button => {
        return isProfilePrimaryActionText(getElementText(button))
    })

    primaryCandidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    let bestMatch = null

    for(const primaryAction of primaryCandidates) {
        let node = primaryAction.parentElement

        while(node && node !== document.body) {
            const sameRowButtons = getVisibleButtons(node).filter(button => isSameRow(primaryAction, button))
            const actionButtons = sameRowButtons.filter(button => isProfileActionText(getElementText(button)))
            const menuButtons = sameRowButtons.filter(button => button.getAttribute('aria-haspopup') === 'menu')
            const rowTexts = actionButtons.map(button => getElementText(button).toLowerCase().trim())
            const sameRowUniqueButtons = new Set(sameRowButtons)

            let score = 0

            if(actionButtons.includes(primaryAction)) score += 1200
            if(menuButtons.length) score += 800
            if(menuButtons.length === 1) score += 200
            if(actionButtons.length >= 2) score += 240
            if(actionButtons.length >= 3) score += 180
            if(rowTexts.includes('notify me')) score += 220
            if(rowTexts.includes('ask')) score += 180
            if(rowTexts.includes('message')) score += 120
            if(sameRowUniqueButtons.size <= 8) score += 120
            else score -= (sameRowUniqueButtons.size - 8) * 90

            const nodeRect = node.getBoundingClientRect()
            const topDistance = Math.abs(nodeRect.top - mainRect.top)
            if(topDistance <= 260) score += 240
            else if(topDistance <= 420) score += 120
            else score -= Math.min(600, topDistance)

            if(score > 0 && (!bestMatch || score > bestMatch.score)) {
                bestMatch = {node, score}
            }

            node = node.parentElement
        }
    }

    if(bestMatch) return bestMatch.node

    const fallbackCandidates = getVisibleButtons(main).filter(button => {
        const text = getElementText(button)
        return isProfileSecondaryActionText(text) || button.getAttribute('aria-haspopup') === 'menu'
    })

    for(const anchorButton of fallbackCandidates) {
        let node = anchorButton.parentElement

        while(node && node !== document.body) {
            const sameRowButtons = getVisibleButtons(node).filter(button => isSameRow(anchorButton, button))
            const secondaryButtons = sameRowButtons.filter(button => isProfileSecondaryActionText(getElementText(button)))
            const primaryButtons = sameRowButtons.filter(button => isProfilePrimaryActionText(getElementText(button)))
            const menuButtons = sameRowButtons.filter(button => button.getAttribute('aria-haspopup') === 'menu')
            const rowTexts = [...primaryButtons, ...secondaryButtons].map(button => getElementText(button).toLowerCase().trim())
            const sameRowUniqueButtons = new Set(sameRowButtons)

            let score = 0

            if(menuButtons.length) score += 1200
            if(menuButtons.length === 1) score += 260
            if(secondaryButtons.length >= 1) score += 420
            if(secondaryButtons.length >= 2) score += 320
            if(primaryButtons.length) score += 180
            if(rowTexts.includes('notify me')) score += 320
            if(rowTexts.includes('ask')) score += 260
            if(rowTexts.includes('message')) score += 180
            if(sameRowUniqueButtons.size <= 8) score += 120
            else score -= (sameRowUniqueButtons.size - 8) * 90

            const nodeRect = node.getBoundingClientRect()
            const topDistance = Math.abs(nodeRect.top - mainRect.top)
            if(topDistance <= 260) score += 320
            else if(topDistance <= 420) score += 160
            else score -= Math.min(700, topDistance)

            if(score > 0 && (!bestMatch || score > bestMatch.score)) {
                bestMatch = {node, score}
            }

            node = node.parentElement
        }
    }

    return bestMatch?.node || null
}

function getProfileActionAnchor(actionRow = getProfileActionRow()) {
    if(!actionRow) return null

    const buttons = getVisibleButtons(actionRow)
    const primaryButtons = buttons.filter(button => isProfilePrimaryActionText(getElementText(button)))
    primaryButtons.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.left - rightRect.left || leftRect.top - rightRect.top
    })
    if(primaryButtons.length) return primaryButtons[0]

    const secondaryButtons = buttons.filter(button => isProfileSecondaryActionText(getElementText(button)))
    secondaryButtons.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.left - rightRect.left || leftRect.top - rightRect.top
    })

    return secondaryButtons[0] || null
}

// Buttons live in profileButtonRail (see getOrCreateProfileButtonRail), not
// as DOM siblings of target.element -- so "correctly placed" just means the
// button is one of ours and lives in the rail. Whether the rail itself is
// currently positioned at target's live location is a separate, position-
// based check (isProfileButtonRailPositionCurrent), because Quora can (and
// does, on this profile page, roughly every 1-2s) destroy and recreate
// target.element on its own without the button needing to move at all.
function isProfileTargetPlacement(button, target) {
    if(!button || !target?.element) return false
    if(!getProfileManagedButtonKind(button)) return false

    return button.parentElement === profileButtonRail
}

function getQuestionActionMenuButton() {
    const row = getQuestionActionRow()
    const primaryAction = getQuestionPrimaryAction()
    if(!row || !primaryAction) return null

    const candidates = getVisibleButtons(row).filter(candidate => {
        return candidate.getAttribute('aria-haspopup') === 'menu' && isSameRow(primaryAction, candidate)
    })

    const scored = candidates.map(candidate => {
        const rect = candidate.getBoundingClientRect()
        const primaryRect = primaryAction?.getBoundingClientRect()
        const verticalDistance = primaryRect ? Math.abs((primaryRect.top + primaryRect.height / 2) - (rect.top + rect.height / 2)) : 999
        const isToRight = primaryRect ? rect.left >= primaryRect.right - 20 : true

        let score = 0
        if(primaryRect) {
            if(verticalDistance <= 24) score += 240
            else if(verticalDistance <= 48) score += 80
            else score -= verticalDistance * 4

            if(isToRight) score += 60
        }

        score += rect.left / 100
        return {candidate, score, top: rect.top, left: rect.left}
    })

    scored.sort((left, right) => right.score - left.score || left.top - right.top || right.left - left.left)

    return scored[0]?.candidate || null
}

function getQuestionButtonInsertionTarget() {
    const sortContainer = getSortContainer()?.container
    if(sortContainer &&
        sortContainer.firstElementChild &&
        sortContainer.lastElementChild &&
        sortContainer.firstElementChild !== sortContainer.lastElementChild) {
        return {type: 'between-filter-and-sort', element: sortContainer}
    }

    const menuButton = getQuestionActionMenuButton()
    if(menuButton) return {type: 'before-question-menu', element: menuButton}

    const primaryAction = getQuestionPrimaryAction()
    if(primaryAction) return {type: 'after-question-primary', element: primaryAction}

    return null
}

function getProfileMenuButton() {
    const extensionRowMenu = getProfileExtensionActionRowMenuButton()
    if(extensionRowMenu) return extensionRowMenu

    const actionRow = getProfileActionRow()
    const actionAnchor = getProfileActionAnchor(actionRow)
    if(!actionRow || !actionAnchor) {
        return getProfileMenuButtonFallback()
    }

    const scope = actionRow
    const rowMenuButtons = getVisibleButtons(scope).filter(button => {
        return isProfileMenuButtonCandidate(button, actionAnchor) && isSameRow(actionAnchor, button)
    })

    rowMenuButtons.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return rightRect.left - leftRect.left || leftRect.top - rightRect.top
    })

    return rowMenuButtons[0] || getProfileMenuButtonFallback(actionAnchor)
}

function getProfileExtensionActionRowMenuButton() {
    const main = document.querySelector('#mainContent, main, [role="main"]')
    if(!main) return null

    // Managed buttons live in profileButtonRail (appended to document.body,
    // not main -- see getOrCreateProfileButtonRail), not as descendants of
    // main any more, so this has to search the rail; their getBoundingClientRect()
    // still reflects the real on-screen position next to the live menu
    // button, which is all the distance-scoring below actually needs.
    const managedButtons = Array.from((profileButtonRail || main).querySelectorAll(
        '.mb-ext_unblock-unmute-btn, .mb-ext_mute-block-btn, .mb-ext_mute-block-close-btn, .mb-ext_close-tab-btn'
    )).filter(isVisible)
    if(!managedButtons.length) return null

    const menuButtons = getVisibleButtons(main)
        .filter(button => isProfileMenuButtonCandidate(button))
        .map(button => {
            const rect = button.getBoundingClientRect()
            const bestDistance = managedButtons.reduce((best, managedButton) => {
                const managedRect = managedButton.getBoundingClientRect()
                const verticalDistance = Math.abs(
                    (managedRect.top + managedRect.height / 2) - (rect.top + rect.height / 2)
                )
                const horizontalDistance = rect.left - managedRect.right
                if(verticalDistance > 28) return best
                if(horizontalDistance < -12) return best
                return Math.min(best, Math.abs(horizontalDistance) + verticalDistance * 4)
            }, Number.POSITIVE_INFINITY)

            return {button, score: Number.isFinite(bestDistance) ? 1000 - bestDistance : -1, top: rect.top, left: rect.left}
        })
        .filter(candidate => candidate.score > 0)

    menuButtons.sort((left, right) => right.score - left.score || left.top - right.top || right.left - left.left)
    return menuButtons[0]?.button || null
}

function isProfileMenuButtonCandidate(button, anchor = null) {
    if(!button) return false

    const text = getElementText(button)
    const ariaLabel = `${button.getAttribute('aria-label') || ''}`
    const label = `${ariaLabel} ${text}`.replace(/\s+/g, ' ').trim()
    const isMenuLike = button.getAttribute('aria-haspopup') === 'menu' ||
        button.classList?.contains('puppeteer_test_overflow_menu') ||
        /\bmore\b|\boptions\b/i.test(label)

    if(!isMenuLike) return false
    if(/\b(?:share|add question|most recent|sort|filter|newest|oldest|all related|all content)\b/i.test(label)) return false

    const rect = button.getBoundingClientRect()
    const anchorRect = anchor?.getBoundingClientRect?.() || null
    const isExplicitOverflow = button.classList?.contains('puppeteer_test_overflow_menu') ||
        /\bmore\b|\boptions\b/i.test(label)

    if(!isExplicitOverflow && text && rect.width > 80) return false
    if(!anchorRect && rect.top > 360) return false

    return true
}

function getProfileMenuButtonFallback(anchor = null) {
    const main = document.querySelector('#mainContent, main, [role="main"]')
    if(!main) return null

    const anchorRect = anchor?.getBoundingClientRect() || null
    const candidates = getVisibleButtons(main)
        .filter(button => isProfileMenuButtonCandidate(button, anchor))
        .map(button => {
            const rect = button.getBoundingClientRect()
            let score = 0

            if(button.classList?.contains('puppeteer_test_overflow_menu')) score += 1400
            if(button.getAttribute('aria-haspopup') === 'menu') score += 900
            if(/\bmore\b|\boptions\b/i.test(`${button.getAttribute('aria-label') || ''}`)) score += 400
            if(/\bmore\b|\boptions\b/i.test(getElementText(button))) score += 200

            if(anchorRect) {
                const verticalDistance = Math.abs((anchorRect.top + anchorRect.height / 2) - (rect.top + rect.height / 2))
                if(rect.left >= anchorRect.left - 24) score += 180
                if(verticalDistance <= 28) score += 260
                else if(verticalDistance <= 56) score += 100
                else score -= verticalDistance * 2
            }

            if(rect.top <= 420) score += 260
            else score -= Math.min(500, rect.top - 420)

            score += rect.left / 80

            return {button, score, top: rect.top, left: rect.left}
        })
        .filter(candidate => candidate.score > 0)

    candidates.sort((left, right) => right.score - left.score || left.top - right.top || right.left - left.left)
    return candidates[0]?.button || null
}

// Quora's own action-row buttons (Follow, notification bell, message, the
// "..." menu) leave very little horizontal room next to them, which is
// exactly why anchoring there put our buttons on top of Quora's own controls
// (live-repro'd 2026-09-26, screenshot showed "Mute Block Close" covering
// the notification bell). The "X followers * Y following" line sits just
// below that row with open space to its right, so prefer anchoring there;
// the button-row anchors in getProfileButtonInsertionTarget below remain a
// fallback for whatever profile layout doesn't have this line.
function getProfileFollowStatsAnchor() {
    const main = getSpaceFeedContentRoot()
    if(!main) return null
    const mainRect = main.getBoundingClientRect()

    const candidates = Array.from(main.querySelectorAll('a, span, div, button')).filter(element => {
        if(!isVisible(element)) return false
        if(element.children.length) return false
        if(!/^[\d.,]+[km]?\s+following$/i.test(getElementText(element))) return false
        return Math.abs(element.getBoundingClientRect().top - mainRect.top) <= 420
    })

    candidates.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)
    return candidates[0] || null
}

function getProfileButtonInsertionTarget() {
    const statsAnchor = getProfileFollowStatsAnchor()
    if(statsAnchor) return {type: 'after-stats', element: statsAnchor}

    const menuButton = getProfileMenuButton()
    if(menuButton) return {type: 'before-menu', element: menuButton}

    const actionRow = getProfileActionRow()
    if(actionRow) {
        const actionAnchor = getProfileActionAnchor(actionRow)
        const actionButtons = getVisibleButtons(actionRow).filter(button => {
            return isSameRow(actionAnchor, button) &&
                isProfileActionText(getElementText(button))
        })
        actionButtons.sort((left, right) => right.getBoundingClientRect().left - left.getBoundingClientRect().left)

        if(actionButtons.length) return {type: 'after-primary', element: actionButtons[0]}
    }

    const primaryAction = getProfilePrimaryAction()
    if(primaryAction) return {type: 'after-primary', element: primaryAction}

    if(isProfileBlocked()) {
        const main = document.querySelector('#mainContent')
        const blockedTarget = main?.querySelector('h1, [role="heading"], .q-text')

        if(blockedTarget && isVisible(blockedTarget)) {
            return {type: 'after-primary', element: blockedTarget}
        }

        if(main?.firstElementChild) {
            return {type: 'after-primary', element: main.firstElementChild}
        }
    }

    return null
}

function getOverlayRoots(includeDialogs = true) {
    const roots = [
        ...document.querySelectorAll('[role="menu"]'),
        ...document.querySelectorAll('[data-popper-placement]')
    ]

    if(includeDialogs) {
        roots.push(...document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'))
    }

    return roots.filter(isVisible)
}

function getProfileManagedButtonKind(button) {
    if(!button) return null
    if(button.dataset?.mbProfileBtnKind) return button.dataset.mbProfileBtnKind
    if(button.classList?.contains('mb-ext_close-tab-btn')) return 'close-tab'
    if(button.classList?.contains('mb-ext_unblock-unmute-btn')) return 'unblock-unmute'
    if(button.classList?.contains('mb-ext_mute-block-btn')) return 'mute-block'
    if(button.classList?.contains('mb-ext_mute-block-close-btn')) return 'mute-block-close'
    return null
}

const PROFILE_BUTTON_RAIL_GAP_PX = 6

// Quora periodically destroys and recreates the DOM subtree containing
// target.element on its own -- confirmed live: it kept happening with our
// own insertion code fully blocked and zero runtime messages received, so
// it isn't something our extension triggers. Inserting the buttons as
// literal siblings inside that subtree meant they got destroyed right along
// with it, which was not just a visible flash but a real click-hijack risk
// (bindSinglePressAction fires its action on pointerdown, so a stray press
// near the target during one of these remounts could land on a
// just-recreated button and fire an action nobody intended). Keeping the
// buttons in one persistent element appended to document.body, and only
// ever repositioning that element, means Quora's remounts never touch them.
function getOrCreateProfileButtonRail() {
    // Defense in depth against ever showing two overlapping rails (seen
    // live 2026-09-19: two of our buttons rendered stacked on top of each
    // other) -- whatever the exact cause (a stale rail this script instance
    // lost track of, a bfcache restore, anything else), only one
    // .mb-ext_profile-button-rail should ever exist on the page at once.
    // Has to run even when profileButtonRail is already valid: a stray
    // extra element sitting elsewhere in the DOM is invisible to the
    // isConnected check below, which only looks at the one rail this
    // script instance already knows about.
    for(const stale of document.querySelectorAll('.mb-ext_profile-button-rail')) {
        if(stale !== profileButtonRail) stale.remove()
    }

    if(profileButtonRail?.isConnected) return profileButtonRail

    if(!profileButtonRailResizeHooked) {
        profileButtonRailResizeHooked = true
        let resizeTimeout
        addEventListener('resize', () => {
            clearTimeout(resizeTimeout)
            resizeTimeout = setTimeout(() => {
                if(getPageType() === 'profile') scheduleProfileButtonsRefresh(0)
            }, 150)
        })
    }

    profileButtonRail = document.createElement('span')
    profileButtonRail.className = 'mb-ext_profile-button-rail'
    profileButtonRail.style.position = 'absolute'
    profileButtonRail.style.zIndex = '999999'
    profileButtonRail.style.display = 'inline-flex'
    profileButtonRail.style.alignItems = 'center'
    document.body.appendChild(profileButtonRail)
    return profileButtonRail
}

function resetProfileButtonRail() {
    profileButtonRail?.remove()
    profileButtonRail = null
}

// An ambient, display-only "work is happening in the background" signal on
// whatever Quora page the user is actually looking at -- mirrors the worker
// window's progress fill/count (coordinator.js's renderWorkerBar) using the
// same mbCoordinatorQueueView the worker window reads, but with no buttons:
// this is a second, independent surface, and giving it its own pause/cancel
// controls would mean two surfaces racing to mutate queue state.
// Reads the page's own light/dark rendering rather than guessing at a
// Quora-specific dark-mode class (which could change) -- the actual
// rendered background luminance is a page-agnostic signal, with
// prefers-color-scheme as a fallback for an unstyled/transparent body.
function isPageInDarkMode() {
    try {
        const bodyBackground = getComputedStyle(document.body).backgroundColor
        const channels = (bodyBackground.match(/[\d.]+/g) || []).map(Number)
        if(channels.length >= 3 && !(channels[3] === 0)) {
            const [red, green, blue] = channels
            const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
            return luminance < 0.5
        }
    }
    catch {}
    return !!globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches
}

function getOrCreateContentProgressBar() {
    for(const stale of document.querySelectorAll(`#${CONTENT_PROGRESS_BAR_ID}`)) {
        if(stale !== contentProgressBarEl) stale.remove()
    }
    if(contentProgressBarEl?.isConnected) return contentProgressBarEl

    // Built by the same function as the dashboard's bar (queueProgressBar.js), so the two look the same. Display-only: it never takes clicks.
    const { bar } = createQueueProgressBar({
        barId: CONTENT_PROGRESS_BAR_ID,
        darkMode: isPageInDarkMode(),
        iconSrc: browser.runtime.getURL('icons/32.png')
    })
    document.body.appendChild(bar)
    contentProgressBarEl = bar
    return bar
}

function removeContentProgressBar() {
    contentProgressBarEl?.remove()
    contentProgressBarEl = null
}

// The queue bar (historical/coder-instructions-2026-10-18.md, section 4 item 2). The summary comes from the worker by runtime message on load,
// or as the summary the worker pushed (QUEUE_BAR_PUSH_ACTION). Nothing is read from storage for it, and a failed request shows no
// bar. The paused flag is still read from storage.local.
async function refreshContentProgressBar(pushedSummary = undefined) {
    if(!document.body) return

    const [stored, reply] = await Promise.all([
        safeStorageGet({[COORDINATOR_PAUSED_KEY]: false}).catch(() => null),
        pushedSummary !== undefined
            ? Promise.resolve({summary: pushedSummary})
            : Promise.resolve().then(() => browser.runtime.sendMessage({action: QUEUE_BAR_GET_ACTION})).catch(() => null)
    ])
    const paused = !!stored?.[COORDINATOR_PAUSED_KEY]
    setNukingQueuePaused(paused)
    const display = getQueueBarDisplay(reply?.summary || null, paused)

    // Vanish when there's nothing queued, the batch is fully done, or the
    // queue is paused -- this is meant to be an ambient signal that work is
    // actively happening, not a persistent fixture.
    if(!display.visible) {
        removeContentProgressBar()
        return
    }

    const bar = getOrCreateContentProgressBar()
    const fill = bar.querySelector(`.${CONTENT_PROGRESS_BAR_ID}-fill`)
    const count = bar.querySelector(`.${CONTENT_PROGRESS_BAR_ID}-count`)
    if(fill) fill.style.width = `${display.percent}%`
    if(count) count.textContent = `${display.terminal} / ${display.total}`
}

function installContentProgressBarStorageListener() {
    if(contentProgressBarStorageListenerInstalled) return
    const source = getStorageChangeSource()
    if(!source) return
    contentProgressBarStorageListenerInstalled = true
    // A dedicated listener, independent of setStorageChangeListenerEnabled's
    // on/off toggle (which some page types, e.g. profile-search, never turn
    // on) -- this overlay needs to stay live on every Quora page regardless
    // of that page-type-specific gating.
    source.addListener((changes, areaName) => {
        if(areaName !== 'local') return
        // The queue view is no longer stored, so only the paused flag changes the bar from storage. The summary arrives by message.
        if(changes[COORDINATOR_PAUSED_KEY]) {
            void refreshContentProgressBar()
        }
    })
}

let contentProgressBarPollTimer = null

function initContentProgressBar() {
    installContentProgressBarStorageListener()
    void refreshContentProgressBar()
    if(contentProgressBarPollTimer === null) {
        contentProgressBarPollTimer = setInterval(() => {
            void refreshContentProgressBar()
        }, CONTENT_PROGRESS_BAR_POLL_MS)
    }
}

function reorderProfileButtonRail(rail) {
    const buttonsByKind = new Map(
        Array.from(rail.children)
            .map(button => [getProfileManagedButtonKind(button), button])
            .filter(([kind]) => !!kind)
    )

    for(const kind of PROFILE_ACTION_BUTTON_ORDER) {
        const button = buttonsByKind.get(kind)
        if(button) rail.appendChild(button)
    }
}

function positionProfileButtonRail(target) {
    const rail = getOrCreateProfileButtonRail()
    const element = target?.element
    if(!element?.isConnected) return rail

    const rect = element.getBoundingClientRect()
    rail.style.height = `${rect.height}px`
    rail.style.top = `${rect.top + window.scrollY}px`

    if(target.type === 'before-menu') {
        const railWidth = rail.getBoundingClientRect().width
        rail.style.left = `${rect.left + window.scrollX - PROFILE_BUTTON_RAIL_GAP_PX - railWidth}px`
    }
    else {
        rail.style.left = `${rect.right + window.scrollX + PROFILE_BUTTON_RAIL_GAP_PX}px`
    }

    return rail
}

function isProfileButtonRailPositionCurrent(target) {
    if(!profileButtonRail?.isConnected) return false

    const element = target?.element
    if(!element?.isConnected) return true

    const rect = element.getBoundingClientRect()
    const expectedTop = rect.top + window.scrollY
    if(Math.abs(expectedTop - Number.parseFloat(profileButtonRail.style.top || '0')) > 1) return false

    const railLeft = Number.parseFloat(profileButtonRail.style.left || '0')
    if(target.type === 'before-menu') {
        const railWidth = profileButtonRail.getBoundingClientRect().width
        const expectedLeft = rect.left + window.scrollX - PROFILE_BUTTON_RAIL_GAP_PX - railWidth
        return Math.abs(expectedLeft - railLeft) <= 1
    }

    const expectedLeft = rect.right + window.scrollX + PROFILE_BUTTON_RAIL_GAP_PX
    return Math.abs(expectedLeft - railLeft) <= 1
}

function getProfilePeopleModal() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="dialog"].modal_content_inner, .modal_content_inner[aria-modal="true"]'))
        .filter(isVisible)

    const scored = dialogs.map(dialog => {
        const tabs = Array.from(dialog.querySelectorAll('[role="tab"]')).filter(isVisible)
        const tabText = tabs.map(getElementText).join(' ')
        const items = dialog.querySelectorAll('[role="listitem"]')
        const profileLinks = getQuoraProfileLinks(dialog)
        const dialogText = getElementText(dialog)

        let score = 0
        if(/\bfollower(?:s)?\b|\bfollowing\b/i.test(tabText)) score += 500
        if(/\bcontributor(?:s)?\b/i.test(dialogText)) score += 500
        if(items.length) score += 150
        if(profileLinks.length) score += 150

        return {dialog, score}
    }).filter(entry => entry.score > 0)

    scored.sort((left, right) => right.score - left.score)
    return scored[0]?.dialog || null
}

function getProfileModalItems(modal = getProfilePeopleModal()) {
    if(!modal) return []
    return Array.from(modal.querySelectorAll('[role="listitem"]')).filter(item => {
        return isVisible(item) && getQuoraProfileLinks(item).length
    })
}

function isProfilePeopleModal(modal) {
    if(!modal) return false

    const tabs = Array.from(modal.querySelectorAll('[role="tab"]')).filter(isVisible)
    const tabText = tabs.map(getElementText).join(' ')
    if(/\bfollower(?:s)?\b|\bfollowing\b/i.test(tabText)) return true

    const modalText = getElementText(modal)
    return /\bcontributor(?:s)?\b/i.test(modalText) &&
        getProfileModalItems(modal).length > 0
}

function isContributorProfileModal(modal) {
    return !!modal && /\bcontributor(?:s)?\b/i.test(getElementText(modal))
}

function getProfileModalForItem(item) {
    return item?.closest?.('[role="dialog"][aria-modal="true"], [role="dialog"].modal_content_inner, .modal_content_inner[aria-modal="true"]') || getProfilePeopleModal()
}

function syncActiveProfileModal(modal = getProfilePeopleModal()) {
    if(modal && modal !== activeProfileModal) {
        activeProfileModal = modal
        handledModalProfileUrls = new Set()
        queuedModalNukeProfileUrls = new Set()
    }
    else if(!modal) {
        activeProfileModal = null
        handledModalProfileUrls = new Set()
        queuedModalNukeProfileUrls = new Set()
    }

    return modal
}

function getModalItemProfileHref(item) {
    return normalizeQuoraProfileHref(getQuoraProfileLinks(item)[0]?.href || '') || null
}

function getFollowProxyLabel(element) {
    return `${element?.getAttribute?.('aria-label') || ''} ${getElementText(element)}`.replace(/\s+/g, ' ').trim()
}

function isFollowProxyLabel(label) {
    return /^(?:follow|follow back|following|requested|join|joined)$/i.test(`${label || ''}`.trim())
}

function getVisibleFollowProxyCandidates(root) {
    if(!root) return []

    return Array.from(root.querySelectorAll('button, a, [role="button"], .q-click-wrapper[tabindex], [tabindex="0"]'))
        .filter(isVisible)
        .filter(candidate => isFollowProxyLabel(getFollowProxyLabel(candidate)))
}

function hasVisibleFollowProxy(root) {
    return getVisibleFollowProxyCandidates(root).length > 0
}

function isModalItemQueueable(item) {
    const href = getModalItemProfileHref(item)
    if(!href || isProfileNukeSucceeded(href)) return false
    if(isContributorProfileModal(getProfileModalForItem(item))) return true
    return hasVisibleFollowProxy(item)
}

function isModalItemHandled(item) {
    const href = getModalItemProfileHref(item)
    const identityKey = getNormalizedProfileIdentityKey(href)
    return item?.dataset?.mbOpened === 'true' || (!!identityKey && handledModalProfileUrls.has(identityKey))
}

function isModalItemNukeQueued(item) {
    const href = getModalItemProfileHref(item)
    const identityKey = getNormalizedProfileIdentityKey(href)
    return item?.dataset?.mbNukeQueued === 'true' || (!!identityKey && queuedModalNukeProfileUrls.has(identityKey))
}

function getUnhandledProfileModalItems(modal = getProfilePeopleModal()) {
    modal = syncActiveProfileModal(modal)
    return getProfileModalItems(modal).filter(item => !isModalItemHandled(item))
}

function getOpenableProfileModalItems(modal = getProfilePeopleModal()) {
    return getUnhandledProfileModalItems(modal).filter(isModalItemQueueable)
}

function getNukeableProfileModalItems(modal = getProfilePeopleModal()) {
    modal = syncActiveProfileModal(modal)
    return getProfileModalItems(modal)
        .filter(item => !isModalItemNukeQueued(item))
        .filter(isModalItemQueueable)
}

function markModalItemsHandled(items, backgroundColor = '#d4edda') {
    for(const item of items) {
        const href = getModalItemProfileHref(item)
        const identityKey = getNormalizedProfileIdentityKey(href)
        item.dataset.mbOpened = true
        if(identityKey) handledModalProfileUrls.add(identityKey)
        item.style.backgroundColor = backgroundColor
    }
}

function markModalItemsNukeQueued(items, backgroundColor = '#f8d7da') {
    for(const item of items) {
        const href = getModalItemProfileHref(item)
        const identityKey = getNormalizedProfileIdentityKey(href)
        item.dataset.mbNukeQueued = true
        if(identityKey) queuedModalNukeProfileUrls.add(identityKey)
        item.style.backgroundColor = backgroundColor
    }
}

function getActiveProfileModalTabLabel(modal = getProfilePeopleModal()) {
    if(!modal) return 'Profiles'

    const tabs = Array.from(modal.querySelectorAll('[role="tab"]')).filter(isVisible)
    const scored = tabs.map(tab => {
        const text = getElementText(tab)
        const tabContent = tab.firstElementChild || tab
        const className = `${tab.className || ''} ${tabContent.className || ''}`
        const style = getComputedStyle(tabContent)
        let score = 0

        if(/\bfollower(?:s)?\b/i.test(text)) score += 200
        if(/\bfollowing\b/i.test(text)) score += 200
        if(/qu-color--red|qu-bg--red/.test(className)) score += 300
        if(style.color === 'rgb(185, 43, 39)') score += 300
        if(tab.querySelector('.qu-bg--red')) score += 250
        if(tab.getAttribute('aria-selected') === 'true') score += 300

        return {text, score}
    }).filter(entry => entry.score > 0)

    scored.sort((left, right) => right.score - left.score)
    const activeText = scored[0]?.text || tabs.map(getElementText).join(' ')

    if(/\bfollowing\b/i.test(activeText)) return 'Following'
    if(/\bfollower(?:s)?\b/i.test(activeText)) return 'Followers'
    return 'Profiles'
}

function findOverlayAction(regex, roots) {
    for(const root of roots) {
        const candidates = Array.from(root.querySelectorAll('.puppeteer_test_popover_item, [role="menuitem"], button, [role="button"], a'))
        const match = candidates.find(candidate => {
            if(shouldIgnoreActionCandidate(candidate)) return false
            if(!isVisible(candidate)) return false

            return matchesActionLabel(regex, getActionCandidateLabel(candidate))
        })

        if(match) return match
    }

    return null
}

function getVisibleAction(regex, root = document) {
    const candidates = Array.from(root.querySelectorAll('.puppeteer_test_popover_item, [role="menuitem"], button, [role="button"], a'))

    return candidates.find(candidate => {
        if(shouldIgnoreActionCandidate(candidate)) return false
        if(!isVisible(candidate)) return false

        return matchesActionLabel(regex, getActionCandidateLabel(candidate))
    }) || null
}

function getMenuAction(regex) {
    const match = findOverlayAction(regex, getOverlayRoots(false))
    if(match) return match

    return getVisibleAction(regex)
}

function getActionCandidateLabel(candidate) {
    return `${candidate?.getAttribute?.('aria-label') || ''} ${getElementText(candidate)}`.replace(/\s+/g, ' ').trim()
}

function matchesActionLabel(matcher, label) {
    if(typeof matcher === 'function') return !!matcher(label)
    if(Array.isArray(matcher)) return matcher.some(entry => matchesActionLabel(entry, label))
    if(matcher?.test) {
        matcher.lastIndex = 0
        return matcher.test(label)
    }

    return false
}

function isUnmuteActionLabel(label) {
    return UNMUTE_ACTION_REGEX.test(`${label || ''}`)
}

function isMuteActionLabel(label) {
    return /\bmute\b/i.test(`${label || ''}`) && !isUnmuteActionLabel(label)
}

function isUnblockActionLabel(label) {
    return UNBLOCK_ACTION_REGEX.test(`${label || ''}`)
}

function isBlockActionLabel(label) {
    return /\bblock\b/i.test(`${label || ''}`) && !isUnblockActionLabel(label)
}

function hasUnmuteActionText(text) {
    const value = `${text || ''}`
    return UNMUTE_ACTION_REGEX.test(value) || UNMUTE_CONTEXT_REGEX.test(value)
}

function hasUnblockActionText(text) {
    const value = `${text || ''}`
    return UNBLOCK_ACTION_REGEX.test(value) || UNBLOCK_CONTEXT_REGEX.test(value)
}

function isMuteConfirmButtonLabel(label) {
    const value = `${label || ''}`
    return /\bmute\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i.test(value) &&
        !hasUnmuteActionText(value) &&
        !hasUnblockActionText(value)
}

function isBlockConfirmButtonLabel(label) {
    const value = `${label || ''}`
    return /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i.test(value) &&
        !hasUnblockActionText(value) &&
        !hasUnmuteActionText(value)
}

function isUnmuteConfirmButtonLabel(label) {
    const value = `${label || ''}`
    return /\bun[\s-]*mute\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i.test(value) &&
        !hasUnblockActionText(value)
}

function isUnblockConfirmButtonLabel(label) {
    const value = `${label || ''}`
    return /\bun[\s-]*block\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i.test(value) &&
        !hasUnmuteActionText(value)
}

function getVisibleProfileMenuActionLabels() {
    const labels = []
    const seen = new Set()
    const roots = getOverlayRoots(false)

    for(const root of roots) {
        for(const candidate of Array.from(root.querySelectorAll('.puppeteer_test_popover_item, [role="menuitem"], button, [role="button"], a'))) {
            if(!isVisible(candidate)) continue

            const label = getActionCandidateLabel(candidate)
            if(!label || seen.has(label)) continue

            seen.add(label)
            labels.push(label)
        }
    }

    return labels.slice(0, 20)
}

function getProfileMenuButtonDebugRect() {
    return getActionDebugRect(getProfileMenuButton())
}

function getActionDebugLabel(element) {
    if(!element) return ''
    return getActionCandidateLabel(element) || getElementText(element)
}

function getActionDebugRect(element) {
    if(!element?.getBoundingClientRect) return null

    const rect = element.getBoundingClientRect()
    return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
    }
}

function getReverseActionDebugSnapshot(extra = {}) {
    return {
        documentVisibility: document.visibilityState,
        overlayCount: getOverlayRoots(false).length,
        profileBlocked: isProfileBlocked({ignoreHints: true}),
        profileMenuOpen: isProfileMenuOpen(),
        profileMenuButtonFound: !!getProfileMenuButton(),
        profileMenuButtonRect: getProfileMenuButtonDebugRect(),
        visibleProfileMenuLabels: getVisibleProfileMenuActionLabels(),
        ...extra
    }
}

async function recordReverseActionProgress(patch = {}) {
    await recordCurrentProfileNukeProgress({
        actionKind: UNBLOCK_UNMUTE_ACTION_KIND,
        ...patch
    })
}

function isProfileActionMenuOpen() {
    const labels = getVisibleProfileMenuActionLabels()
    return labels.some(label => {
        return isMuteActionLabel(label) ||
            isUnmuteActionLabel(label) ||
            isBlockActionLabel(label) ||
            isUnblockActionLabel(label) ||
            /^report$/i.test(label)
    })
}

function getVisibleActionButtons(root) {
    return Array.from(root.querySelectorAll('button, [role="button"], a')).filter(button => {
        return !shouldIgnoreActionCandidate(button) && isVisible(button)
    })
}

function getMuteConfirmContainer() {
    const candidates = Array.from(document.querySelectorAll('div, section, aside'))
        .filter(isVisible)
        .filter(element => {
            const text = getElementText(element)
            if(!isMuteConfirmContextText(text)) return false

            const buttons = getVisibleActionButtons(element)
            return buttons.some(button => isMuteConfirmButtonLabel(getActionCandidateLabel(button))) &&
                buttons.some(button => /\bcancel\b/i.test(getElementText(button)))
        })
        .map(element => {
            const rect = element.getBoundingClientRect()
            const area = rect.width * rect.height
            const text = getElementText(element)
            return {element, area, text}
        })

    candidates.sort((left, right) => left.area - right.area)
    return candidates[0]?.element || null
}

function getMuteConfirmCandidates() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(button => !shouldIgnoreActionCandidate(button) && isVisible(button))
        .filter(button => isMuteConfirmButtonLabel(getActionCandidateLabel(button)))
        .map(button => {
            const context = getBestActionContext(button)
            const contextText = context?.text || ''
            let score = scoreActionCandidate(button, /\bconfirm\b/i, contextText)

            if(/\bmuted\b|\bmuting this person\b/i.test(contextText)) score += 1200
            if(hasUnmuteActionText(contextText) || hasUnblockActionText(contextText) ||
                /\bask question\b|\badd question\b|\bcreate post\b/i.test(contextText)) score -= 1500
            if(/\bcancel\b/i.test(contextText) && !/\bmuted\b|\bmuting this person\b/i.test(contextText)) score -= 500

            return {button, score, contextText}
        })
        .filter(candidate => isMuteConfirmContextText(candidate.contextText))

    candidates.sort((left, right) => right.score - left.score)
    return candidates
}

function getMuteConfirmAction() {
    const buttons = getMuteConfirmCandidates()
    if(buttons.length) return buttons[0].button

    const container = getMuteConfirmContainer()
    if(container) {
        const containerButtons = getVisibleActionButtons(container)
            .filter(button => isMuteConfirmButtonLabel(getActionCandidateLabel(button)))
            .map(button => ({button, score: scoreActionCandidate(button, /\bconfirm\b/i, getElementText(container)) + 500}))

        containerButtons.sort((left, right) => right.score - left.score)
        if(containerButtons.length) return containerButtons[0].button
    }

    return getContextualDialogPrimaryAction(
        getDialogRoots(),
        /\bconfirm\b|\bmute\b/i,
        isMuteConfirmContextText,
        button => isMuteConfirmButtonLabel(getActionCandidateLabel(button))
    )
}

function isMuteConfirmPending() {
    return !!getMuteConfirmAction()
}

function isMuteConfirmContextText(text) {
    const value = text || ''
    return /\bmuted\b|\bmuting this person\b/i.test(value) &&
        !hasUnmuteActionText(value) &&
        !hasUnblockActionText(value)
}

function isBlockConfirmContextText(text) {
    const value = text || ''
    return /\bblock this profile\b|\bblock this person\b|\bblocking this person\b|\bblock\b|\bblocked\b/i.test(value) &&
        !isMuteConfirmContextText(value) &&
        !hasUnblockActionText(value) &&
        !hasUnmuteActionText(value) &&
        !/\bask question\b|\badd question\b|\bcreate post\b/i.test(value)
}

function getBlockConfirmContainer() {
    const candidates = Array.from(document.querySelectorAll('div, section, aside'))
        .filter(isVisible)
        .filter(element => {
            const text = getElementText(element)
            if(!isBlockConfirmContextText(text)) return false

            const buttons = getVisibleActionButtons(element)
            return buttons.some(button => isBlockConfirmButtonLabel(getActionCandidateLabel(button))) &&
                buttons.some(button => /\bcancel\b/i.test(getElementText(button)))
        })
        .map(element => {
            const rect = element.getBoundingClientRect()
            const area = rect.width * rect.height
            const text = getElementText(element)
            return {element, area, text}
        })

    candidates.sort((left, right) => left.area - right.area)
    return candidates[0]?.element || null
}

function getBlockConfirmCandidates() {
    const dialogRoots = getDialogRoots()
    const confirmContainer = getBlockConfirmContainer()
    const isInBlockConfirmSurface = button => {
        if(confirmContainer?.contains(button)) return true
        return dialogRoots.some(root => root.contains(button))
    }
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(button => !shouldIgnoreActionCandidate(button) && isVisible(button))
        .filter(isInBlockConfirmSurface)
        .filter(button => isBlockConfirmButtonLabel(getActionCandidateLabel(button)))
        .map(button => {
            const context = getBestActionContext(button)
            const contextText = context?.text || ''
            let score = scoreActionCandidate(button, /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i, contextText)

            if(isBlockConfirmContextText(contextText)) score += 1200
            if(isMuteConfirmContextText(contextText) || hasUnblockActionText(contextText) ||
                hasUnmuteActionText(contextText) || /\bask question\b|\badd question\b|\bcreate post\b/i.test(contextText)) score -= 1500
            if(/\bcancel\b/i.test(contextText) && !isBlockConfirmContextText(contextText)) score -= 500

            return {button, score, contextText}
        })
        .filter(candidate => isBlockConfirmContextText(candidate.contextText))

    candidates.sort((left, right) => right.score - left.score)
    return candidates
}

function getBlockConfirmAction() {
    const container = getBlockConfirmContainer()
    if(container) {
        const containerButtons = getVisibleActionButtons(container)
            .filter(button => isBlockConfirmButtonLabel(getActionCandidateLabel(button)))
            .map(button => ({button, score: scoreActionCandidate(button, /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i, getElementText(container)) + 500}))

        containerButtons.sort((left, right) => right.score - left.score)
        if(containerButtons.length) return containerButtons[0].button
    }

    const dialogPrimary = getContextualDialogPrimaryAction(
        getDialogRoots(),
        /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i,
        isBlockConfirmContextText,
        button => isBlockConfirmButtonLabel(getActionCandidateLabel(button))
    )
    if(dialogPrimary) return dialogPrimary

    const buttons = getBlockConfirmCandidates()
    return buttons[0]?.button || null
}

function isBlockConfirmPending() {
    return !!getBlockConfirmAction()
}

function getDialogRoots() {
    const roots = [
        ...getOverlayRoots(true).filter(root => root.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')),
        ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal_content_inner')
    ].filter(isVisible)

    return Array.from(new Set(roots))
}

function getDialogPrimaryAction(dialogRoots, preferredRegex = null, acceptsButton = null) {
    const candidates = []

    for(const root of dialogRoots) {
        const rootText = getElementText(root)

        for(const button of Array.from(root.querySelectorAll('button, [role="button"], a'))) {
            if(shouldIgnoreActionCandidate(button)) continue
            if(!isVisible(button)) continue
            if(typeof acceptsButton === 'function' && !acceptsButton(button)) continue

            const score = scoreActionCandidate(button, preferredRegex, rootText)
            if(score > -600) candidates.push({button, score})
        }
    }

    candidates.sort((left, right) => right.score - left.score)
    return candidates[0]?.button || null
}

function getContextualDialogPrimaryAction(dialogRoots, preferredRegex, acceptsContext, acceptsButton = null) {
    const roots = dialogRoots.filter(root => acceptsContext(getElementText(root)))
    return getDialogPrimaryAction(roots, preferredRegex, acceptsButton)
}

function shouldIgnoreActionCandidate(candidate) {
    if(!candidate) return true
    if(candidate.classList?.contains('mb-ext_unblock-unmute-btn')) return true
    if(candidate.classList?.contains('mb-ext_mute-block-btn')) return true
    if(candidate.classList?.contains('mb-ext_close-tab-btn')) return true
    if(candidate.classList?.contains('mb-ext_mute-block-close-btn')) return true
    if(candidate.classList?.contains('mb-ext_find-op-btn')) return true
    if(candidate.classList?.contains('mb-ext_open-profiles-btn')) return true
    if(candidate.classList?.contains('mb-ext_nuke-profiles-btn')) return true

    return !!candidate.closest('#onetrust-consent-sdk, #ot-sdk-cookie-policy, #ot-pc-content, .ot-sdk-container, .ot-sdk-cookie-policy')
}

function getBestActionContext(candidate) {
    let best = null
    let current = candidate?.parentElement
    let depth = 0

    while(current && current !== document.body && depth < 8) {
        if(isVisible(current)) {
            const text = getElementText(current)
            const style = getComputedStyle(current)
            const buttonCount = current.querySelectorAll('button, [role="button"], a').length
            const zIndex = Number.parseInt(style.zIndex || '0', 10)

            let score = 0
            if(current.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal_content_inner, [data-popper-placement]')) score += 400
            if(/fixed|absolute|sticky/.test(style.position)) score += 180
            if(Number.isFinite(zIndex) && zIndex > 0) score += Math.min(zIndex, 500) / 2
            if(buttonCount >= 2) score += 60
            if(/\bmuted\b|\bblocked\b|\bblock\b|\bmute\b/i.test(text)) score += 220
            if(/\bconfirm\b|\bcancel\b/i.test(text)) score += 80
            if(/\bonetrust\b|\bcookie\b|\bconsent\b/i.test(text)) score -= 800

            if(!best || score > best.score) {
                best = {element: current, text, score}
            }
        }

        current = current.parentElement
        depth += 1
    }

    return best
}

function scoreActionCandidate(candidate, preferredRegex = null, rootText = '') {
    const label = `${candidate.getAttribute('aria-label') || ''} ${getElementText(candidate)}`.trim()
    const rect = candidate.getBoundingClientRect()
    const className = candidate.className || ''
    const id = candidate.id || ''
    const context = getBestActionContext(candidate)
    const contextText = rootText || context?.text || ''

    let score = 0
    if(preferredRegex?.test(label)) score += 400
    if(preferredRegex && new RegExp(`^${preferredRegex.source}$`, preferredRegex.flags || '').test(label)) score += 180
    if(/\b(confirm|ok|yes|continue|block|mute)\b/i.test(label)) score += 120
    if(/\b(cancel|dismiss|close|no)\b/i.test(label)) score -= 220
    if(/\bmy choices\b/i.test(label)) score -= 500
    if(/qu-bg--blue|qu-bg--red|qu-color--white|qu-hover--bg--/i.test(className)) score += 80
    if(/onetrust|ot-/i.test(`${id} ${className}`)) score -= 900
    if(/\bmuted\b|\bblocked\b|\bblock this profile\b|\bmute this profile\b/i.test(contextText)) score += 220
    if(/\bonetrust\b|\bcookie\b|\bconsent\b/i.test(contextText)) score -= 900
    if(context) score += context.score
    score += rect.left / 100
    score += rect.top / 200

    return score
}

function getGlobalPrimaryAction(preferredRegex) {
    // Only ever called with a label regex (review-2 C-4). Without one there is no action, so the unscoped search is gone.
    if(!(preferredRegex instanceof RegExp)) return null
    // This scans the WHOLE document, not just a dialog -- unlike
    // getDialogPrimaryAction, there's no overlay root to scope the search to.
    // scoreActionCandidate's styling/position heuristics (e.g. +80 for a
    // qu-bg--red/qu-bg--blue primary-styled button) exist to break ties among
    // otherwise-plausible candidates, not to invent one: without requiring an
    // actual label match first, this used to happily return Quora's own
    // unrelated "Add question" composer button (styled as the page's one
    // prominent red CTA) whenever dismissProfileActionSurface() called this
    // with no real dialog left to dismiss, hijacking the page mid-action.
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(candidate => !shouldIgnoreActionCandidate(candidate) && isVisible(candidate))
        .filter(candidate => {
            const label = `${candidate.getAttribute('aria-label') || ''} ${getElementText(candidate)}`.trim()
            return preferredRegex.test(label)
        })
        .map(button => ({button, score: scoreActionCandidate(button, preferredRegex)}))
        .filter(candidate => candidate.score > -600)

    candidates.sort((left, right) => right.score - left.score)
    return candidates[0]?.button || null
}

async function waitForAction(getAction, timeoutMs = WAIT_FOR_ACTION_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_ACTION_DEFAULT_INTERVAL_MS) {
    const startedAt = Date.now()
    while(Date.now() - startedAt < timeoutMs) {
        const action = getAction()
        if(action) return action

        await sleep(intervalMs)
    }

    return null
}

async function waitForCondition(check, timeoutMs = WAIT_FOR_CONDITION_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_CONDITION_DEFAULT_INTERVAL_MS) {
    const startedAt = Date.now()

    while(Date.now() - startedAt < timeoutMs) {
        if(check()) return true
        await sleep(intervalMs)
    }

    return false
}

function waitForConditionOrDomMutation(check, timeoutMs = WAIT_FOR_CONDITION_OR_DOM_MUTATION_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_CONDITION_OR_DOM_MUTATION_DEFAULT_INTERVAL_MS) {
    if(check()) return Promise.resolve(true)

    return new Promise(resolve => {
        let settled = false
        let observer = null
        let interval = null
        let timeout = null

        const finish = value => {
            if(settled) return
            settled = true
            if(observer) observer.disconnect()
            if(interval) clearInterval(interval)
            if(timeout) clearTimeout(timeout)
            resolve(value)
        }

        const probe = () => {
            if(check()) finish(true)
        }

        observer = new MutationObserver(probe)
        observer.observe(document.documentElement || document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true
        })
        interval = setInterval(probe, intervalMs)
        timeout = setTimeout(() => finish(false), timeoutMs)
    })
}

async function waitForMenuState(primaryRegex, inverseRegex, timeoutMs = WAIT_FOR_MENU_STATE_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_MENU_STATE_DEFAULT_INTERVAL_MS) {
    const action = await waitForAction(() => {
        const inverse = getMenuAction(inverseRegex)
        if(inverse) return {state: 'inverse', button: inverse}

        const primary = getMenuAction(primaryRegex)
        if(primary) return {state: 'primary', button: primary}

        return null
    }, timeoutMs, intervalMs)

    return action
}

async function waitForMenuStateWithForegroundFallback(primaryRegex, inverseRegex, options = {}) {
    const {
        timeoutMs = WAIT_FOR_MENU_STATE_DEFAULT_TIMEOUT_MS,
        intervalMs = WAIT_FOR_MENU_STATE_DEFAULT_INTERVAL_MS,
        promotionReason = 'profile-menu-action-not-found',
        silent = false,
        allowForegroundFallback = false
    } = options

    let state = await waitForMenuState(primaryRegex, inverseRegex, timeoutMs, intervalMs)
    if(state || document.visibilityState === 'visible') return state
    if(!allowForegroundFallback) return null

    await recordCurrentProfileNukeProgress({
        event: 'Profile menu action was not visible in the background; requesting foreground fallback'
    })

    const promotion = await promoteCurrentQueuedTab(promotionReason, allowForegroundFallback)
    if(!promotion.promoted) return null

    await sleep(300)
    state = await waitForMenuState(primaryRegex, inverseRegex, 2000, 200)
    if(state) return state

    if(isProfileMenuOpen()) {
        await closeProfileMenu()
        await sleep(250)
    }

    const opened = await ensureProfileMenuOpen(2500, silent, allowForegroundFallback)
    if(!opened) return null

    await sleep(300)
    return waitForMenuState(primaryRegex, inverseRegex, timeoutMs, intervalMs)
}

async function readProfileMenuState(primaryRegex, inverseRegex, timeoutMs = READ_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS, intervalMs = READ_PROFILE_MENU_STATE_DEFAULT_INTERVAL_MS, silent = false, allowForegroundFallback = false) {
    const opened = await ensureProfileMenuOpen(2500, silent, allowForegroundFallback)
    if(!opened) return null

    await sleep(400)

    const state = await waitForMenuState(primaryRegex, inverseRegex, timeoutMs, intervalMs)

    if(state?.state && isProfileMenuOpen()) {
        await closeProfileMenu()
        await sleep(250)
    }

    return state?.state || null
}

async function waitForProfileMenuState(expectedState, primaryRegex, inverseRegex, timeoutMs = WAIT_FOR_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_PROFILE_MENU_STATE_DEFAULT_INTERVAL_MS, silent = false, allowForegroundFallback = false) {
    const startedAt = Date.now()

    while(Date.now() - startedAt < timeoutMs) {
        const state = await readProfileMenuState(primaryRegex, inverseRegex, 1800, 200, silent, allowForegroundFallback)
        if(state === expectedState) return true
        await sleep(intervalMs)
    }

    return false
}

function isProfileBlocked(options = {}) {
    const {ignoreHints = false} = options
    if(!ignoreHints && hasRecentProfileUnblockedHint()) return false
    if(isProfileVisiblyUnblocked()) return false

    const main = document.querySelector('#mainContent')
    if(main) {
        const labels = Array.from(main.querySelectorAll('div, span, button, a'))
        const blocked = labels.some(label => {
            if(!isVisible(label)) return false

            const text = getElementText(label)
            return /^blocked$/i.test(text) ||
                /^unblock$/i.test(text) ||
                /\b(?:blocked by you|you blocked|you are blocking|this (?:profile|person|user|account) is blocked)\b/i.test(text)
        })
        if(blocked) {
            rememberProfileBlocked()
            return true
        }
    }

    if(hasProfileBlockedBodyText()) {
        rememberProfileBlocked()
        return true
    }

    if(isProfileBlockedFromInlineState()) {
        rememberProfileBlocked()
        return true
    }

    return !ignoreHints && hasRecentProfileBlockHint()
}

function hasProfileBlockedBodyText() {
    if(getPageType() !== 'profile' || document.readyState === 'loading') return false

    const bodyText = document.body?.innerText || ''
    return /(^|\n)\s*BLOCKED\s*(\n|$)/i.test(bodyText) ||
        /\byou(?:'ve| have)\s+blocked\b/i.test(bodyText)
}

function isProfileLoadedAndLiveUnblocked() {
    return getPageType() === 'profile' &&
        document.readyState !== 'loading' &&
        (!isProfileBlocked({ignoreHints: true}) || isProfileVisiblyUnblocked()) &&
        !!getProfileMenuButton()
}

async function waitForVerifiedProfileUnblocked(timeoutMs = WAIT_FOR_VERIFIED_PROFILE_UNBLOCKED_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_VERIFIED_PROFILE_UNBLOCKED_DEFAULT_INTERVAL_MS, silent = false, allowForegroundFallback = false) {
    const verified = await waitForConditionOrDomMutation(() => {
        return isProfileVisiblyUnblocked() || !!getMenuAction(isBlockActionLabel)
    }, timeoutMs, intervalMs)
    if(verified) return true

    return waitForProfileMenuState('inverse', isUnblockActionLabel, isBlockActionLabel, 5000, 500, silent, allowForegroundFallback)
}

function isProfileVisiblyUnblocked() {
    if(getPageType() !== 'profile' || document.readyState === 'loading') return false

    if(hasProfileBlockedBodyText()) return false

    return !!getProfileMenuButton() && !!getProfilePrimaryAction()
}

function getProfileKey(href = location.href) {
    return normalizeQuoraProfileHref(href)
}

function hasInlineBlockedStateMarker(text = '') {
    return text.includes('"isBlockedByViewer?":true') ||
        text.includes('\\"isBlockedByViewer?\\":true') ||
        text.includes('"isBlocking?":true') ||
        text.includes('\\"isBlocking?\\":true')
}

// The viewer's block state from the profile's own record in the page data (isBlockedByViewer, next to /profile/<slug>/edit).
// True or false when the record is there; null when it is not. The record is read from the page, so it does not depend on a
// label that can flicker or be remembered (Oct 31: a row finished as blocked on a page whose record said not blocked).
function readOwnProfileBlockedField() {
    const slug = (location.pathname || '').split('/').filter(Boolean).pop() || ''
    if(!slug) return null
    const html = document.documentElement?.innerHTML || ''
    const at = html.indexOf(`/profile/${slug}/edit`)
    if(at < 0) return null
    const match = html.slice(at, at + 1500).match(/isBlockedByViewer\\?":\s*(true|false)/)
    return match ? match[1] === 'true' : null
}

// Blocked when the page's own record says so; the label check is used only when there is no record.
function isProfileBlockedConfirmed() {
    const own = readOwnProfileBlockedField()
    return own === null ? !!isProfileBlocked() : own
}

function isProfileBlockedFromInlineState() {
    const profileKey = getProfileKey()
    if(!profileKey) return false

    let profilePath
    try {
        profilePath = new URL(profileKey).pathname
    }
    catch {
        return false
    }

    // Case-sensitive, like every profile comparison (owner, 14 Oct): a script that mentions a case variant of this path is not this profile.
    for(const script of Array.from(document.scripts || [])) {
        const text = script.textContent || ''
        if(!text || !text.includes(profilePath)) continue

        let searchFrom = 0
        let matchesScanned = 0

        while(matchesScanned < 10) {
            const index = text.indexOf(profilePath, searchFrom)
            if(index < 0) break

            const contextStart = Math.max(0, index - 4000)
            const contextEnd = Math.min(text.length, index + profilePath.length + 4000)
            if(hasInlineBlockedStateMarker(text.slice(contextStart, contextEnd))) return true

            searchFrom = index + profilePath.length
            matchesScanned += 1
        }
    }

    return false
}

function clearProfileBlockHint() {
    profileBlockHintKey = null
    profileBlockHintAt = 0
}

function rememberProfileBlocked() {
    const profileKey = getProfileKey()
    if(!profileKey) return false

    profileBlockHintKey = profileKey
    profileBlockHintAt = Date.now()
    clearProfileUnblockedHint()
    return true
}

function clearProfileUnblockedHint() {
    profileUnblockedHintKey = null
    profileUnblockedHintAt = 0
}

function rememberProfileUnblocked(href = location.href) {
    const profileKey = getProfileKey(href)
    if(!profileKey) return false

    clearProfileBlockHint()
    profileUnblockedHintKey = profileKey
    profileUnblockedHintAt = Date.now()
    return true
}

function noteProfileBlockMutation() {
    profileBlockMutationCount += 1
    rememberProfileBlocked()
}

async function waitForVerifiedProfileBlocked(timeoutMs = WAIT_FOR_VERIFIED_PROFILE_BLOCKED_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_VERIFIED_PROFILE_BLOCKED_DEFAULT_INTERVAL_MS) {
    const directBlocked = await waitForCondition(() => isProfileBlocked({ignoreHints: true}), timeoutMs, intervalMs)
    if(directBlocked) return true

    const menuBlocked = await waitForProfileMenuState('inverse', isBlockActionLabel, isUnblockActionLabel, 6000, 500)
    return !!menuBlocked
}

function hasRecentProfileBlockHint(maxAgeMs = 20000) {
    const profileKey = getProfileKey()
    if(!profileKey || profileBlockHintKey !== profileKey || !profileBlockHintAt) return false
    return Date.now() - profileBlockHintAt <= maxAgeMs
}

function hasRecentProfileUnblockedHint(maxAgeMs = 60000) {
    const profileKey = getProfileKey()
    if(!profileKey || profileUnblockedHintKey !== profileKey || !profileUnblockedHintAt) return false
    return Date.now() - profileUnblockedHintAt <= maxAgeMs
}

function clearCloseTabFollowUps() {
    for(const timeoutId of closeTabRetryTimeouts) {
        clearTimeout(timeoutId)
    }

    closeTabRetryTimeouts = []
}

function clearBlockedCloseChecks() {
    for(const timeoutId of blockedCloseCheckTimeouts) {
        clearTimeout(timeoutId)
    }

    blockedCloseCheckTimeouts = []
}

function scheduleBlockedProfileCloseChecks(delays = [0, 100, 250, 500, 1000, 2000, 4000, 8000]) {
    clearBlockedCloseChecks()

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            if(getPageType() !== 'profile') return

            if(isProfileBlocked()) {
                void (async () => {
                    await notifyQueuedTabComplete()
                    await requestCloseTab(2, 100, true)
                })()
                return
            }

            if(getProfileMenuButton()) {
                void (async () => {
                    const menuBlocked = await readProfileMenuState(isBlockActionLabel, isUnblockActionLabel, 700, 100)
                    if(menuBlocked === 'inverse') {
                        rememberProfileBlocked()
                        await notifyQueuedTabComplete()
                        await requestCloseTab(2, 100, true)
                    }
                })()
            }
        }, delay)

        blockedCloseCheckTimeouts.push(timeoutId)
    }
}

function scheduleCloseTabFollowUps(delays = [500, 1500, 4000, 10000, 30000, 60000]) {
    clearCloseTabFollowUps()

    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            void requestCloseTab(2, 100, false)
        }, delay)

        closeTabRetryTimeouts.push(timeoutId)
    }
}

async function requestCloseTab(attempts = 3, delayMs = 150, scheduleFollowUps = true) {
    markQueuedTabFinishing()
    if(scheduleFollowUps) scheduleCloseTabFollowUps()

    for(let attempt = 0; attempt < attempts; attempt++) {
        try {
            const result = await safeSendRuntimeMessageWithTimeout({
                action: 'close-tab',
                attemptId: activeQueuedAttemptId || ''
            }, null, QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS)
            const closed = !!result?.closed
            if(closed) return true
            if(result?.staleAttempt) return false
        }
        catch(error) {
            if(!isRuntimeConnectionError(error) && !isExtensionContextInvalidatedError(error)) {
                return false
            }
        }

        try {
            window.close()
        }
        catch {}

        if(attempt < attempts - 1) {
            await sleep(delayMs)
        }
    }

    return false
}

async function waitForProfileActionReady(timeoutMs = WAIT_FOR_PROFILE_ACTION_READY_DEFAULT_TIMEOUT_MS) {
    if(isProfileBlocked()) return true
    return waitForCondition(() => isProfileBlocked() || !!getProfileMenuButton(), timeoutMs, 100)
}

function shouldDeferBlockedCloseTab(target) {
    return isProfileBlocked() && target?.type !== 'before-menu'
}

function insertProfileActionButton(btn, target, kind) {
    btn.dataset.mbProfileBtnKind = kind

    const rail = getOrCreateProfileButtonRail()
    rail.appendChild(btn)
    reorderProfileButtonRail(rail)
    positionProfileButtonRail(target)
}

function bindSinglePressAction(button, action) {
    let lastPointerPressAt = 0

    button.addEventListener('pointerdown', event => {
        if(event.button !== 0) return

        lastPointerPressAt = Date.now()
        event.preventDefault()
        event.stopPropagation()
        void action()
    })

    button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()

        if(Date.now() - lastPointerPressAt < 1000) return
        void action()
    })
}

function injectCloseTabBtn() {
    let target = getProfileButtonInsertionTarget()
    if(!target) return

    if(shouldDeferBlockedCloseTab(target)) {
        document.querySelector('.mb-ext_close-tab-btn')?.remove()
        return
    }

    let btn = document.querySelector('.mb-ext_close-tab-btn')
    if(btn && isProfileTargetPlacement(btn, target)) return
    btn?.remove()

    btn = document.createElement('button')
    btn.innerText = 'Close tab'
    btn.classList.add('mb-ext_close-tab-btn')
    setMuteBlockHelp(btn, 'Close this tab')

    bindSinglePressAction(btn, async () => {
        btn.disabled = true
        btn.innerText = 'Closing...'
        await new Promise(resolve => requestAnimationFrame(resolve))

        void requestCloseTab().then(closed => {
            if(closed) return

            btn.disabled = false
            btn.innerText = 'Close tab'
        })
    })

    insertProfileActionButton(btn, target, 'close-tab')
}

function toggleMuteBlockBtn() {
    let existingBtn = document.querySelector('.mb-ext_mute-block-btn')

    if(isProfileBlocked()) {
        existingBtn?.remove()
    }
    else {
        // Not inserted until Quora's own profile menu exists: a press before that fails at once.
        if(!getProfileMenuButton()) {
            existingBtn?.remove()
            return
        }
        let target = getProfileButtonInsertionTarget()
        if(!target) return

        if(existingBtn && isProfileTargetPlacement(existingBtn, target)) return
        existingBtn?.remove()

        let btn = document.createElement('button')
        btn.innerText = 'Mute Block'
        btn.classList.add('mb-ext_mute-block-btn')
        setMuteBlockHelp(btn, 'Mute and block this profile')

        bindSinglePressAction(btn, () => handleMuteBlockClick(btn))
        insertProfileActionButton(btn, target, 'mute-block')
    }
}

function toggleUnblockUnmuteBtn() {
    let existingBtn = document.querySelector('.mb-ext_unblock-unmute-btn')

    if(!isProfileBlocked()) {
        existingBtn?.remove()
    }
    else {
        let target = getProfileButtonInsertionTarget()
        if(!target) return

        if(existingBtn && isProfileTargetPlacement(existingBtn, target)) return
        existingBtn?.remove()

        let btn = document.createElement('button')
        btn.innerText = 'Unblock'
        btn.classList.add('mb-ext_unblock-unmute-btn')
        setMuteBlockHelp(btn, 'Unblock and unmute this profile. This is also called a pardon.')

        bindSinglePressAction(btn, () => handleUnblockUnmuteClick(btn))
        insertProfileActionButton(btn, target, 'unblock-unmute')
    }
}

function toggleMuteBlockCloseBtn() {
    let existingBtn = document.querySelector('.mb-ext_mute-block-close-btn')

    if(isProfileBlocked()) {
        existingBtn?.remove()
    }
    else {
        if(!getProfileMenuButton()) {
            existingBtn?.remove()
            return
        }
        let target = getProfileButtonInsertionTarget()
        if(!target) return

        if(existingBtn && isProfileTargetPlacement(existingBtn, target)) return
        existingBtn?.remove()

        let btn = document.createElement('button')
        btn.innerText = 'Mute Block Close'
        btn.classList.add('mb-ext_mute-block-close-btn')
        setMuteBlockHelp(btn, 'Mute and block this profile, then close the tab')

        bindSinglePressAction(btn, () => handleMuteBlockClick(btn, true))
        insertProfileActionButton(btn, target, 'mute-block-close')
    }
}

async function handleMuteBlockClick(button, closeAfterSuccess = false) {
    if(profileActionInProgress) return

    profileActionInProgress = true

    const closeBtn = document.querySelector('.mb-ext_close-tab-btn')
    const unblockBtn = document.querySelector('.mb-ext_unblock-unmute-btn')
    const muteBtn = document.querySelector('.mb-ext_mute-block-btn')
    const muteCloseBtn = document.querySelector('.mb-ext_mute-block-close-btn')
    const originalText = button.innerText
    const originalCloseText = closeBtn?.innerText || ''
    const originalUnblockText = unblockBtn?.innerText || ''
    const originalMuteText = muteBtn?.innerText || ''
    const originalMuteCloseText = muteCloseBtn?.innerText || ''

    button.innerText = 'Working...'
    for(const managedButton of [closeBtn, unblockBtn, muteBtn, muteCloseBtn]) {
        if(managedButton) managedButton.disabled = true
    }

    if(closeBtn) {
        closeBtn.innerText = 'Please wait...'
    }

    try {
        const completed = await muteProfile({
            allowBlockFallback: true,
            silent: false,
            allowForegroundFallback: false
        })

        if(!completed && !isProfileBlocked()) {
            button.innerText = 'Retry'
            return
        }
        void recordManualProfileAction('block')

        if(closeAfterSuccess) {
            button.innerText = 'Closing...'
            const closed = await requestCloseTab()
            if(!closed) button.innerText = 'Retry'
            return
        }

        button.innerText = 'Blocked'
    }
    catch(error) {
        const message = `${error?.message || error || 'Profile action failed'}`
        console.error(error)
        await recordCurrentProfileNukeProgress({
            status: 'error',
            finalError: message,
            event: `Direct profile action failed: ${message}`
        })
        reportActionIssue(message, false)
    }
    finally {
        profileActionInProgress = false

        if(closeBtn && document.body.contains(closeBtn)) {
            closeBtn.disabled = false
            if(closeBtn.innerText === 'Please wait...') {
                closeBtn.innerText = originalCloseText || 'Close tab'
            }
        }
        if(unblockBtn && document.body.contains(unblockBtn)) {
            unblockBtn.disabled = false
            if(unblockBtn.innerText === 'Working...') {
                unblockBtn.innerText = originalUnblockText || 'Unblock'
            }
        }
        if(muteBtn && document.body.contains(muteBtn)) {
            muteBtn.disabled = false
            if(muteBtn.innerText === 'Working...') {
                muteBtn.innerText = originalMuteText || 'Mute Block'
            }
        }
        if(muteCloseBtn && document.body.contains(muteCloseBtn)) {
            muteCloseBtn.disabled = false
            if(muteCloseBtn.innerText === 'Working...') {
                muteCloseBtn.innerText = originalMuteCloseText || 'Mute Block Close'
            }
        }

        ensureProfileButtons()
    }
}

async function handleUnblockUnmuteClick(button) {
    if(profileActionInProgress) return

    profileActionInProgress = true

    const closeBtn = document.querySelector('.mb-ext_close-tab-btn')
    const unblockBtn = document.querySelector('.mb-ext_unblock-unmute-btn')
    const muteBtn = document.querySelector('.mb-ext_mute-block-btn')
    const muteCloseBtn = document.querySelector('.mb-ext_mute-block-close-btn')
    const originalText = button.innerText
    const originalCloseText = closeBtn?.innerText || ''
    const originalUnblockText = unblockBtn?.innerText || ''
    const originalMuteText = muteBtn?.innerText || ''
    const originalMuteCloseText = muteCloseBtn?.innerText || ''

    button.innerText = 'Working...'
    for(const managedButton of [closeBtn, unblockBtn, muteBtn, muteCloseBtn]) {
        if(managedButton) managedButton.disabled = true
    }

    if(closeBtn) {
        closeBtn.innerText = 'Please wait...'
    }

    try {
        const result = await unblockUnmuteProfile({
            silent: false,
            allowForegroundFallback: false,
            clearNukeState: true
        })

        button.innerText = result?.ok ? 'Unblocked' : 'Retry'
        if(result?.ok) void recordManualProfileAction('pardon')
    }
    catch(error) {
        const message = `${error?.message || error || 'Pardon failed'}`
        console.error(error)
        await recordCurrentProfileNukeProgress({
            status: 'error',
            finalError: message,
            event: `Pardon action failed: ${message}`
        })
        button.innerText = 'Retry'
    }
    finally {
        profileActionInProgress = false

        if(closeBtn && document.body.contains(closeBtn)) {
            closeBtn.disabled = false
            if(closeBtn.innerText === 'Please wait...') {
                closeBtn.innerText = originalCloseText || 'Close tab'
            }
        }
        if(unblockBtn && document.body.contains(unblockBtn)) {
            unblockBtn.disabled = false
            if(unblockBtn.innerText === 'Working...') {
                unblockBtn.innerText = originalUnblockText || 'Unblock'
            }
        }
        if(muteBtn && document.body.contains(muteBtn)) {
            muteBtn.disabled = false
            muteBtn.innerText = originalMuteText || 'Mute Block'
        }
        if(muteCloseBtn && document.body.contains(muteCloseBtn)) {
            muteCloseBtn.disabled = false
            muteCloseBtn.innerText = originalMuteCloseText || 'Mute Block Close'
        }

        ensureProfileButtons()
    }
}

async function injectQuestionPageFOPBtn() {
    if(document.querySelector('.mb-ext_find-op-btn')) return true

    let container = getSortContainer()?.container
    if(container) {
        container = await maybeFlipQuestionFilterToAnswers(container)
    }

    const actionTarget = getQuestionButtonInsertionTarget()
    if(!actionTarget) return false

    function centeredQuestionPageBtnWrapper() {
        let div = document.createElement('div')
        div.dataset.mbQuestionBtnWrapper = 'true'
        div.classList.add('mb-ext_question-center-slot')
        div.appendChild(actionAnchor())

        return div
    }

    function actionAnchor() {
        let anchor = document.createElement('a')
        anchor.innerText = 'Original Poster Profile'
        anchor.classList.add('mb-ext_find-op-btn')
        anchor.target = '_blank'
        anchor.href = getQuestionOriginalPosterLookupHref()
        setMuteBlockHelp(anchor, 'Open the original poster profile from the question log')

        return anchor
    }

    const wrapper = actionTarget.type === 'between-filter-and-sort' ?
        centeredQuestionPageBtnWrapper() :
        actionAnchor()

    insertQuestionPageBtn(wrapper, actionTarget.element, actionTarget.type !== 'before-question-menu')
    return true
}

function insertQuestionPageBtn(wrapper, target, after = true) {
    if(target?.matches?.('.qu-justifyContent--space-between')) {
        const left = target.firstElementChild
        const right = target.lastElementChild
        const existing = target.querySelector('[data-mb-question-btn-wrapper]')

        if(existing) existing.remove()

        if(right && left && right !== left) {
            right.insertAdjacentElement('beforebegin', wrapper)
            return
        }
    }

    if(after) {
        target.insertAdjacentElement('afterend', wrapper)
    }
    else {
        target.insertAdjacentElement('beforebegin', wrapper)
    }
}

function scheduleOriginalPosterRedirect(delay = 250) {
    if(getPageType() !== 'question-log' || !shouldAutoRedirectToOriginalPoster()) return

    clearTimeout(originalPosterRedirectTimeout)
    originalPosterRedirectTimeout = setTimeout(() => {
        void maybeRedirectToOriginalPoster()
    }, delay)
}

async function maybeRedirectToOriginalPoster() {
    if(originalPosterRedirectPending || getPageType() !== 'question-log' || !shouldAutoRedirectToOriginalPoster()) return

    originalPosterRedirectPending = true

    try {
        for(let attempt = 0; attempt < 10; attempt++) {
            const profileHref = getOriginalPosterProfileHref()
            if(profileHref) {
                location.replace(profileHref)
                return
            }

            originalPosterRedirectAttempts = attempt + 1
            await sleep(350 + attempt * 100)
        }
    }
    finally {
        originalPosterRedirectPending = false
    }
}

function getQuoraProfileLinks(root) {
    if(!root?.querySelectorAll) return []

    return Array.from(root.querySelectorAll(
        'a[href*="/profile/"], ' +
        'a[href^="/"], ' +
        'a[href^="https://www.quora.com/"], ' +
        'a[href^="http://www.quora.com/"], ' +
        'a[href^="https://quora.com/"], ' +
        'a[href^="http://quora.com/"]'
    )).filter(link => !!normalizeQuoraProfileHref(link.href))
}

function getProfileActionDebugState() {
    if(getPageType() !== 'profile') return null

    const main = document.querySelector('#mainContent, main, [role="main"]')
    const menuLikeButtons = main ? getVisibleButtons(main)
        .filter(button => {
            const text = getElementText(button)
            const ariaLabel = `${button.getAttribute('aria-label') || ''}`
            return button.getAttribute('aria-haspopup') === 'menu' ||
                button.classList?.contains('puppeteer_test_overflow_menu') ||
                /\bmore\b|\boptions\b/i.test(text) ||
                /\bmore\b|\boptions\b/i.test(ariaLabel)
        })
        .slice(0, 5)
        .map(button => {
            const label = `${button.getAttribute('aria-label') || ''} ${getElementText(button)}`.replace(/\s+/g, ' ').trim()
            const rect = button.getBoundingClientRect()
            return label ? `${label} @ ${Math.round(rect.left)},${Math.round(rect.top)}` : `button @ ${Math.round(rect.left)},${Math.round(rect.top)}`
        }) : []

    const canonicalUrl = getProfileKey(location.href) || ''
    const insertionTarget = getProfileButtonInsertionTarget()

    return {
        currentUrl: location.href,
        canonicalUrl,
        unavailableReason: getProfileUnavailableReason() || '',
        blocked: isProfileBlocked(),
        hasActionRow: !!getProfileActionRow(),
        hasPrimaryAction: !!getProfilePrimaryAction(),
        menuButtonFound: !!getProfileMenuButton(),
        menuOpen: isProfileMenuOpen(),
        insertionTarget: insertionTarget?.type || '',
        securityVerification: isSecurityVerificationPage(),
        menuLikeButtons
    }
}

function formatProfileActionDebugSummary(reason = 'Profile action issue') {
    const debug = getProfileActionDebugState()
    if(!debug) return reason

    const lines = [
        reason,
        `current_url: ${debug.currentUrl}`,
        `canonical_url: ${debug.canonicalUrl}`,
        `unavailable_reason: ${debug.unavailableReason || 'none'}`,
        `blocked: ${debug.blocked}`,
        `has_action_row: ${debug.hasActionRow}`,
        `has_primary_action: ${debug.hasPrimaryAction}`,
        `menu_button_found: ${debug.menuButtonFound}`,
        `menu_open: ${debug.menuOpen}`,
        `insertion_target: ${debug.insertionTarget || 'none'}`,
        `security_verification: ${debug.securityVerification}`
    ]

    if(debug.menuLikeButtons.length) {
        lines.push('menu_like_buttons:')
        for(const button of debug.menuLikeButtons) {
            lines.push(`- ${button}`)
        }
    }
    else {
        lines.push('menu_like_buttons: none')
    }

    return lines.join('\n')
}

function logProfileActionDebug(reason) {
    const summary = formatProfileActionDebugSummary(reason)
    if(summary && summary !== reason) {
        console.info(summary)
    }
}

function getQuoraProfileSlugData(href) {
    return getQuoraProfileSlugDataFromCanonical(normalizeQuoraProfileHref(href))
}

// The identity of a profile href that is already canonical (1 Nov). It is read as it is, so a canonical href is not cut a second time.
function getQuoraProfileSlugDataFromCanonical(normalizedHref) {
    if(!normalizedHref) return null

    try {
        const url = new URL(normalizedHref)
        const slug = url.pathname.replace(/^\/profile\//i, '')
        const decodedSlug = decodeURIComponent(slug)
        // NFC, not NFKC, as in sanitizeProfileHrefSlug: a fullwidth lookalike is not folded onto the real profile (review 4, R4-1).
        const normalizedSlug = decodedSlug.normalize('NFC')
        if(!normalizedSlug) return null

        return {
            href: normalizedHref,
            decodedSlug,
            normalizedSlug
        }
    }
    catch {
        return null
    }
}

function getNormalizedProfileIdentityKey(href) {
    const slugData = getQuoraProfileSlugData(href)
    if(!slugData) return ''

    // Owner, 14 Oct: case-sensitive, so a case variant is a different identity and is not merged with the real profile.
    return slugData.normalizedSlug
}

function getNormalizedProfileHrefList(urls) {
    const normalizedEntries = []
    const seen = new Set()

    for(const url of urls || []) {
        const normalized = normalizeQuoraProfileHref(url)
        const identityKey = getQuoraProfileSlugDataFromCanonical(normalized)?.normalizedSlug || ''
        if(!normalized || !identityKey || seen.has(identityKey)) continue

        seen.add(identityKey)
        normalizedEntries.push({
            href: normalized,
            identityKey
        })
    }

    // Owner, 15 Oct: no candidate is dropped for being a prefix of a longer identity, so Jane and Jane-7 are two profiles.
    return normalizedEntries.map(entry => entry.href)
}

function normalizeQuoraPostHref(href) {
    if(!href) return null

    try {
        const url = new URL(href, location.origin)
        url.hash = ''

        const pathname = url.pathname.replace(/\/$/, '')
        if(!pathname || pathname === '/') return null

        const oid = url.searchParams.get('oid')
        return oid ? `${url.origin}${pathname}?oid=${oid}` : `${url.origin}${pathname}`
    }
    catch {
        return null
    }
}

function getProfileUrlsFromText(text) {
    const urls = []
    const seen = new Set()
    const matches = `${text || ''}`.matchAll(/https?:\/\/(?:www\.)?quora\.com\/[^\s<>"'`)\]]+/gi)

    for(const match of matches) {
        const rawHref = `${match?.[0] || ''}`
        if(isTruncatedQuoraProfileTextUrl(rawHref)) continue

        const cleanedHref = rawHref.replace(/[),.;:!?]+$/g, '')
        const href = normalizeQuoraProfileHref(cleanedHref)
        if(!isLikelyExplicitProfileTargetHref(href)) continue
        if(!href || seen.has(href)) continue

        seen.add(href)
        urls.push(href)
    }

    return urls
}

function makeSpaceFeedCandidateEvidence(collector = 'profile-links', confidence = SPACE_FEED_CANDIDATE_CONFIDENCE_HIGH, extra = {}) {
    return {
        collector,
        confidence,
        ...extra
    }
}

function attachSpaceFeedCandidateMetadata(urls, evidenceByHref = {}, needsSourceResolution = false) {
    Object.defineProperty(urls, 'candidateEvidenceByHref', {
        configurable: true,
        enumerable: false,
        value: evidenceByHref
    })
    Object.defineProperty(urls, 'needsSourceResolution', {
        configurable: true,
        enumerable: false,
        value: needsSourceResolution
    })
    return urls
}

function normalizeSpaceFeedCandidateEvidenceByHref(evidenceByHref = {}, urls = []) {
    const normalized = {}

    for(const href of urls || []) {
        const normalizedHref = normalizeQuoraProfileHref(href)
        if(!normalizedHref) continue

        const evidence = evidenceByHref[href] || evidenceByHref[normalizedHref] || null
        if(evidence) {
            normalized[normalizedHref] = {
                collector: evidence.collector || 'profile-links',
                confidence: evidence.confidence || '',
                source: evidence.source || '',
                rawSlug: evidence.rawSlug || '',
                candidateHref: normalizedHref
            }
        }
    }

    return normalized
}

function mergeSpaceFeedCandidateEvidenceByHref(...maps) {
    const merged = {}

    for(const map of maps) {
        for(const [href, evidence] of Object.entries(map || {})) {
            const normalizedHref = normalizeQuoraProfileHref(href)
            if(!normalizedHref || !evidence) continue

            merged[normalizedHref] = {
                ...(merged[normalizedHref] || {}),
                ...evidence,
                candidateHref: normalizedHref
            }
        }
    }

    return merged
}

function isTruncatedQuoraProfileTextUrl(href) {
    return /\/profile\/[^/\s<>"'`)\]]*(?:\.{3,}|…)/i.test(`${href || ''}`)
}

function isLowConfidenceSpacePostProfileSlug(slug) {
    const tokens = `${slug || ''}`.split('-').filter(Boolean)
    return tokens.length < 2
}

function getProfileUrlCandidatesFromSpacePostHref(href) {
    const normalizedPostHref = normalizeQuoraPostHref(href)
    if(!normalizedPostHref) return []

    const candidates = []
    const seen = new Set()
    const addSlug = slug => {
        const cleanSlug = sanitizeProfileHrefSlug(slug)
        if(!cleanSlug) return

        const profileHref = normalizeQuoraProfileHref(`https://www.quora.com/profile/${encodeURIComponent(cleanSlug)}`)
        if(!profileHref || seen.has(profileHref)) return

        seen.add(profileHref)
        const confidence = isLikelyExplicitProfileTargetSlug(cleanSlug)
            ? (isLowConfidenceSpacePostProfileSlug(cleanSlug)
                ? SPACE_FEED_CANDIDATE_CONFIDENCE_LOW
                : SPACE_FEED_CANDIDATE_CONFIDENCE_MEDIUM)
            : SPACE_FEED_CANDIDATE_CONFIDENCE_LOW
        candidates.push({
            href: profileHref,
            collector: 'space-post-url-artifact',
            confidence,
            source: 'post-url',
            rawSlug: `${slug || ''}`
        })
    }

    try {
        const url = new URL(normalizedPostHref, location.origin)
        const decodedPath = decodeURIComponent(url.pathname || '').replace(/^\/+/, '')
        const matches = decodedPath.matchAll(/(?:^|[-_/])https?-www-quora-com-profile-([^/?#]+)/gi)

        for(const match of matches) {
            if(match?.[1]) {
                addSlug(match[1])
            }
        }
    }
    catch {
        return candidates
    }

    return candidates
}

function getProfileUrlsFromSpacePostHref(href) {
    return getProfileUrlCandidatesFromSpacePostHref(href)
        .filter(candidate => candidate.confidence !== SPACE_FEED_CANDIDATE_CONFIDENCE_LOW)
        .map(candidate => candidate.href)
}

function normalizeRememberedProfileDisplayName(label) {
    const normalizedLabel = `${label || ''}`.replace(/\s+/g, ' ').trim()
    if(!normalizedLabel) return ''

    const embeddedProfileMatch = normalizedLabel.match(/https?:\/\/(?:www\.)?quora\.com\/[^\s<>"'`)\]]+/i)
    if(embeddedProfileMatch?.[0]) {
        if(isTruncatedQuoraProfileTextUrl(embeddedProfileMatch[0])) return ''

        const href = normalizeQuoraProfileHref(embeddedProfileMatch[0].replace(/[),.;:!?]+$/g, ''))
        const slugData = getQuoraProfileSlugData(href)
        if(slugData?.normalizedSlug) {
            return sanitizeProfileDisplaySlug(slugData.normalizedSlug)
        }
    }

    if(/^https?:\/\//i.test(normalizedLabel)) return ''

    const cleanedLabel = normalizedLabel
        .replace(/^(?:quora|profile)\s+/i, '')
        .replace(/(?:[-_\s]+)(?:followers?|following)$/i, '')
        .trim()

    if(!cleanedLabel) return ''
    if(/^(?:quora|profile|followers?|following)$/i.test(cleanedLabel)) return ''

    return cleanedLabel
}

function rememberProfileDisplayName(href, label) {
    const normalizedHref = normalizeQuoraProfileHref(href)
    const normalizedLabel = normalizeRememberedProfileDisplayName(label)
    if(!normalizedHref || !normalizedLabel) return

    profileDisplayNamesByHref[normalizedHref] = normalizedLabel
}

function rememberVisibleProfileDisplayNames(root) {
    if(!root) return

    for(const link of getQuoraProfileLinks(root)) {
        const label = getElementText(link)
        if(!label) continue

        rememberProfileDisplayName(link.href, label)
    }
}

function getProfileDisplayName(href) {
    const normalizedHref = normalizeQuoraProfileHref(href)
    const cachedName = normalizedHref ? profileDisplayNamesByHref[normalizedHref] : ''
    if(cachedName) return cachedName

    const slugData = getQuoraProfileSlugData(href)
    if(!slugData) return ''

    const cleanSlug = sanitizeProfileDisplaySlug(slugData.normalizedSlug)

    return cleanSlug
}

// Owner, 15 Oct: no suffix is stripped for display either, until a live example proves one must go.
function sanitizeProfileDisplaySlug(slug) {
    return sanitizeProfileHrefSlug(slug)
}

function buildNukeTargetsHelpText(baseText, urls) {
    const previewEntries = []
    const seenUrls = new Set()

    for(const url of urls || []) {
        const normalizedUrl = normalizeQuoraProfileHref(url)
        if(!normalizedUrl || seenUrls.has(normalizedUrl)) continue

        seenUrls.add(normalizedUrl)
        const name = getProfileDisplayName(url)
        previewEntries.push(name ? `- ${name} | ${normalizedUrl}` : `- ${normalizedUrl}`)
    }

    if(!previewEntries.length) return baseText

    return [
        `${baseText} (${previewEntries.length} candidate${previewEntries.length === 1 ? '' : 's'})`,
        '',
        'Will nuke:',
        ...previewEntries
    ].join('\n')
}

function getOriginalPosterProfileHrefFromInlineData() {
    const parsedProfileHref = getOriginalPosterProfileHrefFromInlinePayloads()
    if(parsedProfileHref) return parsedProfileHref

    const patterns = [
        /\\"contentObject\\":\{\\"__typename\\":\\"Question\\"[\s\S]{0,12000}?\\"asker\\":\{[\s\S]{0,4000}?\\"profileUrl\\":\\"(\/profile\/[^"\\?#]+)(?:[?#][^"\\]*)?\\"/,
        /"contentObject":\{"__typename":"Question"[\s\S]{0,12000}?"asker":\{[\s\S]{0,4000}?"profileUrl":"(\/profile\/[^"?#]+)(?:[?#][^"]*)?"/,
        /\\"asker\\":\{[\s\S]{0,4000}?\\"profileUrl\\":\\"(\/profile\/[^"\\?#]+)(?:[?#][^"\\]*)?\\"/,
        /"asker":\{[\s\S]{0,4000}?"profileUrl":"(\/profile\/[^"?#]+)(?:[?#][^"]*)?"/,
        /\\"feedReason\\":\{[\s\S]{0,8000}?\\"user(?:Names|Photos)\\"\\s*:\\s*\\[\\{[\s\S]{0,4000}?\\"profileUrl\\":\\"((?:https?:\/\/(?:www\\.)?quora\\.com)?\/profile\/[^"\\?#]+)(?:[?#][^"\\]*)?\\"/,
        /"feedReason":\{[\s\S]{0,8000}?"user(?:Names|Photos)"\s*:\s*\[\{[\s\S]{0,4000}?"profileUrl":"((?:https?:\/\/(?:www\.)?quora\.com)?\/profile\/[^"?#]+)(?:[?#][^"]*)?"/
    ]

    for(const script of Array.from(document.scripts || [])) {
        const text = script.textContent || ''
        if(!text || (!text.includes('ContentLogPageLoadableQuery') && !text.includes('asker') && !text.includes('contentObject'))) {
            continue
        }

        for(const pattern of patterns) {
            const match = text.match(pattern)
            const href = normalizeQuoraProfileHref(match?.[1])
            if(href) return href
        }
    }

    return null
}

function getOriginalPosterProfileHrefFromParsedInlinePayload(data = null) {
    const directCandidates = [
        data?.data?.contentObject?.asker?.profileUrl,
        data?.data?.contentObject?.author?.profileUrl,
        data?.data?.contentObject?.tribeItem?.author?.profileUrl,
        data?.data?.question?.asker?.profileUrl,
        data?.data?.question?.author?.profileUrl
    ]
    for(const candidate of directCandidates) {
        const href = normalizeQuoraProfileHref(candidate)
        if(href) return href
    }

    const feedReason = data?.data?.feedReason || data?.data?.question?.feedReason || null
    const relevantUsers = [
        ...(Array.isArray(feedReason?.userNames) ? feedReason.userNames : []),
        ...(Array.isArray(feedReason?.userPhotos) ? feedReason.userPhotos : []),
        ...(Array.isArray(feedReason?.relevantUsers) ? feedReason.relevantUsers : [])
    ]
    const hrefs = getNormalizedProfileHrefList(relevantUsers.map(user => user?.profileUrl || ''))
    return hrefs.length === 1 ? hrefs[0] : null
}

function getOriginalPosterProfileHrefFromInlinePayloads() {
    for(const script of Array.from(document.scripts || [])) {
        const text = script.textContent || ''
        if(!text || !text.includes('ContentLogPageLoadableQuery')) continue

        const pushMatches = text.matchAll(/\.push\("((?:\\.|[^"\\])*)"\)/g)

        for(const match of pushMatches) {
            const escapedPayload = match[1]

            try {
                const payload = JSON.parse(`"${escapedPayload}"`)
                const data = JSON.parse(payload)
                const href = getOriginalPosterProfileHrefFromParsedInlinePayload(data)
                if(href) return href
            }
            catch {
                continue
            }
        }
    }

    return null
}

// The sink, when given, records which step found the profile: 'inline' (the page's own data) or 'scored' (the keyword scan of
// visible links). The scan is the only resolver step that guesses from the page, so the live-check card counts it (owner, 15 Oct).
function getOriginalPosterProfileHref(sink = null) {
    const inlineProfileHref = getOriginalPosterProfileHrefFromInlineData()
    if(inlineProfileHref) {
        if(sink) sink.source = 'inline'
        return inlineProfileHref
    }

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    if(!main) return null

    const profileLinks = getQuoraProfileLinks(main)
        .filter(isVisible)
        .map(link => ({link, score: scoreOriginalPosterLink(link)}))
        .filter(entry => entry.score > 0)

    profileLinks.sort((left, right) => right.score - left.score)
    const scoredProfileHref = normalizeQuoraProfileHref(profileLinks[0]?.link.href) || null
    if(scoredProfileHref && sink) sink.source = 'scored'
    return scoredProfileHref
}

function scoreOriginalPosterLink(link) {
    const href = link.href || ''
    if(!normalizeQuoraProfileHref(href)) return Number.NEGATIVE_INFINITY

    const rect = link.getBoundingClientRect()
    const context = getBestActionContext(link)
    const contextText = `${getElementText(link)} ${context?.text || ''}`.toLowerCase()

    let score = 0

    if(/\basked\b/.test(contextText)) score += 2000
    if(/\bquestion\s+(?:added|created|asked)\b/.test(contextText)) score += 1600
    if(/\bcreated\b/.test(contextText) && /\bquestion\b/.test(contextText)) score += 1200
    if(/\blog\b/.test(contextText)) score += 60
    if(/\banswer(?:ed|er|s)?\b/.test(contextText)) score -= 600
    if(/\bcomment(?:ed|er|s)?\b/.test(contextText)) score -= 600
    if(/\bfollow(?:er|ing|s)?\b/.test(contextText)) score -= 400

    score -= rect.top / 20
    score -= rect.left / 200

    return score
}

function getSortContainer() {
    let questionMain = getQuestionMain()
    if (!questionMain) return null

    return {main: questionMain, container: findQuestionSortContainer(questionMain)}
}

function getQuestionFilterButton(container) {
    if(!container) return null

    const childGroups = Array.from(container.children || [])
    const fallbackButtons = []

    for(const group of childGroups) {
        const filterButton = group.querySelector('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')
        if(!filterButton || !isVisible(filterButton)) continue

        const text = getElementText(filterButton)
        if(/\ball related\b|\banswers\b/i.test(text)) return filterButton

        fallbackButtons.push(filterButton)
    }

    return fallbackButtons[0] || null
}

function scoreQuestionSortContainer(container) {
    if(!container) return Number.NEGATIVE_INFINITY

    let score = 0
    const rect = container.getBoundingClientRect()
    const filterButton = getQuestionFilterButton(container)
    const filterText = getElementText(filterButton)
    const rightGroup = container.lastElementChild
    const rightText = getElementText(rightGroup)
    const rightMenu = rightGroup?.querySelector('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')

    if(filterButton) score += 200
    if(/\ball related\b|\banswers\b/i.test(filterText)) score += 600
    if(rightGroup) score += 80
    if(/\bsort\b/i.test(rightText)) score += 220
    if(rightMenu && isVisible(rightMenu)) score += 120
    if(container.firstElementChild && container.lastElementChild && container.firstElementChild !== container.lastElementChild) score += 80
    score -= rect.top / 100

    return score
}

function findQuestionMenuOption(pattern) {
    const roots = getOverlayRoots(false)

    for(const root of roots) {
        const candidates = Array.from(root.querySelectorAll('.puppeteer_test_popover_item, [role="menuitem"], [role="option"], button, [role="button"]'))
        const option = candidates.find(candidate => {
            if(!isVisible(candidate)) return false

            const text = getElementText(candidate)
            if(!pattern.test(text)) return false

            // Avoid matching the already-selected "All related" row or inert wrappers.
            return !/\ball related\b/i.test(text)
        })

        if(option) return option
    }

    return null
}

async function maybeFlipQuestionFilterToAnswers(container) {
    if(!settings.flipToAnswers) return container

    const filterButton = getQuestionFilterButton(container)
    if(!filterButton) return container

    const currentFilter = getElementText(filterButton)
    if(/\banswers\b/i.test(currentFilter)) return container
    if(!/\ball related\b/i.test(currentFilter)) return container

    filterButton.click()
    await sleep(200)

    let answerOption = null

    for(let attempt = 0; attempt < 6; attempt++) {
        answerOption = findQuestionMenuOption(/\banswer(?:s)?\b/i)
        if(answerOption) break
        await sleep(150)
    }

    if(!answerOption) return container

    answerOption.click()
    await sleep(settings.fopFlipDelay)

    return getSortContainer()?.container || container
}

function collectSpacePostBodyProfileUrls(textRoot, excludedHref = null) {
    if(!textRoot) return []

    const urls = []
    const seen = new Set()

    for(const link of getQuoraProfileLinks(textRoot)) {
        if(!isVisible(link)) continue

        const href = normalizeQuoraProfileHref(link.href)
        if(!href || href === excludedHref || seen.has(href)) continue

        seen.add(href)
        urls.push(href)
    }

    return urls
}

function getSpacePostPrimaryBodyRoot() {
    const candidates = Array.from(document.querySelectorAll('.qu-userSelect--text'))
        .filter(isVisible)
        .map(root => ({root, urls: collectSpacePostBodyProfileUrls(root)}))
        .filter(candidate => candidate.urls.length >= SPACE_POST_NUKE_MIN_PROFILES)

    candidates.sort((left, right) => {
        const leftRect = left.root.getBoundingClientRect()
        const rightRect = right.root.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return candidates[0]?.root || null
}

function getSpacePostPrimaryPostContainer() {
    const bodyRoot = getSpacePostPrimaryBodyRoot()
    if(!bodyRoot) return null

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    let node = bodyRoot.parentElement

    while(node) {
        if(node.nodeType === Node.ELEMENT_NODE && node.querySelector('a.post_timestamp, .post_timestamp')) {
            return node
        }

        if(node === main) break
        node = node.parentElement
    }

    return null
}

function getSpacePostTimestampLink(scope = null) {
    const root = scope || getSpacePostPrimaryPostContainer() || document
    const timestamps = Array.from(root.querySelectorAll('a.post_timestamp, .post_timestamp'))
        .filter(isVisible)

    timestamps.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return timestamps[0] || null
}

function getSpacePostHeaderContainer() {
    const scopedContainer = getSpacePostPrimaryPostContainer()
    const timestamp = getSpacePostTimestampLink(scopedContainer)
    if(!timestamp) return scopedContainer || null

    const main = scopedContainer || document.querySelector('#mainContent, main, [role="main"]') || document.body
    const timestampRect = timestamp.getBoundingClientRect()
    let node = timestamp.parentElement
    let bestMatch = null

    while(node) {
        if(node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentElement
            continue
        }

        const followButtons = getSpacePostHeaderActionCandidates(node)
        const profileLinks = getQuoraProfileLinks(node).filter(isVisible)
        const rect = node.getBoundingClientRect()
        let score = 0

        if(followButtons.length) score += 600
        if(profileLinks.length) score += 240
        if(profileLinks.length <= 3) score += 120
        score -= Math.abs(rect.top - timestampRect.top) / 4

        if(score > 0 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = {node, score}
        }

        if(node === main) break
        node = node.parentElement
    }

    return bestMatch?.node || timestamp.parentElement || null
}

function getSpacePostHeaderActionCandidates(root) {
    const candidates = getVisibleFollowProxyCandidates(root)

    candidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return candidates
}

function getSpacePostHeaderActionAnchor() {
    const container = getSpacePostHeaderContainer()
    if(!container) return null

    const timestamp = getSpacePostTimestampLink()
    if(timestamp && container.contains(timestamp)) return timestamp

    const followButtons = getSpacePostHeaderActionCandidates(container)
    if(followButtons.length) return followButtons[followButtons.length - 1]

    const profileLinks = getQuoraProfileLinks(container).filter(isVisible)
    profileLinks.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return profileLinks[0] || null
}

function getSpacePostHeaderProfileHref() {
    const container = getSpacePostHeaderContainer()
    if(!container) return null

    const profileLinks = getQuoraProfileLinks(container).filter(isVisible)
    profileLinks.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return normalizeQuoraProfileHref(profileLinks[0]?.href) || null
}

function getSpacePostContentRoot() {
    const scopedContainer = getSpacePostPrimaryPostContainer()
    if(scopedContainer) return scopedContainer

    const timestamp = getSpacePostTimestampLink()
    if(!timestamp) return null

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    const timestampRect = timestamp.getBoundingClientRect()
    let node = timestamp.parentElement
    let bestMatch = null

    while(node) {
        if(node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentElement
            continue
        }

        const profileLinks = getQuoraProfileLinks(node).filter(isVisible)
        const bodyText = node.querySelector('.qu-userSelect--text, p')
        const rect = node.getBoundingClientRect()
        let score = 0

        if(bodyText) score += 700
        if(profileLinks.length >= SPACE_POST_NUKE_MIN_PROFILES) score += 500
        else if(profileLinks.length >= 2) score += 180
        if(profileLinks.length > 40) score -= 500
        score -= Math.abs(rect.top - timestampRect.top) / 6

        if(score > 0 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = {node, score}
        }

        if(node === main) break
        node = node.parentElement
    }

    return bestMatch?.node || getSpacePostHeaderContainer()
}

function getSpacePostListedProfileLinks() {
    const headerProfileHref = getSpacePostHeaderProfileHref()
    const primaryBodyRoot = getSpacePostPrimaryBodyRoot()
    if(primaryBodyRoot) {
        return collectSpacePostBodyProfileUrls(primaryBodyRoot, headerProfileHref)
    }

    const root = getSpacePostContentRoot()
    if(!root) return []

    const headerAnchor = getSpacePostHeaderActionAnchor()
    const headerBottom = headerAnchor?.getBoundingClientRect().bottom || getSpacePostTimestampLink()?.getBoundingClientRect().bottom || 0
    let actionBarTop = Infinity

    for(const candidate of Array.from(root.querySelectorAll('button, a, [role="button"]'))) {
        if(!isVisible(candidate)) continue

        const label = getElementText(candidate).trim()
        if(!/^(?:upvote|comment|share|save)$/i.test(label)) continue

        const rect = candidate.getBoundingClientRect()
        if(rect.top > headerBottom + 12) {
            actionBarTop = Math.min(actionBarTop, rect.top)
        }
    }

    const bodyTextRoots = Array.from(root.querySelectorAll('.qu-userSelect--text'))
        .filter(isVisible)
        .filter(textRoot => {
            const rect = textRoot.getBoundingClientRect()
            if(rect.top <= headerBottom + 12) return false
            if(Number.isFinite(actionBarTop) && rect.top >= actionBarTop - 12) return false
            return true
        })

    const urls = []
    const seen = new Set()

    for(const textRoot of bodyTextRoots) {
        for(const link of getQuoraProfileLinks(textRoot)) {
            if(!isVisible(link)) continue

            const href = normalizeQuoraProfileHref(link.href)
            if(!href || href === headerProfileHref || seen.has(href)) continue

            const rect = link.getBoundingClientRect()
            if(headerBottom && rect.top <= headerBottom + 12) continue
            if(Number.isFinite(actionBarTop) && rect.top >= actionBarTop - 12) continue

            seen.add(href)
            urls.push(href)
        }
    }

    return urls
}

function getSpacePostResolutionProfileLinkCandidates() {
    const candidates = []
    const seen = new Set()
    const addHref = (href, source = '') => {
        const normalizedHref = normalizeQuoraProfileHref(href)
        if(!normalizedHref || seen.has(normalizedHref)) return

        seen.add(normalizedHref)
        candidates.push({href: normalizedHref, source})
    }

    for(const href of getProfileUrlsFromText(document.title || '')) {
        addHref(href, 'title')
    }

    const root = getSpacePostContentRoot()
    if(root) {
        for(const href of getProfileUrlsFromText(getElementText(root))) {
            addHref(href, 'body-text')
        }
    }

    for(const href of getSpacePostListedProfileLinks()) {
        addHref(href, 'listed-profile-link')
    }

    return candidates
}

function getSpacePostResolutionProfileLinks() {
    return getSpacePostResolutionProfileLinkCandidates().map(candidate => candidate.href)
}

function getSingleSpacePostResolutionProfileHref(options = {}) {
    const candidates = getSpacePostResolutionProfileLinkCandidates()
        .filter(candidate => {
            if(options.explicitOnly !== true) return true
            return candidate.source === 'title' ||
                candidate.source === 'body-text' ||
                candidate.source === 'listed-profile-link'
        })
    const urls = getNormalizedProfileHrefList(candidates.map(candidate => candidate.href))
    return urls.length === 1 ? urls[0] : null
}

function setSpacePostNukeUrls(button, urls) {
    if(!button) return
    button.dataset.mbNukeUrls = JSON.stringify(getNormalizedProfileHrefList(urls))
}

function getSpacePostNukeUrls(button) {
    if(!button) return []

    try {
        const urls = JSON.parse(button.dataset.mbNukeUrls || '[]')
        return Array.isArray(urls) ? getNormalizedProfileHrefList(urls) : []
    }
    catch {
        return []
    }
}

function getSpacePostButtonHost() {
    const postContainer = getSpacePostPrimaryPostContainer() || getSpacePostContentRoot()
    const headerContainer = getSpacePostHeaderContainer()
    if(!postContainer) return null

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    let anchorContainer = postContainer
    let node = postContainer.parentElement

    while(node) {
        if(node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentElement
            continue
        }

        const rect = node.getBoundingClientRect()
        const currentRect = anchorContainer.getBoundingClientRect()
        const isMeaningfullyWider = rect.width >= currentRect.width + 24
        const isReasonableHeight = rect.height <= currentRect.height * 1.75
        const isNotTooWide = rect.width <= postContainer.getBoundingClientRect().width * 1.5

        if(isMeaningfullyWider && isReasonableHeight && isNotTooWide) {
            anchorContainer = node
        }

        if(node === main) break
        node = node.parentElement
    }

    let slot = anchorContainer.querySelector(':scope > .mb-ext_post-nuke-slot')
    if(slot) return slot

    slot = document.createElement('div')
    slot.className = 'mb-ext_post-nuke-slot'
    anchorContainer.classList.add('mb-ext_post-card')

    if(headerContainer && postContainer.contains(headerContainer)) {
        headerContainer.classList.add('mb-ext_post-header-host')

        const headerRect = headerContainer.getBoundingClientRect()
        const anchorRect = anchorContainer.getBoundingClientRect()
        const top = Math.max(10, Math.round(headerRect.top - anchorRect.top + headerRect.height / 2))
        slot.style.top = `${top}px`
    }

    anchorContainer.appendChild(slot)
    return slot
}

function injectSpacePostNukeBtn() {
    let btn = document.querySelector('.mb-ext_post-nuke-btn')
    const host = getSpacePostButtonHost()
    if(!host) {
        btn?.remove()
        return false
    }

    const urls = getSpacePostListedProfileLinks()
    if(urls.length < SPACE_POST_NUKE_MIN_PROFILES) {
        btn?.remove()
        return false
    }

    if(btn && btn.parentElement !== host) {
        btn.remove()
        btn = null
    }

    if(!btn) {
        btn = document.createElement('button')
        btn.innerText = `Nuke 'Em`
        btn.classList.add('mb-ext_nuke-profiles-btn', 'mb-ext_post-nuke-btn')
        setMuteBlockHelp(btn, buildNukeTargetsHelpText('Queue detected profiles from this post for mute and block', urls))
        btn.addEventListener('click', async () => {
            const liveUrls = getSpacePostListedProfileLinks()
            const currentUrls = getUnsuccessfulProfileNukeUrls(liveUrls.length ? liveUrls : getSpacePostNukeUrls(btn))
            if(!currentUrls.length) {
                setNukeButtonDone(btn, NUKED_LABEL)
                return
            }

            await animateNukeButtonPress(btn)
            btn.disabled = true
            setNukeButtonWorking(btn)

            try {
                const result = await enqueueCoordinatorProfileUrls({
                    urls: currentUrls,
                    sourceType: 'space-post',
                    event: 'Queued from space post',
                    maxConcurrent: getProfilesPerBatch()
                })

                if((result?.executionQueued || result?.queued || result?.merged || 0) > 0) {
                    await waitForOwnedNukeTabsToDrain(btn, 180000, 1000, {runId: result?.runId || ''})
                }
                else {
                    const sweep = await sweepBlockedProfileTabs()
                    if(sweep.owned > 0) {
                        await waitForOwnedNukeTabsToDrain(btn, 180000, 1000, {runId: result?.runId || ''})
                    }
                    else {
                        setNukeButtonNotice(btn, NOTHING_QUEUED_LABEL)
                    }
                }
            }
            finally {
                btn.disabled = false
            }
        })
    }
    else {
        if(btn.dataset.mbNukeState !== 'working' && btn.dataset.mbNukeState !== 'done') {
            setNukeButtonIdle(btn)
        }
    }

    setSpacePostNukeUrls(btn, urls)
    setMuteBlockHelp(btn, buildNukeTargetsHelpText('Queue detected profiles from this post for mute and block', urls))
    host.classList.add('mb-ext_post-header-host', 'mb-ext_post-nuke-slot')

    if(btn.parentElement !== host) {
        host.insertAdjacentElement('beforeend', btn)
    }

    return true
}

function injectSpaceSidebarOpenProfilesBtn() {
    if(document.querySelector('.mb-ext_view-contributors-btn, .mb-ext_open-profiles-btn')) return

    const XPATH = "//div[contains(@class, 'q-click-wrapper') and contains(string(), 'View all')]"
    let query = document.evaluate(XPATH, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)

    let viewLink = query.snapshotItem(0)

    if(viewLink) {
        let btn = document.createElement('button')
        btn.innerText = 'View Contributors'
        btn.classList.add('mb-ext_open-profiles-btn', 'mb-ext_view-contributors-btn')
        setMuteBlockHelp(btn, 'Open the contributor list for this space')
        btn.addEventListener('click', () => viewLink.click())

        viewLink.insertAdjacentElement('afterend', btn)
    }
    else {
        const XPATH = "//div[contains(@class, 'q-box') and contains(string(), 'Contributor')]"
        let query = document.evaluate(XPATH, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)

        let qbox = query.snapshotItem(query.snapshotLength-1)
        if(!qbox) return

        let btn = document.createElement('button')
        btn.innerHTML = `Open Profiles <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
            <path d="M11 13l9 -9" />
            <path d="M15 4h5v5" />
        </svg>`

        btn.classList.add('mb-ext_open-profiles-btn')
        setMuteBlockHelp(btn, 'Open listed contributor profiles in background tabs')
        btn.addEventListener('click', e => {
            let items = document.querySelectorAll('.tribe_page_header_people_list_item:not([data-mb-opened])')

            for (const item of items) {
                item.dataset.mbOpened = true

                const link = getQuoraProfileLinks(item)[0]
                if(link) {
                    void safeSendRuntimeMessage({action: 'create-tab', url: normalizeQuoraProfileHref(link.href) || link.href})
                }

                item.style.backgroundColor = '#d4edda'
            }
        })

        qbox.insertAdjacentElement('afterend', btn)
    }
}

// Space pages: the "Collect N More" button, placed under the contributor header in the right column. Like the profile search button,
// it scrolls the feed until N more are collected, then stops. The collected count is the one Nuke 'Em shows, which grows as the page
// is scrolled, and the posts it counts are the ones Nuke 'Em acts on (asset or target spaces only). The choice and the default match the
// search button and are kept for this space page only, in memory.
function getSpaceFeedCollectKey() {
    return `${location.origin}${location.pathname}`
}

// A space page starts with the count on its registry record, or the default when the space has no record (no category yet).
function ensureSpaceFeedCollectStateForCurrentSpace() {
    const key = getSpaceFeedCollectKey()
    if(spaceFeedCollectKey === key) return

    spaceFeedCollectKey = key
    spaceFeedCollectLimit = normalizeSpaceCollectCount(getStoredSpaceRecord(resolveCurrentSpaceDescriptor())?.collectCount)
}

// The registry can load after the page starts, and another tab can change the count. A space with no record keeps its in-memory count.
function syncSpaceFeedCollectLimitFromRecord() {
    const record = getStoredSpaceRecord(resolveCurrentSpaceDescriptor())
    if(!record) return

    spaceFeedCollectLimit = normalizeSpaceCollectCount(record.collectCount)
    if(!spaceFeedCollecting) syncSpaceFeedCollectButton()
}

// Only a count the dropdown offers is taken. It applies to this space page, and to the space's record when it has one.
function setSpaceFeedCollectLimit(value) {
    if(!PROFILE_SEARCH_COLLECT_CHOICES.includes(value)) return
    spaceFeedCollectLimit = value
    syncSpaceFeedCollectButton()
    void persistSpaceFeedCollectCount(value)
}

// The count is written into the space's registry record through the same door the category buttons use, as a change to that one record.
// A space with no record (no category) has nowhere to keep it, so nothing is written and the count stays in memory.
async function persistSpaceFeedCollectCount(value) {
    const record = getStoredSpaceRecord(resolveCurrentSpaceDescriptor())
    if(!record || record.collectCount === value) return

    const recordKey = Object.keys(spaceRegistry).find(key => spaceRegistry[key] === record)
    if(!recordKey) return

    const nextRecord = withSpaceRecordCollectCount(record, value)
    if(!nextRecord) return

    spaceRegistry = {
        ...spaceRegistry,
        [recordKey]: nextRecord
    }
    const reply = await safeSendRuntimeMessage({action: 'set-space-record', key: recordKey, change: {collectCount: value}, at: Date.now()}, null)
    applySpaceRecordReply(recordKey, reply)
}

// The page's copy takes each incoming record (a storage value, a reply, the load) unless the page already holds a newer record for that key
// (29 Oct). A late event or reply that carries an older record cannot put that record back over a write the page made. The page's record
// keeps its action time, so the newer one is the one the user made last.
function mergeIncomingSpaceRecords(incoming) {
    const merged = {...(incoming && typeof incoming === 'object' ? incoming : {})}
    for(const [key, local] of Object.entries(spaceRegistry || {})) {
        if(!local || typeof local !== 'object') continue
        const remote = merged[key]
        if(!remote || (Number(local.updatedAt) || 0) > (Number(remote.updatedAt) || 0)) merged[key] = local
    }
    return merged
}

// The worker refuses a write older than the record it holds, and replies with the stored record. The page takes that record, so its
// copy and the buttons show what storage holds.
function applySpaceRecordReply(key, reply) {
    // A reply with no stored record never replaces the page's copy with a default (29 Oct).
    if(!reply?.refused || !reply.record) return

    spaceRegistry = mergeIncomingSpaceRecords({...spaceRegistry, [key]: reply.record})
    syncSpaceFeedCollectLimitFromRecord()
    syncSpaceClassificationControls()
    scheduleSpaceAssetNukeControls(0)
}

// The stop rule, kept pure so it can be tested. A collect is done once `limit` more were collected since the press. The peak count is
// used, so a dip while posts scroll out of the scan does not hold the run open.
function getSpaceFeedCollectedSince(startCount, peakCount) {
    return Math.max(0, peakCount - startCount)
}

function isSpaceFeedCollectDone(startCount, peakCount, limit) {
    return getSpaceFeedCollectedSince(startCount, peakCount) >= limit
}

// The count Nuke 'Em shows, after a fresh scan of the posts on the page. The count is kept across scrolling, so it grows as the page scrolls.
function readSpaceFeedCollectedCount() {
    syncSpaceFeedNukeControls()
    return Number.parseInt(lastSpaceFeedRenderModel?.queueableCount, 10) || 0
}

// Stops the running collect at its next pass. What it already collected stays: the count and the items are not cleared. Returns false
// when no collect runs, so a stale press does nothing.
function requestSpaceFeedCollectStop() {
    if(!spaceFeedCollecting) return false
    spaceFeedCollectStopRequested = true
    setSpaceFeedCollectButtons(collectButton => setNukeButtonWorking(collectButton, 'Stopping...'))
    return true
}

// The Stop collecting button sits at the bottom of the page, left of Quora's "Next notification" pill, as on search pages (owner, 26 Oct).
// It is one element on the body, not in the right column, so a re-render of the column or the feed cannot remove it mid-run. It is created
// only while a collect runs, and it is hidden again when the run ends. Its click stops that run.
// The Stop collecting label, read from the run's counters (formatCollectStopLabel in candidateCollect.js). It is written only when the text
// changes, so the page's observers are not woken for the same label.
function refreshSpaceFeedStopLabel() {
    const stopButton = document.querySelector('.mb-ext_space-collect-stop-btn')
    if(!stopButton || !spaceFeedCollecting) return
    const label = formatCollectStopLabel({
        collected: spaceFeedCollectProgress.collected,
        target: spaceFeedCollectProgress.target,
        passes: spaceFeedCollectProgress.passes,
        elapsedMs: Date.now() - spaceFeedCollectProgress.startedAt
    })
    if(stopButton.textContent !== label) stopButton.textContent = label
}

function syncSpaceFeedStopButtons() {
    // The label is re-read once per tick while a run is active (owner, 27 Oct). The tick ends with the run.
    if(spaceFeedCollecting && !spaceFeedStopLabelTimer) spaceFeedStopLabelTimer = setInterval(refreshSpaceFeedStopLabel, COLLECT_STOP_LABEL_TICK_MS)
    if(!spaceFeedCollecting && spaceFeedStopLabelTimer) {
        clearInterval(spaceFeedStopLabelTimer)
        spaceFeedStopLabelTimer = 0
    }
    let stopButton = document.querySelector('.mb-ext_space-collect-stop-btn')
    if(!stopButton) {
        if(!spaceFeedCollecting) return
        stopButton = createSpaceCollectStopButton()
        document.body?.appendChild(stopButton)
    }
    const button = ensureCurrentInstanceClickHandler(stopButton, 'space-feed-stop', () => {
        requestSpaceFeedCollectStop()
    })
    if(button) button.hidden = !spaceFeedCollecting
    refreshSpaceFeedStopLabel()
}

// A hidden tab does not load the next batch of posts, so a collect waits for its tab to be visible rather than reading the stall as the end
// of the feed (31 Oct). Resolves when the tab is visible again, or when a stop is requested.
function waitForSpaceFeedTabVisible() {
    return new Promise(resolve => {
        const check = () => {
            if(document.visibilityState !== 'visible' && !spaceFeedCollectStopRequested) return
            document.removeEventListener('visibilitychange', check)
            clearInterval(timer)
            resolve()
        }
        const timer = setInterval(check, 1000)
        document.addEventListener('visibilitychange', check)
    })
}

async function collectMoreSpaceFeedPosts(button) {
    const limit = spaceFeedCollectLimit
    if(spaceFeedCollecting) {
        requestSpaceFeedCollectStop()
        return false
    }

    // Each run starts with its own stop flag cleared, so a stop from an earlier run cannot end this one.
    spaceFeedCollecting = true
    spaceFeedCollectStopRequested = false
    spaceFeedCollectProgress = {startedAt: Date.now(), passes: 0, collected: 0, target: limit}
    syncSpaceFeedStopButtons()
    let endReached = false
    try {
        await animateNukeButtonPress(button)
        const startCount = readSpaceFeedCollectedCount()
        let peakCount = startCount
        setSpaceFeedCollectButtons(collectButton => setNukeButtonWorking(collectButton, `Collecting 0 / ${limit}`))

        // First operation: go to the end of the feed, so Quora loads the next batch. The loop then scrolls down through what loads.
        // A stop pressed during the animation skips it.
        if(!spaceFeedCollectStopRequested) window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'auto'})

        // The shared loop (runCollectLoop in candidateCollect.js) makes the passes. This page scrolls down one screen and waits
        // COLLECT_SCROLL_PASS_WAIT_MS. At the bottom, Quora may still be loading, so the feed ends only after COLLECT_END_CONFIRM_MS without
        // growth. Away from the bottom, a stall of COLLECT_STALLED_TIMEOUT_MS is stuck, not finished.
        const atFeedBottom = () => window.innerHeight + (window.scrollY || 0) >= document.documentElement.scrollHeight - 4
        // Set when a pass waited for a hidden tab. The pass after that counts as progress, so the wait is not read as a stall.
        let resumedFromHiddenTab = false
        const outcome = await runCollectLoop({
            isStopRequested: () => spaceFeedCollectStopRequested,
            isDone: () => isSpaceFeedCollectDone(startCount, peakCount, limit),
            snapshot: () => ({count: peakCount, scrollY: window.scrollY || 0, scrollHeight: document.documentElement.scrollHeight}),
            pass: async () => {
                if(document.visibilityState !== 'visible' && !spaceFeedCollectStopRequested) {
                    resumedFromHiddenTab = true
                    setSpaceFeedCollectButtons(collectButton => setNukeButtonWorking(collectButton, 'Paused: tab hidden'))
                    await waitForSpaceFeedTabVisible()
                    if(spaceFeedCollectStopRequested) return
                }
                window.scrollBy({top: Math.round(window.innerHeight * 0.8), behavior: 'auto'})
            },
            sleep,
            waitMs: COLLECT_SCROLL_PASS_WAIT_MS,
            readProgress: () => {
                peakCount = Math.max(peakCount, readSpaceFeedCollectedCount())
                // A pass counts once its read has run, so the label's count and passes always describe the same reads.
                spaceFeedCollectProgress.collected = getSpaceFeedCollectedSince(startCount, peakCount)
                spaceFeedCollectProgress.passes += 1
                setSpaceFeedCollectButtons(collectButton => setNukeButtonWorking(collectButton, `Collecting ${getSpaceFeedCollectedSince(startCount, peakCount)} / ${limit}`))
            },
            madeProgress: (before, after) => {
                const resumed = resumedFromHiddenTab
                resumedFromHiddenTab = false
                return resumed || collectPassMadeProgress(before, after)
            },
            endCheck: stalledMs => atFeedBottom() && stalledMs >= COLLECT_END_CONFIRM_MS,
            stallTimeoutApplies: () => !atFeedBottom(),
            stallTimeoutMs: COLLECT_STALLED_TIMEOUT_MS
        })
        endReached = outcome === 'end'

        const collected = getSpaceFeedCollectedSince(startCount, peakCount)
        void weedSpaceFeedPosterRows().catch(() => null)
        reportCollectEnd('space', {
            reason: spaceFeedCollectStopRequested ? 'stopped' : collected >= limit ? 'captured' : endReached ? 'end-of-feed' : 'stalled',
            collected,
            limit,
            passes: spaceFeedCollectProgress.passes,
            startedAt: spaceFeedCollectProgress.startedAt
        })
        if(spaceFeedCollectStopRequested) {
            setSpaceFeedCollectButtons(collectButton => setNukeButtonNotice(collectButton, 'Stopped', `Collect ${limit} More`))
            return false
        }
        if(collected < 1) {
            setSpaceFeedCollectButtons(collectButton => setNukeButtonNotice(collectButton, 'No new posts', `Collect ${limit} More`))
            return false
        }
        setSpaceFeedCollectButtons(collectButton => setNukeButtonNotice(collectButton, endReached ? `Collected ${collected} · end of feed` : `Collected ${collected}`, `Collect ${limit} More`))
        return true
    }
    finally {
        spaceFeedCollecting = false
        spaceFeedCollectStopRequested = false
        syncSpaceFeedStopButtons()
        // Owner, 25 Oct: when the collect is done or stopped, the page goes back to the top, where the Nuke 'Em buttons are.
        window.scrollTo({top: 0, behavior: 'auto'})
        syncSpaceFeedCollectButton({keepLabel: true})
    }
}

// The Collect N More button appears in two places, both on asset or target spaces with posts: above the feed's MB Info and Nuke 'Em
// buttons (always), and under the contributor header in the right column (only where "View Contributors" exists). Both share one collect
// and show the same progress. The choice and the default are kept for this space page only, in memory.
function createSpaceCollectWrap(extraClass = '') {
    const wrap = document.createElement('span')
    // The profile search classes give this button the same look and caret as the search button.
    wrap.className = `mb-ext_profile-search-collect-wrap mb-ext_space-collect-wrap ${extraClass}`.trim()
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mb-ext_nuke-profiles-btn mb-ext_profile-search-collect-btn'
    wrap.appendChild(button)
    wrap.appendChild(createProfileSearchCollectLimitSelect())
    return wrap
}

// The Stop collecting button. It is hidden unless a collect runs (see syncSpaceFeedStopButtons). It is not part of the right column.
function createSpaceCollectStopButton() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mb-ext_nuke-profiles-btn mb-ext_space-collect-stop-btn'
    button.textContent = STOP_COLLECT_LABEL_TEXT
    button.hidden = true
    setMuteBlockHelp(button, 'Stop this collect at its next pass. Posts already collected stay, and the page goes back to the top')
    return button
}

// The copy above the feed's buttons. It is a full-width first item of the feed toolbar, so it wraps onto a row of its own above MB Info
// and Nuke 'Em. It does not depend on the right column.
function ensureSpaceCollectWrapAboveFeed() {
    const toolbar = document.querySelector('.mb-ext_space-feed-toolbar')
    if(!toolbar || toolbar.querySelector(':scope > .mb-ext_space-collect-feed-host')) return

    const host = document.createElement('div')
    host.className = 'mb-ext_space-collect-feed-host'
    host.appendChild(createSpaceCollectWrap('mb-ext_space-collect-feed'))
    toolbar.prepend(host)
}

// The copy after the last box in the right column (owner, 25 Oct: it appears once the boxes have scrolled past, so it is not sticky). The
// column can be much taller than its boxes: Quora reserves height for a list that has not rendered, so the copy goes right after the last box,
// not at the end of the column.
function ensureSpaceCollectWrapInRightColumn() {
    const column = getSpaceRightColumn()
    const existing = document.querySelector('.mb-ext_space-collect-column-host')
    if(!column) {
        existing?.remove()
        return
    }
    const lastBox = getLastSpaceColumnBox(column)
    if(existing && (lastBox ? lastBox.nextElementSibling === existing : column.lastElementChild === existing)) return

    const host = existing || document.createElement('div')
    if(!existing) {
        host.className = 'mb-ext_space-collect-column-host'
        host.appendChild(createSpaceCollectWrap('mb-ext_space-collect-column'))
    }
    if(lastBox) lastBox.insertAdjacentElement('afterend', host)
    else column.appendChild(host)
}

// The bottom-most bordered box in the column, outside the copy. Where two boxes end on the same line, the outer one is kept.
function getLastSpaceColumnBox(column) {
    let last = null
    let lastBottom = -Infinity
    for(const box of column.querySelectorAll('[class*="qu-borderAll"]')) {
        if(box.closest('.mb-ext_space-collect-column-host')) continue
        const bottom = box.getBoundingClientRect().bottom
        if(bottom > lastBottom + 1) {
            last = box
            lastBottom = bottom
        }
    }
    return last
}

// The right column is the highest ancestor of the contributor card that is still as wide as the card. It holds any number of boxes, so
// the button goes after all of them. The card is found from the "View all" link, which the contributors box always has.
function getSpaceRightColumn() {
    const viewAll = document.evaluate("//div[contains(@class, 'q-click-wrapper') and contains(string(), 'View all')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
    if(!viewAll) return null

    const card = viewAll.closest('[class*="qu-borderAll"]') || viewAll.parentElement?.parentElement?.parentElement
    if(!card) return null

    const width = card.getBoundingClientRect().width
    let column = card
    for(let el = card.parentElement; el && el !== document.body; el = el.parentElement) {
        if(Math.abs(el.getBoundingClientRect().width - width) > 2) break
        column = el
    }
    return column
}

function removeSpaceCollectButtons() {
    for(const node of document.querySelectorAll('.mb-ext_space-collect-feed-host, .mb-ext_space-collect-column-host, .mb-ext_space-collect-wrap')) node.remove()
    // The Stop button stays for the whole run, even if the page looks momentarily unnukable. It goes only when no run is going.
    if(!spaceFeedCollecting) document.querySelector('.mb-ext_space-collect-stop-btn')?.remove()
}

function injectSpaceCollectButton() {
    if(getPageType() !== 'space' || !isNukableSpacePage() || !document.querySelector('a.post_timestamp, a.answer_timestamp')) {
        removeSpaceCollectButtons()
        return false
    }

    ensureSpaceFeedCollectStateForCurrentSpace()
    ensureSpaceCollectWrapAboveFeed()
    ensureSpaceCollectWrapInRightColumn()
    syncSpaceFeedCollectButton()
    return true
}

// Every Collect N More button on the page, so both copies show the same progress.
function setSpaceFeedCollectButtons(setLabel) {
    for(const button of document.querySelectorAll('.mb-ext_space-collect-wrap .mb-ext_profile-search-collect-btn')) setLabel(button)
}

function syncSpaceFeedCollectButton(options = {}) {
    const limit = spaceFeedCollectLimit
    for(const wrap of document.querySelectorAll('.mb-ext_space-collect-wrap')) {
        const button = ensureCurrentInstanceClickHandler(wrap.querySelector('.mb-ext_profile-search-collect-btn'), 'space-feed-collect', event => {
            void collectMoreSpaceFeedPosts(event.currentTarget)
        })
        setMuteBlockHelp(button, `Scroll and collect up to ${limit} more posts before stopping.`)
        const select = ensureCurrentInstanceClickHandler(wrap.querySelector('.mb-ext_profile-search-collect-limit'), 'space-feed-collect-limit', event => {
            setSpaceFeedCollectLimit(Number.parseInt(event.currentTarget.value, 10))
            // Choosing a count only sets it; the collect starts from the Collect button (owner, 26 Oct).
        }, 'change')
        if(!spaceFeedCollecting && !options.keepLabel) setNukeButtonIdle(button, `Collect ${limit} More`)
        if(select) {
            if(select.value !== String(limit)) select.value = String(limit)
            select.disabled = spaceFeedCollecting
        }
    }
    syncSpaceFeedStopButtons()
}

// Every copy of the space header on the page (29 Oct). getSpaceHeaderContainer returns only the first, for the callers that need one.
function getSpaceHeaderContainers() {
    return Array.from(document.querySelectorAll('.puppeteer_test_tribe_info_header'))
}

function getSpaceHeaderContainer() {
    return document.querySelector('.puppeteer_test_tribe_info_header')
}

function getSpaceHeaderTitleRow(header = getSpaceHeaderContainer()) {
    if(!header) return null

    const title = header.querySelector('.puppeteer_test_tribe_name')
    if(!title) return null

    return title.closest('.q-flex') || title.closest('div')
}

function getSpaceHeaderTitleAnchor(header = getSpaceHeaderContainer()) {
    if(!header) return null
    return header.querySelector('.puppeteer_test_tribe_name')?.closest('span, div, a') || null
}

function getSpaceHeaderOuterRow(header = getSpaceHeaderContainer()) {
    if(!header) return null
    return header.querySelector('#mainContent')?.parentElement || null
}

function getSpaceHeaderActionControl(header = getSpaceHeaderContainer()) {
    if(!header) return null

    const controls = Array.from(header.querySelectorAll('button, [role="button"], a'))
        .filter(control => control.offsetParent !== null)

    const ranked = controls
        .map(control => {
            const label = `${control.getAttribute?.('aria-label') || ''} ${getElementText(control)}`.replace(/\s+/g, ' ').trim()
            let score = 0

            if(/\b(following|follow|requested|join|joined)\b/i.test(label)) score += 100
            if(/\bnotification|notifications\b/i.test(label)) score += 40
            if(control.querySelector?.('svg')) score += 5

            return {control, score}
        })
        .filter(entry => entry.score > 0)
        .sort((left, right) => right.score - left.score)

    return ranked[0]?.control || null
}

function getSpaceHeaderActionRow(header = getSpaceHeaderContainer()) {
    const control = getSpaceHeaderActionControl(header)
    if(!control) return null

    return control.closest('.q-flex, [class*="q-flex"], [class*="q-inlineFlex"]') || control.parentElement || null
}

function getSpaceHeaderActionInsertBefore(row) {
    if(!row) return null

    return Array.from(row.children).find(child => {
        if(child.classList?.contains('mb-ext_space-category-host')) return false
        if(child.matches?.('button, [role="button"], a')) return true
        return !!child.querySelector?.('button, [role="button"], a')
    }) || null
}

// The URL that names the space. On a space's own subdomain the page is that space, so the location is used (29 Oct). og:url and the canonical
// link can name another URL while the page is open, and a key that follows them makes the stored category read as unset. Other pages keep
// the canonical URL. normalizeSpaceUrl drops the path of a subdomain, so the location gives the same key as the canonical link does.
function getSpaceIdentityUrl() {
    const host = `${location?.hostname || ''}`.toLowerCase()
    if(host && host !== 'www.quora.com' && host.endsWith('.quora.com')) return location.href
    return getDocumentCanonicalUrl(document)
}

function resolveCurrentSpaceDescriptor() {
    const header = getSpaceHeaderContainer()

    const url = normalizeSpaceUrl(getSpaceIdentityUrl())
    if(!url) return null

    return {
        key: `quora-space:${url}`,
        url,
        slug: extractSpaceSlug(url),
        name: getSpaceName(document, header)
    }
}

function getStoredSpaceRecord(space) {
    if(!spaceRegistry || typeof spaceRegistry !== 'object') return null
    if(!space) return null

    const exactRecord = space.key ? spaceRegistry?.[space.key] || null : null
    if(exactRecord) return exactRecord

    const targetUrl = normalizeSpaceUrl(space.url || '')
    // Case-sensitive, like every identity comparison (owner, 14 Oct).
    const targetSlug = `${space.slug || extractSpaceSlug(targetUrl) || ''}`.trim()

    for(const record of Object.values(spaceRegistry)) {
        if(!record || typeof record !== 'object') continue

        const recordUrl = normalizeSpaceUrl(record.url || '')
        if(targetUrl && recordUrl && recordUrl === targetUrl) {
            return record
        }

        const recordSlug = `${record.slug || extractSpaceSlug(recordUrl) || ''}`.trim()
        if(targetSlug && recordSlug && recordSlug === targetSlug) {
            return record
        }
    }

    return null
}

function getStoredSpaceCategory(space) {
    return normalizeSpaceCategory(getStoredSpaceRecord(space)?.category)
}

// A category is pressed only when the stored record says it (29 Oct). With no stored category, nothing is pressed: Neutral is not the default.
function getSpaceCategoryForButtonState(category, activeCategory) {
    if(activeCategory) return category === activeCategory ? 'active' : 'inactive'
    return 'inactive'
}

function getSpaceCategoryHelpText(category) {
    if(category === 'asset') return "Posts here may be scanned for Nuke 'Em candidates"
    if(category === 'neutral') return 'Treat this space as neutral'
    if(category === 'target') return 'Consider this space hostile'
    return 'Set Mute Block space classification'
}

// Every copy of the space header gets its own category set (29 Oct). Quora can draw more than one copy. The sync used to reach only the
// first, so another copy kept the category it had when it was drawn, while the storage held a newer one.
function syncSpaceClassificationControls() {
    // Before the registry has loaded the copy is empty, so every category would read as the default. The draw waits for the load (29 Oct).
    if(!spaceRegistryLoaded) return false
    const space = resolveCurrentSpaceDescriptor()
    if(!space) return false

    let synced = false
    for(const header of getSpaceHeaderContainers()) {
        if(syncSpaceClassificationControlsInHeader(header, space)) synced = true
    }
    return synced
}

function syncSpaceClassificationControlsInHeader(header, space) {
    let host = header.querySelector('.mb-ext_space-category-host')
    if(!host) {
        host = document.createElement('div')
        host.className = 'mb-ext_space-category-host'
    }

    const actionRow = getSpaceHeaderActionRow(header)
    if(actionRow) {
        const insertBefore = getSpaceHeaderActionInsertBefore(actionRow)

        if(host.parentElement !== actionRow) {
            if(insertBefore) {
                actionRow.insertBefore(host, insertBefore)
            }
            else {
                actionRow.appendChild(host)
            }
        }
        else if(insertBefore && host.nextElementSibling !== insertBefore) {
            actionRow.insertBefore(host, insertBefore)
        }

        host.style.top = ''
        host.style.right = ''
    }
    else if(host.parentElement !== header) {
        header.appendChild(host)
        host.style.top = ''
        host.style.right = ''
    }

    const activeCategory = getStoredSpaceCategory(space)
    let segmented = host.querySelector('.mb-ext_space-category-segmented')
    if(!segmented) {
        segmented = document.createElement('div')
        segmented.className = 'mb-ext_space-category-segmented'
        host.appendChild(segmented)
    }

    const buttons = Array.from(segmented.querySelectorAll('.mb-ext_space-category-btn'))
    const alreadySynced = host.dataset.mbSpaceKey === space.key &&
        (host.dataset.mbSpaceCategory || '') === activeCategory &&
        buttons.length === SPACE_CATEGORIES.length &&
        SPACE_CATEGORIES.every(category => {
            const button = segmented.querySelector(`.mb-ext_space-category-btn[data-category="${category}"]`)
            if(!button) return false

            const isActive = category === activeCategory
            return button.dataset.active === (isActive ? 'true' : 'false') &&
                button.getAttribute('aria-pressed') === (isActive ? 'true' : 'false') &&
                button.textContent === getSpaceCategoryLongLabel(category)
        })

    if(alreadySynced) {
        return true
    }

    host.dataset.mbSpaceKey = space.key
    host.dataset.mbSpaceCategory = activeCategory

    for(const category of SPACE_CATEGORIES) {
        let button = segmented.querySelector(`.mb-ext_space-category-btn[data-category="${category}"]`)
        const visualState = getSpaceCategoryForButtonState(category, activeCategory)
        const isActive = visualState === 'active'

        if(!button) {
            button = document.createElement('button')
            button.type = 'button'
            button.className = 'mb-ext_space-category-btn'
            button.dataset.category = category
            button.addEventListener('click', () => {
                const currentSpace = resolveCurrentSpaceDescriptor()
                if(currentSpace) {
                    void setCurrentSpaceCategory(currentSpace, category)
                }
            })
            segmented.appendChild(button)
        }

        button.dataset.active = isActive ? 'true' : 'false'
        button.dataset.visualState = visualState
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false')
        button.textContent = getSpaceCategoryLongLabel(category)
        button.classList.toggle('mb-ext_space-category-btn--active', isActive)
        setMuteBlockHelp(button, getSpaceCategoryHelpText(category))
    }

    for(const button of Array.from(segmented.querySelectorAll('.mb-ext_space-category-btn'))) {
        if(!SPACE_CATEGORIES.includes(button.dataset.category)) {
            button.remove()
        }
    }

    return true
}

// The click's write carries the time the user acted. The worker applies it to the record it holds now, and refuses it if the record was
// updated after that time, so a write built earlier cannot put the old category back.
async function setCurrentSpaceCategory(space, category) {
    const at = Date.now()
    const built = buildSpaceRecord(space, category, spaceRegistry?.[space.key] || null)
    if(!built) return
    // The page's copy carries the action time the worker stores, so the copy and storage agree on which write is newer (29 Oct).
    const nextRecord = {...built, updatedAt: at}

    spaceRegistry = {
        ...spaceRegistry,
        [space.key]: nextRecord
    }

    syncSpaceClassificationControls()
    scheduleSpaceAssetNukeControls(0)
    const reply = await safeSendRuntimeMessage({
        action: 'set-space-record',
        key: space.key,
        change: {category, url: space.url, slug: space.slug, name: space.name},
        at
    }, null)
    applySpaceRecordReply(space.key, reply)
}

function getClosestCommonAncestor(nodes) {
    const elements = (Array.isArray(nodes) ? nodes : []).filter(node => node?.nodeType === Node.ELEMENT_NODE)
    if(!elements.length) return null
    if(elements.length === 1) return elements[0]?.parentElement || null

    const path = []
    let node = elements[0]
    while(node) {
        path.push(node)
        node = node.parentElement
    }

    return path.find(candidate => elements.every(element => candidate.contains(element))) || null
}

function isAssetSpacePage() {
    const space = resolveCurrentSpaceDescriptor()
    return getStoredSpaceCategory(space) === 'asset'
}

function isTargetSpacePage() {
    const space = resolveCurrentSpaceDescriptor()
    return getStoredSpaceCategory(space) === 'target'
}

function isNukableSpacePage() {
    return isAssetSpacePage() || isTargetSpacePage()
}

function getPostActionLabel(candidate) {
    if(!candidate) return ''
    return `${candidate.getAttribute?.('aria-label') || ''} ${getElementText(candidate)}`.replace(/\s+/g, ' ').trim()
}

function isSpaceFeedActionLabel(label) {
    return /(?:^|\s)(?:upvote|comment|share|save)(?:\s|$)/i.test(label || '')
}

function getSpaceFeedTabButtons() {
    const root = document.querySelector('#mainContent, main, [role="main"]') || document
    const tabs = Array.from(root.querySelectorAll('[role="tab"]'))
    const matched = tabs.filter(tab => /^(?:about|posts|questions)$/i.test(getElementText(tab)) || /^(?:about|main|questions)$/i.test(tab.id || ''))

    matched.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()
        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return matched
}

function getSpaceFeedTabRow() {
    const explicitRow = document.querySelector('#mainContent .q-box.qu-overflowX--hidden.qu-whiteSpace--nowrap')
    if(explicitRow) return explicitRow

    const tabs = getSpaceFeedTabButtons()
    if(tabs.length < 2) return null

    return tabs[0].closest('[role="tablist"]') || getClosestCommonAncestor(tabs) || null
}

function getSpaceFeedBar() {
    const row = getSpaceFeedTabRow()
    if(!row) return null

    const bar = row.closest('.q-box.qu-mb--small.qu-borderBottom.qu-borderColor--darken') || row
    bar.classList.add('mb-ext_space-feed-tab-bar')
    return bar
}

function getSpaceFeedToolbar() {
    const bar = getSpaceFeedBar()
    if(!bar) return null

    let toolbar = bar.querySelector(':scope > .mb-ext_space-feed-toolbar')
    if(toolbar) return toolbar

    toolbar = document.createElement('div')
    toolbar.className = 'mb-ext_space-feed-toolbar'
    bar.appendChild(toolbar)
    return toolbar
}

function getSpaceFeedTopButtonHost() {
    const toolbar = getSpaceFeedToolbar()
    if(!toolbar) return null

    let host = toolbar.querySelector(':scope > .mb-ext_space-feed-nuke-host')
    if(host) return host

    host = document.createElement('div')
    host.className = 'mb-ext_space-feed-nuke-host'
    const statusHost = toolbar.querySelector(':scope > .mb-ext_space-feed-status-host')
    if(statusHost?.nextSibling) toolbar.insertBefore(host, statusHost.nextSibling)
    else toolbar.appendChild(host)
    return host
}

function getSpaceFeedStatusHost() {
    const toolbar = getSpaceFeedToolbar()
    if(!toolbar) return null

    let host = toolbar.querySelector(':scope > .mb-ext_space-feed-status-host')
    if(host) return host

    host = document.createElement('div')
    host.className = 'mb-ext_space-feed-status-host'
    const nukeHost = toolbar.querySelector(':scope > .mb-ext_space-feed-nuke-host')
    if(nukeHost) toolbar.insertBefore(host, nukeHost)
    else toolbar.appendChild(host)
    return host
}

function syncSpaceFeedTopBarLayout() {
    const bar = getSpaceFeedBar()
    if(!bar) return false

    const nukeHost = bar.querySelector('.mb-ext_space-feed-nuke-host')
    const statusHost = bar.querySelector('.mb-ext_space-feed-status-host')
    if(!nukeHost || !statusHost) return false

    statusHost.style.right = ''
    nukeHost.style.right = ''
    bar.style.paddingRight = ''
    return true
}

// 24 Oct: the feed's content root is worked out at most once per SPACE_FEED_CONTENT_ROOT_MEMO_MS. Working it out counts the posts in every
// candidate, and it was asked for on almost every scan and redraw.
let spaceFeedContentRootMemo = {root: null, at: 0}

function getSpaceFeedContentRoot() {
    const memo = spaceFeedContentRootMemo
    if(memo.root?.isConnected && Date.now() - memo.at < SPACE_FEED_CONTENT_ROOT_MEMO_MS) return memo.root

    const root = computeSpaceFeedContentRoot()
    spaceFeedContentRootMemo = {root, at: Date.now()}
    return root
}

function computeSpaceFeedContentRoot() {
    const candidates = Array.from(document.querySelectorAll('#mainContent, main, [role="main"]'))
        .filter(candidate => candidate instanceof Element)
    if(!candidates.length) return document.body

    return candidates
        .map((candidate, index) => ({
            candidate,
            index,
            timestampCount: candidate.querySelectorAll?.('a.post_timestamp, a.answer_timestamp').length || 0
        }))
        .sort((left, right) => right.timestampCount - left.timestampCount || left.index - right.index)[0]
        .candidate || document.body
}

function getSpaceFeedTimestampScanDistance(timestamp, precomputedRect = null) {
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
    const rect = precomputedRect || timestamp?.getBoundingClientRect?.() || null
    if(!rect) return Number.POSITIVE_INFINITY
    if(rect.bottom >= 0 && rect.top <= viewportHeight) return 0
    if(rect.top > viewportHeight) return rect.top - viewportHeight
    return Math.abs(rect.bottom)
}

function isSpaceFeedTimestampInScanWindow(timestamp, precomputedRect = null) {
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
    const rect = precomputedRect || timestamp?.getBoundingClientRect?.() || null
    if(!rect) return false

    return rect.bottom >= -SPACE_FEED_SCAN_ABOVE_VIEWPORT_MARGIN_PX &&
        rect.top <= viewportHeight + SPACE_FEED_SCAN_VIEWPORT_MARGIN_PX
}

function compareElementsByDocumentOrder(left, right) {
    if(left === right) return 0

    const position = left.compareDocumentPosition(right)
    if(position & Node.DOCUMENT_POSITION_PRECEDING) return 1
    if(position & Node.DOCUMENT_POSITION_FOLLOWING) return -1
    return 0
}

function addSpaceFeedTimestampCandidate(timestamps, seen, candidate) {
    if(!(candidate instanceof Element)) return false
    if(!candidate.matches('a.post_timestamp, a.answer_timestamp')) return false
    if(seen.has(candidate)) return false
    if(!isSpaceFeedTimestampInScanWindow(candidate)) return false

    seen.add(candidate)
    timestamps.push(candidate)
    return true
}

function collectSampledSpaceFeedTimestampsFromElement(element, timestamps, seen, contentRoot) {
    if(!(element instanceof Element) || !contentRoot?.contains(element)) return

    addSpaceFeedTimestampCandidate(timestamps, seen, element)

    const visitedRoots = new Set()
    let current = element

    while(current &&
        current !== contentRoot &&
        current !== document.body &&
        current !== document.documentElement &&
        timestamps.length < SPACE_FEED_SCAN_MAX_TIMESTAMPS) {
        const root = current.matches?.(SPACE_FEED_ROOT_SELECTOR)
            ? current
            : current.closest?.(SPACE_FEED_ROOT_SELECTOR)
        if(!root || visitedRoots.has(root) || !contentRoot.contains(root)) break

        visitedRoots.add(root)
        const timestamp = root.matches?.('a.post_timestamp, a.answer_timestamp')
            ? root
            : root.querySelector?.('a.post_timestamp, a.answer_timestamp')
        addSpaceFeedTimestampCandidate(timestamps, seen, timestamp)
        current = root.parentElement
    }
}

function getViewportSampledSpaceFeedTimestamps() {
    const contentRoot = getSpaceFeedContentRoot()
    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
    if(!contentRoot || viewportWidth <= 0 || viewportHeight <= 0 || !document.elementsFromPoint) return []

    const timestamps = []
    const seen = new Set()
    const xs = SPACE_FEED_SCAN_SAMPLE_X_RATIOS
        .map(ratio => Math.max(1, Math.min(viewportWidth - 2, Math.round(viewportWidth * ratio))))
    const ys = []
    const addY = y => {
        const bounded = Math.max(1, Math.min(viewportHeight - 2, Math.round(y)))
        if(!ys.includes(bounded)) ys.push(bounded)
    }

    addY(16)
    for(let y = SPACE_FEED_SCAN_SAMPLE_STEP_PX; y < viewportHeight; y += SPACE_FEED_SCAN_SAMPLE_STEP_PX) {
        addY(y)
    }
    addY(viewportHeight - 16)

    for(const y of ys) {
        for(const x of xs) {
            for(const element of document.elementsFromPoint(x, y)) {
                collectSampledSpaceFeedTimestampsFromElement(element, timestamps, seen, contentRoot)
                if(timestamps.length >= SPACE_FEED_SCAN_MAX_TIMESTAMPS) break
            }
            if(timestamps.length >= SPACE_FEED_SCAN_MAX_TIMESTAMPS) break
        }
        if(timestamps.length >= SPACE_FEED_SCAN_MAX_TIMESTAMPS) break
    }

    return timestamps.sort(compareElementsByDocumentOrder)
}

function getBoundedVisibleSpaceFeedTimestamps() {
    // Scoped to the feed's own content root (falls back to document.body
    // when unresolved, same as an unscoped query) rather than the whole
    // document, and each node's bounding rect is measured once and reused
    // for both the window check and the distance calculation below --
    // measuring twice per node here was forcing a redundant layout reflow
    // for every post ever loaded into this (non-virtualized) feed on every
    // scan.
    // Owner, 24 Oct: only the posts near the viewport are measured. Measuring every timestamp on each sync forced a layout read per post.
    // Until the near-post observer has reported any post, the whole feed is measured once.
    const scanRoot = getSpaceFeedContentRoot() || document
    // 24 Oct: every post is measured. The near-post observer had posts on screen that it still reported as far away, so those posts were never
    // scanned. The position test below (isSpaceFeedTimestampInScanWindow) is what decides, and it is the same test the button check uses.
    const nodes = timedSpaceQuery('allTimestamps', () => Array.from(scanRoot.querySelectorAll('a.post_timestamp, a.answer_timestamp')))
    const timestamps = nodes
        .map((timestamp, index) => {
            const rect = timestamp?.getBoundingClientRect?.() || null
            return {
                timestamp,
                index,
                rect,
                distance: getSpaceFeedTimestampScanDistance(timestamp, rect)
            }
        })
        .filter(entry => isSpaceFeedTimestampInScanWindow(entry.timestamp, entry.rect))

    if(timestamps.length <= SPACE_FEED_SCAN_MAX_TIMESTAMPS) {
        return timestamps.map(entry => entry.timestamp)
    }

    return timestamps
        .sort((left, right) => left.distance - right.distance || left.index - right.index)
        .slice(0, SPACE_FEED_SCAN_MAX_TIMESTAMPS)
        .sort((left, right) => left.index - right.index)
        .map(entry => entry.timestamp)
}

function mergeSpaceFeedTimestampScanResults(...groups) {
    const seen = new Set()
    const timestamps = []

    for(const group of groups) {
        for(const timestamp of Array.isArray(group) ? group : []) {
            if(!(timestamp instanceof Element)) continue
            if(seen.has(timestamp)) continue
            if(!isSpaceFeedTimestampInScanWindow(timestamp)) continue

            seen.add(timestamp)
            timestamps.push({
                timestamp,
                index: timestamps.length,
                distance: getSpaceFeedTimestampScanDistance(timestamp)
            })
        }
    }

    if(timestamps.length <= SPACE_FEED_SCAN_MAX_TIMESTAMPS) {
        return timestamps
            .map(entry => entry.timestamp)
            .sort(compareElementsByDocumentOrder)
    }

    return timestamps
        .sort((left, right) => left.distance - right.distance || left.index - right.index)
        .slice(0, SPACE_FEED_SCAN_MAX_TIMESTAMPS)
        .map(entry => entry.timestamp)
        .sort(compareElementsByDocumentOrder)
}

function getVisibleSpaceFeedTimestamps() {
    // Owner, 24 Oct: hit-testing the viewport on every sync was the largest cost while scrolling. Once the near-post observer has reported
    // posts, those posts are used instead, and the sampling runs only before the observer has reported any.
    const sampledTimestamps = getSpaceFeedNearObserver() ? [] : getViewportSampledSpaceFeedTimestamps()
    const boundedTimestamps = getBoundedVisibleSpaceFeedTimestamps()
    const timestamps = mergeSpaceFeedTimestampScanResults(sampledTimestamps, boundedTimestamps)
    if(timestamps.length) return timestamps
    if(hasActivePendingSpaceFeedWork()) return boundedTimestamps

    return []
}

// 24 Oct: 'candidate' when the node holds exactly this post's timestamp; 'crowded' when it holds more than one. No ancestor of a crowded node
// can be a candidate, so the walk up from a post stops there.
function getSpaceFeedRootCandidateState(node, timestamp) {
    if(!node || node.nodeType !== Node.ELEMENT_NODE) return ''

    const timestamps = timedSpaceQuery('nodeTimestamps', () => Array.from(node.querySelectorAll('a.post_timestamp, a.answer_timestamp')))
    if(timestamps.length > 1) return 'crowded'
    return timestamps.length === 1 && timestamps[0] === timestamp ? 'candidate' : ''
}

function isSpaceFeedRootCandidate(node, timestamp) {
    return getSpaceFeedRootCandidateState(node, timestamp) === 'candidate'
}

// The posts the page has marked with their key. Kept here so a redraw does not search the whole page for them.
const spaceFeedMarkedRoots = new Set()

function getSpaceFeedMarkedRoots() {
    for(const root of Array.from(spaceFeedMarkedRoots)) {
        if(!root.isConnected) spaceFeedMarkedRoots.delete(root)
    }
    return Array.from(spaceFeedMarkedRoots)
}

// The post buttons the page has drawn. Every host is made in getSpaceFeedPostButtonHost; a host Quora or the page removes drops out on read.
const spaceFeedPostHostSet = new Set()

// Page order, as a document query would give them.
function getSpaceFeedPostHostsInDocument() {
    for(const host of Array.from(spaceFeedPostHostSet)) {
        if(!host.isConnected) spaceFeedPostHostSet.delete(host)
    }
    return Array.from(spaceFeedPostHostSet)
        .sort((left, right) => (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1)
}

function getSpaceFeedQueueingButtons() {
    const buttons = []
    for(const host of getSpaceFeedPostHostsInDocument()) {
        buttons.push(...host.querySelectorAll('[data-mb-queueing="true"]'))
    }
    buttons.push(...timedSpaceQuery('queueingTopButton', () => Array.from(document.querySelectorAll('.mb-ext_space-feed-nuke-btn[data-mb-queueing="true"]'))))
    return buttons
}

function getSpaceFeedPreferredRoot(timestamp) {
    if(!timestamp) return null

    return timestamp.closest(SPACE_FEED_ROOT_SELECTOR)
}

function getSpaceFeedCardRoots() {
    const root = getSpaceFeedContentRoot()
    if(!root) return []

    const roots = []
    const seen = new Set()

    for(const timestamp of getVisibleSpaceFeedTimestamps()) {
        const matched = getSpaceFeedCardRootForTimestamp(timestamp, root)

        if(matched && !seen.has(matched)) {
            seen.add(matched)
            roots.push(matched)
        }
    }

    return roots
}

function getSpaceFeedCardRootForTimestamp(timestamp, root = getSpaceFeedContentRoot()) {
    if(!timestamp || !root) return null

    const preferredRoot = getSpaceFeedPreferredRoot(timestamp)
    const cached = spaceFeedRootCache.get(timestamp)
    if(cached?.isConnected &&
        cached.contains(timestamp) &&
        root.contains(cached) &&
        (cached === preferredRoot || isSpaceFeedRootCandidate(cached, timestamp))) {
        return cached
    }

    let matched = preferredRoot
    let node = timestamp.parentElement

    while(node && node !== root) {
        const state = getSpaceFeedRootCandidateState(node, timestamp)
        if(state === 'crowded') break
        if(state === 'candidate') {
            matched = node
        }

        node = node.parentElement
    }

    if(!matched) {
        const directCard = timestamp.closest('.q-click-wrapper, article, [role="article"], .q-box')
        if(isSpaceFeedRootCandidate(directCard, timestamp)) {
            matched = directCard
        }
    }

    if(matched) {
        spaceFeedRootCache.set(timestamp, matched)
    }

    return matched
}

function getSpaceFeedPostRoot(timestamp) {
    if(!timestamp) return null

    return getSpaceFeedCardRootForTimestamp(timestamp) || null
}

function getSpaceFeedPostUrl(timestamp) {
    return normalizeQuoraPostHref(timestamp?.href || '')
}

function getSpaceFeedPostKey(postRoot, timestamp) {
    const postUrl = getSpaceFeedPostUrl(timestamp)
    if(postUrl) return `space-post:${postUrl}`

    const snippet = getElementText(postRoot).replace(/\s+/g, ' ').trim().slice(0, 120)
    if(!snippet) return ''

    // Exact text, not lower-cased (owner, 14 Oct): two posts whose text differs only in case are different posts.
    return `space-post-text:${snippet}`
}

// Owner, 23 Oct: the card check reads layout and text for every profile link on the page, and the scan runs on every render. Its result is
// kept per link element and reused while the link's href is the same, so a render only does this work for links it has not seen.
const spaceFeedProfileLinkRootCache = new WeakMap()

function getSpaceFeedProfileLinkCardRoot(link) {
    if(!(link instanceof Element)) return null

    const href = link.href || ''
    const cached = spaceFeedProfileLinkRootCache.get(link)
    if(cached && cached.href === href) return cached.root

    const root = computeSpaceFeedProfileLinkCardRoot(link)
    spaceFeedProfileLinkRootCache.set(link, {href, root})
    return root
}

function computeSpaceFeedProfileLinkCardRoot(link) {
    if(!(link instanceof Element) || !isVisible(link)) return null

    const root = link.closest('a[href*="/profile/"]')
    if(!(root instanceof HTMLAnchorElement) || !isVisible(root)) return null
    if(isExtensionOwnedNode(root)) return null
    // 2026-10-08 (Franklin Veaux incident): this scanner looks for Quora's
    // own standalone "profile card" widget, but that widget shares its
    // q-box/puppeteer_test_link markup with the author byline Quora renders
    // for an embedded/quoted sub-post (a feature card, a Quora-native embed,
    // or a hyperlink embed) -- the exact class of false positive the
    // SPACE_FEED_EMBED_SCOPE_SELECTOR exclusion was already added for in
    // getSpaceFeedPosterProfileUrls (2026-09-27) and the asset/target split
    // in getSpaceFeedPostCandidateProfileUrls (2026-09-25), neither of which
    // this separate scanner goes through. A genuine contributor's answer to
    // an unrelated question got embedded/quoted in a troll-patrol post, his
    // byline rendered as this same card shape, and he was queued for
    // mute-block with no further scrutiny as a result.
    if(root.closest(SPACE_FEED_EMBED_SCOPE_SELECTOR)) return null
    if(timedSpaceQuery('linkCardTimestamp', () => root.querySelector('a.post_timestamp, a.answer_timestamp, .post_timestamp'))) return null
    if(root.closest('.mb-ext_space-feed-post-nuke-host')) return null
    if(!root.classList.contains('q-box') && !root.classList.contains('puppeteer_test_link')) return null

    const href = normalizeQuoraProfileHref(root.href)
    if(!href) return null

    const text = getElementText(root)
    if(!/\/profile\//i.test(text) && !text.includes(href.split('/').pop() || '')) return null

    return root
}

// The profile-link card scan is reused for a short time while the page's structure does not change (see invalidateSpaceFeedEntryCacheForMutations).
let spaceFeedProfileLinkCardCache = null
// Owner, 24 Oct: the profile links of the feed are kept as a set. The whole feed is searched at most every SPACE_FEED_PROFILE_LINK_FULL_SCAN_MS;
// between searches, links the page adds are put in the set as they arrive (see noteSpaceFeedProfileLinkMutations), and removed ones are
// dropped when the set is read. A search runs at once for a new content root.
const spaceFeedProfileLinkSet = new Set()
let spaceFeedProfileLinkSetRoot = null
let spaceFeedProfileLinkSetScannedAt = 0
let spaceFeedProfileLinkSetDirty = true
let spaceFeedProfileLinkOrder = []

function noteSpaceFeedProfileLinkMutations(mutations = []) {
    for(const mutation of mutations || []) {
        for(const node of Array.from(mutation.addedNodes || [])) {
            if(!(node instanceof Element)) continue
            if(node.matches?.('a[href*="/profile/"]')) spaceFeedProfileLinkSet.add(node)
            for(const link of timedSpaceQuery('linkMutationScan', () => Array.from(node.querySelectorAll?.('a[href*="/profile/"]') || []))) spaceFeedProfileLinkSet.add(link)
            spaceFeedProfileLinkSetDirty = true
        }
        if(mutation.removedNodes?.length) spaceFeedProfileLinkSetDirty = true
    }
}

function getSpaceFeedProfileLinksInDomOrder(contentRoot) {
    const due = spaceFeedProfileLinkSetRoot !== contentRoot ||
        Date.now() - spaceFeedProfileLinkSetScannedAt >= SPACE_FEED_PROFILE_LINK_FULL_SCAN_MS
    if(due) {
        spaceFeedProfileLinkSet.clear()
        for(const link of timedSpaceQuery('linkFullScan', () => Array.from(contentRoot.querySelectorAll('a[href*="/profile/"]')))) spaceFeedProfileLinkSet.add(link)
        spaceFeedProfileLinkSetRoot = contentRoot
        spaceFeedProfileLinkSetScannedAt = Date.now()
        spaceFeedProfileLinkSetDirty = true
    }

    for(const link of Array.from(spaceFeedProfileLinkSet)) {
        if(!link.isConnected || !contentRoot.contains(link)) {
            spaceFeedProfileLinkSet.delete(link)
            spaceFeedProfileLinkSetDirty = true
        }
    }

    if(spaceFeedProfileLinkSetDirty) {
        spaceFeedProfileLinkOrder = Array.from(spaceFeedProfileLinkSet)
            .sort((left, right) => (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1)
        spaceFeedProfileLinkSetDirty = false
    }
    return spaceFeedProfileLinkOrder
}

function getSpaceFeedProfileLinkCardEntries(activeKeys = new Set()) {
    const cached = spaceFeedProfileLinkCardCache
    if(cached && Date.now() - cached.at < SPACE_FEED_PROFILE_LINK_CARD_CACHE_MS) {
        for(const key of cached.keys) activeKeys.add(key)
        return cached.entries
    }

    const keys = new Set()
    const entries = computeSpaceFeedProfileLinkCardEntries(keys)
    for(const key of keys) activeKeys.add(key)
    spaceFeedProfileLinkCardCache = {at: Date.now(), keys: [...keys], entries}
    return entries
}

// A name followed by "upvoted this" is an upvoter in a post's action bar. The check reads the nearest container whose text
// says "upvoted this", and asks whether this name is the one before it. Upvoters are never targets (Oct 31).
function isSpaceFeedUpvoterLink(link) {
    const name = `${link?.textContent || ''}`.replace(/\s+/g, ' ').trim()
    if(!name) return false
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const upvoted = new RegExp(`${escaped}\\s*upvoted this`, 'i')
    let node = link.parentElement || null
    for(let depth = 0; node && node !== document.body && depth < 12; depth += 1) {
        const text = `${node.innerText || node.textContent || ''}`.replace(/\s+/g, ' ')
        if(/upvoted this/i.test(text)) return upvoted.test(text)
        node = node.parentElement
    }
    return false
}

// Why a profile-link card is a candidate, for the MB Info trace (Oct 31). It reports only; it does not decide whether the card is kept.
// "Following" is read from the byline here for diagnosis only, not used to exclude.
function describeSpaceFeedProfileLinkCard(link, href) {
    const linkText = `${link?.textContent || ''}`.replace(/\s+/g, ' ').trim()
    const handle = `${href || ''}`.split('/').pop() || ''
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const followingPattern = new RegExp(`${escaped}\\s*\\u00b7?\\s*Following\\b`, 'i')
    let byline = 'no byline with the name'
    let node = link?.parentElement || null
    // Keeps climbing after a container with the name but no "Following": a name link's own parent often holds only the name.
    for(let depth = 0; node && node !== document.body && depth < 10; depth += 1) {
        const text = `${node.textContent || ''}`.replace(/\s+/g, ' ').slice(0, 400)
        if(handle && followingPattern.test(text)) {
            byline = 'byline shows Following'
            break
        }
        if(handle && text.includes(handle)) byline = 'byline shows no Following'
        node = node.parentElement
    }
    const upvoterRule = linkText ? 'no "upvoted this" match' : 'cannot match, link has no name'
    return `${linkText ? 'name link' : 'avatar link (no text)'}; upvoter rule: ${upvoterRule}; ${byline}`
}

// The post a profile link sits in as the post scanner sees it: the nearest ancestor holding a post timestamp, and that timestamp. Null when none encloses the link.
function getSpaceFeedProfileLinkSourcePost(link) {
    let node = link instanceof Element ? link.parentElement : null
    while(node && node !== document.body) {
        const timestamp = node.querySelector?.('a.post_timestamp, a.answer_timestamp')
        if(timestamp) return {postRoot: node, timestamp}
        node = node.parentElement
    }
    return null
}

// The post a profile link sits in: the nearest ancestor that holds a post's own timestamp link. Empty when none encloses the link.
// A profile link names the profile, so this is the only record of which posting identified it (Oct 31).
function getSpaceFeedProfileLinkSourcePostUrl(link) {
    let node = link instanceof Element ? link.parentElement : null
    while(node && node !== document.body) {
        const timestamp = node.querySelector?.('a.post_timestamp, a.answer_timestamp')
        if(timestamp) return normalizeQuoraPostHref(timestamp.href || '') || ''
        node = node.parentElement
    }
    return ''
}

function computeSpaceFeedProfileLinkCardEntries(activeKeys = new Set()) {
    if(!isAssetSpacePage()) return []

    const contentRoot = getSpaceFeedContentRoot()
    if(!contentRoot) return []

    const entries = []
    const seenRoots = new Set()
    const seenHrefs = new Set()

    for(const link of getSpaceFeedProfileLinksInDomOrder(contentRoot)) {
        const root = getSpaceFeedProfileLinkCardRoot(link)
        if(!root || seenRoots.has(root)) continue
        // An upvoter's name in a post's action bar is not a target (Oct 31: a name followed by "upvoted this" was taken as one).
        if(isSpaceFeedUpvoterLink(root)) continue

        const href = normalizeQuoraProfileHref(root.href)
        if(!href || seenHrefs.has(href)) continue
        // 31 Oct: on an asset space the author of a post is never a candidate. The post scanner (getSpaceFeedPostCandidateProfileUrls) already
        // drops the header author; this scanner must drop the same profile when it is the byline of the post the link sits in.
        const sourcePost = getSpaceFeedProfileLinkSourcePost(root)
        const authorHref = sourcePost ? normalizeQuoraProfileHref(getSpaceFeedPostHeaderProfileHref(sourcePost.postRoot, sourcePost.timestamp)) : null
        noteSpaceFeedPosterProfile(authorHref)
        if(authorHref && authorHref === href) continue

        const postKey = `space-profile-link:${href}`
        seenRoots.add(root)
        seenHrefs.add(href)
        activeKeys.add(postKey)
        const cardReason = describeSpaceFeedProfileLinkCard(root, href)
        entries.push({
            postKey,
            postRoot: root,
            postUrl: href,
            candidateUrls: [href],
            sourcePostUrl: getSpaceFeedProfileLinkSourcePostUrl(root),
            cardReason
        })
    }

    return entries
}

function getSpaceFeedPostHeaderProfileHref(postRoot, timestamp) {
    if(!postRoot) return null

    const timestampNode = timestamp || timedSpaceQuery('headerTimestamp', () => postRoot.querySelector('a.post_timestamp, a.answer_timestamp'))
    const profileLinks = timedSpaceQuery('headerProfileLinks', () => getQuoraProfileLinks(postRoot)).filter(isVisible)

    let headerProfileHref = null

    for(const link of profileLinks) {
        const href = normalizeQuoraProfileHref(link.href)
        if(!href) continue
        rememberProfileDisplayName(href, getElementText(link))

        if(timestampNode && (link.compareDocumentPosition(timestampNode) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            headerProfileHref = href
        }
    }

    return headerProfileHref || normalizeQuoraProfileHref(profileLinks[0]?.href) || null
}

function getSpaceFeedPosterProfileUrls(postRoot, timestamp) {
    if(!postRoot) return []

    const urls = []
    const seen = new Set()
    const timestamps = []
    const posterScopeSelector =
        `${SPACE_FEED_EMBED_SCOPE_SELECTOR},` +
        '.puppeteer_test_tribe_post_item_feed_story,' +
        '.dom_annotate_multifeed_bundle_TribeContentBundle,' +
        'article,' +
        '[role="article"],' +
        '.q-box'
    const addPosterHref = href => {
        const normalizedHref = normalizeQuoraProfileHref(href)
        if(!normalizedHref || seen.has(normalizedHref)) return

        seen.add(normalizedHref)
        urls.push(normalizedHref)
    }
    const addPosterScope = (scope, scopes) => {
        if(!(scope instanceof Element) || !postRoot.contains(scope) || scopes.includes(scope)) return
        scopes.push(scope)
    }
    const addTimestamp = candidate => {
        if(candidate instanceof Element && candidate.matches('a.post_timestamp, a.answer_timestamp') && !timestamps.includes(candidate)) {
            timestamps.push(candidate)
        }
    }

    addTimestamp(timestamp)

    // 2026-09-27: postRoot.querySelectorAll finds every timestamp nested
    // inside postRoot, including ones belonging to an embedded/quoted
    // sub-post (a feature card, Quora-native embed, or hyperlink embed).
    // Each one used to resolve to that sub-post's own author as a "poster"
    // -- exactly the failure mode the isTargetSpacePage()/asset-space split
    // above was added for (see that comment), except this loop still hit
    // it independently of which branch calls it, because it runs before
    // either branch sees the result. Skipping embedded timestamps here
    // fixes it at the source for both branches instead of re-patching each
    // caller.
    for(const candidate of timedSpaceQuery('postTimestamps', () => Array.from(postRoot.querySelectorAll('a.post_timestamp, a.answer_timestamp')))) {
        const embedAncestor = candidate.closest(SPACE_FEED_EMBED_SCOPE_SELECTOR)
        if(embedAncestor instanceof Element && embedAncestor !== postRoot && postRoot.contains(embedAncestor)) continue

        addTimestamp(candidate)
    }

    for(const currentTimestamp of timestamps) {
        const scopes = []
        let scope = currentTimestamp.closest(posterScopeSelector) || currentTimestamp.parentElement

        while(scope && scope !== postRoot) {
            addPosterScope(scope, scopes)
            scope = scope.parentElement
        }

        addPosterScope(postRoot, scopes)

        for(const candidateScope of scopes) {
            if(!hasVisibleFollowProxy(candidateScope)) continue
            addPosterHref(getSpaceFeedPostHeaderProfileHref(candidateScope, currentTimestamp))
        }
    }

    if(!urls.length && hasVisibleFollowProxy(postRoot)) {
        const profileLinks = getQuoraProfileLinks(postRoot).filter(isVisible)

        for(const currentTimestamp of timestamps) {
            for(const link of profileLinks) {
                const href = normalizeQuoraProfileHref(link.href)
                if(!href) continue

                rememberProfileDisplayName(href, getElementText(link))
                if(currentTimestamp && !(link.compareDocumentPosition(currentTimestamp) & Node.DOCUMENT_POSITION_FOLLOWING)) continue

                addPosterHref(href)
            }
        }
    }

    return urls
}

function getSpaceFeedPostContentScopes(postRoot) {
    if(!postRoot) return []

    const scopes = []
    const addScope = scope => {
        if(!scope || scopes.includes(scope)) return
        // Owner, 23 Oct: embedded and quoted content is read like the rest of the post. A followed author is caught when the block is
        // attempted (block-attempt-on-following), so it is not excluded here.
        scopes.push(scope)
    }

    for(const scope of Array.from(postRoot.querySelectorAll(
        '.standalone_featurable,' +
        '[data-is-quora-embed="true"],' +
        '[data-type="hyperlink_embed"],' +
        '.qu-userSelect--text,' +
        '.doc,' +
        '.qtext_para'
    ))) {
        addScope(scope)
    }

    if(!scopes.length) {
        addScope(postRoot)
    }

    return scopes
}

function isSpaceFeedCandidateProfileLink(link, postRoot) {
    if(!link || !postRoot || !isVisible(link)) return false
    if(!normalizeQuoraProfileHref(link.href)) return false

    if(link.closest(
        '.mb-ext_space-feed-post-nuke-host,' +
        '.comment_and_ad_container,' +
        '[role="button"],' +
        'button'
    )) {
        return false
    }

    // Owner, 23 Oct: a profile link's own text is its URL, and a URL can carry words such as "share=" in its query. The action words are
    // tested without URLs, so a profile link is not mistaken for a share or comment button.
    const actionLabel = getPostActionLabel(link).replace(/https?:\/\/\S+/gi, ' ')
    if(/\b(comment|share|upvote|downvote|more)\b/i.test(actionLabel)) {
        return false
    }

    return postRoot.contains(link)
}

function getSpaceFeedPostCandidateProfileUrls(postRoot, timestamp) {
    if(!postRoot) return []
    rememberVisibleProfileDisplayNames(postRoot)

    const headerProfileHref = getSpaceFeedPostHeaderProfileHref(postRoot, timestamp)
    const posterProfileUrls = getSpaceFeedPosterProfileUrls(postRoot, timestamp)
    noteSpaceFeedPosterProfile(headerProfileHref)
    if(isTargetSpacePage()) {
        return posterProfileUrls.length
            ? posterProfileUrls
            : getNormalizedProfileHrefList([headerProfileHref])
    }
    // 2026-09-25: asset-space pages used to also treat any *other* poster
    // surfaced via an embedded/quoted sub-post (getSpaceFeedEmbeddedPosterProfileUrls,
    // removed) as a high-confidence candidate, the same tier as a genuine
    // scam-target link found in a post's own content. That conflated two
    // different things: "this person authored/posted content" (true of the
    // primary header author too, which this function already excludes) and
    // "this profile is being called out within someone else's post" -- a
    // real incident (Franklin Veaux, a genuine contributor whose post got
    // embedded/quoted for an unrelated reason) got queued for mute-block
    // because of this. isTargetSpacePage() above is the deliberate
    // exception: on that page type, "poster" and "target" genuinely are the
    // same thing by the space's own design, which is why that branch still
    // returns posterProfileUrls directly. Asset pages don't have that
    // property, so a poster there -- however discovered -- is not a
    // candidate.

    const urls = []
    const seen = new Set()
    const candidateEvidenceByHref = {}
    let needsSourceResolution = false
    const addUrl = (href, evidence = null) => {
        if(!href || href === headerProfileHref || seen.has(href)) return

        seen.add(href)
        urls.push(href)
        if(evidence) {
            candidateEvidenceByHref[href] = evidence
        }
    }

    for(const scope of getSpaceFeedPostContentScopes(postRoot)) {
        for(const link of getQuoraProfileLinks(scope)) {
            if(!isSpaceFeedCandidateProfileLink(link, postRoot)) continue

            const href = normalizeQuoraProfileHref(link.href)
            if(!href) continue
            addUrl(href, makeSpaceFeedCandidateEvidence('dom-profile-link', SPACE_FEED_CANDIDATE_CONFIDENCE_HIGH))
        }
    }

    const fallbackUrls = [
        ...getSpaceFeedPostContentScopes(postRoot).flatMap(scope => getProfileUrlsFromText(getElementText(scope)))
    ]

    for(const href of fallbackUrls) {
        addUrl(href, makeSpaceFeedCandidateEvidence('text-profile-url', SPACE_FEED_CANDIDATE_CONFIDENCE_MEDIUM))
    }

    if(!urls.length && isAssetSpacePage()) {
        for(const candidate of getProfileUrlCandidatesFromSpacePostHref(timestamp?.href || '')) {
            if(candidate.confidence === SPACE_FEED_CANDIDATE_CONFIDENCE_LOW) {
                needsSourceResolution = true
                continue
            }

            addUrl(candidate.href, makeSpaceFeedCandidateEvidence(
                candidate.collector,
                candidate.confidence,
                {
                    source: candidate.source,
                    rawSlug: candidate.rawSlug
                }
            ))
        }
    }

    // A post with no profile link is not matched to a profile by a name in its title (review 4, R4-2). A name match queued and
    // nuked profiles that only contained the name, so the page resolver reads the profile from the post instead.
    return attachSpaceFeedCandidateMetadata(urls, candidateEvidenceByHref, needsSourceResolution)
}


// Owner, 23 Oct: a profile is counted only once the worker has answered for it. A profile found nuked is kept in a set for the life of
// the page, so it is not asked about again and does not drop out when the worker's reply is replaced.
const spaceFeedKnownNukedProfileKeys = new Set()
const spaceFeedAnsweredProfileKeys = new Set()
// Diagnostic, 23 Oct: the last progress refresh from the worker, shown in the MB Info report.
const spaceFeedStateRefreshStatus = {outcome: 'none', finishedAt: 0, requested: 0, records: 0, retriesWaiting: 0}

function getSpaceFeedProfileStateKey(href) {
    const normalized = normalizeQuoraProfileHref(href)
    if(!normalized) return ''

    return getNormalizedProfileIdentityKey(normalized) || normalized
}

function isKnownNukedSpaceFeedProfile(href) {
    const key = getSpaceFeedProfileStateKey(href)
    if(!key) return false
    if(spaceFeedKnownNukedProfileKeys.has(key)) return true
    if(!isProfileNukeSucceeded(href)) return false

    spaceFeedKnownNukedProfileKeys.add(key)
    return true
}

function isSpaceFeedProfileStateReady(href) {
    const key = getSpaceFeedProfileStateKey(href)
    return !!key && spaceFeedAnsweredProfileKeys.has(key)
}

// Owner, 22 Oct: nuked is a fact about the profile, not the post. A post is nuked when each of its profiles is settled. A post with no
// profile link in view has no profile to judge, so it is not nuked (25 Oct: the post-level nuked record was removed).
function isSpaceFeedPostNuked(candidateUrls = null) {
    const urls = getNormalizedProfileHrefList(candidateUrls || [])
    return urls.length > 0 && urls.every(url => isKnownNukedSpaceFeedProfile(url))
}


function isSpaceFeedEntryNuked(entry) {
    return isSpaceFeedPostNuked(entry?.candidateUrls || [])
}


function isSpaceFeedPostNuking(postKey) {
    return !!(postKey && spaceFeedNukingPostKeys.has(postKey))
}

function isSpaceFeedPostPending(postKey) {
    if(hasPendingCoordinatorSpaceFeedPost(postKey)) return true
    return getActivePendingSpaceFeedUrls(postKey).length > 0
}


function isSpaceFeedPostBusy(postKey) {
    return isSpaceFeedPostNuking(postKey) || isSpaceFeedPostPending(postKey)
}

function hasActivePendingSpaceFeedWork(entries = null) {
    const postKeys = Array.isArray(entries) ?
        entries.map(entry => entry?.postKey).filter(Boolean) :
        Array.from(getPendingSpaceFeedIndex().hrefsByPostKey.keys())

    return postKeys.some(postKey => getActivePendingSpaceFeedUrls(postKey).length > 0)
}


function clearStaleLocalSpaceFeedBusyState() {
    const queueingButtons = getSpaceFeedQueueingButtons()

    if(!spaceFeedNukingPostKeys.size && !queueingButtons.length) return false
    // While a batch is still running its sends, the queueing state is not stale (owner, 26 Oct). A resolver-only batch has no profile href,
    // so hasActivePendingSpaceFeedWork below would not count it. A batch that has finished no longer holds this.
    if(spaceFeedEnqueueMarks.batches().some(batch => batch.running)) return false
    if(hasActivePendingSpaceFeedWork(getLatestSpaceFeedEntries())) return false

    spaceFeedNukingPostKeys.clear()
    for(const button of Array.from(queueingButtons)) {
        delete button.dataset.mbQueueing
    }

    return true
}



function getPendingSpaceFeedUrlSet(postKey) {
    return new Set(getActivePendingSpaceFeedUrls(postKey))
}


function normalizeCoordinatorQueue(records = {}) {
    return records && typeof records === 'object' ? records : {}
}

function isPendingCoordinatorStatus(status = '') {
    return PENDING_COORDINATOR_STATUSES.has(`${status || ''}`.trim())
}

function getCoordinatorItemSources(item = {}) {
    const sources = []
    if(item?.source && typeof item.source === 'object') sources.push(item.source)
    if(Array.isArray(item?.sources)) {
        sources.push(...item.sources.filter(source => source && typeof source === 'object'))
    }
    if(Array.isArray(item?.evidence)) {
        for(const evidence of item.evidence) {
            if(!evidence || typeof evidence !== 'object' || !evidence.sourcePageUrl) continue
            sources.push({
                type: 'space-feed',
                pageUrl: evidence.sourcePageUrl
            })
        }
    }
    return sources
}

function isCoordinatorSourceForSpace(source = null, space = null) {
    if(!source || !space?.key) return false

    if(source.spaceKey && `${source.spaceKey}` === `${space.key}`) return true

    const sourceUrl = normalizeSpaceUrl(source.spaceUrl || source.pageUrl || '')
    return !!(sourceUrl && space.url && sourceUrl === space.url)
}

function isPendingCoordinatorSpaceFeedItemForSpace(item = null, space = null) {
    if(!item || !isPendingCoordinatorStatus(item.status)) return false

    return getCoordinatorItemSources(item).some(source => isCoordinatorSourceForSpace(source, space))
}

function getPendingCoordinatorSpaceFeedWorkCountForSpace(space = resolveCurrentSpaceDescriptor()) {
    if(!space?.key) return 0

    return Object.values(coordinatorQueue || {})
        .filter(item => isPendingCoordinatorSpaceFeedItemForSpace(item, space))
        .length
}

// This page's copy of the queue without the rows of the profiles asked about (see the state reply merge above).
function dropCoordinatorQueueRowsForProfiles(queue = {}, profileHrefs = []) {
    const asked = new Set((Array.isArray(profileHrefs) ? profileHrefs : []).map(href => normalizeQuoraProfileHref(href)).filter(Boolean))
    if(!asked.size) return {...queue}
    return Object.fromEntries(Object.entries(queue || {}).filter(([itemKey, item]) => !asked.has(getCoordinatorItemProfileHref(itemKey, item))))
}

function getCoordinatorItemProfileHref(itemKey = '', item = null) {
    return normalizeQuoraProfileHref(
        item?.targetProfileHref ||
        item?.profileHref ||
        (/^https:\/\/www\.quora\.com\/profile\//i.test(itemKey) ? itemKey : '') ||
        ''
    )
}

function getPendingCoordinatorProfileHrefEntries(profileHref = '') {
    const href = normalizeQuoraProfileHref(profileHref)
    if(!href) return []

    return Object.entries(coordinatorQueue || {})
        .filter(([itemKey, item]) => {
            return isPendingCoordinatorStatus(item?.status) &&
                getCoordinatorItemProfileHref(itemKey, item) === href
        })
        .map(([itemKey, item]) => ({itemKey, item}))
}

function isCurrentProfileSearchRuntimeCoordinatorItem(item = null) {
    return !!(
        item &&
        profileSearchLastRunId &&
        `${item.runId || ''}` === profileSearchLastRunId
    )
}

function isPendingCoordinatorProfileHref(profileHref = '') {
    return getPendingCoordinatorProfileHrefEntries(profileHref).length > 0
}

function getCurrentProfilePendingCoordinatorQueueEntry() {
    if(getPageType() !== 'profile') return null

    const href = normalizeQuoraProfileHref(location.href)
    if(!href) return null

    for(const [itemKey, item] of Object.entries(coordinatorQueue || {})) {
        if(!isPendingCoordinatorStatus(item?.status)) continue
        if(getCoordinatorItemProfileHref(itemKey, item) !== href) continue
        return {itemKey, item, href}
    }

    return null
}

function hasCurrentProfilePendingCoordinatorQueueItem() {
    return !!getCurrentProfilePendingCoordinatorQueueEntry()
}

function scheduleCurrentProfilePendingClaimRescue(delayMs = QUEUED_ACTION_CLAIM_RESCUE_INTERVAL_MS) {
    if(autoProfileActionRescueTimeout || getPageType() !== 'profile') return
    if(autoProfileActionPending || !hasCurrentProfilePendingCoordinatorQueueItem()) return

    autoProfileActionRescueTimeout = setTimeout(() => {
        autoProfileActionRescueTimeout = null
        if(autoProfileActionPending || !hasCurrentProfilePendingCoordinatorQueueItem()) return

        autoProfileAction = undefined
        void maybeRunAutoProfileAction()
        scheduleCurrentProfilePendingClaimRescue()
    }, Math.max(250, Number.parseInt(delayMs, 10) || QUEUED_ACTION_CLAIM_RESCUE_INTERVAL_MS))
}

function nudgeCurrentProfilePendingClaim() {
    if(getPageType() !== 'profile' || !hasCurrentProfilePendingCoordinatorQueueItem()) return

    void maybeRecordAlreadyBlockedCoordinatorProfile()
    void maybeRunAutoProfileAction()
    scheduleCurrentProfilePendingClaimRescue()
}

function normalizeCurrentProfileSearchPageUrl() {
    try {
        const url = new URL(location.href)
        url.hash = ''
        return url.href
    }
    catch {
        return `${location.href || ''}`.split('#')[0]
    }
}

function isCoordinatorSourceForCurrentProfileSearch(source = null) {
    if(!source || `${source.type || ''}` !== 'profile-search') return false

    const currentUrl = normalizeCurrentProfileSearchPageUrl()
    const sourceUrl = `${source.pageUrl || ''}`.split('#')[0]
    if(sourceUrl && sourceUrl === currentUrl) return true

    const currentQuery = new URLSearchParams(location.search).get('q') || ''
    return !!currentQuery &&
        `${source.searchQuery || ''}`.trim().toLowerCase() === currentQuery.trim().toLowerCase()
}

function isCoordinatorItemForCurrentProfileSearch(item = null) {
    if(!item) return false
    if(isCurrentProfileSearchRuntimeCoordinatorItem(item)) return true

    return getCoordinatorItemSources(item).some(isCoordinatorSourceForCurrentProfileSearch)
}

function getPendingCoordinatorProfileSearchWorkCount() {
    const currentSearchItems = Object.values(coordinatorQueue || {})
        .filter(isCoordinatorItemForCurrentProfileSearch)
    const count = currentSearchItems
        .filter(item => isPendingCoordinatorStatus(item?.status))
        .length

    if(count > 0) return count
    if(currentSearchItems.length > 0) return 0
    if(profileSearchLastQueuedCount > 0 && Date.now() - profileSearchLastQueuedAt < 30000) {
        return profileSearchLastQueuedCount
    }

    return 0
}

// The pending state of the space feed is read from the queue copy (25 Oct: the space post map was removed). A profile is pending when a
// pending queue row names it. A post is pending when a pending row carries its postKey as evidence: a profile row marks the profile of the
// post, a resolver row (no profile yet) marks the post itself. Built once per queue copy, not once per post.
let pendingSpaceFeedIndexCache = {queue: null, index: null}

// Owner, 26 Oct: a post this page has just sent to the queue is pending at once, not when the page's copy of the queue next catches up.
// The stored pending map that used to mark it (HEAD, read on storage change) was removed on 25 Oct, and the enqueue reply carries only
// counts, so until a state reply the copy lacks the new rows. The page therefore keeps an in-memory mark per batch it sends: each post key
// with the profile it was sent for ('' for a post whose profile is still to be read). A mark is dropped when the worker's state reply shows
// the post's row (or, for a profile, a reply asked after the enqueue settled no longer has a live row for it), and at once when the
// enqueue fails. Marks are never stored: a reload clears them, and the worker's rows take over.
function touchSpaceFeedEnqueueMarks() {
    pendingSpaceFeedIndexCache = {queue: null, index: null}
    spaceFeedRenderModelMemo = null
}

// The store (spaceFeedEnqueueMarks) keys a post mark by its post key, which carries the 'space-post' prefix (getSpaceFeedPostKey), so it
// never equals a profile href in askedHrefs. A profile mark is keyed by its profile href.
function spaceFeedEnqueueMarkKeyOf(mark) {
    return mark?.profileHref || mark?.postKey || ''
}

// A profile mark is matched by the profile href of a row. A post mark (no profile yet) is matched by a post key in the row's evidence.
function spaceFeedEnqueueMarkMatchOf(row, mark) {
    return mark?.profileHref ? row.href === mark.profileHref : row.postKeys.has(mark.postKey)
}

// The marks of a batch: one per post key of each association (the store's begin takes them; see runBatchNuke in candidateNuke.js).
function spaceFeedEnqueueMarkItems(associations = []) {
    const items = []
    for(const association of Array.isArray(associations) ? associations : []) {
        const profileHref = association?.resolveProfileFromPage ? '' : `${association?.profileHref || ''}`
        for(const postKey of Array.isArray(association?.postKeys) ? association.postKeys : []) {
            const key = `${postKey || ''}`.trim()
            if(key) items.push({postKey: key, profileHref})
        }
    }
    return items
}

// requestedAt is when the reply's request was sent. queueRows is the page's copy after the reply was merged, askedHrefs the profiles asked.
// A settled batch's items are trimmed in place, so the batch reference its enqueue holds still matches the array when it is released
// (spaceFeedEnqueueMarks.release looks the batch up by identity). A copied batch would miss that release.
function applySpaceFeedEnqueueMarksToStateReply(requestedAt = 0, askedHrefs = [], queueRows = {}) {
    if(!spaceFeedEnqueueMarks.hasBatches()) return
    const rows = Object.entries(queueRows || {}).map(([itemKey, item]) => ({
        href: getCoordinatorItemProfileHref(itemKey, item) || '',
        postKeys: new Set((Array.isArray(item?.evidence) ? item.evidence : [])
            .map(evidence => `${evidence?.postKey || ''}`.trim())
            .filter(Boolean))
    }))
    spaceFeedEnqueueMarks.applyToStateReply(requestedAt, askedHrefs, rows)
}

function getPendingSpaceFeedIndex() {
    const queue = coordinatorQueue || {}
    if(pendingSpaceFeedIndexCache.queue === queue && pendingSpaceFeedIndexCache.index) return pendingSpaceFeedIndexCache.index

    const hrefsByPostKey = new Map()
    const resolverPostKeys = new Set()
    // 31 Oct: the chase URLs of the pending resolver rows. A resolver post is pending when its chase URL is already queued, whether or not
    // the row's evidence names the post (the Nuke 'Em count read 59 for 53 posts already queued).
    const resolverChaseUrls = new Set()
    for(const [itemKey, item] of Object.entries(queue)) {
        if(!isPendingCoordinatorStatus(item?.status)) continue
        const href = getCoordinatorItemProfileHref(itemKey, item)
        if(!href) {
            const chaseUrl = `${item?.requestedUrl || itemKey || ''}`.trim().replace(/^resolve-profile:/, '')
            if(chaseUrl) resolverChaseUrls.add(chaseUrl)
        }
        for(const evidence of Array.isArray(item?.evidence) ? item.evidence : []) {
            const postKey = `${evidence?.postKey || ''}`.trim()
            if(!postKey) continue
            if(!href) {
                resolverPostKeys.add(postKey)
                continue
            }
            if(!hrefsByPostKey.has(postKey)) hrefsByPostKey.set(postKey, new Set())
            hrefsByPostKey.get(postKey).add(href)
        }
    }
    // The posts this page has just sent (owner, 26 Oct; see spaceFeedEnqueueMarkItems), counted the same as a pending row.
    for(const batch of spaceFeedEnqueueMarks.batches()) {
        for(const {postKey, profileHref} of batch.items) {
            if(!profileHref) {
                resolverPostKeys.add(postKey)
                continue
            }
            if(!hrefsByPostKey.has(postKey)) hrefsByPostKey.set(postKey, new Set())
            hrefsByPostKey.get(postKey).add(profileHref)
        }
    }

    const index = {hrefsByPostKey, resolverPostKeys, resolverChaseUrls}
    pendingSpaceFeedIndexCache = {queue, index}
    return index
}

// True when a resolver post's chase URL (its cited link, or its question's log) is already a queued row (31 Oct).
function isSpaceFeedResolverChaseQueued(entry = null) {
    const chaseUrl = `${entry?.resolutionUrl || ''}`.trim()
    return !!chaseUrl && getPendingSpaceFeedIndex().resolverChaseUrls.has(chaseUrl)
}

function hasPendingCoordinatorSpaceFeedPost(postKey = '') {
    const key = `${postKey || ''}`.trim()
    if(!key) return false

    const index = getPendingSpaceFeedIndex()
    return index.hrefsByPostKey.has(key) || index.resolverPostKeys.has(key)
}




function getActivePendingSpaceFeedWorkCountForSpace(space = resolveCurrentSpaceDescriptor()) {
    return getPendingCoordinatorSpaceFeedWorkCountForSpace(space)
}



function isSuccessfulProfileNukeRecord(record) {
    if(record?.actionKind === UNBLOCK_UNMUTE_ACTION_KIND) {
        return !!record.unblockSucceeded ||
            record.status === 'unblocked' ||
            record.status === 'already-unblocked'
    }

    return !!record && (
        !!record.blockSucceeded ||
        record.status === 'blocked' ||
        record.status === 'already-blocked'
    )
}

function isSettledProfileNukeRecord(record) {
    if(isSuccessfulProfileNukeRecord(record)) return true

    const status = `${record?.status || ''}`.trim()
    return status === 'profile-unavailable' ||
        status === 'archived-terminal' ||
        status === 'error' ||
        status === 'error-page' ||
        status === 'interrupted'
}

function isProfileNukeSucceeded(href) {
    return isSuccessfulProfileNukeRecord(getProfileNukeProgressRecord(href))
}

function isProfileNukeSettled(href) {
    return isSettledProfileNukeRecord(getProfileNukeProgressRecord(href))
}

function isRetryableProfileNukeRecord(record) {
    const status = `${record?.status || ''}`.trim()
    if(isSecurityVerificationProgressRecord(record)) return false
    if(status === 'interrupted') return true
    if(status === 'error') return true

    return false
}

function isProfileNukeRetryBlocked(href) {
    const record = getProfileNukeProgressRecord(href)
    return isSettledProfileNukeRecord(record) && !isRetryableProfileNukeRecord(record)
}

// Owner, 29 Oct: one line of the Bad Links list. The name and the link are the profile the queue row targeted. The reason is
// "redirected to <name>" when Quora sent that profile to another name (the progress record keeps the landing profile), else "unavailable".
function getSpaceFeedBadLinkDetail(href, record = null) {
    const requestedHref = normalizeQuoraProfileHref(href) || `${href || ''}`
    const name = requestedHref.split('/profile/')[1] || requestedHref
    const landedHref = normalizeQuoraProfileHref(record?.resolvedProfileHref || '') ||
        normalizeQuoraProfileHref(`${record?.unavailableReason || ''}`.match(/redirected from \S+ to (\S+)$/)?.[1] || '') || ''
    const redirected = !!landedHref && landedHref !== requestedHref
    return {
        href: requestedHref,
        name,
        reason: redirected ? `redirected to ${landedHref.split('/profile/')[1] || landedHref}` : 'unavailable'
    }
}

function isResolvableSpaceFeedEntry(entry) {
    return !!entry?.resolveProfileFromPage &&
        !!entry?.postKey &&
        !!normalizeQuoraPostHref(entry?.resolutionUrl || entry?.postUrl || '')
}

function getUnsuccessfulProfileNukeUrls(urls) {
    return getNormalizedProfileHrefList(urls || []).filter(url => !isProfileNukeSucceeded(url))
}

function isActivePendingSpaceFeedProfileUrl(url) {
    const record = getProfileNukeProgressRecord(url)
    if(!record) return true
    if(isSuccessfulProfileNukeRecord(record)) return false
    if(isSettledProfileNukeRecord(record)) return false

    const status = `${record.status || ''}`.trim()
    return !status || isTransientProfileNukeStatus(status)
}

// The profiles of a post the queue still holds as pending and the progress does not yet settle.
function getActivePendingSpaceFeedUrls(postKey) {
    const key = `${postKey || ''}`.trim()
    if(!key) return []

    return Array.from(getPendingSpaceFeedIndex().hrefsByPostKey.get(key) || [])
        .filter(url => !isKnownNukedSpaceFeedProfile(url) && isActivePendingSpaceFeedProfileUrl(url))
}


function getSucceededSpaceFeedEntryUrls(entry) {
    return getNormalizedProfileHrefList(entry?.candidateUrls || []).filter(url => isProfileNukeSucceeded(url))
}

function isSpaceFeedPostEffectivelyNuked(entry) {
    const urls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
    return urls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES && urls.every(url => isProfileNukeSucceeded(url))
}

function getQueueableSpaceFeedEntryUrls(entry) {
    if(!entry?.postKey) return []

    const pendingUrls = getPendingSpaceFeedUrlSet(entry.postKey)
    return getNormalizedProfileHrefList(entry.candidateUrls || [])
        .filter(url => !pendingUrls.has(url) &&
            !isPendingCoordinatorProfileHref(url) &&
            !isProfileNukeRetryBlocked(url) &&
            isSpaceFeedProfileStateReady(url) &&
            !isKnownNukedSpaceFeedProfile(url))
}

function isQueueableSpaceFeedResolverEntry(entry) {
    if(!isResolvableSpaceFeedEntry(entry)) return false
    if(getQueueableSpaceFeedEntryUrls(entry).length >= SPACE_FEED_POST_NUKE_MIN_PROFILES) return false
    if(`${entry?.resolutionReason || ''}`.trim() === 'low-confidence-profile-artifact') return false
    if(getNormalizedProfileHrefList(entry?.candidateUrls || []).length) return false
    if(isSpaceFeedEntryNuked(entry)) return false
    if(isSpaceFeedPostPending(entry.postKey)) return false

    return true
}

function getSpaceFeedQueuedWorkCount(entries = []) {
    // Distinct profiles, as the page de-duplicates them: a profile linked from several posts is one. A post whose profile is still to be read counts one.
    const profiles = new Set()
    let unresolved = 0

    for(const entry of Array.isArray(entries) ? entries : []) {
        for(const url of getNormalizedProfileHrefList(entry?.candidateUrls || [])) {
            profiles.add(getNormalizedProfileIdentityKey(url) || url)
        }
        if(isQueueableSpaceFeedResolverEntry(entry) || (isResolvableSpaceFeedEntry(entry) && getPendingSpaceFeedIndex().resolverPostKeys.has(entry.postKey))) {
            unresolved += 1
        }
    }

    return profiles.size + unresolved
}

function buildSpaceFeedRenderContext(space = resolveCurrentSpaceDescriptor()) {
    const index = getPendingSpaceFeedIndex()
    const pendingCoordinatorProfileHrefs = new Set()
    // The profiles this space's own rows still have in progress. The nuking count reads this set, not every pending row: the copy of the
    // queue holds other spaces' rows too (a state reply covers the profiles on the page, whatever space queued them), and a profile pending
    // only in another space's row is not this page's work. Nuke 'Em still treats it as taken (pendingCoordinatorProfileHrefs).
    const pendingSpaceProfileHrefs = new Set()
    const pendingCoordinatorPostKeys = new Set([...index.hrefsByPostKey.keys(), ...index.resolverPostKeys])
    let coordinatorSpaceWorkCount = 0

    for(const [itemKey, item] of Object.entries(coordinatorQueue || {})) {
        if(!isPendingCoordinatorStatus(item?.status)) continue

        const profileHref = getCoordinatorItemProfileHref(itemKey, item)
        if(profileHref) pendingCoordinatorProfileHrefs.add(profileHref)

        if(isPendingCoordinatorSpaceFeedItemForSpace(item, space)) {
            coordinatorSpaceWorkCount += 1
            if(profileHref && isActivePendingSpaceFeedProfileUrl(profileHref) && !isKnownNukedSpaceFeedProfile(profileHref)) {
                pendingSpaceProfileHrefs.add(profileHref)
            }
        }
    }

    // A profile sent in this page's batch is pending for every post that names it, as a queued row is (see spaceFeedEnqueueMarkItems).
    for(const batch of spaceFeedEnqueueMarks.batches()) {
        for(const {profileHref} of batch.items) {
            if(!profileHref) continue
            pendingCoordinatorProfileHrefs.add(profileHref)
            pendingSpaceProfileHrefs.add(profileHref)
        }
    }

    return {
        space,
        pendingCoordinatorProfileHrefs,
        pendingSpaceProfileHrefs,
        pendingCoordinatorPostKeys,
        coordinatorSpaceWorkCount,
        activePendingUrls: new Map()
    }
}





function getActivePendingSpaceFeedUrlsForRender(postKey = '', context = null) {
    const key = `${postKey || ''}`.trim()
    if(!key) return []
    if(context?.activePendingUrls?.has(key)) return context.activePendingUrls.get(key)

    const urls = getActivePendingSpaceFeedUrls(key)
    if(context?.activePendingUrls) context.activePendingUrls.set(key, urls)
    return urls
}


function isSpaceFeedPostPendingForRender(postKey = '', context = null) {
    const key = `${postKey || ''}`.trim()
    if(!key) return false
    if(context ? context.pendingCoordinatorPostKeys.has(key) : hasPendingCoordinatorSpaceFeedPost(key)) return true
    return getActivePendingSpaceFeedUrlsForRender(key, context).length > 0
}


// Diagnostic, 23 Oct: for one post, how many of its candidate profiles are answered, nuked, retry-blocked, pending, or queueable. Written to
// the post's button as data-mb-diag, so the reason a post shows nothing can be read from the page.
function getSpaceFeedPostCandidateDiagnostic(entry = null) {
    const urls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
    const pendingUrls = new Set(entry?.activePendingUrls || [])
    const counts = {
        candidates: urls.length,
        answered: 0,
        nuked: 0,
        retryBlocked: 0,
        pending: 0,
        queueable: entry?.queueableUrls?.length || 0,
        resolver: entry?.hasResolver === true
    }
    for(const url of urls) {
        if(isSpaceFeedProfileStateReady(url)) counts.answered += 1
        if(isKnownNukedSpaceFeedProfile(url)) counts.nuked += 1
        if(isProfileNukeRetryBlocked(url)) counts.retryBlocked += 1
        if(pendingUrls.has(url) || isPendingCoordinatorProfileHref(url)) counts.pending += 1
    }
    return JSON.stringify(counts)
}

function getQueueableSpaceFeedEntryUrlsForRender(entry = null, context = null) {
    if(!entry?.postKey) return []

    const pendingUrls = new Set(getActivePendingSpaceFeedUrlsForRender(entry.postKey, context))
    const pendingCoordinatorProfileHrefs = context?.pendingCoordinatorProfileHrefs || new Set()
    return getNormalizedProfileHrefList(entry.candidateUrls || [])
        .filter(url => !pendingUrls.has(url) &&
            !pendingCoordinatorProfileHrefs.has(url) &&
            !isProfileNukeRetryBlocked(url) &&
            isSpaceFeedProfileStateReady(url) &&
            !isKnownNukedSpaceFeedProfile(url))
}

function isSpaceFeedEntryNukedForRender(entry = null, context = null) {
    return isSpaceFeedPostNuked(entry?.candidateUrls || [])
}

function isQueueableSpaceFeedResolverEntryForRender(entry = null, context = null) {
    if(!isResolvableSpaceFeedEntry(entry)) return false
    if(getQueueableSpaceFeedEntryUrlsForRender(entry, context).length >= SPACE_FEED_POST_NUKE_MIN_PROFILES) return false
    if(`${entry?.resolutionReason || ''}`.trim() === 'low-confidence-profile-artifact') return false
    if(getNormalizedProfileHrefList(entry?.candidateUrls || []).length) return false
    if(isSpaceFeedEntryNukedForRender(entry, context)) return false
    if(isSpaceFeedPostPendingForRender(entry.postKey, context)) return false
    if(isSpaceFeedResolverChaseQueued(entry)) return false

    return true
}

function buildSpaceFeedRenderEntry(entry = null, context = null) {
    const candidateUrls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
    const postNuked = isSpaceFeedEntryNukedForRender(entry, context)
    const activePendingUrls = postNuked ? [] : getActivePendingSpaceFeedUrlsForRender(entry?.postKey || '', context)
    const queueableUrls = postNuked ? [] : getQueueableSpaceFeedEntryUrlsForRender(entry, context)
    const hasResolver = !postNuked && isQueueableSpaceFeedResolverEntryForRender(entry, context)
    const liveUrls = postNuked ? [] : getNormalizedProfileHrefList([...activePendingUrls, ...queueableUrls])
    const resolverPending = isResolvableSpaceFeedEntry(entry) &&
        (getPendingSpaceFeedIndex().resolverPostKeys.has(entry?.postKey) || isSpaceFeedResolverChaseQueued(entry))
    const postBusy = !postNuked && (isSpaceFeedPostNuking(entry?.postKey) || isSpaceFeedPostPendingForRender(entry?.postKey || '', context))
    const queueableWorkCount = queueableUrls.length + (hasResolver ? 1 : 0)
    const liveWorkCount = liveUrls.length + (resolverPending ? 1 : 0)

    return {
        ...entry,
        candidateUrls,
        postNuked,
        activePendingUrls,
        queueableUrls,
        hasResolver,
        liveUrls,
        resolverPending,
        postBusy,
        hasCandidates: queueableUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES || hasResolver,
        queueableWorkCount,
        liveWorkCount
    }
}

function makeSpaceFeedQueueableEntry(entry = null) {
    if(!entry?.queueableWorkCount) return null
    if(entry.queueableUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES) {
        return {
            ...entry,
            candidateUrls: [...entry.queueableUrls]
        }
    }
    if(entry.hasResolver) {
        return {
            ...entry,
            candidateUrls: [],
            resolveProfileFromPage: true
        }
    }

    return null
}

function makeSpaceFeedLiveEntry(entry = null) {
    if(!entry?.liveWorkCount && !entry?.hasResolver) return null
    if(entry.liveUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES) {
        return {
            ...entry,
            candidateUrls: [...entry.liveUrls]
        }
    }
    if(entry.hasResolver) {
        return {
            ...entry,
            candidateUrls: [],
            resolveProfileFromPage: true
        }
    }

    return null
}



// Owner, 23 Oct: the count is the number of unique profiles still to be queued. A red post says only that one of its profiles is in that
// queue, so a profile linked from several posts counts once.
// Owner, 23 Oct: the busy count is the distinct profiles on this space that are queued and not yet done. A profile linked from several posts
// counts once, and profiles still to be queued are not in it. A post whose profile is still being read counts one.
// excludeKeys (28 Oct) are the in-flight batch's keys (getSpaceFeedInFlightEnqueueKeys): they are shown as Queueing, so they are left out here.
function getSpacePendingProfileCount(entries = [], pendingCoordinatorProfileHrefs = new Set(), excludeKeys = new Set()) {
    const list = Array.isArray(entries) ? entries : []
    const pendingKeys = new Set()
    for(const entry of list) {
        for(const url of entry?.activePendingUrls || []) pendingKeys.add(getSpaceFeedProfileStateKey(url))
    }
    const candidateKeys = new Set(list.flatMap(entry =>
        getNormalizedProfileHrefList(entry?.candidateUrls || []).map(url => getSpaceFeedProfileStateKey(url))))
    for(const url of pendingCoordinatorProfileHrefs || []) {
        const key = getSpaceFeedProfileStateKey(url)
        if(candidateKeys.has(key)) pendingKeys.add(key)
    }
    for(const key of excludeKeys || []) pendingKeys.delete(key)
    return pendingKeys.size + list.filter(entry => entry?.resolverPending && !excludeKeys?.has(`post:${entry.postKey || ''}`)).length
}

// The profiles of this page's in-flight batches (E1, 28 Oct): marked and not yet settled, so the enqueue is still running. They are the
// Queueing count, and the Nuking count leaves them out, so nothing is counted twice. A resolver mark has no profile yet, so it is keyed by its post.
function getSpaceFeedInFlightEnqueueKeys() {
    const keys = new Set()
    for(const batch of spaceFeedEnqueueMarks.batches()) {
        if(batch.settledAt > 0) continue
        for(const {postKey, profileHref} of batch.items) {
            const key = profileHref ? getSpaceFeedProfileStateKey(profileHref) : `post:${postKey || ''}`
            if(key) keys.add(key)
        }
    }
    return keys
}

function getSpaceFeedUniqueQueueableProfileCount(queueableEntries = []) {
    const keys = new Set()
    for(const entry of Array.isArray(queueableEntries) ? queueableEntries : []) {
        for(const url of getNormalizedProfileHrefList(entry?.candidateUrls || [])) keys.add(getSpaceFeedProfileStateKey(url))
    }
    return keys.size
}

// Owner, 24 Oct: the page-wide model is reused for a short time while the same posts are on the page, so scrolling does not rebuild it
// for every post on each render. A structural page change clears the reuse (see invalidateSpaceFeedEntryCacheForMutations).
let spaceFeedRenderModelMemo = null

function buildSpaceFeedRenderModel(scannedEntries = [], aggregateEntries = scannedEntries) {
    const scanned = Array.isArray(scannedEntries) ? scannedEntries : []
    const aggregate = Array.isArray(aggregateEntries) ? aggregateEntries : []
    const signature = `${scanned.map(entry => entry?.postKey || '').join('|')}#${aggregate.map(entry => `${entry?.postKey || ''}:${(entry?.candidateUrls || []).length}`).join('|')}`
    const now = Date.now()
    if(spaceFeedRenderModelMemo && spaceFeedRenderModelMemo.signature === signature && now - spaceFeedRenderModelMemo.at < SPACE_FEED_RENDER_MODEL_MEMO_MS) {
        return spaceFeedRenderModelMemo.model
    }

    const model = computeSpaceFeedRenderModel(scannedEntries, aggregateEntries)
    spaceFeedRenderModelMemo = {signature, at: now, model}
    return model
}

function computeSpaceFeedRenderModel(scannedEntries = [], aggregateEntries = scannedEntries) {
    const context = buildSpaceFeedRenderContext()
    const totalEntries = (Array.isArray(aggregateEntries) ? aggregateEntries : []).map(entry => buildSpaceFeedRenderEntry(entry, context))
    const visibleEntries = (Array.isArray(scannedEntries) ? scannedEntries : []).map(entry => buildSpaceFeedRenderEntry(entry, context))
    const actionableEntries = totalEntries.filter(entry =>
        entry.candidateUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES ||
        entry.hasResolver ||
        isResolvableSpaceFeedEntry(entry)
    )
    const liveEntries = totalEntries
        .map(makeSpaceFeedLiveEntry)
        .filter(Boolean)
        .map(entry => ({...entry, workCount: entry.liveWorkCount || entry.queueableWorkCount || 0}))
    const pendingEntries = actionableEntries.filter(entry => entry.postBusy)
    const queueableEntries = actionableEntries
        .map(makeSpaceFeedQueueableEntry)
        .filter(Boolean)
        .map(entry => ({...entry, workCount: entry.queueableWorkCount || 0}))
    const unresolvedCount = queueableEntries.reduce((total, entry) => {
        return getNormalizedProfileHrefList(entry.candidateUrls || []).length
            ? total
            : total + (Number.parseInt(entry.workCount, 10) || 0)
    }, 0)
    // The count is the unique profiles still to be queued, plus one for each post whose profile is still to be read.
    const queueableCount = getSpaceFeedUniqueQueueableProfileCount(queueableEntries) + unresolvedCount
    const busyEntries = actionableEntries.filter(entry => entry.postBusy)
    const hasNukedEntries = totalEntries.some(entry => entry.postNuked)
    const allActionableEntriesSettled = actionableEntries.length > 0 &&
        actionableEntries.every(entry => isSpaceFeedPostSettled(entry) || entry.postNuked)
    const allActionableEntriesNuked = actionableEntries.length > 0 &&
        actionableEntries.every(entry => entry.postNuked)
    const activeSpaceWorkCount = getActivePendingSpaceFeedWorkCountForSpace(context.space)
    const displaySpaceWorkCount = Math.max(activeSpaceWorkCount, context.coordinatorSpaceWorkCount)
    // The nuking count is this page's in-progress work only (see buildSpaceFeedRenderContext), so it never exceeds the rows in progress for it.
    // E1 (28 Oct): the in-flight batch is the Queueing count; the Nuking count leaves those profiles out.
    const inFlightEnqueueKeys = getSpaceFeedInFlightEnqueueKeys()
    const pendingProfileCount = getSpacePendingProfileCount(totalEntries, context.pendingSpaceProfileHrefs, inFlightEnqueueKeys)
    const queueingProfileCount = inFlightEnqueueKeys.size
    const hasActiveSpaceWork = displaySpaceWorkCount > 0
    const localBusy = !!(hasActiveSpaceWork || busyEntries.length || pendingEntries.length)

    return {
        context,
        space: context.space,
        totalEntries,
        visibleEntries,
        actionableEntries,
        liveEntries,
        pendingEntries,
        queueableEntries,
        queueableCount,
        queueableUrls: getDedupedSpaceFeedUrls(queueableEntries),
        busyEntries,
        hasNukedEntries,
        allActionableEntriesSettled,
        allActionableEntriesNuked,
        ownerPaused: ownedNukeStatusCache.paused,
        ownerRunning: hasOwnedNukeWorkInFlight(),
        activeSpaceWorkCount,
        coordinatorSpaceWorkCount: context.coordinatorSpaceWorkCount,
        displaySpaceWorkCount,
        pendingProfileCount,
        queueingProfileCount,
        hasActiveSpaceWork,
        localBusy,
        batchNukeActive: isActiveSpaceFeedNukeMode('batch', localBusy, context.space),
        singleNukeActive: isActiveSpaceFeedNukeMode('single', localBusy, context.space),
        unknownNukeActive: isUnknownSpaceFeedNukeActive(localBusy)
    }
}

function getSpaceFeedActionElements(postRoot) {
    const actions = timedSpaceQuery('postActions', () => Array.from(postRoot.querySelectorAll('button, a, [role="button"]')))
        .filter(candidate => isSpaceFeedActionLabel(getPostActionLabel(candidate)))

    return actions
}

function getSpaceFeedPostAnchorContainer(postRoot) {
    if(!postRoot) return null

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    let anchorContainer = postRoot
    let node = postRoot.parentElement

    while(node) {
        if(node.nodeType !== Node.ELEMENT_NODE) {
            node = node.parentElement
            continue
        }

        if(node === main || node === document.body || node === document.documentElement) break

        const rect = node.getBoundingClientRect()
        const currentRect = anchorContainer.getBoundingClientRect()
        const isMeaningfullyWider = rect.width >= currentRect.width + 24
        const isReasonableHeight = rect.height <= currentRect.height * 1.75
        const isNotTooWide = rect.width <= postRoot.getBoundingClientRect().width * 1.5

        if(isMeaningfullyWider && isReasonableHeight && isNotTooWide) {
            anchorContainer = node
        }

        node = node.parentElement
    }

    return anchorContainer
}

function isSpaceFeedDocumentLevelElement(element) {
    return element === document.body || element === document.documentElement
}

function getSpaceFeedPostButtonHost(postRoot, postKey = '') {
    if(!postRoot) return null
    if(isSpaceFeedDocumentLevelElement(postRoot)) return null

    const timestamp = postRoot.querySelector('a.post_timestamp, a.answer_timestamp')
    const headerContainer = timestamp?.closest('.q-flex.qu-alignItems--flex-start, .q-flex') || null
    const parent = getSpaceFeedPostAnchorContainer(postRoot) || postRoot
    if(isSpaceFeedDocumentLevelElement(parent)) return null

    let host = timedSpaceQuery('postHostLookup', () => Array.from(parent.querySelectorAll(':scope > .mb-ext_space-feed-post-nuke-host')))
        .find(candidate => (candidate.dataset.mbPostHostKey || '') === postKey)
    if(host) return host

    for(const strayHost of timedSpaceQuery('postHostStray', () => Array.from(postRoot.querySelectorAll('.mb-ext_space-feed-post-nuke-host')))) {
        if(strayHost.parentElement !== parent && (!postKey || strayHost.dataset.mbPostHostKey === postKey)) {
            strayHost.remove()
        }
    }

    host = document.createElement('div')
    host.className = 'mb-ext_space-feed-post-nuke-host mb-ext_post-nuke-slot'
    spaceFeedPostHostSet.add(host)
    host.dataset.mbPostHostKey = postKey
    parent.classList.add('mb-ext_post-card')

    if(headerContainer && postRoot.contains(headerContainer)) {
        headerContainer.classList.add('mb-ext_post-header-host')

        const headerRect = headerContainer.getBoundingClientRect()
        const parentRect = parent.getBoundingClientRect()
        const top = Math.max(10, Math.round(headerRect.top - parentRect.top + headerRect.height / 2))
        host.style.top = `${top}px`
    }

    parent.appendChild(host)
    return host
}

function syncSpaceFeedPostHeaderReservedSpace(postRoot, host) {
    if(!postRoot || !host) return

    const timestamp = postRoot.querySelector('a.post_timestamp, a.answer_timestamp')
    const headerContainer = timestamp?.closest('.q-flex.qu-alignItems--flex-start, .q-flex') || null
    if(!headerContainer || !postRoot.contains(headerContainer)) return

    // The button host is absolutely positioned over the header row (see
    // .mb-ext_post-nuke-slot), so it doesn't push byline text out of the
    // way on its own -- the header's own padding-right has to reserve
    // enough space. The static CSS default (.mb-ext_post-header-host) only
    // covers the single-badge "already nuked" case; the two-button
    // idle/queueable state (variable-length "Nuke 'Em N" counter beside
    // "Mute-Block") can be noticeably wider, so measure the host's actual
    // rendered width instead of guessing a fixed constant.
    const reserved = Math.ceil(host.getBoundingClientRect().width) + 24
    headerContainer.style.paddingRight = `${Math.max(reserved, 0)}px`
}

function setSpaceFeedButtonUrls(button, urls) {
    if(!button) return
    button.dataset.mbSpaceFeedUrls = JSON.stringify(getNormalizedProfileHrefList(urls))
}

function normalizeSpaceFeedButtonEntries(entries = []) {
    return (Array.isArray(entries) ? entries : []).flatMap(entry => {
        const postKey = `${entry?.postKey || ''}`.trim()
        const candidateUrls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
        const resolveProfileFromPage = !candidateUrls.length &&
            (entry?.resolveProfileFromPage === true || isResolvableSpaceFeedEntry(entry)) &&
            isResolvableSpaceFeedEntry(entry)
        if(!postKey || (!candidateUrls.length && !resolveProfileFromPage)) return []

        return [{
            postKey,
            postUrl: entry?.postUrl || '',
            candidateUrls,
            resolveProfileFromPage,
            resolutionReason: `${entry?.resolutionReason || ''}`.trim(),
            // The chase fields must survive the button round trip. Without them a cited post (Instant Block, qr.ae or a question's /log) falls
            // back to the post's own address and the queued tab never lands on a profile (history, 31 Oct).
            resolutionUrl: `${entry?.resolutionUrl || ''}`.trim(),
            resolutionSubject: `${entry?.resolutionSubject || ''}`.trim()
        }]
    })
}

function setSpaceFeedButtonEntries(button, entries) {
    if(!button) return
    button.dataset.mbSpaceFeedEntries = JSON.stringify(normalizeSpaceFeedButtonEntries(entries))
}

function setSpaceFeedButtonSelection(button, entries) {
    setSpaceFeedButtonUrls(button, getDedupedSpaceFeedUrls(entries))
    setSpaceFeedButtonEntries(button, entries)
}

function ensureCurrentInstanceClickHandler(button, handlerKey, handler, eventType = 'click') {
    if(!button) return button
    if(button.dataset.mbHandlerInstance === CONTENT_SCRIPT_INSTANCE_ID &&
        button.dataset.mbClickHandler === handlerKey) {
        return button
    }

    const activeButton = button.dataset.mbHandlerInstance || button.dataset.mbClickHandler
        ? button.cloneNode(true)
        : button
    if(activeButton !== button) {
        button.replaceWith(activeButton)
    }

    activeButton.dataset.mbHandlerInstance = CONTENT_SCRIPT_INSTANCE_ID
    activeButton.dataset.mbClickHandler = handlerKey
    activeButton.addEventListener(eventType, handler)
    return activeButton
}

function getSpaceFeedButtonUrls(button) {
    if(!button) return []

    try {
        const urls = JSON.parse(button.dataset.mbSpaceFeedUrls || '[]')
        return Array.isArray(urls) ? getNormalizedProfileHrefList(urls) : []
    }
    catch {
        return []
    }
}

function getSpaceFeedButtonEntries(button) {
    if(!button) return []

    try {
        return normalizeSpaceFeedButtonEntries(JSON.parse(button.dataset.mbSpaceFeedEntries || '[]'))
    }
    catch {
        return []
    }
}

// Stage 1 (24 Oct, space-page-redraw-plan-2026-10-24.md): a redraw reuses the last scan of the feed unless the feed's structure changed, the
// view moved past the band, the content root changed, or the scan is old. Scanning the feed is what made every redraw costly.
let spaceFeedStructureVersion = 0
let spaceFeedScanReuse = null

function getSpaceFeedPostEntriesForRender() {
    const contentRoot = getSpaceFeedContentRoot()
    const scrollY = window.scrollY || 0
    const reuse = spaceFeedScanReuse
    if(reuse &&
        reuse.root === contentRoot &&
        reuse.version === spaceFeedStructureVersion &&
        Date.now() - reuse.at < SPACE_FEED_SCAN_REUSE_MS &&
        isSpaceFeedScrollWithinBand(scrollY - reuse.scrollY) &&
        reuse.entries.every(entry => entry.postRoot?.isConnected !== false)) {
        return reuse.entries
    }

    const entries = getSpaceFeedPostEntries()
    spaceFeedScanReuse = {entries, root: contentRoot, version: spaceFeedStructureVersion, scrollY, at: Date.now()}
    return entries
}

// The scan window reaches further below the view than above it, so a move down is allowed further than a move up.
function isSpaceFeedScrollWithinBand(movedPx) {
    return movedPx >= 0 ? movedPx < SPACE_FEED_SCAN_BAND_DOWN_PX : -movedPx < SPACE_FEED_SCAN_BAND_UP_PX
}

// The short link a target-space post carries in its address (30 Oct). An Instant Block post's address is its title and then "-https-qr-ae-<code>",
// which names the post it cites. The cited post's poster is the target, not the sharer, so the chase goes to that link.
function getSpaceFeedCitedUrl(timestamp) {
    const href = timestamp?.getAttribute?.('href') || ''
    let pathname = ''
    try {
        pathname = new URL(href, location.origin).pathname
    }
    catch {
        return ''
    }
    const shortLink = /-https-qr-ae-([A-Za-z0-9]+)$/.exec(pathname)
    if (shortLink) return `https://qr.ae/${shortLink[1]}`
    // A question addressed as its quora.com copy ("https-www-quora-com-unanswered-<title>-ch-17-amp-oid-<oid>"). The question's log page names
    // the asker, so the chase goes there (30 Oct).
    const question = /^\/https-www-quora-com-unanswered-(.+?)(?:-ch-\d+)?(?:-amp-oid-\d+|$)/.exec(pathname)
    return question ? `https://www.quora.com/${question[1]}/log` : ''
}

// The question a post shares, read from its question card (31 Oct). The card's link is the full question address, while the post's
// own address can be cut short ("...-nationals-t"), so a chase built from the address reaches the wrong slug. The card sits above the
// post's timestamp, so the climb goes up from the timestamp and stops at the first ancestor that holds another post.
const SPACE_FEED_QUESTION_CARD_MAX_LEVELS = 20
// Root paths on www.quora.com that are not a question, so a root-level card link to one of them is not chased (31 Oct).
const SPACE_FEED_QUESTION_CARD_NON_QUESTION_ROOTS = new Set([
    'answer', 'bookmarks', 'business', 'careers', 'contact', 'following', 'messages', 'notifications',
    'profile', 'question', 'search', 'settings', 'space', 'spaces', 'topic', 'unanswered'
])
function getSpaceFeedQuestionCardCitedUrl(timestamp) {
    let node = timestamp?.parentElement || null
    for(let level = 0; level < SPACE_FEED_QUESTION_CARD_MAX_LEVELS && node && node !== document.body; level += 1) {
        // The timestamp itself is one post timestamp, so a second one means this ancestor holds another post.
        if(node.querySelectorAll('a.post_timestamp, a.answer_timestamp').length > 1) break

        for(const link of Array.from(node.querySelectorAll('a[href]'))) {
            if(link === timestamp) continue
            let url = null
            try {
                url = new URL(link.getAttribute('href') || '', location.origin)
            }
            catch {
                continue
            }
            const questionPath = url.pathname.replace(/\/+$/, '')
            // Two forms: "/unanswered/<question>", and a root-level answered question "/<question>" on www.quora.com. The root form is
            // told from a profile alias by its title: a question card's link text is the question itself, which ends in "?".
            const unansweredCard = /(^|\.)quora\.com$/.test(url.hostname) && questionPath.startsWith('/unanswered/') && questionPath !== '/unanswered'
            const rootQuestionCard = url.hostname === 'www.quora.com' &&
                questionPath.split('/').length === 2 &&
                questionPath.indexOf('-') > 0 &&
                !SPACE_FEED_QUESTION_CARD_NON_QUESTION_ROOTS.has(questionPath.slice(1)) &&
                `${link.textContent || ''}`.indexOf('?') >= 0
            if(!unansweredCard && !rootQuestionCard) continue
            return `https://www.quora.com${questionPath}/log`
        }
        node = node.parentElement
    }
    return ''
}

// A question title in a question card: a link into this space that is not a post's timestamp (30 Oct).
function isSpaceFeedQuestionTitleLink(link) {
    if (!link || link.matches?.('a.post_timestamp, a.answer_timestamp')) return false
    const href = link.getAttribute('href') || ''
    if (!href.startsWith(`${location.origin}/`)) return false
    return (link.textContent || '').trim().length >= 8
}

// The row of one question in a question card (30 Oct): the largest container that holds this title, no other question title, and no post
// timestamp. The row carries the Answer button, which is how a row is told from a link in the page's chrome.
function getSpaceFeedQuestionRow(link) {
    // Quora wraps each question in its own question component, which holds the title, the counts and the Answer button (30 Oct).
    const component = link.closest('[class*="puppeteer_test_question_component"]')
    if (component && !component.querySelector('a.post_timestamp, a.answer_timestamp')) {
        return /\bAnswer\b/.test(component.innerText || '') ? component : null
    }

    let row = null
    let node = link.parentElement
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
        if (node.querySelector('a.post_timestamp, a.answer_timestamp')) break
        // A question's own count links ("4 answers") point at the same question, so they are not another title (30 Oct).
        const linkHref = link.getAttribute('href')
        const otherTitle = Array.from(node.querySelectorAll('a[href]')).some(other => other.getAttribute('href') !== linkHref && isSpaceFeedQuestionTitleLink(other))
        if (otherTitle) break
        row = node
        node = node.parentElement
    }
    return row && /\bAnswer\b/.test(row.innerText || '') ? row : null
}

// Questions asked in this space (30 Oct). They have no timestamp, so they are not in the post scan. Each question's querent is read from the
// question's own log page, in a worker-window resolution. The subject is the poster.
// A question link inside an answer card (31 Oct): the card's own "1 of 3 answers" and question title point at the question, but the card is
// a post and already has its controls. The nearest ancestor with a post timestamp is the card when it holds exactly one timestamp; a feed
// holds many, so the climb stops there without a card.
function isInsideSpaceFeedPostCard(link) {
    for (let node = link.parentElement; node && node !== document.body; node = node.parentElement) {
        const count = node.querySelectorAll('a.post_timestamp, a.answer_timestamp').length
        if (count === 1) return true
        if (count > 1) return false
    }
    return false
}

function getSpaceFeedQuestionRowEntries() {
    if (!isTargetSpacePage()) return []
    const entries = []
    const seen = new Set()
    for (const link of Array.from(document.querySelectorAll('a[href]'))) {
        if (!isSpaceFeedQuestionTitleLink(link)) continue
        if (isInsideSpaceFeedPostCard(link)) continue
        const submissionUrl = normalizeQuoraPostHref(link.getAttribute('href'))
        if (!submissionUrl || seen.has(submissionUrl)) continue
        const row = getSpaceFeedQuestionRow(link)
        if (!row) continue
        seen.add(submissionUrl)
        entries.push({
            postKey: `space-question:${submissionUrl}`,
            postRoot: row,
            postUrl: submissionUrl,
            candidateUrls: [],
            candidateEvidenceByHref: {},
            needsSourceResolution: true,
            resolveProfileFromPage: true,
            resolutionUrl: `${submissionUrl}/log`,
            resolutionSubject: RESOLUTION_SUBJECT_POSTER,
            resolutionReason: 'question-card-needs-querent'
        })
    }
    return entries
}

function getSpaceFeedPostEntries() {
    const entries = []
    const roots = getSpaceFeedCardRoots()
    const contentRoot = getSpaceFeedContentRoot()
    const activeKeys = new Set()
    let newlyObservedRoots = 0

    for(const postRoot of roots) {
        const timestamp = timedSpaceQuery('entryTimestamp', () => postRoot.querySelector('a.post_timestamp, a.answer_timestamp'))
        if(!timestamp) continue

        const postKey = getSpaceFeedPostKey(postRoot, timestamp)
        if(!postKey) continue
        activeKeys.add(postKey)
        if(!spaceFeedObservedRoots.has(postRoot)) newlyObservedRoots += 1
        getSpaceFeedNearObserver()?.observe(postRoot)
        spaceFeedObservedRoots.add(postRoot)

        const postUrl = getSpaceFeedPostUrl(timestamp)
        const cached = spaceFeedEntryCache.get(postKey)
        let candidateUrls = null
        let candidateEvidenceByHref = {}
        let needsSourceResolution = false

        if(cached?.postRoot === postRoot && cached.postUrl === postUrl && postRoot.isConnected) {
            candidateUrls = [...cached.candidateUrls]
            candidateEvidenceByHref = cached.candidateEvidenceByHref || {}
            needsSourceResolution = cached.needsSourceResolution === true
        }
        else {
            candidateUrls = getSpaceFeedPostCandidateProfileUrls(postRoot, timestamp)
            candidateEvidenceByHref = candidateUrls.candidateEvidenceByHref || {}
            needsSourceResolution = candidateUrls.needsSourceResolution === true
            let node = postRoot.parentElement

            while(!candidateUrls.length && node && node !== contentRoot) {
                const rootState = getSpaceFeedRootCandidateState(node, timestamp)
                if(rootState === 'crowded') break
                if(rootState === 'candidate') {
                    candidateUrls = getSpaceFeedPostCandidateProfileUrls(node, timestamp)
                    candidateEvidenceByHref = mergeSpaceFeedCandidateEvidenceByHref(
                        candidateEvidenceByHref,
                        candidateUrls.candidateEvidenceByHref || {}
                    )
                    needsSourceResolution = needsSourceResolution || candidateUrls.needsSourceResolution === true
                }

                node = node.parentElement
            }

            candidateUrls = getNormalizedProfileHrefList(candidateUrls)
            candidateEvidenceByHref = normalizeSpaceFeedCandidateEvidenceByHref(candidateEvidenceByHref, candidateUrls)
            spaceFeedEntryCache.set(postKey, {
                postRoot,
                postUrl,
                candidateUrls,
                candidateEvidenceByHref,
                needsSourceResolution
            })
        }

        // Diagnostic, 23 Oct: the candidate count and the post's timestamp, kept on the card so a post that shows nothing can be traced.
        // Written only when the value changes, so it does not cause extra page updates.
        const diagValue = `${candidateUrls.length}|${(timestamp?.getAttribute('href') || '').slice(0, 40)}`
        if(postRoot.dataset.mbPostDiag !== diagValue) postRoot.dataset.mbPostDiag = diagValue

        // 30 Oct: a post that cites a short link is chased to the cited post, and its poster is the candidate. On a target space the sharer's
        // header is not the target, so the cited post replaces it. On an asset space the cited post is chased only when the post names no
        // profile of its own (Instant Block: "more often an example post that has to be chased").
        const citedFromAddress = isNukableSpacePage() ? getSpaceFeedCitedUrl(timestamp) : ''
        // 31 Oct: an asset post whose address names no cited link is chased to its question card instead (Instant Block).
        const citedFromCard = isNukableSpacePage() && isAssetSpacePage() && !citedFromAddress
            ? getSpaceFeedQuestionCardCitedUrl(timestamp)
            : ''
        const citedCandidate = citedFromAddress || citedFromCard
        const citedUrl = citedCandidate && (isTargetSpacePage() || !candidateUrls.length) ? citedCandidate : ''
        entries.push({
            postKey,
            postRoot,
            postUrl,
            candidateUrls: citedUrl ? [] : candidateUrls,
            candidateEvidenceByHref,
            resolveProfileFromPage: (isAssetSpacePage() && !!postUrl && needsSourceResolution) || !!citedUrl,
            resolutionUrl: citedUrl,
            resolutionSubject: citedUrl ? RESOLUTION_SUBJECT_POSTER : '',
            resolutionReason: citedUrl ? 'target-post-cites-source' : (needsSourceResolution ? 'low-confidence-profile-artifact' : '')
        })
    }

    entries.push(...getSpaceFeedProfileLinkCardEntries(activeKeys))
    entries.push(...getSpaceFeedQuestionRowEntries())

    for(const [postKey, cached] of spaceFeedEntryCache) {
        if(!activeKeys.has(postKey) || !cached?.postRoot?.isConnected) {
            spaceFeedEntryCache.delete(postKey)
            if(cached?.postRoot) {
                spaceFeedNearObserver?.unobserve(cached.postRoot)
                spaceFeedNearPostRoots.delete(cached.postRoot)
            }
        }
    }

    // 24 Oct: a post seen for the first time was read before the observer had reported where it is, so it was not drawn. One more redraw,
    // after the observer has reported, draws it. A post is new only once, so this does not repeat.
    if(newlyObservedRoots && getPageType() === 'space') scheduleSpaceAssetNukeControls(120)

    return entries
}

function buildSpaceFeedEntrySnapshot(entry, previous = null) {
    const previousUrls = getNormalizedProfileHrefList(previous?.candidateUrls || [])
    const currentUrls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
    const viewport = readSpaceFeedEntryViewport(entry?.postRoot, previous)

    return {
        postKey: entry?.postKey || previous?.postKey || '',
        postUrl: entry?.postUrl || previous?.postUrl || '',
        candidateUrls: getNormalizedProfileHrefList([...previousUrls, ...currentUrls]),
        candidateEvidenceByHref: mergeSpaceFeedCandidateEvidenceByHref(
            previous?.candidateEvidenceByHref || {},
            entry?.candidateEvidenceByHref || {}
        ),
        resolveProfileFromPage: !!(entry?.resolveProfileFromPage || previous?.resolveProfileFromPage),
        resolutionReason: entry?.resolutionReason || previous?.resolutionReason || '',
        resolutionUrl: entry?.resolutionUrl || previous?.resolutionUrl || '',
        resolutionSubject: entry?.resolutionSubject || previous?.resolutionSubject || '',
        postRoot: entry?.postRoot?.isConnected
            ? entry.postRoot
            : previous?.postRoot?.isConnected
                ? previous.postRoot
                : null,
        viewportTop: viewport.viewportTop,
        viewportBottom: viewport.viewportBottom
    }
}

function rememberDiscoveredSpaceFeedEntries(entries) {
    for(const entry of Array.isArray(entries) ? entries : []) {
        if(!entry?.postKey) continue

        const snapshot = buildSpaceFeedEntrySnapshot(entry, discoveredSpaceFeedEntries.get(entry.postKey))
        if(!snapshot.candidateUrls.length && !snapshot.resolveProfileFromPage) continue

        discoveredSpaceFeedEntries.set(snapshot.postKey, snapshot)
    }
}

function getDiscoveredSpaceFeedEntries() {
    return Array.from(discoveredSpaceFeedEntries.values()).map(entry => ({
        ...getUpdatedSpaceFeedEntryViewport(entry),
        postKey: entry.postKey,
        postUrl: entry.postUrl,
        candidateUrls: [...entry.candidateUrls],
        candidateEvidenceByHref: entry.candidateEvidenceByHref || {},
        resolveProfileFromPage: !!entry.resolveProfileFromPage,
        resolutionReason: entry.resolutionReason || '',
        resolutionUrl: entry.resolutionUrl || '',
        resolutionSubject: entry.resolutionSubject || '',
        postRoot: entry.postRoot || null
    }))
}

function setLatestSpaceFeedEntries(entries) {
    // 24 Oct: only a post in this scan can be near the viewport. Every other post keeps its last reading, so no position is read for it.
    const scannedRoots = new Set((Array.isArray(entries) ? entries : []).map(entry => entry?.postRoot).filter(Boolean))
    const priorByKey = new Map(latestSpaceFeedEntries.map(entry => [entry.postKey, entry]))
    rememberDiscoveredSpaceFeedEntries(entries)
    latestSpaceFeedEntries = getDiscoveredSpaceFeedEntries().map(entry => {
        const prior = priorByKey.get(entry?.postKey) || null
        const viewport = scannedRoots.has(entry?.postRoot)
            ? readSpaceFeedEntryViewport(entry?.postRoot, entry)
            : {viewportTop: prior?.viewportTop ?? entry?.viewportTop ?? null, viewportBottom: prior?.viewportBottom ?? entry?.viewportBottom ?? null}

        return {
            postKey: entry?.postKey || '',
            postUrl: entry?.postUrl || '',
            candidateUrls: getNormalizedProfileHrefList(entry?.candidateUrls || []),
            resolveProfileFromPage: !!entry?.resolveProfileFromPage,
            resolutionReason: entry?.resolutionReason || '',
            resolutionUrl: entry?.resolutionUrl || '',
            resolutionSubject: entry?.resolutionSubject || '',
            postRoot: entry?.postRoot || null,
            viewportTop: viewport.viewportTop,
            viewportBottom: viewport.viewportBottom
        }
    }).filter(entry => !!entry.postKey)
}

function getLatestSpaceFeedEntries() {
    return latestSpaceFeedEntries.map(entry => ({
        ...getUpdatedSpaceFeedEntryViewport(entry),
        postKey: entry.postKey,
        postUrl: entry.postUrl,
        candidateUrls: [...entry.candidateUrls],
        resolveProfileFromPage: !!entry.resolveProfileFromPage,
        resolutionReason: entry.resolutionReason || '',
        resolutionUrl: entry.resolutionUrl || '',
        resolutionSubject: entry.resolutionSubject || ''
    }))
}

// Owner, 24 Oct: a post's position is read from the layout only while it is near the viewport. Otherwise the last reading is kept, so a
// render does not force a layout read for every post on the page.
function readSpaceFeedEntryViewport(postRoot, previous = null) {
    if(postRoot?.isConnected && isSpaceFeedPostRootNear(postRoot)) {
        const rect = postRoot.getBoundingClientRect()
        return {viewportTop: rect.top, viewportBottom: rect.bottom}
    }

    return {
        viewportTop: previous?.viewportTop ?? null,
        viewportBottom: previous?.viewportBottom ?? null
    }
}

function getUpdatedSpaceFeedEntryViewport(entry) {
    return {
        viewportTop: entry?.viewportTop ?? null,
        viewportBottom: entry?.viewportBottom ?? null
    }
}

function getSpaceFeedDetectionSnapshot(entries = null) {
    const space = resolveCurrentSpaceDescriptor()
    const category = getStoredSpaceCategory(space) || 'unset'
    const timestamps = getVisibleSpaceFeedTimestamps()
    const documentTimestamps = document.querySelectorAll('a.post_timestamp, a.answer_timestamp').length
    const documentProfiles = document.querySelectorAll('a[href*="/profile/"]').length
    const cards = getSpaceFeedCardRoots()
    if(!Array.isArray(entries)) {
        rememberDiscoveredSpaceFeedEntries(getSpaceFeedPostEntries())
    }
    const nextEntries = Array.isArray(entries) ? entries : getDiscoveredSpaceFeedEntries()
    const actionableEntries = nextEntries.filter(entry =>
        entry.candidateUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES ||
        isQueueableSpaceFeedResolverEntry(entry) ||
        isResolvableSpaceFeedEntry(entry)
    )
    const pendingEntries = getPendingSpaceFeedEntries(actionableEntries)
    const expectedPostButtons = getExpectedSpaceFeedPostButtonCount(nextEntries)
    const actionableUrls = getDedupedSpaceFeedUrls(actionableEntries)
    const trackedCandidateCount = actionableUrls.filter(url => !!getProfileNukeProgressRecord(url)).length

    return {
        pageType: getPageType() || 'unknown',
        category,
        timestamps: timestamps.length,
        documentTimestamps,
        documentProfiles,
        cards: cards.length,
        entries: nextEntries.length,
        actionable: actionableEntries.length,
        actionableEntries,
        storedProgressRecords: Object.keys(profileNukeProgress || {}).length,
        trackedCandidates: trackedCandidateCount,
        actionableCandidates: actionableUrls.length,
        pending: pendingEntries.length,
        expectedPostButtons,
        topButton: !!document.querySelector('.mb-ext_space-feed-nuke-btn'),
        postButtons: document.querySelectorAll('.mb-ext_space-feed-post-nuke-btn').length,
        stateRefresh: {
            ...spaceFeedStateRefreshStatus,
            ageMs: spaceFeedStateRefreshStatus.finishedAt ? Date.now() - spaceFeedStateRefreshStatus.finishedAt : null,
            knownNukedProfiles: spaceFeedKnownNukedProfileKeys.size,
            answeredProfiles: spaceFeedAnsweredProfileKeys.size
        }
    }
}

function formatSpaceFeedStatusLabel(snapshot) {
    return 'MB Info'
}

function getExtensionVersion() {
    try {
        return browser?.runtime?.getManifest?.().version ||
            globalThis.chrome?.runtime?.getManifest?.().version ||
            'unknown'
    }
    catch {
        return 'unknown'
    }
}

function formatSpaceFeedStatusSummary(snapshot) {
    return [
        `extension_version: ${getExtensionVersion()}`,
        `page: ${snapshot.pageType}`,
        `category: ${snapshot.category}`,
        `timestamps: ${snapshot.timestamps}`,
        `document_timestamps: ${snapshot.documentTimestamps}`,
        `document_profiles: ${snapshot.documentProfiles}`,
        `cards: ${snapshot.cards}`,
        `entries: ${snapshot.entries}`,
        `actionable: ${snapshot.actionable}`,
        `actionable_candidates: ${snapshot.actionableCandidates}`,
        `stored_progress_records: ${snapshot.storedProgressRecords}`,
        `state_refresh: outcome=${snapshot.stateRefresh.outcome} age=${formatDurationMs(snapshot.stateRefresh.ageMs)} requested=${snapshot.stateRefresh.requested} records=${snapshot.stateRefresh.records} retries_waiting=${snapshot.stateRefresh.retriesWaiting}`,
        `known_nuked_profiles: ${snapshot.stateRefresh.knownNukedProfiles}`,
        `answered_profiles: ${snapshot.stateRefresh.answeredProfiles}`,
        `tracked_candidates: ${snapshot.trackedCandidates}`,
        `pending: ${snapshot.pending}`,
        `expected_post_buttons: ${snapshot.expectedPostButtons}`,
        `top_button: ${snapshot.topButton}`,
        `post_buttons: ${snapshot.postButtons}`
    ].join('\n')
}

function getProfileProgressTime(record, key) {
    const value = Number(record?.[key])
    return Number.isFinite(value) && value > 0 ? value : 0
}

function getPositiveDurationMs(start, end) {
    return Number.isFinite(start) && start > 0 && Number.isFinite(end) && end >= start
        ? end - start
        : null
}

function formatDurationMs(value) {
    if(!Number.isFinite(value)) return 'n/a'
    if(value < 1000) return `${Math.round(value)}ms`
    return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`
}

function formatDurationValueMs(value) {
    return Number.isFinite(value) ? `${Math.round(value)}` : ''
}

function getProfileProgressOutcome(record) {
    if(!record) return 'none'
    if(isSuccessfulProfileNukeRecord(record)) return record.status === 'already-blocked' ? 'already-blocked' : 'blocked'
    if(record.status === 'profile-unavailable') return 'profile-unavailable'
    if(isSecurityVerificationProgressRecord(record)) return 'security-verification'
    if(record.blockError) return `block-error:${record.blockError}`
    if(record.muteError) return `mute-error:${record.muteError}`
    if(record.finalError) return `error:${record.finalError}`
    return record.status || 'unknown'
}

function getProfileProgressPhaseDurations(record) {
    const queuedAt = getProfileProgressTime(record, 'queuedAt')
    const tabCreatedAt = getProfileProgressTime(record, 'tabCreatedAt') || getProfileProgressTime(record, 'tabOpenedAt')
    const contentOpenedAt = getProfileProgressTime(record, 'contentOpenedAt')
    const actionReadyAt = getProfileProgressTime(record, 'actionReadyAt')
    const muteAttemptedAt = getProfileProgressTime(record, 'muteAttemptedAt')
    const mutedAt = getProfileProgressTime(record, 'mutedAt')
    const blockAttemptedAt = getProfileProgressTime(record, 'blockAttemptedAt')
    const blockedAt = getProfileProgressTime(record, 'blockedAt')
    const terminalAt = getProfileProgressTime(record, 'terminalAt')
    const slotReleasedAt = getProfileProgressTime(record, 'slotReleasedAt')
    const closeRequestedAt = getProfileProgressTime(record, 'closeRequestedAt')
    const tabClosedAt = getProfileProgressTime(record, 'tabClosedAt')

    return {
        queueWaitMs: getPositiveDurationMs(queuedAt, tabCreatedAt),
        contentOpenMs: getPositiveDurationMs(tabCreatedAt, contentOpenedAt),
        profileReadyMs: getPositiveDurationMs(contentOpenedAt || tabCreatedAt, actionReadyAt),
        muteMs: getPositiveDurationMs(muteAttemptedAt, mutedAt),
        blockMs: getPositiveDurationMs(blockAttemptedAt, blockedAt),
        totalMs: getPositiveDurationMs(queuedAt, terminalAt || tabClosedAt || slotReleasedAt),
        slotReleaseMs: getPositiveDurationMs(terminalAt, slotReleasedAt),
        closeMs: getPositiveDurationMs(closeRequestedAt, tabClosedAt)
    }
}

function getDurationStats(values) {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
    if(!sorted.length) return null

    const percentile = ratio => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]
    const sum = sorted.reduce((total, value) => total + value, 0)
    return {
        count: sorted.length,
        avg: sum / sorted.length,
        p50: percentile(0.5),
        p90: percentile(0.9),
        max: sorted[sorted.length - 1]
    }
}

function formatDurationStats(label, values) {
    const stats = getDurationStats(values)
    if(!stats) return `${label}: none`
    return `${label}: count=${stats.count} avg=${formatDurationMs(stats.avg)} p50=${formatDurationMs(stats.p50)} p90=${formatDurationMs(stats.p90)} max=${formatDurationMs(stats.max)}`
}

function getSpaceFeedTimingRecords(snapshot) {
    const recordsByHref = new Map()
    const actionableEntries = Array.isArray(snapshot?.actionableEntries) ? snapshot.actionableEntries : []

    for(const entry of actionableEntries) {
        for(const url of getNormalizedProfileHrefList(entry.candidateUrls || [])) {
            if(recordsByHref.has(url)) continue
            const record = getProfileNukeProgressRecord(url)
            if(record) {
                recordsByHref.set(url, record)
            }
        }
    }

    return Array.from(recordsByHref.entries()).map(([url, record]) => ({url, record}))
}

function formatSpaceFeedTimingSummary(snapshot) {
    const records = getSpaceFeedTimingRecords(snapshot)
    const runRecords = records.filter(item => item.record?.runId)
    const latestRunId = runRecords
        .map(item => item.record)
        .sort((left, right) => (getProfileProgressTime(right, 'queuedAt') - getProfileProgressTime(left, 'queuedAt')) || `${right.runId}`.localeCompare(`${left.runId}`))[0]?.runId || ''
    const scoped = latestRunId
        ? runRecords.filter(item => item.record.runId === latestRunId)
        : records

    if(!scoped.length) return 'timing_summary: none'

    const phaseRows = scoped.map(item => ({
        ...item,
        phases: getProfileProgressPhaseDurations(item.record),
        outcome: getProfileProgressOutcome(item.record)
    }))
    const outcomeCounts = new Map()
    for(const row of phaseRows) {
        outcomeCounts.set(row.outcome, (outcomeCounts.get(row.outcome) || 0) + 1)
    }

    const lines = [
        `timing_run_id: ${latestRunId || 'unscoped'}`,
        `timing_profiles: ${phaseRows.length}`,
        `timing_outcomes: ${Array.from(outcomeCounts.entries()).map(([key, count]) => `${key}=${count}`).join(', ')}`
    ]

    const phaseKeys = [
        ['timing_queue_wait', 'queueWaitMs'],
        ['timing_content_open', 'contentOpenMs'],
        ['timing_profile_ready', 'profileReadyMs'],
        ['timing_mute', 'muteMs'],
        ['timing_block', 'blockMs'],
        ['timing_total', 'totalMs'],
        ['timing_slot_release', 'slotReleaseMs'],
        ['timing_close', 'closeMs']
    ]

    for(const [label, key] of phaseKeys) {
        lines.push(formatDurationStats(label, phaseRows.map(row => row.phases[key])))
    }

    const slowest = phaseRows
        .filter(row => Number.isFinite(row.phases.totalMs))
        .sort((left, right) => right.phases.totalMs - left.phases.totalMs)
        .slice(0, 10)

    if(slowest.length) {
        lines.push('timing_slowest_profiles:')
        for(const row of slowest) {
            lines.push(`- ${row.url} outcome=${row.outcome} queue_index=${row.record.queueIndex || ''} total=${formatDurationMs(row.phases.totalMs)} queue=${formatDurationMs(row.phases.queueWaitMs)} open=${formatDurationMs(row.phases.contentOpenMs)} ready=${formatDurationMs(row.phases.profileReadyMs)} mute=${formatDurationMs(row.phases.muteMs)} block=${formatDurationMs(row.phases.blockMs)}`)
        }
    }

    return lines.join('\n')
}

// Diagnostic, 23 Oct: what each button shows right now, read from the page, so the report matches what the owner sees.
function describeSpaceFeedPostButtonState(button) {
    if(!button) return 'no-button'
    if(getComputedStyle(button).display === 'none') return 'hidden'

    const text = (button.textContent || '').trim()
    if(/^nuked/i.test(text)) return 'nuked'
    if(/^nuking/i.test(text)) return 'nuking'
    if(/^mute-block$/i.test(text) && !button.disabled) return 'red'
    return 'grey'
}

function formatSpaceFeedButtonStates() {
    const globalButton = document.querySelector('.mb-ext_space-feed-nuke-btn')
    const hosts = Array.from(document.querySelectorAll('.mb-ext_space-feed-post-nuke-host'))
    const tally = {}
    const postLines = hosts.map((host, index) => {
        const single = host.querySelector('.mb-ext_space-feed-post-nuke-btn')
        const queue = host.querySelector('.mb-ext_space-feed-post-queue-btn')
        const state = describeSpaceFeedPostButtonState(single)
        tally[state] = (tally[state] || 0) + 1
        const queueShown = queue && getComputedStyle(queue).display !== 'none' ? (queue.textContent || '').trim() : 'hidden'
        return `- post_${index + 1}: ${state} | queue: ${queueShown} | ${single?.dataset.mbDiag || 'no diagnostic'}`
    })

    return [
        'button_states:',
        `- global: ${globalButton ? `${(globalButton.textContent || '').trim()} disabled=${globalButton.disabled}` : 'none'}`,
        `- post_hosts: ${hosts.length} ${Object.entries(tally).map(([state, count]) => `${state}=${count}`).join(' ')}`,
        ...postLines
    ].join('\n')
}

function formatSpaceFeedStatusDetails(snapshot) {
    const lines = [
        'report_format: detailed-v2',
        `report_generated_at: ${new Date().toISOString()}`,
        '',
        formatSpaceFeedStatusSummary(snapshot),
        '',
        formatSpaceFeedButtonStates(),
        '',
        formatSpaceFeedTimingSummary(snapshot),
        '',
        formatSpaceFeedButtonTrace(),
        '',
        formatSpaceQueryStats()
    ]

    const actionableEntries = Array.isArray(snapshot?.actionableEntries) ? snapshot.actionableEntries : []
    if(!actionableEntries.length) {
        lines.push('', 'actionable_entries: none')
        return lines.join('\n')
    }

    lines.push('', `actionable_entries: ${actionableEntries.length}`)

    actionableEntries.forEach((entry, index) => {
        lines.push('')
        lines.push(`entry_${index + 1}_post_key: ${entry.postKey || ''}`)
        lines.push(`entry_${index + 1}_post_url: ${entry.postUrl || ''}`)

        const urls = getNormalizedProfileHrefList(entry.candidateUrls || [])
        if(!urls.length) {
            lines.push(`entry_${index + 1}_urls: none`)
            return
        }

        lines.push(`entry_${index + 1}_urls: ${urls.length}`)
        for(const [urlIndex, url] of urls.entries()) {
            const name = getProfileDisplayName(url)
            const record = getProfileNukeProgressRecord(url)
            const prefix = `entry_${index + 1}_candidate_${urlIndex + 1}`

            lines.push(`${prefix}_url: ${url}`)
            if(name) {
                lines.push(`${prefix}_name: ${name}`)
            }

            if(!record) {
                lines.push(`${prefix}_progress: none`)
                continue
            }

            lines.push(`${prefix}_status: ${record.status || 'unknown'}`)
            lines.push(`${prefix}_outcome: ${getProfileProgressOutcome(record)}`)
            if(record.runId) lines.push(`${prefix}_run_id: ${record.runId}`)
            if(record.queueIndex) lines.push(`${prefix}_queue_index: ${record.queueIndex}`)
            if(record.retryAttempt) lines.push(`${prefix}_retry_attempt: ${record.retryAttempt}`)
            if(record.maxRetries !== undefined) lines.push(`${prefix}_max_retries: ${record.maxRetries}`)
            lines.push(`${prefix}_found_blocked_before_queue: ${!!record.foundBlockedBeforeQueue}`)
            lines.push(`${prefix}_tab_opened: ${!!record.tabOpenedAt}`)
            lines.push(`${prefix}_opened_viable_page: ${!!record.openedViablePage}`)
            lines.push(`${prefix}_mute_attempted: ${!!record.muteAttempted}`)
            lines.push(`${prefix}_mute_succeeded: ${!!record.muteSucceeded}`)
            lines.push(`${prefix}_block_attempted: ${!!record.blockAttempted}`)
            lines.push(`${prefix}_block_succeeded: ${!!record.blockSucceeded}`)
            lines.push(`${prefix}_closed: ${!!record.tabClosedAt}`)

            const phases = getProfileProgressPhaseDurations(record)
            lines.push(`${prefix}_queue_wait_ms: ${formatDurationValueMs(phases.queueWaitMs)}`)
            lines.push(`${prefix}_content_open_ms: ${formatDurationValueMs(phases.contentOpenMs)}`)
            lines.push(`${prefix}_profile_ready_ms: ${formatDurationValueMs(phases.profileReadyMs)}`)
            lines.push(`${prefix}_mute_ms: ${formatDurationValueMs(phases.muteMs)}`)
            lines.push(`${prefix}_block_ms: ${formatDurationValueMs(phases.blockMs)}`)
            lines.push(`${prefix}_total_ms: ${formatDurationValueMs(phases.totalMs)}`)
            lines.push(`${prefix}_slot_release_ms: ${formatDurationValueMs(phases.slotReleaseMs)}`)
            lines.push(`${prefix}_close_ms: ${formatDurationValueMs(phases.closeMs)}`)

            if(record.lastUrl) lines.push(`${prefix}_last_url: ${record.lastUrl}`)
            if(record.resolvedProfileHref) lines.push(`${prefix}_resolved_profile_url: ${record.resolvedProfileHref}`)
            if(record.remappedFromRequested !== undefined) lines.push(`${prefix}_remapped_from_requested: ${!!record.remappedFromRequested}`)
            if(record.errorPageUrl) lines.push(`${prefix}_error_page_url: ${record.errorPageUrl}`)
            if(record.closeReason) lines.push(`${prefix}_close_reason: ${record.closeReason}`)
            if(record.closedByExtension !== undefined) lines.push(`${prefix}_closed_by_extension: ${!!record.closedByExtension}`)
            if(record.unavailableReason) lines.push(`${prefix}_unavailable_reason: ${record.unavailableReason}`)
            if(record.muteError) lines.push(`${prefix}_mute_error: ${record.muteError}`)
            if(record.blockError) lines.push(`${prefix}_block_error: ${record.blockError}`)
            if(record.finalError) lines.push(`${prefix}_final_error: ${record.finalError}`)
            lines.push(`${prefix}_security_verification: ${isSecurityVerificationProgressRecord(record)}`)
            if(record.securityVerification && !isSecurityVerificationProgressRecord(record)) {
                lines.push(`${prefix}_raw_security_verification: true`)
            }

            if(Array.isArray(record.events) && record.events.length) {
                lines.push(`${prefix}_events:`)
                for(const event of record.events) {
                    lines.push(`- ${event}`)
                }
            }
        }
    })

    return lines.join('\n')
}

async function copyTextToClipboard(text) {
    const normalized = `${text || ''}`
    if(!normalized) return false

    try {
        if(navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(normalized)
            return true
        }
    }
    catch {}

    try {
        const textarea = document.createElement('textarea')
        textarea.value = normalized
        textarea.setAttribute('readonly', 'readonly')
        textarea.style.position = 'fixed'
        textarea.style.top = '-1000px'
        textarea.style.left = '-1000px'
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        textarea.remove()
        return copied
    }
    catch {
        return false
    }
}

function getCopyableReportOverlay() {
    let overlay = document.querySelector('.mb-ext_copyable-report')
    if(overlay) {
        return {
            overlay,
            title: overlay.querySelector('.mb-ext_copyable-report-title'),
            status: overlay.querySelector('.mb-ext_copyable-report-status'),
            textarea: overlay.querySelector('.mb-ext_copyable-report-text')
        }
    }

    overlay = document.createElement('div')
    overlay.className = 'mb-ext_copyable-report'
    overlay.style.position = 'fixed'
    overlay.style.zIndex = '2147483647'
    overlay.style.top = '16px'
    overlay.style.right = '16px'
    overlay.style.width = 'min(720px, calc(100vw - 32px))'
    overlay.style.maxHeight = 'min(80vh, 900px)'
    overlay.style.background = '#fff'
    overlay.style.color = '#111'
    overlay.style.border = '1px solid #d1d5db'
    overlay.style.borderRadius = '12px'
    overlay.style.boxShadow = '0 12px 32px rgba(0,0,0,0.28)'
    overlay.style.padding = '12px'
    overlay.style.display = 'flex'
    overlay.style.flexDirection = 'column'
    overlay.style.gap = '8px'

    const header = document.createElement('div')
    header.style.display = 'flex'
    header.style.alignItems = 'center'
    header.style.justifyContent = 'space-between'
    header.style.gap = '12px'

    const headerText = document.createElement('div')
    headerText.style.minWidth = '0'

    const title = document.createElement('div')
    title.className = 'mb-ext_copyable-report-title'
    title.style.fontWeight = '700'
    title.style.fontSize = '14px'
    title.style.lineHeight = '1.3'

    const status = document.createElement('div')
    status.className = 'mb-ext_copyable-report-status'
    status.style.fontSize = '12px'
    status.style.color = '#4b5563'
    status.style.marginTop = '2px'

    headerText.appendChild(title)
    headerText.appendChild(status)

    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close'
    close.style.border = 'none'
    close.style.borderRadius = '999px'
    close.style.background = '#111'
    close.style.color = '#fff'
    close.style.padding = '6px 10px'
    close.style.cursor = 'pointer'
    setMuteBlockHelp(close, 'Close this dialog')
    close.addEventListener('click', () => overlay.remove())

    header.appendChild(headerText)
    header.appendChild(close)

    const textarea = document.createElement('textarea')
    textarea.className = 'mb-ext_copyable-report-text'
    textarea.readOnly = true
    textarea.style.width = '100%'
    textarea.style.minHeight = '280px'
    textarea.style.flex = '1 1 auto'
    textarea.style.resize = 'vertical'
    textarea.style.border = '1px solid #d1d5db'
    textarea.style.borderRadius = '8px'
    textarea.style.padding = '10px'
    textarea.style.font = '12px/1.4 monospace'
    textarea.style.whiteSpace = 'pre'
    textarea.style.background = '#f9fafb'
    textarea.style.color = '#111'

    overlay.appendChild(header)
    overlay.appendChild(textarea)
    document.body.appendChild(overlay)

    return {overlay, title, status, textarea}
}

async function showCopyableText(title, text) {
    const message = `${title}\n\n${text}`
    console.info(message)
    const copied = await copyTextToClipboard(message)
    const report = getCopyableReportOverlay()

    report.title.textContent = title
    report.status.textContent = copied ? 'Copied to clipboard.' : 'Clipboard copy failed. Manual copy is still available below.'
    report.textarea.value = message
    report.textarea.focus()
    report.textarea.setSelectionRange(0, 0)
    report.textarea.scrollTop = 0
}

function syncSpaceFeedStatusButton(entries = null) {
    if(getPageType() !== 'space') return false

    const host = getSpaceFeedStatusHost()
    if(!host) return false

    // MB Info is for asset and target spaces only. A space with no stored category is neutral, so most spaces (which have none)
    // get no MB Info and need no classification. Any copy left from before is removed (30 Oct; no-category rule, 31 Oct).
    const space = resolveCurrentSpaceDescriptor()
    const category = space ? getStoredSpaceCategory(space) : ''
    if(category !== 'asset' && category !== 'target') {
        host.querySelector('.mb-ext_space-feed-status-btn')?.remove()
        return false
    }

    let button = host.querySelector('.mb-ext_space-feed-status-btn')

    if(!button) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'mb-ext_space-feed-status-btn'
        button.addEventListener('click', () => {
            scheduleSpaceAssetNukeControls(0)
            void showCopyableText('Mute Block Extension Info:',formatSpaceFeedStatusDetails(getSpaceFeedDetectionSnapshot()))
        })
        host.appendChild(button)
    }

    button.textContent = formatSpaceFeedStatusLabel(entries)
    setMuteBlockHelp(button, `Version ${getExtensionVersion()}. Click for more.`)
    return true
}




function getResolvedSpaceFeedProfileHrefs(profileHref = '') {
    const hrefs = []
    const seen = new Set()
    const addHref = href => {
        const normalizedHref = normalizeQuoraProfileHref(href)
        if(!normalizedHref || seen.has(normalizedHref)) return
        seen.add(normalizedHref)
        hrefs.push(normalizedHref)
    }

    addHref(profileHref)

    if(getPageType() === 'profile') {
        addHref(location.href)
    }

    return hrefs
}

function getQueuedProfileRemapTarget(profileHref = '') {
    const requestedHref = normalizeQuoraProfileHref(profileHref)
    const resolvedHref = getPageType() === 'profile'
        ? normalizeQuoraProfileHref(location.href)
        : ''

    if(!requestedHref || !resolvedHref || requestedHref === resolvedHref) {
        return ''
    }

    return resolvedHref
}

function isSourcePostResolutionReason(reason = '') {
    return [
        'failed-target-source-post-revisit',
        'manual-source-post-retest',
        'source-post-needs-profile-resolution'
    ].includes(`${reason || ''}`.trim())
}

// Records in the sink which step gave the resolved profile: header, inline, scored, explicit, listed or url. The href is the same
// with or without a sink (owner, 15 Oct: the live-check card counts the steps).
function noteQueuedResolution(sink, source, href) {
    if(sink) sink.source = href ? source : ''
    return href
}

function getQueuedPageResolvedProfileHref(claimedAction = {}, sink = null) {
    const pageType = getPageType()
    if(pageType === 'profile') return noteQueuedResolution(sink, 'url', normalizeQuoraProfileHref(location.href))
    if(pageType === 'space-post') {
        const resolutionReason = `${claimedAction?.resolutionReason || ''}`.trim()
        const explicitProfileHref = getSingleSpacePostResolutionProfileHref({explicitOnly: true})
        const isQueuedResolution = claimedAction?.resolveProfileFromPage === true ||
            `${claimedAction?.resolutionMode || ''}`.trim() === QUEUED_PROFILE_RESOLUTION_MODE ||
            isSourcePostResolutionReason(resolutionReason)
        if(resolutionReason === 'low-confidence-profile-artifact') {
            return noteQueuedResolution(sink, 'explicit', explicitProfileHref)
        }
        if(isQueuedResolution) {
            // 30 Oct: the queue item says what it is chasing. A named-profile item reads the profile the post names, and a poster item reads the
            // poster from the page, whatever the category of the space the item came from.
            const subject = normalizeResolutionSubject(claimedAction?.resolutionSubject)
            if(subject === RESOLUTION_SUBJECT_NAMED_PROFILES) return noteQueuedResolution(sink, 'explicit', explicitProfileHref)
            if(subject !== RESOLUTION_SUBJECT_POSTER && isAssetSpacePage()) return noteQueuedResolution(sink, 'explicit', explicitProfileHref)

            const queuedHeaderHref = getSpacePostHeaderProfileHref()
            if(queuedHeaderHref) return noteQueuedResolution(sink, 'header', queuedHeaderHref)

            const queuedOriginalPosterSink = {}
            const queuedOriginalPosterHref = getOriginalPosterProfileHref(queuedOriginalPosterSink)
            if(queuedOriginalPosterHref) {
                return noteQueuedResolution(sink, queuedOriginalPosterSink.source || 'scored', queuedOriginalPosterHref)
            }

            return noteQueuedResolution(sink, 'explicit', explicitProfileHref)
        }
        const listedProfileLinks = getSpacePostListedProfileLinks()
        if(listedProfileLinks.length === 1) return noteQueuedResolution(sink, 'listed', listedProfileLinks[0])

        const headerProfileHref = getSpacePostHeaderProfileHref()
        if(headerProfileHref) return noteQueuedResolution(sink, 'header', headerProfileHref)

        return getOriginalPosterProfileHref(sink)
    }
    if(pageType === 'question' || pageType === 'question-log') {
        return getOriginalPosterProfileHref(sink)
    }

    return null
}

function canResolveQueuedProfileFromCurrentPage(claimedAction = {}) {
    if(getPageType() === 'profile') return false
    if(isSecurityVerificationPage() || getProfileUnavailableReason()) return false

    const mode = `${claimedAction?.resolutionMode || ''}`.trim()
    if(mode === QUEUED_PROFILE_RESOLUTION_MODE || claimedAction?.resolveProfileFromPage === true) {
        return true
    }

    return ['question', 'question-log', 'space-post'].includes(getPageType())
}

function removeSpaceFeedNukeButtons() {
    for(const host of Array.from(document.querySelectorAll('.mb-ext_space-feed-nuke-host, .mb-ext_space-feed-post-nuke-host'))) {
        host.remove()
    }

    for(const root of getSpaceFeedMarkedRoots()) {
        delete root.dataset.mbSpaceFeedPostKey
    }
    spaceFeedMarkedRoots.clear()
}

function removeSpaceFeedNukeControls() {
    removeSpaceFeedNukeButtons()
    document.querySelector('.mb-ext_space-feed-status-host')?.remove()

    const main = document.querySelector('#mainContent')
    if(main) delete main.dataset.mbSpaceFeedCardCount
    if(main) delete main.dataset.mbSpaceFeedEntryCount
    if(main) delete main.dataset.mbSpaceFeedPostButtonCount
    if(main) delete main.dataset.mbSpaceFeedTimestampCount
}

function getExpectedSpaceFeedPostButtonCount(entries) {
    const list = Array.isArray(entries) ? entries : []

    return list.filter(entry => {
        if(isSpaceFeedEntryNuked(entry)) return true

        const queueableUrls = getQueueableSpaceFeedEntryUrls(entry)
        const hasCandidates = queueableUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES ||
            isQueueableSpaceFeedResolverEntry(entry)
        const postBusy = isSpaceFeedPostBusy(entry.postKey)
        return hasCandidates || postBusy
    }).length
}

function getPendingSpaceFeedEntries(entries) {
    return entries.filter(entry => entry.candidateUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES && isSpaceFeedPostPending(entry.postKey))
}

function isSpaceFeedPostSettled(entry) {
    const urls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
    return urls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES && urls.every(url => isProfileNukeRetryBlocked(url))
}

function scheduleSpaceFeedProgressReconciliation(entries = null, delay = 80) {
    if(spaceFeedProgressReconcilePending && delay !== 0) return

    spaceFeedProgressReconcilePending = true
    clearTimeout(spaceFeedProgressReconcileTimeout)
    spaceFeedProgressReconcileTimeout = setTimeout(() => {
        void (async () => {
            try {
                const list = Array.isArray(entries) ? entries : getSpaceFeedPostEntries()
                const completedEntries = list.filter(entry => !isSpaceFeedEntryNuked(entry) && isSpaceFeedPostEffectivelyNuked(entry))
                if(!completedEntries.length) return

                const succeededUrls = getDedupedSpaceFeedUrls(completedEntries.map(entry => ({
                    ...entry,
                    candidateUrls: getSucceededSpaceFeedEntryUrls(entry)
                })))

                if(succeededUrls.length) {
                    await safeSendRuntimeMessageWithTimeout({
                        action: 'settle-terminal-coordinator-items',
                        profileHrefs: succeededUrls
                    }, null, 2500)
                }
            }
            finally {
                spaceFeedProgressReconcilePending = false
                spaceFeedProgressReconcileTimeout = null
            }
        })()
    }, Math.max(0, delay))
}

function getLiveSpaceFeedEntryUrls(entry) {
    if(!entry?.postKey || isSpaceFeedEntryNuked(entry)) return []

    const pendingUrls = Array.from(getPendingSpaceFeedUrlSet(entry.postKey))
        .filter(url => !isProfileNukeSucceeded(url))
    const queueableUrls = getQueueableSpaceFeedEntryUrls(entry)
    return getNormalizedProfileHrefList([...pendingUrls, ...queueableUrls])
}

function getSpaceFeedEntryViewportPriority(entry) {
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
    const rect = entry?.postRoot?.getBoundingClientRect?.() || null
    const top = Number.isFinite(entry?.viewportTop) ? entry.viewportTop : rect?.top
    const bottom = Number.isFinite(entry?.viewportBottom) ? entry.viewportBottom : rect?.bottom

    if(!Number.isFinite(top)) {
        return {
            inViewport: false,
            distance: Number.POSITIVE_INFINITY,
            top: Number.POSITIVE_INFINITY
        }
    }

    const normalizedBottom = Number.isFinite(bottom) ? bottom : top
    const inViewport = normalizedBottom >= 0 && top <= viewportHeight
    const distance = inViewport
        ? 0
        : top > viewportHeight
            ? top - viewportHeight
            : Math.abs(normalizedBottom)

    return {inViewport, distance, top}
}

function orderSpaceFeedEntriesForNuking(entries) {
    return [...(entries || [])].sort((left, right) => {
        const leftPriority = getSpaceFeedEntryViewportPriority(left)
        const rightPriority = getSpaceFeedEntryViewportPriority(right)

        if(leftPriority.inViewport !== rightPriority.inViewport) {
            return leftPriority.inViewport ? -1 : 1
        }
        if(leftPriority.distance !== rightPriority.distance) {
            return leftPriority.distance - rightPriority.distance
        }
        if(leftPriority.top !== rightPriority.top) {
            return leftPriority.top - rightPriority.top
        }
        return `${left?.postKey || ''}`.localeCompare(`${right?.postKey || ''}`)
    })
}

function getLiveSpaceFeedEntries(entries) {
    return orderSpaceFeedEntriesForNuking(entries).flatMap(entry => {
        const liveUrls = getLiveSpaceFeedEntryUrls(entry)
        if(liveUrls.length < SPACE_FEED_POST_NUKE_MIN_PROFILES) {
            return isQueueableSpaceFeedResolverEntry(entry)
                ? [{
                    ...entry,
                    candidateUrls: [],
                    resolveProfileFromPage: true
                }]
                : []
        }

        return [{
            ...entry,
            candidateUrls: liveUrls
        }]
    })
}

function getQueueableSpaceFeedEntries(entries) {
    return entries.flatMap(entry => {
        const queueableUrls = getQueueableSpaceFeedEntryUrls(entry)
        if(queueableUrls.length < SPACE_FEED_POST_NUKE_MIN_PROFILES) {
            return isQueueableSpaceFeedResolverEntry(entry)
                ? [{
                    ...entry,
                    candidateUrls: [],
                    resolveProfileFromPage: true
                }]
                : []
        }

        return [{
            ...entry,
            candidateUrls: queueableUrls
        }]
    })
}

function getButtonFallbackSpaceFeedEntries(button) {
    const urls = getSpaceFeedButtonUrls(button)
    const entries = getSpaceFeedButtonEntries(button)
    if(entries.length) return entries
    if(!urls.length) return []

    return [{
        postKey: button?.dataset?.mbPostKey || '',
        postUrl: button?.dataset?.mbPostUrl || '',
        candidateUrls: urls
    }]
}

function getSpaceFeedEntriesMatchingUrls(entries, urls) {
    const urlSet = new Set(getNormalizedProfileHrefList(urls))
    if(!urlSet.size) return []

    return (Array.isArray(entries) ? entries : []).flatMap(entry => {
        const candidateUrls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
            .filter(url => urlSet.has(url) && !isProfileNukeRetryBlocked(url))
        if(!candidateUrls.length) return []

        return [{
            ...entry,
            candidateUrls
        }]
    })
}

function getClickedSpaceFeedEntries(button, currentEntries) {
    const buttonEntries = getSpaceFeedButtonEntries(button)
    if(buttonEntries.length) {
        return getLiveSpaceFeedEntries(buttonEntries)
    }

    const buttonUrls = getSpaceFeedButtonUrls(button)
    if(buttonUrls.length) {
        const matchedEntries = getSpaceFeedEntriesMatchingUrls(currentEntries, buttonUrls)
        if(matchedEntries.length) return getLiveSpaceFeedEntries(matchedEntries)

        return getButtonFallbackSpaceFeedEntries(button)
    }

    return getLiveSpaceFeedEntries(currentEntries)
}

function getDedupedSpaceFeedUrls(entries) {
    return getSpaceFeedProfilePostAssociations(entries).map(association => association.profileHref)
}

function getResolvableSpaceFeedPostAssociations(entries) {
    const associations = new Map()

    for(const entry of entries || []) {
        if(!isResolvableSpaceFeedEntry(entry)) continue
        if(getNormalizedProfileHrefList(entry.candidateUrls || []).length) continue

        const postKey = entry.postKey || ''
        // The chase goes to the resolution URL when the entry has one (a cited post or a question's log), else to the post itself (30 Oct).
        const postUrl = normalizeQuoraPostHref(entry.resolutionUrl || entry.postUrl || '')
        if(!postKey || !postUrl || associations.has(postKey)) continue

        associations.set(postKey, {
            profileHref: '',
            postKey,
            postUrl,
            postKeys: [postKey],
            postUrls: [postUrl],
            resolveProfileFromPage: true,
            resolutionMode: QUEUED_PROFILE_RESOLUTION_MODE,
            resolutionReason: entry.resolutionReason || 'source-post-needs-profile-resolution',
            // An asset post's resolution reads the profile the post names in its own text (30 Oct).
            resolutionSubject: entry.resolutionSubject || RESOLUTION_SUBJECT_NAMED_PROFILES,
            evidence: [{
                postKey,
                postUrl,
                collector: entry.resolutionReason === 'low-confidence-profile-artifact'
                    ? 'low-confidence-profile-artifact'
                    : 'source-post-resolution',
                confidence: SPACE_FEED_CANDIDATE_CONFIDENCE_LOW,
                resolutionReason: entry.resolutionReason || '',
                sourcePageUrl: location.href
            }]
        })
    }

    return Array.from(associations.values())
}

function getSpaceFeedProfilePostAssociations(entries) {
    const associations = new Map()

    for(const entry of entries) {
        const postKey = entry?.postKey || ''
        const postUrl = entry?.postUrl || ''
        const candidateEvidenceByHref = entry?.candidateEvidenceByHref || {}
        // Decision 12 (18 Oct): the post's full candidate list, normalized, goes on each evidence record written at enqueue.
        const postCandidateUrls = [...new Set((entry.candidateUrls || []).map(url => normalizeQuoraProfileHref(url)).filter(Boolean))]

        for(const url of entry.candidateUrls || []) {
            const normalized = normalizeQuoraProfileHref(url)
            if(!normalized) continue
            const candidateEvidence = candidateEvidenceByHref[normalized] ||
                candidateEvidenceByHref[url] ||
                makeSpaceFeedCandidateEvidence('profile-links', SPACE_FEED_CANDIDATE_CONFIDENCE_HIGH)

            let association = associations.get(normalized)
            if(!association) {
                association = {
                    profileHref: normalized,
                    candidateEvidence,
                    postKeys: [],
                    postUrls: [],
                    evidence: []
                }
                associations.set(normalized, association)
            }

            if(postKey && !association.postKeys.includes(postKey)) {
                association.postKeys.push(postKey)
            }
            if(postUrl && !association.postUrls.includes(postUrl)) {
                association.postUrls.push(postUrl)
            }

            const evidenceKey = `${postKey}|${postUrl}`
            if((postKey || postUrl) && !association.evidence.some(evidence => `${evidence.postKey}|${evidence.postUrl}` === evidenceKey)) {
                association.evidence.push({
                    postKey,
                    postUrl,
                    collector: candidateEvidence.collector || 'profile-links',
                    confidence: candidateEvidence.confidence || '',
                    source: candidateEvidence.source || '',
                    rawSlug: candidateEvidence.rawSlug || '',
                    sourcePageUrl: location.href,
                    ...(entry?.sourcePostUrl ? {sourcePostUrl: entry.sourcePostUrl} : {}),
                    ...(postCandidateUrls.length ? {candidateUrls: postCandidateUrls} : {})
                })
            }
        }
    }

    return Array.from(associations.values())
}

function formatSpaceFeedPreFilterBreakdown(preFilter) {
    const parts = []
    if(preFilter?.alreadyNuked) parts.push(`${preFilter.alreadyNuked} already nuked`)
    if(preFilter?.duplicateProfile) parts.push(`${preFilter.duplicateProfile} duplicate profile`)
    if(preFilter?.unqueueable) parts.push(`${preFilter.unqueueable} unresolvable`)
    return parts.join(', ')
}

// The service worker can legitimately outlive a chunk message's own response
// channel: a busy write chain can take long enough that the SW recycles
// mid-request. A respawned SW resumes and finishes the durable write
// (persistLastCoordinatorEnqueueSummary still runs), but nothing can ever
// call back on the original chrome.runtime.sendMessage connection, so
// awaiting it directly hangs forever -- confirmed live 2026-09-19 (a
// 657-candidate batch finished durably while the button stayed on
// "Nuking..." indefinitely, back when one batch was one message). Falling
// back to polling that same durable summary by runId once the direct
// response times out recovers the real outcome instead of leaving the
// caller stuck. Now used per-chunk by sendCoordinatorEnqueueChunked below,
// not just once for a whole batch -- the summary it recovers already
// reflects the durable running total through this chunk (see
// persistLastCoordinatorEnqueueSummary's runSummary handling in sw.js), not
// just this one chunk's own contribution.
async function waitForCoordinatorEnqueueSummary(runId, timeoutMs, intervalMs = SPACE_FEED_ENQUEUE_SUMMARY_POLL_INTERVAL_MS) {
    const deadline = Date.now() + timeoutMs
    while(Date.now() < deadline) {
        const stored = await safeStorageGet({[COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY]: null})
        const summary = stored[COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY]
        if(summary?.runId === runId) {
            return {
                queued: summary.queued,
                merged: summary.merged,
                executionQueued: 0,
                runId,
                durable: true,
                recoveredFromSummary: true
            }
        }
        await sleep(intervalMs)
    }
    return null
}

// Posts a large coordinator-items enqueue as several separate
// enqueue-coordinator-items messages, COORDINATOR_ENQUEUE_CHUNK_SIZE items
// at a time, instead of one big message -- see live-batch-fixes-worklist-
// 2026-09-19.md items 3/4 and coordinatorEnqueueChunking.js's header for
// why. This used to be sw.js's job: one message in, split internally in a
// tight awaited loop. That loop's chunks re-entered the shared serialized
// write chain via a pure microtask continuation with no real yield between
// them, so a big batch still monopolized that chain for its whole duration
// and starved every other pending durable write -- and the obvious fix
// (a timer-based yield between chunks) turned out to need the sw.js test
// harness's fake clock manually advanced everywhere that path is exercised,
// with a silent, hard-to-notice failure mode when a test doesn't (see
// COORDINATOR_ENQUEUE_CHUNK_THRESHOLD's comment in sw.js). Chunking here
// instead means the gap between two chunks is a real chrome.runtime.sendMessage
// round trip -- a genuine macrotask in production, and nothing that needs a
// clock in tests, since it's just two separate calls.
//
// payload carries the run/source/execute fields every chunk shares;
// payload.run.id must already be set by the caller so every chunk pins to
// the same run (every caller here generates its own runId up front).
// onProgress(queuedSoFar, mergedSoFar, totalItems), if given, fires after
// each chunk settles so a caller can show live progress (e.g. the "Nuke 'Em"
// button's remaining count) instead of only updating once at the very end.
async function sendCoordinatorEnqueueChunked(payload = {}, onProgress = null) {
    const items = Array.isArray(payload.items) ? payload.items : []
    const runId = payload.run?.id || ''
    const totalItems = items.length
    if(!totalItems) return {queued: 0, merged: 0, executionQueued: 0, runId}

    const chunks = []
    for(let offset = 0; offset < items.length; offset += COORDINATOR_ENQUEUE_CHUNK_SIZE) {
        chunks.push(items.slice(offset, offset + COORDINATOR_ENQUEUE_CHUNK_SIZE))
    }

    let queued = 0
    let merged = 0
    let durable = false
    let storageTimedOut = false
    let stopReason = ''
    const resetCleanupTargets = []
    // Owner, 23 Oct: the profiles the worker merged into existing rows, so the page clears their pending records.
    const mergedHrefs = []

    for(let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        // A failed/timed-out attempt below has no partial-success state to
        // worry about (see SPACE_FEED_ENQUEUE_CHUNK_MAX_ATTEMPTS's comment in
        // timeouts.js): either the durable write already landed, in which
        // case waitForCoordinatorEnqueueSummary already found it and this
        // isn't a failure at all, or it never landed, in which case
        // resending the identical chunk is safe and can't double-count. So
        // retry the SAME chunk in place with backoff rather than abandoning
        // every chunk after it -- a user-visible "add again" step is not an
        // acceptable substitute for this actually completing on its own.
        let settled = null
        for(let attempt = 1; attempt <= SPACE_FEED_ENQUEUE_CHUNK_MAX_ATTEMPTS; attempt += 1) {
            const chunkResult = await safeSendRuntimeMessageWithTimeout({
                action: 'enqueue-coordinator-items',
                run: payload.run,
                source: payload.source,
                execute: payload.execute,
                items: chunks[chunkIndex],
                runSummary: {
                    requested: totalItems,
                    priorQueued: queued,
                    priorMerged: merged,
                    ...(chunkIndex === 0 && payload.source?.preFilter ? {preFilter: payload.source.preFilter} : {})
                }
            }, null, SPACE_FEED_ENQUEUE_MESSAGE_TIMEOUT_MS)

            settled = chunkResult || await waitForCoordinatorEnqueueSummary(runId, SPACE_FEED_ENQUEUE_SUMMARY_POLL_TIMEOUT_MS)
            const chunkFailed = !settled || settled.storageTimedOut === true || settled.durable === false
            if(!chunkFailed) break
            if(attempt < SPACE_FEED_ENQUEUE_CHUNK_MAX_ATTEMPTS) {
                await sleep(SPACE_FEED_ENQUEUE_CHUNK_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)))
            }
        }

        if(!settled) {
            storageTimedOut = true
            stopReason = 'chunk-enqueue-no-response'
            break
        }

        // A recovered summary already carries the durable running total
        // through this chunk (see waitForCoordinatorEnqueueSummary's own
        // comment above), so it replaces the tally instead of adding to it;
        // a direct chunkResult only ever carries this one chunk's own count.
        if(settled.recoveredFromSummary) {
            queued = Number.parseInt(settled.queued, 10) || queued
            merged = Number.parseInt(settled.merged, 10) || merged
        }
        else {
            queued += Number.parseInt(settled.queued, 10) || 0
            merged += Number.parseInt(settled.merged, 10) || 0
        }
        if(Array.isArray(settled.resetCleanupTargets)) resetCleanupTargets.push(...settled.resetCleanupTargets)
        if(Array.isArray(settled.mergedHrefs)) mergedHrefs.push(...settled.mergedHrefs)
        if(settled.durable === true || settled.recoveredFromSummary) durable = true
        if(onProgress) onProgress(queued, merged, totalItems)

        if(settled.storageTimedOut === true) {
            storageTimedOut = true
            stopReason = 'chunk-storage-timeout'
            break
        }
        if(settled.durable === false) {
            stopReason = settled.reason || 'chunk-enqueue-save-failed'
            break
        }
    }

    return {
        queued,
        merged,
        mergedHrefs,
        executionQueued: 0,
        runId,
        durable,
        storageTimedOut,
        resetCleanupTargets,
        reason: stopReason || undefined
    }
}

// Header authors of this page's asset-space posts (31 Oct). On an asset space a poster is never a candidate, so these profiles are left out
// of every enqueue. Page memory only: cleared on reload, never stored.
const spaceFeedPosterProfileHrefs = new Set()
// Profiles this page has queued from the space feed, so the weeding at the end of a collect only asks about rows that could be there.
const spaceFeedQueuedProfileHrefs = new Set()

function noteSpaceFeedPosterProfile(href) {
    const normalized = normalizeQuoraProfileHref(href || '') || ''
    if(normalized && isAssetSpacePage()) spaceFeedPosterProfileHrefs.add(normalized)
}

async function enqueueCoordinatorSpaceFeedItems(space, runId, profileAssociations, preFilter = null, onProgress = null) {
    if(!space || !runId || !Array.isArray(profileAssociations) || !profileAssociations.length) {
        return null
    }
    profileAssociations = profileAssociations.filter(association => association.resolveProfileFromPage ||
        !spaceFeedPosterProfileHrefs.has(normalizeQuoraProfileHref(association.profileHref || '') || ''))
    if(!profileAssociations.length) return null

    const source = {
        type: 'space-feed',
        pageUrl: location.href,
        spaceKey: space.key || '',
        spaceCategory: getStoredSpaceCategory(space),
        ...(preFilter ? {preFilter} : {})
    }

    const enqueueResult = await sendCoordinatorEnqueueChunked({
        run: {
            id: runId,
            sourceType: 'space-feed',
            sourcePageUrl: location.href
        },
        source,
        execute: {
            tabAction: 'nuke',
            maxConcurrent: getSpaceFeedProfilesPerBatch(),
            noForegroundFallback: false
        },
        items: profileAssociations.map(association => {
            if(association.resolveProfileFromPage) {
                const requestedUrl = normalizeQuoraPostHref(association.postUrl || '')
                return {
                    runId,
                    dedupeKey: `resolve-profile:${requestedUrl || association.postKey || ''}`,
                    targetProfileHref: '',
                    requestedUrl,
                    resolutionMode: QUEUED_PROFILE_RESOLUTION_MODE,
                    resolveProfileFromPage: true,
                    resolutionReason: association.resolutionReason || '',
                    resolutionSubject: association.resolutionSubject || '',
                    source,
                    evidence: association.evidence || []
                }
            }

            return {
                runId,
                dedupeKey: association.profileHref,
                targetProfileHref: association.profileHref,
                requestedUrl: association.profileHref,
                candidateConfidence: association.candidateEvidence?.confidence || '',
                candidateCollector: association.candidateEvidence?.collector || '',
                source,
                evidence: association.evidence || []
            }
        })
    }, onProgress)
    for(const association of profileAssociations) {
        const queuedHref = normalizeQuoraProfileHref(association.profileHref || '') || ''
        if(queuedHref) spaceFeedQueuedProfileHrefs.add(queuedHref)
    }
    return enqueueResult
}

// Removes the rows this page queued for profiles that have since been seen as a post's header author (31 Oct). The worker only cancels
// pending rows, so a row that has finished keeps its outcome.
async function weedSpaceFeedPosterRows() {
    const posters = [...spaceFeedQueuedProfileHrefs].filter(href => spaceFeedPosterProfileHrefs.has(href))
    for(const profileHref of posters) {
        spaceFeedQueuedProfileHrefs.delete(profileHref)
        await safeSendRuntimeMessage({action: 'cancel-coordinator-current-work-item', storageKey: '', coordinatorKey: profileHref, profileHref}, null)
    }
    return posters.length
}

async function enqueueCoordinatorProfileUrls(options = {}) {
    const {
        urls = [],
        sourceType = 'profile-list',
        event = 'Queued profile action',
        maxConcurrent = getProfilesPerBatch(),
        noForegroundFallback = false,
        maxRetries = null,
        sourceExtra = {},
        // onProgress(queuedSoFar, mergedSoFar, totalItems), as the space page's enqueue takes it: fires after each chunk settles.
        onProgress = null
    } = options
    const profileHrefs = getNormalizedProfileHrefList(urls)
    if(!profileHrefs.length) return {queued: 0, merged: 0, executionQueued: 0}

    const runId = `${sourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const source = {
        type: sourceType,
        pageUrl: location.href,
        ...sourceExtra
    }

    return sendCoordinatorEnqueueChunked({
        run: {
            id: runId,
            sourceType,
            sourcePageUrl: location.href
        },
        source,
        execute: {
            tabAction: 'nuke',
            maxConcurrent,
            noForegroundFallback,
            ...(Number.isFinite(Number.parseInt(maxRetries, 10)) && Number.parseInt(maxRetries, 10) >= 0
                ? {maxRetries: Number.parseInt(maxRetries, 10)}
                : {})
        },
        items: profileHrefs.map(profileHref => ({
            runId,
            dedupeKey: profileHref,
            targetProfileHref: profileHref,
            requestedUrl: profileHref,
            source
        }))
    }, onProgress)
}

async function nukeSpaceFeedEntries(button, entries) {
    if(!button || !entries.length) return false

    const space = resolveCurrentSpaceDescriptor()
    if(!space) return false

    // Owner, 25 Oct: the already-nuked count is a count of PROFILES. A profile linked from several posts counts once.
    const alreadyNukedProfiles = new Set()
    let unqueueableCount = 0
    // Set by the steps below as the run goes (see runBatchNuke in candidateNuke.js): the entries it queues, the pre-filter breakdown of the
    // selection, and the run id the enqueue and the active-mode record share.
    let unfinishedEntries = []
    let preFilter = null
    let runId = ''

    // The end of a run that queued nothing: the blocked-profile sweep first, since a sweep that owns a tab is a run in progress.
    async function finishWithoutQueue() {
        const sweep = await sweepBlockedProfileTabs()
        if(sweep.owned > 0) {
            syncSpaceFeedNukeControls()
            return true
        }

        const nothingQueuedBreakdown = formatSpaceFeedPreFilterBreakdown(preFilter)
        setNukeButtonNotice(button, nothingQueuedBreakdown ? `${NOTHING_QUEUED_LABEL} (${nothingQueuedBreakdown})` : NOTHING_QUEUED_LABEL)
        return false
    }

    return runBatchNuke({
        candidates: entries,
        // The queueable predicate, once per entry. An entry whose profiles are all already nuked is skipped and counted as already nuked. An
        // entry with no queueable URL and no profile to resolve from the page is counted as unqueueable. Any other entry is queueable, with the
        // URLs it can queue.
        queueItemOf: entry => {
            const candidateProfiles = getNormalizedProfileHrefList(entry?.candidateUrls || [])
            const nukedProfiles = candidateProfiles.filter(url => isKnownNukedSpaceFeedProfile(url))
            for(const url of nukedProfiles) alreadyNukedProfiles.add(url)
            if(candidateProfiles.length && nukedProfiles.length === candidateProfiles.length) return null

            const candidateUrls = getQueueableSpaceFeedEntryUrls(entry)
            const resolveProfileFromPage = !candidateUrls.length && isQueueableSpaceFeedResolverEntry(entry)
            if(!candidateUrls.length && !resolveProfileFromPage) {
                unqueueableCount += 1
                return null
            }

            return {
                ...entry,
                candidateUrls,
                resolveProfileFromPage
            }
        },
        // The work is one association per unique profile, plus the posts whose profile is still to be read.
        toWork: items => {
            unfinishedEntries = items
            const profileAssociations = getSpaceFeedProfilePostAssociations(unfinishedEntries)
            const resolverAssociations = getResolvableSpaceFeedPostAssociations(unfinishedEntries)
            const workAssociations = profileAssociations.concat(resolverAssociations)
            // getSpaceFeedProfilePostAssociations collapses multiple feed entries
            // that point at the same profile (the same author's several posts) into
            // one association -- entries.length routinely looks much bigger than
            // what actually gets enqueued for reasons that have nothing to do with
            // dedup-against-already-queued-rows (that part is already surfaced via
            // enqueueQueuedCount/enqueueMergedCount below). Carrying this breakdown
            // through to the enqueue summary is what lets both the page that queued
            // this batch and the dashboard show why a big selection shrank instead
            // of leaving it looking like most of it silently vanished.
            // rawWorkItems counts one per (post, profile) pair this click submits, the
            // same unit the nuke button's count is built from. workAssociations has one
            // per unique profile, so the difference is the duplicates collapsed across
            // posts (or repeated within one post).
            const rawWorkItems = unfinishedEntries.reduce((total, entry) =>
                total + (entry.candidateUrls.length || (entry.resolveProfileFromPage ? 1 : 0)), 0)
            preFilter = {
                totalCandidates: entries.length,
                rawWorkItems,
                alreadyNuked: alreadyNukedProfiles.size,
                unqueueable: unqueueableCount,
                duplicateProfile: Math.max(0, rawWorkItems - workAssociations.length)
            }
            return workAssociations
        },
        onEmpty: () => {
            syncSpaceFeedNukeControls()
            const skippedBreakdown = formatSpaceFeedPreFilterBreakdown(preFilter)
            setNukeButtonDone(button, skippedBreakdown ? `${NUKED_LABEL} (${skippedBreakdown})` : NUKED_LABEL)
            return true
        },
        onQueued: count => {
            updateOwnedNukeStatusCache({
                ...ownedNukeStatusCache,
                queued: (Number.parseInt(ownedNukeStatusCache?.queued, 10) || 0) + count,
                paused: false
            })
        },
        beforeMark: () => {
            runId = `space-feed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            rememberActiveSpaceFeedNukeMode(button, runId)
            button.dataset.mbQueueing = 'true'
            for(const entry of unfinishedEntries) {
                if(entry?.postKey) {
                    spaceFeedNukingPostKeys.add(entry.postKey)
                }
            }
        },
        // Owner, 26 Oct: these posts count as pending from now, before the enqueue settles and before the page's copy of the queue has the rows.
        markItems: spaceFeedEnqueueMarkItems,
        marks: spaceFeedEnqueueMarks,
        pressButton: () => animateNukeButtonPress(button),
        setWorking: text => setNukeButtonWorking(button, text),
        afterWorking: () => syncSpaceFeedNukeControls(),
        // Each chunk (see sendCoordinatorEnqueueChunked) settles as its own
        // separate message, so the remaining count can visibly drop chunk by
        // chunk instead of sitting on one static label until the whole batch
        // finishes.
        sendBatch: (work, onProgress) => enqueueCoordinatorSpaceFeedItems(space, runId, work, preFilter, onProgress),
        // The enqueue reply carries counts, not rows, so the marks stay until a state reply asked after the enqueue settles shows the rows.
        readOutcome: result => {
            const queued = Number.parseInt(result?.queued, 10) || 0
            const merged = Number.parseInt(result?.merged, 10) || 0
            return {
                settled: !!(result?.durable && !result?.storageTimedOut && queued + merged > 0),
                queued,
                merged
            }
        },
        refreshAfterEnqueue: () => refreshSpaceFeedStateAfterEnqueue(),
        afterSettle: (outcome, result) => {
            if((result?.executionQueued || outcome.queued || outcome.merged || 0) > 0) {
                syncSpaceFeedNukeControls()
                // Merged rows (already-known key: currently queued, or a past
                // terminal outcome) are silently absorbed into the existing row
                // rather than added as new work, and preFilter's counts (see
                // above) never even reached the enqueue call at all -- surface
                // both breakdowns together for a beat instead of jumping
                // straight to the generic working label, so a big selection
                // that shrank a lot doesn't look like most of it silently
                // vanished.
                const noticeParts = []
                if(outcome.merged > 0) noticeParts.push(`${outcome.merged} already known`)
                const preFilterBreakdown = formatSpaceFeedPreFilterBreakdown(preFilter)
                if(preFilterBreakdown) noticeParts.push(preFilterBreakdown)

                if(noticeParts.length) {
                    setNukeButtonNotice(
                        button,
                        `Queued ${outcome.queued} new of ${preFilter.totalCandidates} (${noticeParts.join('; ')})`,
                        getSpaceFeedQueueButtonLabel()
                    )
                }
                return true
            }

            return finishWithoutQueue()
        },
        beforeFinish: () => {
            delete button.dataset.mbQueueing
        },
        afterFinish: async() => {
            for(const entry of unfinishedEntries) {
                if(entry?.postKey) {
                    spaceFeedNukingPostKeys.delete(entry.postKey)
                }
            }
            updateOwnedNukeStatusCache(await getOwnedNukeStatus())
            clearInactiveSpaceFeedNukeMode()
            syncSpaceFeedNukeControls()
            scheduleSpaceAssetNukeControls(0)
        }
    })
}

// The queue's work for this space, as a status beside the Nuke 'Em button (owner, 25 Oct). It is a display only: the button keeps its own
// label and stays usable while the work runs. A queue paused from the dashboard shows here too, since a space page has no pause button.
// 30 Oct (owner): the drop-down carries the Nuking words and count, so the status text keeps only the queueing count. The drop-down stays
// beside the status while nuking work is left or the queue is paused.
function syncSpaceFeedNukingStatus(host, model = {}, activeWork = false) {
    if(!host) return
    const left = model?.pendingProfileCount || 0
    const toolbar = spaceFeedNukingToolbar({
        queueing: model?.queueingProfileCount || 0,
        left,
        paused: nukingQueuePaused
    })
    syncNukingToolbarStatus(host, host.querySelector('.mb-ext_space-feed-nuke-btn'), toolbar.statusText, left, toolbar.showsControl)
}

function syncSpaceFeedTopNukeButton(renderModel) {
    const host = getSpaceFeedTopButtonHost()
    if(!host) return false

    // getSpaceFeedBar's tab row is shared navigation present on every Space
    // sub-page (About, Members, ...), not just the ones that actually list
    // posts -- previously this button still showed up (as an inert
    // "Scanning..." state, see the totalEntries.length === 0 branch below)
    // on any of them. Reported live by a user (qr.ae/pFJLuz) as a confusing,
    // unexplained control on a page with no posts to nuke. a.post_timestamp
    // is the same signal getSpaceFeedContentRoot() already uses to confirm
    // a page actually has posts; require it here too before showing
    // anything, rather than only checking it indirectly via this
    // extension's own (slower) profile-href scan.
    if(!document.querySelector('a.post_timestamp, a.answer_timestamp')) {
        host.querySelector('.mb-ext_space-feed-nuke-btn')?.remove()
        return false
    }

    const model = Array.isArray(renderModel) ? buildSpaceFeedRenderModel(renderModel) : renderModel
    const totalEntries = model?.totalEntries || []
    const liveEntries = model?.liveEntries || []
    const queueableEntries = model?.queueableEntries || []
    const queueableCount = Number.parseInt(model?.queueableCount, 10) || 0
    let button = host.querySelector('.mb-ext_space-feed-nuke-btn')
    const busyEntries = model?.busyEntries || []
    const ownerRunningForThisSpace = model?.ownerRunning && (model.localBusy || button?.dataset?.mbQueueing === 'true')
    const displayEntries = model?.singleNukeActive ? queueableEntries : liveEntries
    const shouldPromptScroll = !ownerRunningForThisSpace &&
        !model?.ownerPaused &&
        !busyEntries.length &&
        !queueableEntries.length &&
        !liveEntries.length &&
        totalEntries.length > 0 &&
        !model?.hasNukedEntries

    if(!button) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'mb-ext_nuke-profiles-btn mb-ext_space-feed-nuke-btn'
        setMuteBlockHelp(button, 'Queue detected profiles from visible posts in this space for mute and block')
        host.appendChild(button)
    }
    button = ensureCurrentInstanceClickHandler(button, 'space-feed-top', async event => {
        const activeButton = event.currentTarget
        if(activeButton.dataset.mbNukeState === 'working') {
            return
        }

        // Owner, 23 Oct: a collapsed post has no candidate until it is expanded, so a post that was not yet expanded was missing from the batch.
        // Expand every rendered collapsed post first, then rescan, so the batch is built from what is on the page now.
        const expandedNow = expandCollapsedSpaceFeedPosts(getSpaceFeedPostEntries(), {nearOnly: false, limit: 25})
        if(expandedNow) await new Promise(resolve => setTimeout(resolve, 1500))
        // The batch is read from the list stored on this button at the last render, so a render refreshes that list before the read.
        // Without it, a post expanded by this click was counted in the label but left out of the batch.
        syncSpaceFeedNukeControls()

        const currentEntries = getLatestSpaceFeedEntries()
        const entriesToNuke = getClickedSpaceFeedEntries(activeButton, currentEntries)
        if(!entriesToNuke.length) {
            if(currentEntries.some(entry => isSpaceFeedEntryNuked(entry))) {
                setNukeButtonDone(activeButton)
                return
            }

            setNukeButtonIdle(activeButton)
            return
        }

        void nukeSpaceFeedEntries(activeButton, entriesToNuke)
    })

    const queueSubmissionPending = button.dataset.mbQueueing === 'true'
    const activeSpaceWork = model?.hasActiveSpaceWork ||
        (queueSubmissionPending && (busyEntries.length || queueableEntries.length || model?.ownerRunning)) ||
        model?.batchNukeActive ||
        model?.unknownNukeActive

    if(!totalEntries.length) {
        setSpaceFeedButtonSelection(button, [])
        setMuteBlockHelp(button, 'Scanning visible posts in this space for profiles to nuke')
        setNukeButtonIdle(button, 'Scanning...')
        button.disabled = true
        syncSpaceFeedNukingStatus(host, model, false)
        return true
    }

    // While this page queues a batch, the enqueue sets the button's label (Queueing...). A render must not replace it.
    if(queueSubmissionPending) {
        syncSpaceFeedNukingStatus(host, model, activeSpaceWork)
        return true
    }
    setSpaceFeedButtonSelection(button, displayEntries)
    setMuteBlockHelp(button, shouldPromptScroll ? 'No visible targets. Scroll for more posts to scan.' : buildNukeTargetsHelpText('Queue detected profiles from visible posts in this space for mute and block', getSpaceFeedButtonUrls(button)))

    // Queued work for this space shows beside the button (syncSpaceFeedNukingStatus). It does not hold the button, so the candidates that
    // can still be queued are queued while earlier work runs (owner, 25 Oct).
    if(activeSpaceWork) {
        setSpaceFeedButtonSelection(button, queueableEntries)
        setMuteBlockHelp(button, queueableEntries.length
            ? 'Queue the candidates on visible posts that are not queued yet. Rows already queued keep running.'
            : 'This space has queued work. Nothing new to queue yet.')
    }
    if(model?.singleNukeActive && queueableEntries.length) {
        setNukeButtonIdle(button, `Nuke 'Em ${queueableCount}`)
        button.disabled = false
    }
    else if(model?.singleNukeActive) {
        setNukeButtonIdle(button)
        button.disabled = true
    }
    else if(shouldPromptScroll) {
        setNukeButtonIdle(button, 'Scroll for More')
        button.disabled = false
    }
    else if(queueableEntries.length) {
        setNukeButtonIdle(button, `Nuke 'Em ${queueableCount}`)
        button.disabled = false
    }
    else if(activeSpaceWork) {
        setNukeButtonIdle(button, `Nuke 'Em 0`)
        button.disabled = true
    }
    else if(model?.allActionableEntriesNuked) {
        setNukeButtonDone(button)
        button.disabled = true
    }
    else if(model?.allActionableEntriesSettled) {
        setNukeButtonDone(button, NUKED_LABEL)
        button.disabled = true
    }
    else {
        setNukeButtonDone(button, NUKED_LABEL)
        button.disabled = true
    }

    syncSpaceFeedNukingStatus(host, model, activeSpaceWork)
    return true
}

// Posts near the viewport (one screen above and below). Only these get their per-post buttons written, so a change in the count does not
// touch every post on the page. A post that scrolls near is brought up to date then. Without IntersectionObserver (tests, old browsers)
// every post counts as near, as before.
const spaceFeedNearPostRoots = new Set()
// The post roots the near-post observer has been asked to watch. A post not in here has not been seen by the observer yet.
const spaceFeedObservedRoots = new WeakSet()
// Diagnostic (24 Oct): how often and how long each page search takes on the space page, by where it is made. Shown in the Info report.
const spaceQueryStats = new Map()

function timedSpaceQuery(label, run) {
    const started = performance.now()
    try {
        return run()
    }
    finally {
        const stat = spaceQueryStats.get(label) || {count: 0, ms: 0}
        stat.count += 1
        stat.ms += performance.now() - started
        spaceQueryStats.set(label, stat)
    }
}

// Counts an event that has no duration, such as a state request sent to the worker.
function countSpaceQueryEvent(label) {
    const stat = spaceQueryStats.get(label) || {count: 0, ms: 0}
    stat.count += 1
    spaceQueryStats.set(label, stat)
}

function formatSpaceQueryStats() {
    const lines = ['space_query_stats:']
    const rows = [...spaceQueryStats.entries()].sort((left, right) => right[1].ms - left[1].ms)
    for(const [label, stat] of rows) {
        lines.push(`- ${label}: count=${stat.count} ms=${Math.round(stat.ms)}`)
    }
    if(!rows.length) lines.push('- none yet')
    return lines.join('\n')
}

// Diagnostic (24 Oct): the last button decision for each post that has candidates, and how many posts the last sync was given. Shown in the
// Info report only. Kept in memory and bounded; never stored.
const SPACE_FEED_BUTTON_TRACE_LIMIT = 40
const spaceFeedButtonTrace = new Map()
let spaceFeedButtonTraceRun = {visible: 0, at: 0}
let spaceFeedNearObserver = null
let lastSpaceFeedRenderModel = null

function getSpaceFeedNearObserver() {
    if(spaceFeedNearObserver || typeof IntersectionObserver !== 'function') return spaceFeedNearObserver
    spaceFeedNearObserver = new IntersectionObserver(changes => {
        let arrived = false
        for(const change of changes) {
            if(change.isIntersecting) {
                spaceFeedNearPostRoots.add(change.target)
                arrived = true
            }
            else spaceFeedNearPostRoots.delete(change.target)
        }
        if(arrived) scheduleSpaceFeedNearSync()
    }, {rootMargin: '100% 0px 100% 0px'})
    return spaceFeedNearObserver
}

// The place of each post in the feed, first post 1. Link-card entries are not posts and are not counted.
function getSpaceFeedPostOrdinals() {
    const ordinals = new Map()
    let total = 0
    for(const entry of getLatestSpaceFeedEntries()) {
        if(`${entry?.postKey || ''}`.startsWith('space-profile-link:')) continue
        total += 1
        ordinals.set(entry.postKey, total)
    }
    return {ordinals, total}
}

function formatSpaceFeedPostOrdinalPrefix(postOrdinals, postKey = '') {
    const ordinal = postOrdinals?.ordinals?.get(postKey)
    return ordinal ? `Post ${ordinal} of ${postOrdinals.total}: ` : ''
}

function recordSpaceFeedButtonTrace(entry = {}, reason = '') {
    if(!entry?.postKey) return
    const urls = getNormalizedProfileHrefList(entry.candidateUrls || [])
    if(!urls.length && entry.hasCandidates !== true) return
    // Delete then set, so the Map keeps the newest decision last and the oldest is dropped first.
    spaceFeedButtonTrace.delete(entry.postKey)
    spaceFeedButtonTrace.set(entry.postKey, {
        reason,
        candidates: urls.length,
        hasCandidates: entry.hasCandidates === true,
        postNuked: entry.postNuked === true,
        rootConnected: !!entry.postRoot?.isConnected
    })
    while(spaceFeedButtonTrace.size > SPACE_FEED_BUTTON_TRACE_LIMIT) {
        spaceFeedButtonTrace.delete(spaceFeedButtonTrace.keys().next().value)
    }
}

function formatSpaceFeedButtonTrace() {
    // Cards are counted from the page itself, so a post the render never reached still shows up here.
    const cards = Array.from(document.querySelectorAll('[data-mb-post-diag]'))
    const withCandidates = cards.filter(card => (Number.parseInt(card.dataset.mbPostDiag, 10) || 0) > 0)
    const withoutHost = withCandidates.filter(card => !card.querySelector('.mb-ext_space-feed-post-nuke-host'))
    const lines = [
        'button_trace:',
        `- visible_entries_last_sync: ${spaceFeedButtonTraceRun.visible} at ${spaceFeedButtonTraceRun.at ? new Date(spaceFeedButtonTraceRun.at).toISOString() : 'never'}`,
        `- cards_with_candidates: ${withCandidates.length}`,
        `- cards_with_candidates_no_host: ${withoutHost.length}`
    ]
    let index = 0
    for(const [key, record] of spaceFeedButtonTrace) {
        index += 1
        lines.push(`- trace_${index}: ${record.reason} | candidates=${record.candidates} hasCandidates=${record.hasCandidates} postNuked=${record.postNuked} rootConnected=${record.rootConnected} | ${key.slice(-70)}`)
    }
    for(const card of withoutHost.slice(0, 10)) {
        lines.push(`- no_host_card: ${card.dataset.mbPostDiag}`)
    }
    return lines.join('\n')
}

// 24 Oct: near is the same position test the scan uses, read from the post itself, so an observer report that is behind cannot leave an
// on-screen post without its button.
function isSpaceFeedPostRootNear(postRoot) {
    if(!getSpaceFeedNearObserver()) return true
    const rect = postRoot?.getBoundingClientRect?.() || null
    if(!rect) return false
    return isSpaceFeedTimestampInScanWindow(null, rect)
}

// 24 Oct: a post that has come into view is drawn by a full redraw, not by the last list. The last list cannot contain a post that arrived after
// it was built, so drawing from it left those posts blank until the page was scrolled away and back. The redraw timer keeps this to one redraw per gap.
function scheduleSpaceFeedNearSync() {
    if(getPageType() !== 'space') return
    scheduleSpaceAssetNukeControls(0)
}

function syncSpaceFeedPostButtons(renderModel) {
    const model = Array.isArray(renderModel) ? buildSpaceFeedRenderModel(renderModel) : renderModel
    const activeKeys = new Set()
    // Hosts already on the page, by post key. The lookup below can miss a host that exists (when Quora re-mounts part of a post), and then
    // adds a second button set beside the first. Each post keeps the host it uses and drops any other host for the same key.
    const hostsByKey = new Map()
    for(const existing of getSpaceFeedPostHostsInDocument()) {
        const key = existing.dataset.mbPostHostKey || ''
        if(!hostsByKey.has(key)) hostsByKey.set(key, [])
        hostsByKey.get(key).push(existing)
    }
    const entries = model?.visibleEntries || []
    const aggregateUrls = model?.queueableUrls || []
    const aggregateCount = Number.parseInt(model?.queueableCount, 10) || 0
    spaceFeedButtonTraceRun = {visible: entries.length, at: Date.now()}
    // 24 Oct: the hover text names the post's place in the feed, counted over every post on the page, not only the ones on screen.
    const postOrdinals = getSpaceFeedPostOrdinals()

    for(const entry of entries) {
        // Owner, 24 Oct: buttons are for the main post card only. A profile link in a post's text is still counted in the queue, but gets no button,
        // and it is not kept active here, so an old button on it is removed by the cleanup at the end of this sync.
        if(`${entry.postKey || ''}`.startsWith('space-profile-link:')) {
            recordSpaceFeedButtonTrace(entry, entry.cardReason ? `link-in-body: ${entry.cardReason}` : 'link-in-body')
            continue
        }
        if(!isSpaceFeedPostRootNear(entry.postRoot)) {
            activeKeys.add(entry.postKey)
            recordSpaceFeedButtonTrace(entry, 'not-near')
            continue
        }
        const liveUrls = entry.liveUrls || []
        const postLabel = formatSpaceFeedPostOrdinalPrefix(postOrdinals, entry.postKey)
        const hasResolver = entry.hasResolver === true
        const hasCandidates = entry.hasCandidates === true
        const postBusy = entry.postBusy === true
        const postNuked = entry.postNuked === true
        // Owner, 23 Oct: the profiles on this post that ended in errors and cannot be queued again. Named on the Bad Links button.
        // Owner, 29 Oct: each one carries its reason and link, so the button hover and the list beside it say the same thing.
        const badLinkDetails = postNuked || hasCandidates ? [] : getNormalizedProfileHrefList(entry.candidateUrls || [])
            .filter(url => isProfileNukeRetryBlocked(url) && !isKnownNukedSpaceFeedProfile(url))
            .map(url => getSpaceFeedBadLinkDetail(url, getProfileNukeProgressRecord(url)))
        const hasBadLinks = badLinkDetails.length > 0
        const shouldShowControls = postNuked || aggregateCount > 0 || hasCandidates || postBusy || hasBadLinks
        if(!shouldShowControls) {
            delete entry.postRoot.dataset.mbSpaceFeedPostKey
            spaceFeedMarkedRoots.delete(entry.postRoot)
            recordSpaceFeedButtonTrace(entry, 'no-controls')
            continue
        }

        const host = getSpaceFeedPostButtonHost(entry.postRoot, entry.postKey)
        if(!host) {
            recordSpaceFeedButtonTrace(entry, 'no-host')
            continue
        }
        recordSpaceFeedButtonTrace(entry, postNuked ? 'nuked' : hasCandidates ? 'red' : hasBadLinks ? 'bad-links' : 'other')
        for(const stale of hostsByKey.get(entry.postKey) || []) {
            if(stale !== host && stale.isConnected) stale.remove()
        }

        entry.postRoot.dataset.mbSpaceFeedPostKey = entry.postKey
        spaceFeedMarkedRoots.add(entry.postRoot)
        activeKeys.add(entry.postKey)

        if(postNuked) {
            host.querySelector('.mb-ext_space-feed-post-queue-btn')?.remove()

            let doneButton = host.querySelector('.mb-ext_space-feed-post-nuke-btn')
            if(!doneButton) {
                doneButton = document.createElement('button')
                doneButton.type = 'button'
                doneButton.className = 'mb-ext_nuke-profiles-btn mb-ext_space-feed-post-nuke-btn mb-ext_space-feed-post-single-nuke-btn'
                host.appendChild(doneButton)
            }
            doneButton.dataset.mbPostKey = entry.postKey
            doneButton.dataset.mbPostUrl = entry.postUrl || ''
            setSpaceFeedButtonUrls(doneButton, liveUrls)
            doneButton.classList.remove('mb-ext_space-feed-post-single-nuke-btn--neutral')
            setMuteBlockHelp(doneButton, `${postLabel}This post has already been nuked`)
            setNukeButtonDone(doneButton)
            doneButton.disabled = true
            // 24 Oct: a button hidden while the post had nothing to show is shown again once the post is nuked.
            doneButton.style.display = ''
            syncSpaceFeedBadLinkList(host, [])
            syncSpaceFeedPostHeaderReservedSpace(entry.postRoot, host)
            continue
        }

        let queueButton = host.querySelector('.mb-ext_space-feed-post-queue-btn')
        if(!queueButton) {
            queueButton = document.createElement('button')
            queueButton.type = 'button'
            queueButton.className = 'mb-ext_nuke-profiles-btn mb-ext_space-feed-post-queue-btn'
            setMuteBlockHelp(queueButton, 'Queue all currently detected profiles from visible posts in this space')
            host.appendChild(queueButton)
        }
        queueButton = ensureCurrentInstanceClickHandler(queueButton, 'space-feed-post-queue', event => {
            const activeButton = event.currentTarget
            if(activeButton.dataset.mbNukeState === 'working') {
                return
            }

            const entriesToNuke = getClickedSpaceFeedEntries(activeButton, getLatestSpaceFeedEntries())
            if(!entriesToNuke.length) {
                setNukeButtonIdle(activeButton, `Nuke 'Em 0`)
                activeButton.disabled = true
                return
            }

            void nukeSpaceFeedEntries(activeButton, entriesToNuke)
        })

        let singleButton = host.querySelector('.mb-ext_space-feed-post-nuke-btn')
        if(!singleButton) {
            singleButton = document.createElement('button')
            singleButton.type = 'button'
            singleButton.className = 'mb-ext_nuke-profiles-btn mb-ext_space-feed-post-nuke-btn mb-ext_space-feed-post-single-nuke-btn'
            setMuteBlockHelp(singleButton, 'Queue only this post profile for mute and block')
            host.appendChild(singleButton)
        }
        singleButton = ensureCurrentInstanceClickHandler(singleButton, 'space-feed-post-single', event => {
            const activeButton = event.currentTarget
            // Owner, 29 Oct: Bad Links opens its list and nothing else. It is checked first, so no batch can start from it.
            if(toggleSpaceFeedBadLinkListFromClick(activeButton)) {
                return
            }
            if(activeButton.dataset.mbNukeState === 'working') {
                return
            }

            const postKey = activeButton.dataset.mbPostKey || ''
            if(!postKey || isSpaceFeedPostNuked(getSpaceFeedButtonUrls(activeButton))) {
                setNukeButtonDone(activeButton)
                activeButton.disabled = true
                return
            }

            const liveEntry = getLatestSpaceFeedEntries().find(candidate => candidate.postKey === postKey)
            const liveUrls = getQueueableSpaceFeedEntryUrls(liveEntry)
            const urls = liveUrls.length ? liveUrls : getSpaceFeedButtonUrls(activeButton)
            const resolveProfileFromPage = !urls.length && isQueueableSpaceFeedResolverEntry(liveEntry)
            if(!urls.length && !resolveProfileFromPage) return

            void nukeSpaceFeedEntries(activeButton, [{
                postKey,
                postUrl: liveEntry?.postUrl || activeButton.dataset.mbPostUrl || '',
                candidateUrls: urls,
                resolveProfileFromPage,
                // The chase goes to the cited post or the question's log, not the post's own address (30 Oct).
                resolutionUrl: liveEntry?.resolutionUrl || '',
                resolutionSubject: liveEntry?.resolutionSubject || ''
            }])
        })

        queueButton.dataset.mbPostKey = entry.postKey
        setSpaceFeedButtonSelection(queueButton, model?.queueableEntries || [])
        setMuteBlockHelp(queueButton, postLabel + (aggregateCount > 0
            ? `Queue ${aggregateCount} current target${aggregateCount === 1 ? '' : 's'} in this space (this post: ${(entry.queueableUrls || []).map(url => url.split('/profile/')[1] || url).join(', ') || 'none'})`
            : 'No currently detected targets are queueable from visible posts in this space'))

        if(queueButton.dataset.mbQueueing === 'true') {
            // E4 (28 Oct): the row button reads Nuking... like the search row; the count stays in the toolbar status.
            setNukeButtonWorking(queueButton, formatProfileRowState('nuking'))
            queueButton.disabled = true
        }
        else {
            setNukeButtonIdle(queueButton, `Nuke 'Em ${aggregateCount}`)
            queueButton.disabled = aggregateCount < 1
        }
        // Owner, 23 Oct: the black count button belongs with a red button, so it is hidden on a post that has none.
        queueButton.style.display = hasCandidates ? '' : 'none'

        singleButton.dataset.mbPostKey = entry.postKey
        singleButton.dataset.mbPostUrl = entry.postUrl || ''
        setSpaceFeedButtonUrls(singleButton, liveUrls)
        setMuteBlockHelp(singleButton, postLabel + (hasResolver
            ? 'Queue this post for author profile resolution, then mute and block'
            : buildNukeTargetsHelpText('Queue only this post profile for mute and block', getSpaceFeedButtonUrls(singleButton))))
        // Diagnostic, 23 Oct: shown on hover after the help text, and kept on the button as data-mb-diag.
        const diagnostic = getSpaceFeedPostCandidateDiagnostic(entry)
        singleButton.dataset.mbDiag = diagnostic
        singleButton.title = `${singleButton.title} | diagnostic ${diagnostic}`
        singleButton.classList.remove('mb-ext_space-feed-post-single-nuke-btn--neutral')

        // Owner, 23 Oct: red means the post has a profile that is in the queue to be nuked. A post whose profiles are all queued already
        // shows Nuking.
        if(postNuked) {
            setNukeButtonDone(singleButton)
            singleButton.disabled = true
        }
        else if(hasCandidates) {
            setNukeButtonIdle(singleButton, 'Mute Block')
            singleButton.disabled = false
        }
        else if(postBusy) {
            setNukeButtonWorking(singleButton, formatSpaceFeedPostWorkLabel(entry.liveWorkCount || entry.queueableWorkCount || 0))
            singleButton.disabled = true
        }
        else if(hasBadLinks) {
            setNukeButtonBadLinks(singleButton)
            // Owner, 29 Oct: enabled, because a disabled button gets no click. The click only opens or closes the list (see the click handler).
            singleButton.disabled = false
            setMuteBlockHelp(singleButton, `${postLabel}Bad Links: nothing here can be queued. Failed: ${badLinkDetails.map(detail => `${detail.name} (${detail.reason})`).join(', ')}. Click for the links to block by hand.`)
        }
        else {
            setNukeButtonIdle(singleButton, 'Mute Block')
            singleButton.disabled = true
        }
        // Owner, 23 Oct: the red button is there only while a profile in the post is in the queue, so a post with none gets no button.
        singleButton.style.display = postNuked || hasCandidates || postBusy || hasBadLinks ? '' : 'none'
        // Owner, 29 Oct: the list is kept only while the Bad Links button is the one showing.
        syncSpaceFeedBadLinkList(host, hasBadLinks && !postBusy ? badLinkDetails : [])

        syncSpaceFeedPostHeaderReservedSpace(entry.postRoot, host)
    }

    for(const host of getSpaceFeedPostHostsInDocument()) {
        const button = host.querySelector('.mb-ext_space-feed-post-nuke-btn')
        const postKey = button?.dataset.mbPostKey || host.dataset.mbPostHostKey || ''
        if(!button ||
            isSpaceFeedDocumentLevelElement(host.parentElement) ||
            !activeKeys.has(postKey) ||
            postKey !== (host.dataset.mbPostHostKey || postKey)) {
            host.remove()
        }
    }

    const seenHostKeys = new Set()
    for(const host of getSpaceFeedPostHostsInDocument()) {
        const hostKey = host.dataset.mbPostHostKey || host.querySelector('.mb-ext_space-feed-post-nuke-btn')?.dataset.mbPostKey || ''
        if(!hostKey) continue
        if(seenHostKeys.has(hostKey)) {
            host.remove()
            continue
        }
        seenHostKeys.add(hostKey)
    }

    for(const root of getSpaceFeedMarkedRoots()) {
        if(isSpaceFeedDocumentLevelElement(root) || !activeKeys.has(root.dataset.mbSpaceFeedPostKey || '')) {
            delete root.dataset.mbSpaceFeedPostKey
            spaceFeedMarkedRoots.delete(root)
        }
    }
}

// Owner, 23 Oct: a collapsed post shows no profile link, so its candidates cannot be read. Clicking the post body expands it, which shows the
// link. Each post is clicked at most once, since a second click would collapse it again.
const spaceFeedExpandedPostKeys = new Set()
const SPACE_FEED_EXPAND_CLICKS_PER_PASS = 3

// The post body, found by its position under the author header: the element at a point just below the header. Anything that is a link,
// a button, part of the header, or the Follow control is not used, so a click cannot open a profile or follow someone.
function findSpaceFeedPostBodyElement(postRoot) {
    const header = postRoot.querySelector('a.post_timestamp, a.answer_timestamp')?.closest('.q-flex.qu-alignItems--flex-start, .q-flex') || null
    if(!header) return null

    const rect = postRoot.getBoundingClientRect()
    const y = header.getBoundingClientRect().bottom + 12
    if(y >= rect.bottom - 4) return null

    const x = rect.left + Math.min(40, rect.width / 2)
    const element = document.elementFromPoint(x, y)
    if(!element || !postRoot.contains(element) || header.contains(element)) return null
    if(element.closest('a, button, [role="button"], .mb-ext_space-feed-post-nuke-host')) return null
    if(/\bfollow\b/i.test(element.textContent || '') && (element.textContent || '').trim().length < 40) return null

    return element
}

function expandCollapsedSpaceFeedPosts(entries = [], options = {}) {
    const nearOnly = options.nearOnly !== false
    const limit = options.limit || SPACE_FEED_EXPAND_CLICKS_PER_PASS
    let clicked = 0
    for(const entry of Array.isArray(entries) ? entries : []) {
        if(clicked >= limit) break
        if(!entry?.postRoot || !entry.postKey || spaceFeedExpandedPostKeys.has(entry.postKey)) continue
        if(getNormalizedProfileHrefList(entry.candidateUrls || []).length) continue
        if(nearOnly && !isSpaceFeedPostRootNear(entry.postRoot)) continue

        const target = findSpaceFeedPostBodyElement(entry.postRoot)
        if(!target) continue

        spaceFeedExpandedPostKeys.add(entry.postKey)
        target.click()
        // The post's cached candidate list was read while it was collapsed, so it is read again on the next scan.
        spaceFeedEntryCache.delete(entry.postKey)
        clicked += 1
    }
    if(clicked) setTimeout(() => syncSpaceFeedNukeControls(), 800)
    return clicked
}

function syncSpaceFeedNukeControls() {
    if(getPageType() !== 'space') {
        removeSpaceFeedNukeControls()
        return false
    }
    const renderStartedAt = Date.now()

    // 24 Oct: each phase of the redraw is timed under phase.* in the Info report, to find the one whose cost grows with the feed.
    const scannedEntries = timedSpaceQuery('phase.scan', () => getSpaceFeedPostEntriesForRender())
    timedSpaceQuery('phase.expand', () => expandCollapsedSpaceFeedPosts(scannedEntries))
    timedSpaceQuery('phase.latest', () => setLatestSpaceFeedEntries(scannedEntries))
    const entries = timedSpaceQuery('phase.latestRead', () => getLatestSpaceFeedEntries())
    timedSpaceQuery('phase.stateRefresh', () => scheduleSpaceFeedScopedStateRefresh(entries))
    const renderModel = timedSpaceQuery('phase.model', () => buildSpaceFeedRenderModel(scannedEntries, entries))
    recordSpaceMarkPerf('render', {entries: entries.length, coordinatorReady: coordinatorQueueLoaded, ms: Date.now() - renderStartedAt})
    timedSpaceQuery('phase.progressReconcile', () => scheduleSpaceFeedProgressReconciliation(entries))
    timedSpaceQuery('phase.busyState', () => clearStaleLocalSpaceFeedBusyState())
    timedSpaceQuery('phase.nukeMode', () => clearInactiveSpaceFeedNukeMode())
    const main = getSpaceFeedContentRoot()
    if(main) {
        main.dataset.mbSpaceFeedTimestampCount = `${entries.length}`
        main.dataset.mbSpaceFeedCardCount = `${entries.length}`
        main.dataset.mbSpaceFeedEntryCount = `${entries.length}`
        main.dataset.mbSpaceFeedVisibleEntryCount = `${scannedEntries.length}`
        main.dataset.mbSpaceFeedPostButtonCount = `${getExpectedSpaceFeedPostButtonCount(scannedEntries)}`
    }

    timedSpaceQuery('phase.statusButton', () => syncSpaceFeedStatusButton(entries))

    if(!isNukableSpacePage()) {
        removeSpaceFeedNukeButtons()
        return true
    }

    timedSpaceQuery('phase.topButton', () => syncSpaceFeedTopNukeButton(renderModel))
    injectSpaceCollectButton()
    syncSpaceFeedTopBarLayout()
    lastSpaceFeedRenderModel = renderModel
    timedSpaceQuery('phase.postButtons', () => syncSpaceFeedPostButtons(renderModel))
    if(getPendingCoordinatorSpaceFeedWorkCountForSpace() > 0 || hasActivePendingSpaceFeedWork(entries)) {
        scheduleSpaceAssetNukeControls(1200)
    }
    return true
}

function resetProfileSearchControls() {
    clearTimeout(profileSearchControlsTimeout)
    profileSearchControlsPending = false
    profileSearchCollectStopRequested = true
    resetProfileSearchCollectionState()
    clearProfileSearchFollowUps()
    clearProfileSearchPendingRefresh()
    document.querySelector('.mb-ext_profile-search-toolbar')?.remove()
    document.querySelector('.mb-ext_profile-search-stop-btn')?.remove()
    for(const host of Array.from(document.querySelectorAll('.mb-ext_profile-search-action-host'))) {
        host.remove()
    }
    for(const row of Array.from(document.querySelectorAll('[data-mb-profile-search-href]'))) {
        delete row.dataset.mbProfileSearchHref
    }
}

function scheduleProfileSearchControls(delay = 120) {
    if(profileSearchControlsPending && delay !== 0) return

    profileSearchControlsPending = true
    clearTimeout(profileSearchControlsTimeout)
    profileSearchControlsTimeout = setTimeout(() => {
        void (async () => {
            try {
                await refreshContentPageCoordinatorStateFromRuntime()
                syncProfileSearchControls()
            }
            finally {
                profileSearchControlsPending = false
                profileSearchControlsTimeout = null
            }
        })()
    }, Math.max(0, delay))
}

function clearProfileSearchFollowUps() {
    for(const timeoutId of profileSearchFollowUpTimeouts) {
        clearTimeout(timeoutId)
    }

    profileSearchFollowUpTimeouts = []
}

function clearProfileSearchPendingRefresh() {
    clearTimeout(profileSearchPendingRefreshTimeout)
    profileSearchPendingRefreshTimeout = null
}

function scheduleProfileSearchPendingRefresh(delayMs = PROFILE_SEARCH_PENDING_REFRESH_MS) {
    if(profileSearchPendingRefreshTimeout || getPageType() !== 'profile-search') return

    profileSearchPendingRefreshTimeout = setTimeout(() => {
        profileSearchPendingRefreshTimeout = null
        if(getPageType() !== 'profile-search') return

        void (async () => {
            await refreshContentPageCoordinatorStateFromRuntime({force: true})
            syncProfileSearchControls()
        })()
    }, Math.max(CONTENT_PAGE_STATE_REFRESH_MIN_INTERVAL_MS, Number.parseInt(delayMs, 10) || PROFILE_SEARCH_PENDING_REFRESH_MS))
}

function scheduleProfileSearchFollowUps() {
    clearProfileSearchFollowUps()

    const delays = [800, 2000, 5000, 10000]
    for(const delay of delays) {
        const timeoutId = setTimeout(() => {
            if(getPageType() === 'profile-search') {
                scheduleProfileSearchControls(0)
            }
        }, delay)

        profileSearchFollowUpTimeouts.push(timeoutId)
    }
}

function getProfileSearchQueryLabel() {
    const params = new URLSearchParams(location.search)
    const query = `${params.get('q') || ''}`.trim()
    return query ? `Search: ${query}` : 'Profile Search'
}

function getProfileSearchCollectionKey() {
    return `${location.origin}${location.pathname}?${new URLSearchParams(location.search).toString()}`
}

function resetProfileSearchCollectionState(options = {}) {
    const keepCursor = options.keepCursor === true
    profileSearchStagedHrefs = []
    profileSearchStagedHrefSet = new Set()
    if(!keepCursor) {
        profileSearchCollectCursorScrollY = 0
        profileSearchCollectCursorHref = ''
    }
}

function ensureProfileSearchCollectionStateForCurrentSearch() {
    const key = getProfileSearchCollectionKey()
    if(profileSearchCollectionKey === key) return

    profileSearchCollectionKey = key
    profileSearchCollectLimit = PROFILE_SEARCH_COLLECT_LIMIT
    resetProfileSearchCollectionState()
}

function getProfileSearchScrollY() {
    return Math.round(window.scrollY || document.documentElement.scrollTop || 0)
}

function saveProfileSearchCollectCursor(rows = []) {
    profileSearchCollectCursorScrollY = Math.max(profileSearchCollectCursorScrollY, getProfileSearchScrollY())

    const lastVisibleRow = rows
        .filter(row => row?.href && row.viewportBottom >= -80)
        .sort((left, right) => (left.viewportBottom - right.viewportBottom) || (left.viewportTop - right.viewportTop))
        .pop()
    if(lastVisibleRow?.href) profileSearchCollectCursorHref = normalizeQuoraProfileHref(lastVisibleRow.href) || profileSearchCollectCursorHref
}

function getProfileSearchStagedHrefs() {
    ensureProfileSearchCollectionStateForCurrentSearch()

    const next = []
    const seen = new Set()
    for(const href of profileSearchStagedHrefs) {
        const normalizedHref = normalizeQuoraProfileHref(href)
        if(!normalizedHref || seen.has(normalizedHref)) continue
        if(!isProfileSearchProfileNukeable(normalizedHref)) continue

        seen.add(normalizedHref)
        next.push(normalizedHref)
    }

    profileSearchStagedHrefs = next
    profileSearchStagedHrefSet = seen
    return profileSearchStagedHrefs.slice()
}

function stageProfileSearchHrefs(hrefs = []) {
    ensureProfileSearchCollectionStateForCurrentSearch()
    getProfileSearchStagedHrefs()

    let added = 0
    for(const href of hrefs) {
        const normalizedHref = normalizeQuoraProfileHref(href)
        if(!normalizedHref || profileSearchStagedHrefSet.has(normalizedHref)) continue
        if(!isProfileSearchProfileNukeable(normalizedHref)) continue

        profileSearchStagedHrefSet.add(normalizedHref)
        profileSearchStagedHrefs.push(normalizedHref)
        added += 1
    }

    return added
}

function hasUnstagedProfileSearchQueueableRow(rows = getProfileSearchRows({fromCurrentViewport: true, skipProcessed: true})) {
    ensureProfileSearchCollectionStateForCurrentSearch()
    getProfileSearchStagedHrefs()

    return getProfileSearchQueueableRows(rows, {allowRetry: false})
        .some(row => {
            const href = normalizeQuoraProfileHref(row.href)
            return href && !profileSearchStagedHrefSet.has(href)
        })
}

function getProfileSearchScrollHeight() {
    return Math.round(document.documentElement.scrollHeight || document.body?.scrollHeight || 0)
}

function isProfileSearchAtBottom() {
    return Math.ceil(getProfileSearchScrollY() + (window.innerHeight || 0)) >= getProfileSearchScrollHeight() - 2
}

function isProfileSearchEndOfResultsVisible() {
    const text = `${document.body?.innerText || ''}`.replace(/\s+/g, ' ').trim()
    return /couldn['’]?t find any more results/i.test(text) ||
        /\bno more results\b/i.test(text)
}

function hasProfileSearchLoadingIndicator() {
    return Array.from(document.querySelectorAll('[role="progressbar"], [aria-busy="true"], [class*="LoadingDots"], [class*="loading" i], [class*="spinner" i]'))
        .some(node => {
            const rect = node.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
        })
}

function nudgeProfileSearchLazyLoad() {
    if(isProfileSearchAtBottom()) {
        window.scrollTo({
            top: getProfileSearchScrollHeight(),
            left: 0,
            behavior: 'auto'
        })
        return
    }

    window.scrollBy({
        top: Math.max(500, Math.floor((window.innerHeight || 800) * 0.82)),
        left: 0,
        behavior: 'auto'
    })
}

function getProfileSearchCollectLimit() {
    return profileSearchCollectLimit
}

// Only a count the dropdown offers is taken. It applies to this search page only (see profileSearchCollectLimit).
function setProfileSearchCollectLimit(value) {
    if(!PROFILE_SEARCH_COLLECT_CHOICES.includes(value)) return
    profileSearchCollectLimit = value
    syncProfileSearchControls()
}

function isProfileSearchFollowButton(button) {
    if(!button || isExtensionOwnedNode(button) || !isVisible(button)) return false

    const labels = [
        button.getAttribute('aria-label') || '',
        getElementText(button)
    ].map(label => `${label}`.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if(labels.some(label => /\bfollowing\b|\bfollowed\b/i.test(label))) return false
    return labels.some(label => /^follow(?:\s*·\s*\d+)?$/i.test(label))
}

function getProfileSearchPrimaryHref(row) {
    const links = Array.from(row?.querySelectorAll?.('a[href*="/profile/"]') || [])
        .filter(link => !isExtensionOwnedNode(link) && isVisible(link))
        .map(link => {
            const href = normalizeQuoraProfileHref(link.href)
            const rect = link.getBoundingClientRect()
            return href ? {href, rect} : null
        })
        .filter(Boolean)
        .sort((left, right) => (left.rect.left - right.rect.left) || (left.rect.top - right.rect.top))

    return links[0]?.href || ''
}

function getProfileSearchRowForFollowButton(button) {
    let current = button?.parentElement || null
    let fallback = null

    for(let depth = 0; current && current !== document.body && depth < 10; depth += 1, current = current.parentElement) {
        if(isExtensionOwnedNode(current)) continue

        const rect = current.getBoundingClientRect()
        const hasProfileLink = !!Array.from(current.querySelectorAll?.('a[href*="/profile/"]') || [])
            .find(link => !isExtensionOwnedNode(link) && isVisible(link) && normalizeQuoraProfileHref(link.href))
        const hasFollowButton = Array.from(current.querySelectorAll?.('button, [role="button"]') || [])
            .some(candidate => candidate === button || isProfileSearchFollowButton(candidate))
        if(!hasProfileLink || !hasFollowButton) continue

        const plausibleRow = rect.width >= 260 && rect.height >= 36 && rect.height <= 180
        if(plausibleRow) return current
        fallback = fallback || current
    }

    return fallback
}

function getProfileSearchRows(options = {}) {
    if(getPageType() !== 'profile-search') return []

    const fromCurrentViewport = !!options.fromCurrentViewport
    const skipProcessed = !!options.skipProcessed
    const rows = []
    const seen = new Set()
    const followButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(isProfileSearchFollowButton)

    for(const followButton of followButtons) {
        if(skipProcessed && profileSearchProcessedFollowButtons.has(followButton)) continue
        const row = getProfileSearchRowForFollowButton(followButton)
        if(!row) continue

        // Layout is read only for the viewport pass, which is the only caller that uses the position (owner, 22 Oct). A full-page read
        // of every row's layout and text forced a layout per row on every sync, so it cost more as the page grew.
        const rect = fromCurrentViewport ? row.getBoundingClientRect() : null
        if(fromCurrentViewport && rect.bottom < -80) continue

        const href = getProfileSearchPrimaryHref(row)
        if(!href || seen.has(href)) continue
        seen.add(href)

        rows.push({
            href,
            row,
            followButton,
            viewportTop: rect ? rect.top : null,
            viewportBottom: rect ? rect.bottom : null
        })
    }

    return rows
}

// The search page's marks (owner, 26 Oct: the search page does what the space page does). A profile of a batch this page has just sent is
// 'queueing' on its row and in the toolbar from the start of the enqueue, and 'nuking' once the batch has settled with the worker, until the
// worker's rows show it. Keyed by profile href, the key the search row uses. A mark is dropped when a state reply shows the profile's row (or,
// for a settled batch, a reply asked after the settle has no row for it), and at once when the enqueue fails. Marks are never stored.
// The store (profileSearchEnqueueMarks) keys a mark by its profile href, the key the search row uses.
function profileSearchEnqueueMarkKeyOf(mark) {
    return mark?.profileHref || ''
}

// A mark is matched by the profile href of a row.
function profileSearchEnqueueMarkMatchOf(row, mark) {
    return !!row?.href && row.href === mark?.profileHref
}

// The marks of a batch: one per profile (the store's begin takes them; see runBatchNuke in candidateNuke.js).
function profileSearchEnqueueMarkItems(profileHrefs = []) {
    return getNormalizedProfileHrefList(profileHrefs).map(profileHref => ({profileHref}))
}

// requestedAt is when the reply's request was sent. queueRows is the page's copy after the reply was merged, askedHrefs the profiles asked.
// A settled batch's items are trimmed in place, so the batch reference its enqueue holds still matches the array when it is released
// (profileSearchEnqueueMarks.release looks the batch up by identity).
function applyProfileSearchEnqueueMarksToStateReply(requestedAt = 0, askedHrefs = [], queueRows = {}) {
    if(!profileSearchEnqueueMarks.hasBatches()) return
    const rows = Object.entries(queueRows || {}).map(([itemKey, item]) => ({href: getCoordinatorItemProfileHref(itemKey, item) || ''}))
    profileSearchEnqueueMarks.applyToStateReply(requestedAt, askedHrefs, rows)
}

// 'nuking' when a settled batch holds the profile, 'queueing' when only an enqueue in flight does, '' when it is not marked.
function getProfileSearchEnqueueMarkState(profileHref = '') {
    const href = normalizeQuoraProfileHref(profileHref)
    if(!href) return ''
    return profileSearchEnqueueMarks.stateOf(href)
}

// The marked profiles that have no row in the queue copy yet, counted per state. A profile with a pending row is the queue's to count.
function getProfileSearchEnqueueMarkCounts() {
    const nuking = new Set()
    const queueing = new Set()
    for(const batch of profileSearchEnqueueMarks.batches()) {
        for(const {profileHref} of batch.items) {
            if(batch.settledAt > 0) nuking.add(profileHref)
            else queueing.add(profileHref)
        }
    }
    return {
        nuking: [...nuking].filter(href => !isPendingCoordinatorProfileHref(href)).length,
        queueing: [...queueing].filter(href => !nuking.has(href) && !isPendingCoordinatorProfileHref(href)).length
    }
}

function isProfileSearchProfileNukeable(href, options = {}) {
    const normalizedHref = normalizeQuoraProfileHref(href)
    if(!normalizedHref) return false
    // A profile this page has just sent is queueing or nuking, so it is not queueable and gets no second enqueue (owner, 26 Oct).
    if(getProfileSearchEnqueueMarkState(normalizedHref)) return false
    // A profile whose row is queued or nuking in the worker is not queueable, whatever run queued it (26 Oct). A row the batch merged keeps the
    // run that first queued it, so it never matches this page's last run. Treating that as stale counted it queueable here, while the row
    // button and the status beside Nuke 'Em counted it pending. The stale exception is therefore not applied on the search page.
    if(isPendingCoordinatorProfileHref(normalizedHref)) return false

    const record = getProfileNukeProgressRecord(normalizedHref)
    if(!record) return true
    if(isSuccessfulProfileNukeRecord(record)) return false
    if(isSettledProfileNukeRecord(record)) {
        return !!options.allowRetry && isRetryableProfileNukeRecord(record)
    }

    return false
}

function getProfileSearchQueueableRows(rows = getProfileSearchRows(), options = {}) {
    return rows.filter(row => {
        return isProfileSearchProfileNukeable(row.href, options)
    })
}

function getProfileSearchToolbar() {
    let toolbar = document.querySelector('.mb-ext_profile-search-toolbar')
    // A toolbar left by an earlier content script has the old layout, so it is replaced.
    // The Stop collecting button is not in the toolbar any more, so a toolbar that still holds one has the old layout.
    if(toolbar && toolbar.querySelector('.mb-ext_profile-search-collect-wrap') && !toolbar.querySelector('.mb-ext_profile-search-stop-btn')) return toolbar
    toolbar?.remove()

    toolbar = document.createElement('div')
    toolbar.className = 'mb-ext_profile-search-toolbar'

    const batchButton = document.createElement('button')
    batchButton.type = 'button'
    batchButton.className = 'mb-ext_nuke-profiles-btn mb-ext_profile-search-batch-btn'
    toolbar.appendChild(batchButton)

    // The count dropdown is built into the Collect N More button: a transparent select sits over the button's caret.
    const collectWrap = document.createElement('span')
    collectWrap.className = 'mb-ext_profile-search-collect-wrap'
    const collectButton = document.createElement('button')
    collectButton.type = 'button'
    collectButton.className = 'mb-ext_nuke-profiles-btn mb-ext_profile-search-collect-btn'
    collectWrap.appendChild(collectButton)
    collectWrap.appendChild(createProfileSearchCollectLimitSelect())
    toolbar.appendChild(collectWrap)

    document.body.appendChild(toolbar)
    return toolbar
}

// The Stop collecting button. It sits at the bottom of the page, left of Quora's "Next notification" pill, not in the toolbar (owner, 26 Oct).
// It is hidden unless a collect runs (see syncProfileSearchStopButton).
function createProfileSearchStopButton() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mb-ext_nuke-profiles-btn mb-ext_profile-search-stop-btn'
    button.textContent = STOP_COLLECT_LABEL_TEXT
    button.hidden = true
    setMuteBlockHelp(button, 'Stop this collect at its next pass. Profiles already collected stay, and the page goes back to the top')
    return button
}

// Stops the running search collect at its next pass. Its count and items stay. Returns false when no collect runs.
function requestProfileSearchCollectStop() {
    if(!profileSearchCollecting) return false
    profileSearchCollectStopRequested = true
    setNukeButtonWorking(document.querySelector('.mb-ext_profile-search-collect-btn'), 'Stopping...')
    return true
}

// The Stop collecting button shows only while a collect runs. It is added to the page body on first use.
// The Stop collecting label, read from the run's counters (formatCollectStopLabel in candidateCollect.js). It is written only when the text
// changes, so the page's observers are not woken for the same label.
function refreshProfileSearchStopLabel() {
    const stopButton = document.querySelector('.mb-ext_profile-search-stop-btn')
    if(!stopButton || !profileSearchCollecting) return
    const label = formatCollectStopLabel({
        collected: profileSearchCollectProgress.collected,
        target: profileSearchCollectProgress.target,
        passes: profileSearchCollectProgress.passes,
        elapsedMs: Date.now() - profileSearchCollectProgress.startedAt
    })
    if(stopButton.textContent !== label) stopButton.textContent = label
}

function syncProfileSearchStopButton() {
    // The label is re-read once per tick while a run is active (owner, 27 Oct). The tick ends with the run.
    if(profileSearchCollecting && !profileSearchStopLabelTimer) profileSearchStopLabelTimer = setInterval(refreshProfileSearchStopLabel, COLLECT_STOP_LABEL_TICK_MS)
    if(!profileSearchCollecting && profileSearchStopLabelTimer) {
        clearInterval(profileSearchStopLabelTimer)
        profileSearchStopLabelTimer = 0
    }
    let stopButton = document.querySelector('.mb-ext_profile-search-stop-btn')
    if(!stopButton) {
        if(!profileSearchCollecting) return
        stopButton = createProfileSearchStopButton()
        document.body?.appendChild(stopButton)
    }
    const button = ensureCurrentInstanceClickHandler(stopButton, 'profile-search-stop', () => {
        requestProfileSearchCollectStop()
    })
    if(button) button.hidden = !profileSearchCollecting
    refreshProfileSearchStopLabel()
}

// The queue's count of this search's work, beside the batch button (owner, 25 Oct). Nothing is shown when nothing is pending.
// queueingCount is the profiles of a batch whose enqueue is still in flight (owner, 26 Oct): shown as Queueing until the batch settles.
function setProfileSearchNukingStatus(toolbar, count = 0, queueingCount = 0) {
    if(!toolbar) return
    const remaining = Number.parseInt(count, 10) || 0
    const queueing = Number.parseInt(queueingCount, 10) || 0
    // The search's remaining count already holds every pending row (in-progress rows included), so workActive is false here. The same
    // presence rule as the space page then gives the same result: the status shows while anything is left or paused, and hides otherwise.
    const text = formatToolbarNukingStatus({queueing, left: remaining, workActive: false, paused: nukingQueuePaused})
    syncNukingToolbarStatus(toolbar, toolbar.querySelector('.mb-ext_profile-search-batch-btn'), text, remaining)
}

// Owner, 27 Oct: "Considered X displayed matches", X = the distinct result rows the last collect read. Commas only from 1000 up.
function formatProfileSearchConsideredText(count) {
    const rows = Number.parseInt(count, 10) || 0
    const shown = rows >= 1000 ? rows.toLocaleString() : String(rows)
    return `Considered ${shown} displayed matches`
}

// Owner, 27 Oct: the cause under the considered line is the reason the collect-end event records, in plain words. A run with no pass
// (no scan and no scroll) shows Page load instead of the recorded reason.
const PROFILE_SEARCH_CAUSE_LABELS = {
    captured: 'Count reached',
    'end-of-results': 'End of search results',
    'end-of-feed': 'End of search results',
    stalled: 'Stalled',
    stopped: 'Stopped'
}

function formatProfileSearchCollectCause(reason, passes) {
    if(!(Number(passes) > 0)) return 'Page load'
    return PROFILE_SEARCH_CAUSE_LABELS[reason] || ''
}

// Each line sits directly after the one above it: the considered line after the Collect N More wrapper, the cause after the considered line.
// The toolbar wraps each onto its own row, so both show under the button. A line with no text is removed.
function renderProfileSearchTextLine(toolbar, className, text, anchorSelector) {
    const existing = toolbar.querySelector(`.${className}`)
    if(!text) {
        existing?.remove()
        return
    }
    const line = existing || document.createElement('span')
    line.className = className
    if(line.textContent !== text) line.textContent = text
    if(!existing) toolbar.querySelector(anchorSelector)?.insertAdjacentElement('afterend', line)
}

function renderProfileSearchConsideredLine(toolbar) {
    if(!toolbar) return
    renderProfileSearchTextLine(toolbar, 'mb-ext_profile-search-considered', profileSearchConsideredText, '.mb-ext_profile-search-collect-wrap')
    renderProfileSearchTextLine(toolbar, 'mb-ext_profile-search-considered-cause', profileSearchConsideredCause, '.mb-ext_profile-search-considered')
}

// Sets both lines and draws them. Called with no arguments, it clears both (the run start).
function setProfileSearchConsideredText(text = '', cause = '') {
    profileSearchConsideredText = text
    profileSearchConsideredCause = cause
    renderProfileSearchConsideredLine(document.querySelector('.mb-ext_profile-search-toolbar'))
}

function getProfileSearchToolbarButtons() {
    const toolbar = getProfileSearchToolbar()
    return {
        toolbar,
        batch: toolbar.querySelector('.mb-ext_profile-search-batch-btn'),
        collect: toolbar.querySelector('.mb-ext_profile-search-collect-btn'),
        limit: toolbar.querySelector('.mb-ext_profile-search-collect-limit')
    }
}

// The Collect N More count dropdown. Its options come from PROFILE_SEARCH_COLLECT_CHOICES. The toolbar sync sets and reads its value.
function createProfileSearchCollectLimitSelect() {
    const select = document.createElement('select')
    select.className = 'mb-ext_profile-search-collect-limit'
    setMuteBlockHelp(select, 'How many to collect before stopping')
    for(const choice of PROFILE_SEARCH_COLLECT_CHOICES) {
        const option = document.createElement('option')
        option.value = String(choice)
        option.textContent = String(choice)
        select.appendChild(option)
    }
    return select
}

function syncProfileSearchRowButtons(rows = getProfileSearchRows()) {
    const activeHrefs = new Set()

    for(const entry of rows) {
        const href = normalizeQuoraProfileHref(entry.href)
        if(!href) continue

        activeHrefs.add(href)
        entry.row.dataset.mbProfileSearchHref = href

        let host = entry.row.querySelector('.mb-ext_profile-search-action-host')
        if(!host) {
            host = document.createElement('span')
            host.className = 'mb-ext_profile-search-action-host'
            if(entry.followButton?.parentElement) {
                entry.followButton.insertAdjacentElement('afterend', host)
            }
            else {
                entry.row.appendChild(host)
            }
        }
        host.dataset.mbProfileSearchHref = href

        let button = host.querySelector('.mb-ext_profile-search-row-btn')
        if(!button) {
            button = document.createElement('button')
            button.type = 'button'
            button.className = 'mb-ext_nuke-profiles-btn mb-ext_profile-search-row-btn'
            host.appendChild(button)
        }

        button.dataset.mbProfileSearchHref = href
        button = ensureCurrentInstanceClickHandler(button, 'profile-search-row', event => {
            const activeButton = event.currentTarget
            const profileHref = activeButton.dataset.mbProfileSearchHref || ''
            if(!isProfileSearchProfileNukeable(profileHref, {allowRetry: true})) {
                syncProfileSearchControls()
                return
            }

            void nukeProfileSearchHrefs(activeButton, [profileHref], {
                event: 'Queued from profile search row',
                allowRetry: true
            })
        })

        const record = getProfileNukeProgressRecord(href)
        // A profile this page has just sent is queueing until its batch settles, then nuking until the worker's rows show it (owner, 26 Oct).
        const enqueueMarkState = getProfileSearchEnqueueMarkState(href)
        if(enqueueMarkState === 'queueing') {
            setNukeButtonWorking(button, formatProfileRowState('queueing'))
            button.disabled = true
        }
        else if(enqueueMarkState === 'nuking') {
            setNukeButtonWorking(button, formatProfileRowState('nuking'))
            button.disabled = true
        }
        else if(isPendingCoordinatorProfileHref(href)) {
            setNukeButtonWorking(button, formatProfileRowState('nuking'))
            button.disabled = true
        }
        else if(isSuccessfulProfileNukeRecord(record)) {
            setNukeButtonDone(button, formatProfileRowState('nuked'))
            button.disabled = true
        }
        else if(isSettledProfileNukeRecord(record)) {
            if(isRetryableProfileNukeRecord(record)) {
                setNukeButtonIdle(button, 'Retry')
                button.disabled = false
                setMuteBlockHelp(button, `Retry mute and block for ${href}`)
            }
            else {
                setNukeButtonDone(button, NUKED_LABEL)
                button.disabled = true
            }
        }
        else {
            setNukeButtonIdle(button, 'Mute Block')
            button.disabled = false
            setMuteBlockHelp(button, `Queue ${href} for mute and block`)
        }
    }

    for(const host of Array.from(document.querySelectorAll('.mb-ext_profile-search-action-host'))) {
        const href = normalizeQuoraProfileHref(host.dataset.mbProfileSearchHref || '')
        if(!href || !activeHrefs.has(href)) host.remove()
    }
}

function getProfileSearchBatchHrefs(rows = getProfileSearchRows(), options = {}) {
    const stagedHrefs = getProfileSearchStagedHrefs()
    // A staged profile this page has just sent is not counted again (owner, 26 Oct).
    if(stagedHrefs.length) return stagedHrefs.filter(href => !getProfileSearchEnqueueMarkState(href))

    // Nuke 'Em keeps the default count. Only Collect N More takes the count chosen for this search page.
    const limit = Number.parseInt(options.limit, 10) || PROFILE_SEARCH_COLLECT_LIMIT
    return getProfileSearchQueueableRows(rows, {allowRetry: false})
        .slice(0, limit)
        .map(row => row.href)
}

function syncProfileSearchControls() {
    if(getPageType() !== 'profile-search') {
        resetProfileSearchControls()
        return false
    }

    ensureProfileSearchCollectionStateForCurrentSearch()
    const rows = getProfileSearchRows()
    syncProfileSearchRowButtons(rows)

    const buttons = getProfileSearchToolbarButtons()
    const limit = getProfileSearchCollectLimit()
    const batchHrefs = getProfileSearchBatchHrefs(rows)
    // The nuking count is the queue's rows plus the profiles of settled batches the worker has not shown yet. Queueing is the in-flight batches.
    const queuedSearchCount = getPendingCoordinatorProfileSearchWorkCount()
    const enqueueMarks = getProfileSearchEnqueueMarkCounts()
    const pendingSearchCount = queuedSearchCount + enqueueMarks.nuking
    syncProfileSearchStopButton()

    buttons.batch = ensureCurrentInstanceClickHandler(buttons.batch, 'profile-search-batch', event => {
        const activeButton = event.currentTarget

        const hrefs = getProfileSearchBatchHrefs(getProfileSearchRows())
        void (async() => {
            const queued = await nukeProfileSearchHrefs(activeButton, hrefs, {
                event: 'Queued from profile search'
            })
            if(queued) resetProfileSearchCollectionState({keepCursor: true})
            scheduleProfileSearchControls(0)
        })()
    })
    buttons.collect = ensureCurrentInstanceClickHandler(buttons.collect, 'profile-search-collect', event => {
        void collectMoreProfileSearchResults(event.currentTarget)
    })
    buttons.limit = ensureCurrentInstanceClickHandler(buttons.limit, 'profile-search-collect-limit', event => {
        setProfileSearchCollectLimit(Number.parseInt(event.currentTarget.value, 10))
        // Choosing a count only sets it; the collect starts from the Collect button (owner, 26 Oct).
    }, 'change')
    if(buttons.limit) {
        if(buttons.limit.value !== String(limit)) buttons.limit.value = String(limit)
        buttons.limit.disabled = profileSearchCollecting
    }

    if(profileSearchCollecting) {
        setNukeButtonWorking(buttons.collect, buttons.collect.innerText || `Collecting 0 / ${limit}`)
        buttons.collect.disabled = false
        buttons.batch.disabled = !batchHrefs.length
    }
    else if(pendingSearchCount > 0) {
        // Collecting more does not wait for the nukes in progress, so the button is always offered (owner, 21 Oct).
        setNukeButtonIdle(buttons.collect, `Collect ${limit} More`)
        buttons.collect.disabled = false
        buttons.batch.disabled = !batchHrefs.length
        scheduleProfileSearchPendingRefresh()
    }
    else {
        clearProfileSearchPendingRefresh()
        setNukeButtonIdle(buttons.collect, `Collect ${limit} More`)
        buttons.collect.disabled = false
        buttons.batch.disabled = !batchHrefs.length
    }

    if(!profileSearchQueueingBatch) {
        setNukeButtonIdle(buttons.batch, batchHrefs.length ? `Nuke 'Em ${batchHrefs.length}` : 'Nuke \'Em 0')
    }
    // The nuking count is a status beside the batch button (owner, 25 Oct). The button keeps its own label while earlier batches run.
    setProfileSearchNukingStatus(buttons.toolbar, pendingSearchCount, enqueueMarks.queueing)
    renderProfileSearchConsideredLine(buttons.toolbar)
    const hasStagedHrefs = getProfileSearchStagedHrefs().length > 0
    setMuteBlockHelp(buttons.batch, batchHrefs.length
        ? buildNukeTargetsHelpText(hasStagedHrefs
            ? 'Queue collected search profiles'
            : 'Queue currently loaded search profiles with Follow buttons', batchHrefs)
        : 'No currently loaded search profiles with Follow buttons are queueable')
    setMuteBlockHelp(buttons.collect, `Scroll and collect up to ${limit} more profiles before stopping.`)

    return true
}

// A batch enqueue from the search page whose save timed out may still have been queued by the worker. This asks the worker for the run
// and counts what it holds, until the run shows up or PROFILE_SEARCH_ENQUEUE_CONFIRM_TIMEOUT_MS passes. Returns that count, or 0.
async function waitForProfileSearchBatchInQueue(runId, timeoutMs = PROFILE_SEARCH_ENQUEUE_CONFIRM_TIMEOUT_MS) {
    profileSearchLastRunId = runId || profileSearchLastRunId
    const deadline = Date.now() + timeoutMs
    while(Date.now() < deadline) {
        await refreshContentPageCoordinatorStateFromRuntime({force: true})
        const pending = getPendingCoordinatorProfileSearchWorkCount()
        if(pending > 0) return pending
        await sleep(PROFILE_SEARCH_ENQUEUE_CONFIRM_INTERVAL_MS)
    }
    return 0
}

// The batch button: "Queueing N..." while the enqueue settles, then "Nuking N..." while the queue holds the batch (see syncProfileSearchControls).
async function nukeProfileSearchHrefs(button, hrefs = [], options = {}) {
    profileSearchQueueingBatch = true
    try {
        return await nukeProfileSearchHrefsOnce(button, hrefs, options)
    }
    finally {
        profileSearchQueueingBatch = false
    }
}

// The read of a search batch's enqueue reply. A save that timed out on this side can still have landed in the worker, so then the queue, not
// the reply, says what was queued (waitForProfileSearchBatchInQueue). Returns the outcome, or a promise of it when the queue is asked.
function readProfileSearchBatchOutcome(result) {
    const queued = Number.parseInt(result?.executionQueued || result?.queued || result?.merged || 0, 10) || 0
    if(queued < 1 && result?.storageTimedOut === true) {
        return waitForProfileSearchBatchInQueue(result.runId).then(pending => ({settled: pending > 0, queued: pending}))
    }
    return {settled: queued > 0, queued}
}

async function nukeProfileSearchHrefsOnce(button, hrefs = [], options = {}) {
    return runBatchNuke({
        candidates: getNormalizedProfileHrefList(hrefs),
        // The queueable predicate, once per profile. A profile that is marked, queued or nuking, or settled in a way that does not allow a retry, is not queueable.
        queueItemOf: href => (isProfileSearchProfileNukeable(href, {allowRetry: !!options.allowRetry}) ? href : null),
        onEmpty: () => {
            setNukeButtonNotice(button, NOTHING_QUEUED_LABEL, button?.innerText || `Nuke 'Em`)
            scheduleProfileSearchControls(0)
            return false
        },
        onQueued: count => {
            updateOwnedNukeStatusCache({
                ...ownedNukeStatusCache,
                queued: (Number.parseInt(ownedNukeStatusCache?.queued, 10) || 0) + count,
                paused: false
            })
        },
        // The batch's profiles are marked before the enqueue goes out: queueing on their rows and in the toolbar, and out of the count (see
        // profileSearchEnqueueMarkItems).
        markItems: profileSearchEnqueueMarkItems,
        marks: profileSearchEnqueueMarks,
        beforePress: () => syncProfileSearchControls(),
        pressButton: () => animateNukeButtonPress(button),
        setWorking: text => setNukeButtonWorking(button, text),
        // Each chunk settles as its own message, so the remaining count drops chunk by chunk, as on the space page.
        sendBatch: (profileHrefs, onProgress) => enqueueCoordinatorProfileUrls({
            urls: profileHrefs,
            sourceType: 'profile-search',
            event: options.event || 'Queued from profile search',
            maxConcurrent: getProfileSearchProfilesPerBatch(),
            noForegroundFallback: true,
            maxRetries: 2,
            sourceExtra: {
                searchQuery: new URLSearchParams(location.search).get('q') || '',
                sourceLabel: getProfileSearchQueryLabel()
            },
            onProgress
        }),
        readOutcome: result => readProfileSearchBatchOutcome(result),
        refreshAfterEnqueue: profileHrefs => refreshProfileSearchStateAfterEnqueue(profileHrefs),
        afterRelease: () => syncProfileSearchControls(),
        afterSettle: (outcome, result) => {
            if(outcome.settled) {
                // The enqueue is durable, so the marks now show as nuking. They go once the worker has answered the refresh, whatever it showed.
                profileSearchLastRunId = result?.runId || profileSearchLastRunId
                profileSearchLastQueuedAt = Date.now()
                profileSearchLastQueuedCount = outcome.queued
                // The batch button goes back to its idle label, so the batch can be queued again. The nuking count is shown beside it.
                const remainingHrefs = getProfileSearchBatchHrefs(getProfileSearchRows()).length
                setNukeButtonIdle(button, remainingHrefs ? `Nuke 'Em ${remainingHrefs}` : `Nuke 'Em 0`)
                scheduleProfileSearchControls(250)
                scheduleProfileSearchPendingRefresh()
                return true
            }

            // The enqueue failed or queued nothing: its marks go at once (runBatchNuke), so the profiles are queueable again.
            setNukeButtonNotice(button, NOTHING_QUEUED_LABEL, `Nuke 'Em`)
            scheduleProfileSearchControls(250)
            clearProfileSearchPendingRefresh()
            return false
        },
        afterFinish: () => syncProfileSearchControls()
    })
}

// Owner, 26 Oct: after a search enqueue settles, the page asks for the state of the batch's profiles again, so the worker's rows replace the
// marks. The batch's profiles are asked by name, not left to the rows on the page. A refresh already in flight was asked before the enqueue,
// so its reply is waited for first (as refreshSpaceFeedStateAfterEnqueue does).
async function refreshProfileSearchStateAfterEnqueue(profileHrefs = []) {
    if(contentPageStateRefreshPromise) await contentPageStateRefreshPromise.catch(() => false)
    return refreshContentPageCoordinatorStateFromRuntime({force: true, profileHrefs})
}

async function collectMoreProfileSearchResults(button) {
    const limit = getProfileSearchCollectLimit()
    if(profileSearchCollecting) {
        profileSearchCollectStopRequested = true
        setNukeButtonWorking(button, 'Stopping...')
        return false
    }

    ensureProfileSearchCollectionStateForCurrentSearch()
    // Each run starts with its own stop flag cleared, so a stop from an earlier run cannot end this one.
    profileSearchCollecting = true
    profileSearchCollectStopRequested = false
    profileSearchCollectProgress = {startedAt: Date.now(), passes: 0, collected: 0, target: limit}
    // A new run clears the Considered line from the last run (owner, 27 Oct).
    setProfileSearchConsideredText('')
    // The distinct result row elements this run has read, over all its passes (owner, 27 Oct: rows, not unique profiles).
    const consideredRows = new Set()
    syncProfileSearchStopButton()
    const initialStagedCount = getProfileSearchStagedHrefs().length
    const targetStagedCount = initialStagedCount + limit
    let collectedCount = 0
    let endReached = false

    profileSearchProcessedFollowButtons = new WeakSet()
    await animateNukeButtonPress(button)
    // First operation: go to the end of the results, so the next batch loads. The loop then scrolls down from there.
    // A stop pressed during the animation skips it.
    if(!profileSearchCollectStopRequested) window.scrollTo({top: document.documentElement.scrollHeight, behavior: 'auto'})

    try {
        // The shared loop (runCollectLoop in candidateCollect.js) makes the passes. This page's pass reads and stages the rows in view, and
        // checks for the end of the results before it nudges the lazy load; the wait is COLLECT_SCROLL_PASS_WAIT_MS. The end check stays in
        // the pass, so the page is checked at the end before the nudge and the wait, as before. Stall: COLLECT_STALLED_TIMEOUT_MS at any position.
        const outcome = await runCollectLoop({
            isStopRequested: () => profileSearchCollectStopRequested,
            isDone: () => collectedCount >= limit,
            snapshot: () => ({count: collectedCount, scrollY: getProfileSearchScrollY(), scrollHeight: getProfileSearchScrollHeight()}),
            pass: () => {
                const rows = getProfileSearchRows({fromCurrentViewport: true, skipProcessed: true})
                for(const row of rows) consideredRows.add(row.row)
                for(const row of getProfileSearchQueueableRows(rows, {allowRetry: false})) {
                    if(collectedCount >= limit) break
                    collectedCount += stageProfileSearchHrefs([row.href])
                }

                for(const row of rows) profileSearchProcessedFollowButtons.add(row.followButton)
                saveProfileSearchCollectCursor(rows)
                // A pass counts once its read has run, so the label's count and passes always describe the same reads.
                profileSearchCollectProgress.collected = collectedCount
                profileSearchCollectProgress.passes += 1
                setNukeButtonWorking(button, `Collecting ${getProfileSearchStagedHrefs().length} / ${targetStagedCount}`)
                syncProfileSearchControls()

                if(collectedCount >= limit) return 'done'
                if(isProfileSearchEndOfResultsVisible() && !hasUnstagedProfileSearchQueueableRow() && !hasProfileSearchLoadingIndicator()) return 'end'

                nudgeProfileSearchLazyLoad()
            },
            sleep,
            waitMs: COLLECT_SCROLL_PASS_WAIT_MS,
            readProgress: () => {
                profileSearchCollectCursorScrollY = Math.max(profileSearchCollectCursorScrollY, getProfileSearchScrollY())
            },
            madeProgress: collectPassMadeProgress,
            stallTimeoutMs: COLLECT_STALLED_TIMEOUT_MS
        })
        endReached = outcome === 'end'

        const endReason = profileSearchCollectStopRequested ? 'stopped' : collectedCount >= limit ? 'captured' : endReached ? 'end-of-results' : 'stalled'
        reportCollectEnd('search', {
            reason: endReason,
            collected: collectedCount,
            limit,
            passes: profileSearchCollectProgress.passes,
            startedAt: profileSearchCollectProgress.startedAt,
            considered: consideredRows.size
        })
        setProfileSearchConsideredText(
            formatProfileSearchConsideredText(consideredRows.size),
            formatProfileSearchCollectCause(endReason, profileSearchCollectProgress.passes)
        )
        if(profileSearchCollectStopRequested) {
            // Owner: a stopped collect takes the page back to the top. The collected results stay.
            window.scrollTo({top: 0, behavior: 'auto'})
            setNukeButtonNotice(button, 'Stopped', `Collect ${limit} More`)
            return false
        }

        if(collectedCount < 1) {
            setNukeButtonNotice(button, 'No new candidates', `Collect ${limit} More`)
            return false
        }

        setNukeButtonNotice(button, endReached ? `Collected ${collectedCount} · end of search results` : `Collected ${collectedCount}`, `Collect ${limit} More`)
        return true
    }
    finally {
        profileSearchCollecting = false
        profileSearchCollectStopRequested = false
        syncProfileSearchStopButton()
        scheduleProfileSearchControls(0)
    }
}

function injectModalOpenProfilesBtn() {
    const modal = syncActiveProfileModal(getProfilePeopleModal())
    if(!modal) return

    const openItems = getOpenableProfileModalItems(modal)
    const nukeItems = getNukeableProfileModalItems(modal)
    const isModalNuking = modal.dataset.mbNuking === 'true'
    if(!openItems.length && !nukeItems.length && !isModalNuking) {
        modal.querySelector('.mb-ext_open-profiles-btn')?.remove()
        modal.querySelector('.mb-ext_nuke-profiles-btn')?.remove()
        return
    }

    let dismissBtn = modal.querySelector('button[aria-label="Dismiss"]')
    if(!dismissBtn?.parentElement) return

    let btn = modal.querySelector('.mb-ext_open-profiles-btn')
    if(!btn && openItems.length) {
        btn = document.createElement('button')
        btn.classList.add('mb-ext_open-profiles-btn')
        dismissBtn.parentElement.insertAdjacentElement('beforeend', btn)
    }

    if(btn && openItems.length) {
        btn = ensureCurrentInstanceClickHandler(btn, 'modal-open-profiles', () => openModalProfiles())
        btn.innerHTML = `${getModalOpenProfilesLabel(modal)} <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
        <path d="M11 13l9 -9" />
        <path d="M15 4h5v5" />
    </svg>`
        btn.disabled = isModalNuking
        setMuteBlockHelp(btn, 'Open listed profiles from this modal in background tabs')
    }
    else {
        btn?.remove()
    }

    let nukeBtn = modal.querySelector('.mb-ext_nuke-profiles-btn')
    if(!nukeBtn && (nukeItems.length || isModalNuking)) {
        nukeBtn = document.createElement('button')
        nukeBtn.innerText = `Nuke 'Em`
        nukeBtn.classList.add('mb-ext_nuke-profiles-btn')
        dismissBtn.parentElement.insertAdjacentElement('beforeend', nukeBtn)
    }

    if(nukeBtn && (nukeItems.length || isModalNuking)) {
        nukeBtn = ensureCurrentInstanceClickHandler(nukeBtn, 'modal-nuke-profiles', () => void nukeModalProfiles())
        if(isModalNuking) {
            setNukeButtonWorking(nukeBtn)
            nukeBtn.disabled = true
        }
        else if(nukeBtn.dataset.mbNukeState !== 'working') {
            setNukeButtonIdle(nukeBtn)
            nukeBtn.disabled = false
        }
        setMuteBlockHelp(nukeBtn, buildNukeTargetsHelpText('Queue listed profiles from this modal for mute and block', getModalProfileLinks(nukeItems)))
    }
    else if(nukeBtn) {
        setNukeButtonDone(nukeBtn)
        nukeBtn.disabled = true
    }
}

function getModalOpenProfilesLabel(modal = getProfilePeopleModal()) {
    const tabLabel = getActiveProfileModalTabLabel(modal)

    if(tabLabel === 'Followers') return 'Open Followers'
    if(tabLabel === 'Following') return 'Open Following'
    return 'Open Profiles'
}

function getProfilesPerBatch() {
    const value = Number.parseInt(settings.profilesPerBatch, 10)
    if(!Number.isFinite(value) || value < 1) return defaults.profilesPerBatch
    return value
}

function getSpaceFeedProfilesPerBatch() {
    return CANDIDATE_BATCH_PROFILES_PER_BATCH
}

function getProfileSearchProfilesPerBatch() {
    const value = Number.parseInt(settings.profilesPerBatch, 10)
    if(!Number.isFinite(value) || value < 1) return CANDIDATE_BATCH_PROFILES_PER_BATCH
    return Math.min(value, CANDIDATE_BATCH_PROFILES_PER_BATCH)
}

function getModalProfileNukeProfilesPerBatch() {
    const value = Number.parseInt(settings.profilesPerBatch, 10)
    if(!Number.isFinite(value) || value < 1) return MODAL_PROFILE_NUKE_PROFILES_PER_BATCH
    return Math.min(value, MODAL_PROFILE_NUKE_PROFILES_PER_BATCH)
}

function getModalProfileActionButtons(modal = getProfilePeopleModal()) {
    return {
        open: modal?.querySelector('.mb-ext_open-profiles-btn') || null,
        nuke: modal?.querySelector('.mb-ext_nuke-profiles-btn') || null
    }
}

function disableModalProfileActionButtons(modal, nukeText = 'Nuking...') {
    const buttons = getModalProfileActionButtons(modal)

    if(buttons.open) {
        buttons.open.disabled = true
        buttons.open.innerText = 'Please wait...'
    }

    if(buttons.nuke) {
        buttons.nuke.disabled = true
        setNukeButtonWorking(buttons.nuke, nukeText)
    }
}

function resetModalProfileActionButtons(modal) {
    const buttons = getModalProfileActionButtons(modal)

    if(buttons.open) {
        buttons.open.disabled = false
        buttons.open.innerHTML = `${getModalOpenProfilesLabel(modal)} <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
            <path d="M11 13l9 -9" />
            <path d="M15 4h5v5" />
        </svg>`
    }

    if(buttons.nuke) {
        buttons.nuke.disabled = false
        if(buttons.nuke.dataset.mbNukeState === 'done') {
            setNukeButtonDone(buttons.nuke)
        }
        else {
            setNukeButtonIdle(buttons.nuke)
        }
    }
}

function getHandledProfileModalItems(modal = getProfilePeopleModal()) {
    modal = syncActiveProfileModal(modal)
    return getProfileModalItems(modal).filter(isModalItemHandled)
}

function getModalProfileLinks(items) {
    return getNormalizedProfileHrefList((items || []).filter(isModalItemQueueable).map(item => getModalItemProfileHref(item)))
}

function getProfileModalScrollContainer(modal = getProfilePeopleModal()) {
    if(!modal) return null

    const candidates = [modal, ...Array.from(modal.querySelectorAll('*'))]
        .filter(element => {
            if(!isVisible(element)) return false
            if(element.scrollHeight <= element.clientHeight + 20) return false

            const style = getComputedStyle(element)
            return /(auto|scroll|overlay)/i.test(`${style.overflowY || ''}`) ||
                element.querySelectorAll?.('[role="listitem"]').length > 0
        })
        .map(element => ({
            element,
            listItems: element.querySelectorAll?.('[role="listitem"]').length || 0,
            scrollable: Math.max(0, element.scrollHeight - element.clientHeight)
        }))
        .filter(candidate => candidate.scrollable > 0)

    candidates.sort((left, right) => {
        if(!!right.listItems !== !!left.listItems) return right.listItems - left.listItems
        return right.scrollable - left.scrollable
    })

    return candidates[0]?.element || null
}

function getProfileModalScrollSignature(modal = getProfilePeopleModal()) {
    const scroller = getProfileModalScrollContainer(modal)
    if(!scroller) return 'no-scroll'

    return [
        Math.round(scroller.scrollTop),
        Math.round(scroller.scrollHeight),
        Math.round(scroller.clientHeight),
        getProfileModalItems(modal).map(getModalItemProfileHref).filter(Boolean).join('|')
    ].join(':')
}

async function scrollProfileModalForMore(modal = getProfilePeopleModal()) {
    const scroller = getProfileModalScrollContainer(modal)
    if(!scroller) return false

    const beforeTop = scroller.scrollTop
    const beforeHeight = scroller.scrollHeight
    const beforeSignature = getProfileModalScrollSignature(modal)
    const maxTop = Math.max(0, beforeHeight - scroller.clientHeight)
    const step = Math.max(240, Math.round(scroller.clientHeight * 0.85))
    const nextTop = Math.min(maxTop, beforeTop + step)

    if(nextTop > beforeTop + 1) {
        scroller.scrollTop = nextTop
    }
    else {
        scroller.scrollTop = maxTop
    }

    scroller.dispatchEvent(new Event('scroll', {bubbles: true}))
    scroller.dispatchEvent(new WheelEvent('wheel', {bubbles: true, deltaY: step}))
    await sleep(MODAL_PROFILE_NUKE_SCROLL_WAIT_MS)

    return scroller.scrollTop > beforeTop + 1 ||
        scroller.scrollHeight > beforeHeight + 1 ||
        getProfileModalScrollSignature(modal) !== beforeSignature
}

function openModalProfiles(afterTimeout = false) {
    const modal = syncActiveProfileModal(getProfilePeopleModal())
    if(!modal) return

    const openProfiles = items => {
        for (const item of items) {
            let link = getModalItemProfileHref(item)
            if(!link) continue

            void safeSendRuntimeMessage({action: 'create-tab', url: link})
            item.scrollIntoView({block: 'nearest'})
        }

        markModalItemsHandled(items, '#d4edda')
    }

    const listItems = getOpenableProfileModalItems(modal)

    let openProfilesBtn = getModalProfileActionButtons(modal).open
    if(!openProfilesBtn) return

    if(afterTimeout) {
        openProfilesBtn.remove()
        openProfiles(listItems)
    }
    else {
        resetModalProfileActionButtons(modal)

        const profilesPerBatch = getProfilesPerBatch()

        if(listItems.length < profilesPerBatch) {
            let openedItems = getHandledProfileModalItems(modal)

            if(openedItems.length) {
                profilesModalTimeout = setTimeout(openModalProfiles, 5000, true)

                disableModalProfileActionButtons(modal)

                openedItems[openedItems.length - 1].scrollIntoView({block: 'nearest'})
            }
            else {
                openProfilesBtn.remove()
                openProfiles(listItems)
            }
        }
        else {
            openProfiles(Array.from(listItems).slice(0, profilesPerBatch))
        }
    }
}

async function nukeModalProfiles() {
    const modal = syncActiveProfileModal(getProfilePeopleModal())
    if(!modal) return

    if(modal.dataset.mbNuking === 'true') return

    let items = getNukeableProfileModalItems(modal)
    if(!items.length) {
        const buttons = getModalProfileActionButtons(modal)
        setNukeButtonDone(buttons.nuke, 'Rubble')
        return
    }

    const buttons = getModalProfileActionButtons(modal)
    await animateNukeButtonPress(buttons.nuke)
    modal.dataset.mbNuking = 'true'
    disableModalProfileActionButtons(modal)

    try {
        const maxConcurrent = getModalProfileNukeProfilesPerBatch()
        const queueLimit = maxConcurrent
        const urlsToQueue = []
        const queuedUrls = new Set()
        let idlePasses = 0

        while(idlePasses < MODAL_PROFILE_NUKE_IDLE_SCROLL_PASSES &&
            urlsToQueue.length < queueLimit) {
            items = getNukeableProfileModalItems(modal)

            if(items.length) {
                const urls = getModalProfileLinks(items).filter(url => !queuedUrls.has(url))

                if(urls.length) {
                    for(const url of urls) {
                        if(urlsToQueue.length >= queueLimit) break
                        queuedUrls.add(url)
                        urlsToQueue.push(url)
                    }

                    const queuedUrlSet = new Set(urlsToQueue)
                    markModalItemsNukeQueued(items.filter(item => queuedUrlSet.has(getModalItemProfileHref(item))), '#f8d7da')
                    idlePasses = 0
                    items[items.length - 1].scrollIntoView({block: 'nearest'})
                    if(urlsToQueue.length < queueLimit && await scrollProfileModalForMore(modal)) {
                        idlePasses = 0
                    }
                }
                else {
                    idlePasses += 1
                }
            }
            else {
                if(await scrollProfileModalForMore(modal)) {
                    idlePasses = 0
                }
                else {
                    idlePasses += 1
                }
            }

            if(idlePasses < MODAL_PROFILE_NUKE_IDLE_SCROLL_PASSES) await sleep(MODAL_PROFILE_NUKE_SCROLL_WAIT_MS)
        }

        if(urlsToQueue.length) {
            const result = await enqueueCoordinatorProfileUrls({
                urls: urlsToQueue,
                sourceType: 'profile-modal',
                event: 'Queued from modal',
                noForegroundFallback: false,
                maxConcurrent
            })

            if((result?.executionQueued || result?.queued || result?.merged || 0) <= 0) {
                await sweepBlockedProfileTabs()
            }

            await waitForOwnedNukeTabsToDrain(buttons.nuke, 180000, 1000, {runId: result?.runId || ''})
        }
    }
    finally {
        delete modal.dataset.mbNuking

        if(getUnhandledProfileModalItems(modal).length || getNukeableProfileModalItems(modal).length) {
            resetModalProfileActionButtons(modal)
        }
        else {
            const buttons = getModalProfileActionButtons(modal)
            buttons.open?.remove()
            buttons.nuke?.remove()
        }
    }
}

// Measurement only (review-2 C-3). Each claim retry loop reports to the worker once, the first time it reaches
// CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES passes on this page. No loop stops at that count, so it sets no ceiling.
const claimRetryPassCounts = {}
// Measurement only (owner, 15 Oct): the live-check card counts these in the worker. Nothing is decided from them here.
function noteLiveCheck(check) {
    void safeSendRuntimeMessage({
        action: 'content-live-check',
        check
    }).catch(() => null)
}

function noteClaimRetryPass(loop) {
    const passes = (claimRetryPassCounts[loop] || 0) + 1
    claimRetryPassCounts[loop] = passes
    if(passes !== CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES) return

    void safeSendRuntimeMessage({
        action: 'content-claim-retry-hit',
        loop,
        passes,
        href: location.href
    }).catch(() => null)
}

async function maybeRunAutoProfileAction() {
    if(autoProfileActionPending || autoProfileActionClaimPending) return

    maybeReportCloudflareChallenge()

    if(autoProfileAction === undefined) {
        autoProfileActionAttempts += 1
        if(getPageType() === 'profile' && !coordinatorQueueLoaded) {
            // init() only calls refreshCoordinatorQueueFromRuntime once, with
            // a 3s budget -- if the SW is busy right at page load (e.g. mid
            // reconcile of a large backlog) that one attempt can time out,
            // and nothing else ever retries it. Without this, that leaves
            // coordinatorQueueLoaded permanently false for the rest of this
            // page's life, so this branch loops forever re-checking the same
            // stale flag and claim-tab-action is never even attempted --
            // even though other message handlers (close-if-blocked) keep
            // responding fine, since they don't depend on this flag. Kicking
            // the sync again here (it has its own throttle/dedup) gives a
            // transient SW hiccup a chance to self-heal instead of stranding
            // the tab for its full retry-budget lifetime.
            void refreshContentPageCoordinatorStateFromRuntime()
            noteClaimRetryPass('queue-not-loaded')
            setTimeout(() => void maybeRunAutoProfileAction(), QUEUED_ACTION_CLAIM_FAST_RETRY_DELAY_MS)
            return
        }
    }

    if(autoProfileAction === undefined) {
        autoProfileActionClaimPending = true
        try {
            autoProfileAction = await safeSendRuntimeMessageWithTimeout({
                action: 'claim-tab-action'
            }, null, QUEUED_ACTION_CLAIM_MESSAGE_TIMEOUT_MS)
        }
        finally {
            autoProfileActionClaimPending = false
        }

        if(!autoProfileAction) {
            autoProfileAction = undefined
            // The claim found no action, so a push held during the claim has nothing else to run it: take it.
            if(releaseHeldQueuedProfileActionClaim()) return
            const shouldKeepRetrying = autoProfileActionAttempts < QUEUED_ACTION_CLAIM_FAST_ATTEMPTS ||
                hasCurrentProfilePendingCoordinatorQueueItem()
            if(shouldKeepRetrying) {
                const retryDelay = autoProfileActionAttempts < QUEUED_ACTION_CLAIM_FAST_ATTEMPTS
                    ? QUEUED_ACTION_CLAIM_FAST_RETRY_DELAY_MS
                    : QUEUED_ACTION_CLAIM_SLOW_RETRY_DELAY_MS
                noteClaimRetryPass('claim-retry')
                setTimeout(() => void maybeRunAutoProfileAction(), retryDelay)
                scheduleCurrentProfilePendingClaimRescue(retryDelay)
            }
            return
        }
        // The tab's own claim answered with an action: that is the worker's current assignment, so a push held during the claim is superseded.
        heldQueuedClaim = null
    }

    const claimedAction = typeof autoProfileAction === 'string'
        ? {action: autoProfileAction, targetUrl: ''}
        : autoProfileAction

    if(claimedAction?.action !== 'nuke' && claimedAction?.action !== UNBLOCK_UNMUTE_ACTION_KIND) {
        autoProfileAction = undefined
        if(hasCurrentProfilePendingCoordinatorQueueItem()) {
            noteClaimRetryPass('pending-item-retry')
            setTimeout(() => void maybeRunAutoProfileAction(), QUEUED_ACTION_CLAIM_SLOW_RETRY_DELAY_MS)
            scheduleCurrentProfilePendingClaimRescue()
        }
        return
    }
    const claimedActionSurfaceMode = `${claimedAction?.actionSurfaceMode || ''}`.trim()
    const allowForegroundFallback = !claimedAction?.noForegroundFallback || claimedActionSurfaceMode === 'worker-window'
    const claimedActionKind = claimedAction?.action === UNBLOCK_UNMUTE_ACTION_KIND
        ? UNBLOCK_UNMUTE_ACTION_KIND
        : 'mute-block'

    autoProfileActionPending = true
    queuedTabFinishing = false
    autoProfileAction = null
    autoProfileActionAttempts = 0

    // The claimed target is canonical, so it is read as stored (1 Nov). The page URL is a live input and is normalized once.
    let queuedProfileHref = storedProfileHref(claimedAction?.targetUrl || '') || normalizeQuoraProfileHref(location.href) || ''
    activeQueuedAttemptId = `${claimedAction?.attemptId || ''}`.trim()
    activeQueuedAttemptNumber = Number.parseInt(claimedAction?.attemptNumber, 10) || 0
    activeQueuedAttemptProfileHref = queuedProfileHref
    activeQueuedNoForegroundFallback = claimedAction?.noForegroundFallback === true
    activeQueuedActionSurfaceMode = claimedActionSurfaceMode
    const recordQueuedProfileProgress = patch => {
        const resolvedProfileHref = getPageType() === 'profile'
            ? normalizeQuoraProfileHref(location.href)
            : ''
        const remappedFromRequested = !!(queuedProfileHref && resolvedProfileHref && queuedProfileHref !== resolvedProfileHref)
        const securityVerificationReason = getSecurityVerificationReason()
        const sharedPatch = {
            lastUrl: location.href,
            resolvedProfileHref: resolvedProfileHref || '',
            remappedFromRequested,
            pageType: getPageType() || 'unknown',
            actionKind: claimedActionKind,
            securityVerification: !!securityVerificationReason,
            securityVerificationReason,
            unavailableReason: getProfileUnavailableReason() || '',
            ...patch
        }

        return queuedProfileHref
            ? recordProfileNukeProgress(queuedProfileHref, sharedPatch)
            : recordCurrentProfileNukeProgress(sharedPatch)
    }

    try {
        await recordQueuedProfileProgress({
            status: 'tab-opened',
            // tabOpenedAt is not sent here: the worker stamped it when it opened the tab (tab-opening), and it is the start of the Load
            // phase. Sending the report time as well made Load zero by construction (24 Oct).
            contentOpenedAt: Date.now(),
            openedViablePage: false,
            closeRequestedAt: 0,
            closedByExtension: false,
            closeReason: '',
            tabClosedAt: 0,
            slotReleasedAt: 0,
            finalError: '',
            errorPageUrl: '',
            event: 'Queued tab opened'
        })

        if(document.visibilityState !== 'visible') {
            await recordQueuedProfileProgress({
                event: 'Queued tab opened in the background; continuing without waiting for visibility'
            })
        }

        let queuedTabReleased = false
        const releaseQueuedTabSlot = async () => {
            if(queuedTabReleased) return true
            queuedTabReleased = await notifyQueuedTabComplete()
            return queuedTabReleased
        }
        const closeQueuedBlockedTab = async (patch = {}) => {
            const swept = await sweepServiceWorkerBlockedProfileTabs().catch(() => ({signaled: 0}))
            if(swept.signaled) {
                return true
            }

            const foundBlockedBeforeQueue = !!patch.foundBlockedBeforeQueue
            const progress = await recordQueuedProfileProgress({
                status: foundBlockedBeforeQueue ? 'already-blocked' : 'blocked',
                blockSucceeded: true,
                blockedAt: Date.now(),
                finalError: '',
                event: foundBlockedBeforeQueue ? 'Profile confirmed already blocked' : 'Profile confirmed blocked',
                ...patch
            })
            if(progress?.serviceWorkerOnly && !progress.runtimeRecorded) {
                markQueuedTabFinishing()
                console.info('Queued terminal success was not recorded; leaving tab open for retry')
                setTimeout(() => {
                    void sweepServiceWorkerBlockedProfileTabs()
                }, 1000)
                return false
            }
            // Owner, 23 Oct: close first. The worker only accepts the close while this tab still owns the attempt, and releasing the slot
            // first ended that ownership, so the close was refused and the tab waited for the orphan sweep. The worker's close also
            // releases the slot, so the slot is released here only when the close did not happen.
            const closed = await requestCloseTab()
            if(!closed) await releaseQueuedTabSlot()
            return true
        }
        const skipQueuedUnavailableTab = async message => {
            console.info(message)
            const unavailableReason = getProfileUnavailableReason() || message
            // Quora banned or deactivated the account itself (Oct 31). The profile is not blocked by this run, so it is recorded as a skip
            // with the reason, not as a new block. profile-unavailable is terminal, so the profile is not queued again.
            const enforced = unavailableReason === 'Profile banned' || unavailableReason === 'Profile deactivated'
            await recordQueuedProfileProgress({
                status: 'profile-unavailable',
                openedViablePage: false,
                finalError: enforced ? unavailableReason : message,
                unavailableReason,
                blockReason: unavailableReason === 'Profile banned' ? 'quora-banned' : unavailableReason === 'Profile deactivated' ? 'quora-deactivated' : '',
                event: enforced ? `Quora has ${unavailableReason === 'Profile banned' ? 'banned' : 'deactivated'} this profile; skipped, not blocked` : message
            })
            await releaseQueuedTabSlot()
            await requestCloseTab(2, 100, true)
        }
        const abandonQueuedTab = async (message, extraPatch = {}) => {
            console.info(message)
            if(/\bdid not land on a profile page\b/.test(`${message || ''}`)) noteLiveCheck('did-not-land')
            await recordQueuedProfileProgress({
                status: 'error',
                openedViablePage: false,
                finalError: message,
                errorPageUrl: location.href,
                event: message,
                ...extraPatch
            })
            await failCurrentQueuedProfile(getResolvedSpaceFeedProfileHrefs(queuedProfileHref || location.href))
            await releaseQueuedTabSlot()
            await requestCloseTab(2, 100, true)
        }
        const abandonQueuedResolution = async message => {
            console.info(message)
            await safeSendRuntimeMessageWithTimeout({
                action: 'resolve-queued-profile-target-failed',
                coordinatorKey: claimedAction?.coordinatorKey || '',
                requestedUrl: claimedAction?.requestedUrl || location.href,
                resolutionReason: claimedAction?.resolutionReason || '',
                error: message,
                outcome: 'unresolved-target',
                attemptId: activeQueuedAttemptId || '',
                attemptNumber: activeQueuedAttemptNumber || 0
            }, null, QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS)
            await releaseQueuedTabSlot()
            await requestCloseTab(2, 100, true)
        }
        const resolveQueuedProfileFromCurrentPage = async () => {
            if(!canResolveQueuedProfileFromCurrentPage(claimedAction)) return false

            let resolvedProfileHref = ''
            let resolvedSource = ''
            for(let attempt = 0; attempt < 10; attempt += 1) {
                const resolution = {}
                resolvedProfileHref = normalizeQuoraProfileHref(getQueuedPageResolvedProfileHref(claimedAction, resolution) || '') || ''
                resolvedSource = resolution.source || ''
                if(resolvedProfileHref) break
                await sleep(350 + attempt * 100)
            }

            if(!resolvedProfileHref) return false

            const response = await sendQueuedProfileResolutionMessageWithRetry({
                action: 'resolve-queued-profile-target',
                coordinatorKey: claimedAction?.coordinatorKey || '',
                requestedUrl: claimedAction?.requestedUrl || location.href,
                profileHref: resolvedProfileHref,
                resolutionSource: resolvedSource,
                attemptId: activeQueuedAttemptId || '',
                attemptNumber: activeQueuedAttemptNumber || 0
            })

            if(response?.resolved !== true) return false

            queuedProfileHref = resolvedProfileHref
            activeQueuedAttemptProfileHref = resolvedProfileHref
            await recordQueuedProfileProgress({
                status: 'tab-opened',
                openedViablePage: false,
                resolvedProfileHref,
                remappedFromRequested: true,
                closeRequestedAt: 0,
                closedByExtension: false,
                closeReason: '',
                tabClosedAt: 0,
                slotReleasedAt: 0,
                finalError: '',
                errorPageUrl: '',
                event: `Resolved queued page target to ${resolvedProfileHref}`
            })
            location.replace(resolvedProfileHref)
            return true
        }
        const isQueuedResolutionAction = () => {
            return claimedAction?.resolveProfileFromPage === true ||
                `${claimedAction?.resolutionMode || ''}`.trim() === QUEUED_PROFILE_RESOLUTION_MODE
        }
        // 31 Oct: a queued resolution that lands on a question page (a short link redirects there, or a cited question) names no profile on
        // that page. The question's log names the asker, so the same tab goes to the log and the log page reads the poster. The claim is kept
        // per tab, so the action carries over the navigation, as the resolved-profile hand-off below does.
        const continueQueuedResolutionToQuestionLog = async () => {
            if(getPageType() !== 'question' || !isQueuedResolutionAction()) return false

            const logHref = getQuestionLogHref()
            await recordQueuedProfileProgress({event: `Question page reached, chasing to its log: ${logHref}`})
            location.replace(logHref)
            return true
        }
        let queuedActionLeaseHeld = false
        let queuedActionLeaseDeniedReason = ''
        const beginQueuedProfileAction = async (reason, readyPredicate = null) => {
            const waitStartedAt = Date.now()
            let lastCoordinatorProgressAt = waitStartedAt
            let lastWaitEventAt = 0
            let waitingForActionLeaseAt = 0
            queuedActionLeaseDeniedReason = ''

            const recordActionGateProgress = async patch => {
                const now = Date.now()
                const progress = await recordQueuedProfileProgress({
                    foregroundWaitLastEventAt: now,
                    ...patch
                })
                if(progress?.runtimeRecorded) lastCoordinatorProgressAt = now
                return progress
            }

            const getMatchingActionGateProgress = () => {
                const record = getProfileNukeProgressRecord(queuedProfileHref || location.href)
                if(!record) return null

                const recordAttemptId = getAttemptIdFromValue(record)
                if(activeQueuedAttemptId && recordAttemptId && recordAttemptId !== activeQueuedAttemptId) return null

                const recordAttemptNumber = getAttemptNumberFromValue(record)
                if(activeQueuedAttemptNumber && recordAttemptNumber && recordAttemptNumber !== activeQueuedAttemptNumber) return null

                return record
            }

            const canProceedWithoutForegroundGate = () => {
                const readyForLocalAction = typeof readyPredicate !== 'function' ||
                    readyPredicate() ||
                    !!getProfileUnavailableReason()
                if(!readyForLocalAction) return false

                return !allowForegroundFallback ||
                    (claimedActionSurfaceMode === 'worker-window' && document.visibilityState === 'visible')
            }

            const beginLocalNoForegroundActionGate = async () => {
                if(document.visibilityState === 'visible' || claimedAction?.noForegroundFallback !== true) return false

                const readyNow = typeof readyPredicate !== 'function' ||
                    readyPredicate() ||
                    !!getProfileUnavailableReason()
                const readySoon = readyNow || await waitForCondition(
                    () => typeof readyPredicate !== 'function' || readyPredicate() || !!getProfileUnavailableReason(),
                    Math.min(FOREGROUND_PROMOTION_MESSAGE_TIMEOUT_MS, 2500),
                    100
                )
                if(!readySoon) return false

                return waitForProfileActionReadiness({
                    begun: true,
                    granted: true,
                    localActionGateFallback: true,
                    localNoForegroundGate: true,
                    foregroundLeaseAcquiredAt: Date.now()
                })
            }

            const getRecoveredBeginResponseFromProgress = () => {
                const record = getMatchingActionGateProgress()
                if(!record) return null

                const foregroundPromotedAt = Number.parseInt(record.foregroundPromotedAt, 10) || 0
                const foregroundLeaseAcquiredAt = Number.parseInt(record.foregroundLeaseAcquiredAt, 10) || 0
                if(Math.max(foregroundPromotedAt, foregroundLeaseAcquiredAt) < waitStartedAt) return null

                const foregroundPromotionReason = `${record.foregroundPromotionReason || ''}`.trim()
                if(foregroundPromotionReason && reason && foregroundPromotionReason !== reason) return null

                return {
                    begun: true,
                    granted: true,
                    recoveredFromBeginTimeout: true,
                    foregroundLeaseAcquiredAt: foregroundLeaseAcquiredAt || foregroundPromotedAt || Date.now(),
                    foregroundPromotedAt: foregroundPromotedAt || foregroundLeaseAcquiredAt || Date.now()
                }
            }

            const waitForProfileActionReadiness = async response => {
                queuedActionLeaseHeld = response?.localActionGateFallback !== true
                lastCoordinatorProgressAt = Date.now()

                await recordActionGateProgress({
                    waitingForForegroundAt: 0,
                    foregroundWaitReason: '',
                    foregroundLeaseAcquiredAt: response?.foregroundLeaseAcquiredAt || response?.actionLease?.grantedAt || Date.now(),
                    foregroundPromotedAt: response?.foregroundPromotedAt || 0,
                    foregroundPromotionReason: `${reason || ''}`.trim(),
                    event: response?.workerWindowActionGate
                        ? 'Queued tab proceeded locally using the background window'
                        : response?.localNoForegroundGate
                        ? 'Queued tab proceeded locally without foreground action gate'
                        : response?.localActionGateFallback
                        ? 'Queued tab proceeded locally after durable profile action gate timeout'
                        : response?.recoveredFromBeginTimeout
                        ? 'Queued tab recovered durable profile action gate after begin timeout'
                        : 'Queued tab received durable profile action gate'
                })

                if(typeof readyPredicate !== 'function') return true

                const readyWaitStartedAt = Date.now()
                let lastReadyEventAt = 0

                while(Date.now() - readyWaitStartedAt < ACTION_LEASE_WAIT_MS) {
                    if(readyPredicate() || !!getProfileUnavailableReason()) return true

                    const now = Date.now()
                    if(now - lastReadyEventAt >= QUEUED_ACTION_HEARTBEAT_MS) {
                        lastReadyEventAt = now
                        await recordActionGateProgress({
                            waitingForForegroundAt: readyWaitStartedAt,
                            foregroundWaitReason: 'profile-action-ready-wait',
                            event: 'Queued tab waiting for profile actions after durable gate'
                        })

                        const heartbeat = await heartbeatQueuedActionLease({probe: true})
                        if(heartbeat?.heartbeat) {
                            lastCoordinatorProgressAt = Date.now()
                        }
                        else if(heartbeat?.actionLeaseLost) {
                            queuedActionLeaseDeniedReason = 'action-lease-lost'
                            return false
                        }
                    }

                    await sleep(250)
                }

                queuedActionLeaseDeniedReason = 'foreground-ready-timeout'
                await releaseQueuedActionLease('foreground-ready-timeout')
                    return false
            }

            const localNoForegroundReady = await beginLocalNoForegroundActionGate()
            if(localNoForegroundReady) return true

            if(canProceedWithoutForegroundGate()) {
                return waitForProfileActionReadiness({
                    begun: true,
                    granted: true,
                    localActionGateFallback: true,
                    workerWindowActionGate: claimedActionSurfaceMode === 'worker-window' && document.visibilityState === 'visible',
                    foregroundLeaseAcquiredAt: Date.now()
                })
            }

            while(Date.now() - lastCoordinatorProgressAt < ACTION_LEASE_WAIT_MS) {
                let response = await safeSendRuntimeMessageWithTimeout({
                    action: 'begin-profile-action',
                    profileHref: queuedProfileHref || location.href,
                    actionKind: claimedActionKind,
                    reason,
                    attemptId: activeQueuedAttemptId || '',
                    attemptNumber: activeQueuedAttemptNumber || 0
                }, {
                    begun: false,
                    actionLeaseBusy: true,
                    reason: 'begin-profile-action-timeout'
                }, FOREGROUND_PROMOTION_MESSAGE_TIMEOUT_MS)

                if(!response?.begun && response?.reason === 'begin-profile-action-timeout') {
                    const heartbeat = await heartbeatQueuedActionLease({
                        probe: true,
                        timeoutMs: FOREGROUND_PROMOTION_MESSAGE_TIMEOUT_MS
                    })
                    if(heartbeat?.heartbeat) {
                        response = {
                            ...response,
                            ...heartbeat,
                            begun: true,
                            granted: true,
                            recoveredFromBeginTimeout: true
                        }
                    }
                    else {
                        const recovered = getRecoveredBeginResponseFromProgress()
                        if(recovered) {
                            response = {
                                ...response,
                                ...recovered
                            }
                        }
                        else if(canProceedWithoutForegroundGate()) {
                            response = {
                                ...response,
                                begun: true,
                                granted: true,
                                localActionGateFallback: true,
                                workerWindowActionGate: claimedActionSurfaceMode === 'worker-window' && document.visibilityState === 'visible',
                                foregroundLeaseAcquiredAt: Date.now()
                            }
                        }
                    }
                }

                if(response?.begun) {
                    return await waitForProfileActionReadiness(response)
                }
                if(response?.staleAttempt) {
                    queuedActionLeaseDeniedReason = response?.reason || 'stale-attempt'
                    return false
                }
                if(response?.actionLeaseBusy || response?.foregroundBusy) {
                    const now = Date.now()
                    const coordinatorStillBusy = response?.reason !== 'begin-profile-action-timeout' &&
                        (!!response?.leaseTabId || !!response?.leaseExpiresAt || response?.reason === 'action-lease-busy' || response?.foregroundBusy)

                    if(coordinatorStillBusy) lastCoordinatorProgressAt = now
                    waitingForActionLeaseAt = waitingForActionLeaseAt || now

                    if(now - lastWaitEventAt >= QUEUED_ACTION_HEARTBEAT_MS) {
                        lastWaitEventAt = now
                        const progress = await recordQueuedProfileProgress({
                            waitingForForegroundAt: waitingForActionLeaseAt,
                            foregroundWaitLastEventAt: now,
                            foregroundWaitReason: `${response?.reason || 'action-lease-busy'}`.trim(),
                            event: 'Queued tab waiting for durable profile action gate'
                        })
                        if(progress?.runtimeRecorded) lastCoordinatorProgressAt = now
                    }
                    await sleep(ACTION_LEASE_POLL_MS)
                    continue
                }

                queuedActionLeaseDeniedReason = response?.reason || 'request-denied'
                await recordQueuedProfileProgress({
                    event: `Queued tab durable profile action gate denied (${queuedActionLeaseDeniedReason})`
                })
                return false
            }

            queuedActionLeaseDeniedReason = 'timed-out-waiting'
            return false
        }
        async function heartbeatQueuedActionLease(options = {}) {
            if(!queuedActionLeaseHeld && !options.probe) return {heartbeat: false, skipped: true}
            const timeoutMs = Number.parseInt(options.timeoutMs, 10) || QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS

            const response = await safeSendRuntimeMessageWithTimeout({
                action: 'heartbeat-action-lease',
                profileHref: queuedProfileHref || location.href,
                actionKind: claimedActionKind,
                attemptId: activeQueuedAttemptId || '',
                attemptNumber: activeQueuedAttemptNumber || 0
            }, {heartbeat: false}, timeoutMs)

            if(response?.heartbeat) queuedActionLeaseHeld = true
            if(response?.actionLeaseLost) queuedActionLeaseHeld = false

            return response
        }

        async function releaseQueuedActionLease(reason) {
            if(!queuedActionLeaseHeld) return false
            queuedActionLeaseHeld = false

            const response = await safeSendRuntimeMessageWithTimeout({
                action: 'release-action-lease',
                profileHref: queuedProfileHref || location.href,
                actionKind: claimedActionKind,
                reason,
                attemptId: activeQueuedAttemptId || '',
                attemptNumber: activeQueuedAttemptNumber || 0
            }, {released: false}, QUEUED_PROGRESS_MESSAGE_TIMEOUT_MS)

            return !!response?.released
        }
        const startQueuedActionHeartbeat = patchFactory => {
            let stopped = false
            let heartbeatTimeout = null
            let inFlight = false

            const tick = async () => {
                heartbeatTimeout = null
                if(stopped || inFlight) return

                inFlight = true
                try {
                    const patch = typeof patchFactory === 'function' ? patchFactory() : patchFactory
                    if(patch) await recordQueuedProfileProgress(patch)
                    await heartbeatQueuedActionLease()
                }
                catch {}
                finally {
                    inFlight = false
                    if(!stopped) heartbeatTimeout = setTimeout(tick, QUEUED_ACTION_HEARTBEAT_MS)
                }
            }

            heartbeatTimeout = setTimeout(tick, QUEUED_ACTION_HEARTBEAT_MS)

            return () => {
                stopped = true
                if(heartbeatTimeout) clearTimeout(heartbeatTimeout)
            }
        }
        const runQueuedUnblockUnmuteAction = async () => {
            if(getProfileUnavailableReason()) {
                await skipQueuedUnavailableTab('Profile unavailable')
                return
            }

            if(getPageType() !== 'profile') {
                await waitForCondition(() => getPageType() === 'profile' || !!getProfileUnavailableReason() || isSecurityVerificationPage(), 5000, 250)
            }

            if(getProfileUnavailableReason()) {
                await skipQueuedUnavailableTab('Profile unavailable')
                return
            }

            if(getPageType() !== 'profile') {
                if(await resolveQueuedProfileFromCurrentPage()) return
                if(await continueQueuedResolutionToQuestionLog()) return

                const pageType = getPageType() || 'unknown'
                const message = isSecurityVerificationPage()
                    ? 'Queued tab landed on a security verification page'
                    : `Queued tab did not land on a profile page (${pageType}: ${location.pathname})`
                if(isQueuedResolutionAction() && !isSecurityVerificationPage()) {
                    await abandonQueuedResolution(message)
                    return
                }
                await abandonQueuedTab(message)
                return
            }

            // review-2 C-1, same defect on the unblock path: the page resolved to another profile, so nothing here may be
            // unblocked or unmuted, or recorded as the queued profile's success.
            const remappedUnblockProfileHref = getQueuedProfileRemapTarget(queuedProfileHref)
            if(remappedUnblockProfileHref) {
                await recordQueuedProfileProgress({
                    event: `Profile remapped to ${remappedUnblockProfileHref}`
                })
                return
            }

            const initialReadyTimeoutMs = document.visibilityState === 'visible'
                ? VISIBLE_PROFILE_READY_MS
                : allowForegroundFallback
                    ? HIDDEN_PROFILE_READY_FAST_PROBE_MS
                    : HIDDEN_PROFILE_READY_NO_FOREGROUND_MS
            let ready = await waitForCondition(() => !!getProfileMenuButton() || !!getProfileUnavailableReason(), initialReadyTimeoutMs, 250)
            if(!ready && document.visibilityState !== 'visible' && allowForegroundFallback) {
                await recordQueuedProfileProgress({
                    event: 'Pardon actions stalled in a background tab; waiting for durable profile action gate'
                })
            }

            if(!ready && (document.visibilityState === 'visible' || !allowForegroundFallback)) {
                logProfileActionDebug('Profile actions not ready')
                await abandonQueuedTab('Profile actions not ready')
                return
            }

            const profileActionReady = await beginQueuedProfileAction(
                'unblock-unmute-profile-menu-action',
                () => !!getProfileMenuButton()
            )
            if(!profileActionReady) {
                const reason = queuedActionLeaseDeniedReason ? `: ${queuedActionLeaseDeniedReason}` : ''
                await abandonQueuedTab(`Queued Pardon did not receive profile action gate${reason}`)
                return
            }

            if(getProfileUnavailableReason()) {
                await releaseQueuedActionLease('profile-unavailable-after-action-begin')
                await skipQueuedUnavailableTab('Profile unavailable')
                return
            }

            try {
                await recordQueuedProfileProgress({
                    status: 'page-ready',
                    openedViablePage: true,
                    actionReadyAt: Date.now(),
                    event: 'Pardon profile actions became available'
                })

                const wasBlocked = isProfileBlocked()
                await recordQueuedProfileProgress({
                    status: wasBlocked ? 'unblocking' : 'unmuting',
                    openedViablePage: true,
                    event: wasBlocked ? 'Queued Pardon action started' : 'Queued Unmute action started'
                })
                const stopHeartbeat = startQueuedActionHeartbeat(() => ({
                    status: wasBlocked ? 'unblocking' : 'unmuting',
                    openedViablePage: true,
                    event: wasBlocked ? 'Queued Pardon action still running' : 'Queued Unmute action still running'
                }))
                let result = null
                try {
                    result = await unblockUnmuteProfile({silent: true, allowForegroundFallback, clearNukeState: false})
                }
                finally {
                    stopHeartbeat()
                }
                const verified = result?.ok && await waitForVerifiedProfileUnblocked(3500, 250, true, allowForegroundFallback)
                if(!verified) {
                    await recordQueuedProfileProgress({
                        status: 'error',
                        openedViablePage: true,
                        finalError: result?.reason || 'Queued Pardon did not complete',
                        event: result?.reason || 'Queued Pardon did not complete'
                    })
                    await failCurrentQueuedProfile(getResolvedSpaceFeedProfileHrefs(queuedProfileHref || location.href))
                    await releaseQueuedTabSlot()
                    await requestCloseTab(2, 100, true)
                    return
                }

                const progress = await recordQueuedProfileProgress({
                    status: wasBlocked ? 'unblocked' : 'already-unblocked',
                    openedViablePage: true,
                    unblockSucceeded: true,
                    unblockedAt: Date.now(),
                    finalError: '',
                    event: wasBlocked ? 'Queued Pardon completed' : 'Queued profile was already unblocked'
                })
                if(progress?.serviceWorkerOnly && !progress.runtimeRecorded) {
                    markQueuedTabFinishing()
                    console.info('Queued terminal unblock/unmute success was not recorded; leaving tab open for retry')
                    return
                }
                await releaseQueuedTabSlot()
                await requestCloseTab()
            }
            finally {
                await releaseQueuedActionLease('unblock-unmute-action-finished')
            }
        }

        if(claimedAction?.action === UNBLOCK_UNMUTE_ACTION_KIND) {
            await runQueuedUnblockUnmuteAction()
            return
        }

        if(getProfileUnavailableReason()) {
            await skipQueuedUnavailableTab('Profile unavailable')
            return
        }

        if(getPageType() !== 'profile') {
            await waitForCondition(() => getPageType() === 'profile' || !!getProfileUnavailableReason() || isSecurityVerificationPage(), 5000, 250)
        }

        if(getProfileUnavailableReason()) {
            await skipQueuedUnavailableTab('Profile unavailable')
            return
        }

        if(getPageType() !== 'profile') {
            if(await resolveQueuedProfileFromCurrentPage()) return
            if(await continueQueuedResolutionToQuestionLog()) return

            const pageType = getPageType() || 'unknown'
            const message = isSecurityVerificationPage()
                ? 'Queued tab landed on a security verification page'
                : `Queued tab did not land on a profile page (${pageType}: ${location.pathname})`
            if(isQueuedResolutionAction() && !isSecurityVerificationPage()) {
                await abandonQueuedResolution(message)
                return
            }
            await abandonQueuedTab(message)
            return
        }

        // review-2 C-1: the page resolved to another profile than the one this action was claimed for. Nothing on it may be
        // blocked, muted or marked blocked for the queued profile. The worker's redirect check ends the row and closes the tab.
        const remappedProfileHref = getQueuedProfileRemapTarget(queuedProfileHref)
        if(remappedProfileHref) {
            await recordQueuedProfileProgress({
                event: `Profile remapped to ${remappedProfileHref}`
            })
            return
        }

        if(isProfileBlockedConfirmed()) {
            await closeQueuedBlockedTab({
                status: 'already-blocked',
                openedViablePage: true,
                foundBlockedBeforeQueue: true,
                blockSucceeded: true,
                blockedAt: Date.now(),
                event: 'Profile was already blocked before actions'
            })
            return
        }

        if(getProfileUnavailableReason()) {
            await skipQueuedUnavailableTab('Profile unavailable')
            return
        }

        const initialReadyTimeoutMs = document.visibilityState === 'visible'
            ? VISIBLE_PROFILE_READY_MS
            : allowForegroundFallback
                ? HIDDEN_PROFILE_READY_FAST_PROBE_MS
                : HIDDEN_PROFILE_READY_NO_FOREGROUND_MS
        let ready = await waitForCondition(() => isProfileBlocked() || !!getProfileMenuButton() || !!getProfileUnavailableReason(), initialReadyTimeoutMs, 250)
        if(!ready && document.visibilityState !== 'visible' && allowForegroundFallback) {
            await recordQueuedProfileProgress({
                event: 'Profile actions stalled in a background tab; waiting for durable profile action gate'
            })
        }

        if(!ready && (document.visibilityState === 'visible' || !allowForegroundFallback)) {
            logProfileActionDebug('Profile actions not ready')
            await abandonQueuedTab('Profile actions not ready')
            return
        }

        if(getProfileUnavailableReason()) {
            await skipQueuedUnavailableTab('Profile unavailable')
            return
        }

        if(isProfileBlockedConfirmed()) {
            await closeQueuedBlockedTab({
                status: 'already-blocked',
                openedViablePage: true,
                foundBlockedBeforeQueue: true,
                blockSucceeded: true,
                blockedAt: Date.now(),
                event: 'Profile reached blocked state before mute/block actions'
            })
            return
        }

        if(getProfileUnavailableReason()) {
            await skipQueuedUnavailableTab('Profile unavailable')
            return
        }

        if(isProfileBlockedConfirmed()) {
            await closeQueuedBlockedTab({
                status: 'already-blocked',
                openedViablePage: true,
                foundBlockedBeforeQueue: true,
                blockSucceeded: true,
                blockedAt: Date.now(),
                event: 'Profile reached blocked state before mute/block actions'
            })
            return
        }

        const profileActionReady = await beginQueuedProfileAction(
            'mute-block-profile-menu-action',
            () => isProfileBlocked() || !!getProfileMenuButton()
        )
        if(!profileActionReady) {
            const reason = queuedActionLeaseDeniedReason ? `: ${queuedActionLeaseDeniedReason}` : ''
            await abandonQueuedTab(`Queued profile action did not receive profile action gate${reason}`)
            return
        }

        if(getProfileUnavailableReason()) {
            await releaseQueuedActionLease('profile-unavailable-after-action-begin')
            await skipQueuedUnavailableTab('Profile unavailable')
            return
        }

        try {
            await recordQueuedProfileProgress({
                status: 'page-ready',
                openedViablePage: true,
                actionReadyAt: Date.now(),
                event: 'Profile actions became available'
            })

            if(!isProfileBlocked()) {
                await recordQueuedProfileProgress({
                    status: 'blocking',
                    openedViablePage: true,
                    event: 'Queued Mute Block skipped mute and started block directly'
                })
                const stopHeartbeat = startQueuedActionHeartbeat(() => ({
                    status: 'blocking',
                    openedViablePage: true,
                    event: 'Queued direct block action still running'
                }))
                let blockedDirectly = false
                try {
                    blockedDirectly = await blockProfile({silent: true, allowForegroundFallback})
                }
                finally {
                    stopHeartbeat()
                }
                if(blockedDirectly || isProfileBlocked()) {
                    await closeQueuedBlockedTab()
                    return
                }
                if(getProfileUnavailableReason()) {
                    await skipQueuedUnavailableTab('Profile unavailable')
                    return
                }

                await abandonQueuedTab('Queued direct block action did not complete', {
                    directBlockFailureDetail: getDirectBlockActionDiagnostic('queued-direct-block-action-did-not-complete', {
                        finalBlockedState: isProfileBlocked(),
                        previousBlockError: getProfileNukeProgressRecord(queuedProfileHref || location.href)?.blockError || ''
                    })
                })
                return
            }

            if(isProfileBlockedConfirmed()) {
                await closeQueuedBlockedTab()
                return
            }

            const blocked = await waitForCondition(() => isProfileBlockedConfirmed(), 2500, 250)
            if(blocked || isProfileBlockedConfirmed()) {
                await closeQueuedBlockedTab()
            }
            else {
                await abandonQueuedTab('Queued profile never reached blocked state')
            }
        }
        finally {
            await releaseQueuedActionLease('mute-block-action-finished')
        }
    }
    catch(error) {
        console.error(error)
        const message = `${error?.message || ''}`.trim() || 'Queued profile action failed unexpectedly'
        const stack = `${error?.stack || ''}`.trim().slice(0, 4000)

        try {
            await recordQueuedProfileProgress({
                status: 'error',
                openedViablePage: false,
                finalError: message,
                finalErrorStack: stack,
                errorPageUrl: location.href,
                event: message
            })
            await failCurrentQueuedProfile(getResolvedSpaceFeedProfileHrefs(queuedProfileHref || location.href))
            await notifyQueuedTabComplete()
            await requestCloseTab(2, 100, true)
        }
        catch {}
    }
    finally {
        autoProfileActionPending = false
        activeQueuedAttemptId = ''
        activeQueuedAttemptNumber = 0
        activeQueuedAttemptProfileHref = ''
        activeQueuedNoForegroundFallback = false
        activeQueuedActionSurfaceMode = ''
        releaseHeldQueuedProfileActionClaim()
    }
}

function reportActionIssue(message, silent = false) {
    if(silent) return
    console.info(message)
    if(getPageType() === 'profile') {
        logProfileActionDebug(message)
    }
}

function getUnblockConfirmAction() {
    const preferred = /\bun[\s-]*block\b|\bconfirm\b|\bcontinue\b/i
    const modalSubmit = Array.from(document.querySelectorAll('.puppeteer_test_modal_submit, button, [role="button"], a'))
        .filter(button => !shouldIgnoreActionCandidate(button) && isVisible(button))
        .find(button => {
            if(!String(button.className || '').includes('puppeteer_test_modal_submit')) return false
            if(!isUnblockConfirmButtonLabel(getActionCandidateLabel(button))) return false
            if(hasUnblockActionText(getActionCandidateLabel(button))) return true

            const context = getBestActionContext(button)
            return isUnblockConfirmContextText(context?.text || '')
        })
    if(modalSubmit) return modalSubmit

    const container = getUnblockConfirmContainer()
    if(container) {
        const containerButtons = getVisibleActionButtons(container)
            .filter(button => isUnblockConfirmButtonLabel(getActionCandidateLabel(button)))
            .map(button => ({button, score: scoreActionCandidate(button, preferred, getElementText(container)) + 500}))

        containerButtons.sort((left, right) => right.score - left.score)
        if(containerButtons.length) return containerButtons[0].button
    }

    const dialogPrimary = getContextualDialogPrimaryAction(
        getDialogRoots(),
        preferred,
        isUnblockConfirmContextText,
        button => isUnblockConfirmButtonLabel(getActionCandidateLabel(button))
    )
    if(dialogPrimary) return dialogPrimary

    return null
}

function getUnmuteConfirmAction() {
    const candidates = getUnmuteConfirmCandidates()
    if(candidates.length) return candidates[0].button

    // 1 Nov: the whole-page fallback needs a confirmation surface, not any visible Unmute control.
    const inPageConfirm = getInPageConfirmPairAction(/\bun[\s-]*mute\b|\bconfirm\b|\bcontinue\b/i, {requireConfirmation: true})
    if(inPageConfirm) return inPageConfirm

    const container = getUnmuteConfirmContainer()
    if(container) {
        const containerButtons = getVisibleActionButtons(container)
            .filter(button => isUnmuteConfirmButtonLabel(getActionCandidateLabel(button)))
            .map(button => ({button, score: scoreActionCandidate(button, /\bun[\s-]*mute\b|\bconfirm\b|\bcontinue\b/i, getElementText(container)) + 500}))

        containerButtons.sort((left, right) => right.score - left.score)
        if(containerButtons.length) return containerButtons[0].button
    }

    return getContextualDialogPrimaryAction(
        getDialogRoots(),
        /\bun[\s-]*mute\b|\bconfirm\b|\bcontinue\b/i,
        isUnmuteConfirmContextText,
        button => isUnmuteConfirmButtonLabel(getActionCandidateLabel(button))
    )
}

function isUnblockConfirmContextText(text) {
    const value = text || ''
    return hasUnblockActionText(value) &&
        !hasUnmuteActionText(value) &&
        !/\bmute\b|\bmuted\b|\bmuting\b|\bask question\b|\badd question\b|\bcreate post\b/i.test(value)
}

function getUnblockConfirmContainer() {
    const candidates = Array.from(document.querySelectorAll('div, section, aside'))
        .filter(isVisible)
        .filter(element => {
            const text = getElementText(element)
            if(!isUnblockConfirmContextText(text)) return false

            const buttons = getVisibleActionButtons(element)
            return buttons.some(button => isUnblockConfirmButtonLabel(getActionCandidateLabel(button))) &&
                buttons.some(button => /\bcancel\b|\bdismiss\b|\bclose\b|\bno\b/i.test(getActionCandidateLabel(button)))
        })
        .map(element => {
            const rect = element.getBoundingClientRect()
            const area = rect.width * rect.height
            const text = getElementText(element)
            return {element, area, text}
        })

    candidates.sort((left, right) => left.area - right.area)
    return candidates[0]?.element || null
}

function getUnmuteConfirmContainer() {
    const candidates = Array.from(document.querySelectorAll('div, section, aside'))
        .filter(isVisible)
        .filter(element => {
            const text = getElementText(element)
            if(!isUnmuteConfirmContextText(text)) return false

            const buttons = getVisibleActionButtons(element)
            return buttons.some(button => isUnmuteConfirmButtonLabel(getActionCandidateLabel(button))) &&
                buttons.some(button => /\bcancel\b|\bdismiss\b|\bclose\b|\bno\b/i.test(getElementText(button)))
        })
        .map(element => {
            const rect = element.getBoundingClientRect()
            const area = rect.width * rect.height
            const text = getElementText(element)
            return {element, area, text}
        })

    candidates.sort((left, right) => left.area - right.area)
    return candidates[0]?.element || null
}

function isUnmuteConfirmContextText(text) {
    const value = text || ''
    return hasUnmuteActionText(value) &&
        !hasUnblockActionText(value) &&
        !/\bblock\b|\bblocked\b|\bblocking\b|\bask question\b|\badd question\b|\bcreate post\b/i.test(value)
}

function isUnblockConfirmPending() {
    return !!getUnblockConfirmAction()
}

function getUnmuteConfirmCandidates() {
    const dialogRoots = getDialogRoots()
    const confirmContainer = getUnmuteConfirmContainer()
    const isInUnmuteConfirmSurface = button => {
        if(confirmContainer?.contains(button)) return true
        return dialogRoots.some(root => root.contains(button))
    }

    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(button => !shouldIgnoreActionCandidate(button) && isVisible(button))
        .filter(isInUnmuteConfirmSurface)
        .filter(button => isUnmuteConfirmButtonLabel(getActionCandidateLabel(button)))
        .map(button => {
            const context = getBestActionContext(button)
            const contextText = context?.text || ''
            let score = scoreActionCandidate(button, /\bun[\s-]*mute\b|\bconfirm\b|\bcontinue\b/i, contextText)

            if(isUnmuteConfirmContextText(contextText)) score += 1200
            if(hasUnblockActionText(contextText) ||
                /\bblock\b|\bblocked\b|\bask question\b|\badd question\b|\bcreate post\b/i.test(contextText)) score -= 1500
            if(/\bcancel\b/i.test(contextText) && !isUnmuteConfirmContextText(contextText)) score -= 500

            return {button, score, contextText}
        })
        .filter(candidate => isUnmuteConfirmContextText(candidate.contextText))

    candidates.sort((left, right) => right.score - left.score)
    return candidates
}

function isUnmuteConfirmPending() {
    return !!getUnmuteConfirmAction()
}

function getInPageConfirmPairAction(preferredRegex, options = {}) {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(button => !shouldIgnoreActionCandidate(button) && isVisible(button))
        .filter(button => preferredRegex.test(getActionCandidateLabel(button)))
        .map(button => {
            const label = getActionCandidateLabel(button)
            const context = getBestActionContext(button)
            const contextElement = context?.element || button.parentElement
            const contextText = context?.text || getElementText(contextElement || button)
            const contextButtons = contextElement
                ? getVisibleActionButtons(contextElement)
                : []
            const hasCancelPeer = contextButtons.some(peer => peer !== button && /\bcancel\b|\bdismiss\b|\bclose\b|\bno\b/i.test(getActionCandidateLabel(peer)))
            let score = scoreActionCandidate(button, preferredRegex, contextText)

            if(hasCancelPeer) score += 900
            if(isUnmuteConfirmContextText(contextText)) score += 600
            if(hasUnblockActionText(contextText) ||
                /\bblock\b|\bblocked\b|\bask question\b|\badd question\b|\bcreate post\b/i.test(contextText)) score -= 900
            if(!hasCancelPeer && !isUnmuteConfirmContextText(contextText)) score -= 1200

            return {button, score, label, contextText, hasCancelPeer}
        })
        .filter(candidate => candidate.score > 0 &&
            (hasUnmuteActionText(candidate.label) || isUnmuteConfirmContextText(candidate.contextText)))
        .filter(candidate => !options.requireConfirmation ||
            (candidate.hasCancelPeer && /\bsure\b|\bconfirm\b|\bare you\b|\?/i.test(candidate.contextText)))

    candidates.sort((left, right) => right.score - left.score)
    return candidates[0]?.button || null
}

async function dismissProfileActionSurface() {
    const cancel = getDialogPrimaryAction(getDialogRoots(), /\bcancel\b|\bdismiss\b|\bclose\b|\bno\b/i) ||
        getGlobalPrimaryAction(/\bcancel\b|\bdismiss\b|\bclose\b|\bno\b/i)

    if(cancel) {
        cancel.click()
        await sleep(250)
        return true
    }

    if(isProfileMenuOpen()) return closeProfileMenu()
    return false
}

function isProfileLoadedAndUnblocked() {
    return getPageType() === 'profile' &&
        document.readyState !== 'loading' &&
        !isProfileBlocked() &&
        !!getProfileMenuButton()
}

// Counts the clicks this script makes itself, so the page-event log can tell them from the user's (Oct 31: a click the log
// labelled "user" was the extension's own, and the log could not say which).
const extensionActivationState = {depth: 0}

function activateActionElement(element) {
    if(!element) return false

    const rect = element.getBoundingClientRect()
    const clientX = rect.left + Math.max(1, Math.min(rect.width / 2, rect.width - 1))
    const clientY = rect.top + Math.max(1, Math.min(rect.height / 2, rect.height - 1))
    const base = {bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, button: 0}

    extensionActivationState.depth += 1
    try {
        element.dispatchEvent(new PointerEvent('pointerdown', {...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1}))
        element.dispatchEvent(new MouseEvent('mousedown', {...base, buttons: 1}))
        element.dispatchEvent(new PointerEvent('pointerup', {...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0}))
        element.dispatchEvent(new MouseEvent('mouseup', {...base, buttons: 0}))
        element.dispatchEvent(new MouseEvent('click', {...base, buttons: 0}))
        return true
    }
    catch {
        element.click()
        return true
    }
    finally {
        extensionActivationState.depth -= 1
    }
}

function getConfirmationActionDebugSnapshot(element, confirmationKind = '') {
    if(!element) return {}

    const context = getBestActionContext(element)
    return {
        confirmationKind: confirmationKind || '',
        confirmationActionLabel: getActionDebugLabel(element),
        confirmationActionRect: getActionDebugRect(element),
        confirmationContextSnippet: compactElementText(context?.text || '', 320)
    }
}

function getConfirmationKindMismatchReason(element, confirmationKind = '') {
    const kind = `${confirmationKind || ''}`.trim().toLowerCase()
    if(!element || !kind) return ''

    const label = getActionDebugLabel(element)
    const context = getBestActionContext(element)
    const contextText = context?.text || ''
    if(kind === 'block') {
        if(hasUnblockActionText(label) || hasUnblockActionText(contextText)) return 'inverse-unblock-confirmation'
        if(!isBlockConfirmButtonLabel(label) || !isBlockConfirmContextText(contextText)) return 'not-block-confirmation'
    }
    else if(kind === 'mute') {
        if(hasUnmuteActionText(label) || hasUnmuteActionText(contextText)) return 'inverse-unmute-confirmation'
        if(!isMuteConfirmButtonLabel(label) || !isMuteConfirmContextText(contextText)) return 'not-mute-confirmation'
    }
    else if(kind === 'unblock') {
        if(!isUnblockConfirmButtonLabel(label) || !isUnblockConfirmContextText(contextText)) return 'not-unblock-confirmation'
    }
    else if(kind === 'unmute') {
        if(!isUnmuteConfirmButtonLabel(label) || !isUnmuteConfirmContextText(contextText)) return 'not-unmute-confirmation'
    }

    return ''
}

async function activateConfirmationElement(element, isStillPending, confirmationKind = '') {
    if(!element) return {activated: false, ok: false, skipped: true, reason: 'missing-confirmation-element'}

    const mismatchReason = getConfirmationKindMismatchReason(element, confirmationKind)
    if(mismatchReason) {
        noteCurrentProfileNukeProgress({
            event: `${formatConfirmationKind(confirmationKind)} confirmation activation skipped: ${mismatchReason}`,
            confirmationActivationSkipped: true,
            confirmationMismatchReason: mismatchReason,
            ...getConfirmationActionDebugSnapshot(element, confirmationKind)
        })
        return {
            activated: false,
            ok: false,
            skipped: true,
            reason: mismatchReason
        }
    }

    const foreground = await ensureForegroundForConfirmation(confirmationKind)
    if(!foreground.ok) {
        noteCurrentProfileNukeProgress({
            event: `${formatConfirmationKind(confirmationKind)} confirmation activation skipped: ${foreground.reason}`,
            confirmationForegroundRequired: true,
            confirmationForegroundReason: foreground.reason || ''
        })
        return {
            activated: false,
            ok: false,
            skipped: true,
            foregroundRequired: true,
            foregroundAvailable: false,
            reason: foreground.reason || 'confirmation-foreground-unavailable'
        }
    }

    const pendingBefore = typeof isStillPending === 'function' ? !!isStillPending() : false
    noteCurrentProfileNukeProgress({
        event: `${formatConfirmationKind(confirmationKind)} confirmation activation attempted`,
        confirmationActivationAttemptedAt: Date.now(),
        confirmationForegroundRequired: foreground.required === true,
        confirmationForegroundPromoted: foreground.promoted === true,
        confirmationPendingBeforeActivation: pendingBefore,
        ...getConfirmationActionDebugSnapshot(element, confirmationKind)
    })

    let activated = activateActionElement(element)
    await sleep(100)
    // A block that has already applied (the profile reads blocked) gets no more retries. The button can relabel to Unblock, and a
    // retry on it would undo the block (Oct 31, William Birge).
    const stillPendingForRetry = () => typeof isStillPending === 'function' && isStillPending() &&
        !(confirmationKind === 'block' && isProfileBlocked())
    if(stillPendingForRetry()) {
        dispatchActivationKey(element, 'Enter')
        await sleep(100)
        if(stillPendingForRetry()) {
            dispatchActivationKey(element, ' ')
            await sleep(100)
            if(stillPendingForRetry()) {
                extensionActivationState.depth += 1
                try {
                    element.click()
                }
                catch {}
                finally {
                    extensionActivationState.depth -= 1
                }
                await sleep(100)
                if(stillPendingForRetry()) {
                    const pageWorldResult = await activateConfirmationElementInPageWorld(element, confirmationKind)
                    activated = activated || !!pageWorldResult?.clicked
                    noteCurrentProfileNukeProgress({
                        event: pageWorldResult?.clicked
                            ? `${confirmationKind || 'Confirmation'} page-world activation clicked`
                            : `${confirmationKind || 'Confirmation'} page-world activation did not click: ${pageWorldResult?.reason || 'unknown'}`
                    })
                    await sleep(150)
                }
            }
        }
    }
    let pendingAfter = false
    if(typeof isStillPending === 'function') {
        pendingAfter = !!isStillPending()
        noteCurrentProfileNukeProgress({
            event: pendingAfter
                ? `${formatConfirmationKind(confirmationKind)} confirmation still pending after activation`
                : `${formatConfirmationKind(confirmationKind)} confirmation no longer pending after activation`,
            confirmationActivationDispatched: activated,
            confirmationStillPendingAfterActivation: pendingAfter
        })
    }
    return {
        activated,
        ok: activated && !pendingAfter,
        skipped: false,
        foregroundRequired: foreground.required === true,
        foregroundAvailable: true,
        pendingAfter,
        reason: pendingAfter ? 'confirmation-still-pending' : 'activation-dispatched'
    }
}

function formatConfirmationKind(confirmationKind = '') {
    const normalized = `${confirmationKind || 'Confirmation'}`.trim()
    return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Confirmation'
}

function isConfirmationForegroundUnavailable(result = null) {
    return result?.skipped === true &&
        result?.foregroundRequired === true &&
        result?.foregroundAvailable === false
}

async function ensureForegroundForConfirmation(confirmationKind = '') {
    if(activeQueuedNoForegroundFallback && activeQueuedActionSurfaceMode !== 'worker-window') {
        return {ok: false, required: true, reason: 'foreground-fallback-disabled'}
    }
    if(document.visibilityState === 'visible') {
        return {ok: true, required: false, reason: 'visible'}
    }
    if(!activeQueuedAttemptId || !activeQueuedAttemptNumber) {
        return {ok: false, required: true, reason: 'hidden-nonqueued-confirmation'}
    }

    const kind = `${confirmationKind || ''}`.trim().toLowerCase()
    const actionKind = kind === 'unmute' || kind === 'unblock'
        ? UNBLOCK_UNMUTE_ACTION_KIND
        : 'mute-block'
    const reason = `${kind || 'profile'}-confirmation`

    noteCurrentProfileNukeProgress({
        event: `${formatConfirmationKind(confirmationKind)} confirmation waiting for foreground`,
        confirmationForegroundRequired: true,
        waitingForForegroundAt: Date.now(),
        foregroundWaitReason: reason
    })

    const response = await safeSendRuntimeMessageWithTimeout({
        action: 'begin-profile-action',
        profileHref: activeQueuedAttemptProfileHref || normalizeQuoraProfileHref(location.href) || location.href,
        actionKind,
        reason,
        attemptId: activeQueuedAttemptId || '',
        attemptNumber: activeQueuedAttemptNumber || 0
    }, {
        begun: false,
        reason: 'confirmation-foreground-timeout'
    }, FOREGROUND_PROMOTION_MESSAGE_TIMEOUT_MS)

    if(activeQueuedNoForegroundFallback && activeQueuedActionSurfaceMode === 'worker-window') {
        const responseReason = response?.reason || ''
        const timedOut = !response?.begun && /timeout/i.test(responseReason)
        if(!response?.begun && !timedOut) {
            return {ok: false, required: true, reason: responseReason || 'confirmation-foreground-denied'}
        }
        let promoted = response?.foregroundPromoted === true
        if(timedOut) {
            const retry = await promoteCurrentQueuedTab(reason, true)
            promoted = promoted || retry?.promoted === true
        }
        noteCurrentProfileNukeProgress({
            event: timedOut
                ? `${formatConfirmationKind(confirmationKind)} confirmation using the background window after foreground timeout`
                : `${formatConfirmationKind(confirmationKind)} confirmation using the background window`,
            confirmationForegroundRequired: true,
            confirmationForegroundPromoted: promoted,
            confirmationWorkerWindowActionSurface: true,
            confirmationWorkerWindowTimeoutRecovered: timedOut,
            foregroundWaitReason: reason
        })
        return {
            ok: true,
            required: true,
            promoted,
            workerWindowActionSurface: true,
            reason: 'worker-window-action-surface'
        }
    }

    if(!response?.begun) {
        return {ok: false, required: true, reason: response?.reason || 'confirmation-foreground-denied'}
    }

    let promoted = response?.foregroundPromoted === true
    let visible = document.visibilityState === 'visible' ||
        await waitForCondition(() => document.visibilityState === 'visible', 2500, 100)
    if(!visible) {
        noteCurrentProfileNukeProgress({
            event: `${formatConfirmationKind(confirmationKind)} confirmation foreground not visible after promotion; retrying`,
            confirmationForegroundRequired: true,
            confirmationForegroundRetryAt: Date.now(),
            foregroundWaitReason: reason
        })
        const retry = await promoteCurrentQueuedTab(reason, true)
        promoted = promoted || retry?.promoted === true
        if(retry?.promoted) {
            visible = document.visibilityState === 'visible' ||
                await waitForCondition(() => document.visibilityState === 'visible', 3500, 100)
        }
    }
    return {
        ok: visible,
        required: true,
        promoted,
        reason: visible ? 'foreground-ready' : 'foreground-not-visible'
    }
}

async function dismissPendingConfirmationAfterFailure(confirmationKind = '', reason = 'confirmation-failed') {
    const pendingBefore = isAnyProfileConfirmationPending()
    const dismissed = pendingBefore ? await dismissProfileActionSurface() : false
    const pendingAfter = isAnyProfileConfirmationPending()
    await recordCurrentProfileNukeProgress({
        event: `${formatConfirmationKind(confirmationKind)} confirmation cleanup after failure`,
        confirmationCleanupReason: reason,
        confirmationPendingBeforeCleanup: pendingBefore,
        confirmationDismissedAfterFailure: dismissed,
        confirmationPendingAfterCleanup: pendingAfter
    })
    return {pendingBefore, dismissed, pendingAfter}
}

function isAnyProfileConfirmationPending() {
    return !!(
        getMuteConfirmAction() ||
        getBlockConfirmAction() ||
        getUnmuteConfirmAction() ||
        getUnblockConfirmAction()
    )
}

async function activateConfirmationElementInPageWorld(element, confirmationKind = '') {
    if(!element?.setAttribute) return {clicked: false, reason: 'invalid-element'}

    const token = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    try {
        element.setAttribute(PAGE_WORLD_CONFIRM_ACTIVATION_ATTR, token)
        return await safeSendRuntimeMessageWithTimeout({
            action: 'activate-confirmation-in-page-world',
            token,
            confirmationKind
        }, {clicked: false, reason: 'message-failed'}, 3500)
    }
    catch(error) {
        if(isExtensionContextInvalidatedError(error) || isRuntimeConnectionError(error)) {
            return {clicked: false, reason: 'runtime-unavailable'}
        }
        throw error
    }
    finally {
        try {
            if(element.getAttribute(PAGE_WORLD_CONFIRM_ACTIVATION_ATTR) === token) {
                element.removeAttribute(PAGE_WORLD_CONFIRM_ACTIVATION_ATTR)
            }
        }
        catch {}
    }
}

function dispatchActivationKey(element, key = 'Enter') {
    if(!element) return false

    const code = key === ' ' ? 'Space' : key
    const keyCode = key === ' ' ? 32 : 13
    const eventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        key,
        code,
        keyCode,
        which: keyCode
    }

    try {
        element.dispatchEvent(new KeyboardEvent('keydown', eventInit))
        element.dispatchEvent(new KeyboardEvent('keyup', eventInit))
        return true
    }
    catch {
        return false
    }
}

async function unblockProfile(options = {}) {
    const {silent = false, allowForegroundFallback = false, clearNukeState = true} = options
    if(!getProfileMenuButton()) {
        await waitForCondition(() => !!getProfileMenuButton(), 5000, 100)
    }

    const menuOpened = await ensureProfileMenuOpen(2500, silent, allowForegroundFallback)
    if(!menuOpened) return {ok: false, changed: false, reason: 'profile-menu-not-open'}

    await sleep(300)
    await recordReverseActionProgress({
        event: 'Reverse action opened profile menu for unblock',
        ...getReverseActionDebugSnapshot()
    })

    const unblockState = await waitForMenuStateWithForegroundFallback(isUnblockActionLabel, isBlockActionLabel, {
        timeoutMs: 5000,
        intervalMs: 250,
        promotionReason: 'unblock-option-not-found',
        silent,
        allowForegroundFallback
    })

    if(unblockState?.state === 'inverse') {
        await recordReverseActionProgress({
            event: 'Reverse action found profile already unblocked',
            selectedActionLabel: getActionDebugLabel(unblockState.button),
            selectedActionRect: getActionDebugRect(unblockState.button),
            ...getReverseActionDebugSnapshot()
        })
        await closeProfileMenu()
        return {ok: true, changed: false, reason: 'already-unblocked'}
    }

    const unblockButton = unblockState?.button || getMenuAction(isUnblockActionLabel)
    if(!unblockButton) {
        await closeProfileMenu()
        await sleep(250)
        const reopened = await ensureProfileMenuOpen(2500, silent, allowForegroundFallback)
        if(reopened) {
            await sleep(300)
            const retryUnblockButton = getMenuAction(isUnblockActionLabel)
            if(retryUnblockButton) {
                await recordReverseActionProgress({
                    event: 'Reverse action selected unblock after reopening profile menu',
                    selectedActionLabel: getActionDebugLabel(retryUnblockButton),
                    selectedActionRect: getActionDebugRect(retryUnblockButton),
                    ...getReverseActionDebugSnapshot()
                })
                activateActionElement(retryUnblockButton)
                return finishUnblockProfileAction({silent, clearNukeState})
            }
        }

        await recordReverseActionProgress({
            event: 'Reverse action could not find an unblock option',
            ...getReverseActionDebugSnapshot()
        })
        reportActionIssue('Unblock option not found', silent)
        return {ok: false, changed: false, reason: 'unblock-option-not-found', labels: getVisibleProfileMenuActionLabels()}
    }

    await recordReverseActionProgress({
        event: 'Reverse action selected unblock',
        selectedActionLabel: getActionDebugLabel(unblockButton),
        selectedActionRect: getActionDebugRect(unblockButton),
        ...getReverseActionDebugSnapshot()
    })
    activateActionElement(unblockButton)

    return finishUnblockProfileAction({silent, clearNukeState})
}

async function finishUnblockProfileAction(options = {}) {
    const {silent = false, clearNukeState = true} = options
    let confirmButton = await waitForAction(() => {
        const button = getUnblockConfirmAction()
        if(button) return button
        if(getMenuAction(isBlockActionLabel)) return {alreadyDone: true}
        return null
    }, 5000, 250)
    if(!confirmButton) {
        const retryUnblockButton = getMenuAction(isUnblockActionLabel)
        if(retryUnblockButton) {
            activateActionElement(retryUnblockButton)
            confirmButton = await waitForAction(() => {
                const button = getUnblockConfirmAction()
                if(button) return button
                if(getMenuAction(isBlockActionLabel)) return {alreadyDone: true}
                return null
            }, 3000, 250)
        }
    }

    if(confirmButton && !confirmButton.alreadyDone) {
        await recordReverseActionProgress({
            event: 'Reverse action confirmed unblock',
            selectedActionLabel: getActionDebugLabel(confirmButton),
            selectedActionRect: getActionDebugRect(confirmButton),
            ...getReverseActionDebugSnapshot()
        })
        activateActionElement(confirmButton)
    }
    else if(confirmButton?.alreadyDone) {
        await recordReverseActionProgress({
            event: 'Reverse action observed unblock already completed',
            ...getReverseActionDebugSnapshot()
        })
    }
    else {
        await recordReverseActionProgress({
            event: 'Reverse action did not find an unblock confirmation',
            ...getReverseActionDebugSnapshot()
        })
    }

    let unblocked = await waitForVerifiedProfileUnblocked(
        confirmButton?.alreadyDone ? 2500 : 8000,
        250,
        silent
    )

    if(!unblocked && isUnblockConfirmPending()) {
        const retryConfirmButton = getUnblockConfirmAction()
        if(retryConfirmButton) {
            await recordReverseActionProgress({
                event: 'Reverse action retried unblock confirmation',
                selectedActionLabel: getActionDebugLabel(retryConfirmButton),
                selectedActionRect: getActionDebugRect(retryConfirmButton),
                ...getReverseActionDebugSnapshot()
            })
            activateActionElement(retryConfirmButton)
            unblocked = await waitForVerifiedProfileUnblocked(8000, 250, silent)
        }
    }

    if(!unblocked) {
        await recordReverseActionProgress({
            event: 'Reverse action unblock verification failed',
            ...getReverseActionDebugSnapshot()
        })
        reportActionIssue('Unblock did not take effect', silent)
        return {ok: false, changed: false, reason: 'unblock-did-not-take-effect'}
    }

    rememberProfileUnblocked()
    if(clearNukeState) {
        await maybeClearCurrentProfileNukeStateFromLiveUnblocked()
    }
    return {ok: true, changed: true, reason: 'unblocked'}
}

async function unmuteProfile(options = {}) {
    const {silent = false, allowForegroundFallback = false} = options
    const menuOpened = await ensureProfileMenuOpen(2500, silent, allowForegroundFallback)
    if(!menuOpened) return {ok: false, changed: false, reason: 'profile-menu-not-open'}

    await sleep(300)

    const unmuteState = await waitForMenuStateWithForegroundFallback(isUnmuteActionLabel, isMuteActionLabel, {
        timeoutMs: 5000,
        intervalMs: 250,
        promotionReason: 'unmute-option-not-found',
        silent,
        allowForegroundFallback
    })

    if(unmuteState?.state === 'inverse') {
        await closeProfileMenu()
        return {ok: true, changed: false, reason: 'already-unmuted'}
    }

    const unmuteButton = unmuteState?.button || getMenuAction(isUnmuteActionLabel)
    if(!unmuteButton) {
        reportActionIssue('Unmute option not found', silent)
        return {ok: false, changed: false, reason: 'unmute-option-not-found', labels: getVisibleProfileMenuActionLabels()}
    }

    activateActionElement(unmuteButton)

    const confirmButton = await waitForAction(() => getUnmuteConfirmAction(), 1500, 250)
    if(confirmButton) {
        await activateConfirmationElement(confirmButton, isUnmuteConfirmPending, 'unmute')
    }
    else {
        const unmutedWithoutConfirm = await waitForProfileMenuState('inverse', isUnmuteActionLabel, isMuteActionLabel, 2500, 500, silent, allowForegroundFallback)
        if(unmutedWithoutConfirm) {
            await closeProfileMenu()
            return {ok: true, changed: true, reason: 'unmuted'}
        }

        await dismissProfileActionSurface()
        const unmutedAfterDismiss = await waitForProfileMenuState('inverse', isUnmuteActionLabel, isMuteActionLabel, 5000, 500, silent, allowForegroundFallback)
        if(unmutedAfterDismiss) {
            await closeProfileMenu()
            return {ok: true, changed: true, reason: 'unmuted'}
        }

        return {ok: false, changed: true, reason: 'unmute-confirm-not-found'}
    }

    const unmuted = await waitForProfileMenuState('inverse', isUnmuteActionLabel, isMuteActionLabel, 8000, 500, silent, allowForegroundFallback)
    if(!unmuted) {
        await dismissProfileActionSurface()
        reportActionIssue('Unmute did not take effect', silent)
        return {ok: false, changed: true, reason: 'unmute-did-not-take-effect'}
    }

    await closeProfileMenu()
    return {ok: true, changed: true, reason: 'unmuted'}
}

async function unmuteProfileBestEffort(options = {}) {
    const {silent = true, allowForegroundFallback = false} = options
    if(getPageType() !== 'profile') return {ok: false, changed: false, reason: 'not-profile-page'}

    if(!getProfileMenuButton()) {
        await waitForCondition(() => !!getProfileMenuButton(), 1500, 100)
    }

    const menuOpened = await ensureProfileMenuOpen(1500, true, allowForegroundFallback)
    if(!menuOpened) return {ok: false, changed: false, reason: 'profile-menu-not-open'}

    await sleep(150)

    const unmuteState = await waitForMenuStateWithForegroundFallback(isUnmuteActionLabel, isMuteActionLabel, {
        timeoutMs: 2000,
        intervalMs: 150,
        promotionReason: 'unmute-option-not-found',
        silent: true,
        allowForegroundFallback
    })

    if(unmuteState?.state === 'inverse') {
        await closeProfileMenu()
        return {ok: true, changed: false, reason: 'already-unmuted'}
    }

    const unmuteButton = unmuteState?.button || getMenuAction(isUnmuteActionLabel)
    if(!unmuteButton) {
        await closeProfileMenu()
        return {ok: true, changed: false, reason: 'unmute-option-not-offered'}
    }

    activateActionElement(unmuteButton)

    const confirmButton = await waitForAction(() => getUnmuteConfirmAction(), 1000, 150)
    if(confirmButton) {
        await activateConfirmationElement(confirmButton, isUnmuteConfirmPending, 'unmute')
        await waitForCondition(() => !isUnmuteConfirmPending(), 2500, 200)
    }

    const unmuted = await waitForProfileMenuState('inverse', isUnmuteActionLabel, isMuteActionLabel, 2500, 250, true, allowForegroundFallback)
    if(unmuted) return {ok: true, changed: true, reason: 'unmuted'}

    await dismissProfileActionSurface()
    if(!silent) reportActionIssue('Unmute could not be verified', true)
    // The click was dispatched but the menu never reported the inverse state,
    // so the profile may still be muted. This must not read as success: callers
    // gate terminal unblock-unmute success on ok.
    return {ok: false, changed: true, reason: 'unmute-clicked-unverified'}
}

async function waitForCanonicalProfileActionRoute(profileHref, timeoutMs = WAIT_FOR_CANONICAL_PROFILE_ACTION_ROUTE_DEFAULT_TIMEOUT_MS) {
    if(!profileHref) return false

    let canonicalPath = ''
    try {
        canonicalPath = new URL(profileHref).pathname
    }
    catch {
        return false
    }

    const isCanonical = () => {
        return getProfileKey(location.href) === profileHref &&
            location.pathname === canonicalPath &&
            document.readyState !== 'loading'
    }

    if(isCanonical()) return true

    if(getProfileKey(location.href) === profileHref && location.pathname !== canonicalPath) {
        maybeRedirectToCanonicalProfileUrl()
    }

    return waitForCondition(isCanonical, timeoutMs, 200)
}

async function unblockUnmuteProfile(options = {}) {
    const {silent = false, allowForegroundFallback = false, clearNukeState = true} = options
    if(getPageType() !== 'profile') return {ok: false, reason: 'not-profile-page'}

    const ready = await waitForProfileActionReady()
    if(!ready) return {ok: false, reason: 'profile-actions-not-ready'}

    const profileHref = getProfileKey(location.href) || location.href
    const startedBlocked = isProfileBlocked()
    let unblock = {ok: true, changed: false, reason: 'already-unblocked'}
    let unmute = {ok: true, changed: false, reason: 'not-needed'}

    if(startedBlocked) {
        const maxReverseAttempts = 3
        let verified = false

        for(let attempt = 1; attempt <= maxReverseAttempts; attempt += 1) {
            await recordReverseActionProgress({
                event: attempt === 1
                    ? 'Reverse action started blocked-profile flow'
                    : 'Reverse action retrying blocked-profile flow after transient failure',
                reverseAttempt: attempt,
                ...getReverseActionDebugSnapshot()
            })

            await waitForCanonicalProfileActionRoute(profileHref, 5000)
            unblock = await unblockProfile({silent: true, allowForegroundFallback, clearNukeState})
            verified = unblock?.ok && await waitForVerifiedProfileUnblocked(3500, 250, true, allowForegroundFallback)

            await recordReverseActionProgress({
                event: verified
                    ? 'Reverse action unblock step verified'
                    : 'Reverse action unblock step did not verify',
                reverseAttempt: attempt,
                unblockReason: unblock?.reason || '',
                unblockOk: !!unblock?.ok,
                ...getReverseActionDebugSnapshot()
            })

            if(verified) {
                unmute = await unmuteProfileBestEffort({silent: true, allowForegroundFallback})
                await recordReverseActionProgress({
                    event: 'Reverse action post-unblock unmute step completed',
                    reverseAttempt: attempt,
                    unmuteReason: unmute?.reason || '',
                    unmuteOk: !!unmute?.ok,
                    ...getReverseActionDebugSnapshot()
                })
                break
            }
            if(attempt >= maxReverseAttempts) break

            unmute = await unmuteProfileBestEffort({silent: true, allowForegroundFallback})
            await recordReverseActionProgress({
                event: 'Reverse action pre-retry unmute step completed',
                reverseAttempt: attempt,
                unmuteReason: unmute?.reason || '',
                unmuteOk: !!unmute?.ok,
                ...getReverseActionDebugSnapshot()
            })

            await dismissProfileActionSurface()
            await waitForCanonicalProfileActionRoute(profileHref, 5000)
            await sleep(750)
        }

        if(!verified) {
            return {ok: false, reason: unblock.reason || 'unblock-failed', unblock, unmute}
        }

        rememberProfileUnblocked(profileHref)
        // The unblock verified, but a profile that is still muted is not a
        // completed reverse action. Keep the nuke state so the retry runs again.
        // 1 Nov: an unmute that is not ok is not a completed reverse action, whatever the reason (menu not open, option not found, unverified).
        if(unmute && unmute.ok !== true) {
            return {ok: false, reason: unmute.reason || 'unmute-failed', unblock, unmute}
        }
        if(clearNukeState) {
            await clearProfileNukeState(profileHref, 'Pardon action unblocked the profile')
        }
    }
    else {
        // Unlike the startedBlocked branch above, unmuteProfileBestEffort()
        // never records any progress patch of its own -- without this call,
        // a fresh href taking this path (already unblocked, just needs
        // unmuting) could complete the whole action with actionKind left
        // blank in the persisted record.
        await recordReverseActionProgress({
            event: 'Reverse action started already-unblocked flow',
            ...getReverseActionDebugSnapshot()
        })
        unmute = await unmuteProfileBestEffort({silent, allowForegroundFallback})
        // 1 Nov: the same rule as the queued path. An unmute that is not ok fails the Pardon.
        if(!unmute.ok) {
            return {ok: false, reason: unmute.reason || 'unmute-failed', unmute}
        }
    }

    if(isProfileBlocked({ignoreHints: true}) && !isProfileVisiblyUnblocked()) {
        return {ok: false, reason: 'profile-still-blocked', unblock, unmute}
    }

    rememberProfileUnblocked(profileHref)
    if(clearNukeState) {
        await clearProfileNukeState(profileHref, 'Pardon action completed on a live unblocked profile')
    }
    scheduleProfileButtonsRefresh(150)
    return {
        ok: true,
        unblock,
        unmute,
        profileHref
    }
}

async function muteProfile(options = {}) {
    const {allowBlockFallback = false, silent = false, allowForegroundFallback = false} = options
    // muteProfile() has exactly one caller -- handleMuteBlockClick, the
    // legacy direct profile-page button -- so this is the one place that
    // needs to stamp actionKind for that whole flow (blockProfile() is only
    // ever reached through here). Without it, every patch in the sequence
    // spreads `actionKind` forward from an empty `previous`, leaving the
    // persisted record's actionKind blank forever: harmless behaviorally
    // (nothing branches on it for the mute-block path), but useless for the
    // recorded history this exists to support.
    // Sent now but not awaited. It used to hold up the menu until the worker
    // had written it through the storage queue, which under load was seconds.
    // The message is still sent first, so the write stays ahead of the later
    // milestones; a failure is caught below and does not stop the flow.
    void recordCurrentProfileNukeProgress({
        actionKind: 'mute-block',
        status: 'muting',
        muteAttempted: true,
        muteAttemptedAt: Date.now(),
        event: 'Mute flow started'
    }).catch(() => null)

    const menuOpened = await ensureProfileMenuOpen(2500, silent, allowForegroundFallback)
    if(!menuOpened) {
        await recordCurrentProfileNukeProgress({
            muteSucceeded: false,
            muteError: 'Profile menu did not open',
            event: 'Mute flow fell back because the profile menu did not open'
        })
        return allowBlockFallback ? blockProfile({silent, allowForegroundFallback}) : false
    }

    // No fixed sleep here: the menu-state wait below polls until the items render.

    const muteState = await waitForMenuStateWithForegroundFallback(isMuteActionLabel, isUnmuteActionLabel, {
        timeoutMs: 5000,
        intervalMs: 250,
        promotionReason: 'mute-option-not-found',
        silent,
        allowForegroundFallback
    })
    if(muteState?.state === 'inverse') {
        await recordCurrentProfileNukeProgress({
            muteSucceeded: true,
            mutedAt: Date.now(),
            event: 'Profile was already muted'
        })
    }
    else {
        let muteBtn = muteState?.button || getMenuAction(isMuteActionLabel)
        if(!muteBtn) {
            await recordCurrentProfileNukeProgress({
                muteSucceeded: false,
                muteError: 'Mute option not found',
                menuActionLabels: getVisibleProfileMenuActionLabels(),
                event: 'Mute option not found'
            })
            reportActionIssue('Mute option not found', silent)
            return allowBlockFallback ? blockProfile({silent, allowForegroundFallback}) : false
        }

        activateActionElement(muteBtn)

        let confirmBtn = await waitForAction(() => getMuteConfirmAction(), 8000, 250)
        if(!confirmBtn) {
            await recordCurrentProfileNukeProgress({
                muteSucceeded: false,
                muteError: 'Confirm button not found',
                event: 'Mute confirm button not found'
            })
            await dismissPendingConfirmationAfterFailure('mute', 'confirm-button-not-found')
            reportActionIssue('Confirm button not found', silent)
            return allowBlockFallback ? blockProfile({silent, allowForegroundFallback}) : false
        }

        let activation = await activateConfirmationElement(confirmBtn, isMuteConfirmPending, 'mute')
        if(isConfirmationForegroundUnavailable(activation)) {
            await recordCurrentProfileNukeProgress({
                muteSucceeded: false,
                muteError: 'Mute confirm foreground unavailable',
                finalError: `Mute confirm foreground unavailable: ${activation.reason || 'unknown'}`,
                event: 'Mute confirm foreground unavailable',
                confirmationForegroundReason: activation.reason || ''
            })
            await dismissPendingConfirmationAfterFailure('mute', 'confirm-foreground-unavailable')
            reportActionIssue('Mute confirm foreground unavailable', silent)
            return false
        }

        let confirmClosed = await waitForCondition(() => !isMuteConfirmPending(), 2500, 250)
        if(!confirmClosed) {
            confirmBtn = getMuteConfirmAction()
            if(confirmBtn) {
                activation = await activateConfirmationElement(confirmBtn, isMuteConfirmPending, 'mute')
                if(isConfirmationForegroundUnavailable(activation)) {
                    await recordCurrentProfileNukeProgress({
                        muteSucceeded: false,
                        muteError: 'Mute confirm foreground unavailable',
                        finalError: `Mute confirm foreground unavailable: ${activation.reason || 'unknown'}`,
                        event: 'Mute confirm foreground unavailable',
                        confirmationForegroundReason: activation.reason || ''
                    })
                    await dismissPendingConfirmationAfterFailure('mute', 'confirm-foreground-unavailable')
                    reportActionIssue('Mute confirm foreground unavailable', silent)
                    return false
                }
            }
            confirmClosed = await waitForCondition(() => !isMuteConfirmPending(), 6000, 250)
        }

        if(!confirmClosed) {
            await recordCurrentProfileNukeProgress({
                muteSucceeded: false,
                muteError: 'Mute confirm did not complete',
                event: 'Mute confirm did not complete'
            })
            await dismissPendingConfirmationAfterFailure('mute', 'confirm-did-not-complete')
            reportActionIssue('Mute confirm did not complete', silent)
            return false
        }

        const mutedApplied = await waitForProfileMenuState('inverse', isMuteActionLabel, isUnmuteActionLabel, 8000, 500)
        if(!mutedApplied) {
            await recordCurrentProfileNukeProgress({
                muteSucceeded: false,
                muteError: 'Mute did not take effect',
                event: 'Mute did not take effect'
            })
            await dismissPendingConfirmationAfterFailure('mute', 'mute-did-not-take-effect')
            reportActionIssue('Mute did not take effect', silent)
            return allowBlockFallback ? blockProfile({silent, allowForegroundFallback}) : false
        }

        await recordCurrentProfileNukeProgress({
            muteSucceeded: true,
            mutedAt: Date.now(),
            finalError: '',
            event: 'Mute completed'
        })
        await sleep(300)
    }

    return blockProfile({silent, allowForegroundFallback})
}

// The page's own record decides a block (31 Oct). A label can read blocked while the record says not blocked (a stale "Unblock" in the menu,
// or a label that flips before the record does), so a label alone no longer counts as a block. null means this page has no record, and
// the label decides as before.
async function waitForProfileRecordBlocked(timeoutMs = WAIT_FOR_PROFILE_RECORD_BLOCKED_DEFAULT_TIMEOUT_MS, intervalMs = WAIT_FOR_PROFILE_RECORD_BLOCKED_DEFAULT_INTERVAL_MS) {
    const deadline = Date.now() + timeoutMs
    let verdict = readOwnProfileBlockedField()
    while(verdict === false && Date.now() < deadline) {
        await sleep(intervalMs)
        verdict = readOwnProfileBlockedField()
    }
    return verdict
}

// After a block click, a blocked label is counted only when the record does not say not blocked, once it has had its wait.
async function confirmBlockedAfterClick(silent, event) {
    if(await waitForProfileRecordBlocked() === false) {
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Page record does not confirm the block',
            event: 'Labels read blocked after the click, but the profile record says not blocked'
        })
        reportActionIssue('Page record does not confirm the block', silent)
        return false
    }
    rememberProfileBlocked()
    await recordCurrentProfileNukeProgress({
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: Date.now(),
        event
    })
    return true
}

// The block, verified against the page's own record. When a block reports success but the record still reads not blocked, the block
// flow runs once more. It never runs again once the record reads blocked, and the flow itself sees an Unblock menu as already
// done, so a second pass cannot undo a block (Oct 31).
async function blockProfile(options = {}) {
    const first = await blockProfileOnce(options)
    if(!first) return first
    // Nothing was blocked here when the page already reads blocked, or the profile is followed (the block flow skips both). Waiting
    // for a record to settle would only slow those profiles down (Oct 31: the already-blocked path had gone up by the 1.5 s wait).
    if(readOwnProfileBlockedField() === true || isProfileFollowedByCurrentUser()) return first
    await sleep(1500)
    if(readOwnProfileBlockedField() !== false) return first
    return blockProfileOnce(options)
}

async function blockProfileOnce(options = {}) {
    const {silent = false, allowForegroundFallback = false} = options

    // Checked before anything else: a candidate the current user already
    // follows should never be blocked, regardless of how it got queued (a
    // maintained followers list isn't practical to get out of Quora, so
    // this is a page-DOM check at the moment of action, not a lookup).
    // Terminal and counted, not silently dropped, so a run where this fires
    // a lot is visible rather than looking like candidates quietly
    // vanished.
    if(isProfileFollowedByCurrentUser()) {
        await recordCurrentProfileNukeProgress({
            status: 'block-attempt-on-following',
            blockAttempted: false,
            blockSucceeded: false,
            event: 'Block flow skipped because the profile is already followed'
        })
        return true
    }

    const alreadyBlockedOnEntry = isProfileBlockedConfirmed()
    reportInitialBlockedStateIfQueued(alreadyBlockedOnEntry)

    if(alreadyBlockedOnEntry) {
        await recordCurrentProfileNukeProgress({
            status: 'already-blocked',
            foundBlockedBeforeQueue: true,
            blockAttempted: false,
            blockSucceeded: true,
            blockedAt: Date.now(),
            event: 'Block flow skipped because the profile was already blocked'
        })
        return true
    }

    const pendingBlockConfirm = getBlockConfirmAction()
    if(pendingBlockConfirm) {
        await recordCurrentProfileNukeProgress({
            status: 'blocking',
            blockAttempted: true,
            blockAttemptedAt: Date.now(),
            event: 'Block flow resumed from pending confirmation'
        })

        if(await completePendingBlockConfirmation(pendingBlockConfirm, silent)) return true
    }

    await recordCurrentProfileNukeProgress({
        status: 'blocking',
        blockAttempted: true,
        blockAttemptedAt: Date.now(),
        event: 'Block flow started'
    })

    const menuOpened = await ensureProfileMenuOpen(2500, silent, allowForegroundFallback)
    if(!menuOpened) {
        const diagnostic = getDirectBlockActionDiagnostic('profile-menu-did-not-open', {
            menuOpenResult: false,
            finalBlockedState: isProfileBlocked()
        })
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Profile menu did not open',
            directBlockFailureDetail: diagnostic,
            event: 'Block flow failed because the profile menu did not open'
        })
        return false
    }

    noteCurrentProfileNukeProgress({
        event: 'Block profile menu opened'
    })

    let blockState = await waitForMenuStateWithForegroundFallback(isBlockActionLabel, isUnblockActionLabel, {
        timeoutMs: 5000,
        intervalMs: PROFILE_MENU_POLL_INTERVAL_MS,
        promotionReason: 'block-option-not-found',
        silent,
        allowForegroundFallback
    })
    if(!blockState) {
        await recordCurrentProfileNukeProgress({
            event: 'Block option was not found on the first menu read; reopening profile menu',
            menuActionLabels: getVisibleProfileMenuActionLabels(),
            profileMenuOpen: isProfileMenuOpen(),
            profileMenuButtonRect: getProfileMenuButtonDebugRect()
        })

        await closeProfileMenu()
        await sleep(250)
        const reopened = await ensureProfileMenuOpen(2500, silent, allowForegroundFallback)
        if(reopened) {
            await sleep(500)
            blockState = await waitForMenuStateWithForegroundFallback(isBlockActionLabel, isUnblockActionLabel, {
                timeoutMs: 3000,
                intervalMs: 200,
                promotionReason: 'block-option-not-found-after-reopen',
                silent,
                allowForegroundFallback
            })
        }
    }
    if(blockState?.state === 'inverse') {
        await closeProfileMenu()
        // Nothing has been clicked yet. A menu that reads Unblock against a record that says not blocked is not counted as blocked (31 Oct).
        if(readOwnProfileBlockedField() === false) {
            await recordCurrentProfileNukeProgress({
                blockSucceeded: false,
                blockError: 'Menu reads Unblock but the profile record says not blocked',
                event: 'Menu label and profile record disagree before any block action'
            })
            reportActionIssue('Menu reads Unblock but the profile record says not blocked', silent)
            return false
        }
        rememberProfileBlocked()
        await recordCurrentProfileNukeProgress({
            status: 'blocked',
            foundBlockedBeforeQueue: true,
            blockSucceeded: true,
            blockedAt: Date.now(),
            event: 'Profile was already blocked when block flow inspected the menu'
        })
        return true
    }

    let blockOpt = blockState?.button || getMenuAction(isBlockActionLabel)
    if(!blockOpt) {
        if(isProfileBlocked() && readOwnProfileBlockedField() !== false) {
            await recordCurrentProfileNukeProgress({
                status: 'blocked',
                blockSucceeded: true,
                blockedAt: Date.now(),
                event: 'Profile reached blocked state before block option lookup completed'
            })
            return true
        }

        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Block option not found',
            menuActionLabels: getVisibleProfileMenuActionLabels(),
            profileMenuOpen: isProfileMenuOpen(),
            profileMenuButtonRect: getProfileMenuButtonDebugRect(),
            directBlockFailureDetail: getDirectBlockActionDiagnostic('block-option-not-found', {
                blockOptionLookupResult: false,
                finalBlockedState: isProfileBlocked()
            }),
            event: 'Block option not found'
        })
        reportActionIssue('Block option not found', silent)
        return false
    }

    noteCurrentProfileNukeProgress({
        event: 'Block option found'
    })
    const initialMutationCount = profileBlockMutationCount
    activateActionElement(blockOpt)
    noteCurrentProfileNukeProgress({
        event: 'Block option clicked'
    })

    const confirmState = await waitForAction(() => {
        const confirmButton = getBlockConfirmAction()
        if(confirmButton) return {type: 'confirm', button: confirmButton}
        if(profileBlockMutationCount > initialMutationCount || isProfileBlocked()) return {type: 'blocked'}
        if(getMenuAction(isUnblockActionLabel)) return {type: 'blocked'}
        return null
    }, 8000, 250)

    if(!confirmState) {
        const blockedAppliedEarly = await waitForProfileMenuState('inverse', isBlockActionLabel, isUnblockActionLabel, 1500, 200)
        if(blockedAppliedEarly || isProfileBlocked()) {
            return confirmBlockedAfterClick(silent, 'Block applied before confirm state resolved')
        }

        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Block button not found',
            directBlockFailureDetail: getDirectBlockActionDiagnostic('block-confirm-button-not-found', {
                confirmLookupResult: false,
                finalBlockedState: isProfileBlocked()
            }),
            event: 'Block confirm button not found'
        })
        await dismissPendingConfirmationAfterFailure('block', 'confirm-button-not-found')
        reportActionIssue('Block button not found', silent)
        return false
    }

    if(confirmState.type === 'blocked') {
        return confirmBlockedAfterClick(silent, 'Profile reached blocked state without an explicit confirm click')
    }

    // The block can apply while the confirm is being found. Clicking the confirm then would be a second click on a button that may
    // now read Unblock, so the flow stops here (Oct 31, William Birge).
    if(isProfileBlocked()) {
        return confirmBlockedAfterClick(silent, 'Profile reached blocked state before the confirm click')
    }

    let blockBtn = confirmState.button
    noteCurrentProfileNukeProgress({
        event: 'Block confirm found'
    })
    let activation = await activateConfirmationElement(blockBtn, isBlockConfirmPending, 'block')
    noteCurrentProfileNukeProgress({
        event: 'Block confirm activation attempted'
    })
    if(isConfirmationForegroundUnavailable(activation)) {
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Block confirm foreground unavailable',
            finalError: `Block confirm foreground unavailable: ${activation.reason || 'unknown'}`,
            directBlockFailureDetail: getDirectBlockActionDiagnostic('block-confirm-foreground-unavailable', {
                confirmLookupResult: true,
                confirmActivationResult: activation,
                finalBlockedState: isProfileBlocked()
            }),
            event: 'Block confirm foreground unavailable',
            confirmationForegroundReason: activation.reason || ''
        })
        await dismissPendingConfirmationAfterFailure('block', 'confirm-foreground-unavailable')
        reportActionIssue('Block confirm foreground unavailable', silent)
        return false
    }

    await waitForCondition(() => profileBlockMutationCount > initialMutationCount, 5000, 250)

    let blockClosed = await waitForCondition(() => !isBlockConfirmPending(), 2500, 250)
    if(!blockClosed) {
        blockBtn = getBlockConfirmAction()
        if(blockBtn) {
            activation = await activateConfirmationElement(blockBtn, isBlockConfirmPending, 'block')
            if(isConfirmationForegroundUnavailable(activation)) {
                await recordCurrentProfileNukeProgress({
                    blockSucceeded: false,
                    blockError: 'Block confirm foreground unavailable',
                    finalError: `Block confirm foreground unavailable: ${activation.reason || 'unknown'}`,
                    directBlockFailureDetail: getDirectBlockActionDiagnostic('block-confirm-foreground-unavailable-retry', {
                        confirmLookupResult: true,
                        confirmActivationResult: activation,
                        finalBlockedState: isProfileBlocked()
                    }),
                    event: 'Block confirm foreground unavailable',
                    confirmationForegroundReason: activation.reason || ''
                })
                await dismissPendingConfirmationAfterFailure('block', 'confirm-foreground-unavailable')
                reportActionIssue('Block confirm foreground unavailable', silent)
                return false
            }
        }
        blockClosed = await waitForCondition(() => !isBlockConfirmPending(), 6000, 250)
    }

    if(!blockClosed && !isProfileBlocked()) {
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Block confirm did not complete',
            directBlockFailureDetail: getDirectBlockActionDiagnostic('block-confirm-did-not-complete', {
                confirmLookupResult: !!getBlockConfirmAction(),
                finalBlockedState: isProfileBlocked()
            }),
            event: 'Block confirm did not complete'
        })
        await dismissPendingConfirmationAfterFailure('block', 'confirm-did-not-complete')
        reportActionIssue('Block confirm did not complete', silent)
        return false
    }

    const blockedApplied = await waitForVerifiedProfileBlocked(8000, 250)
    if(!blockedApplied) {
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Block did not take effect',
            directBlockFailureDetail: getDirectBlockActionDiagnostic('block-did-not-take-effect', {
                finalBlockedState: isProfileBlocked()
            }),
            event: 'Block did not take effect'
        })
        reportActionIssue('Block did not take effect', silent)
        return false
    }

    rememberProfileBlocked()
    await recordCurrentProfileNukeProgress({
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: Date.now(),
        finalError: '',
        event: 'Block completed'
    })
    scheduleProfileButtonsRefresh(150)
    await waitForCondition(() => !document.querySelector('.mb-ext_mute-block-btn'), 3000, 150)
    return true
}

async function completePendingBlockConfirmation(initialButton = null, silent = false) {
    const initialMutationCount = profileBlockMutationCount
    let blockBtn = initialButton || getBlockConfirmAction()
    if(!blockBtn) return false

    noteCurrentProfileNukeProgress({
        event: 'Block confirm found'
    })
    let activation = await activateConfirmationElement(blockBtn, isBlockConfirmPending, 'block')
    noteCurrentProfileNukeProgress({
        event: 'Block confirm activation attempted'
    })
    if(isConfirmationForegroundUnavailable(activation)) {
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Block confirm foreground unavailable',
            finalError: `Block confirm foreground unavailable: ${activation.reason || 'unknown'}`,
            event: 'Block confirm foreground unavailable',
            confirmationForegroundReason: activation.reason || ''
        })
        await dismissPendingConfirmationAfterFailure('block', 'confirm-foreground-unavailable')
        reportActionIssue('Block confirm foreground unavailable', silent)
        return false
    }

    await waitForCondition(() => profileBlockMutationCount > initialMutationCount, 5000, 250)

    let blockClosed = await waitForCondition(() => !isBlockConfirmPending(), 2500, 250)
    if(!blockClosed) {
        blockBtn = getBlockConfirmAction()
        if(blockBtn) {
            activation = await activateConfirmationElement(blockBtn, isBlockConfirmPending, 'block')
            if(isConfirmationForegroundUnavailable(activation)) {
                await recordCurrentProfileNukeProgress({
                    blockSucceeded: false,
                    blockError: 'Block confirm foreground unavailable',
                    finalError: `Block confirm foreground unavailable: ${activation.reason || 'unknown'}`,
                    event: 'Block confirm foreground unavailable',
                    confirmationForegroundReason: activation.reason || ''
                })
                await dismissPendingConfirmationAfterFailure('block', 'confirm-foreground-unavailable')
                reportActionIssue('Block confirm foreground unavailable', silent)
                return false
            }
        }
        blockClosed = await waitForCondition(() => !isBlockConfirmPending(), 6000, 250)
    }

    if(!blockClosed && !isProfileBlocked()) {
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Block confirm did not complete',
            event: 'Block confirm did not complete'
        })
        await dismissPendingConfirmationAfterFailure('block', 'confirm-did-not-complete')
        reportActionIssue('Block confirm did not complete', silent)
        return false
    }

    const blockedApplied = await waitForVerifiedProfileBlocked(8000, 250)
    if(!blockedApplied) {
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Block did not take effect',
            event: 'Block did not take effect'
        })
        reportActionIssue('Block did not take effect', silent)
        return false
    }

    rememberProfileBlocked()
    await recordCurrentProfileNukeProgress({
        status: 'blocked',
        blockSucceeded: true,
        blockedAt: Date.now(),
        finalError: '',
        event: 'Block completed'
    })
    scheduleProfileButtonsRefresh(150)
    await waitForCondition(() => !document.querySelector('.mb-ext_mute-block-btn'), 3000, 150)
    return true
}

function toggleMenu(silent = false) {
    let menu = getProfileMenuButton()
    if(!menu) {
        reportActionIssue('Profile menu not found', silent)
        return false
    }

    try {
        menu.scrollIntoView({block: 'center', inline: 'nearest'})
    }
    catch {}

    try {
        menu.focus({preventScroll: true})
    }
    catch {
        try {
            menu.focus()
        }
        catch {}
    }

    return activateActionElement(menu)
}

function isProfileMenuOpen() {
    return isProfileActionMenuOpen()
}

async function dismissNonProfileMenuSurface() {
    if(isProfileActionMenuOpen()) return false
    if(!getOverlayRoots(false).length) return false

    dispatchEscapeKey()
    await sleep(200)
    return true
}

function dispatchEscapeKey() {
    const eventInit = {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27
    }

    document.dispatchEvent(new KeyboardEvent('keydown', eventInit))
    document.dispatchEvent(new KeyboardEvent('keyup', eventInit))
}

async function ensureProfileMenuOpen(timeoutMs = ENSURE_PROFILE_MENU_OPEN_DEFAULT_TIMEOUT_MS, silent = false, allowForegroundFallback = false) {
    if(isProfileMenuOpen()) return true

    await dismissNonProfileMenuSurface()
    if(!toggleMenu(silent)) return false

    let opened = await waitForConditionOrDomMutation(() => isProfileMenuOpen(), timeoutMs, 100)
    if(!opened) {
        const menu = getProfileMenuButton()
        if(menu) {
            dispatchActivationKey(menu, 'Enter')
            opened = await waitForConditionOrDomMutation(() => isProfileMenuOpen(), Math.min(timeoutMs, 1200), 100)
        }
    }
    if(!opened) {
        const menu = getProfileMenuButton()
        if(menu) {
            dispatchActivationKey(menu, ' ')
            opened = await waitForConditionOrDomMutation(() => isProfileMenuOpen(), Math.min(timeoutMs, 1200), 100)
        }
    }
    if(!opened && document.visibilityState !== 'visible' && allowForegroundFallback) {
        await recordCurrentProfileNukeProgress({
            event: 'Profile menu did not open in the background; requesting foreground fallback'
        })
        const promotion = await promoteCurrentQueuedTab('profile-menu-not-open', allowForegroundFallback)
        if(!promotion.promoted) {
            await recordCurrentProfileNukeProgress({
                event: 'Foreground fallback did not promote the tab while opening profile menu',
                foregroundPromotionDeniedReason: promotion.reason || ''
            })
            return false
        }
        if(promotion.promoted) {
            await sleep(300)
            opened = isProfileMenuOpen()
            for(let attempt = 0; attempt < 2 && !isProfileMenuOpen(); attempt += 1) {
                await dismissNonProfileMenuSurface()
                toggleMenu(true)
                opened = await waitForConditionOrDomMutation(() => isProfileMenuOpen(), timeoutMs, 100)
                if(opened) break
                await sleep(250)
            }
        }
    }

    for(let attempt = 0; attempt < 2 && !opened; attempt += 1) {
        dispatchEscapeKey()
        await sleep(200)
        await dismissNonProfileMenuSurface()
        if(!toggleMenu(true)) break
        opened = await waitForConditionOrDomMutation(() => isProfileMenuOpen(), Math.min(timeoutMs, 1800), 100)
        if(!opened) {
            const menu = getProfileMenuButton()
            if(menu) {
                dispatchActivationKey(menu, 'Enter')
                opened = await waitForConditionOrDomMutation(() => isProfileMenuOpen(), Math.min(timeoutMs, 1200), 100)
            }
        }
        if(!opened) await sleep(250)
    }

    if(!opened) {
        await recordCurrentProfileNukeProgress({
            event: 'Profile menu did not open after retries',
            ...getReverseActionDebugSnapshot()
        })
        reportActionIssue('Profile menu did not open', silent)
        return false
    }

    return true
}

async function closeProfileMenu(timeoutMs = CLOSE_PROFILE_MENU_DEFAULT_TIMEOUT_MS) {
    if(!isProfileMenuOpen()) return true

    dispatchEscapeKey()
    const firstCloseWindowMs = Math.min(timeoutMs, 600)
    let closed = await waitForCondition(() => !isProfileMenuOpen(), firstCloseWindowMs, 100)
    if(closed) return true

    if(!toggleMenu(true)) return false
    closed = await waitForCondition(() => !isProfileMenuOpen(), timeoutMs, 100)
    if(closed) return true

    dispatchEscapeKey()
    return waitForCondition(() => !isProfileMenuOpen(), timeoutMs, 100)
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}
