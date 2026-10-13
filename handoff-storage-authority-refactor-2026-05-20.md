# Handoff: Storage Authority Refactor

Date: 2026-05-20T18:39:08Z

Status: point-in-time handoff.

Canonical planning now starts at [planning.md](planning.md). Canonical
architecture starts at [architecture.md](architecture.md). Use this note only to
recover the May 20 handoff context; refresh the canonical notes for current
state.

## Required Operating Rules

- Run `skills-book` first.
- This repo is `/scratch/dbrower/home/src/mute-block-main`.
- This is a normal Git repo, not ADE. Do not apply ADE checkout,
  transaction, or view rules.
- Repo-local edits, tests, builds, packaging, and CDP validation are already
  authorized by the user.
- Never use Puppeteer. Use direct CDP helpers under `tools/cdp/`.
- Preserve unrelated dirty-tree changes.
- For shipped behavior changes, bump version first, then run tests/builds and
  regenerate packaged outputs.

## Git And Build State

- Branch: `main`
- HEAD: `0e07a3d`
- HEAD subject: `Start 1.6 main lane targeting 2.0`
- Package/version state: `1.6.373`
- Staged files: none
- Dirty tree: large, expected.

The detailed checkpoint is in:

- `storage-refactor-start-checkpoint-2026-05-20.md`

That note records the dirty tracked/untracked inventory, validation state, and
the storage refactor starting context. Read it before changing code.

## Recent Validation

Known passed at version `1.6.373`:

- `npm test`
- `npm run prod`
- `npm run build:chrome`
- `npm run build:firefox`

Known packaged artifacts:

- `chrome/mute_block-1.6.373.zip`
- `firefox/mute_block-1.6.373.zip`

The unpacked Chrome build was synced to the Windows profile and reloaded.
Latest live extension check:

```json
{
  "id": "ajcjckiafbnhioeafaejlaehkmdcdeha",
  "name": "Mute Block",
  "state": "ENABLED",
  "version": "1.6.373",
  "manifestErrors": [],
  "runtimeErrors": []
}
```

## Live Browser State

Do not assume the live browser is idle. The hidden profile-search collector
eventually queued more Elon work.

Latest `node tools/cdp/queue-counts.js --needle=elon`:

```json
{
  "needle": "elon",
  "rowCount": 472,
  "counts": {
    "canceled": 93,
    "succeeded": 291,
    "queued": 88
  },
  "profileTabCount": 2,
  "profilePages": [
    {
      "title": "(22) Elon Musk - Quora",
      "url": "https://www.quora.com/profile/Elon-Musk-100"
    },
    {
      "title": "(22) ELON MUSK - Quora",
      "url": "https://www.quora.com/profile/ELON-MUSK-377"
    }
  ]
}
```

Latest `node tools/cdp/target-summary.js`:

```json
{
  "totalTargets": 21,
  "profilePageCount": 2,
  "spacePageCount": 0,
  "challengeFrameCount": 3,
  "extensionPages": [
    "chrome-extension://ajcjckiafbnhioeafaejlaehkmdcdeha/coordinator.html"
  ]
}
```

If the next work is storage refactor, it may be best to pause or let the live
queue settle before testing storage changes. Recheck with:

- `node tools/cdp/extension-errors.js`
- `node tools/cdp/queue-counts.js --needle=elon`
- `node tools/cdp/target-summary.js`

## What Just Happened

Two narrow fixes landed before this handoff:

1. Manual failed requeue was moved into the serialized storage-update lane.
   This fixed `Elon-Musk-2459`, which had failed with `requeue-save-failed`.
   After `1.6.372`, it requeued and completed as `succeeded / already-blocked`.

2. `animateNukeButtonPress()` now uses a bounded `requestAnimationFrame`
   wait. Hidden search collection had hung because the animation waited for two
   RAF callbacks in a hidden tab. Version `1.6.373` fixed that first hang.

The hidden search collector then progressed once and later queued more work,
but it still showed signs of hidden-tab throttling. The user said to stop that
line for now and move to storage work.

New helper added:

- `tools/cdp/close-profile-search-tabs.js`

## Main Next Work

The next phase should not start by wiring WAL directly. The user explicitly
raised two immediate priorities:

1. Reducing the number of full-state load/save points is itself high priority.
2. Eradicating backward-looking compatibility paths is also high priority.

The review plan to work from is:

- `storage-authority-refactor-plan-for-review-2026-05-20.md`

The WAL design note remains relevant:

- `storage-wal-overlay-design-2026-05-20.md`

The checkpoint note says the next work should start with:

1. Full-state load/save call-site inventory as a checked artifact.
2. Snapshot-write reason metrics and static guards.
3. Delete/keep/quarantine inventory for compatibility and legacy mutation
   paths.
4. A thin production `chrome.storage.local` adapter seam with no behavior
   change.

## Important Review Feedback Already Incorporated

The plan was updated with feedback from another model:

- Keep the authority-refactor plan; it is a better immediate next step than
  wiring WAL directly.
- Make inventory a checked artifact: call-site table plus static/contract test.
- Treat display/dashboard as a read reason, not a write reason, unless the
  operation is explicitly a compatibility flush.
- Move a thin production `chrome.storage.local` adapter into Phase 0.
- Make `mutateCoordinatorProjection(operation)` take an explicit operation
  shape, not a free-form callback.
- Require a delete/keep/quarantine table for every legacy compatibility path.
- Start with Priority A inventory plus reason metrics and a static guard
  preventing new unreasoned `saveCoordinatorState()` call sites.

## Suggested First Implementation Slice

Do this before modifying runtime behavior:

1. Create a checked inventory artifact, probably:
   - `storage-authority-callsite-inventory-2026-05-20.md`

2. Populate it from searches for:
   - `loadCoordinatorState(`
   - `saveCoordinatorState(`
   - `metricStorageGet(`
   - `metricStorageSet(`
   - `browser.storage.local.get`
   - `browser.storage.local.set`
   - `safeStorageSet`
   - `recordProfileNukeProgress`
   - `compatibility`
   - `legacy`
   - `fallback`

3. Classify each call site:
   - `ordinaryMutation`
   - `repair`
   - `displayRead`
   - `compatibilityFlush`
   - `checkpointSwitchCandidate`
   - `userMemoryNonAuthority`

4. Add a static/contract test that ensures `saveCoordinatorState()` call sites
   are reasoned/inventoried.

5. Add snapshot-write reason metrics, but keep behavior unchanged in the first
   pass if possible.

6. Separately create the compatibility delete/keep/quarantine table.

Do not start broad WAL rewiring until this inventory and guardrail work exists.

## Files Most Likely To Matter

- `shared/js/sw.js`
- `shared/js/content.js`
- `shared/js/jobState.js`
- `shared/js/walSnapshotStore.js`
- `test/p1-contract.test.js`
- `test/swSynthetic.test.js`
- `test/storageInvariants.test.js`
- `test/walSnapshotStore.test.js`
- `test/walSnapshotStoreFuzz.test.js`
- `tools/cdp/`

## Validation Pattern

For non-shipped planning/doc/test-only changes:

- Run the narrow relevant tests first.
- Then run `npm test` if test/runtime behavior changed.

For shipped behavior changes:

1. Bump version first in:
   - `package.json`
   - `package-lock.json`
   - `manifests/chrome.json`
   - `manifests/firefox.json`
2. Run `npm test`.
3. Run `npm run prod`.
4. Run `npm run build:chrome`.
5. Run `npm run build:firefox`.
6. Sync unpacked Chrome build to Windows.
7. Reload extension with `node tools/cdp/reload-extension.js`.
8. Verify with `node tools/cdp/extension-errors.js`.

## Startup Idle Policy

After a browser restart on `about:blank` or other non-Quora pages, do not make
product correctness depend on the Mute Block service worker answering CDP
`Runtime.evaluate` immediately. MV3 may expose a service-worker target before
it is ready for a debug/evaluate probe. The extension should be robust by not
needing that worker until the user visits Quora or explicitly opens an
extension control surface.

Runtime behavior before first Quora activation:

- Do not resume, repair, pump, or nudge queued work.
- Do not perform eager full metrics/storage reads just because the browser
  started.
- Keep browser-startup metrics reset lazy. Apply it on first Quora activation
  or an explicit dashboard/control interaction.
- A quiet idle state means no Quora targets, no extension pages, no scheduler
  timers, no active/provisional runtime ownership, and no new storage/pump/
  repair/nudge activity once metrics are readable.

Live CDP/debug behavior before first Quora activation:

- A service-worker `Runtime.evaluate` timeout is not by itself a product
  failure when the browser has no Quora or extension pages open.
- CDP helpers should either perform a small debugger/wake normalization before
  evaluating the service worker, or report a distinct
  `pre-quora-worker-not-ready` / `debug-probe-not-ready` state instead of
  treating the browser as scheduler-unhealthy.
- If the worker later becomes reachable and shows no timers, no runtime work,
  and a clean epoch with zero storage/pump/repair/nudge counters, classify the
  restart as product-idle even if the first debug probe timed out.
- Treat immediate post-restart service-worker responsiveness as a debug tooling
  concern, not a product invariant, unless it also correlates with visible
  Quora work, extension pages, runtime errors, scheduler timers, or fresh
  storage activity.

## Cautions

- The tree is very dirty. Do not revert unrelated changes.
- Some notes and helper scripts are untracked by Git but are intentional working
  artifacts.
- Live storage pressure is severe; CDP helper calls that read storage may wait.
- Search-page hidden-tab behavior remains imperfect. Do not resume the Elon
  search-collection loop unless the user asks.
- The WAL module is tested as a kernel, but not integrated as production
  storage authority yet.
