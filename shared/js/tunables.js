// Tunable sizes, depths, and cadences that are not user preferences. They sit
// next to defaults.js (the user-facing preference defaults) so every knob has
// one home. Change a value here, not at its use site.
//
// Each entry says what it bounds and what it costs. Rough sizes are measured,
// not guessed: one metrics journal entry serializes to about 640 bytes.
module.exports = {
    // Queue WAL row shard budget (completed-log closeout, step 4): uncompressed JSON per shard. The plan's 16 KB target is
    // compressed, so this is a proxy to check against a live run. The on/off switch and the completed-log limits are Preferences
    // page settings (shared/js/defaults.js), not tunables.
    QUEUE_WAL_SHARD_BYTES: 16384,

    // Flight recorder: in-memory ring of recent events, and the cap on the
    // copy persisted to session storage (the session quota is the constraint).
    FLIGHT_RECORDER_CAPACITY: 20000,
    FLIGHT_RECORDER_SESSION_SNAPSHOT_LIMIT: 2000,
    FLIGHT_RECORDER_SESSION_PERSIST_MIN_MS: 10000,

    // Queue wakeup metrics journal. The in-memory journal is what the
    // recorder-style analysis reads while the worker is alive. The copy in the
    // main metrics blob stays small (the blob is rewritten on every flush).
    MAX_QUEUE_WAKEUP_METRIC_JOURNAL: 1200,
    MAX_QUEUE_WAKEUP_METRICS_VIEW_JOURNAL: 30,

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
    // OUTLIER_MIN_SAMPLES_FOR_STDDEV pushed samples. A flagged row is recorded only at OUTLIER_MIN_RECORD_MS or more (owner, 24 Oct);
    // every finished row still counts toward the baseline. Only finished rows are listed; the stored list keeps its newest
    // OUTLIER_MAX_ENTRIES entries (one stored entry key per listed outlier, so OUTLIER_MAX_ENTRIES is also the number of entry slots).
    // An entry keeps at most OUTLIER_MAX_EVENTS_PER_ENTRY recorder events, the newest (27 Oct).
    OUTLIER_FLOOR_MS: 45000,
    OUTLIER_STDDEV_MULTIPLIER: 2.5,
    OUTLIER_MIN_SAMPLES_FOR_STDDEV: 5,
    OUTLIER_MIN_RECORD_MS: 3500,
    OUTLIER_MAX_ENTRIES: 50,
    OUTLIER_MAX_EVENTS_PER_ENTRY: 100,

    // Limits that more than one module used to declare (historical/14-oct-review-1.md finding 8). Each is declared here only.
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
    FILL_PRE_SCAN_BUSY_SKIP_ENABLED: true,
    // Wait between reads of the profile menu for its block or unblock item, in ms (the page script). The first read is at once. A fixed
    // 500 ms was measured against an escalating schedule (22 Oct): no difference in blocks, handoff or gaps, so the simpler fixed wait stays.
    PROFILE_MENU_POLL_INTERVAL_MS: 500,
    // Space page: how long to wait before asking the worker again for profiles it has not answered, after a reply timed out or failed.
    SPACE_FEED_STATE_RETRY_MS: 1500,
    // Polling: how often the Quora page asks the worker for the queue bar summary, and for the space page's state while a nuke is pending.
    CONTENT_PROGRESS_BAR_POLL_MS: 3000,
    SPACE_FEED_STATE_POLL_MS: 5000,
    // Dashboard: how often the throttle note is redrawn while Quora throttles the queue.
    DASHBOARD_THROTTLE_NOTE_REFRESH_MS: 1000,
    // Dashboard: how often the Current Work line's session duration is redrawn while a work session runs. The line reads no storage between redraws.
    DASHBOARD_WORK_SESSION_REDRAW_MS: 1000,
    DASHBOARD_WORK_SESSION_REFRESH_MS: 5000,
    // Dashboard flight recorder card (dev mode only): how often it asks the worker for new events while it is expanded, and how many rows it keeps.
    FLIGHT_RECORDER_CARD_POLL_MS: 1000,
    FLIGHT_RECORDER_CARD_ROW_LIMIT: 200,
    // Dashboard outlier Events list: the gap between two consecutive recorder events, in the order the list shows them, is highlighted
    // as abnormal when it is greater than this many ms.
    OUTLIER_EVENT_GAP_ABNORMAL_MS: 500,
    // The owned nuke status is reused for this long before the page asks the worker again.
    OWNED_NUKE_STATUS_TTL_MS: 2000,
    // The space page's redraw waits at most this long for the owned status. A slower answer lands in the cache for the next redraw.
    OWNED_NUKE_STATUS_WAIT_MS: 150,
    // Space page renders: at least this long between renders driven by scrolling and page changes.
    SPACE_FEED_RENDER_MIN_GAP_MS: 200,
    // Space page: how long the profile-link card scan is reused, unless the page's structure changes first.
    SPACE_FEED_PROFILE_LINK_CARD_CACHE_MS: 1000,
    // Space page: the whole feed is searched for profile links at most this often. Between searches the links are kept up to date from the page's added nodes.
    SPACE_FEED_PROFILE_LINK_FULL_SCAN_MS: 10000,
    // Space page: how long the feed's content root is reused before it is worked out again.
    SPACE_FEED_CONTENT_ROOT_MEMO_MS: 2000,
    // Space page: a redraw reuses the last scan of the feed for at most this long, and while the view moves less than the band (down, up).
    SPACE_FEED_SCAN_REUSE_MS: 10000,
    SPACE_FEED_SCAN_BAND_DOWN_PX: 1000,
    SPACE_FEED_SCAN_BAND_UP_PX: 200,
    // Space page: how long the page-wide render model is reused while the same posts are on the page.
    SPACE_FEED_RENDER_MODEL_MEMO_MS: 300,
    // Executor classification: the apply pass reuses its last classification while the input generation is unchanged and the
    // classification is younger than this backstop, so a missed trigger costs at most this long (sw.js, 22 Oct).
    EXECUTOR_CLASSIFY_BACKSTOP_MS: 30000,
    // The erase replies to its sender before the extension reloads, so the reload waits this long after the clear.
    ERASE_RELOAD_DELAY_MS: 300,
    // A window's tab that is not the active row's and looks orphaned is closed only after this grace, so a tab still being
    // activated is never taken (sw.js, orphan surface tab sweep).
    ORPHAN_SURFACE_TAB_GRACE_MS: 10000,
    // Text kept on stored errors, diagnostics and event messages: longer text is cut to this many characters (24 Oct, review C.2).
    // Page context text is a different limit and is not this one.
    STORED_ERROR_TEXT_MAX_CHARS: 240,

    // Profile search "Collect N More" (content.js). The count a search page starts with, and the choices its dropdown offers. The
    // dropdown's choice is kept for that search page only, in memory: it is not saved, and it resets on reload or a new search.
    // "Nuke 'Em" keeps the default count.
    PROFILE_SEARCH_COLLECT_LIMIT: 100,
    PROFILE_SEARCH_COLLECT_CHOICES: [25, 50, 100, 250, 500, 1000],

    // Scrolling in the collect loops and the modal nuke (content.js). The wait after each scroll before the page is read again. Quora
    // slows down deeper into a feed, so a feed that stops growing at the bottom only counts as ended after COLLECT_END_CONFIRM_MS.
    COLLECT_SCROLL_PASS_WAIT_MS: 500,
    COLLECT_END_CONFIRM_MS: 3000,
    MODAL_PROFILE_NUKE_SCROLL_WAIT_MS: 900,
    // Collect loops (content.js): a collect that stops moving for this long gives up. The space page checks this only away from the bottom
    // (at the bottom the feed ends after COLLECT_END_CONFIRM_MS instead); profile search checks it at any position. (Moved from content.js as
    // PROFILE_SEARCH_COLLECT_STALLED_TIMEOUT_MS; same value, no behaviour change.)
    COLLECT_STALLED_TIMEOUT_MS: 30000,
    // The Stop collecting label (content.js, both pages) re-reads its count, passes and elapsed time once per tick while a run is active.
    COLLECT_STOP_LABEL_TICK_MS: 1000,

    // Candidate batches (space page and profile search, content.js): the most profiles one nuke batch works on at once. The profile
    // search batch is also capped by the profilesPerBatch preference, and never raised above this; the space page batch ignores the preference.
    // (Replaces the two per-page copies SPACE_FEED_PROFILES_PER_BATCH and PROFILE_SEARCH_PROFILES_PER_BATCH, both 3.)
    CANDIDATE_BATCH_PROFILES_PER_BATCH: 3,

    // Dashboard duration histograms (owner, 26 Oct; semi-log scale changed 26 Oct): the real-block and already-blocked completed rows, bucketed by
    // active-to-terminal time. Each entry is the lower bound of a bucket in seconds, inclusive; a bucket runs up to the next entry, exclusive, and
    // the last one has no upper bound (the page labels it "over 10 s"). The worker counts them (sw.js makeCompletedDurationHistogram) and the page
    // labels them from this same array. The values are seconds, so 750 ms is 0.75 and 1000 ms is 1: a duration compares against edge * 1000 ms.
    HISTOGRAM_DURATION_EDGES_SEC: [0, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 10]
}

