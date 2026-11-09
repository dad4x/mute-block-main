# Debugging progress — last 5 commits (2026-09-17 → 2026-09-29)

> **Status: HISTORICAL** (24 Oct 2026). Debugging log of the last five commits (17 to 29 Sep). Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Chronological (oldest → newest).

## 1. `7113089` — Correct P3-5/P3-6 JOB_EVENT_RETRY design
Design-correction commit: `jobState.js`'s `reduceJobEvent(JOB_EVENT_RETRY)` was trusting a
caller-built fact bundle (`isExhausted`, `activeTransitionRetry`, `runtimeDisappearedRetry`,
`transientOpenRetry`, `queueAuthoritative`, half of `serviceWorkerOwned`) where nearly every
field was actually a pure function of the `item` the reducer already had access to.

- Moved those predicates into `jobState.js` itself as dependency-free functions; the event
  payload shrank to only what the caller genuinely can't derive (its own recovery-mode intent
  flags + a raw point-in-time queue-load-pressure reading, now interpreted by the reducer via
  `isRecentQueueLoadPressureReading` instead of pre-interpreted by the caller).
- Also finished the previously-blocked P3-6 mutation-side convergence:
  `buildForcedRolledBackQueuedTabRetryItem` now builds the same intent via a shared
  `buildExhaustedRollbackRecoveryIntent` helper and lets the reducer own the
  `exhaustedRolledBackRecoveryCount` increment, closing a TOCTOU gap by capturing the
  queue-load-pressure reading once (`captureQueueLoadPressureReading`) instead of re-reading
  live throttle state a second time.
- Rewrote `test/jobState.test.js` retry-recovery coverage to prove the reducer derives facts
  from realistic item fixtures rather than trusting caller-asserted booleans, plus two new
  negative cases the old shape couldn't catch.

## 2. `c3af164` — Document the corrected P3-5/P3-6 design
Pure documentation commit updating `sw-state-machine-decomposition-plan-2026-09-01.md` to
reflect the design correction and mark the mutation-side convergence done, including how the
two original blockers (call-site fan-out, TOCTOU risk) were resolved.

## 3. `cdeebe5` — Merge of the above two
Merge commit bringing the P3-5/P3-6 design correction and its docs together.

## 4. `e2e5c65` — Live batch fixes (chrome-dev field testing)
Root-caused several issues surfaced by live testing against a real large space-feed batch,
tracked in `live-batch-fixes-worklist-2026-09-19.md`. Full suite green throughout (869/869, then
868/868 after removing an obsolete test).

1. **Button overlap** — `resetProfileButtonRail()` didn't fire on same-tab profile-to-profile
   navigation; fixed by triggering on `getProfileKey()` change, and made the dedup sweep in
   `getOrCreateProfileButtonRail` run unconditionally.
2. **"Really blocked" undercounting** — close-if-blocked's response now reads `blockAttempted`
   straight from the tab's in-memory state instead of a storage round trip. Added a new durable
   per-item field `item.initialBlockedState`, captured once from whichever attempt's tab first
   observes it and never overwritten by a retry — fixes misclassifying a real block (whose
   confirmation got lost, forcing a retry) as already-blocked.
3/4. **Long handoffs + write-queue backlog alerts** — both root-caused to the single global
   serialized write chain in `sw.js`'s `createCoordinatorAuthority`:
   - Large space-feed enqueues were chunked in a tight awaited loop that re-entered the write
     queue via a pure microtask with no real yield, so a big batch still monopolized the chain.
     Moved chunking to the poster (`content.js`'s `sendCoordinatorEnqueueChunked`) so each chunk
     is its own message and gets a real macrotask gap for other writers.
   - The WAL checkpoint-switch was waiting in the same FIFO as ordinary writes; under load it
     could starve for tens of minutes while the WAL tail grew unbounded (confirmed live: one
     checkpoint in 3.4 hours, tail at 493 records vs. the ~128 target). Pulled it out of the
     shared queue — now marked due and drained as a prefix step on whichever ordinary write runs
     next, still serialized but without its own queue position.
   - Dashboard was polling the service worker every 5s just because it was open
     (`resumeCoordinatorQueueResume` timer), and `coordinator.html#worker-window` ran the same
     bundle so two open tabs meant two independent pollers. Removed entirely — the service
     worker's alarm-based scheduling is self-sufficient.

## 5. `fa3f663` — Nudge accounting races, dashboard tab/view mixups, worker status bar + history page
Largest and most recent commit; several converging bug reports.

- **Nudge false-positive spam** — close-if-blocked and claim nudges now gate on content-script
  readiness and an "already-removed" check, fixing false not-blocked/rejected spam traced to a
  specific live incident (Hector-Morales-312).
- **Dashboard/worker-window/history tab dedupe** — `tabs.query` ignores URL fragments, so the
  worker window (or a `#history` tab) could get misidentified as "the" dashboard tab, reused
  without navigating, or even closed as a duplicate.
- **Root cause of "all three views show at once"** — `[hidden]` loses to any author rule that
  sets its own `display` property, so `element.hidden` was never actually hiding
  `dashboardView`/`workerBarView`/`historyView`. This was the actual display bug behind a
  recurring report.
- **New worker-window status bar** — minimal progress fill / pause / resume / cancel /
  cross-navigation UI, plus a dedicated history page, both as `coordinator.html` hash variants
  with full cross-navigation between dashboard/worker/history/preferences.
- Gated the pause diagnostic snapshot on dev mode only.
- "Nuke 'Em" button no longer shows on Space sub-pages with no posts.
- Misc: nudge-accept dashboard card no longer alerts on normal churn; popup Save/Reset wording;
  preferences dashboard button opens in the requesting window.

## Overall arc
The two design-correction commits (`7113089`/`c3af164`/`cdeebe5`) closed out a long-running
refactor (P3-5/P3-6 of the sw state-machine decomposition), establishing the pattern "events
carry only genuine caller inputs; reducers derive everything else from `item`." That pattern
work then freed attention for live-testing passes (`e2e5c65`, `fa3f663`) that root-caused real
production symptoms — block-count undercounting, write-queue starvation, checkpoint starvation,
tab/view identity confusion, and a CSS specificity bug masking as three simultaneous UI views —
several of which trace back to the same underlying theme: state that was being inferred or
recomputed in multiple places (or read through unreliable proxies like URL-fragment-blind
`tabs.query`, or `[hidden]` vs. author CSS) drifting out of sync under real concurrent load.
