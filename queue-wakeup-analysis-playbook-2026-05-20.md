# Queue Wakeup Metrics Analysis Playbook

> **Status: REFERENCE** (24 Oct 2026). Playbook for reading the wake-up metrics (20 May). Counter names need a refresh. Reference or dated data. Check before relying on its numbers. Register: [notes register](docs/notes-register.md).

Date: 2026-05-20

Status: supporting analysis playbook.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this after live
metrics collection to decide whether wakeups are healthy or repair-shaped
normal operation.

## Purpose

Use this after live testing has collected `mbQueueWakeupMetrics`. The goal is
to make the first few data passes comparable, and to keep the conclusion tied
to the authority model rather than to raw wakeup volume alone.

Related notes:

- `queue-wakeup-metrics-model-2026-05-20.md`
- `historical/reconciler-first-fallback-architecture-2026-05-20.md`

## Collection Command

From this repo:

```bash
node tools/cdp/queue-wakeup-metrics.js
```

Use the normal CDP overrides if needed:

```bash
MB_CDP_PORT=9223 MB_EXTENSION_ID=ajcjckiafbnhioeafaejlaehkmdcdeha node tools/cdp/queue-wakeup-metrics.js
```

To analyze an exported JSON metrics object instead of the live browser:

```bash
node tools/cdp/queue-wakeup-metrics.js --file metrics.json
```

For raw stored data plus the derived summary:

```bash
node tools/cdp/queue-wakeup-metrics.js --raw
```

## Current Instrumentation Caveat

At this snapshot, `shared/js/sw.js` has the metrics store and persistence
plumbing, plus `serviceWorker.started` and `storageUpdate.*` counters. The full
model still needs explicit `nudge.*`, `pump.*`, `repair.*`, and `job.*`
counters before it can answer the scheduler-health question directly.

That means the first collected run can already answer storage-timeout questions:

- are storage updates timing out;
- do timeout fallbacks get returned;
- are abandoned late writes being suppressed;
- does the service worker restart frequently during the run.

It cannot yet prove that nudges and pumps are healthy, because those counters
are not wired broadly enough.

## First-Pass Readout

For each live run, capture:

- `summary.storage.started`
- `summary.storage.completed`
- `summary.storage.timedOut`
- `summary.storage.fallbackReturned`
- `summary.storage.abandoned`
- `summary.storage.lateWriteSuppressed`
- `summary.storage.timeoutRatePct`
- `summary.storage.fallbackRatePct`
- `summary.instrumentation`
- `summary.missingForFullModel`
- `summary.journal.tail`

Interpretation:

- `timedOut > 0` means the timeout fallback path was exercised.
- `fallbackReturned > 0` means callers may have continued after a storage
  timeout result.
- `abandoned > 0` means a timed-out write later completed and was recognized as
  abandoned.
- `lateWriteSuppressed > 0` is desirable after timeout; it says the late write
  was blocked from mutating durable state.

## Important Follow-Up Correlations

If storage timeouts appear, inspect whether any executor work started from raw
request items after the timeout. That is the critical authority bug class:
storage timeout may schedule repair or resume, but should not authorize executor
tabs unless durable Current Work exists.

Correlate metrics with these storage/queue checks:

```bash
node tools/cdp/queue-storage-summary.js
node tools/cdp/queue-counts.js
node tools/cdp/queue-summary.js
```

Look for:

- active queue rows that do not correspond to live tabs;
- live profile tabs without durable active rows;
- queue rows created after a storage timeout by a late write;
- fallback responses that report no durable enqueue but are followed by executor
  tab activity.

## Once Nudge/Pump/Repair Counters Are Wired

Use these as the first thresholds:

- nudge acceptance above 60 percent for ordinary queued-tab claims;
- pump yield above 30 percent while the queue is draining;
- fewer than 3 pumps per ordinary job;
- fewer than 2 claim nudges per ordinary job;
- direct terminal completion above 90 percent outside restart windows;
- completed-only-after-repair below 5 percent outside restart windows.

Warnings:

- nudge acceptance below 30 percent;
- duplicate pump no-op ratio above 50 percent;
- repair requested for most clean jobs;
- more wakeups than jobs by an order of magnitude.

Critical:

- executor starts after storage timeout without durable Current Work;
- pump opens work from raw request data;
- nudge action runs without matching attempt identity;
- repair is required for ordinary terminal success to become durable.

## Decision Procedure

1. Separate restart windows from clean operation.

   MV3 service-worker restart recovery is expected to need extra wakeups.

2. Check storage timeout authority first.

   Any executor startup without durable queue authority should be fixed before
   interpreting wakeup ratios.

3. Check whether ordinary jobs finish by direct transition.

   If terminal progress usually updates Current Work and releases the slot
   without repair, the operate-first model is still viable.

4. Check whether repair is becoming the real scheduler.

   If ordinary success usually needs repair to converge, use
   `historical/reconciler-first-fallback-architecture-2026-05-20.md` as the migration
   guide rather than adding more local patches.

5. Classify extra wakeups before removing them.

   Label each cluster as restart recovery, content-script readiness,
   duplicate scheduling, missing direct transition, or authority bypass.

## What To Ask The Other Worker For

After a few runs, ask for:

- the `tools/cdp/queue-wakeup-metrics.js` summary output;
- the corresponding `queue-storage-summary` output;
- whether live execution saw manual resume/repair;
- any extension error details around storage timeout windows;
- one concrete job trace for a timeout or repair-dependent job.

That is enough to decide whether to continue tightening operate-first
transitions or begin moving toward an explicit scheduler/reconciler tick.
