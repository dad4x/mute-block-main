# Unified store: history and completed work as one stored form (section 5A)

> **Status: ROADMAP** (24 Oct 2026). Design only. Its storage shape is superseded by the 25 Oct plan. Open behaviour choices A3 to A23 (dedupe window, requeue from history) are not settled by that plan. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: design only, not approved. Nothing here is built, version-bumped, committed or deployed. No open choice is picked; each one lists its options.

Scope: one entry store that replaces the completed-work log (completed area of `mbCoordinatorQueueWal`), the remembered nuked-post map (`mbSpaceNukedPosts`) and their reads in enqueue, requeue, clear and the history page. Pending records are 5C. Progress is 5D. Diagnostic events are 5B.

Basis: the code on branch `review/shared-wip`. Counts come from a read-only decode of the dev-profile storage dump taken 18 Oct 14:04 (`storage-dump.json` in David's scratchpad), using `shared/js/walSnapshotStore.js` in a scratch script. No profile links, post keys or titles were printed. The counts describe one dev profile.

## 1. Basis: the candidate list

Completed rows do not carry the post's full candidate list, and the nuked-post record holds only a partial one. So the entry must carry the full list. The interim answer is in the coder instructions (decision 12): new queue rows carry it in their evidence, written at enqueue. Rows enqueued before that change are backfilled during the migration (decision 20).

The rule that needs the list. `isSpaceFeedPostEffectivelyNuked` (content.js:7941-7944) needs the post's candidate URLs, each with a succeeded progress record. `isSpaceFeedPostNuked` (content.js:7520-7526) needs the post's remembered URL set. Both take the candidate list from the page scan (`entry.candidateUrls`), not from storage.

Evidence on completed rows. A row carries per-profile `evidence` entries with `postKey`, `postUrl` and `sourcePageUrl` (built at content.js:9523-9550, merged at swCoordinatorProgressRules.js:82-108). It does not carry the post's full list. Dump: 3,284 of 3,607 rows have an `evidence` array and 2,266 have an entry with a `postKey`.

Enqueue payload. The space-feed `source` carries type, pageUrl, spaceKey, spaceCategory and preFilter counts (content.js:9726-9731). The items carry one profile each (content.js:9746-9770). No candidate list reaches the worker, before decision 12.

Nuked record. The only stored list is `urls`, written at settle from `allUrls || remainingUrls` (swCoordinatorTerminalSettlement.js:168-177). That list is partial: registration keeps only URLs that were neither remembered nor succeeded at that time (content.js:9058-9066). Dump: 3,071 records, 3,041 with one URL, none with `allUrls`. Readers accept either name (content.js:7581-7596).

## 2. Facts that bound the design (dump, 18 Oct)

| Item | Value | Where read |
|---|---|---|
| Live queue rows | 1,213: 1,103 queued, 73 succeeded, 29 failed, 8 skipped | decode |
| Completed rows | 3,607: 3,377 succeeded, 176 skipped, 53 failed, 1 canceled | decode |
| Completed row size | average 3,078 raw bytes, 64 distinct fields, 11.1 MB total | decode |
| Completed rows without `coordinatorKey` or `executorMaxConcurrent` | 323 each | enqueue reads them at sw.js:24349-24386, swCoordinatorExecutorClassification.js:138-141 |
| Completed-row age | newest 0.1 day, oldest 20.7 days, 16 distinct days, peak 623 rows in one day | decode |
| Completed-log retention | none; no prune path exists | code |
| Nuked records | 3,071, all `updatedAt` inside 30 days; 1.5 MB as JSON | decode |
| Pending records | 3,368 (5C) | decode |

Measured compression, same dump: whole log 13.6:1 (815 KB gzip); 200-row day shards 15.2:1. With base64 (4/3 expansion) the effective ratio is about 11.4:1.

Rate: 3,607 rows over 20.7 days is about 174 rows a day; the peak day is 623. At the average, 30 days is about 5,200 rows, so the 30-day rule binds before the 10,000 cap unless the rate stays above about 333 a day.

Reads of the completed map today: `completedRecent(50)` in reconcile (sw.js:11509), `completedRecent(MAX)` in enqueue, requeue and clear (sw.js:24349, 23884, 26172). `getRecentCompletedWorkRows` sorts the whole map on every call (sw.js:6330-6336, 10708-10710).

## 3. Entry shape

Fields that code reads from an existing completed row (each must survive into an entry, or be recomputed):

- Enqueue merge (sw.js:24349-24460): `coordinatorKey`, `dedupeKey`, `targetProfileHref` (lookup key, sw.js:24351-24353); `actionKind` (sw.js:24387-24390); `executorMaxConcurrent` (swCoordinatorExecutorClassification.js:138-141); `maxRetries` (swQueuedTabRetryStaleReconcile.js:282-290).
- Revival decision (swCoordinatorStatusRules.js:111-124): `status`, `outcome` and `error` text, through `isRetryableJobFailure` (jobState.js:685-694). The error string is part of the decision, so a summary that drops `error` changes behavior.
- Revived row (sw.js:24446-24500): `runId`, `id`, `source`, `sources`, `provenance`, `evidence`, `sourceTabId`, `sourceWindowId`, `sourceSettledAt`, `sourceSettlementKey`.
- Requeue reset (swCoordinatorRetryCandidates.js:155-199): spreads the whole completed row (`...retryBase`, line 199), then reads `attempt`, `attemptNumber`, `maxAttempts`, `requestedUrl`, `actionKind`, `tabAction`, `executorTabAction`, `queueSequence`.
- New, for post work: post identity (`postKey`, `postUrl`, `spaceKey`, `spaceUrl`), the candidate list (section 1), `terminalAt`, `updatedAt`, `attemptId`, `attemptNumber`.

Open choices:

- A3. What an entry carries.
  - a. The full completed row. Requeue and revival need no second read. About 3.1 KB each on the dump.
  - b. A summary with the fields above. Smaller (not measured). Requeue must rebuild the row, and the rebuilt row must match today's spread field for field, or requeue changes behavior.
  - c. Full row for profile entries, summary for post entries.
- A4. The entry key for space work.
  - a. One entry per post, plus a profile index for the dedupe lookup. The instruction's choice. Today the key is the profile (archive keys by row key, sw.js:9299-9330), and a profile in many posts is one row.
  - b. One entry per profile for all work. Post identity and candidates become fields, and a second structure holds the post view.
  - c. Both: profile entries for dedupe and post entries for the nuked view, written together in one append.

## 4. Day shards and pruning

Shard key: the day of the latest update (`terminalAt` for profile rows, `updatedAt` for post entries). A post entry changes after creation: registration adds URLs and bumps `updatedAt` (content.js:9078-9090). A sealed shard therefore cannot hold the newest copy of such an entry.

- A5. Updated entries after seal.
  - a. Newest copy wins on read by (key, `updatedAt`) across all shards in the window. Older copies stay until pruned. Read cost grows with the window.
  - b. A key-to-shard index, kept in the WAL or checkpoint. An update moves the entry to the current shard, and the old copy is removed in the same write. Index writes on every update.
  - c. Seal post entries only at settle (immutable after `terminalAt`). Open posts stay in the current shard. Needs settle detection.
- A6. Prune granularity. The instruction says drop the oldest shards past 30 days or 10,000 entries, with the exact cut on read.
  - a. Whole day shards only. Simple. The count cap then holds only to a day boundary, so the store can exceed 10,000 by up to one day.
  - b. Entry-level cut on read, with physical removal at seal. Exact, but every window read filters by age.
- A7. Window and cap constants.
  - a. Fixed 30 days and 10,000 entries (new constants). The instruction's choice.
  - b. Reuse `nukedPostRetentionDays` (default 30) and `maxRememberedNukedPosts` (default 10,000) (defaults.js:8-9; preferences.js:27-28; nukedPosts.js:4-5, 19-44). Then the store follows user settings, and the nuked view keeps its current behavior. A value of 0 skips the age filter for the nuked map (nukedPosts.js:32), so the store would need its own cap.
  - c. Separate constants for dedupe and for history display.
- A8. The clock for "age".
  - a. `terminalAt` for profile rows; `updatedAt` for post entries (matches the nuked map, nukedPosts.js:19-44).
  - b. Last update for both. A post that keeps receiving candidates stays in the window.
  - c. The later of `terminalAt` and `updatedAt`.

Note: the dedupe window and the nuked-record window (both 30 days today) must use the same clock, or a post is queued again on a different day than its nuked record disappears.

## 5. Compression

- Codec: the existing gzip codec `COORDINATOR_QUEUE_WAL_SNAPSHOT_CODEC` (sw.js:450-453, fflate `gzipSync`/`gunzipSync`, synchronous). Sealed shards only. WAL appends stay raw.
- Metadata: `encodeCheckpointSnapshot` already returns `codec`, `encoding`, `uncompressedBytes`, `compressedBytes`, `base64Bytes` and `payload` (walSnapshotStore.js:800-822). The decoder falls back to plain state (walSnapshotStore.js:839-870). A shard adds: entry count, key range, day, and the hash.
- A9. The hash.
  - a. FNV-1a 32-bit (`hashString`, walSnapshotStore.js:41-47, already used as `stateHash`). Cheap; detects accidental damage only.
  - b. SHA-256 through `crypto.subtle.digest`. Async, so it sits at the seal and read boundaries, not in a sw.js promise hop.
  - c. No separate hash. Rely on the gzip trailer (CRC-32 and length), which fflate's gunzip checks. Confirm against the installed fflate (package.json pins `^0.8.3`) before relying on it.
- A10. Verification and failure.
  - Verify on seal: decode the payload and compare the raw hash before the shard is named in the index or manifest. Choice of switch point: after the write (read back), or in memory before it.
  - Verify on read, when a shard fails to decode or hash-check: (a) ignore the shard and count it (dedupe treats its window as unknown, so the profile may be queued again); (b) fail the read, and the dashboard shows an error; (c) rebuild from the WAL, which only works while the WAL still covers the shard (not after a checkpoint switch).
- A11. Seal trigger.
  - a. At day roll: one shard write per day, plus the prune.
  - b. At a row-count threshold: more, smaller shards.
  - c. At the first checkpoint switch after day roll: ties shard writes to the count-based cadence (decision 6: switch at 128 appends, force at 256).

## 6. Counters

Required: lifetime totals and per-run counts, updated at every terminal write, never summed from entries.

- Conflict. `architecture.md` "Derived Stats Must Not Be A Mutated Running Total" (architecture.md:392-438) bars fields that are read, adjusted and written back, unless every writer is serialized. Per-run counts in `mbCoordinatorRuns` are already such fields, and the dump shows the risk: 21 run IDs referenced by 70 live rows and 2,482 completed rows have no run record on disk. The cause is not established here. A lost update of the runs map is one candidate; a stale disk copy of a derived key is another. The resident state was not read.
- Lifetime totals cannot come from entries once entries are pruned, so they must be stored.
- A12. Where lifetime counters are written.
  - a. Inside the WAL append that carries the terminal row. Serialized by the door, replayed on recovery, no extra write. Needs a counter record type in the reducer.
  - b. A separate counters key at each settlement. One extra disk write per settlement.
  - c. A counters key at checkpoint switch only, with the WAL tail replayed over it. Fewer writes; counts lag until the switch.
- A13. Where per-run counts live.
  - a. Keep them in `mbCoordinatorRuns` (today's running total, with the race the architecture doc describes).
  - b. Count from entries at read time, keyed by `runId`. A run older than the window loses its count.
  - c. A run summary entry, rewritten with each terminal entry of that run.
- Check either way: a recount from entries and WAL, compared with the counters at each checkpoint switch (test, section 13).

## 7. Dedupe (window-bound)

Instruction decision 2: the window governs dedupe; a profile past the window may be queued again.

- Enqueue lookup. sw.js:24349-24354 builds `completedByKey` from the whole log on every enqueue call. sw.js:24385-24386 and 24436-24460 then merge (skip) or revive (remove the completed copy, sw.js:24454).
- Requeue lookup. sw.js:23882-23891. Window-bound means failed rows older than the window are no longer requeueable from the dashboard.
- A14. How the window applies.
  - a. Filter by age at lookup; entries stay in the store until pruned.
  - b. Store only: the window is what the store holds after prune. No per-lookup check, so the clock and prune must agree exactly.
  - c. Both, with one clock (A8).
- A15. Requeue from history: keep it unbounded (only what survives the store is requeueable, which is still the window in practice), or bound it explicitly as well. Owner call, because it is a user-visible change.
- Re-archive. A profile past the window is queued and archived again under the same key, so today's row keys overwrite the old entry. With per-post entries (A4a), the profile's older post entries survive until pruned, and the lookup must ignore them by age.

Tests that assume lookups find archived rows (their fake clocks sit well inside 30 days, so they should pass unchanged; the harness fakes `Date.now` as `timers.now`, test/lib/swHarness.js:834):

- swSynthetic.test.js:42450 "re-enqueuing an already-archived profile is recognized as already-done" (now 900000, terminalAt 900100).
- :42507 "re-enqueuing an archived failed row for retry correctly revives it" (now 900000).
- :4762 "manual requeue finds archived canceled and failed rows" (now 508100).
- :43040 and :43078 requeue of archived soft errors (now 1000000; terminalAt 900000 and 899000).
- :41841 and :41904 archive writes; :154, :195, :226, :456, :518 resident completed-map and snapshot tests. :226 removes a completed row through a door write, which is no longer a user path after section 8.

Add window-edge tests: a row at 29 days is merged; at 31 days it is queued again. Advance the fake clock to do this, not wall time.

## 8. Clear (dashboard only)

Current deletions and reads:

- Clear current work: the dashboard button (coordinator.js:1660-1690) sends `clear-coordinator-current-work`. `buildStoredWorkClearPlan` (sw.js:26109-26134) plans live rows only. The completed removal (sw.js:26172-26182) deletes every completed row. The door write is at sw.js:26191.
- Clear All Stats: `clearCoordinatorTerminalStats` stamps `mbCoordinatorStatsClearedAt` and deletes nothing (sw.js:6497-6512). `clearAllStats` (coordinator.js:750) also calls `clearEvents` (coordinator.js:1259), which deletes `mbCoordinatorEvents` (5B).
- Clear Recent History: `clearHistory` (coordinator.js:179-183) sends `set-space-nuked-posts` with `{}`, which empties the remembered nuked map (sw.js:21683-21690). Clear History deletes the history (decision 19).

Options for the Clear marker (instruction: "a marker stored on disk, so it survives restart"):

- A16. Marker form.
  - a. A persisted cutoff, like `mbCoordinatorStatsClearedAt`. The view builder already takes `statsClearedAt` (sw.js:8080, 8325), and the outlier path reads the same cutoff (sw.js:6653-6660). One key write per clear. Survives restart.
  - b. A `clearedAt` field written to each visible entry. Rewrites every entry (cost grows with the store). Not workable at the current size.
  - c. A session-only cutoff. Cheapest, but entries reappear after a browser restart.

Other consequences of hide-not-delete:

- The Clear enable rule and tooltip count finished rows (coordinator.js:1550-1560; test swSynthetic.test.js:44333-44340 expects "Cancel and remove all 3 Current Work rows"). They must count visible rows only.

Tests that assume Clear deletes history (old assertion, then new):

- swSynthetic.test.js:3510-3608, "bulk current work clear removes every row from the live queue and the completed-work log". Old: completed row not found after clear (line 3590); two `stored-work-clear` records (3603-3604); recovered `completed[hrefDone]` undefined. New: completed row still found; no completed removal record; the marker is the only new write.
- swSynthetic.test.js:44333-44340, "the Clear button is enabled when only finished rows exist". Old: enabled, tooltip counts 3. New: rule and tooltip use visible rows.
- p1-contract.test.js:1549-1565. Old: the clear body must contain `removedCompletedRows` (line 1565). New: it must not, and must write the marker.
- swSynthetic.test.js:226, "a door write that removes or adds a completed row updates the resident map". Old: user-path removal. New: removal only through pruning.
- Unchanged: acceptedReviewChanges.test.js:243-267 (plan removes the live rows it is given). Reuse as the pattern test: swSynthetic.test.js:4325-4380 "clear-coordinator-terminal-stats hides terminal rows ... without touching queued work".

## 9. Progress-only nuke paths

- Sites: sw.js:15078-15080 (successful-progress branch in `shouldOpenQueuedTabAction`) and sw.js:31033-31035 (terminal progress drop in `pruneQueuedTabActions`). Both call `syncSuccessfulCoordinatorProgress` (sw.js:25343-25357), which sends `SPACE_FEED_PROFILES_CONFIRM`.
- That event runs `confirmSpaceFeedProfilesBlocked` (sw.js:25305-25345) and then `settleConfirmedSpaceFeedProfiles` (swCoordinatorTerminalSettlement.js:139-182). The latter walks `currentPending` only. So a profile whose progress succeeded with no pending record writes nothing to the nuked map today.
- A17. What these paths write.
  - a. Create the post entry from the progress success plus the candidate list (needs the candidate list in rows, decision 12).
  - b. Create only the profile entry (dedupe), and leave the post unrecorded as today.
  - c. Derive the post entry from completed-row evidence. Partial by construction.

## 10. Messages

- Paged history list. Today `loadHistoryEntries` reads `mbSpaceNukedPosts` from storage.local and prunes it in the page (coordinator.js:137-147), and `renderHistoryList` draws every row (coordinator.js:149-177). New: a worker message `get-history-page` (name open).
  - A18. Paging key. (a) Keyset cursor on (`updatedAt`, key): stable while writes arrive. (b) Offset: simple, but pages shift under writes. The sort field must match A8.
  - The history page reads storage.local directly now. Nuked posts are a named exemption (docs/queue-storage-layering.md, status of section 6), so this read is allowed today. Moving completed rows into the store removes the exemption for this list.
- Dashboard aggregates. Today `refresh-coordinator-dashboard-views` builds the queue view from resident state, and recent completed rows come from `getRecentCompletedWorkRows(50)` (sw.js:10708). New: aggregates for the dashboard counts.
  - A19. Aggregate source. (a) Counters from A12 and A13: fast, depends on counter correctness. (b) Scan the window's shards per request: no counter risk, cost grows with the window. (c) Cache aggregates in memory, rebuilt at hydrate.
- Batched "already nuked" query for content. Today content loads the nuked map into memory at init and on `storage.onChanged` (content.js:427-432, 644-645, 883, 1494), and checks it synchronously in render and click paths (content.js:7520, 8032, 10232).
  - A20. (a) A session-stored nuked mirror that content reads synchronously, refreshed on `storage.onChanged`. Keeps the sync checks. (b) An async batch message per scan. Needs the sync callers (content.js:7520, 8032) made async, plus a timeout path (SAFE_SEND defaults, timeouts.js:51). (c) Mirror for render, message for decisions.
  - Latency measurement, before any choice: count nuked checks per scan and time one batch of N posts (Date.now around the await; no promise-hop helpers in sw.js). Baseline: the current nuked map is 1.5 MB of JSON in storage.local.

## 11. Migration

Run once, behind a marker, with a rollback path.

- Inputs: the completed map (3,607 rows) and the nuked map (3,071 records). Pending records are 5C. The live queue is not touched.
- Steps, in order: (1) read both maps inside the door's serialized step; (2) convert completed rows to profile entries (keys unchanged) and nuked records to post entries, with `urls` as the candidate list (partial unless the backfill of decision 20 is used); (3) write sealed day shards with metadata (section 5); (4) write the marker last; (5) switch readers.
- Marker: name open. Contents: schema version, row and record counts, a hash of the input maps, a timestamp. A matching marker makes a re-run a no-op. A mismatch fails closed.
- A21. Outcome of converted nuked records. A nuked record has no per-URL outcome. (a) Assume succeeded and blocked, since the record is written only when every candidate is confirmed (sw.js:25305-25345). (b) Mark it as "confirmed, outcome unknown". (c) Keep nuked records in their old map and convert only completed rows.
- A22. Rows older than 30 days at migration. The dump has none (oldest 20.7 days; all nuked records inside 30 days). (a) Drop them at migration, so the window applies at once. (b) Keep them in shards until the first seal and prune.
- A23. Rollback. (a) Keep the legacy keys (completed area and `mbSpaceNukedPosts`) for one release; rollback means the old read path. Costs double storage for the window. (b) A reverse converter from entries to the legacy maps, run before old code reads, with a round-trip test. (c) Forward only, with a backup taken before migration.
- Data safety: the marker write and the deletion of legacy keys are separate writes. Deleting legacy keys needs David's approval as its own step.

## 12. Disk writes per settlement

Today (read from code; not counted live):

- A terminal archive (sw.js:9299-9330) is one door write: queue removal plus completed set, two WAL records.
- `mbCoordinatorOutliers` is written for each finished row with a positive duration (sw.js:6601-6622, 6649-6670).
- Runs and events keys are written when a terminal writer also updates runs (`applyCoordinatorRunsUpdate`, sw.js:10936-10990). Most settlements do.
- Progress keys (5D) and the checkpoint switch (decision 6) add more.
- The 18:00 run wrote 284 MB in six minutes, 210 MB of it index families (coder instructions, section 3). That is from earlier code, not this design.

Proposed, with the choices above:

- Per settlement: the WAL append carries the entry. No extra key, unless A12b is chosen.
- Per day: one shard seal and one prune (A11, A6).
- Per Clear: one marker write (A16).
- Guard test: archive, blocked-tab, checkpoint and full-queue saves produce no disk write with a shard, index or projection key. WAL and checkpoint keys and the session summary are out of scope. Present in the test suite as the guard named for archive, blocked-tab, checkpoint and full-queue writes.

## 13. Test plan

A new test file, wired into `npm test` and `tools/run-tests-parallel.js` (repo rule):

- Entry round trip: archive, WAL append, recovery gives the same entry, including candidate list and `error`.
- Seal: gzip plus metadata; decode and hash check; one flipped byte makes the shard ignored and counted (A10).
- Prune: 30-day and 10,000-entry cut on read; shard boundary; a day with more than 10,000 entries (A6).
- Window dedupe: 29-day merge, 31-day requeue, requeue window (A14, A15).
- Clear marker: dashboard list empties; entries still found by dedupe and history; marker survives hydrate.
- Progress-only path writes a post entry (only if A17a).
- Migration: idempotent; marker mismatch fails closed; rollback round trip (A23).
- Messages: keyset paging returns every entry once across page edges with equal `updatedAt`; aggregates equal a recount; the batch query gives the same answer as the sync check for each post (A20).
- Counters equal a recount at each checkpoint switch (A12, A13).
- Guard test (section 12).

Lints: `lint:queue-storage-layering` (new readers go through the facade; the allowlist only shrinks), `lint:no-outside-writes` (content must not write), `lint:duplicates` (the shard code must reuse `walSnapshotStore.js`, not copy it).

Measure: history page, aggregate and batch latencies; disk bytes per settlement before and after, using the `swStorageMetrics.js` families.

## 14. Choice index

A3 entry content; A4 entry key; A5 updated entries after seal; A6 prune granularity; A7 window and cap constants; A8 age clock; A9 hash; A10 verification and failure; A11 seal trigger; A12 lifetime counter placement; A13 per-run count placement; A14 window applied at lookup; A15 requeue window; A16 Clear marker form; A17 progress-only entries; A18 history paging key; A19 aggregate source; A20 nuked query for content; A21 outcome of converted nuked records; A22 rows older than 30 days at migration; A23 rollback.

Total: 21 open choices, each with two or three options. Owner calls named in the text: A15 (requeue from history), A7 (whether the window follows user settings).
