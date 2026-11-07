# Instructions for the coder, 20 Oct 2026

Status: this file replaces `coder-instructions-2026-10-19.md`, which is retired. Its full text is in `historical/clear-history-2026-10-18.md`, section 12. The 18 Oct file is a stub that points here. Status, 24 Oct: the decisions in section 2 are in force. The work orders in section 0 were largely executed from 1.6.1435 onward (see historical/clear-history-2026-10-18.md, sections 13 to 19, and the git log), so the earlier sentence that nothing was built is out of date. Section 0a still waits for the owner.

Read the whole file once before you start. Line numbers are approximate; search by name.

**Reading list, in order:** `AGENTS.md`; `entropy-reduction-action-plan-2026-09-09.md`; `architecture.md` (Core Authority Model, the terminology section, Cleanup end state); `docs/queue-storage-layering.md`; `progress-durability-design.md`; `legacy-index-cleanup-design.md`; `historical/progress-path-review-2026-10-18.md`; `historical/hunk-map-2026-10-18.md`. Skim `historical/clear-history-2026-10-18.md` for finished items, and don't re-check them.

## 0. Where things stand, and what to do first

Where things stand (20 Oct):

- Profile progress is held in session memory only (decision 31). The code, the tests and the notes are in the working tree, from the 18–19 Oct work. Not built, and not run in a browser.
- The seven review decisions of 20 Oct are in the working tree (clear history, section 14). The tool read, the direct save and the merge fallback now read the stored copy, not the module-level copy. A stored write reports its disk part and its progress part separately. Not built, and not run in a browser.
- The old disk copies of progress and of the content index (131 names) are removed once per browser session, after the authority load (choice K3). Coded and tested offline. Not run live.
- A new worker message returns the whole progress (decision 32). Twelve of the thirteen diagnostic scripts use it now; the thirteenth measures the disk on purpose (section 4a, item 3).
- Unknown: the total session storage used on a live profile. On the dev data, progress alone is about 5.35 MiB and the queue's session copy about 3.2 MiB, against Chrome's 10 MiB session limit (section 3).
- Baseline, run by the author on 20 Oct at 07:20: `npm test` exit 0, 1,236 ok, 0 not ok. The five node lints exit 0. `lint:duplicates` exit 0, 41 clones. Nothing under `shared/`, `test/` or `tools/` had changed since 19 Oct 00:13. Neither the test run nor the lints wrote any file into the repo.
- Latest baseline, after the review decisions of 20 Oct were implemented (clear history, section 14): `npm test` exit 0, 1,241 ok, 0 not ok. The five node lints exit 0. `lint:duplicates` exit 0, 41 clones. Expect these results at the start of the next day.
- No answers from David are recorded for the questions in 0a.

**Start-of-day tasks, in order:**

1. **Baseline test run and lint run.** Do this first, in case anything changed overnight. `bash -lc 'npm test'` (about 10 minutes), then the six lints: `bash -lc 'npm run lint:correctness'`, `lint:queue-boundary`, `lint:block-classification`, `lint:queue-storage-layering`, `lint:no-outside-writes`, `lint:duplicates`. Expect the latest baseline above. If your result differs, stop and report the difference before you change anything. Another session may have changed the tree.
2. **Entropy-reduction check of the 18–19 Oct progress change.** This is the first work task. It was skipped before, and AGENTS.md requires it. Read `entropy-reduction-action-plan-2026-09-09.md` first. Then check each changed area against the recurring problems the plan names: an untyped unioned progress record; stale invariant proxies; unscoped heuristic DOM fallbacks; restricted-domain fields some code paths never populate; delete or reset racing fire-and-forget writers; duplicated constants across files; storage-abstraction leakage; scattered timeout magic numbers. The areas: the progress split in the door; the hydrate session read; the progress push and its subscriptions; the worker's storage-listener guard; the content push case; the legacy cleanup; the tool read handler; the harness storage view. Points to look at: the cleanup and the push are fire-and-forget; the cleanup uses the session and local areas directly; the test harness repeats the progress key rule (is that a duplicate constant worth sharing?). For each area, say whether it is a new instance of a listed problem. Fix single-shape issues only, and list the rest with options.
3. **Progress repair count (4a, item 2).** Offline and read-only, from the saved dev dump (section 3, method). Don't open the live browser. Count the unfinished progress records that have no open queue row. "Unfinished" means not terminal under the progress code's terminal test (`isTerminalProfileNukeRecord`). "Open queue row" means a row in the recovered queue (`recovered.projected.state.queue`) for the same profile href whose status is not terminal under the queue's own terminal test; name that test in your report. Report the count and both definitions. Don't change the repair filter.
4. **Queue bar report and a read-only Firefox check (decisions 9, 11, 13–17, 24).** Read-only, with no browser run. Confirm that the worker answers the action names the content script sends, in both browsers. Confirm that the Firefox content path needs no session storage. Write the bar report (section 8).
5. **Record of the 18–19 Oct changes in the hunk map.** Add a dated section to `historical/hunk-map-2026-10-18.md`. Cover `shared/js/sw.js`, `shared/js/swBootstrap.js`, `shared/js/content.js` and the new `shared/js/swProfileNukeProgressPush.js`. For each changed area, give the note and section it matches: decision 31 (`progress-durability-design.md`, sections 1 and 4), or the cleanup (`legacy-index-cleanup-design.md`). Don't re-run the full 252-hunk pass, and don't rewrite the 18 Oct map.

**Ongoing, and optional:**

6. **Case 5 of the cleanup tests (optional).** Write it only if it needs no timing-sensitive code: an update abandoned between the cleanup's read and its removal, so that the removal is refused and no marker is written. If that can't be done cleanly, say why in the report and leave it out.
7. **Changed files (decision 23).** Before each edit, check that the file has not changed on disk since you read it. Re-check only your own edits in each file, and report every change you did not make.
8. **Notes upkeep.** Keep the working notes live-only. Move finished items into `historical/clear-history-2026-10-18.md` as a new dated section. Keep each open item in the working notes, with its options.

## 0a. Waiting for David: do not start

- **Live run, session size, and the first start (needs David's go, and a build first).** The checklist is in 4a, item 4.
- **Restart and the push (decision 33; choice K5).** Decided 20 Oct: option (a), accept the gap, as the queue bar does. On the revisit-later list (defer pile).
- **Tools that read progress from disk (decision 32).** Option (a) chosen 20 Oct. The clear script sends a worker message that clears progress, accepted only from an extension page. The upgrade regression reads the worker's progress for N. David's expectation (20 Oct): after an update it starts at 0. The harness does not update the extension itself, so no check spans an update. Neither was run live.
- **The helper used only by tests (4a, item 1).** David chose to keep it (20 Oct).
- **Decisions D3 to D9 (progress note, section 3).** Not decided. Keep the current behaviour unless David chooses.
- **Migration (decisions 20, 21, 25).** Waits for approval of the migration design.
- **Events, pending records and the unified store (section 5).** Not started. Each needs David's choices first.
- **Builds, version bumps, zips, commits and tags.** Done 20 Oct for 1.6.1435 (David: build, commit, load): commit 8b245a1 with the annotated tag v1.6.1435. The commit holds the source, tests, tools, manifests, package files, build config, the build outputs and the two release zips. The notes, docs, the fallow config and scratch files are left out. The dev build was reloaded in the browser (load = update the extension there).
- **Choices K1 to K6 (section 2).** Answered 20 Oct: K1, K3 and K5 proceed as built (K5 is the restart gap above). K2, K4 and K6 changed as noted in section 2.
- **Module-level progress copy (progress note, section 6, item 1).** David chose removal (b), and timing A. First step done 20 Oct (David: go): a queue-only executor pass reads the live progress, not the copy the authority took at startup. A test fails without it. Next: the in-memory copy itself. Option A needs its own plan (about 27 places that update it, and the scoped path that is dormant in the shipped code).
- **Startup timing race (progress note, section 6, item 5).** Done 20 Oct (David: go). A startup read that began before a Clear All Stats does not restore the cache it read. A test covers it, and it fails when the guard is removed.

## 1. Rules for all work

- Branch `review/shared-wip`. No commits, tags, branch changes, history rewrites or pushes until David asks.
- No build, version bump, `npm run prod`, `npm run build:*`, zip step, browser reload, browser run or live run until David asks. Allowed: `bash -lc 'npm test'`, the six lints, and `bash -lc 'node test/swSynthetic.test.js "--filter=<text>"'` to run one area.
- Repo-local reads, edits, tests and lints are authorized (AGENTS.md). If a command fails because of sandbox or wrapper noise, retry once through `bash -lc`. Don't ask David for repo-local permission.
- Edit `shared/` source only. `chrome/js`, `firefox/js` and `chrome-dev/js` are build output. Don't hand-edit them.
- Don't revert, delete or untrack anything: not another session's changes, not unclaimed `sw.js` hunks, not `tmp/` files, not stored data, not the saved dev dump.
- Hydrate and startup: keep the await chain of hydrate and the startup path as it is. Put any new read into an existing read. Seed test state into the storage the worker reads before the worker loads, not after. Install spies on storage reads before the worker loads. The reason is recorded in `historical/clear-history-2026-10-18.md`, section 10.
- No promise-hop helpers in `sw.js`. Measure a wait with `Date.now()` around the await.
- Tunables go in `shared/js/tunables.js`. Wait-loop timeouts go in `shared/js/timeouts.js`. Colours go in `shared/css/tokens.css`.
- Single-shape fixes only. For a protocol, threshold, terminal-state or other choice, list the options in your report and don't pick.
- No new disk writes. Progress, projections and queue state live in memory or session storage. Disk gets WAL appends, checkpoints, and the removals in the legacy cleanup only. Every new session key counts toward the session total (section 3).
- Any new test file goes into `npm test` (package.json) and `tools/run-tests-parallel.js`.
- Correctness over speed on hydrate, recovery and startup: prove the state is current rather than trust a cached copy.
- No freeze or lock patterns. Don't restore file modes (755) unless something breaks. Don't refactor proactively.
- Live browser work, once approved: use CDP, never Puppeteer. Use `bash -lc` command shapes. A timed run sets "Run for" before Resume.

## 2. Decisions in force (do not reopen)

2. **Dedupe.** The window governs dedupe. A profile past the window may be queued again. (Unified store, section 5, note A.)
3. **Clear.** Dashboard only. Entries stay for the history page and for dedupe until they age out.
5. **Diagnostic events.** Memory only, folded into the flight recorder, once the two reconcile reads move to durable fields (section 5, note B).
6. **Checkpoints.** Count only: switch at 128 appends, force at 256. No byte ceiling.
7. **Pending staging.** Lives in session storage, written by the worker and not the tab. Migration drops: section 5, note C, and decision 25.
8. **Build.** Waits for David's go. Then one timed live run, with the "Run for" limit set before Resume.
9. **Queue bar messages.** Content asks the worker for the summary by runtime message. The worker pushes changes to Quora tabs with `tabs.sendMessage`. No session storage and no `setAccessLevel` for the bar.
10. **601f-pass changes kept.** The content index is off disk and built in memory. The delayed rebuild and the hidden index writer are removed. The pause fixes are in. Item 1c is covered by decision 31. Items 1d to 1f still write to disk and stay open.
11. **Queue bar hook.** One hook in `notifyCoordinatorDashboardStateChanged`. Clear writes an explicit zero summary.
12. **Candidate list.** Each queue row's evidence carries the full candidate list, written at enqueue (option b, the interim until the unified store). Staging is removed only after the list is written.
13. **Bar display.** 0/total while work is queued and the queue isn't paused. Hidden only when nothing is queued, the batch is done, or the queue is paused.
15. **Bar push targets.** Only tabs that asked for the summary, identified by the sender's tab id. No URL matching.
16. **Deferred broadcast race accepted.** No sequence number and no `sw.js` edit.
18. **Legacy list.** A fixed list of 131 names built from the builders' constants: 65 index names and 66 progress names (the view, the 32 shards, and their 33 namespace tokens). Coded on 18–19 Oct (4a, item 4 covers the live run).
19. **Clear History deletes the history.** It empties the nuked-post map. It is not Clear, which stays dashboard-only under decision 3.
20. **Backfill.** Rows enqueued before the change get their candidate lists during the migration. Waits for the migration design.
23. **Changed files.** See 0, item 7.
24. **Restart (bar).** After a worker restart, the bar returns on the next Quora page load.
25. **Eight pending records that link to no work.** Drop them with the migration, not now.
27. **Progress is not on disk.** Progress lives in session memory, not in the worker's memory. It survives the worker going to sleep and is cleared when the browser closes.
28. **Loss accepted.** After a browser restart, progress is lost. On the update, the old progress copy is removed once, so progress starts empty.
29. **Outlier list stays as it is.** The whole list is written to disk with each archive.
30. **Progress-only saves never start queued work.** The rule looks at what a save writes, not at its name. A caller's own suppression stays in force.
31. **Progress moves to session memory (option b).** Coded in the working tree on 18–19 Oct. Progress tokens are dropped; runs and the outlier list keep theirs.
32. **Tools read progress through the worker (route a).** The worker answers `get-profile-nuke-progress`. The tools' target is open (0a).
33. **Content gets progress by message only; the worker pushes changes (David, 18 Oct: "Message only", "Worker pushes on change", "New worker message", "Chrome first").** Content asks for its scoped state by message, as before. After each successful progress write, the worker sends `profile-nuke-progress-changed` to the tabs that asked for page state. Chrome first; Firefox on the same message path.

Still in force from earlier decisions: the queue bar is revised by decision 9 (O1). Checkpoints and sealed history shards use the existing fflate gzip codec; WAL appends stay raw.

**Choices made in code on 18–20 Oct.** They follow from the decisions above. They are not decisions yet; David to confirm or change each one. K2, K4 and K6 changed on 20 Oct, as noted under each.

- **K1.** A failed first session read at hydrate fails the authority load. So does a missing session area. Proceed as built (David, 20 Oct).
- **K2.** Superseded on 20 Oct: the listener's progress arm is removed (review decision 2), so the listener no longer reads the progress view or the full progress blob.
- **K3.** The legacy cleanup runs after the first authority load, not at module load. Proceed as built (David, 20 Oct).
- **K4.** Revised on 20 Oct: a stored write reports its disk part and its progress part separately. A refused disk part stops the progress write. A thrown write carries its per-part outcome.
- **K5.** The set of tabs to push to is held in the worker's memory. This is the restart gap (0a). Accepted 20 Oct; on the revisit-later list.
- **K6.** Revised on 20 Oct: the reply to the tool read is the stored copy, loaded through the same gate as the other progress readers. It was the module-level copy. The direct save and the merge fallback read the stored copy too.

## 3. Facts the decisions rest on

- **Session storage (dev dump of 18 Oct; sizes as JSON).** Progress (view and shards): about 5.35 MiB. The queue WAL copy that the session mirror keeps: about 3.17 MiB. Runs: about 0.22 MiB. The flight-recorder snapshot: up to about 0.5 MiB (an estimate). Chrome's session limit: 10 MiB. Headroom on this profile: under 1 MiB. Not measured live. Chrome's session area reports bytes in use (`getBytesInUse`). Firefox support is unverified.
- **Pending records (dev profile, 18 Oct, read-only audit).** 3,368 records and 3,986 profile links still waiting. For comparison: 1,213 live queue rows and 3,607 completed rows.
  - 1,232 records are in progress: every remaining profile has a live row.
  - 1,394 are stuck: a remaining profile already finished, and no live row is left to confirm it.
  - 724 are orphaned: at least one remaining profile has no live row and no completed row (799 profile links in this state).
  - 18 are empty.
  - Of the remaining profiles, 1,587 completed successfully, all within 21 days (inside the 30-day window). 95 completed otherwise.
  - Method to reproduce: copy `chrome.storage.local` with a read-only `get(null)`. Decode with `shared/js/walSnapshotStore.js`: `hydrateSegmentedWalStore(dump, {baseKey: 'mbCoordinatorQueueWal', fallbackStore: null})`, then `recoverProjectedState(store, [], {codec})` with a gzip codec. The state is at `recovered.projected.state` (`queue`, `completed`). The audit script is in the session's scratchpad folder, not in the repo.
- **The saved dev dump.** `storage-dump.json` in the scratchpad folder of session `4549803c-a81d-4d63-b095-292e0180469c` (about 22 MB). It is a copy of the dev profile's local storage made on 18 Oct, before the progress change, and it includes the progress keys. Read it; don't change it.
- **Clear leaves pending behind.** The cleared list for Clear current work is built from live rows only. The completed-row removal then removes every completed row, so their profiles never reach the list. Pending records are never touched. This is the likely cause of the 724 orphaned records.
- **Events are read back by logic.** A terminal key-only check decides whether an item was already applied. The architecture doc lists events as a derived view, so this contradicts the design.
- **Clear History** wipes all history by sending an empty nuked-post map (decision 19).
- **Entries and pending, verified.** Queue and completed rows carry `postKey` and `postUrl` inside their evidence items (queue: 1,544 items on 1,188 rows; completed: 3,779 items on 2,266 rows). They have no candidate list and no top-level post fields. Pending records carry `allUrls`, `postKey`, `postUrl`, `spaceKey`, `resolverPending` and `jobKeys`. The 18 empty pending records have empty `resolverPending`, but still carry `jobKeys`.
- **Flight recorder.** An in-memory ring buffer of 20,000 entries. The session snapshot holds the newest 2,000, written at most every 10 seconds, under `mbFlightRecorderSnapshot`. Strings are cut to 240 characters.
- **Storage numbers.** The 18:00 run wrote 284 MB in six minutes. The content-queue index family was 210 MB of it (74%).
- **Compression, measured.** Live queue checkpoints: 14.8:1 with gzip. Real dashboard rows: about 19:1 raw in 200-row shards, about 14.5:1 with base64, about 23:1 with keys written once per shard.
- **Firefox.** The probe note (`experiments/design-probes/NOTE.md`, around lines 78–88) found that content scripts have no `storage.session`, and that `setAccessLevel` is not available to content. Content reaches the worker by message, which routes through the background event page. Not checked in a live Firefox run.
- **Diagnostic tools.** Thirteen scripts in `tools/cdp` read the progress keys from disk (the list is in 4a, item 3). They run their code inside the worker's own target. The worker has no diagnostic hook.
- **Hunk map.** `historical/hunk-map-2026-10-18.md` records 252 `sw.js` hunks: 52 accepted, 200 unmatched.

## 4. Open work outside the decisions

1. **tmp/ (proposal only).** Put the proposed `.gitignore` line (`tmp/`) in your report. List the two tracked files (`tmp/quora-reporting-assets.json`, `tmp/quora-reporting-assets.urls`) and what references them. Don't delete or untrack anything.

### 4a. Progress path (decisions 27 to 33)

Single-shape fixes only. For a choice listed as "not decided", list the options in your report and don't pick.

1. **Helper used only by tests (not decided).** `readCoordinatorQueueRowsFromMirror` is used only by tests. Keep it as a named test helper, or delete it with its tests. List both options.
2. **Progress repair count (open; start now, see 0, item 3).** Report the count and both definitions. Don't change the repair filter. The repair writes through the door, so under session memory its writes go to memory.
3. **Tools that read progress from disk (decision 32; target chosen 20 Oct, see 0a).** Converted on 20 Oct: `audit-action-kinds.js`, `enqueue-visible-profile-search.js`, `inspect-queue-brief.js`, `inspect-queue-item.js`, `inspect-recovered-queue-item.js`, `inspect-space-state.js`, `queue-storage-summary.js`, `queue-summary.js`, `sw-queue-summary.js`, `wal-snapshot-benchmark.js`, `clear-coordinator-test-state.js` (sends the worker clear), and `upgrade-regression/run.js` (feeds the worker's progress into its snapshots). Each read of the progress view is now a read of the worker's reply, sent from an extension page by the shared helper in `tools/cdp/lib/cdp.js`. Not converted, by design: `storage-read-profile.js` (it measures what is on disk). None of the converted scripts has run against a live browser; each passes a syntax check.
4. **Live verification (needs David's go and a build first).** The checklist for the one timed run: (a) session storage bytes in use at the start, after 30 minutes of queue work, and at the end (Chrome's `getBytesInUse` on the session area); (b) progress saves and pushes per minute; (c) an open Quora profile page updates after a progress change, without a reload; (d) the first start after the update removes the old keys once: none of the 131 names is left on local storage, and the marker is in session storage; (e) the flight-recorder entries for the cleanup; (f) console errors in the worker and in the content target. Record each count. Use CDP. Set "Run for" before Resume.
5. **Session quota (needs item 4).** If the measured total is above about 80% of 10 MiB, stop and report, with options: shrink the progress records (the summary shape, D6 in the progress note); keep the WAL copy on disk only (this changes the mirror design); cap the shards.
6. **Firefox check (needs a live run).** Confirm that content gets progress by message and that the push reaches the tabs.

## 5. Design notes (no code until David approves each note)

Write each note at the repo root. Mark each open choice with its options. Don't pick. Number the choices A1…, B1…, C1… and D1… as before.

- **A. `unified-store-design.md`.** Open: A3 to A23. David's calls: A7 (whether the window follows user settings) and A15 (requeue from history).
- **B. `events-to-flight-recorder-design.md`.** Open: B2 to B15. B2 has two options left: (a) first page, (c) most frequent page.
- **C. `pending-staging-design.md`.** Open: C2 to C15. C10 (the 18 empty records) is David's question.
- **D. `progress-durability-design.md`.** Open: D3 to D9. D1 is implemented. D2 and D10 to D13 are decided.
- **`legacy-index-cleanup-design.md`.** No open choices. Coded on 18–19 Oct. Case 5 of its test plan is not written (see 0, item 6).
- **`projection-cost-design-note-2026-10-18.md`.** Open: whether finished rows belong in the index, and the measurements after the in-memory change has run live (needs the live run).

## 6. Hold. Don't start

- Any build, version bump, zip, browser reload, browser run or live run. The next build waits for David. When it is approved, bump all four version fields first (`package.json`, `package-lock.json`, `manifests/chrome.json`, `manifests/firefox.json`), then build. Every build starts with a bump, including test builds. AGENTS.md's release rule (a commit and an annotated tag for each zip you hand over) applies only once David asks for a build.
- Commits, tags, branch changes and pushes.
- Code for any design note in section 5, until its note is approved.
- Any change to dedupe or Clear behaviour in code.
- Any new disk write of progress, projections or queue data.

## 7. Stop and ask David if

- an edit you need falls inside an unmatched `sw.js` hunk;
- you find another writer of the queue view, the events key, the pending key, or any progress key;
- a session measurement, or an estimate, is above about 80% of the session limit;
- a test needs changing beyond the lists you report;
- anything you touch could lose stored data, session data included;
- the entropy-reduction check finds a new instance of a listed problem in the 18–19 Oct change (report first; fix only single-shape issues);
- a choice is a protocol, threshold or terminal-state choice (list the options; don't pick).

## 8. Report back

Give two outputs each time.

**Part 1, technical (code detail is fine):**

1. The baseline: `npm test` and the six lints, and any difference from the 20 Oct baseline.
2. Section 0, items 2 to 8: the entropy-reduction check for each area (new instance or not, with file and line); the repair count and both definitions; the bar report and the Firefox result; the hunk-map section; case 5 (written, or the reason it was left out); the changed-file notes; the notes you moved.
3. Each test you added or changed, with its old and new assertion.
4. Test counts: `npm test`, the lints, and `lint:duplicates`.
5. The 0a items, and which ones are still waiting. Don't start them.
6. Questions for David, numbered, with options.

**Part 2, plain summary for David:** behaviour, data, risk and choices. No code references, file paths or line numbers.
