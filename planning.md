# Mute Block Planning

Date: 2026-05-20

This is the canonical planning front door for the current `main` line. Use this
file first, then follow the linked notes only for detail.

The active development line is private `1.6` stabilization for the public `2.0`
release. The older `1.5` notes are design history and slice detail, not the
place to start new work.

## Current Priority Order

1. Stabilize queue execution and recovery.
   The live-debug line is still finding scheduler/storage edge cases. Do not add
   new runtime entry points until queue authority is boring.

2. Converge on the normal reconciler model.
   The active design direction is that durable queue state plus live browser
   observations are reconciled by a bounded scheduler tick. Direct operate paths
   may request ticks, but they should not be a competing authority.

3. Finish storage authority cleanup before WAL integration.
   Reduce scattered full-state load/save call sites, quarantine compatibility
   writers, and keep write reasons visible before making WAL the normal
   durability layer.

4. Expand deterministic tests around the scheduler/storage invariants.
   Live Quora testing remains useful evidence, but regression protection should
   live in synthetic state-machine, storage, fixture, and mock-browser tests
   whenever possible.

5. Resume shared moderation integration after queue/runtime stabilization.
   The pure model, fixtures, and mock harness can continue safely. Runtime
   integration must remain local-policy-first and must not become a remote
   command channel.

## Active Work Lanes

### Queue And Scheduler

Status: active and volatile.

Canonical architecture: [architecture.md](architecture.md).

Supporting notes:

- [normal-reconcile.txt](normal-reconcile.txt): most recent statement of the
  "repair is normal processing" direction and implementation guardrails.
- [reconciler-first-fallback-architecture-2026-05-20.md](reconciler-first-fallback-architecture-2026-05-20.md):
  design rationale and pivot criteria.
- [queue-wakeup-metrics-model-2026-05-20.md](queue-wakeup-metrics-model-2026-05-20.md)
  and [queue-wakeup-analysis-playbook-2026-05-20.md](queue-wakeup-analysis-playbook-2026-05-20.md):
  metrics model for deciding whether pumps, nudges, and repair are healthy.
- [timeout-inventory-1.6.md](timeout-inventory-1.6.md): current timeout
  inventory, useful for auditing scheduler deadlines.

### Storage Authority And WAL

Status: active design and refactor lane.

Supporting notes:

- [storage-authority-refactor-plan-for-review-2026-05-20.md](storage-authority-refactor-plan-for-review-2026-05-20.md):
  current storage authority cleanup plan.
- [storage-authority-callsite-inventory-2026-05-20.md](storage-authority-callsite-inventory-2026-05-20.md):
  call-site inventory for storage authority review.
- [storage-wal-overlay-design-2026-05-20.md](storage-wal-overlay-design-2026-05-20.md):
  target WAL/A-B checkpoint/gzip design.
- [batching-metrics.md](batching-metrics.md): metrics to tell whether batching
  reduced full writes or only delayed them.
- [handoff-storage-authority-refactor-2026-05-20.md](handoff-storage-authority-refactor-2026-05-20.md):
  point-in-time handoff, not the canonical plan.

### Tests And Harnesses

Status: active support lane.

Supporting notes:

- [regression-test-suite-ideas-2026-05-18.md](regression-test-suite-ideas-2026-05-18.md):
  layered test strategy.
- [firefox-mock-harness-integration-plan-2026-05-19.md](firefox-mock-harness-integration-plan-2026-05-19.md):
  mock Quora/Firefox harness integration.
- [shared-moderation-test-plan-2026-05-20.md](shared-moderation-test-plan-2026-05-20.md):
  shared moderation pure/model and future runtime tests.
- [shared-moderation-live-operation-test-outline-2026-05-20.md](shared-moderation-live-operation-test-outline-2026-05-20.md)
  and [shared-moderation-live-quora-test-plan-2026-05-20.md](shared-moderation-live-quora-test-plan-2026-05-20.md):
  future live shared-moderation gates.

### Shared Moderation

Status: pure/model and planning lane; runtime integration deferred until queue
authority stabilizes.

Supporting notes:

- [shared-moderation-publication-design-2026-05-18.md](shared-moderation-publication-design-2026-05-18.md):
  core design.
- [shared-moderation-publication-implementation-plan-2026-05-18.md](shared-moderation-publication-implementation-plan-2026-05-18.md):
  implementation plan for Quora shared posts.
- [shared-moderation-integration-steps-2026-05-19.md](shared-moderation-integration-steps-2026-05-19.md):
  staged integration steps.
- [shared-moderation-runtime-boundary-handoff-2026-05-20.md](shared-moderation-runtime-boundary-handoff-2026-05-20.md):
  runtime boundary handoff.
- [quora-labeler-bridge.md](quora-labeler-bridge.md),
  [atproto-moderation-model.md](atproto-moderation-model.md), and
  [labeler-management-note.md](labeler-management-note.md): future publication
  architecture context.

## Historical Or Supporting Notes

- [refactor-1.6-plan.md](refactor-1.6-plan.md): prior canonical plan for the
  `1.6` line. Keep it as detailed context; update this file first for new
  priority decisions.
- [top-level-rethink-1.5.md](top-level-rethink-1.5.md): durable-job design
  history carried forward into `1.6`.
- [top-level-rethink-1.5-execution-plan.md](top-level-rethink-1.5-execution-plan.md):
  detailed historical execution checklist. Useful for provenance, but current
  status must be rechecked.
- [coordinator-page-refactor-plan-2026-05-08.md](coordinator-page-refactor-plan-2026-05-08.md):
  older coordinator-page split plan now mostly absorbed by the `1.6` scheduler
  and dashboard work.
- [other-codex-ordered-handoff-2026-05-19.md](other-codex-ordered-handoff-2026-05-19.md):
  short-lived work ordering handoff. Preserve as a timestamped snapshot.
- [review-fix-checklist-2026-05-20.md](review-fix-checklist-2026-05-20.md):
  resolution record for dated review notes.
- [release-summary-1.6-aka-2.0.md](release-summary-1.6-aka-2.0.md):
  public release narrative draft, not an engineering plan.

## Rules For Future Notes

- New active work should update this file and, when architectural, also update
  [architecture.md](architecture.md).
- Dated notes are allowed as snapshots, investigations, review records, and
  handoffs. Their first section should say whether they are active, supporting,
  superseded, or historical.
- Avoid creating a new root plan unless it captures a bounded investigation or
  handoff. If it changes priority, fold the outcome back here.
