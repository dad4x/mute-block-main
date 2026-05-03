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

let profilesModalTimeout
let profileButtonsTimeout
let profileButtonsRefreshTimeout
let profileButtonsPending = false
let profileActionInProgress = false
let profileButtonsFollowUpTimeouts = []
let autoProfileAction = undefined
let autoProfileActionPending = false
let autoProfileActionAttempts = 0
let profileBlockMutationCount = 0
let profileBlockHintKey = null
let profileBlockHintAt = 0
let originalPosterRedirectPending = false
let originalPosterRedirectAttempts = 0
let originalPosterRedirectTimeout = null
let questionPageBtnTimeout
let questionPageBtnPending = false
let questionPageFollowUpTimeouts = []
let spacePostBtnTimeout
let spacePostBtnPending = false
let spacePostFollowUpTimeouts = []
let spaceClassificationTimeout
let spaceClassificationPending = false
let spaceAssetNukeTimeout
let spaceAssetNukePending = false
let spaceAssetNukeViewportTimeout = null
let spaceAssetNukeViewportListenerInstalled = false
let spaceFeedProgressReconcileTimeout = null
let spaceFeedProgressReconcilePending = false
let suppressSpaceAssetNukeRefreshUntil = 0
let latestSpaceFeedEntries = []
let closeTabRetryTimeouts = []
let blockedCloseCheckTimeouts = []
let currentUrl = location.href
let settings = {...defaults}
let spaceRegistry = {}
let spaceNukedPosts = {}
let spacePendingNukedPosts = {}
let profileNukeProgress = {}
let spaceFeedNukingPostKeys = new Set()
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
let initialized = false
const PROFILE_ACTION_BUTTON_ORDER = ['mute-block-close', 'mute-block', 'close-tab']
const SPACE_POST_NUKE_MIN_PROFILES = 2
const SPACE_FEED_POST_NUKE_MIN_PROFILES = 1
const SPACE_PENDING_NUKED_POSTS_KEY = 'mbSpacePendingNukedPosts'
const PROFILE_NUKE_PROGRESS_KEY = 'mbProfileNukeProgress'
const MAX_PROFILE_NUKE_PROGRESS_ENTRIES = 1000
const STALE_PROFILE_NUKE_PROGRESS_MS = 12000
const TRANSIENT_PROFILE_NUKE_STATUSES = new Set([
    'queued',
    'tab-opening',
    'tab-opened',
    'awaiting-visibility',
    'page-ready',
    'muting',
    'blocking'
])
const QUORA_NON_PROFILE_ROOT_PATHS = new Set([
    'answer',
    'bookmarks',
    'business',
    'careers',
    'contact',
    'following',
    'messages',
    'notifications',
    'profile',
    'question',
    'search',
    'settings',
    'space',
    'spaces',
    'topic',
    'unanswered'
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

    settings = await safeStorageGet(defaults)
    spaceRegistry = (await safeStorageGet({[SPACE_REGISTRY_KEY]: {}}))[SPACE_REGISTRY_KEY] || {}
    const storedSpaceNukedPosts = (await safeStorageGet({[SPACE_NUKED_POSTS_KEY]: {}}))[SPACE_NUKED_POSTS_KEY] || {}
    spaceNukedPosts = pruneRememberedSpaceNukes(storedSpaceNukedPosts)
    spacePendingNukedPosts = (await safeStorageGet({[SPACE_PENDING_NUKED_POSTS_KEY]: {}}))[SPACE_PENDING_NUKED_POSTS_KEY] || {}
    const storedProfileNukeProgress = (await safeStorageGet({[PROFILE_NUKE_PROGRESS_KEY]: {}}))[PROFILE_NUKE_PROGRESS_KEY] || {}
    profileNukeProgress = normalizeStoredProfileNukeProgress(storedProfileNukeProgress)
    if(!haveSameNukedPostKeys(storedSpaceNukedPosts, spaceNukedPosts)) {
        await safeStorageSet({[SPACE_NUKED_POSTS_KEY]: spaceNukedPosts})
    }
    if(JSON.stringify(profileNukeProgress) !== JSON.stringify(storedProfileNukeProgress || {})) {
        await safeStorageSet({[PROFILE_NUKE_PROGRESS_KEY]: profileNukeProgress})
    }
    browser.runtime.onMessage.addListener(onMessage)
    getStorageChangeSource()?.addListener(onStorageChanged)
    installNavigationHooks()
    await reconcileReloadCanceledNukes()

    if(maybeRedirectToCanonicalProfileUrl()) {
        return
    }

    const page = getPageType()

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
        injectSpaceSidebarOpenProfilesBtn()
        scheduleSpaceClassificationControls(0)
        scheduleSpaceAssetNukeControls(200)
        setTimeout(() => {
            void reconcileStaleSpaceFeedProgress()
        }, 350)
    }

    void maybeRunAutoProfileAction()
    installSpaceFeedViewportRefresh()
    startObserver()
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
                scheduleSpaceAssetNukeControls(0)
            }
        }
        else if(key === SPACE_PENDING_NUKED_POSTS_KEY) {
            spacePendingNukedPosts = change.newValue || {}
            if(getPageType() === 'space') {
                scheduleSpaceAssetNukeControls(0)
            }
        }
        else if(key === PROFILE_NUKE_PROGRESS_KEY) {
            profileNukeProgress = normalizeStoredProfileNukeProgress(change.newValue || {})
            if(getPageType() === 'space') {
                void reconcileStaleSpaceFeedProgress()
                scheduleSpaceAssetNukeControls(0)
            }
        }
    }
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

function getProfileNukeRecordAgeMs(record, now = Date.now()) {
    const updatedAt = Number.isFinite(record?.updatedAt) ? record.updatedAt : 0
    if(!updatedAt) return Number.POSITIVE_INFINITY
    return Math.max(0, now - updatedAt)
}

function getPendingSpaceFeedRecord(postKey) {
    return postKey ? spacePendingNukedPosts?.[postKey] || null : null
}

function shouldReconcilePendingProfileRecord(record, pendingRecord, now = Date.now(), allowStale = true) {
    if(!pendingRecord) return false

    const pendingAgeMs = Number.isFinite(pendingRecord.updatedAt)
        ? Math.max(0, now - pendingRecord.updatedAt)
        : Number.POSITIVE_INFINITY

    if(!record) {
        return allowStale && pendingAgeMs >= STALE_PROFILE_NUKE_PROGRESS_MS
    }

    if(isSuccessfulProfileNukeRecord(record) ||
        record.status === 'profile-unavailable' ||
        record.status === 'error' ||
        record.status === 'interrupted') {
        return true
    }

    if(!isTransientProfileNukeStatus(record.status)) {
        return false
    }

    if(record.tabClosedAt || record.closeReason || record.errorPageUrl || record.finalError) {
        return true
    }

    return allowStale && getProfileNukeRecordAgeMs(record, now) >= STALE_PROFILE_NUKE_PROGRESS_MS
}

function isSpaceLinkedProfileNukeRecord(record) {
    if(!record || typeof record !== 'object') return false

    if(Array.isArray(record.postKeys) && record.postKeys.length) return true
    if(Array.isArray(record.postUrls) && record.postUrls.length) return true

    return Array.isArray(record.events) &&
        record.events.some(event => `${event || ''}`.includes('Queued from space feed'))
}

function shouldReconcileStoredProfileRecord(record, now = Date.now(), allowStale = true) {
    if(!record || !isTransientProfileNukeStatus(record.status)) return false
    if(!isSpaceLinkedProfileNukeRecord(record)) return false

    if(record.tabClosedAt || record.closeReason || record.errorPageUrl || record.finalError) {
        return true
    }

    return allowStale && getProfileNukeRecordAgeMs(record, now) >= STALE_PROFILE_NUKE_PROGRESS_MS
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

    const status = updateOwnedNukeStatusCache(await getOwnedNukeStatus())
    const allowStaleReconcile = !hasOwnedNukeWorkInFlight(status)
    const now = Date.now()
    const urlsToClear = new Set()
    const updatesByHref = new Map()

    for(const [profileHref, record] of Object.entries(profileNukeProgress || {})) {
        if(!shouldReconcileStoredProfileRecord(record, now, allowStaleReconcile)) continue
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
            if(!shouldReconcilePendingProfileRecord(record, pendingRecord, now, allowStaleReconcile)) continue

            urlsToClear.add(normalizedUrl)

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
        await recordProfileNukeProgressBatch(updates)
    }

    if(urlsToClear.size) {
        await removePendingSpaceFeedUrls(Array.from(urlsToClear))
        return true
    }

    return false
}

async function failCurrentQueuedProfile(additionalUrls = []) {
    const failedUrls = getNormalizedProfileHrefList(additionalUrls || [])
    if(!failedUrls.length) return []

    await removePendingSpaceFeedUrls(failedUrls)
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
    const next = {
        ...previous,
        ...patch,
        profileHref: normalizedHref,
        updatedAt: Date.now()
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

    delete next.event
    return next
}

function buildQueuedProfileProgressPatch(event, extraPatch = {}) {
    return {
        status: 'queued',
        queuedAt: Date.now(),
        foundBlockedBeforeQueue: false,
        tabOpenedAt: 0,
        tabClosedAt: 0,
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

    profileNukeProgress = pruneProfileNukeProgress({
        ...profileNukeProgress,
        [normalizedHref]: nextRecord
    })

    await persistProfileNukeProgressLocally()
    await safeSendRuntimeMessage({
        action: 'record-nuke-progress',
        profileHref: normalizedHref,
        patch
    }, null)

    return nextRecord
}

async function recordProfileNukeProgressBatch(updates) {
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

        normalizedUpdates.push({profileHref: normalizedHref, patch})
        nextProgress[normalizedHref] = nextRecord
    }

    if(!normalizedUpdates.length) return false

    profileNukeProgress = pruneProfileNukeProgress(nextProgress)
    await persistProfileNukeProgressLocally()
    await safeSendRuntimeMessage({action: 'record-nuke-progress-batch', updates: normalizedUpdates}, null)
    return true
}

function getProfileNukeProgressRecord(href) {
    const normalizedHref = normalizeQuoraProfileHref(href)
    return normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
}

async function persistProfileNukeProgressLocally() {
    const stored = (await safeStorageGet({[PROFILE_NUKE_PROGRESS_KEY]: {}}))[PROFILE_NUKE_PROGRESS_KEY] || {}
    profileNukeProgress = normalizeStoredProfileNukeProgress({
        ...stored,
        ...profileNukeProgress
    })
    await safeStorageSet({[PROFILE_NUKE_PROGRESS_KEY]: profileNukeProgress})
}

async function recordCurrentProfileNukeProgress(patch = {}) {
    return recordProfileNukeProgress(location.href, {
        lastUrl: location.href,
        pageType: getPageType() || 'unknown',
        securityVerification: isSecurityVerificationPage(),
        unavailableReason: getProfileUnavailableReason() || '',
        ...patch
    })
}

async function notifyQueuedTabComplete() {
    const result = await safeSendRuntimeMessage({action: 'release-tab-slot'}, null)
    return !!result?.released
}

async function sweepBlockedProfileTabs() {
    const result = await safeSendRuntimeMessage({action: 'sweep-owned-blocked-profile-tabs'}, null)
    return {
        owned: Number.parseInt(result?.owned, 10) || 0,
        signaled: Number.parseInt(result?.signaled, 10) || 0
    }
}

async function getOwnedNukeStatus() {
    const result = await safeSendRuntimeMessage({action: 'get-owned-nuke-status'}, null)
    return {
        active: Number.parseInt(result?.active, 10) || 0,
        owned: Number.parseInt(result?.owned, 10) || 0,
        queued: Number.parseInt(result?.queued, 10) || 0,
        paused: !!result?.paused
    }
}

function updateOwnedNukeStatusCache(status = null) {
    ownedNukeStatusCache = {
        active: Number.parseInt(status?.active, 10) || 0,
        owned: Number.parseInt(status?.owned, 10) || 0,
        queued: Number.parseInt(status?.queued, 10) || 0,
        paused: !!status?.paused
    }

    return ownedNukeStatusCache
}

async function promoteCurrentQueuedTab(reason = 'hidden-tab-stall') {
    if(document.visibilityState === 'visible') return false

    const response = await safeSendRuntimeMessage({
        action: 'promote-queued-tab',
        reason
    }, {promoted: false})

    return !!response?.promoted
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
        const status = updateOwnedNukeStatusCache(await getOwnedNukeStatus())
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

    const status = updateOwnedNukeStatusCache(await getOwnedNukeStatus())
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
            resetSpaceAssetNukeControls()

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
                injectSpaceSidebarOpenProfilesBtn()
                if(shouldRefreshSpaceClassificationControls()) {
                    scheduleSpaceClassificationControls(120)
                }

                if(Date.now() >= suppressSpaceAssetNukeRefreshUntil) {
                    scheduleSpaceAssetNukeControls(180)
                }
            }
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

    const scheduleFromViewport = () => {
        if(getPageType() !== 'space') return

        clearTimeout(spaceAssetNukeViewportTimeout)
        spaceAssetNukeViewportTimeout = setTimeout(() => {
            spaceAssetNukeViewportTimeout = null
            scheduleSpaceAssetNukeControls(0)
        }, 90)
    }

    window.addEventListener('scroll', scheduleFromViewport, {passive: true})
    window.addEventListener('resize', scheduleFromViewport, {passive: true})
    spaceAssetNukeViewportListenerInstalled = true
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
    toggleMuteBlockBtn()
    toggleMuteBlockCloseBtn()
}

function hasProfileButtons() {
    const hasCloseBtn = !!document.querySelector('.mb-ext_close-tab-btn')
    const hasMuteBtn = !!document.querySelector('.mb-ext_mute-block-btn') || isProfileBlocked()
    const hasMuteCloseBtn = !!document.querySelector('.mb-ext_mute-block-close-btn') || isProfileBlocked()
    return hasCloseBtn && hasMuteBtn && hasMuteCloseBtn
}

function areProfileButtonsCorrectlyPlaced(target = getProfileButtonInsertionTarget()) {
    const closeBtn = document.querySelector('.mb-ext_close-tab-btn')
    const muteBtn = document.querySelector('.mb-ext_mute-block-btn')
    const muteCloseBtn = document.querySelector('.mb-ext_mute-block-close-btn')

    if(!target) return !closeBtn && (!muteBtn || isProfileBlocked()) && (!muteCloseBtn || isProfileBlocked())
    if(closeBtn && !isProfileTargetPlacement(closeBtn, target)) return false
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
                (node.matches?.('.mb-ext_close-tab-btn, .mb-ext_mute-block-btn, .mb-ext_mute-block-close-btn') ||
                    node.querySelector?.('.mb-ext_close-tab-btn, .mb-ext_mute-block-btn, .mb-ext_mute-block-close-btn'))
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
            if(getPageType() === 'profile' && !profileActionInProgress) {
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
    if(request.action === 'close-if-blocked') {
        if(getPageType() === 'profile' && isProfileBlocked()) {
            return (async () => {
                const requestedProfileHref = normalizeQuoraProfileHref(request?.requestedProfileHref || '') || ''
                const resolvedProfileHref = getProfileKey(location.href) || ''
                const progressHref = requestedProfileHref || resolvedProfileHref || location.href

                await recordProfileNukeProgress(progressHref, {
                    status: 'already-blocked',
                    openedViablePage: true,
                    foundBlockedBeforeQueue: true,
                    blockSucceeded: true,
                    blockedAt: Date.now(),
                    lastUrl: location.href,
                    resolvedProfileHref,
                    remappedFromRequested: !!(requestedProfileHref && resolvedProfileHref && requestedProfileHref !== resolvedProfileHref),
                    finalError: '',
                    event: 'Profile confirmed blocked by background sweep'
                })
                await confirmCurrentProfileBlockedSpaceFeedEntries(progressHref)
                await notifyQueuedTabComplete()
                setTimeout(() => {
                    void requestCloseTab(2, 100, true)
                }, 0)
                return {willClose: true, resolvedProfileHref}
            })()
        }

        return {willClose: false, armed: false}
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
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    button.classList.add('mb-ext_nuke-profiles-btn--pressed')
    button.classList.add('mb-ext_nuke-profiles-btn--flash')
    await sleep(360)
    button.classList.remove('mb-ext_nuke-profiles-btn--flash')
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
            resetSpaceAssetNukeControls()

            if(maybeRedirectToCanonicalProfileUrl()) {
                return
            }

            if(getPageType() === 'profile') {
                ensureProfileButtons()
                scheduleProfileButtonsFollowUps()
            }
            else if(getPageType() === 'space-post') {
                scheduleSpacePostNukeBtn()
                scheduleSpacePostFollowUps()
            }
            else if(getPageType() === 'space') {
                injectSpaceSidebarOpenProfilesBtn()
                scheduleSpaceClassificationControls(0)
                scheduleSpaceAssetNukeControls(200)
            }
            else if(getPageType() === 'question') {
                ensureQuestionPageFOPBtn()
                scheduleQuestionPageFollowUps()
            }

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

function shouldRefreshSpaceAssetNukeControls() {
    if(getPageType() !== 'space') return false

    const space = resolveCurrentSpaceDescriptor()
    const main = document.querySelector('#mainContent')
    const liveTimestampCount = getVisibleSpaceFeedTimestamps().length
    const storedTimestampCount = Number.parseInt(main?.dataset.mbSpaceFeedTimestampCount || '-1', 10)
    const liveCardCount = getSpaceFeedCardRoots().length
    const storedCardCount = Number.parseInt(main?.dataset.mbSpaceFeedCardCount || '-1', 10)
    const storedEntryCount = Number.parseInt(main?.dataset.mbSpaceFeedEntryCount || '-1', 10)
    const storedPostButtonCount = Number.parseInt(main?.dataset.mbSpaceFeedPostButtonCount || '-1', 10)
    const hasStatusButton = !!document.querySelector('.mb-ext_space-feed-status-btn')
    const livePostButtonCount = document.querySelectorAll('.mb-ext_space-feed-post-nuke-host').length

    if(!hasStatusButton) return true
    if(storedTimestampCount !== liveTimestampCount) return true
    if(storedCardCount !== liveCardCount) return true

    if(isNukableSpacePage()) {
        if(storedEntryCount < 0) return true
        if(storedEntryCount > 0) {
            if(!document.querySelector('.mb-ext_space-feed-nuke-btn')) return true
            if(storedPostButtonCount < 0) return true
            if(livePostButtonCount !== storedPostButtonCount) return true
        }
        return false
    }

    return !!document.querySelector('.mb-ext_space-feed-nuke-host, .mb-ext_space-feed-post-nuke-host')
}

function resetSpaceAssetNukeControls() {
    clearTimeout(spaceAssetNukeTimeout)
    spaceAssetNukeTimeout = null
    spaceAssetNukePending = false
    clearTimeout(spaceAssetNukeViewportTimeout)
    spaceAssetNukeViewportTimeout = null
}

function scheduleSpaceAssetNukeControls(delay = 180) {
    if(spaceAssetNukePending && delay !== 0) return

    spaceAssetNukePending = true
    clearTimeout(spaceAssetNukeTimeout)
    spaceAssetNukeTimeout = setTimeout(() => {
        void (async () => {
            spaceAssetNukeTimeout = null
            spaceAssetNukePending = false
            if(getPageType() === 'space') {
                await refreshOwnedNukeStatusCache()
            }
            suppressSpaceAssetNukeRefreshUntil = Date.now() + 250
            syncSpaceFeedNukeControls()
        })()
    }, Math.max(0, delay))
}

function getPageType() {
    const params = new URLSearchParams(location.search)

    if(getProfileKey(location.href) && params.get('__nsrc__') !== 'notif_page') {
        return 'profile'
    }
    else if(/\/log(?:$|[/?#])/i.test(location.pathname) || /question\slog/i.test(document.title)) {
        return 'question-log'
    }
    else if(/^\/topic(?:$|[/?#])/i.test(location.pathname)) {
        return 'topic'
    }
    else if(document.querySelector('.puppeteer_test_tribe_info_header')) {
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

function isSecurityVerificationPage() {
    const title = (document.title || '').toLowerCase()
    const bodyText = (document.body?.innerText || '').toLowerCase()

    return title.includes('just a moment') ||
        title.includes('security verification') ||
        bodyText.includes('performing security verification') ||
        bodyText.includes('verify you are human') ||
        !!document.querySelector('[name="cf-turnstile-response"], .cf-turnstile, #challenge-stage')
}

function getProfileUnavailableReason() {
    if(!getProfileKey(location.href)) return ''

    const title = (document.title || '').toLowerCase()
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const patterns = [
        /\buser not found\b/,
        /\bprofile not found\b/,
        /\bpage not found\b/,
        /\bthis (?:profile|user|account) (?:is )?(?:unavailable|disabled|deactivated|deleted|suspended|restricted)\b/,
        /\b(?:profile|user|account) (?:is )?(?:unavailable|disabled|deactivated|deleted|suspended|restricted)\b/,
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

function getElementText(element) {
    return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim()
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
    const main = document.querySelector('#mainContent')
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
            if(isProfileBlocked()) score += 180
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
    const actionRow = getProfileActionRow()
    const actionAnchor = getProfileActionAnchor(actionRow)
    if(!actionRow || !actionAnchor) {
        return getProfileMenuButtonFallback()
    }

    const scope = actionRow
    const rowMenuButtons = getVisibleButtons(scope).filter(button => {
        return button.getAttribute('aria-haspopup') === 'menu' && isSameRow(actionAnchor, button)
    })

    rowMenuButtons.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()

        return rightRect.left - leftRect.left || leftRect.top - rightRect.top
    })

    return rowMenuButtons[0] || getProfileMenuButtonFallback(actionAnchor)
}

function getProfileMenuButtonFallback(anchor = null) {
    const main = document.querySelector('#mainContent, main, [role="main"]')
    if(!main) return null

    const anchorRect = anchor?.getBoundingClientRect() || null
    const candidates = getVisibleButtons(main)
        .filter(button => {
            const text = getElementText(button)
            const ariaLabel = `${button.getAttribute('aria-label') || ''}`
            return button.getAttribute('aria-haspopup') === 'menu' ||
                button.classList?.contains('puppeteer_test_overflow_menu') ||
                /\bmore\b|\boptions\b/i.test(text) ||
                /\bmore\b|\boptions\b/i.test(ariaLabel)
        })
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

function syncActiveProfileModal(modal = getProfilePeopleModal()) {
    if(modal && modal !== activeProfileModal) {
        activeProfileModal = modal
        handledModalProfileUrls = new Set()
    }
    else if(!modal) {
        activeProfileModal = null
        handledModalProfileUrls = new Set()
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
    return !!getModalItemProfileHref(item) && hasVisibleFollowProxy(item)
}

function isModalItemHandled(item) {
    const href = getModalItemProfileHref(item)
    const identityKey = getNormalizedProfileIdentityKey(href)
    return item?.dataset?.mbOpened === 'true' || (!!identityKey && handledModalProfileUrls.has(identityKey))
}

function getUnhandledProfileModalItems(modal = getProfilePeopleModal()) {
    modal = syncActiveProfileModal(modal)
    return getProfileModalItems(modal).filter(item => !isModalItemHandled(item))
}

function getQueueableProfileModalItems(modal = getProfilePeopleModal()) {
    return getUnhandledProfileModalItems(modal).filter(isModalItemQueueable)
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
            if(!isVisible(candidate)) return false

            const label = `${candidate.getAttribute('aria-label') || ''} ${getElementText(candidate)}`
            return regex.test(label)
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

        const label = `${candidate.getAttribute('aria-label') || ''} ${getElementText(candidate)}`
        return regex.test(label)
    }) || null
}

function getMenuAction(regex) {
    const match = findOverlayAction(regex, getOverlayRoots(false))
    if(match) return match

    return getVisibleAction(regex)
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
            if(!/\bmuted\b|\bmuting this person\b/i.test(text)) return false

            const buttons = getVisibleActionButtons(element)
            return buttons.some(button => /\bconfirm\b/i.test(getElementText(button))) &&
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
        .filter(button => /\bconfirm\b/i.test(getElementText(button)))
        .map(button => {
            const context = getBestActionContext(button)
            const contextText = context?.text || ''
            let score = scoreActionCandidate(button, /\bconfirm\b/i, contextText)

            if(/\bmuted\b|\bmuting this person\b/i.test(contextText)) score += 1200
            if(/\bask question\b|\badd question\b|\bcreate post\b/i.test(contextText)) score -= 1500
            if(/\bcancel\b/i.test(contextText) && !/\bmuted\b|\bmuting this person\b/i.test(contextText)) score -= 500

            return {button, score, contextText}
        })
        .filter(candidate => /\bmuted\b|\bmuting this person\b/i.test(candidate.contextText))

    candidates.sort((left, right) => right.score - left.score)
    return candidates
}

function getMuteConfirmAction() {
    const buttons = getMuteConfirmCandidates()
    if(buttons.length) return buttons[0].button

    const container = getMuteConfirmContainer()
    if(container) {
        const containerButtons = getVisibleActionButtons(container)
            .filter(button => /\bconfirm\b/i.test(getElementText(button)))
            .map(button => ({button, score: scoreActionCandidate(button, /\bconfirm\b/i, getElementText(container)) + 500}))

        containerButtons.sort((left, right) => right.score - left.score)
        if(containerButtons.length) return containerButtons[0].button
    }

    return getDialogPrimaryAction(getDialogRoots(), /\bconfirm\b|\bmute\b/i)
}

function isMuteConfirmPending() {
    return !!getMuteConfirmContainer() || getMuteConfirmCandidates().length > 0
}

function getBlockConfirmContainer() {
    const candidates = Array.from(document.querySelectorAll('div, section, aside'))
        .filter(isVisible)
        .filter(element => {
            const text = getElementText(element)
            if(!/\bblock\b|\bblocked\b|\bunblock\b/i.test(text)) return false

            const buttons = getVisibleActionButtons(element)
            return buttons.some(button => /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i.test(getElementText(button))) &&
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
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
        .filter(button => !shouldIgnoreActionCandidate(button) && isVisible(button))
        .filter(button => /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i.test(getElementText(button)))
        .map(button => {
            const context = getBestActionContext(button)
            const contextText = context?.text || ''
            let score = scoreActionCandidate(button, /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i, contextText)

            if(/\bblock this profile\b|\bblock this person\b|\bblock\b|\bblocked\b/i.test(contextText)) score += 1200
            if(/\bmuted\b|\bmuting this person\b|\bask question\b|\badd question\b|\bcreate post\b/i.test(contextText)) score -= 1500
            if(/\bcancel\b/i.test(contextText) && !/\bblock this profile\b|\bblock this person\b|\bblock\b|\bblocked\b/i.test(contextText)) score -= 500

            return {button, score, contextText}
        })
        .filter(candidate => /\bblock this profile\b|\bblock this person\b|\bblock\b|\bblocked\b/i.test(candidate.contextText) &&
            !/\bmuted\b|\bmuting this person\b|\bask question\b|\badd question\b|\bcreate post\b/i.test(candidate.contextText))

    candidates.sort((left, right) => right.score - left.score)
    return candidates
}

function getBlockConfirmAction() {
    const buttons = getBlockConfirmCandidates()
    if(buttons.length) return buttons[0].button

    const container = getBlockConfirmContainer()
    if(container) {
        const containerButtons = getVisibleActionButtons(container)
            .filter(button => /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i.test(getElementText(button)))
            .map(button => ({button, score: scoreActionCandidate(button, /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i, getElementText(container)) + 500}))

        containerButtons.sort((left, right) => right.score - left.score)
        if(containerButtons.length) return containerButtons[0].button
    }

    return getDialogPrimaryAction(getDialogRoots(), /\bblock\b|\bconfirm\b|\bcontinue\b|\byes\b|\bok\b/i)
}

function isBlockConfirmPending() {
    return !!getBlockConfirmContainer() || getBlockConfirmCandidates().length > 0
}

function getDialogRoots() {
    const roots = [
        ...getOverlayRoots(true).filter(root => root.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')),
        ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal_content_inner')
    ].filter(isVisible)

    return Array.from(new Set(roots))
}

function getDialogPrimaryAction(dialogRoots, preferredRegex = null) {
    const candidates = []

    for(const root of dialogRoots) {
        const rootText = getElementText(root)

        for(const button of Array.from(root.querySelectorAll('button, [role="button"], a'))) {
            if(shouldIgnoreActionCandidate(button)) continue
            if(!isVisible(button)) continue

            const score = scoreActionCandidate(button, preferredRegex, rootText)
            if(score > -600) candidates.push({button, score})
        }
    }

    candidates.sort((left, right) => right.score - left.score)
    return candidates[0]?.button || null
}

function shouldIgnoreActionCandidate(candidate) {
    if(!candidate) return true
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

async function readProfileMenuState(primaryRegex, inverseRegex, timeoutMs = 2500, intervalMs = 200) {
    const opened = await ensureProfileMenuOpen()
    if(!opened) return null

    await sleep(400)

    const state = await waitForMenuState(primaryRegex, inverseRegex, timeoutMs, intervalMs)

    if(state?.state && isProfileMenuOpen()) {
        await closeProfileMenu()
        await sleep(250)
    }

    return state?.state || null
}

async function waitForProfileMenuState(expectedState, primaryRegex, inverseRegex, timeoutMs = 8000, intervalMs = 500) {
    const startedAt = Date.now()

    while(Date.now() - startedAt < timeoutMs) {
        const state = await readProfileMenuState(primaryRegex, inverseRegex, 1800, 200)
        if(state === expectedState) return true
        await sleep(intervalMs)
    }

    return false
}

function isProfileBlocked() {
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

    if(isProfileBlockedFromInlineState()) {
        rememberProfileBlocked()
        return true
    }

    return hasRecentProfileBlockHint()
}

function getProfileKey(href = location.href) {
    return normalizeQuoraProfileHref(href)
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

    const pathPattern = escapeRegex(profilePath)
    const blockedPattern = /\\?"isBlockedByViewer\\?":true|\\?"isBlocking\\?":true/

    for(const script of Array.from(document.scripts || [])) {
        const text = script.textContent || ''
        if(!text || !text.includes(profilePath)) continue

        const match = text.match(new RegExp(`${pathPattern}[\\s\\S]{0,4000}`, 'i'))
        if(match && blockedPattern.test(match[0])) return true

        const reverseMatch = text.match(new RegExp(`[\\s\\S]{0,4000}${pathPattern}`, 'i'))
        if(reverseMatch && blockedPattern.test(reverseMatch[0])) return true
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
    return true
}

function noteProfileBlockMutation() {
    profileBlockMutationCount += 1
    rememberProfileBlocked()
}

function hasRecentProfileBlockHint(maxAgeMs = 20000) {
    const profileKey = getProfileKey()
    if(!profileKey || profileBlockHintKey !== profileKey || !profileBlockHintAt) return false
    return Date.now() - profileBlockHintAt <= maxAgeMs
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
                    await confirmCurrentProfileBlockedSpaceFeedEntries()
                    await notifyQueuedTabComplete()
                    await requestCloseTab(2, 100, true)
                })()
                return
            }

            if(getProfileMenuButton()) {
                void (async () => {
                    const menuBlocked = await readProfileMenuState(/\bblock\b/i, /\bunblock\b/i, 700, 100)
                    if(menuBlocked === 'inverse') {
                        rememberProfileBlocked()
                        await confirmCurrentProfileBlockedSpaceFeedEntries()
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
            const result = await safeSendRuntimeMessage({action: 'close-tab'}, null)
            const closed = !!result?.closed
            if(closed) return true
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
    const muteBtn = document.querySelector('.mb-ext_mute-block-btn')
    const muteCloseBtn = document.querySelector('.mb-ext_mute-block-close-btn')
    const originalText = button.innerText
    const originalCloseText = closeBtn?.innerText || ''
    const originalMuteText = muteBtn?.innerText || ''
    const originalMuteCloseText = muteCloseBtn?.innerText || ''

    button.innerText = 'Working...'
    for(const managedButton of [closeBtn, muteBtn, muteCloseBtn]) {
        if(managedButton) managedButton.disabled = true
    }

    if(closeBtn) {
        closeBtn.innerText = 'Please wait...'
    }

    try {
        const ready = await waitForProfileActionReady()
        if(!ready) {
            const unavailableReason = getProfileUnavailableReason()
            if(unavailableReason) {
                await removePendingSpaceFeedUrls([location.href])
                alert(unavailableReason)
                return
            }

            logProfileActionDebug('Profile actions not ready')
            alert('Profile actions not ready')
            return
        }

        const unavailableReason = getProfileUnavailableReason()
        if(unavailableReason) {
            await removePendingSpaceFeedUrls([location.href])
            alert(unavailableReason)
            return
        }

        if(isProfileBlocked()) {
            await confirmCurrentProfileBlockedSpaceFeedEntries()
            if(closeAfterSuccess) {
                button.innerText = 'Closing...'
                await new Promise(resolve => requestAnimationFrame(resolve))

                const closed = await requestCloseTab()
                if(closed) return
            }

            return
        }

        const completed = await muteProfile()

        if(completed || isProfileBlocked()) {
            await confirmCurrentProfileBlockedSpaceFeedEntries()
        }

        if(completed && closeAfterSuccess) {
            button.innerText = 'Closing...'
            await new Promise(resolve => requestAnimationFrame(resolve))

            const closed = await requestCloseTab()
            if(closed) return
        }

        if(!completed && !isProfileBlocked()) {
            button.innerText = originalText

            if(closeBtn) {
                closeBtn.disabled = false
                closeBtn.innerText = originalCloseText
            }

            if(muteBtn) {
                muteBtn.disabled = false
                muteBtn.innerText = originalMuteText || 'Mute Block'
            }

            if(muteCloseBtn) {
                muteCloseBtn.disabled = false
                muteCloseBtn.innerText = originalMuteCloseText || 'Mute Block Close'
            }
        }
    }
    finally {
        profileActionInProgress = false

        if(!isProfileBlocked()) {
            ensureProfileButtons()
        }
        else if(closeBtn && document.body.contains(closeBtn)) {
            closeBtn.disabled = false
            if(closeBtn.innerText === 'Please wait...') {
                closeBtn.innerText = originalCloseText || 'Close tab'
            }
        }
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

function getLikelyQuoraProfileSlug(pathname) {
    const parts = `${pathname || ''}`.split('/').filter(Boolean)
    if(!parts.length) return ''

    const firstPart = `${parts[0] || ''}`
    if(firstPart.toLowerCase() === 'profile') {
        return parts.length >= 2 ? `${parts[1] || ''}` : ''
    }

    if(parts.length !== 1 || QUORA_NON_PROFILE_ROOT_PATHS.has(firstPart.toLowerCase())) return ''
    if(!/-/.test(firstPart)) return ''

    const decodedSlug = sanitizeProfileHrefSlug(decodeURIComponent(firstPart))
    if(!decodedSlug) return ''
    if(!isLikelyDirectProfileSlug(decodedSlug)) return ''

    return firstPart
}

function isLikelyDirectProfileSlug(slug) {
    const value = `${slug || ''}`.trim()
    if(!value) return false
    if(/[\/\\?#]/.test(value)) return false

    const tokens = value.split('-').filter(Boolean)
    if(tokens.length < 2) return false

    const isNameishToken = token => /^[A-Z][A-Za-z0-9]*$/.test(token) || /^[A-Z0-9]{2,}$/.test(token)

    if(tokens.some(token => /^\d+$/.test(token))) return true
    if(tokens.some(token => /^[A-F0-9]{2}$/i.test(token))) return true

    if(/^(?:a|an|are|can|could|did|do|does|how|is|should|the|what|when|where|who|why|will|would)$/i.test(tokens[0] || '')) {
        // Allow compact title-case handles like "The-Studious-Contemplator" while
        // still rejecting typical question slugs that start with stopwords.
        if(/^the$/i.test(tokens[0]) && tokens.length >= 3 && tokens.every(isNameishToken)) {
            return true
        }

        return false
    }

    let nameishTokenCount = 0
    for(const token of tokens) {
        if(isNameishToken(token)) {
            nameishTokenCount += 1
        }
    }

    return nameishTokenCount >= 2
}

function normalizeQuoraProfileHref(href) {
    if(!href) return null

    try {
        const url = new URL(href, location.origin)
        const hostname = `${url.hostname || ''}`.toLowerCase()
        const isPrimaryQuoraHost = hostname === 'quora.com' || hostname === 'www.quora.com'
        const isQuoraSubdomain = hostname.endsWith('.quora.com')
        if(hostname && !isPrimaryQuoraHost && !isQuoraSubdomain) {
            return null
        }

        url.search = ''
        url.hash = ''
        const pathParts = url.pathname.split('/').filter(Boolean)
        if(isQuoraSubdomain && !isPrimaryQuoraHost && pathParts[0]?.toLowerCase() !== 'profile') {
            return null
        }

        const slug = getLikelyQuoraProfileSlug(url.pathname)
        if(!slug) return null

        const decodedSlug = sanitizeProfileHrefSlug(decodeURIComponent(slug))
        if(!decodedSlug) return null
        if(/[\/\\?#]/.test(decodedSlug)) return null
        if(/[\u0000-\u001F\u007F]/.test(decodedSlug)) return null

        return `https://www.quora.com/profile/${encodeURIComponent(decodedSlug)}`
    }
    catch {
        return null
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

function sanitizeProfileHrefSlug(slug) {
    let value = `${slug || ''}`.normalize('NFKC').replace(/[?#].*$/g, '').trim()
    if(!value) return ''

    const cutPatterns = [
        /-amp-(?:ch|oid|share|srid|target|targ|target-type|type)/i,
        /-(?:ch|oid|share|srid|target|target_type|type)-/i,
        /-(?:followers?|following|log)-/i,
        /-https?$/i,
        /-https?-/i,
        /-(?:followers?|following|log)$/i
    ]

    let cutIndex = -1
    for(const pattern of cutPatterns) {
        const match = pattern.exec(value)
        if(!match) continue
        if(cutIndex === -1 || match.index < cutIndex) {
            cutIndex = match.index
        }
    }

    if(cutIndex >= 0) {
        value = value.slice(0, cutIndex)
    }

    value = stripDescriptiveProfileSuffix(value)
    value = stripTrailingProfileArtifactToken(value)
    return value.replace(/[-_\s]+$/g, '').trim()
}

function stripDescriptiveProfileSuffix(value) {
    const tokens = `${value || ''}`.split('-').filter(Boolean)
    if(tokens.length < 2) return `${value || ''}`

    const descriptiveWords = new Set([
        'a', 'about', 'again', 'and', 'asking', 'bio', 'comment', 'comments',
        'details', 'for', 'from', 'he', 'her', 'hers', 'his', 'lets', 'made',
        'my', 'of', 'par', 'peoples', 'question', 'quora', 'see', 'she',
        'some', 'that', 'the', 'their', 'this', 'those', 'try', 'weird'
    ])
    const isDescriptiveToken = token => {
        const normalized = `${token || ''}`.toLowerCase()
        return descriptiveWords.has(normalized) || /^[a-z]{1,3}$/.test(normalized)
    }
    const suffixLooksDescriptive = suffixTokens => {
        if(!suffixTokens.length) return false
        if(suffixTokens.length >= 2 && suffixTokens.some(isDescriptiveToken)) return true

        const first = `${suffixTokens[0] || ''}`.toLowerCase()
        return ['bio', 'details', 'quora'].includes(first)
    }

    let anchorIndex = tokens.findIndex((token, index) => index > 0 && /^\d+$/.test(token))
    if(anchorIndex >= 0 && suffixLooksDescriptive(tokens.slice(anchorIndex + 1))) {
        return tokens.slice(0, anchorIndex + 1).join('-')
    }

    anchorIndex = tokens.findIndex((token, index) => /\d+$/.test(token) && index < tokens.length - 1)
    if(anchorIndex >= 0 && suffixLooksDescriptive(tokens.slice(anchorIndex + 1))) {
        return tokens.slice(0, anchorIndex + 1).join('-')
    }

    return `${value || ''}`
}

function stripTrailingProfileArtifactToken(value) {
    const tokens = `${value || ''}`.split('-').filter(Boolean)
    if(tokens.length < 2) return `${value || ''}`

    const lastToken = `${tokens[tokens.length - 1] || ''}`.toLowerCase()
    const previousToken = `${tokens[tokens.length - 2] || ''}`.toLowerCase()

    if(lastToken === 'ch') {
        if(!/^\d+$/.test(previousToken)) return `${value || ''}`
        tokens.pop()
        return tokens.join('-')
    }

    if(['oid', 'share', 'srid', 'target', 'target_type', 'type'].includes(lastToken)) {
        tokens.pop()
        return tokens.join('-')
    }

    if(['answers', 'posts', 'questions'].includes(lastToken) && tokens.length >= 3) {
        tokens.pop()
        return tokens.join('-')
    }

    return `${value || ''}`
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
        console.error(summary)
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
        if(!href || seen.has(href)) continue

        seen.add(href)
        urls.push(href)
    }

    return urls
}

function isTruncatedQuoraProfileTextUrl(href) {
    return /\/profile\/[^/\s<>"'`)\]]*(?:\.{3,}|…)/i.test(`${href || ''}`)
}

function getProfileUrlsFromSpacePostHref(href) {
    const normalizedPostHref = normalizeQuoraPostHref(href)
    if(!normalizedPostHref) return []

    const urls = []
    const seen = new Set()
    const addSlug = slug => {
        const cleanSlug = sanitizeProfileHrefSlug(slug)
        if(!cleanSlug) return

        const profileHref = normalizeQuoraProfileHref(`https://www.quora.com/profile/${encodeURIComponent(cleanSlug)}`)
        if(!profileHref || seen.has(profileHref)) return

        seen.add(profileHref)
        urls.push(profileHref)
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
        return urls
    }

    return urls
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
        /"asker":\{[\s\S]{0,4000}?"profileUrl":"(\/profile\/[^"?#]+)(?:[?#][^"]*)?"/
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
                const href = normalizeQuoraProfileHref(data?.data?.contentObject?.asker?.profileUrl)
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
            const currentUrls = liveUrls.length ? liveUrls : getSpacePostNukeUrls(btn)
            if(!currentUrls.length) return

            await animateNukeButtonPress(btn)
            btn.disabled = true
            setNukeButtonWorking(btn)

            try {
                const result = await safeSendRuntimeMessage({
                    action: 'enqueue-tabs',
                    urls: currentUrls,
                    tabAction: 'nuke',
                    maxConcurrent: getProfilesPerBatch()
                }, {queued: 0})

                if((result?.queued || 0) > 0) {
                    await waitForOwnedNukeTabsToDrain(btn)
                }
                else {
                    const sweep = await sweepBlockedProfileTabs()
                    if(sweep.owned > 0) {
                        await waitForOwnedNukeTabsToDrain(btn)
                    }
                    else {
                        setNukeButtonIdle(btn)
                        alert('Nothing was queued')
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
    if(!header) return null

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

function getSpaceFeedTopButtonHost() {
    const bar = getSpaceFeedBar()
    if(!bar) return null

    let host = bar.querySelector(':scope > .mb-ext_space-feed-nuke-host')
    if(host) return host

    host = document.createElement('div')
    host.className = 'mb-ext_space-feed-nuke-host'
    bar.appendChild(host)
    return host
}

function getSpaceFeedStatusHost() {
    const bar = getSpaceFeedBar()
    if(!bar) return null

    let host = bar.querySelector(':scope > .mb-ext_space-feed-status-host')
    if(host) return host

    host = document.createElement('div')
    host.className = 'mb-ext_space-feed-status-host'
    bar.appendChild(host)
    return host
}

function syncSpaceFeedTopBarLayout() {
    const bar = getSpaceFeedBar()
    if(!bar) return false

    const nukeButton = bar.querySelector('.mb-ext_space-feed-nuke-btn')
    const statusButton = bar.querySelector('.mb-ext_space-feed-status-btn')
    const nukeHost = bar.querySelector('.mb-ext_space-feed-nuke-host')
    const statusHost = bar.querySelector('.mb-ext_space-feed-status-host')
    if(!nukeHost || !statusHost) return false

    const nukeWidth = Math.ceil(nukeButton?.getBoundingClientRect?.().width || 0)
    const statusWidth = Math.ceil(statusButton?.getBoundingClientRect?.().width || 0)
    const gap = nukeWidth && statusWidth ? 12 : 0

    statusHost.style.right = `${nukeWidth + gap}px`
    bar.style.paddingRight = `${Math.max(360, nukeWidth + statusWidth + gap + 24)}px`
    return true
}

function getSpaceFeedContentRoot() {
    return document.querySelector('main, [role="main"], #mainContent') || document.body
}

function getVisibleSpaceFeedTimestamps() {
    const timestamps = Array.from(document.querySelectorAll('a.post_timestamp'))

    timestamps.sort((left, right) => {
        const leftRect = left.getBoundingClientRect()
        const rightRect = right.getBoundingClientRect()
        return leftRect.top - rightRect.top || leftRect.left - rightRect.left
    })

    return timestamps
}

function isSpaceFeedRootCandidate(node, timestamp) {
    if(!node || node.nodeType !== Node.ELEMENT_NODE) return false

    const timestamps = Array.from(node.querySelectorAll('a.post_timestamp'))
    return timestamps.length === 1 && timestamps[0] === timestamp
}

function getSpaceFeedPreferredRoot(timestamp) {
    if(!timestamp) return null

    return timestamp.closest(
        '.q-box.qu-borderAll.qu-borderColor--raised.qu-boxShadow--small.qu-mb--small.qu-bg--raised,' +
        '.puppeteer_test_tribe_post_item_feed_story,' +
        '.dom_annotate_multifeed_bundle_TribeContentBundle,' +
        'article,' +
        '[role="article"]'
    )
}

function getSpaceFeedCardRoots() {
    const root = getSpaceFeedContentRoot()
    if(!root) return []

    const roots = []
    const seen = new Set()

    for(const timestamp of getVisibleSpaceFeedTimestamps()) {
        let matched = getSpaceFeedPreferredRoot(timestamp)
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

        if(matched && !seen.has(matched)) {
            seen.add(matched)
            roots.push(matched)
        }
    }

    return roots
}

function getSpaceFeedPostRoot(timestamp) {
    if(!timestamp) return null

    return getSpaceFeedCardRoots().find(root => root.querySelector('a.post_timestamp') === timestamp) || null
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
        return posterProfileUrls
    }

    const urls = []
    const seen = new Set()
    const addUrl = href => {
        if(!href || href === headerProfileHref || seen.has(href)) return

        seen.add(href)
        urls.push(href)
    }

    if(isAssetSpacePage()) {
        for(const href of [
            ...sharedPosterUrls,
            ...getSpaceFeedEmbeddedPosterProfileUrls(postRoot)
        ]) {
            addUrl(href)
        }
    }

    for(const scope of getSpaceFeedPostContentScopes(postRoot)) {
        for(const link of getQuoraProfileLinks(scope)) {
            if(!isSpaceFeedCandidateProfileLink(link, postRoot)) continue

            const href = normalizeQuoraProfileHref(link.href)
            if(!href) continue
            addUrl(href)
        }
    }

    const fallbackUrls = [
        ...getSpaceFeedPostContentScopes(postRoot).flatMap(scope => getProfileUrlsFromText(getElementText(scope)))
    ]

    for(const href of fallbackUrls) {
        addUrl(href)
    }

    if(!urls.length && isAssetSpacePage()) {
        for(const href of getProfileUrlsFromSpacePostHref(timestamp?.href || '')) {
            addUrl(href)
        }
    }

    if(!urls.length) {
        const titleAnchor = postRoot.querySelector('.qu-fontWeight--bold a[href], a.post_timestamp')
        const titleNameCandidate = getTrailingTitleNameCandidate(getElementText(titleAnchor) || getElementText(postRoot))

        for(const href of getNearbyProfileUrlsForName(postRoot, titleNameCandidate, headerProfileHref)) {
            addUrl(href)
        }
    }

    return urls
}

function isSpaceFeedPostNuked(postKey) {
    return !!(postKey && spaceNukedPosts?.[postKey])
}

function isSpaceFeedPostNuking(postKey) {
    return !!(postKey && spaceFeedNukingPostKeys.has(postKey))
}

function isSpaceFeedPostPending(postKey) {
    if(!postKey) return false

    const record = spacePendingNukedPosts?.[postKey]
    if(!record) return false

    const remainingUrls = Array.isArray(record.remainingUrls)
        ? record.remainingUrls
        : Array.isArray(record.allUrls)
            ? record.allUrls
            : Array.isArray(record.urls)
                ? record.urls
                : []

    return remainingUrls.length > 0
}

function isSpaceFeedPostBusy(postKey) {
    return isSpaceFeedPostNuking(postKey) || isSpaceFeedPostPending(postKey)
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

function getPendingSpaceFeedUrlSet(postKey) {
    const record = postKey ? spacePendingNukedPosts?.[postKey] : null
    return new Set(getStoredSpaceFeedRecordUrls(record, 'remainingUrls'))
}

function isSuccessfulProfileNukeRecord(record) {
    return !!record && (
        !!record.blockSucceeded ||
        record.status === 'blocked' ||
        record.status === 'already-blocked'
    )
}

function isProfileNukeSucceeded(href) {
    return isSuccessfulProfileNukeRecord(getProfileNukeProgressRecord(href))
}

function getSucceededSpaceFeedEntryUrls(entry) {
    return getNormalizedProfileHrefList(entry?.candidateUrls || []).filter(url => isProfileNukeSucceeded(url))
}

function isSpaceFeedPostEffectivelyNuked(entry) {
    const urls = getNormalizedProfileHrefList(entry?.candidateUrls || [])
    return urls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES && urls.every(url => isProfileNukeSucceeded(url))
}

function getQueueableSpaceFeedEntryUrls(entry) {
    if(!entry?.postKey || isSpaceFeedPostNuked(entry.postKey)) return []

    const pendingUrls = getPendingSpaceFeedUrlSet(entry.postKey)
    return getNormalizedProfileHrefList(entry.candidateUrls || []).filter(url => !pendingUrls.has(url) && !isProfileNukeSucceeded(url))
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

        const rect = node.getBoundingClientRect()
        const currentRect = anchorContainer.getBoundingClientRect()
        const isMeaningfullyWider = rect.width >= currentRect.width + 24
        const isReasonableHeight = rect.height <= currentRect.height * 1.75
        const isNotTooWide = rect.width <= postRoot.getBoundingClientRect().width * 1.5

        if(isMeaningfullyWider && isReasonableHeight && isNotTooWide) {
            anchorContainer = node
        }

        if(node === main) break
        node = node.parentElement
    }

    return anchorContainer
}

function getSpaceFeedPostButtonHost(postRoot, postKey = '') {
    if(!postRoot) return null

    const timestamp = postRoot.querySelector('a.post_timestamp')
    const headerContainer = timestamp?.closest('.q-flex.qu-alignItems--flex-start, .q-flex') || null
    const parent = getSpaceFeedPostAnchorContainer(postRoot) || postRoot

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

function getSpaceFeedPostEntries() {
    const entries = []
    const roots = getSpaceFeedCardRoots()
    const contentRoot = getSpaceFeedContentRoot()

    for(const postRoot of roots) {
        const timestamp = postRoot.querySelector('a.post_timestamp')
        if(!timestamp) continue

        const postKey = getSpaceFeedPostKey(postRoot, timestamp)
        if(!postKey) continue

        let candidateUrls = getSpaceFeedPostCandidateProfileUrls(postRoot, timestamp)
        let node = postRoot.parentElement

        while(!candidateUrls.length && node && node !== contentRoot) {
            if(isSpaceFeedRootCandidate(node, timestamp)) {
                candidateUrls = getSpaceFeedPostCandidateProfileUrls(node, timestamp)
            }

            node = node.parentElement
        }

        entries.push({
            postKey,
            postRoot,
            postUrl: getSpaceFeedPostUrl(timestamp),
            candidateUrls
        })
    }

    return entries
}

function setLatestSpaceFeedEntries(entries) {
    latestSpaceFeedEntries = (Array.isArray(entries) ? entries : []).map(entry => ({
        postKey: entry?.postKey || '',
        postUrl: entry?.postUrl || '',
        candidateUrls: getNormalizedProfileHrefList(entry?.candidateUrls || []),
        viewportTop: entry?.postRoot?.getBoundingClientRect?.().top ?? null,
        viewportBottom: entry?.postRoot?.getBoundingClientRect?.().bottom ?? null
    })).filter(entry => !!entry.postKey)
}

function getLatestSpaceFeedEntries() {
    return latestSpaceFeedEntries.map(entry => ({
        postKey: entry.postKey,
        postUrl: entry.postUrl,
        candidateUrls: [...entry.candidateUrls],
        viewportTop: entry.viewportTop,
        viewportBottom: entry.viewportBottom
    }))
}

function getSpaceFeedDetectionSnapshot(entries = null) {
    const space = resolveCurrentSpaceDescriptor()
    const category = getStoredSpaceCategory(space) || 'unset'
    const timestamps = getVisibleSpaceFeedTimestamps()
    const documentTimestamps = document.querySelectorAll('a.post_timestamp').length
    const documentProfiles = document.querySelectorAll('a[href*="/profile/"]').length
    const cards = getSpaceFeedCardRoots()
    const nextEntries = Array.isArray(entries) ? entries : getSpaceFeedPostEntries()
    const actionableEntries = nextEntries.filter(entry => entry.candidateUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES)
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

function formatSpaceFeedStatusDetails(snapshot) {
    const lines = [
        'report_format: detailed-v2',
        `report_generated_at: ${new Date().toISOString()}`,
        '',
        formatSpaceFeedStatusSummary(snapshot)
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
            lines.push(`${prefix}_found_blocked_before_queue: ${!!record.foundBlockedBeforeQueue}`)
            lines.push(`${prefix}_tab_opened: ${!!record.tabOpenedAt}`)
            lines.push(`${prefix}_opened_viable_page: ${!!record.openedViablePage}`)
            lines.push(`${prefix}_mute_attempted: ${!!record.muteAttempted}`)
            lines.push(`${prefix}_mute_succeeded: ${!!record.muteSucceeded}`)
            lines.push(`${prefix}_block_attempted: ${!!record.blockAttempted}`)
            lines.push(`${prefix}_block_succeeded: ${!!record.blockSucceeded}`)
            lines.push(`${prefix}_closed: ${!!record.tabClosedAt}`)

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
            lines.push(`${prefix}_security_verification: ${!!record.securityVerification}`)

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
    report.textarea.select()
}

function syncSpaceFeedStatusButton(entries = null) {
    if(getPageType() !== 'space') return false

    const host = getSpaceFeedStatusHost()
    if(!host) return false

    const snapshot = getSpaceFeedDetectionSnapshot(entries)
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

    button.textContent = formatSpaceFeedStatusLabel(snapshot)
    setMuteBlockHelp(button, 'Open the full candidate/progress report for this space page')
    return true
}

async function markSpaceFeedPostsNuked(space, entries) {
    if(!space?.key || !Array.isArray(entries) || !entries.length) return

    let changed = false
    const nextRecords = {
        ...spaceNukedPosts
    }

    for(const entry of entries) {
        if(!entry?.postKey) continue

        nextRecords[entry.postKey] = {
            ...(spaceNukedPosts?.[entry.postKey] || {}),
            postKey: entry.postKey,
            postUrl: entry.postUrl || spaceNukedPosts?.[entry.postKey]?.postUrl || '',
            spaceKey: space.key,
            spaceUrl: space.url,
            urls: Array.from(new Set(entry.candidateUrls || [])),
            updatedAt: Date.now()
        }
        changed = true
    }

    if(!changed) return

    spaceNukedPosts = pruneRememberedSpaceNukes(nextRecords)
    syncSpaceFeedNukeControls()
    await safeStorageSet({[SPACE_NUKED_POSTS_KEY]: spaceNukedPosts})
}

async function registerPendingSpaceFeedEntries(space, entries) {
    if(!space?.key || !Array.isArray(entries) || !entries.length) return

    let changed = false
    const nextRecords = {
        ...spacePendingNukedPosts
    }

    for(const entry of entries) {
        if(!entry?.postKey) continue

        const entryUrls = getNormalizedProfileHrefList(entry.candidateUrls || [])
        if(!entryUrls.length) continue

        const existing = nextRecords[entry.postKey] || {}
        const existingAllUrls = getStoredSpaceFeedRecordUrls(existing, 'allUrls')
        const existingRemainingUrls = getStoredSpaceFeedRecordUrls(existing, 'remainingUrls')
        const allUrls = getNormalizedProfileHrefList([...existingAllUrls, ...entryUrls])
        const remainingUrls = getNormalizedProfileHrefList([...existingRemainingUrls, ...entryUrls])

        nextRecords[entry.postKey] = {
            ...existing,
            postKey: entry.postKey,
            postUrl: entry.postUrl || existing.postUrl || '',
            spaceKey: space.key,
            spaceUrl: space.url,
            allUrls,
            remainingUrls,
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

    let changed = false
    const nextRecords = {
        ...spacePendingNukedPosts
    }

    for(const [postKey, record] of Object.entries(spacePendingNukedPosts || {})) {
        const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
        const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
        const nextAllUrls = allUrls.filter(url => !normalizedUrls.has(normalizeQuoraProfileHref(url)))
        const nextRemainingUrls = remainingUrls.filter(url => !normalizedUrls.has(normalizeQuoraProfileHref(url)))

        if(nextAllUrls.length === allUrls.length && nextRemainingUrls.length === remainingUrls.length) {
            continue
        }

        changed = true

        if(nextRemainingUrls.length <= 0) {
            delete nextRecords[postKey]
            continue
        }

        nextRecords[postKey] = {
            ...record,
            allUrls: nextAllUrls,
            remainingUrls: nextRemainingUrls,
            updatedAt: Date.now()
        }
    }

    if(!changed) return

    spacePendingNukedPosts = nextRecords
    await safeStorageSet({[SPACE_PENDING_NUKED_POSTS_KEY]: nextRecords})
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

async function confirmSpaceFeedProfileBlocked(profileHref) {
    const confirmedHref = normalizeQuoraProfileHref(profileHref)
    if(!confirmedHref) return false

    let changedPending = false
    let changedNuked = false
    const nextPending = {
        ...spacePendingNukedPosts
    }
    const nextNuked = {
        ...spaceNukedPosts
    }

    for(const [postKey, record] of Object.entries(spacePendingNukedPosts || {})) {
        const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
        const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
        if(!remainingUrls.includes(confirmedHref)) continue

        const nextRemainingUrls = remainingUrls.filter(url => url !== confirmedHref)
        changedPending = true

        if(nextRemainingUrls.length > 0) {
            nextPending[postKey] = {
                ...record,
                remainingUrls: nextRemainingUrls,
                updatedAt: Date.now()
            }
            continue
        }

        delete nextPending[postKey]
        nextNuked[postKey] = {
            ...(spaceNukedPosts?.[postKey] || {}),
            postKey,
            postUrl: record.postUrl || spaceNukedPosts?.[postKey]?.postUrl || '',
            spaceKey: record.spaceKey || spaceNukedPosts?.[postKey]?.spaceKey || '',
            spaceUrl: record.spaceUrl || spaceNukedPosts?.[postKey]?.spaceUrl || '',
            urls: getNormalizedProfileHrefList(allUrls.length ? allUrls : remainingUrls),
            updatedAt: Date.now()
        }
        changedNuked = true
    }

    if(!changedPending && !changedNuked) return false

    spacePendingNukedPosts = nextPending
    if(changedNuked) {
        spaceNukedPosts = pruneRememberedSpaceNukes(nextNuked)
    }

    const payload = {
        [SPACE_PENDING_NUKED_POSTS_KEY]: nextPending
    }

    if(changedNuked) {
        payload[SPACE_NUKED_POSTS_KEY] = spaceNukedPosts
    }

    await safeStorageSet(payload)
    return true
}

async function confirmCurrentProfileBlockedSpaceFeedEntries(profileHref = '') {
    if(getPageType() !== 'profile') return false

    let confirmed = false
    for(const href of getResolvedSpaceFeedProfileHrefs(profileHref)) {
        confirmed = (await confirmSpaceFeedProfileBlocked(href)) || confirmed
    }

    return confirmed
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
        const queueableUrls = getQueueableSpaceFeedEntryUrls(entry)
        const hasCandidates = queueableUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES
        const postBusy = isSpaceFeedPostBusy(entry.postKey)
        return hasCandidates || postBusy || isSpaceFeedPostNuked(entry.postKey)
    }).length
}

function getPendingSpaceFeedEntries(entries) {
    return entries.filter(entry => entry.candidateUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES && isSpaceFeedPostPending(entry.postKey))
}

function scheduleSpaceFeedProgressReconciliation(entries = null, delay = 80) {
    if(spaceFeedProgressReconcilePending && delay !== 0) return

    spaceFeedProgressReconcilePending = true
    clearTimeout(spaceFeedProgressReconcileTimeout)
    spaceFeedProgressReconcileTimeout = setTimeout(() => {
        void (async () => {
            try {
                const list = Array.isArray(entries) ? entries : getSpaceFeedPostEntries()
                const completedEntries = list.filter(entry => !isSpaceFeedPostNuked(entry.postKey) && isSpaceFeedPostEffectivelyNuked(entry))
                if(!completedEntries.length) return

                const succeededUrls = getDedupedSpaceFeedUrls(completedEntries.map(entry => ({
                    ...entry,
                    candidateUrls: getSucceededSpaceFeedEntryUrls(entry)
                })))

                if(succeededUrls.length) {
                    await removePendingSpaceFeedUrls(succeededUrls)
                }

                const space = resolveCurrentSpaceDescriptor()
                if(space) {
                    await markSpaceFeedPostsNuked(space, completedEntries.map(entry => ({
                        ...entry,
                        candidateUrls: getSucceededSpaceFeedEntryUrls(entry)
                    })))
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
    if(!entry?.postKey || isSpaceFeedPostNuked(entry.postKey)) return []

    const pendingUrls = Array.from(getPendingSpaceFeedUrlSet(entry.postKey))
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
        if(liveUrls.length < SPACE_FEED_POST_NUKE_MIN_PROFILES) return []

        return [{
            ...entry,
            candidateUrls: liveUrls
        }]
    })
}

function getQueueableSpaceFeedEntries(entries) {
    return entries.flatMap(entry => {
        const queueableUrls = getQueueableSpaceFeedEntryUrls(entry)
        if(queueableUrls.length < SPACE_FEED_POST_NUKE_MIN_PROFILES) return []

        return [{
            ...entry,
            candidateUrls: queueableUrls
        }]
    })
}

function getDedupedSpaceFeedUrls(entries) {
    const urls = []
    const seen = new Set()

    for(const entry of entries) {
        for(const url of entry.candidateUrls || []) {
            const normalized = normalizeQuoraProfileHref(url)
            if(!normalized || seen.has(normalized)) continue
            seen.add(normalized)
            urls.push(normalized)
        }
    }

    return urls
}

async function nukeSpaceFeedEntries(button, entries) {
    if(!button || !entries.length) return false

    const space = resolveCurrentSpaceDescriptor()
    const urls = getDedupedSpaceFeedUrls(entries)
    const postKeys = entries.map(entry => entry?.postKey).filter(Boolean)
    const postUrls = entries.map(entry => entry?.postUrl).filter(Boolean)
    if(!space) return false
    if(!urls.length) {
        alert('No candidate profiles were detected')
        return false
    }

    updateOwnedNukeStatusCache({
        ...ownedNukeStatusCache,
        queued: (Number.parseInt(ownedNukeStatusCache?.queued, 10) || 0) + urls.length,
        paused: false
    })
    button.dataset.mbQueueing = 'true'
    for(const entry of entries) {
        if(entry?.postKey) {
            spaceFeedNukingPostKeys.add(entry.postKey)
        }
    }
    await animateNukeButtonPress(button)
    setNukeButtonWorking(button, formatNukeProgressLabel('Queueing...', ownedNukeStatusCache))

    try {
        await recordProfileNukeProgressBatch(urls.map(url => ({
            profileHref: url,
            patch: buildQueuedProfileProgressPatch('Queued from space feed', {
                postKeys,
                postUrls
            })
        })))
        await registerPendingSpaceFeedEntries(space, entries)
        syncSpaceFeedNukeControls()
        setNukeButtonWorking(button, formatNukeProgressLabel('Nuking...', ownedNukeStatusCache))

        let launched = false
        const result = await safeSendRuntimeMessage({
            action: 'enqueue-tabs',
            urls,
            tabAction: 'nuke',
            maxConcurrent: getProfilesPerBatch()
        }, {queued: 0})

        if((result?.queued || 0) > 0) {
            launched = true
            syncSpaceFeedNukeControls()
            await waitForOwnedNukeTabsToDrain(button, 180000, 1000, {allowPause: true})
            return true
        }

        const sweep = await sweepBlockedProfileTabs()
        if(sweep.owned > 0) {
            launched = true
            syncSpaceFeedNukeControls()
            await waitForOwnedNukeTabsToDrain(button, 180000, 1000, {allowPause: true})
            return true
        }

        if(!launched) {
            await removePendingSpaceFeedUrls(urls)
        }
        setNukeButtonIdle(button)
        alert('Nothing was queued')
        return false
    }
    finally {
        delete button.dataset.mbQueueing
        for(const entry of entries) {
            if(entry?.postKey) {
                spaceFeedNukingPostKeys.delete(entry.postKey)
            }
        }
        updateOwnedNukeStatusCache(await getOwnedNukeStatus())
        syncSpaceFeedNukeControls()
        scheduleSpaceAssetNukeControls(0)
    }
}

async function pauseSpaceFeedQueue(button) {
    if(!button) return false

    const result = await safeSendRuntimeMessage({action: 'pause-owner-nukes'}, {canceledUrls: []})
    const canceledUrls = getNormalizedProfileHrefList(result?.canceledUrls || [])
    updateOwnedNukeStatusCache({
        ...ownedNukeStatusCache,
        queued: 0,
        paused: true
    })
    if(canceledUrls.length) {
        await removePendingSpaceFeedUrls(canceledUrls)
    }

    setNukeButtonIdle(button)
    scheduleSpaceAssetNukeControls(0)
    return canceledUrls.length > 0
}

function syncSpaceFeedTopNukeButton(entries) {
    const host = getSpaceFeedTopButtonHost()
    if(!host) return false

    const totalEntries = Array.isArray(entries) ? entries : []
    const actionableEntries = entries.filter(entry => entry.candidateUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES)
    const liveEntries = getLiveSpaceFeedEntries(totalEntries)
    const pendingEntries = getPendingSpaceFeedEntries(actionableEntries)
    const queueableEntries = getQueueableSpaceFeedEntries(actionableEntries)
    const busyEntries = actionableEntries.filter(entry => isSpaceFeedPostBusy(entry.postKey))
    const hasNukedEntries = totalEntries.some(entry => isSpaceFeedPostNuked(entry.postKey))
    const allActionableEntriesNuked = actionableEntries.length > 0 &&
        actionableEntries.every(entry => isSpaceFeedPostNuked(entry.postKey))
    const ownerPaused = ownedNukeStatusCache.paused
    const ownerRunning = hasOwnedNukeWorkInFlight()
    const shouldPromptScroll = !ownerRunning && !ownerPaused && !busyEntries.length && !queueableEntries.length && !liveEntries.length && totalEntries.length > 0 && !hasNukedEntries

    let button = host.querySelector('.mb-ext_space-feed-nuke-btn')
    if(!button) {
        button = document.createElement('button')
        button.type = 'button'
        button.className = 'mb-ext_nuke-profiles-btn mb-ext_space-feed-nuke-btn'
        setMuteBlockHelp(button, 'Queue detected profiles from visible posts in this space for mute and block')
        button.addEventListener('click', () => {
            if(button.dataset.mbNukeState === 'working' || hasOwnedNukeWorkInFlight()) {
                void pauseSpaceFeedQueue(button)
                return
            }

            const currentEntries = getLatestSpaceFeedEntries()
            const liveEntries = getLiveSpaceFeedEntries(currentEntries)
            if(!liveEntries.length) {
                if(currentEntries.some(entry => isSpaceFeedPostNuked(entry.postKey))) {
                    setNukeButtonDone(button)
                    return
                }

                setNukeButtonIdle(button)
                return
            }

            void nukeSpaceFeedEntries(button, liveEntries)
        })
        host.appendChild(button)
    }

    const queueSubmissionPending = button.dataset.mbQueueing === 'true'

    if(!totalEntries.length) {
        setSpaceFeedButtonUrls(button, [])
        setMuteBlockHelp(button, 'Scanning visible posts in this space for profiles to nuke')
        setNukeButtonIdle(button, 'Scanning...')
        button.disabled = true
        return true
    }

    setSpaceFeedButtonUrls(button, getDedupedSpaceFeedUrls(liveEntries))
    setMuteBlockHelp(button, shouldPromptScroll ? 'No visible targets. Scroll for more posts to scan.' : buildNukeTargetsHelpText('Queue detected profiles from visible posts in this space for mute and block', getSpaceFeedButtonUrls(button)))

    if(queueSubmissionPending && (busyEntries.length || queueableEntries.length || ownerRunning)) {
        setNukeButtonWorking(button, ownerRunning
            ? formatNukeProgressLabel('Nuking...', ownedNukeStatusCache)
            : 'Nuking...')
        button.disabled = false
    }
    else if(ownerRunning) {
        setNukeButtonWorking(button, formatNukeProgressLabel('Nuking...', ownedNukeStatusCache))
        button.disabled = false
    }
    else if(ownerPaused && busyEntries.length) {
        setNukeButtonIdle(button, formatNukeProgressLabel('Paused', ownedNukeStatusCache))
        button.disabled = false
    }
    else if(busyEntries.length || pendingEntries.length) {
        setNukeButtonWorking(button, formatNukeProgressLabel('Settling...', ownedNukeStatusCache))
        button.disabled = false
    }
    else if(shouldPromptScroll) {
        setNukeButtonIdle(button, 'Scroll for More')
        button.disabled = false
    }
    else if(queueableEntries.length) {
        setNukeButtonIdle(button)
        button.disabled = false
    }
    else if(allActionableEntriesNuked) {
        setNukeButtonDone(button)
        button.disabled = true
    }
    else {
        setNukeButtonIdle(button)
        button.disabled = false
    }

    return true
}

function syncSpaceFeedPostButtons(entries) {
    const activeKeys = new Set()

    for(const entry of entries) {
        const liveUrls = getLiveSpaceFeedEntryUrls(entry)
        const queueableUrls = getQueueableSpaceFeedEntryUrls(entry)
        const hasCandidates = queueableUrls.length >= SPACE_FEED_POST_NUKE_MIN_PROFILES
        const postBusy = isSpaceFeedPostBusy(entry.postKey)
        const ownerRunning = hasOwnedNukeWorkInFlight()
        const shouldShowButton = hasCandidates || postBusy || isSpaceFeedPostNuked(entry.postKey)
        if(!shouldShowButton) {
            delete entry.postRoot.dataset.mbSpaceFeedPostKey
            continue
        }

        const host = getSpaceFeedPostButtonHost(entry.postRoot, entry.postKey)
        if(!host) continue

        entry.postRoot.dataset.mbSpaceFeedPostKey = entry.postKey
        activeKeys.add(entry.postKey)

        let button = host.querySelector('.mb-ext_space-feed-post-nuke-btn')
        if(!button) {
            button = document.createElement('button')
            button.type = 'button'
            button.className = 'mb-ext_nuke-profiles-btn mb-ext_space-feed-post-nuke-btn'
            setMuteBlockHelp(button, 'Queue detected profiles from this post in this space for mute and block')
            button.addEventListener('click', () => {
                if(button.dataset.mbNukeState === 'working') {
                    void pauseSpaceFeedQueue(button)
                    return
                }

                const postKey = button.dataset.mbPostKey || ''
                if(!postKey || isSpaceFeedPostNuked(postKey)) {
                    setNukeButtonDone(button)
                    button.disabled = true
                    return
                }

                const liveEntry = getLatestSpaceFeedEntries().find(candidate => candidate.postKey === postKey)
                const liveUrls = getQueueableSpaceFeedEntryUrls(liveEntry)
                const urls = liveUrls.length ? liveUrls : getSpaceFeedButtonUrls(button)
                if(!urls.length) return

                void nukeSpaceFeedEntries(button, [{
                    postKey,
                    postUrl: liveEntry?.postUrl || button.dataset.mbPostUrl || '',
                    candidateUrls: urls
                }])
            })
            host.appendChild(button)
        }

        button.dataset.mbPostKey = entry.postKey
        button.dataset.mbPostUrl = entry.postUrl || ''
        setSpaceFeedButtonUrls(button, liveUrls)
        setMuteBlockHelp(button, buildNukeTargetsHelpText('Queue detected profiles from this post in this space for mute and block', getSpaceFeedButtonUrls(button)))

        if(isSpaceFeedPostNuked(entry.postKey)) {
            setNukeButtonDone(button)
            button.disabled = true
        }
        else {
            // Keep per-post buttons visually stable while background queue state churns.
            // The top-level button and MB Info carry queue progress; per-post buttons stay actionable.
            setNukeButtonIdle(button)
            button.disabled = false
        }
    }

    for(const host of Array.from(document.querySelectorAll('.mb-ext_space-feed-post-nuke-host'))) {
        const button = host.querySelector('.mb-ext_space-feed-post-nuke-btn')
        const postKey = button?.dataset.mbPostKey || host.dataset.mbPostHostKey || ''
        if(!button || !activeKeys.has(postKey) || postKey !== (host.dataset.mbPostHostKey || postKey)) {
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
        if(!activeKeys.has(root.dataset.mbSpaceFeedPostKey || '')) {
            delete root.dataset.mbSpaceFeedPostKey
        }
    }
}

function syncSpaceFeedNukeControls() {
    if(getPageType() !== 'space') {
        removeSpaceFeedNukeControls()
        return false
    }

    const entries = getSpaceFeedPostEntries()
    setLatestSpaceFeedEntries(entries)
    scheduleSpaceFeedProgressReconciliation(entries)
    const main = document.querySelector('#mainContent')
    if(main) {
        main.dataset.mbSpaceFeedTimestampCount = `${getVisibleSpaceFeedTimestamps().length}`
        main.dataset.mbSpaceFeedCardCount = `${getSpaceFeedCardRoots().length}`
        main.dataset.mbSpaceFeedEntryCount = `${entries.length}`
        main.dataset.mbSpaceFeedPostButtonCount = `${getExpectedSpaceFeedPostButtonCount(entries)}`
    }

    syncSpaceFeedStatusButton(entries)

    if(!isNukableSpacePage()) {
        removeSpaceFeedNukeButtons()
        return true
    }

    syncSpaceFeedTopNukeButton(entries)
    syncSpaceFeedTopBarLayout()
    syncSpaceFeedPostButtons(entries)
    return true
}

function injectModalOpenProfilesBtn() {
    const modal = syncActiveProfileModal(getProfilePeopleModal())
    if(!modal) return

    let items = getQueueableProfileModalItems(modal)
    if(!items.length) {
        modal.querySelector('.mb-ext_open-profiles-btn')?.remove()
        modal.querySelector('.mb-ext_nuke-profiles-btn')?.remove()
        return
    }

    let dismissBtn = modal.querySelector('button[aria-label="Dismiss"]')
    if(!dismissBtn?.parentElement) return

    let btn = modal.querySelector('.mb-ext_open-profiles-btn')
    if(!btn) {
        btn = document.createElement('button')
        btn.classList.add('mb-ext_open-profiles-btn')
        btn.addEventListener('click', () => openModalProfiles())
        dismissBtn.parentElement.insertAdjacentElement('beforeend', btn)
    }

    btn.innerHTML = `${getModalOpenProfilesLabel(modal)} <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
        <path d="M11 13l9 -9" />
        <path d="M15 4h5v5" />
    </svg>`
    btn.disabled = false
    setMuteBlockHelp(btn, 'Open listed profiles from this modal in background tabs')

    let nukeBtn = modal.querySelector('.mb-ext_nuke-profiles-btn')
    if(!nukeBtn) {
        nukeBtn = document.createElement('button')
        nukeBtn.innerText = `Nuke 'Em`
        nukeBtn.classList.add('mb-ext_nuke-profiles-btn')
        setMuteBlockHelp(nukeBtn, buildNukeTargetsHelpText('Queue listed profiles from this modal for mute and block', getModalProfileLinks(items)))
        nukeBtn.addEventListener('click', () => void nukeModalProfiles())
        dismissBtn.parentElement.insertAdjacentElement('beforeend', nukeBtn)
    }

    if(nukeBtn.dataset.mbNukeState !== 'working' && nukeBtn.dataset.mbNukeState !== 'done') {
        setNukeButtonIdle(nukeBtn)
    }
    setMuteBlockHelp(nukeBtn, buildNukeTargetsHelpText('Queue listed profiles from this modal for mute and block', getModalProfileLinks(items)))
    nukeBtn.disabled = false
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

    const listItems = getQueueableProfileModalItems(modal)

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

    let items = getQueueableProfileModalItems(modal)
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
        const maxConcurrent = getProfilesPerBatch()
        let idlePasses = 0

        while(idlePasses < 3) {
            items = getQueueableProfileModalItems(modal)

            if(items.length) {
                const urls = getModalProfileLinks(items)

                if(urls.length) {
                    await recordProfileNukeProgressBatch(urls.map(url => ({
                        profileHref: url,
                        patch: buildQueuedProfileProgressPatch('Queued from modal')
                    })))
                    const result = await safeSendRuntimeMessage({
                        action: 'enqueue-tabs',
                        urls,
                        tabAction: 'nuke',
                        maxConcurrent
                    }, {queued: 0})

                    if((result?.queued || 0) <= 0) {
                        const sweep = await sweepBlockedProfileTabs()
                        if(sweep.owned > 0) {
                            await waitForOwnedNukeTabsToDrain(buttons.nuke)
                            break
                        }

                        setNukeButtonDone(buttons.nuke, 'Rubble')
                        return
                    }

                    markModalItemsHandled(items, '#f8d7da')
                    items[items.length - 1].scrollIntoView({block: 'nearest'})
                    idlePasses = 0
                }
                else {
                    idlePasses += 1
                }
            }
            else {
                idlePasses += 1
            }

            if(idlePasses < 3) await sleep(1500)
        }

        await waitForOwnedNukeTabsToDrain(buttons.nuke)
    }
    finally {
        delete modal.dataset.mbNuking

        if(getUnhandledProfileModalItems(modal).length) {
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
    if(autoProfileActionPending) return

    if(autoProfileAction === undefined) {
        autoProfileActionAttempts += 1
        autoProfileAction = await safeSendRuntimeMessage({action: 'claim-tab-action'}, null)

        if(!autoProfileAction && autoProfileActionAttempts < 6) {
            autoProfileAction = undefined
            setTimeout(() => void maybeRunAutoProfileAction(), 500)
            return
        }
    }

    const claimedAction = typeof autoProfileAction === 'string'
        ? {action: autoProfileAction, targetUrl: ''}
        : autoProfileAction

    if(claimedAction?.action !== 'nuke') return

    autoProfileActionPending = true
    autoProfileAction = null
    autoProfileActionAttempts = 0

    const queuedProfileHref = normalizeQuoraProfileHref(claimedAction?.targetUrl || '') || normalizeQuoraProfileHref(location.href) || ''
    const recordQueuedProfileProgress = patch => {
        const resolvedProfileHref = getPageType() === 'profile'
            ? normalizeQuoraProfileHref(location.href)
            : ''
        const remappedFromRequested = !!(queuedProfileHref && resolvedProfileHref && queuedProfileHref !== resolvedProfileHref)
        const sharedPatch = {
            lastUrl: location.href,
            resolvedProfileHref: resolvedProfileHref || '',
            remappedFromRequested,
            pageType: getPageType() || 'unknown',
            securityVerification: isSecurityVerificationPage(),
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
            openedViablePage: false,
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
        const closeQueuedBlockedTab = async () => {
            await recordQueuedProfileProgress({
                status: 'blocked',
                blockSucceeded: true,
                blockedAt: Date.now(),
                finalError: '',
                event: 'Profile confirmed blocked'
            })
            await releaseQueuedTabSlot()
            await requestCloseTab()
        }
        const skipQueuedUnavailableTab = async message => {
            console.warn(message)
            await recordQueuedProfileProgress({
                status: 'profile-unavailable',
                openedViablePage: false,
                finalError: message,
                unavailableReason: getProfileUnavailableReason() || message,
                event: message
            })
            await removePendingSpaceFeedUrls(getResolvedSpaceFeedProfileHrefs(queuedProfileHref || location.href))
            await releaseQueuedTabSlot()
            await requestCloseTab(2, 100, true)
        }
        const abandonQueuedTab = async message => {
            console.warn(message)
            await recordQueuedProfileProgress({
                status: 'error',
                openedViablePage: false,
                finalError: message,
                errorPageUrl: location.href,
                event: message
            })
            await failCurrentQueuedProfile(getResolvedSpaceFeedProfileHrefs(queuedProfileHref || location.href))
            await releaseQueuedTabSlot()
            await requestCloseTab(2, 100, true)
        }

        if(getPageType() !== 'profile') {
            await waitForCondition(() => getPageType() === 'profile' || !!getProfileUnavailableReason() || isSecurityVerificationPage(), 5000, 250)
        }

        if(getPageType() !== 'profile') {
            const pageType = getPageType() || 'unknown'
            const message = isSecurityVerificationPage()
                ? 'Queued tab landed on a security verification page'
                : `Queued tab did not land on a profile page (${pageType}: ${location.pathname})`
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
            await recordQueuedProfileProgress({
                status: 'already-blocked',
                openedViablePage: true,
                foundBlockedBeforeQueue: true,
                blockSucceeded: true,
                blockedAt: Date.now(),
                event: 'Profile was already blocked before actions'
            })
            await confirmCurrentProfileBlockedSpaceFeedEntries(queuedProfileHref)
            await closeQueuedBlockedTab()
            return
        }

        if(getProfileUnavailableReason()) {
            await skipQueuedUnavailableTab('Profile unavailable')
            return
        }

        let ready = await waitForCondition(() => isProfileBlocked() || !!getProfileMenuButton() || !!getProfileUnavailableReason(), 25000, 250)
        if(!ready && document.visibilityState !== 'visible') {
            await recordQueuedProfileProgress({
                event: 'Profile actions stalled in a background tab; requesting foreground fallback'
            })

            const promoted = await promoteCurrentQueuedTab('profile-actions-not-ready')
            if(promoted) {
                await recordQueuedProfileProgress({
                    event: 'Queued tab promoted to the foreground after hidden-tab stall'
                })
                ready = await waitForCondition(() => isProfileBlocked() || !!getProfileMenuButton() || !!getProfileUnavailableReason(), 15000, 250)
            }
        }

        if(!ready) {
            logProfileActionDebug('Profile actions not ready')
            await abandonQueuedTab('Profile actions not ready')
            return
        }

        if(getProfileUnavailableReason()) {
            await skipQueuedUnavailableTab('Profile unavailable')
            return
        }

        if(isProfileBlocked()) {
            await recordQueuedProfileProgress({
                status: 'already-blocked',
                openedViablePage: true,
                foundBlockedBeforeQueue: true,
                blockSucceeded: true,
                blockedAt: Date.now(),
                event: 'Profile reached blocked state before mute/block actions'
            })
            await confirmCurrentProfileBlockedSpaceFeedEntries(queuedProfileHref)
            await closeQueuedBlockedTab()
            return
        }

        await recordQueuedProfileProgress({
            status: 'page-ready',
            openedViablePage: true,
            actionReadyAt: Date.now(),
            event: 'Profile actions became available'
        })

        if(!isProfileBlocked()) {
            const completed = await muteProfile({allowBlockFallback: true, silent: true})
            if(!completed && !isProfileBlocked()) {
                if(getProfileUnavailableReason()) {
                    await skipQueuedUnavailableTab('Profile unavailable')
                    return
                }

                await abandonQueuedTab('Queued profile action did not complete')
                return
            }
        }

        if(isProfileBlocked()) {
            await confirmCurrentProfileBlockedSpaceFeedEntries(queuedProfileHref)
            await closeQueuedBlockedTab()
            return
        }

        const blocked = await waitForCondition(() => isProfileBlocked(), 2500, 250)
        if(blocked || isProfileBlocked()) {
            await confirmCurrentProfileBlockedSpaceFeedEntries(queuedProfileHref)
            await closeQueuedBlockedTab()
        }
        else {
            await abandonQueuedTab('Queued profile never reached blocked state')
        }
    }
    catch(error) {
        console.error(error)
        const message = `${error?.message || ''}`.trim() || 'Queued profile action failed unexpectedly'

        try {
            await recordQueuedProfileProgress({
                status: 'error',
                openedViablePage: false,
                finalError: message,
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
    }
}

function reportActionIssue(message, silent = false) {
    if(silent) return
    console.warn(message)
    if(getPageType() === 'profile') {
        logProfileActionDebug(message)
    }
    alert(message)
}

async function muteProfile(options = {}) {
    const {allowBlockFallback = false, silent = false} = options
    await recordCurrentProfileNukeProgress({
        status: 'muting',
        muteAttempted: true,
        muteAttemptedAt: Date.now(),
        event: 'Mute flow started'
    })

    const menuOpened = await ensureProfileMenuOpen(2500, silent)
    if(!menuOpened) {
        await recordCurrentProfileNukeProgress({
            muteSucceeded: false,
            muteError: 'Profile menu did not open',
            event: 'Mute flow fell back because the profile menu did not open'
        })
        return allowBlockFallback ? blockProfile({silent}) : false
    }

    await sleep(500)

    const muteState = await waitForMenuState(/\bmute\b/i, /\bunmute\b/i, 5000, 250)
    if(muteState?.state === 'inverse') {
        await recordCurrentProfileNukeProgress({
            muteSucceeded: true,
            mutedAt: Date.now(),
            event: 'Profile was already muted'
        })
        await closeProfileMenu()
    }
    else {
        let muteBtn = muteState?.button || getMenuAction(/\bmute\b/i)
        if(!muteBtn) {
            await recordCurrentProfileNukeProgress({
                muteSucceeded: false,
                muteError: 'Mute option not found',
                event: 'Mute option not found'
            })
            reportActionIssue('Mute option not found', silent)
            return allowBlockFallback ? blockProfile({silent}) : false
        }

        muteBtn.click()

        let confirmBtn = await waitForAction(() => getMuteConfirmAction(), 8000, 250)
        if(!confirmBtn) {
            await recordCurrentProfileNukeProgress({
                muteSucceeded: false,
                muteError: 'Confirm button not found',
                event: 'Mute confirm button not found'
            })
            reportActionIssue('Confirm button not found', silent)
            return allowBlockFallback ? blockProfile({silent}) : false
        }

        confirmBtn.click()

        let confirmClosed = await waitForCondition(() => !isMuteConfirmPending(), 2500, 250)
        if(!confirmClosed) {
            confirmBtn = getMuteConfirmAction()
            if(confirmBtn) confirmBtn.click()
            confirmClosed = await waitForCondition(() => !isMuteConfirmPending(), 6000, 250)
        }

        if(!confirmClosed) {
            await recordCurrentProfileNukeProgress({
                muteSucceeded: false,
                muteError: 'Mute confirm did not complete',
                event: 'Mute confirm did not complete'
            })
            reportActionIssue('Mute confirm did not complete', silent)
            return allowBlockFallback ? blockProfile({silent}) : false
        }

        const mutedApplied = await waitForProfileMenuState('inverse', /\bmute\b/i, /\bunmute\b/i, 8000, 500)
        if(!mutedApplied) {
            await recordCurrentProfileNukeProgress({
                muteSucceeded: false,
                muteError: 'Mute did not take effect',
                event: 'Mute did not take effect'
            })
            reportActionIssue('Mute did not take effect', silent)
            return allowBlockFallback ? blockProfile({silent}) : false
        }

        await recordCurrentProfileNukeProgress({
            muteSucceeded: true,
            mutedAt: Date.now(),
            finalError: '',
            event: 'Mute completed'
        })
        await sleep(300)
    }

    return blockProfile({silent})
}

async function blockProfile(options = {}) {
    const {silent = false} = options

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

    await recordCurrentProfileNukeProgress({
        status: 'blocking',
        blockAttempted: true,
        blockAttemptedAt: Date.now(),
        event: 'Block flow started'
    })

    const menuOpened = await ensureProfileMenuOpen(2500, silent)
    if(!menuOpened) {
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Profile menu did not open',
            event: 'Block flow failed because the profile menu did not open'
        })
        return false
    }

    await sleep(500)

    const blockState = await waitForMenuState(/\bblock\b/i, /\bunblock\b/i, 5000, 250)
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

    let blockOpt = blockState?.button || getMenuAction(/\bblock\b/i)
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
            event: 'Block option not found'
        })
        reportActionIssue('Block option not found', silent)
        return false
    }

    const initialMutationCount = profileBlockMutationCount
    blockOpt.click()

    const confirmState = await waitForAction(() => {
        const confirmButton = getBlockConfirmAction()
        if(confirmButton) return {type: 'confirm', button: confirmButton}
        if(profileBlockMutationCount > initialMutationCount || isProfileBlocked()) return {type: 'blocked'}
        if(getMenuAction(/\bunblock\b/i)) return {type: 'blocked'}
        return null
    }, 8000, 250)

    if(!confirmState) {
        const blockedAppliedEarly = await waitForProfileMenuState('inverse', /\bblock\b/i, /\bunblock\b/i, 1500, 200)
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
            event: 'Block confirm button not found'
        })
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
    blockBtn.click()

    const mutationSeen = await waitForCondition(() => profileBlockMutationCount > initialMutationCount, 5000, 250)
    if(mutationSeen) rememberProfileBlocked()

    let blockClosed = mutationSeen || await waitForCondition(() => !isBlockConfirmPending(), 2500, 250)
    if(!blockClosed) {
        blockBtn = getBlockConfirmAction()
        if(blockBtn) blockBtn.click()
        blockClosed = await waitForCondition(() => !isBlockConfirmPending(), 6000, 250)
    }

    if(!blockClosed && !isProfileBlocked()) {
        await recordCurrentProfileNukeProgress({
            blockSucceeded: false,
            blockError: 'Block confirm did not complete',
            event: 'Block confirm did not complete'
        })
        reportActionIssue('Block confirm did not complete', silent)
        return false
    }

    const blockedApplied = mutationSeen || await waitForCondition(() => isProfileBlocked(), 8000, 250)
    if(!blockedApplied) {
        const blockedViaMenu = await waitForProfileMenuState('inverse', /\bblock\b/i, /\bunblock\b/i, 6000, 500)
        if(!blockedViaMenu) {
            await recordCurrentProfileNukeProgress({
                blockSucceeded: false,
                blockError: 'Block did not take effect',
                event: 'Block did not take effect'
            })
            reportActionIssue('Block did not take effect', silent)
            return false
        }
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

    menu.click()
    return true
}

function isProfileMenuOpen() {
    const menuButton = getProfileMenuButton()
    if(menuButton?.getAttribute('aria-expanded') === 'true') return true

    return getOverlayRoots(false).some(root => {
        return root.matches('[role="menu"]') || root.querySelector?.('[role="menuitem"]')
    })
}

async function ensureProfileMenuOpen(timeoutMs = 2500, silent = false) {
    if(isProfileMenuOpen()) return true
    if(!toggleMenu(silent)) return false

    let opened = await waitForCondition(() => isProfileMenuOpen(), timeoutMs, 100)
    if(!opened && document.visibilityState !== 'visible') {
        const promoted = await promoteCurrentQueuedTab('profile-menu-not-open')
        if(promoted) {
            await sleep(300)
            if(!isProfileMenuOpen()) {
                toggleMenu(true)
            }
            opened = await waitForCondition(() => isProfileMenuOpen(), timeoutMs, 100)
        }
    }

    if(!opened) {
        reportActionIssue('Profile menu did not open', silent)
        return false
    }

    return true
}

async function closeProfileMenu(timeoutMs = 1500) {
    if(!isProfileMenuOpen()) return true
    if(!toggleMenu()) return false

    return waitForCondition(() => !isProfileMenuOpen(), timeoutMs, 100)
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}
