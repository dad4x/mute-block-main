# Queue Wakeup Metrics Model

Date: 2026-05-20

Status: supporting metrics model.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this note to
interpret pump/nudge/repair metrics against the scheduler authority model.

## Purpose

This note defines how to measure whether queue "nudges" and "pumps" are
healthy wakeups or symptoms of missing state transitions.

The condition-variable analogy is the right model:

- a nudge/pump is only a wakeup signal;
- every receiver must re-read authoritative state;
- progress is allowed only after the exact predicate is true;
- stale attempt, stale generation, missing owner, missing tab, and paused queue
  checks must still reject the wakeup.

Some wakeups are endemic to the MV3 service-worker model. The worker sleeps,
alarms can be delayed, content scripts load per tab, and tab/page state is not
transactional with extension storage. The goal is not zero nudges. The goal is
bounded, high-yield wakeups around durable predicates.

## Vocabulary

Nudge:

An attempt to wake a specific tab/page so it claims already assigned work.
Current examples include `nudgeQueuedTabActionClaim*` and content-side
`nudgeCurrentProfilePendingClaim`.

Pump:

An attempt to advance queue execution by re-checking durable state and filling
available worker slots. Current examples include `kickCoordinatorQueueResume`,
`scheduleStoredWorkRepair`, `scheduleQueuedWorkContinuation`, and
`fillQueuedTabs`.

Repair:

A pump whose job is convergence after missed, stale, or restarted state. Repair
should be common after service-worker restart, but should not be the normal
path for every successful job.

## Event Model

Emit compact structured events for every wakeup and every state-changing result.
The metrics can be stored as a bounded in-memory ring and optionally mirrored
into recent coordinator events for diagnostics.

Common fields:

```json
{
  "kind": "nudge|pump|repair|state-change",
  "name": "nudgeQueuedTabActionClaim",
  "reason": "queued-tab-opened",
  "runId": "space-feed-...",
  "jobKey": "...",
  "profileHref": "https://www.quora.com/profile/...",
  "coordinatorKey": "resolve-profile:...",
  "tabId": 123,
  "ownerTabId": "service-worker-queue-owner",
  "attemptId": "...",
  "attemptNumber": 2,
  "pauseGeneration": 17,
  "at": 1770000000000,
  "result": "accepted|ignored|timed-out|state-changed|no-op",
  "resultReason": "stale-attempt|no-pending-items|executor-already-running"
}
```

Do not put raw page content, post text, or user-visible message content in these
events. URLs and profile hrefs are already part of queue state; if log volume
or privacy becomes a concern, hash them in exported summaries.

## Raw Counters

Nudge counters:

- `nudge.sent`
- `nudge.accepted`
- `nudge.rejected.notProfile`
- `nudge.rejected.staleAttempt`
- `nudge.rejected.missingAction`
- `nudge.failed.message`
- `nudge.failed.timeout`
- `nudge.reloadRequested`

Pump counters:

- `pump.requested`
- `pump.direct`
- `pump.alarmScheduled`
- `pump.alarmFired`
- `pump.noop.noPendingItems`
- `pump.noop.executorAlreadyRunning`
- `pump.noop.paused`
- `pump.changed.openedTab`
- `pump.changed.adoptedLiveTab`
- `pump.changed.requeued`
- `pump.changed.releasedSlot`
- `pump.changed.terminalized`

Repair counters:

- `repair.requested`
- `repair.changed.queue`
- `repair.changed.runs`
- `repair.changed.progress`
- `repair.changed.pendingPosts`
- `repair.noop`
- `repair.timeout`
- `repair.afterRestart`
- `repair.afterTabMissing`
- `repair.afterStorageTimeout`

Storage/update counters:

- `storageUpdate.started`
- `storageUpdate.completed`
- `storageUpdate.timedOut`
- `storageUpdate.deadlineMissed`
- `storageUpdate.abandoned`
- `storageUpdate.fallbackReturned`
- `storageUpdate.lateWriteSuppressed`

Storage payload and phase counters:

- `storagePayload.write.<area>.bytes`
- `storagePayload.write.<area>.rows`
- `storagePayload.write.<area>.maxBytes`
- `storagePayload.write.<area>.maxRows`
- `progress.flushPerformed`
- `progress.pendingMax`
- `progress.changedRecordsPerStorageWrite`
- `progress.payloadRowsPerStorageWrite`

`storageGetMs` and `storageSetMs` in storage journal entries are cumulative
subcall pressure. They can exceed wall-clock `runMs` when a storage update
performs repeated or overlapping storage operations. Use `ownStorageGetMs` and
`ownStorageSetMs` for merged wall time inside that storage update.

`storageUpdate.deadlineMissed` means the update completed after its watchdog
deadline but the JavaScript timeout callback did not win the race. This is
separate from `storageUpdate.timedOut` and `storageUpdate.fallbackReturned`.

For progress coalescing, use `progress.flushPerformed` and
`progress.changedRecordsPerStorageWrite` for logical progress write pressure.
Use `progress.payloadRowsPerStorageWrite` for full-map payload size pressure;
the older `progress.recordsPerStorageWrite` counter is retained only as a
legacy alias for the full-payload row count.

Queue lifecycle counters:

- `job.enqueued`
- `job.tabOpened`
- `job.claimAccepted`
- `job.actionStarted`
- `job.terminal`
- `job.slotReleased`
- `job.nextSlotFilled`
- `job.completedOnlyAfterRepair`

## Derived Metrics

Nudge acceptance rate:

`nudge.accepted / nudge.sent`

Low acceptance means nudges are acting like polling. Break down by reason:
`queued-tab-opened`, `resume-live-active-tab`, `content-script-present`,
`content-script-injected`, and content-side pending-claim rescue.

Pump yield:

`pump.changed.* / pump.requested`

A low yield means the queue is being woken repeatedly without useful work.
This is acceptable for rare alarms, but suspicious if it happens during normal
successful job flow.

Repairs per job:

`repair.requested / job.enqueued`

Track separately for ordinary jobs and service-worker restart windows. Repair
after restart is expected. Repair on most clean jobs is not.

Wakeups per job:

`(nudge.sent + pump.requested + repair.requested) / job.enqueued`

This should remain bounded. Compare by source type:

- space feed;
- profile search;
- messages;
- profile foreground buttons;
- resolver-only source pages.

Direct-progress ratio:

`jobs that reached terminal without repair / terminal jobs`

This is the strongest health signal. A healthy scheduler should complete most
ordinary jobs by direct transition, not by later repair.

Recovery dependency:

`job.completedOnlyAfterRepair / terminal jobs`

High values mean repair is carrying normal correctness.

Duplicate wakeup ratio:

`(pump.noop.noPendingItems + pump.noop.executorAlreadyRunning + pump.noop.paused) / pump.requested`

High values mean scheduling is too broad or not coalesced enough.

Stale wakeup ratio:

`(stale attempt + stale generation + missing owner/tab rejects) / total wakeups`

Some stale rejection is good. A high rate means old actors are being awakened
too often.

Phase latencies:

- enqueue to durable queue write;
- durable queue write to tab open;
- tab open to claim accepted;
- claim accepted to action start;
- action start to terminal;
- terminal to slot release;
- slot release to next tab open;
- timeout fallback to eventual durable convergence.

Long tails identify where pumps are substituting for a missing direct
transition.

## Analysis Views

Per-run summary:

- total jobs;
- terminal count;
- failed/canceled/skipped count;
- total nudges;
- total pumps;
- total repairs;
- wakeups per job;
- direct-progress ratio;
- completed-only-after-repair count;
- top no-op pump reasons.

Per-job trace:

For a sampled job, show the ordered sequence:

```text
enqueued -> pump(fill) -> tabOpened -> nudge(sent) -> claimAccepted
-> actionStarted -> terminal -> releaseSlot -> pump(fillNext)
```

Flag unexpected sequences:

- terminal only after repair;
- more than one tab-open attempt without retry metadata;
- nudge accepted with missing or mismatched attempt;
- pump opened work that was not durable;
- repair changed a row that had just been updated by the current attempt.

Time-window dashboard:

- last 5 minutes;
- last run;
- since extension load;
- since service-worker restart.

Separate normal operation from restart windows. MV3 restart recovery will make
the raw wakeup counts look worse unless it is labeled.

## Suggested Thresholds

These are starting heuristics, not hard product rules.

Healthy:

- nudge acceptance above 60 percent for `queued-tab-opened` nudges;
- pump yield above 30 percent during active queue draining;
- fewer than 3 pumps per ordinary job;
- fewer than 2 claim nudges per ordinary job;
- direct-progress ratio above 90 percent outside restart windows;
- completed-only-after-repair below 5 percent outside restart windows.

Warning:

- nudge acceptance below 30 percent;
- duplicate wakeup ratio above 50 percent;
- repair requested for most clean jobs;
- repeated scheduled repair while queue state does not change;
- more wakeups than jobs by an order of magnitude.

Critical:

- executor work starts after a storage timeout without durable Current Work;
- a pump uses raw request data as execution authority;
- a nudge causes action without matching attempt identity;
- active queued tab state outlives the browser tab;
- repair is required for terminal success to become durable in normal flow.

## Instrumentation Points

Service worker:

- `enqueueCoordinatorItems` before and after durable enqueue;
- `enqueueSpaceFeedStorageUpdate` start, timeout, fallback, completion;
- `finishCoordinatorEnqueue` before executor startup;
- `fillQueuedTabsOnce` before open, after open, after active transition;
- `ensureQueuedTabContentScript` probe/inject/reload paths;
- `nudgeQueuedTabActionClaimWithRetries` per attempt and final result;
- `claimPendingTabAction` durable claim result;
- `recordJobProgressFromRequest` milestone and terminal result;
- `releaseQueuedTab` and `detachQueuedTabRuntimeState`;
- `kickCoordinatorQueueResume`;
- `scheduleStoredWorkRepair` and `runStoredWorkRepairTick`;
- `repairCoordinatorStorageFromProgressLocked`.

Content script:

- `claim-current-profile-tab-action` accepted/rejected;
- `nudgeCurrentProfilePendingClaim`;
- `maybeRunAutoProfileAction` start/skip reason;
- action lease request, heartbeat, denial, and release;
- terminal send result and close result.

Coordinator page:

- manual resume/pause/cancel/repair commands;
- periodic resume timer ticks;
- command result reason and whether state changed.

## If The Data Shows Too Many Wakeups

First response: classify before removing.

Do not remove wakeups just because counts are high. Identify whether they are:

- necessary MV3 wakeups after restart/sleep;
- content-script readiness races;
- no-op duplicate scheduling;
- compensating for missing direct transitions;
- carrying authority they should not carry.

Remediation ladder:

1. Make predicates explicit.

   Every nudge/pump should name the predicate it expects to become true:
   `durable-row-exists`, `tab-live`, `attempt-matches`,
   `slot-available`, `queue-not-paused`, `content-script-ready`.

2. Centralize the scheduler tick.

   Replace broad calls to several helpers with one `schedulerTick(reason)` that
   coalesces work and runs ordered phases:

   ```text
   prune missing runtime tabs
   reload durable queue
   settle terminal rows
   adopt live tabs
   fill open slots
   schedule repair only if unresolved durable work remains
   ```

3. Keep repair out of the normal success path.

   Terminal progress should directly update durable queue state and release the
   slot. Repair should catch missed events, not be the common route to success.

4. Split wakeup from authority.

   A pump may wake the scheduler, but only durable queue rows can authorize
   executor work. A nudge may wake a content script, but only a matching
   attempt can authorize action.

5. Remove raw-input executor fallback.

   Executor startup should require stored queue rows. If durable enqueue times
   out, return a timeout result and schedule repair/resume, but do not start
   tabs from raw request items.

6. Add coalescing and backoff.

   Keep earliest-deadline scheduling for repairs, but suppress duplicate pumps
   while one is running. For repeated no-op repair ticks, back off until a new
   storage/tab/runtime event arrives.

7. Convert content nudges to a claim handshake.

   Prefer one immediate claim nudge after content script readiness, plus one
   bounded rescue. If the tab still does not claim, mark the attempt as waiting
   or failed with evidence instead of repeatedly nudging.

8. Move attempt and lease state into the durable job.

   Durable `attempt.claimedTabId`, `attempt.heartbeatAt`,
   `attempt.leaseExpiresAt`, and `attempt.owner` make restart recovery a normal
   reducer input instead of a repair inference problem.

9. Make state transitions reducer-first.

   Tab removed, tab opened, claim accepted, terminal progress, repair timeout,
   and pause/cancel should all become events applied by one reducer. This
   reduces special-case pumps because the same transition is used regardless of
   trigger.

10. Add regression gates around wakeup budgets.

   The synthetic harness can assert:

   - storage-only enqueue does not start executor work;
   - terminal success does not require repair in the ordinary path;
   - active runtime state cannot outlive a removed tab after a scheduler tick;
   - pumps have bounded no-op counts for known scenarios.

## Expected End State

Nudges remain, but they are rare and local to page readiness.

Pumps remain, but they are coalesced scheduler ticks over durable state.

Repair remains, but it is visibly a recovery path. In ordinary successful jobs,
the direct transition path should produce the terminal queue row and release the
slot without waiting for periodic repair.
