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

## Phase 3 Discovery-Only Smokes

Phase 3 is a warmed, non-work-starting, seeded space-registry suite. It treats
the suite as non-work-starting, not no-write. Persisted space/source/candidate
discovery projections are acceptable. Profile authority, profile progress,
coordinator queue authority, WAL appends, pending/nuked space post state, and
queued action-surface state are not acceptable.

The space discovery smoke does not test the real mark-space UI path. It seeds
asset/target classifications directly into `mbSpaceRegistry`, then verifies
that discovery and display paths work without creating queue authority. A future
UI-path space-mark smoke should be a separate phase because persistent
`mbSpaceRegistry` mutation would be the behavior under test, not incidental
setup.

Space discovery:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current-warmed-phase3 \
  --phase phase3-space-discovery-smoke
```

The default space inputs are:

- assets: `https://theqdefensecrew.quora.com/`,
  `https://instantblock.quora.com/`
- targets: `https://terryspcfreetopics.quora.com/`,
  `https://jonspoliticalcorner29.quora.com/`

Additional space inputs can be supplied with repeated `--space-asset-url` or
`--space-target-url` options. The runner records those as space-level registry
state only, opens each page, lets the content script discover visible profile
candidates, and fails if no candidates are visible/countable.

Profile search discovery:

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current-warmed-phase3 \
  --phase phase3-search-discovery-smoke \
  --search-url 'https://www.quora.com/search?q=elon%20musk&type=profile'
```

Phase 3 also reruns the old-surface gates from earlier phases. Legacy runtime
actions must still be rejected, the full legacy `mbProfileNukeProgress` storage
key must not appear, legacy repair/import alarms must not appear, active/queued
work counts must not increase, and the discovery authority summary must remain
empty for queue rows, WAL changes, profile progress rows, pending/nuked space
post rows, and queued action-surface records.

For profile-search pages, raw Quora profile links are reported but do not count
as a passing discovery surface by themselves. The search smoke requires an
extension-built actionable candidate surface: nonzero profile-search rows,
profile-search row buttons, or a nonzero batch candidate count exposed by the
extension UI. If the page has raw profile links but `Nuke 'Em 0`, the smoke
should fail; that means the extension did not build a queueable search
candidate set.

Phase-specific baseline files are written under `tmp/upgrade-regression/` by
default. Phase 3 baseline comparison keeps exact candidate counts in the full
report but normalizes the strict comparable shape to stable facts such as
candidate presence, page type, scoped state, category classification, and zero
queue/progress rows. A Phase 3 baseline should be labeled as warmed unless it
is captured from a recreated store `1.4.186` profile immediately after upgrade.

## Phase 4 UI Space-Mark Smoke

Phase 4 remains non-work-starting. It exercises the real space asset/target UI
path instead of seeding `mbSpaceRegistry` directly. The only intended persistent
mutation is `mbSpaceRegistry`.

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current-warmed-phase4 \
  --phase phase4-space-mark-ui-smoke \
  --space-mark-url https://instantblock.quora.com/ \
  --space-mark-category asset
```

The smoke opens the space page, clicks the real category controls, observes a
temporary category, clicks the desired category, reloads the page, and verifies
that the desired category display persists. It must not click queue/start,
profile mark, nuke, mute, block, pause, cancel, clear-profile, or post-action
controls.

Forbidden side effects are unchanged from Phase 3: no coordinator queue rows,
no queue view rows, no WAL changes, no profile progress rows, no pending/nuked
space post records, no queued action-surface records, no profile marks, no full
legacy `mbProfileNukeProgress` key, and no legacy runtime actions.

Keep seeded Phase 3 as a separate discovery suite. Do not replace it with this
UI-path smoke; the two phases prove different boundaries.

## Phase 5 Dashboard Readonly Authority Smoke

Phase 5 proves that the upgraded extension can wake, render its own dashboard,
inspect current authority, and remain inert. It opens `coordinator.html`,
captures dashboard-visible queue/accounting/wakeup state, and sends only the
current non-work-starting diagnostic actions used by the earlier phases.

```bash
node tools/cdp/upgrade-regression/run.js \
  --extension-id nlmmkoljofpgbmlcojebolmniineboah \
  --profile-label store-1.4-to-current-warmed-phase5 \
  --phase phase5-dashboard-readonly-authority-smoke
```

The smoke instruments dashboard runtime messages during page load. It fails if
the dashboard sends queue-starting or profile-mutating actions such as resume,
enqueue, claim, profile action, pause, cancel, retry, requeue, reset, pending
post mutation, or sweep actions.

The dashboard must render from compact/current authority views:
`mbCoordinatorQueueView` and `mbQueueWakeupMetricsView`. It must not revive the
full legacy `mbProfileNukeProgress` blob, accept `record-nuke-progress*`, expose
repair/import alarms, create queue rows, change the WAL signature, create
profile progress rows, or create queued action-surface records.

This phase produces a normalized `dashboardAuthoritySmoke` comparable report so
warmed baseline comparisons do not depend on open extension views, local paths,
or raw before/after storage deltas.

## Queue-Authority Phases

Queue-authority phases are a separate class of regression test. One controlled
item and small-batch tests intentionally create queue authority and profile
state, so they should run only in a disposable profile. Do not run them as the
immediate next step while validating the non-work-starting suite.

Those later phases must still preserve the architecture boundary: WAL-backed
queue authority only, no legacy full-progress storage, no legacy import, and no
repair-style compatibility behavior.
