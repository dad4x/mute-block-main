# Mute Block Retrospective History

Date: 2026-05-23

Status: retrospective note.

Canonical current planning still starts at [planning.md](planning.md), and
current architecture starts at [architecture.md](architecture.md). This file is
history: why the code evolved into its current shape, what we learned, and how
the active `1.6`/`2.0` direction differs from the released `1.0`-`1.2` product,
the unreleased `1.3` work, and the AI-assisted `1.4` repair/expansion.

## Evidence Used

- Git history from the initial imported baseline through `release/1.4`,
  `refactor/1.5`, and `main`/`1.6`.
- User-provided product history for the pre-git / pre-AI release line:
  human-authored `1.0`-`1.2`, unreleased `1.3`, and the Quora breakage that
  led to the early AI-assisted `1.4` fixes.
- [space-nuke-handoff-2026-05-03.md](space-nuke-handoff-2026-05-03.md)
- [refactor-1.5-plan.md](refactor-1.5-plan.md)
- [coordinator-page-refactor-plan-2026-05-08.md](coordinator-page-refactor-plan-2026-05-08.md)
- [notes-1.5](notes-1.5)
- [top-level-rethink-1.5.md](top-level-rethink-1.5.md)
- [top-level-rethink-1.5-execution-plan.md](top-level-rethink-1.5-execution-plan.md)
- [refactor-1.6-plan.md](refactor-1.6-plan.md)
- [normal-reconcile.txt](normal-reconcile.txt)
- [storage-observability-baseline-2026-05-22.md](storage-observability-baseline-2026-05-22.md)
- [storage-row-event-baseline-1.6.487-2026-05-23.md](storage-row-event-baseline-1.6.487-2026-05-23.md)

## One-Line Summary

We started with a human-authored released extension, brought in AI when Quora
broke the `1.2` line, used the resulting `1.4` success to add the first
released better-than-nothing `Nuke 'Em`, grew that into a high-volume background
workflow faster than we grew an authority model, gained the ability for the AI
to drive a real connected browser, then spent `1.5` and `1.6` turning
accumulated recovery behavior into an explicit durable queue, reducer,
reconciler, and storage plan.

## Product Prehistory: `1.0` Through `1.3`

The product did not start as an AI-built architecture experiment.

Versions `1.0` through `1.2` were outsourced to a human author. That line was
released and in real use. It established the original useful product surface:
foreground Quora profile mute/block assistance and related helper behavior.

Version `1.3` was not released. Its main remembered contribution was adding
preferences storage. That mattered later because it gave the extension a place
to keep local settings, but it was not the public line users were depending on.

In early 2026, Quora changed enough of the site that the released `1.2` line
broke. That breakage created the practical need for a fast repair. AI was
brought into the project to resolve that live failure, and that work produced
the released early `1.4` series.

That origin matters. The first AI work was not a clean rewrite with a planned
state model. It was a repair and adaptation of an existing product under live
site pressure.

## Early AI Era: Before `Nuke 'Em`

The early AI-visible extension was still small and direct.

The service worker at the initial baseline was mostly a browser API broker:

- create a background tab for a URL;
- close the sender tab;
- observe Quora GraphQL requests and notify the matching content script when
  follower, following, contributor, block, or question data had loaded.

The content script was mostly page-local:

- on a supported profile page, inject `Mute Block` and `Close tab`;
- perform mute/block against the visible profile DOM;
- close the tab when the user asked;
- on follower/following/contributor lists or modals, inject `Open Profiles`;
- when clicked, open many discovered profile URLs as background tabs.

That model had almost no durable workflow semantics. It did not need much:
each destructive action was foreground, user-directed, and tied to the tab the
user could see. Bulk behavior meant "open a lot of profile tabs", not "own a
recoverable multi-profile job."

The important architectural property was accidental simplicity: there was no
separate queue truth because there was no real queue.

This early AI-assisted `1.4` work repaired the broken released line and kept
the foreground single-target workflow useful. Having some success with that
made the project ambitious enough to add `Nuke 'Em`.

## `1.4`: `Nuke 'Em` Arrives

The next big change in `1.4` was adding the first released version of `Nuke
'Em` to the existing surfaces. That first version was better than nothing, but
not particularly reliable. It could start useful bulk work, but it inherited
the direct-action assumptions of the smaller extension.

By `1.4.164`, the source had gained:

- modal `Nuke 'Em` for listed profiles;
- space classification as `Asset`, `Neutral`, or `Target`;
- asset-space feed scanning;
- per-post and page-level space-feed `Nuke 'Em`;
- persistent remembered space-post nuke state;
- popup controls for settings, space records, and remembered nukes;
- a service-worker queue for background nuke tabs.

This was a useful product leap. It let an operator click one control and have
the extension start processing many profiles. It also made the old reliability
assumptions visibly insufficient.

It was also the moment the old model stopped fitting. The code had moved from
"user is looking at one profile and clicks a local button" to "a source page
collects many targets, opens worker tabs, tracks progress, remembers source
post settlement, and survives enough browser behavior to be useful."

The new behavior was built by extending the old primitives:

- source pages still discovered and remembered a lot of work directly;
- worker tabs still performed page-local actions;
- service-worker memory tracked queued and active tabs;
- progress storage was used as both reporting data and recovery input;
- source pages waited, polled, refreshed controls, and reconciled stale labels.

The resulting workflow worked enough to prove the feature, but it was not yet
organized around durable jobs. It had several partial truths:

- runtime tab sets in the service worker;
- `mbProfileNukeProgress` records;
- remembered and pending space-post maps;
- source-page button state;
- later, coordinator queue and run records.

Once large runs began, those truths could diverge.

## Late `1.4`: Recovery Starts Growing Around The Edges

By the `1.4.247` maintenance baseline, the service worker had become much more
than a simple tab broker. It had active queued-tab metadata, owner pause/cancel
state, foreground promotion, stale tab sweeps, terminal progress recording,
browser-error handling, and progress writes.

Those changes were practical responses to real failures:

- background tabs disappeared or stalled;
- source pages got stuck showing work still in progress;
- already-blocked rows generated repeated confirmations;
- extension reloads left old DOM buttons or storage state behind;
- a large `Nuke 'Em` run could make pages sluggish or unresponsive.

The May 3 handoff captured the shape: the hover-count work was done, but large
space nukes showed repeated blocked-sweep chatter and interrupted/error rows.
The suspected hot path was event churn between background sweeps, progress
writes, and content-side reconciliation.

Retrospectively, that was the right smell. The problem was not only one noisy
loop. It was that recovery had no single owner. Every layer had learned a
little bit about fixing state:

- source content could write progress or repair visible controls;
- service worker sweeps could record terminal progress and close tabs;
- storage listeners could react and recompute;
- queue slot release could advance more work;
- owner tab close could cancel or pause;
- later coordinator pages could repair display state from progress.

Each patch was locally plausible. Together they made recovery an emergent
processing mechanism.

## `1.5`: The First Step Back

The `1.5` refactor started because `1.4` had accreted too much AI-written
queue, progress, and space-classification code without a clear internal model.
The initial `1.5` plan named the abstractions that were missing:

- `subject`: canonical Quora profile identity;
- `targetDescriptor`: actionable target plus source/evidence;
- `nukeRun`: owner/source, queue items, attempts, status, and concurrency;
- `progressEvent`: append-style attempt event rather than repeated full-map
  rewrite;
- `domAdapter`: page-specific recognition separated from queue/state logic.

The early `1.5` branch did make concrete progress:

- subject normalization became shared code with tests;
- a coordinator page was introduced;
- parent Quora pages became intake surfaces instead of long-running owners;
- queue display, retry, pause/resume, and live CDP validation improved;
- source-page controls learned more precise pending/nuked accounting.

But the live debugging notes show the same pattern continuing. Each new failure
added a recovery patch:

- repair raw coordinator storage from profile progress;
- reopen or reuse the coordinator after reload;
- dedupe duplicate coordinator pages;
- reset retryable failures from transient progress;
- bind old DOM buttons after extension reload;
- suppress stale `Nuking...` labels;
- reconstruct executor actions when service-worker memory was empty.

The coordinator helped human factors and observability, but it did not by
itself solve authority. At that stage, coordinator storage, progress storage,
content state, and service-worker memory still all had influence.

The important `1.5` result was conceptual rather than merely code-level:
[notes-1.5](notes-1.5) explicitly recognized that we had "backed ourselves
into a model" with persistent state and a coordinator but without a serialization
and recovery strategy.

That note introduced the durable invariant that still governs current work:

```text
Persistent storage is the source of truth for every job that must survive
browser restart, extension reload, coordinator close, worker tab close, or
service-worker suspension.
```

It also named the actors correctly:

- the service worker is the in-memory orchestrator and mutation authority;
- the coordinator/dashboard is a view and control surface;
- worker tabs are disposable executors;
- content pages should enqueue or report observations, not own durable truth.

## Durable Job Model

[top-level-rethink-1.5.md](top-level-rethink-1.5.md) turned the step-back note
into the durable job model.

The key shift was from profile-progress-driven execution to queue-row authority.
The queue row became the job record, with action kind, scope, canonical subject,
attempt identity, claimed tab, lease/heartbeat fields, milestones, terminal
outcome, and timestamps.

That model made several previously vague cases explicit:

- `queued` means durable work exists and can be scheduled.
- `opening`, `active`, `acting`, and `settling` are nonterminal job phases.
- `succeeded`, `skipped`, `failed`, and `canceled` are terminal or operator
  controlled outcomes.
- attempt ids prevent stale worker messages from moving a newer attempt.
- progress mirrors are compatibility/reporting output, not queue authority.

It also reframed "repair":

- startup repair,
- storage-change repair,
- dashboard repair,
- tab-close repair,
- stale-progress repair,
- queue-pump repair

were all symptoms of a missing normal reconciler.

## `1.6`: Make The Model Real

`main` became the `1.6` stabilization lane, with public release intent framed
as `2.0`.

The work in `1.6` has been about making the durable model real without losing
the workflows that made `1.4` useful:

- service-worker-owned queue rows became the authority for queued jobs;
- progress-derived queue updates began routing through a reducer;
- queued worker messages gained job/attempt identity;
- stale attempts and late progress were rejected or quarantined;
- dashboard/coordinator state moved toward display/control rather than
  mutation ownership;
- source-page settlement and pending/nuked post accounting moved closer to
  terminal job outcomes;
- deterministic tests were added for subject normalization, job state,
  P1 contracts, storage invariants, synthetic service-worker scenarios,
  raw report-page fixtures, shared moderation, and WAL/snapshot prototypes.

This was not clean immediately. The live history shows a long series of issues
that were exactly what the new model predicted:

- terminal rows being moved backward by stale progress;
- opening transitions overwriting terminal snapshots;
- nested storage-lane deadlocks;
- retry paths creating attempts the durable row had not accepted;
- foreground leases needed for Quora to accept action clicks;
- dashboard or CDP reads becoming slow under large storage blobs;
- active runtime tabs blocking scheduling without matching durable authority;
- durable active rows existing without a confirmed runtime actor.

The current architecture note summarizes the resulting rule:

```text
durable queue state + live browser observations
  -> bounded reconcile tick
  -> durable state changes + minimal side effects
```

That is the mature form of the "repair is normal processing" idea. The goal is
not to sprinkle more repair calls. The goal is one scheduler/reconciler entry
point where pumps, alarms, tab events, storage timeouts, dashboard commands, and
content reports all become reasons to run the same fixed-point logic.

## Connected Browser Control

Another major breakthrough was operational: the AI gained the ability to drive
an actual connected browser.

Before that, live validation depended on a slow human loop:

- build artifacts locally;
- have the human copy or load them elsewhere;
- ask the human to click through Quora;
- receive a summary, screenshot, or pasted extension dump;
- infer what happened after the fact.

That was enough for simple foreground features, but it was a poor match for
the problems `Nuke 'Em` created. Queue/recovery bugs depend on exact timing,
which tabs are open, which storage rows exist, whether the extension has
runtime errors, what the service worker believes, and whether a visible button
actually took the real user path.

The CDP-driven browser lane changed the debugging model. The AI could now:

- reload the unpacked extension and verify the loaded version;
- inspect manifest and runtime errors;
- push rebuilt Chrome artifacts through the copy tunnel;
- open, close, focus, and inspect real tabs;
- drive real mouse events instead of relying on DOM `click()` shortcuts;
- read extension storage, dashboard state, queue rows, metrics, and live tab
  state in the same run;
- repeat small batches with bounded observation instead of waiting for manual
  reproduction.

That did not eliminate the need for human judgment. It changed what the human
had to do. Instead of acting as the execution harness, the human could steer
the scenario and interpret product behavior while the AI handled the mechanical
browser probing and evidence collection.

This capability is why later work could become much more concrete:

- we could see durable/runtime mismatches rather than only symptoms;
- we could distinguish Quora actionability problems from queue-state problems;
- we could measure storage and scheduler churn during live runs;
- we could prove small worker-window batches instead of debating whether
  background tabs "should" work;
- we could turn live observations into deterministic synthetic harness cases.

Retrospectively, connected browser control was as important as any code
refactor. It shortened the feedback loop enough for the architecture problems
to become observable.

## Worker Window Decision

One key live discovery was that Quora actions were unreliable when worker tabs
were too hidden or backgrounded. Confirmation buttons could hang or not accept
clicks unless the page had enough visible/foreground reality.

The chosen compromise was the worker-window lane:

- keep a worker window behind the user's active window;
- let Chrome briefly activate it if necessary for a real action;
- restore the user's window afterward;
- measure persistent focus disruption rather than demanding zero focus change.

The recent live evidence says this is good enough to stop poking Quora action
behavior for now. The `1.6.487` baseline records:

- a failed-row retry moved to succeeded;
- a fresh 4-row worker-window batch succeeded;
- no active, queued, or failed rows remained for those runs;
- no profile tabs were left open;
- storage timeout/deadline/fallback/abandon counters were clean in the checked
  epochs.

That does not mean the product is done. It means the action-surface risk is no
longer the immediate blocker. The next blocker is storage shape.

## Storage: The Remaining Scaling Problem

The metrics shifted the concern from correctness fire to throughput and
architecture pressure.

We saw two different storage facts at once:

- live storage footprint was only a few megabytes;
- cumulative overlapping read/write volume was huge because full queue and
  progress maps were repeatedly loaded and rewritten.

The dashboard/read path has already improved:

- routine CDP helpers use compact queue views by default;
- dashboard reads use compact projections instead of full queue/progress blobs;
- profile-search content pages request scoped state instead of receiving broad
  storage change payloads;
- content-page scoped projections avoid normal full queue/progress delivery.

But action execution still produces large full-map pressure. The `1.6.487`
baseline for a 4-row worker-window batch still showed tens of megabytes of full
queue/progress reads and writes. That is why the next storage slice is not
"make WAL authority immediately." The next slice is an event-shaped row helper
for high-volume nonterminal progress/lease mutations, with metrics by event
kind and explicit stale-attempt/terminal-preservation rules.

The WAL direction remains right, but it should be earned:

1. make row-level events explicit while still committing through current
   storage;
2. prove that full-map read/write bytes fall without increasing repair churn;
3. shadow WAL for nonterminal progress milestones;
4. only then make selected paths WAL-first;
5. keep terminal queue authority and claim ownership on the proven reducer path
   until replay has demonstrated equivalence.

The target storage architecture remains:

```text
current state = last checkpoint + ordered WAL records after it
```

with A/B checkpoints, gzip-compressed checkpoint snapshots, raw fallback, and
uncompressed or sealed-segment WAL records.

## What We Learned

The main pattern was bypassing the evolved safe entry point.

Early code called direct primitives because direct primitives were all that
existed. Later code kept calling them after the system had grown safer layers:
direct storage writes instead of serialized mutation helpers, direct progress
inference instead of reducer events, direct tab ownership instead of confirmed
durable claims, direct action calls instead of queued/reconciled work.

The paired pattern was calling work directly when it should have been queued.
Foreground profile-page mute/block/close can remain a narrow user-directed
exception. Everything that is background, bulk, retryable, recoverable, or
cross-tab needs to enter the queue/reconciler model.

The most useful review lens became:

- Which actor is allowed to mutate this state?
- Is this a durable fact, a runtime observation, or a UI cache?
- Does this call pass through the reducer or a lower-level primitive?
- If storage is slow or the service worker restarts here, can the next tick
  classify the state without special knowledge?
- Could a stale worker message or late write move a newer attempt backward?

## Why Earlier Reviews Missed Some Breakage

The early system did not have enough executable model tests. Review could find
individual suspicious paths, but many failures depended on timing:

- delayed storage confirmation;
- service-worker suspension;
- tab creation followed by a timeout;
- stale progress arriving after terminal state;
- old content-script DOM buttons surviving extension reload;
- source-page and dashboard views observing different subsets of state;
- background tabs failing Quora actionability rules.

Those cases are hard to catch with static review alone. The synthetic harness,
fuzzer, storage-invariant tests, and compact CDP helpers were added because we
needed to rattle assumptions without waiting for live Quora to reveal each one
slowly.

The test lesson is that state-machine bugs need seeded state snapshots and
repeated ticks to a fixed point, not just happy-path browser runs.

## Where We Are Now

The current local line is `1.6.x` and the package version in the worktree is
`1.6.489`.

The broad state of the project is:

- `Nuke 'Em` has evolved from page-local bulk tab opening into durable queued
  background work.
- The service worker is intended to be the mutation authority.
- The dashboard is a control/reporting surface, not a state owner.
- Runtime tab ownership is provisional until confirmed by durable row,
  attempt/claim token, and tab id.
- Recovery is being normalized into a scheduler/reconciler tick rather than a
  collection of exception paths.
- Real connected-browser control through CDP is now part of the normal live
  validation method, replacing the older human-copy/manual-test loop for many
  debugging tasks.
- Worker-window execution appears reliable enough for small live batches.
- Storage read/write amplification is the next serious architectural pressure.
- Shared moderation work has useful pure/model/test preparation, but runtime
  integration should wait behind queue/storage stability.

The retrospective bottom line:

`1.0` through `1.2` proved the original human-authored product. Early `1.4`
proved AI could repair the broken live extension. Later `1.4` proved the `Nuke
'Em` product idea, even though the first released implementation was only
better-than-nothing reliable. `1.5` exposed the architectural debt and named
the durable job model. `1.6` is the stabilization line that turns that model
into the product's normal execution path. The remaining work is less about
inventing more recovery and more about making the normal reducer/reconciler and
storage layers small, explicit, measured, and boring.
