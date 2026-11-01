# Pause: should owned tabs close before the paused rows are persisted? (options, owner decision)

> **Status: ROADMAP** (24 Oct 2026). Owner decision open: close owned tabs before or after the paused rows are saved. The single-shape part is done (pause flag set first). Not scheduled. Check planning.md before acting on it. Register: [notes register](docs/notes-register.md).

Status: open. Only the single-shape part is implemented: the pause flag is set before any await, so new opens stop at once.
Nothing about the order of the close and the persist has changed.

## What is already done (18 Oct)

- `pauseCoordinatorNukes` (shared/js/sw.js) sets `coordinatorPauseRequested = true` as its first statement, before the storage
  generation read. It records `pause-requested` at entry and `pause-effective` when the flag is set.
- The fill loop and the pre-open gate read that flag first, so new opens stop without waiting for any storage write.
- Test: `pause takes effect before a stalled storage write` (test/swSynthetic.test.js). Every storage write is stalled, and both
  events are still recorded.

## What is still in the order

1. `pauseCoordinatorNukes` writes the pause control state.
2. `pauseCoordinatorNukesCleanup` requeues the active rows (`mutateCoordinatorStoredWorkPause`, a storage write).
3. A guaranteed sweep (`pauseStoredCoordinatorWork`) requeues whatever step 2 missed.
4. Only then are the owned tabs closed (`browser.tabs.remove`).

Owned tabs stay open until the rows are persisted as paused. In the run that prompted this note, that wait was about 37 s.

## Options

**(a) Keep the order: persist first, then close the tabs.**
- Invariant: a row is persisted as paused or queued before its tab closes, so no durable row points at a closed tab.
- Cost: an owned tab stays open while a storage write stalls. The tab cannot take new work, and a blocked tab keeps the window busy.
- Failure cases: none new. A stalled write delays the close, and the pause has still stopped new opens.

**(b) Close the tabs first, then persist the paused rows.**
- Invariant changes: for a moment a row can be active with a tab id that no longer exists. A worker restart in that moment leaves it that way.
- Recovery depends on the existing reconcile for active rows with no tab, and on the 3-minute stale-active watchdog.
- Failure cases, each needs a test before (b) is built:
  1. The persist fails after the tabs have closed. The row stays active with no tab until reconcile or the watchdog requeues it.
  2. The worker restarts between the close and the persist. Same outcome, with a restart in the middle.
  3. The content script reports blocked while the row is not yet terminal. The row's outcome must still be recorded when the
     tab closes, or the block is lost from the record.

## Recommendation

Keep (a). The pause now stops new opens at once, so the only cost left is the time an owned tab stays open, and (b) moves the risk
onto recovery paths. Choose (b) only with tests for all three failure cases.

## Owner choice

- [ ] (a) keep the current order
- [ ] (b) close the owned tabs first, with tests for the three failure cases
