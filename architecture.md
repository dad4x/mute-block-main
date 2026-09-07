# Mute Block Architecture

Date: 2026-05-20

This is the canonical architecture front door for the active `1.6`/`2.0`
stabilization line. Use [planning.md](planning.md) for priority and sequencing;
use this note for the durable model and design constraints.

## Core Authority Model

The service worker is the mutation authority for queued work.

Durable queue state is the desired state. Browser tabs, content-script state,
progress mirrors, dashboard state, and runtime maps are observations or caches
unless they have been converted into reducer-approved durable events.

The central rule:

```text
durable queue state + live browser observations
  -> bounded reconcile tick
  -> durable state changes + minimal side effects
```

Direct actions are allowed to reduce latency. They are not allowed to become a
second authority path.

## Scheduler / Reconciler

The live-debug work has shown that "repair" is increasingly the normal
processing mechanism. Treat that deliberately: the normal queue processor should
be a reconciler/scheduler tick, not several separate direct paths plus a broad
exception handler.

Terminology target: when the queue WAL is the authority, stale or missing
derived state is not normally "repair". It is reconciliation or materialization
from authority. Use:

- `apply` for reducer/authority operations and WAL record application;
- `resolve` for ambiguity decisions such as profile target resolution;
- `reconcile` for comparing authority, runtime actors, and derived state;
- `materialize` for writing derived runs/events/progress/views from authority;
- `recover` for startup/crash rebuild from checkpoint plus WAL tail;
- `audit` or `validate` for mismatch detection without mutation;
- `legacy cleanup` for one-time snapshot-era or invariant cleanup.

Long term, ordinary scheduler and derived-state paths should not use `repair`
names. Reserve `repair` only for true authority corruption or unavoidable legacy
compatibility cleanup while the transition is in progress.

Each tick should be two-phase:

1. Observe: load the bounded durable state needed for the tick, inspect owned
   tabs and candidate tabs, collect content-script claims, challenge state, and
   recent progress.
2. Decide and apply: produce durable transitions and side effects, then perform
   them under token checks and budget limits.

Important fixed-point cases:

- `queued + no runtime`: durably claim, then open/nudge as provisional side
  effect.
- `active + matching confirmed runtime`: continue, observe, or nudge.
- `active + no matching runtime`: adopt by token or release/requeue/fail.
- `runtime + no matching durable active row`: detach/close as orphan or stale
  provisional fallout.
- `terminal + runtime`: close/detach.
- `challenge/no progress timeout`: retry or fail according to policy.

Confirmation requires row id plus attempt/claim token, and tab id where
applicable. Row id alone is not enough under delayed storage writes.

## Runtime Queue Boundary

Runtime structures such as `queuedTabActions`, `queuedTabMetadata`, and
`activeQueuedTabs` are caches derived from durable rows and live observations.
They must not block scheduling unless they match durable active authority.

The volatile queue runtime should be split from the service-worker monolith the
same way durable storage, machine reducers, dashboard projections, preferences,
and the flight recorder have been split. The split exists to hide capability:
ordinary code should not mutate raw runtime arrays/maps directly.

`swqueueRuntime` owns volatile executor state:

- queued activation intents;
- active and pending tab attachments;
- queued-tab metadata;
- owned-tab parent/child maps;
- profile-open reservations;
- canceled or paused runtime owner state;
- removed/stale runtime tab markers.

The module does not own durable queue state. It exposes operations such as
`enqueueActivationIntent`, `consumeActivationIntent`,
`requeueActivationIntent`, `dropRuntimeActionAt`,
`patchQueuedTabMetadata`, `setPendingTabAction`, `deleteActiveQueuedTab`,
owned-tab helpers, and profile-open reservation helpers. Those operations may
attach browser effects to a machine attempt, but they must not decide queue
status or reconstruct durable work from storage.

The current split hides its volatile collections behind named methods; `sw.js`
does not destructure raw runtime maps/arrays. New code should use the named
runtime methods, and follow-up slices should keep moving queue policy out of
the service-worker monolith without re-exposing those collections.

Runtime-surface matching now goes through `swqueueRuntime.getRuntimeSurface`.
`sw.js` still supplies durable row matching policy, but the runtime module owns
enumeration of active tab handles, pending actions, and activation intents for
that query.

`swquoraTabs` owns Quora tab/window URL classification and live profile-tab
indexing. `sw.js` still decides what a candidate tab means for durable queue
authority, but raw Quora URL, challenge, non-profile landing, and profile-tab
map logic is no longer embedded in the machine file.

`swprojections` owns rebuildable shard-key mechanics for compact read models.
Authority writes still flow through the storage/machine path; projection helpers
only name deterministic shard keys and default payload shapes.

`swmessages` owns runtime-message action normalization and labeling. Message
handlers still live in `sw.js` while they touch queue authority, but the message
boundary now normalizes inputs before dispatch.

`swexecutor` owns browser-tab executor effects that do not decide queue
authority: timed tab creation and target-URL commit verification/retry. The
service worker passes browser, timing, metric, recorder, and normalization
capabilities into that module; durable activation, rollback, retry, and
terminal decisions remain in the machine/service-worker layer.

## Scheduler Boundary

Scheduler timers and browser alarms are non-persistent runtime effects. They
are not durable queue authority, but their state must still be hidden behind a
single capability boundary so callers cannot independently mutate timeout
handles, due times, alarm bookkeeping, or reconcile backoff counters.

`swscheduler` owns volatile scheduler slot bookkeeping. `sw.js` still owns the
current scheduling policy and browser alarm names, but resume/reconcile due
times, timeout handles, alarm persistence state, stale alarm suppression, and
reconcile backoff now move through scheduler-slot operations. In tests, the
slot receives the service-worker clock/timer functions so fake timer behavior
matches production scheduling semantics.

Every activation intent should carry machine identity: `attemptId`,
`attemptNumber`, `coordinatorKey`, `profileHref`, `ownerTabId`, and an intent
source category. Repair/reconcile code may delete stale runtime state; if it
needs new work, it submits a machine event or requests a fresh activation
intent from current authority instead of rebuilding `queuedTabActions`
privately.

Use separate concepts for:

- candidate tab: visible/live tab that might match a row;
- provisional actor: side effect that has been issued but not durably
  confirmed;
- confirmed actor: durable active row and runtime tab/action match by token;
- orphan actor: runtime work with no durable authority;
- stranded active row: durable active row with no confirmed runtime actor.

Both orphan actors and stranded active rows are ordinary reconcile cases.

## Storage Authority

Ordinary queue/progress/runs changes should not be scattered full-map
load/edit/save operations. The storage authority layer should make mutation
reasons explicit and keep compatibility paths from creating truth.

### Deleted Legacy Surfaces

Legacy full progress storage and repair-style compatibility are deleted
architecture, not deprecated architecture. The full profile progress blob key,
legacy progress runtime actions, dashboard repair request aliases, legacy repair
alarms, progress-to-queue legacy import switches, repair operation kinds, and
repair metric namespaces must not be reintroduced as live product surfaces.

Current progress storage is compact projection state only. Queue authority is
the queue WAL and its checkpoints; reconciliation may materialize projections
from authority, but compatibility progress state must not write, retry,
schedule, throttle, import queued work, or influence queue drain.

The browser-local storage adapter factory lives in `swstorage`, alongside the
WAL/checkpoint helpers. `swstorage` also owns the serialized storage update
queue and its non-persistent state: active storage context, tail promise, depth,
abandoned update tokens, timeout bookkeeping, and storage-update serialization.
`sw.js` injects browser timers plus queue-specific hooks for metrics,
diagnostics, timeout recovery, and post-storage continuations, but it no longer
mutates those queue internals directly.

`swCoordinatorQueueWal` owns the coordinator queue WAL's synchronous
storage-shape helpers: physical-key classification, WAL store defaults and
normalization, and WAL remove-record construction. It exists to keep those
details out of reach of ordinary reconcile code. The queue WAL's `async`
load/persist/checkpoint-switch operations stay in `sw.js` rather than moving
into that module -- see "Module Extraction And The Test Harness Realm
Boundary" below for why that split is not just a style choice.

Current cleanup requirements:

- reason-tag all snapshot writes;
- inventory full-state load/save call sites;
- quarantine or remove compatibility writers;
- prevent content scripts from writing coordinator authority maps directly;
- keep executor startup behind durable authority;
- add tests that make new direct authority writes visible.

Cleanup end state:

- queue WAL records are the durable row authority;
- raw `mbCoordinatorQueue` is a checkpoint/compatibility mirror, not the
  per-row authority path;
- `mbProfileNukeProgress` is not a queue-authority input and does not receive
  ordinary milestone or terminal mirror writes;
- progress views, progress shards, queue views, runs, events, source-post
  pending records, and remembered post state are derived materializations;
- derived materialization failure never poisons an already-durable queue WAL
  acknowledgement;
- startup, dashboard, content, executor, and reconcile reads use projected
  current authority instead of raw queue/progress snapshots;
- legacy progress request handlers either reroute valid current-attempt rows to
  job progress/WAL authority or reject; they do not fall back to full progress
  snapshot writes;
- broad progress-derived queue mutation is split into explicit, tested
  materializers or deleted;
- ordinary code uses `reconcile`, `materialize`, `recover`, `resolve`, and
  `apply` names; `repair` remains only for true authority corruption or
  explicitly bounded legacy cleanup.

The target storage design is WAL plus A/B checkpoints:

- ordinary mutations append compact reducer-shaped records;
- projection is `last checkpoint + ordered WAL records`;
- checkpoint generation switches write full checkpoints only when useful;
- A/B checkpoints provide a recoverable alternate snapshot;
- gzip is the first production compression target for checkpoint snapshots, with
  raw JSON fallback;
- WAL is durability/replay format, not an alternate state machine.

The logical WAL and checkpoint model is separate from the physical storage
adapter. Correctness and authority isolation came first; segmented physical
queue WAL storage has landed for `mbCoordinatorQueueWal`, using generation-local
record segments plus a small manifest cursor. Segment numbers reset on each
checkpoint generation, while WAL record sequence numbers remain monotonic within
the active logical WAL generation. The active generation has a soft threshold
that schedules a checkpoint generation switch, and a hard segment limit that
blocks new durable queue WAL appends until the switch can make room. Hydration
fails closed when the manifest references a missing or identity-mismatched
committed segment. Extra orphan segment keys that are not committed by the
manifest are ignored. Covered old-generation segment keys are retired only
after the new checkpoint generation switch is durable. Remaining work is
reducing compatibility mirrors and shrinking old progress/runs materialization.
See
[queue-wal-segmented-record-followup-2026-05-27.md](queue-wal-segmented-record-followup-2026-05-27.md).

Terminology: older code, metrics, and notes may still say `compaction`. In the
architecture, read that as checkpoint generation switching plus later
old-generation cleanup, not as a garbage-collection model.

## Module Extraction And The Test Harness Realm Boundary

**Resolved 2026-09** (`test/lib/swHarness.js`, commits `db12da9`,
`372f5c9`, `f845a99`): the harness now compiles `sw.js` and every module
it (transitively) requires into the *same* contextified `vm` sandbox via
a hand-rolled in-realm CommonJS loader (`createSharedRealmRequire`),
instead of sandboxing `sw.js` alone while its ~69 required sibling
modules ran via a plain `require()` into the outer Node process. This
matches production, where webpack bundles everything into one realm.
Landing it collapsed 69+ real realm crossings to zero across the whole
require graph and, doing so, exposed (not caused) a genuine pre-existing
concurrency bug in `restoreActiveLiveCoordinatorQueuedTabAction` that the
old harness's extra microtask ticks had been masking -- confirmed via A/B
(the bug reproduced with the realm fix in place and did not reproduce
without it, against identical `sw.js` logic) before being fixed
separately. See
[sw-state-machine-decomposition-plan-2026-09-01.md](sw-state-machine-decomposition-plan-2026-09-01.md)'s
"Phase 0" section for the full design and rollout history. The
constraint described below no longer applies to new extractions -- an
`async` function, or one that builds/chains a Promise into another
module, can now move into its own module without a realm penalty either
way. The history is kept below because the underlying mechanism (and the
two confirmed regressions that motivated fixing it) are still useful
context for anyone extending the harness further.

`sw.js` used to run inside a `vm.createContext` sandbox in tests, with
`Date` and timers injected so fake-timer control works, while a module
loaded into the surrounding test process via a plain `require()` lived in
a different V8 realm from that sandboxed `sw.js` source.

A same-realm `await` chain costs one microtask tick. The identical chain
crossing a vm/real-Node realm boundary costs two, in either direction. This
is not a fake-timer bug and injecting the clock correctly into an extracted
module is necessary but not sufficient to avoid it: the extra tick changes
when a promise settles relative to other concurrent promises, which can
silently reorder operations that a reconcile tick is racing, with no
difference in the moved code's logic.

Confirmed while attempting to extract the coordinator queue WAL's async
persist/load/checkpoint-switch path into its own module (2026-09): the moved
code was byte-identical to what it replaced and the fake clock was correctly
injected, but two test ranges failed reliably with the extraction in place
and passed reliably without it. The cause was repeated, bidirectional realm
crossings in that path -- vm-sandboxed code awaiting the extracted module's
async functions, and the module awaiting vm-injected async capabilities --
each crossing doubling its tick cost and compounding across the reconcile
tick's concurrent work.

**(Historical -- resolved, see above.)** Constraint that used to apply to
future extraction: a function with no `async` keyword and no Promise
chain in its body could be pulled into its own module freely; it carried
no realm penalty either way. An `async` function that participated in
ordering within a reconcile tick (queue WAL persist, checkpoint
switching, and similar) had to stay in `sw.js` unless the test harness's
module-loading strategy changed to put an extracted module in the same
realm as the vm-sandboxed source. That strategy change is what "Resolved
2026-09" above describes; this constraint no longer restricts new
extractions.

Refinement found during the sw.js decomposition plan's Slice 7 (2026-09):
"no `async` keyword" is not the same test as "no realm penalty." A
non-`async` function that *builds or returns a Promise chain reaching into
another already-extracted module* is still exposed to this, and the effect
can run in either direction, not just add cost. All `require()`'d modules
share one common realm with each other, separate from `sw.js`'s vm-sandboxed
realm. A chain that starts in `sw.js` and calls into one extracted module
crosses the boundary once. Moving the *starting* function into a second
extracted module changes nothing about where the call lands (still the same
target module, still one shared non-`sw.js` realm) but removes the crossing
that used to happen leaving `sw.js` -- collapsing a chain that used to cost
one crossing down to zero. That changed which of two same-named metric
increments landed in which epoch, deterministically breaking a test, with
no logic difference in the moved code. Confirmed by instrumenting and
comparing tick counts before and after the move.

Practical effect: before extracting a function -- sync-declared or not --
check whether it constructs, chains, or returns a `Promise`/`.then()` that
reaches into any other `require()`'d module (including one being extracted
in the same slice). If it does, treat it with the same caution as an
`async` function: moving it can shift realm-crossing parity in the
extracted direction, the removed direction, or both at once if the slice
also touches the target module, and any of those can silently reorder
concurrent reconcile-tick work. Grep for `.then(`, `Promise.`, and calls
into already-extracted modules, not just the `async` keyword.

## Dashboard And UI Surfaces

The dashboard and preferences are reporting/control surfaces. They may request
service-worker mutations or scheduler ticks, but they do not own queue truth.

Dashboard reads should move toward service-worker projected state. Snapshot
fallbacks may exist during migration, but they should be labeled stale-capable
and should not mutate authority.

## Content Scripts

Content scripts observe pages and perform foreground page actions after the
service worker grants authority for a specific attempt. They report claims,
milestones, terminal results, and page observations back to the service worker.

Content-side timeout or message failure must not trigger a direct durable write
to coordinator authority maps. It may record local observation only where that
cannot move queue truth.

After cleanup, content scripts should not send legacy `record-nuke-progress`
fallback messages. Active queued work reports through job milestone/terminal
messages that carry attempt identity and are accepted or rejected by the service
worker authority boundary. Non-queued local observations may update content-local
UI state, but they do not persist service-worker queue/progress authority.

## Shared Moderation Boundary

Imported moderation data is review and policy input, not a remote command
channel.

Shared moderation can provide:

- source documents;
- profile or Space recommendations;
- provenance;
- labels or intents;
- local-policy inputs.

Only local policy and local user action may turn that input into queued work.
Publication formats should preserve provenance and local decision history, but
publisher intent stays advisory.

## Metrics And Tests

Architecture health should be measurable:

- reconcile ticks requested, changed, no-op, rescheduled;
- durable active rows without confirmed actors;
- provisional/runtime actors without durable active rows;
- rows reclaimed, requeued, failed, or adopted by reconcile;
- pump/nudge/repair yield;
- storage timeout, deadline miss, fallback, abandoned, late-write suppression;
- snapshot write reason, bytes, rows, and call path;
- queued/active/terminal movement per tick window;
- legacy progress fallback rejection count;
- derived materialization failure and recovery count by materializer;
- WAL append bytes, record bytes, checkpoint generation switch count, active
  tail length, and physical segment count for segmented queue WAL storage.

The service worker should also keep a bounded in-memory diagnostic journal,
called the flight recorder. It records compact summaries of authority
mutations, WAL/storage outcomes, scheduler decisions, page observations, and
UI controls activated. The flight recorder is remotely probeable for failure
analysis, but it is not persisted, not replay input, not authority, and not a
trace file. See
[flight-recorder-plan-2026-06-04.md](flight-recorder-plan-2026-06-04.md).

Tests should exercise state snapshots directly:

- delayed storage confirmation;
- stale late writes;
- service-worker restart between claim/open/confirm;
- disappeared tabs;
- challenge tabs;
- durable active rows without actors;
- runtime actors without durable rows;
- compatibility progress trying to move terminal truth backward;
- repeated ticks reaching a fixed point or bounded progress;
- legacy progress requests with and without current authority;
- derived materialization failure after durable WAL acknowledgement;
- restart recovery from checkpoint plus WAL tail;
- segmented WAL orphan, missing-segment, and manifest edge cases.

## Supporting Architecture Notes

- [normal-reconcile.txt](normal-reconcile.txt): latest reconcile-first
  implementation framing.
- [reconciler-first-fallback-architecture-2026-05-20.md](reconciler-first-fallback-architecture-2026-05-20.md):
  detailed rationale and pivot criteria.
- [storage-authority-refactor-plan-for-review-2026-05-20.md](storage-authority-refactor-plan-for-review-2026-05-20.md):
  storage authority cleanup plan.
- [storage-wal-overlay-design-2026-05-20.md](storage-wal-overlay-design-2026-05-20.md):
  WAL/checkpoint design.
- [queue-wal-segmented-record-followup-2026-05-27.md](queue-wal-segmented-record-followup-2026-05-27.md):
  physical WAL segmentation follow-up.
- [flight-recorder-plan-2026-06-04.md](flight-recorder-plan-2026-06-04.md):
  bounded in-memory diagnostic journal for authority, scheduler, page
  observation, and UI action evidence.
- [shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md):
  shared moderation design.
- [top-level-rethink-1.5.md](top-level-rethink-1.5.md): historical durable
  job model that informed the current line.
- [sw-state-machine-decomposition-plan-2026-09-01.md](sw-state-machine-decomposition-plan-2026-09-01.md):
  proposed plan for splitting the remaining `sw.js` reconcile core into
  sync policy/builder modules now and an async orchestration layer once the
  test harness realm boundary is addressed.
