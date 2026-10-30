# Preload the next queued tab (planning)

> **Status: ROADMAP** (24 Oct 2026). Planning only. Phase 0 measurements not taken. The 24 Oct update shows handoff at 0.37 s, which weakens the case. Decide with measurements. Not scheduled. Check planning.md before acting on it. Register: [notes register](../docs/notes-register.md).

Status: planning only, 2026-10-23. No code changed. Written from code reading; the measurements in Phase 0 have not been taken yet.

**Update 2026-10-24, from a finished-epoch dashboard (extension-updated, 307 terminal, queue empty; builds through 1469):**

- SECS / HANDOFF reads **0.37s**, against 72.4s on the 1388 baseline. The metric runs from a row's terminal to the next row's first claim (`activeAt` is set on CLAIMED or HEARTBEAT, `shared/js/jobState.js:655-660`), so it already includes the next tab's create, page load and claim. Load is no longer a large part of the handoff.
- Likely cause of the drop: v1.6.1440 (blocked tab removed before the release waits; the commit cites 751 surface-busy decisions) and v1.6.1441 (orphaned worker-window profile tab closed after 10s). Both remove the stalls that made the handoff slow. Neither is preloading.
- **Sample caveat:** 279 of 307 items were already blocked (92%). Only 23 were real blocks. The 0.37s is mostly the cheap path. The real-block handoff is not measured separately yet.
- SECS / REAL BLOCK reads 1.23s (23 samples). CLAIM to ACTION reads 2s and ACTION to TERMINAL 1s, both on 7 samples. These do not reconcile yet; they sample different things.
- Red on the dashboard, not handoff: NO-WORK WRITES 2021 (942 with no runtime), WAKEUPS/JOB 9.68, DUPLICATE PUMPS 52%, WRITE HOT PATH (a user-memory key, 42 MB over 854 calls).

**Effect on the plan:** the case for preloading is much weaker. Preloading can save at most the handoff (about 0.4s per item on this sample), while its invariants (P1 to P4) are unchanged. Hold it until a real-block-heavy epoch shows the real-block handoff. P1 (ownership-based occupancy) is partly covered by v1.6.1441, but "any tab means busy" is still in the code.

## Goal

While the active item is acting, the next item's profile page is already loaded in the worker window. Switching to it is a tab activation, not a page load. Total live profile tabs stays within `targetQueuedTabConcurrency` (default 4, `shared/js/defaults.js:6`).

This is the "concurrent loading, serial acting" model from the worker-window design notes (`project_worker_window_design_rationale`, owner's manual method: open a batch, work through them in order).

## Where the time goes today

- **The preference is ignored for foreground work.** `getEffectiveQueuedTabOpenConcurrency` returns 1 whenever mute, block, unblock or nuke work is queued (`shared/js/swQueuedTabActionAuthorityMatching.js:231`). The coordinator's own concurrency is forced to 1 for the same kinds (`shared/js/sw.js` around 14875). So today the preference does nothing for the main action.
- **One item's sequence, in the worker window:**
  1. Terminal result for item N.
  2. Tab N closed, release scheduling: `scheduleQueuedTabReleaseReconcile` waits 500ms (100ms with `awaitFill`) (`shared/js/sw.js:31683`); the follow-up path adds 500ms and then a 1000ms resume delay (`shared/js/swQueuedTabActionBookkeeping.js:137`).
  3. Fill pass (`fillQueuedTabs` `sw.js:35163`, `fillQueuedTabsOnce` `sw.js:35677`).
  4. Open lock, then `createOwnedTabInQueuedWorkerActionSurface` (`sw.js:29005`): create inactive, activate, focus window.
  5. Page load and content-script claim on load (`shared/js/content.js` `maybeRunAutoProfileAction`, around line 12130).
  6. Readiness wait, then `begin-profile-action` promotes the tab (`promoteQueuedTab`, `sw.js:30109`).
  7. Action runs.
- **The handoff metric** (terminal of N to start of N+1) contains steps 2 to 6. Preloading removes only the load part of step 5. The scheduling delays in step 2 need their own fix. The baseline's 72s handoff is noisy (18 interleaved runs, see [project_worker_window_performance_tuning_2026_10_08]), so the breakdown in Phase 0 comes first.

## Target shape

- **Acting tab**: exactly one, for foreground work. This is the existing serial rule and it stays.
- **Standby tabs**: up to `preference - 1` tabs, created inactive in the same worker window, loaded and held before their action.
- **Total cap**: acting + standby + in-flight creates <= `targetQueuedTabConcurrency`.
- **Switch**: when item N's tab is done, activate the head standby. Activating it deactivates N in the same window. Close N after that, so there is no blank moment.
- **Refill**: as soon as a standby is promoted, the freed depth opens the next standby.
- **Same window, not a second window.** Switching inside one window does not change OS focus, which matches the 2026-10-08 no-focus-steal decision (see [project_worker_window_no_focus_steal_2026_10_08]).

## Invariants this breaks

Each of these is an implicit assumption in the code today. Each one must change or be guarded.

1. **"Any non-anchor tab in the worker window means busy."** `createOwnedTabInQueuedWorkerActionSurface` (`sw.js:29005`, the `isSurfaceBusy` check) treats any extra tab as the acting tab. A standby tab would make every promotion look busy. This is also the live 2026-10-10 incident: an unowned blocked tab kept the slot busy and stalled the queue ([project_live_run_1416_observations_2026_10_10]). **Occupancy must come from an ownership record (acting tab id plus standby registry), not from "any tab exists".** This is a prerequisite, not part of the preload work.
2. **Stale proxy in the cap.** `getEffectiveQueuedTabOpenConcurrency` uses "foreground work exists" as a stand-in for "one tab at a time". The entropy plan calls this pattern 1 (stale invariant proxy, `entropy-reduction-action-plan-2026-09-09.md`). Split it into two caps: acting cap (1 for foreground) and total cap (the preference).
3. **Capacity gate.** `decideLiveProfileTabCapacityGate` (`shared/js/swFillQueuedTabsOnceDecisions.js:407`) compares live profile tabs against the open cap. Once the cap is the total, standby tabs count here, which is what we want. It currently reads the forced-1 value, so it has to move with item 2.
4. **Orphan reaper.** `reapOrphanedWorkerSurfaceTabs` (`sw.js:28921`) closes any surface tab whose row is not active after `ORPHAN_SURFACE_TAB_GRACE_MS` (10s, `sw.js:28918`). A standby row is `queued`, so it would be reaped. It must consult the standby registry.
5. **Active-set early returns.** `fillQueuedTabs` returns "active-runtime-in-flight" when the active count is above 0 and there are no activation intents (`sw.js` around 35207). If standby tabs entered the active set, refill would be suppressed. **Standby tabs stay out of the active set until promotion.**
6. **Claim on load.** Content claims on page load (`maybeRunAutoProfileAction`). A claimed row is leased and falls under the 180s stale-active watchdog (`STALE_ACTIVE_COORDINATOR_ROW_WATCHDOG_MS`). A standby that claims early would age out. **Hold the claim** until promotion; the worker pushes it then through the existing `claim-current-profile-tab-action` push (`content.js:2449`).
7. **Visibility gate.** Worker-window actions require `document.visibilityState === 'visible'` (`content.js` around 12453 and 12562). The existing order already promotes before the action (`begin-profile-action` promotes first). That order must stay.
8. **Stale-tab sweeps.** `stale-queued-tab-sweep`, `persisted-live-tab` and `missing-queued-runtime-prune` see tabs with no runtime entry and may close them. Each needs the registry.
9. **Pause.** `pauseCoordinatorNukes` (`sw.js` around 22443) stops opens before any await and stops owned tabs. Standby tabs must be included. The stop flag is set first, as today.
10. **Throttle and challenges.** `getQueueLoadThrottle` active forces the cap to 1 today. Standby depth must drop to 0 and standby tabs close under throttle, and on a Quora challenge or 429.
11. **Restart.** The registry is in memory and never written to the WAL. After a restart, unknown standby tabs are orphans and the reaper closes them after grace. Acceptable, since nothing durable is at stake.
12. **Nested wait budgets** (entropy pattern 5). The busy-slot wait (`WORKER_ACTION_SURFACE_SLOT_WAIT_TIMEOUT_MS`, 8s, `shared/js/timeouts.js:161`) holds the open lock. A standby open must not wait for the slot, or it delays promotion. Standby opens fail fast when the window has no room.
13. **Timeouts and knobs.** New waits (standby readiness budget, claim hold) go in `shared/js/timeouts.js` (entropy pattern 8). The depth switch and any new thresholds go in `shared/js/tunables.js`.
14. **Promotion races** (entropy pattern 4). Promotion can race pause, erase or a head change. Right before activating, re-check attempt identity and row status. Close the standby on any mismatch. Never reuse a standby across attempts.

## Correctness rule

A standby page is not trusted at promotion. Profile identity and the already-blocked check come from the live page at action time. Attempt identity and row status are re-read at promotion. This is the owner's "prove state is current on infrequent paths" rule ([feedback_correctness_over_speed_infrequent_paths]), applied to a hot path.

## Risks to test in the spike

- **Hidden same-window tabs reaching ready on Quora.** The content script itself uses animation frames in only 2 places (`content.js:2803`, `:5175`), but Quora's own page code is out of our control and may depend on frames or visibility.
- **Chrome background-tab behaviour.** Throttling, freezing after minutes hidden, and memory-saver discard. A standby waiting behind a long item may be frozen or discarded. Measure how long a standby can wait and still be promoted cleanly.
- **Activation latency** from a loaded hidden tab to visible.
- **Visibility when unfocused.** Whether an activated tab in a window that is not OS-focused still reports `visible`.
- **Request burst.** Up to `preference` page loads at once. Requests per item do not change, but bursts rise. Earlier notes record a Quora 429 that paused a base check, so a backoff to depth 0 is required.

## Phases

**P0 — Measure, no behaviour change.** Add segment timestamps to the handoff: terminal, tab closed, fill start, lock acquired, create, activate, claim, ready, promote, action start. Use the existing flight recorder and stage recorder (`recordQueuedTabOpenStage`). Decide from the numbers: if the scheduling delays in step 2 dominate, fix those first (cheap and certain), and ship that alone.

**P1 — Prerequisite: ownership-based occupancy.** Replace "any non-anchor tab means busy" with an ownership record. A tab in the surface window with no owner is reaped within a bounded time and logged. This addresses the 2026-10-10 incident. Check first whether it is already fixed; no record of a fix exists in the notes.

**P2 — Spike (live, CDP helper scripts, not Puppeteer, per AGENTS.md).** On a test profile, hand-create a standby pair in the worker window and test every risk above. Gate: if hidden tabs do not reach ready, consider the alternative of a separate hidden window with tab moves on promotion (the page stays loaded across a move, but there are more moving parts), or drop the idea.

**P3 — Registry and caps.** In-memory standby registry, total cap = preference, acting cap = 1, depth tunable defaulting to 0. Synthetic tests with fake tabs: standby opens while acting; promotion; pause closes standbys; throttle drops depth to 0; reaper honours the registry; restart clears; head change closes a standby.

**P4 — Hold-claim and promotion.** Worker answers "hold" for registered standbys, promotes the head, then pushes the claim. Order on switch: activate N+1, then close N.

**P5 — Observability.** Counters for preload hit (ready at promotion) and miss (promotion had to wait), standby discard reasons, and the handoff segments from P0. Use the existing metric helpers.

**P6 — Live rollout.** Depth 0, then 1, then the preference. Take a fresh baseline first. The 2026-10-09 baseline is too old to compare against.

Each shipped step follows AGENTS.md: bump the version before any build, and register new test files in both `npm test` and `tools/run-tests-parallel.js` (see [project_orphaned_test_files_2026_10_06]).

## Decisions for the owner

1. **Does the preference cap total tabs, including the acting one?** Recommended: yes. Otherwise it caps only loads ahead, and the acting tab is not counted.
2. **Default depth at launch.** Recommended: 0 until live data is in, then step up.
3. **Standby claim.** Recommended: hold until promotion. The alternative is to claim early and accept lease aging.
4. **Pause and erase.** Recommended: close standbys immediately. Erase is currently scoped to in-flight work only ([feedback_decisive_on_owner_clean_slate]), so standby tabs need an explicit decision.
5. **Quora request rate.** Accept bursts up to the preference, or cap preloads at 1 ahead regardless of the preference?

## Prerequisite status

The 2026-09-28 note says this restructure waits until single-tab reliability is solved ([project_worker_window_design_rationale]). The 2026-10-10 blocked-slot incident is the same family of problem and is not recorded as fixed. Standby tabs would make it worse, so P1 is a hard prerequisite.
