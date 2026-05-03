const browser = require('webextension-polyfill')
const defaults = require('./defaults')
const {
    normalizeQuoraProfileHref: normalizeQuoraProfileUrl,
    normalizeTabTargetUrl
} = require('./subject')
const pendingTabActions = new Map()
const queuedTabMetadata = new Map()
const queuedTabActions = []
const activeQueuedTabs = new Set()
const ownedTabIdsByParent = new Map()
const owningParentByChild = new Map()
const canceledQueuedUrlsByOwner = new Map()
const pausedQueuedOwners = new Set()
const OWNED_TAB_STATE_KEY = 'mbOwnedTabIdsByParent'
const PROFILE_NUKE_PROGRESS_KEY = 'mbProfileNukeProgress'
const MAX_PROFILE_NUKE_PROGRESS_ENTRIES = 1000
const STALE_ACTIVE_QUEUED_TAB_MS = 15000
const STALE_ACTIVE_ACTION_QUEUED_TAB_MS = 30000
const STALE_CLOSE_REQUESTED_QUEUED_TAB_MS = 8000
let persistOwnedTabIdsTimeout = null
let queuedTabConcurrency = 1
let profileNukeProgress = {}

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
        const normalizedHref = normalizeQuoraProfileUrl(value?.profileHref || key || '')
        if(!normalizedHref) continue

        nextRecords[normalizedHref] = mergeStoredProfileProgressRecord(
            nextRecords[normalizedHref] || null,
            value,
            normalizedHref
        )
    }

    return pruneProfileNukeProgress(nextRecords)
}

function normalizeProgressPatch(profileHref, patch = {}, existing = null) {
    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
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

    delete next.event
    return next
}

async function loadProfileNukeProgress() {
    try {
        const stored = await browser.storage.local.get({[PROFILE_NUKE_PROGRESS_KEY]: {}})
        const nextProgress = normalizeStoredProfileNukeProgress(stored?.[PROFILE_NUKE_PROGRESS_KEY] || {})
        profileNukeProgress = nextProgress
        if(JSON.stringify(nextProgress) !== JSON.stringify(stored?.[PROFILE_NUKE_PROGRESS_KEY] || {})) {
            await browser.storage.local.set({[PROFILE_NUKE_PROGRESS_KEY]: nextProgress})
        }
    }
    catch {
        profileNukeProgress = {}
    }
}

const profileNukeProgressReady = loadProfileNukeProgress()

async function persistProfileNukeProgress() {
    profileNukeProgress = pruneProfileNukeProgress(profileNukeProgress)

    try {
        await browser.storage.local.set({[PROFILE_NUKE_PROGRESS_KEY]: profileNukeProgress})
    }
    catch {}
}

async function recordProfileNukeProgress(profileHref, patch = {}) {
    await profileNukeProgressReady

    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    if(!normalizedHref) return null

    const nextRecord = normalizeProgressPatch(normalizedHref, patch)
    if(!nextRecord) return null

    profileNukeProgress = {
        ...profileNukeProgress,
        [normalizedHref]: nextRecord
    }
    await persistProfileNukeProgress()
    return nextRecord
}

async function recordProfileNukeProgressBatch(updates = []) {
    await profileNukeProgressReady

    let changed = false
    const nextProgress = {
        ...profileNukeProgress
    }

    for(const update of updates) {
        const normalizedHref = normalizeQuoraProfileUrl(update?.profileHref || update?.href || '')
        if(!normalizedHref) continue

        const nextRecord = normalizeProgressPatch(normalizedHref, update?.patch || {}, nextProgress[normalizedHref] || null)
        if(!nextRecord) continue

        nextProgress[normalizedHref] = nextRecord
        changed = true
    }

    if(!changed) return false

    profileNukeProgress = nextProgress
    await persistProfileNukeProgress()
    return true
}

function getQueuedTabMetadata(tabId) {
    return queuedTabMetadata.get(tabId) || null
}

function setQueuedTabMetadata(tabId, metadata = {}) {
    if(!tabId) return
    queuedTabMetadata.set(tabId, {
        ...(queuedTabMetadata.get(tabId) || {}),
        ...metadata,
        updatedAt: Date.now()
    })
}

function clearQueuedTabMetadata(tabId) {
    if(!tabId) return
    queuedTabMetadata.delete(tabId)
}

async function buildTabCreateOptions(action = {}) {
    const options = {
        url: normalizeTabTargetUrl(action.url),
        active: false
    }

    if(action.ownerWindowId) {
        options.windowId = action.ownerWindowId
    }
    if(action.ownerWindowId && action.ownerTabId && `${action.tabAction || ''}` !== 'nuke') {
        options.openerTabId = action.ownerTabId
    }

    return options
}

async function createOwnedTab(action = {}) {
    const options = await buildTabCreateOptions(action)

    try {
        return await browser.tabs.create(options)
    }
    catch(error) {
        if(!options.windowId && !options.openerTabId) throw error

        const fallbackOptions = {
            url: options.url,
            active: options.active
        }
        return browser.tabs.create(fallbackOptions)
    }
}

async function restoreOwnerTabFocus(metadata = null) {
    const ownerTabId = metadata?.ownerTabId || null
    if(!ownerTabId || !metadata?.foregroundPromotedAt) return false

    try {
        const ownerTab = await browser.tabs.get(ownerTabId)
        if(metadata?.ownerWindowId || ownerTab?.windowId) {
            try {
                await browser.windows.update(metadata.ownerWindowId || ownerTab.windowId, {focused: true})
            }
            catch {}
        }
        await browser.tabs.update(ownerTabId, {active: true})
        return true
    }
    catch {
        return false
    }
}

async function promoteQueuedTab(tabId, reason = '') {
    if(!tabId) return {promoted: false}

    const metadata = getQueuedTabMetadata(tabId)
    if(!metadata) return {promoted: false}

    try {
        const tab = await browser.tabs.get(tabId)
        if(metadata?.ownerWindowId || tab?.windowId) {
            try {
                await browser.windows.update(metadata.ownerWindowId || tab.windowId, {focused: true})
            }
            catch {}
        }
        await browser.tabs.update(tabId, {active: true})
        setQueuedTabMetadata(tabId, {
            foregroundPromotedAt: Date.now(),
            foregroundPromotionReason: `${reason || ''}`.trim()
        })
        if(metadata.profileHref) {
            await recordProfileNukeProgress(metadata.profileHref, {
                event: `Queued tab promoted to the foreground${reason ? ` (${reason})` : ''}`
            })
        }
        return {promoted: true}
    }
    catch {
        return {promoted: false}
    }
}

function markQueuedTabClosing(tabId, reason = '') {
    if(!tabId) return
    setQueuedTabMetadata(tabId, {
        closeRequestedAt: Date.now(),
        closeReason: `${reason || ''}`.trim()
    })
}

function getErrorPageUrl(url = '') {
    const value = `${url || ''}`.trim()
    if(!value) return ''

    if(/^(?:chrome|edge|about|moz-extension|chrome-error):/i.test(value)) return value

    try {
        const parsed = new URL(value)
        const hostname = `${parsed.hostname || ''}`.toLowerCase()
        if(parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return value
        if(hostname && hostname !== 'quora.com' && hostname !== 'www.quora.com' && !hostname.endsWith('.quora.com')) {
            return value
        }
    }
    catch {
        return value
    }

    return ''
}

function serializeOwnedTabIdsByParent() {
    const serialized = {}

    for(const [parentTabId, childTabIds] of ownedTabIdsByParent.entries()) {
        if(!childTabIds.size) continue
        serialized[parentTabId] = Array.from(childTabIds)
    }

    return serialized
}

function rebuildOwningParentByChild() {
    owningParentByChild.clear()

    for(const [parentTabId, childTabIds] of ownedTabIdsByParent.entries()) {
        for(const childTabId of childTabIds) {
            owningParentByChild.set(childTabId, Number(parentTabId))
        }
    }
}

async function persistOwnedTabIdsByParent() {
    try {
        await browser.storage.local.set({[OWNED_TAB_STATE_KEY]: serializeOwnedTabIdsByParent()})
    }
    catch {}
}

function schedulePersistOwnedTabIdsByParent(delayMs = 250) {
    clearTimeout(persistOwnedTabIdsTimeout)
    persistOwnedTabIdsTimeout = setTimeout(() => {
        persistOwnedTabIdsTimeout = null
        void persistOwnedTabIdsByParent()
    }, delayMs)
}

async function loadOwnedTabIdsByParent() {
    try {
        const stored = await browser.storage.local.get({[OWNED_TAB_STATE_KEY]: {}})
        const serialized = stored?.[OWNED_TAB_STATE_KEY] || {}

        ownedTabIdsByParent.clear()

        for(const [parentTabId, childTabIds] of Object.entries(serialized)) {
            const numericParentTabId = Number.parseInt(parentTabId, 10)
            if(!numericParentTabId || !Array.isArray(childTabIds) || !childTabIds.length) continue

            ownedTabIdsByParent.set(numericParentTabId, new Set(childTabIds.map(tabId => Number.parseInt(tabId, 10)).filter(Boolean)))
        }

        rebuildOwningParentByChild()
    }
    catch {}
}

const ownedTabIdsReady = loadOwnedTabIdsByParent()

function sendTabMessage(tabId, message) {
    return browser.tabs.sendMessage(tabId, message).catch(error => {
        if(/Receiving end does not exist/i.test(error?.message || '')) return
    })
}

function registerOwnedTab(parentTabId, childTabId) {
    if(!parentTabId || !childTabId) return

    let ownedTabIds = ownedTabIdsByParent.get(parentTabId)
    if(!ownedTabIds) {
        ownedTabIds = new Set()
        ownedTabIdsByParent.set(parentTabId, ownedTabIds)
    }

    ownedTabIds.add(childTabId)
    owningParentByChild.set(childTabId, parentTabId)
    schedulePersistOwnedTabIdsByParent()
}

function unregisterOwnedTab(childTabId) {
    if(!childTabId) return

    const parentTabId = owningParentByChild.get(childTabId)
    if(!parentTabId) return

    owningParentByChild.delete(childTabId)

    const ownedTabIds = ownedTabIdsByParent.get(parentTabId)
    if(!ownedTabIds) return

    ownedTabIds.delete(childTabId)
    if(!ownedTabIds.size) {
        ownedTabIdsByParent.delete(parentTabId)
    }

    schedulePersistOwnedTabIdsByParent()
}

async function getLiveOwnedTabIds(parentTabId) {
    await ownedTabIdsReady

    const ownedTabIds = Array.from(ownedTabIdsByParent.get(parentTabId) || [])
    if(!ownedTabIds.length) return []

    const liveTabIds = []

    for(const tabId of ownedTabIds) {
        try {
            await browser.tabs.get(tabId)
            liveTabIds.push(tabId)
        }
        catch {
            unregisterOwnedTab(tabId)
        }
    }

    return liveTabIds
}

async function sweepOwnedBlockedProfileTabs(parentTabId) {
    const ownedTabIds = await getLiveOwnedTabIds(parentTabId)
    if(!ownedTabIds.length) return {owned: 0, signaled: 0}

    let signaled = 0

    for(const tabId of ownedTabIds) {
        try {
            const metadata = getQueuedTabMetadata(tabId)
            if(metadata?.closeRequestedAt) continue
            const response = await sendTabMessage(tabId, {
                action: 'close-if-blocked',
                requestedProfileHref: metadata?.profileHref || ''
            })
            if(response?.willClose) {
                signaled += 1
                releaseQueuedTab(tabId)
                markQueuedTabClosing(tabId, 'background-blocked-sweep')
                await browser.tabs.remove(tabId).catch(() => {})
            }
        }
        catch {}
    }

    return {owned: ownedTabIds.length, signaled}
}

function isTerminalProfileNukeRecord(record) {
    return !!record && (
        !!record.blockSucceeded ||
        record.status === 'blocked' ||
        record.status === 'already-blocked' ||
        record.status === 'error' ||
        record.status === 'error-page' ||
        record.status === 'profile-unavailable' ||
        record.status === 'interrupted'
    )
}

function isTransientProfileNukeStatus(status) {
    return new Set([
        'queued',
        'tab-opening',
        'tab-opened',
        'awaiting-visibility',
        'page-ready',
        'muting',
        'blocking'
    ]).has(`${status || ''}`.trim())
}

function getProgressHeartbeatAt(record) {
    return Number.isFinite(record?.updatedAt) ? record.updatedAt : 0
}

function getActiveQueuedTabStaleTimeoutMs(record) {
    const status = `${record?.status || ''}`.trim()
    if(status === 'muting' || status === 'blocking') {
        return STALE_ACTIVE_ACTION_QUEUED_TAB_MS
    }

    return STALE_ACTIVE_QUEUED_TAB_MS
}

function cleanupQueuedTabState(tabId) {
    if(!tabId) return
    releaseQueuedTab(tabId)
    unregisterOwnedTab(tabId)
    clearQueuedTabMetadata(tabId)
}

async function pruneQueuedTabActions(ownerTabId = null) {
    await profileNukeProgressReady

    const seenQueuedKeys = new Set()
    for(const tabId of Array.from(activeQueuedTabs)) {
        const metadata = getQueuedTabMetadata(tabId)
        const normalizedHref = normalizeQuoraProfileUrl(metadata?.profileHref || '')
        const ownerId = metadata?.ownerTabId || owningParentByChild.get(tabId) || null
        if(!normalizedHref || !ownerId) continue
        if(ownerTabId && ownerId !== ownerTabId) continue
        seenQueuedKeys.add(`${ownerId}|${normalizedHref}|nuke`)
    }

    for(let index = queuedTabActions.length - 1; index >= 0; index -= 1) {
        const action = queuedTabActions[index]
        const actionOwnerTabId = action?.ownerTabId || null
        if(ownerTabId && actionOwnerTabId !== ownerTabId) continue

        const normalizedHref = normalizeQuoraProfileUrl(action?.url || '')
        const actionKey = `${actionOwnerTabId}|${normalizedHref}|${action?.tabAction || ''}`
        const record = normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
        const dropAction = isTerminalProfileNukeRecord(record) || seenQueuedKeys.has(actionKey)

        if(!dropAction) {
            seenQueuedKeys.add(actionKey)
            continue
        }

        if(actionOwnerTabId && action?.url) {
            rememberCanceledOwnerUrls(actionOwnerTabId, [action.url])
        }
        queuedTabActions.splice(index, 1)
    }
}

async function sweepStaleQueuedTabs(parentTabId = null) {
    await pruneQueuedTabActions(parentTabId)
    const now = Date.now()
    const activeTabIds = Array.from(activeQueuedTabs)

    for(const tabId of activeTabIds) {
        const metadata = getQueuedTabMetadata(tabId)

        try {
            await browser.tabs.get(tabId)
        }
        catch {
            cleanupQueuedTabState(tabId)
            continue
        }

        const progressRecord = metadata?.profileHref
            ? profileNukeProgress?.[normalizeQuoraProfileUrl(metadata.profileHref)] || null
            : null
        const metadataUpdatedAt = Number.isFinite(metadata?.updatedAt)
            ? metadata.updatedAt
            : Number.isFinite(metadata?.openedAt)
                ? metadata.openedAt
                : 0
        const lastUpdatedAt = Math.max(metadataUpdatedAt, getProgressHeartbeatAt(progressRecord))
        const staleTimeoutMs = getActiveQueuedTabStaleTimeoutMs(progressRecord)

        if(progressRecord && isTerminalProfileNukeRecord(progressRecord) && !metadata?.closeRequestedAt) {
            markQueuedTabClosing(tabId, 'terminal-progress-record')
            cleanupQueuedTabState(tabId)
            try {
                await browser.tabs.remove(tabId)
            }
            catch {}
            continue
        }

        const closeRequestedAt = Number.isFinite(metadata?.closeRequestedAt) ? metadata.closeRequestedAt : 0
        if(closeRequestedAt && now - closeRequestedAt >= STALE_CLOSE_REQUESTED_QUEUED_TAB_MS) {
            cleanupQueuedTabState(tabId)
            try {
                await browser.tabs.remove(tabId)
            }
            catch {}
            continue
        }

        if(metadata?.closeRequestedAt || !lastUpdatedAt || now - lastUpdatedAt < staleTimeoutMs) {
            continue
        }

        markQueuedTabClosing(tabId, 'stale-active-tab')
        if(metadata?.profileHref) {
            void recordProfileNukeProgress(metadata.profileHref, {
                status: 'interrupted',
                finalError: 'Queued tab timed out waiting for completion',
                errorPageUrl: metadata.lastUrl || '',
                event: 'Queued tab closed after timing out waiting for completion'
            })
        }
        cleanupQueuedTabState(tabId)
        try {
            await browser.tabs.remove(tabId)
        }
        catch {}
    }

    if(parentTabId) {
        await getLiveOwnedTabIds(parentTabId)
    }
}

async function getOwnedNukeStatus(parentTabId) {
    await sweepStaleQueuedTabs(parentTabId)
    const owned = ownedTabIdsByParent.get(parentTabId)?.size || 0
    const active = Array.from(activeQueuedTabs).filter(tabId => owningParentByChild.get(tabId) === parentTabId).length
    const queued = queuedTabActions.filter(action => action.ownerTabId === parentTabId && action.tabAction === 'nuke').length
    const paused = pausedQueuedOwners.has(parentTabId)
    return {active, owned, queued, paused}
}

function rememberCanceledOwnerUrls(ownerTabId, urls) {
    if(!ownerTabId || !Array.isArray(urls) || !urls.length) return

    const existing = canceledQueuedUrlsByOwner.get(ownerTabId) || []
    canceledQueuedUrlsByOwner.set(ownerTabId, existing.concat(urls.filter(Boolean)))
}

function cancelQueuedOwnerActions(ownerTabId, tabAction = null) {
    if(!ownerTabId) return []

    const canceledUrls = []

    for(let index = queuedTabActions.length - 1; index >= 0; index -= 1) {
        const action = queuedTabActions[index]
        if(action.ownerTabId !== ownerTabId) continue
        if(tabAction && action.tabAction !== tabAction) continue

        if(action.url) {
            canceledUrls.push(action.url)
        }
        queuedTabActions.splice(index, 1)
    }

    return canceledUrls
}

function consumeCanceledOwnerUrls(ownerTabId) {
    if(!ownerTabId) return []

    const urls = canceledQueuedUrlsByOwner.get(ownerTabId) || []
    canceledQueuedUrlsByOwner.delete(ownerTabId)
    return urls
}

async function stopOwnerNukes(ownerTabId, options = {}) {
    if(!ownerTabId) return {canceledUrls: [], ownedTabIds: []}

    const {
        closeOwnedTabs = true,
        keepTabId = null,
        reason = 'owner-stop-request'
    } = options

    pausedQueuedOwners.add(ownerTabId)
    const canceledUrls = cancelQueuedOwnerActions(ownerTabId, 'nuke')
    rememberCanceledOwnerUrls(ownerTabId, canceledUrls)

    const ownedTabIds = closeOwnedTabs
        ? (await getLiveOwnedTabIds(ownerTabId)).filter(tabId => tabId && tabId !== keepTabId)
        : []

    for(const tabId of ownedTabIds) {
        markQueuedTabClosing(tabId, reason)
    }

    if(ownedTabIds.length) {
        try {
            await browser.tabs.remove(ownedTabIds)
        }
        catch {}
    }

    return {canceledUrls, ownedTabIds}
}

function releaseQueuedTab(tabId) {
    pendingTabActions.delete(tabId)

    if(activeQueuedTabs.delete(tabId)) {
        void fillQueuedTabs()
    }
}

async function fillQueuedTabs() {
    await ownedTabIdsReady
    await sweepStaleQueuedTabs()

    while(activeQueuedTabs.size < queuedTabConcurrency && queuedTabActions.length) {
        const next = queuedTabActions.shift()
        if(pausedQueuedOwners.has(next.ownerTabId)) {
            rememberCanceledOwnerUrls(next.ownerTabId, next.url ? [next.url] : [])
            continue
        }

        try {
            void sweepOwnedBlockedProfileTabs(next.ownerTabId)
            const tab = await createOwnedTab(next)
            activeQueuedTabs.add(tab.id)
            pendingTabActions.set(tab.id, {
                action: next.tabAction || null,
                targetUrl: next.url || ''
            })
            setQueuedTabMetadata(tab.id, {
                profileHref: normalizeQuoraProfileUrl(next.url),
                ownerTabId: next.ownerTabId || null,
                ownerWindowId: next.ownerWindowId || null,
                tabAction: next.tabAction || null,
                openedAt: Date.now(),
                lastUrl: tab.url || normalizeTabTargetUrl(next.url)
            })
            registerOwnedTab(next.ownerTabId, tab.id)
            await recordProfileNukeProgress(next.url, {
                status: 'tab-opening',
                tabOpenedAt: Date.now(),
                ownerTabId: next.ownerTabId || null,
                ownerWindowId: next.ownerWindowId || null,
                lastUrl: tab.url || normalizeTabTargetUrl(next.url),
                event: 'Background opened a queued tab'
            })
            void sweepOwnedBlockedProfileTabs(next.ownerTabId)
        }
        catch {}
    }
}

browser.runtime.onInstalled.addListener(details => {
    if(details.reason === 'install') {
        browser.storage.local.set(defaults)
    }
})

browser.tabs.onRemoved.addListener(tabId => {
    void ownedTabIdsReady.then(() => {
        const metadata = getQueuedTabMetadata(tabId)
        const isOwnerTab = ownedTabIdsByParent.has(tabId)
        if(metadata?.profileHref) {
            const progressRecord = profileNukeProgress?.[normalizeQuoraProfileUrl(metadata.profileHref)] || null
            const shouldInterruptClosedTransient =
                progressRecord &&
                !isTerminalProfileNukeRecord(progressRecord) &&
                isTransientProfileNukeStatus(progressRecord.status)

            void recordProfileNukeProgress(metadata.profileHref, {
                ...(shouldInterruptClosedTransient ? {
                    status: 'interrupted',
                    finalError: progressRecord?.finalError || (
                        metadata?.closeReason
                            ? `Queued tab closed before reaching a terminal state (${metadata.closeReason})`
                            : 'Queued tab closed before reaching a terminal state'
                    )
                } : {}),
                tabClosedAt: Date.now(),
                closedByExtension: !!metadata.closeRequestedAt,
                closeReason: metadata.closeReason || '',
                event: 'Queued tab closed'
            })
        }
        void restoreOwnerTabFocus(metadata)
        if(isOwnerTab) {
            void stopOwnerNukes(tabId, {
                closeOwnedTabs: true,
                reason: 'owner-tab-closed'
            })
        }
        pausedQueuedOwners.delete(tabId)
        releaseQueuedTab(tabId)
        unregisterOwnedTab(tabId)
        clearQueuedTabMetadata(tabId)
    })
})

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const metadata = getQueuedTabMetadata(tabId)
    if(metadata?.profileHref) {
        const lastUrl = `${changeInfo.url || tab?.url || metadata.lastUrl || ''}`.trim()
        if(lastUrl) {
            const errorPageUrl = getErrorPageUrl(lastUrl)
            const resolvedProfileHref = normalizeQuoraProfileUrl(lastUrl) || ''
            const remappedFromRequested = !!(
                metadata.profileHref &&
                resolvedProfileHref &&
                resolvedProfileHref !== metadata.profileHref
            )
            setQueuedTabMetadata(tabId, {lastUrl})
            void recordProfileNukeProgress(metadata.profileHref, {
                lastUrl,
                resolvedProfileHref,
                remappedFromRequested,
                errorPageUrl,
                event: changeInfo.url ? `Tab navigated to ${lastUrl}` : ''
            })

            if(errorPageUrl && /^(?:chrome|edge|about|moz-extension|chrome-error):/i.test(errorPageUrl)) {
                releaseQueuedTab(tabId)
                markQueuedTabClosing(tabId, 'browser-error-page')
                void recordProfileNukeProgress(metadata.profileHref, {
                    status: 'error-page',
                    finalError: 'Queued tab navigated to a browser error page',
                    errorPageUrl,
                    event: 'Queued tab closed after navigating to a browser error page'
                })
                if(metadata.ownerTabId) {
                    void sendTabMessage(metadata.ownerTabId, {
                        status: 'owner-nuke-url-failed',
                        url: metadata.profileHref,
                        reason: 'Queued tab navigated to a browser error page'
                    })
                }
                void browser.tabs.remove(tabId).catch(() => {})
                return
            }
        }
    }

    if(changeInfo.status !== 'loading') return

    pausedQueuedOwners.add(tabId)
    const canceledUrls = cancelQueuedOwnerActions(tabId, 'nuke')
    rememberCanceledOwnerUrls(tabId, canceledUrls)
})

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if(request.action === 'create-tab') {
        return createOwnedTab({
            url: request.url,
            ownerTabId: sender.tab?.id || null,
            ownerWindowId: sender.tab?.windowId || null
        }).then(tab => {
            if(request.tabAction) {
                pendingTabActions.set(tab.id, {
                    action: request.tabAction,
                    targetUrl: request.url || ''
                })
            }
            return {tabId: tab.id}
        })
    }
    else if(request.action === 'enqueue-tabs') {
        const urls = Array.isArray(request.urls) ? request.urls.map(normalizeTabTargetUrl).filter(Boolean) : []
        if(!urls.length) return Promise.resolve({queued: 0})
        const ownerTabId = sender.tab?.id || null
        const ownerWindowId = sender.tab?.windowId || null

        return ownedTabIdsReady.then(() => {
            pausedQueuedOwners.delete(ownerTabId)
            const requestedConcurrency = Math.max(1, Number.parseInt(request.maxConcurrent, 10) || 1)
            queuedTabConcurrency = requestedConcurrency

            for(const url of urls) {
                queuedTabActions.push({url, tabAction: request.tabAction || null, ownerTabId, ownerWindowId})
            }

            void sweepOwnedBlockedProfileTabs(ownerTabId)
            return fillQueuedTabs().then(() => ({queued: urls.length}))
        })
    }
    else if(request.action === 'claim-tab-action') {
        const tabId = sender.tab?.id
        if(!tabId) return Promise.resolve(null)

        const action = pendingTabActions.get(tabId) || null
        pendingTabActions.delete(tabId)
        return Promise.resolve(action)
    }
    else if(request.action === 'promote-queued-tab') {
        return promoteQueuedTab(sender.tab?.id || null, request.reason || '')
    }
    else if(request.action === 'release-tab-slot') {
        const tabId = sender.tab?.id
        if(!tabId) return Promise.resolve({released: false})

        releaseQueuedTab(tabId)
        return Promise.resolve({released: true})
    }
    else if(request.action === 'cancel-queued-owner-nukes') {
        const ownerTabId = sender.tab?.id || null
        const canceledUrls = consumeCanceledOwnerUrls(ownerTabId)
            .concat(cancelQueuedOwnerActions(ownerTabId, 'nuke'))
        return Promise.resolve({
            canceledUrls
        })
    }
    else if(request.action === 'pause-owner-nukes') {
        const ownerTabId = sender.tab?.id || null
        pausedQueuedOwners.add(ownerTabId)
        const canceledUrls = cancelQueuedOwnerActions(ownerTabId, 'nuke')
        return Promise.resolve({
            canceledUrls
        })
    }
    else if(request.action === 'close-tab') {
        const tabId = sender.tab?.id
        releaseQueuedTab(tabId)

        if(tabId) {
            markQueuedTabClosing(tabId, 'content-close-request')
            return browser.tabs.remove(tabId)
                .then(() => ({closed: true}))
                .catch(() => ({closed: false}))
        }

        return Promise.resolve({closed: false})
    }
    else if(request.action === 'record-nuke-progress') {
        return recordProfileNukeProgress(request.profileHref, request.patch || {}).then(record => ({recorded: !!record}))
    }
    else if(request.action === 'record-nuke-progress-batch') {
        return recordProfileNukeProgressBatch(Array.isArray(request.updates) ? request.updates : []).then(recorded => ({recorded: !!recorded}))
    }
    else if(request.action === 'get-owned-nuke-status') {
        return ownedTabIdsReady.then(async () => {
            await getLiveOwnedTabIds(sender.tab?.id || null)
            return getOwnedNukeStatus(sender.tab?.id || null)
        })
    }
    else if(request.action === 'sweep-owned-blocked-profile-tabs') {
        return sweepOwnedBlockedProfileTabs(sender.tab?.id || null)
    }
})

browser.webRequest.onCompleted.addListener(details => {
    if(details.url.match(/TribePeopleModalQuery/i)) {
        sendTabMessage(details.tabId, {status: 'space-people-modal-loaded'})
    }
    else if(details.url.match(/TribeContributorOrHigherListQuery/i)) {
        sendTabMessage(details.tabId, {status: 'space-contributors-loaded'})
    }
    else if(details.url.match(/UserProfileFollowersModalQuery/i)) {
        sendTabMessage(details.tabId, {status: 'profile-followers-modal-loaded'})
    }
    else if(details.url.match(/UserProfileFollowers_ProfileTopics_Query/i)) {
        sendTabMessage(details.tabId, {status: 'profile-followers-loaded'})
    }
    else if(details.url.match(/UserProfileFollowingPeople_ProfileTopics_Query/i)) {
        sendTabMessage(details.tabId, {status: 'profile-following-loaded'})
    }
    else if(details.url.match(/userBlockModalInnerUtils_userSetBlock_Mutation/i)) {
        sendTabMessage(details.tabId, {status: 'profile-block-updated'})
    }
    else if(details.url.match(/ContentLogMainQuery/i)) {
        sendTabMessage(details.tabId, {status: 'question-log-loaded'})
    }
    else if(details.url.match(/QuestionCollapsedAnswerLoaderQuery/i)) {
        sendTabMessage(details.tabId, {status: 'question-page-loaded'})
    }
},
{
    urls: [
        'https://*.quora.com/graphql/gql_para_POST?q=TribePeopleModalQuery',
        'https://*.quora.com/graphql/gql_para_POST?q=TribeContributorOrHigherListQuery',

        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowersModalQuery',
        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowers_ProfileTopics_Query',
        'https://www.quora.com/graphql/gql_POST?q=userBlockModalInnerUtils_userSetBlock_Mutation',
        'https://www.quora.com/graphql/gql_para_POST?q=UserProfileFollowingPeople_ProfileTopics_Query',

        'https://www.quora.com/graphql/gql_para_POST?q=ContentLogMainQuery',
        'https://www.quora.com/graphql/gql_para_POST?q=QuestionCollapsedAnswerLoaderQuery'
    ]
})
