# Mute Block Review 2

**Reviewed revision:** HEAD `bbf073765040d853f0e157648c7305b68dce6ba9` (merge commit, 2026-10-25). This review checks the findings in `codex-mb-review-1.md` against committed source at this revision and records the remaining gaps. No tests, builds, or live browser operations were run.

## Review 1 disposition

| Review 1 finding | Status at this revision |
|---|---|
| Clear leaves pending-space records | **Partially fixed.** Clearing removes pending entries associated with selected queue/completed rows. Already-orphaned entries remain if no queue/completed rows are selected. |
| Manual direct-action progress is a separate protocol | **Open.** The direct profile-action path still sends `record-direct-profile-progress`; this is a documented exception in comments but not aligned with the stated architecture cleanup target. |
| Run bucket-layout compatibility remains | **Fixed.** The old `COORDINATOR_RUNS_LAYOUT_KEY` bucket path is removed. |
| Diagnostic shadow checks add path cost | **Open.** Shadow WAL comparisons and deep-pending shadow tracking remain. The prior run-gap watcher finding no longer appears in the current source. |
| Run retention shards do not partition checkpoints | **Fixed.** The checkpoint callback routes the `runs` area through `runAreaShardOf`. |
| `architecture.md` has stale state/violation claims | **Open.** Its current-state map is still labeled 24 Oct and retains claims that conflict with this revision. |

## Findings

### 1. Clear Current Work does not clean already-orphaned pending entries

**Severity: P2 · Confidence: high.**

`mutateCoordinatorStoredWorkClear` now reads `SPACE_PENDING_NUKED_POSTS_KEY`, removes pending candidates for the profiles associated with the rows being cleared, and includes the changed pending map with the queue/completed removals (`shared/js/sw.js:26805-26920`). However, the function still returns early when there are no selected queue or completed rows, before reading and reconciling pending records. A stale record with no corresponding live/completed row therefore survives a subsequent Clear Current Work operation.

The remaining question is product semantics: should Clear Current Work also remove orphan-only records, or are such records intended to persist until age pruning/reconciliation? Make that contract explicit and cover the orphan-only state.

### 2. Manual profile progress still bypasses the queued job protocol

**Severity: P2 · Confidence: high.**

Queued work reports attempt-scoped milestones and terminal events. A direct action on a manually opened profile still enters the non-queued branch in `shared/js/content.js` and sends `record-direct-profile-progress` fire-and-forget; the worker handles it separately in `shared/js/swBootstrap.js` and `shared/js/sw.js:35234+`. The worker has timestamp ordering/tombstone protections against stale direct writes, so this is not the prior claim that content races queued terminal state.

The remaining architecture gap is that manual actions have a second progress protocol without queue attempt identity and do not pass through the job reducer. Either document it as a supported observation-only exception with clear lifetime rules, or converge it with the intended boundary.

### 3. Diagnostic shadow machinery remains in hot worker paths

**Severity: P2 · Confidence: high that it remains; cost not measured here.**

The worker still maintains and appends coordinator/progress shadow WALs and compares projected records (around `shared/js/sw.js:8,800-9,600`), and retains deep-pending shadow tracking (around `shared/js/sw.js:18,900-19,200`). The repository's dead-ends review marks shadow checks for removal because they add work to mutation/reconciliation paths. The prior run-gap watcher is no longer present as a live periodic check.

Remove the shadow instrumentation as planned, or record a current measurement and an explicit retention rationale. This review did not measure current runtime cost.

### 4. The canonical architecture map still describes the previous state

**Severity: P2 · Confidence: high.**

The current committed `architecture.md` still labels its state map “as built, 24 Oct” and says completed pruning was not re-verified, old run-bucket code remains, and Clear Current Work leaves pending rows. It also retains older fragmentation text about content progress competing with queued terminal writes and queue/view snapshots. Current HEAD implements completed pruning, removes run bucket compatibility, partially clears pending entries, and keeps queued progress on the attempt-scoped worker protocol while preserving a separate manual protocol.

This leaves maintainers with contradictory guidance. Refresh the canonical map and fragmentation list from current source, clearly distinguishing the remaining orphan-only clear gap and manual-progress exception from already-fixed issues.

## Summary of resolved work

At this revision, the pending clear was extended, run bucket compatibility was removed, and run records now use their own checkpoint partitions. These changes resolve or reduce three findings from Review 1. The outstanding work is the orphan-only pending cleanup decision, the manual progress protocol boundary, shadow diagnostic removal/measurement, and the stale canonical architecture documentation.

## Method

Read the previous reports and current repository notes, inspected source at the committed HEAD (including worker clear, run sharding, progress reporting, and architecture claims), and used independent inventories to cross-check dispositions. Working-tree state was not treated as the review baseline. No tests or builds were run.
