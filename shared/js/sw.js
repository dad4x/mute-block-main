const browser = require('webextension-polyfill')
const defaults = require('./defaults')
const {
    SPACE_NUKED_POSTS_KEY,
    getPrunedNukedPosts
} = require('./nukedPosts')
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
const SPACE_PENDING_NUKED_POSTS_KEY = 'mbSpacePendingNukedPosts'
const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'
const COORDINATOR_RUNS_KEY = 'mbCoordinatorRuns'
const COORDINATOR_EVENTS_KEY = 'mbCoordinatorEvents'
const COORDINATOR_TAB_KEY = 'mbCoordinatorTabId'
const COORDINATOR_RETRY_FAILED_ENABLED_KEY = 'mbCoordinatorRetryFailedEnabled'
const MAX_PROFILE_NUKE_PROGRESS_ENTRIES = 1000
const MAX_COORDINATOR_EVENTS = 500
const TERMINAL_COORDINATOR_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'canceled'])
const STALE_ACTIVE_QUEUED_TAB_MS = 10000
const STALE_BACKGROUND_OPENING_QUEUED_TAB_MS = 45000
const STALE_BACKGROUND_READY_QUEUED_TAB_MS = 35000
const STALE_ACTIVE_ACTION_QUEUED_TAB_MS = 30000
const STALE_CLOSE_REQUESTED_QUEUED_TAB_MS = 8000
const STALE_QUEUED_TAB_MAX_RETRIES = 0
let persistOwnedTabIdsTimeout = null
let queuedTabConcurrency = 1
let profileNukeProgress = {}
let spaceFeedStorageUpdatePromise = Promise.resolve()
let coordinatorProgressSyncPromise = Promise.resolve()
let coordinatorTabId = null
let coordinatorOpenPromise = null
let coordinatorDedupePromise = Promise.resolve()
let coordinatorResumePromise = null
let coordinatorEnqueuePromise = Promise.resolve()
let coordinatorStoredWorkRestorePromise = null

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

function getNormalizedProfileHrefList(values = []) {
    const seen = new Set()
    const normalized = []

    for(const value of values || []) {
        const href = normalizeQuoraProfileUrl(value)
        if(!href || seen.has(href)) continue
        seen.add(href)
        normalized.push(href)
    }

    return normalized
}

function getStoredSpaceFeedRecordUrls(record, key = 'remainingUrls') {
    if(!record || typeof record !== 'object') return []

    const urls = key && Array.isArray(record[key])
        ? record[key]
        : key === 'remainingUrls'
            ? Array.isArray(record.remainingUrls)
                ? record.remainingUrls
                : Array.isArray(record.allUrls)
                    ? record.allUrls
                    : Array.isArray(record.urls)
                        ? record.urls
                        : []
            : []

    return getNormalizedProfileHrefList(urls)
}

function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeCoordinatorMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeCoordinatorEvents(value) {
    if(Array.isArray(value)) return value.filter(event => event && typeof event === 'object')
    return Object.values(normalizeCoordinatorMap(value)).filter(event => event && typeof event === 'object')
}

function mergeCoordinatorSources(existingSources = [], incomingSources = []) {
    const seen = new Set()
    const merged = []

    for(const source of [...existingSources, ...incomingSources]) {
        if(!source || typeof source !== 'object') continue
        const key = [
            source.type || '',
            source.pageUrl || '',
            source.spaceKey || '',
            source.spaceCategory || ''
        ].join('|')
        if(seen.has(key)) continue
        seen.add(key)
        merged.push({
            type: source.type || '',
            pageUrl: source.pageUrl || '',
            spaceKey: source.spaceKey || '',
            spaceCategory: source.spaceCategory || ''
        })
    }

    return merged
}

function mergeCoordinatorEvidence(existingEvidence = [], incomingEvidence = []) {
    const seen = new Set()
    const merged = []

    for(const evidence of [...existingEvidence, ...incomingEvidence]) {
        if(!evidence || typeof evidence !== 'object') continue
        const key = [
            evidence.postKey || '',
            evidence.postUrl || '',
            evidence.collector || '',
            evidence.sourcePageUrl || ''
        ].join('|')
        if(seen.has(key)) continue
        seen.add(key)
        merged.push({
            postKey: evidence.postKey || '',
            postUrl: evidence.postUrl || '',
            collector: evidence.collector || '',
            sourcePageUrl: evidence.sourcePageUrl || ''
        })
    }

    return merged
}

function getCoordinatorStatusFromProgress(record = null) {
    const status = `${record?.status || ''}`.trim()
    if(!record) return {status: '', outcome: '', error: ''}

    if(record.blockSucceeded || status === 'blocked' || status === 'already-blocked') {
        return {
            status: 'succeeded',
            outcome: status === 'already-blocked' ? 'already-blocked' : 'blocked',
            error: ''
        }
    }
    if(status === 'profile-unavailable') {
        return {status: 'skipped', outcome: 'profile-unavailable', error: record.finalError || record.unavailableReason || ''}
    }
    if(isExplicitSecurityVerificationRecord(record)) {
        return {status: 'failed', outcome: 'security-verification', error: record.finalError || ''}
    }
    if(status === 'error-page') {
        return {status: 'failed', outcome: 'error-page', error: record.finalError || record.errorPageUrl || ''}
    }
    if(status === 'error' || status === 'interrupted') {
        const error = record.finalError || record.muteError || record.blockError || ''
        return {
            status: 'failed',
            outcome: /timeout|timed out|stale/i.test(error) ? 'timeout' : 'action-error',
            error
        }
    }
    if(isTransientProfileNukeStatus(status)) {
        return {status: status === 'queued' ? 'queued' : 'active', outcome: '', error: ''}
    }

    return {status: '', outcome: '', error: ''}
}

function getCoordinatorMilestonesFromProgress(record = {}) {
    return {
        tabCreatedAt: Number.isFinite(record.tabCreatedAt) ? record.tabCreatedAt : 0,
        navigationStartedAt: Number.isFinite(record.tabOpenedAt) ? record.tabOpenedAt : 0,
        contentOpenedAt: Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : 0,
        actionClaimedAt: Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : 0,
        profileReadyAt: Number.isFinite(record.actionReadyAt) ? record.actionReadyAt : 0,
        muteAttemptedAt: Number.isFinite(record.muteAttemptedAt) ? record.muteAttemptedAt : 0,
        blockAttemptedAt: Number.isFinite(record.blockAttemptedAt) ? record.blockAttemptedAt : 0,
        closeRequestedAt: Number.isFinite(record.closeRequestedAt) ? record.closeRequestedAt : 0,
        tabClosedAt: Number.isFinite(record.tabClosedAt) ? record.tabClosedAt : 0
    }
}

function isTerminalCoordinatorStatus(status) {
    return TERMINAL_COORDINATOR_STATUSES.has(`${status || ''}`)
}

function isRetryableCoordinatorFailure(item = null) {
    if(`${item?.status || ''}` !== 'failed') return false
    const outcome = `${item?.outcome || ''}`.trim()
    if(outcome === 'security-verification') return false
    if(outcome === 'timeout' || outcome === 'action-error') return true

    return /timeout|timed out|stale|interrupted/i.test(`${item?.error || ''}`)
}

function isRetryableCoordinatorFailureFromProgress(item = null, record = null) {
    if(isRetryableCoordinatorFailure(item)) return true
    if(`${item?.status || ''}` !== 'failed') return false
    if(`${item?.outcome || ''}`.trim() !== 'security-verification') return false
    if(isExplicitSecurityVerificationRecord(record)) return false

    const recordStatus = `${record?.status || ''}`.trim()
    if(isTransientProfileNukeStatus(recordStatus)) return true

    return false
}

function makeEmptyCoordinatorMilestones() {
    return {
        tabCreatedAt: 0,
        navigationStartedAt: 0,
        contentOpenedAt: 0,
        actionClaimedAt: 0,
        profileReadyAt: 0,
        muteAttemptedAt: 0,
        blockAttemptedAt: 0,
        closeRequestedAt: 0,
        tabClosedAt: 0
    }
}

function shouldResetCoordinatorFailureFromProgress(item = null, record = null, mapped = null) {
    if(!isRetryableCoordinatorFailureFromProgress(item, record)) return false
    if(!mapped || isTerminalCoordinatorStatus(mapped.status)) return false
    if(!isTransientProfileNukeStatus(record?.status)) return false

    const recordRunId = `${record?.runId || ''}`.trim()
    const itemRunId = `${item?.runId || ''}`.trim()
    if(recordRunId && recordRunId !== itemRunId) return true

    const recordUpdatedAt = Number.parseInt(record?.updatedAt, 10) || 0
    const itemTerminalAt = Number.parseInt(item?.terminalAt, 10) || 0
    return recordUpdatedAt > 0 && itemTerminalAt > 0 && recordUpdatedAt >= itemTerminalAt
}

function getCoordinatorRunStatus(runItems = [], existingRun = {}) {
    if(!runItems.length) return existingRun?.status || 'active'

    const terminalCount = runItems.filter(item => isTerminalCoordinatorStatus(item?.status)).length
    if(terminalCount === runItems.length) return 'complete'
    if(existingRun?.paused) return 'paused'
    return 'active'
}

function getCoordinatorRunTargetHrefs(run = {}) {
    return getNormalizedProfileHrefList(run?.targetProfileHrefs || [])
}

function getCoordinatorRunItems(queue = {}, runId = '', existingRun = {}) {
    const targetHrefs = new Set(getCoordinatorRunTargetHrefs(existingRun))

    return Object.entries(queue || {})
        .filter(([itemKey, item]) => {
            if(item?.runId === runId) return true
            if(!targetHrefs.size) return false

            const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            return !!href && targetHrefs.has(href)
        })
        .map(([, item]) => item)
}

function getCoordinatorRunIdsForHref(runs = {}, href = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href)
    if(!normalizedHref) return []

    return Object.values(runs || {})
        .filter(run => getCoordinatorRunTargetHrefs(run).includes(normalizedHref))
        .map(run => run?.id || run?.runId || '')
        .filter(Boolean)
}

function recomputeCoordinatorRuns(queue = {}, runs = {}, runIds = null) {
    const nextRuns = {
        ...runs
    }
    const targetRunIds = new Set(runIds || Object.keys(nextRuns))

    for(const item of Object.values(queue || {})) {
        if(item?.runId && (!runIds || targetRunIds.has(item.runId))) {
            targetRunIds.add(item.runId)
        }
    }

    for(const runId of targetRunIds) {
        const existing = nextRuns[runId] || {
            id: runId,
            sourcePages: []
        }
        const runItems = getCoordinatorRunItems(queue, runId, existing)
        const targetHrefs = getCoordinatorRunTargetHrefs(existing)
        const terminalCount = runItems.filter(item => isTerminalCoordinatorStatus(item?.status)).length
        const activeCount = runItems.filter(item => ['active', 'settling'].includes(`${item?.status || ''}`)).length
        const latestItemUpdatedAt = runItems.reduce((latest, item) => {
            const updatedAt = Number.parseInt(item?.updatedAt || item?.terminalAt || item?.createdAt, 10) || 0
            return Math.max(latest, updatedAt)
        }, 0)

        nextRuns[runId] = {
            ...existing,
            id: runId,
            sourceType: existing.sourceType || runItems[0]?.source?.type || 'space-feed',
            createdAt: existing.createdAt || runItems[0]?.createdAt || Date.now(),
            targetProfileHrefs: targetHrefs,
            itemCount: targetHrefs.length || runItems.length || Number.parseInt(existing.itemCount, 10) || 0,
            activeCount,
            terminalCount,
            status: getCoordinatorRunStatus(runItems, existing),
            updatedAt: Math.max(Number.parseInt(existing.updatedAt, 10) || 0, latestItemUpdatedAt)
        }
    }

    return nextRuns
}

async function syncCoordinatorProgressRecords(progressRecords = {}) {
    const hrefs = Object.keys(progressRecords || {}).map(normalizeQuoraProfileUrl).filter(Boolean)
    if(!hrefs.length) return false

    const stored = await browser.storage.local.get({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_RUNS_KEY]: {}
    })
    const queue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY])
    const runs = normalizeCoordinatorMap(stored[COORDINATOR_RUNS_KEY])
    let changed = false
    const now = Date.now()
    const affectedRunIds = new Set()

    for(const href of hrefs) {
        const item = queue[href]
        const record = progressRecords[href] || profileNukeProgress[href] || null
        if(!item || !record) continue
        if(item.runId) affectedRunIds.add(item.runId)
        for(const runId of getCoordinatorRunIdsForHref(runs, href)) {
            affectedRunIds.add(runId)
        }

        const mapped = getCoordinatorStatusFromProgress(record)
        if(!mapped.status) continue
        const resetRetry = shouldResetCoordinatorFailureFromProgress(item, record, mapped)
        const mappedTerminal = isTerminalCoordinatorStatus(mapped.status)
        if(isTerminalCoordinatorStatus(item.status) && !mappedTerminal && !resetRetry) continue

        const nextItem = {
            ...item,
            runId: resetRetry ? record.runId || item.runId : item.runId,
            status: mapped.status,
            outcome: mappedTerminal ? mapped.outcome || item.outcome || '' : '',
            error: mappedTerminal ? mapped.error || '' : '',
            updatedAt: Math.max(Number.parseInt(item.updatedAt, 10) || 0, Number.parseInt(record.updatedAt, 10) || 0, now),
            queuedAt: resetRetry && mapped.status === 'queued'
                ? Number.parseInt(record.queuedAt, 10) || now
                : item.queuedAt || 0,
            activeAt: mapped.status === 'active'
                ? (item.activeAt || Number.parseInt(record.tabOpenedAt || record.contentOpenedAt, 10) || now)
                : resetRetry ? 0 : item.activeAt || 0,
            terminalAt: mappedTerminal
                ? (Number.isFinite(record.terminalAt) && record.terminalAt > 0 ? record.terminalAt : now)
                : 0,
            tabId: resetRetry ? null : (mapped.status === 'active' ? getPersistedQueuedTabId(item, record) : item.tabId || null),
            attempt: resetRetry ? 0 : Number.parseInt(record.retryAttempt, 10) || item.attempt || 0,
            maxAttempts: (Number.parseInt(record.maxRetries, 10) || 0) + 1 || item.maxAttempts || 1,
            milestones: resetRetry ? {
                ...makeEmptyCoordinatorMilestones(),
                ...getCoordinatorMilestonesFromProgress(record)
            } : {
                ...(item.milestones || {}),
                ...getCoordinatorMilestonesFromProgress(record)
            }
        }

        if(JSON.stringify(nextItem) === JSON.stringify(item)) continue
        queue[href] = nextItem
        if(nextItem.runId) affectedRunIds.add(nextItem.runId)
        changed = true
    }

    const nextRuns = affectedRunIds.size
        ? recomputeCoordinatorRuns(queue, runs, affectedRunIds)
        : runs
    const runsChanged = JSON.stringify(nextRuns) !== JSON.stringify(runs)
    const storagePatch = {}

    if(changed) storagePatch[COORDINATOR_QUEUE_KEY] = queue
    if(runsChanged) storagePatch[COORDINATOR_RUNS_KEY] = nextRuns

    if(Object.keys(storagePatch).length) {
        await browser.storage.local.set(storagePatch)
    }

    return changed || runsChanged
}

function enqueueCoordinatorProgressSync(progressRecords = {}) {
    coordinatorProgressSyncPromise = coordinatorProgressSyncPromise
        .catch(() => false)
        .then(() => syncCoordinatorProgressRecords(progressRecords))
        .catch(() => false)

    return coordinatorProgressSyncPromise
}

function getCoordinatorProgressRecordForItem(itemKey = '', item = {}, progress = {}) {
    const candidates = [
        itemKey,
        item?.targetProfileHref,
        item?.dedupeKey,
        item?.requestedUrl
    ]

    for(const candidate of candidates) {
        const normalized = normalizeQuoraProfileUrl(candidate || '')
        if(normalized && progress[normalized]) return progress[normalized]
        if(candidate && progress[candidate]) return progress[candidate]
    }

    return null
}

async function repairCoordinatorStorageFromProgress() {
    const stored = await browser.storage.local.get({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_RUNS_KEY]: {},
        [PROFILE_NUKE_PROGRESS_KEY]: {}
    })
    const queue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY])
    const runs = normalizeCoordinatorMap(stored[COORDINATOR_RUNS_KEY])
    const progress = normalizeStoredProfileNukeProgress(stored[PROFILE_NUKE_PROGRESS_KEY] || {})
    const now = Date.now()
    const liveProfileTabsByHref = await getLiveProfileTabsByHref()
    let changed = false
    let progressChanged = false
    let repaired = 0

    for(const [itemKey, item] of Object.entries(queue)) {
        if(!item || typeof item !== 'object') continue

        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        let record = getCoordinatorProgressRecordForItem(itemKey, item, progress)
        if(shouldReconcileMissingActiveCoordinatorTab(item, record, href, liveProfileTabsByHref, now)) {
            const tabId = getPersistedQueuedTabId(item, record)
            if(tabId) {
                try {
                    await browser.tabs.remove(tabId)
                }
                catch {}
            }

            const nextRecord = makeMissingActiveCoordinatorProgressRecord(href, record, Date.now())
            if(nextRecord) {
                const recordHref = normalizeQuoraProfileUrl(href || nextRecord.profileHref || '')
                record = nextRecord
                progress[recordHref] = nextRecord
                profileNukeProgress = {
                    ...profileNukeProgress,
                    [recordHref]: nextRecord
                }
                progressChanged = true
                repaired += 1
            }
        }

        const mapped = getCoordinatorStatusFromProgress(record)
        if(!mapped.status) continue
        const resetRetry = shouldResetCoordinatorFailureFromProgress(item, record, mapped)
        const mappedTerminal = isTerminalCoordinatorStatus(mapped.status)
        if(isTerminalCoordinatorStatus(item.status) && !mappedTerminal && !resetRetry) continue

        const nextItem = {
            ...item,
            runId: resetRetry ? record.runId || item.runId : item.runId,
            status: mapped.status,
            outcome: mappedTerminal ? mapped.outcome || item.outcome || '' : '',
            error: mappedTerminal ? mapped.error || '' : '',
            updatedAt: Math.max(Number.parseInt(item.updatedAt, 10) || 0, Number.parseInt(record.updatedAt, 10) || 0, now),
            queuedAt: resetRetry && mapped.status === 'queued'
                ? Number.parseInt(record.queuedAt, 10) || now
                : item.queuedAt || 0,
            activeAt: mapped.status === 'active'
                ? (item.activeAt || Number.parseInt(record.tabOpenedAt || record.contentOpenedAt, 10) || now)
                : resetRetry ? 0 : item.activeAt || 0,
            terminalAt: mappedTerminal
                ? (Number.parseInt(record.terminalAt || record.tabClosedAt || record.updatedAt, 10) || item.terminalAt || now)
                : 0,
            tabId: resetRetry ? null : (mapped.status === 'active' ? getPersistedQueuedTabId(item, record) : item.tabId || null),
            attempt: resetRetry ? 0 : Number.parseInt(record.retryAttempt, 10) || item.attempt || 0,
            maxAttempts: (Number.parseInt(record.maxRetries, 10) || 0) + 1 || item.maxAttempts || 1,
            milestones: resetRetry ? {
                ...makeEmptyCoordinatorMilestones(),
                ...getCoordinatorMilestonesFromProgress(record)
            } : {
                ...(item.milestones || {}),
                ...getCoordinatorMilestonesFromProgress(record)
            }
        }

        if(JSON.stringify(nextItem) === JSON.stringify(item)) continue
        queue[itemKey] = nextItem
        changed = true
        repaired += 1
    }

    const nextRuns = recomputeCoordinatorRuns(queue, runs)
    const runsChanged = JSON.stringify(nextRuns) !== JSON.stringify(runs)
    const storagePatch = {}

    if(progressChanged) {
        const prunedProgress = pruneProfileNukeProgress(progress)
        profileNukeProgress = prunedProgress
        storagePatch[PROFILE_NUKE_PROGRESS_KEY] = prunedProgress
    }
    if(changed) storagePatch[COORDINATOR_QUEUE_KEY] = queue
    if(runsChanged) storagePatch[COORDINATOR_RUNS_KEY] = nextRuns

    if(Object.keys(storagePatch).length) {
        await browser.storage.local.set(storagePatch)
    }

    return {
        repaired,
        queueChanged: changed,
        runsChanged,
        queueCount: Object.keys(queue).length,
        runCount: Object.keys(nextRuns).length
    }
}

function getCoordinatorPageUrl() {
    return browser.runtime.getURL('coordinator.html')
}

function normalizeTabId(value) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function rememberCoordinatorTabId(tabId) {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return

    coordinatorTabId = normalizedTabId
    try {
        await browser.storage.local.set({[COORDINATOR_TAB_KEY]: normalizedTabId})
    }
    catch {}
}

async function forgetCoordinatorTabId(tabId = null) {
    const normalizedTabId = normalizeTabId(tabId)
    if(normalizedTabId && coordinatorTabId && normalizedTabId !== coordinatorTabId) return

    coordinatorTabId = null
    try {
        await browser.storage.local.remove(COORDINATOR_TAB_KEY)
    }
    catch {}
}

async function forgetRemovedCoordinatorTabId(tabId) {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return

    if(coordinatorTabId === normalizedTabId) {
        await forgetCoordinatorTabId(normalizedTabId)
        return
    }

    try {
        const stored = await browser.storage.local.get({[COORDINATOR_TAB_KEY]: null})
        if(normalizeTabId(stored[COORDINATOR_TAB_KEY]) === normalizedTabId) {
            await forgetCoordinatorTabId(normalizedTabId)
        }
    }
    catch {}
}

async function getStoredCoordinatorTabId() {
    if(coordinatorTabId) return coordinatorTabId

    try {
        const stored = await browser.storage.local.get({[COORDINATOR_TAB_KEY]: null})
        coordinatorTabId = normalizeTabId(stored[COORDINATOR_TAB_KEY])
    }
    catch {
        coordinatorTabId = null
    }

    return coordinatorTabId
}

async function getKnownCoordinatorTab(tabId) {
    const normalizedTabId = normalizeTabId(tabId)
    if(!normalizedTabId) return null

    try {
        const tab = await browser.tabs.get(normalizedTabId)
        await rememberCoordinatorTabId(normalizedTabId)
        return {
            tabId: normalizedTabId,
            windowId: tab?.windowId || null,
            reused: true,
            closedDuplicates: 0
        }
    }
    catch {
        if(!coordinatorTabId || coordinatorTabId === normalizedTabId) {
            await forgetCoordinatorTabId(normalizedTabId)
        }
        return null
    }
}

function dedupeCoordinatorTabs(preferredTabId = null) {
    coordinatorDedupePromise = coordinatorDedupePromise
        .catch(() => null)
        .then(() => dedupeCoordinatorTabsOnce(preferredTabId))

    return coordinatorDedupePromise
}

async function dedupeCoordinatorTabsOnce(preferredTabId = null) {
    const coordinatorUrl = getCoordinatorPageUrl()
    let matches = []

    try {
        matches = await browser.tabs.query({url: coordinatorUrl})
    }
    catch {
        return null
    }

    const liveMatches = matches.filter(tab => tab?.id)
    if(!liveMatches.length) {
        const preferred = await getKnownCoordinatorTab(preferredTabId)
        if(preferred?.tabId) return preferred

        const remembered = await getKnownCoordinatorTab(await getStoredCoordinatorTabId())
        if(remembered?.tabId) return remembered

        await forgetCoordinatorTabId()
        return null
    }

    const keep = liveMatches.find(tab => tab.id === coordinatorTabId) ||
        liveMatches.find(tab => tab.id === preferredTabId) ||
        liveMatches[0]
    const duplicates = liveMatches.filter(tab => tab.id !== keep.id)

    coordinatorTabId = keep.id
    await rememberCoordinatorTabId(keep.id)

    await Promise.allSettled(duplicates.map(tab => browser.tabs.remove(tab.id)))

    return {
        tabId: keep.id,
        windowId: keep.windowId || null,
        reused: true,
        closedDuplicates: duplicates.length
    }
}

async function openCoordinatorPage(options = {}) {
    if(coordinatorOpenPromise) return coordinatorOpenPromise

    coordinatorOpenPromise = openCoordinatorPageOnce(options)
        .finally(() => {
            coordinatorOpenPromise = null
        })

    return coordinatorOpenPromise
}

async function restoreCoordinatorPageForPersistentRetry() {
    try {
        const stored = await browser.storage.local.get({
            [COORDINATOR_RETRY_FAILED_ENABLED_KEY]: false
        })
        if(stored[COORDINATOR_RETRY_FAILED_ENABLED_KEY]) {
            await openCoordinatorPage()
        }
    }
    catch(error) {
        console.info('Mute Block coordinator retry restore skipped', error)
    }
}

async function restoreCoordinatorPageForStoredWork(options = {}) {
    if(coordinatorStoredWorkRestorePromise) return coordinatorStoredWorkRestorePromise

    coordinatorStoredWorkRestorePromise = restoreCoordinatorPageForStoredWorkOnce(options)
        .finally(() => {
            coordinatorStoredWorkRestorePromise = null
        })

    return coordinatorStoredWorkRestorePromise
}

async function restoreCoordinatorPageForStoredWorkOnce(options = {}) {
    try {
        const stored = await browser.storage.local.get({
            [COORDINATOR_QUEUE_KEY]: {}
        })
        const queue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY])
        if(!hasStoredCoordinatorWork(queue)) {
            return {restored: false, reason: 'no-stored-work'}
        }

        const coordinator = await openCoordinatorPage(options)
        const resume = await resumeCoordinatorQueueExecution(coordinator || {}, {skipRepair: false})
        return {
            restored: !!coordinator?.tabId,
            coordinatorTabId: coordinator?.tabId || null,
            resume
        }
    }
    catch(error) {
        console.info('Mute Block coordinator stored-work restore skipped', error)
        return {restored: false, reason: 'restore-error'}
    }
}

async function openCoordinatorPageOnce(options = {}) {
    const coordinatorUrl = getCoordinatorPageUrl()
    const existing = await dedupeCoordinatorTabs(coordinatorTabId)
    if(existing?.tabId) return existing

    const remembered = await getKnownCoordinatorTab(await getStoredCoordinatorTabId())
    if(remembered?.tabId) return remembered

    if(coordinatorTabId) {
        try {
            const tab = await browser.tabs.get(coordinatorTabId)
            if(!tab?.url || tab.url === coordinatorUrl) {
                await rememberCoordinatorTabId(tab.id)
                return {tabId: tab.id, windowId: tab.windowId || null, reused: true}
            }
        }
        catch {
            await forgetCoordinatorTabId(coordinatorTabId)
        }
    }

    const createOptions = {
        url: coordinatorUrl,
        active: false
    }
    if(options.windowId) {
        createOptions.windowId = options.windowId
    }

    try {
        const tab = await browser.tabs.create(createOptions)
        await rememberCoordinatorTabId(tab.id)
        const deduped = await dedupeCoordinatorTabs(tab.id)
        return deduped ? {...deduped, reused: false} : {tabId: tab.id, windowId: tab.windowId || null, reused: false}
    }
    catch(error) {
        if(!createOptions.windowId) throw error
        const tab = await browser.tabs.create({
            url: coordinatorUrl,
            active: false
        })
        await rememberCoordinatorTabId(tab.id)
        const deduped = await dedupeCoordinatorTabs(tab.id)
        return deduped ? {...deduped, reused: false} : {tabId: tab.id, windowId: tab.windowId || null, reused: false}
    }
}

async function enqueueExistingExecutorForCoordinator(items = [], coordinator = {}, options = {}) {
    const ownerTabId = coordinator?.tabId || null
    if(!ownerTabId) return {queued: 0}

    await ownedTabIdsReady
    await profileNukeProgressReady
    await pruneQueuedTabActions(ownerTabId)

    pausedQueuedOwners.delete(ownerTabId)
    queuedTabConcurrency = Math.max(1, Number.parseInt(options.maxConcurrent, 10) || 1)

    const seen = new Set()
    const queuedActionKeys = collectQueuedTabActionKeys(ownerTabId)
    let queued = 0
    const tabAction = options.tabAction || 'nuke'

    for(const item of items || []) {
        const url = normalizeTabTargetUrl(item?.targetProfileHref || item?.requestedUrl || item?.dedupeKey || '')
        const normalizedHref = normalizeQuoraProfileUrl(url)
        if(!url || !normalizedHref || seen.has(normalizedHref)) continue
        seen.add(normalizedHref)
        const actionKey = getQueuedTabActionKey(ownerTabId, normalizedHref, tabAction)
        if(actionKey && queuedActionKeys.has(actionKey)) continue

        const progressRecord = profileNukeProgress?.[normalizedHref] || null
        if(isTerminalProfileNukeRecord(progressRecord) && !isRetryableTerminalProfileNukeRecord(progressRecord)) {
            if(isSuccessfulProfileNukeRecord(progressRecord)) {
                await syncSuccessfulCoordinatorProgress(normalizedHref, progressRecord)
            }
            continue
        }

        queuedTabActions.push({
            url,
            tabAction,
            ownerTabId,
            ownerWindowId: coordinator.windowId || options.ownerWindowId || null,
            noForegroundFallback: !!options.noForegroundFallback,
            retryAttempt: 0,
            maxRetries: STALE_QUEUED_TAB_MAX_RETRIES
        })
        if(actionKey) queuedActionKeys.add(actionKey)
        queued += 1
    }

    void sweepOwnedBlockedProfileTabs(ownerTabId)
    await fillQueuedTabs()
    return {queued}
}

async function getLiveProfileTabHrefs() {
    const tabsByHref = await getLiveProfileTabsByHref()
    return new Set(tabsByHref.keys())
}

async function getLiveProfileTabsByHref() {
    let tabs = []

    try {
        tabs = await browser.tabs.query({url: 'https://*.quora.com/*'})
    }
    catch {
        return new Map()
    }

    const tabsByHref = new Map()
    for(const tab of tabs) {
        const href = normalizeQuoraProfileUrl(tab?.url || '')
        if(!href) continue

        tabsByHref.set(href, [
            ...(tabsByHref.get(href) || []),
            tab
        ])
    }

    return tabsByHref
}

function getCoordinatorItemHref(item = {}) {
    return normalizeQuoraProfileUrl(item?.targetProfileHref || item?.requestedUrl || item?.dedupeKey || '')
}

function shouldResumeCoordinatorItem(item = null, progressRecord = null, liveProfileHrefs = new Set()) {
    if(!item || typeof item !== 'object') return false
    if(isTerminalCoordinatorStatus(item.status)) return false
    if(isTerminalProfileNukeRecord(progressRecord) && !isRetryableTerminalProfileNukeRecord(progressRecord)) return false

    const status = `${item.status || ''}`.trim()
    if(status === 'queued') return true
    if(status !== 'active' && status !== 'settling') return false

    const href = getCoordinatorItemHref(item)
    return !!href && !liveProfileHrefs.has(href)
}

async function resumeCoordinatorQueueExecution(coordinator = {}, options = {}) {
    if(coordinatorResumePromise) return coordinatorResumePromise

    coordinatorResumePromise = resumeCoordinatorQueueExecutionOnce(coordinator, options)
        .finally(() => {
            coordinatorResumePromise = null
        })

    return coordinatorResumePromise
}

async function resumeCoordinatorQueueExecutionOnce(coordinator = {}, options = {}) {
    const existingCoordinator = coordinator?.tabId
        ? coordinator
        : await dedupeCoordinatorTabs(coordinatorTabId)
    const ownerTabId = existingCoordinator?.tabId || null
    if(!ownerTabId) return {queued: 0, pending: 0, reason: 'no-coordinator'}

    coordinatorTabId = ownerTabId

    await ownedTabIdsReady
    await profileNukeProgressReady
    await sweepStaleQueuedTabs()

    if(activeQueuedTabs.size || queuedTabActions.length) {
        await fillQueuedTabs()
        return {
            queued: 0,
            pending: queuedTabActions.length,
            active: activeQueuedTabs.size,
            reason: 'executor-already-running'
        }
    }

    if(!options.skipRepair) {
        await repairCoordinatorStorageFromProgress()
    }

    const stored = await browser.storage.local.get({
        [COORDINATOR_QUEUE_KEY]: {},
        [PROFILE_NUKE_PROGRESS_KEY]: {}
    })
    const queue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY])
    const progress = normalizeStoredProfileNukeProgress(stored[PROFILE_NUKE_PROGRESS_KEY] || {})
    const liveProfileHrefs = await getLiveProfileTabHrefs()
    const pendingItems = []

    profileNukeProgress = progress

    for(const [itemKey, item] of Object.entries(queue)) {
        const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
        if(!href) continue

        const progressRecord = progress[href] || null
        if(isSuccessfulProfileNukeRecord(progressRecord)) {
            await syncSuccessfulCoordinatorProgress(href, progressRecord)
            continue
        }
        if(!shouldResumeCoordinatorItem(item, progressRecord, liveProfileHrefs)) continue

        pendingItems.push({
            ...item,
            targetProfileHref: href,
            requestedUrl: normalizeTabTargetUrl(item?.requestedUrl || href),
            dedupeKey: href
        })
    }

    if(!pendingItems.length) return {queued: 0, pending: 0, reason: 'no-pending-items'}

    return enqueueExistingExecutorForCoordinator(pendingItems, {
        tabId: ownerTabId,
        windowId: existingCoordinator.windowId || null
    }, {
        tabAction: 'nuke',
        maxConcurrent: 1,
        noForegroundFallback: true
    }).then(result => ({
        queued: result.queued || 0,
        pending: pendingItems.length,
        reason: 'resumed-persisted-coordinator-queue'
    }))
}

async function pauseCoordinatorNukes() {
    if(!coordinatorTabId) return null

    const result = await stopOwnerNukes(coordinatorTabId, {
        closeOwnedTabs: false,
        reason: 'coordinator-pause-request'
    })

    return {
        canceledUrls: result.canceledUrls || []
    }
}

function hasStoredCoordinatorWork(queue = {}) {
    return Object.values(queue || {}).some(item => {
        const status = `${item?.status || ''}`.trim()
        return status === 'queued' || status === 'active' || status === 'settling'
    })
}

function getCoordinatorFailureRetryCount(item = {}) {
    return Number.parseInt(item?.retryCount, 10) || 0
}

function getCoordinatorFailureLastRetryAt(item = {}) {
    return Number.parseInt(item?.lastRetryAt, 10) || 0
}

function sortCoordinatorRetryCandidates(left, right) {
    const leftItem = left?.item || {}
    const rightItem = right?.item || {}
    const retryDelta = getCoordinatorFailureRetryCount(leftItem) - getCoordinatorFailureRetryCount(rightItem)
    if(retryDelta) return retryDelta

    const lastRetryDelta = getCoordinatorFailureLastRetryAt(leftItem) - getCoordinatorFailureLastRetryAt(rightItem)
    if(lastRetryDelta) return lastRetryDelta

    const leftTerminalAt = Number.parseInt(leftItem.terminalAt || leftItem.updatedAt || leftItem.createdAt, 10) || 0
    const rightTerminalAt = Number.parseInt(rightItem.terminalAt || rightItem.updatedAt || rightItem.createdAt, 10) || 0
    return leftTerminalAt - rightTerminalAt || `${left?.href || ''}`.localeCompare(`${right?.href || ''}`)
}

function getCoordinatorRetryableFailureCandidates(queue = {}, progress = {}, retryLimit = 2) {
    return Object.entries(queue || {})
        .map(([itemKey, item]) => {
            const href = getCoordinatorItemHref(item) || normalizeQuoraProfileUrl(itemKey)
            return {href, itemKey, item}
        })
        .filter(candidate => {
            const href = candidate.href
            const item = candidate.item
            if(!href || !isRetryableCoordinatorFailure(item)) return false
            if(getCoordinatorFailureRetryCount(item) >= retryLimit) return false

            const progressRecord = progress[href] || null
            if(isSuccessfulProfileNukeRecord(progressRecord)) return false
            if(isExplicitSecurityVerificationRecord(progressRecord)) return false
            if(isTerminalProfileNukeRecord(progressRecord) && !isRetryableTerminalProfileNukeRecord(progressRecord)) return false

            return true
        })
        .sort(sortCoordinatorRetryCandidates)
}

function getCoordinatorRetrySourcePages(items = []) {
    const sourcePages = new Set()

    for(const item of items || []) {
        if(item?.source?.pageUrl) sourcePages.add(item.source.pageUrl)
        for(const source of item?.sources || []) {
            if(source?.pageUrl) sourcePages.add(source.pageUrl)
        }
    }

    return Array.from(sourcePages)
}

async function retryCoordinatorFailedItems(request = {}, sender = {}) {
    const ownerTabId = sender.tab?.id || coordinatorTabId || null
    if(!ownerTabId) return {queued: 0, selected: 0, remainingRetryable: 0, reason: 'no-coordinator'}

    await ownedTabIdsReady
    await profileNukeProgressReady
    await sweepStaleQueuedTabs()
    await repairCoordinatorStorageFromProgress()

    if(activeQueuedTabs.size || queuedTabActions.length) {
        await fillQueuedTabs()
        return {
            queued: 0,
            selected: 0,
            remainingRetryable: 0,
            reason: 'executor-busy'
        }
    }

    const stored = await browser.storage.local.get({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_RUNS_KEY]: {},
        [COORDINATOR_EVENTS_KEY]: [],
        [PROFILE_NUKE_PROGRESS_KEY]: {}
    })
    const queue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY])
    const runs = normalizeCoordinatorMap(stored[COORDINATOR_RUNS_KEY])
    const events = normalizeCoordinatorEvents(stored[COORDINATOR_EVENTS_KEY])
    const progress = normalizeStoredProfileNukeProgress(stored[PROFILE_NUKE_PROGRESS_KEY] || {})

    profileNukeProgress = progress

    if(hasStoredCoordinatorWork(queue)) {
        return {
            queued: 0,
            selected: 0,
            remainingRetryable: getCoordinatorRetryableFailureCandidates(queue, progress, Number.parseInt(request.retryLimit, 10) || 2).length,
            reason: 'queue-busy'
        }
    }

    for(const [href, progressRecord] of Object.entries(progress)) {
        if(isSuccessfulProfileNukeRecord(progressRecord)) {
            await syncSuccessfulCoordinatorProgress(href, progressRecord)
        }
    }

    const retryLimit = Math.max(1, Number.parseInt(request.retryLimit, 10) || 2)
    const maxItems = Math.max(1, Number.parseInt(request.maxItems, 10) || 1)
    const candidates = getCoordinatorRetryableFailureCandidates(queue, progress, retryLimit)
    const selected = candidates.slice(0, maxItems)

    if(!selected.length) {
        return {
            queued: 0,
            selected: 0,
            remainingRetryable: 0,
            reason: 'no-retryable-failed-items'
        }
    }

    const now = Date.now()
    const runId = makeId('retry-failed')
    const selectedItems = selected.map(candidate => {
        const item = candidate.item
        const retryCount = getCoordinatorFailureRetryCount(item) + 1
        const retryReason = `${item.outcome || 'failed'}${item.error ? `: ${item.error}` : ''}`

        const nextItem = {
            ...item,
            runId,
            targetProfileHref: candidate.href,
            dedupeKey: candidate.href,
            requestedUrl: normalizeTabTargetUrl(item.requestedUrl || candidate.href),
            status: 'queued',
            outcome: '',
            error: '',
            updatedAt: now,
            queuedAt: now,
            activeAt: 0,
            terminalAt: 0,
            tabId: null,
            attempt: 0,
            retryCount,
            lastRetryAt: now,
            retryReason,
            milestones: makeEmptyCoordinatorMilestones()
        }

        queue[candidate.href] = nextItem
        return nextItem
    })
    const sourcePages = getCoordinatorRetrySourcePages(selectedItems)
    const targetProfileHrefs = selectedItems.map(item => item.targetProfileHref)

    runs[runId] = {
        id: runId,
        sourceType: 'failed-retry',
        createdAt: now,
        updatedAt: now,
        status: 'active',
        itemCount: selectedItems.length,
        activeCount: 0,
        terminalCount: 0,
        paused: false,
        sourcePages,
        targetProfileHrefs
    }
    Object.assign(runs, recomputeCoordinatorRuns(queue, runs, new Set([runId])))

    events.push({
        id: makeId('event'),
        runId,
        itemId: '',
        type: 'retry',
        message: `Retrying ${selectedItems.length} failed target${selectedItems.length === 1 ? '' : 's'}`,
        at: now,
        details: {
            queued: selectedItems.length,
            retryLimit
        }
    })

    await browser.storage.local.set({
        [COORDINATOR_QUEUE_KEY]: queue,
        [COORDINATOR_RUNS_KEY]: runs,
        [COORDINATOR_EVENTS_KEY]: events.slice(-MAX_COORDINATOR_EVENTS)
    })

    const result = await enqueueExistingExecutorForCoordinator(selectedItems, {
        tabId: ownerTabId,
        windowId: sender.tab?.windowId || null
    }, {
        tabAction: 'nuke',
        maxConcurrent: 1,
        noForegroundFallback: true
    })
    const remainingRetryable = Math.max(0, candidates.length - selectedItems.length)

    return {
        queued: result.queued || 0,
        selected: selectedItems.length,
        remainingRetryable,
        runId,
        reason: (result.queued || 0) > 0 ? 'retry-started' : 'retry-selected-but-not-opened'
    }
}

async function enqueueCoordinatorItems(request = {}, sender = {}) {
    coordinatorEnqueuePromise = coordinatorEnqueuePromise
        .catch(() => {})
        .then(() => enqueueCoordinatorItemsStorage(request))

    const result = await coordinatorEnqueuePromise
    void finishCoordinatorEnqueue(request, sender, result)
        .catch(error => console.info('Mute Block coordinator execution setup failed after durable enqueue', error))
    return result
}

async function enqueueCoordinatorItemsStorage(request = {}) {
    const now = Date.now()
    const runInput = request.run && typeof request.run === 'object' ? request.run : {}
    const runId = runInput.id || makeId('run')
    const source = request.source && typeof request.source === 'object' ? request.source : {}
    const rawItems = Array.isArray(request.items) ? request.items : []

    if(!rawItems.length) return {queued: 0, merged: 0, runId}

    const stored = await browser.storage.local.get({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_RUNS_KEY]: {},
        [COORDINATOR_EVENTS_KEY]: []
    })
    const queue = normalizeCoordinatorMap(stored[COORDINATOR_QUEUE_KEY])
    const runs = normalizeCoordinatorMap(stored[COORDINATOR_RUNS_KEY])
    const events = normalizeCoordinatorEvents(stored[COORDINATOR_EVENTS_KEY])
    let queued = 0
    let merged = 0
    const sourcePages = new Set([...(runs[runId]?.sourcePages || []), source.pageUrl || runInput.sourcePageUrl || ''].filter(Boolean))
    const targetProfileHrefs = new Set(getCoordinatorRunTargetHrefs(runs[runId] || {}))

    for(const rawItem of rawItems) {
        const targetProfileHref = normalizeQuoraProfileUrl(rawItem?.targetProfileHref || rawItem?.requestedUrl || rawItem?.dedupeKey || '')
        if(!targetProfileHref) continue
        targetProfileHrefs.add(targetProfileHref)

        const existing = queue[targetProfileHref] || null
        const itemSource = rawItem.source && typeof rawItem.source === 'object' ? rawItem.source : source
        const incomingSources = [itemSource]
        const incomingEvidence = Array.isArray(rawItem.evidence) ? rawItem.evidence : []
        const terminalExisting = isTerminalCoordinatorStatus(existing?.status)
        const retryExisting = isRetryableCoordinatorFailure(existing)
        const nextItem = {
            ...(existing || {}),
            id: existing?.id || rawItem.id || makeId('item'),
            runId: retryExisting ? runId : existing?.runId || runId,
            dedupeKey: targetProfileHref,
            targetProfileHref,
            requestedUrl: normalizeTabTargetUrl(rawItem?.requestedUrl || targetProfileHref),
            source: existing?.source || itemSource || {},
            sources: mergeCoordinatorSources(existing?.sources || (existing?.source ? [existing.source] : []), incomingSources),
            evidence: mergeCoordinatorEvidence(existing?.evidence || [], incomingEvidence),
            status: retryExisting ? 'queued' : existing && terminalExisting ? existing.status : (existing?.status || 'queued'),
            outcome: retryExisting ? '' : existing?.outcome || '',
            error: retryExisting ? '' : existing?.error || '',
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            queuedAt: retryExisting ? now : existing?.queuedAt || now,
            activeAt: retryExisting ? 0 : existing?.activeAt || 0,
            terminalAt: retryExisting ? 0 : existing?.terminalAt || 0,
            tabId: retryExisting ? null : existing?.tabId || null,
            attempt: retryExisting ? 0 : Number.parseInt(existing?.attempt, 10) || 0,
            maxAttempts: Number.parseInt(existing?.maxAttempts, 10) || 1,
            milestones: retryExisting ? makeEmptyCoordinatorMilestones() : existing?.milestones || makeEmptyCoordinatorMilestones()
        }

        queue[targetProfileHref] = nextItem
        if(existing) merged += 1
        else queued += 1

        if(itemSource?.pageUrl) sourcePages.add(itemSource.pageUrl)
    }

    runs[runId] = {
        ...(runs[runId] || {}),
        id: runId,
        sourceType: runInput.sourceType || source.type || 'space-feed',
        createdAt: runs[runId]?.createdAt || now,
        updatedAt: now,
        status: 'active',
        itemCount: targetProfileHrefs.size || rawItems.length,
        activeCount: Object.values(queue).filter(item => item?.runId === runId && item?.status === 'active').length,
        terminalCount: Object.values(queue).filter(item => item?.runId === runId && isTerminalCoordinatorStatus(item?.status)).length,
        paused: false,
        sourcePages: Array.from(sourcePages),
        targetProfileHrefs: Array.from(targetProfileHrefs)
    }
    Object.assign(runs, recomputeCoordinatorRuns(queue, runs, new Set([runId])))

    events.push({
        id: makeId('event'),
        runId,
        itemId: '',
        type: 'enqueued',
        message: `Enqueued ${queued} new target${queued === 1 ? '' : 's'} and merged ${merged}`,
        at: now,
        details: {
            queued,
            merged,
            sourcePageUrl: source.pageUrl || ''
        }
    })

    await browser.storage.local.set({
        [COORDINATOR_QUEUE_KEY]: queue,
        [COORDINATOR_RUNS_KEY]: runs,
        [COORDINATOR_EVENTS_KEY]: events.slice(-MAX_COORDINATOR_EVENTS)
    })

    return {
        queued,
        merged,
        executionQueued: 0,
        runId,
        coordinatorTabId: null,
        coordinatorWindowId: null,
        coordinatorReused: false,
        executionDeferred: true
    }
}

async function finishCoordinatorEnqueue(request = {}, sender = {}, enqueueResult = {}) {
    const rawItems = Array.isArray(request.items) ? request.items : []
    if(!rawItems.length) return

    const existingProgressRecords = {}
    for(const rawItem of rawItems) {
        const targetProfileHref = normalizeQuoraProfileUrl(rawItem?.targetProfileHref || rawItem?.requestedUrl || rawItem?.dedupeKey || '')
        if(targetProfileHref && profileNukeProgress[targetProfileHref]) {
            existingProgressRecords[targetProfileHref] = profileNukeProgress[targetProfileHref]
        }
    }
    if(Object.keys(existingProgressRecords).length) {
        await enqueueCoordinatorProgressSync(existingProgressRecords)
    }

    const coordinator = await openCoordinatorPage({windowId: sender.tab?.windowId || null})
    const executeOptions = request.execute && typeof request.execute === 'object' ? request.execute : null
    const execution = executeOptions
        ? await enqueueExistingExecutorForCoordinator(rawItems, coordinator, {
            ...executeOptions,
            ownerWindowId: sender.tab?.windowId || null
        })
        : {queued: 0}

    if(!execution.queued && (enqueueResult.queued || enqueueResult.merged)) {
        await resumeCoordinatorQueueExecution(coordinator, {skipRepair: true})
    }
}

function enqueueSpaceFeedStorageUpdate(update) {
    spaceFeedStorageUpdatePromise = spaceFeedStorageUpdatePromise
        .catch(() => {})
        .then(update)

    return spaceFeedStorageUpdatePromise
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

    const successChanged = isSuccessfulProfileNukeRecord(next) && !isSuccessfulProfileNukeRecord(previous)
    if(isTerminalProfileNukeRecord(next) && (successChanged || !(Number.isFinite(next.terminalAt) && next.terminalAt > 0))) {
        next.terminalAt = Date.now()
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
        try {
            await syncCoordinatorProgressRecords(nextProgress)
        }
        catch {}
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
    await syncCoordinatorProgressRecords({[normalizedHref]: nextRecord})
    return nextRecord
}

async function recordProfileNukeProgressBatch(updates = []) {
    await profileNukeProgressReady

    let changed = false
    const nextProgress = {
        ...profileNukeProgress
    }
    const syncedRecords = {}

    for(const update of updates) {
        const normalizedHref = normalizeQuoraProfileUrl(update?.profileHref || update?.href || '')
        if(!normalizedHref) continue

        const nextRecord = normalizeProgressPatch(normalizedHref, update?.patch || {}, nextProgress[normalizedHref] || null)
        if(!nextRecord) continue

        nextProgress[normalizedHref] = nextRecord
        syncedRecords[normalizedHref] = nextRecord
        changed = true
    }

    if(!changed) return false

    profileNukeProgress = nextProgress
    await persistProfileNukeProgress()
    await syncCoordinatorProgressRecords(syncedRecords)
    return true
}

async function removePendingSpaceFeedUrls(urls = []) {
    return enqueueSpaceFeedStorageUpdate(async () => {
        const normalizedUrls = new Set(getNormalizedProfileHrefList(urls))
        if(!normalizedUrls.size) return {changed: false, pendingPosts: null}

        const stored = await browser.storage.local.get({[SPACE_PENDING_NUKED_POSTS_KEY]: {}})
        const currentPending = stored?.[SPACE_PENDING_NUKED_POSTS_KEY] || {}
        let changed = false
        const nextPending = {
            ...currentPending
        }

        for(const [postKey, record] of Object.entries(currentPending || {})) {
            const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
            const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
            const nextAllUrls = allUrls.filter(url => !normalizedUrls.has(normalizeQuoraProfileUrl(url)))
            const nextRemainingUrls = remainingUrls.filter(url => !normalizedUrls.has(normalizeQuoraProfileUrl(url)))

            if(nextAllUrls.length === allUrls.length && nextRemainingUrls.length === remainingUrls.length) {
                continue
            }

            changed = true

            if(nextRemainingUrls.length <= 0) {
                delete nextPending[postKey]
                continue
            }

            nextPending[postKey] = {
                ...record,
                allUrls: nextAllUrls,
                remainingUrls: nextRemainingUrls,
                updatedAt: Date.now()
            }
        }

        if(changed) {
            await browser.storage.local.set({[SPACE_PENDING_NUKED_POSTS_KEY]: nextPending})
        }

        return {changed, pendingPosts: nextPending}
    })
}

async function confirmSpaceFeedProfilesBlocked(profileHrefs = []) {
    return enqueueSpaceFeedStorageUpdate(async () => {
        const confirmedHrefs = new Set(getNormalizedProfileHrefList(profileHrefs))
        if(!confirmedHrefs.size) return {confirmed: false, pendingPosts: null, nukedPosts: null}

        const stored = await browser.storage.local.get({
            [SPACE_PENDING_NUKED_POSTS_KEY]: {},
            [SPACE_NUKED_POSTS_KEY]: {}
        })
        const currentPending = stored?.[SPACE_PENDING_NUKED_POSTS_KEY] || {}
        const currentNuked = stored?.[SPACE_NUKED_POSTS_KEY] || {}
        let changedPending = false
        let changedNuked = false
        const nextPending = {
            ...currentPending
        }
        const nextNuked = {
            ...currentNuked
        }

        for(const [postKey, record] of Object.entries(currentPending || {})) {
            const allUrls = getStoredSpaceFeedRecordUrls(record, 'allUrls')
            const remainingUrls = getStoredSpaceFeedRecordUrls(record, 'remainingUrls')
            const nextRemainingUrls = remainingUrls.filter(url => !confirmedHrefs.has(url))

            if(nextRemainingUrls.length === remainingUrls.length) continue

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
                ...(currentNuked?.[postKey] || {}),
                postKey,
                postUrl: record.postUrl || currentNuked?.[postKey]?.postUrl || '',
                spaceKey: record.spaceKey || currentNuked?.[postKey]?.spaceKey || '',
                spaceUrl: record.spaceUrl || currentNuked?.[postKey]?.spaceUrl || '',
                urls: getNormalizedProfileHrefList(allUrls.length ? allUrls : remainingUrls),
                updatedAt: Date.now()
            }
            changedNuked = true
        }

        if(!changedPending && !changedNuked) {
            await syncCoordinatorProgressForHrefs(confirmedHrefs)
            return {confirmed: false, pendingPosts: nextPending, nukedPosts: nextNuked}
        }

        const prunedNuked = changedNuked
            ? getPrunedNukedPosts(nextNuked, {
                retentionDays: defaults.nukedPostRetentionDays,
                maxEntries: defaults.maxRememberedNukedPosts
            })
            : nextNuked
        const payload = {
            [SPACE_PENDING_NUKED_POSTS_KEY]: nextPending
        }

        if(changedNuked) {
            payload[SPACE_NUKED_POSTS_KEY] = prunedNuked
        }

        await browser.storage.local.set(payload)
        await syncCoordinatorProgressForHrefs(confirmedHrefs)
        return {confirmed: true, pendingPosts: nextPending, nukedPosts: prunedNuked}
    })
}

async function syncCoordinatorProgressForHrefs(profileHrefs = []) {
    const hrefs = getNormalizedProfileHrefList(Array.from(profileHrefs || []))
    if(!hrefs.length) return false

    try {
        const stored = await browser.storage.local.get({[PROFILE_NUKE_PROGRESS_KEY]: {}})
        const progress = normalizeStoredProfileNukeProgress(stored?.[PROFILE_NUKE_PROGRESS_KEY] || {})
        const records = {}

        for(const href of hrefs) {
            if(progress[href]) records[href] = progress[href]
        }

        if(!Object.keys(records).length) return false
        return syncCoordinatorProgressRecords(records)
    }
    catch {
        return false
    }
}

async function syncSuccessfulCoordinatorProgress(profileHref = '', progressRecord = null) {
    const normalizedHref = normalizeQuoraProfileUrl(profileHref)
    if(!normalizedHref) return false

    try {
        const record = progressRecord || profileNukeProgress?.[normalizedHref] || null
        if(record) {
            await syncCoordinatorProgressRecords({[normalizedHref]: record})
        }
        await confirmSpaceFeedProfilesBlocked([normalizedHref])
        return true
    }
    catch {
        return false
    }
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
        active: `${action.tabAction || ''}` === 'nuke' && !action.noForegroundFallback
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
    if(!tabId) return 0
    const metadata = getQueuedTabMetadata(tabId)
    const normalizedReason = `${reason || ''}`.trim()
    const existingCloseRequestedAt = Number.isFinite(metadata?.closeRequestedAt) ? metadata.closeRequestedAt : 0
    const closeRequestedAt = existingCloseRequestedAt || Date.now()

    setQueuedTabMetadata(tabId, {
        closeRequestedAt,
        closeReason: normalizedReason
    })
    if(metadata?.profileHref) {
        const normalizedHref = normalizeQuoraProfileUrl(metadata.profileHref)
        const progressRecord = normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
        const existingProgressCloseRequestedAt = Number.isFinite(progressRecord?.closeRequestedAt) && progressRecord.closeRequestedAt > 0

        void recordProfileNukeProgress(metadata.profileHref, {
            ...(existingProgressCloseRequestedAt ? {} : {closeRequestedAt}),
            closedByExtension: true,
            closeReason: normalizedReason,
            event: `Queued tab close requested${normalizedReason ? ` (${normalizedReason})` : ''}`
        })
    }

    return closeRequestedAt
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
                markQueuedTabClosing(tabId, 'background-blocked-sweep')
                releaseQueuedTab(tabId)
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

function isSuccessfulProfileNukeRecord(record) {
    return !!record && (
        !!record.blockSucceeded ||
        record.status === 'blocked' ||
        record.status === 'already-blocked'
    )
}

function isRetryableTerminalProfileNukeRecord(record) {
    if(!isTerminalProfileNukeRecord(record)) return false
    if(isExplicitSecurityVerificationRecord(record)) return false

    const status = `${record?.status || ''}`.trim()
    if(status === 'interrupted') return true
    if(status === 'error') return true

    return false
}

function isExplicitSecurityVerificationRecord(record = null) {
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

function isTransientProfileNukeStatus(status) {
    return new Set([
        'queued',
        'tab-opening',
        'tab-opened',
        'awaiting-visibility',
        'page-ready',
        'retrying',
        'muting',
        'blocking'
    ]).has(`${status || ''}`.trim())
}

function getProgressHeartbeatAt(record) {
    return Number.isFinite(record?.updatedAt) ? record.updatedAt : 0
}

function hasProgressTimestamp(record, key) {
    return Number.isFinite(record?.[key]) && record[key] > 0
}

function getActiveQueuedTabStaleTimeoutMs(record, metadata = null) {
    const status = `${record?.status || ''}`.trim()
    if(status === 'muting' || status === 'blocking') {
        return STALE_ACTIVE_ACTION_QUEUED_TAB_MS
    }
    if(metadata?.noForegroundFallback) {
        if(!hasProgressTimestamp(record, 'contentOpenedAt')) {
            return STALE_BACKGROUND_OPENING_QUEUED_TAB_MS
        }
        if(!hasProgressTimestamp(record, 'actionReadyAt')) {
            return STALE_BACKGROUND_READY_QUEUED_TAB_MS
        }
        return STALE_ACTIVE_ACTION_QUEUED_TAB_MS
    }

    return STALE_ACTIVE_QUEUED_TAB_MS
}

function getPersistedQueuedTabId(item = null, record = null) {
    return normalizeTabId(record?.tabId || item?.tabId || null)
}

function getPersistedActiveProgressStaleAnchor(record = null) {
    if(!record) return 0

    return Math.max(
        Number.isFinite(record.blockAttemptedAt) ? record.blockAttemptedAt : 0,
        Number.isFinite(record.muteAttemptedAt) ? record.muteAttemptedAt : 0,
        Number.isFinite(record.actionReadyAt) ? record.actionReadyAt : 0,
        Number.isFinite(record.contentOpenedAt) ? record.contentOpenedAt : 0,
        Number.isFinite(record.tabOpenedAt) ? record.tabOpenedAt : 0,
        Number.isFinite(record.tabCreatedAt) ? record.tabCreatedAt : 0
    )
}

function getLiveTabsForProfileHref(liveProfileTabsByHref = new Map(), href = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    return normalizedHref ? liveProfileTabsByHref.get(normalizedHref) || [] : []
}

function shouldReconcileMissingActiveCoordinatorTab(item = null, record = null, href = '', liveProfileTabsByHref = new Map(), now = Date.now()) {
    if(!item || typeof item !== 'object' || !record) return false
    if(isTerminalProfileNukeRecord(record)) return false

    const itemStatus = `${item.status || ''}`.trim()
    if(itemStatus !== 'active' && itemStatus !== 'settling') return false

    const recordStatus = `${record.status || ''}`.trim()
    if(recordStatus === 'queued' || !isTransientProfileNukeStatus(recordStatus)) return false

    const staleAnchor = getPersistedActiveProgressStaleAnchor(record)
    const staleTimeoutMs = getActiveQueuedTabStaleTimeoutMs(record, {
        noForegroundFallback: true
    })
    if(!staleAnchor || now - staleAnchor < staleTimeoutMs) return false

    const tabId = getPersistedQueuedTabId(item, record)
    if(tabId) return true

    return !getLiveTabsForProfileHref(liveProfileTabsByHref, href).length
}

function makeMissingActiveCoordinatorProgressRecord(href = '', record = null, now = Date.now()) {
    const normalizedHref = normalizeQuoraProfileUrl(href || record?.profileHref || '')
    if(!normalizedHref) return null

    return normalizeProgressPatch(normalizedHref, {
        status: 'interrupted',
        finalError: 'Queued tab timed out after disappearing before completion',
        tabClosedAt: now,
        slotReleasedAt: now,
        closedByExtension: true,
        closeReason: 'missing-active-tab',
        event: 'Reconciled missing active queued tab after timeout'
    }, record)
}

function getQueuedTabRetryAttempt(metadata = null, record = null) {
    const metadataAttempt = Number.parseInt(metadata?.retryAttempt, 10)
    const recordAttempt = Number.parseInt(record?.retryAttempt, 10)
    return Math.max(
        Number.isFinite(metadataAttempt) && metadataAttempt > 0 ? metadataAttempt : 0,
        Number.isFinite(recordAttempt) && recordAttempt > 0 ? recordAttempt : 0
    )
}

function getQueuedTabMaxRetries(metadata = null, record = null) {
    const metadataMax = Number.parseInt(metadata?.maxRetries, 10)
    const recordMax = Number.parseInt(record?.maxRetries, 10)
    const fallback = STALE_QUEUED_TAB_MAX_RETRIES
    const maxRetries = Number.isFinite(metadataMax) && metadataMax >= 0
        ? metadataMax
        : Number.isFinite(recordMax) && recordMax >= 0
            ? recordMax
            : fallback

    return Math.max(0, maxRetries)
}

function buildRetryQueuedTabAction(metadata = null, record = null) {
    const url = normalizeTabTargetUrl(metadata?.profileHref || '')
    if(!url) return null
    if(metadata?.ownerTabId && pausedQueuedOwners.has(metadata.ownerTabId)) return null

    const retryAttempt = getQueuedTabRetryAttempt(metadata, record)
    const maxRetries = getQueuedTabMaxRetries(metadata, record)
    if(retryAttempt >= maxRetries) return null

    return {
        url,
        tabAction: metadata?.tabAction || 'nuke',
        ownerTabId: metadata?.ownerTabId || null,
        ownerWindowId: metadata?.ownerWindowId || null,
        noForegroundFallback: !!metadata?.noForegroundFallback,
        retryAttempt: retryAttempt + 1,
        maxRetries
    }
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
        const dropAction = (isTerminalProfileNukeRecord(record) && !isRetryableTerminalProfileNukeRecord(record)) ||
            seenQueuedKeys.has(actionKey)

        if(!dropAction) {
            seenQueuedKeys.add(actionKey)
            continue
        }

        if(actionOwnerTabId && action?.url) {
            rememberCanceledOwnerUrls(actionOwnerTabId, [action.url])
        }
        if(normalizedHref && isSuccessfulProfileNukeRecord(record)) {
            await syncSuccessfulCoordinatorProgress(normalizedHref, record)
        }
        queuedTabActions.splice(index, 1)
    }
}

function getQueuedTabActionKey(ownerTabId, href, tabAction = '') {
    const normalizedHref = normalizeQuoraProfileUrl(href || '')
    if(!ownerTabId || !normalizedHref) return ''
    return `${ownerTabId}|${normalizedHref}|${tabAction || ''}`
}

function collectQueuedTabActionKeys(ownerTabId = null) {
    const keys = new Set()

    for(const tabId of Array.from(activeQueuedTabs)) {
        const metadata = getQueuedTabMetadata(tabId)
        const ownerId = metadata?.ownerTabId || owningParentByChild.get(tabId) || null
        if(ownerTabId && ownerId !== ownerTabId) continue
        const key = getQueuedTabActionKey(ownerId, metadata?.profileHref || '', metadata?.tabAction || '')
        if(key) keys.add(key)
    }

    for(const action of queuedTabActions) {
        const ownerId = action?.ownerTabId || null
        if(ownerTabId && ownerId !== ownerTabId) continue
        const key = getQueuedTabActionKey(ownerId, action?.url || '', action?.tabAction || '')
        if(key) keys.add(key)
    }

    return keys
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
        const staleTimeoutMs = getActiveQueuedTabStaleTimeoutMs(progressRecord, metadata)

        if(progressRecord && isTerminalProfileNukeRecord(progressRecord) && !metadata?.closeRequestedAt) {
            markQueuedTabClosing(tabId, 'terminal-progress-record')
            releaseQueuedTab(tabId)
            try {
                await browser.tabs.remove(tabId)
            }
            catch {}
            continue
        }

        const closeRequestedAt = Number.isFinite(metadata?.closeRequestedAt) ? metadata.closeRequestedAt : 0
        if(closeRequestedAt && now - closeRequestedAt >= STALE_CLOSE_REQUESTED_QUEUED_TAB_MS) {
            releaseQueuedTab(tabId)
            try {
                await browser.tabs.remove(tabId)
            }
            catch {}
            continue
        }

        if(metadata?.closeRequestedAt || !lastUpdatedAt || now - lastUpdatedAt < staleTimeoutMs) {
            continue
        }

        const retryAction = buildRetryQueuedTabAction(metadata, progressRecord)
        const closedAt = Date.now()
        const closeRequestedAtForStale = markQueuedTabClosing(tabId, 'stale-active-tab')
        if(retryAction) {
            setQueuedTabMetadata(tabId, {
                retryRequestedAt: closedAt,
                retryAttempt: retryAction.retryAttempt,
                maxRetries: retryAction.maxRetries
            })
            queuedTabActions.unshift(retryAction)
        }
        if(metadata?.profileHref) {
            await recordProfileNukeProgress(metadata.profileHref, {
                status: retryAction ? 'retrying' : 'interrupted',
                retryAttempt: retryAction ? retryAction.retryAttempt : getQueuedTabRetryAttempt(metadata, progressRecord),
                maxRetries: retryAction ? retryAction.maxRetries : getQueuedTabMaxRetries(metadata, progressRecord),
                finalError: retryAction ? '' : 'Queued tab timed out waiting for completion',
                errorPageUrl: metadata.lastUrl || '',
                closeRequestedAt: closeRequestedAtForStale || closedAt,
                closedByExtension: true,
                closeReason: 'stale-active-tab',
                event: retryAction
                    ? `Queued tab timed out; retrying attempt ${retryAction.retryAttempt + 1} of ${retryAction.maxRetries + 1}`
                    : 'Queued tab closed after timing out waiting for completion'
            })
        }
        try {
            await browser.tabs.remove(tabId)
        }
        catch {}
        releaseQueuedTab(tabId)
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
    const hasWork = active > 0 || owned > 0 || queued > 0
    const paused = hasWork && pausedQueuedOwners.has(parentTabId)
    if(!hasWork) {
        pausedQueuedOwners.delete(parentTabId)
    }
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
    const metadata = getQueuedTabMetadata(tabId)
    pendingTabActions.delete(tabId)

    if(activeQueuedTabs.delete(tabId)) {
        if(metadata?.profileHref) {
            const normalizedHref = normalizeQuoraProfileUrl(metadata.profileHref)
            const progressRecord = normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
            const hasSlotReleasedAt = Number.isFinite(progressRecord?.slotReleasedAt) && progressRecord.slotReleasedAt > 0

            if(!hasSlotReleasedAt) {
                void recordProfileNukeProgress(metadata.profileHref, {
                    slotReleasedAt: Date.now(),
                    event: 'Queued tab slot released'
                })
            }
        }
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

        const normalizedHref = normalizeQuoraProfileUrl(next?.url || '')
        const progressRecord = normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
        if(isTerminalProfileNukeRecord(progressRecord) && !isRetryableTerminalProfileNukeRecord(progressRecord)) {
            if(next.ownerTabId && next.url) {
                rememberCanceledOwnerUrls(next.ownerTabId, [next.url])
            }
            if(isSuccessfulProfileNukeRecord(progressRecord)) {
                await syncSuccessfulCoordinatorProgress(normalizedHref, progressRecord)
            }
            continue
        }

        try {
            void sweepOwnedBlockedProfileTabs(next.ownerTabId)
            const tab = await createOwnedTab(next)
            activeQueuedTabs.add(tab.id)
            pendingTabActions.set(tab.id, {
                action: next.tabAction || null,
                targetUrl: next.url || '',
                noForegroundFallback: !!next.noForegroundFallback
            })
            setQueuedTabMetadata(tab.id, {
                profileHref: normalizeQuoraProfileUrl(next.url),
                ownerTabId: next.ownerTabId || null,
                ownerWindowId: next.ownerWindowId || null,
                tabAction: next.tabAction || null,
                noForegroundFallback: !!next.noForegroundFallback,
                retryAttempt: Number.parseInt(next.retryAttempt, 10) || 0,
                maxRetries: getQueuedTabMaxRetries(next),
                openedAt: Date.now(),
                lastUrl: tab.url || normalizeTabTargetUrl(next.url)
            })
            registerOwnedTab(next.ownerTabId, tab.id)
            await recordProfileNukeProgress(next.url, {
                status: 'tab-opening',
                tabId: tab.id,
                tabCreatedAt: Date.now(),
                tabOpenedAt: Date.now(),
                contentOpenedAt: 0,
                actionReadyAt: 0,
                muteAttemptedAt: 0,
                mutedAt: 0,
                blockAttemptedAt: 0,
                blockedAt: 0,
                terminalAt: 0,
                slotReleasedAt: 0,
                closeRequestedAt: 0,
                tabClosedAt: 0,
                closedByExtension: false,
                closeReason: '',
                finalError: '',
                retryAttempt: Number.parseInt(next.retryAttempt, 10) || 0,
                maxRetries: getQueuedTabMaxRetries(next),
                ownerTabId: next.ownerTabId || null,
                ownerWindowId: next.ownerWindowId || null,
                lastUrl: tab.url || normalizeTabTargetUrl(next.url),
                event: Number.parseInt(next.retryAttempt, 10) > 0
                    ? `Background opened retry attempt ${(Number.parseInt(next.retryAttempt, 10) || 0) + 1}`
                    : 'Background opened a queued tab'
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
    else {
        void restoreCoordinatorPageForPersistentRetry()
        void restoreCoordinatorPageForStoredWork()
    }
})

browser.runtime.onStartup.addListener(() => {
    void restoreCoordinatorPageForPersistentRetry()
    void restoreCoordinatorPageForStoredWork()
})

browser.tabs.onRemoved.addListener(tabId => {
    if(tabId === coordinatorTabId) {
        void forgetCoordinatorTabId(tabId)
    }
    else {
        void forgetRemovedCoordinatorTabId(tabId)
    }

    void ownedTabIdsReady.then(() => {
        const metadata = getQueuedTabMetadata(tabId)
        const isOwnerTab = ownedTabIdsByParent.has(tabId)
        if(metadata?.profileHref) {
            const progressRecord = profileNukeProgress?.[normalizeQuoraProfileUrl(metadata.profileHref)] || null
            const shouldInterruptClosedTransient =
                progressRecord &&
                !isTerminalProfileNukeRecord(progressRecord) &&
                isTransientProfileNukeStatus(progressRecord.status) &&
                !metadata?.retryRequestedAt

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
                const closeRequestedAt = markQueuedTabClosing(tabId, 'browser-error-page')
                releaseQueuedTab(tabId)
                void recordProfileNukeProgress(metadata.profileHref, {
                    status: 'error-page',
                    finalError: 'Queued tab navigated to a browser error page',
                    errorPageUrl,
                    closeRequestedAt,
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

    if(changeInfo.status !== 'loading' || tabId === coordinatorTabId) return

    pausedQueuedOwners.add(tabId)
    const canceledUrls = cancelQueuedOwnerActions(tabId, 'nuke')
    rememberCanceledOwnerUrls(tabId, canceledUrls)
})

browser.storage.onChanged.addListener((changes, areaName) => {
    if(areaName !== 'local') return

    if(changes?.[COORDINATOR_RETRY_FAILED_ENABLED_KEY]?.newValue) {
        void restoreCoordinatorPageForPersistentRetry()
    }
    if(hasStoredCoordinatorWork(normalizeCoordinatorMap(changes?.[COORDINATOR_QUEUE_KEY]?.newValue || {}))) {
        void restoreCoordinatorPageForStoredWork()
    }

    if(!changes?.[PROFILE_NUKE_PROGRESS_KEY]) return

    const nextProgress = normalizeStoredProfileNukeProgress(changes[PROFILE_NUKE_PROGRESS_KEY].newValue || {})
    profileNukeProgress = nextProgress
    void enqueueCoordinatorProgressSync(nextProgress)
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

        return ownedTabIdsReady.then(async () => {
            await profileNukeProgressReady
            pausedQueuedOwners.delete(ownerTabId)
            const requestedConcurrency = Math.max(1, Number.parseInt(request.maxConcurrent, 10) || 1)
            queuedTabConcurrency = requestedConcurrency
            const noForegroundFallback = !!request.noForegroundFallback
            await pruneQueuedTabActions(ownerTabId)
            const queuedActionKeys = collectQueuedTabActionKeys(ownerTabId)
            const tabAction = request.tabAction || null
            let queued = 0

            for(const url of urls) {
                const normalizedHref = normalizeQuoraProfileUrl(url)
                const actionKey = getQueuedTabActionKey(ownerTabId, normalizedHref, tabAction || '')
                if(actionKey && queuedActionKeys.has(actionKey)) continue
                const progressRecord = normalizedHref ? profileNukeProgress?.[normalizedHref] || null : null
                if(isTerminalProfileNukeRecord(progressRecord) && !isRetryableTerminalProfileNukeRecord(progressRecord)) {
                    if(isSuccessfulProfileNukeRecord(progressRecord)) {
                        await syncSuccessfulCoordinatorProgress(normalizedHref, progressRecord)
                    }
                    continue
                }

                queuedTabActions.push({
                    url,
                    tabAction,
                    ownerTabId,
                    ownerWindowId,
                    noForegroundFallback,
                    retryAttempt: 0,
                    maxRetries: STALE_QUEUED_TAB_MAX_RETRIES
                })
                if(actionKey) queuedActionKeys.add(actionKey)
                queued += 1
            }

            void sweepOwnedBlockedProfileTabs(ownerTabId)
            return fillQueuedTabs().then(() => ({queued}))
        })
    }
    else if(request.action === 'enqueue-coordinator-items') {
        return enqueueCoordinatorItems(request, sender)
    }
    else if(request.action === 'open-coordinator') {
        return openCoordinatorPage({windowId: sender.tab?.windowId || null})
    }
    else if(request.action === 'coordinator-page-ready') {
        return dedupeCoordinatorTabs(sender.tab?.id || null).then(async coordinator => ({
            ...(coordinator || {}),
            resume: await resumeCoordinatorQueueExecution(coordinator || {
                tabId: sender.tab?.id || null,
                windowId: sender.tab?.windowId || null
            })
        }))
    }
    else if(request.action === 'pause-coordinator-nukes') {
        return pauseCoordinatorNukes()
    }
    else if(request.action === 'repair-coordinator-storage') {
        return repairCoordinatorStorageFromProgress().then(result => {
            void resumeCoordinatorQueueExecution({
                tabId: sender.tab?.id || null,
                windowId: sender.tab?.windowId || null
            }, {skipRepair: true}).catch(() => null)
            return result
        })
    }
    else if(request.action === 'resume-coordinator-queue') {
        return resumeCoordinatorQueueExecution({
            tabId: sender.tab?.id || null,
            windowId: sender.tab?.windowId || null
        })
    }
    else if(request.action === 'retry-coordinator-failed') {
        return retryCoordinatorFailedItems(request, sender)
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

        if(tabId) {
            markQueuedTabClosing(tabId, 'content-close-request')
            releaseQueuedTab(tabId)
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
    else if(request.action === 'remove-pending-space-feed-urls') {
        return removePendingSpaceFeedUrls(request.urls || []).then(result => ({
            changed: !!result?.changed,
            pendingPosts: result?.pendingPosts || null
        }))
    }
    else if(request.action === 'confirm-space-feed-profiles-blocked') {
        return confirmSpaceFeedProfilesBlocked(request.profileHrefs || request.urls || []).then(result => ({
            confirmed: !!result?.confirmed,
            pendingPosts: result?.pendingPosts || null,
            nukedPosts: result?.nukedPosts || null
        }))
    }
    else if(request.action === 'get-owned-nuke-status') {
        return ownedTabIdsReady.then(async () => {
            await restoreCoordinatorPageForStoredWork({windowId: sender.tab?.windowId || null})
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
