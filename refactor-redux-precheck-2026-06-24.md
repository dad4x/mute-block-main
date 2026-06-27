# Refactor Redux Precheck

Date: 2026-06-24
Base HEAD before checkpoint: b7a8044
Checkpoint version: 1.6.1034

## Purpose

This is the source checkpoint before the next queue refactor pass, named
refactor-redux. It preserves the current stabilization state after a week of
queue-authority, scheduler, live-browser, and harness work, before making a
fresh architectural correction.

This checkpoint is not a release declaration and not a 100-queue clean gate.

## Current State

- The repo is a normal Git checkout, not ADE.
- The working tree contains broad source, test, CDP helper, manifest, packaged
  output, and planning changes.
- The version has advanced from 1.6.946 to 1.6.1034.
- `node --check shared/js/sw.js` passes at checkpoint time.
- Full tests and live 100-queue validation were not rerun for this checkpoint.
- The 100-queue gate remains incomplete.

## Recent Direction

The intended architecture is one queue state machine with one durability layer
under it. Runtime browser state, dashboard state, content script state, and
diagnostics should be observations, projections, or effects. They should not
be competing state machines.

The current code has drifted from that shape. Several runtime helpers both
materialize side-state and drive durable transitions or retry scheduling. That
explains the recent interaction churn: fixes in one path altered behavior in
another because there are multiple semi-authoritative paths.

## 2026-06-25 Realignment

The deeper correction is not to pretend every useful fact can be persistent.
Some state is inherently live-only:

- active timeouts and timers;
- open or pending browser tabs;
- in-flight tab creation, message, storage, and diagnostic promises;
- content-script claims and page observations before they are accepted;
- runtime indexes such as `queuedTabActions`, `activeQueuedTabs`,
  `pendingTabActions`, and tab metadata.

That state is allowed to exist. The boundary is that it must not own queue
truth. Volatile state can schedule effects, hold handles, debounce work, and
emit observations. It cannot directly decide that a durable queue row should
requeue, promote to active, terminate, preserve, prune, or recover.

The durable row state machine should be the only place where event inputs become
durable transitions. Browser tabs, timers, alarms, content scripts, storage
timeouts, and diagnostics should enter that machine as explicit events such as:

- `ADMIT`
- `TAB_OPEN_REQUESTED`
- `TAB_OPENED`
- `TAB_OPEN_TIMEOUT`
- `TAB_OBSERVED`
- `TAB_MISSING`
- `ACTION_CLAIMED`
- `ACTION_RESULT`
- `DEADLINE_EXPIRED`
- `RUNTIME_REHYDRATED`
- `OBSERVATION_TIMEOUT`

The machine may return commands/effects such as:

- `OPEN_PROFILE_TAB`
- `NUDGE_CONTENT_ACTION`
- `CLOSE_TAB`
- `READ_RUNTIME_SURFACES`
- `WRITE_PROGRESS_PROJECTION`
- `SCHEDULE_TICK`

Those effects can fail or time out, but the failure comes back as another event.
The effect runner should not contain a local recovery policy that mutates durable
authority as a side path.

Timeout handling needs to follow the same rule. Timeouts should be modeled as
deadline metadata plus timeout events accepted by the machine, not scattered
`catch` blocks or watchdogs that each invent their own rollback/retry behavior.
For example, a tab create timeout should emit `TAB_OPEN_TIMEOUT` for the row and
attempt that requested the tab. The reducer then decides whether the row remains
queued, moves to a retry wait, reissues an open command, or terminates.

The current live failures fit this boundary problem. Durable queued rows can
exist while runtime surfaces or diagnostics time out. That does not prove
runtime state is illegitimate. It proves runtime/effect paths are still blocking
or deciding transitions instead of reporting facts back to one queue machine.

## Architectural Findings

The clearest issue is not one local bug. It is a boundary failure.

- `transitionCoordinatorItemForQueuedTab` reaches into runtime side-state such
  as `activeQueuedTabs` and `queuedTabMetadata` before applying durable state.
  That lets runtime projection veto or shape a durable transition.
- `recoverPendingTabActionFromCoordinatorQueue` rebuilds runtime state
  (`activeQueuedTabs`, metadata, `pendingTabActions`) and then calls the durable
  transition. That is backwards for a single-machine design.
- `fillQueuedTabs` and `fillQueuedTabsOnce` are effect runners, but they also
  classify authority, requeue actions, prune stale actions, schedule reconciles,
  and decide whether failure means rollback, retry, deferred, or unresolved.
- Scheduler latches and runtime queues (`queuedTabActions`,
  `pendingTabActions`, `activeQueuedTabs`, `queuedTabMetadata`,
  `queuedTabFillPromise`, resume/reconcile timeouts and alarms) are too close
  to transition semantics.
- Options such as `queueOnlyAuthority`, `serviceWorkerOwned`,
  `awaitFill`, and `returnAfterDurableActive` have become alternate execution
  modes rather than thin scheduling policy.

## Refactor Redux Target

The next pass should restore a hard boundary:

1. Define one canonical queue transition API.
2. Put all durable queue row changes through that API and the WAL/checkpoint
   durability layer.
3. Treat runtime browser work as effects requested by the durable transition.
4. Treat runtime maps and pending actions as projections/effect handles only.
5. Make recovery and reconcile feed observations back into the same transition
   API, not into separate repair machines.
6. Keep fill/open/claim code from deciding durable outcome categories directly.
7. Represent timer and timeout outcomes as first-class machine events with row,
   attempt, deadline, and reason metadata.
8. Keep non-persistent handles rebuildable or disposable; never require them as
   the source of truth for durable status.

## Refactor Redux Steps

Start refactor-redux with a read-only transition inventory before making more
behavior changes. Do not treat the current uncommitted `1.6.1040` overlay as an
accepted architecture; use it only as evidence of which paths are fighting the
boundary.

### 2026-06-25 Execution Note

Do not chase every intermediate synthetic failure as a standalone behavior bug.
Some failures are real regressions against the intended machine contract, but
many are contracts around the old split executor/runtime recovery machinery.
Fixing those tests one at a time can preserve helper behavior that refactor-redux
is supposed to remove.

Use failing local tests as characterization evidence:

- fix a failure immediately only when it violates the new single-machine
  boundary;
- otherwise record the failing path as an old recovery contract to replace;
- prefer moving transition ownership into the reducer/event surface over
  polishing local runtime-preserve/prune/adopt branches;
- update tests slice-by-slice to assert the new machine contract;
- run full local tests only after the current slice has a coherent boundary.

### 2026-06-25 Test-Steering Pause

Pause behavior-suite iteration while the reducer boundary is still moving.
The synthetic tests currently encode many old assumptions about helper-local
recovery, volatile queue preservation, and exact timer sequencing. Running them
after every small slice is useful for characterization, but it is now steering
the implementation back toward the split runtime/executor machinery that this
refactor is meant to remove.

Until the realignment is structurally coherent:

- do not use `swSynthetic` or `test:parallel` as the primary next-action driver;
- use focused source inventory and contract review to find remaining delegated
  transition ownership;
- run syntax/static checks only when needed to keep edits parseable;
- record old-contract failures as tests to realign after the machine boundary
  is complete.

### 2026-06-25 Visibility And Build-Time Direction

Use file/module visibility as an enforcement mechanism, not only a cleanup
mechanism. `sw.js` has become large enough that helper naming cannot reliably
prevent runtime/effect code from reaching durable transition helpers. The split
should make illegal calls hard or impossible by construction.

Target source shape:

- `sw.js` remains the extension service-worker entrypoint and wires browser
  APIs, timers, runtime maps, diagnostics, and exported test hooks.
- A queue-machine module owns the durable event vocabulary and reducer
  dispatcher. It exposes only an event API such as `apply(event, context)` plus
  explicit event names.
- Durable mutation helpers stay private to the reducer module or are injected
  into it as a narrow capability object during the transitional slice.
- Runtime/effect modules can observe tabs, timers, claims, content-script
  responses, and storage failures, but can only report those facts through the
  queue-machine event API.
- Projection cleanup helpers may mutate non-persistent maps, but they should
  not import or receive durable mutation helpers.

Target build shape:

- Keep the shipped extension shape unchanged: each manifest still points at
  `js/sw.js`.
- Compile shared JS entries once into an intermediate build directory, then
  copy the compiled output to both `chrome/js` and `firefox/js`.
- Continue copying browser-specific manifests separately.
- Avoid manifest-level multi-script service-worker changes until the bundle
  and harness paths are stable.

Harness constraint:

- `test/lib/swHarness.js` currently reads `shared/js/sw.js` as source text and
  patches it before VM execution. Any source split must either keep Webpack's
  CommonJS `require` path available to the harness or add a small harness source
  loader that reads the entrypoint plus local service-worker submodules.

Checkpoint:

- `webpack.mix.js` now compiles shared JS entries once into
  `tmp/mix-shared/js` and copies the compiled JS to `chrome/js` and
  `firefox/js` after Webpack finishes. This keeps manifest paths unchanged while
  avoiding duplicate JS compilation work.
- `.gitignore` ignores the intermediate `tmp/mix-shared/` build directory.
- `shared/js/swQueueMachineEvents.js` now owns the queue-machine event
  vocabulary and normalization helper. `shared/js/sw.js` imports that vocabulary
  at the dispatcher boundary.
- `shared/js/swQueueMachineDispatcher.js` now owns queue-machine event
  normalization, supported-event validation, and unsupported/unhandled event
  results. `shared/js/sw.js` assembles the current handler table and exposes
  the existing `applyCoordinatorQueueMachineEvent` wrapper through that
  dispatcher.
- `shared/js/swQueueMachineHandlers.js` now owns the queue-machine event handler
  table. `shared/js/sw.js` passes an explicit capability object containing the
  durable mutation helpers and runtime projection handles the machine still
  needs during the transitional split.
- Routed two remaining active terminal-progress observation sites through a new
  `ACTIVE_TERMINAL_PROGRESS` machine event.
- Routed the final-open materialization recovery site through the existing
  `QUEUED_MATERIALIZATION_FAILURE` machine event.
- Hid direct `queuedTabActions` mutation from `swQueueMachineHandlers.js` by
  moving no-open runtime reprime into the `reprimeQueuedTabActionsForNoOpenEvent`
  projection capability supplied by `sw.js`.
- Added `tools/lint-sw-queue-boundary.js` and the `npm run lint:queue-boundary`
  script. The lint fails if runtime/effect code in `sw.js` adds new direct calls
  to restricted durable queue helpers outside function definitions and the
  projection dispatcher allowances. `swQueueMachineHandlers.js` is the current
  allowed machine-handler surface.
- Grouped queue-machine capabilities into `constants`, `authority`, `durable`,
  `runtime`, and `projection` surfaces, with assembly-time validation in
  `swQueueMachineHandlers.js`.
- Extended `npm run lint:queue-boundary` so the queue-machine handler module may
  not directly touch volatile runtime collections such as `queuedTabActions`,
  `activeQueuedTabs`, `pendingTabActions`, or `queuedTabMetadata`; volatile
  changes must come through projection capabilities.
- Routed action-lease request, heartbeat, release, and tab-release observations
  through machine events: `ACTION_LEASE_REQUEST`, `ACTION_LEASE_HEARTBEAT`,
  `ACTION_LEASE_RELEASE`, and `ACTION_LEASE_TAB_RELEASE`.
- Routed failed-item manual retry/requeue requests through machine events:
  `RETRY_FAILED_ITEMS` and `REQUEUE_FAILED_ITEMS`.
- Routed pause and cancel control inputs through machine events:
  `RUNS_PAUSED_SET`, `PAUSE_STATE_SET`, `PAUSE_STORED_WORK`,
  `CANCEL_STORED_WORK`, and `CANCEL_STORED_WORK_ITEM`.
- Routed key-only terminalization, stale retry advancement, and queued profile
  target resolution through machine events: `KEY_ONLY_TERMINATE`,
  `STALE_RETRY_ADVANCE`, and `PROFILE_TARGET_RESOLVE`.
- This is a visibility seam, not the final split. The next source slice should
  move durable reducer implementations out of `sw.js` or shrink the capability
  object until runtime/effect code cannot receive durable mutation helpers at
  all.
- Validation was limited to syntax/static checks:
  `node --check webpack.mix.js`, `node --check shared/js/sw.js`, and
  `node --check shared/js/swQueueMachineEvents.js`,
  `node --check shared/js/swQueueMachineDispatcher.js`,
  `node --check shared/js/swQueueMachineHandlers.js`,
  `node --check tools/lint-sw-queue-boundary.js`, and
  `npm run lint:queue-boundary`.

1. Inventory the current authority paths.

   Classify every queue mutation site as reducer transition, durability adapter,
   projection/materializer, scheduler/effect runner, or illegal side-channel.
   Include at least `transitionCoordinatorItem*`,
   `applyProgressRecordCoordinator`, coordinator authority apply/write paths,
   `recordCoordinatorJobProgress`, terminalization, requeue, retry, stale
   recovery, and queue admission.

   Initial inventory:

   - Reducer-like transition dispatcher: `mutateCoordinatorProjection`.
     It currently routes action lease request/heartbeat/release, pause,
     current-work cancel, rollback, active transition, key-only
     terminalization, active terminal progress, active non-profile landing,
     redirect mismatch, actorless reconcile, and queued-authority failure
     transitions.
   - Durability adapter: `coordinatorAuthority.applyWithinStorageUpdate` and
     `coordinatorAuthority.apply`. These are the WAL/checkpoint boundary and
     should remain the only place where durable queue rows are accepted.
   - Projection/materializers: compact queue view saves, progress projection
     saves, run recomputation, terminal settlement derived writes, dashboard
     state, and progress shadow WAL. These should lag or repair views, not
     decide queue row status.
   - Mixed transition/effect paths needing extraction:
     `runCoordinatorExecutorApplyPhase`, `fillQueuedTabs`,
     `fillQueuedTabsOnce`, `recoverQueuedRuntimeActionsAfterExecutorEnqueueTimeout`,
     `recoverQueuedAuthorityLiveTabAfterMaterializationFailure`,
     `resolveQueuedStaleRuntimeExecutorCase`,
     `releaseQueuedTabRuntimeIfAuthorityNotActive`,
     `recoverPendingTabActionFromCoordinatorQueue`,
     `restoreQueuedTabRuntimeFromActiveAuthorityForSender`, and
     `rollbackFailedQueuedTabOpen`.
   - Current direct durable decision verbs still appear outside a single event
     surface: requeue, terminate, promote/adopt active, rollback, release
     lease, prune stale runtime, preserve runtime, and duplicate live-tab
     reclaim. These should become event outcomes from the canonical reducer.

2. Inventory volatile/effect state.

   Map every writer and reader of `queuedTabActions`, `activeQueuedTabs`,
   `pendingTabActions`, `queuedTabMetadata`, fill promises, leases, alarms,
   timers, and tab indexes. For each one, record whether it is only an effect
   handle/projection or whether it currently drives a durable row decision.

   Initial inventory:

   - `queuedTabActions`: should be an open-effect queue, but currently also
     drives capacity, no-open recovery, stale-runtime pruning, timeout
     classification, and whether queued rows are terminated or deferred.
   - `activeQueuedTabs`: should be a live tab handle set, but currently gates
     durable actor presence, release rollback, duplicate runtime pruning,
     scheduler latches, and claim recovery.
   - `pendingTabActions`: should be a claim/effect projection, but currently
     participates in durable active classification and requeue/termination
     decisions.
   - `queuedTabMetadata`: should be runtime metadata, but currently carries
     attempt identity, foreground/worker-window state, retry fields, close
     reasons, and sometimes influences durable rollback/release behavior.
   - Fill promises, resume alarms, reconcile timers, action-surface cleanup
     timers, lease timers, and content-script message promises are effect
     handles. They should emit timeout/observation events instead of deciding
     row transitions inline.

3. Build the timeout map.

   List each timeout class: tab creation, queued fill, executor enqueue,
   storage read/write, message send, runtime diagnostic, stale active,
   heartbeat/lease, and observation polling. For each timeout, identify who
   observes it, who decides the durable transition, what row/attempt metadata is
   available, and whether the decision is centralized or delegated.

   Initial timeout map:

   - Tab create/open timeout: observed in `fillQueuedTabsOnce`; currently may
     requeue, restore planned actions, recover live tabs, prune runtime, or
     terminate queued-authority rows. Target event:
     `TAB_OPEN_TIMEOUT`.
   - Final open decision timeout: observed in `shouldOpenQueuedTabAction` and
     executor apply; currently mixes authority reload, live-tab adoption,
     defer, and terminate. Target event: `OPEN_DECISION_TIMEOUT`.
   - Executor enqueue/fill timeout: observed in
     `runCoordinatorExecutorApplyPhase` and
     `recoverQueuedRuntimeActionsAfterExecutorEnqueueTimeout`; currently
     preserves/prunes/adopts runtime actions directly. Target event:
     `EXECUTOR_FILL_TIMEOUT`.
   - Storage read/write timeout: observed by the storage queue and authority
     apply paths; should remain durability-layer failure metadata unless a
     machine event is needed for a specific row/attempt.
   - Content-script message/claim timeout: observed in nudge/claim helpers;
     currently schedules sweeps and sometimes requeues. Target event:
     `ACTION_CLAIM_TIMEOUT`.
   - Active actor/lease timeout: observed in reconcile and lease helpers;
     currently releases leases and requeues/terminates actorless active rows.
     Target events: `ACTION_LEASE_EXPIRED`, `ACTIVE_ACTOR_MISSING`, and
     `ACTIVE_ACTOR_OBSERVATION_TIMEOUT`.

### 2026-06-25 Slice Checkpoint

Implemented the first active-admission event wrapper:

- `TAB_OPENED` now enters the queue machine event handler before delegating to
  the active transition reducer.
- `TAB_OPEN_TIMEOUT` now enters the same handler before delegating to active
  open rollback.
- Focused validation passed:
  - `node --check shared/js/sw.js`
  - `node test/p1-contract.test.js`
  - `timeout 180s node test/swSynthetic.test.js --range=381:410`
- The rollback-failed exhausted-row fallback now enters the same event surface
  as `TAB_OPEN_ROLLBACK_UNACKED`, so the effect wrapper no longer directly
  decides that exhausted active rows should requeue or terminate.

Do not interpret remaining unrelated synthetic failures as blockers for this
slice unless they show the new event boundary is wrong. The next slice should
continue moving executor materialization and queued-runtime preservation/prune
decisions behind explicit queue machine events.

### 2026-06-25 Executor Active-Missing / No-Open Reprime Slice

Completed another narrow queue-machine boundary slice:

- Added `ACTIVE_MISSING_TAB` to the queue-machine event surface. The executor
  active-missing-tab branch now asks the machine event handler to perform the
  durable actorless active requeue instead of calling
  `requeueDurableActiveCoordinatorItemWithoutActor` directly from the worker
  loop.
- Added `QUEUED_NO_OPEN_REPRIME` to the same event surface. The no-open retry
  path now preserves/reprimes `queuedTabActions` through a named event. This is
  still volatile executor state, but the worker loop no longer performs that
  state transform ad hoc.
- Updated the synthetic characterization for the actorless-active/no-open
  compound case. Current machine behavior can legitimately consume the queued
  row as `queued-authority-enqueue-runtime-surface-materialized` if the runtime
  surface appears during the pass; the old assertion only accepted the
  `queued-authority-enqueue-no-open-attempt` unresolved branch. The test now
  accepts both and verifies the corresponding durable/volatile state.
- Extended `test/p1-contract.test.js` so the new event names and executor event
  calls remain contract-covered.

Focused validation:

```text
node --check shared/js/sw.js
node --check test/p1-contract.test.js
node test/p1-contract.test.js
timeout 180s node test/swSynthetic.test.js --range=291:300
```

passed.

Next slice should continue at queued-runtime preservation/prune and stale
runtime resolution. Treat range failures there as boundary evidence first, not
as proof that each old helper contract must survive unchanged.

### 2026-06-25 Local Test Realignment Checkpoint

Completed the local refactor-redux realignment pass through the previously
failing synthetic bands without using live gates:

- Extended fake-timer settling to include the long queue timeout band so tests
  no longer encode short, stale timeout assumptions in every caller.
- Recharacterized executor materialization tests around durable outcomes rather
  than exact volatile `queuedTabActions` retention. Runtime materialization,
  deferred enqueue, and no-open retry are accepted when the durable queue state
  and executor result remain coherent.
- Recharacterized stored-work and shadow-WAL tests away from old pump metric
  and exact retained-record counters. The tests now keep the durable tab/open,
  WAL append, bounded retention, and recovered projection checks.
- Recharacterized stale content-script receiver reload expectations to allow a
  post-reload ensure marker while still requiring stale presence metadata to be
  cleared and resume to be armed.

Local validation passed:

```text
node --check shared/js/sw.js
node --check test/swSynthetic.test.js
node test/p1-contract.test.js
timeout 180s node test/swScenarioFuzz.test.js
timeout 600s node test/swSynthetic.test.js
timeout 600s npm run test:parallel
```

No live queue gates were run.

### 2026-06-25 Sender Runtime Recovery Event Slice

Moved another volatile-runtime boundary behind the queue-machine event surface:

- Added `RECOVER_PENDING_TAB_ACTION` for sender-driven recovery from durable
  queue authority.
- Added `RESTORE_ACTIVE_RUNTIME_FOR_SENDER` for restoring volatile runtime
  maps from an already-active authoritative row.
- Routed `beginCoordinatorProfileAction`, `promoteQueuedTab`,
  `nudgeQueuedTabActionClaim`, and `claimPendingTabAction` through these events
  instead of directly calling the recovery/restoration helpers.
- Added `RELEASE_RUNTIME_IF_AUTHORITY_NOT_ACTIVE` and routed stale-runtime
  resolution, nudge failure handling, and stale sweep through it.
- Updated contract checks so these paths must enter
  `applyCoordinatorQueueMachineEvent`; the underlying helpers remain as event
  implementations.

Focused validation passed:

```text
node --check shared/js/sw.js
node --check test/p1-contract.test.js
node test/p1-contract.test.js
timeout 180s node test/swSynthetic.test.js --range=351:360
timeout 180s node test/swSynthetic.test.js --range=411:450
timeout 180s node test/swSynthetic.test.js --range=231:240
```

### 2026-06-25 Active Requeue Event Slice

Moved the remaining direct active-row requeue call sites that sat outside the
queue-machine event handler onto the existing `ACTIVE_MISSING_TAB` event:

- authority reconcile active-without-actor requeue;
- post action-lease release active requeue;
- executor active pending profile-mismatch requeue;
- executor active live-tab adoption failure requeue;
- release reconciliation for active runtime rows without a live actor.

After this slice, `requeueDurableActiveCoordinatorItemWithoutActor` is called
directly only by its definition path and the queue-machine event handler.

Focused validation passed:

```text
node --check shared/js/sw.js
node test/p1-contract.test.js
timeout 180s node test/swSynthetic.test.js --range=341:350
timeout 180s node test/swSynthetic.test.js --range=421:440
timeout 180s node test/swSynthetic.test.js --range=231:240
```

4. Define the reducer event surface.

   Create the minimal event vocabulary needed for queue admission, open,
   observe, claim, progress, terminal result, tab disappearance, timeout,
   pause/resume, and retry. Events should carry row id, attempt id, action kind,
   deadline or observed time, tab id when applicable, and reason.

5. Define the command/effect surface.

   Reducer output should request browser and storage effects without performing
   them directly. Start with open tab, close tab, nudge content action,
   materialize progress, read runtime observations, and schedule tick. Every
   effect result must return as an event.

6. Choose one vertical slice.

   The first implementation slice should be active-tab admission:

   ```text
   durable queued row
     -> reducer accepts ADMIT / TAB_OPEN_REQUESTED
     -> effect opens or restores runtime surface
     -> TAB_OPENED, TAB_OBSERVED, TAB_OPEN_TIMEOUT, or TAB_MISSING returns
     -> reducer decides active, retry wait, requeue, or terminal state
   ```

   This slice should remove active-tab materialization decisions from fill/open
   helpers and make those helpers event adapters/effect runners.

7. Gate each slice with static review.

   Before live validation, review the diff for forbidden authority leaks:
   effect runners must not directly requeue, terminate, promote, preserve,
   prune, or recover durable rows except through the canonical transition API.

8. Rebuild and validate only after the boundary is coherent.

   Once a slice is implemented and local tests cover it, rebuild according to
   the repo release rule, then resume the queue ladder at `24 -> 100 -> 300`.
   The 100-queue gate remains the first meaningful live proof; 300 is a
   soak/scale gate after the 100 path is clean.

## Worker Assignment Shape

The first worker pass should be read-only and should not rebuild, reload, or run
live validation. The assignment is:

- compare the clean savepoint and current dirty overlay without normalizing the
  overlay;
- produce the durable reducer/state-machine map;
- produce the volatile/effect state map;
- produce the timeout ownership map;
- flag mixed paths where helpers or volatile maps make durable decisions;
- recommend the first reducer/event slice.

After that map, choose one slice, implement only that slice, review for boundary
violations, then rebuild and run the staged queue gates.

## Validation Notes

At checkpoint time:

```text
node --check shared/js/sw.js
```

passed.

No broader test result is implied by this file.

## Iteration Note: Runtime Termination Events

The next queue-machine slice moved runtime-observed active termination
inputs behind explicit machine events:

- `ACTIVE_NON_PROFILE_LANDING` for active rows whose executor lands on a
  non-profile Quora page.
- `ACTIVE_PROFILE_REDIRECT_MISMATCH` for active rows whose executor resolves to
  a different profile than the requested target.
- The remaining profile-resolution-tab close path now uses the existing
  `KEY_ONLY_TERMINATE` event instead of calling the wrapper directly.

These are still narrow adapter events: volatile tab/metadata inspection remains
outside the reducer, but durable row termination is routed through
`applyCoordinatorQueueMachineEvent`.

Focused validation for this checkpoint intentionally stayed static:

```text
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineHandlers.js
node --check shared/js/sw.js
npm run lint:queue-boundary
```

The boundary lint now also treats these durable termination capabilities as
machine-owned:

- `mutateCoordinatorKeyOnlyItemTerminate`
- `terminateActiveCoordinatorNonProfileLanding`
- `terminateActiveCoordinatorProfileRedirectMismatch`

Direct runtime calls to those helpers should now fail the local boundary lint.

## Iteration Note: Dispatcher As Canonical Entry

The tab-open and rollback paths now call `applyCoordinatorQueueMachineEvent`
directly inside their storage update context instead of sending
`kind: 'applyQueueMachineEvent'` through `mutateCoordinatorProjection`.

The compatibility dispatch branch in `mutateCoordinatorProjection` was removed,
leaving that function as a reducer-wrapper shim for the few remaining older
projection calls rather than a second event-machine entry point.

Focused validation:

```text
node --check shared/js/sw.js
npm run lint:queue-boundary
```

## Iteration Note: Removed Projection Dispatcher Shim

The remaining `mutateCoordinatorProjection` calls were wrapper calls into named
durable reducers. Those wrappers now call the named reducers directly, and the
unused `mutateCoordinatorProjection` function was removed.

At this checkpoint there is no stringly `kind` transition router in `sw.js`;
the event dispatcher in `swQueueMachineDispatcher.js` is the queue-machine event
entry point.

Focused validation:

```text
rg -n "mutateCoordinatorProjection|kind: 'requestActionLease'|kind: 'transitionQueuedTabActive'|kind: 'terminateActive'" shared/js/sw.js
node --check shared/js/sw.js
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineHandlers.js
npm run lint:queue-boundary
```

## Iteration Note: Generic Mutator Boundary Lint

The boundary lint now rejects direct `mutateCoordinator*` reducer calls in
`sw.js` unless the call is inside a small allowlisted durable wrapper:

- `requeueDurableActiveCoordinatorItemWithoutActor`
- `terminateDurableActiveCoordinatorItemFromTerminalProgress`
- `terminateActiveCoordinatorNonProfileLanding`
- `terminateActiveCoordinatorProfileRedirectMismatch`
- `mutateCoordinatorStoredWorkPause` calling `mutateCoordinatorPauseStateSet`

This is the first mechanical visibility guard for the realignment: runtime and
effect code can submit machine events, but cannot directly call durable reducer
functions.

Focused validation:

```text
node --check tools/lint-sw-queue-boundary.js
npm run lint:queue-boundary
```

## Iteration Note: Progress Persistence Event

Runtime progress writes now route through the queue-machine event surface:

- Added `PROGRESS_PATCH_RECORD`.
- Added `recordCoordinatorJobProgress` as a durable machine capability.
- Added `recordCoordinatorJobProgressViaQueueMachine` as the local adapter for
  effect/runtime code.
- Replaced direct runtime calls to `recordCoordinatorJobProgress` with the
  adapter.
- Extended the boundary lint so direct `recordCoordinatorJobProgress(...)`
  calls outside the implementation and handler fail.

Focused validation:

```text
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineHandlers.js
node --check shared/js/sw.js
node --check tools/lint-sw-queue-boundary.js
npm run lint:queue-boundary
```

## Iteration Note: Local Test Alignment

After the structural realignment, local tests were updated to assert the
machine boundary rather than the removed projection router or direct durable
helper calls.

Decisions made during this slice:

- New machine event and capability names use `TERMINATE`, not `TERMINALIZE`.
- Existing implementation helper names and persisted operation strings were
  left in place where broader renaming would be compatibility churn.
- Tests that encoded intermediate runtime timing now assert durable outcomes:
  queued authority remains queued, termination is not recorded, and live
  leases are either returned to the caller or explicitly released by the known
  fast-detached cleanup path.
- The machine handler rejects stale active-missing events when resident
  authority now shows a live action lease.
- Active-transition rollback refuses to roll back a row that currently has a
  live lease for the same tab.
- Fast-detached/preflight runtime cleanup preserves a live action lease instead
  of clearing it as a side effect of releasing a runtime slot.

Local validation completed:

```text
node test/p1-contract.test.js
timeout 300 node test/swSynthetic.test.js
timeout 600 npm test
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineDispatcher.js
node --check shared/js/swQueueMachineHandlers.js
node --check shared/js/sw.js
npm run lint:queue-boundary
```

The full local suite is now green, including the WAL fuzz and service-worker
scenario fuzz cases. No live gates were run.

## Iteration Note: Queue Admission Event

Queue admission now enters through the machine event surface:

- Added `COORDINATOR_ITEMS_ENQUEUE`.
- Added `enqueueCoordinatorItemsStorageLocked` as a durable machine capability.
- `enqueueCoordinatorItemsStorage` now submits that event inside the existing
  storage-update context instead of calling the locked reducer directly.
- The boundary lint now rejects direct calls to
  `enqueueCoordinatorItemsStorageLocked` outside the handler.

Focused validation:

```text
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineHandlers.js
node --check shared/js/sw.js
node --check tools/lint-sw-queue-boundary.js
npm run lint:queue-boundary
```

## Iteration Note: Final Command-Facing Durable Writers

The remaining command/runtime-facing durable writers now route through queue
machine events:

- `PROFILE_STATE_CLEAR` for profile clear/reset.
- `PROFILE_RESOLUTION_UNRESOLVED` for resolver failure terminalization.
- `BLOCKED_SWEEP_TERMINAL_RECORD` for background blocked-tab terminalization.
- `ROW_EVENTS_APPLY` for normalized row progress events.

The existing writer implementations remain in `sw.js`, but they are now
machine capabilities. Runtime/message paths submit events, and the boundary lint
rejects direct calls outside the handler, with one allowance for the internal
deferred progress flush.

Focused validation:

```text
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineHandlers.js
node --check shared/js/sw.js
node --check tools/lint-sw-queue-boundary.js
npm run lint:queue-boundary
```

## Iteration Note: Storage Maintenance Events

The remaining storage-maintenance state changes exposed to runtime/message
paths now enter through the machine event surface:

- `TERMINAL_COORDINATOR_ITEMS_SETTLE`
- `PENDING_SPACE_FEED_URLS_REMOVE`
- `PENDING_SPACE_FEED_ENTRIES_REMOVE`
- `SPACE_FEED_PROFILES_CONFIRM`

Existing helpers remain as durable capabilities, and direct calls are rejected
by the boundary lint. Internal callers that previously settled terminal rows or
confirmed pending/nuked-post records now submit events.

Focused validation:

```text
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineHandlers.js
node --check shared/js/sw.js
node --check tools/lint-sw-queue-boundary.js
npm run lint:queue-boundary
```

## Completion Checkpoint

The refactor-redux realignment is structurally complete for the current slice:

- `sw.js` no longer owns a separate stringly transition router.
- Machine event vocabulary is centralized in `swQueueMachineEvents.js`.
- Event dispatch is centralized in `swQueueMachineDispatcher.js`.
- Durable/runtime/projection capabilities are assembled through
  `swQueueMachineHandlers.js`.
- Runtime and message-facing state changes now submit queue-machine events.
- Durable reducer/storage helpers remain as capabilities behind the machine
  handler.
- Volatile state remains in `sw.js` as effect/projection state: tab maps,
  active timers, queued actions, and runtime metadata are not treated as
  persistent truth.
- The boundary lint rejects direct runtime calls to machine-owned durable
  helpers and rejects volatile/projection internals inside the handler module.
- Build-time direction is in place: shared JS is compiled once to
  `tmp/mix-shared/js` and copied to browser targets.

Deferred intentionally:

- No live queue gates.
- No zip package/tag cycle.

Final focused validation:

```text
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineDispatcher.js
node --check shared/js/swQueueMachineHandlers.js
node --check shared/js/sw.js
node --check webpack.mix.js
node --check tools/lint-sw-queue-boundary.js
npm run lint:queue-boundary
```

## Iteration Note: Local Suite Alignment

The local test alignment is now part of the refactor rather than a separate
cleanup loop:

- p1 contracts assert the queue-machine split, event vocabulary, and
  `terminate...` capability names.
- Synthetic tests assert durable outcomes instead of transient runtime timing
  in the action-lease and timeout paths.
- The full local suite is expected to pass before release packaging resumes.

Validation after the naming cleanup and test alignment:

```text
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineDispatcher.js
node --check shared/js/swQueueMachineHandlers.js
node --check shared/js/sw.js
node --check tools/lint-sw-queue-boundary.js
npm run lint:queue-boundary
npm run lint:correctness
node test/p1-contract.test.js
git diff --check
timeout 600 npm test
npm run prod
```

All passed. The unpacked Chrome and Firefox outputs were refreshed by
`npm run prod`. Live browser gates, zip packaging, and release tagging remain
intentionally out of this local refactor pass.

## Iteration Note: Exhausted Rollback Events

Exhausted rolled-back queue rows now use explicit machine events at runtime
entry points:

- `EXHAUSTED_ROLLBACK_SETTLE`
- `EXHAUSTED_ROLLBACK_RECOVER`
- `EXHAUSTED_ROLLBACK_TERMINATE`

The durable helpers still own the reducer/storage details, including their
internal batch recovery loop, but runtime/reconcile callers no longer choose and
invoke those durable helpers directly.

The boundary lint now rejects direct calls to those helpers outside the handler
and the internal batch helper allowance.

Focused validation:

```text
node --check shared/js/swQueueMachineEvents.js
node --check shared/js/swQueueMachineHandlers.js
node --check shared/js/sw.js
node --check tools/lint-sw-queue-boundary.js
npm run lint:queue-boundary
```

## Design Note: Storage Commit Boundary

The storage realignment has a stricter rule than earlier WAL migration notes:
there is no temporary compatibility projection category left in the target
architecture. Any stored shape that remains must be either authoritative state
or a current derived read model rebuilt from authority. Old-shaped storage that
only exists to satisfy previous consumers should be removed, not preserved under
a compatibility label.

The queue machine transition commit boundary is:

```text
machine event -> reducer decision -> storage subsystem durably accepts the
authoritative update -> resident authority projection advances from that
accepted update
```

That boundary is correctness-sensitive and event processing should serialize on
it. A transition is not complete merely because a caller has a next row in hand;
it is complete only when the storage subsystem has durably accepted the
authoritative update and the resident authority projection has advanced
atomically from that accepted update. Later machine events must wait for that
boundary so they cannot observe or act on stale resident authority.

WAL records, checkpoints, segment metadata, and replay are storage subsystem
implementation details. Code outside that subsystem should not branch on them,
construct around them, or describe its behavior in WAL terms. Clients submit
machine events or authoritative storage updates; the storage subsystem decides
how those updates are committed and how resident authority is advanced.

Stored read models are outside the commit boundary. Dashboard/queue-view
projections, run summaries, progress read models, pending/nuked source-post
materialization, and diagnostics may be scheduled after the authoritative
commit, but they must not:

- decide queue row status,
- sit ahead of WAL authority work,
- block the machine transition after WAL plus resident authority have committed,
- reinterpret a committed transition if their save fails, or
- reintroduce old compatibility-shaped state.

The practical refactor target is therefore not "make WAL fast by skipping
resident projection"; it is "make the authoritative storage commit small and
serialized, then decouple every rebuildable storage projection from that
commit." Shared storage queues are acceptable only if they preserve this
ordering: authoritative commit work first, derived read-model materialization
later.
