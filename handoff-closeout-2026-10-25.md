# Handoff: WAL / log closeout, late 25 Oct 2026

Untracked, like the other handoff notes. Read this first. It supersedes the status parts of `handoff-2026-10-25.md`.

## Status in one paragraph

Closeout steps 4 and 5 are built behind no switch. Arrival-order shards are the only layout now. Completed-work limits are the Recent History settings. The History page is the completed-work log, answered by message. Manual blocks and pardons are completed rows. The History page shows status, outcome, attempt, source, time and error, with errors in red, and it can sort by status. The dev build is 1.6.1625. Nothing is committed. The last live check was not done: the dev browser still needs a reload to pick up the latest build, and the manual buttons have not been pressed on a live profile since the completed-log change.

## Versions and git

- `package.json` and the four version files: **1.6.1625**. `chrome-dev/` and `chrome/` were built at 1.6.1625 (`npm run prod` then `npm run build:chrome-dev`).
- HEAD: `5e334c2` (v1.6.1605). Everything since is uncommitted: about 165 tracked files and 33 untracked (new modules, notes and scratch). Some of the tracked changes were made by someone else during the work (`tools/cdp/*.js` deletions, `chrome/js/popup.js`, edits to `test/swSynthetic.test.js`, `tools/run-tests-parallel.js`, `tunables.js`). Review the diff before any commit. The `sw.js` changes are not one commit's worth: split by hunk.
- No tags, no zips.

## Built (uncommitted)

**Checkpoint and storage (G0, G1 prep, G3, G4 step 4)**
- Save-check fix and guard test (in HEAD `5e334c2`).
- Changed-shard writer (step 2) and per-slot GC (step 3): stale shard indexes are cleared with `null` in the same payload as the manifest. `test/walShardGc.test.js`.
- Queue row shards (step 4): rows carry `shard`; a row that becomes queued moves to the tail in the same row value. Always on. `shared/js/swQueueWalRowShard.js`, `test/swQueueWalRowShard.test.js`, `test/walQueueRowShards.test.js`.
- Hydrate atomic read now also fetches manifest-listed shard ids past index 9 (`getArrivalShardKeysMissingFromStored`, `swQueueWalStore.js`).
- Tail is rebuilt on hydrate and seed.

**Completed log (G5, step 5)**
- Archived rows carry `completedShard` (arrival order). `shared/js/swCompletedShards.js`, `test/swCompletedShards.test.js`.
- Limits enforced at checkpoint time, on whole shards: age past `nukedPostRetentionDays` and row cap `maxRememberedNukedPosts`. 0 turns a limit off. The resident map drops the shards only after the save succeeds.
- Layout is always arrival now; the switch was removed (owner: "we're just converting").

**Runs (owner: hardcoded cap, a week at 100 a day)**
- Run cap is 700 runs, hardcoded in `shared/js/swRunsWal.js` (`RUN_RETENTION_MAX_COUNT`). Runs carry `runShard`; the cap drops whole shards, oldest first, skipping any shard holding a run a queue row refers to. `shared/js/swRunShards.js`, `test/runShards.test.js`.
- Applies in every build. This is a behaviour change for everyone.

**Preferences page**
- Target Concurrency card removed (the worker still uses its default of 4).
- "Recent History Retention (days)" and "Recent History Entry Cap" are the completed-work limits. Their hints say whichever limit is hit first prunes. The worker reads them live via `storage.onChanged` in `swBootstrap.js`.
- Queue Row Shards and Completed Work cards were removed.

**Manual actions and History**
- Extension's Mute Block button on a profile page: on success, `record-manual-profile-action` (`kind: block`) writes a completed row (`history:<time>:<profile>`, `origin: 'manual'`, outcome `blocked`).
- Unblock button: on `result.ok`, `kind: pardon` writes a completed row with actionKind `unblock-unmute`, outcome `unblocked`.
- The nuked-post memory no longer feeds History. Space-feed confirms still write the memory for the feed's own use.
- Successful archives of space nukes settle into the completed log via `SPACE_FEED_PROFILES_CONFIRM` (the gap found in the flight recorder: profiles finished through the archive path left no history).
- History page (`shared/js/coordinator.js`): rows come from the worker by message (`get-recent-history`, with `since`). Full query on open and every 60 s; incremental query every 2 s; `recent-history-changed` broadcast triggers an incremental query. Worker side: a last-change time (`residentCompletedLastChangedAt`) lets a query return at once when nothing changed; otherwise it walks the time-ordered log from the newest end and stops at the first row the page has. Copies only the rows returned. No index.
- Clear empties the page's list and records a timestamp (`historyClearedAt`); it deletes nothing from storage.
- Rows show: Succeeded/Failed/Skipped/Canceled, outcome (spaces for hyphens), attempt if > 1, Manual/Space, time, error text. Rows with an error (status failed, or error text present) use `.row--history-error` (`--mb-red-800`).
- Sort control `#historySort`: Newest first (default) or By status (failed, skipped, canceled, succeeded; newest first inside each).

**Profile keys**
- `shared/js/subject.js`: one closed-set tail is stripped from the profile slug when the key is formed: `-log`, `-answers`, `-questions`, `-posts`, `-share-N`, `-ch-N`. Lower-case only (owner rule: identity is case-exact). Existing rows keep their old keys.

## Verification done

- `npm run test:parallel`: **53 of 53** lanes pass (last run after the subject change).
- `swSynthetic`: 709 of 709, with the arrival layout (the default now).
- Scenario fuzz and `walUsersSynthetic`: pass.
- New unit tests: shard tails, completed shards (incl. WAL round trip), run shards, manual history rows, subject tail strip (via `subject.test.js`).
- Dev build 1.6.1625 produced; `chrome-dev/coordinator.html` contains `#historySort`.
- Not done: any live browser run on 1606+ builds except the earlier reads of the dev browser (dashboard showed 1614, History empty after the erase).

## Live check status

- **Completed (earlier, on 1606):** nothing conclusive. The G1 agent stopped at the build gate; the erase was refused (`queue-row-active`). Dev primary: paused, dashboard tab open.
- **Space nuke run (on 1614):** 14 profiles blocked (dashboard: 14 succeeded, queue empty). History stayed empty because the archive path did not settle into memory. Fixed in 1615 and then superseded by the completed-log design (1617+).
- **Not yet verified:** a manual block and a manual pardon end to end; the History page showing manual rows; the sort; the red error rows on a fresh run; the shard layout on a live store (checkpoint bytes and shard counts); the run cap and the completed-log prune firing with short limits.
- Four error rows (`Levi-Gurule-1-log`, `Josh-Kates-4-answers`, `A-P-3624-answers`, `Local-Business-Growth-3-log`) are Skipped / "profile unavailable". Their four tabs are still open (titles "(2) Error"). The worker does not close tabs it skips for an unavailable profile.

## Open items

1. Reload the dev extension (fresh extensions tab) and confirm 1.6.1625. Then reopen History.
2. Validate manual block and pardon on a throwaway profile; check both rows appear, with the right status and outcome.
3. Decide: should the worker close tabs it skips as "profile unavailable"?
4. Clear semantics are page-only. If you ever want a disk clear for the completed log, that is a new, destructive action. Not built.
5. Dashboard stats: manual blocks are `succeeded` + `blocked` rows and may count in the dashboard's blocked totals. Decide whether to exclude `origin: 'manual'`.
6. Settle still writes the nuked-post memory on space confirms. Nothing reads it for History now. Decide whether to keep it for the feed or remove it.
7. Old keys: rows that carry `-log`/`-answers` in their href keep those keys. No migration (owner: storage cleared with the change; erase covers it).
8. Erase resets preferences to defaults too (90 days, 10,000 entries).
9. Queue tail-move audit (step 4 prerequisite) is a grep-scoped inventory, not proven complete. Live run would confirm.
10. Firefox and `build:chrome` zips not built (owner: Chrome dev only for now).
11. Run cap is not in any checkpoint; runs are log records and are removed by `map.remove` in the write that drops their shard. Worth a live check.

## Owner decisions this session (keep)

- Strip closed-set tails as the key (option 2), with lower-case match only.
- Recent History = completed-work log for History. Manual blocks and pardons are completed rows.
- Limits: 90 days and 10,000 rows, the existing Recent History settings; whichever is hit first prunes; shard-granular, loose by one shard.
- Run cap: 700 runs, hardcoded.
- Target Concurrency card removed from the page.
- Clear empties the page only; storage is untouched.
- Error rows red; sort by status available.

## Commands

- Build: bump the four version files first (`package.json`, `package-lock.json`, `manifests/chrome.json`, `manifests/firefox.json`), then `npm run prod`, then `npm run build:chrome-dev`.
- Test: `npm run test:parallel` (53 lanes; new test files must be added to both `package.json`'s `test` chain and `tools/run-tests-parallel.js`).
- Reload the dev extension: `node scratchpad/fresh-extensions-tab.js` (port 9222), then `npm run reload:chrome-dev`. Pause right away.
- Read-only inspection helpers used this session: `tools/cdp/lib/cdp.js` (`evaluate`, `getTargets`), with scripts in `C:\Users\dbrower\AppData\Local\Temp\`.

## Pointers

- Closeout plan: `completed-log-shards-plan-2026-10-25.md` (user-edited, tracked; leave alone).
- Suffix rules: `historical/suffix-cutting-discussion-2026-10-14.md`.
- Entropy patterns (read before editing `sw.js`): `entropy-reduction-action-plan-2026-09-09.md`.

## Open items added 26 Oct

Build: 1.6.1635 is built (Chrome dev only, no zips). Everything since 62a67ea is merged into the working tree, and most of it is uncommitted. Commit and tag decision pending.

### Decided and built (uncommitted)
- Space post maps removed. Pending and remembered-post maps are gone; decisions are per profile. Remembered means completed profile history, which keeps its 90-day and 10,000-entry limits.
- Clear no longer touches pending records (there are none).
- Shadow machinery removed from sw.js (about 1,440 lines across sw.js, tests and harness).
- Avg item time card before Avg page load. It averages (terminalAt - activeAt) over finished rows, using the worker's finished-duration pair.
- Save flight recorder: file name mute-block-flight-recorder-YYYY-MM-DDTHH-MM-SS.json, with hover text saying it goes to the browser's download folder.
- Outlier events: gap column; gaps above 500 ms highlighted (OUTLIER_EVENT_GAP_ABNORMAL_MS in tunables.js).
- Runs survive checkpoint switches (fixed a data-loss bug). Runs use time-day shards and the old bucket layout is gone.

### Open: needs an owner decision
1. **Dashboard and space-page flicker (one root cause).** The hot path builds the queue view from live rows only. The dashboard refresh also merges the completed log. Archived rows leave the queue, so every hot push drops them: the Terminal count holds (timing cache) but the finished-duration pair does not, and the Avg item time card shows "--". The space page's Nuke 'Em count also reverts after a queue refresh that omits just-queued rows. Options:
   (a) derive post-write runs before the notify and pass them to the hot-path calls (runs are missing there today);
   (b) merge completed rows into the hot population (costs a read per WAL write);
   (c) ratchet the finished pair in the timing cache as well.
   (a) and (b) are needed together. Decide the cost trade-off first.
2. **Timing cache ratchet.** mergeCoordinatorQueueViewTimingCache ratchets terminal counts and total, but not finishedDurationTotalMs or finishedDurationCount. After a restart the average can rest on fewer rows than the Terminal count. Same fix family as item 1 (c).
3. **sourcePostKey is redundant.** Queue rows already carry evidence[].postKey and evidence[].postUrl (content.js association.evidence; the space page's pending index reads them). My earlier statement that rows carry no post key was wrong. Decide: remove sourcePostKey, or keep it as a copy. Not yet decided.
4. **Runs older than 90 days** are dropped on write by the time-shard retention (new behaviour). Confirm.

### Open: known gaps
5. Pending depends on the queue copy: between enqueue and the next queue refresh, the page has no pending record for the posts.
6. Resolver-only posts (no profile yet) get no nuked judgement.
7. Completed log prunes by whole checkpoint shards, so its limits are approximate.
8. Other checkpoint writers that pass only the queue (swProfileNukeProgress addContentPageStateProjectionPayload; swCoordinatorContentQueueIndex) could drop runs in fallback paths. Not changed.
9. Old unprefixed data from earlier builds is not read or migrated (decision: erase policy). It stays in storage.
10. tools/cdp scripts still read removed keys (inspect-space-state, space-summary, storage-read-profile, wal-snapshot-benchmark, upgrade-regression). They show zero pending. Not updated.
11. Shadow-removal leftovers: a disk-guard test title still says "checkpoint"; some synthetic URL strings contain "Shadow"; 11 unused sw.js imports predate this work.
12. Lane count: reports have said 51 and 53 for the same runner. Confirm what the runner lists.

### Open: documentation and measurement
13. architecture.md: uncommitted rewrite (about 484 lines). Still to do: enumerate every stored key (disk or session, writer, reader, whether still needed) and the major data structures (queue and completed rows, runs, WAL record kinds, checkpoint manifest and shards, progress records, outlier entries, recorder events, metrics view). Include session storage size against the chrome.storage.session quota, after confirming the current quota.
14. Review dispositions: codex-review-1 item 1 (orphan pending) is superseded by removing the pending map. codex-review-1 item 2 (manual progress) is a documented exception. codex-review-2 item 3 (shadow machinery) is removed. codex-review-2 item 4 (architecture) is item 13.
15. Outliers: Phase 3 (row timeout) is not built; the baseline is cumulative; Phase 4 (full-field view) is hover text only.

### Open: live checks not yet done
16. Outlier highlight and gap column; save flight recorder file and folder; Avg item time card (steady, not flickering); space-page Nuke 'Em count after queuing; manual block and pardon end to end (from the 25 Oct list, still open).
17. Save flight recorder uses an anchor download, so the folder is the browser's default. Not verified in a live browser.

### Parked
18. nits7 item 17 (poster memory in asset spaces): planning item. Owner has parked it.
