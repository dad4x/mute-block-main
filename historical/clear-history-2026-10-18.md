# Clear history, 18 Oct 2026

> **Status: HISTORICAL** (24 Oct 2026). Record of finished items and dead ends, with the retired coder instructions and release notes to 1.6.1436. Kept so they are not reworked. Dead ends are indexed in docs/dead-ends.md. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

This file holds the dead-ends and already-dones taken out of the working notes on 18 Oct. It is kept so they are not gone over again. The working notes do not point here, and nothing in this file is an instruction. Items are grouped by the note they came from. Line numbers are as they stood on 18 Oct; search by name.

Lines marked [Removal note] were added when the text was removed.

## 1. Coder plan (coder-instructions-2026-10-18.md)

### 1.1 First excision, after David asked for the old directions to be removed

Lead sentence (was): Decisions 1–23 in section 2 are settled. Don't reopen them. Work these in order:

Item 1 (was): 1. **Candidate list (decisions 12 and 20).** Write the candidate list into each queue row's evidence at enqueue. First record the answer in the C note: C1 and A1 are the same question, and the answer is option b. Then code it. The backfill of rows enqueued before the change belongs to the migration, so its code waits until the C note is approved.

Item 2 (was): 2. **Queue bar (decisions 9, 11 and 13–17).** Finish the bar on both browsers, using messages. Tests: summary pushed on each change and on the first build; a request made on a cold worker is answered after startup; bar shown whenever work is queued and the queue isn't paused; hidden when nothing is queued, the batch is done, or the queue is paused; a failed request hides the bar. Clear writes a zero summary. Remove the dead view-key branch in the same change.

Item 3 (was): 3. **Migration check (decision 21).** Done. The 18 empty records have no job keys, so they were checked by linked profile: 2 keep (live work), 8 keep (finished work), 8 drop with the migration (decision 25).

Item 4 (was): 4. **Next open choices: B1 (decided, decision 26), then D1 (decision 22).** B1 is decided (decision 26): record it in the B note, then code it. D1 follows decision 27: option (b), the session copy as the only copy. Before coding it, close option (b)'s open items and list them for David in plain terms. Include a list of what progress holds that the queue doesn't, so the loss in decision 28 is visible.

Decision 1 (was): 1. **Unclaimed sw.js hunks.** Accept the ones that match decisions in the 14–15 Oct review notes. Map the rest read-only. Revert nothing.

Decision 4 (was): 4. **Progress (superseded by decision 27).** Durable on disk. Progress shards are WAL appends and sharded checkpoints. The progress view is a projection and leaves disk (section 5D).

Decision 7, the clause removed: "The migration drops 742 unmatched records (section 5C)." [Removal note: the count is stale. Section 5C and decision 25 give the drops.]

Decision 10, the sentence removed: "Items 1c to 1f still write to disk and stay open." [Removal note: item 1c is covered by decision 31. The sentence now reads "Items 1d to 1f still write to disk and stay open."]

Decision 14 (was): 14. **Restart gap accepted.** After a worker restart, the bar stays hidden until the next queue change (David, 18 Oct).

Decision 21 (was): 21. **The 18 empty pending records.** Check their job keys first. Drop only the records whose job keys resolve to no row. Keep any that point at live work (David, 18 Oct). [Removal note: the check is done; its result is in decision 25.]

Decision 22 (was): 22. **Next open choices.** B1 (the run source-page fallback) and D1 (what the progress view becomes) come first (David, 18 Oct). [Removal note: both are decided now.]

Decision 24, the clause removed: "This replaces decision 14, which accepted the gap."

Decision 26 (was): 26. **B1, a run's source page.** Delete the event fallback. Every run keeps its own source pages (all 37 do), so nothing changes on the current data. Record it in the B note, then code it (David, 18 Oct). [Removal note: the fallback is gone from the code.]

Decision 27, the clause removed: "This supersedes decision 4."

Bar bullet (was, section 3): - **The queue bar is dead.** `refreshContentProgressBar` (content.js ~3895–3919) reads the queue view from storage. Nothing writes that key now. The view is broadcast only (sw.js ~8074–8091 and the other broadcast sites), and sw.js ~35981 removes it. The code comments date this to 30 Sep–1 Oct.

Events bullet, the sentence removed (section 3): "`getCoordinatorRunSourcePageFromEvents` (swCoordinatorSourceProvenance.js ~107–115) recovers a run's source page." [Removal note: the run source-page read was removed with decision 26. "These reads" became "this read".]

Clear History bullet (was, section 3): - **Clear History** (coordinator.js ~179–183) wipes all history: it sends an empty nuked map. Decision 3 does not cover it. It is open as O16. [Removal note: now, decision 19 settles it.]

Entries bullet, the clause removed (section 3): "which must be checked before any drop." [Removal note: the check is done (decision 25).]

Do-now item 1 (was): 1. **Map the unclaimed sw.js hunks (read-only).** Run `git diff -U0 abc2307 -- shared/js/sw.js`. For each hunk, check whether it matches an accepted group: the supersession counter, the stored-work clear re-read, and the fill-loop catch (`14-oct-review-2-reply.md` section 8); the S3-1 check that clears the pause flag only for its own generation (`14-oct-review-2-reply.md`, line ~26); the suffix shadow count (`noteSuffixShadow`), accepted on 15 Oct. Accept the matched hunks. Revert nothing. For each unmatched hunk, give one line: its function name and what it changes. Mark the two edit points that changed during your earlier pass. [Removal note: done; the hunk map exists.]

Do-now item 2 (was): 2. **Fix the queue bar (2a).** Put the logic in a new module, for example `shared/js/swQueueBarSummary.js`. The worker keeps `{total, pending, updatedAt}` in memory; it is recomputed in `notifyCoordinatorDashboardStateChanged`, pushed to Quora tabs, and written with an explicit zero summary on Clear. Name the message types in the protocol the worker already uses. Nothing is written to any storage area for the bar. Write fire-and-forget with a catch. No `setAccessLevel` and no session storage for the bar. Content asks the worker for the summary by runtime message on load; the worker pushes each change, with `tabs.sendMessage`, only to tabs that have asked, identified by the sender's tab id (decision 15). Keep reading the paused flag from storage.local. Remove the stored-view read and the dead view-key branch (decision 17). Tests: summary written on broadcast and on first build; bar shown whenever work is queued and the queue isn't paused (decision 13); hidden when done, paused, total is 0, or the read fails. Firefox: the same messages work there. Confirm the path in both browsers by reading the code. No browser run until David asks. [Removal note: the code and its tests are in place. The report and the Firefox read remain in the plan.]

Do-now item 5 (was): 5. **Index injection removal.** Keep the removal in `shared/js/swProfileNukeProgress.js` (~457, ~472). It was not on the list, so record it as unplanned in your change note. [Removal note: done; the hunk map records it as already removed.]

Do-now item 6 (was): 6. **Legacy cleanup design (note only).** Find the exact keys that hold old index and shard copies, using the index writer's constants. Don't guess names. Use a fixed list, not a key scan (decision 18). Write `legacy-index-cleanup-design.md` at the repo root: a one-time, idempotent cleanup with a marker kept in session storage, not on disk (David: nothing written to disk). It deletes only derived keys. It never touches WAL, checkpoints, runs, progress, pending, nuked posts or settings. No shipped code. [Removal note: done; the note exists. The "never touches progress" rule is superseded by decision 31, which puts the old progress copy under the legacy cleanup.]

Section 5 lead (was): "Taken so far: the candidate-list question (PS-6 in the coder's numbering) and Clear History (O16). Next: B1 and D1 (decision 22) (David, 18 Oct)."

Section 5B, sub-bullet (was): "Run source page: check whether the run's `sourcePages` list (sw.js ~24364) can replace the event read." [Removal note: done under decision 26.]

Section 5B, the lead changed from "First move the two reads:" to "First move the remaining read:".

Section 5C, the clause changed (was): "The 18 empty records are checked first (decision 21)." [Removal note: now "were checked (decision 25)."]

Section 5E (was): "**E. Checkpoints.** Count only, decided. No note and no code." [Removal note: nothing to do.]

Section 6, the sentence removed (was): "Decision 26 (B1) follows the same pattern: a decided choice may be coded once it is recorded in its note."

Section 4a item 1 (was): Delete `isCoordinatorQueueWalMirrorFresh`. It has no callers, and it trusts the marker alone (review F6). [Removal note: done; the function and its comment are gone.]

Section 4a item 3 (was): Take the outlier list key out of the startup session read. The value is read and then skipped (review F7). [Removal note: done.]

Section 4a item 4 (was): Fix the stale comments: the progress save helper (about lines 6032–6034 of the shared sw.js) and the content index note in `swCoordinatorContentQueueIndex.js` (about lines 272–273) (review F8). The applyLocked comment is still to be done, as approved in section 4, item 1. [Removal note: done. The three comments are fixed, and the applyLocked comment is gone.]

Section 4a item 5 (was): Make the resume exemption key-based and per write (review F2; decision 30). [Removal note: the module, its wiring and its tests were in place. On 18 Oct a caller-suppression bug was found and fixed, with three tests added. See section 9.]

Section 4 item 2 (was, guard test): Add a synthetic test: archive, blocked-tab, checkpoint and full-queue saves produce no disk write carrying an index, shard or projection key. [Removal note: done; the test exists and passes.]

Section 4 item 1 (was, stale comment): `shared/js/sw.js` ~10288–10289 describes a deferred content-index default that no longer exists. Comment only. Approved (David, 18 Oct). [Removal note: done.]

Section 5 A–D bullets (was): the list of what each design note must contain and find. [Removal note: the notes are written. Their open choices are in each note.]

Section 0 item 1 (candidate list): [Removal note: coded for new rows; tests pass. The backfill stays open (decision 20) and waits for the migration design.]

## 2. Progress review note (progress-path-review-2026-10-18.md)

- "What holds" (sections 1.1–1.6 as first written): verified facts on 18 Oct about the startup WAL keys, the namespace tokens, progress used whole, the content-index removals (which were not progress), the write gate and the restore branch. No action; the facts are in the progress durability note where they still matter.
- F2 (resume exemption): done. Key-based, wired, tested. The caller-suppression defect was found on 18 Oct and fixed.
- F3 (per-save tokens): decided with decision 31. Progress tokens are dropped; runs and the outlier list keep theirs.
- F4 (outlier list): decided, decision 29: keep as it is. Options not taken: memory and session only; batched disk writes.
- F6 (two helpers): the unused one is deleted. The test-only one stays open (see the coder plan).
- F7 (outlier key read at startup): done.
- F8 (stale comments): done (three fixed).
- F9 (accepted assumptions): still live; kept in the review note.

## 3. Progress durability note (progress-durability-design.md)

- Section 0, "Settled (decision 4): progress shards stay durable..." [Removal note: superseded by decision 27. Progress is not on disk.]
- D1, what the view becomes: decided 18 Oct, option (b), decision 27. Options not taken: (a) remove the stored view and build the summary in memory from the shards at load and after each change; (c) keep the view on disk for one release as a transition, then remove it.
- D10, tools and tests that read the key: decided by decision 32, read through the worker. Options not taken: (b) keep reading the old key and expect it empty; (c) remove the readers. The route is still open (see the coder plan).
- D11, the stored view on disk: decided by decision 31. It goes with the legacy cleanup. Options not taken: (a) delete it once on load under a marker key; (b) leave it inert.
- Section 4a, option (b)'s open items, closed:
  - (1) The copy is served only after a full write. Closed by design. Not yet built.
  - (2) A namespace write needs a resident WAL meta. Closed by design. Not yet built.
  - (3) A stale value if a mirror removal fails. Closed for progress: there is no disk copy to disagree with.
  - (9) Hydration after a browser restart restores the queue, not progress (decision 28). Accepted.
- "What progress holds that the queue does not" (read-only, 18 Oct dump): 3,572 progress records, of which 1,164 match a live queue row, 2,017 match only a completed row, and 391 match no row. The 33 fields that queue rows lack are in four groups: mute, unmute and unblock; block and security; tab and foreground timing; bookkeeping. This is the basis of the loss accepted in decision 28.

## 4. Unified store note (unified-store-design.md)

- Section 1.1, "Do completed rows carry the candidate list?" Answer: no; the entry must carry it. [Removal note: this is the basis of decision 12, which is decided.]
- Section 1.2, the requeue-all-failed name. [Removal note: corrected in place. No action named `requeue-all-failed` exists; the action is `requeue-coordinator-failed`.]
- A1, the candidate-list source: decided 18 Oct, option (b) (decision 12). Options not taken: (a) a new enqueue field that carries the full list, with a backfill (A21); (c) a list derived from completed-row evidence (partial by construction). Coded for new rows. The backfill waits for the migration design.
- A2, Clear History: decided 18 Oct (decision 19). Clear History empties the remembered nuked-post map, as it does now, so profiles from those posts can be queued again at once. Options not taken: (b) turn it into a marker, as A16; (c) remove the button. No code change.
- The count "23 open choices" [Removal note: now 21, A3 to A23.]

## 5. Events note (events-to-flight-recorder-design.md)

- Section 2.1, run source page (R3), with its facts (37 runs, all with sourcePages; 0 of 332 events carry sourcePageUrl; 21 run IDs with no run record). [Removal note: B1 is decided and coded. The run-source function and its export are removed, and the reconcile call no longer passes events.]
- B1, the R3 fallback: decided 18 Oct, option (a) (decision 26). Options not taken: (b) keep a fallback that reads only the run record's own fields; (c) keep the event read until cutover.
- Section 8, cut-over step 2 (R3: "Test that no source-page lookup reads events."). [Removal note: done.]
- B2, option (b) (last page): [Removal note: not possible now that the event fallback is gone. The worker takes the first page, which is option (a).]

## 6. Pending staging note (pending-staging-design.md)

- Section 0, "Answer first: is the candidate list on rows?" Answer then: no. [Removal note: true before decision 12. New rows now carry the list. The consequence for the migration stays in section 4 of the live note.]
- Section 0a, where postKey and the candidate list are written before the change. [Removal note: analysis of the old flow, obsolete for new rows.]
- C1, keeping the candidate list: decided 18 Oct, option (b) (decision 12). Options not taken: (a) a post-level entry in the unified store carrying `urls`; (c) rely on rows alone, which the note found not sufficient.
- The check of the 18 empty records (read-only): their job-key lists are empty, not job keys as decision 21 assumed; their resolver field is a boolean. The check used candidate URLs: 1 to 5 per record, 37 in all. Keep: 2 records have a candidate with a live row; 8 have candidates with completed rows only. Drop with the migration: 8 records have no row for any candidate (decision 25). Outcome kept in the live note as one line.
- Section 7, "David's content-access decision": the first draft of the note assumed a session read for pending records. [Removal note: corrected in place. The note now assumes no session read.]

## 7. Legacy cleanup note (legacy-index-cleanup-design.md)

- Choice 1, enumeration: decided, a fixed list of the 65 names (decision 18). Options not taken: B, scan the store's keys and match exact names or the two prefixes (a whole-store read once per install; Firefox support for `getKeys` unverified); C, a hybrid that deletes the fixed list and also logs a scan count without deleting the extras.
- Choice 2, where the marker lives: decided, option B, a session marker (David, 18 Oct: nothing is written to disk). Options not taken: A, a `chrome.storage.local` marker (one small disk write, which would need an explicit OK); C, no marker, with one read on every worker start.
- Section 5 heading, "Order (option A; B and C differ only in where the marker is read and written)". [Removal note: the order is kept, with option B.]
- Section 10, the rollback reasoning: four reasons why no rollback is needed for the derived keys. [Removal note: the conclusion stays in the live note; the reasoning is here.]

## 8. Projection notes (projection-rewrite-design-2026-10-18.md; projection-cost-design-note-2026-10-18.md)

- The projection-rewrite note as a whole: four options for the cost of saving the copy (batch the saves into one save per window; shard the copy so a save rewrites only changed pieces; keep only the log and rebuild the copy on read; keep only active and recent rows in the copy). Its recommendation was option 1 first. [Removal note: the copy it measured is not stored in the working copy. The 18 Oct change builds it in memory on read, and the build in the repo still stores it. Option 3 is what the working copy does. Options 1, 2 and 4 are moot for the copy. The note's reader list was also wrong: only the content-page lookup reads the copy.]
- The cost note's option (a), shard the copy: moot for the copy, for the same reason. Kept here only.
- Corrections found on 18 Oct: the copy was described as not sharded; it is in 32 pieces for the queue and 32 for sources, and each save rewrote all of them, plus the whole copy.

## 9. Closed in the 18 Oct pass (working tree checked by reading and by unit tests)

- Queue bar, code and tests: in place; the report and the Firefox read remain in the plan.
- Candidate list for new rows: in place; its unit test passes. The backfill remains (decision 20).
- B1 (the run source-page fallback): removed from the code.
- Guard test (archive, blocked-tab, checkpoint and full-queue writes put no index, shard or queue-view key on storage): present and passing.
- Dead helper for the mirror freshness check: removed.
- Outlier key removed from the startup session read.
- Three stale comments fixed; the applyLocked comment removed.
- Resume exemption (decision 30): module, wiring and tests in place. Defect found on 18 Oct: a non-progress write cleared a suppression that the caller had set when the update started, which the recovered-queue path uses. Fixed; three tests added; all 13 tests in the file pass. A read-only check confirmed the fix.
- Dead view-key branch in the content script: removed.

## 10. Closed 19 Oct: progress in session memory (decision 31, option b)

What the coding removed or replaced. The working note now states the state after the change. The reader inventory and findings below were true before the change and are kept here so they are not checked again.

- The progress keys are no longer written to disk. The door splits a stored payload into the disk part and the progress part; the progress part goes to session storage (`writeProfileNukeProgressSession`).
- Hydrate reads the progress keys in the first session read, the one that already reads the mirror's marker. The separate session read that was tried first was removed: its extra await moved the startup load and broke the bulk cancel test (see memory feedback_hydrate_await_ordering).
- The namespace mirror no longer carries progress keys or tokens. The "mirrored runs write does not vouch for a progress copy" test was replaced by a test that checks progress stays in session and survives a restart.
- The content storage listener's progress arm was removed. Content refreshes on the worker's push instead.
- The worker's storage listener ignores removals of the progress view, so the legacy cleanup cannot schedule a queue resume.
- The progress throw path was first made a silent "not saved". It was changed to rethrow, so the caller's storage-error path handles it as it does for disk.
- Legacy cleanup: first written to run at module load, moved after the first authority load (the same ordering reason as above).
- Test harness: progress seeds go to the session copy; the storage object tests read is a view over the disk and session copies. Eleven failure-injection tests now hook the session write. Two seeds that the retarget moved by mistake (the legacy key and the disk runs key) were kept on disk. The executor spy now counts full authority reads by the events key, not the progress key.

### 10.1 Reader inventory and findings (18 Oct, before the change)

#### 0. What the code shows

Three things the code shows:

1. **The shards are not WAL records today.** The view and the 32 shards are written together as stored keys, through `persistCoordinatorStoredChange` (`sw.js:9932`) and `writeCoordinatorStoredKeys`. They are direct storage writes. Moving them into the WAL is a change of write path, not a continuation of the current one (`docs/queue-storage-layering.md:246` describes the same stored-key write).
2. **Content does not read the view from storage.** Content gets the scoped view in the content-state message (`content.js:579-615`; the worker builds it at `sw.js:35699-35800`, response field at `sw.js:35797`). Its only storage hook is `storage.onChanged`, which triggers a refresh (`content.js:656-657`). So "reads it the same way as the bar" changes the mechanism. It does not copy the current content path (D2).
3. **A session mirror of the view and shards already exists.** The namespace mirror keeps the view and all 32 shards in session storage, under the WAL marker (`docs/queue-storage-layering.md:246`; `sw.js:6010-6015`, `QUEUE_NAMESPACE_MIRROR_KEYS`). The doc lists open items for it (lines 246-247): progress is served from the mirror only after a full write, and a failed mirror write removes its keys from the session. The design has to decide what this mirror becomes (D1, now decided; the shape is open in D2 to D9).

#### 1. What the view is today

- **F1. A bounded summary.** `buildProfileNukeProgressView` (`swProfileNukeProgress.js:159-185`) keeps the 1,200 most recently updated records (`MAX_PROFILE_NUKE_PROGRESS_VIEW_RECORDS`, `sw.js:687`). Each record is reduced by `summarizeProfileNukeProgressRecord` (`swProfileNukeProgress.js:90`). The view's fields are `version`, `updatedAt`, `total`, `recordLimit`, `truncated` and `records`.
- **F2. Shards hold the full records.** `updateProfileNukeProgressShardRecord` (`swProfileNukeProgress.js:352`). There are 32 shards (`sw.js:689`), with the key prefix `mbProfileNukeProgressShard.` (`sw.js:641`).
- **F3. Reads merge the view and the shards, and shards win.** `getProfileNukeProgressRecordsFromProjection` (`swProfileNukeProgress.js:419-431`) merges `{...viewRecords, ...shardRecords}`.
- **F4. Writers.** The view is written by `applyCoordinatorProgressDeltas` (`sw.js:9919`, when `includeView`), by `saveProfileNukeProgressRowProjection` (`sw.js:6038`, `progressView` flag), and by `repairProfileProgressProjection` (`sw.js:10039-10046`). In each case the view and the changed shards go out in one stored write (`sw.js:9919-9925`; `sw.js:9932-9966`).
- **F5. A content request can write.** `getContentPageCoordinatorState` (`sw.js:35699`) calls `isContentPageStateProjectionMissing` (`swContentPageStateProjection.js:250-256`: view version below 2, or a missing shard). If that is true it calls `rebuildContentPageStateProjectionFromCurrentState` (`sw.js:35671`), which calls `repairProfileProgressProjection` (`sw.js:10030-10046`). That repair writes any changed key. So a content read can cause a disk write.
- **F6. The worker's own listener.** `handleStorageChanged` (`swBootstrap.js:597-626`) reads `oldValue` and `newValue` of the view (lines 612-613). It returns early when the change does not include the view (line 609) and during a projection write (line 610). Otherwise it merges the new records into the resident copy (line 615). This is the only code path that takes a view change made outside the worker into the resident copy. Content's listener only triggers a refresh (F9).
- **F7. The content listener arm for the queue view.** `onStorageChanged` (`content.js:656`) fires a refresh for either the progress view or the queue view. The queue view has no storage writer. Its only storage operation is removal, in `retireLegacyQueueViewStorageKey` (`sw.js:35979-35982`, called at module load on line 36002). `onChanged` fires on a change of a stored value, and a removal of an absent key is not one (not re-checked here). So after the first run this arm should do nothing for the queue view. The dashboard push is a runtime message, not a storage write (`swCoordinatorReconcileSupportSingles.js:154-170`). The progress arm of the same test is live, because the view is still written.
- **F8. Metadata readers.** `truncated` is read by the projection check (`swContentPageStateProjection.js:225`). `recordLimit` and `records` are read by `normalizeProfileNukeProgressView` (`swContentPageStateProjection.js:202-222`). `total` is read by a diagnostic tool (`tools/cdp/queue-summary.js:120`).
- **F9. Content has no direct storage read of the key.** Content's only storage hook for the view is the `onChanged` arm at `content.js:656`.

#### 2. Every reader of the progress view key

Scope: `PROFILE_NUKE_PROGRESS_VIEW_KEY` (`shared/js/storageKeys.js:14`), value `mbProfileNukeProgressView`. The `chrome/js` and `firefox/js` copies are generated from `shared/js` at build time (`webpack.mix.js`) and are not listed separately. No reader was found in `coordinator.js` or `swdashboard.js`.

### 2a. Direct references in `shared/js`

Role key: READ (reads the stored value), WRITE (writes it), CLASSIFY (decides how a write is labelled, from the key name), HAND-OFF (passes the name into a module), LISTEN (`onChanged`), RESPONSE (reads a field of a message response built from the view).

| File:line | Function | Role | What it does |
|---|---|---|---|
| `storageKeys.js:14` | (module) | definition | `PROFILE_NUKE_PROGRESS_VIEW_KEY: 'mbProfileNukeProgressView'` |
| `sw.js:16` | (import list) | HAND-OFF | Imports the constant. |
| `sw.js:641, 687, 689` | (constants) | related | Shard prefix; view record cap; shard count. |
| `sw.js:2321` | `createStorageMetrics` constants (`sw.js:2311`) | HAND-OFF | Passed to the metrics module. |
| `sw.js:2535-2541` | `metricStorageSet` | CLASSIFY | Marks a write as progress-only from the payload keys. Reads keys, not stored values. |
| `swStorageMetrics.js:30, 68` | key-to-metric mapping | CLASSIFY | Maps the key to the metric name `progressView`. |
| `sw.js:5951` | `createProfileNukeProgress` constants (`sw.js:5943`) | HAND-OFF | Passed to `swProfileNukeProgress.js`. |
| `swProfileNukeProgress.js:84` | (import) | HAND-OFF | Imports the constant. |
| `swProfileNukeProgress.js:159-185` | `buildProfileNukeProgressView` | WRITE (builds) | Builds the view from a progress map, capped at 1,200. |
| `swProfileNukeProgress.js:220-226` | `getProfileNukeProgressProjectionDefaults` | READ/WRITE (key list) | Key set for a stored read or write, with `includeView`. |
| `swProfileNukeProgress.js:319-364` | `updateProfileNukeProgressViewRecords` | WRITE | Upserts records into the view; cap read at 331. |
| `swProfileNukeProgress.js:365-390` | `removeProfileNukeProgressViewRecords` | WRITE | Removes records from the view; cap read at 374. |
| `swProfileNukeProgress.js:419-431` | `getProfileNukeProgressRecordsFromProjection` | READ | Reads the view (line 424) and merges it with the shards. |
| `swContentPageStateProjection.js:202-222` | `normalizeProfileNukeProgressView` | READ | Parses the view: `recordLimit`, `records`. |
| `swContentPageStateProjection.js:224-230` | `hasMissingRequestedProfileProgressShard` | READ | Reads `truncated` (line 225). |
| `swContentPageStateProjection.js:250-256` | `isContentPageStateProjectionMissing` | READ | Reads the view's `version`; this is the rebuild trigger. |
| `sw.js:6023-6045` | `saveProfileNukeProgressRowProjection` | WRITE | Passes `progressView: includeView` (line 6038) into the door. |
| `sw.js:9833-9925` | `applyCoordinatorProgressDeltas` | READ, WRITE | Reads the view from the resident copy (9857, 9867), computes `nextView` (9894), writes the payload (9919). |
| `sw.js:9932-9966` | `persistCoordinatorStoredChange` | WRITE | Writes the stored part, which includes the view and shards, through `writeCoordinatorStoredKeys`. |
| `sw.js:10030-10046` | `repairProfileProgressProjection` | READ, WRITE | Reads the view (10030), derives it (10039), writes any changed key. |
| `sw.js:24864-24880` | `loadProfileNukeProgress` | READ | Reads the view (24867) and parses it into the resident copy (24872). |
| `sw.js:35671-35690` | `rebuildContentPageStateProjectionFromCurrentState` | WRITE (via repair) | Calls the repair, which writes when a key changed. |
| `sw.js:35699-35800` | `getContentPageCoordinatorState` | READ, RESPONSE | Reads the view (35724, parse at 35736), returns `profileNukeProgress: scopedProgress` (35797). |
| `sw.js:35805-35825` | `registerServiceWorkerListeners` constants (`sw.js:35812`) | HAND-OFF | Passed to `swBootstrap.js`. Accessor at 35823. |
| `swBootstrap.js:128` | (constants list) | HAND-OFF | Imports the constant. |
| `swBootstrap.js:597-626` | `handleStorageChanged` | LISTEN | Reads `oldValue` and `newValue` (612-613); guard at 609 (view absent from the change) and 610 (projection write); merge at 615. |
| `content.js:53` | (import) | HAND-OFF | Imports the constant. |
| `content.js:579-615` | `refreshContentPageCoordinatorStateFromRuntime` | RESPONSE | Reads `result.profileNukeProgress` (612-613) from the content-state message. |
| `content.js:630-660`, arm at `656` | `onStorageChanged` | LISTEN | Refresh on a change to the view (or the queue view). The arm calls `scheduleContentPageStateProjectionRefresh` (`657`). |
| `content.js:704` (removal at 710) | `source.addListener(onStorageChanged)` | LISTEN (registration) | Registers the handler above. Not a read. |
| `content.js:3938-3945` | bar's storage listener | NOT A READER | Reads only `COORDINATOR_PAUSED_KEY` (line 3941). It does not read the progress view key. |
| `content.js:1487-1488` | `clearProfileNukeState` | RESPONSE | Reads `result.profileNukeProgress` from a message response. |

Related, not a reader of the progress view: `retireLegacyQueueViewStorageKey` (`sw.js:35979-35982`, called at `sw.js:36002`) removes the queue view key on load.

### 2b. Resident-copy consumers

These read the worker's or content's in-memory map (`profileNukeProgress`), which is loaded from the view and shards. They do not read storage, but they change if the view's contents change. Ranges include a few comment lines.

- Worker, `sw.js`: 4051-4052, 4243-4244, 4536-4553, 4889, 6059-6060, 11458-11459, 11802-11903, 17051, 18316, 18330, 23619-23623, 23979-23983, 24737-24738, 24872-24903, 24982-24983, 26334, 29377, 29487, 30188, 31011, 31409, 31900, 32540, 33277-33366, 33478-33479, 33956-33957, 34209, 34264-34265, 34355, 35797, 35823-35825. Threaded through accessors at `sw.js:1708, 2462, 2842, 11096`.
- Worker, `swBootstrap.js`: 375 (read), 608 (guard), 615 (merge), 137-138 (accessor).
- Worker modules through `getProfileNukeProgress`: `swCoordinatorReconcileLockedMaterialization.js:546`; `swCoordinatorReconcileSupportSingles.js:179, 233`; `swProfileProgressMerge.js:324`; `swQueuedTabRetryStaleReconcile.js:169`.
- Content, `content.js`: 272 (declaration), 889 (`reconcileStaleSpaceFeedProgress`), 1088, 1220-1251, 1285-1286, 1308, 1325, 1351 (`getProfileNukeProgressRecord`), 1476, 1615-1633, 2337 (`onMessage`), 7889-7893 (`isProfileNukeSucceeded`, which reads through 1351), 8592 (diagnostic count).

### 2c. Tools in the repo that read or remove the key on disk

These read `chrome.storage.local` through the debugger or a dump. Under the design, a view that is not on disk makes them see nothing, unless they are changed (decision 32; route open).

- `tools/cdp/audit-action-kinds.js:26, 30`
- `tools/cdp/clear-coordinator-test-state.js:18` (removes keys by prefix, `mbProfileNukeProgressView`)
- `tools/cdp/enqueue-visible-profile-search.js:107, 109`
- `tools/cdp/inspect-queue-brief.js:12`
- `tools/cdp/inspect-queue-item.js:34, 37`
- `tools/cdp/inspect-recovered-queue-item.js:33, 88`
- `tools/cdp/inspect-space-state.js:47, 52`
- `tools/cdp/queue-storage-summary.js:33, 46-47`
- `tools/cdp/queue-summary.js:27, 31, 120`
- `tools/cdp/sw-queue-summary.js:28, 34`
- `tools/cdp/wal-snapshot-benchmark.js:144`
- `tools/cdp/storage-read-profile.js:14`
- `tools/cdp/upgrade-regression/run.js:151, 211, 224` (regex patterns), `1222, 1235-1237` (record counts)

### 2d. Tests

- `test/p1-contract.test.js`: 339, 2030, 2071, 2110, 2112, 2433-2434, 4341, 5619, 6121 (comment), 6169. Most are source-text assertions: for example that `storageKeys.js` declares the key (2071), that the listener reads the key (2433-2434), and that the repair clears it (2112).
- `test/swStorageMetrics.test.js:31`
- `test/swSynthetic.test.js`: 94 lines. Fixtures seed the view on disk as object literals at 2150, 20178, 20214, 20334, 20480, 20518, 20566. Observers that check whether a payload wrote the view: 5154, 5287, 5374, 9324, 9418, 10357, 11667, 22922. Assertions that a queue write leaves the view unchanged: 297-309, 1558. Assertions on record status and removal: the rest (for example 3155, 4740-4742, 9481-9486, 12030-12032, 20502-20504, 23035-23040). Full list: 297 309 1558 2150 3155 3232 4740 4741 4742 5154 5287 5327 5374 5405 7328 7528 9061 9298 9324 9349 9392 9418 9439 9481 9482 9483 9486 9529 9530 9554 9564 9991 9992 10055 10357 10372 11667 11938 12030 12031 12032 12152 12153 12154 12172 12612 12806 13562 13566 13700 13704 14031 14092 14424 14496 16686 20178 20214 20293 20334 20469 20480 20502 20503 20504 20518 20557 20566 20591 20606 22444 22756 22757 22758 22819 22825 22896 22922 22945 23035 23036 23037 23038 23039 23040 23079 23127 32147 36524 37329 37407 37934 39131 42706.

#### 3. Findings: what changes if the view leaves disk

- **F-a. Fixtures seed the view on disk.** Seven fixtures in `swSynthetic.test.js` (2150, 20178, 20214, 20334, 20480, 20518, 20566) write the view into the fake storage. Under the design they must seed through the authority instead. The derived content index went through the same change (memory note `project_content_index_derived_2026_10_18`). The other 87 references in that file are observers and assertions (section 2d).
- **F-b. Two assertions would test nothing.** `swSynthetic.test.js:297-309` ("a queue write leaves the progress view as it was") compares the view before and after a write. `:1558` compares the disk view with the session mirror. If the view is not stored, the first compares two empty values and the second fails or passes for the wrong reason.
- **F-c. The worker listener has no trigger.** `handleStorageChanged` (`swBootstrap.js:595-625`) reacts only to a storage change of the view. Once the view is memory-only, nothing outside the worker writes it, so the listener is dead unless kept for another writer (D5).
- **F-d. The content refresh loses its trigger.** `content.js:656` refreshes on a change to the view. If the view is no longer stored, the refresh needs another signal (D2, D13).
- **F-e. The rebuild gate reads the view's version.** `isContentPageStateProjectionMissing` (`swContentPageStateProjection.js:250-256`) checks `progressView.version`. With the view in memory, the check needs an in-memory marker (D4). Today the check can also cause a disk write through the repair (F5).
- **F-f. The session mirror already holds the view.** A session copy of the view and shards exists (section 0, item 3). Choosing between the mirror and a new session key is part of the session-memory coding.
- **F-g. The shard write path changes.** Shards move from stored-key writes (`sw.js:9932-9966`) to WAL appends and checkpoints. The repair at `sw.js:10030-10046` writes changed keys directly today, so it has to be rewritten, not just removed.
- **F-h. The view's cap is a visible limit.** The view holds at most 1,200 summaries (`sw.js:687`), and its `truncated` flag tells the projection check when it is incomplete (`swContentPageStateProjection.js:225`). Content's scoped progress is the view records merged with the shard records for the page's hrefs (`sw.js:35784-35788`), so the cap limits only the view part. Any design that drops the view must say what the merge uses instead (D3, D7).

### 10.2 Coder plan items closed on 19 Oct

- Section 0a, "Session-memory coding for progress": coded (decision 31). Its open choices (D2, D12, D13) are decided by David's answers on 18 Oct and recorded as decisions 33 and 32.
- Section 0a, "Tools and tests that read progress from disk": the route is chosen (decision 32, route a). The worker message exists. The thirteen tools are still open (section 4a, item 4 of the coder plan).
- Section 0a, "Legacy cleanup for the progress keys": coded. It waits for nothing else now.
- Section 4a, item 3 (session coding): done, with its open items listed in the coder plan.
- Section 4a, item 5 (legacy cleanup): done, not run.
- Section 4a, item 6 (wire test files): done for `test/swProfileNukeProgressPush.test.js`.
- Section 4a, item 3 of the 18 Oct list "Before coding, list these open items": answered in the coder plan, section 2, and removed from the open list.

## 11. Coder instructions of 18 Oct, retired on 19 Oct (full text)

Replaced by `coder-instructions-2026-10-19.md`. Kept here so that nothing is lost. Headings are demoted by three levels. Don't work from this copy.

#### Instructions for the coder, 18 Oct 2026

Status: decisions made with David on 18 Oct. Nothing in this file is built, version-bumped, committed or deployed. Read the whole file once before you start. Line numbers are approximate; search by name.

Work that is finished, and directions that were superseded, are in `clear-history-2026-10-18.md`. Don't re-check them.

##### 0. Open work, in order

1. **Queue bar: report and Firefox read (decisions 9, 11, 13–17, 24).** The code and its tests are in place. Remaining: the bar report (section 8, item 2), and the Firefox check by reading the code. Both browsers use the same runtime messages; confirm that the worker answers the action names the content script sends. No browser run until David asks.
2. **Progress repair: count before the first run (section 4a, item 2).**
3. **Tools that read progress from disk (decision 32, route a; section 4a, item 4).** The worker answers `get-profile-nuke-progress` now. Thirteen diagnostic scripts still read the progress keys from disk. Convert each to the message, list its old and new read, and report. None can be checked without a live run.
4. **Changed files (decision 23).** Keep going on the files that changed on disk during your pass. Re-check only your own edits in each, and report every change you didn't make.
5. **Reporting (section 8).** Give two outputs each time: a technical report for this file, where code detail is fine, and a plain summary for David covering behaviour, data, risk and the choice, with no code references, paths or line numbers.

##### 0a. Blocked on David's decisions (do not start)

- **Restart and the push (section 4a, item 3).** Choose (a) accept, as the bar does, or (b) keep the pushed tabs in session memory too.
- **Coder choices in code, to confirm (section 2, after decision 32).** The session-read failure at hydrate, the removal rule in the worker's listener, and the cleanup's place after the authority load.
- **D4, D5, D8 and D9 (section 5D).** Not decided. Keep the current behaviour until David chooses.
- **Helper used only by tests (section 4a, item 1).** Keep it as a named test helper, or delete it with its tests. David to choose.
- **Migration: the candidate-list backfill (decision 20) and the drops of orphaned and empty records (decisions 21 and 25).** Wait for approval of the migration design.
- **Events, pending records and the unified store (section 5).** Not started. Their open choices are in the notes (A3–A23, B2–B15, C2–C15). Each needs David's choices first.

##### 1. Rules for all work

- Branch `review/shared-wip`. No commits, tags, branch changes or history rewrites.
- No build, version bump, `web-ext`, `npm run prod`, `build:*`, browser reload or browser run. Tests and lints are allowed: `bash -lc 'npm test'`, the six lint targets (`lint:correctness`, `lint:queue-boundary`, `lint:block-classification`, `lint:queue-storage-layering`, `lint:no-outside-writes`, `lint:duplicates`), and `node test/swSynthetic.test.js "--filter=review-2"`.
- Edit `shared/` source only. `webpack.mix.js` copies `shared/js` into `chrome/js` and `firefox/js` at build time, so don't hand-edit those copies.
- Don't revert, delete or untrack anything: not unclaimed sw.js hunks, not `tmp/` files, not stored data.
- Before non-trivial changes to `sw.js`, `content.js` or the storage layer, read `entropy-reduction-action-plan-2026-09-09.md`.
- Tunables go in `shared/js/tunables.js`, wait-loop timeouts in `shared/js/timeouts.js`. No promise-hop helpers in `sw.js`: measure with `Date.now()` around the await. No freeze or lock patterns.
- Single-shape fixes only. Where a choice is a protocol, threshold or terminal-state choice, list the options and don't pick.
- No new disk writes. Projections live in memory or session storage. Disk gets WAL appends and checkpoints only.
- Any new test file is wired into `npm test` and `tools/run-tests-parallel.js`.
- Live browser work: no Puppeteer. Use `bash -lc` command shapes.

Reading list: `architecture.md` (Core Authority Model; the terminology section; Cleanup end state, about lines 340–355; the flight recorder, about lines 716–722); `flight-recorder-plan-2026-06-04.md`; `storage-wal-overlay-design-2026-05-20.md` (Snapshot Compression); `docs/queue-storage-layering.md`; `14-oct-review-2-reply.md` (section 8).

##### 2. Decisions in force (do not reopen)

2. **Dedupe.** The window governs dedupe. A profile past the window may be queued again. This applies to the unified store (section 5, note A).
3. **Clear.** Dashboard only. Clear empties the dashboard list. Entries stay for the history page and for dedupe until they age out (section 5, note A).
5. **Diagnostic events.** Memory only, folded into the flight recorder. Only after the two reconcile reads move to durable fields (section 5, note B).
6. **Checkpoints.** Count only: switch at 128 appends, force at 256. No byte ceiling. No change.
7. **Pending staging.** Lives in session storage, written by the worker and not the tab. The migration's drops are in section 5, note C, and decision 25.
8. **Build.** Waits for David's review of this file. Then one timed live run, with the "Run for" limit set before Resume.
9. **Queue bar.** Messages on both browsers. Content asks the worker for the summary by runtime message, and the worker pushes changes to Quora tabs with `tabs.sendMessage`. No session storage and no `setAccessLevel` for the bar. This revises O1 for the bar. Whether it applies to other content reads is open.
10. **601f-pass changes.** Kept as they are (David, 18 Oct). Nothing is reverted. They are the changes from the 601f spec: the content index is off disk and built in memory, the delayed rebuild is removed, the hidden index writer is removed, a refill removal that arrives mid-pass runs again, the pause fixes are in, and the affected tests are rewritten. Item 1c is covered by decision 31. Items 1d to 1f still write to disk and stay open.
11. **Queue bar hook.** One hook in `notifyCoordinatorDashboardStateChanged` (`shared/js/swCoordinatorReconcileSupportSingles.js`), outside the sw.js call sites. Clear writes an explicit zero summary (David, 18 Oct).
12. **Candidate list.** Each queue row's evidence carries the full candidate list, written at enqueue. This is option b, and it answers both C1 and A1. Interim, until the unified store exists. Candidate lists average 1.2 per post (at most 9, about 500 bytes), so rows grow by about 60 bytes on average. Staging is removed only after the list is written (David, 18 Oct).
13. **Bar display.** 0/total while work is queued and the queue isn't paused. Hidden only when nothing is queued, the batch is done, or the queue is paused (David, 18 Oct).
15. **Bar push targets.** The worker pushes only to tabs that have asked for the summary, identified by the sender's tab id. No URL matching and no manifest change (David, 18 Oct).
16. **Deferred broadcast race accepted.** No sequence number and no sw.js edit (David, 18 Oct).
18. **Legacy list.** A fixed list of 65 names from the builders' constants, not a key scan (David, 18 Oct). The progress keys are added under decision 31.
19. **Clear History deletes the history.** It empties the nuked-post map, as it does now. Profiles from those posts can then be queued again at once. This answers the Clear History question. It is not Clear, which stays dashboard-only under decision 3 (David, 18 Oct).
20. **Backfill.** Rows enqueued before the change get their candidate lists during the migration. This is needed for the 1,232 in-progress and 1,394 stuck posts, which survive the migration (David, 18 Oct). Waits for the migration design (section 0a).
23. **Edits to changed files.** Keep going on the files that changed on disk during your pass: swBootstrap.js, swCoordinatorReconcileSupportSingles.js, swSynthetic.test.js, run-tests-parallel.js, p1-contract.test.js, swQueueBarSummary.test.js and candidateListEvidence.test.js. Re-check only your own edits in each. Report any change you didn't make (David, 18 Oct).
24. **Restart.** After a worker restart, the bar returns on the next Quora page load. The current build does this (David, 18 Oct).
25. **Eight pending records that link to no work.** Drop them with the migration, not now. Of the 18 empty records, 2 keep (live work), 8 keep (finished work), and these 8 drop with the migration (David, 18 Oct).
27. **Progress is not on disk.** Progress lives in session memory, not worker memory. It survives Chrome putting the worker to sleep and is cleared when the browser closes (David, 18 Oct).
28. **Loss accepted.** After a browser restart, progress that isn't held in the queue is lost. Hydration after a restart restores the queue, not progress. David is indifferent about the wait for hydration (David, 18 Oct).
29. **Outlier list stays as it is.** The dashboard outlier list keeps its current disk writes: the whole record is written with each archive (David, 18 Oct). No change. Its dismissal list has no cap. If it grows, raise it again.
30. **Progress-only saves never start queued work.** The exemption is decided by what a save writes, not by the save's name. A storage update that writes anything other than progress is not exempt, even if it also writes progress (David, 18 Oct). A suppression that a caller sets when its update starts stays in force for that update.
31. **Progress moves to session memory: option (b), approved after the review fixes (David, 18 Oct).** All 16 paths in section 1 of the progress review note write to session memory instead of disk. Progress tokens are dropped; runs and the outlier list keep theirs. The old progress copy on disk goes with the legacy cleanup (David, 18 Oct). Decisions 27 and 28 still hold: progress is lost when the browser restarts.
32. **Tools read progress through the worker (David, 18 Oct).** Any tool or test that reads the progress keys from disk asks the worker instead. Route (a) is approved: the new worker message `get-profile-nuke-progress` returns the resident records (David's answer, 18 Oct).
33. **Content gets progress by message only, and the worker pushes changes (David, 18 Oct).** Content asks for its scoped state by message, as before. The worker pushes `profile-nuke-progress-changed` to the tabs that asked for page state. The content storage trigger is removed. Chrome first; Firefox on the same message path (D2 a, D13 b, D12 a).

Coder choices in code (19 Oct). They follow from the decisions above and are listed for David to confirm. None is a protocol choice:
- A failed first session read at hydrate fails the authority load, as a failed disk read does. An empty progress copy would be saved over the real one by the next write.
- The worker's storage listener ignores a removal of the progress view. The legacy cleanup removes the old copy at startup, and that must not schedule a queue resume (decision 30).
- The legacy cleanup runs after the first authority load, not at module load (`legacy-index-cleanup-design.md`, section 5).

Still in force from earlier decisions:
- O1 (content reads from the session mirror, with a broadcast for notifications) is revised for the queue bar by decision 9. Whether it changes for other content reads is open. Runtime messages don't reach content scripts, so any push to content must use `tabs.sendMessage`.
- Compression: checkpoints and sealed history shards use the existing fflate gzip codec. WAL appends stay raw.

##### 3. Facts the decisions rest on (checked 18 Oct)

- **Pending records, dev profile at 18 Oct (read-only audit).** 3,368 records and 3,986 profile links still waiting. For comparison: 1,213 live queue rows and 3,607 completed rows.
  - 1,232 records are in progress: every remaining profile has a live row.
  - 1,394 records are stuck: a remaining profile already finished, and no live row is left to confirm it.
  - 724 records are orphaned: at least one remaining profile has no live row and no completed row. 799 profile links are in this state in all.
  - 18 records are empty.
  - Of the remaining profiles, 1,587 completed successfully, and all of those finished within 21 days, inside the 30-day window. 95 completed otherwise.
  - Method, to reproduce: copy `chrome.storage.local` through the debugger with a read-only `get(null)`. Then decode the copy with `shared/js/walSnapshotStore.js`: `hydrateSegmentedWalStore(dump, {baseKey: 'mbCoordinatorQueueWal', fallbackStore: null})`, then `recoverProjectedState(store, [], {codec})` with a gzip codec. The state is at `recovered.projected.state`, with `queue` and `completed`. The audit script is in David's scratchpad, not the repo.
- **Clear leaves pending behind.** For Clear current work, `buildStoredWorkClearPlan` (sw.js ~26109–26134) builds its cleared list from live rows only. The completed-row removal (sw.js ~26172–26183) removes every completed row, and their profiles never reach the cleared list. The dashboard only counts the returned list (coordinator.js ~1674–1683). Pending records are never touched. Clear All Stats only sets a cutoff time (sw.js ~6497). This is the likely cause of the 724 orphans.
- **Events are read back by logic.** `hasTerminalKeyOnlyCoordinatorEvent` (swCoordinatorReconcileLockedMaterialization.js ~358–382) decides whether a terminal key-only item was already applied. The architecture doc lists events as a derived view (architecture.md ~347–348), so this read contradicts the design.
- **Clear History** (coordinator.js ~179–183) wipes all history: it sends an empty nuked map. Decision 19 settles this.
- **Entries and pending, verified.** Queue and completed rows carry `postKey` and `postUrl` inside their `evidence` items (queue: 1,544 items on 1,188 rows; completed: 3,779 items on 2,266 rows). They carry no candidate list and no top-level post fields. (An earlier check looked only at top-level fields; this one checked nested evidence.) Pending records carry `allUrls`, `postKey`, `postUrl`, `spaceKey`, `resolverPending` and `jobKeys`. The 18 empty pending records all have empty `resolverPending`, but they still carry `jobKeys`.
- **Flight recorder** (`shared/js/swflightRecorder.js`): an in-memory ring buffer of 20,000 entries (`FLIGHT_RECORDER_CAPACITY`). A session snapshot holds the newest 2,000 (`FLIGHT_RECORDER_SESSION_SNAPSHOT_LIMIT`), written at most every 10 s (`FLIGHT_RECORDER_SESSION_PERSIST_MIN_MS`), under `mbFlightRecorderSnapshot`. String fields are cut to 240 characters.
- **Storage numbers.** The 18:00 run wrote 284 MB in six minutes. The content-queue index family was 210 MB of that (74%). The archive path alone made 37 index-projection writes (127 MB).
- **Compression, measured.** Live queue checkpoints: 14.8:1 with gzip. Real dashboard rows (1,141–1,269 rows, 29 keys, 974 bytes per row raw): about 19:1 raw in 200-row shards, about 14.5:1 once base64 is included, about 23:1 with keys written once per shard.
- **Firefox, verified in the repo.** `experiments/design-probes/NOTE.md` (lines ~78–88) probed Firefox: content scripts have no `storage.session` at all, and `setAccessLevel` is not available to content. Content reaches the worker through messages, which route through the background event page. A May 2025 MDN report says `setAccessLevel` is missing in Firefox. So on Firefox, content must get the bar's data by message.

##### 4. Open work outside the decisions

1. **tmp/ (proposal only).** Put the proposed `.gitignore` line (`tmp/`) in your report. List the two tracked files (`tmp/quora-reporting-assets.json`, `tmp/quora-reporting-assets.urls`) and what references them. Don't delete or untrack anything.

###### 4a. Progress path (decisions 29–32)

Single-shape fixes only. Where a choice is listed under "Not decided", list the options in your reply and don't pick. Source: `progress-path-review-2026-10-18.md`.

1. **Helper used only by tests (not decided).** `readCoordinatorQueueRowsFromMirror` is used only by tests. Keep it as a named test helper, or delete it with its tests. List both options in your reply.
2. **Progress repair: count before the first run (open).** The one-time repair on a page request keeps its behaviour (review F5). Under session memory it writes to memory, like the rest. Before the first run, measure in the dev dump how many unfinished progress records have no open queue row, and report the number. Don't change the filter.
3. **Session-memory coding for progress (done 19 Oct, not built or run).** Decision 31 and decision 33. Open for David, in plain terms: the restart and the push (section 2, and section 0a); the session quota, which is the main risk: progress about 5.35 MiB plus the session copy of the queue WAL about 3.2 MiB and runs about 0.2 MiB, against Chrome's 10 MiB session limit, so the whole session area must be measured live before shipping (`progress-durability-design.md`, section 3); Firefox (the session area from 115 is supported in extension pages, content cannot read it, no live check run).
4. **Tools that read progress from disk (open, decision 32 route a).** Thirteen scripts in `tools/cdp`, listed in `progress-durability-design.md`, section 3. Convert each to `get-profile-nuke-progress`, and list each one's old and new read. No tests remain on the disk key: the harness reads progress from the session copy.
5. **Legacy cleanup for the progress keys (done 19 Oct, not run).** The fixed list has the 131 names (65 index, 66 progress). The cleanup runs once per browser session, after the authority load, with its marker in session storage. Six tests in `test/swSynthetic.test.js`; case 5 of the plan is not written (see `legacy-index-cleanup-design.md`, section 9).
6. **Wire new test files into `npm test` and `tools/run-tests-parallel.js` (done).** `test/swProfileNukeProgressPush.test.js` is wired in both. `npm test` exits 0 with 1,236 ok; the five node lints exit 0; `lint:duplicates` (jscpd) exits 0 with 41 clones, the same as the inventory. No build and no version bump.
7. **Report to David in two parts** (section 8).

##### 5. Design notes (no code until David approves each note)

Write each note at the repo root. Mark each open choice with its options. Don't pick. Number the choices A1… in 5A, B1… in 5B, C1… in 5C and D1… in 5D. Don't use O-numbers: those are David's walkthrough decisions.

The notes and their open choices:

- **A. `unified-store-design.md`: history and completed work as one stored form.** Open: A3 to A23. Owner calls: A7 (whether the window follows user settings) and A15 (requeue from history).
- **B. `events-to-flight-recorder-design.md`: events become memory-only.** Open: B2 to B15. B2 has two options left: (a) first page, (c) most frequent page.
- **C. `pending-staging-design.md`: pending in session, and the migration.** Open: C2 to C15. C10 (the 18 empty records) is David's question.
- **D. `progress-durability-design.md`: progress in session memory.** Open: D4, D5, D8 and D9. D1, D2, D10, D11, D12 and D13 are decided and implemented (decisions 27, 31, 32 and 33).
- **`legacy-index-cleanup-design.md`.** No open choices. Coded on 19 Oct: the fixed list (131 names), the session marker, and the startup place after the authority load.
- **`projection-cost-design-note-2026-10-18.md`.** Open: whether finished rows belong in the index, and the measurements after the in-memory change is built and run.

##### 6. Hold. Don't start

- Any build, version bump, reload or browser run. The next build waits for David's review of this file. Then one timed live run, with the "Run for" limit set before Resume.
- Commits, tags and branch changes.
- Code for the design notes in section 5, until its note is approved.
- Any change to dedupe or Clear behaviour in code. Those changes live in the notes only.

##### 7. Stop and ask David if

- an edit you need falls inside an unmatched sw.js hunk;
- you find another writer of the queue view, the events key or the pending key;
- the Firefox session check fails, or stays unverified for something you must ship;
- a test needs changing beyond the lists you report;
- anything you touch could lose stored data.

##### 8. Report back

1. The hunk mapping: the hunk map file is the record. Update it for any hunk you touched, with the matched groups and one line for each unmatched hunk.
2. The queue bar change: files and lines, tests, the content.js ~655 finding, and Firefox status.
3. Each test you added or changed, with its old and new assertion. The guard test and the resume exemption tests are already in place; report their results.
4. The index injection removal, marked as unplanned.
5. The legacy cleanup design path and its keys, and the tmp/ proposal.
6. Design notes A to D: their paths, and each open choice with its options.
7. Test counts: `npm test`, the lints, and the review-2 filter.
8. Your questions for David, numbered, with options.
9. Section 4a: the result of each item, the count from its item 2, and the open items from item 3.

## 12. Coder instructions of 19 Oct, retired on 20 Oct (full text)

Replaced by `coder-instructions-2026-10-20.md`. Kept here so that nothing is lost. Headings are demoted by three levels. Don't work from this copy.

#### Instructions for the coder, 19 Oct 2026

Status: this file replaces `coder-instructions-2026-10-18.md`, which is now a short stub. The full 18 Oct text is in `clear-history-2026-10-18.md`, section 11. Nothing in this file is built, version-bumped, committed, tagged or deployed. Branch `review/shared-wip`, uncommitted working tree.

Read the whole file once before you start. Line numbers are approximate; search by name.

**Reading list, in order:** `AGENTS.md`; `entropy-reduction-action-plan-2026-09-09.md`; `architecture.md` (Core Authority Model, the terminology section, Cleanup end state); `docs/queue-storage-layering.md`; `progress-durability-design.md`; `legacy-index-cleanup-design.md`; `progress-path-review-2026-10-18.md`; `hunk-map-2026-10-18.md`. Skim `clear-history-2026-10-18.md` for finished items, and don't re-check them.

##### 0. Where things stand, and what you may start now

Where things stand (19 Oct, after the last code change):

- Profile progress is held in session memory only (decision 31). The code, the tests and the notes are in the working tree. Not built, and not run in a browser.
- The old disk copies of progress and of the content index (131 names) are removed once per browser session, after the authority load (choice K3). Coded and tested offline. Not run live.
- A new worker message returns the whole progress (decision 32). The tools that use it are not converted yet (0a).
- Unknown: the total session storage used on a live profile. On the dev data, progress alone is about 5.35 MiB and the queue's session copy about 3.2 MiB, against Chrome's 10 MiB session limit (section 3).
- David has not answered the questions in 0a.

**Start-of-day check, before any change:**

1. `bash -lc 'npm test'` (about 10 minutes). Last verified: exit 0, 1,236 ok, 0 not ok, after the last code change on 19 Oct. If your result differs, stop and report the difference first. Another session may have changed the tree.
2. The six lints: `bash -lc 'npm run lint:correctness'`, `lint:queue-boundary`, `lint:block-classification`, `lint:queue-storage-layering`, `lint:no-outside-writes`, `lint:duplicates`. Last verified: all exit 0, and `lint:duplicates` reports 41 clones.

**You may start these now:**

1. **Entropy-reduction check of the 19 Oct progress change.** Read the plan first: AGENTS.md requires it before non-trivial changes to `sw.js`, `content.js` or the storage layer, and the 19 Oct change was made without that check. Then check each changed area against the patterns the plan lists: the progress split in the door; the hydrate session read; the progress push and its subscriptions; the worker's storage-listener guard; the content push case; the legacy cleanup; the tool read handler; the harness storage view. Points to look at: the cleanup and the push are fire-and-forget; the cleanup uses the session and local areas directly; the test harness repeats the progress key rule (is that a duplicate constant worth sharing?). For each area, say whether it is a new instance of a listed pattern. Fix single-shape issues only, and list the rest with options.
2. **Progress repair count (4a, item 2).** Offline and read-only, from the saved dev dump (section 3, method). Count the unfinished progress records that have no open queue row. "Unfinished" means not terminal under the progress code's terminal test (`isTerminalProfileNukeRecord`). "Open queue row" means a row in the recovered queue (`recovered.projected.state.queue`) for the same profile href whose status is not terminal under the queue's own terminal test; name that test in your report. Report the count and both definitions. Don't change the repair filter. Don't open the live browser.
3. **Queue bar: the report and the Firefox read (decisions 9, 11, 13–17, 24).** Read-only. Confirm that the worker answers the action names the content script sends, in both browsers. Write the bar report (section 8). No browser run.
4. **Hunk map for the 19 Oct changes.** Add a dated section to `hunk-map-2026-10-18.md`. Cover `shared/js/sw.js`, `shared/js/swBootstrap.js`, `shared/js/content.js` and the new `shared/js/swProfileNukeProgressPush.js`. For each changed area, give the note and section it matches: decision 31 (`progress-durability-design.md`, sections 1 and 4), or the cleanup (`legacy-index-cleanup-design.md`). Don't re-run the full 252-hunk pass, and don't rewrite the 18 Oct map.
5. **Case 5 of the cleanup tests (optional).** Write it only if it needs no timing-sensitive code: an update abandoned between the cleanup's read and its removal, so that the removal is refused and no marker is written. If that can't be done cleanly, say why in the report and leave it out.
6. **Changed files (decision 23).** Before each edit, check that the file has not changed on disk since you read it. Re-check only your own edits in each file, and report every change you did not make.
7. **Notes upkeep.** Keep the working notes live-only. Move finished items into `clear-history-2026-10-18.md` as a new dated section. Keep each open item in the working notes, with its options.

##### 0a. Waiting for David: do not start

- **Live run, session size, and the first start (needs David's go, and a build first).** The checklist is in 4a, item 4.
- **Restart and the push (decision 33; choice K5).** Options: (a) accept the gap, as the queue bar does; (b) keep the pushed tabs in session memory too. Don't start (b) until David chooses.
- **Tools that read progress from disk (decision 32).** The route is approved; the target is not. The diagnostic tools run inside the worker's own target, and a message sent from a context is not delivered to that same context's listener (confirm this in the browser's messaging rules before choosing). Options: (a) run each tool from an extension page target (the coordinator page, or one opened for the purpose) and send the message from there; (b) a worker diagnostic hook, which must not ship to users; (c) read the session copy directly, which is not a read through the worker. Recommendation: (a). `clear-coordinator-test-state.js` also removes progress keys; a message cannot do that, so it needs its own choice.
- **The helper used only by tests (4a, item 1).** Keep it or delete it. David's choice.
- **Decisions D3 to D9 (progress note, section 3).** Not decided. Keep the current behaviour unless David chooses.
- **Migration (decisions 20, 21, 25).** Waits for approval of the migration design.
- **Events, pending records and the unified store (section 5).** Not started. Each needs David's choices first.
- **Builds, version bumps, zips, commits and tags.** Only when David asks (section 6).
- **Choices K1 to K6 (section 2).** David to confirm or change each one.

##### 1. Rules for all work

- Branch `review/shared-wip`. No commits, tags, branch changes, history rewrites or pushes until David asks.
- No build, version bump, `npm run prod`, `npm run build:*`, zip step, browser reload, browser run or live run until David asks. Allowed: `bash -lc 'npm test'`, the six lints, and `bash -lc 'node test/swSynthetic.test.js "--filter=<text>"'` to run one area.
- Repo-local reads, edits, tests and lints are authorized (AGENTS.md). If a command fails because of sandbox or wrapper noise, retry once through `bash -lc`. Don't ask David for repo-local permission.
- Edit `shared/` source only. `chrome/js`, `firefox/js` and `chrome-dev/js` are build output. Don't hand-edit them.
- Don't revert, delete or untrack anything: not another session's changes, not unclaimed `sw.js` hunks, not `tmp/` files, not stored data, not the saved dev dump.
- Hydrate and startup: keep the await chain of hydrate and the startup path as it is. Put any new read into an existing read. Seed test state into the storage the worker reads before the worker loads, not after. Install spies on storage reads before the worker loads. The reason is recorded in `clear-history-2026-10-18.md`, section 10.
- No promise-hop helpers in `sw.js`. Measure a wait with `Date.now()` around the await.
- Tunables go in `shared/js/tunables.js`. Wait-loop timeouts go in `shared/js/timeouts.js`. Colours go in `shared/css/tokens.css`.
- Single-shape fixes only. For a protocol, threshold, terminal-state or other choice, list the options in your report and don't pick.
- No new disk writes. Progress, projections and queue state live in memory or session storage. Disk gets WAL appends, checkpoints, and the removals in the legacy cleanup only. Every new session key counts toward the session total (section 3).
- Any new test file goes into `npm test` (package.json) and `tools/run-tests-parallel.js`.
- Correctness over speed on hydrate, recovery and startup: prove the state is current rather than trust a cached copy.
- No freeze or lock patterns. Don't restore file modes (755) unless something breaks. Don't refactor proactively.
- Live browser work, once approved: use CDP, never Puppeteer. Use `bash -lc` command shapes. A timed run sets "Run for" before Resume.

##### 2. Decisions in force (do not reopen)

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
18. **Legacy list.** A fixed list of 131 names built from the builders' constants: 65 index names and 66 progress names (the view, the 32 shards, and their 33 namespace tokens). Coded on 19 Oct (4a, item 4 covers the live run).
19. **Clear History deletes the history.** It empties the nuked-post map. It is not Clear, which stays dashboard-only under decision 3.
20. **Backfill.** Rows enqueued before the change get their candidate lists during the migration. Waits for the migration design.
23. **Changed files.** See 0, item 6.
24. **Restart (bar).** After a worker restart, the bar returns on the next Quora page load.
25. **Eight pending records that link to no work.** Drop them with the migration, not now.
27. **Progress is not on disk.** Progress lives in session memory, not in the worker's memory. It survives the worker going to sleep and is cleared when the browser closes.
28. **Loss accepted.** After a browser restart, progress is lost. On the update, the old progress copy is removed once, so progress starts empty.
29. **Outlier list stays as it is.** The whole list is written to disk with each archive.
30. **Progress-only saves never start queued work.** The rule looks at what a save writes, not at its name. A caller's own suppression stays in force.
31. **Progress moves to session memory (option b).** Coded in the working tree on 19 Oct. Progress tokens are dropped; runs and the outlier list keep theirs.
32. **Tools read progress through the worker (route a).** The worker answers `get-profile-nuke-progress`. The tools' target is open (0a).
33. **Content gets progress by message only; the worker pushes changes (David, 18 Oct: "Message only", "Worker pushes on change", "New worker message", "Chrome first").** Content asks for its scoped state by message, as before. After each successful progress write, the worker sends `profile-nuke-progress-changed` to the tabs that asked for page state. Chrome first; Firefox on the same message path.

Still in force from earlier decisions: the queue bar is revised by decision 9 (O1). Checkpoints and sealed history shards use the existing fflate gzip codec; WAL appends stay raw.

**Choices made in code on 19 Oct.** They follow from the decisions above. They are not decisions yet; David to confirm or change each one.

- **K1.** A failed first session read at hydrate fails the authority load. So does a missing session area.
- **K2.** The worker's storage listener ignores a removal of the progress view. A removal is not a progress change, and the cleanup removes the old copy at startup.
- **K3.** The legacy cleanup runs after the first authority load, not at module load.
- **K4.** A session write that the area refuses is "not saved". A thrown session write follows the storage-error path, as a disk write does.
- **K5.** The set of tabs to push to is held in the worker's memory. This is the restart gap (0a).
- **K6.** The reply to the tool read is the worker's own progress copy, loaded through the same gate as the other progress readers.

##### 3. Facts the decisions rest on

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
- **Hunk map.** `hunk-map-2026-10-18.md` records 252 `sw.js` hunks: 52 accepted, 200 unmatched.

##### 4. Open work outside the decisions

1. **tmp/ (proposal only).** Put the proposed `.gitignore` line (`tmp/`) in your report. List the two tracked files (`tmp/quora-reporting-assets.json`, `tmp/quora-reporting-assets.urls`) and what references them. Don't delete or untrack anything.

###### 4a. Progress path (decisions 27 to 33)

Single-shape fixes only. For a choice listed as "not decided", list the options in your report and don't pick.

1. **Helper used only by tests (not decided).** `readCoordinatorQueueRowsFromMirror` is used only by tests. Keep it as a named test helper, or delete it with its tests. List both options.
2. **Progress repair count (open; start now, see 0, item 2).** Report the count and both definitions. Don't change the repair filter. The repair writes through the door, so under session memory its writes go to memory.
3. **Tools that read progress from disk (decision 32; target open, see 0a).** After David's choice, convert these 13 scripts: `audit-action-kinds.js`, `clear-coordinator-test-state.js`, `enqueue-visible-profile-search.js`, `inspect-queue-brief.js`, `inspect-queue-item.js`, `inspect-recovered-queue-item.js`, `inspect-space-state.js`, `queue-storage-summary.js`, `queue-summary.js`, `sw-queue-summary.js`, `wal-snapshot-benchmark.js`, `storage-read-profile.js`, and `upgrade-regression/run.js`. For each one, list the old read and the new read. None of them can be checked without a live run, so say so.
4. **Live verification (needs David's go and a build first).** The checklist for the one timed run: (a) session storage bytes in use at the start, after 30 minutes of queue work, and at the end (Chrome's `getBytesInUse` on the session area); (b) progress saves and pushes per minute; (c) an open Quora profile page updates after a progress change, without a reload; (d) the first start after the update removes the old keys once: none of the 131 names is left on local storage, and the marker is in session storage; (e) the flight-recorder entries for the cleanup; (f) console errors in the worker and in the content target. Record each count. Use CDP. Set "Run for" before Resume.
5. **Session quota (needs item 4).** If the measured total is above about 80% of 10 MiB, stop and report, with options: shrink the progress records (the summary shape, D6 in the progress note); keep the WAL copy on disk only (this changes the mirror design); cap the shards.
6. **Firefox check (needs a live run).** Confirm that content gets progress by message and that the push reaches the tabs.

##### 5. Design notes (no code until David approves each note)

Write each note at the repo root. Mark each open choice with its options. Don't pick. Number the choices A1…, B1…, C1… and D1… as before.

- **A. `unified-store-design.md`.** Open: A3 to A23. David's calls: A7 (whether the window follows user settings) and A15 (requeue from history).
- **B. `events-to-flight-recorder-design.md`.** Open: B2 to B15. B2 has two options left: (a) first page, (c) most frequent page.
- **C. `pending-staging-design.md`.** Open: C2 to C15. C10 (the 18 empty records) is David's question.
- **D. `progress-durability-design.md`.** Open: D3 to D9. D1 is implemented. D2 and D10 to D13 are decided.
- **`legacy-index-cleanup-design.md`.** No open choices. Coded on 19 Oct. Case 5 of its test plan is not written (see 0, item 5).
- **`projection-cost-design-note-2026-10-18.md`.** Open: whether finished rows belong in the index, and the measurements after the in-memory change has run live (needs the live run).

##### 6. Hold. Don't start

- Any build, version bump, zip, browser reload, browser run or live run. The next build waits for David. When it is approved, bump all four version fields first (`package.json`, `package-lock.json`, `manifests/chrome.json`, `manifests/firefox.json`), then build. Every build starts with a bump, including test builds. AGENTS.md's release rule (a commit and an annotated tag for each zip you hand over) applies only once David asks for a build.
- Commits, tags, branch changes and pushes.
- Code for any design note in section 5, until its note is approved.
- Any change to dedupe or Clear behaviour in code.
- Any new disk write of progress, projections or queue data.

##### 7. Stop and ask David if

- an edit you need falls inside an unmatched `sw.js` hunk;
- you find another writer of the queue view, the events key, the pending key, or any progress key;
- a session measurement, or an estimate, is above about 80% of the session limit;
- a test needs changing beyond the lists you report;
- anything you touch could lose stored data, session data included;
- the entropy-reduction check finds a new instance of a listed pattern in the 19 Oct change (report first; fix only single-shape issues);
- a choice is a protocol, threshold or terminal-state choice (list the options; don't pick).

##### 8. Report back

Give two outputs each time.

**Part 1, technical (code detail is fine):**

1. The start-of-day check: `npm test` and the six lints, and any difference from the 19 Oct baseline.
2. Section 0, items 1 to 7: the entropy-reduction check for each area (new instance or not, with file and line); the repair count and both definitions; the bar report and the Firefox result; the hunk-map section; case 5 (written, or the reason it was left out).
3. Each test you added or changed, with its old and new assertion.
4. Test counts: `npm test`, the lints, and `lint:duplicates`.
5. The 0a items, and which ones are still waiting. Don't start them.
6. Questions for David, numbered, with options.

**Part 2, plain summary for David:** behaviour, data, risk and choices. No code references, file paths or line numbers.

## 13. Closed 20 Oct: start-of-day pass (coder instructions of 20 Oct, section 0)

Finished in this pass. Open items stay in the working notes with their options.

- **Baseline (section 0, item 1).** `npm test` exit 0 with 1,236 ok and 0 not ok, as in the 20 Oct baseline. The five node lints exit 0. `lint:duplicates` exit 0 with 41 clones. The baseline matched before any edit. Note: the baseline says nothing under `shared/`, `test/` or `tools/` changed after 19 Oct 00:13, but two files I wrote on 19 Oct (the resume module and the harness) were last written at 23:24 and 23:58 that day. The result matched, so the note has no effect on the baseline.
- **Progress repair count (section 0, item 3; 4a item 2).** Read-only, from the saved dev dump. Both definitions give 1,045 unfinished progress records with no open queue row: the repair filter's own rule, and the instruction's wording (`isTerminalProfileNukeRecord` for unfinished, `isTerminalJobStatus` for an open row). By status: 673 tab-opening, 347 queued, 16 tab-opened, 4 blocking, 1 page-ready, 4 with no status. Live queue rows in the dump: 1,213. Unblock records among them: 0. The repair filter was not changed.
- **Queue bar and Firefox (section 0, item 4).** Read-only. The content sends `get-queue-bar-summary`, and the worker handles it and gates it on the authority. The worker pushes `queue-bar-summary-pushed` with `tabs.sendMessage`. Content and the bar module use no session storage. Chrome and Firefox are built from one bundle (`webpack.mix.js` copies `tmp/mix-shared/js` into both folders), so both browsers have the same action names. The built copies in `chrome/js` and `firefox/js` predate the change and have no bar code, so a live Firefox check waits for a build.
- **Hunk-map section (section 0, item 5).** Added to `hunk-map-2026-10-18.md` as a dated section. Each changed area names its note and section. The 18 Oct map is unchanged.
- **Entropy check (section 0, item 2).** Done for all eight areas. Two single-shape fixes were made. The content push comment no longer names a storage trigger. The dead progress arm in `swBootstrap.js` was removed, then restored, because a contract test in `test/p1-contract.test.js` asserts its text. The open findings and their options are in the working notes, not here.
- **Test counts after the fix.** The arm removal failed one contract test, which stopped the run. The arm was restored. The run after the restore: `npm test` exit 0 with 1,236 ok and 0 not ok; the five node lints exit 0; `lint:duplicates` exit 0 with 41 clones. The same as the baseline.

## 14. Closed 20 Oct: review decisions implemented (David: "go with your recommendations")

The review of the 18–19 Oct progress change (the coder's report of 20 Oct, parts 1 and 2) raised seven decisions. Each was taken with the recommendation. Code and tests are in the working tree. Not built, not run live.

- **Which copy is authoritative (decision 1, option b, first step).** The tool read, the direct progress save and the fallback base of the progress merge now read the stored copy, through one synchronous reader that copies only the profile's shard. Before, they read the module-level copy, which a repair does not update. Two regression tests: the tool read does not show a record the repair dropped; a direct update does not bring back the dropped attempt and event. The second failed on the old base, and passed on the fix. The module-level copy stays (open item 1 in the progress note).
- **The dead progress arm (decision 2, option a).** Removed from the storage listener with its wiring. The contract test now pins that the listener does not read the progress view. The outside-writer test now pins that an outside disk write of the old view is not taken.
- **Two areas, one result (decision 3, option a).** A stored write now reports whether its disk part and its progress part were saved. The disk part is still written first. Found while implementing: when the disk part was refused, the progress part was still written to the session copy. It is not written now. The door reports both parts for a combined write. A counter records a disk part saved with its progress part refused. A test covers the refused progress part.
- **Push race (decision 4, option a).** A tab keeps its subscription when a send that failed was sent before the tab asked again. Two unit tests; one fails on the old rule.
- **Accessor name (decision 5, option b).** Left as it is.
- **Shard prefix (decision 6, option a).** Declared once, in the shared key module, which the contract test guards. The worker imports it; the harness reads it.
- **Cleanup details (decision 7, yes to both).** One reader and one writer for the marker, through the session area. The read has a named timeout in the timeout registry, with the value it had (15 s).

Tests changed for the new behaviour: the tool-read test now checks the stored copy for its last assertion (it had checked the module-level copy, which the tool read no longer loads); the outside-writer test pins that the old view is not read; the contract tests pin the removed arm and the new home of the prefix. Tests added: the two regression tests, the split-write test, the two push-race tests.

## 15. Second pass, 20 Oct: David's answers to the list

David answered the list: "1 b; 2 a, but add to the revisit later list; 3 a; 4 a; 5 proceed; 6 yes; 7 i need context; 8 once this list is handled, time to build, commit and load".

- **1, module-level copy: option b.** Not started. The timing of the change is open (coder file, section 0a). Option A is recommended.
- **2, restart gap: option a, on the revisit-later list.** Added to the defer pile.
- **3, diagnostic progress reads: option a.** Ten of the thirteen scripts read progress by message from an extension page. The shared helper is in the diagnostic tools' library. The clear script and the upgrade regression are not converted yet; the storage profiler stays on disk by design.
- **4, cleanup lock: option a.** The rule is written at the cleanup and in the legacy cleanup design note, section 8a.
- **5, earlier coder choices: proceed.** K1, K3 and K5 stand as built. K2, K4 and K6 changed on 20 Oct (section 14).
- **6, small items: yes.** The repair comment is corrected (comment only). The startup timing race is not changed: its narrow fix needs a test hook the harness lacks, so it waits for David's go. The test-only helper is left as it is, because its keep-or-delete choice is not decided.
- **7, context:** given to David in plain terms, not recorded here.
- **8, build, commit and load:** held until items 1 and 2 are settled. They change shipped code. The tool changes are dev-only.

Verification: `npm test` exit 0, 1,241 ok, 0 not ok (unchanged count; the sw.js changes are comments). The five node lints exit 0; `lint:duplicates` exit 0, 41 clones. Not built, not committed, no browser run.

## 16. Third pass, 20 Oct: items 2, 3, 4 and 5 of David's answers

David's answers: "1 a; 2 go; 3 a; a; 4 a; 5 keep it."

- **1, module-level copy: option A (timing).** Not started. Looking at it found the first step: a queue-only pass with no authority state of its own takes the authority's startup copy of progress and writes it into the in-memory copy. The first step would read the live progress there. It changes what the pass sees, so it needs David's go.
- **2, startup timing race: go.** A startup read that began before a Clear All Stats no longer restores the cache it read. The harness exposes the cache and the reset for the test. The test fails when the guard is removed (checked for one run, then the file was restored exactly).
- **3, clear progress: option a.** A worker message clears every progress record through the normal save path. Only an extension page may send it; a message from a tab is refused. The clear script uses it.
- **4, upgrade regression: option a.** Its snapshots carry the worker's progress, and its progress counts and selections use it. Its before-and-after progress check now reports the loss that decision 28 accepts. David has to set what the check should expect.
- **5, helper used only by tests: keep.**

Verification: `npm test` exit 0, 1,244 ok, 0 not ok (three new tests). The five node lints exit 0; `lint:duplicates` exit 0, 41 clones. Syntax checks on the changed tool files. Not built, not committed, no browser run.

## 17. Release 1.6.1435, 20 Oct: the first step and the load

David's answers: "1 go; 2 i expect it to read the state to get the N, but it can start at 0 of what's left; 3 load means update the extension in the browser".

- **1, first step (go).** A queue-only executor pass reads the live progress from the resident stored copy, not the authority's startup copy. The authority's copy is never updated after startup, and the pass used to write it into the in-memory copy. Test: a progress save after startup survives a queue-only pass; it fails without the change (checked by reverting it for one run, then restoring the file exactly).
- **2, upgrade regression expectation.** It reads the worker's progress for N. After an update it starts at 0. The harness never updates the extension itself, so no check spans an update; its one progress comparison (a discovery smoke does not change progress) is unchanged.
- **3, load.** Version advanced in the four release files to 1.6.1435. The full suite passed (1,245 ok, 0 not ok; the three earlier new tests and the queue-only test). The five node lints passed; the duplicate check is unchanged at 41. The production build, both zips and the dev build were made. Commit 8b245a1, annotated tag v1.6.1435. Before the reload, the dev build was paused with no queue rows; the reload changed the version from 1.6.1434 to 1.6.1435, enabled, with no manifest or runtime errors. After the reload I did not reopen the dashboard to read the state again.

Not in the commit, on purpose: the working notes and docs at the repo root, the `docs` folder, the fallow config, and scratch files (the commit takes the source, tests, tools, manifests, package files, build config, build outputs and release zips).

## 18. Sweep fix, 20 Oct (David: "go ahead and fix the sweep")

- The orphan-tab sweep now reads the live progress, not the startup copy. It is one line, using the same helper as the queue-only pass. The first step had not covered the sweep; this closes that gap.
- A contract test checks that line. The full suite passes: 1,246 ok, 0 not ok. The five node lints pass; the duplicate check is unchanged at 41.
- Not committed, not built, not loaded. The version is still 1.6.1435 (commit 8b245a1).
- Correction: earlier I reported that the dev profile had no queue rows. That came from reading an old key. The queue is in the write-ahead log, and the dev profile has 1,103 rows. The pause flag I read was correct: the profile is paused. The flag has not been re-read since the reload.
- Still open before a live run: session size is unmeasured (estimate about 9 MiB of 10 MiB, above the 80% stop rule; no tool measures the session area; progress is plain JSON in the session, while the queue checkpoints are compressed); the sweep fix needs a build and load; the go and the time limit for the run.

## 19. Release 1.6.1436, 20 Oct: sweep fix, startup clean-up, view drop reverted, and the load

David's answer: "yes" to build, commit and load. His item 2 (drop the summary view from session) had been approved; it was attempted and is not in this release (see below).

- **Sweep fix.** The orphan-tab sweep reads the live progress, not the startup copy. This is the same fix as the queue-only pass in 1.6.1435. Contract test in the p1 contract file.
- **Startup clean-up.** Worker startup runs the progress repair once the authority has loaded. An unfinished progress record with no queue row is dropped; finished records are kept, because content still reads them to know a profile is done. The repair loads the authority itself when it is not loaded, so a failed load writes nothing. Two tests: an unfinished orphan is gone after startup; a finished record with no queue row is kept.
- **Summary-view drop (item 2): reverted, not shipped.** It broke 27 tests: mostly tests that read the session view directly, some status expectations, and one source-text contract. It needs its own pass.
- **Item 1 (which progress fields survive a worker sleep):** not touched, as David asked.
- **Validation on the final tree:** full suite 1,248 ok, 0 not ok (the run after the version bump). Five node lints pass. Duplicate check 41, unchanged.
- **Release:** version 1.6.1436 in package.json, package-lock.json, manifests/chrome.json and manifests/firefox.json. Production build; Chrome and Firefox zips; dev build (name Mute Block Dev, key stripped). Commit 8c7ad13 on review/shared-wip: 13 files, including the two zips (the chrome and firefox folders are gitignored, so the zips were force-added) and the rebuilt sw.js and manifest in each folder. Annotated tag v1.6.1436. Not pushed to origin.
- **Load.** The repo's reload script (tools/cdp/reload-chrome-dev.js) timed out at its reload call (Runtime.evaluate, 15 s). The script reuses the first chrome://extensions tab it finds, and that tab had stopped answering: its developerPrivate calls never returned, including a read-only getExtensionInfo. A fresh background extensions tab answered at once. Reloading from it worked: 1.6.1435 to 1.6.1436, ENABLED, UNPACKED, 0 manifest errors, 0 runtime errors. The service worker reports 1.6.1436, and the coordinator page closed with the reload, as expected. The cause of the stale tab is not confirmed.
- **After the load.** Session progress reads zero (no shard records, no view), which is the update behaviour decided earlier. The dev profile is still paused. No new Quora tabs were opened. The queue helpers read a legacy storage key that is empty, so they do not show the real queue, and the queue has not been re-read since the reload.
- **Left open:** the stale extensions tab (still open, not answering); the reload script's reuse of the first extensions tab (a possible fix is to always open a fresh one; not done); the live run (needs David's go and a time limit); session size; removing the in-memory progress copy (option A); the remaining stale readers.
