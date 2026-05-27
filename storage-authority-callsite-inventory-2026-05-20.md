# Storage Authority Call-Site Inventory

Date: 2026-05-20
Version slice: 1.6.376

Status: supporting inventory.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Keep this inventory
in sync with source while the storage authority plan is active.

## Scope

This is the checked inventory for the storage-authority refactor. It covers
full coordinator snapshot load/save call sites and the direct storage paths
that touch coordinator authority or its compatibility mirrors.

Classification values:

- `ordinaryMutation`: current service-worker authority path that mutates queue,
  runs, progress, events, pause state, or action leases.
- `repair`: cleanup or reconciliation path that repairs durable coordinator
  state.
- `displayRead`: dashboard or content read path that should not mutate
  coordinator authority.
- `compatibilityFlush`: compatibility or legacy snapshot flush that should be
  removed, narrowed, or converted after authority helpers exist.
- `checkpointSwitchCandidate`: future full-snapshot write that should become a
  checkpoint generation switch path.
- `userMemoryNonAuthority`: storage write outside coordinator queue/progress
  authority.

## Source Queries

Current inventory was seeded from:

```text
rg -n "loadCoordinatorState\(|saveCoordinatorState\(|metricStorageGet\(|metricStorageSet\(|browser\.storage\.local\.(get|set)|safeStorageSet|recordProfileNukeProgress|compatibility|legacy|fallback" shared/js test/*.test.js tools/cdp --glob '!test/fixtures/**'
rg -n "saveCoordinatorState\(" shared/js/sw.js
rg -n "metricStorageSet\(" shared/js/sw.js
```

## Full Snapshot Save Call Sites

| Function | Operation | Authority Reason | Current Risk | Intended Disposition |
| --- | --- | --- | --- | --- |
| syncCoordinatorProgressRecordsLocked | Applies compatibility progress records back into queue/runs/progress. | compatibilityFlush | Progress mirror can still influence queue state. | Quarantine behind explicit compatibility flush, then replace with reducer/WAL projection reconciliation. |
| repairCoordinatorStorageFromProgressLocked | Repairs queue/runs/progress/events/pending-posts from durable progress and live tabs. | repair | Broad repair path can become a second authority if expanded. | Keep only explicit repair events; delete legacy progress-to-terminal inference where reducer authority can replace it. |
| transitionCoordinatorItemForQueuedTabLocked | Marks queued tab open/active through `mutateCoordinatorProjection({kind: 'transitionQueuedTabActive'})` and recomputes runs. | ordinaryMutation | Queue row active transition is WAL-backed; runs remain a derived compatibility save. | Keep active transition and rollback WAL-backed as a pair; open-tab side effects stay outside queue authority. |
| rollbackFailedQueuedTabOpen | Rolls an attempted active transition back to queued. | repair | Wrapper delegates to `mutateCoordinatorQueuedTabOpenRollback`. | Keep wrapper thin; durable row mutation belongs in the projection operation. |
| mutateCoordinatorQueuedTabOpenRollback | Applies the projection operation behind `rollbackFailedQueuedTabOpen`. | repair | Queue row rollback is WAL-backed; runs remain a derived compatibility save. | Keep row rollback and active transition WAL-backed; open-tab side effects stay outside queue authority. |
| requeueDurableActiveCoordinatorItemWithoutActor | Reclaims a durable active row that has no confirmed runtime actor by assigning a fresh queued attempt or terminal timeout. | repair | Wrapper delegates to the projection operation; durable row repair is WAL-backed. | Keep wrapper thin; derived progress/runs saves remain follow-up compatibility work. |
| mutateCoordinatorActiveWithoutRuntimeActorReconcile | Applies the projection operation behind `reconcileActiveWithoutRuntimeActor`. | repair | Queue row requeue/timeout is WAL-backed; runs/progress remain derived compatibility saves. | Keep row repair WAL-backed and leave live-tab cleanup side effects outside queue authority. |
| mutateCoordinatorActiveNonProfileLandingTerminalize | Applies the projection operation behind `terminalizeActiveNonProfileLanding` when active profile work lands on a non-profile Quora URL before action-phase progress. | repair | Single-row terminal repair still persists full queue/runs/progress maps. | Replace projection save with row-level/WAL terminal repair operation. |
| mutateCoordinatorRunsPausedSet | Applies the projection operation behind `setCoordinatorRunsPaused`. | ordinaryMutation | Full runs rewrite for a small pause-state mutation. | Convert to row-level run metadata operation. |
| mutateCoordinatorStoredWorkPause | Applies the projection operation behind `pauseStoredCoordinatorWork` and writes progress compatibility records. | ordinaryMutation | Active row requeue is WAL-backed through `stored-work-pause`; runs/events/progress remain derived compatibility saves. | Keep pause row mutation WAL-backed and leave pause flag/run metadata/progress compatibility as derived follow-up. |
| mutateCoordinatorStoredWorkCancel | Applies the projection operation behind bulk `cancelStoredCoordinatorWork`, terminalizes current queue work as canceled, and writes progress mirror. | ordinaryMutation | Bulk queue row terminalization is WAL-backed through one batch append; runs/events/progress remain derived compatibility saves. | Keep bulk cancel WAL-backed and leave pause/retry/requeue/enqueue as separate review slices. |
| mutateCoordinatorStoredWorkItemCancel | Applies the projection operation behind targeted current-work item cancel. | ordinaryMutation | Queue row terminalization is WAL-backed; runs/events/progress remain derived compatibility saves. | Keep single-row cancel WAL-backed and repair/rebuild derived state separately. |
| mutateCoordinatorKeyOnlyItemTerminalize | Applies the projection operation behind `terminalizeKeyOnlyCoordinatorItem` for unresolved profile-resolution work. | repair | Queue row terminalization is WAL-backed; runs/events remain derived compatibility saves. | Keep key-only terminalization WAL-backed; rebuild/repair derived state separately. |
| retryCoordinatorFailedItems | Retries selected failed items through `mutateCoordinatorProjection({kind: 'retryFailedItems'})`. | ordinaryMutation | Wrapper schedules repair and only starts reconcile after the operation helper returns durable selected rows. | Keep wrapper thin; row reset is WAL-backed and executor startup remains after durability. |
| mutateCoordinatorFailedItemsRetry | Applies manual failed retry selection, including resolver key moves, through queue-WAL set/remove records. | ordinaryMutation | Queue row reset is WAL-backed; runs/events/progress remain derived compatibility saves. | Keep retry terminal-to-queued WAL records explicit with `allowTerminalOverwrite`; repair derived state separately. |
| requeueCoordinatorFailedItems | Manually requeues selected failed items through `mutateCoordinatorProjection({kind: 'requeueFailedItems'})`. | ordinaryMutation | Wrapper schedules repair and only starts reconcile after the operation helper returns durable selected rows. | Keep wrapper thin; row reset is WAL-backed and executor startup remains after durability. |
| mutateCoordinatorFailedItemsRequeue | Applies manual failed requeue selection, including resolver key moves, through queue-WAL set/remove records. | ordinaryMutation | Queue row reset is WAL-backed; runs/events/progress remain derived compatibility saves. | Keep requeue terminal-to-queued WAL records explicit with `allowTerminalOverwrite`; repair derived state separately. |
| enqueueCoordinatorItemsStorageLocked | Enqueues/merges new coordinator work. | ordinaryMutation | Primary hot enqueue path rewrites queue/runs/events/progress. | First ordinary mutation target after guardrails. |
| normalizeProfileNukeProgressStorage | Normalizes legacy progress snapshot. | compatibilityFlush | Compatibility mirror full rewrite on startup. | Delete or restrict to one-time migration/diagnostic repair. |
| persistProfileNukeProgressLocked | Flushes in-memory profile progress map. | compatibilityFlush | Legacy full progress snapshot writer. | Replace milestone/terminal writes with authority operation/WAL append. |
| saveCoordinatorQueueProjection | Saves the queue-only projection for action-lease operation helpers. | ordinaryMutation | Centralizes queue-only snapshot writes, but still writes the full queue map. | Replace with row-level/WAL operation writes. |
| saveCoordinatorQueueRunsProjection | Saves the queue/runs projection for active transition, rollback, and stale retry advancement. | ordinaryMutation/repair | Centralizes queue/runs snapshot writes, but still writes full queue/runs maps. | Replace with reducer/WAL operation writes. |
| persist | Persists the resident coordinator authority projection after a canonical row mutation applies. | ordinaryMutation | First resident authority boundary still writes the full snapshot backend. | Swap the backend under this method to WAL/row storage after boundary tests and metrics prove parity. |
| mutateCoordinatorActionLeaseRequest | Grants or rejects action leases through `mutateCoordinatorProjection({kind: 'requestActionLease'})`. | ordinaryMutation | Lease grant is WAL-backed; rejected requests do not write opportunistic expired-lease cleanup. | Keep lease arbitration row-local; leave broad expired-lease cleanup to explicit repair. |
| mutateCoordinatorActionLeaseHeartbeat | Refreshes active action lease through `mutateCoordinatorProjection({kind: 'heartbeatActionLease'})`. | ordinaryMutation | Uses a queue-only projection read, but still rewrites the full queue snapshot. | Convert the operation implementation to row-level/WAL append. |
| mutateCoordinatorActionLeaseRelease | Releases a held action lease through `mutateCoordinatorProjection({kind: 'releaseActionLease'})`. | ordinaryMutation | Uses a queue-only projection read, but still rewrites the full queue snapshot. | Convert the operation implementation to row-level/WAL append. |
| mutateCoordinatorActionLeasesForTabRelease | Releases leases for a closing tab through `mutateCoordinatorProjection({kind: 'releaseActionLeasesForTab'})`. | ordinaryMutation | Matching lease rows are released through per-row WAL appends; stale raw terminal rows do not authorize cleanup. | Keep as tab-scoped cleanup with per-row authority guards. |
| mutateCoordinatorStaleRetryQueuedTabAdvance | Applies the projection operation behind `advanceStaleRetryQueuedTab`. | ordinaryMutation | Queue row retry advancement is WAL-backed; runs remain a derived compatibility save. | Keep row retry WAL-backed and leave broader retry/requeue snapshot-backed until reviewed. |
| advanceCoordinatorQueueForStaleRetryAction | Advances stale queued-tab retry attempt. | ordinaryMutation | Uses WAL-backed row mutation through `mutateCoordinatorStaleRetryQueuedTabAdvance`; runtime action requeue remains a follow-up side effect. | Keep as the narrow stale-tab retry operation; do not generalize to manual retry/requeue without review. |
| markQueuedProfileResolutionUnresolved | Terminalizes unresolved profile-resolution item. | ordinaryMutation | Resolver row terminalization is WAL-backed; runs/events/pending-post cleanup remain derived compatibility saves with repair fallback. | Keep resolver-unresolved WAL-backed; resolver remap remains snapshot-backed because it can move between source/destination rows. |
| applyCoordinatorRowEvents | Applies event-shaped nonterminal queued progress milestones. | ordinaryMutation | First row-event boundary still saves snapshot maps for compatibility. | Reuse this event shape for shadow WAL, then stop full snapshot writes for accepted nonterminal events. |
| recordCoordinatorJobProgressRecords | Records job progress, transitions queue, and writes progress mirror. | ordinaryMutation | Primary hot progress writer rewrites queue/runs/progress. | First high-frequency conversion target after helper boundary. |
| scheduleTerminalProgressCompatibilitySave | Persists deferred runs/progress compatibility snapshots after terminal queue authority acknowledgement. | ordinaryMutation | Follow-up snapshot write no longer gates terminal row acknowledgement. | Replace with compact projection/compatibility flush once terminal authority is row-level or WAL-backed. |

## Snapshot And Projection Load Call Sites

| Function | Operation | Authority Reason | Current Risk | Intended Disposition |
| --- | --- | --- | --- | --- |
| syncCoordinatorProgressRecordsLocked | Loads queue/runs/progress to apply compatibility progress records. | compatibilityFlush | Progress mirror can feed queue authority. | Quarantine/remove after reducer operation path exists. |
| repairCoordinatorStorageFromProgressLocked | Loads all coordinator maps plus pending posts for repair. | repair | Broad repair can mask stale authority. | Keep only explicit, test-covered repair operations. |
| confirmQueuedTabDurablyActive | Loads queue through `loadCoordinatorQueueProjection()` to validate durable active state. | displayRead | Full-state load removed; read-only validation is acceptable. | Keep as read-only projection helper. |
| transitionCoordinatorItemForQueuedTabLocked | Loads queue/runs through `loadCoordinatorQueueRunsProjection()` for queued tab active transition. | ordinaryMutation | WAL-recovered projection read with WAL-backed row write; derived run save can lag durable queue authority. | Keep scheduler/resume tests on current-authority reads until raw snapshot compatibility is deleted. |
| rollbackFailedQueuedTabOpen | Loads queue/runs through `loadCoordinatorQueueRunsProjection()` for active transition rollback. | repair | WAL-recovered projection read with WAL-backed row rollback; derived run save can lag durable queue authority. | Keep as explicit repair operation with current-authority tests. |
| requeueDurableActiveCoordinatorItemWithoutActor | Loads queue/runs/progress to reclaim an active row with no confirmed runtime actor. | repair | WAL-recovered current authority read with WAL-backed row repair; progress/runs remain derived compatibility saves. | Keep row repair WAL-backed and live-tab cleanup side effects outside queue authority. |
| mutateCoordinatorActiveNonProfileLandingTerminalize | Loads queue/runs/progress to terminalize an active profile row that landed on a non-profile Quora URL before action-phase progress. | repair | Full snapshot read/write for a single-row terminal repair. | Convert to row-level/WAL terminal repair operation. |
| mutateCoordinatorRunsPausedSet | Loads queue/runs before run pause update through `mutateCoordinatorProjection({kind: 'setCoordinatorRunsPaused'})`. | ordinaryMutation | Full read precedes small runs write. | Narrow to run metadata helper. |
| mutateCoordinatorStoredWorkPause | Loads WAL-recovered coordinator state for `mutateCoordinatorProjection({kind: 'pauseStoredWork'})`. | ordinaryMutation | Active row requeue is durable through queue WAL; derived run pause metadata and progress resets can lag until repair. | Keep batch WAL append for operator pause and do not reuse it for retry/requeue key moves without review. |
| mutateCoordinatorStoredWorkCancel | Loads WAL-recovered coordinator state for `mutateCoordinatorProjection({kind: 'cancelStoredWork'})`. | ordinaryMutation | Bulk terminal rows are durable through a queue-WAL batch append; derived runs/events/progress can lag until repair. | Keep batch WAL append for operator cancel and do not reuse it for retry/requeue key moves without review. |
| mutateCoordinatorStoredWorkItemCancel | Loads current authority state for `mutateCoordinatorProjection({kind: 'cancelStoredWorkItem'})` and writes derived runs/events/progress after the WAL row terminalization. | ordinaryMutation | Derived compatibility saves can lag the durable queue row. | Keep repair/rebuild coverage around derived state separately. |
| mutateCoordinatorKeyOnlyItemTerminalize | Loads queue/runs/events for key-only terminal repair through `mutateCoordinatorProjection({kind: 'terminalizeKeyOnlyCoordinatorItem'})`. | repair | WAL-backed row terminalization; events/runs remain derived compatibility saves. | Keep as explicit repair reducer event and rebuild missing derived state separately. |
| retryCoordinatorFailedItems | Delegates retry selection to `mutateCoordinatorProjection({kind: 'retryFailedItems'})`. | ordinaryMutation | Wrapper no longer loads full state; reconcile remains a post-durable side effect. | Keep wrapper thin and executor startup after durable WAL append. |
| mutateCoordinatorFailedItemsRetry | Loads WAL-recovered coordinator state for manual retry selection and derived runs/events/progress updates. | ordinaryMutation | Queue reset can move keys and is durable through queue-WAL set/remove records; derived state can lag until repair. | Keep key-moving retry covered by WAL remove regression tests. |
| requeueCoordinatorFailedItems | Delegates manual requeue selection to `mutateCoordinatorProjection({kind: 'requeueFailedItems'})`. | ordinaryMutation | Wrapper no longer loads full state; reconcile remains a post-durable side effect. | Keep wrapper thin and executor startup after durable WAL append. |
| mutateCoordinatorFailedItemsRequeue | Loads WAL-recovered coordinator state for manual requeue selection and derived runs/events/progress updates. | ordinaryMutation | Queue reset can move keys and is durable through queue-WAL set/remove records; derived state can lag until repair. | Keep key-moving requeue covered by WAL failure tests. |
| enqueueCoordinatorItemsStorageLocked | Loads queue/runs/events/progress for enqueue/merge. | ordinaryMutation | Hot enqueue full read. | Convert to authority helper/WAL projection. |
| mutateCoordinatorActionLeaseRequest | Loads queue through `loadCoordinatorQueueProjection()` for lease grant/reject operation. | ordinaryMutation | WAL-recovered projection read with WAL-backed row grant; rejected requests are read-only except stale-attempt diagnostics. | Keep the active-lease arbitration read narrow and current-authority backed. |
| mutateCoordinatorActionLeaseHeartbeat | Loads queue through `loadCoordinatorQueueProjection()` for lease heartbeat operation. | ordinaryMutation | Full-state load removed; still scans queue and rewrites full queue snapshot. | Convert to row-level/WAL operation. |
| mutateCoordinatorActionLeaseRelease | Loads queue through `loadCoordinatorQueueProjection()` for lease release operation. | ordinaryMutation | Full-state load removed; still scans queue and rewrites full queue snapshot. | Convert to row-level/WAL operation. |
| mutateCoordinatorActionLeasesForTabRelease | Loads queue through `loadCoordinatorQueueProjection()` for tab lease release operation. | ordinaryMutation | WAL-recovered projection read with per-row WAL release for matching tab leases. | Keep tab cleanup best-effort and row-authority guarded. |
| advanceCoordinatorQueueForStaleRetryAction | Loads queue/runs through `loadCoordinatorQueueRunsProjection()` to advance stale retry attempt. | ordinaryMutation | WAL-backed row retry advancement; runs remain a derived compatibility save. | Keep as the narrow stale-tab retry operation; do not generalize to manual retry/requeue without review. |
| markQueuedProfileResolutionUnresolved | Loads WAL-recovered queue/runs plus events/pending posts for derived compatibility state. | ordinaryMutation | Resolver row terminalization is WAL-backed; derived source-post cleanup can lag until repair if its compatibility save fails. | Keep terminal row authority in WAL and keep repair coverage for resolver-pending cleanup. |
| applyCoordinatorRowEvents | Loads queue/runs only for nonterminal queued progress row events. | ordinaryMutation | Removes hot-path full progress read, but still needs full queue/runs until row storage/WAL exists. | Use as the WAL event API for nonterminal progress milestones. |
| recordCoordinatorJobProgressRecords | Loads queue/runs/progress for job milestones and terminal progress. | ordinaryMutation | Hot progress full read/write. | Convert first after metrics baseline. |

## Direct Storage Paths Touching Authority Keys

| Function/File | Keys | Operation | Classification | Disposition |
| --- | --- | --- | --- | --- |
| createChromeLocalStorageAdapter / coordinatorStorageAdapter in shared/js/sw.js | Production chrome.storage.local adapter. | Thin adapter seam for service-worker persistence. | ordinaryMutation | Keep as the Phase 0 storage boundary; extend later for WAL/checkpoint operations. |
| metricStorageGet / metricStorageSet in shared/js/sw.js | Wrapper for all service-worker local storage reads/writes. | Metrics wrapper using the production adapter. | ordinaryMutation | Keep wrapper until authority helpers replace broad snapshot reads/writes. |
| loadCoordinatorQueueProjection in shared/js/sw.js | mbCoordinatorQueue | Queue-only projection read for action-lease operations and durable active validation. | ordinaryMutation/displayRead | Keep as the narrow read helper until row-level/WAL operation reads replace full queue scans. |
| loadCoordinatorQueueRunsProjection in shared/js/sw.js | mbCoordinatorQueue, mbCoordinatorRuns | Queue/runs projection read for active transition, rollback, and stale retry advancement. | ordinaryMutation/repair | Keep as the narrow read helper until reducer/WAL operation reads replace full map scans. |
| getCoordinatorQueueAccounting | mbCoordinatorQueue, mbCoordinatorQueueWal, mbCoordinatorQueueView | Read-only audit comparing raw snapshot, WAL-recovered queue authority, stored compact view, and rebuilt compact view counts. | displayRead | Keep as an invariant/diagnostic helper; do not let it refresh or repair authority state. |
| flushPendingCoordinatorDiagnosticEvents | mbCoordinatorEvents | Flushes queued diagnostic events outside a primary save. | repair | Keep reason-tagged; later route through event append/helper. |
| settleTerminalCoordinatorItemsLocked | mbCoordinatorQueue, mbProfileNukeProgress, pending/nuked post maps | Settles terminal coordinator rows and compatibility/user-memory maps. | ordinaryMutation | Split authority terminal settlement from user-memory cleanup. |
| rememberCoordinatorTabId | mbCoordinatorTabId | Stores dashboard/coordinator tab id. | userMemoryNonAuthority | Keep out of queue/progress authority. |
| restoreLatestCoordinatorPauseGenerationIfStale | mbCoordinatorPaused, mbCoordinatorPauseGeneration | Repairs pause generation. | ordinaryMutation | Keep as pause-state helper, not queue authority. |
| scheduleCoordinatorPauseStateRepair | mbCoordinatorPaused, mbCoordinatorPauseGeneration | Async pause-generation repair. | repair | Keep reason-tagged; narrow with pause-state adapter. |
| pauseCoordinatorNukes | mbCoordinatorPaused, mbCoordinatorPauseGeneration | User pause state. | ordinaryMutation | Keep as pause-state helper. |
| resumePausedCoordinatorNukes | mbCoordinatorPaused, mbCoordinatorPauseGeneration | User resume state. | ordinaryMutation | Keep as pause-state helper. |
| cancelCoordinatorCurrentWork | mbCoordinatorPaused, mbCoordinatorPauseGeneration | Clears pause state after cancel. | ordinaryMutation | Keep as pause-state helper. |
| pauseStoredCoordinatorWork | mbCoordinatorPaused, mbCoordinatorPauseGeneration | Writes pause flag inside serialized pause path. | ordinaryMutation | Keep as pause-state helper. |
| enqueueCoordinatorItems | mbCoordinatorPaused, mbCoordinatorPauseGeneration | Clears pause flag when execute request arrives. | ordinaryMutation | Keep as pause-state helper. |
| clearProfileNukeState | mbProfileNukeProgress, mbCoordinatorQueue, mbCoordinatorRuns, pending/nuked post maps | User clears a profile's stored state. | ordinaryMutation | Split authority deletion from user-memory cleanup. |
| removePendingSpaceFeedUrls | mbSpacePendingNukedPosts | User-memory pending post cleanup. | userMemoryNonAuthority | Keep outside coordinator authority. |
| removePendingSpaceFeedEntries | mbSpacePendingNukedPosts | User-memory pending post cleanup. | userMemoryNonAuthority | Keep outside coordinator authority. |
| confirmSpaceFeedProfilesBlocked | pending/nuked post maps | User-memory confirmation; separately syncs coordinator progress. | userMemoryNonAuthority | Keep user-memory write separate from coordinator sync. |
| persistOwnedTabIdsByParent | mbOwnedTabState | Runtime ownership cache. | userMemoryNonAuthority | Keep out of queue/progress authority. |
| markQueuedProfileResolved | mbCoordinatorQueue, mbCoordinatorRuns, mbSpacePendingNukedPosts | Resolves profile-resolution row. | ordinaryMutation | Convert to reducer operation with pending cleanup split. |
| recoverPendingTabActionFromCoordinatorQueue | mbCoordinatorQueue | Read-only recovery of pending tab metadata. | displayRead | Keep read-only; use projection read helper later. |
| validateProgressAttempt | mbCoordinatorQueue | Read-only stale-attempt validation. | displayRead | Keep read-only; use projection read helper later. |
| shared/js/coordinator.js loadCoordinatorState | mbCoordinatorQueue, mbCoordinatorRuns, mbCoordinatorEvents, retry/pause flags | Dashboard read. | displayRead | Keep read-only; no authority mutation. |
| shared/js/coordinator.js clearEvents | mbCoordinatorEvents | Dashboard clears display events. | ordinaryMutation | Keep separate from queue/progress authority. |
| shared/js/coordinator.js retry toggle | mbCoordinatorRetryFailedEnabled | Dashboard preference. | userMemoryNonAuthority | Keep outside queue/progress authority. |

## Content And Popup Storage Paths

| Function/File | Keys | Operation | Classification | Disposition |
| --- | --- | --- | --- | --- |
| shared/js/content.js safeStorageGet for mbCoordinatorQueue | mbCoordinatorQueue | Read local queue copy to avoid duplicate/current work. | displayRead | Keep read-only until service-worker projection read helper replaces it. |
| shared/js/content.js recordProfileNukeProgress | mbProfileNukeProgress fallback path through service worker. | compatibilityFlush | Content no longer writes queued authority directly, but compatibility progress still exists. | Delete or quarantine after job-progress operation is authoritative. |
| shared/js/content.js safeStorageSet for mbSpaceNukedPosts / mbSpacePendingNukedPosts / mbSpaceRegistry | user-memory keys | User-memory and pending-feed state. | userMemoryNonAuthority | Keep separate from coordinator authority. |
| shared/js/popup.js direct storage sets | settings, nuked posts, registry, sort | Popup settings/user-memory writes. | userMemoryNonAuthority | Keep separate from coordinator authority. |

## Compatibility Delete / Keep / Quarantine Table

| Path | Current Authority Surface | Disposition | Owner/Risk | Removal Condition |
| --- | --- | --- | --- | --- |
| syncCoordinatorProgressRecordsLocked | Can derive queue/runs updates from progress records. | quarantineReadOnlyDisplayFallback | High risk: mirror can become second terminal authority. | Replace with reducer/WAL reconciliation and forbid progress-derived terminal queue mutation. |
| repairCoordinatorStorageFromProgressLocked | Can repair queue/progress/events from compatibility progress. | convertToServiceWorkerAuthority | High risk: broad repair masks stale overwrites. | Each repair has explicit operation kind and test. |
| normalizeProfileNukeProgressStorage | Rewrites full progress mirror on startup. | quarantineReadOnlyDisplayFallback | Medium risk: startup compatibility flush. | One-time migration or projection read path exists. |
| persistProfileNukeProgressLocked | Flushes whole progress mirror. | convertToServiceWorkerAuthority | High risk: hot full progress writer. | Progress milestones and terminals use authority helper/WAL append. |
| recordProfileNukeProgressFromRequest compatibility branch | Accepts compatibility progress requests. | convertToServiceWorkerAuthority | High risk if queued work can be terminalized by compatibility mirror. | All queued progress uses job-progress reducer operation. |
| recordProfileNukeProgressBatchFromRequest | Batch compatibility progress writer. | convertToServiceWorkerAuthority | High risk: batch can cause large progress rewrites. | Batch updates become reducer/WAL operation batches. |
| content-side recordProfileNukeProgress fallback | Content falls back through service-worker compatibility request. | quarantineReadOnlyDisplayFallback | Medium risk: content should not own authority mutation. | Message timeout path has no direct durable authority write. |
| recoverPendingTabActionFromCoordinatorQueue | Recovers runtime pending action from durable queue. | keep | Low risk: read-only recovery. | Keep as projection read helper. |
| validateProgressAttempt queue read | Uses durable queue to reject stale attempt progress. | keep | Low risk: read-only validation. | Keep as projection read helper. |
| clearProfileNukeState | User clears progress, queue, runs, pending/nuked post maps. | convertToServiceWorkerAuthority | Medium risk: user action intentionally deletes authority rows. | Split coordinator deletion operation from user-memory cleanup. |

## Guardrails Added In This Slice

- `saveCoordinatorState()` writes must carry a `reason` field from the allowed
  reason set.
- `metricStorageSet()` accepts `snapshotWriteReason` for direct storage writes
  that bypass `saveCoordinatorState()`.
- Service-worker local storage access is routed through
  `coordinatorStorageAdapter`, leaving `browser.storage.local` isolated inside
  the adapter factory.
- Action-lease operation bodies use `loadCoordinatorQueueProjection()` instead
  of `loadCoordinatorState()`, preventing accidental runs/events/progress reads
  on the lease path.
- Queued-tab active transition enters through
  `mutateCoordinatorProjection({kind: 'transitionQueuedTabActive'})`, keeping
  that hot mutation behind the explicit operation dispatcher.
- Active transition, rollback, and stale retry advancement save queue/runs
  snapshots through `saveCoordinatorQueueRunsProjection()` rather than calling
  `saveCoordinatorState()` directly.
- `test/p1-contract.test.js` checks that every `saveCoordinatorState()` call is
  reason-tagged and listed in this inventory.
