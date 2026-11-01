# JavaScript Codebase Review — Take 3

> **Status: HISTORICAL** (24 Oct 2026). Codex review of live epoch observations (9 Oct). Superseded. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Review date: 2026-10-09
Repository: `C:\cygwin64\home\dbrower\src\mute-block-main`
Committed HEAD: `e12c50c` (`main`, v1.6.1388). Working tree is at v1.6.1398 with uncommitted changes.

## Scope and method

Static review of the working tree, focused on what changed today: the session mirror's write
timing, the keyed-read manifest binding, the legacy queue-view retirement, orphan-tab capacity,
the dashboard's single WAL read, and the no-work storage-write counters. Where a claim is backed
by a live CDP read or a test trace, that is noted. The review follows `shared/js/` as the source.
This is not a substitute for a benchmark or a real run.

## Findings

### [P2] The scheduled resume still picks its branches from the raw projection

**References:** `shared/js/sw.js`, `runScheduledCoordinatorQueueResume` (the `mbCoordinatorQueue`
read and the `scheduledRawQueueCounts` gates).

The scheduled resume reads the raw `mbCoordinatorQueue` key and uses its counts to decide whether
to run the raw preload, the WAL preload, and the idle check. The raw key is a deferred projection,
so it can disagree with the WAL authority. In the orphan-capacity test trace the raw key still held
an active row after the WAL had moved on, and the scheduled run took the "active rows present" path
and did not reschedule. An experiment that gated these branches on the hydrated authority did not
clear that test by itself, and I reverted it, so this stays open. Gate the branches on the hydrated
authority, and never preload raw rows over a hydrated authority.

### [P2] The executor start can wait on terminal tab-close work

**References:** `shared/js/sw.js`, `enqueueExistingExecutorForCoordinatorOnce`, the
`EXHAUSTED_ROLLBACK_SETTLE` pre-pass.

The executor start awaits the exhausted-rollback pre-pass. In the continuation test trace, that
await did not return inside the test's tick budget, and the next queued tab was never opened. The
trace shows the pre-pass waiting on terminal tab-close confirmations. Every later executor request
was coalesced into that in-flight start (`terminalProgress.continuationFastExecutorCoalescedInFlight`
= 1). This is a liveness risk: one slow tab close can hold up the whole queue's next open. The
pre-pass should not block the open of an unrelated row.

### [P2] Coalesced scheduler requests can be dropped

**References:** `shared/js/swscheduler.js`, `shouldCoalesce`, `schedule`, `markTimeoutFired`.

A request that coalesces into a pending timer depends on that timer's run seeing its state change.
When the run is absorbed by an in-flight executor start, the coalesced reason is lost. The counters
from the test show two coalesced requests (`pump.coalesced` = 2) and one scheduled run. Nothing
re-arms afterward. A bounded follow-up was tried and it did not fix the test; it was reverted.
Coalescing should carry the reason forward, or the absorbed run should re-arm.

### [P2] No-work storage writes are about half of storage updates while the queue runs

**References:** `shared/js/coordinator.js`, the "No-work writes" card (`alert` when not paused and
`noDurableWork / started > 0.5`); `shared/js/sw.js`, `recordStorageIdleChurnCounters` and the
`storageUpdate.noDurableWork` path.

Live, the current epoch (started about 04:01 UTC) shows `storageUpdate.started` = 128,
`storageUpdate.noDurableWork` = 65 (51%), and `storageUpdate.noRuntimeWork` = 19. The card turns red
because the queue is running and the share is over 50%. The same epoch shows `pump.coalesced` = 805
against `pump.requested` = 62, `pump.noop.preservedVolatileQueuedActionsDuringFill` = 124, and
`pump.noop.activeRuntimeFillSuppressed` = 66. So many pump passes run and find nothing to change.
The largest storage-write paths by bytes are reconcile paths: `reconcile.exhaustedRolledBackQueued`
batch load and save, and `reconcile.authority/executor.queueOnly.forceDurableReload`. A five-minute window (about 04:06 to 04:10 UTC, with the queue running) added 111 started updates, of
which 61 were no-durable (55%) and 27 no-runtime. In that window pump requests rose by 72 while
coalesced requests rose by 973. The counters do
not record no-durable writes per path, so the 65 cannot yet be attributed to a specific path. Add a
per-path no-durable counter before choosing a fix. The decision rule in `batching-metrics.md`
(back off repeated no-op repair and pump passes) is the likely direction, but it is not proven.

### [P3] Orphan-capacity matching falls back to `profileHref`

**References:** `shared/js/swQueuedTabRuntimeStatus.js`, `isOrphanProvisionalQueuedTab`.

The check looks up the authority row by `metadata.coordinatorKey`, falling back to `profileHref`.
Tab metadata that lacks `coordinatorKey` and whose authority key differs from its `profileHref`
would be classed as orphan and would stop counting toward concurrency, so the queue could open more
tabs than the limit. I did not find a live case of this and did not reproduce it. Make the fallback
explicit, or require `coordinatorKey`.

### [P3] The keyed-read manifest binding is correct in the live store

**References:** `shared/js/walSnapshotStore.js`, `projectKeyedRowFromStored` and
`checkpointManifestMatchesMeta`.

Read live over CDP on 2026-10-09: the active checkpoint B's meta entry and its manifest agree on
`snapshotSeq` 28817, `snapshotEpoch` 0, `createdAt`, `stateHash` `dadd8317`, `shardCount` 10, and
`format` `sharded-v1`. The new check should not reject keyed reads in production. No finding.

### [P3] The session mirror is stale on a measurable share of reads

**References:** `shared/js/sw.js`, `mirrorCoordinatorQueueWalAfterAck` and the reader's freshness check.

Live, the current epoch (end of window) shows `queueMirror.readHit` = 59, `queueMirror.readStale` = 30 (34%),
`queueMirror.appendAdvanced` = 43, and one `queueMirror.rebuilt`. The append-ack writes are
fire-and-forget by design, so a read right after a mutation can see a stale mirror and falls back
to disk. That is the accepted tradeoff. The measured stale share is high enough to matter for
read cost. Over the same five-minute window, 19 of 45 mirror reads (42%) were stale, up from 25% for the
epoch, so the mirror's benefit should be checked against that cost before it is relied on.

### [P3] The startup cleanup writes to storage on every service-worker start

**References:** `shared/js/sw.js`, `retireLegacyQueueViewStorageKey` (called at module load).

The one-time removal of `mbCoordinatorQueueView` runs on every service-worker start, and each run
calls `coordinatorStorageAdapter.remove`. A remove of an absent key is a no-op, but it is still a
storage call on every start. Guard it with a marker key, or drop it once installs have been
cleaned up.

## Revalidated items from take 2

- **Fixed:** unverified unmute no longer counts as success.
- **Fixed in this pass:** the keyed read no longer trusts a manifest that differs from the active
  meta (fails closed, retryable on a torn read).
- **Fixed in this pass:** the replay reducer copies each map area once per projection, not once per
  record.
- **Fixed in this pass:** the dashboard snapshot reads and projects the WAL once for queue and
  completed history.
- **Fixed in this pass:** the legacy queue-view recovery is retired and its stored key is removed at
  startup.
- **Still open:** keyed reads still scan every active tail segment for each key.
- **Still open:** every acknowledged append still decodes and replays the full checkpoint before
  returning.
- **Still open:** terminal tab-close still scans the whole queue on each completion. Scope it to the
  affected hrefs.
- **Changed:** the session mirror append-ack write is no longer awaited, so a read right after an ack
  can see a stale mirror. Measured at 25% stale in the current epoch.

## Summary

The most important open item is the executor start waiting on terminal tab-close work, because it can
hold the queue's next open. The scheduler's raw-projection branches and the coalescing that drops
reasons are the next most important, since they explain the tests that still fail. The red
"No-work writes" card is real and comes from pump and reconcile passes that run without finding work,
but the counters do not yet say which path. Add per-path no-durable counters before choosing a fix.

This review is static, plus a few live reads noted above. It is not benchmarked, and no tests or builds
were run for it.
