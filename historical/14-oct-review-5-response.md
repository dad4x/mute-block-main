# Reviewer response to the review 5 check (section 8 of 14-oct-review-3-reply.md)

> **Status: HISTORICAL** (24 Oct 2026). Reviewer response to the review 5 check (15 Oct). Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

This answers [14-oct-review-3-reply.md](14-oct-review-3-reply.md), section 8, which checks [14-oct-review-5.md](14-oct-review-5.md). It is a new file. Nothing in the repo was changed, and nothing was built, bumped, committed or reloaded.

## Summary

Most of section 8 holds. Section 7, decision 1 now says the profile-search fold is NFKD, so fullwidth links match the query. That is the R5-1 correction.

Two things do not hold:

1. **R5-4 is not narrower.** The reply says the resolver is reached only through the stored flag. That is true for the normal path. It is not true for a retry. A canonical row that fails with "did not land on a profile page" is retried as a resolution from its source post, and the canonical href is dropped. I missed this path in review 5. The reply's "overstated" rests on a trace that stopped at the flag.
2. **The verdict changes.** My review 5 said one narrow run, canonical links only. That is not safe while the retry path can turn a canonical row into a guess. A canonical row can then block the profile the scored scan picks from its post.

## Corrected finding: a canonical row can be retried as a guess (R5-4, high for the canonical run)

The chain, all read from the code:

1. **Candidate and retry.** `getFailedItemProfileResolutionRetryUrl` ([swCoordinatorJobEnvelope.js:188-196](../shared/js/swCoordinatorJobEnvelope.js:188)) returns a URL before it asks whether the item already has an href. Two inputs can produce one:
   - the error names a question (`question: /path`, [swCoordinatorJobEnvelope.js:164-166](../shared/js/swCoordinatorJobEnvelope.js:164));
   - the error says "did not land on a profile page" and the evidence has a `postUrl` ([swCoordinatorJobEnvelope.js:178-182](../shared/js/swCoordinatorJobEnvelope.js:178)).
2. **The retry drops the href.** The retry candidate keeps any row with a resolution URL ([swCoordinatorRetryCandidates.js:119](../shared/js/swCoordinatorRetryCandidates.js:119), [125](../shared/js/swCoordinatorRetryCandidates.js:125)). `retryViaResolution` then sets `href = ''` ([swCoordinatorRetryCandidates.js:161-163](../shared/js/swCoordinatorRetryCandidates.js:161)) and `resolveProfileFromPage: true` ([207](../shared/js/swCoordinatorRetryCandidates.js:207)). The canonical link is gone from the row.
3. **The error is retryable.** A non-profile landing is abandoned with status `error` ([content.js:11618-11631](../shared/js/content.js:11618)). `jobState.js:212` maps status `error` to outcome `action-error` unless the text mentions a timeout or stale, and `jobState.js:689` treats `action-error` as retryable. The "did not land" text matches neither, so the outcome decides it.
4. **Canonical space-feed rows carry the post URL.** The profile association's evidence includes `postUrl` ([content.js:9519-9524](../shared/js/content.js:9519)), and the enqueue sends it as `evidence` ([content.js:9748](../shared/js/content.js:9748)).
5. **The retry runs on the source post.** On a target space-post page, `getQueuedPageResolvedProfileHref` returns the post header's profile, then the scored scan ([content.js:9182-9203](../shared/js/content.js:9182)). On a question page it returns the scored scan ([content.js:9205-9206](../shared/js/content.js:9205)). The worker now accepts the row, because it is a resolution row, and the action runs on the chosen profile.

Nothing on this path compares the chosen profile with the original link. The worker's landing check is skipped for resolver rows ([swBootstrap.js:564](../shared/js/swBootstrap.js:564), [573](../shared/js/swBootstrap.js:573)), so the original link is never checked.

**The other route is closed.** The content side also tries the scored scan directly for a canonical row on a question or space-post page ([content.js:11647-11668](../shared/js/content.js:11647), [12011-12012](../shared/js/content.js:12011), [12150-12151](../shared/js/content.js:12150)). The worker refuses it with `not-profile-resolution-item` ([sw.js:32475](../shared/js/sw.js:32475)), so the tab falls through to the error and to the retry above.

**No test covers the policy.** `p1-contract.test.js:2982-2991` checks that the retry wiring exists, not that a row with its own href is never turned into a resolution. `swSynthetic.test.js:13473` checks the progress text only.

**Consequence.** If Quora lands a canonical link on a non-profile page, the row can end up blocking a profile the scored scan picked from its post. Whether Quora does that is not verified. It is the wrong-target path the owner's rule forbids, and the first canonical run could reach it.

**Options (terminal-state choices, for the owner):**

- **(a) Never convert a row with its own href.** `getFailedItemProfileResolutionRetryUrl` returns `''` when the item has an href. This removes the guess and is needed under any option. I recommend it as the first change.
- **(b) Retry the same link.** With (a) in place, the row keeps its link and uses the existing retry count (`SOFT_FAIL_RETRY_LIMIT`, 2). I recommend this if you want the retry at all.
- **(c) End the row.** No automatic retry after "did not land". This is the strictest option.

## Decision 5 in section 8 (the scored scan) needs one addition

Option (b) of the reply's decision 5, removing the scored scan from the queued path, does not close the retry route, and it does not cover question pages. The scored scan is also called for queued resolutions on question pages ([content.js:9205-9206](../shared/js/content.js:9205)). Removing it from the queued path alone would leave the retry route in place. The change has to cover the retry route too, which is option (a) above.

## A caller the reply does not list

`maybeRedirectToOriginalPoster` ([content.js:5427-5437](../shared/js/content.js:5427)) calls the scored scan on a question-log page and then runs `location.replace` to the guessed profile. It runs only when the URL has `mb_op=1`, which the extension's own "Open the original poster profile" link adds ([content.js:5382](../shared/js/content.js:5382), [3160-3161](../shared/js/content.js:3160)). So it is user-initiated, and it is not on the queued path. I did not trace whether an automatic action runs after that landing. The owner should decide whether a guess may drive navigation at all.

## Other section 8 verdicts

| Item | Verdict here | Basis |
|---|---|---|
| R5-1 profile-search fold | Agree. Section 7, decision 1 now says NFKD (line 237). | Read. |
| R5-2 landing check, URL only | Agree. The worker check is skipped for resolver rows (see the corrected finding). | [swBootstrap.js:564](../shared/js/swBootstrap.js:564), [573](../shared/js/swBootstrap.js:573). |
| R5-3 medium explicit links | Agree. | [content.js:7482](../shared/js/content.js:7482), [7485](../shared/js/content.js:7485), [5714-5718](../shared/js/content.js:5714). |
| R5-4 name-less posts | **Disagree.** See the corrected finding. | As above. |
| R5-5 two low points | Agree. | [content.js:5616](../shared/js/content.js:5616), [5556-5557](../shared/js/content.js:5556). |
| R5-6 signals not on a card | Agree. | No `suffixShadow` in the coordinator files. |
| R5-7 dry run not built | Agree. | Only classification comments match. |
| R5-8 items | Agree. Whitespace is untrimmed. | [subject.js:26](../shared/js/subject.js:26). |
| Verified-sound ranges | Not checked. | |

## Verdict, revised

The review 5 verdict stands with one addition. "One narrow live run, canonical links only" needs this in its conditions:

- Fix (a) in place, so a row with its own href is never retried as a resolution. Without it, a canonical run can block a scored guess.

The rest of "Before any live run" in review 5 stands: the build, the owner's past-block audit, profile search out of the first run, and one link at a time with the landed href read before each click.

## Not verified here

- What Quora serves for a canonical link that does not land on a profile page. That decides whether the retry path is reached in a live run.
- Whether an automatic action runs after the `mb_op=1` landing.
- Whether a retried row's later steps match the original request in any other way. I traced the first step of each route, not every later one.
