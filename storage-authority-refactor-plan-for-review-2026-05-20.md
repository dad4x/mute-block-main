# Storage Authority Refactor Plan For Review

Date: 2026-05-20

Status: active supporting plan.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This remains the
working storage-authority cleanup plan, subordinate to the active priorities in
`planning.md`.

## Purpose

This plan reorders the storage/WAL work around two high-priority cleanup goals:

1. Reduce the number of full-state `loadCoordinatorState()` /
   `saveCoordinatorState()` mutation points.
2. Eradicate backward-looking compatibility paths that can still create or
   mutate queue/progress truth.

The WAL overlay remains the intended destination, but it should not be layered
on top of a scattered full-map mutation model. First make the authority boundary
smaller and easier to audit; then move selected hot paths to WAL append records.

## Current Problem Shape

The live metrics show storage pressure from repeated full-map read/normalize/
recompute/write cycles. Batching has reduced some logical event pressure, but
ordinary operations still rewrite large top-level objects:

- `mbCoordinatorQueue`
- `mbCoordinatorRuns`
- `mbProfileNukeProgress`
- `mbCoordinatorEvents`

This is both a performance problem and a correctness problem. Every full-map
write path is a possible stale overwrite point, and every legacy fallback path
is a possible second authority.

## Priority A: Full-State Load/Save Reduction

### Goal

Make full-state load/save exceptional. Ordinary queue/progress mutations should
go through a small number of explicit authority helpers, and later through WAL
append/projection.

### First Slice

1. Inventory all callers of:
   - `loadCoordinatorState()`
   - `saveCoordinatorState()`
   - `metricStorageGet()` / `metricStorageSet()` for coordinator keys
   - direct `browser.storage.local.get/set()` for coordinator keys

   This inventory must be a checked repo artifact, not only an informal note.
   Use a call-site table with file, function, operation, authority reason,
   current risk, and intended disposition.

2. Classify each full-state access:
   - `ordinaryMutation`
   - `repair`
   - `displayRead`
   - `compatibilityFlush`
   - `checkpointSwitchCandidate`
   - `userMemoryNonAuthority`

3. Add reason-tagged metrics before changing behavior:
   - `snapshot.write.reason.ordinaryMutation`
   - `snapshot.write.reason.repair`
   - `snapshot.write.reason.compatibilityFlush`
   - `snapshot.write.reason.checkpointSwitch`
   - payload bytes and rows per reason

   Existing code or metrics may still use `compaction` as a legacy label. For
   this plan, that means checkpoint generation switch, not garbage collection.

   Display/dashboard activity should normally be a read reason, not a write
   reason. If display activity writes anything, classify it as an explicit
   `compatibilityFlush` or fix the path so display reads do not mutate storage.

4. Convert the hottest ordinary mutations first:
   - progress milestone/breadcrumb writes
   - terminal progress writes
   - queue active/terminal transitions
   - queued tab release/slot cleanup
   - manual retry/requeue paths

5. For each converted path, keep the existing reducer/state-machine semantics.
   The refactor is not allowed to loosen attempt validation, terminal
   protection, or service-worker authority.

### Acceptance

- There is a documented inventory of all full-state access paths.
- The inventory is checked into the repo as a table and reviewed with code.
- Each full snapshot write has an explicit reason metric.
- No hot ordinary mutation uses a one-off load/edit/save sequence.
- New code cannot call `saveCoordinatorState()` for ordinary mutation without a
  test or metric making that visible.
- A static/contract test prevents new unreasoned `saveCoordinatorState()` call
  sites.

## Priority B: Compatibility Path Eradication

### Goal

Remove or demote old compatibility paths so they cannot create terminal truth,
retry state, queue ownership, pending work, or progress authority.

### First Slice

1. Inventory all compatibility/legacy/fallback paths that can write:
   - coordinator queue
   - coordinator runs
   - profile nuke progress
   - pending space feed records
   - coordinator events

   This also must be a checked repo artifact. Every legacy path needs an
   explicit disposition so "temporary fallback" does not become permanent
   authority again.

2. Classify each path:
   - `deleteNow`
   - `convertToServiceWorkerAuthority`
   - `quarantineReadOnlyDisplayFallback`
   - `userMemoryNotQueueAuthority`

3. Remove content-side durable write fallbacks from queue/progress authority.
   Content may request service-worker mutation; it should not rewrite authority
   maps after a message timeout.

4. Convert service-worker legacy repair paths into explicit reducer events or
   WAL-ready operations. Avoid broad "repair from progress" logic that can infer
   terminal queue truth from compatibility mirrors.

5. Keep compatibility snapshots as display/downgrade aids only. They must be
   labeled stale-capable and must not be a mutation input for authority-sensitive
   decisions once projection is active.

### Acceptance

- No compatibility path can mark work terminal outside the current reducer lane.
- No compatibility path can resurrect, retry, cancel, or release queue work
  without service-worker authority validation.
- Content-side fallbacks are read-only or removed for coordinator authority.
- Tests fail if a compatibility path directly writes queue/progress authority.
- There is a delete/keep/quarantine table for every legacy path, with owner,
  risk, and removal condition.

## WAL Overlay Sequencing

The existing WAL/snapshot module is useful as a tested kernel, but the runtime
integration should be deliberately staged.

### Phase 0: Authority Cleanup Prerequisite

- Finish the full-state inventory.
- Add reason metrics for snapshot writes.
- Remove or quarantine compatibility mutation paths.
- Define a small authority adapter boundary around coordinator state.
- Add a thin production `chrome.storage.local` adapter now, with no behavior
  change, so later WAL/checkpoint work has a concrete integration seam instead
  of staying abstract until A/B checkpointing.

### Phase 1: Parallel WAL Diagnostics

- Append WAL records in parallel for selected progress milestones while keeping
  current snapshots authoritative.
- Compare projected state to snapshot state in diagnostics.
- Track:
  - WAL append bytes
  - full snapshot bytes
  - replay latency
  - projection mismatches
  - ordinary mutation snapshot writes

### Phase 2: WAL-First Progress

- Make high-frequency progress milestones WAL-first.
- Defer full progress snapshots to compatibility flush or checkpoint switch.
- Dashboard should prefer service-worker projected state when available.

### Phase 3: WAL-First Terminal And Queue

- Move terminal progress and queue transitions to WAL-first.
- Keep reducer validation before append and during replay.
- Full queue/progress/runs snapshots become compatibility snapshots, not the
  ordinary durability boundary.

### Phase 4: Checkpoint Generation Switches And A/B Checkpoints

- Extend the existing production storage adapter for checkpoint write/read,
  verification, active-pointer switching, and old-generation cleanup.
- Use A/B checkpoints for recovery-critical coordinator state:
  - queue
  - progress
  - runs
  - events
- Do not duplicate large user-memory/history keys such as `mbSpaceNukedPosts`
  unless there is an explicit storage-budget decision.
- Compress checkpoint snapshots, not ordinary WAL appends.

## Implementation Boundary

Create or expose a narrow service-worker storage authority layer:

- `loadProjectedCoordinatorState()`
- `appendCoordinatorWalRecords(records)`
- `applyCoordinatorWalRecord(projectedState, record)`
- `mutateCoordinatorProjection(operation)`
- `writeCompatibilitySnapshots(reason)`
- `compactCoordinatorWal(options)`
- `getCoordinatorProjectionForDashboard()`

New queue/progress code should use these helpers instead of directly calling
`loadCoordinatorState()` and `saveCoordinatorState()`.

The reducer remains the source of transition truth. WAL is a durability and
replay format, not an alternate state machine.

`mutateCoordinatorProjection()` should not accept a free-form callback that can
become another hidden mutation primitive. It should take an explicit operation
or reducer event shape, including kind, reason, target identity, attempt
identity, and expected transition.

## Tests To Add Early

- Static/contract test: every `saveCoordinatorState()` call site must provide
  or imply a snapshot-write reason.
- Static/contract test: the full-state access inventory is in sync with the
  current source call sites.
- Static/contract test: the compatibility delete/keep/quarantine table is in
  sync with known legacy/fallback write paths.
- Static/contract test: content scripts do not call storage setters for
  coordinator queue/progress authority keys.
- Runtime synthetic test: a timed-out service-worker message from content does
  not trigger a direct content-side authority write.
- Runtime synthetic test: compatibility progress cannot move an authoritative
  terminal queue row backward.
- Runtime synthetic test: manual retry/requeue persists through the authority
  lane before executor startup.
- WAL projection test: snapshot plus progress milestone records matches current
  full snapshot behavior.
- WAL projection test: stale attempt records and duplicate ids are ignored.
- Crash-point test: append acknowledged before service-worker restart is
  replayed; projection update without append is not acknowledged.

## Review Questions

1. Is the inventory/classification step strong enough to prevent hidden
   full-state writes from surviving under new names?
2. Which compatibility paths can be deleted immediately, rather than migrated?
3. Should the first authority adapter be implemented inside `sw.js` for easier
   migration, or extracted immediately to keep call sites honest?
4. What is the smallest live rollout that proves write volume drops without
   risking queue correctness?
5. Where should the line be drawn between recovery-critical coordinator state
   and large user-memory/history state?
6. What exact operation shape should replace the free-form
   `mutateCoordinatorProjection(reason, reducerCallback)` sketch?
7. Which display reads still cause writes, and should any survive as explicit
   compatibility flushes?

## Non-Negotiable Invariants

- Service worker remains the only mutation authority for queued work.
- Content scripts do not write coordinator authority maps directly.
- Terminal truth is created through reducer-approved service-worker paths only.
- Executor startup happens only after durable authority state exists.
- Compatibility snapshots can lag; projected state is the future authority.
- Full-map writes must be visible by reason, payload size, and call path.
