// Entropy-reduction Pattern 8 (see entropy-reduction-action-plan-2026-09-09.md
// and ../../memory project memory feedback-symbolic-timeout-registry): named
// homes for the timeout/interval values that used to live as bare numeric
// literals in each wait-loop function's own default parameters, scattered
// across content.js and coordinator.js with no shared vocabulary. Named per
// function (and, for coordinator.js's dashboard round trips, per message
// weight) rather than deduplicated by value -- two waits that happen to share
// a number today are not necessarily the same *kind* of wait, and giving them
// independent names keeps them independently tunable later.
//
// Scope note: this first pass covers each wait-loop function's own default
// parameter value -- the value every call site inherits unless it explicitly
// overrides it, so it's the one true "system-wide dial" per wait kind. The
// much larger set of explicit per-call-site overrides in content.js (dozens
// of one-off `waitFor*(..., customTimeoutMs, customIntervalMs)` calls) is
// left as scattered literals for now, migrated opportunistically as each is
// independently touched, per the same reactive policy that seeded this file
// in the first place.

module.exports = {
    // content.js wait-loop primitives (shared/js/content.js)
    WAIT_FOR_ACTION_DEFAULT_TIMEOUT_MS: 4000,
    WAIT_FOR_ACTION_DEFAULT_INTERVAL_MS: 200,
    WAIT_FOR_CONDITION_DEFAULT_TIMEOUT_MS: 4000,
    WAIT_FOR_CONDITION_DEFAULT_INTERVAL_MS: 200,
    WAIT_FOR_CONDITION_OR_DOM_MUTATION_DEFAULT_TIMEOUT_MS: 4000,
    WAIT_FOR_CONDITION_OR_DOM_MUTATION_DEFAULT_INTERVAL_MS: 250,

    // content.js profile-menu-state waits
    WAIT_FOR_MENU_STATE_DEFAULT_TIMEOUT_MS: 5000,
    WAIT_FOR_MENU_STATE_DEFAULT_INTERVAL_MS: 250,
    READ_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS: 2500,
    READ_PROFILE_MENU_STATE_DEFAULT_INTERVAL_MS: 200,
    WAIT_FOR_PROFILE_MENU_STATE_DEFAULT_TIMEOUT_MS: 8000,
    WAIT_FOR_PROFILE_MENU_STATE_DEFAULT_INTERVAL_MS: 500,
    ENSURE_PROFILE_MENU_OPEN_DEFAULT_TIMEOUT_MS: 2500,

    // content.js action-verification waits
    WAIT_FOR_VERIFIED_PROFILE_UNBLOCKED_DEFAULT_TIMEOUT_MS: 8000,
    WAIT_FOR_VERIFIED_PROFILE_UNBLOCKED_DEFAULT_INTERVAL_MS: 250,
    WAIT_FOR_VERIFIED_PROFILE_BLOCKED_DEFAULT_TIMEOUT_MS: 8000,
    WAIT_FOR_VERIFIED_PROFILE_BLOCKED_DEFAULT_INTERVAL_MS: 250,
    WAIT_FOR_PROFILE_ACTION_READY_DEFAULT_TIMEOUT_MS: 5000,
    WAIT_FOR_CANONICAL_PROFILE_ACTION_ROUTE_DEFAULT_TIMEOUT_MS: 5000,
    WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_TIMEOUT_MS: 180000,
    WAIT_FOR_OWNED_NUKE_TABS_TO_DRAIN_DEFAULT_INTERVAL_MS: 1000,
    CLOSE_PROFILE_MENU_DEFAULT_TIMEOUT_MS: 1500,

    // content.js's own service-worker message round trip (parallel to
    // coordinator.js's sendRuntimeMessageWithTimeout below)
    SAFE_SEND_RUNTIME_MESSAGE_DEFAULT_TIMEOUT_MS: 12000,

    // content.js space-feed batch enqueue (enqueueCoordinatorSpaceFeedItems):
    // a big enough batch, chunked against an already-large durable queue,
    // can legitimately outlive the service worker's own execution lifetime
    // -- the chunked write still completes and is durably summarized, but
    // the original sendMessage's response channel is gone, so the awaiting
    // page hangs forever on a response that will never arrive (confirmed
    // live 2026-09-19: a 657-candidate batch finished durably per
    // mbCoordinatorLastEnqueueSummary while the button stayed on "Nuking..."
    // indefinitely). MESSAGE_TIMEOUT_MS bounds how long to wait for the
    // direct response before falling back to polling that durable summary
    // by runId; SUMMARY_POLL_TIMEOUT_MS/INTERVAL_MS bound that fallback.
    SPACE_FEED_ENQUEUE_MESSAGE_TIMEOUT_MS: 15000,
    SPACE_FEED_ENQUEUE_SUMMARY_POLL_TIMEOUT_MS: 90000,
    SPACE_FEED_ENQUEUE_SUMMARY_POLL_INTERVAL_MS: 1000,

    // content.js chunk-level retry (sendCoordinatorEnqueueChunked): a chunk
    // that comes back with no response, a storage timeout, or durable:false
    // has not landed at all -- this write path has no partial-success state,
    // so re-sending the same chunk can never double-count. 2026-10-06: a
    // 491-candidate batch silently lost its last (32-item) chunk this way,
    // with the old break-on-first-failure loop reporting a numerically
    // "complete" summary that was actually short by 32 -- user explicitly
    // ruled out "ask the user to retry" as a fix, so failed chunks now retry
    // in place with backoff instead of abandoning the rest of the batch.
    SPACE_FEED_ENQUEUE_CHUNK_MAX_ATTEMPTS: 5,
    SPACE_FEED_ENQUEUE_CHUNK_RETRY_BASE_DELAY_MS: 2000,

    // coordinator.js dashboard-to-service-worker message round trips
    // (sendRuntimeMessageWithTimeout's own default, and the heavier
    // mutation-style calls that explicitly opt into a longer budget)
    COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS: 5000,
    COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS: 10000,

    // sw.js
    WAIT_FOR_USER_START_DURABLE_ACTIVATION_DEFAULT_TIMEOUT_MS: 15000,

    // sw.js stale-active-row watchdog (runCoordinatorReconcileTickOnce): a
    // durable row can sit at status 'active' indefinitely if the specific
    // combination of conditions that would normally classify and recover it
    // (classifyCoordinatorExecutorState's 'active-missing-tab' case, handled
    // in runCoordinatorExecutorApplyPhase) never gets reached -- that deep
    // classifier only runs when prunedQueuedActions > 0 this tick, which has
    // nothing to do with whether an unrelated active row's tab is actually
    // gone. Confirmed live 2026-10-06: one row sat 'active' for over an hour
    // with zero matching live tabs (getLiveProfileTabsByHref came back
    // empty for its href) while reconcile ticks kept running normally every
    // ~60s. This watchdog runs unconditionally on every reconcile tick
    // (cheap: the full queue is already loaded for the unrelated
    // queued-action prune step) and force-recovers any active row past this
    // age with no matching live tab, independent of that gate.
    STALE_ACTIVE_COORDINATOR_ROW_WATCHDOG_MS: 180000,

    // sw.js runCoordinatorQueueExecutorFastPath coalescing (2026-10-07): a
    // burst of distinct reactive triggers (slot-release, active-transition,
    // queued-authority-enqueue, etc.) can each independently call this
    // function within milliseconds of each other. Confirmed live: 13 such
    // calls back to back, each 45-72 real seconds (queued behind the same
    // serialized storage-update lane), with every call after the first
    // finding nothing left to do. This window bounds how recently the last
    // completed call must have finished -- and how little must have changed
    // since (compared via a cheap in-memory runtime/queue-counts fingerprint,
    // no storage I/O) -- for a new call to reuse that result instead of
    // repeating the full pass. Short enough that a call outside this window
    // is treated as a genuinely new situation, long enough to collapse a
    // same-moment burst of triggers into one real pass.
    COORDINATOR_FAST_EXECUTOR_RECENT_NOOP_COOLDOWN_MS: 2000
}
