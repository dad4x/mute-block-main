# sw.js State Machine Decomposition Plan

Date: 2026-09-01

Status: Part 1 (sync-only extraction) is complete (Slices 1-44). Part 2
(async orchestration) is underway: Slice P2-1 (commits `25ae7d3`,
`675bca8`) proved the decide/act splitting technique end-to-end; Slices
P2-2 and P2-3 (commits `bdae45c`, `ad2f9d6`) have extracted 4 of the ~9
mapped decide spans from the ~951-line `fillQueuedTabsOnce` (the largest
remaining function) -- see "Slice P2-3" below for the refreshed remaining-
span map, next target is #3 (`slotDecision` outcome handling). See
`git log --oneline` for the full commit list, starting at `3567f1c`, most
recent `ad2f9d6`. `shared/js/sw.js` is at 30,834 lines (fluctuating
slightly around the Part 1 baseline of 30,742 as Part 2's same-file
restructuring trades inline code for named decide functions; expect this
to trend down once more of `fillQueuedTabsOnce` consolidates), down from
38,953 at the start of this effort (~20.8% reduction from the original
baseline). Part 2's work so far stays physically in `sw.js`, no new
module yet.

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

### Slice P2-4 -- slotDecision outcome handling

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

## Phase 0 -- test harness realm fix (prerequisite for Part 2)

Before any `async` orchestration code can move into its own module, the
test harness's module-loading needs to stop mixing realms. The likely
shape: have `test/lib/swHarness.js` bundle first-party `require()`s into
the same `vm.createContext` source it already builds for `sw.js`, mirroring
what webpack does for production, rather than sandboxing `sw.js` alone
while `require()`-ing its dependencies normally into the surrounding Node
process.

This is scoped, independent engineering work on the harness, with its own
risks: fake-timer leakage if the sandbox boundary moves, and module-cache
semantics for a hand-rolled in-context loader (a module required twice must
resolve to the same instance, matching Node's own cache behavior, or
`coordinatorAuthority`-style singletons will silently duplicate). It is not
designed in detail here; it is called out because it gates all of Part 2.

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
