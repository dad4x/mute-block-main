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
    NO_DURABLE_WORK_REASON_LIMIT: 40
}
