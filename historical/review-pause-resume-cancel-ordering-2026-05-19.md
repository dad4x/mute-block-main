# Pause/Resume/Cancel Ordering Review - 2026-05-19

> **Status: HISTORICAL** (24 Oct 2026). Pause, resume and cancel ordering review (19 May). Resolved. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Status: resolved review record.

Canonical planning now starts at [planning.md](../planning.md). Canonical
architecture starts at [architecture.md](../architecture.md). Keep this as
evidence for the review/fix cycle; do not use it as current plan without
rechecking source.

Review target: Current Work pause, resume, and cancel ordering in the current working tree.

Scope: `shared/js/sw.js`, `shared/js/coordinator.js`, and `shared/coordinator.html` paths that mutate pause state, queued-owner state, active tabs, and current-work rows. This review is intentionally standalone and does not rely on findings from the other review notes.

## Current Status

Status: resolved as an active review note by the subsequent pause/resume fixes
and contract coverage. The current test suite includes pause cleanup generation
coverage (`test/p1-contract.test.js`: "pause cleanup cannot keep mutating after
a newer pause generation wins").

Keep the findings below as historical context. If pause/resume/cancel ordering
is reviewed again, re-check current source first; do not assume these old line
references still identify live defects.

## Findings

### P1: Stale pause cleanup can still win the final storage write

`pauseCoordinatorNukes()` records a new pause generation and starts `pauseCoordinatorNukesCleanup()` asynchronously (`shared/js/sw.js:3263`, `shared/js/sw.js:3269`). The cleanup performs generation checks before each major phase (`shared/js/sw.js:3206`, `shared/js/sw.js:3216`, `shared/js/sw.js:3225`, `shared/js/sw.js:3236`), and `pauseStoredCoordinatorWork()` also checks before mutating rows (`shared/js/sw.js:3387`, `shared/js/sw.js:3453`).

The remaining race is between the final generation check and the async storage writes that follow it. In `pauseStoredCoordinatorWork()`, after the second check passes, it writes `mbCoordinatorPaused=true` plus the pause generation (`shared/js/sw.js:3453`, `shared/js/sw.js:3456`). It then later writes queue, run, event, and progress state through `saveCoordinatorState()` (`shared/js/sw.js:3495`). A fast Resume increments the in-memory generation and writes `mbCoordinatorPaused=false` (`shared/js/sw.js:3280`, `shared/js/sw.js:3282`), but browser storage completion order can still allow the older pause write to land after the resume write.

Impact: a Resume can appear to succeed, then the older pause cleanup can reassert paused storage or paused run state. The generation key helps detection, but the old write can also overwrite the stored generation with the stale value.

Recommendation: make the final pause mutation conditional at write time. For example, combine the last generation check and pause-state write in a serialized helper that re-reads immediately before writing and aborts if the in-memory generation changed, then re-check again after the write before saving queue/run pause state. Alternately, make Resume await or cancel the active pause cleanup promise before returning.

### P2: Stale pause cleanup can remove in-memory queued actions after Resume

`stopOwnerNukes()` supports a `shouldContinue` guard, but it adds the owner to `pausedQueuedOwners` and removes queued actions before its second guard check (`shared/js/sw.js:7403`, `shared/js/sw.js:7406`, `shared/js/sw.js:7407`, `shared/js/sw.js:7410`). If Resume runs after that mutation but before the second check completes, the stale cleanup can return `staleStop` while already having canceled in-memory executor work.

Durable queue rows should usually let resume rebuild work, but this is still an ordering leak: the stale operation mutates executor memory before it proves the pause is still current.

Recommendation: move `pausedQueuedOwners.add()`, `cancelQueuedOwnerActions()`, and `rememberCanceledOwnerUrls()` after the second `shouldContinue()` check, or make them reversible on `staleStop`.

### P3: Cancel does not advance the pause generation

`cancelCoordinatorCurrentWork()` terminalizes stored work and then writes `mbCoordinatorPaused=false` (`shared/js/sw.js:3292`, `shared/js/sw.js:3323`), but it does not call `nextCoordinatorPauseGeneration()`. If Cancel is used while a pause cleanup is in flight, the stale cleanup still belongs to the current generation until the paused flag write becomes visible.

Impact: Cancel has the same stale pause-write race as Resume, but with less protection because it does not invalidate the generation first.

Recommendation: have Cancel advance and store a new pause generation before or with the unpaused state, and pass that generation through any cleanup that should remain valid.

## Notes

The dashboard button path is straightforward: Pause/Resume sends one runtime message and reloads state (`shared/js/coordinator.js:456`, `shared/js/coordinator.js:469`), while Cancel sends a separate current-work cancellation request (`shared/js/coordinator.js:473`, `shared/js/coordinator.js:486`). I did not find a dashboard-side double-submit bug in this pass.
