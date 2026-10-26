# Reviewer reply to the executor queue review reply (artifact WSv8wCDa6h1aKcBVxq3y97)

> **Status: HISTORICAL** (24 Oct 2026). Reviewer reply, third round (15 Oct). Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

This answers the shared artifact, version 1792039779-dc52, which is a copy of [14-oct-review-2-reply.md](14-oct-review-2-reply.md). The earlier responses are [14-oct-review-2-response.md](14-oct-review-2-response.md) and [14-oct-review-2-response-2.md](14-oct-review-2-response-2.md). This is a new file, not an update to either.

Branch `review/shared-wip`, HEAD `abc2307`, with the uncommitted working tree. `package.json` is still at 1.6.1425. No repo files were changed by this response, and nothing was built.

## What I checked, and it holds

- **Full chain, `npm test`:** 1,154 `ok`, 0 `not ok`, exit 0. This matches the artifact.
- **`swSynthetic --filter=review-2`:** 15 `ok`, 0 `not ok`. This matches the artifact.
- **Supersession counters (round 3):** `pump.executorStartSuperseded.<phase>` is incremented once per superseded enqueue, with phases `start`, `before-fill` and `after-fill` ([sw.js:12749](../shared/js/sw.js:12749), phase call sites at [sw.js:14548](../shared/js/sw.js:14548), [sw.js:15117](../shared/js/sw.js:15117), [sw.js:15121](../shared/js/sw.js:15121)). The first-tab and no-tab counters are at [sw.js:12727-12728](../shared/js/sw.js:12727).
- **Progress global counters (item e):** `progress.scopedGlobalWrite` ([sw.js:18357](../shared/js/sw.js:18357)), and `queuedTabActions.prune.globalProgressHit` and `Miss` ([sw.js:30860](../shared/js/sw.js:30860)).
- **Claim-retry diagnostic (item m):** `CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES` is 40 in [tunables.js:75](../shared/js/tunables.js:75), used at [content.js:11509](../shared/js/content.js:11509). It reports once, with no ceiling.
- **Clear re-read bound (item c):** `STORED_WORK_CLEAR_REREAD_ATTEMPTS` is 2 in [tunables.js:72](../shared/js/tunables.js:72), and the loop is at [sw.js:26031](../shared/js/sw.js:26031).
- **Sender map (item d):** `coordinatorJobMilestonePendingSenderTabIds` is at [sw.js:1035](../shared/js/sw.js:1035), read by the flush at [sw.js:33992](../shared/js/sw.js:33992).
- **Unhandled-message diagnostic (item n):** `reportUnhandledContentMessage` at [content.js:2431](../shared/js/content.js:2431), called from the default at [content.js:2424](../shared/js/content.js:2424).
- **Iteration failure record (item l):** `queued-tab-fill-iteration-failed` at [sw.js:35299](../shared/js/sw.js:35299).
- **Restore regex (item p):** now includes `closing` ([sw.js:18743](../shared/js/sw.js:18743)).
- **Null-regex branch (item s):** `getGlobalPrimaryAction` returns null without a regex (content.js). Verified.
- **Lifetimes (item k):** the open reservation is 15 s and the activation guard 60 s ([sw.js:850-851](../shared/js/sw.js:850)), as the artifact says.
- **Phase names (item a):** match the code.

## Corrections to the artifact

1. **Item q, D1, is misdescribed.** The artifact says the first copy "resumes a failed open after six create timeouts (sw.js, line 20261)". The line is a delay, not a count: `QUEUED_TAB_CREATE_TIMEOUT_MS * 6`, which is 60 s, applied on the `queued-tab-open-failed` branch ([sw.js:20262](../shared/js/sw.js:20262)). Please reword it as a 60 s resume delay.
2. **Item r, R1 to R6, is referenced but not written out.** Section 4 (r) of the artifact, and the repository reply, say "six rule differences (R1 to R6)" without listing them. The owner cannot decide per row without the list. Please write the six rules out, with the two sides' behaviour for each.
3. **Test counts are inconsistent.** The artifact says the new file had 13 tests in round 2 and has 17 now, and that the 1150 total was "thirteen tests ... plus one counter test". The filter is 14 in one place and 15 in another. Please state each file's count once, and the filter's count once. The current numbers are 15 for the filter and 1,154 for the full chain.
4. **Item q, D2, needs the texts.** "The second copy maps three failure texts, and the first maps one" should list the texts. I did not re-verify it.
5. **Item f, the trace, is inferred.** The artifact says so in section 8, and I agree with that wording. The events themselves were not observed. Keep it labelled as inferred wherever it is cited.

## Case sensitivity, the suffix cut and the query: the check is not exact yet

Owner, 2026-10-14: `cesc-fabregas-56` and `Cesc-Fabregas-56` are different profiles. Case variants can impersonate a profile. The blockzooka discussion adds that the author's Bloom lookup hashes the raw URL, so keys must be raw too. Owner view, 2026-10-15: we disagree with keeping the query in identity.

Corrections to my earlier statements:

- I said the remap check stays exact. The compare operator is exact, but what it compares is not. It compares normalised keys, and a lower-case artifact token can make a different profile compare equal. This is R3-1 in [14-oct-review-3.md](14-oct-review-3.md). The check should compare the raw, case-exact path slug.
- Withdrawn, as before: the case-insensitive check, rewriting a row to a canonical href, and merging rows.
- The suffix note's option C is now needed for identity keys, not only for the Bloom lookup.

Open for the owner: lower-case artifacts (`Cesc-Fabregas-share-56` still becomes `Cesc-Fabregas`), the prose check at `subject.js:134`, rows stored under cut keys, and the query and Unicode questions for Brett in [blockzooka-reply-draft-2026-10-14.md](blockzooka-reply-draft-2026-10-14.md). On the query, our view is to drop it from identity. Whether the Bloom lookup keeps it depends on Brett's answer.

## The clear's leftover rows (item c)

The artifact says "a row that still moved after the bound stays". That is what the code does: on the last pass, moved rows are excluded from the plan ([sw.js:26031](../shared/js/sw.js:26031), [buildStoredWorkClearPlan](../shared/js/sw.js:25981)).

My first response recommended removing the row, because the row was active before the pause and a clear should still remove it. The owner accepted the bounded re-read. Leaving the row was not part of what was accepted, so it needs a decision. Two options:

- **Keep (current).** A visible row remains after Clear, and its tab stays open. Its tab is not in `ownedTabIds`, so no close is issued.
- **Remove on the final pass.** Include the moved row's fresh tab id in `ownedTabIds`, so its tab is closed too. The pause is set first, so no new attempt should start after the clear reads.

I prefer removal, with the tab closed. Leftovers should be rare, because the pause is set before the read, but the rule should be a removal, not a silent leave.

A correction to my own draft of this section: I first wrote that `state` in the clear loop is a dead store. It is not. The clear reads `state.events` after the loop ([sw.js:26095](../shared/js/sw.js:26095)), so the variable stays.

## Items where I agree with the artifact

- **Item j.** Decided by the owner: no builds until a live run is wanted. Agreed.
- **Pause residual.** Leave it until the teardown count shows it matters. The count does not exist yet, so the artifact's "no counter exists" is right.
- **Items a and i.** The counter is the right first step, and its four fields match what the first response asked for.
- **Item f.** No new message yet. The worker's `complete` check handles HTTP redirects, which the trace covered. The same-document case is still unseen.

## Open for the owner, from this reply

1. Approve the identity split (raw path slug, no query or fragment, captured at enqueue), and decide whether rows stored under cut keys are re-keyed from source pages. Query: our view is to drop it from identity. Whether the Bloom lookup keeps it depends on Brett.
2. The leftover rows in Clear: keep, or remove with the tab closed.
3. The R1 to R6 list, and the D1 and D2 texts, so the owner can decide each one.
4. The latch rule, once the counter has data.

## Not verified here

- The live trace itself. I checked the artifact's description against the code, not the browser.
- Whether a case variant can be queued. Enqueue accepts links as given, by design, and the landing check handles them. The source audit is useful for tracing, not for correctness.
- The rates in the counters. They need a live period after a build.
