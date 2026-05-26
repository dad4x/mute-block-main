# Storage Refactor Start Checkpoint

Date: 2026-05-20T18:37:41Z

Status: baseline checkpoint.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). This file records the
storage refactor starting state and should not be treated as an active plan.

## Git Baseline

- Branch: `main`
- HEAD: `0e07a3d`
- HEAD subject: `Start 1.6 main lane targeting 2.0`
- HEAD date: `2026-05-10 10:29:39 -0700`
- Staged files: none
- Package/version state: `1.6.373`

## Dirty Working Tree Summary

Tracked files modified:

- `AGENTS.md`
- `atproto-moderation-model.md`
- `manifests/chrome.json`
- `manifests/firefox.json`
- `package-lock.json`
- `package.json`
- `quora-labeler-bridge.md`
- `readme.md`
- `refactor-1.6-plan.md`
- `shared/coordinator.html`
- `shared/css/content.css`
- `shared/css/coordinator.css`
- `shared/css/popup.css`
- `shared/js/content.js`
- `shared/js/coordinator.js`
- `shared/js/popup.js`
- `shared/js/subject.js`
- `shared/js/sw.js`
- `shared/popup.html`
- `test/subject.test.js`
- `top-level-rethink-1.5-execution-plan.md`

Current tracked diff stat before creating this checkpoint note:

```text
21 files changed, 16603 insertions(+), 3489 deletions(-)
```

Untracked repo artifacts present before creating this checkpoint note:

- `#timeout-inventory-1.6.md#`
- `.codex`
- `batching-metrics.md`
- `firefox-mock-harness-integration-plan-2026-05-19.md`
- `mute-block-ios-safari-plan.md`
- `other-codex-ordered-handoff-2026-05-19.md`
- `queue-wakeup-analysis-playbook-2026-05-20.md`
- `queue-wakeup-metrics-model-2026-05-20.md`
- `reconciler-first-fallback-architecture-2026-05-20.md`
- `refactor-1.6-handoff-2026-05-14.md`
- `refactor-1.6-handoff-2026-05-17.md`
- `regression-test-suite-ideas-2026-05-18.md`
- `release-summary-1.6-aka-2.0.md`
- `review-executor-tab-lifecycle-2026-05-19.md`
- `review-findings-cruft-cleanup-2026-05-17.md`
- `review-findings-resolver-queue-2026-05-17.md`
- `review-findings.md`
- `review-fix-checklist-2026-05-20.md`
- `review-pause-resume-cancel-ordering-2026-05-19.md`
- `review-progress-vs-queue-authority-2026-05-19.md`
- `review-recovery-resume-triggers-2026-05-19.md`
- `review-recovery.md`
- `review-storage-serialization-boundaries-2026-05-19.md`
- `sanity-1.6`
- `shared-moderation-design-mb-development-post-2026-05-18.txt`
- `shared-moderation-integration-steps-2026-05-19.md`
- `shared-moderation-publication-design-2026-05-18.md`
- `shared-moderation-publication-implementation-plan-2026-05-18.md`
- `shared/js/jobState.js`
- `shared/js/walSnapshotStore.js`
- `storage-authority-refactor-plan-for-review-2026-05-20.md`
- `storage-wal-overlay-design-2026-05-20.md`
- `sunday-notes.md`
- `test/fixtures/`
- `test/jobState.test.js`
- `test/lib/`
- `test/p1-contract.test.js`
- `test/rawReportPages.test.js`
- `test/storageInvariants.test.js`
- `test/swScenarioFuzz.test.js`
- `test/swSynthetic.test.js`
- `test/walSnapshotStore.test.js`
- `test/walSnapshotStoreFuzz.test.js`
- `timeout-inventory-1.6.md`
- `todo-1.5`
- `tools/`
- `user-note.md`

This checkpoint note itself was created after that status snapshot.

## Recent Validation State

- `npm test` passed at version `1.6.373`.
- `npm run prod` passed at version `1.6.373`.
- `npm run build:chrome` produced `chrome/mute_block-1.6.373.zip`.
- `npm run build:firefox` produced `firefox/mute_block-1.6.373.zip`.
- Chrome unpacked build was synced to the Windows profile and reloaded.
- Live Chrome extension check:
  - id: `ajcjckiafbnhioeafaejlaehkmdcdeha`
  - version: `1.6.373`
  - manifest errors: none
  - runtime errors: none

## Live Queue Snapshot

At checkpoint time, the live Elon slice was not empty:

```json
{
  "needle": "elon",
  "rowCount": 472,
  "counts": {
    "canceled": 93,
    "succeeded": 289,
    "queued": 90
  },
  "profileTabCount": 2,
  "profilePages": [
    "https://www.quora.com/profile/Elon-Musk-112",
    "https://www.quora.com/profile/Elon-Musk-1000"
  ]
}
```

The extension was clean, but the earlier hidden search collection appears to
have eventually queued additional Elon work. Do not assume the live browser is
idle without rechecking.

## Notes To Treat As Starting Context

- `storage-wal-overlay-design-2026-05-20.md`
- `storage-authority-refactor-plan-for-review-2026-05-20.md`
- `batching-metrics.md`
- `queue-wakeup-metrics-model-2026-05-20.md`
- `queue-wakeup-analysis-playbook-2026-05-20.md`
- `reconciler-first-fallback-architecture-2026-05-20.md`
- `review-fix-checklist-2026-05-20.md`

The current refactor priority is not "wire WAL immediately." The next work
should start with:

1. Full-state load/save call-site inventory as a checked artifact.
2. Snapshot-write reason metrics and static guards.
3. Delete/keep/quarantine inventory for compatibility and legacy mutation
   paths.
4. A thin production `chrome.storage.local` adapter seam with no behavior
   change.

## Non-Negotiable Constraints

- This is a normal Git repo, not ADE.
- Do not apply ADE checkout or transaction rules here.
- Repo-local edits/tests/builds/CDP validation are authorized.
- Never use Puppeteer; use direct CDP helpers under `tools/cdp/`.
- Preserve unrelated dirty-tree changes.
- For shipped behavior changes, bump version first, then test/build/package.
