# Cruft and Drift Review Findings

Status: partially obsolete review record.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this only as a
review snapshot unless current source revalidation says otherwise.

Review target: current dirty working tree in `/scratch/dbrower/home/src/mute-block-main`.

Validation reported during review:

- `git diff --check` passed.
- `node --check` over source, test, and tool JavaScript passed.
- `npm test` passed.

No cleanup edits were made as part of the review.

## Current Status

Status: partially obsolete.

Obsolete or already addressed:

- `timeout-inventory-1.6.md` has since been rewritten with the current
  `90000ms` action/reverse timeout values, so the timeout-inventory example in
  the stale-notes finding is no longer current.
- `review-findings-resolver-queue-2026-05-17.md` now has its own resolution
  block.

Still current:

- obvious scratch files remain in the working tree, including the Emacs-style
  `#timeout-inventory-1.6.md#` autosave and `.codex`;
- foreground-promotion scaffolding still exists in source and remains a real
  cleanup candidate;
- likely-unused helper cleanup still needs focused verification before edits.

## Findings

### P2: Obvious throwaway files are cluttering the working tree

Several root-level untracked files look accidental or scratch-only:

- `#timeout-inventory-1.6.md#`: Emacs-style autosave, stale beside `timeout-inventory-1.6.md`.
- `.codex`: empty root file, almost certainly accidental.
- `sanity-1.6`, `todo-1.5`, `sunday-notes.md`, `user-note.md`: scratch notes that make status harder to read and should be either intentionally promoted or removed.

Impact: the dirty tree is harder to audit, and accidental files can be mistaken for intentional handoff or planning artifacts.

Recommendation: delete the autosave and empty file. For scratch notes, either move useful content into the active plan/handoff note or archive/delete them explicitly.

### P2: Stale or superseded review notes need cleanup

Some notes have drifted from the current tree:

- `refactor-1.6-handoff-2026-05-14.md` appears superseded by `refactor-1.6-handoff-2026-05-17.md`.
- `review-findings-resolver-queue-2026-05-17.md` is no longer clearly positioned if the resolver findings have since been fixed and validated; it should either remain as a historical review-only note or be rewritten/renamed as a resolution note.
- `timeout-inventory-1.6.md` is stale: it says `STALE_ACTIVE_ACTION_QUEUED_TAB_MS` is `30000ms`, while `shared/js/sw.js` now has `90000`; it also says the reverse timeout is special, but the generic and reverse action timeouts are now both `90000`.

Impact: stale notes can mislead follow-up work, especially around timeout behavior and what remains unresolved.

Recommendation: remove or archive superseded handoff notes, clarify the resolver note's status, and update `timeout-inventory-1.6.md` to match the current constants and rationale.

### P2: Disabled foreground-promotion scaffolding remains in source

The current source still carries foreground-promotion/fallback machinery even though the behavior is effectively disabled:

- `shared/js/content.js`: `promoteCurrentQueuedTab()` returns `false`.
- `shared/js/content.js`: `ensureProfileMenuOpen()` immediately disables foreground fallback with `allowForegroundFallback = false`.
- `shared/js/sw.js`: `promoteQueuedTab()` and `promoteNextQueuedForegroundCandidate()` return disabled stubs.
- Some foreground-lease helpers appear unused, including `getQueuedForegroundLeaseTabId`, `noteQueuedForegroundWait`, and `promoteNextQueuedForegroundCandidate`.

Impact: the code still reads as though foreground promotion is a supported fallback path, which makes queue behavior harder to reason about and invites future fixes to revive a path the current model is not using.

Recommendation: do a focused source cleanup that removes the disabled foreground-promotion path and leaves an explicit "no foreground promotion" model in the scheduler/content flow.

### P3: Likely unused helper functions should be pruned after verification

The review found likely-unused newer helpers:

- `shared/js/content.js`: `unmuteProfile()`
- `shared/js/content.js`: `getPendingCoordinatorSpaceFeedWorkCountForSpace()`

Older unused helpers also remain, but may not belong to the latest patch set:

- `getQuestionDebugState()`
- `scheduleCoordinatorStorageRepair()`
- `getQueueableSpaceFeedEntries()`

Impact: unused helpers increase the cost of reading the queue and space-feed code, and they obscure which behavior is active versus historical.

Recommendation: verify each candidate with source search before deleting it. Prioritize the new likely-unused helpers and the foreground-promotion helpers because they are closest to the active refactor.

## Cleanup Order

1. Delete or archive obvious throwaway files.
2. Update, remove, or rename stale/superseded notes.
3. Remove disabled foreground-promotion/fallback scaffolding so the source reflects the current no-promotion model.
4. Prune likely-unused helpers after focused call-site verification.
