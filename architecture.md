# Mute Block Architecture

Date: 2026-10-25. Verified against HEAD `0209f52` (package version 1.6.1630). `shared/js` has no working-tree changes. This note replaces the 24 Oct state map. The previous text is in git history (`git show HEAD:architecture.md`).

Review of current gaps: [codex-mb-review-1.md](codex-mb-review-1.md). Its items 1-5 are tracked there. Its headings repeat number 4, so the file holds six findings. Items marked "(review N)" below point to it. Planning and status: [planning.md](planning.md) and [docs/notes-register.md](docs/notes-register.md). The iPhone plan is separate: [mute-block-ios-safari-plan.md](mute-block-ios-safari-plan.md).

How to read the references: function names are the anchors. Line numbers are given where they are stable enough to help, and they are as of HEAD `0209f52`. They drift with edits, so search by name if a line is off.

## Overview

**What it is.** Mute Block is a WebExtension for Quora (Chrome Manifest V3 and Firefox). It mutes and blocks profiles in bulk, collects profile lists, acts on space feeds, and shows a dashboard and history. This note covers the desktop Chrome and Firefox lane only.

**Layers.**

- Content script (`shared/js/content.js`, on quora.com): reads pages, performs Quora actions, and reports claims and results. It acts on queued work only after the worker grants an attempt.
- Service worker (`shared/js/sw.js`): the authority for queued work. It owns scheduling, storage writes and browser effects.
- Dashboard, history and preferences (`coordinator.js`, `preferences.js`): display and control. They ask the worker by message and own no queue state.
- Worker-action window: a separate coordinator window for queued actions that need foreground visibility. It is not the dashboard.

**What is authoritative.**

- Queue rows, held in a write-ahead log (WAL) with checkpoints, are the only durable queue state. The worker is the only writer.
- Tabs, page claims, runtime maps and dashboard data are observations or caches.
- Progress, the content queue index and the flight recorder are derived or session-only. Remembered post maps and pending space-feed records are durable but are not queue authority.

**Main flows.**

- Queued work: rows are enqueued in the WAL. The worker grants an attempt for a row. The content script acts in the tab and reports milestones and a terminal result, tagged with the attempt id and number. The worker accepts or rejects each report through the job reducer (`reduceJobEvent`), and finished rows move to the completed area.
- Progress: queued attempts report through the job protocol, so progress follows the worker's decision. Manual actions on a profile page use a separate, session-only path. This is the one accepted exception.
- Space feed: candidates are held as pending records. A profile moves to the remembered nuked map only when archive confirms it.
- Persistence: the WAL is checkpointed into two slots (A and B), with rows partitioned by arrival-order shards. Completed rows are pruned by whole shard at checkpoint. Runs are capped at 700 by whole shard.
- Clear: Clear Current Work removes queue and completed rows through the WAL. It does not yet remove pending space-feed records.

**Current direction.**

- Built and on: the WAL and checkpoint model, arrival-order checkpoint shards, the `v1.6.` storage namespace.
- Scheduled removal: the old runs bucket layout, which the WAL has replaced.
- Planned, not built: time-sharded runs; Clear removing pending space-feed records. A single observation contract for manual progress is possible later and is not scheduled.
- Open risks: the landing check reads the URL only; progress has many in-memory writers; session storage is not measured live; the worker-window focus behaviour is unresolved.
- Owner to confirm: whether the raw queue key is only guarded or also removed. The code does both (section 2).

## 1. Layers and rules

### 1.1 Layer map

| Layer | Where | Role |
|---|---|---|
| Content script | `shared/js/content.js` on `*.quora.com` | Reads the page, renders controls, performs Quora actions. Reports claims, milestones and terminal results with attempt identity. |
| Service worker | `shared/js/sw.js`, bootstrapped by `shared/js/swBootstrap.js` | Authority for queued work. Owns scheduling, storage writes and browser effects. |
| Message normalization | `shared/js/swmessages.js` | Normalizes runtime action names before dispatch. |
| Dashboard, history, preferences | `shared/js/coordinator.js`, `shared/coordinator.html`, `shared/js/preferences.js` | Display and control. Changes are sent to the worker by message. |
| Worker-action window | `coordinator.html` in worker mode (title "Mute Block Worker") | Created by `getOrCreateQueuedWorkerActionSurface` (`sw.js`). |

### 1.2 Module map for the queue

| Concern | Modules |
|---|---|
| Job status, retry and terminal decision | `shared/js/jobState.js` (`reduceJobEvent`); `shared/js/swQueueMachineEvents.js` (event type names), `swQueueMachineDispatcher.js`, `swQueueMachineHandlers.js` |
| Progress reduction | `shared/js/swCoordinatorProgressReducer.js` |
| WAL records and shapes | `shared/js/swCoordinatorQueueWal.js`, `shared/js/swQueueWalStore.js`, `shared/js/swQueueWalRecovery.js`, `shared/js/swQueueWalDurableReads.js`, `shared/js/swQueueWalRowShard.js` |
| Generic WAL and checkpoint engine | `shared/js/walSnapshotStore.js`, `shared/js/swstorage.js` |
| Runs | `shared/js/swRunsWal.js`, `shared/js/swRunShards.js` |
| Completed rows | `shared/js/swCompletedShards.js`, `shared/js/swCoordinatorTerminalSettlement.js` |
| Scheduler, executor, runtime, Quora tabs | `shared/js/swscheduler.js`, `shared/js/swexecutor.js`, `shared/js/swqueueRuntime.js`, `shared/js/swquoraTabs.js` |
| Storage names and namespace | `shared/js/storageKeys.js`, `shared/js/storageNamespace.js` |

### 1.3 Rules

- Claims and milestones carry attempt identity (attempt id and number). Row id alone is not enough for delayed reports. The worker checks this in `validateProgressAttempt` (`sw.js`, about line 33345) and `validateQueuedTabAttempt` (`sw.js`, about line 33362).
- Row status, retry and terminal outcome go through `reduceJobEvent` (`jobState.js`) and the `swQueueMachine*` modules. Known places outside it are listed in section 6.
- Profile identity is exact: the slug as written, NFC, case-sensitive, with no suffix cut and no trimming. See `sanitizeProfileHrefSlug` and `normalizeQuoraProfileHref` in `shared/js/subject.js`, and `getNormalizedProfileIdentityKey` in `content.js`. The old suffix rule is computed only for a shadow counter.
- Hydrate, recovery and startup prove state is current. They do not trust a cached copy (`hydrate` and `loadResidentState` in `createCoordinatorAuthority`, `sw.js`).
- Runtime maps (queued actions, metadata, active tabs) are caches. They do not decide queue status.
- Build and process rules (version bump before any build, no Puppeteer, command shapes) are in `AGENTS.md`.

### 1.4 Runtime message groups

The worker's runtime message dispatch is in `shared/js/swBootstrap.js`. The actions named below are the ones this note refers to.

- Queue intake: `enqueue-coordinator-items`, `open-coordinator`, `pause-coordinator-nukes`, `resume-coordinator-queue`, `retry-coordinator-failed`.
- Tab and attempt: `claim-tab-action`, `promote-queued-tab`, `begin-profile-action`, `record-job-milestone`, `record-job-terminal`, `release-job-tab`, `close-tab`.
- Manual and profile state: `record-direct-profile-progress`, `record-manual-profile-action`, `clear-profile-nuke-state`, `get-recent-history`.
- Space feed: `set-space-nuked-posts`, `merge-space-pending-nuked-posts`, `remove-pending-space-feed-urls`, `remove-pending-space-feed-entries`, `confirm-space-feed-profiles-blocked`.
- Clear and erase: `clear-coordinator-current-work`, `cancel-coordinator-current-work`, `clear-coordinator-events`, `clear-coordinator-terminal-stats`, `erase-block-history`.

Actions in the authority set wait for the queue authority to load before they run (`RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY`, `swBootstrap.js`). An action missing from that set runs ungated.

Build and process rules are in `AGENTS.md`.

## 2. State map

### 2.1 Authoritative (durable)

| Store | Where | Owner | Notes |
|---|---|---|---|
| Queue rows, active and queued | Queue WAL, key `mbCoordinatorQueueWal` (`storageKeys.js`). Segment records plus two checkpoint slots. | `sw.js` (write door and hydrate); `swCoordinatorQueueWal.js` and `swQueueWalStore.js` (shapes and store) | Worker is the only writer. Hydrated into worker memory by `loadResidentState` (checkpoint plus WAL tail). Reads come from that resident state. |
| Terminal (completed) rows | The `completed` area of the same WAL | `sw.js` `archiveTerminalCoordinatorRow`; `swCompletedShards.js` (shards) | Durable record of finished work. Used for display and profile-level dedupe. It does not drive scheduling. |
| Runs | WAL records in area `runs` | `swRunsWal.js` (records); `swRunShards.js` (run shards); `sw.js` `takeRunsPartFromChange` | Run status and counts are recomputed from queue rows. The session mirror holds the whole run list. |

### 2.2 Derived or non-authoritative (durable on disk)

| Store | Stored name | Owner | Notes |
|---|---|---|---|
| Space nuked post map | `mbSpaceNukedPosts` (`SPACE_NUKED_POSTS_KEY`) | `spaceMapStorage.js` (bucket layout); `nukedPosts.js` (retention names); `sw.js` `setSpaceNukedPostsRequested` | Remembered post state. 32 hash buckets each, marker `mbSpaceMapLayoutVersion` = 2. Writes send only changed buckets. |
| Pending space-feed records | `mbSpacePendingNukedPosts` (`SPACE_PENDING_NUKED_POSTS_KEY`) | `sw.js` and `swCoordinatorTerminalSettlement.js` | Candidates waiting for archive confirmation. Same bucket layout as the nuked map. See section 3.4. |
| Space registry and sort | `mbSpaceRegistry`, `mbSpaceSortBy` | `spaceRegistry.js`; `sw.js` | Space list and sort preference. |
| Outlier list | `mbCoordinatorOutliers` (`COORDINATOR_OUTLIERS_KEY`) | `sw.js`, written through `persistCoordinator`; session mirror (`QUEUE_NAMESPACE_MIRROR_KEYS`) | Setting-like state. |
| Preferences | Defined in `defaults.js` | `preferences.js`; `sw.js` loads the values | Includes recent-history retention (`nukedPostRetentionDays`, 90) and row cap (`maxRememberedNukedPosts`, 10,000). |
| Pause and retry settings | `mbCoordinatorPaused`, `mbCoordinatorRetryFailedEnabled`, `mbCoordinatorPauseGeneration` | `swprefs.js`; `sw.js` | Read by the queue (not traced in this pass). |
| Storage build marker | `mbStorageBuild` (`STORAGE_BUILD_KEY`) | `sw.js` `checkStorageBuild` | Records the installed build. |

### 2.3 Session-only (lost on browser restart)

| Store | Stored name or place | Owner | Notes |
|---|---|---|---|
| Profile progress | `mbProfileNukeProgressShard.<n>` (`PROFILE_NUKE_PROGRESS_SHARD_PREFIX`), 256 shards | `swProfileNukeProgress.js`; `sw.js` `saveProfileNukeProgressRowProjection` | Derived view, not authority. Written through `persistCoordinator` progress deltas. |
| Live-tab set for progress pushes | Worker memory | `sw.js` (structure not checked) | Lost on worker restart. |
| Content queue index | `mbCoordinatorContentQueueIndex` and shard prefixes, in memory | `swCoordinatorContentQueueIndex.js` | Built from the live queue on the first lookup after a change. Legacy disk copies are removed at startup. |
| Flight recorder | Memory ring of 20,000 entries (`FLIGHT_RECORDER_CAPACITY`, `tunables.js`); session copy `mbFlightRecorderSnapshot` | `swflightRecorder.js` | Diagnostic only. The newest 2,000 entries go to session storage, at most every 10 s. Not replay input, not authority. |
| Erase generation | Session storage key `mbEraseBlockHistoryGeneration` | `sw.js` | Lets an open content script say which erase it has finished. |

### 2.4 Retired

- Raw `mbCoordinatorQueue`: writes are blocked after a queue mutation (`metricStorageSet` guard, `sw.js`, about line 2808). Retirement also removes it at install and startup (`retireUnusedVersion15StorageKeys`, `sw.js`, about line 37001; called from `swBootstrap.js`). The owner's note said "guarded, not removed"; the code does both. Owner to confirm.
- `mbCoordinatorQueueView`: not written to disk since 2026-10-01. The file comment at `retireLegacyQueueViewStorageKey` (`sw.js`, about line 37029) says a pre-WAL copy can resurrect rows, so the key is removed once at startup.
- `mbProfileNukeProgress`: in the startup removal list with `mbCoordinatorQueue` (`VERSION_15_RETIRED_STORAGE_KEYS`).

### 2.5 Key declarations

`shared/js/storageKeys.js` declares every stored key name once. `test/p1-contract.test.js` (per the header comment in `storageKeys.js`) fails if another module assigns one. Changing a key name orphans its data, so a change needs a migration. The table lists each key constant, its stored name, and the modules that reference it (found by searching `shared/js`; "sw.js only" means no other module names the constant).

| Constant | Stored name | Modules that reference it |
|---|---|---|
| `COORDINATOR_QUEUE_WAL_KEY` | `mbCoordinatorQueueWal` | sw.js, swCoordinatorQueueWal.js, swQueueWalStore.js, swProfileNukeProgress.js, swCoordinatorSourceProvenance.js, swStorageMetrics.js |
| `COORDINATOR_QUEUE_KEY` (retired) | `mbCoordinatorQueue` | sw.js, swProfileNukeProgress.js, swStorageMetrics.js |
| `COORDINATOR_QUEUE_VIEW_KEY` (retired) | `mbCoordinatorQueueView` | many; removed at startup |
| `COORDINATOR_RUNS_KEY` | `mbCoordinatorRuns` | coordinator.js, sw.js, swdashboard.js, swStorageMetrics.js |
| `COORDINATOR_RUNS_LAYOUT_KEY` (legacy) | `mbCoordinatorRunsLayoutVersion` | sw.js only |
| `COORDINATOR_EVENTS_KEY` | `mbCoordinatorEvents` | sw.js, swdashboard.js, swStorageMetrics.js |
| `COORDINATOR_OUTLIERS_KEY` | `mbCoordinatorOutliers` | sw.js only |
| `COORDINATOR_LAST_ENQUEUE_SUMMARY_KEY` | `mbCoordinatorLastEnqueueSummary` | content.js, coordinator.js, sw.js, swdashboard.js |
| `COORDINATOR_WORK_SESSION_KEY` | `mbCoordinatorWorkSession` | coordinator.js, sw.js |
| `COORDINATOR_PAUSED_KEY` | `mbCoordinatorPaused` | many (queue gate and readers) |
| `COORDINATOR_PAUSE_GENERATION_KEY` | `mbCoordinatorPauseGeneration` | sw.js, swprefs.js, swStorageMetrics.js |
| `COORDINATOR_RETRY_FAILED_ENABLED_KEY` | `mbCoordinatorRetryFailedEnabled` | coordinator.js, sw.js, swBootstrap.js, swprefs.js |
| `HIDDEN_RUNS_KEY` | `mbCoordinatorHiddenRunIds` | coordinator.js, sw.js |
| `COORDINATOR_STATS_CLEARED_AT_KEY` | `mbCoordinatorStatsClearedAt` | coordinator.js, sw.js, swCoordinatorQueueView.js |
| `COORDINATOR_TAB_KEY` | `mbCoordinatorTabId` | sw.js, swStorageMetrics.js |
| `OWNED_TAB_STATE_KEY` | `mbOwnedTabIdsByParent` | sw.js, swStorageMetrics.js |
| `COORDINATOR_CONTENT_QUEUE_INDEX_KEY` (and shard prefix) | `mbCoordinatorContentQueueIndex`, `mbCoordinatorContentQueueIndexShard.` | sw.js, swCoordinatorContentQueueIndex.js, swContentPageStateProjection.js |
| `COORDINATOR_CONTENT_SOURCE_INDEX_PREFIX` | `mbCoordinatorContentSourceIndex.` | sw.js, swCoordinatorContentQueueIndex.js |
| `COORDINATOR_NAMESPACE_SEQ_KEY_PREFIX` | `mbCoordinatorNamespaceSeq.` | sw.js, swStorageMetrics.js |
| `PROFILE_NUKE_PROGRESS_VIEW_KEY` | `mbProfileNukeProgressView` | Declared in storageKeys.js; referencing modules not searched (section 8) |
| `PROFILE_NUKE_PROGRESS_SHARD_PREFIX` | `mbProfileNukeProgressShard.` | sw.js, swProfileNukeProgress.js, swStorageMetrics.js |
| `SPACE_NUKED_POSTS_KEY` | `mbSpaceNukedPosts` | content.js, coordinator.js, nukedPosts.js, preferences.js, sw.js, swCoordinatorTerminalSettlement.js, swStorageMetrics.js |
| `SPACE_PENDING_NUKED_POSTS_KEY` | `mbSpacePendingNukedPosts` | content.js, sw.js, swCoordinatorTerminalSettlement.js, swStorageMetrics.js |
| `SPACE_MAP_LAYOUT_KEY` | `mbSpaceMapLayoutVersion` | spaceMapStorage.js, sw.js |
| `SPACE_REGISTRY_KEY` | `mbSpaceRegistry` | content.js, coordinator.js, preferences.js, spaceRegistry.js, sw.js |
| `SPACE_SORT_KEY` | `mbSpaceSortBy` | preferences.js, spaceRegistry.js, sw.js |
| `STORAGE_BUILD_KEY` | `mbStorageBuild` | sw.js only |
| `FLIGHT_RECORDER_SESSION_KEY` | `mbFlightRecorderSnapshot` | sw.js only |
| `QUEUE_WAKEUP_METRICS_KEY` | `mbQueueWakeupMetrics` | sw.js, swStorageMetrics.js |
| `QUEUED_ACTION_SURFACE_STATE_KEY` | `mbQueuedActionSurfaceState` | sw.js only |
| `ERASE_BLOCK_HISTORY_PENDING_KEY` | `mbEraseBlockHistoryPending` | sw.js only |
| `COORDINATOR_QUEUE_WAL_SEQ_SESSION_KEY` | `mbCoordinatorQueueWalSeq` | sw.js only |
| `LEGACY_CONTENT_INDEX_CLEANUP_MARKER_KEY` | `mbLegacyContentIndexCleanupV1` | sw.js only |
| `PAUSE_DIAGNOSTIC_SNAPSHOT_KEY` | `mbPauseDiagnosticSnapshot` | sw.js only |
| `STORAGE_LAYOUT_PREFIX` | `v1.6.` (prefix of every stored name) | storageKeys.js, storageNamespace.js |

## 3. Write paths

### 3.1 Queue (WAL)

**Door.** Every ordinary queue or stored change goes through `coordinatorAuthority.persistCoordinator`, defined in `createCoordinatorAuthority` (`sw.js`, from about line 9846). Its steps:

1. `persistCoordinator` runs on the serialized apply tail (`runExclusiveOnApplyTail`, `sw.js`, about line 10970). No two commits interleave.
2. If the change carries the runs key, `takeRunsPartFromChange` (about line 10227) turns the runs value into run records and removes it from the stored payload. The run cap is applied in the same write.
3. The queue part goes to `persistCoordinatorQueueChange` (about line 10263), which calls `persistCoordinatorAuthorityQueueWalMutation` (about line 8288) for one change or `persistCoordinatorAuthorityQueueWalBatchMutation` (about line 8502) for a batch.
4. The WAL append is `appendWalRecordsToGeneration` in `walSnapshotStore.js` (about line 1292). Each record is a `map.set`, `map.patch`, `map.remove` or similar, with an area (`queue`, `completed`, `runs`).
5. The resident projection is updated after the write, inside the same apply step. A failed WAL write leaves the stored part unwritten (`persistCoordinator` comment, about line 10160).
6. A checkpoint switch is scheduled when the segment count crosses a threshold (section 4.1).

**Enqueue.** The `enqueue-coordinator-items` message goes to `enqueueCoordinatorItems` (`sw.js`, about line 24903). Large batches are split into chunks (`COORDINATOR_ENQUEUE_CHUNK_THRESHOLD` 100, `COORDINATOR_ENQUEUE_CHUNK_SIZE`, `sw.js`, about lines 610-633). Rows are added through the `COORDINATOR_ITEMS_ENQUEUE` queue-machine event (`swQueueMachineEvents.js`). Enqueue moves the row to the tail of the row-shard order (section 4.4).

**Claim and open.** A content script asks for its action through `claim-tab-action` (`claimPendingTabAction`, `sw.js`, about line 33204). A profile action that the user starts is recorded with `begin-profile-action` (`beginCoordinatorProfileAction`, about line 28210). The worker validates the attempt (`validateQueuedTabAttempt`, about line 33362) before the foreground promotion (`promote-queued-tab`) is honoured.

**Milestone (non-terminal).** The content script sends `record-job-milestone`. `swBootstrap.js` routes it to `recordJobProgressFromRequest` (`sw.js`, about line 35189). That function:

1. Looks up the tab's queued metadata and fills attempt identity from it.
2. Refuses a patch for a tab that is closing or retrying (`queued-tab-closing`).
3. Checks the attempt with `validateProgressAttempt` (about line 33345).
4. Calls `recordDeferredCoordinatorJobMilestone` (about line 35109). The record is kept in memory as a pending milestone. It is written to disk only when the patch carries an explicit status and `shouldPersistExplicitCoordinatorMilestoneNow` agrees.

**Terminal.** The content script sends `record-job-terminal`. It goes to `recordJobProgressFromRequest` with `expectTerminal`, which:

1. Takes the pending milestone, if any, and merges it into the terminal patch.
2. Calls `recordCoordinatorJobProgressViaQueueMachine` (`sw.js`, about line 16191). Identical in-flight calls are coalesced.
3. That calls `applyCoordinatorQueueMachineEvent` with `PROGRESS_PATCH_RECORD` (about line 16187). The handler in `swQueueMachineHandlers.js` (about line 295) calls `recordCoordinatorJobProgress` (about line 35020).
4. `recordCoordinatorJobProgress` decides the outcome with `reduceJobEvent`.
5. After a terminal result, the worker schedules queued work (`scheduleQueuedWorkContinuation`) and cleans up the owned tab (`scheduleCompletedJobOwnedTabCleanup`, about line 31372).

**Archive.** A finished row is archived by `archiveTerminalCoordinatorRow` (`sw.js`, about line 9719). It writes a `completed`-area record (`makeCoordinatorCompletedWorkWalRecord`, about line 7326). How the active row's removal is recorded alongside it was not traced in this pass (section 8).

**Stored-work clear.** See section 3.5.

**Erase.** See section 5.3.

### 3.2 Progress for queued work (job protocol)

- Content side: `recordProfileNukeProgress` (`content.js`, about line 1311) checks `isActiveQueuedProgressRecord`. When an active queued attempt exists, it sends `record-job-milestone` or `record-job-terminal` through `sendRecordedRuntimeMessageWithRetry` (`content.js`, about line 860) with the attempt id and number. The content script keeps the record the worker accepted.
- Worker side: steps 1-5 of section 3.1 (milestone and terminal). The worker accepts or rejects each message at the authority boundary.
- Storage: accepted progress goes to the session shards through `saveProfileNukeProgressRowProjection` (`sw.js`, about line 6286), which calls `persistCoordinator` with `progressDeltas`.
- Progress is a derived view. Queue authority stays in the WAL.

### 3.3 Manual direct actions (accepted exception)

Manual actions on a profile page that are not part of a queued attempt use a separate path. This is an accepted exception, not a second queue writer.

1. Content side: `recordProfileNukeProgress` (`content.js`, about line 1357 onward) sends `record-direct-profile-progress`. It is fire-and-forget, with a 4 s timeout (`safeSendRuntimeMessageWithTimeout`, `content.js`, about line 849). The content script does not wait for the reply, so the user-facing action does not stall.
2. Worker side: `recordDirectProfileProgressFromRequest` (`sw.js`, about line 35281) is routed from `swBootstrap.js`. It reads the stored record with `getStoredProfileNukeProgressRecord`, drops a patch older than the last direct write (`directProgressClientUpdatedAt`), and writes through `saveProfileNukeProgressRowProjection`.
3. The manual action itself is recorded by `record-manual-profile-action` (`recordManualProfileActionRequested`, `sw.js`, about line 22773). It writes one completed-area history row (`completedRows` through `persistCoordinatorWithFinishedOutliers`). Its `results` and `removedRows` are empty, so it writes no queue row.
4. Clearing: `clear-profile-nuke-state` goes through the queue-machine event `PROFILE_STATE_CLEAR`. `clearProfileNukeState` in `sw.js` (about line 25762) is the worker side. The comment at `recordDirectProfileProgressFromRequest` (about line 35306) says it leaves a tombstone, not a deletion, with a fresh client timestamp, so a late patch cannot recreate the record. The tombstone write was not traced line by line.

Lifecycle: session-only progress. It is lost on browser restart. No queue row or attempt is touched. It is not queue authority. A later migration could move it onto one explicit observation contract (review 2). Not scheduled.

### 3.4 Space feed

Space-feed state has three durable pieces: the pending records, the remembered nuked map, and the registry. The content script sends changes; the worker writes them.

**Register candidates.** `registerPendingSpaceFeedEntries` (`content.js`, about line 9736) sends the post candidates with `merge-space-pending-nuked-posts`. The worker applies `SPACE_PENDING_NUKED_POSTS_MERGE` (queue-machine event, `swBootstrap.js` about line 731). Only candidates not yet nuked and not already remembered are sent.

**Remove.** The content script removes pending URLs with `remove-pending-space-feed-urls` (`removePendingSpaceFeedUrls`, `content.js`, about line 9763), which applies `PENDING_SPACE_FEED_URLS_REMOVE`. Entries are removed with `remove-pending-space-feed-entries` (`removePendingSpaceFeedEntries`, `content.js`, about line 9779; the event name it maps to is unverified).

**Confirm.** A profile moves from pending to the remembered nuked map only when archive confirms it. Three callers reach `settleConfirmedSpaceFeedProfiles` (`swCoordinatorTerminalSettlement.js`, about line 139):

1. The terminal settlement path, `buildTerminalCoordinatorSettlementDerivedPayload` (`swCoordinatorTerminalSettlement.js`, about line 196). The message `settle-terminal-coordinator-items` applies `TERMINAL_COORDINATOR_ITEMS_SETTLE`; the chain from that event to this function was not traced.
2. `reconcilePendingSpaceFeedWithArchive` (`sw.js`, about line 26024).
3. `confirmSpaceFeedProfilesBlocked` (`sw.js`, about line 26048), reached from `confirm-space-feed-profiles-blocked` (`SPACE_FEED_PROFILES_CONFIRM`).

`settleConfirmedSpaceFeedProfiles` removes confirmed hrefs from each pending record's remaining URLs. It records them as nuked and prunes the nuked map by retention and count.

**Nuked map.** `set-space-nuked-posts` (`setSpaceNukedPostsRequested`, `sw.js`) writes the remembered map directly.

**Clear.** Clear Current Work does not remove pending records (review 1). `mutateCoordinatorStoredWorkClear` (`sw.js`, about line 26886) has no reference to `SPACE_PENDING_NUKED_POSTS_KEY`. Planned: Clear should remove them (owner decision, not built). The 18 Oct audit counted 3,368 pending records on the dev profile, 724 of them orphaned; the link to Clear is likely, not proven (`planning.md`, loose end 19).

### 3.5 Clear Current Work and stored-work clear

- Message: `clear-coordinator-current-work` runs `clearCoordinatorCurrentWork` (`sw.js`, about line 23119). A successful clear writes an explicit zero summary; a failed one returns a reason.
- Core: `clearStoredCoordinatorWork` (`sw.js`, about line 23309) dispatches the stored-work clear.
- Plan: `buildStoredWorkClearPlan` (`sw.js`, about line 26852) lists the queue rows and owned tabs to remove, from a read.
- Write: `mutateCoordinatorStoredWorkClear` (`sw.js`, about line 26886) re-reads the planned rows before saving. If a row's attempt moved, the plan is rebuilt. The loop runs at most `STORED_WORK_CLEAR_REREAD_ATTEMPTS` times (`tunables.js`, value 2).
- Removes: active queue rows and archived completed rows, through the WAL. Owned tabs are listed in the plan for closing (the closing step was not traced).
- Keeps: pending space-feed records (section 3.4) and remembered nuked posts.

Open: a late write from an attempt that moved after the last read. A write to a row that no longer exists is rejected on the milestone path (`missing-coordinator-item`). The other writers have not been checked (carried from the 14 Oct note; unverified now).

### 3.6 Queue-machine events

Every queued-work change is an event type named in `shared/js/swQueueMachineEvents.js` (63 lines, `QUEUE_MACHINE_EVENT_TYPES`). The worker applies them with `applyCoordinatorQueueMachineEvent` (`sw.js`, about line 16187). Handlers are in `swQueueMachineHandlers.js`; the one traced in this pass is `PROGRESS_PATCH_RECORD` (about line 295, section 3.1). The list below is grouped by name, not by a traced handler, except where a section above names the handler.

| Group | Events |
|---|---|
| Enqueue and open | `COORDINATOR_ITEMS_ENQUEUE`, `TAB_OPENED`, `TAB_OPEN_TIMEOUT`, `TAB_OPEN_ROLLBACK_UNACKED`, `SLOT_AVAILABLE`, `QUEUED_NO_OPEN_REPRIME`, `EXECUTOR_ENQUEUE_TIMEOUT`, `QUEUED_AUTHORITY_ENQUEUE_FAILURE` |
| Attempt and claim | `RECOVER_PENDING_TAB_ACTION`, `RESTORE_ACTIVE_RUNTIME_FOR_SENDER`, `RELEASE_RUNTIME_IF_AUTHORITY_NOT_ACTIVE`, `ACTION_LEASE_REQUEST`, `ACTION_LEASE_HEARTBEAT`, `ACTION_LEASE_RELEASE`, `ACTION_LEASE_TAB_RELEASE`, `PROFILE_TARGET_RESOLVE`, `PROFILE_RESOLUTION_UNRESOLVED` |
| Progress and terminal | `PROGRESS_PATCH_RECORD`, `ROW_EVENTS_APPLY`, `ACTIVE_TERMINAL_PROGRESS`, `ACTIVE_MISSING_TAB`, `ACTIVE_NON_PROFILE_LANDING`, `ACTIVE_PROFILE_REDIRECT_MISMATCH`, `BLOCKED_LIVE_TAB_TERMINAL_RECORD`, `BLOCKED_SWEEP_TERMINAL_RECORD`, `INITIAL_BLOCKED_STATE_RECORD`, `KEY_ONLY_TERMINATE` |
| Retry and rollback | `STALE_RETRY_ADVANCE`, `RETRY_FAILED_ITEMS`, `EXHAUSTED_ROLLBACK_RECOVER`, `EXHAUSTED_ROLLBACK_SETTLE`, `EXHAUSTED_ROLLBACK_TERMINATE`, `QUEUED_MATERIALIZATION_FAILURE` |
| Stored work | `CLEAR_STORED_WORK`, `CANCEL_STORED_WORK`, `CANCEL_STORED_WORK_ITEM`, `PAUSE_STORED_WORK`, `TERMINAL_COORDINATOR_ITEMS_SETTLE` |
| Pause | `PAUSE_STATE_SET`, `RUNS_PAUSED_SET` |
| Profile state | `PROFILE_STATE_CLEAR` (the clear-profile-nuke-state message, section 3.3) |
| Space feed | `SPACE_PENDING_NUKED_POSTS_MERGE` (section 3.4), `PENDING_SPACE_FEED_URLS_REMOVE` (section 3.4), `PENDING_SPACE_FEED_ENTRIES_REMOVE`, `SPACE_FEED_PROFILES_CONFIRM` (section 3.4) |

Terminal writes go to the completed area through `archiveTerminalCoordinatorRow` (section 3.1). The progress path decides its outcome with `reduceJobEvent` (section 3.1). The other terminal paths were not all traced to the reducer (section 8).

### 3.7 Restart behaviour

What survives a worker restart (reload or service-worker wake) and a browser restart. "Rebuilt" means the worker recomputes it from durable state.

| Item | Worker restart | Browser restart | Source |
|---|---|---|---|
| Queue rows (active and queued) | Recovered from checkpoint and WAL tail (`hydrate`, `loadResidentState`) | Same | section 4.8 |
| Completed rows | Recovered from the `completed` area | Same | section 4.5 |
| Runs | Replayed from the `runs` records; the session-mirror refresh was not traced | Same | section 4.6 |
| Pending milestones (in memory) | Lost | Lost | `recordDeferredCoordinatorJobMilestone` (section 3.1) |
| Progress (session shards) | Kept in session storage | Lost | section 2.3 |
| Live-tab set for progress pushes | Lost | Lost | section 2.3 |
| Content queue index | Rebuilt on the first lookup | Rebuilt | section 2.3 |
| Pending erase marker | Read at load; the erase finishes if it is set | Same | section 5.3 |
| Erase generation | Session storage | Lost | section 2.3 |
| Flight recorder | Session snapshot kept | Snapshot kept only while session storage lasts | section 2.3 |

The session-storage behaviour on browser restart is taken from the 24 Oct note and the section 2.3 table; it was not tested in this pass (section 8).

## 4. Checkpoint and shard layout

### 4.1 When a switch happens

- The log is segmented and in arrival order (`walSnapshotStore.js`, `appendWalRecordsToGeneration`).
- Thresholds (`sw.js`, about lines 546-564): soft switch at 128 committed segments (`COORDINATOR_QUEUE_WAL_SEGMENT_SOFT_SWITCH_AT`); force switch at 256 (`COORDINATOR_QUEUE_WAL_SEGMENT_FORCE_SWITCH_AT`); hard limit at 1024 (`COORDINATOR_QUEUE_WAL_SEGMENT_HARD_LIMIT`). Above the hard limit, appends wait for the switch (carried from the 24 Oct note; the append path was not re-read).
- `scheduleCoordinatorQueueWalCheckpointSwitch` (`sw.js`, about line 8045) sets a due reason. A second request while one is due or running is coalesced (metric `segmentCheckpointSwitchCoalesced`).
- `maybeRunDueCoordinatorQueueWalCheckpointSwitchInline` (`sw.js`, about line 8116) runs the switch on the apply tail.
- `performCoordinatorQueueWalCheckpointSwitch` (`sw.js`, about line 8779) does the work. `switchCoordinatorAuthorityQueueWalCheckpoint` (about line 8990) is the wrapper used by callers.
- `cleanupRetiredCoordinatorQueueWalPhysicalKeys` (`sw.js`, about line 8130) is the cleanup of covered old-generation keys. Its behaviour is inferred from the name and the 24 Oct note; the body was not read in this pass.

### 4.2 What a switch writes

Inside `performCoordinatorQueueWalCheckpointSwitch`:

1. Reads the resident queue and completed maps.
2. Prunes completed shards (about lines 8809-8816): `selectCompletedShardsToPrune` (`swCompletedShards.js`) returns the whole expired shards and the oldest shards over the row cap. The checkpoint is written without them.
3. Calls `queueWalStore.prepareCheckpointWrite` (about lines 8817-8825) with `shardOf: queueWalCheckpointShardOf` (section 4.3).
4. Calls `activateCheckpoint` (`walSnapshotStore.js`, about line 1398). Its failure is recorded as `checkpointFailed` and a diagnostic event.
5. Only after a successful save does the resident map drop the pruned completed shards (`dropResidentCompletedShards`, `sw.js`, about line 9957; metric `completedShardsPruned`).

Two checkpoint slots, A and B (`CHECKPOINT_A`, `CHECKPOINT_B`, `walSnapshotStore.js` lines 2-3). `getInactiveCheckpointId` gives the slot the next write goes to. `writeInactiveCheckpoint` (about line 1341) writes it. `recoverActiveCheckpoint` (about line 1421) reads the active one. The active slot is always complete.

### 4.3 How rows are partitioned

- Arrival order is on. `walSnapshotStore.js` `makeCheckpoint` (about line 138) and `prepareCheckpointWrite` take the sharded path when a `shardOf` function is passed or a shard count is set (about line 139).
- The arrival partition is `partitionCheckpointStateByShard` (`walSnapshotStore.js`, about line 227). The shard of each entry is the one `shardOf` names. `makeShardedCheckpoint` (about line 278) builds the pieces. A checkpoint records `partition: 'arrival'` (`CHECKPOINT_PARTITION_ARRIVAL`, about line 472).
- The worker's `shardOf` is `queueWalCheckpointShardOf` (`sw.js`, about line 9842). It sends the `completed` area to `completedAreaShardOf` (`swCompletedShards.js`, about line 65) and every other area to `queueWalRowShards.shardOf`.
- `queueWalRowShards`, `completedWalShards` and `runShardTail` are created at about lines 9836-9841. The first two are built with `enabled: true`.
- Hash partitioning still exists in the generic engine (`partitionCheckpointState`, `walSnapshotStore.js`, about line 204; default count `CHECKPOINT_SHARD_DEFAULT_COUNT` = 10). It is used only when no `shardOf` is passed. The worker passes `shardOf` for every area, so the hash path is not used by the queue store.
- An earlier draft said the arrival option was off. The code has it on. The completed-log plan's status line is stale (section 6, item 6).

### 4.4 Queue rows

- Each row has a `shard` field. `makeQueueWalRowShardTail` (`swQueueWalRowShard.js`, about line 39) builds the tail. Its `shardOf` (about line 87) reads that field.
- The worker stamps rows with `queueWalRowShards.stamp` at the write path (`sw.js`, about lines 10269 and 10808). Enqueue, retry and requeue move the row to the tail. Other updates keep the row's shard.
- The budget is 16,384 bytes of uncompressed JSON (`QUEUE_WAL_SHARD_BYTES`, `tunables.js` line 11). It is a proxy for the compressed target.
- On hydrate and on a rebuild, the tail is rebuilt from the loaded queue (`queueWalRowShards.rebuild`, `sw.js`, about lines 9898 and 10092).
- Shard order is storage order. It does not define execution order. Retry-candidate policy is separate.

### 4.5 Completed rows

- Each archived row gets a completion-order shard: `completedWalShards.stamp` (`sw.js`, about line 7355), with `makeCompletedShardTail` (`swCompletedShards.js`, about line 32) and `completedShardIdOf`.
- Prune at checkpoint (section 4.2): `selectCompletedShardsToPrune` (`swCompletedShards.js`, about line 71). A shard is dropped when its newest completion is older than retention, then the oldest shards go until the row count is at or under the cap. A retention or cap of 0 turns that limit off.
- Retention comes from `nukedPostRetentionDays` (default 90, `defaults.js` line 8). The cap comes from `maxRememberedNukedPosts` (default 10,000, `defaults.js` line 9). Both are read in `sw.js` (`recentHistoryRetentionDays`, `recentHistoryMaxEntries`, about lines 993-994 and 2304-2315).
- Pruning is whole-shard, so the cap can be exceeded by part of a shard.
- Clear and history operations go through worker messages and WAL mutations, not direct map writes.

### 4.6 Runs

- Each run gets a `runShard` from `runShardTail.stamp` (`swRunShards.js`, `makeRunShardTail` about line 23). A new run takes the tail shard. Runs already in the log keep theirs.
- The run cap is `RUN_RETENTION_MAX_COUNT` = 700 (`swRunsWal.js`, line 82). `takeRunsPartFromChange` (`sw.js`, about line 10227) applies it in the same write. `selectRunShardsToDrop` (`swRunShards.js`, about line 54) returns the oldest whole shards, keeping the newest shard and any shard a live queue row still refers to. `withoutRunShards` removes them.
- The 700 cap can be exceeded while references pin shards.
- Physical partition for runs is not applied. `queueWalCheckpointShardOf` special-cases only `completed`. Run records carry `runShard`, not `shard`, so `queueWalRowShards.shardOf` reads no shard for them and they land in the default piece (review 4).
- Planned: runs time-sharded like completions, with physical partition by run shard (owner decision, not built).

### 4.7 Session mirror of the queue namespace

`queueNamespaceMirrorKeys` (`walSnapshotStore.js`, about line 755) names the keys kept in session storage beside the WAL: the run list and the outlier list (`sw.js`, about lines 6269-6277, `QUEUE_NAMESPACE_MIRROR_KEYS`). Each has a stamp key (`queueNamespaceStampKey`, about line 770). The comment at `QUEUE_NAMESPACE_MIRROR_KEYS` says the dashboard path reads the outlier list from the mirror, and hydrate does not.

### 4.8 Load and recovery

- `hydrate` (`sw.js`, about line 9875) and `loadResidentState` (about line 9884) build the resident state from the checkpoint plus the WAL tail.
- `loadStoreFromStorage` (`swQueueWalStore.js`, about line 286) reads the segmented store. If the manifest and the segments disagree, it retries the read once with the exact segment count (`tornWriteRetry`, about line 386). A committed segment that is missing or does not match fails the load closed (carried from the 24 Oct note; the failure branch was not re-read).
- `recoverCheckpointFromMirror` (`swQueueWalStore.js`, about line 233) is called from `loadStoreFromStorage` (about line 456). When the session mirror copy of a checkpoint is refused, the worker's own copy is used if it verifies, and the torn slot is written back. This is the parked "Recovery B" (section 6, item 12). It is present in the code.

### 4.9 Other layouts

- Profile progress: 256 session shards, hashed per profile href (`PROFILE_NUKE_PROGRESS_SHARD_COUNT`, `storageKeys.js` line 18). The legacy cleanup names 32 old shards (`LEGACY_PROFILE_NUKE_PROGRESS_SHARD_COUNT`, line 19).
- Space post maps: 32 hash buckets each (`SPACE_MAP_BUCKET_COUNT`, `storageKeys.js`), with layout marker version 2 (`spaceMapStorage.js`, `SPACE_MAP_LAYOUT_BUCKETED` = 2).
- Content queue index: 32 shards for the queue index and 32 for the source index (`COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_COUNT`, `COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT`). Derived in memory.
- Checkpoint piece count: `CHECKPOINT_SHARD_DEFAULT_COUNT` = 10. Used by the hash path only (section 4.3). The on-disk piece count under the arrival partition is not verified here (section 8).

## 5. Storage namespace and erase rules

### 5.1 The prefix and the wrapper

- Every stored key is `STORAGE_LAYOUT_PREFIX` plus its name: `v1.6.` (`storageKeys.js`, line 64). So `mbCoordinatorRuns` is stored as `v1.6.mbCoordinatorRuns`.
- `namespaceArea` (`storageNamespace.js`, about line 48) wraps a `chrome.storage` area. Its `get`, `set` and `remove` add or strip the prefix. Its `get(null)` returns only this layout's keys, with plain names. Its `clear` removes only this layout's keys. Its `getBytesInUse` counts only them.
- `namespaceChanges` gives the change events for this layout's keys, with plain names.
- The worker reads and writes through `namespaceArea` (for example `rawCoordinatorStorageAdapter`, `sw.js`, about line 2479), so code outside the wrapper never sees the raw names.

### 5.2 Unprefixed data

- Unprefixed data from earlier builds is not migrated. The two layouts ignore each other's keys (`storageNamespace.js` header; the `storageKeys.js` comment says a build before 1.6.1628 never reads or writes the prefixed names, and the reverse).
- Nothing in this layout deletes the unprefixed copies. A fresh start under this layout begins with an empty store.
- `checkStorageBuild` (`sw.js`, about line 37011) writes `mbStorageBuild` when the build changes. It performs no schema migration.

### 5.3 Erase (Erase Block History)

`erase-block-history` runs `eraseBlockHistoryRequested` (`sw.js`, about line 22711). This is the clean-slate erase. Its rules, in order:

1. The request must carry the confirmation string `ERASE` (`ERASE_BLOCK_HISTORY_CONFIRMATION`). Anything else is refused (`confirmation-mismatch`).
2. A second erase while one is scheduled is refused (`erase-already-scheduled`, `storageWritesClosedByErase`).
3. The authority must be loaded (`authority-not-loaded`).
4. The erase forces the queue pause (`pauseCoordinatorNukes`, `sw.js`, about line 22941). It stops new opens and requeues any active row.
5. After the pause, the erase is refused if any row is still active (`queue-row-active`). No tab is mid-action when it runs.
6. Inside `enqueueSpaceFeedStorageUpdate` (`sw.js`, about line 25650), the marker `ERASE_BLOCK_HISTORY_PENDING_KEY` is written first. The checkpoint-switch due flag and the remembered checkpoint slots are dropped.
7. All stored keys in this layout are removed except the marker (`get(null)` then `remove`). The session namespace is cleared.
8. The worker closes its writes (`storageWritesClosedByErase`) and reloads the extension after `ERASE_RELOAD_DELAY_MS`, so no in-memory state writes back over the erase.

At the next start, `runPendingBlockHistoryErase` (`sw.js`, about line 22749) runs before anything is loaded. If the marker is set, it removes every stored key outside `ERASE_BLOCK_HISTORY_KEEP_KEYS` (currently empty, so everything), clears the session namespace, writes a new erase generation to session storage, and reloads the open Quora tabs so their content scripts read the cleared store. The marker is removed last, so an interrupted erase runs again.

The erase is not for routine use. After it the queue has no record of any profile blocked, and will act on them again.

### 5.4 Other clears

- Clear Current Work: section 3.5. Keeps pending space-feed records.
- Clear events: `clear-coordinator-events` is in the authority set of `swBootstrap.js`; `clearCoordinatorEventsRequested` (`sw.js`, about line 22698) is the worker function. The dispatch branch was not traced.
- Clear terminal stats: `clear-coordinator-terminal-stats` is in the authority set of `swBootstrap.js`. Its handler was not traced.
- Clear profile state: `clear-profile-nuke-state` (section 3.3).

### 5.5 Startup retirements and one-time cleanup

- `retireUnusedVersion15StorageKeys` (`sw.js`, about line 37001) removes `mbCoordinatorQueue` and `mbProfileNukeProgress`. Runs from `runtime.onInstalled` and `runtime.onStartup` (`swBootstrap.js`).
- `retireLegacyQueueViewStorageKey` (`sw.js`, about line 37029) removes `mbCoordinatorQueueView` once, at load (`void retireLegacyQueueViewStorageKey()`, about line 37160).
- The legacy content index and progress cleanup (`sw.js`, from about line 37038) removes the fixed list of old names. It is guarded by `LEGACY_CONTENT_INDEX_CLEANUP_MARKER_KEY` (`mbLegacyContentIndexCleanupV1`). Its comment says the marker is in session storage, so the cleanup runs once per browser session.
- Removal goes through `coordinatorStorageAdapter`, the namespaced adapter. It targets the prefixed names. Unprefixed copies from earlier builds are left alone.

## 6. Known exceptions and planned work

### 6.1 Known exceptions

| # | Item | Status | Where / source |
|---|---|---|---|
| 1 | Manual direct-action progress is a second progress protocol | Accepted exception (section 3.3). Migration to one observation contract not scheduled. | `content.js` `recordProfileNukeProgress`; `sw.js` `recordDirectProfileProgressFromRequest`. Review 2. |
| 2 | Clear Current Work leaves pending space-feed records | Open. Planned: Clear removes them (owner decision, not built). The 724 orphaned records (18 Oct audit) are likely linked, not proven. | `mutateCoordinatorStoredWorkClear`. Review 1. |
| 3 | Runs bucket layout (read, write, migration) still in code | Excise decided 25 Oct, not started (section 6.2, item 1). Normal writes no longer use it: `takeRunsPartFromChange` removes runs from the stored payload. The startup migration (`migrateSpaceMapLayout`, about line 10605) still writes runs as buckets when the run layout is unmarked; read from code, not run. | `sw.js` `applyRunsStoredLayout`, `getRunsDiskWrite`, `commitRunsDiskWrite`, `migrateSpaceMapLayout`. Review 3. |
| 4 | Runs are not partitioned by `runShard` at checkpoint | Open. Planned: time-sharded runs (owner decision, not built). | `queueWalCheckpointShardOf`; `swRunsWal.js`. Review 4. |
| 5 | Shadow and gap checks on write and reconcile paths | Removal decided 25 Oct, not started (section 6.2, item 2). | `sw.js` shadow-WAL compare (about lines 9019-9259, 9416-9625), `recordRunsResidentDiskGap` (about line 2745), `startRunsGapWatch` (about line 2789). Review (second "4"). |
| 6 | Completed-log plan status | The plan file says steps 4 to 7 are not started. The code has the switches on (section 4.3). The plan's status line is stale. | `completed-log-shards-plan-2026-10-25.md`. |
| 7 | Raw `mbCoordinatorQueue` removal | Guarded on write and removed at startup. Owner's note said "not removed". | `sw.js` `metricStorageSet` guard; `retireUnusedVersion15StorageKeys`. |
| 8 | Session storage quota | Not measured live. No quota check on session writes (carried from the 24 Oct note). | Not re-checked in this pass. |
| 9 | Landing check reads the URL only; dry-run mode is not built | Open (carried from the 15 Oct identity work). | `getQueuedProfileRemapTarget` (`content.js`); `swBootstrap.js` tab-update check. |
| 10 | Progress has many in-memory writer sites | Open. No change now. | Not counted in this pass. |
| 11 | Worker-window focus: a surface with `focused: false` may be a no-op for some actions | Open since 25 Sep. | `getOrCreateQueuedWorkerActionSurface` (`sw.js`, about line 28835). |
| 12 | Torn-checkpoint recovery from a worker copy ("Recovery B") | Present in code (`recoverCheckpointFromMirror`, section 4.8). Parked by owner (25 Oct: stays parked until shown to be needed). The defer note and the code disagree on whether it exists; the code has it. | `swQueueWalStore.js`; test `test/swQueueWalStore.test.js`. |

Known and accepted: progress is lost on browser restart (session-only, section 2.3). The live-tab set for progress pushes is worker memory, and is lost on worker restart (carried from the 24 Oct note; the exact structure was not checked).

### 6.2 Planned work, with status

Owner decisions of 25 Oct from `dead-ends-review-2026-10-24.md` ("Decided, next"), plus items from `planning.md` and the completed-log plan. Status is as of this note. None of these has been built.

| # | Work | Status | Source |
|---|---|---|---|
| 1 | Excise the run-list bucket path, with no import of old data. Remove its readers and writer, the gap watch and its two calls, the runs part of the startup migration, and the dev tools that read run buckets. Stored legacy run copies stay until the owner says otherwise. | Decided 25 Oct. Not started. Each removal needs a dependency check and its tests. | `dead-ends-review-2026-10-24.md`, "Runs excise plan" and item 2; `planning.md`, "Decided, next" item 1. |
| 2 | Remove the shadow checks: the progress shadow log, the coordinator-authority shadow log, and the deep-pending compare. Keep the flight recorder's persisted snapshot. | Decided 25 Oct. Not started. | `dead-ends-review-2026-10-24.md`, decision 3; `planning.md`, item 2. |
| 3 | Cruft and constants: the empty erase keep-list, a write-only variable, a stale comment. Layout constants to the storage key module; timing and cap values to the tunables file. | Decided 25 Oct. Partly done: layout constants are in `storageKeys.js` (verified). Rest not checked. | `planning.md`, item 3; `dead-ends-review-2026-10-24.md`, Appendix C. |
| 4 | Fresh-start cleanup, after item 1: remove migrations, repairs and legacy readers a fresh start does not need. | Decided 25 Oct. Not started. Depends on item 1. | `planning.md`, item 4; `dead-ends-review-2026-10-24.md`, section 7. |
| 5 | Runs time-sharded like completions, with physical partition by run shard. | Owner decision. Not built. Also in the completed-log plan, step 5. | Section 4.6; `completed-log-shards-plan-2026-10-25.md`. |
| 6 | Clear Current Work removes pending space-feed records. | Owner decision. Not built. The pending-staging design is open. | Section 3.4; `planning.md`, loose end 19. |
| 7 | Completed-log plan. Step 4 (queue shard id per row, tail move): code has the switch on (`enabled: true`) and the stamping (section 4.4). The tail-move audit (every path that returns a row to queued) is not confirmed. Step 5 (terminal history and runs in arrival shards, in-memory index): partly in code; the index is not confirmed. Steps 6 and 7 (History reads the index; live check): not confirmed. | Mixed. Plan status line is stale. | `completed-log-shards-plan-2026-10-25.md`. |
| 8 | Separate WAL and checkpoint sets per area (queue, runs, completed). The shared set came from moving runs into the shared WAL (`b20be9e`). | Owner, 24 Oct, to confirm. Not decided. | `planning.md`, "Deferred follow-up: WAL-order storage". |
| 9 | Outlier recording limit at 3.5 s or more: built (`OUTLIER_MIN_RECORD_MS` = 3500, `tunables.js`; commit `5a41c99`). Outlier events persisting with their outlier until Clear, and terminal-only listing: not checked in this pass. | `dead-ends-review-2026-10-24.md`, "Decided, next" items 5-7; `docs/outliers-plan-2026-10-24.md`. |
| 10 | Landing dry-run mode for the landing check. | Designed, not built. | Section 6.1, item 9. |
| 11 | Manual progress onto one observation contract. | Not scheduled. | Section 3.3; review 2. |
| 12 | Session storage quota check and measurement. | Not started. | Section 6.1, item 8. |
| 13 | Worker-window focus behaviour for queued actions. | Open. | Section 6.1, item 11. |
| 14 | Recovery B (torn-checkpoint recovery from a worker copy). Parked; the excise is kept. | Owner, 25 Oct: stays parked until shown to be needed. | Section 4.8; `dead-ends-review-2026-10-24.md`, section 1. |

## 7. Metrics and tests

Counters are written with `incrementQueueWakeupMetric` (`sw.js`). Names below were found in the code (search by name). The flight recorder (section 2.3) takes the diagnostic events.

- Checkpoint and WAL: `coordinatorAuthority.queueWal.segmentCheckpointSwitchScheduled`, `coordinatorAuthority.queueWal.segmentCheckpointSwitchCoalesced`, `coordinatorAuthority.queueWal.segmentCheckpointSwitchForcedOverQueueWork`, `coordinatorAuthority.queueWal.checkpointFailed`, `coordinatorAuthority.queueWal.completedShardsPruned`, `coordinatorAuthority.queueWal.projectionSaved` (all in `sw.js`).
- Progress: `progress.coalescedInFlight` (`recordCoordinatorJobProgressViaQueueMachine`), `progress.rowProjectionStorageFailed` (`saveProfileNukeProgressRowProjection`), `terminalProgress.coalescedInFlight`.
- Runs: `runs.writeUnchanged` (`persistCoordinator`).
- Storage: `storageRemoveCalls`, `storageUpdate.lateWriteSuppressed`.
- Reconcile and pump: `reconcile.requested`, `reconcile.deferredBeforeQuora`, `pump.noop.activeRuntimeFillSuppressed`.

Tests (Node scripts; `npm test` runs an explicit sequence, and `test/` holds the files):

- `test/p1-contract.test.js`: storage key contract (section 2.5).
- `test/jobState.test.js`: the job reducer.
- `test/walSnapshotStore.test.js`, `test/walSnapshotStoreFuzz.test.js`, `test/walCheckpointShards.test.js`: the generic WAL and checkpoint engine.
- `test/swQueueWalStore.test.js`: the queue store, including the mirror recovery (Recovery B, section 4.8).
- `test/swSynthetic.test.js`: the worker with synthetic browser and storage.

New test files must be listed in `npm test` and in the parallel runner (`tools/run-tests-parallel.js`). This rule is in the owner's coder instructions, not in `AGENTS.md`. This note did not run tests (section 8).

## 8. Not verified in this pass

- The on-disk piece count of the checkpoint under the arrival partition (section 4.9).
- Whether the arrival partition's replay agrees with the in-memory completed index on every path (section 6.2, item 7).
- Whether the checkpoint's "unchanged piece" reuse works beyond the first checkpoint after a load. The 24 Oct note says it does only on the first; not re-checked.
- Whether any path other than the three settlement callers (section 3.4) removes pending records.
- The live-tab set structure for progress pushes (section 2.3).
- The queue-machine event that `remove-pending-space-feed-entries` applies.
- The queue-bar summary and the outlier write cadence are not described here.
- Items 8 to 12 of section 6.1 were carried from earlier notes and were not re-read here, except item 12, which was checked in code.
- The number of run-list and progress writer sites (section 6.1, item 10).
