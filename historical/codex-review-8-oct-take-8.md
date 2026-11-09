# JavaScript Architecture Review — Take 8

> **Status: HISTORICAL** (24 Oct 2026). Codex architecture review take 8 (12 Oct). Superseded. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Review date: 2026-10-12  
Repository: `C:\cygwin64\home\dbrower\src\mute-block-main`  
Source version: `1.6.1425`; repository HEAD reported as `6b5bc5e`.

## Scope

Read-only review of the current shared JavaScript and queue-storage design, focused on large I/O and in-memory work at queue mutation, terminal completion, and next-action startup. I rechecked take seven. No source files were changed; no tests, builds, benchmarks, or browser probes were run in this review.

The host's `git status` and `git diff` commands fail with “this operation must be run in a work tree,” despite `git rev-parse` resolving the repository. I therefore reviewed the current files and architecture notes directly; I could not establish a trustworthy changed-file diff against take seven.

## Findings

### [P1] The checked-in browser workers lag behind the shared source

**References:** `shared/js/sw.js:6240-6265`, `shared/js/sw.js:6310-6320`, `chrome/js/sw.js`, `firefox/js/sw.js`, `webpack.mix.js`.

The shared worker now returns completed-history resident count/size fields and the dashboard consumes them. Neither checked-in browser worker bundle contains those fields. The Mix configuration builds `shared/js/*.js` and copies the compiled output into both browser `js` directories; the checked-in Chrome and Firefox worker files also predate the current shared worker. Package and manifest versions are all `1.6.1425`, so the version labels do not reveal that the implementation differs.

If `chrome/` and `firefox/` are the installable/reviewed extension trees, those builds do not contain all current source changes. Rebuild the browser outputs before shipping or testing those trees. I did not run the build because this is a read-only review.

### [P2] A foreground action still forces a full authority hydrate at action start

**References:** `shared/js/sw.js:26357-26390`, `shared/js/sw.js:26599-26622`, `shared/js/sw.js:9097-9126`, `shared/js/sw.js:10157-10198`.

For a foreground-required action with a profile and granted lease, `beginCoordinatorProfileAction()` unconditionally awaits `coordinatorAuthority.hydrate()` after promotion. That load reads the full valid session mirror (or falls back to the WAL keys on disk), decodes the WAL and reconstructs the queue and completed map. The action lease was just requested through the worker's serialized queue-machine path, and successful writes now update resident state through the door, so this looks like a leftover resync on a hot action-start path. It can make the first step of an otherwise resident action proportional to retained WAL history.

Use the resident state after the lease mutation and apply only any necessary lease overlay. If the reload protects against a specific stale-state case, gate it on a sequence mismatch rather than doing it for every granted foreground action.

### [P2] A one-row mutation still copies the queue and retained WAL several times

**References:** `shared/js/sw.js:6447-6456`, `shared/js/sw.js:9297-9307`, `shared/js/sw.js:9393-9419`; `shared/js/walSnapshotStore.js:1082-1126`.

The mutation path starts with `applyCoordinatorQueueChange()`, which spreads the complete queue. `makeCoordinatorAuthorityProjection()` then recursively clones the queue and `stored`; `stored` includes the resident WAL store. After persistence, `persistCoordinatorQueueChange()` applies the row change again and makes another projection, repeating those whole-map copies. `appendWalRecordsToGeneration()` separately deep-clones the full physical WAL store before adding a small segment. The append therefore has work proportional to both live-queue size and retained WAL size, even when the durable payload is only one changed row.

This is the main remaining mismatch with the reduced-I/O goal: the storage write is incremental, but resident preparation and update still copy accumulated history. Keep the resident physical store outside the general projection clone, use row-level copy-on-write (or a persistent map) for queue edits, and append without deep-cloning immutable checkpoint and segment data.

### [P2] Terminal archival still triggers full-history append verification

**References:** `shared/js/sw.js:8949-9000`, `shared/js/swCoordinatorQueueWal.js:347-400`, `shared/js/sw.js:7859-7881`.

Terminal status is committed through the ordinary apply path, then `archiveTerminalCoordinatorRow()` performs a second WAL commit to remove the live row and append the completed row. The verifier's incremental path accepts queue-area records only. The completed-area record therefore falls through to `recoverProjectedState(append.store, ...)`, decoding the checkpoint and replaying the retained log for that archive append. The completed map is now already resident and updated by the write door, but the verifier does not use a pre-append completed projection.

This leaves a full-log scan on the completion boundary, and the two commits also mean two durable writes and mirror updates for the terminal change. Combine the terminal transition and archive into one WAL commit where feasible; otherwise extend incremental verification to the completed area with a sequence-checked resident base.

### [P2] Progress deltas still write and mirror the aggregate progress view

**References:** `shared/js/sw.js:9435-9533`, `shared/js/sw.js:6793-6815`; `docs/queue-storage-layering.md`, section 9.

The door removes the separate progress read from the hot path, but `applyCoordinatorProgressDeltas()` defaults `includeView` to true. Unless a caller explicitly disables the view, each upsert updates the aggregate `PROFILE_NUKE_PROGRESS_VIEW_KEY` and the affected shard, and `writeCoordinatorStoredKeys()` sends the view through both `storage.local` and the session mirror. The view contains all retained progress records (up to its normalization cap), so a small per-profile progress change still serializes and writes the whole aggregate. The architecture notes call removal of this separate store the next target, but the current implementation has not reached that step.

The read-path improvement is real; the remaining write cost is a full-value rewrite per delta. Moving queued-profile progress to its queue row and terminal progress to the completed row, or otherwise dropping the aggregate from routine writes, is needed to remove it.

### [P2] Dashboard reads no longer hit storage, but still sort and clone all completed history per refresh

**References:** `shared/js/sw.js:6231-6257`, `shared/js/sw.js:6260-6265`, `shared/js/sw.js:6268-6300`.

Take seven's repeated local WAL read/replay finding is fixed: the dashboard now gets resident queue, runs, pause, and completed state. But snapshot construction still calls `Object.values()` on the full completed map, sorts every row, and clones every result with an effectively unbounded limit. Queue-view construction then walks all completed rows again. Run statistics need the full history to aggregate, but they do not require sorting or cloning every row first; only the displayed recent rows need ordering.

Aggregate run totals in one pass and select a bounded newest-row set without sorting the full history. This becomes more important because the architecture decision now keeps all completed rows resident and explicitly leaves memory growth open.

## Recheck of take-seven findings

- **Resolved:** routine post-write hydrates have largely been removed; the write door updates resident queue/completed state. One unconditional hydrate remains in foreground action startup (above), plus explicit recovery/no-op call sites.
- **Resolved:** the dashboard no longer reads local WAL storage or replays it per refresh. Its full-history in-memory sort/copy remains.
- **Still present:** append-time cloning and tail-index invalidation; completed-area append verification falls back to whole-log replay; terminal completion uses a second archival commit.

## Review limitations

No tests, builds, or browser probes were run. The current source and generated browser bundles differ as noted above, so conclusions about the latest shared implementation should not be attributed to an already-built extension.
