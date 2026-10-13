# Refactor 1.6 Execution Checklist

Status: historical checklist and slice context.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this note for
implementation provenance and older slice detail, not as the current priority
source.

This file was originally written during the late `1.5` rethink, but it is now
the detailed execution checklist for the `1.6` main line. The canonical front
door is `refactor-1.6-plan.md`; this note keeps the slice-level history and
implementation detail.

The public release target for completed `1.6` work is `2.0`. The `1.5` series
is closed for new feature work.

The reset remains incremental: first create an authoritative model, then route
existing behavior through it, then retire duplicate queue/progress paths.

## Execution Rules

- Keep each slice shippable or trivially revertible.
- Preserve the current operator workflows while internals move:
  profile `Mute Block`, `Mute Block Close`, modal `Nuke 'Em`, space-feed
  `Nuke 'Em`, retry-failed, pause, and coordinator display.
- Do not add broad recovery behavior that is not expressible in the durable job
  state table.
- Treat shared-post import and ATproto compatibility work as `2.0` precursor
  design unless it is directly required to stabilize the current queue model.
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

Status note, 2026-05-19 cleanup:

This table is now historical in several places. The current active plan front
door is `refactor-1.6-plan.md`, and the latest ordered handoff is
`other-codex-ordered-handoff-2026-05-19.md`. The 2026-05-19 review-fix pass is
tracked as complete in `review-fix-checklist-2026-05-20.md`.

Use the table below for architectural history and slice context, not as a
freshly audited current-status matrix. Re-check current source before treating a
`Not started` or `In progress` status here as authoritative.

| Slice | Status | Primary files | Validation |
| --- | --- | --- | --- |
| 0. Baseline and guardrails | Not started | docs only, optional test fixtures | Existing `npm test`; no rebuild unless code changes. |
| 1. Pure job-state module | Complete | `shared/js/jobState.js`, `test/jobState.test.js`, `package.json` test script | `npm test` passes. |
| 2. Read-side adoption | Complete | `shared/js/sw.js`, `shared/js/coordinator.js` | `npm test` passes; ready for coordinator display smoke after build. |
| 3. Service-worker transition helpers | Complete in `1.6.76` | `shared/js/sw.js`, `shared/js/jobState.js` | `npm test` passes; build/package passes; 8-profile block/reverse loop passed with no stale-attempt delta and no attempt mismatches. |
| 4. Attempt ids and stale-report rejection | Complete in `1.6.75` | `shared/js/sw.js`, `shared/js/content.js`, `shared/js/jobState.js` | Unit tests pass; 8-profile block/reverse stability loop passed with matching item/progress attempt ids and no new stale-attempt diagnostics. |
| 5. Durable scheduler | Complete in `1.6.81` | `shared/js/sw.js`, `shared/js/jobState.js`, `shared/js/content.js` | Service-worker-owned 8-profile reverse/block tests with coordinator closed. |
| 6. Worker milestone protocol | In progress in `1.6.186` | `shared/js/content.js`, `shared/js/sw.js` | `1.6.110` moved job-protocol milestones/terminals to direct queue mutation. `1.6.111` stopped the repair pass from driving authoritative service-worker queue rows from legacy progress. `1.6.112` accepted same-attempt terminal compatibility progress. `1.6.113` serialized queued-tab opening transitions. `1.6.114` skipped redundant successful-progress sync on terminal rows. `1.6.115` serialized repair read-modify-write. `1.6.116` stopped terminal repair from rewriting equivalent terminal progress. `1.6.117` split terminal settlement into public queued and internal locked paths to avoid nested storage-lane deadlock. `1.6.118` cancels stale same-profile executors on explicit reset. `1.6.119` carries run/attempt identity through queued executor metadata and retry actions. `1.6.120` improves terminal-progress acknowledgement and reverse-action heartbeats. `1.6.121` gives reverse actions an action-specific 90s stale lease. `1.6.122` introduces service-worker-owned foreground leasing for queued workers but failed validation because hidden workers could still enter action phases. `1.6.123` gates queued profile-menu action start on the foreground lease. `1.6.124` keeps coordinator UI readiness/resume/retry from becoming an executor owner and lets matching same-attempt executor progress advance authoritative rows to active. `1.6.125` makes `claim-tab-action` confirm or perform the durable active claim before returning work to a content tab. `1.6.126` restores reporting progress from authoritative terminal queue rows even when compatibility flags make a stale row map to the same terminal status. `1.6.127` makes foreground-wait progress explicit and gives waiting workers a foreground-wait stale lease. `1.6.149` keeps stale terminal compatibility progress from pruning fresh queued attempts and nudges stored-work repair after an empty slot release. `1.6.151` recovers late service-worker grants by confirming the durable action lease with a heartbeat and keeps heartbeating while profile actions become ready. `1.6.152` closes terminal coordinator tabs by recorded tab id. `1.6.153` also recovers from same-attempt foreground-promotion progress when the runtime response is lost. `1.6.154` extends the durable action-gate wait for slow foreground contention. `1.6.165` keeps no-foreground mute/block workers clean in small live batches. `1.6.166` fixes the reverse confirmation selector exposed by that live pass. `1.6.167` makes service-worker pause durable and restores the coordinator UI in the background for stored work. `1.6.168` removes blocking page alerts from the content script. `1.6.169` makes idle retry persist across service-worker wake by adding an alarm-backed restore path. `1.6.170` fixes retry repair for failed rows that have no compatibility progress mirror. `1.6.172` makes coordinator retry rows display attempted profile labels instead of synthetic retry run ids. `1.6.173` renames the retry toggle to `Idle Retry` and moves its state/disabled reason under the button. `1.6.174` keeps the toggle clickable independent of queue busy/empty state and reports idleness as status only. `1.6.175` rechecks queued actions immediately before opening a worker tab and skips terminal `already-blocked` rows without tab processing. `1.6.176` counts `opening` and `acting` as active/pending work in coordinator and service-worker run summaries. `1.6.177` adds Preferences/Coordinator cross-links, collapsible coordinator panels, and hover help for sections/statuses/outcomes. `1.6.178` renames the visible Coordinator surface to Dashboard and makes Runs, Events, and Queue fill the available dashboard window height. `1.6.179` makes collapsed Dashboard sections shrink to their header height instead of retaining the section flex share. `1.6.180` shortens extension page tab titles to Dashboard and Preferences. `1.6.181` gives Preferences a wider page layout when opened as a tab while preserving the compact action-popup layout. `1.6.182` renames the visible queue/history surfaces to Current Work, Ready to Run, and Recent History, and prunes settled non-actionable Current Work after 24 hours. `1.6.183` keeps active Current Work rows sorted above ready/retry/terminal rows and gives active-like statuses cyan badges. `1.6.184` adds a manual Requeue Failed action that resets failed Current Work rows back to queued work with retry counters cleared. `1.6.185` adds queued author-profile resolution for post/question URLs so worker tabs can resolve a page to the real profile before running mute/block. `1.6.186` adds per-row failed-item Requeue controls and regularizes rounded command buttons vs rectangular status badges. |
| 7. Queue all entry points | Not started | `shared/js/content.js`, `shared/js/sw.js` | Profile, modal, and space-feed live tests. |
| 8. Source-page settlement | In progress | `shared/js/content.js`, `shared/js/sw.js`, maybe `shared/js/nukedPosts.js` | Space pending/nuked post reports before/after terminal results. |
| 9. Coordinator as UI only | Not started | `shared/js/coordinator.js`, `shared/js/sw.js` | Close coordinator mid-run; work continues or resumes. |
| 10. Compatibility cleanup | Not started | `shared/js/content.js`, `shared/js/coordinator.js`, `shared/js/sw.js` | Full manual matrix, no stale storage regressions. |
| 11. Shared-post intake design | Design only | `refactor-1.6-plan.md`, future import parser/tests | Quora-rendered `MBLOCK:BEGIN v=1` / `MBLOCK:END` blocks parse; subjects use `quora-profile:<slug>`, not raw profile URLs. |
| 12. ATproto-compatible provenance | Design only | future queue/import storage | Imported source/list/report provenance survives queue merge, local decision, settlement, and history. |

## Shared Moderation Notes

The shared moderation work belongs to the `2.0` precursor scope. It should not
restart the `1.5` branch or bypass the durable queue work.

Quora shared posts should use a marked JSON block:

```text
MBLOCK:BEGIN v=1
{ ... }
MBLOCK:END
```

The live experiment showed that Quora preserves parseable JSON text between the
markers, but raw profile URLs can be rewritten in rendered text. Shared-post
subjects should therefore use `quora-profile:<slug>` identifiers and let the
extension canonicalize those locally.

ATproto compatibility should be modeled as typed, source-attributed moderation
inputs plus local policy decisions. Imported provenance should be stored outside
the existing local discovery `evidence[]` fields so the Dashboard can answer
both questions:

- where did the extension discover this profile locally?
- which imported report/list/label caused us to queue or act on it?

## Performance Approach

Browser `storage.local` gives us multiple independently addressable top-level
keys, even though each value is still blob-like. Use that to avoid rewriting
large coordinator objects for every high-frequency worker milestone.

The service worker can write small durable log records under separate
coordinator log keys, replay them when it wakes, and fold them into the larger
`mbCoordinatorQueue` and `mbCoordinatorRuns` snapshots through a checkpoint
generation switch on a timer, threshold, idle window, or repair pass. Log
entries need stable ids or sequence numbers so replay is idempotent, and a
checkpoint switch must tolerate interruption before old-generation log keys are
retired. The service worker remains the mutation authority; this is a
performance optimization, not permission for multiple writers to race on job
state.

## Live Checkpoints

### 2026-05-11, versions `1.6.104` through `1.6.109`

- `1.6.104`: fixed the durable queue/executor attempt-id split by executing
  from stored queue rows instead of raw enqueue request items. Single-profile
  smoke reached `succeeded/already-blocked` with matching attempt ids and no
  owned tabs left.
- `1.6.105`: prevented active queued jobs from writing local
  `mbProfileNukeProgress` on service-worker protocol failure. This removed one
  direct bypass of service-worker queue transitions.
- `1.6.106`: made terminal progress monotonic against late transient writes
  from the same or unspecified attempt in both service-worker and content-side
  progress normalization.
- `1.6.107`: made `sweepOwnedBlockedProfileTabs()` record terminal progress in
  the service worker before closing a tab. This avoids relying on an async
  content-side `close-if-blocked` write after the content handler has already
  returned.
- `1.6.108`: fixed the content-side helper regression introduced by the
  terminal-preservation patch.
- `1.6.109`: added repair from terminal coordinator rows back into legacy
  profile-progress rows when a stale nonterminal progress write arrives.

Observed result: single-profile smokes pass, builds package cleanly, and Chrome
loads the extension with no manager errors after stale errors are cleared. The
8-profile block loop still does not meet repeatability or performance targets:
queue rows and legacy progress rows can still diverge during the run, for
example `succeeded/queued` or `active/already-blocked`, and completion remains
well over the target. This is no longer a single timeout problem; it is the
remaining architectural issue that `mbProfileNukeProgress` still has independent
writers during queued jobs.

Next architectural move: for service-worker-owned queued jobs, stop accepting
legacy progress rows as authoritative state. Worker tabs should report only
through job messages keyed by queue item/attempt, and `mbProfileNukeProgress`
should become derived compatibility/reporting output from the durable queue, not
a parallel mutation source.

### 2026-05-11, versions `1.6.110` through `1.6.111`

- `1.6.110`: changed job-protocol worker messages so milestones and terminal
  results update the durable coordinator queue directly. Profile progress is
  still persisted for compatibility/reporting, but it is no longer the first
  writer for queued worker results. Service-worker tab lifecycle events
  (`onUpdated`, `onRemoved`, and background blocked sweep) now use the same
  direct job-progress path.
- First `1.6.110` live batch found a remaining queue regression:
  `repairCoordinatorStorageFromProgress()` could still read stale
  `mbProfileNukeProgress` and reset an authoritative queue row from
  `succeeded` back to `queued`.
- `1.6.111`: applied the authority rule to the repair pass. For
  service-worker-owned queue rows, repair may restore reporting progress from a
  terminal queue row, but it may not use legacy progress to drive the queue.
  The exception is the internal missing-active-tab timeout repair, which is a
  service-worker recovery path rather than a legacy progress import.

Validation status for `1.6.111`: `node -c shared/js/sw.js`,
`node -c shared/js/content.js`, `npm test`, `npm run prod`,
`npm run build:chrome`, and `npm run build:firefox` all pass locally.
The Chrome/Windows live reload was blocked because the existing tunnel stopped
responding: rsync to port `10022` timed out, and CDP on port `9223` timed out.
The interrupted `1.6.110` browser run may still have target rows or profile tabs
in the live browser until the tunnel is restored and cleanup can run.

### 2026-05-11, versions `1.6.112` through `1.6.117`

- `1.6.112` loosened the previous authority rule enough to accept same-attempt
  terminal compatibility progress as a completion signal.
- `1.6.113` serialized queued-tab opening transitions through
  `enqueueSpaceFeedStorageUpdate()` after live testing showed stale opening
  snapshots could overwrite terminal queue rows.
- `1.6.114` stopped resume from re-syncing already-terminal successful progress
  rows. This made the old 592-row terminal backlog stop delaying startup work.
- `1.6.115` moved coordinator repair onto the same serialized storage update
  lane as the other full queue read-modify-write paths.
- `1.6.116` added terminal-equivalence checks so repair no longer rewrites
  equivalent terminal progress records just because the generated restore event
  has a fresh timestamp.
- `1.6.117` split terminal settlement into public queued and internal locked
  forms. Code already running on the storage lane now calls the locked form,
  avoiding a nested `enqueueSpaceFeedStorageUpdate()` deadlock.

Validation for `1.6.117`: `node -c shared/js/sw.js`, `npm test`,
`npm run prod`, `npm run build:chrome`, and `npm run build:firefox` all pass.
The Chrome unpacked build was copied to Windows with `rsync` and reloaded;
`resume-coordinator-queue` against the old 592 terminal queue rows now returns
`no-pending-items` in about 1s.

Live 8-profile cycle result under `1.6.117`: block reached all rows terminal
with no child tabs left in about 147s. Seven rows succeeded as
`already-blocked`; Klaus failed with `Profile actions not ready`. Reverse
reached all rows terminal with no child tabs left in about 184s. Six rows
succeeded as `unblocked`; Shannon and Warren failed with
`Queued tab timed out after disappearing before completion`.

Most important result: the run did not reproduce the earlier
`succeeded -> queued` regression. The remaining Slice 6 work is now action
latency/reliability and why some rows remain visually queued until late progress
or repair catches up, not stale whole-snapshot overwrites of terminal rows.

### 2026-05-11, versions `1.6.118` through `1.6.119`

- `1.6.118` made explicit reset enqueue cancel queued and live executor tabs for
  the same profile/action before assigning the new queue attempt. This prevents
  old worker tabs from continuing to send messages after a reset run has minted
  fresh attempt ids.
- `1.6.119` carries `runId`, `attemptId`, and `attemptNumber` through queued
  executor actions, tab metadata, tab-opening progress, and automatic retry
  actions. The previous retry path could create a new attempt that the durable
  queue row had not accepted, producing stale-attempt diagnostics and delayed
  queue/progress convergence.
- Validation for both versions: `node -c shared/js/sw.js`, `npm test`,
  `npm run prod`, `npm run build:chrome`, and `npm run build:firefox` passed.
  Chrome was updated via `rsync` and reports loaded version `1.6.119` with no
  manager errors.
- Live reverse cleanup after `1.6.118` eventually converged to eight
  `unblock-unmute` successes and no owned tabs, but only after about 6 minutes
  and with the coordinator page target becoming unresponsive to
  `Runtime.evaluate`.
- The coordinator page had to be closed and reopened through CDP before further
  harness-driven tests could run. This is now a distinct Slice 9 issue:
  execution state survived in the service worker/storage, but the UI/control
  page is still able to wedge under large live state.

Current state after loading `1.6.119`: the eight-profile reverse cleanup is
terminal-successful in storage and there are no owned worker tabs. The next
repeatability pass should start from this unblocked baseline, run block, then
reverse again, watching for stale-attempt diagnostics and coordinator page
responsiveness.

### 2026-05-11, versions `1.6.120` through `1.6.121`

- `1.6.120` made terminal progress delivery more tolerant of a busy service
  worker by retrying queued terminal acknowledgement longer, and added a
  reverse-action heartbeat while workers are in long `unmuting` or `unblocking`
  phases.
- `1.6.121` added an action-specific stale lease for service-worker-owned
  reverse workers: `unblock-unmute` rows in `unmuting` or `unblocking` get a
  90s active-tab timeout, while ordinary queued actions keep the generic 30s
  timeout. This is a tactical but architecture-compatible lease split; it
  should eventually become scheduler-owned foreground/action lease state.
- Validation for `1.6.121`: `node -c shared/js/sw.js`,
  `node -c shared/js/content.js`, `npm test`, `npm run prod`,
  `npm run build:chrome`, and `npm run build:firefox` all passed. Chrome was
  updated via `rsync` and reports loaded version `1.6.121` with no extension
  manager errors.
- Live 8-profile reverse cleanup under `1.6.121` completed 8/8 with all rows
  `succeeded` and all profile mirrors `already-unblocked`; owned worker tabs
  were empty afterward. Total elapsed time was about 201s, so repeatability is
  improved but performance is still unacceptable.

Next architectural move: introduce scheduler-owned foreground/action lease
state instead of letting worker tabs independently contend for Quora menu
interaction. The service worker should decide which active item owns foreground
interaction, while other items preload or wait without being timed out by the
generic active-tab lease. This also needs queue/status convergence checks so a
row cannot remain visually `queued` after the scheduler has already claimed the
work.

### 2026-05-11, version `1.6.122`

- `1.6.122` starts the foreground/action lease slice. Queued tabs that need
  profile-menu interaction no longer all open as active. The service worker
  grants one foreground lease at a time, records wait heartbeats for tabs that
  are waiting behind the lease, and promotes the next eligible active queued
  worker when the current foreground lease is released.
- Content workers now treat `foregroundBusy` promotion responses as scheduler
  backpressure and wait for the lease instead of immediately failing profile
  action readiness.
- This is still an intermediate scheduler shape: the lease is service-worker
  memory plus queued-tab metadata, not a durable job-state field. It is
  nevertheless aligned with the architectural direction because foreground
  ownership moved out of individual worker tabs and into the service worker.

Validation pending for this slice: syntax checks passed before the version
bump. Run unit tests, production build/package, Chrome reload, then repeat the
fixed eight-profile block/reverse batch and compare foreground contention,
repeatability, and queue-to-done timing against the `1.6.121` baseline.

Live validation result: the first `1.6.122` 8-profile block pass failed before
reverse could start. It finished in about 289s with 2 successes and 6
`interrupted` timeout failures, no child profile tabs left, and owned-tab state
empty. The coordinator page then timed out on `Runtime.evaluate` before reverse
enqueue. The useful diagnosis is that service-worker foreground leasing alone
was not sufficient: hidden content workers could still see profile controls,
record `page-ready`, enter `muting` or `blocking`, and then get killed by stale
action timeouts without owning the foreground lease.

### 2026-05-11, version `1.6.123`

- `1.6.123` closes the `1.6.122` gap by adding a content-side action gate:
  queued mute/block and unblock/unmute workers must acquire the service-worker
  foreground lease before recording `page-ready` or starting profile-menu
  interaction.
- Hidden tabs may still preload to profile readiness, but they should wait at
  the lease boundary rather than entering `muting`, `blocking`, `unmuting`, or
  `unblocking` while backgrounded.

Validation pending for this slice: rebuild/reload and rerun the fixed
eight-profile batch from a cleaned baseline. The pass/fail signal is whether
only the lease owner enters action statuses and whether non-owner tabs remain
pre-action while waiting.

### 2026-05-11, version `1.6.124`

- The first `1.6.123` reverse baseline still failed: 4 succeeded, 4 failed,
  all child tabs eventually closed, and total time was about 213.5s.
- The useful defect was architectural, not timing: some rows performed work or
  failed with `activeAt: 0`, and queued rows showed progress states such as
  `tab-opened`, `page-ready`, or `unblocking`.
- `1.6.124` addresses the ownership leak by making coordinator page readiness,
  manual resume, repair-resume, and retry use the service-worker queue owner
  instead of the coordinator tab as executor owner.
- `1.6.124` also allows same-attempt nonterminal executor progress to advance
  service-worker-authoritative queue rows to active, so live worker milestones
  cannot remain invisible until terminal settlement.

Validation target for this slice: rebuild/reload and rerun the cleaned
eight-profile reverse baseline. A passing result has 8 terminal rows, no
profile tabs or owned tabs left, and no row that reaches terminal with
`activeAt: 0`.

### 2026-05-11, version `1.6.125`

- The first `1.6.124` reverse baseline improved but still had terminal rows
  with `activeAt: 0`: 6 succeeded, 2 failed, elapsed about 287.7s, and all
  child tabs closed.
- Root cause: `fillQueuedTabs()` still exposed `pendingTabActions` before the
  durable active transition had necessarily won the storage race, so a fast
  content script could claim and execute before the coordinator row was active.
- `1.6.125` moves the action claim boundary into the service worker. The
  `claim-tab-action` handler now builds the claim from queued-tab metadata,
  performs or confirms the same-attempt durable active transition, and only
  then returns the work item. If the durable claim is rejected, it closes and
  releases the worker tab instead of letting it act.
- Cleaned reverse validation on the fixed 8-profile set finished with 8
  terminal rows, no profile tabs left, no owned tabs left, and no terminal row
  with `activeAt: 0`. Result: 5 succeeded, 3 failed, elapsed about 288.6s.

Remaining issue: this slice fixes claim accounting, not performance. Reverse
work is still much slower than target and still has interrupted/time-out
failures. Next work should stay on the scheduler/lease architecture rather
than shrinking timeouts.

### 2026-05-11, version `1.6.126`

- Browser restart after `1.6.125` exposed a reporting-state drift: the
  authoritative queue row for `Robert-Bradley-14` was `succeeded`, but
  `mbProfileNukeProgress` had been rewritten to raw `interrupted` with
  `unblockSucceeded: true`.
- The queue was still correct because compatibility mapping treated the record
  as successful. The bug was that terminal progress restoration only checked
  the mapped terminal status, not the raw reporting fields.
- `1.6.126` makes authoritative terminal queue rows repair semantically drifted
  reporting records. Validation after Chrome reload and repair restored
  Robert's reporting record to `unblocked`, `unblockSucceeded: true`, and empty
  `finalError`.

### 2026-05-11, version `1.6.127`

- `1.6.127` makes foreground-lease waiting explicit in queued-tab metadata and
  progress mirrors. Workers waiting behind the foreground lease now record
  `waitingForForegroundAt`, `foregroundWaitReason`, and
  `foregroundWaitLastEventAt`; promotion clears the wait fields and records the
  foreground lease/promoted timestamps.
- Stale active-tab repair now treats foreground-wait as its own 90s lease and
  uses foreground-wait timestamps as stale anchors. This prevents valid
  waiting tabs from being killed by the shorter background-ready timeout.
- Clean reverse-only validation on the fixed 8-profile set still missed the
  repeatability/performance target: 8 terminal rows, 5 succeeded, 3 failed,
  no profile tabs left, no owned tabs left, first non-queued row at about
  14.7s, terminal rows starting at about 83.5s, final elapsed about 294s.
  Klaus improved from the previous failed set, but Nick, Robert, and Warren
  failed with `Queued tab timed out after disappearing before completion`.

Next architectural move: make foreground/action lease ownership durable and
terminally acknowledged. The current service-worker lease stops some false
stale kills, but worker tabs can still disappear before completion and repair
only sees the absence afterward. The scheduler should know which attempt owns
interactive action, whether the tab or service worker requested close, and
whether terminal acknowledgement was durably accepted before the tab is allowed
to vanish.

### 2026-05-12, versions `1.6.128` through `1.6.135`

- `1.6.128` restored repeatability on the fixed reverse-only 8-profile set
  after the earlier foreground-wait/stale-tab work: 8/8 succeeded with no
  profile tabs or owned tabs left, but elapsed time was still about 339s.
- `1.6.129` and `1.6.130` tried stricter foreground gating and were rejected as
  the wrong direction: they serialized too early and stalled work before the
  scheduler model was complete. `1.6.131` returned to the non-bad behavior
  line.
- `1.6.132` introduced durable `actionLease` fields on coordinator queue rows.
  Validation failed 8/8 because the first content contract treated delayed
  lease responses as hard denial and still assumed too much about queue-key
  lookup.
- `1.6.133` made lease lookup key-robust and made action-lease request timeout
  mean "still waiting" instead of terminal denial. That exposed the remaining
  transition problem: the service-worker foreground lease was still a separate
  memory authority.
- `1.6.134` moved content to request durable action ownership before foreground
  promotion, which removed the explicit foreground-denial failure but still
  left too many separate control paths.
- `1.6.135` collapses queued profile-menu work into a single
  `begin-profile-action` service-worker operation: grant durable action lease,
  promote the owning worker as an effect, and release the lease on completion.
  Queued action tabs now open in the background, and releasing foreground no
  longer auto-promotes the next worker. The old foreground-promotion message
  remains only as a compatibility helper for already-gated menu interaction.
- `1.6.136` starts Slice 7 by removing the remaining content-side
  `enqueue-tabs` callers. The space-post `Nuke 'Em` button and modal
  `Nuke 'Em` flow now enqueue durable coordinator jobs through
  `enqueue-coordinator-items`; the service-worker `enqueue-tabs` handler is
  left only as a compatibility/diagnostic surface.
- `1.6.137` completes the source-level Slice 7/8/9 pass. Profile-page
  `Mute Block` and `Mute Block Close` now submit durable coordinator jobs
  instead of running direct content-script actions. Pending space-feed records
  carry explicit job-key links, terminal coordinator settlement updates pending
  records from the service worker, and terminal live-tab closure requires the
  content page to confirm the profile is blocked. The coordinator page is now
  opened only by an explicit `open-coordinator` command; startup, storage
  changes, persistent retry, and `coordinator-page-ready` schedule or query
  service-worker work without creating a coordinator tab.

Packaged load validation for `1.6.137` passed in Chrome with no manifest
errors, runtime errors, or runtime warnings.
- `1.6.138` starts Slice 10 compatibility cleanup. The obsolete
  `enqueue-tabs` runtime message no longer creates executor tabs and now
  returns a deprecated diagnostic response. Scheduler/resume paths no longer
  let terminal `mbProfileNukeProgress` records veto durable queue rows; profile
  progress remains as a bounded compatibility/reporting mirror and as explicit
  repair input, not as the scheduler source of truth. Packaged load validation
  passed in Chrome with no manifest errors, runtime errors, or runtime
  warnings.
- `1.6.139` finishes the remaining Slice 8 settlement cleanup. Current content
  scripts no longer confirm or clear source-page pending/nuked state from
  profile-worker terminal observations; they record job progress and let
  service-worker terminal queue settlement update source records. Terminal
  settlement now treats successful `unblock-unmute` rows as source cleanup
  rather than confirmed nukes, while successful mute/block rows still confirm.
  Executor enqueue skips already-terminal durable rows directly instead of
  consulting legacy progress. Packaged load validation passed in Chrome with
  no manifest errors, runtime errors, or runtime warnings.
- `1.6.140` was rebuilt, copied to the Windows Chrome unpacked extension path,
  and loaded through CDP. Chrome reported version `1.6.140` with no manifest
  errors, runtime errors, or runtime warnings.
- `1.6.141` makes coordinator run sources, event source subtitles, and queue
  profile/source fields clickable safe external links. This addresses the first
  coordinator UI follow-up without changing the durable scheduler model.
  Validation passed: syntax checks, `git diff --check`, `npm test`,
  production build, Chrome/Firefox package builds, Windows Chrome load to
  `1.6.141`, coordinator render smoke with link rows, and zero Chrome manager
  manifest/runtime warning/error entries afterward.
- `1.6.145` changes the content-side foreground/action gate from a fixed
  absolute wait to a progress-based wait keyed by `lastCoordinatorProgressAt`.
- `1.6.146` extends that gate when queued-progress heartbeats are successfully
  delivered, preventing long legitimate action phases from self-expiring.
- `1.6.147` rejects profile-header `Share` and `Add Question` menu buttons when
  finding the profile action overflow menu. The fixed 8-profile reverse pass
  completed 8/8 with no open profile tabs afterward.
- `1.6.148` slows the action-lease polling loop from 500ms to 2500ms after the
  waiters stopped self-failing. The focused block pass improved throughput but
  still left a correctness gap: one disappearing-tab timeout and two durable
  queue rows that looked terminal in compatibility progress but stayed queued
  until manual resume.
- `1.6.149` makes queued-action pruning attempt-aware. Terminal
  `mbProfileNukeProgress` may only cancel in-memory queued work when it matches
  the durable row/action attempt; stale terminal compatibility rows no longer
  veto fresh queued work. Slot release now also schedules a stored-work repair
  tick when the in-memory backlog is empty, so durable pending rows can self
  resume instead of waiting for an explicit `resume-coordinator-queue`.
  Validation passed: syntax checks, `git diff --check`, `npm test`,
  production build, Chrome/Firefox package builds, Windows Chrome update to
  `1.6.149` with zero extension-manager errors/warnings, and fixed 8-profile
  block smoke `manual-16149-block-1778738960675` reached 8/8 succeeded with
  matching queue/progress attempt ids and no fixed-set profile tabs left open.
- `1.6.150` strengthens the slot-release self-resume path. When the in-memory
  queued-action backlog is empty after a slot releases, the service worker now
  immediately nudges stored-work restore in addition to scheduling the delayed
  repair tick. This targets the `1.6.149` reverse smoke gap where
  `manual-16149-reverse-1778769389512` reached 7/8 with no live profile tabs
  and one durable row still queued until an explicit `resume-coordinator-queue`
  finished it.
- `1.6.151` makes the content-side durable profile action gate tolerant of slow
  service-worker replies. When `begin-profile-action` times out locally, the
  worker tab probes its own durable action lease with `heartbeat-action-lease`
  before continuing to wait. Once a lease is confirmed, profile-action
  readiness waits keep sending lease heartbeats and progress events instead of
  failing after the old fixed 15s readiness window. This targets the
  `manual-16150-block-1778770342458` failure where rows had durable leases or
  foreground-promotion progress but still failed as `timed-out-waiting`.
- `1.6.152` makes terminal coordinator cleanup close the recorded worker tab id
  directly, then release queued-tab state. This targets reverse rows that
  reached durable terminal success but left the profile tab open and continued
  blocking the foreground lane.
- `1.6.153` adds a second lost-response recovery path: when
  `begin-profile-action` times out but the same-attempt progress mirror already
  contains a fresh service-worker foreground promotion for the requested action,
  the content worker treats the durable action gate as begun and moves into
  readiness waiting. Clean fixed-set block validation
  `manual-16153-block-1778773557351` completed 8/8 with matching attempts and
  zero fixed-profile tabs left open.
- `1.6.154` raises the durable action-gate wait from 90s to 240s. The fixed
  reverse validation `manual-16153-reverse-1778773916913` still failed at 11
  minutes: Benny hit `timed-out-waiting`, Shannon hit disappeared-tab timeout,
  Nick was active, and Warren was queued with a stale block progress mirror.
  The next target is reset-progress mirror delivery before execution plus
  scheduler-owned foreground serialization for reverse work.
- `1.6.155` writes reset/fresh queued progress mirrors inside the serialized
  durable enqueue update and replaces old progress records instead of merging
  stale foreground/action fields into the new attempt. Fixed block
  `manual-16155-block-1778786145042` and reverse
  `manual-16155-reverse-1778786444114` both completed 8/8 with matching
  queue/progress attempt ids and zero fixed-profile tabs left open.
- `1.6.157` serialized queued-tab filling and capped active reverse workers at
  one when unblock-unmute work is present. Functional block/reverse repeatability
  remained clean, but live validation exposed a UX constraint: target worker
  tabs must not be brought to the foreground.
- `1.6.158` changes queued execution to avoid target-tab foreground promotion:
  service-worker `begin-profile-action` now grants a durable action lease without
  calling `promoteQueuedTab()`, and queued workers carry
  `noForegroundFallback: true`. A bounded no-foreground smoke
  `manual-16158-no-foreground-smoke-1778788368314` kept the active Chrome tab
  unchanged while the reverse worker ran and reached durable success. Remaining
  cleanup: compatibility progress can lag at `unblocking` after durable success
  on that path, so reporting mirror settlement still needs tightening.
- `1.6.159` disables the remaining queued-tab foreground promotion API path
  instead of relying on callers to opt out. Terminal coordinator settlement now
  restores the compatibility progress mirror from the durable queue row, so a
  reverse row that reaches durable `succeeded` is forced back to
  `unblocked`/`already-unblocked` if the legacy mirror is still transient.
- `1.6.160` raises the mute/block active-action stale window to match
  background-only execution. The `1.6.159` clean fixed-set block pass kept target
  tabs inactive but falsely timed out Shannon about 32s after mute started; this
  was the old foreground-era stale threshold, not a real lost tab.
- Current loaded package is `1.6.165`. This slice tightened the live worker path
  after the no-foreground pivot: target page-type checks avoid unnecessary regex
  work, page text extraction is bounded for large Quora documents, profile
  action-row detection no longer recursively scores blocked state, and queued
  action failures retain a bounded `finalErrorStack` for diagnosis.
- Live Obvious Troll validation on Windows Chrome/CDP found no fresh source-page
  rows after scrolling the full loaded page; all six discovered post controls
  were already `Nuked`/disabled. A setup reverse for
  `Bill-Gates-1592` exposed a remaining reverse gap: the background worker
  selected Quora `Unblock` and reached the confirmation modal, but did not click
  the modal `Confirm` without manual CDP cleanup. After cleanup it settled
  `succeeded/unblocked` with no final stack.
- The subsequent mute/block validation was clean. Single-profile rerun
  `manual-live-mute-one-1778812380683` completed `succeeded/blocked` in about
  51s. Small page-candidate batches
  `manual-live-small-batch-1778812452446` and
  `manual-live-small-batch2-1778812491659` completed 3/3 and 4/4 as
  `succeeded/already-blocked`. All rows had `foregroundPromotedAt: 0`, no
  `finalErrorStack`, and no profile tabs left open.
- `1.6.166` fixes the reverse confirmation selector by allowing the unblock
  flow to reuse the unmute confirmation detector. This targets the live
  `Bill-Gates-1592` case where Quora showed a `Cancel`/`Confirm` modal with
  unmute-style text after the worker selected `Unblock`.
- Live validation after reload: `manual-16166-reverse-bill-1778813305915`
  reached `Reverse action confirmed unblock` without manual cleanup and settled
  `succeeded/unblocked` in 59s; `manual-16166-reblock-bill-1778813378914`
  then restored the profile to `succeeded/blocked` in 50s. Both runs kept
  `foregroundPromotedAt: 0`, had no `finalErrorStack`, and left no profile tabs
  open.
- `1.6.167` fixes the coordinator-close/pause split exposed by live queue
  testing. Stored-work restore now opens the coordinator page in the background
  before resuming service-worker-owned execution, and `pause-coordinator-nukes`
  cancels durable queued/active rows, records terminal paused progress, and
  closes owned worker tabs. The live stuck queues were manually terminalized:
  Obvious Troll settled 16/16 paused/terminal rows and Let's Play settled 9/9,
  with no profile worker tabs left open.
- `1.6.168` removes blocking `alert(...)` calls from `content.js`. The
  "Nothing was queued" case now reports as a temporary button label, and
  profile action issues are logged without opening a modal browser dialog.
- `1.6.169` fixes idle retry scheduling. Live inspection found
  `mbCoordinatorRetryFailedEnabled` set to true with 111 retryable failed rows
  but no retry events; the service-worker timeout loop was not guaranteed to
  restart when the worker woke after the flag was already enabled. The fix adds
  the extension `alarms` permission, creates a persistent retry alarm when the
  flag is enabled, restores retry on service-worker cold start and coordinator
  page ready, and keeps the existing immediate timeout tick for fast retries
  while the worker is alive.
- `1.6.170` fixes the first live retry blocker after `1.6.169`: old failed
  queue rows can lack a compatibility progress mirror, and terminal-progress
  repair was dereferencing that missing record before retry selection. Terminal
  mirror restoration now treats the previous progress record as optional.
- `1.6.172` makes coordinator Runs, Events, and Queue rows use human-readable
  profile/source labels. Single-target failed-retry runs display the attempted
  profile instead of the synthetic `retry-failed-*` run id, retry events carry
  target profile metadata for new rows, and Queue rows show compact profile
  labels while keeping profile/source links available. Old queue rows with
  missing action metadata fall back to `Mute Block`.
- `1.6.173` clarifies the coordinator retry control. The button is now the
  `Idle Retry` toggle, while the on/off state and disabled reason render under
  it on the right side of the Queue header.
- `1.6.174` makes `Idle Retry` a true preference toggle. The button remains
  enabled when the queue is busy or when there are no retryable failures; those
  conditions now appear only in the state line so the retry loop can be turned
  on ahead of the next idle opportunity.
- `1.6.175` prevents already-terminal queued actions from opening worker tabs.
  The scheduler now rereads the authoritative coordinator row immediately before
  `tabs.create`; if the row is already terminal, action-kind changed, or attempt
  id is stale, the in-memory action is dropped and terminal settlement runs
  without navigating to the profile.
- `1.6.176` fixes active-count reporting for the durable job state model.
  Coordinator and service-worker run summaries now count `opening`, `active`,
  `acting`, and `settling` as active work, and queue-idle checks treat the same
  states as pending.
- `1.6.177` handles three coordinator UI follow-ups: Preferences can open the
  dashboard page, the dashboard page can open Preferences, Runs, Events, and
  Current Work panels can collapse and expand, and section/status/outcome labels
  now expose hover help. The corresponding Follow-Up To-Do bullets are marked done.
- `1.6.178` renames the user-facing Coordinator surface to Dashboard while
  keeping the internal coordinator storage and command names stable. The
  dashboard details area now grows to the viewport and divides the remaining
  height across Runs, Events, and Current Work instead of capping the lists at
  fixed pixel heights. The Preferences `Dashboard` button uses the existing
  dashboard tab when present and focuses it; if none exists, it creates one in
  the foreground.
- `1.6.179` fixes collapsed Dashboard panels retaining their flex allotment.
  Collapsed Runs, Events, or Current Work sections now shrink to the header row
  and give the space back to the remaining expanded sections.
- `1.6.180` shortens extension page tab titles: the dashboard tab is now
  `Dashboard`, and the preferences tab is now `Preferences`.
- `1.6.181` makes Preferences responsive to the browser-tab context. Wide
  windows render as a page with a centered settings area, full header, multi-column
  setting cards, and right-aligned actions; narrow extension-popup windows keep
  the compact popup layout.
- `1.6.182` aligns the operator vocabulary around `Current Work` and `Recent
  History`. The dashboard summary now reports `Ready to Run` for jobs still in
  the queued state, Preferences labels the persisted nuke table as Recent
  History, and the service worker prunes settled non-actionable Current Work
  after 24 hours while retaining pending, active, retryable, and unsettled rows.
- `1.6.183` makes Current Work ordering match the operational model. Opening,
  active, acting, and settling rows sort above ready-to-run, eligible retry
  failures, failed, and terminal rows, and active-like status badges use a cyan
  treatment so they stand apart from ready-to-run and terminal states. The Idle
  Retry header now counts only failures still under the retry limit as eligible,
  so exhausted failures no longer look like runnable retry work.
- `1.6.184` adds a `Requeue Failed` Current Work action. It resets failed rows
  to queued state, clears terminal outcome/error/retry metadata, records a
  requeue run/event, mints fresh attempt ids so stale progress mirrors cannot
  re-fail the rows, and starts the existing service-worker executor path.
- `1.6.185` moves asset-space post/question author resolution into queued work.
  Space entries with no direct profile candidate can now enqueue a resolver row
  keyed by the post URL; the worker opens the post/question in the background,
  resolves the author/original-poster profile, migrates the durable Current
  Work row to that profile, and then continues the normal mute/block path.
  Existing fake profile rows that land on a question page also take this
  resolver path instead of failing as `not a profile page`.
- `1.6.186` adds a per-row `Requeue` command for failed Current Work entries.
  The service-worker requeue command now accepts a specific profile/storage key
  as well as the previous bulk mode. Dashboard command buttons are rounded, and
  status indicators such as complete, enqueued, retry, and failed are rectangular.
- Source-page click validation remains separate: while the Obvious Troll source
  document reported `visibility: hidden`, both CDP mouse click and DOM click on
  an enabled `Mute-Block` source button failed to enqueue any durable run. Direct
  durable queue submission and worker execution are clean; visible source-tab
  click behavior still needs a foreground/source-window validation pass.

Next architectural move: resume manual behavior testing from the durable queue
model, with fresh reverse validation before depending on unblock/unmute setup
for larger repeatability loops. Keep browser-performance debugging out of scope
unless the loaded extension crashes or the service worker fails to start.

## Follow-Up To-Do

- Done in `1.6.49`: the green profile-page `Unblock Unmute` action now queues
  a reverse coordinator job instead of acting directly on the foreground page.
  The coordinator owns the worker tab, reverse progress, terminal state, and
  same-profile old-run cleanup.
- Done in `1.6.141`: make spaces and profiles shown on the coordinator page
  clickable links that open the corresponding Quora tabs.
- Done in `1.6.172`: make failed-retry coordinator rows human-readable by
  showing attempted profile labels instead of synthetic retry run ids.
- Done in `1.6.177`: add an open-dashboard command to preferences, and an
  `Open Preferences` command to the dashboard page.
- Done in `1.6.177`: add collapse/expand arrows on the coordinator page for
  runs, events, and Current Work sections.
- Done in `1.6.177`: add hover help on coordinator titles explaining each
  status, outcome, and section meaning.
- Done in `1.6.178`: rename visible Coordinator labels to Dashboard and remove
  the standalone to-do item.
- If manual Quora unblock/unmute remains common after `Unblock Unmute` exists,
  review whether profile controls should also refresh without a manual reload.
  Current behavior is that reload reconciles persistent state and restores
  `Mute Block` buttons.
- Treat space-page `Nuked` rows that survive a manual unblock/reload as possible
  pre-1.6 state baggage from the 1.5-era storage model unless they reproduce
  from a fresh 1.6-only sequence. Before fixing, retest from a clean same-version
  flow and decide the multi-profile post rule.
- Repeatability checkpoint in `1.6.72`: the 8-profile batch test completed
  block 8/8 and queued unblock/unmute with no failed rows and no child profile
  tabs left. The remaining problem is performance: foreground-safe menu
  interaction is reliable but causes tab-promotion contention and multi-minute
  batch times.
- Attempt-id checkpoint in `1.6.75`: the 8-profile batch test completed block
  8/8 and reverse unblock/unmute 8/8 with no failed rows, no child profile
  tabs left, no new stale-attempt diagnostics, and matching item/progress
  attempt ids. Intermediate `1.6.73`/`1.6.74` test failures exposed two useful
  architecture bugs: reverse rows inherited prior block attempt ids unless reset,
  and queued reverse workers could still trigger the manual live-unblocked state
  clearing path.
- Transition-helper checkpoint in `1.6.76`: service-worker coordinator storage
  helpers now cover progress sync, repair, normal enqueue, and retry-failed
  setup. The 8-profile stability loop passed: block 8/8 in 108s and reverse
  8/8 in 193s, with no new stale-attempt diagnostics, no leftover profile tabs,
  and matching item/progress attempt ids.
- Durable-scheduler checkpoint in `1.6.81`: service-worker-owned execution no
  longer requires an open coordinator page. The scheduler repairs stored active
  work on a bounded timer, active rows can be reconciled from durable item state
  when progress mirrors are missing, and reverse ok/unmute flags are treated as
  terminal success even if a late compatibility progress patch leaves the text
  status at `unblocking`. Validation on the 8-profile batch: reverse timed out
  under `1.6.80`, then repaired to 8/8 after loading `1.6.81`; a fresh block
  pass completed 8/8 in 242s with coordinator count 0, stale-attempt delta 0,
  no attempt mismatches, no open profile tabs, and empty owned-tab state.
- Worker-milestone checkpoint through `1.6.88`: worker progress now uses
  explicit `record-job-milestone`/`record-job-terminal` and `release-job-tab`
  messages, service-worker progress-to-queue sync is serialized, queued action
  terminal reuse is action-kind aware, reverse-job live-unblocked cleanup no
  longer deletes active reverse queue rows, duplicate queued actions use the
  real tab action key, and terminal slot release now asks the service worker to
  close the owned tab. The 8-profile reverse validation improved from vanishing
  queue rows and stale-attempt storms to stable current-run rows with zero stale
  attempts under `1.6.87`, but still timed out with one `unmuting` row and
  terminal tabs left open. Slice 6 is not complete.
- Worker-milestone checkpoint through `1.6.92`: terminal slot release now closes
  service-worker-owned reverse tabs reliably, and the reverse clear-state path
  preserves coordinator queue/run rows while still clearing pending/remembered
  nuked profile state. Validation: syntax checks, `npm test`, production build,
  Chrome/Firefox package builds, a 2-profile live reverse smoke in 30s with
  owned tabs cleared, and an 8-profile live reverse run in 136s with terminal
  rows 8/8, no open profile tabs, and empty owned-tab state. Remaining issue:
  during the 8-profile batch the coordinator rows stayed visually `queued` until
  late progress sync caught up near the end, so Slice 6 still needs live
  milestone visibility/error-path validation before it is complete.
- Worker-milestone checkpoint through `1.6.93`: service-worker progress sync now
  coalesces pending progress by profile so high-volume worker milestones do not
  force one full coordinator storage sync per event. Validation: syntax checks,
  `npm test`, production build, Chrome/Firefox package builds, and a live
  8-profile reverse run. The run showed rows moving from `queued` to
  `active`/`succeeded` during execution instead of staying all queued until the
  end, then completed with terminal rows 8/8, no open profile tabs, and empty
  owned-tab state. Result quality was 5 succeeded and 3 failed; the failed rows
  were real action-path stalls around foreground/profile-menu interaction, not
  lost coordinator bookkeeping. Next Slice 6 work should target reverse worker
  action reliability and foreground dependency.
- Worker-milestone checkpoint through `1.6.94`: foreground promotion message
  waits now use an explicit 8s bound instead of the previous 2.5s tactical
  bound, and `timeout-inventory-1.6.md` records the reason. Validation: syntax
  checks, `npm test`, production build, Chrome/Firefox package builds, and the
  live 8-profile reverse batch completed 8/8 succeeded in about 175s with no
  open profile tabs and empty owned-tab state. This restored repeatability after
  the `1.6.93` foreground/menu stalls, but did not fix early row visibility:
  progress records advanced promptly while queue rows stayed `queued` until
  late in the run. Next work should make milestone-to-row sync immediate or
  scheduler-native, then replace the tactical foreground promotion waits with a
  real foreground lease.
- Worker-milestone checkpoint through `1.6.100`: `1.6.95` proved that simply
  lengthening active job progress message waits did not fix row visibility, so
  that timeout experiment was backed out. `1.6.96` narrowed storage-change
  progress sync to changed profile records, but live validation showed queue
  rows still stayed `queued`. `1.6.97` moved live worker progress through direct
  coordinator sync and narrowed startup sync to stored queue rows; that was
  still insufficient because the scheduler path could overwrite rows. `1.6.98`
  made the scheduler mark a coordinator item `active` when it claims/opens the
  executor tab. `1.6.99` made terminal slot release sync terminal progress back
  to the row. `1.6.100` prevents delayed queued progress from regressing an
  active or terminal row back to `queued`. Validation: syntax checks, `npm
  test`, production build, Chrome/Firefox package builds, Chrome reload to
  `1.6.99`, and the live 8-profile reverse batch completed 8/8 succeeded in
  about 171s with first non-queued row at 16.9s, terminal rows 8/8, no open
  profile tabs, empty owned-tab state, and a complete run row. The remaining
  Slice 6 risk is no longer row bookkeeping; it is the roughly 170s
  queue-to-done action/tab latency.
- Worker-milestone repair checkpoint through `1.6.102`: the live Fredrick case
  showed that a row could remain `queued` while the progress mirror said the
  worker had already claimed/actioned it, such as `unblocking`, with no child
  tab left. `1.6.101` made progress changes schedule stored-work repair and
  let the repair path reconcile those claimed-progress queued rows. A controlled
  Chrome smoke then exposed a current repair bug: active-row repair accepted a
  missing progress record but read `record.status` unguarded. `1.6.102` fixes
  that. Validation: syntax checks, `npm test`, production build, Chrome/Firefox
  package builds, Windows Chrome reload to `1.6.102`, zero extension manager
  runtime/warning/manifest errors, and a synthetic stranded-row smoke where
  `queued` + `unblocking` + no live tab repaired to `failed/timeout`,
  progress became `interrupted`, pending count returned to zero, and no profile
  tab was opened.
- Worker-milestone failed rerun through `1.6.103`: the requested 8-profile
  repeatability/performance loop did not reach a meaningful timing result.
  The first `1.6.102` rerun mixed old and new run ids plus terminal queue rows
  with transient progress, so `1.6.103` made reset enqueue rows carry an attempt
  id immediately and made service-worker reset cancel all queued owner actions,
  not only `nuke` actions. Validation after loading `1.6.103` still failed:
  a fresh block run enqueued 8 new rows and opened owned profile tabs, but rows
  remained `queued/tab-opening`, coordinator/runtime evaluation began timing
  out, and the run was stopped before reverse. Browser cleanup after reload left
  no target profile tabs and no extension-manager errors. Next work should
  inspect why `transitionCoordinatorItemForQueuedTab` or the equivalent
  scheduler claim is not durably moving rows from `queued` to `active`, and why
  runtime messaging becomes nonresponsive while those opened tabs are waiting.

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

- Done in `1.6.137`: convert profile `Mute Block` and `Mute Block Close` clicks into
  `queue-jobs` requests where appropriate.
- Done in `1.6.136`: convert modal `Nuke 'Em` from direct `enqueue-tabs` to durable jobs.
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

- Done in `1.6.137`: link `mbSpacePendingNukedPosts` entries to job keys.
- Done by `1.6.137`: on terminal success/skip/failure, update pending post records through the
  service worker.
- Done in `1.6.137`: when settlement is invoked for explicit profile hrefs, let terminal
  coordinator state close any matching live profile tab only after the content
  page confirms it is blocked.
- Done by `1.6.139`: bound background-to-content tab messages so a stale or transitioning profile
  tab cannot wedge terminal settlement.
- Done in `1.6.139`: keep content-page UI refresh local, but stop making it the settlement owner.

Validation:

- Live space-feed run with multiple posts pointing to the same profile.
- Reload source page mid-run; terminal worker results still settle the source
  records.

Exit criteria:

- Source page absence no longer blocks pending-post cleanup.

## Slice 9: Coordinator as UI Only

Goal: remove any remaining execution dependency on the coordinator tab.

Tasks:

- Done in `1.6.137`: make `coordinator-ready` query/repair/display only.
- Done in `1.6.137`: ensure startup/storage-change scheduling does not open the coordinator except
  for deliberate operator visibility.
- Done by `1.6.137`: keep coordinator controls as commands to the service worker.

Validation:

- Start a run, close coordinator, verify work continues or resumes from storage.
- Close source page, leave coordinator open, verify work continues.
- Reload extension with no coordinator open, verify queued work resumes.

Exit criteria:

- Coordinator page can be destroyed without losing or blocking execution.

## Slice 10: Compatibility Cleanup

Goal: remove obsolete duplicate state paths after live behavior is stable.

Tasks:

- Done in `1.6.138`: stop reading `mbProfileNukeProgress` as scheduler queue
  truth.
- Done by `1.6.138`: keep bounded profile progress only as a
  compatibility/reporting mirror and explicit repair input.
- Done in `1.6.138`: remove direct `enqueue-tabs` durable execution path and
  mark it diagnostic.
- Left intentionally bounded in `1.6.138`: stale-active tab watchdogs still
  close or interrupt stuck executor tabs, but they no longer form a separate
  enqueue model.
- Done in `1.6.138`: update docs with final storage/model expectations.

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
