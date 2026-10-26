# Reply to 14 Oct review 3

> **Status: HISTORICAL** (24 Oct 2026). Reply to review 3 (15 Oct). Sections 7 to 10 are the as-built identity and landing record. R3-3 and R3-6 stay open. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

This answers [14-oct-review-3.md](14-oct-review-3.md), including its latest update to R3-1. Review 4 ([14-oct-review-4.md](14-oct-review-4.md)) is answered in section 7. Branch `review/shared-wip`, HEAD `abc2307`, with the uncommitted working tree.

Nothing was built, bumped, zipped, committed or reloaded, and no live run was done. `package.json` and both manifests are unchanged (1.6.1425).

## 1. Verdicts

| Finding | Verdict | This pass | Still open |
|---|---|---|---|
| R3-1 casing and identity | Owner decision (14 Oct): comparisons are exact and case-sensitive everywhere. Owner (15 Oct): no slug suffix is stripped until a live example proves one must go. The reviewer's exact-landing design is accepted; the reviewer withdrew the rewrite and the merge. | Suffix stripping is off in `sanitizeProfileHrefSlug` and in `sanitizeProfileDisplaySlug`. The query and fragment are still dropped. Pins, and test expectations changed (section 2). | Convention tokens, to be settled by live identities. Rows stored under cut keys. The prose check (`subject.js:134`). Two visibility follow-ups (section 3). |
| R3-2 settings types | Confirmed. Type rule built. | `sw.js`, `preferences.js`, test | Ranges, and reject or clamp (section 4.2) |
| R3-3 sender roles | Confirmed. A trust-model decision. The gate options are set out in section 4.3. | Nothing | Your choice of A, B or C (section 4.3) |
| R3-4 dashboard timer | Confirmed. Fixed. | `coordinator.js`, test | None |
| R3-5 clear leftovers | Confirmed. Owner decision (14 Oct): remove. Built. | `sw.js` (clear plan and last pass), `tunables.js` comment, tests | Whether a late write from the moved attempt re-creates a removed row (section 4.4) |
| R3-6 enqueue read | Confirmed as a cost. Measure first. | Nothing | Owner's choice after measurement (section 4.5) |
| R4-1 to R4-7 (review 4, 15 Oct) | Confirmed or likely; see section 7. | R4-1, R4-2 and R4-3 built, with the identity key made case-exact (section 7). | R4-4 (owner's check), R4-5 (card), R4-6 (dry-run mode), R4-7 (live check), and the owner decisions in section 7. |

## 2. Production changes in this pass

Listed so the owner can object to any of them.

**R3-2, worker.** [sw.js:21741](../shared/js/sw.js:21741) (`isExtensionSettingValueValid`) and [sw.js:21747](../shared/js/sw.js:21747) (`setExtensionSettingsRequested`).
- A key is written only when its value has its default's type. Numbers must also be finite. Every default is a number or a boolean ([defaults.js](../shared/js/defaults.js)).
- A mismatched key is not written, and it is returned in `rejected`. Other keys are written as before. Unknown keys are still ignored.
- The response is now `{ok: true, rejected: [...]}`. A clean write returns an empty list.
- Before this change an empty number field was stored as `NaN`. It is now rejected, and the stored value is kept.

**R3-2, page.** [preferences.js:108-116](../shared/js/preferences.js:108). When the worker rejects a key, the page reports "Settings saved, except … (empty or invalid)." instead of "Settings saved." The wording is the owner's to change.

**R3-4, dashboard.** [coordinator.js:554](../shared/js/coordinator.js:554) (`debugRunStatusTimer`), [coordinator.js:583](../shared/js/coordinator.js:583) (`applyDevModeVisibility`), [coordinator.js:592](../shared/js/coordinator.js:592) (`syncDebugRunStatusTimer`), [coordinator.js:623](../shared/js/coordinator.js:623) (`installDevModeToggle`).
- The one-second poll starts when dev mode is on and stops when it is off. The sync is idempotent: a second "on" starts nothing, a second "off" clears nothing.
- Every dev-mode change reaches `applyDevModeVisibility`: init through `installDevModeToggle`, the toggle, and a push from the worker through `applyDevModeEnabled`. The sync runs there.
- `installDevModeToggle` no longer starts a timer. The original `setInterval` is now inside `syncDebugRunStatusTimer` ([coordinator.js:594](../shared/js/coordinator.js:594)).
- The literal `1000` stays. It moves into the symbolic registry after the review cycle (planning.md, to-do item 1).

**R3-5, worker (owner, 14 Oct: remove).** [sw.js:25993](../shared/js/sw.js:25993) (`buildStoredWorkClearPlan`, with the `excludedRowKeys` parameter removed) and [sw.js:26052](../shared/js/sw.js:26052) (the last re-read pass now builds the plan from the fresh read, with no exclusion).
- Every row in the fresh read is removed, including a row whose attempt moved after the bound. Its fresh tab id is in `ownedTabIds`, so the tab is closed.
- The re-read bound is unchanged at 2 passes (`STORED_WORK_CLEAR_REREAD_ATTEMPTS`, [tunables.js:73](../shared/js/tunables.js:73)). Only the outcome for a row that is still moving changes. The tunable's comment now says so.
- Test expectation changed: the wiring test in `test/acceptedReviewChanges.test.js` pinned the old signature, `buildStoredWorkClearPlan(state = {}, excludedRowKeys = null)`. It now pins `(state = {})`, asserts that `excludedRowKeys` no longer appears in `sw.js`, and asserts that the last pass builds from the fresh read.

**Case-sensitive identity (owner, 14 Oct: exact everywhere).**
- The remap check compares exact normalized hrefs, and this pass changed nothing in it: `getQueuedProfileRemapTarget` ([content.js:9158](../shared/js/content.js:9158)), the progress flag `remappedFromRequested` ([content.js:11509](../shared/js/content.js:11509)), and the worker's `complete` check and its flag ([swBootstrap.js:528-571](../shared/js/swBootstrap.js:528)). The keys it compares changed under review 4 (section 7).
- `isProfileBlockedFromInlineState` ([content.js:4865](../shared/js/content.js:4865)) searched the page's scripts for the profile path case-insensitively. It now searches exactly.
- `getStoredSpaceRecord` ([content.js:6627](../shared/js/content.js:6627)) compared space slugs case-insensitively. It now compares exactly ([content.js:6647](../shared/js/content.js:6647)).
- The token classifiers in `subject.js` compare the token as written, except the prose check ([subject.js:111](../shared/js/subject.js:111)), which lower-cases tokens (section 4.6). The space-post text key ([content.js:7184](../shared/js/content.js:7184)) keeps the text's case.

**Suffix stripping is off (owner, 15 Oct: strip none until a live example proves one must go).**
- `sanitizeProfileHrefSlug` ([subject.js:20-27](../shared/js/subject.js:20)) no longer applies the cut patterns or the two tail rules. It still drops the query and fragment. Review 4 also changed NFKC to NFC and removed its trims (section 7).
- `sanitizeProfileDisplaySlug` ([content.js:5813](../shared/js/content.js:5813)) had its own case-insensitive suffix regexes. They are gone; it passes through.
- The two helpers in `subject.js`, `stripDescriptiveProfileSuffix` ([subject.js:36](../shared/js/subject.js:36)) and `stripTrailingProfileArtifactToken` ([subject.js:67](../shared/js/subject.js:67)), are no longer called. They stay in the file for the day an example needs them.

**Suffix shadow (owner, 15 Oct: count what the old rule would have removed; store nothing).**
- `legacyStrippedSuffix` and `shadowSuffixTokens` ([subject.js:273](../shared/js/subject.js:273), [subject.js:294](../shared/js/subject.js:294)) reproduce the HEAD suffix rule for measurement only. HEAD's rule was case-insensitive, so the shadow folds case first. The current and shadow tail rules now read one word set, `DESCRIPTIVE_PROFILE_WORDS` ([subject.js:29](../shared/js/subject.js:29)).
- Checked against HEAD's own `sanitizeProfileHrefSlug` on 802 slugs (the 775 saved fixture slugs and 27 examples): 0 differences. The check ran outside the repo, against a copy of HEAD's `subject.js`.
- `noteSuffixShadow` ([sw.js:24221](../shared/js/sw.js:24221)) runs once per enqueued link, before the link is queued. If the old rule would have removed a suffix, it counts `suffixShadow.changed`, and `suffixShadow.token.<token>` for each known token in that suffix, or `suffixShadow.token.other`. The stored key and the tab URL do not change.
- The counters sit in the queue wakeup metrics, which the dashboard requests through its metrics view. I have not checked how the dashboard displays them.
- Counts are per enqueued link, so a link enqueued twice counts twice.

**Tests.**
- [test/subject.test.js](../test/subject.test.js), two cases, both rewritten for the new rule:
  - [line 69](../test/subject.test.js:69): the case formerly titled "strips known URL artifact tails from slugs" is now "keeps URL-looking tails as written". `Some-User-42-answers`, `Some-User-42-his-bio`, `Quert-5-followers` and `Cesc-Fabregas-share-56` are kept whole.
  - [line 76](../test/subject.test.js:76): `Cesc-Fabregas-SHARE-56`, `Some-User-42-His-Bio`, `Some-User-42-His-bio`, `Cesc-Fabregas-56-SHARE-x`, `Cesc-Fabregas-56-SHARE-bio` and `Name-12-bio-details` are kept whole. A query and fragment are still dropped.
- [test/acceptedReviewChanges.test.js](../test/acceptedReviewChanges.test.js): eight cases from this review: the R3-2 type check, the R3-4 timer, the keys-keep-case pin, the remap check, the page-data scan, the space registry, the space-post key, and the R3-5 plan (every row removed, each row's tab owned).
- [test/swSynthetic.test.js](../test/swSynthetic.test.js): one new case beside the existing redirect-mismatch test. A queued lower-case href that lands on the canonical casing is ended as `profile-redirect-mismatch`, and its tab is closed.

**Test expectations changed by the no-strip rule.** These are the only expectations that moved:
- `Some-User-42-answers`: was `Some-User-42`, now `Some-User-42-answers`.
- `Some-User-42-his-bio`: was `Some-User-42`, now `Some-User-42-his-bio`.
- `Cesc-Fabregas-share-56`: was `Cesc-Fabregas`, now kept whole.
- `Name-12-bio-details`: was `Name-12`, now kept whole.
- `Cesc-Fabregas-56-SHARE-x`, `Cesc-Fabregas-56-SHARE-bio` and `Some-User-42-His-bio`: kept whole, as they were in the 14 Oct version of the test.
- `Quert-5-followers` is new in the expectations, and kept whole.
The full chain passed without any other expectation changing, including the swSynthetic cases.

## 3. R3-1, the case and identity decision

The owner decided on 14 Oct that comparisons are case-sensitive everywhere, because impersonators use case shifting. The queue keeps each href as given. The tab lands on it, and the landed href must match the queued href exactly, or the row ends as `profile-redirect-mismatch` and nothing is acted on. This is the design the reviewer's latest update describes, and the reviewer withdraws the rewrite and merge proposals from the earlier updates. This reply accepts that design.

The remap check compares exact normalized hrefs. This pass adds the pins, makes the identity matches in section 2 exact, and turns suffix stripping off (section 4.6). With no suffix stripped and the review-4 changes (section 7), the stored key differs from the raw slug only by NFC, percent-encoding, and the query and fragment. The code compares the normalized form, not the raw slug, so those three differences are the whole gap.

Follow-ups from the update, not built:
1. A mismatch row shows both hrefs on the dashboard. The progress record already holds both: the queued key and `resolvedProfileHref`. Owner decision: whether the dashboard shows mismatch rows.
2. The mismatch diagnostic records the source page and tab. Not built. I have not checked which source fields a queued row carries.

## 4. For discussion

### 4.1 R3-1 follow-ups

See section 3. Recommendation for follow-up 1: show mismatch rows with both hrefs, because impersonator attempts are what the tool exists to catch. The owner decides.

### 4.2 R3-2, ranges and scope

The reviewer asked whether the scope is the owner's or follows each default's schema. This pass builds the schema level, the type of each default. Ranges need values, which are the owner's to set, for `fopDelay`, `fopFlipDelay`, `profilesPerBatch`, `targetQueuedTabConcurrency`, `nukedPostRetentionDays` and `maxRememberedNukedPosts`.
- A range for `targetQueuedTabConcurrency` must allow `0`, which [swSynthetic.test.js:41924](../test/swSynthetic.test.js:41924) sends.
- Reject or clamp is a choice. This pass rejects, because a type mismatch has no sensible clamp.

### 4.3 R3-3, sender roles: the gate options

**The problem.** The dispatcher in `swBootstrap.js` routes every runtime message by `request.action` (67 branches) and never checks who sent it. So a content script can send any action, including dashboard-only ones. The reviewer's point is that a web page cannot send runtime messages, so the realistic exposure is a defect in our own content script.

**What a gate would check.** The sender. `sender.tab` is set for content scripts and for extension pages open in a tab. The dashboard is one of those pages, so `sender.tab` cannot tell them apart. The check has to use `sender.url` against the extension's own origin, `browser.runtime.getURL('')`. I have not checked that prefix in both browsers.

Facts from the shared tree: literal senders are `content.js` 32 actions, `coordinator.js` 22 and `preferences.js` 6. `content.js` also sends `quora-runtime-ready`, which no dispatcher branch handles. I did not trace where it goes.

**The options.**
- **(A) A role for each action.** Each of the 67 actions gets the senders it accepts: extension page, content script, or both. A refused call returns an error and records a diagnostic. This covers everything, and it is the reviewer's suggestion. Cost: the largest change. Every entry must be right, because a wrong one refuses a real call, and the 11 unknown senders below must be traced first.
- **(B) Gate the dashboard-only actions.** Twenty actions are sent literally by the dashboard and by no content script or preferences page: `cancel-coordinator-current-work`, `cancel-coordinator-current-work-item`, `claim-debug-run-autosave`, `clear-coordinator-current-work`, `clear-coordinator-events`, `clear-coordinator-outliers`, `clear-coordinator-terminal-stats`, `coordinator-page-ready`, `get-debug-resume-limit-status`, `get-flight-recorder`, `refresh-coordinator-dashboard-views`, `refresh-queue-wakeup-metrics-view`, `register-queued-worker-action-surface`, `requeue-coordinator-failed`, `reset-queue-wakeup-metrics`, `resume-coordinator-queue`, `resume-paused-coordinator-nukes`, `set-coordinator-retry-failed-enabled`, `set-dev-mode-enabled` and `set-hidden-run-ids`. Under B, those accept only extension-page senders, and the other 47 are unchanged. Cost: small. Limits: the 11 unknown senders stay open until traced. `coordinator-page-ready` and `register-queued-worker-action-surface` are sent from `coordinator.js`, so they stay allowed. Developer tools in `tools/cdp` may send some of the twenty from an extension page, which B also allows; I have not verified that.
- **(C) Document, do not gate.** No code. Write down that content scripts are trusted, because they are our own code and a web page cannot send runtime messages. Cost: a defect in our content script can still call dashboard actions such as `clear-coordinator-events`.

**The 11 with no literal sender,** and where their names appear. None is a literal `action:` value in the three pages, so each may be sent through a variable.
- `record-job-milestone`: in `content.js`. It is a content-script action, so it must stay out of any dashboard-only list.
- `refresh-coordinator-runs-view`: in `coordinator.js`. A dashboard action.
- `reconcile-coordinator-storage` and `refresh-coordinator-queue-view`: in `sw.js` and in `tools/cdp`.
- `get-coordinator-queue-accounting`, `get-coordinator-queue-runtime-state` and `get-coordinator-why-not-running`: in `tools/cdp` and the tests.
- `cleanup-owned-nuke-status`, `request-action-lease`, `retry-coordinator-failed` and `confirm-space-feed-profiles-blocked`: in the tests only. I found no production sender, so these branches may be dead.

**Recommendation:** (B), after the 11 are traced, so that `record-job-milestone` and any other content action stays off the list. The owner decides.

### 4.4 R3-5, the clear's leftover rows: removed (owner, 14 Oct)

The owner chose removal, and it is built (section 2). A row whose attempt moved after the last re-read is now removed with the rest, and its fresh tab is closed.

What this accepts:
- A row whose attempt moved is probably live. Removing a live row while its attempt writes is the racing-writer pattern in the entropy plan (named pattern 4). The removal is recorded as a WAL removal, but I have not checked whether a late write from that attempt re-creates the row. That check is the next item for this change.
- Closing the tab ends the attempt mid-work.
- The reviewer says the pause is set before the read, so such rows should be rare. I have not checked that a paused row cannot be reclaimed.

### 4.5 R3-6, the completed-log read

Facts:
- Each locked enqueue calls `completedRecent(Number.MAX_SAFE_INTEGER)` ([sw.js:24336](../shared/js/sw.js:24336)).
- That read sorts the whole completed map and deep-clones every row ([swQueueWalDurableReads.js:36-39](../shared/js/swQueueWalDurableReads.js:36)).
- The chunk loop calls the locked enqueue once per chunk, 50 items each ([sw.js:24259-24265](../shared/js/sw.js:24259), [coordinatorEnqueueChunking.js:12](../shared/js/coordinatorEnqueueChunking.js:12)). Each chunk pays the full read.
- The enqueue uses the rows for more than keys. It builds `completedByKey` ([sw.js:24337-24340](../shared/js/sw.js:24337)), where the older row wins a duplicate key, so the sort decides which row that is. It reads the row's `actionKind` ([sw.js:24376](../shared/js/sw.js:24376)). On a reset it keeps the row as `previousRow` in a removal record ([sw.js:24439-24441](../shared/js/sw.js:24439)).
- Not measured.

Options:
- **(A)** Read once per request and pass the map into each chunk. Cost: a snapshot can go stale between chunks, because each chunk takes the lock on its own. A row completed in between could be queued again.
- **(B)** A read that skips the clone and keeps the sort. This needs an aliasing check first: the row is kept as `previousRow` in a removal record, so the record must copy it, or a later change to the resident state would reach it.
- **(C)** Measure first: count the completed rows, and time each chunk's read and map build, through the existing metrics.

**Recommendation:** (C), then (B) if the clone is the cost and the aliasing check passes. The owner decides.

### 4.6 No suffix is stripped (owner, 15 Oct)

Strip no suffix until a live example proves one must go. Checked on the module:
- `Cesc-Fabregas-SHARE-56`, `Cesc-Fabregas-share-56`, `Quert-5-followers`, `Jane-type-Smith-7`, `Mary-Log-12` and `Name-12-bio-details` are kept as written.
- `Cesc-Fabregas-56?share=abc#top` → `Cesc-Fabregas-56`. The query and fragment are dropped.

What this changes:
- **A suffixed lookalike is its own identity.** `Cesc-Fabregas-share-56` now opens its own URL, and its key differs from `Cesc-Fabregas`, so the landing check ends the row if Quora redirects it to the real profile. This follows from the code. What Quora serves for that URL is not checked. The fullwidth lookalike was a separate hole that the suffix rule did not close. NFC closes it (section 7).
- **Quora's own conventions become separate identities.** `Name-following`, `Name-answers` and `Quert-5-followers` no longer collapse to `Name` or `Quert-5`. The likely results are duplicate rows, or mismatches where Quora redirects to the real profile (the exact landing check then ends the row without acting). The duplicate risk is the cost of this rule.
- **The suffix note's intended result is reversed.** `suffix-cutting-discussion-2026-10-14.md` listed `Quert-5-followers` → `Quert-5` as wanted. It stays whole until a live example proves otherwise.
- **URL sub-pages are unchanged.** `/profile/Name/answers` still reduces to `/profile/Name`. I read "suffix" as the slug suffix; sub-pages are URL structure. Say if you want that changed too.
- **The helpers stay, uncalled.** See section 2.

Left for your decision:
- **Prose check, [subject.js:111](../shared/js/subject.js:111).** `isLikelyExplicitProfileTargetSlug` still lowercases tokens to count prose words. Making it exact would let capitalized prose words count as name words, and that weakens the guard against question titles. It was not in the list you approved, so it is unchanged.
- **Heuristics.** Name association is removed (review 4, R4-2; section 7). Profile search still folds case and accents to match names, and its matches decide which rows are nuked. That is an owner decision, not a leave-as-is item (section 7).
- **Rows stored under cut keys.** See section 4.7.

Left as they are, because they are not identity: route keywords (`subject.js:173`, `177`, `196`, `206`; `content.js:2861-2972`; `swProfileResolution.js:175-183`; `coordinator.js:2962`), hostnames (`swquoraTabs.js:18`, `swOwnedTabLifecycle.js:72`), search queries, confirmation kinds, moderation labels (`sharedModeration.js`), and the UI-text regexes in `content.js`.

### 4.7 The Blockzooka notes, and rows stored under cut keys

The 14 Oct Blockzooka note ([blockzooka-red-list-bloom-2026-10-14.md](../blockzooka-red-list-bloom-2026-10-14.md), "Normalization comparison") names suffix cutting as a real bug. Its examples are `Jane-Type-Smith-7` → `Jane`, `Mary-Log-12` → `Mary` and `Sam-Target-9` → `Sam`. With no suffix stripped, those keep their full slugs. Its "no code changed" line is now out of date. The Bloom lookup must still use the author's canonicalization, which cuts nothing. Bloom is not in use, so this waits.

**Rows stored under cut keys.** A queue row for `Jane-Type-Smith-7` is keyed `Jane` under the old rule. Three facts, from code reading and not from a live run:
- The queue stores the normalized form. `normalizeCoordinatorRequestedUrl` ([swProfileResolution.js:131-143](../shared/js/swProfileResolution.js:131)) passes the value through `normalizeTabTargetUrl`, so the stored `requestedUrl` is already cut. The raw href is not kept on the row, so existing rows cannot be re-keyed from the stored queue.
- A queued tab opens the URL that the key normalizes to. `buildTabCreateOptions` sets `url: normalizeTabTargetUrl(action.url)` ([sw.js:27505](../shared/js/sw.js:27505)). The open-URL commit check normalizes the same way and updates the tab to that URL when it is not there ([swexecutor.js:105-114](../shared/js/swexecutor.js:105)).
- So a row keyed `Jane` opens `Jane`. A run for `Jane-Type-Smith-7` under the old rule opened and acted on `Jane`. A live check would confirm this, with the extension running. I have not run one.

A new enqueue of `Jane-Type-Smith-7` now keys and opens the full slug. Existing rows keyed `Jane` keep opening `Jane` until they are cleared.

**Decision still open:** clear the existing cut rows, or re-key them from their source pages.

### 4.8 Decisions, 15 Oct

- **Identity split (R3-1):** approved in principle. With no suffix stripped, the stored key is the raw slug except for NFC, percent-encoding, and the query and fragment. Capture at enqueue is not needed for suffixes. NFC is decided (section 7). Percent-encoding stays, because the reviewer says the server applies the same equivalence. Brett's answer may still bear on the Bloom input, which is not in use.
- **Convention tokens:** replaced by the no-strip rule. No suffix is stripped until a live example proves one must go (owner, 15 Oct). The live run is where that gets settled.
- **Rows stored under cut keys:** left as they are.
- **Query:** the owner's view is to drop it from identity. It is dropped now. The Bloom input waits for Brett.
- **R3-5:** removal built (section 2).
- **R3-3:** choice still open (section 4.3).
- **Before a live run:** a suffixed lookalike is its own identity under this rule, and the fullwidth lookalike is closed by NFC (section 7). Duplicate rows and mismatches remain possible for Quora's own conventions. Check the first live rows by hand.
- **Shadow counter:** built (section 2). It counts what the old rule would have removed, by suffix, and changes no key. The live run's counters show which suffixes real links carry.
- **History:** the cut patterns were added between 2026-04-19 and 2026-05-03 (`942b654`, `4068c93`, `6cfb4cc`, `302a233`). No commit or note records why. The swSynthetic test comment at [line 7712](../test/swSynthetic.test.js:7712) calls `-followers` and `-following` a Quora URL convention.

## 5. Not verified or not done

- No build, version bump, zip, reload, commit or live run.
- The normalizer results in section 4.6 come from running `node` on the module. I have not checked them on a live page, and I have not sampled real Quora links.
- What Quora serves for a suffixed URL such as `…/Cesc-Fabregas-share-56` is not checked.
- The trace in section 4.7 is from code reading. A live check would confirm it.
- Not checked: whether a late write from a moved attempt re-creates a row removed by R3-5 (section 4.4).
- Not checked: whether the gate's `sender.url` prefix works in both browsers, and whether developer tools in `tools/cdp` send any of the twenty dashboard-only actions (section 4.3).
- The page-data scan is exact now. If Quora ever writes a profile path in a different casing from the URL, the scan would miss the blocked marker and report "not blocked". The VM test covers the logic, not a real page. A live check would settle it, and it needs your go-ahead.
- The case-variant synthetic test uses the harness, not a live tab.
- R3-6 is not measured.
- The page wording in `preferences.js` is a placeholder for the owner's wording.
- `npm test`: 1,170 `ok`, 0 `not ok`, exit 0. That is the 1,154 from the 14 Oct baseline, plus eleven cases from the earlier passes, plus five from review 4 (section 7). The no-strip change edited expectations in two existing subject cases and added none to the count. The suffix shadow adds one case.
- Lints `correctness`, `queue-boundary`, `block-classification`, `queue-storage-layering` and `no-outside-writes` pass. `lint:duplicates` reports 42 clones, the same as the 14 Oct baseline.
- `node test/swSynthetic.test.js "--filter=review-2"`: 15 `ok`, 0 `not ok`.

## 6. Line numbers

From R3-2 on, the reviewer's `sw.js` anchors are pre-edit. The settings edit moved every `sw.js` line after 21746 later by 11, so the reviewer's numbers for those lines are 11 lower than the file now. For example, the enqueue's `completedRecent` is at 24336 now, and was at 24325 before. The R3-1 anchors in `sw.js` (24359, 24361, 24370) are current.

The reviewer's `content.js` anchors for R3-1 (12269, 12130) are one line lower than the file now, after the page-data scan edit. They are at 12268 and 12129.

The R3-5 edits moved the clear plan to `sw.js:25993` and its last-pass call to `sw.js:26052`. The reviewer's anchors for R3-5 (`sw.js:26031`, `25981`) are from before both edits.

The no-strip edits moved `sanitizeProfileHrefSlug` to `subject.js:20`, and `sanitizeProfileDisplaySlug` to `content.js:5813` (review 4 moved it up by the removed helpers and the removed filter). The tests are at `test/subject.test.js:69` and `:76`.

## 7. Review 4 (15 Oct): response

Source: [14-oct-review-4.md](14-oct-review-4.md). The owner approved the plan for R4-1 to R4-3 on 15 Oct ("agree with all, proceed"). Built in this pass: R4-1, R4-2 and R4-3, the case-exact identity key (not in the review's list), and the removal of the truncation filter (owner decision 2). Nothing was built, bumped, zipped, committed or reloaded.

| Finding | Verdict | Built in this pass | Still open |
|---|---|---|---|
| R4-1 NFKC folds fullwidth lookalikes | Confirmed. Owner: NFC, not NFKC. The reviewer's suggestion was the slug as written, with no NFKC. NFC keeps composed accents and keeps fullwidth letters apart from ASCII. | NFC in `sanitizeProfileHrefSlug` ([subject.js:26](../shared/js/subject.js:26)) and in the content script's `getQuoraProfileSlugData` ([content.js:5547](../shared/js/content.js:5547)). The second copy was not in the review; without it the fold stayed in the content script's identity keys. | What Quora serves for a fullwidth link (live) |
| R4-2 name association can queue and nuke another profile | Confirmed in code. Owner: a medium name match must not be queued or nuked. | The name branch in the space-feed collector is removed ([content.js:7505](../shared/js/content.js:7505) is now its return). Its helpers `getNearbyProfileUrlsForName`, `getProfileSlugText` and `getTrailingTitleNameCandidate` are removed; nothing else called them. A post with no profile link is no longer matched by name. It reaches the page resolver only if its stored entry is resolvable, which today means an asset post with a low-confidence post-URL artifact (`isQueueableSpaceFeedResolverEntry`; section 8). | Check the first live asset posts with a low-confidence artifact. Name-less target posts are not queued (section 8) |
| R4-3 trailing separators trimmed | Confirmed. Owner: no trailing-separator trim in identity. | The trailing-separator trim is gone. I also removed the whitespace trim, since "as written" includes whitespace. | Display keeps the same slug, so a trailing hyphen shows in a display name (cosmetic). Say if you want whitespace trimmed back. |
| R4-4 past runs may have acted on cut-derived targets | Likely. Owner agreed: check first, before any live run. | Nothing; no build. | Owner's check (decision 4 below) |
| R4-5 new signals not on a card | Confirmed. | Nothing. | The live-checks card, at the first build |
| R4-6 dry-run mode | Likely. Owner: a later build. | Nothing. | Design decided (decision 3 below); the build comes later |
| R4-7 page-data scan is exact | Low. Check on one real page at the live run. | Nothing. | Live check |

**Changes beyond the review's list**
- **The identity key is case-exact.** `getNormalizedProfileIdentityKey` ([content.js:5561](../shared/js/content.js:5561)) lower-cased the slug. Its callers are the queue's dedupe, `getNormalizedProfileHrefList` ([content.js:5569](../shared/js/content.js:5569)), and the "handled" marks on profile modals. The dedupe kept one of two case variants and dropped the other, so a case variant in the same candidate list could be lost before it was queued. That is the impersonator case the owner named. The lower-case is removed. A test covers the key and the dedupe.
- **The shadow counter keeps NFKC.** `legacyStrippedSuffix` ([subject.js:274](../shared/js/subject.js:274)) keeps NFKC on purpose, because it reproduces HEAD for the counter.
- **The truncation filter is removed (owner decision 2, 15 Oct).** `isLikelyTruncatedProfileIdentityKey` (it was at [content.js:5590](../shared/js/content.js:5590)) dropped a shorter candidate when a longer identity starts with it. `getNormalizedProfileHrefList` ([content.js:5569](../shared/js/content.js:5569)) now returns every case-exact identity. A test pins `Jane` and `Jane-7` as two profiles.

**Decisions (owner, 15 Oct)**

1. **Profile search: left as it is (owner, 15 Oct).** Leave it alone; we will test it in the live run. The folded match and the batch nuke are unchanged. How it works, for the test: the feature runs only on `www.quora.com/search?q=…&type=profile` (gate: [content.js:2916](../shared/js/content.js:2916)). The folded match is `isProfileSearchHrefMatchForCurrentQuery` ([content.js:10455](../shared/js/content.js:10455)). The row and batch buttons nuke on click, and the batch calls `nukeProfileSearchHrefs` ([content.js:10910](../shared/js/content.js:10910)). The collect button only stages matches ([content.js:10537](../shared/js/content.js:10537)). The fold is NFKD, so fullwidth letters fold onto ASCII: a fullwidth link matches the query `Cesc Fabregas` (checked with the real function). A batch click blocks every staged match, including the real profile if it is in the results and not yet blocked.
2. **Truncation filter: removed (owner, 15 Oct: agree).** It is built; see the changes list above. Check the first live candidate lists: a post can now queue a shorter and a longer profile together, such as `Jane` and `Jane-7`. The profile-search list is affected the same way.
3. **Dry-run mode (R4-6): design decided (owner, 15 Oct: agree with the recommendations); the build comes later.**
   - Trigger: a per-link "check only" action on the dashboard.
   - Outcome: `skipped`, with the reason `dry-run-match` or `dry-run-mismatch`, so a dry run is never counted as a block.
   - Guard: the worker's claim path (`claimPendingTabAction` in `shared/js/sw.js`), after tracing every path that starts a tab. That trace is the first step of the build.
   Until the dry run exists, the review's test matrix cannot run without clicks. Do not queue lookalike links before then.
4. **Past blocks (R4-4): the owner's check, before any live run (owner, 15 Oct: agree).** The owner does it; I have not.
   1. List the profiles the tool has blocked. The dashboard's History view may show them; I have not checked it.
   2. Compare that list with your Quora block list.
   3. Look for a blocked profile whose name is a cut prefix of a longer slug, such as `Jane` for `Jane-Type-Smith-7`. The completed log stores cut keys, so it cannot recover the raw link.
   4. If one is found, decide whether to unblock it. The unblock path is the worker's `unblock-unmute-profile` action and the content script's `unblockUnmuteProfile`.

**Results of this pass**
- `npm test`: 1,171 `ok`, 0 `not ok`, exit 0. Before review 4 it was 1,165. The six new cases are three in `test/subject.test.js` (fullwidth lookalike, composed accents, trailing separator) and three in `test/acceptedReviewChanges.test.js` (the exact identity key and dedupe, the R4-2 wiring, and a shorter identity beside a longer one). No existing expectation changed.
- Lints `correctness`, `queue-boundary`, `block-classification`, `queue-storage-layering` and `no-outside-writes`: exit 0. `lint:duplicates`: 42 clones, the baseline.
- `node test/swSynthetic.test.js "--filter=review-2"`: 15 `ok`, 0 `not ok`.
- Node spot checks: the fullwidth link keys to a percent-encoded fullwidth slug, not the real profile's key. `Cesc-Fabregas-56-` keeps its hyphen. A decomposed `José` and a composed one share a key.
- Line numbers: removing the helpers moved the `content.js` lines after 5826 up by about 66, and removing the truncation filter moved the lines after 5616 up by 29. Sections 2 to 4 and this section use the current numbers.

**Not verified**
- What Quora serves for fullwidth, trailing-hyphen or suffixed URLs.
- The dry-run trace and the History view (decisions 3 and 4).
- Whether removing the truncation filter adds rows on live candidate lists (decision 2).

## 8. Review 5 (15 Oct): check

Source: [14-oct-review-5.md](14-oct-review-5.md). Each claim was checked against the code and the saved fixtures. No code was changed. The open items are owner decisions, listed at the end.

| Item | Verdict | Evidence |
|---|---|---|
| Verdict: one narrow run, canonical links only | Agree | The conditions under "Before any live run" hold once the build is done and the owner's past-block check is complete. |
| R5-1 profile search folds lookalikes | Confirmed. The record was missing the fullwidth case; section 7, decision 1 now says so. | The real token functions give `cesc` and `fabregas` for the fullwidth link, so it matches the query. |
| R5-2 landing check reads only the URL | Confirmed for canonical rows. It does not apply to resolver rows (see below). | The worker check runs only when the row is not a resolver row ([swBootstrap.js:563-571](../shared/js/swBootstrap.js:563)). Our dry-run design does not say "page" or "URL". The phrase "the landed profile's key" is from review 4, not from our reply. Quora's behaviour is not checked, and the saved fixtures are space pages, not profile pages. |
| R5-3 medium explicit links are queued and nuked | Confirmed, with one condition added. | `text-profile-url` is medium ([content.js:7482](../shared/js/content.js:7482)). The post-URL candidate runs only on asset pages with no other candidate ([content.js:7485](../shared/js/content.js:7485)), and is medium only when the slug looks explicit with two or more tokens ([content.js:5714-5718](../shared/js/content.js:5714)). |
| R5-4 name-less posts go to the resolver | Withdrawn. The trace missed the retry route the reviewer found. Section 9. | The stored-flag route is as stated ([content.js:8450](../shared/js/content.js:8450)). The retry route is not. |
| R5-5 two low points | Confirmed. No change. | Trailing punctuation is stripped at [content.js:5616](../shared/js/content.js:5616). A decode failure returns null with no counter ([content.js:5556-5557](../shared/js/content.js:5556)). |
| R5-6 signals not on a card | Confirmed. | No `suffixShadow` reference in `coordinator.js`. `formatMetricCounterDelta` shows at most three non-zero keys ([coordinator.js:2532-2538](../shared/js/coordinator.js:2532)). |
| R5-7 dry run not built | Confirmed. | The only `dry-run` matches are classification comments. |
| R5-8 items | Confirmed. | Whitespace is untrimmed ([subject.js:26](../shared/js/subject.js:26)). |
| Verified-sound ranges | Mostly right. The exact ranges are `test/subject.test.js:94-120`, the remap test at `test/acceptedReviewChanges.test.js:395-406`, and the identity and shorter-identity tests at `:478-524`. | |

**R5-4, traced (superseded by section 9).** The question was whether the resolver's candidates come from the post's own page or from a name match. The stored-flag route below is right. The retry route was missed.
- They come from the post's page and never from a name. For a queued space post the order is: the post header's first profile link (`getSpacePostHeaderProfileHref`); then the question asker's inline data, or a keyword-scored scan of visible profile links (`getOriginalPosterProfileHref`, [content.js:5917-5955](../shared/js/content.js:5917)); then the single explicit profile link in the post.
- On asset pages the queued path returns the explicit link only ([content.js:9188-9192](../shared/js/content.js:9188)). The scored scan does not run there.
- The resolver is reached only through `resolveProfileFromPage`, which is set to `isAssetSpacePage() && !!postUrl && needsSourceResolution` ([content.js:8450](../shared/js/content.js:8450)). Every other writer is gated on that flag. So a name-less post on a target page is not queued at all.
- Residual path: the scored scan can still run on a target page through a resolution item queued under the older rule, or through its retry (`failed-target-source-post-revisit`, [swCoordinatorRetryCandidates.js:207-208](../shared/js/swCoordinatorRetryCandidates.js:207)). The older form is the one [p1-contract.test.js:4607](../test/p1-contract.test.js:4607) now forbids. I did not check the live queue for such rows.
- No test covers the scored scan. The entropy plan names this function as a misidentification risk.

**New point.** For resolver rows the worker's landing check is skipped ([swBootstrap.js:563-566](../shared/js/swBootstrap.js:563)), so their identity is whatever the page reports. The URL-only gap in R5-2 therefore applies to canonical rows. The scored scan is the identity source for any resolver row that reaches it.

**Decisions for the owner (none made here)**
1. **Profile search.** The review recommends keeping it out of the first narrow run, which fits your answer to test it later. Confirm.
2. **Dry-run identity.** The review recommends comparing the page's own identity, not the URL. That changes the design you approved. The first step is to save one real profile page into `test/fixtures`, so that the identity it exposes can be seen. The fixtures we have are space pages.
3. **Medium explicit links.** Keep them queued and check the first candidate lists (the review's recommendation).
4. **Whitespace.** It stays untrimmed, which is the current state. Confirm.
5. **Scored scan (revised in section 9, decision 2).** (a) Keep it and accept the stale-row path. (b) Remove `getOriginalPosterProfileHref()` from the queued path, so an unresolved row ends with no action. I recommend (b), because a guess should not decide an action. This is a terminal-state choice. (c) Keep it, but check the queue for stale resolution rows first.
6. **Build timing.** Your call.

**Before any live run.** The review's list holds, with one addition: check the queue for profile-resolution rows left from older runs (R5-4).

**Not verified.** Quora's handling of lookalike URLs; what a profile page exposes; the contents of the live queue.

## 9. Reviewer's response to section 8, and the change made

Source: [14-oct-review-5-response.md](14-oct-review-5-response.md). The reviewer is right. My R5-4 verdict in section 8 is withdrawn: my trace stopped at the stored flag and did not follow the retry route.

**Verified in the code**
- A "did not land on a profile page" error is an action error, which is retryable ([content.js:12017](../shared/js/content.js:12017), [11618-11631](../shared/js/content.js:11618), [jobState.js:212](../shared/js/jobState.js:212), [689](../shared/js/jobState.js:689)).
- `getFailedItemProfileResolutionRetryUrl` returns the question-resolution URL before it checks whether the row has its own link. For a "did not land" error that URL is the source post ([swCoordinatorJobEnvelope.js:162-196](../shared/js/swCoordinatorJobEnvelope.js:162)). The "question:" route comes from the same message, when the landing page is a question page.
- The retry drops the row's href and sets `resolveProfileFromPage` ([swCoordinatorRetryCandidates.js:161-163](../shared/js/swCoordinatorRetryCandidates.js:161), [207](../shared/js/swCoordinatorRetryCandidates.js:207)).
- Canonical space-feed rows carry the post URL as evidence ([content.js:9500-9530](../shared/js/content.js:9500), sent at [9748](../shared/js/content.js:9748)).
- The resolution then runs on the source post: the header, or the scored scan on a question page ([content.js:9182-9206](../shared/js/content.js:9182)). The worker's landing check is skipped for resolution rows ([swBootstrap.js:564](../shared/js/swBootstrap.js:564), [573](../shared/js/swBootstrap.js:573)).
- The content-side route for canonical rows is closed: the worker refuses the guess with `not-profile-resolution-item` ([sw.js:32475](../shared/js/sw.js:32475)).
- A synthetic test pinned the conversion. "manual failed retry WAL moves resolver rows without leaving stale source key" started from a canonical row and asserted that it moved to a `resolve-profile:` key from the question. That is the wrong-target path, so the expectation was changed (below).

**Change made (the owner's rule, one guard).** `getFailedItemProfileResolutionRetryUrl` returns '' for any row that is not a resolution item and has its own link ([swCoordinatorJobEnvelope.js:188-193](../shared/js/swCoordinatorJobEnvelope.js:188)). A canonical row that fails to land is no longer converted into a resolution. Section 10 later stopped the automatic retry for such rows; a manual requeue still re-queues the same link. Resolution rows and rows without a link of their own are unchanged.
- The synthetic test above now asserts that the row stays on its own link, that no resolution key is written, and that recovery agrees.
- A unit test covers the guard: "a row with its own link is never retried as a resolution from its post, and resolution rows still are (review-5 R5-4)" in [test/acceptedReviewChanges.test.js](../test/acceptedReviewChanges.test.js).

**Decisions for the owner (answered in section 10)**
1. **After "did not land" on a canonical link.** (b) Retry the same link, up to the retry limit of 2, then end with an error. This is what the change does. (c) End the row at once, with no automatic retry. (c) needs a change to how that error is classed. Recommendation: (b), as the reviewer suggests.
2. **The scored scan on question pages** (revises section 8, decision 5). The guard closes the retry route for canonical rows. It does not reach resolution rows on question pages, which still use the scored scan ([content.js:9205-9206](../shared/js/content.js:9205)). Removing it from the queued path would have to cover question pages too. The question-block feature may depend on it when inline data is missing, and I have not measured how often that happens. Options: (a) keep it for question resolutions; (b) remove it for space posts only; (c) remove it for both, so an unresolved row takes no action.
3. **`maybeRedirectToOriginalPoster`** ([content.js:5427-5437](../shared/js/content.js:5427)) navigates to the scored guess when the URL has `mb_op=1`. The extension's own original-poster lookup adds that parameter ([content.js:3160-3161](../shared/js/content.js:3160)), so the navigation starts from the user. Whether an automatic action follows the landing is not traced. Owner: may a guess ever drive navigation?

**Verdict, revised.** One narrow live run, canonical links only, once this guard is in a build. Profile search stays out of that run. The other conditions in review 5 stand, plus: check the queue for profile-resolution rows left from older runs.

**Not verified.** What Quora does with a canonical link that does not land on a profile page (this decides whether the same-link retry runs in a live run); whether an automatic action follows the `mb_op=1` landing; and each retried row's later steps, since only the first step of each route was traced.

**Results (superseded by section 10).** `npm test`: 1,172 `ok`, 0 `not ok`, exit 0. Before this change it was 1,171; the count rises by one for the new unit test, and the synthetic test was rewritten rather than added. The five lint scripts exit 0. `lint:duplicates`: 42 clones, the baseline. `node test/swSynthetic.test.js "--filter=review-2"`: 15 `ok`, 0 `not ok`. Nothing was built, bumped, committed or reloaded.

## 10. Owner's answers (15 Oct)

Answers to section 9's decisions, and what was built. Nothing was built, bumped, committed or reloaded. The card and the counters appear in the extension after the next build.

1. **After "did not land": end the row (option c).** The owner: "if we don't land on a page, we're not gonna succeed on a retry." A queued tab that does not land on a profile page is no longer retried. `isRetryableJobFailure` in [jobState.js](../shared/js/jobState.js) returns false for that error. The automatic retry excludes the row ([sw.js:23474](../shared/js/sw.js:23474)), and the progress-based check agrees, because it falls back to the same rule. Once terminal, the row is archivable ([swCoordinatorStatusRules.js:95](../shared/js/swCoordinatorStatusRules.js:95)).
   Manual requeue is different. `REQUEUE_FAILED_ITEMS` does not filter by retryability, so the dashboard's requeue still re-queues a row like this, on the same link, because of the guard in section 9. I have not hidden that for these rows. Say if you want it hidden.
2. **Scored scan: kept, and measured.** A "Live checks" card sits in the Metrics section ([coordinator.js](../shared/js/coordinator.js), `buildLiveChecksCard`). Its value is the resolutions decided by the scored scan, out of all resolutions, and it alerts when that count is above zero. The detail counts:
   - resolutions by source (header, inline, explicit, listed, url), from `liveCheck.resolvedBy.<source>`, counted in the worker only when a resolution succeeds (`resolveQueuedProfileTarget` in [sw.js](../shared/js/sw.js)). A refused guess for a canonical row is not counted;
   - did not land, from `liveCheck.didNotLand`, reported by the content script when a tab does not land (`noteLiveCheck` in [content.js](../shared/js/content.js); the worker branch is `content-live-check` in [swBootstrap.js](../shared/js/swBootstrap.js));
   - redirect mismatch, `job.profileRedirectMismatch`; suffix-shadow changes, `suffixShadow.changed`; executor-start supersessions, `pump.executorStartSuperseded.*`; and claim retries, `contentClaimRetry.*`. These four were already counted.
   The counts say how often the scan decided a profile. They do not say whether it decided rightly. That needs a look at the rows.
3. **`maybeRedirectToOriginalPoster`: left for now.** It is on the revisit list, which is the owner's defer pile in memory (item 5, parked 15 Oct). The question is whether a guess may drive navigation at all. I have not traced whether an automatic action follows the `mb_op=1` landing.

**Changes in this pass**
- Code: `shared/js/jobState.js` (did-not-land is not retryable); `shared/js/content.js` (the resolver reports its source through an optional sink, in `getOriginalPosterProfileHref(sink)` and `getQueuedPageResolvedProfileHref(claimedAction, sink)`, and reports did-not-land; the resolve message carries `resolutionSource`); `shared/js/sw.js` (`liveCheck.resolvedBy.<source>`); `shared/js/swBootstrap.js` (the `content-live-check` measurement branch); `shared/js/coordinator.js` (the card).
- Tests: the synthetic test in `test/swSynthetic.test.js` now expects no retry for a row that did not land (section 9 had it expecting a same-link retry). `test/p1-contract.test.js` gains `content-live-check` in its action list, loads `noteQueuedResolution` in the resolver harness, and updates one source pin to the new return line. `test/acceptedReviewChanges.test.js` gains three cases: the retry rule, the counter and card wiring, and the resolver's source.

**Results.** `npm test`: 1,175 `ok`, 0 `not ok`, exit 0 (1,172 before the three new cases). The five lint scripts exit 0. `lint:duplicates`: 42 clones, the baseline. `node test/swSynthetic.test.js "--filter=review-2"`: 15 `ok`, 0 `not ok`.
- R4-7, the page-data scan on a real page (live run).
- The reviewer's "verified sound" items (settings type check, dashboard timer, the clear's last pass, the landing check). This pass changed none of them.
