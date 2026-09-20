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

    // coordinator.js dashboard-to-service-worker message round trips
    // (sendRuntimeMessageWithTimeout's own default, and the heavier
    // mutation-style calls that explicitly opt into a longer budget)
    COORDINATOR_MESSAGE_DEFAULT_TIMEOUT_MS: 5000,
    COORDINATOR_MESSAGE_MUTATION_TIMEOUT_MS: 10000,

    // sw.js
    WAIT_FOR_USER_START_DURABLE_ACTIVATION_DEFAULT_TIMEOUT_MS: 15000
}
