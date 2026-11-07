# Mute Block Review 1: Implementation Gaps at HEAD

**Reviewed snapshot:** `62a67eacc631d0450fa7ca77d2ce2ca59e41e9e3` (2026-10-25). Findings compare implementation with architecture and decisions in this repository. These are review observations, not claims that every documented tradeoff is a user-visible defect. No tests, builds, or live browser operations were run.

## Findings

### 1. Clear Current Work leaves pending-space records behind

**Severity: P2 · Confidence: high that records are untouched; medium that all such records are orphaned.**

`clearStoredCoordinatorWork` dispatches `CLEAR_STORED_WORK` (`shared/js/sw.js:23322-23332`). Its mutation path, `mutateCoordinatorStoredWorkClear`, removes active queue and completed rows through `coordinatorAuthority.persistCoordinator`, but does not read, remove, or reconcile `SPACE_PENDING_NUKED_POSTS_KEY` (`shared/js/sw.js:27248-27331`). The architecture snapshot itself records that Clear Current Work leaves pending records and cites a prior audit of 724 suspected orphans (`architecture.md:49`). Existing notes call the causal connection likely rather than proven.

This can leave stale candidates after the visible work they belonged to has been cleared, and repeated use can accumulate records whose intended work no longer exists. Define whether pending records are meant to survive this operation; if not, include them in the clear transaction or reconcile them against remaining authority and add coverage for that contract.

### 2. Manual direct-action progress remains a separate progress protocol

**Severity: P2 · Confidence: high.**

The architecture says content-side failure must not create a separate durable coordinator/progress write path and specifically says the legacy fallback should be removed after cleanup (`architecture.md:620-624`). Queued progress follows attempt-scoped `record-job-milestone` / `record-job-terminal` messages, but `recordProfileNukeProgress` in `shared/js/content.js:1311-1396` still takes a separate branch when no active queued attempt exists and sends `record-direct-profile-progress` fire-and-forget. The worker handles that action separately (`shared/js/swBootstrap.js:1127-1128`; `shared/js/sw.js:35643+`).

This is a known exception for manually opened profile actions, not evidence that queued rows have two writers. It means progress has two protocols, and the manual path has no queue attempt identity or queue-machine transition. The architecture should explicitly accept this exception and define its lifecycle/clear behavior, or the path should be migrated to a single explicit observation contract.

### 3. Run bucket-layout compatibility remains after runs moved into the WAL

**Severity: P2 · Confidence: high.**

Runs are now WAL-backed (`shared/js/swRunsWal.js`; current worker use at `shared/js/sw.js:10237-10252`), yet `sw.js` retains the older bucket-layout read/migration/write logic (`shared/js/sw.js:2702-2803`, `10610-10640`). The current architecture map describes runs simply as the shared log, while `dead-ends-review-2026-10-24.md` records removal of the bucket layout as decided work.

This leaves two storage-layout concepts and migration branches to reason about for data that is now derived from the run log. Complete the excision or document which compatibility scenario still requires it; ensure tests no longer imply the bucket representation is authoritative.

### 4. Run retention shards do not partition the checkpoint

**Severity: P2 · Confidence: high.**

The worker assigns each run a `runShard` and uses it when selecting logical runs to prune (`shared/js/sw.js:10247-10249`). But the checkpoint partition callback special-cases only `completed`; every other area is passed to `queueWalRowShards.shardOf` (`shared/js/sw.js:9854-9855`), which reads `row.shard` (`shared/js/swQueueWalRowShard.js:24-27, 85-87`). Run records carry `runShard`, not `shard` (`shared/js/swRunsWal.js:11-13, 21-28`), so they land in the default physical checkpoint shard.

The retention cap still groups and removes run rows logically, but the claimed arrival-order checkpoint layout is not applied to the run area. If physical run sharding is intended, route the `runs` area through `runShard` and cover the partition mapping. Otherwise, describe these as retention groups rather than checkpoint shards.
### 4. Diagnostic shadow checks still add work around mutation/reconciliation paths

**Severity: P2 · Confidence: high that code remains; medium on real-world cost at this snapshot.**

The current worker still contains shadow-WAL comparison paths (`shared/js/sw.js:9019-9259`, `9416-9625`), deep-pending comparisons (`19079-19144`, `20326`), and run-list/storage-gap sampling (`2747-2803`, reconcile tail around `12329`). The repository's `dead-ends-review-2026-10-24.md` records removal of several of these as decided because they add work to write/reconcile paths. No current measurement was collected for this review.

These checks complicate the live architecture and can increase storage reads/CPU on the paths they instrument. Either finish the planned removal or record a current measurement and explicit reason to retain each one.

### 5. `architecture.md` contains stale state and violation claims

**Severity: P2 · Confidence: high.**

The existing architecture map is dated 24 Oct and says completed-log pruning was not re-verified, while current code assigns completion shards and prunes them at checkpoint (`shared/js/swCompletedShards.js`; `shared/js/sw.js:8821-8830`, `8941-8943`). It also describes content progress as a competing writer to queued terminal state and describes the legacy queue/view as live representations. Current queued progress follows the worker job protocol (`shared/js/content.js:1311-1350`), the raw queue key is retired, and the legacy queue view has no normal writer/reader (`shared/js/sw.js:37362-37398`).

This drift makes the canonical architecture note unsafe as a current change guide: it can direct maintainers toward fixes for already-removed problems while missing current exceptions such as the manual direct-progress path. Update or supersede the state map and fragmentation list using the current source baseline.

## Known risks or limitations, not elevated to new defects here

- Session-backed profile progress is intentionally lost on browser restart; the session store is not queue authority.
- Completion retention/cap is whole-shard based, so count limits are approximate at shard boundaries.
- Run pruning skips shards referenced by live work and preserves the newest shard; the nominal 700 cap can therefore be exceeded while references prevent pruning.
- The dedicated worker-action window's focus/visibility behavior has been a documented concern. This review did not run a live browser reproduction.
- The current storage namespace intentionally does not migrate unprefixed prior-build data. Old data remains outside the current `v1.6.` layout unless separately erased.

## Review method

Read repository guidance, the current architecture and store design notes, current storage/state modules, relevant worker/content/dashboard paths, manifests, and commit metadata. Independent agents inventoried architecture, implementation risks, and UI/browser boundaries. Findings were cross-checked against current source. No automated verification or live operation was performed.

