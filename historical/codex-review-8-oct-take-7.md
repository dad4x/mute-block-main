# JavaScript Architecture Review — Take 7

> **Status: HISTORICAL** (24 Oct 2026). Codex architecture review take 7 (11 Oct). Superseded. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Review date: 2026-10-11  
Repository: `C:\cygwin64\home\dbrower\src\mute-block-main`  
Reviewed state: working tree at `6b5bc5e` plus uncommitted changes, including the queue storage layering, session mirror, and WAL module extractions.

## Scope

Read-only static review focused on whether the recent architecture work reduces storage I/O and in-memory scans, especially around terminal completion and the next job. I read `docs/queue-storage-layering.md`, traced its mirror/hydrate paths and the completion/archive path, and rechecked the take-six findings against the current tree. No source files were changed. No tests, builds, benchmarks, or live extension checks were run; Chrome session-storage lifetime and actual latency remain unverified here.

## Findings

### [P2] Post-write `hydrate()` calls reread and replay the full mirrored WAL

**References:** `shared/js/sw.js:9098-9102`, `shared/js/sw.js:10026-10049`, `shared/js/sw.js:6841-6873`; representative callers at `shared/js/sw.js:11520-11521`, `shared/js/sw.js:23178`, `shared/js/sw.js:24249`, and `shared/js/sw.js:25167`.

`createCoordinatorAuthority().hydrate()` always calls `coordinatorQueueReader.currentAuthority(...)`; it has no already-hydrated fast path. With `fromMirror: true`, the reader first fetches the mirror meta/sequence and then calls `storage.session.get()` for the entire mirrored checkpoint, shard set, and active WAL tail. It then loads/reconstructs the store and calls `recoverQueueFromWalStore()` to rebuild the queue. Thus every explicit hydrate after a successful mutation can repeat a large session read plus a full WAL replay, even though the caller is in the same worker and the commit just updated the resident WAL store.

This is directly on state-changing flows: terminal settlement hydrates after a queue change, and retry/enqueue/pause/cancel paths also hydrate after persistence. On a long log, that makes completion-to-next-job latency scale with retained WAL history and defeats the resident-authority rule (“hydrate” should be startup or explicit resync). Make successful WAL commits update the resident authority as part of the commit, then reserve full hydrate for startup/recovery; if a resync is required, coalesce concurrent requests and avoid repeating it when the resident sequence is already current.

### [P2] Terminal completion still incurs a second WAL append and full replay verification

**References:** `shared/js/sw.js:8992-9001`, `shared/js/sw.js:9023-9043`, `shared/js/sw.js:7840-7859`; `shared/js/swCoordinatorQueueWal.js:347-400`.

`archiveTerminalCoordinatorRow()` documents that terminal status is first persisted by the ordinary apply path, then archival removes the row and appends it to the completed area in a second WAL mutation. That archive append contains a `completed`-area record. The incremental verifier only accepts contiguous queue-only records (`swCoordinatorQueueWal.js:355-360`); for this completed record it falls back to `recoverProjectedState()` over the full store at line 399. Consequently one terminal completion can pay for two durable WAL writes and two mirror updates, with at least one full checkpoint/tail replay at the completion boundary. This is precisely the kind of history-dependent work that can delay the next executor start.

Fold terminal status/removal/completed archival into one WAL commit where practical, or add a verified incremental completed-area path using a trusted pre-append completed projection. Keep whole-log replay for untrusted bases and startup/checkpoint validation.

### [P2] Each WAL append deep-clones the retained store and forces a full tail-index rebuild

**References:** `shared/js/walSnapshotStore.js:493-517`, `shared/js/walSnapshotStore.js:1082-1126`; resident-store installation at `shared/js/sw.js:7492-7493` and `7858-7859`.

`appendWalRecordsToGeneration()` begins with `cloneJson(store)`, including the existing checkpoint/shard and segment data. The append creates a new `segments` array, which becomes the resident store. The row index in `residentTailRowIndexes` is keyed by that array identity, so the next keyed read builds the index from every record in the accumulated active tail again. With repeated append→keyed-read cycles, previously indexed records are rescanned; the append itself also copies retained history to persist a tiny row delta.

This remains the take-six hot-path concern. Preserve/reuse immutable segment structures across append (or carry the index forward and index only new segments), and avoid deep-cloning the physical store for append preparation. The current resident-read steady-state benefit only holds between writes.

### [P2] Dashboard refresh still reads local WAL storage and replays the full log

**References:** `shared/js/sw.js:6271-6304`, `shared/js/sw.js:6364-6423`; mirror WAL reader at `shared/js/sw.js:6841-6873`.

The dashboard loader still calls `metricStorageGet()` for the WAL defaults, hydrates the complete physical WAL from local storage, and runs `recoverProjectedState()` on every refresh. It then materializes and sorts all completed rows with `Number.MAX_SAFE_INTEGER`. The earlier take-six duplicate recovery is fixed: this path now shares one recovery for queue and completed history. But it still does the large disk read/replay that the mirror and “dashboard renders from the mirror” plan are intended to remove, and the unbounded completed sort remains O(H log H) in completed-history size even when the view needs only a bounded recent list plus run aggregates.

Complete Phase 3 Group A/Phase 5 before treating dashboard refresh as a low-I/O path. Derive run counts during the single projection pass and avoid sorting all history for the display.

## Recheck of take-six items

- **Still present:** full-store append cloning and per-append tail-index invalidation; terminal archive falls back to full replay; completion cleanup still has the broad owned-tab/Quora sweep noted in take six (not re-traced for this storage-focused take).
- **Improved:** dashboard now performs one WAL recovery rather than the two noted in take six. It still reads/replays the WAL on each refresh and sorts every completed row.
- **Newly central to the I/O goal:** mirror-based `hydrate()` is called after mutations but always fetches the full mirror and reconstructs state. Moving I/O from `storage.local` to `storage.session` reduces disk access, but does not make these repeated full reads/scans cheap.
- **Not reviewed for resolution here:** metrics flush durability and flight-recorder watermark findings from take six; the latest storage architecture diff did not make them the focus of this pass.

