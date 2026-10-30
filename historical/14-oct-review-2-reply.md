# Reply to 14 Oct review 2

> **Status: HISTORICAL** (24 Oct 2026). Reply to review 2 (14 Oct). Section 8 holds each item's status. Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Read this with [14-oct-review-2.md](14-oct-review-2.md) open. It sets out what I checked against the code, what I corrected in the review, what changed in this pass and how it is tested, and what is still open for discussion between the owner and the reviewer (section 4).

Branch `review/shared-wip`, HEAD `abc2307`, with the uncommitted working tree. `package.json` is still at 1.6.1425. Nothing here has been built, versioned, committed, reloaded in a browser, or measured live.

## Decisions so far

- **Owner:** the cancellation token is accepted for the findings it fixes. Those are S2-1 and S2-2 (a fence on the executor-start enqueue) and S5-1 (a token on the queued-tab fill). S3-1 is fixed with a generation guard, which is the same idea without a new token.
- **Owner, 2026-10-14:** define every timeout and threshold symbolically in one place, with the others. The owner has no view on the values yet. Hit counts come first, and the timeout counts go on the dashboard. All three are on the to-do list in [planning.md](../planning.md), and the review cycle finishes first.
- **Owner, 2026-10-14:** the busy claim (item b) is held on the content side. Implemented and tested in this pass (section 4b).
- **Reviewer's response:** [14-oct-review-2-response.md](14-oct-review-2-response.md) is in. Section 7 records what we did with it. It found a regression in our fence, which is fixed (section 3.1).
- **Owner, 2026-10-14 (later):** accepted all the reviewer's suggestions and approved a remap trace. Section 8 has each item's status: done, tested, or gated.
- **Owner, 2026-10-14 (item j):** no version bump, build, zip regeneration or live reload until the owner calls a live run. Item j is decided.
- **Open:** the gated items in section 8. The other discussion items in section 4 are decided.

## 1. Verdicts on the high-impact claims

Each verdict is against the code as it stands now. Line numbers are current; search by name if they move again.

| Claim | Verdict | Evidence | This pass |
|---|---|---|---|
| **C-1** remapped queued tab can block or mark another profile | **Confirmed.** Also true on the unblock path, which the review did not name. | Before this pass, the mute-block path recorded the remap and then carried on. The block ran on the page's account, success was recorded under the queued href, and nothing downstream reads `remappedFromRequested`. The worker's redirect check runs only on `status: complete` ([swBootstrap.js:563](../shared/js/swBootstrap.js:563)). | Fixed on both paths: record the remap, then return ([content.js:12237](../shared/js/content.js:12237), [content.js:12098](../shared/js/content.js:12098)). The worker's redirect check ends the row. |
| **S2-1** 250 ms latch reset lets two enqueues run | **Confirmed**, mechanism. Frequency not measured. | After the reset the enqueue falls through to the chain ([sw.js:12708](../shared/js/sw.js:12708)), so a second enqueue starts beside the first. `detachedLatch` adds nothing over `runtimeSurfaceEmpty`. | Fenced by a token. The triggers are unchanged (section 4a). |
| **S5-1** fill timeout leaves the loop running | **Confirmed.** Impact is sharper than the review says. | The timeout only races the promise ([sw.js:24712](../shared/js/sw.js:24712)). By my reading, a claimed intent is not counted by the open cap until its reservation, which comes after awaits, so two loops can exceed the cap. I did not reproduce that. | Fixed: the token is cancelled in the timeout handler; the loop head and the pre-reservation check stop it; a cancelled claim goes back to the queue once. |
| **S3-1** shared pause flag cleared by cancel or clear | **Confirmed.** The local guard does compare generations (section 2). | Both `finally` blocks cleared the flag unconditionally. The disk write is generation-checked, but the in-memory flag was not. The fill loop and the claim read only the flag. | Fixed: each `finally` clears the flag only while its generation is still the current one ([sw.js:21879](../shared/js/sw.js:21879), [sw.js:21963](../shared/js/sw.js:21963)). |
| **S3-2** removals not checked against attempt | **Confirmed in code.** The trigger is narrow. | The clear builds removals from an earlier read ([sw.js:25906](../shared/js/sw.js:25906)). The door deletes by key, and the WAL remove record does not compare. | Not changed (section 4c). |
| **S4-1** body-supplied tab ids beat the authenticated sender | **Partly.** | Precedence is inverted in the row-event normalizer and in `addSenderTabIdToProgressPatch`. The stale-sender close is gated on the tab's own queued-tab metadata, so it cannot close "whatever tab that id names". It is reached mainly on the deferred flush, where there is no authenticated sender. | Precedence fixed: authenticated sender first ([sw.js:32868](../shared/js/sw.js:32868), [swProfileProgressMerge.js:451](../shared/js/swProfileProgressMerge.js:451)). The body fallback stays for the no-sender case (section 4d). |
| **C-2** claim accepted while a tab is busy | **Confirmed.** | The handler overwrites a running claim and replies `accepted: true`. The worker counts that as a successful nudge and does not resend ([sw.js:28926](../shared/js/sw.js:28926)). | Fixed on the content side. A claim that arrives while the tab is busy is held and runs when the work ends (section 4b). |
| **S1-1** scoped progress overwrites the global | **Confirmed.** Misbehaviour not reproduced. | `profileNukeProgress = progress` is unconditional ([sw.js:18281](../shared/js/sw.js:18281)), and the queue-only runtime-recovery path passes a scoped subset ([sw.js:22644](../shared/js/sw.js:22644)). Readers include the non-queue-only branch of `pruneQueuedTabActions` ([sw.js:30747](../shared/js/sw.js:30747)) and the merge base in `normalizeProgressPatch`. | Not changed (section 4e). |
| **S2-3** `...Locked` function called without its lock | **Confirmed.** The premise was wrong (section 2). | The unlocked calls are the two inside the enqueue loop, and the contract comment says they run inside one storage cycle ([sw.js:547](../shared/js/sw.js:547)). | Fixed: both calls now go through `enqueueSpaceFeedStorageUpdate` ([sw.js:14632](../shared/js/sw.js:14632), [sw.js:14667](../shared/js/sw.js:14667)). |

## 1b. The rest of review 2, triaged

Every item the review raised now has a verdict. "Fixed" means a change is in this pass; "Discussion" letters refer to section 4; "To-do" refers to [planning.md](../planning.md).

| Item | Verdict | Evidence in the current code | Disposition |
|---|---|---|---|
| S1-2 | Confirmed | Two copies of the materialization decision tree still exist. The `* 6` retry delay is only in the first (sw.js:20181). The error-text mapping for fill-timeout and stale-pruned is only in the second (sw.js:20437 to 20487). | Discussion (q) |
| S1-3 | Confirmed | The reason regex at sw.js:18665 does not list `active-live-runtime-tab-closing`, which sw.js:16848 produces, so it falls through to unresolved. | Discussion (p) |
| S1-4 | Confirmed | 223 scheduling calls in sw.js; about 200 pass a bare literal delay. | To-do item 1 |
| S1-5 | Confirmed, fixed | Two fire-and-forget fills inside 100 ms timers ended in `.catch(() => null)`. | Fixed (section 3.1) |
| S1-6 | Question | Two timeout branches return `changed: true` (sw.js:19655, 19686). One reflects real materialization. The other reflects cases consumed earlier in the same pass. | Discussion (o) |
| S1-7 | Partly resolved | The S2-2 fence stops a timed-out enqueue at its next checkpoint. A durable write already in flight inside an iteration is not fenced. | Residual noted; not changed |
| S1-8 | Confirmed, cosmetic | One empty `if` at sw.js:18185, plus mis-indented fields and nested ternaries in the apply phase. | To-do (cleanup) |
| S2-4 | Confirmed | `queuedTabConcurrency` is a module global (sw.js:921), written per enqueue. The fence now keeps a superseded enqueue from writing it. | Discussion (q) |
| S2-5 | Confirmed | Unexplained literals: 250 ms and 1.5 s (sw.js:803 and 802), the `* 6` multiplier, and the 180 s apply timeout. | To-do item 1 |
| S3-3 | Confirmed | Cancel and clear are still near-duplicates. | To-do (cleanup: shared helper, no behaviour change) |
| S3-4 | Confirmed, fixed | A failed tab close was swallowed with `catch {}` in the pause sweep, cancel and clear. | Fixed (section 3.1) |
| S4-2 | Confirmed | `normalizeProgressPatch` still spreads one unioned record (swProfileProgressMerge.js:326). | Discussion (r). Deferred by the entropy plan. |
| S5-2 | Confirmed in shape | After a tab exists, a throw reaches the outer catch, which deletes the activation guard and releases the open reservation (sw.js:35163). | Discussion (k) |
| S5-3 | Confirmed, fixed | Eight fire-and-forget releases in sw.js, two in swBootstrap.js, and the content-ensure `.then` had no rejection handler. | Fixed (section 3.1) |
| S5-4 | Confirmed | The outer catch breaks the whole fill loop on one exception (sw.js:35163, same catch). | Discussion (l) |
| S5-5 | Confirmed | Literal delays and multipliers in the fill: the `* 2` create budget, a 750 ms sweep, and 1000 ms resumes. | To-do item 1 |
| S5-6 | Verified sound | The create attempt's abandoned flag closes a late tab, and reservations are released on the traced paths. | No action |
| C-3 | Confirmed | Three content claim-retry timers re-arm with no attempt ceiling: [content.js:11511](../shared/js/content.js:11511) while the queue is not loaded, [content.js:11537](../shared/js/content.js:11537) while attempts remain or work is pending, and [content.js:11553](../shared/js/content.js:11553) while work is pending. The review's two line numbers are from before this pass. | Discussion (m) |
| C-4 | Confirmed, fixed | `getDialogAction` had no callers, so it is deleted. The helpers it used all have other callers. | Fixed. Remaining question (s). |
| C-5 | Confirmed | Progress normalization lives in content.js (`normalizeStoredProfileNukeProgress`, [content.js:1060](../shared/js/content.js:1060); its merge base is `nextRecords`, [content.js:1075](../shared/js/content.js:1075)) and in the worker (swProfileProgressMerge.js:314). | Discussion (r) |
| C-6 | Confirmed | Literal timers without handles: `setTimeout(openModalProfiles, 1e3)` and `2e3` (content.js:2388, 2404), plus the observer debounces. | To-do item 1 |
| C-7 | Confirmed | Two discriminators: `request.action`, then `switch(request.status)` (content.js:2377). An unmatched message is a silent no-op. | Discussion (n) |
| C-8 | Likely, not measured | The observer runs its scans on every mutation batch (`startObserver`, content.js:1874 to 1966). | To-do item 2 (measure) |
| C-9 | Verified sound | The follow check in blockProfile, the single href normalizer, the static DOM sinks, and the page-world injection's sender check. | No action |

## 2. Corrections to the review

1. **S2-3, premise.** The three sites the review cites (its lines 19493, 21232 and 22619; now [sw.js:19562](../shared/js/sw.js:19562), [sw.js:21342](../shared/js/sw.js:21342) and [sw.js:22747](../shared/js/sw.js:22747)) call the wrapper `enqueueExistingExecutorForCoordinator`. They do not call `enqueueExistingExecutorForCoordinatorOnce`, which the chain reaches only through the wrapper. I traced those three paths and found no storage lock on any of them. The finding stands, on the two in-loop calls.
2. **S5-1, mitigation.** The review says the shared reservation counter limits the damage. By my reading it limits only opens that already hold a reservation. A claimed intent is invisible to the cap until it is reserved, and that happens after at least one await, so two loops can exceed the open cap. Not reproduced.
3. **S4-1, overstatement.** The stale-sender close does not act on "whatever tab that id names". It needs the tab's queued-tab metadata to agree with the stale item: the attempt, the profile and the coordinator key must not contradict it.
4. **S2-1, scope.** `detachedLatch` is redundant with `runtimeSurfaceEmpty`, so the effective condition is runtime-empty plus age. The same 250 ms reset also runs in `scheduleQueuedWorkContinuation` ([sw.js:31793](../shared/js/sw.js:31793)), and an idle reset (1.5 s, `clearStaleCoordinatorExecutorStartPromise`, which runs at the top of every enqueue) also supersedes a running enqueue. Neither is in the review.
5. **S3-1, guard.** `isCoordinatorPauseGenerationLocallyCurrent` does compare the generation. The defect is that it also reads the shared boolean, so another actor clearing the flag makes it fail too.
6. **C-1, sibling (new).** The unblock path (`runQueuedUnblockUnmuteAction`) had the same missing remap check. Fixed in this pass with the same guard.
7. **Frequency and timing.** None of these is measured: the S2-1 startup window, the S5-1 long-fill rate, and the C-1 race window between the content script and the worker's `complete` handler. Each needs a measurement before anyone weighs it.

## 3. What changed in this pass

### 3.1 Production code

- **Executor-start token (S2-1, S2-2)**, [sw.js](../shared/js/sw.js). `coordinatorExecutorStartToken` is the token of the enqueue at the head of the chain. The reset mutator cancels it, and every reset path uses that mutator: the idle clear, the detached reset, the queued-work continuation and the apply timeout. A superseded enqueue (`enqueueExistingExecutorForCoordinatorOnce`) checks its token at its start, before the `queuedTabConcurrency` write, at each plan-loop iteration, before each settlement and before each intent enqueue. Once superseded it skips its fill, and returns the same result shape (`supersededExecutorEnqueueResult`).
- **Apply timeout (S2-2)**, [sw.js:19602](../shared/js/sw.js:19602). The apply creates its own enqueue token and cancels it when its enqueue times out. The chain is reset only while that enqueue still owns the head, so a newer enqueue is not replaced.
- **Fill token (S5-1)**, [sw.js:34184](../shared/js/sw.js:34184) and [sw.js:34713](../shared/js/sw.js:34713). `fillQueuedTabs` creates a token per fill and cancels it in the timeout handler, in the same callback as the existing restore of missing actions. The loop's `while` checks it. Immediately before the opening key and the reservation, with no await in between, a cancelled claim is put back once, unless the queue or an active tab already holds an action for the same key. No tab is opened for it ([sw.js:34898](../shared/js/sw.js:34898)).
- **Pause guard (S3-1)**, [sw.js:21879](../shared/js/sw.js:21879) and [sw.js:21963](../shared/js/sw.js:21963). Cancel and clear clear `coordinatorPauseRequested` only while `coordinatorPauseGeneration` is still their own.
- **Settlement lock (S2-3)**, [sw.js:14632](../shared/js/sw.js:14632) and [sw.js:14667](../shared/js/sw.js:14667). The enqueue's two settlement calls run inside `enqueueSpaceFeedStorageUpdate`, as the other callers do.
- **Sender precedence (S4-1)**, [sw.js:32868](../shared/js/sw.js:32868) and [swProfileProgressMerge.js:451](../shared/js/swProfileProgressMerge.js:451). `applyCoordinatorRowEvents` applies the authenticated sender before normalizing, and the helper reads `senderTabId || patch.tabId`. The body fallback applies only when no sender was passed.
- **Remap stop (C-1)**, [content.js:12237](../shared/js/content.js:12237) (mute-block) and [content.js:12098](../shared/js/content.js:12098) (unblock). When the page resolved to another profile, each path records the remap event and returns before any block, mute, unblock or already-blocked decision.
- **Failure records (S1-5, S3-4, S5-3).** Fire-and-forget work no longer swallows its failures or leaves them unhandled:
  - The two fill reprimes inside the 100 ms timers record their failures ([sw.js:20746](../shared/js/sw.js:20746), [sw.js:20793](../shared/js/sw.js:20793)).
  - The eight fire-and-forget `releaseQueuedTab` calls in `sw.js` go through `releaseQueuedTabInBackground`, which records `queued-tab-release-failed` ([sw.js:31555](../shared/js/sw.js:31555)). The two calls in `swBootstrap.js` count `queuedTab.releaseFailed` instead, because that module has no diagnostics helper.
  - The content-ensure `.then` records `queued-tab-content-ensure-failed` in both places it occurs ([sw.js:35154](../shared/js/sw.js:35154), [swFillQueuedTabsOnceDecisions.js:553](../shared/js/swFillQueuedTabsOnceDecisions.js:553)).
  - The pause sweep, cancel and clear no longer swallow a failed tab close. Each records `owned-tab-close-failed` ([sw.js:21757](../shared/js/sw.js:21757), [sw.js:21850](../shared/js/sw.js:21850), [sw.js:21939](../shared/js/sw.js:21939)).
- **Claim hold (C-2)**, [content.js](../shared/js/content.js). The claim handler now calls `acceptQueuedProfileActionClaim`, which holds a claim pushed while the tab is busy, and `releaseHeldQueuedProfileActionClaim` runs it when the work ends. The finishing flag is set in `requestCloseTab` ([content.js:5005](../shared/js/content.js:5005)), in the two leave-open-for-retry branches ([content.js:11642](../shared/js/content.js:11642), [content.js:12189](../shared/js/content.js:12189)) and by the `close-if-blocked` reply with `willClose: true` ([content.js:2332](../shared/js/content.js:2332)). It is reset when an action starts ([content.js:11565](../shared/js/content.js:11565)). The claim block releases a held push when the claim finds nothing ([content.js:11530](../shared/js/content.js:11530)) and lets a claim that finds an action supersede it ([content.js:11543](../shared/js/content.js:11543)). The action's `finally` releases it ([content.js:12418](../shared/js/content.js:12418)). The rules and costs are in section 4b.
- **Superseded enqueue (after the reviewer's response), [sw.js](../shared/js/sw.js).** A superseded enqueue returns a marker, `superseded: true, reason: 'executor-start-superseded'` ([sw.js:12691](../shared/js/sw.js:12691)). It returns the marker when it is superseded at its start, and also when it is superseded before its fill ([sw.js:15047](../shared/js/sw.js:15047), with the fill decision at [sw.js:14818](../shared/js/sw.js:14818)). In the second case it has planned actions, and those stay as activation intents for the enqueue that replaced it. The apply pass returns at once on the marker and touches no row ([sw.js:19793](../shared/js/sw.js:19793)). Before this change, the empty result was classified as a failed enqueue, which charged a retry to rows that the successor was opening. A superseded enqueue whose fill had already run returns its real result, so the apply classifies it as before. The apply schedules no resume on this path, because a resume would add enqueue triggers. The second response checked the successor's path (section 7).
- **Dead helper (C-4).** `getDialogAction` is deleted from [content.js](../shared/js/content.js). It had no callers, and the helpers it used all have other callers.

The enqueue's token does not flow into its fill. A fill is single-flight and has its own token. Fencing the enqueue's restore of planned actions after a fill timeout would drop them, so that restore is not fenced.

### 3.2 Where this differs from the review's suggested fix

- **S2-1.** The review suggests choosing "stuck" from in-flight state, or a threshold far above the apply timeout. I added the fence and left the triggers in place (section 4a). The review's test ("two enqueues across the 250 ms boundary, one plan per action") is not written as stated. The fence test in 3.3 covers the mechanism.
- **S4-1.** The review suggests removing the body fallbacks. I kept them for the no-sender case, because removing them would disable the stale-sender check on the deferred flush (section 4d).
- **C-1.** The review offers two terminal states: record against the page's profile, or terminalize as a redirect mismatch. I stop on the content side and leave the terminal state to the worker's existing redirect check.
- **S5-1.** The review's test ("at most one loop opens tabs at a time") is not written as stated. The three fill tests cover what it asks for: a cancelled loop claims nothing, a claim cancelled mid-flight goes back once and opens no tab, and the cancel is ordered before the timeout restore.

### 3.3 Tests

New, in [test/swSynthetic.test.js](../test/swSynthetic.test.js), run as `node test/swSynthetic.test.js "--filter=review-2"` (quote the filter):

- Behaviour: `a reset supersedes the enqueue at the head…` (S2-1, S2-2); `a fill whose token is cancelled claims no action…` (S5-1); `an action claimed when its fill is cancelled…` (S5-1); `a pause requested while a cancel is tearing down…` (S3-1).
- Source checks: the settlement lock (S2-3); the apply's cancel-then-guarded-reset ordering (S2-2); the fill's cancel-before-restore ordering (S5-1); the sender precedence (S4-1); the remap returns on both content paths (C-1); the failure records on the fire-and-forget work (S1-5, S5-3); the tab-close failure records (S3-4); the removed dialog helper (C-4).
- Twelve tests in all with this pass's additions (the first nine were the earlier set).
- Superseded-enqueue follow-up, after the reviewer's response: the reset test also asserts the marker. `a superseded enqueue charges no retry and leaves its row queued…` injects the marker through a new test-only hook (`__testSetCoordinatorExecutorStartResult`, in [test/lib/swHarness.js](../test/lib/swHarness.js)) and checks that the row keeps its attempt number. `a superseded enqueue that is cancelled while planning…` cancels the enqueue from inside its planning and checks that it returns the marker and keeps the action it planned. The filter now runs 14 tests.

New, in [test/contentQueuedClaimHold.test.js](../test/contentQueuedClaimHold.test.js), wired into `npm test` and the parallel unit lane:

- Nine behaviour tests run the real `acceptQueuedProfileActionClaim` and `releaseHeldQueuedProfileActionClaim` in a VM context, with the action runner and page helpers stubbed. They cover: a busy push held; a push during the tab's own claim held; a repeat of the running attempt not held; a busy, finishing push declined; an idle push run at once even after a close was requested; a held claim run once when the work ends; a held claim dropped when the tab is finishing; nothing held, nothing run; the later of two busy pushes held.
- Eight source checks pin the wiring by order: `requestCloseTab` marks the tab first; both leave-open branches mark it before they return; the `close-if-blocked` reply marks it; the action start clears it; the `finally` releases the held claim; the claim block releases on no action and supersedes on an action; the handler delegates; the decline sits in the busy branch, after the already-running answer.

**Test expectation changes** (listed so you can object):

- [test/p1-contract.test.js](../test/p1-contract.test.js), "queued progress keeps sender tab id in persisted records": the expected expression is now `normalizeTabId(senderTabId || patch?.tabId)`, was `normalizeTabId(patch?.tabId || senderTabId)`. Reason: S4-1.
- [test/p1-contract.test.js](../test/p1-contract.test.js), "queued tab lifecycle recovery is durable before refilling slots": the expected fill `while` condition gains `options.cancelToken?.cancelled !== true`. Reason: S5-1.
- [test/p1-contract.test.js](../test/p1-contract.test.js), "background tab opening updates authoritative Current Work": the expected call is now `void releaseQueuedTabInBackground(tab.id, …)`, was `void releaseQueuedTab(tab.id, …)`. Reason: S5-3. The call still releases with `runtimeDetached: true`; only the failure record was added.
- [test/p1-contract.test.js](../test/p1-contract.test.js), "queued tab content ensure nudges the profile page to claim its action" and "source-post resolver waits for durable remap before navigating": the claim-handler checks now read `acceptQueuedProfileActionClaim`, the helper that holds the claim, and `onMessage` is checked to delegate to it. Reason: the C-2 hold moved the claim body into that helper.
- [test/lib/swHarness.js](../test/lib/swHarness.js): test-only exports (`enqueueExistingExecutorForCoordinatorOnce`, `fillQueuedTabsOnce`, `cancelCoordinatorCurrentWork`, `pauseCoordinatorNukes`, three getters and a reset wrapper). No behaviour change.

No behavioural assertion was weakened. The changed contract assertions now pin the new text.

### 3.4 Mutation checks

For four of the behaviour tests I removed the production change, confirmed the test fails, and restored `sw.js`, checking it byte-for-byte:

- Pause guard removed: `a pause requested while a cancel is tearing down…` fails.
- Reset's cancel removed: `a reset supersedes the enqueue at the head…` fails.
- Pre-reservation check disabled: `an action claimed when its fill is cancelled…` fails, because the claimed action opens a tab.
- Loop-head check removed: `a fill whose token is cancelled…` fails.

For the content hold I removed eight pieces of production code in turn, the decline, the already-running answer, the finishing check on release, the `finally` release, the `requestCloseTab` mark, the action-start reset, the no-action release and the supersede. Each removal fails a named test in `test/contentQueuedClaimHold.test.js`. `content.js` was restored byte-for-byte after each one.

For the superseded-enqueue fix I removed three pieces in turn: the apply pass's early return, the marker's `superseded` field, and the before-fill return. Each removal fails a review-2 test. My first version of the before-fill test passed for the wrong reason: planning never reached the cancel. The mutation run exposed that, so the test now hydrates the authority state, which planning needs. All three removals are caught now, and `sw.js` was restored byte for byte after each one. The accepted changes in section 8 have their own nine-removal check, with the same result.

### 3.5 Results

- `npm test`: **1154 ok, no `not ok`, exit 0**, after the round-3 measurements in section 8 (1150 before them). The handoff baseline was 1105. The twelve review-2 tests brought it to 1117, the seventeen content hold tests to 1134, the two superseded-enqueue tests to 1136, and the thirteen tests in `test/acceptedReviewChanges.test.js` plus one counter test to 1150.
- `npm run test:parallel`: all 51 lanes PASS (unit, wal, contract, synthetic, scenario, lint), exit 0. The runner reports lane results, not check counts.
- `test/p1-contract.test.js`: 191 ok, exit 0, with the two expectation changes in 3.3. `node test/swSynthetic.test.js --filter=review-2`: 15 ok, exit 0.
- Lints, all pass: `lint:correctness`, `lint:queue-boundary`, `lint:queue-storage-layering`, `lint:no-outside-writes`, `lint:block-classification`.
- `lint:duplicates` (jscpd) exits 0 and reports 42 clones, one more than the 41 in the October inventory. I did not isolate the new one. The lint does not fail on clones.
- Not run: any build. The remap trace in section 8 was the one live browser run, and it used the built-in pane, not the extension.

## 4. For discussion (owner and reviewer)

Each item gives the question, the options and a recommendation. Item b was decided by the owner and is implemented. The owner has since accepted the reviewer's suggestions on the other items; section 8 has what was done for each one.

**a. Latch triggers.** The 250 ms detached reset (in the enqueue wrapper and in the queued-work continuation) and the 1.5 s idle reset still supersede a running enqueue. The token makes that safe: the superseded enqueue stops at its next checkpoint, and its successor plans what remains. It is not free, because work the superseded enqueue had already done is repeated. *Options:* (i) keep the triggers; (ii) replace them with the stale threshold `COORDINATOR_FAST_EXECUTOR_RESUME_TIMEOUT_MS` (180 s), which the fill and reconcile in-flight promises already use, with the apply timeout as the fast path. *Recommendation:* (ii), together with the review's two-enqueue test. *Cost of (ii):* an enqueue with no owner timeout (the resume paths) that hangs would block the chain for up to 180 s, where now it is released in about 0.25 to 1.5 s. This is a liveness decision. **Update (owner, 2026-10-14):** every such value goes into one symbolic registry, and the owner has no view on the values yet. Hit counts come first (to-do items 1 and 2), so the value question waits for that data. *Status:* the supersession counter is in place (section 8). The rule itself is not written, so the trigger and the bound wait for live counts.

**b. C-2, a claim while busy. Decided by the owner on 2026-10-14: hold it on the content side. Implemented in this pass.** A busy reply on its own (option i) was withdrawn earlier. The worker's nudge retry (`nudgeQueuedTabActionClaimWithRetries`) makes four attempts, and when they fail it schedules a reconcile and a queue resume for any tab still active, so a busy action would keep driving those every few seconds. The hold answers a busy push `accepted: true, reason: 'held-while-busy'`, so the worker does not resend, and runs the claim when the current work ends. The rules are in `acceptQueuedProfileActionClaim` ([content.js:180](../shared/js/content.js:180)) and `releaseHeldQueuedProfileActionClaim` ([content.js:208](../shared/js/content.js:208)):
- A repeat of the attempt already running is answered `already-running`, and nothing is held.
- A push that arrives while the tab is busy and finishing (a close was requested, or the tab is kept open to retry a terminal record) is declined: `accepted: false, reason: 'tab-finishing'`. The worker retries a declined nudge, so a retry after the work ends is accepted. Each declined nudge chain ends in one reconcile and one queue resume while the tab is still active.
- A held claim is dropped when the work ends if the tab is finishing, and the console logs the drop. The worker's stale-claim check then requeues the row after `QUEUED_TAB_UNCONFIRMED_ACTIVE_RECONCILE_MS` (5 s). If the tab closes while a claim is held, the claim goes with it, and recovery depends on the worker's closed-tab path. I did not test that path here.
- A claim that the tab's own `claim-tab-action` answers with an action supersedes a push held during that claim. If that answer is empty, the held push runs.
- A second push while busy replaces the first held one. The worker has already counted the first as accepted, so the stale-claim check recovers it. The reviewer asked for this to be in the rules. It is now in the code comment as well.

The finishing flag is set in `requestCloseTab`, in the two leave-open-for-retry branches, and by a `close-if-blocked` reply with `willClose: true`. The worker usually closes a tab that gets that reply. If it declines to (the probe path can return without a close, [sw.js:16973](../shared/js/sw.js:16973)), a claim held in the meantime is dropped and the 5 s check requeues it. The flag is reset when the next action starts. It blocks only a busy claim, so a tab whose close failed still takes new work once its current action ends.

*Costs and residue.* The worker counts a declined nudge under `nudge.rejected.missingAction`, so declines lower the nudge-accept figure on the dashboard for as long as a finishing tab is busy. I have not changed that counter. A push already in flight for an attempt that finished just before it arrived can still start that attempt again, because a claim for an idle tab is accepted. That was true before this change. The worker's retries rebuild the claim from current state, so only a message already in flight can be stale. Not reproduced. *Question:* should the tab remember the attempt ids it has finished, and decline a repeat?

**c. S3-2, a removal whose row changed attempt.** A clear can remove a row whose attempt changed after the clear read it, and the door applies the removal anyway. *Options:* (i) re-read and retry the removal inside the clear, bounded; (ii) report the row as not cleared and leave it, so its tab becomes an orphan until the sweep; (iii) keep the behaviour. *Recommendation:* (i). The row was active before the pause, so a clear should still remove it.

**d. S4-1, the deferred flush.** Removing the body fallbacks completely would disable the stale-sender check on the deferred flush, because that path has no authenticated sender. The fix needs the authenticated sender stored on the pending milestone when it is queued. *Question:* do this in this round, or after the latch decision?

**e. S1-1, where readers get terminal progress.** The global `profileNukeProgress` should not hold a scoped subset. Its readers are the non-queue-only branch of `pruneQueuedTabActions` and the merge base in `normalizeProgressPatch`. *Options:* (i) read through the coordinator reader on that branch, which adds a storage read on a hot path; (ii) keep the last full map and document it. *Recommendation:* (i), after measuring the read. *Status:* counters are in place (section 8). `progress.scopedGlobalWrite` counts each scoped write of the global, in the apply pass. `queuedTabActions.prune.globalProgressHit` and `queuedTabActions.prune.globalProgressMiss` count each non-queue-only read of the global in `pruneQueuedTabActions`. The cost side is already measured: the read that loads the queue when the resident authority is absent is timed as `queuedTabActions.prune.load`. The switch is not made. It waits for the live hit and miss counts.

**f. C-1, terminal state.** The content script now stops and records a remap event. The worker's redirect check ends the row and closes the tab. That check runs on the tab's `complete` event. I have not confirmed that it always runs when the content script finds the remap, so the tab may be left to the stale-tab sweep. I did not add a new message. *Question:* is the worker check reliable enough, or should the content script ask the worker for an explicit terminal state?

**g. Reconcile in the token's scope.** The review's systemic note includes reconcile. None of the confirmed findings needs it, so it is not changed. *Question:* include it now?

**h. The rest of review 2.** Every item now has a verdict (section 1b). The points that still need a decision are items k to s below.

**i. Measurement.** The S2-1 startup frequency, the S5-1 long-fill rate and the C-1 race window need instrumented or live evidence. The fences and checks are verified by test; the rates are not.

**j. Build and release. Decided by the owner, 2026-10-14.** No version bump, build (including dev builds), zip regeneration, or live reload until the owner calls a live run. `package.json` and both manifests stay at 1.6.1425. When the live run is called, the version bump and a fresh compile come first, because `chrome/` predates the current source.

**k. S5-2, a late throw after the tab exists.** The outer catch of the fill loop deletes the activation guard and releases the open reservation, even when the tab was already opened (sw.js:35163). *Options:* (i) keep both while the tab exists, so a second open of the same profile is blocked, but a failed open holds its guard until the guard expires; (ii) keep the current release. *Question:* which matters more here, a double open or a delayed retry?

**l. S5-4, one exception ends the fill.** The outer catch breaks the loop, so the remaining queued actions wait for the next resume, about a second later. *Options:* (i) keep stopping; (ii) continue with the next action and record the failure. *Recommendation:* (ii).

**m. C-3, content claim-retry loops without a ceiling.** Three timers re-arm with no attempt ceiling: one while the queue is not loaded, one while attempts remain or work is pending, and one while work is pending. *Recommendation:* a ceiling with a recorded diagnostic. The value should come from the hit counts (to-do item 2). *Status:* a narrow measurement is built, not the general collector. Each loop reports once, at `CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES` (40 passes, `shared/js/tunables.js`), as a `content-claim-retry-hit` message. The sites are the `noteClaimRetryPass` calls in `maybeRunAutoProfileAction` (`content.js`, about lines 11540, 11567 and 11584). The worker records a flight-recorder event and the counter `contentClaimRetry.<loop>` (`swBootstrap.js`). No loop stops at that count, so there is still no ceiling. The value waits for a live period's counts. The general collector and the dashboard stay on the to-do list.

**n. C-7, silent no-op for unmatched messages.** A typo in `request.action` or `request.status` does nothing. A default diagnostic would also count messages meant for other receivers. *Question:* do you want the diagnostic, limited to the messages the content script is meant to handle?

**o. S1-6, the `changed` flag on timeout results.** Two timeout branches return `changed: true`. One reflects real materialization. The other reflects cases consumed earlier in the same pass. *Question:* should `changed` mean "this pass wrote something", so that the second branch reports false when it wrote nothing new?

**p. S1-3, the reason regex.** `active-live-runtime-tab-closing` (sw.js:16848) is not in the regex at sw.js:18665, so it falls through to "unresolved". *Question:* is that intended? If not, the regex should list it.

**q. S1-2 and S2-4, the duplicated decision tree and the module globals.** The materialization decision tree exists twice and has drifted. `queuedTabConcurrency` is a module global, now fenced for superseded enqueues. *Recommendation:* one decision table for the first, once the owner has decided which behaviour is right for each divergence. Keep the global and rely on the fence. Both are refactors, so they go on the to-do list after this cycle. *Status:* the two divergences the reviewer named are both still present, checked at current lines. **D1:** the first copy (`sw.js`, line 20261) resumes a failed open (`queued-tab-open-failed`) after `QUEUED_TAB_CREATE_TIMEOUT_MS * 6`. The second copy has no such case. **D2:** the second copy (`sw.js`, lines 20562 to 20571) maps three failure texts: final open decision timeout, fill timeout, and stale action pruned. The first copy maps only the first of them (`sw.js`, line 20301). *Decision needed:* for D1, should a consumed-keys failed open wait the same six timeouts? For D2, should the first copy use the same texts? My recommendation is to decide each by the outcome it reports, then write the one table. The table waits for those two answers, so nothing in code has changed for (q).

**r. S4-2 and C-5, one progress normalizer.** The worker and content.js each normalize progress patches, and content.js keeps a third copy as its base. S4-2 is the root pattern in the entropy plan (pattern 0). *Question:* which copy is canonical? The entropy plan defers this. *Status:* not implemented, because five of the six differences change what the content script's per-tab cache holds. R4 changes nothing there, since the content script never sends the flag. Checked at current lines, the two normalizers differ in six places. **R1:** a queued reset clears the tab, owner, timestamp and events fields in the worker (`swProfileProgressMerge.js`, the `resetQueuedProgress` block). The content script resets only its error, label and menu fields (`content.js`, `normalizeProfileProgressPatch`, the queued branch). **R2:** the worker takes the attempt id from the patch only. The content script fills in its active queued attempt (`content.js`, the `activeAttemptId` lines). **R3:** the worker keeps terminal and advanced fields under its own rules. The content script keeps a fixed list of settled fields (`content.js`, `preserveSettledProfileProgress`). **R4:** only the worker honours `replaceProgressRecord`. **R5:** the worker clears the event log on a queued reset, and the content script keeps it. **R6:** the `terminalAt` stamp uses `isTerminalProfileNukeRecord` in the worker and `isSettledProfileNukeRecord` in the content script (`swProfileNukeRecordClassification.js`, `content.js`). The two predicates are different, so they can disagree on whether a record is finished. *Decision needed:* for each row, the worker's rule or the content script's. There are two shapes for the refactor. **(A)** One shared module, instantiated in both contexts. It needs no protocol change, but the worker's dependencies have to be passed into the content script. **(B)** The content script takes the merged record from the worker. That is a protocol change, and it changes when the overlay updates. My recommendation is (A), once the six rows are decided.

**s. C-4, the null-regex branch.** With `getDialogAction` deleted, the null-regex branch of `getGlobalPrimaryAction` has no caller. *Question:* keep it, with the label floor the review suggests as defence in depth, or delete it?

## 5. Reproduce

```
node test/swSynthetic.test.js "--filter=review-2"
node test/contentQueuedClaimHold.test.js
node test/p1-contract.test.js
npm test
npm run test:parallel
npm run lint:correctness
npm run lint:queue-boundary
npm run lint:queue-storage-layering
npm run lint:no-outside-writes
npm run lint:block-classification
```

## 6. To-do list

Added to [planning.md](../planning.md), under "To-Do Queue (after the 14 Oct review cycle)". The owner asked for these after the review cycle finishes:

1. Symbolic timeout registry, complete. Every timeout, threshold and scheduling-delay literal on the queue and content paths goes into one registry. The values stay as they are in that pass.
2. Hit counts. Count how often each named timeout or threshold fires, using the existing queue wakeup metrics. This comes before the value decisions.
3. Dashboard. Show the timeout counts in the coordinator dashboard.

## 7. The reviewer's response

There are two responses so far. The first is in [14-oct-review-2-response.md](14-oct-review-2-response.md). The second, [14-oct-review-2-response-2.md](14-oct-review-2-response-2.md), answers this updated reply. This section records what we did with both. Decisions that the response leaves to the owner are still open, and we have not made them.

**New problems**

- **A superseded enqueue charges retries to rows it never attempted.** We confirmed it by tracing the same chain. The empty result is classified as `queued-authority-enqueue-did-not-materialize-runtime`, and the failure handler then charges a retry. The fence made this reachable, so it is our regression. It is fixed as described in 3.1, with tests and mutation checks.
- **The fence can turn a race into a stall.** We confirmed the mechanism. A new enqueue cancels a head that is older than 250 ms when the runtime is empty and rows are pending ([sw.js:12701-12714](../shared/js/sw.js:12701)). A superseded enqueue stops before its fill ([sw.js:14818](../shared/js/sw.js:14818)). So when enqueues arrive faster than one reaches its fill, none opens a tab. We have not measured this, and no counter records supersession today. The only counter on this path is `pump.executorStartPromiseCoalesced`. The one-second resumes come from several paths: the coalesced path ([sw.js:12714](../shared/js/sw.js:12714)) and two `active-requeued` paths ([sw.js:18422](../shared/js/sw.js:18422), [sw.js:19035](../shared/js/sw.js:19035)). Their combined rate is not known, so we cannot yet say which trigger sets the cadence. The latch rule is the owner's decision (item a). We have not changed it.

**Checked against the code**

- **Item f, the worker's `complete` check.** Not confirmed. The worker's redirect check runs on the `complete` status ([swBootstrap.js:563](../shared/js/swBootstrap.js:563)). The content script checks `location.href` when its action runs ([content.js:9247](../shared/js/content.js:9247)). A remap that the content script finds without a later `complete` event is not covered by the worker's check. The reviewer also says not to add a new message yet. We agree.
- **Item j, build and release.** AGENTS.md asks for a version bump and a rebuild after code changes, unless the user says not to. The owner's approval note says no builds. That note is an explicit instruction, so AGENTS.md's own wording lets it override the default. The reviewer asks the owner to confirm it before a live test. The packaged artifacts predate these edits. The owner decided this on 14 Oct (section 4, item j).
- **Residual: the pause guard's reverse case.** Traced by the reviewer in the second response, and real. Low severity (see the second response below).

**Accepted without a code change**

The fill token, the pause generation guard, the stale-sender reasoning, the detached-latch redundancy, and the corrections in section 2 match the code. We also agree with the reviewer's own corrections (the S2-3 name, the S3-1 guard, the S5-1 mitigation, the S4-1 severity and the C-1 scope), which are the same as ours.

**Content hold**

The reviewer's gap is closed in the rules. A second push while busy replaces the first held one. That is in item b and in the code comment in [content.js](../shared/js/content.js).

**Open items**

The reviewer's positions on items a and c to s are in the response file. We have implemented none of them, apart from the superseded-enqueue fix. That fix is a regression in our own fence, so we treated it as clear. Section 8 supersedes the rest of this paragraph: the owner accepted the reviewer's suggestions on 14 Oct. The counter is in place, and the progress-based rule waits for its live data.

**Second response** ([14-oct-review-2-response-2.md](14-oct-review-2-response-2.md), on this updated reply)

- **Superseded-enqueue fix: agreed.** The reviewer traced the successor's path. The successor's apply schedules a continuation and a one-second resume while planned intents remain with no surface ([sw.js:20774](../shared/js/sw.js:20774), [sw.js:20775](../shared/js/sw.js:20775)), so the superseded apply needs none. They traced some branches of the continuation, not all of them.
- **Counter before any rule change: agreed.** For each supersession, the reviewer asks for four fields: the phase (at start, before fill, or after fill); the trigger, as the reset reason string; the age of the superseded head at the point of supersession; and the time from the superseding enqueue's start to its first opened tab, when it opens one. Measure for about a week of live use, then choose the progress-based rule with real numbers. The phase split matters most, because a supersession before fill is wasted planning. *Status:* added in code (section 8). It measures only in a live run, which is the owner's call (item j).
- **Item f: the gap is likely, not confirmed.** A same-document change, such as a history API redirect, fires `onUpdated` with `changeInfo.url` and no `complete` status. The terminal check runs only on `complete` ([swBootstrap.js:563](../shared/js/swBootstrap.js:563)). The reviewer's plan: trace one live remap first, and note which events fire. If a same-document remap shows up, add a guarded `changeInfo.url` branch to the terminal check. The guard should run the check only on a URL that holds, because a redirect chain can pass through an intermediate slug. No new message. *Status:* trace done (section 8). No same-document remap was seen, so no branch was added.
- **Pause guard, reverse case: traced by the reviewer, and real.** If a newer action M finishes first, its `finally` clears the flag ([sw.js:21879](../shared/js/sw.js:21879), [sw.js:21963](../shared/js/sw.js:21963)) while an older teardown N is still running, so the fill loop can run during N's teardown. Severity low. The fix would count active teardowns and clear the flag only when the count reaches zero. Leave it until the counter shows that it matters. No counter exists for this case, so section 8 says what data would show it. *Status:* not changed.
- **Item j, build and release:** the reviewer agrees with our reading of AGENTS.md's default and of the owner's approval note. *Status:* decided by the owner on 14 Oct (section 4, item j): no builds until a live run is wanted, then the bump, compile, package, load sequence.
- **Items (a) to (s):** the same positions as in the first response, with one refinement to item (a): choose a progress-based rule after the counter has data, and keep 180 s as the outer bound. *Status:* all owner decisions, none implemented.

**What is needed from the owner**

1. Done in code: the supersession counter, with the four fields above (section 8). It measures only in a live run, after the bump, compile, package, load sequence.
2. Done: the live trace of one remap (item f), approved and run (section 8).
3. Confirmation of the no-build note (item j), before any live test.
4. Decisions on items (a) and (c) to (s), as before.

## 8. What the owner accepted on 14 Oct, and what was done

On 2026-10-14 the owner accepted the reviewer's suggestions in both responses, and approved a live remap trace. This section records each item: what changed in code, how it was tested, and what is still gated on data or a build. A later pass, after the owner asked to close items through (s), added the measurements for (e) and (m), and recorded the divergences for (q) and (r) in section 4. Nothing was built, versioned, committed or reloaded.

| Item | Accepted | Done | Gated |
|---|---|---|---|
| (a) latch triggers | Measure first, then a progress-based reset, with the 180 s bound kept as the outer limit | The supersession counter (below). The rule itself is not written | The rule waits for live counter data. No bound is chosen |
| (c) S3-2 removals | Re-read and retry inside the clear, bounded | `mutateCoordinatorStoredWorkClear` re-reads before it saves, rebuilds the plan for rows whose attempt moved, and leaves a row that still moved after the bound. Bound `STORED_WORK_CLEAR_REREAD_ATTEMPTS` = 2 in `tunables.js` | — |
| (d) S4-1 deferred flush | Store the authenticated sender on the pending milestone | `coordinatorJobMilestonePendingSenderTabIds`. The flush passes each record's sender, and the row-event builder uses it. The body fallback stays for records with no sender | — |
| (e) S1-1 scoped progress read | Read through the coordinator reader, after measuring the read | Measurement only; the read is unchanged. `progress.scopedGlobalWrite` counts each scoped write of the global. `queuedTabActions.prune.globalProgressHit` and `...Miss` count the non-queue-only prune reads. The cost side is already timed as `queuedTabActions.prune.load` | The switch waits for the live hit and miss counts |
| (f) C-1 terminal state | Trace one live remap; add a guarded `changeInfo.url` branch only if a same-document remap is seen | Trace done (below). No same-document remap seen, so no branch added | Nine URLs is a sample, not the live queue |
| (g) reconcile | Leave out | Unchanged | — |
| (i) measurement | Measure first | The supersession counter (a), and the counters for (e) and (m) | Rates need a live period after a build |
| (k) S5-2 late throw | Keep the activation guard and the open reservation while the tab exists | The fill loop's outer catch keeps both once the iteration has a tab. Both end by their TTLs (guard 60 s, reservation 15 s), so nothing is held for good | — |
| (l) S5-4 one exception | Continue with the next action and record the failure | The same catch records `queued-tab-fill-iteration-failed`, schedules a reconcile when a tab exists, and continues. The claimed action is not put back, so it cannot be claimed again in the same fill | — |
| (m) C-3 retry ceiling | Ceiling with a recorded diagnostic; value from the hit counts | Measurement only. Each of the three loops in `content.js` reports once, at `CLAIM_RETRY_HIT_DIAGNOSTIC_PASSES` (40 passes, `tunables.js`), as `content-claim-retry-hit`. The worker records a flight-recorder event and the counter `contentClaimRetry.<loop>`. No loop stops at that count | The ceiling value waits for a live period's counts. The general collector and the dashboard are to-do items 2 and 3 |
| (n) C-7 unmatched messages | Diagnostic, limited to messages this extension sends | `reportUnhandledContentMessage` in `content.js`, called from the `onMessage` default | The live run should show whether the worker sends statuses this script does not switch on |
| (o) S1-6 `changed` | `changed` means this pass wrote something | The consumed-only timeout branch reports `changed` from this pass's writes. The real-materialization branch keeps `true` | — |
| (p) S1-3 regex | Add `active-live-runtime-tab-closing` | Added to the restore regex in `sw.js` | — |
| (q) decision table; global | Keep the global; one table after the owner decides each divergence | The global is kept, and the fence covers it. Both divergences the reviewer named are still present (D1 and D2, section 4 q) | Owner decisions D1 and D2, then the table |
| (r) progress normalizer | The worker is canonical; the content copy becomes a view | Not implemented. The normalizers differ in six places (R1 to R6, section 4 r), and five of the six change what the content script's per-tab cache holds | Owner decisions per difference, then the refactor (shape A or B, section 4 r) |
| (s) C-4 null-regex branch | Delete it | `getGlobalPrimaryAction` requires a regex. Without one it returns nothing (`content.js`) | — |
| Pause guard, reverse case | Leave until data shows it matters | Unchanged. No counter exists for this case, and none was added. The count that would show it is the number of teardowns still running when the flag is cleared | That count, which is not collected yet |
| (j) build and release | Decided 2026-10-14: no build, version bump, zip or reload until the owner calls a live run | Done as decided: nothing built, versioned, zipped or reloaded. The remap trace ran with no build and no reload | The live run is the owner's trigger. The supersession counter starts measuring then |

**The supersession counter.** Per superseded enqueue, `pump.executorStartSuperseded.<phase>` is counted once, at the phase where it stopped: `start` (before any planning), `before-fill`, or `after-fill`. Each record carries the reset's reason and the head's age. Per reset of a live head, the next opened tab is timed (`pump.executorStartSupersededFirstTab`, with `timeToFirstTabMs`). A reset that lands before any tab opened is counted as `pump.executorStartSupersededNoTab`. The time runs from the reset. The successor starts at the reset, so the difference from its own start is small. The diagnostics go to the pending buffer, which is capped at `MAX_COORDINATOR_EVENTS`, so a stall cannot grow them without limit.

**The remap trace (approved 2026-10-14).** Method: the built-in browser pane, read-only: navigate, sample the page's location and navigation entry, and read the network log. The extension was not used and not reloaded. No login, form or click.

| Requested | Ended at | Redirects |
|---|---|---|
| `/profile/cesc-fabregas-56` (lower case) | `/profile/Cesc-Fabregas-56` | 1 |
| `/profile/CESC-FABREGAS-56` (upper case) | `/profile/Cesc-Fabregas-56` | 1 |
| `/profile/Cesc-fabregas-56` | `/profile/Cesc-Fabregas-56` | 1 |
| `/profile/Cesc-Fabregas` (no suffix) | `/topic/Cesc-F%C3%A0bregas` | 1 |
| `/Cesc-Fabregas-56` (no `/profile`) | `/profile/Cesc-Fabregas-56` | 1 |
| `/profile/Cesc-Fabregas-57` (no such profile) | `/Cesc-Fabregas-57`, an error page | 1 |
| `/profile/Kenneth-Kesinger`, `/profile/Len-Parisi`, `/profile/Cesc-Fabregas-56` (controls) | unchanged | 0 |

What the trace shows:
- Every redirect was an HTTP redirect. The new document loads, so `complete` fires for the final URL, and the worker's `complete` check sees that URL.
- No same-document rewrite was seen. The URL did not change after load in any sample (at 3, 5 and 9 seconds).
- The `tabs.onUpdated` events were not observed, because the built-in pane cannot read the extension's listener. The sequence (loading, the final URL, then complete) is inferred from Chrome's handling of HTTP redirects.
- So the reviewer's conditional branch is not triggered by this evidence, and none was added. Nine URLs is a small sample, not the live queue.

**Case sensitivity (your note).** All three casings of the slug reached the same profile, at the canonical casing. For this profile, Quora serves one profile under any casing and redirects to the canonical casing. I could not find two distinct profiles that differ only by case, so I cannot confirm that slugs are case sensitive in the sense of separate profiles. The code keeps case (the normaliser does not lower-case), so a non-canonical casing counts as a remap, both for the content script and for the worker's `complete` check. Open question: can a queued href ever be lower-cased? If it can, the worker ends a working profile as a redirect mismatch.

**Verification (after the round-3 measurements).** `npm test`: 1154 ok, no `not ok`, exit 0 (1150 before the round-3 measurements). `npm run test:parallel`: 51 of 51 lanes pass. The lints pass, including `lint:duplicates` (42 clones, unchanged). `test/swSynthetic.test.js --filter=review-2`: 15 ok. The new file `test/acceptedReviewChanges.test.js` had 13 tests in round 2 and has 17 now, wired into `npm test` and the parallel unit lane. Nine removals of the new behaviour were tried: the counter's guard, the per-record sender, the loop's `continue`, the `closing` regex entry, the regex requirement, the attempt comparison, the `changed` flag, the guard for a tab, and the counter at the fill decision. A test caught each one, and the files were restored byte for byte. Round 3 (the C-3 and S1-1 measurements): nine removals were tried, and a named test caught each one, with the files restored byte for byte. `test/p1-contract.test.js` pins the runtime action list, so the new `content-claim-retry-hit` action is listed there (191 ok). The five lints pass, and `lint:duplicates` still reports 42 clones.

**What is needed from the owner**
1. Nothing is needed for builds now. The owner's answer on item (j): no builds until a live run is wanted. Then the bump, compile, package, load sequence runs, and the supersession counter is measured in that run.
2. Whether a queued href can ever be lower-cased (the case question above).
3. The gated decisions: the latch rule's bound, once the supersession counter has data; the C-3 ceiling value, once the `content-claim-retry-hit` counts exist; the S1-1 read switch, once the prune hit and miss counts exist; D1 and D2 (section 4, q); and R1 to R6 (section 4, r).
