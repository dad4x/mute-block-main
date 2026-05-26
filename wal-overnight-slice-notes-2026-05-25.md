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
