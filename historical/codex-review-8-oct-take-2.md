# JavaScript Codebase Review — Take 2

> **Status: HISTORICAL** (24 Oct 2026). Codex review take 2 (9 Oct). Superseded. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Review date: 2026-10-09  
Repository: `C:\cygwin64\home\dbrower\src\mute-block-main`  
Committed HEAD: `e12c50c` (`main`, v1.6.1388)  
Reviewed state: the working tree at review time, including substantial uncommitted source changes targeting v1.6.1397.

## Scope and method

This is a read-only static review of the current working tree, with emphasis on the newly restructured WAL/checkpoint read paths, session mirror, dashboard snapshot, and completion-to-next-job path. The source is dirty; findings refer to the working tree and may not exist in committed HEAD. I did not run tests, builds, benchmarks, or browser automation. Generated Chrome/Firefox copies were not independently audited; the review follows `shared/js/` as the source.

The current edits add sharded checkpoints and keyed row projection, a `storage.session` queue mirror, one combined dashboard message, terminal-tab-close pass coalescing/instrumentation, and a correction to unverified unmute success. The prior unmute false-success finding is fixed in the current working tree. The prior duplicate dashboard request and unbounded concurrent terminal-close scan are improved, though some repeated work remains below.

## Findings

### [P2] Keyed reads do not bind the checkpoint manifest to active metadata

**References:** `shared/js/walSnapshotStore.js:381-414`, `shared/js/walSnapshotStore.js:662-673`, `shared/js/sw.js:15196-15247`.

`projectKeyedRowFromStored()` chooses the active checkpoint id from WAL metadata, loads that slot's manifest, and verifies the requested shard against the hash stored in that same manifest. It does not verify that `manifest.id`, `manifest.snapshotSeq`, `manifest.stateHash`, or `manifest.shardCount` match `meta.checkpoints[active]`. A stale or mixed manifest plus its matching shard can therefore pass the keyed check even when the active metadata describes a different checkpoint. The full recovery path verifies the reconstructed whole-state hash; this keyed path verifies only the selected shard against the manifest it read.

This matters because keyed reads now feed authority decisions such as final-open confirmation. On a torn or stale multi-key checkpoint read, the row may be projected from an older base and omit records already incorporated into the active checkpoint. Fail closed to the full WAL read unless the manifest is explicitly bound to the active metadata identity (including the checkpoint id, snapshot sequence, shard count, and state hash).

### [P2] A keyed row read still reads and scans every active WAL segment

**References:** `shared/js/walSnapshotStore.js:365-378`, `shared/js/walSnapshotStore.js:422-443`, `shared/js/sw.js:6690-6732`, `shared/js/sw.js:15196-15247`.

The new path avoids reading every checkpoint shard, but `getKeyedRowReadKeys()` still requests every committed segment in the active generation for each key. `projectKeyedRowFromStored()` then parses and walks every record in every segment to retain records for that one `(area, key)`. When a request contains multiple keys, the outer loop repeats the segment traversal and sorting for each key; keys sharing a shard also decode/hash that shard repeatedly.

So this is a checkpoint-read reduction, not an indexed WAL-row read. At a large active tail, each final-open or other keyed lookup still incurs O(all tail bytes) storage/session I/O and O(all tail records) work per key. The comments describing “only the shard and matching records” overstate what the implementation fetches: the records are filtered after all segments have been read. Measure this by requested-key count and committed-segment count; a per-key tail index or one-pass batch projection would be needed to bound the work by matching records.

### [P2] WAL append still fully decodes and replays the checkpoint, then awaits a mirror write

**References:** `shared/js/sw.js:7639-7657`, `shared/js/sw.js:8004-8025`, `shared/js/sw.js:6653-6680`, `shared/js/walSnapshotStore.js:261-288`, `shared/js/swCoordinatorQueueWal.js:345-365`.

The integrity check remains on both ordinary and batch append paths: after the durable storage write, `verifyAppendedCoordinatorQueueWalReplay()` recovers the whole resulting state. With sharded checkpoints, that recovery still decodes and hashes every shard, merges the full state, and replays the tail. Sharding helps a keyed read; it does not make per-append verification incremental.

Before that verification and before returning the mutation result, both append paths also await `mirrorCoordinatorQueueWalAfterAck()`. A normal mirror advance performs a `storage.session.get()` and `storage.session.set()` for each append. A non-plannable append can rebuild the whole mirror by reading all active WAL keys from `storage.local`, then writing them to session storage. The mirror is a cache, but its update is on the acknowledged mutation's critical path. The fail-closed replay invariant may be intentional; the extra full recovery and awaited cache-maintenance work are separate costs. Profile them independently and consider letting mirror maintenance lag behind the authority ack, since stale mirrors already fail their freshness check and fall back to disk.

### [P2] WAL replay still copies the entire changed map area for every record

**References:** `shared/js/walSnapshotStore.js:1148-1195`.

The replay change correctly replaces a deep clone of the whole state with a shallow root copy. However, every map record still executes `const map = {...normalizeObject(nextState[area])}` before changing one key. Thus replaying N records in a large `queue` or `completed` area still copies that entire area N times. With a long completed-work log, cost remains proportional to `WAL records × area rows`, despite the new comment describing copy-on-write of only the touched row.

This is a meaningful improvement over deep-cloning all state areas, but the hot area-level copy can still dominate large-history replay and append verification. A persistent map, mutable private replay accumulator, or batch reducer that clones each area once per replay would be needed to avoid that repeated full-map allocation while preserving isolation at the public boundary.

### [P2] The combined dashboard request still reconstructs the WAL twice

**References:** `shared/js/coordinator.js:808-842`, `shared/js/sw.js:6173-6189`, `shared/js/sw.js:10048-10063`, `shared/js/sw.js:6279-6296`.

The dashboard now sends one combined request, which removes the old separate queue-view and runs-view messages. Inside the shared snapshot loader, though, `coordinatorQueueReader.full()` loads/projects queue authority and `getRecentCompletedWorkRows(Number.MAX_SAFE_INTEGER)` independently reloads the WAL and calls `recoverProjectedState()` again. Both the queue view and fresh runs summary need the completed rows, but the first full projection result is not reused for that history.

This leaves two complete WAL reconstructions and two completed-map materializations/sorts per dashboard refresh, even though the new API/comment says it shares one recovered authority snapshot. Return completed rows from the same recovered store used by `coordinatorQueueReader.full()`, or expose one snapshot loader that returns both queue and completed areas. The combined message is a useful restructuring, but it has not yet removed the largest duplicated read inside the service worker.

### [P2] Terminal tab cleanup is coalesced, but each pass still scans globally

**References:** `shared/js/swCoordinatorJobMilestoneBookkeeping.js:226-259`, `shared/js/sw.js:29636-29667`, `shared/js/sw.js:29670-29755`, `shared/js/sw.js:32676-32871`.

The prior issue of launching an unbounded number of overlapping terminal-close passes is improved: `closeTerminalOwnedProfileTabs()` now allows one shared pass and at most one trailing pass while it is in flight. The continuation still calls it without the completed profile href, so even a single-job completion scans the entire queue for terminal rows, walks all owned-tab entries, and checks candidate tabs sequentially. Repeated completion calls during that pass can still force a trailing global scan.

At the job handoff, this remains avoidable work competing with the next executor pass. Accumulate affected hrefs/tab ids from the terminal transitions and coalesce cleanup against that set. Keep a separate bounded global sweep for orphan cleanup, rather than making every completion perform it.

### [P2] Legacy queue-view recovery remains reachable after the view writer was removed

**References:** `shared/js/sw.js:6129-6149`, `shared/js/sw.js:6734-6779`, `shared/js/sw.js:6890-6919`.

The current code says the disk queue view was removed and describes recovery from it as always returning `view-empty`. Yet a WAL hydration failure still reads the old key and accepts a nonempty view if its reconstructed row count matches. Existing installs may retain the old key because removing the writer does not delete stored values. The fallback is therefore conditional, not guaranteed dead code, and it validates row count rather than snapshot freshness. This still risks rebuilding authority from a stale pre-migration view after a WAL failure. Remove/quarantine the old key or bind any recovery snapshot to a verified WAL generation/sequence before accepting it.

## Revalidated prior findings

- **Fixed in the current working tree:** unverified unmute no longer returns success; its reason is also rejected by `isSuccessfulUnblockUnmuteRecord()`.
- **Improved:** the dashboard now requests queue and runs views together. The service-worker snapshot still reloads/replays WAL separately for completed history (finding above).
- **Improved:** terminal tab-close passes now coalesce. They remain unfiltered global scans, including a possible trailing pass.
- **Still present:** append replay verification reconstructs the full checkpoint on every WAL append; the new sharding does not change that path.
- **Still present:** the executor’s exhausted-rollback pre-pass traverses the full queue before the budgeted executor scan (`shared/js/sw.js:17671-17698`, `shared/js/sw.js:17580-17602`, `shared/js/sw.js:12883-12925`).
- **Still present:** the high-frequency progress paths bypass the fresh-read serialized runs updater (`shared/js/sw.js:32166-32212`, `shared/js/sw.js:32741-32825`). This remains a lost-update risk, not a reproduced incident.

## Summary

The restructuring makes real progress: it reduces checkpoint bytes touched by single-row reads, coalesces tab-close work, and removes one dashboard round trip. The main remaining concern is that the new “keyed” read still loads and scans the entire active WAL tail, while per-append verification still decodes/replays all checkpoint shards and the session mirror adds awaited storage traffic. The combined dashboard request also still performs two independent full WAL reconstructions. One new correctness concern is that keyed projection does not bind its checkpoint manifest to the active metadata identity before using the row for authority decisions.

This review is static and unbenchmarked. It describes the uncommitted working tree as observed, not a committed release. No source files were changed and no tests or builds were run.
