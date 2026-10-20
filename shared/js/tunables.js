// Tunable sizes, depths, and cadences that are not user preferences. They sit
// next to defaults.js (the user-facing preference defaults) so every knob has
// one home. Change a value here, not at its use site.
//
// Each entry says what it bounds and what it costs. Rough sizes are measured,
// not guessed: one metrics journal entry serializes to about 640 bytes.
module.exports = {
    // Flight recorder: in-memory ring of recent events, and the cap on the
    // copy persisted to session storage (the session quota is the constraint).
    FLIGHT_RECORDER_CAPACITY: 20000,
    FLIGHT_RECORDER_SESSION_SNAPSHOT_LIMIT: 2000,
    FLIGHT_RECORDER_SESSION_PERSIST_MIN_MS: 10000,

    // Queue wakeup metrics journal. The in-memory journal is what the
    // recorder-style analysis reads while the worker is alive. The copy in the
    // main metrics blob stays small (the blob is rewritten on every flush), and
    // the larger stored copy goes under its own key on a slower cadence.
    MAX_QUEUE_WAKEUP_METRIC_JOURNAL: 1200,
    MAX_QUEUE_WAKEUP_METRICS_VIEW_JOURNAL: 30,
    MAX_QUEUE_WAKEUP_JOURNAL_STORED: 600,
    QUEUE_WAKEUP_JOURNAL_PERSIST_MIN_MS: 60000,

    // Queue wakeup metrics blob: at most one flush per interval (the blob is
    // about 160 KB and was being written on every metric change).
    QUEUE_WAKEUP_METRICS_FLUSH_MIN_MS: 3000,
    QUEUE_WAKEUP_METRICS_STORAGE_TIMEOUT_MS: 3000,

    // Storage-update churn: how many distinct reasons get their own no-work
    // counter before further reasons are folded into "other". Each counter is a
    // key in the stored counter map, so this bounds that map.
    NO_DURABLE_WORK_REASON_LIMIT: 40,

    // Automatic soft-fail retry budget (see isArchivableCoordinatorRow in swCoordinatorStatusRules.js). A failed row whose
    // failure is soft keeps its live row while its retryCount is below this, as a requeue candidate. At or above it, the row
    // is terminal and archives to the completed-work log like a hard failure. The automatic retry tick, the manual
    // retry-failed action, the dashboard's eligibility count and the archive rule all read this one value.
    SOFT_FAIL_RETRY_LIMIT: 2,

    // Dashboard outlier list (swCoordinatorOutliers.js). A finished row is judged when its archive is saved, against the running
    // baseline as it stood then: it is flagged when its duration (terminalAt minus activeAt) reaches OUTLIER_FLOOR_MS, or the stddev
    // threshold, the baseline mean plus OUTLIER_STDDEV_MULTIPLIER times its sample stddev. The stddev test needs
    // OUTLIER_MIN_SAMPLES_FOR_STDDEV pushed samples. An active row is judged at each refresh and is not stored. The stored list keeps
    // its newest OUTLIER_MAX_ENTRIES entries.
    OUTLIER_FLOOR_MS: 45000,
    OUTLIER_STDDEV_MULTIPLIER: 2.5,
    OUTLIER_MIN_SAMPLES_FOR_STDDEV: 5,
    OUTLIER_MAX_ENTRIES: 50,

    // Limits that more than one module used to declare (14-oct-review-1.md finding 8). Each is declared here only.
    // The most records the profile-nuke progress view keeps. sw.js and content.js both prune to it.
    MAX_PROFILE_NUKE_PROGRESS_ENTRIES: 1000,
    // Retry budget for a stale queued tab (sw.js). jobState.js also uses it as the default when an item has no maxRetries.
    STALE_QUEUED_TAB_MAX_RETRIES: 1,
    // Recovery cap for an exhausted rolled-back queued-tab retry (jobState.js isExhaustedRollbackRecoveryApproved).
    EXHAUSTED_ROLLBACK_RECOVERY_LIMIT: 3,
    // Queue-load throttle ceiling (sw.js). jobState.js also uses it as the pressure recovery window when a record has none.
    QUEUE_LOAD_THROTTLE_MAX_MS: 120000,
    // Re-reads the stored-work clear makes before it saves (sw.js mutateCoordinatorStoredWorkClear, review-2 S3-2). A row whose
    // attempt moved since the first read is rebuilt from the fresh read. A row that still moved after this many re-reads is removed
    // with the rest, and its tab is closed (review-3 R3-5, owner 14 Oct).
    STORED_WORK_CLEAR_REREAD_ATTEMPTS: 2,
    // Passes a claim retry loop in content.js makes before it reports itself to the worker once (review-2 C-3). A measurement
    // threshold, not a ceiling: no loop stops at this count. The report lands in the flight recorder and the queue wakeup counters.
    CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES: 40,
    // Re-checks one profile-blocked-state page event may make before it gives up for the attempt (sw.js, owner 17 Oct). The
    // interval between them is PROFILE_BLOCKED_PAGE_EVENT_RECHECK_INTERVAL_MS in timeouts.js.
    PROFILE_BLOCKED_PAGE_EVENT_RECHECK_MAX_ATTEMPTS: 6,
    // Owner 18 Oct: while the worker window is busy, the fill skips its whole-browser tab scans (sw.js, fillQueuedTabsOnce). It ends the
    // pass without waiting, and the tab removal that frees the window refills at once. Off in the comparison run that showed the
    // handoff summary worse with a wait; this is a skip, not a wait, and needs its own measurement run.
    FILL_PRE_SCAN_BUSY_SKIP_ENABLED: true
}

