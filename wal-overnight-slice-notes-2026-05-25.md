# WAL Overnight Slice Notes - 2026-05-25

Status: resumed after Slice 15. The overnight slice closed at version
`1.6.550`; normal review-and-plan cadence resumed before Slice 16. Do not
migrate enqueue, claim/open, retry/requeue, bulk pause/cancel, resolver
remap/unresolved, or cross-row cleanup directly to WAL without a fresh
review/planning pass.

Current gate: broad WAL migration remains paused after Slice 17 pending review.
Version `1.6.556` fixed the asset-space target-resolution correctness gate by
rejecting prose-contaminated profile slugs from text and post-URL artifact
extraction. Version `1.6.557` adds a read-only queue accounting audit so raw
snapshot drift, WAL-recovered authority, and compact dashboard projection counts
can be compared before migrating additional mutation paths. Storage-timeout
pressure remains a separate performance/reliability follow-up.

## Slice 1: action lease heartbeat/release

- Operation migrated: `action-lease-heartbeat` and single-row `action-lease-release` were added to `COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS`.
- Authority boundary: `mutateCoordinatorActionLeaseHeartbeat()` and `mutateCoordinatorActionLeaseRelease()` now load current authority state and call `coordinatorAuthority.applyWithinStorageUpdate()`. The mutators validate the row lease holder, row attempt id/number, terminal status for heartbeat, and own-lease expiry before mutation.
- Persistence boundary: queue WAL append is the durable queue acknowledgement. Compact queue projection failure records repair diagnostics and does not poison the lease heartbeat/release acknowledgement. WAL append failure rejects the mutation.
- Still snapshot-backed: lease request/grant remains snapshot-backed because it performs cross-row lease arbitration. `releaseActionLeasesForTab` remains snapshot-backed because it is batch/cross-row. Expired unrelated lease cleanup was removed from heartbeat/release and remains with the snapshot-backed paths.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, and `node test/swSynthetic.test.js` passed.

## Slice 2: non-profile landing terminal repair boundary

- Operation migrated: no new WAL operation. `terminalizeActiveNonProfileLanding` remains snapshot-backed but its queue-row terminalization now goes through `coordinatorAuthority.applyWithinStorageUpdate()` as `repair-non-profile-landing`.
- Authority boundary: the repair loads current authority state, validates active row, expected attempt id/number, progress attempt compatibility, and non-profile landing evidence before applying the terminal row. The authority mutator rejects row changes before save.
- Persistence boundary: snapshot persistence remains the durable queue boundary for this repair slice. Runs/progress repair is derived follow-up with `queue: false`; derived save failure records `repair.nonProfileLanding.derivedSaveFailed`, schedules repair, and does not poison the already-durable queue terminalization.
- Still snapshot-backed: `repair-non-profile-landing` is not in `COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS`. It should get review before WAL migration because it also repairs progress/runs and is invoked from reconcile/tab-cleanup paths.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node test/swSynthetic.test.js`, `node test/p1-contract.test.js`, and `node test/walSnapshotStore.test.js` passed.

## Stop Inventory

- Current WAL-migrated queue operations: `terminal-progress`, `row-event-progress-milestone`, `terminal-settlement`, `action-lease-heartbeat`, and `action-lease-release`.
- Reviewed but not migrated: `repair-non-profile-landing` now has an authority boundary but remains snapshot-backed pending review.
- Not safe for overnight migration without review: enqueue, claim/open/active transition, rollback active transition, stale retry/requeue, pause/cancel, resolver remap/unresolved, release-by-tab, and active-without-runtime-actor reconcile. These have cross-row, ownership, scheduler, runtime-tab, or batch side effects outside a simple row-local attempt-guarded mutation.

## Slice 3: action lease release failure shape

- Operation migrated: no new WAL operation. This is a cleanup on the already WAL-backed `action-lease-release` path.
- Authority boundary: unchanged. Pre-authority release rejection now returns explicit reasons for `missing-coordinator-item`, `missing-action-lease`, `expired-action-lease`, and `action-lease-holder-mismatch`.
- Persistence boundary: unchanged; no WAL append or snapshot write occurs for these pre-authority rejections.
- Still snapshot-backed: no additional operations changed.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node test/swSynthetic.test.js`, `node test/p1-contract.test.js`, and `node test/walSnapshotStore.test.js` passed.

## Slice 4: non-profile landing terminal repair WAL migration

- Operation migrated: `repair-non-profile-landing` was added to `COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS`.
- Authority boundary: unchanged from Slice 2. The repair is still a single-row active-to-terminal mutation with expected attempt id/number checks, current-row revalidation inside `coordinatorAuthority.applyWithinStorageUpdate()`, and non-profile landing evidence checked before mutation.
- Persistence boundary: queue WAL append is now the durable queue acknowledgement for the terminal row. Compact queue projection failure records repair diagnostics and does not poison the acknowledgement. WAL append failure leaves the stored snapshot active and rejects the mutation.
- Still snapshot-backed: progress/runs compatibility repair remains a derived `saveCoordinatorState({runs, progress}, {queue: false, reason: 'repair'})` follow-up. Reconcile discovery, tab cleanup, and broader active-without-runtime-actor repair remain snapshot-backed and are not migrated.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node test/swSynthetic.test.js`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, and `npm test` passed.

## Slice 5: key-only resolver terminal repair boundary

- Operation migrated: no new WAL operation. `terminalizeKeyOnlyCoordinatorItem` remains snapshot-backed but its queue-row terminalization now goes through `coordinatorAuthority.applyWithinStorageUpdate()` as `repair-key-only-terminalize`.
- Authority boundary: the repair validates the resolver/key-only row, rejects terminal or profile-href rows, accepts optional expected attempt id/number, and revalidates the current row inside the authority mutation before terminalizing it.
- Persistence boundary: snapshot persistence remains the durable queue boundary. Run recompute and coordinator event append are derived follow-up with `queue: false`; derived save failure records `repair.keyOnlyTerminalize.derivedSaveFailed`, schedules repair, and does not poison the durable queue terminalization.
- Still snapshot-backed: `repair-key-only-terminalize` is not in `COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS`. Resolver remap/unresolved paths remain snapshot-backed and should not be WAL-migrated without review.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node test/swSynthetic.test.js`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, and `npm test` passed.

## Slice 6: current authority readers and queued-tab gate stabilization

- Operation migrated: no new WAL operation. This slice closes raw-snapshot reader gaps around WAL-terminal rows and stabilizes the queued-tab open gate after the Polypunter unblock change.
- Authority boundary: executor/reconcile planning now passes and reads the current authority state/projection instead of reinterpreting stale raw `mbCoordinatorQueue`. Open-decision helpers can reuse caller-supplied current authority state so batched executor planning does not drift back to raw snapshots.
- Persistence boundary: queued-tab durable active transition and Current Work progress are acknowledged before content-script ensure/nudge follow-up. Content-script injection remains follow-up work and does not define queue durability.
- Still snapshot-backed: enqueue, claim/open ownership, retry/requeue, pause/cancel, resolver remap/unresolved, and key-only terminal repair WAL migration remain deferred for review.
- Validation: `node -c shared/js/sw.js`, `node -c test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, `node test/swSynthetic.test.js`, and `npm test` passed. Version bumped to `1.6.543`; `npm run prod`, `npm run build:chrome`, and `npm run build:firefox` produced local zip artifacts.

## Slice 7: preplanned queued-tab final authority validation

- Operation migrated: no new WAL operation. This slice closes the stale-authority window for already planned queued-tab open actions.
- Authority boundary: `fillQueuedTabsOnce()` now revalidates every action against current authority immediately before `createOwnedTab()`, including actions already marked `executorPlanKind: 'open-tab'`. A terminal/missing/stale current-authority decision skips the action before any tab/focus side effect.
- Persistence boundary: unchanged. This is a pre-side-effect guard; no WAL append or snapshot write occurs when the final open check rejects a stale planned action.
- Still snapshot-backed: enqueue, claim/open ownership, retry/requeue, pause/cancel, resolver remap/unresolved, and key-only terminal repair WAL migration remain deferred for review.
- Validation: `node -c shared/js/sw.js`, `node -c test/p1-contract.test.js`, `node -c test/swSynthetic.test.js`, `node test/p1-contract.test.js`, `node test/swSynthetic.test.js`, `node test/walSnapshotStore.test.js`, and `npm test` passed. Version bumped to `1.6.544` before rebuild.

## Slice 8: key-only resolver terminal repair WAL migration

- Operation migrated: `repair-key-only-terminalize` was added to `COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS`.
- Authority boundary: unchanged from Slice 5. The mutation remains a single resolver/key-only row terminalization behind `coordinatorAuthority.applyWithinStorageUpdate()`, rejects terminal/profile-href rows, accepts optional expected attempt id/number, and revalidates the current row before applying the terminal item.
- Persistence boundary: queue WAL append is now the durable queue acknowledgement. Compact queue projection failure records repair diagnostics and does not poison the acknowledgement. WAL append failure leaves the stored snapshot active and rejects the mutation.
- Still snapshot-backed: run recompute and coordinator event append remain derived `saveCoordinatorState({runs, events}, {queue: false, reason: 'repair'})` follow-up work. The repair lane can rebuild missing key-only terminal derived state from the WAL-projected queue. Resolver remap/unresolved paths remain snapshot-backed and should not be WAL-migrated without review.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, `node test/swSynthetic.test.js`, and `npm test` passed. Version bumped to `1.6.545` before rebuild.

## Slice 9: active-without-runtime reconcile authority-state guard

- Operation migrated: no new WAL operation. `reconcileActiveWithoutRuntimeActor` remains snapshot-backed because it creates a fresh attempt and is retry/requeue-like.
- Authority boundary: the active-without-runtime repair now explicitly loads `loadCoordinatorCurrentAuthorityState()` before deciding whether the row is still active. A stale raw `mbCoordinatorQueue` row cannot drive requeue when current authority has already terminalized the row through WAL.
- Persistence boundary: unchanged. Snapshot persistence remains the durable boundary for this repair path; no WAL append is introduced in this slice.
- Still snapshot-backed: active-without-runtime requeue, enqueue, claim/open ownership, retry/requeue, pause/cancel, and resolver remap/unresolved remain deferred for review.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, `node test/swSynthetic.test.js`, and `npm test` passed. Version bumped to `1.6.546` before rebuild.

## Slice 10: tab-wide action lease release authority-state guard

- Operation migrated: no new WAL operation. `releaseActionLeasesForTab` remains snapshot-backed because it is a cross-row cleanup tied to tab slot release.
- Authority boundary: the tab-wide lease release now names its WAL-recovered queue load as `currentAuthorityState` and attributes the read to `actionLease.tabRelease.load`. The regression covers a stale raw active row with an action lease while current authority is WAL-terminal with no lease; tab-wide release must not rewrite the raw lease row or append another queue WAL record.
- Persistence boundary: unchanged. Snapshot queue projection persistence remains the durability boundary for tab-wide lease cleanup; terminal WAL remains authoritative when the row is already terminal.
- Still snapshot-backed: tab-wide lease release, active-without-runtime requeue, enqueue, claim/open ownership, retry/requeue, pause/cancel, and resolver remap/unresolved remain deferred for review.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, `node test/swSynthetic.test.js`, and `npm test` passed. Version bumped to `1.6.547` before rebuild.

## Slice 11: dashboard queue-view authority-read audit

- Operation migrated: no new WAL operation. This is a read-side audit slice.
- Authority boundary: `refreshCoordinatorQueueViewForDashboard()` now builds the compact dashboard queue view from the WAL-recovered current queue projection instead of the raw queue snapshot.
- Persistence boundary: unchanged. Only the compact dashboard view is rewritten; queue durability remains with the existing queue authority/WAL or snapshot paths.
- Still snapshot-backed: no queue mutation moved. Enqueue, claim/open ownership, retry/requeue, pause/cancel, resolver remap/unresolved, and cross-row cleanup remain review-gated.
- Validation: covered by `dashboard queue view refresh uses WAL terminal authority over stale raw queue`; `node -c`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, `node test/swSynthetic.test.js`, and `npm test` passed.

## Slice 12: source-page owned-status and terminal-tab cleanup authority-read audit

- Operation migrated: no new WAL operation. This is a read-side audit slice.
- Authority boundary: source-page owned status now counts run work from the WAL-recovered current queue projection, and terminal owned-tab cleanup uses current authority queue/progress instead of raw queue/progress storage.
- Persistence boundary: unchanged. Owned-status remains read-only; terminal-tab cleanup still delegates durable slot cleanup to existing release paths.
- Still snapshot-backed: no queue mutation moved. Runtime ownership and tab cleanup remain review-gated for WAL migration.
- Validation: covered by `source-page run status ignores WAL-terminal row over stale raw active queue`; `node -c`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, `node test/swSynthetic.test.js`, and `npm test` passed.

## Slice 13: volatile queued-action and progress-attempt reader audit

- Operation migrated: no new WAL operation. This is a read-side audit slice.
- Authority boundary: volatile queued-action pruning, pending tab-action recovery, stored progress sync filtering, and progress-attempt validation now use WAL-recovered current queue projection reads instead of raw queue reads.
- Persistence boundary: unchanged. These paths only decide whether to drop/recover volatile actions or accept progress; durable queue mutation remains in existing authority paths.
- Still snapshot-backed: no queue mutation moved. Enqueue, claim/open ownership, retry/requeue, pause/cancel, resolver remap/unresolved, and active-without-runtime requeue remain review-gated.
- Validation: covered by `volatile action pruning uses WAL terminal authority over stale raw active queue`; `node -c`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, `node test/swSynthetic.test.js`, and `npm test` passed.

## Slice 14: resolver/content/terminal-progress authority-read audit

- Operation migrated: no new WAL operation. This is a read-side audit slice over the three remaining raw-reader findings.
- Authority boundary: `resolveQueuedProfileTarget()` now selects/remaps from the WAL-recovered current queue/runs projection and rejects terminal current-authority resolver rows before any remap write. Content-page truncated fallback and missing-projection rebuild now build queue views from the WAL-recovered queue projection. Terminal-progress compatibility save now recomputes derived runs from the WAL-recovered queue/runs projection instead of stale raw queue storage.
- Persistence boundary: unchanged. Resolver remap remains snapshot-backed and review-gated; this slice only prevents stale raw rows from authorizing a remap or derived projection. Content-page rebuild still writes compact content projections, and terminal-progress compatibility save still writes derived runs/progress only.
- Still snapshot-backed: resolver remap/unresolved remains explicitly deferred for review. No enqueue, claim/open ownership, retry/requeue, pause/cancel, or runtime scheduling operation moved to WAL.
- Validation: covered by `late profile resolution cannot remap a WAL-terminal key-only row over stale raw queue`, `content-page projection rebuild uses WAL terminal authority over stale raw active queue`, and `terminal progress compatibility save recomputes runs from WAL authority over stale raw queue`; `node -c`, `node test/p1-contract.test.js`, `node test/walSnapshotStore.test.js`, `node test/swSynthetic.test.js`, and `npm test` passed. Version bumped to `1.6.549` before rebuild.

## Slice 15: reviewer findings closeout

- Operation migrated: no new WAL operation. This slice resolved review findings
  found after Slice 14 and closed the overnight WAL slice.
- Authority boundary: resolver remap now checks the destination row before
  writing `queue[resolvedHref]`. A terminal destination row returns
  `terminal-resolved-coordinator-item`; a destination row with incompatible
  attempt identity returns `resolved-coordinator-conflict`; no-op existing
  success remains compatible. Late unresolved resolver failure now mirrors the
  terminal-source guard and refuses to rewrite a terminal current-authority
  resolver row.
- Status boundary: `get-owned-nuke-status` is read-only by default. It no
  longer schedules stored-work repair or runs terminal-tab cleanup on ordinary
  polling. Cleanup behavior is explicit through `cleanup-owned-nuke-status`.
- Persistence boundary: unchanged for resolver remap/unresolved; both remain
  snapshot-backed and review-gated. This slice prevents stale or conflicting
  writes; it does not make resolver remap/unresolved WAL-backed.
- Still snapshot-backed: enqueue, claim/open ownership, retry/requeue,
  pause/cancel, resolver remap/unresolved, active-without-runtime requeue,
  tab-wide lease release, and other cross-row cleanup remain deferred for a
  future reviewed slice.
- Validation: covered by `late profile resolution cannot overwrite a
  WAL-terminal destination row`, `late profile resolution cannot overwrite a
  newer active destination row`, `late unresolved resolver failure cannot
  regress a WAL-terminal resolver row`, and `source-page run status polling is
  read-only for terminal owned tabs`; `node -c shared/js/sw.js`, `node -c
  test/swSynthetic.test.js`, `node -c test/p1-contract.test.js`, `node
  test/p1-contract.test.js`, `node test/swSynthetic.test.js`, and `npm test`
  passed. Version bumped to `1.6.550`; `npm run prod`, `npm run build:chrome`,
  and `npm run build:firefox` produced `chrome/mute_block-1.6.550.zip` and
  `firefox/mute_block-1.6.550.zip`.

## Slice 16: single current-work item cancel WAL migration

- Operation migrated: targeted `cancel-coordinator-current-work-item` queue-row
  terminalization now uses explicit `cancelStoredWorkItem` projection handling
  and WAL-backed `current-work-item-cancel`.
- Authority boundary: only the selected pending row is eligible. The mutator
  resolves one target by storage key, coordinator key, or profile href; rejects
  missing, ambiguous, terminal, or identity-changing rows; and revalidates the
  current row through `coordinatorAuthority.applyWithinStorageUpdate()` before
  writing the canceled terminal row.
- Persistence boundary: queue-row cancellation is durable when the queue WAL
  append succeeds. Runs/events/progress remain derived follow-up saves with
  `queue: false`; derived-save failure records diagnostics and schedules
  repair without poisoning the already-durable cancel. Bulk `Cancel Queue` and
  pause remain snapshot-backed and review-gated.
- Still snapshot-backed: bulk pause/cancel, enqueue, claim/open ownership,
  retry/requeue, resolver remap/unresolved, active-without-runtime requeue,
  tab-wide lease release, and other cross-row cleanup remain deferred.
- Validation: covered by `single current work cancel WAL-terminalizes only the
  selected pending row`, `single current work cancel WAL append failure leaves
  selected row pending`, and the dashboard per-row cancel contract tests;
  `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c
  test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.555`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.555.zip` and
  `firefox/mute_block-1.6.555.zip`.

## Slice 17: queue accounting projection audit

- Operation migrated: no new WAL operation. This is a read-only accounting and
  observability slice.
- Authority boundary: `get-coordinator-queue-accounting` compares the raw
  `mbCoordinatorQueue` snapshot, WAL-recovered queue authority, stored compact
  `mbCoordinatorQueueView`, and an in-memory rebuilt compact view. Raw snapshot
  drift is reported separately as `rawDivergences`; only WAL recovery failures
  or stored-view-vs-recovered mismatches make the audit inconsistent.
- Persistence boundary: unchanged. The audit does not refresh, repair, or write
  queue authority, queue WAL, or compact queue view state. It exists to explain
  count drops before any further migration of enqueue, claim/open,
  retry/requeue, bulk cancel, resolver remap/unresolved, or cross-row cleanup.
- Still snapshot-backed: no queue mutation moved. Broad migration remains
  review-gated until the accounting audit is reviewed against live 1.6.557
  results.
- Validation: covered by `queue accounting audit explains raw WAL drift without
  writing storage` and `queue accounting audit flags stale compact dashboard
  counts`; `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, and
  `node -c tools/cdp/queue-accounting-audit.js` passed. Version bumped to
  `1.6.557` before release rebuild. Live 1.6.557 CDP accounting audit after
  rsync/reload reported `consistent: true`, 626 raw/recovered/view rows, no raw
  divergences, no view mismatches, and an empty active WAL tail.

## Slice 18: stale queued-tab retry WAL migration

- Operation migrated: `advanceStaleRetryQueuedTab` queue-row mutation now uses
  WAL-backed `stale-retry`.
- Authority boundary: stale-tab retry loads the WAL-recovered queue/runs
  projection, validates source attempt id/number before mutation, and revalidates
  the row through `coordinatorAuthority.applyWithinStorageUpdate()` before
  writing the fresh queued attempt. The mutator rejects terminal/missing rows,
  changed target identity, stale attempts, and reducer rejection before durable
  acknowledgement.
- Persistence boundary: retry row advancement is durable when the queue WAL
  append succeeds. Compact queue/content projections are updated by the WAL
  projection follow-up. Run recompute remains a derived `queue: false`
  compatibility save; derived-save failure records diagnostics and schedules
  repair without poisoning the durable row retry. Runtime tab close/removal and
  volatile queued action re-enqueue remain follow-up side effects.
- Still snapshot-backed: manual retry/requeue, enqueue, claim/open ownership,
  rollback active transition, bulk pause/cancel, resolver remap/unresolved,
  active-without-runtime requeue, tab-wide lease release, and other cross-row
  cleanup remain deferred.
- Validation: covered by `stale queued tab retry gets a fresh attempt identity`,
  `queued profile tab is requeued after the foreground-wait stale timeout
  elapses`, and `loading queued tab becomes queue-load pressure without consuming
  row retry budget`; `node -c shared/js/sw.js`, `node -c
  test/p1-contract.test.js`, `node -c test/swSynthetic.test.js`, `node
  test/p1-contract.test.js`, `node test/swSynthetic.test.js`,
  `SW_SCENARIO_FUZZ_SEED=0x5eed SW_SCENARIO_FUZZ_STEPS=36 node
  test/swScenarioFuzz.test.js`, and `npm test` passed. Version bumped to
  `1.6.558`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.558.zip` and
  `firefox/mute_block-1.6.558.zip`. After the Windows tunnels returned, bounded
  rsync to the unpacked Chrome directory succeeded and CDP reload reported
  extension `1.6.558` enabled with zero manifest/runtime errors. Live queue
  accounting reported `consistent: true`, 528 raw/recovered/view rows, no view
  mismatches, and WAL tail length 2; raw snapshot divergence was isolated to the
  expected stale raw active-vs-WAL-succeeded count. Dashboard sanity showed 162
  ready, 292 succeeded, 0 soft-fail, 47 hard-fail, and 80 per-row cancel
  buttons for 80 displayed rows.

## Slice 19: active-transition rollback WAL migration

- Operation migrated: `rollbackFailedQueuedTabOpen` now applies its queue-row
  repair through WAL-backed `rollback-active-transition`.
- Authority boundary: the rollback path loads the WAL-recovered queue/runs
  projection, validates the attempted row attempt id/number and tab id, then
  revalidates the current row through `coordinatorAuthority.applyWithinStorageUpdate()`
  before returning the row to `queued`. The mutator rejects missing/terminal
  rows, stale attempts, tab changes, and target identity changes before durable
  acknowledgement.
- Persistence boundary: queue-row rollback is durable when the queue WAL append
  succeeds. Compact queue/content projections are updated by the WAL projection
  follow-up. Run recompute remains a derived `queue: false` repair save;
  derived-save failure records diagnostics and schedules repair without
  poisoning the durable rollback.
- Still snapshot-backed: active transition/open ownership, enqueue, manual
  retry/requeue, bulk pause/cancel, resolver remap/unresolved,
  active-without-runtime requeue, tab-wide lease release, and other cross-row
  cleanup remain deferred.
- Validation: covered by `active transition rollback is WAL-backed and recovers
  after restart`, `active transition rollback rejects stale attempt before WAL
  append`, and `active transition rollback WAL append failure leaves row
  active`; `node -c shared/js/sw.js`, `node -c test/p1-contract.test.js`,
  `node -c test/swSynthetic.test.js`, `node test/p1-contract.test.js`, and
  `node test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.559`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.559.zip` and
  `firefox/mute_block-1.6.559.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.559` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 462 raw/recovered/view rows, no raw divergences, no view
  mismatches, and empty active WAL tail. Dashboard sanity showed 100 ready, 283
  succeeded, 0 soft-fail, 56 hard-fail, 1 active, and 80 per-row cancel buttons
  for 80 displayed rows.

## Slice 20: active-without-runtime reconcile WAL migration

- Operation migrated: `requeueDurableActiveCoordinatorItemWithoutActor` now
  applies its queue-row requeue/timeout repair through WAL-backed
  `repair-active-without-actor`.
- Authority boundary: the reconcile path loads the WAL-recovered
  queue/runs/progress projection, validates expected attempt id/number and
  progress compatibility, checks that any persisted tab is stale, then
  revalidates the current row through
  `coordinatorAuthority.applyWithinStorageUpdate()` before assigning a fresh
  queued attempt or terminal timeout. The mutator rejects missing/non-active
  rows, stale attempts, and target identity changes before durable
  acknowledgement.
- Persistence boundary: queue-row requeue/timeout is durable when the queue WAL
  append succeeds. Compact queue/content projections are updated by the WAL
  projection follow-up. Runs/progress recompute remains a derived `queue: false`
  repair save; derived-save failure records diagnostics and schedules repair
  without poisoning the durable row repair.
- Still snapshot-backed: active transition/open ownership, enqueue, manual
  retry/requeue, bulk pause/cancel, resolver remap/unresolved, tab-wide lease
  release, and other cross-row cleanup remain deferred.
- Validation: covered by `authority reconcile requeues durable active row
  without runtime actor through WAL`, `authority reconcile rejects stale
  active-without-actor attempt before WAL append`, `authority reconcile
  active-without-actor WAL append failure leaves row active`, and `authority
  reconcile terminalizes exhausted active-without-actor row through WAL`;
  `node -c shared/js/sw.js`, `node -c test/p1-contract.test.js`, `node -c
  test/swSynthetic.test.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, `SW_SCENARIO_FUZZ_SEED=0x5eed
  SW_SCENARIO_FUZZ_STEPS=36 node test/swScenarioFuzz.test.js`, and `npm test`
  passed. Version bumped to `1.6.560`; `npm run prod`, `npm run
  build:chrome`, and `npm run build:firefox` produced
  `chrome/mute_block-1.6.560.zip` and `firefox/mute_block-1.6.560.zip`.
  Bounded rsync to the unpacked Chrome directory succeeded and CDP reload
  reported extension `1.6.560` enabled with zero manifest/runtime errors. Live
  queue accounting reported `consistent: true`, 456 raw/recovered/view rows, no
  raw divergences, no view mismatches, and empty active WAL tail. Dashboard
  sanity showed 72 ready, 304 succeeded, 8 soft-fail, 49 hard-fail, 0 active,
  and 72 per-row cancel buttons for 80 displayed rows.

## Slice 21: active queued-tab transition WAL migration

- Operation migrated: `transitionCoordinatorItemForQueuedTabLocked` now applies
  queued-tab open/active ownership through WAL-backed `active-transition`.
- Authority boundary: active transition loads the WAL-recovered queue/runs
  projection, validates the queued row, action kind, current metadata, target
  identity, and attempt identity when the stored row already has one, then
  revalidates through `coordinatorAuthority.applyWithinStorageUpdate()` before
  marking the row active/opening. Legacy queued rows without attempt identity
  can still be claimed, but any current row with a different attempt is rejected
  before durable acknowledgement.
- Persistence boundary: queue-row active transition is durable when the queue
  WAL append succeeds. Compact queue/content projections are updated by the WAL
  projection follow-up. Runs recompute remains a derived `queue: false`
  ordinary-mutation save; derived-save failure records diagnostics and
  schedules repair without poisoning the durable active transition. Tests that
  previously polled raw `mbCoordinatorQueue` for active rows now assert current
  authority because the raw snapshot can legitimately remain queued.
- Still snapshot-backed: enqueue, manual retry/requeue, bulk pause/cancel,
  resolver remap/unresolved, action-lease request, tab-wide lease release, and
  other cross-row cleanup remain deferred.
- Validation: covered by `active transition is WAL-backed and recovers after
  restart`, `active transition rejects stale attempt before WAL append`, and
  `active transition WAL append failure leaves row queued`; `node -c
  shared/js/sw.js`, `node -c test/p1-contract.test.js`, `node -c
  test/swSynthetic.test.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.561`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.561.zip` and
  `firefox/mute_block-1.6.561.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.561` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 456 raw/recovered/view rows, no raw divergences, no view
  mismatches, and empty active WAL tail. Dashboard sanity showed 72 ready, 304
  succeeded, 8 soft-fail, 49 hard-fail, 0 active, and 72 per-row cancel buttons
  for 80 displayed rows.

## Slice 21 review closeout: active-transition attempt identity

- Operation migrated: no new WAL operation. This closes the post-1.6.561 review
  finding on the already WAL-backed `active-transition` path.
- Authority boundary: queued-tab active transition now rejects an incoming
  transition that lacks attempt identity whenever the current/stored row has
  attempt identity. The check runs before the WAL append and is mirrored inside
  `coordinatorAuthority.applyWithinStorageUpdate()` so a row that gains attempt
  identity during the serialized update cannot be claimed by an identity-less
  active transition.
- Persistence boundary: unchanged. Accepted active transitions are still durable
  on queue WAL append; rejected missing-identity transitions leave raw snapshot
  and current authority queued and append no WAL record.
- Notes hygiene: `storage-authority-callsite-inventory-2026-05-20.md` was
  updated so active transition, rollback, stale retry, active-without-actor
  repair, and key-only terminalization no longer read as snapshot-backed work.
- Validation: covered by `active transition rejects missing incoming attempt
  identity before WAL append`; `node -c shared/js/sw.js`, `node -c
  test/swSynthetic.test.js`, `node -c test/p1-contract.test.js`, `node
  test/p1-contract.test.js`, `node test/swSynthetic.test.js`, and `npm test`
  passed. Version bumped to `1.6.562`; `npm run prod`, `npm run build:chrome`,
  and `npm run build:firefox` produced `chrome/mute_block-1.6.562.zip` and
  `firefox/mute_block-1.6.562.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.562` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 409 raw/recovered/view rows, no raw divergences, no view
  mismatches, and empty active WAL tail. Dashboard sanity showed 64 ready, 270
  succeeded, 15 soft-fail, 42 hard-fail, 1 active, and 65 per-row cancel
  buttons for 80 displayed rows.

## Slice 22: action-lease request and tab-release WAL migration

- Operation migrated: `requestActionLease` now uses WAL-backed
  `action-lease-request`, and `releaseActionLeasesForTab` now releases matching
  tab lease rows through WAL-backed `action-lease-tab-release` records.
- Authority boundary: lease request loads the WAL-recovered queue projection,
  validates target row, terminal state, stale attempt identity, and active lease
  arbitration before applying a single-row lease grant through
  `coordinatorAuthority.applyWithinStorageUpdate()`. Tab-wide release scans the
  WAL-recovered queue projection, then applies each matching lease release as a
  row-authority mutation with attempt and lease-token revalidation inside the
  serialized update.
- Persistence boundary: accepted lease grants/releases are durable on queue WAL
  append. WAL append failure rejects the grant/release and leaves the raw
  snapshot/current authority unchanged. Rejected request paths no longer write
  opportunistic expired-lease cleanup; expired leases are ignored by active
  lease arbitration and can be handled by explicit repair instead of mixed into
  request/release authority.
- Still snapshot-backed: enqueue, manual retry/requeue, bulk pause/cancel,
  resolver remap/unresolved, action-lease expired-row cleanup, and other
  cross-row cleanup remain deferred.
- Validation: covered by `action lease request is WAL-backed and recovers after
  restart`, `action lease request WAL append failure rejects durable mutation`,
  `action lease tab release is WAL-backed and recovers after restart`, and
  `action lease tab release WAL append failure leaves lease active`; `node -c
  shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c
  test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.563`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.563.zip` and
  `firefox/mute_block-1.6.563.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.563` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 409 raw/recovered/view rows, no raw divergences, no view
  mismatches, and empty active WAL tail. Dashboard sanity showed 64 ready, 270
  succeeded, 15 soft-fail, 42 hard-fail, 1 active, and 65 per-row cancel
  buttons for 80 displayed rows.

## Slice 22 review closeout: action-lease request attempt identity

- Operation migrated: no new WAL operation. This closes the post-1.6.563 review
  finding on the already WAL-backed `action-lease-request` path.
- Authority boundary: action-lease request now distinguishes incoming attempt
  identity from stored row identity. If the current row has attempt id/number
  and the incoming request lacks either value, the request is rejected before
  any WAL append. The same missing-identity guard is mirrored inside the
  serialized `coordinatorAuthority.applyWithinStorageUpdate()` mutator so a row
  that gains attempt identity before the authority apply cannot be claimed by an
  identity-less lease request.
- Persistence boundary: unchanged. Accepted action-lease requests are durable
  on queue WAL append; rejected missing-identity requests leave raw snapshot and
  current authority unchanged and append no WAL record.
- Validation: covered by `action lease request rejects missing incoming attempt
  identity before WAL append`; `node -c shared/js/sw.js`, `node -c
  test/swSynthetic.test.js`, `node -c test/p1-contract.test.js`, `node
  test/p1-contract.test.js`, `node test/swSynthetic.test.js`, and `npm test`
  passed. Version bumped to `1.6.564`; `npm run prod`, `npm run build:chrome`,
  and `npm run build:firefox` produced `chrome/mute_block-1.6.564.zip` and
  `firefox/mute_block-1.6.564.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.564` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 409 raw/recovered/view rows, no view mismatches, and an
  active WAL tail with 31 applied records; raw-vs-recovered count divergence is
  from unapplied-to-raw WAL tail state, not projection inconsistency. Dashboard
  sanity showed 61 ready, 274 succeeded, 19 soft-fail, 38 hard-fail, 0 active,
  and 61 per-row cancel buttons for 80 displayed rows.

## Slice 22 review closeout: active-tab ownership and rollback identity

- Operation migrated: no new WAL operation. This closes the post-1.6.564 review
  findings on the already WAL-backed `action-lease-request` and
  `rollback-active-transition` paths.
- Authority boundary: action-lease request now requires the current row to be
  active and requires the requesting sender tab to match the durable active tab
  (`tabId`/`activeTabId`) before any WAL append. The same active-status and
  active-tab checks are repeated inside the serialized
  `coordinatorAuthority.applyWithinStorageUpdate()` mutator so a queued row or
  wrong-tab request cannot gain a lease after the precheck.
- Rollback boundary: active-transition rollback now treats missing incoming
  attempt identity as stale when the current row already has attempt id/number.
  The guard runs before WAL append and again inside the authority mutator,
  preventing an identity-less rollback from requeuing an active row.
- Persistence boundary: unchanged. Accepted lease requests and rollbacks remain
  durable only on queue WAL append; rejected wrong-tab, inactive-row, and
  missing-identity requests leave raw snapshot/current authority unchanged and
  append no WAL record.
- Validation: covered by `action lease request rejects wrong active tab
  before WAL append`, `action lease request rejects inactive row before WAL
  append`, and `active transition rollback rejects missing incoming attempt
  identity before WAL append`; `node -c shared/js/sw.js`, `node -c
  test/swSynthetic.test.js`, `node -c test/p1-contract.test.js`, `node
  test/p1-contract.test.js`, `node test/swSynthetic.test.js`, and `npm test`
  passed. Version bumped to `1.6.565`; `npm run prod`, `npm run build:chrome`,
  and `npm run build:firefox` produced `chrome/mute_block-1.6.565.zip` and
  `firefox/mute_block-1.6.565.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.565` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 409 recovered/view rows, no view mismatches, and an
  active WAL tail with 26 applied records; raw-vs-recovered count divergence is
  from unapplied-to-raw WAL tail state, not projection inconsistency. Dashboard
  sanity showed 41 ready, 292 succeeded, 39 soft-fail, 19 hard-fail, 0 active,
  and 41 per-row cancel buttons for 80 displayed rows.

## Slice 22 review closeout: rollback active-row requirement

- Operation migrated: no new WAL operation. This closes the post-1.6.565 review
  finding on the already WAL-backed `rollback-active-transition` path.
- Authority boundary: active-transition rollback now requires the current row
  to be active before any WAL append, and repeats the same active-status guard
  inside the serialized `coordinatorAuthority.applyWithinStorageUpdate()`
  mutator. A matching-attempt queued row can no longer append a rollback or
  stamp active-transition close milestones.
- Persistence boundary: unchanged. Accepted rollbacks remain durable only on
  queue WAL append; rejected inactive-row rollbacks leave raw snapshot/current
  authority unchanged and append no WAL record.
- Validation: covered by `active transition rollback rejects queued row
  before WAL append`; `node -c shared/js/sw.js`, `node -c
  test/swSynthetic.test.js`, `node -c test/p1-contract.test.js`, `node
  test/p1-contract.test.js`, `node test/swSynthetic.test.js`, and `npm test`
  passed. Version bumped to `1.6.566`; `npm run prod`, `npm run build:chrome`,
  and `npm run build:firefox` produced `chrome/mute_block-1.6.566.zip` and
  `firefox/mute_block-1.6.566.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.566` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 409 recovered/view rows, no view mismatches, and an
  active WAL tail with 26 applied records; raw-vs-recovered count divergence is
  from unapplied-to-raw WAL tail state, not projection inconsistency. Dashboard
  sanity showed 41 ready, 292 succeeded, 39 soft-fail, 19 hard-fail, 0 active,
  and 41 per-row cancel buttons for 80 displayed rows.

## Slice 23: unresolved resolver WAL migration

- Operation migrated: `resolve-queued-profile-target-failed` now terminalizes
  unresolved resolver rows through WAL-backed `resolver-unresolved` records.
- Authority boundary: unresolved resolver failure loads the WAL-recovered
  queue/runs projection, rejects missing/terminal/stale rows, requires incoming
  attempt identity when the current resolver row has attempt identity, and
  repeats those checks inside `coordinatorAuthority.applyWithinStorageUpdate()`
  before building the skipped terminal row.
- Persistence boundary: the resolver queue row is durable on queue WAL append.
  Runs, unresolved-target event append, and resolver-pending source-post cleanup
  are derived compatibility saves after WAL acknowledgement; derived-save
  failure schedules repair without poisoning the durable terminal row.
- Still snapshot-backed: resolver remap remains snapshot-backed because it can
  move between source and destination rows and update pending source records.
- Validation: covered by `unresolved resolver terminalization is
  WAL-backed and recovers after restart`, `unresolved resolver WAL append
  failure leaves row active`, `unresolved resolver derived save failure does
  not poison WAL terminalization`, and the existing stale WAL-terminal
  unresolved regression; `node -c shared/js/sw.js`, `node -c
  test/swSynthetic.test.js`, `node -c test/p1-contract.test.js`, `node
  test/p1-contract.test.js`, `node test/swSynthetic.test.js`, and `npm test`
  passed. Version bumped to `1.6.567`; `npm run prod`, `npm run build:chrome`,
  and `npm run build:firefox` produced `chrome/mute_block-1.6.567.zip` and
  `firefox/mute_block-1.6.567.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.567` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 409 recovered/view rows, no view mismatches, and an
  active WAL tail with 19 applied records; raw-vs-recovered count divergence is
  from unapplied-to-raw WAL tail state, not projection inconsistency. Dashboard
  sanity showed 28 ready, 303 succeeded, 51 soft-fail, 8 hard-fail, 1 active,
  and 29 per-row cancel buttons for 80 displayed rows.

## Slice 23 review closeout: unresolved resolver row type and repair

- Operation migrated: no new WAL operation. This closes the post-1.6.567 review
  findings on the WAL-backed `resolver-unresolved` path.
- Authority boundary: `resolve-queued-profile-target-failed` now rejects
  non-profile-resolution rows and inactive rows before any WAL append, and
  repeats those guards inside the serialized authority mutator. A normal active
  profile action row can no longer be terminalized by an unresolved resolver
  message.
- Repair boundary: if the WAL terminal row is durable but the derived
  pending-post cleanup save fails, stored-work repair now clears resolver-pending
  source records for terminal skipped unresolved resolver rows.
- Inventory: the `markQueuedProfileResolutionUnresolved` call-site inventory now
  reflects the WAL-backed authority row and derived compatibility cleanup
  boundary.
- Validation: covered by `unresolved resolver rejects non-resolution active row
  before WAL append`, `unresolved resolver derived save failure does not poison
  WAL terminalization`, and the updated P1 contract for resolver-pending repair;
  `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c
  test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.568`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.568.zip` and
  `firefox/mute_block-1.6.568.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.568` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 409 recovered/view rows, no view mismatches, and an
  active WAL tail with 19 applied records; raw-vs-recovered count divergence is
  from unapplied-to-raw WAL tail state, not projection inconsistency. Dashboard
  sanity showed 28 ready, 303 succeeded, 51 soft-fail, 8 hard-fail, 1 active,
  and 29 per-row cancel buttons for 80 displayed rows.

## Slice 24: bulk current-work cancel WAL batch migration

- Operation migrated: dashboard `Cancel Queue` / `cancel-coordinator-current-work`
  now terminalizes all currently pending queue rows through WAL-backed
  `stored-work-cancel` records in one batch append.
- Authority boundary: the bulk cancel path loads the WAL-recovered coordinator
  state, selects pending rows only, builds terminal canceled rows in memory, and
  appends the whole selected set to the queue WAL as one batch. WAL append
  failure rejects the cancel without partially terminalizing later rows.
- Persistence boundary: queue-row cancellation is durable when the queue WAL
  batch append succeeds. Compact queue projection is refreshed by the WAL
  projection follow-up. Runs, events, and progress mirror updates are derived
  compatibility saves after WAL acknowledgement; derived-save failure records a
  diagnostic and schedules repair without poisoning the already-durable cancel.
- Still snapshot-backed: pause, manual retry/requeue, enqueue, and resolver remap
  remain separate review-gated slices. The new batch WAL writer is only used for
  same-key terminal row updates and is not a general key-moving requeue helper.
- Validation: covered by `bulk current work cancel WAL-terminalizes all pending
  rows as a batch`, `bulk current work cancel WAL append failure leaves rows
  pending`, `bulk current work cancel derived failure does not poison WAL
  terminalization`, and updated P1 storage-authority contracts; `node -c
  shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c
  test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.569`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.569.zip` and
  `firefox/mute_block-1.6.569.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.569` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 409 recovered/view rows, no view mismatches, and an
  active WAL tail with 19 applied records; raw-vs-recovered count divergence is
  from unapplied-to-raw WAL tail state, not projection inconsistency. Dashboard
  sanity showed 28 ready, 303 succeeded, 51 soft-fail, 8 hard-fail, 1 active,
  and 29 per-row cancel buttons for 80 displayed rows.

## Slice 24 review closeout: bulk-cancel durability before runtime cleanup

- Operation migrated: no new WAL operation. This closes the post-1.6.569 review
  finding on the WAL-backed `stored-work-cancel` batch path.
- Authority boundary: bulk current-work cancel now treats durable cancel
  persistence failure as a hard stop. If the batch WAL append fails, the stored
  cancel mutator returns no owned tab ids, and `cancelCoordinatorCurrentWork()`
  returns the failure before `stopOwnerNukes()`, tab removal, pause-state
  clearing, or runtime pruning.
- Persistence boundary: runtime cleanup only follows a durable queue cancel.
  WAL append failure leaves the row active/queued in raw storage and current
  authority, appends no WAL record, and leaves live owned tabs open.
- Storage-context guard: the reusable batch WAL helper now marks the active
  storage-update context as having applied a coordinator authority queue
  mutation after a successful WAL append, matching the single-row authority path
  and preserving the stale outer queue-save guard for future batch callers.
- Validation: covered by `bulk current work cancel WAL append failure does not
  close active owned tab` plus updated P1 storage-authority contracts; `node -c
  shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c
  test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.570`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.570.zip` and
  `firefox/mute_block-1.6.570.zip`. Live Chrome push/validation is pending
  because the reverse tunnels on `127.0.0.1:10022` and `127.0.0.1:9223` accepted
  local connections but did not forward responses; bounded SSH, CDP, and rsync
  probes timed out.

## Slice 24 review closeout: bulk-cancel storage fallback hard stop

- Operation migrated: no new WAL operation. This closes the post-1.6.570 review
  finding on the same WAL-backed `stored-work-cancel` batch path.
- Authority boundary: `cancelCoordinatorCurrentWork()` now also treats
  non-object storage-update fallback results as durable cancel failure. If
  `enqueueSpaceFeedStorageUpdate()` returns `false` after a storage timeout or
  abandoned serialized update, bulk cancel returns `cancel-persistence-failed`
  before `stopOwnerNukes()`, tab removal, pause-state clearing, or runtime
  pruning.
- Persistence boundary: unchanged. Runtime cleanup only follows an object-shaped
  successful stored cancel result; storage timeout/fallback leaves raw storage
  active, appends no WAL record, and leaves the owned tab open.
- Traceability: annotated tag `v1.6.570` now points at the committed
  `1.6.570` release bundle.
- Validation: covered by `bulk current work cancel storage fallback does not
  close active owned tab` plus updated P1 storage-authority contracts; `node -c
  shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c
  test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.571`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.571.zip` and
  `firefox/mute_block-1.6.571.zip`. CDP was reachable again, but the SSH copy
  tunnel on `127.0.0.1:10022` still timed out before authentication, so live
  Chrome could not be updated; CDP inspection showed the live unpacked extension
  still enabled at `1.6.569` with no manifest/runtime errors.

## Slice 25: bulk current-work pause WAL batch migration

- Operation migrated: dashboard/source-page pause (`pause-coordinator-nukes`)
  now requeues active/opening/acting/settling queue rows through WAL-backed
  `stored-work-pause` records in one batch append.
- Authority boundary: the pause path loads the WAL-recovered coordinator state,
  treats already queued rows as no-op paused work, and appends only rows that
  need durable active-to-queued requeue. Pause cleanup stops before
  `stopOwnerNukes()` or tab removal if the durable pause row mutation fails.
- Persistence boundary: row requeue is durable when the queue WAL batch append
  succeeds. The pause flag/generation remains a separate pause-control write.
  Runs/events/progress reset compatibility saves happen after WAL acknowledgement
  with `queue: false`; derived-save failure records diagnostics and schedules
  repair without poisoning the durable row pause.
- Still snapshot-backed: manual retry/requeue, enqueue, and resolver remap
  remain separate review-gated slices. The batch WAL writer is still limited to
  same-key row updates and is not used for failed-item key moves.
- Inventory: the stored-work pause call-site inventory now reflects the
  WAL-backed row mutation and derived compatibility boundary.
- Validation: covered by `bulk current work pause WAL-requeues active rows as a
  batch`, `bulk current work pause WAL append failure does not close active
  owned tab`, and updated P1 storage-authority contracts; `node -c
  shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `node -c
  test/p1-contract.test.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.572`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.572.zip` and
  `firefox/mute_block-1.6.572.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.572` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 364 recovered/view rows, no view mismatches, and an active
  WAL tail with 7 applied records; raw-vs-recovered count divergence is from
  unapplied-to-raw WAL tail state, not projection inconsistency. Dashboard sanity
  showed 4 ready, 327 succeeded, 4 soft-fail, 0 hard-fail, 0 active, and 4
  per-row cancel buttons for 80 displayed rows.

## Slice 26: manual failed retry/requeue WAL key-move migration

- Operations migrated: dashboard/source-page manual failed retry
  (`retry-coordinator-failed`) and failed requeue
  (`requeue-coordinator-failed`) now persist queue row resets through
  WAL-backed `retry` and `requeue` batch records before executor reconcile.
- Authority boundary: both wrappers delegate selection to explicit projection
  operations. The durable queue append can emit `map.set` plus `map.remove`
  records so resolver requeue/retry can move from a failed source key to a
  profile-resolution key without leaving the old authority row in WAL recovery.
- Persistence boundary: terminal failed rows are allowed to transition back to
  queued only through explicit retry/requeue WAL records with
  `allowTerminalOverwrite`. Runs/events/progress resets remain derived
  compatibility saves with `queue: false`; derived-save failure schedules
  repair and does not poison the durable row reset.
- Failure boundary: if the queue WAL append fails or the serialized storage
  update falls back, retry/requeue return no selected durable rows and do not
  start executor reconcile, open tabs, or write derived events.
- Still snapshot-backed: enqueue/merge and resolver remap remain separate
  review-gated slices. Physical WAL segmentation remains a follow-up adapter
  change, not part of this correctness slice.
- Inventory: retry/requeue rows now reflect the projection helper boundary and
  WAL set/remove records for key-moving failed-item resets.
- Validation: covered by `manual failed retry WAL moves resolver rows without
  leaving stale source key`, `manual failed requeue WAL append failure does not
  start executor or write derived state`, existing no-foreground retry/requeue
  executor tests, and updated P1 storage-authority contracts; `node -c
  shared/js/sw.js`, `node test/p1-contract.test.js`, `node
  test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.573`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.573.zip` and
  `firefox/mute_block-1.6.573.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.573` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 536 recovered/view rows, no view mismatches, active WAL
  tail with 4 applied records, and one active row over stale raw queued state.
  Dashboard sanity showed 170 ready, 336 succeeded, 0 soft-fail, 0 hard-fail, 1
  active, and 80 per-row cancel buttons.

## Slice 27: source-post resolver remap WAL key-move migration

- Operation migrated: `resolve-queued-profile-target` now delegates to
  `mutateCoordinatorProjection({kind: 'resolveQueuedProfileTarget'})` and
  persists `resolver-remap` queue authority through WAL-backed `map.set` plus
  `map.remove` records before runtime tab metadata is remapped.
- Authority boundary: the serialized mutator reloads WAL-recovered current
  authority, repeats the source terminal/profile-resolution/stale-attempt
  checks, requires an active resolver source row, requires incoming attempt
  identity when the durable source row has attempt identity, repeats the
  destination conflict guard, and rejects non-resolution source rows before any
  WAL append. Compatible existing succeeded destination rows remain the only
  terminal overwrite case.
- Persistence boundary: durable queue remap succeeds only after the queue WAL
  append. Runs and pending-post source records are derived compatibility saves
  with `queue: false`; derived-save failure records diagnostics, schedules
  repair, and does not poison the durable remap.
- Repair boundary: storage repair now also repairs resolver-pending source
  records for successful remaps recovered from WAL when the derived pending-post
  save failed.
- Still snapshot-backed: enqueue/merge remains the large ordinary mutation
  slice. It still has reset cleanup side effects that must be moved or gated
  after durable persistence before WAL migration.
- Inventory: resolver remap rows now describe the projection helper and
  WAL-backed key-moving set/remove boundary.
- Validation: `node -c shared/js/sw.js`, `node test/p1-contract.test.js`,
  `node test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.574`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.574.zip` and
  `firefox/mute_block-1.6.574.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.574` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 525 recovered/view rows, no view mismatches, active WAL
  tail with 4 applied records, and raw-vs-recovered count divergence from
  unapplied-to-raw WAL tail state. Dashboard sanity showed 79 ready, 407
  succeeded, 1 soft-fail, 5 hard-fail, 0 active, and 79 per-row cancel buttons
  for 80 displayed rows.
- Review closeout: reviewer follow-up found that resolver remap success could
  accept inactive source rows and identity-less success messages. Local
  follow-up now rejects queued/inactive source rows and missing incoming attempt
  identity before WAL append, with synthetic coverage proving no WAL record, no
  source-key move, and no runtime metadata remap. Version bumped to `1.6.575`;
  `npm test`, `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` passed and produced `chrome/mute_block-1.6.575.zip` and
  `firefox/mute_block-1.6.575.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.575` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 506 raw/recovered/view rows, no raw divergences, no view
  mismatches, and active WAL tail with 2 applied records. Dashboard sanity
  showed 44 ready, 416 succeeded, 12 soft-fail, 0 hard-fail, 1 active, and 45
  per-row cancel buttons for 80 displayed rows.

## Slice 28: enqueue/merge WAL migration

- Operation migrated: `enqueue` was added to
  `COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS`; `enqueueCoordinatorItemsStorageLocked`
  now builds a next queue projection and persists accepted enqueue/merge rows
  through `persistCoordinatorAuthorityQueueWalBatchMutation`.
- Authority boundary: raw `mbCoordinatorQueue` is no longer the durable target
  for newly enqueued rows. Tests and runtime follow-up paths use WAL-recovered
  authority/current projection for enqueue-created work.
- Side-effect boundary: reset cleanup for existing executor tabs moved out of
  the storage mutation. `finishCoordinatorEnqueue()` runs reset cleanup and
  reconcile only after the enqueue result has accepted durable rows; WAL append
  failure leaves active owned tabs open and existing durable rows unchanged.
- Derived state: runs/events/progress save as `enqueue-derived` with
  `queue: false`. A derived-save failure records diagnostics, schedules repair,
  and does not poison the durable queue WAL append.
- Coverage added/updated: storage-only enqueue asserts WAL recovery without a
  raw queue snapshot; executable enqueue timeout now wedges `mbCoordinatorQueueWal`;
  reset-existing WAL failure keeps the active owned tab open; derived-save
  failure keeps the WAL row durable, schedules repair, and repair rebuilds
  missing runs/events/progress derived state; stale raw-queue enqueue-adjacent
  assertions now read recovered authority.
- Validation: `node -c shared/js/sw.js`, `node test/p1-contract.test.js`,
  `node test/swSynthetic.test.js`, and `npm test` passed. Version bumped to
  `1.6.576`; `npm run prod`, `npm run build:chrome`, and `npm run
  build:firefox` produced `chrome/mute_block-1.6.576.zip` and
  `firefox/mute_block-1.6.576.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.576` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 506 raw/recovered/view rows, no raw divergences, no view
  mismatches, and an active WAL tail with 2 applied records. Dashboard sanity
  showed 44 ready, 416 succeeded, 12 soft-fail, 0 hard-fail, 1 active, and 45
  per-row cancel buttons for 80 displayed rows.
- Review closeout: reviewer follow-up found that the scheduled repair after
  `enqueue-derived` save failure was a no-op for WAL-only enqueue rows with no
  progress record. Local follow-up now repairs queued WAL-derived rows back
  into run metadata, service-worker queued progress, and a repair event, and
  tracks in-place run metadata changes so `repairCoordinatorStorageFromProgress`
  persists the rebuilt runs map. The synthetic derived-save failure regression
  now runs repair and verifies `runsChanged`, `progressChanged`, `eventsChanged`,
  restored target/work keys, queued progress attempt identity, and the repair
  event. Version bumped to `1.6.577`; `npm test`, `npm run prod`,
  `npm run build:chrome`, and `npm run build:firefox` passed and produced
  `chrome/mute_block-1.6.577.zip` and `firefox/mute_block-1.6.577.zip`.
  Bounded rsync to the unpacked Chrome directory succeeded and CDP reload
  reported extension `1.6.577` enabled with zero manifest/runtime errors. Live
  queue accounting reported `consistent: true`, 485 raw/recovered/view rows, no
  raw divergences, no view mismatches, and an active WAL tail with 1 applied
  record. Dashboard sanity showed 32 ready, 407 succeeded, 12 soft-fail,
  0 hard-fail, 1 active, and 33 per-row cancel buttons for 80 displayed rows.
- Review closeout 2: reviewer follow-up found that resetExisting enqueue could
  leave an old same-href progress record with the previous attempt id after an
  `enqueue-derived` save failure. The derived-state repair materializer now
  rebuilds queued service-worker progress when the existing record is missing
  or stale/missing attempt identity for the durable queued WAL row. Added a
  synthetic resetExisting regression that preserves the old active progress
  through the failed derived save, then verifies repair replaces it with queued
  progress carrying the WAL row attempt id/number and clears old active fields.
  Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`,
  `timeout 120 node test/swSynthetic.test.js`, `node test/p1-contract.test.js`,
  and `npm test` passed. Version bumped to `1.6.578`; `npm run prod`,
  `npm run build:chrome`, and `npm run build:firefox` produced
  `chrome/mute_block-1.6.578.zip` and `firefox/mute_block-1.6.578.zip`.
  Bounded rsync to the unpacked Chrome directory succeeded and CDP reload
  reported extension `1.6.578` enabled with zero manifest/runtime errors. Live
  queue accounting reported `consistent: true`, 463 raw/recovered/view rows, no
  raw divergences, no view mismatches, and an active WAL tail with 1 applied
  record. Dashboard sanity showed 18 ready, 401 succeeded, 12 soft-fail,
  0 hard-fail, 1 active, and 19 per-row cancel buttons for 80 displayed rows.

## Slice 29: compatibility progress sync WAL migration

- Operation migrated: `compatibility-progress-sync` was added as a queue-WAL
  batch operation for `syncCoordinatorProgressRecordsLocked`.
- Authority boundary: compatibility progress can still repair stale failed
  queue rows when same-attempt successful progress is the better authority, but
  the queue transition now persists through `mbCoordinatorQueueWal` first.
  Runs/progress are derived compatibility saves with `queue: false`; if the WAL
  append fails, derived saves are skipped and the stale failed row remains the
  recovered authority.
- Correctness fix discovered during the slice: the href normalization loop no
  longer passes `normalizeQuoraProfileUrl` directly to `Array.map`, because the
  array index was being passed as the helper `baseUrl` parameter and could make
  compatibility sync silently no-op.
- Coverage added/updated: synthetic coverage proves successful compatibility
  progress repairs a stale failed row through WAL authority while raw snapshot
  remains stale; WAL failure coverage proves no WAL means the stale failed row
  remains authoritative and run metadata is not advanced. The P1 contract now
  pins the WAL batch helper and the `queue: false` derived save boundary.
- Inventory: `syncCoordinatorProgressRecordsLocked` rows now describe the
  WAL-backed compatibility queue repair and derived runs/progress state.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`,
  `node test/p1-contract.test.js`, `timeout 120 node test/swSynthetic.test.js`,
  and `npm test` passed. Version bumped to `1.6.579`; `npm run prod`,
  `npm run build:chrome`, and `npm run build:firefox` produced
  `chrome/mute_block-1.6.579.zip` and `firefox/mute_block-1.6.579.zip`.
  Bounded rsync to the unpacked Chrome directory succeeded and CDP reload
  reported extension `1.6.579` enabled with zero manifest/runtime errors. Live
  queue accounting reported `consistent: true`, 449 recovered/view rows, no view
  mismatches, raw-vs-recovered count divergence from active WAL tail state, and
  an active WAL tail with 4 applied records. Dashboard sanity showed 0 ready,
  404 succeeded, 14 soft-fail, 0 hard-fail, 0 active, and 0 per-row cancel
  buttons for 80 displayed rows.
- Review closeout: reviewer found that after a successful
  `compatibility-progress-sync` WAL append, a failing derived runs/progress save
  could throw out of the path before scheduling materialization and before
  terminal settlement. The derived save now mirrors the newer enqueue-derived
  pattern: failures record `compatibility-progress-sync-derived-save-failed`,
  increment `compatibilityProgressSync.derivedSaveFailed`, schedule stored-work
  materialization, and do not poison the durable queue WAL row. Added synthetic
  coverage that fails only the post-WAL runs/progress save, verifies raw queue
  remains stale while recovered WAL authority is `succeeded`, verifies the stale
  run metadata was not silently advanced, verifies repair was scheduled, and
  proves terminal settlement still runs by clearing the pending source post.
  Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`,
  `node -c test/lib/swHarness.js`, `timeout 120 node test/swSynthetic.test.js`,
  `node test/p1-contract.test.js`, and `npm test` passed. Version bumped to
  `1.6.580`; `npm run prod`, `npm run build:chrome`, and
  `npm run build:firefox` produced `chrome/mute_block-1.6.580.zip` and
  `firefox/mute_block-1.6.580.zip`. Bounded rsync to the unpacked Chrome
  directory succeeded and CDP reload reported extension `1.6.580` enabled with
  zero manifest/runtime errors. Live queue accounting reported
  `consistent: true`, 421 raw/recovered/view rows, no raw divergences, no view
  mismatches, and an empty WAL tail. Dashboard sanity showed 0 ready,
  391 succeeded, 0 soft-fail, 0 hard-fail, 0 active, and 0 per-row cancel
  buttons for 80 displayed rows.
- Review closeout 2: reviewer follow-up found that the new derived-save guard
  treated empty compatibility derived payloads as failures because
  `saveCoordinatorState()` returns `false` for no-op saves. The
  `compatibility-progress-sync` derived save is now gated on
  `runsChanged || progressChanged`, so a real WAL authority transition with
  already-current runs/progress state does not schedule false repair churn.
  Added synthetic coverage for that WAL-only/no-derived-delta path and verified
  no derived run write, no `compatibilityProgressSync.derivedSaveFailed`
  counter, and no stored-work repair timeout. Validation: `node -c
  shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `timeout 120 node
  test/swSynthetic.test.js`, `node test/p1-contract.test.js`, and `npm test`
  passed. Version bumped to `1.6.581`; `npm run prod`,
  `npm run build:chrome`, and `npm run build:firefox` produced
  `chrome/mute_block-1.6.581.zip` and `firefox/mute_block-1.6.581.zip`.
  Bounded rsync to the unpacked Chrome directory succeeded and CDP reload
  reported extension `1.6.581` enabled with zero manifest/runtime errors. Live
  queue accounting reported `consistent: true`, 420 raw/recovered/view rows, no
  raw divergences, no view mismatches, and an empty WAL tail. Dashboard sanity
  showed 0 ready, 390 succeeded, 0 soft-fail, 0 hard-fail, 0 active, and
  0 per-row cancel buttons for 80 displayed rows.

## Slice 30: clear-profile queue removal WAL migration

- Operation migrated: `clear-profile` was added as a queue-WAL removal
  operation for `clearProfileNukeState`.
- Authority boundary: clearing a profile now reads the WAL-recovered queue,
  appends `map.remove` records for matching coordinator rows, and leaves the
  raw `mbCoordinatorQueue` snapshot stale until compaction/checkpoint. The
  compact queue view is updated from the WAL projection. Profile progress, run
  target metadata, pending source-post memory, and remembered nuked-post memory
  are saved only after durable queue removal; if the WAL append fails, those
  derived/user-memory maps are left intact.
- Coverage added: synthetic coverage proves a successful clear removes the row
  from recovered WAL authority while raw queue still contains the stale row,
  writes the derived progress/runs/pending/nuked cleanup, and appends a
  `clear-profile` remove record. WAL-failure coverage proves no WAL means the
  raw/recovered queue row, progress, run target, pending post, and remembered
  nuked post remain intact and repair is scheduled. The WAL-failure regression
  also verifies the volatile progress mirror is not cleared before durable
  storage succeeds.
- Inventory: the `clearProfileNukeState` direct-storage row now describes the
  WAL-backed queue removal and derived cleanup boundary.
- Validation: `node -c shared/js/sw.js`, `node -c test/swSynthetic.test.js`,
  `timeout 180 node test/swSynthetic.test.js`, `node test/p1-contract.test.js`,
  and `npm test` passed. Version bumped to `1.6.582`; `npm run prod`,
  `npm run build:chrome`, and `npm run build:firefox` produced
  `chrome/mute_block-1.6.582.zip` and `firefox/mute_block-1.6.582.zip`.
  Bounded rsync to the unpacked Chrome directory succeeded and CDP reload
  reported extension `1.6.582` enabled with zero manifest/runtime errors. Live
  queue accounting reported `consistent: true`, 420 raw/recovered/view rows, no
  raw divergences, no view mismatches, and an empty WAL tail. Dashboard sanity
  showed 0 ready, 390 succeeded, 0 soft-fail, 0 hard-fail, 0 active, and
  0 per-row cancel buttons for 80 displayed rows.
- Review closeout: reviewer follow-up found that clear-profile derived run
  cleanup removed the profile from `targetProfileHrefs` but left a profile-key
  run's matching `targetWorkKeys` and old `itemCount`. The cleanup now treats
  profile-equivalent work keys as affected run targets, removes them with the
  profile href, and run recomputation no longer preserves stale
  `itemCount` when there are no current targets or queue rows. The success
  synthetic now asserts the cleared href is absent from both `targetProfileHrefs`
  and `targetWorkKeys`, with `itemCount: 0`. Validation: `node -c
  shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `timeout 180 node
  test/swSynthetic.test.js`, `node test/p1-contract.test.js`, and `npm test`
  passed. Version bumped to `1.6.583`; `npm run prod`,
  `npm run build:chrome`, and `npm run build:firefox` produced
  `chrome/mute_block-1.6.583.zip` and `firefox/mute_block-1.6.583.zip`.
  Bounded rsync to the unpacked Chrome directory succeeded and CDP reload
  reported extension `1.6.583` enabled with zero manifest/runtime errors. Live
  queue accounting reported `consistent: true`, 420 raw/recovered/view rows, no
  raw divergences, no view mismatches, and an empty WAL tail. Dashboard sanity
  showed 0 ready, 390 succeeded, 0 soft-fail, 0 hard-fail, 0 active, and
  0 per-row cancel buttons for 80 displayed rows.
- Review closeout 2: reviewer follow-up found that if the `clear-profile` WAL
  removal succeeded but the post-WAL derived cleanup save failed, repair could
  treat the stale queued progress record as stranded work and recreate the row
  that WAL authority had just removed. Repair now materializes WAL-authority
  profile removals before queued-progress restoration: stale progress, run
  target metadata, pending source-post memory, and remembered nuked-post memory
  are removed when the raw queue still has a profile row that current WAL
  authority no longer has. `saveCoordinatorState()` also supports the
  remembered-nukes repair payload so this cleanup can be persisted in the same
  repair pass. Added synthetic coverage for post-WAL clear-profile derived save
  failure; it verifies the raw snapshot can remain stale, recovered WAL queue
  stays empty, repair does not resurrect the row, and progress/runs/pending/
  nuked derived state is cleared. Validation: `node -c shared/js/sw.js`,
  `node -c test/swSynthetic.test.js`, `timeout 180 node
  test/swSynthetic.test.js`, `node test/p1-contract.test.js`, and `npm test`
  passed. Version bumped to `1.6.584`; `npm run prod`,
  `npm run build:chrome`, and `npm run build:firefox` produced
  `chrome/mute_block-1.6.584.zip` and `firefox/mute_block-1.6.584.zip`.
  Bounded rsync to the unpacked Chrome directory succeeded and CDP reload
  reported extension `1.6.584` enabled with zero manifest/runtime errors. Live
  queue accounting reported `consistent: true`, 420 raw/recovered/view rows, no
  raw divergences, no view mismatches, and an empty WAL tail. Dashboard sanity
  showed 0 ready, 390 succeeded, 0 soft-fail, 0 hard-fail, 0 active, and
  0 per-row cancel buttons for 80 displayed rows.
- Next slice: direct nonterminal `recordCoordinatorJobProgressRecords()`
  queue transitions now append queue WAL records instead of mutating the raw
  `mbCoordinatorQueue` snapshot. Nonterminal direct progress uses the new
  `direct-progress` operation kind; terminal progress keeps
  `terminal-progress`. The compatibility save now writes only derived
  runs/progress state (`queue: false`), so the raw queue snapshot can remain
  stale while recovered WAL authority carries the current row. Added synthetic
  coverage for nonterminal direct progress restart recovery, WAL append
  failure, and stale runtime-resume assertions that must read recovered
  authority rather than the raw snapshot. Validation: `node -c
  shared/js/sw.js`, `node -c test/swSynthetic.test.js`, `timeout 240 node
  test/swSynthetic.test.js`, `timeout 120 node test/p1-contract.test.js`, and
  `timeout 300 npm test` passed. Version bumped to `1.6.585`; `npm run prod`,
  `npm run build:chrome`, and `npm run build:firefox` produced
  `chrome/mute_block-1.6.585.zip` and `firefox/mute_block-1.6.585.zip`.
  Bounded rsync to the unpacked Chrome directory succeeded and CDP reload
  reported extension `1.6.585` enabled with zero manifest/runtime errors. Live
  queue accounting reported `consistent: true`, 420 raw/recovered/view rows, no
  raw divergences, no view mismatches, and an empty WAL tail. Dashboard sanity
  showed 0 ready, 390 succeeded, 0 soft-fail, 0 hard-fail, 0 active, and
  0 per-row cancel buttons for 80 displayed rows.

## Deferred follow-up: physical WAL segmentation

- Do not derail the current correctness/migration slices for this.
- The current queue WAL has the right logical record shape, but the live storage
  metrics show the physical adapter still rewrites the whole
  `mbCoordinatorQueueWal` blob per append.
- Follow-up design note:
  `queue-wal-segmented-record-followup-2026-05-27.md`.
- Target direction: one WAL record per bounded segment key, a small manifest
  cursor, separate `recordSeq` from generation-local `segmentNo`, schedule a
  checkpoint generation switch at the soft segment threshold, and hard-block new
  durable queue WAL appends at the hard threshold until the generation switch
  completes.

## Deferred follow-up: repair terminology

- Do not derail the current WAL migration slices for this rename.
- The target vocabulary is captured in [architecture.md](architecture.md):
  ordinary WAL-authority convergence should be described as `reconcile`,
  `materialize`, `recover`, `apply`, `resolve`, or `audit` depending on the
  role. Once WAL is authority, missing or stale derived state is expected
  projection/materialization work, not normally "repair".
- Long term, `repair` should disappear from ordinary scheduler, derived-state,
  and compatibility paths. Keep it only for true authority corruption or
  explicitly labeled legacy cleanup while old snapshot-era states still exist.
