# Recovery and Resume Triggers Review - 2026-05-19

> **Status: HISTORICAL** (24 Oct 2026). Recovery and resume triggers review (19 May). Resolved. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Status: resolved review record.

Canonical planning now starts at [planning.md](../planning.md). Canonical
architecture starts at [architecture.md](../architecture.md). Keep this as
evidence for the review/fix cycle; current recovery architecture is now framed
through the reconciler model.

Review target: service-worker recovery triggers for stored coordinator work, including startup/update hooks, alarm handlers, storage-change hooks, dashboard repair/resume messages, and the stored-work repair scheduler.

Scope: `shared/js/sw.js` recovery and resume trigger paths. This review is intentionally standalone and does not rely on findings from the other review notes.

## Current Status

Status: resolved as an active review note by the `1.6.329` fix pass tracked in
`review-fix-checklist-2026-05-20.md`.

- progress-only stranded recovery is checked off;
- earliest-requested stored-work repair scheduling and alarm-backed wakeup are
  checked off;
- manual/dashboard resume returning a real recovery or explicit fallback result
  is checked off.

The general design warning still applies: recovery should stay centralized and
service-worker owned. The concrete findings below should be treated as
historical unless reintroduced by later changes.

## Findings

### P1: Progress-only stranded work cannot be recovered by the public recovery triggers

The repair implementation can restore a stranded Current Work progress row back into the coordinator queue: `shouldRestoreQueuedProgressRecordToCoordinatorQueue()` accepts queued progress records with a run id (`shared/js/sw.js:1560`, `shared/js/sw.js:1563`), and `restoreQueuedProgressRecordsToCoordinatorQueue()` creates a new durable queue item from that record (`shared/js/sw.js:1570`, `shared/js/sw.js:1580`, `shared/js/sw.js:1591`, `shared/js/sw.js:1633`).

The recovery entry points that should reach that repair first require existing queue work. `restoreCoordinatorPageForStoredWorkOnce()` loads only the queue and returns `no-stored-work` before calling `recoverStoredCoordinatorWork()` (`shared/js/sw.js:2446`, `shared/js/sw.js:2450`, `shared/js/sw.js:2454`). `recoverStoredCoordinatorWork()` has the same pre-repair guard and returns before `repairCoordinatorStorageFromProgressBestEffort()` runs (`shared/js/sw.js:3742`, `shared/js/sw.js:3748`, `shared/js/sw.js:3752`).

That makes the progress-to-queue repair unreachable for the exact shape it appears intended to handle: queued progress records without matching queue entries. The storage-change hook does schedule a repair when progress changes (`shared/js/sw.js:8841`, `shared/js/sw.js:8849`), and the dashboard repair request calls `recoverStoredCoordinatorWork()` (`shared/js/sw.js:8896`, `shared/js/sw.js:8897`), but both still hit the queue-first guard.

Impact: a user can have durable progress that says an item is queued, while the queue map is empty, and startup, storage-change recovery, dashboard repair, and page restore all report no stored work instead of repairing the queue.

Recommendation: make repair run before the stored-work check in recovery-triggered paths, then decide whether anything remains to resume. If a guard is still needed for cheap periodic checks, split it into a fast queue-only probe and an explicit repair path used by dashboard repair, progress-change triggers, startup, and page restore.

### P2: Stored-work repair scheduling is a volatile, non-resetting timeout

`scheduleStoredWorkRepair()` stores one in-memory timeout and ignores all later requests while it is pending (`shared/js/sw.js:3733`, `shared/js/sw.js:3734`). The default interval is five seconds (`shared/js/sw.js:68`), while many urgent triggers ask for a one-second repair, including startup (`shared/js/sw.js:8688`, `shared/js/sw.js:8690`), queued tab removal (`shared/js/sw.js:8767`, `shared/js/sw.js:8768`), progress changes (`shared/js/sw.js:8848`, `shared/js/sw.js:8849`), and dashboard resume (`shared/js/sw.js:8902`, `shared/js/sw.js:8904`).

Because the scheduler never records the requested due time, an older slower timeout can mask a newer urgent one. The stored-work repair loop is also only a `setTimeout()` callback (`shared/js/sw.js:3736`, `shared/js/sw.js:3738`), unlike persistent failed retry, which uses a browser alarm as a durable wakeup (`shared/js/sw.js:2350`, `shared/js/sw.js:2362`, `shared/js/sw.js:2363`, `shared/js/sw.js:8699`).

Impact: recovery timing depends on which trigger happened first in the current service-worker lifetime. A real event like tab closure or dashboard resume can be delayed behind an earlier periodic repair, and a service-worker restart can discard the pending timeout altogether.

Recommendation: replace the boolean timeout latch with a small scheduler that tracks the earliest requested due time, reschedules when a sooner repair is requested, and uses an alarm-backed wakeup where available. Message-driven repair requests should either await recovery directly or schedule a wakeup whose creation/result is observable.

### P2: Dashboard resume reports scheduling success, not resume success

`kickCoordinatorQueueResume()` only attempts to create `COORDINATOR_RESUME_ALARM_NAME` and then returns a synthetic scheduled result (`shared/js/sw.js:3063`, `shared/js/sw.js:3066`, `shared/js/sw.js:3072`, `shared/js/sw.js:3075`). Alarm creation failures are swallowed (`shared/js/sw.js:3067`, `shared/js/sw.js:3069`), and there is no direct fallback to `recoverStoredCoordinatorWork()` or `resumeCoordinatorQueueExecution()` in that helper.

The dashboard resume message returns that synthetic result immediately (`shared/js/sw.js:8902`, `shared/js/sw.js:8905`). The actual resume is elsewhere: the alarm handler later calls `recoverStoredCoordinatorWork('resume-alarm')` (`shared/js/sw.js:8693`, `shared/js/sw.js:8695`, `shared/js/sw.js:8696`), and the dashboard path separately schedules the timeout-based repair loop (`shared/js/sw.js:8904`).

Impact: callers cannot tell whether resume actually started, whether an alarm was created, whether recovery found work, whether the queue was paused, or whether the resume timed out. A failed or unavailable alarm still looks like `dashboard-resume-scheduled`.

Recommendation: make manual resume a real recovery request. Either return the result of `recoverStoredCoordinatorWork('dashboard-resume')`, or return a structured scheduling result that includes `alarmCreated`, `fallbackScheduled`, and a durable follow-up status. Avoid swallowing alarm failures in the user-facing resume path.

## Notes

The persistent failed retry path is more organized than the stored-work repair path: it has a named periodic alarm, a timeout nudge, a restore hook, and an explicit clear path. The stored-work repair path would be easier to reason about if it used the same shape instead of mixing queue probes, repair, resume, and volatile timeout scheduling behind one helper.
