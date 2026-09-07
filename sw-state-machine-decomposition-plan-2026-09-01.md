# sw.js State Machine Decomposition Plan

Date: 2026-09-01

Status: Part 1 (sync-only extraction) is complete (Slices 1-44). Part 2
(async orchestration, decide/act splitting, still same-file pending
Phase 0) has fully decomposed the top 3 priority targets: `fillQueuedTabsOnce`
(~951 lines, all 9 regions), `confirmQueuedTabOpenDurableActiveEffect`
(~386 lines, all 5 regions), and `runCoordinatorQueueExecutorFastPath`
(~302 lines, all 5 regions) -- 17 slices (P2-1 through P2-17) total, ~17
named `decide*` helpers extracted. See `git log --oneline` for the full
commit list, starting at `3567f1c`. Part 2's work so far stays physically
in `sw.js`, no new module yet. `shared/js/sw.js` line count fluctuates
around the Part 1 baseline of 30,742 as Part 2's same-file restructuring
trades inline code for named decide functions, down from 38,953 at the
start of this effort. Priority target #4 (`resumeCoordinatorQueueExecutionOnce`)
is next on the "Next 20 Part 2 targets" list below, pending explicit
direction to continue.

**Phase 0 is done** (see "Phase 0" section below for the full design and
execution history; commits `db12da9`, `372f5c9`, `f845a99`). `sw.js` and
every module it (transitively) requires now execute in one shared `vm`
realm instead of `sw.js` alone being sandboxed while its ~69 required
modules ran in the outer Node realm, matching production's webpack-
bundled reality. Landing it exposed (and a follow-up commit fixed) a
real, pre-existing concurrency bug in
`restoreActiveLiveCoordinatorQueuedTabAction` that the old harness's
extra microtask ticks had been masking -- confirmed via A/B before
fixing. **The realm-crossing constraint that gated moving any `decide*`
function (or an `async` function generally) into its own module no
longer applies** -- the ~17 `decide*` functions Part 2 has accumulated so
far, and any future one, are now candidates for a real module extraction
whenever that work is picked up; not yet started.

Slice 44's mop-up re-checked all 15 stragglers Slice 43 had flagged (lines
477-5646 as of that pass, before the excluded `createCoordinatorAuthority`/
WAL region): 10 moved (several had only ever been deferred by scope, not
blocked by a real constraint -- e.g. `recordQueueWakeupPhaseSamplesFromProgress`
just needed to fold into its actual consumer's module), 5 stayed resident
after being individually re-verified as still genuinely blocked
(`ensureBrowserSessionStartupMetricsReset`/`startQueueWakeupMetricsBackedStartupWork`
still Promise-chain into a resident module; `scheduleQueueWakeupMetricsFlush`
has a hard test-harness regex-suppression blocker;
`scheduleTerminalProgressProjectionFlush`/`saveTerminalProgressProjectionAfterAuthority`
still share mutable state with and chain into a resident async function).
**Update, post-Phase-0 (2026-09):** the realm-crossing constraint that
blocked 4 of these 5 (`ensureBrowserSessionStartupMetricsReset`,
`startQueueWakeupMetricsBackedStartupWork`,
`scheduleTerminalProgressProjectionFlush`,
`saveTerminalProgressProjectionAfterAuthority` -- the ones blocked by
"Promise-chain[ing] into a resident module") no longer applies now that
Phase 0 has landed (see below) -- they're candidates for extraction
again, on their own merits (the shared-mutable-state coupling for the
terminal-progress pair may still be a real reason to keep them together,
independent of realms; re-verify before assuming it's now trivial).
`scheduleQueueWakeupMetricsFlush` remains blocked by its own, unrelated,
still-real regex-suppression constraint.

Part 1 is now genuinely finished: what remains in `sw.js` past the
excluded `createCoordinatorAuthority`/WAL region is exactly those 5
re-confirmed-resident stragglers plus the ~9 resident scheduling/storage-
serialization functions (`scheduleCoordinatorReconcile`,
`scheduleCoordinatorQueueResume`, `scheduleQueuedWorkContinuation`,
`promiseWithTimeout`, `scheduleQueuedWorkerActionSurfaceCleanup`,
`markQueuedTabClosing`, `scheduleOwnedBlockedProfileSweep`,
`scheduleQueuedTabReleaseReconcile`, `enqueueSpaceFeedStorageUpdate`), the
~30-function excluded WAL region (by design), and the 298 `async`
orchestration functions. Everything else that was ever sync and reachable
has been extracted. Part 2 (below) -- via Phase 0 or the decide/act
splitting approach, whose first candidate is already scoped -- is the
entire remaining work.

See
[architecture.md](architecture.md) for the durable model this plan works
within, and its "Module Extraction And The Test Harness Realm Boundary"
section for the constraint this plan is built around.

## Why this is hard, and why previous splits stalled

`shared/js/sw.js` is currently ~38,800 lines with 931 top-level functions
(633 synchronous, 298 `async`). Earlier extractions (`swqueueRuntime`,
`swquoraTabs`, `swprojections`, `swmessages`, `swexecutor`, `swscheduler`,
`swCoordinatorQueueWal`) succeeded because their concerns were genuinely
separable. The remaining core -- roughly lines 2,300 to 36,200 -- is not:
sampling function names at ~2,000-line intervals across that span keeps
turning up the same domains (reconcile decisions, tab lifecycle, progress
mutation, activation guards) recurring from one end to the other. It reads
as one continuously-edited procedural core, not several modules sitting
side by side in file order.

A 2026-09 attempt to extract the coordinator queue WAL's async
persist/load/checkpoint-switch path surfaced a second, more fundamental
obstacle: `sw.js` runs inside a `vm.createContext` sandbox under the test
harness's fake timers, while a module pulled out via a plain `require()`
lives in a different V8 realm. A same-realm `await` chain costs one
microtask tick; the identical chain crossing that realm boundary costs two,
in either direction. Production never sees this (webpack bundles everything
into one realm regardless of source-file layout), but the test harness
does, and the WAL persist path crossed that boundary repeatedly and
bidirectionally, silently reordering concurrent reconcile-tick work in two
test ranges with byte-identical logic and a correctly injected clock. Full
details and the repro are in architecture.md's realm-boundary section.

Net effect: "split the state machine into files" is really two different
projects with different risk profiles. Split by **sync vs. async** as the
primary axis, and size each slice small enough to execute from a limited
context window -- this document's main job is making that sizing concrete
rather than something each future session has to re-derive.

## Chaining protocol

A companion inventory of every top-level function in `sw.js` --
bucket, name, defining line, and a count of external references (uses of
the name elsewhere in the file, definition excluded) -- is checked in as
[sw-decomposition-inventory-2026-09-01.tsv](sw-decomposition-inventory-2026-09-01.tsv).
It was generated by `tools/dev/sw-decomposition-inventory.js`, which is
also checked in and should be re-run (overwriting the snapshot) after every
slice.

This is the mechanism that makes chaining across small-context sessions
work: a session picking up the next slice does not need to read or re-scan
the whole 38,800-line file to figure out what's extractable. It reads the
inventory (a few hundred short rows), picks the next topically-clustered,
size-bounded group, and only then reads those specific function bodies plus
their call sites.

Per-slice workflow:

1. **Claim.** From the inventory, pick a contiguous-by-line, same-bucket (or
   obviously-related-across-buckets, e.g. a predicate and the one builder
   that pairs with it) group. Target 15-30 functions, or fewer if their
   combined external-reference count is large (see sizing note below).
2. **Read.** Read only the claimed line ranges plus a `grep -n` for each
   function name to confirm current call sites (line numbers drift after
   every prior slice -- never trust this document's or the inventory
   snapshot's line numbers as authoritative; regenerate or re-grep first).
3. **Move.** Create or extend the target module, following the dependency-
   injection factory pattern already used by `swqueueRuntime.js`,
   `swQueueMachineHandlers.js`, and `swCoordinatorQueueWal.js` (a `createX(deps)`
   factory returning named methods, deps passed in explicitly rather than
   the module requiring `sw.js` back). Update every call site to go through
   the instantiated module instead of the bare function name. Mechanical
   substitution only -- no logic changes riding along.
4. **Verify.** `npm run test:parallel`, `npx mix --production`,
   `node tools/build-chrome-dev.js`, all green.
5. **Regenerate.** Re-run `node tools/dev/sw-decomposition-inventory.js` and
   overwrite the inventory snapshot, so the next slice's claim step starts
   from current reality, not stale line numbers.
6. **Commit.** One commit per slice, so a regression is bisectable to one
   small move.

## Clock/environment-global note (applies even to sync slices)

The realm-boundary issue documented in architecture.md isn't only an
`async`/timer problem. Slice 2 found that a plain `Date.now()` call inside
an extracted **synchronous** function resolves to the real Node clock
instead of the test harness's injected `FakeDate`, because `Date` itself is
a different object identity across the vm/Node realm boundary, not just
timers and promises. Any moved function that reads `Date.now()` (or any
other environment global the harness fakes) needs that dependency threaded
in explicitly -- e.g. `now: () => Date.now()` passed through the module's
`deps`, matching the existing `schedulerClock`-style convention already
used elsewhere in this codebase -- even when the function has no `await` in
it at all. Check every moved function for this, not just the ones that look
timing-related by name.

## Promise-chain realm-crossing note (applies even to non-`async` slices)

Slice 7 found a second, sharper version of the same realm issue: a function
with no `async` keyword that builds or returns a `.then()`/Promise chain
reaching into another already-extracted module is still exposed to
realm-crossing effects, and moving it can *remove* a crossing as easily as
add one -- both directions can silently break test ordering with zero
logic difference in the moved code. Full writeup in architecture.md's
"Module Extraction And The Test Harness Realm Boundary" section (see the
"Refinement found during ... Slice 7" paragraph). Before claiming or moving
any function, grep its body for `.then(`, `Promise.`, and calls into
already-extracted modules -- not just `async`/`await` -- and treat a hit
the same way an `async` function is treated: move it only after confirming
`npm run test:parallel` stays green, and if it breaks, don't assume it's
safe just because the function itself has no `await`.

Refinement from Slice 30: merely *relaying* an unchained Promise reference
is not the same as touching it. A function that calls another (resident)
async function and returns its Promise directly -- no `await`, no
`.then()`/`.catch()` of its own -- doesn't add a new crossing, because the
tick cost is paid at the point something actually `await`s or chains a
foreign-realm Promise, not at a plain pass-through return. The caller still
awaits the same underlying Promise from the same originating realm either
way. Verified with two full `test:parallel` runs. This is narrower than it
sounds: the moment a function adds its own `.then()`, `.catch()`, or
`await` on top of what it's relaying, it's back to a real crossing and
needs the full scrutiny above.

## Sizing note: external-ref count is a cost signal, not a risk signal

Some candidates have very high external-reference counts --
`incrementQueueWakeupMetric` (538), `recordCoordinatorDiagnosticEvent` (89),
`getSchedulerBlockingQueuedExecutorCount` (40), `recordQueueWakeupMetricMax`
(46) -- because they're universal leaf utilities called from all over the
reconcile core. Moving one of these means a large mechanical find/replace
across many call sites, which is a big diff but low judgment risk: the
function itself is simple, and every call site needs the identical
substitution. Treat these as their own single-function slices when their
ref count alone would blow the size budget of a mixed slice, and do the
call-site substitution with a scripted rename, not by hand-editing 500
locations.

Conversely, a predicate with only 1-5 external refs but deep entanglement
with ambient closure state (module-level `let` variables, not just its own
parameters) is smaller in diff size but needs more careful per-call-site
reading, since the small ref count doesn't mean low coupling. Read the
function body before assuming "few refs" means "cheap."

## Part 1 -- sync-only extraction (no Phase 0 dependency)

Six concrete starting slices, sized and verified against the current
inventory snapshot. Line numbers below are from the 2026-09-01 snapshot --
re-verify before executing anything past Slice 1, since each prior slice
shifts everything after it.

### Slice 1 -- Bootstrap/wiring tail

Lines ~37656-38953 (end of file): the nine `browser.runtime.onInstalled` /
`onStartup` / `alarms.onAlarm` / `tabs.onRemoved` / `tabs.onUpdated` /
`storage.onChanged` / `runtime.onMessage` / `webRequest.onCompleted`
listener registrations. Pure composition root -- it calls into everything
else, nothing calls into it. No inventory claim needed, it's already one
cohesive block. Lowest-risk slice, good first proof that the workflow above
is sound before committing to the rest.

### Slice 2 -- Queue-wakeup metric shape helpers (~27 functions, lines 384-840)

`getExtensionVersion`, `makeQueueWakeupMetricEpoch`,
`makeEmptyQueueLoadThrottle`, `makeEmptyQueueWakeupMetrics`,
`normalizeQueueWakeupMetricEpoch`, `normalizeQueueLoadThrottle`,
`normalizeQueueWakeupMetrics`, `buildQueueWakeupMetricsView`,
`compactQueueWakeupJournalEntry`, `buildPersistedQueueWakeupMetricEpoch`,
`buildPersistedQueueWakeupMetrics`, `normalizeQueueWakeupMetricEpochHistory`,
`normalizeQueueWakeupMetricLifetime`, `getQueueWakeupMetricEpoch`,
`getQueueLoadThrottle`, `getQueueLoadThrottleDelayMs`,
`syncQueueLoadThrottleToMetrics`, `rememberQueueLoadPressure`,
`rememberQueueLoadProgress`, `rememberQueuedTabActivationFailure`,
`shouldEscalateQueuedTabClaimNudgeTimeout`, `sumQueueWakeupCounters`,
`getQueueWakeupCounterRatio`, `summarizeQueueWakeupMetricEpoch`,
`addQueueWakeupLifetimeCounters`, `resetQueueWakeupMetricsEpoch`,
`isFreshQueueWakeupMetricsEpoch`, `ensureQueueWakeupMetricsLoaded`. All
low external-ref (1-17). Target module: `swQueueWakeupMetricsShape.js` or
fold into Slice 3's module -- decide when claiming, since 2 and 3 are the
same subsystem split only for slice-size reasons.

### Slice 3 -- Queue-wakeup metric recording/journal functions (~10 functions, lines 1401-2070)

`incrementQueueWakeupMetric` (538 refs -- see sizing note, do this one as
its own scripted-rename sub-step), `getQueueWakeupMetricCounter`,
`recordQueueWakeupPhase`, `recordQueueWakeupMetricMax` (46 refs),
`incrementActiveStorageMetricDetail`, `setActiveStorageMetricDetail`,
`getPhaseWallMs`, `sanitizeQueueWakeupMetricDetails`,
`pushQueueWakeupJournalEntry` (26 refs), `startQueueWakeupMetricCycle`,
`getQueueWakeupMetricCounterDelta`, `getQueueWakeupMetricRuntimeSnapshot`.
Verify against the regenerated inventory for anything between these two
line ranges this list missed (e.g. `finishQueueWakeupMetricCycle`,
`runQueueWakeupMetricPhase`, `recordActiveStorageMetricPhaseInterval`,
`noteActiveStorageMetricPhase` were spotted nearby during planning but not
independently confirmed in-range -- fold them in if `grep -n` shows they
belong here).

### Slice 4 -- Storage payload/latency metrics (~16 functions, lines 1556-1817)

`getStorageMetricKeyName`, `getJsonByteSize`, `getStoragePayloadRowCount`,
`normalizeStorageMetricPathName`, `getStorageMetricPathName`,
`recordStoragePathPayloadMetrics`, `recordStoragePathLatencyMetrics`,
`normalizeSnapshotWriteReason`, `recordSnapshotWriteReasonMetrics`,
`normalizeQueueWriteOperationName`, `getQueueWriteMetricReason`,
`recordQueueWriteOperationMetricValue`, `recordQueueWriteOperationMetrics`,
`recordStoragePayloadMetrics`, `recordStorageReadPayloadMetrics`,
`notifyCoordinatorAuthorityPersistedSnapshot`. Self-contained, low refs
(1-24), a clean sibling to Slices 2-3.

### Slice 5 -- Activation-guard and profile-open-reservation bookkeeping (~15 functions, lines 2263-2412)

`pruneQueuedProfileOpenReservations`, `getQueuedProfileOpenReservationCount`,
`clearDetachedQueuedProfileOpenReservations`,
`getQueuedProfileOpenReservationKey`, `reserveQueuedProfileOpen`,
`releaseQueuedProfileOpenReservation`, `getQueuedActivationGuardKey`,
`pruneQueuedActivationGuards`, `claimQueuedActivationGuard`,
`releaseQueuedActivationGuard`, `releaseQueuedActivationGuardForTab`,
`getQueuedRuntimeActionSubjectHref`, `getQueuedRuntimeActionFillKey`,
`filterRestorableActivationIntents`, `pruneDuplicateQueuedTabActions`.
This is Map-based volatile state (`queuedActivationGuards`,
`queuedProfileOpenReservations`-equivalent) -- good candidate for a
`swqueueRuntime`-style factory module per architecture.md's existing
pattern: hide the Maps behind named methods, don't re-expose raw
collections.

### Slice 6 -- Tab-status / reclaim / budget predicate cluster (~22 functions, lines 2070-3240)

`isDurablyActiveQueuedTab`, `getDurablyActiveQueuedTabCount`,
`getDurablyActiveCoordinatorAuthorityRowCount`,
`getFreshQueuedTabRuntimeStartupAnchor`, `isFreshQueuedTabRuntimeStartup`,
`shouldDeferQueuedTabReleaseRollback`,
`queuedTabRuntimeMetadataMatchesCoordinatorItem`,
`getFreshQueuedTabStartupRuntimeActorForCoordinatorItem`,
`getSchedulerBlockingQueuedExecutorCount` (40 refs, sizing-note candidate),
`hasActiveCoordinatorMilestoneEvidence`,
`hasStrongActiveCoordinatorReclaimEvidence`,
`isQueuedCoordinatorLiveTabReclaimReason`, `chooseCoordinatorReclaimProfileTab`,
`mergeLiveTabsById`, `isBlankOrUncommittedTabUrl`, `isBrowserErrorTabUrl`,
`isCoordinatorProfileLandingWork`, `shouldTerminalizeCoordinatorNonProfileLanding`,
`isSafeToCloseNonProfileLandingTab`, `isPersistedLiveTabPlausibleForCoordinatorItem`,
`shouldTreatTimedOutPersistedTabLookupAsMissingForStaleActive`,
`shouldDeferActiveWithoutActorReconcileForPersistedTabStatus`,
`hasFreshWorkerWindowStartupProgressForCoordinatorItem`,
`isActorlessActiveCoordinatorJobExpired`, `isDurableActiveCoordinatorReclaimStale`,
`isQueuedTabAttemptBudgetExhausted`, `isQueuedAuthorityNoSurfaceRetryBudgetExhausted`,
`hasDurableQueueMatchForRuntimeTab`, `buildRequeuedActiveCoordinatorItemWithoutActor`
(the one builder that belongs with this predicate cluster). This is the
highest-value slice in the starting set -- the actual rulebook for what a
queued tab's runtime state means -- and the largest, so consider splitting
it further at claim time if a fresh read shows natural sub-clusters (tab-URL
classification vs. reclaim-evidence vs. budget-exhaustion look like three
candidates from the names alone).

### Slice 7 -- Browser-session / Quora-runtime-activation tracking (~15 functions, lines 488-1025)

`getBrowserSessionStorageArea`, `hasBrowserSessionStorage`,
`rememberBrowserSessionMarker`, `rememberQuoraRuntimeActivation`,
`forgetQuoraRuntimeActivation`, `ensureBrowserSessionStartupMetricsReset`,
`clearSchedulerAlarms`, `startQueueWakeupMetricsBackedStartupWork`,
`markQuoraRuntimeActivated`, `markQuoraRuntimeActivatedFromRequest`,
`makeQuoraRuntimeNotActivatedResult`,
`scheduleStoredWorkRearmAfterExtensionReload`,
`scheduleStoredWorkRearmAfterServiceWorkerReload`, `normalizeObjectNumberMap`,
`normalizeQueueWakeupPhaseMap`.

Caution: `startQueueWakeupMetricsBackedStartupWork` and
`scheduleStoredWorkRearmAfterServiceWorkerReload` are the two functions
Slice 1 deliberately left as literal top-level *call* statements in `sw.js`
because `test/lib/swHarness.js` regex-suppresses those calls by source text
during tests. Moving their *definitions* may be fine as long as the call
site stays a literal `functionName()` statement in `sw.js` -- verify the
harness's regex still matches before committing, don't assume it does.

### Slice 8 -- Coordinator reconcile-decision inputs (~13 functions, lines 1399-1901)

`markQueuedTabDurablyActive`, `getCoordinatorQueueWorkCounts`,
`getCoordinatorAuthorityMismatchCounts`, `getCoordinatorReconcileActionBudget`,
`getTokenMatchedLiveTabForCoordinatorItem`,
`getLiveProfileTabForActiveCoordinatorReclaim`,
`getLiveProfileTabForRolledBackQueuedCoordinatorReclaim`,
`getCoordinatorItemExpectedExecutorHref`, `getCoordinatorItemExpectedExecutorUrl`,
`getTabObservedUrls`, `getPersistedExecutorObservedAgeMs`,
`getQueuedTabActorReadinessAnchor`, `summarizeQueuedTabStatusForRecorder`,
`getFreshWorkerWindowStartupProgressAnchor`.

Note: a small cluster just before this range (`getActiveStorageUpdateToken`,
`getActiveStorageContext`, `isStorageUpdateAbandoned`,
`suppressAbandonedStorageOperation`, lines ~1122-1134) looks like it belongs
to `swstorage.js`'s serialized-update-queue concern per architecture.md's
"Storage Authority" section, but is apparently still in `sw.js`. Check at
claim time whether that's a leftover that should fold into `swstorage.js`
directly rather than become part of this slice or a new module.

### Slice 9 -- Storage-idle / promise-latch recovery bookkeeping (~19 functions, lines 3813-4329)

`recordActiveStorageWorkSnapshot`, `getStorageContextJournalDetails`,
`getStorageTimeoutBucket`, `recordStorageIdleChurnCounters`,
`scheduleDurableQueueResumeFromIdleStorage`,
`scheduleQueuedOnlyDurableWorkContinuation`, `kickQueuedWorkAfterSlotFreed`,
`getPromiseLatchAgeMs`, `isRuntimeAndStorageIdleForPromiseLatch`,
`hasVisibleQueuedTabFillPromise`, `isExecutorRuntimeIdleForPromiseLatch`,
`isExecutorRuntimeDetachedForPromiseLatch`,
`shouldDeferScheduledResumeDuringFastExecutor`, `clearStaleQueuedTabFillPromise`,
`clearStaleCoordinatorReconcilePromise`, `clearStorageTimeoutPromiseLatches`,
`recoverStorageGetTimeoutSerializedTail`,
`requestStorageTimeoutRecoveryContinuation`,
`shouldContinueQueuedOnlyWorkWithFastExecutor`, `scheduleQueueWakeupMetricsFlush`.

Note: a couple of these call `resetQueuedTabFillState` (still bare in
`sw.js`, line ~302) -- thread it in as a dep, it's out of scope for this
slice (touches state well beyond this cluster).

### Slice 10 -- Profile-resolution / coordinator subject-key predicates (~22 functions, lines 4321-4587)

`getFirstPositiveNumber`, `pruneProfileNukeProgress`,
`mergeProfileProgressEvents`, `mergeUniqueStringList`,
`getNormalizedProfileHrefList`, `normalizeCoordinatorRequestedUrl`,
`isProfileResolutionMode`, `isProfileResolutionItem`,
`stripProfileResolutionQueueKey`, `makeProfileResolutionQueueKey`,
`getProfileResolutionRequestedUrl`, `getEncodedQuoraPathRootToken`,
`isEncodedProfilePathOrTruncatedProfilePath`,
`isLowConfidenceEncodedQuestionPath`,
`getQuestionResolutionUrlFromEvidencePostUrl`,
`getInvalidProfileResolutionFailure`, `getCoordinatorItemQueueKey` (74
external refs -- sizing-note candidate, use the destructure-back-to-bare-name
trick from Slice 3/6 if it applies here, otherwise a scripted rename),
`getCoordinatorItemOpenUrl`, `makeCoordinatorScope`,
`makeCoordinatorResolutionSubject`, `getCoordinatorSubjectKey`.

Excludes `recordQueueWakeupPhaseSamplesFromProgress` (sits at line ~4329, in
the middle of this range, but is a consumer of the already-extracted
`swQueueWakeupMetricsShape.js` module, not part of this domain -- leave it
in `sw.js`).

### Slice 11 -- Attempt-identity & diagnostic-event primitives (~25 functions, lines 3776-4168)

`makeCoordinatorJobKey`, `makeCoordinatorAttemptEnvelope`,
`makeCoordinatorJobEnvelope`, `applyCoordinatorJobEnvelope`,
`getFailedItemQuestionResolutionUrl`, `getFailedItemProfileResolutionRetryUrl`,
`buildQueuedCoordinatorProgressResetPatch`, `getStoredSpaceFeedRecordUrls`,
`getPendingSpaceFeedJobKeyPatch`, `makeId`, `makeAttemptId`,
`normalizeAttemptId`, `getAttemptIdFromValue` (251 external refs --
sizing-note candidate, expect the destructure-back-to-bare-name trick to
work as it has every time so far, but double-check none of the ~251 sites
are inside an already-extracted module needing dep threading instead),
`getAttemptNumberFromValue` (221 refs, same caveat),
`makeCoordinatorInFlightMutationKey`, `getNextAttemptNumberFromValue`,
`isAttemptTrackedCoordinatorItem`, `isNewerTerminalProgressForCoordinatorItem`,
`normalizeCoordinatorMap`, `normalizeCoordinatorEvents`,
`hasMismatchedCoordinatorAttempt` (57 refs), `getResolvedDestinationConflict`,
`makeStaleAttemptDiagnosticEvent`, `recordCoordinatorDiagnosticEvent` (89
refs), `drainPendingCoordinatorDiagnosticEvents`,
`shouldFlushPendingCoordinatorDiagnosticEventsNow`.

### Slice 12 -- Coordinator status-classification rulebook (~21 functions, lines 4202-4441)

`mergeCoordinatorSources`, `mergeCoordinatorEvidence`,
`getCoordinatorStatusFromProgress`, `progressPatchHasExplicitStatus`,
`shouldApplyExplicitProgressStatusToCoordinatorItem`,
`getActiveCoordinatorProgressSenderTabMismatchReason`,
`getActiveCoordinatorDirectProgressRuntimeRejectionReason`,
`getCoordinatorActionKindForProgress`, `getCoordinatorActionKindForItem`,
`shouldApplyProgressToCoordinatorItem`, `isCoordinatorQueueAuthoritativeItem`,
`getCoordinatorMilestonesFromProgress`, `isTerminalCoordinatorStatus` (133
refs), `isActiveCoordinatorStatus` (71 refs), `isPendingCoordinatorStatus`,
`isRetryableCoordinatorFailure`, `isRetryableCoordinatorFailureFromProgress`,
`getCoordinatorCurrentWorkAnchor`, `hasUnsettledCoordinatorSource`,
`shouldKeepCoordinatorCurrentWorkItem`, `pruneCoordinatorCurrentWork`. This
is the single highest-value slice yet -- the literal terminal/active/
retryable-status rulebook the whole reconcile loop consults.

### Slice 13 -- Queue-view / accounting summarization (~19 functions, lines 4453-4808)

`getCoordinatorQueueViewSortRank`, `getCoordinatorQueueViewTime`,
`getCoordinatorQueueViewEpochStartedAt`, `isCoordinatorActualBlockSuccess`,
`getCoordinatorActualBlockTerminalTime`, `getCoordinatorActualBlockActiveStartTime`,
`summarizeCoordinatorActualBlockTiming`, `getCoordinatorActivationHandoffTerminalTime`,
`getCoordinatorActivationHandoffActiveTime`, `summarizeCoordinatorActivationHandoffTiming`,
`summarizeCoordinatorQueueViewItem`, `filterCoordinatorQueueForCompactView`,
`buildCoordinatorQueueView`, `makeCoordinatorQueueAccountingCounts`,
`normalizeCoordinatorQueueViewAccounting`, `areCoordinatorAccountingCountsEqual`,
`makeCoordinatorQueueAccountingComparison`, `summarizeCoordinatorQueueWalAccounting`,
`makeCoordinatorCurrentWorkAccounting`.

### Slice 14 -- Coordinator content-queue-index sharding (~12 functions, lines 4125-4260)

`summarizeCoordinatorContentQueueItem`, `shouldIncludeCoordinatorItemInContentQueueIndex`,
`buildCoordinatorContentQueueIndex`, `hashCoordinatorContentIndexKey`,
`getCoordinatorContentSourceIndexShardKeyByIndex`, `getCoordinatorContentSourceIndexShardKey`,
`getCoordinatorContentSourceKeysFromValues`, `getCoordinatorContentSourceKeysForItem`,
`getCoordinatorContentSourceKeysForRequest`, `getCoordinatorContentSourceIndexShardDefaults`,
`buildCoordinatorContentSourceIndexShardPayload`, `buildCoordinatorQueueDerivedProjectionPayload`,
`makeCoordinatorQueueWalCheckpoint`.

### Slice 15 -- Profile-nuke-progress sharding/view (~21 functions, lines 4276-4755)

`summarizeProfileNukeProgressRecord`, `buildProfileNukeProgressView`,
`getProfileNukeProgressShardIndex`, `getProfileNukeProgressShardKeyByIndex`,
`getProfileNukeProgressShardKey`, `getProfileNukeProgressShardDefaults`,
`getAllProfileNukeProgressShardDefaults`, `getProfileNukeProgressProjectionDefaults`,
`buildProfileNukeProgressShardPayload`, `hasNonterminalCoordinatorAuthorityForProfile`,
`filterProfileNukeProgressForContentProjection`, `updateProfileNukeProgressViewRecords`,
`updateProfileNukeProgressShardRecord`, `removeProfileNukeProgressViewRecords`,
`removeProfileNukeProgressShardRecords`, `scheduleTerminalProgressProjectionFlush`,
`saveTerminalProgressProjectionAfterAuthority`, `normalizeProfileNukeProgressShardRecords`,
`getProfileNukeProgressRecordsFromProjection`, `addContentPageStateProjectionPayload`.

Caution: `scheduleTerminalProgressProjectionFlush` and
`saveTerminalProgressProjectionAfterAuthority` sound schedule/save-shaped
despite being non-`async` -- check them against the Promise-chain
realm-crossing note before moving.

### Slice 16 -- Coordinator-runs materialization (~9 functions, lines 4816-4979)

`makeEmptyCoordinatorMilestones`, `shouldResetCoordinatorFailureFromProgress`,
`getCoordinatorRunStatus`, `materializeCoordinatorRunsPausedStateFromControl`,
`getCoordinatorRunTargetHrefs`, `isCoordinatorRunWorkKeyForProfileHref`,
`getCoordinatorRunItems`, `getCoordinatorRunIdsForHref`, `recomputeCoordinatorRuns`.

### Slice 17 -- Progress-to-coordinator-item transition/terminal-record reducer (~14 functions, lines 4979-5391)

`getCoordinatorTransitionTerminalAt`, `getCoordinatorProgressReducerEventType`,
`getCoordinatorProgressRecordActiveAt`, `getCoordinatorProgressActiveAt`,
`buildProjectedCoordinatorItemFromProgress`, `mergeReducedCoordinatorProgressItem`,
`transitionCoordinatorItemFromProgress`, `shouldPersistCoordinatorRowEventQueueItemChange`,
`makeTerminalProgressRecordFromCoordinatorItem`, `hasTerminalProgressDriftFromCoordinatorItem`,
`shouldRestoreTerminalProgressFromCoordinatorItem`,
`shouldPreferSuccessfulProgressOverTerminalCoordinatorItem`,
`isRedundantTerminalProgressForCoordinatorItem`,
`promoteTerminalCoordinatorItemFromSuccessfulProgress`. This is the
progress-to-coordinator-item reducer itself -- real state-machine core,
high value.

### Boundary after Slice 17: the createCoordinatorAuthority-adjacent region

Immediately after Slice 17's range (from `cloneCoordinatorAuthorityValue` at
line ~5391 onward) is `createCoordinatorAuthority` and its tightly-coupled
value builders (`makeCoordinatorAuthorityProjection`,
`normalizeCoordinatorAuthorityStateInput`, `makeCoordinatorAuthorityApplyResult`,
and similar, 16-62 external refs each), plus the queue-WAL and shadow-WAL
async cluster already documented as staying in `sw.js` (see
`swCoordinatorQueueWal.js`'s "kept in sw.js" list and architecture.md's
realm-boundary section). None of that is in scope for Part 1 -- it's
pervasively used and/or async-orchestration-adjacent. Slices past 17 should
resume on the other side of that region (roughly line 8148 onward as of the
Slice 13 snapshot -- `getChangedProfileProgressRecords`,
`getCoordinatorProgressRecordForItem`, and beyond), not inside it.

### Slice 18 -- Coordinator source/provenance materialization (~14 functions, lines 7317-7512)

`getChangedProfileProgressRecords`, `getCoordinatorProgressRecordForItem`,
`inferSourceTypeFromRunId`, `getCoordinatorRunSourcePageFromEvents`,
`getProfileSearchQueryFromPageUrl`, `makeCoordinatorSourceFromRunMetadata`,
`mergeCoordinatorSourceMetadata`, `normalizeCoordinatorProvenanceSpaceUrl`,
`normalizeCoordinatorItemProvenance`, `applyCoordinatorSourceMetadataMaterialization`,
`getCoordinatorQueueProfileHrefSet`, `getClearProfileWalRemovedProfileHrefs`,
`removeProfileHrefFromProgressRecords`, `materializeRemovedProfileDerivedStateFromAuthority`.

Note: this is immediately past the excluded region -- `getHydratedCoordinatorAuthorityState`
and `refreshResidentCoordinatorAuthorityState` (lines ~6857-6885) are also
excluded even though they sit between the boundary and this slice, since
they're direct accessors on `coordinatorAuthority` itself.

### Slice 19 -- Coordinator reconcile-operation locked materialization (~14 functions, lines 7623-8158)

`getCoordinatorReconcileOperationTabIdsToClose`,
`matchesCoordinatorReconcileOperationAttempt`,
`applyInvalidProfileResolutionReconcileActionLocked`,
`applyStaleProfileResolutionTabReconcileActionLocked`,
`applyProgressRecordCoordinatorReconcileActionLocked`,
`buildCoordinatorReconcileQueueAuthorityDiff`, `hasTerminalKeyOnlyCoordinatorEvent`,
`materializeTerminalKeyOnlyDerivedStateLocked`,
`settleTerminalResolverPendingSourceRecordsLocked`,
`settleResolvedResolverPendingSourceRecordsLocked`,
`materializeQueuedCoordinatorDerivedStateLocked`,
`addCoordinatorReconcileAffectedRunIds`, `markCoordinatorReconcileRunAffected`,
`materializeCoordinatorReconcileDerivedProjectionPhase`.

Caution: the `Locked` suffix and proximity to the reconcile tick's critical
section makes this the deepest-into-the-async-core sync cluster claimed so
far. Extra Promise-chain scrutiny per the realm-crossing note; prefer
static analysis over live-fire experimentation, and leave any function
behind that doesn't check out cleanly rather than force it.

### Slice 20 -- Coordinator terminal-settlement helpers (~5 functions, lines 8575-8702)

`getCoordinatorItemSettlementKey`, `getCoordinatorTerminalItemEntries`,
`settleConfirmedSpaceFeedProfiles`, `scheduleTerminalOwnedProfileTabCleanup`,
`buildTerminalCoordinatorSettlementDerivedPayload`.

Caution: `scheduleTerminalOwnedProfileTabCleanup` sounds Promise-chain-shaped
despite not being declared `async` -- check per the realm-crossing note
before moving.

### Slice 21 -- Tab-id/URL utilities (~6 functions, lines 8341-8444)

`getCoordinatorPageUrl`, `getQueuedActionSurfaceUrl`, `normalizeTabId` (207
external refs -- the highest fan-in of anything claimed yet in this
effort), `normalizeOwnedParentId`, `isBrowserTabId`, `dedupeCoordinatorTabs`.
`normalizeTabId` is almost certainly one of the most foundational
primitives in the whole file -- treat this as its own careful slice even
though it's small.

### Slice 22 -- Persistent-retry timer / executor-start-promise timeout bookkeeping (~5 functions, lines 8523-8780)

`clearPersistentFailedRetryTimeout`, `clearPersistentFailedRetry`,
`schedulePersistentFailedRetry`, `resetCoordinatorExecutorStartPromiseAfterTimeout`,
`clearStaleCoordinatorExecutorStartPromise`.

Caution: schedule/clear-timeout naming -- check per the Promise-chain
realm-crossing note before moving, same as Slices 9/15/20.

### Slice 23 -- Queued-runtime-action matching + rolled-back-retry classification (~14+ functions, lines 8800-9211+)

`queuedRuntimeActionMatchesTabRuntime`, `queuedRuntimeActionHasActiveOrPendingSurface`,
`getQueuedRuntimeActionAuthorityEntry`, `getQueuedActionNoForegroundFallback`,
`markQueuedTabExecutorActionPlanned`, `isQueuedTabRetryBudgetReleaseReason`,
`getExhaustedRolledBackQueuedTabTerminalError`,
`shouldAdvanceRolledBackQueuedTabBeforeOpen`, `getRolledBackQueuedTabRetryAttempt`,
`isExhaustedRolledBackQueuedTabRetry`, `isActiveTransitionRolledBackQueuedTabRetry`,
`isRuntimeDisappearedRolledBackQueuedTabRetry`, `isTransientOpenRolledBackQueuedTabRetry`,
`shouldRecoverExhaustedOpenRetryUnderQueuePressure`, and likely a few more
past line 9211 -- confirm the exact tail boundary against the current
inventory at claim time rather than trusting this list as exhaustive. This
is another rulebook cluster (rolled-back-tab-retry classification), similar
value to Slice 6/12.

### Slice 24 -- Queued-activation-intent / pending-item subject-key + slot-capacity getters (~5 functions, lines 9291-9413)

`getQueuedActivationIntentSubjectKey`, `getPendingCoordinatorItemSubjectKey`,
`filterCurrentPendingItemsForPlannedActions`, `countQueuedExecutorSlotsForOwner`,
`getCoordinatorExecutorPlanBatchLimit`.

### Slice 25 -- Executor enqueue-failure / materialization-capacity classification (~13 functions, lines 10041-10269)

`buildEnqueueFailureTerminalizationDiagnostics`, `getCoordinatorFailureClassification`,
`buildCoordinatorFailureClassification`, `isExecutorMaterializationDeferredByCapacity`,
`isQueuedExecutorCapacityConsumed`, `isExecutorEnqueueTimeoutStillMaterializing`,
`coordinatorItemHasExecutorOpenAttempt`, `normalizeQueuedAuthorityEnqueueMaterializationReason`,
`shouldTreatCapacityDeferralAsNoOpenForRow`,
`normalizeQueuedAuthorityEnqueueMaterializationReasonForRow`,
`getQueuedAuthorityEnqueueMaterializationReason`, `hasBlockingRuntimeSurfaceAfterEnqueueFailure`,
`shouldRecoverLiveSurfaceAfterFinalOpenDecline`.

### Slice 26 -- Coordinator executor-classification/runtime-surface helpers (~9 functions, lines 12170-12238)

`getCoordinatorItemHref` (126 external refs), `findCoordinatorQueueEntryForHref`,
`getCoordinatorExecutorTabActionForActionKind`, `getCoordinatorActionKindForRequestedAction`,
`getCoordinatorItemExecutorTabAction`, `getCoordinatorItemExecutorMaxConcurrent`,
`getCoordinatorResumeMaxConcurrent`, `makeCoordinatorExecutorClassificationCase`,
`getRuntimeSurfaceForCoordinatorItem`.

### Slice 27 -- Queued-tab reclaim/resume/durable-authority predicates (~7 functions, lines 12496-13475)

`shouldResumeCoordinatorItem`, `getLiveTabForCoordinatorItem`,
`selectQueuedWorkerReclaimTab`, `isQueuedTabActionBackedByDurableQueuedAuthority`,
`dropVolatileQueuedActionsForDurableResume`, `dropVolatileQueuedActionsForCoordinatorItem`.

### Slice 28 -- Scheduler alarm/backoff bookkeeping (~15 functions, lines 17663-18418)

`nextCoordinatorPauseGeneration`, `isCoordinatorPauseGenerationLocallyCurrent`,
`isCoordinatorPauseRequestedLocally`, `scheduleCoordinatorPauseStateReconcile`,
`buildPausedCoordinatorQueueItem`, `buildTerminalCoordinatorQueueItem`,
`hasStoredCoordinatorWork`, `hasStoredCoordinatorWorkInQueueView`,
`normalizeRawCoordinatorQueueForReconcileFallback`, `isCoordinatorReconcileEdgeTriggerReason`,
`clearNamedSchedulerAlarm`, `clearCoordinatorReconcileAlarms`, `isCoordinatorReconcileAlarmName`,
`getSchedulerAlarmScheduledTime`, `isSchedulerAlarmScheduledForDueAt`,
`suppressStaleCoordinatorResumeAlarm`, `suppressStaleCoordinatorReconcileAlarm`,
`scheduleCoordinatorResumeAlarm`, `isSuppressedStaleCoordinatorResumeAlarm`,
`isSuppressedStaleCoordinatorReconcileAlarm`, `resetCoordinatorReconcileBackoff`,
`recordCoordinatorReconcileNoopBackoff`, `hasCoordinatorReconcileBackoff`.

Caution: **do not include** `scheduleCoordinatorReconcile` (122 external refs)
or `scheduleCoordinatorQueueResume` (138 external refs), which sit
immediately after this cluster. These look like the actual scheduling core
itself rather than bookkeeping around it -- high-value but almost
certainly needs to stay resident in `sw.js`, or be attempted as its own
extremely careful standalone slice later, not folded into this one.
`scheduleCoordinatorResumeAlarm` in this list is a smaller, narrower
function distinct from `scheduleCoordinatorQueueResume` -- verify that
distinction holds before moving it.

### Slice 29 -- Coordinator retry-candidate/failure-reset builders (~9 functions, lines 19531-19730)

`makeStoredWorkRecoveryResumeOwnedResult`, `getCoordinatorFailureRetryCount`,
`getCoordinatorFailureLastRetryAt`, `sortCoordinatorRetryCandidates`,
`getCoordinatorRetryableFailureCandidates`, `getCoordinatorRetrySourcePages`,
`buildFailedCoordinatorResetItem`.

### Slice 30 -- Profile-progress merge/normalize helpers (~13 functions, lines 20972-21444)

`getProfileProgressStatusRank`, `profileProgressAttemptsMatch`,
`preserveAdvancedProfileProgress`, `mergeStoredProfileProgressRecord`,
`normalizeStoredProfileNukeProgress`, `preserveTerminalProfileProgress`,
`shouldPreserveTerminalProfileProgress`, `normalizeProgressPatch`,
`addSenderTabIdToProgressPatch`, `ensureProfileNukeProgressReady`,
`removeProfileHrefFromPendingSpaceRecords`, `removeProfileHrefFromRememberedNukedPosts`,
`removeProfileHrefFromCoordinatorRuns`.

Caution: `promiseWithTimeout` (46 refs) sits immediately before this
cluster at line ~20950. Despite no `async` keyword, its name strongly
suggests it builds a `Promise.race`-style chain itself -- do not include it
in this or any slice without very careful analysis; it's likely core
async-utility infrastructure that needs to stay resident.

### Slice 31 -- Queued-tab metadata + action-lease bookkeeping (~13 functions, lines 21846-22317)

`getQueuedTabMetadata` (64 refs), `wasQueuedRuntimeTabRemoved`,
`setQueuedTabMetadata`, `remapQueuedTabToResolvedProfile`,
`clearQueuedTabMetadata`, `normalizeCoordinatorActionLease`,
`isCoordinatorActionLeaseExpired`, `isCoordinatorActionLeaseHolder`,
`clearExpiredCoordinatorActionLeases`, `findActiveCoordinatorActionLease`,
`makeCoordinatorActionLease`, `findCoordinatorStoredWorkCancelTarget`.

### Slice 32 -- Queued-tab foreground/worker-action-surface predicates+bookkeeping (~20+ functions, lines 23882-25149)

`isForegroundRequiredProfileActionRequest`, `restoreQueuedTabRuntimeFromActiveAuthorityForSender`,
`hasOwnedQueuedTabState`, `isForegroundQueuedTabAction`, `isForegroundQueuedTabWork`,
`getQueuedForegroundLeaseTabId`, `makeQueuedTabMetadataProgressPatch`,
`clearQueuedForegroundLease`, `releaseQueuedForegroundLease`, `addExpectedTerminalTabId`,
`isExpectedTerminalSweepTab`, `shouldActivateOwnedQueuedTabOnOpen`,
`shouldUseQueuedWorkerActionSurface`, `resetQueuedWorkerActionSurface`,
`isQueuedWorkerActionSurfaceUrl`, `makeQueuedWorkerActionSurfaceState`,
`isIdleQueuedWorkerActionSurfaceTab`, `hasQueuedWorkerActionSurfaceRuntimeWork`,
`hasDurableQueuedBacklogForActionSurface`, `scheduleQueuedWorkerActionSurfaceCleanup`,
`tagActionWithQueuedWorkerSurface`, `isQueuedWorkerActionSurfaceTab`,
`queuedTabMatchesExpectedOpenUrl`, `hasScriptingInjectionApi`,
`getExpectedContentScriptVersion`, `scheduleQueuedTabContentScriptEnsure`,
`shouldDeferQueuedWorkerContentScriptEnsureRelease`. Sizeable -- will likely
need an internal split, same as Slices 6/9/11/12/23. Several `schedule*`
names present -- apply the Promise-chain check carefully.

### Slice 33 -- Owned-tab/profile-nuke-record classification predicates (~15+ functions, lines 25654-26946)

`markQueuedTabClosing`, `getErrorPageUrl`, `serializeOwnedTabIdsByParent`,
`rebuildOwningParentByChild`, `schedulePersistOwnedTabIdsByParent`,
`sendTabMessage`, `registerOwnedTab`, `unregisterOwnedTab`,
`scheduleOwnedBlockedProfileSweep`, `isTerminalProfileNukeRecord`,
`isSuccessfulProfileNukeRecord`, `isSuccessfulUnblockUnmuteProfileRecord`,
`isRetryableTerminalProfileNukeRecord`, `isQueuedDirectBlockActionIncompleteProgress`,
`shouldRecoverQueuedDirectBlockActionTerminalProgress`,
`isQueuedProfileActionGateTimeoutProgress`,
`shouldRecoverQueuedProfileActionGateTerminalProgress`,
`isExplicitSecurityVerificationRecord`, `isTransientProfileNukeStatus`.

### Slice 34 -- Active-queued-tab staleness/confirmed-actor classification (~13 functions, lines 25133-25309)

`getProgressHeartbeatAt`, `hasProgressTimestamp`, `getActiveQueuedTabStaleTimeoutMs`,
`getActiveQueuedTabStartedAt`, `getActiveQueuedTabActionPhaseStartedAt`,
`getActiveQueuedTabAgeAnchor`, `hasActiveQueuedTabActionPhaseProgress`,
`getPersistedQueuedTabId` (37 refs), `getPersistedActiveProgressStaleAnchor`,
`getPersistedActiveCoordinatorStaleAnchor`, `getOwnedOrExpectedLiveTabsForProfileHref`,
`hasConfirmedRuntimeActorForCoordinatorItem`, `hasConfirmedLiveRuntimeActorForCoordinatorItem`.

### Slice 35 -- Queued-tab retry-attempt/stale-nudge + missing-active-evidence reconcile (~10 functions, lines 25468-25761)

`applyMissingActiveCoordinatorEvidenceReconcileActionLocked`,
`shouldReconcileMissingActiveCoordinatorTab`, `makeMissingActiveCoordinatorProgressRecord`,
`getQueuedTabRetryAttempt`, `getQueuedTabMaxRetries`, `hasStaleAcceptedQueuedTabNudge`,
`isQueuedTabLoadPressure`, `buildRetryQueuedTabAction`, `getStaleRetryAdvanceKey`,
`pruneStaleRetryAdvancedWakeKeys`.

### Slice 36 -- Queued-tab detach/cleanup + runtime-surface dedupe (~5 functions, lines 25804-25936)

`cleanupQueuedTabMetadataOnly`, `detachQueuedTabRuntimeState`,
`getQueuedRuntimeSurfaceDedupeKey`, `findAuthorityTabIdForRuntimeSurface`,
`scoreQueuedRuntimeSurfaceForKeep`.

### Slice 37 -- Queued-tab action-key/authority matching (~14 functions, lines 26023-26393)

`scheduleQueuedTabReleaseReconcile` (schedule-shaped, check per the
Promise-chain note), `recordResidentAuthorityStaleQueuedActions`,
`getQueuedTabActionKey` (23 refs), `shouldDropQueuedActionForCurrentAuthority`,
`getQueuedTabActionKind`, `hasQueuedUnblockUnmuteWork`,
`getEffectiveQueuedTabConcurrency`, `shouldDropQueuedActionForTerminalProgress`,
`queuedTabActionMatchesProfile`, `queuedTabMetadataMatchesProfile`,
`getQueuedTabUnconfirmedActiveTransitionAt`, `coordinatorItemMatchesQueuedTabRuntime`,
`coordinatorQueuedItemMatchesRuntimeCandidate`, `shouldCheckQueuedTabRuntimeAuthority`.

### Slice 38 -- Queued-tab action bookkeeping + canceled-owner-url tracking (~7 functions, lines 26587-27402)

`collectQueuedTabActionKeys`, `rememberCanceledOwnerUrls`, `cancelQueuedOwnerActions`,
`consumeCanceledOwnerUrls`, `scheduleQueuedTabReleaseFollowUp`,
`getQueuedTabExpectedAttemptId`, `makeClaimableQueuedTabAction`.

Caution: **exclude** `scheduleQueuedWorkContinuation` (65 external refs)
sitting in this range -- same profile as `scheduleCoordinatorReconcile`/
`scheduleCoordinatorQueueResume` (already excluded elsewhere), likely
resident scheduling core.

### Slice 39 -- Resolved-profile pending-space-record cleanup + coordinator row-event metrics (~7 functions, lines 27879-28514)

`addResolvedProfileToPendingSpaceRecords`, `clearResolverPendingSpaceRecords`,
`getCoordinatorRowEventMetricKind`, `incrementCoordinatorRowEventMetric`,
`normalizeCoordinatorRowProgressEvent`, `buildCoordinatorRowEventsFromProgressRecords`,
`shouldCloseRejectedStaleRowEventSenderTab`.

### Slice 40 -- Coordinator job-milestone bookkeeping (~9 functions, lines 29043-29647)

`scheduleTerminalProgressSettlement`, `scheduleTerminalProgressContinuation`,
`clearPendingCoordinatorJobMilestone`, `consumePendingCoordinatorJobMilestone`,
`getCoordinatorMilestoneWorkCounts`, `hasActiveCoordinatorMilestoneWork`,
`shouldPersistExplicitCoordinatorMilestoneNow`, `updateQueuedTabMetadataFromMilestoneRecord`,
`scheduleCoordinatorJobMilestoneFlush`.

Caution: three schedule-shaped names present (`scheduleTerminalProgressSettlement`,
`scheduleTerminalProgressContinuation`, `scheduleCoordinatorJobMilestoneFlush`)
-- check each per the Promise-chain realm-crossing note, expect some to
stay resident.

### Slice 41 -- Queued-tab-open effect plan/patch builders (~3 functions, lines 29979-30116)

`buildQueuedTabOpenEffectPlan`, `applyQueuedTabOpenRuntimeEffect`,
`buildQueuedTabOpenedProgressPatch`.

### Slice 42 -- Content-page-state projection helpers (~11 functions, lines 31556-31718)

`normalizeContentPageStateUrl`, `getCoordinatorItemStateSources`,
`shouldIncludeCoordinatorItemForContentPage`, `shouldIncludeProfileProgressForContentPage`,
`normalizeCoordinatorContentQueueIndex`, `normalizeCoordinatorContentSourceIndexRecords`,
`normalizeProfileNukeProgressView`, `hasMissingRequestedProfileProgressShard`,
`hasMissingRequestedCoordinatorSourceShard`, `isContentPageStateProjectionMissing`,
`shouldLoadFullQueueForTruncatedContentPageState`. Likely the last big
cluster of sync functions in the file.

### Slice 43 -- Retry on buildTerminalCoordinatorQueueItem + mop-up of remaining isolated singles

Slice 28 left `buildTerminalCoordinatorQueueItem` (12 refs) resident
because its dependency `buildCoordinatorFailureClassification` wasn't
extracted yet -- it is now (Slice 25), so retry it. Plus whatever remains
of the scattered isolated singles surrounded by resident async code:
`getCoordinatorProgressInFlightKey`, `isSameActiveTransitionForCoordinatorItem`,
`shouldKeepQueuedTabOpenAfterActiveTransitionFailure`,
`shouldSkipResumeProjectionFallbackForTrustedAuthority`, `getStorageUpdateQueueSnapshot`,
`shouldPreemptFinalOpenAuthorityRetry`, `shouldResetCoordinatorItemForIncoming`,
`shouldResetCoordinatorExecutor`. Each sits alone with no natural
neighbors -- bundle into whatever module fits contextually, or a small
standalone module, verifying each individually.

### Slice 44 -- mop-up the 15 pre-excluded-region stragglers (done)

Completed (commits `c736928`, `2c2c499`, `c1a48e2`, `d472e38`, `789a5cd`,
5 parts, each independently verified green). Re-checked all 15 stragglers
individually rather than trusting Slice 43's characterization of why each
was skipped: 10 moved (several turned out to be scope deferrals, not real
blockers, once re-examined -- e.g. `getActiveStorageUpdateToken`/
`getActiveStorageContext`/`isStorageUpdateAbandoned`/
`suppressAbandonedStorageOperation` folded into `swstorage.js`,
`resetQueuedTabFillState` folded into `swStorageIdlePromiseLatch.js`,
`recordQueueWakeupPhaseSamplesFromProgress` folded into its actual
consumer's own module). 5 stayed resident after being individually
re-confirmed as still genuinely blocked: `ensureBrowserSessionStartupMetricsReset`
and `startQueueWakeupMetricsBackedStartupWork` still Promise-chain into a
resident module (Slice 7's finding still holds), `scheduleQueueWakeupMetricsFlush`
has a hard test-harness regex-suppression blocker, and
`scheduleTerminalProgressProjectionFlush`/`saveTerminalProgressProjectionAfterAuthority`
still share mutable state with and chain into a resident async function.

Part 1 (sync-only extraction) is now complete. What's left in `sw.js` is:
the resident-only scheduling core (`scheduleCoordinatorReconcile`,
`scheduleCoordinatorQueueResume`, `scheduleQueuedWorkContinuation`,
`promiseWithTimeout`, `scheduleQueuedWorkerActionSurfaceCleanup`,
`markQueuedTabClosing`, `scheduleOwnedBlockedProfileSweep`,
`scheduleQueuedTabReleaseReconcile`, `enqueueSpaceFeedStorageUpdate`),
the 5 re-confirmed stragglers just above, the excluded
`createCoordinatorAuthority`/WAL region (~30 functions, by design), and
the 298 `async` orchestration functions. Part 2 (below) is the entire
remaining work.

## Part 2 -- async orchestration (blocked on Phase 0)

Once the test harness's realm boundary is addressed (see architecture.md),
the `async` orchestration layer -- 298 functions including
`runCoordinatorReconcileTick`, `transitionCoordinatorItemForQueuedTab`,
`fillQueuedTabsOnce`, `createOwnedTab`, `createQueuedExecutorBrowserTab`,
and the WAL persist/load/checkpoint-switch functions already identified as
"kept in sw.js for now" in `swCoordinatorQueueWal.js` -- becomes eligible
for the same chained-slice treatment. The `async` bucket in the inventory
file exists for exactly this; it is not claimed by anything in Part 1.

This part is intentionally not sliced further here. Decomposing it sensibly
depends on Part 1 first shrinking the file enough to see the async core's
real internal boundaries, and on Phase 0 existing at all -- detailing Part
2's slices now would be guessing at a shape that Part 1's progress will
change anyway.

In the meantime, Layer D (the async core) is still worth improving in
place without moving files: consistent naming, removing duplicate inline
chains (the review this session found `resolveTerminalRuntimeExecutorCase`
had drifted from its sibling's shared `getQueuedRuntimeActionSubjectHref`
helper -- exactly this class of rot), and making dependencies on
now-extracted Part 1 modules explicit imports rather than assuming they're
still ambient globals.

### Part 2 approach idea (2026-09, not yet started): decide/act splitting

A promising strategy that does NOT need Phase 0 at all, since it stays on
the sync side of the realm boundary: go inside the big `async` orchestrators
(`runCoordinatorReconcileTick`, `transitionCoordinatorItemForQueuedTab`,
`fillQueuedTabsOnce`, `createOwnedTab`) and find the spans of code that only
*decide* -- no `await`, no Promise touched anywhere in the span -- and pull
those out as pure sync functions returning a plan/action object. The
`await`s that actually perform I/O (tab creation, storage reads/writes)
stay behind as a thin shell in `sw.js`: `await gather()` -> `const plan =
decide(data)` -> `await apply(plan)`.

This is the same two-phase observe/decide/apply model already prescribed in
this doc's "Scheduler / Reconciler" section in architecture.md, just
enforced at the function-extraction level instead of left as a style
guideline. It's also a generalization of what Slices 6, 12, 17, and 19
already did opportunistically (pulling predicates/builders out of the
reconcile core) -- this aims the same technique deliberately at the big
async orchestrators themselves, from the inside, rather than waiting to
extract them whole.

Discipline required, learned the hard way this session: the bar for a
"decide" span isn't "no `async` keyword," it's "touches zero Promises,
including calls into other modules that return one" (the Slice 7 finding,
architecture.md's realm-boundary section). A decision span only qualifies
if it's pure data-in/data-out with no `await` and no `.then()` anywhere in
it, including transitively. If a decision needs to peek at live state via a
browser call or an already-extracted module's async export, that peek has
to happen in the async shell first, with the result passed in as
already-resolved plain data -- the decide function itself must never touch
a Promise.

### First candidate mapped (2026-09): transitionCoordinatorItemForQueuedTab(Locked)

Read both functions in full before writing this (the Read-before-Move
discipline every Part 1 slice has used), rather than guessing at shape.
Findings, as of this snapshot (line numbers will drift, re-verify before
executing):

`transitionCoordinatorItemForQueuedTab` itself (~70 lines, sw.js ~line
12040) turned out to be a poor first candidate -- it's almost entirely
orchestration glue (compute a dedup key, check an in-flight-promise Map,
dispatch to `applyCoordinatorQueueMachineEvent`, track the promise). There
is a real decide span but it's a few lines, not worth a separate module.

Its sibling `transitionCoordinatorItemForQueuedTabLocked` (~209 lines,
sw.js ~line 12387) is the actual substantive one, and its shape corrects a
premise in the approach idea above: it is **not** one decide-block-then-
act-block. It **alternates** decide and act segments, twice:

1. **Decide A** (~40 lines): item lookup, `shouldApplyProgressToCoordinatorItem`,
   `isTerminalCoordinatorStatus`, `hasMismatchedCoordinatorAttempt`,
   attempt-identity checks, `getCoordinatorStatusFromProgress`,
   `transitionCoordinatorItemFromProgress`, and a no-op comparison --
   almost entirely built from already-extracted Slice 12/17/19 pure
   functions, which is exactly why it reads as a decision block even
   though it's still inline. **Gotcha**: two of its reject paths
   (`hasMismatchedCoordinatorAttempt` true, and a missing-attempt-identity
   case) currently `await recordStaleAttemptDiagnostic(...)` as a side
   effect *before* returning false. That `await` disqualifies those two
   spots from a naive "just wrap this block in a function" extraction --
   the decide function must return a reason code (and the diagnostic
   payload) instead of performing the await itself, and the async shell
   performs `await recordStaleAttemptDiagnostic(...)` after getting the
   decision back, based on the reason. This is the concrete case the
   "touches zero Promises" discipline note above was written for --
   without reading the full function first, it's easy to miss that an
   `await` is hiding inside what looks like a pure validation chain.
2. **Act A** (the real I/O): `await coordinatorAuthority.applyWithinStorageUpdate(...)`.
   Its `mutate(currentItem, context)` callback (~26 lines) is already
   100% pure sync with zero awaits -- it re-runs a similar check against
   the possibly-fresher `currentItem` read at commit time. This one is a
   trivial, low-risk extraction on its own: it's already isolated as a
   closure argument, just needs its closed-over values
   (`record`/`mapped`/`now`/`incomingAttemptId`/`incomingAttemptNumber`/
   `itemHref`/`itemCoordinatorKey`) passed in explicitly instead of
   captured.
3. **Decide B** (~few lines): check `authorityResult.accepted`/`durable`,
   compute affected run IDs via `getCoordinatorRunIdsForHref`, decide
   whether `recomputeCoordinatorRuns` (Slice 16) changed anything.
4. **Act B** (conditional): `await saveCoordinatorState(...)` only if
   Decide B found a change, then an unconditional fire-and-forget
   `scheduleCoordinatorQueueResume(...)` call (resident, not awaited).

Practical implication for scoping future Part 2 slices: expect this
alternating shape to be the norm, not the exception, in the remaining
async orchestrators -- budget for multiple small decide-extractions per
function rather than one per function, and always read the full function
first to find every `await` hiding inside an apparent decision chain
(diagnostic recording, metric-adjacent side effects, and similar) before
proposing an extraction boundary.

### Slice P2-1 -- extract the two pure spans from transitionCoordinatorItemForQueuedTabLocked (done)

Completed (commits `25ae7d3`, `675bca8`; both independently re-verified by
reading the full diffs and running the test suite twice more). The
technique works end-to-end on a live async orchestrator:

- Part 1 (`mutate()` → `decideActiveTransitionMutation`) confirmed
  byte-identical and mechanical, but the plan's own suggested params list
  was incomplete -- the real closure also used `itemKey` (distinct from
  `itemCoordinatorKey`) and `tabId`, which the executing agent caught by
  diffing against the original before running tests, not by trusting the
  spec. Lesson: even a "trivial, mechanical" extraction's exact closure
  variable list should be verified against the real code, not assumed
  from a plan-doc description written before the code was read that
  closely.
- Part 2 (Decide A → `decideActiveTransitionOutcome`) landed with the
  planned discriminated-object shape, diagnostic payloads preserved
  exactly, verified by manually tracing the two synthetic tests that
  exercise the stale-attempt and missing-attempt-identity reject paths
  before running the suite.

Both extracted functions stay physically in `sw.js`, not in a new module
-- this slice proved the technique, it didn't answer the separate
question of whether/when these should later move across a module
boundary (which would need the same realm-crossing scrutiny as any Part 1
slice).

The first executable Part 2 slice, following on from the scoping above.
Two small, separately-committed, in-place changes -- no new module yet,
both stay local to `shared/js/sw.js` near
`transitionCoordinatorItemForQueuedTabLocked` (currently ~line 12317; **re-verify
before executing**, line numbers have shifted repeatedly all session).
This deliberately does NOT touch anything else in the function's I/O
(the `await coordinatorAuthority.applyWithinStorageUpdate(...)` call
itself, the run-recompute/save block, or the final
`scheduleCoordinatorQueueResume` call) -- those stay exactly as they are.

**Part 1 of this slice (lowest risk, do first): extract the `mutate()`
callback.** It is already 100% pure sync with zero `await`s -- pull it out
of the `applyWithinStorageUpdate({...})` call's inline object literal into
a standalone, named, top-level sync function (e.g.
`decideActiveTransitionMutation`) taking `(currentItem, context, params)`
where `params` bundles what it currently closes over
(`record`, `mapped`, `now`, `incomingAttemptId`, `incomingAttemptNumber`,
`itemHref`, `itemCoordinatorKey`). Wire it back in as
`mutate: (currentItem, context) => decideActiveTransitionMutation(currentItem, context, {...})`.
Pure mechanical extraction, behavior must be byte-identical. Verify with
the full test suite, commit on its own.

**Part 2 of this slice (real restructuring, more care needed): extract
Decide A into a function returning a decision object instead of directly
returning/awaiting.** Currently Decide A's early-reject paths sometimes
`return false` directly and sometimes `await recordStaleAttemptDiagnostic(...)`
before returning false -- that `await` is why this can't be a naive
block-wrap. Restructure it to a pure function (e.g.
`decideActiveTransitionOutcome(item, record, now)`) returning a discriminated
object: `{outcome: 'reject', reason, diagnostic}` (where `diagnostic` is
the payload that used to be passed to `recordStaleAttemptDiagnostic`, or
absent for the plain early-returns like missing item / terminal status /
`shouldApplyProgressToCoordinatorItem` failing), `{outcome: 'noop'}` (the
JSON.stringify-equal case, which today `return true`s), or `{outcome:
'proceed', mapped, nextItem}`. `transitionCoordinatorItemForQueuedTabLocked`
then does: `const decision = decideActiveTransitionOutcome(item, record, now)`,
handles each outcome (including `if(decision.diagnostic) await recordStaleAttemptDiagnostic(decision.diagnostic)`
before returning false for the reject case), and only proceeds into the
`applyWithinStorageUpdate` call for the `'proceed'` outcome. This changes
control flow shape but must preserve identical externally-observable
behavior (same return values, same diagnostic calls with the same
payloads, same order) -- write it carefully, then verify against the full
test suite, paying particular attention to any test that exercises the
stale-attempt or missing-attempt-identity reject paths specifically (grep
`swSynthetic.test.js` for `recordStaleAttemptDiagnostic` or
`stale-attempt`/`attempt-identity` reason strings to find them). Commit
separately from Part 1.

This slice does not resolve the async orchestration realm-boundary
question at all -- both extracted functions stay physically in `sw.js`.
Its value is proving the decide/act splitting technique works end-to-end
on a real function before deciding whether/how to eventually move such
functions into their own module (which would still need the same
realm-crossing scrutiny as any Part 1 slice, since these decide functions
would then be called across a module boundary from the async shell).

### Next 20 Part 2 targets (function-level priority list, 2026-09)

Surveyed the remaining 298 `async` functions by line count rather than
just external-ref count -- several high-ref functions
(`applyCoordinatorQueueMachineEvent` at 69 refs, notably) turned out to be
thin wrappers delegating into already-extracted dispatcher modules
(`swQueueMachineDispatcher.js`/`swQueueMachineHandlers.js`), not real Part
2 targets. The actual decide/act debt is concentrated in a handful of
large functions. Ordered by size/centrality (line numbers as of this
survey, re-verify before executing -- each of the largest four is
expected to need multiple slices on its own, the Part 2 equivalent of
Part 1's oversized-cluster splits):

1. **`fillQueuedTabsOnce`** (~951 lines, currently line 29515) -- by far
   the largest remaining function in the file. Expect 3-4 slices.
2. **`confirmQueuedTabOpenDurableActiveEffect`** (~386 lines, ~29129).
   Expect 2 slices.
3. **`runCoordinatorQueueExecutorFastPath`** (~302 lines, ~18627). Expect
   2 slices.
4. `resumeCoordinatorQueueExecutionOnce` (~275 lines, ~17646).
5. `sweepStaleQueuedTabs` (~227 lines, ~26058).
6. `releaseQueuedTab` (~214 lines, ~26524).
7. `adoptLiveCoordinatorQueuedTab` (~204 lines, ~13146).
8. `terminalizeActiveCoordinatorItemFromBlockedLiveTab` (~176 lines, ~13670).
9. `ensureQueuedTabContentScript` (~159 lines, ~23915).
10. `fillQueuedTabs` (~160 lines, ~28969) -- the outer wrapper around
    #1; likely thin but check for its own decide content.
11. `kickCoordinatorQueueResume` (~160 lines, ~17258).
12. `pruneQueuedTabActions` (~108 lines, ~25691).
13. `rollbackFailedQueuedTabOpen` (~92 lines, ~12623).
14. `planQueuedTabExecutorAction` (~43 lines, ~9966) -- short, but the
    name suggests real decision content; verify rather than assume
    trivial from size alone.
15. `getQueuedExecutorTabStatusWithTimeout` (~51 lines, ~2724).

Deprioritized -- confirmed short enough at survey time to likely be thin
wrappers, skip unless a future read finds otherwise: `runCoordinatorReconcileTick`
(~24 lines), `recordCoordinatorJobProgressViaQueueMachine` (~26 lines),
`nudgeQueuedTabActionClaimWithRetries` (~27 lines),
`releaseQueuedTabAndCleanup` (~15 lines), `createOwnedTab` (~30 lines),
`confirmQueuedTabDurablyActive` (~41 lines), `getQueuedExecutorTabWithTimeout`
(~5 lines), `applyCoordinatorQueueMachineEvent` (~4 lines, delegates
entirely elsewhere).

### Slice P2-2 -- map and begin extracting fillQueuedTabsOnce (done)

Completed (commit `bdae45c`; independently re-verified by reading the
diff and running the test suite twice more). Found the function is
messier than P2-1's target: not a clean alternating decide/act pattern,
mostly a ~140-line prelude then a sequence of `await` I/O calls each
followed by a small sync guard, then a giant `while` loop with awaits and
sync decision fragments densely interleaved -- few spans over 10-15 lines
are fully await-free. Extracted the single cleanest one:
`decideQueueLoadThrottleGate(params)`, the queue-load-throttle early-return
gate, byte-identical mechanical move (confirmed non-Promise side effects
like `scheduleCoordinatorQueueResume` stay inside the decide function per
the P2-1 precedent). Left the correctness-fix tail region
(`queuedTabFillOpeningActionKeys` sweep) untouched as instructed.

**Map of remaining decide/act spans, for whoever picks up the next slice**
(line numbers as of the P2-2 read, before that slice's own edit shifted
things by ~+32; re-grep before trusting any of these):

1. **`pausedState` gate** (~29546-29569 pre-edit) -- `await metricStorageGet(...)`
   then a pure sync check/return, structurally identical to what P2-2
   already extracted. Safest next pick, do this one first.
2. **Post-cleanup restore-actions block** (~29571-29612) -- mixed:
   `await sweepStaleQueuedTabs`, `await pruneQueuedTabActions`, sync
   `pruneDuplicateQueuedTabActions`, then a conditionally-awaited
   `loadCoordinatorCurrentAuthorityState()` feeding a sync filter and
   restore call. Awaits interleaved with decisions that depend on their
   results before more awaits -- not a clean single extraction.
3. **`slotDecision` outcome handling** (~29658-29718, inside the `while`
   loop, right after `await applyCoordinatorQueueMachineEvent(...)`) --
   fully sync given `slotDecision` as data, but 5 exit shapes
   (return/break/continue×2/proceed) and mutates outer `fillFailureReason`.
   Good target for the P2-1-style discriminated-object pattern (the shell
   translates `outcome` into the right control-flow verb), but more
   design surface than #1 -- do after #1 and #6.
4. **`finalOpenDecision` reject-path branching** (~29755-29879) -- heavily
   interleaved: sync `pushQueueWakeupJournalEntry` immediately followed by
   `await recoverQueuedActionLiveTabAfterFinalOpenDecline(...).catch(...)`,
   then multiple sync sub-branches (`adopted`/`unresolved`/`stale-attempt`/
   `authorityUnavailable`), each with its own scheduling calls. Individual
   sub-branch bodies (e.g. the `stale-attempt` prune branch, ~29816-29844)
   are internally pure sync and extractable one at a time -- needs
   per-branch extraction, not one block.
5. **Pre-open recovery/capacity/pause checks** (~29882-30009) -- three
   more `await X().catch(...)` calls each followed by a small sync
   decision (`adopted`/`deferred` checks, capacity comparison,
   `isCoordinatorPausedInStorage` check). Same alternating pattern as #4,
   per-branch candidates.
6. **Activation guard / reservation claim** (~30011-30058) --
   `claimQueuedActivationGuard` (sync) → guard-failure branch (sync,
   schedule+break) is a small clean decide candidate; then
   `reserveQueuedProfileOpen` (sync) → reservation-failure branch (sync)
   is another. Both self-contained, similar size/shape to #1 -- good
   quick wins, do alongside #1.
7. **Tab-create try/catch** (~30059-30219) -- the actual
   `await createOwnedTab(...)` I/O plus a recovery-retry loop with
   `await getLiveProfileTabsByHref()` and `await new Promise(setTimeout)`
   inside. Genuinely await-heavy, low priority for decide extraction,
   mostly "act."
8. **Post-open confirm/rollback chain** (~30220-30386) --
   `await getQueuedExecutorTabStatusWithTimeout`,
   `await rollbackFailedQueuedTabOpen`,
   `await confirmQueuedTabOpenDurableActiveEffect`,
   `await recordCoordinatorJobProgressViaQueueMachine`, interleaved with
   sync plan-building (`buildQueuedTabOpenEffectPlan`,
   `buildQueuedTabOpenedProgressPatch`, both already Part-1-extracted) and
   two large `returnAfterDurableActive` branches. Dense; would need
   sub-span-by-sub-span treatment, not a single extraction. No
   awaits-in-disguise spotted beyond the obvious ones.
9. **Tail region (~30399-30463, the `queuedTabFillOpeningActionKeys`
   sweep + final summary)** -- fully sync, no awaits, but this is the
   explicit correctness-fix region prior slices were told not to touch.
   A future slice could extract it faithfully if it independently
   re-verifies the fix's behavior with the same rigor as new logic.

Best next targets, in order of safety: #1, then #6's two guard-clause
pairs, then #3 (needs the discriminated-object pattern). Once those land,
`fillQueuedTabsOnce` will likely need 1-2 more slices for #4/#5's
per-branch extractions before it's meaningfully thinned out; #7/#8 may
stay mostly as-is long-term since they're genuinely I/O-dominated.

### Slice P2-3 -- pausedState gate + activation-guard/reservation-claim pair (done)

Completed (commit `ad2f9d6`; independently re-verified by reading the
full diff and running the test suite twice more). Extracted
`decidePausedStateGate` (region #1, structurally identical to
`decideQueueLoadThrottleGate`) and `decideActivationGuardClaim` /
`decideProfileOpenReservationClaim` (region #6, kept as two functions --
reading showed only sequential ordering, not real entanglement).

**Subtlety found on independent re-review, not a blocker but worth
flagging for future readers:** the extracted `decideProfileOpenReservationClaim`
only returns `openReservationHref` on its `'proceed'` outcome; the
function-scoped `openReservationHref` variable (declared once before the
`while` loop, not reset per-iteration) is left untouched on the `'break'`
outcome, whereas the original code unconditionally reassigned it every
time regardless of success or failure. This is behaviorally equivalent
only because every path that successfully reserves later releases and
resets `openReservationHref` back to `''` before the loop could plausibly
continue (four such release points exist in the function) -- so the
invariant "`openReservationHref` is always `''` at the top of a loop
iteration" holds today, but it's now an *implicit* invariant relying on
those four release points instead of an *explicit* unconditional
reassignment. Traced by hand and confirmed correct as of this commit;
flagging here so a future change to any of those four release points (or
a new `continue` path added to the loop) re-checks this invariant rather
than assuming it still holds.

Targets map regions #1 and #6 from Slice P2-2's map above. Re-grep for
current line numbers before trusting the ones in the map (they're already
known to have shifted by ~+32 after P2-2's own edit, and will have moved
again).

**#1, `pausedState` gate:** structurally near-identical to
`decideQueueLoadThrottleGate` (the P2-2 precedent) -- `await metricStorageGet(...)`
followed by a pure sync check/early-return. Extract the sync part the
same way: a standalone `decidePausedStateGate(params)`-style function
(name your own, follow the established naming pattern), called after the
`await`, same discriminated null-or-result-object shape P2-2 used.

**#6, activation-guard / reservation-claim pair:** two small,
self-contained, back-to-back guard clauses inside the `while` loop:
`claimQueuedActivationGuard` (sync) → guard-failure branch (sync,
schedules something + `break`s the loop), then `reserveQueuedProfileOpen`
(sync) → reservation-failure branch (sync). Read both fully before
extracting -- confirm each guard-failure branch is genuinely await-free
(P2-2's report said so from its read, but re-verify yourself, don't take
a prior slice's report as ground truth without checking). These sit
inside a `while` loop with `continue`/`break` control flow and mutate
loop-scoped variables (e.g. `fillFailureReason`), so the same
discriminated-object return pattern as P2-1/P2-2 applies: the decide
function returns an outcome, the loop body translates it into the right
verb (`break`/`continue`/proceed). Two separate small functions (one per
guard), not one combined function, unless reading them shows they're
more entangled with each other than the map suggested.

As with every Part 2 slice: read the current code fresh rather than
trusting old line numbers or prior slices' characterizations, verify
behavior preservation by tracing any relevant test in
`test/swSynthetic.test.js` before running the suite, run the full suite
at least twice given this is still real logic restructuring, and update
`test/p1-contract.test.js` source-text assertions precisely if the
extraction breaks any (P2-2 had to fix two). Commit each extraction
separately if that keeps things independently bisectable, or together if
they turn out simple and low-risk enough -- your call once you've read
the actual code.

After this slice, report a refreshed version of the remaining-span map
(regions #2-#5, #7-#9) with current line numbers, since two more regions
will have been consumed and everything after them will have shifted
again.

**Refreshed remaining-span map (`fillQueuedTabsOnce` now spans lines
29628-30500 in `shared/js/sw.js` as of commit `ad2f9d6`; re-grep before
trusting, this will drift again after the next slice):**

- **#2 Post-cleanup restore-actions block:** ~29663-29708.
- **#3 `slotDecision` outcome handling:** ~29718-29786 (from the
  `applyCoordinatorQueueMachineEvent` call through
  `if(!next) { fillFailureReason = ...; break }`).
- **#4 `finalOpenDecision` reject-path branching:** ~29800-29923.
- **#5 Pre-open recovery/capacity/pause checks:** ~29949-30076 (now feeds
  directly into the P2-3-extracted guards at ~30078/30088).
- **#7 Tab-create try/catch:** ~30100-30256.
- **#8 Post-open confirm/rollback chain:** ~30257-30437.
- **#9 Tail region (`queuedTabFillOpeningActionKeys` sweep + summary):**
  ~30425-30489, before the closing brace at ~30500.

Next best target: #3 (`slotDecision` outcome handling), per P2-2's
original ordering -- fully sync given `slotDecision` as data, needs the
discriminated-object pattern for its 5 exit shapes.

### Slice P2-4 -- slotDecision outcome handling (done)

Completed (commit `1b79649`; independently re-verified by hand-tracing
all 6 branches against the diff and running the test suite twice more).
Extracted `decideSlotOutcome(params)` with all four outcome shapes,
including the first bare-`return` case in Part 2 -- the loop shell does
`if(slotOutcome.outcome === 'return') return slotOutcome.result`. Manual
trace confirmed the reordering of a few `fillFailureReason` assignments
(now happening after the decide call returns, instead of inline before
each metric/flight-recorder call) has zero observable effect, since
nothing reads the outer variable in between.

Targets map region #3. Confirmed by a fresh read (2026-09, current lines
~29717-29782) rather than trusting the stale map -- re-verify line
numbers again before executing, but the shape below is current as of this
writing:

Right after `const slotDecision = await applyCoordinatorQueueMachineEvent({...})`
inside the `while` loop, there are six sequential checks against
`slotDecision`, all synchronous (confirmed: zero `await`/`.then(`/`.catch(`
in this exact span):

1. `slotDecision?.paused === true` -> sets `fillFailureReason`, a metric,
   a flight-recorder event, then a plain `return {...}` -- this one exits
   the *entire async function*, not just the loop.
2. `slotDecision?.planOnlyQueuedAuthorityPreserved === true` -> a metric,
   then `break`.
3. `slotDecision?.clearedStaleServiceWorkerOwnerPause === true` -> a
   metric only, no exit -- falls through to check #4 next. (Easy to miss
   this one since it doesn't exit; make sure the decide function models
   "increment this metric AND keep evaluating" rather than treating it as
   another discriminated branch.)
4. `slotDecision?.canceledPausedOwner === true` -> `continue`.
5. `slotDecision?.activationGuardInFlight === true` -> sets
   `fillFailureReason`, a metric, a flight-recorder event, a
   `scheduleCoordinatorQueueResume(500, ...)` call, then `continue`.
6. `if(!next)` (where `next = slotDecision?.action || null`, computed
   just before check 1) -> sets `fillFailureReason`, then `break`.

If none trigger, execution falls into the `try { ... }` block that
follows (out of scope for this slice -- that's region #4/#7/#8 territory).

Extract this into a decide function (e.g. `decideSlotOutcome(params)`)
returning a discriminated object with an outcome the loop body translates
into the right verb: `{outcome: 'return', result}` for case 1,
`{outcome: 'break', fillFailureReason?}` for cases 2 and 6,
`{outcome: 'continue', fillFailureReason?}` for cases 4 and 5, and
`{outcome: 'proceed', next, activationGuardKey: '', openingActionKey: ''}`
if nothing triggers (note `next`, `activationGuardKey`, and
`openingActionKey` are all declared/reset right in this span in the
current code -- decide whether the decide function should just signal
"proceed" and let the loop body keep doing that local `let` setup, or
whether to fold it in; either is defensible, use your judgment after
reading). Metric/flight-recorder/`scheduleCoordinatorQueueResume` calls
all confirmed non-Promise-touching by prior slices' precedent -- keep
them inside the decide function per the established convention. This is
the first Part 2 span with a bare `return` (not just `break`/`continue`)
as one of its outcomes -- handle that translation carefully in the loop
body (`if(decision.outcome === 'return') return decision.result`), and
give it the same scrutiny as P2-1's diagnostic-await discovery: read
every line, don't assume the shape from this summary without confirming
against the actual current code.

**Refreshed remaining-span map (`fillQueuedTabsOnce` now spans
`shared/js/sw.js:29694-30518` as of commit `1b79649`; re-grep before
trusting):**

- **#4 `finalOpenDecision` reject-path branching:** 29826-29965.
- **#5 Pre-open recovery/capacity/pause checks:** 29967-30094 (feeds into
  the already-extracted `decideActivationGuardClaim` call at ~30096).
- **#7 Tab-create try/catch:** 30113-30273.
- **#8 Post-open confirm/rollback chain:** 30274-30440.
- **#9 Tail region (`queuedTabFillOpeningActionKeys` sweep + summary):**
  30453-30517, before the closing brace at 30518.

### Slice P2-5 -- pre-open recovery/capacity/pause checks (region #5) (done)

Completed (commit `851f4fe`; independently re-verified by hand-tracing
all three sub-blocks against the diff and running the test suite twice
more). Shape matched the plan's description exactly, no surprises. One
coverage gap noted, not a blocker: no test in `swSynthetic.test.js`
isolates the third sub-block's specific `coordinator-paused` check
(there are now three separate paused-checks in this function across
P2-4/P2-5, each in a different spot) in isolation from the other two --
covered only by full-suite regression, which passed twice.

The user asked to go through all remaining regions (#4, #5, #7, #8, #9)
in sequence -- this is the first of that run.

Confirmed by a fresh read (2026-09, current lines ~29967-30094; re-verify
before executing) that region #5 is not one block but three independent
`await` + sync-decide sub-blocks in sequence, each separated by its own
await, each cleanly extractable on its own:

1. **Pre-open recovery outcome**: `await recoverQueuedRuntimeActionBeforeOpen(next, {...}).catch(...)`
   (the `.catch` already normalizes errors into the same shape, so the
   await site itself is safe) -> sync check: `.adopted === true` ->
   metric/flight-recorder/`continue`; `.deferred === true` -> requeue,
   metric, two schedule calls, flight-recorder, `break`; neither -> fall
   through.
2. **Live-profile-tab capacity gate**: `await getLiveQueuedWorkerSurfaceProfileTabCount(...)`
   -> sync: a conditional `clearDetachedQueuedProfileOpenReservations(...)`
   side effect, then a capacity comparison
   (`liveProfileTabs + openReservations + openedTabs >= getEffectiveQueuedTabConcurrency()`)
   that requeues + metric + two schedule calls + flight-recorder + `break`
   if over capacity, else falls through.
3. **Pre-open paused gate**: `await isCoordinatorPausedInStorage('queued-tab-pre-open-paused-check')`
   -> sync: if true, requeue + metric + `finishQueueWakeupMetricCycle` +
   flight-recorder + a bare `return {...}` (same shape as `decideSlotOutcome`'s
   `paused` branch in Slice P2-4 -- reuse that established `{outcome:
   'return', result}` pattern), else falls through into the
   already-extracted `decideActivationGuardClaim` call.

Extract each of the three as its own small decide function (e.g.
`decidePreOpenRecoveryOutcome`, `decideLiveProfileTabCapacityGate`,
`decidePreOpenPausedGate` -- your naming call, stay consistent with
existing conventions), each taking the values it needs as explicit
params (`next`, `preOpenRecovery`/`liveProfileTabs`/`openReservations`/
`openedTabs`/`cycle` as applicable) and returning a discriminated outcome
(`'continue'` / `'break'` / `'return'` / `'proceed'` as appropriate to
each). Verify each is genuinely await-free itself before extracting (the
`.catch()` on sub-block 1's await already means the await risk is
contained to that one line, which stays in the shell). Same rigor as
every prior Part 2 slice: trace relevant tests by hand first, run the
full suite at least twice, re-grep line numbers fresh, don't trust this
summary's line numbers without confirming.

### Slices P2-6 through P2-8 -- regions #4, #7, #8, #9

#7, #8, #9 are still to be scoped in detail once earlier slices land and
shift line numbers again. #7 (tab-create try/catch) was flagged as
"genuinely await-heavy, low priority... mostly act" -- the corresponding
slice should read it fresh and report if there is truly nothing safely
extractable, which is a legitimate outcome, not a failure to force past.
#8 (post-open confirm/rollback chain) was flagged as "dense... needs
sub-span-by-sub-span treatment" -- expect multiple small extractions,
scope them at read time the way #5 did for #3's fallthrough spans. #9
(the tail region, `queuedTabFillOpeningActionKeys` sweep + summary) is
fully sync already but is the explicit correctness fix from earlier this
session -- it may be extracted for consistency with the rest of the
function, but only with the same independent re-verification rigor as
new logic, confirming byte-for-byte behavior preservation, not assumed
from its already-sync appearance.

### Slice P2-6 -- finalOpenDecision reject-path branching (region #4) (done)

Completed (commit `bf4ef17`; independently re-verified by hand-tracing
all four branches plus the fallthrough against the diff, and running the
test suite twice more). Correct in every branch. One harmless observation
from the trace, not a blocker: the original code's trailing bare
`continue` (the "none of the four cases matched" fallback) is now
unreachable dead code, since `decideFinalOpenRecoveryOutcome` always
returns `'continue'` or `'break'` and both are handled by the shell's own
`if` blocks before that line is ever reached. No behavior change, just
worth a follow-up cleanup pass whenever someone is back in this area.

Confirmed by a fresh read (2026-09, current lines ~29951-30089; re-verify
before executing) that region #4 is more layered than a single decide
span, exactly as previously flagged:

1. `const finalOpenDecision = await validateQueuedTabOpenAgainstCurrentAuthority(next, {...})`
   -- entry await.
2. An unconditional `recordFlightRecorderEvent(...)` using
   `finalOpenDecision` -- trivial, always runs, not really a decision.
   Leave inline or extract trivially; not the focus of this slice.
3. `if(!finalOpenDecision.open) { ... }` -- the reject-handling block.
   Inside it: an unconditional metric + `pushQueueWakeupJournalEntry`
   (again, not really a decision, always runs when `!open`), then a
   **second** await:
   `const finalOpenRecovery = await recoverQueuedActionLiveTabAfterFinalOpenDecline(next, finalOpenDecision, {...}).catch(...)`
   (the `.catch` normalizes errors, so this await site itself is safe),
   then a **fully synchronous four-way branch** on `finalOpenRecovery`/
   `finalOpenDecision` (confirmed zero `await`/`.then(`/`.catch(` in this
   span independently): `.adopted === true` -> metric+flight-recorder ->
   `continue`; `.unresolved === true` -> metric+2 schedule calls ->
   `break`; `finalOpenDecision.reason === 'stale-attempt'|'stale-attempt-number'`
   -> metrics+flight-recorder+2 schedule calls -> `continue`;
   `finalOpenDecision.authorityUnavailable === true` -> actionKey
   computation + `queueRuntime.someActivationIntent(...)` dedup check +
   conditional requeue + 2 schedule calls -> `break`; none of the above
   -> a bare trailing `continue`.
4. If `finalOpenDecision.open` is true, falls through past the whole
   `if` block into region #5's territory (already extracted).

**This slice's primary target is the four-way branch in step 3** -- it's
the cleanest, highest-value span here, structurally similar to
`decideSlotOutcome` (P2-4): extract it into a decide function (e.g.
`decideFinalOpenRecoveryOutcome(params)`) taking `next`,
`finalOpenDecision`, `finalOpenRecovery` and returning a discriminated
outcome (`'continue'` with optional `fillFailureReason`/counters like
`recoveredLiveTab`/`prunedStaleAttempt`, or `'break'` with
`fillFailureReason`/`fillFailureError`). The two smaller unconditional
side-effect spots (step 2's flight-recorder call, step 3's
metric+journal-entry before the second await) are lower priority --
extract them too if it reads cleanly, but don't let them block landing
the four-way branch, which is the real win. Read every line fresh before
committing to this structure; the four-way branch in particular has a lot
of surface area (actionKey computation, a `someActivationIntent` closure)
so trace it carefully rather than skimming.

Same rigor as every prior Part 2 slice: hand-trace relevant tests in
`test/swSynthetic.test.js` (search for `stale-attempt`, `authorityUnavailable`,
`final-open`, `adoptedLiveTabAfterFinalOpenDecline`, or similar) before
running the suite, run the full suite at least twice, re-grep all line
numbers fresh.

### Slice P2-7 -- post-open-failure recovery outcome (inside region #7) (done)

Completed (commit `e3caa43`; independently re-verified by hand-tracing
both branches against the diff and running the test suite twice more).
Confirmed correct, including a subtle detail: the fallback branch's
`fillFailureReason` reassignment in the shell is redundant (the outer
variable already held the same value from earlier in the catch block)
but harmless since the value written matches exactly.

Confirmed by a fresh read (2026-09, current lines ~30165-30325; re-verify
before executing) that region #7 as a whole is exactly as flagged --
genuinely I/O-dominated, mostly "act" -- with one real exception worth
extracting:

- The `try { tab = await promiseWithTimeout(createOwnedTab(next), ...) }`
  success path is a linear, unconditional sequence of sync side effects
  (metric increments, `mergeActivationGuardTabInfo`, a flight-recorder
  event) with no branching -- there's nothing to "decide" here, it's pure
  action recording. Not worth extracting; leave inline.
- The `catch(error) { ... }` block has a timed-out-tab recovery retry
  loop (`await getLiveProfileTabsByHref()` + `await new Promise(setTimeout)`,
  up to 6 iterations) that's genuinely await-heavy -- leave inline, no
  extraction candidate here either.
- **But** inside that same `catch` block's `else` branch (genuine open
  failure, not recovered), after journaling the failure, there's a
  **fourth** await: `const postOpenRecovery = await recoverQueuedRuntimeActionBeforeOpen(next, {...}).catch(...)`,
  followed by a clean, fully synchronous decision (confirmed
  independently: zero `await`/`.then(`/`.catch(` in the span right after
  it): if `postOpenRecovery?.adopted === true` or
  `postOpenRecovery?.reason === 'queued-runtime-action-already-has-runtime-surface'`
  -> set reason, metric, `scheduleCoordinatorQueueResume`,
  `scheduleQueuedWorkContinuation`, `break`; else -> a conditional
  `queueRuntime.requeueActivationIntent(...)` gated on
  `openFailureCount <= 3 && !queueRuntime.hasPausedQueuedOwner(next.ownerTabId)`,
  then unconditional `scheduleCoordinatorQueueResume` +
  `scheduleQueuedWorkContinuation` + `break` either way.

This is the slice's only real target: extract this post-`postOpenRecovery`
decision into a decide function (e.g. `decidePostOpenFailureRecoveryOutcome(params)`)
taking `next`, `postOpenRecovery`, `openFailureCount`, `openFailure` as
needed. Both branches end in `break` here (there's no `continue`/`return`
case in this particular span, simpler than P2-4/P2-6's shape) -- a
discriminated `{outcome: 'break', fillFailureReason}` covers it, or even
just a single always-`break` return if that reads more cleanly given both
paths break identically; use your judgment. `Date.now()` appears in this
span too (`lastOpenFailureAt: Date.now()`) -- thread it as `now` per the
clock note if you extract that far, or leave the requeue call's argument
construction inline if splitting it awkwardly.

If reading the actual code shows this is more entangled with the
surrounding `catch` block's other state (`openFailureCount`, `openFailure`,
`tab`) than described, extract only what's clearly safe and report the
rest -- this is a legitimately smaller, more surgical slice than P2-4/
P2-6, don't force additional scope onto it.

Same verification rigor as every prior Part 2 slice.

### Slice P2-8 -- post-open confirm/rollback chain (region #8)

Confirmed by a fresh read (2026-09, current lines ~30341-30506; re-verify
before executing) that region #8 is the densest remaining span in
`fillQueuedTabsOnce` -- awaits and sync logic genuinely interleaved
throughout, not a handful of clean sub-blocks like #5 turned out to be.
Concretely: `await confirmQueuedTabOpenDurableActiveEffect(...)` ->
tiny sync check (`releaseQueuedProfileOpenReservation` + `if(activeTransition.keepOpen !== true) continue`)
-> sync `openedProgressPatch` build -> a large branch on
`options.returnAfterDurableActive === true` containing several `void
x().catch()`/`void x().then()` fire-and-forget chains, scheduling calls,
and a bare `return {...}` (a **third** bare-return case) -- OR, if that
option is false, a direct `await recordCoordinatorJobProgressViaQueueMachine(...)`,
then `await getQueuedExecutorTabStatusWithTimeout(...)`, then a branch
that (if the tab is missing) does `await rollbackFailedQueuedTabOpen(...).catch(...)`
followed by more sync cleanup, or (if just slow/errored) a sync
`setQueuedTabMetadata` + schedule call, then unconditionally sets up a
content-script-ensure promise chain and profile-tab sweep calls.

**Guaranteed small win, do this first:** the tiny sync check right after
the first await (`releaseQueuedProfileOpenReservation` + reservation-href
reset + `if(activeTransition.keepOpen !== true) continue`) -- confirm it's
genuinely free of anything you'd need to extract further and pull it into
its own small decide function if that reads cleanly, or leave it inline
if it's small enough that extraction adds more noise than clarity; your
judgment.

**Beyond that, this slice is open-ended -- survey rather than assume.**
Note a `void promiseReturningCall().catch(...)` fire-and-forget
side effect *can* safely live inside a plain sync decide function even
under the strict Part 2 discipline (constructing and not awaiting a
Promise doesn't require an async caller -- this was already established
safe back in Slice 27's `swQueuedTabReclaimResume.js` precedent), so
don't rule out the `returnAfterDurableActive` branch purely because it
contains `void`-fired calls; rule it out (or in) based on whether it's
otherwise genuinely await-free and whether extracting something this
large is actually worth the risk/complexity trade given its size. Look
for other individually-clean sync spans after each of the remaining
awaits (e.g. right after `getQueuedExecutorTabStatusWithTimeout` resolves,
is the branch on `!confirmedOpenTabStatus.tab` -> `.missing` cleanly
separable into "the part with a nested await" vs "the sync cleanup after
that nested await resolves," the way P2-5 and P2-7 found clean sync
tails after their own nested awaits?). Extract whatever is genuinely safe
and report the rest with specific reasoning, the same way P2-7 correctly
reported most of region #7 as not worth extracting. Forcing extractions
onto a region this interleaved just to say it's "done" is explicitly not
the goal -- an honest "here's what's safe and here's what isn't, and
here's why" is a fully successful outcome for this slice.

Same verification rigor as every prior Part 2 slice, with extra care
given the density here: hand-trace relevant tests in
`test/swSynthetic.test.js` for whatever you do extract, run the full
suite at least twice (three times if you land more than 2-3 separate
extractions, matching the elevated scrutiny given to P2-4/P2-6).

**Completed** (commit `fb838fa`; independently re-verified by reading the
full diff, hand-tracing against the described branch structure, and
running the test suite twice more, both green). The agent extracted the
entire `options.returnAfterDurableActive === true` branch (~65 lines,
including the third bare-return case and its `void`-fired fire-and-forget
calls) into `decideReturnAfterDurableActiveOutcome(params)`, returning
`{setClearRequested, result}`; the shell applies
`queuedTabFillPromiseClearRequested = true` itself when
`setClearRequested` is true, then returns `result` -- confirmed this
exactly preserves the original's module-level state mutation, which the
decide function cannot touch directly since it's a plain sync helper
outside the closure's assignment scope. Left the smaller spans in the
`options.returnAfterDurableActive === false` path (the
`getQueuedExecutorTabStatusWithTimeout`/rollback branch and the trailing
content-script-ensure/profile-sweep setup) resident with explicit
reasoning, matching P2-7's precedent of an honest partial result over a
forced extraction. Updated `test/p1-contract.test.js`'s ordering
assertions for the new function. All `void x().catch()`/`void x().then()`
fire-and-forget calls inside the decide function confirmed safe per the
Slice-27 precedent (constructing/firing a Promise without awaiting it
doesn't require an async caller).

### Slice P2-9 -- final region (region #9, `queuedTabFillOpeningActionKeys` sweep + summary)

This is the last mapped region of `fillQueuedTabsOnce` and the most
sensitive: it is the explicit correctness fix made earlier in this same
decomposition effort (`fillQueuedTabsOnce` was found to leave stale
"in-flight" markers in `queuedTabFillOpeningActionKeys` for actions never
attempted in a given pass). Unlike every other region, this span is
already fully synchronous end-to-end -- there is no await interleaving to
split, so the only benefit of extracting it is code organization, not
solving an async-orchestration problem. That means the honest options
here are: (a) extract it into a pure decide/build function if doing so
clearly improves readability without needing more than the read-only
locals it already closes over, or (b) explicitly leave it resident and
say so, if extraction would require threading enough closure state or
subtly restructuring the sweep that the risk isn't worth the payoff for a
region with zero remaining async-decomposition value. Do not force
extraction just to mark all 9 regions complete -- an honest "leaving this
resident, here's why" is a fully valid outcome for this slice, same as
P2-7's finding for most of region #7.

Before executing: re-grep `fillQueuedTabsOnce` fresh (line numbers have
shifted since P2-8 landed) to confirm the exact current bounds of this
tail region and read it in full before proposing any extraction.

If anything is extracted, the verification bar is the highest of any
Part 2 slice so far given this region's history as a subtle, previously-
shipped bug fix: confirm byte-for-byte behavior preservation against the
current code (not assumed from its already-sync appearance), specifically
hand-trace that every key added to `queuedTabFillOpeningActionKeys`
earlier in the function is still correctly swept/cleared under every exit
path, run the full suite at least three times, and independently re-read
the full diff line by line before considering this done.

**Completed** (done directly rather than via an execution agent, given
the region's small, fully self-contained scope and the scoping work
already in hand from writing this slice's spec; commit follows). Fresh
grep confirmed `fillQueuedTabsOnce` at 30029-30619 post-P2-8, with the
tail region at lines 30553-30617: the `queuedTabFillOpeningActionKeys`
untouched-key sweep loop followed by the `openedTabs > 0 ||
recoveredLiveTabs > 0` if/else summary-and-return blocks. All six values
read by this region (`openedTabs`, `recoveredLiveTabs`,
`fillFailureReason`, `prunedStaleAttemptActions`, `fillFailureError`,
`cycle`) are declared once near the top of `fillQueuedTabsOnce` and
mutated only during the loop, never read again after this tail -- fully
self-contained. Every other identifier the region touches
(`queueRuntime`, `getQueuedRuntimeActionFillKey`,
`queuedTabFillOpeningActionKeys`, `incrementQueueWakeupMetric`,
`finishQueueWakeupMetricCycle`, `recordFlightRecorderEvent`,
`getSchedulerBlockingQueuedExecutorCount`) is module-scope in `sw.js`
already (several already-extracted-module exports destructured back to
their bare names per the established pattern), so none needed threading
as params -- matching the precedent already set by
`decidePostOpenFailureRecoveryOutcome` and
`decideReturnAfterDurableActiveOutcome` calling module-scope helpers
directly while only per-call locals are passed through `params`. Notably
this region is the only one of the 9 with zero `await`s and zero Promise
construction anywhere nearby -- there was no realm-crossing risk to
reason about at all, making this the single lowest-risk extraction of
the entire Part 2 effort so far: a pure textual move into
`decideFillQueuedTabsOnceOutcome(params)`, confirmed via `git diff` to be
byte-for-byte identical body content, only re-indented and given a
`params` destructure header and a `return decideFillQueuedTabsOnceOutcome({...})`
call site. No `test/p1-contract.test.js` update was needed -- grepped for
every literal string unique to the moved block and confirmed none of the
existing assertions were scoped to `fillQueuedTabsOnce`'s extracted body
in a way that cared about this content's location. Verified: `node -c`
syntax check, full test suite green three times, `npx mix --production`
and `node tools/build-chrome-dev.js` both green.

**All 9 mapped regions of `fillQueuedTabsOnce` are now addressed.** This
closes out the "go through all through 9" instruction. `fillQueuedTabsOnce`
itself still exists as a single `async` function (Part 2's discipline
keeps it that way until Phase 0 lands), but its body is now a sequence of
awaits interleaved with calls into ~12 named, independently-readable
`decide*` sync functions rather than large blocks of inline decision
logic. No further Part 2 target has been chosen yet; the "Next 20 Part 2
targets" list above remains the candidate pool for whatever is picked
next, pending explicit direction.

## Part 2 continued -- confirmQueuedTabOpenDurableActiveEffect

Priority target #2 from the list above. Fresh read (2026-09, current
lines 29129-29513, ~385 lines; re-verify before executing) of the whole
function. Structurally different from `fillQueuedTabsOnce`: not one long
`while` loop, but a handful of large mutually-exclusive branches selected
by `options.returnAfterDurableActive` and by whether the active-transition
await succeeds.

**Map of decide/act spans:**

1. **Setup + Promise-chain construction** (29130-29143) -- declares the
   mutable outcome locals, computes the timeout, and builds (but does not
   yet await) `activeTransitionPromise` by chaining `.then()` off
   `transitionCoordinatorItemForQueuedTab(...)`. The `.then()` callback
   body (29144-29159) is itself fully sync (`releaseQueuedActivationGuard`,
   `incrementQueueWakeupMetric`, `markQueuedTabDurablyActive`,
   `scheduleCoordinatorQueueResume`) but is attached to a Promise that
   isn't awaited until later -- leave this construction resident; there's
   no decide/act win here, and moving Promise-chain construction is where
   past slices found the most subtlety.
2. **`returnAfterDurableActive` fast path** (29160-29195) -- `await
   promiseWithTimeout(activeTransitionPromise, ...)` in a try/catch, then
   a fully sync tail (29171-29194): branch on `activeTransitionAccepted`,
   set metadata/mark/schedule calls, then an unconditional `return {...}`.
   **Cleanest candidate, structurally identical to the many bare-return
   decide extractions already done in `fillQueuedTabsOnce`** (P2-4/P2-6/
   P2-8/P2-9's pattern) -- do this first.
3. **Main-path await + a dead-code guard** (29196-29227) -- the second
   `await promiseWithTimeout(...)` try/catch (act, not extractable), then
   an `if(returnAfterDurableActive && !activeTransitionAccepted && ...)`
   check at 29207. **This condition is unreachable**: branch 2 above
   always returns when `returnAfterDurableActive` is true, so by line 29207
   it is always false. Confirmed by tracing control flow, not just
   grepping -- this is pre-existing dead code, not something this
   decomposition effort introduced. Flag it in the extraction's commit
   message but do not "fix" it (out of scope); if this span is ever
   extracted, preserve the dead branch byte-for-byte like every prior
   slice has preserved other harmless oddities (e.g. P2-6's unreachable
   trailing `continue`).
4. **The big nested `if(!activeTransitionAccepted)` block** (29228-29385)
   -- the real complexity. `await confirmQueuedTabDurablyActive(...)` ->
   sync `shouldKeepQueuedTabOpenAfterActiveTransitionFailure` check ->
   two exclusive paths:
   - **`activeTransitionContinued` path** (29246-29254): fully sync
     (`setQueuedTabMetadata` + `scheduleCoordinatorQueueResume`), falls
     through to the function's final `return` at 29506-29512 -- a clean,
     small, self-contained decide candidate on its own.
   - **rollback path** (29255-29385): `markQueuedTabClosing` -> `await
     rollbackFailedQueuedTabOpen(...)` -> sync branch (early return if
     `rolledBack`) -> conditional `await loadCoordinatorQueueProjection()`
     -> sync computation of `sameTabReclaimedByDifferentAttempt` -> early
     return if true (with its own `await browser.tabs.remove` + `void
     releaseQueuedTab`) -> nested `if(activeTransitionSettled)` with
     another conditional `await loadCoordinatorQueueProjection()` -> sync
     `rowStayedQueued` computation -> early return if true (with its own
     awaits) -> final sync fallthrough return. Heavily interleaved, same
     shape as `fillQueuedTabsOnce`'s old regions #4/#5 -- needs
     per-branch extraction across multiple slices, not one block. The
     individual sync decision fragments (`sameTabReclaimedByDifferentAttempt`
     computation, `rowStayedQueued` computation, each roughly 15-20 lines)
     are themselves clean candidates once isolated from their bracketing
     awaits.
5. **`else` branch: `returnAfterDurableActive` false path when transition
   accepted immediately** (29387-29504) -- `markQueuedTabDurablyActive`,
   then (if `returnAfterDurableActive`, already established false by this
   point via the same dead-code pattern as #3 -- **also unreachable**,
   confirm on execution) an early return, then sync
   `sameTabReclaimedByDifferentAttempt` computation (structurally
   identical to the one inside #4's rollback path, worth comparing side by
   side for a possible shared helper once both are extracted) -> early
   return if true -> `await getQueuedExecutorTabStatusWithTimeout(...)` ->
   sync branch on `liveTabStatus` (missing/tab-lookup-failed/ok), each
   sub-branch self-contained with its own awaits and returns.

**Best next slice: extract #2 only** (the `returnAfterDurableActive`
fast-path sync tail) as Slice P2-10 -- smallest, safest, most isolated,
proven pattern. Params needed: `activeTransitionAccepted`,
`activeTransitionError`, `tab`. Everything else it touches
(`markQueuedTabDurablyActive`, `setQueuedTabMetadata`,
`scheduleCoordinatorQueueResume`, `scheduleQueuedWorkContinuation`,
`Date.now`) is module-scope in `sw.js`, so no realm-crossing question
applies (Part 2 stays in-file) and nothing else needs threading. Later
slices will pick off #4's two sub-branches and #5's independent sub-spans
one at a time, following the same incremental, map-then-extract rhythm
used for `fillQueuedTabsOnce`.

Same verification rigor as every prior Part 2 slice.

**Completed** (done directly, same as P2-9, given the span's small,
isolated, well-understood scope; independently re-verified by reading the
full diff -- confirmed byte-for-byte textual move, no logic changed --
and running the full test suite twice more, both green, plus both
production builds). Extracted lines 29171-29194 into
`decideFastActiveTransitionOutcome(params)`, taking
`{activeTransitionAccepted, activeTransitionError, tab}`; the call site
became a single `return decideFastActiveTransitionOutcome({...})`.
Checked `test/p1-contract.test.js` for assertions scoped to the moved
literal strings (`active-transition-fast-confirmed`,
`active-transition-fast-detached`, `fast-path-storage-lane-detached`) --
none exist; the one nearby assertion referencing similar-looking strings
(`active-transition-fast-unconfirmed`, `fast-path-storage-lane-timeout`,
region #3's dead-code span) matches different, untouched content, so no
test update was needed.

### Regions #3/#4/#5 -- fresh re-map post-P2-10 (2026-09)

Per an explicit "go through all of those" request covering the rest of
`confirmQueuedTabOpenDurableActiveEffect`. Re-grepped: the function is
now 29157-29518 (P2-10 shifted everything below its insertion point by a
net -18 lines). Read the whole remaining body fresh rather than trusting
the pre-P2-10 line numbers in the map above.

**Region #3 (dead-code guard, 29212-29232): confirmed still dead, no
extraction planned.** Traced control flow again from the current source:
`if(returnAfterDurableActive) { ... return ... }` at 29188 always returns
when `returnAfterDurableActive` is true, so by line 29212
`returnAfterDurableActive` is unconditionally `false` and the guard's
condition can never be true. This is pre-existing dead code, unrelated to
this decomposition effort. Extracting dead code serves no Part 2 goal
(there's no await-reordering risk to resolve in code that never runs) and
would just be noise -- **explicitly leaving this resident, documented
here rather than touched**, consistent with the "honest not-much-here" as
a fully valid slice outcome established since P2-7.

**Region #4 (29244-29390): the `activeTransitionContinued`/rollback
split.** Two genuinely different pieces:

- **4a -- continuation-choice guard (29244-29259):** `if(!activeTransitionAccepted)
  { activeTransitionContinued = shouldKeepQueuedTabOpenAfterActiveTransitionFailure(...) }`
  then `if(activeTransitionContinued) { setQueuedTabMetadata(...);
  scheduleCoordinatorQueueResume(...) }` (falls through to the shared
  final `return` at 29511-29517 when taken). Fully sync, no awaits
  anywhere in this span, structurally the same shape as every clean
  decide extraction already done. **Slice P2-11 target: extract as
  `decideActiveTransitionContinuationChoice(params)`**, returning
  `{activeTransitionContinued}` so the shell can still branch into the
  `else if(!activeTransitionAccepted)` rollback path below it -- the
  decide function performs the metadata/schedule side effects itself
  when continuing, matching the established precedent (e.g.
  `decidePostOpenFailureRecoveryOutcome` also calls
  `scheduleCoordinatorQueueResume` from inside a decide function). Params:
  `activeTransitionAccepted`, `action`, `tab`, `plan`, `activeTransitionError`.

- **4b -- rollback path (29260-29390):** genuinely await-dominated, the
  same shape as `fillQueuedTabsOnce`'s old regions #4/#5/#7 --
  `markQueuedTabClosing` -> `await rollbackFailedQueuedTabOpen(...)` ->
  sync early-return if `rolledBack` (but that branch itself does `await
  browser.tabs.remove(...)`, so it's mixed, not pure decide) -> a
  conditional-await resolution of `currentAuthorityState` (act) -> a pure
  sync block deriving `profileHref`/`coordinatorKey`/`currentItem`/
  attempt-id comparisons into `sameTabReclaimedByDifferentAttempt`
  (29291-29307, decide-able on its own, but its consuming branch again
  does `await browser.tabs.remove`, so only the boolean computation
  itself is extractable, not the branch that acts on it) -> nested
  `if(activeTransitionSettled)` with another conditional-await resolution
  of `state` (act) -> another pure sync `rowStayedQueued` derivation
  (29332-29347, same shape as the one above -- **this is the second,
  near-identical copy** of the reclaimed-attempt-style boolean derivation
  pattern seen in region #5 below) -> that branch too does `await
  browser.tabs.remove`. **Assessment: only the two boolean-derivation
  spans (29291-29307 and 29332-29347) are pure decide candidates; every
  branch that consumes them is itself mixed await/sync "act," not
  extractable.** Given each derivation needs ~6 params threaded
  (`currentAuthorityState`/`state`, `plan`, `action`, `tab`, plus a couple
  locals) for a payoff of isolating a ~15-line boolean expression whose
  surrounding control flow stays in the shell either way, this is a
  marginal win at real complexity cost. **Decision: extract 4a only in
  Slice P2-11; leave 4b resident and documented, matching the P2-7
  "honest not-much-here" precedent** -- the two boolean derivations are
  candidates for a *future* slice only if this same duplicated pattern
  gets revisited (see region #5's note below).

**Region #5 (29392-29509): the `else` branch (`returnAfterDurableActive`
false, transition accepted immediately by the `.then()` deferred-settle
path or resolved before the `try` completed).** Structure:

- `markQueuedTabDurablyActive(tab.id, 'active-transition')` (sync).
- `if(returnAfterDurableActive) { return {...} }` (29394-29402) --
  **also confirmed dead code**, same reasoning as region #3
  (`returnAfterDurableActive` is unconditionally `false` inside this
  `else` branch, since the `if(returnAfterDurableActive)` at 29188
  already returned earlier when true). Leave resident, documented, no
  extraction -- same call as region #3.
- Conditional-await authority hydration (29403-29407, act) -> pure sync
  derivation of `profileHref`/`coordinatorKey`/`currentItem`/
  `sameTabReclaimedByDifferentAttempt` (29408-29425) -- **the same
  boolean-derivation shape as region 4b's first span**, but here its
  consuming branch (29426-29448) also mixes `await browser.tabs.remove`,
  so again only the derivation itself is a pure decide candidate, not the
  branch. **Slice P2-12 target: extract this derivation** as
  `decideSameTabReclaimedByDifferentAttempt(params)` (or a name shared
  with region 4b's near-identical span if a shared helper reads better
  once both are in hand -- decide during execution, not preemptively,
  since the two spans differ slightly: region 4b reads from
  `currentAuthorityState.queue`/`currentQueue[key]` shaped data, region 5
  reads from `currentAuthorityState.queue?.[key]` directly with a
  different tab-id field precedence; confirm they're truly identical
  logic before merging, don't assume from similar shape alone).
- `await getQueuedExecutorTabStatusWithTimeout(...)` (act) -> sync branch
  on `liveTabStatus` with three shapes (`missing` -> rollback+return,
  `!tab` -> metadata+schedule, `else` implicit fallthrough to final
  return) (29449-29508). The `missing` branch does more awaits
  (`rollbackFailedQueuedTabOpen`, conditional `releaseQueuedTab`); the
  `!liveTabStatus.tab` branch (29497-29508, the tab-lookup-failed/timeout
  case) is fully sync (`setQueuedTabMetadata` + `scheduleCoordinatorQueueResume`,
  falls through to final return) -- **another clean decide candidate**,
  Slice P2-12 territory alongside the derivation above.

**Plan: Slice P2-11 does region 4a only (the safe win). Slice P2-12
covers region 5's two extractable spans (the reclaimed-attempt
derivation + the tab-lookup-failed sync tail) and finalizes the
assessment on whether 4b's and 5's boolean derivations should share a
helper.** Both regions #3 and the dead branch inside region #5 are
addressed by this documentation, not by code changes -- that satisfies
"go through all of those" for those two without forcing a pointless
extraction.

### Slice P2-11 -- activeTransitionContinued guard (region 4a) (done)

Completed (done directly, same as P2-9/P2-10; independently re-verified
by reading the full diff and running the full test suite twice, both
green, plus both production builds). Extracted the guard computation and
its `if(activeTransitionContinued) {...}` side-effect branch (lines
29244-29259 pre-edit) into `decideActiveTransitionContinuationChoice(params)`,
taking `{activeTransitionAccepted, activeTransitionError, action, tab,
plan}` and returning `{activeTransitionContinued}`.

Unlike P2-9/P2-10 this was **not** a pure textual move: the original
`if(activeTransitionContinued) {A} else if(!activeTransitionAccepted)
{B}` became `activeTransitionContinued = decide(...).activeTransitionContinued;
if(!activeTransitionContinued && !activeTransitionAccepted) {B}` (with
`A`'s side effects now living inside the decide function). Hand-traced
all three reachable cases to confirm equivalence: (1)
`activeTransitionContinued` true -> decide performs `A`'s side effects,
shell's `if` is false, `B` skipped, matches original; (2)
`activeTransitionContinued` false and `activeTransitionAccepted` false ->
decide performs no side effects, shell's `if` is true, `B` runs, matches
original's `else if(!activeTransitionAccepted)`; (3)
`activeTransitionContinued` false and `activeTransitionAccepted` true ->
neither `A` nor `B` runs in either version. All three match.

Found and fixed one real test dependency: `test/p1-contract.test.js`'s
`'background tab opening updates authoritative Current Work'` test had
`assert.match(activeEffectBody.slice(failedTransitionIndex),
/shouldKeepQueuedTabOpenAfterActiveTransitionFailure\(/)`, which broke
because that call moved out of `confirmQueuedTabOpenDurableActiveEffect`'s
body entirely. Added an `extractFunction` call for the new
`decideActiveTransitionContinuationChoice` and pointed that assertion (and
the `active-transition-continued` half of a combined regex-alternation
assertion, split out for precision) at the new function's body instead.

### Slice P2-12 -- region 5's reclaimed-attempt derivation (done)

Completed (done directly; independently re-verified by reading the full
diff -- confirmed byte-for-byte textual move -- and running the full test
suite twice more, both green, plus both production builds). Extracted
the sync derivation of `profileHref`/`coordinatorKey`/`currentItem`/
attempt-id comparisons -> `sameTabReclaimedByDifferentAttempt` (lines
29417-29434 pre-edit) into `decideActiveTransitionReclaimedByDifferentAttempt(params)`,
taking `{currentAuthorityState, plan, action, tab}` and returning
`{sameTabReclaimedByDifferentAttempt}`. Confirmed nothing past the
consuming `if` block in this region reads `profileHref`/`coordinatorKey`/
`currentItem` again, so only the one boolean needed to cross the
function boundary.

**Resolved the "shared helper?" question from the mapping note: no, keep
them separate.** Compared this span against region 4b's near-identical-
looking derivation (lines 29312-29316ish, still resident) line by line:
they differ in three ways that make merging risky rather than a clean
dedup -- (1) region 4b pre-derives `currentQueue = currentAuthorityState?.queue
|| {}` and indexes `currentQueue[key]`, while region 5 indexes
`currentAuthorityState?.queue?.[key]` directly; (2) region 4b compares
`normalizeTabId(currentItem.tabId || currentItem.activeTabId || null) ===
normalizeTabId(tab.id)` with no optional chaining on `currentItem` or
`tab` (both presumed non-null in that branch), while region 5 computes a
`currentTabId` local first with `currentItem?.`/`tab?.id` optional
chaining and an extra `currentTabId &&` truthy guard before the equality
check -- these produce different results for a hypothetical falsy-but-
defined tab id (e.g. `0`, if that ever occurs); (3) `currentAuthorityState`
itself comes from different sources in each branch (region 4b:
`options.currentAuthorityState` or a fresh
`loadCoordinatorQueueProjection()`; region 5: `coordinatorAuthority.current()`,
possibly hydrated). Forcing a shared helper would mean either silently
picking one behavior for both call sites (a real, if probably rarely
triggered, behavior change) or adding parameters just to preserve the
divergence, which defeats the purpose of sharing. Leaving them as two
separate, independently-named functions once both are extracted is the
correct call -- flagging the near-duplicate shape here for whoever next
touches either one, but not merging speculatively.

**Region 5's tab-lookup-failed sync tail (the `else if(!liveTabStatus.tab)`
branch, unconditional `setQueuedTabMetadata` + `scheduleCoordinatorQueueResume`,
falls through to the shared final return) was assessed and deliberately
left resident, not extracted.** Unlike every other extraction in this
slice, this span makes no decision of its own -- the branch it's
gated behind is already resolved by the caller's `if`/`else if`, so
extracting it would only wrap 5 lines of unconditional side effects in a
new function name with zero readability or risk-reduction benefit. This
matches the standing principle (stated since P2-7) that forcing an
extraction just to say a region is "done" is not the goal.

**Regions #3, #4b, and region 5's dead-code branch and tab-lookup-failed
tail are now all explicitly assessed and either extracted or
deliberately left resident with documented reasoning.** This completes
the "go through all of those" pass over
`confirmQueuedTabOpenDurableActiveEffect`'s regions 3 through 5.
`confirmQueuedTabOpenDurableActiveEffect` itself remains a single `async`
function (Part 2 discipline, pending Phase 0), now with 4 named
`decide*` helpers pulled out of it (`decideFastActiveTransitionOutcome`,
`decideActiveTransitionContinuationChoice`,
`decideActiveTransitionReclaimedByDifferentAttempt`, plus the untouched
region 4b/dead-code observations). Region 1 (the Promise-chain
construction) and region 4b (the rollback path) remain resident by
design, both assessed as genuinely act-dominated. No further Part 2
target has been chosen yet; the "Next 20 Part 2 targets" list remains the
candidate pool pending explicit direction.

## Part 2 continued -- runCoordinatorQueueExecutorFastPath

Priority target #3. Fresh read (2026-09, current lines 18627-18927, ~300
lines; re-verify before executing) of the whole function.

**Map of decide/act spans:**

1. **Setup prelude (18628-18641):** fill-promise cleanup if/else,
   `coordinatorFastExecutorActiveUntil` bump, `volatileQueuedActionsAtStart`
   capture, a metric increment. Fully sync but pure unconditional
   initialization, not a decision -- same call as `fillQueuedTabsOnce`'s
   own prelude (P2-2's note: "not a clean alternating decide/act pattern").
   Leave resident.
2. **Paused-check guard (18642-18655):** `if(options.skipPauseStorageCheck
   !== true && await isCoordinatorPausedInStorage(...))` -- the await is
   embedded in the condition itself (short-circuits when the option is
   set). Consequent (18644-18654) is fully sync: metric increment, a
   fire-and-forget `void browser.alarms?.clear?.(...).catch(...)`, bare
   return. **Clean candidate** -- resolve the boolean in the shell
   (preserving the short-circuit by assigning to a local first, same
   `&&` semantics either way), then call a decide function for the
   consequent. Do this first.
3. **Resident-authority-state resolution (18656-18716):** the real
   complexity. An initial pure-sync prefix (18656-18667: `runtimeCountsAtStart`,
   `runtimeSurfaceEmptyAtStart`, initial `residentAuthorityState`, a
   conditional `recordResidentAuthorityStaleQueuedActions` side-effect
   call, initial counts) is itself extractable -- but everything after it
   (18668-18716) is two layers of `if(!effectiveResidentAuthorityHasDurableWork)`
   fallback, each gated behind its own conditional `await` (`metricStorageGet`,
   `loadCoordinatorQueueProjection`) with substantial sync computation
   feeding into and out of each await (queue normalization, count
   recalculation, `refreshResidentCoordinatorAuthorityState` calls that
   mutate resident module state). Same shape as `fillQueuedTabsOnce`'s
   region #2 ("not a clean single extraction"). **Assessment: extract
   only the pure-sync prefix (18656-18667); leave the two-layer fallback
   resident and documented**, matching the P2-7/4b precedent for
   genuinely act-dominated regions.
4. **`forceDurableQueueReloadForRuntimeRecovery` computation (18717-18724):**
   small, fully sync, no return -- fold into whichever neighboring slice
   reads most naturally, or leave inline; low priority either way.
5. **Throttle gate (18725-18744):** `getQueueLoadThrottle()` then two
   sync `if` branches, no awaits anywhere. **Looks structurally similar
   to the already-extracted `decideQueueLoadThrottleGate`
   (`fillQueuedTabsOnce`'s region #1) but is NOT the same logic** --
   confirmed by reading both: different condition shape
   (`throttle?.active === true && getSchedulerBlockingQueuedExecutorCount() > 0`
   vs `throttle.active && queueRuntime.getActivationIntentCount() &&
   getSchedulerBlockingQueuedExecutorCount() >= 1`), different metric
   names (`pump.fastExecutor.throttled` vs `pump.noop.throttled`),
   different return shape, and a second `rememberQueueLoadProgress`
   branch this one has that the other doesn't. **Needs its own new
   decide function, not reuse** -- same "verify before merging" lesson
   as P2-12's finding on the reclaimed-attempt derivations.
6. **Authority preflight (18746-18775):** `await
   runCoordinatorAuthorityReconcileActions(...)` (act) then a fully sync
   guard-and-branch (18754-18774: set flags, metric increments, schedule
   call, either continue or bare-return). **Clean candidate**, same
   proven shape as regions 2 and 6 above.
7. **`forceDurableQueueReload`/`currentAuthorityState` ternary (18777-18780):**
   trivial, 4 lines, no meaningful decision -- leave inline.
8. **Main resume call (18782-18814):** `await promiseWithTimeout(resumeCoordinatorQueueExecutionOnce(...), ...)`.
   Genuine I/O, the function's core "act." The options object passed in
   is itself just sync construction, not a decision -- not a Part 2
   target (building a literal isn't "deciding" anything). Leave resident.
9. **Post-resume cleanup (18815-18830):** three sub-spans, only the
   middle one has an await -- `if(volatileQueuedActionsAtStart > 0 && ...)`
   metric increment (18815-18820, sync) -> `if(authorityPreflightChanged
   && options.continueAfterAuthorityPreflight === true) { await
   coordinatorAuthority.hydrate().catch(...) }` (18821-18823, act, must
   stay resident and sequenced between the two sync spans) -> fill-promise
   cleanup (18824-18830, sync). Each sync half is individually small (5-6
   lines); **low priority, marginal value given the size** -- candidates
   only if a later slice wants to be thorough, not a priority pick.
10. **Empty-runtime retry block (18832-18875):** fully sync
    (`runtimeCountsAfterResume`, `runtimeSurfaceEmpty`,
    `queuedOrPendingPlanned` computation, then a large multi-condition
    `if` with a bare-return branch). No awaits anywhere in this span.
    **Clean, sizeable candidate**, same shape as several already-extracted
    bare-return blocks in `fillQueuedTabsOnce`.
11. **Final change-detection/scheduling/return tail (18877-18926):**
    fully sync, no awaits -- `changed`/`reportedChanged` computation,
    several `if` branches with `scheduleCoordinatorQueueResume`/
    `scheduleCoordinatorReconcile`/metric calls, ending in the function's
    final `return`. **Clean, sizeable candidate**, same shape as
    `fillQueuedTabsOnce`'s region #9 tail (`decideFillQueuedTabsOnceOutcome`).

**Priority order for extraction: #2 (paused-check), #5 (throttle gate),
#6 (authority preflight), #10 (empty-runtime retry), #11 (final tail),
then #3's pure-sync prefix if there's appetite for a smaller marginal
win. #1, #3's fallback layers, #4, #7, #8, #9 stay resident as assessed
above.**

### Slice P2-13 -- paused-check guard (region 2) (done)

Completed (done directly; independently re-verified by reading the full
diff and running the full test suite twice more, both green, plus both
production builds). Extracted the consequent of the paused-check guard
into `decideFastExecutorPausedOutcome()` (no params -- the whole
consequent is self-contained, referencing only module-scope
`incrementQueueWakeupMetric`/`browser`/`COORDINATOR_RESUME_ALARM_NAME`).
The guard's condition itself
(`options.skipPauseStorageCheck !== true && await isCoordinatorPausedInStorage(...)`)
now assigns to a `coordinatorPaused` local before the `if`, preserving
the original's `&&` short-circuit semantics exactly (assigning a
short-circuited boolean expression to a variable evaluates identically
to using it directly in an `if` condition -- confirmed, not just
assumed). Checked `test/p1-contract.test.js` for assertions on the moved
literals (`pump.fastExecutor.paused`, `coordinator-paused`,
`skipPauseStorageCheck`) scoped to `fastPathBody`
(`extractFunction(source, "async function runCoordinatorQueueExecutorFastPath(...)")`
at line ~3356) -- none exist; a separate, unrelated `resumeBody` also
matches the string `'coordinator-paused'` but extracts a different
function entirely, untouched by this slice.

### Slice P2-14 -- throttle gate (region 5) (done)

Completed (done directly; independently re-verified by reading the full
diff -- confirmed byte-for-byte textual move -- and running the full test
suite twice more, both green, plus both production builds). Extracted
the whole throttle-gate span (`getQueueLoadThrottle()` call plus both
`if` branches) into `decideFastExecutorThrottleGate(params)`, taking
`{options}` and returning either the throttled outcome object or `null`
(matching `decideQueueLoadThrottleGate`'s null-return-means-not-throttled
convention). Confirmed `throttle` is not referenced anywhere else in
`runCoordinatorQueueExecutorFastPath` after this span, so the whole local
could move without leaving anything behind. Checked
`test/p1-contract.test.js` for references to the moved literals
(`queue-load-throttle`, `pump.fastExecutor.throttled`,
`rememberQueueLoadProgress`) -- the one hit
(`decideQueueLoadThrottleGate` at line ~4856) is the unrelated,
already-confirmed-different `fillQueuedTabsOnce` throttle gate from
P2-2/P2-14's own mapping note; untouched by this slice, no update
needed.

### Slice P2-15 -- authority preflight (region 6) (done)

Completed (done directly; independently re-verified by reading the full
diff and running the full test suite twice more, both green, plus both
production builds). The `await runCoordinatorAuthorityReconcileActions(...)`
call and its options-object construction stayed resident (genuine I/O);
extracted the sync guard-and-branch that consumes its result (18768-18788
pre-edit) into `decideFastExecutorAuthorityPreflightOutcome(params)`,
taking `{authorityPreflight, reason, options}` and returning
`{authorityPreflightChanged, earlyReturn}` (`earlyReturn` is either the
bare-return object or `null` to continue) -- the shell destructures both
fields, matching the same discriminated-outcome-plus-continue shape used
for several `fillQueuedTabsOnce` extractions.

Found and fixed **two** real test dependencies in
`test/p1-contract.test.js`'s `'idle storage updates reconcile durable
active work before queue fill'` test (the one with `fastPathBody`):
`assert.match(fastPathBody, /pump\.fastExecutor\.authorityPreflightContinued/)`
and `assert.doesNotMatch(fastPathBody, /post-authority-preflight[\s\S]{0,250}scheduleCoordinatorReconcile/)`
both targeted content that moved out of `fastPathBody` entirely. Added an
`extractFunction` call for the new `decideFastExecutorAuthorityPreflightOutcome`
and re-pointed both assertions at it -- the second one especially needed
re-pointing rather than just leaving it (a `doesNotMatch` against content
that no longer exists in `fastPathBody` would have passed vacuously,
silently stopping it from actually verifying the anti-regression
invariant it was written for). Double-checked
`options.continueAfterAuthorityPreflight === true` and
`authorityPreflightChanged`-referencing assertions still hold: both
strings still appear in `fastPathBody` from other, untouched usages
further down the function (lines ~18826/18849/18911 for the former, the
`forceDurableQueueReload`/`changed` computations for the latter), so
those assertions needed no change.

### Slice P2-16 -- empty-runtime retry block (region 10) (done)

Completed (done directly; independently re-verified by reading the full
diff -- confirmed byte-for-byte textual move -- and running the full test
suite twice more, both green, plus both production builds). Extracted
the whole span (`runtimeCountsAfterResume`/`runtimeSurfaceEmpty`/
`queuedOrPendingPlanned` computation, the large multi-condition guard,
and its bare-return body) into
`decideFastExecutorEmptyRuntimeRetryOutcome(params)`, taking
`{options, result, reason}` and returning either the early-return object
or `null` (same null-means-continue convention as P2-14's throttle gate).
Confirmed none of the three locals it computes are referenced anywhere
else in `runCoordinatorQueueExecutorFastPath` after this span. Checked
`test/p1-contract.test.js` for references to the moved literals
(`emptyRuntimeRetry`, `empty-runtime-retry`, `emptyRuntimeDurableReload`,
`runtimeSurfaceEmpty`) -- none exist, no test update needed.

### Slice P2-17 -- final tail (region 11) (done)

Completed (done directly; independently re-verified by reading the full
diff -- confirmed byte-for-byte textual move -- and running the full test
suite twice more, both green, plus both production builds). Extracted
the whole final span (`changed`/`reportedChanged` computation, three
scheduling `if` branches, the function's terminal `return`) into
`decideFastExecutorFinalOutcome(params)`, taking `{result,
authorityPreflightChanged, options, reason, authorityPreflight}` and
returning the final result object directly -- same shape as
`fillQueuedTabsOnce`'s region #9 tail extraction (`decideFillQueuedTabsOnceOutcome`).

Found and fixed **five** real test dependencies in the same
`'idle storage updates reconcile durable active work before queue fill'`
test as P2-15: three positive assertions
(`if(result?.timedOut === true) {...}`, the `changed` computation, the
`if(changed) {...}` branch) and two negative `doesNotMatch` assertions
(`timeout-continuation...scheduleCoordinatorReconcile`,
`changed-without-runtime...scheduleCoordinatorReconcile`) all targeted
content that moved out of `fastPathBody`. Added an `extractFunction` call
for `decideFastExecutorFinalOutcome` and re-pointed all five at it --
again taking care with the two `doesNotMatch` assertions specifically,
since leaving them against `fastPathBody` would have made them pass
vacuously (the strings they check for no longer appear there at all)
rather than actually re-verifying the anti-regression invariants they
were written for.

**This completes every region on Slice P2-13's priority list** (#2, #5,
#6, #10, #11) for `runCoordinatorQueueExecutorFastPath`.
`runCoordinatorQueueExecutorFastPath` now has 5 named `decide*` helpers
pulled out of it. Regions #1 (setup prelude), #3 (resident-authority-state
resolution, except its pure-sync prefix), #4 (small ternary), #7
(trivial ternary), #8 (main resume I/O call), and #9 (post-resume cleanup,
marginal value) remain resident, all assessed and documented above as
either genuinely act-dominated or too marginal to be worth the added
indirection. No further Part 2 target has been chosen yet; the "Next 20
Part 2 targets" list remains the candidate pool pending explicit
direction (`resumeCoordinatorQueueExecutionOnce` is priority #4 next).

## Part 2 continued -- resumeCoordinatorQueueExecutionOnce

Priority target #4. Fresh read (2026-09, current lines 17650-17923, ~274
lines; re-verify before executing) of the whole function.

**Map of decide/act spans:**

1. **Setup prelude (17650-17685)** -- mostly sync computation of many
   locals threaded through the rest of the function
   (`serviceWorkerOwned`, `queueOnlyAuthority`, `residentAuthorityStateForResume`,
   `shouldUseProjectionFallbackForResume`, etc.), plus one conditional
   `await dedupeCoordinatorTabs(...)` embedded in the `existingCoordinator`
   ternary. Same shape as `fillQueuedTabsOnce`'s own prelude -- not a
   decide target on its own since nearly everything computed here is
   consumed downstream. The trailing `if(!ownerTabId) {...; return {...}}`
   guard (17681-17685) is technically a clean small decide-and-return, but
   given its size (5 lines, no reused params beyond `cycle`) the payoff is
   marginal -- candidate only if doing a thorough pass, not a priority.
2. **Local pause-request guard (17707-17711)** -- `if(isCoordinatorPauseRequestedLocally())
   {...; return {...}}`, fully sync, checked *before* the `pausedState`
   fetch below. **Clean, small, proven-shape candidate** (same pattern as
   `decideFastExecutorPausedOutcome`).
3. **Stored pause-state guard (17715-17719)** -- `if(pausedState[COORDINATOR_PAUSED_KEY])
   {...; return {...}}`, fully sync, checked *after* `pausedState` is
   resolved (17712-17714, a conditional-await/ternary). **Clean, small
   candidate, but must stay a separate decide function from #2** -- the
   two guards have genuinely different return shapes (`paused: true` on
   the local-pause branch, absent on the stored-pause branch) and,
   crucially, merging them into one function called after `pausedState`
   resolves would change behavior: today, a locally-paused coordinator
   returns *without ever calling* `metricStorageGet` for `pausedState`;
   collapsing the two checks into one post-fetch decide function would
   make that storage read happen unconditionally. Keep them as two
   separate small decide functions, in their original relative order
   around the fetch.
4. **"Should call `fillQueuedTabs` again" guard (17753-17764)** -- the
   condition (17753-17757, five ANDed clauses, fully sync) gates an
   `await fillQueuedTabs({...}).then(result => applyResult.fillResult = result)`-
   shaped act. **Extract just the boolean condition** as a decide
   function returning `true`/`false`; the shell keeps the await and the
   `applyResult.fillResult = ...` assignment (which itself references the
   awaited result, so it can't move into the decide function).
5. **The fallback block (17765-17868, ~104 lines)** -- the real
   complexity, same shape as `fillQueuedTabsOnce`'s and
   `confirmQueuedTabOpenDurableActiveEffect`'s hardest regions: a large
   sync multi-clause guard condition (17765-17777, 13 lines) gates a body
   that does a conditional `await metricStorageGet(...)` -> sync
   `rawQueue`/`pendingRawItems` computation -> an `if/else` where *both*
   branches mix sync setup, an `await enqueueExistingExecutorForCoordinator(...)`,
   and sync result-merging back onto `applyResult`. **Assessment,
   matching the established precedent for this shape:**
   - The top-level guard condition (17765-17777) is a clean decide
     candidate on its own -- extract just the boolean, matching #4's
     pattern.
   - The two sync computation spans right after each conditional fetch
     (`rawQueue`/`pendingRawItems` at 17783-17788, `walQueueCounts`/
     `pendingWalItems` at 17832-17834) are individually small, clean
     decide candidates (pure derivations from an already-resolved value).
   - Everything else in this block -- the `if(pendingRawItems.length)`/
     `else` branches themselves, and everything inside them -- mixes
     awaits with sync setup/result-merging inseparably and should stay
     resident, matching the P2-7/4b "honest not-much-here" precedent.
6. **Final tail (17870-17922)** -- fully sync, no awaits anywhere: a
   sequence of `if(applyResult.reason === ...)`/`else if`/`else` branches
   each calling `finishQueueWakeupMetricCycle` and returning, ending in an
   unconditional final `return`. **The best target in this function** --
   same shape as `fillQueuedTabsOnce`'s region #9
   (`decideFillQueuedTabsOnceOutcome`) and
   `runCoordinatorQueueExecutorFastPath`'s region #11
   (`decideFastExecutorFinalOutcome`). Do this one first.

**Priority order: #6 (final tail) first, then #2/#3 (the two pause
guards), then #4 and #5's boolean-only extractions. #1 and the rest of
#5 stay resident as assessed above, low priority or genuinely
act-dominated respectively.**

Same verification rigor as every prior Part 2 slice.

### Slice P2-18 -- final tail (region 6) (done)

Completed (done directly; independently re-verified by reading the full
diff -- confirmed byte-for-byte textual move -- and running the full test
suite twice more, both green, plus both production builds). Extracted
the whole final span (three `if(applyResult.reason === ...)`-style
branches, an `if/else if/else` on `queued`/`adopted`/`terminalizedExhausted`,
and the terminal `return`) into
`decideResumeCoordinatorQueueExecutionOnceOutcome(params)`, taking
`{applyResult, cycle}` and returning the final result object directly --
same shape as the two prior "final tail" extractions
(`decideFillQueuedTabsOnceOutcome`, `decideFastExecutorFinalOutcome`).
Checked `test/p1-contract.test.js` for assertions scoped to `resumeBody`
(`extractFunction(source, 'async function resumeCoordinatorQueueExecutionOnce(...)')`,
used across 4 separate tests) that might target the moved content -- none
do; the `'coordinator-paused'`/`COORDINATOR_PAUSED_KEY` matches at one of
those call sites resolve against the two still-resident pause guards
(region 2/3, not yet extracted), confirmed by grepping the current
function body directly rather than assuming.

### Slice P2-19 -- the two pause guards (regions 2/3) (done)

Completed (done directly; independently re-verified by reading the full
diff and running the full test suite twice more, both green, plus both
production builds). Extracted the local pause-request guard into
`decideResumeCoordinatorLocallyPausedOutcome({cycle})` and the
stored-pause-state guard into
`decideResumeCoordinatorStoredPausedOutcome({cycle, pausedState})`,
kept as two separate functions per the mapping note's warning (merging
them would make the `metricStorageGet` fetch happen unconditionally even
when locally paused, a real behavior change). Both use the established
null-means-continue return convention; the shell resolves `pausedState`
between the two calls exactly where the original code did, preserving
the original check order.

Found and fixed one real test dependency: `test/p1-contract.test.js`'s
`'dashboard has reversible pause and explicit current work cancel'` test
had `assert.match(resumeBody, /reason: 'coordinator-paused'/)`, which
broke because that literal (the object-shorthand `reason:` key -- as
opposed to the `applyResult.reason !== 'coordinator-paused'` comparison
elsewhere, which doesn't match the same regex) no longer appears
anywhere in `resumeBody` at all, both occurrences having moved into the
two new decide functions. Added an `extractFunction` call for
`decideResumeCoordinatorStoredPausedOutcome` and re-pointed the
assertion at it, pairing naturally with the adjacent
`COORDINATOR_PAUSED_KEY` assertion (still valid against `resumeBody`
unchanged, since that constant is used several more times later in the
function's still-resident fallback region).

### Slice P2-20 -- "should revalidate fill" guard (region 4) (done)

Completed (done directly; independently re-verified by reading the full
diff -- confirmed byte-for-byte textual move of the condition -- and
running the full test suite twice more, both green, plus both production
builds). Extracted the five-clause boolean condition into
`decideResumeShouldRevalidateFillOutcome({options, applyResult})`,
returning the raw `&&`-chain value (not coerced to a strict boolean --
behaviorally identical in an `if(...)` regardless). The shell kept the
`await fillQueuedTabs({...})` call and the `applyResult.fillResult = ...`
assignment, since those depend on the awaited result and can't move into
a sync decide function. Checked `test/p1-contract.test.js` for
assertions on the moved literals (`runtime-action-revalidation`,
`queueRuntime.getActivationIntentCount() &&`) -- none exist, no test
update needed.

### Slice P2-21 -- fallback guard + two derivations (region 5's clean pieces) (done)

Completed (done directly; independently re-verified by reading the full
diff -- confirmed pure textual moves throughout -- and running the full
test suite twice more, both green, plus both production builds).
Extracted three pieces: the top-level fallback guard condition into
`decideResumeShouldUseFallbackOutcome(params)` (matching #4's
boolean-only-extraction pattern), and the two small sync derivations
(`rawQueue`/`pendingRawItems` from an already-resolved `rawQueueState`,
and `walQueueCounts`/`pendingWalItems` from an already-resolved
`walAuthorityState`) into `decideResumeRawQueueFallbackItems(params)` and
`decideResumeWalQueueFallbackItems(params)` respectively. Left everything
else in region 5 resident, per the mapping's assessment (the `if/else`
branches themselves mix awaits with sync setup/result-merging
inseparably).

Found and fixed one real test dependency: `test/p1-contract.test.js`'s
`'executor apply classifies before reducer decisions instead of
pre-filling runtime surfaces'` test had an assertion checking (in one
regex, via `[\s\S]*` ordering) that the fallback guard condition
appeared before `loadCoordinatorQueueProjection(...)` inside
`resumeBody` -- broke because the guard condition moved out of
`resumeBody` entirely. Added an `extractFunction` call for
`decideResumeShouldUseFallbackOutcome` and split the check in two: one
assertion confirming the new function's body still has the three key
condition clauses, and one confirming `resumeBody` still calls
`decideResumeShouldUseFallbackOutcome({...})` before
`loadCoordinatorQueueProjection({... 'pump.resume.storageProjectionFallback.load'...})`,
preserving the original ordering guarantee the test was written to
verify.

**This completes every region on `resumeCoordinatorQueueExecutionOnce`'s
priority list** (Slices P2-18 through P2-21). It now has 6 named
`decide*` helpers pulled out of it. Region 1 (setup prelude, except its
tiny no-coordinator guard) and the rest of region 5 (the interleaved
`if`/`else` branches) remain resident, assessed as either low-value or
genuinely act-dominated. No further Part 2 target has been chosen yet;
priority #5 (`sweepStaleQueuedTabs`) is next on the "Next 20 Part 2
targets" list.

## Part 2.5 -- moving the accumulated decide* functions into real modules

Now that Phase 0 has landed, the ~29 `decide*` functions Part 2 has
accumulated (all still physically resident in `sw.js`) can move into
real modules, matching every other Part 1 extraction's shape. Surveyed
the actual set (`grep -n '^function decide[A-Za-z]*(' shared/js/sw.js`)
and checked cross-references (`grep -c '\bfnName('` for each) before
designing the split, rather than assuming.

**Confirmed: every one of the 29 has exactly 2 references in the whole
file -- its own definition and exactly one call site, from its own
parent orchestrator function. None call each other.** This makes the
split trivial to reason about: no shared sub-dependencies between decide
functions, no risk of splitting a cluster that's secretly coupled.

**Grouping, by originating orchestrator (matches Part 1's per-domain
module convention, not one giant catch-all module):**

- **`swQueuedTabActiveTransitionDecisions.js`** (5 functions):
  `decideActiveTransitionOutcome`, `decideActiveTransitionMutation` (both
  from Slice P2-1, the technique's original proving ground -- these two
  predate the `params = {}` object-destructure convention every later
  slice settled on, using positional args instead; **leave that as-is,
  don't normalize it while moving** -- changing a call signature during
  what should be a behavior-preserving relocation adds risk for no
  benefit), `decideFastActiveTransitionOutcome`,
  `decideActiveTransitionContinuationChoice`,
  `decideActiveTransitionReclaimedByDifferentAttempt` (from Slices
  P2-10/P2-11/P2-12, `confirmQueuedTabOpenDurableActiveEffect`'s
  regions).
- **`swFillQueuedTabsOnceDecisions.js`** (12 functions, the largest
  group): `decideQueueLoadThrottleGate`, `decidePausedStateGate`,
  `decideActivationGuardClaim`, `decideProfileOpenReservationClaim`,
  `decideSlotOutcome`, `decideFinalOpenRecoveryOutcome`,
  `decidePreOpenRecoveryOutcome`, `decideLiveProfileTabCapacityGate`,
  `decidePreOpenPausedGate`, `decidePostOpenFailureRecoveryOutcome`,
  `decideReturnAfterDurableActiveOutcome`,
  `decideFillQueuedTabsOnceOutcome` (Slices P2-2 through P2-9,
  `fillQueuedTabsOnce`'s 9 regions).
- **`swFastExecutorDecisions.js`** (5 functions): `decideFastExecutorPausedOutcome`,
  `decideFastExecutorThrottleGate`, `decideFastExecutorAuthorityPreflightOutcome`,
  `decideFastExecutorEmptyRuntimeRetryOutcome`, `decideFastExecutorFinalOutcome`
  (Slices P2-13 through P2-17, `runCoordinatorQueueExecutorFastPath`).
- **`swResumeQueueExecutionDecisions.js`** (7 functions): `decideResumeCoordinatorLocallyPausedOutcome`,
  `decideResumeCoordinatorStoredPausedOutcome`,
  `decideResumeShouldRevalidateFillOutcome`,
  `decideResumeShouldUseFallbackOutcome`, `decideResumeRawQueueFallbackItems`,
  `decideResumeWalQueueFallbackItems`,
  `decideResumeCoordinatorQueueExecutionOnceOutcome` (Slices P2-18
  through P2-21, `resumeCoordinatorQueueExecutionOnce`).

**Execution shape, matching Part 1's established `createX(deps = {})`
factory convention** (see `shared/js/swQueuedTabOpenEffect.js` for a
faithful reference example): for each module, identify its functions'
full dependency footprint (every bare identifier referenced that isn't a
JS builtin or the function's own param) via grep, construct it in
`sw.js` immediately after `require`ing it, and destructure its exports
back onto the original bare names (the established trick that means
every one of the 29 call sites -- already confirmed to be exactly one
each -- needs zero edits beyond the destructure). Check each new
module's construction point against every already-extracted module's own
construction-time `deps` object literal for the TDZ/construction-order
hazard documented earlier in this plan (an eager bare-identifier
reference to a not-yet-constructed name) before picking where in `sw.js`
to place the `require`+construct call. No realm-crossing scrutiny is
needed for these moves -- Phase 0 resolved that for the whole file -- but
still confirm each function is a pure textual move (byte-identical body)
independently, the same rigor as every prior slice.

**Plan: four slices, one module each (P2.5-1 through P2.5-4), smallest
first** (`swQueuedTabActiveTransitionDecisions.js`, 5 functions) to prove
the pattern before the largest (`swFillQueuedTabsOnceDecisions.js`, 12
functions). Given the mechanical-but-error-prone nature of a dependency-
footprint inventory across many functions, and the proven success of the
Phase-0 sub-agent workflow, execute via one sub-agent per module (one at
a time), each independently re-verified in full (diff read, test suite
2-3x, both builds) before the next starts.

### Slice P2.5-1 -- swQueuedTabActiveTransitionDecisions.js (done)

Completed (commit `bde23f2`, via sub-agent; independently re-verified:
read the new module file in full and confirmed it matches the bodies
extracted earlier in this plan for P2-10/P2-11/P2-12, read the wiring in
`sw.js` (require + construct + destructure, standard shape), and -- since
this is the *first* module extraction after Phase 0, with no realm
concern to reason about but a fresh construction-order concern -- wrote a
small script checking all 19 injected dependencies are declared before
the construction call site (line 12349): all 19 confirmed declared
earlier in the file, no TDZ hazard. Confirmed `sw.js` no longer defines
any of the 5 functions itself (clean removal, not a duplicate). Ran the
full test suite twice more and both builds myself, all green. The two
positional-arg-style functions (`decideActiveTransitionOutcome`,
`decideActiveTransitionMutation`, predating the `params = {}` convention)
were correctly left unnormalized, matching the instruction not to
"modernize" them during a behavior-preserving move. One
`test/p1-contract.test.js` reference needed updating (an `extractFunction`
call targeting `decideActiveTransitionContinuationChoice`), fixed
following the established annotated-comment pattern; confirmed no other
stray references to the other 4 moved names existed.

### Slice P2.5-2 -- swFastExecutorDecisions.js (done)

Completed (commit `70afe42`, via sub-agent; independently re-verified:
read the new module file in full, confirmed it matches the bodies
extracted earlier for P2-13 through P2-17, read the wiring in `sw.js`,
and independently checked all 10 injected dependencies' declaration
lines against the construction call site (line 18653) myself -- all 10
confirmed declared earlier via `const`/destructure, no TDZ hazard;
`scheduleCoordinatorQueueResume`/`scheduleCoordinatorReconcile` are
destructured from an already-required scheduler module, not same-file
`function` declarations as the agent's report suggested, but still
resolve well before the construction site either way). Confirmed `sw.js`
no longer defines any of the 5 functions. Two
`test/p1-contract.test.js` references needed updating (both in the same
test, for `decideFastExecutorAuthorityPreflightOutcome` and
`decideFastExecutorFinalOutcome`); fixed following the established
pattern, confirmed no stray references to the other 3 moved names.
Ran the full suite twice more and both builds myself, all green.

## Phase 0 -- test harness realm fix (done; was the prerequisite for moving decide* logic into a module)

Before any of the ~17 `decide*` functions accumulated by Part 2 (or any
future one) can move out of `sw.js` into its own module, the test
harness's module-loading needs to stop mixing realms. This section
supersedes the earlier placeholder above with a concrete design, written
2026-09 after re-reading `test/lib/swHarness.js` in full and mapping the
actual `require()` graph rather than assuming its shape.

### The problem, restated precisely

`test/lib/swHarness.js`'s `loadServiceWorkerHarness()` does, today:

1. Reads `shared/js/sw.js`'s source as text, applies a handful of
   test-only string patches (injecting `__testHarnessDeactivated` guards,
   a throw-hook, timeout-constant overrides), and appends the
   `module.exports.__test = {...}` block that exposes internals to tests.
2. Builds a `context` object carrying `console`, `module`, `exports`, a
   `require: localRequire` function, a `FakeDate` wired to the harness's
   fake timers, the fake `setTimeout`/`clearTimeout`, and a curated set of
   built-ins (`Promise`, `Map`, `Set`, `JSON`, `Math`, etc. -- passed by
   reference from the outer Node realm, so identity-compatible, but the
   *context itself* is still a distinct V8 realm from plain Node code).
3. Wraps the patched source in a CJS-style function wrapper and runs it
   via `vm.runInNewContext(wrapper, context, {filename: swPath})` -- this
   both contextifies `context` and executes the wrapper in one call,
   creating a fresh realm every single invocation.
4. `localRequire` special-cases `webextension-polyfill` (returns the fake
   `browser`) and delegates every other `require()` call to
   `baseRequire = createRequire(swPath)` -- **real Node `require`,
   resolving and executing in the outer, non-sandboxed realm.**

Step 4 is the bug: every module `sw.js` requires -- all ~69 of them, plus
whatever they transitively require -- loads and runs in the plain Node
realm, not `sw.js`'s vm realm. `architecture.md`'s "Module Extraction And
The Test Harness Realm Boundary" section documents the consequence
(confirmed twice already, via the WAL-extraction regression and Slice 7):
a same-realm `await` chain costs one microtask tick, a chain crossing this
vm/Node boundary costs two, and that extra tick can silently reorder
concurrent reconcile-tick work with zero difference in the moved code's
logic. Production is unaffected -- webpack bundles every module into one
realm -- so this is purely a harness-fidelity gap, not a real
architectural constraint, but it has already blocked two real
extractions and gates every future one that touches `async`-adjacent
code.

### Confirmed scope of the require graph (2026-09 investigation)

Before designing the fix, mapped the actual graph rather than assuming
it:

- `sw.js` has 69 `require()` call sites (excluding `webextension-polyfill`),
  all first-party, all flat relative paths (`./xxx`, never `../xxx`, never
  a subdirectory, never a `.json` file).
- A handful of the ~76 files under `shared/js/` transitively require each
  other (e.g. `swCoordinatorQueueWal.js` -> `swstorage.js` -> `walSnapshotStore.js`;
  `swQueueMachineDispatcher.js`/`swQueueMachineHandlers.js` -> `swQueueMachineEvents.js`;
  a few others -> `subject.js`/`jobState.js`/`defaults.js`) -- same
  pattern, all flat relative requires within `shared/js/`.
- No first-party module requires anything outside `shared/js/`, a
  subdirectory, a `.json` file, or a Node builtin (`grep`-confirmed empty
  for all of these).
- Only two test files instantiate the harness at all:
  `test/swSynthetic.test.js` (535 `loadServiceWorkerHarness()` calls,
  sharded into the `synthetic-1`..`synthetic-46` parallel lanes) and
  `test/swScenarioFuzz.test.js` (2 calls). `test/p1-contract.test.js`
  reads `sw.js` as raw source text via regex/`extractFunction` and never
  touches the harness -- entirely unaffected by this change.

This is a small, closed graph with no exotic resolution cases to handle --
the fix doesn't need to replicate Node's full module resolution algorithm,
just flat-relative-path-plus-`.js` resolution.

### Design: a shared-context in-realm CommonJS loader

Replace step 4's `baseRequire` delegation with a hand-rolled loader that
compiles every first-party module into the **same** contextified sandbox
`sw.js` itself runs in, instead of a fresh one per file or the outer Node
realm:

1. Build the `context` object exactly as today (browser, FakeDate, fake
   timers, curated built-ins), but call `vm.createContext(context)`
   explicitly first instead of relying on `vm.runInNewContext` to do it
   implicitly. This contextified object is the one shared realm for this
   harness instantiation.
2. Replace `localRequire` with a loader keyed by resolved absolute path:
   - `webextension-polyfill` still returns the fake `browser` directly (no
     change).
   - A relative request (`./x`, `../x` -- none of the latter exist today,
     but resolve correctly anyway) resolves against the requesting
     module's own directory, appending `.js` if missing (no `.json`,
     no subdirectory `index.js` handling needed given the confirmed
     graph -- but resolve defensively rather than assuming the file
     exists without checking).
   - Anything else (a bare package name) falls through to the existing
     `baseRequire` as a defensive fallback -- should never be hit given
     today's graph, but fails safe rather than silently mis-resolving if
     a future module adds a real external dependency.
   - **Module cache**: a `Map<resolvedPath, moduleRecord>` scoped to this
     one harness instantiation (a fresh `Map` each `loadServiceWorkerHarness()`
     call, matching today's full per-call isolation). Insert the
     `moduleRecord` into the cache *before* running the module body (Node's
     own cache-then-run ordering), so a circular `require()` -- none exist
     today, per the graph above, but the loader shouldn't silently break
     if one is added later -- resolves to the same, if partially
     populated, `exports` object rather than recursing or duplicating.
   - Each file's source gets the same CJS wrapper treatment `sw.js`
     already gets (`(function(exports, require, module, __filename,
     __dirname) {...})`), compiled and run via `vm.runInContext(wrapper,
     context, {filename: resolvedPath})` against the **same** `context`
     object used for `sw.js` -- this is the one line that actually fixes
     the bug: same contextified sandbox means same realm, so `await`ing
     into any of these modules costs exactly the same one microtask tick
     as a same-realm call within `sw.js` itself, matching production.
3. `sw.js`'s own top-level `require` becomes this same loader, rooted at
   `path.dirname(swPath)`, so `sw.js` and everything it (transitively)
   requires now share one realm, uniformly -- not just future `decide*`
   modules, all ~69+ already-extracted Part 1 modules too. This is
   deliberate: per `architecture.md`'s finding, "all `require()`'d modules
   share one common realm with each other, separate from `sw.js`'s
   vm-sandboxed realm" today -- a fix that only special-cased *new*
   modules into `sw.js`'s realm while leaving the existing ~69 in the
   outer Node realm would create a third realm and likely make the
   crossing-counting problem worse, not better. Fixing it uniformly for
   the whole graph is both correct and no harder to implement than a
   partial fix.

### A side benefit worth calling out

Once a first-party module runs in the same contextified sandbox as
`sw.js`, it automatically sees the same `Date`/`setTimeout`/`clearTimeout`
(the fake-timer-backed ones) as its own globals -- no more need to
manually thread `now`/`Date.now`/environment-globals into a module purely
to keep it realm-consistent with the fake clock, the way the "Clock/
environment-global note" elsewhere in this plan requires for modules that
stay in the *current*, unfixed harness. That specific class of
dependency-injection boilerplate becomes optional (still fine for
testability if a module's author wants it, but no longer *mandatory for
correctness*) for any module extracted after Phase 0 lands. This doesn't
retroactively simplify already-extracted modules -- no reason to touch
those -- but it changes the calculus for what to inject going forward.

### Performance consideration

535 harness instantiations in `swSynthetic.test.js` alone means the new
loader will re-read and re-compile every first-party module's source on
every single call, rather than benefiting from Node's process-wide
`require` cache the way `baseRequire` does today. Two mitigating facts,
not a reason to skip addressing it:

- `sw.js` itself is *already* fully re-read, string-patched, and
  `vm`-compiled on every one of those 535 calls today (that's inherent to
  the string-patching approach, unrelated to this fix), and the current
  suite runs fast (each `synthetic-N` shard, averaging ~12 instantiations,
  finishes in roughly 1-2 seconds) -- so per-instantiation full
  recompilation of a large file is already proven not to be a bottleneck
  at this codebase's scale.
- Even so, the cheap, correct mitigation is to cache the **compiled**
  `vm.Script` object (not the module instance) at process scope, keyed by
  resolved absolute path, separate from the per-instantiation module-cache
  `Map` described above. `vm.Script#runInContext(context)` can be called
  against a different contextified sandbox each time, re-executing the
  same pre-parsed code to produce fresh, isolated module state per
  harness instantiation while paying the file-read and V8-parse cost only
  once per process. Implement this from the start rather than treating it
  as a follow-up -- it is a small addition to the loader (a second `Map`
  keyed by path, checked before `fs.readFileSync`) and removes any
  question about whether the fix measurably slows the suite down.

### Rollout and validation

This is a single, self-contained change to `test/lib/swHarness.js` --
no `sw.js` source changes, no changes to any already-extracted module.
Blast radius is exactly `swSynthetic.test.js`'s 535 calls and
`swScenarioFuzz.test.js`'s 2 calls; `p1-contract.test.js` and the `unit`/
`wal` lanes don't use the harness and are structurally unaffected.

1. Implement the loader as designed above, replacing `localRequire`'s
   `baseRequire` delegation for relative requires.
2. Run `npm run test:parallel` (the full suite, all lanes) at least
   three times given the blast radius -- this is the correct validation
   oracle: the existing synthetic and scenario-fuzz suites are already
   proven sensitive to exactly this class of tick-ordering bug (that's
   how the WAL extraction and Slice 7 findings were originally caught),
   so a clean pass across the whole suite is strong evidence the realm
   unification didn't silently reorder anything that matters.
3. **Anticipate, don't assume away, new failures.** Collapsing 69+ real
   crossings down to zero changes tick-relative ordering for *every*
   already-required module at once, not just future ones -- a test that
   happens to depend on today's harness-only double-tick behavior (rather
   than on `sw.js`'s actual logic) could start failing even though nothing
   about production behavior changed. If that happens: investigate each
   failure on its own merits the same way any other regression would be
   investigated, don't assume "the harness is just more correct now" as a
   substitute for checking. If a failure genuinely traces to a test
   asserting harness-artifact tick counts rather than real behavior, fix
   the test's expectation and say so in the commit; if it traces to
   something else, treat it as a real bug.
4. Run both production builds (`npx mix --production`,
   `node tools/build-chrome-dev.js`) as a sanity check even though this
   change touches no shipped code -- consistent with every other slice's
   verification bar in this plan.
5. After landing: update `architecture.md`'s "Module Extraction And The
   Test Harness Realm Boundary" section to record that the constraint is
   resolved (don't delete the section -- the history and the underlying
   mechanism are still worth keeping as context for why the harness is
   shaped this way). Update this plan doc's Part 1 "Excluded/resident-only
   regions" list and Part 2 completion notes to note that the realm
   constraint no longer blocks moving the accumulated `decide*` functions
   (or the 5 individually-reconfirmed-blocked Slice 44 stragglers, several
   of which were blocked specifically by this) into a real module,
   whenever that work is picked up next.

### Phase 0 execution slices

Per an explicit request to dole this out to small-context sub-agents
rather than a single large one, split into four bite-sized chunks. Each
sub-agent gets a self-contained prompt quoting the exact design above
plus the precise file/function targets below; each chunk is
independently verified (full diff read, `npm run test:parallel`, both
production builds) before the next one starts, one agent at a time.

**Slice P0-1 -- add the loader, unwired (additive only).** Add new code
to `test/lib/swHarness.js`: a module-level (process-scope)
`Map<absolutePath, vm.Script>` for the compiled-source cache described
above, and a factory function -- suggested name
`createSharedRealmRequire(context, browser, baseRequire)` -- that returns
a `require`-shaped function closed over a fresh per-call
`Map<absolutePath, moduleRecord>` instance cache. Implements: the
`webextension-polyfill` special case, relative-path resolution
(`path.resolve(callerDir, request)`, append `.js` if missing), the
cache-before-run insertion for circular-require safety, reading+compiling
via the `vm.Script` cache (compile once per process, `runInContext`
against the *current* `context` each call), and a fallback to
`baseRequire` for any non-relative, non-`webextension-polyfill` request.
**Do not call this function from `loadServiceWorkerHarness` yet** -- this
slice is purely additive so its own risk is near zero (nothing existing
changes behavior), verified by a full suite run confirming the baseline
still passes unchanged.

**Completed** (commit `db12da9`, via sub-agent; independently re-verified
by reading the full diff, confirming `createSharedRealmRequire`/
`compiledModuleScripts` are referenced nowhere outside their own
definition -- i.e. genuinely unwired -- and re-running the full test
suite myself, unchanged pass). Matches the design exactly: same function
names, same cache-before-run ordering, same `.js`-append resolution. The
agent's own verification included a throwaway standalone sanity check
(not committed) confirming the loader could actually `require('./defaults')`
successfully in isolation before wiring was attempted.

**Slice P0-2 -- wire it in.** In `loadServiceWorkerHarness`: replace
`vm.runInNewContext(wrapper, context, {filename: swPath})` with an
explicit `vm.createContext(context)` followed by
`new vm.Script(wrapper, {filename: swPath}).runInContext(context)`
(or equivalent), and replace `localRequire`'s body with a call to
`createSharedRealmRequire(context, browser, baseRequire)` rooted at
`path.dirname(swPath)`. This is the actual behavior-changing chunk --
everything `sw.js` requires now runs in its realm instead of the outer
Node realm. Verify with the full rigor the design's "Rollout and
validation" section specifies: `npm run test:parallel` at least three
times, both production builds, and if anything newly fails, investigate
it on its own merits rather than assuming "the harness is just more
correct now" -- per the design's explicit warning that collapsing 69+
realm crossings to zero can flip tick-relative ordering for tests that
happen to depend on today's harness artifact.

**Completed** (commit `372f5c9`, via sub-agent; independently re-verified
by reading the full diff, running `npm run test:parallel` twice more
myself, plus both production builds). Matched the design exactly: the
`context` object is built without a `require` key, `vm.createContext(context)`
is called explicitly, `localRequire` is derived from
`createSharedRealmRequire(context, browser, baseRequire)(path.dirname(swPath))`
and assigned onto `context.require` afterward, and `sw.js`'s own
(per-call-patched) source is compiled fresh every call via
`new vm.Script(wrapper, {filename: swPath}).runInContext(context)` --
deliberately never cached in `compiledModuleScripts`, since that cache is
only valid for the ~69 *required* modules whose source is identical every
call, not `sw.js` itself (whose source varies per test's `options`). The
agent also found and fixed a real gap the design didn't anticipate:
`Buffer`/`TextEncoder`/`TextDecoder` needed adding to the sandbox's
built-in globals list, since `walSnapshotStore.js` and
`swStorageMetrics.js` use them and previously got them for free as
ambient Node globals while running in the outer realm via `baseRequire`
-- independently confirmed by grepping both files' usage before accepting
the fix. One test-oracle gap in `swSynthetic.test.js` needed fixing
(a hardcoded assumption that every non-materialized branch always leaves
exactly 1 queued action, which doesn't hold for the
`queued-tab-fill-timeout-before-open-attempt` branch -- confirmed by
reading that branch's actual code at sw.js and finding it never mutates
the queue itself, so trusting `sw.js`'s own self-reported
`fillRemainingActions` field, which already existed on every
`unresolvedExecutorCases` entry, is more correct than the old fixed
assumption).

**This slice also surfaced a real, pre-existing production bug**, exactly
the kind of thing the design's "anticipate, don't assume away, new
failures" warning was written for. `SW_SCENARIO_FUZZ_SEED=0x5eed node
test/swScenarioFuzz.test.js` failed deterministically (`active queued tab
102 is missing from fake browser`) with the realm fix in place. Confirmed
independently (not just trusting the agent) via A/B: stashed the harness
change, reran the identical seed against unmodified `sw.js` -- passed
cleanly. This proved the tick-count collapse *exposed* a genuine
concurrency bug rather than *creating* a test-oracle mismatch. Traced the
mechanism by hand (see Slice P0-3 below) before handing the fix to
another sub-agent, per the design's explicit instruction not to wave
newly-surfaced failures away as "the harness is just more correct now."

### Slice P0-3 -- fix the exposed race (done)

Completed (commit `f845a99`, via sub-agent, after independent root-cause
tracing). `restoreActiveLiveCoordinatorQueuedTabAction` (`shared/js/sw.js`)
had exactly one entry-point guard (`wasQueuedRuntimeTabRemoved(tabId)`,
checking only whether a tab was *fully* removed from runtime tracking)
before its one real `await` (`getQueuedExecutorTabStatusWithTimeout`).
Confirmed by direct code reading that a concurrent `markQueuedTabClosing`
call (e.g. from `handleQueuedTabContentScriptEnsureResult`) sets the
*earlier*-stage `closeRequestedAt`/`closeReason` metadata signal, which
this function never checked at all, at any point -- so a close racing
against this function's await window went unnoticed and the function
proceeded to `applyQueuedTabOpenRuntimeEffect(plan)`, re-marking an
already-tearing-down tab as active, with nothing to ever clean it up
afterward (`queueRuntime.deleteActiveQueuedTab`'s one call site is gated
on `!runtimeDetached`, which doesn't apply to this path). Fix: a single
fresh re-check of both `wasQueuedRuntimeTabRemoved(tabId)` and
`preRestoreMetadata.closeRequestedAt`/`.closeReason` immediately before
`applyQueuedTabOpenRuntimeEffect(plan)` -- placed there deliberately so
it covers the entire window from function entry regardless of whether
the concurrent close happened before or during the await, rather than
needing two separate checks. Reused the exact
`closeRequestedAt || closeReason` idiom already used in several other
places in `sw.js`, confirmed via grep before writing the fix rather than
inventing a new predicate. Verified: seed `0x5eed` fails without the fix
and passes with it, the other two default scenario-fuzz seeds
(`0xc0de`, `0x51a7e`) continue to pass, full suite green across 3 runs
(agent) + 2 more (independent re-verification), both builds green.

**Slice P0-4 -- record completion.** Update `architecture.md`'s "Module
Extraction And The Test Harness Realm Boundary" section to note the
constraint is resolved (keep the history, don't delete it). Update this
plan doc: mark this whole Phase 0 section done with commit references,
and note in Part 1's "Excluded/resident-only regions" and the Part 2
target list that the realm constraint no longer blocks moving the
accumulated `decide*` functions -- or the Slice 44 stragglers that were
blocked by it -- into a real module.

## Risk controls

- One slice per commit, sized per the claim workflow above.
- Full `npm run test:parallel`, `npx mix --production`, and
  `node tools/build-chrome-dev.js` green after every slice.
- Mechanical-only changes during a move -- logic fixes are separate commits.
- Regenerate the inventory after every slice; never trust stale line
  numbers, including the ones in this document.
- Any slice that produces an unexplained test failure gets the same
  treatment the WAL attempt did: build a minimal repro before concluding
  it's safe or unsafe, don't guess.

## Effort expectation

931 top-level functions, a file with a demonstrated history of subtle
regressions (six independent correctness bugs found by one review pass
earlier this session), and a governing constraint that blocks the 298
`async` functions outright until separate harness work lands. At the
15-30-function slice size used above, Part 1 alone is on the order of 25-35
slices. This is a multi-session effort by design -- that's the point of
sizing it this way, so any single session or context-limited agent can pick
up exactly one slice, verify it fully, and hand off cleanly to the next.
