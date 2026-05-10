# Top-Level Rethink 1.5 Execution Plan

This is the implementation plan for `top-level-rethink-1.5.md`. It is meant to
keep the reset incremental: first create an authoritative model, then route
existing behavior through it, then retire the duplicate queue/progress paths.

## Execution Rules

- Keep each slice shippable or trivially revertible.
- Preserve the current operator workflows while internals move:
  profile `Mute Block`, `Mute Block Close`, modal `Nuke 'Em`, space-feed
  `Nuke 'Em`, retry-failed, pause, and coordinator display.
- Do not add broad recovery behavior that is not expressible in the durable job
  state table.
- For code behavior changes, bump the version before any release build and then
  run the local rebuild/package sequence.
- Run `npm test` after each pure-state slice.
- For shipped extension behavior changes, run:

```bash
env npm_config_cache=/scratch/dbrower/.npm-cache npm test
env npm_config_cache=/scratch/dbrower/.npm-cache npm run prod
env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:chrome
env npm_config_cache=/scratch/dbrower/.npm-cache npm run build:firefox
```

## Progress

| Slice | Status | Primary files | Validation |
| --- | --- | --- | --- |
| 0. Baseline and guardrails | Not started | docs only, optional test fixtures | Existing `npm test`; no rebuild unless code changes. |
| 1. Pure job-state module | Not started | `shared/js/jobState.js`, `test/jobState.test.js`, `package.json` test script | Unit tests only. |
| 2. Read-side adoption | Not started | `shared/js/sw.js`, `shared/js/coordinator.js` | Unit tests plus coordinator display smoke after build. |
| 3. Service-worker transition helpers | Not started | `shared/js/sw.js`, `shared/js/jobState.js` | Unit tests, build, live small space-feed run. |
| 4. Attempt ids and stale-report rejection | Not started | `shared/js/sw.js`, `shared/js/content.js`, `shared/js/jobState.js` | Unit tests, extension reload during active run. |
| 5. Durable scheduler | Not started | `shared/js/sw.js` | Live restart/reload/coordinator-close tests. |
| 6. Worker milestone protocol | Not started | `shared/js/content.js`, `shared/js/sw.js` | Live success/failure/timeout matrix. |
| 7. Queue all entry points | Not started | `shared/js/content.js`, `shared/js/sw.js` | Profile, modal, and space-feed live tests. |
| 8. Source-page settlement | Not started | `shared/js/content.js`, `shared/js/sw.js`, maybe `shared/js/nukedPosts.js` | Space pending/nuked post reports before/after terminal results. |
| 9. Coordinator as UI only | Not started | `shared/js/coordinator.js`, `shared/js/sw.js` | Close coordinator mid-run; work continues or resumes. |
| 10. Compatibility cleanup | Not started | `shared/js/content.js`, `shared/js/coordinator.js`, `shared/js/sw.js` | Full manual matrix, no stale storage regressions. |

## Slice 0: Baseline and Guardrails

Goal: make sure the next code slice starts from known behavior.

Tasks:

- Capture current version and dirty-file state before code edits.
- Run `npm test` to verify the existing subject tests.
- If live browser validation will be needed, confirm the CDP tunnel and Windows
  Chrome unpacked extension path from `coordinator-page-refactor-plan-2026-05-08.md`.
- Pick one small live asset page as the canary for later code slices.

Exit criteria:

- Current local tests are known.
- The first live validation page and extension id are known.
- Any unrelated dirty files are identified and left alone.

## Slice 1: Pure Job-State Module

Goal: create the durable model as executable code without changing runtime
behavior.

Tasks:

- Add `shared/js/jobState.js`.
- Implement:
  - job key construction from scope/action/profile href;
  - schema v1-to-v2 upgrade for existing coordinator rows;
  - progress-status-to-job-status mapping;
  - terminal/retry classification;
  - transition validation;
  - merge helpers for sources/evidence;
  - duplicate-collapse decision helper.
- Add `test/jobState.test.js`.
- Update `npm test` so it runs both `test/subject.test.js` and
  `test/jobState.test.js`.

Validation:

- `npm test`.

Exit criteria:

- Current design states are covered by tests.
- Existing behavior is unchanged except the test command.

Notes:

- This is the first code change. If it will be built or packaged for use, bump
  the version before release build steps.

## Slice 2: Read-Side Adoption

Goal: make display and repair code ask the same pure model what a state means,
without changing writers.

Tasks:

- Replace duplicated progress mapping in `shared/js/sw.js` and
  `shared/js/coordinator.js` with `jobState` helpers.
- Keep existing storage shapes and message names.
- Add tests for any mapping bug found during extraction.

Validation:

- `npm test`.
- Build/package only if this is going into the copied extension.
- Coordinator display smoke: queued, active, succeeded, skipped, failed,
  retryable failed, security-verification failed.

Exit criteria:

- No second copy of progress-to-coordinator-status logic remains for the mapped
  statuses.
- Coordinator display still matches current status expectations.

## Slice 3: Service-Worker Transition Helpers

Goal: make the service worker the single durable writer for coordinator job
state, still behind existing public message names.

Tasks:

- Add service-worker helpers:
  - `loadJobState()`;
  - `saveJobState()`;
  - `enqueueJobs()`;
  - `transitionJob()`;
  - `recordJobMilestone()`;
  - `recordJobTerminal()`;
  - `recomputeRunsFromJobs()`.
- Route `enqueueCoordinatorItemsStorage`, retry-failed setup, and
  `syncCoordinatorProgressRecords` through those helpers.
- Keep `mbProfileNukeProgress` mirror writes for existing content/report UI.

Validation:

- `npm test`.
- Build/package.
- Live canary: one small space-feed aggregate queue, verify queue rows,
  progress mirror, run counts, and terminal outcome.

Exit criteria:

- Coordinator queue rows are updated through one service-worker transition path.
- Existing content scripts can still run without knowing about schema v2.

## Slice 4: Attempt IDs and Stale-Report Rejection

Goal: prevent old worker tabs or retry leftovers from overwriting newer job
state.

Tasks:

- Add `attempt.id` creation when a job is claimed.
- Include `attemptId` in the claim response.
- Include `attemptId` in worker milestone/terminal messages.
- Accept missing attempt ids only through a compatibility path during this
  slice.
- Reject mismatched ids by recording a bounded diagnostic event, not by
  throwing in the worker tab.

Validation:

- `npm test`.
- Live canary: reload extension during one active worker; confirm stale reports
  do not terminally overwrite a newer attempt.

Exit criteria:

- New worker reports carry attempt ids.
- Mismatched reports are ignored deterministically.

## Slice 5: Durable Scheduler

Goal: make `queuedTabActions` a transient scheduling buffer, not an independent
queue.

Tasks:

- Build scheduler candidates from durable `queued` jobs.
- Keep `queuedTabActions` only as in-memory work for the immediate fill loop.
- On service-worker startup/update/storage change, reconcile jobs and schedule
  from storage.
- Move pause state from `pausedQueuedOwners` toward durable run pause state.

Validation:

- `npm test`.
- Live tests:
  - extension reload with queued but unopened work;
  - browser restart with queued work;
  - coordinator close while queued work remains.

Exit criteria:

- Queued durable jobs resume without requiring a coordinator page.
- In-memory queue loss is recoverable.

## Slice 6: Worker Milestone Protocol

Goal: replace progress-record writes as the worker truth path with explicit job
milestones and terminal reports.

Tasks:

- Add compatibility wrappers:
  - `record-nuke-progress` -> service-worker `recordJobMilestone` or
    `recordJobTerminal`;
  - `release-tab-slot` -> `release-job-tab`.
- Update worker-tab flow in `content.js` to send job messages when a claimed
  durable job exists.
- Keep fallback local progress writes for extension-context-invalidated cases.

Validation:

- `npm test`.
- Live success path, unavailable profile path, action-error path, and tab-close
  path.

Exit criteria:

- The worker can execute from a job claim without relying on direct durable
  storage writes.
- The compatibility progress mirror still feeds existing UI/report paths.

## Slice 7: Queue All Entry Points

Goal: remove the two recovery models by routing direct and modal actions into
the durable queue.

Tasks:

- Convert profile `Mute Block` and `Mute Block Close` clicks into
  `queue-jobs` requests where appropriate.
- Convert modal `Nuke 'Em` from direct `enqueue-tabs` to durable jobs.
- Keep direct immediate action only for explicitly local, non-recoverable UI
  commands if still needed.

Validation:

- Live profile `Mute Block`.
- Live profile `Mute Block Close`.
- Followers/following modal `Nuke 'Em`.
- Space-feed `Nuke 'Em` regression canary.

Exit criteria:

- All destructive profile actions have the same durable recovery model.

## Slice 8: Source-Page Settlement

Goal: make source-page pending/nuked post state a consequence of terminal job
state.

Tasks:

- Link `mbSpacePendingNukedPosts` entries to job keys.
- On terminal success/skip/failure, update pending post records through the
  service worker.
- Keep content-page UI refresh local, but stop making it the settlement owner.

Validation:

- Live space-feed run with multiple posts pointing to the same profile.
- Reload source page mid-run; terminal worker results still settle the source
  records.

Exit criteria:

- Source page absence no longer blocks pending-post cleanup.

## Slice 9: Coordinator as UI Only

Goal: remove any remaining execution dependency on the coordinator tab.

Tasks:

- Make `coordinator-ready` query/repair/display only.
- Ensure startup/storage-change scheduling does not open the coordinator except
  for deliberate operator visibility.
- Keep coordinator controls as commands to the service worker.

Validation:

- Start a run, close coordinator, verify work continues or resumes from storage.
- Close source page, leave coordinator open, verify work continues.
- Reload extension with no coordinator open, verify queued work resumes.

Exit criteria:

- Coordinator page can be destroyed without losing or blocking execution.

## Slice 10: Compatibility Cleanup

Goal: remove obsolete duplicate state paths after live behavior is stable.

Tasks:

- Stop reading `mbProfileNukeProgress` as queue truth.
- Keep bounded profile progress only for reporting if still needed.
- Remove direct `enqueue-tabs` durable execution path or mark it diagnostic.
- Remove redundant stale-active recovery paths that are superseded by the
  reconciler.
- Update docs with final storage/model expectations.

Validation:

- `npm test`.
- Full manual matrix from `refactor-1.5-plan.md`.
- Extension manager errors/warnings check before and after live validation.

Exit criteria:

- Durable jobs are the only queue source of truth.
- Compatibility state can be missing or stale without changing scheduler
  decisions.

## Live Validation Matrix

Use these after slices that change runtime behavior:

- Single profile `Mute Block`.
- Single profile `Mute Block Close`.
- Already-blocked profile.
- Profile unavailable or redirected profile.
- Followers/following modal `Nuke 'Em`.
- Asset space top-level `Nuke 'Em`.
- Asset space per-post aggregate `Nuke 'Em`.
- Single-post `Mute-Block`.
- Retry failed after timeout/action-error.
- Security verification stays terminal and not auto-retried.
- Extension reload during queued, opening, active, acting, and settling states.
- Coordinator tab close during queued and active states.
- Worker tab close during opening, active, and acting states.
- Source page close during active run.

## Suggested Immediate Next Step

Start Slice 1 only:

- create `shared/js/jobState.js`;
- create `test/jobState.test.js`;
- update `npm test` to run both test files;
- run `npm test`.

Do not touch scheduler behavior in the same slice.
