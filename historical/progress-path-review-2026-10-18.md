# Progress-path review, 18 Oct 2026

> **Status: HISTORICAL** (24 Oct 2026). Review of progress write paths (18 Oct). Superseded by decisions 27 to 32 (progress in session memory). Kept as a record. Do not implement from it. planning.md is the front door. Register: [notes register](../docs/notes-register.md).

Scope: the progress write paths that the session-memory change (decision 31) must re-point, the progress items still open, and the assumptions the progress path still relies on. Closed findings and the verification record are in `historical/clear-history-2026-10-18.md`, section 2.

Line numbers are for the working tree as of 18 Oct 2026. "sw.js" means `shared/js/sw.js`. Search by name if they have moved.

## 1. Progress write paths (for decision 31)

Startup does not write progress. It only reads it. The writes below come from the progress flows. Each save writes progress keys. Under decision 30, a save that also writes any other key is not exempt from the resume rule.

| # | sw.js line | Label as passed to the save | When |
|---|---|---|---|
| 1 | 4072 | reconcile.nonProfileLanding.progressProjection | reconcile pass |
| 2 | 4247 | reconcile.profileRedirectMismatch.progressProjection | reconcile pass |
| 3 | 4567 | reconcile.activeWithoutActor.progressProjection | reconcile pass |
| 4 | 6096 (fed by 34020) | terminalProgress.inline.progressProjection | batched flush |
| 5 | 11605 | reconcile.progressProjection | reconcile |
| 6 | 12026 | terminalSettlement.derived.progressProjection | settlement |
| 7 | 23630 | failedRetry.progressProjectionTombstone | retry failure |
| 8 | 23990 | failedRequeue.progressProjectionTombstone | requeue failure |
| 9 | 24695 | enqueue.progressProjection | enqueue |
| 10 | 25129 | clearProfile.progressProjectionTombstone | clear profile |
| 11 | 33457 | rowEvent.<kind>.projection | row event (progress milestones) |
| 12 | 34000 (restore branch) | terminalProgress.inline.progressProjection | immediate: a terminal update for a finished profile, rebuilt from its queue row |
| 13 | 34029 | directProgress.inline.progressProjection | immediate: direct progress update |
| 14 | 34389 | directProfileProgress.save | immediate: direct profile progress |
| 15 | 11620, delete path at 6137 | reconcile.progressProjectionDelete | reconcile (label not traced) |
| 16 | 10044 (via 35685) | contentPageState.rebuild.<reason> | page request, when the view is absent (see the coder instructions, 4a item 2) |

Batched terminal saves other than the restore branch go through the flush at sw.js 6089-6123. The restore branch at 34000 is the only immediate terminal write.

## 2. Open items

- **Progress repair count** (coder instructions, section 4a, item 2). Measure before the first run.
- **Test-only helper** (`readCoordinatorQueueRowsFromMirror`). Keep or delete: David's choice, in the coder instructions, section 4a, item 1.

The paths in section 1 all write to session memory now, through the door (decision 31, 19 Oct). The rows 12 and 15 (restore and delete) follow the same door. The remaining choices are in the progress durability note, section 3.

## 3. Assumptions the progress path relies on

- Pending markers are written without waiting. Correctness assumes session operations are applied in the order issued (comment at sw.js 7123-7127). A lost marker is covered by two checks: the WAL keys are re-read from disk at startup (the disk meta and segments are read by the store loader, swQueueWalStore.js 215 onward), and each namespace key carries a token that must match its disk copy before the session copy is used (sw.js 10589-10616).
- A namespace write marks the queue mirror as not fresh until its own session write lands (sw.js 7171). A crash in that window falls back to disk. Performance only.

## 4. Not checked

- Live behaviour, timing and counts: the outlier record's size in practice; how many unfinished progress records have no open queue row (see the coder instructions, 4a item 2); how often the resume rule applies.
- The delete path (sw.js 6137, called at 11620): its label, and whether it writes any key other than progress.
- The settings write at sw.js 21725: not traced to confirm that the settings page cannot send a namespace key.
- The load at `swProfileProgressMerge.js` line 462: not traced.
