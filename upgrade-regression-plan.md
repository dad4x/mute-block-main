# Browser Upgrade Regression

## Goal

Validate the fresh Chrome profile that started from Chrome Web Store Mute Block
`1.4.186` and was manually upgraded to the keyed current unpacked build with
the same extension ID:

```text
nlmmkoljofpgbmlcojebolmniineboah
```

This suite is browser-backed and CDP-only. It must not add or depend on legacy
progress import, repair aliases, or compatibility migrations.

## Phase 1 Non-Work-Starting Smoke

Run against an already-launched Chrome profile with remote debugging exposed on
`127.0.0.1:9223`:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current
```

Optional baseline capture:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current \
  --write-baseline
```

Optional baseline comparison:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current \
  --compare-baseline tmp/upgrade-regression/store-1.4-to-current.phase1-non-work-starting-smoke.json
```

Expected output is compact JSON with at least:

```json
{
  "pass": true,
  "phase": "phase1-non-work-starting-smoke",
  "profileLabel": "store-1.4-to-current",
  "extension": {
    "id": "nlmmkoljofpgbmlcojebolmniineboah",
    "name": "Mute Block",
    "version": "1.6.853",
    "location": "UNPACKED",
    "state": "ENABLED"
  },
  "storageKeys": [
    "flipToAnswers",
    "fopDelay",
    "fopFlipDelay",
    "maxRememberedNukedPosts",
    "mbCoordinatorQueueView",
    "mbQueueWakeupMetrics",
    "mbQueueWakeupMetricsView",
    "nukedPostRetentionDays",
    "profilesPerBatch"
  ],
  "storageKeyDelta": {
    "added": [],
    "removed": [],
    "allowedAdded": [],
    "unexpectedAdded": []
  },
  "failures": [],
  "warnings": []
}
```

The runner exits nonzero if any hard check fails.

Baseline comparison intentionally uses a normalized comparable shape. It checks
stable upgrade facts only: extension id/name/version/location/state/errors,
final storage keys, forbidden-action summaries, non-user reconcile behavior,
visible alarm names, work counts, phase-specific content-smoke facts, and
whether unexpected keys were added. It does not compare unstable inspection
details such as extension view lists, extension install paths, or the full
before/after storage delta.

## Phase 1 Checks

- Extension is installed, enabled, named `Mute Block`, has the repo current
  version, and has zero manifest/runtime/install warnings or errors.
- Legacy runtime actions are not accepted:
  `record-nuke-progress`, `record-nuke-progress-batch`, and
  `repair-coordinator-storage`.
- Non-user `reconcile-coordinator-storage` returns the display-only disabled
  result.
- Current low-risk diagnostic actions respond:
  `get-coordinator-queue-accounting`,
  `get-coordinator-why-not-running`, and
  `refresh-queue-wakeup-metrics-view`.
- Storage has no full `mbProfileNukeProgress` key and no visible legacy
  repair/import keys.
- Current compact projection and queue-authority key families are allowed.
- Old preference keys may remain.
- Before/after storage-key deltas are reported. New keys fail the run unless
  they are explicitly allowlisted current diagnostic/projection keys:
  `mbCoordinatorQueueView`, `mbQueueWakeupMetrics`, or
  `mbQueueWakeupMetricsView`.
- Visible extension alarms must not use legacy repair/import names.
- Active/queued work counts must not increase during the smoke.

The runner may open `chrome://extensions/` or `coordinator.html` in the target
browser if no suitable inspection target already exists. The coordinator page is
used only as a display-only extension context for storage and runtime probes.
Those probes may materialize the current diagnostic/projection keys listed
above, so Phase 1 is intentionally named non-work-starting rather than
read-only.

## Phase 2 Content Smoke

Run against an existing benign Quora tab, or pass a benign Quora URL for the
runner to open in the target browser:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current \
  --phase phase2-content-smoke \
  --quora-url https://www.quora.com/
```

Phase 2 includes the Phase 1 non-work-starting checks, then verifies that the
content script is injected on a Quora page and that
`get-content-page-coordinator-state` returns scoped content-page state from the
content-script context. It does not click UI, enqueue work, or start queue
drain.

Phase 2 may materialize current compact content projections such as
`mbCoordinatorContentQueueIndex`, `mbCoordinatorContentSourceIndex.*`,
`mbProfileNukeProgressView`, `mbProfileNukeProgressShard.*`,
`mbBrowserSessionMarker`, or `mbQuoraRuntimeActivated`. It must not create the
full legacy `mbProfileNukeProgress` key, accept legacy runtime actions, expose
queue rows for the page smoke, or increase active/queued work counts.

Phase-specific baseline files are written under `tmp/upgrade-regression/` by
default. A profile that has already run Phase 2 is a warmed phase2 profile
because compact content projection shards may already exist. Capture pristine
store-upgrade baselines only from a freshly recreated store `1.4.186` profile;
otherwise label the snapshot accordingly, for example
`store-1.4-to-current-warmed-phase2`.

## Later Phases

Phase 3 should cover one controlled item. Phase 4 should cover a small batch.
None of those phases should reintroduce legacy full-progress storage, legacy
import, or repair-style compatibility behavior.
