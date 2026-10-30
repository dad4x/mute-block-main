# De novo review 3: `shared/` — 14 Oct 2026

> **Status: HISTORICAL** (24 Oct 2026). De novo review 3 (14 Oct). Its identity findings were built. Sender-role choice R3-3 is still open in planning.md. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Scope: the `shared/` tree on branch `review/shared-wip`, HEAD `abc2307`, with the uncommitted working tree, including the round-3 changes described in [14-oct-review-2-reply.md](14-oct-review-2-reply.md) and the artifact WSv8wCDa6h1aKcBVxq3y97. The earlier reviews are 14-oct-review-1.md (WAL, storage, dashboard) and [14-oct-review-2.md](14-oct-review-2.md) (the executor and content script). This review looks at areas those reviews did not reach, at trust boundaries, and at code added in round 3.

No repo files were changed by this review. No build, version bump, commit, or live browser run was done.

Verification run during the review: `npm test` gives 1,154 `ok`, 0 `not ok`, exit 0. `node test/swSynthetic.test.js "--filter=review-2"` gives 15 `ok`. Both match the artifact.

## Summary, highest priority first

1. **R3-1 (confirmed, high). The identity used for verification and keys is lossy.** The owner decided comparisons are exact and case-sensitive everywhere. Lower-case artifact tokens are still cut, so a lower-case lookalike such as `Cesc-Fabregas-share-56` lands on the real `Cesc-Fabregas` with no remap, and the tool acts on the real account. The fix is an identity key that keeps the raw path slug and drops the query, captured at enqueue, with the cut kept for display only.

2. **R3-2 (confirmed, low to medium). The worker writes extension settings without checking their types or ranges.** Any sender can write them.
3. **R3-3 (confirmed, low). The worker accepts every action from every sender.** It has no per-sender allowlist, so an action only the dashboard needs is accepted from a content script.
4. **R3-4 (confirmed, low). A one-second dashboard interval is never cleared.** It messages the worker every second while dev mode is on.
5. **R3-5 (confirmed, low; decision needed). The clear's final pass leaves rows that moved twice.** Those rows stay visible after Clear, and their tabs stay open.
6. **R3-6 (confirmed, cost only). Every enqueue call reloads the whole completed-work log.** The chunked path does this once per chunk.

Verified sound in this review: the enqueue's read and write are under the same lock; the pause mutation re-checks the generation before it persists; the supersession counter records each enqueue once.

## Findings

### R3-1. The identity used for verification and keys is lossy (confirmed, high)

**Owner rule (2026-10-14).** Comparisons are exact and case-sensitive everywhere. `Cesc-Fabregas-SHARE-56` and `Cesc-Fabregas` are different profiles. Impersonators use case shifting. The tool blocks the profile it lands on only when that profile is the one queued.

**What the code does.** Three things compare or key on `normalizeQuoraProfileHref` output, which cuts slugs at artifact tokens (the cut patterns are at [subject.js:27-34](../shared/js/subject.js:27)):
- The content-side remap check compares the normalised requested and landed hrefs ([content.js:9261-9262](../shared/js/content.js:9261)).
- The worker's `complete` check compares `normalizeQuoraProfileUrl(lastUrl)` with the queued href ([swBootstrap.js:563-569](../shared/js/swBootstrap.js:563)).
- Queue keys are the same normalised string ([sw.js:24359](../shared/js/sw.js:24359), [sw.js:24361](../shared/js/sw.js:24361)). The queue keeps only that normalised `requestedUrl` ([subject.js:248-250](../shared/js/subject.js:248)), so the raw link is not recoverable from the row.

**The cut is case-sensitive, so it is partly exact.** Capitalised artifact tokens survive: `Cesc-Fabregas-SHARE-56` stays whole. Lower-case artifact tokens are cut. Run on the current code (node, read only):

| Queued link | Queued key | Landed page | Landed key | Remap detected? |
|---|---|---|---|---|
| `Cesc-Fabregas-share-56` | `Cesc-Fabregas` | `Cesc-Fabregas` | `Cesc-Fabregas` | no |
| `Cesc-Fabregas-SHARE-56` | `Cesc-Fabregas-SHARE-56` | `Cesc-Fabregas` | `Cesc-Fabregas` | yes |
| `Jane-type-smith-7` | `Jane` | `Jane` | `Jane` | no |
| `Mary-log-12` | `Mary` | `Mary` | `Mary` | no |
| `Sam-target-9` | `Sam` | `Sam` | `Sam` | no |

**Consequence.** A lower-case lookalike such as `Cesc-Fabregas-share-56` lands on the real `Cesc-Fabregas`. The remap check reports no remap, and the tool acts on the real account. Queue dedupe also merges distinct profiles that share a cut key. A planned Bloom lookup would test the cut key rather than the URL the author hashes, so its verdicts would be wrong for those profiles too ([blockzooka-red-list-bloom-2026-10-14.md](../blockzooka-red-list-bloom-2026-10-14.md)).

**Status against the owner's decision.** Exact everywhere is decided, and capitalised tokens already follow it. Lower-case artifacts (`Cesc-Fabregas-share-56` still becomes `Cesc-Fabregas`) and the prose check at [subject.js:134](../shared/js/subject.js:134) are not yet decided, and that is where the impersonation hole sits. The remap check is also not exact yet: it is exact on the cut key, which the owner's decision does not describe.

**Query and fragment.** Identity should drop both. The profile is named by the path, and a query such as `?share=...` is a tracking token, like the artifact suffixes. Our normalizer already drops the query and the fragment. The author's canonicalization keeps the query. Owner view (2026-10-15): we disagree with keeping it. The Bloom lookup must still hash the URL the author hashes, so whether any list entry carries a query is a question for Brett.

**Suggested fix.** Identity is the raw path slug: case-exact, with no artifact cut, no query and no fragment. It is used for the remap check (content and worker), for queue keys and dedupe, and for any Bloom lookup. It is captured from the raw link at enqueue, because the queue cannot recover it later.

A separate display function keeps the cut, for names shown to people only.

This is option C in [suffix-cutting-discussion-2026-10-14.md](suffix-cutting-discussion-2026-10-14.md). The Bloom work pulls that option forward, because the author hashes the raw URL.

**Tests.** The table rows above, as exact cases. The lower-case lookalike does not match the real profile. The capitalised lookalike does not match. `Jane-Type-Smith-7` and `Jane` are different keys. `Quert-5-followers` still displays as `Quert-5`. A link with `?share=...` has the same identity as the bare link.

**Decision needed.** Approve the identity split, including the drop of the query, with the identity key captured at enqueue. Rows already stored under cut keys stay as they are, unless the owner decides to re-key them from source pages.

Severity: high. The consequence is a wrong real-account action, and the impersonation risk the owner named.

### R3-2. Extension settings are written without value checks (confirmed, low to medium)

**Where.** `setExtensionSettingsRequested` ([sw.js:21739-21745](../shared/js/sw.js:21739)) copies every key that exists in `defaults`, and writes the value as sent. It does not check the type, the range, or the length of any value. The handler is reached from any sender ([swBootstrap.js:711-712](../shared/js/swBootstrap.js:711)).

**Impact.** The page normalises its own values before it sends them, so today's preferences page is safe. A malformed value from another sender, or from a page bug, is stored as is. Values such as `fopDelay` are used as timer delays, so a non-number becomes an immediate timer. The design note says settings are validated "against the defaults keys"; only the keys are checked.

**Suggested fix.** Validate each key against its default's type and a range, in the worker. Reject, or clamp and report, anything else.

### R3-3. The worker trusts every sender for every action (confirmed, low)

**Where.** The message handler in [swBootstrap.js](../shared/js/swBootstrap.js) routes on `request.action` with no check of the sender's role (`grep` finds no `sender.url`, `sender.id` or extension-page test). The content script legitimately sends `pause-coordinator-nukes` for its space-feed pause button ([content.js:10052](../shared/js/content.js:10052)). Other actions are only ever sent from the dashboard, for example `clear-coordinator-events` ([swBootstrap.js:696](../shared/js/swBootstrap.js:696)) and `set-coordinator-retry-failed-enabled` ([swBootstrap.js:708](../shared/js/swBootstrap.js:708)). The worker accepts both from a content script.

**Impact.** Limited. A page cannot send runtime messages, so only a content-script defect could use these. But the worker's trust model is "every extension context is trusted", and the content script's trust has never been stated.

**Suggested fix.** A per-action allowlist of sender roles (extension page, content script, worker), checked in the dispatcher, with a diagnostic for a refused call.

### R3-4. A one-second dashboard interval is never cleared (confirmed, low)

**Where.** [coordinator.js:613](../shared/js/coordinator.js:613) starts `setInterval(() => refreshDebugRunStatus(), 1000)` and never clears it. `refreshDebugRunStatus` ([coordinator.js:594-606](../shared/js/coordinator.js:594)) returns early when dev mode is off, so the cost is one worker message per second, only while dev mode is on, for each open dashboard.

**Impact.** A small load, but it adds to the event-loop pressure the project notes already record on the worker.

**Suggested fix.** Start the interval when dev mode is turned on and clear it when it is turned off, or drive it from one shared timer.

### R3-5. The clear's last pass leaves rows that moved twice (confirmed, low; decision needed)

**Where.** The round-3 re-read loop ([sw.js:26031-26045](../shared/js/sw.js:26031)) rebuilds the plan from each fresh read. On the last pass it excludes rows whose attempt moved again ([buildStoredWorkClearPlan](../shared/js/sw.js:25981), `excludedRowKeys`). An excluded row is neither removed nor closed. Its tab is not in `ownedTabIds`.

**Impact.** After Clear, the row stays visible and its tab stays open. The pause is set before the read, so such rows should be rare. The owner accepted the bounded re-read, but the decision to leave the row was not part of that acceptance.

**Suggested fix.** Remove the row on the last pass too, and add its fresh tab id to `ownedTabIds`, so the tab is closed. Or keep it and say so in the dashboard. The reply and the artifact need to choose.

### R3-6. Every enqueue call reloads the completed-work log (confirmed, cost only)

**Where.** `enqueueCoordinatorItemsStorageLocked` calls `completedRecent(Number.MAX_SAFE_INTEGER)` at [sw.js:24325](../shared/js/sw.js:24325), and builds a key map of the result each time. The chunked path ([sw.js:24206-24240](../shared/js/sw.js:24206)) calls the locked function once per chunk, so a large feed pays the cost once per chunk.

**Impact.** The completed log is resident, so there is no storage read. The cost is CPU, proportional to the completed log, once per chunk.

**Suggested fix.** Load the completed map once per request and pass it into each chunk, or keep an index by key.

## Verified sound

- **Enqueue locking.** The read and the write of the enqueue's queue are inside `enqueueSpaceFeedStorageUpdate` ([sw.js:24206-24240](../shared/js/sw.js:24206) for the wrapper, [sw.js:24630](../shared/js/sw.js:24630) for the persistence). The chunked path reads again per chunk, which is a cost, not a race.
- **Enqueue dedupe.** A row that is already completed and not being reset is merged and not re-queued ([sw.js:24410-24421](../shared/js/sw.js:24410)). A reset moves the completed row back with its own removal record.
- **Pause generation checks.** `mutateCoordinatorStoredWorkPause` re-checks the generation before it reads ([sw.js:25437](../shared/js/sw.js:25437)), before it persists ([sw.js:25546](../shared/js/sw.js:25546)), and after the persist ([sw.js:25616](../shared/js/sw.js:25616)). A stale pause restores the latest generation.
- **Supersession counter.** `recordExecutorStartSupersession` records each enqueue at most once ([sw.js:12744-12751](../shared/js/sw.js:12744)).
- **Settings keys.** Only keys present in `defaults` are written. This is a real check, even though it is not a value check (R3-2).
- **Preferences page writes.** The page sends only the messages the design allows: settings, the space registry, sort and nuked posts. It reads storage at init. The lint `no-outside-writes` covers page writes.
- **Subject normalizer.** Not sound for identity. It serves both sides, cuts slugs and keeps the query only in the author's form (R3-1). Its output is fine for display.

## Open questions for the owner

1. **R3-1.** Approve the identity split (raw path slug, no query or fragment, captured at enqueue), and decide whether rows stored under cut keys are re-keyed from source pages.
2. **R3-5.** Should a row that moved twice be removed with its tab, or kept and shown?
3. **R3-2.** Is the value-check scope the owner's, or should it follow the schema of each default?

## Coverage

Read in this review, in full or in the relevant part:

- The enqueue item loop and the persistence call ([sw.js:24293-24520](../shared/js/sw.js:24293), [sw.js:24630](../shared/js/sw.js:24630)), and the enqueue wrapper ([sw.js:24206-24240](../shared/js/sw.js:24206)).
- The stored-work pause mutation's generation checks ([sw.js:25429-25650](../shared/js/sw.js:25429)).
- The round-3 clear re-read loop and its plan builder ([sw.js:25981-26110](../shared/js/sw.js:25981)).
- The supersession recorder ([sw.js:12740-12760](../shared/js/sw.js:12740)).
- The settings handler ([sw.js:21739-21745](../shared/js/sw.js:21739)) and the dispatcher's routing ([swBootstrap.js:693-712](../shared/js/swBootstrap.js:693)), with a search for sender checks.
- The content script's action list, and the pause button's call ([content.js:10052](../shared/js/content.js:10052)).
- The dashboard's debug interval ([coordinator.js:594-614](../shared/js/coordinator.js:594)).
- The preferences page's messages and value normalisation ([preferences.js](../shared/js/preferences.js), lines 60–230).
- The subject normalizer ([subject.js:20-40](../shared/js/subject.js:20), [subject.js:209-236](../shared/js/subject.js:209)).
- Repository-wide scans for `setInterval` and for unbounded `while` loops.

Not read in this review, so not reviewed:

- Executor classification (`classifyCoordinatorExecutorState`, about [sw.js:15912-16251](../shared/js/sw.js:15912)).
- Tab sweeps (about [sw.js:29198-31175](../shared/js/sw.js:29198)).
- Stale-runtime recovery (about [sw.js:17332-17726](../shared/js/sw.js:17332)).
- Progress recording (about [sw.js:33260-33964](../shared/js/sw.js:33260)), and the milestone flush.
- Startup (about [sw.js:1992-2300](../shared/js/sw.js:1992)).
- The requeue bulk action (about [sw.js:23548-23836](../shared/js/sw.js:23548)).
- The rest of the stored-work pause and cancel (about [sw.js:25220-25429](../shared/js/sw.js:25220), [25590-25771](../shared/js/sw.js:25590)).
- `jobState.js`, `swscheduler.js`, `swexecutor.js`, `nukedPosts.js`, `spaceRegistry.js`, `sharedModeration.js`, `swstorage.js`.
- Most of `content.js` beyond the paths named in review 2.

By line count, this review reads a further small share of `sw.js` and `content.js`. The areas above are the gap. I would start with progress recording and the tab sweeps, because they handle the most untrusted input and the most timers.

## Carried forward, not re-argued here

The following are in the earlier responses and the artifact, and I agree with their current status: the latch rule (open item a, waiting for the supersession counter); the pause guard's reverse case (low, waiting for a teardown count); the remap terminal check's same-document gap (item f, waiting for a live trace); item j (no build until the owner calls a live run); the duplicated decision tree and the progress normalisers (items q and r).
