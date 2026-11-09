# De novo review of `shared/` — 14 Oct 2026 (review 1)

> **Status: HISTORICAL** (24 Oct 2026). De novo review of shared/ (14 Oct, review 1). Findings answered in the reply; closed items are listed in planning.md. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Scope: the `shared/` tree on branch `review/shared-wip`, HEAD `abc2307` (WIP snapshot), plus the uncommitted working-tree changes listed in `git status` at the time of review. No repo files were changed by the review. No build, version bump, or commit was made.

## Bottom line

The tree is green. `npm test` exits 0 with 1,103 `ok` lines and 0 `not ok`. All five lint gates pass: no-outside-writes, queue-storage-layering (14 allowed functions, no new violations), sw-queue-boundary, correctness, and block-classification.

The layering work holds in most places I checked. Three things need attention:

1. A stale mirror can validate as committed after a lost or failed session write. This can silently roll back an acknowledged WAL append. It is the most important finding.
2. Legacy archived soft-failures are counted as retry-eligible and shown as live rows, but the retry action cannot reach them.
3. The outlier flight-recorder history was removed. Confirm that this was intended.

## Coverage

Read in full:

- The uncommitted `shared/js/sw.js` diff (about 1,370 lines)
- The `shared/js/coordinator.js` diff
- The WAL-store diffs (`swQueueWalStore.js`, `walSnapshotStore.js`)
- `shared/js/swQueueWalStore.js`
- `shared/js/swCoordinatorOutliers.js` (new, untracked)

Read in context: the relevant `sw.js` and `walSnapshotStore.js` functions (mirror, hydrate, outliers, archive, persist).

Not read line by line: `shared/js/content.js` (14k lines), most of `shared/js/sw.js` (35k lines), `preferences.js`, `swstorage.js`, `sharedModeration.js`, and most of `walSnapshotStore.js`. The review is therefore shallow outside the WAL, storage, and dashboard layers.

## Findings, most important first

### 1. A stale mirror can validate as committed (medium, silent)

- The WAL pending marker is written fire-and-forget before the disk write, and its failure is swallowed: [sw.js:7077-7082](../shared/js/sw.js:7077).
- If the committed write for the append then also fails, the append path only increments `queueMirror.writeFailed` and returns false: [sw.js:7425](../shared/js/sw.js:7425). The marker keeps its previous value, `{pending: S1, committed: S1}`.
- The validity check accepts a mirror whose `pending` equals `committed` and whose meta matches: [sw.js:7211-7212](../shared/js/sw.js:7211). Hydrate then uses the mirror and does not read disk meta (`loadCoordinatorCurrentAuthorityState`, [sw.js:10653](../shared/js/sw.js:10653)).
- Result: disk is at S2, the mirror is at S1. After a worker restart, the S2 append is gone.
- This contradicts [docs/queue-storage-layering.md:237](../docs/queue-storage-layering.md:237), which says a missing marker only makes readers treat the mirror as stale. Rule 8 accepts lost updates, but the stated bound is "a retried target or a dropped queued item." A rolled-back WAL segment can move a finished row back to an earlier state that the executor may act on again.
- Not reproduced. No test covers it. The existing tests set `pending: 'commit-in-flight'` by hand, which is a different state.
- Suggested fix: at hydrate, read the disk meta key and require its fingerprint to equal `marker.committed` before trusting the mirror. This is one small read, not a queue-data read. Awaiting the pending write is the other option, but the code comments say that shifts fake-timer ticks in tests.
- Suggested test: drive a pending-marker write that rejects, followed by a committed write that rejects, then hydrate. Assert that hydrate does not use the mirror.

### 2. Legacy archived soft-failures are counted but unreachable (low to medium, legacy data only)

- The dashboard list is built from the merged live-plus-completed population using `!isArchivableCoordinatorRow(queue[key])` ([sw.js:6361](../shared/js/sw.js:6361)). A completed soft-fail below the retry cap fails that test, so it appears as a live row.
- The same population feeds the eligible count: `summarizeSoftFailRetryCounts(population)` ([sw.js:6367](../shared/js/sw.js:6367)). So the row is counted as retry-eligible.
- The retry action reads only the live authority queue. The button reports N eligible and retries none.
- The run rollup disagrees. `isFinishedCoordinatorRunItem` in `swCoordinatorRuns.js` treats every archived row as finished, regardless of retry count.
- Such rows can exist from before 2026-10-13, when the archive gate took every terminal row. New archives cannot produce them.
- Suggested fix: exclude completed-only rows from the list and from the soft-fail counts, so the list, the counts, and the rollup agree.

### 3. Outlier flight-recorder history was removed (confirm intent)

- The per-outlier flight-recorder fetch and the tooltip that carried its entries are gone from `shared/js/coordinator.js`.
- The outlier header text was rewritten: [shared/coordinator.html:268](../shared/coordinator.html:268).
- The new worker module [shared/js/swCoordinatorOutliers.js](../shared/js/swCoordinatorOutliers.js) stores no flight-recorder entries.
- The flight recorder itself is unaffected.
- If the removal was intended, fine. If not, restoring it means capturing entries at flag time in the worker.

### 4. A torn checkpoint switch has no automatic recovery (owner decision; pinned by tests)

- Mirror recovery runs only for `checkpoint-manifest-meta-mismatch`: [swQueueWalStore.js:360](../shared/js/swQueueWalStore.js:360).
- `missing-checkpoint` and `missing-segment` fall through to the throw at [swQueueWalStore.js:470](../shared/js/swQueueWalStore.js:470). The authority stays unavailable.
- The mirror holds only the active slot. After a torn switch, its copy is the old slot and cannot match the new meta, so recovery cannot use it.
- The 2026-09-15 incident was this class of failure. The fail-closed behavior is pinned at [test/swSynthetic.test.js:5914](../test/swSynthetic.test.js:5914) and [:6050](../test/swSynthetic.test.js:6050).
- The new `checkpoint-meta-missing` refusal in `hydrateSegmentedWalStore` ([walSnapshotStore.js:1119](../shared/js/walSnapshotStore.js:1119)) is also fail-closed.
- Needs an explicit decision, and a torn-switch fixture test.

### 5. A failed hydrate is silently dropped in the executor fast path (low)

- [sw.js:22546](../shared/js/sw.js:22546) changed from `await coordinatorAuthority.hydrate()` to `.catch(() => null)`.
- Readers still gate on hydrate, so I do not think this corrupts state.
- Confirm that nothing after this line acts on pre-hydrate state.

### 6. The deferred content-index rebuild is an in-memory timer with no startup repair (low)

- `scheduleDeferredCoordinatorContentIndexRebuild` ([sw.js:7830](../shared/js/sw.js:7830)) fires after `CONTENT_INDEX_REBUILD_DELAY_MS` (1.5 s).
- If the worker dies inside that window, the content index stays stale until the next write triggers a rebuild. Nothing rebuilds it at startup.

### 7. Latent shared-reference contract (low; safe today)

- The WIP commit made `normalizeCoordinatorQueueWalStore` return the stored object instead of a clone ([swCoordinatorQueueWal.js](../shared/js/swCoordinatorQueueWal.js)).
- The resident store, `stored`, and the projection now alias the same object.
- Two writers mutate `store.meta` in place: `setCheckpointMeta` and `setWalGenerationMeta` ([walSnapshotStore.js:882, :895](../shared/js/walSnapshotStore.js:882)).
- I checked the current callers. They operate on clones (`writeInactiveCheckpoint` and the append path both clone before mutating). A future caller could break the contract silently.

### 8. Queue-namespace key constants are copied across five files (low; the entropy-plan pattern)

- `'mbCoordinatorQueueView'` and `'mbCoordinatorPaused'` each appear in three files.
- `HIDDEN_RUNS_KEY` appears in two files, and `MAX_PROFILE_NUKE_PROGRESS_ENTRIES` in two.
- The values match today. Nothing enforces that they stay in sync.

### 9. Documentation drift

- `docs/queue-storage-layering.md` Phase 1 says 41 allowlisted functions. Phase 6 says 28 → 27.
- The lint now reports 14 allowed functions.
- The "missing marker means stale" sentence at [docs/queue-storage-layering.md:237](../docs/queue-storage-layering.md:237) needs correcting, per finding 1.

## Checked and found sound

- The archive path does push finished rows into the outlier baseline. `completedRows` is set at [sw.js:9440](../shared/js/sw.js:9440).
- WAL appends do not mutate their input. `makeWalGeneration` copies the segment array before the push.
- `tokens.css` is wired correctly. Both manifests list it, and webpack copies `shared/css` to both extensions.
- The namespace stamp check is applied at hydrate in `loadCoordinatorCurrentAuthorityState`.
- The outlier baseline's Welford update and threshold logic are correct. Each finished row is judged before its own push.
- Every retry-limit consumer reads `SOFT_FAIL_RETRY_LIMIT` from `tunables.js`.
- No dangling references remain in `coordinator.js` after the helper removals.
- The `innerHTML` sites in `content.js` and `preferences.js` are static templates.
- The page-world injection (`activateConfirmationElementInPageWorld`) passes token and kind as arguments to a fixed function, and it checks the sender's tab URL first.

## Structure

- `shared/js/sw.js` is 35.5k lines with 469 top-level functions.
- `shared/js/content.js` is 14k lines with 631 top-level functions.
- The factory extraction is real, but most of the logic still lives in those two files.

## Suggested next steps

1. Fix finding 1 first, with a test that drives a lost pending write.
2. Decide findings 3 and 4 with the owner.
3. Fix finding 2 alongside finding 1, since both touch the same dashboard and hydrate code.
4. Extend the review to `content.js` and the non-WAL parts of `sw.js`, in slices.
