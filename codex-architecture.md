# Mute Block Architecture, As Built

**Snapshot:** HEAD `bbf073765040d853f0e157648c7305b68dce6ba9` (merge commit, 2026-10-25). This describes the committed source at that revision. It supersedes the earlier draft `codex-mb-architecture.md` for current implementation facts. The repository's `architecture.md` and dated design notes provide intent, but the current-state map in `architecture.md` is still dated 24 Oct and contains stale claims (see `codex-review-2.md`).

## Product and runtime shape

Mute Block is a WebExtension for Quora. Its content script is injected on `https://*.quora.com/*`; the extension also provides a preferences page and coordinator dashboard/history. Chrome uses a Manifest V3 service worker, while Firefox uses its background-script manifest. Shared source under `shared/` is bundled into browser-specific `chrome/` and `firefox/` outputs.

The feature surface includes profile mute/block and unblock/unmute, profile-list collection and batch work, space classification/feed actions, local settings, and queue/history reporting.

## Authority and transitions

The service worker is the authority for queued work. Durable queue rows represent desired work; browser tabs, content-script reports, runtime maps, progress views, and dashboard data are observations or projections. Page and dashboard code request queue mutations through runtime messages. `swBootstrap.js` registers browser events and routes messages, `swmessages.js` normalizes message actions, and `sw.js` composes most policy and operation handlers.

`jobState.js` defines job statuses, valid transitions, and `reduceJobEvent`. `swQueueMachineEvents.js`, `swQueueMachineDispatcher.js`, and `swQueueMachineHandlers.js` provide event types and dispatch; `swCoordinatorProgressReducer.js` converts accepted progress to row events. Queued claims and progress messages carry attempt identity so delayed reports can be accepted or rejected against current state.

The worker reconciles durable rows with live tabs, page claims, challenges, and progress, then applies state changes and browser effects. `swscheduler.js`, `swexecutor.js`, `swqueueRuntime.js`, and `swquoraTabs.js` own parts of scheduling, tab effects, volatile executor state, and Quora tab classification. `sw.js` remains the broad orchestration layer. Runtime maps are caches and must not independently authorize queued work.

## Storage and recovery

The extension uses `browser.storage.local` and `browser.storage.session`; no IndexedDB or SQLite engine is adopted. `storageKeys.js` centralizes storage key names. `storageNamespace.js` prefixes names with `v1.6.` and scopes reads, writes, clears, and change events to that layout. The current layout does not migrate unprefixed prior-build data. `STORAGE_BUILD_KEY` records the running build; the current build check records version changes but is not a schema migration.

The queue is a segmented write-ahead log plus two checkpoint slots. `walSnapshotStore.js` provides WAL/checkpoint/replay primitives; `swQueueWalStore.js`, `swQueueWalRecovery.js`, `swQueueWalDurableReads.js`, and `swCoordinatorQueueWal.js` provide queue-specific storage and recovery. The worker hydrates resident authority before authority-dependent reads. Checkpoints use ten hash partitions. Queue rows also carry a row shard id: enqueue/retry/requeue moves a row to the tail shard, while other updates retain the current shard. Sharding determines checkpoint placement, not execution order.

Completed/terminal rows live in the queue store's `completed` area. `swCompletedShards.js` assigns completion-order shards, and checkpointing prunes whole old shards based on recent-history retention and the configured row cap. Defaults are 90 days and 10,000 rows. The cap is approximate at shard boundaries. Clear and history operations are routed through worker handlers and WAL-backed authority.

Runs are WAL records in the `runs` area. Each run carries a time shard based on its creation day; `queueWalCheckpointShardOf` routes the runs area to this shard partition. Whole run shards are removed by age and by a 700-run cap, while preserving the newest shard and shards referenced by live queue rows. The cap is likewise shard-granular. Run summaries are recomputed from queue state for dashboard projections. The previous bucket-layout compatibility/migration code has been removed in this HEAD.

Other state has separate lifetime and authority:

- Per-profile nuke progress is a derived session-storage view split into 256 shards. It is not durable across browser restart and is not queue authority.
- Space post maps and the space registry are local data. Nuked/pending post maps use 32 hash buckets and layout markers.
- Content queue/source indexes are rebuildable projections; retired disk copies are cleaned up.
- Queue bar summaries and dashboard views are derived UI data.
- The flight recorder is an in-memory diagnostic ring with a bounded session snapshot.
- Preferences, outliers, work-session metadata, and selected metrics use their own local/session keys.

`swstorage.js` contains storage/WAL primitives and serialized update machinery. The old raw `mbCoordinatorQueue` snapshot is retired, and `mbCoordinatorQueueView` is not the dashboard's normal source of truth.

## Clear and pending-space data

Clear Current Work now collects pending-space entries associated with the active/completed rows it removes, and includes the pending-map change in the same worker persistence operation. This reduces stale candidate records when their profile rows are still represented in the queue or completed history. It does not sweep pending records that have become orphaned already; if no rows are selected, the clear path returns before this cleanup. This is an implementation boundary, not evidence that every pending record should always be deleted.

## UI and browser effects

The Quora content script reads page state, renders controls, runs user-visible page actions, and reports queued claims/milestones/terminal outcomes with attempt identity. One separate manual-profile progress protocol remains for direct actions without a queued attempt; see the review. Preferences read settings/display state but send writes through the worker. The dashboard requests fresh queue/run projections and sends control actions; if the worker cannot answer, it can retain/fall back to display data.

Browser effects include tabs/windows, alarms, runtime messages, storage events, scripting, and webRequest. A dedicated worker-action window handles queued operations that require a visible page. Its focus mode is configurable; actual Quora actions remain sensitive to page structure, visibility, and browser focus behavior.

## Tests and operational constraints

The project uses Node synthetic-browser/storage tests. `npm test` is an explicit list of scripts and `npm run test:parallel` uses `tools/run-tests-parallel.js`. This refresh was research-only; no test or build was run.

`AGENTS.md` requires version bumps across package and manifest files before any build, a fresh local rebuild after shipped behavior changes, and DevTools Protocol rather than Puppeteer for live browser work. Those rules govern repository work rather than runtime architecture.

## Source map

| Concern | Main implementation |
|---|---|
| Job schema/reducer | `shared/js/jobState.js` |
| Worker composition/messages | `shared/js/sw.js`, `shared/js/swBootstrap.js`, `shared/js/swmessages.js` |
| Queue WAL/recovery | `shared/js/swCoordinatorQueueWal.js`, `shared/js/swQueueWalStore.js`, `shared/js/swQueueWalRecovery.js`, `shared/js/walSnapshotStore.js` |
| Completed/run shard policies | `shared/js/swCompletedShards.js`, `shared/js/swRunShards.js`, `shared/js/swRunsWal.js` |
| Key layout/storage plumbing | `shared/js/storageKeys.js`, `shared/js/storageNamespace.js`, `shared/js/swstorage.js` |
| Scheduler/runtime/browser execution | `shared/js/swscheduler.js`, `shared/js/swqueueRuntime.js`, `shared/js/swexecutor.js`, `shared/js/swquoraTabs.js` |
| Page/dashboard/preferences | `shared/js/content.js`, `shared/js/coordinator.js`, `shared/js/preferences.js`, `shared/coordinator.html` |
