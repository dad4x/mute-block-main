# Window slot release: when the tab may close (options, owner decision)

> **Status: ROADMAP** (24 Oct 2026). Owner decision open: when a blocked tab may close. Evidence from one five-minute run. No code changed. Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: open. No code changed. Owner decision needed before any change.

## Evidence (17 Oct, concurrency 1, five-minute run)

- A blocked tab is normally released about 1.1 s after the block (median 1.09 s, p90 3.7 s).
- One tab lingered 58 s. The flight recorder shows the storage update lane stalled for about 38 s
  in that window, with two storage-update timeouts (03:49:35 and 03:49:58 UTC). A content state
  request took 23.4 s (median 0.24 s). The row could not finish until the lane cleared.

## The rule today

- `releaseQueuedTab` (shared/js/sw.js, around line 31900 to 32000) closes the tab directly only when
  the in-memory progress record is terminal (`isTerminalProfileNukeRecord`, around line 31896).
- That record is set after the durable write, in `recordCoordinatorJobProgressRecords`
  (shared/js/sw.js, around line 33761). So the close waits for the durable write, and the durable
  write waits for the storage update lane.
- The window counts as busy while any non-anchor tab is in it
  (`createOwnedTabInQueuedWorkerActionSurface`, shared/js/sw.js, around line 28356).

## Option (a): keep the current rule

The tab closes only after the terminal write is durable.

- Safe: the terminal record and the tab's close cannot disagree.
- Cost: a stalled storage lane holds the window slot for as long as the lane is stalled. The
  58-second case is this cost.

## Option (b): close on the in-memory terminal decision

The tab closes as soon as the in-memory progress record is terminal. The durable write finishes
afterwards.

Failure cases that must each have a test before (b) is built:

1. The durable write fails after the tab has closed. The row is then not terminal in storage, but
   its tab is gone. Recovery must terminalize the row from the in-memory record, or requeue it. The
   test must show which, and that the row does not stay active with no tab.
2. The worker restarts between the close and the durable write. The in-memory terminal decision is
   lost, and the row is still active with no tab. The stale-active watchdog is the fallback. The
   test must show the row ends terminal or requeued, not stuck.
3. The content script reports blocked, but the progress record is not (yet) terminal, or it is
   superseded by a newer attempt. The close must not run for a superseded attempt. The test must
   show the close is skipped, and the row follows its own path.

## Recommendation

Choose (b) only with tests for all three failure cases. Until then, keep (a). The 58-second case
should be addressed first by the storage lane work (instrumentation, and the blocked-page-event
check), which does not change when the tab closes.

## Owner choice

- [ ] (a) keep the current rule
- [ ] (b) close on the in-memory terminal decision, with the three tests
