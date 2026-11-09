# JavaScript Codebase Review — Take 3

> **Status: HISTORICAL** (24 Oct 2026). Codex review take 3 (9 Oct). Superseded. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Review date: 2026-10-09  
Repository: `C:\\cygwin64\\home\\dbrower\\src\\mute-block-main`  
Committed HEAD: `e12c50c`; reviewed state includes the current uncommitted working tree (package version 1.6.1397).

## Scope

Read-only static review of the current JavaScript working tree, emphasizing the async/external-state migration and work performed around WAL reads, job completion, and the next executor handoff. This review rechecked take-two findings against the current code. No tests, builds, benchmarks, or browser sessions were run. Only the shared JavaScript source was reviewed; generated Chrome and Firefox copies were not independently audited.

## Findings

### [P2] Keyed row reads still fetch and scan the entire active WAL tail

**References:** `shared/js/walSnapshotStore.js:365-378`, `shared/js/walSnapshotStore.js:438-454`, `shared/js/sw.js:6727-6740`.

The new keyed path correctly verifies that the sharded checkpoint manifest matches the active metadata and decodes only the shard for the requested key. But `getKeyedRowReadKeys()` still requests every committed segment, and `projectKeyedRowFromStored()` walks every record in those segments to find matches. In `readCoordinatorQueueRowsFromMirror()`, that projection is repeated for each requested key, even when keys share a shard.

Consequently, a keyed lookup remains O(all active tail bytes) in I/O and O(all tail records) in CPU per key. This can become expensive on precisely the read paths intended to avoid full recovery. Prefer a single pass over the tail for a batch of requested keys, or maintain an index/compacted row delta that lets a keyed read avoid unrelated records.

### [P2] Combined dashboard recovery replays the same WAL twice and sorts all history on every refresh

**References:** `shared/js/sw.js:6176-6193`, `shared/js/sw.js:7324-7332`, `shared/js/sw.js:9838-9844`, `shared/js/sw.js:6169-6174`.

The combined dashboard loader reads the physical WAL once, then calls `recoverQueueFromWalStore()`. That helper invokes `recoverCoordinatorQueueFromWal()`, which calls `recoverProjectedState()` and replays the checkpoint plus tail. The loader then calls `recoverProjectedState()` again to obtain completed rows. Thus the single storage read still triggers two full decodes/replays and two state constructions per dashboard refresh.

It also materializes and sorts the entire completed map on each refresh, although the queue view and dashboard history generally display only bounded recent rows. The runs summary needs completed counts by run, but that can be computed during the one recovery pass without allocating and sorting a second unbounded row array. Have the recovery helper return the full projected state once, then derive the queue, run aggregates, and bounded display rows from that result.

### [P2] Completion cleanup still does global scans and sequential tab lookups before handoff

**References:** `shared/js/sw.js:29491-29522`, `shared/js/sw.js:29525-29584`, `shared/js/sw.js:30647`, `shared/js/sw.js:31172`, `shared/js/swCoordinatorJobMilestoneBookkeeping.js:233`.

Coalescing now limits unfiltered cleanup to one pass plus a trailing pass, which removes the earlier burst of overlapping full scans. However, ordinary completion call sites still call `closeTerminalOwnedProfileTabs()` without affected profile hrefs. Each pass recovers or reads the full queue, scans every queue row to build terminal hrefs, walks every owned-tab entry, and awaits tab lookup/close work one tab at a time. The global live-tab sweep and source-tab scan also run before the call completes.

This leaves completion-to-next-job latency proportional to total queue and owned-tab state, rather than the completed job's tabs. Pass affected hrefs/tab IDs from the terminal transition and process those directly; retain a separate periodic/global orphan sweep. Where multiple candidate tabs must be checked, perform independent tab lookups concurrently with a bounded limit.

### [P2] WAL append still performs a full recovery and integrity replay after every durable append

**References:** `shared/js/swCoordinatorQueueWal.js:345-374`, `shared/js/sw.js:7513-7515`, `shared/js/sw.js:7882-7883`.

The session mirror is now updated fire-and-forget after the durable write, so its get/set or rebuild no longer holds the append result open. That is a real improvement over take two. The remaining append verification still calls `recoverProjectedState(append.store, ...)` for every single-row and batch append. Recovery decodes and verifies every checkpoint shard, reconstructs the full state, sorts/replays the tail, and returns the authoritative queue and completed maps.

This makes a one-row completion write pay work proportional to retained queue/history state before the mutation can return and the executor can advance. If full replay is a deliberate integrity boundary, consider moving it to checkpoint/reconcile boundaries and validating the just-written record against the already-resident projection plus append identity/hash. Otherwise, record the reason this full recovery must remain synchronous on each ack and measure it separately from storage latency.

## Revalidated take-two items

- **Fixed:** keyed checkpoint projection now binds manifest id, sequence/epoch, creation time, state hash, and shard count to active metadata.
- **Fixed:** session mirror maintenance is fire-and-forget after storage acknowledgement.
- **Fixed:** legacy queue-view recovery is retired; startup removes the obsolete stored key.
- **Improved:** replay no longer deep-clones the full authority state for every WAL record. Private replay can copy each touched map area once and reuse it.
- **Improved:** terminal-close passes coalesce. The remaining work is the global scan/serial-tab work described above.
- **Changed but still costly:** the combined dashboard request now shares one disk read, but it still recovers the WAL twice and sorts the entire completed history.
- **Still present:** per-append full checkpoint/tail recovery.
- **Not carried forward:** take two's claim that every replay record still copies its full map area. `projectSnapshot()` now passes `ownedAreas` and `takeAreaForWrite()` reuses the private area after its first copy.

## Overall

The restructuring has closed meaningful correctness and handoff gaps: stale manifests fail closed, mirror writes no longer delay the durable mutation, the stale legacy view cannot resurrect authority, and replay has lower allocation cost. The remaining likely performance costs are concentrated in three places: keyed reads scan unrelated tail records, dashboard refresh performs two full in-memory recoveries plus an unbounded completed-history sort, and completion cleanup still performs global queue/tab work before the next job. Per-append full integrity recovery remains another potentially dominant cost on the mutation critical path.

This is a static review of the working tree as observed, not a statement about committed release contents. No source files were changed.

