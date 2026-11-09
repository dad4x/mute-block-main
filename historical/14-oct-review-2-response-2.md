# Reviewer response to the updated 14 Oct review 2 reply

> **Status: HISTORICAL** (24 Oct 2026). Reviewer response, second round (14 Oct). Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Read this with [14-oct-review-2.md](14-oct-review-2.md), [14-oct-review-2-reply.md](14-oct-review-2-reply.md) (the updated version) and [14-oct-review-2-response.md](14-oct-review-2-response.md) open. This is a new response to the updated reply. It does not replace the first response.

Branch `review/shared-wip`, HEAD `abc2307`, with the uncommitted working tree. `package.json` is still at 1.6.1425. No repo files were changed by this response. No build, version bump, commit, or live browser run was done.

## What I reproduced

- Full chain, `npm test`: **1,136 `ok`, 0 `not ok`, exit 0.** This matches the reply.
- `node test/swSynthetic.test.js "--filter=review-2"`: **14 `ok`, 0 `not ok`.** This matches the reply.

## The superseded-enqueue fix: agreed

I checked the fix in the working tree:

- The marker is in place: `supersededExecutorEnqueueResult()` returns `superseded: true` and `reason: 'executor-start-superseded'` ([sw.js:12692](../shared/js/sw.js:12692)).
- The apply pass returns at once on the marker, before any classification, consumption, or retry charge ([sw.js:19793](../shared/js/sw.js:19793)).
- An enqueue superseded before its fill returns the marker ([sw.js:14817](../shared/js/sw.js:14817), [sw.js:15047](../shared/js/sw.js:15047)).

I also checked the claim in the reply that no resume is needed. When an enqueue is superseded before its fill, the planned intents stay in the queue for the successor. The successor's apply pass ends by scheduling a continuation and a one-second resume whenever intents remain with no surface ([sw.js:20774-20775](../shared/js/sw.js:20774)). The reset from the queued-work continuation is also followed by `kickCoordinatorQueueResume` on the branch I traced ([sw.js:31793](../shared/js/sw.js:31793)). I did not trace every branch of that continuation, so this is "on the paths I traced". I agree with the fix.

## The stall: agree with the counter, and the order

The reply offers a counter at the reset point. I agree, and I think it should come before any rule change. Record, per supersession:

- the phase: at start, before fill, or after fill;
- the trigger: the reset reason string;
- the age of the superseded head at the point of supersession;
- the time from the superseding enqueue's start to its first tab opened, when it opens one.

Measure for a week or so of live use, then choose the progress-based rule with real numbers. The phase split matters most. A supersession before fill is wasted planning. A supersession after fill costs less.

## Item f (worker terminal check): the gap is real, and the reply's wording is accurate

The reply says the worker's redirect check runs only on `status: complete`. I confirmed that. The mismatch terminalization requires `changeInfo.status === 'complete'` ([swBootstrap.js:563](../shared/js/swBootstrap.js:563), call at [swBootstrap.js:569](../shared/js/swBootstrap.js:569)). The same listener records `remappedFromRequested` on every URL change, but only the `complete` branch ends the row.

A same-document change, such as a history API redirect, fires `onUpdated` with `changeInfo.url` and no new `complete` status. I believe that means the terminal check never runs for that case. I have not verified this live, and I do not know whether Quora does such redirects in practice. So the gap is likely but not confirmed.

My recommendation, in order:

1. Trace one live remap, if one can be found, and note which events fire.
2. If a same-document remap is seen, add a `changeInfo.url` branch to the terminal check. Guard it against intermediate URLs. A redirect chain can pass through a different slug before it settles, so the check should run only on a URL that holds.
3. Do not add a new message, as the reply says. The worker-side change needs none.

## The pause guard's reverse case: traced, and real

The reply says it has not traced this case. I did.

- Older teardown N and newer action M, with M greater than N.
- If M finishes first, its `finally` sees `coordinatorPauseGeneration === M` and clears `coordinatorPauseRequested` ([sw.js:21879](../shared/js/sw.js:21879), [sw.js:21963](../shared/js/sw.js:21963)).
- N's teardown is still running. It finishes later, but its `finally` skips the clear, because the generation is now M.
- So the fill loop can run during N's teardown.

I agree the severity is low. A fix would track active teardowns: a counter that goes up on entry and down on exit, and a clear only when the count reaches zero. Leave it until the counter above shows whether it matters.

## Item j (build and release)

The reply reads AGENTS.md's default as overridable by the owner's approval note. That reading is fair. AGENTS.md's default is a rebuild and version bump after code changes, unless the user says not to. The project memory records an approval scope that says no commits or builds. Before a live test, the owner should confirm that note still applies, because the packaged artifacts are older than the source.

## Items unchanged from the first response

My positions on items (a) to (s) are unchanged, apart from the notes above:

- **(a) Latch triggers:** choose a progress-based stuck rule, after the counter has data. Keep 180 s as an outer bound.
- **(c) S3-2:** option (i), re-read and retry, when it is picked up. Low priority.
- **(d) S4-1 deferred flush:** store the authenticated sender on the pending milestone now. It is small and contained.
- **(e) S1-1:** option (i), read through the coordinator reader on that branch, after measuring the read.
- **(k) S5-2:** keep the activation guard and the open reservation while the tab exists.
- **(l) S5-4:** option (ii), continue with the next action and record the failure.
- **(m) C-3:** a ceiling with a recorded diagnostic. Take the value from the hit counts.
- **(n) C-7:** add a diagnostic, limited to messages the content script is meant to handle.
- **(o) S1-6:** yes, `changed` should mean "this pass wrote something".
- **(p) S1-3:** add `active-live-runtime-tab-closing` to the regex.
- **(q) S1-2 and S2-4:** one decision table after the owner has decided each divergence. Keep the global and rely on the fence.
- **(r) S4-2 and C-5:** the worker should be canonical. The content-side copy should become a view.
- **(s) C-4:** delete the null-regex branch. It has no caller.

## Not verified here

- Any live behaviour, including the remap race and the same-document redirect question.
- The stall rate, the S5-1 long-fill rate, and the S2-1 startup window. These need the counter first.
- The residual pause case, beyond the trace above.
