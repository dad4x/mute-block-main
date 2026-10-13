# JavaScript Codebase Review — Take 4

Review date: 2026-10-10
Repository: `C:\cygwin64\home\dbrower\src\mute-block-main`
Committed HEAD: `e12c50c` (`main`, v1.6.1388). Working tree is at v1.6.1399 with uncommitted changes.

## Scope and method

Static review of the working tree, following take-3. It covers what changed since take-3: the
incremental append verifier, its base-continuity guard, the verifier's counters, and the open items
from take-3 that are still open. Live numbers are from CDP reads of the dev extension on 2026-10-10.
This is not a benchmark, and I did not run a new build or test pass for this review.

## Findings

### [P2] Append verification no longer re-derives the queue from storage on each write

**References:** `shared/js/swCoordinatorQueueWal.js`, `verifyAppendedIncrementally` and
`verifyAppendedCoordinatorQueueWalReplay`; `shared/js/sw.js`, the two verifier call sites in the
ordinary and batch append paths.

Ordinary mutation appends now apply their queue-area records to the authority's own pre-append queue
with the same reducer that recovery uses, instead of recovering the whole WAL. The verifier fails
closed on any ignored record, and falls back to full recovery when it cannot prove its base: no base
queue, a record outside the queue area, non-contiguous seqs, or a base `nextSeq` that does not match
the first appended seq. Full recovery still runs at hydrate and at each checkpoint switch.

The remaining risk is drift. A stale or wrong in-memory base is no longer caught on each append. It
is caught only at the next hydrate or checkpoint switch. The guard on `baseNextSeq` catches a base
that is behind by a whole record boundary, but not a base with the right `nextSeq` and a wrong queue.
Add a periodic full-recovery spot check (for example, once per N appends or on a timer), or accept
the drift window explicitly.

### [P2] Completion archives still take the full recovery path

**References:** `shared/js/swCoordinatorQueueWal.js`, `verifyAppendedIncrementally`, the
`area !== 'queue'` fallback.

Every terminal row produces a `completed`-area record, so every completion still does a full WAL
recovery on append. The incremental path only helps non-terminal mutations. Completed history is not
held in memory for the authority, so the incremental path cannot extend to archives without that
change. Terminal completions are common, so this is where most of the append cost remains.

### [P2] Flight recorder reads back empty while the service worker has been up

**References:** `shared/js/swflightRecorder.js`, `recordFlightRecorderEvent`, `getFlightRecorderSnapshot`;
`shared/js/sw.js`, the `onSuspend` flush and the startup reseed under `mbFlightRecorderSnapshot`.

Live on 2026-10-10: the recorder reports `newestSeq` 0 and no entries. The metrics epoch shows one
service-worker start, at 04:27:58, and journal entries at 04:32 show pump and storage activity since
then. The session-storage key `mbFlightRecorderSnapshot` is absent, while the queue mirror and timing
cache keys are present. I have not yet established why the buffer is empty. The likely candidates are
the extension reload at about 04:27 (which clears session storage and in-memory state together) and a
suspend flush that did not land. The recorder should not be relied on for diagnosis until this is
explained. A cheap check is to record a known sentinel event at startup and confirm it survives a
forced suspend.

### [P2] The "Queue -> tab" card measures backlog age, not handoff latency

**References:** `shared/js/coordinator.js`, the `Queue -> tab` card
(`phases.durableQueueToTabOpen`); `shared/js/swQueueWakeupMetricsShape.js`,
`recordQueueWakeupPhaseSamplesFromProgress`.

The phase is `tabOpenedAt - queuedAt`. Live, the card shows 31h 25m over two samples. Those samples are
backlog rows queued on 2026-10-07 and opened today, such as a row queued 2026-10-07 03:50 and opened
2026-10-10 04:08. The card survived an epoch reset and a dashboard reload, so the phase average is not
reset by the epoch. The name suggests a handoff measure, and it is not one. Split the card into backlog
age (queued to first eligible) and open latency (eligible to tab open), or rename it.

### [P2] The scheduled resume still picks its branches from the raw projection

Carried from take-3. The scheduled resume reads `mbCoordinatorQueue` to choose the raw preload, the
WAL preload, and the idle check. The raw key is a deferred projection and can disagree with the WAL
authority. An experiment gating these branches on the hydrated authority did not clear the
continuation test by itself and was reverted. Still open.

### [P2] The executor start can wait on terminal tab-close work

Carried from take-3. The executor start awaits the exhausted-rollback pre-pass, which can wait on
terminal tab-close confirmations. One slow tab close can hold the queue's next open. Still open.

### [P2] Coalesced scheduler requests can be dropped

Carried from take-3. A request that coalesces into a pending timer depends on that timer's run seeing
its state change. When the run is absorbed by an in-flight executor start, the coalesced reason is
lost. Still open.

### [P3] Orphan-capacity matching falls back to `profileHref`

Carried from take-3. `isOrphanProvisionalQueuedTab` looks up the authority row by
`metadata.coordinatorKey`, falling back to `profileHref`. If metadata lacks `coordinatorKey` and its
authority key differs from `profileHref`, the tab is treated as orphan and stops counting toward
concurrency, so the queue could exceed its limit. Not reproduced. Make the fallback explicit or require
`coordinatorKey`.

### [P3] The keyed-read manifest binding matches the live store

Confirmed live on 2026-10-09 and unchanged since: the active checkpoint's meta entry and manifest agree
on identity fields, so the new check should not reject production keyed reads. No finding.

### [P3] The session mirror is stale on a large share of reads

Live, the epoch shows `queueMirror.readHit` = 59 and `queueMirror.readStale` = 30 (34%). Over the
five-minute window of 2026-10-10, 19 of 45 mirror reads (42%) were stale. Append-ack writes are
fire-and-forget by design, so a read right after a mutation falls back to disk. Check that the disk
fallback cost is acceptable before relying on the mirror for read cost.

### [P3] The startup cleanup writes to storage on every service-worker start

Carried from take-3. The one-time removal of `mbCoordinatorQueueView` runs on every start, as a
`storage.remove` of an absent key. It is a no-op, but still a storage call. Add a marker or drop it.

## Open items from earlier reviews

- **Still open:** keyed reads scan the whole active tail. A background task is working on this.
- **Still open:** terminal tab-close scans the whole queue at completion. A background task is working
  on this.
- **Still open:** the no-work storage writes behind the "No-work writes" card, which is red while the
  queue runs. Per-path no-durable counters are needed before choosing a fix.
- **Fixed:** the legacy queue-view recovery is retired and its stored key is removed at startup.
- **Fixed:** the dashboard snapshot reads and projects the WAL once.
- **Fixed:** the replay reducer copies each map area once per projection.
- **Changed:** per-append verification is incremental for queue-area records, with the drift tradeoff
  above.

## Summary

The incremental verifier is the main change since take-3, and it trades per-append verification for a
drift window that is closed only at hydrate and checkpoint switch. Completion archives still pay the
full recovery cost. The flight recorder came back empty in a live check, and I have not explained why,
so it should not yet be used for diagnosis. The "Queue -> tab" card measures backlog age rather than
handoff latency. The scheduler, executor-start, and coalescing items from take-3 are still open.

This review is static, plus the live reads noted above. It is not benchmarked, and no tests or builds
were run for it.
