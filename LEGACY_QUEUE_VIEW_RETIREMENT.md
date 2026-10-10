# Retirement of `mbCoordinatorQueueView` and its recovery path

Written 2026-10-09 for anyone reading the queue code later and wondering why a key, a tool, or a
recovery function is missing. Everything here is also in the git history. The last commit that still
had the full path was `e12c50c` (v1.6.1388). The removal is uncommitted as of this writing.

## What it was

`mbCoordinatorQueueView` was a disk copy of the queue in the dashboard's compact shape. The service
worker rebuilt it from the live authority after writes, so the dashboard could read it without
replaying the WAL. It lived in `browser.storage.local` under that key.

It also had a second job. If the WAL became unreadable, the service worker rebuilt a fresh WAL store
from this view. That recovery is `attemptCoordinatorQueueWalAutoRecoveryFromView` in `sw.js`. The
matching CDP helper was `tools/cdp/recover-queue-wal-from-view.js`, which did the same thing by hand.

## Timeline

- **2026-09-15.** Auto-recovery from the view was added. A WAL hydrate failure rebuilt the authority
  from the view and persisted it through `scheduleCoordinatorQueueWalAutoRecoveryPersist`.
- **2026-10-01 / 10-02.** The disk copy was removed. Writes stopped, and reads of the key stopped
  being useful. The recovery stayed in place and became a no-op, because the key always read empty.
  Existing installs kept whatever stale copy they had.
- **2026-10-09.** The recovery was retired. The view was no longer read on hydrate failure, the
  recovery and its persist helper were deleted, and the CDP helper was removed. The stale key is now
  deleted once at startup by `retireLegacyQueueViewStorageKey`.

## Why the recovery was retired

The view was a pre-WAL copy. Rebuilding the authority from it after a WAL failure could bring back
rows the WAL had already moved past, such as completed or cancelled work. That is silent data
corruption, so the recovery was removed rather than kept as a fallback. The tradeoff is that a WAL
hydrate failure now stops the queue, instead of recovering from a copy that may be stale. The
hydrate-failure contract throws, and the queue reset to an empty checkpoint still applies when the
snapshot is empty.

## What was removed, and what was left

Removed:
- `buildCoordinatorQueueFromView` in `shared/js/swCoordinatorQueueView.js`, the view-to-queue builder.
  It had no callers once the recovery was retired, so it went in the same pass.
- `attemptCoordinatorQueueWalAutoRecoveryFromView` and `scheduleCoordinatorQueueWalAutoRecoveryPersist`
  in `shared/js/sw.js`, with the promise variable and the `buildCoordinatorQueueFromView` import.
- The hydrate-failure branch that called them.
- `tools/cdp/recover-queue-wal-from-view.js`.
- The stored `mbCoordinatorQueueView` key on existing installs, through the startup cleanup.

Left in place on purpose:
- The `COORDINATOR_QUEUE_VIEW_KEY` constant and the `queue-view-refresh` dashboard broadcast. The key
  name is used as a message field, not as a storage key. Do not confuse the two.
- The counter `coordinatorAuthority.queueWal.segmentedRecoveryRetired`, which counts hydrate failures
  that used to reach the view path.

## Storage cleanup

The dev profile was checked over CDP on 2026-10-09 with `tools/cdp/dump-storage-keys.js`. The key
read null, so the dev profile had no stale copy. The startup removal exists for installed copies,
which the dev check cannot see. Removing an absent key is a no-op, so the cleanup is safe to run
on every startup.

## Where else the old name still shows up

These are historical and were left unchanged:
- `codex-review-8-oct.md` and `queue-wal-segmented-record-followup-2026-05-27.md` describe the view
  and the removed CDP helper.
- Comments in `sw.js` around the 2026-10-01 removal still describe the view as the state of the
  world at that time. They are dated on purpose.
- `architecture.md` and `codebase-familiarization-notes-2026-08-28.md` in old worktrees describe the
  view as live.

## If you need it back

Check out `e12c50c` and read `attemptCoordinatorQueueWalAutoRecoveryFromView` and its neighbors in
`shared/js/sw.js`. The recovery was never tested against a real corrupted WAL, only against synthetic
fixtures in `test/swSynthetic.test.js`. Restoring it means deciding again whether a stale copy is
better than no queue, and that decision belongs to the person running the extension.
