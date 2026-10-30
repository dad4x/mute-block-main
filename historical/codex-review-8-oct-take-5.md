# JavaScript Codebase Review — Take 5

> **Status: HISTORICAL** (24 Oct 2026). Codex review take 5 (9 Oct). Superseded. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Review date: 2026-10-09  
Repository: `C:\\cygwin64\\home\\dbrower\\src\\mute-block-main`  
Committed HEAD: `e12c50c`; reviewed state is the current uncommitted working tree.

## Scope

Read-only static review of the latest working tree, rechecking the take-four findings and the newly added resident keyed-row index and scoped terminal cleanup. Focus remains on large I/O and in-memory work near completion and the next job. No tests, builds, benchmarks, or browser automation were run. The review follows `shared/js/`; generated Chrome and Firefox copies were not independently audited.

## Findings

### [P2] WAL append cloning invalidates the resident tail index, causing repeated full-tail scans

**References:** `shared/js/walSnapshotStore.js:510-536`, `shared/js/walSnapshotStore.js:1058-1082`, `shared/js/sw.js:6611-6613`, `shared/js/sw.js:15062-15091`.

The resident keyed path is a real improvement: on a fresh resident store, it decodes and verifies a shard once, then finds matching tail records through a row index instead of reading/parsing all segments for every lookup. But the index is held in a `WeakMap` keyed by the segments array identity. `appendWalRecordsToGeneration()` starts each append with `cloneJson(store)`, which recreates the entire resident store and its segments array; the successful write then installs that new store as the resident cache.

The next keyed lookup therefore sees a new array identity and `extendResidentTailRowIndex()` rebuilds its index from every record in every committed segment. If a keyed read follows each append, the index work accumulates as 1+2+…+N segment scans over a generation, rather than indexing only newly appended segments. The append itself also deep-clones the existing store before adding its small new segment. This shifts the old keyed-read scan into repeated in-memory work around writes and subsequent reads. Preserve an append-stable index/segments identity or incrementally extend the cached index as part of the append.

When the resident store is unavailable or fails its freshness check, the mirror/storage fallback still reads all committed segments and scans them for each requested key (`getKeyedRowReadKeys()` and `projectKeyedRowFromStored()`, lines 366-385 and 438-454).

### [P2] Dashboard still performs two complete WAL recoveries and an unbounded completed-row sort

**References:** `shared/js/sw.js:6181-6204`, `shared/js/sw.js:7329-7340`, `shared/js/sw.js:9844-9849`, `shared/js/sw.js:6174-6178`.

The combined dashboard loader calls `recoverQueueFromWalStore()`, whose `recoverCoordinatorQueueFromWal()` call performs `recoverProjectedState()`. The loader then invokes `recoverProjectedState()` a second time for the completed map. The storage read is shared, but checkpoint decoding, tail replay, and projection construction remain duplicated on every dashboard refresh.

After the second recovery, `sortCompletedWorkRowsNewestFirst()` materializes and sorts the entire completed map with an effectively unbounded limit. The run summary needs data across all completed rows, but it can aggregate those rows during the single recovery pass without sorting and retaining a second all-history array. The queue view can consume only the bounded recent rows it displays.

### [P2] Terminal archival still takes the full-recovery fallback in append verification

**References:** `shared/js/swCoordinatorQueueWal.js:355-399`, `shared/js/swCoordinatorQueueWal.js:392-410`, `shared/js/sw.js:7520`, `shared/js/sw.js:7888`, `shared/js/sw.js:9043-9050`.

Incremental verification now handles contiguous queue-only appends against the exact pre-append queue and sequence. It deliberately returns `null` when any appended record is outside the `queue` area; the verifier then calls `recoverProjectedState()` over the full checkpoint and WAL tail. Terminal archival writes a `completed`-area record, so it cannot use the new fast path. A terminal job can still pay full checkpoint decode and replay before its durable mutation returns.

Extend the incremental verifier to validate the completed-area mutation against an exact pre-append completed projection, or use a narrowly-scoped verification for both affected rows. Keep full recovery as the fallback when the base sequence/projection is uncertain.

### [P3] Scoped completion cleanup still walks all owned-tab metadata and queries all Quora tabs

**References:** `shared/js/sw.js:29579-29606`, `shared/js/sw.js:29652-29690`, `shared/js/sw.js:29363-29382`, `shared/js/sw.js:29721-29724`.

Completion cleanup now receives affected profile hrefs and avoids scanning every queue row: it indexes directly into `queue[href]`. It also checks recorded tab metadata before fetching a child tab, so unrelated tabs avoid the expensive per-tab browser lookup. Those changes address the global queue scan and most unrelated tab I/O.

Two broad scans remain on each scoped completion pass. It still walks every owner entry and owned tab id to find matching metadata, and `sweepTerminalProfileTabsByAuthority()` calls `getLiveProfileTabsByHref()`, which queries all `https://*.quora.com/*` tabs and groups them before selecting the affected hrefs. The cleanup is fire-and-forget on job continuation, so it does not directly block the next executor, but this work overlaps the handoff and competes for worker and browser time. A per-href owned-tab index and a narrower tab query (or a throttled orphan sweep for tabs that have lost ownership) would make the completion pass proportional to the completed job.

## Take-four items rechecked

- **Improved:** resident keyed reads now use a per-row index and cached verified shard state; warm reads avoid segment storage I/O. The index currently loses its identity after every append because the append clones the whole store, as described above.
- **Still present:** the fallback keyed read fetches and scans all active segments, once per requested key.
- **Still present:** dashboard recovery is duplicated and completed rows are fully materialized and sorted each refresh.
- **Partially addressed:** terminal cleanup is now href-scoped for queue rows and avoids browser lookups for unrelated owned tabs. It still scans all owned-tab metadata and all Quora tabs, asynchronously alongside the next job.
- **Still present on terminal archive:** incremental append verification rejects completed-area records and falls back to full recovery.

## Overall

This round improves the warm keyed-read and per-completion cleanup paths. The largest newly visible issue is index lifetime: a deep-cloned WAL store means the “incremental” resident index is rebuilt from the whole tail after each append, and the append itself clones all stored WAL data. Dashboard refresh still repeats recovery and sorts all completed history; terminal archival still triggers full verification recovery. Completion cleanup is narrower, though its remaining global browser/owned-tab discovery runs concurrently with the handoff.

This describes the current uncommitted working tree, not only committed HEAD. No source files were changed.

