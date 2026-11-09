# Pending staging design (section 5C)

> **Status: ROADMAP** (24 Oct 2026). Design only. Pending records are still on disk (3,368 on the dev profile, 18 Oct). Open choices C2 to C15; C10 (the 18 empty records) is an owner question. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: design only, not approved. Open choices C2 to C15 are not decided. The candidate-list choice (C1) is decided (decision 12 of the coder instructions, option b).

Source: coder instructions, section 5 (note C). The code was checked on 18 Oct 2026 (branch `review/shared-wip`, with uncommitted edits). Line numbers will move; search by the function name if they do not match. Audit counts are quoted from the coder instructions, section 3. They were not re-run here, because the audit needs a live browser read and this pass made no browser calls.

## 0. The candidate list

New queue rows carry the post's full candidate list in their evidence, written at enqueue (decision 12; coded, with its unit test passing). Pending records, and nuked-post records from before the change, hold the list in the old places. Rows enqueued before the change do not carry it, so the migration must backfill them (decision 20).

Where the list is held, for the migration:

- **Pending record.** `content.js:9080-9096` writes `allUrls` (the post's candidates, line 9086) and `remainingUrls` (candidates not yet settled, line 9087), with `postKey`, `postUrl`, `spaceKey`, `spaceUrl`, `resolverPending`, `jobKeys`, `jobKeysByProfileHref` and `updatedAt`.
- **Nuked post.** `settleConfirmedSpaceFeedProfiles` (`swCoordinatorTerminalSettlement.js:139-182`) moves a post whose `remainingUrls` reach zero into `mbSpaceNukedPosts`, with `urls` set from `allUrls` (line 175). This is partial: it is the list at settlement, after clears.

Why rows cannot rebuild the pending list. The two lists differ in both directions, so rows enqueued before the change cannot be assumed to reproduce the pending list:

- Pending registration drops a candidate that is already succeeded or remembered (`content.js:9061`, `isProfileNukeSucceeded` and `isRememberedSpaceFeedPostProfile`).
- The enqueue path builds its associations from the queueable list (`content.js:9848`, filtered by `getQueueableSpaceFeedEntryUrls` at `content.js:7946-7955`, which drops URLs already pending, already in the queue, retry-blocked or remembered).

So for the 1,232 in-progress records and the 1,394 stuck records, the list must be written to a surviving place before the pending record is removed. Section 4 gives the order.

## 1. The pending key today

Key: `mbSpacePendingNukedPosts`, constant `SPACE_PENDING_NUKED_POSTS_KEY` (`shared/js/storageKeys.js:15`). The value is one map from post key to record. Each setter rewrites the whole map.

### 1a. Writers

Search (18 Oct): `SPACE_PENDING_NUKED_POSTS_KEY` and `mbSpacePendingNukedPosts` across `shared/js`. Every writer of the key is listed below. `tools/` and `test/` only read or seed the key (for example `tools/cdp/inspect-space-state.js:44` and `tools/cdp/space-summary.js:52` are `storage.local.get` defaults). The generated copies (`chrome/`, `firefox/`, `chrome-dev/`) and the agent worktrees under `.claude/` were not searched. Reads are in 1b.

| Where | Function | What it writes |
|---|---|---|
| `sw.js:21693-21697` | `setSpacePendingNukedPostsRequested` | Persists the whole map through `coordinatorAuthority.persistCoordinator` (line 21694). Route: `swBootstrap.js:713-714`. |
| `sw.js:25215-25258` | `removePendingSpaceFeedUrls` (worker) | Deletes a record when `remainingUrls` is empty (lines 25238-25239). Persists at 25254. Route: `swBootstrap.js:1105`. |
| `sw.js:25263-25302` | `removePendingSpaceFeedEntries` (worker) | Same test (lines 25282-25283). Persists at 25297. Route: `swBootstrap.js:1114`. |
| `sw.js:25306-25341` | `confirmSpaceFeedProfilesBlocked` | Settles blocked hrefs through `settleConfirmedSpaceFeedProfiles`. Payload at 25330, persisted at 25337. Route: `swBootstrap.js:1123-1125`; queue machine: `swQueueMachineHandlers.js:146-147`. |
| `sw.js:25344-25357` | `syncSuccessfulCoordinatorProgress` | Sends `SPACE_FEED_PROFILES_CONFIRM`, which reaches the function above. Callers: `sw.js:15080` and `sw.js:31035`. |
| `sw.js:24964-25047` | `clearProfileNukeState` | Removes one href (`removeProfileHrefFromPendingSpaceRecords`, line 25036). Payload at 25047, persisted at 25153. The local flag `preserveCoordinatorState` (line 25013) gates only the runs part (line 25038). It is a flag, not a writer. |
| `sw.js:10853-10880` | `saveCoordinatorState` | Payload at 10874 when `changes.pendingPosts` is set. The reconcile-phase and resolver writers below save through it. The removal, confirm and settlement writers persist their payloads directly with `persistCoordinator`. |
| `sw.js:11578-11676` | `persistCoordinatorReconcileAuthorityTransitionPhase` | Storage patch at 11669 when `ctx.pendingPostsChanged`; saves through `saveCoordinatorState` (line 11673). Called at `sw.js:11748`. |
| `swCoordinatorReconcileLockedMaterialization.js:164-225` | `applyInvalidProfileResolutionReconcileActionLocked` | Clears a resolver record (line 211). Called at `sw.js:11348-11363`. The result reaches the save at 11669 through `ctx.pendingPosts`. |
| `swCoordinatorReconcileLockedMaterialization.js:410-428` | `settleTerminalResolverPendingSourceRecordsLocked` | Clears resolver records (line 416). Called at `sw.js:11276` and `sw.js:11532`. Same route to 11669. |
| `swCoordinatorReconcileLockedMaterialization.js:431-466` | `settleResolvedResolverPendingSourceRecordsLocked` | Adds the resolved href (line 457). Called at `sw.js:11283` and `sw.js:11539`. Same route to 11669. |
| `swCoordinatorSourceProvenance.js:267-346` | `materializeRemovedProfileDerivedStateFromAuthority` | Removes the href (line 315) and returns `pendingPosts` (line 344). Called at `swCoordinatorReconcileLockedMaterialization.js:598`; `sw.js:11094` only wires it in as a dependency. Same route to 11669. |
| `sw.js:32556-32800` | `mutateCoordinatorQueuedProfileTargetResolve` | Adds the resolved href (`addResolvedProfileToPendingSpaceRecords`, line 32783). Saves through `saveCoordinatorState` at 32791-32793. |
| `sw.js:32880-33063` | `markQueuedProfileResolutionUnresolved` | Clears resolver records (`clearResolverPendingSpaceRecords`, line 33009). Saves through `saveCoordinatorState` at 33031-33034. |
| `swCoordinatorTerminalSettlement.js:196-226` | `buildTerminalCoordinatorSettlementDerivedPayload` | Payload at line 216. Called at `sw.js:12015`; the payload is persisted at `sw.js:12047`. |
| `content.js:9048-9104` | `registerPendingSpaceFeedEntries` (tab) | Builds the record (lines 9080-9096) and sends `set-space-pending-nuked-posts` (line 9104). The tab does not write the key. |
| `content.js:9107` | `removePendingSpaceFeedUrls` (tab) | Sends `remove-pending-space-feed-urls` (line 9112). Callers: lines 801, 9127, 9984. |
| `content.js:9123` | `removePendingSpaceFeedEntries` (tab) | Sends `remove-pending-space-feed-entries` (line 9137). Caller: line 9952. |
| `swBootstrap.js:65, 101-103` | action gate | Lists the pending actions in `RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY`. |
| `swQueueMachineHandlers.js:141, 144, 147` | queue machine events | Route to the URL removal, the entry removal and the confirm. |

Pure helpers that return a new map and are persisted by their caller are not writers, so they are not in the table: `addResolvedProfileToPendingSpaceRecords` (`swResolvedProfilePendingSpaceRecords.js:48`), `clearResolverPendingSpaceRecords` (`swResolvedProfilePendingSpaceRecords.js:91`), `removeProfileHrefFromPendingSpaceRecords` (`swProfileProgressMerge.js:473`) and `settleConfirmedSpaceFeedProfiles` (`swCoordinatorTerminalSettlement.js:139`).

### 1b. Readers

- Worker: `sw.js:10583` (hydrate, read with default), `sw.js:10801-10826` (projection loads), `sw.js:24979-24983` (clear reads), `sw.js:25219-25270` and `sw.js:25311-25314` (removal and confirm reads), `sw.js:32576` and `sw.js:32895-32901` (resolver reads).
- Content: `content.js:428` (startup read in `init`, the only direct storage read of this key in content), `content.js:510-511` (`getCurrentPageStateProfileHrefs`), `content.js:649-650` (`onStorageChanged` arm, then refresh), `content.js:808` (`getPendingSpaceFeedRecord`), `content.js:871-901` (`reconcileStaleSpaceFeedProgress`), `content.js:1490-1491` (`clearProfileNukeState` response), `content.js:7546, 7558, 7845, 7857, 7932, 7973, 8047, 8058, 8097` (UI state for "in progress"), `content.js:9312-9313` (response).
- Test helper: `test/lib/storageInvariants.js:8`.

### 1c. Action gate

Every pending action must be listed in `RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY` (`swBootstrap.js:52-107`; the pending actions are at lines 63 and 99-101). The gate is checked at `swBootstrap.js:643`. A new staging action has to join this set (C14).

### 1d. Findings from reading the code

These are observations. Each is reasoned from the code and was not reproduced in a test.

- **F1. Two removal rules.** `swProfileProgressMerge.js:493-494` deletes a record only when both `allUrls` and `remainingUrls` are empty. `sw.js:25238-25239` and `sw.js:25282-25283` delete when `remainingUrls` is empty alone. The terminal path uses the first rule (`swCoordinatorTerminalSettlement.js:206`). The removals the tab triggers (`remove-pending-space-feed-urls` and `remove-pending-space-feed-entries`, routed to `sw.js:25214` and `sw.js:25262`) use the second.
- **F2. A possible stuck record.** Take a record with `allUrls` = [A, B] and `remainingUrls` = [A, B]. If A is confirmed and B is cleared in the same settlement, the confirm step leaves `remainingUrls` = [B] (`swCoordinatorTerminalSettlement.js:152-158`). The clear step then leaves `allUrls` = [A] and `remainingUrls` = []. Because `allUrls` is not empty, the first rule keeps the record (`swProfileProgressMerge.js:493`). The record is not nuked, because no later confirm can match an empty `remainingUrls`. It is cleared only by a later removal that names A. Check this with a synthetic test before relying on it. The audit's definition of "empty" may or may not cover it.
- **F3. All-cleared posts.** When every candidate ends cleared (none confirmed), the record is deleted and no nuked entry is written (`swProfileProgressMerge.js:493-494`). The post is not marked nuked, so it can be queued again. This is the current behaviour, and C9 uses it as the baseline.
- **F4. The tab ignores the save result.** `content.js:9104` awaits the message and does not read `saved` (`sw.js:21697`). The enqueue starts regardless (`content.js:9901`, `9909`).
- **F5. Pending is written before rows.** Registration (`content.js:9901`) runs before the enqueue (`content.js:9909`). A tab that dies after registration, or a chunk that fails, leaves candidates with a pending record and no rows. This is a likely cause of the orphaned bucket, along with Clear (coder instructions, section 3). Not measured here.
- **F6. No age window on completed rows.** The completed-work log is read whole (`sw.js:24349`, `sw.js:26172`, `completedRecent(Number.MAX_SAFE_INTEGER)`). No age prune was found in `shared/js`. The 30-day retention exists only on `mbSpaceNukedPosts` (`defaults.js:8`, `nukedPosts.js`, `getPrunedNukedPosts`). So the "succeeded entry inside the window" rule has no existing store (C7).
- **F7. Current confirmation is event-driven.** A terminal item with status `succeeded` (and not unblock-unmute) is confirmed; any other terminal status is cleared (`sw.js:11913-11933`). There is no window lookup. The reconcile reads only the 50 most recent completed rows, to settle resolver-pending records (`sw.js:11509-11538`; `swCoordinatorReconcileLockedMaterialization.js:410-460`).
- **F8. Content's "succeeded" check uses the progress view in memory.** `isProfileNukeSucceeded` (`content.js:7889`) reads `getProfileNukeProgressRecord` (`content.js:1349`), not rows. Content decides a candidate is done from the progress view, not from rows or entries.

## 2. The lost-click case

A tab that dies before its request reaches the worker loses that click. In the current code there are three timing windows:

1. **Before the pending message is handled** (`content.js:9104` not yet processed). No pending record and no rows. The click is lost and nothing is recorded. The post stays un-nuked and the user has to click again. The worker never learns the click happened.
2. **After the pending message, before the first enqueue message** (`content.js:9901` then `9909`). A pending record exists with no rows. Every candidate is an orphan. The click is half-recorded, not lost.
3. **Between enqueue chunks** (`sendCoordinatorEnqueueChunked`, `content.js:9624`). Rows exist for the chunks that arrived. The candidates of the unsent chunks are orphans.

With the staging design, window 1 is unchanged: a request that never reaches the worker is still lost. Windows 2 and 3 go away only if the worker takes the whole run once it has the request, because the worker does not depend on the tab after that point. C2 decides the shape of the request.

Staging in session storage does not survive a browser restart. A click that is staged but not yet on the WAL is lost at browser restart. Disk staging is not allowed (coder instructions, section 1: no new disk writes).

## 3. Staging design (proposal, options open)

Shape, as proposed:

1. The tab sends the click intent: post keys, each post's candidate hrefs, and the items the enqueue carries today. How it is sent is C2.
2. The worker writes the staging to `chrome.storage.session`, keyed by run id. The tab does not write it.
3. The worker enqueues (WAL append). The enqueue result is returned at `sw.js:24126`, after the storage call completes.
4. When the enqueue is durable, the worker removes that run's staging. Both the write and the removal are worker-side. The confirmation signal is C3.
5. Cancel and pause (`content.js:800`, `content.js:9982`) become worker-side removals of staged hrefs. Today they send `removePendingSpaceFeedUrls`.

Rules carried from the coder instructions:

- Staging is session only (no new disk writes).
- Staging is removed only after the enqueue is confirmed on disk.
- Settlement reads rows and completed entries, not staging. Staging is for in-flight work. Once a run is durable, its state is the rows (and entries).
- Content's read of staging is not settled. The session options are C12 (c) and C13 (a) and (b). See section 7.
- Access level: `chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'})` once at worker start. The default access level was not re-checked here. Firefox access from content scripts is unverified (coder instructions, section 3).

Crash and retry cases:

- **Worker evicted after staging, before the enqueue is durable.** Session storage survives worker restarts (`swSessionMemory.js` header). On restart the worker must either replay the enqueue from staging or drop it (C4).
- **Enqueue not durable.** The chunk sender retries the same chunk in place (`content.js:9668-9669`, `chunkFailed` when `durable === false` or `storageTimedOut`). The retry is safe because the enqueue merges duplicates. Whether the worker keeps staging across a failed attempt is C5.
- **Browser restart or extension reload.** Session storage is cleared. A run staged but never appended to the WAL is lost. Not verified for reload.
- **Chunking.** `enqueueCoordinatorItemsStorage` switches to the chunked path above a threshold (`sw.js:24203-24206`). A run that is only partly durable leaves orphans. C6 decides the unit.

Settlement under the window rule: a candidate counts as confirmed when a succeeded entry, with terminal time inside 30 days, exists in rows or entries. Today confirmation comes from terminal events (F7). The store that holds the 30-day entries is C7.

## 4. The one-time migration

Preconditions (proposed): a marker key, written once; the migration is idempotent; it writes only through the WAL and checkpoints; it runs before the first settlement under the new rule.

Buckets, as the coder instructions gives them (section 3, 18 Oct; not re-audited here):

| Bucket | Records | Profile links | Decision in coder instructions | What the migration does |
|---|---|---|---|---|
| In progress: every remaining profile has a live row | 1,232 | not given | stay as rows | Write the candidate list into the live rows' evidence (decision 12, option b), then remove the pending record. Rows stay. |
| Stuck: a remaining profile finished, no live row | 1,394 | not given | recompute | Every candidate confirmed: history entry (with the list). Any live candidate left: in progress, with the list. Needs C8 and C9. |
| Orphaned: a remaining profile has no live and no completed row | 724 | 799 (all orphan links) | dropped (David) | Drop. The post has no nuked entry, so it becomes eligible again. |
| Empty | 18 | not given | dropped (David) | Outcome below. |

Totals: 1,232 + 1,394 + 724 + 18 = 3,368, which matches the coder instructions. The coder instructions's section 2, item 7 said "742 unmatched records". That equals 724 + 18, so it agrees.

Outcome for the 18 empty records (decision 25): 2 keep (a candidate has a live row), 8 keep (candidates have completed rows only), and 8 drop with the migration (no row for any candidate). Nothing is dropped before the migration runs.

What the dropped set loses. The 724 orphaned records (799 profile links) and the 8 dropped empty records lose their candidate lists. Their posts have no nuked entry, so they show as un-nuked and can be queued again. This is David's decision (decision 25 and the orphan decision).

Finished but not succeeded. The coder instructions reports 95 remaining profile links that finished without success (section 3). Under "all candidates confirmed", those candidates are neither confirmed nor live. C9 covers them.

Order for the records that keep a list (in progress and stuck), so the list is never lost:

1. Read the pending map in one serialized step.
2. For each in-progress record, write its candidate list into the live rows' evidence (decision 12, option b). For each stuck record, write its list into a history entry (section 5A, with the choice C8 for which list), keyed by `postKey`.
3. Wait until each write is acknowledged as durable.
4. Remove that pending record only after its write is acknowledged. A crash between steps 3 and 4 leaves both copies. A re-run writes the same values, so it does no harm.
5. Write the migration marker last. The orphaned and dropped empty records get no write; they are dropped, as David decided.

Content after the migration. Pending records stop existing, so the content helpers that read the map for "in progress" (`content.js:7546-8097`) need another source. The route for that read is open (section 7; C12 and C13). Content then needs a per-post in-progress answer for posts that have live rows (C12).

Rollback: C11.

## 5. Tests that assume pending records

If the design is built, these change. The list is what the current tree contains.

- `test/swSynthetic.test.js`: 47 lines reference the pending key or `SPACE_PENDING` (lines 1524, 9964-10351, 11788-12263, 14886-15715, 16694, 22827, 41664). Fixtures seed the map as object literals (for example 9964, 10034, 10086, 10179, 10232, 10294, 10351). Assertions that a record is removed after terminal settlement include 9988, 10053, 10204, 10264 and 10321.
- `test/p1-contract.test.js`: 10 lines (2936-2937, 2958, 2967, 2974, 3076-3077, 5653, 6121, 6170). These are source-text assertions. Content's removal bodies must not write the key with `safeStorageSet` (2936-2937). The unresolved path must not write it with `browser.storage.local.set` (2974). Lines 3076-3077 assert the persist patch. They must keep holding: content must still not write the key, and staging must keep the same rule.
- `test/swStorageMetrics.test.js:33` and `test/lib/storageInvariants.js:8`, plus `test/storageInvariants.test.js`.

## 6. Open choices

Each is a set of options with trade-offs. None of the open choices below is decided.

- **C2. Request shape.** (a) One message carrying candidates and items, so the worker takes the whole run at once. Removes window 2 and 3 for the run. (b) Two messages as today: stage, then enqueue. Keeps the current protocol but leaves a stage with no enqueue if the second message is lost. (c) The tab retries the request until it is acknowledged. Helps when a message is lost in transit. Does nothing if the tab dies first (window 1).
- **C3. Removal signal.** (a) The enqueue result returned at `sw.js:24126`, with its durable flag, checked in the worker. Earliest and worker-only. (b) The enqueue summary key, written fire-and-forget at `sw.js:24129`. Simple but trails the result, and it is what the tab polls today (`content.js:9581-9600`). (c) The authority's WAL append acknowledgement. Strongest, but the lowest-level signal to thread through.
- **C4. Worker eviction after staging.** (a) Replay the enqueue from staging at startup. Keeps the click, but the enqueue must be idempotent. (b) Drop the staging and let the user click again. Simple, loses the click. (c) Keep the run marked and show it on the dashboard. Visible, adds a state.
- **C5. Enqueue not durable.** (a) Keep staging and retry with backoff. Staging lives longer. (b) Drop staging at once and report to the tab. (c) Leave to the tab's chunk retry, as today (`content.js:9668-9669`). Keeps current behaviour.
- **C6. Stage unit.** (a) Whole run, all or nothing. No partial orphans, but a large message and a large staging value. (b) Per chunk (`COORDINATOR_ENQUEUE_CHUNK_SIZE`). Smaller staging, but a run can be partly durable and leave orphans. (c) Per item. Finest, most keys.
- **C7. Store for the 30-day "succeeded" rule.** (a) An age prune added to the completed-work log, so succeeded rows stay 30 days. Changes a store that is currently unbounded. (b) The unified store's entries (section 5A) with a 30-day shard prune. (c) Reuse `mbSpaceNukedPosts` retention (30 days, 10,000 entries). That store is keyed by post and keeps `urls` (candidates), but no per-candidate outcome, so it would need one added.
- **C8. Which list is "the candidates".** (a) `allUrls` as stored, so cleared candidates are already gone (F3). (b) The original queueable list before any clears. Needs the list kept (decision 12 keeps it in rows for new work). (c) `remainingUrls` only. Smallest, but loses confirmed candidates from the total.
- **C9. Finished-but-not-succeeded candidates (95 links).** (a) Count them as cleared, so the post is deleted with no history, as all-cleared posts are today (F3). Matches current behaviour. (b) A history entry with a partial outcome. Shows what happened, adds an outcome state. (c) Keep the post in progress until resolved. Never settles unless something retries it.
- **C10. Empty records (18).** David's question. Resolver-pending records have no URLs by design (`content.js:9060`, `content.js:9086`). The check in section 4 found no resolver-pending records among the 18. Options: (a) drop all 18, as decided; (b) drop only those with `resolverPending` false; (c) keep the resolver-pending ones as work.
- **C11. Rollback.** (a) None. (b) Keep the old key untouched and unread for one release. No write, but the space stays used. (c) Copy the old map to a legacy key. A new disk write, which conflicts with the no-new-disk-writes rule unless David waives it.
- **C12. In-progress post state for content.** (a) A per-post answer in the existing state message (`getContentPageCoordinatorState`, `sw.js:35699`). Authoritative, one round trip. (b) Derive per-post state in content from the scoped rows the state message already returns (`content.js:608-609`), using each row's `evidence.postKey`. No new message; content cannot see the other candidates. (c) A session summary keyed by post, refreshed on change. Matches the queue-bar pattern; adds a key and a write.
- **C13. Staging key name and session access.** The name goes in `shared/js/storageKeys.js`. The access level is set once at startup. Firefox content access is unverified. Options: (a) ship for Chrome first and hold Firefox. (b) Ship both after the Firefox check. (c) Keep content on the state message and skip the session read.
- **C14. Action gate.** (a) Add the new action to `RUNTIME_MESSAGE_ACTIONS_WITH_AUTHORITY` (`swBootstrap.js:52-107`). Explicit, one more entry. (b) Reuse the existing action names with a new payload. No gate change, but a changed meaning for an old action.
- **C15. Staging size.** The session quota was not checked here. (a) No limit. (b) Cap by staged run count. (c) Cap by bytes, checked on write. Check the quota before choosing.

## 7. David's content-access decision

The planned rule is that content reads pending records through the worker by message, not from session storage, because Firefox content cannot read session storage (decision 9 covers the queue bar). David should confirm this route before C13 is built. The session options stay open as C12 (c) and C13 (a) and (b).
