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
const {
    MAX_REMEMBERED_NUKED_POSTS_KEY,
    NUKED_POST_RETENTION_DAYS_KEY,
    SPACE_NUKED_POSTS_KEY,
    getPrunedNukedPosts,
    haveSameNukedPostKeys
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
    normalizeSpaceUrl
} = require('./spaceRegistry')
const {
    QUORA_NON_PROFILE_ROOT_PATHS,
    isLikelyExplicitProfileTargetHref,
    isLikelyExplicitProfileTargetSlug,
    normalizeQuoraProfileHref,
    sanitizeProfileHrefSlug
} = require('./subject')
const {
    mapProgressToCoordinatorState
} = require('./jobState')

const SPACE_FEED_PROFILES_PER_BATCH = 3
const MODAL_PROFILE_NUKE_PROFILES_PER_BATCH = 3
const PROFILE_SEARCH_PROFILES_PER_BATCH = 3
const PROFILE_SEARCH_COLLECT_LIMIT = 100
const PROFILE_SEARCH_COLLECT_MAX_SCROLL_PASSES = 120
const PROFILE_SEARCH_COLLECT_STALLED_TIMEOUT_MS = 30000
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

let profilesModalTimeout
let profileButtonsTimeout
let profileButtonsRefreshTimeout
let profileButtonsPending = false
let profileActionInProgress = false
let profileButtonsFollowUpTimeouts = []
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
let profileSearchCollectionKey = ''
let profileSearchStagedHrefs = []
let profileSearchStagedHrefSet = new Set()
let profileSearchCollectCursorScrollY = 0
let profileSearchCollectCursorHref = ''
let profileSearchFollowUpTimeouts = []
let profileSearchPendingRefreshTimeout = null
let profileSearchLastRunId = ''
let profileSearchLastQueuedAt = 0
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
let discoveredSpaceFeedEntries = new Map()
let spaceFeedEntryCache = new Map()
let spaceFeedRootCache = new WeakMap()
let closeTabRetryTimeouts = []
let blockedCloseCheckTimeouts = []
let currentUrl = location.href
let settings = {...defaults}
let spaceRegistry = {}
let spaceNukedPosts = {}
let spacePendingNukedPosts = {}
let profileNukeProgress = {}
let coordinatorQueue = {}
let coordinatorQueueLoaded = false
let contentPageStateRefreshPromise = null
let contentPageStateRefreshAt = 0
let spaceFeedScopedStateRefreshPromise = null
let spaceFeedScopedStateRefreshActiveSignature = ''
let spaceFeedScopedStateRefreshQueuedEntries = null
let spaceFeedScopedStateRefreshQueuedSignature = ''
let spaceFeedScopedStateSignature = ''
let storageChangeListenerInstalled = false
let spaceFeedNukingPostKeys = new Set()
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
let alreadyBlockedCoordinatorReconcileKey = ''
let manualUnblockedReconcileKey = ''
const PROFILE_ACTION_BUTTON_ORDER = ['unblock-unmute', 'mute-block-close', 'mute-block', 'close-tab']
const UNBLOCK_UNMUTE_ACTION_KIND = 'unblock-unmute'
const SPACE_POST_NUKE_MIN_PROFILES = 2
const SPACE_FEED_POST_NUKE_MIN_PROFILES = 1
const QUEUED_PROFILE_RESOLUTION_MODE = 'author-profile'
const SPACE_FEED_CANDIDATE_CONFIDENCE_HIGH = 'high'
const SPACE_FEED_CANDIDATE_CONFIDENCE_MEDIUM = 'medium'
const SPACE_FEED_CANDIDATE_CONFIDENCE_LOW = 'low'
const SPACE_PENDING_NUKED_POSTS_KEY = 'mbSpacePendingNukedPosts'
const PROFILE_NUKE_PROGRESS_VIEW_KEY = 'mbProfileNukeProgressView'
const COORDINATOR_QUEUE_VIEW_KEY = 'mbCoordinatorQueueView'
const PENDING_COORDINATOR_STATUSES = new Set(['queued', 'opening', 'active', 'acting', 'settling'])
const MAX_PROFILE_NUKE_PROGRESS_ENTRIES = 1000
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
const MODAL_PROFILE_NUKE_MAX_SCROLL_PASSES = 80
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
const UNMUTE_ACTION_REGEX = /\bun[\s-]*mute\b/i
const UNBLOCK_ACTION_REGEX = /\bun[\s-]*block\b/i
const UNMUTE_CONTEXT_REGEX = /\bun[\s-]*mut(?:e|ed|ing)\b/i
const UNBLOCK_CONTEXT_REGEX = /\bun[\s-]*block(?:ed|ing)?\b/i
const TRANSIENT_PROFILE_NUKE_STATUSES = new Set([
    'queued',
    'tab-opening',
    'tab-opened',
    'awaiting-visibility',
    'page-ready',
    'retrying',
    'muting',
    'blocking'
])
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

async function init() {
    if(initialized) return
    initialized = true

    const bodyReady = document.body || await waitForCondition(() => !!document.body, 5000, 25)
    if(!bodyReady || !document.body) return

    browser.runtime.onMessage.addListener(onMessage)
    const initialPage = getPageType()
    announceQuoraRuntimeReady(initialPage)
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

    settings = await safeStorageGet(defaults)
    spaceRegistry = (await safeStorageGet({[SPACE_REGISTRY_KEY]: {}}))[SPACE_REGISTRY_KEY] || {}
    const storedSpaceNukedPosts = (await safeStorageGet({[SPACE_NUKED_POSTS_KEY]: {}}))[SPACE_NUKED_POSTS_KEY] || {}
    spaceNukedPosts = pruneRememberedSpaceNukes(storedSpaceNukedPosts)
    spacePendingNukedPosts = (await safeStorageGet({[SPACE_PENDING_NUKED_POSTS_KEY]: {}}))[SPACE_PENDING_NUKED_POSTS_KEY] || {}
    await refreshCoordinatorQueueFromRuntime({force: true})
    if(!haveSameNukedPostKeys(storedSpaceNukedPosts, spaceNukedPosts)) {
        await safeStorageSet({[SPACE_NUKED_POSTS_KEY]: spaceNukedPosts})
    }
    setStorageChangeListenerEnabled(true)
    installNavigationHooks()
    await reconcileReloadCanceledNukes()

    if(maybeRedirectToCanonicalProfileUrl()) {
        return
    }

    const page = initialPage

    if(page === 'profile') {
        ensureProfileButtons()
        scheduleProfileButtonsFollowUps()
    }
    else if(page === 'question-log') {
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
        for(const record of Object.values(spacePendingNukedPosts || {})) {
            hrefs.push(...getStoredSpaceFeedRecordUrls(record, 'remainingUrls'))
        }
    }

    return getNormalizedProfileHrefList(hrefs).slice(0, 250)
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

    contentPageStateRefreshPromise = safeSendRuntimeMessageWithTimeout(request, null, 3000)
        .then(result => {
            if(!result || typeof result !== 'object') return false
            if(result.coordinatorQueue && typeof result.coordinatorQueue === 'object') {
                coordinatorQueue = normalizeCoordinatorQueue(result.coordinatorQueue)
                coordinatorQueueLoaded = true
            }
            if(result.profileNukeProgress && typeof result.profileNukeProgress === 'object') {
                profileNukeProgress = normalizeStoredProfileNukeProgress(result.profileNukeProgress)
            }
            contentPageStateRefreshAt = Date.now()
            if(page === 'space') {
                spaceFeedScopedStateSignature = getProfileHrefScopeSignature(profileHrefs)
            }
            return true
        })
        .catch(() => false)
        .finally(() => {
            contentPageStateRefreshPromise = null
        })

    return contentPageStateRefreshPromise
}

function onStorageChanged(changes, areaName) {
    if(areaName !== 'local') return

    for(const [key, change] of Object.entries(changes)) {
        if(Object.prototype.hasOwnProperty.call(defaults, key)) {
            settings[key] = change.newValue
        }
        else if(key === SPACE_REGISTRY_KEY) {
            spaceRegistry = change.newValue || {}
            if(getPageType() === 'space') {
                scheduleSpaceClassificationControls(0)
                scheduleSpaceAssetNukeControls(0)
            }
        }
        else if(key === SPACE_NUKED_POSTS_KEY) {
            spaceNukedPosts = change.newValue || {}
            if(getPageType() === 'space') {
                scheduleSpaceFeedProgressDrivenRefresh()
            }
        }
        else if(key === SPACE_PENDING_NUKED_POSTS_KEY) {
            spacePendingNukedPosts = change.newValue || {}
            if(getPageType() === 'space') {
                scheduleSpaceFeedProgressDrivenRefresh()
            }
        }
        else if(key === PROFILE_NUKE_PROGRESS_VIEW_KEY || key === COORDINATOR_QUEUE_VIEW_KEY) {
            scheduleContentPageStateProjectionRefresh()
        }
    }
}

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
    return browser?.storage?.local || globalThis.chrome?.storage?.local || null
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

async function safeSendRuntimeMessageWithTimeout(message, fallback = null, timeoutMs = 12000) {
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

async function safeStorageSet(value) {
    const storageArea = getStorageArea()
    if(!storageArea?.set) return

    try {
        await storageArea.set(value)
    }
    catch(error) {
        if(isExtensionContextInvalidatedError(error)) return
        throw error
    }
}

async function reconcileReloadCanceledNukes() {
    const result = await safeSendRuntimeMessage({action: 'cancel-queued-owner-nukes'}, {canceledUrls: []})
    const canceledUrls = getNormalizedProfileHrefList(result?.canceledUrls || [])
    if(!canceledUrls.length) return

    await removePendingSpaceFeedUrls(canceledUrls)
}

function isTransientProfileNukeStatus(status) {
    return TRANSIENT_PROFILE_NUKE_STATUSES.has(`${status || ''}`.trim())
}

function getPendingSpaceFeedRecord(postKey) {
    return postKey ? spacePendingNukedPosts?.[postKey] || null : null
}

function shouldReconcilePendingProfileRecord(record, pendingRecord) {
    if(!pendingRecord) return false
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

async function reconcileStaleSpaceFeedProgress(entries = null) {
    if(getPageType() !== 'space') return false

    updateOwnedNukeStatusCache(await getOwnedNukeStatus())
    const pendingProfileHrefs = getNormalizedProfileHrefList(
        Object.values(spacePendingNukedPosts || {})
            .flatMap(record => getStoredSpaceFeedRecordUrls(record, 'remainingUrls'))
    )
    if(pendingProfileHrefs.length) {
        const result = await safeSendRuntimeMessageWithTimeout({
            action: 'settle-terminal-coordinator-items',
            profileHrefs: pendingProfileHrefs
        }, null, 2500)
        if(result?.pendingPosts && typeof result.pendingPosts === 'object') {
            spacePendingNukedPosts = result.pendingPosts
        }
        if(result?.nukedPosts && typeof result.nukedPosts === 'object') {
            spaceNukedPosts = pruneRememberedSpaceNukes(result.nukedPosts)
        }
    }

    const updatesByHref = new Map()

    for(const [profileHref, record] of Object.entries(profileNukeProgress || {})) {
        if(!shouldReconcileStoredProfileRecord(record)) continue
        updatesByHref.set(profileHref, {
            profileHref,
            patch: getReconciledProfileRecordPatch(record)
        })
    }

    const pendingEntries = Object.entries(spacePendingNukedPosts || {})
    for(const [postKey, pendingRecord] of pendingEntries) {
        if(!postKey || !pendingRecord) continue

        for(const url of getStoredSpaceFeedRecordUrls(pendingRecord, 'remainingUrls')) {
            const normalizedUrl = normalizeQuoraProfileHref(url)
            if(!normalizedUrl) continue

            const record = getProfileNukeProgressRecord(normalizedUrl)
            if(!shouldReconcilePendingProfileRecord(record, pendingRecord)) continue

            if(record && isTransientProfileNukeStatus(record.status) && record.status !== 'interrupted') {
                updatesByHref.set(normalizedUrl, {
                    profileHref: normalizedUrl,
                    patch: getReconciledProfileRecordPatch(record)
                })
            }
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

function pruneRememberedSpaceNukes(records) {
    return getPrunedNukedPosts(records, {
        retentionDays: settings[NUKED_POST_RETENTION_DAYS_KEY],
        maxEntries: settings[MAX_REMEMBERED_NUKED_POSTS_KEY]
    })
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

    const nextRecord = normalizeProfileProgressPatch(normalizedHref, patch)
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

    return {
        ...nextRecord,
        runtimeRecorded: false,
        localOnly: true
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
        if(result.pendingPosts && typeof result.pendingPosts === 'object') {
            spacePendingNukedPosts = result.pendingPosts
        }
        if(result.nukedPosts && typeof result.nukedPosts === 'object') {
            spaceNukedPosts = pruneRememberedSpaceNukes(result.nukedPosts)
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
    if(getPageType() !== 'profile' || !isProfileBlocked()) return

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

async function getOwnedNukeStatus(options = {}) {
    const result = await safeSendRuntimeMessageWithTimeout({
        action: 'get-owned-nuke-status',
        runId: options.runId || ''
    }, null, 2500)
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

function updateOwnedNukeStatusCache(status = null) {
    ownedNukeStatusCache = normalizeOwnedNukeStatus(status)

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

function formatSpaceFeedGlobalWorkLabel() {
    return 'Nuking...'
}

function formatSpaceFeedPostWorkLabel() {
    return 'Nuking this'
}

function formatSpaceFeedNukingLabel(entries = []) {
    return formatSpaceFeedGlobalWorkLabel(getSpaceFeedQueuedWorkCount(entries))
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
        getStoredPendingSpaceFeedWorkCountForSpace() > 0 ||
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

async function waitForOwnedNukeTabsToDrain(button, timeoutMs = 180000, intervalMs = 1000, options = {}) {
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

function startObserver() {
    new MutationObserver(async mutations => {
        if(location.href !== currentUrl) {
            const previousProfileKey = getProfileKey(currentUrl)
            currentUrl = location.href
            resetQuestionPageBtn()
            resetSpacePostNukeBtn()
            resetProfileSearchControls()
            resetSpaceAssetNukeControls()
            resetSpaceFeedScanCache()

            const nextProfileKey = getProfileKey(currentUrl)
            if(previousProfileKey !== nextProfileKey) {
                clearProfileBlockHint()
            }
        }

        const page = getPageType()

        if(page === 'profile' && shouldRefreshProfileButtons(mutations)) {
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

        const activeModal = getProfilePeopleModal()
        const activeModalButtons = getModalProfileActionButtons(activeModal)
        const needsLateModalActions = activeModal &&
            getProfileModalItems(activeModal).length &&
            ((!activeModalButtons.open && getOpenableProfileModalItems(activeModal).length) ||
                (!activeModalButtons.nuke && getNukeableProfileModalItems(activeModal).length))
        if(needsLateModalActions) {
            injectModalOpenProfilesBtn()
        }

        let modal = document.querySelector('[role="dialog"][aria-modal="true"]:not([data-mb-checked])')
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

    const timestamp = element.matches?.('a.post_timestamp')
        ? element
        : element.querySelector?.('a.post_timestamp') || null
    if(timestamp) {
        return getSpaceFeedPostRoot(timestamp) || getSpaceFeedPreferredRoot(timestamp)
    }

    const markedRoot = element.closest?.('[data-mb-space-feed-post-key]')
    if(markedRoot) return markedRoot

    const likelyRoot = element.closest?.(SPACE_FEED_ROOT_SELECTOR)
    return likelyRoot?.querySelector?.('a.post_timestamp') ? likelyRoot : null
}

function invalidateSpaceFeedEntryCacheForMutations(mutations) {
    if(!spaceFeedEntryCache.size) return

    for(const mutation of mutations || []) {
        for(const node of [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]) {
            const postRoot = getSpaceFeedPostRootFromMutationNode(node)
            const timestamp = postRoot?.querySelector?.('a.post_timestamp')
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

    if(element.matches?.('a.post_timestamp, a[href*="/profile/"]')) return true
    return !!element.querySelector?.('a.post_timestamp, a[href*="/profile/"]')
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
    const hasActiveSpaceWork = getStoredPendingSpaceFeedWorkCountForSpace() > 0 ||
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

    return true
}

function shouldRefreshProfileButtons(mutations) {
    if(profileButtonsPending || profileActionInProgress) return false

    const target = getProfileButtonInsertionTarget()
    if(hasProfileButtons() && areProfileButtonsCorrectlyPlaced(target)) return false

    return mutations.some(mutation => {
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

        if(getPageType() === 'profile' && isProfileBlocked()) {
            const requestedProfileHref = normalizeQuoraProfileHref(request?.requestedProfileHref || '') || ''
            const resolvedProfileHref = getProfileKey(location.href) || ''
            if(!requestedProfileHref || !resolvedProfileHref || requestedProfileHref !== resolvedProfileHref) {
                return Promise.resolve({
                    willClose: false,
                    reason: 'profile-mismatch',
                    resolvedProfileHref,
                    lastUrl: location.href
                })
            }

            return Promise.resolve({willClose: true, resolvedProfileHref, lastUrl: location.href})
        }

        return Promise.resolve({willClose: false, armed: false})
    }

    if(request.action === 'claim-current-profile-tab-action') {
        return (async () => {
            if(!request.queuedAction) {
                await refreshCoordinatorQueueFromRuntime().catch(() => null)
            }
            const nextProfileAction = request.queuedAction && typeof request.queuedAction === 'object'
                ? request.queuedAction
                : undefined
            if(getPageType() !== 'profile' && !canResolveQueuedProfileFromCurrentPage(nextProfileAction || {})) {
                return {accepted: false, reason: 'not-profile'}
            }
            autoProfileAction = nextProfileAction
            autoProfileActionAttempts = 0
            void maybeRecordAlreadyBlockedCoordinatorProfile()
            void maybeRunAutoProfileAction()
            scheduleCurrentProfilePendingClaimRescue(500)
            return {accepted: true, reason: request.reason || ''}
        })()
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
        default:
            break
    }
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

function setNukeButtonIdle(button, label = `Nuke 'Em`) {
    if(!button) return
    if(button.dataset.mbNukeState === 'idle' && button.innerText === label &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--flash') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--pressed') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--working') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--done')) {
        return
    }
    button.dataset.mbNukeState = 'idle'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--pressed', 'mb-ext_nuke-profiles-btn--working', 'mb-ext_nuke-profiles-btn--done')
    button.innerText = label
}

function setNukeButtonWorking(button, label = 'Nuking...') {
    if(!button) return
    if(button.dataset.mbNukeState === 'working' && button.innerText === label &&
        button.classList.contains('mb-ext_nuke-profiles-btn--working') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--flash') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--done')) {
        return
    }
    button.dataset.mbNukeState = 'working'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--pressed', 'mb-ext_nuke-profiles-btn--done')
    button.classList.add('mb-ext_nuke-profiles-btn--working')
    button.innerText = label
}

function setNukeButtonDone(button, label = 'Nuked') {
    if(!button) return
    if(button.dataset.mbNukeState === 'done' && button.innerText === label &&
        button.classList.contains('mb-ext_nuke-profiles-btn--done') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--flash') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--pressed') &&
        !button.classList.contains('mb-ext_nuke-profiles-btn--working')) {
        return
    }
    button.dataset.mbNukeState = 'done'
    button.classList.remove('mb-ext_nuke-profiles-btn--flash', 'mb-ext_nuke-profiles-btn--pressed', 'mb-ext_nuke-profiles-btn--working')
    button.classList.add('mb-ext_nuke-profiles-btn--done')
    button.innerText = label
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

function setMuteBlockHelp(element, helpText) {
    if(!element) return

    const text = `Mute-Block Extension: ${helpText}`
    element.title = text
    element.setAttribute('aria-label', text)
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

            if(page === 'profile') {
                ensureProfileButtons()
                scheduleProfileButtonsFollowUps()
            }
            else if(page === 'space-post') {
                scheduleSpacePostNukeBtn()
                scheduleSpacePostFollowUps()
            }
            else if(page === 'space') {
                activateSpacePageControls(200)
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

function shouldRefreshSpaceClassificationControls() {
    const header = getSpaceHeaderContainer()
    const space = resolveCurrentSpaceDescriptor()
    if(!header || !space) return false

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
    const livePostButtonCount = document.querySelectorAll('.mb-ext_space-feed-post-nuke-host').length

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

function scheduleSpaceAssetNukeControls(delay = 180) {
    const adjustedDelay = getSpaceAssetNukeRefreshDelay(delay)
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
            if(getPageType() === 'space') {
                await refreshOwnedNukeStatusCache()
            }
            suppressSpaceAssetNukeRefreshUntil = Date.now() + 250
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
        'a.post_timestamp, .post_timestamp, ' +
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
    const patterns = [
        /\buser not found\b/,
        /\bprofile not found\b/,
        /\bpage not found\b/,
        // Quora can expose this phrase with dropped "s" glyphs in innerText.
        /\bthis? (?:profile|user|account) has? been (?:unavailable|disabled|deactivated|deleted|suspended|restricted)\b/,
        /\bthis (?:profile|user|account) (?:(?:is|has been) )?(?:unavailable|disabled|deactivated|deleted|suspended|restricted)\b/,
        /\b(?:profile|user|account) (?:(?:is|has been) )?(?:unavailable|disabled|deactivated|deleted|suspended|restricted)\b/,
        /\b(?:profile|user|account) (?:does not|doesn't) exist\b/,
        /\bno longer exists\b/
    ]

    if(patterns.some(pattern => pattern.test(title) || pattern.test(bodyText))) {
        return 'Profile unavailable'
    }

    return ''
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

function isProfileTargetPlacement(button, target) {
    if(!button || !target?.element) return false
    if(button.parentElement !== target.element.parentElement) return false
    if(!getProfileManagedButtonKind(button)) return false

    if(target.type === 'before-menu') {
        const sequence = getManagedButtonSequenceBeforeTarget(target)
        return sequence.join('|') === PROFILE_ACTION_BUTTON_ORDER.filter(kind => sequence.includes(kind)).join('|')
    }

    const sequence = getManagedButtonSequenceAfterTarget(target)
    return sequence.join('|') === PROFILE_ACTION_BUTTON_ORDER.filter(kind => sequence.includes(kind)).join('|')
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

    const managedButtons = Array.from(main.querySelectorAll(
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

function getProfileButtonInsertionTarget() {
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

function getManagedButtonSequenceBeforeTarget(target) {
    const sequence = []
    let node = target?.element?.previousElementSibling || null

    while(node && getProfileManagedButtonKind(node)) {
        sequence.unshift(getProfileManagedButtonKind(node))
        node = node.previousElementSibling
    }

    return sequence
}

function getManagedButtonSequenceAfterTarget(target) {
    const sequence = []
    let node = target?.element?.nextElementSibling || null

    while(node && getProfileManagedButtonKind(node)) {
        sequence.push(getProfileManagedButtonKind(node))
        node = node.nextElementSibling
    }

    return sequence
}

function normalizeProfileActionButtonOrder(target) {
    const parent = target?.element?.parentElement
    if(!parent) return

    const buttonsByKind = new Map(
        Array.from(parent.children)
            .map(button => [getProfileManagedButtonKind(button), button])
            .filter(([kind]) => !!kind)
    )

    if(target.type === 'before-menu') {
        for(const kind of PROFILE_ACTION_BUTTON_ORDER) {
            const button = buttonsByKind.get(kind)
            if(button) target.element.insertAdjacentElement('beforebegin', button)
        }

        return
    }

    let anchor = target.element
    for(const kind of PROFILE_ACTION_BUTTON_ORDER) {
        const button = buttonsByKind.get(kind)
        if(!button) continue
        anchor.insertAdjacentElement('afterend', button)
        anchor = button
    }
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

function getDialogAction(regex) {
    const dialogRoots = getDialogRoots()

    const match = findOverlayAction(regex, dialogRoots)
    if(match) return match

    if(dialogRoots.length) {
        const primary = getDialogPrimaryAction(dialogRoots, regex)
        if(primary) return primary
    }

    return getGlobalPrimaryAction(regex)
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

function getGlobalPrimaryAction(preferredRegex = null) {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(candidate => !shouldIgnoreActionCandidate(candidate) && isVisible(candidate))
        .map(button => ({button, score: scoreActionCandidate(button, preferredRegex)}))
        .filter(candidate => candidate.score > -600)

    candidates.sort((left, right) => right.score - left.score)
    return candidates[0]?.button || null
}

async function waitForAction(getAction, timeoutMs = 4000, intervalMs = 200) {
    const startedAt = Date.now()

    while(Date.now() - startedAt < timeoutMs) {
        const action = getAction()
        if(action) return action

        await sleep(intervalMs)
    }

    return null
}

async function waitForCondition(check, timeoutMs = 4000, intervalMs = 200) {
    const startedAt = Date.now()

    while(Date.now() - startedAt < timeoutMs) {
        if(check()) return true
        await sleep(intervalMs)
    }

    return false
}

function waitForConditionOrDomMutation(check, timeoutMs = 4000, intervalMs = 250) {
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

async function waitForMenuState(primaryRegex, inverseRegex, timeoutMs = 5000, intervalMs = 250) {
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
        timeoutMs = 5000,
        intervalMs = 250,
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

async function readProfileMenuState(primaryRegex, inverseRegex, timeoutMs = 2500, intervalMs = 200, silent = false, allowForegroundFallback = false) {
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

async function waitForProfileMenuState(expectedState, primaryRegex, inverseRegex, timeoutMs = 8000, intervalMs = 500, silent = false, allowForegroundFallback = false) {
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

async function waitForVerifiedProfileUnblocked(timeoutMs = 8000, intervalMs = 250, silent = false, allowForegroundFallback = false) {
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

    const lowerProfilePath = profilePath.toLowerCase()

    for(const script of Array.from(document.scripts || [])) {
        const text = script.textContent || ''
        const lowerText = text.toLowerCase()
        if(!text || !lowerText.includes(lowerProfilePath)) continue

        let searchFrom = 0
        let matchesScanned = 0

        while(matchesScanned < 10) {
            const index = lowerText.indexOf(lowerProfilePath, searchFrom)
            if(index < 0) break

            const contextStart = Math.max(0, index - 4000)
            const contextEnd = Math.min(text.length, index + profilePath.length + 4000)
            if(hasInlineBlockedStateMarker(text.slice(contextStart, contextEnd))) return true

            searchFrom = index + lowerProfilePath.length
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

async function waitForVerifiedProfileBlocked(timeoutMs = 8000, intervalMs = 250) {
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

async function waitForProfileActionReady(timeoutMs = 5000) {
    if(isProfileBlocked()) return true
    return waitForCondition(() => isProfileBlocked() || !!getProfileMenuButton(), timeoutMs, 100)
}

function shouldDeferBlockedCloseTab(target) {
    return isProfileBlocked() && target?.type !== 'before-menu'
}

function insertProfileActionButton(btn, target, kind) {
    btn.dataset.mbProfileBtnKind = kind

    if(target.type === 'before-menu') {
        target.element.insertAdjacentElement('beforebegin', btn)
        normalizeProfileActionButtonOrder(target)
        return
    }

    target.element.insertAdjacentElement('afterend', btn)
    normalizeProfileActionButtonOrder(target)
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
        btn.innerText = 'Unblock Unmute'
        btn.classList.add('mb-ext_unblock-unmute-btn')
        setMuteBlockHelp(btn, 'Unblock and unmute this profile')

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
                unblockBtn.innerText = originalUnblockText || 'Unblock Unmute'
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
    }
    catch(error) {
        const message = `${error?.message || error || 'Unblock Unmute failed'}`
        console.error(error)
        await recordCurrentProfileNukeProgress({
            status: 'error',
            finalError: message,
            event: `Unblock Unmute action failed: ${message}`
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
                unblockBtn.innerText = originalUnblockText || 'Unblock Unmute'
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
    const normalizedHref = normalizeQuoraProfileHref(href)
    if(!normalizedHref) return null

    try {
        const url = new URL(normalizedHref)
        const slug = url.pathname.replace(/^\/profile\//i, '')
        const decodedSlug = decodeURIComponent(slug)
        const normalizedSlug = decodedSlug.normalize('NFKC')
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

    return slugData.normalizedSlug.toLocaleLowerCase()
}

function getNormalizedProfileHrefList(urls) {
    const normalizedEntries = []
    const seen = new Set()

    for(const url of urls || []) {
        const normalized = normalizeQuoraProfileHref(url)
        const identityKey = getNormalizedProfileIdentityKey(normalized)
        if(!normalized || !identityKey || seen.has(identityKey)) continue

        seen.add(identityKey)
        normalizedEntries.push({
            href: normalized,
            identityKey
        })
    }

    return normalizedEntries
        .filter((entry, _, entries) => !isLikelyTruncatedProfileIdentityKey(entry.identityKey, entries))
        .map(entry => entry.href)
}

function isLikelyTruncatedProfileIdentityKey(identityKey, entries) {
    const value = `${identityKey || ''}`

    return entries.some(entry => {
        const other = `${entry?.identityKey || ''}`
        if(other === value || !other.startsWith(value) || other.length < value.length + 2) {
            return false
        }

        if(/^[a-z]{1,3}$/i.test(value) && other.length >= value.length + 3) {
            return true
        }

        const remainder = other.slice(value.length)
        if(/^-\d+(?:-|$)/i.test(remainder)) {
            return true
        }

        const tokens = value.split('-').filter(Boolean)
        const lastToken = `${tokens[tokens.length - 1] || ''}`
        if(lastToken.length >= 1 && lastToken.length <= 3 && /^[a-z0-9]+(?:-|$)/i.test(remainder)) {
            return true
        }

        return false
    })
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

function getTrailingTitleNameCandidate(text) {
    const normalized = `${text || ''}`.replace(/\s+/g, ' ').trim()
    if(!normalized) return ''

    const patterns = [
        /[:\-]\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})$/,
        /[.?!]\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})$/
    ]

    for(const pattern of patterns) {
        const match = normalized.match(pattern)
        if(match?.[1]) return match[1].trim()
    }

    return ''
}

function getProfileSlugText(href) {
    const slugData = getQuoraProfileSlugData(href)
    if(!slugData) return ''

    const cleanSlug = sanitizeProfileDisplaySlug(slugData.normalizedSlug)

    return cleanSlug.replace(/-/g, ' ').toLocaleLowerCase()
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

function sanitizeProfileDisplaySlug(slug) {
    return sanitizeProfileHrefSlug(
        `${slug || ''}`
            .replace(/(?:^|[-_\s])(?:ch|oid|share|srid|target_type)=.*$/i, '')
            .replace(/(?:[-_\s])(?:https?|amp|ch|oid|share|srid|target|target_type|type)(?:[-_\s].*)?$/i, '')
    )
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

function getNearbyProfileUrlsForName(postRoot, nameCandidate, excludedHref = '') {
    if(!postRoot || !nameCandidate) return []

    const candidate = nameCandidate.toLowerCase()
    const scopes = []

    for(const nextScope of [
        postRoot.parentElement,
        postRoot.closest('.dom_annotate_multifeed_bundle_TribeContentBundle'),
        postRoot.closest('.dom_annotate_multifeed_tribe_top_items'),
        getSpaceFeedContentRoot()
    ]) {
        if(nextScope && !scopes.includes(nextScope)) {
            scopes.push(nextScope)
        }
    }

    for(const scope of scopes) {
        const matches = []
        const seen = new Set()

        for(const link of getQuoraProfileLinks(scope)) {
            const href = normalizeQuoraProfileHref(link.href)
            if(!href || href === excludedHref || seen.has(href)) continue

            const linkText = getElementText(link).toLowerCase()
            const slugText = getProfileSlugText(href)
            if(!linkText.includes(candidate) && !slugText.includes(candidate)) continue

            seen.add(href)
            matches.push(href)
        }

        if(matches.length === 1) return matches
    }

    return []
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

function getOriginalPosterProfileHref() {
    const inlineProfileHref = getOriginalPosterProfileHrefFromInlineData()
    if(inlineProfileHref) return inlineProfileHref

    const main = document.querySelector('#mainContent, main, [role="main"]') || document.body
    if(!main) return null

    const profileLinks = getQuoraProfileLinks(main)
        .filter(isVisible)
        .map(link => ({link, score: scoreOriginalPosterLink(link)}))
        .filter(entry => entry.score > 0)

    profileLinks.sort((left, right) => right.score - left.score)
    return normalizeQuoraProfileHref(profileLinks[0]?.link.href) || null
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
                setNukeButtonDone(btn, 'Done')
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
                        setNukeButtonNotice(btn, 'Nothing queued')
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

function resolveCurrentSpaceDescriptor() {
    const header = getSpaceHeaderContainer()

    const url = normalizeSpaceUrl(getDocumentCanonicalUrl(document))
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
    const targetSlug = `${space.slug || extractSpaceSlug(targetUrl) || ''}`.trim().toLowerCase()

    for(const record of Object.values(spaceRegistry)) {
        if(!record || typeof record !== 'object') continue

        const recordUrl = normalizeSpaceUrl(record.url || '')
        if(targetUrl && recordUrl && recordUrl === targetUrl) {
            return record
        }

        const recordSlug = `${record.slug || extractSpaceSlug(recordUrl) || ''}`.trim().toLowerCase()
        if(targetSlug && recordSlug && recordSlug === targetSlug) {
            return record
        }
    }

    return null
}

function getStoredSpaceCategory(space) {
    return normalizeSpaceCategory(getStoredSpaceRecord(space)?.category)
}

function getSpaceCategoryForButtonState(category, activeCategory) {
    if(activeCategory) return category === activeCategory ? 'active' : 'inactive'
    return category === 'neutral' ? 'active' : 'inactive'
}

function getSpaceCategoryHelpText(category) {
    if(category === 'asset') return "Posts here may be scanned for Nuke 'Em candidates"
    if(category === 'neutral') return 'Treat this space as neutral'
    if(category === 'target') return 'Consider this space hostile'
    return 'Set Mute Block space classification'
}

function syncSpaceClassificationControls() {
    const header = getSpaceHeaderContainer()
    const space = resolveCurrentSpaceDescriptor()
    if(!header || !space) return false

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

async function setCurrentSpaceCategory(space, category) {
    const nextRecord = buildSpaceRecord(space, category, spaceRegistry?.[space.key] || null)
    if(!nextRecord) return

    spaceRegistry = {
        ...spaceRegistry,
        [space.key]: nextRecord
    }

    syncSpaceClassificationControls()
    scheduleSpaceAssetNukeControls(0)
    await safeStorageSet({[SPACE_REGISTRY_KEY]: spaceRegistry})
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

function getSpaceFeedContentRoot() {
    const candidates = Array.from(document.querySelectorAll('#mainContent, main, [role="main"]'))
        .filter(candidate => candidate instanceof Element)
    if(!candidates.length) return document.body

    return candidates
        .map((candidate, index) => ({
            candidate,
            index,
            timestampCount: candidate.querySelectorAll?.('a.post_timestamp').length || 0
        }))
        .sort((left, right) => right.timestampCount - left.timestampCount || left.index - right.index)[0]
        .candidate || document.body
}

function getSpaceFeedTimestampScanDistance(timestamp) {
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
    const rect = timestamp?.getBoundingClientRect?.() || null
    if(!rect) return Number.POSITIVE_INFINITY
    if(rect.bottom >= 0 && rect.top <= viewportHeight) return 0
    if(rect.top > viewportHeight) return rect.top - viewportHeight
    return Math.abs(rect.bottom)
}

function isSpaceFeedTimestampInScanWindow(timestamp) {
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0
    const rect = timestamp?.getBoundingClientRect?.() || null
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
    if(!candidate.matches('a.post_timestamp')) return false
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
        const timestamp = root.matches?.('a.post_timestamp')
            ? root
            : root.querySelector?.('a.post_timestamp')
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
    const nodes = Array.from(document.querySelectorAll('a.post_timestamp'))
    const timestamps = nodes
        .map((timestamp, index) => ({
            timestamp,
            index,
            distance: getSpaceFeedTimestampScanDistance(timestamp)
        }))
        .filter(entry => isSpaceFeedTimestampInScanWindow(entry.timestamp))

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
    const sampledTimestamps = getViewportSampledSpaceFeedTimestamps()
    const boundedTimestamps = getBoundedVisibleSpaceFeedTimestamps()
    const timestamps = mergeSpaceFeedTimestampScanResults(sampledTimestamps, boundedTimestamps)
    if(timestamps.length) return timestamps
    if(hasActivePendingSpaceFeedWork()) return boundedTimestamps

    return []
}

function isSpaceFeedRootCandidate(node, timestamp) {
    if(!node || node.nodeType !== Node.ELEMENT_NODE) return false

    const timestamps = Array.from(node.querySelectorAll('a.post_timestamp'))
    return timestamps.length === 1 && timestamps[0] === timestamp
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
        if(isSpaceFeedRootCandidate(node, timestamp)) {
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

    return `space-post-text:${snippet.toLowerCase()}`
}

function getSpaceFeedProfileLinkCardRoot(link) {
    if(!(link instanceof Element) || !isVisible(link)) return null

    const root = link.closest('a[href*="/profile/"]')
    if(!(root instanceof HTMLAnchorElement) || !isVisible(root)) return null
    if(isExtensionOwnedNode(root)) return null
    if(root.querySelector('a.post_timestamp, .post_timestamp')) return null
    if(root.closest('.mb-ext_space-feed-post-nuke-host')) return null
    if(!root.classList.contains('q-box') && !root.classList.contains('puppeteer_test_link')) return null

    const href = normalizeQuoraProfileHref(root.href)
    if(!href) return null

    const text = getElementText(root)
    if(!/\/profile\//i.test(text) && !text.includes(href.split('/').pop() || '')) return null

    return root
}

function getSpaceFeedProfileLinkCardEntries(activeKeys = new Set()) {
    if(!isAssetSpacePage()) return []

    const contentRoot = getSpaceFeedContentRoot()
    if(!contentRoot) return []

    const entries = []
    const seenRoots = new Set()
    const seenHrefs = new Set()

    for(const link of Array.from(contentRoot.querySelectorAll('a[href*="/profile/"]'))) {
        const root = getSpaceFeedProfileLinkCardRoot(link)
        if(!root || seenRoots.has(root)) continue

        const href = normalizeQuoraProfileHref(root.href)
        if(!href || seenHrefs.has(href)) continue

        const postKey = `space-profile-link:${href}`
        seenRoots.add(root)
        seenHrefs.add(href)
        activeKeys.add(postKey)
        entries.push({
            postKey,
            postRoot: root,
            postUrl: href,
            candidateUrls: [href]
        })
    }

    return entries
}

function getSpaceFeedPostHeaderProfileHref(postRoot, timestamp) {
    if(!postRoot) return null

    const timestampNode = timestamp || postRoot.querySelector('a.post_timestamp')
    const profileLinks = getQuoraProfileLinks(postRoot).filter(isVisible)

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
        '.standalone_featurable,' +
        '[data-is-quora-embed="true"],' +
        '[data-type="hyperlink_embed"],' +
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
        if(candidate instanceof Element && candidate.matches('a.post_timestamp') && !timestamps.includes(candidate)) {
            timestamps.push(candidate)
        }
    }

    addTimestamp(timestamp)

    for(const candidate of Array.from(postRoot.querySelectorAll('a.post_timestamp'))) {
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

function getSpaceFeedEmbeddedPosterProfileUrls(postRoot) {
    if(!postRoot) return []

    const urls = []
    const seen = new Set()
    const posterScopeSelector =
        '.standalone_featurable,' +
        '[data-is-quora-embed="true"],' +
        '[data-type="hyperlink_embed"],' +
        '.puppeteer_test_tribe_post_item_feed_story,' +
        '.dom_annotate_multifeed_bundle_TribeContentBundle,' +
        'article,' +
        '[role="article"],' +
        '.q-box'
    const embedRoots = []
    const addEmbedRoot = root => {
        if(!(root instanceof Element) || !postRoot.contains(root) || embedRoots.includes(root)) return
        embedRoots.push(root)
    }
    const addPosterHref = href => {
        const normalizedHref = normalizeQuoraProfileHref(href)
        if(!normalizedHref || seen.has(normalizedHref)) return

        seen.add(normalizedHref)
        urls.push(normalizedHref)
    }

    for(const embed of Array.from(postRoot.querySelectorAll(
        '.standalone_featurable[data-is-quora-embed="true"],' +
        '[data-type="hyperlink_embed"],' +
        'a[href^="https://qr.ae/"]'
    ))) {
        addEmbedRoot(embed.closest('.standalone_featurable, [data-is-quora-embed="true"], [data-type="hyperlink_embed"]') || embed)
    }

    for(const embedRoot of embedRoots) {
        if(hasVisibleFollowProxy(embedRoot)) {
            for(const link of getQuoraProfileLinks(embedRoot)) {
                addPosterHref(link.href)
            }
        }

        let scope = embedRoot.closest(posterScopeSelector) || embedRoot.parentElement
        const scopes = []

        while(scope && scope !== postRoot) {
            if(postRoot.contains(scope) && !scopes.includes(scope)) {
                scopes.push(scope)
            }
            scope = scope.parentElement
        }

        if(!scopes.includes(postRoot)) {
            scopes.push(postRoot)
        }

        for(const candidateScope of scopes) {
            if(!hasVisibleFollowProxy(candidateScope)) continue
            addPosterHref(getSpaceFeedPostHeaderProfileHref(candidateScope, embedRoot))
        }
    }

    return urls
}

function getSpaceFeedPostContentScopes(postRoot) {
    if(!postRoot) return []

    const scopes = []
    const addScope = scope => {
        if(scope && !scopes.includes(scope)) {
            scopes.push(scope)
        }
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

    const actionLabel = getPostActionLabel(link)
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
    const sharedPosterUrls = posterProfileUrls.filter(href => href !== headerProfileHref)
    if(isTargetSpacePage()) {
        return posterProfileUrls.length
            ? posterProfileUrls
            : getNormalizedProfileHrefList([headerProfileHref])
    }

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

    if(isAssetSpacePage()) {
        for(const href of [
            ...sharedPosterUrls,
            ...getSpaceFeedEmbeddedPosterProfileUrls(postRoot)
        ]) {
            addUrl(href, makeSpaceFeedCandidateEvidence('embedded-profile-link', SPACE_FEED_CANDIDATE_CONFIDENCE_HIGH))
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

    if(!urls.length) {
        const titleAnchor = postRoot.querySelector('.qu-fontWeight--bold a[href], a.post_timestamp')
        const titleNameCandidate = getTrailingTitleNameCandidate(getElementText(titleAnchor) || getElementText(postRoot))

        for(const href of getNearbyProfileUrlsForName(postRoot, titleNameCandidate, headerProfileHref)) {
            addUrl(href, makeSpaceFeedCandidateEvidence('nearby-profile-name', SPACE_FEED_CANDIDATE_CONFIDENCE_MEDIUM))
        }
    }

    return attachSpaceFeedCandidateMetadata(urls, candidateEvidenceByHref, needsSourceResolution)
}

function getRememberedSpaceFeedPostUrlSet(postKey) {
    const record = postKey ? spaceNukedPosts?.[postKey] : null
    return new Set(getStoredSpaceFeedRecordUrls(record, 'allUrls'))
}

function isSpaceFeedPostNuked(postKey, candidateUrls = null) {
    const rememberedUrls = getRememberedSpaceFeedPostUrlSet(postKey)
    if(!rememberedUrls.size) return false

    const urls = getNormalizedProfileHrefList(candidateUrls || [])
    if(!urls.length) return true

    return urls.every(url => rememberedUrls.has(url) || isProfileNukeSucceeded(url))
}

function isSpaceFeedEntryNuked(entry) {
    return isSpaceFeedPostNuked(entry?.postKey, entry?.candidateUrls || [])
}

function isRememberedSpaceFeedPostProfile(postKey, profileHref) {
    const href = normalizeQuoraProfileHref(profileHref)
    if(!href) return false

    return getRememberedSpaceFeedPostUrlSet(postKey).has(href)
}

function isSpaceFeedPostNuking(postKey) {
    return !!(postKey && spaceFeedNukingPostKeys.has(postKey))
}

function isSpaceFeedPostPending(postKey) {
    if(postKey && spacePendingNukedPosts?.[postKey]?.resolverPending) return true
    if(hasPendingCoordinatorSpaceFeedPost(postKey)) return true
    return getActivePendingSpaceFeedUrls(postKey).length > 0
}

function isSpaceFeedPostBusy(postKey) {
    return isSpaceFeedPostNuking(postKey) || isSpaceFeedPostPending(postKey)
}

function hasActivePendingSpaceFeedWork(entries = null) {
    const postKeys = Array.isArray(entries) ?
        entries.map(entry => entry?.postKey).filter(Boolean) :
        Object.keys(spacePendingNukedPosts || {})

    for(const postKey of postKeys) {
        if(getActivePendingSpaceFeedUrls(postKey).length) return true
    }

    return false
}

function clearStaleLocalSpaceFeedBusyState() {
    const queueingButtons = document.querySelectorAll('.mb-ext_space-feed-nuke-btn[data-mb-queueing="true"], .mb-ext_space-feed-post-queue-btn[data-mb-queueing="true"], .mb-ext_space-feed-post-nuke-btn[data-mb-queueing="true"]')

    if(!spaceFeedNukingPostKeys.size && !queueingButtons.length) return false
    if(hasActivePendingSpaceFeedWork(getLatestSpaceFeedEntries())) return false

    spaceFeedNukingPostKeys.clear()
    for(const button of Array.from(queueingButtons)) {
        delete button.dataset.mbQueueing
    }

    return true
}

function getStoredSpaceFeedRecordUrls(record, preferredKey = 'remainingUrls') {
    if(!record || typeof record !== 'object') return []

    const urls = preferredKey === 'allUrls'
        ? Array.isArray(record.allUrls)
            ? record.allUrls
            : Array.isArray(record.urls)
                ? record.urls
                : []
        : Array.isArray(record.remainingUrls)
            ? record.remainingUrls
            : Array.isArray(record.allUrls)
                ? record.allUrls
                : Array.isArray(record.urls)
                    ? record.urls
                    : []

    return getNormalizedProfileHrefList(urls)
}

function getPendingSpaceFeedJobKeyPatch(record = {}, remainingUrls = []) {
    const remaining = getNormalizedProfileHrefList(remainingUrls)
    const existingByHref = record?.jobKeysByProfileHref && typeof record.jobKeysByProfileHref === 'object'
        ? record.jobKeysByProfileHref
        : {}
    const jobKeysByProfileHref = {}

    for(const href of remaining) {
        jobKeysByProfileHref[href] = normalizeQuoraProfileHref(existingByHref[href] || href) || href
    }

    return {
        jobKeys: getNormalizedProfileHrefList(Object.values(jobKeysByProfileHref)),
        jobKeysByProfileHref
    }
}

function getPendingSpaceFeedUrlSet(postKey) {
    return new Set(getActivePendingSpaceFeedUrls(postKey))
}

function isPendingSpaceFeedRecordForSpace(record = null, space = null) {
    if(!record || !space?.key) return false

    return `${record.spaceKey || ''}` === `${space.key || ''}`
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

function isStaleCurrentProfileSearchCoordinatorItem(item = null) {
    return !!(
        item &&
        !isCurrentProfileSearchRuntimeCoordinatorItem(item) &&
        getCoordinatorItemSources(item).some(isCoordinatorSourceForCurrentProfileSearch)
    )
}

function isPendingCoordinatorProfileHref(profileHref = '', options = {}) {
    return getPendingCoordinatorProfileHrefEntries(profileHref).some(({item}) => {
        if(options.ignoreStaleCurrentProfileSearchPending === true &&
            isStaleCurrentProfileSearchCoordinatorItem(item)) {
            return false
        }

        return true
    })
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

function hasPendingCoordinatorSpaceFeedPost(postKey = '') {
    const key = `${postKey || ''}`.trim()
    if(!key) return false

    return Object.values(coordinatorQueue || {}).some(item => {
        if(!isPendingCoordinatorStatus(item?.status)) return false
        return Array.isArray(item?.evidence) && item.evidence.some(evidence => `${evidence?.postKey || ''}` === key)
    })
}

function getActivePendingSpaceFeedRecordWorkCount(postKey = '', record = null) {
    if(!record) return 0

    let count = getActivePendingSpaceFeedUrls(postKey || record.postKey || '').length
    if(record.resolverPending === true) count += 1
    return count
}

function getStoredPendingSpaceFeedRecordWorkCount(postKey = '', record = null) {
    if(!record) return 0

    const key = postKey || record.postKey || ''
    let count = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
        .filter(url => !isRememberedSpaceFeedPostProfile(key, url))
        .length
    if(record.resolverPending === true) count += 1
    return count
}

function getActivePendingSpaceFeedWorkCountForSpace(space = resolveCurrentSpaceDescriptor()) {
    if(!space?.key) return 0

    let count = 0
    for(const [postKey, record] of Object.entries(spacePendingNukedPosts || {})) {
        if(!isPendingSpaceFeedRecordForSpace(record, space)) continue
        count += getActivePendingSpaceFeedRecordWorkCount(postKey, record)
    }

    return count
}

function getStoredPendingSpaceFeedWorkCountForSpace(space = resolveCurrentSpaceDescriptor()) {
    if(!space?.key) return 0

    let count = 0
    for(const [postKey, record] of Object.entries(spacePendingNukedPosts || {})) {
        if(!isPendingSpaceFeedRecordForSpace(record, space)) continue
        count += getStoredPendingSpaceFeedRecordWorkCount(postKey, record)
    }

    return count
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

function isResolvableSpaceFeedEntry(entry) {
    return !!entry?.resolveProfileFromPage &&
        !!entry?.postKey &&
        !!normalizeQuoraPostHref(entry?.postUrl || '')
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

function getActivePendingSpaceFeedUrls(postKey) {
    const record = postKey ? spacePendingNukedPosts?.[postKey] : null
    return getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
        .filter(url => !isRememberedSpaceFeedPostProfile(postKey, url) && isActivePendingSpaceFeedProfileUrl(url))
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
            !isRememberedSpaceFeedPostProfile(entry.postKey, url))
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
    let count = 0

    for(const entry of Array.isArray(entries) ? entries : []) {
        count += getNormalizedProfileHrefList(entry?.candidateUrls || []).length
        if(isQueueableSpaceFeedResolverEntry(entry) || (isResolvableSpaceFeedEntry(entry) && spacePendingNukedPosts?.[entry.postKey]?.resolverPending)) {
            count += 1
        }
    }

    return count
}

function buildSpaceFeedRenderContext(space = resolveCurrentSpaceDescriptor()) {
    const pendingCoordinatorProfileHrefs = new Set()
    const pendingCoordinatorPostKeys = new Set()
    let coordinatorSpaceWorkCount = 0

    for(const [itemKey, item] of Object.entries(coordinatorQueue || {})) {
        if(!isPendingCoordinatorStatus(item?.status)) continue

        const profileHref = getCoordinatorItemProfileHref(itemKey, item)
        if(profileHref) pendingCoordinatorProfileHrefs.add(profileHref)

        if(Array.isArray(item?.evidence)) {
            for(const evidence of item.evidence) {
                const postKey = `${evidence?.postKey || ''}`.trim()
                if(postKey) pendingCoordinatorPostKeys.add(postKey)
            }
        }

        if(isPendingCoordinatorSpaceFeedItemForSpace(item, space)) {
            coordinatorSpaceWorkCount += 1
        }
    }

    return {
        space,
        pendingCoordinatorProfileHrefs,
        pendingCoordinatorPostKeys,
        coordinatorSpaceWorkCount,
        rememberedPostUrls: new Map(),
        activePendingUrls: new Map()
    }
}

function getRememberedSpaceFeedPostUrlSetForRender(postKey = '', context = null) {
    if(!context) return getRememberedSpaceFeedPostUrlSet(postKey)
    const key = `${postKey || ''}`.trim()
    if(!key) return new Set()
    if(!context.rememberedPostUrls.has(key)) {
        context.rememberedPostUrls.set(key, getRememberedSpaceFeedPostUrlSet(key))
    }

    return context.rememberedPostUrls.get(key)
}

function isRememberedSpaceFeedPostProfileForRender(postKey = '', profileHref = '', context = null) {
    const href = normalizeQuoraProfileHref(profileHref)
    if(!href) return false

    return getRememberedSpaceFeedPostUrlSetForRender(postKey, context).has(href)
}

function isSpaceFeedPostNukedForRender(postKey = '', candidateUrls = null, context = null) {
    const rememberedUrls = getRememberedSpaceFeedPostUrlSetForRender(postKey, context)
    if(!rememberedUrls.size) return false

    const urls = getNormalizedProfileHrefList(candidateUrls || [])
    if(!urls.length) return true

    return urls.every(url => rememberedUrls.has(url) || isProfileNukeSucceeded(url))
}

function getActivePendingSpaceFeedUrlsForRender(postKey = '', context = null) {
    const key = `${postKey || ''}`.trim()
    if(!key) return []
    if(context?.activePendingUrls?.has(key)) return context.activePendingUrls.get(key)

    const record = spacePendingNukedPosts?.[key] || null
    const urls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
        .filter(url => !isRememberedSpaceFeedPostProfileForRender(key, url, context) && isActivePendingSpaceFeedProfileUrl(url))

    if(context?.activePendingUrls) context.activePendingUrls.set(key, urls)
    return urls
}

function isSpaceFeedPostPendingForRender(postKey = '', context = null) {
    const key = `${postKey || ''}`.trim()
    if(!key) return false
    if(spacePendingNukedPosts?.[key]?.resolverPending) return true
    if(context?.pendingCoordinatorPostKeys?.has(key)) return true
    return getActivePendingSpaceFeedUrlsForRender(key, context).length > 0
}

function getQueueableSpaceFeedEntryUrlsForRender(entry = null, context = null) {
    if(!entry?.postKey) return []

    const pendingUrls = new Set(getActivePendingSpaceFeedUrlsForRender(entry.postKey, context))
    const pendingCoordinatorProfileHrefs = context?.pendingCoordinatorProfileHrefs || new Set()
    return getNormalizedProfileHrefList(entry.candidateUrls || [])
        .filter(url => !pendingUrls.has(url) &&
            !pendingCoordinatorProfileHrefs.has(url) &&
            !isProfileNukeRetryBlocked(url) &&
            !isRememberedSpaceFeedPostProfileForRender(entry.postKey, url, context))
}

function isSpaceFeedEntryNukedForRender(entry = null, context = null) {
    return isSpaceFeedPostNukedForRender(entry?.postKey || '', entry?.candidateUrls || [], context)
}

function isQueueableSpaceFeedResolverEntryForRender(entry = null, context = null) {
    if(!isResolvableSpaceFeedEntry(entry)) return false
    if(getQueueableSpaceFeedEntryUrlsForRender(entry, context).length >= SPACE_FEED_POST_NUKE_MIN_PROFILES) return false
    if(`${entry?.resolutionReason || ''}`.trim() === 'low-confidence-profile-artifact') return false
    if(getNormalizedProfileHrefList(entry?.candidateUrls || []).length) return false
    if(isSpaceFeedEntryNukedForRender(entry, context)) return false
    if(isSpaceFeedPostPendingForRender(entry.postKey, context)) return false

    return true
}

function buildSpaceFeedRenderEntry(entry = null, context = null) {
    const candidateUrls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
    const postNuked = isSpaceFeedEntryNukedForRender(entry, context)
    const activePendingUrls = postNuked ? [] : getActivePendingSpaceFeedUrlsForRender(entry?.postKey || '', context)
    const queueableUrls = postNuked ? [] : getQueueableSpaceFeedEntryUrlsForRender(entry, context)
    const hasResolver = !postNuked && isQueueableSpaceFeedResolverEntryForRender(entry, context)
    const liveUrls = postNuked ? [] : getNormalizedProfileHrefList([...activePendingUrls, ...queueableUrls])
    const resolverPending = isResolvableSpaceFeedEntry(entry) && spacePendingNukedPosts?.[entry?.postKey]?.resolverPending === true
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

function getSpaceFeedRenderEntriesWorkCount(entries = []) {
    return (Array.isArray(entries) ? entries : [])
        .reduce((total, entry) => total + (Number.parseInt(entry?.workCount, 10) || 0), 0)
}

function buildSpaceFeedRenderModel(scannedEntries = [], aggregateEntries = scannedEntries) {
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
    const queueableCount = getSpaceFeedRenderEntriesWorkCount(queueableEntries)
    const busyEntries = actionableEntries.filter(entry => entry.postBusy)
    const hasNukedEntries = totalEntries.some(entry => entry.postNuked)
    const allActionableEntriesSettled = actionableEntries.length > 0 &&
        actionableEntries.every(entry => isSpaceFeedPostSettled(entry) || entry.postNuked)
    const allActionableEntriesNuked = actionableEntries.length > 0 &&
        actionableEntries.every(entry => entry.postNuked)
    const storedSpaceWorkCount = getStoredPendingSpaceFeedWorkCountForSpace(context.space)
    const activeSpaceWorkCount = getActivePendingSpaceFeedWorkCountForSpace(context.space)
    const displaySpaceWorkCount = Math.max(activeSpaceWorkCount, context.coordinatorSpaceWorkCount)
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
        storedSpaceWorkCount,
        activeSpaceWorkCount,
        coordinatorSpaceWorkCount: context.coordinatorSpaceWorkCount,
        displaySpaceWorkCount,
        hasActiveSpaceWork,
        localBusy,
        batchNukeActive: isActiveSpaceFeedNukeMode('batch', localBusy, context.space),
        singleNukeActive: isActiveSpaceFeedNukeMode('single', localBusy, context.space),
        unknownNukeActive: isUnknownSpaceFeedNukeActive(localBusy)
    }
}

function getSpaceFeedActionElements(postRoot) {
    const actions = Array.from(postRoot.querySelectorAll('button, a, [role="button"]'))
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

    const timestamp = postRoot.querySelector('a.post_timestamp')
    const headerContainer = timestamp?.closest('.q-flex.qu-alignItems--flex-start, .q-flex') || null
    const parent = getSpaceFeedPostAnchorContainer(postRoot) || postRoot
    if(isSpaceFeedDocumentLevelElement(parent)) return null

    let host = Array.from(parent.querySelectorAll(':scope > .mb-ext_space-feed-post-nuke-host'))
        .find(candidate => (candidate.dataset.mbPostHostKey || '') === postKey)
    if(host) return host

    for(const strayHost of Array.from(postRoot.querySelectorAll('.mb-ext_space-feed-post-nuke-host'))) {
        if(strayHost.parentElement !== parent && (!postKey || strayHost.dataset.mbPostHostKey === postKey)) {
            strayHost.remove()
        }
    }

    host = document.createElement('div')
    host.className = 'mb-ext_space-feed-post-nuke-host mb-ext_post-nuke-slot'
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
            resolutionReason: `${entry?.resolutionReason || ''}`.trim()
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

function ensureCurrentInstanceClickHandler(button, handlerKey, handler) {
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
    activeButton.addEventListener('click', handler)
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

function getSpaceFeedPostEntries() {
    const entries = []
    const roots = getSpaceFeedCardRoots()
    const contentRoot = getSpaceFeedContentRoot()
    const activeKeys = new Set()

    for(const postRoot of roots) {
        const timestamp = postRoot.querySelector('a.post_timestamp')
        if(!timestamp) continue

        const postKey = getSpaceFeedPostKey(postRoot, timestamp)
        if(!postKey) continue
        activeKeys.add(postKey)

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
                if(isSpaceFeedRootCandidate(node, timestamp)) {
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

        entries.push({
            postKey,
            postRoot,
            postUrl,
            candidateUrls,
            candidateEvidenceByHref,
            resolveProfileFromPage: isAssetSpacePage() && !!postUrl && needsSourceResolution,
            resolutionReason: needsSourceResolution ? 'low-confidence-profile-artifact' : ''
        })
    }

    entries.push(...getSpaceFeedProfileLinkCardEntries(activeKeys))

    for(const [postKey, cached] of spaceFeedEntryCache) {
        if(!activeKeys.has(postKey) || !cached?.postRoot?.isConnected) {
            spaceFeedEntryCache.delete(postKey)
        }
    }

    return entries
}

function buildSpaceFeedEntrySnapshot(entry, previous = null) {
    const previousUrls = getNormalizedProfileHrefList(previous?.candidateUrls || [])
    const currentUrls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
    const rect = entry?.postRoot?.isConnected ? entry.postRoot.getBoundingClientRect() : null
    const previousViewport = previous ? getUpdatedSpaceFeedEntryViewport(previous) : {}

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
        postRoot: entry?.postRoot?.isConnected
            ? entry.postRoot
            : previous?.postRoot?.isConnected
                ? previous.postRoot
                : null,
        viewportTop: rect?.top ?? previousViewport.viewportTop ?? null,
        viewportBottom: rect?.bottom ?? previousViewport.viewportBottom ?? null
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
        postRoot: entry.postRoot || null
    }))
}

function setLatestSpaceFeedEntries(entries) {
    rememberDiscoveredSpaceFeedEntries(entries)
    latestSpaceFeedEntries = getDiscoveredSpaceFeedEntries().map(entry => {
        const rect = entry?.postRoot?.getBoundingClientRect?.() || null

        return {
            postKey: entry?.postKey || '',
            postUrl: entry?.postUrl || '',
            candidateUrls: getNormalizedProfileHrefList(entry?.candidateUrls || []),
            resolveProfileFromPage: !!entry?.resolveProfileFromPage,
            resolutionReason: entry?.resolutionReason || '',
            postRoot: entry?.postRoot || null,
            viewportTop: rect?.top ?? null,
            viewportBottom: rect?.bottom ?? null
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
        resolutionReason: entry.resolutionReason || ''
    }))
}

function getUpdatedSpaceFeedEntryViewport(entry) {
    const rect = entry?.postRoot?.isConnected ? entry.postRoot.getBoundingClientRect() : null

    return {
        viewportTop: rect?.top ?? entry?.viewportTop ?? null,
        viewportBottom: rect?.bottom ?? entry?.viewportBottom ?? null
    }
}

function getSpaceFeedDetectionSnapshot(entries = null) {
    const space = resolveCurrentSpaceDescriptor()
    const category = getStoredSpaceCategory(space) || 'unset'
    const timestamps = getVisibleSpaceFeedTimestamps()
    const documentTimestamps = document.querySelectorAll('a.post_timestamp').length
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
        postButtons: document.querySelectorAll('.mb-ext_space-feed-post-nuke-btn').length
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

function formatSpaceFeedStatusDetails(snapshot) {
    const lines = [
        'report_format: detailed-v2',
        `report_generated_at: ${new Date().toISOString()}`,
        '',
        formatSpaceFeedStatusSummary(snapshot),
        '',
        formatSpaceFeedTimingSummary(snapshot)
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

    let button = host.querySelector('.mb-ext_space-feed-status-btn')

    if(!button) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'mb-ext_space-feed-status-btn'
        button.addEventListener('click', () => {
            scheduleSpaceAssetNukeControls(0)
            void showCopyableText('Mute-Block Extension Info:', formatSpaceFeedStatusDetails(getSpaceFeedDetectionSnapshot()))
        })
        host.appendChild(button)
    }

    button.textContent = formatSpaceFeedStatusLabel(entries)
    setMuteBlockHelp(button, `Mute-Block ${getExtensionVersion()}, click for more`)
    return true
}

async function registerPendingSpaceFeedEntries(space, entries) {
    if(!space?.key || !Array.isArray(entries) || !entries.length) return

    let changed = false
    const nextRecords = {
        ...spacePendingNukedPosts
    }

    for(const entry of entries) {
        if(!entry?.postKey) continue
        if(isSpaceFeedEntryNuked(entry)) continue

        const entryUrls = getNormalizedProfileHrefList(entry.candidateUrls || [])
            .filter(url => !isRememberedSpaceFeedPostProfile(entry.postKey, url) && !isProfileNukeSucceeded(url))
        const resolverPending = isResolvableSpaceFeedEntry(entry) && !entryUrls.length
        if(!entryUrls.length && !resolverPending) continue

        const existing = nextRecords[entry.postKey] || {}
        const existingAllUrls = getStoredSpaceFeedRecordUrls(existing, 'allUrls')
        const existingRemainingUrls = getStoredSpaceFeedRecordUrls(existing, 'remainingUrls')
        const allUrls = getNormalizedProfileHrefList([...existingAllUrls, ...entryUrls])
        const remainingUrls = getNormalizedProfileHrefList([...existingRemainingUrls, ...entryUrls])
        const existingJobKeysByProfileHref = existing.jobKeysByProfileHref && typeof existing.jobKeysByProfileHref === 'object'
            ? existing.jobKeysByProfileHref
            : {}
        const jobKeysByProfileHref = {
            ...existingJobKeysByProfileHref
        }
        for(const href of entryUrls) {
            jobKeysByProfileHref[href] = href
        }

        nextRecords[entry.postKey] = {
            ...existing,
            postKey: entry.postKey,
            postUrl: entry.postUrl || existing.postUrl || '',
            spaceKey: space.key,
            spaceUrl: space.url,
            allUrls,
            remainingUrls,
            resolverPending: resolverPending || existing.resolverPending === true,
            resolverUrl: resolverPending ? entry.postUrl || existing.resolverUrl || '' : existing.resolverUrl || '',
            jobKeys: getNormalizedProfileHrefList([
                ...(Array.isArray(existing.jobKeys) ? existing.jobKeys : []),
                ...entryUrls
            ]),
            jobKeysByProfileHref,
            updatedAt: Date.now()
        }
        changed = true
    }

    if(!changed) return

    spacePendingNukedPosts = nextRecords
    await safeStorageSet({[SPACE_PENDING_NUKED_POSTS_KEY]: nextRecords})
}

async function removePendingSpaceFeedUrls(urls) {
    const normalizedUrls = new Set(getNormalizedProfileHrefList(urls))
    if(!normalizedUrls.size) return

    const serviceResult = await safeSendRuntimeMessage({
        action: 'remove-pending-space-feed-urls',
        urls: Array.from(normalizedUrls)
    }, null)
    if(serviceResult) {
        if(serviceResult.pendingPosts && typeof serviceResult.pendingPosts === 'object') {
            spacePendingNukedPosts = serviceResult.pendingPosts
        }
        return
    }
}

async function removePendingSpaceFeedEntries(entries = []) {
    const entryList = Array.isArray(entries) ? entries : []
    const urls = getDedupedSpaceFeedUrls(entryList)
    if(urls.length) {
        await removePendingSpaceFeedUrls(urls)
    }

    const resolverPostKeys = Array.from(new Set(entryList
        .filter(entry => isResolvableSpaceFeedEntry(entry) && !getNormalizedProfileHrefList(entry?.candidateUrls || []).length)
        .map(entry => `${entry?.postKey || ''}`.trim())
        .filter(Boolean)))
    if(!resolverPostKeys.length) return

    const serviceResult = await safeSendRuntimeMessage({
        action: 'remove-pending-space-feed-entries',
        postKeys: resolverPostKeys
    }, null)
    if(serviceResult) {
        if(serviceResult.pendingPosts && typeof serviceResult.pendingPosts === 'object') {
            spacePendingNukedPosts = serviceResult.pendingPosts
        }
        return
    }
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

function getQueuedPageResolvedProfileHref(claimedAction = {}) {
    const pageType = getPageType()
    if(pageType === 'profile') return normalizeQuoraProfileHref(location.href)
    if(pageType === 'space-post') {
        const resolutionReason = `${claimedAction?.resolutionReason || ''}`.trim()
        const explicitProfileHref = getSingleSpacePostResolutionProfileHref({explicitOnly: true})
        const isQueuedResolution = claimedAction?.resolveProfileFromPage === true ||
            `${claimedAction?.resolutionMode || ''}`.trim() === QUEUED_PROFILE_RESOLUTION_MODE ||
            isSourcePostResolutionReason(resolutionReason)
        if(resolutionReason === 'low-confidence-profile-artifact') {
            return explicitProfileHref
        }
        if(isQueuedResolution) {
            if(isAssetSpacePage()) return explicitProfileHref

            return getSpacePostHeaderProfileHref() ||
                getOriginalPosterProfileHref() ||
                explicitProfileHref
        }
        const listedProfileLinks = getSpacePostListedProfileLinks()
        if(listedProfileLinks.length === 1) return listedProfileLinks[0]

        return getSpacePostHeaderProfileHref() ||
            getOriginalPosterProfileHref() ||
            null
    }
    if(pageType === 'question' || pageType === 'question-log') {
        return getOriginalPosterProfileHref()
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

    for(const root of Array.from(document.querySelectorAll('[data-mb-space-feed-post-key]'))) {
        delete root.dataset.mbSpaceFeedPostKey
    }
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
                    const result = await safeSendRuntimeMessageWithTimeout({
                        action: 'settle-terminal-coordinator-items',
                        profileHrefs: succeededUrls
                    }, null, 2500)
                    if(result?.pendingPosts && typeof result.pendingPosts === 'object') {
                        spacePendingNukedPosts = result.pendingPosts
                    }
                    if(result?.nukedPosts && typeof result.nukedPosts === 'object') {
                        spaceNukedPosts = pruneRememberedSpaceNukes(result.nukedPosts)
                    }
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
        const postUrl = normalizeQuoraPostHref(entry.postUrl || '')
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
                    sourcePageUrl: location.href
                })
            }
        }
    }

    return Array.from(associations.values())
}

async function enqueueCoordinatorSpaceFeedItems(space, runId, profileAssociations) {
    if(!space || !runId || !Array.isArray(profileAssociations) || !profileAssociations.length) {
        return null
    }

    const source = {
        type: 'space-feed',
        pageUrl: location.href,
        spaceKey: space.key || '',
        spaceCategory: getStoredSpaceCategory(space)
    }

    return safeSendRuntimeMessage({
        action: 'enqueue-coordinator-items',
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
    }, null)
}

async function enqueueCoordinatorProfileUrls(options = {}) {
    const {
        urls = [],
        sourceType = 'profile-list',
        event = 'Queued profile action',
        maxConcurrent = getProfilesPerBatch(),
        noForegroundFallback = false,
        maxRetries = null,
        sourceExtra = {}
    } = options
    const profileHrefs = getNormalizedProfileHrefList(urls)
    if(!profileHrefs.length) return {queued: 0, merged: 0, executionQueued: 0}

    const runId = `${sourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const source = {
        type: sourceType,
        pageUrl: location.href,
        ...sourceExtra
    }

    return safeSendRuntimeMessageWithTimeout({
        action: 'enqueue-coordinator-items',
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
    }, {queued: 0, merged: 0, executionQueued: 0, timedOut: true}, 10000)
}

async function nukeSpaceFeedEntries(button, entries) {
    if(!button || !entries.length) return false

    const space = resolveCurrentSpaceDescriptor()
    if(!space) return false

    const unfinishedEntries = entries.flatMap(entry => {
        if(isSpaceFeedEntryNuked(entry)) return []

        const candidateUrls = getQueueableSpaceFeedEntryUrls(entry)
        const resolveProfileFromPage = !candidateUrls.length && isQueueableSpaceFeedResolverEntry(entry)
        if(!candidateUrls.length && !resolveProfileFromPage) return []

        return [{
            ...entry,
            candidateUrls,
            resolveProfileFromPage
        }]
    })
    const profileAssociations = getSpaceFeedProfilePostAssociations(unfinishedEntries)
    const resolverAssociations = getResolvableSpaceFeedPostAssociations(unfinishedEntries)
    const workAssociations = profileAssociations.concat(resolverAssociations)
    const urls = profileAssociations.map(association => association.profileHref)
    const runId = `space-feed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if(!workAssociations.length) {
        syncSpaceFeedNukeControls()
        setNukeButtonDone(button, 'Done')
        return true
    }

    rememberActiveSpaceFeedNukeMode(button, runId)

    updateOwnedNukeStatusCache({
        ...ownedNukeStatusCache,
        queued: (Number.parseInt(ownedNukeStatusCache?.queued, 10) || 0) + workAssociations.length,
        paused: false
    })
    button.dataset.mbQueueing = 'true'
    for(const entry of unfinishedEntries) {
        if(entry?.postKey) {
            spaceFeedNukingPostKeys.add(entry.postKey)
        }
    }
    await animateNukeButtonPress(button)
    setNukeButtonWorking(button, 'Queueing...')

    try {
        await registerPendingSpaceFeedEntries(space, unfinishedEntries)
        syncSpaceFeedNukeControls()
        setNukeButtonWorking(button, formatSpaceFeedNukingLabel(unfinishedEntries))

        const result = await enqueueCoordinatorSpaceFeedItems(space, runId, workAssociations)

        if((result?.executionQueued || result?.queued || result?.merged || 0) > 0) {
            syncSpaceFeedNukeControls()
            setNukeButtonWorking(button, formatSpaceFeedNukingLabel(getLiveSpaceFeedEntries(getLatestSpaceFeedEntries())))
            return true
        }

        const sweep = await sweepBlockedProfileTabs()
        if(sweep.owned > 0) {
            syncSpaceFeedNukeControls()
            setNukeButtonWorking(button, formatSpaceFeedNukingLabel(getLiveSpaceFeedEntries(getLatestSpaceFeedEntries())))
            return true
        }

        await removePendingSpaceFeedEntries(unfinishedEntries)
        setNukeButtonNotice(button, 'Nothing queued')
        return false
    }
    finally {
        delete button.dataset.mbQueueing
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
}

async function pauseSpaceFeedQueue(button) {
    if(!button) return false

    const result = await safeSendRuntimeMessage({action: 'pause-coordinator-nukes'}, null) ||
        await safeSendRuntimeMessage({action: 'pause-owner-nukes'}, {canceledUrls: []})
    const canceledUrls = getNormalizedProfileHrefList(result?.canceledUrls || [])
    const pausedUrls = getNormalizedProfileHrefList(result?.pausedUrls || [])
    updateOwnedNukeStatusCache({
        ...ownedNukeStatusCache,
        queued: 0,
        paused: true
    })
    if(canceledUrls.length && !result?.paused) {
        await removePendingSpaceFeedUrls(canceledUrls)
    }

    setNukeButtonIdle(button)
    scheduleSpaceAssetNukeControls(0)
    return pausedUrls.length > 0 || canceledUrls.length > 0 || result?.paused === true
}

function syncSpaceFeedTopPauseButton(host, workingButton, model = {}, activeWork = false) {
    let pauseButton = host.querySelector('.mb-ext_space-feed-pause-btn')
    if(!activeWork && !model?.ownerPaused) {
        pauseButton?.remove()
        return
    }

    if(!pauseButton) {
        pauseButton = document.createElement('button')
        pauseButton.type = 'button'
        pauseButton.className = 'mb-ext_nuke-profiles-btn mb-ext_space-feed-pause-btn'
        pauseButton.textContent = 'Pause'
        setMuteBlockHelp(pauseButton, 'Pause Current Work without canceling jobs')
        host.appendChild(pauseButton)
    }

    pauseButton = ensureCurrentInstanceClickHandler(pauseButton, 'space-feed-pause', event => {
        event.preventDefault()
        const activeButton = event.currentTarget
        activeButton.disabled = true
        void pauseSpaceFeedQueue(workingButton || activeButton)
    })
    pauseButton.disabled = false
    pauseButton.textContent = 'Pause'
    setMuteBlockHelp(pauseButton, 'Pause Current Work without canceling jobs')
}

function syncSpaceFeedTopNukeButton(renderModel) {
    const host = getSpaceFeedTopButtonHost()
    if(!host) return false

    const model = Array.isArray(renderModel) ? buildSpaceFeedRenderModel(renderModel) : renderModel
    const totalEntries = model?.totalEntries || []
    const liveEntries = model?.liveEntries || []
    const queueableEntries = model?.queueableEntries || []
    const queueableCount = Number.parseInt(model?.queueableCount, 10) || 0
    let button = host.querySelector('.mb-ext_space-feed-nuke-btn')
    const busyEntries = model?.busyEntries || []
    const ownerRunningForThisSpace = model?.ownerRunning && (model.localBusy || button?.dataset?.mbQueueing === 'true')
    const displayEntries = model?.singleNukeActive ? queueableEntries : liveEntries
    const displayEntryWorkCount = getSpaceFeedRenderEntriesWorkCount(displayEntries)
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
    button = ensureCurrentInstanceClickHandler(button, 'space-feed-top', event => {
        const activeButton = event.currentTarget
        if(activeButton.dataset.mbNukeState === 'working') {
            return
        }

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
        syncSpaceFeedTopPauseButton(host, button, model, false)
        return true
    }

    setSpaceFeedButtonSelection(button, displayEntries)
    setMuteBlockHelp(button, shouldPromptScroll ? 'No visible targets. Scroll for more posts to scan.' : buildNukeTargetsHelpText('Queue detected profiles from visible posts in this space for mute and block', getSpaceFeedButtonUrls(button)))

    if(activeSpaceWork) {
        setSpaceFeedButtonSelection(button, [])
        setMuteBlockHelp(button, queueableEntries.length
            ? 'This space has active queued work. Use the black post buttons to add newly visible candidates.'
            : 'This space has active queued work.')
        setNukeButtonWorking(button, model.displaySpaceWorkCount > 0
            ? formatSpaceFeedGlobalWorkLabel(model.displaySpaceWorkCount)
            : formatSpaceFeedGlobalWorkLabel(displayEntryWorkCount))
        button.disabled = true
    }
    else if(model?.ownerPaused && ownerRunningForThisSpace && busyEntries.length) {
        setNukeButtonIdle(button, formatNukeProgressLabel('Paused', ownedNukeStatusCache))
        button.disabled = false
    }
    else if(model?.singleNukeActive && queueableEntries.length) {
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
    else if(model?.allActionableEntriesNuked) {
        setNukeButtonDone(button)
        button.disabled = true
    }
    else if(model?.allActionableEntriesSettled) {
        setNukeButtonDone(button, 'Done')
        button.disabled = true
    }
    else {
        setNukeButtonDone(button, 'Done')
        button.disabled = true
    }

    syncSpaceFeedTopPauseButton(host, button, model, activeSpaceWork)
    return true
}

function syncSpaceFeedPostButtons(renderModel) {
    const model = Array.isArray(renderModel) ? buildSpaceFeedRenderModel(renderModel) : renderModel
    const activeKeys = new Set()
    const entries = model?.visibleEntries || []
    const aggregateUrls = model?.queueableUrls || []
    const aggregateCount = Number.parseInt(model?.queueableCount, 10) || 0

    for(const entry of entries) {
        const liveUrls = entry.liveUrls || []
        const hasResolver = entry.hasResolver === true
        const hasCandidates = entry.hasCandidates === true
        const postBusy = entry.postBusy === true
        const postNuked = entry.postNuked === true
        const shouldShowControls = postNuked || aggregateCount > 0 || hasCandidates || postBusy
        if(!shouldShowControls) {
            delete entry.postRoot.dataset.mbSpaceFeedPostKey
            continue
        }

        const host = getSpaceFeedPostButtonHost(entry.postRoot, entry.postKey)
        if(!host) continue

        entry.postRoot.dataset.mbSpaceFeedPostKey = entry.postKey
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
            setMuteBlockHelp(doneButton, 'This post has already been nuked')
            setNukeButtonDone(doneButton)
            doneButton.disabled = true
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
            if(activeButton.dataset.mbNukeState === 'working') {
                return
            }

            const postKey = activeButton.dataset.mbPostKey || ''
            if(!postKey || isSpaceFeedPostNuked(postKey, getSpaceFeedButtonUrls(activeButton))) {
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
                resolveProfileFromPage
            }])
        })

        queueButton.dataset.mbPostKey = entry.postKey
        setSpaceFeedButtonSelection(queueButton, model?.queueableEntries || [])
        setMuteBlockHelp(queueButton, aggregateCount > 0
            ? buildNukeTargetsHelpText(`Queue ${aggregateCount} current target${aggregateCount === 1 ? '' : 's'} from visible posts in this space`, aggregateUrls)
            : 'No currently detected targets are queueable from visible posts in this space')

        if(queueButton.dataset.mbQueueing === 'true') {
            setNukeButtonWorking(queueButton, `Nuking ${aggregateCount}`)
            queueButton.disabled = true
        }
        else {
            setNukeButtonIdle(queueButton, `Nuke 'Em ${aggregateCount}`)
            queueButton.disabled = aggregateCount < 1
        }

        singleButton.dataset.mbPostKey = entry.postKey
        singleButton.dataset.mbPostUrl = entry.postUrl || ''
        setSpaceFeedButtonUrls(singleButton, liveUrls)
        setMuteBlockHelp(singleButton, hasResolver
            ? 'Queue this post for author profile resolution and mute-block'
            : buildNukeTargetsHelpText('Queue only this post profile for mute and block', getSpaceFeedButtonUrls(singleButton)))
        singleButton.classList.remove('mb-ext_space-feed-post-single-nuke-btn--neutral')

        if(postNuked) {
            setNukeButtonDone(singleButton)
            singleButton.disabled = true
        }
        else if(postBusy) {
            setNukeButtonWorking(singleButton, formatSpaceFeedPostWorkLabel(entry.liveWorkCount || entry.queueableWorkCount || 0))
            singleButton.disabled = true
        }
        else if(hasCandidates) {
            setNukeButtonIdle(singleButton, 'Mute-Block')
            singleButton.disabled = false
        }
        else {
            setNukeButtonIdle(singleButton, 'Mute-Block')
            singleButton.disabled = true
        }
    }

    for(const host of Array.from(document.querySelectorAll('.mb-ext_space-feed-post-nuke-host'))) {
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
    for(const host of Array.from(document.querySelectorAll('.mb-ext_space-feed-post-nuke-host'))) {
        const hostKey = host.dataset.mbPostHostKey || host.querySelector('.mb-ext_space-feed-post-nuke-btn')?.dataset.mbPostKey || ''
        if(!hostKey) continue
        if(seenHostKeys.has(hostKey)) {
            host.remove()
            continue
        }
        seenHostKeys.add(hostKey)
    }

    for(const root of Array.from(document.querySelectorAll('[data-mb-space-feed-post-key]'))) {
        if(isSpaceFeedDocumentLevelElement(root) || !activeKeys.has(root.dataset.mbSpaceFeedPostKey || '')) {
            delete root.dataset.mbSpaceFeedPostKey
        }
    }
}

function syncSpaceFeedNukeControls() {
    if(getPageType() !== 'space') {
        removeSpaceFeedNukeControls()
        return false
    }

    const scannedEntries = getSpaceFeedPostEntries()
    setLatestSpaceFeedEntries(scannedEntries)
    const entries = getLatestSpaceFeedEntries()
    scheduleSpaceFeedScopedStateRefresh(entries)
    const renderModel = buildSpaceFeedRenderModel(scannedEntries, entries)
    scheduleSpaceFeedProgressReconciliation(entries)
    clearStaleLocalSpaceFeedBusyState()
    clearInactiveSpaceFeedNukeMode()
    const main = getSpaceFeedContentRoot()
    if(main) {
        main.dataset.mbSpaceFeedTimestampCount = `${entries.length}`
        main.dataset.mbSpaceFeedCardCount = `${entries.length}`
        main.dataset.mbSpaceFeedEntryCount = `${entries.length}`
        main.dataset.mbSpaceFeedVisibleEntryCount = `${scannedEntries.length}`
        main.dataset.mbSpaceFeedPostButtonCount = `${getExpectedSpaceFeedPostButtonCount(scannedEntries)}`
    }

    syncSpaceFeedStatusButton(entries)

    if(!isNukableSpacePage()) {
        removeSpaceFeedNukeButtons()
        return true
    }

    syncSpaceFeedTopNukeButton(renderModel)
    syncSpaceFeedTopBarLayout()
    syncSpaceFeedPostButtons(renderModel)
    if(getStoredPendingSpaceFeedWorkCountForSpace() > 0 || hasActivePendingSpaceFeedWork(entries)) {
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

async function restoreProfileSearchCollectCursor() {
    if(profileSearchCollectCursorScrollY <= getProfileSearchScrollY() + 80) return

    window.scrollTo({
        top: profileSearchCollectCursorScrollY,
        left: 0,
        behavior: 'auto'
    })
    await sleep(120)
}

function getProfileSearchStagedHrefs() {
    ensureProfileSearchCollectionStateForCurrentSearch()

    const next = []
    const seen = new Set()
    for(const href of profileSearchStagedHrefs) {
        const normalizedHref = normalizeQuoraProfileHref(href)
        if(!normalizedHref || seen.has(normalizedHref)) continue
        if(!isProfileSearchProfileNukeable(normalizedHref, {
            ignoreStaleCurrentProfileSearchPending: true
        })) continue

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
        if(!isProfileSearchProfileNukeable(normalizedHref, {
            ignoreStaleCurrentProfileSearchPending: true
        })) continue

        profileSearchStagedHrefSet.add(normalizedHref)
        profileSearchStagedHrefs.push(normalizedHref)
        added += 1
    }

    return added
}

function hasUnstagedProfileSearchQueueableRow(rows = getProfileSearchRows({fromCurrentViewport: true})) {
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
    return PROFILE_SEARCH_COLLECT_LIMIT
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
    const rows = []
    const seen = new Set()
    const followButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(isProfileSearchFollowButton)

    for(const followButton of followButtons) {
        const row = getProfileSearchRowForFollowButton(followButton)
        if(!row) continue

        const rect = row.getBoundingClientRect()
        if(fromCurrentViewport && rect.bottom < -80) continue

        const href = getProfileSearchPrimaryHref(row)
        if(!href || seen.has(href)) continue
        seen.add(href)

        rows.push({
            href,
            row,
            followButton,
            rowText: getElementText(row),
            viewportTop: rect.top,
            viewportBottom: rect.bottom
        })
    }

    return rows
}

function isProfileSearchProfileNukeable(href, options = {}) {
    const normalizedHref = normalizeQuoraProfileHref(href)
    if(!normalizedHref) return false
    if(isPendingCoordinatorProfileHref(normalizedHref, {
        ignoreStaleCurrentProfileSearchPending: options.ignoreStaleCurrentProfileSearchPending === true
    })) return false

    const record = getProfileNukeProgressRecord(normalizedHref)
    if(!record) return true
    if(isSuccessfulProfileNukeRecord(record)) return false
    if(isSettledProfileNukeRecord(record)) {
        return !!options.allowRetry && isRetryableProfileNukeRecord(record)
    }

    return false
}

function getProfileSearchQueueableRows(rows = getProfileSearchRows(), options = {}) {
    return rows.filter(row => isProfileSearchProfileNukeable(row.href, {
        ignoreStaleCurrentProfileSearchPending: true,
        ...options
    }))
}

function getProfileSearchToolbar() {
    let toolbar = document.querySelector('.mb-ext_profile-search-toolbar')
    if(toolbar) return toolbar

    toolbar = document.createElement('div')
    toolbar.className = 'mb-ext_profile-search-toolbar'

    const batchButton = document.createElement('button')
    batchButton.type = 'button'
    batchButton.className = 'mb-ext_nuke-profiles-btn mb-ext_profile-search-batch-btn'
    toolbar.appendChild(batchButton)

    const collectButton = document.createElement('button')
    collectButton.type = 'button'
    collectButton.className = 'mb-ext_nuke-profiles-btn mb-ext_profile-search-collect-btn'
    toolbar.appendChild(collectButton)

    document.body.appendChild(toolbar)
    return toolbar
}

function getProfileSearchToolbarButtons() {
    const toolbar = getProfileSearchToolbar()
    return {
        toolbar,
        batch: toolbar.querySelector('.mb-ext_profile-search-batch-btn'),
        collect: toolbar.querySelector('.mb-ext_profile-search-collect-btn')
    }
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
        if(isPendingCoordinatorProfileHref(href)) {
            setNukeButtonWorking(button, 'Nuking...')
            button.disabled = true
        }
        else if(isSuccessfulProfileNukeRecord(record)) {
            setNukeButtonDone(button)
            button.disabled = true
        }
        else if(isSettledProfileNukeRecord(record)) {
            if(isRetryableProfileNukeRecord(record)) {
                setNukeButtonIdle(button, 'Retry')
                button.disabled = false
                setMuteBlockHelp(button, `Retry mute and block for ${href}`)
            }
            else {
                setNukeButtonDone(button, 'Done')
                button.disabled = true
            }
        }
        else {
            setNukeButtonIdle(button, 'Mute-Block')
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
    if(stagedHrefs.length) return stagedHrefs

    const limit = Number.parseInt(options.limit, 10) || getProfileSearchCollectLimit()
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
    const batchHrefs = getProfileSearchBatchHrefs(rows, {limit})
    const pendingSearchCount = getPendingCoordinatorProfileSearchWorkCount()

    buttons.batch = ensureCurrentInstanceClickHandler(buttons.batch, 'profile-search-batch', event => {
        const activeButton = event.currentTarget

        const hrefs = getProfileSearchBatchHrefs(getProfileSearchRows(), {
            limit: getProfileSearchCollectLimit()
        })
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

    if(profileSearchCollecting) {
        setNukeButtonWorking(buttons.collect, buttons.collect.innerText || `Collecting 0 / ${limit}`)
        buttons.collect.disabled = false
        buttons.batch.disabled = !batchHrefs.length
    }
    else if(pendingSearchCount > 0) {
        setNukeButtonWorking(buttons.collect, `Nuking ${pendingSearchCount} left`)
        buttons.collect.disabled = true
        buttons.batch.disabled = true
        scheduleProfileSearchPendingRefresh()
    }
    else {
        clearProfileSearchPendingRefresh()
        setNukeButtonIdle(buttons.collect, `Collect ${limit} More`)
        buttons.collect.disabled = false
        buttons.batch.disabled = !batchHrefs.length
    }

    setNukeButtonIdle(buttons.batch, batchHrefs.length ? `Nuke 'Em ${batchHrefs.length}` : 'Nuke \'Em 0')
    const hasStagedHrefs = getProfileSearchStagedHrefs().length > 0
    setMuteBlockHelp(buttons.batch, batchHrefs.length
        ? buildNukeTargetsHelpText(hasStagedHrefs
            ? 'Queue collected profile-search results'
            : 'Queue currently loaded profile-search results with Follow buttons', batchHrefs)
        : 'No currently loaded profile-search results with Follow buttons are queueable')
    setMuteBlockHelp(buttons.collect, `Scroll this search page and collect up to ${limit} more Follow-button profile results`)

    return true
}

async function nukeProfileSearchHrefs(button, hrefs = [], options = {}) {
    const profileHrefs = getNormalizedProfileHrefList(hrefs)
        .filter(href => isProfileSearchProfileNukeable(href, {
            allowRetry: !!options.allowRetry,
            ignoreStaleCurrentProfileSearchPending: true
        }))

    if(!profileHrefs.length) {
        setNukeButtonNotice(button, 'Nothing queued', button?.innerText || `Nuke 'Em`)
        scheduleProfileSearchControls(0)
        return false
    }

    updateOwnedNukeStatusCache({
        ...ownedNukeStatusCache,
        queued: (Number.parseInt(ownedNukeStatusCache?.queued, 10) || 0) + profileHrefs.length,
        paused: false
    })
    await animateNukeButtonPress(button)
    setNukeButtonWorking(button, `Queueing... ${profileHrefs.length}`)

    const result = await enqueueCoordinatorProfileUrls({
        urls: profileHrefs,
        sourceType: 'profile-search',
        event: options.event || 'Queued from profile search',
        maxConcurrent: getProfileSearchProfilesPerBatch(),
        noForegroundFallback: true,
        maxRetries: 2,
        sourceExtra: {
            searchQuery: new URLSearchParams(location.search).get('q') || '',
            sourceLabel: getProfileSearchQueryLabel()
        }
    })
    const queued = Number.parseInt(result?.executionQueued || result?.queued || result?.merged || 0, 10) || 0
    if(queued > 0) {
        profileSearchLastRunId = result?.runId || profileSearchLastRunId
        profileSearchLastQueuedAt = Date.now()
        profileSearchLastQueuedCount = queued
        setNukeButtonWorking(button, `Nuking ${queued} left`)
        scheduleProfileSearchControls(250)
        scheduleProfileSearchPendingRefresh()
        return true
    }

    setNukeButtonNotice(button, 'Nothing queued', `Nuke 'Em`)
    scheduleProfileSearchControls(250)
    clearProfileSearchPendingRefresh()
    return false
}

async function collectMoreProfileSearchResults(button) {
    const limit = getProfileSearchCollectLimit()
    if(profileSearchCollecting) {
        profileSearchCollectStopRequested = true
        setNukeButtonWorking(button, 'Stopping...')
        return false
    }

    ensureProfileSearchCollectionStateForCurrentSearch()
    profileSearchCollecting = true
    profileSearchCollectStopRequested = false
    const initialStagedCount = getProfileSearchStagedHrefs().length
    const targetStagedCount = initialStagedCount + limit
    let collectedCount = 0
    let stalledStartedAt = 0
    let scrollPasses = 0

    await animateNukeButtonPress(button)
    await restoreProfileSearchCollectCursor()

    try {
        while(!profileSearchCollectStopRequested &&
            collectedCount < limit &&
            scrollPasses < PROFILE_SEARCH_COLLECT_MAX_SCROLL_PASSES) {
            const beforeCount = collectedCount
            const beforeY = getProfileSearchScrollY()
            const beforeHeight = getProfileSearchScrollHeight()
            const rows = getProfileSearchRows({fromCurrentViewport: true})
            for(const row of getProfileSearchQueueableRows(rows, {allowRetry: false})) {
                if(collectedCount >= limit) break
                collectedCount += stageProfileSearchHrefs([row.href])
            }

            saveProfileSearchCollectCursor(rows)
            setNukeButtonWorking(button, `Collecting ${getProfileSearchStagedHrefs().length} / ${targetStagedCount}`)
            syncProfileSearchControls()

            if(collectedCount >= limit) break

            if(isProfileSearchEndOfResultsVisible() && !hasUnstagedProfileSearchQueueableRow() && !hasProfileSearchLoadingIndicator()) break

            nudgeProfileSearchLazyLoad()
            scrollPasses += 1
            await sleep(700)

            const afterY = getProfileSearchScrollY()
            const afterHeight = getProfileSearchScrollHeight()
            profileSearchCollectCursorScrollY = Math.max(profileSearchCollectCursorScrollY, afterY)
            const madeProgress = collectedCount > beforeCount || afterY > beforeY || afterHeight > beforeHeight
            if(madeProgress) {
                stalledStartedAt = 0
            }
            else {
                stalledStartedAt = stalledStartedAt || Date.now()
                if(Date.now() - stalledStartedAt >= PROFILE_SEARCH_COLLECT_STALLED_TIMEOUT_MS) break
            }
        }

        if(profileSearchCollectStopRequested) {
            setNukeButtonNotice(button, 'Stopped', `Collect ${limit} More`)
            return false
        }

        if(collectedCount < 1) {
            setNukeButtonNotice(button, 'No new candidates', `Collect ${limit} More`)
            return false
        }

        setNukeButtonNotice(button, `Collected ${collectedCount}`, `Collect ${limit} More`)
        return true
    }
    finally {
        profileSearchCollecting = false
        profileSearchCollectStopRequested = false
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
    return SPACE_FEED_PROFILES_PER_BATCH
}

function getProfileSearchProfilesPerBatch() {
    const value = Number.parseInt(settings.profilesPerBatch, 10)
    if(!Number.isFinite(value) || value < 1) return PROFILE_SEARCH_PROFILES_PER_BATCH
    return Math.min(value, PROFILE_SEARCH_PROFILES_PER_BATCH)
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
    await sleep(900)

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
        let scrollPasses = 0

        while(idlePasses < MODAL_PROFILE_NUKE_IDLE_SCROLL_PASSES &&
            scrollPasses < MODAL_PROFILE_NUKE_MAX_SCROLL_PASSES &&
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
                        scrollPasses += 1
                        idlePasses = 0
                    }
                }
                else {
                    idlePasses += 1
                }
            }
            else {
                if(await scrollProfileModalForMore(modal)) {
                    scrollPasses += 1
                    idlePasses = 0
                }
                else {
                    idlePasses += 1
                }
            }

            if(idlePasses < MODAL_PROFILE_NUKE_IDLE_SCROLL_PASSES) await sleep(900)
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

async function maybeRunAutoProfileAction() {
    if(autoProfileActionPending || autoProfileActionClaimPending) return

    if(autoProfileAction === undefined) {
        autoProfileActionAttempts += 1
        if(getPageType() === 'profile' && !coordinatorQueueLoaded) {
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
            const shouldKeepRetrying = autoProfileActionAttempts < QUEUED_ACTION_CLAIM_FAST_ATTEMPTS ||
                hasCurrentProfilePendingCoordinatorQueueItem()
            if(shouldKeepRetrying) {
                const retryDelay = autoProfileActionAttempts < QUEUED_ACTION_CLAIM_FAST_ATTEMPTS
                    ? QUEUED_ACTION_CLAIM_FAST_RETRY_DELAY_MS
                    : QUEUED_ACTION_CLAIM_SLOW_RETRY_DELAY_MS
                setTimeout(() => void maybeRunAutoProfileAction(), retryDelay)
                scheduleCurrentProfilePendingClaimRescue(retryDelay)
            }
            return
        }
    }

    const claimedAction = typeof autoProfileAction === 'string'
        ? {action: autoProfileAction, targetUrl: ''}
        : autoProfileAction

    if(claimedAction?.action !== 'nuke' && claimedAction?.action !== UNBLOCK_UNMUTE_ACTION_KIND) {
        autoProfileAction = undefined
        if(hasCurrentProfilePendingCoordinatorQueueItem()) {
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
    autoProfileAction = null
    autoProfileActionAttempts = 0

    let queuedProfileHref = normalizeQuoraProfileHref(claimedAction?.targetUrl || '') || normalizeQuoraProfileHref(location.href) || ''
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
            tabOpenedAt: Date.now(),
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
                console.info('Queued terminal success was not recorded; leaving tab open for retry')
                setTimeout(() => {
                    void sweepServiceWorkerBlockedProfileTabs()
                }, 1000)
                return false
            }
            await releaseQueuedTabSlot()
            await requestCloseTab()
            return true
        }
        const skipQueuedUnavailableTab = async message => {
            console.info(message)
            await recordQueuedProfileProgress({
                status: 'profile-unavailable',
                openedViablePage: false,
                finalError: message,
                unavailableReason: getProfileUnavailableReason() || message,
                event: message
            })
            await releaseQueuedTabSlot()
            await requestCloseTab(2, 100, true)
        }
        const abandonQueuedTab = async (message, extraPatch = {}) => {
            console.info(message)
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
            for(let attempt = 0; attempt < 10; attempt += 1) {
                resolvedProfileHref = normalizeQuoraProfileHref(getQueuedPageResolvedProfileHref(claimedAction) || '') || ''
                if(resolvedProfileHref) break
                await sleep(350 + attempt * 100)
            }

            if(!resolvedProfileHref) return false

            const response = await sendQueuedProfileResolutionMessageWithRetry({
                action: 'resolve-queued-profile-target',
                coordinatorKey: claimedAction?.coordinatorKey || '',
                requestedUrl: claimedAction?.requestedUrl || location.href,
                profileHref: resolvedProfileHref,
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
                        ? 'Queued tab proceeded locally using worker-window action surface'
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

            const initialReadyTimeoutMs = document.visibilityState === 'visible'
                ? VISIBLE_PROFILE_READY_MS
                : allowForegroundFallback
                    ? HIDDEN_PROFILE_READY_FAST_PROBE_MS
                    : HIDDEN_PROFILE_READY_NO_FOREGROUND_MS
            let ready = await waitForCondition(() => !!getProfileMenuButton() || !!getProfileUnavailableReason(), initialReadyTimeoutMs, 250)
            if(!ready && document.visibilityState !== 'visible' && allowForegroundFallback) {
                await recordQueuedProfileProgress({
                    event: 'Unblock Unmute actions stalled in a background tab; waiting for durable profile action gate'
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
                await abandonQueuedTab(`Queued Unblock Unmute did not receive profile action gate${reason}`)
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
                    event: 'Unblock Unmute profile actions became available'
                })

                const wasBlocked = isProfileBlocked()
                await recordQueuedProfileProgress({
                    status: wasBlocked ? 'unblocking' : 'unmuting',
                    openedViablePage: true,
                    event: wasBlocked ? 'Queued Unblock Unmute action started' : 'Queued Unmute action started'
                })
                const stopHeartbeat = startQueuedActionHeartbeat(() => ({
                    status: wasBlocked ? 'unblocking' : 'unmuting',
                    openedViablePage: true,
                    event: wasBlocked ? 'Queued Unblock Unmute action still running' : 'Queued Unmute action still running'
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
                        finalError: result?.reason || 'Queued Unblock Unmute did not complete',
                        event: result?.reason || 'Queued Unblock Unmute did not complete'
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
                    event: wasBlocked ? 'Queued Unblock Unmute completed' : 'Queued profile was already unblocked'
                })
                if(progress?.serviceWorkerOnly && !progress.runtimeRecorded) {
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

        const remappedProfileHref = getQueuedProfileRemapTarget(queuedProfileHref)
        if(remappedProfileHref) {
            await recordQueuedProfileProgress({
                event: `Profile remapped to ${remappedProfileHref}`
            })
        }

        if(isProfileBlocked()) {
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

        if(isProfileBlocked()) {
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

        if(isProfileBlocked()) {
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

            if(isProfileBlocked()) {
                await closeQueuedBlockedTab()
                return
            }

            const blocked = await waitForCondition(() => isProfileBlocked(), 2500, 250)
            if(blocked || isProfileBlocked()) {
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

    const inPageConfirm = getInPageConfirmPairAction(/\bun[\s-]*mute\b|\bconfirm\b|\bcontinue\b/i)
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

function getInPageConfirmPairAction(preferredRegex) {
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

            return {button, score, label, contextText}
        })
        .filter(candidate => candidate.score > 0 &&
            (hasUnmuteActionText(candidate.label) || isUnmuteConfirmContextText(candidate.contextText)))

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

function activateActionElement(element) {
    if(!element) return false

    const rect = element.getBoundingClientRect()
    const clientX = rect.left + Math.max(1, Math.min(rect.width / 2, rect.width - 1))
    const clientY = rect.top + Math.max(1, Math.min(rect.height / 2, rect.height - 1))
    const base = {bubbles: true, cancelable: true, composed: true, view: window, clientX, clientY, button: 0}

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
    if(typeof isStillPending === 'function' && isStillPending()) {
        dispatchActivationKey(element, 'Enter')
        await sleep(100)
        if(isStillPending()) {
            dispatchActivationKey(element, ' ')
            await sleep(100)
            if(isStillPending()) {
                try {
                    element.click()
                }
                catch {}
                await sleep(100)
                if(isStillPending()) {
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
                ? `${formatConfirmationKind(confirmationKind)} confirmation using worker-window action surface after foreground timeout`
                : `${formatConfirmationKind(confirmationKind)} confirmation using worker-window action surface`,
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
    return {ok: true, changed: true, reason: 'unmute-clicked-unverified'}
}

async function waitForCanonicalProfileActionRoute(profileHref, timeoutMs = 5000) {
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
        if(clearNukeState) {
            await clearProfileNukeState(profileHref, 'Unblock Unmute action unblocked the profile')
        }
    }
    else {
        unmute = await unmuteProfileBestEffort({silent, allowForegroundFallback})
        if(!unmute.ok && unmute.reason !== 'unmute-option-not-found' && unmute.reason !== 'unmute-option-not-offered') {
            return {ok: false, reason: unmute.reason || 'unmute-failed', unmute}
        }
    }

    if(isProfileBlocked({ignoreHints: true}) && !isProfileVisiblyUnblocked()) {
        return {ok: false, reason: 'profile-still-blocked', unblock, unmute}
    }

    rememberProfileUnblocked(profileHref)
    if(clearNukeState) {
        await clearProfileNukeState(profileHref, 'Unblock Unmute action completed on a live unblocked profile')
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
    noteCurrentProfileNukeProgress({
        status: 'muting',
        muteAttempted: true,
        muteAttemptedAt: Date.now(),
        event: 'Mute flow started'
    })

    const menuOpened = await ensureProfileMenuOpen(2500, silent, allowForegroundFallback)
    if(!menuOpened) {
        await recordCurrentProfileNukeProgress({
            muteSucceeded: false,
            muteError: 'Profile menu did not open',
            event: 'Mute flow fell back because the profile menu did not open'
        })
        return allowBlockFallback ? blockProfile({silent, allowForegroundFallback}) : false
    }

    await sleep(500)

    const muteState = await waitForMenuStateWithForegroundFallback(isMuteActionLabel, isUnmuteActionLabel, {
        timeoutMs: 5000,
        intervalMs: 250,
        promotionReason: 'mute-option-not-found',
        silent,
        allowForegroundFallback
    })
    if(muteState?.state === 'inverse') {
        noteCurrentProfileNukeProgress({
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

async function blockProfile(options = {}) {
    const {silent = false, allowForegroundFallback = false} = options

    if(isProfileBlocked()) {
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
        noteCurrentProfileNukeProgress({
            status: 'blocking',
            blockAttempted: true,
            blockAttemptedAt: Date.now(),
            event: 'Block flow resumed from pending confirmation'
        })

        if(await completePendingBlockConfirmation(pendingBlockConfirm, silent)) return true
    }

    noteCurrentProfileNukeProgress({
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
    await sleep(500)

    let blockState = await waitForMenuStateWithForegroundFallback(isBlockActionLabel, isUnblockActionLabel, {
        timeoutMs: 5000,
        intervalMs: 250,
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
        if(isProfileBlocked()) {
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
            rememberProfileBlocked()
            await recordCurrentProfileNukeProgress({
                status: 'blocked',
                blockSucceeded: true,
                blockedAt: Date.now(),
                event: 'Block applied before confirm state resolved'
            })
            return true
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
        rememberProfileBlocked()
        await recordCurrentProfileNukeProgress({
            status: 'blocked',
            blockSucceeded: true,
            blockedAt: Date.now(),
            event: 'Profile reached blocked state without an explicit confirm click'
        })
        return true
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

async function ensureProfileMenuOpen(timeoutMs = 2500, silent = false, allowForegroundFallback = false) {
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

async function closeProfileMenu(timeoutMs = 1500) {
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
