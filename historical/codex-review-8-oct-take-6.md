# JavaScript Codebase Review — Take 6

> **Status: HISTORICAL** (24 Oct 2026). Codex review take 6 (9 Oct). Superseded. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Review date: 2026-10-09  
Repository: `C:\\cygwin64\\home\\dbrower\\src\\mute-block-main`  
Committed HEAD: `6b5bc5e` (`WAL reads, append verification, and tab cleanup`, v1.6.1400); working tree package version: 1.6.1402.

## Scope

Read-only static review of the current working tree, including the latest metrics-flush throttle, flight-recorder session snapshot, and activation-guard ordering changes. I rechecked the take-five findings and traced whether the new changes affect the queue handoff path. No tests, builds, benchmarks, or browser automation were run. The review follows `shared/js/`; generated Chrome and Firefox copies were not independently audited.

## Findings

### [P2] WAL appends still clone the full store and invalidate the resident tail index

**References:** `shared/js/walSnapshotStore.js:493-520`, `shared/js/walSnapshotStore.js:1058-1082`, `shared/js/sw.js:6611-6613`, `shared/js/sw.js:15062-15091`.

A resident keyed read can now avoid storage I/O and use a per-row tail index. However, each `appendWalRecordsToGeneration()` starts with `cloneJson(store)`, recreating the full WAL store and its `segments` array. The newly written store is then installed as the resident cache. Since `residentTailRowIndexes` is keyed by the segments array identity, the next keyed read rebuilds the index over every record in the active tail.

With keyed reads after successive appends, this repeats scans over longer and longer tails. The append itself also deep-clones all retained checkpoint and segment data for a small row mutation. This undermines the intended “index only new segments” behavior and can make per-job handoff cost grow with accumulated WAL history. Preserve the segment collection identity or carry/extend its index through append, and avoid serializing the whole WAL store for a one-segment append.

When resident reads cannot be used, the mirror/storage fallback still fetches and scans all active segments per requested key (`walSnapshotStore.js:366-385, 393-454`).

### [P2] Dashboard refresh still recovers the same WAL twice and sorts all completed rows

**References:** `shared/js/sw.js:6209-6228`, `shared/js/sw.js:7368-7376`, `shared/js/sw.js:9844-9850`, `shared/js/sw.js:6202-6207`.

`loadCoordinatorDashboardAuthoritySnapshot()` first calls `recoverQueueFromWalStore()`; that path calls `recoverCoordinatorQueueFromWal()` and performs a full `recoverProjectedState()`. The loader then runs `recoverProjectedState()` itself to get the completed area. One storage read still causes two checkpoint decodes, tail replays, and state reconstructions per dashboard refresh.

The second projection is converted to an array and fully sorted with an effectively unbounded limit. The run summary needs counts across all completed rows, but can aggregate these during the single recovery pass. Only the queue display needs a recent ordered subset. Return one recovered projection and derive aggregates and bounded display rows from it.

### [P2] Terminal archival still invokes full-WAL append verification

**References:** `shared/js/swCoordinatorQueueWal.js:355-399`, `shared/js/sw.js:7548`, `shared/js/sw.js:7916`, `shared/js/sw.js:9043-9050`.

The incremental verifier handles contiguous queue-only writes using the exact pre-append queue. It returns `null` for records outside the `queue` area, after which the verifier fully recovers the WAL. Archiving a terminal item writes a `completed`-area record, so the completion path still decodes the checkpoint and replays the tail before its durable mutation returns. This leaves a full-history operation on a job-completion boundary even though ordinary queue-only mutations are faster.

Extend the incremental check to the affected completed rows using a validated pre-append completed projection, or verify the queue and completed deltas without a whole-WAL recovery. Keep full recovery for cases where the base identity or sequence cannot be established.

### [P3] Completion cleanup is scoped by href, but still scans all owned-tab metadata and all Quora tabs

**References:** `shared/js/sw.js:29391-29412`, `shared/js/sw.js:29607-29636`, `shared/js/sw.js:29676-29696`, `shared/js/sw.js:29749-29753`.

The completion path now looks up queue rows by href instead of walking the whole queue, and checks each owned tab's recorded href before making an expensive browser tab lookup. That closes the largest queue-scan issue from take four.

A scoped pass still walks every owned-tab parent entry and child id to inspect the metadata, then `sweepTerminalProfileTabsByAuthority()` queries all `https://*.quora.com/*` tabs and groups them before selecting the completed hrefs. It is fire-and-forget from continuation, so it does not gate the next executor, but still overlaps that handoff with global metadata enumeration and a broad tabs query. A per-href owned-tab index and a narrower lookup for the completed hrefs would avoid this remaining work. The unscoped reconcile orphan sweep can continue to discover tabs that lost ownership.

### [P3] Metrics throttling can leave the final dirty batch unwritten indefinitely

**References:** `shared/js/sw.js:5480-5492`, `shared/js/sw.js:5512-5538`, `shared/js/sw.js:5551-5557`.

When the three-second interval has not elapsed, `scheduleQueueWakeupMetricsFlush()` returns without arranging a timer. The metrics remain dirty and are flushed only if another metric change or another explicit flush happens later. The same applies after a storage write failure: the catch marks metrics dirty, but the retry is event-driven. If the worker becomes idle or is evicted before another metric event, the final batch can be lost. The throttle reduces storage contention, but a trailing timer/alarm or suspend flush that bypasses the interval is needed to guarantee eventual persistence.

### [P3] Flight-recorder persistence advances its saved watermark before the session write succeeds

**References:** `shared/js/sw.js:5498-5510`, `shared/js/swSessionMemory.js:29-33`.

`persistFlightRecorderSnapshotThrottled()` assigns `flightRecorderSessionPersistedSeq` before calling `setSessionValue()`, whose result reports success or failure. The caller ignores that promise. If session storage rejects the write, the in-memory watermark still says this snapshot was persisted, so the same snapshot is not retried; with no later recorder event, it remains absent after a worker restart. Update the watermark only after a successful write, or retain a retryable dirty flag.

## Take-five recheck

- **Partially improved:** warm resident keyed reads avoid segment I/O and reuse an index between reads on the same segments array. Full-store cloning on append replaces that array, so the index is rebuilt across the full tail after appends. The cold mirror/storage fallback also still scans the tail.
- **Still present:** dashboard recovery and completed-row sorting costs.
- **Still present on terminal completion:** completed-area WAL records take the full append-verification fallback.
- **Improved:** completion cleanup now scopes queue-row lookup by href and skips unrelated browser tab lookups. It still enumerates all owned-tab metadata and all Quora tabs.
- **New:** the metrics throttle has no guaranteed trailing flush; flight-recorder watermark state can get ahead of storage.

## Latest activation-guard change

The activation guard is now claimed only after the profile-open reservation succeeds. If the guard is already held, the decision helper requeues the activation intent; the caller then releases its reservation and clears the opening-action key. I found no lost-intent path in this reordered branch. The change avoids holding a guard while waiting for a conflicting reservation.

This review describes the current working tree, including uncommitted v1.6.1402 edits. No source files were changed.

