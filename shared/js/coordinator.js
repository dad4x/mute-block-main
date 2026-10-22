const browser = require('webextension-polyfill')
const {
    isRetryableJobFailure,
    isRetryableJobFailureFromProgress,
    isTerminalJobStatus,
    UNBLOCK_UNMUTE_ACTION_KIND
} = require('./jobState')
const {
    createCoordinatorStatusRules
} = require('./swCoordinatorStatusRules')
const {
    COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS,
    COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS
} = require('./timeouts')
const {
    SPACE_NUKED_POSTS_KEY,
    NUKED_POST_RETENTION_DAYS_KEY,
    MAX_REMEMBERED_NUKED_POSTS_KEY,
    getPrunedNukedPosts
} = require('./nukedPosts')
const {readSpaceMapFromStored, spaceMapStorageReadDefaults} = require('./spaceMapStorage')
const defaults = require('./defaults')
const {SOFT_FAIL_RETRY_LIMIT} = require('./tunables')
const {
    COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY,
    COORDINATOR_PAUSED_KEY,
    COORDINATOR_QUEUE_VIEW_KEY,
    COORDINATOR_RETRY_FAILED_ENABLED_KEY,
    COORDINATOR_RUNS_KEY,
    DEV_MODE_SYNC_STORAGE_KEY,
    HIDDEN_RUNS_KEY,
    QUEUE_WAKEUP_METRICS_VIEW_KEY,
    SPACE_REGISTRY_KEY
} = require('./storageKeys')

// coordinatorStatusRules is the same factory sw.js uses, so
// isTerminalQueueStatus/isActiveQueueItem/isPendingQueueStatus/
// isRetryableFailedQueueItem below delegate to it instead of maintaining
// their own copies of the status arrays (2026-09-10 entropy-reduction fix:
// this file's arrays had drifted -- isTerminalQueueStatus's ['succeeded',
// 'failed', 'skipped', 'canceled', 'complete'] included a dead 'complete'
// value no queue item status is ever actually set to; canonical
// TERMINAL_JOB_STATUSES in jobState.js has never included it).
const coordinatorStatusRules = createCoordinatorStatusRules({
    constants: {
        UNBLOCK_UNMUTE_ACTION_KIND
    },
    handlers: {
        isTerminalJobStatus,
        isRetryableJobFailure,
        isRetryableJobFailureFromProgress
    }
})
const {
    isTerminalCoordinatorStatus,
    isActiveCoordinatorStatus,
    isPendingCoordinatorStatus,
    isRetryableCoordinatorFailure
} = coordinatorStatusRules

const LAST_ENQUEUE_SUMMARY_MAX_AGE_MS = 30 * 60 * 1000
const QUEUED_ACTION_SURFACE_COORDINATOR_HASH = '#progress'
const COORDINATOR_HISTORY_HASH = '#history'
const DASHBOARD_COMPACT_REFRESH_INTERVAL_MS = 2000
const DASHBOARD_COMPACT_REFRESH_PUSH_DELAY_MS = 100
const RETRY_FAILED_LIMIT = SOFT_FAIL_RETRY_LIMIT
const CURRENT_WORK_MUTATION_TIMEOUT_MS = 70000
// The dashboard's outlier list is computed by the worker (swCoordinatorOutliers.js) and served with each dashboard refresh.

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
    quoraActivationMetricBaselineKnown: false,
    outliers: [],
    lastEnqueueSummary: null
}
// Recent event counts (renderEventHistogram) re-fetches and re-tallies the
// flight recorder's full retained window on every render, so a client-only
// "clear" can't remove entries -- they'd just reappear on the next refresh.
// Instead this records when Clear was pressed and every render only tallies
// entries recorded after it, the same "not persisted, this tab only" scope
// as the outlier list had before the worker took it over. The flight recorder itself is a read-only
// diagnostic journal (swflightRecorder.js) with no production reset action,
// and this doesn't add one.
let eventHistogramClearedAtMs = 0
// Track the previous "Progress events" pending-max reading for trend
// coloring on that metric card (renderWakeupMetrics) -- null until the
// first refresh has run.
let previousProgressPendingMax = null
let dashboardCompactRefreshTimer = null
let dashboardCompactRefreshScheduledTimer = null
let dashboardCompactRefreshPromise = null
let retryFailedActive = false
let retryFailedLastResult = null
let currentWorkPausePending = ''

addEventListener('load', () => {
    void init()
})

// A hash-only navigation (e.g. the service worker reusing this exact tab
// but switching it from #history to the plain dashboard, or vice versa) is
// a same-document navigation -- it never fires 'load' and re-runs init(),
// so the previous view's content and click handlers would otherwise just
// stay put while the address bar quietly changed underneath them.
// Confirmed live 2026-09-29: reusing a tab across views left the wrong
// section(s) visible. Reloading is simpler and safer than trying to
// re-run init() in place (which would double-register every click handler
// the previous view's init() already attached).
addEventListener('hashchange', () => {
    location.reload()
})

async function openCoordinatorViewFromHere(action = 'open-coordinator') {
    const currentWindow = await browser.windows.getCurrent().catch(() => null)
    await sendRuntimeMessageWithTimeout({
        action,
        active: true,
        windowId: currentWindow?.id || null
    }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS).catch(() => null)
}

async function loadHistoryEntries() {
    const stored = await browser.storage.local.get({
        ...spaceMapStorageReadDefaults([SPACE_NUKED_POSTS_KEY]),
        [NUKED_POST_RETENTION_DAYS_KEY]: defaults[NUKED_POST_RETENTION_DAYS_KEY],
        [MAX_REMEMBERED_NUKED_POSTS_KEY]: defaults[MAX_REMEMBERED_NUKED_POSTS_KEY]
    })
    return getPrunedNukedPosts(readSpaceMapFromStored(stored, SPACE_NUKED_POSTS_KEY), {
        retentionDays: stored[NUKED_POST_RETENTION_DAYS_KEY],
        maxEntries: stored[MAX_REMEMBERED_NUKED_POSTS_KEY]
    })
}

async function renderHistoryList() {
    const entries = await loadHistoryEntries()
    const rows = Object.entries(entries)
    const countEl = document.getElementById('historyCount')
    if(countEl) countEl.textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`

    const list = document.getElementById('historyList')
    if(!list) return

    replaceChildren(list, rows.map(([postKey, record]) => {
        const urls = Array.isArray(record?.urls) ? record.urls : []
        const singleProfileHref = urls.length === 1 ? urls[0] : ''
        const profileLabel = singleProfileHref ? getProfileLabelFromHref(singleProfileHref) : ''
        // Matches renderQueue's own title/subtitle pattern (Current Work
        // listing): title links to the actual profile, subtitle is the
        // action mode plus the source it came from -- SPACE_NUKED_POSTS_KEY
        // entries are always mute-block (there's no unblock/unmute
        // equivalent of a space-feed post nuke), so that half is constant.
        const titleLabel = profileLabel || (urls.length > 1 ? `${urls.length} profiles` : (postKey || 'Unknown profile'))
        const titleHref = singleProfileHref || ''
        const sourceLabel = getSourceLabelFromUrl(record?.postUrl || record?.spaceUrl || '')
        const when = record?.updatedAt ? formatDateTime(record.updatedAt) : ''
        const subtitle = ['Mute Block', sourceLabel, when].filter(Boolean).join(' • ')
        const row = document.createElement('div')
        row.className = 'row'
        row.append(buildTitleCell(titleLabel, subtitle, {titleHref, subtitleHref: record?.postUrl || ''}))
        return row
    }), 'No history yet.')
}

async function clearHistory() {
    if(!window.confirm('Clear all Recent History?')) return
    await sendRuntimeMessageWithTimeout({action: 'set-space-nuked-posts', nukedPosts: {}}, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)
    await renderHistoryList()
}

// The three coordinator.html views (default dashboard, #progress,
// #history) each render their own content correctly for their mode, but
// nothing ever toggled which container is actually visible -- all three
// sections stayed shown simultaneously regardless of hash. Confirmed live
// 2026-09-29 (screenshot): the worker bar and the history header both
// rendered stacked on top of the plain dashboard.
function applyCoordinatorViewMode() {
    const dashboardView = document.getElementById('dashboardView')
    const workerBarView = document.getElementById('workerBarView')
    const historyView = document.getElementById('historyView')
    const dashboardBottomBar = document.getElementById('dashboardBottomBar')
    const isWorkerBar = isQueuedWorkerActionSurfacePage()
    const isHistory = isCoordinatorHistoryPage()

    if(dashboardView) dashboardView.hidden = isWorkerBar || isHistory
    if(workerBarView) workerBarView.hidden = !isWorkerBar
    if(historyView) historyView.hidden = !isHistory
    // Only the plain dashboard gets the footer bar -- the worker window has
    // its own equivalent (.worker-bar) and History is just a short list.
    if(dashboardBottomBar) dashboardBottomBar.hidden = isWorkerBar || isHistory
}

async function initHistoryPage() {
    document.title = 'History'
    document.getElementById('clearHistoryButton')?.addEventListener('click', () => {
        void clearHistory()
    })
    document.getElementById('historyDashboardButton')?.addEventListener('click', () => {
        void openCoordinatorViewFromHere('open-coordinator')
    })
    document.getElementById('historyPreferencesButton')?.addEventListener('click', () => {
        void openPreferences()
    })
    // Deliberately no broad storage-change listener here -- this file
    // avoids that delivery mechanism on purpose elsewhere (see "dashboard
    // live refresh avoids broad storage change delivery"). This page only
    // ever changes via its own Clear button, which already re-renders
    // itself, so a one-time load on open is enough.
    await renderHistoryList()
}

async function initWorkerBarPage() {
    await registerQueuedWorkerActionSurfacePage()
    const manifest = browser.runtime.getManifest()
    const versionEl = document.getElementById('workerBarVersion')
    if(versionEl) versionEl.textContent = `v${manifest.version}`
    document.getElementById('workerBarPauseResume')?.addEventListener('click', () => {
        void toggleCurrentWorkPause()
    })
    document.getElementById('workerBarCancel')?.addEventListener('click', () => {
        void cancelCurrentWork()
    })
    document.getElementById('workerBarDashboard')?.addEventListener('click', () => {
        void openCoordinatorViewFromHere('open-coordinator')
    })
    document.getElementById('workerBarHistory')?.addEventListener('click', () => {
        void openCoordinatorViewFromHere('open-coordinator-history')
    })
    document.getElementById('workerBarPreferences')?.addEventListener('click', () => {
        void openPreferences()
    })
    installCompactStorageRefreshPolling()
    installDashboardRuntimeRefreshListener()
    render()
    await announceCoordinatorPageReady()

    try {
        await loadState()
    }
    catch {}
    render()
}

async function init() {
    applyCoordinatorViewMode()
    if(isCoordinatorHistoryPage()) {
        await initHistoryPage()
        return
    }
    if(isQueuedWorkerActionSurfacePage()) {
        await initWorkerBarPage()
        return
    }

    const manifest = browser.runtime.getManifest()
    document.getElementById('appVersion').textContent = `v${manifest.version}`
    document.getElementById('dashboardBottomBarLogo')?.addEventListener('click', () => {
        void openDashboardFromBottomBar()
    })
    document.getElementById('clearEventsButton')?.addEventListener('click', () => {
        void clearEvents()
    })
    document.getElementById('clearCompletedRunsButton')?.addEventListener('click', () => {
        void clearCompletedRuns()
    })
    document.getElementById('clearOutliersButton')?.addEventListener('click', () => {
        void clearOutliers()
    })
    document.getElementById('clearScanCostButton')?.addEventListener('click', () => {
        void resetMetrics()
    })
    document.getElementById('clearAuthorityLoadHistogramButton')?.addEventListener('click', () => {
        void resetMetrics()
    })
    document.getElementById('clearWriteSizeHistogramButton')?.addEventListener('click', () => {
        void resetMetrics()
    })
    document.getElementById('resetPhaseTimingButton')?.addEventListener('click', () => {
        void resetMetrics()
    })
    document.getElementById('clearEventHistogramButton')?.addEventListener('click', () => {
        clearEventHistogram()
    })
    document.getElementById('resetMetricsButton')?.addEventListener('click', () => {
        void resetMetrics()
    })
    document.getElementById('clearAllStatsButton')?.addEventListener('click', () => {
        void clearAllStats()
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
    document.getElementById('saveFlightRecorderButton')?.addEventListener('click', () => {
        void saveFlightRecorder()
    })
    document.getElementById('cancelCurrentWorkButton')?.addEventListener('click', () => {
        void cancelCurrentWork()
    })
    document.getElementById('clearCurrentWorkButton')?.addEventListener('click', () => {
        void clearCurrentWork()
    })
    document.getElementById('startCoordinatorButton')?.addEventListener('click', () => {
        void startCoordinatorQueue()
    })
    document.getElementById('openPreferencesButton')?.addEventListener('click', () => {
        void openPreferences()
    })
    document.getElementById('openHistoryButton')?.addEventListener('click', () => {
        void openCoordinatorViewFromHere('open-coordinator-history')
    })
    installPanelToggleListeners()
    installPanelWheelScrollListeners()
    installDashboardRuntimeRefreshListener()
    await loadDevModeStoredEnabled()
    installDevModeToggle()

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
}

function isQueuedWorkerActionSurfacePage() {
    return `${globalThis.location?.hash || ''}` === QUEUED_ACTION_SURFACE_COORDINATOR_HASH
}

function isCoordinatorHistoryPage() {
    return `${globalThis.location?.hash || ''}` === COORDINATOR_HISTORY_HASH
}

async function registerQueuedWorkerActionSurfacePage() {
    if(!isQueuedWorkerActionSurfacePage()) return false
    if(browser.storage?.session?.set !== undefined) {
        document.title = 'Progress'
    }

    // The worker takes the window and tab from this page's sender, so the page only asks.
    const result = await sendRuntimeMessageWithTimeout({action: 'register-queued-worker-action-surface'}, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS).catch(() => null)
    return result?.registered === true
}

// 2026-09-27: this periodic poll used to run unconditionally every
// DASHBOARD_COMPACT_REFRESH_INTERVAL_MS (2s) for as long as the dashboard
// tab stayed open, regardless of whether the queue could possibly have
// changed. Confirmed live via the flight recorder: with the queue paused
// (or simply with nothing pending) and the dashboard left open, this alone
// produced thousands of no-op round-trips to the service worker over a
// few hours -- each one a real (if now skipped, see
// refreshCoordinatorQueueViewForDashboard) storage-update cycle, and each
// one inflating storageUpdate.noDurableWork (the "No-work writes" card)
// for reasons that had nothing to do with the queue actually stalling.
// Paused, or genuinely nothing pending, means nothing this timer tick
// could discover will have changed since the last one -- a real change
// (resume, new work enqueued, pause toggled elsewhere) already reaches
// this dashboard via installDashboardRuntimeRefreshListener's
// coordinator-dashboard-state-changed push, independent of this timer.
const PENDING_QUEUE_VIEW_STATUSES = ['queued', 'opening', 'active', 'acting', 'settling']

function isDashboardQueueDefinitelyIdle() {
    if(state.paused) return true
    const counts = state.queueView?.counts || {}
    return !PENDING_QUEUE_VIEW_STATUSES.some(status => (Number(counts[status]) || 0) > 0)
}

function installCompactStorageRefreshPolling() {
    if(dashboardCompactRefreshTimer) return
    addEventListener('pagehide', stopCompactStorageRefreshPolling)
    addEventListener('beforeunload', stopCompactStorageRefreshPolling)
    dashboardCompactRefreshTimer = setInterval(() => {
        if(isDashboardQueueDefinitelyIdle()) return
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

// 2026-09-30: this used to treat the broadcast as a bare "something
// changed, go re-read storage" signal -- which meant every push triggered a
// full loadState() (an 8-key browser.storage.local.get plus a
// refresh-coordinator-runs-view round trip) just to learn a value the
// service worker already had in hand at the moment it sent the message
// (see notifyCoordinatorDashboardStateChanged's own comment). Applying
// message.state directly here, when present, updates the counts the
// worker bar/dashboard-bottom-bar/summary tiles read (getQueueStatusCount,
// getQueueTotalCount, getQueueTerminalCount all prefer state.queueCounts/
// state.queueTotal once hasCoordinatorQueueView() is true) without any
// storage round trip at all. Deliberately NOT touched here: state.queue
// (the Current Work row list) -- this per-write view is the cheap,
// unmerged one built straight from the live authority queue, missing
// rows that already archived out from a *previous* transition, and
// applyCoordinatorQueueView would overwrite the row list with that
// incomplete set. The counts/total themselves are guarded by the
// isRegression check below instead: a hot-path mutation's own unmerged
// rebuild can under-report relative to what this page already has on
// screen (missing rows that already archived out in a *previous*
// transition), so a pushed value is only applied when it doesn't regress
// below what's already displayed. The periodic compact-storage poll below still runs
// as a slower-cadence correctness net that also refreshes the row list,
// runs, and metrics -- this is a fast path layered on top of it, not a
// replacement for it.
function sumTerminalQueueCounts(counts = {}) {
    return Object.entries(counts || {})
        .filter(([status]) => isTerminalQueueStatus(status))
        .reduce((total, [, count]) => total + (Number.parseInt(count, 10) || 0), 0)
}

function applyCoordinatorDashboardStateFromMessage(incomingState = {}) {
    let applied = false
    if(Object.prototype.hasOwnProperty.call(incomingState, COORDINATOR_QUEUE_VIEW_KEY)) {
        const view = incomingState[COORDINATOR_QUEUE_VIEW_KEY]
        // 2026-10-01: mbCoordinatorQueueView is never persisted to disk (see
        // refreshCoordinatorQueueViewForDashboard's own comment in sw.js) --
        // every hot-path mutation broadcasts its own unmerged rebuild (built
        // straight from the live authority queue, no completed-rows merge),
        // which can be a dramatic undercount for a batch that's already
        // archived hundreds of rows into the completed-work log -- confirmed
        // live (jumped 419/676 -> 10/290 -> back, before this guard existed).
        // Never let a pushed total or terminal count regress below what this
        // page already has on screen. A real decrease (cancel/clear) goes
        // through its own explicit loadState()+render() after the action
        // completes, not through this push path, so this guard can't block
        // it.
        const incomingTotal = Number.parseInt(view?.total, 10) || 0
        const incomingTerminal = sumTerminalQueueCounts(view?.counts)
        const currentTerminal = sumTerminalQueueCounts(state.queueCounts)
        const isRegression = hasCoordinatorQueueView() &&
            (incomingTotal < state.queueTotal || incomingTerminal < currentTerminal)
        if(hasCoordinatorQueueView() && view && typeof view === 'object' && !isRegression) {
            state.queueCounts = normalizeObject(view.counts)
            state.queueTotal = incomingTotal || state.queueTotal
            applied = true
        }
    }
    if(Object.prototype.hasOwnProperty.call(incomingState, COORDINATOR_PAUSED_KEY)) {
        state.paused = incomingState[COORDINATOR_PAUSED_KEY] === true
        applied = true
    }
    if(Object.prototype.hasOwnProperty.call(incomingState, COORDINATOR_RETRY_FAILED_ENABLED_KEY)) {
        retryFailedActive = incomingState[COORDINATOR_RETRY_FAILED_ENABLED_KEY] === true
        applied = true
    }
    if(Object.prototype.hasOwnProperty.call(incomingState, DEV_MODE_SYNC_STORAGE_KEY)) {
        applyDevModeEnabled(incomingState[DEV_MODE_SYNC_STORAGE_KEY] === true)
        applied = true
    }
    if(applied) render()
    return applied
}

function installDashboardRuntimeRefreshListener() {
    if(!browser.runtime?.onMessage?.addListener) return
    browser.runtime.onMessage.addListener(message => {
        if(`${message?.action || ''}` === 'debug-run-limit-reached') {
            // Every open dashboard page gets this broadcast. The worker lets only the first page claim the run id, and that page saves.
            void claimDebugRunAutosave(`${message?.limitId || ''}`)
            return
        }
        if(`${message?.action || ''}` !== 'coordinator-dashboard-state-changed') return
        if(applyCoordinatorDashboardStateFromMessage(message?.state || {})) return
        scheduleDashboardCompactRefresh(DASHBOARD_COMPACT_REFRESH_PUSH_DELAY_MS)
    })
}

async function claimDebugRunAutosave(limitId) {
    const claim = await sendRuntimeMessageWithTimeout({action: 'claim-debug-run-autosave', limitId}, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS).catch(() => null)
    if(claim?.claimed === false) return
    void saveFlightRecorder()
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

async function sendRuntimeMessageWithTimeout(message, fallback = null, timeoutMs = COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS) {
    const timeoutMarker = {timedOut: true}
    const timeout = new Promise(resolve => setTimeout(() => resolve(timeoutMarker), timeoutMs))
    const result = await Promise.race([
        browser.runtime.sendMessage(message),
        timeout
    ])

    return result === timeoutMarker ? fallback : result
}

// The service worker stores the flag in chrome.storage. This page keeps a copy that the synchronous readers use, loaded at
// init. A change made in another open dashboard page applies on that page's next load.
let devModeStoredEnabled = false
// The run-status poll's timer, or null while dev mode is off. Started and stopped by syncDebugRunStatusTimer (review-3 R3-4).
let debugRunStatusTimer = null

function isDevModeStoredEnabled() {
    return devModeStoredEnabled
}

async function loadDevModeStoredEnabled() {
    const stored = await browser.storage.local.get({[DEV_MODE_SYNC_STORAGE_KEY]: false}).catch(() => ({}))
    devModeStoredEnabled = stored[DEV_MODE_SYNC_STORAGE_KEY] === true
}

function setDevModeStoredEnabled(enabled) {
    devModeStoredEnabled = enabled === true
    void sendRuntimeMessageWithTimeout({action: 'set-dev-mode-enabled', enabled: devModeStoredEnabled}, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS).catch(() => null)
}

// Applies a flag the worker pushed from a dashboard toggle. Pages without the toggle or the panels skip those steps.
function applyDevModeEnabled(enabled) {
    devModeStoredEnabled = enabled
    const toggle = document.getElementById('devModeToggle')
    if(toggle) toggle.checked = enabled
    applyDevModeVisibility(enabled)
}

// Diagnostic panels (Metrics, Scan cost, Recent event counts, Outliers,
// Runs, Events) are internal-audience clutter for the common case -- hidden
// entirely behind this toggle regardless of each panel's own expand/collapse
// state, which stays exactly as the user left it for next time dev mode
// comes back on.
function applyDevModeVisibility(enabled) {
    document.querySelectorAll('[data-dev-mode-panel]').forEach(panel => {
        panel.hidden = !enabled
    })
    syncDebugRunStatusTimer(enabled)
}

// The run-status poll asks the worker every second, so it runs only while dev mode is on. Every dev-mode change reaches
// applyDevModeVisibility (init, the toggle, and a push from the worker), which starts or stops it. review-3 R3-4.
function syncDebugRunStatusTimer(enabled) {
    if(enabled && debugRunStatusTimer === null) {
        debugRunStatusTimer = setInterval(() => { void refreshDebugRunStatus() }, 1000)
    }
    else if(!enabled && debugRunStatusTimer !== null) {
        clearInterval(debugRunStatusTimer)
        debugRunStatusTimer = null
    }
}

// Countdown for a dev-mode run limit. Only asks the worker while dev mode is on.
function formatRunCountdown(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
}

async function refreshDebugRunStatus() {
    const timeEl = document.getElementById('debugRunTimeLeft')
    const targetsEl = document.getElementById('debugRunTargetsLeft')
    if(!timeEl || !targetsEl || !isDevModeStoredEnabled()) return
    const status = await sendRuntimeMessageWithTimeout({action: 'get-debug-resume-limit-status'}, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS).catch(() => null)
    if(!status?.active) {
        timeEl.textContent = ''
        targetsEl.textContent = ''
        return
    }
    timeEl.textContent = status.secondsLeft !== null ? `${formatRunCountdown(status.secondsLeft)} left` : ''
    targetsEl.textContent = status.targetLimit > 0 ? `${status.targetsLeft} of ${status.targetLimit} left` : ''
}

function installDevModeToggle() {
    const toggle = document.getElementById('devModeToggle')
    const enabled = isDevModeStoredEnabled()
    if(toggle) toggle.checked = enabled
    applyDevModeVisibility(enabled)
    toggle?.addEventListener('change', () => {
        setDevModeStoredEnabled(toggle.checked)
        applyDevModeVisibility(toggle.checked)
    })
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
    const url = browser.runtime.getURL('preferences.html')
    await browser.tabs.create({url, active: true}).catch(() => {
        window.open(url, '_blank', 'noopener')
    })
}

async function startCoordinatorQueue() {
    const button = document.getElementById('startCoordinatorButton')
    flashButton(button)
    retryFailedLastResult = {reason: 'starting-current-work'}
    render()
    const result = await sendRuntimeMessageWithTimeout({
        action: 'resume-coordinator-queue',
        allowBeforeQuora: true,
        userInitiated: true
    }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS).catch(error => ({
        error: error?.message || `${error || ''}`
    }))

    retryFailedLastResult = {
        reason: result?.error
            ? 'start-current-work-failed'
            : result?.reason || 'start-current-work-scheduled'
    }
    if(result && !result.requiresQuoraVisit) {
        setQuoraVisitRequirement(false)
    }
    await loadState()
    render()
}

async function announceCoordinatorPageReady() {
    try {
        return await sendRuntimeMessageWithTimeout({action: 'coordinator-page-ready'}, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS)
    }
    catch {}
    return null
}

async function resetMetrics() {
    try {
        const result = await sendRuntimeMessageWithTimeout({action: 'reset-queue-wakeup-metrics'}, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS)
        if(result?.reset) {
            await loadState()
            render()
        }
    }
    catch(error) {
        console.warn('Failed to reset metrics', error)
    }
}

async function clearCoordinatorTerminalStats() {
    try {
        await sendRuntimeMessageWithTimeout({action: 'clear-coordinator-terminal-stats'}, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS)
    }
    catch(error) {
        console.warn('Failed to clear terminal stats', error)
    }
}

// One button for the dev-mode panels' individually-scattered clear buttons
// (Metrics, Scan cost, Authority state reads, Recent event counts,
// Outliers) plus the Current Work summary row's Terminal/Events tiles --
// resetMetrics covers the first three (all backed by the same
// queue-wakeup-metrics storage), clearEventHistogram is tab-local only,
// clearCoordinatorTerminalStats (the worker) stamps the dashboard-side
// cutoff Terminal reads against (see COORDINATOR_STATS_CLEARED_AT_KEY in
// sw.js -- nothing is deleted, queued/active rows are never affected) and
// resets the worker's outlier list, and
// clearEvents wipes the durable mbCoordinatorEvents log itself, not just its
// display, so "Clear All Stats" is an unambiguous zeroing of everything
// shown in that row.
async function clearAllStats() {
    await resetMetrics()
    await clearCoordinatorTerminalStats()
    clearEventHistogram()
    await clearEvents()
    await loadState()
    render()
}

// Events come from the flight recorder's event channel (events-to-flight-recorder design, B7a and B11b): the newest
// MAX_DASHBOARD_EVENTS, shaped as the event list has always been shaped. Nothing is read from storage for them.
const MAX_DASHBOARD_EVENTS = 500
const FLIGHT_RECORDER_EVENT_RESERVED_FIELDS = new Set(['kind', 'channel', 'at', 'seq', 'message', 'runId', 'rowKey'])

function flightRecorderEntryToEvent(entry = {}) {
    const details = {}
    for(const [field, value] of Object.entries(entry || {})) {
        if(!FLIGHT_RECORDER_EVENT_RESERVED_FIELDS.has(field)) details[field] = value
    }
    return {
        id: `fr-${entry?.seq || 0}`,
        type: `${entry?.kind || ''}`,
        message: `${entry?.message || ''}`,
        at: Number(entry?.at) || 0,
        runId: `${entry?.runId || ''}`,
        itemId: `${entry?.rowKey || ''}`,
        details
    }
}

async function loadEventsFromFlightRecorder() {
    const result = await sendRuntimeMessageWithTimeout({
        action: 'get-flight-recorder',
        channel: 'event',
        limit: MAX_DASHBOARD_EVENTS
    }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS).catch(() => null)
    if(!result || !Array.isArray(result.entries)) return []
    return result.entries.map(flightRecorderEntryToEvent).slice(-MAX_DASHBOARD_EVENTS)
}

async function loadState() {
    const stored = await browser.storage.local.get({
        [COORDINATOR_RUNS_KEY]: {},
        [QUEUE_WAKEUP_METRICS_VIEW_KEY]: {},
        [SPACE_REGISTRY_KEY]: {},
        [HIDDEN_RUNS_KEY]: [],
        [COORDINATOR_RETRY_FAILED_ENABLED_KEY]: false,
        [COORDINATOR_PAUSED_KEY]: false,
        [COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY]: null
    })

    // The paused flag is already in hand, so show it now. It used to wait for
    // the service worker's view (about a second on an idle queue, more under
    // load), and the button read "Pause" over a paused queue for that whole
    // time, so a click in that window sent the wrong action.
    state.paused = !!stored[COORDINATOR_PAUSED_KEY]
    render()

    // Always ask the service worker to build the queue view fresh, rather
    // than trusting whatever's sitting in storage.mbCoordinatorQueueView --
    // that storage copy exists for other consumers (the SW's own cheap
    // startup "is there stored work" check, and as a resilience fallback if
    // this very message times out), not as something the dashboard should
    // read directly. Nothing re-filters it against the current set of known
    // runs until a rebuild actually runs, so a plain storage read can sit
    // stale indefinitely -- e.g. mixing in terminal rows from runs that no
    // longer exist -- and periodic dashboard polling (see
    // refreshDashboardStateFromCompactStorage) would otherwise just keep
    // re-reading that same stale snapshot forever instead of ever
    // correcting it.
    const refreshed = await refreshCompactDashboardViews()
    // Same reasoning as the queue view above, for the same underlying reason:
    // mbCoordinatorRuns[runId]'s itemCount/targetProfileHrefs/targetWorkKeys/
    // activeCount/terminalCount/status are maintained as a mutated running
    // total by ~24 independent, unserialized call sites in sw.js (see
    // architecture.md's "Derived Stats Must Not Be A Mutated Running Total"
    // and mutated-running-total-audit-todo-2026-09-25.md) and can lose
    // updates when several of a run's items terminalize in quick succession.
    // Ask the service worker to compute run stats fresh from current
    // authority plus the full completed-work log instead of trusting that
    // storage copy; fall back to it only if the message truly fails.
    if(!refreshed.runsRefreshed) {
        state.runs = normalizeObject(stored[COORDINATOR_RUNS_KEY])
    }
    state.events = await loadEventsFromFlightRecorder()
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
    state.lastEnqueueSummary = stored[COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY] || null
}

// One round trip for both dashboard views. The service worker reads authority
// once and derives the queue view and the runs summary from that read, so a
// poll no longer pays for the same WAL replay twice.
async function refreshCompactDashboardViews() {
    const result = await sendRuntimeMessageWithTimeout({
        action: 'refresh-coordinator-dashboard-views',
        reason: 'dashboard-load'
    }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)

    const queueRefreshed = hasCoordinatorQueueView(result?.view)
    if(queueRefreshed) {
        applyCoordinatorQueueView(result.view)
    }
    else if(result?.error) {
        // The service worker could not load the coordinator authority (its refresh answers with an explicit error, never an
        // empty view). Keep the last good view rather than replacing it with a blank one, and report the failure.
        console.error('Coordinator dashboard refresh failed:', result.error, result.detail || '')
    }
    else {
        // mbCoordinatorQueueView is no longer persisted to disk (see sw.js's
        // refreshCoordinatorQueueViewForDashboard) -- there's no storage fallback
        // to read if the message above timed out or came back empty.
        applyCoordinatorQueueView({
            version: 1,
            updatedAt: Date.now(),
            total: 0,
            counts: {},
            itemLimit: 0,
            truncated: false,
            items: []
        })
    }

    const runsRefreshed = !!result?.runs && typeof result.runs === 'object' && !Array.isArray(result.runs)
    if(runsRefreshed) state.runs = result.runs
    if(Array.isArray(result?.outliers)) state.outliers = result.outliers
    return {queueRefreshed, runsRefreshed}
}


// Deliberately not a default parameter (`value = state.queueView`): a
// caller checking some other object's shape -- e.g.
// hasCoordinatorQueueView(result?.view) -- passes an explicit `undefined`
// when that object has no .view at all (including when the object itself,
// `result`, is null), and a default parameter activates on ANY explicit
// undefined argument, not just a missing one. That silently substituted
// the dashboard's own cached state.queueView in its place, which can
// easily still look valid -- so the check passed, the caller proceeded as
// if the response had a real view, and crashed moments later reading
// .view off the actual (null) result. Confirmed live 2026-10-08:
// "Uncaught (in promise) TypeError: Cannot read properties of null
// (reading 'view')" in coordinator.js, both organically (refreshCompactDashboardViews,
// 14 occurrences from one idle dashboard) and via Clear All Stats
// (refreshCompactMetricsView's identical pattern, see
// hasQueueWakeupMetricsView below). arguments.length distinguishes a
// genuinely no-arg call (the many call sites below that mean "check the
// dashboard's current state") from an explicit-but-undefined one (must be
// checked literally, never substituted).
function hasCoordinatorQueueView(value) {
    const resolved = arguments.length > 0 ? value : state.queueView
    return !!resolved &&
        typeof resolved === 'object' &&
        !Array.isArray(resolved) &&
        Number.parseInt(resolved.version, 10) >= 1 &&
        Array.isArray(resolved.items)
}

async function refreshCompactMetricsView() {
    const result = await sendRuntimeMessageWithTimeout({
        action: 'refresh-queue-wakeup-metrics-view',
        reason: 'dashboard-load-missing-view'
    }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)
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

// See hasCoordinatorQueueView's own comment -- same explicit-undefined-vs-
// no-argument distinction, for the same reason (refreshCompactMetricsView's
// `hasQueueWakeupMetricsView(result?.view)` call above is the Clear All
// Stats crash's actual trigger).
function hasQueueWakeupMetricsView(value) {
    const resolved = arguments.length > 0 ? value : state.metrics
    return !!resolved &&
        typeof resolved === 'object' &&
        !Array.isArray(resolved) &&
        Number.parseInt(resolved.version, 10) >= 1 &&
        Number.parseInt(resolved.viewVersion, 10) >= 1 &&
        !!resolved.currentEpoch
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

// The worker window's minimal "idiot light" status bar -- deliberately not
// the full control-panel dashboard (see nits3.md item 5 discussion): just a
// window-width progress fill of handled-vs-total Current Work items, a
// count, and the handful of actions relevant to a background worker window.
function renderWorkerBar() {
    const total = getQueueTotalCount()
    const terminal = getQueueTerminalCount()
    const fill = document.getElementById('workerBarFill')
    const count = document.getElementById('workerBarCount')
    const pauseResumeButton = document.getElementById('workerBarPauseResume')
    const cancelButton = document.getElementById('workerBarCancel')

    if(fill) fill.style.width = `${total > 0 ? Math.min(100, Math.round((terminal / total) * 100)) : 0}%`
    if(count) count.textContent = `${terminal} / ${total}`

    if(pauseResumeButton) {
        const pausePending = currentWorkPausePending === 'pause'
        const resumePending = currentWorkPausePending === 'resume'
        pauseResumeButton.textContent = pausePending
            ? 'Pausing...'
            : resumePending
                ? 'Resuming...'
                : state.paused ? 'Resume' : 'Pause'
        pauseResumeButton.disabled = pausePending || resumePending
    }

    if(cancelButton) {
        const pendingCount = getPendingCurrentWorkItems().length
        cancelButton.disabled = pendingCount <= 0
    }
}

// The plain dashboard's own footer strip -- same handled-vs-total fill as
// renderWorkerBar, but for the real control-panel page itself rather than
// the worker window. `queueItems` is threaded through so this stays in sync
// with whatever render() just computed for the summary tiles, instead of
// re-deriving it from state on its own.
function renderDashboardBottomBar(queueItems = []) {
    const total = getQueueTotalCount(queueItems)
    const terminal = getQueueTerminalCount(queueItems)
    const fill = document.getElementById('dashboardBottomBarFill')
    const count = document.getElementById('dashboardBottomBarCount')

    if(fill) fill.style.width = `${total > 0 ? Math.min(100, Math.round((terminal / total) * 100)) : 0}%`
    if(count) count.textContent = `${terminal} / ${total}`
}

// The bottom-bar logo is a "jump to the real dashboard" shortcut, meant to
// work the same way wherever this bar ends up rendering -- a deliberate
// no-op when the page showing it is already the plain dashboard (currently
// the only place it renders, but the guard is what the button is supposed
// to mean regardless of where it's embedded).
async function openDashboardFromBottomBar() {
    if(!isQueuedWorkerActionSurfacePage() && !isCoordinatorHistoryPage()) return
    await openCoordinatorViewFromHere('open-coordinator')
}

function getBlockOutcomeCounts() {
    const metricsDocument = state.metrics || {}
    const counters = (metricsDocument.currentEpoch || metricsDocument).counters || {}
    const reallyBlockedCount = getMetricCounter(counters, 'profileAction.reallyBlocked.count')
    const alreadyBlockedCount = getMetricCounter(counters, 'profileAction.alreadyBlocked.count')
    // Not folded into `total`/the really-vs-already-blocked percentages --
    // this is a different category (skipped, not a block outcome at all),
    // just reusing the same counted-stat mechanism.
    const blockAttemptOnFollowingCount = getMetricCounter(counters, 'profileAction.blockAttemptOnFollowing.count')
    const total = reallyBlockedCount + alreadyBlockedCount
    return {
        reallyBlockedCount,
        alreadyBlockedCount,
        blockAttemptOnFollowingCount,
        total,
        // Recorded by recordCoordinatorProfileActionOutcomeStat
        // (swCoordinatorProgressReducer.js) alongside the counts above, one
        // pair per outcome bucket -- see formatBlockOutcomeDuration for how
        // these become an avg/max on the summary tile. durationSampleCount is
        // the avg denominator, not reallyBlockedCount/alreadyBlockedCount --
        // it excludes any sample over PROFILE_ACTION_TIMING_SAMPLE_MAX_PLAUSIBLE_MS
        // (a stale-backlog row or WAL-recovery gap), which the *Count fields
        // above intentionally still include since those feed the outcome
        // percentage tile, not a duration average.
        reallyBlockedDurationSampleCount: getMetricCounter(counters, 'profileAction.reallyBlocked.durationSampleCount'),
        reallyBlockedTotalDurationMs: getMetricCounter(counters, 'profileAction.reallyBlocked.totalDurationMs'),
        reallyBlockedMaxDurationMs: getMetricCounter(counters, 'profileAction.reallyBlocked.maxDurationMs'),
        alreadyBlockedDurationSampleCount: getMetricCounter(counters, 'profileAction.alreadyBlocked.durationSampleCount'),
        alreadyBlockedTotalDurationMs: getMetricCounter(counters, 'profileAction.alreadyBlocked.totalDurationMs'),
        alreadyBlockedMaxDurationMs: getMetricCounter(counters, 'profileAction.alreadyBlocked.maxDurationMs')
    }
}

function formatBlockOutcomeCount(count = 0, total = 0) {
    return total > 0 ? `${count} (${formatPercent(count / total)})` : `${count}`
}

function formatBlockOutcomeDuration(count = 0, totalDurationMs = 0, maxDurationMs = 0) {
    if(!count) return 'no completions yet this epoch'
    return `avg ${formatDuration(totalDurationMs / count)}, max ${formatDuration(maxDurationMs)} active-to-terminal`
}

function render() {
    if(isQueuedWorkerActionSurfacePage()) {
        renderWorkerBar()
        return
    }

    const queueItems = getDisplayQueueItems()
    const runItems = getDisplayRuns(queueItems)
    refreshQuoraVisitRequirement(queueItems)
    const queuedCount = getQueueStatusCount('queued', queueItems)
    const activeCount = getQueueStatusCount('opening', queueItems) +
        getQueueStatusCount('active', queueItems) +
        getQueueStatusCount('acting', queueItems) +
        getQueueStatusCount('settling', queueItems)
    const terminalCount = getQueueTerminalCount(queueItems)
    const secondsPerBlock = getSecondsPerActualBlock(getCurrentMetricsEpochStartedAt())
    const secondsPerAlreadyBlocked = getSecondsPerAlreadyBlocked(getCurrentMetricsEpochStartedAt())
    const activationHandoff = getActivationHandoffSeconds(getCurrentMetricsEpochStartedAt())
    const failedCount = getQueueStatusCount('failed', queueItems)
    const canceledCount = getQueueStatusCount('canceled', queueItems)
    const succeededCount = getQueueStatusCount('succeeded', queueItems)
    const {eligible: retryableFailedCount, exhausted: exhaustedRetryableFailedCount} = getSoftFailRetryCounts(queueItems)
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
    setText('secondsPerAlreadyBlocked', formatSecondsPerBlock(secondsPerAlreadyBlocked))
    setText('activationHandoffSeconds', formatSecondsPerBlock(activationHandoff))
    const blockOutcomeCounts = getBlockOutcomeCounts()
    setText('reallyBlockedCount', formatBlockOutcomeCount(blockOutcomeCounts.reallyBlockedCount, blockOutcomeCounts.total))
    setText('alreadyBlockedCount', formatBlockOutcomeCount(blockOutcomeCounts.alreadyBlockedCount, blockOutcomeCounts.total))
    setText('reallyBlockedDuration', formatBlockOutcomeDuration(
        blockOutcomeCounts.reallyBlockedDurationSampleCount,
        blockOutcomeCounts.reallyBlockedTotalDurationMs,
        blockOutcomeCounts.reallyBlockedMaxDurationMs
    ))
    setText('alreadyBlockedDuration', formatBlockOutcomeDuration(
        blockOutcomeCounts.alreadyBlockedDurationSampleCount,
        blockOutcomeCounts.alreadyBlockedTotalDurationMs,
        blockOutcomeCounts.alreadyBlockedMaxDurationMs
    ))
    setText('blockAttemptOnFollowingCount', blockOutcomeCounts.blockAttemptOnFollowingCount)
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
    renderScanCostHistogram()
    renderAuthorityLoadHistogram()
    renderEventHistogram()
    renderPhaseTimingHistogram()
    renderWriteSizeHistogram()
    renderQueue(queueItems)
    renderOutliers()
    renderDashboardBottomBar(queueItems)
    syncRetryFailedControls(queueItems, retryableFailedCount, exhaustedRetryableFailedCount)
    syncRequeueFailedControls(failedCount + canceledCount)
    syncCurrentWorkPauseControls(queueItems)
    syncStartCoordinatorControls()
    syncLastEnqueueSummary()
}

// Durable counterpart to the transient nuke-button notice: shows the most
// recent enqueue's requested/queued/merged breakdown so a big submission
// that mostly deduped against already-known rows (currently queued, or a
// past terminal outcome) doesn't look like most of it silently vanished --
// this was previously only visible as free text buried in the capped
// mbCoordinatorEvents log. Self-expires after LAST_ENQUEUE_SUMMARY_MAX_AGE_MS
// so it doesn't linger indefinitely as stale context from a much earlier add.
// Shared by the transient "last enqueue" banner (below) and each run's own
// durable subtitle (getRunDisplay) -- same requested/queued/merged/preFilter
// shape, just sourced from a different summary object (the single global
// "last enqueue across any run" one vs. a specific run's own accumulated
// enqueueRequested/enqueueQueued/enqueueMerged/enqueuePreFilter fields).
function formatCoordinatorEnqueueBreakdown(summary = null) {
    if(!summary) return ''

    const requested = Number.parseInt(summary.requested, 10) || 0
    const queued = Number.parseInt(summary.queued, 10) || 0
    const merged = Number.parseInt(summary.merged, 10) || 0
    if(!requested) return ''

    const noticeParts = []
    if(merged > 0) noticeParts.push(`${merged} already known`)

    // preFilter counts candidates a space-feed submission dropped before
    // "requested" was even built (already nuked, no resolvable profile,
    // several posts by the same author collapsing to one profile) -- without
    // this, "requested" alone understates how big the original selection
    // was and the drop looks unexplained.
    // Reads as: raw candidates (one per post-profile pair), duplicates collapsed
    // to unique profiles, then what was queued. Summaries written before
    // rawWorkItems existed fall back to the plain requested count.
    const preFilter = summary.preFilter
    const rawWorkItems = Number.parseInt(preFilter?.rawWorkItems, 10) || 0
    const duplicates = Number.parseInt(preFilter?.duplicateProfile, 10) || 0
    if(preFilter) {
        if(preFilter.alreadyNuked) noticeParts.push(`${preFilter.alreadyNuked} already nuked`)
        if(preFilter.unqueueable) noticeParts.push(`${preFilter.unqueueable} unresolvable`)
    }

    const fromPart = rawWorkItems > requested
        ? `${rawWorkItems} candidates, ${duplicates} duplicates, ${requested} unique`
        : `${requested} candidates`
    return noticeParts.length
        ? `${fromPart} -> ${queued} new (${noticeParts.join(', ')})`
        : `${fromPart} -> ${queued} new`
}

function syncLastEnqueueSummary() {
    const element = document.getElementById('lastEnqueueSummary')
    if(!element) return

    const summary = state.lastEnqueueSummary
    const at = Number.parseInt(summary?.at, 10) || 0
    if(!summary || !at || (Date.now() - at) > LAST_ENQUEUE_SUMMARY_MAX_AGE_MS) {
        element.hidden = true
        element.textContent = ''
        return
    }

    const breakdown = formatCoordinatorEnqueueBreakdown(summary)
    element.hidden = !breakdown
    element.textContent = breakdown ? `Last add: ${breakdown}` : ''
}

function getCurrentWorkSummaryText(queueItems = [], counts = {}) {
    // The list holds the live rows only (buildCoordinatorQueueViewFromDashboardSnapshot in sw.js), so the header counts the listed rows.
    // The view total also counts finished rows, which are not listed; it is shown only in the truncated form.
    const totalCount = getQueueTotalCount(queueItems)
    const listedCount = queueItems.length
    const showingText = state.queueTruncated
        ? `Showing ${listedCount} of ${totalCount}`
        : `Showing ${listedCount}`
    const queuedCount = Number.parseInt(counts.queuedCount, 10) || 0
    const succeededCount = Number.parseInt(counts.succeededCount, 10) || 0
    const softFailedCount = Number.parseInt(counts.retryableFailedCount, 10) || 0
    const hardFailedCount = Number.parseInt(counts.hardFailedCount, 10) || 0

    return `${showingText}, ${queuedCount} queued, ${succeededCount} succeeded, ${softFailedCount} soft-fail, ${hardFailedCount} hard-fail`
}

async function clearEvents() {
    await sendRuntimeMessageWithTimeout({action: 'clear-coordinator-events'}, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)
    state.events = []
    render()
}

async function clearCompletedRuns() {
    const runItems = getDisplayRuns(getDisplayQueueItems(), {includeHidden: true})
    const nextHiddenRunIds = new Set(state.hiddenRunIds || [])

    for(const run of runItems) {
        const runId = run?.id || run?.runId || ''
        if(runId && `${run.status || ''}` === 'empty') {
            nextHiddenRunIds.add(runId)
        }
    }

    state.hiddenRunIds = Array.from(nextHiddenRunIds)
    await sendRuntimeMessageWithTimeout({action: 'set-hidden-run-ids', runIds: state.hiddenRunIds}, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)
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
    return isRetryableCoordinatorFailure(item)
}

function getRetryFailedCount(item = null) {
    return Number.parseInt(item?.retryCount, 10) || 0
}

function isEligibleRetryFailedQueueItem(item = null) {
    return isRetryableFailedQueueItem(item) && getRetryFailedCount(item) < RETRY_FAILED_LIMIT
}

// The worker counts the soft-fail retry figures over every compact row (view.softFailRetry): a finished soft-fail at the retry limit is
// not in the list, so counting the list would drop the "retry limit reached" figure. Without a view, the list is counted, as before.
function getSoftFailRetryCounts(queueItems = []) {
    const fromView = hasCoordinatorQueueView() ? state.queueView?.softFailRetry : null
    if(fromView && typeof fromView === 'object') {
        return {
            eligible: Number.parseInt(fromView.eligible, 10) || 0,
            exhausted: Number.parseInt(fromView.exhausted, 10) || 0
        }
    }
    const eligible = queueItems.filter(isEligibleRetryFailedQueueItem).length
    const shape = queueItems.filter(isRetryableFailedQueueItem).length
    return {eligible, exhausted: Math.max(0, shape - eligible)}
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
        ? 'Start Current Work without waiting for a Quora page'
        : 'Quora runtime is available'
}

function getRetryFailedWorkWaitText({hasPendingWork = false, hasActiveWork = false} = {}) {
    if(!hasPendingWork) return ''
    if(state.requiresQuoraVisit) return 'waiting for first Quora page'
    if(hasActiveWork) return 'waiting for current work to idle'
    return 'queued work is waiting to start'
}

function syncRequeueFailedControls(requeueableCount = 0) {
    const button = document.getElementById('requeueFailedButton')
    if(!button) return

    button.disabled = requeueableCount <= 0
    button.title = requeueableCount > 0
        ? `Reset and requeue ${requeueableCount} failed/canceled Current Work job${requeueableCount === 1 ? '' : 's'}`
        : 'No failed or canceled Current Work jobs to requeue'
}

async function requeueFailed() {
    const items = getDisplayQueueItems()
    const requeueableCount = getQueueStatusCount('failed', items) + getQueueStatusCount('canceled', items)
    if(requeueableCount <= 0) {
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
    }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS).catch(error => ({
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
    }, {error: 'cancel-one-current-work-timeout'}, CURRENT_WORK_MUTATION_TIMEOUT_MS).catch(error => ({
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
    const itemStatus = `${item?.status || ''}`
    if(itemStatus !== 'failed' && itemStatus !== 'canceled') return

    const storageKey = `${item.storageKey || ''}`.trim()
    const profileHref = getQueueItemHref('', item)
    retryFailedLastResult = {reason: 'requeueing-one-failed'}
    render()

    const result = await sendRuntimeMessageWithTimeout({
        action: 'requeue-coordinator-failed',
        storageKey,
        coordinatorKey: storageKey,
        profileHref
    }, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS).catch(error => ({
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
        pauseButton.disabled = pausePending || resumePending
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
                : 'Pause now, before queueing more work'
    }

    if(pauseState) {
        pauseState.textContent = pausePending
            ? 'Pausing...'
            : resumePending
                ? 'Resuming...'
                : state.paused ? 'Paused' : 'Running'
        pauseState.classList.toggle('pause-state--paused', state.paused && !pausePending && !resumePending)
        pauseState.classList.toggle('pause-state--pending', pausePending || resumePending)
        pauseState.classList.toggle('pause-state--running', !state.paused && !pausePending && !resumePending)
    }

    if(cancelButton) {
        cancelButton.disabled = pendingCount <= 0
        cancelButton.title = pendingCount > 0
            ? `Cancel ${pendingCount} pending Current Work job${pendingCount === 1 ? '' : 's'}`
            : 'No pending Current Work to cancel'
    }

    const clearButton = document.getElementById('clearCurrentWorkButton')
    if(clearButton) {
        // Clear removes finished rows too (mutateCoordinatorStoredWorkClear in sw.js), so the view total decides, not the listed rows.
        const totalCount = getQueueTotalCount(queueItems)
        clearButton.disabled = totalCount <= 0
        clearButton.title = totalCount > 0
            ? `Cancel and remove all ${totalCount} Current Work row${totalCount === 1 ? '' : 's'}`
            : 'No Current Work to clear'
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
    const request = state.paused
        ? {action: 'resume-paused-coordinator-nukes', debugLimit: readDebugResumeLimitFromControls()}
        : {action: 'pause-coordinator-nukes'}
    const result = await sendRuntimeMessageWithTimeout(request, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS).catch(error => ({
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

// Dev-mode only: the Resume-for / Until dropdowns. Outside dev mode they are hidden and ignored.
function readDebugResumeLimitFromControls() {
    if(!isDevModeStoredEnabled()) return null
    const minutes = Number.parseInt(document.getElementById('debugResumeMinutesSelect')?.value, 10) || 0
    const targets = Number.parseInt(document.getElementById('debugResumeTargetsSelect')?.value, 10) || 0
    if(minutes <= 0 && targets <= 0) return null
    return {minutes, targets}
}

// Dev-mode only: downloads the service worker's flight recorder as JSON.
async function saveFlightRecorder() {
    const button = document.getElementById('saveFlightRecorderButton')
    flashButton(button)
    const result = await sendRuntimeMessageWithTimeout({
        action: 'get-flight-recorder',
        limit: 20000
    }, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS).catch(error => ({
        error: error?.message || `${error || ''}`
    }))
    if(result?.error || !Array.isArray(result?.entries)) {
        retryFailedLastResult = {reason: 'flight-recorder-save-failed'}
        render()
        return
    }
    const blob = new Blob([JSON.stringify(result, null, 2)], {type: 'application/json'})
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `flight-recorder-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
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
    }, {error: 'cancel-current-work-timeout'}, CURRENT_WORK_MUTATION_TIMEOUT_MS).catch(error => ({
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

// Unlike cancelCurrentWork (which only stops pending/active rows -- terminal
// rows stay in the completed-work log and keep showing up here), this asks
// the service worker to remove every Current Work row entirely, live or
// completed, so the list actually empties.
async function clearCurrentWork() {
    // The view total, not the listed rows: Clear removes finished rows too (see syncCurrentWorkPauseControls).
    const totalRowCount = getQueueTotalCount(getDisplayQueueItems())
    if(totalRowCount <= 0) {
        retryFailedLastResult = {reason: 'no-current-work-to-clear'}
        render()
        return
    }

    const button = document.getElementById('clearCurrentWorkButton')
    if(button) button.disabled = true
    retryFailedLastResult = {reason: 'clearing-current-work'}
    render()

    const result = await sendRuntimeMessageWithTimeout({
        action: 'clear-coordinator-current-work'
    }, {error: 'clear-current-work-timeout'}, CURRENT_WORK_MUTATION_TIMEOUT_MS).catch(error => ({
        error: error?.message || `${error || ''}`
    }))

    retryFailedLastResult = {
        reason: result?.error
            ? 'clear-current-work-failed'
            : `cleared-${(Number.parseInt(result?.clearedUrls?.length, 10) || 0) + (Number.parseInt(result?.clearedWorkKeys?.length, 10) || 0)}`
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
    await sendRuntimeMessageWithTimeout({action: 'set-coordinator-retry-failed-enabled', enabled: true}, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS)
    retryFailedLastResult = {reason: 'service-worker-scheduled'}
    render()
}

function stopRetryFailed(reason = 'idle', {persist = true} = {}) {
    retryFailedActive = false
    retryFailedLastResult = {reason}
    render()
    if(persist) {
        void sendRuntimeMessageWithTimeout({action: 'set-coordinator-retry-failed-enabled', enabled: false}, null, COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS).catch(() => null)
    }
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
            status: 'running',
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
            status: runItems.length > 0 && terminalCount === runItems.length ? 'empty' : existing.status || 'running',
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
    return isTerminalCoordinatorStatus(status)
}

function isActiveQueueItem(item = {}) {
    return isActiveCoordinatorStatus(item?.status)
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

// The finished rows are not in the list (view.items holds the live rows only), so the gate reads the worker's count over the full compact
// population (view.finishedWork), as getSoftFailRetryCounts reads view.softFailRetry. Without that summary the list is read, as before.
function hasFreshTerminalQueueWork(queueItems = []) {
    const epochStartedAt = getCurrentMetricsEpochStartedAt()
    const finishedWork = hasCoordinatorQueueView() ? state.queueView?.finishedWork : null
    if(finishedWork && typeof finishedWork === 'object') {
        const latestActivityAt = Number.parseInt(finishedWork.latestActivityAt, 10) || 0
        return (Number.parseInt(finishedWork.count, 10) || 0) > 0 && (!epochStartedAt || latestActivityAt >= epochStartedAt)
    }
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

// The timing tiles show the worker's summaries only (view.actualBlockTiming, view.alreadyBlockedTiming, view.activationHandoffTiming).
// The worker computes them over the full compact population, finished rows included. The list holds the live rows only, so the page
// cannot recompute these averages from it. With no usable summary a tile shows "--".
function getSecondsPerActualBlock(epochStartedAt = 0) {
    return getQueueViewSecondsPerActualBlock(epochStartedAt)
}

function getSecondsPerAlreadyBlocked(epochStartedAt = 0) {
    return getQueueViewSecondsPerAlreadyBlocked(epochStartedAt)
}

// Shared by the queueView-summary readers below (real block, already
// blocked, handoff) -- each SW-provided summary object carries its own
// epochStartedAt (for the same-epoch-only check) and count under a
// differently-named field (blocks vs handoffs), passed in as countField.
function getQueueViewTimingSummarySeconds(summary = null, epochStartedAt = 0, countField = 'blocks') {
    if(!summary || typeof summary !== 'object') return null

    const requestedEpochStartedAt = Number.parseInt(epochStartedAt, 10) || 0
    const summaryEpochStartedAt = Number.parseInt(summary.epochStartedAt, 10) || 0
    if(requestedEpochStartedAt && summaryEpochStartedAt && summaryEpochStartedAt !== requestedEpochStartedAt) return null

    const blocks = Number.parseInt(summary[countField], 10) || 0
    const elapsedMs = Number.parseInt(summary.elapsedMs, 10) || 0
    const seconds = Number(summary.seconds)
    if(blocks <= 0 || elapsedMs <= 0 || !Number.isFinite(seconds) || seconds <= 0) return null

    return {
        seconds,
        blocks,
        elapsedMs
    }
}

function getQueueViewSecondsPerActualBlock(epochStartedAt = 0) {
    return getQueueViewTimingSummarySeconds(state.queueView?.actualBlockTiming, epochStartedAt, 'blocks')
}

function getQueueViewSecondsPerAlreadyBlocked(epochStartedAt = 0) {
    return getQueueViewTimingSummarySeconds(state.queueView?.alreadyBlockedTiming, epochStartedAt, 'blocks')
}

function getActivationHandoffSeconds(epochStartedAt = 0) {
    return getQueueViewActivationHandoffSeconds(epochStartedAt)
}

function getQueueViewActivationHandoffSeconds(epochStartedAt = 0) {
    return getQueueViewTimingSummarySeconds(state.queueView?.activationHandoffTiming, epochStartedAt, 'handoffs')
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
    return isPendingCoordinatorStatus(status)
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

// The server's run status is a deliberately small 3-state rollup --
// 'running'/'paused'/'empty' -- where 'empty' means "nothing left to do in
// this run" regardless of whether that's because every item succeeded or
// the run never had any items (see getCoordinatorRunStatus's own comment;
// "Clear Completed" above relies on exactly that single value to find
// everything it should hide). Showing that raw label on a 494-item run that
// fully succeeded reads as if the run lost its items, not that it finished
// -- this only affects the displayed badge text, not the underlying status
// value anything else here keys off of.
function getRunStatusLabel(run = {}) {
    const status = `${run?.status || ''}`.trim() || 'unknown'
    if(status !== 'empty') return status
    return (Number.parseInt(run?.itemCount, 10) || 0) > 0 ? 'done' : 'empty'
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
            buildBadge(getRunStatusLabel(run)),
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
    // 2026-09-27: nudge.sent increments on every nudgeQueuedTabActionClaim
    // call, including ones the coalesce cooldown (isKeyedThrottleCoalesced)
    // skips before actually messaging a tab -- confirmed live at 444
    // coalesced out of 749 "sent," each one an intentional, expected skip
    // (there was already a nudge outstanding for that tab), not a failure.
    // Dividing accepted by the full sent count made a healthy run look
    // like it was only accepting ~31% of nudges, when the real rate among
    // nudges that actually went out was much higher. nudgeDispatched
    // backs those out of the denominator.
    const nudgeCoalesced = getMetricCounter(counters, 'nudge.coalesced')
    const nudgeDispatched = Math.max(0, nudgeSent - nudgeCoalesced)
    const pumpRequested = getMetricCounter(counters, 'pump.requested')
    const pumpChanged = sumMetricCounters(counters, 'pump.changed.')
    const reconcileRequested = getMetricCounter(counters, 'reconcile.requested')
    const reconcileChanged = sumMetricCounters(counters, 'reconcile.changed.')
    const storageStarted = getMetricCounter(counters, 'storageUpdate.started')
    const storageTimedOut = getMetricCounter(counters, 'storageUpdate.timedOut')
    const storageDeadlineMissed = getMetricCounter(counters, 'storageUpdate.deadlineMissed')
    const storageFallbackReturned = getMetricCounter(counters, 'storageUpdate.fallbackReturned')
    const storageNoRuntimeWork = getMetricCounter(counters, 'storageUpdate.noRuntimeWork')
    const storageNoDurableWork = getMetricCounter(counters, 'storageUpdate.noDurableWork')
    const storageTimeoutGet = getMetricCounter(counters, 'storageUpdate.timeout.duringStorageGet')
    const storageTimeoutSet = getMetricCounter(counters, 'storageUpdate.timeout.duringStorageSet')
    const storageTimeoutUnknown = getMetricCounter(counters, 'storageUpdate.timeout.unknown')
    const storageQueueStallWarnings = getMetricCounter(counters, 'storageUpdate.queueStallWarning')
    const storageQueueStallMaxWaitMs = getMetricCounter(counters, 'storageUpdate.queueStallMaxWaitMs')
    const milestoneReceived = getMetricCounter(counters, 'milestone.received')
    const milestoneFlushes = getMetricCounter(counters, 'milestone.flushPerformed')
    const progressReceived = getMetricCounter(counters, 'progress.recordReceived')
    const progressPendingMax = getMetricCounter(counters, 'progress.pendingMax')
    const progressPendingMaxTrend = previousProgressPendingMax === null ? null
        : progressPendingMax > previousProgressPendingMax ? 'up'
        : progressPendingMax < previousProgressPendingMax ? 'down' : null
    previousProgressPendingMax = progressPendingMax
    const payloadBytes = getMetricCounter(counters, 'storagePayload.write.total.bytes')
    const payloadCalls = getMetricCounter(counters, 'storagePayload.write.total.calls')
    const payloadQueueBytes = getMetricCounter(counters, 'storagePayload.write.queue.bytes')
    const payloadRunsBytes = getMetricCounter(counters, 'storagePayload.write.runs.bytes')
    const payloadProgressBytes = getMetricCounter(counters, 'storagePayload.write.progress.bytes')
    const payloadQueueViewBytes = getMetricCounter(counters, 'storagePayload.write.queueView.bytes')
    const payloadMaxBytes = getMetricCounter(counters, 'storagePayload.write.total.maxBytes')
    // Physical writes: the bytes that reached storage after the bucket split. The card below reads these; the logical counters above are kept for comparison.
    const physicalBytes = getMetricCounter(counters, 'storagePhysical.write.total.bytes')
    const physicalCalls = getMetricCounter(counters, 'storagePhysical.write.total.calls')
    const physicalMaxBytes = getMetricCounter(counters, 'storagePhysical.write.total.maxBytes')
    const queueViewWriteCalls = getMetricCounter(counters, 'storagePayload.write.queueView.latencyCalls')
    const queueViewWriteLatencyMsSum = getMetricCounter(counters, 'storagePayload.write.queueView.latencyMsSum')
    const queueViewWriteMaxLatencyMs = getMetricCounter(counters, 'storagePayload.write.queueView.maxLatencyMs')
    const readBytes = getMetricCounter(counters, 'storagePayload.read.total.bytes')
    const readCalls = getMetricCounter(counters, 'storagePayload.read.total.calls')
    const readQueueBytes = getMetricCounter(counters, 'storagePayload.read.queue.bytes')
    const readQueueViewBytes = getMetricCounter(counters, 'storagePayload.read.queueView.bytes')
    const readProgressBytes = getMetricCounter(counters, 'storagePayload.read.progress.bytes')
    const readMaxBytes = getMetricCounter(counters, 'storagePayload.read.total.maxBytes')
    const topReadPath = getTopStoragePayloadPath(counters, 'read')
    const topWritePath = getTopStoragePayloadPath(counters, 'write')
    const cloudflareChallenges = getMetricCounter(counters, 'cloudflareChallenge.detected')
    // 2026-09-27: instrumentation for the queued-row self-healing check
    // (a queued row whose durable progress record already shows terminal,
    // settled back in runCoordinatorExecutorApplyPhase's per-tick loop) --
    // added to measure how often it actually fires before deciding whether
    // it's worth moving off the hot per-tick loop onto a slower periodic
    // sweep. matched = condition true this tick; settled = matched AND the
    // authority write actually landed.
    const queuedTerminalProgressMatched = getMetricCounter(counters, 'queuedTerminalProgressSettlement.matched')
    const queuedTerminalProgressSettled = getMetricCounter(counters, 'changed.terminalizedQueuedFromTerminalProgress')
    const duplicatePumps = getMetricCounter(counters, 'pump.noop.noPendingItems') +
        getMetricCounter(counters, 'pump.noop.executorAlreadyRunning') +
        getMetricCounter(counters, 'pump.noop.paused')
    const wakeups = nudgeSent + pumpRequested + reconcileRequested
    // Cache-hit vs genuine-read split for the segmented WAL's resident-store
    // cache (this week's fix chain: a dead cache meant every hydrate was a
    // real storage read). residentStoreUsed should dominate once the queue
    // is warm; segmentedHydrated is a true chrome.storage.local read.
    const walResidentStoreUsed = getMetricCounter(counters, 'coordinatorAuthority.queueWal.residentStoreUsed')
    const walSegmentedHydrated = getMetricCounter(counters, 'coordinatorAuthority.queueWal.segmentedHydrated')
    const walCacheAttempts = walResidentStoreUsed + walSegmentedHydrated
    const storageGetCalls = getMetricCounter(counters, 'storageGetCalls')
    // WAL append/checkpoint-switch frequency (same fix chain: a checkpoint
    // switch folds the WAL's accumulated segments back into a single
    // snapshot). Checkpoint switches are triggered once committed segments
    // reach COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT (128); the hard
    // limit that blocks further appends until one succeeds is
    // COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT (1024).
    const walAppended = getMetricCounter(counters, 'coordinatorAuthority.queueWal.appended')
    const walAppendBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.appendBytes')
    const walCheckpointed = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointed')
    const walCheckpointedRecords = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointedRecords')
    const walCheckpointFailed = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointFailed')
    // Physical WAL segment writes and checkpoint-switch writes are tracked
    // separately from the logical appended/checkpointed counters above --
    // these are actual chrome.storage.local.set byte sizes for the WAL's
    // on-disk representation, recorded by
    // recordCoordinatorQueueWalPhysicalPayloadMetrics but never surfaced
    // on the dashboard before now.
    const walSegmentWrites = getMetricCounter(counters, 'coordinatorAuthority.queueWal.physicalSegmentWrites')
    const walSegmentBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.physicalSegmentBytes')
    const walSegmentMaxBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.maxPhysicalSegmentBytes')
    const walCheckpointWrites = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointWrites')
    const walCheckpointBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.checkpointBytes')
    const walCheckpointMaxBytes = getMetricCounter(counters, 'coordinatorAuthority.queueWal.maxCheckpointBytes')
    // The durable queue-view snapshot (mbCoordinatorQueueView -- what the
    // dashboard/popup/CDP tools actually read) is written by a SEPARATE,
    // non-atomic storage.set from the WAL append it is supposed to mirror.
    // It can fail independently under load with no guaranteed catch-up
    // deadline (see queue-wal-segmented-record-followup-2026-05-27.md's
    // 2026-09-17 entry) -- projectionSaved/projectionFailed are the only
    // signal that divergence is happening, so surface them directly rather
    // than leaving them buried in raw counters.
    const viewProjectionSaved = getMetricCounter(counters, 'coordinatorAuthority.queueWal.projectionSaved')
    const viewProjectionFailed = getMetricCounter(counters, 'coordinatorAuthority.queueWal.projectionFailed')
    const stalledQueued = queueItems.filter(item => `${item?.status || ''}` === 'queued').length

    const epochReason = metrics.resetReason ? `, ${metrics.resetReason}` : ''
    const epochStarted = metrics.startedAt ? `Epoch ${formatTime(metrics.startedAt)}${epochReason}` : 'No metrics yet'
    setText('metricsUpdated', metrics.updatedAt ? `${epochStarted}; updated ${formatTime(metrics.updatedAt)}` : epochStarted)

    if(metricsGrid) {
        replaceChildren(metricsGrid, [
            buildMetricCard('Current epoch', metrics.resetReason || '--', `${metrics.epochId || ''}`, {
                title: 'Why the current metrics epoch was reset (extension reload, browser restart, manual reset). Not itself a health signal -- just labels which stretch of history the cards below cover.'
            }),
            buildMetricCard('Previous epochs', `${previousEpochs.length}`, formatPreviousEpochSummary(previousEpochs[previousEpochs.length - 1]), {
                title: 'How many prior metrics epochs are retained, and a summary of the most recent one. Concerning only if the prior epoch shows a much worse timeout rate or write volume than the current one -- otherwise this is just history.'
            }),
            buildMetricCard('Queue throttle', throttle.active ? 'active' : 'idle', throttle.active
                ? `level ${throttle.level}; retry ${formatDuration(throttle.until - Date.now())}; ${throttle.reason || ''}`
                : throttle.lastProgressAt ? `recovered ${formatTime(throttle.lastProgressAt)}` : 'No page-load throttle active', {
                alert: throttle.active && throttle.level >= 2,
                title: 'Whether the scheduler is deliberately backing off queued-tab activity (e.g. after slow/unscriptable tabs or Cloudflare challenges). Concerning if this stays "active" for more than a couple of QUEUE_LOAD_THROTTLE_MAX_MS windows (120s each, escalating) -- that means whatever tripped it keeps recurring rather than clearing.'
            }),
            buildMetricCard('Wakeups/job', jobs ? formatRatio(wakeups / jobs) : '--', `${wakeups} wakeups / ${jobs} enqueued`, {
                alert: jobs > 0 && (wakeups / jobs) > 3,
                title: 'Nudges + pump requests + reconciles per enqueued job -- how many scheduler wakeups it takes to move work through the queue. Concerning if this trends well above 2-3x enqueued jobs; that suggests the scheduler is being woken repeatedly without making proportional progress.'
            }),
            buildMetricCard('Nudge accept', nudgeDispatched ? formatPercent(nudgeAccepted / nudgeDispatched) : '--', `${nudgeAccepted} / ${nudgeDispatched} dispatched (${nudgeCoalesced} coalesced, not counted)`, {
                // 2026-09-29: traced live -- essentially every rejected nudge
                // is a tab/row that already resolved through a different path
                // (closed, or the durable row moved on) by the time the nudge
                // landed, not a stuck/unresponsive tab. A low percentage here
                // is normal queue churn, not a signal of trouble, so this no
                // longer alerts. nudge.failed.message (a tab that responded
                // but errored) is the actual thing worth watching.
                title: 'Share of claim nudges that actually reached a tab (excludes ones the coalesce cooldown skipped before sending) that got accepted. Usually well under 100% even when healthy -- a rejected nudge almost always means the tab or row already resolved through a different path before the nudge arrived, not that something is wrong. Watch nudge.failed.message instead for a tab that responded but errored.'
            }),
            buildMetricCard('Pump yield', pumpRequested ? formatPercent(pumpChanged / pumpRequested) : '--', `${pumpChanged} changed / ${pumpRequested}`, {
                alert: pumpRequested > 0 && stalledQueued > 0 && (pumpChanged / pumpRequested) < 0.3,
                title: 'Share of executor pump cycles that actually changed something. Concerning if this stays low (lots of no-op pumps) while Queued > 0 -- see Duplicate pumps below for the specific no-op reasons.'
            }),
            buildMetricCard('Duplicate pumps', pumpRequested ? formatPercent(duplicatePumps / pumpRequested) : '--', `${duplicatePumps} no-op`, {
                alert: !state.paused && pumpRequested > 0 && (duplicatePumps / pumpRequested) > 0.7 && (pumpChanged / pumpRequested) < 0.3,
                title: 'Pump cycles that no-opped because there was nothing pending, the executor was already running, or the queue is paused. Concerning if this is high AND Pump yield is low AND the queue is not paused -- that combination means pumps are being requested faster than there is new work to justify them.'
            }),
            buildMetricCard('Reconciles/job', jobs ? formatRatio(reconcileRequested / jobs) : '--', `${reconcileChanged} reconcile changes`, {
                title: 'Reconcile passes (the periodic sweep that repairs drifted/stuck rows) per enqueued job. Concerning if this climbs steadily -- COORDINATOR_RECONCILE_BACKOFF_MAX_MS (60s) is the ceiling between reconciles once backed off, so a high rate here means something keeps re-triggering reconcile at its minimum interval instead of backing off.'
            }),
            buildMetricCard('Terminal jobs', `${terminalJobs}`, `${stalledQueued} currently queued`, {
                title: 'Total jobs that reached a terminal state (succeeded/failed/skipped/canceled) this epoch, plus how many are still queued right now. Not concerning on its own -- cross-check against Really/Already blocked and the failed-row badges for what those terminal jobs actually were.'
            }),
            buildMetricCard('Queued self-heal', `${queuedTerminalProgressMatched}`, `${queuedTerminalProgressSettled} settled`, {
                title: 'How often a queued row\'s own durable progress record already showed terminal (the row\'s live queue status just hadn\'t caught up yet), checked on every executor-apply tick. Purely observational for now -- this decides whether it\'s worth moving off the hot per-tick loop onto a slower periodic sweep instead. A near-zero count here means that move would buy little; a high, steadily climbing count means it would.'
            }),
            buildMetricCard('Cloudflare challenges', `${cloudflareChallenges}`, jobs
                ? `${formatPercent(cloudflareChallenges / jobs)} of ${jobs} enqueued jobs hit a bot-challenge interstitial`
                : 'No challenge interstitials seen yet', {
                alert: cloudflareChallenges > 1,
                title: 'Profile loads that hit a Cloudflare bot-challenge interstitial instead of the real page. Concerning at any sustained rate above isolated one-offs -- each one also trips the queue-load throttle, so a rising count here explains a queue that keeps backing off.'
            }),
            buildLiveChecksCard(counters),
            buildMetricCard('Claim -> action', formatPhaseAverage(phases.claimAcceptedToActionStart), formatPhaseDetail(phases.claimAcceptedToActionStart), {
                // Half of STALE_ACTIVE_ACTION_QUEUED_TAB_MS (30s).
                alert: getPhaseAverageMs(phases.claimAcceptedToActionStart) >= 15000,
                title: 'Time from claim accepted to the mute/block action actually starting. Concerning if the average approaches STALE_ACTIVE_ACTION_QUEUED_TAB_MS (30s) -- that\'s this project\'s threshold for treating an active-action tab as stalled.'
            }),
            buildMetricCard('Action -> terminal', formatPhaseAverage(phases.actionStartToTerminal), formatPhaseDetail(phases.actionStartToTerminal), {
                // Half of the tighter of COORDINATOR_ACTIVE_JOB_MAX_MS (45s) / COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS (60s).
                alert: getPhaseAverageMs(phases.actionStartToTerminal) >= 22500,
                title: 'Time from the action starting to the row reaching a terminal state. Concerning if the average approaches COORDINATOR_ACTIVE_JOB_MAX_MS (45s) or COORDINATOR_ACTIVE_ACTION_JOB_MAX_MS (60s) -- both bound how long this project lets a job stay active before treating it as stuck.'
            }),
            buildMetricCard('Terminal -> release', formatPhaseAverage(phases.terminalToSlotRelease), formatPhaseDetail(phases.terminalToSlotRelease), {
                // Half of TERMINAL_PROGRESS_SETTLEMENT_DEFER_MS (2.5s).
                alert: getPhaseAverageMs(phases.terminalToSlotRelease) >= 1250,
                title: 'Time from a row going terminal to its worker slot actually being released for reuse. Concerning if the average approaches TERMINAL_PROGRESS_SETTLEMENT_DEFER_MS (2.5s) -- slow releases here are the direct cause of a rising "secs / handoff" summary tile above.'
            }),
            buildMetricCard('Storage timeouts', storageStarted ? formatPercent(storageTimedOut / storageStarted) : `${storageTimedOut}`, `${storageTimedOut} / ${storageStarted}; ${storageFallbackReturned} fallback returned`, {
                alert: storageTimedOut > 0,
                title: 'Share of durable storage updates that timed out before completing. Concerning at any sustained nonzero rate -- a timed-out update falls back to a stale read/no-op rather than the intended mutation, which is exactly the class of bug behind this week\'s WAL hydrate fixes.'
            }),
            buildMetricCard('Storage deadlines', storageStarted ? formatPercent(storageDeadlineMissed / storageStarted) : `${storageDeadlineMissed}`, `${storageDeadlineMissed} missed; ${getMetricCounter(counters, 'storageUpdate.lateWriteSuppressed')} late suppressed`, {
                alert: storageDeadlineMissed > 0,
                title: 'Storage updates that missed their intended deadline (whether or not they eventually timed out outright). Concerning if this is nonzero and growing -- it is an early symptom of the same write-queue backlog the "Write queue backlog" card below alerts on directly.'
            }),
            buildMetricCard('Write queue backlog', storageQueueStallWarnings ? `${storageQueueStallWarnings} alert${storageQueueStallWarnings === 1 ? '' : 's'}` : 'clear',
                storageQueueStallWarnings
                    ? `Oldest pending write waited up to ${formatDuration(storageQueueStallMaxWaitMs)} this epoch`
                    : 'No sustained storage-update backlog this epoch',
                {
                    alert: storageQueueStallWarnings > 0,
                    title: 'Fires once the oldest pending durable write has waited at least COORDINATOR_STORAGE_UPDATE_QUEUE_STALL_WARN_MS (30s), checked every COORDINATOR_STORAGE_UPDATE_QUEUE_STALL_CHECK_INTERVAL_MS (15s). Any alert here is concerning by definition -- it is this project\'s own self-imposed threshold for "the serialized storage-update queue is backing up," added after a live incident where a runaway reconcile loop backed it up for minutes.'
                }),
            buildMetricCard('Timeout buckets', `${storageTimeoutGet}`, `get ${storageTimeoutGet}, set ${storageTimeoutSet}, unknown ${storageTimeoutUnknown}`, {
                alert: (storageTimeoutGet + storageTimeoutSet + storageTimeoutUnknown) > 0 &&
                    storageTimeoutUnknown / (storageTimeoutGet + storageTimeoutSet + storageTimeoutUnknown) > 0.5,
                title: 'Breaks Storage timeouts down by where in the read/write cycle they happened. Concerning if "unknown" is a large share -- that means a timeout is happening somewhere this breakdown can\'t attribute, which is itself worth investigating.'
            }),
            buildMetricCard('No-work writes', `${storageNoDurableWork}`, `${storageNoRuntimeWork} no runtime; ${storageNoDurableWork} no durable`, {
                // 2026-09-27: a paused queue (or one with nothing pending)
                // legitimately racks up "no durable work" cycles just from
                // periodic polling and reconcile ticks -- that's expected,
                // not a problem, and lighting this up red while paused was
                // actively misleading (confirmed live: a several-hour idle
                // stretch with the dashboard open drove this to a high
                // ratio on its own, via the dashboard poll fixed above).
                // Only alert when the queue is actually supposed to be
                // busy.
                alert: !state.paused && storageStarted > 0 && (storageNoDurableWork / storageStarted) > 0.5,
                title: 'Storage updates that ran and found nothing durable to persist. Expect a high share of these whenever the queue is paused or has nothing pending -- that alone drives this up with no problem behind it. Concerning only while the queue is actually running and this still dominates total storage updates, since each one still pays the full serialized-queue cost for no benefit.'
            }),
            buildMetricCard('Storage queue wait', formatPhaseAverage(phases.storageQueueWait), formatPhaseDetail(phases.storageQueueWait), {
                // Half of COORDINATOR_STORAGE_UPDATE_QUEUE_STALL_WARN_MS (30s).
                alert: getPhaseAverageMs(phases.storageQueueWait) >= 15000,
                title: 'Average time a storage update spent waiting in the serialized queue before it got to run. Concerning if this rises toward COORDINATOR_STORAGE_UPDATE_QUEUE_STALL_WARN_MS (30s) -- that\'s the same threshold "Write queue backlog" alerts on for the single oldest pending write.'
            }),
            buildMetricCard('Storage get', formatPhaseAverage(phases.storageGet), `${storageGetCalls} calls`, {
                title: 'Average latency of a chrome.storage.local.get call, and how many were made this epoch. Concerning if the call count keeps climbing well past startup with the queue otherwise idle -- see the Queue cache hit rate card, which answers exactly that "are we still re-reading needlessly" question directly.'
            }),
            buildMetricCard('Storage set', formatPhaseAverage(phases.storageSet), `${getMetricCounter(counters, 'storageSetCalls')} calls`, {
                title: 'Average latency of a chrome.storage.local.set call, and how many were made this epoch. Concerning if the average latency climbs alongside growing write payload sizes (see Payload avg) -- that\'s consistent with the queue snapshot itself getting large enough to slow every write.'
            }),
            buildMetricCard('Queue cache hit rate', walCacheAttempts ? formatPercent(walResidentStoreUsed / walCacheAttempts) : '--',
                `${walResidentStoreUsed} resident-store hits / ${walSegmentedHydrated} genuine storage reads (${storageGetCalls} storage.get calls total)`, {
                alert: walCacheAttempts > 5 && (walResidentStoreUsed / walCacheAttempts) < 0.5,
                title: 'Of the segmented WAL\'s hydrate attempts, the share served from the in-memory resident-store cache (residentStoreUsed) rather than a real chrome.storage.local read (segmentedHydrated). This week\'s fix chain found this cache dead (residentStoreUsed sat at 0) -- concerning if this rate is low or falling after startup, since reads should be rare once the queue is warm and resident.'
            }),
            buildMetricCard('WAL writes', `${walAppended}`,
                `${formatBytes(walAppendBytes)} appended; ${walCheckpointed} checkpoint switch${walCheckpointed === 1 ? '' : 'es'} folding in ${walCheckpointedRecords} record${walCheckpointedRecords === 1 ? '' : 's'}${walCheckpointFailed ? `; ${walCheckpointFailed} checkpoint failure${walCheckpointFailed === 1 ? '' : 's'}` : ''}`, {
                alert: walCheckpointFailed > 0,
                title: 'How often the coordinator queue\'s write-ahead log is appended to, and how often it checkpoint-switches (folds accumulated segments back into one snapshot). A checkpoint switch is expected roughly every COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT (128) committed segments; concerning if switches are far less frequent than that under heavy write volume (segments piling up toward the COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT of 1024, which blocks further appends) or if any checkpoint failures show up at all.'
            }),
            buildMetricCard('WAL segment writes', `${walSegmentWrites}`,
                `${formatBytes(walSegmentBytes)} written; max ${formatBytes(walSegmentMaxBytes)}`, {
                title: 'Physical chrome.storage.local writes to WAL segment keys (mbCoordinatorQueueWal.segment.*) -- the incremental append-side storage cost, separate from the logical "WAL writes" append count above. Concerning if the per-write size trends upward over a session; segments should stay small individually until a checkpoint switch folds them back down.'
            }),
            buildMetricCard('Checkpoint writes', `${walCheckpointWrites}`,
                `${formatBytes(walCheckpointBytes)} written; max ${formatBytes(walCheckpointMaxBytes)}`, {
                title: 'Physical chrome.storage.local writes for a checkpoint switch (folding accumulated segments back into one snapshot) -- the actual byte cost of that fold, separate from the "WAL writes" card\'s checkpoint switch count. Concerning if this grows large enough to make Storage set latency spike during a switch, since a checkpoint write blocks the same serialized write queue as everything else.'
            }),
            buildMetricCard('Queue view writes', `${viewProjectionSaved}`,
                `${formatBytes(payloadQueueViewBytes)} written; avg ${queueViewWriteCalls ? formatDuration(queueViewWriteLatencyMsSum / queueViewWriteCalls) : '--'}, max ${formatDuration(queueViewWriteMaxLatencyMs)}; ${viewProjectionFailed} failure${viewProjectionFailed === 1 ? '' : 's'} this epoch`, {
                alert: viewProjectionFailed > 0,
                // 2026-09-30: this write no longer blocks the WAL append or
                // executor-apply call that asked for it -- it's fired
                // off-critical-path and only its own completion is timed
                // here, so "avg"/"max" reflect the write's own cost, not
                // added latency on whatever triggered it.
                title: 'The durable mbCoordinatorQueueView snapshot -- what the dashboard, worker bar, popup, and CDP tools actually read -- is written by a separate, non-blocking storage.set from the WAL append it mirrors, and can fail independently under load. Any failure here means the view can show stale status (e.g. "queued") for a row the WAL already has as terminal, with only a best-effort reconcile as catch-up and no guaranteed deadline. Concerning if failures are ever nonzero, or if avg/max latency climbs -- this write is not on any other operation\'s critical path, but it still competes for the same serialized storage queue.'
            }),
            buildMetricCard('Read payload avg', readCalls ? formatBytes(readBytes / readCalls) : '--', `${formatBytes(readBytes)} total; max ${formatBytes(readMaxBytes)}`, {
                title: 'Average and largest single-read payload size across all storage reads this epoch. Concerning if this grows steadily over a long-running session -- it usually tracks queue/progress size, and a large max next to a much smaller average flags one unusually expensive read worth finding via Read hot path.'
            }),
            buildMetricCard('Read payload keys', formatBytes(readQueueBytes), `queue ${formatBytes(readQueueBytes)}, view ${formatBytes(readQueueViewBytes)}, progress ${formatBytes(readProgressBytes)}`, {
                title: 'Read bytes broken down by which storage key they came from. Concerning if "queue" (the raw authoritative queue, as opposed to the cheaper "view" projection) dominates read volume long after startup -- that\'s a sign something is bypassing the queue-view/resident-cache path and reading the full queue directly.'
            }),
            buildMetricCard('Read hot path', topReadPath.path || '--', formatStoragePayloadPathDetail(topReadPath), {
                title: 'Which named code path (metricPath, e.g. "reconcile.load") is responsible for the most read bytes this epoch. Concerning if a path you would not expect to read often (anything outside startup/reconcile) shows up here with a high call count -- that usually means a cache that should be short-circuiting it is not.'
            }),
            buildMetricCard('Write payload avg', physicalCalls ? formatBytes(physicalBytes / physicalCalls) : '--', `${formatBytes(physicalBytes)} on disk over ${physicalCalls} writes; max ${formatBytes(physicalMaxBytes)}. Logical payload avg ${payloadCalls ? formatBytes(payloadBytes / payloadCalls) : '--'} (${formatBytes(payloadBytes)} before the bucket split)`, {
                title: 'Average and largest size of each write that reached storage this epoch, after the bucket split. The logical figure is what the callers built before the split (a whole map), kept for comparison. Concerning if the physical average trends upward over a long session.'
            }),
            buildMetricCard('Payload sources', formatBytes(payloadQueueBytes), `queue ${formatBytes(payloadQueueBytes)}, view ${formatBytes(payloadQueueViewBytes)}, runs ${formatBytes(payloadRunsBytes)}, progress ${formatBytes(payloadProgressBytes)}`, {
                title: 'Write bytes broken down by which storage key they went to. Not concerning by itself -- "queue" naturally dominates on a large batch -- but useful alongside Write hot path to see which code path is driving that volume.'
            }),
            buildMetricCard('Write hot path', topWritePath.path || '--', formatStoragePayloadPathDetail(topWritePath), {
                title: 'Which named code path is responsible for the most write bytes this epoch -- the write-side equivalent of Read hot path. Concerning if a path outside normal enqueue/reconcile/terminal-settlement activity dominates, or if its average latency (shown in the detail line) is high relative to its byte size.'
            }),
            buildMetricCard('Milestone batch', milestoneFlushes ? formatRatio(milestoneReceived / milestoneFlushes) : '--', `${milestoneReceived} records / ${milestoneFlushes} flushes`, {
                title: 'How many milestone records get batched into each flush (flushed at most once every COORDINATOR_JOB_MILESTONE_FLUSH_MS, 3s). Concerning only if flushes are happening far more often than every 3s with a low records-per-flush ratio -- that would mean batching isn\'t actually coalescing anything.'
            }),
            buildMetricCard('Progress events', `${progressReceived}`, `pending max ${progressPendingMax}`, {
                trend: progressPendingMaxTrend,
                title: 'The big number is a running total of profile-progress records received this epoch -- it only ever increases until the epoch resets, so it climbing on its own is normal, not a backlog. "pending max" (detail line) is the actual backlog signal: the largest number of received-but-not-yet-applied progress records seen at once. Concerning if pending max stays elevated rather than draining back toward zero -- that means progress records are arriving faster than they\'re being applied. Card colors red when pending max grows since the last refresh, green when it falls.'
            })
        ], state.loading ? 'Loading history...' : 'No wakeup metrics yet.')
    }

    if(journal) {
        const recentEntries = [...entries].sort((left, right) => getTime(right) - getTime(left)).slice(0, 30)
        setText('metricsJournalCount', `${recentEntries.length} ${recentEntries.length === 1 ? 'entry' : 'entries'}`)
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

// Live-run checks (owner, 15 Oct), counted since the last metrics reset. The value is how many resolutions the keyword scan of a
// page decided, out of all resolutions. The scan is the one resolver step that guesses from the page, so any count needs a look.
function buildLiveChecksCard(counters = {}) {
    const resolvedBy = {
        header: getMetricCounter(counters, 'liveCheck.resolvedBy.header'),
        inline: getMetricCounter(counters, 'liveCheck.resolvedBy.inline'),
        scored: getMetricCounter(counters, 'liveCheck.resolvedBy.scored'),
        explicit: getMetricCounter(counters, 'liveCheck.resolvedBy.explicit'),
        listed: getMetricCounter(counters, 'liveCheck.resolvedBy.listed'),
        url: getMetricCounter(counters, 'liveCheck.resolvedBy.url')
    }
    const resolved = sumMetricCounters(counters, 'liveCheck.resolvedBy.')
    const didNotLand = getMetricCounter(counters, 'liveCheck.didNotLand')
    const redirectMismatch = getMetricCounter(counters, 'job.profileRedirectMismatch')
    const shadowChanged = getMetricCounter(counters, 'suffixShadow.changed')
    const supersessions = sumMetricCounters(counters, 'pump.executorStartSuperseded.')
    const claimRetries = sumMetricCounters(counters, 'contentClaimRetry.')
    const detail = [
        `resolved: header ${resolvedBy.header}, inline ${resolvedBy.inline}, explicit ${resolvedBy.explicit}, listed ${resolvedBy.listed}, url ${resolvedBy.url}`,
        `did not land ${didNotLand}, redirect mismatch ${redirectMismatch}`,
        `suffix shadow ${shadowChanged}, supersessions ${supersessions}, claim retries ${claimRetries}`
    ].join(' • ')
    return buildMetricCard('Live checks', `${resolvedBy.scored} of ${resolved}`, detail, {
        alert: resolvedBy.scored > 0,
        title: 'Live-run checks since the last metrics reset. The value is resolutions decided by the keyword scan of a page ("scored") out of all resolutions. The scan is the only resolver step that guesses from the page, so any count needs a look. Did not land: a queued tab that never reached a profile page (not retried). Redirect mismatch: a queued link that landed on another profile and was ended. Suffix shadow: links the old suffix rule would have cut (counted, not changed). Supersessions: executor starts superseded by a newer one. Claim retries: content claim loops that reached their threshold.'
    })
}

function buildMetricCard(label = '', value = '', detail = '', options = {}) {
    const card = document.createElement('div')
    const cardClasses = ['metric-card']
    if(options.alert) {
        cardClasses.push('metric-card--alert')
    } else if(options.trend === 'up') {
        cardClasses.push('metric-card--trend-up')
    } else if(options.trend === 'down') {
        cardClasses.push('metric-card--trend-down')
    }
    card.className = cardClasses.join(' ')
    // options.title carries a fuller explanation (what this measures, plus
    // a rough "this is concerning if..." threshold) than the one-line
    // detail text has room for. Falls back to detail alone when a card
    // hasn't been given one yet, same as before this option existed.
    const fullTitle = options.title || detail
    card.title = fullTitle

    const labelNode = document.createElement('div')
    labelNode.className = 'metric-label'
    labelNode.textContent = label

    const valueNode = document.createElement('div')
    valueNode.className = 'metric-value'
    valueNode.textContent = value

    const detailNode = document.createElement('div')
    detailNode.className = 'metric-detail'
    detailNode.textContent = detail
    detailNode.title = fullTitle

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

function getPhaseAverageMs(phase = null) {
    if(!phase?.count) return 0
    return (Number(phase.totalMs) || 0) / phase.count
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
            buildBadge(item.status || 'unknown', `${item.status || ''}`.trim() === 'failed' ? (item.error || item.outcome || '') : ''),
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

function clearEventHistogram() {
    eventHistogramClearedAtMs = Date.now()
    renderEventHistogram()
}

// The worker owns the list (sw.js, resetCoordinatorOutliers). Clear dismisses every listed attempt there, so the list does not come back
// on the next refresh or after a reload.
async function clearOutliers() {
    try {
        const result = await sendRuntimeMessageWithTimeout({action: 'clear-coordinator-outliers'}, null, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS)
        if(Array.isArray(result?.outliers)) state.outliers = result.outliers
    }
    catch(error) {
        console.warn('Failed to clear outliers', error)
    }
    renderOutliers()
}

function renderOutliers() {
    const container = document.getElementById('outlierList')
    const countLabel = document.getElementById('outlierCount')
    if(countLabel) {
        countLabel.textContent = `${state.outliers.length} outlier${state.outliers.length === 1 ? '' : 's'}`
    }
    if(!container) return

    const sortedOutliers = [...state.outliers].sort((left, right) => right.durationMs - left.durationMs)
    replaceChildren(container, sortedOutliers.map(outlier => {
        const profileLabel = outlier.targetUrl ? getProfileLabelFromHref(outlier.targetUrl) : outlier.rowKey
        const row = document.createElement('div')
        row.className = 'row row--event'
        row.append(
            buildTitleCell(profileLabel || outlier.rowKey, outlier.runId, {
                titleHref: normalizeExternalHref(outlier.targetUrl)
            }),
            buildBadge(outlier.final ? (outlier.status || 'unknown') : 'active'),
            buildTextCell(
                `${formatDuration(outlier.durationMs)} (${outlier.thresholdReason})`,
                `mean ${formatDuration(outlier.meanDurationMsAtCapture)}, stddev ${formatDuration(outlier.stdDevMsAtCapture)} at capture`
            ),
            buildTextCell(formatDateTime(outlier.capturedAt))
        )
        return row
    }), 'No outliers.')
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

    const itemStatus = `${item?.status || ''}`
    if(itemStatus !== 'failed' && itemStatus !== 'canceled') return cell

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'clear-button row-action-button'
    button.textContent = 'Requeue'
    button.title = `Reset and requeue this ${itemStatus} Current Work item`
    button.addEventListener('click', event => {
        event.preventDefault()
        button.disabled = true
        void requeueFailedItem(item)
    })
    cell.appendChild(button)
    return cell
}

function compareCurrentWorkItems(left = {}, right = {}) {
    const rankDiff = getCurrentWorkSortRank(left) - getCurrentWorkSortRank(right)
    if(rankDiff) return rankDiff

    const leftHref = () => `${getQueueItemHref('', left) || left?.storageKey || left?.id || ''}`
    const rightHref = () => `${getQueueItemHref('', right) || right?.storageKey || right?.id || ''}`

    // 2026-09-16: 'queued' rows used to break ties by time descending, same
    // as every other rank -- but that puts the most-recently-added row at
    // the top and the row nearest the front of the real dispatch line at
    // the bottom, backwards from what "what's about to become active" is
    // supposed to show. The real executor's base traversal order
    // (queueRuntime.rebuildQueueOrder, before its own backoff/fairness/
    // concurrency filtering) walks queued rows by queueSequence ascending,
    // so this sorts the same way. See the matching fix in
    // swCoordinatorQueueView.js's buildCoordinatorQueueView, which this
    // client-side re-sort otherwise clobbers every render.
    if(getCurrentWorkSortRank(left) === 1) {
        return (Number.parseInt(left?.queueSequence, 10) || 0) - (Number.parseInt(right?.queueSequence, 10) || 0) ||
            getTime(left) - getTime(right) ||
            leftHref().localeCompare(rightHref())
    }

    return getTime(right) - getTime(left) ||
        leftHref().localeCompare(rightHref())
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

    const enqueueBreakdown = formatCoordinatorEnqueueBreakdown({
        requested: run.enqueueRequested,
        queued: run.enqueueQueued,
        merged: run.enqueueMerged,
        preFilter: run.enqueuePreFilter
    })

    return {
        title: getRunSourceLabel(run),
        subtitle: [submittedLabel, enqueueBreakdown].filter(Boolean).join(' • '),
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

function buildBadge(value, detail = '') {
    const badge = document.createElement('span')
    const normalized = `${value || 'unknown'}`.toLowerCase()
    badge.className = `badge badge--${normalized.replace(/[^a-z0-9_-]/g, '-')}`
    badge.textContent = normalized
    const trimmedDetail = `${detail || ''}`.trim()
    badge.title = trimmedDetail ? `${getStatusHelp(normalized)} ${trimmedDetail}` : getStatusHelp(normalized)
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
        running: 'Running: the run has queued or in-progress items.',
        empty: 'Empty: every target in the run has reached a terminal state, or the run has no items.',
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

function renderScanCostHistogram() {
    const container = document.getElementById('scanCostHistogram')
    if(!container) return

    const metricsDocument = state.metrics || {}
    const counters = (metricsDocument.currentEpoch || metricsDocument).counters || {}

    // Find all scan.<location>.items counters and extract location names
    const scanData = []
    const locationSet = new Set()

    Object.keys(counters).forEach(key => {
        const match = key.match(/^scan\.([^.]+)\.items$/)
        if(match) {
            const location = match[1]
            locationSet.add(location)
        }
    })

    // Build data for each location
    locationSet.forEach(location => {
        const itemsCount = getMetricCounter(counters, `scan.${location}.items`)
        const callsCount = getMetricCounter(counters, `scan.${location}.calls`)
        if(itemsCount > 0 || callsCount > 0) {
            scanData.push({
                label: location,
                value: itemsCount,
                detail: `${itemsCount} items / ${callsCount} calls`
            })
        }
    })

    scanData.sort((a, b) => b.value - a.value)
    renderHorizontalHistogram(container, scanData)
}

function renderAuthorityLoadHistogram() {
    const container = document.getElementById('authorityLoadHistogram')
    if(!container) return

    const metricsDocument = state.metrics || {}
    const counters = (metricsDocument.currentEpoch || metricsDocument).counters || {}

    // authorityLoad.<verb>.<from>.calls -- calls of interest to the
    // coordinator-authority-state accessors, not flight-recorder events.
    const authorityLoadData = []
    Object.keys(counters).forEach(key => {
        const match = key.match(/^authorityLoad\.([^.]+)\.(.+)\.calls$/)
        if(!match) return
        const [, verb, from] = match
        const callsCount = getMetricCounter(counters, key)
        if(callsCount <= 0) return
        authorityLoadData.push({
            label: `${verb}: ${from}`,
            value: callsCount,
            detail: `${callsCount} call${callsCount === 1 ? '' : 's'}`
        })
    })

    authorityLoadData.sort((a, b) => b.value - a.value)
    renderHorizontalHistogram(container, authorityLoadData)
}

function renderEventHistogram() {
    const container = document.getElementById('eventHistogram')
    if(!container) return

    // Send message to get flight recorder entries
    sendRuntimeMessageWithTimeout({
        action: 'get-flight-recorder',
        limit: 2000
    }, {entries: []}, COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS)
        .then(response => {
            const entries = (response && Array.isArray(response.entries)) ? response.entries : []

            // Tally occurrences by kind:reason
            const eventCounts = {}
            entries.forEach(entry => {
                if(!entry || typeof entry !== 'object') return
                if((Number.parseInt(entry.at, 10) || 0) < eventHistogramClearedAtMs) return
                const label = `${entry.kind || 'unknown'}:${entry.reason || ''}`
                eventCounts[label] = (eventCounts[label] || 0) + 1
            })

            // Convert to array and sort by count descending
            const eventData = Object.entries(eventCounts)
                .map(([label, count]) => ({label, value: count, detail: `${count}`}))
                .sort((a, b) => b.value - a.value)

            renderHorizontalHistogram(container, eventData)
        })
        .catch(() => {
            // If message fails, render empty state
            renderHorizontalHistogram(container, [])
        })
}

// 2026-10-06: average time spent in each phase of a mute-block action's
// notice-select-open-load-inspect-action-detect-close cycle, sourced from
// profileAction.phase.<key>.totalMs/sampleCount (swCoordinatorProgressReducer.js's
// recordCoordinatorProfileActionPhaseDurations, computed from each terminal
// row's own milestone timestamps). 'Notice/select' is covered separately by
// secs/handoff -- this starts at 'open' (row goes active -> tab created).
const COORDINATOR_PROFILE_ACTION_PHASE_LABELS = [
    ['open', 'Open (active → tab created)'],
    ['navigate', 'Navigate (tab created → navigation started)'],
    ['load', 'Load (navigation → content script opened)'],
    ['claim', 'Claim (content opened → action claimed)'],
    ['inspect', 'Inspect (claimed → profile ready)'],
    ['action', 'Action (ready → mute/block attempted)'],
    ['detect', 'Detect (attempted → terminal)'],
    ['close', 'Close (terminal → tab closed)']
]

function formatPhaseTimingDurationMs(value) {
    if(!Number.isFinite(value)) return 'n/a'
    if(value < 1000) return `${Math.round(value)}ms`
    return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`
}

function renderPhaseTimingHistogram() {
    const container = document.getElementById('phaseTimingHistogram')
    if(!container) return

    const metricsDocument = state.metrics || {}
    const metrics = metricsDocument.currentEpoch || metricsDocument
    const counters = metrics.counters || {}

    const data = COORDINATOR_PROFILE_ACTION_PHASE_LABELS.map(([key, label]) => {
        const sampleCount = getMetricCounter(counters, `profileAction.phase.${key}.sampleCount`)
        const totalMs = getMetricCounter(counters, `profileAction.phase.${key}.totalMs`)
        const maxMs = getMetricCounter(counters, `profileAction.phase.${key}.maxMs`)
        const avgMs = sampleCount ? totalMs / sampleCount : 0
        return {
            label,
            value: avgMs,
            detail: sampleCount
                ? `avg ${formatPhaseTimingDurationMs(avgMs)} (n=${sampleCount}, max ${formatPhaseTimingDurationMs(maxMs)})`
                : 'no samples yet'
        }
    }).filter(row => row.value > 0)

    renderHorizontalHistogram(container, data)
}

// Physical write sizes, smallest band first. The worker counts each successful write in one of these bands (swStorageMetrics).
const PHYSICAL_SIZE_BANDS = [
    ['lt1k', 'under 1 KB'], ['1k_4k', '1-4 KB'], ['4k_16k', '4-16 KB'], ['16k_64k', '16-64 KB'],
    ['64k_256k', '64-256 KB'], ['256k_1m', '256 KB-1 MB'], ['1m_4m', '1-4 MB'], ['ge4m', '4 MB and over']
]

function renderWriteSizeHistogram() {
    const container = document.getElementById('writeSizeHistogram')
    if(!container) return

    const metricsDocument = state.metrics || {}
    const counters = (metricsDocument.currentEpoch || metricsDocument).counters || {}

    // Not sorted: the bands are already in size order, and the bars show how the writes spread across them.
    const data = PHYSICAL_SIZE_BANDS.map(([band, label]) => {
        const count = getMetricCounter(counters, `storagePhysical.write.size.${band}`)
        return {label, value: count, detail: `${count} writes`}
    }).filter(item => item.value > 0)
    renderHorizontalHistogram(container, data)
}

function renderHorizontalHistogram(container, data = []) {
    if(!container) return

    container.replaceChildren()

    if(!data || data.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'empty'
        empty.textContent = 'No data'
        container.append(empty)
        return
    }

    // Find max value for scaling
    const maxValue = Math.max(...data.map(item => item.value), 1)
    const barMaxWidth = 200 // pixels

    // Create rows for each data item (already sorted descending)
    data.forEach(item => {
        const row = document.createElement('div')
        row.className = 'histogram-row'

        // Label
        const label = document.createElement('div')
        label.className = 'histogram-label'
        label.textContent = item.label
        label.title = item.label

        // Bar container
        const barContainer = document.createElement('div')
        barContainer.className = 'histogram-bar-container'

        // Bar
        const bar = document.createElement('div')
        bar.className = 'histogram-bar'
        const barWidth = (item.value / maxValue) * barMaxWidth
        bar.style.width = `${barWidth}px`
        bar.title = item.detail

        // Detail label
        const detail = document.createElement('div')
        detail.className = 'histogram-bar-label'
        detail.textContent = item.detail
        detail.title = item.detail

        barContainer.append(bar, detail)
        row.append(label, barContainer)
        container.append(row)
    })
}
