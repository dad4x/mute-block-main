# Storage WAL Overlay Design

Date: 2026-05-20

Status: target storage architecture detail.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This note is the
detailed WAL/A-B checkpoint/gzip design, not the active priority list.

## Purpose

The storage batching work should reduce full-map writes by making ordinary
state changes append small durable log records. The intended model is:

```text
current state = last checkpoint snapshot + ordered WAL records after it
```

The log is not just a temporary batch queue in front of another full
`mbCoordinatorQueue`, `mbCoordinatorRuns`, or `mbProfileNukeProgress` write.
Full writes are checkpoint generation switches. They should be useful, bounded,
and recoverable, but they should not be the normal write path for every worker
milestone, terminal update, pump, or repair tick.

Terminology: this note should say checkpoint switch, generation switch, or
checkpoint generation switch for the A/B WAL lifecycle. Older notes, code, or
metrics may still say "compaction"; in this design that means writing and
verifying an inactive checkpoint generation and then switching the active
pointer. Retiring old WAL records is a consequence of a successful switch, not
the purpose and not a garbage-collection authority model.

This note describes the target design, migration path, metrics, and tests.

Related notes:

- `top-level-rethink-1.5-execution-plan.md`
- `batching-metrics.md`
- `queue-wakeup-metrics-model-2026-05-20.md`
- `reconciler-first-fallback-architecture-2026-05-20.md`
- `queue-wal-segmented-record-followup-2026-05-27.md`

## Current Problem

The current implementation has started to coalesce logical progress events,
but the live metrics still show large full-payload writes. The storage traffic
shape is consistent with this pattern:

1. Multiple logical updates are gathered.
2. The service worker loads full coordinator state.
3. It applies the gathered updates in memory.
4. It writes full top-level objects again.

That improves some event-level batching metrics, but it does not change the
fundamental write amplification. A single changed progress row can still cause
a full progress map write. A single queue-row transition can still rewrite a
large queue map and sometimes derived runs/progress maps too.

The intended write-ahead-log design is different. It makes small append records
the durable source of recent truth, then folds those records into larger
checkpoints only when a generation switch is worth it.

## Design Goals

- Keep the service worker as the only mutation authority for queued work.
- Make ordinary queue/progress/run updates small append writes.
- Preserve crash recovery across MV3 service-worker suspension and restart.
- Make replay idempotent so duplicate log records cannot corrupt state.
- Make checkpoint generation switching optional for correctness.
- Keep existing dashboard and compatibility read surfaces working during
  migration.
- Avoid stale full-snapshot writes overwriting newer terminal or retry state.
- Make metrics show whether full writes are exceptional or still the norm.

## Non-Goals

- Do not introduce multiple durable mutation authorities.
- Do not let content scripts write queue authority directly.
- Do not require a database-like transaction system that browser storage does
  not provide.
- Do not make checkpoint switching or old-log cleanup a required step before
  the UI can show current state.
- Do not solve shared moderation publication in this layer. The WAL may later
  feed publication, but local scheduler correctness comes first.

## Storage Model

Keep existing snapshot keys initially:

- `mbCoordinatorQueue`
- `mbCoordinatorRuns`
- `mbCoordinatorEvents`
- `mbProfileNukeProgress`

Add journal metadata and journal segment keys:

- `mbCoordinatorWalMeta`
- `mbCoordinatorWalSegment:<segmentId>`

`mbCoordinatorWalMeta` should be small and should contain:

```json
{
  "version": 1,
  "snapshotEpoch": 17,
  "snapshotSeq": 12345,
  "nextSeq": 12380,
  "activeSegmentId": "seg-000018",
  "segments": [
    {
      "id": "seg-000018",
      "fromSeq": 12346,
      "toSeq": 12379,
      "sealed": false
    }
  ],
  "checkpointSwitch": {
    "inProgress": false,
    "targetSeq": 0,
    "startedAt": 0
  }
}
```

If current code or metrics still expose `compaction` as the field name, treat
that as a legacy label for `checkpointSwitch` until the calm code-renaming
pass.

Segment values should be arrays or small maps of ordered records. If Chrome
storage write size is a concern, prefer segment maps keyed by sequence number
over one giant append array, because updating one segment should remain bounded.

Example segment:

```json
{
  "version": 1,
  "id": "seg-000018",
  "records": {
    "12346": {
      "seq": 12346,
      "id": "attempt-177.../milestone/action-ready",
      "kind": "progress.patch",
      "profileHref": "https://www.quora.com/profile/Example",
      "runId": "profile-search-...",
      "attemptId": "attempt-177...",
      "attemptNumber": 1,
      "patch": {
        "status": "active",
        "actionReadyAt": 1779290000000
      },
      "at": 1779290000000
    }
  }
}
```

## Log Record Rules

Every record needs:

- `seq`: monotonic service-worker-assigned sequence number.
- `id`: stable idempotency key.
- `kind`: operation type.
- `at`: service-worker timestamp.
- enough identity to validate the operation: `profileHref`, `runId`,
  `attemptId`, `attemptNumber`, `tabId`, or source key as applicable.

The `id` should be deterministic for naturally unique milestones where
possible. Examples:

- `attemptId + ":claim:" + tabId`
- `attemptId + ":action-start:" + actionKind`
- `attemptId + ":terminal:" + terminalStatus`
- `runId + ":enqueue:" + profileHref`

If a source may legitimately emit repeated heartbeats, either give them unique
ids and a bounded retention policy or collapse them before append.

Replay must ignore a record when its id has already been applied for the same
snapshot epoch.

## Operation Kinds

Start with a small set. Add more only when an existing operation cannot express
the transition cleanly.

Queue operations:

- `queue.enqueue`
- `queue.claim`
- `queue.patch`
- `queue.terminal`
- `queue.releaseSlot`
- `queue.requeue`
- `queue.cancel`
- `queue.prune`

Progress operations:

- `progress.patch`
- `progress.terminal`
- `progress.restoreFromQueue`
- `progress.prune`

Run operations:

- Prefer deriving runs from queue state during projection.
- If explicit run records are still needed, use `run.patch` and keep them
  secondary to queue projection.

Event operations:

- `event.append`
- `event.prune`

Repair operations:

- Express repair as normal queue/progress operations with `reason: "repair"`.
  Avoid a vague `repair.everything` operation because it hides what changed.

## Projection

Projection is the function that converts a snapshot plus log records into the
current in-memory state:

```text
project(snapshot, records) -> currentState
```

Projection must be deterministic and idempotent:

- Sort records by `seq`.
- Reject records at or below `snapshotSeq`.
- Reject duplicate record ids.
- Validate each record against current projected row identity.
- Use the reducer/state-machine rules for queue transitions.
- Never allow a stale attempt record to move a newer attempt backward.
- Never allow a non-terminal progress record to overwrite an authoritative
  terminal queue row.

The projected state should include:

- `queue`
- `progress`
- `runs` derived or patched after queue changes
- `events`
- `appliedRecordIds`, bounded or checkpointed by generation switch
- projection diagnostics

The service worker can keep the projected state in memory while alive. On
restart it reloads snapshots, loads log segments after `snapshotSeq`, replays
them, and resumes from the projected state.

## Write Path

The ordinary mutation path should be:

1. Validate the request against current projected in-memory state.
2. Build one or more compact WAL records.
3. Append the records durably.
4. Apply the records to the in-memory projection.
5. Notify/update UI surfaces from the projection.
6. Schedule a checkpoint generation switch if thresholds are crossed.

The append is the durability boundary for ordinary work. A caller should not
need a full snapshot write before considering a queue/progress transition
recorded.

If the service worker has no current projection, it should initialize one from
snapshot plus log before accepting ordinary queued work. This is cheaper than
forcing every mutation through full `loadCoordinatorState` and
`saveCoordinatorState`.

## Read Path

Internal service-worker reads should prefer the in-memory projection. If the
projection is missing or stale:

1. Read `mbCoordinatorWalMeta`.
2. Read snapshot keys.
3. Read listed log segments whose `toSeq > snapshotSeq`.
4. Replay records in order.
5. Cache the projection.

Dashboard reads can transition in phases:

Phase 1:

- Keep the existing snapshot keys updated often enough for compatibility.
- Expose a projected-state read message from the service worker for live UI.

Phase 2:

- Dashboard asks the service worker for projected state when available.
- If the service worker is asleep, dashboard wakes it and waits briefly.
- Fallback to snapshots with a visible "snapshot may lag" diagnostic only if
  the worker cannot respond.

Phase 3:

- Dashboard no longer depends on fresh full snapshots for normal correctness.

## Checkpoint Generation Switch

A checkpoint generation switch folds WAL records into a full checkpoint
snapshot. It is a performance and bounded-replay operation, not a correctness
requirement.

Checkpoint switch trigger examples:

- log record count exceeds `N`;
- cumulative log bytes exceed `B`;
- service worker reaches an idle window;
- terminal run has no active rows;
- dashboard/manual maintenance action;
- startup replay exceeds a latency threshold.

Safe checkpoint switch sequence:

1. Choose `targetSeq` from the current projection.
2. Mark `mbCoordinatorWalMeta.checkpointSwitch` as in progress with
   `targetSeq`. Existing code may still use the legacy `compaction` field name
   until it is renamed.
3. Build snapshots from the projection at `targetSeq`.
4. Write snapshot keys and snapshot metadata with `snapshotSeq = targetSeq`
   and a new `snapshotEpoch`.
5. Update WAL meta so segments at or below `targetSeq` are covered by the new
   checkpoint.
6. Retire old-generation segment keys only after the new checkpoint is
   confirmed readable.
7. Clear `checkpointSwitch.inProgress`.

Recovery rule:

- If startup finds a checkpoint switch in progress, inspect snapshot metadata
  and WAL meta. If the snapshot reached `targetSeq`, finish old-generation
  cleanup. If not, ignore the partial checkpoint and replay from the previous
  checkpoint.

Never delete log records before a snapshot with the matching `targetSeq` is
confirmed readable.

## Paired Checkpoints

For stronger recovery, keep two checkpoint generations and write the new
checkpoint into the inactive generation before flipping the active pointer.

The model becomes:

```text
active generation A or B = checkpoint for that generation + WAL segments for that generation
```

Suggested metadata:

```json
{
  "version": 1,
  "activeCheckpoint": "A",
  "checkpoints": {
    "A": {
      "snapshotEpoch": 17,
      "snapshotSeq": 12345,
      "createdAt": 1779290000000,
      "stateHash": "..."
    },
    "B": {
      "snapshotEpoch": 16,
      "snapshotSeq": 12000,
      "createdAt": 1779280000000,
      "stateHash": "..."
    }
  },
  "wal": {
    "A": {
      "snapshotSeq": 12345,
      "segments": [
        {"id": "A-000001", "fromSeq": 12346, "toSeq": 12379, "sealed": true}
      ]
    },
    "B": {
      "snapshotSeq": 12000,
      "segments": []
    }
  }
}
```

Checkpoint keys can either be suffixed:

- `mbCoordinatorQueue:A`
- `mbCoordinatorRuns:A`
- `mbProfileNukeProgress:A`
- `mbCoordinatorEvents:A`
- `mbCoordinatorQueue:B`
- `mbCoordinatorRuns:B`
- `mbProfileNukeProgress:B`
- `mbCoordinatorEvents:B`

or grouped into a small number of checkpoint objects if that proves cheaper.
Suffixed keys make partial cleanup and targeted reads easier.

Paired checkpoint generation switch sequence:

1. Read the current active checkpoint id.
2. Choose the inactive checkpoint id.
3. Build snapshots from the projection at `targetSeq`.
4. Write the inactive checkpoint snapshot keys.
5. Reset the inactive generation's WAL metadata so its WAL begins after the
   new checkpoint `snapshotSeq`.
6. Read back enough metadata, sizes, or hashes to confirm the inactive
   checkpoint is usable.
7. Flip the small active generation pointer to the inactive id.
8. Keep the old generation available until cleanup is known safe.

Recovery rule:

- Startup always begins from the active generation pointer.
- Load only that generation's checkpoint and WAL segments. Do not mix
  checkpoint `B` with WAL records from generation `A`, or the reverse.
- If the inactive checkpoint was partly written but the pointer was not
  flipped, ignore the inactive checkpoint and replay from the old active
  checkpoint.
- If the pointer was flipped but cleanup did not finish, use the new active
  checkpoint plus its generation's WAL, then finish old-generation cleanup
  opportunistically.

This gives an alternate recoverable snapshot without treating two full
checkpoint/WAL streams as simultaneously authoritative.

## Space Budget

Paired checkpoints are not free. A full A/B copy roughly doubles the checkpoint
portion of storage.

The live storage footprint measured on 2026-05-20 was about `3.24 MB` by
`chrome.storage.local.getBytesInUse()`. The large keys were:

- `mbCoordinatorQueue`: about `1.27 MB`
- `mbSpaceNukedPosts`: about `0.67 MB` for `1146` entries
- `mbCoordinatorRuns`: about `0.47 MB`
- `mbProfileNukeProgress`: about `0.45 MB`
- `mbQueueWakeupMetrics`: about `0.31 MB`

At the `maxRememberedNukedPosts = 10000` preference, current history entry
sizes project `mbSpaceNukedPosts` to about `5.9 MB`, making the total single
generation footprint about `8.4 MB` before WAL overhead.

Approximate implications:

- duplicating all current state: about `6.5 MB`;
- `10000` history entries with one generation: about `8.4 MB`;
- `10000` history entries with every large key duplicated: about `16.8 MB`;
- duplicating only coordinator authority snapshots while leaving large
  user-memory/history singly stored: roughly `10-11 MB` at `10000` history
  entries, depending on WAL and metrics size.

Therefore the A/B design should distinguish scheduler authority from user
memory:

- Pair coordinator authority checkpoints: queue, progress, runs, and events.
- Do not automatically pair `mbSpaceNukedPosts`; keep it singly stored,
  sharded, or separately checkpointed unless we decide history recovery needs
  the same A/B guarantee.
- Keep metrics/journals bounded and outside the recovery-critical checkpoint
  if possible.
- Add `unlimitedStorage` for Chrome/Firefox if we expect `10000` history
  entries plus A/B coordinator checkpoints to be a normal configuration.

The quota permission gives headroom. It does not solve write latency or
full-map amplification, so the WAL/sharding design still matters.

## Snapshot Compression

Snapshot compression is a good companion to A/B checkpoints because snapshots
are large, repetitive JSON blobs and are written less often than WAL records.
The compression target should be checkpoint snapshots, not individual WAL
appends.

Preferred policy:

- Compress only full checkpoint snapshots and large user-memory/history shards.
- Keep WAL records uncompressed or segment-compressed only after sealing, so
  ordinary appends stay simple and cheap.
- Store compression metadata beside each checkpoint: codec, uncompressed byte
  count, compressed byte count, state hash of the uncompressed state, and
  codec version.
- Verify by decompressing and hashing the inactive checkpoint before flipping
  the active A/B pointer.
- Fall back to an older active checkpoint plus WAL if decompression or hash
  verification fails.
- Use gzip as the first production codec and raw JSON as the fallback
  checkpoint format.

Gzip is the production-favored codec:

- Chromium and recent Firefox expose browser-native `CompressionStream` and
  `DecompressionStream`, including gzip, avoiding a bundled JS/WASM codec.
- Native browser gzip should have a much simpler extension CSP and packaging
  story than zstd.
- Gzip is worse than zstd on the live snapshot, but still reduces current
  snapshot sizes by about an order of magnitude.
- If gzip is unavailable, compression fails, or verification fails, write or
  keep a raw JSON checkpoint instead of blocking recovery on compression.

Keep the storage layer codec abstract. Zstd can remain a benchmark or optional
future codec if larger history snapshots make gzip insufficient, but it should
not be required for the first production recovery layer.

Suggested compressed checkpoint shape:

```json
{
  "version": 1,
  "snapshotSeq": 12345,
  "snapshotEpoch": 17,
  "codec": "gzip",
  "encoding": "base64",
  "uncompressedBytes": 1240000,
  "compressedBytes": 230000,
  "stateHash": "...",
  "payload": "..."
}
```

Initial live benchmark on 2026-05-20, using Node's native gzip/zstd bindings
against the current extension storage snapshot:

- Current `chrome.storage.local.getBytesInUse(null)`: about `3.21 MB`.
- Recovery-critical checkpoint shape (`queue`, `runs`, `progress`, `events`),
  raw about `2.18 MB`:
  - gzip level 1 stored checkpoint about `270 KB`; level 6 about `201 KB`;
    level 9 about `194 KB`.
  - zstd level 1 stored checkpoint about `181 KB`; level 6 about `160 KB`;
    level 9 about `150 KB`.
- User-memory history shape (`mbSpaceNukedPosts`, `1146` entries), raw about
  `668 KB`:
  - gzip level 1 stored checkpoint about `85.5 KB`; level 6 about `77.3 KB`;
    level 9 about `76.2 KB`.
  - zstd level 1 stored checkpoint about `75.5 KB`; level 6 about `70.1 KB`;
    level 9 about `68.9 KB`.
- Full storage shape, raw about `3.15 MB`:
  - gzip level 1 stored checkpoint about `411 KB`; level 6 about `315 KB`;
    level 9 about `304 KB`.
  - zstd level 1 stored checkpoint about `291 KB`; level 6 about `251 KB`;
    level 9 about `238 KB`.
- Average full-storage encode/decode times over 10 iterations:
  - gzip level 1 `94.7 ms` encode, `24.4 ms` decode; gzip level 6
    `111.7 ms` encode, `24.0 ms` decode; gzip level 9 `147.4 ms` encode,
    `26.1 ms` decode.
  - zstd level 1 `89.4 ms` encode, `21.9 ms` decode; zstd level 6
    `109.8 ms` encode, `21.1 ms` decode; zstd level 9 `122.9 ms` encode,
    `22.5 ms` decode.

These results make compression attractive for checkpoint generation switches.
Gzip level 1 is already enough to move the current full snapshot from megabytes
to about `411 KB` after base64 overhead, and gzip level 6 reaches about
`315 KB`. Zstd is smaller, but not enough smaller to justify WASM/runtime
portability risk for the first production pass. Use gzip via native browser
compression first, with raw JSON checkpoint fallback.

## Snapshot Staleness

Snapshots become allowed to lag behind current state. That must be explicit.

Each snapshot should carry:

- `snapshotSeq`
- `snapshotEpoch`
- `createdAt`
- maybe `stateHash` for test/debug comparison

Any code reading raw snapshot keys must know whether it needs:

- projected current state; or
- checkpoint snapshot state; or
- best-effort display state.

Authority-sensitive paths must not read raw snapshots directly once the WAL is
active. They must go through the projected store.

## Migration Plan

Step 1: Add WAL metadata and projection helpers without changing behavior.

- Implement record schema validation.
- Implement replay against existing snapshot fixtures.
- Add projection tests for stale attempts, terminal preservation, retry, and
  duplicate records.

Step 2: Append log records in parallel with current full writes.

- Existing snapshot writes remain authoritative.
- Metrics compare record payload bytes with snapshot payload bytes.
- Projection is checked against snapshot-derived state in tests and optional
  diagnostics.

Step 3: Make selected high-frequency progress milestones WAL-first.

- Progress heartbeat/action-ready/action-start records append to the WAL.
- In-memory projection updates immediately.
- Full progress snapshot writes are deferred to checkpoint generation switches
  or low-frequency compatibility flush.

Step 4: Move terminal progress and queue transitions WAL-first.

- Terminal queue/progress transitions append WAL records.
- Reducer validation happens before append and during replay.
- Existing full writes become compatibility snapshots.

Step 5: Move queue enqueue/claim/release/retry/cancel WAL-first.

- Queue authority comes from projection.
- Full queue writes are checkpoint generation switches only, except for
  temporary compatibility flushes.

Step 6: Retire ordinary full-map writes.

- `saveCoordinatorState` becomes a checkpoint/snapshot helper.
- New mutation code should not call it for ordinary row transitions.
- Metrics should flag ordinary mutation paths that still write snapshots.

## Metrics

The current metrics should be extended to separate WAL append pressure from
snapshot pressure.

WAL append counters:

- `wal.append.started`
- `wal.append.completed`
- `wal.append.failed`
- `wal.append.records`
- `wal.append.bytes`
- `wal.append.maxBytes`
- `wal.append.segmentWrites`
- `wal.append.segmentBytes`
- `wal.append.metaWrites`

Projection counters:

- `wal.replay.started`
- `wal.replay.completed`
- `wal.replay.records`
- `wal.replay.duplicatesIgnored`
- `wal.replay.staleRecordsIgnored`
- `wal.replay.invalidRecordsIgnored`
- `wal.replay.ms`
- `wal.projection.cacheHits`
- `wal.projection.cacheMisses`

Checkpoint switch counters:

- `wal.checkpointSwitch.started`
- `wal.checkpointSwitch.completed`
- `wal.checkpointSwitch.failed`
- `wal.checkpointSwitch.recordsCovered`
- `wal.checkpointSwitch.snapshotBytes`
- `wal.checkpointSwitch.retiredSegments`
- `wal.checkpointSwitch.ms`
- `wal.checkpointSwitch.activeCheckpoint`
- `wal.checkpointSwitch.inactiveCheckpoint`
- `wal.checkpointSwitch.pointerFlips`
- `wal.checkpointSwitch.checkpointVerifyFailed`

Legacy code may expose `wal.compaction.*` until the implementation rename.
Treat those counters as aliases for checkpoint-switch counters, not as a
garbage-collection subsystem.

Snapshot write counters:

- `snapshot.write.queue.bytes`
- `snapshot.write.runs.bytes`
- `snapshot.write.progress.bytes`
- `snapshot.write.events.bytes`
- `snapshot.write.reason.checkpointSwitch`
- `snapshot.write.reason.compatibilityFlush`
- `snapshot.write.reason.ordinaryMutation`
- `snapshot.write.generation.active.bytes`
- `snapshot.write.generation.inactive.bytes`
- `snapshot.write.recoveryCritical.bytes`
- `snapshot.write.userMemory.bytes`

Compression counters:

- `snapshot.compress.started`
- `snapshot.compress.completed`
- `snapshot.compress.failed`
- `snapshot.compress.codec.gzip`
- `snapshot.compress.codec.raw`
- `snapshot.compress.codec.other`
- `snapshot.compress.uncompressedBytes`
- `snapshot.compress.compressedBytes`
- `snapshot.compress.base64Bytes`
- `snapshot.compress.ms`
- `snapshot.decompress.ms`
- `snapshot.decompress.failed`
- `snapshot.verify.hashFailed`

The most important derived metrics:

- `walBytes / snapshotBytes`
- `ordinaryMutationSnapshotWrites / totalMutations`
- `checkpointSwitchSnapshotWrites / totalSnapshotWrites`
- `replayMs` on service-worker start
- `maxRecordsAfterCheckpoint`
- `logRecordsPerJob`
- `snapshotWritesPerJob`
- `pairedCheckpointBytes / singleCheckpointBytes`
- `recoveryCriticalBytes / totalBytesInUse`
- `compressedBytes / uncompressedBytes`
- `compressionMs / checkpointSwitchMs`
- `decompressionMs / replayMs`

Healthy direction:

- ordinary mutation snapshot writes trend toward zero;
- append bytes dominate ordinary write traffic;
- snapshot bytes occur mostly under checkpoint generation switches;
- replay stays bounded by checkpoint switch thresholds;
- terminal correctness does not depend on repair rewriting snapshots;
- paired checkpoint overhead is understood and limited to recovery-critical
  state, not accidental duplication of all extension memory;
- compression saves enough quota/storage traffic to justify its CPU and
  packaging cost.

## Testing

Add pure tests first. Browser-live tests should come after the projection model
is deterministic.

Projection tests:

- snapshot plus no records returns snapshot state.
- duplicate log ids are ignored.
- stale attempt progress does not affect a newer attempt.
- terminal queue row is not moved backward by later non-terminal progress.
- retry record creates a new attempt and old terminal/progress records are
  rejected.
- records can be replayed twice without changing final state.
- records can be split across segments without changing final state.

Checkpoint switch tests:

- checkpoint snapshot plus remaining log projects to the same state as
  original snapshot plus full log.
- crash after snapshot write but before segment deletion recovers correctly.
- crash after checkpoint-switch meta write but before snapshot write replays
  old log.
- retiring old-generation segments never loses records above `targetSeq`.
- A/B checkpoint switch writes the inactive checkpoint before flipping the
  active pointer.
- A/B WAL records are scoped to the same generation as the checkpoint.
- recovery never replays generation `A` WAL records over generation `B`
  checkpoints, or the reverse.
- writing a new inactive checkpoint resets that generation's WAL to the new
  checkpoint sequence.
- crash before pointer flip recovers from the old active checkpoint.
- crash after pointer flip recovers from the new active checkpoint and can
  finish WAL cleanup.
- inactive checkpoint corruption is detected before it becomes active.
- user-memory/history keys are not duplicated unless the test explicitly opts
  into full-state pairing.
- compressed checkpoint decompresses to the exact state hash before pointer
  flip.
- corrupted compressed payload is rejected and the old active checkpoint
  remains authoritative.
- raw snapshot mode and compressed snapshot mode project to identical state.

Migration tests:

- parallel WAL plus current snapshot writes produce equivalent projected state.
- high-frequency progress milestones append small records and do not force full
  progress snapshot writes.
- terminal progress is visible in projected state before a checkpoint switch.
- dashboard fallback to snapshots reports lag when service-worker projection is
  unavailable.

Fuzzer additions:

- randomly suspend/restart projection between operations;
- randomly checkpoint-switch at different sequence numbers;
- randomly duplicate append records;
- randomly reorder segment reads but sort by `seq` during replay;
- randomly fail old-generation cleanup and verify recovery.

## Implementation Boundaries

This wants a small storage module rather than more direct calls from unrelated
service-worker paths.

Suggested module boundary inside `shared/js/sw.js` or a future extracted file:

- `loadProjectedCoordinatorState()`
- `appendCoordinatorWalRecords(records)`
- `applyCoordinatorWalRecord(projectedState, record)`
- `compactCoordinatorWal(options)`
- `getCoordinatorProjectionForDashboard()`
- `writeCompatibilitySnapshots(reason)`

New queue/progress paths should call these instead of directly calling
`loadCoordinatorState()` and `saveCoordinatorState()` for ordinary mutations.

The reducer remains the transition authority. The WAL is a durability format,
not a replacement for transition validation.

## Failure Modes To Guard

Lost append:

- Caller sees success only after the WAL append write succeeds.

Duplicate append:

- Replay ignores duplicate ids.

Partial segment/meta update:

- Meta should never claim records are covered by a checkpoint until that
  checkpoint is readable.

Checkpoint pointer flip failure:

- Startup uses only the active checkpoint pointer. A partly written inactive
  checkpoint is ignored until verification succeeds and the pointer flip is
  durable.

Service-worker restart during mutation:

- Append-before-ack means replay sees the mutation after restart.

Service-worker restart after in-memory projection update but before append:

- The caller must not be acked; replay does not include the unappended change.

Stale snapshot overwrite:

- Ordinary mutation paths should stop writing full snapshots.
- Compatibility flushes must include the latest `snapshotSeq` and must never
  overwrite a newer checkpoint snapshot.

Unbounded replay:

- Checkpoint switch thresholds must be enforced by metrics and tests.

Unbounded paired storage:

- A/B checkpoints should cover recovery-critical coordinator state by default.
  Large user-memory keys such as `mbSpaceNukedPosts` need a separate explicit
  decision before they are duplicated.

## Acceptance Criteria

The WAL design is working when a representative live run shows:

- ordinary progress and queue transitions append WAL records;
- full queue/runs/progress writes happen mostly as checkpoint generation
  switches or compatibility flushes;
- `snapshot.write.reason.ordinaryMutation` is near zero;
- cumulative full snapshot bytes drop sharply compared with the current runs;
- service-worker restart replays current state without repair having to infer
  normal terminal progress;
- projected dashboard state matches checkpoint snapshot plus log;
- checkpoint generation switching can be interrupted and recovered without
  losing terminal rows.
- A/B checkpoint switching can recover from interruption before and after the
  active pointer flip.
- storage metrics separate recovery-critical checkpoint bytes from large
  user-memory/history bytes.

## Integration To-Do

The isolated WAL/snapshot module is ready to pick up as a tested kernel, but
not ready to ship as the production storage backend until these integration
items are handled:

- Define the service-worker persistence adapter around `chrome.storage.local`.
  The pure module should not grow direct browser-storage dependencies.
- Decide the exact production storage keys for A/B checkpoints, WAL metadata,
  WAL segments, compatibility snapshots, and any raw JSON fallback snapshots.
- Define migration behavior from the current full-map keys into the first
  projected state, including downgrade or fallback behavior if WAL metadata is
  missing, corrupt, or from a newer schema version.
- Add crash-point tests around real persisted writes, not only pure in-memory
  store objects. Cover interruption after inactive checkpoint write, WAL reset,
  checkpoint verification, active pointer flip, and old-generation cleanup.
- Add quota and storage-error handling for failed snapshot writes, WAL segment
  writes, metadata writes, compression failures, and cleanup failures.
- Measure whether write volume actually drops once WAL append records replace
  ordinary full-state writes. Track snapshot writes by reason so a hidden
  compatibility flush does not become the new normal mutation path.
- Keep the first runtime use narrow. Start with queue/progress authority only,
  leave large user-memory/history state singly stored, and do not duplicate
  `mbSpaceNukedPosts` without an explicit storage-budget decision.
- Keep reducer validation as the transition authority. The adapter should
  append records only after the existing state-machine rules accept the
  transition, and replay should apply the same rules.
- Expose a projected-state read path for dashboard/coordinator consumers before
  making raw snapshots intentionally stale.
- Gate the first live rollout with diagnostics that compare projected state,
  compatibility snapshots, replay latency, WAL bytes, and snapshot bytes.

## Practical First Patch

The first implementation patch should avoid touching every mutation path.

Recommended first slice:

1. Add WAL constants, schema validation, replay, and projection helpers.
2. Add tests that project existing-style queue/progress fixture state plus
   synthetic WAL records.
3. Add metrics for append/replay/checkpoint switching even if append is not
   yet active.
4. In parallel mode, append progress milestone records while still doing the
   current full writes.
5. Compare projected state to current snapshot state in a debug-only metric.

Only after that should high-frequency progress writes stop forcing full
`mbProfileNukeProgress` snapshots.
