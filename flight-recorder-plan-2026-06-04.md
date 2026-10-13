# Flight Recorder Plan

Date: 2026-06-04

## Purpose

The flight recorder is a bounded, service-worker resident diagnostic journal
for answering "what did the extension think it saw, what did it do, and what
did authority accept?" after a queue or browser-action failure.

It is not durable authority, not replay input, not a trace file, and not a
compatibility surface. It should be remotely probeable over the existing CDP
and extension-message diagnostic paths, then disappear when the service worker
or browser profile is reset.

## Model

Maintain an in-memory ring buffer owned by the service worker:

- fixed capacity, initially 256 or 512 entries;
- monotonic `seq` assigned by the service worker;
- `droppedCount`, `oldestSeq`, `newestSeq`, and `capacity` exposed with reads;
- fixed per-entry size budget with truncation of text fields;
- no page body dumps, credentials, cookies, or full queue snapshots.

The recorder should capture summaries, not raw DOM or full storage payloads.
The goal is post-failure explanation, not full replay.

## Entry Shape

Common fields:

```js
{
  seq,
  at,
  kind,
  source,
  rowKey,
  attemptId,
  runId,
  targetUrl,
  pageUrl,
  operationKind,
  reason,
  elapsedMs
}
```

Fields should be omitted when unknown. URLs should be normalized where the
existing code already has a normalizer. Text snippets should be trimmed and
bounded.

## Event Families

### Authority And Storage

Record reducer and persistence decisions:

- `authority-mutation`: accepted/rejected, changed, terminal, stale attempt,
  previous/next status summaries.
- `wal-append`: operation kind, record count, append seq, bytes, durable or
  failure reason.
- `checkpoint-generation-switch`: target seq, record count, success/failure.
- `storage-update`: timeout, fallback returned, abandoned, suppressed late
  write, derived materialization failure.
- `hydrate`: checkpoint/WAL replay counts, recovered rows, ignored records,
  failure reason.

### Scheduler And Runtime

Record queue motion and runtime actor decisions:

- `start-resume`: caller, user initiated flag, observed durable active/queued
  counts, result reason.
- `fill-decision`: selected row count, skipped row count, skip reasons.
- `tab-action-claim`: row key, attempt, tab id, accepted/rejected reason.
- `tab-action-release`: terminal/requeue/detach reason.
- `actor-reconcile`: orphan actor, stranded active row, adopted actor, closed
  runtime, or no-op.
- `why-not-running`: compact snapshot of the reason tree when Start cannot
  activate work.

### Page Observation And UI Actions

Record what the content script or CDP harness believes it saw and what control
it activated:

- `page-observed`: page type, URL, title summary, content-script version,
  login/challenge flags, candidate count, enabled action count.
- `control-observed`: target URL, control kind, button text or aria summary,
  enabled/disabled state, identifying data attributes, non-actionable reason.
- `control-activated`: target URL, control kind, activation method, button
  text summary, before/after selected state if available.
- `tab-action-observed`: target URL, expected action, visible action surfaces,
  already blocked/muted flags, confirmation dialog detected.
- `tab-action-activated`: target URL, button/control pressed, confirmation
  accepted/canceled, post-click observation.
- `page-state-after-action`: target URL, final visible state, terminal visible
  reason, elapsed time.

This family is intentionally separate from authority events. A failure may be a
perception/action mismatch even when WAL authority behaved correctly.

## Read API

Expose a read-only diagnostic action, for example:

```js
{
  action: 'get-flight-recorder',
  sinceSeq,
  limit,
  kind,
  rowKey,
  targetUrl
}
```

Response:

```js
{
  readOnly: true,
  capacity,
  droppedCount,
  oldestSeq,
  newestSeq,
  entries: []
}
```

The action must not wake queue work, mutate authority, schedule reconcile, or
materialize derived state. It should be safe to call from CDP after a failure.

## Implementation Slices

1. Add the service-worker ring buffer, append helper, sanitization/truncation,
   and read-only action. Add synthetic tests for capacity, dropped count,
   filtering, and no storage writes.
2. Record authority/storage events from the coordinator authority and WAL
   adapter paths.
3. Record scheduler/runtime events from Start/resume, fill, tab-action claim,
   release, and actor reconciliation.
4. Record page-observation and control-activation events from current content
   script action surfaces and queue-authority browser test harness points.
5. Extend the CDP upgrade/work-producing regression reports to dump the last
   N flight-recorder entries only on failure, or on explicit `--include-flight-
   recorder`.

## Guardrails

- No persistent trace files.
- No authority decisions based on recorder contents.
- No unbounded strings or object graphs.
- No full rows by default; store status/attempt/run summaries.
- No raw page body, credentials, cookies, or private form values.
- No automatic high-volume event families without sampling or dedupe.
- Recorder failures must never poison queue authority, WAL append, or runtime
  action acknowledgement.

## Useful Failure Questions

The recorder should make these questions answerable:

- Which rows did the search or space page think were actionable?
- Which buttons were clicked, and with what visible labels?
- Did the service worker accept the queue mutation and append WAL?
- Did Start observe durable queued rows and attempt to fill?
- Did a tab action claim match the durable attempt?
- What visible page state caused terminal success, skip, or stall?
- Did storage timeout, fallback, or abandon near the stall?
- Did a service-worker restart recover the same current authority?
