# Reconciler-First Fallback Architecture

Date: 2026-05-20

Status: supporting architecture detail.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This note contains
the detailed rationale and pivot criteria for the reconciler model.

## Context

The current system is intended to be operate-first:

```text
enqueue durable work
open/adopt a tab
content script claims exact attempt
profile action runs
terminal progress records result
release slot
fill next slot
```

Repair is supposed to be exceptional. It catches missed events, service-worker
restart fallout, tab disappearance, delayed storage writes, and old-version
state.

But there is a plausible evolution where repair becomes the only mechanism that
reliably converges state. At that point it is no longer repair. It is the
scheduler/reconciler, and the eager operate path is only a latency optimization.

This note captures that possible pivot so we can recognize it deliberately
instead of arriving there accidentally.

## Decision Question

Ask this directly:

If the explicit operate path were disabled, would the repair/recovery loop still
eventually drain Current Work correctly?

If yes, the repair loop is already close to being the real scheduler.

If no, but ordinary successful jobs still frequently need repair to finish, the
system is in the dangerous middle: neither path is clearly authoritative.

## When To Consider The Pivot

Consider a reconciler-first design if measurements show any of these:

- a large fraction of jobs complete only after repair;
- terminal progress commonly needs later repair to settle queue rows;
- tab removal and stale-tab cases keep requiring special repair branches;
- live testing regularly succeeds only after manual resume/repair;
- fuzzer failures cluster around disagreement between runtime maps and durable
  queue rows;
- storage timeout fallback needs to start or continue work before durable enqueue
  is proven;
- pumps and repairs are more reliable than direct transition callbacks.

This does not mean the current design failed. It means the browser extension
runtime may be pushing the system toward a reconciler architecture.

## Reconciler-First Model

The durable queue becomes desired state.

```text
desired durable state:
  jobs, attempts, statuses, leases, owners, source settlement

observed volatile state:
  live tabs, content-script markers, heartbeats, visible page URL, lease pings

observed durable events:
  tab opened, claim accepted, milestone, terminal, tab removed, timeout

reconciler:
  compares desired state and observed state
  applies reducer events
  issues minimal side effects
```

The scheduler tick becomes the normal processing mechanism:

```text
load durable queue
load recent observed events
scan live tabs
prune impossible runtime state
adopt matching live tabs
open tabs for runnable queued attempts
nudge content scripts that should claim
mark stale attempts
settle terminal rows
release slots
schedule next tick only if work remains
```

In this model, `repairCoordinatorStorage...` should be renamed to something like
`reconcileCurrentWork`, `schedulerTick`, or `advanceCurrentWork`.

## Role Of The Fast Path

The fast path remains useful, but it does not own correctness.

Fast path after enqueue:

```text
write durable desired job
request immediate scheduler tick
return durable enqueue result
```

Fast path after terminal progress:

```text
write durable terminal event
request immediate scheduler tick
```

Fast path after tab removal:

```text
write observed tab-removed event or detach runtime state
request immediate scheduler tick
```

The fast path is allowed to reduce latency. It is not allowed to bypass durable
authority.

## Authority Rules

Reconciler-first only works if authority is explicit:

- Durable queue rows authorize work.
- Durable attempt identity authorizes a content-script action.
- Durable pause generation authorizes pause/resume decisions.
- Live tabs are observations, not authority.
- Progress mirrors are observations, not authority unless converted into reducer
  events under clear rules.
- Raw enqueue request data is not executor authority after a storage timeout.
- In-memory `queuedTabActions`, `queuedTabMetadata`, and `activeQueuedTabs` are
  caches rebuilt from durable state and live observations.

## Reducer Events

A reconciler-first design should drive the same reducer regardless of trigger.

Candidate events:

- `job-enqueued`
- `attempt-created`
- `tab-open-requested`
- `tab-opened`
- `tab-adopted`
- `claim-nudged`
- `claim-accepted`
- `milestone-recorded`
- `terminal-recorded`
- `tab-removed`
- `heartbeat-missed`
- `lease-expired`
- `pause-requested`
- `resume-requested`
- `cancel-requested`
- `source-settled`

The service worker, content script, coordinator page, alarms, and synthetic
harness should all feed these events through one transition model.

## Scheduler Tick Contract

Input:

- durable queue;
- durable runs;
- durable source/pending records;
- recent progress/event records;
- live tab snapshot;
- paused state and generation;
- in-memory runtime cache if available.

Output:

- durable queue/runs/source updates;
- runtime cache updates;
- side effects to perform: open tab, send nudge, close tab, inject content
  script, schedule next alarm.

The tick should be idempotent. Running it twice with no changed inputs should
produce no new side effects.

## Benefits

- Service-worker restart becomes normal, not exceptional.
- Tests can exercise the scheduler against durable state snapshots.
- Repair is no longer a second authority path.
- Live tab adoption, stale tab cleanup, and retry become ordinary reconciliation
  cases.
- Fuzzer failures become easier to minimize because every step is a reducer
  event plus a scheduler tick.

## Costs

- More up-front structure.
- Some latency if every operation waits for durable state before side effects.
- Requires a clean event/reducer boundary.
- Existing compatibility progress paths must be demoted or explicitly adapted.
- Metrics and debugging must distinguish desired state, observed state, and
  issued side effects.

## Migration Path

1. Measure first.

   Use `queue-wakeup-metrics-model-2026-05-20.md` to decide whether the current
   operate-first model is healthy enough.

2. Rename concepts without changing behavior.

   Start calling the broad repair/resume pass `scheduler tick` in notes and
   local helper boundaries if metrics show it is normal-path work.

3. Centralize tick entry points.

   Route enqueue, terminal progress, tab removal, resume, and alarms through a
   common scheduler function instead of each directly calling several helpers.

4. Make side effects require durable rows.

   Remove executor startup from raw request fallback. A timed-out durable enqueue
   schedules reconciliation, but does not open tabs from raw inputs.

5. Move runtime maps to cache status.

   Treat `queuedTabActions`, `queuedTabMetadata`, and `activeQueuedTabs` as
   derived runtime state. The scheduler can rebuild or prune them.

6. Add reducer events for current special cases.

   Convert tab removal, stale active timeout, terminal progress, and pause/cancel
   into reducer events.

7. Make repair tests into scheduler tests.

   Existing synthetic repair tests become tests of the primary scheduling model,
   not exception-path tests.

## Exit Criteria For Staying Operate-First

Stay with the current operate-first architecture if metrics show:

- most jobs complete by direct terminal transition;
- repairs are mostly restart/manual/old-state recovery;
- pumps have high yield during active work;
- no executor starts without durable queue authority;
- tab cleanup invariants hold under fuzzing;
- wakeups per job remain bounded.

## Exit Criteria For Pivoting

Pivot to reconciler-first if metrics show:

- repair is required for ordinary job completion;
- direct paths frequently leave active rows needing later convergence;
- wakeup counts grow far faster than job counts;
- live testing depends on manual repair/resume to make progress;
- fuzzer failures repeatedly involve disagreement between direct side effects and
  durable queue state.

## Summary

The problem is not reconciliation. Browser extension scheduling almost requires
it.

The problem is ambiguity. If repair is the actual mechanism that makes the
system correct, it should be promoted, renamed, measured, and tested as the
scheduler. Then operate-first paths become immediate requests for reconciliation,
not a competing source of truth.
