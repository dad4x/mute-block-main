# Storage Serialization Boundaries Review - 2026-05-19

> **Status: HISTORICAL** (24 Oct 2026). Serialization boundaries review (19 May). Resolved. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Status: resolved review record.

Canonical planning now starts at [planning.md](../planning.md). Canonical
architecture starts at [architecture.md](../architecture.md). Keep this as
evidence for the review/fix cycle; active storage authority work now lives in
the storage plan and canonical architecture note.

Review target: storage read/write ordering for queue, runs, progress, events, and space-feed pending-post records.

Scope: storage mutation paths in `shared/js/sw.js`, plus direct coordinator/content storage writers where they touch the same durable model. This review is intentionally standalone and does not rely on findings from the other review notes.

## Current Status

Status: resolved as an active review note by the `1.6.329` fix pass tracked in
`review-fix-checklist-2026-05-20.md`.

- The serialized storage watchdog item is checked off there.
- `mbProfileNukeProgress` persistence is checked off as routed through the
  serialized update path.
- queue/runs/events/progress writes that also need pending-post state are
  checked off as sharing one storage payload.

Keep the findings below as historical context only. Re-open them only if a
current source review shows one of these exact serialization defects has
returned.

## Findings

### P1: The storage update watchdog does not unstick the serialized queue

`enqueueSpaceFeedStorageUpdate()` returns `promiseWithTimeout(updatePromise, ...)` so callers stop waiting after the timeout (`shared/js/sw.js:4630`, `shared/js/sw.js:4648`). But the global queue tail is still assigned to the original `updatePromise` (`shared/js/sw.js:4646`), not to the timeout-wrapped promise.

If an underlying storage operation never settles, the caller receives the timeout fallback, but `spaceFeedStorageUpdatePromise` never settles. Every later call builds on `previousUpdate = spaceFeedStorageUpdatePromise.catch(...)` (`shared/js/sw.js:4632`) and waits forever behind the hung update.

Impact: a single hung browser storage operation can permanently wedge queue, progress, action-lease, pending-post, repair, and resume writes for the service-worker lifetime. The watchdog limits caller latency but does not provide queue recovery.

Recommendation: make the serialized tail advance after timeout. One option is a queue runner with per-task timeout that records the abandoned task and continues to the next task. Another is a generation-based lock that lets timed-out operations finish without owning the right to write stale state.

### P1: Whole-map progress writes bypass the storage update queue

`recordProfileNukeProgress()` and `recordProfileNukeProgressBatch()` update the in-memory `profileNukeProgress` map, then call `persistProfileNukeProgress()` directly (`shared/js/sw.js:4936`, `shared/js/sw.js:4945`, `shared/js/sw.js:4963`). `persistProfileNukeProgress()` writes the entire `mbProfileNukeProgress` object with `browser.storage.local.set()` outside `enqueueSpaceFeedStorageUpdate()` (`shared/js/sw.js:4939`).

That direct whole-map write can race with serialized writers that also save `PROFILE_NUKE_PROGRESS_KEY` through `saveCoordinatorState()` (`shared/js/sw.js:1213`, `shared/js/sw.js:1228`, `shared/js/sw.js:1231`). It can also race with another direct progress persist: if two calls clone different versions of the whole map and complete out of order, the older write can drop newer profile records.

Impact: progress rows can disappear or roll back even though queue rows were serialized correctly. This is especially risky because progress is still used for terminal settlement, repair, and display compatibility.

Recommendation: route all `PROFILE_NUKE_PROGRESS_KEY` writes through the same serialized update path, or replace whole-map direct writes with single-record merge writes under the lock.

### P2: Queue and pending-post changes are sometimes committed in separate storage writes

Some paths compute a coherent queue/pending-post transition but save it in two writes. For example, `repairCoordinatorStorageFromProgressLocked()` saves queue/runs/events/progress via `saveCoordinatorState()` and then separately writes `SPACE_PENDING_NUKED_POSTS_KEY` (`shared/js/sw.js:1928`, `shared/js/sw.js:1939`). `markQueuedProfileResolutionUnresolved()` has the same split after terminalizing the resolver row (`shared/js/sw.js:8141`, `shared/js/sw.js:8150`).

The operations are serialized relative to other queued updates, but they are not atomic as a durable commit. A service-worker shutdown, extension reload, or storage error between the two writes can leave a terminal/source-settled queue row with stale pending-post state.

Impact: recovery has to infer and clean up partial commits that the normal transition could have written consistently in one payload.

Recommendation: extend `saveCoordinatorState()` or add a sibling commit helper that can include `SPACE_PENDING_NUKED_POSTS_KEY` in the same `storage.local.set()` payload as queue/runs/events/progress.

## Notes

`recordStaleAttemptDiagnostic()` is improved from a plain direct events append: inside the serialized update it queues pending diagnostic events, and outside it enters `enqueueSpaceFeedStorageUpdate()` before flushing (`shared/js/sw.js:634`, `shared/js/sw.js:641`). I did not count that as a current serialization defect.
