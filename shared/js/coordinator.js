const browser = require('webextension-polyfill')

const COORDINATOR_QUEUE_KEY = 'mbCoordinatorQueue'
const COORDINATOR_RUNS_KEY = 'mbCoordinatorRuns'
const COORDINATOR_EVENTS_KEY = 'mbCoordinatorEvents'
const PROFILE_NUKE_PROGRESS_KEY = 'mbProfileNukeProgress'
const SPACE_PENDING_NUKED_POSTS_KEY = 'mbSpacePendingNukedPosts'
const SPACE_NUKED_POSTS_KEY = 'mbSpaceNukedPosts'
const SPACE_REGISTRY_KEY = 'mbSpaceRegistry'
const HIDDEN_RUNS_KEY = 'mbCoordinatorHiddenRunIds'
const COORDINATOR_RETRY_FAILED_ENABLED_KEY = 'mbCoordinatorRetryFailedEnabled'
const COORDINATOR_RESUME_INTERVAL_MS = 5000
const COORDINATOR_FAILED_RETRY_INTERVAL_MS = 5000

const state = {
    queue: {},
    runs: {},
    events: [],
    profileProgress: {},
    pendingPosts: {},
    rememberedPosts: {},
    spaceRegistry: {},
    hiddenRunIds: []
}
let resumeCoordinatorQueueTimer = null
let resumeCoordinatorQueuePromise = null
let coordinatorRepairTimer = null
let coordinatorRepairPromise = null
let retryFailedActive = false
let retryFailedTimer = null
let retryFailedPromise = null
let retryFailedLastResult = null

addEventListener('load', () => {
    void init()
})

async function init() {
    const manifest = browser.runtime.getManifest()
    document.getElementById('appVersion').textContent = `v${manifest.version}`
    document.getElementById('clearEventsButton')?.addEventListener('click', () => {
        void clearEvents()
    })
    document.getElementById('clearCompletedRunsButton')?.addEventListener('click', () => {
        void clearCompletedRuns()
    })
    document.getElementById('retryFailedButton')?.addEventListener('click', () => {
        void toggleRetryFailed()
    })

    installStorageChangeListener()
    await loadState()
    if(retryFailedActive && !retryFailedLastResult) {
        retryFailedLastResult = {reason: 'resumed'}
    }
    render()

    void announceCoordinatorPageReady()
    void repairCoordinatorStorageAfterInitialRender()
    if(retryFailedActive) {
        void runRetryFailedNow()
    }
}

function installStorageChangeListener() {
    browser.storage.onChanged.addListener(changes => {
        let changed = false

        if(changes[COORDINATOR_QUEUE_KEY]) {
            state.queue = normalizeObject(changes[COORDINATOR_QUEUE_KEY].newValue)
            changed = true
        }
        if(changes[COORDINATOR_RUNS_KEY]) {
            state.runs = normalizeObject(changes[COORDINATOR_RUNS_KEY].newValue)
            changed = true
        }
        if(changes[COORDINATOR_EVENTS_KEY]) {
            state.events = normalizeEvents(changes[COORDINATOR_EVENTS_KEY].newValue)
            changed = true
        }
        if(changes[PROFILE_NUKE_PROGRESS_KEY]) {
            state.profileProgress = normalizeObject(changes[PROFILE_NUKE_PROGRESS_KEY].newValue)
            changed = true
            if(hasRepairableProgressMismatch()) {
                scheduleCoordinatorStorageRepair()
            }
        }
        if(changes[SPACE_PENDING_NUKED_POSTS_KEY]) {
            state.pendingPosts = normalizeObject(changes[SPACE_PENDING_NUKED_POSTS_KEY].newValue)
            changed = true
        }
        if(changes[SPACE_NUKED_POSTS_KEY]) {
            state.rememberedPosts = normalizeObject(changes[SPACE_NUKED_POSTS_KEY].newValue)
            changed = true
        }
        if(changes[SPACE_REGISTRY_KEY]) {
            state.spaceRegistry = normalizeObject(changes[SPACE_REGISTRY_KEY].newValue)
            changed = true
        }
        if(changes[HIDDEN_RUNS_KEY]) {
            state.hiddenRunIds = normalizeStringList(changes[HIDDEN_RUNS_KEY].newValue)
            changed = true
        }
        if(changes[COORDINATOR_RETRY_FAILED_ENABLED_KEY]) {
            const wasActive = retryFailedActive
            retryFailedActive = !!changes[COORDINATOR_RETRY_FAILED_ENABLED_KEY].newValue
            if(retryFailedActive) {
                if(!wasActive && !retryFailedLastResult) {
                    retryFailedLastResult = {reason: 'resumed'}
                }
                scheduleRetryFailed(0)
            }
            else {
                clearTimeout(retryFailedTimer)
                retryFailedTimer = null
                if(wasActive && (!retryFailedLastResult || retryFailedLastResult.reason === 'resumed')) {
                    retryFailedLastResult = {reason: 'stopped'}
                }
            }
            changed = true
        }

        if(changed) render()
    })
}

async function sendRuntimeMessageWithTimeout(message, fallback = null, timeoutMs = 5000) {
    const timeoutMarker = {timedOut: true}
    const timeout = new Promise(resolve => setTimeout(() => resolve(timeoutMarker), timeoutMs))
    const result = await Promise.race([
        browser.runtime.sendMessage(message),
        timeout
    ])

    return result === timeoutMarker ? fallback : result
}

async function announceCoordinatorPageReady() {
    try {
        await sendRuntimeMessageWithTimeout({action: 'coordinator-page-ready'}, null, 5000)
    }
    catch {}
}

async function repairCoordinatorStorage() {
    try {
        const result = await sendRuntimeMessageWithTimeout({action: 'repair-coordinator-storage'}, null, 5000)
        if(result?.queueChanged || result?.runsChanged) {
            await loadState()
            return true
        }
    }
    catch {}

    return false
}

async function repairCoordinatorStorageAfterInitialRender() {
    if(await repairCoordinatorStorage()) {
        render()
    }
}

function scheduleCoordinatorStorageRepair(delay = 1000) {
    clearTimeout(coordinatorRepairTimer)
    coordinatorRepairTimer = setTimeout(() => {
        coordinatorRepairTimer = null
        void repairCoordinatorStorageQueued()
    }, delay)
}

async function repairCoordinatorStorageQueued() {
    if(coordinatorRepairPromise) return coordinatorRepairPromise

    coordinatorRepairPromise = repairCoordinatorStorage()
        .then(repaired => {
            if(repaired) render()
            return repaired
        })
        .finally(() => {
            coordinatorRepairPromise = null
        })

    return coordinatorRepairPromise
}

async function loadState() {
    const stored = await browser.storage.local.get({
        [COORDINATOR_QUEUE_KEY]: {},
        [COORDINATOR_RUNS_KEY]: {},
        [COORDINATOR_EVENTS_KEY]: [],
        [PROFILE_NUKE_PROGRESS_KEY]: {},
        [SPACE_PENDING_NUKED_POSTS_KEY]: {},
        [SPACE_NUKED_POSTS_KEY]: {},
        [SPACE_REGISTRY_KEY]: {},
        [HIDDEN_RUNS_KEY]: [],
        [COORDINATOR_RETRY_FAILED_ENABLED_KEY]: false
    })

    state.queue = normalizeObject(stored[COORDINATOR_QUEUE_KEY])
    state.runs = normalizeObject(stored[COORDINATOR_RUNS_KEY])
    state.events = normalizeEvents(stored[COORDINATOR_EVENTS_KEY])
    state.profileProgress = normalizeObject(stored[PROFILE_NUKE_PROGRESS_KEY])
    state.pendingPosts = normalizeObject(stored[SPACE_PENDING_NUKED_POSTS_KEY])
    state.rememberedPosts = normalizeObject(stored[SPACE_NUKED_POSTS_KEY])
    state.spaceRegistry = normalizeObject(stored[SPACE_REGISTRY_KEY])
    state.hiddenRunIds = normalizeStringList(stored[HIDDEN_RUNS_KEY])
    retryFailedActive = !!stored[COORDINATOR_RETRY_FAILED_ENABLED_KEY]
}

function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeEvents(value) {
    if(Array.isArray(value)) return value.filter(event => event && typeof event === 'object')
    const objectValue = normalizeObject(value)
    return Object.values(objectValue).filter(event => event && typeof event === 'object')
}

function normalizeStringList(value) {
    return Array.isArray(value) ? value.map(item => `${item || ''}`.trim()).filter(Boolean) : []
}

function render() {
    const queueItems = getDisplayQueueItems()
    const runItems = getDisplayRuns(queueItems)
    const queuedCount = queueItems.filter(item => item?.status === 'queued').length
    const activeCount = queueItems.filter(item => item?.status === 'active' || item?.status === 'settling').length
    const terminalCount = queueItems.filter(isTerminalQueueItem).length
    const failedCount = queueItems.filter(item => item?.status === 'failed').length
    const retryableFailedCount = queueItems.filter(isRetryableFailedQueueItem).length

    setText('queuedCount', queuedCount)
    setText('activeCount', activeCount)
    setText('terminalCount', terminalCount)
    setText('eventCount', state.events.length)
    setText('eventListCount', `${state.events.length} event${state.events.length === 1 ? '' : 's'}`)
    setText('runCount', `${runItems.length} run${runItems.length === 1 ? '' : 's'}`)
    setText('queueCount', `${queueItems.length} item${queueItems.length === 1 ? '' : 's'}`)
    setText('retryFailedCount', `${retryableFailedCount} retryable / ${failedCount} failed`)
    setText('legacyCount', `${Object.keys(state.profileProgress).length} records`)
    setText('profileProgressCount', Object.keys(state.profileProgress).length)
    setText('pendingPostCount', Object.keys(state.pendingPosts).length)
    setText('rememberedPostCount', Object.keys(state.rememberedPosts).length)
    setText('refreshState', `Updated ${formatTime(Date.now())}`)

    renderRuns(runItems)
    renderEvents()
    renderQueue(queueItems)
    syncCoordinatorQueueResume(queueItems)
    syncRetryFailedControls(queueItems, retryableFailedCount)
}

async function clearEvents() {
    await browser.storage.local.set({[COORDINATOR_EVENTS_KEY]: []})
    state.events = []
    render()
}

async function clearCompletedRuns() {
    const runItems = getDisplayRuns(getDisplayQueueItems(), {includeHidden: true})
    const nextHiddenRunIds = new Set(state.hiddenRunIds || [])

    for(const run of runItems) {
        const runId = run?.id || run?.runId || ''
        if(runId && `${run.status || ''}` === 'complete') {
            nextHiddenRunIds.add(runId)
        }
    }

    state.hiddenRunIds = Array.from(nextHiddenRunIds)
    await browser.storage.local.set({[HIDDEN_RUNS_KEY]: state.hiddenRunIds})
    render()
}

function hasPendingCoordinatorQueueWork(queueItems = []) {
    return queueItems.some(item => {
        const status = `${item?.status || ''}`.trim()
        return status === 'queued' || status === 'active' || status === 'settling'
    })
}

function hasRawPendingCoordinatorQueueWork() {
    return Object.values(state.queue || {}).some(item => {
        const status = `${item?.status || ''}`.trim()
        return status === 'queued' || status === 'active' || status === 'settling'
    })
}

function isRetryableFailedQueueItem(item = null) {
    if(`${item?.status || ''}` !== 'failed') return false
    const outcome = `${item?.outcome || ''}`.trim()
    if(outcome === 'security-verification') return false
    if(outcome === 'timeout' || outcome === 'action-error') return true

    return /timeout|timed out|stale|interrupted/i.test(`${item?.error || ''}`)
}

function syncRetryFailedControls(queueItems = [], retryableFailedCount = 0) {
    const button = document.getElementById('retryFailedButton')
    if(button) {
        button.textContent = retryFailedActive ? 'Stop Retry' : 'Retry Failed'
        button.disabled = !retryFailedActive && (
            retryableFailedCount <= 0 ||
            hasPendingCoordinatorQueueWork(queueItems) ||
            hasRawPendingCoordinatorQueueWork()
        )
    }

    const lastReason = retryFailedLastResult?.reason || ''
    const stateText = retryFailedActive
        ? `Idle retry is on; next check every ${Math.round(COORDINATOR_FAILED_RETRY_INTERVAL_MS / 1000)}s${lastReason ? ` (${lastReason})` : ''}`
        : `Idle retry is off${lastReason ? ` (${lastReason})` : ''}`
    setText('retryFailedState', stateText)
}

async function toggleRetryFailed() {
    if(retryFailedActive) {
        stopRetryFailed('stopped')
        return
    }

    retryFailedActive = true
    retryFailedLastResult = {reason: 'starting'}
    render()
    await browser.storage.local.set({[COORDINATOR_RETRY_FAILED_ENABLED_KEY]: true})
    void runRetryFailedNow()
}

function stopRetryFailed(reason = 'idle', {persist = true} = {}) {
    retryFailedActive = false
    clearTimeout(retryFailedTimer)
    retryFailedTimer = null
    retryFailedLastResult = {reason}
    render()
    if(persist) {
        void browser.storage.local.set({[COORDINATOR_RETRY_FAILED_ENABLED_KEY]: false})
    }
}

function scheduleRetryFailed(delay = COORDINATOR_FAILED_RETRY_INTERVAL_MS) {
    clearTimeout(retryFailedTimer)
    retryFailedTimer = setTimeout(() => {
        retryFailedTimer = null
        void runRetryFailedNow()
    }, delay)
}

async function runRetryFailedNow() {
    if(!retryFailedActive) return null
    if(retryFailedPromise) return retryFailedPromise

    const queueItems = getDisplayQueueItems()
    if(hasPendingCoordinatorQueueWork(queueItems) || hasRawPendingCoordinatorQueueWork()) {
        retryFailedLastResult = {reason: 'waiting-for-idle'}
        render()
        scheduleRetryFailed()
        return null
    }

    retryFailedPromise = sendRuntimeMessageWithTimeout({
        action: 'retry-coordinator-failed',
        maxItems: 1,
        retryLimit: 2
    }, {queued: 0, reason: 'retry-message-timeout'}, 10000)
        .catch(error => ({queued: 0, reason: `${error?.message || error || 'retry-failed'}`}))
        .then(async result => {
            retryFailedLastResult = result || {reason: 'no-result'}
            await loadState()
            render()

            if(!retryFailedActive) return result
            if((result?.queued || 0) > 0 || result?.reason === 'queue-busy' || result?.reason === 'executor-busy') {
                scheduleRetryFailed()
            }
            else if((result?.remainingRetryable || 0) > 0) {
                scheduleRetryFailed()
            }
            else {
                scheduleRetryFailed()
            }

            return result
        })
        .finally(() => {
            retryFailedPromise = null
        })

    return retryFailedPromise
}

function syncCoordinatorQueueResume(queueItems = []) {
    const hasPendingDisplayWork = hasPendingCoordinatorQueueWork(queueItems)
    const hasPendingStoredWork = hasRawPendingCoordinatorQueueWork()

    if(!hasPendingDisplayWork && !hasPendingStoredWork) {
        if(resumeCoordinatorQueueTimer) {
            clearInterval(resumeCoordinatorQueueTimer)
            resumeCoordinatorQueueTimer = null
        }
        return
    }

    void resumeCoordinatorQueue()

    if(!resumeCoordinatorQueueTimer) {
        resumeCoordinatorQueueTimer = setInterval(() => {
            void resumeCoordinatorQueue()
        }, COORDINATOR_RESUME_INTERVAL_MS)
    }
}

async function resumeCoordinatorQueue() {
    if(resumeCoordinatorQueuePromise) return resumeCoordinatorQueuePromise

    resumeCoordinatorQueuePromise = sendRuntimeMessageWithTimeout({action: 'resume-coordinator-queue'}, null, 5000)
        .catch(() => null)
        .finally(() => {
            resumeCoordinatorQueuePromise = null
        })

    return resumeCoordinatorQueuePromise
}

function getDisplayQueueItems() {
    return Object.entries(state.queue || {}).map(([key, item]) => mergeQueueItemProgress(key, item))
}

function getQueueItemHref(key = '', item = {}) {
    return `${item?.targetProfileHref || item?.requestedUrl || item?.dedupeKey || key || ''}`.trim()
}

function getRunTargetHrefs(run = {}) {
    return Array.isArray(run?.targetProfileHrefs)
        ? run.targetProfileHrefs.map(href => `${href || ''}`.trim()).filter(Boolean)
        : []
}

function getRunQueueItems(queueItems = [], runId = '', run = {}) {
    const targetHrefs = new Set(getRunTargetHrefs(run))

    return queueItems.filter(item => {
        if(item?.runId === runId) return true
        if(!targetHrefs.size) return false

        return targetHrefs.has(getQueueItemHref('', item))
    })
}

function getDisplayRuns(queueItems, options = {}) {
    const runs = {
        ...state.runs
    }
    const runIdsWithQueueItems = new Set()
    const hiddenRunIds = new Set(options.includeHidden ? [] : state.hiddenRunIds || [])
    const candidateRunIds = new Set(Object.keys(runs))

    for(const item of queueItems) {
        const runId = item?.runId || ''
        if(!runId) continue
        candidateRunIds.add(runId)
    }

    for(const runId of candidateRunIds) {
        const existing = runs[runId] || {
            id: runId,
            sourceType: 'space-feed',
            createdAt: 0,
            updatedAt: 0,
            status: 'active',
            sourcePages: []
        }
        const runItems = getRunQueueItems(queueItems, runId, existing)
        const targetHrefs = getRunTargetHrefs(existing)
        if(!runItems.length && !targetHrefs.length) continue

        runIdsWithQueueItems.add(runId)
        const terminalCount = runItems.filter(isTerminalQueueItem).length
        const activeCount = runItems.filter(candidate => candidate?.status === 'active' || candidate?.status === 'settling').length
        const latestItemUpdatedAt = runItems.reduce((latest, item) => {
            const updatedAt = Number.parseInt(item.updatedAt || item.createdAt, 10) || 0
            return Math.max(latest, updatedAt)
        }, 0)

        runs[runId] = {
            ...existing,
            itemCount: targetHrefs.length || runItems.length,
            activeCount,
            terminalCount,
            status: runItems.length > 0 && terminalCount === runItems.length ? 'complete' : existing.status || 'active',
            submittedAt: getRunSubmitTime(runId, existing),
            updatedAt: Math.max(Number.parseInt(existing.updatedAt, 10) || 0, latestItemUpdatedAt)
        }
    }

    return Object.values(runs)
        .filter(run => runIdsWithQueueItems.has(run?.id || run?.runId || ''))
        .filter(run => !hiddenRunIds.has(run?.id || run?.runId || ''))
        .map(run => ({
            ...run,
            submittedAt: getRunSubmitTime(run?.id || run?.runId || '', run)
        }))
}

function mergeQueueItemProgress(key, item) {
    const source = item && typeof item === 'object' ? item : {}
    const progress = state.profileProgress?.[key] || state.profileProgress?.[source.targetProfileHref] || state.profileProgress?.[source.dedupeKey] || null
    if(!progress) return source

    const mapped = mapProgressToQueueState(progress)
    if(!mapped.status) return source

    return {
        ...source,
        status: mapped.status,
        outcome: mapped.outcome || source.outcome || '',
        error: mapped.error || source.error || '',
        updatedAt: Math.max(Number.parseInt(source.updatedAt, 10) || 0, Number.parseInt(progress.updatedAt, 10) || 0),
        terminalAt: mapped.terminal
            ? Number.parseInt(progress.terminalAt || progress.tabClosedAt || progress.updatedAt, 10) || source.terminalAt || 0
            : source.terminalAt || 0,
        milestones: {
            ...(source.milestones || {}),
            tabCreatedAt: progress.tabCreatedAt || source.milestones?.tabCreatedAt || 0,
            navigationStartedAt: progress.tabOpenedAt || source.milestones?.navigationStartedAt || 0,
            contentOpenedAt: progress.contentOpenedAt || source.milestones?.contentOpenedAt || 0,
            actionClaimedAt: progress.contentOpenedAt || source.milestones?.actionClaimedAt || 0,
            profileReadyAt: progress.actionReadyAt || source.milestones?.profileReadyAt || 0,
            muteAttemptedAt: progress.muteAttemptedAt || source.milestones?.muteAttemptedAt || 0,
            blockAttemptedAt: progress.blockAttemptedAt || source.milestones?.blockAttemptedAt || 0,
            closeRequestedAt: progress.closeRequestedAt || source.milestones?.closeRequestedAt || 0,
            tabClosedAt: progress.tabClosedAt || source.milestones?.tabClosedAt || 0
        }
    }
}

function hasRepairableProgressMismatch() {
    for(const [key, item] of Object.entries(state.queue || {})) {
        const merged = mergeQueueItemProgress(key, item)
        if(merged === item) continue
        if(`${merged.status || ''}` !== `${item?.status || ''}`) return true
        if(`${merged.outcome || ''}` !== `${item?.outcome || ''}`) return true
        if(`${merged.error || ''}` !== `${item?.error || ''}`) return true
        if((Number.parseInt(merged.terminalAt, 10) || 0) !== (Number.parseInt(item?.terminalAt, 10) || 0)) return true
    }

    return false
}

function mapProgressToQueueState(record) {
    const status = `${record?.status || ''}`.trim()
    if(!record) return {status: '', outcome: '', error: '', terminal: false}

    if(record.blockSucceeded || status === 'blocked' || status === 'already-blocked') {
        return {
            status: 'succeeded',
            outcome: status === 'already-blocked' ? 'already-blocked' : 'blocked',
            error: '',
            terminal: true
        }
    }
    if(status === 'profile-unavailable') {
        return {
            status: 'skipped',
            outcome: 'profile-unavailable',
            error: record.finalError || record.unavailableReason || '',
            terminal: true
        }
    }
    if(isExplicitSecurityVerificationRecord(record)) {
        return {
            status: 'failed',
            outcome: 'security-verification',
            error: record.finalError || '',
            terminal: true
        }
    }
    if(status === 'error-page') {
        return {
            status: 'failed',
            outcome: 'error-page',
            error: record.finalError || record.errorPageUrl || '',
            terminal: true
        }
    }
    if(status === 'error' || status === 'interrupted') {
        const error = record.finalError || record.muteError || record.blockError || ''
        return {
            status: 'failed',
            outcome: /timeout|timed out|stale/i.test(error) ? 'timeout' : 'action-error',
            error,
            terminal: true
        }
    }
    if(['tab-opening', 'tab-opened', 'page-ready', 'muting', 'blocking', 'retrying'].includes(status)) {
        return {status: 'active', outcome: '', error: '', terminal: false}
    }
    if(status === 'queued') {
        return {status: 'queued', outcome: '', error: '', terminal: false}
    }

    return {status: '', outcome: '', error: '', terminal: false}
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

function isTerminalQueueItem(item) {
    return ['succeeded', 'failed', 'skipped', 'canceled', 'complete'].includes(`${item?.status || ''}`)
}

function setText(id, value) {
    const element = document.getElementById(id)
    if(element) element.textContent = `${value}`
}

function renderRuns(runs) {
    const container = document.getElementById('runList')
    if(!container) return

    const sortedRuns = [...runs].sort((left, right) => getRunSubmitTime(right?.id || right?.runId || '', right) - getRunSubmitTime(left?.id || left?.runId || '', left))
    replaceChildren(container, sortedRuns.map(run => {
        const runId = run.id || run.runId || ''
        const submittedAt = getRunSubmitTime(runId, run)
        const sourceLabel = getRunSourceLabel(run)
        const row = document.createElement('div')
        row.className = 'row'
        row.append(
            buildTitleCell(sourceLabel, `${runId || 'run'}${submittedAt ? ` • submitted ${formatDateTime(submittedAt)}` : ''}`),
            buildBadge(run.status || 'unknown'),
            buildTextCell(`${Number.parseInt(run.itemCount, 10) || 0} items`),
            buildTextCell(submittedAt ? formatDateTime(submittedAt) : '')
        )
        return row
    }), 'No coordinator runs yet.')
}

function renderEvents() {
    const container = document.getElementById('eventList')
    if(!container) return

    const sortedEvents = [...state.events].sort((left, right) => getTime(right) - getTime(left))
    replaceChildren(container, sortedEvents.map(event => {
        const sourceLabel = getEventSourceLabel(event)
        const row = document.createElement('div')
        row.className = 'row row--event'
        row.append(
            buildTitleCell(event.message || event.type || 'Event', `${sourceLabel}${event.runId ? ` • ${event.runId}` : ''}`),
            buildBadge(event.type || 'event'),
            buildTextCell(formatEventDetails(event)),
            buildTextCell(formatDateTime(event.at))
        )
        return row
    }), 'No coordinator events.')
}

function renderQueue(items) {
    const container = document.getElementById('queueList')
    if(!container) return

    const sortedItems = [...items].sort((left, right) => getTime(right) - getTime(left))
    replaceChildren(container, sortedItems.map(item => {
        const row = document.createElement('div')
        row.className = 'row'
        row.append(
            buildTitleCell(item.targetProfileHref || item.requestedUrl || item.id || 'Queue item', item.source?.pageUrl || ''),
            buildBadge(item.status || 'unknown'),
            buildTextCell(item.outcome || item.error || ''),
            buildTextCell(formatTime(item.updatedAt || item.createdAt))
        )
        return row
    }), 'No coordinator queue items yet.')
}

function getRunSubmitTime(runId = '', run = {}) {
    const event = state.events.find(candidate => candidate?.runId && candidate.runId === runId)
    return Number.parseInt(event?.at || run?.submittedAt || run?.createdAt, 10) || 0
}

function getRunSourceLabel(run = {}) {
    const sourcePages = Array.isArray(run.sourcePages) ? run.sourcePages : []
    const sourcePage = sourcePages[0] || ''
    return getSourceLabelFromUrl(sourcePage) || `${run.sourceType || 'unknown'} source`
}

function getEventSourceLabel(event = {}) {
    return getSourceLabelFromUrl(event?.details?.sourcePageUrl || '') || 'Unknown source'
}

function getSourceLabelFromUrl(url = '') {
    if(!url) return ''

    for(const record of Object.values(state.spaceRegistry || {})) {
        if(!record || typeof record !== 'object') continue
        if(record.url && sameOriginUrl(record.url, url)) return record.name || record.slug || record.url
    }

    try {
        const host = new URL(url).hostname.replace(/\.quora\.com$/i, '')
        if(!host || host === 'www') return 'Quora'
        return host
            .split(/[-_]/)
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
    }
    catch {
        return ''
    }
}

function sameOriginUrl(left = '', right = '') {
    try {
        return new URL(left).origin === new URL(right).origin
    }
    catch {
        return false
    }
}

function formatEventDetails(event = {}) {
    const details = event.details || {}
    const queued = Number.parseInt(details.queued, 10)
    const merged = Number.parseInt(details.merged, 10)
    const parts = []

    if(Number.isFinite(queued)) parts.push(`${queued} new`)
    if(Number.isFinite(merged)) parts.push(`${merged} merged`)
    return parts.join(', ')
}

function replaceChildren(container, children, emptyText) {
    container.replaceChildren()

    if(children.length) {
        container.append(...children)
        return
    }

    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = emptyText
    container.append(empty)
}

function buildTitleCell(title, subtitle) {
    const cell = document.createElement('div')
    const titleNode = document.createElement('div')
    const subtitleNode = document.createElement('div')
    titleNode.className = 'row-title'
    subtitleNode.className = 'row-subtitle'
    titleNode.textContent = title || ''
    subtitleNode.textContent = subtitle || ''
    cell.append(titleNode, subtitleNode)
    return cell
}

function buildBadge(value) {
    const badge = document.createElement('span')
    const normalized = `${value || 'unknown'}`.toLowerCase()
    badge.className = `badge badge--${normalized.replace(/[^a-z0-9_-]/g, '-')}`
    badge.textContent = normalized
    return badge
}

function buildTextCell(value) {
    const cell = document.createElement('div')
    cell.className = 'row-subtitle'
    cell.textContent = `${value || ''}`
    return cell
}

function getTime(record) {
    return Number.parseInt(record?.updatedAt || record?.createdAt || record?.at, 10) || 0
}

function formatTime(value) {
    const timestamp = Number.parseInt(value, 10)
    if(!timestamp) return ''
    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    })
}

function formatDateTime(value) {
    const timestamp = Number.parseInt(value, 10)
    if(!timestamp) return ''
    return new Date(timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    })
}
