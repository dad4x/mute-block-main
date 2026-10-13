# Storage Row Event Baseline - 1.6.487 - 2026-05-23

## Live Reliability Checkpoint

- Version: `1.6.487`
- Browser target: Windows Chrome through repo-local CDP helpers
- Extension reload: clean, zero manifest/runtime errors
- Worker-window retry: `Zanna-Klein-SEO-Tools-Provider` retried from failed to succeeded
- Fresh worker-window batch: 4 queued Elon profiles, 4 succeeded
- Queue after runs: no active, queued, or failed rows for the tested runs
- Browser after runs: no live profile tabs
- Storage health: no storage timeouts, deadline misses, fallback returns, abandoned updates, or late-write suppressions in the checked epochs

## Storage Shape Observed

The compact profile-search/scoped read fixes appear correct:

- `contentPageState.queueFallback.truncated` stayed absent/zero during the checked normal profile-search runs
- content source index reads were tiny when present
- full queue/progress pressure remains dominated by action execution and ordinary mutation paths, not profile-search scoped fallback

Representative fresh 4-row batch metrics:

- `storagePayload.read.queue.bytes`: 81,853,052
- `storagePayload.read.progress.bytes`: 14,611,085
- `storagePayload.write.queue.bytes`: 18,841,139
- `storagePayload.write.progress.bytes`: 4,320,553
- `repair.requested`: 55
- `repair.noop`: 28
- `storageQueueWait.maxMs`: 5,825
- `storageGet.maxMs`: 380
- `storageSet.maxMs`: 444

Representative failed-row retry metrics:

- `storagePayload.read.queue.bytes`: 28,671,701
- `storagePayload.read.progress.bytes`: 6,708,621
- `storagePayload.write.queue.bytes`: 8,001,073
- `storagePayload.write.progress.bytes`: 2,772,749
- `repair.requested`: 18
- `repair.noop`: 8
- `storageQueueWait.maxMs`: 1,570
- `storageGet.maxMs`: 284
- `storageSet.maxMs`: 252

## Next Slice

Introduce an event-shaped row helper for nonterminal queued progress milestones only. Keep terminal progress, durable queue ownership, claim tokens, tab ids, active transitions, and action lease state on the existing authority paths for this slice.

Guardrails:

- reject stale attempt ids before mutation
- preserve terminal rows against late nonterminal breadcrumbs
- do not infer queue terminal state from compatibility progress
- emit metrics per event kind
- prove equivalence with the existing snapshot path in deterministic tests

Acceptance:

- same worker-window correctness as this checkpoint
- materially lower full queue/progress read/write bytes for a 5-10 row run
- no increase in repair/no-op churn
- no `contentPageState.queueFallback.truncated` in normal profile-search polling
