# Dead-ends and digressions review, 24 Oct 2026

Status (25 Oct): owner decisions are recorded below with their plans. Nothing is built or committed. Four working-tree files were changed by an unrequested edit of mine. The owner has said keep them (25 Oct). Another session is editing the same tree (see "Working tree"). This note is the only file written for this review.

## Findings summary (25 Oct)

Fourteen findings from the 17 commits (8b245a1 to b20be9e), the working tree and the magic-number audit (Appendix C). Details are in the sections below.

| # | Finding | Decision (25 Oct) | Status |
|---|---------|-------------------|--------|
| 1 | A parked feature was built into the latest commit: a worker-copy recovery for torn checkpoints ("Recovery B"). The commit message does not mention it | Stays parked until shown to be needed | Removed in the working tree and kept. Still live in b20be9e. Uncommitted |
| 2 | The run list moved to disk buckets (20 Oct), then to the log (24 Oct). The bucket path, its startup migration, a 30 s gap diagnostic and two dev tools still use the old layout | Excise, with no import of old data | Planned. Not started |
| 3 | Five analysis-only checks run on the write path: two shadow WALs (since May and June), a deep-pending compare that walks the apply window on each pass (22 Oct), the runs gap watch and the store-size sampler (20-21 Oct). No decision reads them | Reduce: remove them | Planned. Not started |
| 4 | Progress is session-only on disk (verified), but has many in-memory copies: 30 worker assignment sites, 10 in the content script, plus the shadow copy | Open issue. No change now | Open |
| 5 | Session storage is estimated at about 9.25 of 10 MiB. No quota check on session writes. Not measured live | Keep the recorder's persisted snapshot. Live measurement open | Open. Needs a go to measure |
| 6 | Instrumentation grew by about 53 counters and 21 event kinds in four days (approximate; one kind removed) | Reduce, with item 3 | Planned |
| 7 | One-time migrations, repairs and startup cleanup that a fresh start does not need: space-map migration, progress repair, retired-key and content-index cleanup, the legacy slug shadow cut | Remove with the excise | Candidates listed. Each needs a dependency check |
| 8 | Cruft: an empty erase keep-list, a write-only variable, a stale comment, two constants outside the tunables file, one dev tool reading legacy keys | Cruft and constants go | Planned |
| 9 | Documentation: about 85 tracked and 68 untracked interim docs, many dated May to September, read as authoritative. The layering plan is untracked | Consolidate | Proposal in Appendix A. Nothing moved |
| 10 | Repo hygiene: untracked `docs/` and `experiments/`, 478 build logs in `tmp/`, junk and swap files at the root, `.claude/` at 1.2 GB | Not yet decided | Open |
| 11 | Unmerged work: `worker-writer-design` (12 commits) and four agent branches. The latest commit bundles the builds from v1.6.1469 to v1.6.1558 | Not yet decided | Open |
| 12 | Another session is editing the same working tree. One source file mixes its change with mine | Coordinate; do not overwrite | Open |
| 13 | Verification gap: the last test run (1,315 ok, exit 0) predates the 25 Oct edits. The packaged build (v1.6.1558) does not match the working tree | Build waits for a live run | Open |
| 14 | Magic numbers (Appendix C). Four storage-layout shard and bucket counts sit outside the key-names module, and tools type the bucket count 32 in five places. A 1000 ms cadence appears 272 times in product code. 157 named constants sit outside the tunables file. 1,047 inline literals in product code | Layout constants go to storageKeys.js; timing and caps go to tunables.js | Open. Two progress counts already moved in the other session's working tree. Audit done; no edits |

Clean: the two earlier reverts left no residue; all 44 test files are wired in; every new name the review scanned is used at least once; commit messages record decisions and measurements well.

## Owner decisions (25 Oct) and plans

| # | Decision | Plan |
|---|----------|------|
| 1 | Recovery B (worker-copy recovery) stays parked until shown to be needed | Not live. Section 1 |
| 2 | Turning runs into the log was a big win. The prior approach is vestigial and goes | Excise the bucket layout and its readers, with no import of old data (decided 25 Oct). See "Runs excise plan" and "Fresh-start excise" |
| 3 | Shadow checks are analysis instrumentation and can be reduced | Remove the three shadow checks and the runs gap watch. See section 3 addendum |
| 4 | Progress copies: an open issue | No change now. Appendix B |
| 5 | Keep the flight recorder's persisted snapshot (rarely invoked, useful). Some analysis-only session data can go | Snapshot stays. Remove the analysis-only events that feed it (gap check, store-size sampler). The live storage measurement stays open. See section 5 addendum |
| 6 | Cruft goes, and constants go to the right place | See section 7 addendum |
| 7 | Documentation update and consolidation: too many interim plans read as authoritative | Proposal in Appendix A. No files moved |

## Working tree (state at 25 Oct)

- Changed by me, not requested:
  - `shared/js/swQueueWalStore.js`: restored to its pre-b20be9e content, which removes the worker-copy recovery.
  - `test/swQueueWalStore.test.js`: restored to its pre-b20be9e content, which removes the recovery scenarios.
  - `shared/js/walSnapshotStore.js`: removed the checkpoint-records helper and its export. The run-log record kinds in the same file are untouched.
  - `shared/js/sw.js`: removed the storage wiring that only the recovery used (one entry and its comment).
- Changed by another session, not by me. Do not overwrite:
  - `shared/js/sw.js`: per-reason counters for direct and terminal progress no-op writes (comment dated 24 Oct).
  - `test/swSynthetic.test.js`: 27 added lines, a new test for a direct progress record on a profile with no queue row (file time 09:10, 24 Oct).
- Do not run `git checkout` or `git stash` on `shared/js/sw.js`. Its changes from the two sources are mixed.
- Owner (25 Oct): keep my four edits. They match decision 1. No revert is planned.
- The last test run (1,315 ok, exit 0) predates the edits above. The current tree is not verified.
- No build, no commit, no tag was made in this session.

## Corrections to the sections below

- Section 7: `tools/cdp/wal-snapshot-benchmark.js` reads the space maps through the bucket reader, so it is not a stale read. Only `tools/cdp/upgrade-regression/run.js` (lines 1237-1238) reads the whole-map keys directly.
- Line numbers below are from the 25 Oct read. The other session's edits may move them.

## Runs excise plan (decision 2)

Scope: remove the bucket layout and everything that exists only for it.
- Layout state and readers: `shared/js/sw.js:2611-2631` (layout key, `runsLayout`, the two stored-read default helpers, `applyRunsStoredLayout`).
- Bucket writer and its commit: `sw.js:2635-2650` (`getRunsDiskWrite`, `commitRunsDiskWrite`), called from the storage writer at `sw.js:2760` and `:2768`.
- Startup migration, runs part only: `sw.js:10449-10466` (`migrateSpaceMapLayout`). The space-map part stays.
- Startup read choices: `sw.js:11007`, `:11041`, `:11052`.
- Gap diagnostic: `sw.js:2656-2667` (`recordRunsResidentDiskGap`), `:2699-2712` (watch), `:22269` (start call), `:12146` (reconcile-tail call), and `shared/js/tunables.js:73` (`RUNS_GAP_WATCH_INTERVAL_MS`).
- Dev tools reading run buckets: `tools/cdp/inspect-space-state.js:44-45, 56`, `tools/cdp/space-summary.js:51-52`, `tools/cdp/storage-read-profile.js:15, 82`, `tools/cdp/wal-snapshot-benchmark.js:152`.
- Stored copies on profiles (not deleted; deletion needs your yes): the whole-map run key, its 32 bucket keys, and the layout marker.

Decision (25 Oct): no import. The release starts from scratch, so run history from before 24 Oct is dropped (option b below). Before the excise, check:
- From reading the startup path, the disk copy of the run list is read, then replaced by the runs replayed from the log (`sw.js:11077-11079`). The recovery is given the queue snapshot and the log store, not the disk runs. So run history that exists only on disk is not shown after startup. This is not confirmed on a live profile.
- Many tests seed the whole-map run key and pass. Check that they do not pass for the wrong reason before the excise.
- Chosen: (b). Excise without import, since the release starts from scratch. (Not taken: a one-time import, or a read-only import for one release.)

## Fresh-start excise: legacy and one-time code (decision 2 consequence)

With a fresh start, one-time migrations, repairs and legacy readers have no job. Candidates for removal, each with its tests. Each needs a check that no current path depends on it.
- Space-map layout migration: `sw.js:10446-10470` (`migrateSpaceMapLayout`). The bucket layout stays. Check that a fresh profile needs no migration step to start.
- Startup progress repair: `sw.js:10417` (`repairProfileProgressProjection`). It repairs older projection shapes.
- Retired key cleanup: `sw.js:8033` (`cleanupRetiredCoordinatorQueueWalPhysicalKeys`) with `shared/js/swCoordinatorQueueWal.js:245` (`getRetiredCoordinatorQueueWalPhysicalKeys`).
- Legacy queue-view and content-index cleanup, a startup deletion path: `sw.js:36922-36993` (`retireLegacyQueueViewStorageKey`, `LEGACY_CONTENT_INDEX_CLEANUP_MARKER_KEY`, its read and write helpers, `getLegacyContentIndexCleanupNames`, `retireLegacyContentIndexKeys`).
- Migrated-operations set: `sw.js:906` (`COORDINATOR_QUEUE_WAL_MIGRATED_OPERATIONS`). Check its callers.
- Legacy slug shadow cut: `shared/js/subject.js:248-289` (`LEGACY_SHADOW_CUT_PATTERNS`, `legacyDescriptiveTailCut`, `legacyStrippedSuffix`). Under the identity rule (exact, case-sensitive, no suffix stripped), check whether anything uses these for live decisions. If they only measure, they are instrumentation.
- Other "legacy" mentions to review: `sw.js` (43), `spaceMapStorage.js` (8), `subject.js` (6), `content.js` (6), `walSnapshotStore.js` (3), `swQueueWalStore.js` (3), `timeouts.js` (2), `swResumeQueueExecutionDecisions.js` (1), `swProfileNukeProgress.js` (1).
- Tests that seed legacy keys (for example `LEGACY_PROFILE_PROGRESS_KEY` in `test/swSynthetic.test.js`) change with the code.
- Stored copies on existing profiles: no deletion code. A clean reinstall or profile reset removes them. Deleting them on a profile that is kept needs your yes, and none is added.

## Section 3 addendum (decision 3)

Remove the analysis instrumentation:
- Progress shadow WAL: `sw.js:1024-1031` (state), `:904` (record limit), `:9331-9490` (append path), call site `:34287-34350`, result fields `:34388-34436`. Tests: `test/swSynthetic.test.js` (about lines 3447-3549, 5101-5183, 5318, 5398) and `test/lib/swHarness.js` (556-557, 787, 833).
- Coordinator-authority shadow WAL: `sw.js:9039-9198`, call at `:10778`.
- Deep-pending shadow compare: `sw.js:9928` (update call), `:18718-18737` (update), `:18738` (snapshot), `:18780` (compare), uses at `:19278` and `:19958`. Keep the classification reuse cache, which is a separate change.
- Runs gap watch and store-size sampler: `sw.js:2680-2712` and their calls (see the runs plan).

Keep: the flight recorder's persisted snapshot and its tunables (the persist function is near `sw.js:5822-5836`).

Review after the live measurement, not cut now: the no-response probe fields, and the write-size panel and histogram.

## Section 5 addendum (decision 5)

The flight recorder's persisted snapshot stays. The analysis-only events that feed it go: the gap check and the store-size samples. The shadow checks report only counters. The live measurement of session storage is still open; the owner chooses when.

## Section 7 addendum (decision 6): cruft and constants

- Erase keep list: `sw.js:22356` (an empty set) and `:22390` (the filter). Remove both and keep the in-flight refusal.
- Write-only state: `shared/js/content.js:10626` and `:11033` (`lastSpaceFeedRenderModel`).
- Stale comment: `shared/js/coordinator.js` around lines 839-840 describes the old events log.
- Constants outside the tunables file: `sw.js:387` (`EXECUTOR_CLASSIFY_BACKSTOP_MS`) and `sw.js:28996` (`ORPHAN_SURFACE_TAB_GRACE_MS`). The memory notes also list `QUEUED_TAB_CREATE_TIMEOUT_MS`, `DASHBOARD_COMPACT_REFRESH_INTERVAL_MS` and the `MAX_COORDINATOR_*` caps. These were not re-checked on 25 Oct.
- `shared/js/timeouts.js` overlaps `shared/js/tunables.js`. Merge them, as the memory plan says, after checking the importers.
- Dev tool: `tools/cdp/upgrade-regression/run.js:1237-1238` reads the whole-map space keys. Switch it to the bucket reader.

## Appendix A: documentation consolidation (decision 7)

Inventory at 25 Oct: about 85 tracked markdown files (mostly dated handoffs, reviews and plans from May to September); 68 untracked markdown files in the root and `docs/`; over 100 files under `experiments/` (probe code, results, notes); three `tools/*/README.md`. Junk and swap files are listed in section 8.

Proposed categories. No moves yet.
- Authoritative, keep and update: `AGENTS.md`; `architecture.md` (dated 20 May; update the storage section for runs in the log, progress in session memory, space maps as buckets); `planning.md` (dated 15 Oct; update "Where We Have Landed" and "Loose Ends"); `docs/queue-storage-layering.md` (untracked; mark section 6 parked and the phase status); `docs/queue-storage-inventory-2026-10-11.md` (generated; keep); `entropy-reduction-action-plan-2026-09-09.md` (AGENTS requires reading it; label it as reference, not a plan).
- Reference, keep and label: the three `tools/*/README.md`; `User-Installation.md`; `release-summary-1.6-aka-2.0.md`; `timeout-inventory-1.6.md` (refresh after the timeouts merge); `queue-wakeup-metrics-model-2026-05-20.md` (refresh the counter names).
- Needs the owner's call: `readme.md`, `housekeeping.md`, `user-note.md`, `space-page-redraw-plan-2026-10-24.md` (dated today, may be active in the other session), `mute-block-ios-safari-plan.md`, `upgrade-regression-plan.md`, the `live-testing-todo-*` files, `historical/parallel-test-split-plan.md`, `regression-test-suite-ideas-2026-05-18.md`, `more-fuzz-tests.md`, `labeler-management-note.md`, `nuclear-source-enrollment-note.md`, `quora-labeler-bridge.md`, `historical/sunday-notes.md`, `historical/claude-notes.md`, `historical/codebase-familiarization-notes-2026-08-28.md`, the `atproto-*` notes, `blockzooka-writeup.md`.
- Archive: move each dated handoff, review, reply, response, nits, codex-review, coder-instruction and design draft whose decision is made or superseded to `docs/archive/`, with one index line each. That includes the 14 Oct review and reply series, the codex-review files, the `handoff-*` files, the May `refactor-*`, `storage-*`, `shared-moderation-*` and `review-*` plans, the `unified-store-*` files, `progress-durability-design`, `pending-staging-design`, `projection-cost-design-note`, `pause-owned-tab-order-options`, `window-slot-release-options`, `hunk-map`, `legacy-index-cleanup-design`, `events-to-flight-recorder-design`, `progress-path-review`, `clear-history`, `suffix-cutting-discussion`, `consul-investigation-session`, `direct-api-used`, `fight-to-flight`, `mutated-running-total-audit-todo`, `cesc-fabregas-*`, and the `blockzooka-*` drafts (product or archive: owner's call).
- Experiments: keep the folder, add `experiments/README.md` with one line per probe and its finding, and a `.gitignore` for large outputs. The owner says whether they stay in the repo.
- Memory pointers: moved files break memory notes that cite them (the 14 Oct review files, the progress review, the coder instructions). Update those notes when the moves happen.

## Appendix B: still open (not decided, not executed)

- Progress copies (decision 4): the worker's module-level copy (`sw.js:974`, 30 assignment sites), the content-script copy (`shared/js/content.js:282`, 10 sites), and the resident store.
- Live measurement of session storage: needs your go, with the queue paused.
- Legacy stored copies on profiles: owner (25 Oct) said ignore for now. No deletion code.
- Branches and worktrees: `worker-writer-design` (12 commits, unmerged), four `worktree-agent-*` branches, and `.claude/` at 1.2 GB.
- History: b20be9e (v1.6.1558) bundles the builds between v1.6.1469 and v1.6.1558 with no commit or tag for them.
- Build: none. The packaged artifacts do not match the source. A build waits for a live run, per your standing rule.

Scope: the 17 commits from 8b245a1 (v1.6.1435, 20 Oct) to b20be9e (v1.6.1558, 24 Oct). Nothing was edited, built or committed for this review. The working tree has no tracked changes.

What was checked:
- Commit bodies for the range, read in full.
- Identifiers declared in the added lines of the range (648 names): none is defined without any use. 84 are used exactly once more, mostly as helpers. "Dead" below means reachable in theory but not in normal operation, which the scan cannot show.
- Each suspect item traced through its callers, by reading the code. No live run was done, so runtime behaviour below is inferred.
- `npm test`: exit 0, 1,315 ok, 0 not ok. All 44 test files are listed in the test script. (This was the earlier run; see "Not verified".)
- 25 Oct: owner answers recorded, and the working tree checked with `git status` and reads only. No build and no test run that day.

## Summary as of 24 Oct (history; the findings summary at the top is current)

| # | Item | Kind | State |
|---|------|------|-------|
| 1 | Worker-copy recovery for torn checkpoints ("Recovery B") | Parked item built | Live and tested. Owner decision needed |
| 2 | Run list: buckets (20 Oct), then log records (24 Oct) | Dead-end, still wired | Old write path, startup migration, gap diagnostic and two dev tools still use it |
| 3 | Shadow checks in the write path | Digression | Live, measurement only, no decision reads them |
| 4 | Progress held in many in-memory copies | Known deviation (owner: not critical) | Progress is in session storage only (verified). Copies: 30 writer sites in the worker, 10 in the content script, plus a shadow copy |
| 5 | Session storage headroom | Risk | Estimated near the cap, never measured live |
| 6 | Instrumentation growth | Digression | About 53 counters and 21 event kinds added in four days; 1 kind removed |
| 7 | Smaller leftovers | Dead-end, minor | Empty keep list, write-only variable, stale comment, raw legacy reads in two dev tools, two constants outside tunables |
| 8 | Repo state | Hygiene | Untracked plan docs, junk files, an unmerged 12-commit branch, one bundled commit |

## Clean

- The two reverts left no residue. The summary-view drop has no identifiers left. The escalating menu wait is gone (fixed 500 ms), and its measurement is recorded in the tunables file.
- Every test file runs, and the suite passes.
- Commit bodies record decisions and measurements well.

## 1. Worker-copy recovery (parked "Recovery B")

- Added in b20be9e. The commit message does not mention it. Function at `shared/js/swQueueWalStore.js:220`, called at `:416`.
- Behaviour: when the session-mirror copy of a checkpoint is refused, the worker's own copy is used if it verifies, and the torn slot is written back. Test: `test/swQueueWalStore.test.js:253-293`.
- Conflict: the defer note (`project_defer_pile`, items 1 and 3) lists this as parked, and keeps fail-closed behaviour for a torn switch. The note also says the disk meta is never written. The code writes the slot back, not the meta.
- Owner (25 Oct): stays parked until shown to be needed. The working-tree excise is kept. Update the defer note when the excise is committed.

## 2. Run list: superseded layout still wired

- 20 Oct (576b10a): the run list moved to 32 hash buckets with a layout marker. 24 Oct (b20be9e): runs became log records, and the message says runs are "no longer disk buckets".
- What still runs:
  - Normal writes: runs are taken out of the stored payload (`takeRunsPartFromChange`, around `shared/js/sw.js:10083`), so the bucket writer does not get them. Its only live use is the migration.
  - Startup migration: `migrateSpaceMapLayout` (around `sw.js:10448-10470`) still writes the run list as buckets when the run layout is not marked bucketed. A fresh profile starts unmarked. Read from the code, not run.
  - Frozen baseline: the bucket baseline is set at load (`sw.js:2631`) and in `commitRunsDiskWrite` (`sw.js:2647-2650`), which only runs when a disk write carried runs. After 24 Oct it stays at the copy loaded at startup.
  - Gap diagnostic: `recordRunsResidentDiskGap` (`sw.js:2656`) compares resident runs against that frozen baseline. It runs on the 30 s timed-run watch (`startRunsGapWatch`, `sw.js:2700`, tick at `:2707`) and after each reconcile pass (`sw.js:12148`). After any run change since startup it will record "runs-disk-gap". The question it was built for (B15a) is answered by the move to log records, so its output now means little.
  - Dev tools: `tools/cdp/inspect-space-state.js:44-45` and `tools/cdp/space-summary.js:51-52` read the run buckets, which are no longer updated.
- Owner (25 Oct): excise, with no import of old data. Remove the bucket write path and the runs part of the migration, remove the gap watch and its two calls, and point the dev tools at the log reader. The stored legacy run-list copies stay (ignore for now).

## 3. Shadow checks in the write path (measurement only)

- Progress shadow WAL: state at `shared/js/sw.js:1024-1031`, checkpoint limit `:904` (128 records), append path `:9331-9490`, call site in the row-event path `:34287-34350`, per-row fields returned at `:34388-34409`. It keeps an in-memory copy of every progress record seen this session (never trimmed). Readers: counters only. Pinned by `test/swSynthetic.test.js` around lines 3447-3549, 5101-5183, 5318 and 5398.
  - Origin: introduced in the 25 May 2026 release (1.6.551) and extended on 1 June (1.6.840). It is older than this review window.
  - Stated purpose: the May plan (`historical/retrospective-history.md`, step 3) puts a shadow WAL for progress milestones before any path becomes WAL-first, and only once replay has matched. Progress is memory-only now (decision 31), so there is no WAL-first step for this to gate.
- Coordinator-authority shadow WAL: `sw.js:9039-9126`, called at `:10778`. Readers: counters only. Introduced in the 25 May release (1.6.551).
- Deep-pending shadow check (commit a429bfe, 22 Oct): `updateDeepPendingShadowRows` at `sw.js:9928` (each queue write) and `:18718`. `snapshotDeepPendingExpected` (`:18738`) walks the apply window and builds a runtime-surface index on each apply pass, called from `runCoordinatorExecutorApplyPhase` (`:19278`). `compareDeepPendingShadow` (`:18780`, called `:19958`) writes a flight-recorder entry only when the two differ. This is extra work on the path the optimisation was meant to speed up.
- Owner (25 Oct): reduce. Remove all three, and record any measured answer in the commit that removes them. The progress shadow was a stage before WAL-first, and progress is no longer heading there, so its stage has no next step.

## 4. Progress copies (owner: not critical; recorded, not fixed)

- Progress keys are written to session storage only, by one function (`writeProfileNukeProgressSession`, `sw.js:7358`; decision 31 path at `:10319-10334`). No progress key goes to disk.
- In-memory copies that have to stay in step:
  - worker module-level copy, `sw.js:974`, 30 assignment sites;
  - content-script copy, `shared/js/content.js:282`, 10 assignment sites;
  - the shadow WAL's copy (item 3);
  - the resident store read by the write path.
  `sw.js:11133` notes that only some writers keep the module-level copy current.
- For later: one resident copy in the worker, read everywhere else through the worker, with the content copy as a cache keyed by a generation number. Not now.

## 5. Session storage headroom

- Estimates in the 19-20 Oct notes: progress about 5.35 MiB, the session copy of the queue log about 3.2 MiB, runs about 0.2 MiB, recorder snapshot up to about 0.5 MiB. Total about 9.25 MiB against a 10 MiB cap.
- No quota check on session writes in the code. The 100 MB soft quota (`sw.js:662`) applies to local storage only. A refused progress write shows only as a "not saved" metric.
- The upgrade regression was not run live (commit 8b245a1 says so).
- Recommendation: measure a live profile before the next release. This needs the owner's go, with the queue paused.

## 6. Instrumentation growth

- Since 20 Oct: about 53 new queue-wakeup counter names and 21 new flight-recorder event kinds, with 1 kind removed. Counted from added lines, so approximate.
- Retire diagnostics whose question has an answer: the runs gap check, the store-size sampler (same timer), the shadow checks in item 3, and the no-response probe fields once their question is closed. Keep a short list with the question and a retirement condition for each one that stays.

## 7. Smaller leftovers

- Erase keep list: `ERASE_BLOCK_HISTORY_KEEP_KEYS` is an empty `Set` (`sw.js:22356`) and still filters the erase (`:22390`). The owner asked for no keep list on 22 Oct. Remove the mechanism; keep the in-flight refusal.
- Write-only state: `lastSpaceFeedRenderModel` is set (`shared/js/content.js:11033`) and never read (declared at `:10626`).
- Stale comment: `shared/js/coordinator.js` around line 839 says Clear All Stats wipes the `mbCoordinatorEvents` log. Since 7068380 the events live in the recorder and the old key is left in place.
- Raw legacy reads: `tools/cdp/upgrade-regression/run.js:1237-1238` reads the whole-map space keys, which are stale after the migration. The benchmark tool at `:158` uses the bucket reader; the first draft was wrong about it.
- Tunables outside the tunables file: `EXECUTOR_CLASSIFY_BACKSTOP_MS` (`sw.js:387`) and `ORPHAN_SURFACE_TAB_GRACE_MS` (`sw.js:28996`). The standing rule puts these in `shared/js/tunables.js`.
- Legacy disk copies: the two whole-map space keys (about 4 MB together per the 20 Oct notes), the legacy run-list key, the legacy events key and the legacy content-index copies. Owner (25 Oct): ignore for now. No deletion code.

## 8. Repo state

- Untracked: `docs/` (3 files, including `docs/queue-storage-layering.md`, which the memory calls the source of truth), `experiments/`, `tmp/` (478 build logs), `.claude/` (1.2 GB in total, including the agent worktrees; the worktrees were not measured separately), and about 45 root notes and diffs.
- Junk at the root: a 7.8 MB V8 profiler log, a 2.0 MB DevTools dump (`don.json`), two 12 KB stale diffs (`outliers.diff`, `newmod.diff`), two zero-byte entries (`npm`, `mute-block@1.6.1211`), two stray text files (`r`, `rcopy`), and one file with a mangled name. Three vim swap files (`.approaches.txt.swp`, `.nite6.md.swp`, `.nits7.md.swp`).
- Branches and worktrees: `worker-writer-design` is 12 commits ahead of main, none behind, last commit 21 Oct, checked out in a sibling worktree. Four `worktree-agent-*` branches and several `claude/*` worktrees are unmerged.
- Bundling: b20be9e (v1.6.1558) covers everything since d012207 (v1.6.1469) in one commit. No commit or tag exists for the builds in between. Its message does not mention Recovery B, and the space-feed, queue-bar and recorder changes are described only in passing.

## Decisions for the owner (answers, 25 Oct)

1. Recovery B: stays parked until shown to be needed. The working-tree edits stay.
2. Run list: excise the bucket path, with no import of old data. The release starts from scratch.
3. Shadow checks: reduce, which means removing the analysis-only checks.
4. Progress copies: an open issue. No change now.
5. Flight recorder snapshot: keep it. Remove the analysis-only events that feed it. Live storage measurement: still open.
6. Legacy disk copies: ignore for now. No deletion code.
7. Documentation: consolidation wanted. The categories in Appendix A need approval before any file moves.
8. Storage-layout constants (shard and bucket counts that set key names) go to `storageKeys.js`. Timing and caps stay in `tunables.js`. The two progress counts have already moved in the working tree, by another session.

Not yet decided: repo hygiene and unmerged work (findings 10 and 11). Also the other session's changes (finding 12).

## Not verified

- No live run. Whether fresh profiles get run buckets written, and what the gap events show live, come from reading the code.
- Classification cache: five explicit bump sites. I did not audit every queue writer for a missing bump. The 30 s backstop bounds how stale a decision can be.
- Storage figures are from the 19-20 Oct notes, not new measurements.
- The 25 Oct edits are not tested or built.
- The working tree includes another session's changes. This review did not examine them beyond the two files listed under "Working tree".

## Appendix C: magic-number audit (25 Oct)

Scope and method
- Parsed every JavaScript file under `shared/js` and `tools` (234 files; none failed) with the repo's own acorn parser. Recorded 8,929 numeric literal sites with their syntactic context. Build bundles, tests and CSS are not included.
- Left out as trivial: 0, 1 and -1; array and property indexes; radix and format arguments (`parseInt`, `padStart`, `toString(16)`, `toFixed`); unit conversions (24, 60, 1000, 60000, 3600000 and 86400000 used with `*` or `/`); small arithmetic (9 or less, with `+ - * /`). That leaves 2,156 non-trivial sites.
- Of those: 83 are registry values in the tunables and timeouts files, the one place they belong. 157 are top-level constants in product code outside the registries. 1,047 are inline in product code. 856 are inline in tools.
- Concept labels come from identifier tokens and from the callee of timing helpers. They are a first pass. The `score` group (C.4) needs a manual read.
- Full list: `magic-number-audit-2026-10-25.tsv` in the repo root, one row per non-trivial site outside the registries (2,073 rows). The scanner and report script are in the session scratchpad and are not committed. They can move under `tools/` if you want the audit rerun.

Where a constant goes (owner, 25 Oct)
- A constant that sets a storage key name or a storage layout goes in `shared/js/storageKeys.js`. Changing it renames or reshards stored data. The p1 contract test already enforces single declaration for names in that module.
- A timing, cadence, cap or limit that changes behaviour goes in `shared/js/tunables.js`. Timeouts go in the timeouts registry until the merge.
- Colours stay in the token files. Protocol and schema versions stay with their module, named.

C.1 Shard and bucket counts

| Value | Definition | Use | Destination |
|---|---|---|---|
| 256 | `PROFILE_NUKE_PROGRESS_SHARD_COUNT` | Live progress shards | storageKeys.js (moved, in progress) |
| 32 | `LEGACY_PROFILE_NUKE_PROGRESS_SHARD_COUNT` | Legacy cleanup only | storageKeys.js (moved, in progress). Goes with the fresh-start excise |
| 32 | `SPACE_MAP_BUCKET_COUNT` (`shared/js/spaceMapStorage.js:11`) | Live: space post map keys `b00` to `b1f` | Move to storageKeys.js |
| 32 | `COORDINATOR_CONTENT_SOURCE_INDEX_SHARD_COUNT` (`shared/js/sw.js:725`) | In-memory derived index, and legacy cleanup | Move to storageKeys.js. Check the derived use |
| 32 | `COORDINATOR_CONTENT_QUEUE_INDEX_SHARD_COUNT` (`shared/js/sw.js:732`) | Same as above | Move to storageKeys.js. Check the derived use |
| 10 | `CHECKPOINT_SHARD_DEFAULT_COUNT` (`shared/js/walSnapshotStore.js:24`) | Live: queue WAL checkpoint shard keys | Move to storageKeys.js |
| 1 (default) | `bucketCount = 1` in four helpers (`shared/js/swprojections.js:1, 13, 19, 24`) | Live. A caller that omits the count gets one shard with no error | Remove the default so a missing count fails |
| 32 (loop bounds) | `tools/cdp/inspect-space-state.js:45, 51`; `tools/cdp/space-summary.js:52, 58`; `tools/cdp/wal-snapshot-benchmark.js:145` | Dev tools | Require the constant from storageKeys.js. Tools run under Node and the module uses `module.exports` |
| 48 | `DEFAULT_SYNTHETIC_SHARDS` (`tools/run-tests-parallel.js:10`) | Test runner, a different concept | Leave local, named |
| 31 and 2166136261 | String hash multiplier (`swprojections.js:8`) and FNV offset basis (`walSnapshotStore.js:42`) | Live hash constants | Name them beside the hash functions |

Notes on C.1:
- The 256 for progress and the 32 for the other layouts have no recorded reason. The storageKeys comment says what the count does, not why it differs. If the difference is deliberate, say so there.
- The move of the two progress counts is in the working tree. The old declarations are gone from `sw.js`, and a grep finds none left outside storageKeys.js. The p1 contract test has not been run on this state.

C.2 Repeated values in product code (inline sites)
- 1000 ms: 272 sites in 17 files. 231 are the first argument of `scheduleCoordinatorReconcile` (116) and `scheduleCoordinatorQueueResume` (115), mostly in `sw.js`. One named cadence in tunables.js.
- 240: 42 sites in 8 files. 34 are `slice(0, 240)` truncations of error text, 29 of the 42 in `sw.js`. One named text limit in tunables.js.
- Wait and poll helpers: 154 product sites (`waitForCondition`, `sleep`, `waitForAction`, `waitForProfileMenuState`, `promiseWithTimeout`, `ensureProfileMenuOpen`, `requestCloseTab` and similar), with values from 100 to 8000 ms. These belong in the timeouts registry.
- 277 product sites are first arguments of `schedule*` calls. All are delays, and the 1000 group is most of them.

C.3 Inline timing literals in product code
- 525 sites: `sw.js` 231, `content.js` 223, and 12 other files. Named values exist for only part of them.

C.4 Scoring values in content.js
- 99 sites assign literals to variables named `score`. They look like heuristic scores, not timings. A manual read is needed to tell weights from thresholds. Recommendation: one named scoring table, with the meaning beside each value.

C.5 Constants declared outside the registries
- 157 product constants: `sw.js` 91, `content.js` 47, `coordinator.js` 4, and 15 more across 10 files.
- `content.js` is bundled into one file (the manifest lists `js/content.js`), and it already requires `./tunables` (line 61). Moving its constants into tunables.js needs no new mechanism.

C.6 Tools
- 856 inline literals, 317 of them timing. Mostly CDP and test waits in dev scripts. Lower priority.
- Port 9222 (Chrome DevTools) is defined or typed in four places: `tools/cdp/clear-coordinator-test-state.js:30`, `tools/cdp/lib/cdp.js:5`, `tools/cdp/start-windows-debug-browser.js:18`, `tools/cdp/upgrade-regression/run.js:28`. Port 9224 (BiDi) is in three: `tools/cdp/windows-chrome-profile.js:5, 6` and `tools/firefox-bidi/lib/bidi.js:2`. One default per family.

C.7 Priorities for the coder
1. Finish the shard-count move: the four layout counts in C.1 go to storageKeys.js. Run the p1 contract test. Tools require the constant.
2. Remove the default of 1 from the bucket-count helpers.
3. The 1000 ms cadence (C.2): one named value.
4. The 240 text limit (C.2): one named value.
5. Wait and poll defaults (C.2) into the timeouts registry, then merge timeouts.js into tunables.js, as the memory plan says.
6. The 47 `content.js` constants and the 91 `sw.js` constants into tunables.js, by the rule above.
7. The scoring table (C.4), after a manual read.
8. Tools: one port default per family, and the shard loop bounds from storageKeys.js (C.6).
