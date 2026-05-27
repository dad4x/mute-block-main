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
