/*
 * ARCHITECTURE: Preference/control storage boundary.
 *
 * Preference keys are user or operator controls. They can influence machine
 * policy, but they are not queue authority and should stay separate from the
 * storage subsystem's WAL-backed state.
 */

const COORDINATOR_RETRY_FAILED_ENABLED_KEY = 'mbCoordinatorRetryFailedEnabled'
const COORDINATOR_PAUSED_KEY = 'mbCoordinatorPaused'
const COORDINATOR_PAUSE_GENERATION_KEY = 'mbCoordinatorPauseGeneration'
const COORDINATOR_AUTO_START_ON_BROWSER_START_KEY = 'coordinatorAutoStartOnBrowserStart'
const TARGET_QUEUED_TAB_CONCURRENCY_KEY = 'targetQueuedTabConcurrency'

function normalizeTargetQueuedTabConcurrency(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10)
    if(!Number.isFinite(parsed) || parsed < 1) return fallback
    return parsed
}

module.exports = {
    COORDINATOR_RETRY_FAILED_ENABLED_KEY,
    COORDINATOR_PAUSED_KEY,
    COORDINATOR_PAUSE_GENERATION_KEY,
    COORDINATOR_AUTO_START_ON_BROWSER_START_KEY,
    TARGET_QUEUED_TAB_CONCURRENCY_KEY,
    normalizeTargetQueuedTabConcurrency
}
