const {COORDINATOR_PAUSE_GENERATION_KEY} = require('./storageKeys')
/*
 * ARCHITECTURE: Preference/control storage boundary.
 *
 * Preference keys are user or operator controls. They can influence machine
 * policy, but they are not queue authority and should stay separate from the
 * storage subsystem's WAL-backed state.
 */

const {
    COORDINATOR_PAUSED_KEY,
    COORDINATOR_RETRY_FAILED_ENABLED_KEY
} = require('./storageKeys')
const COORDINATOR_AUTO_START_ON_BROWSER_START_KEY = 'coordinatorAutoStartOnBrowserStart'
const TARGET_QUEUED_TAB_CONCURRENCY_KEY = 'targetQueuedTabConcurrency'
// What a queued action does to its tab in the worker window (Preferences page, "Worker Window Focus"):
//   focus    : bring the tab forward and take OS focus on each open (the behaviour before this preference).
//   activate : bring the tab forward in its window; the window does not take OS focus.
//   none     : the tab stays in the background, nothing is focused, and a request to bring it forward is refused.
const WORKER_WINDOW_FOREGROUND_MODE_KEY = 'workerWindowForegroundMode'
const WORKER_WINDOW_FOREGROUND_MODES = ['focus', 'activate', 'none']
function normalizeTargetQueuedTabConcurrency(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10)
    if(!Number.isFinite(parsed) || parsed < 1) return fallback
    return parsed
}

function normalizeRecentHistoryRetentionDays(value, fallback = 90) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function normalizeRecentHistoryMaxEntries(value, fallback = 10000) {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function normalizeWorkerWindowForegroundMode(value, fallback) {
    return WORKER_WINDOW_FOREGROUND_MODES.includes(value) ? value : fallback
}

module.exports = {
    COORDINATOR_RETRY_FAILED_ENABLED_KEY,
    COORDINATOR_PAUSED_KEY,
    COORDINATOR_PAUSE_GENERATION_KEY,
    COORDINATOR_AUTO_START_ON_BROWSER_START_KEY,
    TARGET_QUEUED_TAB_CONCURRENCY_KEY,
    normalizeTargetQueuedTabConcurrency,
    WORKER_WINDOW_FOREGROUND_MODE_KEY,
    WORKER_WINDOW_FOREGROUND_MODES,
    normalizeWorkerWindowForegroundMode,
    normalizeRecentHistoryRetentionDays,
    normalizeRecentHistoryMaxEntries
}
