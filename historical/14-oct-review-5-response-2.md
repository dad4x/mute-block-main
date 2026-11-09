# Reviewer response to section 9 and section 10 of the review 3 reply

> **Status: HISTORICAL** (24 Oct 2026). Reviewer response, round 2 (15 Oct). Archive rule for non-retryable rows. The dry-run item R5-2 is open. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

This checks [14-oct-review-3-reply.md](14-oct-review-3-reply.md), sections 9 and 10, against the code. It is a new file. Nothing in the repo was changed by this check, and nothing was built, bumped, committed or reloaded.

## Results

- `npm test` (fresh run): 1,175 `ok`, 0 `not ok`, exit 0. This matches section 10.
- Lints `correctness`, `queue-boundary`, `block-classification`, `queue-storage-layering` and `no-outside-writes`: exit 0 each.
- `node test/swSynthetic.test.js "--filter=review-2"`: 15 `ok`, 0 `not ok`.

## The R5-4 finding is closed in the code

- **The guard.** `getFailedItemProfileResolutionRetryUrl` returns `''` for a row that is not a resolution and has its own link ([swCoordinatorJobEnvelope.js:188-196](../shared/js/swCoordinatorJobEnvelope.js:188)). It runs before the question and post-URL helpers, so no route reaches a source post from a canonical row through it.
- **No bypass.** The helpers are called only from `getFailedItemProfileResolutionRetryUrl`. The callers are `sw.js:23814`, `swCoordinatorRetryCandidates.js:119` and `:160`. I found no direct call to `getFailedItemQuestionResolutionUrl` or `getQuestionResolutionUrlFromEvidencePostUrl` outside the guarded function.
- **The terminal rule.** `isRetryableJobFailure` returns false for "did not land on a profile page" ([jobState.js:685-693](../shared/js/jobState.js:685)). The retry candidate filter uses that rule ([swCoordinatorRetryCandidates.js:126](../shared/js/swCoordinatorRetryCandidates.js:126)), so the automatic retry excludes the row.
- **Archiving.** A non-retryable terminal row is archivable at once ([swCoordinatorStatusRules.js:95-99](../shared/js/swCoordinatorStatusRules.js:95)).
- **The test.** `test/swSynthetic.test.js:4475` and the three cases at [test/acceptedReviewChanges.test.js:527-552](../test/acceptedReviewChanges.test.js:527) pin the behaviour. Before this change, no test covered the policy (my review 5 response noted that).

## The live-check wiring is correct

- The content script reports a row that did not land through `noteLiveCheck` ([content.js:11427](../shared/js/content.js:11427), called at [11650](../shared/js/content.js:11650)). The worker counts it under `liveCheck.didNotLand` ([swBootstrap.js:890-893](../shared/js/swBootstrap.js:890)).
- The resolve message carries `resolutionSource` ([content.js:11698](../shared/js/content.js:11698)). The worker counts `liveCheck.resolvedBy.<source>` only after `result.resolved === true` ([sw.js:32741-32744](../shared/js/sw.js:32741)), so a refused guess is not counted.
- The card ([coordinator.js:2402-2436](../shared/js/coordinator.js:2402)) reads those counters and alerts when the scored count is above zero.

## One question the reply does not answer

The non-retryable rule is a text match. `isRetryableJobFailure` checks the "did not land" text before it looks at the row's kind. So a source-post **resolution** row that does not land is also ended, not retried. Before this change it was retried. Section 10 presents the rule as general, so the reading is probably intended. Please confirm it, because it is a behaviour change for resolution rows too, and it is not in the reply's list of changes.

## Notes for the live run

- **The stop rule.** For a canonical-only run, `liveCheck.resolvedBy.scored` must stay at zero. Any non-zero count means a row was decided by a keyword scan of a page. Stop the run and read the rows. The card's alert will fire on it.
- **Expected alerts.** Any run that includes resolution rows (asset-space low-confidence artifacts, or retests) will show scored counts. That is expected, but it is not a canonical-only run.
- **Refused guesses.** On a question page, a canonical row still sends the scored guess to the worker, which refuses it with `not-profile-resolution-item` ([sw.js:32475](../shared/js/sw.js:32475)). No action follows, and the refusal is not counted. The row ends under "did not land", which is counted, so the run still shows the event.
- **Manual requeue.** `REQUEUE_FAILED_ITEMS` can still requeue a did-not-land canonical row on the same link. Section 10 discloses this. The run should not requeue such a row unless the owner has decided to try the link again.

## Verdict, revised

The R5-4 blocker is closed in the code. The conditions for one narrow live run, canonical links only, are now:

1. The build, with a version bump, in which these changes are included. This is the owner's call.
2. The owner's past-block audit (R4-4).
3. Profile search out of the run (review 5, R5-1).
4. The queue checked for profile-resolution rows left from older runs (section 9).
5. The stop rule on `liveCheck.resolvedBy.scored` in place (above).
6. One question answered: the non-retryable rule for resolution rows (above).

## Not verified here

- What Quora does with a canonical link that does not land on a profile page. The live run will show this as "did not land" counts.
- The live queue. I did not read the queue for older resolution rows.
- Whether an automatic action follows the `mb_op=1` landing (section 10, item 3, deferred).
