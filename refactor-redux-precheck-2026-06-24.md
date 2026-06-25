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

## Suggested Next Action

Start refactor-redux with a read-only transition inventory, then implement one
narrow vertical slice:

- First, classify every queue mutation site as transition, durability adapter,
  projection/effect, scheduler, or illegal side-channel.
- Then move active-tab materialization behind a single durable transition
  result: durable queued row -> transition to active -> effect opens/restores
  runtime surface -> observation confirms or reports failure through the same
  transition API.
- Only after that slice is stable should we resume 24/100/300 live queue gates.

## Validation Notes

At checkpoint time:

```text
node --check shared/js/sw.js
```

passed.

No broader test result is implied by this file.
