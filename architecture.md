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

## Runtime Caches

Runtime structures such as `queuedTabActions`, `queuedTabMetadata`, and
`activeQueuedTabs` are caches derived from durable rows and live observations.
They must not block scheduling unless they match durable active authority.

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
queue WAL storage has now begun for `mbCoordinatorQueueWal`, using
generation-local record segments plus a small manifest cursor. Segment numbers
reset on each checkpoint generation, while WAL record sequence numbers remain
monotonic within the active logical WAL generation. Remaining work is hardening
segmented recovery, reducing compatibility mirrors, and cleaning old physical
generations. See
[queue-wal-segmented-record-followup-2026-05-27.md](queue-wal-segmented-record-followup-2026-05-27.md).

Terminology: older code, metrics, and notes may still say `compaction`. In the
architecture, read that as checkpoint generation switching plus later
old-generation cleanup, not as a garbage-collection model.

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
- [shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md):
  shared moderation design.
- [top-level-rethink-1.5.md](top-level-rethink-1.5.md): historical durable
  job model that informed the current line.
