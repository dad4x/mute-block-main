# Queue WAL Segmented Record Follow-Up

Date: 2026-05-27

Status: follow-up design note; do not interrupt the current WAL migration slice
to implement this unless the active correctness work is complete.

## Context

Live metrics from the current queue-WAL work show that the logical WAL records
are small, but the storage adapter is still blob-shaped. Appending one queue
record rewrites the full `mbCoordinatorQueueWal` object, so the logical WAL
shape is good while Chrome storage write volume remains high.

The next storage-adapter target should make the durable WAL physically
segmented. The goal is not to add a second authority model. It is to keep the
existing authority/reducer boundary and change the persistence underneath it.

## Target Shape

Use one WAL record per storage segment for the first implementation.

Separate record identity from storage-slot identity:

- `recordSeq`: monotonic within the active log generation and used for replay
  order.
- `segmentNo`: bounded slot number within the active generation and used for
  storage key placement.

With one record per segment, `segmentNo` can usually be
`recordSeq - baseSeq - 1`, but it is intentionally bounded and resets whenever
the active log generation switches.

Example keys:

```text
mbCoordinatorQueueWal.meta
mbCoordinatorQueueWal.checkpoint.A
mbCoordinatorQueueWal.checkpoint.B
mbCoordinatorQueueWal.segment.A.0000
mbCoordinatorQueueWal.segment.A.0001
mbCoordinatorQueueWal.segment.B.0000
```

Example manifest:

```json
{
  "version": 1,
  "activeGeneration": "A",
  "baseSeq": 8120,
  "nextRecordSeq": 8173,
  "nextSegmentNo": 53,
  "committedSegments": 53,
  "softSwitchAt": 104,
  "hardSegmentLimit": 128,
  "checkpointSwitch": {
    "inProgress": false,
    "targetSeq": 0,
    "startedAt": 0
  }
}
```

Example per-record segment:

```json
{
  "version": 1,
  "generation": "A",
  "segmentNo": 52,
  "record": {
    "seq": 8172,
    "operationKind": "terminal-progress",
    "area": "queue",
    "key": "https://www.quora.com/profile/Example",
    "value": {
      "status": "succeeded"
    }
  }
}
```

## Append Ordering

A durable append should be acknowledged only after both writes complete:

1. Write `mbCoordinatorQueueWal.segment.<generation>.<segmentNo>` with the
   single WAL record.
2. Update `mbCoordinatorQueueWal.meta` to advance `nextRecordSeq`,
   `nextSegmentNo`, and `committedSegments`.

If the segment write succeeds but the manifest update fails, recovery should
ignore the uncommitted segment. A later repair can either re-advertise it if it
is safe or delete it as orphaned storage.

If the manifest update succeeds, hydrate must be able to recover by reading the
active checkpoint plus committed segment slots `0..committedSegments - 1` for
the active generation and applying records by `record.seq`.

## Generation Switch Policy

Do not let segment numbers grow without bound.

- At the soft threshold, for example 80-90% of `hardSegmentLimit`, schedule a
  checkpoint generation switch in the background.
- At `hardSegmentLimit`, block new durable queue-WAL appends until the
  checkpoint switch completes.
- After a successful switch from generation `A` to `B`, `segmentNo` resets to
  `0` for `B`; old `A` segment keys are covered by the new checkpoint and can
  be retired later.

Checkpoint switch ordering:

1. Recover current queue authority from active checkpoint plus committed
   segments.
2. Write the inactive checkpoint with the recovered queue state and target seq.
3. Verify recovery from the inactive checkpoint.
4. Switch `mbCoordinatorQueueWal.meta.activeGeneration`.
5. Begin appending new records at segment `0` in the new generation.
6. Retire old covered segment keys after the switch is durable.

Retiring old segments is a consequence of the safe generation switch, not the
authority mechanism.

## Buffering

An in-memory buffer is optional. The live problem is whole-WAL-object rewrites,
not obviously per-record storage-call overhead.

Start with one durable record per segment. Add buffering later only if metrics
show the per-record storage call count has become the next bottleneck after the
blob rewrite is gone.

## Acceptance Criteria

- A single row mutation writes one small segment key plus one small manifest
  update, not the full WAL store object.
- Restart hydrate recovers from checkpoint plus committed segments.
- Orphan segment recovery is deterministic when segment write succeeds but
  manifest update fails.
- Manifest advance without a readable committed segment is detected and causes
  safe recovery failure or repair, not silent authority loss.
- Soft threshold schedules a checkpoint generation switch.
- Hard threshold blocks new durable queue mutations until switch completion.
- Segment numbers reset after switching generations.
- Metrics distinguish logical WAL record bytes, segment storage bytes, manifest
  bytes, active segment count, soft-switch scheduling, hard-block count, and
  checkpoint-switch success/failure.

## Implemented 2026-09-14: chunk large enqueues instead of appending them whole

Done, tested, and shipped -- see the original TODO below for the trigger and
plan direction, still accurate. Resolution of the three open questions:

- **Chunk boundary enforced SW-side**, in `enqueueCoordinatorItemsStorage`
  (shared/js/sw.js). The original single-batch body moved unchanged into
  `enqueueCoordinatorItemsStorageOnce`; `enqueueCoordinatorItemsStorage` now
  checks `request.items.length` and, above `COORDINATOR_ENQUEUE_CHUNK_THRESHOLD`
  (100), calls the new `enqueueCoordinatorItemsStorageChunked`, which slices
  into `COORDINATOR_ENQUEUE_CHUNK_SIZE` (50)-item groups and awaits each
  `enqueueCoordinatorItemsStorageOnce` call -- its own durable WAL commit --
  before starting the next. Every chunk after the first is pinned to the
  same `run.id` so the whole bulk action still reads as one run. Content
  scripts needed zero changes; `enqueueCoordinatorItems`/
  `finishCoordinatorEnqueue` see the same aggregated `{queued, merged,
  durable, resetCleanupTargets, ...}` shape as a single-batch call, just
  summed across chunks.
- **Threshold-based, not universal**: small enqueues (the common case, under
  100 items) go through the untouched original path with no added latency.
- **No WAL-layer changes**: `prepareCoordinatorQueueWalAppend`/
  `getCoordinatorQueueWalPhysicalPayload` are untouched. Chunking is purely
  a caller-side loop that calls the existing single-batch append path
  multiple times with smaller arrays.

**New counters**: `enqueue.chunked.batches` (chunk count for a chunked
enqueue) and `enqueue.chunked.stoppedEarly` (incremented if a chunk comes
back non-durable/timed-out, at which point the loop stops rather than
piling more rows onto a queue that's already failing to persist -- whatever
already-durable rows exist by then are left for reconcile to pick up
normally).

**Known trade-off, accepted rather than solved**: `enqueueCoordinatorProfileUrls`
in content.js (the profile-list bulk-action path, distinct from the
Space-feed nuke path) calls `safeSendRuntimeMessageWithTimeout` with a
12-second default timeout. Chunking makes a large batch on this path take
longer in aggregate (N sequential round-trips instead of one), so a
profile-list batch over the 100-item threshold could now see a spurious
client-side "timed out" result while the SW keeps processing durably in the
background -- the same already-tolerated failure mode this codebase handles
everywhere storage timeouts can happen, not a new class of bug, and
unlikely in practice since profile-list batches are bounded by the
"Profiles Per Batch" setting (typically well under 100). Revisit if this
turns out to matter in practice.

**Tests**: two new synthetic tests in test/swSynthetic.test.js -- "a large
bulk enqueue is durably persisted in chunks, not one giant commit" (150
items, asserts `enqueue.chunked.batches === 3` via the wakeup-metrics
counter exposed at `sw.state().queueWakeupCounters`, and that every row
lands in the queue durable under the same run) and "a small enqueue below
the chunk threshold is not chunked" (2 items, asserts the counter is unset).

Not yet done: verifying this actually prevents a real corruption
recurrence -- the original incident was never deterministically
reproduced (a same-shape repro attempt the same night as the original TODO
came back clean), so there's no repro to re-run against the fix. The
enhanced flight-recorder logging from the same investigation is the
fallback if it recurs anyway.

## 2026-09-15: checkpoint-switch-always-immediate, WAL auto-recovery, and a run-registry latent issue

The chunking fix above did not prevent recurrence -- `missing-segment`
corruption hit at least twice more this night, both times as a side effect
of an ungraceful process kill (Chrome dev crashing / getting killed
mid-write, not a code bug in the append path itself). `chrome.storage.local`
has no cross-key transaction guarantee, so a hard kill between "clear old
segments" and "commit new checkpoint metadata" during a checkpoint switch
can always produce this class of corruption regardless of how carefully
appends are chunked.

Two things changed in response:

- **`scheduleCoordinatorQueueWalCheckpointSwitch` no longer defers while the
  queue is busy.** The old "defer until idle" behavior was indistinguishable
  from "defer until the batch finishes" for any real batch, letting segments
  grow unboundedly toward the hard limit -- directly implicated in two
  corruption incidents this session. It now always switches immediately at
  every threshold crossing; `forceOverQueueWork` only changes which metric
  fires, not whether the switch happens.
- **Automatic recovery on hydrate failure**, so a `missing-segment` (or
  other) hydrate failure no longer requires someone running
  `tools/cdp/recover-queue-wal-from-view.js` by hand. `loadCoordinatorQueueWalStoreFromStorage`
  (shared/js/sw.js) now rebuilds a fresh WAL store from `mbCoordinatorQueueView`
  -- a materialized read-model independent of the WAL's own physical
  segments, so it survives exactly the corruption that breaks hydrate --
  persists it durably in the background, and only falls through to the old
  reset-to-empty/throw behavior if the view itself has nothing usable or its
  row count doesn't match (same safety gate the manual tool used). Shipped
  in 1.6.1256/1.6.1257, the second version fixing an ordering bug where a
  *different* failure reason (`missing-checkpoint`, hit by a routine SW
  restart landing on stale storage seconds after a successful auto-recovery)
  fell into an older reset-to-empty branch that ran before the new
  auto-recovery got a chance to look at the view, wiping 900 just-recovered
  rows. Fixed by running view-recovery first for every failure reason.

**Latent issue, not yet resolved**: post-incident auditing found
`mbCoordinatorRuns` (the "known runs" registry used by
`filterCoordinatorQueueForCompactView` to decide which terminal rows are
still worth showing in the compact dashboard view) down to a single entry,
while the recovered 900-row queue actually spanned 8 distinct run IDs,
including two substantial still-relevant runs (240 and 351 rows) with no
registry entry at all. Nothing is broken on screen right now -- the
dashboard reads a persisted view snapshot that still shows all 900 rows --
but simulating a from-scratch view rebuild (via the same accounting-audit
tool used to compare stored-vs-rebuilt views) showed it would collapse to
31 rows, because the compaction filter drops any terminal row whose run
isn't registered. The data itself is fine (still in the WAL/authority
state); this is a dashboard-visibility risk that would trigger silently on
the next ordinary queue mutation. Root cause not pinned down -- `mbCoordinatorRuns`
is a separate storage key untouched by either recovery path used tonight,
so something else cleared it. Possibly this registry should itself be
WAL/checkpointed (or otherwise made to survive the same corruption/recovery
paths as the queue), the same way `mbCoordinatorQueueView` already does --
not deciding that now, just capturing it so it doesn't get lost.

---

Original TODO (2026-09-13), kept for context:

Not started -- planning only, captured per user request.

**Trigger**: a 510-item "Taking out the Trash" bulk enqueue produced a
`missing-segment` WAL hydrate failure (4 segments missing in checkpoint `B`,
positions 257-260 -- right past `COORDINATOR_QUEUE_WAL_SEGMENT_FORCE_SWITCH_AT
= 256`). This is the second occurrence of this corruption class this project
has seen (the first was ~145 missing segments in checkpoint `A`, root cause
never pinned down, only recovered via `tools/cdp/recover-queue-wal-from-view.js`).
Both incidents cluster around a large single enqueue crossing a
checkpoint-switch threshold. That correlation, not yet a confirmed causal
mechanism, is the working hypothesis (2026-09-13 investigation added
`queue-wal-checkpoint-switch-start`/`-result` flight-recorder events --
see `shared/js/swflightRecorder.js` -- specifically so the next occurrence
leaves a forensic trail instead of one that gets wiped by a later reload).

**Plan direction**: `enqueueCoordinatorItems` currently hands its entire
`workAssociations` array to one `applyCoordinatorQueueMachineEvent`
call inside one `enqueueSpaceFeedStorageUpdate`, which appends however many
WAL segments the batch needs (one segment per commit -- for 510 items this
could be many segments) in a single serialized storage operation. Instead,
split large enqueues into sub-batches (e.g. ~50 items per storage-update
call) so:

- each sub-batch commits and durably persists before the next one starts,
  shrinking the blast radius of any one failed/partial storage write;
- a checkpoint-switch threshold crossing happens between sub-batches, not
  mid-sub-batch, removing whatever timing window lets `committedSegments`
  and the actually-persisted segment keys diverge;
- progress becomes visible incrementally instead of "big click, long pause,
  all-or-nothing".

**Open questions to resolve before implementing**:

- Where does the ~50-item chunk boundary get enforced -- in the content
  script before calling `enqueueCoordinatorSpaceFeedItems`/
  `safeSendRuntimeMessage`, or in the SW's `enqueueCoordinatorItems`/
  `enqueueCoordinatorItemsStorage`? SW-side is safer (content-script call
  sites shouldn't need to know about WAL segment mechanics) but means the
  SW must report partial-batch progress back somehow if the caller wants it.
- Should chunking apply universally to `enqueueCoordinatorItems`, or only
  above some size threshold (small enqueues clearly don't need it)?
- Does `prepareCoordinatorQueueWalAppend` / `getCoordinatorQueueWalPhysicalPayload`
  need to change at all, or is chunking purely a caller-side concern that
  just calls the existing append path more times with smaller arrays?
- Separately: sw.js hydrates the WAL from storage independently at 12+ call
  sites on startup (acknowledged in an existing comment near sw.js:8146).
  Not yet investigated whether that redundant hydration contributes to this
  corruption class -- worth checking once flight-recorder evidence from a
  real recurrence is available, but out of scope for the chunking plan
  itself.
