/*
 * ARCHITECTURE: Dashboard projection boundary.
 *
 * Dashboard storage is a rebuildable read model. It may summarize queue,
 * run, event, and metric state for UI rendering, but it must not decide
 * authoritative queue status.
 */

const COORDINATOR_QUEUE_VIEW_KEY = 'mbCoordinatorQueueView'
const COORDINATOR_RUNS_KEY = 'mbCoordinatorRuns'
const COORDINATOR_EVENTS_KEY = 'mbCoordinatorEvents'
const QUEUE_WAKEUP_METRICS_VIEW_KEY = 'mbQueueWakeupMetricsView'

function makeCoordinatorDashboardStateKeys(extraKeys = []) {
    return new Set([
        COORDINATOR_QUEUE_VIEW_KEY,
        COORDINATOR_RUNS_KEY,
        COORDINATOR_EVENTS_KEY,
        QUEUE_WAKEUP_METRICS_VIEW_KEY,
        ...extraKeys
    ])
}

module.exports = {
    COORDINATOR_QUEUE_VIEW_KEY,
    COORDINATOR_RUNS_KEY,
    COORDINATOR_EVENTS_KEY,
    QUEUE_WAKEUP_METRICS_VIEW_KEY,
    makeCoordinatorDashboardStateKeys
}
