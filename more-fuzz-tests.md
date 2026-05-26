# More Fuzz Test Plans

Status: planning and safe-slice execution note.

Purpose: expand the synthetic harness beyond more seeds of the same current fuzzers. The useful next step is to add different adversaries that exercise the WAL-prep boundary, storage fault behavior, row-event batching, and scheduler/reconciler ordering.

## Current Working Constraint

This plan must not disturb the active source/test cycle. Treat the current
implementation files, existing test files, manifests, package metadata, and
build outputs as out of scope unless that scope is explicitly widened.

Safe work for this mission:

- refine this note;
- inspect existing tests and harnesses read-only;
- create clearly marked draft-only fuzz files if needed;
- run isolated draft fuzzers directly by path when they do not modify package
  scripts or existing test entrypoints;
- report current-code failures with seeds and traces instead of changing active
  implementation files.

Avoid for this mission:

- changing `shared/js/sw.js`, `shared/js/walSnapshotStore.js`, or other active
  implementation files;
- changing existing tests such as `test/swScenarioFuzz.test.js`,
  `test/swSynthetic.test.js`, `test/storageInvariants.test.js`, or
  `test/walSnapshotStoreFuzz.test.js`;
- changing `package.json`, `package-lock.json`, manifests, or release artifacts;
- wiring new fuzzers into `npm test` until the active test cycle is clear.

## Promotion Policy

- Keep `test/storageFaultFuzz.draft.test.js` draft-only until projection-throw
  behavior is fixed. A known failing test must not be added to `npm test`.
- If storage-fault coverage is needed in `npm test` before that fix, split the
  green cases into a stable file and leave projection-throw documented as a
  separate expected-current failure.
- Promote only green progress fuzzers when the active source/test cycle is
  quiet. `test/progressOperationFuzz.draft.test.js` and
  `test/progressBatchFuzz.draft.test.js` are candidates to rename out of draft
  status, deduplicate helpers if convenient, and wire into `npm test`.

## Current Coverage

Existing useful fuzz surfaces:

- `test/walSnapshotStoreFuzz.test.js` covers checkpoint/WAL replay, paired active/inactive generations, duplicate records, stale attempts, terminal-regression rejection, and malicious concurrent operation streams.
- `test/swScenarioFuzz.test.js` covers randomized service-worker scenarios over enqueue, progress, terminal progress, tab updates, tab removal, resume, and repair.
- `test/sharedModerationFuzz.test.js` covers shared moderation parse and validation hardening.

Current gap: these fuzzers do not yet stress the new row-scoped progress operation envelope, compact projection durability, storage false/timeout behaviors, or the distinction between accepted progress and WAL-applicable changed progress.

Some of the single-case assertions already exist in `test/swSynthetic.test.js`,
including no-op progress producing `progressOperation.changed === false`,
non-durable progress skipping shadow WAL parity, and storage timeout/failure
reporting. The missing value is combinatorial coverage across mixed row states,
batch rows, fault modes, and ordering interleavings.

The current draft fuzzers are intentionally conservative safe-lane artifacts:
they are deterministic matrices with seed-shuffled ordering, not full
combinatorial generators yet. Treat them as executable guardrail scaffolding
and regression probes until the active source/test cycle is available for
broader generated fuzz.

## Principles

- Prefer deterministic seeded fuzzers with clear failing seed output.
- Keep quick profiles in `npm test`; put long and malicious profiles behind explicit scripts.
- Assert invariants after every step, not only at the end of a run.
- Record enough trace context to reproduce: seed, step, operation, href, attempt id, tab id, storage fault mode, and current queue/progress status.
- Treat `recorded`, `durable`, `progressProjectionDurable`, `progressOperation.changed`, and `progressShadowWal.reason` as separate facts. Tests should fail if those collapse into one ambiguous success bit.
- It is acceptable to duplicate existing single-case assertions in a draft
  fuzzer while the active tests are moving. Mark those blocks with
  `TODO(remove-after-active-cycle):` so the duplication can be collapsed later.
- Draft fuzzers should not be listed in `package.json` until they are stable and
  the active dev/test cycle is available for integration.

## Fuzz Family 1: Progress Operation Envelope

Goal: prove row-event progress operation envelopes remain truthful as they become WAL-shaped.

Generate:

- Previous progress records: missing, transient, action-phase, terminal success, terminal failure, stale attempt, mismatched action kind.
- Incoming patches: no-op, sparse milestone, action started, stale attempt, newer attempt, terminal-looking nonterminal, unsupported status.
- Queue rows: active service-worker-owned, queued, terminal, durable-only, mismatched attempt.

Invariants:

- `progressOperation.accepted === true` only when the row event was accepted.
- `progressOperation.changed === false` must not be counted as a real WAL append candidate.
- A no-op should produce either no `progressShadowWal.checked` result or a clear `reason: "no-change"`.
- `progressOperation.durable === true` only when compact projection persistence succeeded.
- `progressOperation.previousRecord` and `nextRecord` must match the normalized reducer inputs and output for that row.
- Stale attempts and terminal regressions are rejected before compact projection and before shadow WAL parity checks.

Suggested test file:

- Active-cycle path: add a focused section to `test/swScenarioFuzz.test.js` if
  using the service-worker harness.
- Safe-slice path now: create a separate draft-only
  `test/progressOperationFuzz.draft.test.js` and run it directly with
  `node test/progressOperationFuzz.draft.test.js`. Do not wire it into
  `package.json` yet.
- The draft may duplicate the existing no-op/non-durable single cases, with
  `TODO(remove-after-active-cycle):` markers, so mixed generators can assert the
  same invariants while the canonical tests remain untouched.

## Fuzz Family 2: Storage Fault Injection

Goal: force every storage result distinction we care about.

Fault modes:

- `storage.local.get` throws.
- `storage.local.set` throws.
- `storage.local.set` returns `false`.
- `storage.local.set` delays past the serialized storage watchdog and later completes.
- Writes complete out of caller-visible order while the serialized tail still preserves real ordering.

Targets:

- `saveProfileNukeProgressRowProjection()`
- `coordinatorAuthority.apply()`
- `coordinatorAuthority.applyWithinStorageUpdate()`
- terminal-progress compatibility save
- row-event progress flush

Invariants:

- No shadow WAL `matched` metric for non-durable writes.
- Non-durable accepted progress carries an explicit non-durable reason.
- The storage tail does not advance before the timed-out operation really completes.
- Abandoned writes do not clobber later durable state.
- A timeout or fallback must schedule repair/reconcile only through the intended paths.

Suggested implementation:

- Extend the service-worker harness with a reusable storage fault scheduler:
  - by key prefix,
  - by call number,
  - by operation type,
  - by delay/throw/false behavior.

Safe-slice note: do not edit `test/lib/swHarness.js` during the active cycle.
For draft fuzzing, wrap `browser.storage.local.get` and
`browser.storage.local.set` inside the draft test after `loadServiceWorkerHarness`
returns. If the wrapper proves useful, promote it into the harness later.

## Fuzz Family 3: Batch Row-Event Results

Goal: prevent batch-level success from leaking into per-row acknowledgements.

Generate batches with mixed rows:

- accepted changed row,
- accepted no-op row,
- stale attempt,
- terminal-row-preserved,
- durable-only row,
- missing row,
- compact projection suppressed for all rows.

Invariants:

- Rejected rows never inherit `recorded`, `progressProjectionDurable`, or `progressShadowWal` success from accepted rows.
- `projectionSaved`, `projectionSuppressed`, and `shadowWal.skippedNonDurable` counters match accepted row counts.
- Per-row `progressOperation.rowKey` matches the normalized profile href for that row.
- Batch summary booleans are derived from per-row results and do not replace them.

Useful edge:

- Repeated no-op rows in a batch should not inflate WAL candidate counters.

## Fuzz Family 4: Snapshot-vs-WAL Differential

Goal: compare the future WAL path against the current snapshot/projection path before WAL becomes authority.

For each generated operation stream, run three models:

- Current service-worker snapshot/projection path.
- Shadow WAL projection through `walSnapshotStore`.
- A small independent oracle reducer for queue/progress row state.

Invariants:

- Final queue rows match for migrated authority operations.
- Final progress rows match for accepted changed progress operations.
- Ignored stale/duplicate/no-op records are ignored by both WAL and oracle.
- Terminal rows cannot be regressed unless the operation explicitly permits terminal overwrite.

This is the most important bridge test before switching any progress or queue path from snapshot authority to WAL authority.

## Fuzz Family 4A: Coordinator Authority WAL Restart Recovery

Goal: once the queue-authority WAL adapter is active enough to own recovery,
prove coordinatorAuthority WAL state survives service-worker restart and
projection rebuild without falling back to stale snapshot authority.

Generate:

- authority row mutations: queued to active, active heartbeat/lease refresh,
  active to terminal, retry/requeue, pause/cancel metadata, no-op same-status
  mutations, stale attempts;
- queue WAL append outcomes: append success, append suppressed, projection save
  suppressed, projection save throws, checkpoint generation switch boundary;
- restart points: before append, after append before projection, after
  projection, after compatibility snapshot, during checkpoint switch;
- storage state shapes: WAL newer than queue snapshot, queue snapshot newer than
  derived projection, missing compact views, corrupt/incomplete WAL generation.

Invariants:

- after restart, recovered coordinator authority current queue matches WAL plus
  the last complete checkpoint, not a stale compact projection;
- accepted durable authority operations are never lost across restart;
- suppressed projection writes schedule repair but do not invalidate WAL
  durability;
- stale attempts and no-op operations do not append queue WAL records;
- recovered queue, dashboard view, content queue index, and authority current
  state converge after repair/rebuild;
- diagnostic shadow WAL and authority WAL metrics stay separate.

Safe-slice note: do not implement this until the queue-authority WAL adapter
landing point is clear. For now, keep this as an explicit future target so the
generic snapshot-vs-WAL differential family does not hide queue-authority
restart semantics.

## Fuzz Family 5: Scheduler and Reconciler Ordering

Goal: shake the assumptions around ticks, repair, reconcile, and runtime tab ownership.

Random operations:

- enqueue storage-only row,
- resume,
- run reconcile tick,
- run repair tick,
- open worker tab,
- claim active row,
- tab removed,
- content ready,
- progress milestone,
- terminal progress,
- storage timeout during active claim,
- service-worker restart by reloading harness from storage.

Invariants:

- No durable active row remains without either a matching live actor or a scheduled reconcile/repair path.
- Volatile queued actions cannot block durable queued work after restart.
- Runtime active ownership is not confirmed before durable active ownership.
- Repair no-op churn remains bounded under repeated ticks.
- Terminal rows do not retain active tab/lease ownership.

This should extend `test/swScenarioFuzz.test.js`, because that file already has the right harness shape.

Safe-slice note: during the active cycle, prototype this as a separate draft
fuzzer that imports `test/lib/swHarness.js` and duplicates the small helper
functions it needs from `test/swScenarioFuzz.test.js`. Mark copied helpers with
`TODO(remove-after-active-cycle): merge back into shared fuzz helpers`.

## Fuzz Family 6: Large-State Storage Pressure

Goal: make scaling regressions fail locally before live metrics expose them.

Generate:

- 1,000, 5,000, and 10,000 queue/progress rows.
- Small row-event mutations against a few active rows.
- Dashboard/scoped content-page reads.
- Retry/requeue/terminal settlement over a small subset.

Invariants:

- Nonterminal row events do not write full queue snapshots.
- Nonterminal row events do not write full progress snapshots.
- Compact projection writes remain row/shard scoped.
- Dashboard/status reads avoid full queue/progress blobs except explicit diagnostic paths.
- Byte counters stay below configured thresholds for each profile size.

Keep 10,000-row runs out of ordinary `npm test`; make them an explicit script or long profile.

Safe-slice note: storage-pressure work is lower priority while source and test
files are active. It is likely to need package-script wiring and byte-threshold
tuning, so keep it behind the earlier operation-envelope and batch-result work.

## Safe Execution Slices

### Slice 1: Progress Envelope Draft Fuzzer

Create a draft-only fuzzer that exercises `applyCoordinatorRowEvent()` through
the service-worker harness and checks per-row result truthfulness.

Status: implemented as draft-only on 2026-05-24.

Scope:

- new file only: `test/progressOperationFuzz.draft.test.js`;
- direct execution only: `node test/progressOperationFuzz.draft.test.js`;
- no package script changes;
- no edits to existing tests or active implementation files.

Seed shape:

- current draft profile: 3 seeds, 8 generated cases per seed;
- later short profile target: 8 to 12 seeds, 20 to 40 generated cases per seed;
- environment override: `PROGRESS_OPERATION_FUZZ_SEED`;
- failing output includes seed, case index, previous progress status, queue row
  status, attempt id, patch status, and result summary.

Initial cases to generate:

- accepted changed action-phase milestone;
- accepted no-op milestone;
- stale attempt;
- terminal-row-preserved;
- action-kind mismatch;
- durable-only coordinator item;
- missing coordinator item;
- compact projection suppressed by direct storage wrapper.

Expected invariants:

- rejected rows have no `progressOperation.accepted === true`;
- no-op rows do not increment shadow WAL append or matched counters;
- non-durable accepted rows report `progressOperation.durable === false` and
  `progressShadowWal.reason === "non-durable"`;
- stale and terminal-preserved rows do not write compact projection records;
- `previousRecord` and `nextRecord` stay scoped to the normalized row key.

Current draft notes:

- This is a seed-shuffled deterministic matrix, not true generated
  combinatorial fuzz yet.
- Uses compact synthetic profile slugs like `FuzzProgress-<seed>-<case>` so
  subject normalization does not strip descriptive suffix tokens and create a
  false missing-row result.
- The no-op case intentionally performs one accepted row mutation first, then
  replays the persisted progress record and asserts shadow-WAL counter deltas
  across the no-op operation only.
- Direct validation on current checkout:
  `node test/progressOperationFuzz.draft.test.js` passed for seeds `0x5eed`,
  `0xc0de`, and `0x51a7e`.

### Slice 2: Batch Row-Event Draft Fuzzer

Create a draft-only fuzzer that sends mixed batches through the row-event path.
This should probably be separate from Slice 1 because the failure mode is
batch-summary leakage, not per-row reducer truth.

Status: implemented as draft-only on 2026-05-24.

Scope:

- new file only: `test/progressBatchFuzz.draft.test.js`;
- direct execution only;
- may duplicate Slice 1 setup helpers with
  `TODO(remove-after-active-cycle): share fuzzer setup helpers`;
- no package script changes.

Expected invariants:

- accepted rows do not donate `recorded`, `progressProjectionDurable`, or
  `progressShadowWal` success to rejected rows;
- batch `recorded` is only a summary and every row result remains authoritative;
- repeated no-op rows do not inflate WAL candidate, append, or matched counters;
- batch counters match row classes, not total rows.

Current draft notes:

- Uses concurrent `recordDeferredCoordinatorJobMilestone()` calls to exercise
  the service worker's own coalesced `applyCoordinatorRowEvents()` path without
  exporting or editing internals.
- Covers durable and projection-suppressed mixed batches for accepted changed,
  accepted no-op, stale, terminal-preserved, durable-only, and missing rows.
- Asserts projection durability through `progressProjectionDurable` and
  `progressOperation.durable`; the deferred milestone API's top-level
  `durable` field is only an acknowledgement alias for recorded rows.
- Direct validation on current checkout:
  `node test/progressBatchFuzz.draft.test.js` passed for seeds `0x5eed`,
  `0xc0de`, and `0x51a7e`.

### Slice 3: Storage Fault Wrapper Draft

Prototype storage fault scheduling inside a draft test rather than editing the
shared harness.

Status: implemented as draft-only on 2026-05-24, with one current-code failure
left visible.

Scope:

- new file only: `test/storageFaultFuzz.draft.test.js`;
- add wrapper code inside the draft fuzzer only;
- fault by operation (`get` or `set`), call index, key prefix, and behavior
  (`throw`, `false`, `delay`);
- direct execution only.

First targets:

- progress row projection `set` returns false;
- progress row projection `set` throws;
- authority apply `set` throws;
- authority apply timeout;
- late completion after timeout followed by a later durable write.

Expected invariants:

- no `shadowWal.matched` metric for non-durable writes;
- timeout fallback does not advance durable state;
- late abandoned writes do not clobber later durable state;
- repair/reconcile scheduling counters appear only on intended paths.

Current draft notes:

- Projection `storage.local.set` returning `false` passes the intended
  accepted/non-durable invariant.
- Projection `storage.local.set` throwing currently fails the intended
  invariant: the row event is not accepted as non-durable. The failing command
  is `node test/storageFaultFuzz.draft.test.js`; failure repeats for seeds
  `0x5eed`, `0xc0de`, and `0x51a7e` at `projection-throw`.
- Authority `set` throw, authority timeout fallback, and serialized-tail
  abandoned-write suppression all pass in the same draft fuzzer.
- Do not fix the implementation in this mission while active source files are
  out of scope. Carry the projection-throw failure as a current-code finding
  for the later implementation lane.

### Slice 3A: Coordinator Authority WAL Restart Draft

Next draft target: exercise the real queue-authority WAL lane directly before
promotion work. This should specifically catch the production bug where repeated
terminal-progress appends reuse `seq: 1` instead of monotonically increasing WAL
sequence numbers.

Scope:

- likely new file: `test/coordinatorAuthorityWalRecoveryFuzz.draft.test.js`;
- direct execution only until stable;
- no package script changes during active-cycle isolation.

Expected first target:

- repeated terminal-progress authority appends;
- service-worker restart recovery from stored queue WAL;
- projection save failure after WAL append;
- WAL append/storage failure before projection;
- stale attempt rejection before WAL append;
- checkpoint-covered records after checkpoint switch or restart;
- explicit sequence monotonicity checks for every appended WAL record.

### Slice 4: Integrate After Active Cycle

After the active source/test cycle clears:

- remove duplicated draft helpers or move them into shared fuzz helper modules;
- rename stable draft files from `*.draft.test.js` to normal test files;
- add package scripts for targeted profiles;
- decide which short profile belongs in `npm test`;
- delete any `TODO(remove-after-active-cycle):` duplication markers that were
  resolved.

## Implementation Order

1. Refine this note with active-cycle constraints and safe draft slices.
2. Add progress operation-envelope draft fuzz with a short seed count.
3. Add batch row-event result draft fuzz, even if it duplicates some setup from
   Slice 1.
4. Add storage fault wrapper draft fuzz.
5. Add coordinatorAuthority WAL/restart recovery fuzz after the queue-authority
   WAL adapter landing point is clear.
6. Extend scheduler/reconciler chaos in a draft fuzzer, then merge into
   `swScenarioFuzz` only after active-cycle clearance.
7. Add large-state pressure fuzz as an explicit long-running profile after
   package-script edits are safe.
8. Add snapshot-vs-WAL differential fuzz once the operation envelope is stable
   enough to build records from it.

## Suggested Commands

Short profile:

```bash
npm test
```

Targeted profiles to add:

```bash
npm run test:progress-fuzz
npm run test:storage-fault-fuzz
npm run test:sw-fuzz
```

Draft-only commands during active-cycle isolation:

```bash
node test/progressOperationFuzz.draft.test.js
node test/progressBatchFuzz.draft.test.js
node test/storageFaultFuzz.draft.test.js
# future, after queue-authority WAL recovery point is clear:
node test/coordinatorAuthorityWalRecoveryFuzz.draft.test.js
```

Long profiles to add:

```bash
npm run test:wal-fuzz:long
npm run test:storage-pressure-fuzz:long
```

## Acceptance Criteria

- Failing fuzz output includes enough seed and step trace to reproduce directly.
- New fuzzers preserve the current no-op progress/WAL-candidate semantics on
  current code and report any current regressions with seed and trace.
- The short profile is stable enough for `npm test`.
- Long profiles can run out of band without changing default test time materially.
- Metrics asserted in fuzz tests match the semantics we want for live metrics: no durable false positives, no no-op WAL inflation, no hidden batch-level success.
