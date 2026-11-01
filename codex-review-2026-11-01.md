# De-novo Code Review

- **Target:** rc/1.6 at 19a4f435f4f7bd5576ebf0d8935f7bc77ef4796f (19a4f43)
- **Review date:** 2026-11-01
- **Scope:** Full repository snapshot, including content-script actions, coordinator queue identity/dispatch, persistence, manifests, and the test suite. This review starts from the complete snapshot rather than limiting itself to the commit diff.
- **Validation:** npm test; npm run lint:correctness; npm run lint:queue-boundary; npm run lint:block-classification; npm run lint:queue-storage-layering. All passed. Focused runtime reproductions also confirmed the queue identity, reverse-action, and selector issues below.

## Findings

### [P1] Preserve stored profile identity through queue dispatch

**Location:** shared/js/swCoordinatorExecutorClassification.js:98-115; dispatch URL selection at shared/js/swProfileResolution.js:262-267; canonical subject creation at shared/js/jobState.js:710-755; content claim handling at shared/js/content.js:13391.

The 19a4f43 change preserves targetProfileHref with storedProfileHref, but queue identity helpers still pass that already-canonical value through normalizeQuoraProfileHref. For a target first normalized from https://www.quora.com/Name-1-2-3, the stored target is https://www.quora.com/profile/Name-1-2; getCoordinatorItemHref changes it again to .../Name-1. getCoordinatorItemOpenUrl uses that result as the executor tab URL, and upgradeCoordinatorQueueItem also builds canonicalSubject by normalizing the stored target again. Content claim handling normalizes claimedAction.targetUrl again when setting queuedProfileHref.

This can open the wrong profile for a queued mute/block action. It also aliases queue lookup: when both .../profile/Name-1-2 and .../profile/Name-1 rows exist, findCoordinatorQueueEntryForHref normalizes the first target to the second key and returns the Name-1 row. The focused reproduction produced targetProfileHref = .../Name-1-2, canonicalSubject.href = .../Name-1, and a lookup for the first row returning the second row.

Use the canonical-only reader for persisted queue targets and canonical subjects; normalize only raw URLs at their input boundary.

### [P2] Do not report Pardon success when unmute could not be checked

**Location:** shared/js/content.js:15027-15038, shared/js/content.js:15170-15182; queued completion at shared/js/content.js:13986-14008.

When the profile starts blocked, unblockUnmuteProfile only treats the exact reason unmute-clicked-unverified as a fatal unmute result. But unmuteProfileBestEffort also returns failures such as {ok:false, reason:'profile-menu-not-open'}. After a successful unblock, that failure falls through and the outer function returns ok:true. The queued Pardon path then verifies only that the profile is unblocked, records terminal unblocked success, and closes the tab; the profile may remain muted. The manual Pardon path can also clear the stored state and show “Unblocked”.

A focused harness running the real functions returned ok:true with unmute.ok:false and unmute.reason='profile-menu-not-open'. Treat every unverified unmute failure as incomplete, while retaining explicit “already unmuted”/“option not offered” outcomes if those are intended successes.

### [P2] Keep the unmute confirmation fallback inside a confirmation surface

**Location:** shared/js/content.js:14291-14302, shared/js/content.js:14412-14448, shared/js/content.js:14505-14528.

If dialog-scoped lookup finds no Unmute confirmation, getUnmuteConfirmAction falls back to getInPageConfirmPairAction, which scans every visible button, role button, and link in the page. That fallback accepts a bare “Unmute” label and matching context as confirmation evidence; the confirmation-kind check accepts the same text without requiring a dialog, cancel peer, or confirmation wording. If the real dialog is not recognized while an unrelated in-page Unmute control is visible, the action can click that control and unmute another profile, while the intended profile remains unchanged.

A focused selector harness with no dialog and an unrelated “Unmute Another User” button selected that button, and the confirmation-kind check returned no mismatch. Restrict this fallback to a positively identified confirmation surface and require confirmation context.

## Review notes

The first finding is a remaining queue-execution path beyond the canonical-reader call sites covered by storedProfileHref.test.js. The existing contentUnmuteVerification.test.js covers the clicked-but-unverified result but not the menu-open failure above. No other confirmed actionable findings were identified in this pass.

## Fix verification: 4db5c8f

- **Target checked:** `rc/1.6` at `4db5c8fc2ceef6e1f565ac3f12d8093bad87bebc`.
- **Validation:** `npm test`, `npm run lint:correctness`, `npm run lint:queue-boundary`, `npm run lint:block-classification`, and `npm run lint:queue-storage-layering` all passed. The focused queue identity, review, selector, and unmute verification tests also passed.
- **Stored profile identity finding:** fixed for queue rows with a stored `targetProfileHref`. The new runtime tests confirm the stored Name-1-2 identity is preserved through lookup, canonical subject creation, envelope construction, executor dispatch, and raw live-tab matching.
- **Unmute confirmation selector finding:** fixed. The selector tests pass for real confirmation dialogs; an additional runtime harness confirmed that a page with no dialog and an unrelated “Unmute Another User” button yields no confirmation action.
- **Pardon completion finding:** the previously reported cases where `unmuteProfileBestEffort()` returned `ok: false` are now rejected by both blocked and already-unblocked flows. A narrower false-success remains:

### [P2] Treat an unreadable unmute menu as unverified

**Location:** `shared/js/content.js:15044-15060`; result handling at `shared/js/content.js:15182-15185` and `15199-15202`.

When the profile menu opens but `waitForMenuStateWithForegroundFallback()` cannot identify either the Unmute action or its inverse Mute action, `unmuteProfileBestEffort()` falls through to `unmute-option-not-offered` with `ok: true`. The helper only establishes “already unmuted” when it positively sees the inverse state; a null menu state means the mute status is unknown. Both Pardon branches accept this result as success, and the blocked branch can clear the stored nuke state.

A harness using the real helper and outer Pardon function reproduced `ok: true` after a successful unblock with an unknown menu state and no recognized action. Return an unverified failure for this null/unknown state; reserve success for a positively observed inverse Mute action (or another explicit verified state).

