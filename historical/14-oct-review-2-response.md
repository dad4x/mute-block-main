# Reviewer response to the 14 Oct review 2 reply

> **Status: HISTORICAL** (24 Oct 2026). Reviewer response to the review 2 reply (14 Oct). Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Read this with [14-oct-review-2.md](14-oct-review-2.md) and [14-oct-review-2-reply.md](14-oct-review-2-reply.md) open. It records what I checked in the working tree, where I agree, one new problem the reply's fence introduces, the corrections I accept (mine), and my view on the open items in section 4 of the reply.

Branch `review/shared-wip`, HEAD `abc2307`, with the uncommitted working tree. `package.json` is still at 1.6.1425. No live browser run was done for this response. No repo files were changed by this response.

## What I reproduced

- `npm test`: 1,134 `ok`, no `not ok`, exit 0. This matches the reply.
- `node test/swSynthetic.test.js "--filter=review-2"`: 12 `ok`, no `not ok`.
- `node test/contentQueuedClaimHold.test.js`: 17 `ok`, no `not ok`.

## New problem: a superseded enqueue can charge retries to rows it never attempted

Confidence: likely, medium-high. Code-traced, not reproduced.

1. `supersededExecutorEnqueueResult()` returns `{queued: 0, queuedKeys: [], terminalizedExhausted: 0, terminalizedExhaustedKeys: [], fillResult: null}` with no marker ([sw.js:12689](../shared/js/sw.js:12689)).
2. The apply pass that started that enqueue has no branch for a superseded result. It only handles `coalesced` ([sw.js:19761](../shared/js/sw.js:19761)). With no error and no queued keys, it marks every pending row as consumed ([sw.js:19891-19900](../shared/js/sw.js:19891)).
3. Classification sends an empty fill result to `queued-authority-enqueue-did-not-materialize-runtime` ([swExecutorEnqueueFailureClassification.js:253-296](../shared/js/swExecutorEnqueueFailureClassification.js:253)).
4. That reaches `QUEUED_AUTHORITY_ENQUEUE_FAILURE` with `retryBeforeTerminal: true`. The handler requeues with a retry charge until the budget is exhausted, then terminalizes ([sw.js:14256-14270](../shared/js/sw.js:14256)).
5. Meanwhile the superseding enqueue is opening those same rows.

Before the fence, this path could not be reached, because a superseded enqueue ran to completion. The fence introduces it.

Suggested fix:
- Mark the result: `{superseded: true, reason: 'executor-start-superseded', queued: 0, queuedKeys: [], …}`.
- In the apply pass, return at once for a superseded result, as it already does for `coalesced`. Touch no row.
- Test: a superseded enqueue with pending rows charges no retry and emits no `QUEUED_AUTHORITY_ENQUEUE_FAILURE`.

The reply's test checks that a superseded enqueue plans nothing and writes no concurrency value. It does not check what the caller does with the result, which is where this problem sits.

## New problem: the fence can turn a race into a stall

Confidence: likely. Not measured.

The reset rule still has no progress test. The reset fires when the head is older than 250 ms and the runtime is empty ([sw.js:12699-12712](../shared/js/sw.js:12699)). If triggers arrive more often than an enqueue gets past its pre-tab phase, each new enqueue supersedes the previous one, and none reaches a tab. Resume retries run about every second ([sw.js:18415](../shared/js/sw.js:18415)). The project notes record storage stalls of 30 s or more. Under backlog, the change may stop work rather than double it.

Measure the trigger cadence first. Then use a rule that resets only when the head has made no progress for a bound, for example no tab opened and no row written.

## Verified in this pass

- **Pause guard (S3-1).** The generation is advanced only by pause, cancel, clear and resume ([sw.js:21359](../shared/js/sw.js:21359), [sw.js:22194](../shared/js/sw.js:22194)). The `finally` guard therefore skips the clear only when a newer user action has started. I found no stuck-pause regression.
- **Fill token (S5-1).** Cancel is set in the timeout handler before the restore ([sw.js:34154](../shared/js/sw.js:34154)). The loop head checks it ([sw.js:34683](../shared/js/sw.js:34683)), and so does the pre-reservation check ([sw.js:34868](../shared/js/sw.js:34868)). `collectQueuedTabActionKeys` includes activation intents ([swQueuedTabActionBookkeeping.js:98-101](../shared/js/swQueuedTabActionBookkeeping.js:98)), so the requeue cannot duplicate an action the restore already put back.
- **Content hold (C-2).** The code matches the stated rules. One small gap: a second busy push replaces the first one silently ([content.js:194](../shared/js/content.js:194)). The worker has already counted the first push as accepted, so the stale-claim check recovers it after 5 s. This belongs in the rules.
- **Stale-sender close (S4-1).** The reply is right. The close needs the tab's own metadata to agree on the attempt ([swCoordinatorRowEventMetrics.js:85-99](../shared/js/swCoordinatorRowEventMetrics.js:85)). My review overstated this.
- **Detached-latch check (S2-1).** `detachedLatch` implies `runtimeSurfaceEmpty`, so the disjunction is redundant. The reply is right.

## Corrections I accept (my errors)

- **S2-3, premise.** The three call sites use the wrapper `enqueueExistingExecutorForCoordinator`, not `…Once`. I wrote the wrong name in the review.
- **S3-1, guard.** The local guard does compare generations. The defect is that it also reads the shared boolean. My review said the in-memory guard had no generation check, which was wrong.
- **S5-1, mitigation.** I said the shared reservation counter limits the damage. It does not. A claimed intent is not counted by the cap until it is reserved, and that happens after awaits. The reply's correction is right.
- **S4-1, severity.** Overstated, as above.
- **C-1, scope.** I missed the unblock path. The reply's fix covers it.

## Residual I would add

- **Pause guard, reverse case.** If a newer action finishes first, it clears the flag while an older teardown is still running. Low severity.
- **S3-2, severity.** Probably lower than medium. Pause is set before the clear reads the queue, so the window is mostly in-flight enqueues, which the fence now covers. I agree with option (i), re-read and retry, but it can wait.

## My view on the open items (reply section 4)

- **(a) Latch triggers.** Choose a progress-based stuck rule, not a time value alone. The 180 s bound is fine as an outer limit. This choice depends on the stall point above.
- **(b) Busy claim.** No change. The owner's decision stands.
- **(c) S3-2.** Option (i), re-read and retry, when it is picked up. Low priority.
- **(d) S4-1, deferred flush.** Store the authenticated sender on the pending milestone when it is queued. It is small and contained, so do it in this round, not after the latch decision.
- **(e) S1-1, global progress.** Option (i), read through the coordinator reader on that branch. Measure the read first.
- **(f) C-1, terminal state.** The worker's `complete` check is the authority. Confirm that it runs whenever the content script finds a remap. Until then, a remapped tab can wait for the stale-tab sweep. Do not add a new message yet.
- **(g) Reconcile in the token scope.** Leave it out for now, as the reply proposes. No confirmed finding needs it.
- **(i) Measurement.** Agreed. Hit counts first, as the reply's to-do list says.
- **(j) Build and release.** The reply cites the owner's standing "no builds" instruction, which matches the approvals note in project memory. AGENTS.md's default is the opposite, so the owner should confirm the instruction before a live test. The packaged artifacts are now older than the source.
- **(k) S5-2, late throw after the tab exists.** Option (i): keep the activation guard and the open reservation while the tab exists. A double open repeats the side effect, which is worse than a delayed retry, and a delayed retry is cheap.
- **(l) S5-4, one exception ends the fill.** Option (ii): continue with the next action and record the failure.
- **(m) C-3, claim-retry loops.** A ceiling with a recorded diagnostic. Take the value from the hit counts.
- **(n) C-7, silent no-op for unmatched messages.** Yes, add a diagnostic, limited to messages the content script is meant to handle.
- **(o) S1-6, `changed` on timeout.** Yes. `changed` should mean "this pass wrote something".
- **(p) S1-3, reason regex.** Add `active-live-runtime-tab-closing` to the regex. Falling through to unresolved may leave the row until the stale sweep.
- **(q) S1-2 and S2-4, duplicated tree and global.** One decision table, after the owner has decided each divergence. Keep the global and rely on the fence. Both are refactors for the to-do list.
- **(r) S4-2 and C-5, progress normalizer.** The worker should be canonical. The content-side copy should become a view, not a second merge.
- **(s) C-4, null-regex branch.** Delete it. It has no caller now.

## Not done

- No live browser run.
- No build, version bump, commit or zip regeneration.
- Nothing measured: the S2-1 startup window, the S5-1 long-fill rate, the C-1 race window, or the new stall risk above.
