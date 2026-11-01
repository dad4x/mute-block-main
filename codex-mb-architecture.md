# Mute Block Architecture, As Built

**Snapshot:** commit `62a67eacc631d0450fa7ca77d2ce2ca59e41e9e3` (`Storage layout v1.6 (prefixed keys), completed log, queue shards (v1.6.1629)`, 2026-10-25). This is a code-based description of the current checkout, not a proposal. The repository's [architecture.md](architecture.md), [unified-store-design.md](unified-store-design.md), and dated notes remain useful design evidence, but some statements predate this snapshot.

## Product and runtime shape

Mute Block is a WebExtension for Quora. It injects a content script on `https://*.quora.com/*`, provides extension preferences and dashboard/history pages, and runs background coordination in `shared/js/sw.js`. Chrome uses a Manifest V3 service worker; Firefox uses its background-script manifest. The shared source is bundled into the browser-specific `chrome/` and `firefox/` outputs.

The user-facing surface includes profile mute/block and unblock/unmute actions, profile-list collection and batch work, space classification and feed actions, a coordinator dashboard/history, and local preferences. Preferences are in `shared/js/defaults.js` and `shared/js/preferences.js`; the dashboard and history are in `shared/js/coordinator.js` and `shared/coordinator.html`.

## Authority and state transitions

The service worker is the authority for queued work. Durable queue rows describe desired work; tabs, content-script reports, runtime maps, progress views, and dashboard data are observations or projections. Content and dashboard surfaces request queue mutations through runtime messages. `swBootstrap.js` registers browser event listeners and message dispatch; `swmessages.js` normalizes action names. The service worker composes the actual handlers and browser effects.

`jobState.js` defines the job statuses, valid transitions, and `reduceJobEvent`. Queue-machine event constants, dispatch, and handlers are split across `swQueueMachineEvents.js`, `swQueueMachineDispatcher.js`, and `swQueueMachineHandlers.js`. Progress reduction is in `swCoordinatorProgressReducer.js`. These modules are used by the worker to validate queued claims, milestones, terminal outcomes, retries, and other state transitions. This is a shared decision core, though some classification and legacy direct-action paths remain outside it (see [review](codex-mb-review-1.md)).

The worker scheduler/reconciler compares durable rows with live browser tabs and page claims, then applies durable transitions and browser effects. `swscheduler.js`, `swexecutor.js`, `swqueueRuntime.js`, and `swquoraTabs.js` own parts of scheduling, tab effects, volatile execution state, and Quora tab classification. `sw.js` still holds broad orchestration and policy. Runtime maps are caches, not durable queue authority. Claims and acknowledgements are tied to attempt identity; row identity alone is insufficient for delayed reports.

## Persistence and recovery

The extension uses `browser.storage.local` and `browser.storage.session`; it has no adopted IndexedDB or SQLite store. `storageKeys.js` is the central list of extension storage key names. `storageNamespace.js` prefixes every stored name with `v1.6.` and filters reads/change events to that layout. This commit does not migrate unprefixed data: old keys remain separate, and erase clears only the current prefixed namespace. `STORAGE_BUILD_KEY` records the installed build; `checkStorageBuild` records a version change but currently performs no schema migration.

The queue is a write-ahead log (WAL) with segmented append records and two checkpoint slots. `walSnapshotStore.js` provides generic WAL/checkpoint encoding and replay. `swQueueWalStore.js`, `swQueueWalRecovery.js`, `swQueueWalDurableReads.js`, `swQueueWalRowShard.js`, and `swCoordinatorQueueWal.js` provide queue-specific storage, recovery, reads, and records. The worker hydrates a resident queue from checkpoint plus WAL, then serves reads from that resident authority. Checkpoints are still hash-partitioned into ten pieces; the arrival-order generic engine option described in `completed-log-shards-plan-2026-10-25.md` is not enabled for these stores.

Queue rows carry a shard id for checkpoint partitioning. Enqueue/retry/requeue moves a row to the tail; other updates retain its shard. Shards target 16 KiB of uncompressed JSON, a proxy for the plan's compressed target. This storage order does not define execution order. Queue retry-candidate policy remains separate.

Terminal/completed rows are retained in the queue store's `completed` area and are keyed for profile-level lookup/deduplication. `swCompletedShards.js` assigns rows to completion-order shards. At checkpoint, whole expired shards and then oldest shards over the row cap are pruned. Preferences set recent-history retention (default 90 days) and max rows (default 10,000). Pruning is intentionally shard-granular, so the cap may be exceeded by part of a shard. Clear/history operations are routed through worker messages and WAL mutations.

Runs are also represented as WAL `runs` records (`swRunsWal.js`) and stamped with creation-order `runShard` ids (`swRunShards.js`). Those ids group rows for the 700-run retention cap, which drops whole logical shards while retaining the newest shard and shards referenced by live queue rows. They do not currently partition the physical checkpoint: `queueWalCheckpointShardOf` special-cases only `completed`; other areas use the queue-row `shard` field, which runs do not carry, and therefore use the default partition. The worker recomputes run status/counts from queue state for dashboard views. Some older bucket-layout compatibility/migration code remains in `sw.js`.

Other state follows distinct durability policies:

- Profile nuke progress is a derived view in session storage, split into 256 shards. It is volatile across browser restart and is not queue authority.
- Space nuked/pending post maps and the space registry are local-storage data; space map writes use 32 hash buckets and layout markers.
- Content queue/source indexes are rebuildable projections, not authority; legacy disk copies are cleaned up.
- Queue bar summaries and the flight recorder are diagnostic/UI projections. The recorder is an in-memory ring with a bounded session snapshot.
- Outliers, preferences, work-session metadata, and certain diagnostics have their own local/session keys.

`swstorage.js` contains storage/WAL primitives and serialized storage-update machinery. `sw.js` owns orchestration around persistence and state transitions. Queue views and content indexes are derived materializations. The old raw `mbCoordinatorQueue` key has been retired; `mbCoordinatorQueueView` is no longer a normal persisted queue snapshot.

## UI, messaging, and browser effects

The content script runs in Quora pages. It reads page structure, renders controls, performs foreground Quora UI actions when appropriate, and reports queued action claims/results with attempt identity. The preferences page reads settings and display state, but routes writes through the service worker. The dashboard asks the worker for fresh queue/run views and sends control actions; it can fall back to cached view data if a request fails. History is served by a worker message rather than treated as authority by the page.

The extension uses browser tabs, windows, alarms, runtime messages, storage events, scripting, and webRequest APIs. A dedicated worker-action window can host queued actions that require foreground page visibility; configured focus behavior is a user preference. User-visible actions on Quora still depend on live page structure and the browser's visibility/focus behavior.

## Tests, build, and operational constraints

Tests are Node scripts using synthetic browser/storage harnesses. `npm test` runs an explicit sequence; `npm run test:parallel` uses `tools/run-tests-parallel.js`. WAL, state-machine, queue runtime, content, storage, history, and integration behavior have dedicated tests. The current snapshot was researched without running tests or builds.

Repository-specific constraints in `AGENTS.md` include version-bumping all four package/manifest version declarations before any build (including a test build), rebuilding package outputs after shipped behavior changes, avoiding Puppeteer, and using the repository's DevTools Protocol harness for live browser work. These are process requirements, not runtime architecture.

## Architectural intent captured by the implementation

The dominant design is one durable queue authority plus live observations, with reducer-approved transitions and bounded reconciliation. Storage formats and UI views are subordinate to that authority; progress and indexes are rebuildable/non-authoritative; browser effects are issued by the worker after decisions. Durable queue state is WAL-backed and recovered before authority-dependent reads. The current storage-layout commit extends this model with namespaced storage and sharded queue/completed/run records. Known exceptions, incomplete cleanups, and source/documentation disagreements are catalogued separately in [codex-mb-review-1.md](codex-mb-review-1.md).

## Source map

| Concern | Main implementation |
|---|---|
| Job schema and reducer | `shared/js/jobState.js` |
| Worker composition and events | `shared/js/sw.js`, `shared/js/swBootstrap.js` |
| Queue WAL and recovery | `shared/js/swCoordinatorQueueWal.js`, `shared/js/swQueueWalStore.js`, `shared/js/swQueueWalRecovery.js`, `shared/js/walSnapshotStore.js` |
| Completed and run sharding | `shared/js/swCompletedShards.js`, `shared/js/swRunShards.js`, `shared/js/swRunsWal.js` |
| Storage names/layout | `shared/js/storageKeys.js`, `shared/js/storageNamespace.js`, `shared/js/swstorage.js` |
| Scheduler/runtime/executor | `shared/js/swscheduler.js`, `shared/js/swqueueRuntime.js`, `shared/js/swexecutor.js`, `shared/js/swquoraTabs.js` |
| Page and dashboard surfaces | `shared/js/content.js`, `shared/js/preferences.js`, `shared/js/coordinator.js`, `shared/coordinator.html` |

