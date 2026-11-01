# JavaScript Codebase Review — Take 4

> **Status: HISTORICAL** (24 Oct 2026). Codex review take 4 (9 Oct). Superseded. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Review date: 2026-10-09  
Repository: `C:\\cygwin64\\home\\dbrower\\src\\mute-block-main`  
Committed HEAD: `e12c50c`; reviewed state is the current uncommitted working tree (package version 1.6.1397).

## Scope

Read-only static re-review of the current JavaScript working tree, focused on the four performance findings from take three and the completion-to-next-job path. I traced the new incremental append verifier, keyed WAL reader, dashboard snapshot loader, and terminal tab cleanup call sites. No tests, builds, benchmarks, or browser automation were run. The review follows `shared/js/`; generated Chrome and Firefox copies were not independently audited.

## Findings

### [P2] Keyed reads still fetch and scan every active WAL segment

**References:** `shared/js/walSnapshotStore.js:365-378`, `shared/js/walSnapshotStore.js:438-454`, `shared/js/sw.js:6727-6740`, `shared/js/sw.js:15076-15091`.

Checkpoint identity validation is now present, but the keyed read still requests every committed segment in the active generation. It then walks every record in each segment to find records for the requested key. For a batch of requested rows, this scan and tail sort are repeated once per key; records for unrelated queue keys are still read from storage or session and parsed.

The selected checkpoint shard bounds checkpoint decoding, but it does not bound tail I/O or CPU. At a large active tail, action/final-open lookups can still cost O(tail bytes) in storage reads and O(tail records) per key. Batch the tail traversal across requested keys or introduce an index/compacted delta that avoids fetching unrelated records.

### [P2] Dashboard refresh still replays the WAL twice and sorts all completed history

**References:** `shared/js/sw.js:6176-6199`, `shared/js/sw.js:7324-7332`, `shared/js/sw.js:9838-9844`, `shared/js/sw.js:6169-6174`.

The dashboard loader calls `recoverQueueFromWalStore()`, which calls `recoverCoordinatorQueueFromWal()` and performs `recoverProjectedState()`. It then calls `recoverProjectedState()` again to obtain the completed map. The disk read is shared, but checkpoint decode, tail replay, and full-state construction still happen twice for each combined refresh.

The loader also converts the entire completed map to an array and sorts it, with `Number.MAX_SAFE_INTEGER` as the limit. The runs summary needs counts across all completed rows, but those counts can be aggregated from the one recovered state without sorting and retaining a second all-history array. The queue view can use a bounded recent list. Reuse one recovered projection and separate aggregation from display ordering.

### [P2] Completion archival still falls back to full-WAL verification on the mutation path

**References:** `shared/js/swCoordinatorQueueWal.js:392-434`, `shared/js/sw.js:7515`, `shared/js/sw.js:7883`, `shared/js/sw.js:9038-9050`, `shared/js/sw.js:6543`.

The new incremental verifier is a substantial improvement for queue-only appends: it applies the appended records to a copy of the pre-append queue and avoids reconstructing the checkpoint and tail. However, the fast path explicitly rejects any record whose area is not `queue`. Terminal archival writes a `completed`-area record as well as changing the live queue, so the common completion/archive mutation cannot use this fast path and falls back to `recoverProjectedState()` over the full checkpoint and tail before the mutation returns.

This leaves the expensive verification on the exact completion boundary of interest, even though ordinary queue-only mutations are improved. Consider validating the completed-area change incrementally too, using the pre-append completed projection, or otherwise ensuring terminal archive can verify both areas without full recovery. Retain the full path when the exact base cannot be established.

### [P2] Terminal cleanup remains global work concurrent with executor handoff

**References:** `shared/js/sw.js:29491-29504`, `shared/js/sw.js:29525-29584`, `shared/js/sw.js:30647`, `shared/js/sw.js:31172`, `shared/js/swCoordinatorJobMilestoneBookkeeping.js:233`.

The coalescer prevents an unbounded pileup of global cleanup passes. Normal continuation and terminal-progress call sites still invoke cleanup without affected profile hrefs, so the pass reads or recovers the full queue, scans all queue entries, walks all owned-tab entries, and performs tab lookups sequentially. It then sweeps live tabs and source tabs. The close calls in the continuation paths are fire-and-forget, so they do not directly await/block the next executor job; they do overlap it and compete for service-worker time and browser/storage I/O. The cleanup option in `getOwnedNukeStatus()` also awaits this same global pass.

Pass the just-completed hrefs and tab ids into completion cleanup and process those directly. Keep a separately scheduled global sweep for orphan discovery. If the current global behavior is required for correctness, separate its cadence from the immediate next-job path.

## Take-three items rechecked

- **Improved:** queue-only append verification now avoids a full WAL replay when it has a contiguous append and an exact pre-append queue/sequence base.
- **Still present on terminal archive:** completed-area records force the verifier's full-recovery fallback.
- **Still present:** keyed row reads request and scan every active segment for every requested key.
- **Still present:** dashboard refresh recovers the WAL twice and sorts the full completed map.
- **Still present, with handoff nuance:** terminal cleanup coalesces, but it still performs global sequential work; continuation callers launch it without awaiting, so it competes with rather than directly gates the next executor.

## Overall

The latest changes close part of the append-verification cost, specifically for contiguous queue-only writes. The primary job-completion path remains expensive because archive writes include completed-history records and trigger full recovery. The other substantial costs remain in keyed tail reads, duplicate dashboard recovery/history sorting, and global terminal cleanup overlapping the next executor.

This describes the uncommitted working tree as observed, not only committed HEAD. No source files were changed.

