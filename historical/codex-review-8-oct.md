# JavaScript Codebase Review — 8 Oct

> **Status: HISTORICAL** (24 Oct 2026). Codex review of 8 Oct, the first of the series. Superseded by the later takes. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Review date: 2026-10-09  
Repository: `C:\cygwin64\home\dbrower\src\mute-block-main`  
Reviewed baseline: `e12c50c` (`main`, Chrome/Firefox manifests at `1.6.1388`)

## Scope and method

This is a read-only static review of the production runtime under `shared/js/`, with targeted call-path and test inspection for queue persistence, executor scheduling, dashboard refresh, and content-script actions. I also read the architecture guidance, recent handoff, package scripts, and manifests. The runtime tree contains 86 JavaScript files; `sw.js` is about 34,600 lines and `content.js` about 13,900 lines.

I did not run tests, builds, browser automation, or lint commands. The checkout has many pre-existing untracked diagnostic and scratch files; they were left untouched. One-off CDP/debug scripts were not exhaustively audited. The performance findings below are code-path and complexity findings, not new benchmark measurements. A full replay, exhaustive scan, or fresh derivation may be an intentional correctness/durability choice. The findings identify costs to measure, not recommendations to weaken those invariants.

## Findings

### [P2] WAL append re-verifies the full checkpoint after every write

**References:** `shared/js/sw.js:7450-7452`, `shared/js/sw.js:7818-7820`, `shared/js/swCoordinatorQueueWal.js:345-346`, `shared/js/walSnapshotStore.js:249-285`, `shared/js/walSnapshotStore.js:287-299`, `shared/js/walSnapshotStore.js:655-665`, `shared/js/walSnapshotStore.js:879-887`.

Both single-row and batch append paths call `verifyAppendedCoordinatorQueueWalReplay()` after saving the WAL. That helper calls `recoverProjectedState()` on the entire resulting store. Recovery verifies the active checkpoint by decoding it, synchronously gunzipping its payload, parsing JSON, hashing the decoded state, cloning it, then replaying the active generation’s records. The checkpoint is the full queue snapshot, so append verification cost grows with total durable queue state even though the append itself contains only one or a few changed rows. The soft checkpoint threshold bounds the WAL tail, but it does not bound checkpoint decompression, JSON parsing, hashing, or copying.

This work sits on the service worker’s serialized authority-write path. It is paid for every durable append, including frequent per-row progress/lease activity. The repository’s 2026-10-08 handoff records that the checkpoint had been about 9.7 MB each before gzip and that gzip reduced storage footprint from about 28 MB to 12.4 MB. Compression helps storage I/O and quota, but the current verifier still synchronously expands and hashes the full snapshot on each append, which can occupy the worker’s event loop and delay browser API work as state grows.

**Architectural distinction:** validating that a write is durable and replayable is a sound invariant. Re-decoding, hashing, cloning, and replaying the unchanged checkpoint after every small append may be redundant work rather than a requirement of that invariant. The likely issue is the verification strategy's granularity, not its fail-closed goal. Confirm this against the intended write protocol, then measure the components. A revision-bound incremental validation path could preserve append acceptance checks while avoiding repeated checkpoint work, with full replay retained at hydration and checkpoint boundaries.

### [P2] Lease heartbeats schedule redundant queue-view rebuilds

**References:** `shared/js/sw.js:25995-26042`, `shared/js/sw.js:7490-7505`, `shared/js/sw.js:7600-7610`, `shared/js/swCoordinatorQueueView.js:460-539`.

`mutateCoordinatorActionLeaseHeartbeat()` is called on the five-second heartbeat cadence while a queued action is active. It requests deferred queue-view projection, which avoids doing the view work before the storage write returns, but the deferred branch still clones the complete recovered queue immediately and schedules a timer for that individual mutation. The timer then calls `buildCoordinatorQueueView()`, which walks the queue, sorts every entry, maps every item, and currently returns all items (`itemLimit: items.length`, `truncated: false`). There is no coalescing at this branch: concurrent active rows can each enqueue their own clone and full sort every heartbeat period.

Deferring this work moves it off the mutation’s await chain but does not reduce the amount of work. At larger queue sizes or higher tab concurrency, heartbeat traffic can therefore create repeated O(queue size) copies plus O(queue size × log(queue size)) sorts and dashboard broadcasts, competing for the same single-threaded service-worker event loop as the actual work.

**Architectural distinction:** publishing a fresh derived view is useful; separately cloning and sorting the same queue for every heartbeat appears to be avoidable projection work. Coalesce refresh requests by authority revision and build from the newest state once. Preserve visible lease/freshness fields and guarantee that a later terminal state cannot be hidden by an older projection.

### [P2] Dashboard queue and runs requests independently reconstruct the same history

**References:** `shared/js/coordinator.js:69`, `shared/js/coordinator.js:444-447`, `shared/js/coordinator.js:756-799`, `shared/js/coordinator.js:808-842`, `shared/js/sw.js:6151-6192`, `shared/js/sw.js:6236-6255`, `shared/js/sw.js:9816-9830`, `shared/js/swCoordinatorQueueView.js:460-539`.

While Current Work is active, the dashboard polls every two seconds. Each `loadState()` sequentially requests a fresh queue view and a fresh runs view. Both service-worker paths independently load/recover queue authority and independently call `getRecentCompletedWorkRows(Number.MAX_SAFE_INTEGER)`. That completed-work helper loads the WAL again, recovers the checkpoint and tail, materializes all completed rows, and sorts the entire collection before returning it. Thus one active-dashboard poll performs repeated WAL reconstruction and two full-history sorts, then the queue-view builder sorts all displayed rows as well. The view currently has no row cap (`truncated: false`).

This cost scales with completed history, not only the active queue. It repeats every two seconds while a queue is active even if the queue has made no progress, and the queue/runs requests duplicate much of the same authority and completed-log work.

**Architectural distinction:** deriving counts from complete history can be necessary for correctness. The apparent mismatch is doing that recovery and sort independently for queue and runs, then repeating both again on the next poll even when authority has not changed. A combined dashboard snapshot should derive both views from one recovered authority revision. Reuse it only while that exact revision remains current; continue aggregating over complete history, and bound only the rendered row window if desired.

### [P2] Exhausted-retry discovery bypasses the executor scan budget

**References:** `shared/js/sw.js:17291-17300`, `shared/js/sw.js:17580-17602`, `shared/js/sw.js:12883-12925`.

`runCoordinatorExecutorApplyPhase()` now bounds its main queued-row pass to `COORDINATOR_RECONCILE_ACTION_BUDGET` (25), but immediately before it dispatches `EXHAUSTED_ROLLBACK_SETTLE` with `Object.values(currentAuthorityState.queue)`. `settleExhaustedRolledBackQueuedCoordinatorItemsForExecutor()` scans the entire array and builds complete `recoverable` and `terminalizable` arrays; the 25-row limit is applied only after that scan. Therefore every executor-apply pass still incurs O(queue size) allocation and classification before reaching the bounded main pass. Since the fast executor is invoked by multiple resume/reconcile triggers, this can repeat frequently during large runs.

The current code comments document the value of scan budgets elsewhere, and the recent handoff records a previous full-queue scan as a live source of service-worker event-loop starvation. This pre-pass is a remaining full scan in the same hot phase; its real cost depends on how often exhausted rollback rows are present, but the array construction and full traversal happen regardless.

**Architectural distinction:** eventual exhaustive discovery may be required, but the pre-pass currently does all discovery synchronously before the budgeted pass. That defeats the apparent purpose of the pass budget and resembles the prior event-loop starvation pattern noted in the handoff. Move exhaustive coverage across bounded resumable ticks or use a recoverable eligibility index; preserve fairness, restart behavior, and eventual discovery.

### [P2] A failed-to-verify unmute can be persisted as a successful reverse action

**References:** `shared/js/content.js:13015-13060`, `shared/js/content.js:13128-13147`, `shared/js/content.js:12018`, `shared/js/jobState.js:137-148`.

`unmuteProfileBestEffort()` returns `{ok: true, reason: 'unmute-clicked-unverified'}` after its post-click menu-state check fails. `unblockUnmuteProfile()` accepts that result and returns success as long as the profile is unblocked; it does not require the unmute itself to be verified. In the queued path, the caller then records `unblockSucceeded: true` and a terminal `unblocked`/`already-unblocked` status. `isSuccessfulUnblockUnmuteRecord()` treats `unblockSucceeded` or those statuses as sufficient and exits before checking `unmuteOk`.

As a result, a profile that was successfully unblocked but remains muted can be reported as a completed reverse action and removed from retry consideration.

**Suggested direction:** distinguish “click dispatched” from “unmute verified”; return a non-success result for `unmute-clicked-unverified`, and make terminal success require both unblock and unmute outcomes (except for an explicitly modeled already-unmuted state). Add a regression test for the path where unblock verifies but the unmute state remains unchanged.

### [P2] Unmute confirmation selection can escape the active action surface

**References:** `shared/js/content.js:12295-12302`, `shared/js/content.js:12382-12410`, `shared/js/content.js:12416-12456`, `shared/js/content.js:12526-12536`.

`getUnmuteConfirmAction()` searches dialog candidates collected from the whole document, then falls back to `getInPageConfirmPairAction()`, which scans every visible button, role-button, and link and ranks candidates by nearby text. Selection and activation check that a candidate represents an unmute confirmation, but do not tie it to the confirmation surface or profile opened by the current action.

On a page with another visible unmute control or confirmation surface, the fallback can select and activate that unrelated control while processing the current profile. Existing selector tests cover a single confirmation surface and inverse action labels, but not competing unrelated surfaces.

**Suggested direction:** keep confirmation lookup inside the modal/dialog or profile action surface opened by the current click, and require target/profile identity where Quora exposes it. Add a test with an unrelated unmute surface present alongside the intended confirmation.

## Architectural intent and likely drift

The review distinguishes required guarantees from how often their supporting work is performed:

- Persisted queue authority is verified by replay before acceptance. Any optimization must preserve the same fail-closed behavior across restart, partial writes, and checkpoint changes.
- Dashboard counts and completed-work summaries are derived from complete persisted history. Keep full-source aggregation and tie any cache to an exact authority revision with complete invalidation.
- Executor recovery discovers all eligible work over repeated passes. A smaller per-pass budget is safe only with durable or reconstructible continuation and fairness guarantees.
- Queue-view work is advisory projection. Coalescing can reduce duplicate work if the projection always catches up to the newest authority state and never drives execution.

The likely architectural mismatch is redundant work around legitimate guarantees: replaying unchanged checkpoint data per append, rebuilding identical projections for each heartbeat, independently reconstructing the same dashboard history, and doing an unbudgeted recovery scan before a budgeted pass. These are review hypotheses based on code paths and architecture notes, not measured regressions. Confirm intended cadence and latency budgets with maintainers, then measure; preserve fail-closed validation, complete-history counts, and eventual recovery.
## Cross-cutting observations

- The two largest runtime files remain unusually large: the service worker is about 34,600 lines and the content script about 13,900 lines. The extracted modules provide useful seams, but hot orchestration and cross-module state invariants still require broad call-path tracing.
- Queue size is not consistently bounded at read-model boundaries. The executor’s dispatch scan has a 25-row budget, while the completed-work log and dashboard view intentionally materialize and sort all historical rows. Consider separating aggregate counts from the bounded row window shown in the UI.
- Existing comments and handoff notes include historical findings. I compared those against HEAD and did not report issues that the current implementation appears to have addressed.

## Summary

The strongest suspected architectural mismatches are repeated full-checkpoint verification per WAL append, duplicate queue-view derivation, and an unbudgeted executor recovery scan. The migration audit also found a legacy queue-view recovery path that can still consume stale persisted data, high-frequency run-summary paths that bypass the serialized fresh-read updater, and repeated unfiltered tab-cleanup scans at terminal handoff. Two P2 correctness issues affect reverse actions. Findings are static and unbenchmarked; source code was not changed, and no tests or builds were run.

## Async / external-state migration audit

This pass compared the current runtime with `architecture.md`, the 2026-10-08 handoff, and the migration notes. It focused on mismatched ownership, stale fallback paths, and partially migrated state updates. These findings are static; no tests or live browser checks were run.

### [P2] WAL recovery still accepts the retired queue-view key as a recovery source

**References:** `shared/js/sw.js:6129-6149`, `shared/js/sw.js:6734-6779`, `shared/js/sw.js:6890-6919`; `architecture.md:85-90`, `architecture.md:319-326`.

The current code says `mbCoordinatorQueueView` is no longer persisted and documents the old recovery from it as an always-no-op path. But a WAL hydrate failure still calls `attemptCoordinatorQueueWalAutoRecoveryFromView()`, which reads `COORDINATOR_QUEUE_VIEW_KEY` from storage and accepts any nonempty view whose reconstructed row count matches. Removing the writer does not remove the key from existing users' `storage.local`; no cleanup/removal of that key appears in the runtime call sites. Therefore this branch is not guaranteed to be a no-op: an older persisted view can be consumed after a later WAL failure. Its row-count check proves shape/count, not freshness relative to the WAL or that the rows reflect the last committed authority revision. This can restore stale statuses or resurrect rows that had since become terminal.

This is a migration dead-end: the active design says queue view is ephemeral, yet a legacy copy remains a fallback authority during corruption handling. Either remove/quarantine the old key and retire this branch, or explicitly version and validate a recoverable snapshot against authority sequence/generation before using it. The current comments and metrics imply the fallback is unavailable, while the code still conditionally trusts it.

### [P2] Central progress paths bypass the serialized fresh-read runs update

**References:** `shared/js/sw.js:10240-10385` (`coordinatorRunsUpdateLock` / `applyCoordinatorRunsUpdate`), `shared/js/sw.js:32166-32212`, `shared/js/sw.js:32741-32825`.

The code has a dedicated serialized runs-update helper that reloads the latest runs map under `coordinatorRunsUpdateLock`, recomputes against that fresh base, and saves once. However, both central progress recording paths explicitly do not use it: `applyCoordinatorRowEvents()` and `recordCoordinatorJobProgressRecords()` recompute from their local `runs` snapshot and then issue a separate `saveCoordinatorState()` write. The nearby comments explain this was left in place because adding an extra storage round trip changed hot-path test outcomes, but this leaves two update models for the same derived state: serialized fresh-read updates in one set of callers, and caller-snapshot replacement in the high-frequency progress callers.

The risk is a lost update when overlapping progress operations for the same or different runs derive from stale snapshots and the later save replaces the earlier map. Queue authority may be correct in WAL while the runs projection lags or loses counts/status until a later recompute. The write queue serializes writes, but by itself does not make an earlier read-modify-write atomic. Treat this as an unresolved race risk rather than a proven current incident; convergence needs a batching/lock design that preserves the existing progress-path latency constraints.

### [P2] Executor's stated scan budget does not bound exhausted-retry discovery

**References:** `shared/js/sw.js:17291-17300`, `shared/js/sw.js:17580-17602`, `shared/js/sw.js:12883-12925`; `handoff-2026-10-08.md` executor-apply scan-bound item.

The handoff describes the executor apply scan as bounded to 25 queued rows, but each pass first sends the entire queue through exhausted-rollback settlement. That helper scans every row and builds candidate arrays before applying its own limit. Thus the migration to bounded executor work has a second, unbounded discovery path ahead of the budgeted loop. This undermines the intended event-loop fairness, even though ordinary scans are capped. Preserve eventual discovery, but continue it across bounded resumable ticks or use a complete eligibility index.

### [P3] The expired-action-lease cleanup helper is orphaned

**References:** `shared/js/sw.js:1135`, `shared/js/swQueuedTabMetadataAndActionLease.js:233-258`, `shared/js/swQueuedTabMetadataAndActionLease.js:331`.

`clearExpiredCoordinatorActionLeases` is imported into `sw.js` and returned by its module factory, but there are no call sites in the JavaScript tree. The helper therefore cannot perform the cleanup its name suggests. This may be intentional if lease expiry was superseded by heartbeat/reconciliation logic; if so, remove the obsolete export/import and clarify the replacement. If expiration is still part of the async lease contract, the current implementation is a dead path and needs a caller. Do not infer a runtime leak solely from this orphaned helper without checking the replacement policy.

### Migration notes that no longer match the implementation

`architecture.md` still says the content script's `mbProfileNukeProgress` writer is “Not yet done” and describes `mbCoordinatorQueueView` as a separately persisted third queue representation. Current `content.js` routes active queued progress through `record-job-milestone` / `record-job-terminal`, while the service worker explicitly says the queue-view disk copy was removed on 2026-10-01. The architecture file should be updated so future work does not re-open already-retired paths as if they were current defects. The remaining issue is the WAL recovery fallback above, which still reads a legacy persisted view if one exists.

The shared reducer is also not yet the sole decision core: the architecture itself tracks block-confirmation classification outside `reduceJobEvent` and multiple exhausted-retry approval branches (`architecture.md` known fragmentation points 1 and 3). These are acknowledged migration exceptions, not newly discovered bugs, but they remain separate decision implementations that can drift. Converge them through reducer events or keep the exception list and tests synchronized with each change.


## Completion-to-next-job I/O and scan audit

### [P2] Terminal progress invokes an unfiltered tab-close scan once per row, before coalescing

**References:** `shared/js/sw.js:32676-32682`, `shared/js/sw.js:32865-32871`; `shared/js/swCoordinatorJobMilestoneBookkeeping.js:226-259`; `shared/js/sw.js:29241-29315`.

When a terminal progress row is durably applied, `recordCoordinatorJobProgressRecords()` calls `scheduleTerminalProgressContinuation()` inside its per-row loop. After the storage update returns, the same function calls it again when the batch result is terminal. A multi-row terminal batch therefore invokes the continuation repeatedly, plus once more at batch completion.

Each invocation immediately schedules another queue-work continuation and resume alarm, then calls `closeTerminalOwnedProfileTabs()` with no profile filter. That function scans the entire resident queue for terminal rows, then walks the owned-tab entries and performs tab lookups sequentially. The fast-executor promise is coalesced only *after* those scheduling calls and the tab-close scan have already been launched, so its in-flight guard does not prevent the repeated I/O or O(queue + owned tabs) scans. The first invocation can also run while the surrounding serialized storage update is still active.

This work occurs at the handoff boundary: a durable terminal transition is already available, and the next job can be scheduled, but repeated whole-queue cleanup and sequential browser-tab checks compete with its executor for service-worker time. Collect affected terminal hrefs during the batch and schedule one post-commit continuation; scope cleanup to those hrefs and coalesce tab-close work independently of the executor promise. Preserve cleanup for orphaned owned tabs through a separate bounded reconciliation pass.

The same completion path also schedules terminal archival after a 250 ms delay; when it succeeds, `scheduleTerminalProgressSettlement()` requests another fast-executor pass with `forceDurableQueueReload: true` and also schedules a one-second resume. That may be a useful recovery fallback, but it overlaps the earlier continuation. Measure whether the first continuation already started the next durable row before retaining the forced reload/pass; if the settlement is required first, prefer one ordered post-settlement continuation.

