# Storage Batching Metrics

Date: 2026-05-20

Status: supporting storage metrics model.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this note with
the storage authority and WAL notes to tell whether batching reduced full writes
or only delayed them.

## Purpose

The current metrics show large storage-update delay and timeout rates. We have
already introduced logging and some batching, but the existing counters do not
yet tell us whether batching is working, whether individual writes are too
large, or whether idle repair/pump churn is creating avoidable storage traffic.

This note defines what to measure so we can distinguish those cases.

Related notes:

- `queue-wakeup-metrics-model-2026-05-20.md`
- `queue-wakeup-analysis-playbook-2026-05-20.md`
- `reconciler-first-fallback-architecture-2026-05-20.md`

## Current Concern

`enqueueSpaceFeedStorageUpdate` serializes storage work and applies a timeout
around the whole operation. A timeout currently means "the caller did not get a
storage result quickly enough," but it does not say why.

Possible causes:

- the update waited behind earlier serialized storage work;
- `chrome.storage.local.get` was slow;
- `chrome.storage.local.set` was slow;
- queue/progress/event normalization was slow;
- payloads were too large;
- logical milestones were not actually coalesced before durable writes;
- repair or pump loops continued writing after useful work had ended;
- nested update paths expanded one logical action into many storage operations.

The metrics need to split these.

## Core Per-Update Fields

For every `enqueueSpaceFeedStorageUpdate` cycle, record:

- `updateToken`
- `reason`
- `enqueuedAt`
- `startedAt`
- `finishedAt`
- `timedOutAt`
- `queueWaitMs = startedAt - enqueuedAt`
- `runMs = finishedAt - startedAt`
- `totalMs = finishedAt - enqueuedAt`
- `timedOut`
- `fallbackReturned`
- `abandoned`
- `lateWriteSuppressed`
- `spaceFeedStorageUpdateDepth`
- `maxNestedDepth`
- `nestedUpdateCount`

Interpretation:

- high `queueWaitMs` means the serialized storage queue is backing up;
- high `runMs` means individual updates are too expensive;
- high `nestedUpdateCount` means one logical action is multiplying storage work;
- `abandoned` after timeout is expected, but should be rare;
- `lateWriteSuppressed` after timeout is good, but it is evidence the timeout
  path was active.

## Phase Timing

Inside each update, record phase timers:

- `storageGetMs`
- `storageSetMs`
- `loadCoordinatorStateMs`
- `saveCoordinatorStateMs`
- `normalizeQueueMs`
- `normalizeRunsMs`
- `normalizeEventsMs`
- `normalizeProgressMs`
- `recomputeRunsMs`
- `flushDiagnosticEventsMs`
- `flushMilestonesMs`

Also record counts:

- `storageGetCalls`
- `storageSetCalls`
- `saveCoordinatorStateCalls`
- `flushDiagnosticEventCalls`
- `flushMilestoneCalls`

Interpretation:

- `storageGetMs` high: read-side storage latency or large key load.
- `storageSetMs` high: write-side storage latency or large payload.
- normalization/recompute high: local CPU/data-shape cost.
- multiple `set` calls inside one update: batching may be defeated.

## Payload Size

For every `browser.storage.local.set(payload)`, record:

- keys written;
- total JSON byte size;
- byte size per key;
- queue row count;
- run count;
- event count;
- progress row count;
- pending-post count.

Suggested counters:

- `storagePayload.write.queue.bytes`
- `storagePayload.write.runs.bytes`
- `storagePayload.write.events.bytes`
- `storagePayload.write.progress.bytes`
- `storagePayload.write.pendingPosts.bytes`
- `storagePayload.write.total.bytes`
- `storagePayload.write.queue.rows`
- `storagePayload.write.runs.rows`
- `storagePayload.write.events.rows`
- `storagePayload.write.progress.rows`
- `storagePayload.write.pendingPosts.rows`

Interpretation:

- a single large key points to payload design;
- many small writes point to poor coalescing;
- event payload growth points to diagnostic logging pressure;
- progress payload growth points to per-profile mirror pressure.

## Coalescing Efficiency

For each batching surface, track logical events in and durable writes out.

Milestone batching:

- `milestone.received`
- `milestone.pendingMax`
- `milestone.flushRequested`
- `milestone.flushPerformed`
- `milestone.recordsPerFlush`
- `milestone.flushImmediate`
- `milestone.flushDeferred`

Progress batching:

- `progress.recordReceived`
- `progress.batchReceived`
- `progress.recordsPerBatch`
- `progress.pendingMax`
- `progress.flushPerformed`
- `progress.storageWrites`
- `progress.changedRecordsPerStorageWrite`
- `progress.payloadRowsPerStorageWrite`

Diagnostic events:

- `diagnosticEvent.received`
- `diagnosticEvent.pendingMax`
- `diagnosticEvent.flushPerformed`
- `diagnosticEvent.eventsPerFlush`
- `diagnosticEvent.storageWrites`

Derived metrics:

- `milestoneCoalescingRatio = milestone.received / milestone.flushPerformed`
- `progressCoalescingRatio = progress.recordReceived / progress.flushPerformed`
- `diagnosticCoalescingRatio = diagnosticEvent.received / diagnosticEvent.storageWrites`

Interpretation:

- ratios near `1` mean batching is mostly not batching;
- ratios above `5` indicate meaningful coalescing;
- high pending counts plus long flush latency may require a smaller flush
  interval or an explicit terminal-flush priority path.
- compare `changedRecordsPerStorageWrite` to `payloadRowsPerStorageWrite` to
  see whether small logical updates are still rewriting large full-map payloads.

## Timeout Classification

Every timeout should be assigned one cause bucket:

- `timeout.beforeStart`
- `timeout.duringStorageGet`
- `timeout.duringNormalize`
- `timeout.duringRecomputeRuns`
- `timeout.duringStorageSet`
- `timeout.duringDiagnosticFlush`
- `timeout.duringMilestoneFlush`
- `timeout.unknown`

This requires a current-phase marker inside `enqueueSpaceFeedStorageUpdate`.

Interpretation:

- `beforeStart` means the queue is overloaded;
- `duringStorageSet` means payload/write latency is the likely bottleneck;
- `duringNormalize` or `duringRecomputeRuns` means local processing is too
  expensive;
- diagnostic/milestone buckets mean batching surfaces are feeding back into the
  storage queue.

## Idle Churn

For each storage update, repair tick, and pump, record:

- runtime `queuedTabActions`
- runtime `activeQueuedTabs`
- runtime `pendingTabActions`
- durable active row count;
- durable queued row count;
- durable terminal row count;
- `hasWork`
- `paused`
- triggering reason.

Suggested counters:

- `storageUpdate.noRuntimeWork`
- `storageUpdate.noDurableWork`
- `repair.noDurableWork`
- `pump.noDurableWork`
- `pump.noRuntimeWork`

Interpretation:

- storage writes with no runtime or durable work are suspect;
- repair/pump no-work loops should stop or back off;
- repeated no-work storage updates after service-worker restart may mean the
  dashboard-ready or repair alarms are self-sustaining.

## Expected Healthy Shape

During active work:

- storage update timeout rate should be low;
- most writes should have low `queueWaitMs`;
- milestone/progress records should coalesce into fewer writes;
- payload sizes should be stable and bounded;
- repair should not dominate storage traffic;
- terminal events should flush promptly without forcing many unrelated writes.

During idle:

- repair ticks should quickly converge to no scheduled work;
- storage writes should fall near zero;
- pumps may occur on dashboard ready or manual resume, but should not continue
  to create periodic storage updates without work.

## Decision Rules

If `queueWaitMs` dominates:

- coalesce updates before they enter the serialized queue;
- drop or merge duplicate no-work repair/pump requests;
- add backoff for repeated no-op repair ticks;
- avoid nested `enqueueSpaceFeedStorageUpdate` chains.

If `storageSetMs` dominates:

- split large keys;
- reduce full-map rewrites;
- write per-run/per-profile shards;
- prune event/progress payloads more aggressively.

If local processing dominates:

- avoid recomputing all runs for one-row changes;
- track affected run IDs precisely;
- cache normalized maps inside a single update;
- move expensive repair scans out of ordinary progress writes.

If coalescing ratios stay near `1`:

- make milestone flush actually wait for the batch window except for terminal
  progress;
- batch progress records by sender tab or short time window;
- flush diagnostics opportunistically with existing writes instead of starting
  standalone storage updates.

If idle churn dominates:

- suppress scheduler/repair rescheduling when durable active/queued work is
  zero;
- require new work, tab change, pause/resume, or explicit user command before
  re-entering the storage loop;
- treat dashboard-ready as a one-shot probe, not a repeating work source.

## Important Code Surfaces

Start instrumentation around:

- `enqueueSpaceFeedStorageUpdate`
- `loadCoordinatorState`
- `saveCoordinatorState`
- `flushPendingCoordinatorDiagnosticEvents`
- `recordProfileNukeProgressBatchLocked`
- `recordCoordinatorJobProgressRecords`
- `recordDeferredCoordinatorJobMilestone`
- `flushCoordinatorJobMilestones`
- `repairCoordinatorStorageFromProgressLocked`
- `runStoredWorkRepairTick`
- `kickCoordinatorQueueResume`

## Immediate Question To Answer

The next data pass should answer:

Is the 15s storage timeout mostly queue wait, storage API latency, payload size,
or avoidable idle churn?

Until that is split, "storage is slow" is too broad to guide the next fix.
