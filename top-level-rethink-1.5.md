# Top-Level Rethink 1.5

This note turns `notes-1.5` into a concrete durable job model for the `1.5`
queue/coordinator reset. It is a design artifact only: no behavior should be
changed until an implementation slice is chosen from the plan below. The
execution plan is in `top-level-rethink-1.5-execution-plan.md`.

Update: the current `1.5.x` state has been preserved on `refactor/1.5`; this
model is now the basis for the `1.6` main-line reset, with public release
targeted as `2.0`.

## Premises

- Durable browser storage is the source of truth for work that must survive
  restart, extension reload, coordinator close, worker-tab close, or service
  worker suspension.
- The service worker is the only mutation authority for durable job state. It
  may cache scheduling locks, live tab ids, ports, timers, and concurrency
  counters, but every cached fact must be rebuildable.
- The coordinator page is a UI/control surface. It may request work, display
  state, and issue operator commands, but a run must not depend on the page
  staying open.
- Worker tabs are disposable executors. They claim one durable job, report
  milestones, and either terminally complete it or disappear.
- Profile-page buttons, modal `Nuke 'Em`, space-feed `Nuke 'Em`, and
  retry-failed should all enter the same durable queue model.

## Current Storage Surfaces

The current implementation has overlapping state:

- `mbCoordinatorQueue`: durable-ish coordinator rows keyed by normalized target
  profile href.
- `mbCoordinatorRuns`: run summaries and source pages.
- `mbCoordinatorEvents`: display/audit events.
- `mbProfileNukeProgress`: legacy per-profile progress records, now also used
  as the worker milestone stream.
- `mbSpacePendingNukedPosts`: source-page post association and pending
  accounting.
- Service-worker memory: `queuedTabActions`, `pendingTabActions`,
  `queuedTabMetadata`, `activeQueuedTabs`, `ownedTabIdsByParent`,
  `owningParentByChild`, `pausedQueuedOwners`, and current coordinator tab id.

The target model keeps the useful storage names initially, but changes the
ownership rule: coordinator queue rows are the durable job records; profile
progress becomes a compatibility mirror until removed.

## Durable Job Record

Store each active or historical job in `mbCoordinatorQueue` keyed by:

```text
<scope>|<actionKind>|<canonicalSubject>
```

For the first migration, keep the existing profile-href key as the physical key
and add the canonical key as a field. Moving the physical key can be a later
storage migration.

```js
{
  schemaVersion: 2,
  id: 'job-...',
  dedupeKey: 'space-feed|mute-block|https://www.quora.com/profile/...',
  canonicalSubject: {
    kind: 'quora-profile',
    href: 'https://www.quora.com/profile/...',
    slug: '...',
    aliases: []
  },
  actionKind: 'mute-block',
  scope: {
    type: 'space-feed',
    runId: 'space-feed-...',
    sourcePageUrl: 'https://...',
    spaceKey: '...',
    spaceCategory: 'asset'
  },
  sources: [
    {
      type: 'space-feed',
      pageUrl: 'https://...',
      discoveredAt: 0,
      collector: 'profile-links'
    }
  ],
  evidence: [
    {
      postKey: '...',
      postUrl: 'https://...',
      collector: 'profile-links',
      sourcePageUrl: 'https://...'
    }
  ],
  status: 'queued',
  outcome: '',
  error: '',
  attempt: {
    id: 'attempt-...',
    number: 1,
    max: 1,
    claimedTabId: null,
    claimedAt: 0,
    leaseExpiresAt: 0,
    heartbeatAt: 0
  },
  milestones: {
    tabCreatedAt: 0,
    navigationStartedAt: 0,
    contentOpenedAt: 0,
    actionClaimedAt: 0,
    profileReadyAt: 0,
    muteAttemptedAt: 0,
    blockAttemptedAt: 0,
    closeRequestedAt: 0,
    tabClosedAt: 0
  },
  createdAt: 0,
  updatedAt: 0,
  queuedAt: 0,
  activeAt: 0,
  terminalAt: 0
}
```

Notes:

- `actionKind` should start with `mute-block`; add `mute-block-close` as a
  first-class action instead of keeping direct page-only execution.
- `scope` is part of dedupe. A space-feed run can dedupe one profile once per
  action within the active run; global successful terminal rows still prevent
  duplicate destructive work.
- `attempt.id` avoids accepting stale worker messages after a retry has claimed
  a newer attempt for the same subject.
- `leaseExpiresAt` and `heartbeatAt` replace scattered stale-active timers.
  They can initially be derived from the existing milestone timestamps.

## Run Record

`mbCoordinatorRuns` should summarize runs only. It must not be required to know
which work is real; jobs do that.

```js
{
  schemaVersion: 2,
  id: 'space-feed-...',
  sourceType: 'space-feed',
  sourcePages: ['https://...'],
  targetJobKeys: ['space-feed|mute-block|https://...'],
  status: 'active',
  paused: false,
  stopAfterActive: false,
  itemCount: 0,
  activeCount: 0,
  terminalCount: 0,
  createdAt: 0,
  updatedAt: 0,
  terminalAt: 0
}
```

Run counts are derived from jobs by the service worker. The coordinator may
derive them for display, but should not write derived counts directly except
through a service-worker command.

## Status Table

| Status | Meaning | Entered by | Leaves by | Survives restart | Reconciler rule |
| --- | --- | --- | --- | --- | --- |
| `queued` | Durable work exists but no live tab is claimed. | Service worker enqueue, retry, repair-time unclaim. | Service worker claim opens tab and writes `opening`. Cancel writes `canceled`. Prior success writes `succeeded`. | Yes | If no terminal result exists, schedule when capacity allows. |
| `opening` | Service worker created or is creating a worker tab. | Service worker scheduler. | Worker `claim-job`/`content-opened` writes `active`; tab creation failure writes `failed`; timeout unclaims to `queued` or `failed`. | Yes | If claimed tab is gone and lease expired, clear `claimedTabId`; retry or fail by attempt policy. |
| `active` | Worker tab claimed the job and is navigating or waiting for actionable DOM. | Worker claim via service worker. | Worker milestones may stay `active`; action start writes `acting`; timeout/tab close writes `failed` or retry. | Yes | If tab alive and heartbeat fresh, leave alone. If heartbeat expired, retry or fail. |
| `acting` | Destructive mute/block action is in progress. | Worker milestone through service worker. | Success writes `succeeded`; unavailable writes `skipped`; action/error/timeout writes `failed` or retry. | Yes | Use action-specific lease. If tab gone or lease expired, retry only when action idempotence is safe. |
| `settling` | Terminal action finished and tab cleanup/source-page settlement is pending. | Service worker after worker reports success/skip/fail and before close accounting completes. | Service worker writes terminal status after tab close/source settlement or after bounded cleanup timeout. | Yes | If close tab is gone, complete settlement from durable terminal outcome. |
| `succeeded` | Target is blocked or already blocked. | Service worker from worker terminal report or existing confirmed progress. | No normal transition. Explicit operator retry may create a new job/attempt only if action demands it. | Yes | Keep as global success evidence; collapse duplicate active/queued jobs into this outcome. |
| `skipped` | No destructive work was possible or needed, for example profile unavailable. | Service worker from worker terminal report. | Operator retry may requeue if policy allows. | Yes | Keep terminal unless source explicitly requests retry. |
| `failed` | Work ended without success. `outcome` classifies retryability. | Service worker from worker failure, timeout, missing tab, or security verification. | Retryable failures can be requeued by retry command. Security verification stays terminal. | Yes | Retry `timeout` and `action-error` by policy; do not retry explicit `security-verification`. |
| `canceled` | Operator or source canceled queued work before claim. | Service worker pause/stop/cancel command. | Operator resume may requeue or create a new job. | Yes | Do not auto-resume unless command explicitly says so. |

Implementation mapping from current progress statuses:

- `queued` -> `queued`
- `tab-opening` -> `opening`
- `tab-opened`, `awaiting-visibility`, `page-ready` -> `active`
- `muting`, `blocking`, `retrying` -> `acting`
- `blocked`, `already-blocked` -> `succeeded`
- `profile-unavailable` -> `skipped`
- `error`, `error-page`, `interrupted` -> `failed`

## Allowed Writers

| Actor | May write | Must not write |
| --- | --- | --- |
| Service worker | Jobs, runs, events, migration mirrors, claim records, leases, terminal outcomes, source-page settlement. | DOM-derived facts it did not receive from a page. |
| Coordinator page | Operator commands only: enqueue request, pause/resume, stop-after-active, retry, clear/hide completed, export. | Direct job/runs mutation. |
| Source page content script | Discovery requests, source evidence, UI-local optimistic labels, direct single-profile command requests. | Durable queue rows or terminal job state. |
| Worker tab content script | Claim request, milestone reports, terminal result reports, heartbeat. | Direct durable storage mutation. |

During migration, content scripts may still write `mbProfileNukeProgress` as a
fallback when the service worker is unavailable. New code should treat that as
compatibility, not as the primary path.

## Message Protocol Sketch

All state-changing messages go to the service worker.

```js
// Source or coordinator -> service worker
{ action: 'queue-jobs', run, source, jobs, execute }
{ action: 'pause-run', runId }
{ action: 'resume-run', runId }
{ action: 'stop-after-active', runId }
{ action: 'retry-jobs', jobKeys, retryLimit }
{ action: 'query-jobs', runId, sourcePageUrl, includeTerminal }

// Worker tab -> service worker
{ action: 'claim-job', tabIdHint, currentUrl }
{ action: 'job-heartbeat', jobKey, attemptId, status, milestone }
{ action: 'job-milestone', jobKey, attemptId, milestone, at }
{ action: 'job-terminal', jobKey, attemptId, outcome, error, facts }
{ action: 'release-job-tab', jobKey, attemptId, reason }

// Coordinator page -> service worker
{ action: 'coordinator-ready' }
{ action: 'repair-jobs' }
{ action: 'export-jobs', runId }
```

Compatibility aliases can wrap existing messages:

- `enqueue-coordinator-items` -> `queue-jobs`
- `claim-tab-action` -> `claim-job`
- `record-nuke-progress` -> `job-milestone` or `job-terminal`
- `record-nuke-progress-batch` -> initial `queue-jobs` compatibility mirror
- `resume-coordinator-queue` -> `repair-jobs` plus scheduler tick
- `pause-coordinator-nukes` -> `pause-run` or global pause

The claim response should include:

```js
{
  jobKey: '...',
  attemptId: '...',
  actionKind: 'mute-block',
  targetProfileHref: 'https://...',
  requestedUrl: 'https://...',
  noForegroundFallback: true,
  leaseMs: 35000
}
```

The service worker must reject milestone or terminal messages whose `attemptId`
does not match the current durable job attempt.

## Reconciler Rules

The reconciler runs on service-worker startup, extension update, storage-change
notification for job storage, coordinator-ready, explicit repair command, and
before scheduling a new tab.

| Observed durable state | Live tab state | Action |
| --- | --- | --- |
| Duplicate nonterminal jobs for same dedupe key | Any | Keep newest claimed/live attempt, otherwise oldest queued; merge sources/evidence; cancel or remove duplicates deterministically. |
| `queued` job | No tab | Schedule subject to run pause/concurrency and terminal success checks. |
| `opening` job | Claimed tab live, lease fresh | Leave alone. |
| `opening` job | Claimed tab missing or lease expired | Clear claim and return to `queued` if attempts remain; otherwise `failed: timeout`. |
| `active` job | Claimed tab live, heartbeat fresh | Leave alone. |
| `active` job | Tab missing or heartbeat expired | Return to `queued` if no destructive action was attempted and attempts remain; otherwise `failed: timeout`. |
| `acting` job | Tab live, action lease fresh | Leave alone. |
| `acting` job | Tab missing or action lease expired | Fail as `timeout` unless the action-specific idempotence rule allows retry. |
| `settling` job | Tab missing or close lease expired | Complete terminal outcome and source-page settlement from durable facts. |
| `failed: security-verification` | Any | Leave terminal. Do not auto-retry. |
| `failed: timeout/action-error` | No pending work and retry policy enabled | Requeue through retry command, preserving failure history. |
| `succeeded` job | Duplicate queued/active job exists | Collapse duplicate to succeeded and merge evidence/source history. |
| Coordinator tab missing | Any nonterminal work | Open coordinator only for UI visibility if requested or if current UX requires it; scheduler must not require it. |
| Source page missing | Any nonterminal work | Continue. Source page absence does not cancel execution. |

## Dedupe Scope

Canonical subject:

- Normalize Quora profile href through `shared/js/subject.js`.
- Use the resolved profile href when a worker discovers a redirect/remap.
- Record aliases rather than changing the job key mid-attempt.

Scope rules:

- Global destructive success wins: if any terminal record proves the profile is
  blocked/already-blocked, new `mute-block` jobs should become `succeeded` or
  be skipped before opening a tab.
- Active dedupe is by `actionKind + canonicalSubject` for profile/modal direct
  actions and by `runId + actionKind + canonicalSubject` for source accounting.
- Source evidence may have many posts/pages for one job. Do not create one job
  per post when the action target is one profile.

Repair-time dedupe is mandatory. Entry-time dedupe is an optimization, not the
only correctness mechanism.

## Migration Rules

`mbCoordinatorQueue`:

- Treat existing rows as schema version 1.
- Add `schemaVersion: 2`, `canonicalSubject`, `actionKind`, `scope`, and
  structured `attempt`.
- Map `tabId` to `attempt.claimedTabId`.
- Map flat `attempt` number to `attempt.number`.
- Preserve `targetProfileHref`, `requestedUrl`, `sources`, `evidence`, and
  timestamps.

`mbCoordinatorRuns`:

- Preserve current run ids.
- Add `schemaVersion: 2` and `targetJobKeys` when possible.
- Recompute counts from jobs.
- Keep `sourcePages` as display/source recovery data.

`mbProfileNukeProgress`:

- For existing rows, use it as a migration input to update coordinator jobs.
- After migration, write it only as a compatibility mirror for UI/reporting that
  has not moved yet.
- Stop using it as a competing source of truth for queue status.

`mbSpacePendingNukedPosts`:

- Keep it as source-page settlement data.
- Link pending post records to durable `jobKey` values when possible.
- Let terminal job outcomes drive removal from pending and promotion to
  remembered nuked posts.

Service-worker memory:

- Rebuild `queuedTabActions` from durable `queued` jobs instead of treating it
  as a second queue.
- Rebuild active tab maps from durable claims plus live tabs.
- Clear any memory-only owner pause state into durable run pause state.

## Refactor Slices

1. Add schema helpers and pure tests.
   Define job key construction, schema upgrade, progress-to-job mapping,
   terminal/retry policy, and transition validation in a shared module.

2. Move coordinator queue writes behind service-worker transition helpers.
   Replace open-coded row writes in `enqueueCoordinatorItemsStorage`,
   `syncCoordinatorProgressRecords`, and retry logic with validated
   transitions. Keep existing message names.

3. Add attempt ids and reject stale worker reports.
   Include `attemptId` in claim responses and progress writes. Keep accepting
   missing ids during migration, but log/mark compatibility.

4. Make the service worker scheduler read durable `queued` jobs.
   Treat `queuedTabActions` as a transient scheduling buffer rebuilt from
   storage, not as independent state.

5. Convert worker-tab progress writes to job milestone/terminal messages.
   Keep `mbProfileNukeProgress` mirror writes in the service worker for UI
   compatibility.

6. Convert modal and direct profile actions to `queue-jobs`.
   The old `enqueue-tabs` direct path should become a wrapper over the durable
   queue or be limited to non-durable debugging.

7. Move source-page settlement behind service-worker job terminal handling.
   Space pending/nuked post updates should be driven by terminal job outcomes
   and evidence associations.

8. Replace stale-active logic with lease/heartbeat reconciliation.
   Keep current timeout constants as default lease durations, but apply them
   through status-specific reconciler rules.

9. Remove coordinator-page execution dependency.
   `coordinator-ready` can request repair/resume, but startup/storage-change
   scheduler ticks must continue work without an open coordinator page.

10. Retire compatibility mirrors.
    Once UI/report/export paths read durable jobs, stop using
    `mbProfileNukeProgress` as queue state and keep only bounded diagnostic
    history if still useful.

## First Implementation Candidate

The safest next code slice is not the full scheduler rewrite. It is:

- introduce a pure `jobState` module with schema upgrade, status mapping,
  dedupe key construction, transition validation, and retry classification;
- add contract tests for the status table and schema migration;
- switch only display/repair mapping code to call that module.

That gives the debugging session one authoritative model to compare against
without forcing all queue execution through a new path at once.
