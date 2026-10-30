# Mute Block Review Findings

> **Status: HISTORICAL** (24 Oct 2026). Review findings (24 May). Themes folded into the canonical notes. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Status: historical review record.

Canonical planning now starts at [planning.md](../planning.md). Canonical
architecture starts at [architecture.md](../architecture.md). Use this note for
older review context; fold still-current themes into the canonical notes.

Review target: current uncommitted working tree in `/scratch/dbrower/home/src/mute-block-main`.

Validation run:

- `npm test` passed.
- I did not run release build or package steps because this is a review-only pass and repo rules require a version bump before release-oriented build output is regenerated.

## Findings

### High: Profile-resolution jobs can remain active forever after their worker tab disappears

Profile-resolution work is allowed to run without a normalized profile href: `fillQueuedTabsOnce()` computes `profileHref` from `next.profileHref || next.targetProfileHref || next.url`, which is intentionally empty for `resolve-profile:` jobs, while storing only `coordinatorKey` and `requestedUrl` for the tab metadata (`shared/js/sw.js:6049`, `shared/js/sw.js:6055`). Several cleanup paths then require a profile href and skip these coordinator-key-only jobs.

Evidence:

- Tab removal only writes terminal/interrupted progress inside `if(metadata?.profileHref)` (`shared/js/sw.js:6174`). A resolution tab that closes before resolving has metadata, but no `profileHref`, so no terminal queue update is recorded.
- Stale active repair detects the stale active row, but calls `makeMissingActiveCoordinatorProgressRecord(href, ...)`; that helper returns `null` when there is no normalized href (`shared/js/sw.js:1228`, `shared/js/sw.js:4913`). The row stays active.
- Manual pause/cancel also skips pending coordinator rows with no href (`shared/js/sw.js:2355`).

Impact: a source-post "Resolve Profile" row can stay active indefinitely if the tab is closed, crashes, navigates away, or otherwise disappears before calling `resolve-queued-profile-target` or `resolve-queued-profile-target-failed`. That leaves the run incomplete, keeps stored-work repair/resume busy, and prevents idle retry from seeing the queue as idle.

Recommendation: add coordinator-key terminalization paths for profile-resolution rows. For tab removal and stale repair, locate the item by `metadata.coordinatorKey`/`resolve-profile:` key and mark it `failed` or `skipped` with `outcome: 'unresolved-target'` or `timeout`, clearing `tabId` and lease state. For pause, cancel pending rows by coordinator key even when no profile href exists.

### High: Retrying an `unblock-unmute` failure can run the mute/block flow instead

Both failed-row retry paths force executor `tabAction: 'nuke'` when they start the selected failed rows (`shared/js/sw.js:2683`, `shared/js/sw.js:2863`). `enqueueExistingExecutorForCoordinatorOnce()` then gives `options.tabAction` priority over the item action (`shared/js/sw.js:1934`) and writes that value into the queued action (`shared/js/sw.js:1961`). The content script chooses the actual flow from `claimedAction.action`, not from `claimedAction.actionKind`: anything other than `unblock-unmute` becomes `mute-block` (`shared/js/content.js:8699`, `shared/js/content.js:8701`).

Impact: a failed reverse action can be retried as `nuke`. The queue item may still carry `actionKind: 'unblock-unmute'`, but the claimed action presented to the content script is `action: 'nuke'`, so the retry runs the mute/block path against a profile the operator asked to unblock/unmute.

Recommendation: do not pass a blanket `tabAction: 'nuke'` for failed retry/requeue. Preserve each item executor action, or make content dispatch from `actionKind` when it is present and trusted. Add a regression test that a failed `unblock-unmute` row requeues with `action: 'unblock-unmute'` and runs the reverse flow.

### Medium: Automatic idle retry reuses the failed attempt id

`retryCoordinatorFailedItems()` builds a queued retry by spreading the failed item and resetting status/timing fields, but it does not assign a fresh `attemptId` or `attemptNumber` (`shared/js/sw.js:2601`). It sets `attempt: 0` but leaves the old `attemptId`/`attemptNumber` in place (`shared/js/sw.js:2619`). The manual requeue path does the safer thing by creating a new attempt id and next attempt number (`shared/js/sw.js:2760`).

Impact: stale messages from the previous failed worker can pass the attempt checks for the automatic retry because the new retry is not distinguishable from the old attempt. That undermines the stale-attempt protections and can let old terminal progress or heartbeats affect the replacement job.

Recommendation: mirror the manual requeue behavior in automatic retry: generate a fresh `attemptId`, advance `attemptNumber`, clear any action lease fields, and ensure queued executor metadata uses the new attempt identity.

### Low: `puppeteer-core` remains a project dependency despite the repo live-browser rule

The repo instructions say live browser automation here must not use Puppeteer and should use direct Chrome DevTools Protocol instead (`AGENTS.md:56`). `package.json` still includes `puppeteer-core` as a production dependency (`package.json:23`).

Impact: this increases install/package footprint and keeps an attractive but disallowed automation path available to future work. It is not a runtime extension bug unless something imports it, but it conflicts with the current operating rule.

Recommendation: remove `puppeteer-core` if no maintained local script still requires it, or move/annotate the historical script dependency so it cannot be confused with the supported validation path.

Status: resolved in `1.6.212`; `puppeteer-core` was removed from `package.json` and `package-lock.json`. Remaining `puppeteer` matches are Quora DOM class names, not Puppeteer usage.

## Broader Design Findings

### Architecture: the migration is stuck in a hybrid authority model

The design note says durable storage is the source of truth, the service worker is the only mutation authority for durable job state, and `mbProfileNukeProgress` should be a compatibility/reporting mirror rather than a parallel mutation source (`top-level-rethink-1.5.md:14`, `top-level-rethink-1.5.md:17`, `top-level-rethink-1.5-execution-plan.md:92`). The current content script still updates its local `profileNukeProgress` first, then tries job-protocol messages, then falls back to `record-nuke-progress` if the job protocol is not acknowledged (`shared/js/content.js:765`, `shared/js/content.js:775`, `shared/js/content.js:785`). The service worker still listens for storage changes on `mbProfileNukeProgress` and feeds them back into coordinator progress sync (`shared/js/sw.js:6281`).

This is the core architectural drag. It makes the system look service-worker-owned while still preserving an independent progress stream that can influence repair, display, retries, and terminal settlement. Many of the small fixes in the execution plan are symptoms of that hybrid: repair stopped accepting some stale progress, then re-accepted same-attempt terminal compatibility progress, then serialized more paths, then added terminal-equivalence guards (`top-level-rethink-1.5-execution-plan.md:100`, `top-level-rethink-1.5-execution-plan.md:126`, `top-level-rethink-1.5-execution-plan.md:128`, `top-level-rethink-1.5-execution-plan.md:135`).

Recommendation: make this a hard migration boundary. For queued jobs, content should send `claim`, `milestone`, `heartbeat`, and `terminal` only; the service worker should write the queue row and then derive any legacy/profile-progress mirror. If the service worker does not acknowledge a terminal write, the worker should keep the tab alive or fail closed through an explicit retry/ack path, not mutate an alternate durable state stream.

### Architecture: job identity is still split across URL keys, action strings, and legacy fields

The target design calls for a canonical job key of `<scope>|<actionKind>|<canonicalSubject>`, with `actionKind`, `scope`, and attempt identity as first-class fields (`top-level-rethink-1.5.md:128`, `top-level-rethink-1.5.md:130`, `top-level-rethink-1.5.md:133`). Current runtime identity is still spread across physical storage keys, `dedupeKey`, `coordinatorKey`, `targetProfileHref`, `requestedUrl`, `tabAction`, `actionKind`, and `executorTabAction`. The action dispatch bug above is one direct consequence: the queue item can say `actionKind: 'unblock-unmute'`, while executor setup can still hand the content script `action: 'nuke'` (`shared/js/sw.js:1934`, `shared/js/sw.js:1950`, `shared/js/sw.js:1961`, `shared/js/content.js:8701`).

This split also makes profile-resolution rows special instead of naturally modeled: they are coordinator-key-only jobs until they resolve to a profile, so generic tab removal, pause, stale repair, and settlement paths keep assuming profile hrefs and miss them.

Recommendation: finish the canonical job-envelope migration before adding more behaviors. The claim response should carry one `jobKey`, one `attemptId`, one `actionKind`, and one subject/requested URL shape, matching the design sketch (`top-level-rethink-1.5.md:238`). `tabAction` should become a view/executor detail derived from `actionKind`, not an independent input to scheduling or content dispatch.

### Architecture: the scheduler is only partially durable

The design says cached scheduler facts may exist, but every cached fact must be rebuildable (`top-level-rethink-1.5.md:17`). Current scheduling still depends on service-worker memory maps and sets: `pendingTabActions`, `queuedTabMetadata`, `queuedTabActions`, `activeQueuedTabs`, ownership maps, paused owners, and `queuedForegroundLeaseTabId` (`shared/js/sw.js:21`, `shared/js/sw.js:75`). Some lease state is persisted in queue rows as `actionLease`, but foreground ownership and active-tab bookkeeping still live partly in memory/metadata (`shared/js/sw.js:3811`, `shared/js/sw.js:4169`).

That explains the amount of repair code: the system has to infer intent from live tabs, progress mirrors, queue rows, and owned-tab state after any restart or tab disappearance. This is workable as a recovery shim, but it is not a clean durable scheduler.

Recommendation: put claim and lease ownership on the job attempt itself: `attempt.claimedTabId`, `attempt.claimedAt`, `attempt.heartbeatAt`, `attempt.leaseExpiresAt`, action/foreground lease owner, and lease reason. Treat in-memory queues as caches rebuilt from durable `queued/opening/active/acting` jobs. After that, tab disappearance becomes one reducer input, not a set of special cases across tab listeners and repair loops.

### Architecture: the state machine exists in tests but is not the runtime authority

`jobState.js` defines valid job statuses and allowed transitions, and tests check a few examples (`shared/js/jobState.js:40`, `shared/js/jobState.js:205`, `test/jobState.test.js:157`). The service worker does not use `canTransitionJobStatus`; it has its own `transitionCoordinatorItemFromProgress()` that assigns `status: mapped.status` directly and is called from multiple repair and lifecycle paths (`shared/js/sw.js:727`, `shared/js/sw.js:939`, `shared/js/sw.js:1247`, `shared/js/sw.js:5898`).

This means the formal transition table is documentation plus unit-test fixture, not the real guardrail. The runtime policy is distributed across many "if terminal then restore, if authoritative then skip, if reset retry then allow" blocks. That is why regressions keep appearing as illegal-looking state rewrites or late stale-progress effects.

Recommendation: move queue-row transitions into a reducer that is the only way to change a job row. Inputs should be explicit events like `ENQUEUED`, `TAB_OPENED`, `CLAIMED`, `MILESTONE`, `TERMINAL`, `TAB_REMOVED`, `LEASE_EXPIRED`, `PAUSE`, and `RETRY`. The reducer should enforce allowed transitions and return side effects for the tab gateway to execute. Then the service-worker listeners become event adapters, not state machines.

### Architecture: the service worker is carrying too many roles to reason about safely

`shared/js/sw.js` is over 6500 lines and combines storage schema migration, scheduler, tab ownership, profile-progress normalization, run aggregation, source-page settlement, retry policy, coordinator-page lifecycle, action leases, tab cleanup, and webRequest notification plumbing. The browser event handlers at the bottom directly dispatch into all of those concerns (`shared/js/sw.js:6139`, `shared/js/sw.js:6293`, `shared/js/sw.js:6468`).

This makes every fix high blast radius. For example, changing retry policy can affect action selection, queue rows, progress mirrors, source settlement, coordinator rendering, and tab cleanup because those concerns share mutable module state.

Recommendation: split by responsibility before the next major behavior expansion:

- `jobStore`: load/save/compact durable queue, runs, events, and mirrors.
- `jobReducer`: pure transitions and retryability.
- `scheduler`: chooses which jobs to claim and what tab operations are needed.
- `tabGateway`: browser tab create/remove/query and ownership recovery.
- `sourceSettlement`: pending/nuked post accounting from terminal job events.
- `coordinatorApi`: command handlers for dashboard/UI requests.

The split does not need new framework code; it needs boundaries that let unit tests exercise scheduler/reducer behavior without a live browser.

### Architecture: validation is too live-browser-heavy for the current risk

The package test script only runs `subject.test.js` and `jobState.test.js` (`package.json:12`). The hardest behavior now lives in service-worker scheduling, leases, retry/requeue, tab disappearance, storage repair, and source settlement, but those paths are not unit-testable in their current form. The execution plan's long history of live 8-profile loops caught real issues, but it also shows a slow feedback loop where architectural bugs are found only after packaging and live Quora runs.

Recommendation: add a deterministic service-worker model test harness before continuing feature work. It should simulate storage, tabs, tab removal, time, worker messages, and runtime command messages. The first scenarios should cover:

- queued profile job succeeds and closes;
- queued profile job tab disappears before terminal;
- queued profile-resolution job tab disappears before resolving;
- failed `unblock-unmute` retry preserves reverse action;
- idle retry creates a fresh attempt id;
- late stale progress from an old attempt is rejected;
- pause cancels both profile-href and coordinator-key-only jobs.

Live CDP validation should remain the final browser/Quora confidence check, not the first reliable way to prove scheduler correctness.

## Action Items

### P0: Stop known incorrect behavior

- [x] Fix failed `unblock-unmute` retry/requeue action routing.
  - Change failed retry/requeue so each selected row preserves its own `actionKind` and executor action.
  - Remove blanket `tabAction: 'nuke'` from failed retry/requeue execution, or make content dispatch from trusted `actionKind`.
  - Acceptance: a failed `unblock-unmute` row claims as `unblock-unmute`, not `nuke`; a failed `mute-block` row still claims as `nuke`/`mute-block`.

- [x] Generate fresh attempt identity for automatic idle retry.
  - Mirror manual requeue behavior by assigning a new `attemptId` and next `attemptNumber`.
  - Clear lease, tab, terminal, settlement, and active timing fields on the retry row.
  - Acceptance: stale terminal/progress messages from the previous failed attempt are rejected after idle retry starts.

- [x] Terminalize profile-resolution rows when their worker tab disappears.
  - Add coordinator-key-based cleanup for `resolve-profile:` rows in tab removal, stale repair, and pause/cancel.
  - Mark unresolved/disappeared resolution rows as terminal `skipped` or `failed` with a specific outcome such as `unresolved-target` or `timeout`.
  - Acceptance: closing a profile-resolution worker tab cannot leave Current Work permanently `active`.

### P1: Make the queue the only authority for queued jobs

- [x] Remove content-side durable fallback for active queued jobs.
  - For active queued jobs, stop writing `mbProfileNukeProgress` first and then trying the service worker.
  - Send only job-protocol messages: claim, milestone, heartbeat, terminal, release.
  - Keep the worker tab alive until terminal acknowledgement or an explicit bounded failure path.
  - Acceptance: queued-job terminal state is written by the service worker first; profile progress is derived afterward.

- [x] Convert `mbProfileNukeProgress` into a mirror for queued jobs.
  - Service worker writes or derives progress records from queue rows for display/backward compatibility.
  - Storage-change sync from `mbProfileNukeProgress` must not drive service-worker-owned queue rows.
  - Acceptance: no repair path can move a service-worker-owned queue row based only on a stale progress mirror.

- [x] Define a single canonical job envelope.
  - Every queued item should expose `jobKey`, `actionKind`, `canonicalSubject` or resolution subject, `scope`, `attempt`, and source/evidence.
  - Keep legacy physical keys only as compatibility storage keys, not as behavioral identity.
  - Acceptance: scheduling, retry, pause, tab removal, and settlement can address every job by `jobKey`, including profile-resolution jobs.

### P2: Move runtime state transitions into a reducer

- [ ] Build a pure job reducer.
  - Inputs should be explicit events: `ENQUEUED`, `TAB_OPENED`, `CLAIMED`, `MILESTONE`, `HEARTBEAT`, `TERMINAL`, `TAB_REMOVED`, `LEASE_EXPIRED`, `PAUSE`, `RETRY`, `SETTLED`.
  - The reducer should enforce allowed transitions and reject stale attempts.
  - Partial status: `1.6.210` added the reducer and `1.6.211` routed progress-derived coordinator transitions through it. `SETTLED` and broader service-worker authority are still pending.
  - Acceptance: service-worker code cannot directly assign arbitrary `status` values for normal job lifecycle changes.

- [ ] Route service-worker listeners through event adapters.
  - `tabs.onRemoved`, `tabs.onUpdated`, runtime messages, storage repair, retry, and pause should build reducer events.
  - Partial status: retry/requeue, terminalization, tab-removal terminalization, and progress-derived transitions now use reducer events; broad listener conversion is still pending.
  - Browser side effects such as tab close/open should be returned as commands from scheduler/gateway code.
  - Acceptance: one reducer test can cover a scenario regardless of whether the trigger is tab removal, heartbeat timeout, or explicit repair.

- [ ] Make leases durable attempt fields.
  - Persist `claimedTabId`, `claimedAt`, `heartbeatAt`, `leaseExpiresAt`, action/foreground lease owner, and lease reason on the job attempt.
  - Treat `queuedTabActions`, `queuedTabMetadata`, `activeQueuedTabs`, and foreground lease memory as rebuildable caches only.
  - Acceptance: service-worker restart during `opening`, `active`, or `acting` can reconstruct scheduler state from storage plus live tabs.

### P3: Split service-worker responsibilities

- [ ] Extract `jobStore`.
  - Own loading, saving, pruning, mirroring, and checkpoint generation switching for queue, runs, events, progress, pending posts, and nuked posts.
  - Acceptance: storage read-modify-write serialization is localized instead of repeated across unrelated functions.

- [ ] Extract `scheduler` and `tabGateway`.
  - `scheduler` decides which jobs to claim, retry, pause, or settle.
  - `tabGateway` owns browser tab create/remove/query, ownership persistence, and live-tab reconciliation.
  - Acceptance: retry policy can be changed without editing profile-progress normalization or source settlement code.

- [ ] Extract `sourceSettlement`.
  - Convert terminal job events into pending/nuked post updates.
  - Keep source-page UI reconciliation separate from durable settlement policy.
  - Acceptance: a terminal queue event is sufficient to settle source records without source page participation.

- [ ] Keep coordinator as UI/API only.
  - Coordinator should send commands and render storage state.
  - It should not be required for scheduling, retry persistence, repair, or run completion.
  - Acceptance: closing the dashboard during a run does not alter execution, retry, or settlement behavior.

### P4: Add deterministic scheduler validation

- [ ] Add a service-worker model test harness.
  - Fake storage, time, tabs, runtime messages, and tab lifecycle events.
  - Keep it independent of real Chrome and Quora.
  - Acceptance: `npm test` covers scheduler/reducer behavior without a browser.

- [ ] Add regression cases for the current high-risk scenarios.
  - Profile job succeeds and closes.
  - Profile job tab disappears before terminal.
  - Profile-resolution job tab disappears before resolving.
  - Failed `unblock-unmute` retry preserves reverse action.
  - Idle retry creates a fresh attempt id.
  - Stale old-attempt progress is rejected.
  - Pause cancels profile-href and coordinator-key-only jobs.
  - Acceptance: these cases fail against the current risky behavior and pass after the corresponding fixes.

- [ ] Keep live CDP checks as final validation.
  - Use deterministic tests for reducer/scheduler correctness first.
  - Use live Chrome/CDP to verify Quora DOM behavior, extension packaging, and real interaction timing.
  - Acceptance: no scheduler correctness claim depends solely on a live Quora run.
