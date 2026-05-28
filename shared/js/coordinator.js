const browser = require('webextension-polyfill')

const COORDINATOR_QUEUE_VIEW_KEY = 'mbCoordinatorQueueView'
const COORDINATOR_RUNS_KEY = 'mbCoordinatorRuns'
const COORDINATOR_EVENTS_KEY = 'mbCoordinatorEvents'
const QUEUE_WAKEUP_METRICS_VIEW_KEY = 'mbQueueWakeupMetricsView'
const SPACE_REGISTRY_KEY = 'mbSpaceRegistry'
const HIDDEN_RUNS_KEY = 'mbCoordinatorHiddenRunIds'
const COORDINATOR_RETRY_FAILED_ENABLED_KEY = 'mbCoordinatorRetryFailedEnabled'
const COORDINATOR_PAUSED_KEY = 'mbCoordinatorPaused'
const COORDINATOR_RESUME_INTERVAL_MS = 5000
const DASHBOARD_COMPACT_REFRESH_INTERVAL_MS = 2000
const DASHBOARD_COMPACT_REFRESH_PUSH_DELAY_MS = 100
const RETRY_FAILED_LIMIT = 2
const SECONDS_PER_BLOCK_SAMPLE_LIMIT = 100

const state = {
    queue: {},
    queueView: {},
    queueCounts: {},
    queueTotal: 0,
    queueTruncated: false,
    runs: {},
    events: [],
    metrics: {},
    spaceRegistry: {},
    hiddenRunIds: [],
    paused: false,
    loading: true,
    loadError: '',
    requiresQuoraVisit: false,
    requiresQuoraVisitAt: 0,
    quoraActivationCounterBaseline: 0,
    quoraActivationMetricBaselineKnown: false
}
let resumeCoordinatorQueueTimer = null
let resumeCoordinatorQueuePromise = null
let coordinatorRepairTimer = null
let coordinatorRepairPromise = null
let dashboardCompactRefreshTimer = null
let dashboardCompactRefreshScheduledTimer = null
let dashboardCompactRefreshPromise = null
let retryFailedActive = false
let retryFailedLastResult = null
let currentWorkPausePending = ''

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
    document.getElementById('resetMetricsButton')?.addEventListener('click', () => {
        void resetMetrics()
    })
    document.getElementById('retryFailedButton')?.addEventListener('click', () => {
        void toggleRetryFailed()
    })
    document.getElementById('requeueFailedButton')?.addEventListener('click', () => {
        void requeueFailed()
    })
    document.getElementById('pauseCurrentWorkButton')?.addEventListener('click', () => {
        void toggleCurrentWorkPause()
    })
    document.getElementById('cancelCurrentWorkButton')?.addEventListener('click', () => {
        void cancelCurrentWork()
    })
    document.getElementById('startCoordinatorButton')?.addEventListener('click', () => {
        void startQuoraRuntime()
    })
    document.getElementById('openPreferencesButton')?.addEventListener('click', () => {
        void openPreferences()
    })
    installPanelToggleListeners()
    installPanelWheelScrollListeners()
    installDashboardRuntimeRefreshListener()

    installCompactStorageRefreshPolling()
    render()
    const ready = await announceCoordinatorPageReady()
    setQuoraVisitRequirement(!ready || !!ready?.requiresQuoraVisit)

    try {
        await loadState()
        captureQuoraActivationMetricBaseline()
        state.loadError = ''
    }
    catch(error) {
        state.loadError = error?.message || `${error || ''}` || 'Dashboard storage load failed'
    }
    state.loading = false
    if(retryFailedActive && !retryFailedLastResult) {
        retryFailedLastResult = {reason: 'resumed'}
    }
    render()

    if(!state.requiresQuoraVisit && hasRawPendingCoordinatorQueueWork()) {
        void repairCoordinatorStorageAfterInitialRender()
    }
}

function installCompactStorageRefreshPolling() {
    if(dashboardCompactRefreshTimer) return
    addEventListener('pagehide', stopCompactStorageRefreshPolling)
    addEventListener('beforeunload', stopCompactStorageRefreshPolling)
    dashboardCompactRefreshTimer = setInterval(() => {
        scheduleDashboardCompactRefresh()
    }, DASHBOARD_COMPACT_REFRESH_INTERVAL_MS)
}

function stopCompactStorageRefreshPolling() {
    if(!dashboardCompactRefreshTimer) return
    clearInterval(dashboardCompactRefreshTimer)
    dashboardCompactRefreshTimer = null
    if(dashboardCompactRefreshScheduledTimer) {
        clearTimeout(dashboardCompactRefreshScheduledTimer)
        dashboardCompactRefreshScheduledTimer = null
    }
}

function installDashboardRuntimeRefreshListener() {
    if(!browser.runtime?.onMessage?.addListener) return
    browser.runtime.onMessage.addListener(message => {
        if(`${message?.action || ''}` !== 'coordinator-dashboard-state-changed') return
        scheduleDashboardCompactRefresh(DASHBOARD_COMPACT_REFRESH_PUSH_DELAY_MS)
    })
}

function scheduleDashboardCompactRefresh(delay = 0) {
    if(dashboardCompactRefreshScheduledTimer) return
    dashboardCompactRefreshScheduledTimer = setTimeout(() => {
        dashboardCompactRefreshScheduledTimer = null
        void refreshDashboardStateFromCompactStorage()
    }, Math.max(0, Number.parseInt(delay, 10) || 0))
}

async function refreshDashboardStateFromCompactStorage() {
    if(state.loading) return false
    if(dashboardCompactRefreshPromise) return dashboardCompactRefreshPromise

    dashboardCompactRefreshPromise = loadState()
        .then(() => {
            state.loadError = ''
            render()
            return true
        })
        .catch(error => {
            state.loadError = error?.message || `${error || ''}` || 'Dashboard storage refresh failed'
            render()
            return false
        })
        .finally(() => {
            dashboardCompactRefreshPromise = null
        })

    return dashboardCompactRefreshPromise
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

function installPanelToggleListeners() {
    document.querySelectorAll('[data-panel-toggle]').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-panel-target') || ''
            const target = targetId ? document.getElementById(targetId) : null
            if(!target) return

            const expanded = button.getAttribute('aria-expanded') !== 'false'
            const nextExpanded = !expanded
            const panel = target.closest('.panel')
            button.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false')
            button.textContent = nextExpanded ? 'v' : '>'
            const panelLabel = targetId === 'queueList' ? 'Current Work' : targetId.replace(/List$/, '')
            button.setAttribute('aria-label', `${nextExpanded ? 'Collapse' : 'Expand'} ${panelLabel}`)
            target.hidden = !nextExpanded
            if(panel) {
                panel.classList.toggle('panel--collapsed', !nextExpanded)
            }
        })
    })
}

function installPanelWheelScrollListeners() {
    document.querySelectorAll('[data-panel-scroll-target]').forEach(panel => {
        panel.addEventListener('wheel', event => {
            if(event.defaultPrevented) return
            const targetId = panel.getAttribute('data-panel-scroll-target') || ''
            const scrollTarget = targetId ? document.getElementById(targetId) : null
            if(!scrollTarget || scrollTarget.hidden) return
            if(scrollTarget.contains(event.target)) return
            if(scrollTarget.scrollHeight <= scrollTarget.clientHeight) return

            scrollTarget.scrollBy({
                top: event.deltaY,
                left: event.deltaX,
                behavior: 'auto'
            })
            event.preventDefault()
        }, {passive: false})
    })
}

async function openPreferences() {
    const url = browser.runtime.getURL('popup.html')
    await browser.tabs.create({url, active: true}).catch(() => {
        window.open(url, '_blank', 'noopener')
    })
}

async function startQuoraRuntime() {
    const button = document.getElementById('startCoordinatorButton')
    flashButton(button)
    retryFailedLastResult = {reason: 'opening-quora'}
    render()
    await browser.tabs.create({
        url: 'https://www.quora.com/',
        active: true
    }).catch(() => {
        window.open('https://www.quora.com/', '_blank', 'noopener')
    })
}

async function announceCoordinatorPageReady() {
    try {
        return await sendRuntimeMessageWithTimeout({action: 'coordinator-page-ready'}, null, 5000)
    }
    catch {}
    return null
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

async function resetMetrics() {
    try {
        const result = await sendRuntimeMessageWithTimeout({action: 'reset-queue-wakeup-metrics'}, null, 5000)
        if(result?.reset) {
            await loadState()
            render()
        }
    }
    catch(error) {
        console.warn('Failed to reset metrics', error)
    }
}

async function loadState() {
    const stored = await browser.storage.local.get({
        [COORDINATOR_QUEUE_VIEW_KEY]: {},
        [COORDINATOR_RUNS_KEY]: {},
        [COORDINATOR_EVENTS_KEY]: [],
        [QUEUE_WAKEUP_METRICS_VIEW_KEY]: {},
        [SPACE_REGISTRY_KEY]: {},
        [HIDDEN_RUNS_KEY]: [],
        [COORDINATOR_RETRY_FAILED_ENABLED_KEY]: false,
        [COORDINATOR_PAUSED_KEY]: false
    })

    if(hasCoordinatorQueueView(stored[COORDINATOR_QUEUE_VIEW_KEY])) {
        applyCoordinatorQueueView(stored[COORDINATOR_QUEUE_VIEW_KEY])
    }
    else {
        await refreshCompactQueueView()
    }
    state.runs = normalizeObject(stored[COORDINATOR_RUNS_KEY])
    state.events = normalizeEvents(stored[COORDINATOR_EVENTS_KEY])
    if(hasQueueWakeupMetricsView(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY])) {
        state.metrics = normalizeMetrics(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY])
    }
    else {
        await refreshCompactMetricsView()
    }
    state.spaceRegistry = normalizeObject(stored[SPACE_REGISTRY_KEY])
    state.hiddenRunIds = normalizeStringList(stored[HIDDEN_RUNS_KEY])
    retryFailedActive = !!stored[COORDINATOR_RETRY_FAILED_ENABLED_KEY]
    state.paused = !!stored[COORDINATOR_PAUSED_KEY]
}

async function refreshCompactQueueView() {
    const result = await sendRuntimeMessageWithTimeout({
        action: 'refresh-coordinator-queue-view',
        reason: 'dashboard-load-missing-view'
    }, null, 10000)
    if(hasCoordinatorQueueView(result?.view)) {
        applyCoordinatorQueueView(result.view)
        return true
    }

    const stored = await browser.storage.local.get({[COORDINATOR_QUEUE_VIEW_KEY]: {}})
    if(hasCoordinatorQueueView(stored[COORDINATOR_QUEUE_VIEW_KEY])) {
        applyCoordinatorQueueView(stored[COORDINATOR_QUEUE_VIEW_KEY])
        return true
    }

    applyCoordinatorQueueView({
        version: 1,
        updatedAt: Date.now(),
        total: 0,
        counts: {},
        itemLimit: 0,
        truncated: false,
        items: []
    })
    return false
}

function hasCoordinatorQueueView(value = state.queueView) {
    return !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Number.parseInt(value.version, 10) >= 1 &&
        Array.isArray(value.items)
}

async function refreshCompactMetricsView() {
    const result = await sendRuntimeMessageWithTimeout({
        action: 'refresh-queue-wakeup-metrics-view',
        reason: 'dashboard-load-missing-view'
    }, null, 10000)
    if(hasQueueWakeupMetricsView(result?.view)) {
        state.metrics = normalizeMetrics(result.view)
        return true
    }

    const stored = await browser.storage.local.get({[QUEUE_WAKEUP_METRICS_VIEW_KEY]: {}})
    if(hasQueueWakeupMetricsView(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY])) {
        state.metrics = normalizeMetrics(stored[QUEUE_WAKEUP_METRICS_VIEW_KEY])
        return true
    }

    state.metrics = normalizeMetrics({})
    return false
}

function hasQueueWakeupMetricsView(value = state.metrics) {
    return !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Number.parseInt(value.version, 10) >= 1 &&
        Number.parseInt(value.viewVersion, 10) >= 1 &&
        !!value.currentEpoch
}

function applyCoordinatorQueueView(value = {}) {
    const view = hasCoordinatorQueueView(value) ? value : {}
    const items = Array.isArray(view.items) ? view.items : []
    state.queueView = view
    state.queue = Object.fromEntries(items
        .filter(item => item && typeof item === 'object')
        .map((item, index) => {
            const storageKey = `${item.storageKey || item.targetProfileHref || item.requestedUrl || item.dedupeKey || item.id || `view-item-${index}`}`.trim()
            return [storageKey, {...item, storageKey}]
        }))
    state.queueCounts = normalizeObject(view.counts)
    state.queueTotal = Number.parseInt(view.total, 10) || items.length
    state.queueTruncated = view.truncated === true
}

function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeEvents(value) {
    if(Array.isArray(value)) return value.filter(event => event && typeof event === 'object')
    const objectValue = normalizeObject(value)
    return Object.values(objectValue).filter(event => event && typeof event === 'object')
}

function normalizeMetrics(value) {
    const metrics = normalizeObject(value)
    const currentEpoch = normalizeObject(metrics.currentEpoch)
    if(Object.keys(currentEpoch).length) {
        return {
            ...metrics,
            currentEpoch: {
                ...currentEpoch,
                counters: normalizeObject(currentEpoch.counters),
                phases: normalizeObject(currentEpoch.phases),
                journal: Array.isArray(currentEpoch.journal)
                    ? currentEpoch.journal.filter(entry => entry && typeof entry === 'object')
                    : []
            },
            previousEpochs: Array.isArray(metrics.previousEpochs)
                ? metrics.previousEpochs.filter(entry => entry && typeof entry === 'object')
                : [],
            lifetime: normalizeObject(metrics.lifetime)
        }
    }

    return {
        ...metrics,
        counters: normalizeObject(metrics.counters),
        phases: normalizeObject(metrics.phases),
        journal: Array.isArray(metrics.journal)
            ? metrics.journal.filter(entry => entry && typeof entry === 'object')
            : []
    }
}

function normalizeStringList(value) {
    return Array.isArray(value) ? value.map(item => `${item || ''}`.trim()).filter(Boolean) : []
}

function countQueueStatuses(items = []) {
    const counts = {}
    for(const item of items || []) {
        const status = `${item?.status || ''}`.trim() || 'unknown'
        counts[status] = (counts[status] || 0) + 1
    }
    return counts
}

function getQueueStatusCount(status = '', queueItems = []) {
    if(hasCoordinatorQueueView()) return Number(state.queueCounts?.[status]) || 0
    return queueItems.filter(item => `${item?.status || ''}`.trim() === status).length
}

function getQueueTerminalCount(queueItems = []) {
    if(hasCoordinatorQueueView()) {
        return Object.entries(state.queueCounts || {})
            .filter(([status]) => isTerminalQueueStatus(status))
            .reduce((total, [, count]) => total + (Number(count) || 0), 0)
    }
    return queueItems.filter(isTerminalQueueItem).length
}

function getQueueTotalCount(queueItems = []) {
    return hasCoordinatorQueueView() ? Number(state.queueTotal) || queueItems.length : queueItems.length
}

function render() {
    const queueItems = getDisplayQueueItems()
    const runItems = getDisplayRuns(queueItems)
    refreshQuoraVisitRequirement(queueItems)
    const queuedCount = getQueueStatusCount('queued', queueItems)
    const activeCount = getQueueStatusCount('opening', queueItems) +
        getQueueStatusCount('active', queueItems) +
        getQueueStatusCount('acting', queueItems) +
        getQueueStatusCount('settling', queueItems)
    const terminalCount = getQueueTerminalCount(queueItems)
    const secondsPerBlock = getSecondsPerActualBlock(queueItems, getCurrentMetricsEpochStartedAt())
    const failedCount = getQueueStatusCount('failed', queueItems)
    const succeededCount = getQueueStatusCount('succeeded', queueItems)
    const retryableFailureShapeCount = queueItems.filter(isRetryableFailedQueueItem).length
    const retryableFailedCount = queueItems.filter(isEligibleRetryFailedQueueItem).length
    const exhaustedRetryableFailedCount = Math.max(0, retryableFailureShapeCount - retryableFailedCount)
    const hardFailedCount = Math.max(0, failedCount - retryableFailedCount)

    setText('queuedCount', queuedCount)
    setText('currentWorkReadyCount', getCurrentWorkSummaryText(queueItems, {
        queuedCount,
        succeededCount,
        retryableFailedCount,
        hardFailedCount
    }))
    setText('activeCount', activeCount)
    setText('secondsPerBlock', formatSecondsPerBlock(secondsPerBlock))
    setText('terminalCount', terminalCount)
    setText('eventCount', state.events.length)
    setText('eventListCount', `${state.events.length} event${state.events.length === 1 ? '' : 's'}`)
    setText('runCount', `${runItems.length} run${runItems.length === 1 ? '' : 's'}`)
    const queueTotalCount = getQueueTotalCount(queueItems)
    setText('queueCount', `${queueTotalCount} job${queueTotalCount === 1 ? '' : 's'}${state.queueTruncated ? ` (${queueItems.length} shown)` : ''}`)
    setText('refreshState', getRefreshStateText())

    renderRuns(runItems)
    renderEvents()
    renderWakeupMetrics(queueItems)
    renderQueue(queueItems)
    syncCoordinatorQueueResume(queueItems)
    syncRetryFailedControls(queueItems, retryableFailedCount, exhaustedRetryableFailedCount)
    syncRequeueFailedControls(failedCount)
    syncCurrentWorkPauseControls(queueItems)
    syncStartCoordinatorControls()
}

function getCurrentWorkSummaryText(queueItems = [], counts = {}) {
    const totalCount = getQueueTotalCount(queueItems)
    const shownCount = state.queueTruncated ? queueItems.length : totalCount
    const showingText = state.queueTruncated
        ? `Showing ${shownCount} of ${totalCount}`
        : `Showing ${totalCount}`
    const queuedCount = Number.parseInt(counts.queuedCount, 10) || 0
    const succeededCount = Number.parseInt(counts.succeededCount, 10) || 0
    const softFailedCount = Number.parseInt(counts.retryableFailedCount, 10) || 0
    const hardFailedCount = Number.parseInt(counts.hardFailedCount, 10) || 0

    return `${showingText}, ${queuedCount} queued, ${succeededCount} succeeded, ${softFailedCount} soft-fail, ${hardFailedCount} hard-fail`
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
        return isPendingQueueStatus(status)
    })
}

function hasRawPendingCoordinatorQueueWork() {
    if(hasCoordinatorQueueView()) {
        return getQueueStatusCount('queued') > 0 ||
            getQueueStatusCount('opening') > 0 ||
            getQueueStatusCount('active') > 0 ||
            getQueueStatusCount('acting') > 0 ||
            getQueueStatusCount('settling') > 0
    }
    return Object.values(state.queue || {}).some(item => {
        const status = `${item?.status || ''}`.trim()
        return isPendingQueueStatus(status)
    })
}

function hasActiveCoordinatorQueueWork(queueItems = []) {
    return queueItems.some(isActiveQueueItem)
}

function hasRawActiveCoordinatorQueueWork() {
    if(hasCoordinatorQueueView()) {
        return getQueueStatusCount('opening') > 0 ||
            getQueueStatusCount('active') > 0 ||
            getQueueStatusCount('acting') > 0 ||
            getQueueStatusCount('settling') > 0
    }
    return Object.values(state.queue || {}).some(isActiveQueueItem)
}

function getQueuedCoordinatorQueueCount() {
    if(hasCoordinatorQueueView()) return getQueueStatusCount('queued')
    return Object.values(state.queue || {}).filter(item => `${item?.status || ''}`.trim() === 'queued').length
}

function isRetryableFailedQueueItem(item = null) {
    if(`${item?.status || ''}` !== 'failed') return false
    const outcome = `${item?.outcome || ''}`.trim()
    if(outcome === 'security-verification') return false
    if(outcome === 'timeout' || outcome === 'action-error') return true

    return /timeout|timed out|stale|interrupted/i.test(`${item?.error || ''}`)
}

function getRetryFailedCount(item = null) {
    return Number.parseInt(item?.retryCount, 10) || 0
}

function isEligibleRetryFailedQueueItem(item = null) {
    return isRetryableFailedQueueItem(item) && getRetryFailedCount(item) < RETRY_FAILED_LIMIT
}

function syncRetryFailedControls(queueItems = [], retryableFailedCount = 0, exhaustedRetryableFailedCount = 0) {
    const hasPendingWork = hasPendingCoordinatorQueueWork(queueItems) || hasRawPendingCoordinatorQueueWork()
    const hasActiveWork = hasActiveCoordinatorQueueWork(queueItems) || hasRawActiveCoordinatorQueueWork()
    const waitText = getRetryFailedWorkWaitText({hasPendingWork, hasActiveWork})
    const button = document.getElementById('retryFailedButton')
    if(button) {
        button.textContent = retryFailedActive ? 'Disable Retry Soft-Fails' : 'Enable Retry Soft-Fails'
        button.setAttribute('aria-pressed', retryFailedActive ? 'true' : 'false')
        button.title = retryFailedActive ? 'Turn soft-fail retry off' : 'Turn soft-fail retry on'
        button.disabled = false
    }

    const lastReason = retryFailedLastResult?.reason || ''
    let stateText = ''
    if(retryFailedActive && waitText) {
        stateText = `Soft-fail retry on; ${waitText}${lastReason ? ` (${lastReason})` : ''}`
    }
    else if(retryFailedActive && retryableFailedCount <= 0 && exhaustedRetryableFailedCount > 0) {
        stateText = `Soft-fail retry on; retry limit reached for ${exhaustedRetryableFailedCount} failure${exhaustedRetryableFailedCount === 1 ? '' : 's'}${lastReason ? ` (${lastReason})` : ''}`
    }
    else if(retryFailedActive && retryableFailedCount <= 0) {
        stateText = `Soft-fail retry on; no soft-failures${lastReason ? ` (${lastReason})` : ''}`
    }
    else if(retryFailedActive) {
        stateText = `Soft-fail retry on${lastReason ? ` (${lastReason})` : ''}`
    }
    else if(waitText) {
        stateText = `Soft-fail retry off; ${waitText}${lastReason ? ` (${lastReason})` : ''}`
    }
    else if(retryableFailedCount <= 0 && exhaustedRetryableFailedCount > 0) {
        stateText = `Soft-fail retry off; retry limit reached for ${exhaustedRetryableFailedCount} failure${exhaustedRetryableFailedCount === 1 ? '' : 's'}${lastReason ? ` (${lastReason})` : ''}`
    }
    else if(retryableFailedCount <= 0) {
        stateText = `Soft-fail retry off; no soft-failures${lastReason ? ` (${lastReason})` : ''}`
    }
    else {
        stateText = `Soft-fail retry off${lastReason ? ` (${lastReason})` : ''}`
    }
    setText('retryFailedState', stateText)
}

function syncStartCoordinatorControls() {
    const button = document.getElementById('startCoordinatorButton')
    if(!button) return

    button.hidden = !state.requiresQuoraVisit
    button.disabled = state.loading
    button.title = state.requiresQuoraVisit
        ? 'Open Quora to start Current Work'
        : 'Quora runtime is available'
}

function getRetryFailedWorkWaitText({hasPendingWork = false, hasActiveWork = false} = {}) {
    if(!hasPendingWork) return ''
    if(state.requiresQuoraVisit) return 'waiting for first Quora page'
    if(hasActiveWork) return 'waiting for current work to idle'
    return 'queued work is waiting to start'
}

function syncRequeueFailedControls(failedCount = 0) {
    const button = document.getElementById('requeueFailedButton')
    if(!button) return

    button.disabled = failedCount <= 0
    button.title = failedCount > 0
        ? `Reset and requeue ${failedCount} failed Current Work job${failedCount === 1 ? '' : 's'}`
        : 'No failed Current Work jobs to requeue'
}

async function requeueFailed() {
    const failedCount = getQueueStatusCount('failed', getDisplayQueueItems())
    if(failedCount <= 0) {
        retryFailedLastResult = {reason: 'no-failed-current-work'}
        render()
        return
    }

    const button = document.getElementById('requeueFailedButton')
    if(button) button.disabled = true
    retryFailedLastResult = {reason: 'requeueing-failed'}
    render()

    const result = await sendRuntimeMessageWithTimeout({
        action: 'requeue-coordinator-failed'
    }, null, 10000).catch(error => ({
        error: error?.message || `${error || ''}`
    }))

    retryFailedLastResult = {
        reason: result?.error
            ? 'requeue-failed'
            : `requeued-${Number.parseInt(result?.selected, 10) || 0}`
    }
    await loadState()
    render()
}

async function cancelCurrentWorkItem(item = {}) {
    if(!isPendingQueueStatus(`${item?.status || ''}`.trim())) return

    const storageKey = `${item.storageKey || ''}`.trim()
    const profileHref = getQueueItemHref('', item)
    retryFailedLastResult = {reason: 'canceling-one-current-work'}
    render()

    const result = await sendRuntimeMessageWithTimeout({
        action: 'cancel-coordinator-current-work-item',
        storageKey,
        coordinatorKey: storageKey,
        profileHref
    }, null, 10000).catch(error => ({
        error: error?.message || `${error || ''}`
    }))

    retryFailedLastResult = {
        reason: result?.error
            ? 'cancel-one-current-work-failed'
            : `canceled-${(Number.parseInt(result?.canceledUrls?.length, 10) || 0) + (Number.parseInt(result?.canceledWorkKeys?.length, 10) || 0)}`
    }
    await loadState()
    render()
}

async function requeueFailedItem(item = {}) {
    if(`${item?.status || ''}` !== 'failed') return

    const storageKey = `${item.storageKey || ''}`.trim()
    const profileHref = getQueueItemHref('', item)
    retryFailedLastResult = {reason: 'requeueing-one-failed'}
    render()

    const result = await sendRuntimeMessageWithTimeout({
        action: 'requeue-coordinator-failed',
        storageKey,
        coordinatorKey: storageKey,
        profileHref
    }, null, 10000).catch(error => ({
        error: error?.message || `${error || ''}`
    }))

    retryFailedLastResult = {
        reason: result?.error
            ? 'requeue-failed'
            : `requeued-${Number.parseInt(result?.selected, 10) || 0}`
    }
    await loadState()
    render()
}

function getPendingCurrentWorkItems() {
    return getDisplayQueueItems().filter(item => isPendingQueueStatus(`${item?.status || ''}`.trim()))
}

function syncCurrentWorkPauseControls(queueItems = []) {
    const pendingCount = queueItems.filter(item => isPendingQueueStatus(`${item?.status || ''}`.trim())).length
    const pauseButton = document.getElementById('pauseCurrentWorkButton')
    const pauseState = document.getElementById('pauseCurrentWorkState')
    const cancelButton = document.getElementById('cancelCurrentWorkButton')
    const pausePending = currentWorkPausePending === 'pause'
    const resumePending = currentWorkPausePending === 'resume'

    if(pauseButton) {
        pauseButton.textContent = pausePending
            ? 'Pausing...'
            : resumePending
                ? 'Resuming...'
                : state.paused ? 'Resume' : 'Pause'
        pauseButton.disabled = pausePending || resumePending || (!state.paused && pendingCount <= 0)
        pauseButton.setAttribute('aria-pressed', state.paused ? 'true' : 'false')
        pauseButton.setAttribute('aria-busy', pausePending || resumePending ? 'true' : 'false')
        pauseButton.classList.toggle('clear-button--pause-active', state.paused)
        pauseButton.title = pausePending
            ? 'Pause request sent; waiting for Current Work to stop'
            : resumePending
                ? 'Resume request sent; waiting for Current Work to continue'
                : state.paused
                    ? 'Resume paused Current Work'
            : pendingCount > 0
                ? 'Pause Current Work without canceling jobs'
                : 'No pending Current Work to pause'
    }

    if(pauseState) {
        pauseState.textContent = pausePending
            ? 'Pausing...'
            : resumePending
                ? 'Resuming...'
                : state.paused ? 'Paused' : 'Running'
        pauseState.classList.toggle('pause-state--paused', state.paused && !pausePending && !resumePending)
        pauseState.classList.toggle('pause-state--pending', pausePending || resumePending)
    }

    if(cancelButton) {
        cancelButton.disabled = pendingCount <= 0
        cancelButton.title = pendingCount > 0
            ? `Cancel ${pendingCount} pending Current Work job${pendingCount === 1 ? '' : 's'}`
            : 'No pending Current Work to cancel'
    }
}

function flashButton(button) {
    if(!button) return

    button.classList.remove('clear-button--flash')
    void button.offsetWidth
    button.classList.add('clear-button--flash')
    setTimeout(() => button.classList.remove('clear-button--flash'), 700)
}

async function toggleCurrentWorkPause() {
    const button = document.getElementById('pauseCurrentWorkButton')
    flashButton(button)

    const wasPaused = state.paused
    currentWorkPausePending = wasPaused ? 'resume' : 'pause'
    render()
    const action = state.paused ? 'resume-paused-coordinator-nukes' : 'pause-coordinator-nukes'
    const result = await sendRuntimeMessageWithTimeout({action}, null, 10000).catch(error => ({
        error: error?.message || `${error || ''}`
    }))
    retryFailedLastResult = {
        reason: result?.error
            ? (wasPaused ? 'resume-failed' : 'pause-failed')
            : wasPaused ? 'resumed-current-work' : 'paused-current-work'
    }
    currentWorkPausePending = ''
    await loadState()
    render()
}

async function cancelCurrentWork() {
    const pendingCount = getPendingCurrentWorkItems().length
    if(pendingCount <= 0) {
        retryFailedLastResult = {reason: 'no-pending-current-work'}
        render()
        return
    }

    const button = document.getElementById('cancelCurrentWorkButton')
    if(button) button.disabled = true
    retryFailedLastResult = {reason: 'canceling-current-work'}
    render()

    const result = await sendRuntimeMessageWithTimeout({
        action: 'cancel-coordinator-current-work'
    }, null, 10000).catch(error => ({
        error: error?.message || `${error || ''}`
    }))

    retryFailedLastResult = {
        reason: result?.error
            ? 'cancel-current-work-failed'
            : `canceled-${(Number.parseInt(result?.canceledUrls?.length, 10) || 0) + (Number.parseInt(result?.canceledWorkKeys?.length, 10) || 0)}`
    }
    await loadState()
    render()
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
    retryFailedLastResult = {reason: 'service-worker-scheduled'}
    render()
}

function stopRetryFailed(reason = 'idle', {persist = true} = {}) {
    retryFailedActive = false
    retryFailedLastResult = {reason}
    render()
    if(persist) {
        void browser.storage.local.set({[COORDINATOR_RETRY_FAILED_ENABLED_KEY]: false})
    }
}

function syncCoordinatorQueueResume(queueItems = []) {
    if(state.loading || state.requiresQuoraVisit) {
        if(resumeCoordinatorQueueTimer) {
            clearInterval(resumeCoordinatorQueueTimer)
            resumeCoordinatorQueueTimer = null
        }
        return
    }

    if(state.paused) {
        if(resumeCoordinatorQueueTimer) {
            clearInterval(resumeCoordinatorQueueTimer)
            resumeCoordinatorQueueTimer = null
        }
        return
    }

    const hasPendingDisplayWork = hasPendingCoordinatorQueueWork(queueItems)
    const hasPendingStoredWork = hasRawPendingCoordinatorQueueWork()

    if(!hasPendingDisplayWork && !hasPendingStoredWork) {
        if(resumeCoordinatorQueueTimer) {
            clearInterval(resumeCoordinatorQueueTimer)
            resumeCoordinatorQueueTimer = null
        }
        return
    }

    if(!resumeCoordinatorQueueTimer) {
        void resumeCoordinatorQueue()
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
    return Object.entries(state.queue || {}).map(([key, item]) => {
        const source = item && typeof item === 'object' ? item : {}
        return {
            ...source,
            storageKey: key
        }
    })
}

function getQueueItemHref(key = '', item = {}) {
    return `${item?.targetProfileHref || item?.requestedUrl || item?.dedupeKey || item?.storageKey || key || ''}`.trim()
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
        const displayTargetHrefs = targetHrefs.length
            ? targetHrefs
            : runItems.map(item => getQueueItemHref('', item)).filter(Boolean)
        if(!runItems.length && !targetHrefs.length) continue

        runIdsWithQueueItems.add(runId)
        const terminalCount = runItems.filter(isTerminalQueueItem).length
        const activeCount = runItems.filter(isActiveQueueItem).length
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
            updatedAt: Math.max(Number.parseInt(existing.updatedAt, 10) || 0, latestItemUpdatedAt),
            displayTargetProfileHrefs: displayTargetHrefs
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

function isTerminalQueueItem(item) {
    return isTerminalQueueStatus(item?.status)
}

function isTerminalQueueStatus(status = '') {
    return ['succeeded', 'failed', 'skipped', 'canceled', 'complete'].includes(`${status || ''}`)
}

function isActiveQueueItem(item = {}) {
    return ['opening', 'active', 'acting', 'settling'].includes(`${item?.status || ''}`.trim())
}

function isActualBlockSuccess(item = {}) {
    if(`${item?.status || ''}` !== 'succeeded') return false
    if(`${item?.outcome || ''}` === 'blocked') return true

    const milestones = item?.milestones || {}
    return Number.parseInt(item?.blockAttemptedAt || milestones.blockAttemptedAt, 10) > 0
}

function getCurrentMetricsEpochStartedAt() {
    const metrics = state.metrics || {}
    const currentEpoch = metrics.currentEpoch || metrics
    return Number.parseInt(currentEpoch.startedAt, 10) || 0
}

function getCurrentMetricsEpoch() {
    const metrics = state.metrics || {}
    return metrics.currentEpoch || metrics
}

function getCurrentMetricsCounter(name = '') {
    const counters = getCurrentMetricsEpoch().counters || {}
    return Number.parseInt(counters[name], 10) || 0
}

function setQuoraVisitRequirement(required = false) {
    if(required) {
        if(!state.requiresQuoraVisit) {
            state.requiresQuoraVisitAt = Date.now()
        }
        state.requiresQuoraVisit = true
        state.quoraActivationCounterBaseline = 0
        state.quoraActivationMetricBaselineKnown = false
        return
    }

    state.requiresQuoraVisit = false
    state.requiresQuoraVisitAt = 0
    state.quoraActivationCounterBaseline = 0
    state.quoraActivationMetricBaselineKnown = false
}

function captureQuoraActivationMetricBaseline() {
    if(!state.requiresQuoraVisit) return

    state.quoraActivationCounterBaseline = getCurrentMetricsCounter('runtime.quoraActivated')
    state.quoraActivationMetricBaselineKnown = true
}

function hasCurrentEpochQuoraActivationMetric() {
    if(state.requiresQuoraVisit && state.quoraActivationMetricBaselineKnown) {
        const counter = getCurrentMetricsCounter('runtime.quoraActivated')
        if(counter > state.quoraActivationCounterBaseline) return true
    }
    else if(!state.requiresQuoraVisit && getCurrentMetricsCounter('runtime.quoraActivated') > 0) {
        return true
    }

    const journal = Array.isArray(getCurrentMetricsEpoch().journal) ? getCurrentMetricsEpoch().journal : []
    const minimumActivationAt = state.requiresQuoraVisit
        ? Number.parseInt(state.requiresQuoraVisitAt, 10) || 0
        : 0
    return journal.some(entry => {
        if(`${entry?.name || ''}` !== 'quora-runtime-activated') return false
        const activatedAt = Number.parseInt(entry?.at, 10) || 0
        return !minimumActivationAt || activatedAt >= minimumActivationAt
    })
}

function getQueueItemActivityTime(item = {}) {
    return Math.max(
        Number.parseInt(item.updatedAt, 10) || 0,
        Number.parseInt(item.activeAt, 10) || 0,
        Number.parseInt(item.terminalAt, 10) || 0,
        Number.parseInt(item.createdAt, 10) || 0,
        Number.parseInt(item.queuedAt, 10) || 0
    )
}

function hasFreshActiveQueueWork(queueItems = []) {
    const epochStartedAt = getCurrentMetricsEpochStartedAt()
    return queueItems.some(item => {
        if(!isActiveQueueItem(item)) return false
        const activityAt = getQueueItemActivityTime(item)
        return !epochStartedAt || activityAt >= epochStartedAt
    })
}

function hasFreshTerminalQueueWork(queueItems = []) {
    const epochStartedAt = getCurrentMetricsEpochStartedAt()
    return queueItems.some(item => {
        if(!isTerminalQueueItem(item)) return false
        const activityAt = getQueueItemActivityTime(item)
        return !epochStartedAt || activityAt >= epochStartedAt
    })
}

function hasCurrentEpochTerminalJobMetric() {
    return getCurrentMetricsCounter('job.terminal') > 0
}

function hasSatisfiedQuoraVisitEvidence(queueItems = []) {
    return hasCurrentEpochQuoraActivationMetric() ||
        hasFreshActiveQueueWork(queueItems) ||
        hasFreshTerminalQueueWork(queueItems) ||
        hasCurrentEpochTerminalJobMetric()
}

function refreshQuoraVisitRequirement(queueItems = []) {
    if(state.requiresQuoraVisit && hasSatisfiedQuoraVisitEvidence(queueItems)) {
        setQuoraVisitRequirement(false)
    }
}

function getSecondsPerActualBlock(queueItems = [], epochStartedAt = 0) {
    const viewResult = getQueueViewSecondsPerActualBlock(epochStartedAt)
    if(viewResult) return viewResult

    const minimumTerminalAt = Number.parseInt(epochStartedAt, 10) || 0
    const completedBlocks = queueItems
        .filter(item => {
            if(!isActualBlockSuccess(item)) return false
            const terminalAt = getQueueItemTerminalTime(item)
            return terminalAt > 0 && (!minimumTerminalAt || terminalAt >= minimumTerminalAt)
        })
        .sort((left, right) => getQueueItemTerminalTime(right) - getQueueItemTerminalTime(left))
        .slice(0, SECONDS_PER_BLOCK_SAMPLE_LIMIT)
    if(!completedBlocks.length) return null

    const durations = completedBlocks
        .map(getQueueItemActiveDurationMs)
        .filter(duration => duration > 0)
    if(!durations.length) return null

    const totalDurationMs = durations.reduce((total, duration) => total + duration, 0)

    return {
        seconds: (totalDurationMs / 1000) / durations.length,
        blocks: durations.length,
        elapsedMs: totalDurationMs
    }
}

function getQueueViewSecondsPerActualBlock(epochStartedAt = 0) {
    const summary = state.queueView?.actualBlockTiming || null
    if(!summary || typeof summary !== 'object') return null

    const requestedEpochStartedAt = Number.parseInt(epochStartedAt, 10) || 0
    const summaryEpochStartedAt = Number.parseInt(summary.epochStartedAt, 10) || 0
    if(requestedEpochStartedAt && summaryEpochStartedAt && summaryEpochStartedAt !== requestedEpochStartedAt) return null

    const blocks = Number.parseInt(summary.blocks, 10) || 0
    const elapsedMs = Number.parseInt(summary.elapsedMs, 10) || 0
    const seconds = Number(summary.seconds)
    if(blocks <= 0 || elapsedMs <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null

    return {
        seconds,
        blocks,
        elapsedMs
    }
}

function getQueueItemActiveStartTime(item = {}) {
    return Number.parseInt(item?.activeAt, 10) || 0
}

function getQueueItemTerminalTime(item = {}) {
    return Number.parseInt(item?.terminalAt || item?.blockedAt || item?.updatedAt || item?.createdAt, 10) || 0
}

function getQueueItemActiveDurationMs(item = {}) {
    const startedAt = getQueueItemActiveStartTime(item)
    const endedAt = getQueueItemTerminalTime(item)
    return startedAt > 0 && endedAt > startedAt ? endedAt - startedAt : 0
}

function formatSecondsPerBlock(result = null) {
    if(!result) return '--'
    const seconds = Number(result.seconds)
    if(!Number.isFinite(seconds)) return '--'
    if(seconds >= 100) return `${Math.round(seconds)}`
    if(seconds >= 10) return seconds.toFixed(1)
    return seconds.toFixed(2)
}

function isPendingQueueStatus(status = '') {
    return status === 'queued' || ['opening', 'active', 'acting', 'settling'].includes(`${status || ''}`.trim())
}

function setText(id, value) {
    const element = document.getElementById(id)
    if(element) element.textContent = `${value}`
}

function getRefreshStateText() {
    if(state.loading) return 'Loading history...'
    if(state.loadError) return 'History load failed'
    if(state.requiresQuoraVisit) {
        const queuedCount = getQueuedCoordinatorQueueCount()
        return queuedCount > 0
            ? `Waiting for first Quora page (${queuedCount} queued)`
            : 'Waiting for first Quora page'
    }
    const throttle = getCurrentQueueLoadThrottle()
    if(throttle.active) {
        const retryIn = Math.max(0, (Number.parseInt(throttle.until, 10) || 0) - Date.now())
        return `Quora slow: throttled to 1 tab, retrying in ${formatDuration(retryIn)}`
    }
    return `Updated ${formatTime(Date.now())}`
}

function getCurrentQueueLoadThrottle() {
    const metrics = state.metrics || {}
    const currentEpoch = metrics.currentEpoch || metrics
    const throttle = currentEpoch.queueLoadThrottle || {}
    const until = Number.parseInt(throttle.until, 10) || 0
    const level = Number.parseInt(throttle.level, 10) || 0
    return {
        ...throttle,
        active: throttle.active === true && level > 0 && until > Date.now(),
        level,
        until
    }
}

function renderRuns(runs) {
    const container = document.getElementById('runList')
    if(!container) return

    const sortedRuns = [...runs].sort((left, right) => getRunSubmitTime(right?.id || right?.runId || '', right) - getRunSubmitTime(left?.id || left?.runId || '', left))
    replaceChildren(container, sortedRuns.map(run => {
        const runId = run.id || run.runId || ''
        const submittedAt = getRunSubmitTime(runId, run)
        const runDisplay = getRunDisplay(run)
        const row = document.createElement('div')
        row.className = 'row'
        row.append(
            buildTitleCell(runDisplay.title, runDisplay.subtitle, {
                titleHref: runDisplay.titleHref,
                title: runId
            }),
            buildBadge(run.status || 'unknown'),
            buildTextCell(`${Number.parseInt(run.itemCount, 10) || 0} items`),
            buildTextCell(submittedAt ? formatDateTime(submittedAt) : '')
        )
        return row
    }), state.loading ? 'Loading history...' : 'No dashboard runs yet.')
}

function renderEvents() {
    const container = document.getElementById('eventList')
    if(!container) return

    const sortedEvents = [...state.events].sort((left, right) => getTime(right) - getTime(left))
    replaceChildren(container, sortedEvents.map(event => {
        const eventDisplay = getEventDisplay(event)
        const row = document.createElement('div')
        row.className = 'row row--event'
        row.append(
            buildTitleCell(event.message || event.type || 'Event', eventDisplay.subtitle, {
                subtitleHref: eventDisplay.subtitleHref,
                title: event.runId || ''
            }),
            buildBadge(event.type || 'event'),
            buildTextCell(formatEventDetails(event)),
            buildTextCell(formatDateTime(event.at))
        )
        return row
    }), state.loading ? 'Loading history...' : 'No dashboard events.')
}

function renderWakeupMetrics(queueItems = []) {
    const metricsGrid = document.getElementById('metricsGrid')
    const journal = document.getElementById('metricsJournal')
    const metricsDocument = state.metrics || {}
    const metrics = metricsDocument.currentEpoch || metricsDocument
    const counters = metrics.counters || {}
    const phases = metrics.phases || {}
    const entries = Array.isArray(metrics.journal) ? metrics.journal : []
    const previousEpochs = Array.isArray(metricsDocument.previousEpochs) ? metricsDocument.previousEpochs : []
    const throttle = getCurrentQueueLoadThrottle()
    const jobs = getMetricCounter(counters, 'job.enqueued')
    const terminalJobs = getMetricCounter(counters, 'job.terminal')
    const nudgeSent = getMetricCounter(counters, 'nudge.sent')
    const nudgeAccepted = getMetricCounter(counters, 'nudge.accepted')
    const pumpRequested = getMetricCounter(counters, 'pump.requested')
    const pumpChanged = sumMetricCounters(counters, 'pump.changed.')
    const repairRequested = getMetricCounter(counters, 'repair.requested')
    const repairChanged = sumMetricCounters(counters, 'repair.changed.')
    const storageStarted = getMetricCounter(counters, 'storageUpdate.started')
    const storageTimedOut = getMetricCounter(counters, 'storageUpdate.timedOut')
    const storageDeadlineMissed = getMetricCounter(counters, 'storageUpdate.deadlineMissed')
    const storageFallbackReturned = getMetricCounter(counters, 'storageUpdate.fallbackReturned')
    const storageNoRuntimeWork = getMetricCounter(counters, 'storageUpdate.noRuntimeWork')
    const storageNoDurableWork = getMetricCounter(counters, 'storageUpdate.noDurableWork')
    const storageTimeoutGet = getMetricCounter(counters, 'storageUpdate.timeout.duringStorageGet')
    const storageTimeoutSet = getMetricCounter(counters, 'storageUpdate.timeout.duringStorageSet')
    const storageTimeoutUnknown = getMetricCounter(counters, 'storageUpdate.timeout.unknown')
    const milestoneReceived = getMetricCounter(counters, 'milestone.received')
    const milestoneFlushes = getMetricCounter(counters, 'milestone.flushPerformed')
    const progressReceived = getMetricCounter(counters, 'progress.recordReceived')
    const progressWrites = getMetricCounter(counters, 'progress.storageWrites')
    const progressFlushes = getMetricCounter(counters, 'progress.flushPerformed')
    const progressPendingMax = getMetricCounter(counters, 'progress.pendingMax')
    const progressChangedRows = getMetricCounter(counters, 'progress.changedRecordsPerStorageWrite')
    const progressPayloadRows = getMetricCounter(counters, 'progress.payloadRowsPerStorageWrite')
    const payloadBytes = getMetricCounter(counters, 'storagePayload.write.total.bytes')
    const payloadCalls = getMetricCounter(counters, 'storagePayload.write.total.calls')
    const payloadQueueBytes = getMetricCounter(counters, 'storagePayload.write.queue.bytes')
    const payloadRunsBytes = getMetricCounter(counters, 'storagePayload.write.runs.bytes')
    const payloadProgressBytes = getMetricCounter(counters, 'storagePayload.write.progress.bytes')
    const payloadMaxBytes = getMetricCounter(counters, 'storagePayload.write.total.maxBytes')
    const readBytes = getMetricCounter(counters, 'storagePayload.read.total.bytes')
    const readCalls = getMetricCounter(counters, 'storagePayload.read.total.calls')
    const readQueueBytes = getMetricCounter(counters, 'storagePayload.read.queue.bytes')
    const readQueueViewBytes = getMetricCounter(counters, 'storagePayload.read.queueView.bytes')
    const readProgressBytes = getMetricCounter(counters, 'storagePayload.read.progress.bytes')
    const readMaxBytes = getMetricCounter(counters, 'storagePayload.read.total.maxBytes')
    const topReadPath = getTopStoragePayloadPath(counters, 'read')
    const topWritePath = getTopStoragePayloadPath(counters, 'write')
    const duplicatePumps = getMetricCounter(counters, 'pump.noop.noPendingItems') +
        getMetricCounter(counters, 'pump.noop.executorAlreadyRunning') +
        getMetricCounter(counters, 'pump.noop.paused')
    const wakeups = nudgeSent + pumpRequested + repairRequested
    const stalledQueued = queueItems.filter(item => `${item?.status || ''}` === 'queued').length

    const epochReason = metrics.resetReason ? `, ${metrics.resetReason}` : ''
    const epochStarted = metrics.startedAt ? `Epoch ${formatTime(metrics.startedAt)}${epochReason}` : 'No metrics yet'
    setText('metricsUpdated', metrics.updatedAt ? `${epochStarted}; updated ${formatTime(metrics.updatedAt)}` : epochStarted)

    if(metricsGrid) {
        replaceChildren(metricsGrid, [
            buildMetricCard('Current epoch', metrics.resetReason || '--', `${metrics.epochId || ''}`),
            buildMetricCard('Previous epochs', `${previousEpochs.length}`, formatPreviousEpochSummary(previousEpochs[previousEpochs.length - 1])),
            buildMetricCard('Queue throttle', throttle.active ? 'active' : 'idle', throttle.active
                ? `level ${throttle.level}; retry ${formatDuration(throttle.until - Date.now())}; ${throttle.reason || ''}`
                : throttle.lastProgressAt ? `recovered ${formatTime(throttle.lastProgressAt)}` : 'No page-load throttle active'),
            buildMetricCard('Wakeups/job', jobs ? formatRatio(wakeups / jobs) : '--', `${wakeups} wakeups / ${jobs} enqueued`),
            buildMetricCard('Nudge accept', nudgeSent ? formatPercent(nudgeAccepted / nudgeSent) : '--', `${nudgeAccepted} / ${nudgeSent}`),
            buildMetricCard('Pump yield', pumpRequested ? formatPercent(pumpChanged / pumpRequested) : '--', `${pumpChanged} changed / ${pumpRequested}`),
            buildMetricCard('Duplicate pumps', pumpRequested ? formatPercent(duplicatePumps / pumpRequested) : '--', `${duplicatePumps} no-op`),
            buildMetricCard('Repairs/job', jobs ? formatRatio(repairRequested / jobs) : '--', `${repairChanged} repair changes`),
            buildMetricCard('Terminal jobs', `${terminalJobs}`, `${stalledQueued} currently queued`),
            buildMetricCard('Queue -> tab', formatPhaseAverage(phases.durableQueueToTabOpen), formatPhaseDetail(phases.durableQueueToTabOpen)),
            buildMetricCard('Tab -> claim', formatPhaseAverage(phases.tabOpenToClaimAccepted), formatPhaseDetail(phases.tabOpenToClaimAccepted)),
            buildMetricCard('Claim -> action', formatPhaseAverage(phases.claimAcceptedToActionStart), formatPhaseDetail(phases.claimAcceptedToActionStart)),
            buildMetricCard('Action -> terminal', formatPhaseAverage(phases.actionStartToTerminal), formatPhaseDetail(phases.actionStartToTerminal)),
            buildMetricCard('Terminal -> release', formatPhaseAverage(phases.terminalToSlotRelease), formatPhaseDetail(phases.terminalToSlotRelease)),
            buildMetricCard('Storage timeouts', storageStarted ? formatPercent(storageTimedOut / storageStarted) : `${storageTimedOut}`, `${storageTimedOut} / ${storageStarted}; ${storageFallbackReturned} fallback returned`),
            buildMetricCard('Storage deadlines', storageStarted ? formatPercent(storageDeadlineMissed / storageStarted) : `${storageDeadlineMissed}`, `${storageDeadlineMissed} missed; ${getMetricCounter(counters, 'storageUpdate.lateWriteSuppressed')} late suppressed`),
            buildMetricCard('Timeout buckets', `${storageTimeoutGet}`, `get ${storageTimeoutGet}, set ${storageTimeoutSet}, unknown ${storageTimeoutUnknown}`),
            buildMetricCard('No-work writes', `${storageNoDurableWork}`, `${storageNoRuntimeWork} no runtime; ${storageNoDurableWork} no durable`),
            buildMetricCard('Storage queue wait', formatPhaseAverage(phases.storageQueueWait), formatPhaseDetail(phases.storageQueueWait)),
            buildMetricCard('Storage get', formatPhaseAverage(phases.storageGet), `${getMetricCounter(counters, 'storageGetCalls')} calls`),
            buildMetricCard('Storage set', formatPhaseAverage(phases.storageSet), `${getMetricCounter(counters, 'storageSetCalls')} calls`),
            buildMetricCard('Read payload avg', readCalls ? formatBytes(readBytes / readCalls) : '--', `${formatBytes(readBytes)} total; max ${formatBytes(readMaxBytes)}`),
            buildMetricCard('Read payload keys', formatBytes(readQueueBytes), `queue ${formatBytes(readQueueBytes)}, view ${formatBytes(readQueueViewBytes)}, progress ${formatBytes(readProgressBytes)}`),
            buildMetricCard('Read hot path', topReadPath.path || '--', formatStoragePayloadPathDetail(topReadPath)),
            buildMetricCard('Payload avg', payloadCalls ? formatBytes(payloadBytes / payloadCalls) : '--', `${formatBytes(payloadBytes)} total; max ${formatBytes(payloadMaxBytes)}`),
            buildMetricCard('Payload sources', formatBytes(payloadQueueBytes), `queue ${formatBytes(payloadQueueBytes)}, runs ${formatBytes(payloadRunsBytes)}, progress ${formatBytes(payloadProgressBytes)}`),
            buildMetricCard('Write hot path', topWritePath.path || '--', formatStoragePayloadPathDetail(topWritePath)),
            buildMetricCard('Milestone batch', milestoneFlushes ? formatRatio(milestoneReceived / milestoneFlushes) : '--', `${milestoneReceived} records / ${milestoneFlushes} flushes`),
            buildMetricCard('Progress batch', progressFlushes ? formatRatio(progressReceived / progressFlushes) : '--', `${progressReceived} records / ${progressFlushes} flushes; pending max ${progressPendingMax}`),
            buildMetricCard('Progress changed', progressWrites ? formatRatio(progressChangedRows / progressWrites) : '--', `${progressChangedRows} changed rows / ${progressWrites} writes`),
            buildMetricCard('Progress payload', progressWrites ? formatRatio(progressPayloadRows / progressWrites) : '--', `${progressPayloadRows} payload rows / ${progressWrites} writes`)
        ], state.loading ? 'Loading history...' : 'No wakeup metrics yet.')
    }

    if(journal) {
        const recentEntries = [...entries].sort((left, right) => getTime(right) - getTime(left)).slice(0, 30)
        replaceChildren(journal, recentEntries.map(entry => {
            const row = document.createElement('div')
            row.className = 'row row--event'
            row.append(
                buildTitleCell(getMetricJournalTitle(entry), getMetricJournalSubtitle(entry), {
                    title: JSON.stringify(entry.details || {})
                }),
                buildBadge(entry.kind || 'metric'),
                buildTextCell(formatMetricCounterDelta(entry.counters || {}), formatMetricDetails(entry.details || {})),
                buildTextCell(formatDateTime(entry.at))
            )
            return row
        }), state.loading ? 'Loading history...' : 'No metrics journal entries yet.')
    }
}

function buildMetricCard(label = '', value = '', detail = '') {
    const card = document.createElement('div')
    card.className = 'metric-card'

    const labelNode = document.createElement('div')
    labelNode.className = 'metric-label'
    labelNode.textContent = label

    const valueNode = document.createElement('div')
    valueNode.className = 'metric-value'
    valueNode.textContent = value

    const detailNode = document.createElement('div')
    detailNode.className = 'metric-detail'
    detailNode.textContent = detail
    detailNode.title = detail

    card.append(labelNode, valueNode, detailNode)
    return card
}

function getMetricCounter(counters = {}, name = '') {
    return Number(counters[name]) || 0
}

function sumMetricCounters(counters = {}, prefix = '') {
    return Object.entries(counters || {})
        .filter(([key]) => key.startsWith(prefix))
        .reduce((total, [, value]) => total + (Number(value) || 0), 0)
}

function getTopStoragePayloadPath(counters = {}, direction = 'read') {
    const normalizedDirection = direction === 'write' ? 'write' : 'read'
    const prefix = `storagePayload.${normalizedDirection}.path.`
    const suffix = '.bytes'
    const top = Object.entries(counters || {})
        .filter(([key]) => key.startsWith(prefix) && key.endsWith(suffix))
        .map(([key, value]) => {
            const path = key.slice(prefix.length, -suffix.length)
            const bytes = Number(value) || 0
            return {
                path,
                bytes,
                calls: getMetricCounter(counters, `${prefix}${path}.calls`),
                rows: getMetricCounter(counters, `${prefix}${path}.rows`),
                maxBytes: getMetricCounter(counters, `${prefix}${path}.maxBytes`),
                latencyMs: getMetricCounter(counters, `${prefix}${path}.latencyMs`),
                maxLatencyMs: getMetricCounter(counters, `${prefix}${path}.maxLatencyMs`)
            }
        })
        .sort((left, right) => right.bytes - left.bytes)[0]
    return top || {path: '', bytes: 0, calls: 0, rows: 0, maxBytes: 0, latencyMs: 0, maxLatencyMs: 0}
}

function formatStoragePayloadPathDetail(pathMetrics = {}) {
    if(!pathMetrics?.path) return 'no samples'
    const avgLatency = pathMetrics.calls ? pathMetrics.latencyMs / pathMetrics.calls : 0
    return `${formatBytes(pathMetrics.bytes)} / ${pathMetrics.calls} calls; max ${formatBytes(pathMetrics.maxBytes)}; avg ${formatDuration(avgLatency)}`
}

function formatRatio(value = 0) {
    if(!Number.isFinite(value)) return '--'
    if(value >= 100) return Math.round(value).toString()
    if(value >= 10) return value.toFixed(1)
    return value.toFixed(2)
}

function formatPercent(value = 0) {
    if(!Number.isFinite(value)) return '--'
    return `${Math.round(value * 100)}%`
}

function formatBytes(value = 0) {
    const bytes = Number(value) || 0
    if(!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    if(bytes < 1024) return `${Math.round(bytes)} B`
    if(bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

function formatPreviousEpochSummary(epoch = null) {
    if(!epoch) return 'none'
    const timedOut = Number(epoch.storage?.timedOut) || 0
    const started = Number(epoch.storage?.started) || 0
    const timeoutRate = started ? formatPercent(timedOut / started) : '0%'
    const writeBytes = Number(epoch.storagePayload?.writeBytes) || 0
    const writeCalls = Number(epoch.storagePayload?.writeCalls) || 0
    const jobsTerminal = Number(epoch.jobs?.terminal) || 0
    return `${epoch.resetReason || 'epoch'}: ${timeoutRate} storage timeouts, ${formatBytes(writeBytes)} / ${writeCalls} writes, ${jobsTerminal} terminal jobs`
}

function formatPhaseAverage(phase = null) {
    if(!phase?.count) return '--'
    return formatDuration((Number(phase.totalMs) || 0) / phase.count)
}

function formatPhaseDetail(phase = null) {
    if(!phase?.count) return 'no samples'
    return `${phase.count} samples, max ${formatDuration(Number(phase.maxMs) || 0)}`
}

function getMetricJournalTitle(entry = {}) {
    const name = `${entry.name || entry.kind || 'metric'}`.trim()
    const result = `${entry.result || ''}`.trim()
    const reason = `${entry.resultReason || entry.reason || ''}`.trim()
    return [name, result].filter(Boolean).join(' - ') || 'Metric cycle'
}

function getMetricJournalSubtitle(entry = {}) {
    const reason = `${entry.reason || ''}`.trim()
    const duration = Number(entry.durationMs) > 0 ? formatDuration(Number(entry.durationMs)) : ''
    return [reason, duration].filter(Boolean).join(' • ')
}

function formatMetricCounterDelta(counters = {}) {
    const entries = Object.entries(counters || {})
        .filter(([, value]) => Number(value) !== 0)
        .slice(0, 3)
        .map(([key, value]) => `${key.replace(/^[^.]+\./, '')} +${value}`)
    return entries.join(', ')
}

function formatMetricDetails(details = {}) {
    const priorityKeys = [
        'totalMs',
        'queueWaitMs',
        'runMs',
        'timeoutMs',
        'timedOut',
        'deadlineMissed',
        'fallbackReturned',
        'abandoned',
        'timeoutPhase',
        'ownStorageGetMs',
        'storageGetCumulativeMs',
        'ownStorageSetMs',
        'storageSetCumulativeMs',
        'payloadBytes',
        'payloadKeys',
        'storageGetCalls',
        'storageSetCalls',
        'durableActiveRows',
        'durableQueuedRows',
        'durableTerminalRows',
        'activeQueuedTabs',
        'queuedTabActions',
        'pendingTabActions'
    ]
    const used = new Set()
    const orderedEntries = []
    for(const key of priorityKeys) {
        if(Object.prototype.hasOwnProperty.call(details || {}, key)) {
            used.add(key)
            orderedEntries.push([key, details[key]])
        }
    }
    for(const entry of Object.entries(details || {})) {
        if(!used.has(entry[0])) orderedEntries.push(entry)
    }

    return orderedEntries
        .slice(0, 14)
        .map(([key, value]) => `${key}: ${formatMetricDetailValue(key, value)}`)
        .join('\n')
}

function formatMetricDetailValue(key = '', value = '') {
    if(/Ms$/.test(key) && Number.isFinite(Number(value))) return formatDuration(Number(value))
    if(key === 'payloadBytes' && Number.isFinite(Number(value))) return formatBytes(Number(value))
    return `${value}`
}

function renderQueue(items) {
    const container = document.getElementById('queueList')
    if(!container) return

    const sortedItems = [...items].sort(compareCurrentWorkItems)
    replaceChildren(container, sortedItems.map(item => {
        const actionLabel = getQueueActionLabel(item)
        const profileHref = `${item?.targetProfileHref || ''}`.trim()
        const itemHref = getQueueItemHref('', item)
        const sourcePageUrl = `${item?.source?.pageUrl || ''}`.trim()
        const profileLabel = profileHref ? getProfileLabelFromHref(profileHref) : ''
        const titleLabel = getQueueItemTitleLabel(item, profileLabel)
        const titleHref = normalizeExternalHref(profileHref || item.requestedUrl || itemHref)
        const sourceLabel = getSourceLabelFromUrl(sourcePageUrl)
        const row = document.createElement('div')
        row.className = 'row row--queue'
        row.append(
            buildTitleCell(titleLabel, `${actionLabel}${sourceLabel ? ` • ${sourceLabel}` : ''}`, {
                titleHref,
                subtitleHref: sourcePageUrl
            }),
            buildQueueCancelCell(item),
            buildBadge(item.status || 'unknown'),
            buildTextCell(item.outcome || item.error || '', getOutcomeHelp(item.outcome || item.error || '')),
            buildQueueTimingCell(item),
            buildQueueActionCell(item)
        )
        return row
    }), state.loading ? 'Loading history...' : 'No current work yet.')
}

function isResolutionQueueItem(item = {}) {
    return item?.resolveProfileFromPage === true ||
        `${item?.resolutionMode || ''}`.trim() === 'author-profile' ||
        `${item?.coordinatorKey || item?.dedupeKey || ''}`.startsWith('resolve-profile:')
}

function getQueueItemTitleLabel(item = {}, profileLabel = '') {
    if(profileLabel) return profileLabel
    if(isResolutionQueueItem(item)) {
        const sourceLabel = getSourceLabelFromUrl(item.requestedUrl || '')
        return sourceLabel ? `Resolve ${sourceLabel} post` : 'Resolve source post'
    }
    return item.targetProfileHref || item.requestedUrl || item.id || 'Current work item'
}

function buildQueueTimingCell(item = {}) {
    const cell = document.createElement('div')
    cell.className = 'row-subtitle row-time-cell'

    const queuedAt = Number.parseInt(item.queuedAt || item.createdAt, 10) || 0
    const activeAt = Number.parseInt(item.activeAt, 10) || 0
    const terminalAt = Number.parseInt(item.terminalAt, 10) || 0
    const updatedAt = Number.parseInt(item.updatedAt || item.createdAt, 10) || 0
    const primaryAt = activeAt || queuedAt || updatedAt
    const secondaryAt = terminalAt || updatedAt
    const activeDurationMs = activeAt
        ? (terminalAt || (isActiveQueueItem(item) ? Date.now() : updatedAt || Date.now())) - activeAt
        : 0

    const primary = document.createElement('div')
    primary.className = 'row-time-line'
    primary.textContent = activeAt
        ? `active ${formatTime(activeAt)}`
        : queuedAt
            ? `queued ${formatTime(queuedAt)}`
            : updatedAt
                ? `updated ${formatTime(updatedAt)}`
                : ''

    const secondary = document.createElement('div')
    secondary.className = 'row-time-line row-time-line--detail'
    secondary.textContent = terminalAt
        ? `done ${formatTime(terminalAt)}${activeDurationMs > 0 ? ` • active ${formatDuration(activeDurationMs)}` : ''}`
        : activeAt && activeDurationMs > 0
            ? `running ${formatDuration(activeDurationMs)}`
            : secondaryAt && secondaryAt !== primaryAt
                ? `updated ${formatTime(secondaryAt)}`
                : ''

    cell.append(primary, secondary)
    cell.title = [
        queuedAt ? `queued ${formatDateTime(queuedAt)}` : '',
        activeAt ? `active ${formatDateTime(activeAt)}` : '',
        terminalAt ? `terminal ${formatDateTime(terminalAt)}` : '',
        activeDurationMs > 0
            ? `${terminalAt ? 'active to terminal' : 'active elapsed'} ${formatDuration(activeDurationMs)}`
            : ''
    ].filter(Boolean).join('\n')
    return cell
}

function buildQueueCancelCell(item = {}) {
    const cell = document.createElement('div')
    cell.className = 'row-cancel-cell'

    if(!isPendingQueueStatus(`${item?.status || ''}`.trim())) return cell

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'clear-button row-action-button row-cancel-button'
    button.textContent = 'Cancel'
    button.title = 'Cancel this queued Current Work item'
    button.addEventListener('click', event => {
        event.preventDefault()
        button.disabled = true
        void cancelCurrentWorkItem(item)
    })
    cell.appendChild(button)
    return cell
}

function buildQueueActionCell(item = {}) {
    const cell = document.createElement('div')
    cell.className = 'row-action-cell'

    if(`${item?.status || ''}` !== 'failed') return cell

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'clear-button row-action-button'
    button.textContent = 'Requeue'
    button.title = 'Reset and requeue this failed Current Work item'
    button.addEventListener('click', event => {
        event.preventDefault()
        button.disabled = true
        void requeueFailedItem(item)
    })
    cell.appendChild(button)
    return cell
}

function compareCurrentWorkItems(left = {}, right = {}) {
    return getCurrentWorkSortRank(left) - getCurrentWorkSortRank(right) ||
        getTime(right) - getTime(left) ||
        `${getQueueItemHref('', left) || left?.storageKey || left?.id || ''}`.localeCompare(`${getQueueItemHref('', right) || right?.storageKey || right?.id || ''}`)
}

function getCurrentWorkSortRank(item = {}) {
    const status = `${item?.status || ''}`.trim()
    if(isActiveQueueItem(item)) return 0
    if(status === 'queued') return 1
    if(isEligibleRetryFailedQueueItem(item)) return 2
    if(status === 'failed') return 3
    if(!isTerminalQueueItem(item)) return 4
    return 5
}

function getQueueActionLabel(item = {}) {
    if(isResolutionQueueItem(item)) return 'Resolve Profile'
    const actionKind = `${item?.actionKind || item?.executorTabAction || item?.tabAction || ''}`.trim()
    if(actionKind === 'unblock-unmute') return 'Unblock Unmute'
    if(actionKind === 'mute-block' || actionKind === 'nuke') return 'Mute Block'
    return actionKind || 'Mute Block'
}

function getRunSubmitTime(runId = '', run = {}) {
    const event = state.events.find(candidate => candidate?.runId && candidate.runId === runId)
    return Number.parseInt(event?.at || run?.submittedAt || run?.createdAt, 10) || 0
}

function getRunDisplay(run = {}) {
    const submittedAt = getRunSubmitTime(run.id || run.runId || '', run)
    const submittedLabel = submittedAt ? `submitted ${formatDateTime(submittedAt)}` : ''
    const sourcePageUrl = getRunSourcePageUrl(run)
    const targetHrefs = getRunDisplayTargetHrefs(run)
    const singleTargetHref = targetHrefs.length === 1 ? targetHrefs[0] : ''
    const profileLabel = getProfileLabelFromHref(singleTargetHref)

    if(isFailedRetryRun(run)) {
        if(profileLabel) {
            return {
                title: profileLabel,
                subtitle: ['Retry failed target', submittedLabel].filter(Boolean).join(' • '),
                titleHref: singleTargetHref
            }
        }

        return {
            title: `${targetHrefs.length || Number.parseInt(run.itemCount, 10) || 0} failed targets`,
            subtitle: ['Retry failed targets', submittedLabel].filter(Boolean).join(' • '),
            titleHref: ''
        }
    }

    return {
        title: getRunSourceLabel(run),
        subtitle: submittedLabel,
        titleHref: sourcePageUrl
    }
}

function getRunDisplayTargetHrefs(run = {}) {
    if(Array.isArray(run.displayTargetProfileHrefs) && run.displayTargetProfileHrefs.length) {
        return run.displayTargetProfileHrefs.map(href => `${href || ''}`.trim()).filter(Boolean)
    }

    return getRunTargetHrefs(run)
}

function isFailedRetryRun(run = {}) {
    return `${run?.sourceType || ''}` === 'failed-retry' ||
        `${run?.id || run?.runId || ''}`.startsWith('retry-failed-')
}

function getRunSourceLabel(run = {}) {
    const sourcePage = getRunSourcePageUrl(run)
    return getSourceLabelFromUrl(sourcePage) || `${run.sourceType || 'unknown'} source`
}

function getRunSourcePageUrl(run = {}) {
    const sourcePages = Array.isArray(run.sourcePages) ? run.sourcePages : []
    return `${sourcePages[0] || run?.source?.pageUrl || ''}`.trim()
}

function getEventSourceLabel(event = {}) {
    return getSourceLabelFromUrl(event?.details?.sourcePageUrl || '') || 'Unknown source'
}

function getEventDisplay(event = {}) {
    const sourcePageUrl = `${event?.details?.sourcePageUrl || ''}`.trim()
    const sourceLabel = getEventSourceLabel(event)
    const targetHref = getEventTargetProfileHref(event)
    const profileLabel = getProfileLabelFromHref(targetHref)

    if(`${event?.type || ''}` === 'retry') {
        return {
            subtitle: profileLabel || (targetHref ? targetHref : sourceLabel),
            subtitleHref: targetHref || sourcePageUrl
        }
    }

    return {
        subtitle: `${sourceLabel}${event.runId ? ` • ${event.runId}` : ''}`,
        subtitleHref: sourcePageUrl
    }
}

function getEventTargetProfileHref(event = {}) {
    const details = event.details || {}
    const detailHrefs = Array.isArray(details.targetProfileHrefs)
        ? details.targetProfileHrefs.map(href => `${href || ''}`.trim()).filter(Boolean)
        : []
    if(detailHrefs.length === 1) return detailHrefs[0]
    if(details.targetProfileHref || details.profileHref) return `${details.targetProfileHref || details.profileHref || ''}`.trim()

    const run = event.runId ? state.runs?.[event.runId] || null : null
    const runHrefs = getRunTargetHrefs(run || {})
    if(runHrefs.length === 1) return runHrefs[0]

    return ''
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

function getProfileLabelFromHref(href = '') {
    const slug = getProfileSlugFromHref(href)
    if(!slug) return ''

    return slug
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map(formatProfileSlugPart)
        .join(' ')
}

function getProfileSlugFromHref(href = '') {
    const value = `${href || ''}`.trim()
    if(!value) return ''

    try {
        const url = new URL(value)
        const segments = url.pathname
            .split('/')
            .map(part => decodeURIComponent(part.trim()))
            .filter(Boolean)
        if(!segments.length) return ''
        if(segments[0].toLowerCase() === 'profile') return segments[1] || ''
        return segments[0]
    }
    catch {
        return ''
    }
}

function formatProfileSlugPart(part = '') {
    if(/^[A-Z0-9]+$/.test(part)) return part
    return part.charAt(0).toUpperCase() + part.slice(1)
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

function buildTitleCell(title, subtitle, options = {}) {
    const cell = document.createElement('div')
    const titleNode = buildMaybeLink(options.titleHref, 'row-title')
    const subtitleNode = buildMaybeLink(options.subtitleHref, 'row-subtitle')
    titleNode.className = 'row-title'
    subtitleNode.className = 'row-subtitle'
    titleNode.textContent = title || ''
    subtitleNode.textContent = subtitle || ''
    if(options.title) cell.title = options.title
    cell.append(titleNode, subtitleNode)
    return cell
}

function buildMaybeLink(href, className) {
    const normalizedHref = normalizeExternalHref(href)
    const node = document.createElement(normalizedHref ? 'a' : 'div')
    node.className = className

    if(normalizedHref) {
        node.href = normalizedHref
        node.target = '_blank'
        node.rel = 'noopener noreferrer'
    }

    return node
}

function normalizeExternalHref(href = '') {
    const value = `${href || ''}`.trim()
    if(!value) return ''

    try {
        const url = new URL(value)
        if(url.protocol === 'http:' || url.protocol === 'https:') return url.href
    }
    catch {}

    return ''
}

function buildBadge(value) {
    const badge = document.createElement('span')
    const normalized = `${value || 'unknown'}`.toLowerCase()
    badge.className = `badge badge--${normalized.replace(/[^a-z0-9_-]/g, '-')}`
    badge.textContent = normalized
    badge.title = getStatusHelp(normalized)
    return badge
}

function buildTextCell(value, title = '') {
    const cell = document.createElement('div')
    cell.className = 'row-subtitle'
    cell.textContent = `${value || ''}`
    if(title) cell.title = title
    return cell
}

function getStatusHelp(status = '') {
    const normalized = `${status || ''}`.trim()
    const descriptions = {
        queued: 'Ready to run: waiting for a worker slot.',
        opening: 'Opening: a worker tab is being created or navigated.',
        active: 'Active: a worker tab is claimed and preparing the profile action.',
        acting: 'Acting: a mute, block, unblock, or unmute action is in progress.',
        settling: 'Settling: terminal action finished and cleanup or source-page settlement is pending.',
        succeeded: 'Succeeded: target is blocked, unblocked, or already in the desired state.',
        failed: 'Failed: work ended without success. Outcome/error explains retryability.',
        skipped: 'Skipped: no destructive work was possible or needed.',
        canceled: 'Canceled: work was stopped by an operator action.',
        complete: 'Complete: every target in the run has reached a terminal state.',
        retry: 'Retry: failed-row retry action.',
        enqueued: 'Enqueued: new queue work was submitted.',
        paused: 'Paused: pending work was stopped.'
    }

    return descriptions[normalized] || `${normalized || 'unknown'} status`
}

function getOutcomeHelp(outcome = '') {
    const normalized = `${outcome || ''}`.trim()
    const descriptions = {
        blocked: 'Blocked: the profile was blocked during this run.',
        'already-blocked': 'Already blocked: the profile was already in the desired blocked state.',
        unblocked: 'Unblocked: the reverse action removed the block.',
        'already-unblocked': 'Already unblocked: the profile was already in the desired unblocked state.',
        timeout: 'Timeout: retryable failure from a missing, stale, or over-deadline worker.',
        'action-error': 'Action error: retryable failure while finding or applying the profile action.',
        'security-verification': 'Security verification: non-retryable Quora challenge or verification state.',
        'profile-unavailable': 'Profile unavailable: the target could not be acted on.',
        'unresolved-target': 'Unresolved target: source evidence did not identify one profile target.',
        paused: 'Paused: canceled by operator pause.'
    }

    return descriptions[normalized] || ''
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

function formatDuration(valueMs) {
    const totalSeconds = Math.max(0, Math.round((Number.parseInt(valueMs, 10) || 0) / 1000))
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if(hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`
    if(minutes) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
    return `${seconds}s`
}
