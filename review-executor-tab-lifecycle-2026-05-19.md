# Executor/Tab Lifecycle Review - 2026-05-19

Status: resolved review record.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Keep this as
evidence for the review/fix cycle; do not use it as current plan without
rechecking source.

Review target: queued executor lifecycle from in-memory action selection through tab open, action claim, action lease, slot release, close, and `tabs.onRemoved` cleanup.

Scope: `shared/js/sw.js` executor/tab handlers and `shared/js/content.js` queued-tab release/close calls. This review is intentionally standalone and does not rely on findings from the other review notes.

## Current Status

Status: resolved as an active review note by the `1.6.329` fix pass tracked in
`review-fix-checklist-2026-05-20.md`.

- stale close rejection preventing the `window.close()` fallback is checked
  off;
- tab-open failures requeue or schedule recovery instead of dropping shifted
  in-memory actions;
- slot release waits for required durable cleanup before opening the next slot
  when prior progress is nonterminal or missing.

Keep this file as the original finding record. New lifecycle review should
start from current source and tests rather than these old line references.

## Findings

### P1: A stale worker tab can self-close after the service worker rejects the close request

`requestCloseTab()` asks the service worker to close the tab with the active attempt id (`shared/js/content.js:3888`, `shared/js/content.js:3891`). If the service worker returns `{closed: false, staleAttempt: true}`, the content helper does not distinguish that from an ordinary failure; it falls through to `window.close()` (`shared/js/content.js:3893`, `shared/js/content.js:3902`).

The service-worker close handler correctly validates stale attempts before closing (`shared/js/sw.js:8967`, `shared/js/sw.js:8971`, `shared/js/sw.js:8973`). But the content fallback bypasses that denial. If the browser allows the tab to close, `tabs.onRemoved` runs cleanup and `releaseQueuedTab(tabId)` without an attempt validation step (`shared/js/sw.js:8705`, `shared/js/sw.js:8764`).

Impact: an old attempt can close itself after the service worker refused the close request. That can release executor capacity or clear tab metadata for a tab the current durable attempt still expected to control.

Recommendation: if `close-tab` returns `staleAttempt`, do not call `window.close()`. Treat stale close denial as authoritative and let the service worker or repair path clean up only if the durable row still matches.

### P2: Tab-open failures can drop the in-memory executor action without scheduling recovery

`fillQueuedTabsOnce()` removes work from `queuedTabActions` before opening the tab (`shared/js/sw.js:8518`, `shared/js/sw.js:8519`). If `createOwnedTab(next)` throws, the surrounding `try` falls through to an empty `catch` at the bottom of the loop (`shared/js/sw.js:8532`, `shared/js/sw.js:8674`). The action has already been shifted and is not requeued, rolled back, or immediately scheduled for repair.

The durable queue row should still exist, so later recovery can recreate the executor action, but the immediate executor wakeup is lost.

Impact: a transient `tabs.create` failure can stall work until some later alarm, storage-change, dashboard, or manual repair path notices the queued row.

Recommendation: catch tab-open failures at the `createOwnedTab()` boundary, record a queue event or retryable row state, and call `scheduleStoredWorkRepair(1000)` or reinsert the action with a bounded retry count.

### P2: Release cleanup starts authoritative writes but does not await them before filling the next slot

`releaseQueuedTab()` clears the active slot, then launches action-lease release and progress writes with `void` (`shared/js/sw.js:7443`, `shared/js/sw.js:7445`, `shared/js/sw.js:7451`, `shared/js/sw.js:7458`, `shared/js/sw.js:7463`). It then immediately calls `fillQueuedTabs()` (`shared/js/sw.js:7479`).

This keeps throughput high, but it means the next tab can be opened before the previous tab's lease release, slot-release progress, terminal sync, or rollback has reached durable storage.

Impact: under slow storage or service-worker churn, active capacity can advance ahead of the durable state that explains why the previous tab is no longer active. Recovery has to reconcile that after the fact.

Recommendation: split slot release into a fast in-memory phase and a required durable phase. At minimum, await action-lease release and rollback writes before filling the next slot when the progress record is nonterminal or missing.

## Notes

The claim path has useful restart recovery: `recoverPendingTabActionFromCoordinatorQueue()` can reconstruct pending action metadata from durable rows (`shared/js/sw.js:7583`, `shared/js/sw.js:7665`), and `claimPendingTabAction()` nudges durable transition without blocking the content claim (`shared/js/sw.js:7676`, `shared/js/sw.js:7695`). I did not find a duplicate-open bug in that path during this pass.
